import * as THREE from 'three';

/** A small, deterministic tiling normal/roughness pair for procedural military metal. */
export function createWeatheringMaps() {
  const size = 64;
  const height = new Float32Array(size * size);
  const roughness = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const u = (x / size) * Math.PI * 2;
    const v = (y / size) * Math.PI * 2;
    height[i] = 0.5 + 0.21 * Math.sin(8 * u + Math.sin(3 * v))
      + 0.16 * Math.sin(16 * v + Math.sin(4 * u)) + 0.1 * Math.sin(32 * (u + v));
    const r = Math.round(95 + height[i] * 145);
    roughness.set([r, r, r, 255], i * 4);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const dx = (height[y * size + (x + 1) % size] - height[y * size + (x + size - 1) % size]) * 2.2;
    const dy = (height[((y + 1) % size) * size + x] - height[((y + size - 1) % size) * size + x]) * 2.2;
    const inv = 1 / Math.hypot(-dx, -dy, 1);
    normal.set([Math.round((-dx * inv * 0.5 + 0.5) * 255), Math.round((-dy * inv * 0.5 + 0.5) * 255), Math.round((inv * 0.5 + 0.5) * 255), 255], i * 4);
  }
  const makeTexture = (data) => {
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  };
  return { roughness: makeTexture(roughness), normal: makeTexture(normal) };
}
