import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld } from './support/testWorld.mjs';
import { Player } from '../src/entities/Player.js';
import { WeaponController } from '../src/weapons/WeaponController.js';
import { BeachThrowables } from '../src/levels/level02/BeachThrowables.js';
import { BeachCombatEffects } from '../src/levels/level02/BeachCombatEffects.js';
import { HealthComponent } from '../src/entities/components/HealthComponent.js';
import config from '../src/config.json';

async function setup() {
  const world = await createTestWorld();
  const player = new Player(world, { maxHealth: 100 });
  const weapons = new WeaponController(world, player);
  const enemy = { position: new THREE.Vector3(0, 0, -3), health: new HealthComponent(200) };
  const level = { state: 'waves', squad: { members: [enemy], reportNoise() {} } };
  const grenades = new BeachThrowables(world, player, weapons, level);
  weapons.throwables = grenades;
  return { world, player, weapons, grenades, enemy, close() { weapons.dispose(); player.dispose(); world.physics.world.free(); } };
}
function tick(s, dt = 1 / 60) {
  s.weapons.gameplayUpdate(dt);
  s.weapons.lateUpdate(dt);
  s.world.input.endFrame();
}

test('selection is idle, click winds up, release spawns exactly one grenade and suppresses rifle', async () => {
  const s = await setup();
  try {
    const ammo = s.weapons.rifle.ammo;
    s.world.input.press('weaponThrowable'); tick(s);
    for (let i = 0; i < 90; i++) tick(s);
    assert.equal(s.grenades.throwTime, -1);
    assert.equal(s.grenades.ammo, config.levels.level02.grenade.count);
    assert.equal(s.grenades.projectiles.filter(p => p.life > 0).length, 0);
    s.world.input.press('firePrimary'); s.world.input.hold('firePrimary'); tick(s);
    for (let i = 0; i < 20; i++) tick(s);
    assert.equal(s.grenades.ammo, config.levels.level02.grenade.count);
    const windup = s.grenades.rig.quaternion.clone();
    for (let i = 0; i < 10; i++) tick(s);
    assert.equal(s.grenades.ammo, config.levels.level02.grenade.count - 1);
    assert.equal(s.grenades.projectiles.filter(p => p.life > 0).length, 1);
    assert.equal(s.weapons.rifle.ammo, ammo);
    assert.ok(windup.angleTo(s.grenades.rig.quaternion) > 0.2);
    assert.equal(s.grenades.held.visible, false);
    s.world.input.release('firePrimary');
    for (let i = 0; i < 40; i++) tick(s);
    assert.equal(s.grenades.blocksWeapons, false);
    assert.equal(s.weapons.heldRifle.mesh.visible, true);
    s.world.input.press('weaponThrowable'); tick(s);
    assert.equal(s.grenades.held.visible, true, 'new grenade appears on subsequent selection');
  } finally { s.close(); }
});

test('switching cancels selection and death before release costs no grenade', async () => {
  const s = await setup();
  try {
    s.world.input.press('weaponThrowable'); tick(s);
    s.world.input.press('weaponMelee'); tick(s);
    assert.equal(s.grenades.selected, false);
    for (let i = 0; i < 60; i++) tick(s);
    s.world.input.press('weaponThrowable'); tick(s);
    s.world.input.press('firePrimary'); tick(s);
    s.player.health.takeDamage(100); tick(s);
    assert.equal(s.grenades.throwTime, -1);
    assert.equal(s.grenades.ammo, config.levels.level02.grenade.count);
    assert.equal(s.grenades.projectiles.some(p => p.life > 0), false);
  } finally { s.close(); }
});

test('grenades bounce off solid ground; blast falls off and fixed cover blocks damage', async () => {
  const s = await setup();
  try {
    s.world.physics.createGround(100, -0.5); s.world.physics.step();
    const p = s.grenades.projectiles[0];
    p.mesh.position.set(0, 0.5, -3); p.velocity.set(0, -10, 0); p.life = 2;
    s.grenades._projectiles(0.08);
    assert.ok(p.mesh.position.y >= 0, 'projectile did not tunnel through ground');
    assert.ok(p.velocity.y > 0, 'projectile bounced');
    s.grenades._explode(new THREE.Vector3(0, 0.3, -1));
    assert.ok(s.enemy.health.currentHealth < 200);
    s.enemy.health.reset();
    s.world.physics.createStaticBox({ x: 2, y: 3, z: 0.2 }, { x: 0, y: 2, z: -2 });
    s.world.physics.step();
    s.grenades._explode(new THREE.Vector3(0, 0.3, -1));
    assert.equal(s.enemy.health.currentHealth, 200, 'wall blocks blast');
    s.enemy.health.reset(); p.life = 0.01; p.mesh.position.set(0, 1, -3);
    s.grenades._projectiles(0.02);
    assert.equal(p.mesh.visible, false);
    assert.ok(s.enemy.health.currentHealth < 200, 'fuse detonates near target');
  } finally { s.close(); }
});

test('blood triggers for applied damage only and the bounded particle pool retires', async () => {
  const s = await setup();
  const effects = new BeachCombatEffects(s.world, s.player);
  try {
    s.player.health.onDamage = info => effects.hit(info);
    s.player.health.invulnerable = true; s.player.health.takeDamage(20);
    assert.equal(s.world.ui.callsTo('flashBlood').length, 0);
    s.player.health.invulnerable = false;
    s.player.health.takeDamage({ amount: 20, source: { position: new THREE.Vector3(3, 1, 0) } });
    assert.equal(s.world.ui.callsTo('flashBlood').length, 1);
    assert.equal(effects.drops.filter(d => d.mesh.visible).length, 12);
    effects.update(1);
    assert.equal(effects.drops.some(d => d.mesh.visible), false);
  } finally { effects.dispose(); s.close(); }
});


test('wider blast reaches 10 m with falloff but leaves targets outside 12 m unharmed', async () => {
  const s = await setup();
  try {
    const centre = new THREE.Vector3(0, 0.9, 0);
    s.enemy.position.set(10, 0, 0);
    s.grenades._explode(centre);
    assert.ok(s.enemy.health.currentHealth < 200, 'new range reaches 10 m');
    assert.ok(s.enemy.health.currentHealth > 160, 'edge damage falls off');
    s.enemy.health.reset(); s.enemy.position.set(13, 0, 0);
    s.grenades._explode(centre);
    assert.equal(s.enemy.health.currentHealth, 200);
  } finally { s.close(); }
});

test('smoke expands, rises, outlasts the flash, retires and reuses a fixed pool', async () => {
  const s = await setup();
  try {
    const position = new THREE.Vector3(0, 1, -3);
    s.grenades._explode(position);
    assert.equal(s.grenades.smoke.filter(p => p.mesh.visible).length, 8);
    const puff = s.grenades.smoke[0];
    const y = puff.mesh.position.y, size = puff.mesh.scale.x;
    s.grenades._projectiles(1);
    assert.ok(puff.mesh.position.y > y);
    assert.ok(puff.mesh.scale.x > size);
    assert.ok(puff.mesh.material.opacity > 0);
    assert.equal(s.grenades.blasts.some(b => b.mesh.visible), false);
    s.grenades._projectiles(5);
    assert.equal(s.grenades.smoke.some(p => p.mesh.visible), false);
    const count = s.grenades.group.children.length;
    for (let i = 0; i < 10; i++) s.grenades._explode(position);
    assert.equal(s.grenades.group.children.length, count, 'bursts allocate no new meshes');
    let disposed = 0;
    s.grenades.smokeGeometry.addEventListener('dispose', () => disposed++);
    s.weapons.dispose();
    assert.equal(disposed, 1, 'shared smoke geometry released once');
    s.player.dispose(); s.world.physics.world.free();
  } catch (error) { s.close(); throw error; }
});

test('landing marker tracks the predicted bounced fuse endpoint without consuming inventory', async () => {
  const s = await setup();
  try {
    s.world.physics.createGround(300, -0.5); s.world.physics.step();
    s.world.input.press('weaponThrowable'); tick(s);
    assert.equal(s.grenades.marker.visible, true);
    assert.equal(s.grenades.markerMaterial.color.getHex(), 0x49ff88);
    assert.equal(s.grenades.ammo, config.levels.level02.grenade.count);
    assert.equal(s.grenades.projectiles.some(p => p.life > 0), false);
    const predicted = s.grenades.previewPosition.clone();
    s.grenades._pose(s.grenades.cfg.releaseSeconds); s.grenades._release();
    const projectile = s.grenades.projectiles[0];
    // Stop just before the fuse so the actual resting point can be compared with the preview.
    for (let i = 0; i < 179; i++) s.grenades._projectiles(1 / 60);
    assert.ok(projectile.mesh.position.distanceTo(predicted) < 0.2);
    s.grenades.lateUpdate(0.1);
    assert.equal(s.grenades.marker.visible, false, 'marker hides after release');
  } finally { s.close(); }
});

test('marker turns red for close throws and hides on deselection or unavailable play', async () => {
  const s = await setup();
  try {
    s.world.physics.createGround(300, -0.5); s.world.physics.step();
    s.world.camera.lookAt(0, -10, -1);
    s.world.input.press('weaponThrowable'); tick(s);
    assert.equal(s.grenades.marker.visible, true);
    assert.equal(s.grenades.markerMaterial.color.getHex(), 0xff453b);
    const position = s.grenades.marker.position;
    assert.ok(Math.abs(position.y - 0.035) < 0.02, 'ring lies above ground');
    s.world.input.press('weaponPrimary'); tick(s);
    assert.equal(s.grenades.marker.visible, false);
    s.world.input.press('weaponThrowable'); tick(s);
    s.player.isDevSuspended = true; tick(s);
    assert.equal(s.grenades.marker.visible, false);
    s.player.isDevSuspended = false; s.grenades.ammo = 0; tick(s);
    assert.equal(s.grenades.marker.visible, false);
  } finally { s.close(); }
});
