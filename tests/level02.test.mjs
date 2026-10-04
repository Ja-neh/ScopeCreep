// Level 2 end to end: landing, three waves, objective and victory; defeat; the sandbox level;
// and clean teardown. Aliens are killed by the test so the flow runs quickly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { Level02 } from '../src/levels/Level02.js';
import { Level02TestLevel } from '../src/levels/Level02TestLevel.js';
import { InputManager } from '../src/core/InputManager.js';
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
  const spawnXsByWave = [];
  let brutes = 0;
  stepWorld(world, 200, {
    level,
    onFrame: () => {
      for (const alien of level.squad.members) {
        if (seen.has(alien)) continue;
        seen.add(alien);
        if (alien.name === 'AlienBrute') brutes++;
        const { x, z } = alien.position;
        (spawnXsByWave[level.waves.waveIndex] ||= []).push(x);
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
  spawnXsByWave.forEach((xs, i) => {
    assert.ok(xs.length >= 20, `wave ${i + 1} brought ${xs.length} aliens`);
    const spread = Math.max(...xs) - Math.min(...xs);
    assert.ok(spread > 200, `wave ${i + 1} only spread over ${spread.toFixed(0)} m`);
  });
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

  // A big wave pours in, but never more than the cap on the field at once
  let mostAlive = 0;
  stepWorld(world, 25, {
    level,
    onFrame: () => {
      mostAlive = Math.max(mostAlive, level.squad.aliveCount);
      assert.ok(level.squad.aliveCount <= cfg.maxAliveAliens, `${level.squad.aliveCount} alive`);
    }
  });
  assert.ok(mostAlive >= 12, `only ${mostAlive} on the field at once`);
  assert.equal(teardown(world, level), 0);
});

test('Level 2: going down with nobody left standing fails the mission; Retry restarts it', async () => {
  const { world, level } = await loadLevel(Level02);
  stepWorld(world, 0.5, { level });
  level.allies.removeAllMates();
  level.player.health.takeDamage({ amount: 1000 });
  stepWorld(world, 0.2, { level });
  assert.equal(level.state, 'lost');

  const result = world.ui.callsTo('showMissionResult').at(-1).args[0];
  assert.equal(result.outcome, 'defeat');
  assert.match(result.message, /whole squad/);
  result.actions.find((action) => action.label === 'Retry').onClick();
  assert.equal(world.restartRequested, true);
  assert.equal(teardown(world, level), 0);
});

test('Level 2: a squadmate revives the downed player; out of reach of everyone, the player bleeds out', async () => {
  const { world, level } = await loadLevel(Level02);
  world.input.press('skipCutscene');
  stepWorld(world, 12, { level }); // Crew down the gangway and at the rally
  const foot = level.landingZone.spawnPoints.gangwayFoot;
  level.player.teleport(foot.x, foot.y, foot.z - 6);
  stepWorld(world, 0.5, { level });

  level.player.health.takeDamage({ amount: 1000 });
  stepWorld(world, 0.5, { level });
  assert.notEqual(level.state, 'lost');
  assert.equal(level.player.isDevSuspended, true, 'downed: lying still');
  assert.ok(world.ui.callsTo('showStatusIndicator').some((call) => /^DOWNED/.test(call.args[0])));
  stepWorld(world, 15, { level, onFrame: () => !level.player.health.isDead });
  stepWorld(world, 0.1, { level });
  assert.equal(level.player.health.isDead, false, 'revived by a squadmate');
  assert.equal(level.player.isDevSuspended, false);

  // Far from everyone (beyond the squad's search radius): nobody comes, and the player bleeds out
  const x = -150;
  const z = 40;
  level.player.teleport(x, level.environment.heightAt(x, z) + 0.05, z);
  stepWorld(world, 0.3, { level });
  level.player.health.takeDamage({ amount: 1000 });
  stepWorld(world, config.revive.bleedOutSeconds + 1, { level });
  assert.equal(level.state, 'lost');
  assert.match(world.ui.callsTo('showMissionResult').at(-1).args[0].message, /bled out/);
  assert.equal(teardown(world, level), 0);
});

test('Level 2: holding [E] beside a downed squadmate revives them; letting go starts over', async () => {
  const { world, level } = await loadLevel(Level02);
  world.input.press('skipCutscene');
  stepWorld(world, 12, { level });
  level.allies.reviveSearchRadius = 0; // Only the player revives in this test
  const mate = level.allies.mates[0];
  mate.health.takeDamage({ amount: 9999 });
  stepWorld(world, 0.5, { level });
  assert.ok(level.allies.isDowned(mate));
  level.player.teleport(mate.position.x + 1.2, mate.position.y + 0.1, mate.position.z);
  stepWorld(world, 0.3, { level });
  const prompt = () => world.ui.callsTo('showPrompt').at(-1).args[1];
  assert.equal(prompt(), `HOLD TO REVIVE ${mate.name.toUpperCase()}`);

  world.input.hold('specialAction');
  stepWorld(world, 1, { level });
  assert.match(prompt(), /^REVIVING .* 30%$/);
  world.input.release('specialAction');
  stepWorld(world, 0.2, { level });
  assert.equal(prompt(), `HOLD TO REVIVE ${mate.name.toUpperCase()}`, 'letting go starts over');

  world.input.hold('specialAction');
  stepWorld(world, config.revive.holdSeconds + 0.2, { level });
  world.input.release('specialAction');
  assert.equal(mate.isDead, false, 'revived');
  assert.equal(mate.health.currentHealth, mate.health.maxHealth * config.revive.healthFraction);
  assert.ok(world.ui.callsTo('showToast').some((call) => call.args[0] === `You revived ${mate.name}.`));
  assert.equal(teardown(world, level), 0);
});

test('Level 2 test level: dummies, a respawning alien group including a brute, revive and respawn', async () => {
  const { world, level } = await loadLevel(Level02TestLevel);
  assert.equal(level.dummies.length, 5);
  assert.equal(level.squad.aliveCount, 4);
  assert.equal(level.squad.members.filter((alien) => alien.name === 'AlienBrute').length, 1);

  // With the squad around, a downed player is revived...
  level.player.health.takeDamage({ amount: 1000 });
  stepWorld(world, 20, { level, onFrame: () => !level.player.health.isDead });
  assert.equal(level.player.health.isDead, false, 'revived by the crew');

  // ...and with nobody to come, the sandbox respawns them instead of failing
  world.input.press('devSquad');
  stepWorld(world, 0.1, { level });
  level.player.health.takeDamage({ amount: 1000 });
  stepWorld(world, config.player.vitals.respawnSeconds + 0.5, { level });
  assert.equal(level.player.health.isDead, false, 'respawned');
  assert.equal(level.player.health.currentHealth, level.player.health.maxHealth);
  assert.equal(world.ui.callsTo('showMissionResult').length, 0, 'no mission failure in the sandbox');
  world.input.press('devSquad');
  stepWorld(world, 0.1, { level });

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

  // The AI squad waits on the sand; F4 sends it away and brings it back
  const squadSize = config.allies.crewSize - 1 + level.landingZone.helicopterBays.length;
  assert.equal(level.allies.mates.length, squadSize);
  world.input.press('devSquad');
  stepWorld(world, 0.1, { level });
  assert.equal(level.allies.mates.length, 0);
  assert.ok(level.allies.members.length === 1 && level.allies.members[0] === level.player, 'only the player left');
  world.input.press('devSquad');
  stepWorld(world, 0.1, { level });
  assert.equal(level.allies.mates.length, squadSize);
  assert.ok(level.allies.mates.filter((mate) => mate.inFormation).every((mate) => mate.order === 'follow'), 'player is ashore: the new crew follow at once');
  assert.equal(teardown(world, level), 0);
});

test('Level 2 controls card: only real actions, with keys read from the bindings', async () => {
  const world = await createTestWorld();
  const input = new InputManager();
  for (const LevelClass of [Level02, Level02TestLevel]) {
    for (const { actions, label } of new LevelClass(world).controls) {
      for (const action of actions) assert.ok(input.actionBindings[action], `${label}: no action '${action}'`);
      assert.ok(input.describeActions(actions).length > 0, label);
    }
  }
  assert.equal(input.describeActions(['forward', 'steerLeft', 'backward', 'steerRight']), 'W A S D');
  assert.equal(input.describeActions(['crouch']), 'C');
  assert.equal(input.describeActions(['firePrimary']), 'Left click / F');
  assert.equal(input.describeActions(['sprint']), 'Shift');
  assert.equal(input.describeActions(['weaponPrimary', 'weaponMelee', 'quickMelee']), '1 2 Q');
  input.dispose();
});
