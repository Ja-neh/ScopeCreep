/**
 * GraphicsSettings.js
 * The Graphics section of the Options menu: resolution and shadows, chosen by the player, with
 * the settings recommended for this computer and why.
 *
 * Works with any `settings` object offering describe(), setResolution(choice),
 * setShadows(on) and useRecommended() (GameWorld passes its RenderQuality).
 */
export class GraphicsSettings {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.settings = null;

    this.element = document.createElement('div');
    this.element.className = 'ui-graphics';
    this.element.innerHTML = `
      <div class="ui-graphics-title">Graphics</div>
      <div class="ui-graphics-row">
        <span class="ui-graphics-label">Resolution</span>
        <div class="ui-graphics-options" data-role="resolution"></div>
      </div>
      <div class="ui-graphics-row">
        <span class="ui-graphics-label">Shadows</span>
        <div class="ui-graphics-options" data-role="shadows"></div>
      </div>
      <div class="ui-graphics-recommend">
        <div class="ui-graphics-recommend-text" data-role="recommend"></div>
        <div class="ui-graphics-reason" data-role="reason"></div>
        <button class="ui-minimal-btn ui-graphics-use" data-role="use" type="button">Use recommended</button>
      </div>
    `;
    this.resolutionEl = this.element.querySelector('[data-role="resolution"]');
    this.shadowsEl = this.element.querySelector('[data-role="shadows"]');
    this.recommendEl = this.element.querySelector('[data-role="recommend"]');
    this.reasonEl = this.element.querySelector('[data-role="reason"]');
    this.useButton = this.element.querySelector('[data-role="use"]');
    this.useButton.addEventListener('click', () => {
      if (!this.settings) return;
      this.settings.useRecommended();
      this.refresh();
    });

    parentContainer.appendChild(this.element);
  }

  /**
   * Shows the section for `settings` (or hides it when null).
   */
  bind(settings) {
    this.settings = settings;
    this.element.classList.toggle('ui-hidden', !settings);
    if (settings) this.refresh();
  }

  /** Redraws the options from the current settings. */
  refresh() {
    if (!this.settings) return;
    const state = this.settings.describe();

    this.resolutionEl.replaceChildren(...state.choices.map((choice) => this._option(
      choice === 'auto' ? 'Auto' : `${Math.round(choice * 100)}%`,
      state.resolution === choice,
      state.recommended.resolution === choice,
      () => this.settings.setResolution(choice)
    )));
    this.shadowsEl.replaceChildren(
      this._option('On', state.shadows, state.recommended.shadows, () => this.settings.setShadows(true)),
      this._option('Off', !state.shadows, !state.recommended.shadows, () => this.settings.setShadows(false))
    );

    this.recommendEl.textContent = `Recommended for this computer: ${state.recommendedText}`;
    this.reasonEl.textContent = state.reason;
    this.useButton.disabled = state.isUsingRecommended;
    this.useButton.textContent = state.isUsingRecommended ? 'Using the recommended settings' : 'Use recommended';
  }

  _option(label, selected, recommended, onPick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-graphics-option';
    if (selected) button.classList.add('selected');
    if (recommended) {
      button.classList.add('recommended');
      button.title = 'Recommended for this computer';
    }
    button.textContent = label;
    button.addEventListener('click', () => {
      onPick();
      this.refresh();
    });
    return button;
  }

  dispose() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.settings = null;
  }
}
