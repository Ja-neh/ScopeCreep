import * as THREE from 'three';

/** A lightweight, reusable landing craft for the campaign handoff. */
export class SquadTransport {
  constructor(parent, position) {
    this.mesh = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(3, 8, 6, 12), new THREE.MeshStandardMaterial({ color: 0x344c58, metalness: 0.7, roughness: 0.33 }));
    hull.rotation.x = Math.PI / 2;
    this.mesh.add(hull);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 8), new THREE.MeshStandardMaterial({ color: 0x142f42, metalness: 0.5, roughness: 0.2, emissive: 0x072337 }));
    canopy.scale.set(1, 0.55, 1.5);
    canopy.position.set(0, 1.45, -1);
    this.mesh.add(canopy);
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(8, 0.28, 3.8), new THREE.MeshStandardMaterial({ color: 0x425b66, metalness: 0.75, roughness: 0.35 }));
      wing.position.set(side * 4.5, -0.1, 1);
      wing.rotation.y = side * 0.16;
      this.mesh.add(wing);
      const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 2.3, 12), new THREE.MeshStandardMaterial({ color: 0x29424e, metalness: 0.8, roughness: 0.3 }));
      thruster.rotation.x = Math.PI / 2;
      thruster.position.set(side * 4.5, -0.25, 2.4);
      this.mesh.add(thruster);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 16), new THREE.MeshBasicMaterial({ color: 0x6de9ff, side: THREE.DoubleSide }));
      glow.position.set(side * 4.5, -0.25, 3.6);
      this.mesh.add(glow);
    }
    this.mesh.position.copy(position);
    parent.add(this.mesh);
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.traverse((node) => {
      node.geometry?.dispose();
      node.material?.dispose();
    });
  }
}
