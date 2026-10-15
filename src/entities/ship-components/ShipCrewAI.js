import * as THREE from 'three';
import config from '../../config.json';

/**
 * ShipCrewAI
 * Invisible crew that man the player battleship's unoccupied stations.
 *
 * The player can only sit at one post at a time, so without a crew the other guns and the helm are
 * dead weight. This drives whichever stations nobody is mounted in: the helm runs in Phase 2
 * (prePhysicsUpdate, via HelmStation) because it moves the hull and must land before the colliders
 * are synced and Rapier steps, while gunnery runs in Phase 5 (gameplayUpdate) alongside every other
 * weapon in the game.
 *
 * It never calls mount()/dismount() on a station - those teleport the player and switch the active
 * camera and HUD unconditionally. Occupancy is read from BaseStation.isMounted and the station is
 * simply left alone while a player is in it.
 */

const ORDERS = ['hold', 'engage', 'follow'];

const ORDER_LABELS = {
  hold: 'HOLD POSITION',
  engage: 'ENGAGE TARGET',
  follow: 'FOLLOW'
};

/**
 * Warships are the entities that carry walking characters around, which is exactly the duck-type
 * PlatformTracker already uses. Matching on that keeps this working for any future hull class
 * instead of hardcoding entity names.
 */
function isNavalVessel(entity) {
  return typeof entity.getPlatformDisplacement === 'function' &&
    typeof entity.isPointOnPlatform === 'function';
}

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export class ShipCrewAI {
  constructor(battleship, options = {}) {
    this.battleship = battleship;
    this.enabled = options.enabled ?? false;

    this.cfg = config.ship.crewAI;
    this.order = options.order || this.cfg.orders.default;

    /** Explicitly assignable escort; auto-acquired from nearby friendlies when left null. */
    this.followTarget = options.followTarget || null;

    this._scanTimer = 0;
    this._navalTarget = null;
    this._airTarget = null;

    // Which side the ENGAGE broadside is shaped on, latched per target.
    this._engageTarget = null;
    this._engageSide = 0;

    // Preallocated scratchpads - nothing here may allocate per frame.
    this._aimPoint = new THREE.Vector3();
    this._rel = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
  }

  get navalTarget() {
    return this._navalTarget;
  }

  get airTarget() {
    return this._airTarget;
  }

  /**
   * Advances the order cycle and tells the player through the existing toast system.
   */
  cycleOrder(gameWorld) {
    const next = (ORDERS.indexOf(this.order) + 1) % ORDERS.length;
    this.order = ORDERS[next];
    gameWorld?.ui?.showToast(`SHIP ORDER: ${ORDER_LABELS[this.order]}`, 'info');
    return this.order;
  }

  // ---------------------------------------------------------------------------
  // Phase 2: helm
  // ---------------------------------------------------------------------------

  /**
   * Drives the helm while no player is at the wheel. Called from HelmStation's unmounted branch so
   * that hull motion still lands before colliders are synced for the physics step.
   * @param {number} delta
   * @param {GameWorld} gameWorld
   * @param {HelmStation} helm
   */
  updateHelm(delta, gameWorld, helm) {
    if (!this.enabled || !helm || this.battleship.isDestroyed) return;

    // Only read the order key here, never from a mounted station, so it cannot fire while the
    // player is at the helm or on a gun.
    if (gameWorld?.input?.isActionJustPressed?.('cycleShipOrder')) {
      this.cycleOrder(gameWorld);
    }

    switch (this.order) {
      case 'engage':
        this._steerEngage(delta, helm);
        break;
      case 'follow':
        this._steerFollow(delta, helm);
        break;
      default:
        this._brake(delta, helm);
        break;
    }
  }

  /**
   * Bleeds way off and holds the current heading.
   */
  _brake(delta, helm) {
    helm.rudderAngle = 0;
    helm.speed *= Math.max(0.0, 1.0 - helm.drag * 1.5 * delta);

    const step = this.cfg.orders.hold.brakeRate * delta;
    if (helm.speed > 0) helm.speed = Math.max(0, helm.speed - step);
    else if (helm.speed < 0) helm.speed = Math.min(0, helm.speed + step);
  }

  /**
   * Runs at the target until inside the preferred gunnery range, then turns out until the target
   * sits at a broadside bearing.
   *
   * The turn-out is not optional: both main gun mounts face the bow with a limited traverse arc, so
   * a target abaft the beam is unreachable and the guns would sit silent. But turning out first
   * would only close the range at approachSpeed * cos(broadsideBearing), so the ship steers straight
   * at the target while it is still outside the preferred range - the bow guns bear all the way in.
   */
  _steerEngage(delta, helm) {
    const cfg = this.cfg.orders.engage;
    const target = this._navalTarget;
    if (!target || !target.mesh) {
      this._brake(delta, helm);
      return;
    }

    if (this._engageTarget !== target) {
      this._engageTarget = target;
      this._engageSide = 0;
    }

    const shipPos = this.battleship.mesh.position;
    const dx = target.mesh.position.x - shipPos.x;
    const dz = target.mesh.position.z - shipPos.z;
    const dist = Math.hypot(dx, dz);

    // Heading convention from HelmStation: forward is (-sin h, -cos h) in XZ.
    const bearing = Math.atan2(-dx, -dz);

    let desiredHeading = bearing;
    if (dist <= cfg.preferredRange + cfg.rangeTolerance) {
      // Latch the side once and keep it: recomputing from the current heading every frame flips the
      // rudder across as the target crosses the bow, and the ship weaves instead of settling.
      if (this._engageSide === 0) {
        this._engageSide = wrapAngle(bearing - helm.heading) < 0 ? -1 : 1;
      }
      desiredHeading = bearing - this._engageSide * cfg.broadsideBearing;
    }

    helm.heading += this._turnTowards(desiredHeading, helm.heading, cfg.aiTurnRate, delta);
    helm.rudderAngle = 0;
    helm.speed = dist < cfg.preferredRange - cfg.rangeTolerance ? 0 : cfg.approachSpeed;
  }

  /**
   * Keeps station on an escort, slowing to nothing once inside the follow distance.
   */
  _steerFollow(delta, helm) {
    const cfg = this.cfg.orders.follow;
    const target = this.followTarget;
    if (!target || !target.mesh) {
      this._brake(delta, helm);
      return;
    }

    const shipPos = this.battleship.mesh.position;
    const dx = target.mesh.position.x - shipPos.x;
    const dz = target.mesh.position.z - shipPos.z;
    const dist = Math.hypot(dx, dz);
    const bearing = Math.atan2(-dx, -dz);

    helm.heading += this._turnTowards(bearing, helm.heading, cfg.aiTurnRate, delta);
    helm.rudderAngle = 0;

    if (dist <= cfg.followDistance) helm.speed = 0;
    else if (dist >= cfg.catchUpThreshold) helm.speed = cfg.catchUpSpeed;
    else helm.speed = cfg.followSpeed;
  }

  /**
   * Steps `current` toward `desired` by at most `rate * delta`, returning the signed increment.
   *
   * The crew's rate is capped below the hull's own turnRate so turret traverse always out-runs hull
   * yaw - otherwise a turning ship and a tracking gun close on each other so slowly that the gun
   * never settles inside its aim tolerance and stops firing altogether.
   */
  _turnTowards(desired, current, rate, delta) {
    const err = wrapAngle(desired - current);
    const maxStep = rate * delta;
    return Math.abs(err) <= maxStep ? err : Math.sign(err) * maxStep;
  }

  // ---------------------------------------------------------------------------
  // Phase 5: gunnery
  // ---------------------------------------------------------------------------

  /**
   * Aims and fires every unoccupied gun. Deliberately independent of the helm order: HOLD is about
   * where the ship goes, not about staying silent, so the crew keeps fighting under any order.
   */
  updateGunnery(delta, gameWorld) {
    if (!this.enabled || this.battleship.isDestroyed) return;

    this._acquireTargets(delta, gameWorld);

    const gunnery = this.cfg.gunnery;
    if (gunnery.gunneryRequiresEngageOrder && this.order !== 'engage') return;

    this._driveArtillery(gunnery, delta);
    this._driveFlak(gunnery, delta);
  }

  _driveArtillery(gunnery, delta) {
    const target = this._navalTarget;
    if (!target || !target.mesh) return;

    const cfg = gunnery.artillery;
    const shipPos = this.battleship.mesh.position;
    const dx = target.mesh.position.x - shipPos.x;
    const dz = target.mesh.position.z - shipPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > cfg.maxEngagementDistance || dist < cfg.minEngagementDistance) return;

    this._aimPoint.copy(target.mesh.position);
    this._aimPoint.y += cfg.aimHeightOffset;

    const ship = this.battleship;
    this._driveTurret(ship.mainGun, this._aimPoint, gunnery, delta);
    this._driveTurret(ship.mainGunBack, this._aimPoint, gunnery, delta);
  }

  _driveTurret(turret, aimPoint, gunnery, delta) {
    if (!turret || turret.isMounted || turret.isDestroyed) return;
    const aim = turret.aimTowards(aimPoint, delta, gunnery.turretTurnSpeed, gunnery.turretElevationSpeed);
    if (aim.onTarget) turret.fireAI();
  }

  _driveFlak(gunnery, delta) {
    const turret = this.battleship.flakTurret;
    const target = this._airTarget;
    if (!turret || turret.isMounted || turret.isDestroyed) return;
    if (!target || !target.mesh) return;

    turret.yawGroup.getWorldPosition(this._muzzle);

    const cfg = gunnery.flak;
    const slant = this._rel.subVectors(target.mesh.position, this._muzzle).length();
    if (slant > cfg.maxEngagementDistance || slant < cfg.minSlantRange) return;

    this._solveLead(target, this._muzzle, cfg.leadIterations, this._aimPoint);

    const aim = turret.aimTowards(this._aimPoint, delta, gunnery.turretTurnSpeed, gunnery.turretElevationSpeed);
    if (aim.onTarget) turret.fireAI();
  }

  /**
   * Solves the intercept point against a moving aircraft, then folds in ballistic drop.
   *
   * Iterates rather than taking a single pass: flight time depends on where the target will be,
   * which depends on flight time. One pass against a jet receding at cruise speed aims well short -
   * far enough to fall outside the flak spread cone at range and miss outright. Each pass shrinks
   * the error by roughly (target speed / round speed), so a handful of iterations converges.
   * @param {Object} target - Entity with a mesh and an optional velocity vector
   * @param {THREE.Vector3} muzzlePos
   * @param {number} iterations
   * @param {THREE.Vector3} out
   * @returns {THREE.Vector3} out
   */
  _solveLead(target, muzzlePos, iterations, out) {
    const projectile = config.projectiles.flak;
    out.copy(target.mesh.position);

    const velocity = target.velocity;
    if (!velocity) return out;

    let flightTime = this._rel.subVectors(out, muzzlePos).length() / projectile.speed;
    for (let i = 0; i < iterations; i++) {
      out.copy(target.mesh.position).addScaledVector(velocity, flightTime);
      flightTime = this._rel.subVectors(out, muzzlePos).length() / projectile.speed;
    }

    out.y += 0.5 * Math.abs(projectile.gravity) * flightTime * flightTime;
    return out;
  }

  /**
   * Picks the nearest hostile warship and the nearest hostile aircraft on a throttle, and keeps
   * `followTarget` pointed at a live friendly escort.
   *
   * Rescans from scratch every time rather than holding a cached target: a sticky cache that is
   * never revalidated keeps firing at wrecks.
   */
  _acquireTargets(delta, gameWorld) {
    if (!gameWorld || !gameWorld.entities) return;

    this._scanTimer -= delta;
    if (this._scanTimer > 0) return;
    this._scanTimer = this.cfg.perception.rescanInterval;

    const shipPos = this.battleship.mesh.position;
    const ours = this.battleship.faction;
    const perception = this.cfg.perception;
    const navalLimit = perception.navalScanRadius * perception.navalScanRadius;
    const airLimit = perception.airScanRadius * perception.airScanRadius;

    let naval = null;
    let navalBest = Infinity;
    let air = null;
    let airBest = Infinity;
    let friendly = null;
    let friendlyBest = Infinity;

    for (const entity of gameWorld.entities) {
      if (!entity || entity === this.battleship || !entity.mesh) continue;
      if (entity.isDestroyed) continue;
      // Skip anything without a faction (terrain, pools, effects) - it is not a combatant.
      if (!entity.faction) continue;

      const dx = entity.mesh.position.x - shipPos.x;
      const dz = entity.mesh.position.z - shipPos.z;
      const flatSq = dx * dx + dz * dz;

      if (entity.faction === ours) {
        if (isNavalVessel(entity) && flatSq < friendlyBest) {
          friendlyBest = flatSq;
          friendly = entity;
        }
        continue;
      }

      if (isNavalVessel(entity)) {
        if (flatSq <= navalLimit && flatSq < navalBest) {
          navalBest = flatSq;
          naval = entity;
        }
      } else {
        const dy = entity.mesh.position.y - shipPos.y;
        const distSq = flatSq + dy * dy;
        if (distSq <= airLimit && distSq < airBest) {
          airBest = distSq;
          air = entity;
        }
      }
    }

    this._navalTarget = naval;
    this._airTarget = air;
    if (!this.followTarget || this.followTarget.isDestroyed || !this.followTarget.mesh) {
      this.followTarget = friendly;
    }
  }

  dispose() {
    this.enabled = false;
    this._navalTarget = null;
    this._airTarget = null;
    this._engageTarget = null;
    this.followTarget = null;
  }
}

export { ORDERS as SHIP_ORDERS, ORDER_LABELS as SHIP_ORDER_LABELS };
