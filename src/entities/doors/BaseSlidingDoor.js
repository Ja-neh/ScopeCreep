import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BaseEntity } from '../BaseEntity.js';

/**
 * Shared GLTF cache to avoid loading the same door geometry multiple times.
 */
export const doorGLTFCache = new Map();

/**
 * Allows pre-seeding the cache (useful for tests or custom preloaded assets).
 */
export function setDoorGLTFCache(url, gltf) {
  doorGLTFCache.set(url, Promise.resolve(gltf));
}

/**
 * Helper to load a GLTF with fallback paths for Vite / production.
 */
export async function loadDoorGLTF(modelUrl, fallbackUrl) {
  if (doorGLTFCache.has(modelUrl)) {
    return doorGLTFCache.get(modelUrl);
  }

  const loader = new GLTFLoader();

  const promise = new Promise((resolve, reject) => {
    loader.load(
      modelUrl,
      (gltf) => resolve(gltf),
      undefined,
      (err) => {
        if (fallbackUrl && fallbackUrl !== modelUrl) {
          loader.load(
            fallbackUrl,
            (gltfFallback) => resolve(gltfFallback),
            undefined,
            (err2) => reject(err2)
          );
        } else {
          reject(err);
        }
      }
    );
  });

  doorGLTFCache.set(modelUrl, promise);
  return promise;
}

/**
 * BaseSlidingDoor
 * Abstract entity for modular sliding doors with:
 * - Dynamic tweened panel movement (no baked animations) between POS-*-CLOSED and POS-*-OPENED
 * - Proximity detection trigger (DETECT-*) opening automatically for player and NPCs
 * - Moving Rapier collider (COL-*) that updates in lockstep with the visual panel in Phase 2
 * - Compound collision support: attaches to a parent level/spaceship rigid body so the door
 *   never collides with surrounding walls, floors, or ceilings
 */
export class BaseSlidingDoor extends BaseEntity {
  /**
   * @param {Object} [gameWorld] - Master GameWorld context
   * @param {Object} [options]
   * @param {string} options.modelUrl - Primary path to the door GLB
   * @param {string} [options.fallbackUrl] - Fallback path if primary fails
   * @param {number} [options.openSpeed=2.0] - Opening speed in progress units per second (~0.5s to open)
   * @param {number} [options.closeSpeed=1.5] - Closing speed in progress units per second (~0.67s to close)
   * @param {number} [options.closeDelay=1.2] - Delay in seconds before closing after detection clears
   * @param {boolean} [options.autoOpen=true] - If true, automatically opens when occupant is detected
   * @param {boolean} [options.isLocked=false] - If true, door remains closed until unlocked
   * @param {THREE.Vector3|{x, y, z}} [options.position] - World position
   * @param {THREE.Euler|THREE.Quaternion|number} [options.rotation] - World rotation (or yaw angle in radians)
   */
  constructor(gameWorld = null, options = {}) {
    super(options.name || 'SlidingDoor');

    this.gameWorld = gameWorld;
    this.modelUrl = options.modelUrl || '';
    this.fallbackUrl = options.fallbackUrl || '';

    this.openSpeed = options.openSpeed !== undefined ? options.openSpeed : 2.0;
    this.closeSpeed = options.closeSpeed !== undefined ? options.closeSpeed : 1.5;
    this.closeDelay = options.closeDelay !== undefined ? options.closeDelay : 1.2;
    this.autoOpen = options.autoOpen !== undefined ? options.autoOpen : true;
    this.isLocked = options.isLocked !== undefined ? options.isLocked : false;

    // Movement progress: 0.0 = fully closed, 1.0 = fully open
    this.openProgress = 0.0;
    this.targetProgress = 0.0;
    this.closeTimer = 0.0;
    this.isOccupied = false;

    // Node references
    this.rootNode = null;
    this.panelMesh = null;
    this.colMesh = null;
    this.detectMesh = null;
    this.posClosedNode = null;
    this.posOpenedNode = null;

    // Relative transforms
    this.initialPanelPos = new THREE.Vector3();
    this.closedPos = new THREE.Vector3();
    this.openedPos = new THREE.Vector3();
    this.slideDelta = new THREE.Vector3();

    // Detection bounds
    this.detectLocalBox = new THREE.Box3();

    // Physics
    this.physicsWorld = null;
    this.rigidBody = null;
    this.collider = null;
    this.parentObject = null;
    this.isCompoundChild = false;
    this.colHalfExtents = new THREE.Vector3();
    this.colGeomCenter = new THREE.Vector3();

    // Preallocated math scratchpads (Phase 2 & Phase 5: zero hot-loop allocations)
    this._tempLocalPos = new THREE.Vector3();
    this._tempWorldPos = new THREE.Vector3();
    this._invDetectMatrix = new THREE.Matrix4();
    this._geomCenterTranslation = new THREE.Matrix4();
    this._effectiveColMat = new THREE.Matrix4();
    this._parentInvMatrix = new THREE.Matrix4();
    this._localColMat = new THREE.Matrix4();
    this._colPos = new THREE.Vector3();
    this._colQuat = new THREE.Quaternion();
    this._colScale = new THREE.Vector3();

    this.isLoaded = false;
    this.ready = null;

    if (this.modelUrl) {
      this.ready = this.init(options);
    }
  }

  /**
   * Loads the model and initializes node references and transforms.
   */
  async init(options = {}) {
    const modelUrl = options.modelUrl || this.modelUrl;
    const fallbackUrl = options.fallbackUrl || this.fallbackUrl;

    const gltf = await loadDoorGLTF(modelUrl, fallbackUrl);
    const scene = gltf.scene.clone(true);
    this.mesh = scene;
    this.rootNode = scene;

    // Discover nodes by name convention
    scene.traverse((node) => {
      const name = node.name;
      if (/^DETECT/i.test(name)) {
        this.detectMesh = node;
      } else if (/^COL/i.test(name)) {
        this.colMesh = node;
      } else if (/^POS.*CLOSED/i.test(name)) {
        this.posClosedNode = node;
      } else if (/^POS.*OPEN/i.test(name)) {
        this.posOpenedNode = node;
      } else if (/panel/i.test(name) && node.isMesh && !this.panelMesh) {
        this.panelMesh = node;
      }
    });

    // In these door models, colMesh's parent is reliably the sliding panel mesh
    if (this.colMesh && this.colMesh.parent && !this.panelMesh) {
      this.panelMesh = this.colMesh.parent;
    }

    if (!this.panelMesh) {
      console.warn(`[BaseSlidingDoor] Panel mesh not found in ${modelUrl}`);
    }

    // Hide collision and detection helper meshes from rendering
    if (this.detectMesh) {
      this.detectMesh.visible = false;
      this.detectMesh.userData = { noCollision: true };
      if (this.detectMesh.geometry) {
        this.detectMesh.geometry.computeBoundingBox();
        this.detectLocalBox.copy(this.detectMesh.geometry.boundingBox);
        // Expand vertically by +0.8m / -0.6m so players on varying floor heights trigger reliably
        this.detectLocalBox.min.y -= 0.6;
        this.detectLocalBox.max.y += 0.8;
      }
    }

    if (this.colMesh) {
      this.colMesh.visible = false;
      this.colMesh.userData = { noCollision: true };
      if (this.colMesh.geometry) {
        this.colMesh.geometry.computeBoundingBox();
        const box = this.colMesh.geometry.boundingBox;
        this.colHalfExtents.set(
          (box.max.x - box.min.x) * 0.5,
          (box.max.y - box.min.y) * 0.5,
          (box.max.z - box.min.z) * 0.5
        );
        this.colGeomCenter.set(
          (box.max.x + box.min.x) * 0.5,
          (box.max.y + box.min.y) * 0.5,
          (box.max.z + box.min.z) * 0.5
        );
        this._geomCenterTranslation.makeTranslation(
          this.colGeomCenter.x,
          this.colGeomCenter.y,
          this.colGeomCenter.z
        );
      }
    }

    if (this.posClosedNode) {
      this.posClosedNode.visible = false;
      this.closedPos.copy(this.posClosedNode.position);
    } else {
      this.closedPos.set(0, 0, 0);
    }

    if (this.posOpenedNode) {
      this.posOpenedNode.visible = false;
      this.openedPos.copy(this.posOpenedNode.position);
    } else {
      this.openedPos.set(0, 0, 0);
    }

    if (this.panelMesh) {
      this.initialPanelPos.copy(this.panelMesh.position);
      this.slideDelta.copy(this.openedPos).sub(this.closedPos);

      // Modular door panel material (stylized slate from Level 1 theme)
      if (options.panelMaterial) {
        this.panelMesh.material = options.panelMaterial;
      } else {
        const panelColor = options.panelColor !== undefined ? options.panelColor : 0x94a3b8;
        const panelRoughness = options.panelRoughness !== undefined ? options.panelRoughness : 0.5;
        const panelMetalness = options.panelMetalness !== undefined ? options.panelMetalness : 0.2;

        this.panelMesh.material = new THREE.MeshStandardMaterial({
          color: panelColor,
          roughness: panelRoughness,
          metalness: panelMetalness
        });
      }
      this.panelMesh.castShadow = true;
      this.panelMesh.receiveShadow = true;
    }

    // Apply initial position / rotation if supplied in options
    if (options.position) {
      this.setPosition(options.position.x, options.position.y, options.position.z);
    }
    if (options.rotation !== undefined) {
      if (typeof options.rotation === 'number') {
        this.setRotation(options.rotation);
      } else if (options.rotation.isQuaternion) {
        this.mesh.quaternion.copy(options.rotation);
      } else if (options.rotation.isEuler) {
        this.mesh.rotation.copy(options.rotation);
      }
    }

    this.mesh.updateMatrixWorld(true);
    this.isLoaded = true;

    return this;
  }

  /**
   * Set door world position
   */
  setPosition(x, y, z) {
    if (this.mesh) {
      this.mesh.position.set(x, y, z);
      this.mesh.updateMatrixWorld(true);
    }
  }

  /**
   * Set door yaw rotation (or full Euler)
   */
  setRotation(yaw, pitch = 0, roll = 0) {
    if (this.mesh) {
      this.mesh.rotation.set(pitch, yaw, roll);
      this.mesh.updateMatrixWorld(true);
    }
  }

  /**
   * Initializes the Rapier physics collider for the moving panel.
   *
   * @param {PhysicsWorld} physicsWorld
   * @param {RAPIER.RigidBody} [parentRigidBody=null] - If provided, the door's collider is added directly
   *   to this rigid body (e.g. the spaceship or level compound body). This guarantees the door's collider
   *   never collides with surrounding walls, floors, or ceilings!
   * @param {THREE.Object3D} [parentObject=null] - Three.js Object3D corresponding to parentRigidBody.
   *   Defaults to this.mesh.parent or this.mesh.
   */
  initPhysics(physicsWorld, parentRigidBody = null, parentObject = null) {
    if (!physicsWorld || !this.colMesh) return null;

    this.physicsWorld = physicsWorld;

    if (parentRigidBody) {
      this.rigidBody = parentRigidBody;
      this.parentObject = parentObject || (this.mesh ? this.mesh.parent : null) || this.mesh;
      this.isCompoundChild = true;
    } else {
      // Standalone fixed body at door's origin
      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      this.mesh.getWorldPosition(worldPos);
      this.mesh.getWorldQuaternion(worldQuat);

      this.rigidBody = physicsWorld.createFixedRigidBody({
        position: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
        rotation: { x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w }
      });
      this.parentObject = this.mesh;
      this.isCompoundChild = false;
    }

    // Calculate initial relative transform for collider
    this._computeLocalColliderTransform(this._colPos, this._colQuat);

    // Create cuboid collider attached to the rigid body
    this.collider = physicsWorld.createCuboidCollider(
      this.colHalfExtents,
      this.rigidBody,
      this._colPos,
      this._colQuat
    );

    if (this.collider) {
      this.collider.userData = { isDoor: true, door: this };
    }

    return this.collider;
  }

  /**
   * Computes the current relative transform of the collider mesh in the rigid body's local space.
   * @private
   */
  _computeLocalColliderTransform(outPos, outQuat) {
    if (!this.colMesh) return;

    this.colMesh.updateMatrixWorld(true);

    // Account for geometry center offset
    this._effectiveColMat.multiplyMatrices(
      this.colMesh.matrixWorld,
      this._geomCenterTranslation
    );

    // Express in parent rigid body's coordinate space
    const parentObj = this.parentObject || (this.mesh ? this.mesh.parent : null) || this.mesh;
    if (parentObj) {
      this._parentInvMatrix.copy(parentObj.matrixWorld).invert();
      this._localColMat.multiplyMatrices(this._parentInvMatrix, this._effectiveColMat);
    } else {
      this._localColMat.copy(this._effectiveColMat);
    }

    this._localColMat.decompose(outPos, outQuat, this._colScale);
  }

  /**
   * Synchronizes the Rapier collider's position and rotation with the moving Three.js panel.
   * @private
   */
  _syncColliderTransform() {
    if (!this.collider || !this.rigidBody || !this.physicsWorld) return;

    this._computeLocalColliderTransform(this._colPos, this._colQuat);

    this.physicsWorld.updateColliderTransform(
      this.collider,
      this._colPos,
      this._colQuat
    );
  }

  /**
   * Phase 2 (Pre-Physics): Update tween progress and move visual panel + Rapier collider BEFORE physics step.
   * @param {number} delta - Frame delta time in seconds
   * @param {GameWorld} gameWorld
   */
  prePhysicsUpdate(delta, gameWorld) {
    if (!this.isLoaded || !this.panelMesh) return;

    // Smooth progress tweening towards targetProgress
    if (this.openProgress < this.targetProgress) {
      this.openProgress = Math.min(this.targetProgress, this.openProgress + delta * this.openSpeed);
    } else if (this.openProgress > this.targetProgress) {
      this.openProgress = Math.max(this.targetProgress, this.openProgress - delta * this.closeSpeed);
    }

    // Update panel visual translation
    this.panelMesh.position.copy(this.initialPanelPos).addScaledVector(this.slideDelta, this.openProgress);
    this.panelMesh.updateMatrixWorld(true);

    // Sync Rapier physical collider in lockstep with panel
    this._syncColliderTransform();
  }

  /**
   * Phase 5 (Gameplay): Check proximity trigger for player and NPCs.
   * @param {number} delta - Frame delta time in seconds
   * @param {GameWorld} gameWorld
   */
  gameplayUpdate(delta, gameWorld) {
    if (!this.isLoaded || !this.detectMesh || this.isLocked) return;

    if (this.autoOpen) {
      this.isOccupied = this._checkOccupants(gameWorld);

      if (this.isOccupied) {
        this.targetProgress = 1.0;
        this.closeTimer = this.closeDelay;
      } else {
        if (this.closeTimer > 0) {
          this.closeTimer -= delta;
        }
        if (this.closeTimer <= 0) {
          this.targetProgress = 0.0;
        }
      }
    }
  }

  /**
   * Evaluates if any player, squadmate, or enemy actor is within the DETECT-* box.
   * Uses an exact Oriented Bounding Box (OBB) test in local coordinate space.
   * @private
   */
  _checkOccupants(gameWorld) {
    if (!this.detectMesh || !this.detectMesh.geometry) return false;

    this.detectMesh.updateMatrixWorld(true);
    this._invDetectMatrix.copy(this.detectMesh.matrixWorld).invert();

    // 1. Check Player
    const player = gameWorld?.player || gameWorld?.currentLevel?.player;
    if (player && player.position) {
      this._tempLocalPos.copy(player.position).applyMatrix4(this._invDetectMatrix);
      if (this.detectLocalBox.containsPoint(this._tempLocalPos)) {
        return true;
      }
    }

    // 2. Check Entities (Allies, Squadmates, Alien Troopers, Ground Combatants)
    const entities = gameWorld?.entities;
    if (entities) {
      for (const ent of entities) {
        if (
          ent &&
          ent !== player &&
          ent.position &&
          (ent.isCharacterController || ent.isGroundCombatant || ent.isSquadMate || ent.isAlien || ent.isNPC)
        ) {
          this._tempLocalPos.copy(ent.position).applyMatrix4(this._invDetectMatrix);
          if (this.detectLocalBox.containsPoint(this._tempLocalPos)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Opens the door manually (can be called by scripts, triggers, or keycards).
   */
  open() {
    this.targetProgress = 1.0;
    this.closeTimer = this.closeDelay;
  }

  /**
   * Closes the door manually.
   */
  close() {
    this.targetProgress = 0.0;
    this.closeTimer = 0;
  }

  /**
   * Locks the door closed.
   */
  lock() {
    this.isLocked = true;
    this.targetProgress = 0.0;
  }

  /**
   * Unlocks the door.
   */
  unlock() {
    this.isLocked = false;
  }

  /**
   * Returns true if the door is fully open.
   */
  isOpen() {
    return this.openProgress >= 0.99;
  }

  /**
   * Returns true if the door is fully closed.
   */
  isClosed() {
    return this.openProgress <= 0.01;
  }

  /**
   * Returns true if the door is currently sliding.
   */
  isMoving() {
    return Math.abs(this.openProgress - this.targetProgress) > 0.001;
  }

  /**
   * Clean disposal of Three.js objects and Rapier physics colliders.
   */
  dispose() {
    if (this.collider && this.physicsWorld) {
      this.physicsWorld.removeCollider(this.collider);
      this.collider = null;
    }

    if (!this.isCompoundChild && this.rigidBody && this.physicsWorld) {
      this.physicsWorld.removeRigidBody(this.rigidBody);
      this.rigidBody = null;
    }

    this.physicsWorld = null;
    this.parentObject = null;

    super.dispose();
  }
}
