import * as THREE from 'three';
import { extractTrimeshGeometryFromObject, extractMeshGeometry } from '../../core/ThreePhysicsAdapter.js';

/**
 * BattleshipColliders
 * Manages static hull trimeshes, dynamic rotating gun colliders,
 * kinematic transform synchronization, and collider debug wireframes.
 */
export class BattleshipColliders {
  /**
   * @param {Battleship} battleship
   */
  constructor(battleship) {
    this.battleship = battleship;
    this.physicsWorld = null;

    // Rapier physics handles
    this.rigidBody = null;
    this.collider = null;
    this.gunColliders = [];

    // Debug wireframe meshes
    this.colliderDebugGroup = null;
    this.dynamicColliderDebugMeshes = [];

    // Preallocated math scratchpads (eliminating GC)
    this._tempShipInv = new THREE.Matrix4();
    this._tempLocalMat = new THREE.Matrix4();
    this._tempColPos = new THREE.Vector3();
    this._tempColQuat = new THREE.Quaternion();
    this._tempColScale = new THREE.Vector3();
  }

  /**
   * Builds hull trimesh collider and dynamic rotating gun colliders in Rapier
   * @param {PhysicsWorld} physicsWorld
   * @param {Object} modelData
   */
  buildColliders(physicsWorld, modelData) {
    this.physicsWorld = physicsWorld;
    if (!physicsWorld || this.collider) return;

    // 1. Static ship TriMesh (Hull & Superstructure)
    const geomData = extractTrimeshGeometryFromObject(this.battleship.mesh);
    if (!geomData) return;

    this.rigidBody = physicsWorld.createKinematicRigidBody({
      position: this.battleship.mesh.position,
      rotation: this.battleship.mesh.quaternion
    });
    if (!this.rigidBody) return;

    this.collider = physicsWorld.createTrimeshCollider(geomData.vertices, geomData.indices, this.rigidBody);
    if (!this.collider) return;
    this.collider.userData = { entity: this.battleship };

    console.log('[BattleshipColliders] Static hull collider created.');

    // 2. Dynamic rotating gun & barrel TriMesh colliders attached to the ship rigid body
    this.gunColliders = [];
    if (modelData && modelData.dynamicGunColliders) {
      for (const colMesh of modelData.dynamicGunColliders) {
        const gunGeom = extractMeshGeometry(colMesh);
        if (gunGeom) {
          const rapierCol = physicsWorld.createTrimeshCollider(gunGeom.vertices, gunGeom.indices, this.rigidBody);
          if (rapierCol) {
            rapierCol.userData = { entity: this.battleship };
            this.gunColliders.push({
              mesh: colMesh,
              rapierCollider: rapierCol
            });
            this._syncGunColliderTransform(colMesh, rapierCol);
          }
        }
      }
      console.log(`[BattleshipColliders] Rigged ${this.gunColliders.length} dynamic gun colliders.`);
    }

    this._createColliderDebugMesh();
  }

  /**
   * Synchronizes Rapier kinematic rigid body with Battleship mesh transform before physics step
   */
  syncRigidBodyTransform() {
    if (!this.rigidBody) return;

    const pos = {
      x: this.battleship.mesh.position.x,
      y: this.battleship.mesh.position.y,
      z: this.battleship.mesh.position.z
    };
    const rot = {
      x: this.battleship.mesh.quaternion.x,
      y: this.battleship.mesh.quaternion.y,
      z: this.battleship.mesh.quaternion.z,
      w: this.battleship.mesh.quaternion.w
    };

    this.rigidBody.setNextKinematicTranslation(pos);
    this.rigidBody.setNextKinematicRotation(rot);
  }

  /**
   * Synchronizes dynamic rotating gun colliders with Rapier before physics step
   */
  syncGunColliders() {
    if (!this.gunColliders || this.gunColliders.length === 0) return;

    this.battleship.mesh.updateMatrixWorld(true);
    for (const entry of this.gunColliders) {
      this._syncGunColliderTransform(entry.mesh, entry.rapierCollider);
    }
  }

  /**
   * Synchronizes a single dynamic gun collider's transform with respect to the ship rigid body
   */
  _syncGunColliderTransform(colMesh, rapierCol) {
    this._tempShipInv.copy(this.battleship.mesh.matrixWorld).invert();
    this._tempLocalMat.multiplyMatrices(this._tempShipInv, colMesh.matrixWorld);
    this._tempLocalMat.decompose(this._tempColPos, this._tempColQuat, this._tempColScale);
    rapierCol.setTranslationWrtParent(this._tempColPos);
    rapierCol.setRotationWrtParent(this._tempColQuat);
  }

  /**
   * Generates a wireframe visual mesh representing the exact colliders loaded into Rapier
   */
  _createColliderDebugMesh() {
    if (!this.collider) return;

    this.colliderDebugGroup = new THREE.Group();
    this.colliderDebugGroup.name = 'Battleship_Collider_Debug';
    this.colliderDebugGroup.userData = { noCollision: true };

    const wireframeMat = new THREE.MeshBasicMaterial({
      color: 0x39ff14,
      wireframe: true,
      transparent: true,
      opacity: 0.85
    });

    // 1. Static ship hull & superstructure collider wireframe
    if (this.collider.debugGeometry) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(this.collider.debugGeometry.vertices, 3));
      geom.setIndex(this.collider.debugGeometry.indices);
      const debugMesh = new THREE.Mesh(geom, wireframeMat);
      debugMesh.userData = { noCollision: true };
      this.colliderDebugGroup.add(debugMesh);
    }

    // 2. Dynamic gun & barrel collider wireframes (parented to colMesh so they visually rotate with the guns)
    this.dynamicColliderDebugMeshes = [];
    if (this.gunColliders) {
      for (const entry of this.gunColliders) {
        if (entry.mesh && entry.mesh.geometry) {
          const gunDebugMesh = new THREE.Mesh(entry.mesh.geometry, wireframeMat);
          gunDebugMesh.userData = { noCollision: true };
          gunDebugMesh.visible = false;
          entry.mesh.add(gunDebugMesh);
          this.dynamicColliderDebugMeshes.push(gunDebugMesh);
        }
      }
    }

    this.colliderDebugGroup.visible = false;
    this.battleship.mesh.add(this.colliderDebugGroup);
  }

  /**
   * Set visibility of the battleship collider debug wireframe
   */
  setColliderDebugVisible(visible) {
    if (this.colliderDebugGroup) {
      this.colliderDebugGroup.visible = visible;
      this.colliderDebugGroup.traverse((child) => {
        if (child.isMesh) child.visible = visible;
      });
    }
    if (this.dynamicColliderDebugMeshes) {
      for (const m of this.dynamicColliderDebugMeshes) {
        m.visible = visible;
      }
    }
  }

  /**
   * Toggle visibility of the battleship collider debug wireframe
   */
  toggleColliderDebug() {
    if (this.colliderDebugGroup) {
      this.setColliderDebugVisible(!this.colliderDebugGroup.visible);
      return this.colliderDebugGroup.visible;
    }
    return false;
  }

  /**
   * Cleans up all physics bodies, colliders, and wireframe meshes
   */
  dispose() {
    // 1. Clean up static collider wireframe group
    if (this.colliderDebugGroup) {
      if (this.colliderDebugGroup.parent) {
        this.colliderDebugGroup.parent.remove(this.colliderDebugGroup);
      }
      this.colliderDebugGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
      this.colliderDebugGroup = null;
    }

    // 2. Clean up dynamic gun collider debug wireframes
    if (this.dynamicColliderDebugMeshes && this.dynamicColliderDebugMeshes.length > 0) {
      for (const mesh of this.dynamicColliderDebugMeshes) {
        if (mesh.parent) mesh.parent.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
          else mesh.material.dispose();
        }
      }
      this.dynamicColliderDebugMeshes = [];
    }

    // 3. Remove dynamic gun colliders from Rapier
    if (this.gunColliders && this.gunColliders.length > 0) {
      if (this.physicsWorld) {
        for (const entry of this.gunColliders) {
          if (entry.rapierCollider) {
            this.physicsWorld.removeCollider(entry.rapierCollider, true);
          }
        }
      }
      this.gunColliders = [];
    }

    // 4. Remove static collider and rigid body from Rapier
    if (this.collider && this.physicsWorld) {
      if (this.rigidBody) {
        this.physicsWorld.removeRigidBody(this.rigidBody);
        this.rigidBody = null;
      } else {
        this.physicsWorld.removeCollider(this.collider, true);
      }
      this.collider = null;
    }
  }
}
