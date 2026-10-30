import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import oceanVert from './shaders/level02-ocean.vert.glsl';
import oceanFrag from './shaders/level02-ocean.frag.glsl';

// A black 1x1 tile stands in until a CloudShadows system shares its real map,
// so the shader always has something to sample and the sea starts unshaded.
const NEUTRAL_CLOUD_SHADOW_TEXTURE = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
NEUTRAL_CLOUD_SHADOW_TEXTURE.needsUpdate = true;

/**
 * Ocean
 * Custom WebGL Ocean Surface driven by a GPU Gerstner wave displacement shader.
 * Features Fresnel reflection, Blinn-Phong specular glints, wave crest foam,
 * and CPU wave height sampling for ship buoyancy.
 */
export class Ocean {
  constructor(options = {}) {
    this.size = options.size || 2400;
    this.segments = options.segments || 200;
    this.shoreDampAt = options.shoreDampAt || null;
    this.shoreDistanceAt = options.shoreDistanceAt || null;

    // Scales every wave's steepness (and so its height); below 1 gives a calmer sea, e.g. near a beach
    const waveScale = options.waveScale ?? 1.0;

    // Gerstner wave parameters: [dirX, dirZ, steepness, wavelength]
    // Smoother rolling ocean swells without sharp chaotic fractal facets
    this.waveParams = {
      waveA: new THREE.Vector4(1.0, 0.3, 0.14 * waveScale, 85.0),
      waveB: new THREE.Vector4(0.6, 0.8, 0.10 * waveScale, 52.0),
      waveC: new THREE.Vector4(-0.4, 0.7, 0.06 * waveScale, 32.0),
      waveD: new THREE.Vector4(0.2, -0.5, 0.03 * waveScale, 18.0)
    };

    this.sunDirection = options.sunDirection || new THREE.Vector3(150, 250, 100).normalize();

    // 1. Geometry (Subdivided flat plane oriented horizontally)
    this.geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    const positions = this.geometry.attributes.position;
    const shoreDamp = new Float32Array(positions.count);
    const shoreDistance = new Float32Array(positions.count);
    for (let i = 0; i < positions.count; i++) {
      const worldX = positions.getX(i);
      const worldZ = -positions.getY(i); // The plane is rotated upward around X.
      shoreDamp[i] = this.shoreDampAt ? this.shoreDampAt(worldX, worldZ) : 1;
      shoreDistance[i] = this.shoreDistanceAt ? this.shoreDistanceAt(worldX, worldZ) : -10000;
    }
    this.geometry.setAttribute('aShoreDamp', new THREE.BufferAttribute(shoreDamp, 1));
    this.geometry.setAttribute('aShoreDistance', new THREE.BufferAttribute(shoreDistance, 1));

    // 2. Custom Shader Material
    this.uniforms = {
      uTime: { value: 0.0 },
      // Reflector updates these two uniforms immediately before the ocean draw.
      tDiffuse: { value: null },
      textureMatrix: { value: new THREE.Matrix4() },
      uWaveA: { value: this.waveParams.waveA },
      uWaveB: { value: this.waveParams.waveB },
      uWaveC: { value: this.waveParams.waveC },
      uWaveD: { value: this.waveParams.waveD },
      uDeepColor: { value: new THREE.Color(0x10323b) },
      uShallowColor: { value: new THREE.Color(0x315a60) },
      uFoamColor: { value: new THREE.Color(0xdce4e1) },
      uSkyColor: { value: new THREE.Color(0x87ceeb) },
      uSunColor: { value: new THREE.Color(0xfff5e6) },
      uSunDirection: { value: this.sunDirection },
      uFoamThreshold: { value: 1.25 },
      // Cloud shade: neutral until a CloudShadows system shares its uniforms here
      uCloudShadowMap: { value: NEUTRAL_CLOUD_SHADOW_TEXTURE },
      uCloudShadowScale: { value: new THREE.Vector2(1, 1) },
      uCloudShadowOffset: { value: new THREE.Vector2(0, 0) },
      uCloudShadowStrength: { value: 0.0 },
      fogColor: { value: new THREE.Color(0x87ceeb) },
      fogDensity: { value: 0.0010 }
    };

    const reflectionResolution = options.reflectionResolution || 512;
    this.mesh = new Reflector(this.geometry, {
      textureWidth: reflectionResolution,
      textureHeight: reflectionResolution,
      clipBias: 0.003,
      multisample: 0
    });
    const reflectionTarget = this.mesh.getRenderTarget();
    // Use the widely supported 8-bit render target for reflections on older lab GPUs.
    reflectionTarget.texture.type = THREE.UnsignedByteType;
    reflectionTarget.texture.generateMipmaps = false;
    const reflectorMaterial = this.mesh.material;
    this.material = new THREE.ShaderMaterial({
      vertexShader: oceanVert,
      fragmentShader: oceanFrag,
      uniforms: this.uniforms,
      fog: true,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      side: THREE.FrontSide
    });
    // Share Reflector's live matrix object; its callback updates that matrix in place.
    this.material.uniforms.textureMatrix.value = reflectorMaterial.uniforms.textureMatrix.value;
    this.material.uniforms.tDiffuse.value = reflectionTarget.texture;
    this.mesh.material = this.material;
    reflectorMaterial.dispose();

    // Reflector's plane normal is local +Z; rotate it to world +Y.
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.name = 'GerstnerOceanMesh';
    this.mesh.position.y = 0;
    this._reflectionFrame = 0;
    const renderReflection = this.mesh.onBeforeRender.bind(this.mesh);
    this.mesh.onBeforeRender = (...args) => {
      // Keep reflections responsive while limiting the extra scene render to 20 Hz.
      if (this._reflectionFrame++ % 3 === 0) renderReflection(...args);
    };
  }

  /**
   * Advances the wave animation uniform
   * @param {number} delta - Frame delta time in seconds
   */
  update(delta) {
    this.uniforms.uTime.value += delta;
  }

  /**
   * CPU calculation of wave height at any world (x, z) coordinate.
   * Matches the GPU vertex shader Gerstner wave formula.
   * Used for floating ship buoyancy and flight wave clearance.
   */
  getWaveHeight(x, z, time = this.uniforms.uTime.value) {
    let y = 0;
    const waves = [
      this.waveParams.waveA,
      this.waveParams.waveB,
      this.waveParams.waveC,
      this.waveParams.waveD
    ];

    for (const w of waves) {
      const steepness = w.z;
      const wavelength = w.w;
      const k = (2.0 * Math.PI) / wavelength;
      const c = Math.sqrt(9.8 / k);
      const len = Math.hypot(w.x, w.y);
      const dx = w.x / len;
      const dz = w.y / len;
      const f = k * (dx * x + dz * z - c * time);
      const a = steepness / k;

      y += a * Math.sin(f);
    }
    return y * (this.shoreDampAt ? this.shoreDampAt(x, z) : 1);
  }

  dispose() {
    if (this.geometry) this.geometry.dispose();
    if (this.mesh?.dispose) this.mesh.dispose();
    else if (this.material) this.material.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}

export { Ocean as WaterMesh };
