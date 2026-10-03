/**
 * ObjectivePanel.js
 * Current mission objective (top centre): a short title and one line of detail.
 */
export class ObjectivePanel {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;

    this.element = document.createElement('div');
    this.element.className = 'ui-objective ui-hidden';
    this.element.id = 'ui-objective';
    this.element.innerHTML = `
      <div class="ui-objective-title" data-role="title"></div>
      <div class="ui-objective-detail" data-role="detail"></div>
    `;
    this.titleEl = this.element.querySelector('[data-role="title"]');
    this.detailEl = this.element.querySelector('[data-role="detail"]');

    this.parent.appendChild(this.element);
  }

  /**
   * Shows the panel; only touches the DOM when the text changed.
   * @param {string} title
   * @param {string} [detail]
   */
  show(title, detail = '') {
    if (this.titleEl.textContent !== title) this.titleEl.textContent = title;
    if (this.detailEl.textContent !== detail) this.detailEl.textContent = detail;
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
