// Level 2's opening: the camera sweep, the crew walking off the ship, the helicopters flying in
// and their pilots, the squad of five, and the ammo crate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { Level02 } from '../src/levels/Level02.js';
import { HelicopterArrival } from '../src/levels/level02/HelicopterArrival.js';
import { HelicopterModel } from '../src/entities/models/HelicopterModel.js';
import config from '../src/config.json';

async function loadLevel(seed = 5) {
  const world = await createTestWorld({ seed });
  const level = new Level02(world);
  await level.init();
  return { world, level };
}

function teardown(world, level) {
  level.dispose();
  world.clearEntities();
  return bodyCount(world);
}

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

test('the helicopters fly in high enough to clear the anchored ship', () => {
  const effects = new THREE.Group();
  for (const [x, side] of [[-45, -1], [28, 1]]) {
    const arrival = new HelicopterArrival({
      model: new HelicopterModel(),
      landing: { x, z: 180, heading: 0, groundY: 1 },
      groundHeightAt: () => -5,
      effectsParent: effects,
      side
    });
    // The ship spans x -49..51, z 214..235 and stands up to 35 m tall
    for (let s = 0; s <= 1; s += 0.01) {
      const p = arrival.path.getPoint(s);
      if (p.x > -55 && p.x < 56 && p.z > 210 && p.z < 240) {
        assert.ok(p.y > 40, `at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) the helicopter is only ${p.y.toFixed(1)} m up`);
      }
    }
    arrival.dispose();
    arrival.model.dispose();
  }
});

test('opening: camera sweep, crew down the gangway, helicopters land, pilots climb out', async () => {
  const { world, level } = await loadLevel();
  const zone = level.landingZone;
  const crew = level.allies.mates.slice();
  assert.equal(crew.length, config.allies.crewSize - 1, 'solo: the player plus AI crew make a crew of five');
  assert.ok(level.squad.targets === level.allies.members, 'aliens hunt the whole squad');

  // First frame: the sweep takes over the view and freezes the player
  stepWorld(world, 0.1, { level });
  assert.ok(world.activeCamera === level.cinematic.camera, 'cinematic camera active');
  assert.equal(level.player.isDevSuspended, true);
  assert.ok(world.ui.callsTo('showCinematic').length === 1);
  for (const bay of zone.helicopterBays) assert.equal(bay.collider.isEnabled(), false, 'no invisible cover while flying');

  let washSeen = false;
  let landedAt = null;
  stepWorld(world, 22, {
    level,
    onFrame: (frame) => {
      if (zone.arrivals.some((arrival) => arrival.wash.activeCount > 10)) washSeen = true;
      if (landedAt === null && zone.helicoptersLanded) landedAt = frame / 60;
    }
  });

  // The sweep ended by itself and handed the view back
  assert.equal(level.cinematic.isFinished, true);
  assert.equal(level.cinematic.wasSkipped, false);
  assert.ok(world.activeCamera === null, 'player camera back');
  assert.equal(level.player.isDevSuspended, false);
  assert.ok(world.ui.callsTo('hideCinematic').length >= 1);

  // Helicopters down on their spots, with sand blown about on the way
  assert.ok(landedAt !== null && landedAt < 20, `landed after ${landedAt}s`);
  assert.ok(washSeen, 'rotor wash kicked up');
  for (const bay of zone.helicopterBays) {
    const p = bay.model.mesh.position;
    assert.ok(Math.abs(p.x - bay.x) < 0.01 && Math.abs(p.z - bay.z) < 0.01 && Math.abs(p.y - bay.groundY) < 0.01, 'on its spot');
    assert.equal(bay.collider.isEnabled(), true, 'solid cover once landed');
  }

  // Pilots out and at their posts; crew at the rally on the sand, waiting for the player
  const pilots = level.allies.mates.filter((mate) => !mate.inFormation);
  assert.deepEqual(pilots.map((pilot) => pilot.name), ['Hawk', 'Viper']);
  zone.helicopterBays.forEach((bay, i) => {
    assert.ok(flat(pilots[i].position, bay.guardPoint) < 3, `${pilots[i].name} guards the helicopter`);
  });
  for (const mate of crew) {
    assert.ok(!mate.isWalkingRoute, `${mate.name} finished walking off`);
    assert.ok(mate.position.z < 190 && level.environment.heightAt(mate.position.x, mate.position.z) > 0.3, `${mate.name} is on the sand`);
    assert.ok(flat(mate.position, mate.holdPoint) < 3, `${mate.name} is at the rally post`);
  }
  assert.equal(level.allies.members.length, 1 + crew.length + pilots.length);

  // Once the player is ashore the crew fall in behind them; the pilots stay with the helicopters
  const foot = zone.spawnPoints.gangwayFoot;
  level.player.teleport(foot.x, foot.y, foot.z);
  stepWorld(world, 0.2, { level });
  for (const mate of crew) assert.equal(mate.order, 'follow');
  for (const pilot of pilots) assert.equal(pilot.order, 'hold');

  assert.equal(teardown(world, level), 0, 'no physics bodies left');
});

test('the player starts at the top of the gangway, with room behind for the camera', async () => {
  const { world, level } = await loadLevel();
  world.input.press('skipCutscene');
  stepWorld(world, 1, { level });
  const p = level.player.position;
  const top = level.landingZone.gangway.top;
  assert.ok(flat(p, top) < 1.5 && p.y > 5.5, 'on the platform at the top of the gangway');
  const arm = level.player.springArm;
  assert.ok(arm.currentCameraDistance > arm.thirdPersonDistance * 0.9, `camera squeezed to ${arm.currentCameraDistance.toFixed(1)} m`);
  assert.equal(teardown(world, level), 0);
});

test('opening: a 10-second sweep that follows the helicopters in past the ship, without flying through it', async () => {
  const { world, level } = await loadLevel();
  const cinematic = level.cinematic;
  const camera = cinematic.camera;
  const crew = level.allies.mates.slice();
  const ship = new THREE.Vector3(0, 10, 225);

  // On screen, inside the letterbox bars
  const onScreen = (point) => {
    camera.updateMatrixWorld();
    const p = point.clone().project(camera);
    return p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 0.75;
  };
  const helicoptersOnScreen = () => level.landingZone.arrivals.filter((a) => onScreen(a.model.mesh.position)).length;

  stepWorld(world, 0.2, { level });
  assert.ok(helicoptersOnScreen() >= 1 && onScreen(ship), 'opens on the helicopters with the ship ahead');
  stepWorld(world, 2.8, { level });
  assert.ok(world.activeCamera === camera);
  assert.ok(helicoptersOnScreen() >= 1, 'a helicopter in shot at 3 s');
  assert.ok(onScreen(ship), 'the ship in shot at 3 s');
  assert.ok(crew.every((mate) => !mate.isWalkingRoute), 'crew wait on the gangway at first');
  stepWorld(world, 3, { level });
  assert.ok(helicoptersOnScreen() >= 1, 'a helicopter in shot at 6 s');
  assert.ok(crew.some((mate) => mate.isWalkingRoute), 'crew set off down the gangway');
  stepWorld(world, 3.5, { level });
  assert.equal(cinematic.isFinished, false, 'still playing at 9.5 s');
  stepWorld(world, 0.7, { level });
  assert.equal(cinematic.isFinished, true, 'over by 10.2 s');
  assert.ok(world.activeCamera === null);

  // The path never enters the anchored ship (x -50..51, z 213..236, up to 35 m) until it settles
  // over the deck edge behind the player at the very end
  const end = cinematic.path.getPointAt(1);
  for (let s = 0; s <= 1; s += 0.005) {
    const p = cinematic.path.getPointAt(s);
    if (p.distanceTo(end) < 12) break;
    const insideShip = p.x > -50 && p.x < 51 && p.z > 213 && p.z < 236 && p.y < 36;
    assert.ok(!insideShip, `camera inside the ship at (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)})`);
  }
  assert.equal(teardown(world, level), 0);
});

test('opening: [Space] skips the camera sweep', async () => {
  const { world, level } = await loadLevel();
  stepWorld(world, 0.5, { level });
  assert.equal(level.cinematic.isPlaying, true);

  world.input.press('skipCutscene');
  stepWorld(world, 0.1, { level });
  assert.equal(level.cinematic.isFinished, true);
  assert.equal(level.cinematic.wasSkipped, true);
  assert.ok(world.activeCamera === null);
  assert.equal(level.player.isDevSuspended, false, 'the player can move');
  assert.equal(teardown(world, level), 0);
});

test('dying during the opening still leaves the player frozen behind the result screen', async () => {
  const { world, level } = await loadLevel();
  stepWorld(world, 0.5, { level });
  level.player.health.takeDamage({ amount: 1000 });
  stepWorld(world, 5, { level }); // Longer than the sweep
  assert.equal(level.state, 'lost');
  assert.equal(level.player.isDevSuspended, true);
  assert.ok(world.activeCamera === null);
  const stats = world.ui.callsTo('showMissionResult').at(-1).args[0].stats;
  assert.ok(stats.some((stat) => stat.label === 'Squadmates lost'));
  assert.equal(teardown(world, level), 0);
});

test('the ammo crate refills the machine gun when the player presses [E] beside it', async () => {
  const { world, level } = await loadLevel();
  world.input.press('skipCutscene');
  stepWorld(world, 0.2, { level });

  const crate = level.supplyCrate;
  const rifle = level.weapons.rifle;
  rifle.reserve = 10;

  const spot = crate.position;
  level.player.teleport(spot.x + 1.6, level.environment.heightAt(spot.x + 1.6, spot.z) + 0.05, spot.z);
  stepWorld(world, 0.3, { level });
  assert.equal(crate.isPlayerNear, true);
  assert.equal(world.ui.callsTo('showPrompt').at(-1).args[1], 'RESUPPLY AMMO');

  world.input.press('specialAction');
  stepWorld(world, 0.1, { level });
  assert.equal(rifle.reserve, config.weapons.machineGun.reserveAmmo);
  assert.ok(world.ui.callsTo('showToast').some((call) => call.args[0] === 'Ammo resupplied'));
  assert.equal(world.ui.callsTo('showPrompt').at(-1).args[1], 'AMMO FULL');

  level.player.teleport(spot.x + 10, level.environment.heightAt(spot.x + 10, spot.z) + 0.05, spot.z);
  stepWorld(world, 0.2, { level });
  assert.equal(crate.isPlayerNear, false);
  assert.ok(world.ui.callsTo('hidePrompt').some((call) => call.args[0] === crate));

  // The crate is solid: low cover
  assert.ok(crate.collider && crate.collider.isEnabled());
  assert.equal(teardown(world, level), 0);
});
