import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

/**
 * PhysicsWorld
 * Encapsulates the Rapier3D physics engine, integration step,
 * and collider factory helpers (Trimesh, Box, Kinematic Character Controller).
 */
export class PhysicsWorld {
  constructor() {
    this.RAPIER = RAPIER;
    this.world = null;
    this.isInitialized = false;
    this.gravity = { x: 0.0, y: -24.0, z: 0.0 };
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
    // Step simulation (Rapier default timestep is 1/60)
    this.world.step();
  }

  /**
   * Creates a static ground collider
   */
  createGround(size = 1000) {
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed();
    const groundBody = this.world.createRigidBody(groundBodyDesc);
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(size / 2, 0.5, size / 2)
      .setTranslation(0, -0.5, 0);
    return this.world.createCollider(groundColliderDesc, groundBody);
  }

  /**
   * Creates a Kinematic Character Controller
   * Handles auto-stepping over ledges/curbs, slope sliding, and collision movement.
   */
  createCharacterController(options = {}) {
    const offset = options.offset !== undefined ? options.offset : 0.02;
    const controller = this.world.createCharacterController(offset);

    // Auto-step over stairs and curbs up to 0.4m tall, with min width 0.2m
    controller.enableAutostep(0.4, 0.2, true);

    // Max climbable slope: 50 degrees (smooth ramp and stairs climbing)
    controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);

    // Slide down slopes steeper than 50 degrees (prevents flat/seam sliding)
    controller.setMinSlopeSlideAngle((50 * Math.PI) / 180);

    // Snap to ground to prevent hopping when descending slopes
    controller.enableSnapToGround(0.3);

    return controller;
  }

  /**
   * Creates static box colliders
   */
  createBox(halfX, halfY, halfZ, posX = 0, posY = 0, posZ = 0, rotY = 0) {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(posX, posY, posZ)
      .setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) });
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ);
    return this.world.createCollider(colliderDesc, body);
  }

  /**
   * Creates TriMesh colliders from a Three.js Object3D hierarchy
   * Extracts all geometries, transforms them to the root object's local coordinate space,
   * and binds them to a kinematicPositionBased rigid body initialized at object3d's position/quaternion.
   */
  createTrimeshFromObject(object3d) {
    object3d.updateMatrixWorld(true);

    const vertices = [];
    const indices = [];
    let vertexOffset = 0;

    // Inverse of root object's world matrix to convert child vertices into object3d's LOCAL coordinate frame
    const rootInverse = new THREE.Matrix4().copy(object3d.matrixWorld).invert();

    object3d.traverse((child) => {
      // Skip meshes or hierarchies marked as noCollision (e.g. trigger fields, visual markers)
      let curr = child;
      let ignore = false;
      while (curr) {
        if (curr.userData && curr.userData.noCollision) {
          ignore = true;
          break;
        }
        if (curr === object3d) break;
        curr = curr.parent;
      }
      if (ignore) return;

      if (child.isMesh && child.geometry) {
        const geom = child.geometry;
        const positionAttr = geom.getAttribute('position');
        if (!positionAttr) return;

        // Transform vertices to root object's LOCAL space
        const localToRoot = new THREE.Matrix4().multiplyMatrices(rootInverse, child.matrixWorld);

        for (let i = 0; i < positionAttr.count; i++) {
          const v = new THREE.Vector3(
            positionAttr.getX(i),
            positionAttr.getY(i),
            positionAttr.getZ(i)
          );
          v.applyMatrix4(localToRoot);
          vertices.push(v.x, v.y, v.z);
        }

        if (geom.index) {
          const indexAttr = geom.index;
          for (let i = 0; i < indexAttr.count; i++) {
            indices.push(indexAttr.getX(i) + vertexOffset);
          }
        } else {
          for (let i = 0; i < positionAttr.count; i++) {
            indices.push(i + vertexOffset);
          }
        }

        vertexOffset += positionAttr.count;
      }
    });

    if (vertices.length === 0 || indices.length === 0) {
      console.warn('createTrimeshFromObject: No geometry found in object.');
      return null;
    }

    // Kinematic position-based body initialized to object3d's exact world position and orientation
    const bodyDesc = this.RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(object3d.position.x, object3d.position.y, object3d.position.z)
      .setRotation({
        x: object3d.quaternion.x,
        y: object3d.quaternion.y,
        z: object3d.quaternion.z,
        w: object3d.quaternion.w
      });
    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = this.RAPIER.ColliderDesc.trimesh(
      new Float32Array(vertices),
      new Uint32Array(indices)
    );

    const collider = this.world.createCollider(colliderDesc, body);
    collider.debugGeometry = { vertices, indices };
    collider.rigidBody = body;

    return collider;
  }

  /**
   * Creates compound cuboid colliders from a Three.js Object3D hierarchy
   * Converts meshes into RAPIER.ColliderDesc.cuboid() primitives attached
   * to a single kinematicPositionBased rigid body.
   * Completely eliminates internal edge / triangle catching on walking decks and ramps.
   */
  createCompoundCuboidsFromObject(object3d) {
    object3d.updateMatrixWorld(true);

    const rootInverse = new THREE.Matrix4().copy(object3d.matrixWorld).invert();

    const bodyDesc = this.RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(object3d.position.x, object3d.position.y, object3d.position.z)
      .setRotation({
        x: object3d.quaternion.x,
        y: object3d.quaternion.y,
        z: object3d.quaternion.z,
        w: object3d.quaternion.w
      });
    const body = this.world.createRigidBody(bodyDesc);

    const colliders = [];
    const debugBoxes = [];

    object3d.traverse((child) => {
      // Skip meshes or hierarchies marked as noCollision (e.g. trigger fields, visual markers)
      let curr = child;
      let ignore = false;
      while (curr) {
        if (curr.userData && curr.userData.noCollision) {
          ignore = true;
          break;
        }
        if (curr === object3d) break;
        curr = curr.parent;
      }
      if (ignore) return;

      if (child.isMesh && child.geometry) {
        const geom = child.geometry;
        const localToRoot = new THREE.Matrix4().multiplyMatrices(rootInverse, child.matrixWorld);

        let entity = object3d.userData?.entity || null;
        let owner = child;
        while (owner) {
          if (owner.userData?.entity) {
            entity = owner.userData.entity;
            break;
          }
          if (owner === object3d) break;
          owner = owner.parent;
        }

        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        localToRoot.decompose(pos, quat, scale);

        let halfX, halfY, halfZ;
        const centerOffset = new THREE.Vector3(0, 0, 0);

        if (geom.parameters && geom.parameters.width !== undefined) {
          const p = geom.parameters;
          halfX = Math.max(0.05, (p.width * scale.x) / 2);
          halfY = Math.max(0.05, (p.height * scale.y) / 2);
          halfZ = Math.max(0.05, (p.depth * scale.z) / 2);
        } else {
          if (!geom.boundingBox) geom.computeBoundingBox();
          const bbox = geom.boundingBox;
          if (!bbox) return;
          halfX = Math.max(0.05, ((bbox.max.x - bbox.min.x) * scale.x) / 2);
          halfY = Math.max(0.05, ((bbox.max.y - bbox.min.y) * scale.y) / 2);
          halfZ = Math.max(0.05, ((bbox.max.z - bbox.min.z) * scale.z) / 2);
          centerOffset.addVectors(bbox.min, bbox.max).multiplyScalar(0.5);
          centerOffset.applyQuaternion(quat);
        }

        const finalPos = new THREE.Vector3().copy(pos).add(centerOffset);

        const colliderDesc = this.RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
          .setTranslation(finalPos.x, finalPos.y, finalPos.z)
          .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });

        const collider = this.world.createCollider(colliderDesc, body);
        collider.userData = { entity };
        const boxData = {
          halfExtents: new THREE.Vector3(halfX, halfY, halfZ),
          position: finalPos.clone(),
          quaternion: quat.clone()
        };
        collider.debugBox = boxData;
        colliders.push(collider);
        debugBoxes.push(boxData);
      }
    });

    return {
      body,
      rigidBody: body,
      colliders,
      debugBoxes
    };
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
