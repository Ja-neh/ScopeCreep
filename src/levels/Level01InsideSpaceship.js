import * as THREE from 'three';
import { BRIG_CAPTIVES, createCaptiveCell } from './level01/CaptiveCells.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BaseLevel } from './BaseLevel.js';
import { Player } from '../entities/Player.js';
import {
  loadDoorSlidingSideways,
  loadDoorSlidingUp,
  loadBigDoorSlidingUp
} from '../entities/doors/index.js';
import { WeaponController } from '../weapons/WeaponController.js';
import { createRifleModel, createWeaponMaterials, disposeModelGeometry } from '../weapons/WeaponModels.js';
import { ProjectilePool } from '../entities/ProjectilePool.js';
import { AlienSquad } from '../ai/AlienSquad.js';
import { AlienTrooper } from '../entities/enemies/AlienTrooper.js';
import { AlienModel } from '../entities/models/AlienModel.js';
import { HumanSquad } from '../ai/HumanSquad.js';
import { SquadMate } from '../entities/allies/SquadMate.js';
import { SoldierModel } from '../entities/models/SoldierModel.js';
import { HUMAN_CHARACTERS, getSelectedCharacter } from '../entities/models/CharacterRoster.js';
import { Level02 } from './Level02.js';
import { CONTROL_CENTER_BUTTONS } from '../ui/components/ControlCenterPanel.js';
import config from '../config.json';

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
      { actions: ['firePrimary'], label: 'Shoot pistol' },
      { actions: ['toggleMap'], label: 'Spaceship map (M)' },
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
    this.weapons = null;
    this.hasGun = false;
    this.cellDoor = null;
    this.deskGunGroup = null;
    this.deskGunMaterials = null;
    this.deskGunRingMaterial = null;
    this.deskGunPos = new THREE.Vector3(10, 0.88, -39.85);
    this.deskGunLight = null;
    this._deskGunPromptVisible = false;
    this._doorLockedPromptVisible = false;
    this._holdingCellBattleStarted = false;
    this.missionAlienSpawnNodes = [];
    this._openedProgressDoors = new WeakSet();
    this._lastGuidedDoor = undefined;
    this._missionObjective = null;
    this._mapRefreshTimer = 0;
    this._doorGuidanceRefreshTimer = 0;
    this.projectilePool = null;
    this.enemySquad = null;
    this.allies = null;
    this.alienSpawns = [];
    this.missionStage = 'holdingBay';
    this.missionComplete = false;
    this.captives = [];
    this._departureSeconds = 0;
    this._fallDeathY = -20;
    this._fallDeathTriggered = false;
    this._controlCenterVisible = false;
    this.controlCenterConsole = null;

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

  getMapTerrain() {
    return {
      kind: 'spaceship',
      title: 'SPACESHIP MAP',
      enemyLegend: 'Aliens (square: upper deck)',
      markerLegend: 'Doors: gold next, square upper',
      canvasScale: 2.2,
      bounds: { minX: -72, maxX: 72, minZ: -56, maxZ: 88 },
      drawBackground(ctx, width, height, bounds) {
        const scaleX = width / (bounds.maxX - bounds.minX);
        const scaleZ = height / (bounds.maxZ - bounds.minZ);
        ctx.save();
        ctx.setTransform(scaleX, 0, 0, scaleZ, -bounds.minX * scaleX, -bounds.minZ * scaleZ);
        ctx.fillStyle = '#08111e';
        ctx.fillRect(bounds.minX, bounds.minZ, bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);

        for (let x = Math.ceil(bounds.minX / 10) * 10; x <= bounds.maxX; x += 10) {
          ctx.strokeStyle = 'rgba(100, 160, 190, 0.08)';
          ctx.lineWidth = 0.35;
          ctx.beginPath(); ctx.moveTo(x, bounds.minZ); ctx.lineTo(x, bounds.maxZ); ctx.stroke();
        }
        for (let z = Math.ceil(bounds.minZ / 10) * 10; z <= bounds.maxZ; z += 10) {
          ctx.beginPath(); ctx.moveTo(bounds.minX, z); ctx.lineTo(bounds.maxX, z); ctx.stroke();
        }

        ctx.beginPath();
        ctx.moveTo(-8, -55); ctx.lineTo(10, -55); ctx.lineTo(18, -39);
        ctx.lineTo(20, 70); ctx.lineTo(12, 87); ctx.lineTo(-13, 87);
        ctx.lineTo(-20, 70); ctx.lineTo(-18, -39); ctx.closePath();
        ctx.fillStyle = '#17283a'; ctx.fill();
        ctx.strokeStyle = '#7ecfe0'; ctx.lineWidth = 1.2; ctx.stroke();

        const room = (x, z, w, d, color, label) => {
          ctx.fillStyle = color; ctx.fillRect(x, z, w, d);
          ctx.strokeStyle = 'rgba(126, 207, 224, 0.5)'; ctx.lineWidth = 0.7;
          ctx.strokeRect(x, z, w, d);
          if (label) {
            ctx.fillStyle = '#c8dbe8';
            ctx.font = '4.2px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(label, x + w / 2, z + d / 2);
          }
        };

        // Passage spine connects the brig, holding bay, stairs, lab, and bridge.
        room(-5, -53, 10, 137, '#263b50', 'PASSAGE');
        room(6, -54, 13, 18, '#33495b', 'BRIG');
        room(-16, -28, 10, 21, '#293d50', 'HOLDING BAY');
        room(6, -24, 12, 21, '#293d50', 'STORAGE');
        room(6, 28, 13, 22, '#3b3542', 'STAIRS');
        room(-17, 2, 11, 35, '#293d50', 'LAB');
        room(6, 2, 12, 22, '#293d50', 'LAB');
        room(-15, 57, 17, 29, '#33495b', 'BRIDGE');

        ctx.restore();
      }
    };
  }

  getMapData() {
    const player = this.player;
    if (!player?.position) return null;
    const mates = (this.allies?.members || []).filter((mate) => mate !== player).map((mate) => ({
      x: mate.position.x,
      z: mate.position.z,
      downed: !!mate.health?.isDead
    }));
    let enemies = (this.enemySquad?.members || []).filter((alien) => alien.health && !alien.health.isDead).map((alien) => ({
      x: alien.position.x,
      z: alien.position.z,
      floor: alien.position.y > 7 ? 2 : 1,
      big: !!alien.isBoss,
      alerted: !!alien.perception?.target
    }));
    if (!this._holdingCellBattleStarted) {
      let positions = this.missionAlienSpawnNodes.map((node) => node.getWorldPosition(new THREE.Vector3()));
      if (!positions.length) {
        positions = [
          new THREE.Vector3(4, 1, -38), new THREE.Vector3(4, 1, -28),
          new THREE.Vector3(1, 1, 16), new THREE.Vector3(-4, 11, 0), new THREE.Vector3(5, 11, 18)
        ];
      }
      enemies = positions.map((position) => ({ x: position.x, z: position.z, floor: position.y > 7 ? 2 : 1, alerted: false }));
      const gunnerIndices = new Set(positions.length >= 3 ? [1, 2] : [Math.max(0, positions.length - 1)]);
      if (positions.length > 3) gunnerIndices.add(3);
      if (positions.length > 4) gunnerIndices.add(4);
      for (const index of gunnerIndices) {
        const position = positions[index];
        enemies.push({
          x: position.x + (position.x > 0 ? -2.2 : 2.2),
          z: position.z,
          floor: position.y > 7 ? 2 : 1,
          alerted: false
        });
      }
    }
    return {
      player: { x: player.position.x, z: player.position.z, yaw: player.yaw },
      mates,
      enemies,
      markers: this._mapDoorMarkers()
    };
  }

  _doorWorldPosition(door, target = new THREE.Vector3()) {
    if (door?.mesh) return door.mesh.getWorldPosition(target);
    return target.set(0, 0, 0);
  }

  _doorLabel(door, position = this._doorWorldPosition(door)) {
    if (door === this.cellDoor) return 'CELL EXIT';
    if (Math.abs(position.z) < 2) return 'HOLDING BAY';
    if (Math.abs(position.z - 24) < 2) return 'LAB ACCESS';
    if (Math.abs(position.z - 42) < 2) return position.y > 7 ? 'UPPER STAIR' : 'STAIRWELL';
    if (Math.abs(position.z - 68) < 2) return 'BRIDGE';
    return 'SHIP DOOR';
  }

  _getNextDoor() {
    for (const door of this.doors) {
      if (door.isOpen?.()) this._openedProgressDoors.add(door);
    }
    if (this.cellDoor && !this._openedProgressDoors.has(this.cellDoor)) return this.cellDoor;

    const playerPosition = this.player?.position;
    const candidates = this.doors.filter((door) => door !== this.cellDoor && !this._openedProgressDoors.has(door) && !door.isLocked);
    if (!candidates.length) return null;
    if (!playerPosition) return candidates[0];

    const playerFloor = playerPosition.y > 7 ? 2 : 1;
    const sameFloor = candidates.filter((door) => (this._doorWorldPosition(door).y > 7 ? 2 : 1) === playerFloor);
    const pool = sameFloor.length ? sameFloor : candidates;
    pool.sort((a, b) => this._doorWorldPosition(a).distanceToSquared(playerPosition) - this._doorWorldPosition(b).distanceToSquared(playerPosition));
    return pool[0];
  }

  _mapDoorMarkers() {
    const nextDoor = this._getNextDoor();
    return this.doors.map((door) => {
      const position = this._doorWorldPosition(door);
      const opened = this._openedProgressDoors.has(door) || !!door.isOpen?.();
      return {
        x: position.x,
        z: position.z,
        floor: position.y > 7 ? 2 : 1,
        label: `${door === nextDoor ? 'NEXT: ' : ''}${this._doorLabel(door, position)}`,
        done: opened,
        door: true,
        next: door === nextDoor
      };
    });
  }

  _setMissionObjective(title, detail = '') {
    this._missionObjective = { title, detail };
    this._renderMissionObjective();
  }

  _renderMissionObjective() {
    if (!this._missionObjective || this.missionComplete) return;
    const nextDoor = this._getNextDoor();
    const doorHint = nextDoor ? ` Next door: ${this._doorLabel(nextDoor)}; marked on the spaceship map.` : '';
    this.gameWorld.ui?.showObjective?.(this._missionObjective.title, `${this._missionObjective.detail}${doorHint}`);
  }

  _updateNextDoorGuidance(delta) {
    if (this.missionComplete) return;
    this._doorGuidanceRefreshTimer -= delta;
    if (this._doorGuidanceRefreshTimer > 0) return;
    this._doorGuidanceRefreshTimer = 0.12;
    const nextDoor = this._getNextDoor();
    if (nextDoor === this._lastGuidedDoor) return;
    this._lastGuidedDoor = nextDoor;
    this._renderMissionObjective();
  }

  _updateShipMap(delta) {
    const ui = this.gameWorld.ui;
    if (!ui || (!ui.isMapOpen && !ui.isMinimapVisible)) return;
    this._mapRefreshTimer -= delta;
    if (this._mapRefreshTimer > 0) return;
    this._mapRefreshTimer = 0.12;
    ui.updateMap(this.getMapData());
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
    const alienSpawnNodes = [];
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
        alienSpawnNodes.push(node);
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
    this.missionAlienSpawnNodes = alienSpawnNodes;

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

    // 7. The chosen hero wakes in the holding cell; the other heroes are captives nearby.
    this.player = new Player(this.gameWorld, {
      characterId: getSelectedCharacter(),
      walkSpeed: 7.5,
      sprintSpeed: 12.5,
      canJump: false,
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
    this._createCaptives();
    this.allies = this.trackDisposable(new HumanSquad(this.gameWorld, {
      leader: this.player,
      isWalkable: (x, z) => x > -22 && x < 22 && z > -90 && z < 90,
      corpseSeconds: config.levels.level01.corpseSeconds,
      onMemberExpired: (member) => {
        if (member !== this.player) this._recoverSquadmate(member);
      }
    }));

    this.projectilePool = new ProjectilePool(this.gameWorld);
    this.gameWorld.addEntity(this.projectilePool);
    this.gameWorld.projectilePool = this.projectilePool;
    this._createDeskGunProp();

    this.enemySquad = this.trackDisposable(new AlienSquad(this.gameWorld, {
      targets: this.allies.members,
      alertRadius: 60,
      corpseSeconds: config.levels.level01.corpseSeconds
    }));
    this.allies.enemySquad = this.enemySquad;
    if (this.gameWorld.ui) {
      this.gameWorld.ui.hideCrosshair?.();
      this.gameWorld.ui.hideWeaponHUD?.();
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

  _createCaptives() {
    const remaining = HUMAN_CHARACTERS.filter((hero) => hero.id !== this.player.characterId);
    for (let index = 0; index < remaining.length; index++) {
      const hero = remaining[index];
      const cell = createCaptiveCell();
      const { group, cage, geometry, material } = cell;
      group.position.set(...BRIG_CAPTIVES[index]);
      group.name = `Captive ${hero.name}`;
      const model = new SoldierModel({ characterId: hero.id });
      model.gun.visible = false;
      model.character?.setArmed?.(false);
      group.add(model.mesh);
      this.gameWorld.environmentGroup.add(group);
      this.captives.push({ hero, group, model, cage, geometry, material, cell, freed: false, progress: 0 });
    }
  }

  _updateCaptives(delta) {
    if (this.isIntroPlaying || this.missionStage !== 'rescue') {
      this.gameWorld.ui?.hidePrompt?.(this);
      return;
    }
    const nearby = this.captives.find((captive) => !captive.freed &&
      this.player.position.distanceToSquared(captive.group.position) < config.levels.level01.captiveRescueRadius ** 2);
    if (!nearby) {
      this.gameWorld.ui?.hidePrompt?.(this);
      for (const captive of this.captives) captive.progress = 0;
      return;
    }
    if (this.gameWorld.input.isActionDown('specialAction')) {
      nearby.progress += delta;
      if (nearby.progress >= config.levels.level01.captiveRescueSeconds) {
        nearby.freed = true;
        nearby.cage.visible = false;
        nearby.model.mesh.visible = false;
        const position = nearby.group.position.clone();
        position.x += position.x < 13 ? -1 : 1;
        const ally = new SquadMate(this.gameWorld, {
          name: nearby.hero.name,
          position,
          squad: this.allies,
          model: new SoldierModel({ characterId: nearby.hero.id })
        });
        this.allies.add(ally);
        ally.follow();
        this.gameWorld.ui?.hidePrompt?.(this);
        this.gameWorld.ui?.showToast?.(`${nearby.hero.name} is free!`, 'success', 2500);
        return;
      }
    } else {
      nearby.progress = 0;
    }
    this.gameWorld.ui?.showPrompt?.('E', `FREE ${nearby.hero.name.toUpperCase()} (${Math.floor(nearby.progress / config.levels.level01.captiveRescueSeconds * 100)}%)`, '#76e9ec', this);
  }

  _recoverSquadmate(mate) {
    if (!mate || mate === this.player || !mate.rigidBody) return;
    const player = this.player.position;
    const angle = (mate.slotIndex || 0) * 2.399963229728653;
    const x = THREE.MathUtils.clamp(player.x + Math.cos(angle) * 2.2, -8.5, 8.5);
    const z = THREE.MathUtils.clamp(player.z + Math.sin(angle) * 2.2, -43, 43);

    mate.isLost = false;
    mate.lostTime = 0;
    mate.revive(mate.health.maxHealth);
    mate.teleport(x, player.y, z);
    mate.follow();
    mate.reviveSecondsLeft = 0;
    this.gameWorld.ui?.showToast?.(`${mate.name} regrouped with the team.`, 'info', 2500);
  }

  _spawnMissionAliens(spawnNodes = []) {
    if (this.alienSpawns.length > 0) return;
    const positions = [];
    for (const node of spawnNodes) {
      positions.push(node.getWorldPosition(new THREE.Vector3()));
    }
    if (!positions.length) {
      positions.push(
        // Keep the first hostile in the passage rather than among the captive pods.
        new THREE.Vector3(4, 1, -38),
        new THREE.Vector3(4, 1, -28),
        new THREE.Vector3(1, 1, 16),
        new THREE.Vector3(-4, 11, 0),
        new THREE.Vector3(5, 11, 18)
      );
    }

    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      const model = new AlienModel({ characterId: 'gorr', characterOptions: {
        assetUrl: `${this.gameWorld.assetBaseUrl || '/'}assets/alien-level1.glb`
      } });
      const alien = new AlienTrooper(this.gameWorld, { position, squad: this.enemySquad, model });
      alien.missionFloor = position.y > 7 ? 2 : 1;
      alien.missionStage = i < 3 ? 'holdingBay' : 'lab';
      this.enemySquad.add(alien);
      this.alienSpawns.push(alien);
    }

    // Add two armed robotic gunners to each section where there are enough spawn anchors.
    const gunnerIndices = new Set(positions.length >= 3 ? [1, 2] : [Math.max(0, positions.length - 1)]);
    if (positions.length > 3) gunnerIndices.add(3);
    if (positions.length > 4) gunnerIndices.add(4);
    for (const index of gunnerIndices) {
      const spawn = positions[index];
      const gunnerPosition = spawn.clone();
      gunnerPosition.x += spawn.x > 0 ? -2.2 : 2.2;
      const gunnerModel = new AlienModel({
        // Gorr provides a rifle and ranged AI; the Afton model supplies the robotic look.
        characterId: 'gorr',
        characterOptions: {
          assetUrl: `${this.gameWorld.assetBaseUrl || base}assets/characters/elite-afton.glb`
        }
      });
      const gunner = new AlienTrooper(this.gameWorld, {
        position: gunnerPosition,
        squad: this.enemySquad,
        model: gunnerModel
      });
      gunner.missionFloor = spawn.y > 7 ? 2 : 1;
      gunner.missionStage = index < 3 ? 'holdingBay' : 'lab';
      this.enemySquad.add(gunner);
      this.alienSpawns.push(gunner);
    }
  }

  _createDeskGunProp() {
    this.deskGunGroup = new THREE.Group();
    this.deskGunGroup.name = 'DeskRiflePickup';
    this.deskGunGroup.position.copy(this.deskGunPos);

    this.deskGunMaterials = createWeaponMaterials();
    const rifle = createRifleModel(this.deskGunMaterials);
    rifle.mesh.position.set(0, 0.04, 0);
    rifle.mesh.rotation.set(0, Math.PI * 0.25, Math.PI / 2);
    rifle.mesh.scale.setScalar(0.72);
    this.deskGunGroup.add(rifle.mesh);

    this.deskGunLight = new THREE.PointLight(0x00f5a0, 1.8, 3.5);
    this.deskGunLight.position.set(0, 0.3, 0);
    this.deskGunGroup.add(this.deskGunLight);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.24, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x00f5a0, side: THREE.DoubleSide })
    );
    ring.position.y = 0.015;
    this.deskGunRingMaterial = ring.material;
    this.deskGunGroup.add(ring);
    this.gameWorld.environmentGroup.add(this.deskGunGroup);
  }

  _updateHoldingRoomInteractions() {
    if (this.isIntroPlaying || !this.player?.position) return;

    if (this.deskGunLight && !this.hasGun) {
      this.deskGunLight.intensity = 1.5 + Math.sin(Date.now() * 0.005) * 0.5;
    }

    if (!this.hasGun && this.deskGunGroup) {
      const nearGun = this.player.position.distanceToSquared(this.deskGunPos) <= 2.2 * 2.2;
      if (nearGun) {
        if (!this._deskGunPromptVisible) {
          this._deskGunPromptVisible = true;
          this.gameWorld.ui?.showPrompt?.('[E]', 'PICK UP RIFLE', '#00f5a0', this.deskGunGroup);
        }
        if (this.gameWorld.input?.isActionJustPressed('specialAction')) this._takeGunFromDesk();
      } else if (this._deskGunPromptVisible) {
        this._deskGunPromptVisible = false;
        this.gameWorld.ui?.hidePrompt?.(this.deskGunGroup);
      }
    }

    if (!this.hasGun && this.cellDoor) {
      const doorPos = this.cellDoor.mesh?.position || new THREE.Vector3(6, 0, -49);
      const nearDoor = this.player.position.distanceToSquared(doorPos) <= 3.2 * 3.2;
      if (nearDoor && !this._doorLockedPromptVisible) {
        this._doorLockedPromptVisible = true;
        this.gameWorld.ui?.showPrompt?.('LOCKED', 'PICK UP THE RIFLE FROM THE DESK', '#ef4444', this.cellDoor);
      } else if (!nearDoor && this._doorLockedPromptVisible) {
        this._doorLockedPromptVisible = false;
        this.gameWorld.ui?.hidePrompt?.(this.cellDoor);
      }
    }
  }

  _takeGunFromDesk() {
    if (this.hasGun) return;
    this.hasGun = true;

    if (this._deskGunPromptVisible) {
      this._deskGunPromptVisible = false;
      this.gameWorld.ui?.hidePrompt?.(this.deskGunGroup);
    }
    if (this._doorLockedPromptVisible && this.cellDoor) {
      this._doorLockedPromptVisible = false;
      this.gameWorld.ui?.hidePrompt?.(this.cellDoor);
    }

    if (this.deskGunGroup) {
      disposeModelGeometry(this.deskGunGroup);
      this.deskGunGroup = null;
      for (const material of Object.values(this.deskGunMaterials || {})) material.dispose();
      this.deskGunMaterials = null;
      this.deskGunRingMaterial?.dispose();
      this.deskGunRingMaterial = null;
      this.deskGunLight = null;
    }

    this.weapons = new WeaponController(this.gameWorld, this.player);
    this.gameWorld.addEntity(this.weapons);
    this.weapons.pickUpRifle();
    this.cellDoor?.unlock?.();

    this.gameWorld.audio?.play?.('reload');
    this.gameWorld.ui?.showToast?.('Rifle acquired. The cell door is unlocked.', 'success', 3500);
    this._setMissionObjective('EXIT THE HOLDING BAY', 'Approach the unlocked cell door.');
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
    consoleGroup.position.set(-4, 10.6, 81.5);
    this.gameWorld.environmentGroup.add(consoleGroup);
    this.trackDisposable(consoleGroup);
    this.controlCenterConsole = consoleGroup;

    const addMesh = (name, geometry, material, position) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.position.set(...position);
      consoleGroup.add(mesh);
      this.trackDisposable(mesh);
    };

    addMesh(
      'ControlCenterPanelBacking',
      new THREE.BoxGeometry(3.2, 1.9, 0.16),
      new THREE.MeshStandardMaterial({
        color: 0x172b3b,
        metalness: 0.75,
        roughness: 0.32
      }),
      [0, 0, 0]
    );

    addMesh(
      'ControlCenterDisplay',
      new THREE.BoxGeometry(1.7, 0.34, 0.04),
      new THREE.MeshStandardMaterial({
        color: 0x082f49,
        emissive: 0x0284c7,
        emissiveIntensity: 1.6,
        metalness: 0.25,
        roughness: 0.28
      }),
      [0, 0.58, -0.1]
    );

    const buttonColumns = [-0.85, 0, 0.85];
    const buttonRows = [-0.05, -0.55];
    CONTROL_CENTER_BUTTONS.forEach((button, index) => {
      const column = index % buttonColumns.length;
      const row = Math.floor(index / buttonColumns.length);
      const color = Number.parseInt(button.color.slice(1), 16);
      addMesh(
        `ControlCenterButton-${button.label.replaceAll(' ', '-')}`,
        new THREE.BoxGeometry(0.58, 0.25, 0.1),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.45,
          metalness: 0.35,
          roughness: 0.3
        }),
        [buttonColumns[column], buttonRows[row], -0.14]
      );
    });
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
      const isHoldingCellDoor = /Sliding-Sideways.*001/i.test(name) ||
        (Math.abs(worldPos.x - 6) < 1.5 && Math.abs(worldPos.z + 49) < 1.5);
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
      if (isHoldingCellDoor) this.cellDoor = door;
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

    if (this._checkPlayerFall()) return;

    this._updateControlCenterPanel();
    this._updateHoldingRoomInteractions(delta);

    if (this.hasGun && !this._holdingCellBattleStarted && this.cellDoor?.isOpen?.()) {
      this._holdingCellBattleStarted = true;
      this._spawnMissionAliens(this.missionAlienSpawnNodes);
      this.gameWorld.ui?.showToast?.('Hostiles detected beyond the holding cell.', 'warning', 3500);
      this._setMissionObjective('FIGHT THROUGH THE ALIENS', 'Clear the holding bay to reach the captives.');
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

    if (this._holdingCellBattleStarted && this.enemySquad) this.enemySquad.update();
    this.allies?.update(delta);
    this._updateCaptives(delta);
    this._updateMissionProgress(delta);
    this._updateNextDoorGuidance(delta);
    this._updateShipMap(delta);
    if (this.player?.health && gameWorld.ui) {
      gameWorld.ui.updatePlayerHealth(this.player.health.currentHealth, this.player.health.maxHealth);
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

  _updateMissionProgress(delta) {
    if (this.missionComplete) {
      this._departureSeconds -= delta;
      if (this._departureSeconds <= 0 && !this._departing) {
        this._departing = true;
        this.gameWorld.ui?.hideCinematic?.();
        this.gameWorld.loadLevel(new Level02(this.gameWorld));
      }
      return;
    }
    if (this.isIntroPlaying || !this.enemySquad) return;
    if (this.missionStage === 'holdingBay' && !this._holdingCellBattleStarted) return;
    const floorEnemies = this.enemySquad.members.filter((alien) => !alien.isDead && alien.missionStage === this.missionStage);

    if (this.missionStage === 'holdingBay' && floorEnemies.length === 0) {
      this.missionStage = 'rescue';
      this._setMissionObjective('FREE THE CAPTIVES', 'Hold E beside each cage to rescue the other main characters.');
    } else if (this.missionStage === 'rescue' && this.captives.every((captive) => captive.freed)) {
      this.missionStage = 'stairwell';
      this._setMissionObjective('REACH THE STAIRWELL', 'Everyone is free. Climb to Floor 2 and fight toward the bridge.');
    } else if (this.missionStage === 'stairwell' && this.player.position.y >= 7 && this.player.position.z < 55) {
      this.missionStage = 'lab';
      this._setMissionObjective('SECURE THE LAB', 'Eliminate the remaining aliens in the research lab.');
    } else if (this.missionStage === 'lab' && !this.enemySquad.members.some((alien) => !alien.isDead && alien.missionStage === 'lab')) {
      this.missionStage = 'controlRoom';
      this._setMissionObjective('TAKE CONTROL OF THE SHIP', 'Reach the bridge console and turn the transport back toward Earth.');
    } else if (this.missionStage === 'controlRoom' && this.player.position.distanceTo(CONTROL_CENTER_POSITION) < CONTROL_CENTER_RADIUS) {
      this.missionComplete = true;
      this._departureSeconds = config.levels.level01.departureSeconds;
      this.player.setFrozen(true);
      this._missionObjective = null;
      this.gameWorld.ui?.hideObjective?.();
      this.gameWorld.ui?.showCinematic?.('COURSE: EARTH', 'The crew takes the bridge. The captured ship turns toward the occupied island.');
    }

    if (this.player.health?.isDead && !this._respawning) {
      this._respawning = true;
      this._respawnTimer = config.player.vitals.respawnSeconds;
    }
    if (this._respawning) {
      this._respawnTimer -= delta;
      if (this._respawnTimer <= 0) {
        this._respawning = false;
        const respawnPoint = this.missionStage === 'lab' || this.player.position.y > 7 ? this.checkpoint2 : this.spawnPlayer;
        this.player.teleport(respawnPoint.x, respawnPoint.y, respawnPoint.z);
        this.player.health.reset();
        this.player.model.character.resetPose();
      }
    }
  }

  _updateControlCenterPanel() {
    if (!this.player?.position || !this.gameWorld.ui) return;

    const nearControlCenter =
      this.player.position.distanceToSquared(CONTROL_CENTER_POSITION) <=
      CONTROL_CENTER_RADIUS * CONTROL_CENTER_RADIUS;

    if (nearControlCenter === this._controlCenterVisible) return;

    this._controlCenterVisible = nearControlCenter;
    if (nearControlCenter) {
      this.gameWorld.ui.showControlCenter(CONTROL_CENTER_BUTTONS);
    } else {
      this.gameWorld.ui.hideControlCenter();
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

  get controls() {
    return [
      { actions: ['forward', 'backward', 'steerLeft', 'steerRight'], label: 'Move' },
      { actions: ['jump'], label: 'Jump' },
      { actions: ['sprint'], label: 'Sprint' },
      { actions: ['aimDownSights'], label: 'Aim' },
      { actions: ['firePrimary'], label: 'Fire' },
      { actions: ['reload'], label: 'Reload' },
      { actions: ['specialAction'], label: 'Pick up weapon / Interact' },
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
          this.gameWorld.ui.showToast('Find the rifle on the desk to unlock the cell door.', 'info', 4500);
          this._setMissionObjective('SEARCH THE HOLDING BAY', 'Pick up the rifle from the desk to unlock the exit door.');
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
        this.gameWorld.ui.showToast('Find the rifle on the desk to unlock the cell door.', 'info', 4500);
        this._setMissionObjective('SEARCH THE HOLDING BAY', 'Pick up the rifle from the desk to unlock the exit door.');
      }

      // Resume ambient score for level exploration
      if (this.gameWorld.music) {
        this.gameWorld.music.setState('ambient');
      }
    }
  }

  dispose() {
    this._endIntroCutscene();
    this.gameWorld.ui?.hidePrompt?.(this);
    if (this._deskGunPromptVisible && this.deskGunGroup) {
      this.gameWorld.ui?.hidePrompt?.(this.deskGunGroup);
      this._deskGunPromptVisible = false;
    }
    if (this._doorLockedPromptVisible && this.cellDoor) {
      this.gameWorld.ui?.hidePrompt?.(this.cellDoor);
      this._doorLockedPromptVisible = false;
    }
    if (this.deskGunGroup) disposeModelGeometry(this.deskGunGroup);
    this.deskGunGroup = null;
    for (const material of Object.values(this.deskGunMaterials || {})) material.dispose();
    this.deskGunMaterials = null;
    this.deskGunRingMaterial?.dispose();
    this.deskGunRingMaterial = null;
    for (const captive of this.captives) {
      captive.group.parent?.remove(captive.group);
      captive.model.dispose();
      captive.cell.dispose();
    }
    this.captives = [];
    if (this._controlCenterVisible) {
      this.gameWorld.ui?.hideControlCenter();
      this._controlCenterVisible = false;
    }

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
