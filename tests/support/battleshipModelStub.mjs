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

  return { root, visualGroup: root, dynamicGunColliders: [], areasGroup: null, stations: {}, guns: {} };
}
