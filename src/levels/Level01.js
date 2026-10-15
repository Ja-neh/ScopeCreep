import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BaseLevel } from './BaseLevel.js';
import { Ocean } from '../rendering/Ocean.js';
import { ShadowFrustum } from '../rendering/ShadowFrustum.js';
import { Battleship } from '../entities/Battleship.js';
import { Player } from '../entities/Player.js';
import { ProjectilePool } from '../entities/ProjectilePool.js';
import { PlayerJet } from '../entities/player-jet/PlayerJet.js';
import { EnemyJet } from '../entities/enemies/EnemyJet.js';
import { JetDefenseMission } from './JetDefenseMission.js';
import { CAMPAIGN_ENDING, CAMPAIGN_CREDITS } from './level01/ending.js';
import config from '../config.json';

/**
 * Level01
 * Act 1: Operation Retake - At Sea
 * Features:
 * - Custom GPU Gerstner Ocean Shader
 * - Floating battleship with wave buoyancy & kinematic physics
 * - Human player avatar walking on deck
 * - Interactive gun turrets (ArtilleryTurret & FlakTurret)
 * - Built-in Dev Tools to toggle between Player and Aerial Orbit Camera
 */
export class Level01 extends BaseLevel {
  constructor(gameWorld) {
    super(gameWorld, 'Level 1: Operation Retake (At Sea)');
    this.water = null;
    this.battleship = null;
    this.player = null;
    this.playerJet = null;
    this.projectilePool = null;
    this.defenseMission = null;
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

    // Dev Tools Camera System
    this.cameraMode = 'PLAYER'; // 'PLAYER' | 'AERIAL'
    this.aerialCamera = null;
    this.orbitControls = null;
    this._onKeyDown = null;
  }

  async init() {
    await super.init();

    // 1. Atmosphere & Sky
    this.gameWorld.scene.background = new THREE.Color(0x87ceeb); // Ocean daylight sky
    this.gameWorld.scene.fog = new THREE.FogExp2(0x87ceeb, 0.0010);

    // 2. Directional Sun & Ambient Lighting
    const sunDirection = new THREE.Vector3(150, 250, 100).normalize();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    this.gameWorld.environmentGroup.add(ambientLight);
    this.trackDisposable(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.4);
    sunLight.position.set(150, 250, 100);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.bias = -0.0005;
    // The shadow square follows the player: fitted depth range, snapped to shadow-map texels
    this.sunShadow = new ShadowFrustum(sunLight, { halfExtent: 400 });
    this.gameWorld.environmentGroup.add(sunLight);
    this.trackDisposable(sunLight);

    // 3. Custom Ocean Mesh & Shader
    this.water = new Ocean({
      size: 2600,
      segments: 200,
      sunDirection: sunDirection
    });
    this.gameWorld.environmentGroup.add(this.water.mesh);
    this.trackDisposable(this.water);

    // 3.5 High-Performance Projectile Object Pool
    this.projectilePool = new ProjectilePool(this.gameWorld);
    this.gameWorld.addEntity(this.projectilePool);
    this.gameWorld.projectilePool = this.projectilePool;

    // 4. Instantiate Modern Battleship with Ocean Buoyancy
    this.battleship = new Battleship(this.gameWorld, {
      position: new THREE.Vector3(0, 0, 0),
      water: this.water
    });
    await this.battleship.ready;
    this.gameWorld.addEntity(this.battleship);
    this.battleship.initPhysics(this.gameWorld.physics);

    // 5. Spawn Player Character Controller on the Battleship Walking Deck
    this.player = new Player(this.gameWorld, {
      walkSpeed: 8.0,
      sprintSpeed: 14.0,
      jumpForce: 10.0
    });
    // Position player on forward walking deck
    this.player.setPosition(0.46, 6.2, -14.0);
    this.player.yaw = 0;
    this.gameWorld.addEntity(this.player);

    this._createJetLaunchMarker();
    this._preflightTimer = config.enemyJet.preflightDefense.firstWaveDelaySeconds;
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showObjective(
        'SHIP DEFENSE',
        `Man the aft flak battery and destroy ${config.enemyJet.preflightDefense.fighters} incoming aircraft.`
      );
    }

    // 6. Initialize Aerial Inspection Camera & OrbitControls
    this._initAerialCamera();

    // 7. Initialize Dev Tools UI Overlay & Keybinds
    this._initDevTools();

    // 8. Ocean surface safety floor (catches players falling overboard so they don't fall into the void)
    this.oceanSafetyCollider = this.gameWorld.physics.createGround(3000, -1.0);

    console.log(`${this.name} initialized with Battleship, Deck Player, and Dev Camera Tools.`);
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
    this.aerialCamera.position.set(0, 52, 105);
    this.aerialCamera.lookAt(0, 5, 0);

    this.orbitControls = new OrbitControls(this.aerialCamera, this.gameWorld.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.02; // Keep camera above water
    this.orbitControls.minDistance = 5;
    this.orbitControls.maxDistance = 2500;
    this.orbitControls.target.set(0, 5, 0);
    this.orbitControls.enabled = false; // Disabled by default in player mode
  }

  /**
   * Sets the active camera mode ('PLAYER' or 'AERIAL')
   */
  setCameraMode(mode) {
    if (mode === this.cameraMode) return;
    this.cameraMode = mode;

    if (mode === 'AERIAL') {
      // Exit pointer lock for smooth orbit mouse interaction
      if (document.exitPointerLock) {
        document.exitPointerLock();
      }

      // Suspend player controller input and updates
      if (this.player) {
        this.player.isDevSuspended = true;
      }

      // Enable OrbitControls and target the battleship
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

      // Switch rendering to Aerial camera
      this.gameWorld.setActiveCamera(this.aerialCamera);
      console.log('Level1 DevTools: Switched to [AERIAL ORBIT CAMERA].');
    } else {
      // Return to PLAYER mode
      if (this.orbitControls) {
        this.orbitControls.enabled = false;
      }

      if (this.player) {
        this.player.isDevSuspended = false;
      }

      // Restore active camera to null (master player camera)
      this.gameWorld.setActiveCamera(null);
      console.log('Level1 DevTools: Switched to [PLAYER CONTROLLER CAMERA].');
    }

    if (this.gameWorld && this.gameWorld.ui) {
      this.gameWorld.ui.updateDevToolsCamera(mode);
    }
  }

  /**
   * Creates the on-screen Dev Tools widget and attaches hotkey listeners
   */
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

    // Keyboard shortcuts listener for Level 1 camera modes: 'Digit1', 'Digit2', 'F1', 'KeyO'
    this._onKeyDown = (e) => {
      // Don't trigger if typing in an input
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

    // Keep the sun's shadow square on the player
    if (this.sunShadow) this.sunShadow.update(this.player || null);

    // 1. Animate the custom ocean wave displacement
    if (this.water) {
      this.water.update(delta);
    }

    this._updateJetLaunch();
    this._updatePreflightDefense(delta);
    if (this.defenseMission) this.defenseMission.update(delta);
    this._updateCampaignEnding(delta);

    // 2. Update aerial orbit controls when in AERIAL mode
    if (this.orbitControls && this.cameraMode === 'AERIAL') {
      this.orbitControls.update();

      // Smoothly follow battleship position while floating
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

    // 3. Void fall recovery: respawn player back to forward walking deck if fallen below -15m
    if (this.player && this.player.position && this.player.position.y < -15 && this.battleship && this.battleship.mesh) {
      const respawnWorld = new THREE.Vector3(0.46, 6.2, -14.0);
      this.battleship.mesh.localToWorld(respawnWorld);
      this.player.teleport(respawnWorld.x, respawnWorld.y + 0.2, respawnWorld.z);
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
      this.gameWorld.ui?.showObjective(
        'SHIP DEFENSE',
        remaining > 0
          ? `Man the aft flak battery and destroy the incoming aircraft. ${remaining} remaining.`
          : 'Airspace clear. Report to the marked flight deck to launch jet defense.'
      );
    }
  }

  _spawnPreflightJets() {
    const defense = config.enemyJet.preflightDefense;
    this.gameWorld.ui?.showToast('Hostile aircraft inbound! Man the aft flak battery!', 'danger', 3500);
    this.gameWorld.ui?.showObjective(
      'SHIP DEFENSE',
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
      this.gameWorld.ui?.showToast('Ship defense complete. Proceed to the flight deck.', 'success', 3500);
      this.gameWorld.ui?.showObjective(
        'SHIP DEFENSE COMPLETE',
        'Report to the marked flight deck to launch jet defense.'
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

    this.defenseMission = new JetDefenseMission(this.gameWorld, this.battleship, {
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
      this.gameWorld.ui.showCinematic('AIRSPACE SECURE', 'The battleship is safe. Operation Retake is complete.');
    }
  }

  _updateCampaignEnding(delta) {
    if (this.state === 'ending') {
      this._endingTimer -= delta;
      if (this._endingTimer <= 0) {
        this.state = 'credits';
        this._creditsTimer = 0;
        this.gameWorld.ui?.hideCinematic();
        this.gameWorld.ui?.showCredits(CAMPAIGN_CREDITS, CAMPAIGN_ENDING.creditsSeconds, '[Space] Skip');
      }
      return;
    }

    if (this.state !== 'credits') return;
    this._creditsTimer += delta;
    if (this._creditsTimer >= CAMPAIGN_ENDING.skipAfterSeconds &&
      (this._creditsTimer >= CAMPAIGN_ENDING.creditsSeconds || this.gameWorld.input.isActionJustPressed('skipCutscene'))) {
      this.gameWorld.ui?.hideCredits();
      this.state = 'won';
      this.gameWorld.isPaused = true;
      this.gameWorld.ui?.showMissionResult({
        ...this._endingResult,
        title: 'OPERATION RETAKE COMPLETE',
        message: 'Enemy airspace is clear and the battleship is safe.',
        actions: [
          { label: 'Play again', onClick: () => this.gameWorld.restartCurrentLevel() },
          { label: 'Main menu', onClick: () => this.gameWorld.returnToMainMenu() }
        ]
      });
    }
  }

  dispose() {
    console.log(`Disposing ${this.name}...`);

    // Teardown ocean safety collider
    if (this.oceanSafetyCollider && this.gameWorld.physics) {
      this.gameWorld.physics.removeCollider(this.oceanSafetyCollider);
      this.oceanSafetyCollider = null;
    }

    // Teardown Dev Tools UI & listeners
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
    this.preflightJets.clear();
    if (this.orbitControls) {
      this.orbitControls.dispose();
      this.orbitControls = null;
    }

    // Restore master camera
    this.gameWorld.setActiveCamera(null);

    if (this.gameWorld.projectilePool === this.projectilePool) {
      this.gameWorld.projectilePool = null;
    }
    this.projectilePool = null;
    this.player = null;
    this.playerJet = null;
    this.launchMarker = null;
    this.battleship = null;

    super.dispose();
    this.water = null;
  }
}
