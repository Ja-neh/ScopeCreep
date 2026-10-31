/**
 * MapOverlay.js
 * The island chart: a north-up map of the stage, drawn from the level's own terrain sampler, with
 * the player, the squad, the zone lines, the objective pins, the intel spots and the aliens alive
 * on the island (unaware ones dimmer, the ones hunting you bright red). It lives two ways: a small
 * chart pinned to the top-right corner from the first frame of the stage, always on, and the full
 * [M] chart over the middle of the screen for the detail (labels and the legend). Levels feed both
 * through `BaseLevel.getMapTerrain` / `BaseLevel.getMapData`; this component only draws. The island
 * backdrop is sampled once and cached, so either chart redraws cheap.
 * Visual only: colours and glyph sizes live here, not in config.json.
 */

const CANVAS_SCALE = 0.55;   // Map pixels per meter of island
const GRID_SPACING = 7;      // Terrain sampled every this many meters
const PATH_DISTANCE = 4.5;   // The jungle path reads this many meters wide on the map
const MIN_CANVAS = 240;      // Never build a smaller chart than this (px)
const MINI_WIDTH = 168;      // The corner chart is this many pixels wide (height follows the island)

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
        <div class="ui-map-title"><span class="ui-map-name">ISLAND MAP</span> <span class="ui-map-hint">[M] close</span></div>
        <canvas class="ui-map-canvas" width="352" height="451"></canvas>
        <div class="ui-map-legend">
          <span class="ui-map-key ui-map-key-you">You</span>
          <span class="ui-map-key ui-map-key-squad">Squad</span>
          <span class="ui-map-key ui-map-key-alien">Aliens</span>
          <span class="ui-map-key ui-map-key-marker">Objective</span>
          <span class="ui-map-key ui-map-key-intel">Intel</span>
        </div>
      </div>
    `;
    this.titleElement = this.element.querySelector('.ui-map-name');
    this.alienLegendElement = this.element.querySelector('.ui-map-key-alien');
    this.markerLegendElement = this.element.querySelector('.ui-map-key-marker');
    this.intelLegendElement = this.element.querySelector('.ui-map-key-intel');
    this.canvas = this.element.querySelector('.ui-map-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.parent.appendChild(this.element);

    // The always-on corner chart: the same island, small, no key needed. The stage brings it up
    // as it loads (GameWorld calls ui.showMinimap); the full [M] chart hides it while it is out.
    this.miniElement = document.createElement('div');
    this.miniElement.className = 'ui-minimap ui-hidden';
    this.miniElement.innerHTML = `
      <canvas class="ui-minimap-canvas"></canvas>
      <div class="ui-minimap-hint">[M] FULL CHART</div>
    `;
    this.miniCanvas = this.miniElement.querySelector('.ui-minimap-canvas');
    this.miniCtx = this.miniCanvas.getContext('2d');
    this.parent.appendChild(this.miniElement);

    this._compact = false;
  }

  get isOpen() {
    return this.element ? !this.element.classList.contains('ui-hidden') : false;
  }

  get isMinimapVisible() {
    return this.miniElement ? !this.miniElement.classList.contains('ui-hidden') : false;
  }

  /**
   * Opens the map. Pass the level's chart data to paint the island; pass null to keep the
   * backdrop already cached (reopening the same stage's map).
   * @param {Object|null} terrain - See `mapTerrainFromEnvironment`
   */
  show(terrain) {
    this.element.classList.remove('ui-hidden');
    if (terrain) {
      this._setTerrainLabels(terrain);
      this._paintTerrain(terrain);
    }
  }

  hide() {
    if (this.element) this.element.classList.add('ui-hidden');
  }

  /**
   * Brings the corner chart up. Pass the level's chart data to paint the island; pass null to
   * keep the backdrop already cached (the stage painted it when it loaded).
   * @param {Object|null} terrain - See `mapTerrainFromEnvironment`
   */
  showMinimap(terrain) {
    if (!this.miniElement) return;
    this.miniElement.classList.remove('ui-hidden');
    if (terrain) {
      this._setTerrainLabels(terrain);
      this._paintTerrain(terrain);
    }
  }

  _setTerrainLabels(terrain) {
    if (this.titleElement) this.titleElement.textContent = terrain.title || 'ISLAND MAP';
    if (this.alienLegendElement) this.alienLegendElement.textContent = terrain.enemyLegend || 'Aliens';
    if (this.markerLegendElement) this.markerLegendElement.textContent = terrain.markerLegend || 'Objective';
    if (this.intelLegendElement) this.intelLegendElement.hidden = terrain.kind === 'spaceship';
  }

  /**
   * Hides the corner chart (the full chart is out, or the stage owns the whole screen).
   */
  hideMinimap() {
    if (this.miniElement) this.miniElement.classList.add('ui-hidden');
  }

  /**
   * Redraws whichever charts are on screen over the cached island: the level's state from
   * `getMapData`. The corner chart draws the same picture compact — the blips, not the labels.
   * @param {Object|null} state - { player, mates, enemies, markers, zones, intel }
   */
  update(state) {
    if (!this.bounds) return;
    if (this.isOpen) this._drawChart(this.ctx, this.canvas.width, this.canvas.height, state, false);
    if (this.isMinimapVisible) this._drawChart(this.miniCtx, this.miniCanvas.width, this.miniCanvas.height, state, true);
  }

  /** One chart pass: the cached island scaled onto the canvas, then the live glyphs over it. */
  _drawChart(ctx, width, height, state, compact) {
    ctx.clearRect(0, 0, width, height);
    if (this._background) ctx.drawImage(this._background, 0, 0, width, height);
    if (!state) return;
    this._compact = compact;

    this._drawZones(ctx, state.zones || [], width, height);
    this._drawIntel(ctx, state.intel || [], width, height);
    this._drawMarkers(ctx, state.markers || [], width, height);
    this._drawEnemies(ctx, state.enemies || [], width, height);
    this._drawSquad(ctx, state.mates || [], width, height);
    if (state.player) this._drawPlayer(ctx, state.player, width, height);
  }

  /**
   * Samples the island into a cached offscreen chart (sea, beach, hills, the jungle path).
   */
  _paintTerrain(terrain) {
    const source=terrain.bounds;
    const side=Math.max(source.maxX-source.minX,source.maxZ-source.minZ);
    const cx=(source.minX+source.maxX)/2,cz=(source.minZ+source.maxZ)/2;
    const bounds={minX:cx-side/2,maxX:cx+side/2,minZ:cz-side/2,maxZ:cz+side/2};
    this.bounds = bounds;

    const metresWide = bounds.maxX - bounds.minX;
    const metresTall = bounds.maxZ - bounds.minZ;
    const canvasScale = terrain.canvasScale || CANVAS_SCALE;
    const minCanvas = terrain.minCanvas || MIN_CANVAS;
    const width = Math.max(minCanvas, Math.round(metresWide * canvasScale));
    const height = Math.max(minCanvas, Math.round(metresTall * canvasScale));
    if (!this._background || this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this._background = document.createElement('canvas');
      this._background.width = width;
      this._background.height = height;
    }

    // The corner chart shares this backdrop, drawn small: size it to the island's shape
    const miniHeight = MINI_WIDTH;
    if (this.miniCanvas.width !== MINI_WIDTH || this.miniCanvas.height !== miniHeight) {
      this.miniCanvas.width = MINI_WIDTH;
      this.miniCanvas.height = miniHeight;
    }

    const bg = this._background.getContext('2d');
    if (typeof terrain.drawBackground === 'function') {
      terrain.drawBackground(bg, width, height, bounds);
      return;
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

    bg.imageSmoothingEnabled = true;
    bg.drawImage(sample, 0, 0, width, height);
    const scale=width/side;
    for(const street of terrain.streets || []){
      const a=projectPoint(bounds,width,height,street.from.x,street.from.z,{}),b=projectPoint(bounds,width,height,street.to.x,street.to.z,{});
      bg.strokeStyle='#a4a394';bg.lineWidth=street.width*scale;bg.beginPath();bg.moveTo(a.x,a.y);bg.lineTo(b.x,b.y);bg.stroke();
    }
    for(const building of terrain.buildings || []){
      const p=projectPoint(bounds,width,height,building.x,building.z,{});
      bg.save();bg.translate(p.x,p.y);bg.rotate(-building.yaw);
      bg.shadowColor='#111b1c';bg.shadowBlur=2;bg.shadowOffsetX=2;bg.shadowOffsetY=2;
      bg.fillStyle=building.boss ? '#a896c4' : '#b7b0a0';
      bg.fillRect(-building.width*scale/2,-building.depth*scale/2,building.width*scale,building.depth*scale);bg.restore();
    }
    for(const ship of terrain.ships || []){
      const p=projectPoint(bounds,width,height,ship.x,ship.z,{});
      bg.fillStyle='#6cb9c1';bg.beginPath();bg.ellipse(p.x,p.y,ship.radius*scale,ship.radius*scale*0.7,-ship.yaw,0,Math.PI*2);bg.fill();
      bg.strokeStyle='#d8eff0';bg.stroke();
    }
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
      if (zone.name && !this._compact) ctx.fillText(zone.name.toUpperCase(), 6, p.y - 5);
    }
    ctx.restore();
  }

  /**
   * The islanders' trail: unfound spots are faint hollow rings (something is out there), found
   * ones a small green ring with a dot and their label.
   */
  _drawIntel(ctx, intel, width, height) {
    if (!intel.length) return;
    ctx.font = '600 9px monospace';
    ctx.textAlign = 'center';
    for (const spot of intel) {
      if (typeof spot.x !== 'number' || typeof spot.z !== 'number') continue;
      const p = projectPoint(this.bounds, width, height, spot.x, spot.z, this._point);
      if (spot.found) {
        ctx.strokeStyle = '#9ad06b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#9ad06b';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
        if (spot.label && !this._compact) {
          ctx.fillStyle = 'rgba(154, 208, 107, 0.85)';
          ctx.fillText(spot.label, p.x, p.y + 12);
        }
      } else {
        ctx.strokeStyle = 'rgba(154, 208, 107, 0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  /** Objective pins: an amber diamond (green once done) with its label underneath. */
  _drawMarkers(ctx, markers, width, height) {
    ctx.font = '600 11px monospace';
    ctx.textAlign = 'center';
    for (const marker of markers) {
      if (typeof marker.x !== 'number' || typeof marker.z !== 'number') continue;
      const p = projectPoint(this.bounds, width, height, marker.x, marker.z, this._point);
      if (marker.door) {
        ctx.beginPath();
        if (marker.next) {
          ctx.moveTo(p.x, p.y - 8);
          ctx.lineTo(p.x + 8, p.y);
          ctx.lineTo(p.x, p.y + 8);
          ctx.lineTo(p.x - 8, p.y);
          ctx.closePath();
          ctx.fillStyle = '#ffd166';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          if (marker.floor === 2) {
            ctx.strokeStyle = '#243244';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(p.x - 2, p.y - 2, 4, 4);
          }
        } else {
          if (marker.floor === 2) ctx.rect(p.x - 4, p.y - 4, 8, 8);
          else ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = marker.done ? '#7ed957' : '#7b8fa5';
          ctx.fill();
        }
        if (marker.label && !this._compact) {
          ctx.fillStyle = marker.next ? '#fff1c2' : '#c5d0de';
          ctx.fillText(marker.label, p.x, p.y + (marker.floor === 2 ? -12 : 18));
        }
        continue;
      }
      ctx.fillStyle = marker.done ? '#7ed957' : '#ffd166';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 7);
      ctx.lineTo(p.x + 7, p.y);
      ctx.lineTo(p.x, p.y + 7);
      ctx.lineTo(p.x - 7, p.y);
      ctx.closePath();
      ctx.fill();
      if (marker.label && !this._compact) {
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
      if (alien.floor === 2) ctx.rect(p.x - radius, p.y - radius, radius * 2, radius * 2);
      else ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
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
    const s = this._compact ? 0.6 : 1; // The corner chart's arrow and view cone shrink to fit
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(headingAngle(player.yaw || 0));

    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-16 * s, -30 * s);
    ctx.lineTo(16 * s, -30 * s);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -10 * s);
    ctx.lineTo(7 * s, 8 * s);
    ctx.lineTo(0, 4 * s);
    ctx.lineTo(-7 * s, 8 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  dispose() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    if (this.miniElement && this.miniElement.parentNode) {
      this.miniElement.parentNode.removeChild(this.miniElement);
    }
    this.element = null;
    this.canvas = null;
    this.ctx = null;
    this.miniElement = null;
    this.miniCanvas = null;
    this.miniCtx = null;
    this._background = null;
    this.bounds = null;
  }
}
