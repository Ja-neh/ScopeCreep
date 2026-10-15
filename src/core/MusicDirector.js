/**
 * MusicDirector
 * The game's adaptive score and ambience bed, built the same way as the sound engine: everything
 * is synthesized at run time (oscillators, filters and one looping noise buffer), so the game
 * ships no audio files.
 *
 * There are no notes and no scheduler - the score is a set of continuous layers whose levels
 * crossfade per mission state:
 *   silent    nothing (the level is over, or no score is running)
 *   menu      a loud two-bar drum-and-bass trailer groove (the main menu)
 *   deploy    a hotter, driving two-bar loop for the mission opening (the camera sweep)
 *   ambient   just the surf and the wind (once the opening camera reaches the player)
 *   tense     a low drone and a slow heartbeat pulse (the push inland)
 *   combat    drone, a doubled pulse and war-drum noise (the waves, the ambush)
 *   suspense  a higher, sparser drone and pulse (the break between waves)
 *   victory   a resolved major pad that swells in when the mission is won
 * One-shot stingers ('impact', 'deploy', 'waveHeld', 'ambush', 'defeat') land the moments between states.
 *
 * Everything routes through the AudioManager's output node, so the player's volume and mute
 * apply to the score automatically. The AudioContext only exists after the first user gesture
 * (see AudioManager.unlock): every call before that - and everywhere in the Node test runner -
 * is a silent no-op that still records the requested state, and the graph is built lazily the
 * first time a state is applied with a context available.
 */

const MUSIC_LEVEL = 0.5;       // bed level on the audio master
const RAMP_SECONDS = 1.4;      // crossfade between states
const VICTORY_RAMP_SECONDS = 2.6;
const STOP_RAMP_SECONDS = 0.6;
const NOISE_SECONDS = 1;       // one-second noise buffer, looped

const AMB_OCEAN_LEVEL = 0.12;  // surf wash under everything
const AMB_WIND_LEVEL = 0.09;   // wind gusts

// The menu's trailer groove: a two-bar loop at this tempo (96 BPM -> 5.0 s per loop)
const TRAILER_BPM = 96;
const TRAILER_BARS = 2;
const TRAILER_BEATS_PER_BAR = 4;

// The mission-opening intro groove: hotter and faster than the menu's (120 BPM -> 4.0 s per loop)
const INTRO_BPM = 120;
const INTRO_BARS = 2;
const INTRO_BEATS_PER_BAR = 4;

/** Per-state layer targets (0..1) and LFO rates. */
// 'deploy' plays the mission-opening intro loop (see _ensureIntroGroove); 'ambient' is the scene left to breathe: no score, just the ambience.
const STATES = {
  silent:   { drone: 0,    pulse: 0,    drums: 0,    pad: 0,    groove: 0,    intro: 0,    pulseRate: 0.85, drumRate: 2.6 },
  menu:     { drone: 0.16, pulse: 0,    drums: 0,    pad: 0.10, groove: 0.85, intro: 0,    pulseRate: 0.85, drumRate: 2.6 },
  deploy:   { drone: 0,    pulse: 0,    drums: 0,    pad: 0,    groove: 0,    intro: 0.9,  pulseRate: 0.85, drumRate: 2.6 },
  ambient:  { drone: 0,    pulse: 0,    drums: 0,    pad: 0,    groove: 0,    intro: 0,    pulseRate: 0.85, drumRate: 2.6 },
  tense:    { drone: 0.30, pulse: 0.20, drums: 0,    pad: 0,    groove: 0,    intro: 0,    pulseRate: 0.85, drumRate: 2.6 },
  combat:   { drone: 0.26, pulse: 0.30, drums: 0.22, pad: 0,    groove: 0,    intro: 0,    pulseRate: 1.35, drumRate: 2.6 },
  suspense: { drone: 0.34, pulse: 0.14, drums: 0,    pad: 0,    groove: 0,    intro: 0,    pulseRate: 0.60, drumRate: 2.6 },
  victory:  { drone: 0.12, pulse: 0,    drums: 0,    pad: 0.30, groove: 0,    intro: 0,    pulseRate: 0.85, drumRate: 2.6 }
};

const PAD_FREQUENCIES = [164.81, 207.65, 246.94]; // E3 - G#3 - B3: a resolved major triad

const STINGERS = {
  // The game starts: a sub boom with a noise crack (the trailer impact)
  impact: {
    build({ ctx, out, when, noise }) {
      const boom = ctx.createOscillator();
      boom.type = 'sine';
      boom.frequency.setValueAtTime(70, when);
      boom.frequency.exponentialRampToValueAtTime(28, when + 0.7);
      const boomGain = ctx.createGain();
      boomGain.gain.setValueAtTime(0.0001, when);
      boomGain.gain.exponentialRampToValueAtTime(0.9, when + 0.02);
      boomGain.gain.exponentialRampToValueAtTime(0.001, when + 0.8);
      boom.connect(boomGain);
      boomGain.connect(out);
      boom.start(when);
      boom.stop(when + 0.85);

      const crack = ctx.createBufferSource();
      crack.buffer = noise;
      const crackFilter = ctx.createBiquadFilter();
      crackFilter.type = 'bandpass';
      crackFilter.frequency.setValueAtTime(1200, when);
      crackFilter.frequency.exponentialRampToValueAtTime(90, when + 0.35);
      crackFilter.Q.value = 0.6;
      const crackGain = ctx.createGain();
      crackGain.gain.setValueAtTime(0.5, when);
      crackGain.gain.exponentialRampToValueAtTime(0.001, when + 0.4);
      crack.connect(crackFilter);
      crackFilter.connect(crackGain);
      crackGain.connect(out);
      crack.start(when);
      crack.stop(when + 0.45);
      return boom;
    }
  },

  // The mission opens: a sub swell rising under two horn-like stabs
  deploy: {
    build({ ctx, out, when, noise }) {
      // The swell: a deep tone climbing as the title card appears
      const swell = ctx.createOscillator();
      swell.type = 'sine';
      swell.frequency.setValueAtTime(36, when);
      swell.frequency.exponentialRampToValueAtTime(90, when + 3.2);
      const swellGain = ctx.createGain();
      swellGain.gain.setValueAtTime(0.0001, when);
      swellGain.gain.exponentialRampToValueAtTime(0.5, when + 2.4);
      swellGain.gain.exponentialRampToValueAtTime(0.001, when + 4.2);
      swell.connect(swellGain);
      swellGain.connect(out);
      swell.start(when);
      swell.stop(when + 4.4);

      // A launch whoosh right at the top
      const whoosh = ctx.createBufferSource();
      whoosh.buffer = noise;
      const whooshFilter = ctx.createBiquadFilter();
      whooshFilter.type = 'bandpass';
      whooshFilter.frequency.setValueAtTime(700, when);
      whooshFilter.frequency.exponentialRampToValueAtTime(140, when + 1.1);
      whooshFilter.Q.value = 0.7;
      const whooshGain = ctx.createGain();
      whooshGain.gain.setValueAtTime(0.35, when);
      whooshGain.gain.exponentialRampToValueAtTime(0.001, when + 1.2);
      whoosh.connect(whooshFilter);
      whooshFilter.connect(whooshGain);
      whooshGain.connect(out);
      whoosh.start(when);
      whoosh.stop(when + 1.3);

      // Two horn stabs: a low A power chord, detuned saws under a dark filter
      [1.3, 2.9].forEach((offset, index) => {
        const at = when + offset;
        const level = index === 0 ? 0.22 : 0.3;
        for (const frequency of [110, 164.81]) {
          const horn = ctx.createOscillator();
          horn.type = 'sawtooth';
          horn.frequency.setValueAtTime(frequency, at);
          horn.detune.value = index === 1 ? 6 : -4;
          const hornFilter = ctx.createBiquadFilter();
          hornFilter.type = 'lowpass';
          hornFilter.frequency.setValueAtTime(900, at);
          hornFilter.frequency.exponentialRampToValueAtTime(300, at + 1);
          const hornGain = ctx.createGain();
          hornGain.gain.setValueAtTime(0.0001, at);
          hornGain.gain.exponentialRampToValueAtTime(level, at + 0.05);
          hornGain.gain.exponentialRampToValueAtTime(0.001, at + (index === 0 ? 1.1 : 1.6));
          horn.connect(hornFilter);
          hornFilter.connect(hornGain);
          hornGain.connect(out);
          horn.start(at);
          horn.stop(at + 1.8);
        }
      });
      return swell;
    }
  },

  // A short rising two-note call: the wave is held
  waveHeld: {
    build({ ctx, out, when }) {
      let first = null;
      [392, 587.33].forEach((frequency, index) => {
        const at = when + index * 0.16;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(frequency, at);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.5, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
        osc.connect(gain);
        gain.connect(out);
        osc.start(at);
        osc.stop(at + 0.32);
        if (!first) first = osc;
      });
      return first;
    }
  },

  // A dissonant low stab over a noise crack: they were waiting in the trees
  ambush: {
    build({ ctx, out, when, noise }) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, when);
      osc.frequency.exponentialRampToValueAtTime(58, when + 0.5);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.6, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.55);
      osc.connect(gain);
      gain.connect(out);
      osc.start(when);
      osc.stop(when + 0.6);

      const crack = ctx.createBufferSource();
      crack.buffer = noise;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1300, when);
      filter.frequency.exponentialRampToValueAtTime(120, when + 0.4);
      const crackGain = ctx.createGain();
      crackGain.gain.setValueAtTime(0.8, when);
      crackGain.gain.exponentialRampToValueAtTime(0.001, when + 0.45);
      crack.connect(filter);
      filter.connect(crackGain);
      crackGain.connect(out);
      crack.start(when);
      crack.stop(when + 0.48);
      return osc;
    }
  },

  // A slow falling figure: the mission is lost
  defeat: {
    build({ ctx, out, when }) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(294, when);
      osc.frequency.exponentialRampToValueAtTime(98, when + 1.3);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(0.5, when + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 1.4);
      osc.connect(gain);
      gain.connect(out);
      osc.start(when);
      osc.stop(when + 1.5);
      return osc;
    }
  }
};

export class MusicDirector {
  /** Every state the score understands (in definition order). */
  static get stateNames() {
    return Object.keys(STATES);
  }

  /** Every one-shot stinger this director can play (in definition order). */
  static get stingerNames() {
    return Object.keys(STINGERS);
  }

  /**
   * @param {AudioManager} audio - Supplies the AudioContext and the output node the score routes through
   */
  constructor(audio = null) {
    this.audio = audio;
    this._ctx = null;
    this._state = 'silent';
    this._running = false;
    this.buses = null;      // built on demand once a context exists (exposed for tests/debug)
    this._started = [];     // every started source, so dispose() can stop them
    this._noise = null;
    this._groove = null;
    this._intro = null;
  }

  get state() { return this._state; }
  get isRunning() { return this._running; }

  /**
   * Crossfades to a mission state. 'silent' stops the score and the ambience; the others start
   * it. Unknown names are ignored. Safe before the AudioContext exists: the requested state is
   * remembered and applied the first time one is available.
   * @param {string} name - One of MusicDirector.stateNames
   */
  setState(name) {
    if (!STATES[name]) return;
    this._running = name !== 'silent';
    if (name === this._state && this.buses) return; // Same state, nothing to retune
    const built = !!this.buses;
    this._state = name;
    if (!this._ensureBuilt()) return; // The build applies the remembered state itself
    if (built) this._applyState(this._rampFor(name));
  }

  /**
   * Plays a one-shot stinger over the score.
   * @param {string} name - One of MusicDirector.stingerNames
   * @returns {Object|null} The stinger's first source node, or null
   */
  stinger(name) {
    const def = STINGERS[name];
    if (!def || !this._ensureBuilt()) return null;
    return def.build({ ctx: this._ctx, out: this.buses.master, when: this._ctx.currentTime, noise: this._noise }) || null;
  }

  /**
   * Builds the score graph if the AudioContext has appeared since the last call, applying the
   * state remembered while there was none. The AudioManager calls this on its first unlock,
   * which is how the menu theme starts on the player's first click. Safe to call any time.
   * @returns {boolean} true once a context exists and the graph is built
   */
  refresh() {
    return this._ensureBuilt();
  }

  /** Silences the score and the ambience (the level is over, or the player left it). */
  stop() {
    this._running = false;
    this._state = 'silent';
    if (!this.buses) return;
    this._applyState(STOP_RAMP_SECONDS);
  }

  dispose() {
    this._running = false;
    this._state = 'silent';
    for (const source of this._started) {
      try { source.stop(); } catch { /* already stopped, or a context that never ran */ }
    }
    this._started = [];
    if (this.buses && this.buses.master) {
      try { this.buses.master.disconnect(); } catch { /* nothing to disconnect */ }
    }
    this.buses = null;
    this._ctx = null;
    this._noise = null;
    this._groove = null;
    this._intro = null;
  }

  // --- internals -----------------------------------------------------------

  /** Builds the layer graph the first time a context is available. */
  _ensureBuilt() {
    const ctx = this.audio ? this.audio.context : null;
    if (!ctx) return false;
    if (this.buses) return true;
    this._ctx = ctx;
    this._build(ctx);
    this._applyState(this._rampFor(this._state)); // The remembered state takes effect at birth
    return true;
  }

  _build(ctx) {
    const out = (this.audio && this.audio.outputNode) || ctx.destination;
    const master = ctx.createGain();
    master.gain.value = MUSIC_LEVEL;
    master.connect(out);

    this._noise = this._ensureNoise(ctx);
    const noise = this._noise;

    // The drone: two detuned saws through a dark filter, breathing slowly
    const drone = this._gain(ctx, 0, master);
    const droneTrem = ctx.createGain();
    droneTrem.gain.value = 0.5;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 240;
    droneFilter.Q.value = 0.6;
    droneFilter.connect(droneTrem);
    droneTrem.connect(drone);
    for (const detune of [-6, 5]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 55;
      osc.detune.value = detune;
      osc.connect(droneFilter);
      this._start(osc);
    }
    this._lfo(ctx, droneTrem.gain, 0.09, 0.15, 'sine');

    // The heartbeat: a sub pulse gated by a slow LFO, quicker in combat
    const pulse = this._gain(ctx, 0, master);
    const pulseTrem = ctx.createGain();
    pulseTrem.gain.value = 0.5;
    pulseTrem.connect(pulse);
    const pulseOsc = ctx.createOscillator();
    pulseOsc.type = 'sine';
    pulseOsc.frequency.value = 52;
    pulseOsc.connect(pulseTrem);
    this._start(pulseOsc);
    const pulseLfo = this._lfo(ctx, pulseTrem.gain, STATES.tense.pulseRate, 0.5, 'sawtooth');

    // The war drums: looped noise barked through a band, combat only
    const drums = this._gain(ctx, 0, master);
    const drumTrem = ctx.createGain();
    drumTrem.gain.value = 0.5;
    const drumFilter = ctx.createBiquadFilter();
    drumFilter.type = 'bandpass';
    drumFilter.frequency.value = 320;
    drumFilter.Q.value = 1.2;
    drumFilter.connect(drumTrem);
    drumTrem.connect(drums);
    const drumNoise = ctx.createBufferSource();
    drumNoise.buffer = noise;
    drumNoise.loop = true;
    drumNoise.connect(drumFilter);
    this._start(drumNoise);
    this._lfo(ctx, drumTrem.gain, STATES.combat.drumRate, 0.5, 'sawtooth');

    // The victory pad: a resolved major triad under a soft filter
    const pad = this._gain(ctx, 0, master);
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 900;
    padFilter.connect(pad);
    for (const frequency of PAD_FREQUENCIES) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      osc.connect(padFilter);
      this._start(osc);
    }

    // The trailer groove: a two-bar drum-and-bass loop, synthesized once and looped
    const groove = this._gain(ctx, 0, master);
    const grooveLoop = ctx.createBufferSource();
    grooveLoop.buffer = this._ensureGroove(ctx);
    grooveLoop.loop = true;
    grooveLoop.connect(groove);
    this._start(grooveLoop);

    // The intro groove: a hotter mission-opening loop, swapped in by the 'deploy' state
    const intro = this._gain(ctx, 0, master);
    const introLoop = ctx.createBufferSource();
    introLoop.buffer = this._ensureIntroGroove(ctx);
    introLoop.loop = true;
    introLoop.connect(intro);
    this._start(introLoop);

    // Ambience: surf wash and wind gusts, on whenever the score runs
    const ocean = this._gain(ctx, 0, master);
    const oceanTrem = ctx.createGain();
    oceanTrem.gain.value = 0.5;
    const oceanFilter = ctx.createBiquadFilter();
    oceanFilter.type = 'lowpass';
    oceanFilter.frequency.value = 420;
    oceanFilter.connect(oceanTrem);
    oceanTrem.connect(ocean);
    const oceanNoise = ctx.createBufferSource();
    oceanNoise.buffer = noise;
    oceanNoise.loop = true;
    oceanNoise.connect(oceanFilter);
    this._start(oceanNoise);
    this._lfo(ctx, oceanTrem.gain, 0.13, 0.2, 'sine');

    const wind = this._gain(ctx, 0, master);
    const windTrem = ctx.createGain();
    windTrem.gain.value = 0.5;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 700;
    windFilter.Q.value = 0.5;
    windFilter.connect(windTrem);
    windTrem.connect(wind);
    const windNoise = ctx.createBufferSource();
    windNoise.buffer = noise;
    windNoise.loop = true;
    windNoise.connect(windFilter);
    this._start(windNoise);
    this._lfo(ctx, windTrem.gain, 0.06, 0.2, 'sine');

    this.buses = { master, drone, pulse, drums, pad, groove, intro, ocean, wind, pulseLfo };
  }

  /** Crossfades every layer to the current state's targets. */
  _applyState(ramp) {
    const state = STATES[this._state] || STATES.silent;
    const now = this._ctx.currentTime;
    this._ramp(this.buses.drone.gain, state.drone, now, ramp);
    this._ramp(this.buses.pulse.gain, state.pulse, now, ramp);
    this._ramp(this.buses.drums.gain, state.drums, now, ramp);
    this._ramp(this.buses.pad.gain, state.pad, now, ramp);
    this._ramp(this.buses.groove.gain, state.groove, now, ramp);
    this._ramp(this.buses.intro.gain, state.intro, now, ramp);
    const ambience = this._running ? 1 : 0;
    this._ramp(this.buses.ocean.gain, AMB_OCEAN_LEVEL * ambience, now, ramp);
    this._ramp(this.buses.wind.gain, AMB_WIND_LEVEL * ambience, now, ramp);
    if (this.buses.pulseLfo) {
      this._ramp(this.buses.pulseLfo.frequency, state.pulseRate, now, Math.min(ramp, 0.6));
    }
  }

  /** The crossfade length a state deserves. */
  _rampFor(name) {
    if (name === 'victory') return VICTORY_RAMP_SECONDS;
    if (name === 'silent') return STOP_RAMP_SECONDS;
    return RAMP_SECONDS;
  }

  _gain(ctx, level, destination) {
    const gain = ctx.createGain();
    gain.gain.value = level;
    gain.connect(destination);
    return gain;
  }

  /** A slow oscillator driving a parameter (tremolo, rate changes ride on frequency ramps). */
  _lfo(ctx, param, rate, depth, type) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = depth;
    osc.connect(gain);
    gain.connect(param);
    this._start(osc);
    return osc;
  }

  _start(source) {
    try { source.start(this._ctx ? this._ctx.currentTime : 0); } catch { /* fakes and already-started sources */ }
    this._started.push(source);
  }

  /** Ramps a parameter from its current value to a target without scheduling pile-ups. */
  _ramp(param, target, now, seconds) {
    if (!param) return;
    if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(now);
    if (typeof param.setValueAtTime === 'function') param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(target, now + Math.max(0.001, seconds));
  }

  _ensureNoise(ctx) {
    if (this._noise) return this._noise;
    const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Synthesizes the two-bar trailer groove once: kick, snare and hats over a pumping bass line. */
  _ensureGroove(ctx) {
    if (this._groove) return this._groove;
    const sampleRate = ctx.sampleRate;
    const secondsPerBeat = 60 / TRAILER_BPM;
    const beats = TRAILER_BARS * TRAILER_BEATS_PER_BAR;
    const length = Math.round(sampleRate * beats * secondsPerBeat);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    const start = (seconds) => Math.round(seconds * sampleRate);

    const kick = (seconds) => {
      let phase = 0;
      for (let i = 0, at = start(seconds); at + i < length && i < sampleRate * 0.35; i++) {
        const t = i / sampleRate;
        phase += (2 * Math.PI * (42 + 130 * Math.exp(-t * 20))) / sampleRate;
        data[at + i] += Math.sin(phase) * Math.exp(-t * 12) * 0.75;
      }
    };

    const snare = (seconds) => {
      for (let i = 0, at = start(seconds); at + i < length && i < sampleRate * 0.2; i++) {
        const t = i / sampleRate;
        data[at + i] += ((Math.random() * 2 - 1) * 0.5 + Math.sin(2 * Math.PI * 190 * t) * 0.35) * Math.exp(-t * 26) * 0.6;
      }
    };

    const hat = (seconds) => {
      for (let i = 0, at = start(seconds); at + i < length && i < sampleRate * 0.06; i++) {
        data[at + i] += (Math.random() * 2 - 1) * Math.exp(-(i / sampleRate) * 90) * 0.14;
      }
    };

    const bass = (seconds, duration, frequency, level) => {
      let phase = 0;
      for (let i = 0, at = start(seconds); at + i < length && i < sampleRate * duration; i++) {
        const t = i / sampleRate;
        const env = Math.min(1, t * 120) * Math.exp(-t * 6);
        phase += (2 * Math.PI * frequency) / sampleRate;
        data[at + i] += (Math.sin(phase) + 0.5 * Math.sin(phase * 2) + 0.22 * Math.sin(phase * 3)) * env * level * 0.35;
      }
    };

    const beat = (index) => index * secondsPerBeat;
    for (const at of [0, 2, 4, 5.5, 6, 7.5]) kick(beat(at));
    for (const at of [1, 3, 5, 7]) snare(beat(at));
    for (let at = 0.5; at < beats; at += 1) hat(beat(at));
    for (let step = 0; step < beats * 2; step++) {
      const frequency = step === beats * 2 - 2 ? 65.41 : step === beats * 2 - 1 ? 73.42 : 55;
      bass(beat(step / 2), secondsPerBeat / 2, frequency, step % 4 === 0 ? 1 : 0.6);
    }

    this._groove = buffer;
    return buffer;
  }

  /**
   * Synthesizes the mission-opening intro groove once: a hotter, faster cousin of the menu loop -
   * four-on-the-floor kick, backbeat snare with a fill, offbeat hats, a pumping octave bass and
   * dark minor stabs (120 BPM -> 4.0 s per loop).
   */
  _ensureIntroGroove(ctx) {
    if (this._intro) return this._intro;
    const sampleRate = ctx.sampleRate;
    const secondsPerBeat = 60 / INTRO_BPM;
    const beats = INTRO_BARS * INTRO_BEATS_PER_BAR;
    const length = Math.round(sampleRate * beats * secondsPerBeat);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    const start = (seconds) => Math.round(seconds * sampleRate);

    const kick = (seconds, level = 1) => {
      let phase = 0;
      for (let i = 0, at = start(seconds); at + i < length && i < sampleRate * 0.3; i++) {
        const t = i / sampleRate;
        phase += (2 * Math.PI * (45 + 150 * Math.exp(-t * 22))) / sampleRate;
        data[at + i] += Math.sin(phase) * Math.exp(-t * 11) * 0.8 * level;
      }
    };

    const snare = (seconds, level = 1) => {
      for (let i = 0, at = start(seconds); at + i < length && i < sampleRate * 0.18; i++) {
        const t = i / sampleRate;
        data[at + i] += ((Math.random() * 2 - 1) * 0.5 + Math.sin(2 * Math.PI * 200 * t) * 0.35) * Math.exp(-t * 24) * 0.6 * level;
      }
    };

    const hat = (seconds) => {
      for (let i = 0, at = start(seconds); at + i < length && i < sampleRate * 0.05; i++) {
        data[at + i] += (Math.random() * 2 - 1) * Math.exp(-(i / sampleRate) * 110) * 0.12;
      }
    };

    const crash = (seconds) => {
      for (let i = 0, at = start(seconds); at + i < length && i < sampleRate * 0.6; i++) {
        const t = i / sampleRate;
        data[at + i] += (Math.random() * 2 - 1) * Math.exp(-t * 7) * 0.2;
      }
    };

    const bass = (seconds, duration, frequency, level) => {
      let phase = 0;
      for (let i = 0, at = start(seconds); at + i < length && i < sampleRate * duration; i++) {
        const t = i / sampleRate;
        const env = Math.min(1, t * 160) * Math.exp(-t * 7);
        phase += (2 * Math.PI * frequency) / sampleRate;
        data[at + i] += (Math.sin(phase) + 0.5 * Math.sin(phase * 2) + 0.22 * Math.sin(phase * 3)) * env * level * 0.35;
      }
    };

    // A dark minor stab: three saw voices (A2 - C3 - E3) under a short, hard envelope
    const CHORD = [110, 130.81, 164.81];
    const stab = (seconds) => {
      const phases = [0, 0, 0];
      for (let i = 0, at = start(seconds); at + i < length && i < sampleRate * 0.26; i++) {
        const t = i / sampleRate;
        const env = Math.min(1, t * 170) * Math.exp(-t * 11);
        for (let voice = 0; voice < CHORD.length; voice++) {
          phases[voice] += (2 * Math.PI * CHORD[voice]) / sampleRate;
          const saw = ((phases[voice] / (2 * Math.PI)) % 1) * 2 - 1;
          data[at + i] += saw * env * 0.09;
        }
      }
    };

    const beat = (index) => index * secondsPerBeat;
    crash(0);
    for (let at = 0; at < beats; at += 1) kick(beat(at), at % 4 === 0 ? 1 : 0.85);
    kick(beat(beats - 0.5), 0.9); // the pickup into the loop turn
    for (const at of [1, 3, 5, 7]) snare(beat(at));
    for (const at of [7.25, 7.5, 7.75]) snare(beat(at), 0.45); // the fill home
    for (let at = 0.5; at < beats; at += 1) hat(beat(at));
    for (const at of [0.5, 2.5, 4.5, 6.5]) stab(beat(at));
    for (let step = 0; step < beats * 4; step++) {
      const frequency = step === beats * 4 - 2 ? 73.42 : step === beats * 4 - 1 ? 82.41 : (step % 4 === 2 ? 110 : 55);
      bass(beat(step / 4), secondsPerBeat / 4, frequency, step % 4 === 0 ? 1 : 0.62);
    }

    this._intro = buffer;
    return buffer;
  }
}
