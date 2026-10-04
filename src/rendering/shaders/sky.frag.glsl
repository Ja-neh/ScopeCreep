// Sunset sky: haze at the horizon (the fog colour, so distant land and sea melt into it),
// a warm glow low down towards the sun, mauve higher up and dusky blue overhead,
// plus the sun's halo and disc.
uniform vec3 uSunDirection;
uniform vec3 uHorizonColor;
uniform vec3 uGlowColor;
uniform vec3 uUpperColor;
uniform vec3 uZenithColor;
uniform vec3 uSunColor;

varying vec3 vDirection;

void main() {
  vec3 dir = normalize(vDirection);
  float elevation = max(dir.y, 0.0);

  // Height gradient
  vec3 sky = mix(uHorizonColor, uUpperColor, smoothstep(0.02, 0.32, elevation));
  sky = mix(sky, uZenithColor, smoothstep(0.3, 0.95, elevation));

  // Sunset glow: low in the sky on the sun's side, fading out right at the horizon haze
  vec2 flatDir = normalize(dir.xz + vec2(1e-5));
  float sunSide = max(dot(flatDir, normalize(uSunDirection.xz)), 0.0);
  float glow = pow(sunSide, 3.0) * (1.0 - smoothstep(0.0, 0.4, elevation)) * smoothstep(0.0, 0.05, elevation);
  sky = mix(sky, uGlowColor, glow * 0.8);

  // Halo and disc
  float sunDot = max(dot(dir, uSunDirection), 0.0);
  sky += uSunColor * (pow(sunDot, 18.0) * 0.3 + pow(sunDot, 300.0) * 0.5);
  sky = mix(sky, uSunColor, smoothstep(0.99955, 0.99975, sunDot));

  // Below the horizon only the haze shows (the sea covers it anyway)
  sky = mix(uHorizonColor, sky, smoothstep(-0.02, 0.0, dir.y));

  gl_FragColor = vec4(sky, 1.0);
  #include <colorspace_fragment>
}
