/**
 * StationHUD.js
 * Full-screen HUD overlay shown while a player is mounted at a vehicle station
 * (Helm navigation console, Artillery gunner sights, Flak battery).
 */
export class StationHUD {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;
    this.currentType = null;

    this.element = document.createElement('div');
    this.element.className = 'ui-station-hud';
    this.element.id = 'station-hud';

    this.parent.appendChild(this.element);

    // Cached sub-element references
    this.helmSpeedEl = null;
    this.helmHeadingEl = null;
    this.helmRudderEl = null;

    this.weaponLabelEl = null;
    this.weaponFillEl = null;
  }

  /**
   * Show HUD for a specific station type.
   * @param {'helm'|'artillery'|'flak'} type
   * @param {Object} [config]
   */
  show(type, config = {}) {
    this.currentType = type;

    if (type === 'helm') {
      this.element.innerHTML = `
        <div class="ui-helm-panel">
          <div class="ui-helm-header">⚓ WARSHIP HELM ACTIVE</div>
          <div class="ui-helm-metrics">
            <div class="ui-helm-metric-box">
              <span class="ui-helm-metric-val" id="helm-speed" style="color: #38bdf8;">0.0</span>
              <span class="ui-helm-metric-lbl">SPEED (KTS)</span>
            </div>
            <div class="ui-helm-metric-box">
              <span class="ui-helm-metric-val" id="helm-heading" style="color: #f59e0b;">000°</span>
              <span class="ui-helm-metric-lbl">HEADING</span>
            </div>
            <div class="ui-helm-metric-box">
              <span class="ui-helm-metric-val" id="helm-rudder" style="color: #10b981;">MID</span>
              <span class="ui-helm-metric-lbl">RUDDER</span>
            </div>
          </div>
          <div class="ui-helm-instructions">
            <strong>[W]</strong> Ahead &nbsp;|&nbsp; <strong>[S]</strong> Astern &nbsp;|&nbsp; 
            <strong>[A] / [D]</strong> Rudder &nbsp;|&nbsp; <strong>[E]</strong> Release Helm
          </div>
        </div>
      `;
      this.helmSpeedEl = this.element.querySelector('#helm-speed');
      this.helmHeadingEl = this.element.querySelector('#helm-heading');
      this.helmRudderEl = this.element.querySelector('#helm-rudder');
    } else if (type === 'artillery') {
      const title = config.title || 'MAIN ARTILLERY TURRET';
      this.element.innerHTML = `
        <div class="ui-weapon-panel artillery">
          <div class="ui-weapon-title">${title}</div>
          <div class="ui-meter-track">
            <div class="ui-meter-fill" data-role="reload-fill" style="width: 100%; background: #e76f51; box-shadow: 0 0 8px rgba(231, 111, 81, 0.8);"></div>
          </div>
          <div class="ui-weapon-status" data-role="reload-label" style="color: #7fd992;">READY</div>
        </div>
        <div class="ui-station-dismount">
          <kbd>E</kbd> or <kbd>ESC</kbd> Dismount &nbsp;|&nbsp; <strong>Mouse</strong> Aim &nbsp;|&nbsp; <strong>Left Click</strong> Fire
        </div>
      `;
      this.weaponLabelEl = this.element.querySelector('[data-role="reload-label"]');
      this.weaponFillEl = this.element.querySelector('[data-role="reload-fill"]');
    } else if (type === 'flak') {
      const title = config.title || 'ANTI-AIR FLAK BATTERY';
      this.element.innerHTML = `
        <div class="ui-weapon-panel flak">
          <div class="ui-weapon-title">${title}</div>
          <div class="ui-meter-track">
            <div class="ui-meter-fill" data-role="reload-fill" style="width: 100%; background: #f4a261; box-shadow: 0 0 8px rgba(244, 162, 97, 0.8);"></div>
          </div>
          <div class="ui-weapon-status" data-role="reload-label" style="color: #7fd992;">READY</div>
        </div>
        <div class="ui-station-dismount">
          <kbd>E</kbd> or <kbd>ESC</kbd> Dismount &nbsp;|&nbsp; <strong>Mouse</strong> Aim &nbsp;|&nbsp; <strong>Left Click</strong> Fire
        </div>
      `;
      this.weaponLabelEl = this.element.querySelector('[data-role="reload-label"]');
      this.weaponFillEl = this.element.querySelector('[data-role="reload-fill"]');
    }

    this.element.style.display = 'block';
  }

  /**
   * Update active station HUD values.
   * @param {'helm'|'artillery'|'flak'} type
   * @param {Object} data
   */
  update(type, data) {
    if (this.currentType !== type) return;

    if (type === 'helm') {
      if (this.helmSpeedEl && data.speed !== undefined) {
        this.helmSpeedEl.textContent = data.speed;
      }
      if (this.helmHeadingEl && data.heading !== undefined) {
        this.helmHeadingEl.textContent = data.heading;
      }
      if (this.helmRudderEl && data.rudder !== undefined) {
        this.helmRudderEl.textContent = data.rudder;
        if (data.rudderColor) {
          this.helmRudderEl.style.color = data.rudderColor;
        }
      }
    } else if (type === 'artillery' || type === 'flak') {
      const accent = type === 'artillery' ? '#e76f51' : '#f4a261';
      const glow = type === 'artillery' ? 'rgba(231, 111, 81, 0.8)' : 'rgba(244, 162, 97, 0.8)';
      const ready = !!data.ready;

      if (this.weaponFillEl && data.pct !== undefined) {
        this.weaponFillEl.style.width = `${data.pct}%`;
        this.weaponFillEl.style.background = ready ? '#7fd992' : accent;
        this.weaponFillEl.style.boxShadow = ready ? '0 0 8px rgba(127, 217, 146, 0.8)' : `0 0 8px ${glow}`;
      }

      if (this.weaponLabelEl && data.label !== undefined) {
        this.weaponLabelEl.textContent = data.label;
        this.weaponLabelEl.style.color = ready ? '#7fd992' : accent;
      }
    }
  }

  /**
   * Hide the station HUD overlay.
   */
  hide() {
    this.element.style.display = 'none';
    this.currentType = null;
    this.helmSpeedEl = null;
    this.helmHeadingEl = null;
    this.helmRudderEl = null;
    this.weaponLabelEl = null;
    this.weaponFillEl = null;
  }

  /**
   * Cleanup DOM nodes.
   */
  dispose() {
    this.hide();
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}
