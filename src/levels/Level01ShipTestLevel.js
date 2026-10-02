import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BaseLevel } from './BaseLevel.js';
import { Ocean } from '../rendering/Ocean.js';
import { Battleship } from '../entities/Battleship.js';
import { Player } from '../entities/Player.js';
import { ProjectilePool } from '../entities/ProjectilePool.js';

/**
 * Level01TestLevel
 * Sandbox copy of Level 1 (Operation Retake) dedicated to AI Enemy Battleship testing.
 * Features:
 * - Identical ocean, lighting, and player warship environment as Level 1
 * - High-performance Projectile Object Pool
 * - Orbit / aerial inspection camera for observing AI maneuvers from above
 * - Isolated staging area for testing enemy battleship AI behaviors
 */
export class Level01TestLevel extends BaseLevel {
  constructor(gameWorld) {
    super(gameWorld, 'Level 1: AI Ship Test Level');
    this.water = null;
    this.battleship = null;
    this.player = null;
    this.projectilePool = null;

    // Dev Tools Camera System
    this.cameraMode = 'PLAYER'; // 'PLAYER' | 'AERIAL'
    this.aerialCamera = null;
    this.orbitControls = null;
    this._onKeyDown = null;
  }

  async init() {
    await super.init();

    // 1. Atmosphere & Sky
    this.gameWorld.scene.background = new THREE.Color(0x87ceeb); // Ocean daylight sky
    this.gameWorld.scene.fog = new THREE.FogExp2(0x87ceeb, 0.0010);

    // 2. Directional Sun & Ambient Lighting
    const sunDirection = new THREE.Vector3(150, 250, 100).normalize();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    this.gameWorld.environmentGroup.add(ambientLight);
    this.trackDisposable(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.4);
    sunLight.position.set(150, 250, 100);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 1200;
    const d = 400;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    this.gameWorld.environmentGroup.add(sunLight);
    this.trackDisposable(sunLight);

    // 3. Custom Ocean Mesh & Shader
    this.water = new Ocean({
      size: 2600,
      segments: 200,
      sunDirection: sunDirection
    });
    this.gameWorld.environmentGroup.add(this.water.mesh);
    this.trackDisposable(this.water);

    // 3.5 High-Performance Projectile Object Pool
    this.projectilePool = new ProjectilePool(this.gameWorld);
    this.gameWorld.addEntity(this.projectilePool);
    this.gameWorld.projectilePool = this.projectilePool;

    // 4. Instantiate Modern Battleship with Ocean Buoyancy
    this.battleship = new Battleship(this.gameWorld, {
      position: new THREE.Vector3(0, 0, 0),
      water: this.water
    });
    await this.battleship.ready;
    this.gameWorld.addEntity(this.battleship);
    this.battleship.initPhysics(this.gameWorld.physics);

    // 5. Spawn Player Character Controller on the Battleship Walking Deck
    this.player = new Player(this.gameWorld, {
      walkSpeed: 8.0,
      sprintSpeed: 14.0,
      jumpForce: 10.0
    });
    // Position player on forward walking deck
    this.player.setPosition(0.46, 6.2, -14.0);
    this.player.yaw = 0;
    this.gameWorld.addEntity(this.player);

    // 6. Initialize Aerial Inspection Camera & OrbitControls
    this._initAerialCamera();

    // 7. Initialize Dev Tools UI Overlay & Keybinds
    this._initDevTools();

    // 8. Ocean surface safety floor
    this.oceanSafetyCollider = this.gameWorld.physics.createGround(3000, -1.0);

    console.log(`${this.name} initialized. Ready for enemy AI testing.`);
  }

  /**
   * Builds the secondary aerial camera and orbit controls
   */
  _initAerialCamera() {
    this.aerialCamera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      3000
    );
    this.aerialCamera.position.set(0, 52, 105);
    this.aerialCamera.lookAt(0, 5, 0);

    this.orbitControls = new OrbitControls(this.aerialCamera, this.gameWorld.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.02; // Keep camera above water
    this.orbitControls.minDistance = 5;
    this.orbitControls.maxDistance = 2500;
    this.orbitControls.target.set(0, 5, 0);
    this.orbitControls.enabled = false;
  }

  /**
   * Sets the active camera mode ('PLAYER' or 'AERIAL')
   */
  setCameraMode(mode) {
    if (mode === this.cameraMode) return;
    this.cameraMode = mode;

    if (mode === 'AERIAL') {
      if (document.exitPointerLock) {
        document.exitPointerLock();
      }

      if (this.player) {
        this.player.isDevSuspended = true;
      }

      if (this.orbitControls) {
        this.orbitControls.enabled = true;
        if (this.battleship && this.battleship.mesh) {
          this.orbitControls.target.set(
            this.battleship.mesh.position.x,
            this.battleship.mesh.position.y + 4.5,
            this.battleship.mesh.position.z
          );
        }
      }

      this.gameWorld.setActiveCamera(this.aerialCamera);
      console.log('Level01TestLevel: Switched to [AERIAL ORBIT CAMERA].');
    } else {
      if (this.orbitControls) {
        this.orbitControls.enabled = false;
      }

      if (this.player) {
        this.player.isDevSuspended = false;
      }

      this.gameWorld.setActiveCamera(null);
      console.log('Level01TestLevel: Switched to [PLAYER CONTROLLER CAMERA].');
    }

    if (this.gameWorld && this.gameWorld.ui) {
      this.gameWorld.ui.updateDevToolsCamera(mode);
    }
  }

  _initDevTools() {
    if (this.gameWorld && this.gameWorld.ui) {
      this.gameWorld.ui.showDevTools({
        onSelectPlayerCamera: () => this.setCameraMode('PLAYER'),
        onSelectAerialCamera: () => this.setCameraMode('AERIAL'),
        onToggleColliders: () => {
          const isVisible = this.gameWorld.toggleColliderDebug();
          if (this.gameWorld.ui) {
            this.gameWorld.ui.updateDevToolsColliders(isVisible);
          }
        }
      });
    }

    this._onKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.code === 'Digit1') {
        this.setCameraMode('PLAYER');
      } else if (e.code === 'Digit2') {
        this.setCameraMode('AERIAL');
      } else if (e.code === 'F1' || e.code === 'KeyO') {
        e.preventDefault();
        this.setCameraMode(this.cameraMode === 'PLAYER' ? 'AERIAL' : 'PLAYER');
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  onColliderDebugToggled(visible) {
    if (this.gameWorld && this.gameWorld.ui) {
      this.gameWorld.ui.updateDevToolsColliders(visible);
    }
  }

  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    super.gameplayUpdate(delta, gameWorld);

    if (this.water) {
      this.water.update(delta);
    }

    if (this.orbitControls && this.cameraMode === 'AERIAL') {
      this.orbitControls.update();

      if (this.battleship && this.battleship.mesh) {
        this.orbitControls.target.lerp(
          new THREE.Vector3(
            this.battleship.mesh.position.x,
            this.battleship.mesh.position.y + 4.5,
            this.battleship.mesh.position.z
          ),
          0.05
        );
      }
    }

    if (this.player && this.player.position && this.player.position.y < -15 && this.battleship && this.battleship.mesh) {
      const respawnWorld = new THREE.Vector3(0.46, 6.2, -14.0);
      this.battleship.mesh.localToWorld(respawnWorld);
      this.player.teleport(respawnWorld.x, respawnWorld.y + 0.2, respawnWorld.z);
    }
  }

  dispose() {
    console.log(`Disposing ${this.name}...`);

    if (this.oceanSafetyCollider && this.gameWorld.physics) {
      this.gameWorld.physics.removeCollider(this.oceanSafetyCollider);
      this.oceanSafetyCollider = null;
    }

    if (this._onKeyDown) {
      window.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
    if (this.gameWorld && this.gameWorld.ui) {
      this.gameWorld.ui.hideDevTools();
    }
    if (this.orbitControls) {
      this.orbitControls.dispose();
      this.orbitControls = null;
    }

    this.gameWorld.setActiveCamera(null);

    if (this.gameWorld.projectilePool === this.projectilePool) {
      this.gameWorld.projectilePool = null;
    }
    this.projectilePool = null;
    this.player = null;
    this.battleship = null;

    super.dispose();
    this.water = null;
  }
}
