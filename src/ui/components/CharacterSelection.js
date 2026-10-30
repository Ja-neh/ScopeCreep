import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CharacterVisual } from '../../entities/models/CharacterVisual.js';
import { HUMAN_CHARACTERS, getSelectedCharacter, selectCharacter } from '../../entities/models/CharacterRoster.js';
import config from '../../config.json';

export function describePower(id) {
  const p=config.characterPowers[id];
  switch(p.kind) {
    case 'heal': return `Regenerate ${p.healPerSecond} health each second for ${p.duration} seconds.`;
    case 'shot': return `Release a charged shot dealing ${p.damage} damage, up to ${p.range} metres away.`;
    case 'pulse': return `Strike nearby enemies with a blade pulse: ${p.damage} damage within ${p.range} metres.`;
    case 'shout': return `Rally with ${p.shield} protection and ${p.healPerSecond} health per second for ${p.duration} seconds. Push back enemies within ${p.range} metres.`;
    case 'shield': return `Raise a shield absorbing ${p.shield} damage for ${p.duration} seconds.`;
    default: return p.name;
  }
}

/** One live model at a time; all preview GPU resources are released on leaving. */
export class CharacterSelection {
  constructor(parent,onClose) {
    this.onClose=onClose;this.generation=0;this.cards=new Map();
    this.element=document.createElement('section');
    this.element.className='ui-character-screen ui-hidden';
    this.element.setAttribute('aria-label','Choose Characters');
    this.element.innerHTML=`
      <header class="ui-character-header">
        <button type="button" class="ui-character-back">← Main Menu</button>
        <div><p class="ui-character-eyebrow">SCOPE CREEP / SQUAD ROSTER</p><h1>Choose Characters</h1></div>
      </header>
      <div class="ui-character-workspace">
        <div class="ui-character-preview">
          <div class="ui-character-canvas"></div>
          <p class="ui-character-load" role="status"></p>
          <p class="ui-character-orbit">Drag to rotate · Scroll to zoom</p>
        </div>
        <aside class="ui-character-details">
          <p class="ui-character-eyebrow">MAIN CHARACTER</p>
          <h2></h2><p class="ui-character-role">Your weapons. Your power. Your squad.</p>
          <div class="ui-character-power"><span>SPECIAL POWER</span><h3></h3><p></p>
            <div class="ui-character-power-meta"></div>
          </div>
          <button type="button" class="ui-character-confirm">Choose Character</button>
        </aside>
      </div>
      <nav class="ui-character-cards" aria-label="Main characters"></nav>`;
    parent.appendChild(this.element);
    this.viewport=this.element.querySelector('.ui-character-canvas');
    this.status=this.element.querySelector('.ui-character-load');
    this.back=this.element.querySelector('.ui-character-back');
    this.confirm=this.element.querySelector('.ui-character-confirm');
    this.back.addEventListener('click',()=>this._close());
    this.confirm.addEventListener('click',()=>{selectCharacter(this.characterId);this._close();});
    for(const character of HUMAN_CHARACTERS) {
      const button=document.createElement('button');button.type='button';
      button.className='ui-character-card';button.setAttribute('aria-pressed','false');
      const image=document.createElement('img');image.alt='';
      image.src=`${import.meta.env?.BASE_URL || '/'}assets/portraits/${character.id}.png`;
      const label=document.createElement('span');label.textContent=character.name;
      const power=document.createElement('small');power.textContent=config.characterPowers[character.id].name;
      button.append(image,label,power);
      button.addEventListener('click',()=>this._choose(character.id));
      this.element.querySelector('.ui-character-cards').appendChild(button);
      this.cards.set(character.id,button);
    }
    this.element.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.stopPropagation();this._close();}
      if((event.key==='ArrowRight' || event.key==='ArrowLeft') && this.cards.has(this.characterId)) {
        event.preventDefault();
        const index=HUMAN_CHARACTERS.findIndex(c=>c.id===this.characterId);
        const next=HUMAN_CHARACTERS[(index+(event.key==='ArrowRight'?1:-1)+HUMAN_CHARACTERS.length)%HUMAN_CHARACTERS.length];
        this._choose(next.id);this.cards.get(next.id).focus();
      }
    });
  }

  show() {
    this.element.classList.remove('ui-hidden');this.active=true;
    try {this._createStage();this._choose(getSelectedCharacter());}
    catch(error) {
      console.warn('Character preview unavailable',error);
      this._choose(getSelectedCharacter());
      this.status.textContent='3D preview unavailable. You can still choose your character below.';
    }
    this.back.focus();
  }

  _choose(id) {
    this.characterId=id;
    const character=HUMAN_CHARACTERS.find(c=>c.id===id),power=config.characterPowers[id];
    this.element.querySelector('h2').textContent=character.name;
    this.element.querySelector('.ui-character-power h3').textContent=power.name;
    this.element.querySelector('.ui-character-power p').textContent=describePower(id);
    this.element.querySelector('.ui-character-power-meta').textContent=`Press H to activate · ${power.cooldown}s cooldown`;
    this.confirm.textContent=`Choose ${character.name}`;
    for(const [key,card] of this.cards)card.setAttribute('aria-pressed',String(key===id));
    const generation=++this.generation;
    this.model?.dispose();this.anchor?.clear();this.model=null;
    if(!this.renderer || !this.anchor)return;
    this.status.textContent=`Loading ${character.name}…`;
    this.model=new CharacterVisual(this.anchor,id,{height:2});
    this.model.setArmed(false);
    this.model.ready.then(loaded=>{
      if(!this.active || generation!==this.generation)return;
      this.status.textContent=loaded ? '' : 'Model could not load. Select another character or try again.';
    });
  }

  _createStage() {
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,1.5));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.3;
    this.renderer.domElement.setAttribute('aria-label','Interactive 3D character preview');
    this.viewport.appendChild(this.renderer.domElement);
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x101e2b);
    this.camera=new THREE.PerspectiveCamera(33,1,.1,40);
    this.camera.position.set(0,1.2,5.1);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.target.set(0,1,0);this.controls.enablePan=false;
    this.controls.minDistance=2.8;this.controls.maxDistance=7;
    this.controls.minPolarAngle=.45;this.controls.maxPolarAngle=Math.PI/2+.12;
    this.controls.enableDamping=true;
    this.controls.autoRotate=!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.controls.autoRotateSpeed=.65;this.controls.update();
    this.scene.add(new THREE.HemisphereLight(0xe1f3ff,0x405466,3));
    const key=new THREE.DirectionalLight(0xffecd5,4);key.position.set(3,5,4);this.scene.add(key);
    const rim=new THREE.DirectionalLight(0x77d9ff,3);rim.position.set(-3,3,-2);this.scene.add(rim);
    this.anchor=new THREE.Group();this.anchor.rotation.y=Math.PI;this.scene.add(this.anchor);
    const plinth=new THREE.Mesh(new THREE.CylinderGeometry(.94,1.04,.12,64),
      new THREE.MeshStandardMaterial({color:0x263d50,metalness:.55,roughness:.4}));
    plinth.position.y=-.065;this.scene.add(plinth);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.97,.012,8,96),new THREE.MeshBasicMaterial({color:0x7ce7d5}));
    ring.rotation.x=Math.PI/2;ring.position.y=.002;this.scene.add(ring);
    this.stageObjects=[plinth,ring];
    this.resizeObserver=new ResizeObserver(()=>this._resize());this.resizeObserver.observe(this.viewport);this._resize();
    this.lastTime=null;
    const frame=time=>{
      if(!this.active)return;
      const delta=this.lastTime===null?0:Math.min((time-this.lastTime)/1000,.05);this.lastTime=time;
      this.model?.animate(delta,0,false);this.controls.update(delta);
      this.renderer.render(this.scene,this.camera);this.frame=requestAnimationFrame(frame);
    };
    this.frame=requestAnimationFrame(frame);
  }

  _resize() {
    if(!this.renderer)return;
    const width=Math.max(1,this.viewport.clientWidth),height=Math.max(1,this.viewport.clientHeight);
    this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
  }

  _close(){this.hide();this.onClose();}
  hide() {
    this.active=false;this.generation++;this.element.classList.add('ui-hidden');
    cancelAnimationFrame(this.frame);this.resizeObserver?.disconnect();this.controls?.dispose();
    this.model?.dispose();this.model=null;
    for(const mesh of this.stageObjects || []){mesh.geometry.dispose();mesh.material.dispose();}
    this.stageObjects=[];this.anchor=null;this.scene=null;
    if(this.renderer){this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();this.renderer=null;}
  }
  dispose(){this.hide();this.element.remove();}
}
