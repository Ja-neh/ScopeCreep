import * as THREE from 'three';
import { AlienCombatant } from './AlienCombatant.js';
import { AlienModel } from '../models/AlienModel.js';
import config from '../../config.json';

const LOST_SIGHT_SECONDS = 3;
const BRUTE_CAPSULE = { radius: 0.65, halfHeight: 0.8 }; // About 2.9 m tall
const BRUTE_SCALE = 1.45;
const SLAM_REACH_BONUS = 0.6;     // A slam still lands if the target is just past slamRange
const WEAK_SPOT_MIN_HEIGHT = 1.4; // Backpack sits high on the back

/**
 * AlienBrute
 * A slow, heavily armoured alien. It walks towards its target, then charges when close and
 * winds up an overhead slam that hurts anything still in reach. Sidestep the charge, or shoot
 * the glowing power pack on its back for double damage.
 * Balance values come from config.json (`enemies.brute`).
 */
export class AlienBrute extends AlienCombatant {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {THREE.Vector3} options.position
   * @param {AlienSquad} options.squad
   * @param {Object} [options.cfg] - Overrides config.enemies.brute
   * @param {string} [options.name='AlienBrute'] - The unit's own name (subclasses rename)
   * @param {AlienModel} [options.model] - A build of its own (e.g. the gate walker's)
   * @param {{radius: number, halfHeight: number}} [options.capsule]
   */
  constructor(gameWorld, { position, squad, cfg = config.enemies.brute, name = 'AlienBrute', model = null, capsule = null }) {
    super(gameWorld, {
      name,
      position,
      squad,
      cfg,
      model: model || new AlienModel({ armorColor: 0x8a3f3f, scale: BRUTE_SCALE, backpack: true, characterId: 'gorr' }),
      engageState: BRUTE_ENGAGE,
      capsule: capsule || BRUTE_CAPSULE
    });

    this.attackPhase = 'approach'; // approach -> charge -> windup -> recover
    this._phaseTimer = 0;
    this._offset = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._rangedTimer=0;
    this._muzzle=new THREE.Vector3();
    this._rangedDirection=new THREE.Vector3();
  }

  updateAttack(delta) {
    this._rangedTimer-=delta;
    const target=this.perception.target;
    const power=config.alienPowers[this.model.character.id];
    this.isAiming=!!target && this.attackPhase==='approach';
    if (!this.isAiming || !power || this._rangedTimer>0 ||
      this.position.distanceTo(target.position)>power.range || !this.gameWorld.projectilePool) return;
    this.model.mesh.updateWorldMatrix(true,true);
    this.model.muzzle.getWorldPosition(this._muzzle);
    this._rangedDirection.copy(target.position); this._rangedDirection.y+=1.2;
    this._rangedDirection.sub(this._muzzle).normalize();
    this.gameWorld.projectilePool.firePlasma({origin:this._muzzle,direction:this._rangedDirection,
      speed:power.speed,fraction:THREE.MathUtils.lerp(power.fractionMin,power.fractionMax,Math.random()),
      attack:this.model.hasGun ? 'bullet' : 'slime',source:this,excludeCollider:this.collider});
    this.model.releasePower();
    this._rangedTimer=power.cooldown;
  }

  /**
   * Shots into the power pack on its back do extra damage.
   */
  damageMultiplierAt(point) {
    if (point.y < this.position.y + WEAK_SPOT_MIN_HEIGHT) return 1;
    this._offset.set(point.x - this.position.x, 0, point.z - this.position.z);
    this.getForward(this._forward);
    return this._offset.dot(this._forward) < -0.15 ? this.cfg.weakSpotMultiplier : 1;
  }

  _slam(target) {
    const reach = this.cfg.slamRange + SLAM_REACH_BONUS;
    if (target && !target.health.isDead && target.position.distanceTo(this.position) <= reach) {
      target.health.takeDamage({ amount: this.cfg.slamDamage,
        fraction:this.model.hasGun ? config.alienPowers.gorr.swordFraction : 0, source: this });
      if (this.model.character.id==='gorr') this.health.heal(config.alienPowers.gorr.healOnSlam);
    }
  }
}

const BRUTE_ENGAGE = {
  enter(b) {
    b.attackPhase = 'approach';
    b.attackPose = 0;
  },
  exit(b) {
    b.attackPose = 0;
  },
  update(b, delta) {
    const target = b.perception.target;
    const threat = target ? target.position : b.perception.lastKnownPosition;
    const distance = Math.hypot(threat.x - b.position.x, threat.z - b.position.z);
    b.lookAt(threat);

    if (b.model.canFly) {
      b.attackPhase='approach';b.attackPose=0;
      if (distance>config.alienPowers.galiant.range*0.6) b.moveTo(threat,b.cfg.runSpeed);
      else b.stop();
      return !target && b.perception.timeSinceSeen>LOST_SIGHT_SECONDS ? 'search' : null;
    }

    if (!target && b.perception.timeSinceSeen > LOST_SIGHT_SECONDS && b.attackPhase === 'approach') return 'search';

    switch (b.attackPhase) {
      case 'approach':
        b.attackPose = 0;
        b.moveTo(threat, b.cfg.runSpeed);
        if (target && distance <= b.cfg.chargeRange) {
          b.attackPhase = 'charge';
          b._phaseTimer = b.cfg.chargeSeconds;
        }
        break;

      case 'charge':
        b.moveTo(threat, b.cfg.chargeSpeed);
        b._phaseTimer -= delta;
        if (distance <= b.cfg.slamRange) {
          b.attackPhase = 'windup';
          b._phaseTimer = b.cfg.slamWindup;
          b.stop();
        } else if (b._phaseTimer <= 0) {
          b.attackPhase = 'recover'; // Ran out of steam
          b._phaseTimer = b.cfg.slamRecovery;
          b.stop();
        }
        break;

      case 'windup':
        b._phaseTimer -= delta;
        b.attackPose = 1 - Math.max(0, b._phaseTimer) / b.cfg.slamWindup;
        if (b._phaseTimer <= 0) {
          b._slam(target);
          b.attackPhase = 'recover';
          b._phaseTimer = b.cfg.slamRecovery;
        }
        break;

      case 'recover':
        b.attackPose = Math.max(0, b.attackPose - delta * 4);
        b._phaseTimer -= delta;
        if (b._phaseTimer <= 0) b.attackPhase = 'approach';
        break;
    }
    return null;
  }
};
