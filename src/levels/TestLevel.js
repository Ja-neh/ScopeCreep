import * as THREE from 'three';
import { BaseLevel } from './BaseLevel.js';
import { Player } from '../entities/Player.js';
import { Battleship } from '../entities/Battleship.js';
import { ArtilleryTurret } from '../entities/ship-components/ArtilleryTurret.js';
import { FlakTurret } from '../entities/ship-components/FlakTurret.js';

/**
 * TestLevel
 * Open flat space test environment with stylized daylighting,
 * ground plane, modern warship placeholder, player avatar, and standalone gun stations.
 */
export class TestLevel extends BaseLevel {
  constructor(gameWorld) {
    super(gameWorld, 'Test Level (Flat Ground)');
    this.player = null;
    this.battleship = null;
    this.mainGun = null;
    this.flakTurret = null;
  }

  async init() {
    await super.init();

    // 1. Lighting (Stylized daylight)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.gameWorld.environmentGroup.add(ambientLight);
    this.trackDisposable(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.2);
    sunLight.position.set(150, 250, 100);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 600;
    const d = 250;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    this.gameWorld.environmentGroup.add(sunLight);
    this.trackDisposable(sunLight);

    // 2. Flat Ground Surface & Collider
    const groundSize = 1000;
    const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize, 32, 32);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x3d5a80,
      roughness: 0.8,
      metalness: 0.1,
      flatShading: true
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    this.gameWorld.environmentGroup.add(groundMesh);
    this.trackDisposable(groundMesh);

    // Create Rapier ground collider
    this.groundCollider = this.gameWorld.physics.createGround(groundSize);

    // 3. Spatial scale grid helper
    const gridHelper = new THREE.GridHelper(groundSize, 50, 0x98c1d9, 0x293241);
    gridHelper.position.y = 0.05;
    this.gameWorld.environmentGroup.add(gridHelper);
    this.trackDisposable(gridHelper);

    // 4. Instantiate Modern Battleship Placeholder & Collisions
    this.battleship = new Battleship(this.gameWorld, {
      position: new THREE.Vector3(0, 0, 0)
    });
    this.gameWorld.addEntity(this.battleship);
    this.battleship.initPhysics(this.gameWorld.physics);

    // 5. Spawn Human Player alongside the battleship
    this.player = new Player(this.gameWorld, {
      walkSpeed: 9.0,
      sprintSpeed: 16.0,
      jumpForce: 11.0
    });
    // Position player on the right side of the ship facing the ramp
    this.player.setPosition(18, 0.2, 0);
    this.player.yaw = -Math.PI / 2;
    this.gameWorld.addEntity(this.player);

    // 6. Instantiate Standalone Artillery & Flak Turret on the ground testing area
    this.mainGun = new ArtilleryTurret({
      position: new THREE.Vector3(30, 0, -16),
      gameWorld: this.gameWorld
    });
    this.gameWorld.addEntity(this.mainGun);

    this.flakTurret = new FlakTurret({
      position: new THREE.Vector3(30, 0, 16),
      gameWorld: this.gameWorld
    });
    this.gameWorld.addEntity(this.flakTurret);

    console.log(`${this.name} initialized with Battleship, MainGun, FlakTurret, Rapier Ground, and KinematicCharacterController.`);
  }

  update(delta) {
    super.update(delta);
  }

  dispose() {
    console.log(`Disposing ${this.name}...`);
    if (this.groundCollider && this.gameWorld.physics.world) {
      this.gameWorld.physics.world.removeCollider(this.groundCollider, true);
      this.groundCollider = null;
    }
    if (this.mainGun) {
      this.gameWorld.removeEntity(this.mainGun);
      this.mainGun.dispose();
      this.mainGun = null;
    }
    if (this.flakTurret) {
      this.gameWorld.removeEntity(this.flakTurret);
      this.flakTurret.dispose();
      this.flakTurret = null;
    }
    if (this.player) {
      this.gameWorld.removeEntity(this.player);
      this.player = null;
    }
    if (this.battleship) {
      this.gameWorld.removeEntity(this.battleship);
      this.battleship = null;
    }
    super.dispose();
  }
}
