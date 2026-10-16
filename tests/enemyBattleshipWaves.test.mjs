import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { EnemyBattleshipManager } from '../src/entities/enemies/EnemyBattleshipManager.js';
import { EnemyBattleship, BattleshipAIState } from '../src/entities/enemies/EnemyBattleship.js';
import { ProjectilePool } from '../src/entities/ProjectilePool.js';
import config from '../src/config.json';

const assaultCfg = config.enemyBattleship.assault;

/** Synthetic circular island: signed distance field, meters inland of the waterline. */
const ISLAND = { x: 0, z: -1200, radius: 300 };
const island = {
  inland: (x, z) => ISLAND.radius - Math.hypot(x - ISLAND.x, z - ISLAND.z)
};

function makePlayerShip() {
  const mesh = new THREE.Group();
  return {
    mesh,
    health: { currentHealth: 5000, maxHealth: 5000 },
    isDestroyed: false,
    faction: 'humans'
  };
}

/** Spawns `count` queued ships instantly and waits for model + physics hookup. */
async function spawnWave(manager, count) {
  for (let i = 0; i < count; i++) {
    manager._spawnTimer = 0;
    manager.update(0.01);
  }
  await Promise.all([...manager.ships].map((ship) => ship.ready));
  await new Promise((resolve) => setImmediate(resolve));
}

function sinkWaveShips(manager) {
  for (const ship of manager._waveShips) {
    ship.health.takeDamage({ amount: ship.health.maxHealth + 1, type: 'EXPLOSIVE' });
  }
  manager.update(0.01);
}

test('fleet assault runs 2 waves (5 ringing the island + 10 from the edges), wins, and recycles every hulk', async () => {
  const world = await createTestWorld();
  const pool = new ProjectilePool(world);
  world.addEntity(pool);
  world.projectilePool = pool;

  const battleship = makePlayerShip();
  let victoryResult = null;
  const manager = new EnemyBattleshipManager(world, {
    battleship,
    islandAnchor: new THREE.Vector3(ISLAND.x, 0, ISLAND.z),
    island,
    onVictory: (result) => { victoryResult = result; }
  });
  manager.start();
  assert.equal(manager.totalHostiles, 15, 'default doctrine totals 15 battleships');

  const expectedCounts = [5, 10];
  const coastRing = ISLAND.radius + assaultCfg.islandSpawn.coastStandoff;
  for (let wave = 0; wave < expectedCounts.length; wave++) {
    if (wave === 0) manager.update(assaultCfg.firstWaveDelaySeconds + 0.1);
    else manager.update(assaultCfg.betweenWavesSeconds + 0.1);
    assert.equal(manager.state, 'combat', `wave ${wave + 1} is in combat`);

    await spawnWave(manager, expectedCounts[wave]);
    assert.equal(manager._waveShips.length, expectedCounts[wave], `wave ${wave + 1} spawns its configured count`);
    assert.ok(manager._waveShips.every((ship) => ship.target === battleship), 'all wave ships hunt the player battleship');

    for (const ship of manager._waveShips) {
      const p = ship.mesh.position;
      const distToPlayer = Math.hypot(p.x - battleship.mesh.position.x, p.z - battleship.mesh.position.z);
      assert.ok(
        distToPlayer >= assaultCfg.islandSpawn.minPlayerDistance - 1,
        `spawn respects minPlayerDistance (${distToPlayer.toFixed(0)}m)`
      );
      assert.ok(
        island.inland(p.x, p.z) <= -assaultCfg.islandSpawn.coastStandoff + 1,
        `spawn sits in open water (inland ${island.inland(p.x, p.z).toFixed(1)}m)`
      );
      if (wave === 0) {
        const distToIslandCenter = Math.hypot(p.x - ISLAND.x, p.z - ISLAND.z);
        assert.ok(
          Math.abs(distToIslandCenter - coastRing) < 2,
          `island wave rings the coast (${distToIslandCenter.toFixed(1)}m from centre, ring ${coastRing}m)`
        );
        assert.ok(p.z < battleship.mesh.position.z, 'island wave spawns island-ward of the player');
      } else {
        assert.ok(
          Math.abs(distToPlayer - assaultCfg.edgeSpawn.radius) < 1,
          `edge spawn sits at configured radius (${distToPlayer.toFixed(0)}m)`
        );
        assert.ok(
          Math.abs(p.x) <= assaultCfg.edgeSpawn.oceanClamp && Math.abs(p.z) <= assaultCfg.edgeSpawn.oceanClamp,
          'edge spawn clamped to the ocean square'
        );
      }
    }

    sinkWaveShips(manager);
    if (wave < expectedCounts.length - 1) {
      assert.equal(manager.state, 'intermission', 'wave 1 cleared into intermission');
    }
  }

  assert.equal(manager.state, 'won', 'sinking all 15 wins the assault');
  assert.equal(manager.killCount, 15, 'every kill counted exactly once');
  assert.equal(victoryResult.outcome, 'victory');
  assert.equal(victoryResult.stats[1].value, '15 / 15');

  // Sinking ships submerge (2 m/s, 35 m) then hulks are recycled once configured
  // seabed time elapses; colliders must be fully recovered afterwards.
  stepWorld(world, 20);
  manager.update(assaultCfg.sinkCleanupSeconds + 1);
  assert.equal(manager.ships.size, 0, 'every sunken hulk recycled');

  world.clearEntities();
  assert.equal(bodyCount(world), 0, 'clean teardown without dangling physics bodies');
  manager.dispose();
});

test('fleet assault is lost when the player battleship is destroyed', async () => {
  const world = await createTestWorld();
  const battleship = makePlayerShip();
  let defeatResult = null;
  const manager = new EnemyBattleshipManager(world, {
    battleship,
    islandAnchor: new THREE.Vector3(ISLAND.x, 0, ISLAND.z),
    island,
    onDefeat: (result) => { defeatResult = result; }
  });
  manager.start();
  manager.update(assaultCfg.firstWaveDelaySeconds + 0.1);
  await spawnWave(manager, 5);
  assert.equal(manager._waveShips.length, 5, 'wave 1 fields 5 battleships');

  battleship.isDestroyed = true;
  battleship.health.currentHealth = 0;
  manager.update(0.01);

  assert.equal(manager.state, 'lost');
  assert.equal(defeatResult.outcome, 'defeat');
  assert.equal(defeatResult.title, 'BATTLESHIP LOST');

  manager.dispose();
  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('enemy battleship skirts the island coast instead of crossing it', async () => {
  const world = await createTestWorld();
  const pool = new ProjectilePool(world);
  world.addEntity(pool);
  world.projectilePool = pool;

  // Closer island directly between the ship and the player.
  const coast = {
    inland: (x, z) => 200 - Math.hypot(x, z + 400)
  };
  const margin = assaultCfg.avoidance.coastMargin;
  const player = makePlayerShip();
  player.mesh.position.set(0, 0, 300);

  // Dead astern of the island, bow toward the player: the direct track crosses land.
  const enemy = new EnemyBattleship(world, {
    position: new THREE.Vector3(-5, 0, -700),
    target: player,
    island: coast
  });
  enemy.mesh.rotation.y = Math.PI; // face +Z, straight at the player and through the island
  await enemy.ready;
  world.addEntity(enemy);
  enemy.initPhysics(world.physics);

  assert.ok(
    coast.inland(enemy.mesh.position.x, enemy.mesh.position.z) < -margin,
    'test geometry starts the ship outside the coast margin'
  );

  let reached = false;
  let minX = Infinity;
  let maxInland = -Infinity;
  const frames = stepWorld(world, 300, {
    onFrame: () => {
      const p = enemy.mesh.position;
      const d = coast.inland(p.x, p.z);
      maxInland = Math.max(maxInland, d);
      minX = Math.min(minX, p.x);
      assert.ok(
        d <= -margin,
        `hull entered the coast margin (inland ${d.toFixed(2)}m at ${p.x.toFixed(1)}, ${p.z.toFixed(1)})`
      );
      const distToPlayer = Math.hypot(p.x - player.mesh.position.x, p.z - player.mesh.position.z);
      if (distToPlayer < 450) {
        reached = true;
        return true;
      }
      return false;
    }
  });

  assert.ok(
    reached,
    `ship rounded the island and closed to <450m of the player ` +
    `(minX ${minX.toFixed(1)}, maxInland ${maxInland.toFixed(2)}, ` +
    `end ${enemy.mesh.position.x.toFixed(1)}, ${enemy.mesh.position.z.toFixed(1)}, ${frames} frames)`
  );
  assert.ok(
    minX < -225,
    `detour rounded the island's west shore (minX ${minX.toFixed(1)})`
  );
  assert.ok(
    enemy.brain.is(BattleshipAIState.APPROACH) || enemy.brain.is(BattleshipAIState.BROADSIDE),
    'ship stays in an engaged state after the detour'
  );

  world.clearEntities();
  assert.equal(bodyCount(world), 0, 'clean teardown without dangling physics bodies');
});
