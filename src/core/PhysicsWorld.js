import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

const GRAVITY = { x: 0.0, y: -24.0, z: 0.0 };

/**
 * PhysicsWorld
 * Encapsulates the Rapier3D physics engine, integration step,
 * and collider factory helpers (Trimesh, Kinematic Character Controller, Ground).
 */
export class PhysicsWorld {
  constructor() {
    this.RAPIER = RAPIER;
    this.world = null;
    this.isInitialized = false;
    this.gravity = GRAVITY;
  }

  /**
   * Initialize Rapier WebAssembly engine
   */
  async init() {
    if (this.isInitialized) return;
    await RAPIER.init();
    this.world = new RAPIER.World(this.gravity);
    this.isInitialized = true;
    console.log('Rapier3D Physics Engine Initialized.');
  }

  /**
   * Advance the physics simulation
   * @param {number} delta - Frame time in seconds
   */
  step(delta) {
    if (!this.isInitialized || !this.world) return;
    this.world.step();
  }

  /**
   * Creates a static ground collider
   * @param {number} size - Width and depth in meters
   * @param {number} yPosition - Vertical translation in meters
   */
  createGround(size = 1000, yPosition = -0.5) {
    if (!this.world) return null;
    const groundBodyDesc = this.RAPIER.RigidBodyDesc.fixed();
    const groundBody = this.world.createRigidBody(groundBodyDesc);
    const groundColliderDesc = this.RAPIER.ColliderDesc.cuboid(size / 2, 0.5, size / 2)
      .setTranslation(0, yPosition, 0);
    return this.world.createCollider(groundColliderDesc, groundBody);
  }

  /**
   * Creates a static heightfield collider (terrain) centred on `position`.
   * @param {number} rows - Cells along Z
   * @param {number} cols - Cells along X; `heights` holds (rows + 1) * (cols + 1) samples
   * @param {Float32Array} heights - Column-major samples: index = iz + ix * (rows + 1)
   * @param {number} width - World extent along X, in meters
   * @param {number} depth - World extent along Z, in meters
   * @param {{x: number, y: number, z: number}} [position] - World position of the heightfield centre
   * @returns {RAPIER.Collider|null} Collider with `rigidBody` set; remove it with removeRigidBody(collider.rigidBody)
   */
  createHeightfield(rows, cols, heights, width, depth, position = { x: 0, y: 0, z: 0 }) {
    if (!this.world) return null;
    const body = this.world.createRigidBody(
      this.RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z)
    );
    const colliderDesc = this.RAPIER.ColliderDesc.heightfield(
      rows,
      cols,
      heights,
      { x: width, y: 1.0, z: depth },
      this.RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES
    );
    const collider = this.world.createCollider(colliderDesc, body);
    collider.rigidBody = body;
    return collider;
  }

  /**
   * Creates a Kinematic Character Controller
   * Handles auto-stepping over ledges/curbs, loop cut seams, slope sliding, and collision movement.
   */
  createCharacterController(options = {}) {
    const offset = options.offset !== undefined ? options.offset : 0.01;
    const controller = this.world.createCharacterController(offset);

    // Auto-step over stairs, curbs, and loop cut seams
    // Crucial: minStepWidth 0.0 allows smoothly stepping over loop cuts and internal triangle edges
    const maxStepHeight = options.maxStepHeight !== undefined ? options.maxStepHeight : 0.45;
    const minStepWidth = options.minStepWidth !== undefined ? options.minStepWidth : 0.0;
    controller.enableAutostep(maxStepHeight, minStepWidth, true);

    const maxSlope = options.maxSlope !== undefined ? options.maxSlope : (55 * Math.PI) / 180;
    controller.setMaxSlopeClimbAngle(maxSlope);
    controller.setMinSlopeSlideAngle(maxSlope);

    // Slide normal nudge factor prevents getting wedged in high-density trimesh seams
    const normalNudgeFactor = options.normalNudgeFactor !== undefined ? options.normalNudgeFactor : 0.02;
    controller.setNormalNudgeFactor(normalNudgeFactor);

    // Snap to ground: only enable if explicitly requested (causes trimesh edge seam sticking if enabled globally)
    if (options.snapToGround) {
      const snapDistance = options.snapDistance !== undefined ? options.snapDistance : 0.5;
      controller.enableSnapToGround(snapDistance);
    }

    return controller;
  }

  /**
   * Casts a ray through the physics world and returns the closest hit.
   */
  castRay(ray, maxToi = 100, solid = true, flags, groups, excludeCollider) {
    if (!this.world) return null;
    return this.world.castRay(ray, maxToi, solid, flags, groups, excludeCollider);
  }

  /**
   * True if no fixed collider (walls, rocks, the ground) lies on the straight line from `from`
   * to `to`, both raised by `height`. Characters and other moving bodies are ignored, so this
   * answers "could I walk straight there?".
   * @param {{x: number, y: number, z: number}} from - Feet position
   * @param {{x: number, y: number, z: number}} to - Feet position
   * @param {number} [height=0.9] - Height of the line above both points
   */
  isLineClear(from, to, height = 0.9) {
    if (!this.world) return true;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-3) return true;
    const ray = this._lineRay || (this._lineRay = new this.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
    ray.origin.x = from.x;
    ray.origin.y = from.y + height;
    ray.origin.z = from.z;
    ray.dir.x = dx / length;
    ray.dir.y = dy / length;
    ray.dir.z = dz / length;
    return !this.world.castRay(ray, length, true, this.RAPIER.QueryFilterFlags.ONLY_FIXED);
  }

  /**
   * Casts a ray and returns the impact normal along with the hit info.
   */
  castRayAndGetNormal(ray, maxToi = 100, solid = true, flags, groups, excludeCollider) {
    if (!this.world) return null;
    return this.world.castRayAndGetNormal(ray, maxToi, solid, flags, groups, excludeCollider);
  }

  /**
   * Safely removes a collider from the physics simulation.
   */
  removeCollider(collider, wakeUp = true) {
    if (this.world && collider) {
      this.world.removeCollider(collider, wakeUp);
    }
  }

  /**
   * Safely removes a rigid body from the physics simulation.
   */
  removeRigidBody(rigidBody) {
    if (this.world && rigidBody) {
      this.world.removeRigidBody(rigidBody);
    }
  }

  /**
   * Creates a rigid body in the physics simulation.
   */
  createRigidBody(bodyDesc) {
    if (!this.world || !bodyDesc) return null;
    return this.world.createRigidBody(bodyDesc);
  }

  /**
   * Creates a collider attached to a rigid body in the physics simulation.
   */
  createCollider(colliderDesc, rigidBody) {
    if (!this.world || !colliderDesc || !rigidBody) return null;
    return this.world.createCollider(colliderDesc, rigidBody);
  }

  /**
   * Creates a position-based kinematic rigid body.
   */
  createKinematicRigidBody({ position = { x: 0, y: 0, z: 0 }, rotation = { x: 0, y: 0, z: 0, w: 1 } } = {}) {
    if (!this.world) return null;
    const bodyDesc = this.RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position.x, position.y, position.z)
      .setRotation(rotation);
    return this.world.createRigidBody(bodyDesc);
  }

  /**
   * Creates a fixed (immovable) rigid body.
   */
  createFixedRigidBody({ position = { x: 0, y: 0, z: 0 }, rotation = { x: 0, y: 0, z: 0, w: 1 } } = {}) {
    if (!this.world) return null;
    const bodyDesc = this.RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z)
      .setRotation(rotation);
    return this.world.createRigidBody(bodyDesc);
  }

  /**
   * Creates a static box collider on its own fixed body (steps, ramps, walls, cover props).
   * @param {{x: number, y: number, z: number}} halfExtents - Half size along the box's local axes
   * @param {{x: number, y: number, z: number}} position - World centre
   * @param {{x: number, y: number, z: number, w: number}} [rotation] - World rotation quaternion
   * @returns {RAPIER.Collider|null} Collider with `rigidBody` set; remove it with removeRigidBody(collider.rigidBody)
   */
  createStaticBox(halfExtents, position, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    if (!this.world) return null;
    const colliderDesc = this.RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
    return this._createStaticCollider(colliderDesc, position, rotation);
  }

  /**
   * Creates a static upright cylinder collider on its own fixed body (tree trunks, posts, pillars).
   * @param {number} halfHeight - Half the cylinder's height along its local Y axis
   * @param {number} radius
   * @param {{x: number, y: number, z: number}} position - World centre
   * @param {{x: number, y: number, z: number, w: number}} [rotation] - World rotation quaternion
   * @returns {RAPIER.Collider|null} Collider with `rigidBody` set; remove it with removeRigidBody(collider.rigidBody)
   */
  createStaticCylinder(halfHeight, radius, position, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    if (!this.world) return null;
    const colliderDesc = this.RAPIER.ColliderDesc.cylinder(halfHeight, radius);
    return this._createStaticCollider(colliderDesc, position, rotation);
  }

  /**
   * Creates a static ball collider on its own fixed body (domes, force fields).
   * @param {number} radius
   * @param {{x: number, y: number, z: number}} position - World centre
   * @returns {RAPIER.Collider|null} Collider with `rigidBody` set; remove it with removeRigidBody(collider.rigidBody)
   */
  createStaticBall(radius, position) {
    if (!this.world) return null;
    const colliderDesc = this.RAPIER.ColliderDesc.ball(radius);
    return this._createStaticCollider(colliderDesc, position, { x: 0, y: 0, z: 0, w: 1 });
  }

  /**
   * Creates a static convex-hull collider on its own fixed body (rocks, boulders, debris).
   * @param {Float32Array} points - Hull points in the body's local frame, as x, y, z triples
   * @param {{x: number, y: number, z: number}} position - World position of the local origin
   * @param {{x: number, y: number, z: number, w: number}} [rotation] - World rotation quaternion
   * @returns {RAPIER.Collider|null} Collider with `rigidBody` set; remove it with removeRigidBody(collider.rigidBody)
   */
  createStaticConvexHull(points, position, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    if (!this.world) return null;
    const colliderDesc = this.RAPIER.ColliderDesc.convexHull(points);
    if (!colliderDesc) return null;
    return this._createStaticCollider(colliderDesc, position, rotation);
  }

  _createStaticCollider(colliderDesc, position, rotation) {
    const body = this.createFixedRigidBody({ position, rotation });
    if (!body) return null;
    const collider = this.world.createCollider(colliderDesc, body);
    collider.rigidBody = body;
    return collider;
  }

  /**
   * Creates a TriMesh collider from raw vertex and index arrays and attaches it to a rigid body.
   * @param {Float32Array|number[]} vertices
   * @param {Uint32Array|number[]} indices
   * @param {RAPIER.RigidBody} rigidBody
   * @returns {RAPIER.Collider|null}
   */
  createTrimeshCollider(vertices, indices, rigidBody) {
    if (!this.world || !rigidBody || !vertices || !indices) return null;
    const vArray = vertices instanceof Float32Array ? vertices : new Float32Array(vertices);
    const iArray = indices instanceof Uint32Array ? indices : new Uint32Array(indices);

    const colliderDesc = this.RAPIER.ColliderDesc.trimesh(vArray, iArray);
    const collider = this.world.createCollider(colliderDesc, rigidBody);
    collider.debugGeometry = { vertices: vArray, indices: iArray };
    collider.rigidBody = rigidBody;
    return collider;
  }

  /**
   * Returns or creates the Three.js LineSegments mesh for Rapier physics debug lines
   */
  getDebugMesh() {
    if (!this.debugMesh) {
      const geometry = new THREE.BufferGeometry();
      const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthTest: false
      });
      this.debugMesh = new THREE.LineSegments(geometry, material);
      this.debugMesh.name = 'Rapier_Physics_Debug_Lines';
      this.debugMesh.renderOrder = 9999;
      this.debugMesh.frustumCulled = false;
      this.debugMesh.visible = false;
      this.debugMesh.userData = { noCollision: true };
    }
    return this.debugMesh;
  }

  /**
   * Set visibility of physics debug visualization
   */
  setDebugVisible(visible) {
    const mesh = this.getDebugMesh();
    mesh.visible = visible;
    if (visible) {
      this.updateDebug();
    }
  }

  /**
   * Toggles visibility of physics debug visualization
   */
  toggleDebug() {
    const mesh = this.getDebugMesh();
    this.setDebugVisible(!mesh.visible);
    return mesh.visible;
  }

  /**
   * Updates debug lines from Rapier world for EVERY collider in the scene.
   * Boosts line colors for vibrant high-contrast visibility against water, sky, and ship decks.
   * Manages BufferGeometry allocations safely to eliminate WebGL buffer resize errors.
   */
  updateDebug() {
    if (!this.world || !this.debugMesh || !this.debugMesh.visible) return;

    const { vertices, colors } = this.world.debugRender();
    if (!vertices || vertices.length === 0) {
      if (this.debugMesh.geometry) {
        this.debugMesh.geometry.dispose();
        this.debugMesh.geometry = new THREE.BufferGeometry();
      }
      return;
    }

    // Boost vertex colors so lines are vibrant and clearly visible
    const boostedColors = new Float32Array(colors.length);
    for (let i = 0; i < colors.length; i += 4) {
      const r = colors[i];
      const g = colors[i + 1];
      const b = colors[i + 2];

      // Kinematic colliders (Rapier default: dim dark green ~0.2)
      // Boost to electric neon lime green (#1aff66)
      if (g > 0.05 && r < 0.15 && b < 0.15) {
        boostedColors[i] = 0.1;
        boostedColors[i + 1] = 1.0;
        boostedColors[i + 2] = 0.4;
        boostedColors[i + 3] = 1.0;
      }
      // Static colliders (Rapier default: dim dark red ~0.5)
      // Boost to vibrant electric magenta / pink (#ff3377)
      else if (r > 0.2 && g < 0.15 && b < 0.15) {
        boostedColors[i] = 1.0;
        boostedColors[i + 1] = 0.2;
        boostedColors[i + 2] = 0.55;
        boostedColors[i + 3] = 1.0;
      }
      // Dynamic colliders, sensors, or contacts
      else {
        const maxVal = Math.max(r, g, b, 0.001);
        const scale = Math.min(2.5, 0.95 / maxVal);
        boostedColors[i] = Math.min(1.0, r * scale);
        boostedColors[i + 1] = Math.min(1.0, g * scale);
        boostedColors[i + 2] = Math.min(1.0, b * scale);
        boostedColors[i + 3] = 1.0;
      }
    }

    const currentGeom = this.debugMesh.geometry;
    if (
      currentGeom &&
      currentGeom.attributes.position &&
      currentGeom.attributes.position.array.length === vertices.length
    ) {
      currentGeom.attributes.position.copyArray(vertices);
      currentGeom.attributes.position.needsUpdate = true;
      currentGeom.attributes.color.copyArray(boostedColors);
      currentGeom.attributes.color.needsUpdate = true;
    } else {
      if (currentGeom) {
        currentGeom.dispose();
      }
      const newGeom = new THREE.BufferGeometry();
      newGeom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      newGeom.setAttribute('color', new THREE.BufferAttribute(boostedColors, 4));
      this.debugMesh.geometry = newGeom;
    }
  }

  /**
   * Free physics world resources
   */
  dispose() {
    if (this.debugMesh) {
      if (this.debugMesh.parent) {
        this.debugMesh.parent.remove(this.debugMesh);
      }
      if (this.debugMesh.geometry) this.debugMesh.geometry.dispose();
      if (this.debugMesh.material) this.debugMesh.material.dispose();
      this.debugMesh = null;
    }

    if (this.world) {
      this.world.free();
      this.world = null;
      this.isInitialized = false;
    }
  }
}
