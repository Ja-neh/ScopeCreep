// BeachEnvironment: the island's layout that other systems (ship, gangway, Level 3) rely on.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorld, bodyCount } from './support/testWorld.mjs';
import { BeachEnvironment } from '../src/levels/level02/BeachEnvironment.js';

let world;
let env;

before(async () => {
  world = await createTestWorld();
  env = new BeachEnvironment(world);
  env.build();
});

after(() => env && env.dispose());

test('landing beach: dry sand at the gangway foot, deep water under the anchored ship', () => {
  const footHeight = env.heightAt(-10, 196);
  assert.ok(footHeight > 0.2 && footHeight < 1.5, `gangway foot ${footHeight}`);
  const waterline = env.heightAt(0, 200);
  assert.ok(waterline > -0.3 && waterline < 0.6, `waterline ${waterline}`);
  assert.ok(env.heightAt(-10, 214) < -5, 'ship side clears the sea floor');
  assert.ok(env.heightAt(0, 225) < -8, 'ship keel clears the sea floor');
});

test('beach spawn point is on dry ground', () => {
  const spawn = env.spawnPoints.beach;
  assert.ok(env.heightAt(spawn.x, spawn.z) > 0.6);
});

test('village plateau is flat and at the far north end', () => {
  const { x, z, radius, height } = env.village;
  assert.ok(z < -300, 'village is at the far end');
  assert.ok(Math.hypot(x - 0, z - 196) > 500, 'village is over 500 m from the landing');
  for (const [dx, dz] of [[0, 0], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) {
    const h = env.heightAt(x + dx * radius, z + dz * radius);
    assert.ok(Math.abs(h - height) < 0.1, `plateau height ${h}`);
  }
});

test('island is about 680 m long and 500 m wide', () => {
  let north = 0;
  for (let z = -300; z > -620; z -= 1) {
    if (env.heightAt(0, z) < 0) { north = z; break; }
  }
  let east = 0;
  for (let x = 0; x < 340; x += 1) {
    if (env.heightAt(x, -150) < 0) { east = x; break; }
  }
  assert.ok(200 - north >= 650, `length ${200 - north}`);
  assert.ok(2 * east >= 450, `width ${2 * east}`);
});

test('jungle path runs north from the beach', () => {
  for (const z of [160, 100, 40, -100]) {
    assert.ok(env.pathDistance(env.pathCentreX(z), z) < 1e-9);
    assert.ok(env.heightAt(env.pathCentreX(z), z) > 0.6, 'path is on land');
  }
});

test('dispose restores the sky and frees the terrain', async () => {
  const w = await createTestWorld();
  const previousBackground = w.scene.background;
  const e = new BeachEnvironment(w);
  e.build();
  assert.notEqual(w.scene.background, previousBackground);
  e.dispose();
  assert.equal(w.scene.background, previousBackground);
  assert.equal(w.environmentGroup.children.length, 0);
  assert.equal(bodyCount(w), 0);
});
