import * as THREE from 'three';
import { createRandom } from './Noise.js';

const PUFFS_PER_CLOUD = [4, 8];
const PUFF_SIZE = { x: [26, 48], y: [10, 18], z: [20, 36] };
const DRIFT_RADIANS_PER_SECOND = 0.004; // The ring turns slowly: a few meters a second at that range

/**
 * Clouds
 * Low-poly clouds: clusters of flat-shaded puffs scattered in a wide ring high above the scene,
 * lit by the scene's (low, warm) sun so their sunward sides glow at sunset. One instanced mesh,
 * one draw call. The ring follows the camera across the ground (clouds are far enough away that
 * they should not slide past as you walk) and slowly drifts. Fog does not apply to them.
 */
export class Clouds {
  /**
   * @param {Object} [options]
   * @param {number} [options.count=28]
   * @param {[number, number]} [options.distance=[450, 1400]] - Horizontal distance from the camera
   * @param {[number, number]} [options.altitude=[140, 320]]
   * @param {number} [options.seed=19]
   */
  constructor({ count = 28, distance = [450, 1400], altitude = [140, 320], seed = 19 } = {}) {
    const random = createRandom(seed);
    const pick = ([min, max]) => min + (max - min) * random();

    // Lay out every puff first, then build the instanced mesh to fit
    const puffs = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + random() * 0.35;
      const radius = pick(distance);
      const centre = new THREE.Vector3(Math.cos(angle) * radius, pick(altitude), Math.sin(angle) * radius);
      const heading = random() * Math.PI;
      const along = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
      const n = Math.round(pick(PUFFS_PER_CLOUD));
      for (let j = 0; j < n; j++) {
        const offset = (j - (n - 1) / 2) * 22 + (random() - 0.5) * 12;
        const size = new THREE.Vector3(pick(PUFF_SIZE.x), pick(PUFF_SIZE.y), pick(PUFF_SIZE.z));
        // Middle puffs are the biggest and sit a little higher
        const middle = 1 - Math.abs(j - (n - 1) / 2) / n;
        size.multiplyScalar(0.7 + 0.5 * middle);
        const position = centre.clone().addScaledVector(along, offset);
        position.y += size.y * 0.4 * middle + (random() - 0.5) * 6;
        puffs.push({ position, size, yaw: random() * Math.PI });
      }
    }

    this.geometry = new THREE.IcosahedronGeometry(1, 1);
    this.material = new THREE.MeshLambertMaterial({
      color: 0xf6dccf,
      emissive: 0x6e4f63,
      flatShading: true,
      fog: false
    });
    this.instances = new THREE.InstancedMesh(this.geometry, this.material, puffs.length);
    this.instances.name = 'CloudPuffs';
    this.instances.castShadow = false;
    this.instances.receiveShadow = false;

    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    puffs.forEach((puff, index) => {
      rotation.setFromAxisAngle(up, puff.yaw);
      matrix.compose(puff.position, rotation, puff.size);
      this.instances.setMatrixAt(index, matrix);
    });
    this.instances.instanceMatrix.needsUpdate = true;
    this.instances.computeBoundingSphere();

    this.mesh = new THREE.Group();
    this.mesh.name = 'Clouds';
    this.mesh.add(this.instances);
    this.puffCount = puffs.length;
  }

  /**
   * Keeps the ring centred on the camera and drifts it. Call once per frame.
   * @param {number} delta
   * @param {THREE.Vector3} [cameraPosition]
   */
  update(delta, cameraPosition = null) {
    if (cameraPosition) {
      this.mesh.position.x = cameraPosition.x;
      this.mesh.position.z = cameraPosition.z;
    }
    this.mesh.rotation.y += DRIFT_RADIANS_PER_SECOND * delta;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.instances.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}

