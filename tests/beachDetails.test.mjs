import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BeachDetails } from '../src/levels/level02/BeachDetails.js';

function scene() {
  const world = { environmentGroup: new THREE.Group() };
  const environment = {
    inlandDistance: (x, z) => 200 - z - x * x / 2000,
    heightAt: (x, z) => (200 - z - x * x / 2000) * 0.055,
    ocean: { getWaveHeight: (x, z) => Math.sin(x + z) * 0.1 }
  };
  return { world, details: new BeachDetails(world, environment), environment };
}

test('coastal detail is reproducible, surf stays above sand/water, and resources dispose once', () => {
  const a = scene();
  const b = scene();
  assert.deepEqual(a.details.group.children[0].instanceMatrix.array, b.details.group.children[0].instanceMatrix.array);
  for (let step = 0; step < 20; step++) {
    a.details.update(0.5);
    for (const { mesh } of a.details.surf) {
      const p = mesh.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        assert.ok(Number.isFinite(p.getY(i)));
        assert.ok(p.getY(i) >= a.environment.heightAt(p.getX(i), p.getZ(i)));
        assert.ok(p.getY(i) >= a.environment.ocean.getWaveHeight(p.getX(i), p.getZ(i)));
      }
    }
  }
  const resources = new Set();
  a.details.group.traverse(child => {
    if (child.geometry) resources.add(child.geometry);
    if (child.material) resources.add(child.material);
  });
  let disposed = 0;
  resources.forEach(resource => resource.addEventListener('dispose', () => disposed++));
  a.details.dispose();
  assert.equal(disposed, resources.size);
  assert.equal(a.world.environmentGroup.children.length, 0);
  b.details.dispose();
});
