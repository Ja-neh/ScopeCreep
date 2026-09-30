import * as THREE from 'three';

/**
 * GroundProbe
 * Performs downward raycasting and leading-edge slope lookahead for character locomotion.
 * Projects horizontal velocity onto ground surface tangent planes to prevent capsule face wedging.
 */
export class GroundProbe {
  /**
   * @param {PhysicsWorld} physicsWorld
   * @param {RAPIER.Collider} collider - Character collider to exclude from raycasts
   * @param {Object} options
   */
  constructor(physicsWorld, collider = null, options = {}) {
    this.physicsWorld = physicsWorld;
    this.collider = collider;
    this.capsuleRadius = options.capsuleRadius || 0.45;
    this.maxRayDistance = options.maxRayDistance || 1.6;

    // Preallocated math scratchpads (eliminating GC)
    this._groundNormal = new THREE.Vector3(0, 1, 0);
    this._slopeMove = new THREE.Vector3();

    // Rapier probe rays
    this._groundRay = null;
    this._aheadRay = null;

    if (this.physicsWorld && this.physicsWorld.RAPIER) {
      const RAPIER = this.physicsWorld.RAPIER;
      this._groundRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
      this._aheadRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    }
  }

  /**
   * Updates collider reference if physics was initialized after probe construction
   */
  setCollider(collider) {
    this.collider = collider;
  }

  /**
   * Probes surface beneath and ahead of the character and projects horizontal movement onto ground tangent.
   * @param {{ x: number, y: number, z: number }} currPos - Current rigid body translation
   * @param {THREE.Vector3} velocity - Player horizontal velocity
   * @param {number} delta - Frame delta time
   * @returns {{ groundHit: Object|null, slopeMove: THREE.Vector3, isSlope: boolean, normal: THREE.Vector3|null }}
   */
  probe(currPos, velocity, delta) {
    this._slopeMove.set(velocity.x * delta, 0, velocity.z * delta);

    if (!this.physicsWorld || !this.physicsWorld.isInitialized || !this._groundRay) {
      return {
        groundHit: null,
        slopeMove: this._slopeMove,
        isSlope: false,
        normal: null
      };
    }

    // 1. Downward probe beneath character
    this._groundRay.origin.x = currPos.x;
    this._groundRay.origin.y = currPos.y;
    this._groundRay.origin.z = currPos.z;

    let groundHit = this.physicsWorld.castRayAndGetNormal(
      this._groundRay,
      this.maxRayDistance,
      true,
      undefined,
      undefined,
      this.collider
    );

    // 2. Forward probe at leading edge to anticipate upward slopes before collision
    const horizSpeed = Math.hypot(velocity.x, velocity.z);
    if (horizSpeed > 0.001 && this._aheadRay) {
      const probeDist = this.capsuleRadius * 0.9;
      this._aheadRay.origin.x = currPos.x + (velocity.x / horizSpeed) * probeDist;
      this._aheadRay.origin.y = currPos.y;
      this._aheadRay.origin.z = currPos.z + (velocity.z / horizSpeed) * probeDist;

      const aheadHit = this.physicsWorld.castRayAndGetNormal(
        this._aheadRay,
        this.maxRayDistance,
        true,
        undefined,
        undefined,
        this.collider
      );

      if (aheadHit && aheadHit.normal && aheadHit.normal.y > 0.5 && aheadHit.normal.y < 0.98) {
        // Only anticipate an UPWARD incline (velocity vector moves towards/against the slope normal: dot < 0)
        const dotAhead = (velocity.x * aheadHit.normal.x + velocity.z * aheadHit.normal.z) / horizSpeed;
        if (dotAhead < -0.05) {
          groundHit = aheadHit;
        }
      }
    }

    // 3. Tangent projection onto slope
    if (groundHit && groundHit.normal && groundHit.normal.y > 0.5) {
      this._groundNormal.set(groundHit.normal.x, groundHit.normal.y, groundHit.normal.z).normalize();

      const dot = this._slopeMove.dot(this._groundNormal);
      if (dot < 0) {
        // Climbing up: lift movement along the incline tangent to prevent capsule face wedging
        this._slopeMove.addScaledVector(this._groundNormal, -dot);
      }

      return {
        groundHit,
        slopeMove: this._slopeMove,
        isSlope: true,
        normal: this._groundNormal
      };
    }

    return {
      groundHit,
      slopeMove: this._slopeMove,
      isSlope: false,
      normal: null
    };
  }
}
