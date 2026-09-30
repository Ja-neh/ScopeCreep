import * as THREE from 'three';

/**
 * PlatformTracker
 * Tracks contact between the player avatar and moving platforms (such as the Battleship).
 * Inherits 6-DOF translation, heave, yaw, pitch, and roll while grounded, and prevents
 * mid-air trajectory warping when airborne.
 */
export class PlatformTracker {
  /**
   * @param {GameWorld} gameWorld
   */
  constructor(gameWorld) {
    this.gameWorld = gameWorld;
    this.currentPlatform = null;

    // Preallocated math scratchpad (eliminating GC)
    this._platformDisp = new THREE.Vector3();
  }

  /**
   * Resolves platform displacement for the current frame.
   * @param {THREE.Vector3} worldPos - Player world position
   * @param {boolean} isGrounded - Whether player is currently grounded
   * @param {Object|null} groundHit - Rapier raycast intersection from GroundProbe
   * @returns {THREE.Vector3} Vector containing the frame displacement
   */
  update(worldPos, isGrounded, groundHit) {
    // When airborne (jumping or falling), decouple from platform rotational displacement
    if (!isGrounded || !groundHit) {
      this.currentPlatform = null;
      return this._platformDisp.set(0, 0, 0);
    }

    // 1. Detect platform from ground hit collider
    let detectedPlatform = null;
    if (groundHit.collider && groundHit.collider.userData && groundHit.collider.userData.entity) {
      const entity = groundHit.collider.userData.entity;
      if (typeof entity.getPlatformDisplacement === 'function') {
        detectedPlatform = entity;
      }
    }

    // 2. Fallback detection if collider userData wasn't bound directly
    if (!detectedPlatform && this.gameWorld && this.gameWorld.entities) {
      for (const entity of this.gameWorld.entities) {
        if (entity && typeof entity.getPlatformDisplacement === 'function' && typeof entity.isPointOnPlatform === 'function') {
          if (entity.isPointOnPlatform(worldPos)) {
            detectedPlatform = entity;
            break;
          }
        }
      }
    }

    this.currentPlatform = detectedPlatform;

    // 3. Compute 6-DOF displacement from current platform
    if (this.currentPlatform && typeof this.currentPlatform.getPlatformDisplacement === 'function') {
      this.currentPlatform.getPlatformDisplacement(worldPos, this._platformDisp);
      return this._platformDisp;
    }

    return this._platformDisp.set(0, 0, 0);
  }
}
