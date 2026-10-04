import * as THREE from 'three';
import { AlienCombatant } from './AlienCombatant.js';
import { AlienModel } from '../models/AlienModel.js';
import { Shockwave } from './Shockwave.js';
import config from '../../config.json';

const WARDEN_CAPSULE = { radius: 0.95, halfHeight: 1.35 }; // About 4.6 m tall
const WARDEN_SCALE = 2.3;
const CHEST_HEIGHT = 1.2;     // Volleys aim at targets' chests
const SHIELD_RADIUS = 3.4;
const _UP = new THREE.Vector3(0, 1, 0);

/**
 * AlienWarden
 * The boss of Level 3: a giant alien with a glowing crest that guards the village hall. It waits,
 * dormant, until awaken()ed (or hurt). Then it holds the floor in front of its dais, never
 * straying more than `leashRadius` from its guard point, and fights:
 * - Plasma volleys: a fan of bolts at whoever it can see, every `volleySeconds`
 * - Shockwave: it raises its arms (`slamWindup`, with a warning ring on the floor) and slams
 *   the floor; a ring of force rolls out and hurts everyone standing on the ground as it passes.
 *   Jump over it. It slams every `slamSeconds`, sooner when someone gets close.
 * - Enraged (enrage(), by its arena below `enrageFraction` health): everything comes faster.
 * While shielded (setShielded) a bubble surrounds it and it takes no damage; its arena raises
 * and drops the shield with the shield crystals.
 * Balance values come from config.json (`enemies.warden`).
 */
export class AlienWarden extends AlienCombatant {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {THREE.Vector3} options.position - Where it stands
   * @param {AlienSquad} options.squad - Supplies its targets
   * @param {THREE.Vector3} [options.guardPoint] - The middle of the floor it holds (defaults to position)
   * @param {Object} [options.cfg] - Overrides config.enemies.warden
   */
  constructor(gameWorld, { position, squad, guardPoint = null, cfg = config.enemies.warden }) {
    super(gameWorld, {
      name: 'AlienWarden',
      position,
      squad,
      cfg,
      model: new AlienModel({ armorColor: 0x6a58a0, scale: WARDEN_SCALE, backpack: true, crest: true }),
      engageState: WARDEN_ENGAGE,
      capsule: WARDEN_CAPSULE,
      states: { dormant: WARDEN_DORMANT },
      initialState: 'dormant'
    });
    this.displayName = 'THE WARDEN';
    this.isBoss = true; // Not part of waves, and never wanders off
    this.guardPoint = (guardPoint || position).clone();
    this.shielded = false;
    this.enraged = false;

    // Attacks: 'ready' -> 'windup' (arms up) -> slam -> 'recover'
    this.attackPhase = 'ready';
    this._volleyTimer = cfg.volleySeconds * 0.6;
    this._slamTimer = cfg.slamSeconds * 0.7;
    this._windupTimer = 0;
    this.volleysFired = 0;
    this.slams = 0;
    this.shockwave = new Shockwave(gameWorld.effectsGroup);

    // The shield: a pulsing bubble round the whole body
    this._shieldMaterial = new THREE.MeshBasicMaterial({
      color: 0x66e8ff, transparent: true, opacity: 0.2, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
    });
    this.shieldMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(SHIELD_RADIUS, 2), this._shieldMaterial);
    this.shieldMesh.position.y = this.capsuleCenter;
    this.shieldMesh.visible = false;
    this.mesh.add(this.shieldMesh);
    this._shieldTime = 0;

    this._muzzle = new THREE.Vector3();
    this._aim = new THREE.Vector3();
    this._direction = new THREE.Vector3();
  }

  // ---------------------------------------------------------------------------
  // Orders from the arena
  // ---------------------------------------------------------------------------

  /**
   * Wakes it up to fight, looking towards `point` (where the intruders are).
   * @param {THREE.Vector3} [point]
   */
  awaken(point = null) {
    if (this.isDead || !this.brain.is('dormant')) return;
    if (point) this.perception.share(point);
    this.brain.change('engage');
  }

  /** Raises (true) or drops (false) the shield. */
  setShielded(on) {
    this.shielded = on;
    this.health.invulnerable = on;
    this.shieldMesh.visible = on;
  }

  /** Below half health: attacks come faster from now on. */
  enrage() {
    this.enraged = true;
  }

  /** Multiplies the time between attacks. */
  get cadence() {
    return this.enraged ? this.cfg.enragedCadence : 1;
  }

  // ---------------------------------------------------------------------------
  // Phase 5
  // ---------------------------------------------------------------------------

  gameplayUpdate(delta) {
    super.gameplayUpdate(delta); // Perception, brain, attacks
    this.shockwave.update(delta, this.squad ? this.squad.targets : []);
  }

  updateAttack(delta) {
    if (!this.brain.is('engage')) return;
    const cfg = this.cfg;
    const target = this.perception.target;

    if (this.attackPhase === 'windup') {
      this._windupTimer -= delta;
      this.attackPose = 1 - Math.max(0, this._windupTimer) / cfg.slamWindup;
      if (this._windupTimer <= 0) {
        this._slam();
        this.attackPhase = 'recover';
        this._windupTimer = cfg.slamRecovery;
      }
      return;
    }
    if (this.attackPhase === 'recover') {
      this.attackPose = Math.max(0, this.attackPose - delta * 3);
      this._windupTimer -= delta;
      if (this._windupTimer <= 0) this.attackPhase = 'ready';
      return;
    }

    // Plasma volleys at whoever it can see
    this.isAiming = target !== null;
    this._volleyTimer -= delta;
    if (target && this._volleyTimer <= 0) {
      this._fireVolley(target);
      this._volleyTimer = cfg.volleySeconds * this.cadence;
    }

    // Slam when it is time, or sooner when someone comes close
    this._slamTimer -= delta;
    const close = target && Math.hypot(target.position.x - this.position.x, target.position.z - this.position.z) <= cfg.slamTriggerRange;
    if (this._slamTimer <= 0 || (close && this._slamTimer <= cfg.slamSeconds * this.cadence * 0.5)) {
      this.attackPhase = 'windup';
      this._windupTimer = cfg.slamWindup;
      this._slamTimer = cfg.slamSeconds * this.cadence;
      this.isAiming = false;
      this.stop();
    }
  }

  /** A fan of plasma bolts centred on the target. */
  _fireVolley(target) {
    const pool = this.gameWorld.projectilePool;
    if (!pool) return;
    const cfg = this.cfg;
    this.model.muzzle.getWorldPosition(this._muzzle);
    this._aim.set(target.position.x, target.position.y + CHEST_HEIGHT, target.position.z).sub(this._muzzle).normalize();
    const spread = THREE.MathUtils.degToRad(cfg.volleySpreadDegrees);
    for (let i = 0; i < cfg.volleyBolts; i++) {
      const angle = cfg.volleyBolts > 1 ? -spread / 2 + (spread * i) / (cfg.volleyBolts - 1) : 0;
      this._direction.copy(this._aim).applyAxisAngle(_UP, angle);
      pool.firePlasma({
        origin: this._muzzle,
        direction: this._direction,
        speed: cfg.volleySpeed,
        damage: cfg.volleyDamage,
        source: this,
        excludeCollider: this.collider
      });
    }
    this.volleysFired++;
  }

  _slam() {
    const cfg = this.cfg;
    this.shockwave.start(this.position, {
      speed: cfg.shockwaveSpeed,
      maxRadius: cfg.shockwaveRadius,
      damage: cfg.shockwaveDamage,
      clearHeight: cfg.shockwaveClearHeight,
      source: this
    });
    this.slams++;
  }

  onDied() {
    this.setShielded(false);
    this.attackPhase = 'ready';
  }

  // ---------------------------------------------------------------------------
  // Phase 6
  // ---------------------------------------------------------------------------

  lateUpdate(delta) {
    super.lateUpdate(delta);
    this.shockwave.sync(this.position, this.attackPhase === 'windup' ? this.attackPose : 0);
    if (this.shieldMesh.visible) {
      this._shieldTime += delta;
      this._shieldMaterial.opacity = 0.16 + 0.08 * Math.sin(this._shieldTime * 3);
    }
  }

  dispose() {
    this.shockwave.dispose();
    this.shieldMesh.geometry.dispose();
    this._shieldMaterial.dispose();
    super.dispose();
  }
}

/** Waiting in the hall: stands still until awakened, or hurt. */
const WARDEN_DORMANT = {
  enter(w) {
    w.stop();
    w.clearLook();
  },
  update(w) {
    return w.health.currentHealth < w.health.maxHealth ? 'engage' : null;
  }
};

/**
 * Fighting: faces the threat and closes in on it, but holds the floor round its guard point.
 * It never gives up and goes searching: it guards the hall to the end.
 */
const WARDEN_ENGAGE = {
  enter(w) {
    w.attackPhase = 'ready';
  },
  exit(w) {
    w.attackPose = 0;
    w.isAiming = false;
  },
  update(w) {
    const threat = w.perception.target ? w.perception.target.position : w.perception.lastKnownPosition;
    w.lookAt(threat);
    if (w.attackPhase !== 'ready') return null; // Standing still to slam

    const toX = threat.x - w.guardPoint.x;
    const toZ = threat.z - w.guardPoint.z;
    const away = Math.hypot(toX, toZ);
    const reach = Math.min(away, w.cfg.leashRadius);
    if (away > 0.01) w._point.set(w.guardPoint.x + (toX / away) * reach, w.guardPoint.y, w.guardPoint.z + (toZ / away) * reach);
    else w._point.copy(w.guardPoint);

    const fromThreat = Math.hypot(threat.x - w.position.x, threat.z - w.position.z);
    const offPost = Math.hypot(w._point.x - w.position.x, w._point.z - w.position.z);
    if (fromThreat > w.cfg.keepDistance && offPost > 1) w.moveTo(w._point, w.cfg.walkSpeed);
    else w.stop();
    return null;
  }
};
