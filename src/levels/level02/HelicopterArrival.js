import * as THREE from 'three';
import { RotorWash } from './RotorWash.js';

// Flight plan, relative to the landing spot (meters, seconds). The helicopters cruise in from
// out at sea high enough to clear the anchored ship (35 m at its tallest, 34-55 m behind the
// spots), and only drop into their steep descent once past it.
const START_BEHIND = 260;           // Start this far out to sea behind the spot
const START_SIDE = 40;              // ...and off to one side, so the two don't fly in line
const CRUISE_ALTITUDE = 52;
const DESCENT_START_BEHIND = 30;    // Past the ship: start the descent here...
const DESCENT_START_ALTITUDE = 48;  // ...from this height
const HOVER_HEIGHT = 7;             // Above the sand at the end of the approach
const APPROACH_SECONDS = 11;
const DESCEND_SECONDS = 3.5;
const CRUISE_PITCH = -0.2;          // Nose down at speed
const FLARE_PITCH = 0.18;           // Nose up while braking into the hover
const FLIGHT_ROTOR_SPEED = 32;      // rad/s
const IDLE_ROTOR_SPEED = 3;
const SPOOL_DOWN_SECONDS = 5;
const WASH_HEIGHT = 20;             // Rotor wash kicks up the surface below this height

/**
 * HelicopterArrival
 * Flies a HelicopterModel in from the sea and sets it down on its landing spot: a curved
 * approach over the ship slowing into a hover, a vertical descent turning to the parking
 * heading, then touchdown and the rotor spooling down to idle. Kicks up sand or spray when
 * low. Purely visual (the parked helicopter's cover collider is the level's business).
 */
export class HelicopterArrival {
  /**
   * @param {Object} options
   * @param {HelicopterModel} options.model
   * @param {{x: number, z: number, heading: number, groundY: number}} options.landing
   * @param {(x: number, z: number) => number} options.groundHeightAt - Terrain height (below 0 is sea)
   * @param {THREE.Object3D} options.effectsParent
   * @param {number} [options.delay=0] - Seconds before it appears on the approach
   * @param {number} [options.side=1] - Which side it starts from (+1 east, -1 west)
   * @param {Function} [options.onTouchdown]
   */
  constructor({ model, landing, groundHeightAt, effectsParent, delay = 0, side = 1, onTouchdown = null }) {
    this.model = model;
    this.landing = landing;
    this.groundHeightAt = groundHeightAt;
    this.onTouchdown = onTouchdown;

    this.state = 'waiting'; // waiting -> approach -> descend -> landed
    this.timer = -delay;
    this.landedTime = 0;

    // Cruise leg over the sea and the ship, then the descent leg down to the hover
    const { x, z, groundY } = landing;
    const descentStart = new THREE.Vector3(x, DESCENT_START_ALTITUDE, z + DESCENT_START_BEHIND);
    this.path = new THREE.CurvePath();
    this.path.add(new THREE.CubicBezierCurve3(
      new THREE.Vector3(x + side * START_SIDE, CRUISE_ALTITUDE, z + START_BEHIND),
      new THREE.Vector3(x + side * START_SIDE * 0.3, CRUISE_ALTITUDE, z + START_BEHIND * 0.55),
      new THREE.Vector3(x, CRUISE_ALTITUDE, z + DESCENT_START_BEHIND * 2.4),
      descentStart
    ));
    this.path.add(new THREE.CubicBezierCurve3(
      descentStart,
      new THREE.Vector3(x, DESCENT_START_ALTITUDE - 6, z + DESCENT_START_BEHIND * 0.5),
      new THREE.Vector3(x, groundY + HOVER_HEIGHT + 6, z + 3),
      new THREE.Vector3(x, groundY + HOVER_HEIGHT, z)
    ));

    this.wash = new RotorWash(effectsParent);
    this._point = new THREE.Vector3();
    this._tangent = new THREE.Vector3();
    this._approachYaw = 0;

    model.mesh.rotation.order = 'YXZ'; // Heading, then pitch
    model.rotorSpeed = FLIGHT_ROTOR_SPEED;
    this._place(this.path.getPoint(0, this._point), 0, 0);
  }

  get isLanded() {
    return this.state === 'landed';
  }

  /**
   * Advances the flight. Call once per frame in Phase 5.
   */
  update(delta) {
    this.timer += delta;
    let washStrength = 0;
    const mesh = this.model.mesh;

    switch (this.state) {
      case 'waiting':
        if (this.timer >= 0) this.state = 'approach';
        break;

      case 'approach': {
        const u = Math.min(1, this.timer / APPROACH_SECONDS);
        const s = u * (2 - u); // Ease out: arrive at the hover with no speed
        this.path.getPoint(s, this._point);
        this.path.getTangent(s, this._tangent);
        this._approachYaw = Math.atan2(-this._tangent.x, -this._tangent.z);
        const flare = Math.sin(Math.PI * THREE.MathUtils.clamp((u - 0.65) / 0.35, 0, 1));
        this._place(this._point, this._approachYaw, CRUISE_PITCH * (1 - u) + FLARE_PITCH * flare);
        washStrength = this._washStrength();
        if (u >= 1) {
          this.state = 'descend';
          this.timer = 0;
        }
        break;
      }

      case 'descend': {
        const u = Math.min(1, this.timer / DESCEND_SECONDS);
        const eased = u * u * (3 - 2 * u);
        const { x, z, groundY, heading } = this.landing;
        const sway = Math.sin(this.timer * 1.7) * 0.2 * (1 - u);
        const yawDiff = Math.atan2(Math.sin(heading - this._approachYaw), Math.cos(heading - this._approachYaw));
        this._point.set(x + sway, groundY + HOVER_HEIGHT * (1 - eased), z);
        this._place(this._point, this._approachYaw + yawDiff * eased, 0);
        washStrength = this._washStrength();
        if (u >= 1) this._touchdown();
        break;
      }

      case 'landed': {
        this.landedTime += delta;
        const spool = Math.min(1, this.landedTime / SPOOL_DOWN_SECONDS);
        this.model.rotorSpeed = THREE.MathUtils.lerp(FLIGHT_ROTOR_SPEED, IDLE_ROTOR_SPEED, spool);
        washStrength = 1 - spool;
        break;
      }
    }

    const ground = this.groundHeightAt(mesh.position.x, mesh.position.z);
    this.wash.update(delta, mesh.position.x, Math.max(0, ground), mesh.position.z, ground < 0, washStrength);
  }

  /** 0..1: stronger the closer the rotor is to the sand or sea below. */
  _washStrength() {
    const mesh = this.model.mesh;
    const surface = Math.max(0, this.groundHeightAt(mesh.position.x, mesh.position.z));
    const height = mesh.position.y - surface;
    return THREE.MathUtils.clamp(1 - height / WASH_HEIGHT, 0, 1);
  }

  _place(position, yaw, pitch) {
    const mesh = this.model.mesh;
    mesh.position.copy(position);
    mesh.rotation.set(pitch, yaw, 0);
    mesh.updateMatrixWorld(true);
  }

  _touchdown() {
    const { x, z, groundY, heading } = this.landing;
    this._point.set(x, groundY, z);
    this._place(this._point, heading, 0);
    this.state = 'landed';
    this.landedTime = 0;
    if (this.onTouchdown) this.onTouchdown();
  }

  /**
   * Lands it at once (e.g. the opening was skipped by a test or a dev).
   */
  finishNow() {
    if (this.state !== 'landed') this._touchdown();
  }

  dispose() {
    this.wash.dispose();
  }
}
