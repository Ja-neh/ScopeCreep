import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import fs from 'node:fs';
import {createTestWorld,stepWorld} from './support/testWorld.mjs';
import {loadCharacterAsset} from './support/characterAsset.mjs';
import {Player} from '../src/entities/Player.js';
import {AlienModel} from '../src/entities/models/AlienModel.js';
import {AlienWarden} from '../src/entities/enemies/AlienWarden.js';
import {AlienTrooper} from '../src/entities/enemies/AlienTrooper.js';
import {HealthComponent} from '../src/entities/components/HealthComponent.js';
import {PlayerShield} from '../src/entities/player-components/PlayerShield.js';
import {CharacterVisual} from '../src/entities/models/CharacterVisual.js';
import {createRifleModel,createWeaponMaterials,disposeModelGeometry} from '../src/weapons/WeaponModels.js';

test('H activates the selected hero ability, heals over time, respects cooldown and cannot revive the dead',async()=>{
 const w=await createTestWorld(),p=new Player(w,{characterId:'deadpool',maxHealth:100});w.addEntity(p);
 p.health.takeDamage({fraction:0.7});w.input.press('characterPower');stepWorld(w,0.1);
 assert.ok(p.power.cooldown>0);assert.equal(p.power.activate(),false);
 stepWorld(w,4.2);assert.equal(Math.round(p.health.currentHealth),86);
 p.health.takeDamage({fraction:1.0});p.power.cooldown=0;assert.equal(p.power.activate(),false);
 w.clearEntities();
});

test('BOB shield absorbs damage and expires, restoring ordinary damage and cleaning its effect',async()=>{
 const w=await createTestWorld(),p=new Player(w,{characterId:'bob',maxHealth:100});w.addEntity(p);
 const effect=p.power.effect;p.power.activate();p.health.takeDamage({fraction:0.6});
 assert.equal(p.health.currentHealth,100);assert.equal(p.power.shield,40);
 p.power.update(6);p.health.takeDamage({fraction:0.2});assert.equal(p.health.currentHealth,80);
 p.dispose();assert.equal(p.health.absorb,null);assert.equal(effect.parent,null);
});

test('hero shield coexists with the village pickup shield and both release their absorption hooks',async()=>{
 const w=await createTestWorld(),p=new Player(w,{characterId:'bob',maxHealth:100});w.addEntity(p);
 const pickup=new PlayerShield(w,{player:p,maxHealth:25});w.addEntity(pickup);pickup.charge();p.power.activate();
 p.health.takeDamage({fraction:0.5});assert.equal(p.health.currentHealth,100);assert.equal(pickup.health,0);assert.equal(p.power.shield,75);
 w.removeEntity(pickup);p.health.takeDamage({fraction:0.25});assert.equal(p.power.shield,50);assert.equal(p.health.currentHealth,100);
 w.clearEntities();assert.equal(p.health._absorbers.size,0);
});

test('Ashe charged shot and Firion pulse damage enemies, stop at cover, and leave allies unharmed',async()=>{
 for(const id of ['ashe','firion']) {
  const w=await createTestWorld(),p=new Player(w,{characterId:id,maxHealth:100});w.addEntity(p);
  w.physics.createGround(100);
  const enemy=new AlienTrooper(w,{position:new THREE.Vector3(0,0,-5),squad:{targets:[],callOut(){}}});w.addEntity(enemy);
  w.physics.step(1/60);const before=enemy.health.currentHealth;
  p.power.activate(enemy);assert.ok(enemy.health.currentHealth<before,id+' damages target');
  assert.equal(p.health.currentHealth,100);
  enemy.health.reset();p.power.cooldown=0;
  const R=w.physics.RAPIER,body=w.physics.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0,1,-2.5));
  w.physics.createCollider(R.ColliderDesc.cuboid(2,2,0.2),body);w.physics.step(1/60);
  p.power.activate(enemy);assert.equal(enemy.health.currentHealth,enemy.health.maxHealth,id+' respects cover');
  w.clearEntities();
 }
});

test('Junker Queen shout grants temporary protection, heals, and knocks nearby enemies back',async()=>{
 const w=await createTestWorld(),p=new Player(w,{characterId:'junker-queen',maxHealth:100});w.addEntity(p);
 const enemy=new AlienTrooper(w,{position:new THREE.Vector3(0,0,-4),squad:{targets:[]}});w.addEntity(enemy);w.physics.step(1/60);
 p.health.takeDamage({fraction:0.5});p.power.activate();assert.ok(enemy._knockback.length()>0);
 p.health.takeDamage({fraction:0.3});assert.equal(p.health.currentHealth,50);
 p.power.update(4);assert.equal(p.health.currentHealth,70);w.clearEntities();
});

for(const id of ['gorr','galiant','bahamut-nt','bahamut-xvi']) test(`${id}: only Gorr holds a visible rifle; flying creature projectiles originate at the head`,async()=>{
 const asset=await loadCharacterAsset(id);
 const m=new AlienModel({characterId:id,characterOptions:{enabled:true,acquireAsset:()=>({promise:Promise.resolve(asset),release(){}})}});
 await m.character.ready;await Promise.resolve();m.animate(0.1,0,false);
 assert.equal(m.gun.visible,id==='gorr');assert.equal(m.hasGun,id==='gorr');
 if(id!=='gorr'){
  assert.equal(m.muzzle.parent,m.character.joints.head.bone);
  const head=m.muzzle.parent.getWorldPosition(new THREE.Vector3()),mouth=m.muzzle.getWorldPosition(new THREE.Vector3());
  assert.ok(head.distanceTo(mouth)<0.3);m.releasePower();m.animate(0.01,0,true);
  assert.equal(m._mouthFlash.visible,id!=='galiant');
 }
 m.dispose();
});

test('winged Warden lifts its physics capsule, flaps wings, then lands to perform ground attacks',async()=>{
 const w=await createTestWorld();w.physics.createGround(100);
 const alien=new AlienWarden(w,{position:new THREE.Vector3(),squad:{targets:[]}});w.addEntity(alien);
 const target={position:new THREE.Vector3(0,0,-20),health:new HealthComponent(100)};
 alien.perception.target=target;alien.brain.change('engage');alien._slamTimer=30;
 for(let i=0;i<180;i++){w.physics.step(1/60);alien.postPhysicsUpdate(1/60);}
 assert.ok(alien.position.y>4,'actual body flies');assert.equal(alien.isFlying,true);
 assert.ok(Math.abs(alien.rigidBody.translation().y-alien.position.y-alien.capsuleCenter)<0.1);
 alien.attackPhase='windup';
 for(let i=0;i<180;i++){w.physics.step(1/60);alien.postPhysicsUpdate(1/60);}
 assert.ok(alien.position.y<0.2,'lands on terrain');assert.equal(alien.isGrounded,true);w.clearEntities();
});

for(const id of ['deadpool','ashe','firion','junker-queen','bob','gorr']) test(`${id}: recorded motion holds both rifle grips and empty hands relax below the ribs`,async()=>{
 const asset=await loadCharacterAsset(id);asset.motion=JSON.parse(fs.readFileSync(new URL(`../public/assets/animations/${id}.json`,import.meta.url)));
 const parent=new THREE.Group();parent.rotation.y=0.6;parent.scale.setScalar(1.25);
 const v=new CharacterVisual(parent,id,{enabled:true,acquireAsset:()=>({promise:Promise.resolve(asset),release(){}})});await v.ready;
 const mats=createWeaponMaterials(),gun=createRifleModel(mats).mesh;parent.add(gun);v.setArmed(true);
 for(let i=0;i<120;i++){
  v.animate(1/60,4.2,i>60);v.fitWeapon(gun,i>60);v.poseWeapon(gun);
  for(const side of ['left','right']){
   const hand=v.joints[side+'Hand'].bone.getWorldPosition(new THREE.Vector3()),grip=gun.localToWorld(gun.userData.grips[side].clone());
   assert.ok(hand.distanceTo(grip)<0.03,`${side} wrist reaches visible gun (${hand.distanceTo(grip)})`);
  }
 }
 v.setArmed(false);v.animate(1/60,0,false);
 for(const side of ['left','right']){
  const hand=v.joints[side+'Hand'].bone.getWorldPosition(new THREE.Vector3()),shoulder=v.joints[side+'UpperArm'].bone.getWorldPosition(new THREE.Vector3());
  assert.ok(hand.y<shoulder.y-0.2,'empty hand hangs naturally');
 }
 v.dispose();disposeModelGeometry(gun);Object.values(mats).forEach(m=>m.dispose());
});
