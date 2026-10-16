import { EnemyJet } from './EnemyJet.js';

/**
 * EnemyJetPool
 * Per-variant pool of enemy jets. Jets are cheap to think but each construction
 * builds a fresh procedural model (new geometries/materials); the pool amortizes
 * that across waves. Spares are built without physics bodies (deferPhysics) and
 * are fully reset on every lease, so a recycled jet is indistinguishable from a
 * fresh one.
 *
 * Ownership: pooled jets are owned by the pool. release() retires them (soft
 * teardown, dispose() no-op while parked); dispose() tears down every jet —
 * leased and spare — on level teardown.
 */
export class EnemyJetPool {
  constructor(gameWorld) {
    this.gameWorld = gameWorld;
    this._available = { fighter: [], ace: [] };
    this._all = new Set();
  }

  /** Pre-build `count` spares of a variant so wave spawning never hitches. */
  ensure(variant, count) {
    const spare = this._available[variant];
    while (spare.length < count) {
      spare.push(this._create(variant));
    }
  }

  /** Count of parked spares for a variant (diagnostics/tests). */
  spareCount(variant) {
    return this._available[variant].length;
  }

  /**
   * Lease a jet: recycles a parked spare when one exists, otherwise builds a
   * new one. The returned jet is reset and ready for gameWorld.addEntity.
   */
  acquire(variant, { position, target, onDestroyed = null, maxHealth } = {}) {
    const spare = this._available[variant];
    const jet = spare.length > 0 ? spare.pop() : this._create(variant);
    jet._resetForLease({ position, target, onDestroyed, maxHealth });
    return jet;
  }

  /** Park a dead jet back into the pool (call after removing it from the world). */
  release(jet) {
    if (!this._all.has(jet)) return;
    jet._retire();
    this._available[jet.variant].push(jet);
  }

  _create(variant) {
    const jet = new EnemyJet(this.gameWorld, { variant, deferPhysics: true });
    jet._retire(); // parked: hidden, no physics, dispose guarded
    this._all.add(jet);
    return jet;
  }

  dispose() {
    for (const jet of this._all) {
      jet._pooled = false;
      jet.dispose();
    }
    this._all.clear();
    this._available.fighter.length = 0;
    this._available.ace.length = 0;
  }
}
