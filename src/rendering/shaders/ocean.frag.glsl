// Ocean Fragment Shader - Water Surface Lighting & Foam
uniform float uTime;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uFoamColor;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform float uFoamThreshold;
uniform vec3 fogColor;
uniform float fogDensity;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vWaveHeight;
varying vec3 vViewPosition;

// Procedural 2D Noise for organic foam texturing
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float layeredNoise(vec2 p) {
  return noise(p) * 0.55
    + noise(p * 2.1 + 17.0) * 0.30
    + noise(p * 4.3 - 9.0) * 0.15;
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);

  // 1. View-dependent reflection and soft sky scattering
  float cosTheta = clamp(dot(viewDir, normal), 0.0, 1.0);
  float fresnel = 0.02 + (1.0 - 0.02) * pow(1.0 - cosTheta, 5.0);
  float horizonFactor = pow(1.0 - cosTheta, 1.5);

  // 2. Base water color with subtle animated subsurface variation
  float heightFactor = smoothstep(-1.2, 2.0, vWaveHeight);
  vec3 waterColor = mix(uDeepColor, uShallowColor, heightFactor);
  float surfaceVariation = layeredNoise(vWorldPosition.xz * 0.035 + uTime * vec2(0.012, -0.008));
  waterColor *= 0.90 + surfaceVariation * 0.16;

  // 3. Broad sun reflection with a smaller sharp highlight on wave facets
  vec3 halfDir = normalize(uSunDirection + viewDir);
  float specAngle = max(dot(halfDir, normal), 0.0);
  float broadSpecular = pow(specAngle, 18.0) * 0.16;
  float sharpSpecular = pow(specAngle, 110.0) * 0.42;
  float sunVisibility = smoothstep(-0.15, 0.25, dot(normal, uSunDirection));
  float specular = (broadSpecular + sharpSpecular) * sunVisibility;

  // 4. Dynamic procedural wave crest foam and ship wake
  float crestHeight = max(0.0, vWaveHeight - uFoamThreshold);
  vec2 animatedUV = vWorldPosition.xz * 0.14 + uTime * vec2(0.08, 0.05);
  float foamNoise = layeredNoise(animatedUV);
  float crestFoam = smoothstep(0.0, 0.65, crestHeight) * smoothstep(0.38, 0.72, foamNoise);

  // The wake is strongest near the playable ship's origin and breaks up over time.
  float distToHull = length(vWorldPosition.xz * vec2(1.5, 0.4));
  vec2 wakeUV = vWorldPosition.xz * 0.5 - vec2(0.0, uTime * 0.5);
  float wakeFalloff = 1.0 - smoothstep(0.0, 18.0, distToHull);
  float wakeFoam = wakeFalloff * smoothstep(0.28, 0.72, layeredNoise(wakeUV));

  float totalFoam = clamp(crestFoam * 0.85 + wakeFoam * 0.72, 0.0, 1.0);
  waterColor = mix(waterColor, uFoamColor, totalFoam);

  // 5. Combine water body, sky reflection, and sun response
  vec3 reflectedSky = mix(uSkyColor, uFoamColor, horizonFactor * 0.18);
  vec3 finalColor = mix(waterColor, reflectedSky, fresnel * 0.72);
  finalColor += uSunColor * specular;

  // 6. Distance Fog blending (for smooth horizon transition)
  #ifdef USE_FOG
    float depth = length(vViewPosition);
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * depth * depth);
    finalColor = mix(finalColor, fogColor, clamp(fogFactor, 0.0, 1.0));
  #endif

  gl_FragColor = vec4(finalColor, 0.96);
}