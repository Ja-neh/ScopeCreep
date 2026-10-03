import * as THREE from 'three';
import { loadBattleshipModel } from '../../entities/models/BattleshipModel.js';
import { extractTrimeshGeometryFromObject } from '../../core/ThreePhysicsAdapter.js';

/**
 * AnchoredShip
 * Our battleship as a static prop: the same model and hull colliders as Level 1's Battleship,
 * but on a fixed body with no helm, guns, buoyancy or health. Used where the ship only needs
 * to be stood on and looked at, such as Level 2's landing.
 * Gun turrets are visual only here (their colliders belong to the moving Battleship rig).
 */
export class AnchoredShip {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {THREE.Vector3} options.position - World position (y = 0 sits the waterline on the sea)
   * @param {number} [options.heading] - Rotation about Y in radians
   */
  constructor(gameWorld, { position, heading = 0 }) {
    this.gameWorld = gameWorld;
    this.physicsWorld = gameWorld.physics;

    this.mesh = new THREE.Group();
    this.mesh.name = 'AnchoredShip';
    this.mesh.position.copy(position);
    this.mesh.rotation.y = heading;
    this.mesh.updateMatrixWorld(true);

    this.rigidBody = null;
    this.collider = null;
  }

  /**
   * Loads the model and builds the hull collider.
   */
  async load() {
    const modelData = await loadBattleshipModel();
    this.mesh.add(modelData.root);
    this.mesh.updateMatrixWorld(true);

    const geometry = extractTrimeshGeometryFromObject(this.mesh);
    if (!geometry) {
      console.warn('[AnchoredShip] No hull collider geometry found.');
      return;
    }

    this.rigidBody = this.physicsWorld.createFixedRigidBody({
      position: this.mesh.position,
      rotation: this.mesh.quaternion
    });
    this.collider = this.physicsWorld.createTrimeshCollider(geometry.vertices, geometry.indices, this.rigidBody);
    if (this.collider) {
      this.collider.userData = { isShip: true };
    }
  }

  /**
   * Converts a point in the ship's local frame (bow along -Z, deck at y ≈ 4.92) to world space.
   */
  localToWorld(x, y, z, out = new THREE.Vector3()) {
    return this.mesh.localToWorld(out.set(x, y, z));
  }

  dispose() {
    if (this.rigidBody) {
      this.physicsWorld.removeRigidBody(this.rigidBody);
      this.rigidBody = null;
      this.collider = null;
    }

    this.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    });
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}
