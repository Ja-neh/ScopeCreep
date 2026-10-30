import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import config from '../src/config.json';
import {HealthComponent} from '../src/entities/components/HealthComponent.js';
import {Player} from '../src/entities/Player.js';
import {SquadMate} from '../src/entities/allies/SquadMate.js';
import {AlienBrute} from '../src/entities/enemies/AlienBrute.js';
import {AlienTrooper} from '../src/entities/enemies/AlienTrooper.js';
import {AlienSniper} from '../src/entities/enemies/AlienSniper.js';
import {IslandLevel} from '../src/levels/IslandLevel.js';
import {AlienModel} from '../src/entities/models/AlienModel.js';
import {ProjectilePool} from '../src/entities/ProjectilePool.js';
import {WeaponController} from '../src/weapons/WeaponController.js';
import {BossArena} from '../src/levels/level03/BossArena.js';
import {AlienSquad} from '../src/ai/AlienSquad.js';
import {HumanSquad} from '../src/ai/HumanSquad.js';
import {WingTornado} from '../src/entities/enemies/WingTornado.js';
import {createTestWorld,stepWorld} from './support/testWorld.mjs';

test('humans take 30% less ordinary damage; explicit percentages are final maximum-health fractions',async()=>{
 const w=await createTestWorld(),p=new Player(w,{maxHealth:200});
 p.health.takeDamage(100);assert.equal(p.health.currentHealth,130);
 p.health.reset();p.health.takeDamage({fraction:0.1});assert.equal(p.health.currentHealth,180);
 p.dispose();
});

test('all five heroes keep independent identities, powers and cooldowns while armed',async()=>{
 const w=await createTestWorld();const leader=new Player(w,{characterId:'firion',maxHealth:100});w.addEntity(leader);
 const squad=new HumanSquad(w,{leader});
 const heroes=[leader];for(let i=0;i<4;i++){
  const mate=new SquadMate(w,{name:`Assistant ${i}`,position:new THREE.Vector3(i*2,0,0),squad});squad.add(mate);heroes.push(mate);
 }
 assert.equal(new Set(heroes.map(h=>h.model.character.id)).size,5);
 assert.equal(new Set(heroes.map(h=>h.power.cfg.name)).size,5);
 heroes[0].power.activate();assert.equal(heroes[1].power.cooldown,0);
 assert.ok(heroes.slice(1).every(h=>h.model.gun.visible));squad.dispose();w.clearEntities();
});

test('a loaded rifle plus reserve totals 300; firing and reloading never create ammunition',async()=>{
 const w=await createTestWorld(),p=new Player(w),weapon=new WeaponController(w,p);
 assert.equal(weapon.rifle.ammo,75);assert.equal(weapon.rifle.reserve,225);
 weapon.rifle.ammo-=30;const total=weapon.rifle.ammo+weapon.rifle.reserve;
 weapon.rifle.startReload();weapon.rifle.update(config.weapons.machineGun.reloadSeconds+0.1);
 assert.equal(weapon.rifle.ammo,75);assert.equal(weapon.rifle.ammo+weapon.rifle.reserve,total);
 weapon.dispose();p.dispose();
});

test('simultaneous slime, fire and bullets keep distinct visuals and percentage damage in the pool',async()=>{
 const w=await createTestWorld(),pool=new ProjectilePool(w);w.addEntity(pool);
 const shots=['slime','fire','bullet'].map((attack,i)=>pool.firePlasma({origin:new THREE.Vector3(0,2,i),direction:new THREE.Vector3(0,0,-1),attack,fraction:[.1,.175,.04][i]}));
 assert.equal(new Set(shots.map(p=>p.mesh.material.color.getHex())).size,3);
 for(let i=0;i<shots.length;i++)assert.equal(shots[i].damageInfo.fraction,[.1,.175,.04][i]);
 w.clearEntities();
});

test('Gorr sword deals 25% final health damage; only black and white winged aliens can fly',async()=>{
 const w=await createTestWorld(),gorr=new AlienBrute(w,{position:new THREE.Vector3(),squad:{targets:[]}});
 const target={position:new THREE.Vector3(0,0,1),health:new HealthComponent(200)};target.health.damageMultiplier=.7;
 gorr._slam(target);assert.equal(target.health.currentHealth,150);
 for(const id of ['galiant','bahamut-nt','bahamut-xvi']){const m=new AlienModel({characterId:id});assert.equal(m.canFly,id!=='galiant');assert.equal(m.hasGun,false);m.dispose();}
 gorr.dispose();
});

test('boss resurrection takes at most ten dead aliens per cast and places them inside the hall',async()=>{
 const w=await createTestWorld(),squad=new AlienSquad(w,{targets:[],alertRadius:50,corpseSeconds:8});
 const created=[];const level={gameWorld:w,squad,player:{position:new THREE.Vector3()},createAlien(type,x,z,y){const a=new AlienTrooper(w,{position:new THREE.Vector3(x,y,z),squad});created.push(a);squad.add(a);return a;}};
 const hall={centre:new THREE.Vector3(),contains:(x,z)=>Math.abs(x)<20 && Math.abs(z)<26};
 const arena=new BossArena(level,hall);
 for(let i=0;i<14;i++)squad.fallen.push({actor:null,id:i%2 ? 'gorr' : 'galiant'});
 assert.equal(arena._resurrect(),10);assert.equal(squad.fallen.length,4);
 assert.ok(created.every(a=>hall.contains(a.position.x,a.position.z)));
 assert.equal(arena._resurrect(),4);assert.equal(squad.fallen.length,0);squad.dispose();
});

test('actual Gorr, red and black attacks use bullets, acid and fire with their own final damage ranges',async()=>{
 const w=await createTestWorld();let shot;
 w.projectilePool={firePlasma:options=>{shot=options;return options;}};
 const target={position:new THREE.Vector3(0,0,-10),health:new HealthComponent(100)};
 const squad={targets:[target]};
 const gorr=new AlienBrute(w,{position:new THREE.Vector3(),squad});gorr.perception.target=target;gorr.updateAttack(1);
 assert.equal(shot.attack,'bullet');assert.ok(shot.fraction>=.03 && shot.fraction<=.05);
 const red=new AlienTrooper(w,{position:new THREE.Vector3(),squad});red._fireAt(target);
 assert.equal(shot.attack,'slime');assert.equal(shot.fraction,.1);
 const black=new AlienSniper(w,{position:new THREE.Vector3(),squad});black._fireAt(target);
 assert.equal(shot.attack,'fire');assert.ok(shot.fraction>=.15 && shot.fraction<=.2);
 for(const a of [gorr,red,black])a.dispose();
});

test('level-two factories exclude black and white aliens; level three adds black and reserves white for the Warden',async()=>{
 const w=await createTestWorld(),squad=new AlienSquad(w,{targets:[],alertRadius:50,corpseSeconds:8});
 const level={gameWorld:w,squad,environment:{heightAt:()=>0},village:null};
 for(const type of ['brute','trooper','sniper','heavy']){
  const a=IslandLevel.prototype.createAlien.call(level,type,0,0);
  assert.equal(a.model.character.id,type==='brute' ? 'gorr' : 'galiant');
 }
 level.village={};
 const black=IslandLevel.prototype.createAlien.call(level,'sniper',0,0);assert.equal(black.model.character.id,'bahamut-nt');
 squad.dispose();
});

test('first-person rifle remains visible; inspecting and free-looking turn only the camera',async()=>{
 const w=await createTestWorld(),p=new Player(w),weapon=new WeaponController(w,p);w.addEntity(p);w.addEntity(weapon);
 p.springArm.setMode('FIRST_PERSON');stepWorld(w,.1);
 assert.equal(weapon.viewModel.visible,true);assert.equal(weapon.viewRifle.mesh.visible,true);
 w.input.press('inspectPlayer');stepWorld(w,.1);
 assert.equal(p.inspectView,true);assert.equal(weapon.viewModel.visible,false);
 w.input.mouseDelta.x=100;const yaw=p.yaw;stepWorld(w,.1);assert.equal(p.yaw,yaw);
 w.input.press('inspectPlayer');stepWorld(w,.1);assert.equal(p.inspectView,false);
 w.input.hold('freeLook');w.input.mouseDelta.x=100;stepWorld(w,.1);assert.equal(p.yaw,yaw);
 w.input.release('freeLook');stepWorld(w,.1);assert.equal(weapon.viewModel.visible,true);w.clearEntities();
});

test('assistants on flat ground stay grounded while following rather than stepping onto each other',async()=>{
 const w=await createTestWorld();w.physics.createGround(100);
 const p=new Player(w,{position:new THREE.Vector3(0,.05,0),maxHealth:100});w.addEntity(p);
 const squad=new HumanSquad(w,{leader:p});
 for(let i=0;i<4;i++)squad.add(new SquadMate(w,{name:`Helper ${i}`,position:new THREE.Vector3((i-1.5)*2,.05,4),squad}));
 stepWorld(w,1,{level:{isInitialized:true,gameplayUpdate:dt=>squad.update(dt)}});
 w.input.hold('forward');let highest=0;
 stepWorld(w,4,{level:{isInitialized:true,gameplayUpdate:dt=>squad.update(dt)},onFrame:()=>{for(const mate of squad.mates)highest=Math.max(highest,mate.position.y);}});
 assert.ok(highest<.15,`no physical bouncing (${highest})`);squad.dispose();w.clearEntities();
});

test('wing tornadoes damage once per vortex, expire, and stop hurting anyone after their owner dies',async()=>{
 const w=await createTestWorld();const target={position:new THREE.Vector3(0,0,-8),health:new HealthComponent(100),applyKnockback(){}};
 const owner={gameWorld:w,position:new THREE.Vector3(),model:{character:{joints:{}}},squad:{targets:[target]},isDead:false};
 const tornado=new WingTornado(owner);tornado.fire(target);
 for(let i=0;i<120;i++)tornado.update(1/60);
 assert.ok(target.health.currentHealth>=70 && target.health.currentHealth<=85,'one hit from each converging vortex at most');
 const health=target.health.currentHealth;for(let i=0;i<300;i++)tornado.update(1/60);
 assert.equal(target.health.currentHealth,health);assert.ok(tornado.vortices.every(v=>v.life===0));
 tornado.fire(target);owner.isDead=true;tornado.update(.1);assert.ok(tornado.vortices.every(v=>v.life===0));tornado.dispose();
});
