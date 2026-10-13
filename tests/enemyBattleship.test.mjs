import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { EnemyBattleship, BattleshipAIState } from '../src/entities/enemies/EnemyBattleship.js';
import { Battleship } from '../src/entities/Battleship.js';
import { ProjectilePool } from '../src/entities/ProjectilePool.js';
import config from '../src/config.json';

test('EnemyBattleship initializes with alien faction, twin AI artillery turrets, and StateMachine brain', async () => {
  const world = await createTestWorld();
  const enemy = new EnemyBattleship(world, { position: new THREE.Vector3(0, 0, -200) });
  await enemy.ready;
  world.addEntity(enemy);
  enemy.initPhysics(world.physics);

  assert.equal(enemy.faction, 'aliens', 'enemy ship belongs to aliens faction');
  assert.ok(enemy.mainGun, 'forward artillery turret exists');
  assert.ok(enemy.mainGunBack, 'rear artillery turret exists');
  assert.equal(enemy.mainGun.isAI, true, 'main gun flagged as AI controlled');
  assert.equal(enemy.mainGunBack.isAI, true, 'rear gun flagged as AI controlled');
  assert.equal(enemy.mainGun.faction, 'aliens', 'main gun inherits alien faction');
  assert.ok(enemy.brain, 'state machine brain exists');
  assert.equal(enemy.brain.is(BattleshipAIState.APPROACH), true, 'defaults to approach state');
  assert.equal(enemy.health.maxHealth, config.enemyBattleship.health.maxHealth, 'matches tuned enemy health');
  assert.equal(enemy.mainGun.fireRate, config.enemyBattleship.combat.reloadCadence, 'uses slower reload cadence');
  assert.equal(enemy.mainGun.damage, config.enemyBattleship.combat.damage, 'uses tuned lower shell damage');

  world.clearEntities();
  assert.equal(bodyCount(world), 0, 'clean teardown without dangling physics bodies');
});

test('EnemyBattleship StateMachine transitions to BROADSIDE and fires twin artillery', async () => {
  const world = await createTestWorld();
  const pool = new ProjectilePool(world);
  world.addEntity(pool);
  world.projectilePool = pool;

  const playerShip = new Battleship(world, { position: new THREE.Vector3(0, 0, 0) });
  await playerShip.ready;
  world.addEntity(playerShip);
  playerShip.initPhysics(world.physics);

  const enemy = new EnemyBattleship(world, {
    position: new THREE.Vector3(0, 0, -250),
    target: playerShip,
    initialState: BattleshipAIState.APPROACH
  });
  enemy.mesh.rotation.y = Math.PI; // Face towards target at Z = 0
  await enemy.ready;
  world.addEntity(enemy);
  enemy.initPhysics(world.physics);

  // At distance 250m (between broadsideMin 180m and broadsideMax 380m), ship should switch to broadside
  stepWorld(world, 0.5);

  assert.equal(
    enemy.brain.is(BattleshipAIState.BROADSIDE),
    true,
    'transitions to BROADSIDE state within broadside engagement distance'
  );

  // Turrets should have tracked target and fired
  assert.ok(
    enemy.mainGun.fireCooldown > 0,
    'enemy battleship forward artillery fired and entered reload cycle'
  );
  assert.ok(
    enemy.mainGunBack.fireCooldown > 0,
    'enemy battleship rear artillery fired and entered reload cycle'
  );

  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('EnemyBattleship StateMachine transitions to SINKING on fatal damage and proceeds to DEAD', async () => {
  const world = await createTestWorld();
  const enemy = new EnemyBattleship(world, { position: new THREE.Vector3(0, 0, -100) });
  await enemy.ready;
  world.addEntity(enemy);
  enemy.initPhysics(world.physics);

  const initialY = enemy.mesh.position.y;
  assert.equal(enemy.isDestroyed, false);
  assert.equal(enemy.isSinking, false);

  // Inflict fatal damage
  enemy.health.takeDamage({ amount: 100000, type: 'EXPLOSIVE' });
  assert.equal(enemy.isDestroyed, true, 'ship is marked destroyed');
  assert.equal(enemy.isSinking, true, 'ship begins sinking');
  assert.equal(enemy.brain.is(BattleshipAIState.SINKING), true, 'FSM changed to SINKING');

  // Step simulation: ship should submerge downward along Y axis
  stepWorld(world, 6.0);
  assert.ok(enemy.mesh.position.y < initialY - 10.0, `enemy ship submerged to Y: ${enemy.mesh.position.y}`);

  // Step until reaching maxSinkDepth (-35m)
  stepWorld(world, 15.0);
  assert.equal(enemy.brain.is(BattleshipAIState.DEAD), true, 'FSM transitioned to DEAD once fully submerged');

  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('EnemyBattleship establishes rigid body colliders, platform kinematics, and ship-to-ship collision', async () => {
  const world = await createTestWorld();
  const enemy = new EnemyBattleship(world, { position: new THREE.Vector3(0, 0, -100) });
  await enemy.ready;
  world.addEntity(enemy);
  enemy.initPhysics(world.physics);

  assert.ok(enemy.colliders, 'colliders subsystem exists');
  assert.ok(enemy.colliders.rigidBody, 'kinematic rigid body exists in Rapier');
  assert.ok(enemy.colliders.collider, 'static hull trimesh collider exists in Rapier');

  // Verify platform detection bounds
  const deckPoint = new THREE.Vector3(0, 5.0, -100);
  assert.equal(enemy.isPointOnPlatform(deckPoint), true, 'point on deck identified as on platform');
  const distantPoint = new THREE.Vector3(500, 5.0, 500);
  assert.equal(enemy.isPointOnPlatform(distantPoint), false, 'distant point identified as off platform');

  // Verify platform displacement computation
  const disp = new THREE.Vector3();
  enemy.getPlatformDisplacement(deckPoint, disp);
  assert.ok(disp instanceof THREE.Vector3, 'returns platform displacement vector');

  // Verify ship-to-ship collision resolution
  const playerShip = new Battleship(world, { position: new THREE.Vector3(0, 0, 0) });
  await playerShip.ready;
  world.addEntity(playerShip);
  playerShip.initPhysics(world.physics);

  // Position player ship right at colliding distance with enemy (e.g. z = -60 with bow at -60)
  const candPos = { x: 0, z: -70 };
  playerShip.shipController.heading = 0;
  playerShip.shipController.speed = 10;
  playerShip.shipController._resolveShipCollisions(candPos, world);

  // Penetration should be pushed away to resolve overlap
  assert.notEqual(candPos.z, -70, `candPos adjusted from -70 to ${candPos.z} preventing hull overlap`);
  assert.ok(playerShip.shipController.speed < 0, 'speed rebounded upon ramming collision');

  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

