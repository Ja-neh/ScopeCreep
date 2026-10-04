import * as THREE from 'three';
import { Level03 } from './Level03.js';
import { SandboxTools } from './SandboxTools.js';

// Aliens in the first streets past the gate for trying things out (world x, z, type)
const ALIEN_SPOTS = [
  { x: 2, z: -214, type: 'trooper' },
  { x: -26, z: -220, type: 'trooper' },
  { x: 26, z: -220, type: 'trooper' },
  { x: 0, z: -262, type: 'brute' }
];
const ALIEN_RESPAWN_SECONDS = 5; // After the last one dies, a fresh group arrives

/**
 * Level03TestLevel
 * Sandbox for Level 3 (The Village): the real Level03 world (the night village, the hall, the
 * squad) without the mission, plus a group of aliens in the streets that comes back after they
 * all die, and the shared SandboxTools: [F1] aerial camera, [F3] spawn an alien, [F4] squad
 * on/off, and respawning instead of failing. [F6] takes the player and the squad into the hall
 * and starts the fight with the Warden (again, as often as you like).
 */
export class Level03TestLevel extends Level03 {
  constructor(gameWorld) {
    super(gameWorld, 'Level 3: Village Test Level');
    this.state = 'sandbox';
    this.tools = null;
    this._alienRespawnTimer = -1;
  }

  get controls() {
    return [
      ...super.controls,
      { actions: ['devCamera'], label: 'Aerial camera' },
      { actions: ['devSpawn'], label: 'Spawn trooper (+Shift: brute)' },
      { actions: ['devSquad'], label: 'Squad on / off' },
      { actions: ['devBoss'], label: 'Fight the Warden' }
    ];
  }

  get cameraMode() {
    return this.tools ? this.tools.cameraMode : 'PLAYER';
  }

  async _startScenario() {
    this.spawnCrew();
    this._spawnAliens();
    this.tools = new SandboxTools(this, {
      respawnPoint: () => (this.arena && !this.arena.defeated ? this.village.hall.supplyPoint : this.village.spawnPoints.start),
      spawnSquad: () => this.spawnCrew(),
      aerialTarget: new THREE.Vector3(0, 12, -330),
      aerialPosition: new THREE.Vector3(120, 190, -90)
    });
    this.tools.init();
  }

  _spawnAliens() {
    for (const spot of ALIEN_SPOTS) this.createAlien(spot.type, spot.x, spot.z);
  }

  _updateScenario(delta) {
    this.tools.update(delta);
    if (this.gameWorld.input.isActionJustPressed('devBoss')) this.fightWarden();
    if (this.arena) this.arena.update(delta);
    if (this.state === 'guards') this._updateHallWave(); // Wave 2, after shutting the generators down by hand

    // A fresh group once all aliens are down
    if (this.squad.aliveCount === 0) {
      if (this._alienRespawnTimer < 0) this._alienRespawnTimer = ALIEN_RESPAWN_SECONDS;
      this._alienRespawnTimer -= delta;
      if (this._alienRespawnTimer <= 0) {
        this._alienRespawnTimer = -1;
        this._spawnAliens();
      }
    }
  }

  /**
   * [F6]: the player and the squad go to the hall door, and the Warden wakes (a fresh one, if
   * there was a fight already).
   */
  fightWarden() {
    if (this.arena && (this.arena.started || this.arena.defeated)) {
      this.arena.dispose(); // A fresh Warden for another round
      this.arena = null;
    }
    if (this.dome.isUp) this.shutDownGenerators({ instant: true });
    if (this.doorSeal.isUp) this.doorSeal.collapse({ instant: true });
    const hall = this.village.hall;
    const inside = hall.doorway.clone().addScaledVector(hall.forward, -3);
    this.player.teleport(inside.x, inside.y + 0.4, inside.z);
    this.player.yaw = Math.atan2(hall.forward.x, hall.forward.z); // Facing into the hall
    this.allies.mates.forEach((mate, i) => {
      const behind = hall.entrance.clone().addScaledVector(hall.forward, 1 + Math.floor(i / 2) * 2);
      const side = new THREE.Vector3(hall.forward.z, 0, -hall.forward.x).multiplyScalar(i % 2 ? 2 : -2);
      mate.teleport(behind.x + side.x, behind.y + 0.2, behind.z + side.z);
    });
    this.startBossFight();
  }

  /** In the sandbox the fight just ends: [F6] for another round. */
  _onWardenDefeated() {
    this.state = 'sandbox';
    if (this.gameWorld.ui) this.gameWorld.ui.showToast('The Warden is down. [F6] for another round.', 'success', 4000);
  }

  _shouldStaySuspended() {
    return super._shouldStaySuspended() || (this.tools !== null && this.tools.keepsPlayerStill);
  }

  _onPlayerKilled(delta) {
    this.tools.onPlayerKilled(delta);
  }

  onColliderDebugToggled(visible) {
    if (this.tools) this.tools.onColliderDebugToggled(visible);
  }

  dispose() {
    if (this.tools) {
      this.tools.dispose();
      this.tools = null;
    }
    super.dispose();
  }
}
