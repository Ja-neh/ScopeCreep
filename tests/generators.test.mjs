// Level 3's force field over the hall and the three generators that feed it: where they stand
// and who guards them, aliens that never stop coming (to each generator, and at the player from
// every direction in the village), the dome keeping people and bullets out, holding [E] to shut
// a generator down, wave 2 at the sealed hall, the revive points, and clean teardown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { Level03 } from '../src/levels/Level03.js';
import { HitscanWeapon } from '../src/weapons/HitscanWeapon.js';
import config from '../src/config.json';

const cfg = config.levels.level03.generator;
const levelCfg = config.levels.level03;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

async function loadLevel(seed = 4) {
  const world = await createTestWorld({ seed });
  const level = new Level03(world);
  await level.init();
  if (level.cinematic) level.cinematic.finish(); // Skip the opening (ending.test.mjs covers it)
  return { world, level };
}

function teardown(world, level) {
  level.dispose();
  world.clearEntities();
  return bodyCount(world);
}

/** The player alone (no aliens, none coming, no squad) standing at (x, z). */
function alone(world, level, x, z) {
  level._stopDefenses();
  level.clearAliens(); // All but the Warden
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
    assert.equal(guards.length, levelCfg.generatorDefense.guards, `${generator.name} has its guards`);
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
  assert.match(ui.callsTo('showToast').at(-1).args[0], /West generator is down.*2 to go/);
  assert.match(ui.callsTo('showObjective').at(-1).args[1], /1\/3/);
  assert.ok(level.dome.isUp, 'the others still hold the field up');
  assert.equal(teardown(world, level), 0);
});

test('aliens never stop coming to a generator while it runs and the player is near; shutting it down stops them', async () => {
  const { world, level } = await loadLevel();
  const defense = levelCfg.generatorDefense;
  const generator = level.generators[0];
  const spawner = level.generatorDefenses[0];
  level.streetAliens.stop(); // Only the generator's own defenders
  level.allies.removeAllMates();
  level.player.health.invulnerable = true;
  const p = generator.position;
  level.player.teleport(p.x + 2, p.y + 0.4, p.z);

  let killed = 0;
  stepWorld(world, 60, {
    level,
    onFrame: (frame) => {
      assert.ok(spawner.members.length <= defense.maxAlive, 'never more than maxAlive at once');
      if (frame % 300 === 299) { // Every 5 s, clear them out: more keep coming
        for (const alien of spawner.members) { alien.health.takeDamage({ amount: 9999 }); killed++; }
      }
    }
  });
  assert.ok(spawner.spawned > defense.maxAlive, `${spawner.spawned} arrivals: more than one batch`);
  assert.ok(killed > defense.maxAlive);
  for (const alien of level.squad.members) {
    if (spawner.members.includes(alien)) assert.ok(flat(alien.position, level.player.position) > 5 || alien.brain.is('engage'), 'coming in to fight');
  }

  // Down: no more
  generator.shutDown();
  const spawned = spawner.spawned;
  for (const alien of spawner.members) alien.health.takeDamage({ amount: 9999 });
  stepWorld(world, defense.reinforceSeconds * 3, { level });
  assert.equal(spawner.spawned, spawned, 'no more aliens once it is down');
  assert.equal(teardown(world, level), 0);
});

test('a generator far away calls no help; in the village aliens come at the player from every direction', async () => {
  const { world, level } = await loadLevel();
  for (const defense of level.generatorDefenses) defense.stop();
  level.allies.removeAllMates();
  level.player.health.invulnerable = true;

  // Still on the jungle path: nobody comes
  stepWorld(world, levelCfg.streetAliens.reinforceSeconds * 3, { level });
  assert.equal(level.streetAliens.spawned, 0, 'not in the village yet');

  // In the middle of the village: from all sides, at a distance, for as long as it takes
  level.player.teleport(0, 12.4, -360);
  const bearings = [];
  let seen = 0;
  stepWorld(world, 90, {
    level,
    onFrame: (frame) => {
      for (const alien of level.streetAliens.members) {
        if (alien._bearing === undefined) {
          alien._bearing = Math.atan2(alien.position.x - level.player.position.x, alien.position.z - level.player.position.z);
          bearings.push(alien._bearing);
          const distance = flat(alien.position, level.player.position);
          assert.ok(distance >= levelCfg.spawnMinPlayerDistance, `appeared ${distance.toFixed(0)} m away`);
          seen++;
        }
      }
      if (frame % 600 === 599) for (const alien of level.streetAliens.members) alien.health.takeDamage({ amount: 9999 });
    }
  });
  assert.ok(seen > levelCfg.streetAliens.maxAlive, `${seen} aliens came`);
  const quarters = new Set(bearings.map((b) => Math.floor(((b + Math.PI) / (Math.PI * 2)) * 4) % 4));
  assert.ok(quarters.size >= 3, `from ${quarters.size} directions`);
  for (const alien of level.streetAliens.members) assert.ok(alien.brain.is('investigate') || alien.brain.is('engage') || alien.brain.is('search'), 'hunting the player');
  assert.ok(level.squad.aliveCount <= levelCfg.maxAliveAliens, 'within the level\'s cap');
  assert.equal(teardown(world, level), 0);
});

test('wave 2: with all three generators down the dome falls, the hall door is sealed, and its guards keep coming from both sides of the hall until enough are killed', async () => {
  const { world, level } = await loadLevel();
  const { dome, doorSeal, village } = level;
  const hall = village.hall;
  const wave = levelCfg.hallWave;
  const already = new Set(level.squad.members.filter((alien) => !alien.isDead && !alien.isBoss)); // The generator guards
  for (const generator of level.generators) generator.shutDown();
  stepWorld(world, 0.2, { level });
  assert.equal(dome.state, 'collapsing');
  assert.equal(dome.collider, null);
  assert.equal(level.state, 'guards');
  assert.ok(doorSeal.isUp && doorSeal.collider, 'the hall door is sealed');
  assert.ok(level.hallGuards.length >= wave.troopers + wave.brutes, 'a starting guard at least the size of the wave');
  for (const guard of level.hallGuards) {
    assert.ok(!hall.contains(guard.position.x, guard.position.z), 'outside the hall');
    if (already.has(guard)) assert.ok(guard.brain.is('investigate'), 'the ones already about fall back to guard the hall');
    else assert.ok(flat(guard.position, hall.entrance) <= wave.postMaxDistance + 1, 'fresh ones at posts by its door');
  }
  assert.ok(level.generatorDefenses.every((d) => d.stopped) && level.streetAliens.stopped, 'the village spawners are done');
  assert.match(world.ui.callsTo('showObjective').at(-1).args[1], new RegExp(`0/${wave.killsToOpen}`));

  // The seal holds: walk straight at the door
  const outside = hall.doorway.clone().addScaledVector(hall.forward, 8);
  level.allies.removeAllMates();
  level.player.health.invulnerable = true;
  level.player.teleport(outside.x, outside.y + 0.4, outside.z);
  level.player.yaw = Math.atan2(hall.forward.x, hall.forward.z);
  world.input.hold('forward');
  stepWorld(world, 3, { level });
  world.input.release('forward');
  assert.ok(!hall.contains(level.player.position.x, level.player.position.z), 'the seal stops you at the door');
  assert.equal(level.state, 'guards');

  // Kill them as they come: more keep appearing beside the hall, on both sides, until enough are dead
  const across = new THREE.Vector3(hall.forward.z, 0, -hall.forward.x);
  const sides = new Set();
  const seen = new Set(level.hallGuards);
  let frames = 0;
  stepWorld(world, 120, {
    level,
    onFrame: () => {
      frames++;
      for (const alien of level.squad.members) {
        if (seen.has(alien) || alien.isBoss) continue;
        seen.add(alien);
        const offset = new THREE.Vector3().subVectors(alien.position, hall.centre);
        const sideways = offset.dot(across);
        assert.ok(Math.abs(sideways) > hall.width / 2 && Math.abs(sideways) < hall.width / 2 + wave.sideDistance + wave.spawnSpread + 1,
          'appears beside the hall');
        sides.add(Math.sign(sideways));
      }
      if (frames % 120 === 0) {
        for (const alien of level.squad.members) if (!alien.isBoss && !alien.isDead) alien.health.takeDamage({ amount: 9999 });
      }
      return level.state !== 'guards';
    }
  });
  assert.equal(sides.size, 2, 'from both sides');
  assert.ok(seen.size > level.hallGuards.length, 'more kept coming');
  assert.equal(level.state, 'hall', `the seal broke after ${level.hallWaveKills} kills`);
  assert.ok(level.hallWaveKills >= wave.killsToOpen);
  assert.equal(doorSeal.collider, null, 'the seal is down');
  assert.ok(level.hallSpawners.every((spawner) => spawner.stopped), 'and no more come');

  // In you go
  for (const alien of level.squad.members) if (!alien.isBoss && !alien.isDead) alien.health.takeDamage({ amount: 9999 });
  level.player.teleport(outside.x, outside.y + 0.4, outside.z);
  level.player.yaw = Math.atan2(hall.forward.x, hall.forward.z);
  world.input.hold('forward');
  stepWorld(world, 4, { level, onFrame: () => level.state === 'boss' });
  world.input.release('forward');
  assert.equal(level.state, 'boss');
  assert.equal(teardown(world, level), 0, 'no physics bodies left');
  assert.equal(world.environmentGroup.children.length, 0, 'the force fields are gone from the scene');
});

test('revive points: no more than five along the way; lost, the player comes back at the last one reached, with the squad', async () => {
  const { world, level } = await loadLevel();
  const points = level.revivePoints;
  assert.ok(points.length >= 3 && points.length <= 5, `${points.length} revive points`);
  for (const point of points) {
    assert.ok(level.village.isOpenGround(point.position.x, point.position.z, 0.3), `${point.name} stands in the open`);
    assert.equal(point.reached, false);
  }
  const gate = points[0];
  assert.ok(gate.position.z < level.village.gate.z && flat(gate.position, level.village.gate) < 20, 'the first one is just inside the gate');

  // Walk past the first one
  level._stopDefenses();
  level.clearAliens(); // All but the Warden
  level.player.teleport(gate.position.x + 3, gate.position.y + 0.4, gate.position.z);
  stepWorld(world, 0.2, { level });
  assert.ok(gate.reached && level.lastRevivePoint === gate);
  assert.match(world.ui.callsTo('showToast').at(-1).args[0], /Revive point reached/);

  // The one in the hall can't be reached from outside the door
  const hallPoint = points.at(-1);
  const hall = level.village.hall;
  const door = hall.doorway.clone().addScaledVector(hall.forward, 1.5);
  level.shutDownGenerators({ instant: true });
  level.player.teleport(door.x, door.y + 0.4, door.z);
  stepWorld(world, 0.2, { level });
  if (flat(door, hallPoint.position) <= levelCfg.revivePointRadius) assert.equal(hallPoint.reached, false, 'not from outside the hall');

  // Lost far away: back at the gate's revive point, squad and all, no mission failed
  level.player.teleport(-60, 12.4, -430);
  stepWorld(world, 0.2, { level });
  level.player.health.takeDamage({ amount: 9999 });
  level._playerLost = true;
  stepWorld(world, config.player.vitals.respawnSeconds + 0.5, { level });
  assert.equal(level.player.health.isDead, false, 'back on their feet');
  assert.ok(flat(level.player.position, gate.position) < 3, 'at the revive point');
  for (const mate of level.allies.mates) {
    if (!mate.isDead) assert.ok(flat(mate.position, level.player.position) < 6, `${mate.name} regrouped`);
  }
  assert.equal(world.ui.callsTo('showMissionResult').length, 0, 'no mission failed');
  assert.equal(teardown(world, level), 0);
});

test('back from a revive point the aliens have lost the player: the nearby ones wander off, and none come for a while', async () => {
  const { world, level } = await loadLevel();
  const respawn = levelCfg.respawn;
  const point = level.revivePoints[1];
  point.reach();
  level.allies.removeAllMates();
  // Aliens close to the revive point, all hunting the player
  const near = [];
  for (let i = 0; i < 4; i++) {
    const x = point.position.x + 20 + i * 3;
    const z = point.position.z + 8;
    if (!level._isWalkable(x, z)) continue;
    const alien = level.createAlien('trooper', x, z);
    alien.perception.share(level.player.position);
    alien.brain.change('investigate');
    near.push(alien);
  }
  assert.ok(near.length >= 2);
  level.player.health.takeDamage({ amount: 9999 });
  level._playerLost = true;
  const spawnedBefore = level.streetAliens.spawned + level.generatorDefenses.reduce((n, d) => n + d.spawned, 0);
  stepWorld(world, config.player.vitals.respawnSeconds + 0.3, { level });
  assert.ok(flat(level.player.position, point.position) < 3, 'back at the revive point');
  for (const alien of near) {
    assert.ok(alien.brain.is('patrol') && !alien.perception.target, 'lost the player and wandering');
    assert.ok(flat(alien.home, point.position) > flat(alien.position, point.position) + respawn.wanderDistance * 0.8, 'off away from the spot');
  }
  const before = near.map((alien) => flat(alien.position, point.position));
  stepWorld(world, respawn.respiteSeconds - 2, { level });
  near.forEach((alien, i) => {
    if (!alien.perception.target) assert.ok(flat(alien.position, point.position) > before[i], 'moving away');
  });
  const spawnedAfter = level.streetAliens.spawned + level.generatorDefenses.reduce((n, d) => n + d.spawned, 0);
  assert.equal(spawnedAfter, spawnedBefore, 'no new aliens during the respite');
  assert.equal(teardown(world, level), 0);
});

test('every revive point has a supply crate by it; shield pickups lie in the streets and the shield takes hits until it breaks', async () => {
  const { world, level } = await loadLevel();
  const crates = [level.supplyCrate, level.hallCrate, ...level.reviveCrates];
  for (const point of level.revivePoints) {
    assert.ok(crates.some((crate) => flat(crate.position, point.position) < 15), `a crate by ${point.name}`);
  }

  const shieldCfg = levelCfg.shield;
  assert.equal(level.shieldPickups.length, shieldCfg.pickups);
  for (const pickup of level.shieldPickups) assert.ok(level.village.isOpenGround(pickup.position.x, pickup.position.z), 'in the open');
  assert.equal(level.shield.health, 0, 'no shield to begin with');

  const pickup = level.shieldPickups[0];
  level.clearAliens();
  level.player.teleport(pickup.position.x, pickup.position.y + 0.4, pickup.position.z);
  stepWorld(world, 0.2, { level });
  assert.ok(pickup.taken && level.shield.health === shieldCfg.health, 'picked up: a full shield');
  assert.equal(world.ui.callsTo('updatePlayerShield').at(-1).args[0], shieldCfg.health, 'its bar shows');

  const player = level.player;
  player.health.takeDamage({ amount: 40 });
  assert.equal(player.health.currentHealth, player.health.maxHealth, 'the shield took it');
  assert.equal(level.shield.health, shieldCfg.health - 40);
  player.health.takeDamage({ amount: shieldCfg.health });
  assert.equal(level.shield.health, 0, 'broken');
  assert.equal(player.health.currentHealth, player.health.maxHealth - 40, 'what got through hurt');
  stepWorld(world, 0.1, { level });
  assert.equal(level.shield.mesh.visible, false, 'the bubble is gone');

  // Another pickup charges it again
  const second = level.shieldPickups[1];
  player.teleport(second.position.x, second.position.y + 0.4, second.position.z);
  stepWorld(world, 0.2, { level });
  assert.equal(level.shield.health, shieldCfg.health);
  assert.equal(teardown(world, level), 0);
  assert.equal(player.health.absorb, null, 'the shield lets go of the player on teardown');
});
