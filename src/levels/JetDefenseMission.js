import * as THREE from 'three';
import { EnemyJet } from '../entities/enemies/EnemyJet.js';
import config from '../config.json';

export class JetDefenseMission {
  constructor(gameWorld, battleship, { onVictory = null } = {}) {
    this.gameWorld = gameWorld;
    this.battleship = battleship;
    this.onVictory = onVictory;
    this.playerJet = null;
    this.enemyJets = new Set();
    this.state = 'ready';
    this.elapsed = 0;
    this.killCount = 0;
    this.aceKillCount = 0;
    this.score = 0;
    this._waveIndex = 0;
    this._spawnQueue = [];
    this._spawnTimer = 0;
    this._waveTimer = 0;
  }

  start(playerJet) {
    if (this.state !== 'ready') return;
    this.playerJet = playerJet;
    this.state = 'incoming';
    this._waveTimer = config.enemyJet.defense.firstWaveDelaySeconds;
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showObjective(
        'DEFEND THE BATTLESHIP',
        `Stop three waves of enemy aircraft. First wave in ${Math.ceil(this._waveTimer)}s.`
      );
      this.gameWorld.ui.showToast('Enemy aircraft are inbound. Protect the battleship!', 'warning', 4000);
    }
  }

  update(delta) {
    if (this.state === 'won' || this.state === 'lost' || this.state === 'ready') return;
    this.elapsed += delta;

    if (this.playerJet?.isDestroyed) {
      this._finish(false, 'Your jet was shot down.');
      return;
    }
    if (this.battleship?.isDestroyed) {
      this._finish(false, 'The battleship has been destroyed.');
      return;
    }

    if (this.state === 'incoming') {
      this._waveTimer -= delta;
      if (this._waveTimer <= 0) this._startWave();
    } else if (this.state === 'combat') {
      if (this._spawnQueue.length > 0) {
        this._spawnTimer -= delta;
        if (this._spawnTimer <= 0) {
          this._spawnEnemyJet(this._spawnQueue.shift());
          this._spawnTimer = config.enemyJet.defense.spawnIntervalSeconds;
        }
      }

      const alive = [...this.enemyJets].filter((enemy) => !enemy.isDestroyed).length;
      if (this._spawnQueue.length === 0 && alive === 0) {
        if (this._waveIndex === config.enemyJet.waves.length - 1) {
          this._finish(true, 'The battleship survived all three waves.');
          return;
        }
        this.state = 'intermission';
        this._waveTimer = config.enemyJet.defense.betweenWavesSeconds;
        this._waveIndex++;
      }
    } else if (this.state === 'intermission') {
      this._waveTimer -= delta;
      if (this._waveTimer <= 0) this._startWave();
    }

    this._updateObjective();
  }

  _startWave() {
    const wave = config.enemyJet.waves[this._waveIndex];
    this._spawnQueue = [
      ...Array(wave.fighters).fill('fighter'),
      ...Array(wave.aces).fill('ace')
    ];
    this._spawnTimer = 0;
    this.state = 'combat';
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showToast(
        `Wave ${this._waveIndex + 1} of ${config.enemyJet.waves.length}: ${this._spawnQueue.length} enemy aircraft inbound!`,
        'danger',
        3500
      );
    }
  }

  _spawnEnemyJet(variant) {
    const defense = config.enemyJet.defense;
    const angle = this.enemyJets.size * 2.399963229728653;
    const position = new THREE.Vector3(
      this.battleship.mesh.position.x + Math.sin(angle) * defense.spawnRadius,
      this.battleship.mesh.position.y + defense.spawnAltitude,
      this.battleship.mesh.position.z + Math.cos(angle) * defense.spawnRadius
    );
    const enemy = new EnemyJet(this.gameWorld, {
      position,
      target: this.battleship,
      variant,
      onDestroyed: (jet) => {
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
      }
    });
    this.enemyJets.add(enemy);
    this.gameWorld.addEntity(enemy);
  }

  _updateObjective() {
    const remaining = this._spawnQueue.length + [...this.enemyJets].filter((enemy) => !enemy.isDestroyed).length;
    const waves = config.enemyJet.waves;
    const title = this.state === 'intermission'
      ? `WAVE ${this._waveIndex + 1} INCOMING`
      : `DEFEND THE BATTLESHIP — WAVE ${this._waveIndex + 1}/${waves.length}`;
    const detail = this.state === 'intermission'
      ? `Regroup — next wave in ${Math.ceil(this._waveTimer)}s`
      : `Hostiles: ${remaining}  |  Score: ${this.score}  |  Battleship: ${Math.ceil((this.battleship.health.currentHealth / this.battleship.health.maxHealth) * 100)}%`;
    if (this.gameWorld.ui) this.gameWorld.ui.showObjective(title, detail);
  }

  _finish(victory, message) {
    if (this.state === 'won' || this.state === 'lost') return;
    this.state = victory ? 'won' : 'lost';
    this.gameWorld.input.exitPointerLock();

    const ui = this.gameWorld.ui;
    if (!ui) return;
    ui.hideObjective();
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
    if (victory && this.onVictory) {
      this.onVictory(result);
      return;
    }

    this.gameWorld.isPaused = true;
    ui.showMissionResult(result);
  }

  dispose() {
    this.playerJet = null;
    this.enemyJets.clear();
    this.onVictory = null;
  }
}
