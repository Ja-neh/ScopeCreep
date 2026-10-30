import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CharacterVisual } from '../src/entities/models/CharacterVisual.js';
import { createRifleModel, createWeaponMaterials, disposeModelGeometry } from '../src/weapons/WeaponModels.js';
import { loadCharacterAsset } from './support/characterAsset.mjs';

function flex(visual, a, b, c) {
  const p = name => visual.joints[name].bone.getWorldPosition(new THREE.Vector3());
  const ab = p(b).sub(p(a)).normalize(), bc = p(c).sub(p(b)).normalize();
  return Math.acos(THREE.MathUtils.clamp(ab.dot(bc), -1, 1));
}

for (const id of ['deadpool', 'ashe', 'firion', 'junker-queen', 'gorr', 'bob']) {
  test(`${id}: actual shipped skin bends knees and elbows and reaches both rifle grips`, async () => {
    const asset = await loadCharacterAsset(id);
    const parent = new THREE.Group();
    const visual = new CharacterVisual(parent, id, { enabled: true,
      acquireAsset: () => ({ promise: Promise.resolve(asset), release() {} }) });
    assert.equal(await visual.ready, true);
    visual.setActor({ velocity: new THREE.Vector3(0, 0, -2.5), isGrounded: true,
      physicsWorld: { world: {}, RAPIER: { Ray: class { constructor(origin, dir) { this.origin = origin; this.dir = dir; } } },
        castRay: ray => ({ timeOfImpact: ray.origin.y, collider: { parent: () => null } }) } });
    const materials = createWeaponMaterials(), gun = createRifleModel(materials).mesh;
    parent.add(gun);
    const skin = visual.root.getObjectByProperty('isSkinnedMesh', true);
    const shinIndex = skin.skeleton.bones.findIndex(b => b.name === 'SC_leftShin');
    let shinVertex = -1;
    for (let v = 0; v < skin.geometry.attributes.skinIndex.count && shinVertex < 0; v++) {
      for (let c = 0; c < 4; c++) {
        if (skin.geometry.attributes.skinIndex.getComponent(v, c) === shinIndex &&
          skin.geometry.attributes.skinWeight.getComponent(v, c) > 0.5) shinVertex = v;
      }
    }
    assert.ok(shinVertex >= 0, 'the calf skin is actually weighted to the knee joint');
    const samples = [];
    const knees = [], elbows = [];
    for (let frame = 0; frame < 120; frame++) {
      parent.position.z -= 2.5 / 60;
      visual.animate(1/60, 2.5, true);
      visual.fitWeapon(gun, true);
      visual.poseWeapon(gun);
      knees.push(flex(visual, 'leftThigh', 'leftShin', 'leftFoot'));
      elbows.push(flex(visual, 'leftUpperArm', 'leftForearm', 'leftHand'));
      if (frame % 10 === 0) samples.push(skin.getVertexPosition(shinVertex, new THREE.Vector3()));
      for (const side of ['left', 'right']) {
        const hand = visual.joints[side+'Hand'].bone.getWorldPosition(new THREE.Vector3());
        const grip = gun.localToWorld(gun.userData.grips[side].clone());
        assert.ok(hand.distanceTo(grip) < 0.025, `${id} ${side} wrist error ${hand.distanceTo(grip)}`);
      }
    }
    const range = Math.max(...knees) - Math.min(...knees);
    assert.ok(Math.max(...knees) > 0.65, `knee visibly flexes: ${Math.max(...knees)}`);
    assert.ok(range > 0.3, `knee changes through stance and swing: ${range}`);
    assert.ok(Math.min(...elbows) > 0.3, `elbow remains bent: ${Math.min(...elbows)}`);
    assert.ok(samples.some(p => p.distanceTo(samples[0]) > 0.025), 'the weighted calf mesh deforms through the step');
    visual.dispose(); disposeModelGeometry(gun);
    for (const material of Object.values(materials)) material.dispose();
  });
}
