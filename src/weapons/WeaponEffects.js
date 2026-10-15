import * as THREE from 'three';

const TRACER_COUNT = 20;
const TRACER_SECONDS = 0.05;
const IMPACT_COUNT = 16;
const IMPACT_SECONDS = 0.35;
const FLASH_SECONDS = 0.05;
const FLASH_LIGHT_INTENSITY = 6;
const BLAST_COUNT = 4;
const BLAST_SECONDS = 0.6;
const BLAST_START_SCALE = 0.5;
const BLAST_END_SCALE = 2.4;
const BLAST_LIGHT_INTENSITY = 45;

const IMPACT_COLORS = {
  dust: new THREE.Color(0xc9b48a),
  spark: new THREE.Color(0xffd27a),
  hit: new THREE.Color(0xd23c2c)
};

/**
 * WeaponEffects
 * Pooled visual feedback for guns: bullet tracers, impact puffs, a muzzle flash with a point
 * light, and fireballs for artillery detonations. Nothing is allocated after construction.
 * The flash light stays in the scene at zero intensity so firing never triggers a shader
 * recompile; it also lights the first moments of a blast.
 */
export class WeaponEffects {
  /**
   * @param {THREE.Object3D} parent - Usually gameWorld.effectsGroup
   * @param {Object} [options]
   * @param {boolean} [options.flashLight=true] - Light the scene on muzzle flashes (the player's gun);
   *   off for AI squads, so many shooters don't each add a point light to every lit material
   */
  constructor(parent, { flashLight = true } = {}) {
    this.parent = parent;
    this.group = new THREE.Group();
    this.group.name = 'WeaponEffects';
    parent.add(this.group);

    // Tracers: unit-length bars along +Z, stretched to the shot's length
    this.tracerGeometry = new THREE.BoxGeometry(0.025, 0.025, 1);
    this.tracerGeometry.translate(0, 0, 0.5);
    this.tracerMaterial = new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false });
    this.tracers = [];
    for (let i = 0; i < TRACER_COUNT; i++) {
      const mesh = new THREE.Mesh(this.tracerGeometry, this.tracerMaterial);
      mesh.visible = false;
      this.group.add(mesh);
      this.tracers.push({ mesh, life: 0 });
    }
    this._nextTracer = 0;

    // Impact puffs: each has its own material so it can fade on its own
    this.impactGeometry = new THREE.IcosahedronGeometry(0.12, 0);
    this.impacts = [];
    for (let i = 0; i < IMPACT_COUNT; i++) {
      const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(this.impactGeometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.impacts.push({ mesh, life: 0 });
    }
    this._nextImpact = 0;

    // Muzzle flash
    this.flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc46b,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });
    this.flash = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), this.flashMaterial);
    this.flash.scale.set(1, 1, 2.2);
    this.flash.visible = false;
    this.group.add(this.flash);
    this.flashLight = null;
    if (flashLight) {
      this.flashLight = new THREE.PointLight(0xffc070, 0, 10, 2);
      this.group.add(this.flashLight);
    }
    this._flashLife = 0;

    // Blast fireballs: each has its own material so it can fade on its own
    this.blastGeometry = new THREE.IcosahedronGeometry(1, 1);
    this.blasts = [];
    for (let i = 0; i < BLAST_COUNT; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffa63d,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      });
      const mesh = new THREE.Mesh(this.blastGeometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.blasts.push({ mesh, life: 0, scale: 1 });
    }
    this._nextBlast = 0;
    this._blastLightLife = 0;
  }

  /**
   * A bright streak from `from` to `to`, shown for a couple of frames.
   */
  tracer(from, to) {
    const tracer = this.tracers[this._nextTracer];
    this._nextTracer = (this._nextTracer + 1) % TRACER_COUNT;
    tracer.mesh.position.copy(from);
    tracer.mesh.lookAt(to);
    tracer.mesh.scale.set(1, 1, Math.max(0.01, from.distanceTo(to)));
    tracer.mesh.visible = true;
    tracer.life = TRACER_SECONDS;
  }

  /**
   * A puff where a shot landed. kind: 'dust' (ground), 'spark' (rock, metal), 'hit' (a target).
   */
  impact(point, kind = 'dust') {
    const impact = this.impacts[this._nextImpact];
    this._nextImpact = (this._nextImpact + 1) % IMPACT_COUNT;
    impact.mesh.position.copy(point);
    impact.mesh.material.color.copy(IMPACT_COLORS[kind] || IMPACT_COLORS.dust);
    impact.mesh.material.opacity = 0.85;
    impact.mesh.scale.setScalar(1);
    impact.mesh.visible = true;
    impact.life = IMPACT_SECONDS;
  }

  /**
   * Flash and light at the muzzle, oriented along the shot.
   */
  muzzleFlash(position, target) {
    this.flash.position.copy(position);
    this.flash.lookAt(target);
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.visible = true;
    if (this.flashLight) {
      this.flashLight.position.copy(position);
      this.flashLight.intensity = FLASH_LIGHT_INTENSITY;
    }
    this._flashLife = FLASH_SECONDS;
  }

  /**
   * A fireball where an artillery shell detonated.
   * @param {THREE.Vector3} position - Detonation centre
   * @param {number} [scale] - Relative size multiplier
   */
  blast(position, scale = 1) {
    const blast = this.blasts[this._nextBlast];
    this._nextBlast = (this._nextBlast + 1) % BLAST_COUNT;
    blast.scale = scale;
    blast.mesh.position.copy(position);
    blast.mesh.scale.setScalar(BLAST_START_SCALE * scale);
    blast.mesh.material.opacity = 0.9;
    blast.mesh.visible = true;
    blast.life = BLAST_SECONDS;
    if (this.flashLight) {
      this.flashLight.position.copy(position);
      this._blastLightLife = BLAST_SECONDS;
    }
  }

  /**
   * Fades and retires effects. Call once per frame.
   */
  update(delta) {
    for (const tracer of this.tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= delta;
      if (tracer.life <= 0) tracer.mesh.visible = false;
    }

    for (const impact of this.impacts) {
      if (impact.life <= 0) continue;
      impact.life -= delta;
      const t = 1 - Math.max(0, impact.life) / IMPACT_SECONDS;
      impact.mesh.scale.setScalar(1 + t * 2);
      impact.mesh.material.opacity = 0.85 * (1 - t);
      if (impact.life <= 0) impact.mesh.visible = false;
    }

    if (this._flashLife > 0) {
      this._flashLife -= delta;
      if (this._flashLife <= 0) this.flash.visible = false;
    }

    for (const blast of this.blasts) {
      if (blast.life <= 0) continue;
      blast.life -= delta;
      const t = 1 - Math.max(0, blast.life) / BLAST_SECONDS;
      blast.mesh.scale.setScalar((BLAST_START_SCALE + (BLAST_END_SCALE - BLAST_START_SCALE) * t) * blast.scale);
      blast.mesh.material.opacity = 0.9 * (1 - t);
      if (blast.life <= 0) blast.mesh.visible = false;
    }

    // The single light serves the muzzle flash and blasts: the brighter of the two
    if (this._blastLightLife > 0) this._blastLightLife = Math.max(0, this._blastLightLife - delta);
    if (this.flashLight) {
      const flash = this._flashLife > 0 ? FLASH_LIGHT_INTENSITY : 0;
      const blastLight = this._blastLightLife > 0 ? BLAST_LIGHT_INTENSITY * (this._blastLightLife / BLAST_SECONDS) : 0;
      this.flashLight.intensity = Math.max(flash, blastLight);
    }
  }

  dispose() {
    this.tracerGeometry.dispose();
    this.tracerMaterial.dispose();
    this.impactGeometry.dispose();
    for (const impact of this.impacts) impact.mesh.material.dispose();
    this.flash.geometry.dispose();
    this.flashMaterial.dispose();
    this.blastGeometry.dispose();
    for (const blast of this.blasts) blast.mesh.material.dispose();
    if (this.flashLight) this.flashLight.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
