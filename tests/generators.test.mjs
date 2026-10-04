// Level 3's force field over the hall and the three generators that feed it: where they stand
// and who guards them, the dome keeping people and bullets out, holding [E] to shut a generator
// down, the dome collapsing when all three are down, and clean teardown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { Level03 } from '../src/levels/Level03.js';
import { HitscanWeapon } from '../src/weapons/HitscanWeapon.js';
import config from '../src/config.json';

const cfg = config.levels.level03.generator;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

async function loadLevel(seed = 4) {
  const world = await createTestWorld({ seed });
  const level = new Level03(world);
  await level.init();
  return { world, level };
}

function teardown(world, level) {
  level.dispose();
  world.clearEntities();
  return bodyCount(world);
}

/** The player alone (no aliens, no squad) standing at (x, z). */
function alone(world, level, x, z) {
  for (const alien of [...level.squad.members]) level.squad.remove(alien);
  level.allies.removeAllMates();
  level.player.teleport(x, level.environment.heightAt(x, z) + 0.4, z);
  stepWorld(world, 0.2, { level });
}

test('three generators stand by three landed ships far apart, each guarded, their beams running up to the dome', async () => {
  const { world, level } = await loadLevel();
  const { generators, dome, village } = level;
  assert.equal(generators.length, 3);
  for (const generator of generators) {
    const ship = village.ships.reduce((a, b) => (flat(a, generator.position) < flat(b, generator.position) ? a : b));
    assert.ok(flat(ship, generator.position) < ship.radius + 6, `${generator.name} stands by a ship`);
    assert.ok(village.isOpenGround(generator.position.x + cfg.radius - 0.5, generator.position.z), 'room to stand beside it');
    assert.ok(generator.light.intensity > 0 && generator.beam.visible, 'running: lit, with its beam up');
    assert.ok(generator.collider, 'solid');
    // The beam ends at the top of the dome
    const end = new THREE.Vector3(0, 1, 0).applyQuaternion(generator.beam.quaternion).multiplyScalar(generator.beam.scale.y)
      .add(generator.beam.position).add(generator.position);
    assert.ok(end.distanceTo(dome.top) < 0.5, 'beam reaches the top of the dome');
    const guards = level.squad.members.filter((alien) => flat(alien.position, generator.position) < 10);
    assert.equal(guards.length, config.levels.level03.generatorGuards, `${generator.name} has its guards`);
  }
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) assert.ok(flat(generators[i].position, generators[j].position) > 100, 'spread across the village');
  }
  assert.equal(teardown(world, level), 0);
});

test('the force field keeps everyone out of the hall, and stops bullets', async () => {
  const { world, level } = await loadLevel();
  const { dome, village } = level;
  const hall = village.hall;
  assert.ok(dome.isUp);
  assert.ok(dome.blocks(hall.centre.x, hall.centre.z) && dome.blocks(hall.doorway.x, hall.doorway.z), 'the whole hall and its door are under it');
  assert.equal(level._isWalkable(hall.doorway.x, hall.doorway.z), false, 'no formation places under it');

  // Walk straight at the door: stopped at the edge of the dome
  const start = hall.doorway.clone().addScaledVector(hall.forward, 30);
  alone(world, level, start.x, start.z);
  level.player.yaw = Math.atan2(hall.forward.x, hall.forward.z);
  world.input.hold('forward');
  stepWorld(world, 6, { level });
  world.input.release('forward');
  const fromCentre = flat(level.player.position, dome.centre);
  assert.ok(fromCentre > dome.radius - 0.5, `walked into the force field (${fromCentre.toFixed(1)} m from its middle)`);

  // Shoot at the hall: the round stops on the dome
  const gun = new HitscanWeapon(config.weapons.machineGun);
  const eye = level.player.position.clone();
  eye.y += 1.7;
  const target = hall.centre.clone();
  target.y += 3;
  const shot = gun.fire({ physicsWorld: world.physics, origin: eye, aimPoint: target, spread: 0, excludeCollider: level.player.collider, source: level.player });
  assert.ok(shot.hit);
  assert.ok(Math.abs(shot.point.distanceTo(dome.centre) - dome.radius) < 0.2, 'the bullet hit the dome');
  assert.equal(teardown(world, level), 0);
});

test('hold [E] beside a generator to shut it down; the progress drains if you let go, and nothing happens out of reach', async () => {
  const { world, level } = await loadLevel();
  const generator = level.generators[0];
  const p = generator.position;
  const ui = world.ui;

  // Out of reach: nothing
  alone(world, level, p.x + cfg.radius + 1.5, p.z);
  world.input.hold('specialAction');
  stepWorld(world, 1, { level });
  assert.equal(generator.progress, 0);

  // Beside it: the prompt, then progress while holding
  level.player.teleport(p.x + cfg.radius - 1, p.y + 0.4, p.z);
  world.input.release('specialAction');
  stepWorld(world, 0.2, { level });
  assert.match(ui.callsTo('showPrompt').at(-1).args[1], /HOLD TO SHUT DOWN THE WEST GENERATOR/);
  world.input.hold('specialAction');
  stepWorld(world, 2, { level });
  assert.ok(Math.abs(generator.progress - 2) < 0.05);
  assert.match(ui.callsTo('showPrompt').at(-1).args[1], /SHUTTING DOWN \d+%/);

  // Let go: it drains away
  world.input.release('specialAction');
  stepWorld(world, 1, { level });
  assert.ok(Math.abs(generator.progress - (2 - cfg.drainPerSecond)) < 0.05, 'draining');
  assert.equal(generator.isShutDown, false);

  // Hold on long enough: down
  world.input.hold('specialAction');
  stepWorld(world, cfg.holdSeconds, { level });
  world.input.release('specialAction');
  assert.ok(generator.isShutDown);
  assert.equal(generator.light.intensity, 0, 'dark');
  assert.equal(generator.beam.visible, false, 'its beam is gone');
  assert.ok(ui.callsTo('hidePrompt').some((call) => call.args[0] === generator), 'prompt gone');
  assert.match(ui.callsTo('showToast').at(-1).args[0], /West generator is down\. 2 to go/);
  assert.match(ui.callsTo('showObjective').at(-1).args[1], /1\/3/);
  assert.ok(level.dome.isUp, 'the others still hold the field up');
  assert.equal(teardown(world, level), 0);
});

test('with all three generators down the dome collapses: the way in opens, and the hall is next', async () => {
  const { world, level } = await loadLevel();
  const { dome, village } = level;
  const hall = village.hall;
  for (const generator of level.generators) generator.shutDown();
  stepWorld(world, 0.2, { level });
  assert.equal(dome.state, 'collapsing');
  assert.equal(dome.collider, null, 'the way in is open at once');
  assert.equal(level.state, 'hall');
  assert.match(world.ui.callsTo('showObjective').at(-1).args[1], /Get inside the hall/);
  assert.ok(level._isWalkable(hall.entrance.x, hall.entrance.z), 'the squad can stand at the door now');

  stepWorld(world, 3, { level });
  assert.equal(dome.state, 'down');
  assert.equal(dome.mesh.visible, false, 'faded out');

  // Through the door: the Warden wakes
  const outside = hall.doorway.clone().addScaledVector(hall.forward, 10);
  alone(world, level, outside.x, outside.z);
  level.player.yaw = Math.atan2(hall.forward.x, hall.forward.z);
  world.input.hold('forward');
  stepWorld(world, 4, { level, onFrame: () => level.state === 'boss' });
  world.input.release('forward');
  assert.equal(level.state, 'boss');
  assert.ok(level.arena.warden.brain.is('engage'));
  assert.equal(teardown(world, level), 0, 'no physics bodies left');
  assert.equal(world.environmentGroup.children.length, 0, 'the dome is gone from the scene');
});
