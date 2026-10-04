import * as THREE from 'three';
import { IslandLevel, CREW_NAMES } from './IslandLevel.js';
import { Village } from './level03/Village.js';
import { BossArena } from './level03/BossArena.js';
import { ForceFieldDome, ForceFieldWall } from './level03/ForceFieldDome.js';
import { ShieldGenerator } from './level03/ShieldGenerator.js';
import { AlienSpawner } from './level03/AlienSpawner.js';
import { RevivePoint } from './level03/RevivePoint.js';
import { SupplyCrate } from './level02/SupplyCrate.js';
import config from '../config.json';

const DOME_RADIUS = 22;      // The force field covers the hall and a little of the ground round it
const GUARD_DISTANCE = 6;    // Generator guards start this far from their generator
const GUARD_POST_TRIES = 30; // Attempts to find each hall guard a post

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
 * - 'guards' (wave 2): the dome falls, but the hall's door is sealed (ForceFieldWall) and a wave of
 *   aliens takes up posts round it. Clear them all and the seal breaks.
 * - 'hall' -> 'boss': into the hall, where the Warden wakes (BossArena). Bringing it down wins, for
 *   now (the hostages come in a later phase).
 * Up to five revive points (RevivePoint) along the way: lost, the player comes back at the last
 * one reached (with the squad), rather than failing. On-foot combat, downed and revive come from
 * IslandLevel.
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
    this.hallGuards = [];           // Wave 2
    this.arena = null;
    this.state = 'generators'; // generators -> guards -> hall -> boss -> victory (-> won)
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
   * (or the start, before the first), with the squad regrouping there.
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
    if (this.gameWorld.ui) this.gameWorld.ui.showToast(`Back on your feet at ${point ? point.name : 'the start'}.`, 'info', 3000);
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
    const cap = () => this.squad.aliveCount < this.cfg.maxAliveAliens;
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
  }

  _updateScenario(delta) {
    const hall = this.village.hall;
    const p = this.player.position;
    switch (this.state) {
      case 'generators':
        this._updateDefenses(delta);
        this._showGeneratorObjective();
        break;
      case 'guards':
        this._updateHallWave();
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
        if (this._victoryTimer <= 0) this._finish(true);
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
   * the wave up to its full size.
   */
  _startHallWave() {
    this.state = 'guards';
    this.doorSeal.raise();
    const wave = this.cfg.hallWave;
    this.hallGuards = this.squad.members.filter((alien) => !alien.isDead);
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

  /** Counts the hall's guards down; the seal on the door breaks when they are all dead. */
  _updateHallWave() {
    const left = this.hallGuards.filter((alien) => !alien.isDead).length;
    this._showObjective('WAVE 2', `The hall is sealed. Clear the aliens guarding it — ${left} left`);
    if (left > 0) return;
    this.doorSeal.collapse();
    this.state = 'hall';
    if (this.gameWorld.ui) this.gameWorld.ui.showToast('The seal on the hall door is breaking. The Warden is waiting inside.', 'success', 4000);
  }

  /** The Warden wakes: the fight in the hall begins. */
  startBossFight() {
    this.state = 'boss';
    this.arena = this.trackDisposable(new BossArena(this, this.village.hall, { onDefeated: () => this._onWardenDefeated() }));
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

  /** The Warden has fallen: a moment to take it in, then the mission is won. */
  _onWardenDefeated() {
    this.state = 'victory';
    this._victoryTimer = this.cfg.victoryDelaySeconds;
    this._showObjective('THE WARDEN IS DOWN', 'The village is ours');
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
    super.dispose();         // Also the village, the force fields and the arena (tracked)
    this.village = null;
    this.dome = null;
    this.doorSeal = null;
    this.arena = null;
  }
}
