import * as THREE from 'three';
import { IslandLevel, CREW_NAMES } from './IslandLevel.js';
import { Village } from './level03/Village.js';
import { BossArena } from './level03/BossArena.js';
import { ForceFieldDome, ForceFieldWall } from './level03/ForceFieldDome.js';
import { ShieldGenerator } from './level03/ShieldGenerator.js';
import { AlienSpawner } from './level03/AlienSpawner.js';
import { RevivePoint } from './level03/RevivePoint.js';
import { HostageCage } from './level03/HostageCage.js';
import { ShieldPickup } from './level03/ShieldPickup.js';
import { PlayerShield } from '../entities/player-components/PlayerShield.js';
import { createRandom } from '../rendering/Noise.js';
import { CREDITS } from './level03/credits.js';
import { LandingCinematic } from './level02/LandingCinematic.js';
import { SupplyCrate } from './level02/SupplyCrate.js';
import config from '../config.json';

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const DOME_RADIUS = 22;      // The force field covers the hall and a little of the ground round it
const GUARD_DISTANCE = 6;    // Generator guards start this far from their generator
const GUARD_POST_TRIES = 30; // Attempts to find each hall guard a post
const HOSTAGE_NAMES = ['Ama', 'Tomas', 'Lena', 'Kofi'];
const OPENING_SECONDS = 16;
const OPENING_HOLD = 4;        // Seconds on the Warden and its prisoners before the camera leaves the hall
const CRATE_NEAR = 15;         // A revive point gets its own supply crate unless one is this close
const CRATE_OFFSET = 2.5;      // ...standing this far from the post
const PICKUP_SEED = 77;        // Shield pickups lie in the same places every time
const PICKUP_SPACING = 40;     // ...at least this far apart
const PICKUP_START_CLEAR = 30; // ...and not right at the start
const ENDING_SECONDS = 12;
const CREDITS_SECONDS = 24;
const CREDITS_SKIP_AFTER = 0.5; // The key that skipped the ending must not skip the credits too

/**
 * Level03
 * Level 3: The Village. The finale, at night: the squad comes up the jungle path to the village
 * on the plateau at the island's far end, fights through its streets to the square, brings down
 * the force field over the hall, defeats the Warden inside and frees the hostages.
 *
 * Built in phases. So far:
 * - 'generators': once the player is in the village, aliens keep coming at them from every
 *   direction (an AlienSpawner round the player). Three generators (ShieldGenerator, by three of
 *   the landed ships) feed the force field over the hall (ForceFieldDome); each has guards, and
 *   while it runs and the player is near, more aliens keep coming to defend it. Hold [E] to shut
 *   each one down.
 * - 'guards' (wave 2): the dome falls, but the hall's door is sealed (ForceFieldWall) and its
 *   guards take up posts round it, while more keep appearing beside the hall on both sides.
 *   Kill `hallWave.killsToOpen` of them and the seal breaks (and no more come).
 * - 'hall' -> 'boss': into the hall, where the Warden wakes (BossArena).
 * - 'victory' -> 'hostages': with the Warden down every alien falls, and the islanders' cages
 *   (HostageCage) along the hall walls unlock: hold [E] at each to free them.
 * - 'ending' -> 'credits' -> won: the camera sweeps out of the hall and up over the village while
 *   night turns to dawn (BeachEnvironment.blendLook), the credits roll, then the mission result.
 * It opens with a camera sweep over the village (LandingCinematic) that ends behind the player.
 * Up to five revive points (RevivePoint) along the way, each with a supply crate: lost, the player
 * comes back at the last one reached (with the squad), rather than failing, and the aliens lose
 * track of them (they wander off, and none arrive for a while). Shield pickups (ShieldPickup)
 * lie in the streets: each charges the player's PlayerShield, which takes hits until it breaks.
 * The Warden stands in the hall, dormant among the caged islanders, from the start. On-foot
 * combat, downed and revive come from IslandLevel.
 *
 * Level03TestLevel extends this with a respawning alien group and the sandbox dev tools.
 */
export class Level03 extends IslandLevel {
  constructor(gameWorld, name = 'Level 3: The Village') {
    super(gameWorld, name);
    this.cfg = config.levels.level03;
    this.village = null;
    this.supplyCrate = null;
    this.hallCrate = null;
    this.dome = null;
    this.doorSeal = null;
    this.generators = [];
    this.revivePoints = [];
    this.lastRevivePoint = null;
    this.streetAliens = null;       // AlienSpawner round the player
    this.generatorDefenses = [];    // AlienSpawner round each generator
    this.hallGuards = [];           // Wave 2: the guards it starts with
    this.hallSpawners = [];         // Wave 2: aliens appearing beside the hall, both sides
    this._waveStartKills = 0;
    this.cages = [];
    this.reviveCrates = [];
    this.shield = null;
    this.shieldPickups = [];
    this.arena = null;
    this._respiteTimer = 0;
    this.state = 'generators'; // generators -> guards -> hall -> boss -> victory -> hostages -> ending -> credits (-> won)
    this._creditsTimer = 0;
    this._victoryTimer = 0;
    this._skipHallWave = false;
  }

  // ---------------------------------------------------------------------------
  // IslandLevel hooks
  // ---------------------------------------------------------------------------

  /** Night, on the island with the big village; the moon's shadows follow the camera round it. */
  _environmentOptions() {
    return { look: 'night', layout: 'village', shadowCentre: new THREE.Vector3(0, 12, -400), shadowHalfExtent: 120, shadowFollowsCamera: true };
  }

  /** Trees around the village cast shadows; the rest of the island does not. */
  _coverOptions() {
    return { castsShadow: (x, z) => z < -110 };
  }

  async _buildWorld() {
    this.village = this.trackDisposable(new Village(this.gameWorld, this.environment));
    this.village.build();
    const hall = this.village.hall;
    this.dome = this.trackDisposable(new ForceFieldDome(this.gameWorld, { centre: hall.centre, radius: DOME_RADIUS }));
    this.dome.build();
    this.doorSeal = this.trackDisposable(new ForceFieldWall(this.gameWorld, {
      centre: hall.doorway, yaw: hall.yaw, width: hall.entranceWidth + 0.4, height: hall.entranceHeight + 0.3
    }));
    this.doorSeal.build();
  }

  _clearings() {
    return this.village.clearings;
  }

  /** On the jungle path just below the village gate, facing in. */
  _playerSpawn() {
    return { position: this.village.spawnPoints.start, yaw: 0 };
  }

  /**
   * Supply crates the helicopters dropped (by the gate, and just inside the hall door), the
   * generators, and the revive points.
   */
  _createProps() {
    this.supplyCrate = new SupplyCrate(this.gameWorld, {
      position: this.village.spawnPoints.supplyCrate,
      player: this.player,
      weapons: this.weapons
    });
    this.gameWorld.addEntity(this.supplyCrate);
    this.hallCrate = new SupplyCrate(this.gameWorld, {
      position: this.village.hall.supplyPoint,
      player: this.player,
      weapons: this.weapons
    });
    this.gameWorld.addEntity(this.hallCrate);

    // The generators that feed the force field, their beams running up to the top of the dome
    this.generators = this.village.generatorSpots.map(({ name, position }) => {
      const generator = new ShieldGenerator(this.gameWorld, {
        name,
        position,
        player: this.player,
        beamTarget: this.dome.top,
        onShutDown: (g) => this._onGeneratorShutDown(g)
      });
      this.gameWorld.addEntity(generator);
      return generator;
    });

    // The islanders the aliens caged in the hall, facing its middle
    const hall = this.village.hall;
    this.cages = hall.cageSpots.map((position, i) => {
      const cage = new HostageCage(this.gameWorld, {
        name: HOSTAGE_NAMES[i % HOSTAGE_NAMES.length],
        position,
        yaw: Math.atan2(position.x - hall.centre.x, position.z - hall.centre.z),
        player: this.player,
        onFreed: (c) => this._onHostageFreed(c)
      });
      this.gameWorld.addEntity(cage);
      return cage;
    });

    this.revivePoints = this._revivePointSpots().map(({ name, position, canReach }) => {
      const point = new RevivePoint(this.gameWorld, {
        name,
        position,
        player: this.player,
        radius: this.cfg.revivePointRadius,
        canReach,
        onReached: (p) => this._onRevivePointReached(p)
      });
      this.gameWorld.addEntity(point);
      return point;
    });

    // A supply crate by every revive point (ammo runs out), unless there is one close already
    const crates = [this.supplyCrate, this.hallCrate];
    for (const point of this.revivePoints) {
      if (crates.some((crate) => flat(crate.position, point.position) < CRATE_NEAR)) continue;
      const spot = this._besidePoint(point.position);
      if (!spot) continue;
      const crate = new SupplyCrate(this.gameWorld, { position: spot, player: this.player, weapons: this.weapons });
      this.gameWorld.addEntity(crate);
      crates.push(crate);
      this.reviveCrates.push(crate);
    }

    // The player's shield (none until they pick one up) and the pickups lying in the streets
    this.shield = new PlayerShield(this.gameWorld, { player: this.player, maxHealth: this.cfg.shield.health });
    this.gameWorld.addEntity(this.shield);
    this.shieldPickups = this._shieldPickupSpots().map((position) => {
      const pickup = new ShieldPickup(this.gameWorld, { position, player: this.player, shield: this.shield, radius: this.cfg.shield.pickupRadius });
      this.gameWorld.addEntity(pickup);
      return pickup;
    });

    // The Warden waits in the hall among its prisoners
    this.arena = this.trackDisposable(new BossArena(this, hall, { onDefeated: () => this._onWardenDefeated() }));
    this.arena.place();
  }

  /** Open ground a couple of meters from `point` (for a crate beside a revive point). */
  _besidePoint(point) {
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const x = point.x + Math.cos(angle) * CRATE_OFFSET;
      const z = point.z + Math.sin(angle) * CRATE_OFFSET;
      if (this._isWalkable(x, z) && !this.village.hall.contains(x, z) === !this.village.hall.contains(point.x, point.z)) {
        return new THREE.Vector3(x, this.environment.heightAt(x, z), z);
      }
    }
    return null;
  }

  /** Spots along the streets, spread out, for the shield pickups (the same every time). */
  _shieldPickupSpots() {
    const random = createRandom(PICKUP_SEED);
    const streets = this.village.streets;
    const start = this.village.spawnPoints.start;
    const spots = [];
    for (let attempt = 0; attempt < 400 && spots.length < this.cfg.shield.pickups; attempt++) {
      const street = streets[Math.floor(random() * streets.length)];
      const t = random();
      const x = street.from.x + (street.to.x - street.from.x) * t;
      const z = street.from.z + (street.to.z - street.from.z) * t;
      if (flat({ x, z }, start) < PICKUP_START_CLEAR || !this._isWalkable(x, z)) continue;
      if (spots.some((s) => flat(s, { x, z }) < PICKUP_SPACING)) continue;
      spots.push(new THREE.Vector3(x, this.environment.heightAt(x, z), z));
    }
    return spots;
  }

  /**
   * Five revive points along the way: inside the gate, by the west and east generators (on the
   * nearest street), on the square, and just inside the hall door (for the Warden).
   */
  _revivePointSpots() {
    const { village } = this;
    const { gate, square, hall } = village;
    const onGround = (x, z) => new THREE.Vector3(x, this.environment.heightAt(x, z), z);
    const spots = [{ name: 'the village gate', position: onGround(gate.x - 3, gate.z - 12) }];
    for (const generator of this.generators.slice(0, 2)) {
      const spot = village.streetSpotNear(generator.position.x, generator.position.z);
      spots.push({ name: `the ${generator.name.toLowerCase()}`, position: onGround(spot.x, spot.z) });
    }
    spots.push({ name: 'the square', position: onGround(square.x - 12, square.z + 12) });
    const inside = hall.doorway.clone().addScaledVector(hall.forward, -3);
    const across = new THREE.Vector3(hall.forward.z, 0, -hall.forward.x);
    // Only from inside: never bring the player back behind the sealed door
    const p = this.player.position;
    spots.push({ name: 'the hall', position: onGround(inside.x + across.x * 4.5, inside.z + across.z * 4.5), canReach: () => hall.contains(p.x, p.z) });
    return spots.slice(0, 5);
  }

  _resultText(victory) {
    if (victory) {
      return { title: 'THE ISLAND IS OURS AGAIN', message: 'The Warden is gone and our people are free.' };
    }
    return {
      title: 'MISSION FAILED',
      message: this.allies && this.allies.aliveMates === 0
        ? 'Your whole squad went down in the village.'
        : 'You bled out before help could reach you.'
    };
  }

  _lowHealthHint() {
    return 'Low health! Patch up at a supply crate [E]: by the village gate, or just inside the hall door.';
  }

  /** Not inside a house, a wall, under a ship's leg or in the force field either. */
  _isWalkable(x, z) {
    if (this.dome && this.dome.blocks(x, z, 1)) return false;
    return super._isWalkable(x, z) && (!this.village || this.village.isOpenGround(x, z, 0.8));
  }

  /** The force fields shimmer (and collapse) every frame. */
  _updateWorld(delta) {
    if (this.dome) this.dome.update(delta);
    if (this.doorSeal) this.doorSeal.update(delta);
  }

  /**
   * Lost (bled out, or nobody left to come): back on their feet at the last revive point reached
   * (or the start, before the first), with the squad regrouping there. The aliens lose track of
   * them: those nearby wander off away from the spot, and none arrive for a while.
   */
  _onPlayerKilled(delta) {
    const point = this.lastRevivePoint;
    const back = this._respawnPlayer(delta, () => (point ? point.respawnPosition : this.village.spawnPoints.start),
      'YOU WENT DOWN: back to the last revive point...');
    if (!back) return;
    const p = this.player.position;
    this.allies.mates.forEach((mate, i) => {
      if (mate.isDead) return;
      const angle = (i / Math.max(1, this.allies.mates.length)) * Math.PI * 2;
      const x = p.x + Math.cos(angle) * 3;
      const z = p.z + Math.sin(angle) * 3;
      mate.teleport(x, this.environment.heightAt(x, z) + 0.1, z);
    });
    this.confuseAliens(p);
    if (this.gameWorld.ui) this.gameWorld.ui.showToast(`Back on your feet at ${point ? point.name : 'the start'}. They have lost you: catch your breath.`, 'info', 3500);
  }

  /**
   * The aliens lose the player: every one forgets them, and those within `confusionRadius` of
   * `point` wander off away from it. No new aliens come for `respiteSeconds`.
   */
  confuseAliens(point) {
    const respawn = this.cfg.respawn;
    this._respiteTimer = respawn.respiteSeconds;
    for (const alien of this.squad.members) {
      if (alien.isDead || alien.isBoss) continue;
      const dx = alien.position.x - point.x;
      const dz = alien.position.z - point.z;
      const distance = Math.hypot(dx, dz);
      if (distance > respawn.confusionRadius) {
        alien.perception.forget();
        continue;
      }
      const away = distance > 0.1 ? respawn.wanderDistance / distance : 0;
      const x = alien.position.x + dx * away;
      const z = alien.position.z + dz * away;
      alien.wanderOff(new THREE.Vector3(x, this.environment.heightAt(x, z), z));
    }
  }

  /** Takes every alien but the Warden away, and stops more coming (dev tools, tests). */
  clearAliens() {
    this._stopDefenses();
    for (const alien of [...this.squad.members]) if (!alien.isBoss) this.squad.remove(alien);
  }

  _onRevivePointReached(point) {
    this.lastRevivePoint = point;
    if (this.gameWorld.ui) this.gameWorld.ui.showToast(`Revive point reached: ${point.name}. If you fall, you come back here.`, 'success', 3500);
  }

  // ---------------------------------------------------------------------------
  // Scenario
  // ---------------------------------------------------------------------------

  async _startScenario() {
    this.spawnCrew();
    this.setUpDefenses();
    this._showGeneratorObjective();
    this._beginOpening();
  }

  /**
   * The opening: inside the hall, the Warden standing among its caged prisoners; then out of the
   * door and up high over the village (the dome, the beams, the streets), and down over the
   * rooftops to the gate, ending behind the player on the jungle path.
   */
  _beginOpening() {
    const { hall, gate } = this.village;
    const f = hall.forward;
    const warden = this.arena.warden;
    const wardenChest = new THREE.Vector3(warden.position.x, warden.position.y + 3, warden.position.z);
    const village = this.environment.village;
    const middle = new THREE.Vector3(village.x, village.height, village.z + 60);
    const gatePoint = new THREE.Vector3(gate.x, this.environment.heightAt(gate.x, gate.z) + 2, gate.z);
    const turn = (t) => t * t * (3 - 2 * t);
    const stage = (t, from, to) => turn(Math.min(1, Math.max(0, (t - from) / (to - from))));
    const focus = (out) => {
      const t = (this.cinematic ? this.cinematic.elapsed : 0) / OPENING_SECONDS;
      out.lerpVectors(wardenChest, middle, stage(t, 0.32, 0.55));
      return out.lerp(gatePoint, stage(t, 0.68, 0.88));
    };
    this.cinematic = new LandingCinematic(this.gameWorld, {
      player: this.player,
      title: 'THE VILLAGE',
      subtitle: 'The Warden holds our people in the hall. Bring down its force field and free them.',
      duration: OPENING_SECONDS,
      easing: 'inOut',
      holdSeconds: OPENING_HOLD,
      flightPath: [
        new THREE.Vector3(hall.doorway.x - f.x * 3, hall.doorway.y + 3.2, hall.doorway.z - f.z * 3),
        new THREE.Vector3(hall.doorway.x + f.x * 8, hall.doorway.y + 8, hall.doorway.z + f.z * 8),
        new THREE.Vector3(hall.centre.x + 40 + f.x * 70, hall.centre.y + 200, hall.centre.z + f.z * 70),
        new THREE.Vector3(25, 150, -300),
        new THREE.Vector3(gate.x - 6, gatePoint.y + 6, gate.z + 12)
      ],
      defaultFocus: wardenChest,
      aimTowards: 0,
      focus
    });
    this.gameWorld.addEntity(this.cinematic);
  }

  /** The crew, just behind the player on the path, following at once. */
  spawnCrew() {
    for (let i = 0; i < this.aiCrewCount; i++) {
      const position = this.village.spawnPoints.squad[i % this.village.spawnPoints.squad.length];
      const mate = this.spawnSquadMate(CREW_NAMES[i % CREW_NAMES.length], position);
      mate.yaw = 0;
    }
    this.allies.followLeader();
  }

  /**
   * The aliens holding the village: guards at every generator, more coming to defend each one
   * while it runs and the player is near, and more coming at the player from every direction
   * once they are in the village. None of them ever run out until the generators are down.
   */
  setUpDefenses() {
    const cap = () => this._respiteTimer <= 0 && this.squad.aliveCount < this.cfg.maxAliveAliens;
    const generatorCfg = this.cfg.generatorDefense;
    this.generatorDefenses = this.generators.map((generator) => {
      const defense = new AlienSpawner(this, {
        centre: () => generator.position,
        maxAlive: generatorCfg.maxAlive,
        interval: generatorCfg.reinforceSeconds,
        minDistance: generatorCfg.spawnMinDistance,
        maxDistance: generatorCfg.spawnMaxDistance,
        minPlayerDistance: this.cfg.spawnMinPlayerDistance,
        bruteChance: generatorCfg.bruteChance,
        isActive: () => !generator.isShutDown && this._playerWithin(generator.position, generatorCfg.activeRange),
        canSpawn: cap
      });
      for (let i = 0; i < generatorCfg.guards; i++) {
        const angle = (i / generatorCfg.guards) * Math.PI * 2 + 0.6;
        const x = generator.position.x + Math.cos(angle) * GUARD_DISTANCE;
        const z = generator.position.z + Math.sin(angle) * GUARD_DISTANCE;
        defense.adopt(this.createAlien('trooper', x, z));
      }
      return defense;
    });

    const streetCfg = this.cfg.streetAliens;
    this.streetAliens = new AlienSpawner(this, {
      centre: () => this.player.position,
      target: () => this.player.position,
      maxAlive: streetCfg.maxAlive,
      interval: streetCfg.reinforceSeconds,
      minDistance: streetCfg.spawnMinDistance,
      maxDistance: streetCfg.spawnMaxDistance,
      minPlayerDistance: this.cfg.spawnMinPlayerDistance,
      bruteChance: streetCfg.bruteChance,
      isActive: () => !this.player.health.isDead && this.environment.isInVillage(this.player.position.x, this.player.position.z),
      canSpawn: cap
    });
  }

  _playerWithin(point, distance) {
    const p = this.player.position;
    return Math.hypot(p.x - point.x, p.z - point.z) <= distance;
  }

  _updateDefenses(delta) {
    for (const defense of this.generatorDefenses) defense.update(delta);
    if (this.streetAliens) this.streetAliens.update(delta);
  }

  _stopDefenses() {
    for (const defense of this.generatorDefenses) defense.stop();
    if (this.streetAliens) this.streetAliens.stop();
    for (const spawner of this.hallSpawners) spawner.stop();
  }

  _updateScenario(delta) {
    const hall = this.village.hall;
    const p = this.player.position;
    if (this._respiteTimer > 0) this._respiteTimer -= delta;
    switch (this.state) {
      case 'generators':
        this._updateDefenses(delta);
        this._showGeneratorObjective();
        break;
      case 'guards':
        this._updateHallWave(delta);
        break;
      case 'hall': {
        const distance = Math.hypot(p.x - hall.doorway.x, p.z - hall.doorway.z);
        this._showObjective('THE HALL', `The way in is open. Get inside the hall — ${Math.round(distance)} m`);
        if (hall.contains(p.x, p.z)) this.startBossFight();
        break;
      }
      case 'boss':
        this.arena.update(delta);
        if (this.state === 'boss') this._showBossObjective();
        break;
      case 'victory':
        this._victoryTimer -= delta;
        if (this._victoryTimer <= 0) this._startHostages();
        break;
      case 'hostages':
        this._showHostageObjective();
        break;
      case 'ending':
        this.environment.blendLook('night', 'dawn', this.cinematic ? this.cinematic.elapsed / ENDING_SECONDS : 1);
        break;
      case 'credits':
        this._creditsTimer += delta;
        if (this._creditsTimer >= CREDITS_SECONDS ||
          (this._creditsTimer >= CREDITS_SKIP_AFTER && this.gameWorld.input.isActionJustPressed('skipCutscene'))) {
          if (this.gameWorld.ui) this.gameWorld.ui.hideCredits();
          this._finish(true);
        }
        break;
    }
  }

  /** How many generators are down, and how far the nearest one still running is. */
  _showGeneratorObjective() {
    const running = this.generators.filter((g) => !g.isShutDown);
    const down = this.generators.length - running.length;
    const p = this.player.position;
    let nearest = Infinity;
    for (const g of running) nearest = Math.min(nearest, Math.hypot(p.x - g.position.x, p.z - g.position.z));
    this._showObjective('OBJECTIVE',
      `A force field covers the hall. Shut down its generators (follow the beams) — ${down}/${this.generators.length}, nearest ${Math.round(nearest)} m`);
  }

  _onGeneratorShutDown(generator) {
    const index = this.generators.indexOf(generator);
    if (this.generatorDefenses[index]) this.generatorDefenses[index].stop();
    const left = this.generators.filter((g) => !g.isShutDown).length;
    const ui = this.gameWorld.ui;
    if (left > 0) {
      if (ui) ui.showToast(`${generator.name} is down: no more aliens coming to it. ${left} to go.`, 'success', 3000);
      return;
    }

    this._stopDefenses();
    if (this._skipHallWave) {
      this.dome.collapse({ instant: true });
      if (this.state === 'generators') this.state = 'hall';
      return;
    }
    this.dome.collapse();
    this._startHallWave();
    if (ui) ui.showToast('WAVE 2! The force field is down, but the hall is sealed and its guards are coming out!', 'danger', 4500);
  }

  /**
   * Shuts every generator down at once. `instant` skips wave 2 as well: the dome just vanishes and
   * the way into the hall is open (dev tools, tests).
   */
  shutDownGenerators({ instant = false } = {}) {
    this._skipHallWave = instant;
    for (const generator of this.generators) generator.shutDown();
    this._skipHallWave = false;
  }

  /**
   * Wave 2: the hall's door is sealed, and its guards take up posts round the door and the
   * square. The aliens still about fall back to guard it too; fresh ones (the brutes first) make
   * up the starting guard. From then on more keep appearing beside the hall, on both sides, until
   * enough have been killed to break the seal.
   */
  _startHallWave() {
    this.state = 'guards';
    this.doorSeal.raise();
    this._waveStartKills = this.squad.killCount;
    const wave = this.cfg.hallWave;
    const hall = this.village.hall;
    const across = new THREE.Vector3(hall.forward.z, 0, -hall.forward.x);
    const cap = () => this._respiteTimer <= 0 && this.squad.aliveCount < this.cfg.maxAliveAliens;
    this.hallSpawners = [-1, 1].map((side) => {
      const centre = hall.centre.clone().addScaledVector(across, side * (hall.width / 2 + wave.sideDistance));
      return new AlienSpawner(this, {
        centre: () => centre,
        target: () => hall.entrance,
        maxAlive: wave.sideMaxAlive,
        interval: wave.reinforceSeconds,
        minDistance: 0,
        maxDistance: wave.spawnSpread,
        minPlayerDistance: wave.minPlayerDistance,
        bruteChance: wave.bruteChance,
        canSpawn: cap
      });
    });
    this.hallGuards = this.squad.members.filter((alien) => !alien.isDead && !alien.isBoss);
    for (const alien of this.hallGuards) {
      const post = this._hallGuardPost();
      if (post) alien.assault(new THREE.Vector3(post.x, this.environment.heightAt(post.x, post.z), post.z));
    }
    const fresh = Math.max(0, wave.troopers + wave.brutes - this.hallGuards.length);
    for (let i = 0; i < fresh; i++) {
      const post = this._hallGuardPost();
      if (post) this.hallGuards.push(this.createAlien(i < wave.brutes ? 'brute' : 'trooper', post.x, post.z));
    }
    this._updateHallWave();
  }

  /** A post in front of the hall door (towards the square), on open ground. */
  _hallGuardPost() {
    const { hall } = this.village;
    const wave = this.cfg.hallWave;
    const facing = Math.atan2(hall.forward.x, hall.forward.z);
    for (let i = 0; i < GUARD_POST_TRIES; i++) {
      const angle = facing + (Math.random() - 0.5) * Math.PI * 1.2;
      const distance = wave.postMinDistance + Math.random() * (wave.postMaxDistance - wave.postMinDistance);
      const x = hall.entrance.x + Math.sin(angle) * distance;
      const z = hall.entrance.z + Math.cos(angle) * distance;
      if (!hall.contains(x, z) && this._isWalkable(x, z)) return { x, z };
    }
    return null;
  }

  /** Wave 2 kills so far. */
  get hallWaveKills() {
    return this.squad.killCount - this._waveStartKills;
  }

  /**
   * More aliens beside the hall; the seal on the door breaks once `killsToOpen` have been killed
   * since wave 2 began (and then no more come).
   */
  _updateHallWave(delta = 0) {
    for (const spawner of this.hallSpawners) spawner.update(delta);
    const target = this.cfg.hallWave.killsToOpen;
    const kills = Math.min(target, this.hallWaveKills);
    this._showObjective('WAVE 2', `The hall is sealed and its guards keep coming. Kill them to break the seal — ${kills}/${target}`);
    if (kills < target) return;
    for (const spawner of this.hallSpawners) spawner.stop();
    this.doorSeal.collapse();
    this.state = 'hall';
    if (this.gameWorld.ui) this.gameWorld.ui.showToast('The seal on the hall door is breaking. The Warden is waiting inside.', 'success', 4000);
  }

  /** The Warden wakes: the fight in the hall begins. */
  startBossFight() {
    this.state = 'boss';
    if (!this.arena) this.arena = this.trackDisposable(new BossArena(this, this.village.hall, { onDefeated: () => this._onWardenDefeated() }));
    this.arena.start();
    this._showBossObjective();
  }

  _showBossObjective() {
    const warden = this.arena.warden;
    if (warden.shielded) {
      const left = this.arena.crystalsLeft;
      this._showObjective('THE WARDEN', `Shoot the shield crystals on the pillars — ${left} left`);
    } else {
      this._showObjective('THE WARDEN', 'The shield is down: bring the Warden down');
    }
  }

  /**
   * The Warden has fallen: every alien falls with it, the cages unlock, and after a moment to
   * take it in, the islanders are next.
   */
  _onWardenDefeated() {
    this.state = 'victory';
    this._victoryTimer = this.cfg.victoryDelaySeconds;
    for (const alien of this.squad.members) {
      if (!alien.isDead) alien.health.takeDamage({ amount: alien.health.maxHealth * 10 });
    }
    for (const cage of this.cages) cage.unlock();
    this._showObjective('THE WARDEN IS DOWN', 'Without it, the aliens fall where they stand');
  }

  _startHostages() {
    this.state = 'hostages';
    this._showHostageObjective();
    if (this.gameWorld.ui) this.gameWorld.ui.showToast('The cages are open to us now. Free our people!', 'success', 3500);
  }

  _showHostageObjective() {
    const freed = this.cages.filter((cage) => cage.freed).length;
    this._showObjective('OUR PEOPLE', `Free the islanders from the cages along the hall walls [E] — ${freed}/${this.cages.length}`);
  }

  _onHostageFreed(cage) {
    const left = this.cages.filter((c) => !c.freed).length;
    const ui = this.gameWorld.ui;
    if (left > 0) {
      if (ui) ui.showToast(`${cage.name} is free! ${left} still caged.`, 'success', 2500);
      return;
    }
    if (this.state === 'hostages') this._beginEnding();
  }

  /**
   * Everyone is free: the camera leaves the hall through its door and climbs over the village as
   * the sun comes up, then the credits roll.
   */
  _beginEnding() {
    this.state = 'ending';
    if (this.gameWorld.ui) this.gameWorld.ui.hideObjective();
    const hall = this.village.hall;
    const f = hall.forward;
    const at = (point, ahead, up) => new THREE.Vector3(point.x + f.x * ahead, point.y + up, point.z + f.z * ahead);
    // Looking out east, where the sun is coming up (the dawn look's sun direction)
    const village = this.environment.village;
    const sunrise = new THREE.Vector3(village.x, village.height + 30, village.z).addScaledVector(new THREE.Vector3(0.9, 0, -0.38).normalize(), 400);
    const door = at(hall.doorway, 0, 3);
    if (this.cinematic) this.cinematic.finish();
    this.cinematic = new LandingCinematic(this.gameWorld, {
      player: this.player,
      title: 'DAWN',
      subtitle: 'The island is ours again',
      duration: ENDING_SECONDS,
      endOnPlayer: false,
      flightPath: [
        at(hall.centre, 6, 3.2),
        at(hall.doorway, 3, 3.6),
        at(hall.entrance, 30, 24),
        new THREE.Vector3(hall.entrance.x - 60 + f.x * 120, hall.entrance.y + 70, hall.entrance.z + f.z * 120)
      ],
      defaultFocus: door,
      aimTowards: 0,
      focus: (out) => out.lerpVectors(door, sunrise, Math.min(1, (this.cinematic ? this.cinematic.elapsed : 0) / (ENDING_SECONDS * 0.6))),
      onFinished: () => this._rollCredits()
    });
    this.gameWorld.addEntity(this.cinematic);
  }

  _rollCredits() {
    this.environment.blendLook('night', 'dawn', 1);
    this.state = 'credits';
    this._creditsTimer = 0;
    if (this.gameWorld.ui) this.gameWorld.ui.showCredits(CREDITS, CREDITS_SECONDS, '[Space] Skip');
  }

  dispose() {
    this.supplyCrate = null; // Entities: the GameWorld disposes them
    this.hallCrate = null;
    this.generators = [];
    this.revivePoints = [];
    this.lastRevivePoint = null;
    this.generatorDefenses = [];
    this.streetAliens = null;
    this.hallGuards = [];    // Aliens: the alien squad removes them
    this.hallSpawners = [];
    this.cages = [];         // Entities: the GameWorld disposes them
    this.reviveCrates = [];
    this.shieldPickups = [];
    this.shield = null;
    if (this.gameWorld.ui) this.gameWorld.ui.hideCredits();
    super.dispose();         // Also the village, the force fields and the arena (tracked)
    this.village = null;
    this.dome = null;
    this.doorSeal = null;
    this.arena = null;
  }
}
