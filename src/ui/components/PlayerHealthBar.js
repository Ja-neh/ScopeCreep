/**
 * PlayerHealthBar.js
 * The player's own health (bottom centre), turning red when low.
 */
export class PlayerHealthBar {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;

    this.element = document.createElement('div');
    this.element.className = 'ui-player-health ui-hidden';
    this.element.id = 'ui-player-health';
    this.element.innerHTML = `
      <div class="ui-player-health-label">HEALTH <span data-role="value">100</span></div>
      <div class="ui-player-health-track"><div class="ui-player-health-fill" data-role="fill"></div></div>
    `;
    this.valueEl = this.element.querySelector('[data-role="value"]');
    this.fillEl = this.element.querySelector('[data-role="fill"]');

    this.parent.appendChild(this.element);
  }

  show() {
    this.element.classList.remove('ui-hidden');
  }

  hide() {
    this.element.classList.add('ui-hidden');
  }

  update(current, max) {
    const ratio = Math.max(0, Math.min(1, current / (max || 1)));
    this.valueEl.textContent = String(Math.ceil(current));
    this.fillEl.style.width = `${ratio * 100}%`;
    this.element.classList.toggle('low', ratio <= 0.3);
  }

  dispose() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
