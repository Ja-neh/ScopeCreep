import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTestWorld,stepWorld,bodyCount} from './support/testWorld.mjs';
import {Player} from '../src/entities/Player.js';
import {ForceFieldDome} from '../src/levels/level03/ForceFieldDome.js';

test('sustained walking and sprinting cannot auto-step up a force field; collapsing clears its collider',async()=>{
 const w=await createTestWorld();w.physics.createGround(100);
 const dome=new ForceFieldDome(w,{centre:new THREE.Vector3(),radius:22});dome.build();
 const p=new Player(w,{position:new THREE.Vector3(0,0.05,25),snapToGround:true});w.addEntity(p);
 for(const sprint of [false,true]){
  p.teleport(0,0.05,25);w.input.hold('forward');if(sprint)w.input.hold('sprint');
  stepWorld(w,20);assert.ok(p.position.z>=21.5,`stays outside at ${p.position.z}`);
  assert.ok(p.position.y<0.2,`does not climb at ${p.position.y}`);w.input.release('sprint');
 }
 const before=bodyCount(w);dome.collapse({instant:true});assert.equal(bodyCount(w),before-1);
 p.teleport(0,0.05,25);stepWorld(w,3);assert.ok(p.position.z<21,'can cross the collapsed field');
 dome.dispose();w.clearEntities();
});
