import * as THREE from 'three';
import { BaseEntity } from '../../entities/BaseEntity.js';
import { HealthComponent } from '../../entities/components/HealthComponent.js';

const COLOR = 0x66e8ff;
const HALF_SIZE = { x: 0.45, y: 0.95, z: 0.45 }; // Collider round the crystal
const SHATTER_SECONDS = 0.35;
const _UP = new THREE.Vector3(0, 1, 0);

/**
 * ShieldCrystal
 * A glowing crystal the aliens grew on one of the hall's pillars. While any of its crystals
 * stands, the Warden's shield holds; a beam runs from each one to the Warden. It is an alien
 * target the guns can hit (health and a collider), so shoot it to pieces: it shatters, and its
 * collider goes.
 *
 * - Phase 5 (gameplayUpdate): notices it has been destroyed
 * - Phase 6 (lateUpdate): spins, aims its beam at the Warden, shrinks away when shattered
 */
export class ShieldCrystal extends BaseEntity {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {THREE.Vector3} options.position - Middle of the crystal
   * @param {number} options.health
   * @param {Object} [options.linkedTo] - What it shields (the beam runs to it): has position, capsuleCenter, isDead
   */
  constructor(gameWorld, { position, health, linkedTo = null }) {
    super('ShieldCrystal');
    this.gameWorld = gameWorld;
    this.physicsWorld = gameWorld.physics;
    this.faction = 'aliens';
    this.health = new HealthComponent(health);
    this.position = position.clone();
    this.linkedTo = linkedTo;
    this.isDead = false;
    this._shatter = 0;

    this.mesh = new THREE.Group();
    this.mesh.name = 'ShieldCrystal';
    this.mesh.position.copy(this.position);
    const crystalGeometry = new THREE.OctahedronGeometry(0.6, 0);
    crystalGeometry.scale(0.7, 1.6, 0.7);
    this.crystal = new THREE.Mesh(crystalGeometry, new THREE.MeshBasicMaterial({ color: COLOR, toneMapped: false }));
    this.mesh.add(this.crystal);

    // The beam: a thin tube one meter long, stretched and turned towards the Warden every frame
    const beamGeometry = new THREE.CylinderGeometry(0.05, 0.05, 1, 6, 1, true);
    beamGeometry.translate(0, 0.5, 0);
    this.beam = new THREE.Mesh(beamGeometry, new THREE.MeshBasicMaterial({
      color: COLOR, transparent: true, opacity: 0.55, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false
    }));
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    this.mesh.add(this.beam);

    this.collider = this.physicsWorld.createStaticBox(HALF_SIZE, this.position);
    if (this.collider) this.collider.userData = { entity: this };

    this._toTarget = new THREE.Vector3();
  }

  gameplayUpdate() {
    if (this.isDead || !this.health.isDead) return;
    this.isDead = true;
    this._removeCollider();
  }

  lateUpdate(delta) {
    if (this.isDead) {
      this.beam.visible = false;
      this._shatter = Math.min(1, this._shatter + delta / SHATTER_SECONDS);
      this.crystal.scale.setScalar(Math.max(0.001, 1 - this._shatter));
      this.crystal.visible = this._shatter < 1;
      return;
    }
    this.crystal.rotation.y += delta * 0.8;

    const target = this.linkedTo;
    if (!target || target.isDead) {
      this.beam.visible = false;
      return;
    }
    this._toTarget.set(target.position.x, target.position.y + target.capsuleCenter * 1.3, target.position.z).sub(this.position);
    const length = this._toTarget.length();
    this.beam.scale.set(1, length, 1);
    this.beam.quaternion.setFromUnitVectors(_UP, this._toTarget.divideScalar(length));
    this.beam.visible = true;
  }

  _removeCollider() {
    if (this.collider) {
      this.physicsWorld.removeRigidBody(this.collider.rigidBody);
      this.collider = null;
    }
  }

  dispose() {
    this._removeCollider();
    super.dispose(); // Geometries and materials of the crystal and the beam
  }
}
