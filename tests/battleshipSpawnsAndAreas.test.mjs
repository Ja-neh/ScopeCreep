import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { Battleship } from '../src/entities/Battleship.js';
import { Level01 } from '../src/levels/Level01.js';
import { ProjectilePool } from '../src/entities/ProjectilePool.js';

test('Battleship Areas: AreaFront and deck areas are rigged and readable in world space', async () => {
  const world = await createTestWorld();
  const ship = new Battleship(world, { position: new THREE.Vector3(0, 0, 100) });
  await ship.ready;
  world.addEntity(ship);

  // Check AreaFront on forward deck
  const areaFront = ship.getAreaWorldPosition('AreaFront');
  assert.ok(areaFront instanceof THREE.Vector3);
  assert.ok(Math.abs(areaFront.x - 1.34) < 0.2, `AreaFront X ~1.34 (actual: ${areaFront.x})`);
  assert.ok(Math.abs(areaFront.y - 5.3) < 0.5, `AreaFront Y ~5.3 (actual: ${areaFront.y})`);
  assert.ok(Math.abs(areaFront.z - (100 - 37.03)) < 0.5, `AreaFront Z ~62.97 (actual: ${areaFront.z})`);

  // Check other areas
  const areaHelm = ship.getAreaWorldPosition('AreaHelm');
  assert.ok(Math.abs(areaHelm.x - 5.47) < 0.5);
  assert.ok(Math.abs(areaHelm.z - (100 + 17.22)) < 0.5);

  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('Level 1 spawns player at AreaFront on the battleship forward deck', async () => {
  const world = await createTestWorld();
  const level = new Level01(world);
  await level.init();

  const areaFrontWorld = level.battleship.getAreaWorldPosition('AreaFront');
  assert.ok(Math.abs(level.player.position.x - areaFrontWorld.x) < 0.2, 'player X matches AreaFront');
  assert.ok(Math.abs(level.player.position.z - areaFrontWorld.z) < 0.5, 'player Z matches AreaFront');
  assert.ok(level.player.position.y >= areaFrontWorld.y, 'player sits on or above deck surface');

  level.dispose();
  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('Guns spawn projectiles from ProjectileSpawn empties on barrels', async () => {
  const world = await createTestWorld();
  const pool = new ProjectilePool(world);
  world.addEntity(pool);
  world.projectilePool = pool;

  const ship = new Battleship(world, { position: new THREE.Vector3(0, 0, 0) });
  await ship.ready;
  world.addEntity(ship);

  // 1. Verify Artillery main gun has ProjectileSpawn empties (2 twin barrels)
  assert.ok(ship.mainGun.projectileSpawns.length >= 2, 'Main gun has ProjectileSpawn empties');
  assert.equal(pool.activeProjectiles.length, 0);

  // Fire main gun
  ship.mainGun._fireWeapon();
  assert.equal(pool.activeProjectiles.length, ship.mainGun.projectileSpawns.length, 'spawns a shell from each barrel empty');

  // Verify shell spawn coordinates match the empties
  for (let i = 0; i < ship.mainGun.projectileSpawns.length; i++) {
    const emptyPos = ship.mainGun.projectileSpawns[i].getWorldPosition(new THREE.Vector3());
    const projPos = pool.activeProjectiles[i].position;
    assert.ok(projPos.distanceTo(emptyPos) < 0.1, `artillery shell ${i} spawned at empty position`);
  }

  // 2. Verify Flak turret has ProjectileSpawn empties (4 quad barrels)
  assert.ok(ship.flakTurret.projectileSpawns.length >= 4, 'Anti-air gun has 4 ProjectileSpawn empties');
  const countBeforeFlak = pool.activeProjectiles.length;

  // Fire flak turret
  ship.flakTurret._fireWeapon();
  const flakFired = pool.activeProjectiles.length - countBeforeFlak;
  assert.equal(flakFired, ship.flakTurret.projectileSpawns.length, 'spawns flak tracer from all 4 barrel empties');

  for (let i = 0; i < ship.flakTurret.projectileSpawns.length; i++) {
    const emptyPos = ship.flakTurret.projectileSpawns[i].getWorldPosition(new THREE.Vector3());
    const projPos = pool.activeProjectiles[countBeforeFlak + i].position;
    assert.ok(projPos.distanceTo(emptyPos) < 0.1, `flak tracer ${i} spawned at empty position`);
  }

  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});
