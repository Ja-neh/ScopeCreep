/**
 * HealthBar.js
 * On-screen warship hull durability indicator (Top Center HUD).
 */
export class HealthBar {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;

    this.element = document.createElement('div');
    this.element.className = 'ui-health-container';
    this.element.id = 'battleship-health';

    this.element.innerHTML = `
      <div class="ui-health-header">
        <span class="ui-health-title">WARSHIP HULL</span>
        <span class="ui-health-value" data-role="health-text">1000 / 1000</span>
      </div>
      <div class="ui-health-track">
        <div class="ui-health-fill" data-role="health-fill"></div>
      </div>
    `;

    this.textEl = this.element.querySelector('[data-role="health-text"]');
    this.fillEl = this.element.querySelector('[data-role="health-fill"]');

    this.element.style.display = 'none'; // Hidden until level/battleship loads

    this.parent.appendChild(this.element);
  }

  /**
   * Update current health display
   * @param {number} current
   * @param {number} max
   * @param {boolean} [isDestroyed=false]
   */
  update(current, max, isDestroyed = false) {
    if (!this.textEl || !this.fillEl) return;

    if (this.element.style.display === 'none') {
      this.element.style.display = 'block';
    }

    const ratio = Math.max(0, current / (max || 1));
    this.textEl.textContent = isDestroyed
      ? 'DESTROYED'
      : `${Math.ceil(current)} / ${max}`;

    this.fillEl.style.width = `${Math.min(100, ratio * 100)}%`;

    if (isDestroyed || ratio <= 0.25) {
      this.fillEl.style.backgroundColor = 'var(--color-danger)';
      this.textEl.style.color = 'var(--color-danger)';
    } else if (ratio <= 0.5) {
      this.fillEl.style.backgroundColor = 'var(--color-warning)';
      this.textEl.style.color = 'var(--color-warning)';
    } else {
      this.fillEl.style.backgroundColor = 'var(--color-success)';
      this.textEl.style.color = '#7ee787';
    }
  }

  /**
   * Hide the health bar
   */
  hide() {
    this.element.style.display = 'none';
  }

  /**
   * Show the health bar
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
    this.textEl = null;
    this.fillEl = null;
  }
}
