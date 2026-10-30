import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BaseLevel } from './BaseLevel.js';
import { Player } from '../entities/Player.js';
import {
  loadDoorSlidingSideways,
  loadDoorSlidingUp,
  loadBigDoorSlidingUp
} from '../entities/doors/index.js';

const SPACESHIP_MODEL_URL = './assets/inside-spaceship.glb';
const SPACESHIP_FALLBACK_URL = '/assets/inside-spaceship.glb';

let cachedSpaceshipGLTF = null;

async function loadSpaceshipGLTF() {
  if (cachedSpaceshipGLTF) return cachedSpaceshipGLTF;

  const loader = new GLTFLoader();

  const promise = new Promise((resolve, reject) => {
    loader.load(
      SPACESHIP_MODEL_URL,
      (gltf) => {
        cachedSpaceshipGLTF = gltf;
        resolve(gltf);
      },
      undefined,
      (err) => {
        console.warn('[Level01InsideSpaceship] Loading from fallback...', err);
        loader.load(
          SPACESHIP_FALLBACK_URL,
          (gltfFallback) => {
            cachedSpaceshipGLTF = gltfFallback;
            resolve(gltfFallback);
          },
          undefined,
          (err2) => reject(err2)
        );
      }
    );
  });

  return promise;
}

/**
 * Level01InsideSpaceship
 * Full interior spaceship level featuring:
 * - Floor 1: Stasis Holding Cells (Brig) with 7 capsules, security desks, and main corridor
 * - Central Staircase Tower with multi-tier landings and dramatic emergency red lighting
 * - Floor 2: Research Lab with Exoskeleton Suit stations, high bridges, and control room
 * - Automated modular sliding doors spawned from Blender empties and compounded onto the level rigid body
 * - Compound cuboid and trimesh physics colliders for walls, floors, roofs, stairs, and furniture
 */
export class Level01InsideSpaceship extends BaseLevel {
  constructor(gameWorld) {
    super(gameWorld, 'Level 1: Inside the Spaceship');

    this.player = null;
    this.spaceshipMesh = null;
    this.levelRigidBody = null;
    this.doors = [];

    // Spawn points extracted from model empties
    this.spawnPlayer = new THREE.Vector3(19, 1, -49);
    this.checkpoint1 = new THREE.Vector3(1, 1, 41);
    this.checkpoint2 = new THREE.Vector3(0, 11, 42);

    this._tempEffectiveMat = new THREE.Matrix4();
    this._tempGeomCenterMat = new THREE.Matrix4();
    this._tempPos = new THREE.Vector3();
    this._tempQuat = new THREE.Quaternion();
    this._tempScale = new THREE.Vector3();
  }

  async init() {
    await super.init();

    // 1. Atmosphere & Base Ambient Lighting
    this.gameWorld.scene.background = new THREE.Color(0x0f172a);
    this._originalFog = this.gameWorld.scene.fog;
    this.gameWorld.scene.fog = null; // Disable outdoor daylight fog for crisp indoor visibility

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.gameWorld.environmentGroup.add(ambientLight);
    this.trackDisposable(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xbae6fd, 0x334155, 0.9);
    this.gameWorld.environmentGroup.add(hemiLight);
    this.trackDisposable(hemiLight);

    // 2. Create the Single Level Fixed Rigid Body (for compound wall/floor/door collision)
    if (this.gameWorld.physics) {
      this.levelRigidBody = this.gameWorld.physics.createFixedRigidBody({
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 }
      });
    }

    // 3. Setup High-Diffuse Stylized Sci-Fi Materials (low metalness so light bounces vividly)
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // Clean light slate grey
      roughness: 0.65,
      metalness: 0.1
    });

    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x64748b, // Industrial steel slate
      roughness: 0.7,
      metalness: 0.15
    });

    const roofMaterial = new THREE.MeshStandardMaterial({
      color: 0x475569, // Charcoal roof
      roughness: 0.8,
      metalness: 0.05
    });

    const stairMaterial = new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // Light grey so red emergency light bounces off every step
      roughness: 0.5,
      metalness: 0.15
    });

    const propMaterial = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.5,
      metalness: 0.2
    });

    const capsuleMaterial = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: new THREE.Color(0x00f5d4),
      emissiveIntensity: 0.85,
      roughness: 0.3,
      metalness: 0.2
    });

    const suitMaterial = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: new THREE.Color(0x38bdf8),
      emissiveIntensity: 0.9,
      roughness: 0.3,
      metalness: 0.3
    });

    const lightFixtureMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 3.5,
      roughness: 0.1,
      metalness: 0.0
    });

    // 4. Load the Spaceship Interior Model
    const gltf = await loadSpaceshipGLTF();
    this.spaceshipMesh = gltf.scene.clone(true);
    this.spaceshipMesh.name = 'SpaceshipInterior';
    this.spaceshipMesh.updateMatrixWorld(true);
    this.gameWorld.environmentGroup.add(this.spaceshipMesh);
    this.trackDisposable(this.spaceshipMesh);

    // 5. Parse Nodes, Colliders, Empties & Lighting Anchors
    const doorSpawnNodes = [];
    const lightFixtureNodes = [];

    this.spaceshipMesh.traverse((node) => {
      const name = node.name;

      // Colliders
      if (/^COL/i.test(name) && node.isMesh) {
        node.visible = false;
        node.userData = { noCollision: true };
        this._buildColliderForMesh(node);
        return;
      }

      // Spawn Points
      if (/^SPAWN-Player$/i.test(name)) {
        node.getWorldPosition(this.spawnPlayer);
        node.visible = false;
        return;
      }
      if (/^SPAWN-Player-Checkpoint1$/i.test(name)) {
        node.getWorldPosition(this.checkpoint1);
        node.visible = false;
        return;
      }
      if (/^SPAWN-Player-Checkpoint2$/i.test(name)) {
        node.getWorldPosition(this.checkpoint2);
        node.visible = false;
        return;
      }
      if (/^SPAWN-/i.test(name)) {
        doorSpawnNodes.push(node);
        node.visible = false;
        return;
      }

      // Ceiling Light Fixtures
      if (/light/i.test(name) && node.isMesh) {
        node.material = lightFixtureMaterial;
        lightFixtureNodes.push(node);
        return;
      }

      // Visual Scenery Meshes: Assign clean high-diffuse materials
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        node.userData = { noCollision: true };

        const nameLower = name.toLowerCase();
        if (nameLower.includes('capsule')) {
          node.material = capsuleMaterial;
        } else if (nameLower.includes('suit')) {
          node.material = suitMaterial;
        } else if (nameLower.includes('floor')) {
          node.material = floorMaterial;
        } else if (nameLower.includes('roof')) {
          node.material = roofMaterial;
        } else if (nameLower.includes('stair')) {
          node.material = stairMaterial;
        } else if (nameLower.includes('wall')) {
          node.material = wallMaterial;
        } else if (nameLower.includes('desk') || nameLower.includes('chair') || nameLower.includes('table') || nameLower.includes('machine')) {
          node.material = propMaterial;
        } else {
          node.material = wallMaterial;
        }
      }
    });

    // 6. Setup Lighting Environment (Linear decay = 1.0 with boosted intensities for indoor illumination)

    // A. Staircase Red Emergency Lighting (Requested: red lights for the staircase)
    const redLightPositions = [
      [17.5, -8.0, 42.5],
      [17.5, -2.5, 42.5],
      [17.5, 2.5, 42.5],
      [17.5, 7.5, 42.5],
      [17.5, 12.5, 42.5],
      [17.5, 17.5, 42.5],
      [6.0, 2.0, 42.0],  // Lower stair doorway
      [6.0, 12.0, 42.0]  // Upper stair doorway
    ];
    for (const [lx, ly, lz] of redLightPositions) {
      const redLight = new THREE.PointLight(0xff1e1e, 12.0, 26);
      redLight.decay = 1.0;
      redLight.position.set(lx, ly, lz);
      this.gameWorld.environmentGroup.add(redLight);
      this.trackDisposable(redLight);
    }

    // B. Stasis Holding Cell Room Lighting (Floor 1: [19, 1, -49])
    const holdingCellLight1 = new THREE.PointLight(0x00e5ff, 10.0, 25);
    holdingCellLight1.decay = 1.0;
    holdingCellLight1.position.set(18.0, 4.0, -46.0);
    this.gameWorld.environmentGroup.add(holdingCellLight1);
    this.trackDisposable(holdingCellLight1);

    const holdingCellLight2 = new THREE.PointLight(0x38bdf8, 8.0, 22);
    holdingCellLight2.decay = 1.0;
    holdingCellLight2.position.set(12.0, 4.0, -46.0);
    this.gameWorld.environmentGroup.add(holdingCellLight2);
    this.trackDisposable(holdingCellLight2);

    // C. Research Lab Lighting (Floor 2: [-5, 10, -17] and [7, 10, -17])
    const labLight1 = new THREE.PointLight(0xe0f2fe, 12.0, 25);
    labLight1.decay = 1.0;
    labLight1.position.set(-5.0, 15.0, -17.0);
    this.gameWorld.environmentGroup.add(labLight1);
    this.trackDisposable(labLight1);

    const labLight2 = new THREE.PointLight(0x38bdf8, 12.0, 25);
    labLight2.decay = 1.0;
    labLight2.position.set(7.0, 15.0, -17.0);
    this.gameWorld.environmentGroup.add(labLight2);
    this.trackDisposable(labLight2);

    const labCenterLight = new THREE.PointLight(0x0284c7, 10.0, 22);
    labCenterLight.decay = 1.0;
    labCenterLight.position.set(1.0, 15.0, 5.0);
    this.gameWorld.environmentGroup.add(labCenterLight);
    this.trackDisposable(labCenterLight);

    // D. Corridor Lights (placed directly under ceiling fixtures from model)
    const fixtureBox = new THREE.Box3();
    const fixtureCenter = new THREE.Vector3();

    for (const fixture of lightFixtureNodes) {
      fixtureBox.setFromObject(fixture);
      fixtureBox.getCenter(fixtureCenter);

      const corridorLight = new THREE.PointLight(0xe0f2fe, 8.0, 18);
      corridorLight.decay = 1.0;
      corridorLight.position.set(fixtureCenter.x, fixtureCenter.y - 0.25, fixtureCenter.z);
      this.gameWorld.environmentGroup.add(corridorLight);
      this.trackDisposable(corridorLight);
    }

    // 6. Spawn All Modular Doors Automatically from Blender Empties
    for (const spawnNode of doorSpawnNodes) {
      await this._spawnDoorFromEmpty(spawnNode);
    }

    // 7. Spawn Player inside the Stasis Holding Cell
    this.player = new Player(this.gameWorld, {
      walkSpeed: 8.5,
      sprintSpeed: 14.0,
      jumpForce: 10.5
    });

    this.player.setPosition(this.spawnPlayer.x, this.spawnPlayer.y, this.spawnPlayer.z);
    // Face towards cell exit doorway (along -X / west)
    this.player.yaw = -Math.PI / 2;
    this.gameWorld.addEntity(this.player);
    this.gameWorld.player = this.player;

    // Attach subtle personal chest light for dark corridor navigation
    const suitLight = new THREE.PointLight(0xffffff, 1.1, 10);
    suitLight.position.set(0, 1.35, 0.2);
    this.player.mesh.add(suitLight);

    console.log(`${this.name} initialized with ${doorSpawnNodes.length} doors, ${lightFixtureNodes.length} corridor fixtures, and red staircase lighting.`);
  }

  /**
   * Spawns the appropriate modular door entity matching the SPAWN-* empty name
   * and attaches its collider to the level compound rigid body.
   */
  async _spawnDoorFromEmpty(spawnNode) {
    const name = spawnNode.name;
    const worldPos = spawnNode.getWorldPosition(new THREE.Vector3());
    const worldQuat = spawnNode.getWorldQuaternion(new THREE.Quaternion());

    let door = null;

    if (/SPAWN-Big-Door-Sliding-Up/i.test(name)) {
      door = await loadBigDoorSlidingUp(this.gameWorld, {
        name,
        position: worldPos,
        rotation: worldQuat,
        openSpeed: 1.8,
        closeSpeed: 1.5,
        closeDelay: 1.2
      });
    } else if (/SPAWN-Door-Sliding-Sideways/i.test(name)) {
      door = await loadDoorSlidingSideways(this.gameWorld, {
        name,
        position: worldPos,
        rotation: worldQuat,
        openSpeed: 2.2,
        closeSpeed: 1.8,
        closeDelay: 1.0
      });
    } else if (/SPAWN-Door-Sliding-Up/i.test(name)) {
      door = await loadDoorSlidingUp(this.gameWorld, {
        name,
        position: worldPos,
        rotation: worldQuat,
        openSpeed: 2.2,
        closeSpeed: 1.8,
        closeDelay: 1.0
      });
    }

    if (door) {
      // Mount the door's collider directly to the level's compound rigid body!
      door.initPhysics(this.gameWorld.physics, this.levelRigidBody, this.spaceshipMesh);
      this.gameWorld.addEntity(door);
      this.trackDisposable(door);
      this.doors.push(door);
    }
  }

  /**
   * Converts a COL-* mesh into a Rapier physics collider attached to this.levelRigidBody.
   * Exact 24-vert boxes are converted to cuboids; others use trimesh.
   */
  _buildColliderForMesh(colMesh) {
    if (!this.gameWorld.physics || !this.levelRigidBody || !colMesh.geometry) return;

    colMesh.geometry.computeBoundingBox();
    const box = colMesh.geometry.boundingBox;
    const geomCenter = {
      x: (box.max.x + box.min.x) * 0.5,
      y: (box.max.y + box.min.y) * 0.5,
      z: (box.max.z + box.min.z) * 0.5
    };

    // Calculate relative transform in levelRigidBody space
    this._tempGeomCenterMat.makeTranslation(geomCenter.x, geomCenter.y, geomCenter.z);
    this._tempEffectiveMat.multiplyMatrices(colMesh.matrixWorld, this._tempGeomCenterMat);
    this._tempEffectiveMat.decompose(this._tempPos, this._tempQuat, this._tempScale);

    const halfExtents = {
      x: (box.max.x - box.min.x) * 0.5 * Math.abs(this._tempScale.x),
      y: (box.max.y - box.min.y) * 0.5 * Math.abs(this._tempScale.y),
      z: (box.max.z - box.min.z) * 0.5 * Math.abs(this._tempScale.z)
    };

    // 24-vert standard box mesh -> Cuboid collider (fastest, seam-free)
    const posAttr = colMesh.geometry.attributes.position;
    if (posAttr && posAttr.count === 24) {
      this.gameWorld.physics.createCuboidCollider(
        halfExtents,
        this.levelRigidBody,
        this._tempPos,
        this._tempQuat
      );
    } else {
      // Non-box geometry (e.g. cylinder or irregular floor) -> Trimesh
      const posArray = colMesh.geometry.attributes.position.array;
      const indexArray = colMesh.geometry.index
        ? colMesh.geometry.index.array
        : Array.from({ length: posAttr.count }, (_, i) => i);

      // Transform vertices to world space
      const worldVerts = new Float32Array(posArray.length);
      const v = new THREE.Vector3();
      for (let i = 0; i < posArray.length; i += 3) {
        v.set(posArray[i], posArray[i + 1], posArray[i + 2]).applyMatrix4(colMesh.matrixWorld);
        worldVerts[i] = v.x;
        worldVerts[i + 1] = v.y;
        worldVerts[i + 2] = v.z;
      }

      this.gameWorld.physics.createTrimeshCollider(
        worldVerts,
        indexArray,
        this.levelRigidBody
      );
    }
  }

  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    super.gameplayUpdate(delta, gameWorld);

    // Checkpoint navigation shortcuts for easy stage testing
    if (gameWorld && gameWorld.input && this.player) {
      if (gameWorld.input.isKeyJustPressed('Digit1')) {
        this.player.teleport(this.spawnPlayer.x, this.spawnPlayer.y, this.spawnPlayer.z);
        if (gameWorld.ui) gameWorld.ui.showToast('Checkpoint 1: Holding Cells (Floor 1)', 'info', 2000);
      } else if (gameWorld.input.isKeyJustPressed('Digit2')) {
        this.player.teleport(this.checkpoint1.x, this.checkpoint1.y, this.checkpoint1.z);
        if (gameWorld.ui) gameWorld.ui.showToast('Checkpoint 2: Staircase Entry (Floor 1)', 'info', 2000);
      } else if (gameWorld.input.isKeyJustPressed('Digit3')) {
        this.player.teleport(this.checkpoint2.x, this.checkpoint2.y, this.checkpoint2.z);
        if (gameWorld.ui) gameWorld.ui.showToast('Checkpoint 3: Research Lab (Floor 2)', 'info', 2000);
      }
    }
  }

  get controls() {
    return [
      { actions: ['forward', 'backward', 'steerLeft', 'steerRight'], label: 'Move' },
      { actions: ['jump'], label: 'Jump' },
      { actions: ['sprint'], label: 'Sprint' },
      { actions: ['toggleCamera'], label: 'Toggle View (V)' },
      { actions: ['toggleColliders'], label: 'Toggle Colliders Wireframe (B / F2)' }
    ];
  }

  dispose() {
    console.log(`Disposing ${this.name}...`);

    if (this.levelRigidBody && this.gameWorld.physics) {
      this.gameWorld.physics.removeRigidBody(this.levelRigidBody);
      this.levelRigidBody = null;
    }

    if (this.gameWorld.player === this.player) {
      this.gameWorld.player = null;
    }

    if (this._originalFog !== undefined && this.gameWorld?.scene) {
      this.gameWorld.scene.fog = this._originalFog;
    }

    this.doors = [];
    super.dispose();
  }
}
