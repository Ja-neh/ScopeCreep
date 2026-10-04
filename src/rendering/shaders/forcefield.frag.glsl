// Force-field dome: a lattice of hexagons that glows brightest at the edges seen side-on
// (fresnel), with bands of energy rolling up it. uOpacity fades it out; uFlicker makes it
// stutter (while it collapses). Drawn additively, so alpha scales how much light it adds.
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
uniform float uFlicker;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vLocal;

// 0 inside a hexagon, 1 on its edge
float hexEdge(vec2 p) {
  const vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  float d = max(dot(abs(g), normalize(r)), abs(g.x)); // 0 at the centre, 0.5 at the edge
  return smoothstep(0.42, 0.5, d);
}

void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vViewDir)));
  float rim = pow(1.0 - facing, 2.5);

  // Hexagons wrapped round the dome: around it (angle) and up it (height)
  vec2 p = vec2(atan(vLocal.z, vLocal.x) * 9.0, vLocal.y * 14.0);
  float lattice = hexEdge(p);
  float band = pow(0.5 + 0.5 * sin(vLocal.y * 12.0 - uTime * 2.2), 8.0);

  float alpha = 0.05 + rim * 0.75 + lattice * 0.22 + band * 0.12;
  float stutter = step(0.5, fract(sin(floor(uTime * 24.0) * 91.7) * 43758.5));
  alpha *= uOpacity * (1.0 - uFlicker * stutter);

  gl_FragColor = vec4(uColor * (0.6 + rim + lattice * 0.6), alpha);
  #include <colorspace_fragment>
}
