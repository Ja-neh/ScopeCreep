// Test stand-in for src/entities/models/BattleshipModel.js: builds the hull and superstructure
// collider meshes straight from the GLB's binary data (positions, indices, node transforms),
// with the same 180-degree turn the real loader applies. No visuals, guns or station areas.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const GLB_PATH = fileURLToPath(new URL('../../public/assets/battleship-and-colliders.glb', import.meta.url));
let cached = null;

function readGlb() {
  const bytes = fs.readFileSync(GLB_PATH);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binStart = 20 + jsonLength + 8;

  const parentOf = {};
  json.nodes.forEach((node, i) => (node.children || []).forEach((child) => { parentOf[child] = i; }));

  const localMatrix = (node) => (node.matrix
    ? new THREE.Matrix4().fromArray(node.matrix)
    : new THREE.Matrix4().compose(
      new THREE.Vector3(...(node.translation || [0, 0, 0])),
      new THREE.Quaternion(...(node.rotation || [0, 0, 0, 1])),
      new THREE.Vector3(...(node.scale || [1, 1, 1]))
    ));
  const worldMatrix = (index) => {
    let matrix = localMatrix(json.nodes[index]);
    for (let p = parentOf[index]; p !== undefined; p = parentOf[p]) {
      matrix = localMatrix(json.nodes[p]).multiply(matrix);
    }
    return matrix;
  };
  const readAccessor = (index) => {
    const accessor = json.accessors[index];
    const view = json.bufferViews[accessor.bufferView];
    const offset = bytes.byteOffset + binStart + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const count = accessor.count * (accessor.type === 'VEC3' ? 3 : 1);
    if (accessor.componentType === 5126) return new Float32Array(bytes.buffer.slice(offset, offset + count * 4));
    if (accessor.componentType === 5123) return Uint32Array.from(new Uint16Array(bytes.buffer.slice(offset, offset + count * 2)));
    return new Uint32Array(bytes.buffer.slice(offset, offset + count * 4));
  };

  const meshes = [];
  for (const name of ['Collider_hull', 'Collider_superstructure']) {
    const nodeIndex = json.nodes.findIndex((node) => node.name === name);
    for (const primitive of json.meshes[json.nodes[nodeIndex].mesh].primitives) {
      meshes.push({
        name,
        positions: readAccessor(primitive.attributes.POSITION),
        indices: readAccessor(primitive.indices),
        matrix: worldMatrix(nodeIndex)
      });
    }
  }
  return meshes;
}

export async function loadBattleshipGLTF() {
  if (!cached) cached = readGlb();
  return cached;
}

export async function loadBattleshipModel() {
  const meshes = await loadBattleshipGLTF();
  const root = new THREE.Group();
  root.name = 'Battleship_Vessel';
  root.rotation.y = Math.PI;

  for (const data of meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions.slice(), 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices.slice(), 1));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.name = data.name;
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(data.matrix);
    root.add(mesh);
  }

  const areasGroup = new THREE.Group();
  areasGroup.name = 'Areas';
  const areaFront = new THREE.Object3D();
  areaFront.name = 'AreaFront';
  areaFront.position.set(-1.340257, 5.303711, 37.034672);
  areasGroup.add(areaFront);
  root.add(areasGroup);

  const areas = {
    AreaFront: new THREE.Vector3(1.34, 5.30, -37.03),
    AreaBack: new THREE.Vector3(5.32, 5.36, 34.93),
    AreaHelm: new THREE.Vector3(5.47, 5.26, 17.22),
    AreaAntiAirGun: new THREE.Vector3(0.46, 5.36, 25.63),
    AreaMainGunFront: new THREE.Vector3(0.46, 5.30, -17.09),
    AreaMainGunBack: new THREE.Vector3(0.46, 6.75, -5.82)
  };

  const mainGunFront = new THREE.Group();
  mainGunFront.name = 'MainGunFront';
  const mainGunFrontBarrel = new THREE.Group();
  mainGunFrontBarrel.name = 'MainGunFrontBarrel';
  const spawnMF1 = new THREE.Object3D();
  spawnMF1.name = 'ProjectileSpawnMF1';
  spawnMF1.position.set(-0.873, -0.222, 6.47);
  const spawnMF2 = new THREE.Object3D();
  spawnMF2.name = 'ProjectileSpawnMF2';
  spawnMF2.position.set(0.905, -0.222, 6.47);
  mainGunFrontBarrel.add(spawnMF1, spawnMF2);
  mainGunFront.add(mainGunFrontBarrel);
  root.add(mainGunFront);

  const mainGunBack = new THREE.Group();
  mainGunBack.name = 'MainGunBack';
  const mainGunBackBarrel = new THREE.Group();
  mainGunBackBarrel.name = 'MainGunBackBarrel';
  const spawnMB1 = new THREE.Object3D();
  spawnMB1.name = 'ProjectileSpawnMB1';
  spawnMB1.position.set(-0.869, -0.233, 6.51);
  const spawnMB2 = new THREE.Object3D();
  spawnMB2.name = 'ProjectileSpawnMB2';
  spawnMB2.position.set(0.902, -0.233, 6.51);
  mainGunBackBarrel.add(spawnMB1, spawnMB2);
  mainGunBack.add(mainGunBackBarrel);
  root.add(mainGunBack);

  const antiAirGun = new THREE.Group();
  antiAirGun.name = 'AntiAirGun';
  const antiAirBarrels = new THREE.Group();
  antiAirBarrels.name = 'AntiAirBarrels';
  const spawnAA1 = new THREE.Object3D();
  spawnAA1.name = 'ProjectileSpawnAA1';
  spawnAA1.position.set(-0.493, 0.979, -5.19);
  const spawnAA2 = new THREE.Object3D();
  spawnAA2.name = 'ProjectileSpawnAA2';
  spawnAA2.position.set(-0.493, 0.073, -5.19);
  const spawnAA3 = new THREE.Object3D();
  spawnAA3.name = 'ProjectileSpawnAA3';
  spawnAA3.position.set(0.529, 0.979, -5.19);
  const spawnAA4 = new THREE.Object3D();
  spawnAA4.name = 'ProjectileSpawnAA4';
  spawnAA4.position.set(0.529, 0.073, -5.19);
  antiAirBarrels.add(spawnAA1, spawnAA2, spawnAA3, spawnAA4);
  antiAirGun.add(antiAirBarrels);
  root.add(antiAirGun);

  const guns = {
    mainGunFront,
    mainGunFrontBarrel,
    mainGunBack,
    mainGunBackBarrel,
    antiAirGun,
    antiAirBarrels
  };

  return {
    root,
    visualGroup: root,
    dynamicGunColliders: [],
    areasGroup,
    areas,
    stations: {
      helmsman: areas.AreaHelm,
      artilleryGunner: areas.AreaMainGunFront,
      artilleryGunner2: areas.AreaMainGunBack,
      flakGunner: areas.AreaAntiAirGun
    },
    guns
  };
}
