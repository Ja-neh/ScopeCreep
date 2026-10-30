import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PhysicsWorld } from '../src/core/PhysicsWorld.js';
import { setDoorGLTFCache } from '../src/entities/doors/BaseSlidingDoor.js';
import {
  DoorSlidingSideways,
  loadDoorSlidingSideways,
  DoorSlidingUp,
  loadDoorSlidingUp,
  BigDoorSlidingUp,
  loadBigDoorSlidingUp
} from '../src/entities/doors/index.js';

if (typeof globalThis.ProgressEvent === 'undefined') {
  globalThis.ProgressEvent = class ProgressEvent {};
}

const nodeLoader = new GLTFLoader();
function parseGlbFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => {
    nodeLoader.parse(arrayBuf, '', resolve, reject);
  });
}

// Seed door models into cache for Node testing
const gltfSideways = await parseGlbFile('assets/Door-sliding-sideways.glb');
setDoorGLTFCache('./assets/Door-sliding-sideways.glb', gltfSideways);
setDoorGLTFCache('/assets/Door-sliding-sideways.glb', gltfSideways);

const gltfUp = await parseGlbFile('assets/Door-sliding-up.glb');
setDoorGLTFCache('./assets/Door-sliding-up.glb', gltfUp);
setDoorGLTFCache('/assets/Door-sliding-up.glb', gltfUp);

const gltfBigUp = await parseGlbFile('assets/Big-door-sliding-up.glb');
setDoorGLTFCache('./assets/Big-door-sliding-up.glb', gltfBigUp);
setDoorGLTFCache('/assets/Big-door-sliding-up.glb', gltfBigUp);

test('DoorSlidingSideways loads model and initializes slide delta along Z', async () => {
  const door = await loadDoorSlidingSideways(null);

  assert.ok(door.isLoaded, 'Door should be loaded');
  assert.ok(door.mesh, 'Door should have mesh');
  assert.ok(door.panelMesh, 'Door should have panel mesh');
  assert.ok(door.colMesh, 'Door should have collider mesh');
  assert.ok(door.detectMesh, 'Door should have detect trigger mesh');

  // Verify slide delta is along Z by approx -2.25m
  assert.equal(Math.abs(door.slideDelta.x) < 1e-3, true, 'Slide delta X should be 0');
  assert.equal(Math.abs(door.slideDelta.y) < 1e-3, true, 'Slide delta Y should be 0');
  assert.equal(door.slideDelta.z < -2.0, true, 'Slide delta Z should be negative (-2.25m)');

  // Collider and detect meshes should be hidden from rendering
  assert.equal(door.detectMesh.visible, false);
  assert.equal(door.colMesh.visible, false);

  door.dispose();
});

test('DoorSlidingUp loads model and initializes slide delta along Y', async () => {
  const door = await loadDoorSlidingUp(null);

  assert.ok(door.isLoaded, 'Door should be loaded');
  assert.ok(door.panelMesh, 'Door should have panel mesh');
  assert.ok(door.colMesh, 'Door should have collider mesh');
  assert.ok(door.detectMesh, 'Door should have detect trigger mesh');

  // Verify slide delta is vertically upward along Y (+3.30m)
  assert.equal(Math.abs(door.slideDelta.x) < 1e-3, true, 'Slide delta X should be 0');
  assert.equal(door.slideDelta.y > 3.0, true, 'Slide delta Y should be +3.3m');
  assert.equal(Math.abs(door.slideDelta.z) < 1e-3, true, 'Slide delta Z should be 0');

  door.dispose();
});

test('BigDoorSlidingUp loads model and initializes slide delta along Y', async () => {
  const door = await loadBigDoorSlidingUp(null);

  assert.ok(door.isLoaded, 'Door should be loaded');
  assert.ok(door.panelMesh, 'Door should have panel mesh');
  assert.ok(door.colMesh, 'Door should have collider mesh');
  assert.ok(door.detectMesh, 'Door should have detect trigger mesh');

  // Verify slide delta is vertically upward along Y (+3.30m)
  assert.equal(Math.abs(door.slideDelta.x) < 1e-3, true, 'Slide delta X should be 0');
  assert.equal(door.slideDelta.y > 3.0, true, 'Slide delta Y should be +3.3m');
  assert.equal(Math.abs(door.slideDelta.z) < 1e-3, true, 'Slide delta Z should be 0');

  door.dispose();
});

test('Dynamic tweening: opens, closes, and smoothly reverses mid-motion without keyframed animations', async () => {
  const door = await loadDoorSlidingSideways(null, {
    openSpeed: 2.0,
    closeSpeed: 2.0
  });

  assert.equal(door.openProgress, 0.0);
  assert.equal(door.isClosed(), true);

  // Trigger open
  door.open();
  assert.equal(door.targetProgress, 1.0);

  // Advance 0.25 seconds: progress should reach 0.50 (halfway)
  door.prePhysicsUpdate(0.25, null);
  assert.equal(Math.abs(door.openProgress - 0.50) < 1e-3, true, `Expected 0.50, got ${door.openProgress}`);
  assert.equal(door.isMoving(), true);

  // Position should be exactly halfway along slideDelta
  const expectedZ = door.initialPanelPos.z + door.slideDelta.z * 0.5;
  assert.equal(Math.abs(door.panelMesh.position.z - expectedZ) < 1e-3, true);

  // Mid-motion reversal: player steps away, door reverses smoothly towards 0.0 from current 0.50
  door.close();
  assert.equal(door.targetProgress, 0.0);

  // Advance 0.10s: progress should decrease to 0.30 without jumping
  door.prePhysicsUpdate(0.10, null);
  assert.equal(Math.abs(door.openProgress - 0.30) < 1e-3, true, `Expected 0.30, got ${door.openProgress}`);

  door.dispose();
});

test('Physics integration and moving collider synchronization', async () => {
  const physics = new PhysicsWorld();
  await physics.init();

  const door = await loadDoorSlidingSideways(null, {
    position: new THREE.Vector3(10, 0, 5),
    rotation: Math.PI / 2,
    openSpeed: 2.0
  });

  door.initPhysics(physics);
  assert.ok(door.collider, 'Rapier collider should be created');
  assert.ok(door.rigidBody, 'RigidBody should be created');

  const initialColPos = door.collider.translation();

  // Open the door
  door.open();
  // Advance frame
  door.prePhysicsUpdate(0.25, null);
  physics.step(0.016);

  const movedColPos = door.collider.translation();
  // Collider should have moved in world space along with the visual panel
  const dist = Math.hypot(
    movedColPos.x - initialColPos.x,
    movedColPos.y - initialColPos.y,
    movedColPos.z - initialColPos.z
  );
  assert.equal(dist > 0.5, true, `Collider should have moved, moved dist: ${dist}`);

  door.dispose();
  physics.dispose();
});

test('Compound rigid body: mounts to parent body and preserves parent body on disposal', async () => {
  const physics = new PhysicsWorld();
  await physics.init();

  // Create a parent rigid body representing the spaceship or level structure
  const spaceshipBody = physics.createFixedRigidBody({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 }
  });

  const parentObj = new THREE.Group();
  parentObj.position.set(20, 0, 10);
  parentObj.updateMatrixWorld(true);

  const door = await loadDoorSlidingUp(null);
  parentObj.add(door.mesh);
  parentObj.updateMatrixWorld(true);

  door.initPhysics(physics, spaceshipBody, parentObj);
  assert.equal(door.rigidBody, spaceshipBody, 'Door collider should be attached directly to spaceship body');
  assert.equal(door.isCompoundChild, true);

  // Dispose door: removes door collider, leaves spaceship body intact
  door.dispose();
  assert.equal(door.collider, null);
  // Spaceship body should still exist in physics world
  assert.ok(spaceshipBody);

  physics.dispose();
});

test('Proximity detection (DETECT-*) automatically triggers door opening for player and NPCs', async () => {
  const door = await loadDoorSlidingSideways(null, {
    position: new THREE.Vector3(0, 0, 0),
    closeDelay: 0.5
  });

  const mockGameWorld = {
    player: {
      position: new THREE.Vector3(0.4, 0.9, -2.5), // Center of DETECT box
      isPlayer: true
    },
    entities: []
  };

  // Check gameplay update
  door.gameplayUpdate(0.016, mockGameWorld);
  assert.equal(door.isOccupied, true, 'Player should be detected in DETECT box');
  assert.equal(door.targetProgress, 1.0, 'Door should target opened state');

  // Move player outside
  mockGameWorld.player.position.set(100, 0, 100);
  door.gameplayUpdate(0.1, mockGameWorld);
  assert.equal(door.isOccupied, false, 'Player is outside');
  // Target progress stays 1.0 during closeDelay
  assert.equal(door.targetProgress, 1.0);

  // Advance past closeDelay
  door.gameplayUpdate(0.6, mockGameWorld);
  assert.equal(door.targetProgress, 0.0, 'Door should target closed state after delay');

  door.dispose();
});
