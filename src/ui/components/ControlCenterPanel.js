export const CONTROL_CENTER_BUTTONS = [
  { label: 'NAVIGATION', color: '#38bdf8' },
  { label: 'WEAPONS', color: '#fb7185' },
  { label: 'DECK ACCESS', color: '#fbbf24' },
  { label: 'LIFE SUPPORT', color: '#34d399' },
  { label: 'COMMUNICATIONS', color: '#a78bfa' },
  { label: 'POWER', color: '#22d3ee' }
];

export class ControlCenterPanel {
  constructor(parent) {
    this.element = document.createElement('section');
    this.element.className = 'ui-control-center ui-hidden';
    this.element.setAttribute('aria-label', 'Spaceship control center');

    const header = document.createElement('div');
    header.className = 'ui-control-center-header';
    const title = document.createElement('strong');
    title.textContent = 'SHIP CONTROL';
    const subtitle = document.createElement('span');
    subtitle.textContent = 'BRIDGE CONSOLE';
    header.append(title, subtitle);

    this.buttons = document.createElement('div');
    this.buttons.className = 'ui-control-center-buttons';

    for (const { label, color } of CONTROL_CENTER_BUTTONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = true;
      button.className = 'ui-control-center-button';
      button.textContent = label;
      button.style.setProperty('--control-button-color', color);
      this.buttons.appendChild(button);
    }

    this.element.append(header, this.buttons);
    parent.appendChild(this.element);
  }

  show() {
    this.element.classList.remove('ui-hidden');
  }

  hide() {
    this.element.classList.add('ui-hidden');
  }

  dispose() {
    this.element.remove();
    this.element = null;
    this.buttons = null;
  }
}
