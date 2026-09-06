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
  }

  /**
   * Called every frame from GameWorld loop.
   * @param {number} delta - Frame delta time in seconds
   */
  update(delta) {
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
