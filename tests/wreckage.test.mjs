// BeachWreckage: the first escape attempt's remains on the sand — two burned boats with their
// spilled crates and fallen soldiers, placed off the landing clearings and the walk inland,
// solid where they should be, and gone completely after dispose.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorld, bodyCount } from './support/testWorld.mjs';
import { BeachEnvironment } from '../src/levels/level02/BeachEnvironment.js';
import { LandingZone } from '../src/levels/level02/LandingZone.js';
import { BeachWreckage } from '../src/levels/level02/BeachWreckage.js';
import { Level02 } from '../src/levels/Level02.js';

let world;
let env;
let landingZone;
let wreckage;

before(async () => {
  world = await createTestWorld();
  env = new BeachEnvironment(world);
  env.build();
  landingZone = new LandingZone(world, env);
  await landingZone.build();
  wreckage = new BeachWreckage(world, env, { clearings: landingZone.clearings });
  wreckage.build();
});

after(() => {
  wreckage.dispose();
  landingZone.dispose();
  env.dispose();
  world.clearEntities();
});

/** Raycasts straight down onto a spot and reports where it hit (ground, deck or crate top). */
function surfaceAt(x, z) {
  const originY = env.heightAt(x, z) + 10;
  const ray = new world.physics.RAPIER.Ray({ x, y: originY, z }, { x: 0, y: -1, z: 0 });
  const hit = world.physics.castRay(ray, 20, true);
  return hit ? originY - hit.timeOfImpact : null;
}

test('two burned boats lie on the sand, each with a debris field around it', () => {
  assert.equal(wreckage.boats.length, 2);
  assert.deepEqual(wreckage.boats.map((boat) => boat.mesh.name), ['Wreck_LandingCraft', 'Wreck_PatrolBoat']);
  assert.ok(wreckage.crates.length >= 3, `only ${wreckage.crates.length} crates`);
  assert.ok(wreckage.soldiers.length >= 3, `only ${wreckage.soldiers.length} fallen soldiers`);
  assert.ok(wreckage.count >= 9);

  // The fallen lie sprawled by their boats, close but not on top of them
  for (const soldier of wreckage.soldiers) {
    const nearest = Math.min(...wreckage.boats.map((boat) => Math.hypot(soldier.x - boat.x, soldier.z - boat.z)));
    assert.ok(nearest > 2.5 && nearest < 11.5, `soldier ${nearest.toFixed(1)} m from its boat`);
  }
});

test('every prop sits on dry sand, clear of the landings and the walk up the beach', () => {
  const props = [
    ...wreckage.boats.map((boat) => ({ x: boat.x, z: boat.z, what: 'boat' })),
    ...wreckage.crates.map((crate) => ({ x: crate.x, z: crate.z, what: 'crate' })),
    ...wreckage.soldiers.map((soldier) => ({ x: soldier.x, z: soldier.z, what: 'soldier' }))
  ];
  for (const prop of props) {
    assert.ok(env.heightAt(prop.x, prop.z) >= 0.25, `${prop.what} at (${prop.x.toFixed(0)}, ${prop.z.toFixed(0)}) is in the wash`);
    assert.ok(env.pathDistance(prop.x, prop.z) > 2, `${prop.what} blocks the walk inland`);
    for (const clearing of landingZone.clearings) {
      const distance = Math.hypot(prop.x - clearing.x, prop.z - clearing.z);
      assert.ok(distance >= clearing.radius, `${prop.what} stands in a landing clearing`);
    }
  }
});

test('boats and crates are chest-high cover; the fallen are not solid', () => {
  assert.equal(wreckage.colliders.length, wreckage.boats.length + wreckage.crates.length,
    'every boat and crate has its own collider');
  assert.ok(wreckage.colliders.every((collider) => collider.rigidBody && collider.rigidBody.isFixed()));

  // Scene queries only see the world once it has stepped at least once
  world.physics.step(1 / 60);

  // A ray dropped on a boat comes down on the hull, well above the sand
  for (const boat of wreckage.boats) {
    const surface = surfaceAt(boat.x, boat.z);
    assert.ok(surface !== null && surface > env.heightAt(boat.x, boat.z) + 0.5,
      `boat hull at ${boat.mesh.name} is not solid`);
  }
  // ...and a ray on a crate stops on its top, around half a meter up
  for (const crate of wreckage.crates) {
    const surface = surfaceAt(crate.x, crate.z);
    const ground = env.heightAt(crate.x, crate.z);
    assert.ok(surface !== null && surface > ground + 0.35 && surface < ground + 1.8,
      `crate top at ${(surface - ground).toFixed(2)} m above the sand`);
  }
});

test('Level 2 builds the wreckage too, clear of every clearing the mission uses', async () => {
  const w = await createTestWorld({ seed: 5 });
  const level = new Level02(w);
  await level.init();
  assert.ok(level.wreckage, 'the level carries the wreckage');
  assert.equal(level.wreckage.boats.length, 2);
  assert.ok(level.wreckage.count >= 9);

  const clearings = level._clearings();
  const props = [
    ...level.wreckage.boats.map((boat) => ({ x: boat.x, z: boat.z, what: 'boat' })),
    ...level.wreckage.crates.map((crate) => ({ x: crate.x, z: crate.z, what: 'crate' })),
    ...level.wreckage.soldiers.map((soldier) => ({ x: soldier.x, z: soldier.z, what: 'soldier' }))
  ];
  for (const prop of props) {
    for (const clearing of clearings) {
      const distance = Math.hypot(prop.x - clearing.x, prop.z - clearing.z);
      assert.ok(distance >= clearing.radius, `${prop.what} stands in a clearing the mission uses`);
    }
  }

  level.dispose();
  w.clearEntities();
  assert.equal(bodyCount(w), 0, 'no physics bodies left');
  assert.equal(w.environmentGroup.children.length, 0);
});

test('dispose takes the wreck, its colliders and its soldiers with it', async () => {
  const w = await createTestWorld();
  const e = new BeachEnvironment(w);
  e.build();
  const base = bodyCount(w); // The island itself (terrain and such) is solid
  const wreck = new BeachWreckage(w, e, { clearings: [] });
  wreck.build();
  assert.equal(bodyCount(w), base + wreck.boats.length + wreck.crates.length, 'only the wreck is solid');

  wreck.dispose();
  assert.equal(bodyCount(w), base, 'the wreck took its own bodies with it');
  assert.ok(w.environmentGroup.children.length > 0, 'the island itself is still there');
  e.dispose();
  assert.equal(w.environmentGroup.children.length, 0);
  assert.equal(bodyCount(w), 0);
});
