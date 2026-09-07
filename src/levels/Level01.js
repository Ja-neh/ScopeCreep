import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BaseLevel } from './BaseLevel.js';
import { Ocean } from '../rendering/Ocean.js';
import { Battleship } from '../entities/Battleship.js';
import { Player } from '../entities/Player.js';
import { ProjectilePool } from '../entities/projectiles/ProjectilePool.js';

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
    this.devToolsEl = null;
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
    this.gameWorld.addEntity(this.battleship);
    this.battleship.initPhysics(this.gameWorld.physics);

    // 5. Spawn Player Character Controller on the Battleship Walking Deck
    this.player = new Player(this.gameWorld, {
      walkSpeed: 8.0,
      sprintSpeed: 14.0,
      jumpForce: 10.0
    });
    // Position player on forward deck between bridge and main gun
    this.player.setPosition(0, 5.0, -15);
    this.player.yaw = 0;
    this.gameWorld.addEntity(this.player);

    // 6. Initialize Aerial Inspection Camera & OrbitControls
    this._initAerialCamera();

    // 7. Initialize Dev Tools UI Overlay & Keybinds
    this._initDevTools();

    // 8. Ocean surface safety floor (catches players falling overboard so they don't fall into the void)
    const oceanSafetyColliderDesc = this.gameWorld.physics.RAPIER.ColliderDesc.cuboid(1500, 0.5, 1500)
      .setTranslation(0, -1.0, 0);
    const oceanSafetyBody = this.gameWorld.physics.world.createRigidBody(
      this.gameWorld.physics.RAPIER.RigidBodyDesc.fixed()
    );
    this.oceanSafetyCollider = this.gameWorld.physics.world.createCollider(oceanSafetyColliderDesc, oceanSafetyBody);

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

    const btnPlayer = document.querySelector('#dev-btn-player');
    const btnAerial = document.querySelector('#dev-btn-aerial');

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

      // Update UI button highlights
      if (btnPlayer) {
        btnPlayer.style.background = 'rgba(255, 255, 255, 0.08)';
        btnPlayer.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        btnPlayer.style.color = '#94a3b8';
      }
      if (btnAerial) {
        btnAerial.style.background = '#0284c7';
        btnAerial.style.borderColor = '#38bdf8';
        btnAerial.style.color = '#ffffff';
      }

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

      // Update UI button highlights
      if (btnPlayer) {
        btnPlayer.style.background = '#0d9488';
        btnPlayer.style.borderColor = '#2dd4bf';
        btnPlayer.style.color = '#ffffff';
      }
      if (btnAerial) {
        btnAerial.style.background = 'rgba(255, 255, 255, 0.08)';
        btnAerial.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        btnAerial.style.color = '#94a3b8';
      }

      console.log('Level1 DevTools: Switched to [PLAYER CONTROLLER CAMERA].');
    }
  }

  /**
   * Creates the on-screen Dev Tools widget and attaches hotkey listeners
   */
  _initDevTools() {
    this.devToolsEl = document.createElement('div');
    this.devToolsEl.id = 'level1-dev-tools';
    this.devToolsEl.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.16);
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      border-radius: 10px;
      padding: 12px 16px;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      z-index: 10000;
      user-select: none;
      min-width: 220px;
    `;

    this.devToolsEl.innerHTML = `
      <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.8px; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px;">
        🛠️ Dev Camera Tools
      </div>
      <div style="display: flex; gap: 8px; margin-bottom: 8px;">
        <button id="dev-btn-player" style="
          flex: 1;
          background: #0d9488;
          color: #ffffff;
          border: 1px solid #2dd4bf;
          border-radius: 6px;
          padding: 7px 10px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        ">
          🏃 Player [1]
        </button>
        <button id="dev-btn-aerial" style="
          flex: 1;
          background: rgba(255, 255, 255, 0.08);
          color: #94a3b8;
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 6px;
          padding: 7px 10px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        ">
          🛸 Aerial [2]
        </button>
      </div>
      <div style="margin-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 8px;">
        <button id="dev-btn-colliders" style="
          width: 100%;
          background: rgba(255, 255, 255, 0.08);
          color: #94a3b8;
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 6px;
          padding: 7px 10px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        ">
          🛡️ Colliders: OFF [B]
        </button>
      </div>
      <div style="font-size: 11px; color: #64748b; line-height: 1.4; margin-top: 6px;">
        Cameras: <strong>[1]</strong> / <strong>[2]</strong> &nbsp;|&nbsp; Colliders: <strong>[B]</strong> / <strong>[F2]</strong>
      </div>
    `;

    document.body.appendChild(this.devToolsEl);

    // Button click listeners
    const btnPlayer = this.devToolsEl.querySelector('#dev-btn-player');
    const btnAerial = this.devToolsEl.querySelector('#dev-btn-aerial');
    const btnColliders = this.devToolsEl.querySelector('#dev-btn-colliders');

    btnPlayer.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setCameraMode('PLAYER');
    });

    btnAerial.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setCameraMode('AERIAL');
    });

    if (btnColliders) {
      btnColliders.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = this.gameWorld.toggleColliderDebug();
        this._updateCollidersBtn(isVisible);
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

  _updateCollidersBtn(visible) {
    const btn = this.devToolsEl ? this.devToolsEl.querySelector('#dev-btn-colliders') : null;
    if (!btn) return;
    if (visible) {
      btn.style.background = '#059669';
      btn.style.borderColor = '#34d399';
      btn.style.color = '#ffffff';
      btn.innerHTML = '🛡️ Colliders: ON [B]';
    } else {
      btn.style.background = 'rgba(255, 255, 255, 0.08)';
      btn.style.borderColor = 'rgba(255, 255, 255, 0.15)';
      btn.style.color = '#94a3b8';
      btn.innerHTML = '🛡️ Colliders: OFF [B]';
    }
  }

  update(delta) {
    super.update(delta);

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

    // 3. Void fall recovery: respawn player back to forward deck if fallen below -15m
    if (this.player && this.player.position && this.player.position.y < -15 && this.battleship && this.battleship.mesh) {
      const respawnWorld = new THREE.Vector3(0, 5.0, -15);
      this.battleship.mesh.localToWorld(respawnWorld);
      this.player.teleport(respawnWorld.x, respawnWorld.y + 0.2, respawnWorld.z);
    }
  }

  dispose() {
    console.log(`Disposing ${this.name}...`);

    // Teardown ocean safety collider
    if (this.oceanSafetyCollider && this.gameWorld.physics && this.gameWorld.physics.world) {
      this.gameWorld.physics.world.removeCollider(this.oceanSafetyCollider);
      this.oceanSafetyCollider = null;
    }

    // Teardown Dev Tools UI & listeners
    if (this._onKeyDown) {
      window.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
    if (this.devToolsEl && this.devToolsEl.parentNode) {
      this.devToolsEl.parentNode.removeChild(this.devToolsEl);
      this.devToolsEl = null;
    }
    if (this.orbitControls) {
      this.orbitControls.dispose();
      this.orbitControls = null;
    }

    // Restore master camera
    this.gameWorld.setActiveCamera(null);

    if (this.projectilePool) {
      this.gameWorld.removeEntity(this.projectilePool);
      this.projectilePool.dispose();
      this.projectilePool = null;
      if (this.gameWorld.projectilePool === this.projectilePool) {
        this.gameWorld.projectilePool = null;
      }
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
    this.water = null;
  }
}

export { Level01 as Level1 };
