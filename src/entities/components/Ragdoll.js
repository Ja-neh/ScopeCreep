import * as THREE from 'three';
import config from '../../config.json';

const REFERENCE_RADIUS = 0.45; // Human-sized capsule: mass scales with girth squared

/**
 * Ragdoll
 * One dynamic Rapier capsule that takes over from a dead character's kinematic body, so a
 * killing blow topples the corpse with real physics. The owning entity disposes it when the
 * corpse is removed or revived, and syncs its model mesh from the body in Phase 6 (lateUpdate).
 *
 * Impulses come from two places: `kick()` for the killing blow, `blastFrom()` for explosions.
 * Linear / angular damping (config.json `physicsJuice.ragdoll`) lets Rapier settle and sleep
 * the body once it comes to rest, so no per-frame settle logic is needed.
 */
export class Ragdoll {
  /**
   * @param {PhysicsWorld} physicsWorld
   * @param {Object} options
   * @param {number} options.radius - Capsule radius (matches the character's collider)
   * @param {number} options.halfHeight - Half height of the capsule's cylindrical part
   * @param {THREE.Vector3} options.position - Feet position where the character died
   * @param {THREE.Quaternion} [options.quaternion] - Facing at death (defaults upright)
   */
  constructor(physicsWorld, { radius = REFERENCE_RADIUS, halfHeight = 0.55, position, quaternion = null }) {
    this.physicsWorld = physicsWorld;
    this.radius = radius;
    this.halfHeight = halfHeight;
    this.capsuleCenter = radius + halfHeight;

    const cfg = config.physicsJuice.ragdoll;
    this.mass = cfg.mass * (radius / REFERENCE_RADIUS) ** 2;
    // Solid-capsule estimate: enough to spin it visibly with a torque impulse
    this.inertia = (this.mass * (this.capsuleCenter * 2) ** 2) / 12;

    const RAPIER = physicsWorld.RAPIER;
    const rotation = quaternion || new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
    const centre = new THREE.Vector3().copy(position).addScaledVector(this._up, this.capsuleCenter);

    this.body = physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(centre.x, centre.y, centre.z)
        .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
        .setLinearDamping(cfg.linearDamping)
        .setAngularDamping(cfg.angularDamping)
        .setCcdEnabled(true)
    );
    this.collider = physicsWorld.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius).setMass(this.mass).setFriction(0.9).setRestitution(0.05),
      this.body
    );

    // Scratchpads (no allocations per impulse or per sync)
    this._impulse = new THREE.Vector3();
    this._spin = new THREE.Vector3();
    this._translation = new THREE.Vector3();
    this._rotation = new THREE.Quaternion();
  }

  /**
   * Sends the corpse flying along the killing blow: a shove along `direction` (or a random
   * one when the blow came from nowhere) plus a tumble.
   * @param {THREE.Vector3|null} direction - Unit direction the killing blow travelled
   */
  kick(direction) {
    const cfg = config.physicsJuice.ragdoll;
    this._impulse.set(direction ? direction.x : 0, 0, direction ? direction.z : 0);
    if (this._impulse.lengthSq() < 1e-6) {
      const angle = Math.random() * Math.PI * 2;
      this._impulse.set(Math.sin(angle), 0, Math.cos(angle));
    }
    this._impulse.normalize().multiplyScalar(cfg.kickSpeed * this.mass);
    this._impulse.y += cfg.kickSpeed * cfg.kickLift * this.mass;
    this.body.applyImpulse(this._impulse, true);

    this._spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    if (this._spin.lengthSq() < 1e-4) this._spin.set(1, 0, 0);
    this._spin.normalize().multiplyScalar(cfg.spinSpeed * this.inertia * (0.5 + Math.random() * 0.5));
    this.body.applyTorqueImpulse(this._spin, true);
  }

  /**
   * Throws the corpse away from an explosion: mostly outward with a touch of lift, falling
   * off with distance.
   * @param {THREE.Vector3} point - Explosion centre
   * @returns {number} 0 when outside the blast radius, up to 1 for a direct hit
   */
  blastFrom(point) {
    const cfg = config.physicsJuice.explosion;
    const centre = this.body.translation();
    const dx = centre.x - point.x;
    const dz = centre.z - point.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= cfg.radius) return 0;

    this._impulse.set(dx, 0, dz);
    if (distance < 1e-3) {
      this._impulse.set(0, 1, 0); // Dead centre: straight up
    } else {
      this._impulse.divideScalar(distance);
      this._impulse.y = cfg.upwardFraction;
    }
    const falloff = 1 - distance / cfg.radius;
    this._impulse.multiplyScalar(cfg.impulseSpeed * falloff * this.mass);
    this.body.applyImpulse(this._impulse, true);
    return falloff;
  }

  /**
   * Places the model mesh: its origin sits at the feet, the capsule centre at the body.
   * Call in Phase 6 (lateUpdate).
   * @param {THREE.Object3D} mesh
   */
  sync(mesh) {
    const t = this.body.translation();
    const r = this.body.rotation();
    this._translation.set(t.x, t.y, t.z);
    this._rotation.set(r.x, r.y, r.z, r.w);
    this._up.set(0, 1, 0).applyQuaternion(this._rotation);
    mesh.position.copy(this._translation).addScaledVector(this._up, -this.capsuleCenter);
    mesh.quaternion.copy(this._rotation);
  }

  dispose() {
    if (this.physicsWorld && this.body) {
      this.physicsWorld.removeRigidBody(this.body);
    }
    this.body = null;
    this.collider = null;
    this.physicsWorld = null;
  }
}
