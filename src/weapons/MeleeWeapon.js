import * as THREE from 'three';
import { DamageInfo, DamageType } from '../entities/components/HealthComponent.js';

// Fan of rays checked when the blade lands, as horizontal angle offsets (radians)
const SWING_ANGLES = [-0.3, 0, 0.3];

/**
 * MeleeWeapon
 * The combat knife: a short wind-up, then a fan of short rays in front of the attacker.
 * Silent (it raises no gunshot noise) and deals extra damage from behind when the target
 * exposes getForward(out). Balance values come from config.json (`weapons.knife`).
 */
export class MeleeWeapon {
  /**
   * @param {Object} cfg - e.g. config.weapons.knife
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.cooldownTimer = 0;
    this.windupTimer = -1; // >= 0 while a swing is winding up

    this._ray = null;
    this._forward = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._targetForward = new THREE.Vector3();
    this._damageInfo = new DamageInfo(0, DamageType.KINETIC);
    this.lastHit = { hit: false, point: new THREE.Vector3(), entity: null, killed: false, backstab: false };
  }

  get isSwinging() {
    return this.windupTimer >= 0;
  }

  /**
   * 0..1 through the whole swing (for animation); 1 when idle.
   */
  get swingProgress() {
    return this.cooldownTimer > 0 ? 1 - this.cooldownTimer / this.cfg.cooldown : 1;
  }

  /**
   * @returns {boolean} Whether a swing started
   */
  startAttack() {
    if (this.cooldownTimer > 0) return false;
    this.cooldownTimer = this.cfg.cooldown;
    this.windupTimer = this.cfg.windup;
    return true;
  }

  /**
   * Advances timers. Returns true on the frame the blade lands, when the caller should call strike().
   */
  update(delta) {
    if (this.cooldownTimer > 0) this.cooldownTimer -= delta;
    if (this.windupTimer >= 0) {
      this.windupTimer -= delta;
      if (this.windupTimer < 0) {
        this.windupTimer = -1;
        return true;
      }
    }
    return false;
  }

  /**
   * Resolves the hit: the first ray in the fan that reaches a damageable entity.
   * @param {Object} swing
   * @param {PhysicsWorld} swing.physicsWorld
   * @param {THREE.Vector3} swing.origin - Chest height of the attacker
   * @param {number} swing.yaw - Attacker's facing (0 = -Z)
   * @param {number} [swing.pitch] - Attacker's look pitch (radians)
   * @param {RAPIER.Collider} [swing.excludeCollider]
   * @param {Object} [swing.source]
   */
  strike({ physicsWorld, origin, yaw, pitch = 0, excludeCollider = null, source = null }) {
    const result = this.lastHit;
    result.hit = false;
    result.entity = null;
    result.killed = false;
    result.backstab = false;

    if (!this._ray) {
      this._ray = new physicsWorld.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    }
    const clampedPitch = THREE.MathUtils.clamp(pitch, -0.5, 0.5);

    for (const offset of SWING_ANGLES) {
      const angle = yaw + offset;
      this._direction.set(-Math.sin(angle) * Math.cos(clampedPitch), Math.sin(clampedPitch), -Math.cos(angle) * Math.cos(clampedPitch));
      this._ray.origin.x = origin.x;
      this._ray.origin.y = origin.y;
      this._ray.origin.z = origin.z;
      this._ray.dir.x = this._direction.x;
      this._ray.dir.y = this._direction.y;
      this._ray.dir.z = this._direction.z;

      const hit = physicsWorld.castRay(this._ray, this.cfg.range, true, undefined, undefined, excludeCollider);
      if (!hit) continue;
      const entity = hit.collider.userData ? hit.collider.userData.entity : null;
      if (!entity || entity === source || !entity.health || typeof entity.health.takeDamage !== 'function') continue;

      // Backstab: attacking along the direction the target faces
      let damage = this.cfg.damage;
      if (typeof entity.getForward === 'function') {
        entity.getForward(this._targetForward);
        this._forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
        if (this._forward.dot(this._targetForward) > 0.5) {
          damage *= this.cfg.backstabMultiplier;
          result.backstab = true;
        }
      }

      this._damageInfo.amount = damage;
      this._damageInfo.source = source;
      entity.health.takeDamage(this._damageInfo);

      result.hit = true;
      result.entity = entity;
      result.killed = entity.health.isDead;
      result.point.copy(origin).addScaledVector(this._direction, hit.timeOfImpact);
      return result;
    }
    return result;
  }
}
