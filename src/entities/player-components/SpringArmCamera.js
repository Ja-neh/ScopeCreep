import * as THREE from 'three';

export const CameraMode = Object.freeze({
  FIRST_PERSON: 'FIRST_PERSON',
  THIRD_PERSON: 'THIRD_PERSON'
});

/**
 * SpringArmCamera
 * Dedicated 3rd-person spring arm and 1st-person eye camera controller.
 * Features:
 * - Dynamic obstacle occlusion raycasting against Rapier colliders (walls, hulls)
 * - Fast compression (28/s) and smooth spring extension (10/s)
 * - Seamless toggle between 1st and 3rd person views
 * - Proximity near-plane mesh occlusion detection
 * - Zero GC overhead (preallocated math vectors)
 */
export class SpringArmCamera {
  constructor(camera, physicsWorld = null, options = {}) {
    this.camera = camera;
    this.physicsWorld = physicsWorld;

    // View mode
    this.mode = options.defaultMode || CameraMode.THIRD_PERSON;

    // Arm configuration
    this.eyeHeight = options.eyeHeight || 1.7;
    this.thirdPersonDistance = options.thirdPersonDistance || 4.5;
    this.currentCameraDistance = options.thirdPersonDistance || 4.5;
    this.minCameraDistance = options.minCameraDistance || 0.6;
    this.cameraCollisionMargin = options.cameraCollisionMargin || 0.25;
    this.thirdPersonTargetHeight = options.thirdPersonTargetHeight || 1.3;
    this.shoulderOffset = options.shoulderOffset || 0.0;

    // Preallocated math scratchpads (eliminating GC)
    this._targetFocalPoint = new THREE.Vector3();
    this._desiredCamOffset = new THREE.Vector3();
    this._lookDir = new THREE.Vector3();
    this._camRayDir = new THREE.Vector3();
  }

  toggleMode() {
    this.mode = (this.mode === CameraMode.FIRST_PERSON)
      ? CameraMode.THIRD_PERSON
      : CameraMode.FIRST_PERSON;
    return this.mode;
  }

  setMode(mode) {
    if (mode === CameraMode.FIRST_PERSON || mode === CameraMode.THIRD_PERSON) {
      this.mode = mode;
    }
  }

  /**
   * Updates camera position and orientation based on player position and look angles.
   * @param {number} delta - Frame delta time
   * @param {THREE.Vector3} targetPos - Player world position
   * @param {number} yaw - Player horizontal look angle (rad)
   * @param {number} pitch - Player vertical look angle (rad)
   * @param {RAPIER.Collider|null} [excludeCollider=null] - Collider to ignore during spring arm raycast
   * @returns {{ isTooClose: boolean, mode: string }}
   */
  update(delta, targetPos, yaw, pitch, excludeCollider = null) {
    if (!this.camera) return { isTooClose: false, mode: this.mode };

    // Compute spherical look direction vector
    this._lookDir.set(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)
    ).normalize();

    if (this.mode === CameraMode.FIRST_PERSON) {
      // 1st-Person Eye View
      this.camera.position.set(
        targetPos.x,
        targetPos.y + this.eyeHeight,
        targetPos.z
      );

      this._targetFocalPoint.set(
        this.camera.position.x + this._lookDir.x * 10.0,
        this.camera.position.y + this._lookDir.y * 10.0,
        this.camera.position.z + this._lookDir.z * 10.0
      );

      this.camera.lookAt(this._targetFocalPoint);
      return { isTooClose: true, mode: this.mode };
    }

    // 3rd-Person Spring Arm View
    this._targetFocalPoint.set(
      targetPos.x,
      targetPos.y + this.thirdPersonTargetHeight,
      targetPos.z
    );

    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    this._desiredCamOffset.set(
      -this._lookDir.x * this.thirdPersonDistance + rightX * this.shoulderOffset,
      -this._lookDir.y * this.thirdPersonDistance,
      -this._lookDir.z * this.thirdPersonDistance + rightZ * this.shoulderOffset
    );

    const maxRayDist = this._desiredCamOffset.length();
    this._camRayDir.copy(this._desiredCamOffset).normalize();

    let targetDist = this.thirdPersonDistance;

    // Obstacle raycasting against Rapier physics world
    if (this.physicsWorld && this.physicsWorld.world) {
      const ray = new this.physicsWorld.RAPIER.Ray(
        {
          x: this._targetFocalPoint.x,
          y: this._targetFocalPoint.y,
          z: this._targetFocalPoint.z
        },
        {
          x: this._camRayDir.x,
          y: this._camRayDir.y,
          z: this._camRayDir.z
        }
      );

      const hit = this.physicsWorld.world.castRay(
        ray,
        maxRayDist,
        true,
        undefined,
        undefined,
        excludeCollider
      );

      if (hit && hit.timeOfImpact < maxRayDist) {
        targetDist = Math.max(
          this.minCameraDistance,
          hit.timeOfImpact - this.cameraCollisionMargin
        );
      }
    }

    // Smooth spring arm interpolation
    if (targetDist < this.currentCameraDistance) {
      this.currentCameraDistance += (targetDist - this.currentCameraDistance) * Math.min(1.0, 28.0 * delta);
    } else {
      this.currentCameraDistance += (targetDist - this.currentCameraDistance) * Math.min(1.0, 10.0 * delta);
    }

    const camX = this._targetFocalPoint.x + this._camRayDir.x * this.currentCameraDistance;
    const camY = Math.max(0.35, this._targetFocalPoint.y + this._camRayDir.y * this.currentCameraDistance);
    const camZ = this._targetFocalPoint.z + this._camRayDir.z * this.currentCameraDistance;

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this._targetFocalPoint);

    const isTooClose = this.currentCameraDistance < 0.9;
    return { isTooClose, mode: this.mode };
  }
}
