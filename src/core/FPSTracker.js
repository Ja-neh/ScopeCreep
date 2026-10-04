/**
 * FPSTracker
 * High-precision on-screen FPS and frame time diagnostic calculator.
 * Computes real-time framerate and milliseconds per frame and passes
 * them to UIManager for display.
 */
export class FPSTracker {
  /**
   * @param {GameWorld|Object} [optionsOrGameWorld]
   */
  constructor(optionsOrGameWorld = {}) {
    this.gameWorld = optionsOrGameWorld?.ui ? optionsOrGameWorld : (optionsOrGameWorld?.gameWorld || null);
    this.updateInterval = optionsOrGameWorld?.updateInterval || 150; // Update UI every 150ms to prevent text jitter

    this.frameCount = 0;
    this.lastTime = performance.now();
    this.lastUpdate = performance.now();
    this.fps = 60;
    this.frameTime = 16.6;
  }

  /**
   * Called once per frame from the game animation loop.
   * @param {GameWorld} [gameWorld]
   */
  update(gameWorld = this.gameWorld) {
    const now = performance.now();
    this.frameCount++;

    const elapsedSinceLastUpdate = now - this.lastUpdate;

    if (elapsedSinceLastUpdate >= this.updateInterval) {
      this.fps = Math.round((this.frameCount * 1000) / elapsedSinceLastUpdate);
      this.frameTime = parseFloat((elapsedSinceLastUpdate / this.frameCount).toFixed(1));

      this.frameCount = 0;
      this.lastUpdate = now;

      const gw = gameWorld || this.gameWorld;
      if (gw && gw.ui) {
        gw.ui.updateFPS(this.fps, this.frameTime, gw.quality ? gw.quality.renderScale : 1);
      }
    }
  }

  /**
   * Clean up references
   */
  dispose() {
    this.gameWorld = null;
  }
}
