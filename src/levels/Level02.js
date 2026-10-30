import * as THREE from 'three';
import { IslandLevel, CREW_NAMES } from './IslandLevel.js';
import { LandingZone } from './level02/LandingZone.js';
import { BeachWreckage } from './level02/BeachWreckage.js';
import { DestructibleCover } from './level02/DestructibleCover.js';
import { ObjectiveBeacon } from './level02/ObjectiveBeacon.js';
import { SupplyCrate } from './level02/SupplyCrate.js';
import { IntelTrail } from './level02/IntelTrail.js';
import { VillageSmoke } from './level02/VillageSmoke.js';
import { BeachGulls } from './level02/BeachGulls.js';
import { LandingCinematic } from './level02/LandingCinematic.js';
import { VillageGate } from './level02/VillageGate.js';
import { Level03 } from './Level03.js';
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
const LEFT_SHIP_Z = 195;          // Past the gangway foot: the player is ashore
// The final ambush waits in the rocks flanking the last stretch of the path and springs when the
// squad comes up to the gate; the ambushers push for the gate approach and hold it. The posts are
// probed clear ground on the ridges either side of the path (see VillageGate for the site probe).
const GATE_AMBUSH_POSTS = [
  { name: 'the west ridge', spawn: { x: -25, z: -215 } },
  { name: 'the far west rocks', spawn: { x: -35, z: -228 } },
  { name: 'the west rocks', spawn: { x: -15, z: -238 } },
  { name: 'the east rocks', spawn: { x: 38, z: -226 } },
  { name: 'the east ridge', spawn: { x: 20, z: -240 } }
];
// The ending: the squad steps through the gate and the level hands over to Level 3. The camera
// sweeps over the arch while the player is marched up the road centre (the squadmates follow on
// their own), then the screen fades to black and Level 3 is loaded underneath it.
const GATE_ENTRY = {
  depth: 10,           // Meters past the gate line the march ends at (the trigger ring stops short)
  walkSpeed: 2.0,      // m/s — a march, not a run
  holdSeconds: 1.4,    // Beat on the entry before the camera moves and the march begins
  walkDelay: 0.3,      // ...and a moment more before the first step
  settleSeconds: 2.2,  // Beat on the village after the march ends, before the fade
  fadeSeconds: 1.6,    // Seconds of black between starting the fade and loading the village
  lookShare: [0.35, 0.85] // Share of the march the eye drifts from the squad to the village
};
// The gate walker's fall: a short, low camera beat that cuts in the moment it goes down — the
// fall seen from its flank, then closer as it settles — before the view hands back to the player
// standing where they fought it (see _playKillCam)
const KILL_CAM = {
  duration: 3.4,
  holdSeconds: 0.5,     // Beat on the fall before the camera starts to drift
  firstDistance: 7,     // First shot: this far off the corpse's flank...
  firstHeight: 2.6,     // ...and this high, looking down on it
  closeDistance: 4.2,   // Then it closes in...
  closeHeight: 1.7,     // ...down to the corpse's level
  aimHeight: 2.2        // Roughly the walker's chest while it stood
};
// The holding force: once the waves break, the survivors have gone to ground across the island,
// one garrison per inland zone (see `zones` in config): the woods on either side of the path,
// the rock shelf, and the outskirts short of the village. They wait at their posts (they never
// push for the beach): the map ([M]) shows them dim until they see the player, and the hunt is
// over when the last one is down. Heavier units come last in each zone's roster.
const HOLDOUT_POSTS = [
  { zone: 'forest', name: 'the west woods', x: -95, z: -15 },
  { zone: 'forest', name: 'the east woods', x: 88, z: -55 },
  { zone: 'rocks', name: 'the west rocks', x: -125, z: -150 },
  { zone: 'rocks', name: 'the path bend', x: 8, z: -170 },
  { zone: 'outskirts', name: 'the west outskirts', x: -55, z: -255 },
  { zone: 'outskirts', name: 'the east outskirts', x: 65, z: -270 }
];
// How the scene sounds per zone (audio presentation, kept out of config like the director's own
// mix): the surf falls away as the squad pushes inland while the wind - and something low,
// chittering in the trees - takes over. The under-hum is the MusicDirector's own alien layer
// (setAmbience); the events below are one-shots the level plays.
const ZONE_AMBIENCE = {
  beach: { ocean: 0.12, wind: 0.09, alien: 0.0 },
  forest: { ocean: 0.05, wind: 0.11, alien: 0.05 },
  rocks: { ocean: 0.02, wind: 0.12, alien: 0.08 },
  outskirts: { ocean: 0.0, wind: 0.13, alien: 0.12 }
};
// A line of flavour for each zone, shown the first time the player crosses into it.
const ZONE_FLAVOUR = {
  beach: 'the waterline is behind you — hold the sand',
  forest: 'the canopy closes in — the surf fades behind you',
  rocks: 'broken ground and boulders — watch the high rocks',
  outskirts: 'the village plateau looms ahead — the last stretch'
};
// Ambient life: what is going on beyond the treeline, per zone. Ranges are seconds between
// events ([min, max]); a null kind never fires there. Explosions are the war inland, played flat
// as a far-off rumble; calls are alien voices placed out in the trees around the player, and the
// volume they carry is how close the island feels.
const AMBIENT_LIFE = {
  beach: { explosion: [9, 20], call: null, callVolume: 0.7 },
  forest: { explosion: [14, 26], call: [7, 15], callVolume: 0.7 },
  rocks: { explosion: [12, 24], call: [6, 12], callVolume: 0.85 },
  outskirts: { explosion: [10, 22], call: [5, 11], callVolume: 1.0 }
};
const ALIEN_CALL_MIN_DISTANCE = 40;    // A call is heard out in the trees, never at the ear
const ALIEN_CALL_MAX_DISTANCE = 90;
const DISTANT_EXPLOSION_VOLUME = 0.22; // Well under a real blast: it is somebody else's fight

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
 * hiding in bushes, downed and revive. Firefights eat into the scenery: bushes are shot away
 * fast, trees take a burst, rocks last longest, and alien flush grenades blow cover apart
 * (see DestructibleCover).
 *
 * Opening: a camera sweep while the AI crew file down the gangway and the two helicopters fly
 * in and land; their pilots climb out and guard them. In a solo game the player leads 4 AI
 * squadmates (the ship's crew is always 5), who wait on the sand, then follow the player in
 * formation and fight alongside them. A supply crate stands between the helicopters (hold [E] to
 * patch up).
 *
 * Flow: landing (until the player is ashore or the timer runs out) -> waves -> hunt (the survivors
 * have gone to ground across the island; the map shows them and the push resumes when the last is
 * down) -> objective (push to the village gate, where a last group springs from the rocks) ->
 * ambush (broken) -> gate (the gate fight: watchtower snipers, the garrison and the gate walker)
 * -> won once the squad walks through the opening. Lingering aboard during the waves makes the
 * aliens mass at the gangway instead of the beach, with call-outs to get ashore.
 *
 * The island is four zones, named as the player crosses into them (the `zones` in config): the
 * beach, the forest, the rockfields, then the village outskirts. Each holds its own garrison (the
 * hunt's holding force) and its own ambience — the surf fades inland while the wind and the
 * aliens' low under-hum grow (ZONE_AMBIENCE), with distant explosions and calls out in the trees
 * (AMBIENT_LIFE).
 *
 * The islanders' trail (IntelTrail): notes and dead radios left by the people the aliens took,
 * one in each zone — [E] to read each; the map ([M]) shows the unfound ones faintly, and every
 * find builds the story of Level 3. The village burns beyond the plateau: two smoke columns
 * (VillageSmoke) fade in over the last stretch, so the push inland has its skyline.
 *
 * The beach ends at the village gate (VillageGate): the massive frame on the plateau rim, broken
 * walls, and two watchtowers whose snipers (AlienSniper) glint and train a visible laser before
 * every shot. Break the garrison and the gate walker comes out (AlienHeavy, "THE GATE WALKER",
 * with its own health bar) — the last fight before the squad walks into Level 3's village.
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
    this.gate = null;
    this.destructibleCover = null;
    this.waves = null;
    this.ambush = null;
    this.ambushTriggered = false;
    this.beacon = null;
    this.supplyCrate = null;
    this.intel = null;
    this.villageSmoke = null;
    this.gulls = null;

    this.state = 'landing'; // landing -> waves -> hunt -> objective -> ambush -> gate -> clear -> ending (hands over to Level 3) | lost
    this._holdoutsTotal = 0;
    this._gateUnits = [];     // Everything the gate sends at the squad (snipers, garrison, walker)
    this._gateGarrison = [];  // The gate's rank and file (the walker has its own bar)
    this._gateQueue = [];     // Types still to pour out of the opening
    this._gateSpawnTimer = 0;
    this._gatePostIndex = 0;
    this._heavy = null;
    this._heavyDown = false;
    this.killCam = null;          // The walker's fall: the short kill-cam entity (see _playKillCam)
    this._zone = null;                    // The zone the player stands in (null until ashore)
    this._ambient = { explosion: Infinity, call: Infinity }; // Seconds to each ambient event
    this._ambientPoint = new THREE.Vector3(); // Scratch for placing a distant alien call
    this._crewFollowing = false;
    this._crewRoutes = [];    // Crew waiting on the gangway: { mate, route, rally, facing }
    this._objectivePoint = new THREE.Vector3();
    this._shipCampTimer = -1; // Seconds the player has stayed aboard during the waves (-1: reset)
    this._shipCampNotices = 0;
    this._gateEntryWalk = null;   // The scripted march up the village road: { curve, startTime, duration, end }
    this._gateEntryDone = false;  // The ending sweep is over: the screen is fading to black
    this._gateEntryFade = -1;     // Seconds of black left before Level 3 is loaded (-1: not yet)
    this._chained = false;        // Level 3 has been asked for (once; loadLevel is fire-and-forget)
    this._villageLook = new THREE.Vector3(); // What the ending camera settles on (the village centre)
    this._walkPoint = new THREE.Vector3();   // Scratch for the scripted march
    this._walkTangent = new THREE.Vector3();
  }

  // ---------------------------------------------------------------------------
  // IslandLevel hooks
  // ---------------------------------------------------------------------------

  /** Ship, gangway, parked helicopters, the first attempt's wreckage on the sand, and the smoke over the village. */
  async _buildWorld() {
    this.landingZone = this.trackDisposable(new LandingZone(this.gameWorld, this.environment));
    await this.landingZone.build();
    this.wreckage = this.trackDisposable(new BeachWreckage(this.gameWorld, this.environment, {
      clearings: [...this.landingZone.clearings, ...this._extraClearings()]
    }));
    this.wreckage.build();
    // The village gate on the plateau rim: where the path leaves the beach for the village, and
    // where the level's last fight happens (see VillageGate)
    this.gate = this.trackDisposable(new VillageGate(this.gameWorld, this.environment));
    this.gate.build();
    // The village burns beyond the ridge; the columns fade in over the last stretch of the push
    this.villageSmoke = this.trackDisposable(new VillageSmoke(this.gameWorld.environmentGroup, this.environment));
    // ...and the gulls keep working the bay behind the squad the whole way in
    this.gulls = this.trackDisposable(new BeachGulls(this.gameWorld.environmentGroup, this.environment));
  }

  _clearings() {
    const gateClearings = this.gate ? this.gate.clearings : [];
    return [...this.landingZone.clearings, ...this._extraClearings(), ...gateClearings];
  }

  /** Once the scenery stands: give it health so firefights eat into it (see DestructibleCover). */
  _coverBuilt() {
    this.destructibleCover = this.trackDisposable(new DestructibleCover(this.gameWorld, this.cover));
    this.destructibleCover.build();
  }

  /**
   * The machine gun reports each shot that lands so bushes (which have no collider) can be cut
   * down; trees and rocks take damage directly through their own colliders.
   */
  _weaponOptions() {
    return {
      onBulletImpact: (origin, point) => this.destructibleCover.bulletImpact(origin, point)
    };
  }

  /** The top of the gangway, behind the crew, facing the beach. */
  _playerSpawn() {
    return { position: this.landingZone.spawnPoints.gangwayTop, yaw: 0 };
  }

  /** Supply crate between the helicopters, and the islanders' intel trail. The crate yields [E] while the player is reviving a squadmate. */
  _createProps() {
    this.supplyCrate = new SupplyCrate(this.gameWorld, {
      position: this.landingZone.spawnPoints.supplyCrate,
      player: this.player,
      weapons: this.weapons,
      isSuppressed: () => this._reviveCandidate() !== null
    });
    this.gameWorld.addEntity(this.supplyCrate);

    // The islanders' trail: notes and dead radios left across the island ([E] to read each one)
    this.intel = new IntelTrail(this.gameWorld, {
      environment: this.environment,
      player: this.player,
      cover: this.cover,
      radius: this.cfg.intel.radius
    });
    this.gameWorld.addEntity(this.intel); // GameWorld adds its group and updates it each phase

    // An alien flush grenade's blast eats into the scenery as well as anyone caught in it
    this.projectilePool.onExplosion = (point, radius, damage) => this.destructibleCover.explosionDamage(point, radius, damage);
  }

  _updateWorld(delta) {
    this.landingZone.update(delta);
    if (this.destructibleCover) this.destructibleCover.update(delta);
    this._sendCrewAshore();
    this._updateZones();
    this._updateAmbientLife(delta);
    if (this.villageSmoke) this.villageSmoke.update(delta, this.player); // The intel trail updates as an entity (Phase 5)
    if (this.gulls) this.gulls.update(delta); // Birds over the bay: pure ambience

    // The crew wait on the sand until the player is ashore, then fall in behind them
    if (!this._crewFollowing && this._isPlayerAshore()) {
      this._crewFollowing = true;
      this.allies.followLeader();
    }
  }

  _resultText(victory) {
    if (victory) {
      return { title: 'THE COAST IS OURS', message: 'The gate is ours. The village lies beyond it, and our people are waiting.' };
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

  /** The gate pin is on the map from the push inland through to the fight at the gate. */
  _mapMarkers() {
    if (this.state !== 'objective' && this.state !== 'ambush' && this.state !== 'gate' && this.state !== 'clear') return [];
    return [{ x: this._objectivePoint.x, z: this._objectivePoint.z, label: 'THE GATE' }];
  }

  /** The zone lines on the island map: each inland line, named for the ground beyond it. */
  _mapZones() {
    return this.cfg.zones
      .filter((zone) => zone.inlandFrom !== null)
      .map((zone) => ({ id: zone.id, name: zone.name, z: zone.inlandFrom }));
  }

  /** The islanders' trail on the map: the unfound spots faint, the found ones pinned. */
  _mapIntel() {
    return this.intel ? this.intel.mapMarkers() : [];
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

    // The objective: the village gate on the plateau rim (see VillageGate). The beacon stands
    // just through the opening — the push inland ends inside the gate
    const point = this.gate.through;
    this._objectivePoint.set(point.x, point.y, point.z);
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

    // The final ambush: the group waiting in the rocks flanking the last stretch of the path,
    // sent at the gate approach once it springs
    const ambush = this.cfg.finalAmbush;
    this.ambush = new WaveDirector({
      waves: [{ trooper: ambush.trooper, brute: ambush.brute, lanes: GATE_AMBUSH_POSTS }],
      betweenWavesSeconds: 0, // A single wave: the pause is never reached
      spawnIntervalSeconds: ambush.spawnIntervalSeconds,
      spawn: (type, lane) => this.spawnAlien(type, lane, this.gate.approach),
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
          this._beginHunt();
        } else if (this.waves.state === 'between') {
          const regroup = ashore ? 'regroup and reload' : 'regroup, reload and get ashore';
          this._showObjective(`WAVE ${this.waves.waveNumber + 1} INCOMING`, `Next wave in ${Math.ceil(this.waves.nextWaveInSeconds)}s — ${regroup}`);
        } else {
          const left = ashore ? `Aliens left: ${this.waves.remaining}` : `Aliens left: ${this.waves.remaining} — get ashore!`;
          this._showObjective(`HOLD THE BEACH — WAVE ${this.waves.waveNumber} OF ${this.waves.totalWaves}`, left);
        }
        break;
      }

      case 'hunt': {
        const left = this.squad.aliveCount;
        if (left === 0) {
          this.state = 'objective';
          this.beacon.setVisible(true);
          this._setMusic('tense');
          if (this.gameWorld.ui) this.gameWorld.ui.showToast('The island is quiet — push on to the gate!', 'success', 3500);
          break;
        }
        this._showObjective('HUNT THE HOLDERS', `${left} aliens still hiding on the island — find them (map: [M])`);
        break;
      }

      case 'objective': {
        const distance = Math.hypot(this.player.position.x - this._objectivePoint.x, this.player.position.z - this._objectivePoint.z);
        if (!this.ambushTriggered && distance <= this.cfg.finalAmbush.triggerDistance) {
          this._startAmbush();
          break;
        }
        this._showObjective('PUSH TO THE GATE', `Reach the village gate (green beacon) — ${Math.round(distance)} m`);
        break;
      }

      case 'ambush': {
        this.ambush.update(delta);
        this._showObjective('AMBUSH', `They were waiting in the rocks — ${this.ambush.remaining} left`);
        if (this.ambush.isDone) this._startGateFight();
        break;
      }

      case 'gate': {
        this._updateGateFight(delta);
        this._showObjective('THE GATE', `Break the gate guard — ${this._gateAlive()} still standing`);
        break;
      }

      case 'clear': {
        // The walker's fall gets its own beat first: the walk through waits until the view is back
        if (this.killCam && this.killCam.isPlaying) break;
        const distance = Math.hypot(this.player.position.x - this._objectivePoint.x, this.player.position.z - this._objectivePoint.z);
        this._showObjective('THROUGH THE GATE', `Walk into the village — ${Math.round(distance)} m`);
        if (distance <= this.cfg.objectiveRadius) this._beginGateEntry();
        break;
      }

      case 'ending': {
        // The ending sweep runs itself (see _beginGateEntry); when it is done the black comes
        // down and the village is loaded behind it (loadLevel keeps the screen covered until
        // Level 3 is built, then fades back out onto it)
        if (this._gateEntryFade >= 0 && !this._chained) {
          this._gateEntryFade -= delta;
          if (this._gateEntryFade <= 0) {
            this._chained = true;
            this.gameWorld.loadLevel(this._nextLevel());
          }
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

  /**
   * The waves are broken; the survivors have gone to ground across the island. The hunt begins:
   * the map ([M]) shows them dim until they see the player, and the push inland resumes when the
   * last one is down.
   */
  _beginHunt() {
    this.state = 'hunt';
    this._setMusic('tense');
    this._holdoutsTotal = this._spawnHoldouts();
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showToast(`The survivors have gone to ground — ${this._holdoutsTotal} are still out there. Hunt them down (map: [M]).`, 'warning', 5000);
    }
  }

  /**
   * Deals each zone's garrison across that zone's posts, heavier units last - the beach is the
   * waves' business, so only the inland zones hold troops. They wait at their posts and never
   * push for the beach: the player has to come and find them.
   * @returns {number} How many found a spot (the hunt's count)
   */
  _spawnHoldouts() {
    const spread = this.cfg.holdouts.groupSpread;
    let placed = 0;
    for (const zone of this.cfg.zones) {
      const mix = zone.holdouts;
      if (!mix) continue; // The beach's garrison already broke on the sand (the waves)
      const posts = HOLDOUT_POSTS.filter((post) => post.zone === zone.id);
      const roster = [];
      for (let i = 0; i < (mix.trooper || 0); i++) roster.push('trooper');
      for (let i = 0; i < (mix.brute || 0); i++) roster.push('brute');
      roster.forEach((type, index) => {
        const post = posts[index % posts.length];
        const spot = this._findSpawnSpot(post, spread, spread);
        if (!spot) return; // A missed spot just thins the group; every post is verified clear ground
        this.createAlien(type, spot.x, spot.z);
        placed++;
      });
    }
    return placed;
  }

  /** The last stand: the group waiting in the rocks springs as the player comes up to the gate. */
  _startAmbush() {
    this.ambushTriggered = true;
    this.state = 'ambush';
    this.ambush.start();
    this._setMusic('combat');
    this._stingMusic('ambush');
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showToast('Ambush! They were waiting in the rocks — hold them off!', 'warning', 4000);
    }
  }

  // ---------------------------------------------------------------------------
  // The gate: the last fight of the beach
  // ---------------------------------------------------------------------------

  /**
   * The ambush broken, the gate shows what it really keeps: snipers on the watchtowers and the
   * ridge open up while the garrison pours out of the opening, and the gate walker follows when
   * its ranks are thinned. Clearing every last one opens the road into the village.
   */
  _startGateFight() {
    this.state = 'gate';
    this._setMusic('combat');
    this._stingMusic('ambush');

    this._gateUnits = [];
    this._gateGarrison = [];
    this._heavy = null;
    this._heavyDown = false;

    // The perches first: the glint and the lasers are the player's introduction to the gate
    const perches = this.gate.perches;
    const snipers = Math.min(this.cfg.gate.sniper, perches.length);
    for (let i = 0; i < snipers; i++) this._spawnGateUnit('sniper', perches[i]);

    // The garrison queues up behind the line (heavier units last) and pours out one at a time
    this._gateQueue = [];
    for (let i = 0; i < this.cfg.gate.trooper; i++) this._gateQueue.push('trooper');
    for (let i = 0; i < this.cfg.gate.brute; i++) this._gateQueue.push('brute');
    this._gateSpawnTimer = 0; // The first out of the opening comes straight away
    this._gatePostIndex = 0;

    if (this.gameWorld.ui) {
      this.gameWorld.ui.showToast('The gate opens — snipers on the towers!', 'warning', 4000);
    }
  }

  /** Phase 5 of the gate fight: the garrison queue, the walker, and its health bar. */
  _updateGateFight(delta) {
    const ui = this.gameWorld.ui;

    // The garrison pours out, one at a time to its own post
    if (this._gateQueue.length > 0) {
      this._gateSpawnTimer -= delta;
      if (this._gateSpawnTimer <= 0) {
        this._gateSpawnTimer = this.cfg.gate.spawnIntervalSeconds;
        const post = this.gate.defensePosts[this._gatePostIndex % this.gate.defensePosts.length];
        this._gatePostIndex += 1;
        const unit = this._spawnGateUnit(this._gateQueue.shift(), post);
        if (unit) unit.assault(this.gate.approach);
      }
    }

    // Down to a handful of rank and file: the walker steps out of the opening
    if (!this._heavy && this._gateQueue.length === 0 && this._gateGarrisonAlive() <= this.cfg.gate.heavyAt) {
      this._spawnHeavy();
    }
    if (this._heavy && !this._heavyDown) {
      if (this._heavy.isDead) {
        this._heavyDown = true;
        if (ui) ui.hideBossHealth();
        this._playKillCam(); // The fall gets a beat of its own (its own title card, not a toast)
      } else if (ui) {
        ui.updateBossHealth(this._heavy.health.currentHealth, this._heavy.health.maxHealth);
      }
    }

    // Every last one down and the whole queue spent: the gate is clear and the village road
    // stands open (the queue gate stops a fast start from clearing before the guard has poured)
    if (this._gateUnits.length > 0 && this._gateQueue.length === 0 && this._gateUnits.every((unit) => unit.isDead)) {
      this.state = 'clear';
      if (ui) {
        if (this._heavy) ui.hideBossHealth();
        ui.showToast('The gate is clear — walk through!', 'success', 4000);
      }
      this._setMusic('tense');
    }
  }

  /** One gate-guard unit at its post (or perch), tracked for the fight's end. */
  _spawnGateUnit(type, spot) {
    const unit = this.createAlien(type, spot.x, spot.z, spot.y);
    this._gateUnits.push(unit);
    if (type === 'trooper' || type === 'brute') this._gateGarrison.push(unit);
    return unit;
  }

  /** The gate walker: the finale's own, out of the opening, with its bar up while it stands. */
  _spawnHeavy() {
    this._heavy = this._spawnGateUnit('heavy', this.gate.heavySpawn);
    this._heavy.assault(this.gate.approach);
    const ui = this.gameWorld.ui;
    if (ui) {
      // The red alien uses an overhead bar; the large boss panel belongs to the hall Warden.
      ui.showToast('The gate walker comes out!', 'danger', 4000);
    }
  }

  /**
   * The walker goes down: a short kill-cam — the fall seen low from its flank, then closer as it
   * settles — and the view hands back to the player where they stand (skippable like any sweep).
   * The corpse is the ragdoll body, so the camera rides it as it topples.
   */
  _playKillCam() {
    if (this.killCam || !this._heavy || !this._heavy.mesh) return;
    const corpse = this._heavy;
    const x = corpse.position.x, y = corpse.position.y, z = corpse.position.z;
    this.killCam = new LandingCinematic(this.gameWorld, {
      player: this.player,
      title: 'THE GATE WALKER FALLS',
      duration: KILL_CAM.duration,
      holdSeconds: KILL_CAM.holdSeconds,
      easing: 'inOut',
      focus: (out) => out.set(corpse.mesh.position.x, corpse.mesh.position.y + KILL_CAM.aimHeight, corpse.mesh.position.z),
      aimTowards: 0, // Straight at the corpse: the fall's own aim, not the landing's lean
      flightPath: [
        // On the flank as it comes down
        new THREE.Vector3(x - KILL_CAM.firstDistance, y + KILL_CAM.firstHeight, z + KILL_CAM.firstDistance * 0.6),
        // Down and closer, at the corpse's level, as it settles
        new THREE.Vector3(x - KILL_CAM.closeDistance, y + KILL_CAM.closeHeight, z + KILL_CAM.closeDistance * 0.3)
      ]
    });
    this.gameWorld.addEntity(this.killCam);
    this._stingMusic('impact');
  }

  /** How many of the gate guard are still standing. */
  _gateAlive() {
    let count = 0;
    for (const unit of this._gateUnits) if (!unit.isDead) count++;
    return count;
  }

  /** How many of the gate's rank and file are still standing (the walker not counted). */
  _gateGarrisonAlive() {
    let count = 0;
    for (const unit of this._gateGarrison) if (!unit.isDead) count++;
    return count;
  }

  // ---------------------------------------------------------------------------
  // The ending: through the gate, into the village (Level 3)
  // ---------------------------------------------------------------------------

  /**
   * The gate is clear and the squad steps through: the camera sweeps over the arch while the
   * player is marched up the village road (the squadmates follow on their own), then the screen
   * fades to black and Level 3 is loaded behind it — its own opening sweep plays out of the
   * black (see _nextLevel).
   */
  _beginGateEntry() {
    this.state = 'ending';
    this._setMusic('victory'); // The score lands the beach won, under the walk into the village

    const ui = this.gameWorld.ui;
    if (ui) {
      ui.hideObjective();
      ui.hideStatusIndicator();
      ui.hideMap();
      ui.hideMinimap(); // The ending owns the whole screen, corner chart included
    }

    const player = this.player;
    const env = this.environment;
    const centre = this.gate.centre;
    const start = player.position;

    // What the ending camera settles on: the village over the plateau, where the smoke rises
    const village = env.village;
    this._villageLook.set(village.x, village.height + 12, village.z + 20);

    // The scripted march: from wherever the squad stepped into the ring, onto the road centre
    // and up past the gate line onto the village road
    this._gateEntryWalk = this._buildGateEntryWalk(start);
    const walk = this._gateEntryWalk;
    const walkSeconds = walk ? walk.duration : 0;
    const hold = GATE_ENTRY.holdSeconds + GATE_ENTRY.walkDelay;
    if (walk) walk.startTime = hold;

    // The sweep must clear the gate's roofline: measured off the set piece itself
    const bounds = new THREE.Box3().setFromObject(this.gate.mesh);
    const roof = Number.isFinite(bounds.max.y) ? bounds.max.y : centre.y + 12;
    const endZ = walk ? walk.end.z : start.z - GATE_ENTRY.depth;
    const aheadZ = endZ - 18; // Down the road, past where the march ends
    const roadX = env.pathCentreX(aheadZ);

    // When the eye leaves the squad and runs up the road ahead of them
    const lookFrom = hold + Math.max(1.5, walkSeconds * GATE_ENTRY.lookShare[0]);
    const lookTo = hold + Math.max(3.0, walkSeconds * GATE_ENTRY.lookShare[1]);

    this.cinematic = new LandingCinematic(this.gameWorld, {
      player,
      title: 'THROUGH THE GATE',
      subtitle: "Into the village — the Warden's ground",
      duration: hold + walkSeconds + GATE_ENTRY.settleSeconds,
      holdSeconds: GATE_ENTRY.holdSeconds,
      easing: 'inOut',
      endOnPlayer: false, // The view stays on the village; the fade covers the swap from here
      flightPath: [
        // Behind the squad at the gate line, looking in through the opening
        new THREE.Vector3(start.x - 8, env.heightAt(start.x - 8, start.z + 12) + 8, start.z + 12),
        // Over the arch, well clear of its bladed roofline, as they pass under it
        new THREE.Vector3(centre.x - 3, roof + 6, centre.z),
        // Down onto the road ahead, running on the village
        new THREE.Vector3(roadX, env.heightAt(roadX, aheadZ) + 8, aheadZ)
      ],
      // Watch the squad step through, then hand the eye to the village up the road
      focus: (out) => {
        const elapsed = this.cinematic ? this.cinematic.elapsed : 0;
        return out.copy(player.position).lerp(this._villageLook, THREE.MathUtils.smoothstep(elapsed, lookFrom, lookTo));
      },
      aimPoint: this._villageLook,
      aimTowards: 0.25,
      onFrame: (t, elapsed) => this._walkIntoVillage(elapsed),
      onFinished: () => this._onGateEntryFinished()
    });
    this.gameWorld.addEntity(this.cinematic);
  }

  /**
   * The march up the village road: from wherever the squad stepped into the ring, onto the road
   * centre (pathCentreX) and past the gate line to the yard beyond it. Null when they are
   * already there (nothing left to march).
   * @param {THREE.Vector3} start - The player's feet
   */
  _buildGateEntryWalk(start) {
    const endZ = Math.min(start.z, this.gate.through.z - GATE_ENTRY.depth);
    const distance = start.z - endZ;
    if (distance < 1) return null;

    const points = [start.clone()];
    const steps = Math.ceil(distance / 2.5);
    for (let i = 1; i <= steps; i++) {
      const z = start.z - (distance * i) / steps;
      const x = this.environment.pathCentreX(z);
      points.push(new THREE.Vector3(x, this.environment.heightAt(x, z) + 0.1, z));
    }

    // Arc-length parametrised, so the pace stays even along the gentle curve onto the road
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    return {
      curve,
      startTime: 0, // Seconds into the sweep the first step lands (set by _beginGateEntry)
      duration: distance / GATE_ENTRY.walkSpeed,
      end: points[points.length - 1].clone()
    };
  }

  /**
   * The scripted march, driven from the ending sweep's clock: the player is moved up the road at
   * a walking pace — they glide exactly as they do in play (the avatar has no stride) — and the
   * squadmates follow on their own, so the whole squad walks in together.
   * @param {number} elapsed - Seconds into the sweep
   */
  _walkIntoVillage(elapsed) {
    const walk = this._gateEntryWalk;
    if (!walk || elapsed < walk.startTime) return;

    const u = Math.min(1, (elapsed - walk.startTime) / walk.duration);
    walk.curve.getPointAt(u, this._walkPoint);
    this.player.teleport(this._walkPoint.x, this._walkPoint.y, this._walkPoint.z);

    // Face the way the march runs (yaw 0 looks down -Z, inland)
    walk.curve.getTangentAt(u, this._walkTangent);
    const yaw = Math.atan2(-this._walkTangent.x, -this._walkTangent.z);
    this.player.yaw = yaw;
    this.player.mesh.rotation.y = yaw;
  }

  /**
   * The ending sweep is over (or skipped): fade to black. The countdown in the 'ending' state
   * hands over to Level 3 once the screen is covered.
   */
  _onGateEntryFinished() {
    if (this._gateEntryDone) return;
    this._gateEntryDone = true;
    if (this.gameWorld.ui) this.gameWorld.ui.showFade();
    this._gateEntryFade = GATE_ENTRY.fadeSeconds;
  }

  /**
   * The stage the beach hands over to: the village at night. Level 3 opens out of the black
   * with its own sweep (the hall, the village, and down to the gate where its squad stands).
   */
  _nextLevel() {
    return new Level03(this.gameWorld);
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
  // The island's zones
  // ---------------------------------------------------------------------------

  /** The zone the player stands in now: the last inland line they have crossed (see `zones`). */
  _currentZone() {
    const zones = this.cfg.zones;
    const z = this.player.position.z;
    for (let i = zones.length - 1; i >= 1; i--) {
      if (z <= zones[i].inlandFrom) return zones[i];
    }
    return zones[0];
  }

  /**
   * Names the ground the first time the player is ashore, and again whenever they cross into a
   * new zone; the ambient mix follows (the surf fades inland, the island grows louder), and each
   * zone's ambient clocks start on their own first delays.
   */
  _updateZones() {
    if (!this._isPlayerAshore()) return;
    const zone = this._currentZone();
    if (zone === this._zone) return;
    this._zone = zone;
    this._checkpoint.copy(this.player.position);
    const ui = this.gameWorld.ui;
    if (ui) ui.showToast(`${zone.name.toUpperCase()} — ${ZONE_FLAVOUR[zone.id]}`, 'info', 4000);
    const music = this.gameWorld.music;
    if (music && ZONE_AMBIENCE[zone.id]) music.setAmbience(ZONE_AMBIENCE[zone.id]);
    const life = AMBIENT_LIFE[zone.id];
    if (life) {
      this._ambient.explosion = life.explosion ? life.explosion[0] : Infinity;
      this._ambient.call = life.call ? life.call[0] : Infinity;
    }
  }

  /**
   * Ambient life: the war inland (a distant explosion, flat and far off) and alien calls placed
   * out in the trees around the player, each on its zone's own clock (see AMBIENT_LIFE). The
   * beach hears the surf; the further in, the louder the island gets.
   */
  _updateAmbientLife(delta) {
    if (!this._zone || this.state === 'won' || this.state === 'lost') return;
    const life = AMBIENT_LIFE[this._zone.id];
    if (!life) return;
    const audio = this.gameWorld.audio;

    if (life.explosion) {
      this._ambient.explosion -= delta;
      if (this._ambient.explosion <= 0) {
        const [min, max] = life.explosion;
        this._ambient.explosion = min + Math.random() * (max - min);
        if (audio) audio.play('explosion', null, DISTANT_EXPLOSION_VOLUME);
      }
    }

    if (life.call) {
      this._ambient.call -= delta;
      if (this._ambient.call <= 0) {
        const [min, max] = life.call;
        this._ambient.call = min + Math.random() * (max - min);
        const p = this.player.position;
        const angle = Math.random() * Math.PI * 2;
        const distance = ALIEN_CALL_MIN_DISTANCE + Math.random() * (ALIEN_CALL_MAX_DISTANCE - ALIEN_CALL_MIN_DISTANCE);
        this._ambientPoint.set(p.x + Math.sin(angle) * distance, p.y, p.z + Math.cos(angle) * distance);
        if (audio) audio.play('alienCall', this._ambientPoint, life.callVolume);
      }
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
    // String lanes are the beach's own five; a lane object is passed in directly (the gate
    // ambush's posts on the ridges are not on the beach grid)
    const base = typeof laneName === 'string' ? (LANES[laneName] || LANES.centre) : laneName;
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
  _findSpawnSpot(centre, spreadX = SPAWN_SPREAD_X, spreadZ = SPAWN_SPREAD_Z) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = centre.x + (Math.random() - 0.5) * 2 * spreadX;
      const z = centre.z + (Math.random() - 0.5) * 2 * spreadZ;
      if (this.environment.heightAt(x, z) > 0.6 && this.cover.isClearOfSolids(x, z, 1.2)) return { x, z };
    }
    return null;
  }

  dispose() {
    this._setMusic('silent'); // The score goes quiet with the level (menu, restart, another stage)
    this.waves = null;
    this.ambush = null;
    this._zone = null;
    this._gateUnits = [];
    this._gateGarrison = [];
    this._gateQueue = [];
    this._heavy = null;
    this.supplyCrate = null; // Entities: the GameWorld disposes them
    if (this.intel) this.intel.dispose();
    this.intel = null;
    // A defeat mid-gate-fight leaves the walker's bar up otherwise (the result screen overlays it)
    if (this.gameWorld && this.gameWorld.ui) this.gameWorld.ui.hideBossHealth();
    super.dispose(); // Also the destructible cover, the landing zone, the wreckage, the smoke, the gate and the beacon (tracked)
    this.beacon = null;
    this.landingZone = null;
    this.wreckage = null;
    this.gate = null;
    this.destructibleCover = null;
  }
}
