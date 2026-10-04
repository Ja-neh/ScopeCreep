/**
 * Credits.js
 * The end credits: a dark veil with the credits rolling up the screen over a few seconds, and a
 * skip hint. Clicks go through it (the level handles skipping with a key).
 */
export class Credits {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;

    this.element = document.createElement('div');
    this.element.className = 'ui-credits ui-hidden';
    this.element.id = 'ui-credits';
    this.element.innerHTML = `
      <div class="ui-credits-roll" data-role="roll"></div>
      <div class="ui-credits-hint" data-role="hint"></div>
    `;
    this.rollEl = this.element.querySelector('[data-role="roll"]');
    this.hintEl = this.element.querySelector('[data-role="hint"]');

    this.parent.appendChild(this.element);
  }

  /**
   * @param {Array<{heading?: string, lines: string[]}>} sections
   * @param {number} seconds - How long the roll takes
   * @param {string} [hint] - e.g. '[Space] Skip'
   */
  show(sections, seconds, hint = '') {
    this.rollEl.replaceChildren();
    for (const section of sections) {
      const block = document.createElement('div');
      block.className = 'ui-credits-section';
      if (section.heading) {
        const heading = document.createElement('div');
        heading.className = 'ui-credits-heading';
        heading.textContent = section.heading;
        block.appendChild(heading);
      }
      for (const line of section.lines) {
        const row = document.createElement('div');
        row.className = 'ui-credits-line';
        row.textContent = line;
        block.appendChild(row);
      }
      this.rollEl.appendChild(block);
    }
    this.hintEl.textContent = hint;
    this.rollEl.style.animationDuration = `${seconds}s`;
    // Restart the roll from the bottom
    this.rollEl.classList.remove('rolling');
    void this.rollEl.offsetWidth;
    this.rollEl.classList.add('rolling');
    this.element.classList.remove('ui-hidden');
  }

  hide() {
    this.element.classList.add('ui-hidden');
    this.rollEl.classList.remove('rolling');
  }

  dispose() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
