import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BaseLevel } from './BaseLevel.js';
import { BeachEnvironment } from './level02/BeachEnvironment.js';
import { LandingZone } from './level02/LandingZone.js';
import { BeachCover } from './level02/BeachCover.js';
import { Player } from '../entities/Player.js';
import { TrainingDummy } from '../entities/TrainingDummy.js';
import { WeaponController } from '../weapons/WeaponController.js';
import { ProjectilePool } from '../entities/ProjectilePool.js';
import { AlienTrooper } from '../entities/enemies/AlienTrooper.js';
import { AlienSquad } from '../ai/AlienSquad.js';
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

// Alien troopers patrolling the jungle edge (world x, z)
const TROOPER_SPOTS = [
  { x: -30, z: 105 },
  { x: 5, z: 95 },
  { x: 35, z: 110 }
];
const TROOPER_RESPAWN_SECONDS = 5; // After the last one dies, a fresh trio arrives

/**
 * Level02TestLevel
 * Sandbox for Level 2 (The Beach). Level 2 features are proven here before they are
 * promoted into Level02. Features:
 * - Island terrain with a matching heightfield collider, calm sea and dusk lighting
 * - Landing zone: anchored ship, boarding ramp, gangway and parked helicopters
 * - Cover: palms, jungle trees, rocks and bushes; crouch [C] in a bush to hide
 * - Machine gun and knife (WeaponController) with training dummies on the beach
 * - Three alien troopers at the jungle edge that see, hear, take cover and shoot plasma;
 *   the player has health and respawns on the beach
 * - Player spawned on the ship's deck at the foot of the boarding ramp
 * - Aerial orbit camera for inspecting the island ([F1] or the dev tools panel)
 */
export class Level02TestLevel extends BaseLevel {
  constructor(gameWorld) {
    super(gameWorld, 'Level 2: Beach Test Level');
    this.environment = null;
    this.landingZone = null;
    this.cover = null;
    this.player = null;
    this.weapons = null;
    this.dummies = [];
    this.projectilePool = null;
    this.squad = null;
    this._wasConcealed = false;
    this._respawnTimer = -1;
    this._troopRespawnTimer = -1;

    // Dev Tools Camera System
    this.cameraMode = 'PLAYER'; // 'PLAYER' | 'AERIAL'
    this.aerialCamera = null;
    this.orbitControls = null;
    this._terrainChecked = false;
  }

  async init() {
    await super.init();

    // 1. Island, sea, sky and lighting
    this.environment = this.trackDisposable(new BeachEnvironment(this.gameWorld));
    this.environment.build();

    // 2. Ship, gangway and parked helicopters
    this.landingZone = this.trackDisposable(new LandingZone(this.gameWorld, this.environment));
    await this.landingZone.build();

    // 3. Trees, rocks and bushes, leaving the landing zone and the dummies open
    const clearings = [
      ...this.landingZone.clearings,
      ...DUMMY_SPOTS.map((spot) => ({ x: spot.x, z: spot.z, radius: 3 })),
      ...TROOPER_SPOTS.map((spot) => ({ x: spot.x, z: spot.z, radius: 2 }))
    ];
    this.cover = this.trackDisposable(new BeachCover(this.gameWorld, this.environment, clearings));
    this.cover.build();

    // 4. Player on deck at the foot of the boarding ramp, facing the beach (-Z).
    //    Snap-to-ground keeps them on the ground walking down the gangway and the island's hills.
    const spawn = this.landingZone.spawnPoints.deck;
    this.player = new Player(this.gameWorld, {
      snapToGround: true,
      canCrouch: true,
      maxHealth: config.player.vitals.maxHealth
    });
    this.player.setPosition(spawn.x, spawn.y, spawn.z);
    this.player.yaw = 0;
    this.gameWorld.addEntity(this.player);

    this.player.health.onDamage = () => this._onPlayerHurt();
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showPlayerHealth();
      this.gameWorld.ui.updatePlayerHealth(this.player.health.currentHealth, this.player.health.maxHealth);
    }

    // 5. Machine gun and knife (added after the player so its camera work runs after the player's).
    //    Every shot is a noise the aliens can hear.
    this.weapons = new WeaponController(this.gameWorld, this.player, {
      onGunshot: (position) => this.squad.reportNoise(position)
    });
    this.gameWorld.addEntity(this.weapons);

    // 5b. Projectiles for the aliens' plasma rifles
    this.projectilePool = new ProjectilePool(this.gameWorld);
    this.gameWorld.addEntity(this.projectilePool);
    this.gameWorld.projectilePool = this.projectilePool;

    // 5c. Alien squad at the jungle edge
    const trooperCfg = config.enemies.trooper;
    this.squad = this.trackDisposable(new AlienSquad(this.gameWorld, {
      targets: [this.player],
      cover: this.cover,
      alertRadius: trooperCfg.alertRadius,
      corpseSeconds: trooperCfg.corpseSeconds
    }));
    this._spawnTroopers();

    // 6. Targets
    for (const spot of DUMMY_SPOTS) {
      const position = new THREE.Vector3(spot.x, this.environment.heightAt(spot.x, spot.z), spot.z);
      const dummy = new TrainingDummy(this.gameWorld, { position, facing: spot.facing });
      this.gameWorld.addEntity(dummy);
      this.dummies.push(dummy);
    }

    // 7. Dev tools: aerial camera and collider toggle
    this._initAerialCamera();
    this._initDevTools();

    console.log(`${this.name} initialized.`);
  }

  _spawnTroopers() {
    for (const spot of TROOPER_SPOTS) {
      const position = new THREE.Vector3(spot.x, this.environment.heightAt(spot.x, spot.z) + 0.1, spot.z);
      this.squad.add(new AlienTrooper(this.gameWorld, { position, squad: this.squad }));
    }
  }

  _onPlayerHurt() {
    const ui = this.gameWorld.ui;
    if (!ui) return;
    ui.flashDamage();
    ui.updatePlayerHealth(this.player.health.currentHealth, this.player.health.maxHealth);
  }

  /**
   * Stand-in for downed and revive (coming with the squad systems): a few seconds down,
   * then back on the beach at full health.
   */
  _updatePlayerDeath(delta) {
    const player = this.player;
    const ui = this.gameWorld.ui;
    if (!player.health.isDead) return;

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
    if (mode === this.cameraMode) return;
    this.cameraMode = mode;

    if (mode === 'AERIAL') {
      this.gameWorld.input.exitPointerLock();
      this.player.isDevSuspended = true;
      this.orbitControls.enabled = true;
      this.gameWorld.setActiveCamera(this.aerialCamera);
    } else {
      this.orbitControls.enabled = false;
      this.player.isDevSuspended = false;
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

  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    super.gameplayUpdate(delta, gameWorld);

    this.environment.update(delta);
    this.landingZone.update(delta);

    if (!this._terrainChecked) {
      this._terrainChecked = true;
      this._verifyTerrainCollider();
    }

    if (gameWorld.input.isActionJustPressed('devCamera')) {
      this.setCameraMode(this.cameraMode === 'PLAYER' ? 'AERIAL' : 'PLAYER');
    }
    if (this.cameraMode === 'AERIAL') {
      this.orbitControls.update();
    }

    // Aliens: clear the dead, and send a fresh trio once all are down
    this.squad.update();
    if (this.squad.aliveCount === 0) {
      if (this._troopRespawnTimer < 0) this._troopRespawnTimer = TROOPER_RESPAWN_SECONDS;
      this._troopRespawnTimer -= delta;
      if (this._troopRespawnTimer <= 0) {
        this._troopRespawnTimer = -1;
        this._spawnTroopers();
      }
    }

    this._updatePlayerDeath(delta);

    // Hidden while crouched in a bush (AI perception reads player.isConcealed)
    const concealed = !this.player.health.isDead && this.cover.updateConcealment(this.player);
    if (concealed !== this._wasConcealed && gameWorld.ui) {
      if (concealed) gameWorld.ui.showStatusIndicator('HIDDEN', 'success');
      else gameWorld.ui.hideStatusIndicator();
      this._wasConcealed = concealed;
    }

    // Fall recovery: back on deck if the player ever drops through the world
    if (this.player.position.y < -20) {
      const spawn = this.landingZone.spawnPoints.deck;
      this.player.teleport(spawn.x, spawn.y, spawn.z);
    }
  }

  dispose() {
    console.log(`Disposing ${this.name}...`);

    if (this.gameWorld.ui) {
      this.gameWorld.ui.hideDevTools();
      this.gameWorld.ui.hideStatusIndicator();
      this.gameWorld.ui.hidePlayerHealth();
    }
    if (this.orbitControls) {
      this.orbitControls.dispose();
      this.orbitControls = null;
    }
    this.gameWorld.setActiveCamera(null);

    this.player = null;
    this.weapons = null;
    this.dummies = [];
    super.dispose(); // Disposes the squad, which removes the aliens
    this.squad = null;
    if (this.gameWorld.projectilePool === this.projectilePool) {
      this.gameWorld.projectilePool = null;
    }
    this.projectilePool = null;
    this.environment = null;
    this.landingZone = null;
    this.cover = null;
  }
}
