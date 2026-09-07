import * as THREE from 'three';
import { DamageInfo, DamageType } from '../components/HealthComponent.js';

/**
 * Projectile
 * Represents a single pooled physical projectile (Artillery Shell or Flak Tracer).
 * Uses continuous collision detection (CCD segment raycasting) against Rapier physics
 * to prevent high-velocity tunneling through thin targets.
 */
export class Projectile {
  constructor(mesh, type = 'FLAK', RAPIER = null) {
    this.mesh = mesh;
    this.type = type;
    this.RAPIER = RAPIER;

    // Kinematic motion state
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.gravity = -16.0; // Downward acceleration m/s^2
    this.drag = 0.005;    // Air resistance coefficient
    this.speed = 0;

    // Lifecycle state
    this.alive = false;
    this.lifeTime = 0;
    this.maxLifeTime = 3.0;
    this.damageInfo = new DamageInfo(25, DamageType.KINETIC);
    this.source = null; // Firing entity/mesh to avoid self-collision
    this.excludeCollider = null;

    // Preallocated math scratchpads (eliminating GC)
    this._prevPos = new THREE.Vector3();
    this._stepDir = new THREE.Vector3();
    this._forward = new THREE.Vector3(0, 0, -1);
    this._targetQuat = new THREE.Quaternion();

    // Reusable Rapier Ray
    this._rayOrigin = { x: 0, y: 0, z: 0 };
    this._rayDir = { x: 0, y: 0, z: 0 };
    this._ray = RAPIER ? new RAPIER.Ray(this._rayOrigin, this._rayDir) : null;
  }

  /**
   * Spawns projectile from pool with initial trajectory
   */
  spawn({
    origin,
    direction,
    speed = 350,
    gravity = -16.0,
    drag = 0.005,
    maxLifeTime = 3.0,
    damage = 25,
    damageType = DamageType.KINETIC,
    source = null,
    excludeCollider = null
  } = {}) {
    this.position.copy(origin);
    this._prevPos.copy(origin);

    this.velocity.copy(direction).normalize().multiplyScalar(speed);
    this.speed = speed;
    this.gravity = gravity;
    this.drag = drag;
    this.maxLifeTime = maxLifeTime;
    this.lifeTime = 0;
    this.source = source;
    this.excludeCollider = excludeCollider;

    this.damageInfo.amount = damage;
    this.damageInfo.type = damageType;
    this.damageInfo.source = source;

    this.alive = true;

    // Align mesh visually along velocity direction
    this.mesh.position.copy(this.position);
    this._targetQuat.setFromUnitVectors(this._forward, direction.clone().normalize());
    this.mesh.quaternion.copy(this._targetQuat);
    this.mesh.visible = true;
  }

  /**
   * Advances trajectory and performs continuous collision detection.
   * @param {number} delta - Frame delta time in seconds
   * @param {PhysicsWorld} physicsWorld - Rapier world wrapper
   * @param {Function} onHit - Callback when an obstacle or target is struck
   * @returns {boolean} true if still alive, false if despawned
   */
  update(delta, physicsWorld, onHit) {
    if (!this.alive) return false;

    this.lifeTime += delta;
    if (this.lifeTime >= this.maxLifeTime) {
      this.despawn();
      return false;
    }

    // 1. Record previous position for CCD raycast sweep
    this._prevPos.copy(this.position);

    // 2. Apply ballistic gravity & air resistance drag
    this.velocity.y += this.gravity * delta;
    if (this.drag > 0) {
      const dragFactor = 1.0 - (this.drag * delta);
      this.velocity.multiplyScalar(Math.max(0, dragFactor));
    }

    // 3. Compute frame displacement step
    const stepX = this.velocity.x * delta;
    const stepY = this.velocity.y * delta;
    const stepZ = this.velocity.z * delta;
    const stepDist = Math.sqrt(stepX * stepX + stepY * stepY + stepZ * stepZ);

    if (stepDist < 0.0001) return true;

    this._stepDir.set(stepX / stepDist, stepY / stepDist, stepZ / stepDist);

    // 4. Continuous Collision Detection (CCD) via Rapier raycast
    let hitDetected = false;
    let hitPoint = null;
    let hitCollider = null;

    if (physicsWorld && physicsWorld.world && physicsWorld.isInitialized) {
      if (!this._ray && physicsWorld.RAPIER) {
        this.RAPIER = physicsWorld.RAPIER;
        this._ray = new this.RAPIER.Ray(this._rayOrigin, this._rayDir);
      }

      if (this._ray) {
        this._ray.origin.x = this._prevPos.x;
        this._ray.origin.y = this._prevPos.y;
        this._ray.origin.z = this._prevPos.z;
        this._ray.dir.x = this._stepDir.x;
        this._ray.dir.y = this._stepDir.y;
        this._ray.dir.z = this._stepDir.z;

        const hit = physicsWorld.world.castRay(
          this._ray,
          stepDist,
          true,
          undefined,
          undefined,
          this.excludeCollider
        );

        if (hit && hit.timeOfImpact <= stepDist) {
          hitDetected = true;
          hitCollider = hit.collider;
          hitPoint = new THREE.Vector3(
            this._prevPos.x + this._stepDir.x * hit.timeOfImpact,
            this._prevPos.y + this._stepDir.y * hit.timeOfImpact,
            this._prevPos.z + this._stepDir.z * hit.timeOfImpact
          );
        }
      }
    }

    // 5. Water surface / Ground plane boundary check (Y <= 0)
    if (!hitDetected && this._prevPos.y > 0 && (this._prevPos.y + stepY) <= 0) {
      const t = -this._prevPos.y / stepY;
      if (t >= 0 && t <= 1) {
        hitDetected = true;
        hitPoint = new THREE.Vector3(
          this._prevPos.x + stepX * t,
          0,
          this._prevPos.z + stepZ * t
        );
      }
    }

    // 6. Resolve Hit or Advance Position
    if (hitDetected) {
      if (onHit && typeof onHit === 'function') {
        onHit({
          point: hitPoint,
          collider: hitCollider,
          projectile: this,
          damageInfo: this.damageInfo
        });
      }
      this.despawn();
      return false;
    }

    // Advance position
    this.position.x += stepX;
    this.position.y += stepY;
    this.position.z += stepZ;

    this.mesh.position.copy(this.position);

    // Orient mesh along velocity vector
    this._targetQuat.setFromUnitVectors(this._forward, this._stepDir);
    this.mesh.quaternion.copy(this._targetQuat);

    return true;
  }

  /**
   * Recycles projectile back into inactive pool
   */
  despawn() {
    this.alive = false;
    this.mesh.visible = false;
    this.mesh.position.set(0, -9999, 0); // Hide far offscreen
    this.excludeCollider = null;
    this.source = null;
  }
}
