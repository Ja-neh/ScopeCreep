// Bloom blur - one separable Gaussian pass (run twice: horizontal, then vertical).
uniform sampler2D tSource;
uniform vec2 uTexelSize;
uniform vec2 uDirection;

varying vec2 vUv;

void main() {
  vec2 offset = uTexelSize * uDirection;
  vec3 sum = texture2D(tSource, vUv).rgb * 0.2270270270;
  sum += texture2D(tSource, vUv + offset * 1.3846153846).rgb * 0.3162162162;
  sum += texture2D(tSource, vUv - offset * 1.3846153846).rgb * 0.3162162162;
  sum += texture2D(tSource, vUv + offset * 3.2307692308).rgb * 0.0702702703;
  sum += texture2D(tSource, vUv - offset * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(sum, 1.0);
}
