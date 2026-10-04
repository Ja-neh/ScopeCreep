// WeaponController: machine gun, reload, knife and backstab, quick knife, aim zoom, cleanup.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { BeachEnvironment } from '../src/levels/level02/BeachEnvironment.js';
import { Player } from '../src/entities/Player.js';
import { TrainingDummy } from '../src/entities/TrainingDummy.js';
import { WeaponController } from '../src/weapons/WeaponController.js';
import config from '../src/config.json';

let world;
let env;
let player;
let weapons;

before(async () => {
  world = await createTestWorld();
  env = new BeachEnvironment(world);
  env.build();
});

after(() => env.dispose());

beforeEach(() => {
  player = new Player(world, { snapToGround: true, canCrouch: true, maxHealth: 100 });
  world.addEntity(player);
  weapons = new WeaponController(world, player);
  world.addEntity(weapons);
});

afterEach(() => {
  world.input.down.clear();
  world.clearEntities();
});

const ground = (x, z) => env.heightAt(x, z);
function place(x, z, yaw = 0, pitch = 0) {
  player.teleport(x, ground(x, z) + 0.05, z);
  player.yaw = yaw;
  player.pitch = pitch;
  stepWorld(world, 0.2);
}
function dummyAt(x, z, facing) {
  const dummy = new TrainingDummy(world, { position: new THREE.Vector3(x, ground(x, z), z), facing });
  world.addEntity(dummy);
  return dummy;
}

test('machine gun drops a dummy 12 m away with the crosshair on it', () => {
  const dummy = dummyAt(0, 150, Math.PI);
  // Over-the-shoulder camera: the crosshair is 0.75 m right of the player, so stand left of the target
  place(-0.75, 162);
  world.input.hold('firePrimary');
  stepWorld(world, 2, { onFrame: () => dummy.health.isDead });
  world.input.release('firePrimary');

  assert.ok(dummy.health.isDead, `dummy has ${dummy.health.currentHealth} hp left`);
  const fired = config.weapons.machineGun.magazine - weapons.rifle.ammo;
  const needed = Math.ceil(config.testing.trainingDummy.maxHealth / config.weapons.machineGun.damage);
  assert.ok(fired <= needed + 2, `${fired} rounds for ${needed} needed`);
  assert.ok(world.ui.callsTo('flashCrosshairHit').some((call) => call.args[0] === true), 'kill marker shown');
  assert.equal(player.pitch, 0, 'no recoil: the aim does not climb');
  assert.equal(player.yaw, 0, 'no recoil: the aim does not wander');
});

test('the gun never hurts its shooter', () => {
  place(0, 160, 0, -1.2); // Aim at your own feet
  world.input.hold('firePrimary');
  stepWorld(world, 1);
  world.input.release('firePrimary');
  assert.equal(player.health.currentHealth, player.health.maxHealth);
});

test('an empty magazine reloads automatically from reserve', () => {
  place(0, 170, 0, 1.2); // Into the sky
  world.input.hold('firePrimary');
  stepWorld(world, 3.5, { onFrame: () => weapons.rifle.isReloading });
  assert.ok(weapons.rifle.isReloading, 'reload started when empty');
  world.input.release('firePrimary');
  stepWorld(world, config.weapons.machineGun.reloadSeconds + 0.2);
  assert.equal(weapons.rifle.ammo, config.weapons.machineGun.magazine);
  assert.equal(weapons.rifle.reserve, config.weapons.machineGun.reserveAmmo - config.weapons.machineGun.magazine);
});

test('R reloads a partly used magazine', () => {
  place(0, 170, 0, 1.2);
  world.input.hold('firePrimary');
  stepWorld(world, 0.5);
  world.input.release('firePrimary');
  const before = weapons.rifle.ammo;
  assert.ok(before < config.weapons.machineGun.magazine);
  world.input.press('reload');
  stepWorld(world, config.weapons.machineGun.reloadSeconds + 0.2);
  assert.equal(weapons.rifle.ammo, config.weapons.machineGun.magazine);
});

test('knife: a backstab kills in one hit, a stab from the front does not', () => {
  const back = dummyAt(30, 150, 0); // Faces -Z, away from a player standing to its south
  place(30, 151.3, 0);
  world.input.press('weaponMelee');
  stepWorld(world, 0.5);
  world.input.press('firePrimary');
  stepWorld(world, 0.4);
  assert.ok(back.health.isDead, 'backstab kills');

  const front = dummyAt(-30, 150, Math.PI); // Faces the player
  place(-30, 151.3, 0);
  stepWorld(world, 0.7);
  world.input.press('firePrimary');
  stepWorld(world, 0.4);
  assert.equal(front.health.currentHealth, config.testing.trainingDummy.maxHealth - config.weapons.knife.damage);
});

test('Q stabs without putting the gun away', () => {
  const dummy = dummyAt(-30, 150, Math.PI);
  place(-30, 151.3, 0);
  world.input.press('quickMelee');
  stepWorld(world, 0.1);
  assert.equal(weapons.activeWeapon, 'knife');
  stepWorld(world, 1);
  assert.equal(weapons.activeWeapon, 'rifle');
  assert.ok(dummy.health.currentHealth < config.testing.trainingDummy.maxHealth, 'the quick stab landed');
});

test('aiming down sights zooms in; crouching and aiming tighten the spread', () => {
  place(0, 160);
  const hipSpread = weapons.rifle.currentSpread({ aiming: false, moving: false, crouching: false });
  assert.ok(weapons.rifle.currentSpread({ aiming: true, moving: false, crouching: false }) < hipSpread);
  assert.ok(weapons.rifle.currentSpread({ aiming: false, moving: false, crouching: true }) < hipSpread);
  assert.ok(weapons.rifle.currentSpread({ aiming: false, moving: true, crouching: false }) > hipSpread);

  world.input.hold('aimDownSights');
  stepWorld(world, 0.5);
  assert.ok(world.camera.fov < 50, `fov ${world.camera.fov.toFixed(1)}`);
  world.input.release('aimDownSights');
  stepWorld(world, 0.6);
  assert.ok(world.camera.fov > 58);
});

test('removing the weapons restores the camera and frees the effects', async () => {
  const w = await createTestWorld();
  const p = new Player(w, {});
  w.addEntity(p);
  const baseFov = w.camera.fov;
  const baseShoulder = p.springArm.shoulderOffset;
  const controller = new WeaponController(w, p);
  w.addEntity(controller);
  assert.notEqual(p.springArm.shoulderOffset, baseShoulder);
  w.removeEntity(controller);
  assert.equal(w.camera.fov, baseFov);
  assert.equal(p.springArm.shoulderOffset, baseShoulder);
  assert.equal(w.effectsGroup.children.length, 0);
  w.clearEntities();
  assert.equal(bodyCount(w), 0);
});
