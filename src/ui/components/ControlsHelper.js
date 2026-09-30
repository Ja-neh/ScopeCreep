/**
 * ControlsHelper.js
 * On-screen keyboard and mouse controls helper card (Bottom Left HUD).
 */
export class ControlsHelper {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;

    this.element = document.createElement('div');
    this.element.className = 'ui-controls-helper';
    this.element.id = 'controls-helper';

    this.element.innerHTML = `
      • <strong>Left Click:</strong> Lock Mouse<br/>
      • <strong>Escape:</strong> Unlock Mouse<br/>
      • <strong>W, A, S, D:</strong> Walk on Deck<br/>
      • <strong>Shift:</strong> Sprint &nbsp;|&nbsp; <strong>Space:</strong> Jump<br/>
      • <strong>[E]:</strong> Mount / Dismount Station (when in ring)<br/>
      • <strong>[V] / [C]:</strong> Toggle 1st / 3rd Person View<br/>
      • <strong>[B] / [F2]:</strong> Toggle Battleship Colliders<br/>
    `;

    this.parent.appendChild(this.element);
  }

  /**
   * Hide the controls helper card
   */
  hide() {
    this.element.style.display = 'none';
  }

  /**
   * Show the controls helper card
   */
  show() {
    this.element.style.display = 'block';
  }

  /**
   * Cleanup DOM nodes
   */
  dispose() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
