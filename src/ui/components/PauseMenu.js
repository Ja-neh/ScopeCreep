/**
 * PauseMenu.js
 * Minimalist pause and options menu.
 */
export class PauseMenu {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;

    this.element = document.createElement('div');
    this.element.className = 'ui-pause-overlay ui-hidden';
    this.element.id = 'pause-menu-overlay';

    this._callbacks = {};

    this._build();
    this.parent.appendChild(this.element);
  }

  _build() {
    this.element.innerHTML = `
      <div class="ui-minimal-menu">
        <h2 class="ui-minimal-title">Options</h2>
        <div class="ui-minimal-list">
          <button class="ui-minimal-btn" id="pause-btn-continue" type="button">Continue</button>
          <button class="ui-minimal-btn" id="pause-btn-restart" type="button">Restart Level</button>
          <button class="ui-minimal-btn" id="pause-btn-mainmenu" type="button">Main Menu</button>
        </div>
      </div>
    `;

    const continueBtn = this.element.querySelector('#pause-btn-continue');
    const restartBtn = this.element.querySelector('#pause-btn-restart');
    const mainMenuBtn = this.element.querySelector('#pause-btn-mainmenu');

    if (continueBtn) {
      continueBtn.addEventListener('click', () => {
        if (this._callbacks.onResume) this._callbacks.onResume();
      });
    }

    if (restartBtn) {
      restartBtn.addEventListener('click', () => {
        if (this._callbacks.onRestart) this._callbacks.onRestart();
      });
    }

    if (mainMenuBtn) {
      mainMenuBtn.addEventListener('click', () => {
        if (this._callbacks.onReturnToMenu) this._callbacks.onReturnToMenu();
      });
    }
  }

  /**
   * Show pause & options menu
   * @param {Object} callbacks
   * @param {Function} callbacks.onResume
   * @param {Function} callbacks.onRestart
   * @param {Function} callbacks.onReturnToMenu
   * @param {Function} callbacks.onToggleColliders
   */
  show(callbacks = {}) {
    this._callbacks = callbacks;
    this.element.classList.remove('ui-hidden');
  }

  /**
   * Hide pause menu
   */
  hide() {
    this.element.classList.add('ui-hidden');
  }

  /**
   * Clean up DOM elements
   */
  dispose() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this._callbacks = {};
  }
}
