/**
 * MainMenu.js
 * Minimalist title and level selector for ScopeCreep.
 */
import { characterName, getSelectedCharacter } from '../../entities/models/CharacterRoster.js';
import { CharacterSelection } from './CharacterSelection.js';

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
    this.characterSelection=new CharacterSelection(this.parent,()=>{
      this._updateCharacterLabel();this.element.classList.remove('ui-hidden');this._characterButton.focus();
    });
  }

  _build() {
    this.element.innerHTML = `
      <div class="ui-minimal-menu">
        <h1 class="ui-minimal-title">Scope Creep</h1>
        <div class="ui-character-choice">
          <button type="button" class="ui-minimal-btn" id="choose-characters">Choose Characters</button>
          <p id="character-choice-help"></p>
        </div>
        <div class="ui-minimal-list" id="main-menu-level-list"></div>
        <button type="button" class="ui-minimal-btn ui-menu-secondary" id="main-menu-credits">Credits</button>
      </div>
    `;

    this._listContainer = this.element.querySelector('#main-menu-level-list');
    this._characterButton = this.element.querySelector('#choose-characters');
    this._creditsButton = this.element.querySelector('#main-menu-credits');
    this._creditsButton.addEventListener('click', () => this._onCreditsCallback?.());
    this._characterButton.addEventListener('click', () => {
      this.element.classList.add('ui-hidden');this.characterSelection.show();
    });
    this._updateCharacterLabel();
  }

  _updateCharacterLabel() {
    this.element.querySelector('#character-choice-help').textContent=
      `Playing as ${characterName(getSelectedCharacter())}.`;
  }

  /**
   * Display main menu with available levels
   * @param {Array<{id: string, title: string}>} levels
   * @param {Function} onSelectLevel
   */
  show(levels = [], onSelectLevel = null, onCredits = null) {
    this._onSelectCallback = onSelectLevel;
    this._onCreditsCallback = onCredits;
    this.characterSelection.hide();
    this._updateCharacterLabel();

    if (this._listContainer) {
      this._listContainer.replaceChildren();

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
    this.characterSelection.hide();
    this.element.classList.add('ui-hidden');
  }

  /**
   * Clean up DOM elements
   */
  dispose() {
    this.characterSelection.dispose();
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this._listContainer = null;
    this._characterButton = null;
    this._onSelectCallback = null;
  }
}
