import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Level01 } from '../src/levels/Level01.js';
import { JetDefenseMission } from '../src/levels/JetDefenseMission.js';
import { EnemyJet } from '../src/entities/enemies/EnemyJet.js';
import { PlayerJet } from '../src/entities/player-jet/PlayerJet.js';
import { ProjectilePool } from '../src/entities/ProjectilePool.js';
import { FlakTurret } from '../src/entities/ship-components/FlakTurret.js';
import { CAMPAIGN_CREDITS, CAMPAIGN_ENDING } from '../src/levels/level01/ending.js';
import { createTestWorld, bodyCount } from './support/testWorld.mjs';
import config from '../src/config.json';

test('jet defense progresses through three waves and rewards a clean battleship defense', async () => {
  const world = await createTestWorld();
  const pool = new ProjectilePool(world);
  world.addEntity(pool);
  world.projectilePool = pool;

  const battleship = {
    mesh: new THREE.Group(),
    health: { currentHealth: 1000, maxHealth: 1000 },
    isDestroyed: false,
    faction: 'humans'
  };
  const playerJet = new PlayerJet(world);
  world.addEntity(playerJet);

  const level = new JetDefenseMission(world, battleship);
  world.currentLevel = level;
  level.start(playerJet);

  for (let waveIndex = 0; waveIndex < config.enemyJet.waves.length; waveIndex++) {
    if (waveIndex > 0)     level.update(config.enemyJet.defense.betweenWavesSeconds + 0.1);
    else {
      level._waveTimer = 0;
    level.update(0.1);
    }

    const wave = config.enemyJet.waves[waveIndex];
    const waveSize = wave.fighters + wave.aces;
    for (let spawned = 0; spawned < waveSize; spawned++) {
      level._spawnTimer = 0;
      level.update(0.01);
    }

    const livingJets = [...level.enemyJets].filter((enemy) => !enemy.isDestroyed);
    assert.equal(livingJets.length, waveSize, `wave ${waveIndex + 1} spawns the configured aircraft`);
    assert.ok(livingJets.every((enemy) => enemy.target === battleship), 'enemy jets attack the ship');
    if (wave.aces > 0) {
      assert.ok(livingJets.some((enemy) => enemy.variant === 'ace'), 'later waves include ace opponents');
    }
    for (const enemy of livingJets) enemy.health.takeDamage(enemy.health.maxHealth);
    level.update(0.01);
  }

  assert.equal(level.state, 'won');
  assert.equal(world.isPaused, true);
  assert.equal(level.killCount, config.enemyJet.waves.reduce((sum, wave) => sum + wave.fighters + wave.aces, 0));
  assert.equal(level.score, level.killCount * 100 + level.aceKillCount * 150);
  const result = world.ui.callsTo('showMissionResult').at(-1).args[0];
  assert.equal(result.outcome, 'victory');
  assert.match(result.message, /Perfect defense bonus/);
  assert.equal(result.stats.find((stat) => stat.label === 'Score').value, String(level.score + 500));

  world.clearEntities();
  assert.equal(bodyCount(world), 0, 'all jet physics bodies are released');
});

test('Operation Retake plays its ending and credits before showing the campaign result', async () => {
  const world = await createTestWorld();
  const result = {
    outcome: 'victory',
    title: 'AIRSPACE SECURE',
    message: 'The battleship survived all three waves.',
    stats: [{ label: 'Score', value: '1200' }]
  };
  const level = Object.create(Level01.prototype);
  Object.assign(level, {
    gameWorld: world,
    playerJet: { isDevSuspended: false },
    state: 'playing',
    _endingResult: null,
    _endingTimer: 0,
    _creditsTimer: 0
  });

  level._beginCampaignEnding(result);
  assert.equal(level.state, 'ending');
  assert.equal(world.isPaused, false, 'the ending can advance');
  assert.equal(level.playerJet.isDevSuspended, true, 'flight controls are disabled during the ending');
  assert.equal(world.ui.callsTo('showCinematic').at(-1).args[0], 'AIRSPACE SECURE');

  level._updateCampaignEnding(CAMPAIGN_ENDING.cinematicSeconds + 0.1);
  assert.equal(level.state, 'credits');
  assert.deepEqual(world.ui.callsTo('showCredits').at(-1).args[0], CAMPAIGN_CREDITS);
  assert.equal(world.ui.callsTo('showMissionResult').length, 0, 'the campaign result waits until after credits');

  world.input.press('skipCutscene');
  level._updateCampaignEnding(CAMPAIGN_ENDING.skipAfterSeconds + 0.1);
  assert.equal(level.state, 'won');
  assert.equal(world.isPaused, true);
  const campaignResult = world.ui.callsTo('showMissionResult').at(-1).args[0];
  assert.equal(campaignResult.title, 'OPERATION RETAKE COMPLETE');
  assert.deepEqual(campaignResult.stats, result.stats);
  assert.equal(campaignResult.actions[0].label, 'Play again');
  world.physics.dispose();
});

test('a destroyed battleship ends the jet defense mission as a defeat', async () => {
  const world = await createTestWorld();
  const level = new JetDefenseMission(world, {
    mesh: new THREE.Group(),
    health: { currentHealth: 0, maxHealth: 1000 },
    isDestroyed: true
  });
  level.playerJet = { isDestroyed: false };
  level.state = 'combat';

  level.update(0.1);

  assert.equal(level.state, 'lost');
  assert.equal(world.isPaused, true);
  const result = world.ui.callsTo('showMissionResult').at(-1).args[0];
  assert.equal(result.outcome, 'defeat');
  assert.match(result.message, /battleship has been destroyed/i);

  world.physics.dispose();
});

test('Operation Retake launches jet defense from the marked deck point', async () => {
  const world = await createTestWorld();
  const battleship = { mesh: new THREE.Group(), health: { currentHealth: 1000, maxHealth: 1000 } };
  battleship.mesh.rotation.y = 0.6;
  const launchPositionLocal = new THREE.Vector3(0.46, 5.55, 38);
  battleship.mesh.updateMatrixWorld(true);
  const playerPosition = battleship.mesh.localToWorld(launchPositionLocal.clone());
  const player = {
    position: playerPosition,
    isMounted: false,
    isDevSuspended: false
  };
  const level = Object.create(Level01.prototype);
  Object.assign(level, {
    gameWorld: world,
    battleship,
    player,
    playerJet: null,
    defenseMission: null,
    preflightJets: new Set(),
    preflightKillCount: 0,
    preflightDefenseComplete: false,
    _preflightTimer: 0,
    _preflightStarted: true,
    launchPositionLocal,
    _launchPositionWorld: new THREE.Vector3(),
    launchRadius: 5,
    cameraMode: 'PLAYER'
  });
  world.input.describeActions = (actions) => actions.join(', ');
  world.input.press('specialAction');
  world.addEntity(player);

  level._updateJetLaunch();
  assert.equal(level.player, player, 'jet launch remains locked before ship defense is complete');
  assert.equal(level.playerJet, null);

  level.preflightJets = new Set(
    Array.from({ length: config.enemyJet.preflightDefense.fighters }, (_, index) => {
      const enemy = new EnemyJet(world, { variant: 'fighter' });
      enemy.onDestroyed = (jet) => level._onPreflightEnemyDestroyed(jet);
      level.preflightJets.add(enemy);
      world.addEntity(enemy);
      return enemy;
    })
  );
  for (const enemy of level.preflightJets) enemy.health.takeDamage(enemy.health.maxHealth);
  assert.equal(level.preflightDefenseComplete, true, 'destroying the incoming group completes ship defense');

  level._updateJetLaunch();

  assert.equal(level.player, null, 'the on-foot player is removed when launching');
  assert.ok(level.playerJet, 'a player jet is created');
  assert.equal(level.defenseMission.state, 'incoming');
  assert.equal(world.entities.has(level.playerJet), true);
  assert.ok(Math.abs(level.playerJet.mesh.rotation.y - battleship.mesh.rotation.y) < 0.001);

  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('preflight defense spawns hostile jets after its warning delay', async () => {
  const world = await createTestWorld();
  const battleship = { mesh: new THREE.Group(), faction: 'humans' };
  const level = Object.create(Level01.prototype);
  Object.assign(level, {
    gameWorld: world,
    battleship,
    player: { isMounted: false },
    playerJet: null,
    defenseMission: null,
    preflightJets: new Set(),
    preflightKillCount: 0,
    preflightDefenseComplete: false,
    _preflightTimer: config.enemyJet.preflightDefense.firstWaveDelaySeconds,
    _preflightStarted: false
  });

  level._updatePreflightDefense(config.enemyJet.preflightDefense.firstWaveDelaySeconds - 1);
  assert.equal(level.preflightJets.size, 0, 'the warning delay gives the player time to man the gun');
  level._updatePreflightDefense(1.1);

  assert.equal(level.preflightJets.size, config.enemyJet.preflightDefense.fighters);
  assert.ok([...level.preflightJets].every((enemy) => enemy.target === battleship));
  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('sustained aimed aft-flak fire destroys a preflight fighter', async () => {
  const world = await createTestWorld();
  const pool = new ProjectilePool(world);
  world.addEntity(pool);
  world.projectilePool = pool;

  const level = Object.create(Level01.prototype);
  Object.assign(level, {
    gameWorld: world,
    preflightJets: new Set(),
    preflightKillCount: 0,
    preflightDefenseComplete: false
  });
  const enemy = new EnemyJet(world, {
    position: new THREE.Vector3(0, 0.48, -50),
    maxHealth: config.enemyJet.preflightDefense.fighterHealth,
    onDestroyed: (jet) => level._onPreflightEnemyDestroyed(jet)
  });
  level.preflightJets.add(enemy);
  world.addEntity(enemy);

  const turret = new FlakTurret({ gameWorld: world, faction: 'humans' });
  turret.pitchGroup = turret.mesh;
  world.entitiesGroup.add(turret.mesh);
  turret.setAim(0, -0.11);
  world.entitiesGroup.updateMatrixWorld(true);
  turret.mesh.updateMatrixWorld(true);
  assert.equal(turret.faction, 'humans');

  let roundsFired = 0;
  while (!enemy.isDestroyed && roundsFired < 12) {
    turret._fireWeapon();
    roundsFired++;
    for (let frame = 0; frame < 5; frame++) {
      world.physics.step(1 / 60);
      pool.gameplayUpdate(1 / 60, world);
    }
  }

  assert.equal(enemy.health.currentHealth, 0);
  assert.equal(enemy.isDestroyed, true);
  assert.ok(roundsFired <= 12, `sustained aimed fire destroys the fighter within one second (${roundsFired} rounds)`);
  assert.equal(level.preflightKillCount, 1);
  assert.equal(level.preflightDefenseComplete, false, 'the second fighter must still be destroyed');

  turret.dispose();
  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('ship stations inherit their vessel faction unless explicitly overridden', async () => {
  const world = await createTestWorld();
  const inheritedFactionTurret = new FlakTurret({
    gameWorld: world,
    battleship: { faction: 'aliens' }
  });
  const overriddenFactionTurret = new FlakTurret({
    gameWorld: world,
    battleship: { faction: 'aliens' },
    faction: 'humans'
  });

  assert.equal(inheritedFactionTurret.faction, 'aliens');
  assert.equal(overriddenFactionTurret.faction, 'humans');

  inheritedFactionTurret.dispose();
  overriddenFactionTurret.dispose();
  world.physics.dispose();
});

test('ace enemy jets have distinct colors and stronger combat tuning', async () => {
  const world = await createTestWorld();
  const fighter = new EnemyJet(world, { variant: 'fighter' });
  const ace = new EnemyJet(world, { variant: 'ace' });

  assert.ok(ace.speed > fighter.speed);
  assert.ok(ace.turnRate > fighter.turnRate);
  assert.ok(ace.health.maxHealth > fighter.health.maxHealth);
  assert.ok(ace.fireCadence < fighter.fireCadence);

  fighter.dispose();
  ace.dispose();
  assert.equal(bodyCount(world), 0);
  world.physics.dispose();
});
