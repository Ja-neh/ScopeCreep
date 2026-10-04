/**
 * WeaponHUD.js
 * Infantry weapon panel (bottom right): weapon name, magazine and reserve ammo,
 * a reload bar, and the weapon keys.
 */
export class WeaponHUD {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;

    this.element = document.createElement('div');
    this.element.className = 'ui-weapon-hud ui-hidden';
    this.element.id = 'ui-weapon-hud';
    this.element.innerHTML = `
      <div class="ui-weapon-hud-name" data-role="name">MACHINE GUN</div>
      <div class="ui-weapon-hud-ammo">
        <span class="ui-weapon-hud-mag" data-role="ammo">30</span>
        <span class="ui-weapon-hud-reserve" data-role="reserve">/ 180</span>
      </div>
      <div class="ui-weapon-hud-reload ui-hidden" data-role="reload-track">
        <div class="ui-weapon-hud-reload-fill" data-role="reload-fill"></div>
      </div>
      <div class="ui-weapon-hud-keys">[1] Gun &nbsp;[2] Knife &nbsp;[Q] Quick knife &nbsp;[R] Reload &nbsp;[RMB] Aim</div>
    `;

    this.nameEl = this.element.querySelector('[data-role="name"]');
    this.ammoEl = this.element.querySelector('[data-role="ammo"]');
    this.reserveEl = this.element.querySelector('[data-role="reserve"]');
    this.reloadTrackEl = this.element.querySelector('[data-role="reload-track"]');
    this.reloadFillEl = this.element.querySelector('[data-role="reload-fill"]');

    this.parent.appendChild(this.element);
  }

  show() {
    this.element.classList.remove('ui-hidden');
  }

  hide() {
    this.element.classList.add('ui-hidden');
  }

  /**
   * @param {Object} state
   * @param {string} state.name - Weapon name
   * @param {number|null} state.ammo - Rounds in the magazine (null for melee weapons)
   * @param {number} state.reserve - Spare rounds
   * @param {number|null} state.reloadProgress - 0..1 while reloading, otherwise null
   */
  update({ name, ammo, reserve, reloadProgress }) {
    this.nameEl.textContent = name;

    const hasAmmo = ammo !== null && ammo !== undefined;
    this.ammoEl.textContent = hasAmmo ? String(ammo) : '—';
    this.reserveEl.textContent = hasAmmo ? `/ ${reserve}` : '';
    this.ammoEl.classList.toggle('empty', hasAmmo && ammo === 0);

    const reloading = reloadProgress !== null && reloadProgress !== undefined;
    this.reloadTrackEl.classList.toggle('ui-hidden', !reloading);
    if (reloading) {
      this.reloadFillEl.style.width = `${Math.round(reloadProgress * 100)}%`;
    }
  }

  dispose() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
