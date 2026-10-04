import * as THREE from 'three';
import { BaseEntity } from './BaseEntity.js';
import { HealthComponent } from './components/HealthComponent.js';
import config from '../config.json';

const DEFAULT_CAPSULE = { radius: 0.45, halfHeight: 0.55 }; // Human-sized: 2 m tall
const ARRIVE_RADIUS = 0.8;
const ACCELERATION = 10;          // How fast velocity reaches the desired speed (1/s)
const TURN_RATE = 6;              // Radians per second
const FEELER_HEIGHT = 1.2;
const FEELER_DISTANCE = 2.5;
const FEELER_ANGLES = [0, 0.6, -0.6, 1.2, -1.2];
const STUCK_CHECK_SECONDS = 1.0;
const STUCK_MIN_PROGRESS = 0.5;
const DETOUR_SECONDS = 1.2;

/**
 * GroundCombatant
 * Base class for anything that fights on foot under AI control (alien troopers, brutes,
 * AI squadmates). Owns a kinematic capsule with its own character controller, health,
 * a faction, and simple steering: move towards a point, sidestep obstacles found by short
 * feeler rays, and back out when stuck. Subclasses decide where to go and what to shoot.
 *
 * - Phase 4 (postPhysicsUpdate): steering and the character sweep
 * - Phase 5 (gameplayUpdate): subclass brain
 * - Phase 6 (lateUpdate): model pose and animation
 */
export class GroundCombatant extends BaseEntity {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {string} options.name
   * @param {THREE.Vector3} options.position - Feet position
   * @param {string} options.faction - 'humans' or 'aliens'
   * @param {number} options.maxHealth
   * @param {Object} options.model - Has `mesh`, animate(delta, speed, aiming, raise), setFallen(t), setHitFlash(t), dispose()
   * @param {{radius: number, halfHeight: number}} [options.capsule] - Collider size (default human-sized)
   */
  constructor(gameWorld, { name, position, faction, maxHealth, model, capsule = DEFAULT_CAPSULE }) {
    super(name);
    this.gameWorld = gameWorld;
    this.physicsWorld = gameWorld.physics;
    this.faction = faction;
    this.health = new HealthComponent(maxHealth);
    this.isConcealed = false;

    this.position = position.clone();
    this.velocity = new THREE.Vector3();
    this.verticalVelocity = 0;
    this.gravity = config.player.locomotion.gravity;
    this.yaw = 0;
    this.isGrounded = false;
    this.isAiming = false;
    this.attackPose = 0; // 0..1: arms raised for a melee strike
    this.capsuleCenter = capsule.radius + capsule.halfHeight;
    this.eyeHeight = this.capsuleCenter * 1.6; // Used by Perception

    // Movement orders
    this.moveTarget = new THREE.Vector3();
    this.hasMoveTarget = false;
    this.moveSpeed = 0;
    this.faceTarget = new THREE.Vector3();
    this.hasFaceTarget = false;

    // Death
    this.isDead = false;
    this.deathTime = 0;

    this.model = model;
    this.mesh = model.mesh;
    this.mesh.position.copy(this.position);
    this.mesh.userData.entity = this;

    // Physics
    const RAPIER = this.physicsWorld.RAPIER;
    this.rigidBody = this.physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y + this.capsuleCenter, position.z)
    );
    this.collider = this.physicsWorld.createCollider(RAPIER.ColliderDesc.capsule(capsule.halfHeight, capsule.radius), this.rigidBody);
    this.collider.userData = { entity: this };
    this.characterController = this.physicsWorld.createCharacterController({
      offset: 0.01,
      maxStepHeight: 0.45,
      minStepWidth: 0.0,
      maxSlope: (50 * Math.PI) / 180,
      snapToGround: true
    });

    // Steering scratchpads and stuck detection
    this._feelerRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    this._desired = new THREE.Vector3();
    this._steer = new THREE.Vector3();
    this._detourDir = new THREE.Vector3();
    this._detourTimer = 0;
    this._stuckTimer = 0;
    this._stuckFrom = this.position.clone();
    this._hitFlash = 0;

    this.health.onDamage = (info) => {
      this._hitFlash = 1;
      this.onDamaged(info);
    };
    this.health.onDeath = (info) => this._die(info);
  }

  // ---------------------------------------------------------------------------
  // Orders for subclasses
  // ---------------------------------------------------------------------------

  moveTo(point, speed) {
    this.moveTarget.copy(point);
    this.hasMoveTarget = true;
    this.moveSpeed = speed;
  }

  stop() {
    this.hasMoveTarget = false;
  }

  /** Puts it straight down with its feet at (x, y, z), standing still (dev tools, respawns). */
  teleport(x, y, z) {
    this.position.set(x, y, z);
    if (this.rigidBody) this.rigidBody.setTranslation({ x, y: y + this.capsuleCenter, z }, true);
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.hasMoveTarget = false;
    if (this.mesh) this.mesh.position.copy(this.position);
  }

  hasArrived() {
    return !this.hasMoveTarget ||
      Math.hypot(this.moveTarget.x - this.position.x, this.moveTarget.z - this.position.z) < ARRIVE_RADIUS;
  }

  lookAt(point) {
    this.faceTarget.copy(point);
    this.hasFaceTarget = true;
  }

  clearLook() {
    this.hasFaceTarget = false;
  }

  /**
   * Direction the combatant faces (for backstab checks).
   */
  getForward(out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /**
   * Hook for subclasses: called whenever damage lands (before death).
   */
  onDamaged(info) { }

  /**
   * Hook for subclasses: called once on death.
   */
  onDied(info) { }

  /**
   * Back on its feet after being downed (e.g. a squadmate revived it).
   * @param {number} health
   */
  revive(health) {
    if (!this.isDead || !this.rigidBody) return;
    this.health.revive(health);
    this.isDead = false;
    this.deathTime = 0;
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    if (this.collider) this.collider.setEnabled(true);
    if (this.model) this.model.setFallen(0);
    this.onRevived();
  }

  /**
   * Hook for subclasses: called after revive().
   */
  onRevived() { }

  _die(info) {
    this.isDead = true;
    this.deathTime = 0;
    this.hasMoveTarget = false;
    this.velocity.set(0, 0, 0);
    if (this.collider) this.collider.setEnabled(false);
    this.onDied(info);
  }

  // ---------------------------------------------------------------------------
  // Phase 4: steering and character sweep
  // ---------------------------------------------------------------------------

  postPhysicsUpdate(delta) {
    if (this.isDead || !this.rigidBody) return;

    this._computeDesiredVelocity(delta);

    // Ease towards the desired horizontal velocity
    const blend = Math.min(1, ACCELERATION * delta);
    this.velocity.x += (this._desired.x - this.velocity.x) * blend;
    this.velocity.z += (this._desired.z - this.velocity.z) * blend;

    this.verticalVelocity = this.isGrounded ? -1 : this.verticalVelocity - this.gravity * delta;

    const current = this.rigidBody.translation();
    this.characterController.computeColliderMovement(this.collider, {
      x: this.velocity.x * delta,
      y: this.verticalVelocity * delta,
      z: this.velocity.z * delta
    });
    const moved = this.characterController.computedMovement();
    this.isGrounded = this.characterController.computedGrounded();

    const next = { x: current.x + moved.x, y: current.y + moved.y, z: current.z + moved.z };
    this.rigidBody.setNextKinematicTranslation(next);
    this.position.set(next.x, next.y - this.capsuleCenter, next.z);

    this._turn(delta);
    this._checkStuck(delta);
  }

  _computeDesiredVelocity(delta) {
    this._desired.set(0, 0, 0);
    if (!this.hasMoveTarget || this.hasArrived()) return;

    if (this._detourTimer > 0) {
      this._detourTimer -= delta;
      this._desired.copy(this._detourDir).multiplyScalar(this.moveSpeed);
      return;
    }

    this._steer.set(this.moveTarget.x - this.position.x, 0, this.moveTarget.z - this.position.z).normalize();
    this._pickClearDirection(this._steer);
    this._desired.copy(this._steer).multiplyScalar(this.moveSpeed);
  }

  /**
   * Rotates `dir` to the first feeler angle whose short ray is clear of obstacles.
   */
  _pickClearDirection(dir) {
    const baseAngle = Math.atan2(dir.x, dir.z);
    const ray = this._feelerRay;
    ray.origin.x = this.position.x;
    ray.origin.y = this.position.y + FEELER_HEIGHT;
    ray.origin.z = this.position.z;

    for (const offset of FEELER_ANGLES) {
      const angle = baseAngle + offset;
      ray.dir.x = Math.sin(angle);
      ray.dir.y = 0;
      ray.dir.z = Math.cos(angle);
      const hit = this.physicsWorld.castRay(ray, FEELER_DISTANCE, true, undefined, undefined, this.collider);
      if (!hit) {
        dir.set(ray.dir.x, 0, ray.dir.z);
        return;
      }
    }
    // Everything blocked: keep heading at the target and let the stuck check take over
  }

  _turn(delta) {
    let targetYaw = null;
    if (this.hasFaceTarget) {
      targetYaw = Math.atan2(-(this.faceTarget.x - this.position.x), -(this.faceTarget.z - this.position.z));
    } else if (this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z > 0.09) {
      targetYaw = Math.atan2(-this.velocity.x, -this.velocity.z);
    }
    if (targetYaw === null) return;

    let diff = targetYaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const step = TURN_RATE * delta;
    this.yaw += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
  }

  _checkStuck(delta) {
    if (!this.hasMoveTarget || this.hasArrived() || this._detourTimer > 0) {
      this._stuckTimer = 0;
      this._stuckFrom.copy(this.position);
      return;
    }
    this._stuckTimer += delta;
    if (this._stuckTimer < STUCK_CHECK_SECONDS) return;

    const progress = Math.hypot(this.position.x - this._stuckFrom.x, this.position.z - this._stuckFrom.z);
    if (progress < STUCK_MIN_PROGRESS) {
      // Sidestep left or right of the blocked heading for a moment
      const side = Math.random() < 0.5 ? 1 : -1;
      this._detourDir.set(this._steer.z * side, 0, -this._steer.x * side);
      this._detourTimer = DETOUR_SECONDS;
    }
    this._stuckTimer = 0;
    this._stuckFrom.copy(this.position);
  }

  // ---------------------------------------------------------------------------
  // Phase 5: subclasses call super.gameplayUpdate for hit flash and death timing
  // ---------------------------------------------------------------------------

  gameplayUpdate(delta) {
    if (this._hitFlash > 0) this._hitFlash = Math.max(0, this._hitFlash - delta * 8);
    if (this.isDead) this.deathTime += delta;
  }

  // ---------------------------------------------------------------------------
  // Phase 6: pose
  // ---------------------------------------------------------------------------

  lateUpdate(delta) {
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;
    this.model.setHitFlash(this._hitFlash);
    if (this.isDead) {
      this.model.setFallen(Math.min(1, this.deathTime / 0.5));
    } else {
      this.model.animate(delta, Math.hypot(this.velocity.x, this.velocity.z), this.isAiming, this.attackPose);
    }
  }

  dispose() {
    if (this.rigidBody) {
      this.physicsWorld.removeRigidBody(this.rigidBody);
      this.rigidBody = null;
      this.collider = null;
    }
    if (this.characterController) {
      this.characterController.free();
      this.characterController = null;
    }
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    this.mesh = null;
    super.dispose();
  }
}
