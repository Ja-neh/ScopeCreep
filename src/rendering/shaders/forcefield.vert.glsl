// Force-field dome: a unit hemisphere scaled to the dome's size. Passes the surface normal, the
// direction to the camera and the point on the unit hemisphere to the fragment shader.
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vLocal;

void main() {
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
