import * as THREE from 'three';
import config from '../../config.json';
const POWER_COLORS={'deadpool':16729156,'ashe':16762704,'firion':7855615,'junker-queen':16744256,'bob':6747903};

/** Owned by a player/squadmate: gameplay in Phase 5, its single reused effect in Phase 6. */
export class CharacterPower {
  constructor(actor, id) {
    this.actor=actor;
    this.cfg=config.characterPowers[id];
    this.cooldown=0;
    this.remaining=0;
    this.shield=0;
    this.origin=new THREE.Vector3();
    this.direction=new THREE.Vector3();
    this.point=new THREE.Vector3();
    this.ray=null;
    this.material=new THREE.MeshBasicMaterial({color:POWER_COLORS[id],transparent:true,opacity:0.25,
      wireframe:true,depthWrite:false,toneMapped:false});
    this.effect=new THREE.Mesh(new THREE.IcosahedronGeometry(1,1),this.material);
    this.effect.visible=false;
    actor.gameWorld.effectsGroup.add(this.effect);
    this.absorb=amount=>{
      const absorbed=Math.min(amount,this.shield);
      this.shield-=absorbed;
      return amount-absorbed;
    };
    this.releaseAbsorber=actor.health?.addAbsorber(this.absorb);
  }

  activate(target=null) {
    const a=this.actor,c=this.cfg;
    if (this.cooldown>0 || a.isDead || a.health?.isDead || a.isMounted || a.isDevSuspended) return false;
    this.cooldown=c.cooldown;
    this.remaining=c.duration;
    this.shield=c.shield || 0;
    if (c.kind==='shot') this._shot(target);
    if (c.kind==='pulse' || c.kind==='shout') this._pulse();
    if (a.isPlayer) a.gameWorld.ui?.showToast(`${c.name} activated`, 'info', 1800);
    return true;
  }

  update(delta, target=null) {
    this.cooldown=Math.max(0,this.cooldown-delta);
    const alive=!this.actor.isDead && !this.actor.health?.isDead;
    if (!alive) { this.remaining=0; this.shield=0; return; }
    if (this.remaining>0) {
      this.actor.health?.heal((this.cfg.healPerSecond || 0)*Math.min(delta,this.remaining));
      this.remaining=Math.max(0,this.remaining-delta);
      if (!this.remaining) this.shield=0;
    }
    // Companions use their own ability in combat; the player controls theirs with H.
    if (!this.actor.isPlayer && target && !this.cooldown) this.activate(target);
  }

  _startRay() {
    const a=this.actor,p=a.gameWorld.physics;
    this.origin.copy(a.position); this.origin.y+=a.eyeHeight || a.springArm?.eyeHeight || 1.5;
    if (!this.ray) this.ray=new p.RAPIER.Ray({x:0,y:0,z:0},{x:0,y:0,z:0});
    Object.assign(this.ray.origin,this.origin);
    return p;
  }

  _shot(target) {
    const a=this.actor,p=this._startRay();
    if (target) this.direction.copy(target.position).add(new THREE.Vector3(0,1.2,0)).sub(this.origin).normalize();
    else a.gameWorld.camera.getWorldDirection(this.direction);
    Object.assign(this.ray.dir,this.direction);
    const hit=p.castRay(this.ray,this.cfg.range,true,undefined,undefined,a.collider);
    const entity=hit?.collider?.userData?.entity;
    if (entity?.faction && entity.faction!==a.faction) entity.health?.takeDamage({amount:this.cfg.damage,source:a});
    this.point.copy(this.origin).addScaledVector(this.direction,hit?.timeOfImpact ?? this.cfg.range);
    this.effect.position.copy(this.origin).lerp(this.point,0.5);
    this.effect.scale.set(0.06,0.06,this.origin.distanceTo(this.point)*0.5);
    this.effect.lookAt(this.point);
  }

  _pulse() {
    const a=this.actor,c=this.cfg,p=this._startRay();
    for (const enemy of a.gameWorld.entities) {
      if (!enemy.health || enemy.health.isDead || !enemy.faction || enemy.faction===a.faction) continue;
      this.point.copy(enemy.position); this.point.y+=enemy.capsuleCenter || 1;
      this.direction.subVectors(this.point,this.origin);
      const distance=this.direction.length();
      if (distance>c.range || distance<0.001) continue;
      this.direction.divideScalar(distance); Object.assign(this.ray.dir,this.direction);
      const hit=p.castRay(this.ray,distance,true,undefined,undefined,a.collider);
      if (hit && hit.collider?.userData?.entity!==enemy) continue;
      if (c.damage) enemy.health.takeDamage({amount:c.damage,source:a});
      enemy.applyKnockback?.(this.direction,c.knockback);
    }
  }

  lateUpdate() {
    this.effect.visible=this.remaining>0 && !this.actor.isMounted;
    if (!this.effect.visible || this.cfg.kind==='shot') return;
    this.effect.position.copy(this.actor.position); this.effect.position.y+=1;
    const pulse=this.cfg.kind==='pulse' || this.cfg.kind==='shout';
    const radius=pulse ? 1+(this.cfg.range-1)*(1-this.remaining/this.cfg.duration) : 1.2;
    this.effect.scale.setScalar(radius);
  }

  dispose() {
    this.releaseAbsorber?.();
    this.effect.removeFromParent(); this.effect.geometry.dispose(); this.material.dispose();
  }
}
