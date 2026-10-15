import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CoastalTarget } from '../src/entities/CoastalTarget.js';
import { AirStrikeMission } from '../src/levels/AirStrikeMission.js';
import { ProjectilePool } from '../src/entities/ProjectilePool.js';
import { PlayerJet } from '../src/entities/player-jet/PlayerJet.js';
import { bodyCount, createTestWorld, stepWorld } from './support/testWorld.mjs';

test('air-strike mission completes after all enemy installations and ships are destroyed', async () => {
  const world = await createTestWorld();
  const playerJet = new PlayerJet(world, { position: new THREE.Vector3(0, 80, -200) });
  const targets = [
    new CoastalTarget(world, {
      kind: 'radar',
      name: 'Radar Station',
      position: new THREE.Vector3(-50, 0, 350)
    }),
    new CoastalTarget(world, {
      kind: 'ship',
      name: 'Enemy Patrol Ship',
      position: new THREE.Vector3(50, 0, 450)
    })
  ];
  world.addEntity(playerJet);
  for (const target of targets) world.addEntity(target);
  const mission = new AirStrikeMission(world, playerJet, targets);

  mission.start();
  mission.update(1.25);
  assert.equal(mission.state, 'active');
  assert.ok(world.ui.callsTo('showObjective').length > 0);

  for (const target of targets) target.health.takeDamage(target.health.maxHealth);
  mission.update(0.1);

  assert.equal(mission.state, 'won');
  assert.ok(targets.every((target) => target.isDestroyed && !target.mesh.visible));
  const result = world.ui.callsTo('showMissionResult').at(-1).args[0];
  assert.equal(result.outcome, 'victory');
  assert.equal(result.stats.find((stat) => stat.label === 'Targets destroyed').value, '2');

  world.clearEntities();
  assert.equal(bodyCount(world), 0, 'targets release their static colliders on disposal');
});

test('air-strike mission fails if the player jet is destroyed', async () => {
  const world = await createTestWorld();
  const playerJet = new PlayerJet(world);
  const target = new CoastalTarget(world, {
    kind: 'gun',
    name: 'Coastal Gun Battery',
    position: new THREE.Vector3(0, 0, 300)
  });
  world.addEntity(playerJet);
  world.addEntity(target);
  const mission = new AirStrikeMission(world, playerJet, [target]);
  mission.start();

  playerJet.health.takeDamage(playerJet.health.maxHealth);
  mission.update(0.5);

  assert.equal(mission.state, 'lost');
  assert.equal(world.ui.callsTo('showMissionResult').at(-1).args[0].outcome, 'defeat');
  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('player flak projectiles damage hostile coastal targets through their physics collider', async () => {
  const world = await createTestWorld();
  const pool = new ProjectilePool(world);
  const target = new CoastalTarget(world, {
    kind: 'ship',
    name: 'Enemy Patrol Ship',
    position: new THREE.Vector3(0, 0, 35)
  });
  world.addEntity(pool);
  world.addEntity(target);
  world.projectilePool = pool;
  pool.fireFlak({
    origin: new THREE.Vector3(0, 5, 0),
    direction: new THREE.Vector3(0, 0, 1),
    speed: 600,
    spread: 0,
    damage: target.health.maxHealth,
    source: { faction: 'humans' }
  });

  stepWorld(world, 0.1);

  assert.equal(target.isDestroyed, true);
  assert.equal(target.mesh.visible, false);
  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});
