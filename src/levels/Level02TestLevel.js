import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BaseLevel } from './BaseLevel.js';
import { BeachEnvironment } from './level02/BeachEnvironment.js';
import { Player } from '../entities/Player.js';

/**
 * Level02TestLevel
 * Sandbox for Level 2 (The Beach). Level 2 features are proven here before they are
 * promoted into Level02. Features:
 * - Island terrain with a matching heightfield collider, calm sea and dusk lighting
 * - Player spawned on the landing beach
 * - Aerial orbit camera for inspecting the island ([F1] or the dev tools panel)
 */
export class Level02TestLevel extends BaseLevel {
  constructor(gameWorld) {
    super(gameWorld, 'Level 2: Beach Test Level');
    this.environment = null;
    this.player = null;

    // Dev Tools Camera System
    this.cameraMode = 'PLAYER'; // 'PLAYER' | 'AERIAL'
    this.aerialCamera = null;
    this.orbitControls = null;
    this._terrainChecked = false;
  }

  async init() {
    await super.init();

    // 1. Island, sea, sky and lighting
    this.environment = this.trackDisposable(new BeachEnvironment(this.gameWorld));
    this.environment.build();

    // 2. Player on the landing beach, facing inland (-Z)
    const spawn = this.environment.spawnPoints.beach;
    this.player = new Player(this.gameWorld);
    this.player.setPosition(spawn.x, spawn.y, spawn.z);
    this.player.yaw = 0;
    this.gameWorld.addEntity(this.player);

    // 3. Dev tools: aerial camera and collider toggle
    this._initAerialCamera();
    this._initDevTools();

    console.log(`${this.name} initialized.`);
  }

  _initAerialCamera() {
    this.aerialCamera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      3000
    );
    this.aerialCamera.position.set(0, 180, 420);

    this.orbitControls = new OrbitControls(this.aerialCamera, this.gameWorld.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.orbitControls.minDistance = 5;
    this.orbitControls.maxDistance = 1500;
    this.orbitControls.target.set(0, 5, 120);
    this.orbitControls.enabled = false;
  }

  _initDevTools() {
    if (!this.gameWorld.ui) return;
    this.gameWorld.ui.showDevTools({
      onSelectPlayerCamera: () => this.setCameraMode('PLAYER'),
      onSelectAerialCamera: () => this.setCameraMode('AERIAL'),
      onToggleColliders: () => {
        const isVisible = this.gameWorld.toggleColliderDebug();
        this.gameWorld.ui.updateDevToolsColliders(isVisible);
      }
    });
  }

  /**
   * Sets the active camera mode ('PLAYER' or 'AERIAL')
   */
  setCameraMode(mode) {
    if (mode === this.cameraMode) return;
    this.cameraMode = mode;

    if (mode === 'AERIAL') {
      this.gameWorld.input.exitPointerLock();
      this.player.isDevSuspended = true;
      this.orbitControls.enabled = true;
      this.gameWorld.setActiveCamera(this.aerialCamera);
    } else {
      this.orbitControls.enabled = false;
      this.player.isDevSuspended = false;
      this.gameWorld.setActiveCamera(null);
    }

    if (this.gameWorld.ui) {
      this.gameWorld.ui.updateDevToolsCamera(mode);
    }
  }

  onColliderDebugToggled(visible) {
    if (this.gameWorld.ui) {
      this.gameWorld.ui.updateDevToolsColliders(visible);
    }
  }

  /**
   * Dev check, run once after the first physics step: rays cast straight down must hit the
   * collider at the height the mesh shows. A mismatch means the heightfield samples are misordered.
   */
  _verifyTerrainCollider() {
    const physics = this.gameWorld.physics;
    const startY = 200;
    const ray = new physics.RAPIER.Ray({ x: 0, y: startY, z: 0 }, { x: 0, y: -1, z: 0 });
    const samples = [[0, 150], [-60, 120], [80, 100], [-120, -40], [35, 60], [150, -90]];

    let worstError = 0;
    for (const [x, z] of samples) {
      ray.origin.x = x;
      ray.origin.z = z;
      const hit = physics.castRay(ray, 400, true, undefined, undefined, this.player.collider);
      const error = hit ? Math.abs((startY - hit.timeOfImpact) - this.environment.heightAt(x, z)) : Infinity;
      worstError = Math.max(worstError, error);
    }

    if (worstError < 0.05) {
      console.log(`[Level02TestLevel] Terrain collider matches the mesh (worst error ${worstError.toFixed(3)} m).`);
    } else {
      console.warn(`[Level02TestLevel] Terrain collider does NOT match the mesh (worst error ${worstError.toFixed(2)} m).`);
    }
  }

  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    super.gameplayUpdate(delta, gameWorld);

    this.environment.update(delta);

    if (!this._terrainChecked) {
      this._terrainChecked = true;
      this._verifyTerrainCollider();
    }

    if (gameWorld.input.isActionJustPressed('devCamera')) {
      this.setCameraMode(this.cameraMode === 'PLAYER' ? 'AERIAL' : 'PLAYER');
    }
    if (this.cameraMode === 'AERIAL') {
      this.orbitControls.update();
    }

    // Fall recovery: back to the beach if the player ever drops through the world
    if (this.player.position.y < -20) {
      const spawn = this.environment.spawnPoints.beach;
      this.player.teleport(spawn.x, spawn.y, spawn.z);
    }
  }

  dispose() {
    console.log(`Disposing ${this.name}...`);

    if (this.gameWorld.ui) {
      this.gameWorld.ui.hideDevTools();
    }
    if (this.orbitControls) {
      this.orbitControls.dispose();
      this.orbitControls = null;
    }
    this.gameWorld.setActiveCamera(null);

    this.player = null;
    super.dispose();
    this.environment = null;
  }
}
