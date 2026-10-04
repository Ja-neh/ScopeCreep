import { WeaponEffects } from '../weapons/WeaponEffects.js';

// Formation places around the leader, in the leader's frame (x right, z behind, meters), and the
// direction each one watches relative to the squad's heading (radians, positive = left).
const FORMATION = [
  { x: -3.5, z: 2.5, watch: 0.6 },
  { x: 3.5, z: 2.5, watch: -0.6 },
  { x: -6, z: 6, watch: 1.4 },
  { x: 6, z: 6, watch: -1.4 },
  { x: 0, z: 7, watch: Math.PI }
];
const HEADING_SPEED = 1.5;   // Leader speed (m/s) above which the formation turns to their travel direction
const HEADING_RATE = 2;      // How quickly the formation turns (1/s)
const POST_REFRESH_DISTANCE = 0.5; // Recompute a formation place once the leader moves this far...
const POST_REFRESH_TURN = 0.05;    // ...or the formation turns this much (radians)
const FALLBACK_SCALES = [1, 0.5]; // Try the full formation place, then one half as far out
const NO_ENEMIES = [];

/**
 * HumanSquad
 * Our side on the ground: the leader (the player) and the AI squadmates. Registers squadmates
 * with the GameWorld, tells them who the enemies are (another squad's members), gives each a
 * place in a formation that turns with the leader's travel direction, shares cover, draws their
 * tracers, reports their gunshots, and clears away the fallen. Updated by its level in Phase 5.
 *
 * `members` (leader + squadmates) is what the aliens hunt: pass it as AlienSquad's `targets`.
 */
export class HumanSquad {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {Object} options.leader - The player (anything with position, velocity, yaw, health)
   * @param {{findCover: Function}} [options.cover] - findCover(from, threat, out, minRange, maxRange)
   * @param {(x: number, z: number) => boolean} [options.isWalkable] - False for water and solids:
   *   formation places there fall back closer to the leader
   * @param {number} options.corpseSeconds - How long the fallen lie before removal
   * @param {(position: THREE.Vector3) => void} [options.onGunshot] - A squadmate fired from here
   * @param {(mate: SquadMate) => void} [options.onMateKilled]
   */
  constructor(gameWorld, { leader, cover = null, isWalkable = null, corpseSeconds, onGunshot = null, onMateKilled = null }) {
    this.gameWorld = gameWorld;
    this.leader = leader;
    this.cover = cover;
    this.isWalkable = isWalkable;
    this.corpseSeconds = corpseSeconds;
    this.onGunshot = onGunshot;
    this.onMateKilled = onMateKilled;

    this.members = leader ? [leader] : [];
    this.mates = [];
    this.enemySquad = null; // Set by the level: the squad whose members we shoot at

    this.heading = leader ? leader.yaw : 0;
    this.effects = new WeaponEffects(gameWorld.effectsGroup, { flashLight: false });
    this._followers = 0;
  }

  get enemies() {
    return this.enemySquad ? this.enemySquad.members : NO_ENEMIES;
  }

  get aliveMates() {
    let count = 0;
    for (const mate of this.mates) if (!mate.isDead) count++;
    return count;
  }

  /**
   * Adds an AI squadmate (it starts out following the leader).
   * @param {SquadMate} mate
   * @param {Object} [options]
   * @param {boolean} [options.formation=true] - Give it a place in the formation
   */
  add(mate, { formation = true } = {}) {
    mate.squad = this;
    mate.inFormation = formation;
    if (formation) mate.slotIndex = this._followers++;
    this.mates.push(mate);
    this.members.push(mate);
    this.gameWorld.addEntity(mate);
    return mate;
  }

  /** Every squadmate with a formation place follows the leader (guards stay put). */
  followLeader() {
    for (const mate of this.mates) {
      if (!mate.isDead && mate.inFormation) mate.follow();
    }
  }

  /**
   * Where `mate` should stand in formation around the leader.
   * Cached per squadmate until the leader moves or the formation turns.
   */
  formationPost(mate, out) {
    const leader = this.leader;
    if (!leader || (leader.health && leader.health.isDead)) return out.copy(mate.position);

    const cache = mate._formationCache || (mate._formationCache = { valid: false, x: 0, y: 0, z: 0, leaderX: 0, leaderZ: 0, heading: 0 });
    const p = leader.position;
    if (cache.valid &&
      Math.hypot(p.x - cache.leaderX, p.z - cache.leaderZ) < POST_REFRESH_DISTANCE &&
      Math.abs(this.heading - cache.heading) < POST_REFRESH_TURN) {
      return out.set(cache.x, p.y, cache.z);
    }
    this._computePost(mate, out);
    cache.valid = true;
    cache.x = out.x;
    cache.z = out.z;
    cache.leaderX = p.x;
    cache.leaderZ = p.z;
    cache.heading = this.heading;
    return out;
  }

  _computePost(mate, out) {
    const leader = this.leader;
    const slot = FORMATION[mate.slotIndex % FORMATION.length];
    const rightX = Math.cos(this.heading);
    const rightZ = -Math.sin(this.heading);
    const backX = Math.sin(this.heading);
    const backZ = Math.cos(this.heading);
    const p = leader.position;

    // Fall back closer to the leader when the place is in the sea or inside a rock
    for (const scale of FALLBACK_SCALES) {
      const x = p.x + rightX * slot.x * scale + backX * slot.z * scale;
      const z = p.z + rightZ * slot.x * scale + backZ * slot.z * scale;
      if (!this.isWalkable || this.isWalkable(x, z)) return out.set(x, p.y, z);
    }
    return out.set(p.x + backX * 1.5, p.y, p.z + backZ * 1.5);
  }

  /** The yaw `mate` watches while standing in formation. */
  watchYaw(mate) {
    return this.heading + FORMATION[mate.slotIndex % FORMATION.length].watch;
  }

  findCover(from, threat, out, minRange, maxRange) {
    return this.cover ? this.cover.findCover(from, threat, out, minRange, maxRange) : false;
  }

  /**
   * A squadmate fired: tracer and impact, and the gunshot is heard.
   */
  onShot(mate, muzzle, result) {
    this.effects.muzzleFlash(muzzle, result.point);
    this.effects.tracer(muzzle, result.point);
    if (result.hit) {
      const surface = result.entity ? 'hit' : (result.collider.userData && result.collider.userData.isTerrain ? 'dust' : 'spark');
      this.effects.impact(result.point, surface);
    }
    if (this.onGunshot) this.onGunshot(muzzle);
  }

  /**
   * Phase 5: formation heading, effects, and removing the fallen.
   */
  update(delta) {
    this.effects.update(delta);

    const leader = this.leader;
    if (leader && leader.velocity) {
      const speed = Math.hypot(leader.velocity.x, leader.velocity.z);
      if (speed > HEADING_SPEED) {
        const target = Math.atan2(-leader.velocity.x, -leader.velocity.z);
        const diff = Math.atan2(Math.sin(target - this.heading), Math.cos(target - this.heading));
        this.heading += diff * Math.min(1, HEADING_RATE * delta);
      }
    }

    for (let i = this.mates.length - 1; i >= 0; i--) {
      const mate = this.mates[i];
      if (!mate.isDead) continue;
      if (!mate._reported) {
        mate._reported = true;
        if (this.onMateKilled) this.onMateKilled(mate);
      }
      if (mate.deathTime >= this.corpseSeconds) {
        this.mates.splice(i, 1);
        this.members.splice(this.members.indexOf(mate), 1);
        this.gameWorld.removeEntity(mate);
      }
    }
  }

  /** Removes every AI squadmate at once (the leader stays). */
  removeAllMates() {
    for (const mate of this.mates) {
      this.members.splice(this.members.indexOf(mate), 1);
      this.gameWorld.removeEntity(mate);
    }
    this.mates = [];
    this._followers = 0;
  }

  dispose() {
    for (const mate of this.mates) this.gameWorld.removeEntity(mate);
    this.mates = [];
    this.members = this.leader ? [this.leader] : [];
    this.effects.dispose();
    this.leader = null;
    this.enemySquad = null;
  }
}
