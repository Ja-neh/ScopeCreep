import * as THREE from 'three';
import { BaseEntity } from '../../entities/BaseEntity.js';

const DURATION_SECONDS = 10;
// The camera flies in from out at sea alongside the arriving helicopters (the setting sun ahead
// and to the left), closes on the ship, passes its bow low on the beach side as they cross over
// it, then comes round to settle behind the player (world positions; the player's view is added last)
const FLIGHT_PATH = [
  new THREE.Vector3(170, 30, 560),
  new THREE.Vector3(85, 32, 300),
  new THREE.Vector3(40, 12, 194)
];
const DEFAULT_FOCUS = new THREE.Vector3(0, 20, 230); // Looked at when there is nothing to follow
// The camera aims this far from what it follows towards the landing beach, so the helicopters
// share the frame with the ship and the island rather than filling it with sky
const LANDING_POINT = new THREE.Vector3(-8, 4, 195);
const AIM_TOWARDS_LANDING = 0.35;
const HANDOVER = [0.6, 0.95]; // Share of the sweep over which the view turns from the helicopters to the player's
const FIELD_OF_VIEW = 50;

/**
 * LandingCinematic
 * Level 2's opening: a 10-second camera sweep that flies in from the sea with the arriving
 * helicopters, past the anchored ship, and ends exactly on the player's own third-person view.
 * Other levels give it their own flight path and aim (Level 3's opening over the village, and its
 * dawn ending, which keeps the view and the player still at the end: endOnPlayer false).
 * The player is frozen meanwhile, the HUD hides behind letterbox bars, and [Space]/[Enter]
 * (skipCutscene) skips it.
 * Add it to the GameWorld and it starts on its first frame (after the first physics step, so
 * the camera's collision rays see the world).
 *
 * - Phase 5 (gameplayUpdate): starts, and reads the skip key
 * - Phase 6 (lateUpdate): positions its camera
 */
export class LandingCinematic extends BaseEntity {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {Player} options.player
   * @param {string} options.title
   * @param {string} [options.subtitle]
   * @param {number} [options.duration] - Seconds
   * @param {(out: THREE.Vector3) => (THREE.Vector3|null)} [options.focus] - What the camera follows
   *   until it turns to the player's view (e.g. the arriving helicopters); null when nothing to follow
   * @param {Function} [options.onFinished] - Called once, when it ends or is skipped
   * @param {THREE.Vector3[]} [options.flightPath] - Where the camera flies (world points)
   * @param {THREE.Vector3} [options.defaultFocus] - Looked at when `focus` gives nothing
   * @param {THREE.Vector3} [options.aimPoint] - The aim leans this way...
   * @param {number} [options.aimTowards] - ...by this share (0: look straight at the focus)
   * @param {boolean} [options.endOnPlayer=true] - End on the player's own view and hand it back;
   *   false: end at the last point of the path, keeping the view and the player still
   * @param {'out'|'inOut'} [options.easing='out'] - 'out': already moving at the start, settling at
   *   the end; 'inOut': also easing away from a still first shot
   * @param {number} [options.holdSeconds=0] - Stay on the first shot this long before moving
   */
  constructor(gameWorld, {
    player, title, subtitle = '', duration = DURATION_SECONDS, focus = null, onFinished = null,
    flightPath = FLIGHT_PATH, defaultFocus = DEFAULT_FOCUS, aimPoint = LANDING_POINT,
    aimTowards = AIM_TOWARDS_LANDING, endOnPlayer = true, easing = 'out', holdSeconds = 0
  }) {
    super('LandingCinematic');
    this.flightPath = flightPath;
    this.defaultFocus = defaultFocus;
    this.aimPoint = aimPoint;
    this.aimTowards = aimTowards;
    this.endOnPlayer = endOnPlayer;
    this.easing = easing;
    this.holdSeconds = holdSeconds;
    this.gameWorld = gameWorld;
    this.player = player;
    this.title = title;
    this.subtitle = subtitle;
    this.duration = duration;
    this.focus = focus;
    this.onFinished = onFinished;

    this.elapsed = 0;
    this.hasStarted = false;
    this.isPlaying = false;
    this.isFinished = false;
    this.wasSkipped = false;

    this.camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, window.innerWidth / window.innerHeight, 0.1, 3000);
    this.camera.name = 'LandingCinematicCamera';
    this.path = null;
    this._lookQuat = new THREE.Quaternion();
    this._focusPoint = new THREE.Vector3();
    this._endQuat = new THREE.Quaternion();
    this._endPosition = new THREE.Vector3();
    this._endFov = FIELD_OF_VIEW;
    this._aim = new THREE.Object3D();
  }

  /**
   * Freezes the player, takes over the view and shows the title card.
   */
  start() {
    if (this.hasStarted) return;
    this.hasStarted = true;
    const gameWorld = this.gameWorld;
    const player = this.player;

    // Where the sweep must end: the player's own view, worked out by their spring arm now
    // (a full second's step, so its smoothing settles at once)
    player.springArm.update(1, player.position, player.yaw, player.pitch, player.collider);
    this._endPosition.copy(gameWorld.camera.position);
    this._endQuat.copy(gameWorld.camera.quaternion);
    this._endFov = gameWorld.camera.fov;

    const points = this.endOnPlayer ? [...this.flightPath, this._endPosition] : this.flightPath;
    this.path = new THREE.CatmullRomCurve3(points, false, 'centripetal');

    player.isDevSuspended = true;
    this.isPlaying = true;
    this.elapsed = 0;
    this._pose(0);
    gameWorld.setActiveCamera(this.camera);
    if (gameWorld.ui) gameWorld.ui.showCinematic(this.title, this.subtitle, '[Space] Skip');
  }

  /** Camera rotation looking from `from` at `target`. */
  _lookRotation(from, target, out) {
    this._aim.position.copy(from);
    this._aim.lookAt(target);
    // Object3D.lookAt points +Z at the target; cameras look down -Z, so turn around
    return out.copy(this._aim.quaternion).multiply(TURN_AROUND);
  }

  /**
   * Phase 5: start on the first frame; skip on request.
   */
  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    if (!this.hasStarted) this.start();
    if (this.isPlaying && gameWorld.input.isActionJustPressed('skipCutscene')) {
      this.wasSkipped = true;
      this.finish();
    }
  }

  /**
   * Phase 6: move the camera along the sweep.
   */
  lateUpdate(delta) {
    if (!this.isPlaying) return;
    this.elapsed += delta;
    const t = Math.min(1, Math.max(0, this.elapsed - this.holdSeconds) / (this.duration - this.holdSeconds));
    this._pose(t);
    if (t >= 1) this.finish();
  }

  _pose(t) {
    // Ease out: already flying with the helicopters at the start, settling gently at the end
    const s = this.easing === 'inOut' ? smooth(t) : 1 - (1 - t) * (1 - t);
    this.path.getPointAt(s, this.camera.position);

    // Follow the helicopters (with the landing beach in shot), then turn to the player's own view
    const focus = (this.focus && this.focus(this._focusPoint)) || this._focusPoint.copy(this.defaultFocus);
    focus.lerp(this.aimPoint, this.aimTowards);
    this._lookRotation(this.camera.position, focus, this._lookQuat);
    const handover = this.endOnPlayer ? smooth(THREE.MathUtils.clamp((t - HANDOVER[0]) / (HANDOVER[1] - HANDOVER[0]), 0, 1)) : 0;
    this.camera.quaternion.slerpQuaternions(this._lookQuat, this._endQuat, handover);
    this.camera.fov = THREE.MathUtils.lerp(FIELD_OF_VIEW, this._endFov, handover);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Hands the view and controls back to the player (once).
   */
  finish() {
    if (this.isFinished) return;
    this.hasStarted = true;
    this.isFinished = true;
    this.isPlaying = false;

    const gameWorld = this.gameWorld;
    if (this.endOnPlayer || this._released) {
      this.player.isDevSuspended = false;
      if (gameWorld.activeCamera === this.camera) gameWorld.setActiveCamera(null);
    }
    if (gameWorld.ui) gameWorld.ui.hideCinematic();
    if (this.onFinished) this.onFinished(this.wasSkipped);
  }

  /** Gives the view and the controls back (an ending that held them, once it is over). */
  release() {
    this._released = true;
    if (this.gameWorld.activeCamera === this.camera) this.gameWorld.setActiveCamera(null);
  }

  dispose() {
    if (this.isPlaying) {
      this.onFinished = null; // Torn down mid-sweep (level unloaded): restore the view only
      this._released = true;
      this.finish();
    }
    if (this.camera && this.gameWorld.activeCamera === this.camera) this.gameWorld.setActiveCamera(null);
    this.camera = null;
    super.dispose();
  }
}

const TURN_AROUND = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

function smooth(t) {
  return t * t * (3 - 2 * t);
}
