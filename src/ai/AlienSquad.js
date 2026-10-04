/**
 * AlienSquad
 * Owns a group of AI combatants: registers them with the GameWorld, gives them their targets
 * and a cover provider, passes on squad call-outs ("enemy there!") and gunshot noise, and removes
 * the dead once their bodies have lain for a few seconds. Updated by its level in Phase 5.
 */
export class AlienSquad {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {Array} options.targets - Entities the squad fights (e.g. the player and squadmates)
   * @param {{findCover: Function}} [options.cover] - Provides findCover(from, threat, out, minRange, maxRange)
   * @param {number} options.alertRadius - Call-outs reach squadmates within this many meters
   * @param {number} options.corpseSeconds - How long the dead lie before removal
   */
  constructor(gameWorld, { targets, cover = null, alertRadius, corpseSeconds }) {
    this.gameWorld = gameWorld;
    this.targets = targets;
    this.cover = cover;
    this.alertRadius = alertRadius;
    this.corpseSeconds = corpseSeconds;
    this.members = [];
    this.killCount = 0;
  }

  add(member) {
    member.squad = this;
    this.members.push(member);
    this.gameWorld.addEntity(member);
    return member;
  }

  /** Takes a member out of the squad and the world (alive or not). */
  remove(member) {
    const index = this.members.indexOf(member);
    if (index < 0) return;
    this.members.splice(index, 1);
    this.gameWorld.removeEntity(member);
  }

  get aliveCount() {
    let count = 0;
    for (const member of this.members) if (!member.isDead) count++;
    return count;
  }

  /**
   * A member spotted (or was shot by) an enemy at `position`: squadmates nearby learn it too.
   */
  callOut(caller, position) {
    for (const member of this.members) {
      if (member === caller || member.isDead) continue;
      if (member.position.distanceTo(caller.position) <= this.alertRadius) {
        member.perception.share(position);
        if (member.brain.is('patrol')) member.brain.change('investigate');
      }
    }
  }

  /**
   * A gunshot at `position`; members within their hearing range react.
   */
  reportNoise(position) {
    for (const member of this.members) member.hearNoise(position);
  }

  findCover(from, threat, out, minRange, maxRange) {
    return this.cover ? this.cover.findCover(from, threat, out, minRange, maxRange) : false;
  }

  /**
   * Phase 5: counts kills and clears away bodies.
   */
  update() {
    for (let i = this.members.length - 1; i >= 0; i--) {
      const member = this.members[i];
      if (!member.isDead) continue;
      if (!member._counted) {
        member._counted = true;
        this.killCount++;
      }
      if (member.deathTime >= this.corpseSeconds) {
        this.members.splice(i, 1);
        this.gameWorld.removeEntity(member);
      }
    }
  }

  dispose() {
    for (const member of this.members) this.gameWorld.removeEntity(member);
    this.members = [];
  }
}
