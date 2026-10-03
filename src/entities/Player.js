import * as THREE from 'three';
import { BaseEntity } from './BaseEntity.js';
import { SpringArmCamera, CameraMode } from './components/SpringArmCamera.js';
import { PlayerModel } from './models/PlayerModel.js';
import { GroundProbe } from './player-components/GroundProbe.js';
import { PlatformTracker } from './player-components/PlatformTracker.js';
import config from '../config.json';

export { CameraMode };

/**
 * Player
 * Humanoid avatar represented as a low-poly capsule.
 * Uses Rapier3D's built-in KinematicCharacterController for obstacle auto-stepping,
 * slope sliding, and mesh collisions.
 */
export class Player extends BaseEntity {
  constructor(gameWorld, options = {}) {
    super('Player');
    this.gameWorld = gameWorld;
    this.input = gameWorld.input;
    this.camera = gameWorld.camera;
    this.physicsWorld = gameWorld.physics;

    // Movement attributes from config
    const locCfg = config.player.locomotion;
    const camCfg = config.player.camera;
    const capCfg = config.player.capsule || { radius: 0.45, halfHeight: 0.55, controllerOffset: 0.01, maxStepHeight: 0.45 };

    this.walkSpeed = options.walkSpeed || locCfg.walkSpeed;
    this.sprintSpeed = options.sprintSpeed || locCfg.sprintSpeed;
    this.jumpForce = options.jumpForce || locCfg.jumpForce;
    this.gravity = options.gravity || locCfg.gravity;
    this.mouseSensitivity = options.mouseSensitivity || locCfg.mouseSensitivity;

    // Capsule dimensions from config or options
    this.capsuleRadius = options.capsuleRadius !== undefined ? options.capsuleRadius : capCfg.radius;
    this.capsuleHalfHeight = options.capsuleHalfHeight !== undefined ? options.capsuleHalfHeight : capCfg.halfHeight;
    this.capsuleCenter = this.capsuleHalfHeight + this.capsuleRadius;
    this.maxStepHeight = options.maxStepHeight !== undefined ? options.maxStepHeight : capCfg.maxStepHeight;
    // Controller offset: clearance margin (in meters) between collider and ground/obstacles
    this.controllerOffset = options.controllerOffset !== undefined ? options.controllerOffset : capCfg.controllerOffset;
    // Keeps the character on the ground when walking down slopes and ramps (opt-in: off on the ship's trimesh decks)
    this.snapToGround = options.snapToGround === true;

    // Position & Kinematics
    this.position = options.position ? options.position.clone() : new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.verticalVelocity = 0;
    this.isGrounded = true;
    this.isCharacterController = true; // Tag for turret proximity detection
    this.isPlayer = true;
    this.isMounted = false; // True when operating a gun turret / vehicle
    this.isDevSuspended = false; // True when dev aerial camera is active

    // Look angles (radians)
    this.yaw = 0;       // 0 = facing towards -Z
    this.pitch = -0.15; // Natural slight downward tilt (~8.5 deg)

    // Spring Arm Camera Controller
    this.springArm = new SpringArmCamera(this.camera, this.physicsWorld, {
      defaultMode: CameraMode.THIRD_PERSON,
      eyeHeight: options.eyeHeight || camCfg.eyeHeight,
      thirdPersonDistance: options.thirdPersonDistance || camCfg.thirdPersonDistance,
      thirdPersonTargetHeight: options.thirdPersonTargetHeight || camCfg.thirdPersonTargetHeight,
      minCameraDistance: options.minCameraDistance || camCfg.minCameraDistance,
      cameraCollisionMargin: options.cameraCollisionMargin || camCfg.cameraCollisionMargin,
      shoulderOffset: options.shoulderOffset || camCfg.shoulderOffset
    });

    // Reusable math vectors for movement input (eliminating GC)
    this._camForward = new THREE.Vector3();
    this._camRight = new THREE.Vector3();
    this._moveDir = new THREE.Vector3();

    // Rapier physics handles
    this.rigidBody = null;
    this.collider = null;
    this.characterController = null;

    // 1. Procedural Visual Model & Debug Wireframe
    this.model = new PlayerModel(this.capsuleRadius, this.capsuleHalfHeight, this.capsuleCenter);
    this.mesh = this.model.mesh;
    this.bodyMesh = this.model.bodyMesh;
    this.visorMesh = this.model.visorMesh;
    this.packMesh = this.model.packMesh;
    this.colliderDebugGroup = this.model.colliderDebugGroup;

    // 2. Initialize Rapier Kinematic Character Controller
    this._initPhysics();

    // 3. Ground & Slope Probe
    this.groundProbe = new GroundProbe(this.physicsWorld, this.collider, {
      capsuleRadius: this.capsuleRadius
    });

    // 4. Moving Platform Tracker (Contact-based)
    this.platformTracker = new PlatformTracker(this.gameWorld);

    // Request pointer lock on canvas pointerdown/click (unless in dev aerial camera, paused, or no level)
    this._onPointerDown = () => {
      if (this.isDevSuspended || (this.gameWorld && (this.gameWorld.isPaused || !this.gameWorld.currentLevel))) return;
      if (!this.input.isPointerLocked) {
        this.input.requestPointerLock(this.gameWorld.canvas);
      }
    };
    this.gameWorld.canvas.addEventListener('pointerdown', this._onPointerDown);
    this.gameWorld.canvas.addEventListener('click', this._onPointerDown);
  }

  /**
   * Initializes Rapier rigid body, 1 capsule collider, and KinematicCharacterController
   */
  _initPhysics() {
    if (!this.physicsWorld || !this.physicsWorld.isInitialized) return;
    const RAPIER = this.physicsWorld.RAPIER;

    // Kinematic position-based body centered at y + capsuleCenter
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(this.position.x, this.position.y + this.capsuleCenter, this.position.z);
    this.rigidBody = this.physicsWorld.createRigidBody(bodyDesc);

    // 1 Capsule Collider (halfHeight = 0.55, radius = 0.45 => Total Height = 2.0m)
    const colliderDesc = RAPIER.ColliderDesc.capsule(this.capsuleHalfHeight, this.capsuleRadius);
    this.collider = this.physicsWorld.createCollider(colliderDesc, this.rigidBody);

    // Rapier Kinematic Character Controller (auto-step, slope slide, snap-to-ground)
    // offset: distance that keeps collider floating cleanly above deck loop cuts
    this.characterController = this.physicsWorld.createCharacterController({
      offset: this.controllerOffset,
      maxStepHeight: this.maxStepHeight,
      minStepWidth: 0.0,
      maxSlope: (60 * Math.PI) / 180,
      snapToGround: this.snapToGround
    });

    if (this.groundProbe) {
      this.groundProbe.setCollider(this.collider);
    }

    console.log('CharacterController: Rapier KinematicCharacterController ready.');
  }

  /**
   * Set visibility of the character capsule collider debug
   */
  setColliderDebugVisible(visible) {
    if (this.model) {
      this.model.setColliderDebugVisible(visible);
    }
  }

  /**
   * Sets initial character position and teleports physics rigid body
   */
  setPosition(x, y, z) {
    this.position.set(x, y, z);
    this.mesh.position.copy(this.position);
    if (this.rigidBody) {
      this.rigidBody.setTranslation({ x, y: y + this.capsuleCenter, z }, true);
    }
  }

  /**
   * Teleports character immediately in physics and graphics (e.g. limbo or respawn)
   */
  teleport(x, y, z) {
    this.position.set(x, y, z);
    this.mesh.position.copy(this.position);
    if (this.rigidBody) {
      this.rigidBody.setTranslation({ x, y: y + this.capsuleCenter, z }, true);
      this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
  }

  /**
   * Sets mounting state (hides avatar, suspends movement & input while operating a turret)
   */
  setMounted(mounted) {
    this.isMounted = mounted;
    if (this.model) {
      this.model.setVisible(!mounted);
    }
    if (mounted) {
      this.velocity.set(0, 0, 0);
      this.verticalVelocity = 0;
    }
  }

  get cameraMode() {
    return this.springArm ? this.springArm.mode : CameraMode.THIRD_PERSON;
  }

  set cameraMode(val) {
    if (this.springArm) this.springArm.setMode(val);
  }

  /**
   * Toggles between First-Person and Third-Person views
   */
  toggleCameraMode() {
    const newMode = this.springArm.toggleMode();
    const isFirstPerson = newMode === CameraMode.FIRST_PERSON;
    if (this.model) {
      this.model.setFirstPerson(isFirstPerson);
    }
    return newMode;
  }

  /**
   * Phase 4 (Post-Physics): Resolves character kinematic movement, moving platform
   * displacement inheritance, and Rapier collision sweeps against current platform transforms.
   */
  postPhysicsUpdate(delta) {
    // Suspend character update when operating a gun turret or when aerial dev camera is active
    if (this.isMounted || this.isDevSuspended) {
      return;
    }

    // 1. Toggle camera view (V / TAB / C)
    if (this.input.isActionJustPressed('toggleCamera')) {
      this.toggleCameraMode();
    }

    // 2. Mouse Look (Pointer Lock or Mouse Drag)
    const isDragging = this.input.isActionDown('mouseLook');
    if (this.input.isPointerLocked || isDragging) {
      const deltaX = this.input.mouseDelta.x;
      const deltaY = this.input.mouseDelta.y;

      if (deltaX !== 0 || deltaY !== 0) {
        // Mouse Right (deltaX > 0) -> Turn Right
        this.yaw -= deltaX * this.mouseSensitivity;

        // Mouse Up (deltaY < 0) -> Look Up
        this.pitch -= deltaY * this.mouseSensitivity;

        // Clamp vertical look between -80 deg and +80 deg
        const maxPitch = 1.4;
        this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
      }
    }

    // 3. Directional vectors based on current Yaw
    this._camForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    this._camRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();

    // 4. WASD Movement Input
    let moveZ = 0;
    if (this.input.isActionDown('forward')) moveZ += 1;
    if (this.input.isActionDown('backward')) moveZ -= 1;

    let moveX = 0;
    if (this.input.isActionDown('steerRight')) moveX += 1;
    if (this.input.isActionDown('steerLeft')) moveX -= 1;

    this._moveDir.set(0, 0, 0);
    if (moveZ !== 0 || moveX !== 0) {
      this._moveDir.addScaledVector(this._camForward, moveZ);
      this._moveDir.addScaledVector(this._camRight, moveX);
      if (this._moveDir.lengthSq() > 0) {
        this._moveDir.normalize();
      }
    }

    // Sprint modifier
    const isSprinting = this.input.isActionDown('sprint');
    const speed = isSprinting ? this.sprintSpeed : this.walkSpeed;

    this.velocity.x = this._moveDir.x * speed;
    this.velocity.z = this._moveDir.z * speed;

    // 5. Physics Collision & Kinematic Character Controller
    if (this.characterController && this.rigidBody && this.collider) {
      const currPos = this.rigidBody.translation();

      // Probe surface beneath and ahead of character; project horizontal velocity along slope tangent
      const { groundHit, slopeMove } = this.groundProbe.probe(currPos, this.velocity, delta);

      // Resolve moving platform displacement (e.g. Battleship deck heave, pitch, roll)
      const platformDisp = this.platformTracker.update(this.position, this.isGrounded, groundHit);

      // Jump, gravity & movement assembly
      let desiredMovement;
      if (this.isGrounded) {
        if (this.input.isActionJustPressed('jump')) {
          this.verticalVelocity = this.jumpForce;
          this.isGrounded = false;
          desiredMovement = {
            x: this.velocity.x * delta + platformDisp.x,
            y: this.verticalVelocity * delta + platformDisp.y,
            z: this.velocity.z * delta + platformDisp.z
          };
        } else {
          this.verticalVelocity = 0;
          desiredMovement = {
            x: slopeMove.x + platformDisp.x,
            y: slopeMove.y + platformDisp.y,
            z: slopeMove.z + platformDisp.z
          };
        }
      } else {
        this.verticalVelocity -= this.gravity * delta;
        desiredMovement = {
          x: this.velocity.x * delta + platformDisp.x,
          y: this.verticalVelocity * delta + platformDisp.y,
          z: this.velocity.z * delta + platformDisp.z
        };
      }

      // Rapier sweeps 1 capsule collider and returns resolved movement
      this.characterController.computeColliderMovement(
        this.collider,
        desiredMovement
      );

      const correctedMovement = this.characterController.computedMovement();
      this.isGrounded = this.characterController.computedGrounded();

      const nextPos = {
        x: currPos.x + correctedMovement.x,
        y: currPos.y + correctedMovement.y,
        z: currPos.z + correctedMovement.z
      };
      this.rigidBody.setNextKinematicTranslation(nextPos);

      // Sync character visual position to collision-resolved position
      this.position.set(
        nextPos.x,
        nextPos.y - this.capsuleCenter,
        nextPos.z
      );

    } else {
      // Fallback ground collision if physics is pending
      if (this.position.y <= 0) {
        this.position.y = 0;
        this.verticalVelocity = 0;
        this.isGrounded = true;
      }
      this.position.x += this.velocity.x * delta;
      this.position.y += this.verticalVelocity * delta;
      this.position.z += this.velocity.z * delta;
    }

    // Sync mesh position and yaw rotation
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;
  }

  /**
   * Phase 6 (Late Update): Updates camera positioning and spring-arm obstacle raycasting
   * after all character movements and external forces are fully settled.
   */
  lateUpdate(delta) {
    if (this.isMounted || this.isDevSuspended) return;

    const { isTooClose, mode } = this.springArm.update(
      delta,
      this.position,
      this.yaw,
      this.pitch,
      this.collider
    );

    const hideMesh = isTooClose || mode === CameraMode.FIRST_PERSON;
    if (this.model) {
      this.model.setFirstPerson(hideMesh);
    }
  }


  /**
   * Clean up
   */
  dispose() {
    this.gameWorld.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.gameWorld.canvas.removeEventListener('click', this._onPointerDown);

    if (this.physicsWorld) {
      if (this.collider) {
        this.physicsWorld.removeCollider(this.collider, true);
        this.collider = null;
      }
      if (this.rigidBody) {
        this.physicsWorld.removeRigidBody(this.rigidBody);
        this.rigidBody = null;
      }
    }
    if (this.characterController) {
      this.characterController.free();
      this.characterController = null;
    }

    if (this.model) {
      this.model.dispose();
      this.model = null;
    }

    super.dispose();
  }
}

export { Player as CharacterController };
