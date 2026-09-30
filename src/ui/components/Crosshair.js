/**
 * Crosshair.js
 * Renders center-screen weapon aiming reticles for mounted turret stations (Artillery & Flak).
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
  }

  /**
   * Display a specific crosshair variant.
   * @param {'artillery'|'flak'|string} type
   */
  show(type = 'artillery') {
    if (type === 'artillery') {
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
   * Hide the crosshair.
   */
  hide() {
    this.element.style.display = 'none';
  }

  /**
   * Cleanup DOM nodes.
   */
  dispose() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}
