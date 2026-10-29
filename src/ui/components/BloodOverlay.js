/** Pooled CSS splashes; only Level 2 requests this overlay. */
export class BloodOverlay {
  constructor(parent) {
    this.cursor = 0;
    this.elements = Array.from({ length: 4 }, () => {
      const element = document.createElement('div');
      element.className = 'ui-blood-splash';
      element.setAttribute('aria-hidden', 'true');
      parent.appendChild(element);
      return element;
    });
  }
  flash(side) {
    const element = this.elements[this.cursor++ % this.elements.length];
    element.className = 'ui-blood-splash';
    void element.offsetWidth; // Restart just this pooled splash on repeated hits.
    element.classList.add('active', `blood-${side}`);
  }
  clear() { this.elements.forEach(element => { element.className = 'ui-blood-splash'; }); }
  dispose() { this.elements.forEach(element => element.remove()); this.elements.length = 0; }
}
