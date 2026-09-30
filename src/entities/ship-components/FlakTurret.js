import * as THREE from 'three';
import { BaseStation } from './BaseStation.js';
import config from '../../config.json';
import { HealthComponent } from '../components/HealthComponent.js';

/**
 * FlakTurret
 * Anti-Aircraft rapid-fire quad turret mounted on the aft superstructure platform.
 * Child of Battleship in the Three.js scenegraph.
 * Features:
 * - Dedicated anti-air sight camera mounted behind quad barrels
 * - Proximity detection field on the aft elevated platform
 * - Interactive mounting: teleports player below the world (y = -100) and switches to flak camera
 * - Rapid 360-degree azimuth tracking and high-elevation anti-air aiming
 * - Clean dismount returning player safely back to the deck platform
 */
export class FlakTurret extends BaseStation {
  constructor(options = {}) {
    super({
      ...options,
      name: 'FlakTurret',
      promptText: options.promptText || 'OPERATE FLAK TURRET',
      accentColor: '#f4a261',
      stationType: 'flak',
      crosshairType: 'flak',
      hudConfig: { title: 'ANTI-AIR FLAK BATTERY' },
      detectionRadius: 4.8,
      position: options.position || new THREE.Vector3(0, 6.8, 16)
    });

    // Turret orientation angles
    this.yaw = 0;
    this.pitch = Math.PI / 6; // Default ~30 deg upward anti-air posture
    this.health = new HealthComponent(options.maxHealth ?? config.turrets.flak.maxHealth);
    this.isDestroyed = false;
    this.health.onDeath = () => {
      this.isDestroyed = true;
      if (this.isMounted) this.dismount(this.gameWorld);
      if (this.mesh) this.mesh.visible = false;
    };

    this.minPitch = -Math.PI / 18; // -10 deg
    this.maxPitch = Math.PI / 2.1; // ~85 deg high-angle flak fire

    // --- Card 2.2: Firing state ---
    // Pre-allocated scratchpads for firing calculations (zero heap allocations in updates)
    this._muzzleWorldPos = new THREE.Vector3();
    this._barrelWorldDir = new THREE.Vector3();

    // Rate of fire (rapid anti-air battery)
    const flakCfg = config.turrets.flak;
    this.fireCooldown = 0;
    this.fireRate = 1 / flakCfg.defaultRoundsPerSecond; // seconds between rounds

    // Distance from the pitch-group pivot to the muzzle tip along the barrel axis
    // (barrel mesh is 6.5m long, centered at local z = -3.2, so its tip sits ~6.45m
    // forward of the pitch pivot)
    this.barrelLength = 6.45;
    this.barrelRestZ = -3.2; // rest local-Z position of each barrel mesh

    // Visual recoil (barrel kickback)
    this.recoilOffset = 0;
    this.recoilKick = 0.25;         // meters of kickback per round (lighter, faster weapon)
    this.recoilRecoverySpeed = 4.0; // meters/sec spring-back rate

    this.turretMesh = options.turretMesh || null;
    this.barrelMesh = options.barrelMesh || null;
    this.yawGroup = this.turretMesh;
    this.pitchGroup = this.barrelMesh;

    // 1. Build the station detection field
    this._createMesh();

    // 2. Dedicated Anti-Air Camera
    this._createCamera();

    if (this.turretMesh && this.barrelMesh) {
      this.attachTurretNodes(this.turretMesh, this.barrelMesh);
    }
  }

  attachTurretNodes(turretMesh, barrelMesh) {
    this.turretMesh = turretMesh;
    this.barrelMesh = barrelMesh;
    this.yawGroup = turretMesh;
    this.pitchGroup = barrelMesh;
    if (this.turretMesh) this.turretMesh.userData.entity = this;
    if (this.barrelMesh) this.barrelMesh.userData.entity = this;

    if (this.camera) {
      if (this.camera.parent) this.camera.parent.remove(this.camera);

      // Check for camera anchor empty in barrelMesh or hierarchy
      const camAnchor = this.pitchGroup ? (
        this.pitchGroup.getObjectByName('PositionAntiAirGunCamera') ||
        this.pitchGroup.getObjectByName('CameraAnchor')
      ) : null;

      if (camAnchor) {
        this.camera.position.copy(camAnchor.position);
        this.camera.rotation.copy(camAnchor.rotation);
      } else {
        this.camera.position.set(0, 1.8, 2.2);
        this.camera.rotation.set(0, 0, 0);
      }

      this.pitchGroup.add(this.camera);
    }
  }

  _createMesh() {
    this.mesh = new THREE.Group();
    this.mesh.name = 'Ship_FlakTurret_Station';
    this.mesh.position.copy(this.position);
    this.mesh.userData = { noCollision: true, entity: this };

    this._createDetectField();
  }

  /**
   * Builds the glowing proximity detect field on the aft platform
   */
  _createDetectField() {
    this.detectFieldGroup = this.createDetectField({ radius: this.detectionRadius, color: 0xf4a261 });
    this.detectFieldGroup.position.set(0, 0.1, 0.0);
    this.detectFieldGroup.userData = { noCollision: true };
    this.mesh.add(this.detectFieldGroup);
  }

  /**
   * Adds the dedicated anti-air perspective camera to the pitch assembly
   */
  _createCamera() {
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );
    this.camera.name = 'FlakTurret_Camera';

    const camAnchor = this.pitchGroup ? (
      this.pitchGroup.getObjectByName('PositionAntiAirGunCamera') ||
      this.pitchGroup.getObjectByName('CameraAnchor')
    ) : null;

    if (camAnchor) {
      this.camera.position.copy(camAnchor.position);
      this.camera.rotation.copy(camAnchor.rotation);
    } else {
      this.camera.position.set(0, 1.8, 2.2);
      this.camera.rotation.set(0, 0, 0);
    }

    if (this.pitchGroup) {
      this.pitchGroup.add(this.camera);
    }
  }



  /**
   * Aim flak turret
   */
  setAim(targetYaw, targetPitch) {
    this.yaw = targetYaw;
    this.pitch = THREE.MathUtils.clamp(targetPitch, this.minPitch, this.maxPitch);

    if (this.yawGroup) this.yawGroup.rotation.y = this.yaw;
    if (this.pitchGroup) this.pitchGroup.rotation.x = this.pitch;
  }

  /**
   * Called automatically by BaseStation.mount
   */
  onMounted(player, gameWorld) {
    if (gameWorld && gameWorld.input && gameWorld.canvas) {
      gameWorld.input.requestPointerLock(gameWorld.canvas);
    }
  }

  /**
   * Computes the current world-space muzzle position & aim direction into the
   * pre-allocated scratchpads (no per-frame allocations).
   */
  _updateMuzzleTransform() {
    // In AntiAirBarrels local coordinates, the 4 barrels point along local -Z.
    // Transform (0, 0, -1) to world space to obtain the true forward firing vector.
    this._barrelWorldDir.set(0, 0, -1).transformDirection(this.pitchGroup.matrixWorld);

    // Muzzle tip position: local (0, 0.48, -4.6) sits directly at the tips of the 4 barrels
    this._muzzleWorldPos.set(0, 0.48, -4.6).applyMatrix4(this.pitchGroup.matrixWorld);
  }

  /**
   * Fires one rapid flak tracer round from the projectile pool.
   */
  _fireWeapon() {
    const pool = this.gameWorld?.projectilePool;
    if (!pool) return;

    this._updateMuzzleTransform();

    pool.fireFlak({
      origin: this._muzzleWorldPos,
      direction: this._barrelWorldDir,
      source: this
    });

    this._triggerRecoil();
  }

  /**
   * Kicks off the visual barrel recoil animation.
   */
  _triggerRecoil() {
    this.recoilOffset = this.recoilKick;
  }

  /**
   * Smoothly springs the barrels back to their rest position after firing.
   */
  _updateRecoil(delta) {
    if (this.recoilOffset <= 0) return;

    this.recoilOffset = Math.max(0, this.recoilOffset - delta * this.recoilRecoverySpeed);
    if (this.barrelMesh) {
      this.barrelMesh.position.z = 0.80 + this.recoilOffset;
    }
  }

  /**
   * Refreshes the gunner HUD's reload progress bar/label to reflect fireCooldown.
   */
  _updateReloadIndicator(gameWorld = this.gameWorld) {
    if (!gameWorld || !gameWorld.ui) return;

    const ready = this.fireCooldown <= 0;
    const pct = ready ? 100 : THREE.MathUtils.clamp(100 - (this.fireCooldown / this.fireRate) * 100, 0, 100);

    gameWorld.ui.updateStationHUD('flak', {
      ready,
      pct,
      label: ready ? 'READY' : 'CYCLING'
    });
  }

  /**
   * Update loop: handles idle sweep (when unmanned), proximity detection, prompt display, mounting, aiming, firing, and dismounting
   */
  update(delta, gameWorld = this.gameWorld) {
    this.updateCooldown(delta);
    this._updateRecoil(delta);

    if (this.fireCooldown > 0) {
      this.fireCooldown -= delta;
    }

    // -------------------------------------------------------------
    // A. GUNNER MOUNTED: AIMING, FIRING & DISMOUNT LOGIC
    // -------------------------------------------------------------
    if (this.isMounted) {
      if (gameWorld && gameWorld.input) {
        const input = gameWorld.input;

        // Dismount on [E] or [ESC]
        const wantsDismount = (input.isActionJustPressed('specialAction') || input.isActionJustPressed('pause')) && this.mountCooldown <= 0;
        if (wantsDismount) {
          this.dismount(gameWorld);
          return;
        }

        // Mouse Aiming (Fast tracking for anti-air)
        const isDragging = input.isActionDown('mouseLook');
        if (input.isPointerLocked || isDragging) {
          this.yaw -= input.mouseDelta.x * 0.0025;
          this.pitch -= input.mouseDelta.y * 0.0025;
        }

        // Keyboard Aiming
        const yawAxis = input.getAxis('aimRight', 'aimLeft');
        const pitchAxis = input.getAxis('aimDown', 'aimUp');
        if (yawAxis !== 0) this.yaw += yawAxis * 1.2 * delta;
        if (pitchAxis !== 0) this.pitch += pitchAxis * 0.9 * delta;

        this.setAim(this.yaw, this.pitch);

        // Fire the rapid-fire flak battery (held down for sustained fire)
        const wantsFire = input.isActionDown('firePrimary');
        if (wantsFire && this.fireCooldown <= 0) {
          this.fireCooldown = this.fireRate;
          this._fireWeapon();
        }

        this._updateReloadIndicator(gameWorld);
      }
      return;
    }

    // -------------------------------------------------------------
    // B. UNMOUNTED: PROXIMITY DETECTION FIELD CHECK
    // -------------------------------------------------------------
    this.checkProximity(delta, gameWorld);
  }
}