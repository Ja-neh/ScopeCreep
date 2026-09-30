/**
 * ToastNotification.js
 * Auto-fading bottom-right toast message notification system.
 */
export class ToastNotification {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;
    this.timeout = null;

    this.element = document.createElement('div');
    this.element.className = 'ui-toast';
    this.element.id = 'ui-toast-notification';

    this.parent.appendChild(this.element);
  }

  /**
   * Show a toast message with specified variant and duration.
   * @param {string} message
   * @param {'success'|'info'|'warning'|'danger'} [variant='info']
   * @param {number} [durationMs=2200]
   */
  show(message, variant = 'info', durationMs = 2200) {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    this.element.className = `ui-toast toast-${variant} visible`;
    this.element.textContent = message;

    this.timeout = setTimeout(() => {
      this.element.classList.remove('visible');
      this.timeout = null;
    }, durationMs);
  }

  /**
   * Clean up DOM and timeouts.
   */
  dispose() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
