import * as THREE from 'three';
import { BaseStation } from './BaseStation.js';
import { ShipBuoyancy } from './ShipBuoyancy.js';

/**
 * HelmStation
 * Controls naval locomotion, rudder steering, engine throttle,
 * wave buoyancy simulation, and helmsman bridge station interaction for the warship.
 * Extends BaseStation for unified proximity detection, limbo teleportation, and camera switching.
 */
export class HelmStation extends BaseStation {
  constructor(battleship, options = {}) {
    super({
      ...options,
      battleship,
      gameWorld: battleship.gameWorld || options.gameWorld || null,
      name: 'HelmStation',
      detectionRadius: 2.2,
      position: new THREE.Vector3(0, 8.05, -10.5),
      releasePointerLockOnMount: true
    });

    this.battleship = battleship;
    this.mesh = battleship.mesh; // Primary mesh reference for local/world transforms
    this.input = options.input || null;

    // Movement parameters
    this.maxForwardSpeed = options.maxForwardSpeed || 15.0; // m/s (~30 knots)
    this.maxReverseSpeed = options.maxReverseSpeed || 5.0;
    this.acceleration = options.acceleration || 3.5;
    this.drag = options.drag || 0.8;
    this.turnRate = options.turnRate || 0.45; // rad/s

    // Dynamic locomotion state
    this.speed = 0;
    this.heading = 0; // Yaw angle in world radians
    this.rudderAngle = 0; // Current rudder steer [-1, 1]

    // Buoyancy subsystem
    this.buoyancy = new ShipBuoyancy({ draft: options.draft || 1.0 });

    this._forwardVec = new THREE.Vector3();

    // 1. Vehicle Chase Camera
    this._createVehicleCamera();

    // 2. Helmsman Proximity Detection Field on Bridge
    this._createDetectField();

    // 3. UI overlays (prompt and navigation HUD)
    this._createUI();
  }

  get draft() { return this.buoyancy.draft; }
  set draft(val) { this.buoyancy.draft = val; }
  get currentPitch() { return this.buoyancy.currentPitch; }
  get currentRoll() { return this.buoyancy.currentRoll; }

  /**
   * Creates standard vehicle chase camera placed behind the vessel (+Z) looking forward (-Z)
   */
  _createVehicleCamera() {
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      3500
    );
    this.camera.name = 'Ship_VehicleCamera';

    // Positioned at the back of the vehicle elevated above stern, looking over bridge and bow
    this.camera.position.set(0, 24, 58);
    this.camera.lookAt(0, 8, -15);

    // Attached directly to the battleship mesh hierarchy to follow heading, position, and wave motion
    this.battleship.mesh.add(this.camera);
  }

  /**
   * Builds the proximity detect field at the Helmsman Bridge station
   */
  _createDetectField() {
    this.detectFieldGroup = this.createDetectField({ radius: this.detectionRadius, color: 0x00f5d4 });
    this.detectFieldGroup.position.set(0, 8.05, -10.5);
    this.detectFieldGroup.userData = { noCollision: true };
    this.localMountPosition = new THREE.Vector3(0, 8.1, -10.5);

    // Floating Holographic Diamond & Ship Wheel Beacon (compact, waist-level)
    this.beaconGroup = new THREE.Group();
    this.beaconGroup.position.y = 1.1;
    this.beaconGroup.userData = { noCollision: true };

    const beaconGeo = new THREE.OctahedronGeometry(0.28);
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0x00f5d4,
      emissive: 0x00f5d4,
      emissiveIntensity: 1.2,
      roughness: 0.1,
      metalness: 0.4,
      flatShading: true
    });
    this.beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
    this.beaconMesh.userData = { noCollision: true };
    this.beaconGroup.add(this.beaconMesh);

    // Wireframe holographic ship steering wheel
    const wheelGeo = new THREE.TorusGeometry(0.45, 0.035, 8, 24);
    const wheelMat = new THREE.MeshBasicMaterial({ color: 0x00f5d4, wireframe: true });
    this.beaconWheel = new THREE.Mesh(wheelGeo, wheelMat);
    this.beaconWheel.userData = { noCollision: true };
    this.beaconGroup.add(this.beaconWheel);

    this.detectFieldGroup.add(this.beaconGroup);
    this.battleship.mesh.add(this.detectFieldGroup);
  }

  /**
   * On-screen UI elements for interaction prompt and ship navigation HUD
   */
  _createUI() {
    // 1. Proximity interaction prompt: [E] TAKE SHIP HELM
    this.promptEl = document.createElement('div');
    this.promptEl.id = 'helmsman-prompt';
    this.promptEl.style.cssText = `
      position: fixed;
      bottom: 110px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.92);
      border: 2px solid #2a9d8f;
      box-shadow: 0 0 20px rgba(42, 157, 143, 0.5);
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
      <span style="background: #2a9d8f; color: #fff; padding: 3px 9px; border-radius: 4px; margin-right: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.4);">E</span>
      TAKE SHIP HELM
    `;
    document.body.appendChild(this.promptEl);

    // 2. Helmsman Vehicle Navigation HUD
    this.hudEl = document.createElement('div');
    this.hudEl.id = 'helmsman-hud';
    this.hudEl.style.cssText = `
      position: fixed;
      bottom: 30px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.9);
      border: 1px solid rgba(42, 157, 143, 0.6);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55), 0 0 16px rgba(42, 157, 143, 0.3);
      border-radius: 10px;
      padding: 14px 24px;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      z-index: 9999;
      user-select: none;
      display: none;
      text-align: center;
      min-width: 320px;
    `;
    this.hudEl.innerHTML = `
      <div style="font-size: 15px; font-weight: 700; color: #2a9d8f; letter-spacing: 0.6px; margin-bottom: 6px;">
        ⚓ WARSHIP HELM ACTIVE
      </div>
      <div style="display: flex; justify-content: center; gap: 20px; font-family: monospace; font-size: 14px; color: #e2e8f0; margin-bottom: 8px;">
        <div>SPEED: <strong id="helm-speed" style="color: #38bdf8;">0.0</strong> kts</div>
        <div>HEADING: <strong id="helm-heading" style="color: #f59e0b;">000°</strong></div>
        <div>RUDDER: <strong id="helm-rudder" style="color: #10b981;">MID</strong></div>
      </div>
      <div style="font-size: 12px; color: #94a3b8; font-family: monospace;">
        <strong>[W]</strong> Ahead &nbsp;|&nbsp; <strong>[S]</strong> Astern &nbsp;|&nbsp; 
        <strong>[A] / [D]</strong> Rudder &nbsp;|&nbsp; <strong>[E]</strong> Release Helm
      </div>
    `;
    document.body.appendChild(this.hudEl);

    this.speedDisplay = this.hudEl.querySelector('#helm-speed');
    this.headingDisplay = this.hudEl.querySelector('#helm-heading');
    this.rudderDisplay = this.hudEl.querySelector('#helm-rudder');
  }

  /**
   * Updates ship locomotion, steering, wave buoyancy, and helmsman interaction
   */
  update(delta, water, gameWorld = this.gameWorld) {
    this.updateCooldown(delta);

    const mesh = this.battleship.mesh;
    if (!mesh) return;

    // Animate holographic beacon
    const time = Date.now() * 0.003;
    if (this.beaconMesh) {
      this.beaconMesh.rotation.y += delta * 1.5;
    }
    if (this.beaconWheel) {
      this.beaconWheel.rotation.z += delta * 1.0;
    }
    if (this.beaconGroup) {
      this.beaconGroup.position.y = 1.1 + Math.sin(time * 2) * 0.08;
    }

    const input = (this.isMounted && gameWorld) ? gameWorld.input : this.input;

    // -------------------------------------------------------------
    // A. HELMSMAN MOUNTED: NAVIGATION & DISMOUNT
    // -------------------------------------------------------------
    if (this.isMounted) {
      if (input) {
        // Dismount on [E] or [ESC]
        const wantsDismount = (input.isActionJustPressed('specialAction') || input.isActionJustPressed('pause')) && this.mountCooldown <= 0;
        if (wantsDismount) {
          this.dismount(gameWorld);
          return;
        }

        // Engine Throttle (W: Ahead, S: Astern)
        const throttleAxis = input.getAxis('backward', 'forward');
        if (throttleAxis > 0) {
          this.speed += this.acceleration * delta;
        } else if (throttleAxis < 0) {
          this.speed -= this.acceleration * 0.8 * delta;
        } else {
          // Water drag deceleration
          this.speed *= Math.max(0.0, 1.0 - this.drag * delta);
        }
        this.speed = THREE.MathUtils.clamp(this.speed, -this.maxReverseSpeed, this.maxForwardSpeed);

        // Rudder Steering (A: Port/Left, D: Starboard/Right)
        this.rudderAngle = input.getAxis('steerRight', 'steerLeft');
        if (Math.abs(this.speed) > 0.15) {
          const turnDirection = this.speed >= 0 ? 1 : -1;
          this.heading += this.rudderAngle * this.turnRate * (Math.abs(this.speed) / this.maxForwardSpeed) * turnDirection * delta;
        }

        // Forward locomotion along current heading
        this._forwardVec.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
        mesh.position.x += this._forwardVec.x * this.speed * delta;
        mesh.position.z += this._forwardVec.z * this.speed * delta;
        mesh.rotation.y = this.heading;

        // Update HUD readouts
        if (this.speedDisplay) {
          const knots = (this.speed * 1.94384).toFixed(1);
          this.speedDisplay.textContent = knots;
        }
        if (this.headingDisplay) {
          let deg = Math.round((-this.heading * 180 / Math.PI) % 360);
          if (deg < 0) deg += 360;
          this.headingDisplay.textContent = `${deg.toString().padStart(3, '0')}°`;
        }
        if (this.rudderDisplay) {
          if (this.rudderAngle > 0.1) {
            this.rudderDisplay.textContent = 'PORT';
            this.rudderDisplay.style.color = '#ef4444';
          } else if (this.rudderAngle < -0.1) {
            this.rudderDisplay.textContent = 'STBD';
            this.rudderDisplay.style.color = '#22c55e';
          } else {
            this.rudderDisplay.textContent = 'MID';
            this.rudderDisplay.style.color = '#10b981';
          }
        }
      }
    } else {
      // -------------------------------------------------------------
      // B. UNMOUNTED: NATURAL DRAG & PROXIMITY DETECTION
      // -------------------------------------------------------------
      if (Math.abs(this.speed) > 0.05) {
        this.speed *= Math.max(0.0, 1.0 - this.drag * 1.5 * delta);
        this._forwardVec.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
        mesh.position.x += this._forwardVec.x * this.speed * delta;
        mesh.position.z += this._forwardVec.z * this.speed * delta;
      }

      this.checkProximity(delta, gameWorld);
    }

    // -------------------------------------------------------------
    // C. WAVE BUOYANCY SIMULATION (Delegated to ShipBuoyancy)
    // -------------------------------------------------------------
    this.buoyancy.update(mesh, water, delta);
  }

  dispose() {
    super.dispose();
    if (this.camera && this.camera.parent) {
      this.camera.parent.remove(this.camera);
    }
  }
}

export { HelmStation as ShipController };
