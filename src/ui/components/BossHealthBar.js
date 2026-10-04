/**
 * BossHealthBar.js
 * A boss's name and health across the top of the screen, under the objective. While the boss is
 * shielded the bar turns blue and says SHIELDED.
 */
export class BossHealthBar {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;

    this.element = document.createElement('div');
    this.element.className = 'ui-boss-health ui-hidden';
    this.element.id = 'ui-boss-health';
    this.element.innerHTML = `
      <div class="ui-boss-health-header">
        <span class="ui-boss-health-name" data-role="name">BOSS</span>
        <span class="ui-boss-health-status" data-role="status"></span>
      </div>
      <div class="ui-boss-health-track"><div class="ui-boss-health-fill" data-role="fill"></div></div>
    `;
    this.nameEl = this.element.querySelector('[data-role="name"]');
    this.statusEl = this.element.querySelector('[data-role="status"]');
    this.fillEl = this.element.querySelector('[data-role="fill"]');

    this.parent.appendChild(this.element);
  }

  /**
   * @param {string} name
   */
  show(name) {
    this.nameEl.textContent = name;
    this.element.classList.remove('ui-hidden');
  }

  /**
   * @param {number} current
   * @param {number} max
   * @param {boolean} [shielded=false]
   */
  update(current, max, shielded = false) {
    const ratio = Math.max(0, Math.min(1, current / (max || 1)));
    this.fillEl.style.width = `${ratio * 100}%`;
    this.statusEl.textContent = shielded ? 'SHIELDED' : `${Math.ceil(ratio * 100)}%`;
    this.element.classList.toggle('shielded', shielded);
  }

  hide() {
    this.element.classList.add('ui-hidden');
  }

  dispose() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
