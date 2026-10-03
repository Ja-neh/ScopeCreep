import * as THREE from 'three';
import { AlienCombatant } from './AlienCombatant.js';
import { AlienModel } from '../models/AlienModel.js';
import config from '../../config.json';

const LOST_SIGHT_SECONDS = 2.5;       // Unseen this long while engaging: go and look
const REPOSITION_SECONDS = [5, 8];    // Pick a new firing position this often
const FLANK_DISTANCE = 15;
const FLANK_ANGLE = 1.4;              // Radians around the target from our current bearing
const TARGET_STILL_DISTANCE = 3;      // Target counts as dug in if it moved less than this
const CHEST_HEIGHT = 1.2;

/**
 * AlienTrooper
 * The basic alien infantryman. Patrols near its post; when it sees a target (or hears a
 * gunshot, or a squadmate calls one out) it moves to the edge of cover at fighting range and
 * fires plasma in bursts. If the target stays dug in behind cover it flanks; if it loses the
 * target it searches the last known position, then returns to patrolling.
 * Balance values come from config.json (`enemies.trooper`).
 */
export class AlienTrooper extends AlienCombatant {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {THREE.Vector3} options.position - Spawn (and patrol centre)
   * @param {AlienSquad} options.squad - Supplies targets, cover and squad call-outs
   * @param {Object} [options.cfg] - Overrides config.enemies.trooper (e.g. tougher waves)
   * @param {AlienModel} [options.model]
   */
  constructor(gameWorld, { position, squad, cfg = config.enemies.trooper, model = null }) {
    super(gameWorld, {
      name: 'AlienTrooper',
      position,
      squad,
      cfg,
      model: model || new AlienModel(),
      engageState: TROOPER_ENGAGE
    });

    // Weapon state
    this._burstLeft = 0;
    this._shotTimer = 0;
    this._pauseTimer = Math.random() * cfg.burstPause;

    // Engagement state
    this._repositionTimer = 0;
    this._dugInTimer = 0;
    this._targetAnchor = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._aimDir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
  }

  // ---------------------------------------------------------------------------
  // Weapon: bursts of plasma at the visible target
  // ---------------------------------------------------------------------------

  updateAttack(delta) {
    const target = this.perception.target;
    this.isAiming = this.brain.is('engage') && target !== null;
    if (!this.isAiming) {
      this._burstLeft = 0;
      return;
    }

    if (this._burstLeft > 0) {
      this._shotTimer -= delta;
      if (this._shotTimer <= 0) {
        this._fireAt(target);
        this._burstLeft -= 1;
        this._shotTimer = this.cfg.burstInterval;
        if (this._burstLeft === 0) this._pauseTimer = this.cfg.burstPause * (0.8 + Math.random() * 0.4);
      }
      return;
    }

    this._pauseTimer -= delta;
    if (this._pauseTimer <= 0) {
      this._burstLeft = this.cfg.burstShots;
      this._shotTimer = 0;
    }
  }

  _fireAt(target) {
    const pool = this.gameWorld.projectilePool;
    if (!pool) return;

    this.model.muzzle.getWorldPosition(this._muzzle);
    this._aimDir.set(target.position.x, target.position.y + CHEST_HEIGHT, target.position.z).sub(this._muzzle).normalize();

    // Scatter inside the aim-error cone
    this._right.set(-this._aimDir.z, 0, this._aimDir.x).normalize();
    this._up.crossVectors(this._right, this._aimDir);
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * this.cfg.aimError;
    this._aimDir.addScaledVector(this._right, Math.cos(angle) * radius).addScaledVector(this._up, Math.sin(angle) * radius).normalize();

    pool.firePlasma({ origin: this._muzzle, direction: this._aimDir, source: this, excludeCollider: this.collider });
  }

  // ---------------------------------------------------------------------------
  // Positioning helpers
  // ---------------------------------------------------------------------------

  /**
   * Picks a firing position: the edge of cover at fighting range if any, otherwise a spot in range.
   */
  _chooseFiringPosition(threat) {
    if (this.squad && this.squad.findCover(this.position, threat, this._point, this.cfg.minRange, this.cfg.maxRange)) {
      return this._point;
    }
    const distance = this.position.distanceTo(threat);
    const desired = THREE.MathUtils.clamp(distance, this.cfg.minRange, this.cfg.maxRange);
    return this._point.subVectors(this.position, threat).setY(0).normalize().multiplyScalar(desired).add(threat);
  }

  /**
   * A point around the target, off to one side of our current bearing.
   */
  _chooseFlankPosition(threat) {
    const bearing = Math.atan2(this.position.x - threat.x, this.position.z - threat.z);
    const angle = bearing + (Math.random() < 0.5 ? FLANK_ANGLE : -FLANK_ANGLE);
    return this._point.set(threat.x + Math.sin(angle) * FLANK_DISTANCE, threat.y, threat.z + Math.cos(angle) * FLANK_DISTANCE);
  }
}

const TROOPER_ENGAGE = {
  enter(t) {
    t._repositionTimer = 0;
    t._dugInTimer = 0;
    t._targetAnchor.copy(t.perception.lastKnownPosition);
  },
  update(t, delta) {
    const threat = t.perception.lastKnownPosition;
    t.lookAt(threat);

    if (!t.perception.target && t.perception.timeSinceSeen > LOST_SIGHT_SECONDS) return 'search';

    // Is the target dug in (barely moving) while we can't see it? Then go around.
    if (t._targetAnchor.distanceTo(threat) > TARGET_STILL_DISTANCE) {
      t._targetAnchor.copy(threat);
      t._dugInTimer = 0;
    } else if (!t.perception.target) {
      t._dugInTimer += delta;
    }
    if (t._dugInTimer >= t.cfg.flankAfterSeconds) {
      t._dugInTimer = 0;
      t._repositionTimer = REPOSITION_SECONDS[1];
      t.moveTo(t._chooseFlankPosition(threat), t.cfg.runSpeed);
      return null;
    }

    t._repositionTimer -= delta;
    if (t._repositionTimer <= 0) {
      t._repositionTimer = REPOSITION_SECONDS[0] + Math.random() * (REPOSITION_SECONDS[1] - REPOSITION_SECONDS[0]);
      t.moveTo(t._chooseFiringPosition(threat), t.cfg.runSpeed);
    }
    return null;
  }
};
