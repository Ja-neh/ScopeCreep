/**
 * DevToolsWidget.js
 * On-screen developer tools panel for quick camera switching and collider inspection (Top Right HUD).
 */
export class DevToolsWidget {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;

    this.element = document.createElement('div');
    this.element.className = 'ui-devtools-widget';
    this.element.id = 'level1-dev-tools';

    this.element.innerHTML = `
      <div class="ui-devtools-title">🛠️ DEV CAMERA TOOLS</div>
      <div style="display: flex; gap: 8px;">
        <button id="dev-btn-player" class="ui-btn active" style="flex: 1;">
          🏃 Player [1]
        </button>
        <button id="dev-btn-aerial" class="ui-btn" style="flex: 1;">
          🛸 Aerial [2]
        </button>
      </div>
      <div style="margin-top: 4px; border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 8px;">
        <button id="dev-btn-colliders" class="ui-btn" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;">
          🛡️ Colliders: OFF [B]
        </button>
      </div>
      <div style="font-size: 11px; color: #64748b; line-height: 1.4; margin-top: 2px;">
        Cameras: <strong>[1]</strong> / <strong>[2]</strong> &nbsp;|&nbsp; Colliders: <strong>[B]</strong> / <strong>[F2]</strong>
      </div>
    `;

    this.btnPlayer = this.element.querySelector('#dev-btn-player');
    this.btnAerial = this.element.querySelector('#dev-btn-aerial');
    this.btnColliders = this.element.querySelector('#dev-btn-colliders');

    this._onPlayerClick = null;
    this._onAerialClick = null;
    this._onCollidersClick = null;

    this.parent.appendChild(this.element);
  }

  /**
   * Bind callbacks and show widget
   * @param {Object} callbacks
   * @param {Function} [callbacks.onSelectPlayerCamera]
   * @param {Function} [callbacks.onSelectAerialCamera]
   * @param {Function} [callbacks.onToggleColliders]
   */
  show(callbacks = {}) {
    if (callbacks.onSelectPlayerCamera) {
      this._onPlayerClick = (e) => {
        e.stopPropagation();
        callbacks.onSelectPlayerCamera();
      };
      this.btnPlayer.addEventListener('click', this._onPlayerClick);
    }

    if (callbacks.onSelectAerialCamera) {
      this._onAerialClick = (e) => {
        e.stopPropagation();
        callbacks.onSelectAerialCamera();
      };
      this.btnAerial.addEventListener('click', this._onAerialClick);
    }

    if (callbacks.onToggleColliders) {
      this._onCollidersClick = (e) => {
        e.stopPropagation();
        callbacks.onToggleColliders();
      };
      this.btnColliders.addEventListener('click', this._onCollidersClick);
    }

    this.element.style.display = 'flex';
  }

  /**
   * Update camera mode button highlights
   * @param {'PLAYER'|'AERIAL'} mode
   */
  updateCameraButton(mode) {
    if (mode === 'AERIAL') {
      this.btnPlayer.classList.remove('active');
      this.btnPlayer.style.background = 'rgba(255, 255, 255, 0.08)';
      this.btnPlayer.style.borderColor = 'rgba(255, 255, 255, 0.15)';
      this.btnPlayer.style.color = '#94a3b8';

      this.btnAerial.classList.add('active');
      this.btnAerial.style.background = '#0284c7';
      this.btnAerial.style.borderColor = '#38bdf8';
      this.btnAerial.style.color = '#ffffff';
    } else {
      this.btnPlayer.classList.add('active');
      this.btnPlayer.style.background = '#0d9488';
      this.btnPlayer.style.borderColor = '#2dd4bf';
      this.btnPlayer.style.color = '#ffffff';

      this.btnAerial.classList.remove('active');
      this.btnAerial.style.background = 'rgba(255, 255, 255, 0.08)';
      this.btnAerial.style.borderColor = 'rgba(255, 255, 255, 0.15)';
      this.btnAerial.style.color = '#94a3b8';
    }
  }

  /**
   * Update colliders toggle button appearance
   * @param {boolean} visible
   */
  updateCollidersButton(visible) {
    if (visible) {
      this.btnColliders.classList.add('active');
      this.btnColliders.style.background = '#059669';
      this.btnColliders.style.borderColor = '#34d399';
      this.btnColliders.style.color = '#ffffff';
      this.btnColliders.innerHTML = '🛡️ Colliders: ON [B]';
    } else {
      this.btnColliders.classList.remove('active');
      this.btnColliders.style.background = 'rgba(255, 255, 255, 0.08)';
      this.btnColliders.style.borderColor = 'rgba(255, 255, 255, 0.15)';
      this.btnColliders.style.color = '#94a3b8';
      this.btnColliders.innerHTML = '🛡️ Colliders: OFF [B]';
    }
  }

  /**
   * Hide the widget
   */
  hide() {
    this.element.style.display = 'none';
  }

  /**
   * Cleanup event listeners and DOM element
   */
  dispose() {
    if (this._onPlayerClick && this.btnPlayer) {
      this.btnPlayer.removeEventListener('click', this._onPlayerClick);
    }
    if (this._onAerialClick && this.btnAerial) {
      this.btnAerial.removeEventListener('click', this._onAerialClick);
    }
    if (this._onCollidersClick && this.btnColliders) {
      this.btnColliders.removeEventListener('click', this._onCollidersClick);
    }
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.btnPlayer = null;
    this.btnAerial = null;
    this.btnColliders = null;
  }
}
