import * as THREE from 'three';
import { consolidateMeshes } from '../../rendering/MeshMerge.js';

/**
 * AlienModel
 * Procedural low-poly alien trooper: armoured torso, long head with glowing green eyes,
 * jointed legs and arms, and a plasma rifle held at the right side. Visual only.
 * Origin at the feet, facing -Z. Legs and arms swing with walking speed (see animate()).
 * Each rigid piece (body, each limb, the rifle) is merged into one solid and one glowing mesh,
 * so an alien costs about 8 draw calls rather than one per part.
 */
export class AlienModel {
  /**
   * @param {Object} [options]
   * @param {number} [options.armorColor]
   * @param {number} [options.scale] - Overall size (troopers 1, brutes larger)
   * @param {boolean} [options.backpack] - Glowing power pack on the back (the brute's weak spot)
   * @param {boolean} [options.crest] - A crest of glowing spikes on the head and shoulders (the Warden)
   */
  constructor({ armorColor = 0x5d5480, scale = 1, backpack = false, crest = false } = {}) {
    this.mesh = new THREE.Group();
    this.mesh.name = 'Alien';
    this.body = new THREE.Group(); // Leans and falls as one piece
    this.body.scale.setScalar(scale);
    this.mesh.add(this.body);

    this.materials = {
      armor: new THREE.MeshStandardMaterial({ color: armorColor, roughness: 0.55, metalness: 0.4, flatShading: true }),
      plate: new THREE.MeshStandardMaterial({ color: 0x7c72a6, roughness: 0.5, metalness: 0.4, flatShading: true }),
      skin: new THREE.MeshStandardMaterial({ color: 0x7d8b6a, roughness: 0.8, flatShading: true }),
      glow: new THREE.MeshStandardMaterial({ color: 0x6dff8f, emissive: 0x6dff8f, emissiveIntensity: 1.6, toneMapped: false }),
      core: new THREE.MeshStandardMaterial({ color: 0xff8a3d, emissive: 0xff8a3d, emissiveIntensity: 1.8, toneMapped: false }),
      gun: new THREE.MeshStandardMaterial({ color: 0x24232b, roughness: 0.4, metalness: 0.7 })
    };
    const { armor, plate, skin, glow, gun } = this.materials;

    // Torso, chest plate, shoulders
    this._add(this.body, new THREE.CapsuleGeometry(0.32, 0.5, 3, 8), armor, 0, 1.25, 0);
    this._add(this.body, new THREE.BoxGeometry(0.55, 0.4, 0.2), plate, 0, 1.38, -0.17);
    // Glowing chest light: makes aliens easy to pick out against the dusk jungle
    this._add(this.body, new THREE.BoxGeometry(0.3, 0.06, 0.04), glow, 0, 1.42, -0.28);
    this._add(this.body, new THREE.SphereGeometry(0.13, 8, 6), plate, 0.34, 1.56, 0);
    this._add(this.body, new THREE.SphereGeometry(0.13, 8, 6), plate, -0.34, 1.56, 0);

    // Long head with two glowing eyes
    const head = this._add(this.body, new THREE.SphereGeometry(0.2, 10, 8), skin, 0, 1.86, -0.02);
    head.scale.set(0.9, 1.2, 1.05);
    this._add(this.body, new THREE.BoxGeometry(0.08, 0.035, 0.04), glow, 0.08, 1.9, -0.2);
    this._add(this.body, new THREE.BoxGeometry(0.08, 0.035, 0.04), glow, -0.08, 1.9, -0.2);

    // Legs swing from the hips
    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.15, 0.95, 0);
      this.body.add(hip);
      this._add(hip, new THREE.CapsuleGeometry(0.1, 0.62, 2, 6), armor, 0, -0.45, 0);
      this._add(hip, new THREE.BoxGeometry(0.14, 0.08, 0.26), plate, 0, -0.9, -0.05);
      return hip;
    });

    // Arms swing from the shoulders; the right one carries the rifle
    this.arms = [-1, 1].map((side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.36, 1.5, 0);
      this.body.add(shoulder);
      this._add(shoulder, new THREE.CapsuleGeometry(0.075, 0.45, 2, 6), skin, 0, -0.3, -0.05);
      return shoulder;
    });

    // Plasma rifle at the right hip, glowing tip
    this.gun = new THREE.Group();
    this.gun.position.set(0.3, 1.2, -0.25);
    this.body.add(this.gun);
    this._add(this.gun, new THREE.BoxGeometry(0.09, 0.11, 0.62), gun, 0, 0, -0.1);
    this._add(this.gun, new THREE.CylinderGeometry(0.035, 0.035, 0.08, 8), glow, 0, 0, -0.43).rotation.x = Math.PI / 2;
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0, -0.48);
    this.gun.add(this.muzzle);

    // Power pack on the back, with glowing cells: shots there do extra damage
    if (backpack) {
      this._add(this.body, new THREE.BoxGeometry(0.46, 0.5, 0.26), gun, 0, 1.42, 0.3);
      this._add(this.body, new THREE.CylinderGeometry(0.06, 0.06, 0.38, 8), this.materials.core, 0.12, 1.42, 0.45);
      this._add(this.body, new THREE.CylinderGeometry(0.06, 0.06, 0.38, 8), this.materials.core, -0.12, 1.42, 0.45);
    }

    if (crest) {
      for (const [x, tilt] of [[0, 0], [0.09, -0.4], [-0.09, 0.4]]) {
        this._add(this.body, new THREE.ConeGeometry(0.035, 0.24, 5), glow, x, 2.12, 0.02).rotation.z = tilt;
      }
      for (const side of [-1, 1]) {
        this._add(this.body, new THREE.ConeGeometry(0.05, 0.28, 5), glow, side * 0.4, 1.72, 0).rotation.z = -side * 0.5;
      }
    }

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
    const partMaterials = this.materials;
    this.materials = {
      solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.4, flatShading: true }),
      light: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
    };
    for (const group of [this.body, ...this.legs, ...this.arms, this.gun]) {
      consolidateMeshes(group, this.materials.solid, this.materials.light);
    }
    for (const material of Object.values(partMaterials)) material.dispose();
  }

  /**
   * Walk cycle and aiming pose.
   * @param {number} delta
   * @param {number} speed - Horizontal speed in m/s
   * @param {boolean} aiming - Raise the rifle
   * @param {number} [raise=0] - 0..1 both arms raised overhead (melee wind-up)
   */
  animate(delta, speed, aiming, raise = 0) {
    this._walkPhase += delta * speed * 2.2;
    const swing = Math.min(1, speed / 4) * 0.6;
    const s = Math.sin(this._walkPhase) * swing;
    this.legs[0].rotation.x = s;
    this.legs[1].rotation.x = -s;
    this.arms[0].rotation.x = -s * 0.7;
    this.arms[1].rotation.x = aiming ? -1.2 : s * 0.7;
    if (raise > 0) {
      this.arms[0].rotation.x = -2.6 * raise;
      this.arms[1].rotation.x = -2.6 * raise;
    }
    this.gun.rotation.x = aiming ? 0 : 0.35;
  }

  /**
   * Topple backwards over `progress` 0..1 (death).
   */
  setFallen(progress) {
    this.body.rotation.x = progress * (Math.PI / 2) * 0.95;
    this.body.position.y = -progress * 0.1;
  }

  /**
   * Brief red flash when hit (0..1).
   */
  setHitFlash(amount) {
    this.materials.solid.emissive.setRGB(amount * 0.7, 0, 0);
  }

  dispose() {
    this.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
    });
    for (const material of Object.values(this.materials)) material.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}
