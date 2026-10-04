// Sky dome: a unit sphere drawn around the camera at infinite distance.
// Only the camera's rotation is applied, and depth is pushed to the far plane,
// so the sky never moves with the camera and sits behind everything.
varying vec3 vDirection;

void main() {
  vDirection = position;
  vec4 clip = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = vec4(clip.xy, clip.w * 0.99999, clip.w);
}
