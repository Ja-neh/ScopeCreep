import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TwoBoneIK } from '../src/entities/models/TwoBoneIK.js';
import { FirstPersonHands } from '../src/weapons/FirstPersonHands.js';
import { createRifleModel, createWeaponMaterials, disposeModelGeometry } from '../src/weapons/WeaponModels.js';

function limb() {
  const root = new THREE.Group(), upper = new THREE.Bone(), lower = new THREE.Bone(), end = new THREE.Bone();
  lower.position.y = -1; end.position.y = -1;
  root.add(upper); upper.add(lower); lower.add(end);
  root.position.set(4, 2, -3);
  root.rotation.set(0.1, 0.6, -0.2);
  root.updateMatrixWorld(true);
  return { root, upper, lower, end };
}

test('limb reaches the requested contact without stretching either segment', () => {
  const { root, upper, lower, end } = limb();
  const target = root.localToWorld(new THREE.Vector3(0.4, -1.4, -0.5));
  const bend = new THREE.Vector3(0, 0, -1).transformDirection(root.matrixWorld);
  new TwoBoneIK().solve(upper, lower, end, target, bend);
  const a = upper.getWorldPosition(new THREE.Vector3()), b = lower.getWorldPosition(new THREE.Vector3()), c = end.getWorldPosition(new THREE.Vector3());
  assert.ok(c.distanceTo(target) < 1e-5);
  assert.ok(Math.abs(a.distanceTo(b) - 1) < 1e-5);
  assert.ok(Math.abs(b.distanceTo(c) - 1) < 1e-5);
});

test('unreachable and coincident targets stay finite and within physical limb length', () => {
  for (const point of [new THREE.Vector3(0, -10, 0), new THREE.Vector3()]) {
    const { root, upper, lower, end } = limb();
    const target = root.localToWorld(point);
    new TwoBoneIK().solve(upper, lower, end, target, new THREE.Vector3(0, 0, -1));
    const a = upper.getWorldPosition(new THREE.Vector3()), c = end.getWorldPosition(new THREE.Vector3());
    assert.ok([c.x, c.y, c.z, ...upper.quaternion, ...lower.quaternion].every(Number.isFinite));
    assert.ok(a.distanceTo(c) <= 2.0001);
  }
});

test('view arms hold both rifle grip sockets with six rigid meshes', () => {
  const parent = new THREE.Group(), materials = createWeaponMaterials();
  const rifle = createRifleModel(materials).mesh;
  parent.add(rifle);
  const hands = new FirstPersonHands(parent, materials);
  hands.update(rifle);
  let meshes = 0;
  hands.mesh.traverse(node => { if (node.isMesh) meshes++; });
  assert.equal(meshes, 6);
  for (const arm of hands.arms) {
    const socket = rifle.localToWorld(rifle.userData.grips[arm.side > 0 ? 'right' : 'left'].clone());
    assert.ok(arm.hand.getWorldPosition(new THREE.Vector3()).distanceTo(socket) < 0.002);
  }
  disposeModelGeometry(parent);
  for (const material of Object.values(materials)) material.dispose();
});
