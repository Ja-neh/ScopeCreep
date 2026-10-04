import * as THREE from 'three';

const PARTICLES = 96;
const EMIT_PER_SECOND = 70;        // At full strength
const LIFE_SECONDS = [0.9, 1.5];
const RING_RADIUS = [1.5, 4.5];    // Where puffs start, around the point under the rotor
const OUT_SPEED = [6, 12];         // Blown outwards (m/s)
const RISE_SPEED = [0.4, 2.0];
const DRAG = 1.6;                  // Per second
const SIZE = [0.5, 1.2];
const SAND = new THREE.Color(0xd9c49c);
const SPRAY = new THREE.Color(0xe6f0f2);

/**
 * RotorWash
 * Sand (over the beach) or spray (over the sea) blown out from under a helicopter's rotor.
 * A fixed pool of instanced puffs; nothing is allocated after construction.
 */
export class RotorWash {
  /**
   * @param {THREE.Object3D} parent - Usually gameWorld.effectsGroup
   */
  constructor(parent) {
    this.geometry = new THREE.IcosahedronGeometry(0.5, 0);
    this.material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.32, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, PARTICLES);
    this.mesh.name = 'RotorWash';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; // Puffs spread far from the mesh origin
    this.mesh.castShadow = false;

    this.particles = [];
    this._matrix = new THREE.Matrix4();
    this._matrix.makeScale(0, 0, 0);
    for (let i = 0; i < PARTICLES; i++) {
      this.particles.push({ life: 0, maxLife: 1, size: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
      this.mesh.setMatrixAt(i, this._matrix);
      this.mesh.setColorAt(i, SAND);
    }
    this._next = 0;
    this._emitCarry = 0;
    this.activeCount = 0;

    parent.add(this.mesh);
  }

  /**
   * Emits and moves puffs. Call once per frame.
   * @param {number} delta
   * @param {number} x - Point on the surface under the rotor
   * @param {number} y
   * @param {number} z
   * @param {boolean} overWater - Spray instead of sand
   * @param {number} strength - 0 (none) to 1 (hovering just above the surface)
   */
  update(delta, x, y, z, overWater, strength) {
    if (strength > 0) {
      this._emitCarry += strength * EMIT_PER_SECOND * delta;
      while (this._emitCarry >= 1) {
        this._emitCarry -= 1;
        this._spawn(x, y, z, overWater, strength);
      }
    }

    this.activeCount = 0;
    const drag = Math.max(0, 1 - DRAG * delta);
    for (let i = 0; i < PARTICLES; i++) {
      const p = this.particles[i];
      if (p.life <= 0) continue;
      p.life -= delta;
      if (p.life <= 0) {
        this._matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this._matrix);
        continue;
      }
      this.activeCount++;
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.z += p.vz * delta;
      p.vx *= drag;
      p.vz *= drag;

      // Grow as it spreads, shrink away at the end
      const t = 1 - p.life / p.maxLife;
      const scale = p.size * (0.5 + 1.8 * t) * Math.min(1, (1 - t) * 4);
      this._matrix.makeScale(scale, scale * 0.6, scale).setPosition(p.x, p.y, p.z);
      this.mesh.setMatrixAt(i, this._matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  _spawn(x, y, z, overWater, strength) {
    const i = this._next;
    this._next = (this._next + 1) % PARTICLES;
    const p = this.particles[i];

    const angle = Math.random() * Math.PI * 2;
    const radius = lerp(RING_RADIUS, Math.random());
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const speed = lerp(OUT_SPEED, Math.random()) * (0.5 + 0.5 * strength);

    p.x = x + dirX * radius;
    p.y = y + 0.2;
    p.z = z + dirZ * radius;
    p.vx = dirX * speed;
    p.vy = lerp(RISE_SPEED, Math.random());
    p.vz = dirZ * speed;
    p.maxLife = lerp(LIFE_SECONDS, Math.random());
    p.life = p.maxLife;
    p.size = lerp(SIZE, Math.random());

    this.mesh.setColorAt(i, overWater ? SPRAY : SAND);
    this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}

function lerp([min, max], t) {
  return min + (max - min) * t;
}
