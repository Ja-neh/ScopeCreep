import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { valueNoise2D } from './Noise.js';

// Palm trunk shape: height and how far the top leans over (x = PALM_BEND * y²)
const PALM_HEIGHT = 9;
const PALM_BEND = 0.012;
const PALM_TRUNK_RADIUS = 0.32;
const TREE_TRUNK_HEIGHT = 5;
const TREE_TRUNK_RADIUS = 0.35;

/**
 * Vegetation
 * Procedural low-poly palms, jungle trees, rocks and bushes drawn as instanced meshes,
 * so each kind costs one or two draw calls however many there are. Optional static colliders:
 * trunks as cylinders, rocks as convex hulls of their exact shape, bushes left passable.
 *
 * Each placement is { x, y, z, rotation, scale } where y is the ground height at the base,
 * rotation is about Y in radians, and scale is a number (or { x, y, z } for rocks).
 */
export class Vegetation {
  /**
   * @param {Object} placements
   * @param {Array} [placements.palms]
   * @param {Array} [placements.trees]
   * @param {Array} [placements.rocks]
   * @param {Array} [placements.bushes]
   * @param {Object} [options]
   * @param {boolean} [options.castShadows=true] - Off for distant scenery outside the shadow map's area
   */
  constructor({ palms = [], trees = [], rocks = [], bushes = [] } = {}, { castShadows = true } = {}) {
    this.placements = { palms, trees, rocks, bushes };
    this.castShadows = castShadows;

    this.mesh = new THREE.Group();
    this.mesh.name = 'Vegetation';

    this.materials = {
      palmTrunk: new THREE.MeshStandardMaterial({ color: 0x8b6a45, roughness: 1.0, flatShading: true }),
      palmFronds: new THREE.MeshStandardMaterial({ color: 0x4f8a2e, roughness: 0.9, flatShading: true, side: THREE.DoubleSide }),
      treeTrunk: new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 1.0, flatShading: true }),
      treeCanopy: new THREE.MeshStandardMaterial({ color: 0x3f7a2c, roughness: 0.9, flatShading: true }),
      rock: new THREE.MeshStandardMaterial({ color: 0x8a8276, roughness: 0.95, flatShading: true }),
      bush: new THREE.MeshStandardMaterial({ color: 0x3d6b2a, roughness: 0.9, flatShading: true })
    };

    this.geometries = {
      palmTrunk: createPalmTrunkGeometry(),
      palmFronds: createPalmFrondsGeometry(),
      treeTrunk: createTreeTrunkGeometry(),
      treeCanopy: createTreeCanopyGeometry(),
      rock: createRockGeometry(),
      bush: createBushGeometry()
    };

    this._addInstances(this.geometries.palmTrunk, this.materials.palmTrunk, palms, 0.12);
    this._addInstances(this.geometries.palmFronds, this.materials.palmFronds, palms, 0.15);
    this._addInstances(this.geometries.treeTrunk, this.materials.treeTrunk, trees, 0.12);
    this._addInstances(this.geometries.treeCanopy, this.materials.treeCanopy, trees, 0.2);
    this._addInstances(this.geometries.rock, this.materials.rock, rocks, 0.15);
    this._addInstances(this.geometries.bush, this.materials.bush, bushes, 0.2);

    this.colliders = [];
    this.physicsWorld = null;
  }

  /**
   * One instanced mesh for a geometry, with a small per-instance brightness variation.
   */
  _addInstances(geometry, material, placements, tintVariation) {
    if (placements.length === 0) return;

    const instanced = new THREE.InstancedMesh(geometry, material, placements.length);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    placements.forEach((placement, i) => {
      instanced.setMatrixAt(i, composePlacement(placement, matrix));
      const shade = 1 + (valueNoise2D(placement.x * 0.7, placement.z * 0.7, 11) - 0.5) * 2 * tintVariation;
      instanced.setColorAt(i, color.setScalar(shade));
    });
    instanced.instanceMatrix.needsUpdate = true;
    instanced.instanceColor.needsUpdate = true;
    instanced.computeBoundingSphere();
    instanced.castShadow = this.castShadows;
    instanced.receiveShadow = true;
    this.mesh.add(instanced);
  }

  /**
   * Static colliders: palm and tree trunks as upright cylinders, rocks as convex hulls.
   * @param {PhysicsWorld} physicsWorld
   */
  createColliders(physicsWorld) {
    if (this.physicsWorld || !physicsWorld) return;
    this.physicsWorld = physicsWorld;

    const position = new THREE.Vector3();
    const offset = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const add = (collider) => { if (collider) this.colliders.push(collider); };

    // Palm trunks: a cylinder centred halfway up the leaning trunk
    for (const p of this.placements.palms) {
      const s = uniformScale(p.scale);
      offset.set(PALM_BEND * (PALM_HEIGHT * 0.5) ** 2 * s, PALM_HEIGHT * 0.5 * s, 0).applyAxisAngle(up, p.rotation);
      position.set(p.x, p.y, p.z).add(offset);
      add(physicsWorld.createStaticCylinder(PALM_HEIGHT * 0.5 * s, PALM_TRUNK_RADIUS * s, position));
    }

    for (const t of this.placements.trees) {
      const s = uniformScale(t.scale);
      position.set(t.x, t.y + TREE_TRUNK_HEIGHT * 0.5 * s, t.z);
      add(physicsWorld.createStaticCylinder(TREE_TRUNK_HEIGHT * 0.5 * s, TREE_TRUNK_RADIUS * s, position));
    }

    // Rocks: the hull of the rock's own (scaled) vertices, so shots and players hit what they see
    const basePoints = this.geometries.rock.getAttribute('position');
    for (const r of this.placements.rocks) {
      const scale = vectorScale(r.scale);
      const points = new Float32Array(basePoints.count * 3);
      for (let i = 0; i < basePoints.count; i++) {
        points[i * 3] = basePoints.getX(i) * scale.x;
        points[i * 3 + 1] = basePoints.getY(i) * scale.y;
        points[i * 3 + 2] = basePoints.getZ(i) * scale.z;
      }
      rotation.setFromAxisAngle(up, r.rotation);
      add(physicsWorld.createStaticConvexHull(points, position.set(r.x, r.y, r.z), rotation));
    }
  }

  dispose() {
    if (this.physicsWorld) {
      for (const collider of this.colliders) {
        this.physicsWorld.removeRigidBody(collider.rigidBody);
      }
    }
    this.colliders = [];
    this.physicsWorld = null;

    for (const child of this.mesh.children) {
      if (child.isInstancedMesh) child.dispose();
    }
    for (const geometry of Object.values(this.geometries)) geometry.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}

// ---------------------------------------------------------------------------
// Placement helpers
// ---------------------------------------------------------------------------

const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function uniformScale(scale) {
  return typeof scale === 'number' ? scale : 1;
}

function vectorScale(scale) {
  if (typeof scale === 'number') return _scale.setScalar(scale);
  return _scale.set(scale.x, scale.y, scale.z);
}

function composePlacement(placement, out) {
  _position.set(placement.x, placement.y, placement.z);
  _quaternion.setFromAxisAngle(_up, placement.rotation || 0);
  return out.compose(_position, _quaternion, vectorScale(placement.scale ?? 1));
}

/**
 * Pushes each vertex out or in along its direction from `centre` by smooth noise.
 * Noise is keyed on position, so the duplicated corners of non-indexed geometry move together.
 */
function lumpify(geometry, amount, seed, centre = new THREE.Vector3()) {
  const positions = geometry.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    v.fromBufferAttribute(positions, i).sub(centre);
    const n = valueNoise2D(v.x * 1.7 + v.y * 0.9 + seed, v.z * 1.7 - v.y * 1.1, seed);
    v.multiplyScalar(1 + (n - 0.5) * amount).add(centre);
    positions.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// Procedural geometry
// ---------------------------------------------------------------------------

function createPalmTrunkGeometry() {
  const parts = [];
  const segments = 6;
  const segmentHeight = PALM_HEIGHT / segments;

  // Stacked tapered segments following the lean, so the rings read as palm bark
  for (let i = 0; i < segments; i++) {
    const y0 = i * segmentHeight;
    const yMid = y0 + segmentHeight / 2;
    const radiusBottom = PALM_TRUNK_RADIUS * (1 - (i / segments) * 0.35);
    const radiusTop = PALM_TRUNK_RADIUS * (1 - ((i + 1) / segments) * 0.35);
    const segment = new THREE.CylinderGeometry(radiusTop, radiusBottom * 1.08, segmentHeight, 7, 1);
    segment.rotateZ(-Math.atan(2 * PALM_BEND * yMid));
    segment.translate(PALM_BEND * yMid * yMid, yMid, 0);
    parts.push(segment);
  }

  // Coconuts under the crown
  const crownX = PALM_BEND * PALM_HEIGHT * PALM_HEIGHT;
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.IcosahedronGeometry(0.22, 0);
    const angle = (i / 3) * Math.PI * 2;
    nut.translate(crownX + Math.cos(angle) * 0.3, PALM_HEIGHT - 0.35, Math.sin(angle) * 0.3);
    parts.push(nut);
  }

  return mergeNonIndexed(parts);
}

function createFrondGeometry(length, width, steps = 8) {
  // A folded leaf: a centre rib with edges hanging slightly lower, arcing up then drooping
  const positions = [];
  const indices = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const along = s * length;
    const y = 0.35 * along - 0.24 * along * along;
    const halfWidth = 0.5 * width * Math.sin(Math.PI * Math.min(1, s * 1.15)) * (1 - 0.3 * s);
    positions.push(along, y, 0);                              // centre rib
    positions.push(along, y - 0.15 * halfWidth, -halfWidth);  // left edge
    positions.push(along, y - 0.15 * halfWidth, halfWidth);   // right edge
  }
  for (let i = 0; i < steps; i++) {
    const c0 = i * 3, l0 = c0 + 1, r0 = c0 + 2;
    const c1 = c0 + 3, l1 = c0 + 4, r1 = c0 + 5;
    indices.push(c0, l0, c1, l0, l1, c1, c0, c1, r0, r0, c1, r1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry.toNonIndexed();
}

function createPalmFrondsGeometry() {
  const parts = [];
  const crownX = PALM_BEND * PALM_HEIGHT * PALM_HEIGHT;
  const fronds = 8;
  for (let i = 0; i < fronds; i++) {
    const frond = createFrondGeometry(4.2 + (i % 3) * 0.4, 1.0);
    frond.rotateZ(((i % 2) - 0.5) * 0.25);
    frond.rotateY((i / fronds) * Math.PI * 2 + (i % 3) * 0.15);
    frond.translate(crownX, PALM_HEIGHT - 0.1, 0);
    parts.push(frond);
  }
  const geometry = mergeNonIndexed(parts);
  geometry.computeVertexNormals();
  return geometry;
}

function createTreeTrunkGeometry() {
  const trunk = new THREE.CylinderGeometry(TREE_TRUNK_RADIUS * 0.7, TREE_TRUNK_RADIUS * 1.1, TREE_TRUNK_HEIGHT, 7, 1);
  trunk.translate(0, TREE_TRUNK_HEIGHT / 2, 0);
  return trunk.toNonIndexed();
}

function createTreeCanopyGeometry() {
  const lumps = [
    [0, 6.0, 0, 2.6],
    [1.3, 5.2, 0.6, 2.0],
    [-1.1, 5.4, -0.8, 2.1],
    [0.2, 7.3, -0.2, 1.7]
  ];
  // Only the main lump gets the finer subdivision; trees are numerous, so keep them cheap
  const parts = lumps.map(([x, y, z, radius], i) => {
    const lump = new THREE.IcosahedronGeometry(radius, i === 0 ? 1 : 0);
    lumpify(lump, 0.35, 3 + i);
    lump.translate(x, y, z);
    return lump;
  });
  return mergeNonIndexed(parts);
}

function createRockGeometry() {
  const rock = new THREE.IcosahedronGeometry(1, 1);
  return lumpify(rock, 0.55, 21);
}

function createBushGeometry() {
  const lumps = [
    [0, 0.7, 0, 1.0],
    [0.8, 0.55, 0.3, 0.75],
    [-0.7, 0.5, -0.4, 0.8],
    [0.1, 0.5, -0.85, 0.7],
    [-0.3, 0.45, 0.8, 0.7]
  ];
  // Only the central lump gets the finer subdivision; bushes are numerous, so keep them cheap
  const parts = lumps.map(([x, y, z, radius], i) => {
    const lump = new THREE.IcosahedronGeometry(radius, i === 0 ? 1 : 0);
    lumpify(lump, 0.4, 7 + i);
    lump.translate(x, y, z);
    return lump;
  });
  return mergeNonIndexed(parts);
}

function mergeNonIndexed(parts) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of flat) {
    // Keep only positions (normals are recomputed), so mixed sources merge cleanly
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position') g.deleteAttribute(name);
    }
  }
  const merged = mergeGeometries(flat, false);
  merged.computeVertexNormals();
  parts.forEach((g) => g.dispose());
  flat.forEach((g) => g.dispose());
  return merged;
}
