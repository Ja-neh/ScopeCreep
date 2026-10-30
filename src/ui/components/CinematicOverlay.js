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
   * @param {boolean} [isThought=false] - Whether to style as centered inner monologue thoughts
   */
  show(title, subtitle = '', hint = '', isThought = false) {
    this.titleEl.textContent = title;
    this.subtitleEl.textContent = subtitle;
    this.hintEl.textContent = hint;

    if (isThought) {
      this.element.classList.add('ui-cinematic-thought');
    } else {
      this.element.classList.remove('ui-cinematic-thought');
    }

    const caption = this.element.querySelector('.ui-cinematic-caption');
    if (caption) {
      caption.style.animation = 'none';
      void caption.offsetWidth; // trigger reflow for smooth re-fade
      caption.style.animation = '';
    }

    this.element.classList.remove('ui-hidden');
  }

  hide() {
    this.element.classList.add('ui-hidden');
    this.element.classList.remove('ui-cinematic-thought');
  }

  dispose() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
