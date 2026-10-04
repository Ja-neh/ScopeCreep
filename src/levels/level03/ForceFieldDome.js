import * as THREE from 'three';
import forceFieldVert from '../../rendering/shaders/forcefield.vert.glsl';
import forceFieldFrag from '../../rendering/shaders/forcefield.frag.glsl';

const COLOR = 0x5cf2d6;
const COLLAPSE_SECONDS = 2.5;
const WALL_THICKNESS = 0.5; // Collider depth of a force-field wall

/**
 * ForceField
 * What the aliens' force fields share: the glowing hexagon look (forcefield.*.glsl), a collider
 * that keeps everyone, and every bullet, out while it is up, and collapse(), which takes the
 * collider away at once and lets the field flicker and fade out.
 * States: 'up' -> 'collapsing' -> 'down'. Owned by its level: update() it every frame (Phase 5),
 * dispose() it at the end.
 */
class ForceField {
  constructor(gameWorld, { flat }) {
    this.gameWorld = gameWorld;
    this.physicsWorld = gameWorld.physics;
    this.state = 'down';
    this.collider = null;
    this.mesh = null;
    this.geometry = null;
    this.material = null;
    this._collapseTime = 0;
    this.uniforms = {
      uColor: { value: new THREE.Color(COLOR) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uFlicker: { value: 0 },
      uFlat: { value: flat ? 1 : 0 }
    };
  }

  _createMesh(geometry, name) {
    this.geometry = geometry;
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: forceFieldVert,
      fragmentShader: forceFieldFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false // A beacon: it shows from the far end of the village
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = name;
    this.gameWorld.environmentGroup.add(this.mesh);
  }

  /** True while it keeps people out. */
  get isUp() {
    return this.state === 'up';
  }

  /**
   * Brings it down: the way through is open at once; the field flickers out over a couple of
   * seconds (or vanishes, `instant`).
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

/**
 * ForceFieldDome
 * The aliens' force field over the village hall: a glowing hemisphere of hexagons with energy
 * rolling up it, and a ball collider. Up from the moment it is built.
 */
export class ForceFieldDome extends ForceField {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {THREE.Vector3} options.centre - Ground point in the middle
   * @param {number} options.radius
   */
  constructor(gameWorld, { centre, radius }) {
    super(gameWorld, { flat: false });
    this.centre = centre.clone();
    this.radius = radius;
    this.top = new THREE.Vector3(centre.x, centre.y + radius, centre.z);
  }

  build() {
    this._createMesh(new THREE.SphereGeometry(1, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), 'ForceFieldDome');
    this.mesh.position.copy(this.centre);
    this.mesh.scale.setScalar(this.radius);
    this.collider = this.physicsWorld.createStaticBox ? this.physicsWorld.createStaticBall(this.radius, this.centre) : null;
    this.state = 'up';
  }

  /** True if the dome (while up) covers (x, z), grown by `margin`. */
  blocks(x, z, margin = 0) {
    return this.isUp && Math.hypot(x - this.centre.x, z - this.centre.z) < this.radius + margin;
  }
}

/**
 * ForceFieldWall
 * A flat force field across an opening (the hall's doorway): the same glowing hexagons, and a
 * thin box collider. Built down (hidden); raise() puts it up.
 */
export class ForceFieldWall extends ForceField {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {THREE.Vector3} options.centre - Ground point in the middle of the opening
   * @param {number} options.yaw - Which way the opening faces
   * @param {number} options.width
   * @param {number} options.height
   */
  constructor(gameWorld, { centre, yaw, width, height }) {
    super(gameWorld, { flat: true });
    this.centre = centre.clone();
    this.yaw = yaw;
    this.width = width;
    this.height = height;
  }

  build() {
    this._createMesh(new THREE.PlaneGeometry(this.width, this.height), 'ForceFieldWall');
    this.mesh.position.set(this.centre.x, this.centre.y + this.height / 2, this.centre.z);
    this.mesh.rotation.y = this.yaw;
    this.mesh.visible = false;
  }

  /** Seals the opening. */
  raise() {
    if (this.state === 'up') return;
    this.state = 'up';
    this.uniforms.uOpacity.value = 1;
    this.uniforms.uFlicker.value = 0;
    if (this.mesh) this.mesh.visible = true;
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.collider = this.physicsWorld.createStaticBox(
      { x: this.width / 2, y: this.height / 2, z: WALL_THICKNESS / 2 },
      { x: this.centre.x, y: this.centre.y + this.height / 2, z: this.centre.z },
      rotation
    );
  }
}
