import * as THREE from 'three';
import { Ocean } from '../../rendering/Ocean.js';
import { Terrain } from '../../rendering/Terrain.js';
import { SkyDome } from '../../rendering/SkyDome.js';
import { Clouds } from '../../rendering/Clouds.js';
import { valueNoise2D, fbm2D, smoothstep } from '../../rendering/Noise.js';

// Island layout (meters). A long oval running north from the landing beach: Level 2 is fought
// on the south beach (waterline at z = 200, where the ship anchors) and Level 3's village
// sits on a plateau near the far northern end.
const ISLAND_CENTRE_Z = -150;
const ISLAND_HALF_WIDTH = 260;   // Along X
const ISLAND_HALF_LENGTH = 350;  // Along Z: the south waterline is at ISLAND_CENTRE_Z + 350 = 200
const TERRAIN_WIDTH = 680;       // Covers x = -340..340
const TERRAIN_DEPTH = 920;       // Covers z = -620..300
const TERRAIN_CENTRE_Z = -160;
const TERRAIN_CELL = 4;
// The grid is shifted off round numbers: a perfectly vertical ray through an exact grid corner can
// slip between Rapier's heightfield triangles, and the round coordinates we use for spawns and
// checks would otherwise land exactly on corners (every 4 m).
const TERRAIN_GRID_SHIFT = 0.173;
const BEACH_WIDTH = 40;          // Sand band between the waterline and the grass
const HILLS_RISE = 70;           // Distance over which the ground climbs from the beach into the hills
const VILLAGE = { x: 0, z: -340, radius: 90, height: 12 }; // Flat ground for Level 3's village
const VILLAGE_BLEND = 45;        // The hills ease down to the village flat over this width
const SEED = 7;

// Sunset look: the sun low in the west (to the left looking inland, and in view from the sea
// in the opening), a warm glow along that side of the sky, dusky blue overhead
const SKY_COLOR = 0xeaa57e;        // Also the haze at the horizon and the fog
const FOG_DENSITY = 0.0026;
const SUN_COLOR = 0xff9a5a;
const SUN_DIRECTION = new THREE.Vector3(-0.96, 0.24, -0.12).normalize(); // About 14 degrees up
const SKY_GLOW_COLOR = 0xff9a5c;
const SKY_UPPER_COLOR = 0xc58aa0;
const SKY_ZENITH_COLOR = 0x4a4f86;
const SUN_DISC_COLOR = 0xffe3b0;
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
 * The island: procedural terrain with the landing beach in the south, jungle hills, a path
 * winding north to the village plateau at the far end, a calm sea, and a sunset sky with clouds.
 * Shared by Level02 and Level02TestLevel; `village` tells Level 3 where its houses go.
 */
export class BeachEnvironment {
  constructor(gameWorld) {
    this.gameWorld = gameWorld;
    this.terrain = null;
    this.ocean = null;
    this.sky = null;
    this.clouds = null;
    this.lights = [];
    this.spawnPoints = {};
    this.village = { ...VILLAGE }; // Where Level 3's houses go

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

    // 1. Sunset sky, clouds and fog
    this._previousBackground = scene.background;
    this._previousFog = scene.fog;
    scene.background = new THREE.Color(SKY_COLOR);
    scene.fog = new THREE.FogExp2(SKY_COLOR, FOG_DENSITY);
    this.sky = new SkyDome({
      sunDirection: SUN_DIRECTION,
      horizonColor: SKY_COLOR,
      glowColor: SKY_GLOW_COLOR,
      upperColor: SKY_UPPER_COLOR,
      zenithColor: SKY_ZENITH_COLOR,
      sunColor: SUN_DISC_COLOR
    });
    group.add(this.sky.mesh);
    this.clouds = new Clouds();
    group.add(this.clouds.mesh);

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
      width: TERRAIN_WIDTH,
      depth: TERRAIN_DEPTH,
      cellSize: TERRAIN_CELL,
      center: { x: TERRAIN_GRID_SHIFT, z: TERRAIN_CENTRE_Z + TERRAIN_GRID_SHIFT },
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
    return this._shoreRadius(x, z) - Math.hypot(x, z - ISLAND_CENTRE_Z);
  }

  /**
   * Ground steepness at (x, z): 0 on flat ground, 1 on a vertical face.
   */
  slopeAt(x, z) {
    const dx = (this.heightAt(x + 1, z) - this.heightAt(x - 1, z)) / 2;
    const dz = (this.heightAt(x, z + 1) - this.heightAt(x, z - 1)) / 2;
    return 1 - 1 / Math.sqrt(1 + dx * dx + dz * dz);
  }

  /** Unit vector towards the sun (shared by the light, the sky and the sea's glint). */
  get sunDirection() {
    return SUN_DIRECTION;
  }

  /**
   * Advances the sea and drifts the clouds (keeping them around the camera). Call once per frame in Phase 5.
   */
  update(delta) {
    if (this.ocean) this.ocean.update(delta);
    if (this.clouds) {
      const camera = this.gameWorld.getActiveCamera ? this.gameWorld.getActiveCamera() : this.gameWorld.camera;
      this.clouds.update(delta, camera ? camera.position : null);
    }
  }

  _pointOnGround(x, z) {
    return new THREE.Vector3(x, this.heightAt(x, z) + 0.3, z);
  }

  _addLight(object) {
    this.gameWorld.environmentGroup.add(object);
    this.lights.push(object);
  }

  /**
   * Distance from the island centre to the waterline in the direction of (x, z): an oval,
   * with a wobbling coast everywhere except the landing beach (towards +Z), which stays a smooth arc.
   */
  _shoreRadius(x, z) {
    const theta = Math.atan2(x, z - ISLAND_CENTRE_Z);
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    const oval = (ISLAND_HALF_WIDTH * ISLAND_HALF_LENGTH) /
      Math.sqrt((ISLAND_HALF_LENGTH * sin) ** 2 + (ISLAND_HALF_WIDTH * cos) ** 2);
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
    const fromVillage = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
    const plateau = 1 - smoothstep(VILLAGE.radius, VILLAGE.radius + VILLAGE_BLEND, fromVillage);
    return height + (VILLAGE.height - height) * plateau;
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
