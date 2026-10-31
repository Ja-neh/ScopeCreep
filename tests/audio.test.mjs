// The sound engine: procedural one-shots, lazy unlock, saved mix, throttles, the voice
// cap, and distance fall-off - all checked against a fake AudioContext, because Node has none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AudioManager } from '../src/core/AudioManager.js';
import { SOUND_FILES, AUDIO_FILES } from '../src/core/SoundLibrary.js';
import { readFileSync } from 'node:fs';

function fakeParam() {
  return {
    value: 0,
    setValueAtTime(value) { this.value = value; return this; },
    linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; }
  };
}

function fakeNode(extra = {}) {
  return {
    ...extra,
    connect(destination) { return destination; },
    disconnect() { },
    start() { },
    stop() { }
  };
}

function createFakeContext() {
  const gains = [];
  const context = {
    currentTime: 0,
    sampleRate: 48000,
    state: 'suspended',
    destination: { destination: true },
    resume() { context.state = 'running'; },
    close() { context.state = 'closed'; },
    createBuffer(channels, length) {
      return { getChannelData: () => new Float32Array(length) };
    },
    createBufferSource: () => fakeNode({ buffer: null, playbackRate: fakeParam(), onended: null }),
    createOscillator: () => fakeNode({ type: 'sine', frequency: fakeParam(), detune: fakeParam(), onended: null }),
    createGain: () => { const gain = fakeNode({ gain: fakeParam() }); gains.push(gain); return gain; },
    createBiquadFilter: () => fakeNode({ type: 'lowpass', frequency: fakeParam(), Q: fakeParam() }),
    createStereoPanner: () => fakeNode({ pan: fakeParam() }),
    _gains: gains
  };
  return context;
}

function fakeStorage() {
  const entries = new Map();
  return {
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => { entries.set(key, String(value)); }
  };
}

test('the manager exposes combat, creature, movement, and flight sounds', () => {
  assert.deepEqual(AudioManager.soundNames, Object.keys(SOUND_FILES));
  for (const file of AUDIO_FILES) {
    const bytes = readFileSync(new URL(`../public/assets/audio/${file}`, import.meta.url));
    assert.ok(['RIFF','OggS'].includes(bytes.toString('ascii',0,4)), `${file} is playable audio`);
  }
});

test('imported recordings decode once and replace synthesized voices, alternating footsteps', async () => {
  const context = createFakeContext();
  let decodes = 0;
  context.decodeAudioData = async () => ({ sample: ++decodes });
  const manager = new AudioManager(null, { contextFactory: () => context });
  await manager.preloadSamples(() => {}, async () => ({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)}));
  assert.equal(decodes,0,'no audio context before a user gesture');
  manager.unlock();
  await manager._decodeSamples();
  assert.equal(decodes,AUDIO_FILES.length);
  assert.equal(manager.play('gunshot').buffer,manager._samples.get('rifle-shot.wav'));
  const first=manager.play('footstep').buffer;
  context.currentTime=1;
  const second=manager.play('footstep').buffer;
  assert.notEqual(first,second,'left and right steps alternate');
  manager.dispose();
});

test('player footsteps are not swallowed by a teammate and cinematic audio uses its camera', () => {
  const context=createFakeContext();
  const camera=new THREE.PerspectiveCamera(); camera.position.set(0,0,-540); camera.updateMatrixWorld();
  const manager=new AudioManager({cinematic:{camera}}, {contextFactory:()=>context});
  manager.unlock();
  assert.ok(manager.play('footstep',{x:0,y:0,z:-541}));
  assert.ok(manager.play('footstep'));
  assert.equal(manager.play('gunshot',{x:0,y:0,z:0}),null);
  manager.dispose();
});

test('without an AudioContext every call is a safe no-op', () => {
  const manager = new AudioManager(null, {});
  assert.equal(manager.play('gunshot'), null);
  assert.equal(manager.play('explosion', { x: 0, y: 0, z: 0 }), null);
  manager.unlock(); // Node has no AudioContext: unlocking stays silent instead of throwing
  assert.equal(manager.play('hurt'), null);
  manager.dispose();
});

test('unlock builds the master chain and plays a voice through it', () => {
  const context = createFakeContext();
  const manager = new AudioManager(null, { contextFactory: () => context });
  let announced = null;
  manager.onUnlocked = (ctx) => { announced = ctx; };
  manager.unlock();

  assert.equal(context.state, 'running', 'a suspended context is resumed');
  assert.equal(announced, context, 'companion systems are told about the context');
  manager.unlock();
  assert.equal(announced, context, 'later unlocks do not announce again');
  const source = manager.play('gunshot');
  assert.ok(source, 'the gunshot returns its voice source');
  assert.equal(typeof source.onended, 'function', 'the voice is counted until it ends');
  assert.equal(manager.activeVoices, 1);
  manager.dispose();
});

test('volume and mute persist and drive the master gain', () => {
  const storage = fakeStorage();
  const context = createFakeContext();
  const manager = new AudioManager(null, { contextFactory: () => context, storage });
  manager.unlock();

  manager.volume = 0.25;
  assert.equal(context._gains[0].gain.value, 0.25, 'the master gain follows the volume');
  manager.muted = true;
  assert.equal(context._gains[0].gain.value, 0, 'muting silences the master gain');
  assert.equal(manager.play('gunshot'), null, 'a muted manager plays nothing');

  const reopened = new AudioManager(null, { contextFactory: () => createFakeContext(), storage });
  assert.equal(reopened.volume, 0.25, 'the volume survives a reload');
  assert.equal(reopened.muted, true, 'the mute survives a reload');
  manager.dispose();
});

test('hurt repeats are throttled but the player\'s own gun is not', () => {
  const context = createFakeContext();
  const manager = new AudioManager(null, { contextFactory: () => context });
  manager.unlock();

  assert.ok(manager.play('hurt'));
  assert.equal(manager.play('hurt'), null, 'a second sting within 0.25 s is swallowed');
  context.currentTime = 0.3;
  assert.ok(manager.play('hurt'));

  assert.ok(manager.play('gunshot'));
  assert.ok(manager.play('gunshot'), 'the player\'s gun is never throttled');
  manager.dispose();
});

test('the voice cap refuses new sounds while too many are alive', () => {
  const context = createFakeContext();
  const manager = new AudioManager(null, { contextFactory: () => context });
  manager.unlock();
  context.currentTime = 1;

  let played = 0;
  for (let i = 0; i < 40; i++) {
    if (manager.play('gunshot')) played++;
  }
  assert.equal(played, 24, 'at most 24 one-shots ring out at once');
  manager.dispose();
});

test('positional sounds halve at the reference distance and fall silent beyond the cutoff', () => {
  const context = createFakeContext();
  const camera = new THREE.Object3D();
  const manager = new AudioManager({ getActiveCamera: () => camera }, { contextFactory: () => context });
  manager.unlock();
  camera.position.set(0, 0, 0);
  camera.updateMatrixWorld();

  assert.ok(manager.play('gunshot', new THREE.Vector3(0, 0, 0)));
  const atListener = manager._lastVoiceGain;

  context.currentTime = 1; // outside the positional throttle window
  assert.ok(manager.play('gunshot', new THREE.Vector3(12, 0, 0)));
  assert.ok(
    Math.abs(manager._lastVoiceGain - atListener * 0.5) < 1e-6,
    `gain halves 12 m out (${manager._lastVoiceGain} vs ${atListener})`
  );

  context.currentTime = 2;
  assert.equal(manager.play('gunshot', new THREE.Vector3(0, 0, 141)), null, 'silent past 140 m');
  manager.dispose();
});
