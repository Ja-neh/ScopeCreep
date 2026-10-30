import * as THREE from 'three';
import { BaseEntity } from './BaseEntity.js';
import { createRifleModel, createWeaponMaterials, disposeModelGeometry } from '../weapons/WeaponModels.js';
import config from '../config.json';

/** Reach for a world rifle before equipping it. Owns no character physics. */
export class WeaponPickup extends BaseEntity {
  constructor(gameWorld, player, weapons, position) {
    super('WeaponPickup');
    this.gameWorld = gameWorld; this.player = player; this.weapons = weapons;
    this.cfg = config.weaponPickup;
    this.position = position.clone();
    this.materials = createWeaponMaterials();
    this.mesh = createRifleModel(this.materials).mesh;
    this.mesh.position.copy(position);
    this.mesh.rotation.z = Math.PI / 2;
    this.progress = 0;
    this.collected = false;
    this.active = false;
    this._reach = new THREE.Vector3();
    this._grip = new THREE.Vector3();
    this._carryRotation = new THREE.Quaternion();
  }

  gameplayUpdate(delta) {
    if (this.collected) return;
    const player = this.player, gw = this.gameWorld;
    const near = player.position.distanceToSquared(this.position) <= this.cfg.radius ** 2;
    const canReach = near && !player.isMounted && !player.isDevSuspended && !player.health?.isDead;
    if (!this.active) {
      if (!canReach) { gw.ui.hidePrompt(this); return; }
      gw.ui.showPrompt('[E]', 'PICK UP RIFLE', '#e9c46a', this);
      if (!gw.input.isActionJustPressed('specialAction')) return;
      this.active = true;
      this.weapons.isPickingUp = true;
      this.weapons.switchTimer = this.cfg.reachSeconds;
      gw.ui.hidePrompt(this);
    }
    if (!canReach) { this._cancel(); return; }
    this.progress = Math.min(1, this.progress + delta / this.cfg.reachSeconds);
    const skin = player.model.character;
    this.mesh.localToWorld(this._reach.copy(this.mesh.userData.grips.right));
    skin.pickupTarget = this._reach;
    skin.pickupBlend = Math.sin(Math.PI * this.progress);
    skin.pickupProgress = this.progress;
    const hand=skin.joints?.rightHand?.bone;
    if (hand && this.progress>=0.45) {
      this.player.mesh.getWorldQuaternion(this._carryRotation);
      this.mesh.quaternion.slerp(this._carryRotation,Math.min(1,delta*12));
      this.mesh.scale.setScalar(0.7);
      hand.getWorldPosition(this._reach);
      this._grip.copy(this.mesh.userData.grips.right).multiplyScalar(0.7).applyQuaternion(this.mesh.quaternion);
      this.mesh.position.copy(this._reach).sub(this._grip);
    }
    if (this.progress < 1) return;
    this.collected = true;
    this.mesh.visible = false;
    this.weapons.pickUpRifle();
    this.weapons.isPickingUp = false;
    skin.pickupTarget = null;
    skin.pickupBlend = 0;
    skin.pickupProgress = -1;
    gw.ui.showToast('Rifle equipped', 'info', 1500);
  }

  _cancel() {
    this.active = false; this.progress = 0;
    this.weapons.isPickingUp = false;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.set(0,0,Math.PI/2);
    this.mesh.scale.setScalar(1);
    this.player.model.character.pickupTarget = null;
    this.player.model.character.pickupBlend = 0;
    this.player.model.character.pickupProgress = -1;
  }

  dispose() {
    this.gameWorld.ui.hidePrompt(this);
    if (this.active && !this.collected && this.player.model) this._cancel();
    disposeModelGeometry(this.mesh);
    for (const material of Object.values(this.materials)) material.dispose();
  }
}
