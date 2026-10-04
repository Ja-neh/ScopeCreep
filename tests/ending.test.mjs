// Level 3's opening and ending: the camera sweep over the village that ends on the player's
// view, the islanders' cages (locked until the Warden falls, then freed with [E]), the dawn
// coming up as the camera leaves the hall, the credits, the mission result, and clean teardown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { Level03 } from '../src/levels/Level03.js';
import { BeachEnvironment } from '../src/levels/level02/BeachEnvironment.js';
import config from '../src/config.json';

const cfg = config.levels.level03;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

async function loadLevel(seed = 6) {
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

/** Straight to the Warden falling (no aliens, no force fields), and on to the islanders. */
function beatTheWarden(world, level) {
  if (level.cinematic) level.cinematic.finish();
  level._stopDefenses();
  level.clearAliens(); // All but the Warden
  level.shutDownGenerators({ instant: true });
  stepWorld(world, 0.2, { level });
  const hall = level.village.hall;
  const inside = hall.doorway.clone().addScaledVector(hall.forward, -3);
  level.player.teleport(inside.x, inside.y + 0.4, inside.z);
  stepWorld(world, 0.2, { level });
  const { arena } = level;
  for (const crystal of arena.crystals) crystal.health.takeDamage({ amount: 9999 });
  stepWorld(world, 0.1, { level });
  arena.warden.enraged = true;
  arena.warden.health.takeDamage({ amount: 99999 });
  stepWorld(world, cfg.victoryDelaySeconds + 0.5, { level });
  assert.equal(level.state, 'hostages');
}

test('the opening sweeps over the village with its title card, holds the player still, and ends on their own view', async () => {
  const { world, level } = await loadLevel();
  const ui = world.ui;
  stepWorld(world, 1, { level });
  const opening = level.cinematic;
  assert.ok(opening.isPlaying);
  assert.equal(ui.callsTo('showCinematic').at(-1).args[0], 'THE VILLAGE');
  assert.ok(level.player.isDevSuspended, 'the player waits');
  assert.ok(world.getActiveCamera() === opening.camera);
  const hall = level.village.hall;
  const warden = level.arena.warden;
  assert.ok(warden.brain.is('dormant'), 'the Warden is in the hall from the start');
  assert.ok(hall.contains(opening.camera.position.x, opening.camera.position.z), 'it opens inside the hall...');
  const toWarden = new THREE.Vector3().subVectors(warden.position, opening.camera.position).setY(0).normalize();
  const looking = new THREE.Vector3(0, 0, -1).applyQuaternion(opening.camera.quaternion).setY(0).normalize();
  assert.ok(looking.dot(toWarden) > 0.8, '...looking at the Warden among its prisoners');
  for (const cage of level.cages) assert.ok(flat(cage.position, warden.position) < 14, 'the cages round it');

  let highest = 0;
  stepWorld(world, 15.5, { level, onFrame: () => { highest = Math.max(highest, opening.camera.position.y); } });
  assert.ok(highest > level.environment.village.height + 150, `up high over the village (${highest.toFixed(0)} m)`);
  assert.ok(opening.isFinished);
  assert.equal(level.player.isDevSuspended, false, 'the player can move');
  assert.ok(world.getActiveCamera() === world.camera, 'back to the player\'s camera');
  assert.ok(opening.camera.position.distanceTo(world.camera.position) < 1.5, 'it ended where the player\'s view begins');
  assert.equal(ui.callsTo('hideCinematic').length, 1);

  // [Space] skips it
  const again = await loadLevel(7);
  stepWorld(again.world, 1, { level: again.level });
  again.world.input.press('skipCutscene');
  stepWorld(again.world, 0.1, { level: again.level });
  assert.ok(again.level.cinematic.isFinished && again.level.cinematic.wasSkipped);
  assert.equal(again.level.player.isDevSuspended, false);
  assert.equal(teardown(again.world, again.level), 0);
  assert.equal(teardown(world, level), 0);
});

test('four islanders in cages along the hall walls: locked while the Warden lives, then [E] frees each one', async () => {
  const { world, level } = await loadLevel();
  const hall = level.village.hall;
  assert.equal(level.cages.length, 4);
  for (const cage of level.cages) {
    assert.ok(hall.contains(cage.position.x, cage.position.z), `${cage.name} is in the hall`);
    assert.ok(cage.locked && !cage.freed && cage.collider, 'caged');
  }
  for (const pillar of hall.pillars) {
    for (const cage of level.cages) assert.ok(flat(pillar, cage.position) > 2.5, 'clear of the pillars');
  }

  // Locked during the fight
  if (level.cinematic) level.cinematic.finish();
  level._stopDefenses();
  level.clearAliens(); // All but the Warden
  level.shutDownGenerators({ instant: true });
  const cage = level.cages[0];
  const side = Math.sign(hall.centre.x - cage.position.x) || 1;
  level.player.teleport(cage.position.x + side * 1.9, cage.position.y + 0.4, cage.position.z);
  stepWorld(world, 0.2, { level });
  world.input.hold('specialAction');
  stepWorld(world, cfg.hostages.holdSeconds + 0.5, { level });
  world.input.release('specialAction');
  assert.equal(cage.freed, false, 'locked');
  assert.match(world.ui.callsTo('showPrompt').at(-1).args[1], /LOCKED/);
  assert.equal(teardown(world, level), 0);

  // After the Warden: hold [E] to free them
  const after = await loadLevel(8);
  beatTheWarden(after.world, after.level);
  const first = after.level.cages[0];
  after.level.player.teleport(first.position.x + side * 1.9, first.position.y + 0.4, first.position.z);
  stepWorld(after.world, 0.2, { level: after.level });
  assert.match(after.world.ui.callsTo('showPrompt').at(-1).args[1], /HOLD TO FREE AMA/);
  after.world.input.hold('specialAction');
  stepWorld(after.world, cfg.hostages.holdSeconds + 0.2, { level: after.level });
  after.world.input.release('specialAction');
  assert.ok(first.freed, 'free');
  assert.equal(first.collider, null, 'the cage no longer blocks the way');
  stepWorld(after.world, 1.2, { level: after.level });
  assert.equal(first.bars.visible, false, 'the bars sank into the floor');
  assert.ok(first.villager.arms[0].rotation.x < -2, 'and they cheer');
  assert.match(after.world.ui.callsTo('showObjective').at(-1).args[1], /1\/4/);
  assert.equal(after.level.state, 'hostages');
  assert.equal(teardown(after.world, after.level), 0);
});

test('dawn: the sky, stars, fog, light, clouds and sea move together from night to dawn', async () => {
  const world = await createTestWorld();
  const env = new BeachEnvironment(world, { look: 'night', layout: 'village' });
  env.build();
  const sky = env.sky.uniforms;
  const nightFog = world.scene.fog.color.clone();
  const nightUp = env.sunDirection.y;
  env.blendLook('night', 'dawn', 0.5);
  assert.ok(sky.uStars.value > 0.4 && sky.uStars.value < 0.6, 'the stars are fading');
  env.blendLook('night', 'dawn', 1);
  assert.equal(sky.uStars.value, 0, 'no stars at dawn');
  const fog = world.scene.fog.color;
  assert.ok(fog.r > nightFog.r + 0.3, 'warm haze');
  assert.equal(sky.uHorizonColor.value.getHex(), fog.getHex(), 'sky and haze agree');
  assert.ok(env.sunDirection.y < nightUp && env.sunDirection.x > 0.5, 'the sun low in the east');
  assert.ok(env.sun.color.r > env.sun.color.b, 'warm sunlight');
  assert.ok(env.ocean.uniforms.uSunDirection.value.distanceTo(env.sunDirection) < 1e-6, 'the sea agrees on where the sun is');
  // The night look itself is untouched (another level loading it starts at night)
  const again = new BeachEnvironment(world, { look: 'night' });
  assert.ok(again.sunDirection.y > 0.6);
  env.dispose();
});

test('all four free: the camera leaves the hall into the dawn, the credits roll, and the mission is won', async () => {
  const { world, level } = await loadLevel();
  const ui = world.ui;
  beatTheWarden(world, level);
  for (const cage of level.cages) cage.free();
  stepWorld(world, 0.2, { level });
  assert.equal(level.state, 'ending');
  const ending = level.cinematic;
  assert.ok(ending.isPlaying);
  assert.equal(ui.callsTo('showCinematic').at(-1).args[0], 'DAWN');
  assert.ok(level.player.isDevSuspended, 'the player is still during the ending');
  const start = ending.camera.position.clone();
  assert.ok(level.village.hall.contains(start.x, start.z), 'it starts in the hall');

  stepWorld(world, 6, { level });
  assert.ok(level.environment.sky.uniforms.uStars.value < 1, 'dawn is coming up');
  stepWorld(world, 6.5, { level });
  assert.equal(level.state, 'credits');
  assert.ok(ending.isFinished && !ending.wasSkipped, 'the ending played through');
  assert.ok(ending.camera.position.y > start.y + 40, 'high over the village');
  assert.ok(world.getActiveCamera() === ending.camera, 'the view stays on the dawn');
  assert.equal(level.environment.sky.uniforms.uStars.value, 0);
  assert.equal(ui.callsTo('showCredits').length, 1);
  const sections = ui.callsTo('showCredits').at(-1).args[0];
  assert.equal(sections[0].lines[0], 'SCOPECREEP');
  assert.equal(ui.callsTo('showMissionResult').length, 0, 'credits first');

  // [Space] skips the credits to the result
  world.input.press('skipCutscene');
  stepWorld(world, 0.2, { level });
  assert.equal(level.state, 'won');
  assert.ok(ui.callsTo('hideCredits').length >= 1);
  const result = ui.callsTo('showMissionResult').at(-1).args[0];
  assert.equal(result.outcome, 'victory');
  assert.equal(result.title, 'THE ISLAND IS OURS AGAIN');
  assert.equal(teardown(world, level), 0, 'no physics bodies left');
  assert.ok(!world.activeCamera, 'the view is given back on the way out');
});

test('skipping the ending with [Space] does not skip the credits with the same press', async () => {
  const { world, level } = await loadLevel(9);
  beatTheWarden(world, level);
  for (const cage of level.cages) cage.free();
  stepWorld(world, 1, { level });
  world.input.press('skipCutscene');
  stepWorld(world, 0.2, { level });
  assert.ok(level.cinematic.wasSkipped);
  assert.equal(level.state, 'credits', 'the credits still roll');
  assert.equal(level.environment.sky.uniforms.uStars.value, 0, 'straight to full dawn');
  assert.equal(teardown(world, level), 0);
});
