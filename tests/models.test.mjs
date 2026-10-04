// Character models: few draw calls per character, colours and glow kept, clean disposal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AlienModel } from '../src/entities/models/AlienModel.js';
import { SoldierModel } from '../src/entities/models/SoldierModel.js';

function meshesOf(model) {
  const meshes = [];
  model.mesh.traverse((child) => { if (child.isMesh) meshes.push(child); });
  return meshes;
}

/** True if any vertex of `mesh` has colour `hex` (vertex colours are linear, like Color). */
function hasVertexColor(mesh, hex) {
  const target = new THREE.Color(hex);
  const colors = mesh.geometry.getAttribute('color');
  for (let i = 0; i < colors.count; i++) {
    if (Math.abs(colors.getX(i) - target.r) < 1e-4 && Math.abs(colors.getY(i) - target.g) < 1e-4 && Math.abs(colors.getZ(i) - target.b) < 1e-4) return true;
  }
  return false;
}

test('an alien is drawn in at most 8 pieces, keeping its armour colour and glowing eyes', () => {
  for (const options of [{}, { armorColor: 0x8a3f3f, scale: 1.45, backpack: true }]) {
    const model = new AlienModel(options);
    const meshes = meshesOf(model);
    assert.ok(meshes.length <= 8, `${meshes.length} meshes`);
    assert.ok(meshes.every((mesh) => mesh.castShadow && mesh.geometry.getAttribute('color')), 'shadowed, vertex-coloured');
    assert.ok(meshes.some((mesh) => mesh.material === model.materials.solid && hasVertexColor(mesh, options.armorColor || 0x5d5480)), 'armour colour');
    assert.ok(meshes.some((mesh) => mesh.material === model.materials.light), 'glowing parts');
    assert.ok(model.muzzle.parent === model.gun, 'muzzle still at the rifle tip');
    model.dispose();
  }
});

test('a soldier is drawn in at most 6 pieces, keeping the visor colour', () => {
  const model = new SoldierModel({ visorColor: 0xe76f51 });
  const meshes = meshesOf(model);
  assert.ok(meshes.length <= 6, `${meshes.length} meshes`);
  assert.ok(meshes.some((mesh) => hasVertexColor(mesh, 0xe76f51)), 'orange visor');
  assert.ok(model.muzzle.parent === model.gun);
  model.dispose();
});

test('models still animate, flash when hit, and free every geometry and material on dispose', () => {
  for (const model of [new AlienModel({ backpack: true }), new SoldierModel()]) {
    model.animate(0.1, 3, true);
    model.setFallen(0.5);
    model.setHitFlash(1);
    assert.ok(model.materials.solid.emissive.r > 0.5, 'red flash');

    let disposed = 0;
    const geometries = meshesOf(model).map((mesh) => mesh.geometry);
    for (const geometry of geometries) geometry.addEventListener('dispose', () => disposed++);
    let materialsDisposed = 0;
    for (const material of Object.values(model.materials)) material.addEventListener('dispose', () => materialsDisposed++);
    model.dispose();
    assert.equal(disposed, geometries.length);
    assert.equal(materialsDisposed, Object.keys(model.materials).length);
  }
});
