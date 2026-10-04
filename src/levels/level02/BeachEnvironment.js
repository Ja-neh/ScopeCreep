import * as THREE from 'three';
import { Ocean } from '../../rendering/Ocean.js';
import { Terrain } from '../../rendering/Terrain.js';
import { SkyDome } from '../../rendering/SkyDome.js';
import { Clouds } from '../../rendering/Clouds.js';
import { valueNoise2D, fbm2D, smoothstep } from '../../rendering/Noise.js';

// Island layouts (meters). The island runs north from the landing beach (south waterline at
// z = 200, where the ship anchors) to the village at the far end. Each level builds its own copy:
// - beach (Level 2): an oval, with a small village plateau at the far end nobody visits
// - village (Level 3): the northern half grows wider and longer to hold the big village
//   (an oval plateau 400 m across and 490 m long); the south is the same
// halfWidth / halfLength describe the southern half; northHalfWidth / northHalfLength the northern.
const LAYOUTS = {
  beach: {
    centreZ: -150, halfWidth: 260, halfLength: 350, northHalfWidth: 260, northHalfLength: 350,
    terrain: { width: 680, depth: 920, centreZ: -160 },       // x -340..340, z -620..300
    scatter: { minX: -290, maxX: 290, minZ: -530, maxZ: 230 }, // Where trees and rocks may grow
    village: { x: 0, z: -340, halfWidth: 90, halfLength: 90, height: 12 }
  },
  village: {
    centreZ: -150, halfWidth: 260, halfLength: 350, northHalfWidth: 350, northHalfLength: 640,
    terrain: { width: 800, depth: 1040, centreZ: -320 },      // x -400..400, z -840..200
    scatter: { minX: -370, maxX: 370, minZ: -800, maxZ: 200 },
    village: { x: 0, z: -400, halfWidth: 200, halfLength: 245, height: 12 }
  }
};
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
  // Level 2: the sun low in the west (to the left looking inland, and in view from the sea in
  // the opening), a warm glow along that side of the sky, dusky blue overhead
  sunset: {
    sky: 0xeaa57e, fogDensity: 0.0026,
    light: 0xff9a5a, lightIntensity: 2.0, direction: new THREE.Vector3(-0.96, 0.24, -0.12).normalize(),
    hemiSky: 0xffc59a, hemiGround: 0x3a4a3a, hemiIntensity: 0.6,
    glow: 0xff9a5c, upper: 0xc58aa0, zenith: 0x4a4f86, disc: 0xffe3b0, stars: 0,
    cloud: 0xf6dccf, cloudGlow: 0x6e4f63
  },
  // Level 3: moonlight from high in the south-east, behind the squad as it heads north through
  // the village (so the house fronts and the hall face the light), a deep blue sky full of
  // stars, dark haze
  night: {
    sky: 0x1c2740, fogDensity: 0.0034,
    light: 0xa9bde0, lightIntensity: 1.0, direction: new THREE.Vector3(0.4, 0.7, 0.6).normalize(),
    hemiSky: 0x4a5d88, hemiGround: 0x1a2018, hemiIntensity: 0.8,
    glow: 0x2c3d63, upper: 0x162139, zenith: 0x060a16, disc: 0xeef2ff, stars: 1,
    cloud: 0x55617d, cloudGlow: 0x0d1322
  },
  // Level 3's ending: the sun coming up in the east over the freed village, a rose and gold
  // horizon, the last stars fading
  dawn: {
    sky: 0xe9b294, fogDensity: 0.0022,
    light: 0xffc58a, lightIntensity: 1.7, direction: new THREE.Vector3(0.9, 0.2, -0.38).normalize(),
    hemiSky: 0xffd8b8, hemiGround: 0x48503e, hemiIntensity: 0.75,
    glow: 0xffa36e, upper: 0xa58fb8, zenith: 0x4f5f9c, disc: 0xfff0c8, stars: 0,
    cloud: 0xf3d2c2, cloudGlow: 0x6f4e5c
  }
};
const _colorA = new THREE.Color();
const _colorB = new THREE.Color();
const DEFAULT_SHADOW_CENTRE = new THREE.Vector3(0, 0, 140); // Covers the beach and the jungle edge
const DEFAULT_SHADOW_HALF_EXTENT = 170;
const _forward = new THREE.Vector3();     // Scratchpads for the camera-following shadow
const _centre = new THREE.Vector3();
const _lightRight = new THREE.Vector3();
const _lightUp = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

// Terrain palette
const SEABED = new THREE.Color(0xb59c6c);
const SEABED_DEEP = new THREE.Color(0x5e5038);
const WET_SAND = new THREE.Color(0xa98a5c);
const SAND = new THREE.Color(0xe6d3a0);
const SAND_DARK = new THREE.Color(0xcdb57f);
const GRASS = new THREE.Color(0x5c8a36);
const GRASS_DARK = new THREE.Color(0x3b6a28);
const DIRT = new THREE.Color(0x8b6b45);
const ROCK = new THREE.Color(0x7b7266);

/**
 * BeachEnvironment
 * The island: procedural terrain with the landing beach in the south, jungle hills, a path
 * winding north to the village plateau at the far end, a calm sea, and a sunset sky with clouds.
 * Shared by Level02 and Level02TestLevel; `village` tells Level 3 where its houses go.
 */
export class BeachEnvironment {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} [options]
   * @param {'sunset'|'night'} [options.look='sunset'] - Time of day
   * @param {'beach'|'village'} [options.layout='beach'] - Island shape (see LAYOUTS)
   * @param {THREE.Vector3} [options.shadowCentre] - Middle of the area that gets shadows (the fight)
   * @param {number} [options.shadowHalfExtent] - Half the width of that area (meters)
   * @param {boolean} [options.shadowFollowsCamera=false] - Move the shadow area with the camera
   *   (for a big place: sharper shadows where you are, and less to draw into the shadow map)
   */
  constructor(gameWorld, {
    look = 'sunset', layout = 'beach', shadowCentre = DEFAULT_SHADOW_CENTRE,
    shadowHalfExtent = DEFAULT_SHADOW_HALF_EXTENT, shadowFollowsCamera = false
  } = {}) {
    this.gameWorld = gameWorld;
    this.layout = LAYOUTS[layout] || LAYOUTS.beach;
    this.layoutName = LAYOUTS[layout] ? layout : 'beach';
    this.look = LOOKS[look] || LOOKS.sunset;
    this.lookName = LOOKS[look] ? look : 'sunset';
    this.shadowCentre = shadowCentre.clone();
    this.shadowHalfExtent = shadowHalfExtent;
    this.shadowFollowsCamera = shadowFollowsCamera;
    this.sun = null;
    this.hemi = null;
    this._direction = this.look.direction.clone(); // Towards the sun or moon (moves in blendLook)
    this.terrain = null;
    this.ocean = null;
    this.sky = null;
    this.clouds = null;
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

    // 2. The sun (or moon) and a sky / ground fill
    const hemi = new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemiIntensity);
    this._addLight(hemi);
    this.hemi = hemi;

    const sun = new THREE.DirectionalLight(look.light, look.lightIntensity);
    sun.position.copy(this.shadowCentre).addScaledVector(look.direction, 400);
    sun.target.position.copy(this.shadowCentre);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 900;
    sun.shadow.camera.left = -this.shadowHalfExtent;
    sun.shadow.camera.right = this.shadowHalfExtent;
    sun.shadow.camera.top = this.shadowHalfExtent;
    sun.shadow.camera.bottom = -this.shadowHalfExtent;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this._addLight(sun);
    this._addLight(sun.target);
    this.sun = sun;

    // 3. Calm sea around the island, lit to match the sky
    this.ocean = new Ocean({ size: 2600, segments: 200, sunDirection: look.direction.clone(), waveScale: 0.3 });
    this.ocean.uniforms.uSkyColor.value.set(look.sky);
    this.ocean.uniforms.uSunColor.value.set(look.light);
    group.add(this.ocean.mesh);

    // 4. Terrain mesh and its matching heightfield collider
    const terrain = this.layout.terrain;
    this.terrain = new Terrain({
      width: terrain.width,
      depth: terrain.depth,
      cellSize: TERRAIN_CELL,
      center: { x: TERRAIN_GRID_SHIFT, z: terrain.centreZ + TERRAIN_GRID_SHIFT },
      heightAt: (x, z) => this._islandHeight(x, z),
      colorAt: (x, z, h, slope, out) => this._islandColor(x, z, h, slope, out)
    });
    group.add(this.terrain.mesh);
    this.terrain.createCollider(this.gameWorld.physics);

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
      this.sun.position.copy(this.sun.target.position).addScaledVector(this._direction, 400);
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
    const camera = this.gameWorld.getActiveCamera ? this.gameWorld.getActiveCamera() : this.gameWorld.camera;
    if (this.clouds) this.clouds.update(delta, camera ? camera.position : null);
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
    this.sun.position.copy(_centre).addScaledVector(toLight, 400);
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

    // Hills behind the beach, with a valley carved along the jungle path
    const rise = smoothstep(BEACH_WIDTH, BEACH_WIDTH + HILLS_RISE, inland);
    const path = 1 - smoothstep(6, 20, this.pathDistance(x, z));
    const hills = (5 + fbm2D(x * 0.008, z * 0.008, 4, SEED) * 22) * (1 - path * 0.8);
    const height = beach + rise * hills;

    // Village plateau at the far end (Level 3)
    const plateau = 1 - smoothstep(0, VILLAGE_BLEND, this.distanceOutsideVillage(x, z));
    return height + (this.village.height - height) * plateau;
  }

  _islandColor(x, z, height, slope, out) {
    if (height < -0.3) {
      return out.copy(SEABED_DEEP).lerp(SEABED, smoothstep(-8, -0.3, height));
    }

    const inland = this.inlandDistance(x, z);
    const variation = valueNoise2D(x * 0.06, z * 0.06, SEED + 3);

    // Sand, darker where the sea wets it
    out.copy(SAND).lerp(SAND_DARK, variation * 0.4);
    out.lerp(WET_SAND, 1 - smoothstep(0.2, 0.9, height));

    // Grass inland, worn to dirt along the jungle path
    this._grassColor.copy(GRASS).lerp(GRASS_DARK, variation);
    this._grassColor.lerp(DIRT, (1 - smoothstep(4, 10, this.pathDistance(x, z))) * 0.85);
    out.lerp(this._grassColor, smoothstep(BEACH_WIDTH - 8, BEACH_WIDTH + 6, inland));

    // Bare rock on steep slopes
    return out.lerp(ROCK, smoothstep(0.28, 0.5, slope));
  }

  dispose() {
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
    if (this.terrain) {
      this.terrain.dispose();
      this.terrain = null;
    }

    const scene = this.gameWorld.scene;
    scene.background = this._previousBackground;
    scene.fog = this._previousFog;
  }
}
