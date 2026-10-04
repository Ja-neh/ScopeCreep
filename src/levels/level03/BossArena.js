import * as THREE from 'three';
import { AlienWarden } from '../../entities/enemies/AlienWarden.js';
import { ShieldCrystal } from './ShieldCrystal.js';
import config from '../../config.json';

// Which of the hall's pillars grow shield crystals (VillageHall.pillars: the left row from the
// back to the door, then the right row)
const FIRST_CRYSTALS = [0, 3];    // The back pillars, either side of the dais
const ENRAGED_CRYSTALS = [2, 5];  // The front pillars, by the door
const CRYSTAL_HEIGHT = 3.2;       // Above the pillar's base
const CRYSTAL_INSET = 1.3;        // Out from the pillar towards the middle of the hall
const GUARD_DISTANCE = 6;         // The Warden holds the floor this far in front of its dais
const ADD_SPREAD = 4;             // Troopers come in through the door this far apart...
const ADD_DISTANCE = 14;          // ...running in from the square, this far out

/**
 * BossArena
 * The fight with the Warden in the village hall (Level 3).
 * - place(): the Warden stands, dormant, in front of its dais (from the start of the level).
 * - start(): it wakes with its shield up, fed by two crystals on the back pillars. Shoot both
 *   crystals and the shield drops.
 * - Below `enrageFraction` health it is enraged: the shield comes back, fed by two crystals on the
 *   front pillars, and `enrageAdds` troopers come in through the door.
 * - When it falls, `defeated` is set and onDefeated() is called.
 * Shows the boss health bar. The level calls update() in Phase 5 and dispose() when done.
 */
export class BossArena {
  /**
   * @param {IslandLevel} level - Supplies the GameWorld, the player, the alien squad and createAlien()
   * @param {VillageHall} hall
   * @param {Object} [options]
   * @param {() => void} [options.onDefeated]
   * @param {Object} [options.cfg] - Overrides config.enemies.warden
   */
  constructor(level, hall, { onDefeated = null, cfg = config.enemies.warden } = {}) {
    this.level = level;
    this.gameWorld = level.gameWorld;
    this.hall = hall;
    this.cfg = cfg;
    this.onDefeated = onDefeated;

    this.warden = null;
    this.crystals = [];
    this.adds = [];
    this.started = false;
    this.defeated = false;
    this.shieldDrops = 0; // Times the player has brought the shield down
  }

  /** The Warden, dormant, in front of its dais, facing the door (once). */
  place() {
    if (this.warden) return this.warden;
    const hall = this.hall;
    const guard = new THREE.Vector3().copy(hall.dais).addScaledVector(hall.forward, GUARD_DISTANCE);
    guard.y = hall.centre.y + 0.3;
    this.warden = new AlienWarden(this.gameWorld, { position: guard, squad: this.level.squad, guardPoint: guard, cfg: this.cfg });
    this.warden.yaw = Math.atan2(-hall.forward.x, -hall.forward.z); // Facing the door
    this.level.squad.add(this.warden);
    return this.warden;
  }

  /** Wakes the Warden and starts the fight. */
  start() {
    if (this.started) return;
    this.started = true;
    this.place();
    this._raiseShield(FIRST_CRYSTALS);
    this.warden.awaken(this.level.player.position);

    const ui = this.gameWorld.ui;
    if (ui) {
      ui.showBossHealth(this.warden.displayName);
      ui.updateBossHealth(this.warden.health.currentHealth, this.warden.health.maxHealth, true);
      ui.showToast('THE WARDEN awakens! Shoot the crystals on the pillars to break its shield.', 'danger', 4500);
    }
  }

  /** The crystals still standing. */
  get crystalsLeft() {
    return this.crystals.filter((crystal) => !crystal.isDead).length;
  }

  /**
   * Phase 5: drops the shield when its crystals are gone, enrages the Warden at half health,
   * updates the boss bar, and notices the end.
   */
  update() {
    if (!this.started || this.defeated) return;
    const warden = this.warden;
    const ui = this.gameWorld.ui;

    if (warden.shielded && this.crystalsLeft === 0) {
      warden.setShielded(false);
      this.shieldDrops++;
      if (ui) ui.showToast('The shield is down! Hit the Warden now!', 'success', 3000);
    }

    if (!warden.enraged && !warden.isDead && warden.health.currentHealth <= warden.health.maxHealth * this.cfg.enrageFraction) {
      warden.enrage();
      this._raiseShield(ENRAGED_CRYSTALS);
      this._callAdds();
      if (ui) ui.showToast('The Warden is enraged! New crystals by the door, and more aliens coming in!', 'danger', 4000);
    }

    if (ui) ui.updateBossHealth(warden.health.currentHealth, warden.health.maxHealth, warden.shielded);

    if (warden.isDead) {
      this.defeated = true;
      for (const crystal of this.crystals) crystal.health.takeDamage({ amount: crystal.health.maxHealth });
      if (ui) {
        ui.hideBossHealth();
        ui.showToast('The Warden is down!', 'success', 3500);
      }
      if (this.onDefeated) this.onDefeated();
    }
  }

  /** Grows crystals on the given pillars and raises the Warden's shield. */
  _raiseShield(pillarIndices) {
    const hall = this.hall;
    for (const index of pillarIndices) {
      const pillar = hall.pillars[index];
      // Out from the pillar, across the hall towards its middle line
      const across = new THREE.Vector3(hall.centre.x - pillar.x, 0, hall.centre.z - pillar.z);
      across.addScaledVector(hall.forward, -across.dot(hall.forward)).normalize();
      const position = new THREE.Vector3(pillar.x, pillar.y + CRYSTAL_HEIGHT, pillar.z).addScaledVector(across, CRYSTAL_INSET);
      const crystal = new ShieldCrystal(this.gameWorld, { position, health: this.cfg.crystalHealth, linkedTo: this.warden });
      this.gameWorld.addEntity(crystal);
      this.crystals.push(crystal);
    }
    this.warden.setShielded(true);
  }

  /** Troopers run in through the hall door after the player. */
  _callAdds() {
    const hall = this.hall;
    const across = new THREE.Vector3(hall.forward.z, 0, -hall.forward.x);
    for (let i = 0; i < this.cfg.enrageAdds; i++) {
      const offset = (i - (this.cfg.enrageAdds - 1) / 2) * ADD_SPREAD;
      const x = hall.entrance.x + across.x * offset + hall.forward.x * ADD_DISTANCE;
      const z = hall.entrance.z + across.z * offset + hall.forward.z * ADD_DISTANCE;
      const trooper = this.level.createAlien('trooper', x, z);
      trooper.assault(this.level.player.position);
      this.adds.push(trooper);
    }
  }

  dispose() {
    for (const crystal of this.crystals) this.gameWorld.removeEntity(crystal);
    this.crystals = [];
    this.adds = [];
    if (this.gameWorld.ui && this.started && !this.defeated) this.gameWorld.ui.hideBossHealth();
    if (this.warden && this.level.squad) this.level.squad.remove(this.warden); // If the squad still has it
    this.warden = null;
  }
}
