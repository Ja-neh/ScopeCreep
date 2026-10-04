// Shown when a level doesn't list its own controls (Level 1)
const DEFAULT_LINES = [
  { keys: 'Left Click', label: 'Lock Mouse' },
  { keys: '[Esc] / [P]', label: 'Pause & Options Menu' },
  { keys: 'W, A, S, D', label: 'Walk on Deck' },
  { keys: 'Shift', label: 'Sprint  |  Space: Jump' },
  { keys: '[E]', label: 'Mount / Dismount Station (when in ring)' },
  { keys: '[V] / [Tab]', label: 'Toggle 1st / 3rd Person View' },
  { keys: '[B] / [F2]', label: 'Toggle Battleship Colliders' }
];

/**
 * ControlsHelper.js
 * On-screen keyboard and mouse controls helper card (Bottom Left HUD).
 * Shows the current level's controls (setLines), or Level 1's by default.
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
    this.setLines(null);

    this.parent.appendChild(this.element);
  }

  /**
   * Replaces the card's contents.
   * @param {Array<{keys: string, label: string}>|null} lines - null for the default card
   */
  setLines(lines) {
    this.element.replaceChildren();
    for (const { keys, label } of lines || DEFAULT_LINES) {
      const row = document.createElement('div');
      const key = document.createElement('strong');
      key.textContent = `${keys}:`;
      row.append('• ', key, ` ${label}`);
      this.element.appendChild(row);
    }
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
