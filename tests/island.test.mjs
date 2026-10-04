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

test('vertical rays at round coordinates always hit the ground (no grid-corner gaps)', () => {
  const ray = new world.physics.RAPIER.Ray({ x: 0, y: 200, z: 0 }, { x: 0, y: -1, z: 0 });
  let misses = 0;
  for (let x = -200; x <= 200; x += 4) {
    for (let z = -400; z <= 196; z += 4) {
      ray.origin.x = x;
      ray.origin.z = z;
      if (env.terrain.collider.castRay(ray, 400, true) < 0) misses++;
    }
  }
  assert.equal(misses, 0);
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

test('village layout (Level 3): the north grows to hold a village plateau six times the size; the beach is the same', () => {
  const beach = new BeachEnvironment(world);
  const big = new BeachEnvironment(world, { layout: 'village' });
  assert.equal(big.layoutName, 'village');
  const area = (v) => v.halfWidth * v.halfLength;
  assert.ok(area(big.village) / area(beach.village) >= 6);
  for (const [dx, dz] of [[0, 0], [0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9], [0.6, 0.6]]) {
    const v = big.village;
    assert.ok(Math.abs(big.heightAt(v.x + dx * v.halfWidth, v.z + dz * v.halfLength) - v.height) < 0.01, 'flat plateau');
  }
  assert.ok(big.inlandDistance(big.village.x, big.village.z - big.village.halfLength) > 60, 'land beyond the village');
  assert.ok(big.inlandDistance(big.village.x + big.village.halfWidth, big.village.z) > 60, 'land beside the village');
  // South of the island's middle nothing changes: same beach, hills and jungle path as Level 2
  for (const z of [190, 120, 40, -40, -100]) {
    for (const x of [-150, -60, 0, 60, 150]) {
      assert.equal(big.heightAt(x, z), beach.heightAt(x, z), `ground at ${x}, ${z}`);
    }
  }
  // The jungle path climbs up onto the village plateau at the gate
  for (let z = -60; z > big.village.z + big.village.halfLength; z -= 10) {
    const x = big.pathCentreX(z);
    assert.ok(big.slopeAt(x, z) < 0.45, `the path is walkable at z ${z}`);
  }
});

test('jungle path runs north from the beach', () => {
  for (const z of [160, 100, 40, -100]) {
    assert.ok(env.pathDistance(env.pathCentreX(z), z) < 1e-9);
    assert.ok(env.heightAt(env.pathCentreX(z), z) > 0.6, 'path is on land');
  }
});

test('sunset: the sun sits low in the west, and the light, sky and sea all agree on where', () => {
  const sun = env.sunDirection;
  const elevation = Math.asin(sun.y) * 180 / Math.PI;
  assert.ok(elevation > 5 && elevation < 20, `sun ${elevation.toFixed(1)} degrees up`);
  assert.ok(sun.x < -0.8, 'in the west (to the left looking inland)');

  const light = env.lights.find((l) => l.isDirectionalLight);
  const fromLight = light.position.clone().sub(light.target.position).normalize();
  assert.ok(fromLight.distanceTo(sun) < 1e-6, 'sunlight comes from the sun');
  assert.ok(env.sky.uniforms.uSunDirection.value.distanceTo(sun) < 1e-6, 'sun disc in the sky');
  assert.ok(env.ocean.uniforms.uSunDirection.value.clone().normalize().distanceTo(sun) < 1e-6, 'glint on the sea');

  // The sky's horizon haze is the fog colour, so distant land and sea melt into it
  assert.equal(env.sky.uniforms.uHorizonColor.value.getHex(), world.scene.fog.color.getHex());
  assert.ok(env.sky.mesh.parent === world.environmentGroup && env.sky.mesh.frustumCulled === false);
});

test('clouds: a ring of low-poly clouds high in the sky that stays around the camera', () => {
  const clouds = env.clouds;
  assert.ok(clouds.mesh.parent === world.environmentGroup);
  assert.ok(clouds.puffCount >= 100, `${clouds.puffCount} puffs`);
  assert.equal(clouds.instances.castShadow, false, 'clouds do not shadow the island');
  assert.equal(clouds.material.fog, false, 'fog would hide them');
  const sphere = clouds.instances.boundingSphere;
  assert.ok(sphere.radius > 400 && sphere.radius < 1800, 'far away, but inside the camera range');

  world.camera.position.set(120, 10, -80);
  const yaw = clouds.mesh.rotation.y;
  env.update(1);
  assert.equal(clouds.mesh.position.x, 120);
  assert.equal(clouds.mesh.position.z, -80);
  assert.ok(clouds.mesh.rotation.y > yaw, 'they drift');
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
