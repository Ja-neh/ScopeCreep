// Ambient life over the bay: the gull flock (see BeachGulls). Pure visual, but it must hold its
// own circle over the water — never over the island the mission fights on — actually fly, and
// leave nothing behind on teardown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { Level02 } from '../src/levels/Level02.js';
import { Level02TestLevel } from '../src/levels/Level02TestLevel.js';

test('Level 2: the gulls work the bay, clear of the beach the mission uses', async () => {
  const world = await createTestWorld({ seed: 5 });
  const level = new Level02(world);
  await level.init();

  const gulls = level.gulls;
  assert.ok(gulls, 'the flock is up');
  assert.equal(gulls.birds.length, 8, 'a loose flock of eight');
  assert.equal(gulls.mesh.parent, world.environmentGroup, 'it lives with the environment');

  for (const bird of gulls.birds) {
    const p = bird.node.position;
    assert.ok(p.z > 200, `over the bay, not the island (z ${p.z.toFixed(0)})`);
    assert.ok(p.y > 16 && p.y < 60, `flying (y ${p.y.toFixed(0)})`);
  }

  // Every bird works its own circle: all of them move, and none dips toward the ground or drifts inland
  const before = gulls.birds.map((bird) => bird.node.position.clone());
  let minY = Infinity;
  let minZ = Infinity;
  stepWorld(world, 8, {
    level,
    onFrame: () => {
      for (const bird of gulls.birds) {
        minY = Math.min(minY, bird.node.position.y);
        minZ = Math.min(minZ, bird.node.position.z);
      }
    }
  });
  for (let i = 0; i < gulls.birds.length; i++) {
    const moved = gulls.birds[i].node.position.distanceTo(before[i]);
    assert.ok(moved > 3, `bird ${i} is flying (moved ${moved.toFixed(1)} m)`);
  }
  assert.ok(minY > 16, `the flock stays up (lowest ${minY.toFixed(1)} m)`);
  assert.ok(minZ > 198, `the flock stays over the water (deepest ${minZ.toFixed(1)} m)`);

  level.dispose();
  world.clearEntities();
  assert.equal(bodyCount(world), 0, 'no physics bodies');
  assert.equal(world.environmentGroup.children.length, 0, 'the flock left the scene');
});

test('the sandbox carries the flock too, and lets it go', async () => {
  const world = await createTestWorld({ seed: 5 });
  const level = new Level02TestLevel(world);
  await level.init();
  assert.ok(level.gulls && level.gulls.birds.length === 8, 'the sandbox sky has birds');

  level.dispose();
  world.clearEntities();
  assert.equal(world.environmentGroup.children.length, 0, 'and they leave with it');
});
