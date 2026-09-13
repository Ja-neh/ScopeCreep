import * as THREE from 'three';
import { BaseEntity } from './BaseEntity.js';
import { ArtilleryTurret } from './ship-components/ArtilleryTurret.js';
import { FlakTurret } from './ship-components/FlakTurret.js';
import { HelmStation } from './ship-components/HelmStation.js';
import { loadBattleshipModel } from './models/BattleshipModel.js';
import { HealthComponent } from './components/HealthComponent.js';
import config from '../config.json';

/**
 * Battleship
 * Warship assembled from imported 3D asset with integrated colliders:
 * - Ship Body: Hull, Walking Deck, Bridge Superstructure, and Citadel
 * - Main Gun: Forward deck heavy artillery turret
 * - Flak Turret: Aft deck anti-air gun battery
 * - Helm Station: Handles buoyancy, rudder steering, and locomotion
 */
export class Battleship extends BaseEntity {
  constructor(gameWorld, options = {}) {
    super('Battleship');
    this.gameWorld = gameWorld;
    this.position = options.position || new THREE.Vector3(0, 0, 0);
    this.water = options.water || null;
    this.health = new HealthComponent(options.maxHealth ?? config.ship.health.maxHealth);
    this.isDestroyed = false;
    this.health.onDeath = () => {
      this.isDestroyed = true;
      if (this.shipController) this.shipController.speed = 0;
      if (this.mesh) this.mesh.visible = false;
      this._updateHealthUI();
    };

    // Relative operational stations matching imported model Areas
    this.stations = {
      helmsman: new THREE.Vector3(5.47, 5.26, 17.22),          // Bridge AreaHelm
      artilleryGunner: new THREE.Vector3(0.46, 5.30, -17.09),    // Fore deck main gun AreaMainGunFront
      artilleryGunnerBack: new THREE.Vector3(0.46, 6.75, -5.82),// Raised fore deck main gun AreaMainGunBack
      flakGunner: new THREE.Vector3(0.46, 5.36, 25.63),         // Aft deck anti-air gun AreaAntiAirGun
      engineer: new THREE.Vector3(0, 5.3, 0)                   // Midship citadel
    };

    // 1. Root group representing the battleship vessel
    this.mesh = new THREE.Group();
    this.mesh.name = 'Battleship';
    this.mesh.position.copy(this.position);
    this.mesh.userData.entity = this;
    this._createHealthUI();

    // 2. Instantiate Gun Stations as Children of the Ship Hierarchy
    this.mainGun = new ArtilleryTurret({
      name: 'MainGunFront',
      title: 'FORWARD ARTILLERY TURRET',
      promptText: 'OPERATE FORWARD ARTILLERY GUN',
      position: this.stations.artilleryGunner,
      gameWorld: this.gameWorld,
      battleship: this
    });
    this.mesh.add(this.mainGun.mesh);

    this.mainGunBack = new ArtilleryTurret({
      name: 'MainGunBack',
      title: 'REAR ARTILLERY TURRET',
      promptText: 'OPERATE REAR ARTILLERY GUN',
      position: this.stations.artilleryGunnerBack,
      gameWorld: this.gameWorld,
      battleship: this
    });
    this.mesh.add(this.mainGunBack.mesh);

    this.flakTurret = new FlakTurret({
      position: this.stations.flakGunner,
      gameWorld: this.gameWorld,
      battleship: this
    });
    this.mesh.add(this.flakTurret.mesh);

    // 3. Attach Helm Station (Buoyancy, Steering, Propulsion)
    this.shipController = new HelmStation(this, {
      draft: 1.0,
      input: options.input || null
    });

    // Model loading & Physics tracking
    this.modelData = null;
    this.physicsWorld = null;
    this._pendingPhysicsWorld = null;
    this.colliderDebugGroup = null;

    // Platform delta kinematics tracking for walking characters (multiplayer-ready)
    this._prevMatrixWorld = new THREE.Matrix4();
    this._currMatrixWorld = new THREE.Matrix4();
    this._invPrevMatrixWorld = new THREE.Matrix4();
    this._hasPrevMatrix = false;
    this._tempPoint = new THREE.Vector3();

    // Dynamic rotating gun and barrel colliders tracking
    this.gunColliders = [];
    this._tempShipInv = new THREE.Matrix4();
    this._tempLocalMat = new THREE.Matrix4();
    this._tempColPos = new THREE.Vector3();
    this._tempColQuat = new THREE.Quaternion();
    this._tempColScale = new THREE.Vector3();

    // Begin asynchronous model load immediately
    this.ready = this.loadModel(options.modelUrl);
  }

  /**
   * Loads the imported battleship model, attaches gun meshes, and sets up colliders.
   */
  async loadModel(modelUrl) {
    if (this.modelData) return this.modelData;

    try {
      this.modelData = await loadBattleshipModel({ modelUrl });
      this.mesh.add(this.modelData.root);

      // Update station locations from the model if available
      if (this.modelData.stations) {
        if (this.modelData.stations.helmsman) {
          this.stations.helmsman.copy(this.modelData.stations.helmsman);
          if (this.shipController && this.shipController.setStationPosition) {
            this.shipController.setStationPosition(this.stations.helmsman);
          }
        }
        if (this.modelData.stations.artilleryGunner) {
          this.stations.artilleryGunner.copy(this.modelData.stations.artilleryGunner);
          this.mainGun.mesh.position.copy(this.stations.artilleryGunner);
        }
        if (this.modelData.stations.artilleryGunner2) {
          this.stations.artilleryGunnerBack.copy(this.modelData.stations.artilleryGunner2);
          this.mainGunBack.mesh.position.copy(this.stations.artilleryGunnerBack);
        }
        if (this.modelData.stations.flakGunner) {
          this.stations.flakGunner.copy(this.modelData.stations.flakGunner);
          this.flakTurret.mesh.position.copy(this.stations.flakGunner);
        }
      }

      // Attach model gun and barrel meshes to interactive turret controllers
      if (this.modelData.guns) {
        if (this.modelData.guns.mainGunFront && this.modelData.guns.mainGunFrontBarrel) {
          this.mainGun.attachTurretNodes(
            this.modelData.guns.mainGunFront,
            this.modelData.guns.mainGunFrontBarrel
          );
        }
        if (this.modelData.guns.mainGunBack && this.modelData.guns.mainGunBackBarrel) {
          this.mainGunBack.attachTurretNodes(
            this.modelData.guns.mainGunBack,
            this.modelData.guns.mainGunBackBarrel
          );
        }
        if (this.modelData.guns.antiAirGun && this.modelData.guns.antiAirBarrels) {
          this.flakTurret.attachTurretNodes(
            this.modelData.guns.antiAirGun,
            this.modelData.guns.antiAirBarrels
          );
        }
      }

      // If initPhysics was called while the model was still loading, create colliders now
      if (this._pendingPhysicsWorld && !this.collider) {
        this._buildPhysicsColliders(this._pendingPhysicsWorld);
        this._pendingPhysicsWorld = null;
      }

      return this.modelData;
    } catch (err) {
      console.error('[Battleship] Error loading battleship model:', err);
      throw err;
    }
  }

  /**
   * Set active water surface for buoyancy
   */
  setWater(waterMesh) {
    this.water = waterMesh;
  }

  /**
   * Initialize Rapier TriMesh physics for the ship using imported colliders
   */
  initPhysics(physicsWorld) {
    this.physicsWorld = physicsWorld;
    if (!physicsWorld || !physicsWorld.world) return;

    if (this.modelData) {
      this._buildPhysicsColliders(physicsWorld);
    } else {
      this._pendingPhysicsWorld = physicsWorld;
    }
  }

  _buildPhysicsColliders(physicsWorld) {
    if (!physicsWorld || !physicsWorld.world || this.collider) return;

    // 1. Static ship TriMesh (Hull & Superstructure)
    // createTrimeshFromObject filters out nodes with userData.noCollision = true
    // (set on visual meshes, stations, and dynamic gun colliders)
    this.collider = physicsWorld.createTrimeshFromObject(this.mesh);
    if (!this.collider) return;
    this.collider.userData = { entity: this };

    console.log('Battleship Rapier TriMesh static colliders created from imported model.');

    // 2. Rig dynamic rotating gun & barrel TriMesh colliders attached to the ship's kinematic rigid body
    this.gunColliders = [];
    if (this.modelData && this.modelData.dynamicGunColliders) {
      for (const colMesh of this.modelData.dynamicGunColliders) {
        const rapierCol = physicsWorld.createTrimeshColliderForMesh(colMesh, this.collider.rigidBody);
        if (rapierCol) {
          this.gunColliders.push({
            mesh: colMesh,
            rapierCollider: rapierCol
          });
          this._syncGunColliderTransform(colMesh, rapierCol);
        }
      }
      console.log(`Battleship rigged ${this.gunColliders.length} dynamic gun & barrel colliders to track rotation.`);
    }

    this._createColliderDebugMesh();
  }

  /**
   * Synchronizes a dynamic gun collider's transform with respect to the ship rigid body
   */
  _syncGunColliderTransform(colMesh, rapierCol) {
    this._tempShipInv.copy(this.mesh.matrixWorld).invert();
    this._tempLocalMat.multiplyMatrices(this._tempShipInv, colMesh.matrixWorld);
    this._tempLocalMat.decompose(this._tempColPos, this._tempColQuat, this._tempColScale);
    rapierCol.setTranslationWrtParent(this._tempColPos);
    rapierCol.setRotationWrtParent(this._tempColQuat);
  }

  /**
   * Generates a wireframe visual mesh representing the exact colliders loaded into Rapier.
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

    // 2. Dynamic gun & barrel colliders wireframes (parented to colMesh so they visually rotate with the guns)
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
    this.mesh.add(this.colliderDebugGroup);
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

  _createHealthUI() {
    this.healthPanel = document.createElement('div');
    this.healthPanel.id = 'battleship-health';
    this.healthPanel.style.cssText = `
      position: fixed;
      top: 18px;
      right: 18px;
      width: 230px;
      padding: 10px 12px;
      border: 1px solid rgba(148, 163, 184, 0.5);
      border-radius: 6px;
      background: rgba(15, 23, 42, 0.88);
      color: #f8fafc;
      font: 700 12px/1.3 monospace;
      pointer-events: none;
      z-index: 9999;
    `;
    this.healthPanel.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <span>WARSHIP HULL</span><span data-role="health-text"></span>
      </div>
      <div style="height:8px;background:#334155;border-radius:4px;overflow:hidden;">
        <div data-role="health-fill" style="height:100%;width:100%;background:#22c55e;transition:width .15s,background .15s;"></div>
      </div>
    `;
    document.body.appendChild(this.healthPanel);
    this.healthText = this.healthPanel.querySelector('[data-role="health-text"]');
    this.healthFill = this.healthPanel.querySelector('[data-role="health-fill"]');
    this._updateHealthUI();
  }

  _updateHealthUI() {
    if (!this.healthText || !this.healthFill) return;
    const ratio = Math.max(0, this.health.currentHealth / this.health.maxHealth);
    this.healthText.textContent = this.isDestroyed
      ? 'DESTROYED'
      : `${Math.ceil(this.health.currentHealth)} / ${this.health.maxHealth}`;
    this.healthFill.style.width = `${ratio * 100}%`;
    this.healthFill.style.background = ratio > 0.5 ? '#22c55e' : ratio > 0.25 ? '#f59e0b' : '#ef4444';
  }

  /**
   * Checks if a world position is within the walking platform bounds of the battleship
   */
  isPointOnPlatform(worldPos) {
    if (!this.mesh) return false;
    this._tempPoint.copy(worldPos);
    this.mesh.worldToLocal(this._tempPoint);
    // Local bounds: hull width ~21.4m (halfX=10.7), deck length ~99.6m (halfZ=49.8)
    // Generous margins (+1.5m) to catch ramps and edge stairs
    return (
      Math.abs(this._tempPoint.x) <= 12.0 &&
      Math.abs(this._tempPoint.z) <= 52.0 &&
      this._tempPoint.y >= 0.0 &&
      this._tempPoint.y <= 36.0
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
    this._updateHealthUI();

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
    if (this.mainGunBack) {
      this.mainGunBack.update(delta, this.gameWorld);
    }
    if (this.flakTurret) {
      this.flakTurret.update(delta, this.gameWorld);
    }

    // 4. Synchronize dynamic gun & barrel colliders with Rapier before physics step
    if (this.gunColliders && this.gunColliders.length > 0) {
      this.mesh.updateMatrixWorld(true);
      for (const entry of this.gunColliders) {
        this._syncGunColliderTransform(entry.mesh, entry.rapierCollider);
      }
    }
  }

  /**
   * Backward-compatible update method (delegates to prePhysicsUpdate)
   */
  update(delta) {
    this.prePhysicsUpdate(delta);
  }

  dispose() {
    if (this.healthPanel && this.healthPanel.parentNode) {
      this.healthPanel.parentNode.removeChild(this.healthPanel);
    }
    this.healthPanel = null;

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

    if (this.gunColliders && this.gunColliders.length > 0) {
      if (this.physicsWorld && this.physicsWorld.world) {
        for (const entry of this.gunColliders) {
          if (entry.rapierCollider) {
            this.physicsWorld.world.removeCollider(entry.rapierCollider, true);
          }
        }
      }
      this.gunColliders = [];
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
    if (this.mainGunBack) {
      this.mainGunBack.dispose();
      this.mainGunBack = null;
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
