import * as THREE from 'three';
import { EnemyBattleship, BattleshipAIState } from './EnemyBattleship.js';
import config from '../../config.json';

/**
 * EnemyBattleshipManager
 * Fleet assault director that owns the full lifecycle of waves of AI enemy
 * battleships: staggered async spawning, kill tracking, intermissions, and
 * recycling of sunken hulks (Rapier collider recovery).
 *
 * Wave doctrine (config.enemyBattleship.assault):
 * - Wave 1 (5 ships) rings the island offshore, each hull placed on the actual
 *   coast via the signed-distance field, and sails to the player
 * - Wave 2 (10 ships) spawns in a fan across the seaward map edges
 *
 * Lifecycle (mirrors EnemyJetManager):
 *   ready -> incoming -> combat <-> intermission -> won | lost
 *
 * Not an entity: the owning level drives update(delta) from gameplayUpdate
 * (Phase 5) and disposes the manager on level teardown. Ships themselves are
 * full GameWorld entities hooked into the 8-phase pipeline.
 */
export class EnemyBattleshipManager {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {Battleship} options.battleship - Player warship (target + defeat condition)
   * @param {Ocean} [options.water] - Ocean surface for wave buoyancy
   * @param {THREE.Vector3} [options.islandAnchor] - Island centre: ring origin and
   *   reference for seaward edge bearings
   * @param {Object} [options.island] - Signed-distance field `{ inland(x, z) }`
   *   (meters inland of the waterline, negative at sea). Forwarded to every
   *   ship for coast avoidance; also validates spawn water. Null = open sea.
   * @param {Function} [options.onVictory] - Receives result DTO; default shows mission result
   * @param {Function} [options.onDefeat] - Receives result DTO; default shows mission result
   */
  constructor(gameWorld, { battleship, water = null, islandAnchor = null, island = null, onVictory = null, onDefeat = null } = {}) {
    this.gameWorld = gameWorld;
    this.battleship = battleship;
    this.water = water;
    this.island = island;
    this.islandAnchor = islandAnchor ? islandAnchor.clone() : new THREE.Vector3(0, 0, -600);
    this.onVictory = onVictory;
    this.onDefeat = onDefeat;

    const assaultCfg = (config.enemyBattleship && config.enemyBattleship.assault) || {};
    this.firstWaveDelaySeconds = assaultCfg.firstWaveDelaySeconds ?? 25;
    this.betweenWavesSeconds = assaultCfg.betweenWavesSeconds ?? 30;
    this.spawnIntervalSeconds = assaultCfg.spawnIntervalSeconds ?? 6;
    this.sinkCleanupSeconds = assaultCfg.sinkCleanupSeconds ?? 20;

    const islandCfg = assaultCfg.islandSpawn || {};
    this.islandRingSpreadRadians = (islandCfg.ringSpreadDegrees ?? 360) * Math.PI / 180;
    this.islandCoastStandoff = islandCfg.coastStandoff ?? 150;
    this.islandMinPlayerDistance = islandCfg.minPlayerDistance ?? 350;

    const edgeCfg = assaultCfg.edgeSpawn || {};
    this.edgeRadius = edgeCfg.radius ?? 850;
    this.edgeSpreadRadians = (edgeCfg.spreadDegrees ?? 150) * Math.PI / 180;
    this.edgeOceanClamp = edgeCfg.oceanClamp ?? 1200;

    this.waves = assaultCfg.waves || [
      { origin: 'island', count: 5 },
      { origin: 'edge', count: 10 }
    ];

    this.state = 'ready';
    this.elapsed = 0;
    this.killCount = 0;
    this._waveIndex = 0;
    this._waveTimer = 0;
    this._spawnQueue = 0;
    this._spawnTimer = 0;
    this._pendingSpawns = 0;
    this._waveShips = [];
    this._hulks = [];
    this.ships = new Set();

    // Scratchpads (zero heap allocation in update loops)
    this._spawnPos = new THREE.Vector3();
  }

  /** Total hostile count across all waves (5 + 10 = 15 by default config). */
  get totalHostiles() {
    return this.waves.reduce((sum, wave) => sum + wave.count, 0);
  }

  start() {
    if (this.state !== 'ready') return;
    this.state = 'incoming';
    this._waveTimer = this.firstWaveDelaySeconds;
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showObjective(
        'ENEMY FLEET INBOUND',
        `A hostile battleship task force is approaching. First wave in ${Math.ceil(this._waveTimer)}s.`
      );
      this.gameWorld.ui.showToast('Enemy battleships detected on the horizon. All hands to battle stations!', 'warning', 4000);
    }
  }

  update(delta) {
    if (this.state === 'ready') return;

    // Hulk recycling runs even after the battle is decided: a won battle
    // leaves the whole last wave sinking while the level continues.
    this._recycleHulks(delta);

    if (this.state === 'won' || this.state === 'lost') return;
    this.elapsed += delta;

    if (this.battleship?.isDestroyed) {
      this._finish(false, 'The battleship has been destroyed.');
      return;
    }

    if (this.state === 'incoming') {
      this._waveTimer -= delta;
      if (this._waveTimer <= 0) this._startWave();
    } else if (this.state === 'combat') {
      if (this._spawnQueue > 0) {
        this._spawnTimer -= delta;
        if (this._spawnTimer <= 0) {
          this._spawnNext();
          this._spawnQueue--;
          this._spawnTimer = this.spawnIntervalSeconds;
        }
      }

      this._trackKills();

      const waveCleared =
        this._spawnQueue === 0 &&
        this._pendingSpawns === 0 &&
        this._waveShips.every((ship) => ship.isDestroyed);
      if (waveCleared) {
        if (this._waveIndex === this.waves.length - 1) {
          this._finish(true, 'The enemy fleet has been sunk.');
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
    this._spawnQueue = wave.count;
    this._spawnTimer = 0;
    this._waveShips = [];
    this.state = 'combat';
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showToast(
        `Wave ${this._waveIndex + 1} of ${this.waves.length}: ${wave.count} enemy battleships inbound!`,
        'danger',
        3500
      );
    }
  }

  _spawnNext() {
    const wave = this.waves[this._waveIndex];
    const index = this._waveShips.length;
    this._computeSpawnPosition(wave, index, this._spawnPos);

    const ship = new EnemyBattleship(this.gameWorld, {
      position: this._spawnPos,
      water: this.water,
      target: this.battleship,
      island: this.island
    });
    ship.mesh.rotation.y = this._headingTowards(this._spawnPos, this.battleship.mesh.position);

    this._pendingSpawns++;
    ship.ready
      .then(() => {
        this._pendingSpawns--;
        this.gameWorld.addEntity(ship);
        ship.initPhysics(this.gameWorld.physics);
      })
      .catch((err) => {
        this._pendingSpawns--;
        console.error('[EnemyBattleshipManager] Ship failed to ready:', err);
      });

    this.ships.add(ship);
    this._waveShips.push(ship);
  }

  /**
   * Island wave: ring around the island, each hull placed on the real coast by
   * walking the SDF outward until `coastStandoff` meters of open water, never
   * closer than minPlayerDistance. Edge waves: fan across the seaward arc,
   * clamped to the ocean square and validated as open water by the SDF.
   */
  _computeSpawnPosition(wave, index, out) {
    const playerPos = this.battleship.mesh.position;
    const count = wave.count;

    if (wave.origin === 'island') {
      const c = this.islandAnchor;
      // Arc centred on the bearing from the island toward the player; a full
      // 360-degree ring steps around the circle instead of double-covering
      // the seam at +/-180 degrees.
      const centerAngle = Math.atan2(playerPos.x - c.x, -(playerPos.z - c.z));
      const frac = count > 1 ? index / (count - 1) : 0.5;
      const bearing = this.islandRingSpreadRadians >= Math.PI * 2 - 1e-6
        ? centerAngle + frac * Math.PI * 2
        : centerAngle + (frac - 0.5) * this.islandRingSpreadRadians;
      const dirX = -Math.sin(bearing);
      const dirZ = -Math.cos(bearing);

      const dist = this._coastDistance(c.x, c.z, dirX, dirZ);
      out.set(c.x + dirX * dist, 0, c.z + dirZ * dist);

      const pdx = out.x - playerPos.x;
      const pdz = out.z - playerPos.z;
      const distSq = pdx * pdx + pdz * pdz;
      if (distSq < this.islandMinPlayerDistance * this.islandMinPlayerDistance && distSq > 0.0001) {
        const distToPlayer = Math.sqrt(distSq);
        out.x = playerPos.x + (pdx / distToPlayer) * this.islandMinPlayerDistance;
        out.z = playerPos.z + (pdz / distToPlayer) * this.islandMinPlayerDistance;
      }
      return out;
    }

    const islandAngle = Math.atan2(
      this.islandAnchor.x - playerPos.x,
      -(this.islandAnchor.z - playerPos.z)
    );
    const center = islandAngle + Math.PI; // seaward, opposite the island
    const frac = count > 1 ? index / (count - 1) : 0.5;
    let bearing = center + (frac - 0.5) * this.edgeSpreadRadians;

    for (let attempt = 0; attempt < 8; attempt++) {
      out.set(
        playerPos.x - Math.sin(bearing) * this.edgeRadius,
        0,
        playerPos.z - Math.cos(bearing) * this.edgeRadius
      );
      out.x = THREE.MathUtils.clamp(out.x, -this.edgeOceanClamp, this.edgeOceanClamp);
      out.z = THREE.MathUtils.clamp(out.z, -this.edgeOceanClamp, this.edgeOceanClamp);

      if (!this.island || this.island.inland(out.x, out.z) <= -this.islandCoastStandoff) break;
      bearing += 0.3; // nudge along the arc until clear of the island
    }
    return out;
  }

  /**
   * Distance from (x, z) along (dirX, dirZ) at which the SDF reports
   * `coastStandoff` meters of open water. Falls back to a nominal 400m ring
   * when the level supplies no island field.
   */
  _coastDistance(x, z, dirX, dirZ) {
    if (!this.island) return 400;
    const step = 25;
    for (let t = step; t < 2000; t += step) {
      if (this.island.inland(x + dirX * t, z + dirZ * t) <= -this.islandCoastStandoff) {
        let lo = t - step;
        let hi = t;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          if (this.island.inland(x + dirX * mid, z + dirZ * mid) <= -this.islandCoastStandoff) hi = mid;
          else lo = mid;
        }
        return hi;
      }
    }
    return 2000;
  }

  /**
   * Ship heading (rotation.y) whose bow (-Z at zero) points from `from` to `to`.
   */
  _headingTowards(from, to) {
    return Math.atan2(to.x - from.x, -(to.z - from.z));
  }

  _trackKills() {
    for (const ship of this._waveShips) {
      if (ship.isSinking && !ship._killCounted) {
        ship._killCounted = true;
        this.killCount++;
        if (this.gameWorld.ui) {
          this.gameWorld.ui.showToast('Enemy battleship sinking!', 'success', 1600);
        }
      }
    }
  }

  /**
   * Recovers Rapier colliders from fully submerged hulls once they have lain
   * on the seabed for sinkCleanupSeconds. Uses disposeHulk() so shared model
   * GPU resources (cloned from the cached GLTF) are not touched.
   */
  _recycleHulks(delta) {
    for (const ship of this.ships) {
      if (ship.brain && ship.brain.is(BattleshipAIState.DEAD) && !ship._hulkTracked) {
        ship._hulkTracked = true;
        this._hulks.push({ ship, timer: this.sinkCleanupSeconds });
      }
    }

    for (let i = this._hulks.length - 1; i >= 0; i--) {
      const hulk = this._hulks[i];
      hulk.timer -= delta;
      if (hulk.timer > 0) continue;
      // Hulk first: GameWorld.removeEntity invokes dispose(), which no-ops
      // once disposeHulk() has marked the ship, protecting shared model
      // geometry/materials cloned from the cached GLTF.
      hulk.ship.disposeHulk();
      this.gameWorld.removeEntity(hulk.ship);
      this.ships.delete(hulk.ship);
      this._hulks.splice(i, 1);
    }
  }

  _updateObjective() {
    if (!this.gameWorld.ui) return;
    const waves = this.waves;
    const alive = [...this.ships].filter((ship) => !ship.isDestroyed).length;
    const remaining = this._spawnQueue + this._pendingSpawns + alive;
    const title = this.state === 'intermission'
      ? `WAVE ${this._waveIndex + 1} INCOMING`
      : `REPEL THE FLEET — WAVE ${this._waveIndex + 1}/${waves.length}`;
    const detail = this.state === 'intermission'
      ? `Regroup — next wave in ${Math.ceil(this._waveTimer)}s`
      : `Hostile warships: ${remaining}  |  Sunk: ${this.killCount}  |  Battleship: ${Math.ceil((this.battleship.health.currentHealth / this.battleship.health.maxHealth) * 100)}%`;
    this.gameWorld.ui.showObjective(title, detail);
  }

  _finish(victory, message) {
    if (this.state === 'won' || this.state === 'lost') return;
    this.state = victory ? 'won' : 'lost';

    const result = {
      outcome: victory ? 'victory' : 'defeat',
      title: victory ? 'FLEET DESTROYED' : 'BATTLESHIP LOST',
      message,
      stats: [
        { label: 'Time', value: `${Math.floor(this.elapsed / 60)}:${Math.floor(this.elapsed % 60).toString().padStart(2, '0')}` },
        { label: 'Enemy battleships sunk', value: `${this.killCount} / ${this.totalHostiles}` }
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
    this.ships.clear();
    this._hulks = [];
    this._waveShips = [];
    this.battleship = null;
    this.water = null;
    this.onVictory = null;
    this.onDefeat = null;
  }
}
