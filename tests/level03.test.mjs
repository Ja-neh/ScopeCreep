// Level 3 so far: the big night village with the squad arriving at the gate, the force field
// barring the way into the hall, the crew keeping up in the streets; the sandbox level; clean
// teardown. (The generators: generators.test.mjs. The Warden: warden.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { Level03 } from '../src/levels/Level03.js';
import { Level03TestLevel } from '../src/levels/Level03TestLevel.js';
import config from '../src/config.json';

async function loadLevel(LevelClass, seed = 9) {
  const world = await createTestWorld({ seed });
  const level = new LevelClass(world);
  await level.init();
  if (level.cinematic) level.cinematic.finish(); // Skip the opening (ending.test.mjs covers it)
  return { world, level };
}

function teardown(world, level) {
  level.dispose();
  world.clearEntities();
  return bodyCount(world);
}

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Takes the aliens away (and stops more coming), so the crew only follow. */
function clearAliens(level) {
  level._stopDefenses();
  level.clearAliens(); // All but the Warden
}

test('Level 3 starts at night below the village gate, with the crew right behind the player', async () => {
  const { world, level } = await loadLevel(Level03);
  stepWorld(world, 0.5, { level });
  assert.equal(level.environment.lookName, 'night');
  assert.equal(level.environment.layoutName, 'village');
  assert.equal(level.state, 'generators');
  assert.ok(flat(level.player.position, level.village.spawnPoints.start) < 1, 'on the path below the gate');
  assert.equal(level.allies.mates.length, config.allies.crewSize - 1);
  for (const mate of level.allies.mates) {
    assert.ok(flat(mate.position, level.player.position) < 12, `${mate.name} is with the player`);
    assert.equal(mate.order, 'follow');
  }
  assert.ok(level.supplyCrate && level.supplyCrate.collider, 'a supply crate by the gate');
  assert.match(world.ui.callsTo('showObjective').at(-1).args[1], /Shut down its generators .* 0\/3/);
  const guards = config.levels.level03.generatorDefense.guards * level.generators.length;
  assert.equal(level.squad.aliveCount, guards + 1, 'guards at every generator, and the Warden');
  assert.ok(level.arena.warden.brain.is('dormant'), 'the Warden waits in the hall');
  // The jungle grows right up to the village, but not into it
  let inVillage = 0;
  for (const set of level.cover.vegetation) {
    for (const list of Object.values(set.placements)) {
      inVillage += list.filter((p) => level.environment.isInVillage(p.x, p.z)).length;
    }
  }
  assert.equal(inVillage, 0, 'no jungle inside the village');
  assert.equal(teardown(world, level), 0, 'no physics bodies left');
  assert.equal(world.environmentGroup.children.length, 0, 'nothing left in the scene');
});

test('Level 3: up the avenue to the square, where the force field bars the way into the hall; the crew keep up', async () => {
  const { world, level } = await loadLevel(Level03);
  clearAliens(level);
  const square = level.village.square;
  const hall = level.village.hall;
  const waypoints = [level.village.gate, { x: square.x, z: square.z + 8 }, { x: square.x + 6, z: square.z }, hall.doorway];
  let index = 0;
  world.input.hold('forward');
  stepWorld(world, 85, {
    level,
    onFrame: () => {
      const target = waypoints[Math.min(index, waypoints.length - 1)];
      if (flat(level.player.position, target) < 1.5 && index < waypoints.length - 1) index++;
      const next = waypoints[Math.min(index, waypoints.length - 1)];
      level.player.yaw = Math.atan2(-(next.x - level.player.position.x), -(next.z - level.player.position.z));
      return false;
    }
  });
  world.input.release('forward');
  assert.equal(index, waypoints.length - 1, 'made it up the avenue and across the square');
  const fromDome = flat(level.player.position, level.dome.centre);
  assert.ok(fromDome > level.dome.radius - 0.5 && fromDome < level.dome.radius + 2, `stopped at the force field (${fromDome.toFixed(1)} m from its middle)`);
  assert.equal(level.state, 'generators', 'no way into the hall yet');

  stepWorld(world, 6, { level });
  const near = level.allies.mates.filter((mate) => flat(mate.position, level.player.position) < 14).length;
  assert.ok(near >= 3, `only ${near} squadmates kept up`);
  assert.equal(teardown(world, level), 0);
});

test('Level 3: the crew follow the player round a street corner, past the houses', async () => {
  const { world, level } = await loadLevel(Level03);
  clearAliens(level);
  const cross = { x: 0, z: -290 };
  const end = { x: -60, z: -290 };
  const waypoints = [level.village.gate, cross, end];
  let index = 0;
  world.input.hold('forward');
  stepWorld(world, 30, {
    level,
    onFrame: () => {
      const target = waypoints[Math.min(index, waypoints.length - 1)];
      if (flat(level.player.position, target) < 1.5) {
        index++;
        if (index >= waypoints.length) return true;
      }
      const next = waypoints[Math.min(index, waypoints.length - 1)];
      level.player.yaw = Math.atan2(-(next.x - level.player.position.x), -(next.z - level.player.position.z));
      return false;
    }
  });
  world.input.release('forward');
  assert.ok(flat(level.player.position, end) < 2, 'the player turned into the cross street');

  stepWorld(world, 10, { level });
  for (const mate of level.allies.mates) {
    const distance = flat(mate.position, level.player.position);
    assert.ok(distance < 14, `${mate.name} is ${distance.toFixed(1)} m away at ${mate.position.x.toFixed(1)}, ${mate.position.z.toFixed(1)}`);
  }
  assert.equal(teardown(world, level), 0);
});

test('Level 3 test level: aliens in the streets, F4 squad toggle, respawn instead of failing', async () => {
  const { world, level } = await loadLevel(Level03TestLevel);
  assert.equal(level.squad.members.filter((alien) => !alien.isBoss).length, 4); // Besides the Warden in the hall
  assert.equal(level.squad.members.filter((alien) => alien.name === 'AlienBrute').length, 1);

  world.input.press('devSquad');
  stepWorld(world, 0.1, { level });
  assert.equal(level.allies.mates.length, 0);
  level.player.health.takeDamage({ amount: 1000 });
  stepWorld(world, config.player.vitals.respawnSeconds + 0.5, { level });
  assert.equal(level.player.health.isDead, false, 'respawned');
  assert.equal(world.ui.callsTo('showMissionResult').length, 0);

  world.input.press('devSquad');
  stepWorld(world, 0.1, { level });
  assert.equal(level.allies.mates.length, config.allies.crewSize - 1);
  assert.equal(teardown(world, level), 0);
});
