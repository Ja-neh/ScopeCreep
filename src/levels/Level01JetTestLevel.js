import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BaseLevel } from './BaseLevel.js';
import { Ocean } from '../rendering/Ocean.js';
import { Battleship } from '../entities/Battleship.js';
import { ProjectilePool } from '../entities/ProjectilePool.js';
import { PlayerJet } from '../entities/player-jet/PlayerJet.js';
import { EnemyJet } from '../entities/enemies/EnemyJet.js';
import config from '../config.json';

/**
 * Level01JetTestLevel
 * Dedicated testing level for the Player Jet.
 * Features:
 * - Identical ocean, sky, and lighting conditions as Level 1
 * - Player battleship present in the water as a landmark and target
 * - Projectile pool ready for airborne cannon/bullet tests
 * - Open airspace for testing aerodynamics, flight controls, and chase camera
 */
export class Level01JetTestLevel extends BaseLevel {
  constructor(gameWorld) {
    super(gameWorld, 'Level 1: Jet Test Level');
    this.water = null;
    this.battleship = null;
    this.playerJet = null;
    this.enemyJets = new Set();
    this.projectilePool = null;
    this.state = 'ready';
    this.elapsed = 0;
    this.killCount = 0;
    this.aceKillCount = 0;
    this.score = 0;
    this._waveIndex = 0;
    this._spawnQueue = [];
    this._spawnTimer = 0;
    this._waveTimer = 0;

    // Dev Tools Camera System
    this.cameraMode = 'PLAYER'; // 'PLAYER' | 'AERIAL'
    this.aerialCamera = null;
    this.orbitControls = null;
    this._onKeyDown = null;
  }

  get controls() {
    return [
      { actions: ['throttleUp', 'throttleDown'], label: 'Throttle up / down' },
      { actions: ['pitchUp', 'pitchDown'], label: 'Pitch up / down' },
      { actions: ['rollLeft', 'rollRight'], label: 'Roll left / right' },
      { actions: ['yawLeft', 'yawRight'], label: 'Yaw left / right' },
      { actions: ['firePrimary'], label: 'Fire guns and defend the battleship' },
      { actions: ['pause'], label: 'Pause and options' }
    ];
  }

  async init() {
    await super.init();

    // 1. Atmosphere & Sky
    this.gameWorld.scene.background = new THREE.Color(0x87ceeb);
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
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 1200;
    const d = 400;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    this.gameWorld.environmentGroup.add(sunLight);
    this.trackDisposable(sunLight);

    // 3. Ocean Mesh & Shader
    this.water = new Ocean({
      size: 2600,
      segments: 200,
      sunDirection: sunDirection
    });
    this.gameWorld.environmentGroup.add(this.water.mesh);
    this.trackDisposable(this.water);

    // 4. Projectile Object Pool
    this.projectilePool = new ProjectilePool(this.gameWorld);
    this.gameWorld.addEntity(this.projectilePool);
    this.gameWorld.projectilePool = this.projectilePool;

    // 5. Battleship (serves as a naval target and ocean landmark)
    this.battleship = new Battleship(this.gameWorld, {
      position: new THREE.Vector3(0, 0, 0),
      water: this.water
    });
    await this.battleship.ready;
    this.gameWorld.addEntity(this.battleship);
    this.battleship.initPhysics(this.gameWorld.physics);

    // 6. Spawn Player Jet in Open Airspace (Hovering 80m above the ocean)
    this.playerJet = new PlayerJet(this.gameWorld, {
      position: new THREE.Vector3(0, 80, -200),
      onDestroyed: () => this._finishDefense(false, 'Your jet was shot down.')
    });
    this.gameWorld.addEntity(this.playerJet);
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showPlayerHealth();
      this.gameWorld.ui.updatePlayerHealth(this.playerJet.health.currentHealth, this.playerJet.health.maxHealth);
    }
    this._beginDefenseMission();

    // 7. Initialize Aerial Dev Camera & OrbitControls
    this._initAerialCamera();

    // 8. Initialize Dev Tools UI
    this._initDevTools();

    // 9. Ocean safety collider
    this.oceanSafetyCollider = this.gameWorld.physics.createGround(3000, -1.0);

    console.log(`${this.name} initialized. Open airspace ready for Player Jet.`);
  }

  _initAerialCamera() {
    this.aerialCamera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      3000
    );
    this.aerialCamera.position.set(0, 100, 160);
    this.aerialCamera.lookAt(0, 10, 0);

    this.orbitControls = new OrbitControls(this.aerialCamera, this.gameWorld.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.orbitControls.minDistance = 5;
    this.orbitControls.maxDistance = 3000;
    this.orbitControls.target.set(0, 10, 0);
    this.orbitControls.enabled = false;
  }

  setCameraMode(mode) {
    if (mode === this.cameraMode) return;
    this.cameraMode = mode;

    if (mode === 'AERIAL') {
      if (document.exitPointerLock) {
        document.exitPointerLock();
      }

      if (this.orbitControls) {
        this.orbitControls.enabled = true;
        if (this.playerJet && this.playerJet.mesh) {
          this.orbitControls.target.copy(this.playerJet.mesh.position);
        } else if (this.battleship && this.battleship.mesh) {
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

    if (this.water) {
      this.water.update(delta);
    }

    this._updateDefenseMission(delta);

    if (this.orbitControls && this.cameraMode === 'AERIAL') {
      this.orbitControls.update();
      if (this.playerJet && this.playerJet.mesh) {
        this.orbitControls.target.lerp(this.playerJet.mesh.position, 0.05);
      }
    }
  }

  _beginDefenseMission() {
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

  _startDefenseWave() {
    const waves = config.enemyJet.waves;
    const wave = waves[this._waveIndex];
    this._spawnQueue = [
      ...Array(wave.fighters).fill('fighter'),
      ...Array(wave.aces).fill('ace')
    ];
    this._spawnTimer = 0;
    this.state = 'combat';
    if (this.gameWorld.ui) {
      this.gameWorld.ui.showToast(
        `Wave ${this._waveIndex + 1} of ${waves.length}: ${this._spawnQueue.length} enemy aircraft inbound!`,
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

  _updateDefenseMission(delta) {
    if (this.state === 'won' || this.state === 'lost' || this.state === 'ready') return;
    this.elapsed += delta;

    if (this.playerJet?.isDestroyed) {
      this._finishDefense(false, 'Your jet was shot down.');
      return;
    }
    if (this.battleship?.isDestroyed) {
      this._finishDefense(false, 'The battleship has been destroyed.');
      return;
    }

    if (this.state === 'incoming') {
      this._waveTimer -= delta;
      if (this._waveTimer <= 0) this._startDefenseWave();
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
          this._finishDefense(true, 'The battleship survived all three waves.');
          return;
        }
        this.state = 'intermission';
        this._waveTimer = config.enemyJet.defense.betweenWavesSeconds;
        this._waveIndex++;
      }
    } else if (this.state === 'intermission') {
      this._waveTimer -= delta;
      if (this._waveTimer <= 0) this._startDefenseWave();
    }

    const remaining = this._spawnQueue.length + [...this.enemyJets].filter((enemy) => !enemy.isDestroyed).length;
    const waves = config.enemyJet.waves;
    const title = this.state === 'intermission'
      ? `WAVE ${this._waveIndex + 1} INCOMING`
      : this.state === 'incoming'
        ? 'DEFEND THE BATTLESHIP'
        : `DEFEND THE BATTLESHIP — WAVE ${this._waveIndex + 1}/${waves.length}`;
    const detail = this.state === 'intermission'
      ? `Regroup — next wave in ${Math.ceil(this._waveTimer)}s`
      : `Hostiles: ${remaining}  |  Score: ${this.score}  |  Battleship: ${Math.ceil((this.battleship.health.currentHealth / this.battleship.health.maxHealth) * 100)}%`;
    if (this.gameWorld.ui) this.gameWorld.ui.showObjective(title, detail);
  }

  _finishDefense(victory, message) {
    if (this.state === 'won' || this.state === 'lost') return;
    this.state = victory ? 'won' : 'lost';
    this.gameWorld.isPaused = true;
    this.gameWorld.input.exitPointerLock();

    const ui = this.gameWorld.ui;
    if (!ui) return;
    ui.hideObjective();
    const perfectDefense = victory && this.battleship.health.currentHealth === this.battleship.health.maxHealth;
    const finalScore = this.score + (perfectDefense ? 500 : 0);
    const minutes = Math.floor(this.elapsed / 60);
    const seconds = Math.floor(this.elapsed % 60).toString().padStart(2, '0');
    ui.showMissionResult({
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
    });
  }

  dispose() {
    console.log(`Disposing ${this.name}...`);

    if (this.oceanSafetyCollider && this.gameWorld.physics) {
      this.gameWorld.physics.removeCollider(this.oceanSafetyCollider);
      this.oceanSafetyCollider = null;
    }

    if (this._onKeyDown) {
      window.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
    if (this.gameWorld && this.gameWorld.ui) {
      this.gameWorld.ui.hideDevTools();
      this.gameWorld.ui.hideObjective();
      this.gameWorld.ui.hideMissionResult();
      this.gameWorld.ui.hidePlayerHealth();
    }
    if (this.orbitControls) {
      this.orbitControls.dispose();
      this.orbitControls = null;
    }

    this.gameWorld.setActiveCamera(null);

    if (this.gameWorld.projectilePool === this.projectilePool) {
      this.gameWorld.projectilePool = null;
    }
    this.projectilePool = null;
    this.playerJet = null;
    this.enemyJets.clear();
    this.battleship = null;

    super.dispose();
    this.water = null;
  }
}
