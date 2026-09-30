/**
 * InteractionPrompt.js
 * Unified on-screen interaction prompt for player action triggers (e.g. [E] TAKE SHIP HELM).
 */
export class InteractionPrompt {
  /**
   * @param {HTMLElement} parentContainer - Container to mount the prompt element into.
   */
  constructor(parentContainer) {
    this.parent = parentContainer;
    this.currentSource = null;

    this.element = document.createElement('div');
    this.element.className = 'ui-prompt';
    this.element.id = 'interaction-prompt';

    this.keyElement = document.createElement('span');
    this.keyElement.className = 'ui-prompt-key';
    this.keyElement.textContent = 'E';

    this.textElement = document.createElement('span');
    this.textElement.className = 'ui-prompt-text';

    this.element.appendChild(this.keyElement);
    this.element.appendChild(this.textElement);

    this.parent.appendChild(this.element);
  }

  /**
   * Display the prompt with specified key, label, and optional accent color.
   * @param {string} key - e.g. 'E'
   * @param {string} label - e.g. 'TAKE SHIP HELM'
   * @param {string} [accentColor] - Hex or rgb color string for border and key highlight
   * @param {any} [sourceId] - Identifier of the entity showing the prompt (to prevent race conditions)
   */
  show(key = 'E', label = '', accentColor = '#2a9d8f', sourceId = null) {
    this.currentSource = sourceId;
    this.keyElement.textContent = key;
    this.textElement.textContent = label;

    if (accentColor) {
      this.element.style.borderColor = accentColor;
      this.element.style.boxShadow = `0 0 20px ${accentColor}`;
      this.keyElement.style.backgroundColor = accentColor;
      // Adjust key text color if accent is very bright
      this.keyElement.style.color = '#ffffff';
    }

    this.element.style.display = 'inline-flex';
    this.element.style.alignItems = 'center';
  }

  /**
   * Hide the prompt if called by the current owner or without source filtering.
   * @param {any} [sourceId] - Identifier of the entity calling hide
   */
  hide(sourceId = null) {
    if (sourceId && this.currentSource && this.currentSource !== sourceId) {
      return;
    }
    this.currentSource = null;
    this.element.style.display = 'none';
  }

  /**
   * Clean up DOM nodes
   */
  dispose() {
    this.currentSource = null;
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}
