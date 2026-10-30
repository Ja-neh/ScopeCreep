import * as THREE from 'three';
import { GroundCombatant } from '../GroundCombatant.js';
import { Perception } from '../../ai/Perception.js';
import { StateMachine } from '../../ai/StateMachine.js';
import config from '../../config.json';

const PATROL_RADIUS = 15;
const PATROL_WAIT_SECONDS = 2.5;

/**
 * AlienCombatant
 * What every alien ground unit shares: perception, squad call-outs, hearing, assault orders,
 * and the patrol, investigate and search states. Subclasses supply the `engage` state
 * (how they fight) and updateAttack(delta) (their weapon), and may add states of their own.
 */
export class AlienCombatant extends GroundCombatant {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {string} options.name
   * @param {THREE.Vector3} options.position - Spawn (and patrol centre)
   * @param {AlienSquad} options.squad
   * @param {Object} options.cfg - Sight, hearing, speeds and health (from config.enemies)
   * @param {Object} options.model
   * @param {Object} options.engageState - { enter?, update?, exit? } for the subclass's fighting style
   * @param {{radius: number, halfHeight: number}} [options.capsule]
   * @param {Object} [options.states] - More states for the brain (e.g. a boss waiting to be woken)
   * @param {string} [options.initialState='patrol']
   */
  constructor(gameWorld, { name, position, squad, cfg, model, engageState, capsule, states = {}, initialState = 'patrol' }) {
    super(gameWorld, { name, position, faction: 'aliens', maxHealth: cfg.maxHealth, model, capsule });
    this.cfg = cfg;
    this.squad = squad;
    this.home = position.clone();
    this.perception = new Perception(this, cfg);

    this._patrolWait = 0;
    this._pickPatrolPoint = true;
    this._searchTime = 0;
    this._point = new THREE.Vector3();

    this.brain = new StateMachine(this, { ...SHARED_STATES, engage: engageState, ...states }, initialState);
    this.isFlying = false;
    this._flightRay = null;
    this._tacticalPoint=new THREE.Vector3();
    this._tacticalTimer=0;this._tacticalActive=0;this._dodgeCooldown=0;
    this._dodgeRequested=false;this._dodging=false;this._tacticalSide=Math.random()<0.5 ? -1 : 1;
    this._tacticalRay=new this.physicsWorld.RAPIER.Ray({x:0,y:0,z:0},{x:0,y:-1,z:0});
  }

  /** Flight uses the same collision sweep as walking, including ceilings and landing. */
  _updateVerticalVelocity(delta) {
    if (!this.model.canFly) { this.isFlying=false;super._updateVerticalVelocity(delta); return; }
    const cfg=config.alienPowers.flight;
    const approaching=this.name==='AlienWarden' ? !!this.perception.target && this.brain.is('engage') :
      !!this.perception.target || this.hasMoveTarget || this.perception.hasLastKnown;
    const wantsFlight=approaching &&
      this.attackPhase!=='windup' && this.attackPhase!=='recover' &&
      (this._slamTimer===undefined || this._slamTimer>cfg.landBeforeSlamSeconds);
    const physics=this.physicsWorld;
    if (!this._flightRay) this._flightRay=new physics.RAPIER.Ray({x:0,y:0,z:0},{x:0,y:-1,z:0});
    Object.assign(this._flightRay.origin,{x:this.position.x,y:this.position.y+0.2,z:this.position.z});
    const hit=physics.castRay(this._flightRay,cfg.groundProbe,true,undefined,undefined,this.collider);
    if (wantsFlight && hit) {
      const ground=this._flightRay.origin.y-hit.timeOfImpact;
      const heightError=ground+cfg.altitude-this.position.y;
      this.verticalVelocity=THREE.MathUtils.clamp(heightError*cfg.response,-cfg.climbSpeed,cfg.climbSpeed);
      this.isFlying=true;
    } else {
      this.isFlying=!this.isGrounded;
      super._updateVerticalVelocity(delta);
      if (!this.isGrounded) this.verticalVelocity=Math.max(-cfg.climbSpeed,this.verticalVelocity);
    }
  }

  onDamaged(info) {
    // Being shot reveals where the shooter is, to us and to squadmates nearby
    const shooter = info && info.source;
    if (shooter && shooter.position) {
      this._dodgeRequested=true;
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

  /**
   * Lost track of its enemies: forgets them and wanders off to patrol round `point`.
   */
  wanderOff(point) {
    if (this.isDead) return;
    this.perception.forget();
    this.home.copy(point);
    this.brain.change('investigate'); // Leave the current state cleanly...
    this.brain.change('patrol');      // ...and amble off to the new patrol ground
  }

  /**
   * Order to push towards `point` (e.g. the beach) and hold there, fighting anything seen on the way.
   */
  assault(point) {
    if (this.isDead) return;
    this.home.copy(point);
    this.perception.share(point);
    this.brain.change('investigate');
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
    this._updateTactics(delta);
    this.updateAttack(delta);
  }

  /** React to incoming damage and circle visible opponents while keeping attacks aimed. */
  _updateTactics(delta) {
    const cfg=config.alienTactics,target=this.perception.target;
    this._dodgeCooldown=Math.max(0,this._dodgeCooldown-delta);
    this._tacticalTimer-=delta;this._tacticalActive-=delta;
    if (!target || !this.brain.is('engage') || this.isBoss ||
      (this.attackPhase && this.attackPhase!=='approach')) return;
    const dx=target.position.x-this.position.x,dz=target.position.z-this.position.z;
    const distance=Math.hypot(dx,dz);
    if (distance<cfg.meleeDistance) return;
    if (this._tacticalActive<=0 && (this._tacticalTimer<=0 || (this._dodgeRequested && this._dodgeCooldown<=0))) {
      this._dodging=this._dodgeRequested && this._dodgeCooldown<=0;
      this._dodgeRequested=false;
      const step=this._dodging ? cfg.dodgeDistance : cfg.strafeDistance;
      let found=false;
      for (const side of [this._tacticalSide,-this._tacticalSide]) {
        this._tacticalPoint.set(this.position.x+dz/distance*step*side,this.position.y,this.position.z-dx/distance*step*side);
        if (!this.physicsWorld.isLineClear(this.position,this._tacticalPoint)) continue;
        if (!this.model.canFly) {
          Object.assign(this._tacticalRay.origin,{x:this._tacticalPoint.x,y:this.position.y+cfg.probeHeight,z:this._tacticalPoint.z});
          const floor=this.physicsWorld.castRay(this._tacticalRay,cfg.probeHeight+cfg.maxDrop,true,this.physicsWorld.RAPIER.QueryFilterFlags.ONLY_FIXED);
          if (!floor) continue; // Never dodge off a roof, ledge or into the sea.
        }
        this._tacticalSide=-side;found=true;break;
      }
      this._tacticalTimer=cfg.repositionSeconds;
      if (!found) return;
      this._tacticalActive=this._dodging ? cfg.dodgeSeconds : cfg.strafeSeconds;
      if (this._dodging) this._dodgeCooldown=cfg.dodgeCooldown;
    }
    if (this._tacticalActive>0) {
      this.moveTo(this._tacticalPoint,this.cfg.runSpeed*(this._dodging ? cfg.dodgeSpeedMultiplier : 1));
      this.lookAt(target.position);
    }
  }

  /**
   * Subclass weapon logic, run every frame after the brain.
   */
  updateAttack(delta) { }
}

const SHARED_STATES = {
  patrol: {
    enter(a) {
      a.clearLook();
      a._patrolWait = 0;
      a._pickPatrolPoint = true;
    },
    update(a, delta) {
      if (a.perception.target) return 'engage';
      if (a.perception.hasLastKnown) return 'investigate';

      if (a._pickPatrolPoint) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * PATROL_RADIUS;
        a.moveTo(a._point.set(a.home.x + Math.cos(angle) * radius, a.home.y, a.home.z + Math.sin(angle) * radius), a.cfg.walkSpeed);
        a._pickPatrolPoint = false;
      } else if (a.hasArrived()) {
        a._patrolWait += delta;
        if (a._patrolWait >= PATROL_WAIT_SECONDS) {
          a._patrolWait = 0;
          a._pickPatrolPoint = true;
        }
      }
      return null;
    }
  },

  investigate: {
    enter(a) {
      a.clearLook();
      a.moveTo(a.perception.lastKnownPosition, a.cfg.runSpeed);
    },
    update(a) {
      if (a.perception.target) return 'engage';
      if (a.hasArrived()) return 'search';
      return null;
    }
  },

  search: {
    enter(a) {
      a.moveTo(a.perception.lastKnownPosition, a.cfg.walkSpeed * 1.5);
      a._searchTime = 0;
    },
    update(a, delta) {
      if (a.perception.target) return 'engage';
      if (a.hasArrived()) {
        // Look around while waiting
        a._searchTime += delta;
        a.lookAt(a._point.set(a.position.x + Math.sin(a._searchTime * 1.5) * 5, a.position.y, a.position.z + Math.cos(a._searchTime * 1.5) * 5));
        if (a._searchTime >= a.cfg.searchSeconds) {
          a.perception.forget();
          return 'patrol';
        }
      }
      return null;
    }
  }
};
