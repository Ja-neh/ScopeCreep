import * as THREE from 'three';
import { InputManager } from './InputManager.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { FPSTracker } from './FPSTracker.js';

/**
 * GameWorld
 * Central root manager for the 3D WebGL context, scenegraph hierarchy,
 * rendering pipeline, master clock, physics world, and input subsystem.
 * Stage-agnostic: Level-specific geometry and lighting are handled by Levels.
 */
export class GameWorld {
  constructor(canvasElement) {
    this.canvas = canvasElement || document.querySelector('#game-canvas');
    if (!this.canvas) {
      throw new Error('GameWorld requires a valid canvas element.');
    }

    // 0. Physics Subsystem
    this.physics = new PhysicsWorld();

    // 1. Clock & Timing
    this.clock = new THREE.Clock();
    this.isRunning = false;
    this.animationFrameId = null;

    // 2. Core Three.js Scene & Scenegraph Hierarchy
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // Daylight skybox default
    this.scene.fog = new THREE.FogExp2(0x87ceeb, 0.0015);

    // Dedicated scenegraph organizational groups
    this.environmentGroup = new THREE.Group();
    this.environmentGroup.name = 'EnvironmentGroup';
    this.scene.add(this.environmentGroup);

    this.entitiesGroup = new THREE.Group();
    this.entitiesGroup.name = 'EntitiesGroup';
    this.scene.add(this.entitiesGroup);

    this.projectilesGroup = new THREE.Group();
    this.projectilesGroup.name = 'ProjectilesGroup';
    this.scene.add(this.projectilesGroup);

    this.effectsGroup = new THREE.Group();
    this.effectsGroup.name = 'EffectsGroup';
    this.scene.add(this.effectsGroup);

    // 3. Renderer Setup
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 4. Master Camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );
    this.camera.position.set(0, 100, 150);
    this.camera.lookAt(0, 0, 0);
    this.activeCamera = null; // When null, falls back to this.camera

    // 5. Input Subsystem
    this.input = new InputManager(window);

    // 6. Registered entities list (for per-frame updates)
    this.entities = new Set();

    // 7. LevelManager reference (optional)
    this.levelManager = null;

    // 8. Event bindings
    this._onResize = this._onResize.bind(this);
    this._loop = this._loop.bind(this);
    window.addEventListener('resize', this._onResize);

    // 9. On-Screen Performance & FPS Monitor (Top-Left HUD)
    this.fpsTracker = new FPSTracker();
  }

  /**
   * Initialize asynchronous subsystems (Rapier physics WebAssembly)
   */
  async init() {
    await this.physics.init();
    // Add Rapier physics debug line mesh to scene
    const debugMesh = this.physics.getDebugMesh();
    this.scene.add(debugMesh);
  }

  /**
   * Assign the LevelManager to this world
   */
  setLevelManager(levelManager) {
    this.levelManager = levelManager;
  }

  /**
   * Sets the active rendering camera (e.g. gun aiming camera or aerial inspection camera).
   * Pass null to restore master camera.
   */
  setActiveCamera(camera) {
    this.activeCamera = camera;
    this._onResize();
  }

  /**
   * Returns the currently active camera for rendering
   */
  getActiveCamera() {
    return this.activeCamera || this.camera;
  }

  /**
   * Add a game entity to the world
   * @param {Object} entity - Must have an optional mesh/group and optional update(dt) method
   */
  addEntity(entity) {
    this.entities.add(entity);
    if (entity.mesh) {
      this.entitiesGroup.add(entity.mesh);
    } else if (entity instanceof THREE.Object3D) {
      this.entitiesGroup.add(entity);
    }
  }

  /**
   * Remove a game entity from the world
   */
  removeEntity(entity) {
    this.entities.delete(entity);
    if (entity.mesh) {
      this.entitiesGroup.remove(entity.mesh);
    } else if (entity instanceof THREE.Object3D) {
      this.entitiesGroup.remove(entity);
    }
    if (entity.dispose && typeof entity.dispose === 'function') {
      entity.dispose();
    }
  }

  /**
   * Remove all active entities and dispose them cleanly
   */
  clearEntities() {
    for (const entity of this.entities) {
      if (entity.dispose && typeof entity.dispose === 'function') {
        entity.dispose();
      }
    }
    this.entities.clear();

    while (this.entitiesGroup.children.length > 0) {
      const child = this.entitiesGroup.children[0];
      this.entitiesGroup.remove(child);
    }
    while (this.projectilesGroup.children.length > 0) {
      const child = this.projectilesGroup.children[0];
      this.projectilesGroup.remove(child);
    }
    while (this.effectsGroup.children.length > 0) {
      const child = this.effectsGroup.children[0];
      this.effectsGroup.remove(child);
    }
  }

  /**
   * Remove all environment objects (lighting, ground, scenery)
   */
  clearEnvironment() {
    while (this.environmentGroup.children.length > 0) {
      const child = this.environmentGroup.children[0];
      this.environmentGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  }

  /**
   * Starts the game loop
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.clock.start();
    this.animationFrameId = requestAnimationFrame(this._loop);
  }

  /**
   * Pauses the game loop
   */
  stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Main simulation and render loop driven by Phased Lifecycle Pipeline:
   * Phase 1: Input & Global Hotkeys
   * Phase 2: Pre-Physics (Vehicles, Floating Platforms, Buoyancy transforms)
   * Phase 3: Physics Simulation Step (Rapier world.step)
   * Phase 4: Post-Physics (Kinematic Characters, Movement Sweeps, Platform Inheritance)
   * Phase 5: Gameplay Logic & Level Updates (Weapons, Projectiles, Health, Timers)
   * Phase 6: Late Update (Cameras, Spring-arms, Reticles, Visual Smoothing)
   * Phase 7: WebGL Render
   * Phase 8: Single-Frame Input Transition Flush
   */
  _loop() {
    if (!this.isRunning) return;
    this.animationFrameId = requestAnimationFrame(this._loop);

    const delta = Math.min(this.clock.getDelta(), 0.1);

    // =========================================================================
    // PHASE 1: INPUT & GLOBAL HOTKEYS
    // =========================================================================
    if (this.input.isActionJustPressed('toggleColliders')) {
      const isVisible = this.toggleColliderDebug();
      if (this.levelManager && this.levelManager.currentLevel && this.levelManager.currentLevel._updateCollidersBtn) {
        this.levelManager.currentLevel._updateCollidersBtn(isVisible);
      }
    }

    // =========================================================================
    // PHASE 2: PRE-PHYSICS (Vehicles, Floating Platforms, Buoyancy)
    // Kinematic platforms update their transforms BEFORE the physics step
    // =========================================================================
    for (const entity of this.entities) {
      if (entity.prePhysicsUpdate && typeof entity.prePhysicsUpdate === 'function') {
        entity.prePhysicsUpdate(delta, this);
      }
    }

    // =========================================================================
    // PHASE 3: PHYSICS SIMULATION STEP
    // Rapier advances with platforms positioned at their exact current frame
    // =========================================================================
    this.physics.step(delta);
    this.physics.updateDebug();

    // =========================================================================
    // PHASE 4: POST-PHYSICS (Characters, Kinematic Sweeps, Platform Inheritance)
    // Character sweeps resolve collisions against current platform transforms
    // =========================================================================
    for (const entity of this.entities) {
      if (entity.postPhysicsUpdate && typeof entity.postPhysicsUpdate === 'function') {
        entity.postPhysicsUpdate(delta, this);
      }
    }

    // =========================================================================
    // PHASE 5: GAMEPLAY & LEVEL LOGIC (Weapons, Projectiles, Health, Level Timers)
    // =========================================================================
    if (this.levelManager) {
      this.levelManager.update(delta);
    }
    for (const entity of this.entities) {
      if (entity.gameplayUpdate && typeof entity.gameplayUpdate === 'function') {
        entity.gameplayUpdate(delta, this);
      } else if (
        entity.update &&
        typeof entity.update === 'function' &&
        !entity.prePhysicsUpdate &&
        !entity.postPhysicsUpdate
      ) {
        // Backward-compatible fallback for entities that only define update()
        entity.update(delta, this);
      }
    }

    // =========================================================================
    // PHASE 6: LATE UPDATE (Cameras, Spring-arms, Reticles, Visual Smoothing)
    // Cameras follow actors after all physical motions and sweeps are complete
    // =========================================================================
    for (const entity of this.entities) {
      if (entity.lateUpdate && typeof entity.lateUpdate === 'function') {
        entity.lateUpdate(delta, this);
      }
    }

    // Custom external update hooks
    if (this.onUpdate) {
      this.onUpdate(delta);
    }

    // =========================================================================
    // PHASE 7: WEBGL RENDER
    // =========================================================================
    this.renderer.render(this.scene, this.getActiveCamera());

    // Update on-screen FPS & performance diagnostics
    if (this.fpsTracker) {
      this.fpsTracker.update();
    }

    // =========================================================================
    // PHASE 8: INPUT TRANSITION FLUSH
    // =========================================================================
    this.input.update();
  }

  /**
   * Toggles collider debug visibility across physics engine and entities (e.g. Battleship)
   */
  toggleColliderDebug() {
    const isNowVisible = this.physics.toggleDebug();

    // Toggle collider debug on registered entities (e.g. Battleship)
    for (const entity of this.entities) {
      if (entity && entity.setColliderDebugVisible && typeof entity.setColliderDebugVisible === 'function') {
        entity.setColliderDebugVisible(isNowVisible);
      }
    }

    this._showColliderToast(isNowVisible);
    return isNowVisible;
  }

  setColliderDebugVisible(visible) {
    this.physics.setDebugVisible(visible);
    for (const entity of this.entities) {
      if (entity && entity.setColliderDebugVisible && typeof entity.setColliderDebugVisible === 'function') {
        entity.setColliderDebugVisible(visible);
      }
    }
    this._showColliderToast(visible);
  }

  _showColliderToast(visible) {
    let toast = document.querySelector('#collider-debug-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'collider-debug-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 20px;
        padding: 10px 18px;
        border-radius: 8px;
        font-family: monospace;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.5px;
        pointer-events: none;
        z-index: 10001;
        transition: all 0.25s ease;
        box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      `;
      document.body.appendChild(toast);
    }

    if (visible) {
      toast.style.background = 'rgba(16, 185, 129, 0.92)';
      toast.style.border = '1px solid #34d399';
      toast.style.color = '#ffffff';
      toast.innerHTML = '🛡️ BATTLESHIP COLLIDERS: VISIBLE';
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    } else {
      toast.style.background = 'rgba(15, 23, 42, 0.9)';
      toast.style.border = '1px solid rgba(255, 255, 255, 0.2)';
      toast.style.color = '#94a3b8';
      toast.innerHTML = '🛡️ BATTLESHIP COLLIDERS: HIDDEN';
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    }

    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      if (toast) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
      }
    }, 2200);
  }

  /**
   * Window resize handler
   */
  _onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;

    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    if (this.activeCamera && this.activeCamera !== this.camera && this.activeCamera.isPerspectiveCamera) {
      this.activeCamera.aspect = aspect;
      this.activeCamera.updateProjectionMatrix();
    }

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  /**
   * Full cleanup of geometries, materials, listeners, and physics
   */
  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.input.dispose();

    this.clearEntities();
    this.clearEnvironment();

    if (this.levelManager) {
      this.levelManager.dispose();
    }

    this.physics.dispose();
    this.renderer.dispose();

    if (this.fpsTracker) {
      this.fpsTracker.dispose();
      this.fpsTracker = null;
    }
  }
}
