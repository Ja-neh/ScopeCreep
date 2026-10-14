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
    this.mesh = createPlayerJetModel({
      bodyColor: 0x8f3b35,
      wingColor: 0x4a2324,
      canopyColor: 0xe88c4a
    });
    this.mesh.name = 'EnemyJet';
    this.mesh.userData.entity = this;
    this.mesh.position.copy(options.position ?? new THREE.Vector3(0, 100, -370));

    const settings = config.enemyJet;
    this.health = new HealthComponent(options.maxHealth ?? settings.health);
    this.isDestroyed = false;
    this.health.onDeath = () => {
      this.isDestroyed = true;
      this.mesh.visible = false;
    };

    this.speed = settings.cruiseSpeed;
    this.turnRate = settings.turnRate;
    this.attackRange = settings.attackRange;
    this.minimumAttackRange = settings.minimumAttackRange;
    this.aimTolerance = THREE.MathUtils.degToRad(settings.aimToleranceDegrees);
    this.fireCadence = settings.fireCadence;
    this.projectileSpeed = settings.projectileSpeed;
    this.projectileDamage = settings.projectileDamage;
    this.spread = settings.spread;
    this._fireCooldown = 0;

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
      for (const entity of this.gameWorld.entities) {
        if (entity !== this && entity.faction === 'humans' && entity.mesh && !entity.isDestroyed) {
          this.target = entity;
          break;
        }
      }
    }
    if (!this.target) return false;

    this._targetPosition.copy(this.target.mesh.position);
    return true;
  }

  prePhysicsUpdate(delta) {
    if (this.isDestroyed || !this._getTargetPosition()) return;

    const distance = this.mesh.position.distanceTo(this._targetPosition);
    const flightTime = distance / this.projectileSpeed;
    if (this.target.velocity) {
      this._aimPosition.copy(this.target.velocity).multiplyScalar(flightTime);
      this._targetPosition.add(this._aimPosition);
    }

    this._desiredDirection.subVectors(this._targetPosition, this.mesh.position);
    if (this._desiredDirection.lengthSq() < 1e-6) return;
    this._desiredDirection.normalize();

    this._targetRotation.setFromUnitVectors(FORWARD, this._desiredDirection);
    this.mesh.quaternion.rotateTowards(this._targetRotation, this.turnRate * delta);
    this._forward.copy(FORWARD).applyQuaternion(this.mesh.quaternion);
    this.mesh.position.addScaledVector(this._forward, this.speed * delta);

    if (this.rigidBody) {
      this.rigidBody.setNextKinematicTranslation(this.mesh.position);
      this.rigidBody.setNextKinematicRotation(this.mesh.quaternion);
    }
  }

  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    if (this.isDestroyed || !this._getTargetPosition()) return;

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
