import * as THREE from 'three';
import { Level02 } from './Level02.js';
import { SandboxTools } from './SandboxTools.js';
import { TrainingDummy } from '../entities/TrainingDummy.js';

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

/**
 * Level02TestLevel
 * Sandbox for Level 2 (The Beach): the real Level02 world (island, landing, cover, weapons,
 * aliens) without the waves, plus things for trying features out:
 * - Training dummies on the beach (one faces away for backstabs)
 * - Three troopers and a brute behind the dummies that come back after they all die
 * - The AI squad waiting on the sand (they follow once you're ashore), pilots by the parked
 *   helicopters
 * - The shared SandboxTools: [F1] aerial camera, [F3] spawn an alien, [F4] squad on/off, and
 *   respawning instead of failing
 * - A terrain/collider self-check
 */
export class Level02TestLevel extends Level02 {
  constructor(gameWorld) {
    super(gameWorld, 'Level 2: Beach Test Level');
    this.state = 'sandbox';
    this.dummies = [];
    this.tools = null;

    this._alienRespawnTimer = -1;
    this._terrainChecked = false;
  }

  get controls() {
    return [
      ...super.controls,
      { actions: ['devCamera'], label: 'Aerial camera' },
      { actions: ['devSpawn'], label: 'Spawn trooper (+Shift: brute)' },
      { actions: ['devSquad'], label: 'Squad on / off' }
    ];
  }

  get cameraMode() {
    return this.tools ? this.tools.cameraMode : 'PLAYER';
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

    this.tools = new SandboxTools(this, {
      respawnPoint: () => this.landingZone.spawnPoints.gangwayFoot,
      spawnSquad: () => this.spawnSquad(),
      aerialTarget: new THREE.Vector3(0, 5, 190),
      aerialPosition: new THREE.Vector3(0, 180, 420)
    });
    this.tools.init();
  }

  /** Dev: drops an alien on clear ground ahead of the player. */
  spawnAlienAhead(type) {
    return this.tools.spawnAlienAhead(type);
  }

  /** The crew on the sand and the pilots by their (already parked) helicopters. */
  spawnSquad() {
    this.spawnCrew();
    this.landingZone.helicopterBays.forEach((bay, index) => this._pilotClimbsOut(bay, index, bay.guardPoint));
  }

  /** [F4]: sends the AI squad away, or brings it back. */
  toggleSquad() {
    this.tools.toggleSquad();
  }

  setCameraMode(mode) {
    this.tools.setCameraMode(mode);
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
    this.tools.update(delta);

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

  /** The aerial camera also keeps the player still. */
  _shouldStaySuspended() {
    return super._shouldStaySuspended() || (this.tools !== null && this.tools.keepsPlayerStill);
  }

  /** Bled out, or nobody left to revive you: back on the beach a few seconds later. */
  _onPlayerKilled(delta) {
    this.tools.onPlayerKilled(delta);
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

  onColliderDebugToggled(visible) {
    if (this.tools) this.tools.onColliderDebugToggled(visible);
  }

  dispose() {
    if (this.tools) {
      this.tools.dispose();
      this.tools = null;
    }
    this.dummies = [];
    super.dispose();
  }
}
