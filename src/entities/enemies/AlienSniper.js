import * as THREE from 'three';
import { AlienTrooper } from './AlienTrooper.js';
import config from '../../config.json';

const CHEST_HEIGHT = 1.2;
const BEAM_AXIS = new THREE.Vector3(0, 0, 1); // The beam box is built along +Z

/**
 * AlienSniper
 * A trooper bred for overwatch: it stands a post on high ground or a watchtower and never
 * leaves it. It sweeps the ground below with its scope — the small glint of the lens is the
 * player's only tell — and when it catches a target it trains a visible laser on them for a
 * moment of warning before firing one heavy plasma bolt. Losing them, it sweeps where they
 * were last seen, then goes back to watching. It never patrols (it would walk off its tower)
 * and never takes assault orders.
 * Balance values come from config.json (`enemies.sniper`).
 */
export class AlienSniper extends AlienTrooper {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {THREE.Vector3} options.position - The perch it stands (feet)
   * @param {AlienSquad} options.squad
   * @param {Object} [options.cfg] - Overrides config.enemies.sniper
   * @param {AlienModel} [options.model]
   */
  constructor(gameWorld, { position, squad, cfg = config.enemies.sniper, model = null }) {
    super(gameWorld, {
      position,
      squad,
      cfg,
      model,
      name: 'AlienSniper',
      states: SNIPER_STATES,
      initialState: 'perch',
      engageState: SNIPER_ENGAGE
    });

    // The sweep is its own, so neighbouring snipers do not pan in lockstep
    this._sweepTime = Math.random() * Math.PI * 2;
    this._aimTimer = 0;
    this._shotTimer = cfg.shotIntervalSeconds * (0.3 + Math.random() * 0.5);

    this._aimPoint = new THREE.Vector3();
    this._sightDir = new THREE.Vector3();
    this._sightQuat = new THREE.Quaternion();
    this._sight = this._buildSight();
  }

  // ---------------------------------------------------------------------------
  // Weapon: one heavy bolt, with the laser trained on the target while it charges
  // ---------------------------------------------------------------------------

  updateAttack(delta) {
    const target = this.perception.target;
    this.isAiming = this.brain.is('engage') && target !== null;
    if (!this.isAiming) {
      this._aimTimer = 0;
      return;
    }

    // The moment of laser before the shot is the player's warning to find cover
    this._shotTimer -= delta;
    if (this._shotTimer > 0) return;
    this._aimTimer += delta;
    if (this._aimTimer < this.cfg.aimSeconds) return;

    this._aimTimer = 0;
    this._shotTimer = this.cfg.shotIntervalSeconds;
    this._fireAt(target);
  }

  // ---------------------------------------------------------------------------
  // The sight rig: the scope glint, and the laser while it has a target
  // ---------------------------------------------------------------------------

  /** The scope glint (always, so a sharp eye can spot the post) and the laser (while aiming). */
  _buildSight() {
    const group = new THREE.Group();
    group.name = 'SniperSight';
    group.visible = false;

    this._beamMaterial = new THREE.MeshBasicMaterial({
      color: 0xff5a4d, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    // A unit-length box grown from the group origin: position + scale.z run it to the target
    this._beam = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1), this._beamMaterial);
    this._beam.position.z = 0.5;
    group.add(this._beam);

    this._glintMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff0c0, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this._glint = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), this._glintMaterial);
    group.add(this._glint);

    this.gameWorld.effectsGroup.add(group);
    return group;
  }

  /** Phase 6, after the pose settles: ride the muzzle and run the laser out to its target. */
  lateUpdate(delta) {
    super.lateUpdate(delta);
    this._updateSight();
  }

  _updateSight() {
    if (this.isDead || !this.mesh) {
      this._sight.visible = false;
      return;
    }

    this.model.muzzle.getWorldPosition(this._sight.position);
    const target = this.isAiming ? this.perception.target : null;
    if (!target) {
      // Watching: just the glint, riding the gun
      this._sight.visible = true;
      this._sight.rotation.set(0, 0, 0);
      this._beam.visible = false;
      return;
    }

    // Locked on: the red line, stopped at the first thing in the way (cover the player can use)
    this._aimPoint.set(target.position.x, target.position.y + CHEST_HEIGHT, target.position.z);
    this._sightDir.copy(this._aimPoint).sub(this._sight.position);
    const distance = this._sightDir.length();
    if (distance < 0.05) {
      this._sight.visible = false;
      return;
    }
    this._sightDir.divideScalar(distance);

    let length = distance;
    if (!this._sightRay) this._sightRay = new this.physicsWorld.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    this._sightRay.origin.x = this._sight.position.x;
    this._sightRay.origin.y = this._sight.position.y;
    this._sightRay.origin.z = this._sight.position.z;
    this._sightRay.dir.x = this._sightDir.x;
    this._sightRay.dir.y = this._sightDir.y;
    this._sightRay.dir.z = this._sightDir.z;
    const hit = this.physicsWorld.castRay(this._sightRay, distance, true, undefined, undefined, this.collider);
    if (hit) length = Math.min(length, hit.timeOfImpact);

    this._sight.visible = true;
    this._sightQuat.setFromUnitVectors(BEAM_AXIS, this._sightDir);
    this._sight.quaternion.copy(this._sightQuat);
    this._beam.visible = true;
    this._beam.scale.z = Math.max(length, 0.05);
  }

  dispose() {
    if (this._sight) {
      if (this._sight.parent) this._sight.parent.remove(this._sight);
      this._beam.geometry.dispose();
      this._beamMaterial.dispose();
      this._glint.geometry.dispose();
      this._glintMaterial.dispose();
      this._sight = null;
    }
    super.dispose();
  }
}

const SNIPER_STATES = {
  perch: {
    enter(s) {
      s.clearLook();
      s.stop();
    },
    update(s, delta) {
      if (s.perception.target) return 'engage';
      if (s.perception.hasLastKnown) return 'scanning';

      // Sweep the ground below, panning across the approach
      s._sweepTime += delta * s.cfg.sweepSpeed;
      const sway = Math.sin(s._sweepTime) * s.cfg.sweepArc;
      s.lookAt(s._point.set(s.home.x + sway, s.home.y, s.home.z + s.cfg.sweepDistance));
      return null;
    }
  },

  scanning: {
    enter(s) {
      s.clearLook();
      s._searchTime = 0;
    },
    update(s, delta) {
      if (s.perception.target) return 'engage';
      if (s.perception.hasLastKnown) s.lookAt(s.perception.lastKnownPosition);
      s._searchTime += delta;
      if (!s.perception.hasLastKnown || s._searchTime >= s.cfg.searchSeconds) {
        s.perception.forget();
        return 'perch';
      }
      return null;
    }
  }
};

const SNIPER_ENGAGE = {
  enter(s) {
    s.stop();
    s._aimTimer = 0;
  },
  update(s, delta) {
    // It fights from its post: it turns to track, but never steps down
    s.lookAt(s.perception.lastKnownPosition);
    if (!s.perception.target && s.perception.timeSinceSeen > s.cfg.lostSightSeconds) return 'scanning';
    return null;
  }
};
