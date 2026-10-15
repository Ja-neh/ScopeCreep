import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { Battleship } from '../src/entities/Battleship.js';
import { EnemyBattleship } from '../src/entities/enemies/EnemyBattleship.js';
import { EnemyJet } from '../src/entities/enemies/EnemyJet.js';
import { ProjectilePool } from '../src/entities/ProjectilePool.js';
import config from '../src/config.json';

const crewCfg = config.ship.crewAI;

/**
 * The shared test model stub ships no gun nodes, so every turret falls back to aiming down its own
 * station group and the whole 180-degree hull turn the real model bakes in goes missing. Attaching
 * stand-in nodes at the GLB positions restores the scene graph the turrets are actually written
 * against, which is what makes "the shells hit" a meaningful assertion here.
 */
function rigGunNodes(ship) {
  const root = new THREE.Group();
  root.rotation.y = Math.PI; // BattleshipModel turns the imported hull 180 degrees
  ship.mesh.add(root);

  const node = (parent, x, y, z) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };

  const forward = node(root, -0.46, 8.05, 21.10);
  ship.mainGun.attachTurretNodes(forward, node(forward, 0.0, -0.10, 1.43));
  const aft = node(root, -0.46, 9.90, 10.07);
  ship.mainGunBack.attachTurretNodes(aft, node(aft, 0.0, -0.10, 1.43));
  const flak = node(root, -0.46, 7.11, -29.82);
  ship.flakTurret.attachTurretNodes(flak, node(flak, -0.01, 1.45, 0.80));
}

async function buildCrewedShip(world, { crewAI = true, position = new THREE.Vector3(0, 0, 0) } = {}) {
  const pool = new ProjectilePool(world);
  world.addEntity(pool);
  world.projectilePool = pool;

  const ship = new Battleship(world, { position, crewAI });
  await ship.ready;
  world.addEntity(ship);
  ship.initPhysics(world.physics);
  return ship;
}

function range(a, b) {
  return Math.hypot(a.mesh.position.x - b.mesh.position.x, a.mesh.position.z - b.mesh.position.z);
}

/** Where the flak barrels are really pointing, read the same way the mount's own firing code does. */
function flakBarrelAim(turret, outDir, outPos) {
  turret.pitchGroup.updateWorldMatrix(true, false);
  outDir.set(0, 0, -1).transformDirection(turret.pitchGroup.matrixWorld);
  outPos.setFromMatrixPosition(turret.pitchGroup.matrixWorld);
}

test('the AI crew is aboard only where the level asks for it, and starts waiting for orders', async () => {
  const world = await createTestWorld();

  const uncrewed = new Battleship(world, { position: new THREE.Vector3(0, 0, 0) });
  await uncrewed.ready;
  world.addEntity(uncrewed);
  uncrewed.initPhysics(world.physics);
  assert.equal(uncrewed.crewAI.enabled, false, 'a ship the level did not crew keeps its AI idle');

  const crewed = new Battleship(world, { position: new THREE.Vector3(0, 0, 600), crewAI: true });
  await crewed.ready;
  world.addEntity(crewed);
  crewed.initPhysics(world.physics);
  assert.equal(crewed.crewAI.enabled, true, 'the crewAI option puts a crew aboard');
  assert.equal(crewed.crewAI.order, crewCfg.orders.default, 'the crew waits on HOLD until told otherwise');

  world.clearEntities();
  assert.equal(bodyCount(world), 0, 'clean teardown');
});

test('HOLD brings the ship to a stop and leaves it lying still', async () => {
  const world = await createTestWorld();
  const ship = await buildCrewedShip(world);
  const helm = ship.shipController;

  helm.speed = 12;
  helm.heading = 0;
  const start = ship.mesh.position.clone();

  stepWorld(world, 6);

  assert.ok(Math.abs(helm.speed) < 0.05, `ship stopped, still making ${helm.speed} m/s`);
  assert.equal(helm.rudderAngle, 0, 'rudder amidships');

  stepWorld(world, 2);
  const drift = ship.mesh.position.distanceTo(start);
  assert.ok(drift < 40, `ship held station, drifting ${drift.toFixed(1)} m from where it stopped`);

  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('[G] cycles HOLD -> ENGAGE -> FOLLOW and calls each order out to the player', async () => {
  const world = await createTestWorld();
  const ship = await buildCrewedShip(world);

  const seen = [ship.crewAI.order];
  for (let i = 0; i < 3; i++) {
    world.input.press('cycleShipOrder');
    stepWorld(world, 1 / 60);
    seen.push(ship.crewAI.order);
  }

  assert.deepEqual(seen, ['hold', 'engage', 'follow', 'hold'], 'orders cycle and wrap round');
  assert.equal(world.ui.callsTo('showToast').length, 3, 'the player is told each new order');

  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('the order key is dead while the player is at the helm', async () => {
  const world = await createTestWorld();
  const ship = await buildCrewedShip(world);

  ship.shipController.isMounted = true;
  world.input.press('cycleShipOrder');
  stepWorld(world, 1 / 60);

  assert.equal(ship.crewAI.order, 'hold', 'the crew does not take orders from a manned helm');
  assert.equal(world.ui.callsTo('showToast').length, 0, 'and does not shout about them');

  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('ENGAGE runs at the enemy ship and the crew sinks it', async () => {
  const world = await createTestWorld();
  const ship = await buildCrewedShip(world);
  rigGunNodes(ship);

  const enemy = new EnemyBattleship(world, {
    position: new THREE.Vector3(0, 0, -420),
    target: ship
  });
  await enemy.ready;
  world.addEntity(enemy);
  enemy.initPhysics(world.physics);

  ship.crewAI.order = 'engage';
  const startRange = range(ship, enemy);

  stepWorld(world, 10);

  assert.ok(ship.crewAI.navalTarget === null || ship.crewAI.navalTarget === enemy,
    'the crew picked the enemy warship as its gunnery target');
  assert.ok(range(ship, enemy) < startRange, `ship closed on the enemy (${startRange.toFixed(0)} m -> ${range(ship, enemy).toFixed(0)} m)`);
  assert.equal(enemy.isDestroyed, true, 'the crew fought the enemy ship down and sank it');

  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('a gun the player is manning is left entirely to the player', async () => {
  const world = await createTestWorld();
  const ship = await buildCrewedShip(world);
  rigGunNodes(ship);

  const enemy = new EnemyBattleship(world, {
    position: new THREE.Vector3(0, 0, -300),
    target: ship
  });
  await enemy.ready;
  world.addEntity(enemy);
  enemy.initPhysics(world.physics);

  // Player climbs into the forward turret; the rear one stays crewed.
  ship.mainGun.isMounted = true;
  const yawBefore = ship.mainGun.yaw;
  const pitchBefore = ship.mainGun.pitch;

  stepWorld(world, 4);

  assert.equal(ship.mainGun.yaw, yawBefore, 'the crew never traversed the manned gun');
  assert.equal(ship.mainGun.pitch, pitchBefore, 'the crew never elevated the manned gun');
  assert.equal(ship.mainGun.fireCooldown, 0, 'the crew never fired the manned gun');
  assert.ok(ship.mainGunBack.fireCooldown !== 0 || enemy.health.currentHealth < enemy.health.maxHealth,
    'the unmanned rear gun is still fighting');

  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('FOLLOW keeps station on a friendly escort', async () => {
  const world = await createTestWorld();
  const ship = await buildCrewedShip(world);

  const escort = new Battleship(world, { position: new THREE.Vector3(0, 0, -380) });
  await escort.ready;
  world.addEntity(escort);
  escort.initPhysics(world.physics);

  ship.crewAI.order = 'follow';
  const start = ship.mesh.position.clone();
  stepWorld(world, 1.5);

  assert.ok(ship.crewAI.followTarget === escort, 'the crew found the friendly warship to follow');
  assert.equal(ship.shipController.speed, crewCfg.orders.follow.catchUpSpeed, 'far behind, it hurries');
  assert.ok(ship.mesh.position.distanceTo(start) > 5, 'and it is making way toward the escort');

  // Bring the escort inside the follow distance, abeam so the two hulls are not overlapping.
  escort.mesh.position.set(100, 0, 0);
  ship.mesh.position.set(0, 0, 0);
  stepWorld(world, 1.5);

  assert.ok(Math.abs(ship.shipController.speed) < 1e-6, 'inside the follow distance the ship stops');
  assert.ok(ship.mesh.position.length() < 0.01, 'and stays put instead of drifting into the escort');

  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('the flak crew leads a moving aircraft instead of shooting where it is', async () => {
  const world = await createTestWorld();
  const ship = await buildCrewedShip(world);

  const muzzle = new THREE.Vector3(0, 8, 0);
  const jet = {
    mesh: { position: new THREE.Vector3(0, 130, -420) },
    velocity: new THREE.Vector3(config.enemyJet.cruiseSpeed, 0, 0)
  };

  const aim = ship.crewAI._solveLead(jet, muzzle, crewCfg.gunnery.flak.leadIterations, new THREE.Vector3());
  const flak = config.projectiles.flak;

  assert.ok(aim.x > 20, `the aim point sits well ahead of the jet along its flight path (x=${aim.x.toFixed(1)})`);

  // Self-consistency: at the flight time the aim point implies, the jet is at the aim point.
  const flightTime = aim.distanceTo(muzzle) / flak.speed;
  const predictedX = jet.mesh.position.x + jet.velocity.x * flightTime;
  const predictedZ = jet.mesh.position.z + jet.velocity.z * flightTime;
  assert.ok(Math.abs(aim.x - predictedX) < 0.5, `lead converged in X (${aim.x.toFixed(2)} vs ${predictedX.toFixed(2)})`);
  assert.ok(Math.abs(aim.z - predictedZ) < 0.5, `lead converged in Z (${aim.z.toFixed(2)} vs ${predictedZ.toFixed(2)})`);
  assert.ok(aim.y > jet.mesh.position.y, 'the aim point is held above the jet to cover ballistic drop');

  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('the flak crew swings onto a hostile jet, tracks it and shoots it up', async () => {
  const world = await createTestWorld();
  const ship = await buildCrewedShip(world);
  rigGunNodes(ship);

  const jet = new EnemyJet(world, { position: new THREE.Vector3(0, 140, -520), target: ship });
  world.addEntity(jet);

  stepWorld(world, 6);

  assert.ok(ship.crewAI.airTarget === jet, 'the crew spotted the aircraft');

  world.scene.updateMatrixWorld(true);
  const dir = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  flakBarrelAim(ship.flakTurret, dir, muzzle);
  const toJet = new THREE.Vector3().subVectors(jet.mesh.position, muzzle).normalize();
  const errDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(dir.dot(toJet), -1, 1)));
  assert.ok(errDeg < 5, `the barrels are actually laid on the jet, off by ${errDeg.toFixed(1)} degrees`);

  assert.ok(jet.health.currentHealth < jet.health.maxHealth, 'and flak fire is scoring hits on it');

  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('rounds from the crew\'s guns are flagged to fly through their own ship', async () => {
  const world = await createTestWorld();
  const ship = await buildCrewedShip(world);
  rigGunNodes(ship);

  // A ship's hull trimesh and its gun mounts all hang off one kinematic body, so excluding only the
  // hull collider would still let a low round strike the mount it was fired from.
  ship.flakTurret.fireAI();
  ship.mainGun.fireAI();

  const flak = world.projectilePool.activeProjectiles.find((p) => p.type === 'FLAK');
  const shell = world.projectilePool.activeProjectiles.find((p) => p.type === 'ARTILLERY');

  for (const [label, round] of [['flak', flak], ['artillery', shell]]) {
    assert.ok(round, `${label} round left the barrel`);
    assert.ok(round.excludeCollider === ship.colliders.collider, `${label} ignores its own hull`);
    assert.ok(round.excludeRigidBody === ship.colliders.rigidBody, `${label} ignores every collider on its own ship`);
  }

  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('the crew stands down when the ship is lost', async () => {
  const world = await createTestWorld();
  const ship = await buildCrewedShip(world);
  const helm = ship.shipController;

  ship.crewAI.order = 'engage';
  ship.health.takeDamage({ amount: 1e6, type: 'EXPLOSIVE' });

  assert.equal(ship.isDestroyed, true, 'ship is wrecked');
  assert.equal(ship.crewAI.enabled, false, 'the crew stops working');
  assert.equal(helm.speed, 0, 'engines stopped');

  helm.heading = 0;
  const wreck = ship.mesh.position.clone();
  stepWorld(world, 3);

  assert.ok(ship.mesh.position.distanceTo(wreck) < 0.01, 'the wreck no longer answers the helm');

  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});
