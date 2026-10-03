// Level 2 end to end: landing, three waves, objective and victory; defeat; the sandbox level;
// and clean teardown. Aliens are killed by the test so the flow runs quickly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { Level02 } from '../src/levels/Level02.js';
import { Level02TestLevel } from '../src/levels/Level02TestLevel.js';
import config from '../src/config.json';

const cfg = config.levels.level02;
const totalUnits = (type) => cfg.waves.reduce((sum, wave) => sum + (wave[type] || 0), 0);

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

test('Level 2: ashore -> three waves from the north -> objective -> victory', async () => {
  const { world, level } = await loadLevel(Level02);
  stepWorld(world, 1, { level });
  assert.equal(level.state, 'landing', 'waits while the player is on the ship');

  const foot = level.landingZone.spawnPoints.gangwayFoot;
  level.player.teleport(foot.x, foot.y, foot.z);
  stepWorld(world, 0.5, { level });
  assert.equal(level.state, 'waves', 'first wave starts once ashore');

  // Kill every alien the moment it appears; check where it appeared
  const seen = new Set();
  const badSpawns = [];
  let brutes = 0;
  stepWorld(world, 150, {
    level,
    onFrame: () => {
      for (const alien of level.squad.members) {
        if (seen.has(alien)) continue;
        seen.add(alien);
        if (alien.name === 'AlienBrute') brutes++;
        const { x, z } = alien.position;
        if (z > 120 || level.environment.heightAt(x, z) < 0.6 || !level.cover.isClearOfSolids(x, z, 1.0)) badSpawns.push([x, z]);
        alien.health.takeDamage({ amount: 99999, source: level.player });
      }
      return level.state === 'objective';
    }
  });

  assert.equal(level.state, 'objective');
  assert.equal(seen.size, totalUnits('trooper') + totalUnits('brute'), 'every unit of every wave arrived');
  assert.equal(brutes, totalUnits('brute'));
  assert.equal(level.squad.killCount, seen.size);
  assert.deepEqual(badSpawns, [], 'aliens spawn on dry, clear ground north of the beach');
  assert.equal(level.beacon.mesh.visible, true, 'objective beacon shown');
  assert.ok(world.ui.callsTo('showObjective').some((call) => call.args[0].startsWith('HOLD THE BEACH')));

  // Walk into the beacon's ring
  const goal = level.beacon.mesh.position;
  level.player.teleport(goal.x + 3, goal.y + 0.1, goal.z);
  stepWorld(world, 0.3, { level });
  assert.equal(level.state, 'won');

  const result = world.ui.callsTo('showMissionResult').at(-1).args[0];
  assert.equal(result.outcome, 'victory');
  assert.deepEqual(result.actions.map((action) => action.label), ['Play again', 'Main menu']);
  result.actions[1].onClick();
  assert.equal(world.mainMenuRequested, true);
  assert.equal(level.player.isDevSuspended, true, 'player frozen behind the result screen');

  assert.equal(teardown(world, level), 0, 'no physics bodies left');
  assert.equal(world.environmentGroup.children.length, 0);
  assert.equal(world.projectilePool, null);
});

test('Level 2: the first wave also starts if the player stays aboard', async () => {
  const { world, level } = await loadLevel(Level02);
  stepWorld(world, cfg.firstWaveTriggerSeconds + 1, { level });
  assert.equal(level.state, 'waves');
  assert.ok(level.squad.members.length > 0);
  assert.equal(teardown(world, level), 0);
});

test('Level 2: dying fails the mission and Retry restarts it', async () => {
  const { world, level } = await loadLevel(Level02);
  stepWorld(world, 0.5, { level });
  level.player.health.takeDamage({ amount: 1000 });
  stepWorld(world, 0.2, { level });
  assert.equal(level.state, 'lost');

  const result = world.ui.callsTo('showMissionResult').at(-1).args[0];
  assert.equal(result.outcome, 'defeat');
  result.actions.find((action) => action.label === 'Retry').onClick();
  assert.equal(world.restartRequested, true);
  assert.equal(teardown(world, level), 0);
});

test('Level 2 test level: dummies, a respawning alien group including a brute, and player respawn', async () => {
  const { world, level } = await loadLevel(Level02TestLevel);
  assert.equal(level.dummies.length, 5);
  assert.equal(level.squad.aliveCount, 4);
  assert.equal(level.squad.members.filter((alien) => alien.name === 'AlienBrute').length, 1);

  level.player.health.takeDamage({ amount: 1000 });
  stepWorld(world, config.player.vitals.respawnSeconds + 0.5, { level });
  assert.equal(level.player.health.isDead, false, 'respawned');
  assert.equal(level.player.health.currentHealth, level.player.health.maxHealth);
  assert.equal(world.ui.callsTo('showMissionResult').length, 0, 'no mission failure in the sandbox');

  for (const alien of level.squad.members) alien.health.takeDamage({ amount: 99999, source: level.player });
  stepWorld(world, 6, { level });
  assert.equal(level.squad.aliveCount, 4, 'a fresh group arrived');

  // F3 drops a trooper ahead of the player, Shift+F3 a brute
  const foot = level.landingZone.spawnPoints.gangwayFoot;
  level.player.teleport(foot.x, foot.y, foot.z);
  level.player.yaw = 0;
  world.input.press('devSpawn');
  stepWorld(world, 0.1, { level });
  world.input.hold('sprint');
  world.input.press('devSpawn');
  stepWorld(world, 0.1, { level });
  world.input.release('sprint');
  const dropped = level.squad.members.slice(-2);
  assert.deepEqual(dropped.map((alien) => alien.name), ['AlienTrooper', 'AlienBrute']);
  for (const alien of dropped) {
    const distance = Math.hypot(alien.position.x - foot.x, alien.position.z - foot.z);
    assert.ok(distance > 20 && distance < 40, `dropped ${distance.toFixed(0)} m away`);
  }
  assert.equal(teardown(world, level), 0);
});
