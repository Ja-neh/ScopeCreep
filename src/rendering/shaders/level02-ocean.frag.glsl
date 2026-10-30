// Ocean Fragment Shader - Water Surface Lighting & Foam
uniform float uTime;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uFoamColor;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform float uFoamThreshold;
uniform sampler2D uCloudShadowMap;
uniform vec2 uCloudShadowScale;
uniform vec2 uCloudShadowOffset;
uniform float uCloudShadowStrength;
uniform sampler2D tDiffuse;
uniform mat4 textureMatrix;
uniform vec3 fogColor;
uniform float fogDensity;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vWaveHeight;
varying vec3 vViewPosition;
varying vec4 vReflectionCoord;
varying float vShoreDamp;
varying float vShoreDistance;

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

// Short-period wind ripples add the dense, broken highlights seen on open water.
float windRipple(vec2 p, float t) {
  float a = sin(dot(p, normalize(vec2(1.0, 0.34))) * 0.72 + t * 1.25);
  float b = sin(dot(p, normalize(vec2(-0.28, 1.0))) * 1.18 - t * 1.65);
  float c = sin(dot(p, normalize(vec2(0.76, -0.65))) * 2.05 + t * 2.1);
  float broken = layeredNoise(p * 0.34 + vec2(t * 0.09, -t * 0.07));
  return a * 0.10 + b * 0.055 + c * 0.022 + (broken - 0.5) * 0.06;
}

void main() {
  // Clip only the inland side; retain moving water and foam through the shallow swash zone.
  if (vShoreDistance > 0.75) discard;
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);

  // Approximate a fine animated normal map in shader code, without external textures.
  vec2 rippleStep = vec2(0.32, 0.0);
  float rippleDx = windRipple(vWorldPosition.xz + rippleStep.xy, uTime)
    - windRipple(vWorldPosition.xz - rippleStep.xy, uTime);
  float rippleDz = windRipple(vWorldPosition.xz + rippleStep.yx, uTime)
    - windRipple(vWorldPosition.xz - rippleStep.yx, uTime);
  vec2 microSlope = vec2(rippleDx, rippleDz) / (2.0 * rippleStep.x);
  normal = normalize(normal + vec3(-microSlope.x * 1.8, 0.0, -microSlope.y * 1.8));

  // 1. Schlick Fresnel: the water reflects more of the world at grazing angles.
  float cosTheta = clamp(dot(viewDir, normal), 0.0, 1.0);
  float fresnel = 0.02 + (1.0 - 0.02) * pow(1.0 - cosTheta, 5.0);
  float horizonFactor = pow(1.0 - cosTheta, 1.5);

  // 2. Dark, cool water with moving color variation below the reflected scene.
  float heightFactor = smoothstep(-1.8, 1.8, vWaveHeight);
  vec3 waterColor = mix(uDeepColor, uShallowColor, heightFactor);
  float surfaceVariation = layeredNoise(vWorldPosition.xz * 0.035 + uTime * vec2(0.012, -0.008));
  float rippledShade = windRipple(vWorldPosition.xz, uTime);
  waterColor *= 0.82 + surfaceVariation * 0.16 + rippledShade * 0.3;

  // 3. Sample the real scene reflection and gently warp it with the moving surface normal.
  vec2 reflectionUv = vReflectionCoord.xy / max(vReflectionCoord.w, 0.0001);
  vec2 reflectionDistortion = normal.xz * 0.026;
  reflectionDistortion += vec2(
    layeredNoise(vWorldPosition.xz * 0.11 + uTime * 0.035),
    layeredNoise(vWorldPosition.zx * 0.09 - uTime * 0.028)
  ) * 0.003 - 0.0015;
  reflectionUv = clamp(reflectionUv + reflectionDistortion, vec2(0.002), vec2(0.998));
  vec3 reflectedScene = texture2D(tDiffuse, reflectionUv).rgb;
  vec3 reflectedSky = mix(reflectedScene, uSkyColor, horizonFactor * 0.22);

  // 3. Bright, tight sun sparkle plus a wider sheen on the wave facets.
  vec3 halfDir = normalize(uSunDirection + viewDir);
  float specAngle = max(dot(halfDir, normal), 0.0);
  float broadSpecular = pow(specAngle, 34.0) * 0.42;
  float sharpSpecular = pow(specAngle, 190.0) * 1.65;
  float sunVisibility = smoothstep(-0.15, 0.25, dot(normal, uSunDirection));
  float facetGlint = smoothstep(0.48, 0.82, layeredNoise(vWorldPosition.xz * 0.52 + uTime * vec2(0.13, -0.11)));
  float specular = (broadSpecular + sharpSpecular * (0.35 + facetGlint * 1.8)) * sunVisibility;

  // 4. Dynamic procedural wave crest foam and ship wake
  float crestHeight = max(0.0, vWaveHeight - uFoamThreshold);
  vec2 animatedUV = vWorldPosition.xz * 0.14 + uTime * vec2(0.08, 0.05);
  float foamNoise = layeredNoise(animatedUV);
  float crestFoam = smoothstep(0.0, 0.65, crestHeight) * smoothstep(0.38, 0.72, foamNoise);
  float shoreBand = 1.0 - smoothstep(-9.0, 0.5, vShoreDistance);
  float shoreBreak = smoothstep(0.38, 0.72, layeredNoise(vWorldPosition.xz * 0.22 + uTime * vec2(0.11, -0.08)));
  float shoreFoam = shoreBand * shoreBreak * (0.35 + 0.35 * sin(uTime * 2.2 + vWorldPosition.x * 0.17));

  // The wake is strongest near the playable ship's origin and breaks up over time.
  float distToHull = length(vWorldPosition.xz * vec2(1.5, 0.4));
  vec2 wakeUV = vWorldPosition.xz * 0.5 - vec2(0.0, uTime * 0.5);
  float wakeFalloff = 1.0 - smoothstep(0.0, 18.0, distToHull);
  float wakeFoam = wakeFalloff * smoothstep(0.28, 0.72, layeredNoise(wakeUV));

  float totalFoam = clamp(crestFoam * 0.85 + wakeFoam * 0.72 + shoreFoam, 0.0, 1.0);
  waterColor = mix(waterColor, uFoamColor, totalFoam);

  // 5. Combine water body, sky reflection, and sun response
  float reflectionStrength = max(fresnel, 0.07 + horizonFactor * 0.19);
  vec3 finalColor = mix(waterColor, reflectedSky, reflectionStrength);
  finalColor += mix(uSunColor, vec3(0.86, 0.91, 0.88), 0.42) * specular;

  // 6. Cloud shade drifting over the sea (neutral until a CloudShadows shares its uniforms)
  float cloudShade = texture2D(uCloudShadowMap, vWorldPosition.xz * uCloudShadowScale + uCloudShadowOffset).r;
  finalColor *= 1.0 - uCloudShadowStrength * cloudShade;

  // 7. Distance Fog blending (for smooth horizon transition)
  #ifdef USE_FOG
    float depth = length(vViewPosition);
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * depth * depth);
    finalColor = mix(finalColor, fogColor, clamp(fogFactor, 0.0, 1.0));
  #endif

  gl_FragColor = vec4(finalColor, 0.96);

  // 8. Output encoding (a no-op when the frame renders into the post stack's target)
  #include <colorspace_fragment>
}
