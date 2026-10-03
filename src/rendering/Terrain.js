import * as THREE from 'three';

/**
 * Terrain
 * Heightmap terrain where one grid of height samples drives both the rendered mesh
 * and the Rapier heightfield collider, so what you see is exactly what you stand on.
 * The shape and colouring come from the caller (`heightAt`, `colorAt`), so any level can reuse it.
 */
export class Terrain {
  /**
   * @param {Object} options
   * @param {number} options.size - World width and depth in meters (square, centred on the origin)
   * @param {number} options.segments - Cells per side
   * @param {(x: number, z: number) => number} options.heightAt - Height in meters at world (x, z)
   * @param {(x: number, z: number, height: number, slope: number, out: THREE.Color) => THREE.Color} [options.colorAt]
   *   Vertex colour; slope is 0 on flat ground and 1 on a vertical wall
   */
  constructor({ size = 512, segments = 128, heightAt, colorAt = null } = {}) {
    this.size = size;
    this.segments = segments;
    this.half = size / 2;
    this.cellSize = size / segments;
    this.samplesPerSide = segments + 1;

    // Row-major samples: index = iz * samplesPerSide + ix
    const n = this.samplesPerSide;
    this.heights = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        this.heights[iz * n + ix] = heightAt(-this.half + ix * this.cellSize, -this.half + iz * this.cellSize);
      }
    }

    this.geometry = this._buildGeometry(colorAt);
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: colorAt !== null,
      roughness: 0.95,
      metalness: 0.0
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'Terrain';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;

    this.collider = null;
    this.physicsWorld = null;
  }

  /**
   * Builds an indexed grid whose triangle split matches Rapier's heightfield cells:
   * each cell is cut along the diagonal from (x + 1, z) to (x, z + 1).
   */
  _buildGeometry(colorAt) {
    const n = this.samplesPerSide;
    const positions = new Float32Array(n * n * 3);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        positions[i * 3] = -this.half + ix * this.cellSize;
        positions[i * 3 + 1] = this.heights[i];
        positions[i * 3 + 2] = -this.half + iz * this.cellSize;
      }
    }

    const indices = new Uint32Array(this.segments * this.segments * 6);
    let k = 0;
    for (let iz = 0; iz < this.segments; iz++) {
      for (let ix = 0; ix < this.segments; ix++) {
        const a = iz * n + ix; // (x,     z)
        const b = a + 1;       // (x + 1, z)
        const c = a + n;       // (x,     z + 1)
        const d = c + 1;       // (x + 1, z + 1)
        indices[k++] = a; indices[k++] = c; indices[k++] = b;
        indices[k++] = b; indices[k++] = c; indices[k++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();

    if (colorAt) {
      const normals = geometry.getAttribute('normal');
      const colors = new Float32Array(n * n * 3);
      const color = new THREE.Color();
      for (let i = 0; i < n * n; i++) {
        const slope = 1 - normals.getY(i);
        colorAt(positions[i * 3], positions[i * 3 + 2], positions[i * 3 + 1], slope, color);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    geometry.computeBoundingSphere();
    return geometry;
  }

  /**
   * Height of the terrain surface at world (x, z), interpolated on the same triangles
   * as the mesh and the collider. Outside the grid, the nearest edge sample is used.
   */
  getHeightAt(x, z) {
    const n = this.samplesPerSide;
    const gx = THREE.MathUtils.clamp((x + this.half) / this.cellSize, 0, this.segments - 1e-6);
    const gz = THREE.MathUtils.clamp((z + this.half) / this.cellSize, 0, this.segments - 1e-6);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;

    const ha = this.heights[iz * n + ix];
    const hb = this.heights[iz * n + ix + 1];
    const hc = this.heights[(iz + 1) * n + ix];
    const hd = this.heights[(iz + 1) * n + ix + 1];

    if (fx + fz <= 1) {
      return ha + (hb - ha) * fx + (hc - ha) * fz;
    }
    return hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz);
  }

  /**
   * Creates the matching static heightfield collider through PhysicsWorld.
   * @param {PhysicsWorld} physicsWorld
   */
  createCollider(physicsWorld) {
    if (this.collider || !physicsWorld) return this.collider;
    this.physicsWorld = physicsWorld;

    // Rapier wants column-major samples: index = iz + ix * samplesPerSide
    const n = this.samplesPerSide;
    const columnMajor = new Float32Array(n * n);
    for (let ix = 0; ix < n; ix++) {
      for (let iz = 0; iz < n; iz++) {
        columnMajor[iz + ix * n] = this.heights[iz * n + ix];
      }
    }

    this.collider = physicsWorld.createHeightfield(this.segments, columnMajor, this.size);
    if (this.collider) {
      this.collider.userData = { isTerrain: true };
    }
    return this.collider;
  }

  dispose() {
    if (this.collider && this.physicsWorld) {
      this.physicsWorld.removeRigidBody(this.collider.rigidBody);
    }
    this.collider = null;
    this.physicsWorld = null;

    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
