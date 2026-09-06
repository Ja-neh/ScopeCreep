import * as THREE from 'three';
import { BaseStation } from './BaseStation.js';

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
    `;
    document.body.appendChild(this.hudEl);
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
   * Update loop: handles proximity detection, prompt display, mounting, aiming, and dismounting
   */
  update(delta, gameWorld = this.gameWorld) {
    this.updateCooldown(delta);

    // -------------------------------------------------------------
    // A. GUNNER MOUNTED: AIMING & DISMOUNT LOGIC
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
