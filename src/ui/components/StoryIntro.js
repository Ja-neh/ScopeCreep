
export const LEVEL_OPENINGS = {
  Level01InsideSpaceship: {
    number: 'LEVEL 1', scene: 'breakout', title: 'ESCAPE THE TRANSPORT',
    narration: 'A prisoner breaks out aboard the departing alien ship. The other main characters are still captive.',
    mission: 'Free the remaining main characters, fight through the alien guards, and take control of the ship.'
  },
  Level02: {
    number: 'LEVEL 2', scene: 'beach', title: 'RETAKE THE BEACH',
    narration: 'The crew returns to the occupied island. Alien forces hold the shore and guard a transport.',
    mission: 'Defeat the aliens on the beach, secure their transport, and use it to fly to the village.'
  },
  Level03: {
    number: 'LEVEL 3', scene: 'dome', title: 'THE VILLAGE',
    narration: 'The ship lands near the village. The Warden is protected by a dome powered by three generators.',
    mission: 'Disable every generator, enter the opened dome, defeat the Warden, and free the hostages.'
  }
};

const figure = (kind, index) => `<span class="ui-story-figure ${kind} figure-${index}"><i class="head"></i><i class="torso"></i><i class="arm left"></i><i class="arm right"></i><i class="leg left"></i><i class="leg right"></i></span>`;

/** Animated, skippable campaign prologue and level mission briefing. */
export class StoryIntro {
  constructor(parent) {
    this.element = document.createElement('section');
    this.element.className = 'ui-story-intro ui-hidden';
    this.element.setAttribute('aria-label', 'ScopeCreep opening');
    this.element.innerHTML = `
      <div class="ui-story-stage scene-arrival" aria-hidden="true">
        <div class="ui-story-stars"></div><div class="ui-story-moon"></div>
        <div class="ui-story-ship ship-one"></div><div class="ui-story-ship ship-two"></div><div class="ui-story-ship ship-three"></div>
        <div class="ui-story-island"></div>
        <div class="ui-story-village"><i></i><i></i><i></i><i></i></div>
        <div class="ui-story-beam beam-one"></div><div class="ui-story-beam beam-two"></div>
        <div class="ui-story-people">${Array.from({length:5},(_,i)=>figure('civilian',i)).join('')}</div>
        <div class="ui-story-invaders">${Array.from({length:3},(_,i)=>figure('invader',i)).join('')}</div>
        <div class="ui-story-cage"><i></i><i></i><i></i><i></i><i></i></div>
        <div class="ui-story-carrier"><div class="ui-story-carrier-window"></div><div class="ui-story-prisoners">${Array.from({length:5},(_,i)=>figure('prisoner',i)).join('')}</div><div class="ui-story-cell-bars"></div></div>
        <div class="ui-story-dome"></div><div class="ui-story-generators"><i></i><i></i><i></i></div>
        <div class="ui-story-flash"></div>
      </div>
      <div class="ui-story-vignette"></div>
      <div class="ui-story-card" aria-live="polite">
        <p class="ui-story-kicker"></p><h2 class="ui-story-title"></h2>
        <p class="ui-story-narration"></p><p class="ui-story-mission" hidden></p>
        <p class="ui-story-progress"></p>
        <div class="ui-story-loading" hidden><div class="ui-story-loading-track"><div class="ui-story-loading-fill"></div></div><span class="ui-story-loading-label"></span></div>
        <div class="ui-story-actions"><button type="button" data-action="sound">Enable sound</button><button type="button" data-action="skip">Skip story</button><button type="button" data-action="continue" hidden>Begin level</button></div>
      </div>`;
    this.card=this.element.querySelector('.ui-story-card');
    this.stage=this.element.querySelector('.ui-story-stage');
    this.kicker=this.element.querySelector('.ui-story-kicker');
    this.title=this.element.querySelector('.ui-story-title');
    this.narration=this.element.querySelector('.ui-story-narration');
    this.mission=this.element.querySelector('.ui-story-mission');
    this.progress=this.element.querySelector('.ui-story-progress');
    this.loading=this.element.querySelector('.ui-story-loading');
    this.loadingFill=this.element.querySelector('.ui-story-loading-fill');
    this.loadingLabel=this.element.querySelector('.ui-story-loading-label');
    this.soundButton=this.element.querySelector('[data-action="sound"]');
    this.skipButton=this.element.querySelector('[data-action="skip"]');
    this.continueButton=this.element.querySelector('[data-action="continue"]');
    this.filmControls=document.createElement('div');
    this.filmControls.className='ui-story-film-controls';
    this.filmControls.append(this.soundButton,this.skipButton);
    this.element.append(this.filmControls);
    this.skipButton.addEventListener('click',()=>this.mode==='level' ? this._showMission() : this.finish());
    this.continueButton.addEventListener('click',()=>this.finish());
    this.soundButton.addEventListener('click',()=>{this.onEnableSound?.();this.soundButton.hidden=true;});
    parent.appendChild(this.element);
  }

  attachCinematic(cinematic) { this.cinematic = cinematic; }

  showLoading(label='Preparing the island…') {
    this.finish();
    this.mode='loading';
    this.element.classList.remove('ui-hidden');
    this.element.classList.remove('ui-cinematic');
    this.card.hidden=false;this.stage.hidden=false;this.filmControls.hidden=true;
    this.stage.className='ui-story-stage scene-loading';
    this.kicker.textContent='SCOPECREEP · LOADING';
    this.title.textContent='THE INVASION AWAITS';
    this.narration.textContent='Loading the ship, island, characters, and animations.';
    this.mission.hidden=true;this.progress.textContent='';
    this.loading.hidden=false;this.soundButton.hidden=true;this.skipButton.hidden=true;this.continueButton.hidden=true;
    this.setLoadingProgress(0,label);
  }

  setLoadingProgress(fraction,label) {
    this.loadingFill.style.width=`${Math.round(Math.max(0,Math.min(1,fraction))*100)}%`;
    this.loadingLabel.textContent=`${Math.round(Math.max(0,Math.min(1,fraction))*100)}% · ${label}`;
  }

  showLoadError(message) {
    this.mode='loading-error';
    this.title.textContent='LOAD INTERRUPTED';
    this.narration.textContent=message;
    this.loading.hidden=true;
    this.continueButton.textContent='Retry loading';
    this.continueButton.hidden=false;
    return new Promise(resolve=>{this.resolve=resolve;});
  }

  show(onEnableSound=null) {
    this.finish();
    this.mode='story';this.onEnableSound=onEnableSound;
    this.element.classList.remove('ui-hidden');
    this.element.classList.add('ui-cinematic');
    this.card.hidden=true;this.stage.hidden=true;this.filmControls.hidden=false;
    this.soundButton.hidden=false;this.skipButton.hidden=false;this.skipButton.textContent='Skip story';
    this.continueButton.hidden=true;
    this.cinematic.play({scene:'prologue',duration:32,onFinished:()=>this.finish()});
    return new Promise(resolve=>{this.resolve=resolve;});
  }

  showLevel(levelName) {
    const opening=LEVEL_OPENINGS[levelName];
    if (!opening) return Promise.resolve();
    this.finish();
    this.mode='level';this.opening=opening;
    this.element.classList.remove('ui-hidden');
    this.element.classList.add('ui-cinematic');
    this.card.hidden=true;this.stage.hidden=true;this.filmControls.hidden=false;
    this.kicker.textContent=`${opening.number} · OPENING`;
    this.title.textContent=opening.title;
    this.narration.textContent=opening.narration;
    this.mission.hidden=true;this.loading.hidden=true;
    this.progress.textContent='';
    this.soundButton.hidden=true;this.skipButton.hidden=false;this.skipButton.textContent='Skip animation';
    this.continueButton.textContent='Begin level';this.continueButton.hidden=true;
    this.cinematic.play({scene:opening.scene,duration:5,onFinished:()=>this._showMission()});
    return new Promise(resolve=>{this.resolve=resolve;});
  }

  _showMission() {
    if(this.mode!=='level')return;
    this.cinematic.hold();
    this.element.classList.remove('ui-cinematic');
    this.element.classList.add('ui-mission-briefing');
    this.card.hidden=false;this.stage.hidden=true;this.filmControls.hidden=true;
    this.kicker.textContent=`${this.opening.number} · MISSION`;
    this.title.textContent='YOUR OBJECTIVE';
    this.narration.textContent=this.opening.title;
    this.mission.textContent=this.opening.mission;this.mission.hidden=false;
    this.skipButton.hidden=true;this.continueButton.hidden=false;
    this.continueButton.focus();
  }

  finish() {
    this.cinematic?.stop();
    this.element.classList.remove('ui-mission-briefing');
    this.element.classList.add('ui-hidden');
    const resolve=this.resolve;this.resolve=null;resolve?.();
  }

  dispose(){this.finish();this.element.remove();}
}
