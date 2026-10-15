import * as THREE from 'three';
import { BaseEntity } from '../entities/BaseEntity.js';

const CAPACITY = 96;
const SECONDS = 45;      // How long a decal stays before its fade-out
const FADE_SECONDS = 10; // How long the fade-out lasts
const SURFACE_OFFSET = 0.02;
const PLANE_NORMAL = new THREE.Vector3(0, 0, 1); // PlaneGeometry faces +Z

// Visual tuning lives here, like the other rendering modules: sizes are in meters.
const KINDS = {
  bullet: { size: 0.3, opacity: 0.9 },
  scorch: { size: 3.2, opacity: 0.85 }
};

/**
 * A small dark hole with a ragged edge, drawn once as raw pixels (a DataTexture, so the
 * Node test runner needs no canvas).
 */
function createBulletTexture() {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const angle = Math.atan2(dy, dx);
      const distance = Math.hypot(dx, dy);
      // Wobble the hole radius with a cheap angle hash so the rim looks chipped
      const radius = 0.62 + 0.09 * (Math.sin(angle * 5 + 1.7) + Math.sin(angle * 9 - 0.6));
      const alpha = 1 - THREE.MathUtils.smoothstep(distance, radius - 0.25, radius);
      const i = (y * size + x) * 4;
      data[i] = 26;
      data[i + 1] = 21;
      data[i + 2] = 18;
      data[i + 3] = Math.round(255 * alpha);
    }
  }
  return toTexture(data, size);
}

/**
 * A charcoal blot fading to soot at the rim, for artillery scorch marks.
 */
function createScorchTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const angle = Math.atan2(dy, dx);
      const distance = Math.hypot(dx, dy);
      const radius = 0.55 + 0.15 * (Math.sin(angle * 3 + 2.1) + Math.sin(angle * 7 - 1.3) + Math.sin(angle * 11 + 0.4)) / 3;
      const alpha = 1 - THREE.MathUtils.smoothstep(distance, radius - 0.35, radius);
      // Lighter soot towards the rim, near-black at the core
      const core = 1 - THREE.MathUtils.smoothstep(distance, 0.15, 0.7);
      const i = (y * size + x) * 4;
      data[i] = Math.round(52 - 34 * core);
      data[i + 1] = Math.round(44 - 29 * core);
      data[i + 2] = Math.round(38 - 25 * core);
      data[i + 3] = Math.round(255 * alpha * 0.8);
    }
  }
  return toTexture(data, size);
}

function toTexture(data, size) {
  const texture = new THREE.DataTexture(data, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Decals
 * The physics juice's marks on the world: bullet holes and artillery scorch marks. A fixed
 * pool of flat quads (one shared plane geometry) is laid over the surface they hit, each with
 * its own material so it can fade on its own schedule. Spawning recycles the oldest mark once
 * the pool is full, so a firefight never allocates.
 *
 * Registered as an entity by BaseLevel (gameWorld.addEntity) so its Phase 6 hook runs, and
 * disposed by GameWorld.clearEntities() with the rest of the level's entities.
 */
export class Decals extends BaseEntity {
  /**
   * @param {GameWorld} gameWorld
   */
  constructor(gameWorld) {
    super('Decals');
    this.gameWorld = gameWorld;

    this.group = new THREE.Group();
    this.group.name = 'Decals';
    this.mesh = this.group;

    this._geometry = new THREE.PlaneGeometry(1, 1);
    this._textures = {
      bullet: createBulletTexture(),
      scorch: createScorchTexture()
    };

    this.pool = [];
    for (let i = 0; i < CAPACITY; i++) {
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        toneMapped: false
      });
      const quad = new THREE.Mesh(this._geometry, material);
      quad.name = `Decal_${i}`;
      quad.visible = false;
      this.group.add(quad);
      this.pool.push({ mesh: quad, life: 0, active: false, baseOpacity: 1 });
    }
    this._next = 0;
    this.activeCount = 0;
  }

  /**
   * Sticks a mark onto a surface. Only call this for fixed geometry: decks and characters
   * move out from under a decal.
   * @param {THREE.Vector3} point - Impact point
   * @param {THREE.Vector3} normal - Surface normal the quad faces along
   * @param {string} [kind] - 'bullet' or 'scorch'
   * @param {number} [scale] - Size in meters (kind default when omitted)
   */
  spawn(point, normal, kind = 'bullet', scale = null) {
    if (!point || !normal) return;
    const def = KINDS[kind] || KINDS.bullet;

    const decal = this.pool[this._next];
    this._next = (this._next + 1) % CAPACITY;
    if (!decal.active) {
      decal.active = true;
      this.activeCount++;
    }

    const material = decal.mesh.material;
    const texture = this._textures[kind] || this._textures.bullet;
    if (material.map !== texture) {
      material.map = texture;
      material.needsUpdate = true; // Texture reference changed: recompile the material once
    }

    const size = scale !== null ? scale : def.size;
    decal.mesh.position.copy(point).addScaledVector(normal, SURFACE_OFFSET);
    decal.mesh.quaternion.setFromUnitVectors(PLANE_NORMAL, normal);
    decal.mesh.rotateZ(Math.random() * Math.PI * 2);
    decal.mesh.scale.set(size, size, 1);
    material.opacity = def.opacity;
    decal.baseOpacity = def.opacity;
    decal.mesh.visible = true;
    decal.life = SECONDS;
  }

  /**
   * Phase 6: ages the marks and fades the oldest ones out.
   */
  lateUpdate(delta) {
    if (this.activeCount === 0) return;
    for (const decal of this.pool) {
      if (!decal.active) continue;
      decal.life -= delta;
      if (decal.life <= 0) {
        decal.active = false;
        decal.mesh.visible = false;
        this.activeCount--;
        continue;
      }
      if (decal.life < FADE_SECONDS) {
        decal.mesh.material.opacity = decal.baseOpacity * (decal.life / FADE_SECONDS);
      }
    }
  }

  dispose() {
    for (const texture of Object.values(this._textures)) texture.dispose();
    this._textures = {};
    this.pool = [];
    this.activeCount = 0;
    super.dispose(); // Traverses the quads: shared geometry plus per-decal materials
  }
}
