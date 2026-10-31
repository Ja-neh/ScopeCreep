import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BaseLevel } from './BaseLevel.js';
import { Player } from '../entities/Player.js';
import {
  loadDoorSlidingSideways,
  loadDoorSlidingUp,
  loadBigDoorSlidingUp
} from '../entities/doors/index.js';
import { WeaponController } from '../weapons/WeaponController.js';
import { ProjectilePool } from '../entities/ProjectilePool.js';
import { createHandgunMesh } from '../entities/models/MrOverallsModel.js';
import { CONTROL_CENTER_BUTTONS } from '../ui/components/ControlCenterPanel.js';
import { AlienSquad } from '../ai/AlienSquad.js';
import { AlienTrooper } from '../entities/enemies/AlienTrooper.js';
import { AlienModel } from '../entities/models/AlienModel.js';
import { Level02 } from './Level02.js';
import config from '../config.json';

// --- Corridor Sentry AI Behavior ---
// Sentry troopers hold position along their post in the corridor, aiming and firing plasma
// bursts down the hall without rushing the player, encouraging tactical cover advancement.

const CORRIDOR_GUARD_STATE = {
  enter(sentry) {
    sentry.clearLook();
    sentry.stop();
    sentry.lookAt(new THREE.Vector3(sentry.home.x, sentry.home.y, sentry.home.z - 10));
  },
  update(sentry, delta) {
    if (sentry.perception.target) return 'engage';
    if (sentry.perception.hasLastKnown) return 'investigate';

    const distFromHome = sentry.position.distanceTo(sentry.home);
    if (distFromHome > 1.5) {
      sentry.moveTo(sentry.home, sentry.cfg.walkSpeed);
    } else if (sentry.hasArrived() || distFromHome <= 0.3) {
      sentry.stop();
      sentry.lookAt(new THREE.Vector3(sentry.home.x, sentry.home.y, sentry.home.z - 10));
    }
    return null;
  }
};

const CORRIDOR_INVESTIGATE_STATE = {
  enter(sentry) {
    sentry.clearLook();
    sentry.stop();
    sentry._investigateTimer = 0;
  },
  update(sentry, delta) {
    if (sentry.perception.target) return 'engage';

    if (sentry.perception.hasLastKnown) {
      sentry.lookAt(sentry.perception.lastKnownPosition);
    }

    sentry._investigateTimer = (sentry._investigateTimer || 0) + delta;
    if (sentry._investigateTimer > 4.0) {
      sentry.perception.forget();
      return 'guard';
    }
    return null;
  }
};

const CORRIDOR_SENTRY_ENGAGE = {
  enter(sentry) {
    sentry._strafeTimer = 1.0 + Math.random() * 1.5;
    sentry._strafeTarget = new THREE.Vector3();
  },
  update(sentry, delta) {
    const target = sentry.perception.target;
    const threat = sentry.perception.lastKnownPosition || (target ? target.position : null);

    if (threat) {
      sentry.lookAt(threat);
    }

    if (!target && sentry.perception.timeSinceSeen > 3.0) {
      return 'guard';
    }

    // Sentry stays tethered to its post (home) instead of charging down the hallway
    sentry._strafeTimer -= delta;
    if (sentry._strafeTimer <= 0) {
      sentry._strafeTimer = 2.0 + Math.random() * 2.5;

      const offsetX = (Math.random() - 0.5) * 2.2;
      const offsetZ = (Math.random() - 0.5) * 1.2;
      sentry._strafeTarget.set(
        sentry.home.x + offsetX,
        sentry.home.y,
        sentry.home.z + offsetZ
      );
      sentry.moveTo(sentry._strafeTarget, sentry.cfg.walkSpeed * 1.2);
    }

    // Point-blank defensive space: step back slightly if player rushes into melee
    if (target && sentry.position.distanceTo(target.position) < 3.2) {
      const away = new THREE.Vector3().subVectors(sentry.position, target.position).setY(0).normalize();
      const retreatPoint = sentry.position.clone().addScaledVector(away, 2.0);
      sentry.moveTo(retreatPoint, sentry.cfg.walkSpeed);
    }

    return null;
  }
};

const base = import.meta.env?.BASE_URL || '/';
const SPACESHIP_MODEL_URL = `${base}assets/inside-spaceship.glb`;
const SPACESHIP_FALLBACK_URL = 'assets/inside-spaceship.glb';
const CONTROL_CENTER_POSITION = new THREE.Vector3(-4, 12, 79);
const CONTROL_CENTER_RADIUS = 9;

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
      { actions: ['specialAction'], label: 'Take gun / Interact' },
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
    this.cellDoor = null;
    this.weapons = null;
    this.projectilePool = null;
    this.enemySquad = null;
    this.cloningStations = [];
    this.clonedGuardsSquad = null;
    this._clonesSpawned = false;
    this._controlRoomUnlocked = false;
    this._controlRoomLockedPromptVisible = false;
    this._controlRoomDoorAnchor = null;
    this._doorLockToastTimer = 0;
    this._dashboardPromptVisible = false;
    this._dashboardAnchor = null;
    this.isOutroPlaying = false;
    this.outroElapsed = 0;
    this.outroStage = 0;
    this._level2TransitionStarted = false;
    this._playerDying = false;
    this._deathElapsed = 0;
    this._deathStage = 0;
    this.controlRoomDoor = null;
    this.alienSpawns = [];
    this._corridorAlarmTriggered = false;
    this.hasGun = false;
    this.deskGunGroup = null;
    this.deskGunLight = null;
    this.deskGunPos = new THREE.Vector3(10.0, 0.88, -39.85);
    this._deskGunPromptVisible = false;
    this._doorLockedPromptVisible = false;
    this.sleepingPods = [];
    this._activePod = null;
    this._podLockFeedbackTimer = 0;
    this.missionStage = 'holdingBay';
    this.missionComplete = false;
    this._fallDeathY = -20;
    this._fallDeathTriggered = false;
    this._controlCenterVisible = false;
    this.showControlCenterUI = false; // "SHIP CONTROL" UI overlay disabled on the control room dashboard
    this.controlCenterConsole = null;
    this._dashboardHologram = null;
    this._dashboardRadarNeedle = null;

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
    this.enableDevCheckpoints = false; // Player cannot use [1], [2], [3] to teleport during normal gameplay

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
    this._createSpaceBackdrop();

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
    const shipBounds = new THREE.Box3().setFromObject(this.spaceshipMesh);
    if (Number.isFinite(shipBounds.min.y)) {
      this._fallDeathY = shipBounds.min.y - 5;
    }

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
      if (/^SPAWN-Alien/i.test(name)) {
        node.visible = false;
        return;
      }
      if (/^SPAWN-/i.test(name)) {
        doorSpawnNodes.push(node);
        node.visible = false;
        return;
      }

      // Sleeping Capsules / Stasis Pods in the holding room
      if (/^Sleeping-Capsule/i.test(name)) {
        const podPos = node.getWorldPosition(new THREE.Vector3());
        this.sleepingPods.push({
          name,
          node,
          position: new THREE.Vector3(podPos.x, 0.8, podPos.z)
        });
      }

      // Suit-Stations in the research lab (repurposed as Cloning Systems)
      if (/^Suit-station/i.test(name)) {
        const stationPos = node.getWorldPosition(new THREE.Vector3());
        this.cloningStations.push({
          name,
          node,
          position: new THREE.Vector3(stationPos.x, stationPos.y, stationPos.z)
        });
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
              // Honor window alpha configured in Blender (e.g. alpha = 0 for see-through view)
              if (typeof mat.opacity === 'number' && mat.opacity >= 0 && mat.opacity < 1.0) {
                mat.opacity = mat.opacity;
              } else {
                mat.opacity = 0.0;
              }
              mat.roughness = 0.1;
              mat.metalness = 0.1;
              mat.depthWrite = false;
              mat.side = THREE.DoubleSide;
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

    this._createControlCenterConsole();

    // 6. Spawn All Modular Doors Automatically from Blender Empties
    for (const spawnNode of doorSpawnNodes) {
      await this._spawnDoorFromEmpty(spawnNode);
    }

    // 7. Spawn Player inside the Stasis Holding Cell as Mr. Overalls (scaled 1.5x, no jumping, unarmed at wake-up)
    this.player = new Player(this.gameWorld, {
      characterId: 'mr-overalls',
      scale: 1.5,
      walkSpeed: 7.5,
      sprintSpeed: 12.5,
      canJump: false,
      hasGun: false,
      maxHealth: config.player.vitals.maxHealth,
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

    this.weapons = new WeaponController(this.gameWorld, this.player, {
      showHeldWeapons: false,
      showWeaponHUD: false,
      hasGun: false,
      gunOnly: true,
      allowSwitching: false,
      allowQuickMelee: false,
      onGunshot: (pos) => {
        if (this.enemySquad) {
          this.enemySquad.reportNoise(pos);
        }
        if (this.clonedGuardsSquad) {
          this.clonedGuardsSquad.reportNoise(pos);
        }
      }
    });
    this.gameWorld.addEntity(this.weapons);
    this.projectilePool = new ProjectilePool(this.gameWorld);
    this.gameWorld.addEntity(this.projectilePool);
    this.gameWorld.projectilePool = this.projectilePool;

    // Place the handgun on the holding cell desk for the player to retrieve
    this._createDeskGunProp();

    if (this.gameWorld.ui) {
      this.gameWorld.ui.hideWeaponHUD();
      this.gameWorld.ui.showPlayerHealth();
      this.gameWorld.ui.updatePlayerHealth(this.player.health.currentHealth, this.player.health.maxHealth);
    }

    // Attach subtle personal chest light for dark corridor navigation
    const suitLight = new THREE.PointLight(0xffffff, 1.1, 10);
    suitLight.position.set(0, 1.35, 0.2);
    this.player.mesh.add(suitLight);

    // 8. Awakening Intro Sequence
    this._startIntroCutscene();

    console.log(`${this.name} initialized with ${doorSpawnNodes.length} doors, ${lightFixtureNodes.length} corridor fixtures, and red staircase lighting.`);
  }

  _createSpaceBackdrop() {
    const starCount = 1400;
    const starRadius = 1500;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const starColors = [0xffffff, 0xc9e3ff, 0xffe6c2];
    let seed = 0x5eed1234;
    const random = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 0x100000000;
    };

    for (let i = 0; i < starCount; i++) {
      const z = random() * 2 - 1;
      const angle = random() * Math.PI * 2;
      const radial = Math.sqrt(1 - z * z);
      positions[i * 3] = starRadius * radial * Math.cos(angle);
      positions[i * 3 + 1] = starRadius * z;
      positions[i * 3 + 2] = starRadius * radial * Math.sin(angle);

      const color = new THREE.Color(starColors[Math.floor(random() * starColors.length)]);
      const brightness = 0.65 + random() * 0.35;
      colors[i * 3] = color.r * brightness;
      colors[i * 3 + 1] = color.g * brightness;
      colors[i * 3 + 2] = color.b * brightness;
    }

    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        size: 1.25,
        vertexColors: true,
        sizeAttenuation: true,
        depthWrite: false,
        fog: false
      })
    );
    stars.name = 'SpaceshipExteriorStars';
    this.gameWorld.environmentGroup.add(stars);
    this.trackDisposable(stars);

    const bodies = [
      { name: 'DistantMoon', position: [310, 170, -530], radius: 48, color: 0xc9cbd0 },
      { name: 'DistantBluePlanet', position: [-700, 360, -920], radius: 72, color: 0x4389c4 },
      { name: 'DistantRingedPlanet', position: [640, -250, -980], radius: 44, color: 0xd88755 }
    ];

    for (const body of bodies) {
      const planet = new THREE.Mesh(
        new THREE.SphereGeometry(body.radius, 32, 24),
        new THREE.MeshBasicMaterial({ color: body.color })
      );
      planet.name = body.name;
      planet.position.set(...body.position);
      this.gameWorld.environmentGroup.add(planet);
      this.trackDisposable(planet);

      if (body.name === 'DistantRingedPlanet') {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(body.radius * 1.35, body.radius * 2.1, 48),
          new THREE.MeshBasicMaterial({
            color: 0xd8b37c,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
            depthWrite: false
          })
        );
        ring.name = 'DistantPlanetRings';
        ring.position.copy(planet.position);
        ring.lookAt(0, 0, 0);
        ring.rotateZ(0.35);
        this.gameWorld.environmentGroup.add(ring);
        this.trackDisposable(ring);
      }
    }
  }

  _createControlCenterConsole() {
    const consoleGroup = new THREE.Group();
    consoleGroup.name = 'SpaceshipControlCenterConsole';
    // Anchored directly onto the top surface of the Dashboard in the Control Room (Y=12.35)
    consoleGroup.position.set(1.0, 12.35, 78.4);
    this.gameWorld.environmentGroup.add(consoleGroup);
    this.trackDisposable(consoleGroup);
    this.controlCenterConsole = consoleGroup;

    const addMesh = (name, geometry, material, position, rotation, parent = consoleGroup) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      if (position) mesh.position.set(...position);
      if (rotation) mesh.rotation.set(...rotation);
      parent.add(mesh);
      this.trackDisposable(mesh);
      return mesh;
    };

    // --- Alien Xenomorphic Palette Materials ---
    // Dark alien carapace / void obsidian
    const carapaceMat = new THREE.MeshStandardMaterial({
      color: 0x050914,
      metalness: 0.94,
      roughness: 0.16
    });
    const conduitTrimMat = new THREE.MeshStandardMaterial({
      color: 0x0b1329,
      metalness: 0.88,
      roughness: 0.22
    });
    // Intense bioluminescent alien plasma colors
    const alienCyanMat = new THREE.MeshStandardMaterial({
      color: 0x00f5ff,
      emissive: 0x00f5ff,
      emissiveIntensity: 2.2,
      metalness: 0.3,
      roughness: 0.2
    });
    const alienVioletMat = new THREE.MeshStandardMaterial({
      color: 0x7c3aed,
      emissive: 0xa855f7,
      emissiveIntensity: 2.4,
      metalness: 0.3,
      roughness: 0.2
    });
    const alienEmeraldMat = new THREE.MeshStandardMaterial({
      color: 0x059669,
      emissive: 0x10b981,
      emissiveIntensity: 2.2,
      metalness: 0.3,
      roughness: 0.2
    });
    const alienAmberMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      emissive: 0xf59e0b,
      emissiveIntensity: 2.2,
      metalness: 0.3,
      roughness: 0.2
    });
    const bioScannerMat = new THREE.MeshStandardMaterial({
      color: 0x022c22,
      emissive: 0x10b981,
      emissiveIntensity: 1.8,
      metalness: 0.2,
      roughness: 0.25,
      side: THREE.DoubleSide
    });
    const crystalHoloMat = new THREE.MeshBasicMaterial({
      color: 0x00f5ff,
      wireframe: true,
      transparent: true,
      opacity: 0.88
    });
    const crystalCoreMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x00f5ff,
      emissiveIntensity: 1.8,
      metalness: 0.2,
      roughness: 0.1,
      transparent: true,
      opacity: 0.92
    });

    // =========================================================================
    // 1. CENTER CONSOLE: SLANTED OBSIDIAN CARAPACE CRADLE & NEURAL RESONANCE NODES
    // All faces oriented towards -Z (facing the commander standing at the bridge)
    // =========================================================================

    // Organic faceted obsidian console cradle tilted up towards the player
    addMesh(
      'ControlCenterPanelBacking',
      new THREE.CylinderGeometry(1.35, 1.45, 0.16, 6),
      carapaceMat,
      [0, 0.08, -0.15],
      [-0.38, Math.PI, 0]
    );

    // Glowing conduit rim tracing the front of the cradle
    addMesh(
      'ConsoleConduitRim',
      new THREE.TorusGeometry(1.22, 0.02, 6, 24, Math.PI * 0.7),
      alienCyanMat,
      [0, 0.14, -0.16],
      [1.18, 0, Math.PI * 0.65]
    );

    // The 6 Primary Interactive Neural Nodes (ControlCenterButton-*)
    // Arranged in an alien crescent arc facing the commander, with hexagonal crystal nodes
    const arcAngles = [-0.62, -0.37, -0.12, 0.12, 0.37, 0.62];
    const arcRadius = 0.82;
    CONTROL_CENTER_BUTTONS.forEach((button, index) => {
      const angle = arcAngles[index];
      const bx = Math.sin(angle) * arcRadius;
      const bz = -0.15 - Math.cos(angle) * 0.52;
      const by = 0.16 - Math.cos(angle) * 0.04;
      const color = Number.parseInt(button.color.slice(1), 16);

      // Dark obsidian neural socket cradle
      addMesh(
        `NeuralSocket-${index}`,
        new THREE.CylinderGeometry(0.18, 0.22, 0.05, 6),
        conduitTrimMat,
        [bx, by, bz],
        [-0.38, Math.PI + angle * 0.3, 0]
      );

      // Glowing alien hexagonal crystal core (the interactive button entity)
      addMesh(
        `ControlCenterButton-${button.label.replaceAll(' ', '-')}`,
        new THREE.CylinderGeometry(0.13, 0.15, 0.08, 6),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 1.6,
          metalness: 0.3,
          roughness: 0.18
        }),
        [bx, by + 0.04, bz],
        [-0.38, Math.PI + angle * 0.3, 0]
      );

      // Pulsing energy focus ring around each node
      addMesh(
        `NodeFocusRing-${index}`,
        new THREE.RingGeometry(0.15, 0.17, 6),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.8, side: THREE.DoubleSide }),
        [bx, by + 0.08, bz + 0.01],
        [-0.38, Math.PI + angle * 0.3, 0]
      );
    });

    // Bio-Synaptic Matrix (Honeycombed alien neural cluster on left wing of the cradle)
    const synapseOffsets = [
      [-0.85, -0.30], [-0.95, -0.22], [-1.05, -0.30],
      [-0.85, -0.42], [-0.95, -0.34], [-1.05, -0.42], [-0.95, -0.46]
    ];
    for (let i = 0; i < synapseOffsets.length; i++) {
      const [sx, sz] = synapseOffsets[i];
      const mat = i % 2 === 0 ? alienCyanMat : alienEmeraldMat;
      addMesh(
        'NeuralSynapseNode',
        new THREE.CylinderGeometry(0.038, 0.046, 0.03, 6),
        mat,
        [sx, 0.13, sz],
        [-0.38, Math.PI, 0]
      );
    }

    // Alien Plasma Ampoules (Glowing energy columns on right wing of the cradle)
    for (let p = 0; p < 4; p++) {
      const px = 0.82 + p * 0.09;
      const pz = -0.35 + p * 0.04;
      // Obsidian containment channel
      addMesh('PlasmaChannel', new THREE.BoxGeometry(0.04, 0.02, 0.22), conduitTrimMat, [px, 0.12, pz], [-0.38, Math.PI, 0]);
      // Glowing plasma core
      const pMat = p % 2 === 0 ? alienVioletMat : alienAmberMat;
      addMesh('PlasmaCoreTube', new THREE.CylinderGeometry(0.014, 0.014, 0.18, 8), pMat, [px, 0.14, pz], [1.19, 0, 0]);
    }

    // Carapace Sensory Slits along the front edge
    for (let s = 0; s < 7; s++) {
      const slitMat = s % 3 === 0 ? alienAmberMat : (s % 2 === 0 ? alienEmeraldMat : alienCyanMat);
      addMesh(
        'SensorySlit',
        new THREE.BoxGeometry(0.08, 0.012, 0.02),
        slitMat,
        [-0.6 + s * 0.2, 0.04, -0.58],
        [-0.38, Math.PI, 0]
      );
    }

    // =========================================================================
    // 2. CENTRAL FLOATING XENOTECH GRAVITY CORE (Hologram Array)
    // =========================================================================
    addMesh('HoloWellBase', new THREE.CylinderGeometry(0.26, 0.32, 0.06, 6), carapaceMat, [0, 0.03, 0.35]);
    addMesh('HoloFocusRing', new THREE.TorusGeometry(0.22, 0.018, 6, 24), alienCyanMat, [0, 0.07, 0.35], [Math.PI / 2, 0, 0]);

    const holoGroup = new THREE.Group();
    holoGroup.name = 'DashboardHologramOrb';
    holoGroup.position.set(0, 0.36, 0.35);
    consoleGroup.add(holoGroup);
    this.trackDisposable(holoGroup);
    this._dashboardHologram = holoGroup;

    // Nested alien gyro-rings and double-pyramid crystal core
    addMesh('XenoGyroRingOuter', new THREE.TorusGeometry(0.20, 0.010, 6, 24), crystalHoloMat, [0, 0, 0], [0.55, 0, 0], holoGroup);
    addMesh('XenoGyroRingInner', new THREE.TorusGeometry(0.14, 0.008, 6, 24), crystalHoloMat, [0, 0, 0], [-0.55, 0, 0.7], holoGroup);
    addMesh('XenoOctaCore', new THREE.OctahedronGeometry(0.10, 0), crystalCoreMat, [0, 0, 0], null, holoGroup);

    // =========================================================================
    // 3. CENTER XENOLITH PROJECTION SPHEROID (Main Display facing the commander)
    // Display face points along -Z directly towards the player
    // =========================================================================

    // Monolithic faceted obsidian carapace housing
    addMesh('XenolithHousing', new THREE.CylinderGeometry(1.15, 0.95, 0.92, 6), carapaceMat, [0, 0.85, 0.82], [-0.22, Math.PI, 0]);

    // Levitating crystalline resonant horn spires flanking the housing
    addMesh('XenoSpireL', new THREE.ConeGeometry(0.08, 0.75, 4), alienCyanMat, [-1.22, 0.95, 0.78], [-0.22, Math.PI, 0.42]);
    addMesh('XenoSpireR', new THREE.ConeGeometry(0.08, 0.75, 4), alienCyanMat, [1.22, 0.95, 0.78], [-0.22, Math.PI, -0.42]);

    // The Main Crystalline Energy Display (ControlCenterDisplay) facing the player
    // Placed on the -Z side of the housing so it looks directly into the control room
    addMesh(
      'ControlCenterDisplay',
      new THREE.CylinderGeometry(1.08, 0.88, 0.82, 6),
      new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        emissive: 0x00f5ff,
        emissiveIntensity: 2.2,
        metalness: 0.25,
        roughness: 0.15
      }),
      [0, 0.85, 0.78],
      [-0.22, Math.PI, 0]
    );

    // Concentric alien runic glyph rings projected on the display face
    addMesh('RunicMandalRing1', new THREE.RingGeometry(0.24, 0.27, 6), alienCyanMat, [0, 0.88, 0.73], [-0.22, Math.PI, 0]);
    addMesh('RunicMandalRing2', new THREE.RingGeometry(0.38, 0.41, 6), alienEmeraldMat, [0, 0.88, 0.73], [-0.22, Math.PI, 0]);
    addMesh('RunicCoreGlyph', new THREE.OctahedronGeometry(0.09, 0), alienVioletMat, [0, 0.88, 0.73], [-0.22, Math.PI, 0]);

    // Resonant harmonic data ribbons across the display face
    for (let r = 0; r < 4; r++) {
      addMesh('HarmonicRibbonL', new THREE.BoxGeometry(0.32, 0.02, 0.01), alienCyanMat, [-0.62, 0.98 - r * 0.08, 0.75], [-0.22, Math.PI, 0]);
      addMesh('HarmonicRibbonR', new THREE.BoxGeometry(0.32, 0.02, 0.01), alienAmberMat, [0.62, 0.98 - r * 0.08, 0.75], [-0.22, Math.PI, 0]);
    }

    // Flanking bio-crystalline auxiliary shards (angled inward towards the player)
    addMesh('AuxCrystalShardL', new THREE.CylinderGeometry(0.38, 0.48, 0.68, 5), carapaceMat, [-1.75, 0.74, 0.52], [-0.18, 2.35, 0]);
    addMesh('AuxCrystalFaceL', new THREE.CylinderGeometry(0.34, 0.44, 0.62, 5), alienCyanMat, [-1.73, 0.74, 0.49], [-0.18, 2.35, 0]);

    addMesh('AuxCrystalShardR', new THREE.CylinderGeometry(0.38, 0.48, 0.68, 5), carapaceMat, [1.75, 0.74, 0.52], [-0.18, -2.35, 0]);
    addMesh('AuxCrystalFaceR', new THREE.CylinderGeometry(0.34, 0.44, 0.62, 5), alienVioletMat, [1.73, 0.74, 0.49], [-0.18, -2.35, 0]);

    // =========================================================================
    // 4. LEFT WING TERMINAL: XENOBIOLOGICAL SPATIAL SCANNER SPIRE
    // Oriented to look directly at the commander at (0, 0, -2.0)
    // =========================================================================
    addMesh('BioScannerCarapace', new THREE.CylinderGeometry(0.65, 0.85, 0.14, 6), carapaceMat, [-3.3, 0.06, -1.05], [0, 1.85, 0]);
    addMesh('BioScannerSpire', new THREE.CylinderGeometry(0.48, 0.62, 0.72, 6), carapaceMat, [-3.3, 0.55, -0.88], [-0.22, 1.85, 0]);
    addMesh('BioScannerFace', new THREE.CylinderGeometry(0.44, 0.58, 0.66, 6), alienEmeraldMat, [-3.28, 0.55, -0.85], [-0.22, 1.85, 0]);

    // Glowing bio-vortex circular portal
    addMesh('VortexBezel', new THREE.TorusGeometry(0.22, 0.022, 6, 24), conduitTrimMat, [-3.18, 0.14, -1.22], [-0.35, 1.85, 0]);
    addMesh('VortexFace', new THREE.CircleGeometry(0.20, 6), bioScannerMat, [-3.18, 0.14, -1.22], [-0.35, 1.85, 0]);

    const radarNeedleGroup = new THREE.Group();
    radarNeedleGroup.name = 'DashboardRadarNeedle';
    radarNeedleGroup.position.set(-3.18, 0.15, -1.22);
    radarNeedleGroup.rotation.set(-0.35, 1.85, 0);
    consoleGroup.add(radarNeedleGroup);
    this.trackDisposable(radarNeedleGroup);
    this._dashboardRadarNeedle = radarNeedleGroup;

    // Glowing alien sensory beam
    addMesh('VortexNeedle', new THREE.ConeGeometry(0.018, 0.18, 4), alienCyanMat, [0, 0.08, 0.01], null, radarNeedleGroup);

    // Left Wing Neural Touch Clusters
    for (let k = 0; k < 6; k++) {
      const angle = (k / 6) * Math.PI * 2;
      addMesh(
        'LeftNeuralNode',
        new THREE.CylinderGeometry(0.035, 0.045, 0.025, 6),
        alienCyanMat,
        [-3.62 + Math.cos(angle) * 0.18, 0.13, -1.25 + Math.sin(angle) * 0.18],
        [-0.35, 1.85, 0]
      );
    }

    // =========================================================================
    // 5. RIGHT WING TERMINAL: ALIEN PLASMA FORGE & RESONANCE RUNES
    // Oriented to look directly at the commander at (0, 0, -2.0)
    // =========================================================================
    addMesh('ForgeCarapace', new THREE.CylinderGeometry(0.65, 0.85, 0.14, 6), carapaceMat, [3.3, 0.06, -1.05], [0, -1.85, 0]);
    addMesh('ForgeSpire', new THREE.CylinderGeometry(0.48, 0.62, 0.72, 6), carapaceMat, [3.3, 0.55, -0.88], [-0.22, -1.85, 0]);
    addMesh('ForgeFace', new THREE.CylinderGeometry(0.44, 0.58, 0.66, 6), alienAmberMat, [3.28, 0.55, -0.85], [-0.22, -1.85, 0]);

    // Resonant Crystalline Power Columns (3 tiered clusters of faceted alien power crystals)
    const crystalColors = [0x10b981, 0x10b981, 0xf59e0b, 0xf97316, 0xef4444];
    for (let c = 0; c < 3; c++) {
      for (let s = 0; s < 5; s++) {
        const colHex = crystalColors[s];
        const crystalMat = new THREE.MeshStandardMaterial({
          color: colHex,
          emissive: colHex,
          emissiveIntensity: 1.8,
          metalness: 0.2,
          roughness: 0.2
        });
        addMesh(
          'PowerCrystalCluster',
          new THREE.ConeGeometry(0.026, 0.06 + s * 0.015, 6),
          crystalMat,
          [3.08 + c * 0.08, 0.09 + s * 0.035, -1.28 + c * 0.04],
          [0.35, -1.85, 0]
        );
      }
    }

    // Hexagonal Defense Runes
    for (let d = 0; d < 6; d++) {
      const angle = (d / 6) * Math.PI * 2;
      const runeCol = d % 2 === 0 ? 0xef4444 : 0xf59e0b;
      addMesh(
        'DefenseRune',
        new THREE.CylinderGeometry(0.045, 0.055, 0.03, 6),
        new THREE.MeshStandardMaterial({ color: runeCol, emissive: runeCol, emissiveIntensity: 1.8 }),
        [3.52 + Math.cos(angle) * 0.16, 0.13, -1.22 + Math.sin(angle) * 0.16],
        [-0.35, -1.85, 0]
      );
    }

    // =========================================================================
    // 6. SIDE WINGS: BIOLUMINESCENT CONDUIT PATHWAYS
    // =========================================================================
    addMesh('BioRibbonCarapaceL', new THREE.BoxGeometry(0.46, 0.03, 1.1), carapaceMat, [-4.4, 0.02, -2.6]);
    addMesh('BioRibbonCoreL', new THREE.BoxGeometry(0.38, 0.02, 0.98), alienCyanMat, [-4.4, 0.035, -2.6]);
    addMesh('BioRibbonCarapaceR', new THREE.BoxGeometry(0.46, 0.03, 1.1), carapaceMat, [4.4, 0.02, -2.6]);
    addMesh('BioRibbonCoreR', new THREE.BoxGeometry(0.38, 0.02, 0.98), alienAmberMat, [4.4, 0.035, -2.6]);
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
      const isControlRoomDoor = /Big-Door-Sliding-Up.*003/i.test(name) || (worldPos.y >= 8 && worldPos.z > 60);
      door = await loadBigDoorSlidingUp(this.gameWorld, {
        name,
        position: worldPos,
        rotation: worldQuat,
        panelColor: 0x64748b, // Heavy armored blast door slate
        panelRoughness: 0.55,
        panelMetalness: 0.25,
        openSpeed: 1.8,
        closeSpeed: 1.5,
        closeDelay: 1.2,
        isLocked: isControlRoomDoor && !this._controlRoomUnlocked
      });
      if (isControlRoomDoor) {
        this.controlRoomDoor = door;
      }
    } else if (/SPAWN-Door-Sliding-Sideways/i.test(name)) {
      const isHoldingCellDoor = /Sliding-Sideways.*001/i.test(name) || (Math.abs(worldPos.x - 6.0) < 1.5 && Math.abs(worldPos.z - (-49.0)) < 1.5);
      door = await loadDoorSlidingSideways(this.gameWorld, {
        name,
        position: worldPos,
        rotation: worldQuat,
        panelColor: 0x94a3b8, // Clean light slate grey
        panelRoughness: 0.50,
        panelMetalness: 0.15,
        openSpeed: 2.2,
        closeSpeed: 1.8,
        closeDelay: 1.0,
        isLocked: isHoldingCellDoor && !this.hasGun
      });
      if (isHoldingCellDoor) {
        this.cellDoor = door;
      }
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

    // Heading for Earth Outro cutscene progression
    if (this.isOutroPlaying) {
      this._updateOutroCutscene(delta);
      return;
    }

    // Player death sequence progression
    if (this._playerDying) {
      this._updatePlayerDeath(delta);
      return;
    }

    if (this._checkPlayerFall()) return;

    this._updateControlCenterPanel();
    this._updateHoldingRoomInteractions(delta);
    this._updateSleepingPodInteractions(delta);

    if (this._dashboardHologram) {
      this._dashboardHologram.rotation.y += delta * 0.6;
      this._dashboardHologram.rotation.x += delta * 0.25;
    }
    if (this._dashboardRadarNeedle) {
      this._dashboardRadarNeedle.rotation.z -= delta * 1.8;
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

    if (this.enemySquad) this.enemySquad.update();
    if (this.clonedGuardsSquad) this.clonedGuardsSquad.update();
    this._updateControlRoomDoorInteraction(delta);
    this._updateMissionProgress(delta);

    // Keep weapon reserve ammo infinite in Level 1
    if (this.hasGun && this.weapons?.rifle && this.weapons.rifle.reserve !== Infinity) {
      this.weapons.rifle.reserve = Infinity;
    }

    if (this.player?.health && gameWorld.ui) {
      gameWorld.ui.updatePlayerHealth(this.player.health.currentHealth, this.player.health.maxHealth);
    }

    // Checkpoint navigation shortcuts for stage testing (disabled for player in normal gameplay)
    if (this.enableDevCheckpoints && gameWorld && gameWorld.input && this.player && typeof gameWorld.input.isKeyJustPressed === 'function') {
      if (gameWorld.input.isKeyJustPressed('Digit1')) {
        this.teleportToCheckpoint(1);
      } else if (gameWorld.input.isKeyJustPressed('Digit2')) {
        this.teleportToCheckpoint(2);
      } else if (gameWorld.input.isKeyJustPressed('Digit3')) {
        this.teleportToCheckpoint(3);
      } else if (gameWorld.input.isKeyJustPressed('Digit4')) {
        this.teleportToCheckpoint(4);
      }
    }
  }

  /**
   * Teleports player to a level checkpoint. Preserved as a callable feature,
   * with keyboard shortcuts disabled by default during normal gameplay.
   * @param {number} index
   */
  teleportToCheckpoint(index) {
    if (!this.player) return;
    if (index === 1) {
      this.player.teleport(this.spawnPlayer.x, this.spawnPlayer.y, this.spawnPlayer.z);
      if (this.gameWorld.ui) this.gameWorld.ui.showToast('Checkpoint 1: Holding Cells (Floor 1)', 'info', 2000);
    } else if (index === 2) {
      this.player.teleport(this.checkpoint1.x, this.checkpoint1.y, this.checkpoint1.z);
      if (this.gameWorld.ui) this.gameWorld.ui.showToast('Checkpoint 2: Staircase Entry (Floor 1)', 'info', 2000);
    } else if (index === 3) {
      this.player.teleport(this.checkpoint2.x, this.checkpoint2.y, this.checkpoint2.z);
      if (this.gameWorld.ui) this.gameWorld.ui.showToast('Checkpoint 3: Research Lab (Floor 2)', 'info', 2000);
      if (!this.hasGun) this._takeGunFromDesk();
    } else if (index === 4) {
      this.player.teleport(1.0, 11.2, 73.0);
      this._controlRoomUnlocked = true;
      if (this.controlRoomDoor) this.controlRoomDoor.isLocked = false;
      if (this.gameWorld.ui) this.gameWorld.ui.showToast('Checkpoint 4: Bridge Dashboard (Floor 2)', 'info', 2000);
    }
  }

  _updateMissionProgress(delta) {
    if (this.missionComplete || this.isIntroPlaying) return;

    // Trigger corridor alarm as soon as player exits the holding room into the corridor
    if (!this._corridorAlarmTriggered && this.player && this.player.position.x <= 5.5) {
      this._triggerCorridorAlarm();
    }

    if (this.missionStage === 'holdingBay' && this._corridorAlarmTriggered) {
      this.missionStage = 'corridor';
    } else if (this.missionStage === 'corridor' && this.player && (this.player.position.z >= 38 || this.player.position.y >= 5.0)) {
      this.missionStage = 'stairwell';
      this.gameWorld.ui?.showObjective('REACH THE RESEARCH LAB', 'Ascend the central staircase to Floor 2.');
    } else if (this.missionStage === 'stairwell' && this.player && this.player.position.y >= 7.0 && this.player.position.z < 35) {
      this._triggerLabCloningEvent();
    } else if (this.missionStage === 'labClones') {
      if (this._clonesSpawned && this.clonedGuardsSquad && this.clonedGuardsSquad.aliveCount === 0 && !this._controlRoomUnlocked) {
        this._unlockControlRoom();
      }
    } else if ((this.missionStage === 'lab' || this.missionStage === 'controlRoomApproach') && this.player && this.player.position.z > 68 && this._controlRoomUnlocked) {
      this.missionStage = 'controlRoom';
      this.gameWorld.ui?.showObjective('OVERRIDE FLIGHT SYSTEMS', 'Access the bridge navigation console.');
    }

    if (this.player && (this.player.health?.isDead || this.player.isDead)) {
      if (!this._playerDying) {
        this._startPlayerDeath();
      }
      return;
    }
  }

  /**
   * Activates the ship security alert when the player steps through the holding room doorway.
   * Spawns corridor alien sentries, triggers siren/ambush audio, and displays UI notifications.
   */
  _triggerCorridorAlarm() {
    if (this._corridorAlarmTriggered) return;
    this._corridorAlarmTriggered = true;
    this.missionStage = 'corridor';

    this._spawnCorridorEnemies();

    if (this.gameWorld.audio) {
      this.gameWorld.audio.play('alienCall');
    }
    if (this.gameWorld.music) {
      this.gameWorld.music.stinger('ambush');
      this.gameWorld.music.setState('combat');
    }

    if (this.gameWorld.ui) {
      this.gameWorld.ui.showToast('ALERT: UNAUTHORIZED INTRUSION — SECURITY LOCKDOWN ACTIVATED', 'warning', 4500);
      this.gameWorld.ui.showObjective('BREACH THE CORRIDOR', 'Neutralize hostile sentries along the corridor to reach the staircase.');
    }
  }

  /**
   * Spawns alien sentry combatants throughout the length of the Floor 1 corridor using alien-level1.glb.
   * Sentry AI holds ground near its post, firing plasma down the corridor to incentivize cover-based progression.
   */
  _spawnCorridorEnemies() {
    if (this.enemySquad) return;

    this.enemySquad = this.trackDisposable(new AlienSquad(this.gameWorld, {
      targets: [this.player],
      alertRadius: 40,
      corpseSeconds: 8
    }));

    const assetUrl = `${this.gameWorld.assetBaseUrl || import.meta.env?.BASE_URL || '/'}assets/alien-level1.glb`;

    // Sentry posts staggered along the Floor 1 corridor (Z from -50 to +42, centered roughly around x = 1)
    const sentryConfigs = [
      { pos: new THREE.Vector3(1.2, 0.8, -36), name: 'CorridorSentry_Lower1' },
      { pos: new THREE.Vector3(-0.8, 0.8, -24), name: 'CorridorSentry_Lower2' },
      { pos: new THREE.Vector3(2.0, 0.8, -10), name: 'CorridorSentry_BlastDoorApproach' },
      { pos: new THREE.Vector3(-0.5, 0.8, 12), name: 'CorridorSentry_PastBlastDoor' },
      { pos: new THREE.Vector3(1.8, 0.8, 25), name: 'CorridorSentry_Upper1' },
      { pos: new THREE.Vector3(0.5, 0.8, 37), name: 'CorridorSentry_StaircaseGuard' }
    ];

    for (let i = 0; i < sentryConfigs.length; i++) {
      const cfg = sentryConfigs[i];
      const model = new AlienModel({
        characterOptions: { assetUrl }
      });

      const trooper = new AlienTrooper(this.gameWorld, {
        position: cfg.pos,
        squad: this.enemySquad,
        model,
        name: cfg.name,
        initialState: 'guard',
        engageState: CORRIDOR_SENTRY_ENGAGE,
        states: {
          guard: CORRIDOR_GUARD_STATE,
          investigate: CORRIDOR_INVESTIGATE_STATE
        }
      });

      this.enemySquad.add(trooper);
    }
  }

  _updateControlCenterPanel() {
    if (!this.player?.position || !this.gameWorld.ui) return;

    // 1. Decorative Console Buttons (disabled by default to remove "SHIP CONTROL" UI overlay)
    if (this.showControlCenterUI) {
      const nearControlCenter =
        this.player.position.distanceToSquared(CONTROL_CENTER_POSITION) <=
        CONTROL_CENTER_RADIUS * CONTROL_CENTER_RADIUS;

      if (nearControlCenter !== this._controlCenterVisible) {
        this._controlCenterVisible = nearControlCenter;
        if (nearControlCenter) {
          this.gameWorld.ui.showControlCenter(CONTROL_CENTER_BUTTONS);
        } else {
          this.gameWorld.ui.hideControlCenter();
        }
      }
    } else if (this._controlCenterVisible) {
      this._controlCenterVisible = false;
      this.gameWorld.ui.hideControlCenter();
    }

    // 2. Interactive Navigation Dashboard Console
    if (!this._dashboardAnchor) {
      this._dashboardAnchor = new THREE.Object3D();
      this._dashboardAnchor.position.set(1.0, 11.8, 76.0);
      this.gameWorld.scene.add(this._dashboardAnchor);
      this.trackDisposable(this._dashboardAnchor);
    }

    const p = this.player.position;
    const dx = p.x - 1.0;
    const dz = p.z - 75.0;
    const horizDistSq = dx * dx + dz * dz;

    // Check if player is approaching or in front of the dashboard table in the control room
    // Control room floor: X in [-3.5, 5.5], Z in [70.0, 80.0], Y approx 11.2
    const nearDashboardPrompt = (horizDistSq <= 6.0 * 6.0 || (p.z >= 70.5 && p.z <= 78.5 && p.x >= -3.5 && p.x <= 5.5))
      && Math.abs(p.y - 11.0) < 3.5;

    if (nearDashboardPrompt && !this.missionComplete && (this._controlRoomUnlocked || p.z >= 72.0)) {
      if (!this._dashboardPromptVisible) {
        this._dashboardPromptVisible = true;
        this.gameWorld.ui.showPrompt('[E]', 'SET NAVIGATION COURSE: EARTH', '#38bdf8', this._dashboardAnchor);
      }

      const interactPressed = this.gameWorld.input?.isActionJustPressed?.('specialAction')
        || (typeof this.gameWorld.input?.isKeyJustPressed === 'function' && this.gameWorld.input.isKeyJustPressed('KeyE'));

      if (interactPressed) {
        this._setCourseForEarth();
      }
    } else {
      if (this._dashboardPromptVisible) {
        this._dashboardPromptVisible = false;
        this.gameWorld.ui.hidePrompt(this._dashboardAnchor || this.controlCenterConsole || this);
      }
    }
  }

  /**
   * Triggers the alarm and generates cloned guards from the suit-stations in the lab.
   */
  _triggerLabCloningEvent() {
    if (this._clonesSpawned) return;
    this._clonesSpawned = true;
    this.missionStage = 'labClones';

    this._spawnLabClonedGuards();

    if (this.gameWorld.audio) {
      this.gameWorld.audio.play('alienCall');
    }
    if (this.gameWorld.music) {
      this.gameWorld.music.stinger('ambush');
      this.gameWorld.music.setState('combat');
    }

    if (this.gameWorld.ui) {
      this.gameWorld.ui.showToast('SECURITY ALERT: CLONING SYSTEMS ENGAGED — GENERATING GUARD UNITS TO ELIMINATE THREAT', 'warning', 5000);
      this.gameWorld.ui.showObjective('ELIMINATE CLONED GUARDS', 'Destroy the cloned defenders to unlock the Control Bridge.');
    }
  }

  /**
   * Spawns 4 cloned guards from each cloning system (suit-station) in the Research Lab.
   */
  _spawnLabClonedGuards() {
    if (this.clonedGuardsSquad) return;

    this.clonedGuardsSquad = this.trackDisposable(new AlienSquad(this.gameWorld, {
      targets: [this.player],
      alertRadius: 50,
      corpseSeconds: 8
    }));

    const assetUrl = `${this.gameWorld.assetBaseUrl || import.meta.env?.BASE_URL || '/'}assets/alien-level1-floor2.glb`;

    // Anchor points for the cloning systems in the Research Lab
    const stationPositions = this.cloningStations.length >= 2
      ? this.cloningStations.map(s => s.position)
      : [new THREE.Vector3(-5, 10, -17), new THREE.Vector3(7, 10, -17)];

    // 4 offsets per station to generate 4 distinct guards outside the cloning tubes on the open lab floor
    const spawnOffsets = [
      new THREE.Vector3(0, 0.8, 4.5),     // in front of tube on open floor (z ≈ -12.5)
      new THREE.Vector3(-3.2, 0.8, 3.8),  // outside left flank of tube (z ≈ -13.2)
      new THREE.Vector3(3.2, 0.8, 3.8),   // outside right flank of tube (z ≈ -13.2)
      new THREE.Vector3(0, 0.8, 7.0)      // forward deployment into lab (z ≈ -10.0)
    ];

    let cloneIndex = 1;
    for (const stationPos of stationPositions) {
      for (const offset of spawnOffsets) {
        const spawnPos = new THREE.Vector3(
          stationPos.x + offset.x,
          stationPos.y + offset.y,
          stationPos.z + offset.z
        );

        const model = new AlienModel({
          characterOptions: { assetUrl }
        });

        const trooper = new AlienTrooper(this.gameWorld, {
          position: spawnPos,
          squad: this.clonedGuardsSquad,
          model,
          name: `ClonedGuard_${cloneIndex++}`
        });

        this.clonedGuardsSquad.add(trooper);
      }
    }
  }

  /**
   * Unlocks the Control Room blast door once all cloned guards are eliminated.
   */
  _unlockControlRoom() {
    if (this._controlRoomUnlocked) return;
    this._controlRoomUnlocked = true;
    this.missionStage = 'controlRoomApproach';

    if (this.controlRoomDoor) {
      this.controlRoomDoor.isLocked = false;
    }

    if (this._controlRoomLockedPromptVisible) {
      this._controlRoomLockedPromptVisible = false;
      this.gameWorld.ui?.hidePrompt(this._controlRoomDoorAnchor || this.controlRoomDoor?.mesh || this.controlRoomDoor);
    }

    if (this.gameWorld.audio) {
      this.gameWorld.audio.play('reload');
    }
    if (this.gameWorld.music) {
      this.gameWorld.music.stinger('waveHeld');
    }

    if (this.gameWorld.ui) {
      this.gameWorld.ui.showToast('SECURITY OVERRIDE COMPLETE: Control Room Bulkhead Unlocked.', 'success', 4500);
      this.gameWorld.ui.showObjective('OVERRIDE FLIGHT SYSTEMS', 'Proceed to the bridge navigation console.');
    }
  }

  /**
   * Evaluates proximity to the locked control room door and shows prompt and toast feedback.
   */
  _updateControlRoomDoorInteraction(delta) {
    if (!this.player?.position) return;

    if (this._controlRoomUnlocked) {
      if (this._controlRoomLockedPromptVisible) {
        this._controlRoomLockedPromptVisible = false;
        this.gameWorld.ui?.hidePrompt(this._controlRoomDoorAnchor || this);
      }
      return;
    }

    if (!this._controlRoomDoorAnchor) {
      this._controlRoomDoorAnchor = new THREE.Object3D();
      this._controlRoomDoorAnchor.position.set(1.0, 11.8, 67.5);
      this.gameWorld.scene.add(this._controlRoomDoorAnchor);
      this.trackDisposable(this._controlRoomDoorAnchor);
    }

    // Doorway center is at (1.0, 10.0, 67.5), corridor width is X in [-2.5, 4.5]
    const p = this.player.position;
    const dx = p.x - 1.0;
    const dz = p.z - 67.5;
    const horizDistSq = dx * dx + dz * dz;

    // Check if player is on floor 2 approaching the blast door
    const inApproachZone = horizDistSq <= 7.0 * 7.0 && p.z <= 68.5 && Math.abs(p.y - 11.0) < 3.5;

    if (inApproachZone) {
      if (!this._controlRoomLockedPromptVisible) {
        this._controlRoomLockedPromptVisible = true;
        this.gameWorld.ui?.showPrompt('LOCKED', 'CONTROL ROOM SEALED: SECURITY LOCKDOWN IN EFFECT', '#ef4444', this._controlRoomDoorAnchor);
      }

      // If player bumps up against the blast door or presses interact [E]
      const isTryingToGoThrough = horizDistSq <= 3.8 * 3.8 || p.z >= 65.5;
      const interactPressed = this.gameWorld.input?.isActionJustPressed?.('specialAction')
        || (typeof this.gameWorld.input?.isKeyJustPressed === 'function' && this.gameWorld.input.isKeyJustPressed('KeyE'));

      if (!this._doorLockToastTimer) this._doorLockToastTimer = 0;
      if (this._doorLockToastTimer > 0) this._doorLockToastTimer -= delta;

      if ((interactPressed || isTryingToGoThrough) && this._doorLockToastTimer <= 0) {
        this._doorLockToastTimer = 4.0;
        this.gameWorld.ui?.showToast('CONTROL ROOM LOCKED: Security lockdown in effect. Eliminate all cloned guards to unlock door.', 'warning', 4000);
        if (this.gameWorld.audio) {
          this.gameWorld.audio.play('hit');
        }
      }
    } else {
      if (this._controlRoomLockedPromptVisible) {
        this._controlRoomLockedPromptVisible = false;
        this.gameWorld.ui?.hidePrompt(this._controlRoomDoorAnchor || this);
      }
    }
  }

  /**
   * Locks flight navigation towards Earth, plays the outro cinematic thought sequence, and concludes Level 1.
   */
  _setCourseForEarth() {
    if (this.missionComplete) return;
    this.missionComplete = true;

    if (this._dashboardPromptVisible) {
      this._dashboardPromptVisible = false;
      this.gameWorld.ui?.hidePrompt(this._dashboardAnchor || this.controlCenterConsole || this);
    }
    this.gameWorld.ui?.hideObjective?.();

    // Freeze player controls so avatar stays in place at the console
    if (this.player && typeof this.player.setFrozen === 'function') {
      this.player.setFrozen(true);
    }

    if (this.gameWorld.audio) {
      this.gameWorld.audio.play('reload');
    }
    if (this.gameWorld.music) {
      this.gameWorld.music.stinger('waveHeld');
      this.gameWorld.music.setState('victory');
    }

    if (this.gameWorld.ui) {
      this.gameWorld.ui.showToast('COORDINATES CONFIRMED: HEADING FOR EARTH.', 'success', 5000);
    }

    // Begin the ending cinematic thought sequence
    this.isOutroPlaying = true;
    this.outroElapsed = 0;
    this.outroStage = 0;

    // Show initial thought dialogue (matching intro thought aesthetic)
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showCinematic(
        'Heading for Earth...',
        '"Time to wake the others and suit up."',
        '[Space] Skip',
        true
      );
    }
  }

  /**
   * Advances the ending cutscene showing the player's thoughts, fades to black,
   * and automatically transitions to Level 2.
   */
  _updateOutroCutscene(delta) {
    if (!this.isOutroPlaying) return;

    // Allow skipping the cutscene immediately with Space / Enter / E
    if (this.gameWorld.input && (
      this.gameWorld.input.isActionJustPressed?.('skipCutscene') ||
      this.gameWorld.input.isActionJustPressed?.('specialAction')
    )) {
      this._transitionToLevel02();
      return;
    }

    this.outroElapsed += delta;

    // Stage 0 -> 1 (t = 3.5s): Fade screen to black after player reads closing thoughts
    if (this.outroElapsed >= 3.5 && this.outroStage === 0) {
      this.outroStage = 1;
      if (this.gameWorld.ui) {
        this.gameWorld.ui.showFade(false);
      }
    }

    // Stage 1 -> 2 (t = 4.8s): Once faded to black, unload Level 1 and load Level 2
    if (this.outroElapsed >= 4.8 && this.outroStage >= 1) {
      this._transitionToLevel02();
    }
  }

  /**
   * Fades to black, unloads Level 1, and automatically loads Level 2.
   */
  _transitionToLevel02() {
    if (this._level2TransitionStarted) return;
    this._level2TransitionStarted = true;
    this.isOutroPlaying = false;

    if (this.gameWorld?.ui) {
      this.gameWorld.ui.showFade?.(false);
      this.gameWorld.ui.hideCinematic();
      this.gameWorld.ui.hideObjective?.();
      this.gameWorld.ui.hidePrompt?.();
    }

    // Hand handover to GameWorld.loadLevel, which unloads and disposes Level 1 before initializing Level 2
    if (this.gameWorld && typeof this.gameWorld.loadLevel === 'function') {
      this.gameWorld.loadLevel(new Level02(this.gameWorld));
    }
  }

  _endOutroCutscene() {
    this._transitionToLevel02();
  }

  /**
   * Begins the player death sequence: plays the death animation, halts locomotion,
   * releases pointer lock, and immediately displays the defeat menu with Restart and Home options
   * while the death animation plays in full view.
   */
  _startPlayerDeath() {
    if (this._playerDying) return;
    this._playerDying = true;
    this._deathElapsed = 0;

    if (this.player && typeof this.player.die === 'function') {
      this.player.die();
    }

    if (this.gameWorld.audio) {
      this.gameWorld.audio.play('hurt');
    }
    if (this.gameWorld.music) {
      this.gameWorld.music.setState('defeat');
    }

    this.gameWorld.input?.exitPointerLock?.();

    if (this.gameWorld.ui) {
      this.gameWorld.ui.hidePrompt?.();
      this.gameWorld.ui.hideCrosshair?.();
      this.gameWorld.ui.hideFade?.(false);
      this.gameWorld.ui.showMissionResult({
        outcome: 'defeat',
        title: 'YOU DIED',
        message: 'Security forces neutralized the escape attempt.',
        actions: [
          { label: 'Restart', onClick: () => this.gameWorld.restartCurrentLevel() },
          { label: 'Home', onClick: () => this.gameWorld.returnToMainMenu() }
        ]
      });
    }
  }

  /**
   * Advances the death sequence timers.
   */
  _updatePlayerDeath(delta) {
    if (!this._playerDying) return;
    this._deathElapsed += delta;
  }

  /**
   * Spawns a physical tactical handgun prop resting on the holding room desk.
   */
  _createDeskGunProp() {
    this.deskGunPos = new THREE.Vector3(10.0, 0.88, -39.85);

    this.deskGunGroup = new THREE.Group();
    this.deskGunGroup.name = 'DeskHandgunPickup';
    this.deskGunGroup.position.copy(this.deskGunPos);

    const gunMesh = createHandgunMesh();
    // Lay flat on desk surface with grip resting nicely
    gunMesh.mesh.position.set(0, 0.02, 0);
    gunMesh.mesh.rotation.set(0, Math.PI * 0.25, Math.PI / 2);
    gunMesh.mesh.scale.setScalar(1.5);
    this.deskGunGroup.add(gunMesh.mesh);

    // Glowing green/cyan pickup beacon
    const pickupLight = new THREE.PointLight(0x00f5a0, 2.0, 3.5);
    pickupLight.position.set(0, 0.25, 0);
    this.deskGunGroup.add(pickupLight);
    this.deskGunLight = pickupLight;

    // Glowing tactical pedestal ring
    const ringGeo = new THREE.RingGeometry(0.18, 0.22, 16);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00f5a0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.set(0, 0.01, 0);
    this.deskGunGroup.add(ringMesh);

    this.gameWorld.environmentGroup.add(this.deskGunGroup);
    this.trackDisposable(this.deskGunGroup);
  }

  /**
   * Checks player proximity to the desk weapon and locked cell door.
   * Handles [E] interaction to pick up the firearm and unlock the door.
   */
  _updateHoldingRoomInteractions(delta) {
    if (this.isIntroPlaying || !this.player?.position) return;

    // Subtle breathing pulse for desk gun pickup beacon
    if (this.deskGunLight && !this.hasGun) {
      this.deskGunLight.intensity = 1.6 + Math.sin(Date.now() * 0.005) * 0.6;
    }

    const playerPos = this.player.position;

    // 1. Desk handgun pickup interaction
    if (!this.hasGun && this.deskGunGroup) {
      const distSq = playerPos.distanceToSquared(this.deskGunPos);
      const inPickupRange = distSq <= 2.2 * 2.2;

      if (inPickupRange) {
        if (!this._deskGunPromptVisible) {
          this._deskGunPromptVisible = true;
          this.gameWorld.ui?.showPrompt('[E]', 'TAKE HANDGUN', '#00f5a0', this.deskGunGroup);
        }

        if (this.gameWorld.input?.isActionJustPressed('specialAction')) {
          this._takeGunFromDesk();
        }
      } else {
        if (this._deskGunPromptVisible) {
          this._deskGunPromptVisible = false;
          this.gameWorld.ui?.hidePrompt(this.deskGunGroup);
        }
      }
    }

    // 2. Door locked prompt feedback if approaching exit door without weapon
    if (!this.hasGun && this.cellDoor) {
      const doorPos = this.cellDoor.mesh?.position || new THREE.Vector3(6, 0, -49);
      const distDoorSq = playerPos.distanceToSquared(doorPos);
      const nearDoor = distDoorSq <= 3.2 * 3.2;

      if (nearDoor) {
        if (!this._doorLockedPromptVisible) {
          this._doorLockedPromptVisible = true;
          this.gameWorld.ui?.showPrompt('LOCKED', 'RETRIEVE WEAPON FROM DESK', '#ef4444', this.cellDoor);
        }
      } else {
        if (this._doorLockedPromptVisible) {
          this._doorLockedPromptVisible = false;
          this.gameWorld.ui?.hidePrompt(this.cellDoor);
        }
      }
    }
  }

  /**
   * Executed when the player picks up the handgun from the holding cell desk.
   * Armors player, enables shooting, and unlocks the cell exit door.
   */
  _takeGunFromDesk() {
    if (this.hasGun) return;
    this.hasGun = true;

    if (this._deskGunPromptVisible) {
      this._deskGunPromptVisible = false;
      this.gameWorld.ui?.hidePrompt(this.deskGunGroup);
    }
    if (this._doorLockedPromptVisible && this.cellDoor) {
      this._doorLockedPromptVisible = false;
      this.gameWorld.ui?.hidePrompt(this.cellDoor);
    }

    if (this.deskGunGroup) {
      this.deskGunGroup.visible = false;
      if (this.gameWorld.environmentGroup) {
        this.gameWorld.environmentGroup.remove(this.deskGunGroup);
      }
    }

    // Equip gun on player avatar and enable weapons
    if (this.player && typeof this.player.setHasGun === 'function') {
      this.player.setHasGun(true);
    }
    if (this.weapons && typeof this.weapons.setHasGun === 'function') {
      this.weapons.setHasGun(true);
    }
    if (this.weapons?.rifle) {
      this.weapons.rifle.magazineSize = 60;
      this.weapons.rifle.ammo = 60;
      this.weapons.rifle.reserve = Infinity;
      if (typeof this.weapons._refreshHud === 'function') {
        this.weapons._refreshHud(true);
      }
    }

    // Unlock the holding cell door so it slides open on approach
    if (this.cellDoor) {
      this.cellDoor.isLocked = false;
    }

    if (this.gameWorld.audio) {
      this.gameWorld.audio.play('reload');
    }
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showToast('Tactical Handgun acquired. Cell door unlocked.', 'success', 3500);
      this.gameWorld.ui.showObjective('ESCAPE THE HOLDING BAY', 'Proceed through the unlocked doorway.');
    }
  }

  /**
   * Evaluates proximity to the stasis sleeping capsules/pods in the holding room.
   * Displays [E] OPEN POD prompt and handles interaction feedback.
   */
  _updateSleepingPodInteractions(delta) {
    if (this.isIntroPlaying || !this.player?.position || this.sleepingPods.length === 0) return;

    if (this._podLockFeedbackTimer > 0) {
      this._podLockFeedbackTimer -= delta;
      if (this._podLockFeedbackTimer <= 0 && this._activePod) {
        this.gameWorld.ui?.showPrompt('[E]', 'OPEN POD', '#38bdf8', this._activePod.node);
      }
    }

    const playerPos = this.player.position;
    let nearestPod = null;
    let nearestDistSq = Infinity;

    for (let i = 0; i < this.sleepingPods.length; i++) {
      const pod = this.sleepingPods[i];
      const dx = playerPos.x - pod.position.x;
      const dz = playerPos.z - pod.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestPod = pod;
      }
    }

    // Interaction range: 2.3m from pod center
    const inRange = nearestPod && nearestDistSq <= 2.3 * 2.3 && Math.abs(playerPos.y - nearestPod.position.y) < 2.2;

    if (inRange) {
      if (this._activePod !== nearestPod) {
        if (this._activePod) {
          this.gameWorld.ui?.hidePrompt(this._activePod.node);
        }
        this._activePod = nearestPod;
        this._podLockFeedbackTimer = 0;
        this.gameWorld.ui?.showPrompt('[E]', 'OPEN POD', '#38bdf8', nearestPod.node);
      }

      if (this.gameWorld.input?.isActionJustPressed('specialAction')) {
        this._interactWithPod(nearestPod);
      }
    } else {
      if (this._activePod) {
        this.gameWorld.ui?.hidePrompt(this._activePod.node);
        this._activePod = null;
        this._podLockFeedbackTimer = 0;
      }
    }
  }

  /**
   * Executed when the player attempts to open any stasis sleeping capsule.
   * Informs the player that the pod is electronically locked.
   */
  _interactWithPod(pod) {
    if (this.gameWorld.audio) {
      this.gameWorld.audio.play('hit');
    }
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showToast('Pod Locked: Electronic seal engaged. Cannot open.', 'warning', 2500);
      this.gameWorld.ui.showPrompt('LOCKED', 'POD SEALED', '#ef4444', pod.node);
      this._podLockFeedbackTimer = 1.4;
    }
  }

  _checkPlayerFall() {
    if (this._fallDeathTriggered || !this.player || this.player.position.y >= this._fallDeathY) {
      return false;
    }

    this._fallDeathTriggered = true;
    this.player.setFrozen(true);
    this.gameWorld.input?.exitPointerLock();
    this.gameWorld.isPaused = true;
    this.gameWorld.ui?.showMissionResult({
      outcome: 'defeat',
      title: 'LOST IN SPACE',
      message: 'You fell off the spaceship.',
      actions: [
        { label: 'Restart level', onClick: () => this.gameWorld.restartCurrentLevel() },
        { label: 'Main menu', onClick: () => this.gameWorld.returnToMainMenu() }
      ]
    });
    return true;
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
      this.introCamera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 2000);
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
        if (!this.hasGun) {
          this.gameWorld.ui.showToast('Find a weapon in the holding room to unlock the exit door.', 'info', 4500);
          this.gameWorld.ui.showObjective('SEARCH THE ROOM', 'Take the handgun from the desk to unlock the door.');
        } else {
          this.gameWorld.ui.showToast('Find a way out of the Stasis Holding Bay.', 'info', 4000);
          this.gameWorld.ui.showObjective('ESCAPE THE HOLDING BAY', 'Proceed through the unlocked doorway.');
        }
      }

      // Resume ambient score for level exploration
      if (this.gameWorld.music) {
        this.gameWorld.music.setState('ambient');
      }
    }
  }

  dispose() {
    this._endIntroCutscene();
    if (this._controlCenterVisible) {
      this.gameWorld.ui?.hideControlCenter();
      this._controlCenterVisible = false;
    }
    if (this._deskGunPromptVisible && this.deskGunGroup) {
      this.gameWorld.ui?.hidePrompt(this.deskGunGroup);
      this._deskGunPromptVisible = false;
    }
    if (this._doorLockedPromptVisible && this.cellDoor) {
      this.gameWorld.ui?.hidePrompt(this.cellDoor);
      this._doorLockedPromptVisible = false;
    }
    if (this._activePod) {
      this.gameWorld.ui?.hidePrompt(this._activePod.node);
      this._activePod = null;
    }
    this.sleepingPods = [];
    if (this.deskGunGroup && this.gameWorld?.environmentGroup) {
      this.gameWorld.environmentGroup.remove(this.deskGunGroup);
      this.deskGunGroup = null;
    }
    this.cellDoor = null;
    this.gameWorld.ui?.hideWeaponHUD();

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
    this._dashboardHologram = null;
    this._dashboardRadarNeedle = null;
    this.controlCenterConsole = null;
    this.enemySquad = null;
    this.clonedGuardsSquad = null;
    this.controlRoomDoor = null;
    this.cloningStations = [];
    if (this._playerDying) {
      this.gameWorld.ui?.hideMissionResult?.();
      this.gameWorld.ui?.hideFade?.(false);
    }
    this._playerDying = false;
    if (this.isOutroPlaying) {
      this.isOutroPlaying = false;
    }
    if (this._dashboardPromptVisible) {
      this.gameWorld.ui?.hidePrompt(this._dashboardAnchor || this.controlCenterConsole || this);
      this._dashboardPromptVisible = false;
    }
    this._dashboardAnchor = null;
    if (this._controlRoomLockedPromptVisible) {
      this.gameWorld.ui?.hidePrompt(this._controlRoomDoorAnchor || this);
      this._controlRoomLockedPromptVisible = false;
    }
    this._controlRoomDoorAnchor = null;
    cachedSpaceshipGLTF = null; // Clear cached GLTF on dispose so updated models reload cleanly
    super.dispose();
  }
}
