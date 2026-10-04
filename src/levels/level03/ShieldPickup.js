import * as THREE from 'three';
import { BaseEntity } from '../../entities/BaseEntity.js';

const COLOR = 0x66e8ff;
const HOVER_HEIGHT = 1.2;
const COLUMN_HEIGHT = 6;

/**
 * ShieldPickup
 * A personal shield left lying in the village: a glowing hexagonal emblem turning over the ground,
 * with a short column of light. Walk into it (within `radius`) and it charges the player's
 * shield (PlayerShield) to full, once; it is not taken while the shield is already full.
 * No collider, no point light.
 *
 * - Phase 5 (gameplayUpdate): notices the player walking into it
 * - Phase 6 (lateUpdate): bobs and turns
 */
export class ShieldPickup extends BaseEntity {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {THREE.Vector3} options.position - Ground point
   * @param {Object} options.player
   * @param {PlayerShield} options.shield - What it charges
   * @param {number} options.radius
   */
  constructor(gameWorld, { position, player, shield, radius }) {
    super('ShieldPickup');
    this.gameWorld = gameWorld;
    this.position = position.clone();
    this.player = player;
    this.shield = shield;
    this.radius = radius;
    this.taken = false;
    this._time = Math.random() * 10;

    this.mesh = new THREE.Group();
    this.mesh.name = 'ShieldPickup';
    this.mesh.position.copy(this.position);
    const glow = new THREE.MeshBasicMaterial({ color: COLOR, toneMapped: false });
    this.emblem = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 6), glow);
    plate.rotation.x = Math.PI / 2;
    this.emblem.add(plate);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 6, 6), glow);
    this.emblem.add(rim);
    this.emblem.position.y = HOVER_HEIGHT;
    this.mesh.add(this.emblem);

    const column = new THREE.CylinderGeometry(0.25, 0.25, COLUMN_HEIGHT, 8, 1, true);
    column.translate(0, COLUMN_HEIGHT / 2, 0);
    this.column = new THREE.Mesh(column, new THREE.MeshBasicMaterial({
      color: COLOR, transparent: true, opacity: 0.25, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false
    }));
    this.mesh.add(this.column);
  }

  gameplayUpdate() {
    if (this.taken || !this.player || this.player.health.isDead) return;
    if (this.shield.health >= this.shield.maxHealth) return; // Nothing to charge
    const p = this.player.position;
    if (Math.hypot(p.x - this.position.x, p.z - this.position.z) > this.radius) return;
    this.taken = true;
    this.mesh.visible = false;
    this.shield.charge();
    if (this.gameWorld.ui) this.gameWorld.ui.showToast('Shield picked up: it takes the hits until it breaks.', 'success', 2500);
  }

  lateUpdate(delta) {
    if (this.taken) return;
    this._time += delta;
    this.emblem.rotation.y += delta * 1.5;
    this.emblem.position.y = HOVER_HEIGHT + Math.sin(this._time * 2) * 0.15;
  }
}
