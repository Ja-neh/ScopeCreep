import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _color = new THREE.Color();

/**
 * Replaces the meshes directly inside `group` with at most two merged meshes: one for solid
 * parts (lit, `solidMaterial`) and one for glowing parts (`glowMaterial`), carrying each part's
 * colour as vertex colours. Child groups (jointed limbs) are left alone, so call it once per
 * rigid group. Cuts a procedural model's draw calls (and shadow draws) to one or two per group.
 *
 * A part glows if its material has a non-black emissive colour; its vertex colour is then the
 * emissive colour times its intensity. The original part geometries are disposed (materials
 * are left to their owner).
 *
 * @param {THREE.Object3D} group
 * @param {THREE.Material} solidMaterial - Should have `vertexColors: true`
 * @param {THREE.Material} glowMaterial - Should have `vertexColors: true` (e.g. MeshBasicMaterial)
 * @returns {THREE.Mesh[]} The merged meshes added to the group
 */
export function consolidateMeshes(group, solidMaterial, glowMaterial) {
  const parts = { solid: [], glow: [] };
  const originals = [];

  for (const child of group.children) {
    if (!child.isMesh) continue;
    originals.push(child);

    const material = child.material;
    const glows = material.emissive && material.emissiveIntensity > 0 && material.emissive.getHex() !== 0;
    if (glows) _color.copy(material.emissive).multiplyScalar(material.emissiveIntensity);
    else _color.copy(material.color);

    // Bake the part's placement into a copy of its geometry, with only the attributes all share
    child.updateMatrix();
    const source = child.geometry;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', source.getAttribute('position').clone());
    geometry.setAttribute('normal', source.getAttribute('normal').clone());
    if (source.index) geometry.setIndex(source.index.clone());
    geometry.applyMatrix4(child.matrix);

    const count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = _color.r;
      colors[i * 3 + 1] = _color.g;
      colors[i * 3 + 2] = _color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    (glows ? parts.glow : parts.solid).push(geometry);
  }

  for (const original of originals) {
    group.remove(original);
    original.geometry.dispose();
  }

  const merged = [];
  for (const [kind, geometries] of Object.entries(parts)) {
    if (geometries.length === 0) continue;
    // mergeGeometries needs all parts indexed or none (icosahedra are not)
    const uniform = geometries.every((g) => g.index) ? geometries : geometries.map((g) => (g.index ? g.toNonIndexed() : g));
    const geometry = mergeGeometries(uniform, false);
    for (const g of new Set([...geometries, ...uniform])) g.dispose();
    const mesh = new THREE.Mesh(geometry, kind === 'glow' ? glowMaterial : solidMaterial);
    mesh.name = `${group.name || 'Part'}_${kind}`;
    group.add(mesh);
    merged.push(mesh);
  }
  return merged;
}
