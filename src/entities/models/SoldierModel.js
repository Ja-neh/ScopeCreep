import * as THREE from 'three';
import { createWeaponMaterials, createRifleModel, disposeModelGeometry } from '../../weapons/WeaponModels.js';
import { consolidateMeshes } from '../../rendering/MeshMerge.js';

/**
 * SoldierModel
 * Procedural low-poly human soldier for AI squadmates and pilots, in the player's colours:
 * suit, helmet with a coloured visor, backpack, jointed legs and arms, and the same machine gun
 * the player carries. Visual only. Origin at the feet, facing -Z.
 * Has the interface GroundCombatant expects: animate(), setFallen(), setHitFlash(), muzzle, dispose().
 * Each rigid piece (body, each limb, the gun) is merged into one mesh: about 6 draw calls.
 */
export class SoldierModel {
  /**
   * @param {Object} [options]
   * @param {number} [options.suitColor] - Teal for ship crew, olive for pilots
   * @param {number} [options.visorColor]
   * @param {number} [options.helmetColor]
   */
  constructor({ suitColor = 0x2a9d8f, visorColor = 0xe76f51, helmetColor = 0x264653 } = {}) {
    this.mesh = new THREE.Group();
    this.mesh.name = 'Soldier';
    this.body = new THREE.Group(); // Falls as one piece
    this.mesh.add(this.body);

    this.materials = {
      suit: new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.65, metalness: 0.1, flatShading: true }),
      gear: new THREE.MeshStandardMaterial({ color: helmetColor, roughness: 0.8, flatShading: true }),
      visor: new THREE.MeshStandardMaterial({ color: visorColor, roughness: 0.3, metalness: 0.5, flatShading: true }),
      boots: new THREE.MeshStandardMaterial({ color: 0x1f2326, roughness: 0.9 })
    };
    this.weaponMaterials = createWeaponMaterials();
    const { suit, gear, visor, boots } = this.materials;

    // Torso, vest and backpack
    this._add(this.body, new THREE.CapsuleGeometry(0.27, 0.45, 3, 8), suit, 0, 1.22, 0);
    this._add(this.body, new THREE.BoxGeometry(0.5, 0.42, 0.34), gear, 0, 1.3, -0.02);
    this._add(this.body, new THREE.BoxGeometry(0.42, 0.5, 0.2), gear, 0, 1.28, 0.27);

    // Head, helmet and visor
    this._add(this.body, new THREE.SphereGeometry(0.15, 10, 8), suit, 0, 1.7, 0);
    const helmet = this._add(this.body, new THREE.SphereGeometry(0.19, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), gear, 0, 1.74, 0.01);
    helmet.scale.set(1, 0.85, 1.05);
    this._add(this.body, new THREE.BoxGeometry(0.26, 0.08, 0.08), visor, 0, 1.72, -0.15);

    // Legs swing from the hips
    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.13, 0.92, 0);
      this.body.add(hip);
      this._add(hip, new THREE.CapsuleGeometry(0.095, 0.6, 2, 6), suit, 0, -0.42, 0);
      this._add(hip, new THREE.BoxGeometry(0.14, 0.1, 0.26), boots, 0, -0.86, -0.04);
      return hip;
    });

    // Arms swing from the shoulders
    this.arms = [-1, 1].map((side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.33, 1.45, 0);
      this.body.add(shoulder);
      this._add(shoulder, new THREE.CapsuleGeometry(0.07, 0.42, 2, 6), suit, 0, -0.28, 0);
      return shoulder;
    });

    // Machine gun held across the body; raised to the shoulder when aiming
    const rifle = createRifleModel(this.weaponMaterials);
    this.gun = rifle.mesh;
    this.gun.position.set(0.18, 1.18, -0.3);
    this.body.add(this.gun);
    this.muzzle = rifle.muzzle;

    this._walkPhase = 0;
    this._mergeParts();

    this.mesh.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  _add(parent, geometry, material, x, y, z) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  /**
   * Merges the parts of each rigid piece, keeping their colours as vertex colours.
   */
  _mergeParts() {
    const partMaterials = [...Object.values(this.materials), ...Object.values(this.weaponMaterials)];
    this.materials = {
      solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.15, flatShading: true }),
      light: new THREE.MeshBasicMaterial({ vertexColors: true })
    };
    this.weaponMaterials = {};
    for (const group of [this.body, ...this.legs, ...this.arms, this.gun]) {
      consolidateMeshes(group, this.materials.solid, this.materials.light);
    }
    for (const material of partMaterials) material.dispose();
  }

  /**
   * Walk cycle and aiming pose.
   * @param {number} delta
   * @param {number} speed - Horizontal speed in m/s
   * @param {boolean} aiming - Gun up at the shoulder
   */
  animate(delta, speed, aiming) {
    this._walkPhase += delta * speed * 2.4;
    const swing = Math.min(1, speed / 4) * 0.6;
    const s = Math.sin(this._walkPhase) * swing;
    this.legs[0].rotation.x = s;
    this.legs[1].rotation.x = -s;
    // Both hands stay on the gun: arms forward, more so when aiming
    const armPitch = aiming ? -1.25 : -0.7 + s * 0.15;
    this.arms[0].rotation.x = armPitch;
    this.arms[1].rotation.x = armPitch;
    this.arms[0].rotation.z = -0.5;
    this.gun.position.y = aiming ? 1.38 : 1.18;
    this.gun.rotation.x = aiming ? 0 : 0.3;
  }

  /**
   * Topple over `progress` 0..1 (killed).
   */
  setFallen(progress) {
    this.body.rotation.x = progress * (Math.PI / 2) * 0.95;
    this.body.position.y = -progress * 0.1;
  }

  /**
   * Brief red flash when hit (0..1).
   */
  setHitFlash(amount) {
    this.materials.solid.emissive.setRGB(amount * 0.6, 0, 0);
  }

  dispose() {
    disposeModelGeometry(this.gun);
    this.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
    });
    for (const material of Object.values(this.materials)) material.dispose();
    for (const material of Object.values(this.weaponMaterials)) material.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}
