import * as THREE from 'three';
import { Ocean } from '../../rendering/Level02Ocean.js';
import { Terrain } from '../../rendering/Level02Terrain.js';
import { SkyDome } from '../../rendering/SkyDome.js';
import { Clouds } from '../../rendering/Clouds.js';
import { CloudShadows } from '../../rendering/CloudShadows.js';
import { shadowDepthRadius } from '../../rendering/ShadowFrustum.js';
import { valueNoise2D, fbm2D, smoothstep } from '../../rendering/Noise.js';

// Island layouts (meters). The island runs north from the landing beach (south waterline at
// z = 200, where the ship anchors) to the village at the far end. Each level builds its own copy:
// - beach (Level 2): an oval, with a small village plateau at the far end nobody visits
// - village (Level 3): the northern half grows wider and longer to hold the big village
//   (an oval plateau 400 m across and 490 m long); the south is the same
// halfWidth / halfLength describe the southern half; northHalfWidth / northHalfLength the northern.
const LAYOUTS = {
  beach: {
    // Keep the southern waterline at +200 while extending the north shore behind the village.
    centreZ: -225, halfWidth: 260, halfLength: 425, northHalfWidth: 260, northHalfLength: 425,
    terrain: { width: 680, depth: 1120, centreZ: -220, cellSize: 2 }, // Extended inland to include the far village
    scatter: { minX: -290, maxX: 290, minZ: -700, maxZ: 230 }, // Where trees and rocks may grow
    village: { x: 0, z: -500, halfWidth: 145, halfLength: 120, height: 12 }
  },
  village: {
    centreZ: -150, halfWidth: 260, halfLength: 350, northHalfWidth: 350, northHalfLength: 640,
    terrain: { width: 800, depth: 1040, centreZ: -320 },      // x -400..400, z -840..200
    scatter: { minX: -370, maxX: 370, minZ: -800, maxZ: 200 },
    village: { x: 0, z: -400, halfWidth: 200, halfLength: 245, height: 12 }
  }
};
// The larger island terrain uses this lighter grid; the beach opts into a finer grid above.
const TERRAIN_CELL = 4;
// The grid is shifted off round numbers: a perfectly vertical ray through an exact grid corner can
// slip between Rapier's heightfield triangles, and the round coordinates we use for spawns and
// checks would otherwise land exactly on corners (every 4 m).
const TERRAIN_GRID_SHIFT = 0.173;
const BEACH_WIDTH = 40;          // Sand band between the waterline and the grass
const HILLS_RISE = 70;           // Distance over which the ground climbs from the beach into the hills
const VILLAGE_BLEND = 45;        // The hills ease down to the village plateau over this width
const SEED = 7;

// Times of day. `sky` is also the haze at the horizon and the fog colour; `light` is the sun
// (or the moon) and `direction` points towards it.
const LOOKS = {
  // Level 1: open sea daylight, bright azure sky and sun
  daylight: {
    sky: 0x87ceeb, fogDensity: 0.0010,
    light: 0xfff5e6, lightIntensity: 1.4, direction: new THREE.Vector3(0.5, 0.8, 0.3).normalize(),
    hemiSky: 0xb1e1ff, hemiGround: 0x3a4a3a, hemiIntensity: 0.65,
    glow: 0x9be2ff, upper: 0x76b5d8, zenith: 0x4a8eb8, disc: 0xfffae0, stars: 0,
    cloud: 0xffffff, cloudGlow: 0xd8e8f0, cloudShadow: 0.25
  },
  // Level 2: the sun low in the west (to the left looking inland, and in view from the sea in
  // the opening), a warm glow along that side of the sky, dusky blue overhead
  sunset: {
    // Visible late-day battlefield: a low warm sun under a broken slate cloud deck.
    sky: 0x7d8990, fogDensity: 0.00105,
    light: 0xffc48d, lightIntensity: 2.0, direction: new THREE.Vector3(-0.48, 0.58, -0.42).normalize(),
    hemiSky: 0xa9b9c0, hemiGround: 0x54544b, hemiIntensity: 1.05,
    glow: 0xf3b487, upper: 0x82919a, zenith: 0x4e5c66, disc: 0xffd4a0, stars: 0,
    cloud: 0xaeb2b2, cloudGlow: 0xc5a38b, cloudShadow: 0.18
  },
  // Level 2: deep blue twilight with a heavy clouded sky and enough moonlight to read the terrain.
  warNight: {
    sky: 0x68788f, fogDensity: 0.00115,
    light: 0xc2d1ed, lightIntensity: 1.65, direction: new THREE.Vector3(-0.48, 0.68, -0.42).normalize(),
    hemiSky: 0xa4b5d4, hemiGround: 0x565b68, hemiIntensity: 1.85,
    glow: 0x5a6c87, upper: 0x374762, zenith: 0x1a2740, disc: 0xaabce0, stars: 0.54,
    cloud: 0x8793a6, cloudGlow: 0x52607a, cloudShadow: 0.18
  },
  // Level 3: moonlight from high in the south-east, behind the squad as it heads north through
  // the village (so the house fronts and the hall face the light), a deep blue sky full of
  // stars, dark haze
  night: {
    sky: 0x1c2740, fogDensity: 0.0034,
    light: 0xa9bde0, lightIntensity: 1.0, direction: new THREE.Vector3(0.4, 0.7, 0.6).normalize(),
    hemiSky: 0x4a5d88, hemiGround: 0x1a2018, hemiIntensity: 0.8,
    glow: 0x2c3d63, upper: 0x162139, zenith: 0x060a16, disc: 0xeef2ff, stars: 1,
    cloud: 0x55617d, cloudGlow: 0x0d1322, cloudShadow: 0.2
  },
  // Level 3: cold twilight over a concrete military stronghold.
  stronghold: {
    sky: 0x101a2d, fogDensity: 0.00145,
    light: 0x9bb9e8, lightIntensity: 1.25, direction: new THREE.Vector3(-0.55, 0.72, 0.42).normalize(),
    hemiSky: 0x405b88, hemiGround: 0x111820, hemiIntensity: 0.72,
    glow: 0x324f82, upper: 0x1a2b48, zenith: 0x070d19, disc: 0xdceaff, stars: 0.35,
    cloud: 0x394862, cloudGlow: 0x111a2a, cloudShadow: 0.16
  },
  // Level 3's ending: the sun coming up in the east over the freed village, a rose and gold
  // horizon, the last stars fading
  dawn: {
    sky: 0xe9b294, fogDensity: 0.0022,
    light: 0xffc58a, lightIntensity: 1.7, direction: new THREE.Vector3(0.9, 0.2, -0.38).normalize(),
    hemiSky: 0xffd8b8, hemiGround: 0x48503e, hemiIntensity: 0.75,
    glow: 0xffa36e, upper: 0xa58fb8, zenith: 0x4f5f9c, disc: 0xfff0c8, stars: 0,
    cloud: 0xf3d2c2, cloudGlow: 0x6f4e5c, cloudShadow: 0.28
  }
};
const _colorA = new THREE.Color();
const _colorB = new THREE.Color();
const DEFAULT_SHADOW_CENTRE = new THREE.Vector3(0, 0, 140); // Covers the beach and the jungle edge
const DEFAULT_SHADOW_HALF_EXTENT = 170;
const SHADOW_LIGHT_DISTANCE = 400; // How far the sun sits from the middle of its shadow area, in metres
const _forward = new THREE.Vector3();     // Scratchpads for the camera-following shadow
const _centre = new THREE.Vector3();
const _lightRight = new THREE.Vector3();
const _lightUp = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

/**
 * Fits the sun's shadow range around its fixed light distance so a square of `halfExtent`
 * costs as little depth as it can. A directional light's shadow camera never refreshes its
 * own projection, so the explicit update here is required whenever the range changes.
 */
function fitShadowDepth(light, halfExtent, direction) {
  const radius = shadowDepthRadius(halfExtent, direction);
  const camera = light.shadow.camera;
  camera.near = Math.max(1, SHADOW_LIGHT_DISTANCE - radius);
  camera.far = SHADOW_LIGHT_DISTANCE + radius;
  camera.updateProjectionMatrix();
}

// Terrain palette
const SEABED = new THREE.Color(0xb59c6c);
const SEABED_DEEP = new THREE.Color(0x5e5038);
const WET_SAND = new THREE.Color(0xa98a5c);
const SAND = new THREE.Color(0xe6d3a0);
const SAND_DARK = new THREE.Color(0xcdb57f);
const GRASS = new THREE.Color(0x5c8a36);
const GRASS_DARK = new THREE.Color(0x3b6a28);
const DIRT = new THREE.Color(0x8b6b45);
const ROCK = new THREE.Color(0x85898b);
const CLIFF_BASE = new THREE.Color(0x858b8e);
const HILL_SOIL = new THREE.Color(0x66513a);
const HILL_SOIL_DARK = new THREE.Color(0x403326);
const HILL_ROCK = new THREE.Color(0x8a9092);
const TRACK_SOIL = new THREE.Color(0x403a2e);

/**
 * BeachEnvironment
 * The island: procedural terrain with the landing beach in the south, jungle hills, a path
 * winding north to the village plateau at the far end, a rolling sea, and a dramatic clouded sunset.
 * Shared by Level02 and Level02TestLevel; `village` tells Level 3 where its houses go.
 */
export class BeachEnvironment {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} [options]
   * @param {'sunset'|'warNight'|'night'} [options.look='sunset'] - Time of day
   * @param {'beach'|'village'} [options.layout='beach'] - Island shape (see LAYOUTS)
   * @param {THREE.Vector3} [options.shadowCentre] - Middle of the area that gets shadows (the fight)
   * @param {number} [options.shadowHalfExtent] - Half the width of that area (meters)
   * @param {boolean} [options.shadowFollowsCamera=false] - Move the shadow area with the camera
   *   (for a big place: sharper shadows where you are, and less to draw into the shadow map)
   */
  constructor(gameWorld, {
    look = 'sunset', layout = 'beach', shadowCentre = DEFAULT_SHADOW_CENTRE,
    shadowHalfExtent = DEFAULT_SHADOW_HALF_EXTENT, shadowFollowsCamera = false,
    waveScale = 0.3, cellSize = null, createCollider = true
  } = {}) {
    this.gameWorld = gameWorld;
    this.layout = LAYOUTS[layout] || LAYOUTS.beach;
    this.layoutName = LAYOUTS[layout] ? layout : 'beach';
    this.look = LOOKS[look] || LOOKS.sunset;
    this.lookName = LOOKS[look] ? look : 'sunset';
    this.shadowCentre = shadowCentre.clone();
    this.shadowHalfExtent = shadowHalfExtent;
    this.shadowFollowsCamera = shadowFollowsCamera;
    this.waveScale = waveScale;
    this.cellSize = cellSize;
    this.createCollider = createCollider;
    this.sun = null;
    this.hemi = null;
    this._direction = this.look.direction.clone(); // Towards the sun or moon (moves in blendLook)
    this.terrain = null;
    this.ocean = null;
    this.sky = null;
    this.clouds = null;
    this.cloudShadows = null;
    this.beachLandmarks = null;
    this.landmarkGeometries = [];
    this.landmarkMaterials = [];
    this.landmarkColliders = [];
    this.creek = null;
    this.coastalCliffs = [];
    this.creekTime = 0;
    this.lights = [];
    this.spawnPoints = {};
    // Where Level 3's houses go: an oval plateau (radius: its smaller half-size)
    const v = this.layout.village;
    this.village = { ...v, radius: Math.min(v.halfWidth, v.halfLength) };
    this.scatterBounds = { ...this.layout.scatter };

    this._previousBackground = null;
    this._previousFog = null;
    this._grassColor = new THREE.Color();
  }

  /**
   * Builds lights, sky, sea and terrain, and the terrain collider.
   */
  build() {
    const scene = this.gameWorld.scene;
    const group = this.gameWorld.environmentGroup;

    // 1. Sky (with the sun or the moon, and stars at night), clouds and fog
    const look = this.look;
    this._previousBackground = scene.background;
    this._previousFog = scene.fog;
    scene.background = new THREE.Color(look.sky);
    scene.fog = new THREE.FogExp2(look.sky, look.fogDensity);
    this.sky = new SkyDome({
      sunDirection: look.direction,
      horizonColor: look.sky,
      glowColor: look.glow,
      upperColor: look.upper,
      zenithColor: look.zenith,
      sunColor: look.disc,
      stars: look.stars
    });
    group.add(this.sky.mesh);
    this.clouds = new Clouds({ color: look.cloud, glow: look.cloudGlow });
    group.add(this.clouds.mesh);
    this.cloudShadows = new CloudShadows({ strength: look.cloudShadow });
    this.cloudShadows.update(0, this._direction);

    // 2. The sun (or moon) and a sky / ground fill
    const hemi = new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemiIntensity);
    this._addLight(hemi);
    this.hemi = hemi;

    const sun = new THREE.DirectionalLight(look.light, look.lightIntensity);
    sun.position.copy(this.shadowCentre).addScaledVector(look.direction, SHADOW_LIGHT_DISTANCE);
    sun.target.position.copy(this.shadowCentre);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -this.shadowHalfExtent;
    sun.shadow.camera.right = this.shadowHalfExtent;
    sun.shadow.camera.top = this.shadowHalfExtent;
    sun.shadow.camera.bottom = -this.shadowHalfExtent;
    fitShadowDepth(sun, this.shadowHalfExtent, this._direction);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this._addLight(sun);
    this._addLight(sun.target);
    this.sun = sun;

    // 3. Calm sea around the island, lit to match the sky
    this.ocean = new Ocean({
      size: 2600,
      // A denser grid smooths the short Gerstner wave and shoreline interpolation without
      // paying the vertex cost of an ultra-high-resolution ocean across the full 2.6 km plane.
      segments: 512,
      reflectionResolution: 512,
      sunDirection: look.direction.clone(),
      waveScale: this.waveScale,
      // Let waves travel through the shallow surf, then fade their displacement at the waterline.
      shoreDampAt: (x, z) => 1 - smoothstep(-16, 0, this.inlandDistance(x, z)),
      // Separate signed distance lets the shader clip only the inland side without freezing the surf.
      shoreDistanceAt: (x, z) => this.inlandDistance(x, z)
    });
    this.ocean.uniforms.uSkyColor.value.set(look.sky);
    this.ocean.uniforms.uSunColor.value.set(look.light);
    this.cloudShadows.applyToOcean(this.ocean.uniforms);
    group.add(this.ocean.mesh);

    // 4. Terrain mesh and its matching heightfield collider
    const terrain = this.layout.terrain;
    const actualCellSize = this.cellSize ?? (terrain.cellSize ?? TERRAIN_CELL);
    this.terrain = new Terrain({
      width: terrain.width,
      depth: terrain.depth,
      cellSize: actualCellSize,
      center: { x: TERRAIN_GRID_SHIFT, z: terrain.centreZ + TERRAIN_GRID_SHIFT },
      heightAt: (x, z) => this._islandHeight(x, z),
      colorAt: (x, z, h, slope, out) => this._islandColor(x, z, h, slope, out)
    });
    group.add(this.terrain.mesh);
    if (this.createCollider && this.gameWorld.physics) {
      this.terrain.createCollider(this.gameWorld.physics);
    }
    this.cloudShadows.applyToMaterial(this.terrain.material);

    if (this.layoutName === 'beach') this._buildBeachLandmarks(group);

    // The former creek ribbon and repeated coastal cliff wall segments are omitted from the land.

    // 5. Named spots other systems place things at
    this.spawnPoints.beach = this._pointOnGround(0, 178);
  }

  /**
   * Height of the ground at world (x, z), in meters.
   */
  heightAt(x, z) {
    return this.terrain ? this.terrain.getHeightAt(x, z) : this._islandHeight(x, z);
  }

  /**
   * Meters inland from the waterline at (x, z); negative out at sea.
   */
  inlandDistance(x, z) {
    return this._shoreRadius(x, z) - Math.hypot(x, z - this.layout.centreZ);
  }

  /**
   * True if (x, z) is on the village plateau (grown by `margin` meters all round).
   */
  isInVillage(x, z, margin = 0) {
    const v = this.village;
    const u = (x - v.x) / (v.halfWidth + margin);
    const w = (z - v.z) / (v.halfLength + margin);
    return u * u + w * w < 1;
  }

  /**
   * Meters outside the village plateau's edge (negative inside), measured towards its centre.
   */
  distanceOutsideVillage(x, z) {
    const v = this.village;
    const dx = x - v.x;
    const dz = z - v.z;
    const scaled = Math.hypot(dx / v.halfWidth, dz / v.halfLength);
    if (scaled <= 1) return -1;
    return Math.hypot(dx, dz) * (1 - 1 / scaled);
  }

  /**
   * Ground steepness at (x, z): 0 on flat ground, 1 on a vertical face.
   */
  slopeAt(x, z) {
    const dx = (this.heightAt(x + 1, z) - this.heightAt(x - 1, z)) / 2;
    const dz = (this.heightAt(x, z + 1) - this.heightAt(x, z - 1)) / 2;
    return 1 - 1 / Math.sqrt(1 + dx * dx + dz * dz);
  }

  /** Unit vector towards the sun or moon (shared by the light, the sky and the sea's glint). */
  get sunDirection() {
    return this._direction;
  }

  /**
   * Part of the way (t 0..1) from one time of day to another: sky, stars, fog, sun or moon,
   * light, clouds and sea all move together (Level 3's dawn). Call as often as you like.
   * @param {string} from - A look name ('night')
   * @param {string} to - A look name ('dawn')
   * @param {number} t
   */
  blendLook(from, to, t) {
    const a = LOOKS[from];
    const b = LOOKS[to];
    if (!a || !b || !this.sky) return;
    t = Math.min(1, Math.max(0, t));
    const mix = (key, out) => out.copy(_colorA.setHex(a[key])).lerp(_colorB.setHex(b[key]), t);
    const lerp = (key) => a[key] + (b[key] - a[key]) * t;

    const scene = this.gameWorld.scene;
    if (scene.background && scene.background.isColor) mix('sky', scene.background);
    if (scene.fog) {
      mix('sky', scene.fog.color);
      scene.fog.density = lerp('fogDensity');
    }
    this._direction.copy(a.direction).lerp(b.direction, t).normalize();

    const sky = this.sky.uniforms;
    mix('sky', sky.uHorizonColor.value);
    mix('glow', sky.uGlowColor.value);
    mix('upper', sky.uUpperColor.value);
    mix('zenith', sky.uZenithColor.value);
    mix('disc', sky.uSunColor.value);
    sky.uSunDirection.value.copy(this._direction);
    sky.uStars.value = lerp('stars');

    if (this.sun) {
      mix('light', this.sun.color);
      this.sun.intensity = lerp('lightIntensity');
      this.sun.position.copy(this.sun.target.position).addScaledVector(this._direction, SHADOW_LIGHT_DISTANCE);
      fitShadowDepth(this.sun, this.shadowHalfExtent, this._direction);
    }
    if (this.hemi) {
      mix('hemiSky', this.hemi.color);
      mix('hemiGround', this.hemi.groundColor);
      this.hemi.intensity = lerp('hemiIntensity');
    }
    if (this.clouds && this.clouds.material) {
      mix('cloud', this.clouds.material.color);
      mix('cloudGlow', this.clouds.material.emissive);
    }
    if (this.cloudShadows) {
      this.cloudShadows.uniforms.uCloudShadowStrength.value = lerp('cloudShadow');
      this.cloudShadows.update(0, this._direction);
    }
    if (this.ocean) {
      mix('sky', this.ocean.uniforms.uSkyColor.value);
      mix('light', this.ocean.uniforms.uSunColor.value);
      this.ocean.uniforms.uSunDirection.value.copy(this._direction);
    }
  }

  /**
   * Advances the sea and drifts the clouds (keeping them around the camera). Call once per frame in Phase 5.
   */
  update(delta) {
    if (this.ocean) this.ocean.update(delta);
    if (this.creek) {
      this.creekTime += delta;
      this.creek.userData.waterMaterial.uniforms.uTime.value = this.creekTime;
    }
    const camera = this.gameWorld.getActiveCamera ? this.gameWorld.getActiveCamera() : this.gameWorld.camera;
    if (this.clouds) this.clouds.update(delta, camera ? camera.position : null);
    if (this.cloudShadows) this.cloudShadows.update(delta, this._direction);
    if (this.shadowFollowsCamera && this.sun && camera) this._followShadow(camera);
  }

  /**
   * Keeps the shadow area on what the camera sees (centred a little ahead of it), snapped to
   * whole shadow-map texels so shadow edges do not shimmer as it moves.
   */
  _followShadow(camera) {
    camera.getWorldDirection(_forward);
    _forward.y = 0;
    if (_forward.lengthSq() > 1e-6) _forward.normalize();
    _centre.copy(camera.position).addScaledVector(_forward, this.shadowHalfExtent * 0.5);
    _centre.y = this.shadowCentre.y;

    // The shadow camera's own axes: it looks back down the light direction, with +y up
    const toLight = this._direction;
    _lightRight.crossVectors(_worldUp, toLight).normalize();
    _lightUp.crossVectors(toLight, _lightRight);
    const texel = (2 * this.shadowHalfExtent) / this.sun.shadow.mapSize.x;
    const u = Math.round(_centre.dot(_lightRight) / texel) * texel;
    const v = Math.round(_centre.dot(_lightUp) / texel) * texel;
    const w = _centre.dot(toLight);
    _centre.copy(_lightRight).multiplyScalar(u).addScaledVector(_lightUp, v).addScaledVector(toLight, w);

    this.sun.target.position.copy(_centre);
    this.sun.position.copy(_centre).addScaledVector(toLight, SHADOW_LIGHT_DISTANCE);
  }

  _pointOnGround(x, z) {
    return new THREE.Vector3(x, this.heightAt(x, z) + 0.3, z);
  }

  _addLight(object) {
    this.gameWorld.environmentGroup.add(object);
    this.lights.push(object);
  }

  /**
   * Distance from the island centre to the waterline in the direction of (x, z): an oval (wider
   * and longer in the north for the village layout), with a wobbling coast everywhere except the
   * landing beach (towards +Z), which stays a smooth arc.
   */
  _shoreRadius(x, z) {
    const layout = this.layout;
    const theta = Math.atan2(x, z - layout.centreZ);
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    const north = smoothstep(Math.PI / 2 - 0.2, Math.PI / 2 + 0.6, Math.abs(theta));
    const halfWidth = layout.halfWidth + (layout.northHalfWidth - layout.halfWidth) * north;
    const halfLength = cos < 0 ? layout.northHalfLength : layout.halfLength;
    const oval = (halfWidth * halfLength) /
      Math.sqrt((halfLength * sin) ** 2 + (halfWidth * cos) ** 2);
    const wobble = Math.sin(3 * theta + 0.7) * 14 + Math.sin(7 * theta + 2.1) * 7 + Math.sin(11 * theta + 1.3) * 3;
    return oval + wobble * smoothstep(0.35, 1.0, Math.abs(theta));
  }

  /**
   * X of the jungle path's centreline at a given z (it winds north from the beach to the village).
   */
  pathCentreX(z) {
    return Math.sin(z * 0.018) * 16;
  }

  /**
   * Distance from the jungle path's centreline.
   */
  pathDistance(x, z) {
    return Math.abs(x - this.pathCentreX(z));
  }

  _islandHeight(x, z) {
    const inland = this.inlandDistance(x, z);

    // Sea floor drops away quickly so the anchored ship's hull clears it
    if (inland < 0) return Math.max(-14, inland * 0.4 - 0.2);

    const ripple = (valueNoise2D(x * 0.15, z * 0.15, SEED) - 0.5) * 0.25;
    const beach = 0.3 + Math.min(inland, BEACH_WIDTH) * 0.055 + ripple;
    if (inland < BEACH_WIDTH) return beach;

    // Uneven hills rise inland from the beach; the old central road cut is gone.
    const rise = smoothstep(BEACH_WIDTH, this.layoutName === 'beach' ? 220 : BEACH_WIDTH + HILLS_RISE, inland);
    const broadHills = this.layoutName === 'beach'
      ? 2 + fbm2D(x * 0.008, z * 0.008, 4, SEED) * 14
      : 4 + fbm2D(x * 0.008, z * 0.008, 4, SEED) * 19;
    const rollingRidges = (1 - Math.abs(valueNoise2D(x * 0.014, z * 0.012, SEED + 47) * 2 - 1)) * (this.layoutName === 'beach' ? 7 : 10);
    const hills = broadHills + rollingRidges;
    let height = beach + rise * hills;

    if (this.layoutName === 'beach') {
      // Broken alpine ridges and a raised central spine create continuous rugged land.
      const leftRidge = -112 + Math.sin(z * 0.008) * 24 + Math.sin(z * 0.021) * 9;
      const rightRidge = 118 + Math.cos(z * 0.007) * 22 + Math.sin(z * 0.019) * 8;
      // Quartic profiles soften the summit into a broad, slightly flat rock crown.
      const leftOffset = Math.abs((x - leftRidge) / 35);
      const rightOffset = Math.abs((x - rightRidge) / 42);
      const left = Math.exp(-0.5 * leftOffset ** 4);
      const right = Math.exp(-0.5 * rightOffset ** 4);
      const ridgeNoise = 1 - Math.abs(valueNoise2D(x * 0.021, z * 0.016, SEED + 19) * 2 - 1);
      const crag = fbm2D(x * 0.034, z * 0.029, 3, SEED + 23);
      // Keep the tall cliffs inland; the approach from the beach climbs through lower foothills first.
      const mountainRise = smoothstep(165, 255, inland);
      const ridgeDetail = ridgeNoise * 12 + crag * 8;
      height += mountainRise * (left * (24 + ridgeDetail) + right * (27 + ridgeDetail));
      // Eroded gullies and ledges break up the broad ridges into readable mountain faces.
      const erosion = fbm2D(x * 0.052 + 8, z * 0.046 - 3, 3, SEED + 31) - 0.5;
      height += mountainRise * erosion * (left + right) * 9;

      // Fill the former road valley with a high, uneven central ridge so the pass reads as land.
      const centreRidgeX = this.pathCentreX(z) + Math.sin(z * 0.009 + 0.8) * 12;
      const centreOffset = Math.abs((x - centreRidgeX) / 48);
      const centreCrown = Math.exp(-0.5 * centreOffset ** 4);
      const centreRise = smoothstep(145, 225, inland) * (1 - smoothstep(310, 380, inland));
      const centreDetail = fbm2D(x * 0.031 - 13, z * 0.027 + 5, 4, SEED + 83);
      height += centreRise * centreCrown * (18 + centreDetail * 14);
      height += centreRise * (centreCrown + left + right) * erosion * 7;

      // A broken, distant ridgeline gives the island the layered mountain silhouette in the reference.
      const backRidgeX = Math.sin(z * 0.004 + 1.7) * 54 + Math.sin(z * 0.011) * 23;
      const backRidge = Math.exp(-((x - backRidgeX) ** 2) / (2 * 76 * 76));
      const backRidgeMask = smoothstep(-205, -320, z) * (1 - smoothstep(-640, -740, z));
      const backCrag = fbm2D(x * 0.022 + 31, z * 0.019 - 7, 4, SEED + 61);
      height += backRidgeMask * backRidge * (24 + backCrag * 24);

      // A gently flattened upland clearing sits inside the rolling green hills.
      const fieldRadius = Math.hypot(x * 0.92, (z + 100) * 0.82);
      const clearing = 1 - smoothstep(42, 78, fieldRadius);
      const clearingHeight = 29 + fbm2D(x * 0.035 + 2, z * 0.032, 3, SEED + 101) * 2.2;
      height += (clearingHeight - height) * clearing * 0.9;
    }

    // Level 3 keeps its village plateau; Level 2 is now continuous rocky highland with no road shelf.
    const plateau = this.layoutName === 'village'
      ? 1 - smoothstep(0, VILLAGE_BLEND, this.distanceOutsideVillage(x, z))
      : 0;
    return height + (this.village.height - height) * plateau;
  }

  _creekCentreX(z) {
    return this.pathCentreX(z) + 11 + Math.sin(z * 0.035) * 2.2 + Math.sin(z * 0.012) * 4;
  }

  _buildCreek() {
    const segments = 320;
    const offsets = [-6.5, -3.25, 0, 3.25, 6.5];
    const positions = new Float32Array((segments + 1) * offsets.length * 3);
    const uvs = new Float32Array((segments + 1) * offsets.length * 2);
    const indices = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      // Keep the ribbon inside the fully carved section of the channel.
      const z = 158 - t * 438;
      const cx = this._creekCentreX(z);
      for (let j = 0; j < offsets.length; j++) {
        const x = cx + offsets[j];
        const y = this._islandHeight(x, z) + 0.18;
        const index = i * offsets.length + j;
        positions.set([x, y, z], index * 3);
        uvs.set([j / (offsets.length - 1), t], index * 2);
        if (i < segments && j < offsets.length - 1) {
          const a = index, b = index + offsets.length;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */`
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float current = sin(vUv.y * 260.0 - uTime * 2.4 + sin(vUv.y * 39.0) * 1.6);
          float glint = pow(max(current, 0.0), 10.0) * 0.2;
          float edge = smoothstep(0.0, 0.14, vUv.x) * (1.0 - smoothstep(0.86, 1.0, vUv.x));
          vec3 water = mix(vec3(0.18, 0.38, 0.34), vec3(0.35, 0.63, 0.59), 0.48 + current * 0.08);
          water += vec3(0.55, 0.66, 0.54) * glint;
          gl_FragColor = vec4(water, 0.42 * edge);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const creek = new THREE.Mesh(geometry, material);
    creek.name = 'ForestCreek';
    creek.frustumCulled = false;
    creek.renderOrder = 1;
    const group = new THREE.Group();
    group.name = 'ForestRiver';
    group.add(creek);
    this._addRiverPebbles(group);
    group.userData.waterMaterial = material;
    return group;
  }

  _addRiverPebbles(group) {
    const random = (() => { let seed = 7391; return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; })();
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x85898b, roughness: 0.92, vertexColors: true });
    const stones = new THREE.InstancedMesh(geometry, material, 1250);
    stones.name = 'RiverbedPebbles';
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let index = 0;
    for (let i = 0; i < 1250; i++) {
      const z = 150 - random() * 428;
      const x = this._creekCentreX(z) + (random() - 0.5) * 12;
      const baseY = this._islandHeight(x, z) - 0.17;
      const size = 0.12 + random() * 0.3;
      dummy.position.set(x, baseY + size * 0.15, z);
      dummy.rotation.set(random() * 0.6, random() * Math.PI, random() * 0.5);
      dummy.scale.set(size * (1 + random()), size * 0.5, size * (0.7 + random()));
      dummy.updateMatrix();
      stones.setMatrixAt(index, dummy.matrix);
      color.setHSL(0.18 + random() * 0.1, 0.08 + random() * 0.14, 0.34 + random() * 0.26);
      stones.setColorAt(index++, color);
    }
    stones.count = index;
    stones.instanceMatrix.needsUpdate = true;
    if (stones.instanceColor) stones.instanceColor.needsUpdate = true;
    stones.receiveShadow = true;
    group.add(stones);
  }

  _buildCoastalCliffs() {
    const walls = [];
    const rand = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    const normalSize = 128;
    const normalData = new Uint8Array(normalSize * normalSize * 4);
    const heightAt = (u, v) => Math.sin(u * 45 + Math.sin(v * 17) * 2) * 0.34 + Math.sin(v * 79 + u * 9) * 0.2 + Math.sin(u * 191 + v * 137) * 0.08;
    for (let y = 0; y < normalSize; y++) for (let x = 0; x < normalSize; x++) {
      const u = x / normalSize, v = y / normalSize;
      const dx = (heightAt(u + 1 / normalSize, v) - heightAt(u - 1 / normalSize, v)) * 8;
      const dy = (heightAt(u, v + 1 / normalSize) - heightAt(u, v - 1 / normalSize)) * 8;
      const n = new THREE.Vector3(-dx, -dy, 1).normalize();
      const i = (y * normalSize + x) * 4;
      normalData[i] = (n.x * 0.5 + 0.5) * 255; normalData[i + 1] = (n.y * 0.5 + 0.5) * 255;
      normalData[i + 2] = (n.z * 0.5 + 0.5) * 255; normalData[i + 3] = 255;
    }
    const normalMap = new THREE.DataTexture(normalData, normalSize, normalSize, THREE.RGBAFormat);
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.repeat.set(3, 4);
    normalMap.needsUpdate = true;
    const rock = new THREE.MeshStandardMaterial({ color: CLIFF_BASE, roughness: 0.96, vertexColors: true, normalMap, normalScale: new THREE.Vector2(0.7, 0.7), side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const group = new THREE.Group();
      group.name = `StratifiedCoastalCliff_${side}`;
      const step = 8;
      for (let z = -300; z <= 100; z += step) {
        const x = side * (178 + Math.sin(z * 0.013) * 12 + rand(z + side * 17) * 9);
        if (this.inlandDistance(x, z) < 18) continue;
        const ground = this._islandHeight(x, z);
        const height = 20 + rand(z + 51) * 24;
        const width = 8 + rand(z + 91) * 8;
        const layers = 5;
        const positions = [], colors = [], uvs = [], indices = [];
        for (let row = 0; row <= layers; row++) {
          const y = ground + row * (height / layers);
          const ledge = row === 0 ? 0 : (row % 2 ? 1.2 : -0.5);
          for (let col = 0; col < 3; col++) {
            const cx = x + side * (col - 1) * width * 0.5 + side * ledge;
            const jitter = (rand(z * 3 + row * 7 + col) - 0.5) * 2.2;
            positions.push(cx, y + jitter, z + (col - 1) * (step * 0.55));
            uvs.push(col * 0.5, row / layers * 2.5);
            const shade = 0.78 + rand(z + row * 31 + col) * 0.32;
            colors.push(shade, shade * 0.99, shade * 1.01);
            if (row < layers && col < 2) {
              const a = row * 3 + col, b = a + 3;
              indices.push(a, b, a + 1, a + 1, b, b + 1);
            }
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, rock);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      walls.push(group);
    }
    // One shared material is disposed with the first group's resource cleanup below.
    walls[0].userData.sharedMaterial = rock;
    walls[0].userData.normalMap = normalMap;
    return walls;
  }

  /** Large procedural stone formations frame the beach like a weathered natural archipelago. */
  _buildBeachLandmarks(parent) {
    const group = new THREE.Group();
    group.name = 'BeachRockLandmarks';
    const grey = [0x777e81, 0x929697, 0x626a6e].map((color) => new THREE.MeshStandardMaterial({
      color, roughness: 0.98, flatShading: true
    }));
    this.landmarkMaterials = grey;
    const cityStone = new THREE.MeshStandardMaterial({ color: 0x555c60, roughness: 0.58, metalness: 0.26, flatShading: true });
    const cityMetal = new THREE.MeshStandardMaterial({ color: 0x292f33, roughness: 0.34, metalness: 0.72, flatShading: true });
    const bronze = new THREE.MeshStandardMaterial({ color: 0x94724b, roughness: 0.46, metalness: 0.62 });
    // Keep the alien architecture weathered and grounded in the sunset palette; no neon trim.
    const tealLight = new THREE.MeshStandardMaterial({ color: 0x505c5d, roughness: 0.86, metalness: 0.18, flatShading: true });
    const amberLight = new THREE.MeshStandardMaterial({ color: 0x786448, roughness: 0.78, metalness: 0.24, flatShading: true });
    const violetLight = new THREE.MeshStandardMaterial({ color: 0x41474c, roughness: 0.9, metalness: 0.16, flatShading: true });
    this.landmarkMaterials.push(cityStone, cityMetal, bronze, tealLight, amberLight, violetLight);
    const cityBox = new THREE.BoxGeometry(1, 1, 1);
    const cityCore = new THREE.CylinderGeometry(0.64, 1, 1, 9, 1);
    const cityTower = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
    const cityCap = new THREE.SphereGeometry(1, 10, 6);
    const cityRing = new THREE.TorusGeometry(1, 0.08, 5, 12);
    this.landmarkGeometries.push(cityBox, cityCore, cityTower, cityCap, cityRing);
    const right = new THREE.Vector3(1, 0, 0);
    const bridgeDirection = new THREE.Vector3();
    const bridgeQuaternion = new THREE.Quaternion();
    const place = (geometry, material, x, y, z, sx, sy, sz, rotationY = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      mesh.rotation.y = rotationY;
      if (geometry === cityRing) mesh.rotation.x = Math.PI / 2;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };

    // A distant cliffside settlement: broad terraces, tapered towers and linked skywalks.
    // Its warm metal and restrained teal light distinguish it from the ruined beach below.
    const towers = [
      [-158, -330, 30], [-119, -315, 42], [-74, -350, 27], [-28, -320, 35],
      [21, -365, 47], [70, -325, 32], [116, -360, 39], [160, -320, 27],
      [-132, -395, 25], [-75, -405, 34], [-15, -392, 29], [48, -410, 43], [112, -390, 31],
      // A second, larger village row sits beyond the ruined skyline at the far end.
      [-150, -470, 38], [-105, -520, 48], [-55, -560, 41], [0, -570, 58],
      [55, -560, 45], [105, -520, 51], [150, -470, 39]
    ].map(([x, z, height], index) => {
      const ground = this.heightAt(x, z);
      const width = 8 + (index % 3) * 1.7;
      const yaw = index * 0.41;
      place(cityBox, cityStone, x, ground + 1.5, z, width * 2.8, 3, width * 2.8, yaw);
      place(cityCore, cityStone, x, ground + height * 0.42, z, width, height * 0.72, width, yaw);
      place(cityTower, cityMetal, x, ground + height * 0.79, z, width * 0.72, height * 0.1, width * 0.72, yaw);
      place(cityCap, cityStone, x, ground + height * 0.9, z, width * 0.62, height * 0.13, width * 0.62, yaw);
      place(cityRing, bronze, x, ground + height * 0.32, z, width * 1.03, width * 1.03, width * 1.03, yaw);
      place(cityRing, tealLight, x, ground + height * 0.55, z, width * 0.83, width * 0.83, width * 0.83, yaw);
      place(cityRing, bronze, x, ground + height * 0.75, z, width * 0.79, width * 0.79, width * 0.79, yaw);
      for (let fin = 0; fin < 4; fin++) {
        const angle = yaw + fin * Math.PI / 2;
        const fx = x + Math.cos(angle) * width * 0.78;
        const fz = z + Math.sin(angle) * width * 0.78;
        place(cityBox, cityMetal, fx, ground + height * 0.5, fz, 1.2, height * 0.88, 1.2, angle);
        place(cityBox, index % 2 ? tealLight : amberLight, fx, ground + height * 0.62, fz, 1.28, 0.32, 1.28, angle);
      }
      return { x, z, y: ground + height * 0.56 };
    });

    const skywalk = (a, b, level = 0) => {
      const start = new THREE.Vector3(a.x, a.y + level, a.z);
      const end = new THREE.Vector3(b.x, b.y + level, b.z);
      bridgeDirection.copy(end).sub(start);
      const length = bridgeDirection.length();
      bridgeQuaternion.setFromUnitVectors(right, bridgeDirection.normalize());
      const deck = place(cityBox, cityMetal, 0, 0, 0, length, 2.2, 6.2);
      deck.position.copy(start).add(end).multiplyScalar(0.5);
      deck.quaternion.copy(bridgeQuaternion);
      const trim = place(cityBox, bronze, 0, 0, 0, length, 0.28, 6.5);
      trim.position.copy(deck.position).add(new THREE.Vector3(0, 1.18, 0));
      trim.quaternion.copy(bridgeQuaternion);
      const lightStrip = place(cityBox, tealLight, 0, 0, 0, length * 0.94, 0.12, 0.2);
      lightStrip.position.copy(deck.position).add(new THREE.Vector3(0, 1.36, 0));
      lightStrip.quaternion.copy(bridgeQuaternion);
    };
    for (let i = 0; i < 7; i++) skywalk(towers[i], towers[i + 1], 1.5);
    for (let i = 8; i < towers.length - 1; i++) skywalk(towers[i], towers[i + 1], 1.0);
    for (const [a, b] of [[1, 9], [3, 10], [4, 11], [6, 12]]) skywalk(towers[a], towers[b], 2.4);
    for (let i = 13; i < towers.length - 1; i++) skywalk(towers[i], towers[i + 1], 1.4);
    for (const [a, b] of [[9, 14], [10, 16], [11, 18]]) skywalk(towers[a], towers[b], 2.8);

    // Foreground outposts and linked terraces bring the settlement closer to the beach.
    // Keep these structures to the sides so the central route through the wrecks remains open.
    const frontOutposts = [
      [-137, -218, 25], [-102, -270, 29], [-158, -286, 20],
      [137, -218, 27], [102, -270, 24], [158, -286, 22]
    ].map(([x, z, height], index) => {
      const ground = this.heightAt(x, z);
      const width = 7.2 + (index % 2) * 1.8;
      const yaw = index * 0.53;
      place(cityBox, cityStone, x, ground + 1.2, z, width * 2.5, 2.4, width * 2.5, yaw);
      place(cityCore, cityStone, x, ground + height * 0.43, z, width, height * 0.74, width, yaw);
      place(cityTower, cityMetal, x, ground + height * 0.78, z, width * 0.74, height * 0.11, width * 0.74, yaw);
      place(cityCap, cityStone, x, ground + height * 0.9, z, width * 0.62, height * 0.13, width * 0.62, yaw);
      place(cityRing, bronze, x, ground + height * 0.34, z, width * 1.02, width * 1.02, width * 1.02, yaw);
      place(cityRing, tealLight, x, ground + height * 0.61, z, width * 0.83, width * 0.83, width * 0.83, yaw);
      return { x, z, y: ground + height * 0.57 };
    });
    skywalk(frontOutposts[0], frontOutposts[1], 1.4);
    skywalk(frontOutposts[1], frontOutposts[2], 1.0);
    skywalk(frontOutposts[3], frontOutposts[4], 1.4);
    skywalk(frontOutposts[4], frontOutposts[5], 1.0);

    // Closer shoreline-facing buildings make the settlement visible from the gangway.
    // Their paired layout frames the open center lane instead of building across it.
    const nearShore = [
      [-118, -18, 19], [-82, -66, 23], [-148, -76, 16],
      [118, -18, 20], [82, -66, 18], [148, -76, 17]
    ].map(([x, z, height], index) => {
      const ground = this.heightAt(x, z);
      const width = 6.2 + (index % 2) * 1.4;
      const yaw = index * 0.67;
      place(cityBox, cityStone, x, ground + 1.0, z, width * 2.3, 2, width * 2.3, yaw);
      place(cityCore, cityStone, x, ground + height * 0.43, z, width, height * 0.75, width, yaw);
      place(cityTower, cityMetal, x, ground + height * 0.79, z, width * 0.76, height * 0.12, width * 0.76, yaw);
      place(cityRing, bronze, x, ground + height * 0.32, z, width * 1.02, width * 1.02, width * 1.02, yaw);
      place(cityRing, tealLight, x, ground + height * 0.61, z, width * 0.84, width * 0.84, width * 0.84, yaw);
      return { x, z, y: ground + height * 0.56 };
    });
    skywalk(nearShore[0], nearShore[1], 1.2);
    skywalk(nearShore[1], nearShore[2], 0.8);
    skywalk(nearShore[3], nearShore[4], 1.2);
    skywalk(nearShore[4], nearShore[5], 0.8);
    skywalk(nearShore[1], nearShore[4], 5.5);

    // Broken high-rises form a ruined skyline between the beach and the distant settlement.
    // Their gaps keep the center approach open; fractured crowns and violet light imply alien damage.
    const ruinedTowers = [
      [-178, -148, 53], [-137, -188, 68], [-184, -224, 46],
      [178, -148, 57], [137, -188, 72], [184, -224, 49],
      [-108, -236, 44], [108, -236, 47]
    ];
    ruinedTowers.forEach(([x, z, height], index) => {
      const ground = this.heightAt(x, z);
      const width = 10 + (index % 3) * 2.5;
      const depth = 11 + ((index + 1) % 3) * 2.2;
      const yaw = index * 0.27;
      const lean = (index % 2 ? -1 : 1) * (0.035 + (index % 3) * 0.018);
      const tower = place(cityBox, cityStone, x, ground + height * 0.48, z, width, height * 0.96, depth, yaw);
      tower.rotation.z = lean;
      place(cityBox, cityMetal, x + Math.sin(yaw) * 1.3, ground + height * 0.91, z, width * 0.82, height * 0.12, depth * 0.86, yaw + 0.08);
      place(cityBox, cityStone, x - width * 0.22, ground + height + 3.2, z + depth * 0.12, width * 0.48, 7.5, depth * 0.46, yaw - 0.12);
      place(cityBox, cityMetal, x + width * 0.26, ground + height * 0.88, z - depth * 0.18, width * 0.36, height * 0.18, depth * 0.36, yaw + 0.1);
      for (let floor = 1; floor <= 4; floor++) {
        const y = ground + height * (0.19 + floor * 0.135);
        place(cityBox, violetLight, x + Math.cos(yaw) * (width * 0.505), y, z - Math.sin(yaw) * (depth * 0.505), 0.22, 2.2 + (floor % 2), 1.4, yaw);
      }
      // Fallen facade slabs at the base make the towers look damaged rather than newly built.
      place(cityBox, cityMetal, x - width * 0.85, ground + 1.8, z + 3, width * 0.7, 3.6, 5.2, yaw + 0.42);
      place(cityBox, cityStone, x + width * 0.72, ground + 1.1, z - 4, width * 0.54, 2.2, 4.1, yaw - 0.35);
    });

    // A dark, weathered channel winds through the ruined district, away from the path.
    const energyPoints = [
      [84, -245], [111, -274], [95, -302], [132, -329], [118, -357], [151, -389]
    ].map(([x, z]) => new THREE.Vector3(x, this.heightAt(x, z) + 0.36, z));
    const energyCurve = new THREE.CatmullRomCurve3(energyPoints, false, 'centripetal');
    const energyChannel = new THREE.Mesh(new THREE.TubeGeometry(energyCurve, 58, 0.8, 6, false), violetLight);
    energyChannel.name = 'WeatheredRuinedChannel';
    energyChannel.castShadow = false;
    energyChannel.receiveShadow = false;
    group.add(energyChannel);
    this.landmarkGeometries.push(energyChannel.geometry);

    for (const [x, z, width, depth] of [
      [-120, -242, 38, 17], [120, -242, 38, 17], [-132, -300, 34, 16], [132, -300, 34, 16]
    ]) {
      const ground = this.heightAt(x, z);
      place(cityBox, cityStone, x, ground + 2.2, z, width, 4.4, depth);
      place(cityBox, bronze, x, ground + 4.6, z, width * 1.08, 0.35, depth * 1.1);
      place(cityBox, tealLight, x, ground + 4.85, z + depth * 0.35, width * 0.7, 0.14, 0.18);
    }

    // Low terraced halls tuck the skyline into the ridges instead of leaving isolated towers.
    for (const [x, z, width, depth, height] of [
      [-145, -370, 48, 24, 10], [-54, -378, 52, 27, 12], [38, -385, 54, 26, 9], [130, -370, 45, 24, 11]
    ]) {
      const ground = this.heightAt(x, z);
      place(cityBox, cityStone, x, ground + height * 0.5, z, width, height, depth);
      place(cityBox, cityMetal, x, ground + height + 1, z, width * 1.08, 1.4, depth * 1.1);
      place(cityBox, bronze, x, ground + height + 1.85, z, width * 0.92, 0.25, 0.16);
    }

    const makeRock = (seed) => {
      const geometry = new THREE.IcosahedronGeometry(1, 1);
      const positions = geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        const wobble = 1 + 0.13 * Math.sin(x * 11 + seed) * Math.cos(z * 9 - seed * 2) + 0.07 * Math.sin(y * 15 + seed * 3);
        positions.setXYZ(i, x * wobble, y * wobble, z * wobble);
      }
      geometry.computeVertexNormals();
      this.landmarkGeometries.push(geometry);
      return geometry;
    };
    const addRockCollider = (mesh) => {
      const physics = this.gameWorld.physics;
      const positions = mesh.geometry.getAttribute('position');
      if (!physics || !positions) return;
      mesh.updateMatrixWorld(true);
      const points = new Float32Array(positions.count * 3);
      const point = new THREE.Vector3();
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
        // These rocks are intentionally sunk into the terrain for a natural base. Keep their
        // colliders above the matching ground surface so the hidden underside cannot snag feet.
        point.y = Math.max(point.y, this.heightAt(point.x, point.z) + 0.02);
        points[i * 3] = point.x;
        points[i * 3 + 1] = point.y;
        points[i * 3 + 2] = point.z;
      }
      const collider = physics.createStaticConvexHull(points, { x: 0, y: 0, z: 0 });
      if (collider) {
        collider.userData = { isLandmark: true };
        this.landmarkColliders.push(collider);
      }
    };
    const rockShapes = [makeRock(2), makeRock(7), makeRock(13)];
    const makeChunk = (x, y, z, sx, sy, sz, variant = 0, rotation = 0) => {
      const chunk = new THREE.Mesh(rockShapes[variant % rockShapes.length], grey[variant % grey.length]);
      chunk.position.set(x, y, z);
      chunk.scale.set(sx, sy, sz);
      chunk.rotation.set(rotation * 0.17, rotation * 0.31, rotation * 0.11);
      chunk.castShadow = true;
      chunk.receiveShadow = true;
      group.add(chunk);
      addRockCollider(chunk);
      return chunk;
    };

    // Two craggy stacks anchor an enormous arched slab high above the central approach.
    const archZ = -105;
    const leftGround = this.heightAt(-112, archZ);
    const rightGround = this.heightAt(112, archZ);
    const archBase = Math.max(leftGround, rightGround);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-112, leftGround + 32, archZ),
      new THREE.Vector3(-76, archBase + 43, archZ - 2),
      new THREE.Vector3(-30, archBase + 55, archZ - 5),
      new THREE.Vector3(24, archBase + 58, archZ - 3),
      new THREE.Vector3(72, archBase + 48, archZ),
      new THREE.Vector3(112, rightGround + 32, archZ + 2)
    ], false, 'centripetal');
    const bridge = new THREE.Mesh(new THREE.TubeGeometry(curve, 54, 7.5, 8, false), grey[0]);
    bridge.name = 'NaturalStoneArch';
    bridge.castShadow = bridge.receiveShadow = true;
    group.add(bridge);
    this.landmarkGeometries.push(bridge.geometry);

    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const point = curve.getPointAt(t);
      const size = 7 + 3 * Math.sin(t * Math.PI);
      makeChunk(point.x, point.y + 6.2, point.z, size, size * 0.72, size * 0.9, i % 3, i * 7);
    }

    const spire = (x, z, height, seed) => {
      const ground = this.heightAt(x, z);
      const stones = Math.ceil(height / 10);
      for (let level = 0; level < stones; level++) {
        const t = level / stones;
        const width = (11 + Math.sin(seed + level * 1.8) * 2.2) * (1 - t * 0.58);
        const y = ground + level * 8.3 + 4.2;
        makeChunk(
          x + Math.sin(seed + level * 2.1) * level * 1.2,
          y,
          z + Math.cos(seed * 0.7 + level) * level,
          width, 10 + (level % 2) * 2, width * 0.8,
          (seed + level) % 3,
          seed + level
        );
      }
      makeChunk(x + Math.sin(seed) * 2, ground + height, z, 4.5, 7.5, 4.5, seed + 1, seed * 3);
    };
    spire(-155, -132, 56, 3);
    spire(158, -148, 68, 8);
    spire(-42, -265, 82, 12);
    spire(78, -302, 61, 17);

    // A monumental leaning slab rises beside the near shore, echoing the fractured monoliths
    // in the reference while sitting left of the central route.
    const monolithX = -34;
    const monolithZ = 28;
    const monolithGround = this.heightAt(monolithX, monolithZ);
    const monolith = new THREE.Mesh(rockShapes[1], grey[2]);
    monolith.name = 'LeaningCoastalMonolith';
    monolith.position.set(monolithX, monolithGround + 61, monolithZ);
    monolith.scale.set(19, 59, 15);
    monolith.rotation.set(-0.08, 0.16, 0.43);
    monolith.castShadow = true;
    monolith.receiveShadow = true;
    group.add(monolith);
    addRockCollider(monolith);
    makeChunk(-66, monolithGround + 7, monolithZ + 3, 13, 7, 11, 0, 12);
    makeChunk(-8, monolithGround + 5, monolithZ + 10, 10, 5, 13, 2, 19);
    makeChunk(-48, monolithGround + 13, monolithZ - 8, 9, 12, 8, 1, 5);

    // Add box colliders after assembly: some skywalk meshes have their position and rotation
    // adjusted after `place()` returns. Building colliders from their final world transforms
    // keeps the physics aligned with the visible walls, towers, foundations and walkways.
    if (this.gameWorld.physics) {
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      group.updateMatrixWorld(true);
      for (const mesh of group.children) {
        if (!mesh.isMesh || mesh.geometry !== cityBox) continue;
        mesh.getWorldScale(scale);
        const sx = Math.abs(scale.x), sy = Math.abs(scale.y), sz = Math.abs(scale.z);
        // Skip trim, window lights and other narrow ornament; collide with substantial solids.
        if (sx < 2.4 || sy < 1.2 || sz < 2.4) continue;
        mesh.getWorldPosition(position);
        mesh.getWorldQuaternion(rotation);
        const collider = this.gameWorld.physics.createStaticBox(
          { x: sx * 0.5, y: sy * 0.5, z: sz * 0.5 },
          position,
          { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }
        );
        if (collider) {
          collider.userData = { isLandmark: true };
          this.landmarkColliders.push(collider);
        }
      }
    }

    // Batch the static landmark pieces by shared geometry/material to keep the added skyline
    // from turning into hundreds of separate draw calls.
    const batches = new Map();
    for (const child of [...group.children]) {
      if (!child.isMesh || Array.isArray(child.material)) continue;
      child.updateMatrix();
      const key = `${child.geometry.uuid}:${child.material.uuid}:${child.castShadow ? 1 : 0}`;
      if (!batches.has(key)) batches.set(key, { geometry: child.geometry, material: child.material, castShadow: child.castShadow, meshes: [] });
      batches.get(key).meshes.push(child);
      group.remove(child);
    }
    for (const batch of batches.values()) {
      const instances = new THREE.InstancedMesh(batch.geometry, batch.material, batch.meshes.length);
      instances.name = 'LandmarkInstanceBatch';
      instances.castShadow = batch.castShadow;
      instances.receiveShadow = true;
      batch.meshes.forEach((mesh, index) => instances.setMatrixAt(index, mesh.matrix));
      instances.instanceMatrix.needsUpdate = true;
      instances.computeBoundingSphere();
      group.add(instances);
    }
    parent.add(group);
    this.beachLandmarks = group;
  }

  _islandColor(x, z, height, slope, out) {
    if (height < -0.3) {
      return out.copy(SEABED_DEEP).lerp(SEABED, smoothstep(-8, -0.3, height));
    }

    const inland = this.inlandDistance(x, z);
    const variation = valueNoise2D(x * 0.06, z * 0.06, SEED + 3);
    const fineVariation = valueNoise2D(x * 0.19, z * 0.17, SEED + 37);

    if (this.lookName === 'stronghold') {
      const concrete = _colorA.setHex(0x343d49).lerp(_colorB.setHex(0x252e3a), variation * 0.58 + fineVariation * 0.18);
      const exposed = Math.max(smoothstep(0.2, 0.5, slope), smoothstep(24, 48, height) * 0.65);
      out.copy(concrete).lerp(_colorB.setHex(0x59616b), exposed * 0.32);
      return out;
    }

    // Dark weathered paving across the Level 2 beach, with worn slab joints and aggregate
    // variation; other layouts keep their natural sand shoreline.
    if (this.layoutName === 'beach' && inland < BEACH_WIDTH) {
      const broadPatch = valueNoise2D(x * 0.11, z * 0.11, SEED + 103);
      const grit = valueNoise2D(x * 0.47, z * 0.43, SEED + 109);
      out.setHex(0x62686a).lerp(_colorA.setHex(0x464c4f), broadPatch * 0.62);
      out.lerp(_colorB.setHex(0x777c7d), grit * 0.18);
      const tileX = ((x + 420) % 11 + 11) % 11;
      const tileZ = ((z + 530) % 8 + 8) % 8;
      const joint = Math.min(tileX, 11 - tileX, tileZ, 8 - tileZ);
      const wornSeam = 1 - smoothstep(0.16, 0.52, joint);
      out.lerp(_colorB.setHex(0x252a2d), wornSeam * 0.54);
      out.lerp(_colorB.setHex(0x353b3e), 1 - smoothstep(0.22, 0.88, height));
      return out;
    }

    // Sand, darker where the sea wets it
    if (this.layoutName === 'beach') {
      out.setHex(0x927750).lerp(_colorA.setHex(0x735a3e), variation * 0.42);
      out.lerp(_colorB.setHex(0x594a3b), 1 - smoothstep(0.2, 0.9, height));
    } else {
      out.copy(SAND).lerp(SAND_DARK, variation * 0.4);
      out.lerp(WET_SAND, 1 - smoothstep(0.2, 0.9, height));
    }

    // Rocky, weathered foothills like the reference; keep sand at the landing.
    if (this.layoutName === 'beach') {
      this._grassColor.copy(HILL_SOIL).lerp(HILL_SOIL_DARK, variation * 0.62 + fineVariation * 0.3);
      const stonePatches = valueNoise2D(x * 0.24 + 4, z * 0.21 - 8, SEED + 73);
      this._grassColor.lerp(HILL_ROCK, smoothstep(0.48, 0.82, stonePatches) * 0.35);
    } else {
      this._grassColor.copy(GRASS).lerp(GRASS_DARK, variation * 0.72 + fineVariation * 0.28);
    }
    if (this.layoutName !== 'beach') {
      this._grassColor.lerp(DIRT, (1 - smoothstep(4, 10, this.pathDistance(x, z))) * 0.85);
    }
    out.lerp(this._grassColor, smoothstep(BEACH_WIDTH - 8, BEACH_WIDTH + 6, inland));

    // Exposed, broken rock bands on steep faces and high alpine shoulders.
    const exposure = Math.max(smoothstep(0.23, 0.52, slope), smoothstep(24, 48, height) * 0.7);
    const strata = smoothstep(0.38, 0.72, fineVariation) * exposure * 0.28;
    out.lerp(this.layoutName === 'beach' ? HILL_ROCK : ROCK, exposure * (0.78 + strata));

    if (this.layoutName === 'beach') {
      const fieldRadius = Math.hypot(x * 0.92, (z + 100) * 0.82);
      const clearing = 1 - smoothstep(42, 78, fieldRadius);
      out.lerp(HILL_SOIL, clearing * 0.42);
      let rutDistance = 1000;
      for (const radius of [18, 22, 28, 34, 41, 48, 55]) {
        rutDistance = Math.min(rutDistance, Math.abs(fieldRadius - radius));
      }
      const ruts = (1 - smoothstep(1.1, 3.4, rutDistance)) * clearing;
      out.lerp(TRACK_SOIL, ruts * 0.72);
    }
    return out;
  }

  dispose() {
    for (const collider of this.landmarkColliders) {
      this.gameWorld.physics?.removeRigidBody(collider.rigidBody);
    }
    this.landmarkColliders = [];

    for (const light of this.lights) {
      if (light.parent) light.parent.remove(light);
      if (light.isLight) light.dispose(); // Frees the shadow map
    }
    this.lights = [];

    if (this.ocean) {
      this.ocean.dispose();
      this.ocean = null;
    }
    if (this.sky) {
      this.sky.dispose();
      this.sky = null;
    }
    if (this.clouds) {
      this.clouds.dispose();
      this.clouds = null;
    }
    if (this.beachLandmarks) {
      this.beachLandmarks.parent?.remove(this.beachLandmarks);
      this.beachLandmarks = null;
    }
    for (const geometry of this.landmarkGeometries) geometry.dispose();
    this.landmarkGeometries = [];
    for (const material of this.landmarkMaterials) material.dispose();
    this.landmarkMaterials = [];
    if (this.cloudShadows) {
      this.cloudShadows.dispose();
      this.cloudShadows = null;
    }
    if (this.creek) {
      this.creek.traverse((object) => {
        object.geometry?.dispose();
        if (object.material && object !== this.creek.children[0]) object.material.dispose();
      });
      this.creek.userData.waterMaterial.dispose();
      this.creek.parent?.remove(this.creek);
      this.creek = null;
    }
    const cliffMaterial = this.coastalCliffs[0]?.userData.sharedMaterial;
    const cliffNormal = this.coastalCliffs[0]?.userData.normalMap;
    for (const cliff of this.coastalCliffs) {
      cliff.traverse((object) => object.geometry?.dispose());
      cliff.parent?.remove(cliff);
    }
    cliffMaterial?.dispose();
    cliffNormal?.dispose();
    this.coastalCliffs = [];
    if (this.terrain) {
      this.terrain.dispose();
      this.terrain = null;
    }

    const scene = this.gameWorld.scene;
    scene.background = this._previousBackground;
    scene.fog = this._previousFog;
  }
}
