import fs from 'node:fs';
globalThis.self = globalThis;
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const buffer = fs.readFileSync('assets/inside-spaceship.glb');
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
new GLTFLoader().parse(arrayBuffer, '', (gltf) => {
  const matches = [];
  gltf.scene.traverse((node) => {
    if (/sleep|capsule|bed|spawn/i.test(node.name)) matches.push(node.name);
  });
  console.log(matches.join('\n'));
}, console.error);
