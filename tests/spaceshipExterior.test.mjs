import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorld } from './support/testWorld.mjs';
import { Level01InsideSpaceship } from '../src/levels/Level01InsideSpaceship.js';

test('spaceship exterior has distant stars, planets, and a moon, and disposes them', async () => {
  const world = await createTestWorld();
  const level = new Level01InsideSpaceship(world);
  level._createSpaceBackdrop();

  const stars = world.environmentGroup.getObjectByName('SpaceshipExteriorStars');
  assert.ok(stars.isPoints);
  assert.equal(stars.geometry.getAttribute('position').count, 1400);

  const moon = world.environmentGroup.getObjectByName('DistantMoon');
  const bluePlanet = world.environmentGroup.getObjectByName('DistantBluePlanet');
  const ringedPlanet = world.environmentGroup.getObjectByName('DistantRingedPlanet');
  const rings = world.environmentGroup.getObjectByName('DistantPlanetRings');
  assert.ok(moon.isMesh);
  assert.ok(bluePlanet.isMesh);
  assert.ok(ringedPlanet.isMesh);
  assert.ok(rings.isMesh);
  assert.ok(moon.position.length() > 500, 'moon is outside the ship');
  assert.ok(bluePlanet.position.length() > 1000, 'blue planet is distant');
  assert.ok(ringedPlanet.position.length() > 1000, 'ringed planet is distant');

  level.dispose();
  for (const object of [stars, moon, bluePlanet, ringedPlanet, rings]) {
    assert.equal(object.parent, null, `${object.name} was removed on level disposal`);
  }
});

test('falling below the ship freezes the player and offers restart', async () => {
  const world = await createTestWorld();
  const level = new Level01InsideSpaceship(world);
  let frozen = false;
  level._fallDeathY = -15;
  level.player = {
    position: { y: -16 },
    setFrozen(value) { frozen = value; }
  };

  assert.equal(level._checkPlayerFall(), true);
  assert.equal(frozen, true);
  assert.equal(world.isPaused, true);

  const result = world.ui.callsTo('showMissionResult').at(-1).args[0];
  assert.equal(result.outcome, 'defeat');
  assert.equal(result.title, 'LOST IN SPACE');
  assert.equal(result.actions[0].label, 'Restart level');
  result.actions[0].onClick();
  assert.equal(world.restartRequested, true);
  assert.equal(level._checkPlayerFall(), false, 'death screen is only shown once');
});
