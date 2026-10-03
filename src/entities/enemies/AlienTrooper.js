import * as THREE from 'three';
import { GroundCombatant } from '../GroundCombatant.js';
import { AlienModel } from '../models/AlienModel.js';
import { Perception } from '../../ai/Perception.js';
import { StateMachine } from '../../ai/StateMachine.js';
import config from '../../config.json';

const PATROL_RADIUS = 15;
const PATROL_WAIT_SECONDS = 2.5;
const LOST_SIGHT_SECONDS = 2.5;       // Unseen this long while engaging: go and look
const REPOSITION_SECONDS = [5, 8];    // Pick a new firing position this often
const FLANK_DISTANCE = 15;
const FLANK_ANGLE = 1.4;              // Radians around the target from our current bearing
const TARGET_STILL_DISTANCE = 3;      // Target counts as dug in if it moved less than this
const CHEST_HEIGHT = 1.2;

/**
 * AlienTrooper
 * The basic alien infantryman. Patrols near its post; when it sees a target (or hears a
 * gunshot, or a squadmate calls one out) it moves to cover at fighting range and fires plasma
 * in bursts. If the target stays dug in behind cover it flanks; if it loses the target it
 * searches the last known position, then returns to patrolling.
 * Balance values come from config.json (`enemies.trooper`).
 */
export class AlienTrooper extends GroundCombatant {
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
      faction: 'aliens',
      maxHealth: cfg.maxHealth,
      model: model || new AlienModel()
    });
    this.cfg = cfg;
    this.squad = squad;
    this.home = position.clone();
    this.perception = new Perception(this, cfg);

    // Weapon state
    this._burstLeft = 0;
    this._shotTimer = 0;
    this._pauseTimer = Math.random() * cfg.burstPause;

    // Patrol and search state
    this._patrolWait = 0;
    this._pickPatrolPoint = true;
    this._searchTime = 0;

    // Engagement state
    this._repositionTimer = 0;
    this._dugInTimer = 0;
    this._targetAnchor = new THREE.Vector3();
    this._point = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._aimDir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();

    this.brain = new StateMachine(this, TROOPER_STATES, 'patrol');
  }

  onDamaged(info) {
    // Being shot reveals where the shooter is, to us and to squadmates nearby
    const shooter = info && info.source;
    if (shooter && shooter.position) {
      this.perception.share(shooter.position);
      if (this.squad) this.squad.callOut(this, shooter.position);
    }
  }

  /**
   * A gunshot somewhere: investigate it if it was close enough to hear.
   */
  hearNoise(position) {
    if (this.isDead) return;
    if (this.perception.hear(position) && this.brain.is('patrol')) {
      this.brain.change('investigate');
    }
  }

  gameplayUpdate(delta) {
    super.gameplayUpdate(delta);
    if (this.isDead) return;

    const hadTarget = this.perception.target !== null;
    this.perception.update(delta, this.squad ? this.squad.targets : [], this.physicsWorld);
    if (!hadTarget && this.perception.target && this.squad) {
      this.squad.callOut(this, this.perception.lastKnownPosition);
    }

    this.brain.update(delta);
    this._updateWeapon(delta);
  }

  // ---------------------------------------------------------------------------
  // Weapon: bursts of plasma at the visible target
  // ---------------------------------------------------------------------------

  _updateWeapon(delta) {
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
   * Picks a firing position: cover at fighting range if any, otherwise a spot in range.
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

// -----------------------------------------------------------------------------
// Brain
// -----------------------------------------------------------------------------

const TROOPER_STATES = {
  patrol: {
    enter(t) {
      t.clearLook();
      t._patrolWait = 0;
      t._pickPatrolPoint = true;
    },
    update(t, delta) {
      if (t.perception.target) return 'engage';
      if (t.perception.hasLastKnown) return 'investigate';

      if (t._pickPatrolPoint) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * PATROL_RADIUS;
        t.moveTo(t._point.set(t.home.x + Math.cos(angle) * radius, t.home.y, t.home.z + Math.sin(angle) * radius), t.cfg.walkSpeed);
        t._pickPatrolPoint = false;
      } else if (t.hasArrived()) {
        t._patrolWait += delta;
        if (t._patrolWait >= PATROL_WAIT_SECONDS) {
          t._patrolWait = 0;
          t._pickPatrolPoint = true;
        }
      }
      return null;
    }
  },

  investigate: {
    enter(t) {
      t.clearLook();
      t.moveTo(t.perception.lastKnownPosition, t.cfg.runSpeed);
    },
    update(t) {
      if (t.perception.target) return 'engage';
      if (t.hasArrived()) return 'search';
      return null;
    }
  },

  engage: {
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
  },

  search: {
    enter(t) {
      t.moveTo(t.perception.lastKnownPosition, t.cfg.walkSpeed * 1.5);
      t._searchTime = 0;
    },
    update(t, delta) {
      if (t.perception.target) return 'engage';
      if (t.hasArrived()) {
        // Look around while waiting
        t._searchTime += delta;
        t.lookAt(t._point.set(t.position.x + Math.sin(t._searchTime * 1.5) * 5, t.position.y, t.position.z + Math.cos(t._searchTime * 1.5) * 5));
        if (t._searchTime >= t.cfg.searchSeconds) {
          t.perception.forget();
          return 'patrol';
        }
      }
      return null;
    }
  }
};
