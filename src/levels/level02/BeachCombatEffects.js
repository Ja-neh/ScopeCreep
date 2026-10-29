import * as THREE from 'three';

/** Bounded blood droplets in world space; no damage, listeners or persistent decals. */
export class BeachCombatEffects {
  constructor(world, player) {
    this.world = world;
    this.player = player;
    this.direction = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.geometry = new THREE.IcosahedronGeometry(0.025, 0);
    this.material = new THREE.MeshBasicMaterial({ color: 0x861b20 });
    this.group = new THREE.Group();
    this.group.name = 'Level02_Blood';
    this.drops = Array.from({ length: 48 }, () => {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.visible = false;
      this.group.add(mesh);
      return { mesh, velocity: new THREE.Vector3(), life: 0 };
    });
    this.cursor = 0;
    world.effectsGroup.add(this.group);
  }
  hit(info) {
    const p = this.player.position;
    const source = info?.source?.position;
    this.direction.set(0, 0, 0);
    let side = 'centre';
    if (source) {
      this.direction.subVectors(source, p).normalize();
      this.right.set(1, 0, 0).applyQuaternion(this.world.camera.quaternion);
      side = this.direction.dot(this.right) > 0 ? 'right' : 'left';
    }
    this.world.ui?.flashBlood?.(side);
    for (let i = 0; i < 12; i++) {
      const drop = this.drops[this.cursor++ % this.drops.length];
      drop.life = 0.35 + Math.random() * 0.25;
      drop.mesh.position.copy(p);
      drop.mesh.position.y += 1.1 * (1 - 0.35 * this.player.crouchAmount);
      drop.velocity.set((Math.random() - 0.5) * 2 - this.direction.x,
        Math.random() * 1.5, (Math.random() - 0.5) * 2 - this.direction.z);
      drop.mesh.scale.set(0.6, 1.8, 0.6);
      drop.mesh.visible = true;
    }
  }
  update(delta) {
    for (const drop of this.drops) {
      if (drop.life <= 0) continue;
      drop.life -= delta;
      drop.velocity.y -= 5 * delta;
      drop.mesh.position.addScaledVector(drop.velocity, delta);
      drop.mesh.visible = drop.life > 0;
    }
  }
  dispose() {
    this.geometry.dispose(); this.material.dispose(); this.group.removeFromParent();
  }
}
