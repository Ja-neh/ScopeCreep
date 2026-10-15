import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { Level01 } from '../src/levels/Level01.js';

test('Level 1: battleship starts at open sea and approaches the shores of the Level 2 island', async () => {
  const world = await createTestWorld();
  const level = new Level01(world);
  await level.init();

  assert.equal(level.openSeaStartZ, 950, 'starts far out at open sea (Z = 950)');
  assert.equal(level.shoreAnchorageZ, 225, 'destination is the Level 2 coastal anchorage (Z = 225)');
  assert.equal(level.battleship.mesh.position.z, 950, 'battleship is spawned at open sea');
  assert.ok(level.environment, 'island environment is constructed');
  assert.ok(level.cover, 'island tropical cover and foliage are placed');
  assert.equal(level.hasReachedShore, false, 'ship starts well away from the shore');

  // Verify player starts on the battleship deck in open sea
  assert.ok(Math.abs(level.player.position.z - (950 - 14.0)) < 1.0, 'player spawned on the forward deck in open sea');

  // Move the ship northward toward the island shores
  level.battleship.mesh.position.z = 500;
  level._updateIslandApproach();
  assert.equal(level.hasReachedShore, false);

  // Bring the ship to the shore anchorage
  level.battleship.mesh.position.z = 225;
  level._updateIslandApproach();
  assert.equal(level.hasReachedShore, true, 'anchorage secured at the island shore');
  assert.equal(level.battleship.shipController.speed, 0, 'speed halted to anchor off the beach');
  assert.ok(world.ui.callsTo('showToast').some((call) => call.args[0].includes('ISLAND SHORES REACHED')), 'crew alerted of arrival');

  // Verify grounding prevention: ship cannot run up onto dry sand
  level.battleship.mesh.position.z = 180;
  level._updateIslandApproach();
  assert.equal(level.battleship.mesh.position.z, 225, 'clamped to coastal anchorage to prevent beaching');

  level.dispose();
  world.clearEntities();
  assert.equal(bodyCount(world), 0, 'clean teardown releases all physics and mesh resources');
});
