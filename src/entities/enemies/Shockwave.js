import * as THREE from 'three';

const WALL_HEIGHT = 0.9;  // How tall the rolling ring looks
const BAND = 1.2;         // How thick the part that hurts is (meters)
const COLOR = 0x7dffa0;

/**
 * Shockwave
 * A ring of force that rolls out across the floor from where the Warden slammed it. Anyone it
 * passes while standing on the ground is hurt, once; jump over it to stay clear. Before the slam,
 * a glowing ring on the floor around the caster warns that it is coming (telegraph).
 *
 * Owned by its caster: start() it, update() it in Phase 5 (growth and damage) and sync() it in
 * Phase 6 (the meshes, in `parent`, usually the GameWorld's effects group).
 */
export class Shockwave {
  /**
   * @param {THREE.Object3D} parent - Where the ring meshes go
   */
  constructor(parent) {
    this.parent = parent;
    this.active = false;
    this.centre = new THREE.Vector3();
    this.radius = 0;
    this.maxRadius = 0;
    this.speed = 0;
    this.damage = 0;
    this.clearHeight = 0;
    this.source = null;
    this._hit = new Set();

    const wall = new THREE.CylinderGeometry(1, 1, WALL_HEIGHT, 48, 1, true);
    wall.translate(0, WALL_HEIGHT / 2, 0);
    this._wallMaterial = new THREE.MeshBasicMaterial({
      color: COLOR, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
    });
    this.ring = new THREE.Mesh(wall, this._wallMaterial);
    this.ring.name = 'Shockwave';
    this.ring.visible = false;

    const warning = new THREE.RingGeometry(2.2, 3.0, 40);
    warning.rotateX(-Math.PI / 2);
    this._warningMaterial = new THREE.MeshBasicMaterial({
      color: COLOR, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false
    });
    this.warning = new THREE.Mesh(warning, this._warningMaterial);
    this.warning.name = 'ShockwaveWarning';
    this.warning.visible = false;

    if (parent) parent.add(this.ring, this.warning);
  }

  /**
   * Sends a new ring out from `centre` (the caster's feet).
   * @param {THREE.Vector3} centre
   * @param {Object} wave
   * @param {number} wave.speed - Meters per second
   * @param {number} wave.maxRadius - Where it fades out
   * @param {number} wave.damage - To each target it catches
   * @param {number} wave.clearHeight - Feet this far above the floor (a jump) let it pass
   * @param {Object} [wave.source] - Credited with the damage
   */
  start(centre, { speed, maxRadius, damage, clearHeight, source = null }) {
    this.centre.copy(centre);
    this.speed = speed;
    this.maxRadius = maxRadius;
    this.damage = damage;
    this.clearHeight = clearHeight;
    this.source = source;
    this.radius = 0.5;
    this.active = true;
    this._hit.clear();
  }

  /**
   * Phase 5: grows, and hurts anyone on the ground in the ring as it passes them.
   * @param {number} delta
   * @param {Array} targets - Things with `position` and `health`
   */
  update(delta, targets) {
    if (!this.active) return;
    this.radius += this.speed * delta;
    for (const target of targets) {
      if (this._hit.has(target) || !target.health || target.health.isDead) continue;
      const distance = Math.hypot(target.position.x - this.centre.x, target.position.z - this.centre.z);
      if (Math.abs(distance - this.radius) > BAND / 2) continue;
      if (target.position.y - this.centre.y > this.clearHeight) continue; // Jumped it
      this._hit.add(target);
      target.health.takeDamage({ amount: this.damage, source: this.source });
    }
    if (this.radius >= this.maxRadius) this.active = false;
  }

  /** Stops the ring where it is (the caster died). */
  stop() {
    this.active = false;
  }

  /**
   * Phase 6: places the meshes. `warning` (0..1) is how close the next slam is (0 hides the warning).
   * @param {THREE.Vector3} casterPosition - Where the warning ring goes
   * @param {number} warning
   */
  sync(casterPosition, warning = 0) {
    this.ring.visible = this.active;
    if (this.active) {
      this.ring.position.copy(this.centre);
      this.ring.scale.set(this.radius, 1, this.radius);
      this._wallMaterial.opacity = 0.75 * (1 - this.radius / this.maxRadius) + 0.05;
    }
    this.warning.visible = warning > 0;
    if (warning > 0) {
      this.warning.position.set(casterPosition.x, casterPosition.y + 0.05, casterPosition.z);
      this._warningMaterial.opacity = 0.25 + 0.6 * warning;
      this.warning.scale.setScalar(1.6 - 0.6 * warning);
    }
  }

  dispose() {
    for (const mesh of [this.ring, this.warning]) {
      if (mesh.parent) mesh.parent.remove(mesh);
      mesh.geometry.dispose();
    }
    this._wallMaterial.dispose();
    this._warningMaterial.dispose();
  }
}
