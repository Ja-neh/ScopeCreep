// Level 3's boss fight with the Warden in the village hall: waking up, the shield and its
// crystals, plasma volleys, the shockwave you jump, enraged at half health, winning, the
// squad's room in the hall, the sandbox [F6], and clean teardown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { Level03 } from '../src/levels/Level03.js';
import { Level03TestLevel } from '../src/levels/Level03TestLevel.js';
import { Shockwave } from '../src/entities/enemies/Shockwave.js';
import { HitscanWeapon } from '../src/weapons/HitscanWeapon.js';
import config from '../src/config.json';

const cfg = config.enemies.warden;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

async function loadLevel(LevelClass = Level03, seed = 3) {
  const world = await createTestWorld({ seed });
  const level = new LevelClass(world);
  await level.init();
  return { world, level };
}

function teardown(world, level) {
  level.dispose();
  world.clearEntities();
  return bodyCount(world);
}

/**
 * Drops the force field (the generator guards go too, so only the fight in the hall counts), puts
 * the player just inside the hall door and lets the Level 3 mission wake the Warden.
 */
function enterHall(world, level) {
  const hall = level.village.hall;
  for (const alien of [...level.squad.members]) level.squad.remove(alien);
  level.shutDownGenerators({ instant: true });
  stepWorld(world, 0.2, { level });
  assert.equal(level.state, 'hall');
  const inside = hall.doorway.clone().addScaledVector(hall.forward, -3);
  level.player.teleport(inside.x, inside.y + 0.4, inside.z);
  stepWorld(world, 0.2, { level });
  assert.equal(level.state, 'boss', 'walking into the hall starts the fight');
  return level.arena;
}

/** One machine-gun round from the player's eyes at `point`. */
function shoot(world, level, point) {
  const gun = shoot.gun || (shoot.gun = new HitscanWeapon(config.weapons.machineGun));
  gun.cooldown = 0;
  gun.ammo = gun.cfg.magazine;
  const eye = level.player.position.clone();
  eye.y += 1.7;
  return gun.fire({ physicsWorld: world.physics, origin: eye, aimPoint: point, spread: 0, excludeCollider: level.player.collider, source: level.player });
}

test('the Warden waits until the player walks into the hall, then wakes shielded, fed by two crystals on the back pillars', async () => {
  const { world, level } = await loadLevel();
  assert.equal(level.arena, null, 'nobody in the hall yet');
  const arena = enterHall(world, level);
  const warden = arena.warden;
  const hall = level.village.hall;

  assert.ok(warden.brain.is('engage'), 'awake and fighting');
  assert.ok(warden.shielded && warden.health.invulnerable, 'shield up');
  assert.ok(hall.contains(warden.position.x, warden.position.z), 'in the hall');
  assert.ok(flat(warden.position, hall.dais) < flat(level.player.position, hall.dais), 'between the player and its dais');
  assert.equal(arena.crystals.length, 2);
  for (const crystal of arena.crystals) {
    assert.ok(flat(crystal.position, hall.dais) < flat(warden.position, hall.dais) + 2, 'crystals at the back, by the dais');
    assert.ok(crystal.position.y > warden.position.y + 2.5, 'high up on a pillar');
  }
  const ui = world.ui;
  assert.equal(ui.callsTo('showBossHealth').at(-1).args[0], 'THE WARDEN');
  assert.equal(ui.callsTo('updateBossHealth').at(-1).args[2], true, 'the bar shows the shield');
  assert.match(ui.callsTo('showObjective').at(-1).args[1], /crystals.*2 left/);
  assert.equal(teardown(world, level), 0);
});

test('the shield: bullets do nothing to the Warden until both crystals are shot to pieces', async () => {
  const { world, level } = await loadLevel();
  const arena = enterHall(world, level);
  const warden = arena.warden;
  const chest = () => new THREE.Vector3(warden.position.x, warden.position.y + 2.5, warden.position.z);

  let shot = shoot(world, level, chest());
  assert.ok(shot.entity === warden, 'the shot reaches the Warden');
  assert.equal(shot.damaged, false, 'but the shield stops it');
  assert.equal(warden.health.currentHealth, warden.health.maxHealth);

  for (const crystal of arena.crystals) {
    let rounds = 0;
    while (!crystal.health.isDead && rounds < 40) {
      shot = shoot(world, level, crystal.position);
      assert.ok(shot.entity === crystal, 'a clear shot at the crystal');
      rounds++;
    }
    assert.ok(crystal.health.isDead, `crystal still standing after ${rounds} rounds`);
    assert.equal(rounds, Math.ceil(cfg.crystalHealth / config.weapons.machineGun.damage));
  }
  stepWorld(world, 0.2, { level });
  assert.ok(arena.crystals.every((crystal) => crystal.collider === null), 'shattered crystals leave no collider');
  assert.equal(warden.shielded, false, 'shield down');
  assert.equal(arena.shieldDrops, 1);
  assert.match(world.ui.callsTo('showObjective').at(-1).args[1], /bring the Warden down/);

  shot = shoot(world, level, chest());
  assert.ok(shot.damaged, 'now it hurts');
  assert.equal(warden.health.currentHealth, warden.health.maxHealth - config.weapons.machineGun.damage);
  assert.equal(teardown(world, level), 0);
});

test('plasma volleys: a fan of bolts at the player', async () => {
  const { world, level } = await loadLevel();
  const arena = enterHall(world, level);
  const warden = arena.warden;
  warden._slamTimer = 99; // Volleys only
  const pool = world.projectilePool;
  const before = pool.activeProjectiles.filter((p) => p.type === 'PLASMA').length;
  stepWorld(world, cfg.volleySeconds + 1, { level, onFrame: () => warden.volleysFired > 0 });
  assert.equal(warden.volleysFired, 1);
  const bolts = pool.activeProjectiles.filter((p) => p.type === 'PLASMA' && p.damageInfo.source === warden);
  assert.equal(bolts.length - before, cfg.volleyBolts);
  const yaws = bolts.map((b) => Math.atan2(b.velocity.x, b.velocity.z)).sort((a, b) => a - b);
  const fan = (yaws.at(-1) - yaws[0]) * 180 / Math.PI;
  assert.ok(Math.abs(fan - cfg.volleySpreadDegrees) < 2, `fan of ${fan.toFixed(0)} degrees`);
  for (const bolt of bolts) assert.equal(bolt.damageInfo.amount, cfg.volleyDamage);
  const toPlayer = Math.atan2(level.player.position.x - warden.position.x, level.player.position.z - warden.position.z);
  const middle = (yaws[0] + yaws.at(-1)) / 2;
  assert.ok(Math.abs(Math.atan2(Math.sin(middle - toPlayer), Math.cos(middle - toPlayer))) < 0.25, 'centred on the player');
  assert.equal(teardown(world, level), 0);
});

test('shockwave ring: it hurts what stands on the floor as it passes, once; a jump clears it', () => {
  const centre = new THREE.Vector3(0, 10, 0);
  const target = (x, y) => ({ position: new THREE.Vector3(x, y, 0), health: { isDead: false, taken: 0, takeDamage(info) { this.taken += info.amount; } } });
  const standing = target(6, 10);
  const jumping = target(9, 10);
  const far = target(30, 10);
  const wave = new Shockwave(null);
  wave.start(centre, { speed: 12, maxRadius: 22, damage: 25, clearHeight: 0.45 });
  for (let i = 0; i < 160 && wave.active; i++) {
    jumping.position.y = Math.abs(wave.radius - 9) < 1.5 ? 11.2 : 10; // In the air as the ring passes
    wave.update(1 / 60, [standing, jumping, far]);
  }
  assert.equal(standing.health.taken, 25, 'hit once, not every frame it stands in the ring');
  assert.equal(jumping.health.taken, 0, 'jumped over it');
  assert.equal(far.health.taken, 0, 'out of reach');
  assert.equal(wave.active, false, 'fades out at its full size');
  wave.dispose();
});

test('the Warden slams the floor: the player takes the shockwave, unless they jump it', async () => {
  const { world, level } = await loadLevel();
  const arena = enterHall(world, level);
  const warden = arena.warden;
  const player = level.player;
  warden._volleyTimer = 999; // The shockwave only

  // Standing still: caught
  warden._slamTimer = 0;
  stepWorld(world, cfg.slamWindup + 3, { level });
  assert.equal(warden.slams, 1);
  assert.equal(player.health.maxHealth - player.health.currentHealth, cfg.shockwaveDamage);

  // Jumping just before the ring arrives (a fifth of a second away): clear
  player.health.heal(100);
  warden._slamTimer = 0;
  stepWorld(world, cfg.slamWindup + 4, {
    level,
    onFrame: () => {
      const wave = warden.shockwave;
      warden._volleyTimer = 999;
      return wave.active && flat(player.position, wave.centre) - wave.radius < cfg.shockwaveSpeed * 0.2;
    }
  });
  assert.ok(warden.shockwave.active, 'the ring is on its way');
  world.input.press('jump');
  stepWorld(world, 3, { level, onFrame: () => { warden._volleyTimer = 999; } });
  assert.equal(warden.slams, 2);
  assert.equal(player.health.currentHealth, player.health.maxHealth, 'jumped clear of the ring');
  assert.equal(teardown(world, level), 0);
});

test('enraged at half health: the shield comes back from two crystals by the door, and four troopers come in', async () => {
  const { world, level } = await loadLevel();
  const arena = enterHall(world, level);
  const warden = arena.warden;
  const hall = level.village.hall;
  for (const crystal of arena.crystals) crystal.health.takeDamage({ amount: 9999 });
  stepWorld(world, 0.1, { level });
  assert.equal(warden.shielded, false);
  const aliensBefore = level.squad.aliveCount;

  warden.health.takeDamage({ amount: warden.health.maxHealth * (1 - cfg.enrageFraction) + 1 });
  stepWorld(world, 0.1, { level });
  assert.ok(warden.enraged);
  assert.ok(warden.shielded, 'the shield is back');
  assert.ok(warden.cadence < 1, 'attacks come faster');
  const fresh = arena.crystals.filter((crystal) => !crystal.isDead);
  assert.equal(fresh.length, 2);
  for (const crystal of fresh) assert.ok(flat(crystal.position, hall.doorway) < flat(warden.position, hall.doorway), 'the new crystals are by the door');
  assert.equal(level.squad.aliveCount - aliensBefore, cfg.enrageAdds);
  for (const trooper of arena.adds) {
    assert.ok(!hall.contains(trooper.position.x, trooper.position.z), 'they come from outside');
    assert.ok(trooper.brain.is('investigate') || trooper.brain.is('engage'), `the trooper is ${trooper.brain.current}`);
  }

  // They join the fight (shooting in through the door, then coming in), and nobody wanders off
  const startDistance = arena.adds.map((t) => flat(t.position, hall.doorway));
  const engaged = new Set();
  stepWorld(world, 8, {
    level,
    onFrame: () => { for (const t of arena.adds) if (t.brain.is('engage')) engaged.add(t); }
  });
  assert.equal(engaged.size, cfg.enrageAdds, 'every trooper joined the fight');
  arena.adds.forEach((t, i) => {
    if (!t.isDead) assert.ok(flat(t.position, hall.doorway) <= startDistance[i] + 2, 'still pressing on the hall');
  });
  assert.equal(teardown(world, level), 0);
});

test('bringing the Warden down wins the mission after a moment; teardown leaves nothing behind', async () => {
  const { world, level } = await loadLevel();
  const arena = enterHall(world, level);
  const warden = arena.warden;
  for (const crystal of arena.crystals) crystal.health.takeDamage({ amount: 9999 });
  stepWorld(world, 0.1, { level });
  warden.health.takeDamage({ amount: warden.health.maxHealth * 0.4 }); // Not enraged yet...
  stepWorld(world, 0.1, { level });
  warden.enraged = true;                                                 // ...skip the second shield
  warden.health.takeDamage({ amount: warden.health.maxHealth });
  stepWorld(world, 0.2, { level });
  assert.ok(arena.defeated);
  assert.equal(level.state, 'victory');
  assert.equal(world.ui.callsTo('hideBossHealth').length >= 1, true);
  assert.equal(world.ui.callsTo('showMissionResult').length, 0, 'not straight away');

  stepWorld(world, config.levels.level03.victoryDelaySeconds + 0.2, { level });
  assert.equal(level.state, 'won');
  const result = world.ui.callsTo('showMissionResult').at(-1).args[0];
  assert.equal(result.outcome, 'victory');
  assert.equal(result.title, 'THE ISLAND IS OURS AGAIN');
  assert.equal(teardown(world, level), 0, 'no physics bodies left');
  assert.equal(world.effectsGroup.children.filter((c) => c.name === 'Shockwave').length, 0, 'shockwave meshes gone');
});

test('in the hall the squad can stand anywhere on the floor except the pillars and the dais', async () => {
  const { world, level } = await loadLevel();
  level.shutDownGenerators({ instant: true }); // No force field in the way
  const village = level.village;
  const hall = village.hall;
  const middle = hall.centre;
  assert.ok(village.isOpenGround(middle.x, middle.z), 'the middle of the floor');
  assert.ok(village.isOpenGround(hall.doorway.x - hall.forward.x * 2, hall.doorway.z - hall.forward.z * 2), 'just inside the door');
  for (const pillar of hall.pillars) assert.equal(village.isOpenGround(pillar.x, pillar.z), false, 'a pillar');
  assert.equal(village.isOpenGround(hall.dais.x, hall.dais.z), false, 'the dais');
  const b = hall.bounds;
  assert.equal(village.isOpenGround(b.maxX - 0.2, (b.minZ + b.maxZ) / 2), false, 'a wall');
  assert.ok(level._isWalkable(middle.x + 2, middle.z), 'formation places work in the hall');
  assert.equal(teardown(world, level), 0);
});

test('sandbox [F6]: into the hall with the squad to fight the Warden, as often as you like', async () => {
  const { world, level } = await loadLevel(Level03TestLevel);
  world.input.press('devBoss');
  stepWorld(world, 0.2, { level });
  const hall = level.village.hall;
  const first = level.arena.warden;
  assert.ok(level.arena.started && first.brain.is('engage'));
  assert.ok(hall.contains(level.player.position.x, level.player.position.z), 'the player is in the hall');
  for (const mate of level.allies.mates) assert.ok(flat(mate.position, hall.entrance) < 8, `${mate.name} came along`);

  // Beaten: no mission result in the sandbox
  for (const crystal of level.arena.crystals) crystal.health.takeDamage({ amount: 9999 });
  stepWorld(world, 0.1, { level });
  first.enraged = true;
  first.health.takeDamage({ amount: 99999 });
  stepWorld(world, cfg.slamWindup + config.levels.level03.victoryDelaySeconds, { level });
  assert.ok(level.arena.defeated);
  assert.equal(world.ui.callsTo('showMissionResult').length, 0);

  // Again: a fresh Warden, and only one
  world.input.press('devBoss');
  stepWorld(world, 0.2, { level });
  assert.ok(level.arena.warden !== first && level.arena.warden.brain.is('engage'));
  assert.equal(level.squad.members.filter((m) => m.name === 'AlienWarden').length, 1);
  assert.equal(level.arena.crystalsLeft, 2);
  assert.equal(teardown(world, level), 0);
});
