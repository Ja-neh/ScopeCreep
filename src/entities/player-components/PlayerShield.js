import * as THREE from 'three';
import { BaseEntity } from '../BaseEntity.js';

const RADIUS = 1.3;
const COLORS = { full: 0x66e8ff, broken: 0xff5a5a };
const _broken = new THREE.Color(COLORS.broken);

/**
 * PlayerShield
 * A personal energy shield the player picks up: a faint bubble round them that takes incoming
 * damage before their health does (through HealthComponent.absorb). It has its own health and
 * wears down with every hit; at zero it breaks and the bubble goes. charge() fills it again.
 * Shows as a SHIELD bar over the player's health bar.
 *
 * - Hits are absorbed as they come (any phase that deals damage)
 * - Phase 6 (lateUpdate): the bubble follows the player, flashes when hit, reddens as it wears
 */
export class PlayerShield extends BaseEntity {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {Object} options.player - Has position and health (a HealthComponent)
   * @param {number} options.maxHealth
   */
  constructor(gameWorld, { player, maxHealth }) {
    super('PlayerShield');
    this.gameWorld = gameWorld;
    this.player = player;
    this.maxHealth = maxHealth;
    this.health = 0;
    this._flash = 0;
    this._time = 0;

    this._material = new THREE.MeshBasicMaterial({
      color: COLORS.full, transparent: true, opacity: 0.15, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false
    });
    this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(RADIUS, 2), this._material);
    this.mesh.name = 'PlayerShield';
    this.mesh.visible = false;

    player.health.absorb = (amount) => this._absorb(amount);
  }

  /** True while it still stands. */
  get isUp() {
    return this.health > 0;
  }

  /** Fills it up (a pickup). */
  charge() {
    this.health = this.maxHealth;
    this._showBar();
  }

  /** Takes what it can of a hit; returns what gets through to the player's health. */
  _absorb(amount) {
    if (this.health <= 0 || amount <= 0) return amount;
    const taken = Math.min(this.health, amount);
    this.health -= taken;
    this._flash = 1;
    this._showBar();
    if (this.health <= 0 && this.gameWorld.ui) this.gameWorld.ui.showToast('Your shield is broken!', 'warning', 2000);
    return amount - taken;
  }

  _showBar() {
    if (this.gameWorld.ui) this.gameWorld.ui.updatePlayerShield(this.health, this.maxHealth);
  }

  lateUpdate(delta) {
    this._time += delta;
    this.mesh.visible = this.isUp && !this.player.health.isDead;
    if (!this.mesh.visible) return;
    this.mesh.position.set(this.player.position.x, this.player.position.y + 1.0, this.player.position.z);
    this._flash = Math.max(0, this._flash - delta * 4);
    const worn = 1 - this.health / this.maxHealth;
    this._material.color.setHex(COLORS.full).lerp(_broken, worn);
    this._material.opacity = 0.12 + 0.04 * Math.sin(this._time * 4) + this._flash * 0.35;
  }

  dispose() {
    if (this.player && this.player.health && this.player.health.absorb) this.player.health.absorb = null;
    if (this.gameWorld.ui) this.gameWorld.ui.updatePlayerShield(0, this.maxHealth);
    super.dispose();
  }
}
