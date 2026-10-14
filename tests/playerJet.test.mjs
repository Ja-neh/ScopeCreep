import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerJet } from '../src/entities/player-jet/PlayerJet.js';
import { createPlayerJetModel } from '../src/entities/models/PlayerJetModel.js';

function createInput(actions = new Set()) {
  return {
    isActionDown: (action) => actions.has(action),
    getAxis: (negative, positive) =>
      Number(actions.has(positive)) - Number(actions.has(negative))
  };
}

function createGameWorld(input = createInput()) {
  const fired = [];
  const removedBodies = [];
  const rigidBody = {
    setNextKinematicTranslation(position) {
      this.nextPosition = position.clone();
    },
    setNextKinematicRotation(rotation) {
      this.nextRotation = rotation.clone();
    }
  };
  const colliderDesc = { setRotation(rotation) { this.rotation = rotation.clone(); return this; } };
  return {
    input,
    activeCamera: null,
    camera: {
      position: new THREE.Vector3(),
      lookAt(position) { this.target = position.clone(); }
    },
    physics: {
      world: {},
      RAPIER: { ColliderDesc: { capsule: () => colliderDesc } },
      createKinematicRigidBody: () => rigidBody,
      createCollider: () => ({ name: 'jet-collider' }),
      removeRigidBody: (body) => removedBodies.push(body)
    },
    projectilePool: {
      fireFlak(options) {
        fired.push({ ...options, origin: options.origin.clone(), direction: options.direction.clone() });
      }
    },
    fired,
    removedBodies,
    rigidBody
  };
}

test('the placeholder jet has a forward-facing fuselage and shadow-enabled parts', () => {
  const model = createPlayerJetModel();
  const meshes = [];
  model.traverse((child) => { if (child.isMesh) meshes.push(child); });

  assert.equal(meshes.length, 4);
  assert.ok(meshes.every((mesh) => mesh.castShadow && mesh.receiveShadow));
  model.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
});

test('player jet flight synchronizes its kinematic collider and chase camera', () => {
  const gameWorld = createGameWorld(createInput(new Set(['throttleUp', 'pitchUp', 'rollLeft', 'yawLeft'])));
  const jet = new PlayerJet(gameWorld, { position: new THREE.Vector3(0, 80, -200) });

  jet.prePhysicsUpdate(0.1);

  assert.equal(jet.currentSpeed, 62.5);
  assert.ok(jet.mesh.position.y > 80, 'pitch-up input raises the nose and flight path');
  assert.ok(gameWorld.rigidBody.nextPosition.equals(jet.mesh.position));
  assert.ok(gameWorld.rigidBody.nextRotation.equals(jet.mesh.quaternion));

  jet.lateUpdate(0.1);
  assert.ok(gameWorld.camera.position.distanceTo(jet.mesh.position) > 5, 'camera trails the jet');
  assert.ok(gameWorld.camera.target.distanceTo(jet.mesh.position) > 0, 'camera looks slightly above the jet origin');

  jet.dispose();
  assert.equal(gameWorld.removedBodies[0], gameWorld.rigidBody);
});

test('banking turns the jet and the wings level smoothly after roll input is released', () => {
  const actions = new Set(['rollLeft']);
  const gameWorld = createGameWorld(createInput(actions));
  const jet = new PlayerJet(gameWorld);

  jet.prePhysicsUpdate(0.25);
  const bankedRoll = Math.abs(jet.rotationEuler.z);
  const turnedHeading = jet.rotationEuler.y;

  assert.ok(bankedRoll > 0, 'roll input banks the aircraft');
  assert.ok(turnedHeading < 0, 'left bank curves the jet into a left turn');

  actions.delete('rollLeft');
  for (let i = 0; i < 90; i++) jet.prePhysicsUpdate(1 / 60);

  assert.ok(Math.abs(jet.rotationEuler.z) < bankedRoll * 0.1, 'wings return close to level');
  assert.ok(jet.rotationEuler.y < turnedHeading, 'jet keeps turning while it levels');
  jet.dispose();
});

test('jet guns fire through the pooled flak API at the configured cadence', () => {
  const gameWorld = createGameWorld(createInput(new Set(['firePrimary'])));
  const jet = new PlayerJet(gameWorld);

  jet.gameplayUpdate(0.01);
  assert.equal(gameWorld.fired.length, 2, 'both wing guns fire');
  assert.ok(gameWorld.fired.every((shot) => shot.source === jet && shot.excludeCollider === jet.collider));
  assert.ok(gameWorld.fired.every((shot) => shot.speed === 650));

  jet.gameplayUpdate(0.01);
  assert.equal(gameWorld.fired.length, 2, 'the weapon cooldown prevents firing every frame');

  jet.dispose();
});
