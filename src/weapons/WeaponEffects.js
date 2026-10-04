import * as THREE from 'three';

const TRACER_COUNT = 20;
const TRACER_SECONDS = 0.05;
const IMPACT_COUNT = 16;
const IMPACT_SECONDS = 0.35;
const FLASH_SECONDS = 0.05;
const FLASH_LIGHT_INTENSITY = 6;

const IMPACT_COLORS = {
  dust: new THREE.Color(0xc9b48a),
  spark: new THREE.Color(0xffd27a),
  hit: new THREE.Color(0xd23c2c)
};

/**
 * WeaponEffects
 * Pooled visual feedback for small arms: bullet tracers, impact puffs and a muzzle flash
 * with a point light. Nothing is allocated after construction. The flash light stays in the
 * scene at zero intensity so firing never triggers a shader recompile.
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
      if (this._flashLife <= 0) {
        this.flash.visible = false;
        if (this.flashLight) this.flashLight.intensity = 0;
      }
    }
  }

  dispose() {
    this.tracerGeometry.dispose();
    this.tracerMaterial.dispose();
    this.impactGeometry.dispose();
    for (const impact of this.impacts) impact.mesh.material.dispose();
    this.flash.geometry.dispose();
    this.flashMaterial.dispose();
    if (this.flashLight) this.flashLight.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
