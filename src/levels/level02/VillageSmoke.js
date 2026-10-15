import * as THREE from 'three';

// Smoke over the village: two columns of ash and embers rising beyond the plateau, a long way
// off over the treetops. It fades in as the squad closes on the village, so the last stretch has
// something on the skyline: the fight up there is already burning (the Level 3 hall). Fixed pool
// of instanced puffs; nothing is allocated after construction.
const PILLARS = 2;
const PARTICLES = 160;
const EMIT_PER_SECOND = 15;       // Per pillar, at full reveal
const LIFE_SECONDS = [5, 9];      // A long, slow climb into the sky
const RISE_SPEED = [3.5, 6];      // m/s
const DRIFT_SPEED = [0.6, 1.6];   // Carried by the wind, +x and +z
const SPREAD = 2.2;               // Where puffs are born, around the pillar's foot
const SIZE = [2.6, 5.5];
const ASH = new THREE.Color(0x4a4a52);
const EMBER = new THREE.Color(0xb4653a); // The hot base of the column
const WIND = { x: 0.9, z: 0.45 };
const REVEAL_DISTANCE = 180;      // Fade-in starts this many meters from the village centre
const FULL_DISTANCE = 95;         // ...and is complete here (the gate is ~90 m out)
const EMPTY_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * VillageSmoke
 * The village burning beyond the ridge: two slow columns of smoke, ash grey with ember-hot
 * bases, visible long before anything else on the skyline. Visual only; it reads the player's
 * distance every frame so it is invisible from the beach and unmistakable by the outskirts.
 */
export class VillageSmoke {
  /**
   * @param {THREE.Object3D} parent - Usually gameWorld.environmentGroup
   * @param {BeachEnvironment} environment - For ground height and the village centre
   * @param {Object} [options]
   * @param {THREE.Vector3[]} [options.pillars] - Ground points to smoke from
   */
  constructor(parent, environment, { pillars = null } = {}) {
    this.environment = environment;
    this.visible = false;
    this.reveal = 0;

    const v = environment.village;
    const feet = pillars || [
      new THREE.Vector3(v.x - 30, 0, v.z + 55),
      new THREE.Vector3(v.x + 42, 0, v.z + 10)
    ];
    this.pillars = feet.slice(0, PILLARS).map((foot) => {
      const y = Math.max(environment.heightAt(foot.x, foot.z), v.height);
      return new THREE.Vector3(foot.x, y - 1.5, foot.z); // Sunk a touch: it reads as beyond the ridge
    });

    this.geometry = new THREE.IcosahedronGeometry(0.5, 0);
    this.material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, PARTICLES);
    this.mesh.name = 'VillageSmoke';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; // Puffs spread far from the mesh origin
    this.mesh.castShadow = false;

    this.particles = [];
    this._matrix = new THREE.Matrix4();
    for (let i = 0; i < PARTICLES; i++) {
      this.particles.push({ life: 0, maxLife: 1, size: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ember: false });
      this.mesh.setMatrixAt(i, EMPTY_MATRIX);
      this.mesh.setColorAt(i, ASH);
    }
    this._next = 0;
    this._emitCarry = [0, 0];
    this._time = 0;

    parent.add(this.mesh);
  }

  /**
   * Reveals and animates the columns. Call once per frame.
   * @param {number} delta
   * @param {Player} player - The reveal follows their distance to the village
   */
  update(delta, player) {
    this.mesh.visible = false; // The mesh only shows once the reveal passes its threshold below
    if (!player) return;
    // The reveal: hidden from the beach, a full column by the outskirts
    const v = this.environment.village;
    const distance = Math.hypot(player.position.x - v.x, player.position.z - v.z);
    const target = Math.max(0, Math.min(1, (REVEAL_DISTANCE - distance) / (REVEAL_DISTANCE - FULL_DISTANCE)));
    const smoothing = Math.min(1, delta * 0.4);
    this.reveal += (target - this.reveal) * smoothing;
    this.visible = this.reveal > 0.02;
    this.mesh.visible = this.visible;
    if (!this.visible) return;

    this._time += delta;
    for (let p = 0; p < this.pillars.length; p++) {
      this._emitCarry[p] += EMIT_PER_SECOND * this.reveal * delta;
      while (this._emitCarry[p] >= 1) {
        this._emitCarry[p] -= 1;
        this._spawn(p);
      }
    }

    for (let i = 0; i < PARTICLES; i++) {
      const p = this.particles[i];
      if (p.life <= 0) continue;
      p.life -= delta;
      if (p.life <= 0) {
        this.mesh.setMatrixAt(i, EMPTY_MATRIX);
        continue;
      }
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.z += p.vz * delta;
      p.vy = Math.max(2.4, p.vy - delta * 0.35); // It stops climbing and hangs, then the pool recycles it

      const t = 1 - p.life / p.maxLife;
      const scale = p.size * (0.7 + 1.9 * t) * Math.min(1, (1 - t) * 3.5) * (0.35 + 0.65 * this.reveal);
      this._matrix.makeScale(scale, scale * 1.15, scale).setPosition(p.x, p.y, p.z);
      this.mesh.setMatrixAt(i, this._matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  _spawn(pillarIndex) {
    const i = this._next;
    this._next = (this._next + 1) % PARTICLES;
    const p = this.particles[i];
    const foot = this.pillars[pillarIndex];

    p.x = foot.x + (Math.random() - 0.5) * 2 * SPREAD;
    p.z = foot.z + (Math.random() - 0.5) * 2 * SPREAD;
    p.y = foot.y + 1 + Math.random() * 3;
    p.vx = WIND.x * lerp(DRIFT_SPEED, Math.random());
    p.vz = WIND.z * lerp(DRIFT_SPEED, Math.random());
    p.vy = lerp(RISE_SPEED, Math.random());
    p.maxLife = lerp(LIFE_SECONDS, Math.random());
    p.life = p.maxLife;
    p.size = lerp(SIZE, Math.random());
    // The base of the column runs ember-hot; higher puffs are ash
    p.ember = p.y - foot.y < 3.5;
    this.mesh.setColorAt(i, p.ember ? EMBER : ASH);
    this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh = null;
    this.particles = [];
    this.pillars = [];
  }
}

/** Scalar lerp between a [min, max] pair. */
function lerp(range, t) {
  return range[0] + (range[1] - range[0]) * t;
}
