import * as THREE from 'three';
import { IslandLevel, CREW_NAMES } from './IslandLevel.js';
import { LandingZone } from './level02/LandingZone.js';
import { BeachWreckage } from './level02/BeachWreckage.js';
import { ObjectiveBeacon } from './level02/ObjectiveBeacon.js';
import { SupplyCrate } from './level02/SupplyCrate.js';
import { LandingCinematic } from './level02/LandingCinematic.js';
import { SoldierModel } from '../entities/models/SoldierModel.js';
import { WaveDirector } from '../ai/WaveDirector.js';
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
// Ship-camping pressure: while the player holds back on the deck during the waves, wave aliens
// make for the bottom of the gangway instead of the beach lanes, and the squad calls it out.
const SHIP_ASSAULT_INSHORE = 8;   // Meters inland of the gangway foot the horde gathers at
const SHIP_ASSAULT_SPREAD_X = 10; // Meters of scatter around that point, along the beach...
const SHIP_ASSAULT_SPREAD_Z = 4;  // ...and inshore
const OBJECTIVE_Z = 80;           // Where the jungle path enters the trees
const LEFT_SHIP_Z = 195;          // Past the gangway foot: the player is ashore
// The final ambush waits in the lanes that meet the jungle path and springs when the player
// pushes inland; the ambushers converge on the beacon and hold it.
const AMBUSH_LANES = ['centre', 'west', 'east'];

// The helicopter pilots (call signs for messages)
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
 * jungle path. Introduces on-foot combat (see IslandLevel): machine gun and knife, cover,
 * hiding in bushes, downed and revive.
 *
 * Opening: a camera sweep while the AI crew file down the gangway and the two helicopters fly
 * in and land; their pilots climb out and guard them. In a solo game the player leads 4 AI
 * squadmates (the ship's crew is always 5), who wait on the sand, then follow the player in
 * formation and fight alongside them. A supply crate stands between the helicopters (hold [E] to
 * patch up).
 *
 * Flow: landing (until the player is ashore or the timer runs out) -> waves -> objective (a last
 * group springs from the trees on the way in) -> won. Lingering aboard during the waves makes the
 * aliens mass at the gangway instead of the beach, with call-outs to get ashore.
 * Losing: the player bleeds out, or goes down with nobody left standing to come.
 *
 * Level02TestLevel extends this with dummies, a respawning trio instead of waves, and dev tools.
 */
export class Level02 extends IslandLevel {
  constructor(gameWorld, name = 'Level 2: The Beach') {
    super(gameWorld, name);
    this.cfg = config.levels.level02;

    this.landingZone = null;
    this.wreckage = null;
    this.waves = null;
    this.ambush = null;
    this.ambushTriggered = false;
    this.beacon = null;
    this.supplyCrate = null;

    this.state = 'landing'; // landing -> waves -> objective -> won | lost
    this._crewFollowing = false;
    this._crewRoutes = [];    // Crew waiting on the gangway: { mate, route, rally, facing }
    this._objectivePoint = new THREE.Vector3();
    this._shipCampTimer = -1; // Seconds the player has stayed aboard during the waves (-1: reset)
    this._shipCampNotices = 0;
  }

  // ---------------------------------------------------------------------------
  // IslandLevel hooks
  // ---------------------------------------------------------------------------

  /** Ship, gangway, parked helicopters, and the first attempt's wreckage on the sand. */
  async _buildWorld() {
    this.landingZone = this.trackDisposable(new LandingZone(this.gameWorld, this.environment));
    await this.landingZone.build();
    this.wreckage = this.trackDisposable(new BeachWreckage(this.gameWorld, this.environment, {
      clearings: [...this.landingZone.clearings, ...this._extraClearings()]
    }));
    this.wreckage.build();
  }

  _clearings() {
    return [...this.landingZone.clearings, ...this._extraClearings()];
  }

  /** The top of the gangway, behind the crew, facing the beach. */
  _playerSpawn() {
    return { position: this.landingZone.spawnPoints.gangwayTop, yaw: 0 };
  }

  /** Supply crate between the helicopters. It yields [E] while the player is reviving a squadmate. */
  _createProps() {
    this.supplyCrate = new SupplyCrate(this.gameWorld, {
      position: this.landingZone.spawnPoints.supplyCrate,
      player: this.player,
      weapons: this.weapons,
      isSuppressed: () => this._reviveCandidate() !== null
    });
    this.gameWorld.addEntity(this.supplyCrate);
  }

  _updateWorld(delta) {
    this.landingZone.update(delta);
    this._sendCrewAshore();

    // The crew wait on the sand until the player is ashore, then fall in behind them
    if (!this._crewFollowing && this._isPlayerAshore()) {
      this._crewFollowing = true;
      this.allies.followLeader();
    }
  }

  _resultText(victory) {
    if (victory) {
      return { title: 'THE COAST IS OURS', message: 'The beachhead is taken. The village lies to the north, and our people are waiting.' };
    }
    return {
      title: 'MISSION FAILED',
      message: this.allies && this.allies.aliveMates === 0
        ? 'Your whole squad went down on the beach.'
        : 'You bled out before help could reach you.'
    };
  }

  _lowHealthHint() {
    return 'Low health! Patch up at the supply crate between the helicopters — hold [E].';
  }

  // ---------------------------------------------------------------------------
  // Scenario hooks (Level02TestLevel overrides these)
  // ---------------------------------------------------------------------------

  /** Extra open ground for scenery placement. */
  _extraClearings() {
    return Object.values(LANES).map((lane) => ({ x: lane.spawn.x, z: lane.spawn.z, radius: 4 }));
  }

  /** Retunes the adaptive score to a mission state; a no-op where no music director exists. */
  _setMusic(state) {
    const music = this.gameWorld && this.gameWorld.music;
    if (music) music.setState(state);
  }

  /** Plays a one-shot music sting; a no-op where no music director exists. */
  _stingMusic(name) {
    const music = this.gameWorld && this.gameWorld.music;
    if (music) music.stinger(name);
  }

  /** The landing, the waves and the objective. */
  async _startScenario() {
    this._beginLanding(); // The intro groove and the deploy swell are already up (BaseLevel.init)

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

    // The final ambush: one group, waiting in the trees by the path
    const ambush = this.cfg.finalAmbush;
    this.ambush = new WaveDirector({
      waves: [{ trooper: ambush.trooper, brute: ambush.brute, lanes: AMBUSH_LANES }],
      betweenWavesSeconds: 0, // A single wave: the pause is never reached
      spawnIntervalSeconds: ambush.spawnIntervalSeconds,
      spawn: (type, lane) => this.spawnAlien(type, lane, this._objectivePoint),
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
          this._announceWave(); // The wave-count check in the 'waves' case only sees later waves
          this._setMusic('combat');
        }
        break;

      case 'waves': {
        const ashore = this._isPlayerAshore();
        this._updateShipPressure(ashore, delta);
        const waveBefore = this.waves.waveNumber;
        const stateBefore = this.waves.state;
        this.waves.update(delta);
        if (this.waves.waveNumber !== waveBefore) this._announceWave();
        if (stateBefore !== 'between' && this.waves.state === 'between') {
          this._announceHeldWave();
          this._setMusic('suspense');
          this._stingMusic('waveHeld');
        }
        if (this.waves.isDone) {
          this.state = 'objective';
          this.beacon.setVisible(true);
          this._setMusic('tense');
          if (this.gameWorld.ui) this.gameWorld.ui.showToast('The beach is ours. Push inland!', 'success', 3500);
        } else if (this.waves.state === 'between') {
          const regroup = ashore ? 'regroup and reload' : 'regroup, reload and get ashore';
          this._showObjective(`WAVE ${this.waves.waveNumber + 1} INCOMING`, `Next wave in ${Math.ceil(this.waves.nextWaveInSeconds)}s — ${regroup}`);
        } else {
          const left = ashore ? `Aliens left: ${this.waves.remaining}` : `Aliens left: ${this.waves.remaining} — get ashore!`;
          this._showObjective(`HOLD THE BEACH — WAVE ${this.waves.waveNumber} OF ${this.waves.totalWaves}`, left);
        }
        break;
      }

      case 'objective': {
        const distance = Math.hypot(this.player.position.x - this._objectivePoint.x, this.player.position.z - this._objectivePoint.z);
        if (!this.ambushTriggered && distance <= this.cfg.finalAmbush.triggerDistance) {
          this._startAmbush();
          break;
        }
        this._showObjective('PUSH INLAND', `Reach the jungle path (green beacon) — ${Math.round(distance)} m`);
        if (distance <= this.cfg.objectiveRadius) this._finish(true);
        break;
      }

      case 'ambush': {
        this.ambush.update(delta);
        this._showObjective('AMBUSH', `They were waiting in the trees — ${this.ambush.remaining} left`);
        if (this.ambush.isDone) {
          this.state = 'objective';
          this._setMusic('tense');
          if (this.gameWorld.ui) this.gameWorld.ui.showToast('The ambush is broken — push on to the path!', 'success', 3000);
        }
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
    const massing = this._shipPressureActive() ? ' They are making for the gangway!' : '';
    ui.showToast(`Wave ${this.waves.waveNumber}: ${count} aliens coming ${from}${brutes}!${massing}`, 'warning', 4000);
  }

  /** Tells the player a wave is broken and how long they have before the next one. */
  _announceHeldWave() {
    const ui = this.gameWorld.ui;
    if (!ui) return;
    ui.showToast(`Wave ${this.waves.waveNumber} held! Next wave in ${Math.round(this.cfg.betweenWavesSeconds)}s — regroup, reload, patch up.`, 'success', 3500);
  }

  /** The last stand: the group waiting in the trees springs as the player pushes inland. */
  _startAmbush() {
    this.ambushTriggered = true;
    this.state = 'ambush';
    this.ambush.start();
    this._setMusic('combat');
    this._stingMusic('ambush');
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showToast('Ambush! They were waiting in the trees — hold them off!', 'warning', 4000);
    }
  }

  // ---------------------------------------------------------------------------
  // The landing
  // ---------------------------------------------------------------------------

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
      focus: (out) => this.landingZone.helicopterFocus(out),
      // The camera reaches the player: the intro groove stops and the scene is just surf and wind
      onFinished: () => this._setMusic('ambient')
    });
    this.gameWorld.addEntity(this.cinematic);
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

  _isPlayerAshore() {
    const p = this.player.position;
    return p.z < LEFT_SHIP_Z && this.environment.heightAt(p.x, p.z) > 0 && p.y < this.environment.heightAt(p.x, p.z) + 1.5;
  }

  // ---------------------------------------------------------------------------
  // Ship-camping pressure
  // ---------------------------------------------------------------------------

  /** True while the player is holding back on the ship during the waves. */
  _shipPressureActive() {
    return this.state === 'waves' && !this._isPlayerAshore();
  }

  /**
   * A dry spot on the sand just inland of the gangway foot: where the aliens mass while the
   * player camps aboard, at the bottom of their own gangway.
   * @returns {THREE.Vector3}
   */
  _shipAssaultPoint() {
    const foot = this.landingZone.spawnPoints.gangwayFoot;
    for (let attempt = 0; attempt < 8; attempt++) {
      const x = foot.x + (Math.random() - 0.5) * 2 * SHIP_ASSAULT_SPREAD_X;
      const z = foot.z - SHIP_ASSAULT_INSHORE + (Math.random() - 0.5) * 2 * SHIP_ASSAULT_SPREAD_Z;
      const y = this.environment.heightAt(x, z);
      if (y > 0.3) return new THREE.Vector3(x, y, z);
    }
    const z = foot.z - SHIP_ASSAULT_INSHORE;
    return new THREE.Vector3(foot.x, this.environment.heightAt(foot.x, z), z);
  }

  /**
   * Pressure to leave the ship: while the player stays aboard during the waves, the squad calls
   * it out once after `warnAfterSeconds`, then every `callOutIntervalSeconds` after that.
   */
  _updateShipPressure(ashore, delta) {
    if (ashore) {
      this._shipCampTimer = -1;
      this._shipCampNotices = 0;
      return;
    }
    if (this._shipCampTimer < 0) this._shipCampTimer = 0;
    this._shipCampTimer += delta;

    const ui = this.gameWorld.ui;
    if (!ui) return;
    const pressure = this.cfg.shipPressure;
    if (this._shipCampNotices === 0 && this._shipCampTimer >= pressure.warnAfterSeconds) {
      this._shipCampNotices = 1;
      ui.showToast('They are massing at the gangway — get ashore!', 'danger', 4000);
    } else if (this._shipCampNotices > 0 && this._shipCampTimer >= pressure.warnAfterSeconds + this._shipCampNotices * pressure.callOutIntervalSeconds) {
      this._shipCampNotices += 1;
      ui.showToast('Get ashore — the aliens are still massing at the gangway!', 'warning', 3000);
    }
  }

  // ---------------------------------------------------------------------------
  // Spawning waves
  // ---------------------------------------------------------------------------

  /**
   * Spawns one alien in `laneName` and sends it at the beach (or at `assaultPoint`; or, while the
   * player camps aboard during the waves, at the bottom of the gangway).
   * @param {THREE.Vector3} [assaultPoint] - Where it should push to and hold (default: the lane's beach point)
   * @returns {AlienCombatant|null}
   */
  spawnAlien(type, laneName, assaultPoint = null) {
    const base = LANES[laneName] || LANES.centre;
    // Ambushers hold the point they were sent to (the beacon), not the lane's beach point; while
    // the player is aboard, wave aliens make for the bottom of the gangway instead
    const shipMassing = !assaultPoint && this._shipPressureActive();
    let target = assaultPoint || base.assault;
    if (shipMassing) target = this._shipAssaultPoint();
    const lane = { ...base, assault: target };
    const spot = this._findSpawnSpot(lane.spawn);
    if (!spot) return null;

    const alien = this.createAlien(type, spot.x, spot.z);

    // The gangway point carries its own scatter: no beach jitter stacked on top of it
    if (shipMassing) {
      alien.assault(target);
      return alien;
    }

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

  dispose() {
    this._setMusic('silent'); // The score goes quiet with the level (menu, restart, another stage)
    this.waves = null;
    this.ambush = null;
    this.supplyCrate = null; // Entities: the GameWorld disposes them
    super.dispose(); // Also the landing zone, the wreckage and the beacon (tracked)
    this.beacon = null;
    this.landingZone = null;
    this.wreckage = null;
  }
}
