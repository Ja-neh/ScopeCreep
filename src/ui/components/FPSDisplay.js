/**
 * FPSDisplay.js
 * On-screen framerate and frame-time diagnostics display (Top Left HUD).
 */
export class FPSDisplay {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;

    this.element = document.createElement('div');
    this.element.className = 'ui-fps-display';
    this.element.id = 'fps-tracker';

    this.element.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
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
      </div>
    `;

    this.dotEl = this.element.querySelector('#fps-dot');
    this.fpsValEl = this.element.querySelector('#fps-val');
    this.msValEl = this.element.querySelector('#fps-ms-val');

    this.parent.appendChild(this.element);
  }

  /**
   * Update FPS display values and health color
   * @param {number} fps
   * @param {number} frameTime
   */
  update(fps, frameTime) {
    if (this.fpsValEl) {
      this.fpsValEl.textContent = fps;
    }
    if (this.msValEl) {
      this.msValEl.textContent = frameTime.toFixed(1);
    }

    if (this.fpsValEl && this.dotEl) {
      if (fps >= 55) {
        this.fpsValEl.style.color = '#10b981';
        this.dotEl.style.backgroundColor = '#10b981';
        this.dotEl.style.boxShadow = '0 0 8px rgba(16, 185, 129, 0.7)';
      } else if (fps >= 30) {
        this.fpsValEl.style.color = '#f59e0b';
        this.dotEl.style.backgroundColor = '#f59e0b';
        this.dotEl.style.boxShadow = '0 0 8px rgba(245, 158, 11, 0.7)';
      } else {
        this.fpsValEl.style.color = '#ef4444';
        this.dotEl.style.backgroundColor = '#ef4444';
        this.dotEl.style.boxShadow = '0 0 8px rgba(239, 68, 68, 0.7)';
      }
    }
  }

  /**
   * Cleanup DOM nodes
   */
  dispose() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.dotEl = null;
    this.fpsValEl = null;
    this.msValEl = null;
  }
}
