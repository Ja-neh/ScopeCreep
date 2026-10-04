import * as THREE from 'three';
import forceFieldVert from '../../rendering/shaders/forcefield.vert.glsl';
import forceFieldFrag from '../../rendering/shaders/forcefield.frag.glsl';

const COLOR = 0x5cf2d6;
const COLLAPSE_SECONDS = 2.5;

/**
 * ForceFieldDome
 * The aliens' force field over the village hall: a glowing hemisphere of hexagons with energy
 * rolling up it (forcefield.*.glsl), and a ball collider that keeps everyone, and every bullet,
 * out. collapse() takes the collider away at once and lets the dome flicker and fade out.
 * States: 'up' -> 'collapsing' -> 'down'. Owned by its level: update() it every frame (Phase 5),
 * dispose() it at the end.
 */
export class ForceFieldDome {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {THREE.Vector3} options.centre - Ground point in the middle
   * @param {number} options.radius
   */
  constructor(gameWorld, { centre, radius }) {
    this.gameWorld = gameWorld;
    this.physicsWorld = gameWorld.physics;
    this.centre = centre.clone();
    this.radius = radius;
    this.top = new THREE.Vector3(centre.x, centre.y + radius, centre.z);
    this.state = 'up';
    this.collider = null;
    this.mesh = null;
    this._collapseTime = 0;

    this.uniforms = {
      uColor: { value: new THREE.Color(COLOR) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uFlicker: { value: 0 }
    };
  }

  build() {
    this.geometry = new THREE.SphereGeometry(1, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: forceFieldVert,
      fragmentShader: forceFieldFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false // A beacon: you can see it glowing from the far end of the village
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'ForceFieldDome';
    this.mesh.position.copy(this.centre);
    this.mesh.scale.setScalar(this.radius);
    this.gameWorld.environmentGroup.add(this.mesh);
    this.collider = this.physicsWorld.createStaticBall(this.radius, this.centre);
  }

  /** True while it still keeps people out. */
  get isUp() {
    return this.state === 'up';
  }

  /** True if the dome (while up) covers (x, z), grown by `margin`. */
  blocks(x, z, margin = 0) {
    return this.isUp && Math.hypot(x - this.centre.x, z - this.centre.z) < this.radius + margin;
  }

  /**
   * Brings it down: the way in is open at once; the dome flickers out over a couple of seconds
   * (or vanishes, `instant`).
   */
  collapse({ instant = false } = {}) {
    if (this.state !== 'up') return;
    this._removeCollider();
    this.state = instant ? 'down' : 'collapsing';
    this._collapseTime = 0;
    if (instant && this.mesh) this.mesh.visible = false;
  }

  /** Phase 5: the energy rolling up it, and the collapse. */
  update(delta) {
    this.uniforms.uTime.value += delta;
    if (this.state !== 'collapsing') return;
    this._collapseTime += delta;
    const t = Math.min(1, this._collapseTime / COLLAPSE_SECONDS);
    this.uniforms.uOpacity.value = 1 - t;
    this.uniforms.uFlicker.value = 1 - t * 0.5;
    if (t >= 1) {
      this.state = 'down';
      if (this.mesh) this.mesh.visible = false;
    }
  }

  _removeCollider() {
    if (this.collider) {
      this.physicsWorld.removeRigidBody(this.collider.rigidBody);
      this.collider = null;
    }
  }

  dispose() {
    this._removeCollider();
    if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh);
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
    this.mesh = null;
  }
}
