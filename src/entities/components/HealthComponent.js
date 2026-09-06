/**
 * Damage types
 */
export const DamageType = Object.freeze({
  KINETIC: 'KINETIC',
  EXPLOSIVE: 'EXPLOSIVE'
});

/**
 * Damage information payload.
 */
export class DamageInfo {
  constructor(amount = 0, type = DamageType.KINETIC, source = null) {
    if (typeof amount === 'object' && amount !== null) {
      const opts = amount;
      this.amount = Math.max(0, opts.amount || 0);
      this.type = opts.type === DamageType.EXPLOSIVE ? DamageType.EXPLOSIVE : DamageType.KINETIC;
      this.source = opts.source || null;
    } else {
      this.amount = Math.max(0, amount);
      this.type = type === DamageType.EXPLOSIVE ? DamageType.EXPLOSIVE : DamageType.KINETIC;
      this.source = source;
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
    this.onDamage = null;
    this.onDeath = null;
  }

  takeDamage(damage) {
    if (this.isDead) return 0;

    const info = (damage instanceof DamageInfo)
      ? damage
      : (typeof damage === 'number'
        ? new DamageInfo(damage)
        : new DamageInfo(damage?.amount, damage?.type, damage?.source));

    const appliedDamage = Math.min(this.currentHealth, info.amount);
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

  reset() {
    this.currentHealth = this.maxHealth;
    this.isDead = false;
  }
}
