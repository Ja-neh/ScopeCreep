/**
 * CinematicOverlay.js
 * Letterbox bars, a title card and a skip hint shown over an in-engine camera sequence.
 */
export class CinematicOverlay {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;

    this.element = document.createElement('div');
    this.element.className = 'ui-cinematic ui-hidden';
    this.element.id = 'ui-cinematic';
    this.element.innerHTML = `
      <div class="ui-cinematic-bar ui-cinematic-bar-top"></div>
      <div class="ui-cinematic-bar ui-cinematic-bar-bottom"></div>
      <div class="ui-cinematic-caption">
        <div class="ui-cinematic-title" data-role="title"></div>
        <div class="ui-cinematic-subtitle" data-role="subtitle"></div>
      </div>
      <div class="ui-cinematic-hint" data-role="hint"></div>
    `;
    this.titleEl = this.element.querySelector('[data-role="title"]');
    this.subtitleEl = this.element.querySelector('[data-role="subtitle"]');
    this.hintEl = this.element.querySelector('[data-role="hint"]');

    this.parent.appendChild(this.element);
  }

  /**
   * @param {string} title
   * @param {string} [subtitle]
   * @param {string} [hint] - e.g. '[Space] Skip'
   */
  show(title, subtitle = '', hint = '') {
    this.titleEl.textContent = title;
    this.subtitleEl.textContent = subtitle;
    this.hintEl.textContent = hint;
    this.element.classList.remove('ui-hidden');
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
