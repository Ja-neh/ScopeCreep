import * as THREE from 'three';
import { GroundCombatant } from '../GroundCombatant.js';
import { SoldierModel } from '../models/SoldierModel.js';
import { Perception } from '../../ai/Perception.js';
import { StateMachine } from '../../ai/StateMachine.js';
import { HitscanWeapon } from '../../weapons/HitscanWeapon.js';
import config from '../../config.json';

const SLOT_TOLERANCE = 2.5;         // Close enough to its post to stand still
const RETARGET_DISTANCE = 1.5;      // Re-issue a move when the post has drifted this far
const RUN_DISTANCE = 10;            // Run, not walk, to a post further than this
const ROUTE_RECHECK_SECONDS = 0.3;  // How often a follower checks whether its way is blocked
const REPOSITION_SECONDS = [4, 7];  // Look for a better firing spot this often
const CHEST_HEIGHT = 1.2;
const ALERT_SECONDS = 2;            // After being shot, look towards the shooter this long
const REVIVE_REACH_SLACK = 0.5;     // Extra reach once a revive has started

/**
 * SquadMate
 * An AI soldier on the player's side (ship crew, or a pilot who has landed). Takes orders from
 * its HumanSquad: walk a route (down the gangway), then follow the leader in formation or hold a
 * point. A follower with a wall between it and its post follows the leader's trail around it,
 * and runs faster to catch up when far behind. When it sees an alien it fights from the edge of
 * cover near its post, firing machine-gun
 * bursts, and goes back to its post once the area is clear. It never strays further than
 * `leashRadius` from its post, so the squad stays together. Sent to a downed teammate, it runs
 * over and revives them (not shooting meanwhile); downed itself, it waits for someone to do the same.
 * Balance values come from config.json (`allies.squadMate`).
 */
export class SquadMate extends GroundCombatant {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {string} options.name - Call sign, used in messages ("Okafor is down!")
   * @param {THREE.Vector3} options.position - Feet position
   * @param {HumanSquad} options.squad - Supplies enemies, formation posts, cover and effects
   * @param {Object} [options.cfg] - Overrides config.allies.squadMate
   * @param {Object} [options.model] - Defaults to a SoldierModel in crew colours
   */
  constructor(gameWorld, { name, position, squad, cfg = config.allies.squadMate, model = null }) {
    super(gameWorld, { name, position, faction: 'humans', maxHealth: cfg.maxHealth, model: model || new SoldierModel() });
    this.cfg = cfg;
    this.squad = squad;
    this.perception = new Perception(this, cfg);

    // Orders: walk `route` first, then `order` ('follow' the leader, or 'hold' a point)
    this.route = [];
    this.order = 'follow';
    this.holdPoint = new THREE.Vector3();
    this.holdFacing = 0;
    this.slotIndex = 0; // Formation place, set by the squad
    this.reviveTarget = null; // Downed teammate this squadmate is going to revive
    this._reviveProgress = 0;

    // The same machine gun as the player, with its own damage and an endless reserve
    this.weapon = new HitscanWeapon({ ...config.weapons.machineGun, damage: cfg.damage, range: cfg.sightRange + 10 });
    this.weapon.reserve = Infinity;
    this._burstLeft = 0;
    this._shotTimer = 0;
    this._pauseTimer = Math.random() * cfg.burstPause;

    this._repositionTimer = 0;
    this._alertTimer = 0;
    this._alertPoint = new THREE.Vector3();
    this._post = new THREE.Vector3();
    this._waypoint = new THREE.Vector3(); // On the leader's trail, when the way to the post is blocked
    this._onTrail = false;
    this._routeTimer = 0;
    this._point = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._aimPoint = new THREE.Vector3();

    this.brain = new StateMachine(this, SQUADMATE_STATES, 'follow');
  }

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------

  /**
   * Walk through `points` in order (e.g. down the gangway), then carry out the standing order.
   * @param {THREE.Vector3[]} points
   */
  walkRoute(points) {
    this.route = points.map((point) => point.clone());
    if (this.brain.is('route')) SQUADMATE_STATES.route.enter(this); // Start the new route
    else this.brain.change('route');
  }

  /** Keep to a place in formation around the squad leader. */
  follow() {
    this.order = 'follow';
    if (!this.brain.is('route') && !this.brain.is('engage') && !this.brain.is('revive')) this.brain.change('follow');
  }

  /**
   * Stay at `point`, watching `facing` (yaw, radians), and defend it.
   */
  hold(point, facing = 0) {
    this.order = 'hold';
    this.holdPoint.copy(point);
    this.holdFacing = facing;
    if (!this.brain.is('route') && !this.brain.is('engage') && !this.brain.is('revive')) this.brain.change('hold');
  }

  get isWalkingRoute() {
    return this.brain.is('route');
  }

  get isReviving() {
    return this.brain.is('revive');
  }

  /**
   * Go to a downed teammate (the player or another squadmate) and revive them.
   */
  reviveTeammate(member) {
    this.reviveTarget = member;
    if (this.brain.is('revive')) SQUADMATE_STATES.revive.enter(this);
    else this.brain.change('revive');
  }

  /** Revived: back to work. */
  onRevived() {
    this.reviveTarget = null;
    this.perception.forget();
    this.brain.change(this.order);
  }

  /**
   * Where this squadmate should be right now: its formation place or its hold point.
   */
  getPost(out) {
    if (this.order === 'hold') return out.copy(this.holdPoint);
    return this.squad ? this.squad.formationPost(this, out) : out.copy(this.position);
  }

  /**
   * Shot by someone we can't see: turn to face them.
   */
  onDamaged(info) {
    const shooter = info && info.source;
    if (shooter && shooter.position) {
      this._alertPoint.copy(shooter.position);
      this._alertTimer = ALERT_SECONDS;
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 5
  // ---------------------------------------------------------------------------

  gameplayUpdate(delta) {
    super.gameplayUpdate(delta);
    if (this.isDead) return;
    if (this._alertTimer > 0) this._alertTimer -= delta;

    this.weapon.update(delta);
    this.perception.update(delta, this.squad ? this.squad.enemies : [], this.physicsWorld);
    this.brain.update(delta);
    this._updateWeapon(delta);
  }

  /**
   * Fires bursts at a visible enemy (not while walking a route, e.g. on the gangway).
   */
  _updateWeapon(delta) {
    const target = this.perception.target;
    this.isAiming = target !== null && !this.brain.is('route') && !this.brain.is('revive');
    if (!this.isAiming) {
      this._burstLeft = 0;
      return;
    }
    if (this.weapon.ammo === 0) this.weapon.startReload();

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
    this.model.muzzle.getWorldPosition(this._muzzle);
    this._aimPoint.set(target.position.x, target.position.y + CHEST_HEIGHT, target.position.z);
    const result = this.weapon.fire({
      physicsWorld: this.physicsWorld,
      origin: this._muzzle,
      aimPoint: this._aimPoint,
      spread: this.cfg.aimError,
      excludeCollider: this.collider,
      source: this
    });
    if (result && this.squad) this.squad.onShot(this, this._muzzle, result);
  }

  /**
   * Moves to `post` unless already there; walks short distances and runs long ones.
   * @returns {boolean} True when standing at the post
   */
  _goTo(post, catchUp = false) {
    const distance = Math.hypot(post.x - this.position.x, post.z - this.position.z);
    if (distance <= SLOT_TOLERANCE && !this.hasMoveTarget) return true;
    if (distance <= SLOT_TOLERANCE * 0.5) {
      this.stop();
      return true;
    }
    const drift = Math.hypot(post.x - this.moveTarget.x, post.z - this.moveTarget.z);
    if (!this.hasMoveTarget || drift > RETARGET_DISTANCE) {
      this.moveTo(post, this._speedFor(distance, catchUp));
    }
    return false;
  }

  /** Walk when close, run when further, and run flat out to catch up when far behind. */
  _speedFor(distance, catchUp) {
    if (catchUp && distance > this.cfg.catchUpDistance) return this.cfg.catchUpSpeed;
    return distance > RUN_DISTANCE ? this.cfg.runSpeed : this.cfg.walkSpeed;
  }

  /**
   * Heads for its formation post: straight there when nothing solid is in the way, otherwise
   * along the leader's trail (around houses and walls), running to catch up when far behind.
   * @returns {boolean} True once standing at the post
   */
  _followTo(post, delta) {
    this._routeTimer -= delta;
    if (this._routeTimer <= 0) {
      this._routeTimer = ROUTE_RECHECK_SECONDS;
      this._onTrail = !!this.squad && this.squad.routeTowards(this, post, this._waypoint);
    }
    if (!this._onTrail) return this._goTo(post, true);

    const distance = Math.hypot(post.x - this.position.x, post.z - this.position.z);
    const drift = Math.hypot(this._waypoint.x - this.moveTarget.x, this._waypoint.z - this.moveTarget.z);
    if (!this.hasMoveTarget || drift > 0.5) {
      this.moveTo(this._waypoint, this._speedFor(Math.max(distance, RUN_DISTANCE + 1), true));
    }
    if (this.hasArrived()) this._routeTimer = 0; // On to the next trail point
    return false;
  }

  /**
   * A firing spot near the post: the edge of a rock at fighting range if one is within the
   * leash, otherwise the post itself.
   */
  _chooseFiringSpot(post, threat) {
    if (this.squad && this.squad.findCover(post, threat, this._point, this.cfg.minRange, this.cfg.maxRange) &&
      Math.hypot(this._point.x - post.x, this._point.z - post.z) <= this.cfg.leashRadius) {
      return this._point;
    }
    return this._point.copy(post);
  }

  dispose() {
    this.weapon = null;
    super.dispose();
  }
}

/** Facing direction when standing at a post: the hold facing, or outwards from the formation. */
function watchDirection(mate, out) {
  const yaw = mate.order === 'hold' ? mate.holdFacing : (mate.squad ? mate.squad.watchYaw(mate) : mate.yaw);
  return out.set(mate.position.x - Math.sin(yaw) * 10, mate.position.y, mate.position.z - Math.cos(yaw) * 10);
}

function standAtPost(mate, delta) {
  mate.getPost(mate._post);
  const atPost = mate.order === 'follow' ? mate._followTo(mate._post, delta) : mate._goTo(mate._post);
  if (mate._alertTimer > 0) {
    mate.lookAt(mate._alertPoint); // Under fire: look for the shooter
  } else if (atPost) {
    mate.lookAt(watchDirection(mate, mate._point));
  } else {
    mate.clearLook(); // Face where we're walking
  }
}

const SQUADMATE_STATES = {
  route: {
    enter(m) {
      m.clearLook();
      if (m.route.length > 0) m.moveTo(m.route[0], m.cfg.walkSpeed);
    },
    update(m) {
      if (m.route.length === 0) return m.order;
      if (m.hasArrived()) {
        m.route.shift();
        if (m.route.length === 0) {
          m.stop();
          return m.order;
        }
        m.moveTo(m.route[0], m.cfg.walkSpeed);
      }
      return null;
    }
  },

  follow: {
    update(m, delta) {
      if (m.perception.target) return 'engage';
      standAtPost(m, delta);
      return null;
    }
  },

  hold: {
    update(m, delta) {
      if (m.perception.target) return 'engage';
      standAtPost(m, delta);
      return null;
    }
  },

  revive: {
    enter(m) {
      m._reviveProgress = 0;
      m.clearLook();
    },
    exit(m) {
      m.reviveTarget = null;
      m._reviveProgress = 0;
    },
    update(m, delta) {
      const target = m.reviveTarget;
      const squad = m.squad;
      if (!target || !squad || !squad.isDowned(target)) return m.order;

      // Start within 80% of the reach; once started, keep going until clearly out of reach
      // (bumping against the downed player's body must not restart the count)
      const distance = Math.hypot(target.position.x - m.position.x, target.position.z - m.position.z);
      const reach = m._reviveProgress > 0 ? squad.reviveRadius + REVIVE_REACH_SLACK : squad.reviveRadius * 0.8;
      if (distance > reach) {
        m._reviveProgress = 0;
        if (!m.hasMoveTarget || Math.hypot(m.moveTarget.x - target.position.x, m.moveTarget.z - target.position.z) > 1) {
          m.moveTo(target.position, m.cfg.runSpeed);
        }
        return null;
      }

      m.stop();
      m.lookAt(target.position);
      m._reviveProgress += delta;
      if (m._reviveProgress >= squad.reviveHoldSeconds) {
        squad.reviveMember(target, m);
        return m.order;
      }
      return null;
    }
  },

  engage: {
    enter(m) {
      m._repositionTimer = 0;
    },
    exit(m) {
      m.clearLook();
    },
    update(m, delta) {
      const target = m.perception.target;
      if (!target && m.perception.timeSinceSeen > m.cfg.regroupSeconds) return m.order;

      m.lookAt(target ? target.position : m.perception.lastKnownPosition);
      m.getPost(m._post);
      const fromPost = Math.hypot(m.position.x - m._post.x, m.position.z - m._post.z);

      m._repositionTimer -= delta;
      if (m._repositionTimer <= 0 || fromPost > m.cfg.leashRadius) {
        m._repositionTimer = REPOSITION_SECONDS[0] + Math.random() * (REPOSITION_SECONDS[1] - REPOSITION_SECONDS[0]);
        const threat = target ? target.position : m.perception.lastKnownPosition;
        const spot = m._chooseFiringSpot(m._post, threat);
        const distance = Math.hypot(spot.x - m.position.x, spot.z - m.position.z);
        if (distance > SLOT_TOLERANCE) m.moveTo(spot, m.cfg.runSpeed);
        else m.stop();
      }
      return null;
    }
  }
};
