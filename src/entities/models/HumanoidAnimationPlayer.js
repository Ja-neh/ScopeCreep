import * as THREE from 'three';

/** Recorded Mixamo motion retargeted offline to this exact skeleton. */
export class HumanoidAnimationPlayer {
  constructor(root, data) {
    this.root=root;
    this.mixer=new THREE.AnimationMixer(root);
    this.actions={};
    this.time=0;
    this.shotTime=0;
    for (const json of data.clips) {
      const clip=THREE.AnimationClip.parse(json);
      this.actions[clip.name]=this.mixer.clipAction(clip).play().setEffectiveWeight(0);
    }
    this.current=null;
  }

  update(delta, speed, { crouch=0, airborne=false, forward=1, sideways=0, reload=1, pickup=-1, aiming=false, grenade=-1, sprinting=null }={}) {
    this.time+=delta;
    this.shotTime=Math.max(0,this.shotTime-delta);
    const running=sprinting === null ? speed>=4 : sprinting;
    let state=speed<0.15 ? 'idle' : running ? 'run' : 'walk';
    if (forward < -0.3 && speed>0.15) state=running?'backward-run':'backward';
    if (Math.abs(sideways)>Math.abs(forward)*1.3 && speed>0.15) state=sideways>0 ? 'strafe-right' : 'strafe-left';
    if (crouch>0.5) state=speed>0.15 ? 'crouch-walk' : 'crouch-idle';
    if (aiming && speed<0.15 && crouch<0.5) state='aim';
    if (airborne) state='jump';
    if (reload<1) state='reload';
    if (grenade>=0) state='grenade';
    if (pickup>=0) state='pickup';
    if (this.shotTime>0 && speed<0.15 && reload===1) state='fire';
    const next=this.actions[state] || this.actions[speed>0.15?'walk':'idle'];
    if (!next) return;
    if (next!==this.current) {
      const previous=this.current;
      next.reset().setEffectiveWeight(1).play();
      // Keep feet in phase across locomotion transitions, with a short crossfade.
      if (previous && ['walk','run','backward','strafe-left','strafe-right'].includes(state)) {
        next.time=(previous.time/previous.getClip().duration % 1)*next.getClip().duration;
      }
      if (previous) previous.crossFadeTo(next,0.18,false);
      if (state==='jump') { next.setLoop(THREE.LoopOnce,1); next.clampWhenFinished=true; }
      this.current=next;
      this.state=state;
    }
    const duration=next.getClip().duration;
    next.paused=state==='reload'||state==='pickup'||state==='grenade';
    if (state==='reload') next.time=THREE.MathUtils.clamp(reload,0,0.999)*duration;
    else if (state==='pickup') next.time=THREE.MathUtils.clamp(pickup,0,0.999)*duration;
    else if (state==='grenade') next.time=THREE.MathUtils.clamp(grenade,0,0.999)*duration;
    else next.setEffectiveTimeScale(['walk','run','backward','backward-run','strafe-left','strafe-right','crouch-walk'].includes(state)
      ? THREE.MathUtils.clamp(speed/(state==='run'||state==='backward-run'?5:state==='crouch-walk'?1.3:2.2),0.65,1.6) : 1);
    this.mixer.update(delta);
  }

  fire() { this.shotTime=this.actions.fire?.getClip().duration || 0.25; }
  reset() {
    for(const action of Object.values(this.actions)) action.stop().reset().setEffectiveWeight(0).play();
    this.current=null;this.shotTime=0;
  }
  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root); }
}
