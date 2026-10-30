import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { loadCharacterAsset } from './support/characterAsset.mjs';
import { CharacterVisual } from '../src/entities/models/CharacterVisual.js';

const ids=['deadpool','ashe','firion','junker-queen','gorr','bob'];
const angle=(v,a,b,c)=>{
  const get=n=>v.joints[n].bone.getWorldPosition(new THREE.Vector3());
  return Math.acos(THREE.MathUtils.clamp(get(b).sub(get(a)).normalize().dot(get(c).sub(get(b)).normalize()),-1,1));
};
for(const id of ids) test(`${id}: recorded walk bends the actual rig and root motion stays with the controller`,async()=>{
  const asset=await loadCharacterAsset(id);
  asset.motion=JSON.parse(fs.readFileSync(new URL(`../public/assets/animations/${id}.json`,import.meta.url)));
  const required=['idle','walk','run','backward','strafe-left','strafe-right','aim','fire','reload','jump','crouch-walk','crouch-idle','pickup'];
  for(const name of required) assert.ok(asset.motion.clips.some(c=>c.name===name),`${name} clip`);
  for(const clip of asset.motion.clips) for(const track of clip.tracks){
    assert.ok(track.values.every(Number.isFinite));
    if(track.name==='SC_hips.position'){
      const hips=asset.scene.getObjectByName('SC_hips');
      hips.parent.updateWorldMatrix(true,false);
      const first=new THREE.Vector3().fromArray(track.values).applyMatrix4(hips.parent.matrixWorld);
      for(let i=3;i<track.values.length;i+=3){
        const p=new THREE.Vector3().fromArray(track.values,i).applyMatrix4(hips.parent.matrixWorld);
        assert.ok(Math.abs(p.x-first.x)<1e-4 && Math.abs(p.z-first.z)<1e-4,'horizontal travel belongs to physics');
      }
    }
  }
  const v=new CharacterVisual(new THREE.Group(),id,{enabled:true,acquireAsset:()=>({promise:Promise.resolve(asset),release(){}})});
  await v.ready;
  assert.ok(v.motion,'recorded clips are active');
  const knees=[];
  for(let i=0;i<120;i++){
    v.animate(1/60,2.2,false);
    v.root.updateWorldMatrix(true,true);
    knees.push(angle(v,'leftThigh','leftShin','leftFoot'));
  }
  assert.equal(v.motion.state,'walk');
  assert.ok(Math.max(...knees)-Math.min(...knees)>0.25,'recorded knee cycle varies');
  const elbow=angle(v,'rightUpperArm','rightForearm','rightHand');
  assert.ok(Number.isFinite(elbow));
  v.motion.update(0.2,0,{reload:0.5});
  assert.equal(v.motion.state,'reload');
  v.motion.update(0.2,0,{pickup:0.5});
  assert.equal(v.motion.state,'pickup');
  v.motion.update(0.2,0,{crouch:1});
  assert.equal(v.motion.state,'crouch-idle');
  v.motion.update(0.2,2,{forward:-2});
  assert.equal(v.motion.state,'backward');
  v.motion.update(0.2,2,{sideways:2,forward:0});
  assert.equal(v.motion.state,'strafe-right');
  for(const j of Object.values(v.joints)) assert.ok([...j.bone.quaternion,...j.bone.position].every(Number.isFinite));
  v.dispose();
});
