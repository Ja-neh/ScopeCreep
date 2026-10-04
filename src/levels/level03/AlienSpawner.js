import * as THREE from 'three';

const SPAWN_TRIES = 12;
const EYE_HEIGHT = 1.6; // Sight lines are checked at about head height

/**
 * AlienSpawner
 * Keeps aliens coming: whenever fewer than `maxAlive` of its aliens are alive, a new one appears
 * every `interval` seconds somewhere on a ring `minDistance`..`maxDistance` round `centre()`
 * (from any direction), on open ground, at least `minPlayerDistance` from the player and out of
 * the player's sight if it can manage it. Each one pushes in on `target()` (assault) and fights
 * whoever it meets. It never runs out: it goes on until stop()ped, and only spawns while
 * isActive() and canSpawn() (e.g. a cap on aliens alive in the level).
 *
 * Level 3 uses one round the player in the village streets, and one round each generator.
 * Updated by its level in Phase 5.
 */
export class AlienSpawner {
  /**
   * @param {IslandLevel} level - Supplies createAlien(), _isWalkable(), the player and physics
   * @param {Object} options
   * @param {() => THREE.Vector3} options.centre - What they appear round (a place, or the player)
   * @param {() => THREE.Vector3} [options.target] - Where they push to (defaults to the centre)
   * @param {number} options.maxAlive
   * @param {number} options.interval - Seconds between new arrivals
   * @param {number} options.minDistance
   * @param {number} options.maxDistance
   * @param {number} options.minPlayerDistance
   * @param {number} [options.bruteChance=0] - Chance that a new arrival is a brute
   * @param {() => boolean} [options.isActive]
   * @param {() => boolean} [options.canSpawn]
   */
  constructor(level, {
    centre, target = centre, maxAlive, interval, minDistance, maxDistance, minPlayerDistance,
    bruteChance = 0, isActive = () => true, canSpawn = () => true
  }) {
    this.level = level;
    this.centre = centre;
    this.target = target;
    this.maxAlive = maxAlive;
    this.interval = interval;
    this.minDistance = minDistance;
    this.maxDistance = maxDistance;
    this.minPlayerDistance = minPlayerDistance;
    this.bruteChance = bruteChance;
    this.isActive = isActive;
    this.canSpawn = canSpawn;

    this.members = [];   // Its aliens still alive
    this.spawned = 0;    // How many it has brought in
    this.stopped = false;
    this._timer = interval;
    this._spot = new THREE.Vector3();
    this._seenSpot = new THREE.Vector3(); // A spot in the player's sight, if no hidden one turns up
  }

  /** Counts an alien that was already there (e.g. a guard) as one of its own. */
  adopt(alien) {
    this.members.push(alien);
  }

  /** No more aliens from this one. */
  stop() {
    this.stopped = true;
  }

  /** Phase 5: forgets the dead, and brings in a new alien when it is time. */
  update(delta) {
    for (let i = this.members.length - 1; i >= 0; i--) {
      if (this.members[i].isDead) this.members.splice(i, 1);
    }
    if (this.stopped || !this.isActive() || this.members.length >= this.maxAlive || !this.canSpawn()) return;

    this._timer -= delta;
    if (this._timer > 0) return;
    const spot = this._findSpot();
    if (!spot) {
      this._timer = 1; // Nowhere suitable just now: try again shortly
      return;
    }
    const type = Math.random() < this.bruteChance ? 'brute' : 'trooper';
    const alien = this.level.createAlien(type, spot.x, spot.z);
    alien.assault(this.target());
    this.members.push(alien);
    this.spawned++;
    this._timer = this.interval;
  }

  /** A spot on the ring: open ground, not too close to the player, out of their sight if possible. */
  _findSpot() {
    const level = this.level;
    const centre = this.centre();
    const player = level.player.position;
    const physics = level.gameWorld.physics;
    let seen = null;
    for (let i = 0; i < SPAWN_TRIES; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = this.minDistance + Math.random() * (this.maxDistance - this.minDistance);
      const x = centre.x + Math.cos(angle) * distance;
      const z = centre.z + Math.sin(angle) * distance;
      if (Math.hypot(x - player.x, z - player.z) < this.minPlayerDistance) continue;
      if (!level._isWalkable(x, z)) continue;
      this._spot.set(x, level.environment.heightAt(x, z), z);
      if (!physics || !physics.isLineClear(player, this._spot, EYE_HEIGHT)) return this._spot; // Hidden from the player
      if (!seen) seen = this._seenSpot.copy(this._spot);
    }
    return seen;
  }
}
