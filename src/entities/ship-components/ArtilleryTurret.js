import * as THREE from 'three';
import { BaseStation } from './BaseStation.js';
import config from '../../config.json';
import { HealthComponent } from '../components/HealthComponent.js';

/**
 * ArtilleryTurret
 * Heavy dual-barrel naval artillery turret mounted on the forward deck.
 * Child of Battleship in the Three.js scenegraph.
 * Features:
 * - Dedicated sight camera mounted along twin artillery barrels
 * - Proximity detection field on the forward deck
 * - Interactive mounting: teleports player below the world (y = -100) and switches to gun camera
 * - Smooth turret yaw and barrel pitch aiming with mouse and keyboard
 * - Clean dismount returning player back to deck
 */
export class ArtilleryTurret extends BaseStation {
  constructor(options = {}) {
    super({
      ...options,
      name: options.name || 'ArtilleryTurret',
      detectionRadius: options.detectionRadius || 4.5,
      position: options.position || new THREE.Vector3(0, 4.2, -22),
      stationType: 'artillery',
      crosshairType: 'artillery',
      hudConfig: { title: options.title || 'MAIN ARTILLERY TURRET' }
    });

    this.turretTitle = options.title || 'MAIN ARTILLERY TURRET';
    this.promptText = options.promptText || 'OPERATE MAIN ARTILLERY GUN';
    this.accentColor = '#e76f51';
    this.battleship = options.battleship || null;
    this.isAI = options.isAI || false;
    this._faction = options.faction || null;

    // Turret orientation angles
    this.yaw = 0;   // Left/Right rotation relative to ship heading
    this.pitch = 0; // Barrel vertical elevation (0 to ~30 deg)
    this.health = new HealthComponent(options.maxHealth ?? config.turrets.artillery.maxHealth);
    this.isDestroyed = false;
    this.health.onDeath = () => {
      this.isDestroyed = true;
      if (this.isMounted) this.dismount(this.gameWorld);
      if (this.mesh) this.mesh.visible = false;
    };

    // Limits
    this.maxYaw = Math.PI * 0.75; // 135 degrees arc to port and starboard
    this.minPitch = 0.0;
    this.maxPitch = Math.PI / 6;  // ~30 degrees max elevation

    // --- Card 2.2: Firing state ---
    // Pre-allocated scratchpads for firing calculations (zero heap allocations in updates)
    this._muzzleWorldPos = new THREE.Vector3();
    this._barrelWorldDir = new THREE.Vector3();
    this._targetLocalPos = new THREE.Vector3();
    this._turretLocalPos = new THREE.Vector3();

    // Rate of fire (heavy naval cannon, slow reload)
    const artilleryCfg = config.turrets.artillery;
    this.fireCooldown = 0;
    this.fireRate = options.reloadCadence ?? artilleryCfg.defaultReloadCadence; // seconds between shots
    this.damage = options.damage !== undefined ? options.damage : config.projectiles.artillery.damage;

    // Distance from the pitch-group pivot to the muzzle tip along the barrel axis
    this.barrelLength = 13.5;
    this.barrelRestZ = 1.43; // rest local-Z position of barrel mesh

    // Visual recoil (barrel kickback)
    this.recoilOffset = 0;
    this.recoilKick = 0.4;          // meters of kickback per shot
    this.recoilRecoverySpeed = 1.6; // meters/sec spring-back rate

    this.turretMesh = options.turretMesh || null;
    this.barrelMesh = options.barrelMesh || null;
    this.yawGroup = this.turretMesh;
    this.pitchGroup = this.barrelMesh;

    // 1. Build the station detection field
    this._createMesh();

    if (!this.yawGroup) this.yawGroup = this.mesh;
    if (!this.pitchGroup) this.pitchGroup = this.mesh;

    // 2. Dedicated Aiming Camera
    this._createCamera();

    if (this.turretMesh && this.barrelMesh) {
      this.attachTurretNodes(this.turretMesh, this.barrelMesh);
    }
  }

  get faction() {
    return this._faction || this.battleship?.faction || 'humans';
  }

  set faction(val) {
    this._faction = val;
  }

  attachTurretNodes(turretMesh, barrelMesh) {
    this.turretMesh = turretMesh;
    this.barrelMesh = barrelMesh;
    this.yawGroup = turretMesh || this.mesh;
    this.pitchGroup = barrelMesh || this.mesh;
    if (this.turretMesh) this.turretMesh.userData.entity = this;
    if (this.barrelMesh) this.barrelMesh.userData.entity = this;

    if (this.camera) {
      if (this.camera.parent) this.camera.parent.remove(this.camera);
      this.camera.position.set(0, 1.8, -2.2);
      this.camera.rotation.set(0, Math.PI, 0);
      this.pitchGroup.add(this.camera);
    }
  }

  _createMesh() {
    // Root group placed on the deck for operator station detection
    this.mesh = new THREE.Group();
    this.mesh.name = `${this.stationName}_Station`;
    this.mesh.position.copy(this.position);
    this.mesh.userData = { noCollision: true, entity: this };

    // Proximity Detect Field on Deck (Operator Area)
    this._createDetectField();
  }

  /**
   * Builds the glowing proximity detect field on the deck
   */
  _createDetectField() {
    this.detectFieldGroup = this.createDetectField({ radius: this.detectionRadius, color: 0xe76f51 });
    this.detectFieldGroup.position.set(0, 0.1, 0.0);
    this.detectFieldGroup.userData = { noCollision: true };
    if (this.isAI) {
      this.detectFieldGroup.visible = false;
    }
    this.mesh.add(this.detectFieldGroup);
  }

  /**
   * Adds the dedicated aiming perspective camera to the pitch assembly
   */
  _createCamera() {
    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );
    this.camera.name = `${this.stationName}_Camera`;

    // Position camera looking directly forward down the twin barrels (-Z in world)
    this.camera.position.set(0, 1.8, -2.2);
    this.camera.rotation.set(0, Math.PI, 0);

    // Adding to pitchGroup ensures camera pitches and yaws identically with the artillery barrels
    if (this.pitchGroup) {
      this.pitchGroup.add(this.camera);
    }
  }



  /**
   * Aim turret at local yaw (azimuth) and pitch (elevation)
   */
  setAim(targetYaw, targetPitch) {
    this.yaw = THREE.MathUtils.clamp(targetYaw, -this.maxYaw, this.maxYaw);
    this.pitch = THREE.MathUtils.clamp(targetPitch, this.minPitch, this.maxPitch);

    if (this.yawGroup) this.yawGroup.rotation.y = this.yaw;
    if (this.pitchGroup) this.pitchGroup.rotation.x = -this.pitch;
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
    // World position of the barrel pivot
    this.pitchGroup.getWorldPosition(this._muzzleWorldPos);

    // getWorldDirection() returns the object's +Z local axis in world space, which points forward (-Z world).
    this.pitchGroup.getWorldDirection(this._barrelWorldDir);

    // Offset from the pivot out to the muzzle tip
    this._muzzleWorldPos.addScaledVector(this._barrelWorldDir, this.barrelLength);
  }

  /**
   * Fires one heavy artillery shell from the projectile pool.
   */
  _fireWeapon() {
    const pool = this.gameWorld?.projectilePool;
    if (!pool) return;

    this._updateMuzzleTransform();

    pool.fireArtillery({
      origin: this._muzzleWorldPos,
      direction: this._barrelWorldDir,
      damage: this.damage,
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
      this.barrelMesh.position.z = 1.43 - this.recoilOffset;
    }
  }

  /**
   * Refreshes the gunner HUD's reload progress bar/label to reflect fireCooldown.
   */
  _updateReloadIndicator(gameWorld = this.gameWorld) {
    if (!gameWorld || !gameWorld.ui) return;

    const ready = this.fireCooldown <= 0;
    const pct = ready ? 100 : THREE.MathUtils.clamp(100 - (this.fireCooldown / this.fireRate) * 100, 0, 100);

    gameWorld.ui.updateStationHUD('artillery', {
      ready,
      pct,
      label: ready ? 'READY' : 'RELOADING'
    });
  }

  /**
   * AI aiming routine: computes relative azimuth (yaw) and ballistic elevation pitch
   * towards a world-space target position, smoothly slewing the gun mounts.
   * @param {THREE.Vector3} targetWorldPos
   * @param {number} delta
   * @param {number} turnSpeed - Yaw traversal speed (rad/s)
   * @param {number} elevationSpeed - Pitch elevation speed (rad/s)
   * @returns {{ onTarget: boolean, angleDiff: number }}
   */
  aimTowards(targetWorldPos, delta, turnSpeed = 0.5, elevationSpeed = 0.3) {
    if (!this.yawGroup || !this.pitchGroup || this.isDestroyed) {
      return { onTarget: false, angleDiff: Math.PI };
    }

    const shipMesh = this.battleship?.mesh || this.mesh;
    if (!shipMesh) return { onTarget: false, angleDiff: Math.PI };

    // Get turret world position and transform into vessel hull coordinates
    this.yawGroup.getWorldPosition(this._turretLocalPos);
    shipMesh.worldToLocal(this._turretLocalPos);

    // Transform world target into vessel hull coordinates
    this._targetLocalPos.copy(targetWorldPos);
    shipMesh.worldToLocal(this._targetLocalPos);

    const dx = this._targetLocalPos.x - this._turretLocalPos.x;
    const dy = this._targetLocalPos.y - this._turretLocalPos.y;
    const dz = this._targetLocalPos.z - this._turretLocalPos.z;

    const horizDist = Math.hypot(dx, dz);
    if (horizDist < 0.1) return { onTarget: false, angleDiff: Math.PI };

    // Desired yaw: in vessel coordinates, bow is along -Z, starboard is +X
    const desiredYaw = Math.atan2(-dx, -dz);

    // Ballistic drop compensation for artillery
    const artilleryCfg = config.projectiles.artillery;
    const speed = artilleryCfg.speed || 220.0;
    const gravity = Math.abs(artilleryCfg.gravity || 18.0);
    const timeOfFlight = horizDist / speed;
    const ballisticDrop = 0.5 * gravity * timeOfFlight * timeOfFlight;
    const compDy = dy + ballisticDrop;

    const desiredPitch = Math.atan2(compDy, horizDist);

    // Mechanical limits
    const targetYaw = THREE.MathUtils.clamp(desiredYaw, -this.maxYaw, this.maxYaw);
    const targetPitch = THREE.MathUtils.clamp(desiredPitch, this.minPitch, this.maxPitch);

    // Smooth traversal
    const yawDiff = targetYaw - this.yaw;
    const pitchDiff = targetPitch - this.pitch;

    const maxStepYaw = turnSpeed * delta;
    const maxStepPitch = elevationSpeed * delta;

    if (Math.abs(yawDiff) <= maxStepYaw) {
      this.yaw = targetYaw;
    } else {
      this.yaw += Math.sign(yawDiff) * maxStepYaw;
    }

    if (Math.abs(pitchDiff) <= maxStepPitch) {
      this.pitch = targetPitch;
    } else {
      this.pitch += Math.sign(pitchDiff) * maxStepPitch;
    }

    this.setAim(this.yaw, this.pitch);

    const totalAngleDiff = Math.hypot(yawDiff, pitchDiff);
    const mechanicalYawMatch = Math.abs(desiredYaw - targetYaw) < 0.08;
    const onTarget = (totalAngleDiff < 0.08) && mechanicalYawMatch;

    return { onTarget, angleDiff: totalAngleDiff };
  }

  /**
   * AI weapon trigger: fires when reload cooldown is elapsed.
   */
  fireAI() {
    if (this.fireCooldown <= 0 && !this.isDestroyed) {
      this.fireCooldown = this.fireRate;
      this._fireWeapon();
      return true;
    }
    return false;
  }

  /**
   * Update loop: handles proximity detection, prompt display, mounting, aiming, firing, and dismounting
   */
  update(delta, gameWorld = this.gameWorld) {
    this.updateCooldown(delta);
    this._updateRecoil(delta);

    if (this.fireCooldown > 0) {
      this.fireCooldown -= delta;
    }

    // AI turrets are managed by their parent entity (EnemyBattleship)
    if (this.isAI) {
      return;
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

        // Mouse Aiming
        const isDragging = input.isActionDown('mouseLook');
        if (input.isPointerLocked || isDragging) {
          this.yaw -= input.mouseDelta.x * 0.002;
          this.pitch -= input.mouseDelta.y * 0.002;
        }

        // Keyboard Aiming
        const yawAxis = input.getAxis('aimRight', 'aimLeft');
        const pitchAxis = input.getAxis('aimDown', 'aimUp');
        if (yawAxis !== 0) this.yaw += yawAxis * 0.8 * delta;
        if (pitchAxis !== 0) this.pitch += pitchAxis * 0.6 * delta;

        this.setAim(this.yaw, this.pitch);

        // Fire the main gun
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

export { ArtilleryTurret as MainGun };