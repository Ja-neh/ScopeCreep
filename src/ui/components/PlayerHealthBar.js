/**
 * PlayerHealthBar.js
 * The player's own health (bottom centre), turning red when low, with a SHIELD bar over it
 * while they carry a shield.
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
      <div class="ui-player-shield ui-hidden" data-role="shield">
        <div class="ui-player-health-label">SHIELD <span data-role="shield-value">0</span></div>
        <div class="ui-player-health-track"><div class="ui-player-shield-fill" data-role="shield-fill"></div></div>
      </div>
      <div class="ui-player-health-label">HEALTH <span data-role="value">100</span></div>
      <div class="ui-player-health-track"><div class="ui-player-health-fill" data-role="fill"></div></div>
    `;
    this.valueEl = this.element.querySelector('[data-role="value"]');
    this.fillEl = this.element.querySelector('[data-role="fill"]');
    this.shieldEl = this.element.querySelector('[data-role="shield"]');
    this.shieldValueEl = this.element.querySelector('[data-role="shield-value"]');
    this.shieldFillEl = this.element.querySelector('[data-role="shield-fill"]');

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

  /** The shield's bar: hidden when there is no shield. */
  updateShield(current, max) {
    const ratio = Math.max(0, Math.min(1, current / (max || 1)));
    this.shieldValueEl.textContent = String(Math.ceil(current));
    this.shieldFillEl.style.width = `${ratio * 100}%`;
    this.shieldEl.classList.toggle('ui-hidden', current <= 0);
  }

  dispose() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
