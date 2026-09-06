/**
 * BaseEntity
 * Abstract foundation and lifecycle contract for all dynamic game actors in ScopeCreep.
 *
 * THE ENTITY PHASE CONTRACT:
 * Rather than putting all logic into an unordered update() loop, entities implement
 * explicit lifecycle phases to prevent 1-frame kinematic lag, jitter, and tunneling:
 *
 * - Phase 2: prePhysicsUpdate(delta, gameWorld)
 *   Implement this if you move the ground beneath someone's feet (e.g. Battleship,
 *   elevators, moving platforms, buoyant hulls). Kinematic transforms must be set
 *   BEFORE the Rapier physics world steps.
 *
 * - Phase 4: postPhysicsUpdate(delta, gameWorld)
 *   Implement this if you are a character, walking actor, or dynamic body that sweeps
 *   against moving surfaces. Sweeps run AFTER platforms have moved and physics has stepped.
 *
 * - Phase 5: gameplayUpdate(delta, gameWorld)
 *   Implement this for gameplay logic, weapon cooldowns, projectile raycasts, ballistics,
 *   damage application, and AI state machines.
 *
 * - Phase 6: lateUpdate(delta, gameWorld)
 *   Implement this for cameras, spring-arm obstacle raycasting, reticle positioning,
 *   and visual smoothing AFTER all actors have finished moving.
 */
export class BaseEntity {
  constructor(name = 'Entity') {
    this.name = name;
    this.isEntity = true;
    this.mesh = null;
  }

  /**
   * Phase 2 (Pre-Physics): Move platforms and set Rapier transforms BEFORE physics steps.
   * @param {number} delta - Frame delta time in seconds
   * @param {GameWorld} gameWorld - Master world context
   */
  prePhysicsUpdate(delta, gameWorld) { }

  /**
   * Phase 4 (Post-Physics): Sweep characters and resolve movement against updated platforms.
   * @param {number} delta - Frame delta time in seconds
   * @param {GameWorld} gameWorld - Master world context
   */
  postPhysicsUpdate(delta, gameWorld) { }

  /**
   * Phase 5 (Gameplay): Weapons, projectiles, ballistics, damage, and timers.
   * @param {number} delta - Frame delta time in seconds
   * @param {GameWorld} gameWorld - Master world context
   */
  gameplayUpdate(delta, gameWorld) { }

  /**
   * Phase 6 (Late Update): Cameras, spring-arms, HUD reticles, and visual smoothing.
   * @param {number} delta - Frame delta time in seconds
   * @param {GameWorld} gameWorld - Master world context
   */
  lateUpdate(delta, gameWorld) { }

  /**
   * Free all Three.js geometries, materials, and Rapier rigid bodies/colliders.
   */
  dispose() {
    if (this.mesh) {
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
    }
  }
}