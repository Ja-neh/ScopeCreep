import * as THREE from 'three';
import { BaseEntity } from './BaseEntity.js';
import { ArtilleryTurret } from './ship-components/ArtilleryTurret.js';
import { FlakTurret } from './ship-components/FlakTurret.js';
import { HelmStation } from './ship-components/HelmStation.js';
import { createBattleshipModel } from './models/BattleshipModel.js';

/**
 * Battleship
 * Composite warship assembled from modular components:
 * - Ship Body: Hull, Walking Deck, Bridge Superstructure, and Citadel (via BattleshipModel)
 * - Main Gun: Forward deck heavy artillery turret (Child of Battleship)
 * - Flak Turret: Aft deck anti-air gun battery (Child of Battleship)
 * - Helm Station: Handles buoyancy, rudder steering, and locomotion
 */
export class Battleship extends BaseEntity {
  constructor(gameWorld, options = {}) {
    super('Battleship');
    this.gameWorld = gameWorld;
    this.position = options.position || new THREE.Vector3(0, 0, 0);
    this.water = options.water || null;

    // Relative operational stations
    this.stations = {
      helmsman: new THREE.Vector3(0, 9.5, -4),       // Elevated bridge
      artilleryGunner: new THREE.Vector3(0, 4.4, -22), // Fore deck heavy cannon
      flakGunner: new THREE.Vector3(0, 6.6, 16),      // Aft elevated flak mount
      engineer: new THREE.Vector3(0, 3.2, 3)          // Midship citadel
    };

    // 1. Build the Ship Base (Hull, Deck, Superstructure via BattleshipModel)
    this.mesh = createBattleshipModel(this.stations);

    // 2. Instantiate Guns as Children of the Ship Hierarchy
    this.mainGun = new ArtilleryTurret({ position: this.stations.artilleryGunner, gameWorld: this.gameWorld, battleship: this });
    this.mesh.add(this.mainGun.mesh); // Child of ship

    this.flakTurret = new FlakTurret({ position: this.stations.flakGunner, gameWorld: this.gameWorld, battleship: this });
    this.mesh.add(this.flakTurret.mesh); // Child of ship

    // 3. Attach Helm Station (Buoyancy, Steering, Propulsion)
    this.shipController = new HelmStation(this, {
      draft: 1.0,
      input: options.input || null
    });

    // Set initial overall ship position
    this.mesh.position.copy(this.position);

    // Collider debug visualization group
    this.colliderDebugGroup = null;

    // Platform delta kinematics tracking for walking characters (multiplayer-ready)
    this._prevMatrixWorld = new THREE.Matrix4();
    this._currMatrixWorld = new THREE.Matrix4();
    this._invPrevMatrixWorld = new THREE.Matrix4();
    this._hasPrevMatrix = false;
    this._tempPoint = new THREE.Vector3();
  }

  /**
   * Set active water surface for buoyancy
   */
  setWater(waterMesh) {
    this.water = waterMesh;
  }

  /**
   * Initialize Rapier Compound Cuboid physics for the ship
   */
  initPhysics(physicsWorld) {
    this.physicsWorld = physicsWorld;
    if (physicsWorld && physicsWorld.world) {
      this.collider = physicsWorld.createCompoundCuboidsFromObject(this.mesh);
      console.log(`Battleship Rapier Compound Cuboid colliders created (${this.collider.colliders.length} boxes).`);
      this._createColliderDebugMesh();
    }
  }

  /**
   * Generates a high-contrast wireframe and semi-transparent visual mesh
   * representing the exact Cuboid colliders loaded into Rapier.
   */
  _createColliderDebugMesh() {
    if (!this.collider || !this.collider.debugBoxes) return;

    this.colliderDebugGroup = new THREE.Group();
    this.colliderDebugGroup.name = 'Battleship_Collider_Debug';
    this.colliderDebugGroup.userData = { noCollision: true };

    const surfaceMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const wireframeMat = new THREE.MeshBasicMaterial({
      color: 0x39ff14,
      wireframe: true,
      transparent: true,
      opacity: 0.85
    });

    for (const box of this.collider.debugBoxes) {
      const geom = new THREE.BoxGeometry(
        box.halfExtents.x * 2,
        box.halfExtents.y * 2,
        box.halfExtents.z * 2
      );

      const surfaceMesh = new THREE.Mesh(geom, surfaceMat);
      surfaceMesh.position.copy(box.position);
      surfaceMesh.quaternion.copy(box.quaternion);
      surfaceMesh.userData = { noCollision: true };
      this.colliderDebugGroup.add(surfaceMesh);

      const wireframeMesh = new THREE.Mesh(geom, wireframeMat);
      wireframeMesh.position.copy(box.position);
      wireframeMesh.quaternion.copy(box.quaternion);
      wireframeMesh.userData = { noCollision: true };
      this.colliderDebugGroup.add(wireframeMesh);
    }

    this.colliderDebugGroup.visible = false;
    this.mesh.add(this.colliderDebugGroup);
  }

  /**
   * Set visibility of the battleship collider debug wireframe
   */
  setColliderDebugVisible(visible) {
    if (this.colliderDebugGroup) {
      this.colliderDebugGroup.visible = visible;
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
   * Checks if a world position is within the walking platform bounds of the battleship
   */
  isPointOnPlatform(worldPos) {
    if (!this.mesh) return false;
    this._tempPoint.copy(worldPos);
    this.mesh.worldToLocal(this._tempPoint);
    // Local bounds: hull width 14m (halfX=7), deck length 68m (halfZ=34)
    // Generous margins (+1.5m) to catch ramps and edge stairs
    return (
      Math.abs(this._tempPoint.x) <= 8.5 &&
      Math.abs(this._tempPoint.z) <= 36.0 &&
      this._tempPoint.y >= 0.0 &&
      this._tempPoint.y <= 16.0
    );
  }

  /**
   * Computes the exact 6-DOF world displacement of a point caused by ship translation, heave, yaw, pitch, and roll
   * @param {THREE.Vector3} worldPos - Point in world space
   * @param {THREE.Vector3} out - Result vector
   * @returns {THREE.Vector3}
   */
  getPlatformDisplacement(worldPos, out = new THREE.Vector3()) {
    if (!this._hasPrevMatrix) {
      return out.set(0, 0, 0);
    }
    // Point in previous local space
    this._tempPoint.copy(worldPos).applyMatrix4(this._invPrevMatrixWorld);
    // Point in current world space
    this._tempPoint.applyMatrix4(this._currMatrixWorld);
    // Displacement = newWorldPoint - originalWorldPoint
    return out.subVectors(this._tempPoint, worldPos);
  }

  /**
   * Phase 2 (Pre-Physics): Updates vessel propulsion, wave buoyancy kinematics,
   * platform displacement matrices, and sets Rapier rigid body transforms BEFORE physics step.
   */
  prePhysicsUpdate(delta) {
    // 0. Update previous world matrix for platform delta kinematics
    if (!this._hasPrevMatrix) {
      this.mesh.updateMatrixWorld(true);
      this._prevMatrixWorld.copy(this.mesh.matrixWorld);
      this._invPrevMatrixWorld.copy(this._prevMatrixWorld).invert();
      this._hasPrevMatrix = true;
    } else {
      this._prevMatrixWorld.copy(this._currMatrixWorld);
      this._invPrevMatrixWorld.copy(this._prevMatrixWorld).invert();
    }

    // 1. Update Ship Controller (Propulsion, steering, wave buoyancy, & helmsman interaction)
    if (this.shipController) {
      this.shipController.update(delta, this.water, this.gameWorld);
    }

    // Update current world matrix after ship motion
    this.mesh.updateMatrixWorld(true);
    this._currMatrixWorld.copy(this.mesh.matrixWorld);

    // 2. Synchronize Rapier Kinematic Rigid Body with Ship Mesh Transform BEFORE physics step
    if (this.collider && this.collider.rigidBody) {
      const pos = {
        x: this.mesh.position.x,
        y: this.mesh.position.y,
        z: this.mesh.position.z
      };
      const rot = {
        x: this.mesh.quaternion.x,
        y: this.mesh.quaternion.y,
        z: this.mesh.quaternion.z,
        w: this.mesh.quaternion.w
      };
      // Instant spatial update so Rapier collision queries see the current frame's position immediately
      this.collider.rigidBody.setTranslation(pos, true);
      this.collider.rigidBody.setRotation(rot, true);
      this.collider.rigidBody.setNextKinematicTranslation(pos);
      this.collider.rigidBody.setNextKinematicRotation(rot);
    }

    // 3. Update Gun Systems
    if (this.mainGun) {
      this.mainGun.update(delta, this.gameWorld);
    }
    if (this.flakTurret) {
      this.flakTurret.update(delta, this.gameWorld);
    }
  }

  /**
   * Backward-compatible update method (delegates to prePhysicsUpdate)
   */
  update(delta) {
    this.prePhysicsUpdate(delta);
  }

  dispose() {
    if (this.colliderDebugGroup) {
      if (this.colliderDebugGroup.parent) {
        this.colliderDebugGroup.parent.remove(this.colliderDebugGroup);
      }
      this.colliderDebugGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      this.colliderDebugGroup = null;
    }

    if (this.collider && this.physicsWorld && this.physicsWorld.world) {
      if (this.collider.rigidBody) {
        this.physicsWorld.world.removeRigidBody(this.collider.rigidBody);
      } else {
        this.physicsWorld.world.removeCollider(this.collider, true);
      }
      this.collider = null;
    }

    if (this.shipController) {
      this.shipController.dispose();
      this.shipController = null;
    }

    if (this.mainGun) {
      this.mainGun.dispose();
      this.mainGun = null;
    }
    if (this.flakTurret) {
      this.flakTurret.dispose();
      this.flakTurret = null;
    }

    this.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }

    super.dispose();
  }
}
