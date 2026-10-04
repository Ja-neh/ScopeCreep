// RenderQuality: the player's graphics choice (kept), Auto resolution, and the recommendation
// for this computer (from the graphics card, then from the measured frame rate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installBrowserGlobals } from './support/testWorld.mjs';
import { RenderQuality, isSoftwareRenderer, friendlyGpuName, RESOLUTION_CHOICES } from '../src/core/RenderQuality.js';

installBrowserGlobals();

const VEGA = 'ANGLE (AMD, AMD Radeon(TM) RX Vega 10 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';
const BASIC = 'ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)';

function fakeRenderer() {
  return {
    pixelRatio: null,
    shadowMap: { enabled: true },
    setPixelRatio(value) { this.pixelRatio = value; }
  };
}

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) };
}

function create({ software = false, dpr = 1.5, storage = memoryStorage(), renderer = fakeRenderer(), scene = new THREE.Scene() } = {}) {
  const quality = new RenderQuality(renderer, scene, { software, gpuName: software ? BASIC : VEGA, devicePixelRatio: dpr, storage });
  return { quality, renderer, storage, scene };
}

/** Feeds `seconds` of frames that each take `frameMs`. */
function run(quality, seconds, frameMs, clock = { now: 0 }) {
  if (clock.now === 0) quality.update(clock.now);
  const frames = Math.round((seconds * 1000) / frameMs);
  for (let i = 0; i < frames; i++) {
    clock.now += frameMs;
    quality.update(clock.now);
  }
  return clock;
}

test('graphics card names are read from WebGL, and software renderers recognised', () => {
  assert.equal(friendlyGpuName(VEGA), 'AMD Radeon(TM) RX Vega 10 Graphics');
  assert.equal(friendlyGpuName(BASIC), 'Microsoft Basic Render Driver');
  assert.equal(friendlyGpuName('Apple M2'), 'Apple M2');
  assert.ok(isSoftwareRenderer(BASIC));
  assert.ok(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'));
  assert.ok(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)'));
  assert.ok(!isSoftwareRenderer(VEGA));
  assert.ok(!isSoftwareRenderer('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'));
});

test('first run starts on the recommended settings: full quality with a GPU, light without one', () => {
  const gpu = create();
  assert.equal(gpu.renderer.pixelRatio, 1.5);
  assert.equal(gpu.renderer.shadowMap.enabled, true);
  assert.match(gpu.quality.describe().reason, /AMD Radeon\(TM\) RX Vega 10 Graphics/);

  const soft = create({ software: true });
  assert.equal(soft.renderer.pixelRatio, 1.5 * 0.4);
  assert.equal(soft.renderer.shadowMap.enabled, false);
  const state = soft.quality.describe();
  assert.equal(state.recommendedText, '40% resolution, shadows off');
  assert.match(state.reason, /software rendering/);
  assert.equal(state.isUsingRecommended, true);
});

test("the player's choice is applied, kept as chosen even when slow, and remembered next time", () => {
  const { quality, renderer, storage, scene } = create();
  quality.setResolution(0.7);
  quality.setShadows(false);
  assert.equal(renderer.pixelRatio, 1.5 * 0.7);
  assert.equal(renderer.shadowMap.enabled, false);

  run(quality, 5, 100); // 10 fps
  assert.equal(renderer.pixelRatio, 1.5 * 0.7, 'a fixed choice is never changed behind the player\'s back');

  const again = new RenderQuality(fakeRenderer(), scene, { gpuName: VEGA, devicePixelRatio: 1.5, storage });
  assert.deepEqual(again.settings, { resolution: 0.7, shadows: false });
  assert.equal(again.renderer.pixelRatio, 1.5 * 0.7);
});

test('the recommendation follows the measured frame rate', () => {
  const { quality } = create();
  // 15 fps at full resolution: about 35 fps needs roughly half the pixels
  const clock = run(quality, 3, 1000 / 15);
  let state = quality.describe();
  assert.equal(state.recommended.resolution, 0.55);
  assert.match(state.reason, /At 100% resolution with shadows it runs at 15 fps/);
  assert.equal(state.isUsingRecommended, false);

  // Already at the lowest resolution and still slow: drop shadows as well
  quality.setResolution(0.4);
  run(quality, 3, 1000 / 20, clock);
  state = quality.describe();
  assert.deepEqual(state.recommended, { resolution: 0.4, shadows: false });

  // Use recommended applies it
  quality.useRecommended();
  assert.deepEqual(quality.settings, { resolution: 0.4, shadows: false });
  assert.equal(quality.describe().isUsingRecommended, true);

  // Lots of headroom: recommend one step sharper
  run(quality, 3, 1000 / 60, clock);
  assert.equal(quality.describe().recommended.resolution, 0.55);
});

test('Auto lowers the resolution when slow and raises it back when fast, leaving shadows alone', () => {
  const { quality, renderer } = create();
  quality.setResolution('auto');
  const clock = run(quality, 12, 100);
  assert.equal(quality.scale, 0.4, 'down to the lowest choice');
  assert.equal(renderer.shadowMap.enabled, true, 'shadows stay as the player set them');

  run(quality, 20, 1000 / 60, clock);
  assert.equal(quality.scale, 1, 'back to full');
});

test('one long hitch (loading, a pause) is never taken as the frame rate', () => {
  const { quality } = create();
  quality.setResolution('auto');
  const clock = run(quality, 3, 1000 / 40);
  clock.now += 2000;
  quality.update(clock.now);
  run(quality, 1, 1000 / 40, clock);
  assert.equal(quality.scale, 1);
  assert.equal(Math.round(quality.measuredFps), 40);
});

test('bad or missing saved settings fall back to the recommendation; a screen change re-applies the resolution', () => {
  const storage = memoryStorage();
  storage.setItem('scopecreep.graphics', '{"resolution":0.33,"shadows":"yes"}');
  const { quality, renderer } = create({ storage });
  assert.deepEqual(quality.settings, { resolution: 1, shadows: true });
  assert.equal(create({ storage: null }).quality.settings.resolution, 1, 'works without storage');

  quality.onResize(1);
  assert.equal(renderer.pixelRatio, 1);
  assert.deepEqual(quality.describe().choices, ['auto', ...RESOLUTION_CHOICES]);
});

test('probe() copes without a DOM (returns a non-software answer)', () => {
  assert.equal(RenderQuality.probe().software, false);
});
