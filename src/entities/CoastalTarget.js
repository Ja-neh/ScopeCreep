import * as THREE from 'three';
import { BaseEntity } from './BaseEntity.js';
import { HealthComponent } from './components/HealthComponent.js';
import config from '../config.json';

/**
 * A destructible enemy installation or vessel for the air-strike mission.
 */
export class CoastalTarget extends BaseEntity {
  constructor(gameWorld, { kind, name, position }) {
    super(name);
    this.gameWorld = gameWorld;
    this.faction = 'aliens';
    this.kind = kind;
    this.isDestroyed = false;
    this.health = new HealthComponent(config.airStrike.targetHealth);
    this.materials = {
      concrete: new THREE.MeshStandardMaterial({ color: 0x777b74, roughness: 0.9 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x46515a, roughness: 0.6, metalness: 0.35 }),
      hostile: new THREE.MeshStandardMaterial({ color: 0x9b3d2e, roughness: 0.7 }),
      deck: new THREE.MeshStandardMaterial({ color: 0x5e6955, roughness: 0.95 })
    };
    this.mesh = new THREE.Group();
    this.mesh.name = name;
    this.mesh.position.copy(position);
    this.mesh.userData.entity = this;
    this.collider = null;

    if (kind === 'ship') this._buildShip();
    else this._buildInstallation(kind);

    this.collider = gameWorld.physics.createStaticBox(
      this._colliderHalfExtents,
      this._colliderPosition,
      this.mesh.quaternion
    );
    if (this.collider) this.collider.userData = { entity: this };

    this.health.onDeath = () => {
      this.isDestroyed = true;
      this.mesh.visible = false;
      if (this.collider) this.collider.setEnabled(false);
    };
  }

  _addBox(size, material, x, y, z) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size[0], size[1], size[2]),
      material
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.mesh.add(mesh);
    return mesh;
  }

  _buildShip() {
    this._addBox([18, 4, 42], this.materials.hostile, 0, 2.2, 0);
    this._addBox([10, 5, 12], this.materials.concrete, 0, 6.5, -4);
    this._addBox([5, 2, 5], this.materials.metal, 0, 10, -4);
    this._addBox([5, 1.2, 7], this.materials.deck, 0, 4.8, 9);
    this._colliderHalfExtents = { x: 10, y: 6, z: 22 };
    this._colliderPosition = { x: this.mesh.position.x, y: this.mesh.position.y + 5, z: this.mesh.position.z };
  }

  _buildInstallation(kind) {
    this._addBox([20, 2, 20], this.materials.concrete, 0, 1, 0);
    if (kind === 'radar') {
      this._addBox([9, 8, 9], this.materials.hostile, 0, 6, 0);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 8, 8), this.materials.metal);
      mast.position.set(0, 14, 0);
      mast.castShadow = true;
      this.mesh.add(mast);
      const dish = new THREE.Mesh(new THREE.SphereGeometry(3.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.materials.metal);
      dish.position.set(0, 17, 0);
      dish.castShadow = true;
      this.mesh.add(dish);
      this._colliderHalfExtents = { x: 10, y: 10, z: 10 };
      this._colliderPosition = { x: this.mesh.position.x, y: this.mesh.position.y + 10, z: this.mesh.position.z };
    } else if (kind === 'fuel') {
      for (const x of [-5, 5]) {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 9, 10), this.materials.hostile);
        tank.position.set(x, 6.5, 0);
        tank.castShadow = true;
        tank.receiveShadow = true;
        this.mesh.add(tank);
      }
      this._colliderHalfExtents = { x: 10, y: 6, z: 10 };
      this._colliderPosition = { x: this.mesh.position.x, y: this.mesh.position.y + 6, z: this.mesh.position.z };
    } else {
      this._addBox([12, 5, 12], this.materials.hostile, 0, 4.5, 0);
      this._addBox([8, 2, 4], this.materials.metal, 0, 8, 2);
      this._colliderHalfExtents = { x: 10, y: 5, z: 10 };
      this._colliderPosition = { x: this.mesh.position.x, y: this.mesh.position.y + 5, z: this.mesh.position.z };
    }
  }

  dispose() {
    if (this.collider) {
      this.gameWorld.physics.removeRigidBody(this.collider.rigidBody);
      this.collider = null;
    }
    super.dispose();
  }
}
