// Alien troopers: sight, damage, concealment, hearing, call-outs, friendly fire, death.
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
import config from '../src/config.json';

let world;
let env;
let cover;
let player;
let squad;

before(async () => {
  world = await createTestWorld({ seed: 7 });
  env = new BeachEnvironment(world);
  env.build();
  cover = new BeachCover(world, env, [{ x: 0, z: 120, radius: 4 }, { x: 0, z: 150, radius: 4 }, { x: 60, z: 120, radius: 4 }]);
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
  squad = new AlienSquad(world, { targets: [player], cover, alertRadius: 25, corpseSeconds: 4 });
});

afterEach(() => {
  squad.dispose();
  world.input.down.clear();
  world.clearEntities();
  world.projectilePool = null;
});

// The level does this every frame: squad bookkeeping and bush concealment
const level = {
  isInitialized: true,
  gameplayUpdate: () => { squad.update(); cover.updateConcealment(player); }
};
const run = (seconds, onFrame) => stepWorld(world, seconds, { level, onFrame });
const ground = (x, z) => env.heightAt(x, z);
function placePlayer(x, z) {
  player.teleport(x, ground(x, z) + 0.05, z);
  run(0.1);
}
function spawn(x, z, faceTowards = null) {
  const trooper = squad.add(new AlienTrooper(world, { position: new THREE.Vector3(x, ground(x, z) + 0.1, z), squad }));
  if (faceTowards) trooper.yaw = Math.atan2(-(faceTowards.x - x), -(faceTowards.z - z));
  return trooper;
}

test('a trooper spots a player in the open, engages and wears them down', () => {
  placePlayer(0, 150);
  const trooper = spawn(0, 120, player.position);
  let spottedAt = null;
  run(12, (frame) => {
    if (spottedAt === null && trooper.brain.is('engage')) spottedAt = frame / 60;
    return player.health.isDead;
  });
  assert.ok(spottedAt !== null && spottedAt < 1, `spotted after ${spottedAt}s`);
  assert.ok(player.health.currentHealth <= 50, `player still has ${player.health.currentHealth} hp`);
});

test('crouched in a bush the player stays hidden; standing up gives them away', () => {
  const bush = cover.bushes.find((b) => b.z > 60 && b.z < 170 && env.slopeAt(b.x, b.z) < 0.15);
  placePlayer(bush.x, bush.z);
  world.input.hold('crouch');
  run(0.2);
  const trooper = spawn(bush.x, bush.z - 20, player.position);
  run(3);
  assert.equal(player.isConcealed, true);
  assert.equal(trooper.perception.target, null, 'hidden player not seen');
  assert.equal(player.health.currentHealth, 100);

  world.input.release('crouch');
  trooper.stop();
  trooper.yaw = Math.atan2(-(player.position.x - trooper.position.x), -(player.position.z - trooper.position.z));
  run(1);
  assert.equal(trooper.perception.target, player, 'standing player seen');
});

test('a gunshot behind a patrolling trooper brings it to investigate and engage', () => {
  placePlayer(60, 150);
  const trooper = spawn(60, 120); // Faces -Z, away from the player
  run(0.5);
  assert.equal(trooper.brain.current, 'patrol');
  squad.reportNoise(player.position.clone());
  assert.equal(trooper.brain.current, 'investigate');
  run(5, () => trooper.brain.is('engage'));
  assert.equal(trooper.brain.current, 'engage');
});

test('call-out: a trooper that spots the player alerts squadmates nearby', () => {
  placePlayer(0, 150);
  const spotter = spawn(0, 125, player.position);
  const buddy = spawn(10, 112); // Facing away, 39 m from the player, 16 m from the spotter
  run(1);
  assert.equal(spotter.brain.current, 'engage');
  assert.notEqual(buddy.brain.current, 'patrol', 'squadmate reacted');
});

test('alien plasma never hurts other aliens', () => {
  placePlayer(0, 190);
  const shooter = spawn(-20, 120);
  const ally = spawn(-10, 120);
  shooter.stop();
  ally.stop();
  const origin = new THREE.Vector3(shooter.position.x, shooter.position.y + 1.2, shooter.position.z);
  const direction = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < 5; i++) {
    world.projectilePool.firePlasma({ origin, direction, source: shooter, excludeCollider: shooter.collider });
    run(0.3);
  }
  assert.equal(ally.health.currentHealth, config.enemies.trooper.maxHealth);
});

test('a killed trooper falls, stops colliding and is removed after its corpse time', () => {
  placePlayer(60, 190);
  const trooper = spawn(60, 120);
  trooper.health.takeDamage({ amount: 1000, source: player });
  assert.equal(trooper.isDead, true);
  assert.equal(trooper.collider.isEnabled(), false);
  assert.equal(squad.killCount, 0);
  run(0.1);
  assert.equal(squad.killCount, 1);
  run(config.enemies.trooper.corpseSeconds + 0.2);
  assert.equal(squad.members.includes(trooper), false);
  assert.equal(world.entities.has(trooper), false);
});

test('squad teardown leaves no physics bodies behind', async () => {
  const w = await createTestWorld();
  const e = new BeachEnvironment(w);
  e.build();
  const p = new Player(w, { maxHealth: 100 });
  w.addEntity(p);
  const s = new AlienSquad(w, { targets: [p], alertRadius: 25, corpseSeconds: 4 });
  for (let i = 0; i < 3; i++) s.add(new AlienTrooper(w, { position: new THREE.Vector3(i * 5, e.heightAt(i * 5, 120) + 0.1, 120), squad: s }));
  stepWorld(w, 0.5);
  s.dispose();
  w.clearEntities();
  e.dispose();
  assert.equal(bodyCount(w), 0);
});
