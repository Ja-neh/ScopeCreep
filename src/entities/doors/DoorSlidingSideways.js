import { BaseSlidingDoor } from './BaseSlidingDoor.js';

const MODEL_URL = './assets/Door-sliding-sideways.glb';
const FALLBACK_URL = '/assets/Door-sliding-sideways.glb';

/**
 * DoorSlidingSideways
 * Controller entity for `Door-sliding-sideways.glb`.
 * Features a single panel that slides horizontally along Z into the adjacent wall.
 * Automatically detects player/NPCs via DETECT-Door-Sliding-Sideways.
 */
export class DoorSlidingSideways extends BaseSlidingDoor {
  constructor(gameWorld = null, options = {}) {
    super(gameWorld, {
      name: 'DoorSlidingSideways',
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
 * Convenience loader to asynchronously load and instantiate a DoorSlidingSideways.
 * @param {GameWorld} [gameWorld]
 * @param {Object} [options]
 * @returns {Promise<DoorSlidingSideways>}
 */
export async function loadDoorSlidingSideways(gameWorld = null, options = {}) {
  const door = new DoorSlidingSideways(gameWorld, options);
  await door.ready;
  return door;
}
