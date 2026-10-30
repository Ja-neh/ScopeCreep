import * as THREE from 'three';

/** Small tileable procedural maps for the island's exposed stone and soil. */
export function createStoneSurfaceMaps(size = 128) {
  const height = new Float32Array(size * size);
  const colorData = new Uint8Array(size * size * 4);
  const roughnessData = new Uint8Array(size * size * 4);
  const normalData = new Uint8Array(size * size * 4);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const u = x / size * Math.PI * 2;
    const v = y / size * Math.PI * 2;
    const broad = Math.sin(u * 4 + Math.sin(v * 2) * 0.9) * Math.cos(v * 3 - u) * 0.5 + 0.5;
    const grain = Math.sin(u * 17 + Math.sin(v * 13) * 2.4) * Math.sin(v * 19 + u * 2) * 0.5 + 0.5;
    const striation = Math.sin((u * 13 + Math.sin(v * 3) * 1.7)) * 0.5 + 0.5;
    height[i] = broad * 0.58 + grain * 0.24 + striation * 0.18;
  }

  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const h = height[y * size + x];
    const fleck = Math.sin((x / size * Math.PI * 2) * 29 + Math.sin((y / size * Math.PI * 2) * 17) * 1.4) * 0.5 + 0.5;
    const shade = Math.round(142 + h * 62 + fleck * 28);
    colorData[i] = shade * 0.94;
    colorData[i + 1] = shade * 0.98;
    colorData[i + 2] = shade;
    colorData[i + 3] = 255;
    const rough = Math.round(190 + h * 58 + fleck * 7);
    roughnessData[i] = roughnessData[i + 1] = roughnessData[i + 2] = rough;
    roughnessData[i + 3] = 255;

    const dx = (at(x + 1, y) - at(x - 1, y)) * 2.4;
    const dy = (at(x, y + 1) - at(x, y - 1)) * 2.4;
    const nx = -dx / Math.hypot(dx, dy, 1);
    const ny = -dy / Math.hypot(dx, dy, 1);
    const nz = 1 / Math.hypot(dx, dy, 1);
    normalData[i] = Math.round((nx * 0.5 + 0.5) * 255);
    normalData[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    normalData[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    normalData[i + 3] = 255;
  }

  const color = dataTexture(colorData, size, THREE.SRGBColorSpace);
  const normal = dataTexture(normalData, size, THREE.NoColorSpace);
  const roughness = dataTexture(roughnessData, size, THREE.NoColorSpace);
  color.repeat.set(3, 3);
  normal.repeat.set(3, 3);
  roughness.repeat.set(3, 3);
  return { color, normal, roughness };
}

export function createGroundNormalMap(size = 128) {
  const data = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);
  const at = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * Math.PI * 2;
    const v = y / size * Math.PI * 2;
    const broad = Math.sin(u * 5 + Math.sin(v * 2) * 0.7) * Math.cos(v * 4 - u) * 0.5 + 0.5;
    const fine = Math.sin(u * 23 + Math.sin(v * 15)) * Math.sin(v * 21 + u * 2) * 0.5 + 0.5;
    heights[y * size + x] = broad * 0.42 + fine * 0.58;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const dx = (at(x + 1, y) - at(x - 1, y)) * 1.1;
    const dy = (at(x, y + 1) - at(x, y - 1)) * 1.1;
    const length = Math.hypot(dx, dy, 1);
    data[i] = Math.round((-dx / length * 0.5 + 0.5) * 255);
    data[i + 1] = Math.round((-dy / length * 0.5 + 0.5) * 255);
    data[i + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
    data[i + 3] = 255;
  }
  const texture = dataTexture(data, size, THREE.NoColorSpace);
  texture.repeat.set(1, 1);
  return texture;
}

function dataTexture(data, size, colorSpace) {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = colorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

