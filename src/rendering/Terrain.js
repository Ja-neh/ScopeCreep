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
   * @param {number} options.width - World extent along X in meters
   * @param {number} options.depth - World extent along Z in meters
   * @param {number} [options.cellSize] - Grid spacing in meters (width and depth should be multiples of it)
   * @param {{x: number, z: number}} [options.center] - World position of the grid centre
   * @param {(x: number, z: number) => number} options.heightAt - Height in meters at world (x, z)
   * @param {(x: number, z: number, height: number, slope: number, out: THREE.Color) => THREE.Color} [options.colorAt]
   *   Vertex colour; slope is 0 on flat ground and 1 on a vertical wall
   */
  constructor({ width = 512, depth = 512, cellSize = 4, center = { x: 0, z: 0 }, heightAt, colorAt = null } = {}) {
    this.segmentsX = Math.round(width / cellSize);
    this.segmentsZ = Math.round(depth / cellSize);
    this.cellSize = cellSize;
    this.width = this.segmentsX * cellSize;
    this.depth = this.segmentsZ * cellSize;
    this.center = { x: center.x, z: center.z };
    this.minX = center.x - this.width / 2;
    this.minZ = center.z - this.depth / 2;
    this.samplesX = this.segmentsX + 1;
    this.samplesZ = this.segmentsZ + 1;

    // Row-major samples: index = iz * samplesX + ix
    this.heights = new Float32Array(this.samplesX * this.samplesZ);
    for (let iz = 0; iz < this.samplesZ; iz++) {
      for (let ix = 0; ix < this.samplesX; ix++) {
        this.heights[iz * this.samplesX + ix] = heightAt(this.minX + ix * cellSize, this.minZ + iz * cellSize);
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
    const nx = this.samplesX;
    const count = this.samplesX * this.samplesZ;
    const positions = new Float32Array(count * 3);
    for (let iz = 0; iz < this.samplesZ; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const i = iz * nx + ix;
        positions[i * 3] = this.minX + ix * this.cellSize;
        positions[i * 3 + 1] = this.heights[i];
        positions[i * 3 + 2] = this.minZ + iz * this.cellSize;
      }
    }

    const indices = new Uint32Array(this.segmentsX * this.segmentsZ * 6);
    let k = 0;
    for (let iz = 0; iz < this.segmentsZ; iz++) {
      for (let ix = 0; ix < this.segmentsX; ix++) {
        const a = iz * nx + ix; // (x,     z)
        const b = a + 1;        // (x + 1, z)
        const c = a + nx;       // (x,     z + 1)
        const d = c + 1;        // (x + 1, z + 1)
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
      const colors = new Float32Array(count * 3);
      const color = new THREE.Color();
      for (let i = 0; i < count; i++) {
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
    const nx = this.samplesX;
    const gx = THREE.MathUtils.clamp((x - this.minX) / this.cellSize, 0, this.segmentsX - 1e-6);
    const gz = THREE.MathUtils.clamp((z - this.minZ) / this.cellSize, 0, this.segmentsZ - 1e-6);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;

    const ha = this.heights[iz * nx + ix];
    const hb = this.heights[iz * nx + ix + 1];
    const hc = this.heights[(iz + 1) * nx + ix];
    const hd = this.heights[(iz + 1) * nx + ix + 1];

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

    // Rapier wants column-major samples with rows along Z: index = iz + ix * samplesZ
    const columnMajor = new Float32Array(this.samplesX * this.samplesZ);
    for (let ix = 0; ix < this.samplesX; ix++) {
      for (let iz = 0; iz < this.samplesZ; iz++) {
        columnMajor[iz + ix * this.samplesZ] = this.heights[iz * this.samplesX + ix];
      }
    }

    this.collider = physicsWorld.createHeightfield(
      this.segmentsZ,
      this.segmentsX,
      columnMajor,
      this.width,
      this.depth,
      { x: this.center.x, y: 0, z: this.center.z }
    );
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
