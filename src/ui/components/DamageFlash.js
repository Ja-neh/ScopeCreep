/**
 * DamageFlash.js
 * A red flash around the screen edges when the player is hurt. A stand-in until the
 * damage screen-pass shader replaces it.
 */
export class DamageFlash {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;
    this.timeout = null;

    this.element = document.createElement('div');
    this.element.className = 'ui-damage-flash';
    this.element.id = 'ui-damage-flash';

    this.parent.appendChild(this.element);
  }

  flash() {
    if (this.timeout) clearTimeout(this.timeout);
    this.element.classList.add('active');
    this.timeout = setTimeout(() => {
      this.element.classList.remove('active');
      this.timeout = null;
    }, 90);
  }

  clear() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.element.classList.remove('active');
  }

  dispose() {
    this.clear();
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
