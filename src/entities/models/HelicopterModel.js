import * as THREE from 'three';

/**
 * HelicopterModel
 * Procedural low-poly utility helicopter: rounded fuselage, bubble canopy, tail boom,
 * 4-blade main rotor, 2-blade tail rotor and landing skids. Visual only, with no physics,
 * so a parked prop, a scripted landing and a flyable helicopter can all reuse it.
 * Origin sits between the skids at ground level; the nose points along -Z.
 */
export class HelicopterModel {
  /**
   * @param {Object} [options]
   * @param {number} [options.bodyColor] - Hull paint colour
   */
  constructor({ bodyColor = 0x4f5a45 } = {}) {
    this.mesh = new THREE.Group();
    this.mesh.name = 'Helicopter';

    // Rotor spin rate in radians per second (0 = parked)
    this.rotorSpeed = 0;

    this.materials = {
      body: new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.6, metalness: 0.3, flatShading: true }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.7, metalness: 0.4 }),
      glass: new THREE.MeshStandardMaterial({
        color: 0x1d2a33,
        roughness: 0.08,
        metalness: 0.9,
        transparent: true,
        opacity: 0.7
      })
    };

    this._buildFuselage();
    this._buildTail();
    this._buildSkids();
    this._buildMainRotor();
    this._buildTailRotor();

    this.mesh.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  _add(geometry, material, x, y, z, parent = this.mesh) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  _buildFuselage() {
    const { body, dark, glass } = this.materials;

    // Rounded cabin lying along Z
    const cabinGeo = new THREE.CapsuleGeometry(1.25, 4.0, 4, 10);
    cabinGeo.rotateX(Math.PI / 2);
    const cabin = this._add(cabinGeo, body, 0, 2.0, 0);
    cabin.scale.set(1.0, 1.05, 1.0);

    // Bubble canopy over the front half
    const canopyGeo = new THREE.SphereGeometry(1.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const canopy = this._add(canopyGeo, glass, 0, 2.45, -1.9);
    canopy.scale.set(0.95, 0.8, 1.3);

    // Engine housing and rotor mast
    this._add(new THREE.BoxGeometry(1.4, 0.7, 2.6), body, 0, 3.35, 0.4);
    this._add(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 8), dark, 0, 3.95, 0.2);

    // Open side doors (dark panels)
    this._add(new THREE.BoxGeometry(0.05, 1.2, 1.6), dark, 1.27, 1.9, 0.6);
    this._add(new THREE.BoxGeometry(0.05, 1.2, 1.6), dark, -1.27, 1.9, 0.6);
  }

  _buildTail() {
    const { body } = this.materials;

    // Tapered boom from the cabin back to the tail
    const boomGeo = new THREE.CylinderGeometry(0.25, 0.55, 6.5, 8);
    boomGeo.rotateX(Math.PI / 2);
    this._add(boomGeo, body, 0, 2.4, 6.05);

    const fin = this._add(new THREE.BoxGeometry(0.15, 2.0, 1.2), body, 0, 3.1, 9.0);
    fin.rotation.x = -0.3;

    this._add(new THREE.BoxGeometry(2.4, 0.08, 0.6), body, 0, 2.45, 8.2);
  }

  _buildSkids() {
    const { dark } = this.materials;

    for (const side of [-1, 1]) {
      const skidGeo = new THREE.CylinderGeometry(0.08, 0.08, 5.0, 6);
      skidGeo.rotateX(Math.PI / 2);
      this._add(skidGeo, dark, side * 1.1, 0.1, -0.2);

      for (const z of [-1.4, 1.2]) {
        const strut = this._add(new THREE.CylinderGeometry(0.06, 0.06, 0.95, 6), dark, side * 1.0, 0.55, z);
        strut.rotation.z = side * 0.25;
      }
    }
  }

  _buildMainRotor() {
    const { dark } = this.materials;

    this.mainRotor = new THREE.Group();
    this.mainRotor.position.set(0, 4.3, 0.2);
    this.mesh.add(this.mainRotor);

    this._add(new THREE.CylinderGeometry(0.3, 0.3, 0.25, 10), dark, 0, 0, 0, this.mainRotor);

    const bladeGeo = new THREE.BoxGeometry(0.45, 0.06, 7.0);
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (i * Math.PI) / 2;
      this.mainRotor.add(pivot);
      this._add(bladeGeo, dark, 0, 0, 3.6, pivot);
    }
  }

  _buildTailRotor() {
    const { dark } = this.materials;

    this.tailRotor = new THREE.Group();
    this.tailRotor.position.set(0.25, 3.3, 9.2);
    this.mesh.add(this.tailRotor);

    const bladeGeo = new THREE.BoxGeometry(0.06, 1.8, 0.22);
    this._add(bladeGeo, dark, 0, 0, 0, this.tailRotor);
    const second = this._add(bladeGeo, dark, 0, 0, 0, this.tailRotor);
    second.rotation.x = Math.PI / 2;
  }

  /**
   * Spins the rotors at the current rotorSpeed.
   * @param {number} delta - Frame delta time in seconds
   */
  update(delta) {
    if (this.rotorSpeed === 0) return;
    this.mainRotor.rotation.y += this.rotorSpeed * delta;
    this.tailRotor.rotation.x += this.rotorSpeed * 4.5 * delta;
  }

  dispose() {
    this.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
    });
    for (const material of Object.values(this.materials)) {
      material.dispose();
    }
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}
