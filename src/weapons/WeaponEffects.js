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
const SMOKE_COUNT = 80;
const SMOKE_SECONDS = 1.6;      // Default puff lifetime
const SMOKE_START_OPACITY = 0.5;
const SMOKE_GROW = 1.9;         // Puffs swell to roughly twice their spawn size while fading
const SMOKE_START_FRACTION = 0.4;
const BLOOD_COUNT = 48;
const BLOOD_GRAVITY = 14;       // Droplets fall while they fly

// Gun smoke rolls through these greys, light gun-gas to dark cordite (`dark` picks the end)
const SMOKE_COLORS = [0x9aa0a4, 0x7c8085, 0x585b5f];
const BLOOD_COLOR = 0x8f1210;

let jitterInstances = 0; // Each effects pool starts its private generator somewhere new

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

    // Smoke: soft grey puffs that rise, drift and swell while they fade (muzzle gas, wisps
    // off a hot barrel, the cloud a shell throws up when it finds a hull). Each has its own
    // material so puffs can shade and fade on their own.
    this.smokeGeometry = new THREE.IcosahedronGeometry(1, 1);
    this.smoke = [];
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(this.smokeGeometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.smoke.push({ mesh, life: 0, seconds: SMOKE_SECONDS, baseScale: 1, rise: 0, drift: new THREE.Vector3() });
    }
    this._nextSmoke = 0;

    // Blood: short-lived dark red droplets sprayed from a wound
    this.bloodGeometry = new THREE.IcosahedronGeometry(1, 0);
    this.blood = [];
    for (let i = 0; i < BLOOD_COUNT; i++) {
      const material = new THREE.MeshBasicMaterial({ color: BLOOD_COLOR, transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(this.bloodGeometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.blood.push({ mesh, life: 0, seconds: 0.45, baseScale: 0.05, velocity: new THREE.Vector3() });
    }
    this._nextBlood = 0;

    // Scratchpads for the multi-puff spawners (no allocations per call)
    this._spawnPoint = new THREE.Vector3();
    this._spawnDrift = new THREE.Vector3();

    // Smoke and blood scatter draw from their own generator, never Math.random, so purely
    // visual jitter cannot shift the random rolls gameplay makes (spread, AI choices)
    this._jitterSeed = (0x2f6b9d1 + Math.imul(++jitterInstances, 0x9e3779b1)) | 0;
  }

  /**
   * A cosmetic random number in [0, 1) from the effects' private generator (mulberry32).
   */
  jitter() {
    let t = (this._jitterSeed = (this._jitterSeed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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
   * One smoke puff: the workhorse behind every smoke effect. Options: life (seconds),
   * rise (m/s upward), drift (copied into the puff, m/s), dark (0 light gas .. 1 cordite).
   */
  smokePuff(position, scale = 1, { life = SMOKE_SECONDS, rise = 1.4, drift = null, dark = 0 } = {}) {
    const puff = this.smoke[this._nextSmoke];
    this._nextSmoke = (this._nextSmoke + 1) % SMOKE_COUNT;
    puff.mesh.position.copy(position);
    const shade = SMOKE_COLORS[Math.round(THREE.MathUtils.clamp(dark, 0, 1) * (SMOKE_COLORS.length - 1))];
    puff.mesh.material.color.setHex(shade).offsetHSL(0, 0, (this.jitter() - 0.5) * 0.06);
    puff.mesh.material.opacity = SMOKE_START_OPACITY;
    puff.baseScale = Math.max(0.01, scale);
    puff.mesh.scale.setScalar(puff.baseScale * SMOKE_START_FRACTION);
    puff.seconds = life;
    puff.life = life;
    puff.rise = rise;
    if (drift) puff.drift.copy(drift);
    else puff.drift.set(0, 0, 0);
    puff.mesh.visible = true;
  }

  /**
   * A rolling cloud where something big was hit (a warship's hull): puffs bursting outward
   * and rising on their own paths.
   */
  smokeCloud(position, scale = 1, count = 6) {
    for (let i = 0; i < count; i++) {
      this._spawnPoint.copy(position);
      this._spawnPoint.x += (this.jitter() - 0.5) * scale * 2.2;
      this._spawnPoint.y += (this.jitter() - 0.2) * scale * 1.1;
      this._spawnPoint.z += (this.jitter() - 0.5) * scale * 2.2;
      this._spawnDrift.set((this.jitter() - 0.5) * scale * 0.8, 0.3 + this.jitter() * 0.7, (this.jitter() - 0.5) * scale * 0.8);
      this.smokePuff(this._spawnPoint, scale * (0.55 + this.jitter() * 0.7), {
        life: SMOKE_SECONDS * (0.9 + this.jitter() * 0.7),
        rise: 1.2 + this.jitter(),
        drift: this._spawnDrift,
        dark: 0.35 + this.jitter() * 0.4
      });
    }
  }

  /**
   * Gun gas at a muzzle: a burst pushed along the barrel, plus a slower wisp hanging at the
   * mouth of the gun.
   */
  muzzleSmoke(position, direction, scale = 1) {
    this._spawnDrift.copy(direction).multiplyScalar(2.2 * scale);
    this._spawnDrift.y += 0.6;
    this.smokePuff(position, scale * 0.85, { life: 0.85, rise: 1.1, drift: this._spawnDrift, dark: 0.25 });
    this._spawnDrift.set((this.jitter() - 0.5) * 0.5, 0.7 + this.jitter() * 0.4, (this.jitter() - 0.5) * 0.5);
    this.smokePuff(position, scale * 0.55, { life: 0.55, rise: 1.3, drift: this._spawnDrift, dark: 0.4 });
  }

  /**
   * A spray of blood where a fighter was hit: droplets fly on along the blow, scatter, and
   * fall while they fade. Without a direction the spray spurts upward.
   */
  bloodSpray(point, direction = null, count = 7) {
    for (let i = 0; i < count; i++) {
      const drop = this.blood[this._nextBlood];
      this._nextBlood = (this._nextBlood + 1) % BLOOD_COUNT;
      drop.mesh.position.copy(point);
      if (direction) {
        drop.velocity.copy(direction).multiplyScalar(2.2 + this.jitter() * 3.6);
      } else {
        drop.velocity.set(0, 0, 0);
      }
      // Every droplet leaves the wound on its own path
      drop.velocity.x += (this.jitter() - 0.5) * 2.4;
      drop.velocity.y += this.jitter() * 2.0;
      drop.velocity.z += (this.jitter() - 0.5) * 2.4;
      drop.mesh.material.color.setHex(BLOOD_COLOR).offsetHSL(0, 0, (this.jitter() - 0.5) * 0.06);
      drop.mesh.material.opacity = 0.9;
      drop.baseScale = 0.035 + this.jitter() * 0.035;
      drop.mesh.scale.setScalar(drop.baseScale);
      drop.seconds = 0.3 + this.jitter() * 0.25;
      drop.life = drop.seconds;
      drop.mesh.visible = true;
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

    for (const puff of this.smoke) {
      if (puff.life <= 0) continue;
      puff.life -= delta;
      const t = 1 - Math.max(0, puff.life) / puff.seconds;
      puff.mesh.position.addScaledVector(puff.drift, delta);
      puff.mesh.position.y += puff.rise * delta;
      puff.mesh.scale.setScalar(puff.baseScale * (SMOKE_START_FRACTION + SMOKE_GROW * t));
      puff.mesh.material.opacity = SMOKE_START_OPACITY * (1 - t);
      if (puff.life <= 0) puff.mesh.visible = false;
    }

    for (const drop of this.blood) {
      if (drop.life <= 0) continue;
      drop.life -= delta;
      drop.velocity.y -= BLOOD_GRAVITY * delta;
      drop.mesh.position.addScaledVector(drop.velocity, delta);
      drop.mesh.material.opacity = 0.9 * Math.max(0, drop.life / drop.seconds);
      if (drop.life <= 0) drop.mesh.visible = false;
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
    this.smokeGeometry.dispose();
    for (const puff of this.smoke) puff.mesh.material.dispose();
    this.bloodGeometry.dispose();
    for (const drop of this.blood) drop.mesh.material.dispose();
    if (this.flashLight) this.flashLight.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
