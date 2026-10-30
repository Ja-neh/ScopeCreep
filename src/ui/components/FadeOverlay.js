/**
 * FadeOverlay.js
 * The screen's black curtain. Level handovers fade through it: Level 2's walk through the gate
 * fades to black before the village loads (see Level02), and GameWorld.loadLevel keeps every
 * stage swap covered until the new level is built, then fades back out.
 * Purely visual: clicks pass straight through it (pointer-events: none).
 */
export class FadeOverlay {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;

    this.element = document.createElement('div');
    this.element.className = 'ui-fade';
    this.element.id = 'ui-fade';

    this.parent.appendChild(this.element);
  }

  /**
   * Fades the screen to black (the CSS transition owns the timing; see ui.css).
   * @param {boolean} [slow=false] - Whether to use a slower, cinematic transition
   */
  cover(slow = false) {
    if (slow) {
      this.element.classList.add('ui-fade-slow');
    } else {
      this.element.classList.remove('ui-fade-slow');
    }
    this.element.classList.add('ui-fade-covered');
  }

  /**
   * Lifts the black again.
   * @param {boolean} [slow=false] - Whether to use a slower, cinematic transition
   */
  reveal(slow = false) {
    if (slow) {
      this.element.classList.add('ui-fade-slow');
    } else {
      this.element.classList.remove('ui-fade-slow');
    }
    this.element.classList.remove('ui-fade-covered');
  }

  get isCovered() {
    return this.element.classList.contains('ui-fade-covered');
  }

  dispose() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
