import * as THREE from 'three';
import { Ocean } from '../../rendering/Ocean.js';
import { Terrain } from '../../rendering/Terrain.js';
import { valueNoise2D, fbm2D, smoothstep } from '../../rendering/Noise.js';

// Island layout (meters). The island centre is the world origin; the landing beach faces +Z.
const TERRAIN_SIZE = 640;
const TERRAIN_SEGMENTS = 160;
const SHORE_RADIUS = 200;   // Island centre to the waterline at the landing beach
const BEACH_WIDTH = 40;     // Sand band between the waterline and the grass
const HILLS_RISE = 70;      // Distance over which the ground climbs from the beach into the hills
const PLATEAU_HEIGHT = 9;   // Flat ground at the island centre, where the village stands
const SEED = 7;

// Dusk look
const SKY_COLOR = 0xeaa57e;
const FOG_DENSITY = 0.0026;
const SUN_COLOR = 0xffa766;
const SUN_DIRECTION = new THREE.Vector3(-0.8, 0.35, 0.45).normalize();
const SHADOW_CENTRE = new THREE.Vector3(0, 0, 140); // Covers the beach and the jungle edge
const SHADOW_HALF_EXTENT = 170;

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
 * The island seen in Level 2: procedural terrain with a beach, hills and a jungle path
 * leading inland, a calm sea, and dusk lighting. Shared by Level02 and Level02TestLevel.
 */
export class BeachEnvironment {
  constructor(gameWorld) {
    this.gameWorld = gameWorld;
    this.terrain = null;
    this.ocean = null;
    this.lights = [];
    this.spawnPoints = {};

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

    // 1. Dusk sky and fog
    this._previousBackground = scene.background;
    this._previousFog = scene.fog;
    scene.background = new THREE.Color(SKY_COLOR);
    scene.fog = new THREE.FogExp2(SKY_COLOR, FOG_DENSITY);

    // 2. Low warm sun and a warm-sky / dark-ground fill
    const hemi = new THREE.HemisphereLight(0xffc59a, 0x3a4a3a, 0.6);
    this._addLight(hemi);

    const sun = new THREE.DirectionalLight(SUN_COLOR, 2.0);
    sun.position.copy(SHADOW_CENTRE).addScaledVector(SUN_DIRECTION, 400);
    sun.target.position.copy(SHADOW_CENTRE);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 900;
    sun.shadow.camera.left = -SHADOW_HALF_EXTENT;
    sun.shadow.camera.right = SHADOW_HALF_EXTENT;
    sun.shadow.camera.top = SHADOW_HALF_EXTENT;
    sun.shadow.camera.bottom = -SHADOW_HALF_EXTENT;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this._addLight(sun);
    this._addLight(sun.target);

    // 3. Calm sea around the island, lit to match the dusk sky
    this.ocean = new Ocean({ size: 2600, segments: 200, sunDirection: SUN_DIRECTION, waveScale: 0.3 });
    this.ocean.uniforms.uSkyColor.value.set(SKY_COLOR);
    this.ocean.uniforms.uSunColor.value.set(SUN_COLOR);
    group.add(this.ocean.mesh);

    // 4. Terrain mesh and its matching heightfield collider
    this.terrain = new Terrain({
      size: TERRAIN_SIZE,
      segments: TERRAIN_SEGMENTS,
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
   * Advances the sea animation. Call once per frame in Phase 5.
   */
  update(delta) {
    if (this.ocean) this.ocean.update(delta);
  }

  _pointOnGround(x, z) {
    return new THREE.Vector3(x, this.heightAt(x, z) + 0.3, z);
  }

  _addLight(object) {
    this.gameWorld.environmentGroup.add(object);
    this.lights.push(object);
  }

  /**
   * Waterline distance from the island centre for the direction of (x, z).
   * The landing beach (towards +Z) stays a smooth arc; the rest of the coast wobbles.
   */
  _shoreRadius(x, z) {
    const theta = Math.atan2(x, z);
    const wobble = Math.sin(3 * theta + 0.7) * 10 + Math.sin(7 * theta + 2.1) * 5;
    return SHORE_RADIUS + wobble * smoothstep(0.35, 1.0, Math.abs(theta));
  }

  /**
   * Distance from the jungle path's centreline, which winds from the beach to the village.
   */
  _pathDistance(x, z) {
    return Math.abs(x - Math.sin(z * 0.018) * 16);
  }

  _islandHeight(x, z) {
    const distance = Math.hypot(x, z);
    const inland = this._shoreRadius(x, z) - distance; // Meters inland from the waterline

    // Sea floor drops away quickly so the anchored ship's hull clears it
    if (inland < 0) return Math.max(-14, inland * 0.4 - 0.2);

    const ripple = (valueNoise2D(x * 0.15, z * 0.15, SEED) - 0.5) * 0.25;
    const beach = 0.3 + Math.min(inland, BEACH_WIDTH) * 0.055 + ripple;
    if (inland < BEACH_WIDTH) return beach;

    // Hills behind the beach, with a valley carved along the jungle path
    const rise = smoothstep(BEACH_WIDTH, BEACH_WIDTH + HILLS_RISE, inland);
    const path = 1 - smoothstep(6, 20, this._pathDistance(x, z));
    const hills = (4 + fbm2D(x * 0.009, z * 0.009, 4, SEED) * 18) * (1 - path * 0.8);
    const height = beach + rise * hills;

    // Village plateau at the centre (Level 3)
    const plateau = 1 - smoothstep(60, 95, distance);
    return height + (PLATEAU_HEIGHT - height) * plateau;
  }

  _islandColor(x, z, height, slope, out) {
    if (height < -0.3) {
      return out.copy(SEABED_DEEP).lerp(SEABED, smoothstep(-8, -0.3, height));
    }

    const inland = this._shoreRadius(x, z) - Math.hypot(x, z);
    const variation = valueNoise2D(x * 0.06, z * 0.06, SEED + 3);

    // Sand, darker where the sea wets it
    out.copy(SAND).lerp(SAND_DARK, variation * 0.4);
    out.lerp(WET_SAND, 1 - smoothstep(0.2, 0.9, height));

    // Grass inland, worn to dirt along the jungle path
    this._grassColor.copy(GRASS).lerp(GRASS_DARK, variation);
    this._grassColor.lerp(DIRT, (1 - smoothstep(4, 10, this._pathDistance(x, z))) * 0.85);
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
    if (this.terrain) {
      this.terrain.dispose();
      this.terrain = null;
    }

    const scene = this.gameWorld.scene;
    scene.background = this._previousBackground;
    scene.fog = this._previousFog;
  }
}
