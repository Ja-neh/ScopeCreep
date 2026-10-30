import * as THREE from 'three';
import { BaseLevel } from './BaseLevel.js';
import { BeachEnvironment } from './level02/BeachEnvironment.js';
import { BeachCover } from './level02/BeachCover.js';
import { Player } from '../entities/Player.js';
import { WeaponPickup } from '../entities/WeaponPickup.js';
import { ProjectilePool } from '../entities/ProjectilePool.js';
import { AlienTrooper } from '../entities/enemies/AlienTrooper.js';
import { AlienBrute } from '../entities/enemies/AlienBrute.js';
import { AlienSniper } from '../entities/enemies/AlienSniper.js';
import { AlienHeavy } from '../entities/enemies/AlienHeavy.js';
import { AlienModel } from '../entities/models/AlienModel.js';
import { SquadMate } from '../entities/allies/SquadMate.js';
import { AlienSquad } from '../ai/AlienSquad.js';
import { HumanSquad } from '../ai/HumanSquad.js';
import { WeaponController } from '../weapons/WeaponController.js';
import { mapTerrainFromEnvironment } from '../ui/components/MapOverlay.js';
import config from '../config.json';

// The alien unit types createAlien() knows how to raise
const ALIEN_TYPES = {
  trooper: AlienTrooper,
  brute: AlienBrute,
  sniper: AlienSniper,
  heavy: AlienHeavy
};

// The ship's crew besides the player (call signs for messages)
export const CREW_NAMES = ['Okafor', 'Reyes', 'Novak', 'Chen'];

/**
 * IslandLevel
 * The on-foot levels on the island (Level 2: The Beach, Level 3: The Village) share this:
 * the island (terrain, sea, sky, trees, rocks and bushes), the player with machine gun and knife,
 * the AI squad, the aliens, and the rules for being downed and revived, hiding in bushes and low
 * health. A level adds its own world, spawn point and scenario through these hooks:
 *
 * - _environmentOptions(), _coverOptions(): look and shadow area
 * - _buildWorld(): the level's own places (landing zone, village), before the trees are planted
 * - _clearings(): ground the trees and rocks must leave open
 * - _mapMarkers(): objective pins drawn on the island map ([M])
 * - _mapZones(): zone boundary lines drawn on the island map ([M])
 * - _mapIntel(): intel spots (notes, radios) drawn on the island map ([M])
 * - _playerSpawn(): where the player starts ({ position, yaw })
 * - _createProps(): things that need the player and weapons (supply crates)
 * - _startScenario() / _updateScenario(delta): the mission itself (state != won/lost)
 * - _updateWorld(delta): per-frame upkeep of the level's own places
 * - _shouldStaySuspended(): something else holds the player still (a cinematic)
 * - _onPlayerKilled(delta): the player is gone for good (default: mission failed)
 * - _resultText(victory): title and message for the result screen
 * - _lowHealthHint(): where to heal, shown when health runs low
 */
export class IslandLevel extends BaseLevel {
  constructor(gameWorld, name) {
    super(gameWorld, name);

    this.environment = null;
    this.cover = null;
    this.player = null;
    this.weapons = null;
    this.projectilePool = null;
    this.allies = null;       // HumanSquad: the player and AI squadmates
    this.squad = null;        // AlienSquad
    this.cinematic = null;    // A camera sequence playing, if any (see _shouldStaySuspended)

    this.state = 'playing';
    this.elapsed = 0;
    this._wasConcealed = false;
    this._playerDown = false;  // Downed, waiting for a revive
    this._playerLost = false;  // Bled out (or nobody could come): the mission is over
    this._downedShown = -1;
    this._reviving = null;     // Squadmate the player is reviving
    this._reviveProgress = 0;
    this._revivePromptLabel = null;
    this._lowHealthWarned = false;
    this._squadmatesLost = 0;
    this._respawnTimer = -1;   // Counting down to a respawn (see _respawnPlayer)
    this._mapRefreshTimer = 0; // Throttles redraws of an open island map
  }

  async init() {
    await super.init();

    // 1. Island, sea, sky and lighting
    this.environment = this.trackDisposable(new BeachEnvironment(this.gameWorld, this._environmentOptions()));
    this.environment.build();

    // 2. The level's own places
    await this._buildWorld();

    // 3. Trees, rocks and bushes, leaving those places open
    this.cover = this.trackDisposable(new BeachCover(this.gameWorld, this.environment, this._clearings(), this._coverOptions()));
    this.cover.build();
    this._coverBuilt();

    // 4. Player
    this._createPlayer();
    this._checkpoint=this.player.position.clone();

    // 5. Machine gun and knife (after the player, so its camera work runs after the player's).
    //    Every shot is a noise the aliens can hear, and every landing shot is reported back to
    //    the level through _weaponOptions() (destructible scenery listens there).
    this.weapons = new WeaponController(this.gameWorld, this.player, {
      onGunshot: (position) => this.squad.reportNoise(position),
      ...this._weaponOptions()
    });
    this.gameWorld.addEntity(this.weapons);
    const pickupPosition = this.player.position.clone();
    pickupPosition.x += 4;
    pickupPosition.y = this.environment.heightAt(pickupPosition.x, pickupPosition.z) + 0.12;
    this.gameWorld.addEntity(new WeaponPickup(this.gameWorld, this.player, this.weapons, pickupPosition));

    // 6. Projectiles for the aliens' plasma rifles
    this.projectilePool = new ProjectilePool(this.gameWorld);
    this.gameWorld.addEntity(this.projectilePool);
    this.gameWorld.projectilePool = this.projectilePool;

    // 7. Our side: the player leads, AI squadmates fill the crew's empty places
    this.allies = this.trackDisposable(new HumanSquad(this.gameWorld, {
      leader: this.player,
      cover: this.cover,
      isWalkable: (x, z) => this._isWalkable(x, z),
      corpseSeconds: config.allies.squadMate.corpseSeconds,
      onGunshot: (position) => this.squad.reportNoise(position),
      onMemberDowned: (member) => this._onMemberDowned(member),
      onMemberRevived: (member, by) => this._onMemberRevived(member, by),
      onMemberExpired: member=>this._recoverAtCheckpoint(member),
      onMateKilled: (mate) => this._onSquadmateKilled(mate),
      onLeaderLost: () => { this._playerLost = true; }
    }));

    // 8. The aliens, who hunt all of us
    const trooperCfg = config.enemies.trooper;
    this.squad = this.trackDisposable(new AlienSquad(this.gameWorld, {
      targets: this.allies.members,
      cover: this.cover,
      alertRadius: trooperCfg.alertRadius,
      corpseSeconds: trooperCfg.corpseSeconds
    }));
    this.allies.enemySquad = this.squad;

    // 9. Level props, then the mission
    this._createProps();
    await this._startScenario();
    console.log(`${this.name} initialized.`);
  }

  // ---------------------------------------------------------------------------
  // Hooks (see the class comment)
  // ---------------------------------------------------------------------------

  _environmentOptions() {
    return {};
  }

  _coverOptions() {
    return {};
  }

  /** Called once the scenery is built and solid: levels with destructible cover build it here. */
  _coverBuilt() { }

  /** Extra options for the player's WeaponController (e.g. onBulletImpact). */
  _weaponOptions() {
    return {};
  }

  async _buildWorld() { }

  _clearings() {
    return [];
  }

  /** Objective pins drawn on the island map. Levels with objectives override this. */
  _mapMarkers() {
    return [];
  }

  /** Zone boundary lines drawn on the island map ([M]). Island missions with zones override this. */
  _mapZones() {
    return [];
  }

  /** Intel spots drawn on the island map ([M]). Levels with a trail to follow override this. */
  _mapIntel() {
    return [];
  }

  /** The island chart for the map overlay: world bounds around the playable scatter. */
  getMapTerrain() {
    if(!this.environment)return null;
    const terrain=mapTerrainFromEnvironment(this.environment);
    terrain.buildings=this.village ? [...this.village.houses.map(h=>({x:h.x,z:h.z,width:h.w,depth:h.d,yaw:h.yaw})),
      {x:this.village.hall.centre.x,z:this.village.hall.centre.z,width:this.village.hall.width,depth:this.village.hall.depth,yaw:0,boss:true}] : [];
    terrain.ships=this.village?.ships || [];
    terrain.streets=this.village?.streets || [];
    return terrain;
  }

  /**
   * The open map's snapshot: the player, the squad, the aliens still alive (the ones hunting
   * us burn bright, the unaware ones are a dim rim to go and find), the level's markers, its
   * zone lines and its intel spots.
   */
  getMapData() {
    const player = this.player;
    if (!player || !this.environment) return null;

    const mates = [];
    if (this.allies) {
      for (const member of this.allies.members) {
        if (member === player) continue;
        mates.push({
          x: member.position.x,
          z: member.position.z,
          downed: !!(member.health && member.health.isDead)
        });
      }
    }

    const enemies = [];
    if (this.squad) {
      const bruteHealth = config.enemies.brute.maxHealth;
      for (const alien of this.squad.members) {
        if (!alien.health || alien.health.isDead) continue; // Corpses drop off the map
        enemies.push({
          x: alien.position.x,
          z: alien.position.z,
          big: alien.health.maxHealth >= bruteHealth,
          alerted: !!(alien.perception && alien.perception.target)
        });
      }
    }

    return {
      player: { x: player.position.x, z: player.position.z, yaw: player.yaw },
      mates,
      enemies,
      markers: this._mapMarkers(),
      zones: this._mapZones(),
      intel: this._mapIntel()
    };
  }

  /** Keeps the on-screen charts fed: fresh markers a few times a second are plenty. */
  _updateMap(delta) {
    const ui = this.gameWorld.ui;
    if (!ui || (!ui.isMapOpen && !ui.isMinimapVisible)) return;
    this._mapRefreshTimer -= delta;
    if (this._mapRefreshTimer > 0) return;
    this._mapRefreshTimer = 0.12;
    ui.updateMap(this.getMapData());
  }

  /** @returns {{position: THREE.Vector3, yaw: number}} */
  _playerSpawn() {
    return { position: new THREE.Vector3(0, this.environment.heightAt(0, 0) + 0.2, 0), yaw: 0 };
  }

  _createProps() { }

  async _startScenario() { }

  _updateScenario(delta) { }

  _updateWorld(delta) { }

  /** Something other than being downed holds the player still (a camera sequence). */
  _shouldStaySuspended() {
    return !!(this.cinematic && this.cinematic.isPlaying);
  }

  /**
   * The player is gone for good: bled out, or went down with nobody left to come.
   * Called every frame from then on. Missions fail; sandboxes respawn instead.
   */
  _onPlayerKilled(delta) {
    this._respawnPlayer(delta,()=>this._checkpoint,'SQUAD DOWN: returning to the checkpoint');
  }

  _resultText(victory) {
    if (victory) return { title: 'MISSION COMPLETE', message: '' };
    return {
      title: 'MISSION FAILED',
      message: this.allies && this.allies.aliveMates === 0
        ? 'Your whole squad went down.'
        : 'You bled out before help could reach you.'
    };
  }

  _lowHealthHint() {
    return 'Low health! Find a supply crate and hold [E] to patch up.';
  }

  /** Can a squadmate stand at (x, z)? Dry land, clear of rocks and trees. */
  _isWalkable(x, z) {
    return this.environment.heightAt(x, z) > 0.3 && this.cover.isClearOfSolids(x, z, 0.8);
  }

  // ---------------------------------------------------------------------------
  // Player and squad
  // ---------------------------------------------------------------------------

  _createPlayer() {
    const { position, yaw } = this._playerSpawn();
    // Snap-to-ground keeps the player on ramps and hills; crouch hides them in bushes
    this.player = new Player(this.gameWorld, {
      snapToGround: true,
      canCrouch: true,
      maxHealth: config.player.vitals.maxHealth
    });
    this.player.setPosition(position.x, position.y, position.z);
    this.player.yaw = yaw;
    // Chain off the Player's own hit feedback (blood) instead of replacing it
    const playerBaseOnDamage = this.player.health.onDamage;
    this.player.health.onDamage = (info) => {
      if (playerBaseOnDamage) playerBaseOnDamage(info);
      this._onPlayerHurt();
    };
    this.gameWorld.addEntity(this.player);

    const ui = this.gameWorld.ui;
    if (ui) {
      ui.showPlayerHealth();
      ui.updatePlayerHealth(this.player.health.currentHealth, this.player.health.maxHealth);
    }
  }

  /** What the controls card shows (keys come from the InputManager bindings). */
  get controls() {
    return [
      { actions: ['forward', 'steerLeft', 'backward', 'steerRight'], label: 'Move' },
      { actions: ['sprint', 'jump'], label: 'Sprint, jump' },
      { actions: ['crouch'], label: 'Crouch (hide in bushes)' },
      { actions: ['firePrimary'], label: 'Fire (click to lock the mouse)' },
      { actions: ['aimDownSights'], label: 'Aim' },
      { actions: ['reload'], label: 'Reload' },
      { actions: ['characterPower'], label: 'Character power (cooldown)' },
      { actions: ['weaponPrimary', 'weaponMelee', 'weaponBomb', 'quickMelee'], label: 'Gun, knife, bomb, quick knife' },
      { actions: ['toggleMap'], label: 'Expand island chart' },
      { actions: ['specialAction'], label: 'Hold: revive, patch up' },
      { actions: ['toggleCamera'], label: '1st / 3rd person' },
      { actions: ['pause'], label: 'Pause and options' }
    ];
  }

  /** How many AI squadmates make up the crew: everyone but the human players. */
  get aiCrewCount() {
    return Math.max(0, config.allies.crewSize - 1);
  }

  /**
   * Adds an AI squadmate standing at `position` (following the player unless ordered otherwise).
   * @param {string} name
   * @param {THREE.Vector3} position - Feet
   * @param {Object} [options]
   * @param {Object} [options.model] - Defaults to crew colours
   * @param {boolean} [options.formation=true] - Takes a place in the player's formation
   * @returns {SquadMate}
   */
  spawnSquadMate(name, position, { model = null, formation = true } = {}) {
    const mate = new SquadMate(this.gameWorld, { name, position, squad: this.allies, model });
    return this.allies.add(mate, { formation });
  }

  /**
   * Creates one alien of `type` ('trooper', 'brute', 'sniper' or 'heavy') at (x, z), patrolling
   * there — or standing at the exact `y` given, for units that start off the ground (a sniper's
   * watchtower perch).
   * @returns {AlienCombatant}
   */
  createAlien(type, x, z, y = null) {
    const position = new THREE.Vector3(x, y === null ? this.environment.heightAt(x, z) + 0.1 : y, z);
    const AlienType = ALIEN_TYPES[type] || AlienTrooper;
    const characterId=type==='brute' ? 'gorr' : this.village && type==='sniper' ? 'bahamut-nt' : 'galiant';
    const model=new AlienModel({characterId,scale:type==='heavy' ? 1.6 : type==='brute' ? 1.45 : 1});
    return this.squad.add(new AlienType(this.gameWorld, { position, squad: this.squad,model }));
  }

  _onMemberDowned(member) {
    if (member === this.player || !this.gameWorld.ui) return;
    this.gameWorld.ui.showToast(`${member.name} is down! Hold [E] beside them to revive.`, 'danger', 3000);
  }

  _onMemberRevived(member, by) {
    this._restoreCombatState(member);
    const ui = this.gameWorld.ui;
    if (!ui) return;
    if (member === this.player) ui.showToast(`${by?.name || 'A teammate'} got you back on your feet!`, 'success', 2500);
    else if (by === this.player) ui.showToast(`You revived ${member.name}.`, 'success', 2000);
    else ui.showToast(`${by.name} revived ${member.name}.`, 'info', 2000);
  }

  _restoreCombatState(member) {
    member.model?.character?.resetPose();
    if(member.power) member.power.remaining=member.power.cooldown=member.power.shield=0;
    if(member.weapon){member.weapon.ammo=member.weapon.magazineSize;member.weapon.cancelReload();}
    if(member===this.player){this.weapons?.restoreAmmo();this.shield?.clear();}
  }

  _recoverAtCheckpoint(member) {
    const spawn=this.lastRevivePoint?.respawnPosition || this._checkpoint;
    if(member===this.player){
      member.health.revive(member.health.maxHealth);
      member.teleport(spawn.x,spawn.y,spawn.z);this._playerGetsUp();
    }else{
      member.isLost=false;member.lostTime=0;member.revive(member.health.maxHealth);
      const angle=(member.slotIndex || 0)*1.6;
      const x=spawn.x+Math.cos(angle)*3,z=spawn.z+Math.sin(angle)*3;
      member.teleport(x,this.environment.heightAt(x,z)+0.1,z);
    }
    this._restoreCombatState(member);member.reviveSecondsLeft=0;
    this.gameWorld.ui?.showToast(`${member===this.player ? 'You' : member.name} returned to the checkpoint with full health and ammunition.`,'info',2500);
  }

  _onSquadmateKilled(mate) {
    this._squadmatesLost++;
    if (this.gameWorld.ui) this.gameWorld.ui.showToast(`${mate.name} didn't make it.`, 'danger', 2500);
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------

  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    super.gameplayUpdate(delta, gameWorld);
    this.elapsed += delta;

    this.environment.update(delta);
    this.squad.update();
    this.allies.update(delta);
    this._updateWorld(delta);
    this._updateMap(delta);

    this._updatePlayerDowned(delta);
    this._updatePlayerRevive(delta);
    if (this._lowHealthWarned && this.player.health.currentHealth > this.player.health.maxHealth * 0.6) {
      this._lowHealthWarned = false;
    }
    this._updateConcealment(gameWorld);

    if (this.state !== 'won' && this.state !== 'lost') {
      this._updateScenario(delta);
    }
  }

  /**
   * At 0 health the player is downed: lying still while the squad sends someone to revive them.
   * Bleeding out, or having nobody left standing to come, ends it (see _onPlayerKilled).
   */
  _updatePlayerDowned(delta) {
    const player = this.player;
    if (!player.health.isDead) {
      if (this._playerDown) this._playerGetsUp();
      return;
    }
    if (this.state === 'won' || this.state === 'lost') return;

    if (!this._playerDown) {
      this._playerDown = true;
      this._downedShown = -1;
      this._setPlayerDownPose(true);
    }
    player.isDevSuspended = true; // Every frame: e.g. a camera sequence ending must not free a downed player

    const left = Math.ceil(this.allies.bleedOutLeft(player));
    if (left !== this._downedShown && this.gameWorld.ui) {
      this._downedShown = left;
      const reviver = this.allies.reviverFor(player);
      this.gameWorld.ui.showStatusIndicator(
        reviver
          ? `DOWNED: ${reviver.name} is coming — checkpoint in ${left}s`
          : `DOWNED: rescue window — checkpoint in ${left}s`,
        'danger'
      );
    }
  }

  /**
   * The player is lost: `config.player.vitals.respawnSeconds` later they are back on their feet
   * at `point()` with full health. Call every frame while they are lost (from _onPlayerKilled).
   * @param {number} delta
   * @param {() => THREE.Vector3} point - Where they come back (feet)
   * @param {string} [message] - Shown while they wait
   * @returns {boolean} True on the frame they come back
   */
  _respawnPlayer(delta, point, message = 'YOU WERE KILLED') {
    const player = this.player;
    const ui = this.gameWorld.ui;
    if (this._respawnTimer < 0) {
      this._respawnTimer = config.player.vitals.respawnSeconds;
      player.isDevSuspended = true; // Freezes movement, camera and weapons while down
      if (ui) ui.showStatusIndicator(message, 'danger');
      return false;
    }
    this._respawnTimer -= delta;
    if (this._respawnTimer > 0) return false;

    this._respawnTimer = -1;
    const spawn = point();
    player.teleport(spawn.x, spawn.y, spawn.z);
    player.health.reset();
    player.model.character.resetPose();
    player.mesh.rotation.x=player.mesh.rotation.z=0;
    player.isLost=false;
    this.weapons?.restoreAmmo();this.shield?.clear();
    for(const [i,mate] of this.allies.mates.entries()){
      mate.isLost=false;mate.lostTime=0;
      if(mate.isDead) mate.revive(mate.health.maxHealth);
      else mate.health.reset();
      mate.model.character?.resetPose();
      this._restoreCombatState(mate);
      const x=spawn.x+Math.cos(i*1.6)*3,z=spawn.z+Math.sin(i*1.6)*3;
      mate.teleport(x,this.environment.heightAt(x,z)+0.1,z);
    }
    this._playerGetsUp();
    player.isDevSuspended = this._shouldStaySuspended();
    this._wasConcealed = false;
    if (ui) {
      ui.hideStatusIndicator();
      ui.updatePlayerHealth(player.health.currentHealth, player.health.maxHealth);
    }
    return true;
  }

  _playerGetsUp() {
    const player = this.player;
    this._playerDown = false;
    this._playerLost = false;
    player.isLost = false;
    this._setPlayerDownPose(false);
    if (!this._shouldStaySuspended()) player.isDevSuspended = false;
    const ui = this.gameWorld.ui;
    if (ui) {
      ui.hideStatusIndicator();
      ui.updatePlayerHealth(player.health.currentHealth, player.health.maxHealth);
    }
  }

  /** Lays the player's body on the ground while downed. */
  _setPlayerDownPose(down) {
    this.player.mesh.rotation.x = down ? Math.PI * 0.47 : 0;
  }

  /**
   * The downed squadmate the player would be reviving right now, or null.
   * The single definition of what owns [E] beside a downed mate: supply crates yield to it
   * (their isSuppressed) so one press never both revives and resupplies.
   * @returns {Object|null}
   */
  _reviveCandidate() {
    const player = this.player;
    const able = !player.health.isDead && !player.isDevSuspended && this.state !== 'won' && this.state !== 'lost';
    return able ? this.allies.nearestDownedMate(player.position, this.allies.reviveRadius) : null;
  }

  /**
   * Hold [E] (specialAction) beside a downed squadmate to revive them.
   */
  _updatePlayerRevive(delta) {
    const player = this.player;
    const mate = this._reviveCandidate();
    if (!mate) {
      this._reviving = null;
      this._reviveProgress = 0;
      this._setRevivePrompt(null);
      return;
    }

    if (!this.gameWorld.input.isActionDown('specialAction')) {
      this._reviving = null;
      this._reviveProgress = 0;
      this._setRevivePrompt(`HOLD TO REVIVE ${mate.name.toUpperCase()}`);
      return;
    }
    if (this._reviving !== mate) {
      this._reviving = mate;
      this._reviveProgress = 0;
    }
    this._reviveProgress += delta;
    if (this._reviveProgress >= this.allies.reviveHoldSeconds) {
      this.allies.reviveMember(mate, player);
      this._reviving = null;
      this._reviveProgress = 0;
      this._setRevivePrompt(null);
      return;
    }
    const percent = Math.floor((10 * this._reviveProgress) / this.allies.reviveHoldSeconds) * 10;
    this._setRevivePrompt(`REVIVING ${mate.name.toUpperCase()} ${percent}%`);
  }

  _setRevivePrompt(label) {
    if (label === this._revivePromptLabel) return;
    this._revivePromptLabel = label;
    const ui = this.gameWorld.ui;
    if (!ui) return;
    if (label) ui.showPrompt('E', label, '#2ec4b6', this);
    else ui.hidePrompt(this);
  }

  _updateConcealment(gameWorld) {
    if (this._playerDown) return;
    // Hidden while crouched in a bush (AI perception reads player.isConcealed)
    const concealed = !this.player.health.isDead && this.cover.updateConcealment(this.player);
    if (concealed !== this._wasConcealed && gameWorld.ui) {
      if (concealed) gameWorld.ui.showStatusIndicator('HIDDEN', 'success');
      else gameWorld.ui.hideStatusIndicator();
      this._wasConcealed = concealed;
    }
  }

  _onPlayerHurt() {
    if (this.gameWorld && this.gameWorld.audio) {
      this.gameWorld.audio.play('hurt');
    }
    const ui = this.gameWorld.ui;
    if (!ui) return;
    ui.flashDamage();
    const health = this.player.health;
    ui.updatePlayerHealth(health.currentHealth, health.maxHealth);
    // (A hit that downs the player is not "low health": they are down)
    if (health.currentHealth > 0 && !this._lowHealthWarned && health.currentHealth <= health.maxHealth * config.player.vitals.lowHealthFraction) {
      this._lowHealthWarned = true;
      ui.showToast(this._lowHealthHint(), 'warning', 4000);
    }
  }

  _showObjective(title, detail) {
    if (this.gameWorld.ui) this.gameWorld.ui.showObjective(title, detail);
  }

  /**
   * Ends the mission and shows the result screen.
   */
  _finish(victory) {
    this.state = victory ? 'won' : 'lost';

    // The score lands the ending: a resolved pad on victory, silence and a sting on defeat
    const music = this.gameWorld.music;
    if (music && music.isRunning) {
      if (victory) {
        music.setState('victory');
      } else {
        music.stop();
        music.stinger('defeat');
      }
    }

    if (this.cinematic) this.cinematic.finish(); // First: ending, it unfreezes the player
    this.player.isDevSuspended = true; // Freeze the player behind the result screen
    this.gameWorld.input.exitPointerLock();

    const ui = this.gameWorld.ui;
    if (!ui) return;
    ui.hideObjective();
    ui.hideStatusIndicator();
    ui.hideMap();

    const minutes = Math.floor(this.elapsed / 60);
    const seconds = Math.floor(this.elapsed % 60).toString().padStart(2, '0');
    const stats = [
      { label: 'Time', value: `${minutes}:${seconds}` },
      { label: 'Aliens killed', value: String(this.squad.killCount) },
      { label: 'Squadmates lost', value: String(this._squadmatesLost) }
    ];
    const toMenu = { label: 'Main menu', onClick: () => this.gameWorld.returnToMainMenu() };
    const { title, message } = this._resultText(victory);
    ui.showMissionResult({
      outcome: victory ? 'victory' : 'defeat',
      title,
      message,
      stats,
      actions: [{ label: victory ? 'Play again' : 'Retry', onClick: () => this.gameWorld.restartCurrentLevel() }, toMenu]
    });
  }

  dispose() {
    console.log(`Disposing ${this.name}...`);
    const ui = this.gameWorld.ui;
    if (ui) {
      ui.hideObjective();
      ui.hideMissionResult();
      ui.hideStatusIndicator();
      ui.hidePlayerHealth();
      ui.hideMap();
      ui.hidePrompt(this);
    }

    this.player = null;
    this.weapons = null;
    this.cinematic = null; // Entities: the GameWorld disposes them
    super.dispose(); // Disposes both squads (removing their members), cover, environment and level extras
    this.squad = null;
    this.allies = null;
    if (this.gameWorld.projectilePool === this.projectilePool) {
      this.gameWorld.projectilePool = null;
    }
    this.projectilePool = null;
    this.environment = null;
    this.cover = null;
  }
}
