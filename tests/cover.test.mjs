// BeachCover and Vegetation: placement rules, rock cover, performance budget, hiding in bushes,
// and the cover queries the AI uses.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { BeachEnvironment } from '../src/levels/level02/BeachEnvironment.js';
import { LandingZone } from '../src/levels/level02/LandingZone.js';
import { BeachCover } from '../src/levels/level02/BeachCover.js';
import { Player } from '../src/entities/Player.js';

let world;
let env;
let landingZone;
let cover;
let all;

before(async () => {
  world = await createTestWorld();
  env = new BeachEnvironment(world);
  env.build();
  landingZone = new LandingZone(world, env);
  await landingZone.build();
  cover = new BeachCover(world, env, landingZone.clearings);
  cover.build();

  all = { palms: [], trees: [], rocks: [], bushes: [] };
  for (const set of cover.vegetation) {
    for (const kind of Object.keys(all)) all[kind].push(...set.placements[kind]);
  }
});

after(() => {
  world.clearEntities();
  cover.dispose();
  landingZone.dispose();
  env.dispose();
});

const solids = () => [...all.palms, ...all.trees, ...all.rocks];

test('nothing solid grows in the landing clearings, on the jungle path, in the village or in the sea', () => {
  for (const clearing of landingZone.clearings) {
    const inside = solids().filter((p) => Math.hypot(p.x - clearing.x, p.z - clearing.z) < clearing.radius);
    assert.equal(inside.length, 0, `clearing at (${clearing.x}, ${clearing.z})`);
  }
  assert.equal(solids().filter((p) => p.z > 60 && p.z < 160 && env.pathDistance(p.x, p.z) < 3).length, 0, 'jungle path');
  const v = env.village;
  assert.equal([...solids(), ...all.bushes].filter((p) => Math.hypot(p.x - v.x, p.z - v.z) < v.radius).length, 0, 'village');
  assert.equal(solids().filter((p) => env.heightAt(p.x, p.z) < 0.6).length, 0, 'sea');
});

test('plenty of rock cover on the battlefield, including head-high boulders', () => {
  const battlefieldRocks = all.rocks.filter((r) => r.z > 10);
  assert.ok(battlefieldRocks.length >= 150, `${battlefieldRocks.length} battlefield rocks`);
  const standing = cover.rocks.filter((r) => r.height >= 1.9);
  assert.ok(standing.length >= 40, `${standing.length} head-high boulders`);
  assert.ok(all.bushes.length >= 150, `${all.bushes.length} bushes`);
});

test('vegetation stays within the triangle budget for lab PCs', () => {
  let triangles = 0;
  let shadowTriangles = 0;
  for (const set of cover.vegetation) {
    for (const mesh of set.mesh.children) {
      const count = (mesh.geometry.getAttribute('position').count / 3) * mesh.count;
      triangles += count;
      if (mesh.castShadow) shadowTriangles += count;
    }
  }
  assert.ok(triangles <= 200000, `${triangles} triangles`);
  assert.ok(shadowTriangles <= 120000, `${shadowTriangles} shadow-casting triangles`);
});

test('every trunk and rock has a collider', () => {
  const colliders = cover.vegetation.reduce((sum, set) => sum + set.colliders.length, 0);
  assert.equal(colliders, solids().length);
});

test('placement is the same on every build (seeded)', async () => {
  const w = await createTestWorld({ seed: 99 });
  const e = new BeachEnvironment(w);
  e.build();
  const again = new BeachCover(w, e, landingZone.clearings);
  again.build();
  assert.equal(again.rocks.length, cover.rocks.length);
  assert.equal(again.bushes.length, cover.bushes.length);
  again.dispose();
  e.dispose();
  assert.equal(bodyCount(w), 0);
});

test('crouching inside a bush hides the player; standing or stepping out does not', () => {
  const bush = cover.bushes.find((b) => b.z > 60 && env.slopeAt(b.x, b.z) < 0.15);
  const player = new Player(world, { snapToGround: true, canCrouch: true });
  player.setPosition(bush.x, env.heightAt(bush.x, bush.z) + 0.05, bush.z);
  world.addEntity(player);
  stepWorld(world, 0.1);

  assert.equal(cover.updateConcealment(player), false, 'standing in the bush');
  world.input.hold('crouch');
  stepWorld(world, 0.1);
  assert.equal(cover.updateConcealment(player), true, 'crouched in the bush');

  player.teleport(bush.x + 6, env.heightAt(bush.x + 6, bush.z) + 0.05, bush.z);
  stepWorld(world, 0.1);
  assert.equal(cover.isInBush(player.position), cover.bushes.some((b) => Math.hypot(b.x - player.position.x, b.z - player.position.z) < 1.5 * b.scale));
  world.input.release('crouch');
  world.removeEntity(player);
});

test('tree trunks block a walking player', () => {
  const tree = all.trees.find((t) => t.z > 40 && env.slopeAt(t.x, t.z) < 0.2);
  const player = new Player(world, { snapToGround: true });
  player.setPosition(tree.x, env.heightAt(tree.x, tree.z + 6) + 0.1, tree.z + 6);
  player.yaw = 0;
  world.addEntity(player);
  let closest = Infinity;
  world.input.hold('forward');
  stepWorld(world, 1.5, { onFrame: () => { closest = Math.min(closest, Math.hypot(player.position.x - tree.x, player.position.z - tree.z)); } });
  world.input.release('forward');
  assert.ok(closest >= 0.75, `got within ${closest.toFixed(2)} m of the trunk centre`);
  world.removeEntity(player);
});

test('cover query returns a spot beside a tall rock, at fighting range from the threat', () => {
  // A searcher a few meters from a real head-high boulder, with the threat 20 m to the south
  const rock = cover.rocks.find((r) => r.height >= 1.9 && r.z > 60 && r.z < 150);
  const threat = new THREE.Vector3(rock.x, 0, rock.z + 20);
  const from = new THREE.Vector3(rock.x + 4, 0, rock.z - 4);
  const out = new THREE.Vector3();
  assert.equal(cover.findCover(from, threat, out, 12, 30), true);
  const range = Math.hypot(out.x - threat.x, out.z - threat.z);
  assert.ok(range >= 12 && range <= 30, `range ${range.toFixed(1)}`);
  assert.ok(env.heightAt(out.x, out.z) > 0.6, 'on dry ground');
  const nearestRock = Math.min(...cover.rocks.map((r) => Math.hypot(r.x - out.x, r.z - out.z) - r.radius));
  assert.ok(nearestRock < 1.5, 'right beside a rock');
});
