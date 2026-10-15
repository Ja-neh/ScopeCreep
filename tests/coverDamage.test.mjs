import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld } from './support/testWorld.mjs';
import { BeachEnvironment } from '../src/levels/level02/BeachEnvironment.js';
import { BeachCover } from '../src/levels/level02/BeachCover.js';
import { DestructibleCover } from '../src/levels/level02/DestructibleCover.js';
import { HitscanWeapon } from '../src/weapons/HitscanWeapon.js';
import { ProjectilePool } from '../src/entities/ProjectilePool.js';
import { TrainingDummy } from '../src/entities/TrainingDummy.js';
import { Player } from '../src/entities/Player.js';
import { AlienTrooper } from '../src/entities/enemies/AlienTrooper.js';
import { AlienSquad } from '../src/ai/AlienSquad.js';
import config from '../src/config.json';

let world;
let env;
let cover;
let destructible;

before(async () => {
  world = await createTestWorld({ seed: 7 });
  env = new BeachEnvironment(world);
  env.build();
  cover = new BeachCover(world, env, [{ x: 0, z: 120, radius: 4 }, { x: 0, z: 150, radius: 4 }, { x: 60, z: 120, radius: 4 }]);
  cover.build();
  destructible = new DestructibleCover(world, cover);
  destructible.build();
  // Scene queries only see the world once it has stepped at least once
  world.physics.step(1 / 60);
});

after(() => {
  destructible.dispose();
  cover.dispose();
  env.dispose();
});

const bushCfg = config.levels.level02.destructibleCover;
const grenadeCfg = config.projectiles.grenade;

/**
 * A live bush with no other bush within `spacing`, so a bullet segment through it can only
 * reach that one (the tests destroy bushes, so always pick from the live list).
 */
function isolatedBush({ spacing = 6, clearPathFromEast = false } = {}) {
  const bounds = env.scatterBounds;
  return destructible.bushes.find((bush) => {
    if (env.slopeAt(bush.x, bush.z) > 0.2) return false;
    if (bush.x + 12 > bounds.maxX - 2) return false; // A throw origin 12 m east stays on the island
    if (clearPathFromEast) {
      for (const offset of [12, 8.5, 5, 2]) {
        if (!cover.isClearOfSolids(bush.x + offset, bush.z, 1.5)) return false;
      }
    }
    return !destructible.bushes.some((other) =>
      other !== bush && Math.hypot(other.x - bush.x, other.z - bush.z) < spacing);
  });
}

/**
 * A prop of `kind` the machine gun can actually reach: probing east at body height must land
 * on that prop's own collider (nothing else in the way).
 */
function findShootable(kind) {
  for (const prop of destructible.props) {
    if (prop.kind !== kind) continue;
    const placement = prop.placement;
    const aimY = kind === 'tree' ? placement.y + 1.2 : placement.y;
    const probe = new THREE.Vector3(placement.x + 7, aimY, placement.z);
    const ray = new world.physics.RAPIER.Ray({ x: probe.x, y: probe.y, z: probe.z }, { x: -1, y: 0, z: 0 });
    const hit = world.physics.castRay(ray, 15, true);
    if (hit && hit.collider === placement.collider) {
      return { prop, collider: placement.collider, probe, aim: new THREE.Vector3(placement.x, aimY, placement.z) };
    }
  }
  return null;
}

/** Fires the real weapon at a found prop until it goes down (or the safety limit trips). */
function shootUntilDown(weapon, found) {
  let shots = 0;
  let waits = 0;
  while (!found.prop.health.isDead && shots < 40) {
    const result = weapon.fire({
      physicsWorld: world.physics,
      origin: found.probe,
      aimPoint: found.aim,
      spread: 0,
      source: null
    });
    if (!result) {
      // Cooling down or mid-reload: wait it out (an empty magazine needs a fresh one first)
      if (weapon.ammo === 0) weapon.startReload();
      weapon.update(0.2);
      assert.ok(++waits < 100, 'the weapon kept firing');
      continue;
    }
    assert.ok(result.collider === found.collider, 'the burst keeps landing on the same prop');
    shots++;
    weapon.update(0.2);
  }
  return shots;
}

test('every bush, tree and rock gets a health pool sized by its kind', () => {
  assert.ok(bushCfg.bush.health < bushCfg.tree.health && bushCfg.tree.health < bushCfg.rock.health);
  assert.ok(destructible.bushes.length > 0, 'the beach has bushes');
  assert.ok(destructible.props.length > destructible.bushes.length, 'and trees and rocks too');

  for (const bush of destructible.bushes) {
    assert.equal(bush.health.maxHealth, bushCfg.bush.health);
    assert.ok(bush.placement.collider === undefined, 'bushes have no collider: shots fly through');
  }
  const tree = destructible.props.find((prop) => prop.kind === 'tree');
  const rock = destructible.props.find((prop) => prop.kind === 'rock');
  assert.equal(tree.health.maxHealth, bushCfg.tree.health);
  assert.equal(rock.health.maxHealth, bushCfg.rock.health);
  // Trees and rocks stop bullets the normal way: their colliders answer with their prop
  assert.ok(tree.placement.collider.userData.entity === tree);
  assert.ok(rock.placement.collider.userData.entity === rock);
});

test('shots through a bush cut it down, and it stops hiding anyone', () => {
  const bush = isolatedBush();
  assert.ok(bush, 'an isolated bush to shoot through');
  const midY = (bush.y0 + bush.top) / 2;
  const origin = new THREE.Vector3(bush.x - 0.5, midY, bush.z);
  const point = new THREE.Vector3(bush.x + 0.5, midY, bush.z);
  const feet = new THREE.Vector3(bush.x, bush.y0 + 0.3, bush.z);
  assert.equal(cover.isInBush(feet), true, 'it hides someone before the shots');

  // Shots land on whatever is behind it; the weapon reports the flight line that crossed it
  assert.equal(destructible.bulletImpact(origin, point), true, 'the first burst connects');
  assert.equal(bush.health.isDead, false, 'but the bush is still standing');
  assert.equal(destructible.bulletImpact(origin, point), true);
  assert.equal(bush.health.isDead, true, 'two bursts cut it away');
  assert.equal(destructible.bushes.includes(bush), false, 'it is off the shoot-through list');
  assert.equal(cover.isInBush(feet), false, 'nowhere to hide once it is gone');

  // A burst that passes nowhere near any bush hurts nothing
  assert.equal(destructible.bulletImpact(new THREE.Vector3(0, 100, 0), new THREE.Vector3(30, 100, 5)), false);
});

test('machine gun fire cuts trees down; rocks hold far longer', () => {
  const weapon = new HitscanWeapon(config.weapons.machineGun);

  const tree = findShootable('tree');
  assert.ok(tree, 'a tree within the machine gun’s reach');
  const treeShots = shootUntilDown(weapon, tree);
  assert.equal(tree.prop.health.isDead, true, 'the tree comes down');
  assert.ok(treeShots >= 6 && treeShots <= 9, `a tree took ${treeShots} shots`);
  assert.ok(tree.prop.placement.collider === null, 'its collider left the world');
  assert.equal(destructible.props.includes(tree.prop), false);

  const rock = findShootable('rock');
  assert.ok(rock, 'a rock within reach');
  const rockShots = shootUntilDown(weapon, rock);
  assert.equal(rock.prop.health.isDead, true, 'the rock crumbles, eventually');
  assert.ok(rockShots >= 20 && rockShots <= 28, `a rock took ${rockShots} shots`);
  assert.equal(destructible.props.includes(rock.prop), false);
  const stillCover = cover.rocks.some((r) => Math.abs(r.x - rock.prop.x) < 0.05 && Math.abs(r.z - rock.prop.z) < 0.05);
  assert.equal(stillCover, false, 'AI no longer treats it as cover');
});

test('an explosion shreds cover in its radius and spares what is outside', () => {
  const bush = isolatedBush();
  assert.ok(bush, 'an isolated bush near the blast');
  const point = new THREE.Vector3(bush.x, bush.y0 + 0.5, bush.z);

  const centreDistance = (prop) => Math.hypot(prop.x - point.x, prop.z - point.z);
  const inside = destructible.props.filter((prop) => centreDistance(prop) - prop.radius < grenadeCfg.blastRadius);
  const outside = destructible.props.filter((prop) => centreDistance(prop) - prop.radius >= grenadeCfg.blastRadius);
  const outsideHealth = outside.map((prop) => prop.health.currentHealth);

  destructible.explosionDamage(point, grenadeCfg.blastRadius, grenadeCfg.damage);

  assert.equal(bush.health.isDead, true, 'the bush at the centre is gone');
  assert.equal(destructible.bushes.includes(bush), false);
  assert.ok(inside.length > 0);
  for (const prop of inside) {
    assert.ok(prop.health.isDead || prop.health.currentHealth < prop.health.maxHealth, `${prop.kind} in the blast was hit`);
  }
  outside.forEach((prop, i) => {
    assert.equal(prop.health.currentHealth, outsideHealth[i], `the ${prop.kind} outside is untouched`);
  });
});

test('a thrown grenade arcs, detonates and tears cover apart where it lands', () => {
  const pool = new ProjectilePool(world);
  world.addEntity(pool);
  const beforeExplosions = world.audio.callsTo('play').filter((call) => call.args[0] === 'explosion').length;

  const blasts = [];
  pool.onExplosion = (point, radius, damage) => {
    blasts.push({ point: point.clone(), radius, damage });
    destructible.explosionDamage(point, radius, damage);
  };

  const bush = isolatedBush({ clearPathFromEast: true });
  assert.ok(bush, 'an isolated bush with a clear throw line');
  const origin = new THREE.Vector3(bush.x + 12, bush.y0 + 3, bush.z);
  const target = new THREE.Vector3(bush.x, bush.y0 + 0.5, bush.z);

  const dummy = new TrainingDummy(world, {
    position: new THREE.Vector3(bush.x + 1, env.heightAt(bush.x + 1, bush.z), bush.z)
  });
  world.addEntity(dummy);

  const grenade = pool.fireGrenade({ origin, target });
  assert.ok(grenade && grenade.type === 'GRENADE', 'a grenade left the hand');
  assert.ok(pool.activeProjectiles.includes(grenade), 'and it is in flight');

  stepWorld(world, 1.5);

  assert.equal(pool.activeProjectiles.some((p) => p.type === 'GRENADE'), false, 'the grenade came down');
  assert.equal(blasts.length, 1, 'exactly one detonation');
  assert.equal(blasts[0].radius, grenadeCfg.blastRadius);
  const miss = blasts[0].point.distanceTo(target);
  assert.ok(miss < 4.5, `landed ${miss.toFixed(2)} m from the aim point`);
  assert.equal(world.audio.callsTo('play').filter((call) => call.args[0] === 'explosion').length, beforeExplosions + 1, 'the blast is heard');
  assert.equal(bush.health.isDead, true, 'the cover at the impact is gone');
  assert.ok(dummy.health.currentHealth < dummy.health.maxHealth, 'and the figure beside it was hurt');

  world.clearEntities();
  world.projectilePool = null;
});

test('a trooper flushes a watched player with a grenade (and never hurts its own side)', () => {
  const pool = new ProjectilePool(world);
  world.addEntity(pool);
  world.projectilePool = pool;

  const blasts = [];
  pool.onExplosion = (point, radius, damage) => {
    blasts.push({ point: point.clone(), radius, damage });
    destructible.explosionDamage(point, radius, damage);
  };

  const player = new Player(world, { snapToGround: true, canCrouch: true, maxHealth: 100 });
  world.addEntity(player);
  player.teleport(0, env.heightAt(0, 150) + 0.05, 150);

  const squad = new AlienSquad(world, { targets: [player], cover, alertRadius: 25, corpseSeconds: 4 });
  // Throwing range is wide open, no scatter: the throw must be about the flush, not the scatter
  const flushCfg = { chance: 1, cooldownSeconds: 0.5, minRange: 0, maxRange: 100, aimError: 0 };
  // Both fighters stand inside the clearing at (0, 150): the short line between them is free of props
  const thrower = squad.add(new AlienTrooper(world, {
    position: new THREE.Vector3(0, env.heightAt(0, 148) + 0.1, 148),
    squad,
    cfg: { ...config.enemies.trooper, burstShots: 0, grenade: flushCfg }
  }));
  thrower._grenadeTimer = 0;

  // A squadmate stands inside the blast radius: under the rules of engagement it must
  // survive the throw, or the aliens would be flushing themselves
  const ally = squad.add(new AlienTrooper(world, {
    position: new THREE.Vector3(3, env.heightAt(3, 148) + 0.1, 148),
    squad,
    cfg: { ...config.enemies.trooper, burstShots: 0, grenade: { ...flushCfg, chance: 0 } }
  }));

  const level = { isInitialized: true, gameplayUpdate: () => { squad.update(); cover.updateConcealment(player); } };
  const run = (seconds, onFrame) => stepWorld(world, seconds, { level, onFrame });

  // Face the player, so the sight check below is about vision, not about the patrol's first turn
  thrower.yaw = Math.atan2(-(player.position.x - thrower.position.x), -(player.position.z - thrower.position.z));
  // The trooper's own sight check, so the engagement starts now rather than on a patrol turn
  thrower.perception.update(thrower.perception.checkInterval, squad.targets, world.physics);
  assert.ok(thrower.perception.target === player, 'the player in the open is seen');
  run(2, () => thrower.brain.is('engage'));
  assert.ok(thrower.brain.is('engage'), 'the engagement started');

  run(4, () => pool.activeProjectiles.some((p) => p.type === 'GRENADE'));
  assert.ok(pool.activeProjectiles.some((p) => p.type === 'GRENADE'), 'the flush grenade is thrown');
  thrower._grenadeTimer = 999; // One is enough for this test

  // Hold the ally inside the blast and wait for the detonation
  ally.stop();
  ally.teleport(3, env.heightAt(3, 148) + 0.1, 148);
  run(3, () => blasts.length > 0);
  assert.equal(blasts.length, 1, 'the grenade detonated');

  const blastToAlly = Math.hypot(blasts[0].point.x - ally.position.x, blasts[0].point.z - ally.position.z);
  assert.ok(blastToAlly < grenadeCfg.blastRadius, `the ally stood ${blastToAlly.toFixed(1)} m from the blast`);
  assert.equal(ally.health.currentHealth, ally.health.maxHealth, 'the alien beside the blast is untouched');

  const hurt = 100 - player.health.currentHealth;
  assert.ok(hurt >= grenadeCfg.damage * 0.3, `the flush dug the player out (${hurt.toFixed(0)} damage)`);

  squad.dispose();
  world.clearEntities();
  world.projectilePool = null;
});
