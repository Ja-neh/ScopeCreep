// Bloom bright pass - keeps the pixels brighter than the threshold, with a soft knee.
uniform sampler2D tSource;
uniform float uThreshold;
uniform float uKnee;

varying vec2 vUv;

void main() {
  vec3 color = texture2D(tSource, vUv).rgb;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float weight = smoothstep(uThreshold, uThreshold + uKnee, luma);
  gl_FragColor = vec4(color * weight, 1.0);
}
