import * as THREE from 'three';

/**
 * BaseStation
 * Abstract foundation for interactive mounted stations on naval vessels (Helm, Artillery, Flak).
 * Encapsulates:
 * - Proximity detection fields with animated deck indicators
 * - Mounting / dismounting transitions with player limbo teleportation (y = -100)
 * - Station camera activation and restoration
 * - DOM prompt display and cleanup
 */
export class BaseStation {
  constructor(options = {}) {
    this.gameWorld = options.gameWorld || null;
    this.battleship = options.battleship || null;
    this.position = options.position || new THREE.Vector3();
    this.stationName = options.name || 'Station';

    // Mounting state
    this.isMounted = false;
    this.currentOperator = null;
    this.mountCooldown = 0;
    this.detectionRadius = options.detectionRadius || 5.0;
    this.localMountPosition = null;
    this._detectWorldPos = new THREE.Vector3();
    this.releasePointerLockOnMount = options.releasePointerLockOnMount ?? false;

    // Scene & UI references (to be populated by subclasses)
    this.mesh = null;
    this.camera = null;
    this.promptEl = null;
    this.hudEl = null;
    this.detectRing = null;
    this.detectDisc = null;
  }

  /**
   * Builds standardized visual proximity disc and pulsing outer ring on the deck.
   * @param {Object} params
   * @param {number} params.radius
   * @param {number} params.color
   * @returns {THREE.Group}
   */
  createDetectField({ radius = 5.0, color = 0x2a9d8f } = {}) {
    const group = new THREE.Group();
    group.name = `${this.stationName}_DetectField`;
    group.position.set(0, 0.05, 0);

    const discGeo = new THREE.CylinderGeometry(radius, radius, 0.04, 32);
    const discMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.15,
      depthWrite: false
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    group.add(disc);
    this.detectDisc = disc;

    const ringGeo = new THREE.RingGeometry(radius * 0.94, radius, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
      depthWrite: false
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.03;
    group.add(ring);
    this.detectRing = ring;

    this.detectFieldGroup = group;
    return group;
  }

  /**
   * Retrieves the vessel root mesh (e.g. Battleship mesh) for local/world coordinate transforms.
   * @returns {THREE.Object3D|null}
   */
  getShipRoot() {
    if (this.battleship && this.battleship.mesh) {
      return this.battleship.mesh;
    }
    if (this.mesh) {
      if (this.mesh.name?.includes('Battleship') || this.mesh.name?.includes('Vessel')) {
        return this.mesh;
      }
      let curr = this.mesh;
      while (curr.parent) {
        if (curr.parent.name?.includes('Battleship') || curr.parent.name?.includes('Vessel')) {
          return curr.parent;
        }
        if (curr.parent.type === 'Scene' || curr.parent.name === 'EntitiesGroup') {
          return curr;
        }
        curr = curr.parent;
      }
      return this.mesh;
    }
    return null;
  }

  /**
   * Mounts the initiating player into this station.
   * @param {Player} player
   * @param {GameWorld} gameWorld
   */
  mount(player, gameWorld = this.gameWorld) {
    if (this.isMounted || !player) return;

    this.currentOperator = player;
    this.isMounted = true;
    this.mountCooldown = 0.35;

    // Save position relative to moving ship root so player returns to deck accurately
    const shipRoot = this.getShipRoot();
    this.localMountPosition = new THREE.Vector3();
    this.localMountPosition.copy(player.position);
    if (shipRoot) {
      shipRoot.updateMatrixWorld(true);
      shipRoot.worldToLocal(this.localMountPosition);
    }

    // Teleport player below world and suspend movement
    player.teleport(player.position.x, -100, player.position.z);
    player.setMounted(true);

    // Release cursor pointer lock if configured
    if (this.releasePointerLockOnMount && document.exitPointerLock) {
      document.exitPointerLock();
    } else if (gameWorld && gameWorld.input && gameWorld.canvas) {
      gameWorld.input.requestPointerLock(gameWorld.canvas);
    }

    // Switch active camera to station camera
    if (gameWorld && this.camera) {
      gameWorld.setActiveCamera(this.camera);
    }

    if (this.promptEl) this.promptEl.style.display = 'none';
    if (this.hudEl) this.hudEl.style.display = 'block';

    this.onMounted(player, gameWorld);
    console.log(`${this.stationName}: Player mounted. Switched to station camera.`);
  }

  /**
   * Dismounts the player and restores them to the vessel deck.
   * @param {GameWorld} gameWorld
   */
  dismount(gameWorld = this.gameWorld) {
    if (!this.isMounted || !this.currentOperator) return;

    const player = this.currentOperator;
    const shipRoot = this.getShipRoot();
    const returnWorldPos = this.localMountPosition
      ? this.localMountPosition.clone()
      : new THREE.Vector3(0, 5.0, 0);

    if (shipRoot) {
      shipRoot.updateMatrixWorld(true);
      shipRoot.localToWorld(returnWorldPos);
    }

    // Safety offset: ensure player capsule drops cleanly onto top of deck
    returnWorldPos.y += 0.15;

    // Restore player to deck
    player.teleport(returnWorldPos.x, returnWorldPos.y, returnWorldPos.z);
    player.setMounted(false);

    // Restore default camera
    if (gameWorld) {
      gameWorld.setActiveCamera(null);
    }

    // Restore pointer lock for player locomotion
    if (gameWorld && gameWorld.input && gameWorld.canvas) {
      gameWorld.input.requestPointerLock(gameWorld.canvas);
    }

    this.isMounted = false;
    this.currentOperator = null;
    this.mountCooldown = 0.25;

    if (this.hudEl) this.hudEl.style.display = 'none';

    this.onDismounted(player, gameWorld);
    console.log(`${this.stationName}: Player dismounted. Returned to deck.`);
  }

  /**
   * Updates mount cooldown timer.
   * Must be called every frame whether mounted or unmounted.
   * @param {number} delta
   */
  updateCooldown(delta) {
    if (this.mountCooldown > 0) {
      this.mountCooldown -= delta;
    }
  }

  /**
   * Subclasses can override to perform station-specific setup on mount.
   */
  onMounted(player, gameWorld) { }

  /**
   * Subclasses can override to perform station-specific teardown on dismount.
   */
  onDismounted(player, gameWorld) { }

  /**
   * Checks for nearby unmounted players and updates prompt visibility.
   * @param {number} delta
   * @param {GameWorld} gameWorld
   * @returns {Player|null}
   */
  checkProximity(delta, gameWorld = this.gameWorld) {
    this.updateCooldown(delta);

    // Pulse visual ring
    if (this.detectRing) {
      const time = Date.now() * 0.003;
      this.detectRing.material.opacity = 0.45 + Math.sin(time * 2) * 0.25;
    }

    if (!gameWorld || !this.detectFieldGroup) return null;

    this.detectFieldGroup.getWorldPosition(this._detectWorldPos);

    let nearbyPlayer = null;
    let minDistance = Infinity;

    if (gameWorld.entities) {
      for (const entity of gameWorld.entities) {
        if (entity && (entity.isPlayer || entity.isCharacterController) && !entity.isMounted) {
          const dist = entity.position.distanceTo(this._detectWorldPos);
          if (dist <= this.detectionRadius && dist < minDistance) {
            minDistance = dist;
            nearbyPlayer = entity;
          }
        }
      }
    }

    if (nearbyPlayer) {
      if (this.promptEl) this.promptEl.style.display = 'block';
      if (this.detectDisc) this.detectDisc.material.opacity = 0.45;

      if (gameWorld.input && gameWorld.input.isActionJustPressed('specialAction') && this.mountCooldown <= 0) {
        this.mount(nearbyPlayer, gameWorld);
      }
    } else {
      if (this.promptEl) this.promptEl.style.display = 'none';
      if (this.detectDisc) this.detectDisc.material.opacity = 0.15;
    }

    return nearbyPlayer;
  }

  /**
   * Clean up DOM elements and meshes.
   */
  dispose() {
    if (this.promptEl && this.promptEl.parentNode) {
      this.promptEl.parentNode.removeChild(this.promptEl);
      this.promptEl = null;
    }
    if (this.hudEl && this.hudEl.parentNode) {
      this.hudEl.parentNode.removeChild(this.hudEl);
      this.hudEl = null;
    }

    if (this.mesh) {
      this.mesh.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
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
}
