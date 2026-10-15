import * as THREE from 'three';
import postVert from './shaders/post.vert.glsl';
import postBrightFrag from './shaders/postBright.frag.glsl';
import postBlurFrag from './shaders/postBlur.frag.glsl';
import postFrag from './shaders/post.frag.glsl';

// Image tuning. Rendering owns its look, so all of it lives here (never config.json).
const BLOOM_THRESHOLD = 0.85;   // Luma above which a pixel blooms
const BLOOM_KNEE = 0.40;        // Soft width of that cutoff
const BLOOM_STRENGTH = 0.30;    // Bloom added back over the scene
const BLOOM_RADIUS = 1.4;       // Blur spread, in bloom texels
const BLOOM_SCALE = 4;          // Bloom runs at a quarter of the drawing buffer
const MSAA_SAMPLES = 4;         // Scene render target samples
const SATURATION = 1.06;
const CONTRAST = 1.03;
const VIGNETTE = 0.25;

const _size = new THREE.Vector2();

/**
 * PostStack
 * The frame's image pipeline: scene into an HDR render target, bloom passes at quarter
 * resolution, then a composite pass (bloom, ACES tone mapping, grade, vignette, sRGB)
 * onto the canvas.
 * Rendering into a target makes three skip tone mapping and output encoding, so the
 * target holds raw linear light and this stack owns the whole tail of the pipeline.
 */
export class PostStack {
  constructor(renderer) {
    this._renderer = renderer;
    this._width = 0;
    this._height = 0;
    this.bloomEnabled = true;

    const canFloat = renderer.extensions.has('EXT_color_buffer_float');
    this._type = canFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;

    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: this._type,
      samples: MSAA_SAMPLES,
      depthBuffer: true,
      stencilBuffer: false
    });
    this.bloomA = new THREE.WebGLRenderTarget(1, 1, {
      type: this._type,
      depthBuffer: false,
      stencilBuffer: false
    });
    this.bloomB = new THREE.WebGLRenderTarget(1, 1, {
      type: this._type,
      depthBuffer: false,
      stencilBuffer: false
    });

    // One fullscreen triangle serves every pass
    this._quadGeometry = new THREE.BufferGeometry();
    this._quadGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this._quadMesh = new THREE.Mesh(this._quadGeometry, null);
    this._quadMesh.frustumCulled = false;
    this._quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._quadScene = new THREE.Scene();
    this._quadScene.add(this._quadMesh);

    this._brightMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        uThreshold: { value: BLOOM_THRESHOLD },
        uKnee: { value: BLOOM_KNEE }
      },
      vertexShader: postVert,
      fragmentShader: postBrightFrag,
      depthTest: false,
      depthWrite: false
    });

    this._blurMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
        uDirection: { value: new THREE.Vector2(1, 0) }
      },
      vertexShader: postVert,
      fragmentShader: postBlurFrag,
      depthTest: false,
      depthWrite: false
    });

    this._postMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        uBloomStrength: { value: BLOOM_STRENGTH },
        uExposure: { value: renderer.toneMappingExposure },
        uSaturation: { value: SATURATION },
        uContrast: { value: CONTRAST },
        uVignette: { value: VIGNETTE }
      },
      vertexShader: postVert,
      fragmentShader: postFrag,
      depthTest: false,
      depthWrite: false
    });
  }

  /** Turns the bloom composite off (the rest of the stack keeps running). */
  setBloomEnabled(enabled) {
    this.bloomEnabled = !!enabled;
  }

  /**
   * Draws one frame: scene -> HDR target -> bloom -> composite on the canvas.
   * Same entry point as renderer.render(scene, camera).
   */
  render(scene, camera) {
    const size = this._renderer.getDrawingBufferSize(_size);
    if (size.x !== this._width || size.y !== this._height) {
      this._setSize(Math.max(1, size.x), Math.max(1, size.y));
    }

    this._renderer.setRenderTarget(this.sceneTarget);
    this._renderer.render(scene, camera);

    if (this.bloomEnabled) {
      this._brightMaterial.uniforms.tSource.value = this.sceneTarget.texture;
      this._drawPass(this._brightMaterial, this.bloomA);

      this._blurMaterial.uniforms.uTexelSize.value.set(
        BLOOM_RADIUS / this._bloomWidth,
        BLOOM_RADIUS / this._bloomHeight
      );
      this._blurMaterial.uniforms.uDirection.value.set(1, 0);
      this._blurMaterial.uniforms.tSource.value = this.bloomA.texture;
      this._drawPass(this._blurMaterial, this.bloomB);

      this._blurMaterial.uniforms.uDirection.value.set(0, 1);
      this._blurMaterial.uniforms.tSource.value = this.bloomB.texture;
      this._drawPass(this._blurMaterial, this.bloomA);
    }

    const uniforms = this._postMaterial.uniforms;
    uniforms.tScene.value = this.sceneTarget.texture;
    uniforms.tBloom.value = this.bloomA.texture;
    uniforms.uBloomStrength.value = this.bloomEnabled ? BLOOM_STRENGTH : 0;
    uniforms.uExposure.value = this._renderer.toneMappingExposure;
    this._drawPass(this._postMaterial, null);
  }

  _setSize(width, height) {
    this._width = width;
    this._height = height;
    this.sceneTarget.setSize(width, height);
    this._bloomWidth = Math.max(1, Math.floor(width / BLOOM_SCALE));
    this._bloomHeight = Math.max(1, Math.floor(height / BLOOM_SCALE));
    this.bloomA.setSize(this._bloomWidth, this._bloomHeight);
    this.bloomB.setSize(this._bloomWidth, this._bloomHeight);
  }

  _drawPass(material, target) {
    this._quadMesh.material = material;
    this._renderer.setRenderTarget(target);
    this._renderer.render(this._quadScene, this._quadCamera);
  }

  dispose() {
    this.sceneTarget.dispose();
    this.bloomA.dispose();
    this.bloomB.dispose();
    this._quadGeometry.dispose();
    this._brightMaterial.dispose();
    this._blurMaterial.dispose();
    this._postMaterial.dispose();
  }
}
