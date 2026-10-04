// Shared helpers for the game's Node tests: a stand-in GameWorld (no WebGL, no DOM), scripted
// input, a UI recorder, seeded randomness, and a frame stepper that runs the same 8-phase order
// as GameWorld._loop.
import * as THREE from 'three';
import { PhysicsWorld } from '../../src/core/PhysicsWorld.js';

/**
 * Replaces Math.random with a seeded generator so AI and scatter repeat exactly.
 */
export function seedRandom(seed = 1) {
  let state = seed >>> 0;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The few browser globals game code touches outside rendering.
 * Rapier reads window.performance once a `window` exists, so it must be present.
 */
export function installBrowserGlobals() {
  globalThis.window = globalThis.window || {};
  Object.assign(globalThis.window, {
    innerWidth: 1600,
    innerHeight: 900,
    performance: globalThis.performance,
    addEventListener() {},
    removeEventListener() {}
  });
  globalThis.document = globalThis.document || {
    pointerLockElement: null,
    addEventListener() {},
    removeEventListener() {},
    exitPointerLock() {}
  };
}

/**
 * Scripted input with the InputManager API that entities use.
 */
export function createTestInput() {
  const down = new Set();
  const pressed = new Set();
  return {
    down,
    pressed,
    isPointerLocked: true,
    mouseDelta: { x: 0, y: 0 },
    isActionDown: (action) => down.has(action),
    isActionJustPressed: (action) => pressed.has(action),
    isActionJustReleased: () => false,
    getAxis: (negative, positive) => (down.has(positive) ? 1 : 0) - (down.has(negative) ? 1 : 0),
    hold(action) { down.add(action); },
    release(action) { down.delete(action); },
    press(action) { pressed.add(action); },
    requestPointerLock() {},
    exitPointerLock() {},
    endFrame() {
      pressed.clear();
      this.mouseDelta.x = 0;
      this.mouseDelta.y = 0;
    }
  };
}

/**
 * Records every gameWorld.ui call; read them back with ui.callsTo('name').
 */
export function createUiRecorder() {
  const calls = [];
  return new Proxy({}, {
    get(_, name) {
      if (name === 'calls') return calls;
      if (name === 'callsTo') return (method) => calls.filter((call) => call.name === method);
      return (...args) => { calls.push({ name, args }); };
    }
  });
}

/**
 * A GameWorld stand-in with real Rapier physics and Three.js scene objects.
 */
export async function createTestWorld({ seed = 1 } = {}) {
  installBrowserGlobals();
  seedRandom(seed);
  console.log = () => {}; // Game code logs freely; keep test output readable (warnings still show)

  const physics = new PhysicsWorld();
  await physics.init();

  const scene = new THREE.Scene();
  const group = (name) => {
    const g = new THREE.Group();
    g.name = name;
    scene.add(g);
    return g;
  };

  const world = {
    scene,
    environmentGroup: group('EnvironmentGroup'),
    entitiesGroup: group('EntitiesGroup'),
    projectilesGroup: group('ProjectilesGroup'),
    effectsGroup: group('EffectsGroup'),
    physics,
    input: createTestInput(),
    ui: createUiRecorder(),
    camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000),
    canvas: { addEventListener() {}, removeEventListener() {} },
    entities: new Set(),
    projectilePool: null,
    activeCamera: null,
    restartRequested: false,
    mainMenuRequested: false,

    addEntity(entity) {
      this.entities.add(entity);
      if (entity.mesh) this.entitiesGroup.add(entity.mesh);
    },
    removeEntity(entity) {
      this.entities.delete(entity);
      if (entity.mesh) this.entitiesGroup.remove(entity.mesh);
      if (typeof entity.dispose === 'function') entity.dispose();
    },
    clearEntities() {
      for (const entity of this.entities) {
        if (typeof entity.dispose === 'function') entity.dispose();
      }
      this.entities.clear();
    },
    setActiveCamera(camera) { this.activeCamera = camera; },
    getActiveCamera() { return this.activeCamera || this.camera; },
    restartCurrentLevel() { this.restartRequested = true; },
    returnToMainMenu() { this.mainMenuRequested = true; }
  };
  return world;
}

/**
 * Runs `seconds` of game time in GameWorld._loop's phase order:
 * prePhysics, physics step, postPhysics, level + entity gameplay, lateUpdate, input flush.
 * @param {Object} world - From createTestWorld
 * @param {number} seconds
 * @param {Object} [options]
 * @param {Object} [options.level] - A BaseLevel whose gameplayUpdate runs each frame
 * @param {(frame: number) => (boolean|void)} [options.onFrame] - Return true to stop early
 * @returns {number} Frames run
 */
export function stepWorld(world, seconds, { level = null, onFrame = null, dt = 1 / 60 } = {}) {
  const frames = Math.round(seconds / dt);
  for (let frame = 0; frame < frames; frame++) {
    for (const entity of world.entities) entity.prePhysicsUpdate?.(dt, world);
    world.physics.step(dt);
    for (const entity of world.entities) entity.postPhysicsUpdate?.(dt, world);
    if (level && level.isInitialized) level.gameplayUpdate(dt, world);
    for (const entity of world.entities) entity.gameplayUpdate?.(dt, world);
    for (const entity of world.entities) entity.lateUpdate?.(dt, world);
    const stop = onFrame ? onFrame(frame) : false;
    world.input.endFrame();
    if (stop) return frame + 1;
  }
  return frames;
}

/**
 * Number of rigid bodies left in the physics world (0 after a clean teardown).
 */
export function bodyCount(world) {
  return world.physics.world.bodies.len();
}
