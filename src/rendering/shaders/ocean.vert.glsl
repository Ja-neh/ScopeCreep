// Ocean Vertex Shader - Gerstner Wave GPU Displacement
uniform float uTime;
uniform vec4 uWaveA; // [dirX, dirZ, steepness, wavelength]
uniform vec4 uWaveB;
uniform vec4 uWaveC;
uniform vec4 uWaveD;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vWaveHeight;
varying vec3 vViewPosition;

// Function to calculate a single Gerstner wave component
vec3 gerstnerWave(
  vec4 wave,
  vec3 p,
  inout vec3 tangent,
  inout vec3 binormal
) {
  float steepness = wave.z;
  float wavelength = wave.w;
  float k = 2.0 * 3.14159265 / wavelength;
  float c = sqrt(9.8 / k);
  vec2 d = normalize(wave.xy);
  float f = k * (dot(d, p.xz) - c * uTime);
  float a = steepness / k;

  tangent += vec3(
    -d.x * d.x * (steepness * sin(f)),
    d.x * (steepness * cos(f)),
    -d.x * d.y * (steepness * sin(f))
  );

  binormal += vec3(
    -d.x * d.y * (steepness * sin(f)),
    d.y * (steepness * cos(f)),
    -d.y * d.y * (steepness * sin(f))
  );

  return vec3(
    d.x * (a * cos(f)),
    a * sin(f),
    d.y * (a * cos(f))
  );
}

void main() {
  vec3 gridPoint = position;
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  vec3 displacedPoint = gridPoint;

  // Combine 4 wave octaves with different directions and frequencies
  displacedPoint += gerstnerWave(uWaveA, gridPoint, tangent, binormal);
  displacedPoint += gerstnerWave(uWaveB, gridPoint, tangent, binormal);
  displacedPoint += gerstnerWave(uWaveC, gridPoint, tangent, binormal);
  displacedPoint += gerstnerWave(uWaveD, gridPoint, tangent, binormal);

  // Analytical normal calculation from tangent & binormal cross-product
  vec3 calculatedNormal = normalize(cross(binormal, tangent));

  // Compute world and view space vectors
  vec4 worldPos = modelMatrix * vec4(displacedPoint, 1.0);
  vWorldPosition = worldPos.xyz;
  vNormal = normalize(mat3(modelMatrix) * calculatedNormal);
  vWaveHeight = displacedPoint.y;

  vec4 mvPosition = viewMatrix * worldPos;
  vViewPosition = -mvPosition.xyz;

  gl_Position = projectionMatrix * mvPosition;
}
