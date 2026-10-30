import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { valueNoise2D } from './Noise.js';
import { createStoneSurfaceMaps } from './SurfaceMaps.js';

// Palm trunk shape: height and how far the top leans over (x = PALM_BEND * y²)
const PALM_HEIGHT = 9;
const PALM_BEND = 0.012;
const PALM_TRUNK_RADIUS = 0.32;
const TREE_TRUNK_HEIGHT = 10.5;
const TREE_TRUNK_RADIUS = 0.23;
const LOD_HYSTERESIS = 0.1;      // Fraction of a switch distance to wait before switching back (no flicker)
let pineAssetPromise = null;

/** Load the bundled CC0 pine once; geometry/materials are cloned by each vegetation batch. */
export function loadPineTreeAsset() {
  if (!pineAssetPromise) {
    pineAssetPromise = new GLTFLoader().loadAsync('/assets/forest/coastal-pine.glb').then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const parts = [];
      gltf.scene.traverse((node) => {
        if (!node.isMesh) return;
        const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        const height = Math.max(0.001, bounds.max.y - bounds.min.y);
        const normalize = new THREE.Matrix4().makeScale(10.5 / height, 10.5 / height, 10.5 / height)
          .multiply(new THREE.Matrix4().makeTranslation(
            -(bounds.min.x + bounds.max.x) * 0.5,
            -bounds.min.y,
            -(bounds.min.z + bounds.max.z) * 0.5
          ));
        geometry.applyMatrix4(normalize);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
          if (material.map && typeof document !== 'undefined') gradePineMaterial(material);
          material.roughness = Math.max(material.roughness || 0, 0.88);
          material.metalness = 0;
          if (material.normalScale) material.normalScale.setScalar(0.75);
          material.side = THREE.DoubleSide;
          material.needsUpdate = true;
        }
        parts.push({ geometry, material: Array.isArray(node.material) ? node.material.map((m) => m.clone()) : node.material.clone() });
      });
      return parts;
    }).catch((error) => {
      pineAssetPromise = null;
      throw error;
    });
  }
  return pineAssetPromise;
}

/** Deepen the pine greens and make small alpha-cutout gaps through the needle canopy. */
function gradePineMaterial(material) {
  if (!material.map?.image || material.alphaMap) return;
  const sourceMap = material.map;
  const source = sourceMap.image;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const alphaPixels = context.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const r = pixels.data[i];
      const g = pixels.data[i + 1];
      const b = pixels.data[i + 2];
      const greenFoliage = g > r * 1.08 && g > b * 1.04;
      const hash = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      const needleGap = greenFoliage && (hash - Math.floor(hash)) < 0.17;
      const alpha = needleGap ? 0 : 255;
      alphaPixels.data[i] = alpha;
      alphaPixels.data[i + 1] = alpha;
      alphaPixels.data[i + 2] = alpha;
      alphaPixels.data[i + 3] = 255;
      if (greenFoliage) {
        pixels.data[i] = Math.round(r * 0.66);
        pixels.data[i + 1] = Math.round(g * 0.82);
        pixels.data[i + 2] = Math.round(b * 0.58);
      }
    }
  }
  context.putImageData(pixels, 0, 0);
  const colorMap = new THREE.CanvasTexture(canvas);
  colorMap.colorSpace = sourceMap.colorSpace;
  colorMap.flipY = sourceMap.flipY;
  colorMap.wrapS = sourceMap.wrapS;
  colorMap.wrapT = sourceMap.wrapT;
  colorMap.repeat.copy(sourceMap.repeat);
  colorMap.offset.copy(sourceMap.offset);
  material.map = colorMap;

  const alphaCanvas = document.createElement('canvas');
  alphaCanvas.width = source.width;
  alphaCanvas.height = source.height;
  alphaCanvas.getContext('2d').putImageData(alphaPixels, 0, 0);
  const alphaMap = new THREE.CanvasTexture(alphaCanvas);
  alphaMap.colorSpace = THREE.NoColorSpace;
  alphaMap.flipY = sourceMap.flipY;
  alphaMap.wrapS = sourceMap.wrapS;
  alphaMap.wrapT = sourceMap.wrapT;
  alphaMap.repeat.copy(sourceMap.repeat);
  alphaMap.offset.copy(sourceMap.offset);
  alphaMap.needsUpdate = true;
  material.alphaMap = alphaMap;
  material.alphaTest = 0.35;
  material.transparent = true;
  material.depthWrite = true;
}

/**
 * Vegetation
 * Procedural palms, rocks and bushes plus a textured, instanced GLTF pine forest, so each
 * tiled kind costs one or two draw calls however many there are. Optional static colliders:
 * trunks as cylinders, rocks as convex hulls of their exact shape, bushes left passable.
 *
 * With `tileSize`, each kind is split into square tiles of the map, each its own THREE.LOD:
 * tiles off screen are culled (one instanced mesh for a whole island never is), tiles past
 * `lodDistance` swap to a low-detail version, and tiles past `cullDistance` (lost in the fog)
 * are not drawn at all.
 *
 * Each placement is { x, y, z, rotation, scale } where y is the ground height at the base,
 * rotation is about Y in radians, and scale is a number (or { x, y, z } for rocks).
 *
 * Placements stay addressable after the build, so gameplay can take props away again:
 * `setPlacementScale` / `hidePlacement` (a destroyed prop shrinks to nothing, without a
 * separate mesh) and `removePlacementCollider` (its collider goes with it).
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
   * @param {number} [options.tileSize=0] - Split into map tiles of this size (meters); 0 = one mesh per kind
   * @param {number} [options.lodDistance=Infinity] - Tiles further than this from the camera use low detail
   * @param {number} [options.cullDistance=Infinity] - Tiles further than this are not drawn
   */
  constructor({ palms = [], trees = [], rocks = [], bushes = [], grass = [] } = {}, { castShadows = true, tileSize = 0, lodDistance = Infinity, cullDistance = Infinity } = {}, treeAsset = []) {
    this.placements = { palms, trees, rocks, bushes, grass };
    this.castShadows = castShadows;
    this.tileSize = tileSize;
    this.lodDistance = lodDistance;
    this.cullDistance = cullDistance;

    this.mesh = new THREE.Group();
    this.mesh.name = 'Vegetation';
    this.mesh.frustumCulled = true;

    const stoneMaps = createStoneSurfaceMaps();
    this.surfaceMaps = stoneMaps;
    this.materials = {
      palmTrunk: new THREE.MeshStandardMaterial({ color: 0x756044, roughness: 0.94, flatShading: true }),
      palmFronds: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, flatShading: true, side: THREE.DoubleSide }),
      rock: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: stoneMaps.color,
        normalMap: stoneMaps.normal,
        normalScale: new THREE.Vector2(0.42, 0.42),
        roughnessMap: stoneMaps.roughness,
        roughness: 0.86,
        metalness: 0,
        vertexColors: true
      }),
      bush: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, flatShading: true }),
      grass: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, flatShading: true, side: THREE.DoubleSide })
    };

    this.forestSway = new Map();
    for (const [kind, strength, height] of [['palmFronds', 0.25, 9], ['bush', 0.12, 1.6]]) {
      this.forestSway.set(kind, addForestMotion(this.materials[kind], strength, height));
    }
    this.grassMotion = addGrassWind(this.materials.grass, 0.75);

    this.geometries = {
      palmTrunk: createPalmTrunkGeometry(),
      palmFronds: createPalmFrondsGeometry(),
      rock: createRockGeometry(),
      bush: createBushGeometry(),
      grass: createGrassGeometry()
    };
    // Low-detail stand-ins for distant tiles
    this.lowGeometries = Number.isFinite(lodDistance) && tileSize > 0 ? {
      palmTrunk: createPalmTrunkGeometry({ segments: 3, radial: 5, coconuts: false }),
      palmFronds: createPalmFrondsGeometry({ fronds: 5, steps: 3 }),
      rock: createRockGeometry({ detail: 1 }),
      bush: createBushGeometry({ fronds: 5, leafPairs: 2 }),
      grass: createGrassGeometry(4)
    } : null;

    // Placement object -> { meshes: InstancedMesh[], index, origin } so instances can be
    // addressed again (hidden, scaled) after the build
    this._instances = new Map();

    for (const [kind, list, tint] of [['palmTrunk', palms, 0.12], ['palmFronds', palms, 0.15],
      ['rock', rocks, 0.15], ['bush', bushes, 0.2], ['grass', grass, 0.3]]) {
      if (tileSize > 0) this._addTiles(kind, list, tint);
      else this.mesh.add(this._createInstances(this.geometries[kind], this.materials[kind], list, tint));
    }
    this.treeAsset = treeAsset.map(({ geometry, material }) => {
      const instanceMaterial = material.clone();
      if (material.alphaMap) instanceMaterial.alphaMap = material.alphaMap.clone();
      return { geometry: geometry.clone(), material: instanceMaterial };
    });
    this.treeAsset.forEach(({ material }, index) => {
      this.forestSway.set(`pine-${index}`, addForestMotion(material, 0.08, TREE_TRUNK_HEIGHT));
    });
    if (trees.length) {
      if (tileSize > 0) this._addTreeTiles(trees);
      else for (const part of this.treeAsset) this.mesh.add(this._createInstances(part.geometry, part.material, trees, 0.1));
    }

    this.colliders = [];
    this.physicsWorld = null;
  }

  /** Animate foliage and let nearby walking actors press it aside. */
  update(time, walker, moving = false) {
    const p = walker || _zero;
    for (const state of this.forestSway.values()) {
      state.time.value = time;
      state.walker.value.copy(p);
      state.strength.value = moving ? 1 : 0;
      const delta = state.lastTime === null ? 0 : Math.min(0.1, Math.max(0, time - state.lastTime));
      state.lastTime = time;
      state.markTimer -= delta;
      for (const mark of state.marks) mark.w += delta;
      if (moving && state.markTimer <= 0) {
        state.marks[state.nextMark].set(p.x, p.z, 0, 0);
        state.nextMark = (state.nextMark + 1) % state.marks.length;
        state.markTimer = 0.19;
      }
    }
    this.grassMotion.time.value = time;
  }

  /**
   * One instanced mesh for a geometry, with a small per-instance brightness variation.
   * @param {THREE.Vector3} [origin] - Placements are stored relative to this point (a tile's centre)
   * @returns {THREE.InstancedMesh|null}
   */
  _createInstances(geometry, material, placements, tintVariation, origin = null) {
    if (placements.length === 0) return null;

    const instanced = new THREE.InstancedMesh(geometry, material, placements.length);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    placements.forEach((placement, i) => {
      composePlacement(placement, matrix);
      if (origin) {
        matrix.elements[12] -= origin.x;
        matrix.elements[13] -= origin.y;
        matrix.elements[14] -= origin.z;
      }
      instanced.setMatrixAt(i, matrix);
      const foliageHue = foliageHueFor(material, this.materials);
      const variation = valueNoise2D(placement.x * 0.7 + (foliageHue ?? 0) * 10, placement.z * 0.7, 11);
      if (foliageHue !== null) {
        // Per-instance hue and brightness variation makes individual leaves and grass clumps read as living greens.
        color.setHSL(foliageHue + (variation - 0.5) * 0.055, 0.58 + variation * 0.2,
          0.23 + variation * 0.18);
      } else {
        const shade = 1 + (variation - 0.5) * 2 * tintVariation;
        color.setScalar(shade);
      }
      instanced.setColorAt(i, color);

      // The same placement appears in the full-detail and low-detail levels: collect them both
      let record = this._instances.get(placement);
      if (!record) {
        record = { meshes: [], index: i, origin };
        this._instances.set(placement, record);
      }
      record.meshes.push(instanced);
    });
    instanced.instanceMatrix.needsUpdate = true;
    instanced.instanceColor.needsUpdate = true;
    instanced.computeBoundingSphere();
    instanced.frustumCulled = true;
    instanced.castShadow = this.castShadows && material !== this.materials.grass;
    instanced.receiveShadow = true;
    return instanced;
  }

  /**
   * Splits one kind into map tiles, each a THREE.LOD: full detail near the camera, low detail
   * past lodDistance, nothing past cullDistance. The renderer picks the level each frame.
   */
  _addTiles(kind, placements, tintVariation) {
    const tiles = new Map();
    for (const placement of placements) {
      const key = `${Math.floor(placement.x / this.tileSize)},${Math.floor(placement.z / this.tileSize)}`;
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push(placement);
    }

    for (const [key, list] of tiles) {
      const [tx, tz] = key.split(',').map(Number);
      const centre = new THREE.Vector3((tx + 0.5) * this.tileSize, 0, (tz + 0.5) * this.tileSize);
      const lod = new THREE.LOD();
      lod.name = `Vegetation_${kind}_${key}`;
      lod.frustumCulled = true;
      lod.position.copy(centre);
      lod.addLevel(this._createInstances(this.geometries[kind], this.materials[kind], list, tintVariation, centre), 0, LOD_HYSTERESIS);
      if (this.lowGeometries) {
        lod.addLevel(this._createInstances(this.lowGeometries[kind], this.materials[kind], list, tintVariation, centre), this.lodDistance, LOD_HYSTERESIS);
      }
      if (Number.isFinite(this.cullDistance)) lod.addLevel(new THREE.Object3D(), this.cullDistance, LOD_HYSTERESIS);
      this.mesh.add(lod);
    }
  }

  /** Group complete GLTF pine meshes into the same spatial tiles used by other forest props. */
  _addTreeTiles(placements) {
    const tiles = new Map();
    for (const placement of placements) {
      const key = `${Math.floor(placement.x / this.tileSize)},${Math.floor(placement.z / this.tileSize)}`;
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push(placement);
    }
    for (const [key, list] of tiles) {
      const [tx, tz] = key.split(',').map(Number);
      const centre = new THREE.Vector3((tx + 0.5) * this.tileSize, 0, (tz + 0.5) * this.tileSize);
      const lod = new THREE.LOD();
      lod.name = `Vegetation_pine_${key}`;
      lod.frustumCulled = true;
      lod.position.copy(centre);
      const detailedTrees = new THREE.Group();
      for (const part of this.treeAsset) {
        detailedTrees.add(this._createInstances(part.geometry, part.material, list, 0.1, centre));
      }
      lod.addLevel(detailedTrees, 0, LOD_HYSTERESIS);
      if (Number.isFinite(this.cullDistance)) lod.addLevel(new THREE.Object3D(), this.cullDistance, LOD_HYSTERESIS);
      this.mesh.add(lod);
    }
  }

  /**
   * Every instanced mesh, at every detail level.
   * @returns {THREE.InstancedMesh[]}
   */
  get instancedMeshes() {
    const meshes = [];
    this.mesh.traverse((child) => { if (child.isInstancedMesh) meshes.push(child); });
    return meshes;
  }

  /**
   * Static colliders: palm and tree trunks as upright cylinders, rocks as convex hulls.
   * Each collider is remembered on its placement (`placement.collider`), so gameplay can
   * pair a collider back to the prop that owns it, and take it away again later.
   * @param {PhysicsWorld} physicsWorld
   */
  createColliders(physicsWorld) {
    if (this.physicsWorld || !physicsWorld) return;
    this.physicsWorld = physicsWorld;

    const position = new THREE.Vector3();
    const offset = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const add = (collider, placement) => {
      if (!collider) return;
      placement.collider = collider;
      this.colliders.push(collider);
    };

    // Palm trunks: a cylinder centred halfway up the leaning trunk
    for (const p of this.placements.palms) {
      const s = uniformScale(p.scale);
      offset.set(PALM_BEND * (PALM_HEIGHT * 0.5) ** 2 * s, PALM_HEIGHT * 0.5 * s, 0).applyAxisAngle(up, p.rotation);
      position.set(p.x, p.y, p.z).add(offset);
      add(physicsWorld.createStaticCylinder(PALM_HEIGHT * 0.5 * s, PALM_TRUNK_RADIUS * s, position), p);
    }

    for (const t of this.placements.trees) {
      const s = uniformScale(t.scale);
      position.set(t.x, t.y + TREE_TRUNK_HEIGHT * 0.5 * s, t.z);
      add(physicsWorld.createStaticCylinder(TREE_TRUNK_HEIGHT * 0.5 * s, TREE_TRUNK_RADIUS * s, position), t);
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
      add(physicsWorld.createStaticConvexHull(points, position.set(r.x, r.y, r.z), rotation), r);
    }
  }

  /**
   * Rescales one placement's instance (both detail levels) away from its built scale.
   * A multiplier of 0 (see `hidePlacement`) collapses it to nothing.
   * @returns {boolean} Whether the placement was found
   */
  setPlacementScale(placement, multiplier) {
    const record = this._instances.get(placement);
    if (!record) return false;
    composePlacement(placement, _matrix, multiplier);
    if (record.origin) {
      _matrix.elements[12] -= record.origin.x;
      _matrix.elements[13] -= record.origin.y;
      _matrix.elements[14] -= record.origin.z;
    }
    for (const mesh of record.meshes) {
      mesh.setMatrixAt(record.index, _matrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
    return true;
  }

  /** Takes one placement's instance out of the draw completely (a destroyed prop). */
  hidePlacement(placement) {
    return this.setPlacementScale(placement, 0);
  }

  /**
   * Removes the collider of one placement (its prop was destroyed: the space is open now).
   * @returns {boolean} Whether a collider was removed
   */
  removePlacementCollider(placement) {
    const collider = placement.collider;
    if (!collider) return false;
    placement.collider = null;
    const index = this.colliders.indexOf(collider);
    if (index >= 0) this.colliders.splice(index, 1);
    if (this.physicsWorld) this.physicsWorld.removeRigidBody(collider.rigidBody);
    return true;
  }

  dispose() {
    if (this.physicsWorld) {
      for (const collider of this.colliders) {
        this.physicsWorld.removeRigidBody(collider.rigidBody);
      }
    }
    this.colliders = [];
    this.physicsWorld = null;
    this._instances.clear();

    for (const instanced of this.instancedMeshes) instanced.dispose();
    for (const geometry of Object.values(this.geometries)) geometry.dispose();
    if (this.lowGeometries) for (const geometry of Object.values(this.lowGeometries)) geometry.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
    for (const texture of Object.values(this.surfaceMaps)) texture.dispose();
    for (const { geometry, material } of this.treeAsset) {
      geometry.dispose();
      material.dispose();
      material.alphaMap?.dispose();
    }
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
const _matrix = new THREE.Matrix4();

function uniformScale(scale) {
  return typeof scale === 'number' ? scale : 1;
}

function vectorScale(scale) {
  if (typeof scale === 'number') return _scale.setScalar(scale);
  return _scale.set(scale.x, scale.y, scale.z);
}

function composePlacement(placement, out, scaleMultiplier = 1) {
  _position.set(placement.x, placement.y, placement.z);
  _quaternion.setFromAxisAngle(_up, placement.rotation || 0);
  return out.compose(_position, _quaternion, vectorScale(placement.scale ?? 1).multiplyScalar(scaleMultiplier));
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

function createPalmTrunkGeometry({ segments = 6, radial = 7, coconuts = true } = {}) {
  const parts = [];
  const segmentHeight = PALM_HEIGHT / segments;

  // Stacked tapered segments following the lean, so the rings read as palm bark
  for (let i = 0; i < segments; i++) {
    const y0 = i * segmentHeight;
    const yMid = y0 + segmentHeight / 2;
    const radiusBottom = PALM_TRUNK_RADIUS * (1 - (i / segments) * 0.35);
    const radiusTop = PALM_TRUNK_RADIUS * (1 - ((i + 1) / segments) * 0.35);
    const segment = new THREE.CylinderGeometry(radiusTop, radiusBottom * 1.08, segmentHeight, radial, 1);
    segment.rotateZ(-Math.atan(2 * PALM_BEND * yMid));
    segment.translate(PALM_BEND * yMid * yMid, yMid, 0);
    parts.push(segment);
  }

  // Coconuts under the crown
  const crownX = PALM_BEND * PALM_HEIGHT * PALM_HEIGHT;
  for (let i = 0; coconuts && i < 3; i++) {
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

function createPalmFrondsGeometry({ fronds = 8, steps = 8 } = {}) {
  const parts = [];
  const crownX = PALM_BEND * PALM_HEIGHT * PALM_HEIGHT;
  for (let i = 0; i < fronds; i++) {
    const frond = createFrondGeometry(4.2 + (i % 3) * 0.4, fronds < 8 ? 1.3 : 1.0, steps);
    frond.rotateZ(((i % 2) - 0.5) * 0.25);
    frond.rotateY((i / fronds) * Math.PI * 2 + (i % 3) * 0.15);
    frond.translate(crownX, PALM_HEIGHT - 0.1, 0);
    parts.push(frond);
  }
  const geometry = mergeNonIndexed(parts);
  geometry.computeVertexNormals();
  return geometry;
}

function createRockGeometry({ detail = 1 } = {}) {
  const rock = new THREE.IcosahedronGeometry(1, detail);
  const positions = rock.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();
  const p = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(positions, i);
    const direction = p.clone().normalize();
    const broad = valueNoise2D(direction.x * 3.8 + direction.y * 1.9, direction.z * 3.8 - direction.y, 21);
    const fine = valueNoise2D(direction.x * 11 + direction.z * 5, direction.y * 12 - direction.z * 4, 37);
    const radial = 1 + (broad - 0.5) * 0.3 + (fine - 0.5) * 0.11;
    p.multiplyScalar(radial);
    p.y *= 0.78 + broad * 0.12;
    positions.setXYZ(i, p.x, p.y, p.z);

    // Desaturated charcoal stone with a restrained moss/dirt stain around buried bases.
    const base = THREE.MathUtils.smoothstep(direction.y, -0.72, -0.18);
    const variation = (fine - 0.5) * 0.13;
    const stone = new THREE.Color(0.61 + variation, 0.64 + variation, 0.66 + variation);
    const foot = new THREE.Color(0.31 + variation, 0.34 + variation, 0.27 + variation);
    color.copy(foot).lerp(stone, base);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  rock.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  positions.needsUpdate = true;
  rock.computeVertexNormals();
  rock.computeBoundingSphere();
  return rock;
}

function createBushGeometry({ fronds = 11, leafPairs = 5 } = {}) {
  const positions = [];
  const indices = [];
  const addLeaf = (base, tangent, length, width, direction) => {
    const axis = direction.clone().multiplyScalar(length);
    const tip = base.clone().add(axis);
    const shoulder = base.clone().addScaledVector(axis, 0.58);
    const halfWidth = tangent.clone().multiplyScalar(width);
    const left = shoulder.clone().add(halfWidth);
    const right = shoulder.clone().sub(halfWidth);
    const start = positions.length / 3;
    positions.push(...base.toArray(), ...left.toArray(), ...tip.toArray(), ...right.toArray());
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };

  // Pinnate fern leaves radiate from a low centre; tapered leaflets make a jagged, natural edge.
  for (let f = 0; f < fronds; f++) {
    const angle = (f / fronds) * Math.PI * 2 + (f % 3) * 0.13;
    const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const tangent = new THREE.Vector3(-radial.z, 0, radial.x);
    const length = 0.7 + (f % 4) * 0.11;
    const rise = 0.55 + (f % 3) * 0.1;
    const tip = new THREE.Vector3(radial.x * length * 0.76, rise, radial.z * length * 0.76);
    const rachisStart = positions.length / 3;
    positions.push(0, 0.12, 0, tip.x, tip.y, tip.z, 0.025 * tangent.x, 0.13, 0.025 * tangent.z);
    indices.push(rachisStart, rachisStart + 1, rachisStart + 2);

    for (let pair = 0; pair < leafPairs; pair++) {
      const t = 0.18 + (pair / leafPairs) * 0.67;
      const base = new THREE.Vector3(
        tip.x * t,
        0.12 + (tip.y - 0.12) * t,
        tip.z * t
      );
      const taper = 1 - t * 0.73;
      const leafletLength = length * (0.3 * taper + 0.045);
      const leafletWidth = 0.13 * taper + 0.018;
      const upSweep = new THREE.Vector3(0, 0.26 + t * 0.12, 0);
      const side = tangent.clone().multiplyScalar(0.68).add(upSweep).normalize();
      addLeaf(base, tangent, leafletLength, leafletWidth, side);
      addLeaf(base, tangent, leafletLength, leafletWidth, side.clone().negate().add(upSweep).normalize());
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createGrassGeometry(blades = 8) {
  const positions = [];
  const indices = [];
  for (let i = 0; i < blades; i++) {
    const angle = i * Math.PI * 2 / blades;
    const radius = 0.045 + (i % 4) * 0.055;
    // Compact, layered blades stay below the player while creating a fuller meadow silhouette.
    const height = 0.5 + (i % 4) * 0.075;
    const lean = 0.12 + (i % 3) * 0.07;
    const width = 0.06 + (i % 2) * 0.022;
    const sideX = -Math.sin(angle), sideZ = Math.cos(angle);
    const baseX = Math.cos(angle) * radius, baseZ = Math.sin(angle) * radius;
    const start = positions.length / 3;
    for (let row = 0; row <= 3; row++) {
      const t = row / 3;
      const taper = 1 - t * 0.94;
      const curve = Math.sin(t * 1.45) * lean;
      const cx = baseX + Math.cos(angle) * curve;
      const cz = baseZ + Math.sin(angle) * curve;
      positions.push(cx - sideX * width * taper, height * t, cz - sideZ * width * taper);
      positions.push(cx + sideX * width * taper, height * t, cz + sideZ * width * taper);
      if (row < 3) {
        const a = start + row * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const _zero = new THREE.Vector3();

/** Small wind-only shader for grass: no per-blade CPU updates or footprint loops. */
function addGrassWind(material, height) {
  const state = { time: { value: 0 } };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrassTime = state.time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      uniform float uGrassTime;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 grassWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
      #else
        vec3 grassWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      #endif
      float grassHeight = clamp(position.y / ${height.toFixed(2)}, 0.0, 1.0);
      float grassWind = sin(uGrassTime * 1.7 + grassWorld.x * 0.31 + grassWorld.z * 0.24);
      transformed.x += grassWind * grassHeight * 0.075;
      transformed.z += cos(uGrassTime * 1.25 + grassWorld.z * 0.28) * grassHeight * 0.045;`);
  };
  material.customProgramCacheKey = () => `instanced-grass-wind-${height}`;
  material.needsUpdate = true;
  return state;
}

function addForestMotion(material, windAmount, height) {
  const state = {
    time: { value: 0 }, walker: { value: new THREE.Vector3() }, strength: { value: 0 },
    marks: Array.from({ length: 8 }, () => new THREE.Vector4(0, -10000, 0, 100)),
    nextMark: 0, markTimer: 0, lastTime: null
  };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uForestTime = state.time;
    shader.uniforms.uForestWalker = state.walker;
    shader.uniforms.uForestWalk = state.strength;
    shader.uniforms.uForestMarks = { value: state.marks };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      uniform float uForestTime;
      uniform vec3 uForestWalker;
      uniform float uForestWalk;
      uniform vec4 uForestMarks[8];`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 forestWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
      #else
        vec3 forestWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      #endif
      float forestHeight = clamp(position.y / ${height.toFixed(2)}, 0.0, 1.0);
      float forestBreeze = sin(uForestTime * 1.15 + forestWorld.x * 0.08 + forestWorld.z * 0.11) * ${windAmount.toFixed(3)};
      vec2 forestAway = forestWorld.xz - uForestWalker.xz;
      float forestNear = (1.0 - smoothstep(0.35, 1.85, length(forestAway))) * uForestWalk;
      float forestTrail = 0.0;
      for (int markIndex = 0; markIndex < 8; markIndex++) {
        vec4 mark = uForestMarks[markIndex];
        float radius = 1.0 - smoothstep(0.34, 1.0, distance(forestWorld.xz, mark.xy));
        float recovery = 1.0 - smoothstep(1.0, 4.2, mark.w);
        forestTrail = max(forestTrail, radius * recovery);
      }
      forestNear = max(forestNear, forestTrail * 0.82);
      vec2 forestPress = normalize(forestAway + vec2(0.0001)) * forestNear;
      transformed.x += forestBreeze * forestHeight + forestPress.x * forestHeight * 0.78;
      transformed.z += cos(uForestTime * 0.83 + forestWorld.z * 0.07) * ${ (windAmount * 0.45).toFixed(3)} * forestHeight + forestPress.y * forestHeight * 0.78;
      transformed.y -= forestNear * forestHeight * 0.32;`);
    material.userData.forestSway = state;
  };
  material.customProgramCacheKey = () => `forest-motion-${windAmount}-${height}`;
  material.needsUpdate = true;
  return state;
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

function foliageHueFor(material, materials) {
  if (material === materials.palmFronds) return 0.29;
  if (material === materials.bush) return 0.25;
  if (material === materials.grass) return 0.24;
  return null;
}
