import * as THREE from 'three';
import skyVert from './shaders/sky.vert.glsl';
import skyFrag from './shaders/sky.frag.glsl';

/**
 * SkyDome
 * A gradient sky with the sun in it, drawn behind everything and always centred on the camera
 * (the vertex shader drops the camera's position), so it needs no per-frame update. The sun's
 * disc sits along `sunDirection`, which should match the scene's sun light and the sea's glint.
 */
export class SkyDome {
  /**
   * @param {Object} options
   * @param {THREE.Vector3} options.sunDirection - Unit vector towards the sun
   * @param {number} options.horizonColor - Haze at the horizon: use the scene's fog colour
   * @param {number} options.glowColor - Warm band low down on the sun's side
   * @param {number} options.upperColor
   * @param {number} options.zenithColor
   * @param {number} options.sunColor
   */
  constructor({ sunDirection, horizonColor, glowColor, upperColor, zenithColor, sunColor }) {
    this.uniforms = {
      uSunDirection: { value: sunDirection.clone().normalize() },
      uHorizonColor: { value: new THREE.Color(horizonColor) },
      uGlowColor: { value: new THREE.Color(glowColor) },
      uUpperColor: { value: new THREE.Color(upperColor) },
      uZenithColor: { value: new THREE.Color(zenithColor) },
      uSunColor: { value: new THREE.Color(sunColor) }
    };

    this.geometry = new THREE.SphereGeometry(1, 48, 24);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'SkyDome';
    this.mesh.frustumCulled = false; // Drawn around whichever camera is active
    this.mesh.renderOrder = -1000;   // First, so everything else draws over it
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}
