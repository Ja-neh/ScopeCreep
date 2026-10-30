import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HUMAN_CHARACTERS, ALIEN_CHARACTERS, selectCharacter, getSelectedCharacter, squadCharacter } from '../src/entities/models/CharacterRoster.js';
import { Player } from '../src/entities/Player.js';
import { AlienBrute } from '../src/entities/enemies/AlienBrute.js';
import { createTestWorld, stepWorld } from './support/testWorld.mjs';
import { HumanoidAnimationPlayer } from '../src/entities/models/HumanoidAnimationPlayer.js';
import config from '../src/config.json';
afterEach(()=>selectCharacter('deadpool'));

test('human selection excludes Gorr, and squad slots use the remaining human cast',()=>{
  assert.ok(ALIEN_CHARACTERS.includes('gorr'));
  assert.ok(!HUMAN_CHARACTERS.some(c=>c.id==='gorr'));
  for(const character of HUMAN_CHARACTERS){
    assert.equal(selectCharacter(character.id),true);
    assert.equal(getSelectedCharacter(),character.id);
    const crew=['Okafor','Reyes','Novak','Chen'].map(squadCharacter);
    assert.equal(new Set(crew).size,4);
    assert.ok(crew.every(id=>id!=='gorr' && id!==character.id));
  }
  assert.equal(selectCharacter('gorr'),false);
});

test('every selected human becomes the player; the brute uses Gorr on the alien side',async()=>{
  const world=await createTestWorld();
  for(const character of HUMAN_CHARACTERS){
    selectCharacter(character.id);
    const player=new Player(world);
    assert.equal(player.characterId,character.id);
    assert.equal(player.model.character.id,character.id);
    assert.equal(player.faction,'humans');
    player.dispose();
  }
  const brute=new AlienBrute(world,{position:new THREE.Vector3(),squad:{targets:[]}});
  assert.equal(brute.model.character.id,'gorr');
  assert.equal(brute.faction,'aliens');
  brute.dispose();
});

test('normal player input walks at squad pace; Shift sprints and crouching overrides it',async()=>{
  const world=await createTestWorld();
  const player=new Player(world,{canCrouch:true});
  world.addEntity(player);
  world.input.down.add('forward');
  stepWorld(world,0.1);
  assert.equal(Math.hypot(player.velocity.x,player.velocity.z),config.player.locomotion.walkSpeed);
  assert.equal(player.isSprinting,false);
  world.input.down.add('sprint');
  stepWorld(world,0.1);
  assert.equal(Math.hypot(player.velocity.x,player.velocity.z),config.player.locomotion.sprintSpeed);
  assert.equal(player.isSprinting,true);
  world.input.down.add('crouch');
  stepWorld(world,0.1);
  assert.equal(Math.hypot(player.velocity.x,player.velocity.z),config.player.locomotion.crouchSpeed);
  assert.equal(player.isSprinting,false);
  world.clearEntities();
});

test('the player walk/run animation follows sprint intent rather than an absolute speed threshold',()=>{
  const clips=['idle','walk','run'].map(name=>THREE.AnimationClip.toJSON(new THREE.AnimationClip(name,1,[])));
  const motion=new HumanoidAnimationPlayer(new THREE.Group(),{clips});
  motion.update(1/60,8,{sprinting:false});
  assert.equal(motion.state,'walk');
  motion.update(1/60,3,{sprinting:true});
  assert.equal(motion.state,'run');
  motion.update(1/60,0,{sprinting:true});
  assert.equal(motion.state,'idle');
  motion.dispose();
});
