/**
 * MainMenu.js
 * Minimalist title and level selector for ScopeCreep.
 */
import { HUMAN_CHARACTERS, getSelectedCharacter, selectCharacter } from '../../entities/models/CharacterRoster.js';
import config from '../../config.json';

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
        <div class="ui-character-choice">
          <label for="player-character">Play as</label>
          <select id="player-character" aria-describedby="character-choice-help"></select>
          <p id="character-choice-help">Choose your character, then select a mission.</p>
        </div>
        <div class="ui-minimal-list" id="main-menu-level-list"></div>
      </div>
    `;

    this._listContainer = this.element.querySelector('#main-menu-level-list');
    this._characterSelect = this.element.querySelector('#player-character');
    for (const character of HUMAN_CHARACTERS) {
      const option = document.createElement('option');
      option.value = character.id;
      option.textContent = character.name;
      this._characterSelect.appendChild(option);
    }
    this._characterSelect.value = getSelectedCharacter();
    this._characterSelect.addEventListener('change', () => {
      selectCharacter(this._characterSelect.value);
      this._updatePowerHelp();
    });
    this._updatePowerHelp();
  }

  _updatePowerHelp() {
    const power=config.characterPowers[this._characterSelect.value];
    this.element.querySelector('#character-choice-help').textContent=
      `H: ${power.name} · ${power.cooldown}s cooldown. Choose a mission below.`;
  }

  /**
   * Display main menu with available levels
   * @param {Array<{id: string, title: string}>} levels
   * @param {Function} onSelectLevel
   */
  show(levels = [], onSelectLevel = null) {
    this._onSelectCallback = onSelectLevel;
    this._characterSelect.value = getSelectedCharacter();
    this._updatePowerHelp();

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
    this._characterSelect = null;
    this._onSelectCallback = null;
  }
}
