// Alien brute: charge and slam, outrunning it, and the weak spot on its back.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld } from './support/testWorld.mjs';
import { BeachEnvironment } from '../src/levels/level02/BeachEnvironment.js';
import { BeachCover } from '../src/levels/level02/BeachCover.js';
import { Player } from '../src/entities/Player.js';
import { AlienBrute } from '../src/entities/enemies/AlienBrute.js';
import { AlienSquad } from '../src/ai/AlienSquad.js';
import { HitscanWeapon } from '../src/weapons/HitscanWeapon.js';
import config from '../src/config.json';

let world;
let env;
let cover;
let player;
let squad;

before(async () => {
  world = await createTestWorld({ seed: 11 });
  env = new BeachEnvironment(world);
  env.build();
  cover = new BeachCover(world, env, []);
  cover.build();
});

after(() => {
  cover.dispose();
  env.dispose();
});

beforeEach(() => {
  player = new Player(world, { snapToGround: true, maxHealth: 100 });
  world.addEntity(player);
  squad = new AlienSquad(world, { targets: [player], cover, alertRadius: 25, corpseSeconds: 4 });
});

afterEach(() => {
  squad.dispose();
  world.input.down.clear();
  world.clearEntities();
});

const level = { isInitialized: true, gameplayUpdate: () => squad.update() };
const pathX = (z) => env.pathCentreX(z); // The jungle path is kept clear of rocks and trees
const at = (z) => new THREE.Vector3(pathX(z), env.heightAt(pathX(z), z) + 0.1, z);

function spawnBrute(z, facePlayer = true) {
  const brute = squad.add(new AlienBrute(world, { position: at(z), squad }));
  if (facePlayer) brute.yaw = Math.atan2(-(player.position.x - brute.position.x), -(player.position.z - brute.position.z));
  return brute;
}

test('a brute charges a player who stands still and slams them', () => {
  const start = at(130);
  player.teleport(start.x, start.y, start.z);
  const brute = spawnBrute(112);
  let charged = false;
  stepWorld(world, 8, {
    level,
    onFrame: () => {
      if (brute.attackPhase === 'charge') charged = true;
      return player.health.currentHealth < 100;
    }
  });
  assert.ok(charged, 'charged');
  assert.equal(player.health.currentHealth, 100 - config.enemies.brute.slamDamage, 'one slam landed');
});

test('sprinting away outruns the charge', () => {
  const start = at(135);
  player.teleport(start.x, start.y, start.z);
  player.yaw = Math.PI; // Facing +Z, away from the brute, down the clear path to the beach
  const brute = spawnBrute(112);
  stepWorld(world, 0.5, { level });
  world.input.hold('forward');
  world.input.hold('sprint');
  stepWorld(world, 4, { level });
  assert.equal(player.health.currentHealth, 100);
  assert.ok(player.position.distanceTo(brute.position) > config.enemies.brute.slamRange + 1);
});

test('shots into the power pack on its back do double damage', () => {
  squad.targets = []; // A brute that is not fighting
  const brute = spawnBrute(120, false);
  brute.yaw = 0; // Faces -Z
  world.physics.step();
  const gun = new HitscanWeapon(config.weapons.machineGun);
  const height = brute.position.y + 2.0;
  const centre = new THREE.Vector3(brute.position.x, height, brute.position.z);

  const front = new THREE.Vector3(brute.position.x, height, brute.position.z - 10);
  let before = brute.health.currentHealth;
  gun.fire({ physicsWorld: world.physics, origin: front, aimPoint: centre, spread: 0, source: player });
  const frontDamage = before - brute.health.currentHealth;

  gun.cooldown = 0;
  const back = new THREE.Vector3(brute.position.x, height, brute.position.z + 10);
  before = brute.health.currentHealth;
  gun.fire({ physicsWorld: world.physics, origin: back, aimPoint: centre, spread: 0, source: player });
  const backDamage = before - brute.health.currentHealth;

  assert.equal(frontDamage, config.weapons.machineGun.damage);
  assert.equal(backDamage, config.weapons.machineGun.damage * config.enemies.brute.weakSpotMultiplier);
});
