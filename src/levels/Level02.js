import * as THREE from 'three';
import { BaseLevel } from './BaseLevel.js';
import { BeachEnvironment } from './level02/BeachEnvironment.js';
import { LandingZone } from './level02/LandingZone.js';
import { BeachCover } from './level02/BeachCover.js';
import { ObjectiveBeacon } from './level02/ObjectiveBeacon.js';
import { Player } from '../entities/Player.js';
import { ProjectilePool } from '../entities/ProjectilePool.js';
import { AlienTrooper } from '../entities/enemies/AlienTrooper.js';
import { AlienBrute } from '../entities/enemies/AlienBrute.js';
import { AlienSquad } from '../ai/AlienSquad.js';
import { WaveDirector } from '../ai/WaveDirector.js';
import { WeaponController } from '../weapons/WeaponController.js';
import config from '../config.json';

// Where each attack lane comes out of the jungle (on the way down from the village) and what it
// pushes to (the beach). Spawns are 60-100 m from the beach so the fight starts soon.
const LANES = {
  centre: { name: 'the jungle path', spawn: { x: 16, z: 92 }, assault: { x: 0, z: 168 } },
  west: { name: 'the west', spawn: { x: -75, z: 100 }, assault: { x: -35, z: 165 } },
  east: { name: 'the east', spawn: { x: 75, z: 95 }, assault: { x: 35, z: 165 } }
};
const SPAWN_JITTER = 8;           // Meters of random spread around a lane's spawn point
const ASSAULT_JITTER = 20;
const OBJECTIVE_Z = 80;           // Where the jungle path enters the trees
const LEFT_SHIP_Z = 195;          // Past the gangway foot: the player is ashore

/**
 * Level02
 * Level 2: The Beach. The squad lands from the anchored warship and holds the island's south
 * beach against three waves of aliens pushing down from the village, then pushes inland to the
 * jungle path. Introduces on-foot combat: machine gun and knife, cover, and hiding in bushes.
 *
 * Flow: landing (until the player is ashore or the timer runs out) -> waves -> objective -> won.
 * Losing: the player is killed (until squadmates and revives arrive).
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
    this.squad = null;
    this.waves = null;
    this.beacon = null;

    this.state = 'landing'; // landing -> waves -> objective -> won | lost
    this.elapsed = 0;
    this._wasConcealed = false;
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

    // 4. Player on deck at the foot of the boarding ramp, facing the beach
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

    // 7. The aliens
    const trooperCfg = config.enemies.trooper;
    this.squad = this.trackDisposable(new AlienSquad(this.gameWorld, {
      targets: [this.player],
      cover: this.cover,
      alertRadius: trooperCfg.alertRadius,
      corpseSeconds: trooperCfg.corpseSeconds
    }));

    await this._startScenario();
    console.log(`${this.name} initialized.`);
  }

  _createPlayer() {
    const spawn = this.landingZone.spawnPoints.deck;
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

  // ---------------------------------------------------------------------------
  // Scenario hooks (Level02TestLevel overrides these)
  // ---------------------------------------------------------------------------

  /** Extra open ground for scenery placement. */
  _extraClearings() {
    return Object.values(LANES).map((lane) => ({ x: lane.spawn.x, z: lane.spawn.z, radius: 4 }));
  }

  /** Sets up the waves and the objective. */
  async _startScenario() {
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
      aliveCount: () => this.squad.aliveCount
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
    const from = (wave.lanes || ['centre']).map((lane) => (LANES[lane] || LANES.centre).name).join(', ');
    const brutes = wave.brute ? ` — ${wave.brute} brute${wave.brute > 1 ? 's' : ''} among them` : '';
    ui.showToast(`Wave ${this.waves.waveNumber}: aliens coming from ${from}${brutes}!`, 'warning', 4000);
  }

  /** What happens when the player's health reaches 0 (called every frame while they are down). */
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
      const x = centre.x + (Math.random() - 0.5) * 2 * SPAWN_JITTER;
      const z = centre.z + (Math.random() - 0.5) * 2 * SPAWN_JITTER;
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

    if (this.player.health.isDead) {
      if (this.state !== 'won' && this.state !== 'lost') this._onPlayerKilled(delta);
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

  _updateConcealment(gameWorld) {
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
    ui.updatePlayerHealth(this.player.health.currentHealth, this.player.health.maxHealth);
  }

  _showObjective(title, detail) {
    if (this.gameWorld.ui) this.gameWorld.ui.showObjective(title, detail);
  }

  /**
   * Ends the mission and shows the result screen.
   */
  _finish(victory) {
    this.state = victory ? 'won' : 'lost';
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
      { label: 'Aliens killed', value: String(this.squad.killCount) }
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
        message: 'You were overrun on the beach.',
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
    }

    this.player = null;
    this.weapons = null;
    this.waves = null;
    super.dispose(); // Disposes the squad (removing the aliens), cover, landing zone, environment, beacon
    this.squad = null;
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
