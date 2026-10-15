import * as THREE from 'three';
import { BaseEntity } from '../BaseEntity.js';
import { createPlayerJetModel } from '../models/PlayerJetModel.js';
import { HealthComponent } from '../components/HealthComponent.js';
import config from '../../config.json';

/**
 * Player-controlled jet with kinematic flight, a chase camera, and pooled guns.
 */
export class PlayerJet extends BaseEntity {
  constructor(gameWorld, options = {}) {
    super('PlayerJet');
    this.gameWorld = gameWorld;

    this.mesh = createPlayerJetModel();
    this.mesh.name = 'PlayerJet';
    this.mesh.userData.entity = this;
    this.mesh.position.copy(options.position ?? new THREE.Vector3(0, 100, 0));
    if (options.rotation) this.mesh.quaternion.copy(options.rotation);
    this.faction = options.faction ?? 'humans';
    this.health = new HealthComponent(options.maxHealth ?? config.playerJet.health);
    this.isDestroyed = false;
    this.onDestroyed = options.onDestroyed ?? null;
    this.health.onDamage = () => {
      const ui = this.gameWorld.ui;
      if (!ui) return;
      ui.flashDamage();
      ui.updatePlayerHealth(this.health.currentHealth, this.health.maxHealth);
    };
    this.health.onDeath = () => {
      this.isDestroyed = true;
      this.mesh.visible = false;
      if (this.onDestroyed) this.onDestroyed(this);
    };

    const jetConfig = config.playerJet;
    this.minSpeed = jetConfig.minSpeed;
    this.maxSpeed = jetConfig.maxSpeed;
    this.currentSpeed = jetConfig.defaultSpeed;
    this.acceleration = jetConfig.acceleration;
    this.pitchRate = jetConfig.pitchRate;
    this.rollRate = jetConfig.rollRate;
    this.yawRate = jetConfig.yawRate;
    this.maxPitch = jetConfig.maxPitch;
    this.maxBank = jetConfig.maxBank;
    this.bankTurnRate = jetConfig.bankTurnRate;
    this.bankLevelingRate = jetConfig.bankLevelingRate;
    this.cameraFollowSpeed = jetConfig.cameraFollowSpeed;
    this.lowSpeedControlAuthority = jetConfig.lowSpeedControlAuthority;
    this.weaponConfig = jetConfig.weapon;

    this.rotationEuler = new THREE.Euler().setFromQuaternion(this.mesh.quaternion, 'YXZ');
    this.velocity = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._cameraOffset = new THREE.Vector3(0, 3, -10);
    this._cameraPosition = new THREE.Vector3();
    this._cameraTarget = new THREE.Vector3();
    this._muzzlePosition = new THREE.Vector3();
    this._aimPoint = new THREE.Vector3();
    this._gunDirection = new THREE.Vector3();
    this._fireCooldown = 0;

    this.rigidBody = null;
    this.collider = null;
    this.setupPhysics();
  }

  setupPhysics() {
    const physics = this.gameWorld.physics;
    if (!physics?.world) return;

    this.rigidBody = physics.createKinematicRigidBody({
      position: this.mesh.position,
      rotation: this.mesh.quaternion
    });
    if (!this.rigidBody) return;

    const colliderRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    const colliderDesc = physics.RAPIER.ColliderDesc.capsule(
      config.playerJet.collider.halfHeight,
      config.playerJet.collider.radius
    ).setRotation(colliderRotation);
    this.collider = physics.createCollider(colliderDesc, this.rigidBody);
    if (this.collider) this.collider.userData = { entity: this };
  }

  prePhysicsUpdate(delta, gameWorld = this.gameWorld) {
    if (this.isDestroyed) return;
    const input = gameWorld.input;
    if (!input) return;

    this.currentSpeed = THREE.MathUtils.clamp(
      this.currentSpeed + input.getAxis('throttleDown', 'throttleUp') * this.acceleration * delta,
      this.minSpeed,
      this.maxSpeed
    );

    const pitchInput = input.getAxis('pitchDown', 'pitchUp');
    const rollInput = input.getAxis('rollRight', 'rollLeft');
    const yawInput = input.getAxis('yawRight', 'yawLeft');

    this.rotationEuler.setFromQuaternion(this.mesh.quaternion, 'YXZ');
    const controlAuthority = THREE.MathUtils.clamp(
      this.currentSpeed / this.maxSpeed,
      this.lowSpeedControlAuthority,
      1
    );
    this.rotationEuler.x = THREE.MathUtils.clamp(
      this.rotationEuler.x - pitchInput * this.pitchRate * controlAuthority * delta,
      -this.maxPitch,
      this.maxPitch
    );
    if (rollInput !== 0) {
      this.rotationEuler.z = THREE.MathUtils.clamp(
        this.rotationEuler.z + rollInput * this.rollRate * controlAuthority * delta,
        -this.maxBank,
        this.maxBank
      );
    } else {
      this.rotationEuler.z *= Math.exp(-this.bankLevelingRate * delta);
    }

    const bankTurn = Math.sin(this.rotationEuler.z) * this.bankTurnRate;
    this.rotationEuler.y -= (yawInput * this.yawRate + bankTurn) * controlAuthority * delta;
    this.mesh.quaternion.setFromEuler(this.rotationEuler);

    this._forward.set(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    this.velocity.copy(this._forward).multiplyScalar(this.currentSpeed);
    this.mesh.position.addScaledVector(this.velocity, delta);

    if (this.rigidBody) {
      this.rigidBody.setNextKinematicTranslation(this.mesh.position);
      this.rigidBody.setNextKinematicRotation(this.mesh.quaternion);
    }
  }

  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    if (this.isDestroyed) return;
    this._fireCooldown = Math.max(0, this._fireCooldown - delta);
    const input = gameWorld.input;
    if (!input?.isActionDown('firePrimary') || this._fireCooldown > 0) return;

    const pool = gameWorld.projectilePool;
    if (!pool) return;

    const direction = this._forward.set(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    this._aimPoint.copy(direction).multiplyScalar(config.playerJet.weapon.convergenceDistance)
      .add(this.mesh.position);
    for (const wing of [-1, 1]) {
      this._muzzlePosition.set(wing * 1.4, -0.12, 1.8)
        .applyQuaternion(this.mesh.quaternion)
        .add(this.mesh.position);
      this._gunDirection.subVectors(this._aimPoint, this._muzzlePosition).normalize();
      pool.fireFlak({
        origin: this._muzzlePosition,
        direction: this._gunDirection,
        spread: this.weaponConfig.spread,
        speed: this.weaponConfig.projectileSpeed,
        source: this,
        excludeCollider: this.collider
      });
    }
    this._fireCooldown = 1 / this.weaponConfig.roundsPerSecond;
  }

  lateUpdate(delta, gameWorld = this.gameWorld) {
    if (this.isDestroyed || gameWorld.activeCamera) return;

    this._cameraPosition.copy(this._cameraOffset)
      .applyQuaternion(this.mesh.quaternion)
      .add(this.mesh.position);
    this._cameraTarget.copy(this.mesh.position);
    this._cameraTarget.y += 1;

    const blend = 1 - Math.exp(-this.cameraFollowSpeed * delta);
    gameWorld.camera.position.lerp(this._cameraPosition, blend);
    gameWorld.camera.lookAt(this._cameraTarget);
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
