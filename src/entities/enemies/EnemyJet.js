import * as THREE from 'three';
import { BaseEntity } from '../BaseEntity.js';
import { HealthComponent } from '../components/HealthComponent.js';
import { StateMachine } from '../../ai/StateMachine.js';
import { createPlayerJetModel } from '../models/PlayerJetModel.js';
import config from '../../config.json';

const FORWARD = new THREE.Vector3(0, 0, 1);

/**
 * AI brain states, mirroring the battleship's StateMachine architecture:
 * navigation runs in Phase 2 (prePhysicsUpdate -> brain.update), firing in
 * Phase 5 (gameplayUpdate) while the brain sits in ATTACK.
 */
export const JetAIState = {
  APPROACH: 'approach',
  ATTACK: 'attack',
  BREAKAWAY: 'breakaway',
  DEAD: 'dead'
};

/**
 * Pursuit-and-attack aircraft for the jet combat sandbox.
 */
export class EnemyJet extends BaseEntity {
  constructor(gameWorld, options = {}) {
    super('EnemyJet');
    this.gameWorld = gameWorld;
    this.target = options.target ?? null;
    this.faction = options.faction ?? 'aliens';
    this.variant = options.variant ?? 'fighter';
    this.onDestroyed = options.onDestroyed ?? null;
    const settings = config.enemyJet;
    const variantSettings = this.variant === 'ace' ? settings.ace : settings;
    this.mesh = createPlayerJetModel({
      bodyColor: this.variant === 'ace' ? 0xd3a329 : 0x8f3b35,
      wingColor: this.variant === 'ace' ? 0x503d19 : 0x4a2324,
      canopyColor: this.variant === 'ace' ? 0xffe08a : 0xe88c4a
    });
    this.mesh.name = 'EnemyJet';
    this.mesh.userData.entity = this;
    this.mesh.position.copy(options.position ?? new THREE.Vector3(0, 100, -370));

    this.health = new HealthComponent(options.maxHealth ?? variantSettings.health ?? settings.health);
    this._defaultMaxHealth = this.health.maxHealth;
    this.isDestroyed = false;
    this.health.onDeath = () => {
      this.isDestroyed = true;
      this.mesh.visible = false;
      this.velocity.set(0, 0, 0);
      if (this.rigidBody) {
        this.gameWorld.physics.removeRigidBody(this.rigidBody);
        this.rigidBody = null;
        this.collider = null;
      }
      if (this.brain) this.brain.change(JetAIState.DEAD);
      if (this.onDestroyed) this.onDestroyed(this);
    };
    this._hitFlash = 0;
    this._hitFlashColor = new THREE.Color(0xff241a);
    this._materials = [];
    this.mesh.traverse((child) => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (material.emissive) this._materials.push({ material, emissive: material.emissive.clone() });
      }
    });
    this.health.onDamage = () => { this._hitFlash = 0.16; };

    this.speed = variantSettings.cruiseSpeed;
    this.turnRate = variantSettings.turnRate;
    this.attackRange = settings.attackRange;
    this.minimumAttackRange = settings.minimumAttackRange;
    this.aimTolerance = THREE.MathUtils.degToRad(settings.aimToleranceDegrees);
    this.fireCadence = variantSettings.fireCadence ?? settings.fireCadence;
    this.projectileSpeed = settings.projectileSpeed;
    this.projectileDamage = variantSettings.projectileDamage ?? settings.projectileDamage;
    this.spread = variantSettings.spread ?? settings.spread;
    this.burstSize = settings.burstSize;
    this.breakawaySeconds = settings.breakawaySeconds;
    this.weaveAmplitude = settings.weaveAmplitude;
    this.weaveFrequency = settings.weaveFrequency;
    this.breakawaySideStrength = settings.breakawaySideStrength;
    this.repositionAltitude = settings.repositionAltitude;
    this.targetHeight = settings.targetHeight;
    this.attackStyle = options.attackStyle ?? (this.variant === 'ace' ? 'weave' : 'direct');
    this.breakawaySide = options.breakawaySide ?? (this.variant === 'ace' ? -1 : 1);
    this._maneuverElapsed = 0;
    this._maneuverTimer = 0;
    this._burstShotsRemaining = this.burstSize;
    this._fireCooldown = 0;

    /** Public so anti-air gunnery can lead this aircraft. Mirrors PlayerJet.velocity. */
    this.velocity = new THREE.Vector3();

    this._targetPosition = new THREE.Vector3();
    this._aimPosition = new THREE.Vector3();
    this._desiredDirection = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._muzzlePosition = new THREE.Vector3();
    this._fireDirection = new THREE.Vector3();
    this._targetRotation = new THREE.Quaternion();
    this._colliderRotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.PI / 2, 0, 0)
    );

    this.rigidBody = null;
    this.collider = null;
    // Pool spares are built without physics; the first lease creates the body.
    if (!options.deferPhysics) this._setupPhysics();

    // 1. AI State Machine (Phase 2 navigation; Phase 5 firing reads brain state)
    this.brain = new StateMachine(this, this._buildStateHandlers(), options.initialState || JetAIState.APPROACH);
    // 2. Pool bookkeeping: when set, dispose() is a no-op (the pool owns teardown).
    this._pooled = false;
    this._disposed = false;
  }

  _setupPhysics() {
    if (this.rigidBody) return;
    const physics = this.gameWorld.physics;
    if (!physics?.world) return;

    this.rigidBody = physics.createKinematicRigidBody({
      position: this.mesh.position,
      rotation: this.mesh.quaternion
    });
    if (!this.rigidBody) return;

    const colliderConfig = config.enemyJet.collider;
    const colliderDesc = physics.RAPIER.ColliderDesc.capsule(
      colliderConfig.halfHeight,
      colliderConfig.radius
    ).setRotation(this._colliderRotation);
    this.collider = physics.createCollider(colliderDesc, this.rigidBody);
    if (this.collider) this.collider.userData = { entity: this };
  }

  _getTargetPosition() {
    if (!this.target || this.target.isDestroyed || !this.target.mesh) {
      this.target = null;

      const currentLevel = this.gameWorld?.currentLevel;
      const preferredHumanTargets = [
        currentLevel?.playerJet,
        currentLevel?.battleship,
        ...[...(this.gameWorld?.entities ?? [])].filter(
          (entity) => entity !== this && entity.faction === 'humans' && entity.mesh && !entity.isDestroyed
        )
      ].filter(Boolean);

      for (const entity of preferredHumanTargets) {
        if (entity === currentLevel?.playerJet && !entity.isDestroyed) {
          this.target = entity;
          break;
        }
      }

      if (!this.target) {
        for (const entity of preferredHumanTargets) {
          if (entity === currentLevel?.battleship && !entity.isDestroyed) {
            this.target = entity;
            break;
          }
        }
      }

      if (!this.target) {
        for (const entity of preferredHumanTargets) {
          if (entity && !entity.isDestroyed) {
            this.target = entity;
            break;
          }
        }
      }
    }
    if (!this.target) return false;

    this._targetPosition.copy(this.target.mesh.position);
    if (this.target === this.gameWorld.currentLevel?.battleship) {
      this._targetPosition.y += this.targetHeight;
    }
    return true;
  }

  /**
   * Constructs the tactical state handlers for the StateMachine.
   */
  _buildStateHandlers() {
    return {
      [JetAIState.APPROACH]: {
        enter: (jet) => {
          jet._burstShotsRemaining = jet.burstSize;
        },
        update: (jet, delta) => {
          if (jet.isDestroyed) return JetAIState.DEAD;
          if (!jet._getTargetPosition()) {
            jet.velocity.set(0, 0, 0);
            return;
          }

          const distance = jet._pursuitSteering(delta);
          if (distance <= jet.attackRange) return JetAIState.ATTACK;
        }
      },

      [JetAIState.ATTACK]: {
        update: (jet, delta) => {
          if (jet.isDestroyed) return JetAIState.DEAD;
          if (!jet._getTargetPosition()) {
            jet.velocity.set(0, 0, 0);
            return;
          }

          const distance = jet._pursuitSteering(delta);
          if (distance > jet.attackRange) return JetAIState.APPROACH;
        }
      },

      [JetAIState.BREAKAWAY]: {
        enter: (jet) => {
          jet._maneuverTimer = jet.breakawaySeconds;
        },
        update: (jet, delta) => {
          if (jet.isDestroyed) return JetAIState.DEAD;
          jet._maneuverTimer -= delta;
          if (jet._maneuverTimer <= 0) return JetAIState.APPROACH;
          jet._breakawaySteering(delta);
        }
      },

      [JetAIState.DEAD]: {
        update: () => {
          // Inert; teardown already happened in health.onDeath.
        }
      }
    };
  }

  /**
   * Pursuit steering: slews the nose toward the (lead-compensated, weave-offset)
   * target point and commits kinematic flight. Returns the pre-lead distance,
   * which the states use for their transition bands.
   */
  _pursuitSteering(delta) {
    const distance = this.mesh.position.distanceTo(this._targetPosition);
    const flightTime = distance / this.projectileSpeed;
    if (this.target.velocity) {
      this._aimPosition.copy(this.target.velocity).multiplyScalar(flightTime);
      this._targetPosition.add(this._aimPosition);
    }
    const navigationTarget = this._aimPosition.copy(this._targetPosition);
    if (this.attackStyle === 'weave') {
      navigationTarget.x += Math.sin(this._maneuverElapsed * this.weaveFrequency) * this.weaveAmplitude;
    }
    this._desiredDirection.subVectors(navigationTarget, this.mesh.position);
    this._commitFlight(delta);
    return distance;
  }

  /**
   * Breakaway steering: away from the target, biased to one side and climbing
   * toward the reposition altitude.
   */
  _breakawaySteering(delta) {
    this._desiredDirection.subVectors(this.mesh.position, this._targetPosition);
    if (this._desiredDirection.lengthSq() < 1e-6) this._desiredDirection.set(0, 0, -1);
    this._desiredDirection.normalize();
    this._desiredDirection.x += this.breakawaySide * this.breakawaySideStrength;
    this._desiredDirection.y += Math.max(
      0,
      this._targetPosition.y + this.repositionAltitude - this.mesh.position.y
    ) / this.repositionAltitude;
    this._desiredDirection.normalize();
    this._commitFlight(delta);
  }

  /**
   * Rotates toward the desired direction at the turn rate, then advances at
   * cruise speed and syncs the kinematic body.
   */
  _commitFlight(delta) {
    if (this._desiredDirection.lengthSq() < 1e-6) return;
    this._desiredDirection.normalize();
    this._targetRotation.setFromUnitVectors(FORWARD, this._desiredDirection);
    this.mesh.quaternion.rotateTowards(this._targetRotation, this.turnRate * delta);
    this._forward.copy(FORWARD).applyQuaternion(this.mesh.quaternion);
    this.velocity.copy(this._forward).multiplyScalar(this.speed);
    this.mesh.position.addScaledVector(this._forward, this.speed * delta);

    if (this.rigidBody) {
      this.rigidBody.setNextKinematicTranslation(this.mesh.position);
      this.rigidBody.setNextKinematicRotation(this.mesh.quaternion);
    }
  }

  /**
   * Phase 2 (Pre-Physics): advance the AI State Machine (navigational steering).
   */
  prePhysicsUpdate(delta) {
    if (this.isDestroyed) return;
    this._maneuverElapsed += delta;
    if (this.brain) this.brain.update(delta);
  }

  /**
   * Phase 5 (Gameplay): hit flash and guns. Firing only happens while the
   * brain sits in ATTACK; the burst counter drops the jet into BREAKAWAY.
   */
  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    if (this.isDestroyed) return;
    if (this._hitFlash > 0) {
      this._hitFlash = Math.max(0, this._hitFlash - delta);
      const flash = this._hitFlash / 0.16;
      for (const entry of this._materials) {
        entry.material.emissive.copy(entry.emissive).lerp(this._hitFlashColor, flash * 0.9);
      }
    }
    if (!this.brain.is(JetAIState.ATTACK)) return;
    this._updateGuns(delta, gameWorld);
  }

  _updateGuns(delta, gameWorld) {
    if (!this._getTargetPosition()) return;

    this._fireCooldown = Math.max(0, this._fireCooldown - delta);
    this._desiredDirection.subVectors(this._targetPosition, this.mesh.position);
    const distance = this._desiredDirection.length();
    if (distance < this.minimumAttackRange || distance > this.attackRange) return;

    const flightTime = distance / this.projectileSpeed;
    if (this.target.velocity) {
      this._aimPosition.copy(this.target.velocity).multiplyScalar(flightTime);
      this._targetPosition.add(this._aimPosition);
      this._desiredDirection.subVectors(this._targetPosition, this.mesh.position);
    }
    this._desiredDirection.normalize();
    this._forward.copy(FORWARD).applyQuaternion(this.mesh.quaternion);
    if (this._forward.dot(this._desiredDirection) < Math.cos(this.aimTolerance) || this._fireCooldown > 0) return;

    const pool = gameWorld.projectilePool;
    if (!pool) return;

    for (const wing of [-1, 1]) {
      this._muzzlePosition.set(wing * 1.4, -0.12, 1.8)
        .applyQuaternion(this.mesh.quaternion)
        .add(this.mesh.position);
      this._fireDirection.subVectors(this._targetPosition, this._muzzlePosition).normalize();
      pool.fireFlak({
        origin: this._muzzlePosition,
        direction: this._fireDirection,
        speed: this.projectileSpeed,
        damage: this.projectileDamage,
        spread: this.spread,
        source: this,
        excludeCollider: this.collider
      });
    }
    this._fireCooldown = this.fireCadence;
    this._burstShotsRemaining--;
    if (this._burstShotsRemaining <= 0) {
      this.brain.change(JetAIState.BREAKAWAY);
      this._fireCooldown = 0;
    }
  }

  /**
   * Resets the jet for a fresh lease from the pool: health, visibility,
   * hit-flash emissives, brain, timers, position/heading, and physics.
   */
  _resetForLease({ position, target, onDestroyed = null, maxHealth } = {}) {
    this._pooled = false;
    this._disposed = false;
    this.target = target ?? null;
    this.onDestroyed = onDestroyed;
    this.isDestroyed = false;
    this.health.maxHealth = this._defaultMaxHealth;
    this.health.reset();
    if (maxHealth !== undefined) {
      this.health.maxHealth = maxHealth;
      this.health.currentHealth = maxHealth;
    }
    this.mesh.visible = true;
    this.mesh.quaternion.identity();
    if (position) this.mesh.position.copy(position);
    this.velocity.set(0, 0, 0);
    this._hitFlash = 0;
    for (const entry of this._materials) {
      entry.material.emissive.copy(entry.emissive);
    }
    this._maneuverElapsed = 0;
    this._maneuverTimer = 0;
    this._fireCooldown = 0;
    this._burstShotsRemaining = this.burstSize;
    this.brain = new StateMachine(this, this._buildStateHandlers(), JetAIState.APPROACH);
    this._setupPhysics();
  }

  /**
   * Soft teardown when the jet is returned to the pool: hidden, inert, physics
   * body released. dispose() no-ops while `_pooled` is set, so
   * GameWorld.removeEntity cannot destroy the model the pool owns.
   */
  _retire() {
    this._pooled = true;
    this.velocity.set(0, 0, 0);
    if (this.rigidBody) {
      this.gameWorld.physics.removeRigidBody(this.rigidBody);
      this.rigidBody = null;
      this.collider = null;
    }
    this.mesh.visible = false;
  }

  dispose() {
    if (this._pooled || this._disposed) return;
    this._disposed = true;
    if (this.rigidBody && this.gameWorld.physics) {
      this.gameWorld.physics.removeRigidBody(this.rigidBody);
      this.rigidBody = null;
      this.collider = null;
    }
    super.dispose();
  }
}
