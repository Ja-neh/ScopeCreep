import * as THREE from 'three';
import { DamageInfo, DamageType, HealthComponent } from '../../entities/components/HealthComponent.js';
import config from '../../config.json';

// Bushes have no physics collider (shots pass straight through the leaves), so a bullet is
// matched against them geometrically: the same hiding radius BeachCover grants them
const BUSH_RADIUS = 1.5;
const BUSH_HEIGHT = 1.6;
const SHRINK_SECONDS = 0.35; // How long a destroyed prop takes to collapse away

/**
 * DestructibleCover
 * Gives Level 2's scenery a health pool so firefights eat into it: bushes are shot away fast,
 * trees take a burst, rocks last longest. Balance comes from
 * `config.levels.level02.destructibleCover`.
 *
 * Trees and rocks already own physics colliders, so bullets and projectile hits land on them
 * through the normal weapon path: their colliders are tagged (`userData.entity = prop`) and
 * this component answers `health.takeDamage`. Bushes have no collider, so the weapon reports
 * each shot's flight segment through `bulletImpact` instead. Explosions (alien grenades) sweep
 * every prop through `explosionDamage`.
 *
 * A destroyed prop leaves the world quietly: its collider goes, BeachCover forgets it (so AI
 * loses it as cover and it stops hiding anyone), and the instance shrinks away over a moment.
 *
 * - Level: builds after `cover.build()`, destroys with the level
 * - Phase 5 (`update`): the short collapse animation
 */
export class DestructibleCover {
  /**
   * @param {GameWorld} gameWorld
   * @param {BeachCover} cover - The vegetation BeachCover built, with colliders created
   */
  constructor(gameWorld, cover) {
    this.gameWorld = gameWorld;
    this.cover = cover;

    this.props = [];      // Everything still standing that can be shot away
    this.bushes = [];     // Subset: the ones with no collider, checked by bullet segments
    this._shrinking = []; // { prop, t } collapses in progress

    this._settings = config.levels.level02.destructibleCover;
    this._bulletDamage = config.weapons.machineGun.damage;

    // Reused per damage event (no allocations while under fire)
    this._damageInfo = new DamageInfo(0, DamageType.KINETIC);
    this._segment = new THREE.Vector3();
    this._toBush = new THREE.Vector3();
  }

  /**
   * Reads every placement BeachCover built and gives the bushes, trees and rocks a health pool.
   */
  build() {
    for (const vegetation of this.cover.vegetation) {
      this._addKind(vegetation, 'bush', vegetation.placements.bushes);
      this._addKind(vegetation, 'tree', vegetation.placements.trees);
      this._addKind(vegetation, 'rock', vegetation.placements.rocks);
    }
    console.log(`[DestructibleCover] ${this.props.length} destructible props (${this.bushes.length} bushes).`);
  }

  _addKind(vegetation, kind, placements) {
    for (const placement of placements) {
      const prop = {
        kind,
        name: `Cover_${kind}`,
        placement,
        vegetation,
        x: placement.x,
        z: placement.z,
        radius: 1,
        health: new HealthComponent(this._settings[kind].health)
      };

      if (kind === 'bush') {
        const scale = typeof placement.scale === 'number' ? placement.scale : 1;
        prop.radius = BUSH_RADIUS * scale;
        prop.radiusSq = prop.radius * prop.radius;
        prop.y0 = placement.y - 0.2;
        prop.top = placement.y + BUSH_HEIGHT * scale;
        this.bushes.push(prop);
      } else if (kind === 'tree') {
        const scale = typeof placement.scale === 'number' ? placement.scale : 1;
        prop.radius = 0.35 * scale; // The trunk collider's radius, as Vegetation builds it
      } else {
        const scale = placement.scale;
        prop.radius = Math.max(scale.x, scale.z) * 0.9;
      }

      prop.health.onDeath = () => this._destroy(prop);
      if (placement.collider) placement.collider.userData = { entity: prop };
      this.props.push(prop);
    }
  }

  /**
   * A bullet flew from `origin` and stopped at `point`. Bushes have no collider, so the shot's
   * flight segment is matched against them here: the nearest bush the line passes through takes
   * the hit (one bullet per prop).
   * @returns {boolean} Whether a bush was hit
   */
  bulletImpact(origin, point) {
    if (this.bushes.length === 0) return false;
    const segment = this._segment.subVectors(point, origin);
    const lengthSq = segment.lengthSq();
    if (lengthSq < 1e-6) return false;

    let nearest = null;
    let nearestT = Infinity;
    for (const bush of this.bushes) {
      this._toBush.set(bush.x - origin.x, 0, bush.z - origin.z);
      const t = THREE.MathUtils.clamp(
        (this._toBush.x * segment.x + this._toBush.z * segment.z) / lengthSq,
        0,
        1
      );
      if (t >= nearestT) continue;

      const dx = origin.x + segment.x * t - bush.x;
      const dz = origin.z + segment.z * t - bush.z;
      if (dx * dx + dz * dz > bush.radiusSq) continue;

      const y = origin.y + segment.y * t;
      if (y < bush.y0 || y > bush.top) continue;

      nearest = bush;
      nearestT = t;
    }

    if (!nearest) return false;
    this._applyDamage(nearest, this._bulletDamage, DamageType.KINETIC, null);
    return true;
  }

  /**
   * An explosion went off at `point`: every prop within `radius` (measured to its surface)
   * takes damage falling off with distance. Called by the level for every alien grenade.
   */
  explosionDamage(point, radius, damage) {
    for (let i = this.props.length - 1; i >= 0; i--) {
      const prop = this.props[i];
      const centre = Math.hypot(prop.x - point.x, prop.z - point.z);
      const gap = Math.max(0, centre - prop.radius);
      if (gap >= radius) continue;
      const falloff = 1 - gap / radius;
      this._applyDamage(prop, damage * falloff, DamageType.EXPLOSIVE, point);
    }
  }

  _applyDamage(prop, amount, type, point) {
    const info = this._damageInfo;
    info.amount = amount;
    info.type = type;
    info.source = null;
    info.direction = null;
    info.point = point;
    prop.health.takeDamage(info);
  }

  /**
   * A prop ran out of health: it leaves play at once (colliders, cover queries, concealment)
   * and its instance collapses over SHRINK_SECONDS.
   */
  _destroy(prop) {
    const index = this.props.indexOf(prop);
    if (index >= 0) this.props.splice(index, 1);
    const bushIndex = this.bushes.indexOf(prop);
    if (bushIndex >= 0) this.bushes.splice(bushIndex, 1);

    if (prop.kind === 'bush') {
      this.cover.removeBush(prop.placement);
    } else {
      prop.vegetation.removePlacementCollider(prop.placement);
      this.cover.removeSolidAt(prop.x, prop.z);
      if (prop.kind === 'rock') {
        const rock = this.cover.rocks.find((r) => Math.abs(r.x - prop.x) < 0.05 && Math.abs(r.z - prop.z) < 0.05);
        if (rock) this.cover.removeRock(rock);
      }
    }

    this._shrinking.push({ prop, t: 0 });
  }

  /**
   * Phase 5: advances the collapse of each destroyed prop. The instance shrinks to nothing,
   * then stops being drawn at all.
   */
  update(delta) {
    for (let i = this._shrinking.length - 1; i >= 0; i--) {
      const entry = this._shrinking[i];
      entry.t += delta / SHRINK_SECONDS;
      if (entry.t >= 1) {
        entry.prop.vegetation.hidePlacement(entry.prop.placement);
        this._shrinking.splice(i, 1);
      } else {
        entry.prop.vegetation.setPlacementScale(entry.prop.placement, 1 - entry.t * entry.t);
      }
    }
  }

  dispose() {
    this.props = [];
    this.bushes = [];
    this._shrinking = [];
  }
}
