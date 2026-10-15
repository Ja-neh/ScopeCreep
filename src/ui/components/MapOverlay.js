/**
 * MapOverlay.js
 * The island map ([M]): a north-up chart of the stage, drawn from the level's own terrain
 * sampler, with the player, the squad, the zone lines, the objective pins and the aliens alive
 * on the island (unaware ones dimmer, the ones hunting you bright red). Levels feed it through
 * `BaseLevel.getMapTerrain` / `BaseLevel.getMapData`; this component only draws.
 * The island backdrop is sampled once and cached, so an open map redraws cheap.
 * Visual only: colours and glyph sizes live here, not in config.json.
 */

const CANVAS_SCALE = 0.55;   // Map pixels per meter of island
const GRID_SPACING = 7;      // Terrain sampled every this many meters
const PATH_DISTANCE = 4.5;   // The jungle path reads this many meters wide on the map
const MIN_CANVAS = 240;      // Never build a smaller chart than this (px)

/**
 * Chart data for a level's island: world bounds plus the environment's own height and path
 * functions. This is what a level hands the map (see `IslandLevel.getMapTerrain`).
 * @param {BeachEnvironment} environment
 * @param {number} [margin=30] - Meters of sea drawn around the playable scatter
 * @returns {{bounds: {minX: number, maxX: number, minZ: number, maxZ: number}, heightAt: Function, pathDistance: Function}}
 */
export function mapTerrainFromEnvironment(environment, margin = 30) {
  const scatter = environment.scatterBounds;
  return {
    bounds: {
      minX: scatter.minX - margin,
      maxX: scatter.maxX + margin,
      minZ: scatter.minZ - margin,
      maxZ: scatter.maxZ + margin
    },
    heightAt: (x, z) => environment.heightAt(x, z),
    pathDistance: (x, z) => environment.pathDistance(x, z)
  };
}

/**
 * World (x, z) to canvas pixels: north up, so the landing beach (large z) sits at the bottom.
 * @param {Object} bounds
 * @param {number} width - Canvas width in pixels
 * @param {number} height - Canvas height in pixels
 * @param {number} x
 * @param {number} z
 * @param {{x: number, y: number}} out
 */
export function projectPoint(bounds, width, height, x, z, out) {
  out.x = ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * width;
  out.y = ((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * height;
  return out;
}

/**
 * The rotation (radians) a north-up arrow takes so it points along the player's view.
 * Player yaw 0 faces -Z, which is up on a north-up map.
 */
export function headingAngle(yaw) {
  return -yaw;
}

/**
 * Terrain colour into `out` ([r, g, b]): open sea, shallows, the sand line, then grass
 * climbing towards the highlands; the jungle path lightens the ground it crosses.
 */
export function terrainColor(height, onPath, out) {
  if (height < -0.3) {
    out[0] = 16; out[1] = 32; out[2] = 50;         // Open sea
  } else if (height < 0.25) {
    out[0] = 38; out[1] = 70; out[2] = 94;         // Shallows and wet sand
  } else if (height < 0.8) {
    out[0] = 198; out[1] = 178; out[2] = 128;      // Dry sand
  } else {
    const t = Math.min(1, (height - 0.8) / 10);    // Grass, darkening... climbing to the plateau
    out[0] = 74 + (128 - 74) * t;
    out[1] = 108 + (142 - 108) * t;
    out[2] = 62 + (96 - 62) * t;
  }
  if (onPath && height > 0.3 && height < 8) {
    out[0] = out[0] * 0.55 + 176 * 0.45;
    out[1] = out[1] * 0.55 + 148 * 0.45;
    out[2] = out[2] * 0.55 + 92 * 0.45;
  }
  return out;
}

export class MapOverlay {
  /**
   * @param {HTMLElement} parentContainer
   */
  constructor(parentContainer) {
    this.parent = parentContainer;
    this.bounds = null;
    this.canvas = null;
    this.ctx = null;
    this._background = null;
    this._point = { x: 0, y: 0 };
    this._color = [0, 0, 0];

    this.element = document.createElement('div');
    this.element.className = 'ui-map-overlay ui-hidden';
    this.element.id = 'ui-map-overlay';
    this.element.innerHTML = `
      <div class="ui-map-panel">
        <div class="ui-map-title">ISLAND MAP <span class="ui-map-hint">[M] close</span></div>
        <canvas class="ui-map-canvas" width="352" height="451"></canvas>
        <div class="ui-map-legend">
          <span class="ui-map-key ui-map-key-you">You</span>
          <span class="ui-map-key ui-map-key-squad">Squad</span>
          <span class="ui-map-key ui-map-key-alien">Aliens</span>
          <span class="ui-map-key ui-map-key-marker">Objective</span>
        </div>
      </div>
    `;
    this.canvas = this.element.querySelector('.ui-map-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.parent.appendChild(this.element);
  }

  get isOpen() {
    return this.element ? !this.element.classList.contains('ui-hidden') : false;
  }

  /**
   * Opens the map. Pass the level's chart data to paint the island; pass null to keep the
   * backdrop already cached (reopening the same stage's map).
   * @param {Object|null} terrain - See `mapTerrainFromEnvironment`
   */
  show(terrain) {
    this.element.classList.remove('ui-hidden');
    if (terrain) this._paintTerrain(terrain);
  }

  hide() {
    if (this.element) this.element.classList.add('ui-hidden');
  }

  /**
   * Redraws the markers over the cached island: the level's state from `getMapData`.
   * @param {Object|null} state - { player, mates, enemies, markers, zones }
   */
  update(state) {
    if (!this.isOpen || !this.bounds) return;
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    ctx.clearRect(0, 0, width, height);
    if (this._background) ctx.drawImage(this._background, 0, 0);
    if (!state) return;

    this._drawZones(ctx, state.zones || [], width, height);
    this._drawMarkers(ctx, state.markers || [], width, height);
    this._drawEnemies(ctx, state.enemies || [], width, height);
    this._drawSquad(ctx, state.mates || [], width, height);
    if (state.player) this._drawPlayer(ctx, state.player, width, height);
  }

  /**
   * Samples the island into a cached offscreen chart (sea, beach, hills, the jungle path).
   */
  _paintTerrain(terrain) {
    const bounds = terrain.bounds;
    this.bounds = bounds;

    const metresWide = bounds.maxX - bounds.minX;
    const metresTall = bounds.maxZ - bounds.minZ;
    const width = Math.max(MIN_CANVAS, Math.round(metresWide * CANVAS_SCALE));
    const height = Math.max(MIN_CANVAS, Math.round(metresTall * CANVAS_SCALE));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this._background = document.createElement('canvas');
      this._background.width = width;
      this._background.height = height;
    }

    // Sample the island on a coarse grid, then scale it up onto the chart
    const cols = Math.max(2, Math.round(metresWide / GRID_SPACING));
    const rows = Math.max(2, Math.round(metresTall / GRID_SPACING));
    const sample = document.createElement('canvas');
    sample.width = cols;
    sample.height = rows;
    const sampleCtx = sample.getContext('2d');
    const image = sampleCtx.createImageData(cols, rows);

    for (let row = 0; row < rows; row++) {
      const z = bounds.minZ + ((row + 0.5) / rows) * metresTall;
      for (let col = 0; col < cols; col++) {
        const x = bounds.minX + ((col + 0.5) / cols) * metresWide;
        const ground = terrain.heightAt(x, z);
        const onPath = terrain.pathDistance(x, z) < PATH_DISTANCE;
        terrainColor(ground, onPath, this._color);
        const index = (row * cols + col) * 4;
        image.data[index] = this._color[0];
        image.data[index + 1] = this._color[1];
        image.data[index + 2] = this._color[2];
        image.data[index + 3] = 255;
      }
    }
    sampleCtx.putImageData(image, 0, 0);

    const bg = this._background.getContext('2d');
    bg.imageSmoothingEnabled = true;
    bg.drawImage(sample, 0, 0, width, height);
  }

  /** Zone boundaries: a faint dashed line across the island, labelled on the inland side. */
  _drawZones(ctx, zones, width, height) {
    if (!zones.length) return;
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.font = '600 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    for (const zone of zones) {
      if (typeof zone.z !== 'number') continue;
      const p = projectPoint(this.bounds, width, height, this.bounds.minX, zone.z, this._point);
      ctx.beginPath();
      ctx.moveTo(0, p.y);
      ctx.lineTo(width, p.y);
      ctx.stroke();
      if (zone.name) ctx.fillText(zone.name.toUpperCase(), 6, p.y - 5);
    }
    ctx.restore();
  }

  /** Objective pins: an amber diamond (green once done) with its label underneath. */
  _drawMarkers(ctx, markers, width, height) {
    ctx.font = '600 11px monospace';
    ctx.textAlign = 'center';
    for (const marker of markers) {
      if (typeof marker.x !== 'number' || typeof marker.z !== 'number') continue;
      const p = projectPoint(this.bounds, width, height, marker.x, marker.z, this._point);
      ctx.fillStyle = marker.done ? '#7ed957' : '#ffd166';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 7);
      ctx.lineTo(p.x + 7, p.y);
      ctx.lineTo(p.x, p.y + 7);
      ctx.lineTo(p.x - 7, p.y);
      ctx.closePath();
      ctx.fill();
      if (marker.label) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.fillText(marker.label, p.x, p.y + 19);
      }
    }
  }

  /** Alien blips: bright red when they are hunting, a dim rim when they have not seen you yet. */
  _drawEnemies(ctx, enemies, width, height) {
    for (const alien of enemies) {
      const p = projectPoint(this.bounds, width, height, alien.x, alien.z, this._point);
      const radius = alien.big ? 6 : 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      if (alien.alerted) {
        ctx.fillStyle = '#ff5252';
        ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(255, 82, 82, 0.3)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 82, 82, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  /** Squadmates: teal dots, hollow while they are down. */
  _drawSquad(ctx, mates, width, height) {
    for (const mate of mates) {
      const p = projectPoint(this.bounds, width, height, mate.x, mate.z, this._point);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      if (mate.downed) {
        ctx.strokeStyle = '#2ec4b6';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.fillStyle = '#2ec4b6';
        ctx.fill();
      }
    }
  }

  /** The player: a white arrow with a view cone, turned to the facing. */
  _drawPlayer(ctx, player, width, height) {
    const p = projectPoint(this.bounds, width, height, player.x, player.z, this._point);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(headingAngle(player.yaw || 0));

    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-16, -30);
    ctx.lineTo(16, -30);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  dispose() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.canvas = null;
    this.ctx = null;
    this._background = null;
    this.bounds = null;
  }
}
