import * as THREE from 'three';

const EYE_HEIGHT = 1.6;
const TARGET_CHEST_HEIGHT = 1.2;

/**
 * Perception
 * What an AI combatant knows about its targets: sight within range and field of view with a
 * clear line of sight (a physics ray), reduced range against concealed targets (crouched in a
 * bush), and hearing (gunshots reported to it). Keeps the last known position of the target.
 * Sight checks run a few times a second, not every frame.
 */
export class Perception {
  /**
   * @param {Object} owner - Combatant with `position`, `yaw`, `collider`
   * @param {Object} cfg - Sight and hearing values (e.g. config.enemies.trooper)
   */
  constructor(owner, cfg) {
    this.owner = owner;
    this.sightRange = cfg.sightRange;
    this.concealedSightRange = cfg.concealedSightRange;
    this.awarenessRadius = cfg.awarenessRadius;
    this.halfFieldOfView = THREE.MathUtils.degToRad(cfg.fieldOfViewDegrees) / 2;
    this.hearingRange = cfg.hearingRange;
    this.checkInterval = 0.2;

    this.target = null;            // Entity currently seen
    this.lastKnownPosition = new THREE.Vector3();
    this.hasLastKnown = false;
    this.timeSinceSeen = Infinity;

    this._checkTimer = Math.random() * this.checkInterval; // Stagger checks across combatants
    this._ray = null;
    this._eye = new THREE.Vector3();
    this._toTarget = new THREE.Vector3();
  }

  /**
   * @param {number} delta
   * @param {Array} candidates - Potential targets (entities with position, health, isConcealed)
   * @param {PhysicsWorld} physicsWorld
   */
  update(delta, candidates, physicsWorld) {
    this.timeSinceSeen += delta;
    this._checkTimer -= delta;
    if (this._checkTimer > 0) return;
    this._checkTimer = this.checkInterval;

    let best = null;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      if (!candidate || (candidate.health && candidate.health.isDead)) continue;
      const distance = this.canSee(candidate, physicsWorld);
      if (distance >= 0 && distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }

    this.target = best;
    if (best) {
      this.lastKnownPosition.copy(best.position);
      this.hasLastKnown = true;
      this.timeSinceSeen = 0;
    }
  }

  /**
   * Distance to the candidate if it is visible right now, otherwise -1.
   */
  canSee(candidate, physicsWorld) {
    const owner = this.owner;
    this._eye.set(owner.position.x, owner.position.y + EYE_HEIGHT, owner.position.z);
    this._toTarget.set(candidate.position.x, candidate.position.y + TARGET_CHEST_HEIGHT, candidate.position.z).sub(this._eye);
    const distance = this._toTarget.length();

    const range = candidate.isConcealed ? this.concealedSightRange : this.sightRange;
    if (distance > range) return -1;

    // Field of view (anything very close is noticed regardless of facing)
    if (distance > this.awarenessRadius) {
      const forwardX = -Math.sin(owner.yaw);
      const forwardZ = -Math.cos(owner.yaw);
      const flat = Math.hypot(this._toTarget.x, this._toTarget.z) || 1;
      const cos = (forwardX * this._toTarget.x + forwardZ * this._toTarget.z) / flat;
      if (cos < Math.cos(this.halfFieldOfView)) return -1;
    }

    return this.hasLineOfSight(this._eye, this._toTarget, distance, candidate, physicsWorld) ? distance : -1;
  }

  /**
   * True when the first thing a ray from `from` along `direction` hits is the candidate.
   */
  hasLineOfSight(from, direction, distance, candidate, physicsWorld) {
    if (!this._ray) {
      this._ray = new physicsWorld.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    }
    this._ray.origin.x = from.x;
    this._ray.origin.y = from.y;
    this._ray.origin.z = from.z;
    this._ray.dir.x = direction.x / distance;
    this._ray.dir.y = direction.y / distance;
    this._ray.dir.z = direction.z / distance;

    const hit = physicsWorld.castRay(this._ray, distance + 0.5, true, undefined, undefined, this.owner.collider);
    if (!hit) return true;
    const entity = hit.collider.userData ? hit.collider.userData.entity : null;
    return entity === candidate || hit.timeOfImpact >= distance - 0.3;
  }

  /**
   * A noise (e.g. a gunshot) at `position`. Returns true if it was within hearing range,
   * in which case it becomes the last known position when nothing is in sight.
   */
  hear(position) {
    if (this.owner.position.distanceTo(position) > this.hearingRange) return false;
    if (!this.target) {
      this.lastKnownPosition.copy(position);
      this.hasLastKnown = true;
    }
    return true;
  }

  /**
   * Told about a target by a squadmate.
   */
  share(position) {
    if (this.target) return;
    this.lastKnownPosition.copy(position);
    this.hasLastKnown = true;
  }

  forget() {
    this.target = null;
    this.hasLastKnown = false;
    this.timeSinceSeen = Infinity;
  }
}
