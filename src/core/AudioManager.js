/**
 * AudioManager
 * The game's sound engine. Every effect is synthesized procedurally with the Web Audio API
 * (oscillators plus one shared white-noise buffer), so the game ships no audio files. Sounds
 * are short one-shot voices routed through a single master gain; the mix (volume and mute)
 * belongs to the player and is saved in localStorage, like the graphics settings.
 *
 * Browsers only allow pages to make noise after a user gesture, so the AudioContext is
 * created lazily on the first pointerdown/keydown. Until then - and anywhere AudioContext
 * does not exist, such as the Node test runner - every call is a silent no-op.
 *
 * Sounds may be positioned in the world: `play('plasma', someVector3)`. Distance falls off
 * from the active camera (full at the reference distance, silent beyond the cutoff) and the
 * sound pans left/right along the camera's right vector. Busy scenes stay cheap: at most
 * MAX_VOICES one-shots ring out at once, each sound may set a minimum repeat interval, and
 * positional plays obey a tighter floor so a whole squad firing bursts cannot stack dozens
 * of voices. The player's own weapons are never throttled - their gun must always be heard.
 */

const STORAGE_KEY = 'scopecreep.audio';
const DEFAULT_VOLUME = 0.8;

const MAX_VOICES = 24;                 // concurrent one-shot voices before new plays are refused
const POSITIONAL_MIN_INTERVAL = 0.05;  // s - floor between positional plays of the same sound
const REFERENCE_DISTANCE = 12;         // m - full volume at the camera, halved this far out
const MAX_DISTANCE = 140;              // m - sounds further away than this are not played

function browserStorage() {
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

function defaultContextFactory() {
  try {
    if (typeof AudioContext !== 'undefined') return new AudioContext();
    if (typeof webkitAudioContext !== 'undefined') return new webkitAudioContext();
  } catch {
    return null;
  }
  return null;
}

const SOUNDS = {
  // The machine gun: a sharp crack over a low thump
  gunshot: {
    gain: 0.5,
    minInterval: 0,
    pitchJitter: 0.12,
    build({ ctx, when, out, noise, pitch }) {
      const crack = ctx.createBufferSource();
      crack.buffer = noise;
      crack.playbackRate.value = pitch;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.setValueAtTime(1800 * pitch, when);
      band.Q.value = 0.8;
      const crackGain = ctx.createGain();
      crackGain.gain.setValueAtTime(1, when);
      crackGain.gain.exponentialRampToValueAtTime(0.001, when + 0.09);
      crack.connect(band);
      band.connect(crackGain);
      crackGain.connect(out);
      crack.start(when);
      crack.stop(when + 0.1);

      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(160 * pitch, when);
      thump.frequency.exponentialRampToValueAtTime(50 * pitch, when + 0.1);
      const thumpGain = ctx.createGain();
      thumpGain.gain.setValueAtTime(0.9, when);
      thumpGain.gain.exponentialRampToValueAtTime(0.001, when + 0.11);
      thump.connect(thumpGain);
      thumpGain.connect(out);
      thump.start(when);
      thump.stop(when + 0.12);
      return thump;
    }
  },

  // Alien plasma bolt: a bright descending "pew"
  plasma: {
    gain: 0.35,
    minInterval: 0,
    pitchJitter: 0.15,
    build({ ctx, when, out, pitch }) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1100 * pitch, when);
      osc.frequency.exponentialRampToValueAtTime(160 * pitch, when + 0.25);
      const tame = ctx.createBiquadFilter();
      tame.type = 'lowpass';
      tame.frequency.value = 2600 * pitch;
      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(0.8, when);
      oscGain.gain.exponentialRampToValueAtTime(0.001, when + 0.25);
      osc.connect(tame);
      tame.connect(oscGain);
      oscGain.connect(out);
      osc.start(when);
      osc.stop(when + 0.27);
      return osc;
    }
  },

  // Hit confirmation on the crosshair
  hit: {
    gain: 0.3,
    minInterval: 0.05,
    pitchJitter: 0.08,
    build({ ctx, when, out, pitch }) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1150 * pitch, when);
      osc.frequency.exponentialRampToValueAtTime(820 * pitch, when + 0.045);
      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(1, when);
      oscGain.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
      osc.connect(oscGain);
      oscGain.connect(out);
      osc.start(when);
      osc.stop(when + 0.06);
      return osc;
    }
  },

  // The player takes damage
  hurt: {
    gain: 0.6,
    minInterval: 0.25,
    pitchJitter: 0.06,
    build({ ctx, when, out, pitch }) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220 * pitch, when);
      osc.frequency.exponentialRampToValueAtTime(70 * pitch, when + 0.16);
      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(0.9, when);
      oscGain.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
      osc.connect(oscGain);
      oscGain.connect(out);
      osc.start(when);
      osc.stop(when + 0.2);
      return osc;
    }
  },

  // Artillery shell detonation (wherever it lands: terrain, actors or water)
  explosion: {
    gain: 0.9,
    minInterval: 0.06,
    pitchJitter: 0.1,
    build({ ctx, when, out, noise, pitch }) {
      const blast = ctx.createBufferSource();
      blast.buffer = noise;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(2500 * pitch, when);
      lowpass.frequency.exponentialRampToValueAtTime(80, when + 0.8);
      const blastGain = ctx.createGain();
      blastGain.gain.setValueAtTime(1, when);
      blastGain.gain.exponentialRampToValueAtTime(0.001, when + 0.9);
      blast.connect(lowpass);
      lowpass.connect(blastGain);
      blastGain.connect(out);
      blast.start(when);
      blast.stop(when + 0.92);

      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(90 * pitch, when);
      sub.frequency.exponentialRampToValueAtTime(28, when + 0.7);
      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.8, when);
      subGain.gain.exponentialRampToValueAtTime(0.001, when + 0.85);
      sub.connect(subGain);
      subGain.connect(out);
      sub.start(when);
      sub.stop(when + 0.88);
      return blast;
    }
  },

  // Magazine out, magazine in
  reload: {
    gain: 0.45,
    minInterval: 0.5,
    pitchJitter: 0.05,
    build({ ctx, when, out, noise, pitch }) {
      const clicks = ctx.createBufferSource();
      clicks.buffer = noise;
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 1400 * pitch;
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, when);
      envelope.gain.exponentialRampToValueAtTime(0.8, when + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
      envelope.gain.setValueAtTime(0.0001, when + 0.18);
      envelope.gain.exponentialRampToValueAtTime(0.7, when + 0.192);
      envelope.gain.exponentialRampToValueAtTime(0.0001, when + 0.24);
      clicks.connect(highpass);
      highpass.connect(envelope);
      envelope.connect(out);
      clicks.start(when);
      clicks.stop(when + 0.26);
      return clicks;
    }
  }
};

export class AudioManager {
  /** Names of every sound this manager can play (in definition order). */
  static get soundNames() {
    return Object.keys(SOUNDS);
  }

  /**
   * @param {GameWorld} gameWorld - Supplies the listener camera for positional sounds
   * @param {Object} [options]
   * @param {Function} [options.contextFactory] - Creates the AudioContext; injectable for tests
   * @param {Object} [options.storage] - localStorage-like { getItem, setItem }; injectable for tests
   */
  constructor(gameWorld = null, { contextFactory = defaultContextFactory, storage = browserStorage() } = {}) {
    this.gameWorld = gameWorld;
    this._contextFactory = contextFactory;
    this._storage = storage;

    this._ctx = null;
    this._master = null;
    this._noise = null;
    this._volume = DEFAULT_VOLUME;
    this._muted = false;
    this._activeVoices = 0;
    this._lastPlayAt = Object.create(null);
    this._lastVoiceGain = 1;              // mix telemetry: gain of the most recent voice (tests/debug)
    this._spatial = { gain: 1, pan: 0 };  // scratch result, reused to avoid per-play allocations
    this._unlockBound = null;

    this._load();
    this._setupUnlock();
  }

  get volume() { return this._volume; }
  get muted() { return this._muted; }
  get activeVoices() { return this._activeVoices; }

  set volume(value) {
    this._volume = Math.max(0, Math.min(1, Number(value) || 0));
    this._applyMasterGain();
    this._save();
  }

  set muted(value) {
    this._muted = !!value;
    this._applyMasterGain();
    this._save();
  }

  /**
   * Creates the AudioContext on the first user gesture (browser autoplay policy).
   * Safe to call any number of times; a no-op where no AudioContext exists.
   * @returns {AudioContext|null}
   */
  unlock() {
    if (this._ctx) return this._ctx;
    this._removeUnlockListeners();
    let ctx = null;
    try {
      ctx = this._contextFactory();
    } catch {
      ctx = null;
    }
    if (!ctx) return null;
    this._ctx = ctx;
    this._master = ctx.createGain();
    this._master.gain.value = this._muted ? 0 : this._volume;
    this._master.connect(ctx.destination);
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
    return ctx;
  }

  /**
   * Plays a one-shot sound.
   * @param {string} name - One of AudioManager.soundNames
   * @param {THREE.Vector3} [position] - World position; omitted for the player's own 2D sounds
   * @param {number} [volumeScale] - Extra per-call gain multiplier (e.g. quieter ally gunfire)
   * @returns {Object|null} The voice's source node, or null if nothing was played
   */
  play(name, position = null, volumeScale = 1) {
    if (this._muted) return null;
    const ctx = this._ctx;
    if (!ctx) return null;
    const def = SOUNDS[name];
    if (!def) return null;
    if (this._activeVoices >= MAX_VOICES) return null;

    let gain = def.gain * volumeScale;
    let pan = 0;
    if (position) {
      if (!this._spatialize(position)) return null;
      gain *= this._spatial.gain;
      pan = this._spatial.pan;
    }

    const now = ctx.currentTime;
    const minInterval = position ? Math.max(def.minInterval, POSITIONAL_MIN_INTERVAL) : def.minInterval;
    if (minInterval > 0) {
      const last = this._lastPlayAt[name];
      if (last !== undefined && now - last < minInterval) return null;
    }
    this._lastPlayAt[name] = now;

    const voice = ctx.createGain();
    voice.gain.setValueAtTime(gain, now);
    let tail = voice;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(pan, now);
      voice.connect(panner);
      tail = panner;
    }
    tail.connect(this._master);
    this._lastVoiceGain = gain;

    const pitch = 1 + (Math.random() * 2 - 1) * def.pitchJitter;
    const source = def.build({ ctx, when: now, out: voice, noise: this._ensureNoise(ctx), pitch });
    if (source) {
      this._activeVoices += 1;
      source.onended = () => { this._activeVoices = Math.max(0, this._activeVoices - 1); };
    }
    return source;
  }

  dispose() {
    this._removeUnlockListeners();
    const ctx = this._ctx;
    this._ctx = null;
    this._master = null;
    this._noise = null;
    this._activeVoices = 0;
    if (ctx && typeof ctx.close === 'function') {
      try { ctx.close(); } catch { /* already closed */ }
    }
  }

  // --- internals -----------------------------------------------------------

  _setupUnlock() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    this._unlockBound = () => this.unlock();
    window.addEventListener('pointerdown', this._unlockBound, { once: true });
    window.addEventListener('keydown', this._unlockBound, { once: true });
  }

  _removeUnlockListeners() {
    if (!this._unlockBound) return;
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('pointerdown', this._unlockBound);
      window.removeEventListener('keydown', this._unlockBound);
    }
    this._unlockBound = null;
  }

  _ensureNoise(ctx) {
    if (!this._noise) {
      const length = Math.floor(ctx.sampleRate);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this._noise = buffer;
    }
    return this._noise;
  }

  /**
   * Fills the scratch spatial result from the active camera's world matrix: distance
   * fall-off (REFERENCE_DISTANCE / (REFERENCE_DISTANCE + distance)) and a pan computed
   * against the camera's right vector (the matrix's first column). Pure scalar math,
   * so positional plays allocate nothing.
   * @returns {boolean} false when the position is beyond MAX_DISTANCE
   */
  _spatialize(position) {
    const camera = this._listener();
    if (!camera || !camera.matrixWorld || !camera.matrixWorld.elements) {
      this._spatial.gain = 1;
      this._spatial.pan = 0;
      return true;
    }
    const e = camera.matrixWorld.elements;
    const dx = position.x - e[12];
    const dy = position.y - e[13];
    const dz = position.z - e[14];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance > MAX_DISTANCE) return false;
    this._spatial.gain = REFERENCE_DISTANCE / (REFERENCE_DISTANCE + distance);
    if (distance > 0.001) {
      const pan = (dx * e[0] + dy * e[1] + dz * e[2]) / distance;
      this._spatial.pan = Math.max(-0.7, Math.min(0.7, pan * 0.7));
    } else {
      this._spatial.pan = 0;
    }
    return true;
  }

  _listener() {
    if (!this.gameWorld) return null;
    if (typeof this.gameWorld.getActiveCamera === 'function') return this.gameWorld.getActiveCamera();
    return this.gameWorld.camera || null;
  }

  _applyMasterGain() {
    if (this._master) this._master.gain.value = this._muted ? 0 : this._volume;
  }

  _load() {
    if (!this._storage) return;
    try {
      const raw = this._storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved && typeof saved.volume === 'number') {
        this._volume = Math.max(0, Math.min(1, saved.volume));
      }
      if (saved && typeof saved.muted === 'boolean') this._muted = saved.muted;
    } catch {
      // A corrupted entry is ignored; the defaults apply
    }
  }

  _save() {
    if (!this._storage) return;
    try {
      this._storage.setItem(STORAGE_KEY, JSON.stringify({ volume: this._volume, muted: this._muted }));
    } catch {
      // Storage can be unavailable (private mode); settings simply do not persist
    }
  }
}
