import { BaseSlidingDoor } from './BaseSlidingDoor.js';

const MODEL_URL = './assets/Big-door-sliding-up.glb';
const FALLBACK_URL = '/assets/Big-door-sliding-up.glb';

/**
 * BigDoorSlidingUp
 * Controller entity for `Big-door-sliding-up.glb`.
 * Features a large blast panel (width ~4.5m) that slides vertically upward along Y.
 * Automatically detects player/NPCs via DETECT-Door-Big-Sliding-Up.
 */
export class BigDoorSlidingUp extends BaseSlidingDoor {
  constructor(gameWorld = null, options = {}) {
    super(gameWorld, {
      name: 'BigDoorSlidingUp',
      modelUrl: options.modelUrl || MODEL_URL,
      fallbackUrl: options.fallbackUrl || FALLBACK_URL,
      openSpeed: options.openSpeed !== undefined ? options.openSpeed : 2.0,
      closeSpeed: options.closeSpeed !== undefined ? options.closeSpeed : 1.5,
      closeDelay: options.closeDelay !== undefined ? options.closeDelay : 1.2,
      autoOpen: options.autoOpen !== undefined ? options.autoOpen : true,
      isLocked: options.isLocked !== undefined ? options.isLocked : false,
      position: options.position,
      rotation: options.rotation,
      ...options
    });
  }
}

/**
 * Convenience loader to asynchronously load and instantiate a BigDoorSlidingUp.
 * @param {GameWorld} [gameWorld]
 * @param {Object} [options]
 * @returns {Promise<BigDoorSlidingUp>}
 */
export async function loadBigDoorSlidingUp(gameWorld = null, options = {}) {
  const door = new BigDoorSlidingUp(gameWorld, options);
  await door.ready;
  return door;
}
