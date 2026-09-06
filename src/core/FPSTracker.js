/**
 * FPSTracker
 * High-precision on-screen FPS and frame time diagnostic monitor.
 * Displays real-time framerate and milliseconds per frame in the top-left HUD.
 */
export class FPSTracker {
  constructor(options = {}) {
    this.container = options.container || document.querySelector('#ui-overlay') || document.body;
    this.updateInterval = options.updateInterval || 150; // Update DOM every 150ms to prevent text jitter

    this.frameCount = 0;
    this.lastTime = performance.now();
    this.lastUpdate = performance.now();
    this.fps = 60;
    this.frameTime = 16.6;

    this.element = null;
    this.fpsValEl = null;
    this.msValEl = null;
    this.dotEl = null;

    this._createDOM();
  }

  _createDOM() {
    this.element = document.createElement('div');
    this.element.id = 'fps-tracker';
    this.element.style.cssText = `
      position: fixed;
      top: 20px;
      left: 20px;
      z-index: 10000;
      display: flex;
      align-items: center;
      gap: 9px;
      background: rgba(13, 17, 23, 0.82);
      border: 1px solid rgba(255, 255, 255, 0.14);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      border-radius: 8px;
      padding: 6px 14px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Consolas', monospace;
      font-size: 12px;
      font-weight: 600;
      color: #e6edf3;
      user-select: none;
      -webkit-user-select: none;
      pointer-events: none;
      transition: border-color 0.2s ease;
    `;

    this.element.innerHTML = `
      <span id="fps-dot" style="
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: #10b981;
        box-shadow: 0 0 8px rgba(16, 185, 129, 0.7);
        transition: background-color 0.2s ease, box-shadow 0.2s ease;
      "></span>
      <div style="display: flex; align-items: baseline; gap: 4px;">
        <span id="fps-val" style="font-size: 13px; font-weight: 700; color: #10b981; min-width: 22px; text-align: right;">60</span>
        <span style="color: #8b949e; font-size: 11px; font-weight: 500;">FPS</span>
      </div>
      <span style="color: rgba(255, 255, 255, 0.2); font-weight: 300;">|</span>
      <div style="display: flex; align-items: baseline; gap: 4px;">
        <span id="fps-ms-val" style="color: #94a3b8; font-size: 12px; min-width: 32px; text-align: right;">16.6</span>
        <span style="color: #64748b; font-size: 11px; font-weight: 500;">ms</span>
      </div>
    `;

    if (this.container) {
      this.container.appendChild(this.element);
    }

    this.fpsValEl = this.element.querySelector('#fps-val');
    this.msValEl = this.element.querySelector('#fps-ms-val');
    this.dotEl = this.element.querySelector('#fps-dot');
  }

  /**
   * Called once per frame from the game animation loop.
   */
  update() {
    const now = performance.now();
    this.frameCount++;

    const elapsedSinceLastUpdate = now - this.lastUpdate;

    if (elapsedSinceLastUpdate >= this.updateInterval) {
      // Calculate average FPS over the interval
      this.fps = Math.round((this.frameCount * 1000) / elapsedSinceLastUpdate);
      this.frameTime = parseFloat((elapsedSinceLastUpdate / this.frameCount).toFixed(1));

      this.frameCount = 0;
      this.lastUpdate = now;

      // Update DOM values
      if (this.fpsValEl) {
        this.fpsValEl.textContent = this.fps;
      }
      if (this.msValEl) {
        this.msValEl.textContent = this.frameTime.toFixed(1);
      }

      // Color coding thresholds
      if (this.fpsValEl && this.dotEl) {
        if (this.fps >= 55) {
          this.fpsValEl.style.color = '#10b981'; // Emerald Green
          this.dotEl.style.backgroundColor = '#10b981';
          this.dotEl.style.boxShadow = '0 0 8px rgba(16, 185, 129, 0.7)';
        } else if (this.fps >= 30) {
          this.fpsValEl.style.color = '#f59e0b'; // Amber
          this.dotEl.style.backgroundColor = '#f59e0b';
          this.dotEl.style.boxShadow = '0 0 8px rgba(245, 158, 11, 0.7)';
        } else {
          this.fpsValEl.style.color = '#ef4444'; // Red
          this.dotEl.style.backgroundColor = '#ef4444';
          this.dotEl.style.boxShadow = '0 0 8px rgba(239, 68, 68, 0.7)';
        }
      }
    }
  }

  /**
   * Clean up DOM element when disposing
   */
  dispose() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.fpsValEl = null;
    this.msValEl = null;
    this.dotEl = null;
  }
}
