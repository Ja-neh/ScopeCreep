import * as THREE from 'three';
import { BaseEntity } from '../BaseEntity.js';
import { Projectile } from './Projectile.js';
import { DamageType } from '../components/HealthComponent.js';
import config from '../../config.json';

/**
 * ProjectilePool
 * High-performance, zero-allocation object pool for high-frequency ballistics (Flak & Artillery).
 * Pre-allocates meshes and handles continuous collision detection in gameplayUpdate (Phase 5).
 */
export class ProjectilePool extends BaseEntity {
  constructor(gameWorld, options = {}) {
    super('ProjectilePool');
    this.gameWorld = gameWorld;

    // Capacities from config
    const projConfig = config.projectiles;
    this.flakCapacity = options.flakCapacity || projConfig.flak.capacity;
    this.artilleryCapacity = options.artilleryCapacity || projConfig.artillery.capacity;

    // Root Three.js container
    this.mesh = new THREE.Group();
    this.mesh.name = 'ProjectilePool_Container';

    // Separate pools for different projectile types
    this.flakPool = [];
    this.artilleryPool = [];
    this.activeProjectiles = [];

    // Math scratchpads for spread calculation
    this._spreadDir = new THREE.Vector3();
    this._spreadUp = new THREE.Vector3();
    this._spreadRight = new THREE.Vector3();

    this._onHit = this._onHit.bind(this);

    // Initialize pools
    this._initPools();

    // Attach to GameWorld's dedicated projectiles group
    if (this.gameWorld && this.gameWorld.projectilesGroup) {
      this.gameWorld.projectilesGroup.add(this.mesh);
    }
  }

  /**
   * Pre-allocates all projectile geometries, materials, and instances upfront.
   */
  _initPools() {
    const RAPIER = this.gameWorld?.physics?.RAPIER || null;

    // -------------------------------------------------------------
    // 1. FLAK TRACERS (High-speed, glowing orange/gold kinetic tracer)
    // -------------------------------------------------------------
    // Cylinder pointing along -Z
    const flakGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.5, 6);
    flakGeo.rotateX(Math.PI / 2);

    const flakMat = new THREE.MeshBasicMaterial({
      color: 0xffb703,
      toneMapped: false
    });

    for (let i = 0; i < this.flakCapacity; i++) {
      const mesh = new THREE.Mesh(flakGeo, flakMat);
      mesh.name = `FlakTracer_${i}`;
      mesh.visible = false;
      mesh.position.set(0, -9999, 0);
      this.mesh.add(mesh);

      const p = new Projectile(mesh, 'FLAK', RAPIER);
      this.flakPool.push(p);
    }

    // -------------------------------------------------------------
    // 2. ARTILLERY SHELLS (Heavy metallic shell with glowing tracer)
    // -------------------------------------------------------------
    const shellGroupGeo = new THREE.Group();
    const shellBodyGeo = new THREE.CylinderGeometry(0.24, 0.24, 1.4, 8);
    shellBodyGeo.rotateX(Math.PI / 2);
    const shellNoseGeo = new THREE.ConeGeometry(0.24, 0.6, 8);
    shellNoseGeo.rotateX(-Math.PI / 2);

    const shellMat = new THREE.MeshStandardMaterial({
      color: 0x3d4a58,
      metalness: 0.8,
      roughness: 0.3,
      flatShading: true
    });

    const shellTracerMat = new THREE.MeshBasicMaterial({
      color: 0xfb8500,
      toneMapped: false
    });

    // Reusable merged/grouped shell mesh template
    for (let i = 0; i < this.artilleryCapacity; i++) {
      const shellMesh = new THREE.Group();
      shellMesh.name = `ArtilleryShell_${i}`;

      const body = new THREE.Mesh(shellBodyGeo, shellMat);
      const nose = new THREE.Mesh(shellNoseGeo, shellMat);
      nose.position.z = -1.0;

      // Base tracer glow disc
      const tracerGeo = new THREE.CircleGeometry(0.2, 8);
      const tracer = new THREE.Mesh(tracerGeo, shellTracerMat);
      tracer.position.z = 0.71;

      shellMesh.add(body);
      shellMesh.add(nose);
      shellMesh.add(tracer);

      shellMesh.visible = false;
      shellMesh.position.set(0, -9999, 0);
      this.mesh.add(shellMesh);

      const p = new Projectile(shellMesh, 'ARTILLERY', RAPIER);
      this.artilleryPool.push(p);
    }

    console.log(`ProjectilePool: Initialized with ${this.flakCapacity} Flak and ${this.artilleryCapacity} Artillery.`);
  }

  /**
   * Fires a high-velocity flak tracer round.
   */
  fireFlak({
    origin,
    direction,
    spread,
    speed,
    source = null,
    excludeCollider = null
  } = {}) {
    const flakCfg = config.projectiles.flak;
    const finalSpeed = speed !== undefined ? speed : flakCfg.speed;
    const finalSpread = spread !== undefined ? spread : flakCfg.spread;

    let p = this.flakPool.pop();

    // If pool empty, recycle oldest active flak projectile
    if (!p) {
      for (let i = 0; i < this.activeProjectiles.length; i++) {
        if (this.activeProjectiles[i].type === 'FLAK') {
          p = this.activeProjectiles.splice(i, 1)[0];
          break;
        }
      }
    }

    if (!p) return null;

    // Apply angular cone spread
    this._spreadDir.copy(direction).normalize();
    if (finalSpread > 0) {
      const angle = (Math.random() - 0.5) * finalSpread * 2;
      const angle2 = (Math.random() - 0.5) * finalSpread * 2;
      this._spreadRight.set(-this._spreadDir.z, 0, this._spreadDir.x).normalize();
      this._spreadUp.crossVectors(this._spreadDir, this._spreadRight).normalize();
      this._spreadDir.addScaledVector(this._spreadRight, angle);
      this._spreadDir.addScaledVector(this._spreadUp, angle2);
      this._spreadDir.normalize();
    }

    p.spawn({
      origin,
      direction: this._spreadDir,
      speed: finalSpeed,
      gravity: flakCfg.gravity,
      drag: flakCfg.drag,
      maxLifeTime: flakCfg.maxLifeTime,
      damage: flakCfg.damage,
      damageType: DamageType.KINETIC,
      source,
      excludeCollider
    });

    this.activeProjectiles.push(p);
    return p;
  }

  /**
   * Fires a heavy explosive naval artillery shell.
   */
  fireArtillery({
    origin,
    direction,
    speed,
    source = null,
    excludeCollider = null
  } = {}) {
    const artCfg = config.projectiles.artillery;
    const finalSpeed = speed !== undefined ? speed : artCfg.speed;

    let p = this.artilleryPool.pop();

    // If pool empty, recycle oldest active artillery projectile
    if (!p) {
      for (let i = 0; i < this.activeProjectiles.length; i++) {
        if (this.activeProjectiles[i].type === 'ARTILLERY') {
          p = this.activeProjectiles.splice(i, 1)[0];
          break;
        }
      }
    }

    if (!p) return null;

    p.spawn({
      origin,
      direction,
      speed: finalSpeed,
      gravity: artCfg.gravity,
      drag: artCfg.drag,
      maxLifeTime: artCfg.maxLifeTime,
      damage: artCfg.damage,
      damageType: DamageType.EXPLOSIVE,
      source,
      excludeCollider
    });

    this.activeProjectiles.push(p);
    return p;
  }

  /**
   * Internal hit resolver: applies damage to target entity if it possesses a HealthComponent.
   */
  _onHit(hit) {
    // Apply damage to entity registered on the collider or target object
    if (hit.collider) {
      let targetEntity = hit.collider.parent?.userData?.entity || hit.collider.userData?.entity;

      // Fallback search across GameWorld entities if collider belongs to a known actor
      if (!targetEntity && this.gameWorld && this.gameWorld.entities) {
        for (const entity of this.gameWorld.entities) {
          if (entity.colliders && Array.isArray(entity.colliders) && entity.colliders.includes(hit.collider)) {
            targetEntity = entity;
            break;
          }
          if (entity.mesh && hit.collider.parent === entity.mesh) {
            targetEntity = entity;
            break;
          }
        }
      }

      if (targetEntity && targetEntity.health && typeof targetEntity.health.takeDamage === 'function') {
        const dealt = targetEntity.health.takeDamage(hit.damageInfo);
        console.log(`Projectile Hit: ${targetEntity.name} took ${dealt} ${hit.damageInfo.type} damage.`);
      }
    }
  }

  /**
   * Phase 5 Lifecycle Hook: Updates all active projectiles and VFX.
   */
  gameplayUpdate(delta, gameWorld) {
    const physicsWorld = gameWorld.physics;

    // 1. Update Active Projectiles (Iterate backwards for O(1) swap-and-pop)
    for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
      const p = this.activeProjectiles[i];
      const isAlive = p.update(delta, physicsWorld, this._onHit);

      if (!isAlive) {
        // Recycle back to appropriate pool
        if (p.type === 'FLAK') {
          this.flakPool.push(p);
        } else {
          this.artilleryPool.push(p);
        }

        // O(1) removal
        const lastIdx = this.activeProjectiles.length - 1;
        if (i !== lastIdx) {
          this.activeProjectiles[i] = this.activeProjectiles[lastIdx];
        }
        this.activeProjectiles.pop();
      }
    }
  }

  /**
   * GPU and resource cleanup
   */
  dispose() {
    for (const p of this.flakPool) {
      if (p.mesh && p.mesh.geometry) p.mesh.geometry.dispose();
      if (p.mesh && p.mesh.material) p.mesh.material.dispose();
    }
    for (const p of this.artilleryPool) {
      if (p.mesh) {
        p.mesh.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      }
    }
    this.flakPool = [];
    this.artilleryPool = [];
    this.activeProjectiles = [];

    super.dispose();
  }
}
