// The village gate finale: the gate structure on the plateau rim, the snipers and their sight
// rigs, the garrison pour and the gate walker's bar (see VillageGate, AlienSniper, AlienHeavy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { Level02 } from '../src/levels/Level02.js';
import config from '../src/config.json';

const cfg = config.levels.level02;

async function loadLevel(seed = 3) {
  const world = await createTestWorld({ seed });
  const level = new Level02(world);
  await level.init();
  return { world, level };
}

function teardown(world, level) {
  level.dispose();
  world.clearEntities();
  return bodyCount(world);
}

/**
 * Fast-forwards to the gate fight: ashore, the waves and the hunt cleared, the ambush sprung and
 * broken. The snipers spawn with the gate fight and are left standing (test B's business).
 */
async function loadAtGate(seed = 3) {
  const { world, level } = await loadLevel(seed);
  const foot = level.landingZone.spawnPoints.gangwayFoot;
  level.player.teleport(foot.x, foot.y, foot.z);
  stepWorld(world, 0.5, { level });

  stepWorld(world, 200, {
    level,
    onFrame: () => {
      for (const alien of level.squad.members) alien.health.takeDamage({ amount: 99999, source: level.player });
      return level.state === 'objective';
    }
  });

  const goal = level._objectivePoint;
  const z = goal.z + cfg.finalAmbush.triggerDistance - 5;
  const x = level.environment.pathCentreX(z);
  level.player.teleport(x, level.environment.heightAt(x, z) + 0.1, z);
  stepWorld(world, 0.3, { level, onFrame: () => level.player.health.reset() });
  assert.equal(level.state, 'ambush', 'the ambush sprang on the way in');

  stepWorld(world, 10, {
    level,
    onFrame: () => {
      level.player.health.reset();
      for (const alien of level.squad.members) {
        if (alien.name === 'AlienSniper') continue; // They spawn with the gate fight: leave them up
        alien.health.takeDamage({ amount: 99999, source: level.player });
      }
      return level.state === 'gate';
    }
  });
  assert.equal(level.state, 'gate', 'the gate fight is on');
  return { world, level };
}

test('Level 2: the village gate — the frame, the towers and the garrison posts on the plateau rim', async () => {
  const { world, level } = await loadLevel();
  const gate = level.gate;

  // The site: on the plateau, straddling the path (the push inland's own point)
  assert.equal(gate.centre.z, -252);
  assert.equal(gate.centre.x, level.environment.pathCentreX(-252));
  assert.ok(gate.centre.y > 10, `the gate stands on the plateau (h ${gate.centre.y.toFixed(1)})`);
  assert.ok(gate.colliders.length >= 10, `${gate.colliders.length} solid parts are colliders`);

  // The perches: both watchtowers look down over the opening, the ridge ledge is up west
  assert.equal(gate.perches.length, 3);
  assert.ok(gate.perches.slice(0, 2).every((perch) => perch.y > gate.centre.y + 5), 'the watchtowers tower');
  assert.deepEqual(gate.perches[2], { x: -25, y: level.environment.heightAt(-25, -215) + 0.05, z: -215 }, 'the ridge ledge');

  // The garrison posts are behind the line, on the village side
  assert.equal(gate.defensePosts.length, 6);
  assert.ok(gate.defensePosts.every((post) => post.z < gate.centre.z), 'every post is beyond the wall line');

  // The site is kept clear of the scenery (the gate yard and the ridge sniper's ledge)
  assert.deepEqual(gate.clearings, [
    { x: gate.centre.x, z: -252, radius: 28 },
    { x: -25, z: -215, radius: 5 }
  ]);

  // The push inland ends at the gate: the beacon stands through the opening, hidden until then
  assert.ok(Math.abs(level._objectivePoint.z - (gate.centre.z - 6)) < 0.5, 'the objective is just through the opening');
  assert.equal(level.beacon.mesh.visible, false, 'no beacon while the beach is still held');
  assert.deepEqual(level.getMapData().markers, [], 'no gate pin while the beach is still held');

  assert.equal(teardown(world, level), 0, 'no physics bodies left');
});

test('Level 2: the snipers hold the perches, wear a glint and never leave', async () => {
  const { world, level } = await loadAtGate();
  const snipers = level._gateUnits.filter((unit) => unit.name === 'AlienSniper');
  assert.equal(snipers.length, cfg.gate.sniper, 'one marksman per perch');

  // Step out into the open below: the sight rig rides the muzzle through the whole watch
  const sniper = snipers[0];
  const placed = { x: sniper.position.x, z: sniper.position.z };
  const openX = level.environment.pathCentreX(-200);
  level.player.teleport(openX, level.environment.heightAt(openX, -200) + 0.1, -200);
  let sawGlint = false;
  let sawBeam = false;
  let minHealth = level.player.health.maxHealth;
  stepWorld(world, 25, {
    level,
    onFrame: () => {
      for (const alien of level.squad.members) {
        if (alien.name === 'AlienSniper') continue; // Only the snipers get to shoot
        alien.health.takeDamage({ amount: 99999, source: level.player });
      }
      if (!sniper.isDead) {
        if (sniper._sight.visible) sawGlint = true;
        if (sniper._beam.visible) sawBeam = true;
        minHealth = Math.min(minHealth, level.player.health.currentHealth);
      }
      level.player.health.reset();
    }
  });
  const moved = Math.hypot(sniper.position.x - placed.x, sniper.position.z - placed.z);
  assert.equal(sniper._sight.parent, world.effectsGroup, 'the glint and beam live in the effects group');
  assert.ok(sawGlint, 'the glint rides the muzzle the whole time it watches');
  assert.ok(sawBeam, 'the laser trains on the player before the shot');
  assert.ok(minHealth <= level.player.health.maxHealth*(1-config.alienPowers.galiant.fractionMin), `the acid shot lands (health fell to ${minHealth})`);
  assert.ok(moved < 0.05, `a sniper holds its perch (moved ${moved.toFixed(2)} m)`);

  // The gate guard is down to the snipers; cutting them down is what clears it
  for (const unit of snipers) unit.health.takeDamage({ amount: 99999, source: level.player });
  stepWorld(world, 0.5, { level, onFrame: () => level.player.health.reset() });
  assert.equal(level.state, 'clear', 'the gate is clear');
  assert.equal(teardown(world, level), 0, 'no physics bodies left');
  assert.equal(world.effectsGroup.children.length, 0, 'the sight rigs came down with the snipers');
});

test('Level 2: the gate guard pours out, and the walker brings its bar', async () => {
  const { world, level } = await loadAtGate();

  // Cut everything down the moment it shows itself: the queue drains, the walker steps out — bar
  // and all — and the last body down clears the gate
  stepWorld(world, 30, {
    level,
    onFrame: () => {
      level.player.health.reset();
      for (const alien of level.squad.members) alien.health.takeDamage({ amount: 99999, source: level.player });
      return level.state === 'clear';
    }
  });
  assert.equal(level.state, 'clear', 'the whole guard is down');
  assert.equal(level._gateQueue.length, 0, 'every garrison unit poured out');
  assert.equal(level._heavyDown, true);
  assert.equal(level._heavy.name, 'AlienHeavy');
  assert.equal(level._heavy.isBoss, true, "the walker is the gate's own boss");
  assert.equal(level._heavy.displayName, 'THE GATE WALKER');
  assert.equal(level._gateUnits.length, cfg.gate.sniper + cfg.gate.trooper + cfg.gate.brute + 1, 'snipers, garrison and the walker all stood');
  assert.ok(!world.ui.callsTo('showBossHealth').some((call) => call.args[0] === 'THE GATE WALKER'), 'red aliens use overhead health bars');
  assert.ok(world.ui.callsTo('updateBossHealth').length >= 1, 'and tracks its health');
  assert.ok(world.ui.callsTo('hideBossHealth').length >= 1, 'and comes down when it falls');
  assert.ok(world.ui.callsTo('showToast').some((call) => call.args[0] === 'The gate walker comes out!'));
  assert.ok(world.ui.callsTo('showToast').some((call) => /gate is clear/.test(call.args[0])));

  // The fall gets its own beat: a kill-cam on the corpse that hands the view back by itself
  stepWorld(world, 0.2, { level, onFrame: () => level.player.health.reset() });
  assert.ok(level.killCam && level.killCam.isPlaying, 'the walker falls into a kill-cam');
  assert.equal(world.ui.callsTo('showCinematic').at(-1).args[0], 'THE GATE WALKER FALLS');
  assert.ok(world.activeCamera === level.killCam.camera, 'the kill-cam owns the view');
  assert.equal(level.player.isDevSuspended, true, 'frozen for the beat');
  const distance = level.killCam.camera.position.distanceTo(level._heavy.mesh.position);
  assert.ok(distance < 12, `the beat is on the corpse (${distance.toFixed(1)} m)`);
  stepWorld(world, 4, { level, onFrame: () => level.player.health.reset() });
  assert.equal(level.killCam.isFinished, true, 'the beat ends on its own');
  assert.equal(level.player.isDevSuspended, false, 'the view and the controls come back');

  // The walker is sent at the gate approach, where the garrison held
  const approach = level.gate.approach;
  assert.ok(
    Math.hypot(level._heavy.home.x - approach.x, level._heavy.home.z - approach.z) < 0.001,
    'the walker pushes for the gate approach'
  );

  assert.equal(teardown(world, level), 0, 'no physics bodies left');
});
