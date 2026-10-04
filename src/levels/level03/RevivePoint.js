import * as THREE from 'three';
import { BaseEntity } from '../../entities/BaseEntity.js';

const COLORS = {
  post: 0x2b3038,
  waiting: 0xffb347,  // Not reached yet: an amber light column calls you over
  reached: 0x2ec4b6   // Reached: the squad's teal
};
const COLUMN_HEIGHT = 14;

/**
 * RevivePoint
 * A squad beacon along the way through the village: a post with a lamp and a tall column of
 * light so you can see it from a distance. Walk within `radius` of it and it is reached (it turns
 * teal and onReached() is called): if you are lost after that, you come back here.
 * Has no collider (you walk through it) and no point light (Level 3's light budget is spent).
 *
 * - Phase 5 (gameplayUpdate): notices the player coming by
 * - Phase 6 (lateUpdate): the lamp turns, the light column pulses
 */
export class RevivePoint extends BaseEntity {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {string} options.name - Shown when it is reached ("Revive point: the village gate")
   * @param {THREE.Vector3} options.position - Ground point
   * @param {Object} options.player - Has position and health
   * @param {number} options.radius - How close the player must come
   * @param {(point: RevivePoint) => void} [options.onReached]
   * @param {() => boolean} [options.canReach] - Extra condition (e.g. the player must be inside the hall)
   */
  constructor(gameWorld, { name, position, player, radius, onReached = null, canReach = () => true }) {
    super(name);
    this.gameWorld = gameWorld;
    this.position = position.clone();
    this.player = player;
    this.radius = radius;
    this.onReached = onReached;
    this.canReach = canReach;
    this.reached = false;
    this._time = Math.random() * 10;

    this.mesh = new THREE.Group();
    this.mesh.name = 'RevivePoint';
    this.mesh.position.copy(this.position);

    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 2.2, 6), new THREE.MeshStandardMaterial({ color: COLORS.post }));
    post.position.y = 1.1;
    post.castShadow = true;
    this.mesh.add(post);

    this._lampMaterial = new THREE.MeshBasicMaterial({ color: COLORS.waiting, toneMapped: false });
    this.lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), this._lampMaterial);
    this.lamp.position.y = 2.45;
    this.mesh.add(this.lamp);

    const columnGeometry = new THREE.CylinderGeometry(0.35, 0.35, COLUMN_HEIGHT, 8, 1, true);
    columnGeometry.translate(0, COLUMN_HEIGHT / 2, 0);
    this._columnMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.waiting, transparent: true, opacity: 0.35, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, fog: false
    });
    this.column = new THREE.Mesh(columnGeometry, this._columnMaterial);
    this.column.frustumCulled = false;
    this.mesh.add(this.column);
  }

  /** Where the player comes back (just beside the post). */
  get respawnPosition() {
    return new THREE.Vector3(this.position.x + 1.2, this.position.y + 0.3, this.position.z + 1.2);
  }

  gameplayUpdate() {
    if (this.reached || !this.player) return;
    if (this.player.health && this.player.health.isDead) return;
    const p = this.player.position;
    if (Math.hypot(p.x - this.position.x, p.z - this.position.z) <= this.radius && this.canReach()) this.reach();
  }

  /** Marks it reached (once). */
  reach() {
    if (this.reached) return;
    this.reached = true;
    this._lampMaterial.color.setHex(COLORS.reached);
    this._columnMaterial.color.setHex(COLORS.reached);
    if (this.onReached) this.onReached(this);
  }

  lateUpdate(delta) {
    this._time += delta;
    this.lamp.rotation.y += delta * 1.5;
    this._columnMaterial.opacity = this.reached ? 0.12 : 0.28 + 0.12 * Math.sin(this._time * 3);
  }
}
