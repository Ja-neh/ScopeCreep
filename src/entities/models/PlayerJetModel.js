import * as THREE from 'three';

/**
 * Creates a procedural 3D low-poly placeholder Jet model using Three.js primitives.
 * Grouped under a single THREE.Group so it can be swapped with a GLTF model later.
 */
export function createPlayerJetModel({
  bodyColor = 0x3a404d,
  wingColor = 0x22262e,
  canopyColor = 0x22a6b3
} = {}) {
  const jetGroup = new THREE.Group();

  // Materials
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: bodyColor, // Slate military grey
    roughness: 0.4,
    metalness: 0.6,
  });

  const wingMaterial = new THREE.MeshStandardMaterial({
    color: wingColor, // Darker charcoal for wings
    roughness: 0.5,
    metalness: 0.5,
  });

  const canopyMaterial = new THREE.MeshPhysicalMaterial({
    color: canopyColor, // Tinted cyan cockpit glass
    transparent: true,
    opacity: 0.7,
    roughness: 0.1,
    transmission: 0.6,
  });

  // 1. Fuselage (Main Body)
  const fuselageGeo = new THREE.ConeGeometry(0.8, 4.5, 8);
  const fuselage = new THREE.Mesh(fuselageGeo, bodyMaterial);
  fuselage.rotation.x = Math.PI / 2; // Point cone forward along +Z axis
  jetGroup.add(fuselage);

  // 2. Cockpit Canopy
  const canopyGeo = new THREE.SphereGeometry(0.45, 8, 8);
  const canopy = new THREE.Mesh(canopyGeo, canopyMaterial);
  canopy.scale.set(0.8, 0.7, 1.8);
  canopy.position.set(0, 0.4, 0.3);
  jetGroup.add(canopy);

  // 3. Main Swept Wings
  const wingGeo = new THREE.BoxGeometry(4.5, 0.08, 1.2);
  const wings = new THREE.Mesh(wingGeo, wingMaterial);
  wings.position.set(0, 0, -0.2);
  jetGroup.add(wings);

  // 4. Vertical Tail Fin
  const tailGeo = new THREE.BoxGeometry(0.08, 0.9, 0.8);
  const tail = new THREE.Mesh(tailGeo, wingMaterial);
  tail.position.set(0, 0.6, -1.8);
  jetGroup.add(tail);

  // Enable shadow casting for all child meshes
  jetGroup.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return jetGroup;
}