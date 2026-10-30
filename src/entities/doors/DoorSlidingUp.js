import { BaseSlidingDoor } from './BaseSlidingDoor.js';

const MODEL_URL = './assets/Door-sliding-up.glb';
const FALLBACK_URL = '/assets/Door-sliding-up.glb';

/**
 * DoorSlidingUp
 * Controller entity for `Door-sliding-up.glb`.
 * Features a single panel that slides vertically upward along Y into the ceiling lintel.
 * Automatically detects player/NPCs via DETECT-Door-Sliding-Up.
 */
export class DoorSlidingUp extends BaseSlidingDoor {
  constructor(gameWorld = null, options = {}) {
    super(gameWorld, {
      name: 'DoorSlidingUp',
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
 * Convenience loader to asynchronously load and instantiate a DoorSlidingUp.
 * @param {GameWorld} [gameWorld]
 * @param {Object} [options]
 * @returns {Promise<DoorSlidingUp>}
 */
export async function loadDoorSlidingUp(gameWorld = null, options = {}) {
  const door = new DoorSlidingUp(gameWorld, options);
  await door.ready;
  return door;
}
