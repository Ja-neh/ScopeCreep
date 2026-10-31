import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Catalog of virus-scanned CC0 .glb models bundled in /public/assets/level02/.
 * Every file has been verified by scripts/download-and-scan-models.mjs and Windows Defender.
 */
const ASSET_BASE = `${import.meta.env?.BASE_URL || '/'}assets/level02/`;
const asset = (name) => `${ASSET_BASE}${name}.glb`;

export const LEVEL02_GLB_ASSETS = {
  pineTree: asset('pine-tree'), spruceTree: asset('spruce-tree'), grassClump: asset('grass-clump'), fern: asset('fern'),
  basaltLavaRock: asset('basalt-lava-rock'), basaltSeaStack: asset('basalt-sea-stack'), boulderRockSet: asset('boulder-rock-set'),
  oceanWaveTile: asset('ocean-wave-tile'), smallWreckBoat: asset('small-wreck-boat'), malpasMetalBoatWreck: asset('malpas-metal-boat-wreck'),
  rafHelicopter: asset('raf-helicopter'), f86SabreJet: asset('f-86-sabre-jet'), alienSpaceship: asset('alien-spaceship'),
  tacticalRifleBlaster: asset('tactical-rifle-blaster'), greenPlasmaBomb: asset('green-plasma-bomb'),
  greatWallSegment: asset('great-wall-segment'), greatWallTower: asset('great-wall-tower'), greatWallGatehouse: asset('great-wall-gatehouse'),
  armoredTruckWreck: asset('armored-truck-wreck'), cargoPlaneWreck: asset('cargo-plane-wreck'), escapePodWreck: asset('escape-pod-wreck'),
  tacticalCoverCrate: asset('tactical-cover-crate')
};

const _cache = new Map();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

/**
 * Runtime binary & JSON safety check for GLB buffers before parsing with GLTFLoader.
 * Rejects any executable headers (MZ/ELF/ZIP), script tags, or external URIs.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {boolean}
 */
export function verifyGlbSafety(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < 20) return false;
  const view = new DataView(arrayBuffer);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const length = view.getUint32(8, true);
  if (magic !== 0x46546c67 || version !== 2 || length !== arrayBuffer.byteLength) return false;

  const chunkLen = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== 0x4e4f534a || 20 + chunkLen > arrayBuffer.byteLength) return false;

  const jsonBytes = new Uint8Array(arrayBuffer, 20, chunkLen);
  const jsonText = new TextDecoder('utf-8').decode(jsonBytes);
  if (/<script\b|javascript:|data:text\/html|powershell|cmd\.exe|WScript/i.test(jsonText)) {
    return false;
  }
  return true;
}

/**
 * Returns true only when running in a browser context with an HTTP(S) origin
 * capable of serving /assets/level02/*.glb files.
 */
function canFetchBrowserAssets() {
  return (
    typeof window !== 'undefined' &&
    typeof window.location !== 'undefined' &&
    /^https?:$/i.test(window.location.protocol || '') &&
    typeof fetch === 'function'
  );
}

/**
 * Loads, security-verifies, and caches a GLB scene from /assets/level02/.
 * Returns null in headless Node test environments.
 * @param {string} url
 * @returns {Promise<THREE.Group|null>}
 */
export async function loadVerifiedGlb(url) {
  if (!canFetchBrowserAssets()) return null;
  if (_cache.has(url)) return _cache.get(url);

  const promise = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      if (!verifyGlbSafety(arrayBuffer)) {
        console.warn(`[Level02AssetLoader] Blocked unsafe GLB payload: ${url}`);
        return null;
      }
      const loader = new GLTFLoader();
      const gltf = await loader.parseAsync(arrayBuffer, '');
      return gltf.scene || null;
    } catch {
      return null;
    }
  })();

  _cache.set(url, promise);
  return promise;
}

/**
 * Attaches a normalized clone of a verified GLB asset onto `targetGroup` when running in the
 * browser, fitted to `targetSize` (`{ x, y, z }`) and `offset` (`{ x, y, z }`).
 * If `targetGroup` is already disposed (removed from parent), any newly cloned resources are freed.
 */
export function attachVerifiedGlbDetail(targetGroup, assetKey, {
  targetSize = { x: 4, y: 2, z: 6 },
  offset = { x: 0, y: 0, z: 0 },
  rotation = { x: 0, y: 0, z: 0 },
  tintColor = null
} = {}) {
  const url = LEVEL02_GLB_ASSETS[assetKey];
  if (!url || !canFetchBrowserAssets()) return;

  loadVerifiedGlb(url).then((template) => {
    if (!template || !targetGroup.parent) return;
    const instance = template.clone(true);
    instance.name = `GLB_${assetKey}`;

    _box.setFromObject(instance);
    if (!_box.isEmpty()) {
      _box.getSize(_size);
      _box.getCenter(_center);
      const sx = _size.x > 1e-4 ? targetSize.x / _size.x : 1;
      const sy = _size.y > 1e-4 ? targetSize.y / _size.y : 1;
      const sz = _size.z > 1e-4 ? targetSize.z / _size.z : 1;
      const uniform = Math.min(sx, sy, sz);
      instance.scale.setScalar(uniform);

      _box.setFromObject(instance);
      _box.getCenter(_center);
      instance.position.set(
        offset.x - _center.x,
        offset.y - _box.min.y,
        offset.z - _center.z
      );
    } else {
      instance.position.set(offset.x, offset.y, offset.z);
    }

    instance.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
    instance.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      if (tintColor !== null && child.material) {
        child.material = child.material.clone();
        if (child.material.color) child.material.color.lerp(new THREE.Color(tintColor), 0.45);
      }
    });

    targetGroup.add(instance);
  });
}

