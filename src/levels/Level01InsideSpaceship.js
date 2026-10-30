import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BaseLevel } from './BaseLevel.js';
import { Player } from '../entities/Player.js';
import {
  loadDoorSlidingSideways,
  loadDoorSlidingUp,
  loadBigDoorSlidingUp
} from '../entities/doors/index.js';

const base = import.meta.env?.BASE_URL || '/';
const SPACESHIP_MODEL_URL = `${base}assets/inside-spaceship.glb`;
const SPACESHIP_FALLBACK_URL = 'assets/inside-spaceship.glb';

let cachedSpaceshipGLTF = null;

async function loadSpaceshipGLTF() {
  if (typeof Image === 'undefined') {
    return Promise.resolve({ scene: new THREE.Group() });
  }
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
  get controls() {
    return [
      { actions: ['forward', 'backward', 'steerLeft', 'steerRight'], label: 'Walk / Move' },
      { actions: ['sprint'], label: 'Sprint / Jog' },
      { actions: ['firePrimary'], label: 'Shoot pistol' },
      { actions: ['toggleCamera'], label: 'First / Third person' },
      { actions: ['pause'], label: 'Options / Menu' }
    ];
  }

  constructor(gameWorld) {
    super(gameWorld, 'Level 1: Inside the Spaceship');

    this.player = null;
    this.spaceshipMesh = null;
    this.levelRigidBody = null;
    this.doors = [];

    // Performance Optimization structures:
    this.levelLights = [];
    this.floor1Meshes = [];
    this.floor2Meshes = [];
    this._lastFloorState = -1;

    // Awakening Intro Cutscene state
    this.isIntroPlaying = false;
    this.introElapsed = 0;
    this.introStage = 0;
    this.introCamera = null;
    this.introCameraPos = new THREE.Vector3(18.0, 0.72, -52.0); // Inside Sleeping-Capsule.002

    // Spawn points extracted from model empties
    this.spawnPlayer = new THREE.Vector3(19, 1, -49);
    this.checkpoint1 = new THREE.Vector3(1, 1, 41);
    this.checkpoint2 = new THREE.Vector3(0, 11, 42);

    this._tempEffectiveMat = new THREE.Matrix4();
    this._tempGeomCenterMat = new THREE.Matrix4();
    this._tempWorldBox = new THREE.Box3();
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

    // 3. Load the Spaceship Interior Model
    const gltf = await loadSpaceshipGLTF();
    this.spaceshipMesh = gltf.scene.clone(true);
    this.spaceshipMesh.name = 'SpaceshipInterior';
    this.spaceshipMesh.updateMatrixWorld(true);
    this.gameWorld.environmentGroup.add(this.spaceshipMesh);
    this.trackDisposable(this.spaceshipMesh);

    // 4. Parse Nodes, Colliders, Empties & Lighting Anchors
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
        lightFixtureNodes.push(node);
      }

      // Visual Scenery Meshes: Apply Optimizations C & D
      if (node.isMesh) {
        node.castShadow = false; // Indoor level without directional sun; saves shadow map calculation
        node.receiveShadow = true;
        node.userData = { noCollision: true };

        // Optimization C: Freeze static scenery matrices (eliminates 700+ CPU matrix updates every frame)
        node.matrixAutoUpdate = false;
        node.updateMatrix();

        // Optimization D: Categorize strictly by TRUE WORLD vertical bounds (no names, no local offsets)
        node.geometry.computeBoundingBox();
        const worldBox = this._tempWorldBox.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);

        if (worldBox.min.y >= 7.0) {
          this.floor2Meshes.push(node);
        } else if (worldBox.max.y <= 6.5) {
          this.floor1Meshes.push(node);
        }
        // Note: Meshes spanning between 6.5m and 7.0m (staircase tower, vertical structural columns)
        // are kept permanently visible from both floors.

        if (node.material) {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const mat of mats) {
            // Transparent Window / Glass material configuration
            if (/window|glass/i.test(name) || /window|glass/i.test(mat.name)) {
              mat.transparent = true;
              mat.opacity = 0.32;
              mat.roughness = 0.12;
              mat.metalness = 0.15;
              mat.depthWrite = false;
              mat.side = THREE.DoubleSide;
              mat.color.setHex(0xa5f3fc); // Sleek sci-fi cyan tinted glass
              node.renderOrder = 5; // Render after opaque room geometry
            }

            // If the material has emissive color assigned in Blender, ensure it glows with bloom
            if (mat.emissive && (mat.emissive.r > 0 || mat.emissive.g > 0 || mat.emissive.b > 0)) {
              if (!mat.emissiveIntensity || mat.emissiveIntensity <= 1.0) {
                mat.emissiveIntensity = 2.0;
              }
            }
          }
        }
      }
    });

    // 5. Setup Lighting Environment (Linear decay = 1.0 with boosted intensities for indoor illumination)

    // A. Staircase Red Emergency Lighting
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
      this.levelLights.push(redLight);
    }

    // B. Stasis Holding Cell Room Lighting (Floor 1: [19, 1, -49])
    const holdingCellLight1 = new THREE.PointLight(0x00e5ff, 10.0, 25);
    holdingCellLight1.decay = 1.0;
    holdingCellLight1.position.set(18.0, 4.0, -46.0);
    this.gameWorld.environmentGroup.add(holdingCellLight1);
    this.trackDisposable(holdingCellLight1);
    this.levelLights.push(holdingCellLight1);

    const holdingCellLight2 = new THREE.PointLight(0x38bdf8, 8.0, 22);
    holdingCellLight2.decay = 1.0;
    holdingCellLight2.position.set(12.0, 4.0, -46.0);
    this.gameWorld.environmentGroup.add(holdingCellLight2);
    this.trackDisposable(holdingCellLight2);
    this.levelLights.push(holdingCellLight2);

    // C. Research Lab Lighting (Floor 2: [-5, 10, -17] and [7, 10, -17])
    const labLight1 = new THREE.PointLight(0xe0f2fe, 12.0, 25);
    labLight1.decay = 1.0;
    labLight1.position.set(-5.0, 15.0, -17.0);
    this.gameWorld.environmentGroup.add(labLight1);
    this.trackDisposable(labLight1);
    this.levelLights.push(labLight1);

    const labLight2 = new THREE.PointLight(0x38bdf8, 12.0, 25);
    labLight2.decay = 1.0;
    labLight2.position.set(7.0, 15.0, -17.0);
    this.gameWorld.environmentGroup.add(labLight2);
    this.trackDisposable(labLight2);
    this.levelLights.push(labLight2);

    const labCenterLight = new THREE.PointLight(0x0284c7, 10.0, 22);
    labCenterLight.decay = 1.0;
    labCenterLight.position.set(1.0, 15.0, 5.0);
    this.gameWorld.environmentGroup.add(labCenterLight);
    this.trackDisposable(labCenterLight);
    this.levelLights.push(labCenterLight);

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
      this.levelLights.push(corridorLight);
    }

    // E. Control Room Lighting (Floor 2: [-4, 12, 75] and [-4, 9.5, 83])
    const crLight1 = new THREE.PointLight(0xe0f2fe, 12.0, 24);
    crLight1.decay = 1.0;
    crLight1.position.set(-4.0, 12.0, 75.0);
    this.gameWorld.environmentGroup.add(crLight1);
    this.trackDisposable(crLight1);
    this.levelLights.push(crLight1);

    const crLight2 = new THREE.PointLight(0x38bdf8, 10.0, 20);
    crLight2.decay = 1.0;
    crLight2.position.set(-4.0, 9.5, 83.0);
    this.gameWorld.environmentGroup.add(crLight2);
    this.trackDisposable(crLight2);
    this.levelLights.push(crLight2);

    // 6. Spawn All Modular Doors Automatically from Blender Empties
    for (const spawnNode of doorSpawnNodes) {
      await this._spawnDoorFromEmpty(spawnNode);
    }

    // 7. Spawn Player inside the Stasis Holding Cell as Mr. Overalls (scaled 1.5x, no jumping)
    this.player = new Player(this.gameWorld, {
      characterId: 'mr-overalls',
      scale: 1.5,
      walkSpeed: 7.5,
      sprintSpeed: 12.5,
      canJump: false,
      maxHealth: 100,
      capsuleRadius: 0.55,
      capsuleHalfHeight: 0.75,
      eyeHeight: 2.2,
      thirdPersonTargetHeight: 2.1,
      thirdPersonDistance: 4.2
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

    // 8. Awakening Intro Sequence
    this._startIntroCutscene();

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
        panelColor: 0x64748b, // Heavy armored blast door slate
        panelRoughness: 0.55,
        panelMetalness: 0.25,
        openSpeed: 1.8,
        closeSpeed: 1.5,
        closeDelay: 1.2
      });
    } else if (/SPAWN-Door-Sliding-Sideways/i.test(name)) {
      door = await loadDoorSlidingSideways(this.gameWorld, {
        name,
        position: worldPos,
        rotation: worldQuat,
        panelColor: 0x94a3b8, // Clean light slate grey
        panelRoughness: 0.50,
        panelMetalness: 0.15,
        openSpeed: 2.2,
        closeSpeed: 1.8,
        closeDelay: 1.0
      });
    } else if (/SPAWN-Door-Sliding-Up/i.test(name)) {
      door = await loadDoorSlidingUp(this.gameWorld, {
        name,
        position: worldPos,
        rotation: worldQuat,
        panelColor: 0x94a3b8, // Clean light slate grey
        panelRoughness: 0.50,
        panelMetalness: 0.15,
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

    // Awakening Intro cutscene progression
    if (this.isIntroPlaying) {
      this._updateIntroCutscene(delta);
      return;
    }

    // Performance Optimization A & D: Dynamic Light Culling & Floor Occlusion Culling
    if (this.player && this.player.position) {
      const px = this.player.position.x;
      const py = this.player.position.y;
      const pz = this.player.position.z;

      // Optimization A: Only enable point lights within 32 meters (drops forward shader evaluations from 26 to 3-5)
      const maxLightDistSq = 32 * 32;
      for (let i = 0; i < this.levelLights.length; i++) {
        const light = this.levelLights[i];
        const dx = light.position.x - px;
        const dy = light.position.y - py;
        const dz = light.position.z - pz;
        const distSq = dx * dx + dy * dy + dz * dz;
        light.visible = distSq < maxLightDistSq;
      }

      // Optimization D: Floor / Height Occlusion Culling
      // - py < 5.0: Down on Floor 1 -> Hide Floor 2 meshes (cuts 327 draw calls)
      // - 5.0 <= py <= 8.5: Staircase transition zone -> Both floors visible (zero pop-in while climbing)
      // - py > 8.5: Up on Floor 2 -> Hide Floor 1 meshes (cuts 403 draw calls)
      let currentFloorState = 1; // Both
      if (py < 5.0) currentFloorState = 0; // F1 only
      else if (py > 8.5) currentFloorState = 2; // F2 only

      if (this._lastFloorState !== currentFloorState) {
        this._lastFloorState = currentFloorState;
        const showF1 = currentFloorState === 0 || currentFloorState === 1;
        const showF2 = currentFloorState === 2 || currentFloorState === 1;

        for (let i = 0; i < this.floor1Meshes.length; i++) {
          this.floor1Meshes[i].visible = showF1;
        }
        for (let i = 0; i < this.floor2Meshes.length; i++) {
          this.floor2Meshes[i].visible = showF2;
        }
      }
    }

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

  /**
   * Initializes the awakening intro sequence inside Sleeping-Capsule.002.
   * Starts with black screen with the speech/thought bubble visible immediately.
   */
  _startIntroCutscene() {
    this.isIntroPlaying = true;
    this.introElapsed = 0;
    this.introStage = 0;

    // Silence background music during the awakening cutscene
    if (this.gameWorld && this.gameWorld.music) {
      this.gameWorld.music.setState('silent');
    }

    // Create perspective camera inside sleeping capsule
    if (!this.introCamera) {
      this.introCamera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 500);
      this.introCamera.name = 'IntroPodCamera';
      this.gameWorld.environmentGroup.add(this.introCamera);
      this.trackDisposable(this.introCamera);
    }

    // Place camera inside Sleeping-Capsule.002 looking up at the ceiling
    this.introCamera.position.copy(this.introCameraPos);
    // Looking directly upward through the capsule canopy towards ceiling fixtures
    this.introCamera.rotation.set(Math.PI * 0.44, 0, 0);

    // Freeze player avatar and inputs
    if (this.player) {
      this.player.setFrozen(true);
    }

    // Hand camera rendering to the pod camera
    this.gameWorld.setActiveCamera(this.introCamera);

    // Initial stage: screen is completely black with speech/thought bubble starting immediately
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showFade(false); // Screen covered in black
      this.gameWorld.ui.showCinematic(
        'Awww... where am I?',
        'Why does my head hurt this much...?',
        '[Space] Skip',
        true
      );
    }
  }

  /**
   * Advances the awakening dialogue and camera fade stages:
   * - Starts in black with thought bubble
   * - In the middle: ultra-slow fade (5.5s) from black to white (capsule ceiling)
   * - After dialogue: everything turns completely black (text bubble disappears)
   * - Player spawns while still in the dark and gains control
   * - Screen fades back in with player already moving/in control
   */
  _updateIntroCutscene(delta) {
    if (!this.isIntroPlaying) return;

    // Allow skipping the cutscene immediately with Space / Enter
    if (this.gameWorld.input && this.gameWorld.input.isActionJustPressed('skipCutscene')) {
      this._endIntroCutscene();
      return;
    }

    this.introElapsed += delta;

    // Stage 0 -> 1 (t = 8.5s): Somewhere in the middle, ultra-slow fade to white/visibility begins
    if (this.introElapsed >= 8.5 && this.introStage === 0) {
      this.introStage = 1;
      if (this.gameWorld.ui) {
        this.gameWorld.ui.hideFade(true); // Ultra-slow 5.5s fade reveals the bright room overhead
        this.gameWorld.ui.showCinematic(
          'Did I party hard or what...?',
          'Need... to take a dump.',
          '[Space] Skip',
          true
        );
      }
    }
    // Stage 1 -> 2 (t = 17.0s): Third thought looking up at the bright ceiling
    else if (this.introElapsed >= 17.0 && this.introStage === 1) {
      this.introStage = 2;
      if (this.gameWorld.ui) {
        this.gameWorld.ui.showCinematic(
          'What a horrible way to feel first thing in the morning...',
          '',
          '[Space] Skip',
          true
        );
      }
    }
    // Stage 2 -> 3 (t = 25.5s): Fourth thought
    else if (this.introElapsed >= 25.5 && this.introStage === 2) {
      this.introStage = 3;
      if (this.gameWorld.ui) {
        this.gameWorld.ui.showCinematic(
          '...Why is this room so bright?',
          "Wait... this isn't my room.",
          '[Space] Skip',
          true
        );
      }
    }
    // Stage 3 -> 4 (t = 34.0s): Dialogue finished -> EVERYTHING turns completely black
    else if (this.introElapsed >= 34.0 && this.introStage === 3) {
      this.introStage = 4;
      if (this.gameWorld.ui) {
        this.gameWorld.ui.hideCinematic(); // Thought bubble hides
        this.gameWorld.ui.showFade(false); // Everything turns solid black
      }
    }
    // Stage 4 -> 5 (t = 35.5s): While still pitch black, player has spawned and controls are handed over
    else if (this.introElapsed >= 35.5 && this.introStage === 4) {
      this.introStage = 5;

      // Teleport player to initial spawn point in holding bay
      if (this.player) {
        this.player.teleport(this.spawnPlayer.x, this.spawnPlayer.y, this.spawnPlayer.z);
        this.player.yaw = -Math.PI / 2;
        this.player.pitch = -0.15;
        this.player.setFrozen(false); // Player can now move and control immediately
      }

      // Hand view back to player spring-arm camera
      if (this.gameWorld) {
        if (this.gameWorld.activeCamera === this.introCamera) {
          this.gameWorld.setActiveCamera(null);
        }

        // Lift screen fade so room reveals player already standing in control
        if (this.gameWorld.ui) {
          this.gameWorld.ui.hideFade(false);
          this.gameWorld.ui.showToast('Find a way out of the Stasis Holding Bay.', 'info', 4000);
        }

        // Resume ambient level score
        if (this.gameWorld.music) {
          this.gameWorld.music.setState('ambient');
        }
      }
    }
    // Stage 5 -> End (t = 37.0s): Cutscene sequence complete
    else if (this.introElapsed >= 37.0 && this.introStage === 5) {
      this.isIntroPlaying = false;
    }
  }

  /**
   * Concludes the intro cutscene: unfreezes player at SPAWN-Player, fades back in,
   * restores gameplay camera, resumes ambient music and displays the opening objective toast.
   */
  _endIntroCutscene() {
    if (!this.isIntroPlaying) return;
    this.isIntroPlaying = false;

    // Teleport player to initial spawn point facing cell exit (west)
    if (this.player) {
      this.player.teleport(this.spawnPlayer.x, this.spawnPlayer.y, this.spawnPlayer.z);
      this.player.yaw = -Math.PI / 2;
      this.player.pitch = -0.15;
      this.player.setFrozen(false);
    }

    // Switch active camera back to player spring-arm camera
    if (this.gameWorld) {
      if (this.gameWorld.activeCamera === this.introCamera) {
        this.gameWorld.setActiveCamera(null);
      }

      if (this.gameWorld.ui) {
        this.gameWorld.ui.hideCinematic();
        this.gameWorld.ui.hideFade(false);
        this.gameWorld.ui.showToast('Find a way out of the Stasis Holding Bay.', 'info', 4000);
      }

      // Resume ambient score for level exploration
      if (this.gameWorld.music) {
        this.gameWorld.music.setState('ambient');
      }
    }
  }

  dispose() {
    this._endIntroCutscene();

    if (this.introCamera && this.gameWorld?.environmentGroup) {
      this.gameWorld.environmentGroup.remove(this.introCamera);
      this.introCamera = null;
    }
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
    this.levelLights = [];
    this.floor1Meshes = [];
    this.floor2Meshes = [];
    cachedSpaceshipGLTF = null; // Clear cached GLTF on dispose so updated models reload cleanly
    super.dispose();
  }
}
