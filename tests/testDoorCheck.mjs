import { test } from 'node:test';
import * as THREE from 'three';
import { createTestWorld } from './support/testWorld.mjs';
import { Level01InsideSpaceship } from '../src/levels/Level01InsideSpaceship.js';

test('Check doorSpawnNodes and doors', async () => {
  const world = await createTestWorld();
  const level = new Level01InsideSpaceship(world);
  await level.init();

  process.stdout.write(`doors count: ${level.doors.length}\n`);
  for (const d of level.doors) {
    process.stdout.write(`door: name=${d.name}, isLocked=${d.isLocked}\n`);
  }

  level.dispose();
});
