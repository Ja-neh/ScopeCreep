/**
 * PauseButton.js
 * In-game top-right HUD button allowing the player to pause and open the options menu.
 */
export class PauseButton {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;

    this.element = document.createElement('button');
    this.element.className = 'ui-pause-button ui-hidden';
    this.element.id = 'pause-button';
    this.element.type = 'button';

    this.element.innerHTML = `Options <span class="ui-pause-btn-hint">Esc</span>`;

    this._onClickHandler = null;
    this.parent.appendChild(this.element);
  }

  /**
   * Show pause button and attach click callback
   * @param {Function} onClick
   */
  show(onClick = null) {
    if (this._onClickHandler) {
      this.element.removeEventListener('click', this._onClickHandler);
    }
    this._onClickHandler = onClick;
    if (this._onClickHandler) {
      this.element.addEventListener('click', this._onClickHandler);
    }
    this.element.classList.remove('ui-hidden');
  }

  /**
   * Hide the pause button
   */
  hide() {
    this.element.classList.add('ui-hidden');
  }

  /**
   * Clean up DOM elements and listeners
   */
  dispose() {
    if (this._onClickHandler) {
      this.element.removeEventListener('click', this._onClickHandler);
      this._onClickHandler = null;
    }
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
