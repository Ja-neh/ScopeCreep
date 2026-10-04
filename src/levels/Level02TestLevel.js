import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Level02 } from './Level02.js';
import { TrainingDummy } from '../entities/TrainingDummy.js';
import config from '../config.json';

// Training dummies on the beach (world x, z, facing). Facing PI looks back at the ship;
// the last one faces inland so it can be knifed from behind.
const DUMMY_SPOTS = [
  { x: -10, z: 175, facing: Math.PI },
  { x: 6, z: 166, facing: Math.PI },
  { x: -26, z: 160, facing: Math.PI },
  { x: -8, z: 140, facing: Math.PI },
  { x: 16, z: 181, facing: 0 }
];

// Aliens patrolling behind the dummies, 60-80 m from the gangway (world x, z, type)
const ALIEN_SPOTS = [
  { x: -30, z: 130, type: 'trooper' },
  { x: 5, z: 122, type: 'trooper' },
  { x: 35, z: 135, type: 'trooper' },
  { x: 60, z: 128, type: 'brute' }
];
const ALIEN_RESPAWN_SECONDS = 5; // After the last one dies, a fresh group arrives
const DEV_SPAWN_DISTANCE = 30;   // F3 drops an alien this far ahead of the player

/**
 * Level02TestLevel
 * Sandbox for Level 2 (The Beach): the real Level02 world (island, landing, cover, weapons,
 * aliens) without the waves, plus things for trying features out:
 * - Training dummies on the beach (one faces away for backstabs)
 * - Three troopers and a brute behind the dummies that come back after they all die
 * - The AI squad waiting on the sand (they follow once you're ashore), pilots by the parked
 *   helicopters; [F4] sends the squad away or brings it back
 * - [F3] spawns a trooper 30 m ahead of the player, [Shift]+[F3] a brute
 * - The player respawns on the beach instead of failing the mission
 * - Aerial orbit camera ([F1] or the dev tools panel) and a terrain/collider self-check
 */
export class Level02TestLevel extends Level02 {
  constructor(gameWorld) {
    super(gameWorld, 'Level 2: Beach Test Level');
    this.state = 'sandbox';
    this.dummies = [];

    this._respawnTimer = -1;
    this._alienRespawnTimer = -1;
    this._terrainChecked = false;

    // Dev Tools Camera System
    this.cameraMode = 'PLAYER'; // 'PLAYER' | 'AERIAL'
    this.aerialCamera = null;
    this.orbitControls = null;
  }

  _extraClearings() {
    return [
      ...DUMMY_SPOTS.map((spot) => ({ x: spot.x, z: spot.z, radius: 3 })),
      ...ALIEN_SPOTS.map((spot) => ({ x: spot.x, z: spot.z, radius: 2 }))
    ];
  }

  async _startScenario() {
    for (const spot of DUMMY_SPOTS) {
      const position = new THREE.Vector3(spot.x, this.environment.heightAt(spot.x, spot.z), spot.z);
      const dummy = new TrainingDummy(this.gameWorld, { position, facing: spot.facing });
      this.gameWorld.addEntity(dummy);
      this.dummies.push(dummy);
    }
    this._spawnAliens();
    this.spawnSquad();

    if (this.gameWorld.renderer) {
      this._initAerialCamera();
      this._initDevTools();
    }
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showToast('Sandbox: [F1] aerial camera · [F3] spawn trooper · [Shift]+[F3] spawn brute · [F4] squad on/off', 'info', 6000);
    }
  }

  /**
   * Dev: drops an alien on clear ground ahead of the player.
   * @returns {AlienCombatant|null}
   */
  spawnAlienAhead(type) {
    const p = this.player.position;
    for (let attempt = 0; attempt < 10; attempt++) {
      const angle = this.player.yaw + (Math.random() - 0.5) * 0.8;
      const distance = DEV_SPAWN_DISTANCE + (Math.random() - 0.5) * 10;
      const x = p.x - Math.sin(angle) * distance;
      const z = p.z - Math.cos(angle) * distance;
      if (this.environment.heightAt(x, z) > 0.6 && this.cover.isClearOfSolids(x, z, 1.2)) {
        return this.createAlien(type, x, z);
      }
    }
    return null;
  }

  /** The crew on the sand and the pilots by their (already parked) helicopters. */
  spawnSquad() {
    this.spawnCrew();
    this.landingZone.helicopterBays.forEach((bay, index) => this._pilotClimbsOut(bay, index, bay.guardPoint));
  }

  /** [F4]: sends the AI squad away, or brings it back. */
  toggleSquad() {
    if (this.allies.mates.length > 0) {
      this.allies.removeAllMates();
      if (this.gameWorld.ui) this.gameWorld.ui.showToast('Squad dismissed', 'info', 1500);
    } else {
      this.spawnSquad();
      if (this.gameWorld.ui) this.gameWorld.ui.showToast('Squad back on the beach', 'info', 1500);
    }
  }

  _spawnAliens() {
    for (const spot of ALIEN_SPOTS) {
      this.createAlien(spot.type, spot.x, spot.z);
    }
  }

  _updateScenario(delta) {
    if (!this._terrainChecked) {
      this._terrainChecked = true;
      this._verifyTerrainCollider();
    }

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
   * Stand-in for downed and revive (coming with the squad systems): a few seconds down,
   * then back on the beach at full health.
   */
  _onPlayerKilled(delta) {
    const player = this.player;
    const ui = this.gameWorld.ui;

    if (this._respawnTimer < 0) {
      this._respawnTimer = config.player.vitals.respawnSeconds;
      player.isDevSuspended = true; // Freezes movement, camera and weapons while down
      if (ui) ui.showStatusIndicator('YOU WERE KILLED', 'danger');
      return;
    }

    this._respawnTimer -= delta;
    if (this._respawnTimer > 0) return;

    this._respawnTimer = -1;
    const spawn = this.landingZone.spawnPoints.gangwayFoot;
    player.teleport(spawn.x, spawn.y, spawn.z);
    player.health.reset();
    player.isDevSuspended = this.cameraMode === 'AERIAL';
    this._wasConcealed = false;
    if (ui) {
      ui.hideStatusIndicator();
      ui.updatePlayerHealth(player.health.currentHealth, player.health.maxHealth);
    }
  }

  /**
   * Dev check, run once after the first physics step: rays cast straight down at the terrain
   * collider alone must hit it at the height the mesh shows. A mismatch means the heightfield
   * samples are misordered.
   */
  _verifyTerrainCollider() {
    const physics = this.gameWorld.physics;
    const terrainCollider = this.environment.terrain.collider;
    const startY = 200;
    const ray = new physics.RAPIER.Ray({ x: 0, y: startY, z: 0 }, { x: 0, y: -1, z: 0 });
    const samples = [[0, 150], [-60, 120], [80, 100], [-120, -40], [35, 60], [150, -90]];

    let worstError = 0;
    for (const [x, z] of samples) {
      ray.origin.x = x;
      ray.origin.z = z;
      const timeOfImpact = terrainCollider.castRay(ray, 400, true);
      const error = timeOfImpact >= 0 ? Math.abs((startY - timeOfImpact) - this.environment.heightAt(x, z)) : Infinity;
      worstError = Math.max(worstError, error);
    }

    if (worstError < 0.05) {
      console.log(`[Level02TestLevel] Terrain collider matches the mesh (worst error ${worstError.toFixed(3)} m).`);
    } else {
      console.warn(`[Level02TestLevel] Terrain collider does NOT match the mesh (worst error ${worstError.toFixed(2)} m).`);
    }
  }

  _initAerialCamera() {
    this.aerialCamera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      3000
    );
    this.aerialCamera.position.set(0, 180, 420);

    this.orbitControls = new OrbitControls(this.aerialCamera, this.gameWorld.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.orbitControls.minDistance = 5;
    this.orbitControls.maxDistance = 1500;
    this.orbitControls.target.set(0, 5, 190);
    this.orbitControls.enabled = false;
  }

  _initDevTools() {
    if (!this.gameWorld.ui) return;
    this.gameWorld.ui.showDevTools({
      onSelectPlayerCamera: () => this.setCameraMode('PLAYER'),
      onSelectAerialCamera: () => this.setCameraMode('AERIAL'),
      onToggleColliders: () => {
        const isVisible = this.gameWorld.toggleColliderDebug();
        this.gameWorld.ui.updateDevToolsColliders(isVisible);
      }
    });
  }

  /**
   * Sets the active camera mode ('PLAYER' or 'AERIAL')
   */
  setCameraMode(mode) {
    if (mode === this.cameraMode || !this.orbitControls) return;
    this.cameraMode = mode;

    if (mode === 'AERIAL') {
      this.gameWorld.input.exitPointerLock();
      this.player.isDevSuspended = true;
      this.orbitControls.enabled = true;
      this.gameWorld.setActiveCamera(this.aerialCamera);
    } else {
      this.orbitControls.enabled = false;
      this.player.isDevSuspended = this.player.health.isDead;
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
    this.dummies = [];
    super.dispose();
  }
}
