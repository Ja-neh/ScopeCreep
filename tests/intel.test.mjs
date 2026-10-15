// Level 2's intel trail and the village smoke: the islanders' notes and dead radios (one per
// zone) that the player reads for the Level 3 story, picked off the ground with [E] and pinned
// on the map as they are found, and the smoke columns over the village that fade in as the
// squad closes on the plateau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../src/config.json';
import { Level02 } from '../src/levels/Level02.js';
import { Level02TestLevel } from '../src/levels/Level02TestLevel.js';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';

const cfg = config.levels.level02;

async function loadLevel(LevelClass, seed = 3) {
  const world = await createTestWorld({ seed });
  const level = new LevelClass(world);
  await level.init();
  return { world, level };
}

function teardown(world, level) {
  level.dispose();
  world.clearEntities();
  return bodyCount(world);
}

test('Level 2 intel: the islanders left one piece of the story in every zone, on dry, clear ground', async () => {
  const { world, level } = await loadLevel(Level02);
  stepWorld(world, 0.2, { level });

  const trail = level.intel;
  assert.ok(trail, 'the trail was built with the level');
  assert.equal(trail.radius, cfg.intel.radius, 'its reach comes from config');
  assert.equal(trail.totalCount, 5, 'five spots: a note and a radio through the four zones');
  const zoneCounts = {};
  for (const spot of trail.spots) zoneCounts[spot.zone] = (zoneCounts[spot.zone] || 0) + 1;
  assert.deepEqual(zoneCounts, { beach: 1, forest: 2, rocks: 1, outskirts: 1 }, 'every zone is on the trail');

  // Every spot sits on ground the island actually has: dry, clear of trees and rocks, and out
  // of the landing zone's way
  for (const spot of trail.spots) {
    const ground = level.environment.heightAt(spot.x, spot.z);
    assert.ok(ground > 0.24, `${spot.id} sits on dry ground (${ground.toFixed(1)} m)`);
    assert.ok(level.cover.isClearOfSolids(spot.x, spot.z, 1.2), `${spot.id} is clear of the scenery`);
  }

  // Unfound spots ride the map as faint rings (kind and '?'), and none is marked found yet
  const intel = level.getMapData().intel;
  assert.equal(intel.length, 5, 'the trail feeds the map');
  assert.ok(intel.every((spot) => spot.found === false && spot.label === '?'), 'all of them read unfound');
  assert.equal(teardown(world, level), 0, 'no physics bodies left');
});

test('Level 2 intel: [E] beside a spot reads it — the toast, the count and the map pin', async () => {
  const { world, level } = await loadLevel(Level02);
  const ground = (x, z) => level.environment.heightAt(x, z) + 0.1;
  world.input.press('skipCutscene'); // The opening sweep holds the player still: skip it
  stepWorld(world, 0.5, { level });

  const spot = level.intel.spots[0];
  const far = Math.hypot(level.player.position.x - spot.x, level.player.position.z - spot.z);
  assert.ok(far > level.intel.radius * 3, `the first spot waits ${far.toFixed(0)} m out`);
  assert.equal(world.ui.callsTo('showPrompt').length, 0, 'nothing is prompted from a distance');

  // Stand on it: the prompt names the piece in front of the player
  level.player.teleport(spot.x + 0.8, ground(spot.x + 0.8, spot.z), spot.z);
  stepWorld(world, 0.3, { level });
  const prompt = world.ui.callsTo('showPrompt').at(-1);
  assert.equal(prompt.args[1], 'READ NOTE', 'the prompt names the note');
  assert.equal(prompt.args[3], level.intel, 'shown by the trail');

  // [E] reads it: a toast with the islander's own words, the trail count, and the map turns it found
  world.input.press('specialAction');
  stepWorld(world, 0.1, { level });
  assert.equal(level.intel.foundCount, 1);
  const toasts = world.ui.callsTo('showToast').map((call) => call.args[0]);
  assert.ok(toasts.some((text) => text.includes(spot.title)), 'the note is read out');
  assert.ok(toasts.some((text) => text.includes('“') && text.includes('”')), 'its words are quoted');
  assert.ok(toasts.some((text) => /Islanders' trail: 1 of 5 found/.test(text)), 'the count is tallied');
  assert.equal(spot.mesh.visible, false, 'a read spot leaves the ground');

  const found = level.getMapData().intel[0];
  assert.equal(found.found, true, 'and is pinned as found on the map');
  assert.equal(found.label, 'NOTE', 'with its kind');
  assert.equal(world.ui.callsTo('showPrompt').length >= 1, true);

  // Walking away takes the prompt down
  level.player.teleport(spot.x + 30, ground(spot.x + 30, spot.z), spot.z);
  stepWorld(world, 0.3, { level });
  assert.equal(world.ui.callsTo('hidePrompt').length >= 1, true, 'the prompt is hidden again');
  assert.equal(level.intel.foundCount, 1, 'and re-reading is not needed: the spot is done');
  assert.equal(teardown(world, level), 0, 'no physics bodies left');
});

test('Level 2 intel: a radio is listened to, and reading every piece keeps a count', async () => {
  const { world, level } = await loadLevel(Level02);
  const ground = (x, z) => level.environment.heightAt(x, z) + 0.1;
  world.input.press('skipCutscene');
  stepWorld(world, 0.5, { level });

  // The forest radio: the prompt says listen, and the toast carries its message
  const radio = level.getMapData().intel.find((spot) => spot.kind === 'radio');
  assert.ok(radio, 'a radio is out there');
  level.player.teleport(radio.x + 0.8, ground(radio.x + 0.8, radio.z), radio.z);
  stepWorld(world, 0.3, { level });
  assert.equal(world.ui.callsTo('showPrompt').at(-1).args[1], 'LISTEN TO RADIO');
  world.input.press('specialAction');
  stepWorld(world, 0.1, { level });
  assert.ok(
    world.ui.callsTo('showToast').some((call) => /Dead Radio|Field Radio/.test(call.args[0]) && call.args[0].includes('“')),
    'the radio plays its last message'
  );

  // Find every remaining spot: the trail counts up to its total and the pins all read found
  for (const spot of level.intel.spots) {
    if (spot.found) continue;
    level.player.teleport(spot.x + 0.8, ground(spot.x + 0.8, spot.z), spot.z);
    stepWorld(world, 0.2, { level });
    world.input.press('specialAction');
    stepWorld(world, 0.1, { level });
  }
  assert.equal(level.intel.foundCount, level.intel.totalCount, 'every piece was found');
  const intel = level.getMapData().intel;
  assert.ok(intel.every((spot) => spot.found && spot.label !== '?'), 'the whole trail is pinned');
  assert.ok(
    world.ui.callsTo('showToast').some((call) => call.args[0].includes(`4 of 5 found`)),
    'the fourth find calls out how close it is'
  );
  assert.equal(teardown(world, level), 0, 'no physics bodies left');
});

test('Level 2: the village smoke hides from the beach and fades in over the outskirts', async () => {
  const { world, level } = await loadLevel(Level02);
  const ground = (x, z) => level.environment.heightAt(x, z) + 0.1;
  world.input.press('skipCutscene');
  stepWorld(world, 0.5, { level });

  const smoke = level.villageSmoke;
  assert.ok(smoke, 'the smoke was built with the level');
  assert.equal(smoke.visible, false, 'nothing shows from the landing beach');
  assert.equal(smoke.pillars.length, 2, 'two columns over the village');
  for (const pillar of smoke.pillars) {
    const village = level.environment.village;
    assert.ok(
      Math.hypot(pillar.x - village.x, pillar.z - village.z) < village.halfWidth,
      'each column stands over the plateau'
    );
    assert.ok(pillar.y >= village.height - 2, 'and rises from the plateau, not the sea');
  }

  // The outskirts gate: the columns are up and burning (the reveal eases in at 0.4/s, so
  // give it enough frames to reach the top of its ramp)
  const x = level.environment.pathCentreX(-250);
  level.player.teleport(x, ground(x, -250), -250);
  stepWorld(world, 7, { level, onFrame: () => level.player.health.reset() });
  assert.equal(smoke.visible, true, 'the smoke is up by the outskirts');
  assert.ok(smoke.reveal > 0.9, `the reveal is full (${smoke.reveal.toFixed(2)})`);
  assert.equal(smoke.mesh.visible, true);
  assert.ok(smoke.mesh.count > 0);

  // Back on the beach it folds away again
  const foot = level.landingZone.spawnPoints.gangwayFoot;
  level.player.teleport(foot.x, foot.y, foot.z);
  stepWorld(world, 12, { level, onFrame: () => level.player.health.reset() });
  assert.ok(smoke.reveal < 0.4, `the reveal falls away on the beach (${smoke.reveal.toFixed(2)})`);
  assert.equal(teardown(world, level), 0, 'no physics bodies left');
});

test('Level 2 test level: the sandbox carries the intel trail too', async () => {
  const { world, level } = await loadLevel(Level02TestLevel);
  stepWorld(world, 0.2, { level });
  assert.ok(level.intel, 'the sandbox has the trail');
  assert.equal(level.intel.totalCount, 5);
  assert.equal(level.villageSmoke.pillars.length, 2);
  assert.equal(teardown(world, level), 0, 'no physics bodies left');
});
