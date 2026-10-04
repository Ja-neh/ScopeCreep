import * as THREE from 'three';
import { GroundCombatant } from '../GroundCombatant.js';
import { Perception } from '../../ai/Perception.js';
import { StateMachine } from '../../ai/StateMachine.js';

const PATROL_RADIUS = 15;
const PATROL_WAIT_SECONDS = 2.5;

/**
 * AlienCombatant
 * What every alien ground unit shares: perception, squad call-outs, hearing, assault orders,
 * and the patrol, investigate and search states. Subclasses supply the `engage` state
 * (how they fight) and updateAttack(delta) (their weapon).
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
   */
  constructor(gameWorld, { name, position, squad, cfg, model, engageState, capsule }) {
    super(gameWorld, { name, position, faction: 'aliens', maxHealth: cfg.maxHealth, model, capsule });
    this.cfg = cfg;
    this.squad = squad;
    this.home = position.clone();
    this.perception = new Perception(this, cfg);

    this._patrolWait = 0;
    this._pickPatrolPoint = true;
    this._searchTime = 0;
    this._point = new THREE.Vector3();

    this.brain = new StateMachine(this, { ...SHARED_STATES, engage: engageState }, 'patrol');
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
    this.updateAttack(delta);
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
