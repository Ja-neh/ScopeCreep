import * as THREE from 'three';
import { BaseEntity } from '../../entities/BaseEntity.js';

const DURATION_SECONDS = 4;
// Camera keyframes before the sweep settles behind the player (world positions)
const WIDE_SHOT = { position: new THREE.Vector3(80, 36, 330), target: new THREE.Vector3(-5, 8, 150) };
const BEACH_SHOT = { position: new THREE.Vector3(32, 15, 202), target: new THREE.Vector3(-12, 3, 184) };
const FIELD_OF_VIEW = 55;

/**
 * LandingCinematic
 * Level 2's opening: a short camera sweep from out at sea, past the gangway and the arriving
 * helicopters, ending exactly on the player's own third-person view. The player is frozen
 * meanwhile, the HUD hides behind letterbox bars, and [Space]/[Enter] (skipCutscene) skips it.
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
   * @param {Function} [options.onFinished] - Called once, when it ends or is skipped
   */
  constructor(gameWorld, { player, title, subtitle = '', duration = DURATION_SECONDS, onFinished = null }) {
    super('LandingCinematic');
    this.gameWorld = gameWorld;
    this.player = player;
    this.title = title;
    this.subtitle = subtitle;
    this.duration = duration;
    this.onFinished = onFinished;

    this.elapsed = 0;
    this.hasStarted = false;
    this.isPlaying = false;
    this.isFinished = false;
    this.wasSkipped = false;

    this.camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, window.innerWidth / window.innerHeight, 0.1, 3000);
    this.camera.name = 'LandingCinematicCamera';
    this.path = null;
    this._wideQuat = new THREE.Quaternion();
    this._beachQuat = new THREE.Quaternion();
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

    this.path = new THREE.CatmullRomCurve3([WIDE_SHOT.position, BEACH_SHOT.position, this._endPosition], false, 'centripetal');
    this._lookRotation(WIDE_SHOT, this._wideQuat);
    this._lookRotation(BEACH_SHOT, this._beachQuat);

    player.isDevSuspended = true;
    this.isPlaying = true;
    this.elapsed = 0;
    this._pose(0);
    gameWorld.setActiveCamera(this.camera);
    if (gameWorld.ui) gameWorld.ui.showCinematic(this.title, this.subtitle, '[Space] Skip');
  }

  _lookRotation(shot, out) {
    this._aim.position.copy(shot.position);
    this._aim.lookAt(shot.target);
    // Object3D.lookAt points +Z at the target; cameras look down -Z, so turn around
    out.copy(this._aim.quaternion).multiply(TURN_AROUND);
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
    const t = Math.min(1, this.elapsed / this.duration);
    this._pose(t);
    if (t >= 1) this.finish();
  }

  _pose(t) {
    const s = t * t * t * (t * (t * 6 - 15) + 10); // Smootherstep: ease in and out
    this.path.getPoint(s, this.camera.position);
    if (s < 0.5) {
      this.camera.quaternion.slerpQuaternions(this._wideQuat, this._beachQuat, smooth(s / 0.5));
    } else {
      this.camera.quaternion.slerpQuaternions(this._beachQuat, this._endQuat, smooth((s - 0.5) / 0.5));
    }
    this.camera.fov = THREE.MathUtils.lerp(FIELD_OF_VIEW, this._endFov, s);
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
    this.player.isDevSuspended = false;
    if (gameWorld.activeCamera === this.camera) gameWorld.setActiveCamera(null);
    if (gameWorld.ui) gameWorld.ui.hideCinematic();
    if (this.onFinished) this.onFinished(this.wasSkipped);
  }

  dispose() {
    if (this.isPlaying) {
      this.onFinished = null; // Torn down mid-sweep (level unloaded): restore the view only
      this.finish();
    }
    this.camera = null;
    super.dispose();
  }
}

const TURN_AROUND = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

function smooth(t) {
  return t * t * (3 - 2 * t);
}
