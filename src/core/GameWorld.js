import * as THREE from 'three';
import { InputManager } from './InputManager.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { FPSTracker } from './FPSTracker.js';
import { RenderQuality } from './RenderQuality.js';
import { AudioManager } from './AudioManager.js';
import { MusicDirector } from './MusicDirector.js';
import { UIManager } from '../ui/UIManager.js';
import { PostStack } from '../rendering/PostStack.js';

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
    this.scene.background = new THREE.Color(0x87ceeb);
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

    // 3. Renderer Setup. Antialiasing only when a real GPU draws (in software it is very costly).
    const gpu = RenderQuality.probe();
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: !gpu.software,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Graphics settings (resolution, shadows): the player's choice, with a recommendation for this computer
    this.quality = new RenderQuality(this.renderer, this.scene, { software: gpu.software, gpuName: gpu.renderer });

    // The image pipeline: the frame renders through the post stack (bloom, tone mapping, grade).
    // Software rasterizers skip it - they are slow enough as they are.
    this.postStack = gpu.software ? null : new PostStack(this.renderer);

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
    this.input = new InputManager();

    // 6. Registered entities list (for per-frame updates)
    this.entities = new Set();

    // 7. Decal marks for the physics juice (created per level, see BaseLevel.init)
    this.decals = null;

    // 8. Active level lifecycle tracking
    this.currentLevel = null;
    this.isLevelLoading = false;
    this.isPaused = false;
    this._onMainMenuRequested = null;

    // 9. Event bindings
    this._onResize = this._onResize.bind(this);
    this._loop = this._loop.bind(this);
    window.addEventListener('resize', this._onResize);

    // 10. UI Subsystem (HUD, prompts, health bars, overlays)
    this.ui = new UIManager();

    // 11. On-Screen Performance & FPS Monitor (Top-Left HUD)
    this.fpsTracker = new FPSTracker(this);

    // 12. Audio Subsystem (procedural one-shot sound engine, event-driven: no phase hook)
    this.audio = new AudioManager(this);

    // ...and its companion score: adaptive music and ambience, driven by each level's own states.
    // The score can only start once a gesture has created the AudioContext (autoplay policy);
    // the state it remembers by then - the menu theme at boot - is what fades in first.
    this.music = new MusicDirector(this.audio);
    this.audio.onUnlocked = () => {
      if (!this.music) return;
      this.music.refresh(); // The remembered state (the menu theme) starts and fades in...
      this.music.stinger('impact'); // ...under the game-start trailer impact
    };

    // Without a GPU everything is drawn on the CPU: say so, it explains a slow game
    if (gpu.software) {
      console.warn(`[GameWorld] Software WebGL renderer (${gpu.renderer}): starting with low graphics settings.`);
      this.ui.showToast('Your graphics card is not being used (software rendering), so the game will be slow. ' +
        'Turn on hardware acceleration in the browser and check the GPU is enabled in Windows Device Manager. ' +
        'Until then, low graphics settings are recommended: change them under Options (Esc).', 'warning', 15000);
    }
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
   * Registers a callback invoked when the user returns to the main menu.
   * @param {Function} callback
   */
  setMainMenuHandler(callback) {
    this._onMainMenuRequested = callback;
  }

  /**
   * Loads and initializes a new level stage.
   * Tears down any previously active level and frees GPU and physics resources.
   * @param {BaseLevel} newLevel - Instance of a class extending BaseLevel
   */
  async loadLevel(newLevel) {
    if (this.isLevelLoading) return;
    this.isLevelLoading = true;

    // 1. Tear down previous level
    if (this.currentLevel) {
      console.log(`Tearing down previous stage: ${this.currentLevel.name}`);
      this.currentLevel.dispose();
      this.clearEntities();
      this.clearEnvironment();
      this.currentLevel = null;
    }

    // 2. Set and initialize new level
    this.currentLevel = newLevel;
    try {
      if (this.currentLevel) {
        await this.currentLevel.init();
        console.log(`Successfully loaded stage: ${this.currentLevel.name}`);

        this.isPaused = false;
        if (this.ui) {
          this.ui.showPauseButton(() => this.togglePause());
          const controls = this.currentLevel.controls;
          this.ui.showControlsHelper(controls ? controls.map(({ actions, label }) => ({ keys: this.input.describeActions(actions), label })) : null);
        }
      }
    } catch (error) {
      console.error(`Failed to initialize level:`, error);
    } finally {
      this.isLevelLoading = false;
    }
  }

  /**
   * Restarts the currently active level from scratch without refreshing the page.
   */
  async restartCurrentLevel() {
    if (!this.currentLevel) return;
    const LevelConstructor = this.currentLevel.constructor;
    console.log(`Restarting stage: ${this.currentLevel.name}...`);
    this.resume();
    await this.loadLevel(new LevelConstructor(this));
  }

  /**
   * Pause the game simulation and display the options/pause menu.
   */
  pause() {
    if (this.isPaused || !this.currentLevel || this.isLevelLoading) return;
    this.isPaused = true;
    this.input.exitPointerLock();

    if (this.ui) {
      this.ui.hideMap(); // The map and the pause menu never stack
      this.ui.showPauseMenu({
        onResume: () => this.resume(),
        onRestart: () => this.restartCurrentLevel(),
        onReturnToMenu: () => this.returnToMainMenu(),
        graphics: this.quality
      });
    }
  }

  /**
   * Resume the game simulation and dismiss the pause menu.
   */
  resume() {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.clock.getDelta(); // Clear time delta accumulation during pause
    this.quality.resetTiming(); // ...and the paused time is not one long frame

    if (this.ui) {
      this.ui.hidePauseMenu();
    }
  }

  /**
   * Toggles pause state if inside an active level
   */
  togglePause() {
    if (!this.currentLevel) return;
    if (this.isPaused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  /**
   * Opens or closes the island map ([M]). The chart comes from the level's own terrain sampler
   * (`getMapTerrain`); the cursor is freed while it is open so clicks never fire the weapons,
   * and the pointer locks again on close so looking and shooting resume in place.
   */
  toggleMap() {
    if (!this.currentLevel || this.isLevelLoading || this.isPaused) return;
    const player = this.currentLevel.player;
    if (player && player.isDevSuspended) return; // Cinematics and the downed state own the screen
    if (!this.ui) return;

    if (this.ui.isMapOpen) {
      this.ui.hideMap();
      this.input.requestPointerLock(this.canvas);
    } else {
      this.ui.showMap(this.currentLevel.getMapTerrain());
      this.input.exitPointerLock();
    }
  }

  /**
   * Tears down active level and navigates back to the main menu screen
   */
  returnToMainMenu() {
    this.resume();

    if (this.currentLevel) {
      this.currentLevel.dispose();
      this.clearEntities();
      this.clearEnvironment();
      this.currentLevel = null;
    }

    this.setActiveCamera(null);

    if (this.ui) {
      this.ui.resetLevelHUD();
    }

    if (this._onMainMenuRequested) {
      this._onMainMenuRequested();
    }
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
   * Draws one frame through the post stack when there is one (bloom and the
   * tone mapping / grade tail), straight onto the canvas otherwise.
   */
  _renderFrame() {
    const camera = this.getActiveCamera();
    if (this.postStack) {
      this.postStack.render(this.scene, camera);
    } else {
      this.renderer.render(this.scene, camera);
    }
  }

  /**
   * Add a game entity to the world
   * @param {Object} entity - Entity implementing phased lifecycle methods (prePhysicsUpdate, postPhysicsUpdate, gameplayUpdate, lateUpdate)
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
    if (this.input.isActionJustPressed('pause')) {
      this.togglePause();
    }
    if (this.input.isActionJustPressed('toggleMap')) {
      this.toggleMap();
    }
    if (this.input.isActionJustPressed('toggleColliders')) {
      this.toggleColliderDebug();
    }

    // When paused, render the frozen scene and flush inputs without advancing physics or gameplay
    if (this.isPaused) {
      this._renderFrame();
      if (this.fpsTracker) {
        this.fpsTracker.update(this);
      }
      this.input.update();
      return;
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
    if (this.currentLevel && this.currentLevel.isInitialized && !this.isLevelLoading) {
      if (this.currentLevel.gameplayUpdate && typeof this.currentLevel.gameplayUpdate === 'function') {
        this.currentLevel.gameplayUpdate(delta, this);
      }
    }
    for (const entity of this.entities) {
      if (entity.gameplayUpdate && typeof entity.gameplayUpdate === 'function') {
        entity.gameplayUpdate(delta, this);
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

    // =========================================================================
    // PHASE 7: WEBGL RENDER
    // =========================================================================
    this._renderFrame();
    if (this.currentLevel && !this.isLevelLoading) this.quality.update(); // Measures gameplay frames only

    // Update on-screen FPS & performance diagnostics
    if (this.fpsTracker) {
      this.fpsTracker.update(this);
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
    const isNowVisible = !this.physics.debugMesh.visible;
    this.setColliderDebugVisible(isNowVisible);
    return isNowVisible;
  }

  setColliderDebugVisible(visible) {
    this.physics.setDebugVisible(visible);
    for (const entity of this.entities) {
      if (entity && entity.setColliderDebugVisible && typeof entity.setColliderDebugVisible === 'function') {
        entity.setColliderDebugVisible(visible);
      }
    }

    if (this.currentLevel && typeof this.currentLevel.onColliderDebugToggled === 'function') {
      this.currentLevel.onColliderDebugToggled(visible);
    }

    if (this.ui) {
      this.ui.showToast(visible ? '🛡️ COLLIDERS: VISIBLE' : '🛡️ COLLIDERS: HIDDEN', visible ? 'success' : 'info', 2200);
    }
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
    this.quality.onResize();
  }

  /**
   * Full cleanup of geometries, materials, listeners, physics, and DOM elements
   */
  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.input.dispose();

    if (this.music) {
      this.music.dispose();
      this.music = null;
    }

    if (this.audio) {
      this.audio.dispose();
      this.audio = null;
    }

    this.clearEntities();
    this.clearEnvironment();

    if (this.currentLevel) {
      this.currentLevel.dispose();
      this.currentLevel = null;
    }

    this.physics.dispose();

    if (this.postStack) {
      this.postStack.dispose();
      this.postStack = null;
    }

    this.renderer.dispose();

    if (this.fpsTracker) {
      this.fpsTracker.dispose();
      this.fpsTracker = null;
    }

    if (this.ui) {
      this.ui.dispose();
      this.ui = null;
    }
  }
}
