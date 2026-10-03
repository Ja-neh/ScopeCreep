import * as THREE from 'three';

const PILLAR_HEIGHT = 40;

/**
 * ObjectiveBeacon
 * A tall, softly pulsing column of green light with a ring on the ground, marking where the
 * player must go. Visual only; the level checks the distance.
 */
export class ObjectiveBeacon {
  /**
   * @param {THREE.Vector3} position - Ground point
   * @param {number} radius - Radius of the ground ring (the arrival distance)
   */
  constructor(position, radius) {
    this.mesh = new THREE.Group();
    this.mesh.name = 'ObjectiveBeacon';
    this.mesh.position.copy(position);
    this.mesh.visible = false;

    this.pillarMaterial = new THREE.MeshBasicMaterial({
      color: 0x6dff8f,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, PILLAR_HEIGHT, 16, 1, true), this.pillarMaterial);
    pillar.position.y = PILLAR_HEIGHT / 2;
    this.mesh.add(pillar);

    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x6dff8f,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    const ringGeometry = new THREE.RingGeometry(radius - 0.5, radius, 48);
    ringGeometry.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeometry, this.ringMaterial);
    ring.position.y = 0.2;
    this.mesh.add(ring);

    this._time = 0;
  }

  setVisible(visible) {
    this.mesh.visible = visible;
  }

  /**
   * Pulses the light. Call once per frame.
   */
  update(delta) {
    if (!this.mesh.visible) return;
    this._time += delta;
    const pulse = 0.5 + 0.5 * Math.sin(this._time * 3);
    this.pillarMaterial.opacity = 0.18 + pulse * 0.17;
    this.ringMaterial.opacity = 0.45 + pulse * 0.3;
  }

  dispose() {
    this.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
    });
    this.pillarMaterial.dispose();
    this.ringMaterial.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}
