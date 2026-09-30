import * as THREE from 'three';
import { BaseEntity } from './BaseEntity.js';
import { ArtilleryTurret } from './ship-components/ArtilleryTurret.js';
import { FlakTurret } from './ship-components/FlakTurret.js';
import { HelmStation } from './ship-components/HelmStation.js';
import { loadBattleshipModel } from './models/BattleshipModel.js';
import { HealthComponent } from './components/HealthComponent.js';
import { BattleshipColliders } from './ship-components/BattleshipColliders.js';
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
      this._updateHealth();
    };

    // Platform dimensions from config
    const platCfg = config.ship.platform || { halfWidth: 12.0, halfLength: 52.0, minHeight: -6.0, maxHeight: 40.0 };
    this.platformHalfWidth = platCfg.halfWidth;
    this.platformHalfLength = platCfg.halfLength;
    this.platformMinHeight = platCfg.minHeight;
    this.platformMaxHeight = platCfg.maxHeight;

    // Relative operational stations matching imported model Areas
    this.stations = {
      helmsman: new THREE.Vector3(5.47, 5.26, 17.22),           // Bridge AreaHelm
      artilleryGunner: new THREE.Vector3(0.46, 5.30, -17.09),     // Fore deck main gun AreaMainGunFront
      artilleryGunnerBack: new THREE.Vector3(0.46, 6.75, -5.82), // Raised fore deck main gun AreaMainGunBack
      flakGunner: new THREE.Vector3(0.46, 5.36, 25.63),          // Aft deck anti-air gun AreaAntiAirGun
      engineer: new THREE.Vector3(0, 5.3, 0)                    // Midship citadel
    };

    // 1. Root group representing the battleship vessel
    this.mesh = new THREE.Group();
    this.mesh.name = 'Battleship';
    this.mesh.position.copy(this.position);
    this.mesh.userData.entity = this;
    this._updateHealth();

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

    // 4. Collider & Physics Rigging Subsystem
    this.colliders = new BattleshipColliders(this);
    this.modelData = null;
    this.physicsWorld = null;
    this._pendingPhysicsWorld = null;

    // Platform delta kinematics tracking for walking characters (multiplayer-ready)
    this._prevMatrixWorld = new THREE.Matrix4();
    this._currMatrixWorld = new THREE.Matrix4();
    this._invPrevMatrixWorld = new THREE.Matrix4();
    this._hasPrevMatrix = false;
    this._tempPoint = new THREE.Vector3();

    // Begin asynchronous model load immediately
    this.ready = this.loadModel(options.modelUrl);
  }

  // Backward-compatible accessors
  get collider() {
    return this.colliders.collider;
  }

  get colliderDebugGroup() {
    return this.colliders.colliderDebugGroup;
  }

  get gunColliders() {
    return this.colliders.gunColliders;
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
      if (this._pendingPhysicsWorld && !this.colliders.collider) {
        this.colliders.buildColliders(this._pendingPhysicsWorld, this.modelData);
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
      this.colliders.buildColliders(physicsWorld, this.modelData);
    } else {
      this._pendingPhysicsWorld = physicsWorld;
    }
  }

  /**
   * Set visibility of the battleship collider debug wireframe
   */
  setColliderDebugVisible(visible) {
    this.colliders.setColliderDebugVisible(visible);
  }

  /**
   * Toggle visibility of the battleship collider debug wireframe
   */
  toggleColliderDebug() {
    return this.colliders.toggleColliderDebug();
  }

  _updateHealth() {
    if (this.gameWorld && this.gameWorld.ui) {
      this.gameWorld.ui.updateHealthBar(this.health.currentHealth, this.health.maxHealth, this.isDestroyed);
    }
  }

  /**
   * Checks if a world position is within the walking platform bounds of the battleship
   */
  isPointOnPlatform(worldPos) {
    if (!this.mesh) return false;
    this._tempPoint.copy(worldPos);
    this.mesh.worldToLocal(this._tempPoint);
    return (
      Math.abs(this._tempPoint.x) <= this.platformHalfWidth &&
      Math.abs(this._tempPoint.z) <= this.platformHalfLength &&
      this._tempPoint.y >= this.platformMinHeight &&
      this._tempPoint.y <= this.platformMaxHeight
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
    this._updateHealth();

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

    // 1. Update Ship Controller (Propulsion, steering, & helmsman interaction)
    if (this.shipController) {
      this.shipController.update(delta, this.water, this.gameWorld);
    }

    // Update current world matrix after ship motion
    this.mesh.updateMatrixWorld(true);
    this._currMatrixWorld.copy(this.mesh.matrixWorld);

    // 2. Synchronize Rapier Kinematic Rigid Body with Ship Mesh Transform BEFORE physics step.
    this.colliders.syncRigidBodyTransform();

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
    this.colliders.syncGunColliders();
  }

  /**
   * Phase 6 (Late Update): Updates camera positioning and spring-arm obstacle raycasting
   * after physical movements and platform displacements are complete.
   */
  lateUpdate(delta, gameWorld) {
    if (this.shipController && typeof this.shipController.lateUpdate === 'function') {
      this.shipController.lateUpdate(delta, gameWorld);
    }
  }


  dispose() {
    if (this.healthPanel && this.healthPanel.parentNode) {
      this.healthPanel.parentNode.removeChild(this.healthPanel);
    }
    this.healthPanel = null;

    // Disposes hull collider, rigid body, dynamic gun colliders, and all wireframe meshes
    this.colliders.dispose();

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

    if (this.gameWorld && this.gameWorld.ui) {
      this.gameWorld.ui.hideHealthBar();
    }

    super.dispose();
  }
}
