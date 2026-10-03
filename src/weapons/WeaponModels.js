import * as THREE from 'three';

/**
 * WeaponModels
 * Procedural low-poly machine gun and combat knife, visual only. Each model points along -Z
 * with its grip at the origin. Share one materials set between all copies of the models.
 */

export function createWeaponMaterials() {
  return {
    gunmetal: new THREE.MeshStandardMaterial({ color: 0x2e3237, roughness: 0.45, metalness: 0.6 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x3b3f2f, roughness: 0.8, metalness: 0.1 }),
    blade: new THREE.MeshStandardMaterial({ color: 0xc9d0d6, roughness: 0.25, metalness: 0.9 })
  };
}

function part(parent, geometry, material, x, y, z) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/**
 * Machine gun: receiver, barrel, handguard, stock, magazine, grip and sight.
 * @returns {{ mesh: THREE.Group, muzzle: THREE.Object3D }} `muzzle` marks the barrel tip
 */
export function createRifleModel(materials) {
  const mesh = new THREE.Group();
  mesh.name = 'Rifle';

  part(mesh, new THREE.BoxGeometry(0.08, 0.12, 0.5), materials.gunmetal, 0, 0, -0.1);
  const barrelGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.45, 8);
  barrelGeo.rotateX(Math.PI / 2);
  part(mesh, barrelGeo, materials.gunmetal, 0, 0.02, -0.57);
  part(mesh, new THREE.BoxGeometry(0.07, 0.08, 0.3), materials.polymer, 0, 0.0, -0.45);
  part(mesh, new THREE.BoxGeometry(0.06, 0.12, 0.28), materials.polymer, 0, -0.02, 0.28);
  const magazine = part(mesh, new THREE.BoxGeometry(0.05, 0.18, 0.09), materials.gunmetal, 0, -0.14, -0.14);
  magazine.rotation.x = -0.2;
  const grip = part(mesh, new THREE.BoxGeometry(0.04, 0.12, 0.05), materials.polymer, 0, -0.1, 0.06);
  grip.rotation.x = 0.3;
  part(mesh, new THREE.BoxGeometry(0.03, 0.04, 0.12), materials.gunmetal, 0, 0.08, -0.12);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.82);
  mesh.add(muzzle);

  return { mesh, muzzle };
}

/**
 * Combat knife: handle, guard and a tapered blade.
 * @returns {{ mesh: THREE.Group }}
 */
export function createKnifeModel(materials) {
  const mesh = new THREE.Group();
  mesh.name = 'Knife';

  part(mesh, new THREE.BoxGeometry(0.03, 0.035, 0.12), materials.polymer, 0, 0, 0);
  part(mesh, new THREE.BoxGeometry(0.075, 0.015, 0.02), materials.gunmetal, 0, 0, -0.07);
  const bladeGeo = new THREE.ConeGeometry(0.022, 0.22, 4);
  bladeGeo.rotateX(-Math.PI / 2);
  bladeGeo.scale(0.3, 1, 1);
  part(mesh, bladeGeo, materials.blade, 0, 0, -0.19);

  return { mesh };
}

/**
 * Frees the geometries of a model built here (materials are shared and freed by their owner).
 */
export function disposeModelGeometry(mesh) {
  mesh.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
  });
  if (mesh.parent) mesh.parent.remove(mesh);
}
