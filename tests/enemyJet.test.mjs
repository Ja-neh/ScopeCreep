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
