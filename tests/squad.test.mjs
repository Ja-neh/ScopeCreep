// AI squadmates: formation, fighting aliens, no friendly fire, being hunted, and falling.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { BeachEnvironment } from '../src/levels/level02/BeachEnvironment.js';
import { BeachCover } from '../src/levels/level02/BeachCover.js';
import { Player } from '../src/entities/Player.js';
import { ProjectilePool } from '../src/entities/ProjectilePool.js';
import { AlienTrooper } from '../src/entities/enemies/AlienTrooper.js';
import { AlienSquad } from '../src/ai/AlienSquad.js';
import { HumanSquad } from '../src/ai/HumanSquad.js';
import { SquadMate } from '../src/entities/allies/SquadMate.js';
import config from '../src/config.json';

let world;
let env;
let cover;
let player;
let aliens;
let humans;

before(async () => {
  world = await createTestWorld({ seed: 21 });
  env = new BeachEnvironment(world);
  env.build();
  cover = new BeachCover(world, env, []);
  cover.build();
});

after(() => {
  cover.dispose();
  env.dispose();
});

beforeEach(() => {
  player = new Player(world, { snapToGround: true, canCrouch: true, maxHealth: 100 });
  world.addEntity(player);
  world.projectilePool = new ProjectilePool(world);
  world.addEntity(world.projectilePool);
  humans = new HumanSquad(world, {
    leader: player,
    cover,
    isWalkable: (x, z) => env.heightAt(x, z) > 0.3 && cover.isClearOfSolids(x, z, 0.8),
    corpseSeconds: 2
  });
  aliens = new AlienSquad(world, { targets: humans.members, cover, alertRadius: 25, corpseSeconds: 4 });
  humans.enemySquad = aliens;
});

afterEach(() => {
  humans.dispose();
  aliens.dispose();
  world.input.down.clear();
  world.clearEntities();
  world.projectilePool = null;
});

// The level does this every frame
const level = {
  isInitialized: true,
  gameplayUpdate: (delta) => { aliens.update(); humans.update(delta); cover.updateConcealment(player); }
};
const run = (seconds, onFrame) => stepWorld(world, seconds, { level, onFrame });
const pathX = (z) => env.pathCentreX(z); // The jungle path is kept clear of rocks and trees
const at = (x, z) => new THREE.Vector3(x, env.heightAt(x, z) + 0.1, z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function placePlayer(x, z) {
  player.teleport(x, env.heightAt(x, z) + 0.05, z);
  run(0.1);
}
function addMate(x, z, name = 'Mate') {
  return humans.add(new SquadMate(world, { name, position: at(x, z), squad: humans }));
}
function addTrooper(x, z, facing = null) {
  const trooper = aliens.add(new AlienTrooper(world, { position: at(x, z), squad: aliens }));
  if (facing) trooper.yaw = Math.atan2(-(facing.x - x), -(facing.z - z));
  return trooper;
}

test('squadmates keep their places around the player as the player walks inland', () => {
  placePlayer(pathX(178), 178);
  const mates = [0, 1, 2, 3].map((i) => addMate(pathX(178) - 6 + i * 4, 184, `Mate ${i}`));

  // Walk 40 m up the jungle path at about walking pace
  for (let z = 178; z >= 138; z -= 1) {
    player.teleport(pathX(z), env.heightAt(pathX(z), z) + 0.05, z);
    run(0.25);
  }
  run(4);

  for (const mate of mates) {
    const distance = flat(mate.position, player.position);
    assert.ok(distance < 10, `${mate.name} is ${distance.toFixed(1)} m from the player`);
    assert.ok(mate.brain.is('follow'), `${mate.name} is ${mate.brain.current}`);
  }
  for (let i = 0; i < mates.length; i++) {
    for (let j = i + 1; j < mates.length; j++) {
      assert.ok(flat(mates[i].position, mates[j].position) > 1.5, 'squadmates spread out, not bunched up');
    }
  }
});

test('a squadmate spots an alien in the open and shoots it dead', () => {
  placePlayer(pathX(185), 185);
  const mate = addMate(pathX(165), 165);
  mate.hold(mate.position, 0);
  const trooper = addTrooper(pathX(140), 140, mate.position);

  run(15, () => trooper.isDead);
  run(0.1);
  assert.ok(trooper.isDead, `trooper still has ${trooper.health.currentHealth} hp`);
  assert.equal(aliens.killCount, 1);
  assert.ok(!mate.isDead, 'squadmate survived a one-on-one');
  assert.ok(humans.effects.tracers.some((tracer) => tracer.life > 0) || mate.weapon.ammo < config.weapons.machineGun.magazine, 'it fired');
});

test('no friendly fire: squadmate bullets stop on the player but never hurt them, and the other way round', () => {
  placePlayer(pathX(170), 170);
  const mate = addMate(pathX(170), 180);
  run(0.2);

  const chest = new THREE.Vector3(player.position.x, player.position.y + 1.2, player.position.z);
  const muzzle = new THREE.Vector3(mate.position.x, mate.position.y + 1.4, mate.position.z);
  const shot = mate.weapon.fire({ physicsWorld: world.physics, origin: muzzle, aimPoint: chest, spread: 0, excludeCollider: mate.collider, source: mate });
  assert.ok(shot.hit && shot.collider === player.collider, 'the bullet stops on the player');
  assert.equal(player.health.currentHealth, 100);

  mate.weapon.cooldown = 0;
  const back = mate.weapon.fire({
    physicsWorld: world.physics,
    origin: chest,
    aimPoint: new THREE.Vector3(mate.position.x, mate.position.y + 1.2, mate.position.z),
    spread: 0,
    excludeCollider: player.collider,
    source: player
  });
  assert.ok(back.hit && back.collider === mate.collider);
  assert.equal(mate.health.currentHealth, config.allies.squadMate.maxHealth);
});

test('aliens hunt squadmates too; a squadmate shot from behind turns and fights back', () => {
  placePlayer(-150, 100); // Far away, out of sight
  const mate = addMate(pathX(165), 165);
  mate.yaw = Math.PI;
  mate.hold(mate.position, Math.PI); // Watching the sea, with its back to the alien
  const trooper = addTrooper(pathX(140), 140, mate.position);

  run(1);
  assert.ok(trooper.perception.target === mate, 'the trooper targets the squadmate');
  assert.ok(mate.perception.target === null, 'the squadmate has not seen it yet');
  run(8, () => mate.health.currentHealth < config.allies.squadMate.maxHealth);
  assert.ok(mate.health.currentHealth < config.allies.squadMate.maxHealth, 'the squadmate takes plasma fire');
  run(3, () => mate.brain.is('engage'));
  assert.ok(mate.brain.is('engage') || trooper.isDead, `turned to fight (${mate.brain.current})`);
});

test('a fallen squadmate is reported once and cleared away; teardown leaves no physics bodies', () => {
  const bodiesBefore = bodyCount(world);
  const killed = [];
  humans.onMateKilled = (mate) => killed.push(mate.name);
  placePlayer(pathX(170), 170);
  const mate = addMate(pathX(170), 176, 'Okafor');
  run(0.2);

  mate.health.takeDamage({ amount: 9999 });
  run(0.5);
  assert.deepEqual(killed, ['Okafor']);
  assert.equal(mate.collider.isEnabled(), false, 'the fallen do not block the way');
  run(2);
  assert.deepEqual(killed, ['Okafor'], 'reported once');
  assert.equal(humans.mates.length, 0);
  assert.ok(!humans.members.includes(mate) && humans.members.includes(player));
  assert.equal(world.entities.has(mate), false);

  addMate(pathX(170), 178);
  humans.dispose();
  assert.equal(bodyCount(world), bodiesBefore, 'squad teardown removes squadmate bodies');
});
