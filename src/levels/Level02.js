import * as THREE from 'three';
import { BaseLevel } from './BaseLevel.js';
import { BeachEnvironment } from './level02/BeachEnvironment.js';
import { LandingZone } from './level02/LandingZone.js';
import { BeachCover } from './level02/BeachCover.js';
import { ObjectiveBeacon } from './level02/ObjectiveBeacon.js';
import { SupplyCrate } from './level02/SupplyCrate.js';
import { LandingCinematic } from './level02/LandingCinematic.js';
import { Player } from '../entities/Player.js';
import { ProjectilePool } from '../entities/ProjectilePool.js';
import { AlienTrooper } from '../entities/enemies/AlienTrooper.js';
import { AlienBrute } from '../entities/enemies/AlienBrute.js';
import { SquadMate } from '../entities/allies/SquadMate.js';
import { SoldierModel } from '../entities/models/SoldierModel.js';
import { AlienSquad } from '../ai/AlienSquad.js';
import { HumanSquad } from '../ai/HumanSquad.js';
import { WaveDirector } from '../ai/WaveDirector.js';
import { WeaponController } from '../weapons/WeaponController.js';
import config from '../config.json';

// Where each attack lane comes out of the jungle (on the way down from the village) and what it
// pushes to (the beach). Five lanes spread along the treeline, 60-100 m from the beach, so a
// wave comes at the squad from everywhere at once.
const LANES = {
  farWest: { name: 'the far west', spawn: { x: -130, z: 100 }, assault: { x: -70, z: 160 } },
  west: { name: 'the west', spawn: { x: -70, z: 92 }, assault: { x: -35, z: 165 } },
  centre: { name: 'the jungle path', spawn: { x: 16, z: 88 }, assault: { x: 0, z: 168 } },
  east: { name: 'the east', spawn: { x: 75, z: 90 }, assault: { x: 35, z: 165 } },
  farEast: { name: 'the far east', spawn: { x: 130, z: 100 }, assault: { x: 70, z: 160 } }
};
const SPAWN_SPREAD_X = 22;        // Meters of random scatter around a lane's spawn point, across...
const SPAWN_SPREAD_Z = 10;        // ...and along the island
const ASSAULT_JITTER = 20;
const OBJECTIVE_Z = 80;           // Where the jungle path enters the trees
const LEFT_SHIP_Z = 195;          // Past the gangway foot: the player is ashore

// The ship's crew besides the player, and the helicopter pilots (call signs for messages)
const CREW_NAMES = ['Okafor', 'Reyes', 'Novak', 'Chen'];
const PILOT_NAMES = ['Hawk', 'Viper'];
const PILOT_COLOURS = { suitColor: 0x6b705c, helmetColor: 0xd8d8d0, visorColor: 0x2b2f33 };
// At the start the crew stand on the gangway (0 = top, 1 = foot), lead first, and set off
// down it partway through the opening so the sweep ends with them filing onto the sand
const CREW_GANGWAY_PLACES = [0.88, 0.66, 0.44, 0.22];
const CREW_DEPART_SECONDS = 5;
// Where the crew gather on the sand until the player is ashore (world x, z, facing)
const RALLY_POSTS = [
  { x: -13.5, z: 180.5, facing: 0.6 },
  { x: -6.5, z: 180.5, facing: -0.6 },
  { x: -16, z: 184, facing: 1.4 },
  { x: -4, z: 184, facing: -1.4 }
];

/**
 * Level02
 * Level 2: The Beach. The squad lands from the anchored warship and holds the island's south
 * beach against three waves of aliens pushing down from the village, then pushes inland to the
 * jungle path. Introduces on-foot combat: machine gun and knife, cover, and hiding in bushes.
 *
 * Opening: a camera sweep while the AI crew file down the gangway and the two helicopters fly
 * in and land; their pilots climb out and guard them. In a solo game the player leads 4 AI
 * squadmates (the ship's crew is always 5), who wait on the sand, then follow the player in
 * formation and fight alongside them. An ammo crate stands between the helicopters.
 *
 * Flow: landing (until the player is ashore or the timer runs out) -> waves -> objective -> won.
 * Downed, not dead: at 0 health the player goes down and the nearest squadmate runs over to
 * revive them; the player revives downed squadmates by holding [E] beside them. Losing: the
 * player bleeds out, or goes down with nobody left standing to come. The supply crate between
 * the helicopters refills ammo and health.
 *
 * Level02TestLevel extends this with dummies, a respawning trio instead of waves, and dev tools.
 */
export class Level02 extends BaseLevel {
  constructor(gameWorld, name = 'Level 2: The Beach') {
    super(gameWorld, name);
    this.cfg = config.levels.level02;

    this.environment = null;
    this.landingZone = null;
    this.cover = null;
    this.player = null;
    this.weapons = null;
    this.projectilePool = null;
    this.allies = null;       // HumanSquad: the player and AI squadmates
    this.squad = null;        // AlienSquad
    this.waves = null;
    this.beacon = null;
    this.supplyCrate = null;
    this.cinematic = null;

    this.state = 'landing'; // landing -> waves -> objective -> won | lost
    this.elapsed = 0;
    this._wasConcealed = false;
    this._crewFollowing = false;
    this._playerDown = false;  // Downed, waiting for a revive
    this._playerLost = false;  // Bled out (or nobody could come): the mission is over
    this._downedShown = -1;
    this._reviving = null;     // Squadmate the player is reviving
    this._reviveProgress = 0;
    this._revivePromptLabel = null;
    this._lowHealthWarned = false;
    this._crewRoutes = [];    // Crew waiting on the gangway: { mate, route, rally, facing }
    this._squadmatesLost = 0;
    this._objectivePoint = new THREE.Vector3();
  }

  async init() {
    await super.init();

    // 1. Island, sea, sky and lighting
    this.environment = this.trackDisposable(new BeachEnvironment(this.gameWorld));
    this.environment.build();

    // 2. Ship, gangway and parked helicopters
    this.landingZone = this.trackDisposable(new LandingZone(this.gameWorld, this.environment));
    await this.landingZone.build();

    // 3. Trees, rocks and bushes, leaving the landing zone (and any level extras) open
    const clearings = [...this.landingZone.clearings, ...this._extraClearings()];
    this.cover = this.trackDisposable(new BeachCover(this.gameWorld, this.environment, clearings));
    this.cover.build();

    // 4. Player at the top of the gangway behind the crew, facing the beach
    this._createPlayer();

    // 5. Machine gun and knife (after the player, so its camera work runs after the player's).
    //    Every shot is a noise the aliens can hear.
    this.weapons = new WeaponController(this.gameWorld, this.player, {
      onGunshot: (position) => this.squad.reportNoise(position)
    });
    this.gameWorld.addEntity(this.weapons);

    // 6. Projectiles for the aliens' plasma rifles
    this.projectilePool = new ProjectilePool(this.gameWorld);
    this.gameWorld.addEntity(this.projectilePool);
    this.gameWorld.projectilePool = this.projectilePool;

    // 7. Our side: the player leads, AI squadmates fill the crew's empty places
    this.allies = this.trackDisposable(new HumanSquad(this.gameWorld, {
      leader: this.player,
      cover: this.cover,
      isWalkable: (x, z) => this.environment.heightAt(x, z) > 0.3 && this.cover.isClearOfSolids(x, z, 0.8),
      corpseSeconds: config.allies.squadMate.corpseSeconds,
      onGunshot: (position) => this.squad.reportNoise(position),
      onMemberDowned: (member) => this._onMemberDowned(member),
      onMemberRevived: (member, by) => this._onMemberRevived(member, by),
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

    // 9. Ammo crate between the helicopters
    this.supplyCrate = new SupplyCrate(this.gameWorld, {
      position: this.landingZone.spawnPoints.supplyCrate,
      player: this.player,
      weapons: this.weapons
    });
    this.gameWorld.addEntity(this.supplyCrate);

    await this._startScenario();
    console.log(`${this.name} initialized.`);
  }

  _createPlayer() {
    const spawn = this.landingZone.spawnPoints.gangwayTop;
    // Snap-to-ground keeps the player on the gangway and the hills; crouch hides them in bushes
    this.player = new Player(this.gameWorld, {
      snapToGround: true,
      canCrouch: true,
      maxHealth: config.player.vitals.maxHealth
    });
    this.player.setPosition(spawn.x, spawn.y, spawn.z);
    this.player.yaw = 0;
    this.player.health.onDamage = () => this._onPlayerHurt();
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
      { actions: ['weaponPrimary', 'weaponMelee', 'quickMelee'], label: 'Gun, knife, quick knife' },
      { actions: ['specialAction'], label: 'Supply crate; hold to revive' },
      { actions: ['toggleCamera'], label: '1st / 3rd person' },
      { actions: ['pause'], label: 'Pause and options' }
    ];
  }

  // ---------------------------------------------------------------------------
  // Scenario hooks (Level02TestLevel overrides these)
  // ---------------------------------------------------------------------------

  /** Extra open ground for scenery placement. */
  _extraClearings() {
    return Object.values(LANES).map((lane) => ({ x: lane.spawn.x, z: lane.spawn.z, radius: 4 }));
  }

  /** The landing, the waves and the objective. */
  async _startScenario() {
    this._beginLanding();

    const z = OBJECTIVE_Z;
    const x = this.environment.pathCentreX(z);
    this._objectivePoint.set(x, this.environment.heightAt(x, z), z);
    this.beacon = this.trackDisposable(new ObjectiveBeacon(this._objectivePoint, this.cfg.objectiveRadius));
    this.gameWorld.environmentGroup.add(this.beacon.mesh);

    this.waves = new WaveDirector({
      waves: this.cfg.waves,
      betweenWavesSeconds: this.cfg.betweenWavesSeconds,
      spawnIntervalSeconds: this.cfg.spawnIntervalSeconds,
      spawn: (type, lane) => this.spawnAlien(type, lane),
      aliveCount: () => this.squad.aliveCount,
      maxAlive: this.cfg.maxAliveAliens
    });

    this._showObjective('OBJECTIVE', 'Get off the ship and hold the beach');
  }

  /** Per-frame scenario logic: the mission's states. */
  _updateScenario(delta) {
    this.beacon.update(delta);

    switch (this.state) {
      case 'landing':
        if (this._isPlayerAshore() || this.elapsed >= this.cfg.firstWaveTriggerSeconds) {
          this.state = 'waves';
          this.waves.start();
        }
        break;

      case 'waves': {
        const waveBefore = this.waves.waveNumber;
        this.waves.update(delta);
        if (this.waves.waveNumber !== waveBefore) this._announceWave();
        if (this.waves.isDone) {
          this.state = 'objective';
          this.beacon.setVisible(true);
          if (this.gameWorld.ui) this.gameWorld.ui.showToast('The beach is ours. Push inland!', 'success', 3500);
        } else if (this.waves.state === 'between') {
          this._showObjective(`WAVE ${this.waves.waveNumber + 1} INCOMING`, 'Regroup and reload');
        } else {
          this._showObjective(`HOLD THE BEACH — WAVE ${this.waves.waveNumber} OF ${this.waves.totalWaves}`, `Aliens left: ${this.waves.remaining}`);
        }
        break;
      }

      case 'objective': {
        const distance = Math.hypot(this.player.position.x - this._objectivePoint.x, this.player.position.z - this._objectivePoint.z);
        this._showObjective('PUSH INLAND', `Reach the jungle path (green beacon) — ${Math.round(distance)} m`);
        if (distance <= this.cfg.objectiveRadius) this._finish(true);
        break;
      }
    }
  }

  /** Tells the player a wave has started and where it is coming from. */
  _announceWave() {
    const ui = this.gameWorld.ui;
    if (!ui) return;
    const wave = this.cfg.waves[this.waves.waveIndex];
    const lanes = wave.lanes || ['centre'];
    const from = lanes.length >= 4
      ? 'all along the treeline'
      : `from ${lanes.map((lane) => (LANES[lane] || LANES.centre).name).join(', ')}`;
    const count = (wave.trooper || 0) + (wave.brute || 0);
    const brutes = wave.brute ? ` — ${wave.brute} brute${wave.brute > 1 ? 's' : ''} among them` : '';
    ui.showToast(`Wave ${this.waves.waveNumber}: ${count} aliens coming ${from}${brutes}!`, 'warning', 4000);
  }

  /**
   * The opening: crew on the gangway, helicopters flying in, and the camera sweep.
   */
  _beginLanding() {
    this.spawnCrew({ onGangway: true });
    this.landingZone.flyInHelicopters({ onTouchdown: (bay, index) => this._pilotClimbsOut(bay, index) });

    this.cinematic = new LandingCinematic(this.gameWorld, {
      player: this.player,
      title: 'THE BEACH',
      subtitle: 'Land the squad and take back the coast',
      focus: (out) => this.landingZone.helicopterFocus(out)
    });
    this.gameWorld.addEntity(this.cinematic);
  }

  /** How many AI squadmates make up the crew: everyone but the human players. */
  get aiCrewCount() {
    return Math.max(0, config.allies.crewSize - 1);
  }

  /**
   * The AI crew: walking down the gangway to their rally posts on the sand, or already there.
   * They follow the player once the player is ashore.
   * @param {Object} [options]
   * @param {boolean} [options.onGangway=false]
   */
  spawnCrew({ onGangway = false } = {}) {
    const zone = this.landingZone;
    const down = new THREE.Vector3().subVectors(zone.gangway.foot, zone.gangway.top);
    const downYaw = Math.atan2(-down.x, -down.z);

    for (let i = 0; i < this.aiCrewCount; i++) {
      const post = RALLY_POSTS[i % RALLY_POSTS.length];
      const rally = new THREE.Vector3(post.x, this.environment.heightAt(post.x, post.z), post.z);
      const start = onGangway ? zone.gangwayPoint(CREW_GANGWAY_PLACES[i % CREW_GANGWAY_PLACES.length]) : rally.clone();
      start.y += onGangway ? 0.15 : 0.1;

      const mate = this.spawnSquadMate(CREW_NAMES[i % CREW_NAMES.length], start);
      if (onGangway) {
        // Wait on the gangway until the opening sends them down (see _sendCrewAshore)
        mate.yaw = downYaw;
        mate.hold(start, downYaw);
        this._crewRoutes.push({ mate, route: [zone.spawnPoints.gangwayFoot, rally], rally, facing: post.facing });
      } else {
        mate.yaw = post.facing;
        mate.hold(rally, post.facing);
      }
    }
    if (this._crewFollowing) this.allies.followLeader();
  }

  /**
   * The waiting crew walk down the gangway to their rally posts, once the opening is far enough
   * along (or over).
   */
  _sendCrewAshore() {
    if (this._crewRoutes.length === 0) return;
    const cinematic = this.cinematic;
    if (cinematic && !cinematic.isFinished && cinematic.elapsed < CREW_DEPART_SECONDS) return;
    for (const { mate, route, rally, facing } of this._crewRoutes) {
      if (mate.isDead) continue;
      mate.hold(rally, facing);
      if (!mate.isReviving) mate.walkRoute(route); // A medic finishes first, then heads for the rally
    }
    this._crewRoutes = [];
    if (this._crewFollowing) this.allies.followLeader();
  }

  /**
   * A pilot climbs out of a landed helicopter (or starts at `from`) and stands guard by its nose.
   */
  _pilotClimbsOut(bay, index, from = bay.doorPoint) {
    const start = from.clone();
    start.y += 0.1;
    const pilot = this.spawnSquadMate(PILOT_NAMES[index % PILOT_NAMES.length], start, {
      model: new SoldierModel(PILOT_COLOURS),
      formation: false
    });
    pilot.yaw = bay.heading;
    pilot.hold(bay.guardPoint, bay.guardFacing);
    return pilot;
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

  _onMemberDowned(member) {
    if (member === this.player || !this.gameWorld.ui) return;
    this.gameWorld.ui.showToast(`${member.name} is down! Hold [E] beside them to revive.`, 'danger', 3000);
  }

  _onMemberRevived(member, by) {
    const ui = this.gameWorld.ui;
    if (!ui) return;
    if (member === this.player) ui.showToast(`${by.name} got you back on your feet!`, 'success', 2500);
    else if (by === this.player) ui.showToast(`You revived ${member.name}.`, 'success', 2000);
    else ui.showToast(`${by.name} revived ${member.name}.`, 'info', 2000);
  }

  _onSquadmateKilled(mate) {
    this._squadmatesLost++;
    if (this.gameWorld.ui) this.gameWorld.ui.showToast(`${mate.name} didn't make it.`, 'danger', 2500);
  }

  /**
   * The player is gone for good: bled out, or went down with nobody left to come.
   * Called every frame from then on. Level02 fails the mission; the sandbox respawns instead.
   */
  _onPlayerKilled(delta) {
    this._finish(false);
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------

  /**
   * Creates one alien of `type` ('trooper' or 'brute') standing at (x, z), patrolling there.
   * @returns {AlienCombatant}
   */
  createAlien(type, x, z) {
    const position = new THREE.Vector3(x, this.environment.heightAt(x, z) + 0.1, z);
    const AlienType = type === 'brute' ? AlienBrute : AlienTrooper;
    return this.squad.add(new AlienType(this.gameWorld, { position, squad: this.squad }));
  }

  /**
   * Spawns one alien in `laneName` and sends it at the beach.
   * @returns {AlienCombatant|null}
   */
  spawnAlien(type, laneName) {
    const lane = LANES[laneName] || LANES.centre;
    const spot = this._findSpawnSpot(lane.spawn);
    if (!spot) return null;

    const alien = this.createAlien(type, spot.x, spot.z);

    const assault = new THREE.Vector3(
      lane.assault.x + (Math.random() - 0.5) * 2 * ASSAULT_JITTER,
      0,
      lane.assault.z + (Math.random() - 0.5) * ASSAULT_JITTER
    );
    assault.y = this.environment.heightAt(assault.x, assault.z);
    alien.assault(assault);
    return alien;
  }

  /**
   * A dry spot clear of rocks and trunks near `centre`, or null.
   */
  _findSpawnSpot(centre) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = centre.x + (Math.random() - 0.5) * 2 * SPAWN_SPREAD_X;
      const z = centre.z + (Math.random() - 0.5) * 2 * SPAWN_SPREAD_Z;
      if (this.environment.heightAt(x, z) > 0.6 && this.cover.isClearOfSolids(x, z, 1.2)) return { x, z };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------

  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    super.gameplayUpdate(delta, gameWorld);
    this.elapsed += delta;

    this.environment.update(delta);
    this.landingZone.update(delta);
    this.squad.update();
    this.allies.update(delta);
    this._sendCrewAshore();

    // The crew wait on the sand until the player is ashore, then fall in behind them
    if (!this._crewFollowing && this._isPlayerAshore()) {
      this._crewFollowing = true;
      this.allies.followLeader();
    }

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

  _isPlayerAshore() {
    const p = this.player.position;
    return p.z < LEFT_SHIP_Z && this.environment.heightAt(p.x, p.z) > 0 && p.y < this.environment.heightAt(p.x, p.z) + 1.5;
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
    player.isDevSuspended = true; // Every frame: e.g. the opening sweep ending must not free a downed player

    if (this._playerLost || !this.allies.canBeRevived(player)) {
      this._playerLost = true;
      this._onPlayerKilled(delta);
      return;
    }

    const left = Math.ceil(this.allies.bleedOutLeft(player));
    if (left !== this._downedShown && this.gameWorld.ui) {
      this._downedShown = left;
      this.gameWorld.ui.showStatusIndicator(`DOWNED: a squadmate is coming to revive you (${left}s)`, 'danger');
    }
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

  /** Something other than being downed holds the player still (the opening sweep). */
  _shouldStaySuspended() {
    return !!(this.cinematic && this.cinematic.isPlaying);
  }

  /** Lays the player's body on the ground while downed. */
  _setPlayerDownPose(down) {
    this.player.mesh.rotation.x = down ? Math.PI * 0.47 : 0;
  }

  /**
   * Hold [E] (specialAction) beside a downed squadmate to revive them.
   */
  _updatePlayerRevive(delta) {
    const player = this.player;
    const able = !player.health.isDead && !player.isDevSuspended && this.state !== 'won' && this.state !== 'lost';
    const mate = able ? this.allies.nearestDownedMate(player.position, this.allies.reviveRadius) : null;
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
    const ui = this.gameWorld.ui;
    if (!ui) return;
    ui.flashDamage();
    const health = this.player.health;
    ui.updatePlayerHealth(health.currentHealth, health.maxHealth);
    // (A hit that downs the player is not "low health": they are down)
    if (health.currentHealth > 0 && !this._lowHealthWarned && health.currentHealth <= health.maxHealth * config.player.vitals.lowHealthFraction) {
      this._lowHealthWarned = true;
      ui.showToast('Low health! Patch up at the supply crate between the helicopters [E].', 'warning', 4000);
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
    if (this.cinematic) this.cinematic.finish(); // First: ending, it unfreezes the player
    this.player.isDevSuspended = true; // Freeze the player behind the result screen
    this.gameWorld.input.exitPointerLock();

    const ui = this.gameWorld.ui;
    if (!ui) return;
    ui.hideObjective();
    ui.hideStatusIndicator();

    const minutes = Math.floor(this.elapsed / 60);
    const seconds = Math.floor(this.elapsed % 60).toString().padStart(2, '0');
    const stats = [
      { label: 'Time', value: `${minutes}:${seconds}` },
      { label: 'Aliens killed', value: String(this.squad.killCount) },
      { label: 'Squadmates lost', value: String(this._squadmatesLost) }
    ];
    const toMenu = { label: 'Main menu', onClick: () => this.gameWorld.returnToMainMenu() };

    if (victory) {
      ui.showMissionResult({
        outcome: 'victory',
        title: 'THE COAST IS OURS',
        message: 'The beachhead is taken. The village lies to the north, and our people are waiting.',
        stats,
        actions: [{ label: 'Play again', onClick: () => this.gameWorld.restartCurrentLevel() }, toMenu]
      });
    } else {
      ui.showMissionResult({
        outcome: 'defeat',
        title: 'MISSION FAILED',
        message: this.allies && this.allies.aliveMates === 0
          ? 'Your whole squad went down on the beach.'
          : 'You bled out before help could reach you.',
        stats,
        actions: [{ label: 'Retry', onClick: () => this.gameWorld.restartCurrentLevel() }, toMenu]
      });
    }
  }

  dispose() {
    console.log(`Disposing ${this.name}...`);
    const ui = this.gameWorld.ui;
    if (ui) {
      ui.hideObjective();
      ui.hideMissionResult();
      ui.hideStatusIndicator();
      ui.hidePlayerHealth();
      ui.hidePrompt(this);
    }

    this.player = null;
    this.weapons = null;
    this.waves = null;
    this.supplyCrate = null; // Entities: the GameWorld disposes them
    this.cinematic = null;
    super.dispose(); // Disposes both squads (removing their members), cover, landing zone, environment, beacon
    this.squad = null;
    this.allies = null;
    this.beacon = null;
    if (this.gameWorld.projectilePool === this.projectilePool) {
      this.gameWorld.projectilePool = null;
    }
    this.projectilePool = null;
    this.environment = null;
    this.landingZone = null;
    this.cover = null;
  }
}
