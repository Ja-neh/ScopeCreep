/**
 * Crosshair.js
 * Renders center-screen weapon aiming reticles: mounted turret stations (Artillery & Flak)
 * and the infantry rifle, whose ticks spread with weapon accuracy and flash on hits.
 */
export class Crosshair {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;

    this.element = document.createElement('div');
    this.element.className = 'ui-crosshair';
    this.element.id = 'station-crosshair';

    this.parent.appendChild(this.element);

    this.type = null;
    this._spreadPx = -1;
    this._hitTimeout = null;
  }

  /**
   * Display a specific crosshair variant.
   * @param {'artillery'|'flak'|'rifle'|string} type
   */
  show(type = 'artillery') {
    this.type = type;
    this._spreadPx = -1;
    if (type === 'rifle') {
      this.element.innerHTML = `
        <div class="ui-crosshair-rifle">
          <span class="ui-crosshair-tick tick-top"></span>
          <span class="ui-crosshair-tick tick-bottom"></span>
          <span class="ui-crosshair-tick tick-left"></span>
          <span class="ui-crosshair-tick tick-right"></span>
          <span class="ui-crosshair-dot"></span>
        </div>
      `;
    } else if (type === 'artillery') {
      this.element.innerHTML = `
        <div style="
          position: relative;
          width: 38px;
          height: 38px;
          border: 2px solid rgba(231, 111, 81, 0.9);
          border-radius: 50%;
          box-shadow: 0 0 12px rgba(231, 111, 81, 0.6);
        ">
          <div style="position: absolute; top: 17px; left: -12px; width: 10px; height: 2px; background: #e76f51;"></div>
          <div style="position: absolute; top: 17px; right: -12px; width: 10px; height: 2px; background: #e76f51;"></div>
          <div style="position: absolute; top: -12px; left: 17px; width: 2px; height: 10px; background: #e76f51;"></div>
          <div style="position: absolute; bottom: -12px; left: 17px; width: 2px; height: 10px; background: #e76f51;"></div>
        </div>
      `;
    } else if (type === 'flak') {
      this.element.innerHTML = `
        <div style="
          position: relative;
          width: 48px;
          height: 48px;
          border: 2px dashed rgba(244, 162, 97, 0.9);
          border-radius: 50%;
          box-shadow: 0 0 14px rgba(244, 162, 97, 0.5);
        ">
          <div style="position: absolute; top: 22px; left: 22px; width: 4px; height: 4px; background: #f4a261; border-radius: 50%;"></div>
          <div style="position: absolute; top: 23px; left: -14px; width: 12px; height: 2px; background: #f4a261;"></div>
          <div style="position: absolute; top: 23px; right: -14px; width: 12px; height: 2px; background: #f4a261;"></div>
          <div style="position: absolute; top: -14px; left: 23px; width: 2px; height: 12px; background: #f4a261;"></div>
          <div style="position: absolute; bottom: -14px; left: 23px; width: 2px; height: 12px; background: #f4a261;"></div>
        </div>
      `;
    }

    this.element.style.display = 'block';
  }

  /**
   * Rifle only: spreads the ticks to match the weapon's current cone.
   * @param {number} spreadRadians - Cone half-angle
   * @param {number} fovDegrees - Camera vertical field of view
   */
  setSpread(spreadRadians, fovDegrees) {
    if (this.type !== 'rifle') return;
    const halfHeight = window.innerHeight / 2;
    const px = Math.round(Math.min(80, Math.max(4, (Math.tan(spreadRadians) / Math.tan((fovDegrees * Math.PI) / 360)) * halfHeight)));
    if (px === this._spreadPx) return;
    this._spreadPx = px;
    this.element.style.setProperty('--spread', `${px}px`);
  }

  /**
   * Briefly marks a hit (white) or a kill (red).
   * @param {boolean} [kill=false]
   */
  flashHit(kill = false) {
    if (this._hitTimeout) clearTimeout(this._hitTimeout);
    this.element.classList.remove('hit', 'kill');
    this.element.classList.add(kill ? 'kill' : 'hit');
    this._hitTimeout = setTimeout(() => {
      this.element.classList.remove('hit', 'kill');
      this._hitTimeout = null;
    }, kill ? 260 : 120);
  }

  /**
   * Hide the crosshair.
   */
  hide() {
    this.element.style.display = 'none';
  }

  /**
   * Cleanup DOM nodes.
   */
  dispose() {
    if (this._hitTimeout) {
      clearTimeout(this._hitTimeout);
      this._hitTimeout = null;
    }
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}
