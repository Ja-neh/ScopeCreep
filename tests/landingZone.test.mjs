// LandingZone: walking off the anchored ship (ramp, platform, gangway) and the beach terrain.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { BeachEnvironment } from '../src/levels/level02/BeachEnvironment.js';
import { LandingZone } from '../src/levels/level02/LandingZone.js';
import { Player } from '../src/entities/Player.js';

let world;
let env;
let landingZone;

before(async () => {
  world = await createTestWorld();
  env = new BeachEnvironment(world);
  env.build();
  landingZone = new LandingZone(world, env);
  await landingZone.build();
});

after(() => {
  world.clearEntities();
  landingZone.dispose();
  env.dispose();
});

/**
 * Walks forward for `seconds` and reports progress, grounding and stalls.
 */
function walk(player, seconds) {
  world.input.hold('forward');
  let grounded = 0;
  let stalls = 0;
  let maxY = -Infinity;
  const last = player.position.clone();
  const frames = stepWorld(world, seconds, {
    onFrame: (frame) => {
      if (frame < 5) return;
      if (player.isGrounded) grounded++;
      if (Math.hypot(player.position.x - last.x, player.position.z - last.z) < 0.03) stalls++;
      maxY = Math.max(maxY, player.position.y);
      last.copy(player.position);
    }
  });
  world.input.release('forward');
  return { groundedRatio: grounded / (frames - 5), stalls, maxY };
}

test('player walks from the deck, over the railing platform and down the gangway to the beach', () => {
  const spawn = landingZone.spawnPoints.deck;
  const player = new Player(world, { snapToGround: true });
  player.setPosition(spawn.x, spawn.y, spawn.z);
  player.yaw = 0;
  world.addEntity(player);

  const result = walk(player, 5);
  assert.ok(result.maxY > 6.0, `climbed onto the platform (max y ${result.maxY.toFixed(2)})`);
  assert.ok(player.position.z < 190, `reached the beach (z ${player.position.z.toFixed(1)})`);
  assert.ok(env.heightAt(player.position.x, player.position.z) > 0.5, 'ended on dry sand');
  assert.ok(result.stalls <= 5, `stalled ${result.stalls} frames`);
  assert.ok(result.groundedRatio > 0.95, `grounded ${(result.groundedRatio * 100).toFixed(0)}% of frames`);
  world.removeEntity(player);
});

test('the gangway handrails stop the player walking off the side', () => {
  // Halfway down the gangway (it runs along world Z at x = -10)
  const gangwayX = -10;
  const ray = new world.physics.RAPIER.Ray({ x: gangwayX, y: 20, z: 205 }, { x: 0, y: -1, z: 0 });
  const surfaceY = 20 - world.physics.castRay(ray, 40, true).timeOfImpact;
  assert.ok(surfaceY > 1.5, `gangway surface at ${surfaceY.toFixed(2)} m`);

  const player = new Player(world, { snapToGround: true });
  player.setPosition(gangwayX, surfaceY + 0.05, 205);
  player.yaw = 0;
  world.addEntity(player);

  let widest = 0;
  let lowest = Infinity;
  const track = () => {
    widest = Math.max(widest, Math.abs(player.position.x - gangwayX));
    lowest = Math.min(lowest, player.position.y);
  };
  for (const side of ['steerRight', 'steerLeft']) {
    world.input.hold(side);
    world.input.hold('sprint');
    stepWorld(world, 1.5, { onFrame: track });
    world.input.release(side);
    world.input.release('sprint');
  }
  assert.ok(widest < 1.2, `strayed ${widest.toFixed(2)} m from the centreline (rails at 1.2 m)`);
  assert.ok(lowest > surfaceY - 3, 'never fell off');
  world.removeEntity(player);
});

test('player stays on the ground walking down a hill (no hopping)', () => {
  const player = new Player(world, { snapToGround: true });
  player.setPosition(40, env.heightAt(40, 115) + 0.1, 115);
  player.yaw = Math.PI; // Facing +Z, downhill towards the beach
  world.addEntity(player);
  const startY = player.position.y;

  const result = walk(player, 4);
  assert.ok(player.position.y < startY - 2, 'went downhill');
  assert.ok(result.groundedRatio > 0.95, `grounded ${(result.groundedRatio * 100).toFixed(0)}% of frames`);
  world.removeEntity(player);
});

test('two helicopters are parked on the sand with spinning rotors', () => {
  assert.equal(landingZone.helicopters.length, 2);
  for (const heli of landingZone.helicopters) {
    const ground = env.heightAt(heli.mesh.position.x, heli.mesh.position.z);
    assert.ok(heli.mesh.position.y >= ground - 0.05 && heli.mesh.position.y < ground + 0.6, 'skids rest on the sand');
    assert.ok(heli.rotorSpeed > 0);
  }
});

test('helicopter fuselage blocks a walking player', () => {
  const heli = landingZone.helicopters[0];
  const centre = heli.mesh.position;
  const player = new Player(world, { snapToGround: true });
  player.setPosition(centre.x, env.heightAt(centre.x, centre.z - 8) + 0.1, centre.z - 8);
  player.yaw = Math.PI; // Walk +Z into the helicopter
  world.addEntity(player);
  walk(player, 2);
  const distance = Math.hypot(player.position.x - centre.x, player.position.z - centre.z);
  assert.ok(distance > 1.2, `stopped outside the fuselage (${distance.toFixed(2)} m from its centre)`);
  world.removeEntity(player);
});

test('clearings cover the gangway foot and both helicopters', () => {
  const foot = landingZone.spawnPoints.gangwayFoot;
  const inClearing = (x, z) => landingZone.clearings.some((c) => Math.hypot(x - c.x, z - c.z) < c.radius);
  assert.ok(inClearing(foot.x, foot.z));
  for (const heli of landingZone.helicopters) assert.ok(inClearing(heli.mesh.position.x, heli.mesh.position.z));
});

test('dispose removes the ship, boarding and helicopter bodies', async () => {
  const w = await createTestWorld();
  const e = new BeachEnvironment(w);
  e.build();
  const lz = new LandingZone(w, e);
  await lz.build();
  assert.ok(bodyCount(w) > 1);
  lz.dispose();
  e.dispose();
  assert.equal(bodyCount(w), 0);
  assert.equal(w.environmentGroup.children.length, 0);
  assert.ok(new THREE.Vector3().copy(lz.spawnPoints.deck).y > 4.9, 'deck spawn is on the deck');
});
