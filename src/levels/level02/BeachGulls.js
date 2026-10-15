import * as THREE from 'three';

// The gulls: a loose flock working the bay off the landing beach — low over the surf line and
// out over the anchorage, where the ship's arrival stirred things up. Ambient life only: no
// physics, no colliders, nothing the mission can touch; they circle and float and are gone with
// the level. Every bird's orbit is derived from its index (no Math.random), so building the
// flock does not shift any seeded AI draw (see tests/README.md).
const GULLS = 8;
const GOLDEN = 0.6180339887498949; // Fractions of the index spread the flock apart evenly
const FLAP = { min: 2.1, max: 2.9 };  // Beats per second
const SPEED = { min: 0.045, max: 0.085 }; // Radians per second round the circle
const RADIUS = { min: 14, max: 26 };
const HEIGHT = { min: 22, max: 38 };
const BOB = { amplitude: 1.1, rate: 0.35 }; // A slow breath of altitude over the water
const WING_SPAN = 0.62;

/**
 * BeachGulls
 * Ambient life over the bay: birds wheeling off the landing beach and the anchorage. Visual
 * only — built once, animated parametrically, and gone with the level.
 */
export class BeachGulls {
  /**
   * @param {THREE.Object3D} parent - Usually gameWorld.environmentGroup
   * @param {BeachEnvironment} environment - For the beach line and the bay
   */
  constructor(parent, environment) {
    this.environment = environment;
    this.group = new THREE.Group();
    this.group.name = 'BeachGulls';

    // Shared across the flock and disposed once
    this.bodyGeometry = new THREE.BoxGeometry(0.16, 0.14, 0.6);
    this.wingGeometryL = gullWing(1);
    this.wingGeometryR = gullWing(-1);
    this.material = new THREE.MeshLambertMaterial({ color: 0xf2f1ec });

    this.birds = [];
    for (let i = 0; i < GULLS; i++) {
      const a = (i * GOLDEN) % 1;
      const b = (i * GOLDEN * GOLDEN) % 1;
      const c = (i * 0.31) % 1;
      // Half the flock low over the surf by the landing, half out over the anchorage
      const near = i % 2 === 0;
      const bay = {
        x: near ? (a - 0.5) * 70 : (a - 0.4) * 150 - 30,
        z: near ? 232 + b * 26 : 285 + b * 55
      };
      this.birds.push({
        angle: a * Math.PI * 2,
        speed: SPEED.min + b * (SPEED.max - SPEED.min),
        radius: RADIUS.min + c * (RADIUS.max - RADIUS.min),
        centre: bay,
        height: HEIGHT.min + b * (HEIGHT.max - HEIGHT.min),
        bobPhase: c * Math.PI * 2,
        flapPhase: b * Math.PI * 2,
        flapRate: FLAP.min + c * (FLAP.max - FLAP.min),
        body: new THREE.Mesh(this.bodyGeometry, this.material),
        wingL: new THREE.Mesh(this.wingGeometryL, this.material),
        wingR: new THREE.Mesh(this.wingGeometryR, this.material),
        node: new THREE.Group(),
        time: 0
      });
      const bird = this.birds[this.birds.length - 1];
      bird.wingL.position.set(0.1, 0, -0.05);
      bird.wingR.position.set(-0.1, 0, -0.05);
      bird.node.add(bird.body, bird.wingL, bird.wingR);
      bird.node.castShadow = false;
      this.group.add(bird.node);
    }

    parent.add(this.group);
    this._point = new THREE.Vector3();
    this.update(0); // Place every bird on its circle before the first frame draws
  }

  /**
   * Circles every bird, flaps its wings. Call once per frame.
   * @param {number} delta
   */
  update(delta) {
    for (const bird of this.birds) {
      bird.time += delta;
      bird.angle += bird.speed * delta;

      const c = bird.centre;
      const x = c.x + Math.cos(bird.angle) * bird.radius;
      const z = c.z + Math.sin(bird.angle) * bird.radius;
      const y = bird.height + Math.sin(bird.bobPhase + bird.time * BOB.rate) * BOB.amplitude;

      // Point the bird down its own tangent, then bank it into the turn
      const ax = c.x + Math.cos(bird.angle + 0.08) * bird.radius;
      const az = c.z + Math.sin(bird.angle + 0.08) * bird.radius;
      bird.node.position.set(x, y, z);
      this._point.set(ax, y, az);
      bird.node.lookAt(this._point);
      bird.node.rotateZ(0.28); // A steady lean into the circle

      const flap = Math.sin(bird.flapPhase + bird.time * bird.flapRate * Math.PI * 2) * 0.55;
      bird.wingL.rotation.z = flap;
      bird.wingR.rotation.z = -flap;
    }
  }

  /**
   * The flock's own frame: one node per bird, each within this group.
   * @returns {THREE.Group}
   */
  get mesh() {
    return this.group;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.bodyGeometry.dispose();
    this.wingGeometryL.dispose();
    this.wingGeometryR.dispose();
    this.material.dispose();
    this.birds = [];
    this.group = null;
  }
}

/** One gull wing: a triangle reaching out along ±X, flat until it flaps. */
function gullWing(side) {
  const geometry = new THREE.BufferGeometry();
  const span = WING_SPAN * side;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0.24,      // Shoulder, forward
    0, 0, -0.16,     // Shoulder, aft
    span, 0, -0.02   // Tip, trailing a touch
  ], 3));
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  return geometry;
}
