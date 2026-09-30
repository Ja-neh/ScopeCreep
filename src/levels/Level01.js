import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BaseLevel } from './BaseLevel.js';
import { Ocean } from '../rendering/Ocean.js';
import { Battleship } from '../entities/Battleship.js';
import { Player } from '../entities/Player.js';
import { ProjectilePool } from '../entities/ProjectilePool.js';

/**
 * Level01
 * Act 1: Operation Retake - At Sea
 * Features:
 * - Custom GPU Gerstner Ocean Shader
 * - Floating battleship with wave buoyancy & kinematic physics
 * - Human player avatar walking on deck
 * - Interactive gun turrets (ArtilleryTurret & FlakTurret)
 * - Built-in Dev Tools to toggle between Player and Aerial Orbit Camera
 */
export class Level01 extends BaseLevel {
  constructor(gameWorld) {
    super(gameWorld, 'Level 1: Operation Retake (At Sea)');
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

    // 8. Ocean surface safety floor (catches players falling overboard so they don't fall into the void)
    this.oceanSafetyCollider = this.gameWorld.physics.createGround(3000, -1.0);

    console.log(`${this.name} initialized with Battleship, Deck Player, and Dev Camera Tools.`);
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
    this.orbitControls.enabled = false; // Disabled by default in player mode
  }

  /**
   * Sets the active camera mode ('PLAYER' or 'AERIAL')
   */
  setCameraMode(mode) {
    if (mode === this.cameraMode) return;
    this.cameraMode = mode;

    if (mode === 'AERIAL') {
      // Exit pointer lock for smooth orbit mouse interaction
      if (document.exitPointerLock) {
        document.exitPointerLock();
      }

      // Suspend player controller input and updates
      if (this.player) {
        this.player.isDevSuspended = true;
      }

      // Enable OrbitControls and target the battleship
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

      // Switch rendering to Aerial camera
      this.gameWorld.setActiveCamera(this.aerialCamera);
      console.log('Level1 DevTools: Switched to [AERIAL ORBIT CAMERA].');
    } else {
      // Return to PLAYER mode
      if (this.orbitControls) {
        this.orbitControls.enabled = false;
      }

      if (this.player) {
        this.player.isDevSuspended = false;
      }

      // Restore active camera to null (master player camera)
      this.gameWorld.setActiveCamera(null);
      console.log('Level1 DevTools: Switched to [PLAYER CONTROLLER CAMERA].');
    }

    if (this.gameWorld && this.gameWorld.ui) {
      this.gameWorld.ui.updateDevToolsCamera(mode);
    }
  }

  /**
   * Creates the on-screen Dev Tools widget and attaches hotkey listeners
   */
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

    // Keyboard shortcuts listener for Level 1 camera modes: 'Digit1', 'Digit2', 'F1', 'KeyO'
    this._onKeyDown = (e) => {
      // Don't trigger if typing in an input
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

    // 1. Animate the custom ocean wave displacement
    if (this.water) {
      this.water.update(delta);
    }

    // 2. Update aerial orbit controls when in AERIAL mode
    if (this.orbitControls && this.cameraMode === 'AERIAL') {
      this.orbitControls.update();

      // Smoothly follow battleship position while floating
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

    // 3. Void fall recovery: respawn player back to forward walking deck if fallen below -15m
    if (this.player && this.player.position && this.player.position.y < -15 && this.battleship && this.battleship.mesh) {
      const respawnWorld = new THREE.Vector3(0.46, 6.2, -14.0);
      this.battleship.mesh.localToWorld(respawnWorld);
      this.player.teleport(respawnWorld.x, respawnWorld.y + 0.2, respawnWorld.z);
    }
  }

  dispose() {
    console.log(`Disposing ${this.name}...`);

    // Teardown ocean safety collider
    if (this.oceanSafetyCollider && this.gameWorld.physics) {
      this.gameWorld.physics.removeCollider(this.oceanSafetyCollider);
      this.oceanSafetyCollider = null;
    }

    // Teardown Dev Tools UI & listeners
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

    // Restore master camera
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
