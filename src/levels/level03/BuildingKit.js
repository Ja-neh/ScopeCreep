import * as THREE from 'three';
import { consolidateMeshes } from '../../rendering/MeshMerge.js';

const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * BuildingKit
 * Builds static low-poly buildings out of boxes, gable roofs, pillars and lathe shapes, with matching static
 * colliders. Each building is laid out in its own frame (position + yaw); when everything is
 * placed, finish() merges all the parts into one solid and one glowing mesh (vertex colours),
 * so a whole village costs a couple of draw calls. A big place can be merged in square tiles
 * instead (two meshes per tile): tiles out of view are skipped, and near ones are drawn first,
 * hiding what is behind them.
 */
export class BuildingKit {
  /**
   * @param {PhysicsWorld} physicsWorld
   */
  constructor(physicsWorld) {
    this.physicsWorld = physicsWorld;
    this.parts = new THREE.Group();
    this.colliders = [];
    this._palette = new Map();
  }

  /**
   * A building's frame: its ground position and the way it faces (yaw, radians).
   * @returns {THREE.Matrix4}
   */
  frame(x, y, z, yaw = 0) {
    _quaternion.setFromAxisAngle(_up, yaw);
    return new THREE.Matrix4().compose(_position.set(x, y, z), _quaternion, _scale);
  }

  /**
   * A box of size (w, h, d) centred at (x, y, z) in `frame`.
   * @param {Object} [options]
   * @param {boolean} [options.glow] - Lit by itself (lamps, windows, alien tech)
   * @param {boolean} [options.solid] - Also a collider
   * @param {number} [options.yaw] - Extra turn inside the frame
   * @param {number} [options.pitch] - Tilt about the box's own x axis (leaning posts, ramps)
   * @param {number} [options.roll] - Tilt about the box's own z axis (crooked planks)
   * @returns {THREE.Mesh}
   */
  box(frame, w, h, d, x, y, z, color, { glow = false, solid = false, yaw = 0, pitch = 0, roll = 0 } = {}) {
    const mesh = this._place(new THREE.BoxGeometry(w, h, d), color, glow, frame, x, y, z, yaw, pitch, roll);
    if (solid) this.collider(mesh.position, mesh.quaternion, w / 2, h / 2, d / 2);
    return mesh;
  }

  /**
   * A gable roof: a triangular prism `w` wide and `d` long rising `rise` above (x, y, z).
   * `pitch` and `roll` tilt it (a sagging old roof).
   */
  roof(frame, w, rise, d, x, y, z, color, { pitch = 0, roll = 0 } = {}) {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(0, rise);
    shape.lineTo(-w / 2, 0);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    geometry.translate(0, 0, -d / 2);
    return this._place(geometry, color, false, frame, x, y, z, 0, pitch, roll);
  }

  /**
   * A shape turned around the vertical axis (saucer hulls, domes): `points` are [radius, height]
   * pairs from the bottom up, placed with their axis at (x, y, z).
   */
  lathe(frame, points, x, y, z, color, { glow = false, segments = 24 } = {}) {
    const profile = points.map(([r, h]) => new THREE.Vector2(r, h));
    return this._place(new THREE.LatheGeometry(profile, segments), color, glow, frame, x, y, z, 0);
  }

  /**
   * An upright cylinder (pillar, post) of radius `r` and height `h` standing on (x, y, z).
   */
  cylinder(frame, r, h, x, y, z, color, { glow = false, solid = false, segments = 8 } = {}) {
    const mesh = this._place(new THREE.CylinderGeometry(r, r, h, segments), color, glow, frame, x, y + h / 2, z, 0);
    if (solid) {
      const collider = this.physicsWorld.createStaticCylinder(h / 2, r, mesh.position);
      if (collider) this.colliders.push(collider);
    }
    return mesh;
  }

  /**
   * A crystal (octahedron) of radius `r`, glowing.
   */
  crystal(frame, r, x, y, z, color) {
    const geometry = new THREE.OctahedronGeometry(r, 0);
    geometry.scale(0.6, 1.6, 0.6);
    return this._place(geometry, color, true, frame, x, y, z, 0);
  }

  /**
   * A static box collider (half extents) at a world position and rotation.
   */
  collider(position, quaternion, hx, hy, hz) {
    const collider = this.physicsWorld.createStaticBox({ x: hx, y: hy, z: hz }, position, quaternion);
    if (collider) this.colliders.push(collider);
    return collider;
  }

  /**
   * Merges every part into the finished meshes (one solid, one glowing) and returns them in a group.
   * @param {string} name
   * @param {Object} [options]
   * @param {number} [options.tileSize=0] - Merge in square tiles this many meters across (0: all in one)
   * @returns {THREE.Group}
   */
  finish(name, { tileSize = 0 } = {}) {
    this.solidMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, flatShading: true });
    this.glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.parts.name = name;
    const groups = [this.parts];
    if (tileSize > 0) {
      // Sort the parts into tiles by where they stand, and merge each tile on its own
      const tiles = new Map();
      for (const part of [...this.parts.children]) {
        const key = `${Math.floor(part.position.x / tileSize)}_${Math.floor(part.position.z / tileSize)}`;
        if (!tiles.has(key)) {
          const tile = new THREE.Group();
          tile.name = `${name}_${key}`;
          tiles.set(key, tile);
        }
        tiles.get(key).add(part);
      }
      groups.length = 0;
      for (const tile of tiles.values()) {
        this.parts.add(tile);
        groups.push(tile);
      }
    }
    for (const group of groups) {
      for (const mesh of consolidateMeshes(group, this.solidMaterial, this.glowMaterial)) {
        mesh.castShadow = mesh.material === this.solidMaterial;
        mesh.receiveShadow = true;
      }
    }
    for (const material of this._palette.values()) material.dispose();
    this._palette.clear();
    return this.parts;
  }

  dispose() {
    for (const collider of this.colliders) this.physicsWorld.removeRigidBody(collider.rigidBody);
    this.colliders = [];
    this.parts.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
    });
    if (this.parts.parent) this.parts.parent.remove(this.parts);
    if (this.solidMaterial) this.solidMaterial.dispose();
    if (this.glowMaterial) this.glowMaterial.dispose();
    for (const material of this._palette.values()) material.dispose();
    this._palette.clear();
  }

  _place(geometry, color, glow, frame, x, y, z, yaw, pitch = 0, roll = 0) {
    const mesh = new THREE.Mesh(geometry, this._material(color, glow));
    mesh.position.set(x, y, z);
    mesh.quaternion.setFromEuler(_euler.set(pitch, yaw, roll));
    mesh.updateMatrix();
    mesh.applyMatrix4(frame);
    this.parts.add(mesh);
    return mesh;
  }

  _material(color, glow) {
    const key = `${color}:${glow}`;
    if (!this._palette.has(key)) {
      this._palette.set(key, glow
        ? new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1 })
        : new THREE.MeshStandardMaterial({ color }));
    }
    return this._palette.get(key);
  }
}
