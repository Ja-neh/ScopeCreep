/**
 * MainMenu.js
 * Minimalist title and level selector for ScopeCreep.
 */
export class MainMenu {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;

    this.element = document.createElement('div');
    this.element.className = 'ui-main-menu ui-hidden';
    this.element.id = 'main-menu';

    this._onSelectCallback = null;
    this._listContainer = null;

    this._build();
    this.parent.appendChild(this.element);
  }

  _build() {
    this.element.innerHTML = `
      <div class="ui-minimal-menu">
        <h1 class="ui-minimal-title">Scope Creep</h1>
        <div class="ui-minimal-list" id="main-menu-level-list"></div>
      </div>
    `;

    this._listContainer = this.element.querySelector('#main-menu-level-list');
  }

  /**
   * Display main menu with available levels
   * @param {Array<{id: string, title: string}>} levels
   * @param {Function} onSelectLevel
   */
  show(levels = [], onSelectLevel = null) {
    this._onSelectCallback = onSelectLevel;

    if (this._listContainer) {
      this._listContainer.innerHTML = '';

      levels.forEach((lvl) => {
        const btn = document.createElement('button');
        btn.className = 'ui-minimal-btn';
        btn.type = 'button';
        btn.textContent = lvl.title;

        btn.addEventListener('click', () => {
          if (this._onSelectCallback) {
            this._onSelectCallback(lvl);
          }
        });

        this._listContainer.appendChild(btn);
      });
    }

    this.element.classList.remove('ui-hidden');
  }

  /**
   * Hide the main menu
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
    this._listContainer = null;
    this._onSelectCallback = null;
  }
}
