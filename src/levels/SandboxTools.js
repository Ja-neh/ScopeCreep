import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEV_SPAWN_DISTANCE = 30; // F3 drops an alien this far ahead of the player

/**
 * SandboxTools
 * The dev tools every island test level shares (Level02TestLevel, Level03TestLevel):
 * - [F1] (or the dev tools panel) aerial orbit camera, which also holds the player still
 * - [F3] spawns a trooper about 30 m ahead of the player, [Shift]+[F3] a brute
 * - [F4] sends the AI squad away or brings it back
 * - Instead of failing the mission, the player respawns a few seconds after being lost
 * The level calls update() from its _updateScenario (Phase 5) and onPlayerKilled() from its
 * _onPlayerKilled hook.
 */
export class SandboxTools {
  /**
   * @param {IslandLevel} level
   * @param {Object} options
   * @param {() => THREE.Vector3} options.respawnPoint - Where the player comes back
   * @param {() => void} options.spawnSquad - Puts the level's AI squad back
   * @param {THREE.Vector3} options.aerialTarget - What the aerial camera orbits
   * @param {THREE.Vector3} options.aerialPosition - Where the aerial camera starts
   */
  constructor(level, { respawnPoint, spawnSquad, aerialTarget, aerialPosition }) {
    this.level = level;
    this.gameWorld = level.gameWorld;
    this.respawnPoint = respawnPoint;
    this.spawnSquad = spawnSquad;
    this.aerialTarget = aerialTarget.clone();
    this.aerialPosition = aerialPosition.clone();

    this.cameraMode = 'PLAYER'; // 'PLAYER' | 'AERIAL'
    this.aerialCamera = null;
    this.orbitControls = null;
  }

  /**
   * Sets up the aerial camera and dev tools panel (in a browser) and says which keys do what.
   */
  init() {
    const gameWorld = this.gameWorld;
    if (gameWorld.renderer) {
      this.aerialCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 3000);
      this.aerialCamera.position.copy(this.aerialPosition);
      this.orbitControls = new OrbitControls(this.aerialCamera, gameWorld.renderer.domElement);
      this.orbitControls.enableDamping = true;
      this.orbitControls.dampingFactor = 0.05;
      this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.02;
      this.orbitControls.minDistance = 5;
      this.orbitControls.maxDistance = 1500;
      this.orbitControls.target.copy(this.aerialTarget);
      this.orbitControls.enabled = false;

      if (gameWorld.ui) {
        gameWorld.ui.showDevTools({
          onSelectPlayerCamera: () => this.setCameraMode('PLAYER'),
          onSelectAerialCamera: () => this.setCameraMode('AERIAL'),
          onToggleColliders: () => {
            const isVisible = gameWorld.toggleColliderDebug();
            gameWorld.ui.updateDevToolsColliders(isVisible);
          }
        });
      }
    }
    if (gameWorld.ui) {
      gameWorld.ui.showToast('Sandbox: [F1] aerial camera · [F3] spawn trooper · [Shift]+[F3] spawn brute · [F4] squad on/off', 'info', 6000);
    }
  }

  /** The aerial camera keeps the player still. */
  get keepsPlayerStill() {
    return this.cameraMode === 'AERIAL';
  }

  /**
   * Phase 5: the dev keys.
   */
  update() {
    const input = this.gameWorld.input;
    if (input.isActionJustPressed('devSpawn')) {
      this.spawnAlienAhead(input.isActionDown('sprint') ? 'brute' : 'trooper');
    }
    if (input.isActionJustPressed('devSquad')) {
      this.toggleSquad();
    }
    if (this.orbitControls) {
      if (input.isActionJustPressed('devCamera')) {
        this.setCameraMode(this.cameraMode === 'PLAYER' ? 'AERIAL' : 'PLAYER');
      }
      if (this.cameraMode === 'AERIAL') this.orbitControls.update();
    }
  }

  /**
   * Drops an alien on clear ground ahead of the player.
   * @returns {AlienCombatant|null}
   */
  spawnAlienAhead(type) {
    const { player, environment, cover } = this.level;
    const p = player.position;
    for (let attempt = 0; attempt < 10; attempt++) {
      const angle = player.yaw + (Math.random() - 0.5) * 0.8;
      const distance = DEV_SPAWN_DISTANCE + (Math.random() - 0.5) * 10;
      const x = p.x - Math.sin(angle) * distance;
      const z = p.z - Math.cos(angle) * distance;
      if (environment.heightAt(x, z) > 0.6 && cover.isClearOfSolids(x, z, 1.2)) {
        return this.level.createAlien(type, x, z);
      }
    }
    return null;
  }

  /** [F4]: sends the AI squad away, or brings it back. */
  toggleSquad() {
    const { allies } = this.level;
    const ui = this.gameWorld.ui;
    if (allies.mates.length > 0) {
      allies.removeAllMates();
      if (ui) ui.showToast('Squad dismissed', 'info', 1500);
    } else {
      this.spawnSquad();
      if (ui) ui.showToast('Squad is back', 'info', 1500);
    }
  }

  /**
   * The player is lost (bled out, or nobody left to revive them): a few seconds later they are
   * back at the respawn point at full health. Call every frame while that lasts.
   */
  onPlayerKilled(delta) {
    this.level._respawnPlayer(delta, this.respawnPoint);
  }

  /**
   * Sets the active camera mode ('PLAYER' or 'AERIAL').
   */
  setCameraMode(mode) {
    if (mode === this.cameraMode || !this.orbitControls) return;
    this.cameraMode = mode;
    const { player } = this.level;

    if (mode === 'AERIAL') {
      this.gameWorld.input.exitPointerLock();
      player.isDevSuspended = true;
      this.orbitControls.enabled = true;
      this.gameWorld.setActiveCamera(this.aerialCamera);
    } else {
      this.orbitControls.enabled = false;
      player.isDevSuspended = player.health.isDead;
      this.gameWorld.setActiveCamera(null);
    }

    if (this.gameWorld.ui) {
      this.gameWorld.ui.updateDevToolsCamera(mode);
    }
  }

  onColliderDebugToggled(visible) {
    if (this.gameWorld.ui) {
      this.gameWorld.ui.updateDevToolsColliders(visible);
    }
  }

  dispose() {
    if (this.gameWorld.ui) {
      this.gameWorld.ui.hideDevTools();
    }
    if (this.orbitControls) {
      this.orbitControls.dispose();
      this.orbitControls = null;
    }
    this.gameWorld.setActiveCamera(null);
    this.aerialCamera = null;
  }
}
