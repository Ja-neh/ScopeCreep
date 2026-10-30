import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BaseLevel } from './BaseLevel.js';
import { Battleship } from '../entities/Battleship.js';
import { Player } from '../entities/Player.js';
import { ProjectilePool } from '../entities/ProjectilePool.js';
import {WeaponController} from '../weapons/WeaponController.js';
import {AlienSquad} from '../ai/AlienSquad.js';
import {AlienBrute} from '../entities/enemies/AlienBrute.js';
import { PlayerJet } from '../entities/player-jet/PlayerJet.js';
import { EnemyJet } from '../entities/enemies/EnemyJet.js';
import { EnemyJetManager } from '../entities/enemies/EnemyJetManager.js';
import { EnemyBattleshipManager } from '../entities/enemies/EnemyBattleshipManager.js';
import { CAMPAIGN_ENDING } from './level01/ending.js';
import { BeachEnvironment } from './level02/BeachEnvironment.js';
import { BeachCover } from './level02/BeachCover.js';
import { Level02 } from './Level02.js';
import config from '../config.json';

/**
 * Level01
 * Act 1: Operation Retake - At Sea
 * Features:
 * - Starting far out in open sea and advancing toward the shores of Level 2's island
 * - Procedural island terrain, beach waterline, and tropical foliage cover
 * - Dynamic atmospheric progression blending open sea daylight into sunset on approach
 * - Floating battleship with wave buoyancy, helm steering, and kinematic physics
 * - AI ship crew operating unoccupied stations
 * - Human player avatar walking on deck
 * - Interactive gun turrets (ArtilleryTurret & FlakTurret)
 * - Aerial jet defense dogfighting & flight deck launch
 * - Built-in Dev Tools to toggle between Player and Aerial Orbit Camera
 */
export class Level01 extends BaseLevel {
  constructor(gameWorld) {
    super(gameWorld, 'Level 1: Operation Retake (At Sea)');
    this.environment = null;
    this.cover = null;
    this.water = null;
    this.battleship = null;
    this.player = null;
    this.playerJet = null;
    this.projectilePool = null;
    this.defenseMission = null;
    this.fleetAssault = null;
    this.launchMarker = null;
    this.preflightJets = new Set();
    this.preflightKillCount = 0;
    this.preflightDefenseComplete = false;
    this._preflightTimer = 0;
    this._preflightStarted = false;
    this._endingResult = null;
    this._endingTimer = 0;
    this._creditsTimer = 0;
    this.launchPositionLocal = new THREE.Vector3(0.46, 5.55, 38);
    this._launchPositionWorld = new THREE.Vector3();
    this.launchRadius = 5;

    // Navigation: open sea start advancing toward the shores of the island
    this.openSeaStartZ = 950;
    this.shoreAnchorageZ = 225;
    this.hasReachedShore = false;

    // Dev Tools Camera System
    this.cameraMode = 'PLAYER'; // 'PLAYER' | 'AERIAL'
    this.aerialCamera = null;
    this.orbitControls = null;
    this._onKeyDown = null;
  }

  get controls() {
    return [
      { actions: ['forward', 'backward'], label: 'Walk forward / back' },
      { actions: ['steerLeft', 'steerRight'], label: 'Walk left / right' },
      { actions: ['jump'], label: 'Jump' },
      { actions: ['specialAction'], label: 'Mount station / Launch jet' },
      { actions: ['cycleShipOrder'], label: 'Cycle AI crew order' },
      { actions: ['pause'], label: 'Pause and options' }
    ];
  }

  async init() {
    await super.init();

    // 1. Island, Coastal Terrain, Sea, Sky & Lighting (Optimized for Level 1 open sea approach)
    this.environment = this.trackDisposable(new BeachEnvironment(this.gameWorld, {
      look: 'daylight',
      layout: 'beach',
      waveScale: 0.5,
      cellSize: 8,           // Lower ground mesh detail (8m grid vs 2m grid: 94% polygon reduction)
      createCollider: false, // Player stays aboard/in jet; no ground collision needed
      shadowCentre: new THREE.Vector3(0, 0, 300),
      shadowHalfExtent: 400,
      shadowFollowsCamera: true
    }));
    this.environment.build();
    this.water = this.environment.ocean;

    // 2. Island Cover: significantly fewer trees, no rocks, no bushes, no scenery colliders
    this.cover = this.trackDisposable(new BeachCover(this.gameWorld, this.environment, [], {
      includeRocks: false,   // No rocks
      includeBushes: false,  // No bushes
      treeDensity: 0.15,     // Significantly less trees
      palmDensity: 0.20,     // Light palm fringe along shore
      createColliders: false // Zero physics overhead for distant scenery
    }));
    this.cover.build();

    // 3. High-Performance Projectile Object Pool
    this.projectilePool = new ProjectilePool(this.gameWorld);
    this.gameWorld.addEntity(this.projectilePool);
    this.gameWorld.projectilePool = this.projectilePool;

    // 4. Instantiate Modern Battleship at Open Sea facing toward the Island (heading 0 = -Z)
    this.battleship = new Battleship(this.gameWorld, {
      position: new THREE.Vector3(0, 0, this.openSeaStartZ),
      water: this.water,
      crewAI: true
    });
    await this.battleship.ready;
    this.gameWorld.addEntity(this.battleship);
    this.battleship.initPhysics(this.gameWorld.physics);

    // Initial cruising way forward towards the island
    if (this.battleship.shipController) {
      this.battleship.shipController.speed = 6.0;
      this.battleship.shipController.heading = 0;
    }

    // 5. Spawn Player Character Controller on the Battleship Walking Deck
    this.player = new Player(this.gameWorld, {
      maxHealth:config.player.vitals.maxHealth,
      jumpForce: 10.0
    });
    this.battleship.mesh.updateMatrixWorld(true);
    const spawnWorld = this.battleship.getAreaWorldPosition('AreaFront');
    this.player.setPosition(spawnWorld.x, spawnWorld.y + 0.1, spawnWorld.z);
    this.player.yaw = 0;
    this.gameWorld.addEntity(this.player);
    this.weapons=new WeaponController(this.gameWorld,this.player);this.gameWorld.addEntity(this.weapons);
    this.boarders=this.trackDisposable(new AlienSquad(this.gameWorld,{targets:[this.player],alertRadius:60,corpseSeconds:8}));
    this._boardingSpawned=false;this._deckRespawn=-1;

    this._createJetLaunchMarker();
    this._preflightTimer = config.enemyJet.preflightDefense.firstWaveDelaySeconds;
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showObjective(
        'APPROACH THE ISLAND',
        `Advance northward toward the island shores. Distance: ${Math.round(this.openSeaStartZ - this.shoreAnchorageZ)}m.`
      );
    }

    // 6. Initialize Aerial Inspection Camera & OrbitControls
    this._initAerialCamera();

    // 7. Initialize Dev Tools UI Overlay & Keybinds
    this._initDevTools();

    // 8. Ocean surface safety floor
    this.oceanSafetyCollider = this.gameWorld.physics.createGround(3000, -1.0);

    // 9. Enemy fleet assault: 5 + 10 battleship waves (wave 1 ringing the island, wave 2 from the map edges)
    this.fleetAssault = new EnemyBattleshipManager(this.gameWorld, {
      battleship: this.battleship,
      water: this.water,
      islandAnchor: new THREE.Vector3(0, 0, -150),
      island: { inland: (x, z) => this.environment.inlandDistance(x, z) },
      onVictory: () => {
        this.gameWorld.ui?.hideObjective();
        this.gameWorld.ui?.showToast('ENEMY FLEET DESTROYED: all hostile warships sunk.', 'success', 5000);
      }
    });
    this.fleetAssault.start();

    console.log(`${this.name} initialized with Island Shores, Battleship at Open Sea, Deck Player, and Dev Camera Tools.`);
  }

  _createJetLaunchMarker() {
    const marker = new THREE.Group();
    marker.position.copy(this.launchPositionLocal);
    marker.name = 'JetLaunchMarker';

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.7, 3, 48),
      new THREE.MeshBasicMaterial({ color: 0x52ff8a, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    marker.add(ring);

    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.55, 1.4, 8),
      new THREE.MeshBasicMaterial({ color: 0x52ff8a, transparent: true, opacity: 0.55 })
    );
    beacon.position.y = 0.8;
    marker.add(beacon);

    this.battleship.mesh.add(marker);
    this.launchMarker = marker;
  }

  /**
   * Builds the secondary aerial camera and orbit controls
   */
  _initAerialCamera() {
    this.aerialCamera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      3000
    );
    this.aerialCamera.position.set(0, 52, this.openSeaStartZ + 105);
    this.aerialCamera.lookAt(0, 5, this.openSeaStartZ);

    if (this.gameWorld.renderer?.domElement) {
      this.orbitControls = new OrbitControls(this.aerialCamera, this.gameWorld.renderer.domElement);
      this.orbitControls.enableDamping = true;
      this.orbitControls.dampingFactor = 0.05;
      this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.02; // Keep camera above water
      this.orbitControls.minDistance = 5;
      this.orbitControls.maxDistance = 2500;
      this.orbitControls.target.set(0, 5, this.openSeaStartZ);
      this.orbitControls.enabled = false; // Disabled by default in player mode
    } else {
      this.orbitControls = null;
    }
  }

  /**
   * Sets the active camera mode ('PLAYER' or 'AERIAL')
   */
  setCameraMode(mode) {
    if (mode === this.cameraMode) return;
    this.cameraMode = mode;

    if (mode === 'AERIAL') {
      if (document.exitPointerLock) {
        document.exitPointerLock();
      }

      if (this.player) {
        this.player.isDevSuspended = true;
      }

      if (this.orbitControls) {
        this.orbitControls.enabled = true;
        if (this.battleship && this.battleship.mesh) {
          this.orbitControls.target.set(
            this.battleship.mesh.position.x,
            this.battleship.mesh.position.y + 4.5,
            this.battleship.mesh.position.z
          );
        }
      }

      this.gameWorld.setActiveCamera(this.aerialCamera);
    } else {
      if (this.orbitControls) {
        this.orbitControls.enabled = false;
      }

      if (this.player) {
        this.player.isDevSuspended = false;
      }

      this.gameWorld.setActiveCamera(null);
    }

    if (this.gameWorld && this.gameWorld.ui) {
      this.gameWorld.ui.updateDevToolsCamera(mode);
    }
  }

  _initDevTools() {
    if (this.gameWorld && this.gameWorld.ui) {
      this.gameWorld.ui.showDevTools({
        onSelectPlayerCamera: () => this.setCameraMode('PLAYER'),
        onSelectAerialCamera: () => this.setCameraMode('AERIAL'),
        onToggleColliders: () => {
          const isVisible = this.gameWorld.toggleColliderDebug();
          if (this.gameWorld.ui) {
            this.gameWorld.ui.updateDevToolsColliders(isVisible);
          }
        }
      });
    }

    this._onKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.code === 'Digit1') {
        this.setCameraMode('PLAYER');
      } else if (e.code === 'Digit2') {
        this.setCameraMode('AERIAL');
      } else if (e.code === 'F1' || e.code === 'KeyO') {
        e.preventDefault();
        this.setCameraMode(this.cameraMode === 'PLAYER' ? 'AERIAL' : 'PLAYER');
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  onColliderDebugToggled(visible) {
    if (this.gameWorld && this.gameWorld.ui) {
      this.gameWorld.ui.updateDevToolsColliders(visible);
    }
  }

  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    super.gameplayUpdate(delta, gameWorld);
    this.boarders.update();
    if(this.preflightDefenseComplete && !this._boardingSpawned){
      this._boardingSpawned=true;
      for(const x of [-4,4]){
        const position=this.battleship.mesh.localToWorld(new THREE.Vector3(x,6.2,12));
        const alien=new AlienBrute(gameWorld,{position,squad:this.boarders});
        this.boarders.add(alien);alien.assault(this.player.position);
      }
      gameWorld.ui?.showToast('Gorr boarding party — defend the deck!','danger',3500);
    }
    if(this.player.health.isDead){
      this.player.isDevSuspended=true;this._deckRespawn=this._deckRespawn<0 ? config.revive.bleedOutSeconds : this._deckRespawn-delta;
      gameWorld.ui?.showStatusIndicator(`DOWNED: checkpoint in ${Math.ceil(this._deckRespawn)}s`,'danger');
      if(this._deckRespawn<=0){
        const p=this.battleship.mesh.localToWorld(new THREE.Vector3(0.46,6.2,-14));
        this.player.teleport(p.x,p.y,p.z);this.player.health.reset();this.player.model.character.resetPose();
        this.weapons.restoreAmmo();gameWorld.ui?.hideStatusIndicator();
        this.player.isDevSuspended=false;this._deckRespawn=-1;
      }
    }

    // 1. Animate island environment (waves, clouds, cloud shadows, sun)
    if (this.environment) {
      this.environment.update(delta);
    } else if (this.water) {
      this.water.update(delta);
    }

    this._updateJetLaunch();
    this._updatePreflightDefense(delta);
    if (this.defenseMission) this.defenseMission.update(delta);
    if (this.fleetAssault) this.fleetAssault.update(delta);
    this._updateCampaignEnding(delta);
    this._updateIslandApproach();

    // 2. Update aerial orbit controls when in AERIAL mode
    if (this.orbitControls && this.cameraMode === 'AERIAL') {
      this.orbitControls.update();

      if (this.battleship && this.battleship.mesh) {
        this.orbitControls.target.lerp(
          new THREE.Vector3(
            this.battleship.mesh.position.x,
            this.battleship.mesh.position.y + 4.5,
            this.battleship.mesh.position.z
          ),
          0.05
        );
      }
    }

    // 3. Void fall recovery: respawn player back to AreaFront if fallen below -15m
    if (this.player && this.player.position && this.player.position.y < -15 && this.battleship) {
      const respawnWorld = this.battleship.getAreaWorldPosition('AreaFront');
      this.player.teleport(respawnWorld.x, respawnWorld.y + 0.2, respawnWorld.z);
    }
  }

  _updateIslandApproach() {
    if (!this.battleship?.mesh) return;

    const currentZ = this.battleship.mesh.position.z;
    const distToShore = Math.max(0, Math.round(currentZ - this.shoreAnchorageZ));

    // Dynamic atmospheric progression: blend from sea daylight into island sunset
    // (capped so the level stays bright; only a warm hint of dusk near the shore)
    if (this.environment) {
      const progress = THREE.MathUtils.clamp(
        (this.openSeaStartZ - currentZ) / (this.openSeaStartZ - this.shoreAnchorageZ),
        0,
        1
      ) * 0.35;
      this.environment.blendLook('daylight', 'sunset', progress);
    }

    // Check arrival at the island shore anchorage
    if (distToShore <= 15) {
      if (!this.hasReachedShore) {
        this.hasReachedShore = true;
        if (this.battleship.shipController) {
          this.battleship.shipController.speed = 0;
          this.battleship.shipController.rudderAngle = 0;
        }
        this.gameWorld.ui?.showToast('ISLAND SHORES REACHED: Battleship anchored off southern beach.', 'success', 5000);
      }

      // Prevent the warship from running up onto dry sand
      if (this.battleship.mesh.position.z < this.shoreAnchorageZ) {
        this.battleship.mesh.position.z = this.shoreAnchorageZ;
        if (this.battleship.shipController) this.battleship.shipController.speed = 0;
      }
    }
  }

  _updateJetLaunch() {
    if (!this.player || this.defenseMission) return;
    if (!this.preflightDefenseComplete) {
      this.gameWorld.ui?.hidePrompt(this);
      return;
    }
    if (this.player.isMounted || this.player.isDevSuspended || !this.battleship?.mesh) {
      this.gameWorld.ui?.hidePrompt(this);
      return;
    }

    this.battleship.mesh.updateMatrixWorld(true);
    this._launchPositionWorld.copy(this.launchPositionLocal);
    this.battleship.mesh.localToWorld(this._launchPositionWorld);
    const nearLaunchPoint = this.player.position.distanceTo(this._launchPositionWorld) <= this.launchRadius;

    if (!nearLaunchPoint) {
      this.gameWorld.ui?.hidePrompt(this);
      return;
    }

    this.gameWorld.ui?.showPrompt('E', 'LAUNCH JET DEFENSE', '#52ff8a', this);
    if (this.gameWorld.input.isActionJustPressed('specialAction')) this._launchJetDefense();
  }

  _updatePreflightDefense(delta) {
    if (this.preflightDefenseComplete || this.defenseMission || !this.player || this.playerJet) return;

    if (!this._preflightStarted) {
      this._preflightTimer -= delta;
      if (this._preflightTimer <= 0) {
        this._preflightStarted = true;
        this._spawnPreflightJets();
      }
    }

    if (this._preflightStarted) {
      const remaining = config.enemyJet.preflightDefense.fighters - this.preflightKillCount;
      const currentZ = this.battleship?.mesh?.position?.z ?? this.openSeaStartZ;
      const distToShore = Math.max(0, Math.round(currentZ - this.shoreAnchorageZ));

      this.gameWorld.ui?.showObjective(
        'DEFEND & APPROACH ISLAND',
        remaining > 0
          ? `Flak battery: destroy incoming aircraft (${remaining} left). Distance to shore: ${distToShore}m.`
          : `Airspace clear. Distance to shore: ${distToShore}m. Report to flight deck to launch jet defense.`
      );
    }
  }

  _spawnPreflightJets() {
    const defense = config.enemyJet.preflightDefense;
    this.gameWorld.ui?.showToast('Hostile aircraft inbound! Man the aft flak battery!', 'danger', 3500);
    this.gameWorld.ui?.showObjective(
      'DEFEND WARSHIP & APPROACH ISLAND',
      `Man the aft flak battery and destroy ${defense.fighters} incoming aircraft.`
    );

    this.battleship.mesh.updateMatrixWorld(true);
    for (let index = 0; index < defense.fighters; index++) {
      const angle = index * Math.PI * 2 / defense.fighters;
      const localPosition = new THREE.Vector3(
        Math.sin(angle) * defense.spawnRadius,
        defense.spawnAltitude,
        Math.cos(angle) * defense.spawnRadius
      );
      const position = this.battleship.mesh.localToWorld(localPosition);
      const enemy = new EnemyJet(this.gameWorld, {
        position,
        target: this.battleship,
        variant: 'fighter',
        maxHealth: defense.fighterHealth,
        onDestroyed: (jet) => this._onPreflightEnemyDestroyed(jet)
      });
      this.preflightJets.add(enemy);
      this.gameWorld.addEntity(enemy);
    }
  }

  _onPreflightEnemyDestroyed(jet) {
    if (this.preflightDefenseComplete || !this.preflightJets.has(jet)) return;
    this.preflightKillCount++;
    this.gameWorld.ui?.showToast('Hostile aircraft destroyed!', 'success', 1600);

    if (this.preflightKillCount >= config.enemyJet.preflightDefense.fighters) {
      this.preflightDefenseComplete = true;
      const currentZ = this.battleship?.mesh?.position?.z ?? this.openSeaStartZ;
      const distToShore = Math.max(0, Math.round(currentZ - this.shoreAnchorageZ));
      this.gameWorld.ui?.showToast('Airspace secured! Island shores ahead.', 'success', 3500);
      this.gameWorld.ui?.showObjective(
        'APPROACH THE ISLAND',
        `Distance to shore: ${distToShore}m. Report to flight deck to launch jet defense.`
      );
    }
  }

  _launchJetDefense() {
    if (!this.player || this.defenseMission) return;
    this.gameWorld.ui?.hidePrompt(this);

    if (this.cameraMode === 'AERIAL') this.setCameraMode('PLAYER');
    this.gameWorld.removeEntity(this.player);
    this.player = null;
    this.battleship.mesh.updateMatrixWorld(true);
    const spawnPosition = this.battleship.mesh.localToWorld(new THREE.Vector3(0, 80, -180));
    const launchRotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, this.battleship.mesh.rotation.y, 0)
    );
    this.playerJet = new PlayerJet(this.gameWorld, { position: spawnPosition, rotation: launchRotation });
    this.gameWorld.addEntity(this.playerJet);

    this.defenseMission = new EnemyJetManager(this.gameWorld, {
      battleship: this.battleship,
      onVictory: (result) => this._beginCampaignEnding(result)
    });
    this.defenseMission.start(this.playerJet);
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showPlayerHealth();
      this.gameWorld.ui.updatePlayerHealth(this.playerJet.health.currentHealth, this.playerJet.health.maxHealth);
      const controls = [
        { actions: ['throttleUp', 'throttleDown'], label: 'Throttle up / down' },
        { actions: ['pitchUp', 'pitchDown'], label: 'Pitch up / down' },
        { actions: ['rollLeft', 'rollRight'], label: 'Roll left / right' },
        { actions: ['yawLeft', 'yawRight'], label: 'Yaw left / right' },
        { actions: ['firePrimary'], label: 'Fire guns and defend the battleship' },
        { actions: ['pause'], label: 'Pause and options' }
      ];
      this.gameWorld.ui.showControlsHelper(controls.map(({ actions, label }) => ({
        keys: this.gameWorld.input.describeActions(actions),
        label
      })));
    }
  }

  _beginCampaignEnding(result) {
    this._endingResult = result;
    this._endingTimer = CAMPAIGN_ENDING.cinematicSeconds;
    this.state = 'ending';
    this.gameWorld.isPaused = false;
    if (this.playerJet) this.playerJet.isDevSuspended = true;
    if (this.gameWorld.ui) {
      this.gameWorld.ui.hideObjective();
      this.gameWorld.ui.showCinematic('AIRSPACE SECURE', 'The battleship is safe. Island shores reached.');
    }
  }

  _updateCampaignEnding(delta) {
    if (this.state === 'ending') {
      this._endingTimer -= delta;
      if (this._endingTimer <= 0) {
        this.state = 'transitioning';
        this.gameWorld.ui?.hideCinematic();
        this.gameWorld.loadLevel(new Level02(this.gameWorld));
      }
      return;
    }
  }

  dispose() {
    console.log(`Disposing ${this.name}...`);

    if (this.oceanSafetyCollider && this.gameWorld.physics) {
      if (this.oceanSafetyCollider.rigidBody) {
        this.gameWorld.physics.removeRigidBody(this.oceanSafetyCollider.rigidBody);
      } else {
        this.gameWorld.physics.removeCollider(this.oceanSafetyCollider);
      }
      this.oceanSafetyCollider = null;
    }

    if (this._onKeyDown) {
      window.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
    if (this.gameWorld && this.gameWorld.ui) {
      this.gameWorld.ui.hideDevTools();
      this.gameWorld.ui.hidePrompt(this);
      this.gameWorld.ui.hideObjective();
      this.gameWorld.ui.hideMissionResult();
      this.gameWorld.ui.hidePlayerHealth();
      this.gameWorld.ui.hideCredits();
      this.gameWorld.ui.hideCinematic();
    }
    if (this.defenseMission) {
      this.defenseMission.dispose();
      this.defenseMission = null;
    }
    if (this.fleetAssault) {
      this.fleetAssault.dispose();
      this.fleetAssault = null;
    }
    this.preflightJets.clear();
    if (this.orbitControls) {
      this.orbitControls.dispose();
      this.orbitControls = null;
    }

    this.gameWorld.setActiveCamera(null);

    if (this.gameWorld.projectilePool === this.projectilePool) {
      this.gameWorld.projectilePool = null;
    }
    this.projectilePool = null;
    this.player = null;
    this.playerJet = null;
    this.launchMarker = null;
    this.battleship = null;

    if (this.cover) {
      this.cover.dispose();
      this.cover = null;
    }
    if (this.environment) {
      this.environment.dispose();
      this.environment = null;
    }

    super.dispose();
    this.water = null;
  }
}
