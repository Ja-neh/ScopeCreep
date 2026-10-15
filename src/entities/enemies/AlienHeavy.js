import { AlienBrute } from './AlienBrute.js';
import { AlienModel } from '../models/AlienModel.js';
import config from '../../config.json';

const HEAVY_SCALE = 1.6;
const HEAVY_CAPSULE = { radius: 0.72, halfHeight: 0.9 }; // Over three meters of walker

/**
 * AlienHeavy
 * The gate's own brute: a walker built half a size over the rank-and-file, in darker armour
 * with a crest. The same charge-and-slam fighting style (and the same glowing power pack
 * weak spot), but slower to put down and harder when it lands.
 * Balance values come from config.json (`enemies.heavy`).
 */
export class AlienHeavy extends AlienBrute {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {THREE.Vector3} options.position
   * @param {AlienSquad} options.squad
   * @param {Object} [options.cfg] - Overrides config.enemies.heavy
   */
  constructor(gameWorld, { position, squad, cfg = config.enemies.heavy }) {
    super(gameWorld, {
      position,
      squad,
      cfg,
      name: 'AlienHeavy',
      model: new AlienModel({ armorColor: 0x4c3355, scale: HEAVY_SCALE, backpack: true, crest: true }),
      capsule: HEAVY_CAPSULE
    });

    this.displayName = 'THE GATE WALKER';
    this.isBoss = true; // The finale's own: announced with its bar, never part of the rank and file
  }
}
