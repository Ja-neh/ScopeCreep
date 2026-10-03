import * as THREE from 'three';
import { DamageInfo, DamageType } from '../entities/components/HealthComponent.js';

/**
 * HitscanWeapon
 * An automatic gun whose bullets hit instantly along a ray (no projectile flight), used for the
 * infantry machine gun. Tracks the magazine, reserve ammo, rate of fire, reload, and spread that
 * blooms while firing and recovers when the trigger is released.
 * Balance values come from config.json (`weapons.machineGun`).
 */
export class HitscanWeapon {
  /**
   * @param {Object} cfg - e.g. config.weapons.machineGun
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.damage = cfg.damage;
    this.fireInterval = 1 / cfg.roundsPerSecond;
    this.magazineSize = cfg.magazine;
    this.ammo = cfg.magazine;
    this.reserve = cfg.reserveAmmo;
    this.range = cfg.range;

    this.cooldown = 0;
    this.reloadTimer = 0;
    this.bloom = 0; // Extra spread from sustained fire (radians)

    // Reused per shot (no allocations while firing)
    this._ray = null;
    this._direction = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._damageInfo = new DamageInfo(0, DamageType.KINETIC);
    this.lastHit = {
      hit: false,
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      entity: null,
      collider: null,
      damaged: false,
      killed: false
    };
  }

  get isReloading() {
    return this.reloadTimer > 0;
  }

  /**
   * 0..1 progress of the current reload (1 when not reloading).
   */
  get reloadProgress() {
    return this.isReloading ? 1 - this.reloadTimer / this.cfg.reloadSeconds : 1;
  }

  canFire() {
    return this.cooldown <= 0 && !this.isReloading && this.ammo > 0;
  }

  /**
   * Starts a reload if the magazine isn't full and there is reserve ammo.
   * @returns {boolean} Whether a reload started
   */
  startReload() {
    if (this.isReloading || this.ammo >= this.magazineSize || this.reserve <= 0) return false;
    this.reloadTimer = this.cfg.reloadSeconds;
    return true;
  }

  cancelReload() {
    this.reloadTimer = 0;
  }

  /**
   * Cone half-angle in radians for the next shot.
   * @param {{aiming: boolean, moving: boolean, crouching: boolean}} stance
   */
  currentSpread({ aiming, moving, crouching }) {
    let spread = this.cfg.spread + this.bloom + (moving ? this.cfg.movingSpreadPenalty : 0);
    if (aiming) spread *= this.cfg.adsSpreadMultiplier;
    if (crouching) spread *= this.cfg.crouchSpreadMultiplier;
    return spread;
  }

  /**
   * Advances the fire-rate cooldown, reload and spread recovery. Call every frame.
   */
  update(delta) {
    if (this.cooldown > 0) this.cooldown -= delta;
    if (this.bloom > 0) this.bloom = Math.max(0, this.bloom - this.cfg.spreadRecoveryPerSecond * delta);

    if (this.reloadTimer > 0) {
      this.reloadTimer -= delta;
      if (this.reloadTimer <= 0) {
        this.reloadTimer = 0;
        const loaded = Math.min(this.magazineSize - this.ammo, this.reserve);
        this.ammo += loaded;
        this.reserve -= loaded;
      }
    }
  }

  /**
   * Fires one round from `origin` towards `aimPoint`, scattered within `spread` radians.
   * Applies damage to whatever entity the ray hits first.
   * @param {Object} shot
   * @param {PhysicsWorld} shot.physicsWorld
   * @param {THREE.Vector3} shot.origin
   * @param {THREE.Vector3} shot.aimPoint
   * @param {number} shot.spread
   * @param {RAPIER.Collider} [shot.excludeCollider] - The shooter's own collider
   * @param {Object} [shot.source] - The shooter, credited with the damage
   * @returns {Object} `lastHit` (reused object), or null if the gun could not fire
   */
  fire({ physicsWorld, origin, aimPoint, spread, excludeCollider = null, source = null }) {
    if (!this.canFire()) return null;
    this.cooldown = this.fireInterval;
    this.ammo -= 1;
    this.bloom = Math.min(this.cfg.maxSpread, this.bloom + this.cfg.spreadPerShot);

    // Direction with a random offset inside the spread cone
    this._direction.subVectors(aimPoint, origin).normalize();
    this._right.set(-this._direction.z, 0, this._direction.x);
    if (this._right.lengthSq() < 1e-8) this._right.set(1, 0, 0); // Firing straight up or down
    this._right.normalize();
    this._up.crossVectors(this._right, this._direction).normalize();
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * Math.tan(spread);
    this._direction
      .addScaledVector(this._right, Math.cos(angle) * radius)
      .addScaledVector(this._up, Math.sin(angle) * radius)
      .normalize();

    const result = this.lastHit;
    result.hit = false;
    result.entity = null;
    result.collider = null;
    result.damaged = false;
    result.killed = false;

    if (!this._ray) {
      this._ray = new physicsWorld.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    }
    this._ray.origin.x = origin.x;
    this._ray.origin.y = origin.y;
    this._ray.origin.z = origin.z;
    this._ray.dir.x = this._direction.x;
    this._ray.dir.y = this._direction.y;
    this._ray.dir.z = this._direction.z;

    const hit = physicsWorld.castRayAndGetNormal(this._ray, this.range, true, undefined, undefined, excludeCollider);
    if (!hit) {
      result.point.copy(origin).addScaledVector(this._direction, this.range);
      return result;
    }

    result.hit = true;
    result.collider = hit.collider;
    result.point.copy(origin).addScaledVector(this._direction, hit.timeOfImpact);
    result.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);

    const entity = hit.collider.userData ? hit.collider.userData.entity : null;
    if (entity && entity !== source && entity.health && typeof entity.health.takeDamage === 'function') {
      this._damageInfo.amount = this.damage;
      this._damageInfo.source = source;
      result.entity = entity;
      result.damaged = entity.health.takeDamage(this._damageInfo) > 0;
      result.killed = entity.health.isDead;
    }
    return result;
  }
}
