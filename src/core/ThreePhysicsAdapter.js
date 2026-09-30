import * as THREE from 'three';

/**
 * ThreePhysicsAdapter
 * Utility functions for extracting raw geometric data (vertices & indices)
 * from Three.js scene graphs for consumption by physics engines (Rapier3D).
 */

/**
 * Extracts combined vertex and index buffers from an Object3D hierarchy in the root's local space.
 * Filters out degenerate zero-area triangles and ignores nodes marked with userData.noCollision.
 * @param {THREE.Object3D} object3d - The root object hierarchy to traverse
 * @returns {{ vertices: Float32Array, indices: Uint32Array } | null}
 */
export function extractTrimeshGeometryFromObject(object3d) {
  if (!object3d) return null;
  object3d.updateMatrixWorld(true);

  const vertices = [];
  const indices = [];
  const vertMap = new Map();

  // Inverse of root object's world matrix to convert child vertices into object3d's LOCAL coordinate frame
  const rootInverse = new THREE.Matrix4().copy(object3d.matrixWorld).invert();

  object3d.traverse((child) => {
    // Skip meshes or hierarchies marked as noCollision (e.g. trigger fields, visual markers)
    let curr = child;
    let ignore = false;
    while (curr) {
      if (curr.userData && curr.userData.noCollision) {
        ignore = true;
        break;
      }
      if (curr === object3d) break;
      curr = curr.parent;
    }
    if (ignore) return;

    if (child.isMesh && child.geometry) {
      const geom = child.geometry;
      const positionAttr = geom.getAttribute('position');
      if (!positionAttr) return;

      // Transform vertices to root object's LOCAL space
      const localToRoot = new THREE.Matrix4().multiplyMatrices(rootInverse, child.matrixWorld);

      const childVerts = [];
      for (let i = 0; i < positionAttr.count; i++) {
        const v = new THREE.Vector3(
          positionAttr.getX(i),
          positionAttr.getY(i),
          positionAttr.getZ(i)
        );
        v.applyMatrix4(localToRoot);
        childVerts.push(v);
      }

      const count = geom.index ? geom.index.count : positionAttr.count;
      for (let i = 0; i < count; i += 3) {
        const i0 = geom.index ? geom.index.getX(i) : i;
        const i1 = geom.index ? geom.index.getX(i + 1) : i + 1;
        const i2 = geom.index ? geom.index.getX(i + 2) : i + 2;
        if (i0 === i1 || i1 === i2 || i0 === i2) continue;

        const v0 = childVerts[i0];
        const v1 = childVerts[i1];
        const v2 = childVerts[i2];
        if (!v0 || !v1 || !v2) continue;

        // Filter degenerate zero-area triangles
        const cross = new THREE.Vector3().crossVectors(
          new THREE.Vector3().subVectors(v1, v0),
          new THREE.Vector3().subVectors(v2, v0)
        );
        if (cross.lengthSq() < 1e-8) continue;

        function getOrAddVert(v) {
          const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
          if (vertMap.has(key)) return vertMap.get(key);
          const newIdx = vertices.length / 3;
          vertices.push(v.x, v.y, v.z);
          vertMap.set(key, newIdx);
          return newIdx;
        }

        indices.push(getOrAddVert(v0), getOrAddVert(v1), getOrAddVert(v2));
      }
    }
  });

  if (vertices.length === 0 || indices.length === 0) {
    return null;
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices)
  };
}

/**
 * Extracts vertex and index buffers from a single Three.js Mesh.
 * @param {THREE.Mesh} mesh
 * @returns {{ vertices: Float32Array, indices: Uint32Array } | null}
 */
export function extractMeshGeometry(mesh) {
  if (!mesh || !mesh.geometry) return null;
  const geom = mesh.geometry;
  const posAttr = geom.getAttribute('position');
  if (!posAttr) return null;

  const vertices = [];
  const indices = [];

  for (let i = 0; i < posAttr.count; i++) {
    vertices.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
  }

  if (geom.index) {
    for (let i = 0; i < geom.index.count; i++) {
      indices.push(geom.index.getX(i));
    }
  } else {
    for (let i = 0; i < posAttr.count; i++) {
      indices.push(i);
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices)
  };
}
