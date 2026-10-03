/**
 * StatusIndicator.js
 * Persistent status badge above the interaction prompt (e.g. "HIDDEN" while concealed in a bush).
 * Stays up until hidden, unlike a toast.
 */
export class StatusIndicator {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;

    this.element = document.createElement('div');
    this.element.className = 'ui-status-indicator ui-hidden';
    this.element.id = 'ui-status-indicator';

    this.parent.appendChild(this.element);
  }

  /**
   * @param {string} text
   * @param {'success'|'info'|'warning'|'danger'} [variant='info']
   */
  show(text, variant = 'info') {
    this.element.textContent = text;
    this.element.className = `ui-status-indicator status-${variant}`;
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
