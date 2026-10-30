import * as THREE from 'three';
import { EnemyJetPool } from './EnemyJetPool.js';
import config from '../../config.json';

const FORWARD = new THREE.Vector3(0, 0, 1);
const GOLDEN_ANGLE = 2.399963229728653;

/**
 * EnemyJetManager
 * Wave director for enemy jet assaults: owns the full lifecycle of waves of
 * pooled EnemyJets — staggered spawning, kill tracking, intermissions, and
 * pool recycling. The jet counterpart to EnemyBattleshipManager.
 *
 * Wave doctrine (config.enemyJet.assault): two waves of 5 + 8 = 13 aircraft
 * spawning on a golden-angle spiral around the battleship.
 *
 * Lifecycle: ready -> incoming -> combat <-> intermission -> won | lost
 *
 * Not an entity: the owning level drives update(delta) from gameplayUpdate
 * (Phase 5) and disposes the manager on level teardown. Jets themselves are
 * full GameWorld entities hooked into the 8-phase pipeline.
 */
export class EnemyJetManager {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {Battleship} options.battleship - Warship to defend (primary target + defeat condition)
   * @param {PlayerJet} [options.playerJet] - Player aircraft (defeat condition when shot down)
   * @param {EnemyJetPool} [options.pool] - Defaults to an internally owned pool
   * @param {Function} [options.onVictory] - Receives result DTO; default shows mission result
   * @param {Function} [options.onDefeat] - Receives result DTO; default shows mission result
   */
  constructor(gameWorld, { battleship, playerJet = null, pool = null, onVictory = null, onDefeat = null } = {}) {
    this.gameWorld = gameWorld;
    this.battleship = battleship;
    this.playerJet = playerJet;
    this.pool = pool ?? new EnemyJetPool(gameWorld);
    this.onVictory = onVictory;
    this.onDefeat = onDefeat;

    const assaultCfg = (config.enemyJet && config.enemyJet.assault) || {};
    this.firstWaveDelaySeconds = assaultCfg.firstWaveDelaySeconds ?? 3;
    this.betweenWavesSeconds = assaultCfg.betweenWavesSeconds ?? 8;
    this.spawnIntervalSeconds = assaultCfg.spawnIntervalSeconds ?? 4;
    this.spawnRadius = assaultCfg.spawnRadius ?? 420;
    this.spawnAltitude = assaultCfg.spawnAltitude ?? 85;
    this.waves = assaultCfg.waves || [
      { fighters: 5, aces: 0 },
      { fighters: 8, aces: 0 }
    ];

    this.state = 'ready';
    this.elapsed = 0;
    this.killCount = 0;
    this.aceKillCount = 0;
    this.score = 0;
    this._waveIndex = 0;
    this._spawnQueue = [];
    this._spawnTimer = 0;
    this._waveTimer = 0;
    this.jets = new Set();
    this._waveJets = [];
    this._spawnAngle = 0;
    this._spawnPos = new THREE.Vector3();
    this._headingDir = new THREE.Vector3();
  }

  /** Total hostile count across all waves (5 + 8 = 13 by default config). */
  get totalHostiles() {
    return this.waves.reduce((sum, wave) => sum + wave.fighters + wave.aces, 0);
  }

  start(playerJet = null) {
    if (this.state !== 'ready') return;
    if (playerJet) this.playerJet = playerJet;
    // Pre-build the largest wave per variant so staggered spawning never hitches.
    for (const wave of this.waves) {
      this.pool.ensure('fighter', wave.fighters);
      this.pool.ensure('ace', wave.aces);
    }
    this.state = 'incoming';
    this._waveTimer = this.firstWaveDelaySeconds;
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showObjective(
        'DEFEND THE BATTLESHIP',
        `Stop the enemy air assault. First wave in ${Math.ceil(this._waveTimer)}s.`
      );
      this.gameWorld.ui.showToast('Enemy aircraft are inbound. Protect the battleship!', 'warning', 4000);
    }
  }

  update(delta) {
    if (this.state === 'ready' || this.state === 'won' || this.state === 'lost') return;
    this.elapsed += delta;

    if (this.battleship?.isDestroyed) {
      this._finish(false, 'The battleship has been destroyed.');
      return;
    }
    if (this.playerJet?.isDestroyed) {
      this._finish(false, 'Your jet was shot down.');
      return;
    }

    if (this.state === 'incoming') {
      this._waveTimer -= delta;
      if (this._waveTimer <= 0) this._startWave();
    } else if (this.state === 'combat') {
      if (this._spawnQueue.length > 0) {
        this._spawnTimer -= delta;
        if (this._spawnTimer <= 0) {
          this._spawnNext(this._spawnQueue.shift());
          this._spawnTimer = this.spawnIntervalSeconds;
        }
      }

      const waveCleared = this._spawnQueue.length === 0 && this._waveJets.every((jet) => jet.isDestroyed);
      if (waveCleared) {
        if (this._waveIndex === this.waves.length - 1) {
          this._finish(true, 'Enemy air assault repelled.');
          return;
        }
        this.state = 'intermission';
        this._waveTimer = this.betweenWavesSeconds;
        this._waveIndex++;
      }
    } else if (this.state === 'intermission') {
      this._waveTimer -= delta;
      if (this._waveTimer <= 0) this._startWave();
    }

    this._updateObjective();
  }

  _startWave() {
    const wave = this.waves[this._waveIndex];
    this._spawnQueue = [
      ...Array(wave.fighters).fill('fighter'),
      ...Array(wave.aces).fill('ace')
    ];
    this._spawnTimer = 0;
    this._waveJets = [];
    this.state = 'combat';
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showToast(
        `Wave ${this._waveIndex + 1} of ${this.waves.length}: ${this._spawnQueue.length} enemy aircraft inbound!`,
        'danger',
        3500
      );
    }
  }

  /**
   * Lease a jet from the pool on a golden-angle spiral around the battleship
   * (varied bearings each spawn) and launch it facing its target.
   */
  _spawnNext(variant) {
    this._spawnAngle += GOLDEN_ANGLE;
    const anchor = this.battleship.mesh.position;
    this._spawnPos.set(
      anchor.x + Math.sin(this._spawnAngle) * this.spawnRadius,
      anchor.y + this.spawnAltitude,
      anchor.z + Math.cos(this._spawnAngle) * this.spawnRadius
    );

    const jet = this.pool.acquire(variant, {
      position: this._spawnPos,
      target: this.battleship,
      onDestroyed: (j) => this._onJetDestroyed(j)
    });
    this._headingDir.copy(this.battleship.mesh.position).sub(this._spawnPos).normalize();
    jet.mesh.quaternion.setFromUnitVectors(FORWARD, this._headingDir);

    this.jets.add(jet);
    this._waveJets.push(jet);
    this.gameWorld.addEntity(jet);
  }

  /**
   * Kill bookkeeping + instant pool recycling. Jets tear down their physics at
   * death, so recycling is immediate — no battleship-style hulk timer.
   */
  _onJetDestroyed(jet) {
    this.killCount++;
    if (jet.variant === 'ace') {
      this.aceKillCount++;
      this.score += 250;
    } else {
      this.score += 100;
    }
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showToast(
        jet.variant === 'ace' ? 'Enemy ace destroyed! +250' : 'Enemy fighter destroyed! +100',
        'success',
        1600
      );
    }
    this.jets.delete(jet);
    // Retire first: GameWorld.removeEntity invokes dispose(), which no-ops
    // once the jet is marked pooled, protecting the model the pool owns.
    this.pool.release(jet);
    this.gameWorld.removeEntity(jet);
  }

  _updateObjective() {
    if (!this.gameWorld.ui) return;
    const waves = this.waves;
    const alive = [...this.jets].filter((jet) => !jet.isDestroyed).length;
    const remaining = this._spawnQueue.length + alive;
    const title = this.state === 'intermission'
      ? `WAVE ${this._waveIndex + 1} INCOMING`
      : `DEFEND THE BATTLESHIP — WAVE ${this._waveIndex + 1}/${waves.length}`;
    const detail = this.state === 'intermission'
      ? `Regroup — next wave in ${Math.ceil(this._waveTimer)}s`
      : `Hostiles: ${remaining}  |  Score: ${this.score}  |  Battleship: ${Math.ceil((this.battleship.health.currentHealth / this.battleship.health.maxHealth) * 100)}%`;
    this.gameWorld.ui.showObjective(title, detail);
  }

  _finish(victory, message) {
    if (this.state === 'won' || this.state === 'lost') return;
    this.state = victory ? 'won' : 'lost';

    const perfectDefense = victory && this.battleship.health.currentHealth === this.battleship.health.maxHealth;
    const finalScore = this.score + (perfectDefense ? 500 : 0);
    const minutes = Math.floor(this.elapsed / 60);
    const seconds = Math.floor(this.elapsed % 60).toString().padStart(2, '0');
    const result = {
      outcome: victory ? 'victory' : 'defeat',
      title: victory ? 'AIRSPACE SECURE' : 'DEFENSE FAILED',
      message: perfectDefense ? `${message} Perfect defense bonus: +500.` : message,
      stats: [
        { label: 'Time', value: `${minutes}:${seconds}` },
        { label: 'Enemy aircraft destroyed', value: String(this.killCount) },
        { label: 'Enemy aces destroyed', value: String(this.aceKillCount) },
        { label: 'Battleship hull', value: `${Math.ceil(this.battleship.health.currentHealth)} / ${this.battleship.health.maxHealth}` },
        { label: 'Score', value: String(finalScore) }
      ],
      actions: [
        { label: 'Retry', onClick: () => this.gameWorld.restartCurrentLevel() },
        { label: 'Main menu', onClick: () => this.gameWorld.returnToMainMenu() }
      ]
    };

    const callback = victory ? this.onVictory : this.onDefeat;
    if (callback) {
      callback(result);
      return;
    }

    this.gameWorld.input.exitPointerLock();
    this.gameWorld.ui.hideObjective();
    this.gameWorld.isPaused = true;
    this.gameWorld.ui.showMissionResult(result);
  }

  dispose() {
    this.jets.clear();
    this._waveJets = [];
    this._spawnQueue = [];
    this.battleship = null;
    this.playerJet = null;
    this.onVictory = null;
    this.onDefeat = null;
    this.pool.dispose();
  }
}
