import * as THREE from 'three';
import oceanVert from './shaders/ocean.vert.glsl';
import oceanFrag from './shaders/ocean.frag.glsl';

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

    // Gerstner wave parameters: [dirX, dirZ, steepness, wavelength]
    // Smoother rolling ocean swells without sharp chaotic fractal facets
    this.waveParams = {
      waveA: new THREE.Vector4(1.0, 0.3, 0.14, 85.0),
      waveB: new THREE.Vector4(0.6, 0.8, 0.10, 52.0),
      waveC: new THREE.Vector4(-0.4, 0.7, 0.06, 32.0),
      waveD: new THREE.Vector4(0.2, -0.5, 0.03, 18.0)
    };

    this.sunDirection = options.sunDirection || new THREE.Vector3(150, 250, 100).normalize();

    // 1. Geometry (Subdivided flat plane oriented horizontally)
    this.geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    this.geometry.rotateX(-Math.PI / 2);

    // 2. Custom Shader Material
    this.uniforms = {
      uTime: { value: 0.0 },
      uWaveA: { value: this.waveParams.waveA },
      uWaveB: { value: this.waveParams.waveB },
      uWaveC: { value: this.waveParams.waveC },
      uWaveD: { value: this.waveParams.waveD },
      uDeepColor: { value: new THREE.Color(0x1a4b6e) },      // Luminous deep ocean cobalt (no longer black/ink)
      uShallowColor: { value: new THREE.Color(0x2ca0b8) },   // Vibrant tropical cyan crest
      uFoamColor: { value: new THREE.Color(0xf4faff) },      // Soft crest foam
      uSkyColor: { value: new THREE.Color(0x87ceeb) },
      uSunColor: { value: new THREE.Color(0xfff5e6) },
      uSunDirection: { value: this.sunDirection },
      uFoamThreshold: { value: 1.25 },
      fogColor: { value: new THREE.Color(0x87ceeb) },
      fogDensity: { value: 0.0010 }
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: oceanVert,
      fragmentShader: oceanFrag,
      uniforms: this.uniforms,
      fog: true,
      transparent: true,
      side: THREE.FrontSide
    });

    // 3. Mesh
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'GerstnerOceanMesh';
    this.mesh.position.y = 0;
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
    return y;
  }

  dispose() {
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}

export { Ocean as WaterMesh };
