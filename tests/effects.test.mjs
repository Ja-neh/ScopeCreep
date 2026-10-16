// Battle feedback: the pooled smoke and blood in WeaponEffects, and the hooks that spawn
// them - a fighter bleeds when damaged, a gun firing leaves gas and its barrels keep smoking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WeaponEffects } from '../src/weapons/WeaponEffects.js';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { ProjectilePool } from '../src/entities/ProjectilePool.js';
import { GroundCombatant } from '../src/entities/GroundCombatant.js';
import { ArtilleryTurret } from '../src/entities/ship-components/ArtilleryTurret.js';

function visible(list) {
  return list.filter((item) => item.mesh.visible).length;
}

test('a smoke puff rises, swells and fades out', () => {
  const parent = new THREE.Group();
  const fx = new WeaponEffects(parent);
  const at = new THREE.Vector3(2, 3, 4);
  fx.smokePuff(at, 2);
  assert.equal(visible(fx.smoke), 1);
  const puff = fx.smoke.find((p) => p.mesh.visible);
  assert.deepEqual(puff.mesh.position.toArray(), at.toArray());

  // Run its whole life: it swells past its spawn size, then disappears
  let peak = 0;
  for (let i = 0; i < 120; i++) {
    fx.update(1 / 60);
    if (puff.mesh.visible) peak = Math.max(peak, puff.mesh.scale.x);
  }
  assert.ok(peak > puff.baseScale, 'the puff swelled while it faded');
  assert.equal(puff.mesh.visible, false, 'the puff faded out');
  fx.dispose();
});

test('a ship hit throws up a whole cloud of puffs', () => {
  const fx = new WeaponEffects(new THREE.Group());
  fx.smokeCloud(new THREE.Vector3(0, 5, 0), 2.4);
  assert.ok(visible(fx.smoke) >= 5, 'several puffs burst out at once');
  fx.update(5); // Long past any puff's life
  assert.equal(visible(fx.smoke), 0);
  fx.dispose();
});

test('a gun firing leaves gas hanging at the muzzle', () => {
  const fx = new WeaponEffects(new THREE.Group());
  fx.muzzleSmoke(new THREE.Vector3(0, 6, -20), new THREE.Vector3(0, 0.2, -1), 1.7);
  assert.equal(visible(fx.smoke), 2);
  fx.dispose();
});

test('blood sprays along the blow, scatters, and fades', () => {
  const fx = new WeaponEffects(new THREE.Group());
  fx.bloodSpray(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0, -1));
  assert.equal(visible(fx.blood), 7);
  const paths = new Set(fx.blood.filter((d) => d.mesh.visible)
    .map((d) => `${d.velocity.x.toFixed(2)},${d.velocity.y.toFixed(2)},${d.velocity.z.toFixed(2)}`));
  assert.ok(paths.size > 1, 'the droplets scatter instead of flying as one blob');
  fx.update(2);
  assert.equal(visible(fx.blood), 0, 'the spray fades out');
  fx.dispose();
});

test('a wound with no direction still bleeds upward', () => {
  const fx = new WeaponEffects(new THREE.Group());
  fx.bloodSpray(new THREE.Vector3(0, 1, 0));
  for (const drop of fx.blood.filter((d) => d.mesh.visible)) {
    assert.ok(drop.velocity.y >= 0, 'droplets leave upward when the blow has no direction');
  }
  fx.dispose();
});

test('smoke recycles through its fixed pool without growing the scene', () => {
  const parent = new THREE.Group();
  const fx = new WeaponEffects(parent);
  const pooled = fx.smoke.length;
  const childrenBefore = fx.group.children.length;
  const at = new THREE.Vector3();
  for (let i = 0; i < pooled * 3; i++) {
    fx.smokePuff(at, 1, { life: 0.1 });
    fx.update(1 / 60);
  }
  assert.equal(fx.group.children.length, childrenBefore, 'nothing new was added to the scene');
  assert.ok(visible(fx.smoke) <= pooled, 'at most one pool of puffs stays alive');
  fx.dispose();
});

test('disposing the effects clears them out of the scene', () => {
  const parent = new THREE.Group();
  const fx = new WeaponEffects(parent);
  fx.smokePuff(new THREE.Vector3());
  fx.dispose();
  assert.equal(fx.group.parent, null);
  assert.equal(parent.children.length, 0, 'the whole rig leaves the scene graph');
});

test('a fighter taking damage bleeds through the world\'s effects', async () => {
  const world = await createTestWorld();
  const pool = new ProjectilePool(world);
  world.addEntity(pool);
  world.projectilePool = pool;

  const model = {
    mesh: new THREE.Group(),
    animate() { },
    setFallen() { },
    setHitFlash() { },
    dispose() { }
  };
  const fighter = new GroundCombatant(world, {
    name: 'Trooper',
    position: new THREE.Vector3(0, 0, 0),
    faction: 'aliens',
    maxHealth: 40,
    model
  });
  world.addEntity(fighter);

  fighter.health.takeDamage({
    amount: 5,
    point: new THREE.Vector3(0, 1.2, 0),
    direction: new THREE.Vector3(0, 0, -1)
  });
  assert.ok(fighter.health.currentHealth < fighter.health.maxHealth, 'the damage landed');
  assert.ok(visible(pool.effects.blood) >= 5, 'the wound bleeds');

  stepWorld(world, 0.8);
  assert.equal(visible(pool.effects.blood), 0, 'the blood fades within a second');

  world.removeEntity(fighter);
  world.removeEntity(pool);
  world.projectilePool = null;
  assert.equal(bodyCount(world), 0);
});

test('a battleship gun firing leaves smoke and the barrels keep smoking', async () => {
  const world = await createTestWorld();
  const pool = new ProjectilePool(world);
  world.addEntity(pool);
  world.projectilePool = pool;

  const turret = new ArtilleryTurret({
    name: 'TestGun',
    gameWorld: world,
    position: new THREE.Vector3(0, 5, 0)
  });

  turret._fireWeapon();
  assert.ok(visible(pool.effects.smoke) >= 2, 'gun gas at the muzzle');
  assert.ok(turret._barrelSmokeTimer > 0, 'the barrels stay hot after the shot');

  const afterFiring = visible(pool.effects.smoke);
  for (let i = 0; i < 45; i++) turret._updateBarrelSmoke(1 / 60); // 0.75s of cooling
  assert.ok(visible(pool.effects.smoke) > afterFiring, 'wisps curl up while the barrels cool');

  turret.dispose();
  world.removeEntity(pool);
  world.projectilePool = null;
  assert.equal(bodyCount(world), 0);
});
