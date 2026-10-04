// Level 3's village at night: the look, the size and layout on the plateau, old houses of every
// kind, the landed alien ships, walking from the path into the hall, solid walls and walk-in
// interiors, lights and draw-call budgets, and clean teardown.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { BeachEnvironment } from '../src/levels/level02/BeachEnvironment.js';
import { Village } from '../src/levels/level03/Village.js';
import { Player } from '../src/entities/Player.js';

let world;
let env;
let village;

before(async () => {
  world = await createTestWorld();
  env = new BeachEnvironment(world, { look: 'night', layout: 'village', shadowCentre: new THREE.Vector3(0, 12, -400), shadowHalfExtent: 260 });
  env.build();
  village = new Village(world, env);
  village.build();
});

after(() => {
  world.clearEntities();
  village.dispose();
  env.dispose();
});

function walkPlayer(player, waypoints, seconds) {
  let index = 0;
  world.input.hold('forward');
  stepWorld(world, seconds, {
    onFrame: () => {
      const target = waypoints[index];
      const dx = target.x - player.position.x;
      const dz = target.z - player.position.z;
      if (Math.hypot(dx, dz) < 1.2) {
        index++;
        if (index >= waypoints.length) return true;
      }
      const next = waypoints[Math.min(index, waypoints.length - 1)];
      player.yaw = Math.atan2(-(next.x - player.position.x), -(next.z - player.position.z));
      return false;
    }
  });
  world.input.release('forward');
  return index >= waypoints.length;
}

function newPlayer(x, z) {
  const player = new Player(world, { snapToGround: true });
  world.addEntity(player);
  player.teleport(x, env.heightAt(x, z) + 0.2, z);
  stepWorld(world, 0.2);
  return player;
}

/** (x, z) in a house's own frame: x across its front, z out of its front door. */
function toLocal(house, x, z) {
  const dx = x - house.x;
  const dz = z - house.z;
  const cos = Math.cos(house.yaw);
  const sin = Math.sin(house.yaw);
  return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
}

test('night: a dark starry sky with the moon up high, and moonlight to match', () => {
  const sky = env.sky.uniforms;
  assert.equal(sky.uStars.value, 1);
  const moonUp = Math.asin(env.sunDirection.y) * 180 / Math.PI;
  assert.ok(moonUp > 25, `moon ${moonUp.toFixed(0)} degrees up`);
  const moonlight = env.lights.find((light) => light.isDirectionalLight);
  assert.ok(moonlight.color.b > moonlight.color.r, 'cool moonlight');
  assert.ok(moonlight.intensity < 1.5);
  assert.ok(world.scene.fog.color.getHSL({}).l < 0.25, 'dark haze');
  assert.equal(sky.uHorizonColor.value.getHex(), world.scene.fog.color.getHex());
});

test('a big village: over six times the old plateau, hundreds of houses spread right across it', () => {
  const plateau = env.village;
  const oldPlateau = new BeachEnvironment(world).village; // The beach layout keeps the old one
  const ratio = (plateau.halfWidth * plateau.halfLength) / (oldPlateau.halfWidth * oldPlateau.halfLength);
  assert.ok(ratio >= 6, `plateau only ${ratio.toFixed(1)}x the old one`);

  assert.ok(village.houses.length >= 200, `${village.houses.length} houses`);
  const xs = village.houses.map((h) => h.x);
  const zs = village.houses.map((h) => h.z);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 280, 'houses spread east to west');
  assert.ok(Math.max(...zs) - Math.min(...zs) > 360, 'houses spread south to north');

  for (const house of village.houses) {
    const b = house.bounds;
    for (const [x, z] of [[b.minX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ], [b.maxX, b.minZ]]) {
      assert.ok(env.isInVillage(x, z, -3), `house at ${house.x.toFixed(0)}, ${house.z.toFixed(0)} is on the plateau`);
    }
    assert.ok(Math.abs(env.heightAt(house.x, house.z) - plateau.height) < 0.2, 'on flat ground');
  }
  const b = village.hall.bounds;
  for (const [x, z] of [[b.minX, b.minZ], [b.maxX, b.maxZ]]) assert.ok(env.isInVillage(x, z), 'hall on the plateau');
  assert.ok(village.hall.doorway.z > b.minZ && village.hall.entrance.z > village.hall.doorway.z, 'doorway faces the square (south)');
  assert.ok(village.square.z > b.maxZ, 'the square lies in front of the hall');
  assert.ok(village.gate.z > village.square.z + 300, 'a long way from the gate to the square');
});

test('old and creepy: closed, walk-in and ruined houses, some two storeys, and empty lots', () => {
  const count = (type) => village.houses.filter((h) => h.type === type).length;
  assert.ok(count('closed') >= 80, `${count('closed')} closed houses`);
  assert.ok(count('open') >= 40, `${count('open')} walk-in houses`);
  assert.ok(count('ruin') >= 20, `${count('ruin')} ruins`);
  assert.ok(village.houses.filter((h) => h.storeys > 1).length >= 15, 'two-storey houses');
  assert.ok(village.lots.length >= 10, `${village.lots.length} empty lots`);
  // Houses never overlap each other or a street
  for (let i = 0; i < village.houses.length; i++) {
    const a = village.houses[i].bounds;
    for (let j = i + 1; j < village.houses.length; j++) {
      const c = village.houses[j].bounds;
      const overlap = a.minX < c.maxX && a.maxX > c.minX && a.minZ < c.maxZ && a.maxZ > c.minZ;
      assert.ok(!overlap, `houses ${i} and ${j} overlap`);
    }
  }
  const onStreet = village.houses.filter((h) => village.streets.some((s) => {
    const half = s.width / 2;
    return h.bounds.minX < Math.max(s.from.x, s.to.x) + half && h.bounds.maxX > Math.min(s.from.x, s.to.x) - half &&
      h.bounds.minZ < Math.max(s.from.z, s.to.z) + half && h.bounds.maxZ > Math.min(s.from.z, s.to.z) - half;
  }));
  assert.equal(onStreet.length, 0, 'no house stands in a street');
});

test('alien ships sit among the houses, up on legs: you can walk right under one', () => {
  assert.ok(village.ships.length >= 4, `${village.ships.length} ships`);
  for (const ship of village.ships) {
    assert.ok(ship.belly >= 3, 'room to walk under');
    assert.ok(env.isInVillage(ship.x, ship.z), 'landed in the village');
    for (const house of village.houses) {
      const b = house.bounds;
      const x = Math.max(b.minX, Math.min(ship.x, b.maxX));
      const z = Math.max(b.minZ, Math.min(ship.z, b.maxZ));
      assert.ok(Math.hypot(x - ship.x, z - ship.z) > ship.radius + 2, 'no house under a ship');
    }
  }

  // Straight under the biggest one, between its legs, out the other side
  const ship = village.ships.reduce((a, b) => (b.radius > a.radius ? b : a));
  const across = { x: Math.cos(ship.yaw), z: -Math.sin(ship.yaw) }; // The ship's own x axis
  const reach = ship.radius + 3;
  const player = newPlayer(ship.x - across.x * reach, ship.z - across.z * reach);
  const reached = walkPlayer(player, [{ x: ship.x, z: ship.z }, { x: ship.x + across.x * reach, z: ship.z + across.z * reach }], 12);
  assert.ok(reached, `stuck under the ship at ${player.position.x.toFixed(1)}, ${player.position.z.toFixed(1)}`);
  world.removeEntity(player);
});

test('walk up from the jungle path through the gate and up the avenue to the square, and into the hall', () => {
  const start = village.spawnPoints.start;
  const player = newPlayer(start.x, start.z);
  const square = village.square;
  const reached = walkPlayer(player, [
    { x: village.gate.x, z: village.gate.z },
    { x: square.x, z: square.z + 8 },               // The fountain is in the middle
    { x: square.x + 6, z: square.z },
    { x: village.hall.entrance.x, z: village.hall.entrance.z },
    { x: village.hall.dais.x, z: village.hall.dais.z + 4 }
  ], 80);
  assert.ok(reached, `stuck at ${player.position.x.toFixed(1)}, ${player.position.z.toFixed(1)}`);
  assert.ok(village.hall.contains(player.position.x, player.position.z), 'inside the hall');
  world.removeEntity(player);
});

test('walls are solid: closed houses and the hall\'s side wall stop you, walk-in houses let you in', () => {
  const plain = (house) => house.street === 'avenue' && !house.porch && !house.fence;

  // Straight at a closed house's front door: stopped at its front wall
  const closed = village.houses.find((house) => house.type === 'closed' && plain(house));
  let player = newPlayer(closed.front.x, closed.front.z);
  walkPlayer(player, [{ x: closed.x, z: closed.z }], 5);
  let local = toLocal(closed, player.position.x, player.position.z);
  assert.ok(local.z > closed.d / 2 - 0.2, `walked into a closed house (${local.z.toFixed(1)} m from its middle)`);
  world.removeEntity(player);

  // In through a walk-in house's doorway: you end up inside
  const open = village.houses.find((house) => house.type === 'open' && plain(house));
  player = newPlayer(open.front.x, open.front.z);
  walkPlayer(player, [{ x: open.x, z: open.z }], 6);
  local = toLocal(open, player.position.x, player.position.z);
  assert.ok(Math.abs(local.x) < open.w / 2 && Math.abs(local.z) < open.d / 2, 'inside the walk-in house');
  world.removeEntity(player);

  // Straight at the hall's side wall from outside: stopped at the wall
  const b = village.hall.bounds;
  const midZ = (b.minZ + b.maxZ) / 2;
  player = newPlayer(b.maxX + 6, midZ);
  walkPlayer(player, [{ x: b.minX, z: midZ }], 4);
  assert.ok(player.position.x > b.maxX - 0.2, 'the side wall is solid');
  world.removeEntity(player);
});

test('cheap to draw: the whole village is two meshes, with only a handful of point lights', () => {
  const buildings = village.group.getObjectByName('VillageBuildings');
  const meshes = buildings.children.filter((child) => child.isMesh);
  assert.ok(meshes.length <= 2, `${meshes.length} meshes`);
  const vertices = meshes.reduce((sum, mesh) => sum + mesh.geometry.getAttribute('position').count, 0);
  assert.ok(vertices < 400000, `${vertices} vertices`);
  let pointLights = 0;
  village.group.traverse((child) => { if (child.isPointLight) pointLights++; });
  assert.ok(pointLights <= 5, `${pointLights} point lights (3 more are kept for the generators)`);
});

test('teardown removes every village collider, light and mesh', async () => {
  const w = await createTestWorld();
  const e = new BeachEnvironment(w, { look: 'night', layout: 'village' });
  e.build();
  const bodiesBefore = bodyCount(w);
  const v = new Village(w, e);
  v.build();
  assert.ok(bodyCount(w) > bodiesBefore + 500, 'walls, posts, trees and ships have colliders');
  v.dispose();
  assert.equal(bodyCount(w), bodiesBefore);
  assert.equal(v.group.parent, null);
  e.dispose();
  assert.equal(w.environmentGroup.children.length, 0);
});
