/**
 * MissionResult.js
 * End-of-mission screen: victory or defeat title, a message, a few stats, and buttons
 * (e.g. Play again / Retry / Main menu).
 */
export class MissionResult {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;

    this.element = document.createElement('div');
    this.element.className = 'ui-mission-result ui-hidden';
    this.element.id = 'ui-mission-result';
    this.element.innerHTML = `
      <div class="ui-mission-result-panel">
        <h2 class="ui-mission-result-title" data-role="title"></h2>
        <p class="ui-mission-result-message" data-role="message"></p>
        <div class="ui-mission-result-stats" data-role="stats"></div>
        <div class="ui-minimal-list" data-role="actions"></div>
      </div>
    `;
    this.titleEl = this.element.querySelector('[data-role="title"]');
    this.messageEl = this.element.querySelector('[data-role="message"]');
    this.statsEl = this.element.querySelector('[data-role="stats"]');
    this.actionsEl = this.element.querySelector('[data-role="actions"]');

    this.parent.appendChild(this.element);
  }

  /**
   * @param {Object} result
   * @param {'victory'|'defeat'} result.outcome
   * @param {string} result.title
   * @param {string} [result.message]
   * @param {Array<{label: string, value: string}>} [result.stats]
   * @param {Array<{label: string, onClick: Function}>} [result.actions]
   */
  show({ outcome, title, message = '', stats = [], actions = [] }) {
    this.element.classList.toggle('victory', outcome === 'victory');
    this.element.classList.toggle('defeat', outcome === 'defeat');
    this.titleEl.textContent = title;
    this.messageEl.textContent = message;

    this.statsEl.innerHTML = '';
    for (const stat of stats) {
      const row = document.createElement('div');
      row.className = 'ui-mission-result-stat';
      const label = document.createElement('span');
      label.textContent = stat.label;
      const value = document.createElement('strong');
      value.textContent = stat.value;
      row.append(label, value);
      this.statsEl.appendChild(row);
    }

    this.actionsEl.innerHTML = '';
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ui-minimal-btn';
      button.textContent = action.label;
      button.addEventListener('click', () => action.onClick());
      this.actionsEl.appendChild(button);
    }

    this.element.classList.remove('ui-hidden');
  }

  hide() {
    this.element.classList.add('ui-hidden');
    this.actionsEl.innerHTML = ''; // Drops the buttons and their click handlers
  }

  dispose() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
