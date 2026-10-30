import fs from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Keep the actual geometry, weights, skeleton and inverse bind matrices. Strip only
// texture declarations so the real shipped rig can be exercised without a browser.
export async function loadCharacterAsset(id) {
  const source = fs.readFileSync(new URL(`../../public/assets/characters/${id}.glb`, import.meta.url));
  const length = source.readUInt32LE(12);
  const json = JSON.parse(source.toString('utf8', 20, 20 + length));
  json.materials = [{ pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] } }];
  delete json.images; delete json.textures; delete json.samplers;
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
  text.copy(padded);
  const binary = source.subarray(20 + length);
  const out = Buffer.alloc(20 + padded.length + binary.length);
  source.copy(out, 0, 0, 12);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(padded.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(out, 20); binary.copy(out, 20 + padded.length);
  return new GLTFLoader().parseAsync(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength), '');
}
