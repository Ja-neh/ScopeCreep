import * as THREE from 'three';

// The brig's clear floor between its two rows of sleeping pods. Shared by the
// playable Level 1 and its opening, so the same people occupy the same cells.
export const BRIG_PLAYER = [19, 0.08, -49];
export const BRIG_CAPTIVES = [[12, 0.08, -46], [15, 0.08, -46], [18, 0.08, -46], [21, 0.08, -46], [9, 0.08, -46]];

export function createCaptiveCell() {
  const group = new THREE.Group();
  const geometry = new THREE.CylinderGeometry(.9, .9, 2.7, 24, 1, true);
  const material = new THREE.MeshBasicMaterial({ color: 0x76e9ac, transparent: true,
    opacity: .14, side: THREE.DoubleSide, depthWrite: false });
  const cage = new THREE.Mesh(geometry, material);
  cage.position.y = 1.35;
  group.add(cage);
  const rimGeometry = new THREE.TorusGeometry(.9, .045, 6, 24);
  const rimMaterial = new THREE.MeshStandardMaterial({ color: 0x2d9c76, emissive: 0x49ff9c, emissiveIntensity: 2 });
  for (const y of [.05, 2.7]) {
    const rim = new THREE.Mesh(rimGeometry, rimMaterial);
    rim.rotation.x = Math.PI / 2; rim.position.y = y; group.add(rim);
  }
  return { group, cage, geometry, material, dispose() {
    geometry.dispose(); material.dispose(); rimGeometry.dispose(); rimMaterial.dispose();
  } };
}
