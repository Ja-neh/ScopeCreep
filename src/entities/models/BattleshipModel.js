import * as THREE from 'three';

/**
 * BattleshipModel
 * Procedural 3D model builder for the modern guided-missile destroyer in ScopeCreep.
 * Assembles:
 * - Angular wave-cutting hull and transom stern
 * - Visual deck plating and anti-tunneling deep deck collider slabs
 * - Bridge superstructure, wheelhouse, tinted windows, and radar mast
 * - Bridge access stairs and solid ramp collision slabs
 * - Midship citadel and glowing reactor core
 * - Starboard boarding ramp / gangway
 */
export function createBattleshipModel(stations = {}) {
  const mesh = new THREE.Group();
  mesh.name = 'Battleship_Vessel';

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x3d4a58, // Naval slate grey
    roughness: 0.7,
    metalness: 0.2,
    flatShading: true
  });

  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x222c36, // Charcoal steel deck
    roughness: 0.8,
    flatShading: true
  });

  const bridgeMat = new THREE.MeshStandardMaterial({
    color: 0x5a6d7c, // Superstructure steel
    roughness: 0.6,
    flatShading: true
  });

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x81c3d7, // Tinted observation windows
    roughness: 0.1,
    metalness: 0.8,
    flatShading: true
  });

  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xe76f51, // Safety orange accent
    roughness: 0.4,
    flatShading: true
  });

  // -------------------------------------------------------------
  // A. MAIN HULL
  // -------------------------------------------------------------
  const hullGroup = new THREE.Group();
  hullGroup.name = 'Hull_Assembly';

  // Midship block
  const midHullGeo = new THREE.BoxGeometry(14, 4.5, 45);
  const midHull = new THREE.Mesh(midHullGeo, hullMat);
  midHull.position.y = 2.25;
  midHull.castShadow = true;
  midHull.receiveShadow = true;
  hullGroup.add(midHull);

  // Bow (Wave-cutting angled prow)
  const bowGeo = new THREE.ConeGeometry(7, 18, 4);
  const bow = new THREE.Mesh(bowGeo, hullMat);
  bow.position.set(0, 2.25, -31.5);
  bow.rotation.x = -Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.scale.set(1.4, 1.0, 0.65);
  bow.castShadow = true;
  bow.receiveShadow = true;
  hullGroup.add(bow);

  // Stern (Transom)
  const sternGeo = new THREE.BoxGeometry(12, 4.5, 12);
  const stern = new THREE.Mesh(sternGeo, hullMat);
  stern.position.set(0, 2.25, 28);
  stern.castShadow = true;
  stern.receiveShadow = true;
  hullGroup.add(stern);

  // Main walking deck plating (visual surface)
  const deckGeo = new THREE.BoxGeometry(13.6, 0.4, 68);
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.y = 4.6;
  deck.receiveShadow = true;
  deck.userData = { noCollision: true }; // Physics handled by solid deep deck slab below
  hullGroup.add(deck);

  // Solid deep walking deck collider slab (prevents tunneling through floor)
  // Top face at y = 4.8 (matches visual deck), bottom face at y = 1.3 (3.5m thickness)
  const solidDeckColliderGeo = new THREE.BoxGeometry(13.6, 3.5, 68);
  const solidDeckColliderMesh = new THREE.Mesh(solidDeckColliderGeo);
  solidDeckColliderMesh.position.y = 3.05; // 4.8 - 3.5 / 2
  solidDeckColliderMesh.visible = false;
  hullGroup.add(solidDeckColliderMesh);

  mesh.add(hullGroup);

  // -------------------------------------------------------------
  // B. SUPERSTRUCTURE & HELMSMAN BRIDGE
  // -------------------------------------------------------------
  const bridgeGroup = new THREE.Group();
  bridgeGroup.name = 'Bridge_Assembly';
  bridgeGroup.position.set(0, 4.8, -4);

  // Command deck base
  const bridgeBaseGeo = new THREE.BoxGeometry(10, 3.2, 18);
  const bridgeBase = new THREE.Mesh(bridgeBaseGeo, bridgeMat);
  bridgeBase.position.y = 1.6;
  bridgeBase.castShadow = true;
  bridgeBase.receiveShadow = true;
  bridgeGroup.add(bridgeBase);

  // Wheelhouse
  const wheelhouseGeo = new THREE.BoxGeometry(8, 2.5, 9);
  const wheelhouse = new THREE.Mesh(wheelhouseGeo, bridgeMat);
  wheelhouse.position.set(0, 4.4, -2);
  wheelhouse.castShadow = true;
  bridgeGroup.add(wheelhouse);

  // Window band
  const windowBandGeo = new THREE.BoxGeometry(8.2, 0.8, 5);
  const windowBand = new THREE.Mesh(windowBandGeo, glassMat);
  windowBand.position.set(0, 4.8, -4);
  bridgeGroup.add(windowBand);

  // Radar Mast
  const mastGeo = new THREE.CylinderGeometry(0.3, 0.5, 7, 6);
  const mast = new THREE.Mesh(mastGeo, hullMat);
  mast.position.set(0, 9.0, 1);
  mast.castShadow = true;
  bridgeGroup.add(mast);

  // Radar dish
  const radarGeo = new THREE.BoxGeometry(3.5, 0.8, 0.4);
  const radar = new THREE.Mesh(radarGeo, accentMat);
  radar.position.set(0, 11.8, 1);
  bridgeGroup.add(radar);

  // Bridge Forward Access Stairs (visual surface)
  const stairsGeo = new THREE.BoxGeometry(4.5, 0.4, 6.0);
  const stairs = new THREE.Mesh(stairsGeo, deckMat);
  stairs.position.set(0, 1.5, -11.5);
  stairs.rotation.x = 0.52; // Smooth ramp up to bridge observation deck
  stairs.castShadow = true;
  stairs.receiveShadow = true;
  stairs.userData = { noCollision: true };
  bridgeGroup.add(stairs);

  // Deepened solid stairs collider ramp (1.5m thick to prevent ramp tunneling)
  const stairsColliderGeo = new THREE.BoxGeometry(4.5, 1.5, 6.0);
  const stairsColliderMesh = new THREE.Mesh(stairsColliderGeo);
  stairsColliderMesh.position.set(0, 1.5 - 0.55 * Math.cos(0.52), -11.5 - 0.55 * Math.sin(0.52));
  stairsColliderMesh.rotation.x = 0.52;
  stairsColliderMesh.visible = false;
  bridgeGroup.add(stairsColliderMesh);

  mesh.add(bridgeGroup);

  // -------------------------------------------------------------
  // C. MIDSHIP CITADEL (Reactor & Damage Control)
  // -------------------------------------------------------------
  const citadelGroup = new THREE.Group();
  citadelGroup.name = 'Citadel_Assembly';
  if (stations.engineer) {
    citadelGroup.position.copy(stations.engineer);
  } else {
    citadelGroup.position.set(0, 3.2, 3);
  }

  const casingGeo = new THREE.BoxGeometry(7.5, 2.4, 6.5);
  const casing = new THREE.Mesh(casingGeo, bridgeMat);
  casing.position.y = 2.4;
  casing.castShadow = true;
  casing.receiveShadow = true;
  citadelGroup.add(casing);

  // Glowing shield power reactor
  const coreGeo = new THREE.CylinderGeometry(1.6, 1.6, 2.6, 12);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x48cae4,
    emissive: 0x0077b6,
    emissiveIntensity: 0.8,
    roughness: 0.2,
    flatShading: true
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.y = 2.4;
  citadelGroup.add(core);

  mesh.add(citadelGroup);

  // -------------------------------------------------------------
  // D. BOARDING RAMP / GANGWAY (Starboard side)
  // -------------------------------------------------------------
  const rampGroup = new THREE.Group();
  rampGroup.name = 'Gangway_Assembly';
  rampGroup.position.set(9.5, 2.3, 0);
  const rampGeo = new THREE.BoxGeometry(4, 0.4, 18);
  const ramp = new THREE.Mesh(rampGeo, deckMat);
  ramp.rotation.x = 0.27;
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  rampGroup.add(ramp);
  mesh.add(rampGroup);

  return mesh;
}
