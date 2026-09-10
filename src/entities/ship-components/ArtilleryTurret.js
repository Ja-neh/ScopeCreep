import * as THREE from 'three';
import { BaseStation } from './BaseStation.js';
import config from '../../config.json';

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
      name: 'ArtilleryTurret',
      detectionRadius: 5.5,
      position: options.position || new THREE.Vector3(0, 4.2, -22)
    });

    // Turret orientation angles
    this.yaw = 0;   // Left/Right rotation relative to ship heading
    this.pitch = 0; // Barrel vertical elevation (0 to ~30 deg)

    // Limits
    this.maxYaw = Math.PI * 0.75; // 135 degrees arc to port and starboard
    this.minPitch = 0.0;
    this.maxPitch = Math.PI / 6;  // ~30 degrees max elevation

    // --- Card 2.2: Firing state ---
    // Pre-allocated scratchpads for firing calculations (zero heap allocations in updates)
    this._muzzleWorldPos = new THREE.Vector3();
    this._barrelWorldDir = new THREE.Vector3();

    // Rate of fire (heavy naval cannon, slow reload)
    const artilleryCfg = config.turrets.artillery;
    this.fireCooldown = 0;
    this.fireRate = artilleryCfg.defaultReloadCadence; // seconds between shots

    // Distance from the pitch-group pivot to the muzzle tip along the barrel axis
    // (barrel mesh is 14m long, centered at local z = -6.5, so its tip sits ~13.5m
    // forward of the pitch pivot)
    this.barrelLength = 13.5;
    this.barrelRestZ = -6.5; // rest local-Z position of each barrel mesh

    // Visual recoil (barrel kickback)
    this.recoilOffset = 0;
    this.recoilKick = 0.6;          // meters of kickback per shot
    this.recoilRecoverySpeed = 1.6; // meters/sec spring-back rate

    // 1. Build the 3D turret mesh hierarchy & detect field
    this._createMesh();

    // 2. Dedicated Aiming Camera
    this._createCamera();

    // 3. UI overlays (prompt and crosshair)
    this._createUI();
  }

  _createMesh() {
    // Root group placed on the deck
    this.mesh = new THREE.Group();
    this.mesh.name = 'Ship_MainArtilleryGun';
    this.mesh.position.copy(this.position);

    const turretMat = new THREE.MeshStandardMaterial({
      color: 0x2e3842,
      roughness: 0.5,
      metalness: 0.4,
      flatShading: true
    });

    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xe76f51,
      roughness: 0.4,
      flatShading: true
    });

    // 1. Static Barbette / Rotating Ring Base
    const barbetteGeo = new THREE.CylinderGeometry(4.2, 4.5, 1.2, 12);
    const barbette = new THREE.Mesh(barbetteGeo, turretMat);
    barbette.position.y = 0.6;
    barbette.castShadow = true;
    this.mesh.add(barbette);

    // 2. Yaw Rotator (Swivels horizontally with player aiming)
    this.yawGroup = new THREE.Group();
    this.yawGroup.position.y = 1.2;
    this.mesh.add(this.yawGroup);

    // Armored Turret Housing
    const housingGeo = new THREE.BoxGeometry(6.2, 2.6, 7.5);
    const housing = new THREE.Mesh(housingGeo, turretMat);
    housing.position.set(0, 1.0, 0.5);
    housing.castShadow = true;
    this.yawGroup.add(housing);

    // Gunner Cupola Hatch
    const hatchGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.5, 8);
    const hatch = new THREE.Mesh(hatchGeo, accentMat);
    hatch.position.set(1.5, 2.4, 1.5);
    this.yawGroup.add(hatch);

    // 3. Pitch Elevating Assembly (Barrels tilt up/down)
    this.pitchGroup = new THREE.Group();
    this.pitchGroup.position.set(0, 1.0, -1.0);
    this.yawGroup.add(this.pitchGroup);

    // Twin Artillery Barrels (point along -Z)
    const barrelGeo = new THREE.CylinderGeometry(0.38, 0.48, 14, 8);
    const barrelL = new THREE.Mesh(barrelGeo, turretMat);
    barrelL.position.set(-1.2, 0, -6.5);
    barrelL.rotation.x = Math.PI / 2;
    barrelL.castShadow = true;
    this.pitchGroup.add(barrelL);

    const barrelR = new THREE.Mesh(barrelGeo, turretMat);
    barrelR.position.set(1.2, 0, -6.5);
    barrelR.rotation.x = Math.PI / 2;
    barrelR.castShadow = true;
    this.pitchGroup.add(barrelR);

    // Keep references for muzzle-flash offset & recoil kickback animation
    this.barrelL = barrelL;
    this.barrelR = barrelR;

    // 4. Proximity Detect Field on Deck (Operator Area behind turret)
    this._createDetectField();
  }

  /**
   * Builds the glowing proximity detect field on the deck behind the turret
   */
  _createDetectField() {
    const field = this.createDetectField({ radius: this.detectionRadius, color: 0xe76f51 });
    field.position.set(0, 0.1, 4.0); // Station position behind the barbette
    field.userData = { noCollision: true };
    this.mesh.add(field);
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
    this.camera.name = 'MainGun_Camera';

    // Position camera just above the turret roof looking directly down the twin barrels (-Z)
    this.camera.position.set(0, 1.8, 2.2);
    this.camera.rotation.set(0, 0, 0);

    // Adding to pitchGroup ensures camera pitches and yaws identically with the artillery barrels
    this.pitchGroup.add(this.camera);
  }

  /**
   * On-screen HUD elements for detection prompt and gunner aiming
   */
  _createUI() {
    // 1. Proximity interaction prompt: [E] OPERATE MAIN ARTILLERY GUN
    this.promptEl = document.createElement('div');
    this.promptEl.id = 'maingun-prompt';
    this.promptEl.style.cssText = `
      position: fixed;
      bottom: 110px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.92);
      border: 2px solid #e76f51;
      box-shadow: 0 0 20px rgba(231, 111, 81, 0.5);
      color: #f8fafc;
      padding: 12px 24px;
      border-radius: 8px;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.5px;
      pointer-events: none;
      display: none;
      z-index: 9999;
      user-select: none;
      transition: opacity 0.15s ease-out;
    `;
    this.promptEl.innerHTML = `
      <span style="background: #e76f51; color: #fff; padding: 3px 9px; border-radius: 4px; margin-right: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.4);">E</span>
      OPERATE MAIN ARTILLERY GUN
    `;
    document.body.appendChild(this.promptEl);

    // 2. Turret Gunner HUD (Center Crosshair & Dismount guide)
    this.hudEl = document.createElement('div');
    this.hudEl.id = 'maingun-hud';
    this.hudEl.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      display: none;
      z-index: 9999;
      user-select: none;
    `;
    this.hudEl.innerHTML = `
      <div style="
        position: absolute;
        top: 50%;
        left: 50%;
        width: 38px;
        height: 38px;
        transform: translate(-50%, -50%);
        border: 2px solid rgba(231, 111, 81, 0.9);
        border-radius: 50%;
        box-shadow: 0 0 12px rgba(231, 111, 81, 0.6);
      ">
        <div style="position: absolute; top: 17px; left: -12px; width: 10px; height: 2px; background: #e76f51;"></div>
        <div style="position: absolute; top: 17px; right: -12px; width: 10px; height: 2px; background: #e76f51;"></div>
        <div style="position: absolute; top: -12px; left: 17px; width: 2px; height: 10px; background: #e76f51;"></div>
        <div style="position: absolute; bottom: -12px; left: 17px; width: 2px; height: 10px; background: #e76f51;"></div>
      </div>
      <div style="
        position: absolute;
        bottom: 35px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.88);
        border: 1px solid rgba(231, 111, 81, 0.6);
        color: #f1f5f9;
        padding: 10px 20px;
        border-radius: 8px;
        font-family: monospace;
        font-size: 14px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.5);
      ">
        <strong style="color: #e76f51;">MAIN ARTILLERY TURRET</strong> &nbsp;|&nbsp; 
        <strong>[E]</strong> or <strong>[ESC]</strong> Dismount &nbsp;|&nbsp; 
        <strong>Mouse</strong> Aim
      </div>
      <div style="
        position: absolute;
        bottom: 90px;
        left: 50%;
        transform: translateX(-50%);
        width: 180px;
        text-align: center;
        font-family: monospace;
      ">
        <div data-role="reload-label" style="
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1px;
          color: #e76f51;
          margin-bottom: 4px;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        ">READY</div>
        <div style="
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(231, 111, 81, 0.5);
          overflow: hidden;
        ">
          <div data-role="reload-fill" style="
            height: 100%;
            width: 100%;
            background: #e76f51;
            box-shadow: 0 0 8px rgba(231, 111, 81, 0.8);
            transition: width 0.05s linear, background-color 0.15s ease;
          "></div>
        </div>
      </div>
    `;
    document.body.appendChild(this.hudEl);

    // Cache reload indicator elements for per-frame updates (avoid re-querying DOM)
    this.reloadLabelEl = this.hudEl.querySelector('[data-role="reload-label"]');
    this.reloadFillEl = this.hudEl.querySelector('[data-role="reload-fill"]');
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

    // getWorldDirection() returns the object's +Z axis in world space; the barrels
    // point down local -Z, so negate to get the actual forward firing direction.
    this.pitchGroup.getWorldDirection(this._barrelWorldDir);
    this._barrelWorldDir.negate();

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
    const z = this.barrelRestZ + this.recoilOffset;

    if (this.barrelL) this.barrelL.position.z = z;
    if (this.barrelR) this.barrelR.position.z = z;
  }

  /**
   * Refreshes the gunner HUD's reload progress bar/label to reflect fireCooldown.
   */
  _updateReloadIndicator() {
    if (!this.reloadFillEl) return;

    const ready = this.fireCooldown <= 0;
    const pct = ready ? 100 : THREE.MathUtils.clamp(100 - (this.fireCooldown / this.fireRate) * 100, 0, 100);

    this.reloadFillEl.style.width = `${pct}%`;
    this.reloadFillEl.style.background = ready ? '#7fd992' : '#e76f51';
    this.reloadFillEl.style.boxShadow = ready
      ? '0 0 8px rgba(127, 217, 146, 0.8)'
      : '0 0 8px rgba(231, 111, 81, 0.8)';

    if (this.reloadLabelEl) {
      this.reloadLabelEl.textContent = ready ? 'READY' : 'RELOADING';
      this.reloadLabelEl.style.color = ready ? '#7fd992' : '#e76f51';
    }
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
        if (input.isPointerLocked) {
          this.yaw -= input.mouseDelta.x * 0.002;
          this.pitch -= input.mouseDelta.y * 0.002;
        }

        // Keyboard Aiming (Arrow keys)
        if (input.isKeyDown('ArrowLeft')) this.yaw += 0.8 * delta;
        if (input.isKeyDown('ArrowRight')) this.yaw -= 0.8 * delta;
        if (input.isKeyDown('ArrowUp')) this.pitch += 0.6 * delta;
        if (input.isKeyDown('ArrowDown')) this.pitch -= 0.6 * delta;

        this.setAim(this.yaw, this.pitch);

        // Fire the main gun
        const wantsFire = input.isActionDown('firePrimary');
        if (wantsFire && this.fireCooldown <= 0) {
          this.fireCooldown = this.fireRate;
          this._fireWeapon();
        }

        this._updateReloadIndicator();
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