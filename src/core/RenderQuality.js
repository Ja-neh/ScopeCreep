// WebGL renderers that draw on the CPU: very slow, so the game starts in a light preset
const SOFTWARE_RENDERERS = /swiftshader|basic render driver|llvmpipe|softpipe|software rasterizer/i;

/** Resolutions the player can choose: share of the screen's full resolution. */
export const RESOLUTION_CHOICES = [1, 0.85, 0.7, 0.55, 0.4];
const STORAGE_KEY = 'scopecreep.graphics';
const MAX_PIXEL_RATIO = 2;

// Measuring, and the Auto setting
const WINDOW_SECONDS = 1;             // Judge the frame rate over this long...
const WINDOW_MIN_FRAMES = 5;          // ...and over at least this many frames, so one hitch is never the verdict
const SLOW_FRAME_MS = 1000 / 28;      // Auto: slower than about 28 fps, lower the resolution a step
const FAST_FRAME_MS = 1000 / 50;      // Auto: faster than about 50 fps, raise it a step
const STEP_DOWN = 0.85;
const STEP_UP = 1.1;

// Recommendations
const SMOOTH_FPS = 30;                // Below this, recommend lighter settings
const HEADROOM_FPS = 50;              // At or above this, recommend sharper settings
const TARGET_FPS = 35;                // Lighter settings aim for this

const SOFTWARE_RECOMMENDATION = { resolution: 0.4, shadows: false };
const GPU_RECOMMENDATION = { resolution: 1, shadows: true };

/**
 * True if `rendererName` (WebGL's UNMASKED_RENDERER string) is a software renderer.
 */
export function isSoftwareRenderer(rendererName) {
  return SOFTWARE_RENDERERS.test(String(rendererName || ''));
}

/**
 * The graphics card's name from WebGL's renderer string, e.g.
 * 'ANGLE (AMD, AMD Radeon(TM) RX Vega 10 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' -> 'AMD Radeon(TM) RX Vega 10 Graphics'.
 */
export function friendlyGpuName(rendererName) {
  const name = String(rendererName || '').trim();
  const angle = name.match(/^ANGLE \([^,]+,\s*(.+?)(?:\s+\(0x[0-9a-f]+\))?\s+(?:Direct3D|OpenGL|Vulkan|Metal)/i);
  return (angle ? angle[1] : name) || 'unknown';
}

function percent(scale) {
  return `${Math.round(scale * 100)}%`;
}

function browserStorage() {
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * RenderQuality
 * The graphics settings, chosen by the player, with a recommendation for their computer.
 * - Resolution: a share of the screen's full resolution (RESOLUTION_CHOICES), or 'auto', which
 *   lowers it a step when frames are slow and raises it again when there is headroom.
 * - Shadows on or off.
 * - Recommended settings: from the graphics card at first (a software renderer, meaning no GPU
 *   in use, gets the lightest settings), then from the frame rate measured while playing.
 * - First run: the recommended settings. Afterwards: whatever the player picked (saved in the
 *   browser). Antialiasing can only be chosen when the WebGL context is created, so GameWorld
 *   asks probe() first and leaves it off for software renderers.
 * GameWorld owns it and calls update() once per rendered gameplay frame (Phase 7).
 */
export class RenderQuality {
  /**
   * Which GPU WebGL will use, from a throwaway context. Call before creating the renderer.
   * @returns {{renderer: string, software: boolean}}
   */
  static probe() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return { renderer: 'none', software: false };
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return { renderer, software: isSoftwareRenderer(renderer) };
    } catch {
      return { renderer: 'unknown', software: false };
    }
  }

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene - Its materials are rebuilt when shadows are switched
   * @param {Object} [options]
   * @param {boolean} [options.software=false] - No GPU in use
   * @param {string} [options.gpuName] - WebGL's renderer string
   * @param {number} [options.devicePixelRatio]
   * @param {Storage|null} [options.storage] - Where the player's choice is kept (localStorage)
   */
  constructor(renderer, scene, { software = false, gpuName = '', devicePixelRatio = window.devicePixelRatio || 1, storage = browserStorage() } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.software = software;
    this.gpuName = friendlyGpuName(gpuName);
    this.storage = storage;
    this.maxPixelRatio = Math.min(devicePixelRatio, MAX_PIXEL_RATIO);

    this.recommended = { ...(software ? SOFTWARE_RECOMMENDATION : GPU_RECOMMENDATION) };
    this.measuredFps = null;
    this._measuredScale = null;
    this._measuredShadows = null;

    const saved = this._load();
    this.hasSavedChoice = saved !== null;
    this.settings = saved || { ...this.recommended };
    this.scale = this.settings.resolution === 'auto' ? this.recommended.resolution : this.settings.resolution;
    this.shadowsEnabled = this.settings.shadows;

    this._frameTimes = [];
    this._windowElapsed = 0;
    this._lastTime = null;

    renderer.shadowMap.enabled = this.shadowsEnabled;
    renderer.setPixelRatio(this.pixelRatio);
  }

  get pixelRatio() {
    return this.scale * this.maxPixelRatio;
  }

  /** Share of the screen's full resolution being rendered (1 = full). */
  get renderScale() {
    return this.scale;
  }

  get isAuto() {
    return this.settings.resolution === 'auto';
  }

  /**
   * Records one rendered frame; once per window, updates the measured frame rate, the
   * recommendation, and (on Auto) the resolution. Call once per gameplay frame.
   * @param {number} [now] - Milliseconds (performance.now())
   */
  update(now = performance.now()) {
    if (this._lastTime === null) {
      this._lastTime = now;
      return;
    }
    const frameMs = now - this._lastTime;
    this._lastTime = now;
    this._frameTimes.push(frameMs);
    this._windowElapsed += frameMs / 1000;
    if (this._windowElapsed < WINDOW_SECONDS || this._frameTimes.length < WINDOW_MIN_FRAMES) return;

    // The median shrugs off one-off hitches (loading, shader compiles)
    this._frameTimes.sort((a, b) => a - b);
    const median = this._frameTimes[Math.floor(this._frameTimes.length / 2)];
    this._frameTimes.length = 0;
    this._windowElapsed = 0;

    this.measuredFps = 1000 / median;
    this._measuredScale = this.scale;
    this._measuredShadows = this.shadowsEnabled;
    this._updateRecommendation();
    if (this.isAuto) this._adapt(median);
  }

  /** Forget the frame timing (e.g. after a pause, so the paused time is not one long frame). */
  resetTiming() {
    this._lastTime = null;
    this._frameTimes.length = 0;
    this._windowElapsed = 0;
  }

  _adapt(medianFrameMs) {
    const min = RESOLUTION_CHOICES[RESOLUTION_CHOICES.length - 1];
    if (medianFrameMs > SLOW_FRAME_MS && this.scale > min) {
      this._setScale(Math.max(min, this.scale * STEP_DOWN));
    } else if (medianFrameMs < FAST_FRAME_MS && this.scale < 1) {
      this._setScale(Math.min(1, this.scale * STEP_UP));
    }
  }

  /**
   * From the measured frame rate: lighter settings if it is under 30 fps, sharper ones (one step
   * at a time) if it is over 50, otherwise what is running now.
   */
  _updateRecommendation() {
    const fps = this.measuredFps;
    const scale = this._measuredScale;
    const shadows = this._measuredShadows;
    let resolution = snapToChoice(scale);
    let wantShadows = shadows;

    if (fps < SMOOTH_FPS) {
      // Most of the cost is pixels: aim for about 35 fps
      const target = scale * Math.sqrt(fps / TARGET_FPS);
      const lighter = RESOLUTION_CHOICES.find((choice) => choice <= target + 1e-6);
      resolution = lighter !== undefined ? lighter : RESOLUTION_CHOICES[RESOLUTION_CHOICES.length - 1];
      if (resolution >= snapToChoice(scale)) wantShadows = false; // Already as low as it goes: drop shadows too
    } else if (fps >= HEADROOM_FPS) {
      const sharper = [...RESOLUTION_CHOICES].reverse().find((choice) => choice > scale + 1e-6);
      if (sharper !== undefined) resolution = sharper;
      else wantShadows = true; // Full resolution with room to spare: shadows too
    }
    this.recommended = { resolution, shadows: wantShadows };
  }

  /** Why the recommendation is what it is, in a sentence or two. */
  get recommendationReason() {
    const card = this.software
      ? 'No graphics card is in use: the browser is drawing the game on the CPU (software rendering).'
      : `Graphics card: ${this.gpuName}.`;
    if (this.measuredFps === null) return card;
    const shadows = this._measuredShadows ? ' with shadows' : '';
    return `${card} At ${percent(this._measuredScale)} resolution${shadows} it runs at ${Math.round(this.measuredFps)} fps.`;
  }

  get isUsingRecommended() {
    return this.settings.resolution === this.recommended.resolution && this.settings.shadows === this.recommended.shadows;
  }

  /**
   * @param {number|'auto'} choice - One of RESOLUTION_CHOICES, or 'auto'
   */
  setResolution(choice) {
    if (choice !== 'auto' && !RESOLUTION_CHOICES.includes(choice)) return;
    this.settings.resolution = choice;
    if (choice !== 'auto') this._setScale(choice);
    this._save();
  }

  setShadows(enabled) {
    this.settings.shadows = !!enabled;
    this._applyShadows(!!enabled);
    this._save();
  }

  useRecommended() {
    this.setResolution(this.recommended.resolution);
    this.setShadows(this.recommended.shadows);
  }

  /**
   * Everything a settings screen needs.
   */
  describe() {
    const rec = this.recommended;
    return {
      resolution: this.settings.resolution,
      scale: this.scale,
      shadows: this.settings.shadows,
      choices: ['auto', ...RESOLUTION_CHOICES],
      recommended: { ...rec },
      recommendedText: `${percent(rec.resolution)} resolution, shadows ${rec.shadows ? 'on' : 'off'}`,
      reason: this.recommendationReason,
      isUsingRecommended: this.isUsingRecommended,
      measuredFps: this.measuredFps
    };
  }

  /**
   * The window moved to a screen with a different pixel ratio, or was resized.
   */
  onResize(devicePixelRatio = window.devicePixelRatio || 1) {
    this.maxPixelRatio = Math.min(devicePixelRatio, MAX_PIXEL_RATIO);
    this.renderer.setPixelRatio(this.pixelRatio);
  }

  _setScale(scale) {
    this.scale = scale;
    this.renderer.setPixelRatio(this.pixelRatio);
  }

  /**
   * Turns the shadow pass on or off; every material is rebuilt with (or without) shadow code.
   */
  _applyShadows(enabled) {
    if (enabled === this.shadowsEnabled) return;
    this.shadowsEnabled = enabled;
    this.renderer.shadowMap.enabled = enabled;
    this.scene.traverse((object) => {
      if (!object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.needsUpdate = true;
    });
  }

  _load() {
    if (!this.storage) return null;
    try {
      const saved = JSON.parse(this.storage.getItem(STORAGE_KEY));
      const resolutionOk = saved && (saved.resolution === 'auto' || RESOLUTION_CHOICES.includes(saved.resolution));
      return resolutionOk && typeof saved.shadows === 'boolean' ? { resolution: saved.resolution, shadows: saved.shadows } : null;
    } catch {
      return null;
    }
  }

  _save() {
    this.hasSavedChoice = true;
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Storage unavailable (private window, blocked): the choice lasts for this session only
    }
  }
}

/** The listed resolution nearest to `scale` (Auto can sit between them). */
function snapToChoice(scale) {
  let best = RESOLUTION_CHOICES[0];
  for (const choice of RESOLUTION_CHOICES) {
    if (Math.abs(choice - scale) < Math.abs(best - scale)) best = choice;
  }
  return best;
}
