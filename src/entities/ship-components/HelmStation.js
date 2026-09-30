import * as THREE from 'three';
import { BaseStation } from './BaseStation.js';
import { SpringArmCamera } from '../components/SpringArmCamera.js';
import config from '../../config.json';

/**
 * HelmStation
 * Controls naval locomotion, rudder steering, engine throttle,
 * wave buoyancy simulation, and helmsman bridge station interaction for the warship.
 * Extends BaseStation for unified proximity detection, limbo teleportation, and camera switching.
 */
export class HelmStation extends BaseStation {
  constructor(battleship, options = {}) {
    const defaultHelmPos = battleship?.stations?.helmsman
      ? battleship.stations.helmsman.clone()
      : new THREE.Vector3(5.47, 5.26, 17.22);

    super({
      ...options,
      battleship,
      gameWorld: battleship?.gameWorld || options.gameWorld || null,
      name: 'HelmStation',
      detectionRadius: 2.8,
      position: options.position || defaultHelmPos,
      releasePointerLockOnMount: false
    });

    this.battleship = battleship;
    this.mesh = battleship.mesh; // Primary mesh reference for local/world transforms
    this.input = options.input || null;

    // Movement parameters from config
    const propCfg = config.ship.propulsion;
    const buoyCfg = config.ship.buoyancy;

    this.maxForwardSpeed = options.maxForwardSpeed || propCfg.maxForwardSpeed;
    this.maxReverseSpeed = options.maxReverseSpeed || propCfg.maxReverseSpeed;
    this.acceleration = options.acceleration || propCfg.acceleration;
    this.drag = options.drag || propCfg.drag;
    this.turnRate = options.turnRate || propCfg.turnRate;

    // Dynamic locomotion state
    this.speed = 0;
    this.heading = 0; // Yaw angle in world radians
    this.rudderAngle = 0; // Current rudder steer [-1, 1]

    // Fixed waterline properties (buoyancy completely disabled)
    this.draft = options.draft !== undefined ? options.draft : (buoyCfg?.draft ?? 1.0);
    this.currentPitch = 0;
    this.currentRoll = 0;

    // Camera tuning & mouse orbit look
    const camCfg = config.ship.camera || {};
    this.defaultPitch = options.cameraPitch !== undefined ? options.cameraPitch : (camCfg.pitch ?? 0.20);
    this.pitch = this.defaultPitch;
    this.orbitYaw = 0;
    this.mouseSensitivity = options.mouseSensitivity || 0.0022;
    this.minPitch = options.minPitch !== undefined ? options.minPitch : -0.35;
    this.maxPitch = options.maxPitch !== undefined ? options.maxPitch : 0.85;

    this._forwardVec = new THREE.Vector3();

    // 1. Vehicle Chase Camera with SpringArm
    this._createVehicleCamera(options);

    // 2. Helmsman Proximity Detection Field on Bridge
    this._createDetectField();

    // 3. UI overlays (prompt and navigation HUD)
    this._createUI();
  }

  /**
   * Creates vehicle chase camera managed by SpringArmCamera for smooth obstacle avoidance and mouse orbit
   */
  _createVehicleCamera(options = {}) {
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      3500
    );
    this.camera.name = 'Ship_VehicleCamera';

    const camCfg = config.ship.camera || {};
    const physicsWorld = this.battleship?.physicsWorld || this.gameWorld?.physicsWorld || null;

    this.springArm = new SpringArmCamera(this.camera, physicsWorld, {
      thirdPersonDistance: options.thirdPersonDistance || camCfg.distance || 85.0,
      thirdPersonTargetHeight: options.thirdPersonTargetHeight || camCfg.targetHeight || 12.0,
      minCameraDistance: options.minCameraDistance || camCfg.minDistance || 20.0,
      cameraCollisionMargin: options.cameraCollisionMargin || camCfg.collisionMargin || 2.0,
      minCameraY: options.minCameraY !== undefined ? options.minCameraY : (camCfg.minCameraY ?? 3.5),
    });
  }

  /**
   * Sets the helm station coordinates dynamically when model AreaHelm is loaded
   */
  setStationPosition(pos) {
    this.position.copy(pos);
    if (this.detectFieldGroup) {
      this.detectFieldGroup.position.copy(pos);
    }
    this.localMountPosition = pos.clone();
  }

  /**
   * Builds the proximity detect field at the Helmsman Bridge station
   */
  _createDetectField() {
    this.detectFieldGroup = this.createDetectField({ radius: this.detectionRadius, color: 0x00f5d4 });
    this.detectFieldGroup.position.copy(this.position);
    this.detectFieldGroup.userData = { noCollision: true };
    this.localMountPosition = this.position.clone();

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
    // C. BUOYANCY DISABLED: Keep vessel level with zero pitch and roll
    // -------------------------------------------------------------
    mesh.rotation.x = 0;
    mesh.rotation.z = 0;
  }

  /**
   * Hook called when player mounts the helm
   */
  onMounted(player, gameWorld) {
    this.orbitYaw = 0;
    this.pitch = this.defaultPitch;
    if (this.springArm) {
      this.springArm.currentCameraDistance = this.springArm.thirdPersonDistance;
      if (!this.springArm.physicsWorld) {
        this.springArm.physicsWorld = this.battleship?.physicsWorld || gameWorld?.physicsWorld || null;
      }
    }
  }

  /**
   * Phase 6 (Late Update): Updates ship spring-arm camera tracking, occlusion, and mouse orbit
   * after physical movements and platform displacement are fully applied.
   */
  lateUpdate(delta, gameWorld = this.gameWorld) {
    if (!this.isMounted || !this.springArm) return;

    const input = gameWorld?.input || this.input;
    if (input && input.isPointerLocked) {
      this.orbitYaw -= input.mouseDelta.x * this.mouseSensitivity;
      this.pitch -= input.mouseDelta.y * this.mouseSensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch, this.minPitch, this.maxPitch);
    }

    if (!this.springArm.physicsWorld && this.battleship?.physicsWorld) {
      this.springArm.physicsWorld = this.battleship.physicsWorld;
    }

    const shipPos = this.battleship.mesh.position;
    const totalYaw = this.heading + this.orbitYaw;
    const hullCollider = this.battleship.colliders?.collider || null;
    const shipRigidBody = this.battleship.colliders?.rigidBody || null;

    this.springArm.update(
      delta,
      shipPos,
      totalYaw,
      this.pitch,
      hullCollider,
      shipRigidBody
    );
  }

  dispose() {
    super.dispose();
    if (this.camera && this.camera.parent) {
      this.camera.parent.remove(this.camera);
    }
    this.springArm = null;
    this.camera = null;
  }
}

export { HelmStation as ShipController };
