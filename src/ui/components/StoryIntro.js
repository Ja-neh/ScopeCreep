const CHAPTERS = [
  { title: 'THE ABDUCTION', narration: 'They came to our island at night. The aliens took our people, split them into groups, and prepared to carry them away from Earth.' },
  { title: 'THE ESCAPE', narration: 'I was among the first captives aboard their ship. I broke free, fought the guards, and released the others. Together, we took control.' },
  { title: 'THE RETURN', narration: 'We turned the ship toward home. It came down hard on the island beach. The aliens still occupied our land, but now we had their weapons.' },
  { title: 'THE FIGHT', narration: 'We would fight through their forces, cross the beach, and reach the village where our people were held.' },
  { title: 'OUR HOME', narration: 'Their Warden waited at the heart of the village. We would free the hostages, defeat the invaders, and take back our home.' }
];

/** Opening story cards, shown before the level menu. */
export class StoryIntro {
  constructor(parent) {
    this.element = document.createElement('section');
    this.element.className = 'ui-story-intro ui-hidden';
    this.element.setAttribute('aria-label', 'ScopeCreep story');
    this.element.innerHTML = `<div class="ui-story-card"><p class="ui-story-kicker">SCOPECREEP · THE STORY</p><h2 class="ui-story-title"></h2><p class="ui-story-narration"></p><p class="ui-story-progress"></p><div class="ui-story-actions"><button type="button" data-action="sound">Enable sound</button><button type="button" data-action="skip">Skip story</button></div></div>`;
    this.title = this.element.querySelector('.ui-story-title');
    this.narration = this.element.querySelector('.ui-story-narration');
    this.progress = this.element.querySelector('.ui-story-progress');
    this.soundButton = this.element.querySelector('[data-action="sound"]');
    this.element.querySelector('[data-action="skip"]').addEventListener('click', () => this.finish());
    this.soundButton.addEventListener('click', () => {
      this.onEnableSound?.();
      this.soundButton.hidden = true;
    });
    parent.appendChild(this.element);
  }

  show(onEnableSound = null) {
    this.finish();
    this.element.classList.remove('ui-hidden');
    this.onEnableSound = onEnableSound;
    this.soundButton.hidden = false;
    this.index = 0;
    this._showChapter();
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  _showChapter() {
    const chapter = CHAPTERS[this.index];
    this.title.textContent = chapter.title;
    this.narration.textContent = chapter.narration;
    this.progress.textContent = `${this.index + 1} / ${CHAPTERS.length}`;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (++this.index < CHAPTERS.length) this._showChapter();
      else this.finish();
    }, Math.max(6500, Math.min(14000, chapter.narration.length * 72)));
  }

  finish() {
    clearTimeout(this.timer);
    this.timer = null;
    this.element.classList.add('ui-hidden');
    const resolve = this.resolve;
    this.resolve = null;
    resolve?.();
  }

  dispose() {
    this.finish();
    this.element.remove();
  }
}
