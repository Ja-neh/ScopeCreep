// Physics juice: ragdoll corpses, explosion knockback and decals.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { BeachEnvironment } from '../src/levels/level02/BeachEnvironment.js';
import { Player } from '../src/entities/Player.js';
import { ProjectilePool } from '../src/entities/ProjectilePool.js';
import { AlienTrooper } from '../src/entities/enemies/AlienTrooper.js';
import { AlienSquad } from '../src/ai/AlienSquad.js';
import { Shockwave } from '../src/entities/enemies/Shockwave.js';
import { Decals } from '../src/rendering/Decals.js';
import config from '../src/config.json';

let world;
let env;
let player;
let decals;
let squad;

before(async () => {
  world = await createTestWorld({ seed: 4 });
  env = new BeachEnvironment(world);
  env.build();
});

after(() => {
  env.dispose();
});

beforeEach(() => {
  player = new Player(world, { snapToGround: true, canCrouch: true, maxHealth: 100 });
  world.addEntity(player);
  world.projectilePool = new ProjectilePool(world);
  world.addEntity(world.projectilePool);

  // A level always creates one of these (BaseLevel.init); blasts and shots write to it
  decals = new Decals(world);
  world.addEntity(decals);
  world.decals = decals;

  squad = new AlienSquad(world, { targets: [player], alertRadius: 25, corpseSeconds: 4 });
});

afterEach(() => {
  squad.dispose();
  world.input.down.clear();
  world.clearEntities();
  world.projectilePool = null;
  world.decals = null;
});

const run = (seconds, onFrame) => stepWorld(world, seconds, { onFrame });
const ground = (x, z) => env.heightAt(x, z);
function placePlayer(x, z) {
  player.teleport(x, ground(x, z) + 0.05, z);
  run(0.1);
}
function spawn(x, z) {
  return squad.add(new AlienTrooper(world, { position: new THREE.Vector3(x, ground(x, z) + 0.1, z), squad }));
}
/** Drops an artillery shell onto `impact` from above, with nothing else in the way. */
function shellOnto(impact) {
  const origin = new THREE.Vector3(impact.x, impact.y + 12, impact.z + 3);
  return world.projectilePool.fireArtillery({ origin, direction: impact.clone().sub(origin).normalize(), source: player });
}

test('a killing blow topples the corpse into a dynamic ragdoll kicked along the blow', () => {
  placePlayer(60, 190);
  const trooper = spawn(60, 120);
  run(0.2);
  const startedAt = trooper.mesh.position.clone();

  trooper.health.takeDamage({ amount: 1000, source: player, direction: new THREE.Vector3(1, 0, 0) });

  assert.equal(trooper.isDead, true);
  assert.equal(trooper.collider.isEnabled(), false, 'the walking capsule stops colliding');
  assert.ok(trooper.ragdoll, 'the corpse is handed to physics');
  assert.equal(trooper.ragdoll.body.isDynamic(), true, 'a real dynamic body, not kinematic');

  run(1.2);
  const moved = trooper.mesh.position.clone().sub(startedAt);
  assert.ok(moved.x > 0.3, `corpse kicked along the blow (moved ${moved.x.toFixed(2)}m east)`);
});

test('a ragdolled corpse is carried off, body and all, after its corpse time', () => {
  placePlayer(60, 190);
  const trooper = spawn(60, 120);
  trooper.health.takeDamage({ amount: 1000, source: player });
  assert.ok(trooper.ragdoll, 'down, as a ragdoll');

  const level = { isInitialized: true, gameplayUpdate: () => squad.update() };
  const bodiesWhileLying = bodyCount(world);
  stepWorld(world, 4.4, { level }); // The squad's corpseSeconds is 4

  assert.equal(squad.killCount, 1, 'counted');
  assert.equal(world.entities.has(trooper), false, 'corpse removed');
  assert.equal(trooper.ragdoll, null, 'the ragdoll went with it');
  assert.ok(bodyCount(world) <= bodiesWhileLying - 2, 'both the walking body and the corpse body are gone');
});

test('an artillery detonation throws a nearby corpse clear and scorches the ground', () => {
  placePlayer(0, 190);
  const trooper = spawn(30, 120);
  trooper.health.takeDamage({ amount: 1000, source: player }); // Dies where it stands
  run(0.3);
  const corpseAt = trooper.mesh.position.clone();

  const impactX = corpseAt.x + 3;
  const impact = new THREE.Vector3(impactX, ground(impactX, corpseAt.z) + 0.05, corpseAt.z);
  const shell = shellOnto(impact);
  run(3, () => !shell.alive);

  assert.equal(shell.alive, false, 'the shell detonated on the beach');
  assert.ok(decals.activeCount >= 1, 'the detonation left a scorch mark on the ground');

  const distFrom = (p) => Math.hypot(p.x - impact.x, p.z - impact.z);
  const before = distFrom(trooper.mesh.position);
  run(1.2);
  const after = distFrom(trooper.mesh.position);
  assert.ok(after > before + 0.3, `corpse tossed away from the blast (${before.toFixed(2)}m -> ${after.toFixed(2)}m)`);
});

test('a standing fighter beside a detonation is shoved off their mark, not hurt', () => {
  placePlayer(0, 150);
  const startX = player.position.x;
  const impact = new THREE.Vector3(-4, ground(-4, 150) + 0.05, 150);
  const shell = shellOnto(impact);
  run(2, () => !shell.alive);

  assert.equal(shell.alive, false, 'the shell detonated beside the player');
  assert.equal(player.health.currentHealth, 100, 'the blast shoves, it does not damage');
  run(1.2);
  const moved = player.position.x - startX;
  assert.ok(moved > 0.3, `shoved away from the detonation (${moved.toFixed(2)}m)`);
});

test('an artillery shell that strikes an ally never hurts them, yet still detonates', () => {
  placePlayer(0, 190);
  const shooter = spawn(30, 126);
  const ally = spawn(38, 120);
  shooter.stop();
  ally.stop();

  const aim = new THREE.Vector3(ally.position.x, ally.position.y + 1, ally.position.z);
  const origin = new THREE.Vector3(aim.x, aim.y + 12, aim.z + 3);
  const shell = world.projectilePool.fireArtillery({ origin, direction: aim.clone().sub(origin).normalize(), source: shooter });
  run(2, () => !shell.alive);

  assert.equal(shell.alive, false, 'the shell came down on the ally');
  assert.equal(ally.health.currentHealth, config.enemies.trooper.maxHealth, 'friendly fire does no damage');
  assert.ok(world.projectilePool.effects.blasts.some((blast) => blast.life > 0), 'the detonation still played its fireball');
});

test('a shockwave knocks a standing fighter off their feet', () => {
  placePlayer(0, 150);
  const startX = player.position.x;
  const wave = new Shockwave(world.effectsGroup);
  const level = { isInitialized: true, gameplayUpdate: (delta) => wave.update(delta, [player]) };
  try {
    wave.start(new THREE.Vector3(player.position.x - 2, player.position.y, player.position.z), {
      speed: 12, maxRadius: 15, damage: 1, clearHeight: 0.45, knockback: 7
    });
    stepWorld(world, 1.5, { level });

    assert.equal(player.health.currentHealth, 100-config.player.damageMultiplier, 'the ring caught the protected player once');
    assert.equal(wave.active, false, 'the ring ran its course');
    const moved = player.position.x - startX;
    assert.ok(moved > 0.3, `pushed away from the slam (${moved.toFixed(2)}m)`);
  } finally {
    wave.dispose();
  }
});

test('decals lie flat on a surface, fade out with age and recycle through a fixed pool', () => {
  const normal = new THREE.Vector3(0, 1, 0);
  const point = new THREE.Vector3(10, ground(10, 150) + 0.02, 150);
  decals.spawn(point, normal, 'bullet');

  assert.equal(decals.activeCount, 1, 'one mark');
  const quad = decals.pool.find((mark) => mark.active).mesh;
  assert.equal(quad.visible, true, 'shown where the shot landed');
  const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(quad.quaternion);
  assert.ok(facing.dot(normal) > 0.999, 'lies flat against the surface');
  assert.ok(quad.position.y > point.y, 'held just above the surface so it cannot z-fight');

  run(0.5);
  assert.equal(decals.activeCount, 1, 'still there half a second later');

  decals.lateUpdate(40); // 5 of its 45 seconds left: fading
  assert.ok(quad.material.opacity < 0.5, 'fades as its time runs out');
  decals.lateUpdate(6);
  assert.equal(quad.visible, false, 'then hides');
  assert.equal(decals.activeCount, 0);

  // Filling the pool past its capacity recycles the oldest marks instead of allocating
  const capacity = decals.pool.length;
  for (let i = 0; i < capacity + 1; i++) decals.spawn(point, normal, 'scorch');
  assert.equal(decals.pool.length, capacity, 'no new quads');
  assert.equal(decals.activeCount, capacity, 'oldest mark recycled over');
});

test('physics juice teardown leaves no physics bodies behind', async () => {
  const w = await createTestWorld();
  const e = new BeachEnvironment(w);
  e.build();
  const p = new Player(w, { snapToGround: true, maxHealth: 100 });
  w.addEntity(p);
  const pool = new ProjectilePool(w);
  w.addEntity(pool);
  w.projectilePool = pool;
  const marks = new Decals(w);
  w.addEntity(marks);
  w.decals = marks;
  const s = new AlienSquad(w, { targets: [p], corpseSeconds: 4 });
  const trooper = s.add(new AlienTrooper(w, {
    position: new THREE.Vector3(30, e.heightAt(30, 120) + 0.1, 120), squad: s
  }));

  stepWorld(w, 0.3);
  trooper.health.takeDamage({ amount: 1000, source: p }); // Hands its body to physics
  stepWorld(w, 0.5);
  assert.ok(trooper.ragdoll, 'the corpse body exists before teardown');

  s.dispose();
  w.clearEntities();
  e.dispose();
  assert.equal(bodyCount(w), 0);
});
