import { Vegetation } from '../../rendering/Vegetation.js';
import { valueNoise2D, createRandom, smoothstep } from '../../rendering/Noise.js';

const SEED = 4242;
const SCATTER_BOUNDS = { minX: -290, maxX: 290, minZ: -530, maxZ: 230 }; // Covers the whole island
const VILLAGE_MARGIN = 10;    // Extra open ground around Level 3's village plateau
const BATTLEFIELD_MIN_Z = 30; // Full density south of here (Level 2's fight); thinner elsewhere
const OUTSIDE_DENSITY = 0.35;
const SHADOW_MIN_Z = 0;       // Props south of here cast shadows (the sun's shadow map covers z = -30..310)

// Bush concealment
const BUSH_RADIUS = 1.5;      // Hiding radius of a bush at scale 1 (meters)
const BUSH_HEIGHT = 1.6;
const BUSH_CELL = 8;          // Lookup grid cell size

// Cover queries (for AI)
const COVER_MIN_HEIGHT = 1.5;    // Rock must stand this tall above the ground to hide someone standing
const COVER_STANDOFF = 1.0;      // How far behind the rock's edge to stand
const COVER_SEARCH_RADIUS = 30;  // Only rocks this close to the searcher are considered

// Numeric grid key (no string building in per-frame lookups)
const cellKey = (cx, cz) => (cx + 512) * 1024 + (cz + 512);

/**
 * BeachCover
 * Level 2's scenery and cover: palms along the sand, a jungle tree line behind it, boulders
 * on the beach and hills, and bushes to hide in. Placement is seeded, so every player gets the
 * same island; the jungle path and the landing zone stay open.
 * Answers "is this actor hidden?" (crouched inside a bush) and "where can I take cover?"
 * (behind a tall rock, away from a threat) for the AI.
 */
export class BeachCover {
  /**
   * @param {GameWorld} gameWorld
   * @param {BeachEnvironment} environment
   * @param {Array<{x: number, z: number, radius: number}>} [clearings] - Circles to leave open
   */
  constructor(gameWorld, environment, clearings = []) {
    this.gameWorld = gameWorld;
    this.environment = environment;
    this.clearings = clearings;

    this.vegetation = [];
    this.bushes = [];
    this.rocks = []; // { x, z, radius, height } for cover queries
    this._bushGrid = new Map();
    this._solids = []; // { x, z, radius } of rocks and trunks already placed, to avoid overlaps
  }

  build() {
    const random = createRandom(SEED);
    const placements = { palms: [], trees: [], rocks: [], bushes: [] };

    // Rocks first: they are the main cover. On the battlefield (beach and jungle edge) they come
    // in clusters around a head-high boulder you can hide behind standing; elsewhere they are scattered.
    this._scatter(16, random, (c) => {
      if (c.z < BATTLEFIELD_MIN_Z - 20 || c.inland < 6 || c.inland > 95 || c.path < 6) return 0;
      return 0.55;
    }, (c) => this._placeRockCluster(placements.rocks, c, random));
    this._scatter(20, random, (c) => (c.inland >= 40 && c.path > 5 ? (0.15 + c.slope * 0.6) * c.density : 0), (c) => {
      const base = 1.0 + random() * 2.0;
      const s = { x: base * (0.8 + random() * 0.4), y: base * (0.6 + random() * 0.4), z: base * (0.8 + random() * 0.4) };
      return this._placeRock(placements.rocks, c, s, random);
    });

    // Jungle tree line behind the beach
    this._scatter(12, random, (c) => {
      if (c.inland < 45 || c.path < 8 || c.slope > 0.45) return 0;
      return smoothstep(45, 70, c.inland) * 0.75 * c.density * (0.5 + c.noise);
    }, (c) => this._placeTrunk(placements.trees, c, 0.8 + random() * 0.5, 0.45, 0.3, random));

    // Palms along the sand
    this._scatter(14, random, (c) => {
      if (c.inland < 6 || c.inland > 55 || c.path < 5 || c.slope > 0.3) return 0;
      return 0.55 * c.density * (0.6 + 0.8 * c.noise);
    }, (c) => this._placeTrunk(placements.palms, c, 0.85 + random() * 0.4, 0.4, 0.2, random));

    // Bushes in clumps, thicker along the edges of the jungle path
    this._scatter(8, random, (c) => {
      if (c.inland < 18 || c.inland > 140 || c.path < 3.5 || c.slope > 0.4) return 0;
      const clump = smoothstep(0.45, 0.7, valueNoise2D(c.x * 0.05, c.z * 0.05, SEED + 5));
      const pathEdge = c.path < 9 ? 0.25 : 0;
      // Bushes are for hiding, which only matters on the battlefield
      return (clump * 0.7 + pathEdge) * c.density * c.density;
    }, (c) => {
      const scale = 0.8 + random() * 0.5;
      if (this._overlapsSolid(c.x, c.z, BUSH_RADIUS * scale * 0.6)) return false;
      const bush = { x: c.x, y: c.height - 0.15, z: c.z, rotation: random() * Math.PI * 2, scale };
      placements.bushes.push(bush);
      this._registerBush(bush);
      return true;
    });

    // Two sets: props near the fight cast shadows, distant scenery does not
    const near = { palms: [], trees: [], rocks: [], bushes: [] };
    const far = { palms: [], trees: [], rocks: [], bushes: [] };
    for (const kind of Object.keys(placements)) {
      for (const placement of placements[kind]) {
        (placement.z >= SHADOW_MIN_Z ? near : far)[kind].push(placement);
      }
    }
    for (const [set, castShadows] of [[near, true], [far, false]]) {
      const vegetation = new Vegetation(set, { castShadows });
      this.gameWorld.environmentGroup.add(vegetation.mesh);
      vegetation.createColliders(this.gameWorld.physics);
      this.vegetation.push(vegetation);
    }

    console.log(`[BeachCover] ${placements.palms.length} palms, ${placements.trees.length} trees, ` +
      `${placements.rocks.length} rocks, ${placements.bushes.length} bushes.`);
  }

  /**
   * True when the point is inside a bush (horizontally within it and not above its top).
   * @param {THREE.Vector3} position - Feet position
   */
  isInBush(position) {
    const cx = Math.floor(position.x / BUSH_CELL);
    const cz = Math.floor(position.z / BUSH_CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = this._bushGrid.get(cellKey(cx + dx, cz + dz));
        if (!cell) continue;
        for (const bush of cell) {
          const radius = BUSH_RADIUS * bush.scale;
          const ox = position.x - bush.x;
          const oz = position.z - bush.z;
          if (ox * ox + oz * oz < radius * radius && position.y < bush.y + BUSH_HEIGHT * bush.scale) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * True when a circle of `radius` at (x, z) touches no rock or trunk (e.g. to spawn someone).
   */
  isClearOfSolids(x, z, radius) {
    return !this._overlapsSolid(x, z, radius);
  }

  /**
   * Hidden = crouched inside a bush. Sets `actor.isConcealed` and returns it.
   * @param {{position: THREE.Vector3, isCrouching: boolean}} actor
   */
  updateConcealment(actor) {
    actor.isConcealed = actor.isCrouching === true && this.isInBush(actor.position);
    return actor.isConcealed;
  }

  /**
   * Finds a spot behind a tall rock, on the side away from `threat`, at a distance from the
   * threat between minRange and maxRange, preferring spots close to `from`.
   * @returns {boolean} Whether a spot was found (written to `out`)
   */
  findCover(from, threat, out, minRange, maxRange) {
    const idealRange = (minRange + maxRange) / 2;
    let bestScore = Infinity;
    for (const rock of this.rocks) {
      if (rock.height < COVER_MIN_HEIGHT) continue;
      if (Math.hypot(rock.x - from.x, rock.z - from.z) > COVER_SEARCH_RADIUS) continue;

      // Stand at the rock's left or right edge, a little behind it: mostly covered, but with
      // a line of fire past the edge (straight behind the rock, the rock blocks your own shots)
      const awayLength = Math.hypot(rock.x - threat.x, rock.z - threat.z) || 1;
      const awayX = (rock.x - threat.x) / awayLength;
      const awayZ = (rock.z - threat.z) / awayLength;
      const back = rock.radius * 0.5;
      const side = rock.radius + COVER_STANDOFF * 0.6;

      for (const sign of [1, -1]) {
        const x = rock.x + awayX * back - awayZ * side * sign;
        const z = rock.z + awayZ * back + awayX * side * sign;

        const range = Math.hypot(x - threat.x, z - threat.z);
        if (range < minRange || range > maxRange) continue;
        const ground = this.environment.heightAt(x, z);
        if (ground < 0.6) continue;

        const score = Math.hypot(x - from.x, z - from.z) + Math.abs(range - idealRange) * 0.5;
        if (score < bestScore) {
          bestScore = score;
          out.set(x, ground, z);
        }
      }
    }
    return bestScore < Infinity;
  }

  /**
   * Walks a jittered grid over the island; at each candidate, `chance` gives an acceptance
   * probability from the ground there, and `place` adds the prop (returning false to skip).
   */
  _scatter(spacing, random, chance, place) {
    const { minX, maxX, minZ, maxZ } = SCATTER_BOUNDS;
    for (let gx = minX; gx < maxX; gx += spacing) {
      for (let gz = minZ; gz < maxZ; gz += spacing) {
        const x = gx + random() * spacing;
        const z = gz + random() * spacing;
        const roll = random();

        const candidate = this._describe(x, z);
        if (!candidate) continue;
        const probability = chance(candidate);
        if (probability > 0 && roll < probability) {
          place(candidate);
        }
      }
    }
  }

  /**
   * The ground at (x, z) as placement rules see it, or null where nothing may grow.
   */
  _describe(x, z) {
    const village = this.environment.village;
    if (Math.hypot(x - village.x, z - village.z) < village.radius + VILLAGE_MARGIN) return null;
    for (const clearing of this.clearings) {
      if (Math.hypot(x - clearing.x, z - clearing.z) < clearing.radius) return null;
    }
    const height = this.environment.heightAt(x, z);
    if (height < 0.6) return null; // Wet sand and sea

    return {
      x,
      z,
      height,
      inland: this.environment.inlandDistance(x, z),
      path: this.environment.pathDistance(x, z),
      slope: this.environment.slopeAt(x, z),
      noise: valueNoise2D(x * 0.02, z * 0.02, SEED),
      density: z > BATTLEFIELD_MIN_Z ? 1 : OUTSIDE_DENSITY
    };
  }

  /**
   * A head-high boulder (standing cover) with 1–3 smaller rocks around it (crouching cover).
   */
  _placeRockCluster(list, c, random) {
    // About 2–2.4 m showing above the ground once sunk: taller than a standing player
    const main = { x: 2.4 + random() * 1.0, y: 3.0 + random() * 0.6, z: 2.0 + random() * 1.0 };
    if (!this._placeRock(list, c, main, random)) return false;

    const satellites = 1 + Math.floor(random() * 3);
    for (let i = 0; i < satellites; i++) {
      const angle = random() * Math.PI * 2;
      const distance = 4 + random() * 2.5;
      const spot = this._describe(c.x + Math.cos(angle) * distance, c.z + Math.sin(angle) * distance);
      if (!spot || spot.path < 5) continue;
      const scale = { x: 1.2 + random() * 0.8, y: 0.9 + random() * 0.5, z: 1.2 + random() * 0.8 };
      this._placeRock(list, spot, scale, random);
    }
    return true;
  }

  _placeRock(list, c, scale, random) {
    const radius = Math.max(scale.x, scale.z) * 0.9;
    if (this._overlapsSolid(c.x, c.z, radius)) return false;
    list.push({ x: c.x, y: c.height - 0.35 * scale.y, z: c.z, rotation: random() * Math.PI * 2, scale });
    this._solids.push({ x: c.x, z: c.z, radius });
    this.rocks.push({ x: c.x, z: c.z, radius, height: 0.65 * scale.y });
    return true;
  }

  _placeTrunk(list, c, scale, radius, sink, random) {
    if (this._overlapsSolid(c.x, c.z, radius * 2)) return false;
    list.push({ x: c.x, y: c.height - sink, z: c.z, rotation: random() * Math.PI * 2, scale });
    this._solids.push({ x: c.x, z: c.z, radius: radius * 2 });
    return true;
  }

  _overlapsSolid(x, z, radius) {
    for (const solid of this._solids) {
      const minDistance = solid.radius + radius;
      const dx = x - solid.x;
      const dz = z - solid.z;
      if (dx * dx + dz * dz < minDistance * minDistance) return true;
    }
    return false;
  }

  _registerBush(bush) {
    this.bushes.push(bush);
    const key = cellKey(Math.floor(bush.x / BUSH_CELL), Math.floor(bush.z / BUSH_CELL));
    if (!this._bushGrid.has(key)) this._bushGrid.set(key, []);
    this._bushGrid.get(key).push(bush);
  }

  dispose() {
    for (const vegetation of this.vegetation) {
      vegetation.dispose();
    }
    this.vegetation = [];
    this.bushes = [];
    this.rocks = [];
    this._bushGrid.clear();
    this._solids = [];
  }
}
