import * as THREE from 'three';

/**
 * PlayerModel
 * Procedural low-poly humanoid mesh and collider debug wireframe.
 * Handles avatar mesh generation, shadows, visibility states, and resource disposal.
 */
export class PlayerModel {
  /**
   * @param {number} radius - Capsule radius in meters
   * @param {number} halfHeight - Capsule half-height in meters
   * @param {number} capsuleCenter - Vertical offset from base to capsule center
   */
  constructor(radius = 0.45, halfHeight = 0.55, capsuleCenter = 1.0) {
    this.capsuleRadius = radius;
    this.capsuleHalfHeight = halfHeight;
    this.capsuleCenter = capsuleCenter;

    this.mesh = new THREE.Group();
    this.mesh.name = 'HumanCharacter';

    // Sub-meshes
    this.bodyMesh = null;
    this.visorMesh = null;
    this.packMesh = null;
    this.colliderDebugGroup = null;

    this._createAvatarMesh();
    this._createColliderDebugMesh();
  }

  /**
   * Builds the low-poly stylized humanoid avatar
   */
  _createAvatarMesh() {
    // 1. Capsule Body
    const capsuleGeo = new THREE.CapsuleGeometry(
      this.capsuleRadius,
      this.capsuleHalfHeight * 2,
      4,
      12
    );
    const capsuleMat = new THREE.MeshStandardMaterial({
      color: 0x2a9d8f, // Stylized Narrow One teal
      roughness: 0.6,
      metalness: 0.1,
      flatShading: true
    });
    this.bodyMesh = new THREE.Mesh(capsuleGeo, capsuleMat);
    this.bodyMesh.position.y = this.capsuleCenter;
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.mesh.add(this.bodyMesh);

    // 2. Helmet Visor - placed on -Z side (Natural Forward Direction)
    const visorGeo = new THREE.BoxGeometry(0.55, 0.22, 0.35);
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0xe76f51,
      roughness: 0.3,
      metalness: 0.5,
      flatShading: true
    });
    this.visorMesh = new THREE.Mesh(visorGeo, visorMat);
    this.visorMesh.position.set(0, 1.6, -0.42);
    this.visorMesh.castShadow = true;
    this.mesh.add(this.visorMesh);

    // 3. Backpack / Gear harness - placed on +Z side (Back of character)
    const packGeo = new THREE.BoxGeometry(0.55, 0.65, 0.22);
    const packMat = new THREE.MeshStandardMaterial({
      color: 0x264653,
      roughness: 0.8,
      flatShading: true
    });
    this.packMesh = new THREE.Mesh(packGeo, packMat);
    this.packMesh.position.set(0, 1.15, 0.42);
    this.packMesh.castShadow = true;
    this.mesh.add(this.packMesh);
  }

  /**
   * Builds the neon cyan capsule wireframe & translucent surface for collider debug
   */
  _createColliderDebugMesh() {
    this.colliderDebugGroup = new THREE.Group();
    this.colliderDebugGroup.name = 'Character_Collider_Debug';
    this.colliderDebugGroup.userData = { noCollision: true };

    const length = this.capsuleHalfHeight * 2;
    const capsuleGeo = new THREE.CapsuleGeometry(this.capsuleRadius, length, 8, 16);

    const surfaceMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const wireframeMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4,
      wireframe: true,
      transparent: true,
      opacity: 0.95
    });

    const surfMesh = new THREE.Mesh(capsuleGeo, surfaceMat);
    surfMesh.position.set(0, this.capsuleCenter, 0);
    surfMesh.userData = { noCollision: true };
    this.colliderDebugGroup.add(surfMesh);

    const wireMesh = new THREE.Mesh(capsuleGeo, wireframeMat);
    wireMesh.position.set(0, this.capsuleCenter, 0);
    wireMesh.userData = { noCollision: true };
    this.colliderDebugGroup.add(wireMesh);

    this.colliderDebugGroup.visible = false;
    this.mesh.add(this.colliderDebugGroup);
  }

  /**
   * Toggles avatar visibility for 1st-person mode or camera proximity occlusion
   */
  setFirstPerson(isFirstPerson) {
    const visible = !isFirstPerson;
    if (this.bodyMesh) this.bodyMesh.visible = visible;
    if (this.visorMesh) this.visorMesh.visible = visible;
    if (this.packMesh) this.packMesh.visible = visible;
  }

  /**
   * Squashes the avatar towards the ground for crouching, keeping its feet in place.
   * The collider debug capsule is left at full size.
   * @param {number} amount - 0 standing, 1 fully crouched
   */
  setCrouchAmount(amount) {
    const squash = 1 - 0.35 * amount;
    this.bodyMesh.scale.y = squash;
    this.bodyMesh.position.y = this.capsuleCenter * squash;
    this.visorMesh.position.y = 1.6 * squash;
    this.packMesh.position.y = 1.15 * squash;
  }

  /**
   * Toggles whole avatar mesh visibility (e.g. when mounting a vehicle/turret)
   */
  setVisible(visible) {
    this.mesh.visible = visible;
  }

  /**
   * Toggles visibility of collider debug wireframe
   */
  setColliderDebugVisible(visible) {
    if (this.colliderDebugGroup) {
      this.colliderDebugGroup.visible = visible;
    }
  }

  /**
   * Clean up all geometries and materials
   */
  dispose() {
    this.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
  }
}
