import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { TwoBoneIK } from '../src/entities/models/TwoBoneIK.js';
import { loadCharacterAsset } from '../tests/support/characterAsset.mjs';

const source = new URL('../../model-audit/mixamo-poses/', import.meta.url);
const out = new URL('../public/assets/animations/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
const sources = fs.readdirSync(source).filter(n => n !== 'reference-ybot.json' && n.endsWith('.json'));
const ids = ['deadpool','ashe','firion','junker-queen','gorr','bob'];
const chains = [
  ['spine','neck'], ['neck','head'],
  ['leftUpperArm','leftForearm'], ['leftForearm','leftHand'],
  ['rightUpperArm','rightForearm'], ['rightForearm','rightHand'],
  ['leftThigh','leftShin'], ['leftShin','leftFoot'],
  ['rightThigh','rightShin'], ['rightShin','rightFoot']
];
for (const id of ids) {
  const { scene } = await loadCharacterAsset(id);
  scene.updateMatrixWorld(true);
  const bones = {};
  scene.traverse(n => { if (n.isBone && n.name.startsWith('SC_')) bones[n.name.slice(3)] = n; });
  const saved = Object.fromEntries(Object.entries(bones).map(([role,b]) => [role, { p:b.position.clone(), q:b.quaternion.clone(), w:b.getWorldQuaternion(new THREE.Quaternion()) }]));
  const ik = new TwoBoneIK(), target = new THREE.Vector3(), direction = new THREE.Vector3();
  const targetBindHipY = bones.hips.getWorldPosition(new THREE.Vector3()).y;
  const q = new THREE.Quaternion(), inverse = new THREE.Quaternion(), parentQ = new THREE.Quaternion();
  const clips = [];
  for (const filename of sources) {
    const motion = JSON.parse(fs.readFileSync(new URL(filename, source)));
    if (!motion.frames.length) continue;
    const tracks = Object.fromEntries(Object.keys(bones).map(role => [role, []]));
    const positions = [];
    const sourceHipY = motion.rest.hips.p[1];
    const ratio = targetBindHipY / sourceHipY;
    for (const frame of motion.frames) {
      for (const [role,b] of Object.entries(bones)) { b.position.copy(saved[role].p); b.quaternion.copy(saved[role].q); }
      scene.updateMatrixWorld(true);
      // World-space body motion, corrected for the source and destination bind frames.
      for (const role of ['hips']) {
        const bone = bones[role];
        if (!bone || !frame[role] || !motion.rest[role]) continue;
        q.fromArray(frame[role].q).multiply(inverse.fromArray(motion.rest[role].q).invert()).multiply(saved[role].w);
        bone.parent.getWorldQuaternion(parentQ).invert();
        bone.quaternion.copy(parentQ.multiply(q));
        bone.updateWorldMatrix(false, true);
      }
      // Retarget anatomical directions, not Euler angles: source/target bone axes and
      // bind arm poses differ between every pack. Preserve each target segment length.
      for (const [a,b] of chains) {
        if (!bones[a] || !bones[b] || !frame[a] || !frame[b]) continue;
        direction.fromArray(frame[b].p).sub(target.fromArray(frame[a].p)).normalize();
        bones[a].getWorldPosition(target).add(direction);
        ik.aim(bones[a], bones[b], target);
      }
      for (const role of ['head','leftHand','rightHand','leftFoot','rightFoot']) {
        const bone=bones[role];
        if (!bone || !frame[role] || !motion.rest[role]) continue;
        q.fromArray(frame[role].q).multiply(inverse.fromArray(motion.rest[role].q).invert()).multiply(saved[role].w);
        bone.parent.getWorldQuaternion(parentQ).invert();
        bone.quaternion.copy(parentQ.multiply(q));
        bone.updateWorldMatrix(false,true);
      }
      const hips = bones.hips;
      let vertical=(frame.hips.p[1]-sourceHipY)*ratio;
      if(filename==='rifle-jump.json') vertical=Math.min(0,vertical);
      const worldDelta = new THREE.Vector3(0, vertical, 0);
      const origin = hips.getWorldPosition(new THREE.Vector3());
      hips.parent.worldToLocal(origin.add(worldDelta));
      hips.position.copy(origin);
      positions.push(...hips.position.toArray());
      for (const [role,b] of Object.entries(bones)) tracks[role].push(...b.quaternion.toArray());
    }
    const times = motion.frames.map((_,i) => i * motion.duration / (motion.frames.length-1));
    const keyframes = Object.entries(tracks).map(([role, values]) => new THREE.QuaternionKeyframeTrack(`SC_${role}.quaternion`, times, values));
    keyframes.push(new THREE.VectorKeyframeTrack('SC_hips.position', times, positions));
    const clip = new THREE.AnimationClip(path.basename(filename,'.json').replace('rifle-',''), motion.duration, keyframes);
    clips.push(THREE.AnimationClip.toJSON(clip.optimize()));
    if (clip.name==='crouch-walk') {
      let best=0, error=Infinity;
      motion.frames.forEach((f,i)=>{
        const e=Math.abs(f.leftFoot.p[1]-f.rightFoot.p[1]);
        if(e<error){error=e;best=i;}
      });
      const held=Object.entries(tracks).map(([role,values])=>new THREE.QuaternionKeyframeTrack(`SC_${role}.quaternion`,[0,1],
        [...values.slice(best*4,best*4+4),...values.slice(best*4,best*4+4)]));
      held.push(new THREE.VectorKeyframeTrack('SC_hips.position',[0,1],
        [...positions.slice(best*3,best*3+3),...positions.slice(best*3,best*3+3)]));
      clips.push(THREE.AnimationClip.toJSON(new THREE.AnimationClip('crouch-idle',1,held)));
    }
  }
  for(const clip of clips) for(const track of clip.tracks){
    track.times=track.times.map(v=>+v.toFixed(6));
    track.values=track.values.map(v=>+v.toFixed(6));
  }
  fs.writeFileSync(new URL(id+'.json', out), JSON.stringify({ version:1, source:'Adobe Mixamo / Y Bot', clips }));
  console.log(id, clips.map(c=>c.name).join(', '));
}
