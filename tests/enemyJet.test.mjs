import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EnemyJet } from '../src/entities/enemies/EnemyJet.js';
import { PlayerJet } from '../src/entities/player-jet/PlayerJet.js';
import { ProjectilePool } from '../src/entities/ProjectilePool.js';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import config from '../src/config.json';

test('EnemyJet pursues the human jet, fires pooled flak, and can be destroyed', async () => {
  const world = await createTestWorld();
  const pool = new ProjectilePool(world);
  world.addEntity(pool);
  world.projectilePool = pool;

  const playerJet = new PlayerJet(world, { position: new THREE.Vector3(0, 80, 0) });
  const enemyJet = new EnemyJet(world, {
    position: new THREE.Vector3(0, 80, -60),
    target: playerJet
  });
  world.addEntity(playerJet);
  world.addEntity(enemyJet);

  const initialEnemyZ = enemyJet.mesh.position.z;
  const initialHealth = playerJet.health.currentHealth;
  stepWorld(world, 0.5);

  assert.equal(enemyJet.faction, 'aliens');
  assert.equal(playerJet.faction, 'humans');
  assert.ok(enemyJet.mesh.position.z > initialEnemyZ, 'enemy pursues along the player flight path');
  assert.equal(enemyJet.health.maxHealth, config.enemyJet.health);
  assert.ok(
    playerJet.health.currentHealth < initialHealth,
    `hostile fire damages the player jet (health ${playerJet.health.currentHealth}; player ${playerJet.mesh.position.toArray()}; enemy ${enemyJet.mesh.position.toArray()}; projectiles ${pool.activeProjectiles.map((projectile) => projectile.position.toArray())})`
  );

  enemyJet.health.takeDamage({ amount: config.enemyJet.health, type: 'KINETIC' });
  const destroyedPosition = enemyJet.mesh.position.clone();
  stepWorld(world, 0.2);
  assert.equal(enemyJet.isDestroyed, true);
  assert.equal(enemyJet.mesh.visible, false);
  assert.ok(enemyJet.mesh.position.equals(destroyedPosition), 'destroyed enemy stops flying');

  world.clearEntities();
  assert.equal(bodyCount(world), 0, 'both aircraft release their physics bodies');
});

test('EnemyJet prefers the active player jet target before falling back to the battleship', async () => {
  const world = await createTestWorld();
  const battleship = {
    mesh: new THREE.Group(),
    position: new THREE.Vector3(0, 10, 0),
    health: { currentHealth: 1000, maxHealth: 1000 },
    faction: 'humans',
    isDestroyed: false
  };
  const playerJet = new PlayerJet(world, { position: new THREE.Vector3(10, 90, 0) });
  const enemyJet = new EnemyJet(world, { position: new THREE.Vector3(0, 80, -60) });

  world.currentLevel = { playerJet, battleship };
  world.addEntity(playerJet);
  world.addEntity(enemyJet);

  assert.equal(enemyJet._getTargetPosition(), true);
  assert.equal(enemyJet.target, playerJet, 'the live human jet is prioritized over the battleship');

  playerJet.health.takeDamage({ amount: playerJet.health.maxHealth, type: 'KINETIC' });
  assert.equal(enemyJet._getTargetPosition(), true);
  assert.equal(enemyJet.target, battleship, 'the battleship becomes the fallback target once the player jet is down');

  enemyJet.dispose();
  playerJet.dispose();
  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('EnemyJet breaks away after a burst to reset its attack rhythm', async () => {
  const world = await createTestWorld();
  const pool = new ProjectilePool(world);
  world.addEntity(pool);
  world.projectilePool = pool;

  const playerJet = new PlayerJet(world, { position: new THREE.Vector3(0, 80, 0) });
  const enemyJet = new EnemyJet(world, {
    position: new THREE.Vector3(0, 80, -40),
    target: playerJet,
    maxHealth: 100
  });

  enemyJet.burstSize = 1;
  enemyJet._burstShotsRemaining = 1;
  enemyJet._fireCooldown = 0;
  enemyJet.maneuverState = 'approach';
  enemyJet.prePhysicsUpdate(0.016);
  enemyJet.gameplayUpdate(0.016, world);

  assert.equal(enemyJet.maneuverState, 'breakaway');
  assert.equal(enemyJet._fireCooldown, 0, 'a completed burst must reset its firing cadence before re-engaging');

  enemyJet.dispose();
  playerJet.dispose();
  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('enemy jet attack styles create distinct approach paths', async () => {
  const world = await createTestWorld();
  const target = new PlayerJet(world, { position: new THREE.Vector3(0, 80, 0) });
  const direct = new EnemyJet(world, {
    position: new THREE.Vector3(0, 100, -100),
    target,
    attackStyle: 'direct'
  });
  const weaving = new EnemyJet(world, {
    position: new THREE.Vector3(0, 100, -100),
    target,
    attackStyle: 'weave'
  });

  direct.prePhysicsUpdate(0.5);
  weaving.prePhysicsUpdate(0.5);

  assert.notEqual(
    direct.mesh.position.x,
    weaving.mesh.position.x,
    'the weaving fighter changes its line of approach'
  );
  direct.dispose();
  weaving.dispose();
  target.dispose();
  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});
