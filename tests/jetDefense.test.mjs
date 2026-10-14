import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Level01JetTestLevel } from '../src/levels/Level01JetTestLevel.js';
import { EnemyJet } from '../src/entities/enemies/EnemyJet.js';
import { PlayerJet } from '../src/entities/player-jet/PlayerJet.js';
import { ProjectilePool } from '../src/entities/ProjectilePool.js';
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

  const level = Object.create(Level01JetTestLevel.prototype);
  Object.assign(level, {
    gameWorld: world,
    battleship,
    playerJet,
    enemyJets: new Set(),
    state: 'ready',
    elapsed: 0,
    killCount: 0,
    aceKillCount: 0,
    score: 0,
    _waveIndex: 0,
    _spawnQueue: [],
    _spawnTimer: 0,
    _waveTimer: 0
  });
  world.currentLevel = level;
  level._beginDefenseMission();

  for (let waveIndex = 0; waveIndex < config.enemyJet.waves.length; waveIndex++) {
    if (waveIndex > 0) level._updateDefenseMission(config.enemyJet.defense.betweenWavesSeconds + 0.1);
    else {
      level._waveTimer = 0;
      level._updateDefenseMission(0.1);
    }

    const wave = config.enemyJet.waves[waveIndex];
    const waveSize = wave.fighters + wave.aces;
    for (let spawned = 0; spawned < waveSize; spawned++) {
      level._spawnTimer = 0;
      level._updateDefenseMission(0.01);
    }

    const livingJets = [...level.enemyJets].filter((enemy) => !enemy.isDestroyed);
    assert.equal(livingJets.length, waveSize, `wave ${waveIndex + 1} spawns the configured aircraft`);
    assert.ok(livingJets.every((enemy) => enemy.target === battleship), 'enemy jets attack the ship');
    if (wave.aces > 0) {
      assert.ok(livingJets.some((enemy) => enemy.variant === 'ace'), 'later waves include ace opponents');
    }
    for (const enemy of livingJets) enemy.health.takeDamage(enemy.health.maxHealth);
    level._updateDefenseMission(0.01);
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

test('a destroyed battleship ends the jet defense mission as a defeat', async () => {
  const world = await createTestWorld();
  const level = Object.create(Level01JetTestLevel.prototype);
  Object.assign(level, {
    gameWorld: world,
    battleship: {
      mesh: new THREE.Group(),
      health: { currentHealth: 0, maxHealth: 1000 },
      isDestroyed: true
    },
    playerJet: { isDestroyed: false },
    enemyJets: new Set(),
    state: 'combat',
    elapsed: 0,
    killCount: 0,
    aceKillCount: 0,
    score: 0,
    _waveIndex: 0,
    _spawnQueue: [],
    _spawnTimer: 0,
    _waveTimer: 0
  });

  level._updateDefenseMission(0.1);

  assert.equal(level.state, 'lost');
  assert.equal(world.isPaused, true);
  const result = world.ui.callsTo('showMissionResult').at(-1).args[0];
  assert.equal(result.outcome, 'defeat');
  assert.match(result.message, /battleship has been destroyed/i);

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
