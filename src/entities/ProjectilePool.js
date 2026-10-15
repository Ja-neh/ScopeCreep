import * as THREE from 'three';
import { BaseEntity } from './BaseEntity.js';
import { Projectile } from './projectile-components/Projectile.js';
import { DamageType } from './components/HealthComponent.js';
import { WeaponEffects } from '../weapons/WeaponEffects.js';
import config from '../config.json';

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
    this.plasmaCapacity = options.plasmaCapacity || projConfig.plasma.capacity;

    // Root Three.js container
    this.mesh = new THREE.Group();
    this.mesh.name = 'ProjectilePool_Container';

    // Separate pools for different projectile types
    this.flakPool = [];
    this.artilleryPool = [];
    this.plasmaPool = [];
    this.activeProjectiles = [];
    this._poolsByType = { FLAK: this.flakPool, ARTILLERY: this.artilleryPool, PLASMA: this.plasmaPool };

    // Math scratchpads for spread calculation
    this._spreadDir = new THREE.Vector3();
    this._spreadUp = new THREE.Vector3();
    this._spreadRight = new THREE.Vector3();
    this._blastDir = new THREE.Vector3();

    this._onHit = this._onHit.bind(this);

    // Initialize pools
    this._initPools();

    // Attach to GameWorld's dedicated projectiles group
    if (this.gameWorld && this.gameWorld.projectilesGroup) {
      this.gameWorld.projectilesGroup.add(this.mesh);
    }

    // Artillery detonation VFX: fireballs (flashLight off: no extra permanent light in the scene)
    this.effects = new WeaponEffects((this.gameWorld && this.gameWorld.effectsGroup) || this.mesh, { flashLight: false });
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

    // -------------------------------------------------------------
    // 3. PLASMA BOLTS (alien small arms: slow, glowing green, visible coming in)
    // -------------------------------------------------------------
    const plasmaGeo = new THREE.CapsuleGeometry(0.07, 0.5, 2, 6);
    plasmaGeo.rotateX(Math.PI / 2);
    const plasmaMat = new THREE.MeshBasicMaterial({
      color: 0x6dff8f,
      toneMapped: false
    });

    for (let i = 0; i < this.plasmaCapacity; i++) {
      const mesh = new THREE.Mesh(plasmaGeo, plasmaMat);
      mesh.name = `PlasmaBolt_${i}`;
      mesh.visible = false;
      mesh.position.set(0, -9999, 0);
      this.mesh.add(mesh);

      const p = new Projectile(mesh, 'PLASMA', RAPIER);
      this.plasmaPool.push(p);
    }

    console.log(`ProjectilePool: Initialized with ${this.flakCapacity} Flak, ${this.artilleryCapacity} Artillery and ${this.plasmaCapacity} Plasma.`);
  }

  /**
   * Fires a high-velocity flak tracer round.
   */
  fireFlak({
    origin,
    direction,
    spread,
    speed,
    damage,
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
      damage: damage !== undefined ? damage : flakCfg.damage,
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
    damage,
    source = null,
    excludeCollider = null
  } = {}) {
    const artCfg = config.projectiles.artillery;
    const finalSpeed = speed !== undefined ? speed : artCfg.speed;
    const finalDamage = damage !== undefined ? damage : artCfg.damage;

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
      damage: finalDamage,
      damageType: DamageType.EXPLOSIVE,
      source,
      excludeCollider
    });

    this.activeProjectiles.push(p);
    return p;
  }

  /**
   * Fires an alien plasma bolt: slow enough to see coming, no drop.
   */
  firePlasma({
    origin,
    direction,
    speed,
    damage,
    source = null,
    excludeCollider = null
  } = {}) {
    const plasmaCfg = config.projectiles.plasma;
    const finalSpeed = speed !== undefined ? speed : plasmaCfg.speed;

    let p = this.plasmaPool.pop();

    // If pool empty, recycle oldest active plasma bolt
    if (!p) {
      for (let i = 0; i < this.activeProjectiles.length; i++) {
        if (this.activeProjectiles[i].type === 'PLASMA') {
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
      gravity: plasmaCfg.gravity,
      drag: plasmaCfg.drag,
      maxLifeTime: plasmaCfg.maxLifeTime,
      damage: damage !== undefined ? damage : plasmaCfg.damage,
      damageType: DamageType.KINETIC,
      source,
      excludeCollider
    });

    this.activeProjectiles.push(p);

    if (this.gameWorld && this.gameWorld.audio) this.gameWorld.audio.play('plasma', origin);
    return p;
  }

  /**
   * Internal hit resolver: applies damage to target entity if it possesses a HealthComponent.
   */
  _onHit(hit) {
    // Artillery shells announce their detonation wherever they land (terrain, actors or water)
    if (hit.projectile && hit.projectile.type === 'ARTILLERY' && this.gameWorld && this.gameWorld.audio) {
      this.gameWorld.audio.play('explosion', hit.point);
    }

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

      // No friendly fire: shots from a side never hurt that side (the shell still detonates below)
      const shooter = hit.damageInfo.source;
      const friendly = targetEntity && shooter && shooter.faction && targetEntity.faction === shooter.faction;

      if (!friendly && targetEntity && targetEntity.health && typeof targetEntity.health.takeDamage === 'function') {
        const dealt = targetEntity.health.takeDamage(hit.damageInfo);
        console.log(`Projectile Hit: ${targetEntity.name} took ${dealt} ${hit.damageInfo.type} damage.`);
      }
    }

    // Artillery shells detonate: fireball, scorch mark and a shove for everything nearby
    if (hit.projectile && hit.projectile.type === 'ARTILLERY' && hit.point) {
      this._blast(hit);
    }
  }

  /**
   * Plays an artillery detonation: fireball, a scorch decal on static ground, and a radial
   * shove that tosses ragdolls and staggers anyone still standing. Direct damage already landed.
   */
  _blast(hit) {
    const cfg = config.physicsJuice.explosion;
    const point = hit.point;

    this.effects.blast(point);

    // Scorch only on fixed surfaces: decks and characters move out from under a decal
    const surface = hit.collider && hit.collider.rigidBody;
    if (this.gameWorld.decals && surface && typeof surface.isFixed === 'function' && surface.isFixed() && hit.normal) {
      this.gameWorld.decals.spawn(point, hit.normal, 'scorch');
    }

    if (!this.gameWorld.entities) return;
    for (const entity of this.gameWorld.entities) {
      if (entity === this) continue;
      if (entity.ragdoll) {
        entity.ragdoll.blastFrom(point);
        continue;
      }
      if (typeof entity.applyKnockback !== 'function' || !entity.health || entity.health.isDead) continue;
      const dx = entity.position.x - point.x;
      const dz = entity.position.z - point.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.05 || distance >= cfg.radius) continue;
      const falloff = 1 - distance / cfg.radius;
      this._blastDir.set(dx / distance, 0, dz / distance);
      entity.applyKnockback(this._blastDir, cfg.impulseSpeed * falloff);
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
        this._poolsByType[p.type].push(p);

        // O(1) removal
        const lastIdx = this.activeProjectiles.length - 1;
        if (i !== lastIdx) {
          this.activeProjectiles[i] = this.activeProjectiles[lastIdx];
        }
        this.activeProjectiles.pop();
      }
    }

    // 2. Blast fireballs fade out
    this.effects.update(delta);
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
    for (const p of this.plasmaPool) {
      if (p.mesh && p.mesh.geometry) p.mesh.geometry.dispose();
      if (p.mesh && p.mesh.material) p.mesh.material.dispose();
    }
    this.flakPool = [];
    this.artilleryPool = [];
    this.plasmaPool = [];
    this.activeProjectiles = [];

    if (this.effects) {
      this.effects.dispose();
      this.effects = null;
    }

    super.dispose();
  }
}
