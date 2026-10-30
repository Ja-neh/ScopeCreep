import * as THREE from 'three';
import { BaseLevel } from './BaseLevel.js';
import { Player } from '../entities/Player.js';
import { ShadowFrustum } from '../rendering/ShadowFrustum.js';
import { WeaponController } from '../weapons/WeaponController.js';
import { ProjectilePool } from '../entities/ProjectilePool.js';
import { AlienSquad } from '../ai/AlienSquad.js';
import { AlienTrooper } from '../entities/enemies/AlienTrooper.js';
import { AlienModel } from '../entities/models/AlienModel.js';
import config from '../config.json';
import {
  DoorSlidingSideways,
  loadDoorSlidingSideways,
  DoorSlidingUp,
  loadDoorSlidingUp,
  BigDoorSlidingUp,
  loadBigDoorSlidingUp
} from '../entities/doors/index.js';

/**
 * DoorTestLevel
 * Flat ground sandbox stage to test all three modular sliding doors:
 * - DoorSlidingSideways (Left: slides horizontally along Z into the wall)
 * - DoorSlidingUp (Center: slides vertically upward along Y)
 * - BigDoorSlidingUp (Right: large blast door sliding vertically upward along Y)
 *
 * Each door features:
 * - Automatic proximity detection (DETECT-*) opening for player/NPCs
 * - Dynamic tweening without keyframed animations (smooth mid-motion reversal)
 * - Moving Rapier cuboid collider (COL-*) moving in lockstep with the panel
 */
export class DoorTestLevel extends BaseLevel {
  constructor(gameWorld) {
    super(gameWorld, 'Doors Test: Modular Sliding Doors');

    this.player = null;
    this.weapons = null;
    this.projectilePool = null;
    this.enemySquad = null;
    this.doorSideways = null;
    this.doorUp = null;
    this.bigDoorUp = null;
    this.groundCollider = null;
    this.sunShadow = null;
  }

  async init() {
    await super.init();

    // 1. Lighting (Clean, bright daylight atmosphere)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    this.gameWorld.environmentGroup.add(ambientLight);
    this.trackDisposable(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff7ed, 1.4);
    sunLight.position.set(60, 120, 60);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.bias = -0.0004;

    this.sunShadow = new ShadowFrustum(sunLight, { halfExtent: 60 });
    this.gameWorld.environmentGroup.add(sunLight);
    this.trackDisposable(sunLight);

    // Subtle sky tint
    this.gameWorld.scene.background = new THREE.Color(0x8ecae6);

    // 2. Flat Ground Surface & Physical Collider
    const groundSize = 200;
    const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize, 16, 16);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.85,
      metalness: 0.15,
      flatShading: true
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    this.gameWorld.environmentGroup.add(groundMesh);
    this.trackDisposable(groundMesh);

    // Create Rapier ground collider flush at Y = 0
    this.groundCollider = this.gameWorld.physics.createGround(groundSize);

    // Distance reference grid
    const gridHelper = new THREE.GridHelper(groundSize, 40, 0x38bdf8, 0x1e293b);
    gridHelper.position.y = 0.02;
    this.gameWorld.environmentGroup.add(gridHelper);
    this.trackDisposable(gridHelper);

    // 3. Instantiate the 3 Modular Doors side-by-side along Z ≈ -15

    // Door 1 (Left): DoorSlidingSideways (Horizontally sliding along Z)
    this.doorSideways = await loadDoorSlidingSideways(this.gameWorld, {
      name: 'Door_Sideways_Test',
      rotation: Math.PI / 2,
      position: new THREE.Vector3(-10 + 2.50, 0, -15 + 0.40),
      openSpeed: 2.2,
      closeSpeed: 1.8,
      closeDelay: 1.0
    });
    this.doorSideways.initPhysics(this.gameWorld.physics);
    this.gameWorld.addEntity(this.doorSideways);
    this.trackDisposable(this.doorSideways);
    this._createDoorMarker(-10, 4.0, -15, 'DOOR SLIDING SIDEWAYS', 0x38bdf8);

    // Door 2 (Center): DoorSlidingUp (Vertically sliding upward along Y)
    this.doorUp = await loadDoorSlidingUp(this.gameWorld, {
      name: 'Door_Up_Test',
      rotation: Math.PI / 2,
      position: new THREE.Vector3(0 + 2.50, 0, -15 + 0.50),
      openSpeed: 2.2,
      closeSpeed: 1.8,
      closeDelay: 1.0
    });
    this.doorUp.initPhysics(this.gameWorld.physics);
    this.gameWorld.addEntity(this.doorUp);
    this.trackDisposable(this.doorUp);
    this._createDoorMarker(0, 4.0, -15, 'DOOR SLIDING UP', 0x10b981);

    // Door 3 (Right): BigDoorSlidingUp (Large hangar door sliding upward along Y)
    this.bigDoorUp = await loadBigDoorSlidingUp(this.gameWorld, {
      name: 'BigDoor_Up_Test',
      position: new THREE.Vector3(12 - 5.0, 0, -15 + 0.50),
      openSpeed: 1.8,
      closeSpeed: 1.5,
      closeDelay: 1.2
    });
    this.bigDoorUp.initPhysics(this.gameWorld.physics);
    this.gameWorld.addEntity(this.bigDoorUp);
    this.trackDisposable(this.bigDoorUp);
    this._createDoorMarker(12, 4.2, -15, 'BIG DOOR SLIDING UP', 0xf59e0b);

    // Add side guide pillars so doorways are visually anchored on the flat ground
    this._createGuidePillars(-10, -15, 2.5);
    this._createGuidePillars(0, -15, 2.5);
    this._createGuidePillars(12, -15, 4.5);

    // 4. Spawn Player in front of the center door
    this.player = new Player(this.gameWorld, {
      walkSpeed: 8.5,
      sprintSpeed: 14.0,
      jumpForce: 10.5,
      maxHealth: config.player.vitals.maxHealth
    });
    // Spawn at (0, 0, 0) facing forward along -Z toward the doors
    this.player.setPosition(0, 0, 0);
    this.player.yaw = 0;
    this.gameWorld.addEntity(this.player);
    this.gameWorld.player = this.player;

    this.weapons = new WeaponController(this.gameWorld, this.player);
    this.gameWorld.addEntity(this.weapons);

    this.projectilePool = new ProjectilePool(this.gameWorld);
    this.gameWorld.addEntity(this.projectilePool);
    this.gameWorld.projectilePool = this.projectilePool;

    this.enemySquad = this.trackDisposable(new AlienSquad(this.gameWorld, {
      targets: [this.player],
      alertRadius: 60,
      corpseSeconds: 8
    }));
    const alienModelOptions = {
      characterOptions: { assetUrl: `${this.gameWorld.assetBaseUrl || '/'}assets/alien-level1.glb` }
    };
    this.enemySquad.add(new AlienTrooper(this.gameWorld, {
      position: new THREE.Vector3(-6, 0, -28),
      squad: this.enemySquad,
      model: new AlienModel(alienModelOptions)
    }));
    this.enemySquad.add(new AlienTrooper(this.gameWorld, {
      position: new THREE.Vector3(6, 0, -28),
      squad: this.enemySquad,
      model: new AlienModel(alienModelOptions)
    }));

    if (this.gameWorld.ui) {
      this.gameWorld.ui.showPlayerHealth();
      this.gameWorld.ui.updatePlayerHealth(this.player.health.currentHealth, this.player.health.maxHealth);
    }

    console.log(`${this.name} initialized with 3 test doors and flat ground.`);
  }

  /**
   * Helper to add side guide posts flanking each doorway
   */
  _createGuidePillars(centerX, centerZ, width) {
    const pillarGeo = new THREE.BoxGeometry(0.4, 3.5, 0.4);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.6,
      metalness: 0.4
    });

    const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
    leftPillar.position.set(centerX - width * 0.5 - 0.2, 1.75, centerZ);
    leftPillar.castShadow = true;
    leftPillar.receiveShadow = true;
    this.gameWorld.environmentGroup.add(leftPillar);
    this.trackDisposable(leftPillar);

    const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
    rightPillar.position.set(centerX + width * 0.5 + 0.2, 1.75, centerZ);
    rightPillar.castShadow = true;
    rightPillar.receiveShadow = true;
    this.gameWorld.environmentGroup.add(rightPillar);
    this.trackDisposable(rightPillar);

    // Create Rapier static boxes for the side pillars so walking into the posts is blocked
    if (this.gameWorld.physics) {
      const colL = this.gameWorld.physics.createStaticBox(
        { x: 0.2, y: 1.75, z: 0.2 },
        { x: leftPillar.position.x, y: 1.75, z: centerZ }
      );
      if (colL) this.trackDisposable({ dispose: () => this.gameWorld.physics.removeCollider(colL) });

      const colR = this.gameWorld.physics.createStaticBox(
        { x: 0.2, y: 1.75, z: 0.2 },
        { x: rightPillar.position.x, y: 1.75, z: centerZ }
      );
      if (colR) this.trackDisposable({ dispose: () => this.gameWorld.physics.removeCollider(colR) });
    }
  }

  /**
   * Helper to create a clean stylized 3D billboard header above each door
   */
  _createDoorMarker(x, y, z, text, accentColor) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Dark sleek background
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.roundRect(8, 8, 496, 112, 16);
    ctx.fill();

    // Colored accent border
    ctx.strokeStyle = `#${accentColor.toString(16).padStart(6, '0')}`;
    ctx.lineWidth = 6;
    ctx.roundRect(8, 8, 496, 112, 16);
    ctx.stroke();

    // Centered label text
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(text, 256, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(x, y, z);
    sprite.scale.set(4.0, 1.0, 1.0);

    this.gameWorld.environmentGroup.add(sprite);
    this.trackDisposable(sprite);
    this.trackDisposable(texture);
    this.trackDisposable(spriteMat);
  }

  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    super.gameplayUpdate(delta, gameWorld);

    if (this.enemySquad) {
      this.enemySquad.update();
    }

    if (this.sunShadow && this.player) {
      this.sunShadow.update(this.player);
    }

    if (this.player?.health && gameWorld.ui) {
      gameWorld.ui.updatePlayerHealth(this.player.health.currentHealth, this.player.health.maxHealth);
    }
  }

  get controls() {
    return [
      { actions: ['forward', 'backward', 'steerLeft', 'steerRight'], label: 'Walk' },
      { actions: ['jump'], label: 'Jump' },
      { actions: ['sprint'], label: 'Sprint' },
      { actions: ['aimDownSights'], label: 'Aim' },
      { actions: ['firePrimary'], label: 'Fire' },
      { actions: ['reload'], label: 'Reload' },
      { actions: ['toggleCamera'], label: 'Toggle View (V)' },
      { actions: ['toggleColliders'], label: 'Toggle Physics Wireframes (B / F2)' }
    ];
  }

  dispose() {
    console.log(`Disposing ${this.name}...`);

    if (this.groundCollider && this.gameWorld.physics) {
      this.gameWorld.physics.removeCollider(this.groundCollider);
      if (this.groundCollider.rigidBody) {
        this.gameWorld.physics.removeRigidBody(this.groundCollider.rigidBody);
      }
      this.groundCollider = null;
    }

    if (this.gameWorld.player === this.player) {
      this.gameWorld.player = null;
    }

    super.dispose();
  }
}
