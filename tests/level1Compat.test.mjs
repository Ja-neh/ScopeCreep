// Level 1 compatibility: shared code changed for Level 2 must behave exactly as before
// when Level 1 uses it with its defaults.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld, installBrowserGlobals, bodyCount } from './support/testWorld.mjs';
import { Player } from '../src/entities/Player.js';
import { CameraMode } from '../src/entities/components/SpringArmCamera.js';
import { Ocean } from '../src/rendering/Ocean.js';
import { ProjectilePool } from '../src/entities/ProjectilePool.js';
import { HealthComponent } from '../src/entities/components/HealthComponent.js';
import { InputManager } from '../src/core/InputManager.js';
import { Battleship } from '../src/entities/Battleship.js';
import config from '../src/config.json';

test('Player defaults: no health, no crouch, no snapping, humans side, findable by its collider', async () => {
  const world = await createTestWorld();
  world.physics.createGround(200, -0.5);
  const player = new Player(world);
  world.addEntity(player);
  assert.equal(player.health, null);
  assert.equal(player.canCrouch, false);
  assert.equal(player.snapToGround, false);
  assert.equal(player.faction, 'humans');
  assert.equal(player.collider.userData.entity, player);

  world.input.hold('crouch');
  stepWorld(world, 0.2);
  assert.equal(player.isCrouching, false, 'crouch key ignored without canCrouch');
  world.clearEntities();
});

test('third-person camera with no shoulder offset still looks straight at the player', async () => {
  const world = await createTestWorld();
  world.physics.createGround(200, -0.5);
  const player = new Player(world);
  player.setPosition(0, 0, 0);
  world.addEntity(player);
  stepWorld(world, 0.5);

  assert.equal(player.springArm.shoulderOffset, config.player.camera.shoulderOffset);
  assert.equal(player.cameraMode, CameraMode.THIRD_PERSON);
  const toFocus = new THREE.Vector3(player.position.x, player.position.y + config.player.camera.thirdPersonTargetHeight, player.position.z)
    .sub(world.camera.position).normalize();
  const forward = world.camera.getWorldDirection(new THREE.Vector3());
  assert.ok(forward.dot(toFocus) > 0.999, 'camera looks at the player focal point');
  world.clearEntities();
});

test('Ocean defaults keep Level 1 waves unchanged; waveScale only scales steepness', () => {
  const sea = new Ocean();
  assert.deepEqual(sea.waveParams.waveA.toArray(), [1.0, 0.3, 0.14, 85.0]);
  assert.deepEqual(sea.waveParams.waveB.toArray(), [0.6, 0.8, 0.10, 52.0]);
  assert.deepEqual(sea.waveParams.waveC.toArray(), [-0.4, 0.7, 0.06, 32.0]);
  assert.deepEqual(sea.waveParams.waveD.toArray(), [0.2, -0.5, 0.03, 18.0]);
  const calm = new Ocean({ waveScale: 0.5 });
  assert.ok(Math.abs(calm.waveParams.waveA.z - 0.07) < 1e-9);
  assert.equal(calm.waveParams.waveA.w, 85.0);
  sea.dispose();
  calm.dispose();
});

test('InputManager: bindings, wheel presses, and mouse moves without errors', () => {
  installBrowserGlobals();
  const input = new InputManager();
  assert.deepEqual(input.actionBindings.toggleCamera, ['KeyV', 'Tab']);
  assert.deepEqual(input.actionBindings.crouch, ['KeyC']);
  assert.ok(input.actionBindings.firePrimary.includes('Mouse0'));
  for (const bindings of Object.values(input.actionBindings)) {
    assert.ok(!bindings.some((key) => key.startsWith('Control')), 'nothing is bound to Ctrl (Chrome reserves Ctrl+W)');
  }

  input._onKeyDown({ code: 'KeyC', preventDefault() {} });
  assert.ok(input.isActionDown('crouch'));
  input._onWheel({ deltaY: 100 });
  assert.ok(input.isActionJustPressed('weaponNext'));
  assert.doesNotThrow(() => input._onMouseMove({ movementX: 3, movementY: -2, clientX: 400, clientY: 300 }));
  input.update();
  assert.equal(input.isActionJustPressed('weaponNext'), false, 'wheel presses last one frame');
  input.dispose();
});

test('ProjectilePool: turret shells still fire, hit, damage and recycle into their own pools', async () => {
  const world = await createTestWorld();
  const pool = new ProjectilePool(world);
  world.addEntity(pool);
  const flakFree = pool.flakPool.length;
  const artilleryFree = pool.artilleryPool.length;

  // A target with health and no faction, like Level 1's ships and turrets
  const target = { name: 'Target', health: new HealthComponent(1000) };
  const body = world.physics.createFixedRigidBody({ position: { x: 0, y: 5, z: -60 } });
  const collider = world.physics.createCollider(world.physics.RAPIER.ColliderDesc.cuboid(5, 5, 1), body);
  collider.userData = { entity: target };

  const turret = { name: 'Turret' }; // Level 1 turrets carry no faction
  pool.fireArtillery({ origin: new THREE.Vector3(0, 5, 0), direction: new THREE.Vector3(0, 0, -1), source: turret });
  pool.fireFlak({ origin: new THREE.Vector3(0, 50, 0), direction: new THREE.Vector3(0, 1, 0), source: turret });
  assert.equal(pool.artilleryPool.length, artilleryFree - 1);
  assert.equal(pool.flakPool.length, flakFree - 1);

  stepWorld(world, config.projectiles.artillery.maxLifeTime + 0.5);
  assert.equal(target.health.currentHealth, 1000 - config.projectiles.artillery.damage, 'shell damaged the target');
  assert.equal(pool.artilleryPool.length, artilleryFree, 'shell recycled to the artillery pool');
  assert.equal(pool.flakPool.length, flakFree, 'flak recycled to the flak pool');
  world.clearEntities();
});

test('Level 1 battleship: a player spawned on deck stays on deck', async () => {
  const world = await createTestWorld();
  const ship = new Battleship(world, { position: new THREE.Vector3(0, 0, 0) });
  await ship.ready;
  world.addEntity(ship);
  ship.initPhysics(world.physics);

  const player = new Player(world, { walkSpeed: 8.0, sprintSpeed: 14.0, jumpForce: 10.0 });
  player.setPosition(0.46, 6.2, -14.0); // Level01's spawn on the forward deck
  world.addEntity(player);
  stepWorld(world, 2);
  assert.ok(player.position.y > 4.5 && player.position.y < 7, `player y ${player.position.y.toFixed(2)}`);
  assert.equal(player.isGrounded, true);

  world.input.hold('forward');
  stepWorld(world, 1);
  world.input.release('forward');
  assert.ok(player.position.y > 4.5, 'still on deck after walking');

  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});
