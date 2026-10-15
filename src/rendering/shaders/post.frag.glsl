// Post composite - scene plus bloom, filmic tone mapping, grade, vignette.
// The tone mapping replicates three.js' ACESFilmicToneMapping exactly (same matrices, same
// exposure curve), so the image stays continuous with what the renderer produced before.
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uSaturation;
uniform float uContrast;
uniform float uVignette;

varying vec2 vUv;

vec3 rrtAndOdtFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

void main() {
  vec3 color = texture2D(tScene, vUv).rgb;
  color += texture2D(tBloom, vUv).rgb * uBloomStrength;

  color *= uExposure / 0.6;
  color = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777)
  ) * color;
  color = rrtAndOdtFit(color);
  color = mat3(
    vec3(1.60475, -0.10208, -0.00327),
    vec3(-0.53108, 1.10813, -0.07276),
    vec3(-0.07367, -0.00605, 1.07602)
  ) * color;
  color = clamp(color, 0.0, 1.0);

  // Grade: a touch more saturation, a touch more contrast
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, uSaturation);
  color = (color - 0.5) * uContrast + 0.5;

  // Vignette: soft falloff towards the corners (edge0 > edge1 is undefined, so written out)
  float d = length(vUv - 0.5) * 1.41421356;
  float t = clamp((0.95 - d) / 0.45, 0.0, 1.0);
  float vig = t * t * (3.0 - 2.0 * t);
  color *= mix(1.0, vig, uVignette);

  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
  #include <colorspace_fragment>
}
