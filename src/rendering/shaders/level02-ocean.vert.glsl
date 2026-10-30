// Ocean Vertex Shader - Gerstner Wave GPU Displacement
uniform float uTime;
uniform vec4 uWaveA; // [dirX, dirZ, steepness, wavelength]
uniform vec4 uWaveB;
uniform vec4 uWaveC;
uniform vec4 uWaveD;
uniform mat4 textureMatrix;
attribute float aShoreDamp;
attribute float aShoreDistance;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vWaveHeight;
varying vec3 vViewPosition;
varying vec4 vReflectionCoord;
varying float vShoreDamp;
varying float vShoreDistance;

// Function to calculate a single Gerstner wave component
vec3 gerstnerWave(
  vec4 wave,
  vec3 p,
  inout vec3 tangent,
  inout vec3 binormal,
  float shoreDamp
) {
  float steepness = wave.z;
  float wavelength = wave.w;
  float k = 2.0 * 3.14159265 / wavelength;
  float c = sqrt(9.8 / k);
  // Local Y points toward world -Z because the reflective plane faces upward.
  vec2 d = normalize(vec2(wave.x, -wave.y));
  float f = k * (dot(d, p.xy) - c * uTime);
  float a = steepness / k;

  tangent += vec3(
    -d.x * d.x * (steepness * sin(f)) * shoreDamp,
    -d.x * d.y * (steepness * sin(f)) * shoreDamp,
    d.x * (steepness * cos(f)) * shoreDamp
  );

  binormal += vec3(
    -d.x * d.y * (steepness * sin(f)) * shoreDamp,
    -d.y * d.y * (steepness * sin(f)) * shoreDamp,
    d.y * (steepness * cos(f)) * shoreDamp
  );

  return vec3(
    d.x * (a * cos(f)) * shoreDamp,
    d.y * (a * cos(f)) * shoreDamp,
    a * sin(f) * shoreDamp
  );
}

void main() {
  // PlaneGeometry is XY; the mesh rotation maps its Y axis to world Z and local Z to world up.
  vec3 gridPoint = vec3(position.xy, 0.0);
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 1.0, 0.0);
  vec3 displacedPoint = gridPoint;
  vShoreDamp = aShoreDamp;
  vShoreDistance = aShoreDistance;

  // Combine 4 wave octaves with different directions and frequencies
  displacedPoint += gerstnerWave(uWaveA, gridPoint, tangent, binormal, aShoreDamp);
  displacedPoint += gerstnerWave(uWaveB, gridPoint, tangent, binormal, aShoreDamp);
  displacedPoint += gerstnerWave(uWaveC, gridPoint, tangent, binormal, aShoreDamp);
  displacedPoint += gerstnerWave(uWaveD, gridPoint, tangent, binormal, aShoreDamp);

  // Analytical normal calculation from tangent & binormal cross-product
  vec3 calculatedNormal = normalize(cross(tangent, binormal));

  // Compute world and view space vectors
  vec4 worldPos = modelMatrix * vec4(displacedPoint, 1.0);
  vWorldPosition = worldPos.xyz;
  vNormal = normalize(mat3(modelMatrix) * calculatedNormal);
  vWaveHeight = displacedPoint.z;
  vReflectionCoord = textureMatrix * vec4(displacedPoint, 1.0);

  vec4 mvPosition = viewMatrix * worldPos;
  vViewPosition = -mvPosition.xyz;

  gl_Position = projectionMatrix * mvPosition;
}
