/**
 * WeaponHUD.js
 * Infantry weapon panel (bottom right): weapon name, magazine and reserve ammo,
 * a reload bar, and the weapon slots with their keys.
 */
const ICONS={
  rifle:'<path d="M2 14h14v-5h24v4h19v5H38l-5 10h-7l2-10H15l-5 7H3z"/>',
  knife:'<path d="M6 27l8-8 5 5-8 8zm10-11L45 2c3 12-8 19-22 22z"/>',
  bomb:'<circle cx="28" cy="21" r="12"/><path d="M25 8V3h10v5h-3V6h-4v2zm10-3 10 7-3 4-10-7z"/>'
};
const icon=(key)=>`<svg class="ui-tool-icon" viewBox="0 0 64 36" aria-hidden="true">${ICONS[key]}</svg>`;
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
      <div class="ui-weapon-hud-name" data-role="name" aria-label="Machine gun">${icon('rifle')}</div>
      <div class="ui-weapon-hud-ammo">
        <span class="ui-weapon-hud-mag" data-role="ammo">75</span>
        <span class="ui-weapon-hud-reserve" data-role="reserve">/ 225</span>
      </div>
      <div class="ui-weapon-hud-reload ui-hidden" data-role="reload-track">
        <div class="ui-weapon-hud-reload-fill" data-role="reload-fill"></div>
      </div>
      <div class="ui-weapon-hud-keys">
        <span data-role="slot-1" title="Machine gun [1]">${icon('rifle')}<small>1</small></span>
        <span data-role="slot-2" title="Knife [2]">${icon('knife')}<small>2</small></span>
        <span data-role="slot-3" title="Bomb [3]">${icon('bomb')}<small>3</small></span>
      </div>
    `;

    this.nameEl = this.element.querySelector('[data-role="name"]');
    this.ammoEl = this.element.querySelector('[data-role="ammo"]');
    this.reserveEl = this.element.querySelector('[data-role="reserve"]');
    this.reloadTrackEl = this.element.querySelector('[data-role="reload-track"]');
    this.reloadFillEl = this.element.querySelector('[data-role="reload-fill"]');
    this.slotEls = [
      this.element.querySelector('[data-role="slot-1"]'),
      this.element.querySelector('[data-role="slot-2"]'),
      this.element.querySelector('[data-role="slot-3"]')
    ];

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
   * @param {number|null} state.reserve - Spare rounds (null for weapons that have none)
   * @param {number|null} state.reloadProgress - 0..1 while reloading, otherwise null
   * @param {number} [state.slot] - 1-based slot to highlight in the keys line
   */
  update({ name, ammo, reserve, reloadProgress, slot }) {
    this.nameEl.setAttribute('aria-label',name);
    const key=slot===2 ? 'knife' : slot===3 ? 'bomb' : 'rifle';
    if(this._icon!==key){this.nameEl.innerHTML=icon(key);this._icon=key;}

    const hasAmmo = ammo !== null && ammo !== undefined;
    this.ammoEl.textContent = hasAmmo ? String(ammo) : '—';
    this.reserveEl.textContent = hasAmmo && reserve !== null && reserve !== undefined ? `/ ${reserve}` : '';
    this.ammoEl.classList.toggle('empty', hasAmmo && ammo === 0);

    if (slot !== undefined) {
      this.slotEls.forEach((el, i) => el.classList.toggle('active', i + 1 === slot));
    }

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
