import * as THREE from 'three';
import { BaseStation } from './BaseStation.js';
import config from '../../config.json';

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
      detectionRadius: 4.8,
      position: options.position || new THREE.Vector3(0, 6.8, 16)
    });

    // Turret orientation angles
    this.yaw = 0;
    this.pitch = Math.PI / 6; // Default ~30 deg upward anti-air posture

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

    // 1. Build the 3D turret mesh hierarchy & detect field
    this._createMesh();

    // 2. Dedicated Anti-Air Camera
    this._createCamera();

    // 3. UI overlays (prompt and crosshair)
    this._createUI();
  }

  _createMesh() {
    this.mesh = new THREE.Group();
    this.mesh.name = 'Ship_FlakTurret';
    this.mesh.position.copy(this.position);

    const bridgeMat = new THREE.MeshStandardMaterial({
      color: 0x5a6d7c,
      roughness: 0.6,
      flatShading: true
    });

    const turretMat = new THREE.MeshStandardMaterial({
      color: 0x2e3842,
      roughness: 0.5,
      metalness: 0.4,
      flatShading: true
    });

    // 1. Static Elevated Platform Ring
    const flakPlatGeo = new THREE.CylinderGeometry(3.2, 3.4, 1.0, 12);
    const flakPlat = new THREE.Mesh(flakPlatGeo, bridgeMat);
    flakPlat.position.y = 0.5;
    flakPlat.castShadow = true;
    this.mesh.add(flakPlat);

    // 2. Yaw Rotator (360-degree swivel)
    this.yawGroup = new THREE.Group();
    this.yawGroup.position.y = 1.0;
    this.mesh.add(this.yawGroup);

    // AA Gun Mount Base
    const mountGeo = new THREE.BoxGeometry(2.6, 1.6, 2.6);
    const mount = new THREE.Mesh(mountGeo, turretMat);
    mount.position.y = 0.8;
    mount.castShadow = true;
    this.yawGroup.add(mount);

    // 3. Pitch Elevating Assembly (Quad Barrels)
    this.pitchGroup = new THREE.Group();
    this.pitchGroup.position.set(0, 1.2, 0);
    this.yawGroup.add(this.pitchGroup);

    // Armored gun mantlet
    const mantletGeo = new THREE.BoxGeometry(2.2, 1.2, 1.8);
    const mantlet = new THREE.Mesh(mantletGeo, turretMat);
    mantlet.castShadow = true;
    this.pitchGroup.add(mantlet);

    // Quad rapid-fire barrels (point along -Z)
    const aaBarrelGeo = new THREE.CylinderGeometry(0.16, 0.20, 6.5, 6);
    const flakPositions = [
      [-0.65, 0.3, -3.2],
      [0.65, 0.3, -3.2],
      [-0.65, -0.2, -3.2],
      [0.65, -0.2, -3.2]
    ];

    // Keep references for recoil kickback animation
    this.barrels = [];
    flakPositions.forEach(([x, y, z]) => {
      const b = new THREE.Mesh(aaBarrelGeo, turretMat);
      b.position.set(x, y, z);
      b.rotation.x = Math.PI / 2; // Barrel points along -Z
      b.castShadow = true;
      this.pitchGroup.add(b);
      this.barrels.push(b);
    });

    // Apply default upward elevation
    this.pitchGroup.rotation.x = -this.pitch;

    // 4. Proximity Detect Field on Aft Platform
    this._createDetectField();
  }

  /**
   * Builds the glowing proximity detect field on the aft platform
   */
  _createDetectField() {
    const field = this.createDetectField({ radius: this.detectionRadius, color: 0xf4a261 });
    field.position.set(0, 0.1, 2.8); // Operator station behind the mount
    field.userData = { noCollision: true };
    this.mesh.add(field);
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

    // Position camera right behind the quad mantlet sight looking along -Z
    this.camera.position.set(0, 1.3, 1.8);
    this.camera.rotation.set(0, 0, 0);

    // Adding to pitchGroup ensures camera tracks 360-degree yaw and high elevation into the sky
    this.pitchGroup.add(this.camera);
  }

  /**
   * On-screen HUD elements for detection prompt and anti-air aiming
   */
  _createUI() {
    // 1. Proximity interaction prompt: [E] OPERATE FLAK TURRET
    this.promptEl = document.createElement('div');
    this.promptEl.id = 'flakturret-prompt';
    this.promptEl.style.cssText = `
      position: fixed;
      bottom: 110px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.92);
      border: 2px solid #f4a261;
      box-shadow: 0 0 20px rgba(244, 162, 97, 0.5);
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
      <span style="background: #f4a261; color: #1e293b; padding: 3px 9px; border-radius: 4px; margin-right: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.4);">E</span>
      OPERATE FLAK TURRET
    `;
    document.body.appendChild(this.promptEl);

    // 2. Turret Gunner HUD (Anti-Air Reticle & Dismount guide)
    this.hudEl = document.createElement('div');
    this.hudEl.id = 'flakturret-hud';
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
        width: 48px;
        height: 48px;
        transform: translate(-50%, -50%);
        border: 2px dashed rgba(244, 162, 97, 0.9);
        border-radius: 50%;
        box-shadow: 0 0 14px rgba(244, 162, 97, 0.5);
      ">
        <div style="position: absolute; top: 22px; left: 22px; width: 4px; height: 4px; background: #f4a261; border-radius: 50%;"></div>
        <div style="position: absolute; top: 23px; left: -14px; width: 12px; height: 2px; background: #f4a261;"></div>
        <div style="position: absolute; top: 23px; right: -14px; width: 12px; height: 2px; background: #f4a261;"></div>
        <div style="position: absolute; top: -14px; left: 23px; width: 2px; height: 12px; background: #f4a261;"></div>
        <div style="position: absolute; bottom: -14px; left: 23px; width: 2px; height: 12px; background: #f4a261;"></div>
      </div>
      <div style="
        position: absolute;
        bottom: 35px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.88);
        border: 1px solid rgba(244, 162, 97, 0.6);
        color: #f1f5f9;
        padding: 10px 20px;
        border-radius: 8px;
        font-family: monospace;
        font-size: 14px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.5);
      ">
        <strong style="color: #f4a261;">ANTI-AIR FLAK BATTERY</strong> &nbsp;|&nbsp; 
        <strong>[E]</strong> or <strong>[ESC]</strong> Dismount &nbsp;|&nbsp; 
        <strong>Mouse</strong> Aim
      </div>
      <div style="
        position: absolute;
        bottom: 100px;
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
          color: #f4a261;
          margin-bottom: 4px;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        ">READY</div>
        <div style="
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(244, 162, 97, 0.5);
          overflow: hidden;
        ">
          <div data-role="reload-fill" style="
            height: 100%;
            width: 100%;
            background: #f4a261;
            box-shadow: 0 0 8px rgba(244, 162, 97, 0.8);
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
   * Aim flak turret
   */
  setAim(targetYaw, targetPitch) {
    this.yaw = targetYaw;
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

    // Offset from the pivot out to the muzzle tips
    this._muzzleWorldPos.addScaledVector(this._barrelWorldDir, this.barrelLength);
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
    const z = this.barrelRestZ + this.recoilOffset;

    for (const barrel of this.barrels) {
      barrel.position.z = z;
    }
  }

  /**
   * Refreshes the gunner HUD's reload progress bar/label to reflect fireCooldown.
   */
  _updateReloadIndicator() {
    if (!this.reloadFillEl) return;

    const ready = this.fireCooldown <= 0;
    const pct = ready ? 100 : THREE.MathUtils.clamp(100 - (this.fireCooldown / this.fireRate) * 100, 0, 100);

    this.reloadFillEl.style.width = `${pct}%`;
    this.reloadFillEl.style.background = ready ? '#7fd992' : '#f4a261';
    this.reloadFillEl.style.boxShadow = ready
      ? '0 0 8px rgba(127, 217, 146, 0.8)'
      : '0 0 8px rgba(244, 162, 97, 0.8)';

    if (this.reloadLabelEl) {
      this.reloadLabelEl.textContent = ready ? 'READY' : 'CYCLING';
      this.reloadLabelEl.style.color = ready ? '#7fd992' : '#f4a261';
    }
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
        if (input.isPointerLocked) {
          this.yaw -= input.mouseDelta.x * 0.0025;
          this.pitch -= input.mouseDelta.y * 0.0025;
        }

        // Keyboard Aiming (Arrow keys)
        if (input.isKeyDown('ArrowLeft')) this.yaw += 1.2 * delta;
        if (input.isKeyDown('ArrowRight')) this.yaw -= 1.2 * delta;
        if (input.isKeyDown('ArrowUp')) this.pitch += 0.9 * delta;
        if (input.isKeyDown('ArrowDown')) this.pitch -= 0.9 * delta;

        this.setAim(this.yaw, this.pitch);

        // Fire the rapid-fire flak battery (held down for sustained fire)
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