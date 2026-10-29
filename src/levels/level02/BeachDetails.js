import * as THREE from 'three';

/** Small, non-blocking coastal detail, owned exclusively by Level 2. */
export class BeachDetails {
  constructor(gameWorld, environment) {
    this.environment = environment;
    this.group = new THREE.Group();
    this.group.name = 'Level02_CoastalDetails';
    this.time = 0;
    this.surf = [];
    // Local deterministic scatter: loading this scenery must not change combat RNG.
    let seed = 2702;
    this.random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    this._scatter();
    this._surf();
    this._skidMarks();
    gameWorld.environmentGroup.add(this.group);
  }

  _shoreZ(x) {
    let inland = 80;
    let sea = 240;
    for (let i = 0; i < 18; i++) {
      const z = (inland + sea) / 2;
      if (this.environment.inlandDistance(x, z) > 0) inland = z;
      else sea = z;
    }
    return (inland + sea) / 2;
  }

  _scatter() {
    const pebbleGeometry = new THREE.IcosahedronGeometry(1, 0);
    const woodGeometry = new THREE.CylinderGeometry(0.08, 0.13, 1, 6);
    woodGeometry.rotateZ(Math.PI / 2);
    const wrackGeometry = new THREE.SphereGeometry(1, 5, 3);
    const stone = new THREE.MeshStandardMaterial({ color: 0x77766b, roughness: 0.98 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x81705a, roughness: 1 });
    const wrack = new THREE.MeshStandardMaterial({ color: 0x514e32, roughness: 1 });
    const matrix = new THREE.Object3D();
    const tint = new THREE.Color();
    for (const [name, geometry, material, count] of [
      ['Pebbles', pebbleGeometry, stone, 420],
      ['Driftwood', woodGeometry, wood, 48],
      ['TideWrack', wrackGeometry, wrack, 180]
    ]) {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.name = name;
      mesh.receiveShadow = true;
      for (let i = 0; i < count; i++) {
        const x = (this.random() - 0.5) * 340;
        const z = this._shoreZ(x) - 3 - this.random() * (name === 'Pebbles' ? 23 : 5);
        const y = this.environment.heightAt(x, z);
        const size = 0.04 + this.random() * 0.11;
        matrix.position.set(x, y + 0.015, z);
        matrix.rotation.set(0, this.random() * Math.PI * 2, 0);
        if (name === 'Pebbles') matrix.scale.set(size * 1.5, size * 0.55, size);
        else if (name === 'Driftwood') matrix.scale.set(0.5 + this.random() * 1.3, 0.6, 0.7);
        else matrix.scale.set(0.12 + this.random() * 0.4, 0.025, 0.08 + this.random() * 0.16);
        matrix.updateMatrix();
        mesh.setMatrixAt(i, matrix.matrix);
        mesh.setColorAt(i, tint.setScalar(0.65 + this.random() * 0.5));
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
  }

  _surf() {
    // Separate broken ribbons avoid a continuous white outline around the island.
    for (let band = 0; band < 3; band++) {
      const vertices = [];
      const colors = [];
      const indices = [];
      for (let i = 0; i <= 180; i++) {
        const x = -180 + i * 2;
        const shore = this._shoreZ(x);
        const strength = 0.35 + 0.65 * Math.pow(Math.sin(i * 0.37 + band), 2);
        for (let edge = 0; edge < 2; edge++) {
          vertices.push(x, 0, shore + band * 1.8 + edge * (0.25 + strength * 0.55));
          colors.push(strength, strength, strength);
        }
        if (i < 180 && Math.sin(i * 0.23 + band * 2) > -0.65) {
          const a = i * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      const material = new THREE.MeshBasicMaterial({
        color: 0xe9e8d5, vertexColors: true, transparent: true, opacity: 0.3,
        depthWrite: false, side: THREE.DoubleSide, fog: true
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `ShoreBreak_${band}`;
      mesh.frustumCulled = false; // Vertices follow CPU ocean displacement each frame.
      this.group.add(mesh);
      this.surf.push({ mesh, base: Float32Array.from(vertices), band });
    }
    this.update(0);
  }

  _skidMarks() {
    const material = new THREE.MeshBasicMaterial({ color: 0x665340, transparent: true, opacity: 0.18, depthWrite: false });
    for (const [x, z, heading] of [[-45, 180, 0.25], [28, 180, -0.2]]) {
      for (const side of [-1, 1]) {
        const geometry = new THREE.PlaneGeometry(0.18, 5.4, 1, 12);
        geometry.rotateX(-Math.PI / 2);
        geometry.rotateY(heading);
        geometry.translate(x + side * 1.1 * Math.cos(heading), 0, z - side * 1.1 * Math.sin(heading));
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          positions.setY(i, this.environment.heightAt(positions.getX(i), positions.getZ(i)) + 0.025);
        }
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'SkidImpression';
        this.group.add(mesh);
      }
    }
  }

  update(delta) {
    this.time += delta;
    for (const { mesh, base, band } of this.surf) {
      const phase = (this.time * 0.15 + band / 3) % 1;
      const positions = mesh.geometry.attributes.position;
      mesh.material.opacity = Math.sin(phase * Math.PI) * 0.38;
      for (let i = 0; i < positions.count; i++) {
        const x = base[i * 3];
        const z = base[i * 3 + 2] - phase * 3;
        const ground = this.environment.heightAt(x, z);
        const water = this.environment.ocean.getWaveHeight(x, z);
        positions.setXYZ(i, x, Math.max(ground, water) + 0.045, z);
      }
      positions.needsUpdate = true;
    }
  }

  dispose() {
    const geometries = new Set();
    const materials = new Set();
    this.group.traverse((child) => {
      if (child.geometry) geometries.add(child.geometry);
      if (child.material) materials.add(child.material);
      if (child.isInstancedMesh) child.dispose();
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.group.removeFromParent();
    this.group.clear();
    this.surf.length = 0;
  }
}
