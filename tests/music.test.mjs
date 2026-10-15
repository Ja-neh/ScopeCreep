// The adaptive score: state gating, the lazy build, crossfade targets, stingers, the lazy
// unlock path and disposal - all checked against a fake AudioContext, because Node has none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicDirector } from '../src/core/MusicDirector.js';

function fakeParam() {
  return {
    value: 0,
    ramps: 0,
    setValueAtTime(value) { this.value = value; return this; },
    linearRampToValueAtTime(value) { this.value = value; this.ramps += 1; return this; },
    exponentialRampToValueAtTime(value) { this.value = value; return this; },
    cancelScheduledValues() { return this; }
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
  const oscillators = [];
  const sources = [];
  const context = {
    currentTime: 0,
    sampleRate: 48000,
    state: 'suspended',
    destination: { destination: true },
    createBuffer(channels, length) {
      const data = new Float32Array(length);
      return { length, getChannelData: () => data, _data: data };
    },
    createBufferSource: () => {
      const source = fakeNode({ buffer: null, playbackRate: fakeParam(), loop: false, onended: null });
      sources.push(source);
      return source;
    },
    createOscillator: () => {
      const oscillator = fakeNode({ type: 'sine', frequency: fakeParam(), detune: fakeParam(), onended: null });
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain: () => { const gain = fakeNode({ gain: fakeParam() }); gains.push(gain); return gain; },
    createBiquadFilter: () => fakeNode({ type: 'lowpass', frequency: fakeParam(), Q: fakeParam() }),
    _gains: gains,
    _oscillators: oscillators,
    _sources: sources
  };
  return context;
}

/** The two things the director reads off the AudioManager. */
function fakeAudio() {
  return { context: null, outputNode: fakeNode({}) };
}

function rampCount(context) {
  return context._gains.reduce((sum, node) => sum + node.gain.ramps, 0);
}

test('the director exposes its eight states and five stingers', () => {
  assert.deepEqual(MusicDirector.stateNames, ['silent', 'menu', 'deploy', 'ambient', 'tense', 'combat', 'suspense', 'victory']);
  assert.deepEqual(MusicDirector.stingerNames, ['impact', 'deploy', 'waveHeld', 'ambush', 'defeat']);
});

test('without an AudioContext every call is a safe no-op that still tracks the state', () => {
  const director = new MusicDirector(fakeAudio());
  director.setState('tense');
  assert.equal(director.state, 'tense', 'the requested state is remembered for the lazy build');
  assert.equal(director.isRunning, true);
  assert.equal(director.buses, null, 'nothing is built yet');
  assert.equal(director.stinger('ambush'), null);
  director.setState('bogus');
  assert.equal(director.state, 'tense', 'unknown states are ignored');
  director.stop();
  assert.equal(director.isRunning, false);
  director.dispose();

  const bare = new MusicDirector(null);
  bare.setState('combat'); // no audio system at all: silent, and never throws
  bare.stinger('defeat');
  bare.stop();
  bare.dispose();
});

test('a state applied once a context exists builds the graph at that state', () => {
  const audio = fakeAudio();
  const director = new MusicDirector(audio);
  director.setState('combat'); // No context yet: remembered, nothing built
  assert.equal(director.buses, null);

  const context = createFakeContext();
  audio.context = context;
  assert.ok(director.stinger('waveHeld'), 'a stinger can trigger the lazy build by itself');
  director.setState('combat'); // The same state again: a no-op, the build already applied it
  assert.ok(director.buses, 'the layer graph was built');
  assert.equal(director.buses.drone.gain.value, 0.26);
  assert.equal(director.buses.drums.gain.value, 0.22, 'combat carries the war drums');
  assert.equal(director.buses.ocean.gain.value, 0.12, 'the ambience arrives with the score');
  director.dispose();
});

test('the menu theme starts when the AudioContext arrives after the first gesture', () => {
  const audio = fakeAudio();
  const director = new MusicDirector(audio);
  director.setState('menu'); // Remembered while the player is still sitting on the menu
  assert.equal(director.buses, null, 'nothing can be built before a gesture');
  assert.equal(director.refresh(), false, 'a refresh finds no context yet');

  audio.context = createFakeContext(); // The first click: AudioManager.unlock runs and calls back
  assert.equal(director.refresh(), true, 'the context arrives, so the graph builds');
  assert.equal(director.buses.groove.gain.value, 0.85, 'the remembered menu state applies at birth: the loud trailer groove');
  assert.equal(director.buses.drone.gain.value, 0.16, 'over a low drone');
  assert.equal(director.buses.pad.gain.value, 0.10, 'and the resolved pad underneath');
  assert.equal(director.refresh(), true, 'a second refresh is a quiet no-op');
  director.dispose();
});

test('the trailer grooves are synthesized two-bar loops, mixed loud', () => {
  const audio = fakeAudio();
  const context = createFakeContext();
  audio.context = context;
  const director = new MusicDirector(audio);
  director.setState('menu');

  const loop = context._sources.find((source) => source.loop && source.buffer && source.buffer.length === context.sampleRate * 5);
  assert.ok(loop, 'a looping buffer source carries the menu groove (two bars at 96 BPM)');
  const data = loop.buffer._data;
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  assert.ok(peak > 0.5, `the groove is synthesized hot (peak ${peak.toFixed(2)})`);
  assert.equal(director.buses.groove.gain.value, 0.85, 'and mixed loud on its bus');
  assert.equal(director.buses.intro.gain.value, 0, 'the menu does not play the intro loop');

  // The mission opening swaps in the hotter intro loop
  director.setState('deploy');
  const intro = context._sources.find((source) => source.loop && source.buffer && source.buffer.length === context.sampleRate * 4);
  assert.ok(intro, 'a second looping buffer carries the intro (two bars at 120 BPM)');
  const introData = intro.buffer._data;
  let introPeak = 0;
  for (let i = 0; i < introData.length; i++) introPeak = Math.max(introPeak, Math.abs(introData[i]));
  assert.ok(introPeak > 0.5, `the intro is synthesized hot too (peak ${introPeak.toFixed(2)})`);
  assert.equal(director.buses.intro.gain.value, 0.9, 'and takes over loud for the opening');
  assert.equal(director.buses.groove.gain.value, 0, 'while the menu loop hands over');
  director.dispose();
});

test('only real state changes retune the layers', () => {
  const audio = fakeAudio();
  const context = createFakeContext();
  audio.context = context;
  const director = new MusicDirector(audio);

  director.setState('tense');
  assert.equal(director.buses.drone.gain.value, 0.30);
  assert.equal(director.buses.drums.gain.value, 0, 'no drums in the tension bed');
  const before = rampCount(context);
  director.setState('tense');
  assert.equal(rampCount(context), before, 'an identical state schedules no extra ramps');

  director.setState('deploy');
  assert.equal(director.buses.intro.gain.value, 0.9, 'every mission opens on the hot intro groove');
  assert.equal(director.buses.groove.gain.value, 0, 'not on the menu loop');
  assert.equal(director.buses.pulse.gain.value, 0, 'and not on the slow tension heartbeat');

  director.setState('ambient');
  assert.equal(director.buses.intro.gain.value, 0, 'the camera arriving ends the intro');
  assert.equal(director.buses.ocean.gain.value, 0.12, 'leaving the surf to breathe');
  assert.equal(director.buses.drone.gain.value, 0, 'with no score left');

  director.setState('combat');
  assert.equal(director.buses.pulseLfo.frequency.value, 1.35, 'combat quickens the heartbeat');
  director.setState('victory');
  assert.equal(director.buses.pad.gain.value, 0.30, 'victory swells the resolved pad');
  assert.equal(director.buses.drums.gain.value, 0, 'and drops the percussion');
  director.dispose();
});

test('silent and stop zero the bed and the ambience; the score can come back', () => {
  const audio = fakeAudio();
  audio.context = createFakeContext();
  const director = new MusicDirector(audio);

  director.setState('combat');
  director.setState('silent');
  assert.equal(director.buses.drone.gain.value, 0);
  assert.equal(director.buses.drums.gain.value, 0);
  assert.equal(director.buses.groove.gain.value, 0, 'the trailer groove stops too');
  assert.equal(director.buses.ocean.gain.value, 0, 'the ambience stops with the score');
  assert.equal(director.isRunning, false);

  director.setState('tense');
  assert.equal(director.buses.drone.gain.value, 0.30, 'a new state restarts the bed');
  assert.equal(director.buses.ocean.gain.value, 0.12);
  director.stop();
  assert.equal(director.buses.drone.gain.value, 0);
  assert.equal(director.isRunning, false);
  director.dispose();
});

test('stingers schedule one-shot voices over the score', () => {
  const audio = fakeAudio();
  audio.context = createFakeContext();
  const director = new MusicDirector(audio);

  assert.equal(director.stinger('nope'), null, 'unknown stingers are ignored');
  const before = audio.context._oscillators.length;
  const sting = director.stinger('ambush');
  assert.ok(sting, 'the ambush sting returns its lead voice');
  assert.ok(audio.context._oscillators.length > before, 'it synthesized fresh oscillators');
  assert.ok(director.stinger('impact'), 'the game-start impact returns its lead boom');
  director.dispose();
});

test('dispose stops every started source and forgets the graph', () => {
  const audio = fakeAudio();
  audio.context = createFakeContext();
  const director = new MusicDirector(audio);

  director.setState('tense');
  const started = director._started.length;
  assert.ok(started > 0, 'the graph started its sources');
  let stopped = 0;
  for (const source of director._started) {
    const original = source.stop;
    source.stop = () => { stopped += 1; original.call(source); };
  }
  director.dispose();
  assert.equal(stopped, started, 'every started source was stopped');
  assert.equal(director.buses, null);
  assert.equal(director.isRunning, false);

  audio.context = null; // As the real AudioManager does when it closes its context
  director.setState('tense');
  assert.equal(director.buses, null, 'a disposed director never rebuilds');
});
