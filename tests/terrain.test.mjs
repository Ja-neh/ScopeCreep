// Terrain: the rendered heightmap and its Rapier heightfield must describe the same ground.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorld, bodyCount } from './support/testWorld.mjs';
import { Terrain } from '../src/rendering/Terrain.js';

// Deliberately lopsided so a swapped row/column order or triangle split shows up
const lopsided = (x, z) => 0.05 * x + 0.2 * z + Math.sin(x * 0.1) * 3 + Math.cos(z * 0.07) * 2;

function worstColliderError(world, terrain, count) {
  const ray = new world.physics.RAPIER.Ray({ x: 0, y: 500, z: 0 }, { x: 0, y: -1, z: 0 });
  let worst = 0;
  for (let i = 0; i < count; i++) {
    const x = terrain.minX + 1 + Math.random() * (terrain.width - 2);
    const z = terrain.minZ + 1 + Math.random() * (terrain.depth - 2);
    ray.origin.x = x;
    ray.origin.z = z;
    const toi = terrain.collider.castRay(ray, 1000, true);
    worst = Math.max(worst, toi >= 0 ? Math.abs((500 - toi) - terrain.getHeightAt(x, z)) : Infinity);
  }
  return worst;
}

test('square terrain: collider matches the mesh everywhere', async () => {
  const world = await createTestWorld();
  const terrain = new Terrain({ width: 200, depth: 200, cellSize: 4, heightAt: lopsided });
  terrain.createCollider(world.physics);
  assert.ok(worstColliderError(world, terrain, 300) < 1e-3);
  terrain.dispose();
});

test('rectangular off-centre terrain: collider matches the mesh everywhere', async () => {
  const world = await createTestWorld();
  const terrain = new Terrain({ width: 120, depth: 280, cellSize: 4, center: { x: 30, z: -70 }, heightAt: lopsided });
  terrain.createCollider(world.physics);
  assert.equal(terrain.segmentsX, 30);
  assert.equal(terrain.segmentsZ, 70);
  assert.ok(worstColliderError(world, terrain, 300) < 1e-3);
  terrain.dispose();
});

test('grid samples equal the source height function', async () => {
  await createTestWorld();
  const terrain = new Terrain({ width: 120, depth: 280, cellSize: 4, center: { x: 30, z: -70 }, heightAt: lopsided });
  for (let ix = 0; ix <= terrain.segmentsX; ix += 3) {
    for (let iz = 0; iz <= terrain.segmentsZ; iz += 7) {
      const x = terrain.minX + ix * 4;
      const z = terrain.minZ + iz * 4;
      assert.ok(Math.abs(terrain.getHeightAt(x, z) - lopsided(x, z)) < 1e-4);
    }
  }
  terrain.dispose();
});

test('dispose removes the heightfield body', async () => {
  const world = await createTestWorld();
  const terrain = new Terrain({ width: 100, depth: 100, cellSize: 4, heightAt: lopsided });
  terrain.createCollider(world.physics);
  assert.equal(bodyCount(world), 1);
  terrain.dispose();
  assert.equal(bodyCount(world), 0);
});
