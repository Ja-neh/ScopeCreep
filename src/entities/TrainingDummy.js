import * as THREE from 'three';
import { BaseEntity } from './BaseEntity.js';
import { HealthComponent } from './components/HealthComponent.js';
import config from '../config.json';

const BODY_HALF_HEIGHT = 0.95; // Collider: upright cylinder from the ground to 1.9 m
const BODY_RADIUS = 0.38;
const HIT_FLASH_SECONDS = 0.12;
const FALL_SECONDS = 0.4;

/**
 * TrainingDummy
 * A straw target on a post for test levels: takes damage like an enemy, flashes when hit,
 * topples when destroyed and stands back up after a few seconds. Faces along -Z rotated by
 * `facing`, so backstabs can be tested from behind.
 */
export class TrainingDummy extends BaseEntity {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {THREE.Vector3} options.position - Ground point under the dummy
   * @param {number} [options.facing] - Yaw in radians (0 faces -Z)
   */
  constructor(gameWorld, { position, facing = 0 }) {
    super('TrainingDummy');
    this.gameWorld = gameWorld;
    this.physicsWorld = gameWorld.physics;
    this.facing = facing;

    const cfg = config.testing.trainingDummy;
    this.respawnSeconds = cfg.respawnSeconds;
    this.health = new HealthComponent(cfg.maxHealth);
    this.health.onDamage = () => { this._flash = HIT_FLASH_SECONDS; };
    this.health.onDeath = () => {
      this._deadTimer = 0;
      if (this.collider) this.collider.setEnabled(false);
    };
    this._flash = 0;
    this._deadTimer = -1; // >= 0 while knocked down

    // Model: post, straw body, head and a red target on the chest (front = -Z)
    this.mesh = new THREE.Group();
    this.mesh.name = 'TrainingDummy';
    this.mesh.position.copy(position);
    this.mesh.rotation.y = facing;

    this.pivot = new THREE.Group(); // Topples about its base
    this.mesh.add(this.pivot);

    this.bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.95, flatShading: true });
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 1 });
    const targetMaterial = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.7 });

    this._part(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), postMaterial, 0, 0.3, 0);
    this._part(new THREE.CapsuleGeometry(0.34, 0.75, 3, 8), this.bodyMaterial, 0, 1.05, 0);
    this._part(new THREE.SphereGeometry(0.22, 10, 8), this.bodyMaterial, 0, 1.75, 0);
    const target = this._part(new THREE.CircleGeometry(0.16, 16), targetMaterial, 0, 1.2, -0.35);
    target.rotation.y = Math.PI;

    // Physics: one upright cylinder; projectiles and rays find this entity through userData
    const centre = new THREE.Vector3(position.x, position.y + BODY_HALF_HEIGHT, position.z);
    this.collider = this.physicsWorld.createStaticCylinder(BODY_HALF_HEIGHT, BODY_RADIUS, centre);
    if (this.collider) this.collider.userData = { entity: this };
  }

  _part(geometry, material, x, y, z) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.pivot.add(mesh);
    return mesh;
  }

  /**
   * Direction the dummy faces (for backstab checks).
   */
  getForward(out) {
    return out.set(-Math.sin(this.facing), 0, -Math.cos(this.facing));
  }

  /**
   * Phase 5: hit flash, toppling and standing back up.
   */
  gameplayUpdate(delta) {
    if (this._flash > 0) {
      this._flash -= delta;
      this.bodyMaterial.emissive.setRGB(Math.max(0, this._flash / HIT_FLASH_SECONDS) * 0.8, 0, 0);
    }

    if (this._deadTimer >= 0) {
      this._deadTimer += delta;
      this.pivot.rotation.x = Math.min(1, this._deadTimer / FALL_SECONDS) * (Math.PI / 2) * 0.95;
      if (this._deadTimer >= this.respawnSeconds) {
        this._deadTimer = -1;
        this.pivot.rotation.x = 0;
        this.health.reset();
        if (this.collider) this.collider.setEnabled(true);
      }
    }
  }

  dispose() {
    if (this.collider) {
      this.physicsWorld.removeRigidBody(this.collider.rigidBody);
      this.collider = null;
    }
    super.dispose();
  }
}
