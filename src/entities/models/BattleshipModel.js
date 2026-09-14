import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * BattleshipModel
 * Loads the imported high-fidelity 3D Battleship model with integrated physics colliders,
 * interactive gun turrets, and operational station areas.
 * All procedural placeholder geometry and procedural box colliders have been removed.
 */

let cachedGLTF = null;

export async function loadBattleshipGLTF(modelUrl = './assets/battleship-and-colliders.glb') {
  if (cachedGLTF) {
    return cachedGLTF;
  }

  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      modelUrl,
      (gltf) => {
        cachedGLTF = gltf;
        resolve(gltf);
      },
      undefined,
      (error) => {
        console.warn(`[BattleshipModel] Failed to load from ${modelUrl}, trying fallback...`, error);
        loader.load(
          '/assets/battleship-and-colliders.glb',
          (gltf2) => {
            cachedGLTF = gltf2;
            resolve(gltf2);
          },
          undefined,
          (err2) => reject(err2)
        );
      }
    );
  });
}

/**
 * Loads and configures the imported battleship model, rigging visual meshes and colliders.
 */
export async function loadBattleshipModel(options = {}) {
  const gltf = await loadBattleshipGLTF(options.modelUrl);

  // Clone scene graph so multiple instances have isolated transforms
  const modelRoot = gltf.scene.clone(true);
  modelRoot.name = 'Battleship_Vessel';

  // In the imported model, bow is along +Z and stern is along -Z.
  // Rotate 180 degrees around Y so bow points along -Z (Three.js standard forward heading).
  modelRoot.rotation.y = Math.PI;
  modelRoot.updateMatrixWorld(true);

  // 1. Hide Operational Areas from rendering and mark with noCollision
  const areasGroup = modelRoot.getObjectByName('Areas');
  if (areasGroup) {
    areasGroup.visible = false;
    areasGroup.traverse((child) => {
      child.userData = { ...child.userData, noCollision: true };
    });
  }

  // 2. Configure visual meshes and separate physics colliders
  const dynamicGunColliders = [];

  modelRoot.traverse((child) => {
    if (child.isMesh) {
      if (child.name.startsWith('Collider_')) {
        child.visible = false; // Never render physics collider meshes
        if (child.name === 'Collider_hull' || child.name === 'Collider_superstructure') {
          // Static ship colliders: ensure noCollision is NOT set so createTrimeshFromObject includes them
          if (child.userData) delete child.userData.noCollision;
        } else {
          // Dynamic gun & barrel colliders:
          // Mark with isGunCollider and noCollision (so static ship trimesh ignores them, and dynamic rig tracks them)
          child.userData = { ...child.userData, isGunCollider: true, noCollision: true };
          dynamicGunColliders.push(child);
        }
      } else {
        // Visual mesh
        child.castShadow = true;
        child.receiveShadow = true;
        // Mark visual mesh with noCollision so physics static trimesh generator ignores visual geometry
        child.userData = { ...child.userData, noCollision: true };

        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => {
              m.roughness = Math.max(0.3, m.roughness ?? 0.5);
            });
          } else {
            child.material.roughness = Math.max(0.3, child.material.roughness ?? 0.5);
          }
        }
      }
    }
  });

  // Extract gun nodes
  const mainGunFront = modelRoot.getObjectByName('MainGunFront');
  const mainGunFrontBarrel = modelRoot.getObjectByName('MainGunFrontBarrel');
  const mainGunBack = modelRoot.getObjectByName('MainGunBack');
  const mainGunBackBarrel = modelRoot.getObjectByName('MainGunBackBarrel');
  const antiAirGun = modelRoot.getObjectByName('AntiAirGun');
  const antiAirBarrels = modelRoot.getObjectByName('AntiAirBarrels');

  // Verify dynamic gun colliders are parented to their respective rotating gun & barrel meshes
  const gunColliderBindings = [
    { colliderName: 'Collider_maingun_front', parentNode: mainGunFront },
    { colliderName: 'Collider_maingun_front_barrels', parentNode: mainGunFrontBarrel },
    { colliderName: 'Collider_maingun_back', parentNode: mainGunBack },
    { colliderName: 'Collider_maingun_back_barrels', parentNode: mainGunBackBarrel },
    { colliderName: 'Collider_antiairgun', parentNode: antiAirGun },
    { colliderName: 'Collider_antiairgun_barrels', parentNode: antiAirBarrels }
  ];

  gunColliderBindings.forEach(({ colliderName, parentNode }) => {
    const colNode = modelRoot.getObjectByName(colliderName);
    if (colNode && parentNode && colNode.parent !== parentNode) {
      parentNode.attach(colNode);
    }
  });

  // Extract station operational positions from Area nodes (with sensible fallbacks)
  function getAreaWorldPos(name, fallback) {
    const node = modelRoot.getObjectByName(name);
    if (node) {
      const pos = new THREE.Vector3();
      node.getWorldPosition(pos);
      return pos;
    }
    return fallback;
  }

  const stations = {
    helmsman: getAreaWorldPos('AreaHelm', new THREE.Vector3(5.47, 5.26, 17.22)),
    artilleryGunner: getAreaWorldPos('AreaMainGunFront', new THREE.Vector3(0.46, 5.30, -17.09)),
    artilleryGunner2: getAreaWorldPos('AreaMainGunBack', new THREE.Vector3(0.46, 6.75, -5.82)),
    flakGunner: getAreaWorldPos('AreaAntiAirGun', new THREE.Vector3(0.46, 5.36, 25.63)),
    engineer: new THREE.Vector3(0, 5.3, 0)
  };

  return {
    root: modelRoot,
    visualGroup: modelRoot.getObjectByName('Battleship') || modelRoot,
    dynamicGunColliders,
    areasGroup,
    stations,
    guns: {
      mainGunFront,
      mainGunFrontBarrel,
      mainGunBack,
      mainGunBackBarrel,
      antiAirGun,
      antiAirBarrels
    }
  };
}
