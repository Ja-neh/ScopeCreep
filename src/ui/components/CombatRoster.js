import {Vector3} from 'three';
import {HUMAN_CHARACTERS} from '../../entities/models/CharacterRoster.js';

export class CombatRoster {
  constructor(parent) {
    this.parent=parent;
    this.element=document.createElement('section');this.element.className='ui-combat-roster';
    this.element.setAttribute('aria-label','Squad health');parent.appendChild(this.element);
    this.overhead=document.createElement('div');this.overhead.className='ui-alien-bars';parent.appendChild(this.overhead);
    this.rows=new Map();this.bars=new Map();this.point=new Vector3();this.head=new Vector3();this.seen=new Set();
  }
  update(entities,camera,physics=null) {
    this.seen.clear();
    const now=performance.now();
    for(const actor of entities){
      const id=actor.model?.character?.id;
      if(!actor.health || !id || !actor.position) continue;
      this.seen.add(actor);
      const human=actor.faction==='humans';const entries=human ? this.rows : this.bars;
      let row=entries.get(actor);
      if(!row){
        const el=document.createElement('div');el.className=human ? 'ui-squad-row' : 'ui-alien-bar';
        if(human){
          const img=document.createElement('img');img.src=`${import.meta.env?.BASE_URL || '/'}assets/portraits/${id}.png`;img.alt='';el.appendChild(img);
          const name=document.createElement('span');name.textContent=HUMAN_CHARACTERS.find(c=>c.id===id)?.name || actor.name;el.appendChild(name);
        }
        const meter=document.createElement('progress');meter.max=1;meter.setAttribute('aria-label',`${actor.name} health`);el.appendChild(meter);
        const label=document.createElement('small');el.appendChild(label);
        (human ? this.element : this.overhead).appendChild(el);row={el,meter,label};entries.set(actor,row);
      }
      row.meter.value=actor.health.currentHealth/actor.health.maxHealth;
      row.label.textContent=actor.health.isDead ? `${Math.ceil(actor.reviveSecondsLeft ?? 30)}s` : `${Math.ceil(row.meter.value*100)}%`;
      row.el.classList.toggle('downed',actor.health.isDead);
      if(!human){
        this.head.copy(actor.position);this.head.y+=(actor.eyeHeight || 2)+0.8;
        this.point.copy(this.head).project(camera);
        let visible=!actor.health.isDead && camera.position.distanceToSquared(this.head)<10000 && this.point.z>-1 && this.point.z<1 && Math.abs(this.point.x)<1 && Math.abs(this.point.y)<1;
        if(visible && physics?.isLineClear){
          if(now>=(row.nextVisibility || 0)){row.occluded=!physics.isLineClear(camera.position,this.head,0);row.nextVisibility=now+180;}
          visible=!row.occluded;
        }
        row.el.hidden=!visible;
        if(visible){row.el.style.left=`${(this.point.x+1)*50}%`;row.el.style.top=`${(1-this.point.y)*50}%`;}
      }
    }
    for(const entries of [this.rows,this.bars]) for(const [actor,row] of entries) if(!this.seen.has(actor)){row.el.remove();entries.delete(actor);}
    this.element.hidden=this.rows.size===0;
    this.parent.classList.toggle('ui-roster-active',this.rows.size>0);
  }
  clear(){for(const entries of [this.rows,this.bars]){for(const row of entries.values())row.el.remove();entries.clear();}this.parent.classList.remove('ui-roster-active');}
  dispose(){this.clear();this.element.remove();this.overhead.remove();}
}
