import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {createTestWorld,stepWorld} from './support/testWorld.mjs';
import {loadCharacterAsset} from './support/characterAsset.mjs';
import {CharacterVisual} from '../src/entities/models/CharacterVisual.js';
import {AlienTrooper} from '../src/entities/enemies/AlienTrooper.js';
import {AlienSniper} from '../src/entities/enemies/AlienSniper.js';
import {SquadMate} from '../src/entities/allies/SquadMate.js';
import {Player} from '../src/entities/Player.js';
import {HumanSquad} from '../src/ai/HumanSquad.js';
import {Level03} from '../src/levels/Level03.js';

test('the complete boss has a substantial torso and head while preserving the original wingspan',async()=>{
 const asset=await loadCharacterAsset('bahamut-xvi'),{scene}=asset;scene.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(scene),size=bounds.getSize(new THREE.Vector3());
 const left=scene.getObjectByName('SC_leftWing').getWorldPosition(new THREE.Vector3());
 const right=scene.getObjectByName('SC_rightWing').getWorldPosition(new THREE.Vector3());
 const neck=scene.getObjectByName('SC_neck').getWorldPosition(new THREE.Vector3());
 assert.ok(left.distanceTo(neck)<.13 && right.distanceTo(neck)<.13,'both hinges attach at the enlarged upper shoulders');
 for(const extent of [bounds.max.x-left.x,right.x-bounds.min.x]) {
  assert.ok(extent>1.8 && extent<1.9,`original wing dimensions preserved (${extent})`);
 }
 let referenceHeight=0;scene.traverse(n=>{referenceHeight=n.userData.scopeCreepReferenceHeight || referenceHeight;});
 assert.ok(referenceHeight>1.7 && referenceHeight<1.9,'original normalization height is preserved');
 const visual=new CharacterVisual(new THREE.Group(),'bahamut-xvi',{height:2,enabled:true,
  acquireAsset:()=>({promise:Promise.resolve(asset),release(){}})});
 await visual.ready;
 assert.ok(Math.abs(visual.root.scale.y-2/referenceHeight)<1e-6,'moving shoulders does not rescale the wings');
 visual.dispose();
 const head=scene.getObjectByName('SC_head').getWorldPosition(new THREE.Vector3());
 const hip=scene.getObjectByName('SC_hips').getWorldPosition(new THREE.Vector3());
 assert.ok(head.distanceTo(hip)/size.x>.07,'enlarged body relative to wings');
 const mesh=scene.getObjectByProperty('isSkinnedMesh',true);
 assert.ok(mesh.geometry.index.count/3<=20000,'full boss stays within the existing triangle budget');
});

test('each downed member has 30 seconds for rescue; expiration restores checkpoint, full health and ammo without shield',async()=>{
 const w=await createTestWorld(),level=new Level03(w);await level.init();level.cinematic?.finish();level.clearAliens();
 level.allies.reviveSearchRadius=0;
 const [mate]=level.allies.mates,player=level.player;
 level.weapons.rifle.ammo=1;level.weapons.rifle.reserve=0;mate.weapon.ammo=0;
 player.power.shield=20;level.shield.charge();
 player.health.takeDamage({amount:10000});mate.health.takeDamage({amount:10000});
 stepWorld(w,29,{level});
 assert.equal(player.health.isDead,true);assert.equal(mate.isDead,true);
 assert.ok(player.reviveSecondsLeft>0 && player.reviveSecondsLeft<2);
 stepWorld(w,1.2,{level});
 for(const member of [player,mate])assert.equal(member.health.currentHealth,member.health.maxHealth);
 assert.equal(level.weapons.rifle.ammo,75);assert.equal(level.weapons.rifle.reserve,225);
 assert.equal(mate.weapon.ammo,mate.weapon.magazineSize);
 assert.equal(level.shield.health,0);assert.equal(player.power.shield,0);
 assert.ok(player.position.distanceTo(level._checkpoint)<1);
 // A teammate may rescue immediately, without waiting for expiration.
 mate.health.takeDamage({amount:10000});level.allies.update(0.01);
 level.allies.reviveMember(mate,player);
 assert.equal(mate.isDead,false);assert.equal(mate.health.currentHealth,mate.health.maxHealth);
 assert.equal(mate.weapon.ammo,mate.weapon.magazineSize);
 assert.ok(!w.ui.callsTo('showToast').some(c=>/Okafor|Reyes|Novak|Chen/.test(c.args[0])));
 level.dispose();w.clearEntities();
});

test('red and black aliens strafe with eyes on their opponent and dodge damage with a cooldown',async()=>{
 const w=await createTestWorld();w.physics.createGround(100);w.physics.step(1/60);
 const target={position:new THREE.Vector3(0,0,-20)};
 for(const Type of [AlienTrooper,AlienSniper]){
  const alien=new Type(w,{position:new THREE.Vector3(0,.02,0),squad:{targets:[],callOut(){}}});
  alien.perception.target=target;alien.brain.change('engage');alien._updateTactics(1/60);
  assert.ok(Math.abs(alien.moveTarget.x)>2,'lateral firing angle');
  assert.ok(alien.faceTarget.equals(target.position));
  alien._tacticalActive=0;alien.onDamaged({source:target});alien._updateTactics(1/60);
  assert.equal(alien._dodging,true);assert.ok(alien.moveSpeed>alien.cfg.runSpeed);
  assert.ok(alien._dodgeCooldown>0);
  alien.dispose();
 }
});

test('crowded allies cannot step onto friendly capsules, and foot IK ignores characters as support',async()=>{
 const w=await createTestWorld();w.physics.createGround(100);
 const leader=new Player(w,{position:new THREE.Vector3(0,.02,0),maxHealth:100});w.addEntity(leader);
 const squad=new HumanSquad(w,{leader});
 const mate=squad.add(new SquadMate(w,{name:'Mate',position:new THREE.Vector3(.05,.02,.05),squad}));
 // Deliberately overlap capsules, the failure case for autostep and foot probes.
 let high=0;stepWorld(w,2,{onFrame:()=>high=Math.max(high,mate.position.y)});
 assert.ok(high<.08,`no capsule climbing (${high})`);
 const asset=await loadCharacterAsset('ashe');
 asset.motion=JSON.parse(fs.readFileSync(new URL('../public/assets/animations/ashe.json',import.meta.url)));
 const visual=new CharacterVisual(mate.mesh,'ashe',{enabled:true,acquireAsset:()=>({promise:Promise.resolve(asset),release(){}})});
 await visual.ready;visual.setActor(mate);mate.isGrounded=true;
 const cast=w.physics.castRay.bind(w.physics);let filtered=0;
 w.physics.castRay=(...args)=>{
  const predicate=args[7];if(predicate){assert.equal(predicate(leader.collider),false);filtered++;}
  return cast(...args);
 };
 const hip=visual.joints.hips.bone,p=new THREE.Vector3();let previous=null,maxJump=0;
 for(let i=0;i<240;i++){
  visual.animate(1/60,i<80?0:i<160?2.2:5,true);visual.group.updateWorldMatrix(true,true);
  hip.getWorldPosition(p);if(previous!==null)maxJump=Math.max(maxJump,Math.abs(p.y-previous));previous=p.y;
 }
 assert.ok(filtered>400);assert.ok(maxJump<.045,`no abrupt skinned hip bounce (${maxJump})`);
 visual.dispose();squad.dispose();w.clearEntities();
});
