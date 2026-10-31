import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld } from './support/testWorld.mjs';
import { Player } from '../src/entities/Player.js';
import { IslandLevel } from '../src/levels/IslandLevel.js';
import { Level02 } from '../src/levels/Level02.js';
import { Level03 } from '../src/levels/Level03.js';
import { LandingZone } from '../src/levels/level02/LandingZone.js';

test('reviving a dead, frozen player clears blockers and restores movement',async()=>{
  const world=await createTestWorld();const player=new Player(world,{maxHealth:100});world.addEntity(player);
  player.die();player.setFrozen(true);player.isDevSuspended=true;player.health.reset();
  const level={player,gameWorld:world,_shouldStaySuspended:()=>false,
    _setPlayerDownPose:IslandLevel.prototype._setPlayerDownPose};
  IslandLevel.prototype._playerGetsUp.call(level);
  assert.equal(player.isDead,false);assert.equal(player.isFrozen,false);assert.equal(player.isDevSuspended,false);
  world.input.down.add('forward');stepWorld(world,.1);
  assert.ok(Math.hypot(player.velocity.x,player.velocity.z)>0);
  world.clearEntities();
});

test('the beach arrival uses an alien carrier without battleship or helicopter colliders',async()=>{
  const world=await createTestWorld();const zone=new LandingZone(world,{heightAt:()=>2});
  await zone.build();assert.equal(zone.ship.mesh.name,'Alien transport saucer');
  assert.equal(zone.helicopters.length,0);assert.equal(zone.colliders.length,0);
  assert.ok(zone.gangway.top.z>zone.gangway.foot.z);zone.dispose();world.clearEntities();
});

test('the beach ending requests Level 3 automatically exactly once',()=>{
  const calls=[];const level={state:'ending',beacon:{update(){}},_gateEntryFade:.1,_chained:false,
    gameWorld:{loadLevel:(next,options)=>calls.push({next,options})},_nextLevel:()=>({name:'village'})};
  Level02.prototype._updateScenario.call(level,.2);Level02.prototype._updateScenario.call(level,.2);
  assert.equal(calls.length,1);assert.equal(calls[0].options.automatic,true);
});

test('ten normal village aliens retain their slots and add five flyers',()=>{
  const level={cfg:{maxAliveAliens:22},squad:{members:[]},player:{position:new THREE.Vector3()}};
  level.createAlien=(type,x,z)=>{const a={type,position:{x,z},assault(){}};level.squad.members.push(a);return a;};
  for(let i=0;i<10;i++)Level03.prototype._addFlyingReinforcement.call(level,level.createAlien('trooper',i,0));
  assert.equal(level.squad.members.filter(a=>!a.isExtraFlyer).length,10);
  assert.equal(level.squad.members.filter(a=>a.isExtraFlyer).length,5);
});
