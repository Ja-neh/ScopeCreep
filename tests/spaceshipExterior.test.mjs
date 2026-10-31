import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createTestWorld } from './support/testWorld.mjs';
import { Level01InsideSpaceship } from '../src/levels/Level01InsideSpaceship.js';
import { Level02 } from '../src/levels/Level02.js';
import { MrOverallsModel } from '../src/entities/models/MrOverallsModel.js';

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

test('spaceship control center shows decorative buttons nearby and disposes its console', async () => {
  const world = await createTestWorld();
  const level = new Level01InsideSpaceship(world);
  level._createControlCenterConsole();

  const console = world.environmentGroup.getObjectByName('SpaceshipControlCenterConsole');
  assert.ok(console);
  assert.equal(
    console.children.filter((child) => child.name.startsWith('ControlCenterButton-')).length,
    6
  );

  level.player = { position: new Vector3(-4, 12, 79) };
  level._updateControlCenterPanel();
  // By default, the "SHIP CONTROL" UI overlay is removed
  assert.equal(world.ui.callsTo('showControlCenter').length, 0);

  // When explicitly enabled, it displays the buttons
  level.showControlCenterUI = true;
  level._updateControlCenterPanel();
  assert.equal(world.ui.callsTo('showControlCenter').length, 1);
  assert.equal(world.ui.callsTo('showControlCenter')[0].args[0].length, 6);

  level.player.position.set(0, 0, 0);
  level._updateControlCenterPanel();
  assert.equal(world.ui.callsTo('hideControlCenter').length, 1);

  level.dispose();
  assert.equal(console.parent, null);
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
  level.dispose();
});

test('holding room requires taking the gun from the desk before the door unlocks', async () => {
  const world = await createTestWorld();
  const level = new Level01InsideSpaceship(world);

  // Initialize desk gun prop
  level._createDeskGunProp();
  assert.ok(level.deskGunGroup, 'desk gun group created');
  assert.equal(level.hasGun, false, 'player starts unarmed');

  // Fake player and locked cell door
  let playerArmed = false;
  level.player = {
    position: new Vector3(19, 1, -49),
    hasGun: false,
    setHasGun(has) {
      this.hasGun = has;
      playerArmed = has;
    },
    shoot() {
      return this.hasGun;
    }
  };
  level.cellDoor = { isLocked: true };

  // Cannot shoot before taking gun
  assert.equal(level.player.shoot(), false, 'cannot shoot before taking gun');

  // Player approaches locked door without gun
  level.player.position.set(6, 0, -49);
  level._updateHoldingRoomInteractions(0.1);
  assert.equal(level.cellDoor.isLocked, true, 'cell door remains locked');
  assert.equal(level._doorLockedPromptVisible, true, 'door locked prompt is shown');

  // Player walks to desk and takes the gun
  level.player.position.copy(level.deskGunPos);
  world.input.press('specialAction');
  level._updateHoldingRoomInteractions(0.1);

  assert.equal(level.hasGun, true, 'level registers gun taken');
  assert.equal(playerArmed, true, 'player model armed with gun');
  assert.equal(level.player.shoot(), true, 'can shoot after taking gun');
  assert.equal(level.cellDoor.isLocked, false, 'cell door is unlocked after taking gun');
  assert.equal(level.deskGunGroup.visible, false, 'desk prop is hidden after pickup');

  level.dispose();
  assert.equal(level.cellDoor, null);
  assert.equal(level.deskGunGroup, null);
});

test('sleeping capsules display interactive [E] prompt and locked feedback on attempt to open', async () => {
  const world = await createTestWorld();
  const level = new Level01InsideSpaceship(world);

  const fakePodNode = { name: 'Sleeping-Capsule002' };
  level.sleepingPods = [
    {
      name: 'Sleeping-Capsule002',
      node: fakePodNode,
      position: new Vector3(18.0, 0.8, -52.0)
    }
  ];

  level.player = {
    position: new Vector3(0, 0, 0)
  };

  // 1. Far away from pod: no prompt
  level._updateSleepingPodInteractions(0.1);
  assert.equal(level._activePod, null);
  assert.equal(world.ui.callsTo('showPrompt').length, 0);

  // 2. Approach pod: [E] OPEN POD prompt appears
  level.player.position.set(18.0, 0.8, -52.0);
  level._updateSleepingPodInteractions(0.1);
  assert.equal(level._activePod?.name, 'Sleeping-Capsule002');
  const openPrompt = world.ui.callsTo('showPrompt').find((c) => c.args[1] === 'OPEN POD');
  assert.ok(openPrompt, 'interactive [E] OPEN POD prompt is shown');

  // 3. Press [E] to open: locked warning toast & LOCKED prompt feedback
  world.input.press('specialAction');
  level._updateSleepingPodInteractions(0.1);

  const lockedToast = world.ui.callsTo('showToast').find((c) => c.args[0].includes('Locked'));
  assert.ok(lockedToast, 'toast states pod is locked');
  assert.equal(lockedToast.args[1], 'warning');

  const lockedPrompt = world.ui.callsTo('showPrompt').find((c) => c.args[0] === 'LOCKED');
  assert.ok(lockedPrompt, 'prompt changes to LOCKED on attempt to open');

  // 4. Move away from pod: prompt hides
  level.player.position.set(0, 0, 0);
  level._updateSleepingPodInteractions(0.1);
  assert.equal(level._activePod, null);
  const hideCalls = world.ui.callsTo('hidePrompt');
  assert.ok(hideCalls.some((c) => c.args[0] === fakePodNode), 'prompt is hidden when player moves away');

  level.dispose();
  assert.equal(level.sleepingPods.length, 0);
});

test('holding firePrimary causes shooting to loop continuously, and releasing it finishes the cycle', async () => {
  const model = new MrOverallsModel(0.45, 0.55, 1.0, { hasGun: true });
  model.isLoaded = true;

  // Mock shoot actions and mixer
  let playCount = 0;
  const mockAction = {
    play() { playCount++; return this; },
    stop() { return this; },
    reset() { return this; },
    setEffectiveTimeScale() { return this; },
    setEffectiveWeight() { return this; },
    fadeOut() { return this; },
    crossFadeTo() { return this; }
  };
  model.actions.shoot = mockAction;
  model.mixer = {
    update() {},
    addEventListener() {}
  };

  const actor = {
    input: {
      isPointerLocked: true,
      _down: true,
      isActionDown(action) { return action === 'firePrimary' && this._down; }
    },
    velocity: { x: 0, y: 0, z: 0 },
    position: new Vector3(0, 0, 0),
    isDead: false,
    isMounted: false,
    isFrozen: false,
    isDevSuspended: false
  };
  model.actor = actor;

  // 1. Initial shot triggered
  const shot1 = model.shoot();
  assert.equal(shot1, true);
  assert.equal(model.isShooting, true);
  assert.equal(playCount, 1);
  assert.ok(model.shootTimer > 0);

  // 2. Next frame while timer is running and trigger is still down: shoot() returns false, doesn't reset animation
  const midShot = model.shoot();
  assert.equal(midShot, false);
  assert.equal(playCount, 1);

  // 3. Delta advances until shootTimer expires while trigger is held: next shot is automatically triggered
  const dt = model.shootTimer + 0.01;
  model.update(dt, 0, false);
  assert.equal(playCount, 2, 'second shot triggered in loop');
  assert.equal(model.isShooting, true);
  assert.ok(model.shootTimer > 0);

  // 4. Release trigger: next update after shootTimer expires ends shooting cleanly
  actor.input._down = false;
  const dt2 = model.shootTimer + 0.01;
  model.update(dt2, 0, false);
  assert.equal(model.isShooting, false);
  assert.equal(model.shootTimer, 0);
  assert.equal(playCount, 2, 'no third shot triggered after releasing trigger');
});

test('Level 1 player receives infinite bullets on handgun pickup', async () => {
  const world = await createTestWorld();
  const level = new Level01InsideSpaceship(world);
  level.weapons = {
    setHasGun() {},
    rifle: {
      magazineSize: 30,
      ammo: 30,
      reserve: 120
    }
  };
  level._takeGunFromDesk();

  assert.equal(level.hasGun, true);
  assert.equal(level.weapons.rifle.magazineSize, 60);
  assert.equal(level.weapons.rifle.ammo, 60);
  assert.equal(level.weapons.rifle.reserve, Infinity);

  // Gameplay update maintains infinite reserve even after firing rounds
  level.weapons.rifle.reserve = 55;
  level.gameplayUpdate(0.016, world);
  assert.equal(level.weapons.rifle.reserve, Infinity);

  level.dispose();
});

test('cloned guards spawn outside the suit-station cylinder colliders', async () => {
  const world = await createTestWorld();
  const level = new Level01InsideSpaceship(world);
  level.player = { position: new Vector3(0, 11, 20) };

  // Set cloning stations at their known GLTF positions
  level.cloningStations = [
    { name: 'Suit-station001', position: new Vector3(-5, 10, -17) },
    { name: 'Suit-station003', position: new Vector3(7, 10, -17) }
  ];

  level._spawnLabClonedGuards();
  assert.ok(level.clonedGuardsSquad);
  assert.equal(level.clonedGuardsSquad.members.length, 8);

  // Tube bounds: Z is [-19.74, -14.26]. All guards must spawn outside tube bounds (Z >= -13.5)
  for (const guard of level.clonedGuardsSquad.members) {
    const pos = guard.position;
    assert.ok(pos.z >= -13.5, `Guard at Z=${pos.z} should be outside tube bounds (Z >= -13.5)`);
    assert.ok(pos.y >= 10.0, `Guard at Y=${pos.y} should be on Floor 2`);
  }

  level.dispose();
});

test('control room door shows locked prompt and toast warning when trying to go through before lockdown release', async () => {
  const world = await createTestWorld();
  const level = new Level01InsideSpaceship(world);

  // Position player directly in front of the control room blast door on the bridge (X=1, Z=66.5)
  level.player = { position: new Vector3(1.0, 11.2, 66.5) };

  // Phase 5 update evaluates door approach
  level._updateControlRoomDoorInteraction(0.016);

  assert.equal(level._controlRoomLockedPromptVisible, true);
  assert.equal(world.ui.callsTo('showPrompt').length, 1);
  assert.ok(world.ui.callsTo('showPrompt')[0].args[1].includes('CONTROL ROOM SEALED'));

  // Toast warning appears informing player about security lockdown
  assert.equal(world.ui.callsTo('showToast').length, 1);
  assert.ok(world.ui.callsTo('showToast')[0].args[0].includes('CONTROL ROOM LOCKED: Security lockdown'));

  // When all cloned guards are defeated, door unlocks and prompt clears
  level._unlockControlRoom();
  assert.equal(level._controlRoomUnlocked, true);
  assert.equal(level._controlRoomLockedPromptVisible, false);

  level.dispose();
});

test('approaching dashboard shows prompt, triggers course to Earth, and plays outro cinematic thoughts', async () => {
  const world = await createTestWorld();
  const level = new Level01InsideSpaceship(world);
  level._controlRoomUnlocked = true;

  // Position player directly in front of the dashboard table in the control room
  level.player = {
    position: new Vector3(1.0, 11.2, 74.0),
    setFrozen(val) { this._frozen = val; }
  };

  level._updateControlCenterPanel();
  assert.equal(level._dashboardPromptVisible, true);
  const promptCalls = world.ui.callsTo('showPrompt');
  assert.ok(promptCalls.some(call => call.args[1].includes('SET NAVIGATION COURSE: EARTH')));

  // Triggering the dashboard starts outro cinematic thought dialogue
  level._setCourseForEarth();
  assert.equal(level.missionComplete, true);
  assert.equal(level.isOutroPlaying, true);
  assert.equal(level.player._frozen, true);

  const cinematicCalls = world.ui.callsTo('showCinematic');
  assert.ok(cinematicCalls.length >= 1);
  const lastCinematic = cinematicCalls[cinematicCalls.length - 1];
  assert.ok(lastCinematic.args[0].includes('Heading for Earth'));
  assert.ok(lastCinematic.args[1].includes('Time to wake the others and suit up'));
  assert.equal(lastCinematic.args[3], true, 'isThought must be true for inner dialogue');

  // Advancing outro cutscene fades to black and automatically unloads Level 1 and loads Level 2
  level._updateOutroCutscene(6.0);
  assert.equal(level.isOutroPlaying, false);
  assert.ok(world.ui.callsTo('showFade').length >= 1, 'fades screen to black');
  assert.ok(world.loadedLevel instanceof Level02, 'Level 2 automatically loaded');

  level.dispose();
});

test('player death plays animation and immediately shows Restart and Home menu options without fading to black', async () => {
  const world = await createTestWorld();
  const level = new Level01InsideSpaceship(world);

  let dieCalled = false;
  level.player = {
    position: new Vector3(0, 1, 0),
    isDead: false,
    health: { currentHealth: 0, maxHealth: 100, isDead: true },
    die() {
      dieCalled = true;
      this.isDead = true;
    }
  };

  // 1. Mission update detects player death and initiates death sequence
  level._updateMissionProgress(0.016);
  assert.equal(dieCalled, true, 'player.die() must be called to trigger death animation');
  assert.equal(level._playerDying, true, 'death sequence is initiated');

  // 2. Menu is immediately shown without fading to black
  assert.equal(world.ui.callsTo('showFade').length, 0, 'screen does not fade to black');

  const defeatCalls = world.ui.callsTo('showMissionResult');
  assert.ok(defeatCalls.length >= 1, 'defeat menu shown immediately');
  const result = defeatCalls[defeatCalls.length - 1].args[0];
  assert.equal(result.outcome, 'defeat');
  assert.equal(result.title, 'YOU DIED');
  assert.equal(result.actions.length, 2);
  assert.equal(result.actions[0].label, 'Restart');
  assert.equal(result.actions[1].label, 'Home');

  // Test action callbacks
  result.actions[0].onClick();
  assert.equal(world.restartRequested, true, 'Restart calls restartCurrentLevel');

  let homeRequested = false;
  world.returnToMainMenu = () => { homeRequested = true; };
  result.actions[1].onClick();
  assert.equal(homeRequested, true, 'Home calls returnToMainMenu');

  level.dispose();
});

test('Level 1 only allows gun usage: [1], [2], [3] and quick melee do not switch to knife or bomb', async () => {
  const world = await createTestWorld();
  const player = {
    position: new Vector3(0, 0, 0),
    velocity: new Vector3(0, 0, 0),
    pitch: 0,
    yaw: 0,
    mesh: new Vector3(),
    springArm: { eyeHeight: 1.6 },
    collider: null,
    isCrouching: false,
    crouchAmount: 0
  };

  const weapons = new Level01InsideSpaceship(world);
  const controller = new (await import('../src/weapons/WeaponController.js')).WeaponController(world, player, {
    gunOnly: true,
    allowSwitching: false,
    allowQuickMelee: false,
    showHeldWeapons: false,
    showWeaponHUD: false,
    hasGun: true
  });

  assert.equal(controller.equipped, 'rifle');
  assert.equal(controller.activeWeapon, 'rifle');

  // Attempting to switch to knife ([2]) or bomb ([3]) is blocked
  world.input.isPointerLocked = true;

  // Simulate pressing Digit2 (weaponMelee)
  world.input.press('weaponMelee');
  controller.gameplayUpdate(0.016, world);
  assert.equal(controller.equipped, 'rifle', 'remains on rifle when weaponMelee is pressed');
  assert.equal(controller.activeWeapon, 'rifle');

  // Simulate pressing Digit3 (weaponBomb)
  world.input.pressed.clear();
  world.input.press('weaponBomb');
  controller.gameplayUpdate(0.016, world);
  assert.equal(controller.equipped, 'rifle', 'remains on rifle when weaponBomb is pressed');
  assert.equal(controller.activeWeapon, 'rifle');

  // Direct _equip calls for knife or bomb are also rejected
  controller._equip('knife');
  assert.equal(controller.equipped, 'rifle');
  controller._equip('bomb');
  assert.equal(controller.equipped, 'rifle');

  weapons.dispose();
});

