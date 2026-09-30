import * as THREE from 'three';
import { BaseEntity } from './BaseEntity.js';
import { SpringArmCamera, CameraMode } from './player-components/SpringArmCamera.js';
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

    this.walkSpeed = options.walkSpeed || locCfg.walkSpeed;
    this.sprintSpeed = options.sprintSpeed || locCfg.sprintSpeed;
    this.jumpForce = options.jumpForce || locCfg.jumpForce;
    this.gravity = options.gravity || locCfg.gravity;
    this.mouseSensitivity = options.mouseSensitivity || locCfg.mouseSensitivity;

    // Capsule dimensions: radius 0.45, halfHeight 0.55 => total height 2.0m, center at 1.0m
    this.capsuleRadius = options.capsuleRadius || 0.45;
    this.capsuleHalfHeight = options.capsuleHalfHeight || 0.55;
    // Controller offset: clearance margin (in meters) between collider and ground/obstacles
    this.controllerOffset = options.controllerOffset !== undefined ? options.controllerOffset : 0.01;

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
    this._groundNormal = new THREE.Vector3(0, 1, 0);
    this._slopeMove = new THREE.Vector3();
    this._groundRay = null;
    this._aheadRay = null;

    // Rapier physics handles
    this.rigidBody = null;
    this.collider = null;
    this.characterController = null;

    // 1. Visual representation
    this._createMesh();

    // 2. Optional collider debug visualization (green capsule)
    this._createColliderDebugMesh();

    // Initialize Rapier Kinematic Character Controller
    this._initPhysics();

    // Request pointer lock on canvas pointerdown/click (unless in dev aerial camera)
    this._onPointerDown = () => {
      if (this.isDevSuspended) return;
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
    const capsuleCenter = this.capsuleHalfHeight + this.capsuleRadius;
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(this.position.x, this.position.y + capsuleCenter, this.position.z);
    this.rigidBody = this.physicsWorld.createRigidBody(bodyDesc);

    // 1 Capsule Collider (halfHeight = 0.55, radius = 0.45 => Total Height = 2.0m)
    const colliderDesc = RAPIER.ColliderDesc.capsule(this.capsuleHalfHeight, this.capsuleRadius);
    this.collider = this.physicsWorld.createCollider(colliderDesc, this.rigidBody);

    // Rapier Kinematic Character Controller (auto-step, slope slide, snap-to-ground)
    // offset: distance that keeps collider floating cleanly above deck loop cuts
    this.characterController = this.physicsWorld.createCharacterController({
      offset: this.controllerOffset,
      maxStepHeight: 0.45,
      minStepWidth: 0.0,
      maxSlope: (60 * Math.PI) / 180
    });

    // Initialize ground and slope lookahead probe rays
    this._groundRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this._aheadRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

    console.log('CharacterController: Rapier KinematicCharacterController ready.');
  }

  /**
   * Builds the low-poly stylized humanoid capsule mesh
   */
  _createMesh() {
    this.mesh = new THREE.Group();
    this.mesh.name = 'HumanCharacter';

    // 1. Capsule Body (Height: 2.0, Radius: 0.45)
    const capsuleGeo = new THREE.CapsuleGeometry(this.capsuleRadius, this.capsuleHalfHeight * 2, 4, 12);
    const capsuleMat = new THREE.MeshStandardMaterial({
      color: 0x2a9d8f, // Stylized Narrow One teal
      roughness: 0.6,
      metalness: 0.1,
      flatShading: true
    });
    this.bodyMesh = new THREE.Mesh(capsuleGeo, capsuleMat);
    this.bodyMesh.position.y = this.capsuleHalfHeight + this.capsuleRadius;
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.mesh.add(this.bodyMesh);

    // 2. Helmet Visor - placed on -Z side (Natural Forward Direction)
    const visorGeo = new THREE.BoxGeometry(0.55, 0.22, 0.35);
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0xe76f51,
      roughness: 0.3,
      metalness: 0.5,
      flatShading: true
    });
    this.visorMesh = new THREE.Mesh(visorGeo, visorMat);
    this.visorMesh.position.set(0, 1.6, -0.42);
    this.visorMesh.castShadow = true;
    this.mesh.add(this.visorMesh);

    // 3. Backpack / Gear harness - placed on +Z side (Back of character)
    const packGeo = new THREE.BoxGeometry(0.55, 0.65, 0.22);
    const packMat = new THREE.MeshStandardMaterial({
      color: 0x264653,
      roughness: 0.8,
      flatShading: true
    });
    this.packMesh = new THREE.Mesh(packGeo, packMat);
    this.packMesh.position.set(0, 1.15, 0.42);
    this.packMesh.castShadow = true;
    this.mesh.add(this.packMesh);

    this.mesh.position.copy(this.position);

    // 4. Capsule Collider Debug Mesh (matching exact Rapier 0.5 radius x 1.0 height capsule)
    this._createColliderDebugMesh();
  }

  /**
   * Generates a neon cyan capsule wireframe & translucent surface
   * corresponding to the Rapier capsule collider (radius = 0.5, halfHeight = 0.5, total height = 2.0).
   */
  _createColliderDebugMesh() {
    this.colliderDebugGroup = new THREE.Group();
    this.colliderDebugGroup.name = 'Character_Collider_Debug';
    this.colliderDebugGroup.userData = { noCollision: true };

    const radius = this.capsuleRadius || 0.45;
    const length = (this.capsuleHalfHeight || 0.55) * 2;
    const centerY = (this.capsuleHalfHeight || 0.55) + radius;
    const capsuleGeo = new THREE.CapsuleGeometry(radius, length, 8, 16);

    const surfaceMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const wireframeMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4,
      wireframe: true,
      transparent: true,
      opacity: 0.95
    });

    const surfMesh = new THREE.Mesh(capsuleGeo, surfaceMat);
    surfMesh.position.set(0, centerY, 0);
    surfMesh.userData = { noCollision: true };
    this.colliderDebugGroup.add(surfMesh);

    const wireMesh = new THREE.Mesh(capsuleGeo, wireframeMat);
    wireMesh.position.set(0, centerY, 0);
    wireMesh.userData = { noCollision: true };
    this.colliderDebugGroup.add(wireMesh);

    this.colliderDebugGroup.visible = false;
    this.mesh.add(this.colliderDebugGroup);
  }

  /**
   * Set visibility of the character capsule collider debug
   */
  setColliderDebugVisible(visible) {
    if (this.colliderDebugGroup) {
      this.colliderDebugGroup.visible = visible;
    }
  }

  /**
   * Sets initial character position and teleports physics rigid body
   */
  setPosition(x, y, z) {
    this.position.set(x, y, z);
    this.mesh.position.copy(this.position);
    if (this.rigidBody) {
      const capsuleCenter = (this.capsuleHalfHeight || 0.55) + (this.capsuleRadius || 0.45);
      this.rigidBody.setTranslation({ x, y: y + capsuleCenter, z }, true);
    }
  }

  /**
   * Teleports character immediately in physics and graphics (e.g. limbo or respawn)
   */
  teleport(x, y, z) {
    this.position.set(x, y, z);
    this.mesh.position.copy(this.position);
    if (this.rigidBody) {
      const capsuleCenter = (this.capsuleHalfHeight || 0.55) + (this.capsuleRadius || 0.45);
      this.rigidBody.setTranslation({ x, y: y + capsuleCenter, z }, true);
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
    this.mesh.visible = !mounted;
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
    this.bodyMesh.visible = !isFirstPerson;
    this.visorMesh.visible = !isFirstPerson;
    this.packMesh.visible = !isFirstPerson;
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
      // Check for active moving platform (e.g. Battleship in naval multiplayer)
      let platformDisplacement = null;
      if (this.gameWorld && this.gameWorld.entities) {
        for (const entity of this.gameWorld.entities) {
          if (entity && entity.getPlatformDisplacement && entity.isPointOnPlatform) {
            if (entity.isPointOnPlatform(this.position)) {
              if (!this._platformDisp) this._platformDisp = new THREE.Vector3();
              entity.getPlatformDisplacement(this.position, this._platformDisp);
              platformDisplacement = this._platformDisp;
              break;
            }
          }
        }
      }

      // Jump, gravity & slope tangent movement projection
      let desiredMovement;
      if (this.isGrounded) {
        if (this.input.isActionJustPressed('jump')) {
          this.verticalVelocity = this.jumpForce;
          this.isGrounded = false;
          desiredMovement = {
            x: this.velocity.x * delta + (platformDisplacement ? platformDisplacement.x : 0),
            y: this.verticalVelocity * delta + (platformDisplacement ? platformDisplacement.y : 0),
            z: this.velocity.z * delta + (platformDisplacement ? platformDisplacement.z : 0)
          };
        } else {
          this.verticalVelocity = 0;

          // Downward raycast to probe ground normal beneath character
          const currPos = this.rigidBody.translation();
          let groundHit = null;
          if (this._groundRay && this.physicsWorld) {
            this._groundRay.origin.x = currPos.x;
            this._groundRay.origin.y = currPos.y;
            this._groundRay.origin.z = currPos.z;
            // Ray length 1.6m probes up to 0.6m below capsule bottom (capsule center = 1.0m)
            groundHit = this.physicsWorld.castRayAndGetNormal(
              this._groundRay,
              1.6,
              true,
              undefined,
              undefined,
              this.collider
            );

            // Probe ground ahead at the leading edge of the capsule to anticipate slopes before collision
            const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
            if (horizSpeed > 0.001 && this._aheadRay) {
              const probeDist = (this.capsuleRadius || 0.45) * 0.9;
              this._aheadRay.origin.x = currPos.x + (this.velocity.x / horizSpeed) * probeDist;
              this._aheadRay.origin.y = currPos.y;
              this._aheadRay.origin.z = currPos.z + (this.velocity.z / horizSpeed) * probeDist;

              const aheadHit = this.physicsWorld.castRayAndGetNormal(
                this._aheadRay,
                1.6,
                true,
                undefined,
                undefined,
                this.collider
              );

              if (aheadHit && aheadHit.normal && aheadHit.normal.y > 0.5 && aheadHit.normal.y < 0.98) {
                // Only anticipate an UPWARD incline (velocity vector moves towards/against the slope normal: dot < 0)
                const dotAhead = (this.velocity.x * aheadHit.normal.x + this.velocity.z * aheadHit.normal.z) / horizSpeed;
                if (dotAhead < -0.05) {
                  groundHit = aheadHit;
                }
              }
            }
          }

          if (groundHit && groundHit.normal && groundHit.normal.y > 0.5) {
            this._groundNormal.set(groundHit.normal.x, groundHit.normal.y, groundHit.normal.z).normalize();

            // Project horizontal movement vector onto ground surface tangent plane
            this._slopeMove.set(this.velocity.x * delta, 0, this.velocity.z * delta);
            const dot = this._slopeMove.dot(this._groundNormal);
            if (dot < 0) {
              // Climbing up: lift movement along the incline tangent to prevent capsule face wedging
              this._slopeMove.addScaledVector(this._groundNormal, -dot);
            }

            desiredMovement = {
              x: this._slopeMove.x + (platformDisplacement ? platformDisplacement.x : 0),
              y: this._slopeMove.y + (platformDisplacement ? platformDisplacement.y : 0),
              z: this._slopeMove.z + (platformDisplacement ? platformDisplacement.z : 0)
            };
          } else {
            desiredMovement = {
              x: this.velocity.x * delta + (platformDisplacement ? platformDisplacement.x : 0),
              y: (platformDisplacement ? platformDisplacement.y : 0),
              z: this.velocity.z * delta + (platformDisplacement ? platformDisplacement.z : 0)
            };
          }
        }
      } else {
        this.verticalVelocity -= this.gravity * delta;
        desiredMovement = {
          x: this.velocity.x * delta + (platformDisplacement ? platformDisplacement.x : 0),
          y: this.verticalVelocity * delta + (platformDisplacement ? platformDisplacement.y : 0),
          z: this.velocity.z * delta + (platformDisplacement ? platformDisplacement.z : 0)
        };
      }

      // Rapier sweeps 1 capsule collider and returns resolved movement
      this.characterController.computeColliderMovement(
        this.collider,
        desiredMovement
      );

      const correctedMovement = this.characterController.computedMovement();
      this.isGrounded = this.characterController.computedGrounded();

      const currentPos = this.rigidBody.translation();
      const nextPos = {
        x: currentPos.x + correctedMovement.x,
        y: currentPos.y + correctedMovement.y,
        z: currentPos.z + correctedMovement.z
      };
      this.rigidBody.setNextKinematicTranslation(nextPos);

      // Sync character visual position to collision-resolved position.
      // Both collider and mesh are perfectly aligned with zero vertical desync.
      const capsuleCenter = this.capsuleHalfHeight + this.capsuleRadius;
      this.position.set(
        nextPos.x,
        nextPos.y - capsuleCenter,
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
    this.bodyMesh.visible = !hideMesh;
    this.visorMesh.visible = !hideMesh;
    this.packMesh.visible = !hideMesh;
  }

  /**
   * Backward-compatible update method (delegates to postPhysicsUpdate + lateUpdate)
   */
  update(delta) {
    this.postPhysicsUpdate(delta);
    this.lateUpdate(delta);
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

    this.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });

    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }

    super.dispose();
  }
}

export { Player as CharacterController };
