import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { CharacterVisual, CHARACTER_IDS } from '../src/entities/models/CharacterVisual.js';

function fixture() {
  const scene = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ emissive: 0x102030 });
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.5), material));
  return { scene };
}

test('a successful skin replaces fallback visuals, isolates damage materials, and normalizes at the feet', async () => {
  const parent = new THREE.Group();
  parent.position.set(100, 20, -50);
  parent.scale.setScalar(2.3);
  const fallback = new THREE.Mesh();
  parent.add(fallback);
  const asset = fixture();
  let releases = 0;
  const visual = new CharacterVisual(parent, 'deadpool', { enabled: true, hide: [fallback], height: 2,
    acquireAsset: () => ({ promise: Promise.resolve(asset), release: () => releases++ }) });
  assert.equal(fallback.visible, true);
  assert.equal(await visual.ready, true);
  assert.equal(fallback.visible, false);
  visual.group.removeFromParent();
  const bounds = new THREE.Box3().setFromObject(visual.group);
  assert.ok(Math.abs(bounds.min.y) < 1e-6);
  assert.ok(Math.abs(bounds.max.y - 2) < 1e-6);
  visual.setHitFlash(1);
  assert.notEqual(visual.materials[0], asset.scene.children[0].material);
  assert.ok(visual.materials[0].emissive.r > 0.6);
  visual.setHitFlash(0);
  assert.equal(visual.materials[0].emissive.getHex(), 0x102030);
  visual.setVisible(false);
  assert.equal(visual.group.visible, false);
  visual.setCrouchAmount(1);
  assert.equal(visual.crouch, 1);
  assert.equal(visual.group.scale.y, 1, 'crouching must preserve limb lengths');
  visual.dispose();
  visual.dispose();
  assert.equal(releases, 1);
  assert.equal(fallback.visible, true);
});

test('late load cannot attach to a disposed actor; failures retain the procedural avatar', async () => {
  let resolve, released = 0;
  const parent = new THREE.Group(), fallback = new THREE.Mesh();
  const visual = new CharacterVisual(parent, 'ashe', { enabled: true, hide: [fallback],
    acquireAsset: () => ({ promise: new Promise(r => { resolve = r; }), release: () => released++ }) });
  visual.dispose();
  resolve(fixture());
  assert.equal(await visual.ready, false);
  assert.equal(parent.children.length, 0);
  assert.equal(released, 1);
  const failed = new CharacterVisual(parent, 'ashe', { enabled: true, hide: [fallback],
    acquireAsset: () => ({ promise: Promise.reject(new Error('expected missing asset')), release() {} }) });
  assert.equal(await failed.ready, false);
  assert.equal(fallback.visible, true);
  failed.dispose();
});

test('all shipped characters are self-contained, skinned, single-material assets within runtime budgets', () => {
  for (const id of CHARACTER_IDS) {
    const bytes = fs.readFileSync(new URL(`../public/assets/characters/${id}.glb`, import.meta.url));
    assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    const size = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + size));
    assert.ok(bytes.length < 12 * 1024 * 1024, `${id}: download budget`);
    assert.equal(gltf.images.length, 1, `${id}: atlas`);
    assert.ok(gltf.images.every(image => image.bufferView !== undefined && !image.uri));
    assert.ok(gltf.buffers.every(buffer => !buffer.uri));
    assert.equal(gltf.materials.length, 1);
    assert.equal(gltf.meshes.reduce((n, m) => n + m.primitives.length, 0), 1);
    assert.ok(gltf.skins.every(s => s.joints.length <= 24), `${id}: joint budget`);
    const primitive = gltf.meshes[0].primitives[0];
    assert.ok(primitive.attributes.JOINTS_0 !== undefined && primitive.attributes.WEIGHTS_0 !== undefined);
    assert.ok(gltf.accessors[primitive.indices].count / 3 <= 20000, `${id}: triangle budget`);
    for (const role of ['hips', 'spine', 'leftThigh', 'rightThigh']) {
      assert.ok(gltf.nodes.some(n => n.name === `SC_${role}`), `${id}: ${role}`);
    }
  }
});
