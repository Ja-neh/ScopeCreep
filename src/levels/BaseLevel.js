import { Decals } from '../rendering/Decals.js';

/**
 * BaseLevel
 * Base class defining the lifecycle for all game stages/levels.
 */
export class BaseLevel {
  constructor(gameWorld, name = 'BaseLevel') {
    this.gameWorld = gameWorld;
    this.name = name;
    this.isInitialized = false;

    // Track objects created specifically by this level for easy cleanup
    this.disposables = [];
  }

  /**
   * Called when the level is loaded.
   * Setup meshes, lighting, shaders, physics, and entities.
   */
  async init() {
    this.isInitialized = true;

    // Bullet holes and scorch marks: one pooled decal entity for the whole stage
    this.decals = new Decals(this.gameWorld);
    this.gameWorld.addEntity(this.decals);
    this.gameWorld.decals = this.decals;

    // Every level opens dramatically: the intro groove under the deploy swell (an opening cinematic ends it into the ambience)
    const music = this.gameWorld && this.gameWorld.music;
    if (music) {
      music.setState('deploy');
      music.stinger('deploy');
    }
  }

  /**
   * Phase 5 (Gameplay): Called every frame from GameWorld loop.
   * @param {number} delta - Frame delta time in seconds
   * @param {GameWorld} gameWorld - Master world context
   */
  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    // Override in subclass
  }

  /**
   * Controls shown on the controls card while this level runs: [{ actions: ['crouch'], label: 'Crouch' }].
   * Keys are looked up from the InputManager bindings. null shows the default (Level 1) card.
   * @returns {Array<{actions: string[], label: string}>|null}
   */
  get controls() {
    return null;
  }

  /**
   * Optional callback invoked when collider debug visualization is toggled.
   * @param {boolean} visible
   */
  onColliderDebugToggled(visible) {
    // Override in subclass
  }

  /**
   * Helper to register a Three.js object/resource for automatic disposal
   */
  trackDisposable(resource) {
    this.disposables.push(resource);
    return resource;
  }

  /**
   * Clean up all level resources, geometries, materials, and listeners.
   */
  dispose() {
    this.isInitialized = false;

    // The decal entity itself is disposed by GameWorld.clearEntities()
    if (this.gameWorld && this.gameWorld.decals === this.decals) {
      this.gameWorld.decals = null;
    }
    this.decals = null;

    for (const item of this.disposables) {
      if (item.geometry) {
        item.geometry.dispose();
      }
      if (item.material) {
        if (Array.isArray(item.material)) {
          item.material.forEach((m) => m.dispose());
        } else {
          item.material.dispose();
        }
      }
      if (item.parent) {
        item.parent.remove(item);
      }
      if (item.dispose && typeof item.dispose === 'function' && item !== this) {
        item.dispose();
      }
    }
    this.disposables = [];
  }
}
