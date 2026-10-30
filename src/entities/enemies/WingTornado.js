import * as THREE from 'three';
import config from '../../config.json';

class Spiral extends THREE.Curve {
  getPoint(t,out=new THREE.Vector3()){
    const a=t*Math.PI*14,r=0.2+t*2.2;
    return out.set(Math.cos(a)*r,t*7,Math.sin(a)*r);
  }
}
/** Two reused wing vortices; attacks are evaluated once per victim per vortex. */
export class WingTornado {
  constructor(owner){
    this.owner=owner;this.cfg=config.bossPowers;
    this.geometry=new THREE.TubeGeometry(new Spiral(),96,0.12,4,false);
    this.material=new THREE.MeshBasicMaterial({color:0xccecff,transparent:true,opacity:0.65,depthWrite:false});
    this.vortices=[-1,1].map(side=>{
      const mesh=new THREE.Mesh(this.geometry,this.material);mesh.visible=false;owner.gameWorld.effectsGroup.add(mesh);
      return {side,mesh,position:new THREE.Vector3(),direction:new THREE.Vector3(),life:0,hit:new Set()};
    });
    this.push=new THREE.Vector3();
  }
  fire(target){
    for(const v of this.vortices){
      const joint=this.owner.model.character.joints[v.side<0 ? 'leftWing' : 'rightWing'];
      if(joint)joint.bone.getWorldPosition(v.position);
      else v.position.copy(this.owner.position).add(new THREE.Vector3(v.side*3,2,0));
      v.targetY=target.position.y;
      v.direction.copy(target.position).sub(v.position).setY(0).normalize();
      v.life=this.cfg.tornadoLifetime;v.hit.clear();
    }
    this.owner.gameWorld.ui?.showToast('WING TORNADO — move aside!', 'warning',1800);
  }
  update(delta){
    if(this.owner.isDead){for(const v of this.vortices)v.life=0;return;}
    for(const v of this.vortices){
      if(v.life<=0)continue;v.life=Math.max(0,v.life-delta);
      v.position.addScaledVector(v.direction,this.cfg.tornadoSpeed*delta);
      v.position.y=THREE.MathUtils.damp(v.position.y,v.targetY,4,delta);
      for(const target of this.owner.squad?.targets || []){
        if(!target.health || target.health.isDead || v.hit.has(target))continue;
        if(Math.hypot(target.position.x-v.position.x,target.position.z-v.position.z)>this.cfg.tornadoRadius ||
          Math.abs(target.position.y-v.position.y)>7)continue;
        v.hit.add(target);target.health.takeDamage({fraction:this.cfg.tornadoFraction,source:this.owner});
        this.push.copy(v.direction);target.applyKnockback?.(this.push,this.cfg.tornadoKnockback);
      }
    }
  }
  lateUpdate(delta){for(const v of this.vortices){v.mesh.visible=v.life>0 && !this.owner.isDead;v.mesh.position.copy(v.position);v.mesh.rotation.y+=delta*7;}}
  dispose(){for(const v of this.vortices)v.mesh.removeFromParent();this.geometry.dispose();this.material.dispose();}
}
