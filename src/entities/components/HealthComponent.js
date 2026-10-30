/**
 * Damage types
 */
export const DamageType = Object.freeze({
  KINETIC: 'KINETIC',
  EXPLOSIVE: 'EXPLOSIVE'
});

/**
 * Damage information payload.
 * `direction` (unit vector the blow travelled along) and `point` (world-space impact point)
 * are optional: physics juice (ragdoll kick, decals) reads them when a producer can supply them.
 */
export class DamageInfo {
  constructor(amount = 0, type = DamageType.KINETIC, source = null) {
    if (typeof amount === 'object' && amount !== null) {
      const opts = amount;
      this.amount = Math.max(0, opts.amount || 0);
      this.type = opts.type === DamageType.EXPLOSIVE ? DamageType.EXPLOSIVE : DamageType.KINETIC;
      this.source = opts.source || null;
      this.direction = opts.direction || null;
      this.point = opts.point || null;
      this.fraction = Math.max(0, opts.fraction || 0);
    } else {
      this.amount = Math.max(0, amount);
      this.type = type === DamageType.EXPLOSIVE ? DamageType.EXPLOSIVE : DamageType.KINETIC;
      this.source = source;
      this.direction = null;
      this.point = null;
      this.fraction = 0;
    }
  }
}

/**
 * Health tracking component.
 */
export class HealthComponent {
  constructor(maxHealth = 100) {
    this.maxHealth = Math.max(1, maxHealth);
    this.currentHealth = this.maxHealth;
    this.isDead = false;
    this.invulnerable = false; // Shielded: damage does nothing while set
    this.damageMultiplier = 1;
    this.absorb = null;        // Optional (amount) => amount left over: a shield that takes hits first
    this._absorbers = new Set(); // Independent temporary powers can coexist with the pickup shield.
    this.onDamage = null;
    this.onDeath = null;
  }

  takeDamage(damage) {
    if (this.isDead || this.invulnerable) return 0;

    const info = (damage instanceof DamageInfo)
      ? damage
      : (typeof damage === 'number'
        ? new DamageInfo(damage)
        : new DamageInfo(damage || {}));

    const amount=info.fraction ? this.maxHealth*info.fraction : info.amount*this.damageMultiplier;
    let incoming = this.absorb ? this.absorb(amount) : amount;
    for (const absorb of this._absorbers) incoming=absorb(incoming);
    const appliedDamage = Math.min(this.currentHealth, incoming);
    this.currentHealth -= appliedDamage;

    if (this.onDamage && appliedDamage > 0) {
      this.onDamage(info, appliedDamage);
    }

    if (this.currentHealth <= 0) {
      this.currentHealth = 0;
      this.isDead = true;
      if (this.onDeath) {
        this.onDeath(info);
      }
    }

    return appliedDamage;
  }

  heal(amount = 0) {
    if (this.isDead || amount <= 0) return 0;

    const prevHealth = this.currentHealth;
    this.currentHealth = Math.min(this.maxHealth, this.currentHealth + amount);
    return this.currentHealth - prevHealth;
  }

  addAbsorber(absorb) {
    this._absorbers.add(absorb);
    return () => this._absorbers.delete(absorb);
  }

  reset() {
    this.currentHealth = this.maxHealth;
    this.isDead = false;
  }

  /**
   * Back up after being downed, with `amount` health (at least 1, at most max).
   * @param {number} [amount]
   */
  revive(amount = this.maxHealth) {
    this.isDead = false;
    this.currentHealth = Math.max(1, Math.min(this.maxHealth, amount));
  }
}
