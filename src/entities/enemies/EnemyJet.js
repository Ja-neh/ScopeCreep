import * as THREE from 'three';
import { BaseEntity } from '../BaseEntity.js';
import { HealthComponent } from '../components/HealthComponent.js';
import { createPlayerJetModel } from '../models/PlayerJetModel.js';
import config from '../../config.json';

const FORWARD = new THREE.Vector3(0, 0, 1);

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
    this.maneuverState = 'approach';
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
    this._setupPhysics();
  }

  _setupPhysics() {
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

  prePhysicsUpdate(delta) {
    if (this.isDestroyed || !this._getTargetPosition()) {
      this.velocity.set(0, 0, 0);
      return;
    }

    this._maneuverElapsed += delta;
    if (this.maneuverState === 'breakaway') {
      this._maneuverTimer -= delta;
      this._desiredDirection.subVectors(this.mesh.position, this._targetPosition);
      if (this._desiredDirection.lengthSq() < 1e-6) this._desiredDirection.set(0, 0, -1);
      this._desiredDirection.normalize();
      this._desiredDirection.x += this.breakawaySide * this.breakawaySideStrength;
      this._desiredDirection.y += Math.max(
        0,
        this._targetPosition.y + this.repositionAltitude - this.mesh.position.y
      ) / this.repositionAltitude;
      this._desiredDirection.normalize();
      if (this._maneuverTimer <= 0) {
        this.maneuverState = 'approach';
        this._burstShotsRemaining = this.burstSize;
      }
    } else {
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
    }
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

  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    if (this.isDestroyed) return;
    if (this._hitFlash > 0) {
      this._hitFlash = Math.max(0, this._hitFlash - delta);
      const flash = this._hitFlash / 0.16;
      for (const entry of this._materials) {
        entry.material.emissive.copy(entry.emissive).lerp(this._hitFlashColor, flash * 0.9);
      }
    }
    if (this.maneuverState === 'breakaway' || !this._getTargetPosition()) return;

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
      this.maneuverState = 'breakaway';
      this._maneuverTimer = this.breakawaySeconds;
      this._fireCooldown = 0;
    }
  }

  dispose() {
    if (this.rigidBody && this.gameWorld.physics) {
      this.gameWorld.physics.removeRigidBody(this.rigidBody);
      this.rigidBody = null;
      this.collider = null;
    }
    super.dispose();
  }
}
