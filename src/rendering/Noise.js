/**
 * Noise
 * Small deterministic 2D value noise and fractal sum for procedural terrain and prop placement.
 * Same inputs always give the same output, so every client builds an identical island.
 */

function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/**
 * Smoothly interpolated value noise in [0, 1].
 */
export function valueNoise2D(x, z, seed = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);

  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/**
 * Fractal Brownian motion: several octaves of value noise, normalized to [0, 1].
 */
export function fbm2D(x, z, octaves = 4, seed = 0) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise2D(x * frequency, z * frequency, seed + i * 17);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}

/**
 * Value noise on a lattice that wraps every `cells` steps, so the result tiles
 * seamlessly (f(x, z) == f(x + cells, z + cells)). Used for cloud shade tiles.
 */
export function periodicValueNoise2D(x, z, cells, seed = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  const x0 = ((ix % cells) + cells) % cells;
  const z0 = ((iz % cells) + cells) % cells;
  const x1 = (x0 + 1) % cells;
  const z1 = (z0 + 1) % cells;

  const a = hash2(x0, z0, seed);
  const b = hash2(x1, z0, seed);
  const c = hash2(x0, z1, seed);
  const d = hash2(x1, z1, seed);

  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/**
 * Fractal sum of periodicValueNoise2D that still tiles: doubling at exact powers
 * of two keeps every octave's period on the same lattice (cells * 2^i steps).
 */
export function periodicFbm2D(x, z, octaves, cells, seed = 0) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * periodicValueNoise2D(x * frequency, z * frequency, cells * frequency, seed + i * 17);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2; // exact, so cells * frequency stays a whole number of lattice steps
  }
  return sum / norm;
}

/**
 * Seeded pseudo-random generator (mulberry32). Returns a function giving floats in [0, 1).
 */
export function createRandom(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hermite smoothstep, 0 below edge0 and 1 above edge1.
 */
export function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
