import * as THREE from 'three';
import { BaseEntity } from '../../entities/BaseEntity.js';
import config from '../../config.json';

const CRATE_SIZE = new THREE.Vector3(1.3, 0.8, 0.85);
const CRATE_YAW = 0.35;
const PROMPT_COLOR = '#e9c46a';

/**
 * SupplyCrate
 * A supply crate dropped on the beach. Stand next to it and press [E] (specialAction) to refill
 * the machine gun's reserve ammo and patch yourself up to full health. Low cover as well.
 * Updated in Phase 5.
 */
export class SupplyCrate extends BaseEntity {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {THREE.Vector3} options.position - On the ground
   * @param {Player} options.player
   * @param {WeaponController} options.weapons - Whose rifle gets refilled
   * @param {number} [options.radius] - Interaction distance (config.levels.level02.supplyCrateRadius)
   */
  constructor(gameWorld, { position, player, weapons, radius = config.levels.level02.supplyCrateRadius }) {
    super('SupplyCrate');
    this.gameWorld = gameWorld;
    this.physicsWorld = gameWorld.physics;
    this.player = player;
    this.weapons = weapons;
    this.radius = radius;
    this.position = position.clone();
    this.isPlayerNear = false;
    this.timesUsed = 0;
    this._promptLabel = '';

    this.materials = {
      wood: new THREE.MeshStandardMaterial({ color: 0x5b6b3a, roughness: 0.85, flatShading: true }),
      trim: new THREE.MeshStandardMaterial({ color: 0x2f3524, roughness: 0.8 }),
      stencil: new THREE.MeshStandardMaterial({ color: 0xe9c46a, roughness: 0.6 })
    };
    this.mesh = new THREE.Group();
    this.mesh.name = 'SupplyCrate';
    this.mesh.position.copy(position);
    this.mesh.rotation.y = CRATE_YAW;
    this._build();

    const centre = new THREE.Vector3(position.x, position.y + CRATE_SIZE.y / 2, position.z);
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), CRATE_YAW);
    this.collider = this.physicsWorld.createStaticBox(
      { x: CRATE_SIZE.x / 2, y: CRATE_SIZE.y / 2, z: CRATE_SIZE.z / 2 },
      centre,
      rotation
    );
  }

  _build() {
    const { wood, trim, stencil } = this.materials;
    const { x, y, z } = CRATE_SIZE;
    this._add(new THREE.BoxGeometry(x, y, z), wood, 0, y / 2, 0);
    // Lid rim and corner straps
    this._add(new THREE.BoxGeometry(x + 0.04, 0.06, z + 0.04), trim, 0, y - 0.03, 0);
    for (const side of [-1, 1]) {
      this._add(new THREE.BoxGeometry(0.06, y + 0.02, z + 0.04), trim, side * (x / 2 - 0.12), y / 2, 0);
    }
    // Yellow ammo stripe on both long sides
    for (const side of [-1, 1]) {
      this._add(new THREE.BoxGeometry(0.5, 0.12, 0.01), stencil, 0, y * 0.55, side * (z / 2 + 0.005));
    }
    // A loose ammo can on top
    this._add(new THREE.BoxGeometry(0.32, 0.2, 0.18), trim, 0.25, y + 0.1, 0.05);
  }

  _add(geometry, material, x, y, z) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.mesh.add(mesh);
    return mesh;
  }

  get isAmmoFull() {
    const rifle = this.weapons.rifle;
    return rifle.reserve >= rifle.cfg.reserveAmmo;
  }

  get isHealthFull() {
    const health = this.player.health;
    return !health || health.currentHealth >= health.maxHealth;
  }

  /**
   * Tops the rifle's reserve and the player's health back up to full.
   * @returns {boolean} Whether anything was given
   */
  resupply() {
    if (this.isAmmoFull && this.isHealthFull) return false;
    this.weapons.rifle.reserve = this.weapons.rifle.cfg.reserveAmmo;
    const health = this.player.health;
    if (health && !health.isDead) {
      health.heal(health.maxHealth);
      if (this.gameWorld.ui) this.gameWorld.ui.updatePlayerHealth(health.currentHealth, health.maxHealth);
    }
    this.timesUsed++;
    return true;
  }

  /**
   * Phase 5: proximity prompt and [E] to resupply.
   */
  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    const player = this.player;
    const ui = gameWorld.ui;
    const alive = !player.health || !player.health.isDead;
    const near = alive && !player.isDevSuspended &&
      Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z) <= this.radius;

    if (near) {
      if (gameWorld.input.isActionJustPressed('specialAction') && this.resupply() && ui) {
        ui.showToast('Resupplied: ammo and health topped up', 'success', 1500);
      }
      const label = this.isAmmoFull && this.isHealthFull ? 'FULLY SUPPLIED' : 'RESUPPLY (AMMO + HEALTH)';
      if (ui && (label !== this._promptLabel || !this.isPlayerNear)) ui.showPrompt('E', label, PROMPT_COLOR, this);
      this._promptLabel = label;
    } else if (this.isPlayerNear && ui) {
      ui.hidePrompt(this);
    }
    this.isPlayerNear = near;
  }

  dispose() {
    if (this.isPlayerNear && this.gameWorld.ui) this.gameWorld.ui.hidePrompt(this);
    if (this.collider) {
      this.physicsWorld.removeRigidBody(this.collider.rigidBody);
      this.collider = null;
    }
    if (this.mesh) {
      this.mesh.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
      });
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    }
    for (const material of Object.values(this.materials)) material.dispose();
    this.mesh = null;
    super.dispose();
  }
}
