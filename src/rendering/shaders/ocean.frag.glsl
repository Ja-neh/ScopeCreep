// Ocean Fragment Shader - Water Surface Lighting & Foam
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

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);

  // 1. Fresnel Effect (Soft sky reflection at grazing angles)
  float cosTheta = clamp(dot(viewDir, normal), 0.0, 1.0);
  float fresnel = 0.04 + (1.0 - 0.04) * pow(1.0 - cosTheta, 3.0);

  // 2. Base Water Color Gradient (Smooth transition between deep & shallow water)
  float heightFactor = smoothstep(-1.2, 2.0, vWaveHeight);
  vec3 waterColor = mix(uDeepColor, uShallowColor, heightFactor);

  // 3. Tamed Sun Specular Highlight (Eliminates harsh blinding glare)
  vec3 halfDir = normalize(uSunDirection + viewDir);
  float specAngle = max(dot(halfDir, normal), 0.0);
  float specular = pow(specAngle, 40.0) * 0.30;

  // 4. Subtle Wave Crest Foam (Soft accents, no blinding white patches)
  float foamFactor = smoothstep(uFoamThreshold, uFoamThreshold + 0.6, vWaveHeight);
  waterColor = mix(waterColor, uFoamColor, foamFactor * 0.40);

  // 5. Combine Water Body & Soft Sky Sheen
  vec3 finalColor = mix(waterColor, uSkyColor, fresnel * 0.30);
  finalColor += uSunColor * specular;

  // 6. Distance Fog blending (for smooth horizon transition)
  #ifdef USE_FOG
    float depth = length(vViewPosition);
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * depth * depth);
    finalColor = mix(finalColor, fogColor, clamp(fogFactor, 0.0, 1.0));
  #endif

  gl_FragColor = vec4(finalColor, 0.96);
}
