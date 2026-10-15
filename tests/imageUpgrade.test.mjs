// Image upgrade: the post stack (bloom, tone mapping and grade over the whole
// frame), cloud shadows over the ocean and terrain, and the texel-snapped
// shadow rig the walking levels follow the player with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { periodicValueNoise2D, periodicFbm2D } from '../src/rendering/Noise.js';
import { CloudShadows } from '../src/rendering/CloudShadows.js';
import { ShadowFrustum, shadowDepthRadius } from '../src/rendering/ShadowFrustum.js';
import { PostStack } from '../src/rendering/PostStack.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

function makeFakeRenderer({ float = true, width = 1280, height = 720 } = {}) {
  const renderer = {
    width,
    height,
    toneMappingExposure: 1.0,
    extensions: { has: (name) => float && name === 'EXT_color_buffer_float' },
    getDrawingBufferSize: (target) => target.set(renderer.width, renderer.height),
    setRenderTarget: () => {},
    render: () => {}
  };
  return renderer;
}

test('the periodic noise tile wraps seamlessly and still varies', () => {
  const cells = 4;
  const spots = [[0.35, 1.8], [2.75, 0.1], [3.9, 2.2]];
  for (const [x, z] of spots) {
    assert.ok(close(periodicValueNoise2D(x, z, cells, 3), periodicValueNoise2D(x + cells, z, cells, 3)), 'wraps in x');
    assert.ok(close(periodicValueNoise2D(x, z, cells, 3), periodicValueNoise2D(x, z + cells, cells, 3)), 'wraps in z');
    assert.ok(close(periodicFbm2D(x, z, 4, cells, 5), periodicFbm2D(x + cells, z + cells, 4, cells, 5)), 'fbm wraps too');
  }

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) {
      const value = periodicFbm2D(i * 0.8, j * 0.8, 4, cells, 11);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  assert.ok(max - min > 0.05, 'the tile is not flat');
});

test('CloudShadows bakes one opaque, repeating shade tile', () => {
  const clouds = new CloudShadows();
  const texture = clouds.texture;

  assert.equal(texture.image.width, 256);
  assert.equal(texture.image.height, 256);
  assert.equal(texture.wrapS, THREE.RepeatWrapping);
  assert.equal(texture.wrapT, THREE.RepeatWrapping);

  const data = texture.image.data;
  let opaque = true;
  const shades = { min: 255, max: 0 };
  for (let i = 0; i < data.length; i += 4) {
    opaque = opaque && data[i + 3] === 255;
    shades.min = Math.min(shades.min, data[i]);
    shades.max = Math.max(shades.max, data[i]);
  }
  assert.ok(opaque, 'cloud shade is opaque');
  assert.ok(shades.min < 64, `some sky is heavily shaded (min ${shades.min})`);
  assert.ok(shades.max > 191, `some sky stays bright (max ${shades.max})`);

  clouds.dispose();
  assert.equal(clouds.texture, null);
  assert.equal(clouds.uniforms.uCloudShadowMap.value, null);
});

test('CloudShadows slides the shade with the sun and drifts downwind', () => {
  const clouds = new CloudShadows();
  const sun = new THREE.Vector3(0.4, 0.75, 0.5);

  // Mirrors the tuning in CloudShadows.js
  const shear = (240 / 620) / 0.75;
  const driftPerSecond = 5.5 / 620;
  const windX = Math.cos(0.6);
  const windZ = Math.sin(0.6);

  clouds.update(0, sun);
  const offset = clouds.uniforms.uCloudShadowOffset.value;
  assert.ok(close(offset.x, sun.x * shear), 'sun x is projected');
  assert.ok(close(offset.y, sun.z * shear), 'sun z is projected');

  clouds.update(10, sun);
  const drift = 1 - driftPerSecond * 10; // ten seconds of drift, wrapped into the tile
  assert.ok(close(offset.x, windX * drift + sun.x * shear), 'drifts downwind in x');
  assert.ok(close(offset.y, windZ * drift + sun.z * shear), 'drifts downwind in z');

  // A sun at the horizon is floored, not divided by zero.
  clouds.update(0, new THREE.Vector3(1, 0, 0));
  assert.ok(Number.isFinite(offset.x) && Number.isFinite(offset.y));

  clouds.dispose();
});

test('CloudShadows shares its uniforms with the ocean and patches lit materials', () => {
  const clouds = new CloudShadows();

  const oceanUniforms = {};
  clouds.applyToOcean(oceanUniforms);
  assert.ok(oceanUniforms.uCloudShadowMap === clouds.uniforms.uCloudShadowMap, 'the ocean shares the map');
  assert.ok(oceanUniforms.uCloudShadowStrength === clouds.uniforms.uCloudShadowStrength, 'the ocean shares the strength');

  const material = { needsUpdate: false };
  clouds.applyToMaterial(material);
  assert.equal(material.needsUpdate, true, 'the material is recompiled');

  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\nvoid main() {\n#include <project_vertex>\n}',
    fragmentShader: '#include <common>\nvoid main() {\n#include <opaque_fragment>\n}'
  };
  material.onBeforeCompile(shader);

  assert.ok(shader.uniforms.uCloudShadowMap === clouds.uniforms.uCloudShadowMap, 'injected by reference');
  assert.ok(shader.vertexShader.includes('vCloudShadowUV'));
  assert.ok(shader.vertexShader.includes('#include <project_vertex>'), 'the anchor survives');
  assert.ok(shader.fragmentShader.includes('uCloudShadowStrength'));
  assert.ok(shader.fragmentShader.includes('#include <opaque_fragment>'), 'the anchor survives');

  clouds.dispose();
});

test('ShadowFrustum fits its depth range and slides on the texel grid', () => {
  const light = new THREE.DirectionalLight();
  light.position.set(150, 250, 100);
  light.shadow.mapSize.set(2048, 2048);
  const rig = new ShadowFrustum(light, { halfExtent: 250 });

  const camera = light.shadow.camera;
  assert.equal(camera.left, -250);
  assert.equal(camera.right, 250);
  const distance = light.position.length();
  assert.ok(close(rig.distance, distance), 'the sun keeps its travel distance');
  assert.equal(camera.near, 1, 'the sun sits well inside the fitted range');
  assert.ok(camera.far > distance, 'the far plane reaches past the world');

  const initial = light.position.clone().normalize(); // scene -> light direction
  const focus = new THREE.Vector3(137.31, 3.4, -88.62);
  rig.update(focus);
  const once = light.position.clone();
  rig.update(focus);
  assert.ok(light.position.distanceTo(once) === 0, 'the same focus gives the same rig position');

  const texel = 500 / 2048;
  const hops = () => Math.hypot(light.target.position.x - focus.x, light.target.position.z - focus.z);
  assert.ok(hops() <= texel, 'the rig centre stays within one texel of the focus');
  assert.ok(close(light.position.distanceTo(light.target.position), distance, 1e-6), 'still the same sun offset');
  const direction = light.position.clone().sub(light.target.position).normalize();
  assert.ok(close(direction.dot(initial), 1, 1e-6), 'the sun keeps its angle');

  // Entities can be handed in as-is (they expose their mesh).
  const entity = { mesh: { position: new THREE.Vector3(-40, 0, 12) } };
  rig.update(entity);
  assert.ok(Math.hypot(light.target.position.x + 40, light.target.position.z - 12) <= texel);

  // A null focus leaves the rig where it was.
  const held = light.position.clone();
  rig.update(null);
  assert.ok(light.position.distanceTo(held) === 0, 'no focus, no move');

  // The shared depth helper matches what the rig fitted.
  const radius = shadowDepthRadius(250, initial);
  assert.ok(close(camera.far, distance + radius, 1e-6), 'BeachEnvironment can fit the same range');
});

test('PostStack renders through HDR targets sized to the drawing buffer', () => {
  const renderer = makeFakeRenderer();
  const stack = new PostStack(renderer);
  assert.equal(stack.sceneTarget.texture.type, THREE.HalfFloatType);

  stack.render(null, null);
  assert.equal(stack.sceneTarget.width, 1280);
  assert.equal(stack.sceneTarget.height, 720);
  assert.equal(stack.bloomA.width, 320, 'bloom runs at a quarter resolution');
  assert.equal(stack.bloomA.height, 180);

  renderer.width = 640;
  renderer.height = 480;
  stack.render(null, null);
  assert.equal(stack.sceneTarget.width, 640);
  assert.equal(stack.bloomA.width, 160);

  stack.setBloomEnabled(false);
  stack.render(null, null); // bloom off: the composite still runs
  stack.dispose();
});

test('PostStack falls back to byte targets without float color buffers', () => {
  const renderer = makeFakeRenderer({ float: false });
  const stack = new PostStack(renderer);
  assert.equal(stack.sceneTarget.texture.type, THREE.UnsignedByteType);
  stack.dispose();
});
