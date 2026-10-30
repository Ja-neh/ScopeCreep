import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EnemyJetManager } from '../src/entities/enemies/EnemyJetManager.js';
import { EnemyJet, JetAIState } from '../src/entities/enemies/EnemyJet.js';
import { PlayerJet } from '../src/entities/player-jet/PlayerJet.js';
import { ProjectilePool } from '../src/entities/ProjectilePool.js';
import { FlakTurret } from '../src/entities/ship-components/FlakTurret.js';
import { Level01 } from '../src/levels/Level01.js';
import { CAMPAIGN_CREDITS, CAMPAIGN_ENDING } from '../src/levels/level01/ending.js';
import { createTestWorld, bodyCount } from './support/testWorld.mjs';
import config from '../src/config.json';

const assaultCfg = config.enemyJet.assault;

function makeBattleship() {
  const mesh = new THREE.Group();
  return {
    mesh,
    health: { currentHealth: 1000, maxHealth: 1000 },
    isDestroyed: false,
    faction: 'humans'
  };
}

/** Spawns `count` queued jets instantly (combat state required). */
function spawnQueued(manager, count) {
  for (let i = 0; i < count; i++) {
    manager._spawnTimer = 0;
    manager.update(0.01);
  }
}

function sinkWaveJets(manager) {
  for (const jet of manager._waveJets) {
    jet.health.takeDamage({ amount: jet.health.maxHealth + 1, type: 'KINETIC' });
  }
}

function assertOnSpawnRing(jet, battleship) {
  const p = jet.mesh.position;
  const b = battleship.mesh.position;
  const horizontal = Math.hypot(p.x - b.x, p.z - b.z);
  assert.ok(Math.abs(horizontal - assaultCfg.spawnRadius) < 1, `spawn sits on the configured radius (${horizontal.toFixed(1)}m)`);
  assert.ok(Math.abs(p.y - (b.y + assaultCfg.spawnAltitude)) < 1e-6, 'spawn sits at the configured altitude');
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(jet.mesh.quaternion);
  const toBattleship = new THREE.Vector3(b.x - p.x, b.y - p.y, b.z - p.z).normalize();
  assert.ok(forward.dot(toBattleship) > 0.99, 'spawn faces its target');
}

test('jet assault runs 2 waves (5 then 8) from the pool, wins, and reports the result', async () => {
  const world = await createTestWorld();
  const pool = new ProjectilePool(world);
  world.addEntity(pool);
  world.projectilePool = pool;

  const battleship = makeBattleship();
  const playerJet = new PlayerJet(world);
  world.addEntity(playerJet);
  world.currentLevel = { battleship, playerJet };
  world.isPaused = false;

  let victoryResult = null;
  const manager = new EnemyJetManager(world, {
    battleship,
    onVictory: (result) => { victoryResult = result; }
  });
  manager.start(playerJet);
  assert.equal(manager.totalHostiles, 13, 'default doctrine totals 13 jets');
  assert.equal(manager.pool.spareCount('fighter'), 8, 'the largest wave is pre-built in the pool');

  // Wave 1: five fighters.
  manager.update(assaultCfg.firstWaveDelaySeconds + 0.1);
  assert.equal(manager.state, 'combat', 'wave 1 is in combat');
  spawnQueued(manager, 5);
  assert.equal(manager._waveJets.length, 5, 'wave 1 spawns its configured count');
  assert.equal(manager.pool.spareCount('fighter'), 3, 'five of the eight spares are leased');
  assert.ok(manager._waveJets.every((jet) => jet.target === battleship), 'every jet hunts the battleship');
  assert.ok(manager._waveJets.every((jet) => jet.brain.is(JetAIState.APPROACH)), 'every jet starts in APPROACH');
  for (const jet of manager._waveJets) assertOnSpawnRing(jet, battleship);

  const wave1Jets = [...manager._waveJets];
  sinkWaveJets(manager);
  assert.equal(manager.killCount, 5, 'wave 1 kills counted');
  assert.equal(manager.jets.size, 0, 'destroyed jets leave the active set');
  manager.update(0.01);
  assert.equal(manager.state, 'intermission', 'wave 1 cleared into intermission');

  // Wave 2: eight fighters, leased from the same pool instances.
  manager.update(assaultCfg.betweenWavesSeconds + 0.1);
  assert.equal(manager.state, 'combat', 'wave 2 is in combat');
  spawnQueued(manager, 8);
  assert.equal(manager._waveJets.length, 8, 'wave 2 spawns its configured count');
  assert.equal(manager.pool.spareCount('fighter'), 0, 'every spare is leased during the larger wave');
  assert.ok(
    manager._waveJets.some((jet) => wave1Jets.includes(jet)),
    'wave 2 recycles wave 1 instances from the pool'
  );
  assert.equal(
    new Set([...wave1Jets, ...manager._waveJets]).size,
    8,
    'both waves are served by the eight pre-built spares — no jet is constructed at spawn time'
  );
  for (const jet of manager._waveJets) assertOnSpawnRing(jet, battleship);

  sinkWaveJets(manager);
  manager.update(0.01);

  assert.equal(manager.state, 'won', 'destroying all 13 jets wins the assault');
  assert.equal(manager.killCount, 13, 'every kill counted exactly once');
  assert.equal(manager.score, 1300, 'thirteen fighters at 100 points each');
  assert.ok(victoryResult, 'onVictory override receives the result instead of the mission-result screen');
  assert.equal(victoryResult.outcome, 'victory');
  assert.equal(world.ui.callsTo('showMissionResult').length, 0, 'override suppresses the default result screen');
  assert.equal(world.isPaused, false, 'override leaves pause control to the level');
  assert.equal(victoryResult.stats.find((stat) => stat.label === 'Score').value, '1800', 'perfect defense bonus applied');
  assert.match(victoryResult.message, /Perfect defense bonus/);

  assert.equal(manager.pool.spareCount('fighter'), 8, 'every jet is back in the pool after the win');

  world.clearEntities();
  manager.dispose();
  assert.equal(bodyCount(world), 0, 'clean teardown without dangling physics bodies');
});

test('jet assault spawns are staggered by the configured interval', async () => {
  const world = await createTestWorld();
  const battleship = makeBattleship();
  const manager = new EnemyJetManager(world, { battleship });
  manager.start();

  manager.update(assaultCfg.firstWaveDelaySeconds + 0.1);
  spawnQueued(manager, 1);
  assert.equal(manager.jets.size, 1, 'the first jet spawns immediately');

  manager.update(assaultCfg.spawnIntervalSeconds - 0.1);
  assert.equal(manager.jets.size, 1, 'no second jet before the interval elapses');
  manager.update(0.2);
  assert.equal(manager.jets.size, 2, 'the second jet spawns once the interval elapses');

  manager.dispose();
  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('a destroyed battleship loses the assault through the default result screen', async () => {
  const world = await createTestWorld();
  const battleship = makeBattleship();
  const manager = new EnemyJetManager(world, { battleship });
  manager.start();

  manager.update(assaultCfg.firstWaveDelaySeconds + 0.1);
  spawnQueued(manager, 2);
  battleship.isDestroyed = true;
  battleship.health.currentHealth = 0;
  manager.update(0.01);

  assert.equal(manager.state, 'lost');
  assert.equal(world.isPaused, true);
  const result = world.ui.callsTo('showMissionResult').at(-1).args[0];
  assert.equal(result.outcome, 'defeat');
  assert.match(result.message, /battleship has been destroyed/i);

  manager.dispose();
  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('a shot-down player jet loses the assault', async () => {
  const world = await createTestWorld();
  const battleship = makeBattleship();
  const playerJet = new PlayerJet(world);
  world.addEntity(playerJet);

  let defeatResult = null;
  const manager = new EnemyJetManager(world, { battleship, onDefeat: (result) => { defeatResult = result; } });
  manager.start(playerJet);

  playerJet.health.takeDamage({ amount: playerJet.health.maxHealth, type: 'KINETIC' });
  manager.update(0.01);

  assert.equal(manager.state, 'lost');
  assert.equal(defeatResult.outcome, 'defeat');
  assert.equal(defeatResult.title, 'DEFENSE FAILED');
  assert.match(defeatResult.message, /shot down/i);
  assert.equal(world.ui.callsTo('showMissionResult').length, 0, 'override suppresses the default result screen');

  manager.dispose();
  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('Operation Retake plays its ending and credits before showing the campaign result', async () => {
  const world = await createTestWorld();
  const result = {
    outcome: 'victory',
    title: 'AIRSPACE SECURE',
    message: 'Enemy air assault repelled.',
    stats: [{ label: 'Score', value: '1800' }]
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
  level.defenseMission.dispose();
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
