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
      promptText: 'TAKE SHIP HELM',
      accentColor: '#2a9d8f',
      stationType: 'helm',
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
        if (gameWorld && gameWorld.ui) {
          const knots = (this.speed * 1.94384).toFixed(1);
          let deg = Math.round((-this.heading * 180 / Math.PI) % 360);
          if (deg < 0) deg += 360;
          let rudderText = 'MID';
          let rudderColor = '#10b981';
          if (this.rudderAngle > 0.1) {
            rudderText = 'PORT';
            rudderColor = '#ef4444';
          } else if (this.rudderAngle < -0.1) {
            rudderText = 'STBD';
            rudderColor = '#22c55e';
          }
          gameWorld.ui.updateStationHUD('helm', {
            speed: knots,
            heading: `${deg.toString().padStart(3, '0')}°`,
            rudder: rudderText,
            rudderColor: rudderColor
          });
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
