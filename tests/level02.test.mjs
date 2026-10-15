// Level 2 end to end: landing, three waves, the hunt, the final ambush, the gate fight (its
// snipers, garrison and walker), the ending walk through the gate into the village and the
// handover to Level 3; defeat; the sandbox level; and clean teardown.
// Aliens are killed by the test so the flow runs quickly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { Level02 } from '../src/levels/Level02.js';
import { Level02TestLevel } from '../src/levels/Level02TestLevel.js';
import { Level03 } from '../src/levels/Level03.js';
import { InputManager } from '../src/core/InputManager.js';
import config from '../src/config.json';

const cfg = config.levels.level02;
const totalUnits = (type) => cfg.waves.reduce((sum, wave) => sum + (wave[type] || 0), 0);
const zoneMix = (type) => cfg.zones.reduce((sum, zone) => sum + ((zone.holdouts && zone.holdouts[type]) || 0), 0);
const holdoutCount = zoneMix('trooper') + zoneMix('brute');

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

test('Level 2: ashore -> three waves -> the hunt -> the gate ambush -> the gate fight -> victory', async () => {
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
        // Wave arrivals only: the holding force spawns later, across the island, not from lanes
        if (level.state === 'waves') (spawnXsByWave[level.waves.waveIndex] ||= []).push(x);
        if (z > 120 || level.environment.heightAt(x, z) < 0.6 || !level.cover.isClearOfSolids(x, z, 1.0)) badSpawns.push([x, z]);
        alien.health.takeDamage({ amount: 99999, source: level.player });
      }
      return level.state === 'objective';
    }
  });

  assert.equal(level.state, 'objective');
  assert.equal(seen.size, totalUnits('trooper') + totalUnits('brute') + holdoutCount, 'every unit of every wave and the holding force arrived');
  assert.equal(brutes, totalUnits('brute') + zoneMix('brute'));
  assert.equal(level._holdoutsTotal, holdoutCount, 'the whole holding force went to ground');
  assert.equal(level.squad.killCount, seen.size);
  assert.deepEqual(badSpawns, [], 'aliens spawn on dry, clear ground north of the beach');
  spawnXsByWave.forEach((xs, i) => {
    assert.ok(xs.length >= 20, `wave ${i + 1} brought ${xs.length} aliens`);
    const spread = Math.max(...xs) - Math.min(...xs);
    assert.ok(spread > 200, `wave ${i + 1} only spread over ${spread.toFixed(0)} m`);
  });
  assert.equal(level.beacon.mesh.visible, true, 'objective beacon shown');
  assert.ok(world.ui.callsTo('showObjective').some((call) => call.args[0].startsWith('HOLD THE BEACH')));

  // Walk into the beacon's ring at the gate: the last group springs from the rocks, and then the
  // gate fight decides the beach (the snipers' and walker's own tests live in gate.test.mjs)
  const goal = level._objectivePoint;
  assert.ok(goal.z < -250, 'the push inland ends at the village gate');
  level.player.teleport(goal.x + 3, level.environment.heightAt(goal.x + 3, goal.z) + 0.1, goal.z);
  stepWorld(world, 90, {
    level,
    onFrame: () => {
      level.player.health.reset();
      for (const alien of level.squad.members) {
        if (alien.name === 'AlienSniper') continue; // The snipers take the perches: leave the rigs up
        alien.health.takeDamage({ amount: 99999, source: level.player });
      }
      return level._heavyDown;
    }
  });
  assert.equal(level.ambushTriggered, true, 'the rocks came alive on the way in');
  assert.equal(level.state, 'gate', 'the fight is at the gate');
  assert.equal(level._heavy.name, 'AlienHeavy');
  assert.equal(level._heavy.isBoss, true);
  assert.ok(world.ui.callsTo('showBossHealth').some((call) => call.args[0] === 'THE GATE WALKER'), 'the walker brings its bar');
  assert.ok(world.ui.callsTo('updateBossHealth').length > 0, 'the bar tracks the fight');
  assert.ok(world.ui.callsTo('hideBossHealth').length > 0, 'and comes down with the walker');
  assert.ok(world.ui.callsTo('showToast').some((call) => call.args[0] === 'The gate walker falls!'));

  // The snipers are all that is left up there: fall back into the open, then cut them down
  const snipers = level._gateUnits.filter((unit) => unit.name === 'AlienSniper');
  assert.equal(snipers.length, cfg.gate.sniper, 'the watchtowers and the ridge kept their marksmen');
  const open = level.environment.pathCentreX(-200);
  level.player.teleport(open, level.environment.heightAt(open, -200) + 0.1, -200);
  for (const sniper of snipers) sniper.health.takeDamage({ amount: 99999, source: level.player });
  stepWorld(world, 0.5, { level, onFrame: () => level.player.health.reset() });
  assert.equal(level.state, 'clear', 'the gate is clear');
  assert.equal(world.ui.callsTo('showObjective').at(-1).args[0], 'THROUGH THE GATE');
  assert.ok(world.ui.callsTo('showToast').some((call) => /gate is clear/.test(call.args[0])));

  // Walk through the opening: the ending takes over — the march up the village road (the sweep
  // runs itself; see _beginGateEntry)
  level.player.teleport(goal.x, level.environment.heightAt(goal.x, goal.z) + 0.1, goal.z);
  stepWorld(world, 0.5, { level, onFrame: () => level.player.health.reset() });
  assert.equal(level.state, 'ending', 'the walk through the gate starts the ending');
  assert.equal(world.music.callsTo('setState').at(-1).args[0], 'victory', 'the score resolves when the gate is won');
  assert.equal(level.cinematic.isPlaying, true, 'the ending sweep is up');
  assert.equal(world.ui.callsTo('showCinematic').at(-1).args[0], 'THROUGH THE GATE');
  assert.ok(world.activeCamera === level.cinematic.camera, 'the ending camera owns the view');
  assert.equal(level.player.isDevSuspended, true, 'the player is marched, not driven');

  // The march: scripted up the road, through the gate line, with the squad along
  const walkFrom = level.player.position.z;
  stepWorld(world, 4, { level });
  assert.ok(level.player.position.z < walkFrom - 3, 'the squad walks in through the gate');

  // Skipped or run out, the sweep hands over the moment it is done: the black, then Level 3
  world.input.press('skipCutscene');
  stepWorld(world, 0.2, { level });
  assert.equal(level.cinematic.isFinished, true);
  assert.equal(level.cinematic.wasSkipped, true);
  assert.ok(world.ui.callsTo('showFade').length >= 1, 'the screen fades to black for the handover');
  stepWorld(world, 2.5, { level });
  assert.equal(level._chained, true, 'asked for only once');
  assert.ok(world.loadedLevel instanceof Level03, 'the beach hands over to the village at night');

  assert.equal(teardown(world, level), 0, 'no physics bodies left');
  assert.equal(world.environmentGroup.children.length, 0);
  assert.equal(world.projectilePool, null);
});

test('Level 2: the push inland springs a final ambush in the rocks at the gate', async () => {
  const { world, level } = await loadLevel(Level02);
  const foot = level.landingZone.spawnPoints.gangwayFoot;
  level.player.teleport(foot.x, foot.y, foot.z);
  stepWorld(world, 0.5, { level });

  // Clear the three waves and the hunt without going anywhere near the gate
  stepWorld(world, 200, {
    level,
    onFrame: () => {
      for (const alien of level.squad.members) alien.health.takeDamage({ amount: 99999, source: level.player });
      return level.state === 'objective';
    }
  });
  assert.equal(level.state, 'objective');
  assert.equal(level.ambushTriggered, false, 'nothing springs until the player pushes in');

  // Step inside the ambush's reach: the rocks around the gate come alive
  const goal = level._objectivePoint;
  const ground = (x, z) => level.environment.heightAt(x, z) + 0.1;
  const triggerZ = goal.z + cfg.finalAmbush.triggerDistance - 5;
  const triggerX = level.environment.pathCentreX(triggerZ);
  level.player.teleport(triggerX, ground(triggerX, triggerZ), triggerZ);

  // Track the arrivals by identity: the hunt's corpses linger in `members` for a few seconds, so
  // indices and lengths lie; every new identity after the trigger is an ambusher
  const already = new Set(level.squad.members);
  const group = [];
  const arrivals = () => {
    for (const alien of level.squad.members) {
      if (!already.has(alien) && !group.includes(alien)) group.push(alien);
    }
  };

  stepWorld(world, 0.3, { level, onFrame: () => { level.player.health.reset(); arrivals(); } });
  assert.equal(level.state, 'ambush');
  assert.equal(level.ambushTriggered, true);
  assert.ok(world.ui.callsTo('showToast').some((call) => /^Ambush!/.test(call.args[0])), 'the ambush is called out');
  assert.ok(world.music.callsTo('stinger').some((call) => call.args[0] === 'ambush'), 'the ambush sting plays');
  assert.equal(world.ui.callsTo('showObjective').at(-1).args[0], 'AMBUSH');

  // The whole group stands up, and it closes on the gate approach, not the beach
  const total = cfg.finalAmbush.trooper + cfg.finalAmbush.brute;
  stepWorld(world, 12, {
    level,
    onFrame: () => {
      level.player.health.reset();
      arrivals();
      return group.length >= total;
    }
  });
  assert.equal(group.length, total, 'the whole ambush group arrived');
  assert.equal(group.filter((alien) => alien.name === 'AlienTrooper').length, cfg.finalAmbush.trooper);
  assert.equal(group.filter((alien) => alien.name === 'AlienBrute').length, cfg.finalAmbush.brute, 'a brute waited in the rocks too');
  const approach = level.gate.approach;
  assert.ok(
    group.every((alien) => Math.hypot(alien.home.x - approach.x, alien.home.z - approach.z) < 30),
    'they close on the gate approach, not the beach'
  );

  // The beacon is not the goal any more while the ambush stands; breaking it opens the gate fight
  level.player.teleport(goal.x + 3, ground(goal.x + 3, goal.z), goal.z);
  stepWorld(world, 0.3, { level, onFrame: () => level.player.health.reset() });
  assert.equal(level.state, 'ambush', 'the road into the village stays shut while the ambush stands');

  stepWorld(world, 8, {
    level,
    onFrame: () => {
      level.player.health.reset();
      for (const alien of level.squad.members) {
        if (alien.name === 'AlienSniper') continue; // They spawn with the gate fight, on the breaking frame
        alien.health.takeDamage({ amount: 99999, source: level.player });
      }
      return level.state === 'gate';
    }
  });
  assert.equal(level.ambush.isDone, true, 'the ambush is broken');
  assert.equal(level.state, 'gate', 'and the fight for the gate is on');
  assert.ok(world.ui.callsTo('showToast').some((call) => /gate opens/.test(call.args[0])), 'the gate shows its teeth');

  const snipers = level._gateUnits.filter((unit) => unit.name === 'AlienSniper');
  assert.equal(snipers.length, cfg.gate.sniper, 'snipers take the watchtowers and the ridge');
  assert.ok(snipers.every((sniper) => !sniper.isDead), 'and every one of them is up on a perch');
  assert.ok(
    snipers.every((sniper) => level.gate.perches.some((perch) =>
      Math.hypot(sniper.position.x - perch.x, sniper.position.z - perch.z) < 1.5 && Math.abs(sniper.position.y - perch.y) < 1.5)),
    'every sniper stands on its own perch'
  );
  assert.equal(teardown(world, level), 0, 'no physics bodies left');
});

test('Level 2: the waves broken, the survivors go to ground — the hunt is map-work, then the push resumes', async () => {
  const { world, level } = await loadLevel(Level02);
  const foot = level.landingZone.spawnPoints.gangwayFoot;
  level.player.teleport(foot.x, foot.y, foot.z);
  stepWorld(world, 0.5, { level });

  // Clear the wave aliens only: the moment the last one falls, the survivors go to ground
  stepWorld(world, 200, {
    level,
    onFrame: () => {
      if (level.state === 'waves') {
        for (const alien of level.squad.members) alien.health.takeDamage({ amount: 99999, source: level.player });
      }
      return level.state === 'hunt';
    }
  });
  assert.equal(level.state, 'hunt', 'the waves are broken and the hunt has begun');

  const holdouts = holdoutCount;
  assert.equal(level._holdoutsTotal, holdouts, 'the holding force is out there');
  assert.equal(level.squad.aliveCount, holdouts);
  assert.ok(
    world.ui.callsTo('showToast').some((call) => /gone to ground/.test(call.args[0]) && call.args[0].includes(String(holdouts))),
    'the call-out names the holding force'
  );

  // They hold the island's far half and never push for the beach the player is standing on
  // (the wave dead keep lying on the beach for a few seconds: only the living count here)
  const held = level.squad.members.filter((alien) => !alien.isDead)
    .map((alien) => ({ alien, x: alien.position.x, z: alien.position.z }));
  assert.ok(held.every(({ z }) => z < 0), 'every holder is inland');
  stepWorld(world, 10, { level, onFrame: () => level.player.health.reset() });
  for (const { alien, x, z } of held) {
    if (alien.isDead) continue;
    const moved = Math.hypot(alien.position.x - x, alien.position.z - z);
    assert.ok(moved < 30, `a holder wandered ${moved.toFixed(0)} m from its post`);
    assert.ok(alien.position.z < 20, 'nobody came for the beach');
  }

  // Each zone keeps its own garrison: the woods are trooper country, and the rock shelf and the
  // outskirts are each backed by a brute (see the `zones` in config)
  const zoneAt = (z) => (z <= -215 ? 'outskirts' : z <= -110 ? 'rocks' : z <= 120 ? 'forest' : 'beach');
  const garrison = { forest: { trooper: 0, brute: 0 }, rocks: { trooper: 0, brute: 0 }, outskirts: { trooper: 0, brute: 0 } };
  for (const { alien, z } of held) {
    garrison[zoneAt(z)][alien.name === 'AlienBrute' ? 'brute' : 'trooper'] += 1;
  }
  assert.deepEqual(garrison, {
    forest: { trooper: 5, brute: 0 },
    rocks: { trooper: 2, brute: 1 },
    outskirts: { trooper: 2, brute: 1 }
  }, 'every zone holds its own mix');

  // The map shows them dim (they have not seen the player yet), and no beacon pin while hunting
  const data = level.getMapData();
  assert.equal(data.enemies.length, holdouts, 'every holder is on the map');
  assert.ok(data.enemies.every((enemy) => enemy.alerted === false), 'the map shows them dim');
  assert.equal(data.enemies.filter((enemy) => enemy.big).length, zoneMix('brute'), 'both heavies read big');
  assert.deepEqual(data.markers, [], 'no beacon pin while the hunt is on');

  // The objective panel counts them down
  const objective = world.ui.callsTo('showObjective').at(-1).args;
  assert.equal(objective[0], 'HUNT THE HOLDERS');
  assert.match(objective[1], new RegExp(`^${holdouts} aliens still hiding`));

  // Clearing the island hands the push back: the beacon lights and the map pin returns
  for (const alien of level.squad.members) alien.health.takeDamage({ amount: 99999, source: level.player });
  stepWorld(world, 0.3, { level });
  assert.equal(level.state, 'objective');
  assert.equal(level.beacon.mesh.visible, true, 'the push beacon lights');
  assert.ok(world.ui.callsTo('showToast').some((call) => /island is quiet/.test(call.args[0])));
  assert.deepEqual(
    level.getMapData().markers,
    [{ x: level._objectivePoint.x, z: level._objectivePoint.z, label: 'THE GATE' }],
    'the map pin shows the way to the gate'
  );

  assert.equal(teardown(world, level), 0, 'no physics bodies left');
});

test('Level 2: the island is four zones — each names itself, holds its own garrison and its own air', async () => {
  const { world, level } = await loadLevel(Level02);
  const ground = (x, z) => level.environment.heightAt(x, z) + 0.1;

  // Aboard the ship nothing is announced, and the ambient mix is still the director's own
  stepWorld(world, 1, { level });
  assert.equal(level._zone, null, 'no zone while aboard');
  assert.equal(world.music.callsTo('setAmbience').length, 0, 'the mix stays untouched until ashore');

  // Step ashore: the beach names itself and takes the surf
  const foot = level.landingZone.spawnPoints.gangwayFoot;
  level.player.teleport(foot.x, foot.y, foot.z);
  stepWorld(world, 0.5, { level });
  assert.equal(level._zone.id, 'beach');
  assert.ok(world.ui.callsTo('showToast').some((call) => /^THE BEACH —/.test(call.args[0])), 'the beach names itself');
  assert.deepEqual(world.music.callsTo('setAmbience').at(-1).args[0], { ocean: 0.12, wind: 0.09, alien: 0 }, 'the beach is surf and wind');

  // Across each inland line the ground changes name and the mix follows: the surf falls away
  // while the wind - and the under-hum - grow
  const crossings = [
    { id: 'forest', toast: /^THE FOREST —/, z: 60, mix: { ocean: 0.05, wind: 0.11, alien: 0.05 } },
    { id: 'rocks', toast: /^THE ROCKFIELDS —/, z: -150, mix: { ocean: 0.02, wind: 0.12, alien: 0.08 } },
    { id: 'outskirts', toast: /^VILLAGE OUTSKIRTS —/, z: -260, mix: { ocean: 0, wind: 0.13, alien: 0.12 } }
  ];
  for (const crossing of crossings) {
    const x = level.environment.pathCentreX(crossing.z);
    level.player.teleport(x, ground(x, crossing.z), crossing.z);
    stepWorld(world, 0.3, { level, onFrame: () => level.player.health.reset() });
    assert.equal(level._zone.id, crossing.id, `crossed into ${crossing.id}`);
    assert.ok(world.ui.callsTo('showToast').some((call) => crossing.toast.test(call.args[0])), `${crossing.id} names itself`);
    assert.deepEqual(world.music.callsTo('setAmbience').at(-1).args[0], crossing.mix, `the ${crossing.id} mix`);
  }

  // The chart draws the zone lines so the island reads at a glance
  assert.deepEqual(level.getMapData().zones, [
    { id: 'forest', name: 'The Forest', z: 120 },
    { id: 'rocks', name: 'The Rockfields', z: -110 },
    { id: 'outskirts', name: 'Village Outskirts', z: -215 }
  ], 'every inland line rides the map');

  // Ambient life: the war inland and something calling out in the trees, on the zone's clock
  const before = world.audio.callsTo('play').length;
  stepWorld(world, 30, {
    level,
    onFrame: () => {
      level.player.health.reset();
      for (const alien of level.squad.members) alien.health.takeDamage({ amount: 99999, source: level.player });
    }
  });
  const plays = world.audio.callsTo('play').slice(before);
  assert.ok(
    plays.some((call) => call.args[0] === 'explosion' && !call.args[1]),
    'a distant explosion reaches the outskirts (flat, not placed on the ground)'
  );
  const call = plays.find((entry) => entry.args[0] === 'alienCall');
  assert.ok(call, 'something calls out in the trees');
  const away = Math.hypot(call.args[1].x - level.player.position.x, call.args[1].z - level.player.position.z);
  assert.ok(away >= 40 && away <= 90, `the call came from ${away.toFixed(0)} m out`);

  assert.equal(teardown(world, level), 0, 'no physics bodies left');
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
  assert.equal(world.music.callsTo('stinger').at(-1).args[0], 'defeat', 'the defeat sting lands the ending');
  assert.ok(world.music.callsTo('stop').length >= 1, 'the bed stops on defeat');

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
  assert.ok(
    world.ui.callsTo('showStatusIndicator').some((call) => /^DOWNED: [A-Za-z]+ is coming to revive you/.test(call.args[0])),
    'the rescuer is named'
  );
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
  assert.ok(
    world.ui.callsTo('showStatusIndicator').some((call) => /^DOWNED: bleeding out — nobody can reach you/.test(call.args[0])),
    'nobody in reach: the indicator says so honestly'
  );
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

test('Level 2: a downed squadmate beside the supply crate owns [E]; the crate comes back after', async () => {
  const { world, level } = await loadLevel(Level02);
  world.input.press('skipCutscene');
  stepWorld(world, 12, { level });
  level.allies.reviveSearchRadius = 0; // Only the player revives in this test

  // A squadmate goes down beside the crate; the player stands next to them, in reach of both
  const crate = level.supplyCrate.position;
  const ground = (x, z) => level.environment.heightAt(x, z) + 0.1;
  const mate = level.allies.mates[0];
  mate.teleport(crate.x - 0.5, ground(crate.x - 0.5, crate.z - 1.1), crate.z - 1.1);
  mate.health.takeDamage({ amount: 9999 });
  level.player.teleport(crate.x - 1.9, ground(crate.x - 1.9, crate.z + 0.2), crate.z + 0.2);
  stepWorld(world, 0.4, { level });
  assert.ok(level.allies.isDowned(mate));
  assert.ok(Math.hypot(level.player.position.x - crate.x, level.player.position.z - crate.z) <= level.supplyCrate.radius, 'in crate reach');

  const prompt = () => world.ui.callsTo('showPrompt').at(-1);
  assert.equal(prompt().args[1], `HOLD TO REVIVE ${mate.name.toUpperCase()}`, 'the revive owns the prompt, not the crate');
  assert.equal(prompt().args[3], level, 'shown by the level');

  // A press meant for the crate does nothing while a revive is on: no ammo, no patch-up
  level.weapons.rifle.reserve = 0;
  level.player.health.takeDamage({ amount: 30 });
  world.input.press('specialAction');
  stepWorld(world, 0.1, { level });
  assert.equal(level.weapons.rifle.reserve, 0, 'the crate stayed quiet');
  assert.ok(level.player.health.currentHealth < level.player.health.maxHealth, 'no patch-up either');

  // Complete the revive: the crate comes back, and [E] resupplies
  world.input.hold('specialAction');
  stepWorld(world, config.revive.holdSeconds + 0.2, { level });
  world.input.release('specialAction');
  assert.equal(mate.isDead, false, 'revived');
  stepWorld(world, 0.2, { level });
  assert.match(world.ui.callsTo('showPrompt').at(-1).args[1], /PATCH UP|FULLY SUPPLIED/, 'the crate prompt is back');

  // The healed crate takes a held [E] now: hold it long enough and it resupplies
  world.input.hold('specialAction');
  stepWorld(world, config.supplyCrate.holdSeconds + 0.25, { level });
  world.input.release('specialAction');
  assert.equal(level.weapons.rifle.reserve, level.weapons.rifle.cfg.reserveAmmo, 'the crate resupplied');
  assert.ok(world.ui.callsTo('showToast').some((call) => /Resupplied/.test(call.args[0])));
  assert.equal(teardown(world, level), 0, 'no physics bodies left');
});

test('Level 2: the wave call-outs are heard, and the break between waves counts down', async () => {
  const { world, level } = await loadLevel(Level02);
  const foot = level.landingZone.spawnPoints.gangwayFoot;
  level.player.teleport(foot.x, foot.y, foot.z);
  stepWorld(world, 1, { level });
  assert.equal(level.state, 'waves', 'the first wave has started');
  assert.ok(
    world.ui.callsTo('showToast').some((call) => /^Wave 1: \d+ aliens/.test(call.args[0])),
    'the first wave is announced'
  );

  // Cut down every alien as it arrives until wave 1 is broken
  stepWorld(world, 60, {
    level,
    onFrame: () => {
      for (const alien of level.squad.members) alien.health.takeDamage({ amount: 99999, source: level.player });
      return level.waves.state === 'between';
    }
  });
  assert.equal(level.waves.state, 'between', 'the wave was held');
  assert.ok(
    world.ui.callsTo('showToast').some((call) => /^Wave 1 held! Next wave in \d+s/.test(call.args[0])),
    'the break is called out'
  );
  assert.ok(level.waves.nextWaveInSeconds > 0 && level.waves.nextWaveInSeconds <= cfg.betweenWavesSeconds);
  const objective = world.ui.callsTo('showObjective').at(-1).args;
  assert.equal(objective[0], 'WAVE 2 INCOMING');
  assert.match(objective[1], /^Next wave in \d+s/);

  // The break ends when the next wave arrives
  stepWorld(world, cfg.betweenWavesSeconds + 1, { level });
  assert.ok(world.ui.callsTo('showToast').some((call) => /^Wave 2: \d+ aliens/.test(call.args[0])), 'wave 2 is announced');
  assert.equal(teardown(world, level), 0, 'no physics bodies left');
});

test('Level 2: camping aboard during the waves sends the aliens to the gangway, with call-outs', async () => {
  const { world, level } = await loadLevel(Level02);
  const foot = level.landingZone.spawnPoints.gangwayFoot;

  // The player never leaves the ship: the first wave starts on its timer anyway
  stepWorld(world, cfg.firstWaveTriggerSeconds + 12, { level });
  assert.equal(level.state, 'waves');
  assert.equal(level._isPlayerAshore(), false, 'the player is still aboard');
  assert.ok(
    world.ui.callsTo('showToast').some((call) => /massing at the gangway/.test(call.args[0])),
    'the squad calls the massing out'
  );
  assert.ok(
    world.ui.callsTo('showObjective').some((call) => /get ashore/i.test(String(call.args[1]))),
    'the objective panel nudges too'
  );

  // Wave aliens spawn for the bottom of the gangway, not their lane's beach point
  const camped = [];
  for (let i = 0; i < 10; i++) {
    const alien = level.spawnAlien('trooper', 'farWest');
    if (alien) camped.push(alien);
  }
  assert.equal(camped.length, 10, 'every alien found a spawn spot');
  assert.ok(
    camped.every((alien) => Math.hypot(alien.home.x - foot.x, alien.home.z - foot.z) <= 20),
    'while the player camps aboard, the aliens make for the gangway'
  );

  // Step ashore: fresh spawns go back to their lane's beach point
  level.player.teleport(foot.x, foot.y, foot.z);
  stepWorld(world, 0.2, { level });
  assert.equal(level._isPlayerAshore(), true);
  const ashore = [];
  for (let i = 0; i < 10; i++) {
    const alien = level.spawnAlien('trooper', 'farEast');
    if (alien) ashore.push(alien);
  }
  assert.equal(ashore.length, 10);
  assert.ok(
    ashore.every((alien) => Math.hypot(alien.home.x - foot.x, alien.home.z - foot.z) > 30),
    'once the player is ashore, the aliens push for the beach again'
  );

  assert.equal(teardown(world, level), 0, 'no physics bodies left');
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

test('Level 2 test level: a fresh group marches on the gangway while the player stays aboard', async () => {
  const { world, level } = await loadLevel(Level02TestLevel);
  world.input.press('skipCutscene');
  stepWorld(world, 0.5, { level });
  assert.equal(level._isPlayerAshore(), false, 'the player never left the ship');
  assert.equal(world.music.callsTo('setState')[0].args[0], 'deploy', 'the sandbox opens on the mission-start intro groove');

  // Wipe the patrol out from the deck: the respawned group is the ship-camping pressure preview
  for (const alien of level.squad.members) alien.health.takeDamage({ amount: 99999, source: level.player });
  stepWorld(world, 6, { level });
  assert.equal(level.squad.aliveCount, 4, 'a fresh group arrived');

  const foot = level.landingZone.spawnPoints.gangwayFoot;
  for (const alien of level.squad.members) {
    if (alien.isDead) continue; // A not-yet-pruned corpse keeps its old post
    const distance = Math.hypot(alien.home.x - foot.x, alien.home.z - foot.z);
    assert.ok(distance <= 20, `bound for the gangway, ${distance.toFixed(1)} m away`);
  }

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

test('Level 2: the score follows the mission — the intro groove, the surf, combat and the held-wave suspense', async () => {
  const { world, level } = await loadLevel(Level02);
  assert.deepEqual(world.music.callsTo('setState').map((call) => call.args[0]), ['deploy'],
    'the mission opens on the intro groove');
  assert.deepEqual(world.music.callsTo('stinger').map((call) => call.args[0]), ['deploy'],
    'the mission opens with the deploy swell');

  // The opening sweep ends (here: skipped): the intro stops and the scene is just surf and wind
  world.input.press('skipCutscene');
  stepWorld(world, 0.2, { level });
  assert.equal(world.music.callsTo('setState').at(-1).args[0], 'ambient', 'the camera reaching the player hands the scene to the surf');

  const foot = level.landingZone.spawnPoints.gangwayFoot;
  level.player.teleport(foot.x, foot.y, foot.z);
  stepWorld(world, 0.5, { level });
  assert.equal(world.music.callsTo('setState').at(-1).args[0], 'combat', 'the waves turn the score to combat');

  // Clear the first wave: the break between waves drops the score to suspense with its sting
  stepWorld(world, 90, {
    level,
    onFrame: () => {
      for (const alien of level.squad.members) alien.health.takeDamage({ amount: 99999, source: level.player });
      return level.waves.state === 'between';
    }
  });
  assert.equal(level.waves.state, 'between');
  const states = world.music.callsTo('setState').map((call) => call.args[0]);
  assert.ok(states.includes('suspense'), 'the break between waves drops to suspense');
  assert.ok(world.music.callsTo('stinger').some((call) => call.args[0] === 'waveHeld'), 'the held wave gets its sting');

  assert.equal(teardown(world, level), 0, 'no physics bodies left');
});
