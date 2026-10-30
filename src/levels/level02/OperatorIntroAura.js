import * as THREE from 'three';
import { BaseEntity } from '../../entities/BaseEntity.js';

/** Short-lived, restrained energy rim for the operator reveal at the start of Level 2. */
export class OperatorIntroAura extends BaseEntity {
  constructor(actors, duration = 10) {
    super('OperatorIntroAura');
    this.duration = duration;
    this.elapsed = 0;
    this.anchors = [];
    this.geometry = new THREE.TorusGeometry(1, 0.025, 8, 48);

    actors.forEach((actor, index) => {
      if (!actor?.mesh) return;
      const tint = index % 2 ? 0xffc477 : 0x6be7dd;
      const material = new THREE.MeshBasicMaterial({
        color: tint,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const aura = new THREE.Group();
      aura.name = `OperatorAura_${actor.name || index}`;
      const groundRing = new THREE.Mesh(this.geometry, material);
      groundRing.rotation.x = -Math.PI / 2;
      groundRing.scale.setScalar(0.72);
      groundRing.position.y = 0.07;
      const bodyHalo = new THREE.Mesh(this.geometry, material);
      bodyHalo.scale.set(0.62, 1.18, 1);
      bodyHalo.position.set(0, 1.08, 0.18);
      aura.add(groundRing, bodyHalo);
      actor.mesh.add(aura);
      this.anchors.push({ actor, aura, material, phase: index * 0.8 });
    });
  }

  lateUpdate(delta) {
    this.elapsed += delta;
    const remaining = THREE.MathUtils.clamp((this.duration - this.elapsed) / 1.8, 0, 1);
    for (const anchor of this.anchors) {
      const pulse = 0.72 + Math.sin(this.elapsed * 3.2 + anchor.phase) * 0.18;
      anchor.material.opacity = 0.3 * pulse * remaining;
      anchor.aura.rotation.y += delta * 0.18;
    }
  }

  dispose() {
    for (const anchor of this.anchors) {
      anchor.actor.mesh?.remove(anchor.aura);
      anchor.material.dispose();
    }
    this.geometry.dispose();
    this.anchors.length = 0;
  }
}
