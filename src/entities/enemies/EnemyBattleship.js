import * as THREE from 'three';
import { BaseEntity } from '../BaseEntity.js';
import { ArtilleryTurret } from '../ship-components/ArtilleryTurret.js';
import { loadBattleshipModel } from '../models/BattleshipModel.js';
import { HealthComponent } from '../components/HealthComponent.js';
import { BattleshipColliders } from '../ship-components/BattleshipColliders.js';
import { StateMachine } from '../../ai/StateMachine.js';
import config from '../../config.json';

/**
 * Tactical States for Naval Battleship AI
 */
export const BattleshipAIState = {
  PATROL: 'patrol',
  APPROACH: 'approach',
  BROADSIDE: 'broadside',
  REPOSITION: 'reposition',
  SINKING: 'sinking',
  DEAD: 'dead'
};

/**
 * EnemyBattleship
 * AI-controlled heavy warship built from the same 3D model asset as the player battleship,
 * operated by a formal Finite State Machine (StateMachine).
 * 
 * Behavior & Constraints:
 * - FSM Architecture: StateMachine with PATROL, APPROACH, BROADSIDE, REPOSITION, SINKING, DEAD
 * - Armament: Operates only forward and rear dual artillery turrets (MainGunFront & MainGunBack)
 * - Broadside Maneuvering: Positions vessel perpendicular to hostile warship to allow both
 *   forward and rear turrets clear firing arcs
 * - Sinking Behavior: On fatal damage (health <= 0), transitions to SINKING and submerges along Y
 * - Phase 2 (prePhysicsUpdate): Kinematic movement, wave buoyancy, and Rapier collider synchronization
 * - Phase 5 (gameplayUpdate): AI target acquisition, gun mount azimuth & elevation slewing, and ballistics
 */
export class EnemyBattleship extends BaseEntity {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   */
  constructor(gameWorld, options = {}) {
    super('EnemyBattleship');
    this.gameWorld = gameWorld;
    this.position = options.position ? options.position.clone() : new THREE.Vector3(0, 0, -350);
    this.spawnPosition = this.position.clone();
    this.water = options.water || null;
    this.target = options.target || null;
    this.faction = options.faction || 'aliens';

    // Balance parameters from config
    const enemyCfg = config.enemyBattleship || {};
    const healthCfg = enemyCfg.health || { maxHealth: 4000 };
    const moveCfg = enemyCfg.movement || {
      cruisingSpeed: 5.0,
      patrolSpeed: 2.5,
      broadsideSpeed: 3.5,
      turnRate: 0.2,
      stopDistance: 160.0,
      engagementRange: 360.0
    };
    const combatCfg = enemyCfg.combat || {
      aimAccuracy: 0.06,
      fireInterval: 3.0,
      turretTurnSpeed: 0.5,
      turretElevationSpeed: 0.3,
      maxEngagementDistance: 600.0
    };
    const stateCfg = enemyCfg.states || {
      patrolRadius: 250.0,
      detectRange: 550.0,
      broadsideMinDistance: 180.0,
      broadsideMaxDistance: 380.0,
      repositionDistance: 150.0,
      broadsideAngleOffset: 1.48
    };
    const sinkCfg = enemyCfg.sinking || { sinkSpeed: 2.0, maxSinkDepth: -35.0 };

    this.cruisingSpeed = moveCfg.cruisingSpeed;
    this.patrolSpeed = moveCfg.patrolSpeed ?? 2.5;
    this.broadsideSpeed = moveCfg.broadsideSpeed ?? 3.5;
    this.turnRate = moveCfg.turnRate;
    this.stopDistance = moveCfg.stopDistance;
    this.engagementRange = moveCfg.engagementRange;

    this.turretTurnSpeed = combatCfg.turretTurnSpeed;
    this.turretElevationSpeed = combatCfg.turretElevationSpeed;
    this.maxEngagementDistance = combatCfg.maxEngagementDistance;

    this.patrolRadius = stateCfg.patrolRadius;
    this.detectRange = stateCfg.detectRange;
    this.broadsideMinDistance = stateCfg.broadsideMinDistance;
    this.broadsideMaxDistance = stateCfg.broadsideMaxDistance;
    this.repositionDistance = stateCfg.repositionDistance;
    this.broadsideAngleOffset = stateCfg.broadsideAngleOffset ?? 1.48; // ~85 degrees

    this.sinkSpeed = sinkCfg.sinkSpeed;
    this.maxSinkDepth = sinkCfg.maxSinkDepth;

    // Optional island signed-distance field ({ inland(x, z) }, meters inland of the
    // waterline, negative at sea). Supplied by levels with coastal terrain; null in open sea.
    this.island = options.island || null;
    const avoidCfg = ((config.enemyBattleship || {}).assault || {}).avoidance || {};
    this.avoidCoastMargin = avoidCfg.coastMargin ?? 40;
    this.avoidLookAhead = avoidCfg.lookAhead ?? 160;
    this.avoidSampleStep = avoidCfg.sampleStep ?? 20;
    this._tangentSign = 1;

    // Health & Sinking state
    this.health = new HealthComponent(options.maxHealth ?? healthCfg.maxHealth);
    this.isDestroyed = false;
    this.isSinking = false;
    this.currentSpeed = 0;

    this.health.onDeath = () => {
      this.isDestroyed = true;
      this.isSinking = true;
      this.currentSpeed = 0;
      if (this.brain) {
        this.brain.change(BattleshipAIState.SINKING);
      }
      console.log('[EnemyBattleship] Hull destroyed! Sinking initiated.');
    };
    // A hit that finds the hull throws up a cloud of smoke where it landed
    this.health.onDamage = (info) => {
      const fx = this.gameWorld?.projectilePool?.effects;
      if (fx && info && info.point) {
        fx.smokeCloud(info.point, 2.4);
      }
    };

    // Relative operational station coordinates matching imported model
    this.stations = {
      artilleryGunner: new THREE.Vector3(0.46, 5.30, -17.09),     // Fore deck main gun AreaMainGunFront
      artilleryGunnerBack: new THREE.Vector3(0.46, 6.75, -5.82), // Raised fore deck main gun AreaMainGunBack
      flakGunner: new THREE.Vector3(0.46, 5.36, 25.63)           // Aft deck anti-air gun AreaAntiAirGun
    };

    // 1. Root group representing the vessel in Three.js scenegraph
    this.mesh = new THREE.Group();
    this.mesh.name = 'EnemyBattleship';
    this.mesh.position.copy(this.position);
    this.mesh.userData = { entity: this };

    const reloadCadence = options.reloadCadence ?? combatCfg.reloadCadence;
    const damage = options.damage ?? combatCfg.damage;

    // 2. Instantiate Main Artillery Turrets (AI controlled)
    this.mainGun = new ArtilleryTurret({
      name: 'EnemyMainGunFront',
      title: 'ENEMY FORWARD TURRET',
      position: this.stations.artilleryGunner,
      gameWorld: this.gameWorld,
      battleship: this,
      isAI: true,
      reloadCadence,
      damage,
      faction: this.faction
    });
    this.mesh.add(this.mainGun.mesh);

    this.mainGunBack = new ArtilleryTurret({
      name: 'EnemyMainGunBack',
      title: 'ENEMY REAR TURRET',
      position: this.stations.artilleryGunnerBack,
      gameWorld: this.gameWorld,
      battleship: this,
      isAI: true,
      reloadCadence,
      damage,
      faction: this.faction
    });
    this.mesh.add(this.mainGunBack.mesh);

    // 3. Rapier Physics & Colliders Subsystem
    this.colliders = new BattleshipColliders(this);
    this.modelData = null;
    this.physicsWorld = null;
    this._pendingPhysicsWorld = null;

    // Scratchpads for AI calculations (zero heap allocation in update loops)
    this._targetAimPos = new THREE.Vector3();
    this._toTargetVec = new THREE.Vector3();
    this._forwardDir = new THREE.Vector3();
    this._patrolCenter = this.spawnPosition.clone();
    this._patrolAngle = 0;

    // Platform delta kinematics tracking for walking characters (multiplayer-ready)
    this._prevMatrixWorld = new THREE.Matrix4();
    this._currMatrixWorld = new THREE.Matrix4();
    this._invPrevMatrixWorld = new THREE.Matrix4();
    this._hasPrevMatrix = false;
    this._tempPlatformPoint = new THREE.Vector3();

    this.platformHalfWidth = 10.0;
    this.platformHalfLength = 70.0;
    this.platformMinHeight = -1.0;
    this.platformMaxHeight = 12.0;

    // 4. Initialize AI State Machine
    this.brain = new StateMachine(this, this._buildStateHandlers(), options.initialState || BattleshipAIState.APPROACH);

    // Start model load
    this.ready = this.loadModel(options.modelUrl);
  }

  // Backward-compatible physics getters
  get collider() {
    return this.colliders.collider;
  }

  get gunColliders() {
    return this.colliders.gunColliders;
  }

  get currentState() {
    return this.brain ? this.brain.current : null;
  }

  /**
   * Constructs the tactical state handlers for the StateMachine
   */
  _buildStateHandlers() {
    return {
      [BattleshipAIState.PATROL]: {
        enter: (ship) => {
          ship._patrolAngle = ship.mesh.rotation.y;
        },
        update: (ship, delta) => {
          if (ship.isSinking) return BattleshipAIState.SINKING;

          const distToTarget = ship._getDistanceToTarget();
          if (distToTarget !== null && distToTarget <= ship.detectRange) {
            if (distToTarget <= ship.broadsideMaxDistance && distToTarget >= ship.broadsideMinDistance) {
              return BattleshipAIState.BROADSIDE;
            }
            return BattleshipAIState.APPROACH;
          }

          // Gentle circular patrol around spawn
          ship._patrolAngle += 0.05 * delta;
          ship._steerTowardsAngle(ship._patrolAngle, delta);
          ship._applyPropulsion(ship.patrolSpeed, delta);
        }
      },

      [BattleshipAIState.APPROACH]: {
        enter: (ship) => {
          // Approach starts heading towards target
        },
        update: (ship, delta) => {
          if (ship.isSinking) return BattleshipAIState.SINKING;

          const distToTarget = ship._getDistanceToTarget();
          if (distToTarget === null) return BattleshipAIState.PATROL;

          if (distToTarget <= ship.broadsideMaxDistance && distToTarget >= ship.broadsideMinDistance) {
            return BattleshipAIState.BROADSIDE;
          }
          if (distToTarget < ship.repositionDistance) {
            return BattleshipAIState.REPOSITION;
          }

          // Steer directly towards target and cruise at full speed
          const angleToTarget = ship._getAngleToTarget();
          if (angleToTarget !== null) {
            ship._steerWithAvoidance(angleToTarget, delta);
          }
          ship._applyPropulsion(ship.cruisingSpeed, delta);
        }
      },

      [BattleshipAIState.BROADSIDE]: {
        enter: (ship) => {
          // Enter broadside positioning
        },
        update: (ship, delta) => {
          if (ship.isSinking) return BattleshipAIState.SINKING;

          const distToTarget = ship._getDistanceToTarget();
          if (distToTarget === null) return BattleshipAIState.PATROL;

          if (distToTarget > ship.broadsideMaxDistance + 50.0) {
            return BattleshipAIState.APPROACH;
          }
          if (distToTarget < ship.repositionDistance) {
            return BattleshipAIState.REPOSITION;
          }

          // Broadside maneuvering: steer ~85 degrees relative to target vector
          // to present broadside firing arc
          const angleToTarget = ship._getAngleToTarget();
          if (angleToTarget !== null) {
            const broadsideAngle = angleToTarget + ship.broadsideAngleOffset;
            ship._steerWithAvoidance(broadsideAngle, delta);
          }
          ship._applyPropulsion(ship.broadsideSpeed, delta);
        }
      },

      [BattleshipAIState.REPOSITION]: {
        enter: (ship) => {
          // Reposition to open range
        },
        update: (ship, delta) => {
          if (ship.isSinking) return BattleshipAIState.SINKING;

          const distToTarget = ship._getDistanceToTarget();
          if (distToTarget === null) return BattleshipAIState.PATROL;

          if (distToTarget >= ship.broadsideMinDistance + 30.0) {
            return BattleshipAIState.BROADSIDE;
          }

          // Steer away from target to open distance
          const angleToTarget = ship._getAngleToTarget();
          if (angleToTarget !== null) {
            const retreatAngle = angleToTarget + Math.PI;
            ship._steerWithAvoidance(retreatAngle, delta);
          }
          ship._applyPropulsion(ship.cruisingSpeed, delta);
        }
      },

      [BattleshipAIState.SINKING]: {
        enter: (ship) => {
          ship.currentSpeed = 0;
        },
        update: (ship, delta) => {
          if (ship.mesh.position.y > ship.maxSinkDepth) {
            ship.mesh.position.y -= ship.sinkSpeed * delta;
          } else {
            return BattleshipAIState.DEAD;
          }
        }
      },

      [BattleshipAIState.DEAD]: {
        enter: (ship) => {
          ship.currentSpeed = 0;
        },
        update: () => {
          // Inactive, fully submerged
        }
      }
    };
  }

  /**
   * Helper: calculates current angle from vessel to target in world XZ plane
   */
  _getAngleToTarget() {
    const hasTarget = this._getTargetPosition(this._targetAimPos);
    if (!hasTarget) return null;

    this._toTargetVec.subVectors(this._targetAimPos, this.mesh.position);
    this._toTargetVec.y = 0;
    if (this._toTargetVec.lengthSq() < 0.01) return null;

    // Heading convention: forward = (-sin(theta), -cos(theta)) for direction (dx, dz),
    // the same bearing ShipCrewAI steers by.
    return Math.atan2(-this._toTargetVec.x, -this._toTargetVec.z);
  }

  /**
   * Helper: calculates distance from vessel to target
   */
  _getDistanceToTarget() {
    const hasTarget = this._getTargetPosition(this._targetAimPos);
    if (!hasTarget) return null;

    return this.mesh.position.distanceTo(this._targetAimPos);
  }

  /**
   * Helper: smoothly slews vessel heading towards desired angle
   */
  _steerTowardsAngle(targetAngle, delta) {
    const currentAngle = this.mesh.rotation.y;
    let angleDiff = targetAngle - currentAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const turnStep = this.turnRate * delta;
    if (Math.abs(angleDiff) <= turnStep) {
      this.mesh.rotation.y = targetAngle;
    } else {
      this.mesh.rotation.y += Math.sign(angleDiff) * turnStep;
    }
  }

  /**
   * Steers towards a desired heading, detouring around the island when the
   * direct course would run aground: samples the signed-distance field along
   * the intended track; if land lies within the coast margin, follows the
   * shoreline tangent instead until the track clears.
   */
  _steerWithAvoidance(desiredAngle, delta) {
    if (!this.island || !this._pathIsBlocked(desiredAngle)) {
      this._steerTowardsAngle(desiredAngle, delta);
      return;
    }

    // Shore tangent from the SDF gradient (inland increases inlandward).
    const p = this.mesh.position;
    const e = 2.0;
    const gx = (this.island.inland(p.x + e, p.z) - this.island.inland(p.x - e, p.z)) / (2 * e);
    const gz = (this.island.inland(p.x, p.z + e) - this.island.inland(p.x, p.z - e)) / (2 * e);
    const desiredX = -Math.sin(desiredAngle);
    const desiredZ = -Math.cos(desiredAngle);
    const dot = -gz * desiredX + gx * desiredZ;
    // Exact ties (target dead astern) keep the previous side to avoid jitter.
    this._tangentSign = Math.abs(dot) < 1e-6 ? this._tangentSign : (dot > 0 ? 1 : -1);
    // Heading convention: forward = (-sin(theta), -cos(theta)) for direction (dx, dz).
    const tangentAngle = Math.atan2(gz * this._tangentSign, -gx * this._tangentSign);
    this._steerTowardsAngle(tangentAngle, delta);
  }

  /**
   * True when any sample along the intended track sits inside the coast margin.
   */
  _pathIsBlocked(desiredAngle) {
    const p = this.mesh.position;
    const fx = -Math.sin(desiredAngle);
    const fz = -Math.cos(desiredAngle);
    for (let d = this.avoidSampleStep; d <= this.avoidLookAhead; d += this.avoidSampleStep) {
      if (this.island.inland(p.x + fx * d, p.z + fz * d) > -this.avoidCoastMargin) return true;
    }
    return false;
  }

  /**
   * Helper: applies engine propulsion and translates along current heading
   */
  _applyPropulsion(targetSpeed, delta) {
    this.currentSpeed = THREE.MathUtils.lerp(this.currentSpeed, targetSpeed, delta * 1.2);
    this._forwardDir.set(0, 0, -1).applyQuaternion(this.mesh.quaternion);
    const candPos = {
      x: this.mesh.position.x + this._forwardDir.x * this.currentSpeed * delta,
      z: this.mesh.position.z + this._forwardDir.z * this.currentSpeed * delta
    };
    this._resolveShipCollisions(candPos);
    this._resolveGroundPenetration(candPos);
    this.mesh.position.x = candPos.x;
    this.mesh.position.z = candPos.z;
  }

  /**
   * Hard motion guard: projects the candidate position out of the island
   * along the SDF gradient, so a hull can never commit a frame on land even
   * mid-turn or when shoved by another vessel. No-op without an island field.
   * @param {{x: number, z: number}} candPos - Candidate position to adjust in-place
   */
  _resolveGroundPenetration(candPos) {
    if (!this.island) return;
    const p = this.mesh.position;
    for (let iter = 0; iter < 2; iter++) {
      const d = this.island.inland(candPos.x, candPos.z);
      if (d <= -this.avoidCoastMargin) return;
      const e = 2.0;
      const gx = (this.island.inland(candPos.x + e, candPos.z) - this.island.inland(candPos.x - e, candPos.z)) / (2 * e);
      const gz = (this.island.inland(candPos.x, candPos.z + e) - this.island.inland(candPos.x, candPos.z - e)) / (2 * e);
      const glen = Math.hypot(gx, gz);
      if (glen < 1e-6) break;
      const push = d + this.avoidCoastMargin;
      candPos.x -= (gx / glen) * push;
      candPos.z -= (gz / glen) * push;
    }
    if (this.island.inland(candPos.x, candPos.z) > -this.avoidCoastMargin) {
      // Projection failed (degenerate coast): refuse the move; current position is safe.
      candPos.x = p.x;
      candPos.z = p.z;
      this.currentSpeed = 0;
    }
  }

  /**
   * Prevents ship from penetrating into other ships during navigation
   * @param {{x: number, z: number}} candPos - Candidate position to adjust in-place
   */
  _resolveShipCollisions(candPos) {
    if (!this.gameWorld || !this.gameWorld.entities) return;

    const offsets = [-50, -25, 0, 25, 50];
    const circleRadius = 11.0;
    const minSeparation = circleRadius * 2;

    const heading = this.mesh.rotation.y || 0;
    const sinA = Math.sin(heading);
    const cosA = Math.cos(heading);

    let hasCollision = false;
    for (const entity of this.gameWorld.entities) {
      if (!entity || entity === this || !entity.mesh) continue;
      if (entity.name === 'Battleship' || entity.name === 'EnemyBattleship' || entity.colliders) {
        const otherPos = entity.mesh.position;
        const distSq = (candPos.x - otherPos.x) ** 2 + (candPos.z - otherPos.z) ** 2;
        if (distSq > 40000) continue; // Broadphase 200m

        const otherHeading = entity.mesh.rotation.y || 0;
        const sinB = Math.sin(otherHeading);
        const cosB = Math.cos(otherHeading);

        for (const ozA of offsets) {
          const ax = candPos.x - sinA * ozA;
          const az = candPos.z - cosA * ozA;

          for (const ozB of offsets) {
            const bx = otherPos.x - sinB * ozB;
            const bz = otherPos.z - cosB * ozB;

            const dx = ax - bx;
            const dz = az - bz;
            const dist = Math.hypot(dx, dz);

            if (dist < minSeparation && dist > 0.0001) {
              const overlap = minSeparation - dist;
              const nx = dx / dist;
              const nz = dz / dist;
              candPos.x += nx * overlap;
              candPos.z += nz * overlap;
              hasCollision = true;
            }
          }
        }
      }
    }

    if (hasCollision) {
      this.currentSpeed = -Math.abs(this.currentSpeed) * 0.25;
    }
  }

  /**
   * Loads the 3D Battleship model and connects gun meshes to the AI controllers.
   */
  async loadModel(modelUrl) {
    if (this.modelData) return this.modelData;

    try {
      this.modelData = await loadBattleshipModel({ modelUrl });
      this.mesh.add(this.modelData.root);

      // Station offsets from model Areas
      if (this.modelData.stations) {
        if (this.modelData.stations.artilleryGunner) {
          this.stations.artilleryGunner.copy(this.modelData.stations.artilleryGunner);
          this.mainGun.mesh.position.copy(this.stations.artilleryGunner);
        }
        if (this.modelData.stations.artilleryGunner2) {
          this.stations.artilleryGunnerBack.copy(this.modelData.stations.artilleryGunner2);
          this.mainGunBack.mesh.position.copy(this.stations.artilleryGunnerBack);
        }
      }

      // Attach model gun and barrel meshes to turret controllers
      if (this.modelData.guns) {
        if (this.modelData.guns.mainGunFront && this.modelData.guns.mainGunFrontBarrel) {
          this.mainGun.attachTurretNodes(
            this.modelData.guns.mainGunFront,
            this.modelData.guns.mainGunFrontBarrel
          );
        }
        if (this.modelData.guns.mainGunBack && this.modelData.guns.mainGunBackBarrel) {
          this.mainGunBack.attachTurretNodes(
            this.modelData.guns.mainGunBack,
            this.modelData.guns.mainGunBackBarrel
          );
        }
      }

      // If physics initialized before model finished loading, build colliders now
      if (this._pendingPhysicsWorld && !this.colliders.collider) {
        this.colliders.buildColliders(this._pendingPhysicsWorld, this.modelData);
        this._pendingPhysicsWorld = null;
      }

      return this.modelData;
    } catch (err) {
      console.error('[EnemyBattleship] Error loading model:', err);
      throw err;
    }
  }

  /**
   * Initialize Rapier TriMesh physics for hull and rotating guns
   */
  initPhysics(physicsWorld) {
    this.physicsWorld = physicsWorld;
    if (!physicsWorld || !physicsWorld.world) return;

    if (this.modelData) {
      this.colliders.buildColliders(physicsWorld, this.modelData);
    } else {
      this._pendingPhysicsWorld = physicsWorld;
    }
  }

  /**
   * Assigns water surface for wave tracking
   */
  setWater(waterMesh) {
    this.water = waterMesh;
  }

  /**
   * Sets combat target (e.g. player Battleship or Player avatar)
   */
  setTarget(target) {
    this.target = target;
  }

  /**
   * Resolves target world position into scratchpad
   */
  _getTargetPosition(out) {
    if (!this.target) {
      // Auto-acquire player battleship or player
      if (this.gameWorld?.entities) {
        for (const ent of this.gameWorld.entities) {
          if (ent !== this && ent.faction === 'humans' && ent.mesh) {
            this.target = ent;
            break;
          }
        }
      }
    }

    if (this.target && this.target.mesh) {
      this.target.mesh.getWorldPosition(out);
      // Aim slightly above the waterline (center mass)
      out.y += 3.0;
      return true;
    }

    return false;
  }

  /**
   * Checks if a world position is within the walking platform bounds of the battleship
   */
  isPointOnPlatform(worldPos) {
    if (!this.mesh) return false;
    this._tempPlatformPoint.copy(worldPos);
    this.mesh.worldToLocal(this._tempPlatformPoint);
    return (
      Math.abs(this._tempPlatformPoint.x) <= this.platformHalfWidth &&
      Math.abs(this._tempPlatformPoint.z) <= this.platformHalfLength &&
      this._tempPlatformPoint.y >= this.platformMinHeight &&
      this._tempPlatformPoint.y <= this.platformMaxHeight
    );
  }

  /**
   * Computes the exact 6-DOF world displacement of a point caused by ship movement
   */
  getPlatformDisplacement(worldPos, out = new THREE.Vector3()) {
    if (!this._hasPrevMatrix) {
      return out.set(0, 0, 0);
    }
    this._tempPlatformPoint.copy(worldPos).applyMatrix4(this._invPrevMatrixWorld);
    this._tempPlatformPoint.applyMatrix4(this._currMatrixWorld);
    return out.subVectors(this._tempPlatformPoint, worldPos);
  }

  /**
   * Phase 2 (Pre-Physics): Kinematic navigation via StateMachine and Rapier collider synchronization
   */
  prePhysicsUpdate(delta) {
    // 0. Update previous world matrix for platform delta kinematics
    if (!this._hasPrevMatrix) {
      this.mesh.updateMatrixWorld(true);
      this._prevMatrixWorld.copy(this.mesh.matrixWorld);
      this._invPrevMatrixWorld.copy(this._prevMatrixWorld).invert();
      this._hasPrevMatrix = true;
    } else {
      this._prevMatrixWorld.copy(this._currMatrixWorld);
      this._invPrevMatrixWorld.copy(this._prevMatrixWorld).invert();
    }

    // 1. Advance AI State Machine (Navigational Steering & Sinking)
    if (this.brain) {
      this.brain.update(delta);
    }

    // 2. Wave buoyancy tracking (when alive)
    if (!this.isSinking && this.water && typeof this.water.getWaveHeight === 'function') {
      const waveY = this.water.getWaveHeight(this.mesh.position.x, this.mesh.position.z);
      this.mesh.position.y = waveY - 0.5; // Slight draft immersion
    }

    this.mesh.updateMatrixWorld(true);
    this._currMatrixWorld.copy(this.mesh.matrixWorld);

    // 3. Synchronize Rapier kinematic hull rigid body transform BEFORE physics step
    this.colliders.syncRigidBodyTransform();

    // 4. Update Turrets (recoil animation spring-back)
    if (this.mainGun) this.mainGun.update(delta, this.gameWorld);
    if (this.mainGunBack) this.mainGunBack.update(delta, this.gameWorld);

    // 5. Synchronize dynamic rotating gun colliders with Rapier before physics step
    this.colliders.syncGunColliders();
  }

  /**
   * Phase 5 (Gameplay Update): Tactical artillery targeting, azimuth/elevation slew, and firing
   */
  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    if (this.isDestroyed || this.isSinking || this.brain.is(BattleshipAIState.DEAD)) return;

    const hasTarget = this._getTargetPosition(this._targetAimPos);
    if (!hasTarget) return;

    const distToTarget = this.mesh.position.distanceTo(this._targetAimPos);
    if (distToTarget > this.maxEngagementDistance) return;

    // 1. Aim and operate Main Forward Gun
    if (this.mainGun && !this.mainGun.isDestroyed) {
      const aimStatus = this.mainGun.aimTowards(
        this._targetAimPos,
        delta,
        this.turretTurnSpeed,
        this.turretElevationSpeed
      );

      if (aimStatus.onTarget) {
        this.mainGun.fireAI();
      }
    }

    // 2. Aim and operate Main Rear Gun
    if (this.mainGunBack && !this.mainGunBack.isDestroyed) {
      const aimStatus = this.mainGunBack.aimTowards(
        this._targetAimPos,
        delta,
        this.turretTurnSpeed,
        this.turretElevationSpeed
      );

      if (aimStatus.onTarget) {
        this.mainGunBack.fireAI();
      }
    }
  }

  /**
   * Soft-dispose for sunken hulks recycled by the fleet manager.
   * Recovers Rapier colliders and per-turret resources but leaves the model
   * subtree intact: clones share geometry/materials with the cached GLTF
   * and with other live ships, so disposing them here would invalidate
   * GPU resources still in use.
   */
  disposeHulk() {
    if (this._hulkDisposed) return;
    this._hulkDisposed = true;
    this.colliders.dispose();

    if (this.mainGun) {
      this.mainGun.dispose();
      this.mainGun = null;
    }
    if (this.mainGunBack) {
      this.mainGunBack.dispose();
      this.mainGunBack = null;
    }

    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
  }

  dispose() {
    if (this._hulkDisposed) return;
    this.colliders.dispose();

    if (this.mainGun) {
      this.mainGun.dispose();
      this.mainGun = null;
    }
    if (this.mainGunBack) {
      this.mainGunBack.dispose();
      this.mainGunBack = null;
    }

    this.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }

    super.dispose();
  }
}
