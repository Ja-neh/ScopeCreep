import * as THREE from 'three';
import { periodicFbm2D } from './Noise.js';

// Cloud shade tuning. Rendering owns its look, so it lives here (never config.json).
const TEXTURE_SIZE = 256;       // Cloud bank tile, in texels
const REPEAT_METERS = 620;      // World distance covered by one tile
const DRIFT_SPEED = 5.5;        // Metres per second the banks drift downwind
const WIND_ANGLE = 0.6;         // Downwind direction, radians around +Y
const CLOUD_ALTITUDE = 240;     // Projection height used for the sun's shear
const MIN_SUN_HEIGHT = 0.25;    // Floor for that projection, so low suns stay finite
const COVERAGE_START = 0.44;    // Noise below this is open sky
const COVERAGE_END = 0.62;      // Noise above this is solid cloud
const DEFAULT_STRENGTH = 0.32;  // Deepest shade, as a fraction of sunlight removed
const SEED = 11;

const _wind = new THREE.Vector2(Math.cos(WIND_ANGLE), Math.sin(WIND_ANGLE));

/**
 * CloudShadows
 * Drifting sunlight shading from the cloud layer. The clouds are a distant,
 * unlit backdrop, so breaking the light up with a second shadow map would be
 * wasteful; instead one seamless noise tile is projected down the sun direction
 * and multiplied into the terrain and ocean shaders.
 */
export class CloudShadows {
  constructor({ strength = DEFAULT_STRENGTH, seed = SEED } = {}) {
    this.texture = this._bakeTexture(seed);
    this._drift = 0;

    // Ocean uniforms take these objects directly; terrain materials get them
    // through onBeforeCompile. Everyone shares the same values by reference.
    this.uniforms = {
      uCloudShadowMap: { value: this.texture },
      uCloudShadowScale: { value: new THREE.Vector2(1 / REPEAT_METERS, 1 / REPEAT_METERS) },
      uCloudShadowOffset: { value: new THREE.Vector2(0, 0) },
      uCloudShadowStrength: { value: strength }
    };
  }

  /** Bakes one seamless cloud coverage tile (dark = cloud) ready to drift. */
  _bakeTexture(seed) {
    const data = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const u = x / TEXTURE_SIZE;
        const v = y / TEXTURE_SIZE;
        const banks = periodicFbm2D(u * 4, v * 4, 4, 4, seed);
        const detail = periodicFbm2D(u * 12, v * 12, 3, 12, seed + 7);
        const cover = THREE.MathUtils.smoothstep(banks * 0.62 + detail * 0.38, COVERAGE_START, COVERAGE_END);
        const shade = Math.round((1 - cover) * 255);
        const i = (y * TEXTURE_SIZE + x) * 4;
        data[i] = shade;
        data[i + 1] = shade;
        data[i + 2] = shade;
        data[i + 3] = 255;
      }
    }

    const texture = new THREE.DataTexture(data, TEXTURE_SIZE, TEXTURE_SIZE, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  }

  /** Advances the drift and re-projects the tile for the current sun direction. */
  update(delta, sunDirection) {
    this._drift -= (DRIFT_SPEED * delta) / REPEAT_METERS;
    this._drift -= Math.floor(this._drift);

    const sunHeight = Math.max(Math.abs(sunDirection.y), MIN_SUN_HEIGHT);
    const shear = (CLOUD_ALTITUDE / REPEAT_METERS) / sunHeight;
    this.uniforms.uCloudShadowOffset.value.set(
      _wind.x * this._drift + sunDirection.x * shear,
      _wind.y * this._drift + sunDirection.z * shear
    );
  }

  /** Hands the shading uniforms to an ocean-style ShaderMaterial uniform map. */
  applyToOcean(uniforms) {
    uniforms.uCloudShadowMap = this.uniforms.uCloudShadowMap;
    uniforms.uCloudShadowScale = this.uniforms.uCloudShadowScale;
    uniforms.uCloudShadowOffset = this.uniforms.uCloudShadowOffset;
    uniforms.uCloudShadowStrength = this.uniforms.uCloudShadowStrength;
  }

  /**
   * Patches a lit material so its final output is multiplied by the cloud
   * shade, sampled from the world XZ of every fragment.
   */
  applyToMaterial(material) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uCloudShadowMap = this.uniforms.uCloudShadowMap;
      shader.uniforms.uCloudShadowScale = this.uniforms.uCloudShadowScale;
      shader.uniforms.uCloudShadowOffset = this.uniforms.uCloudShadowOffset;
      shader.uniforms.uCloudShadowStrength = this.uniforms.uCloudShadowStrength;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          [
            '#include <common>',
            'uniform vec2 uCloudShadowScale;',
            'uniform vec2 uCloudShadowOffset;',
            'varying vec2 vCloudShadowUV;'
          ].join('\n')
        )
        .replace(
          '#include <project_vertex>',
          [
            '#include <project_vertex>',
            'vCloudShadowUV = ( modelMatrix * vec4( transformed, 1.0 ) ).xz * uCloudShadowScale + uCloudShadowOffset;'
          ].join('\n')
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          [
            '#include <common>',
            'uniform sampler2D uCloudShadowMap;',
            'uniform float uCloudShadowStrength;',
            'varying vec2 vCloudShadowUV;'
          ].join('\n')
        )
        .replace(
          '#include <opaque_fragment>',
          [
            '#include <opaque_fragment>',
            'gl_FragColor.rgb *= 1.0 - uCloudShadowStrength * texture2D( uCloudShadowMap, vCloudShadowUV ).r;'
          ].join('\n')
        );
    };
    material.needsUpdate = true;
  }

  dispose() {
    if (this.texture) this.texture.dispose();
    this.texture = null;
    this.uniforms.uCloudShadowMap.value = null;
  }
}
