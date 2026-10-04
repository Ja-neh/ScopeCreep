import * as THREE from 'three';
import { BaseEntity } from '../../entities/BaseEntity.js';
import { SoldierModel } from '../../entities/models/SoldierModel.js';
import config from '../../config.json';

const RADIUS = 1.1;          // Cage size
const HEIGHT = 2.6;
const BARS = 10;
const OPEN_SECONDS = 1.0;    // The bars sink into the floor this fast
const PROMPT_COLOR = '#2ec4b6';
const COLORS = { base: 0x2c3036, bar: 0x6dff8f, villager: 0x8a7458, shirt: 0x6b5a7a, hair: 0x2a1f18 };

/**
 * HostageCage
 * An alien cage of glowing bars on a dark ring, with one of the islanders inside (a soldier figure
 * in plain clothes, unarmed, arms hanging). While `locked` (the Warden still lives) it cannot be
 * opened. Then stand beside it and hold [E] (specialAction) for `holdSeconds`: the bars sink into
 * the floor, its collider goes, the islander throws their arms up and onFreed() is called.
 *
 * - Phase 5 (gameplayUpdate): the hold-to-free interaction and its prompt
 * - Phase 6 (lateUpdate): bars sinking, the islander's pose
 * Balance values come from config.json (`levels.level03.hostages`).
 */
export class HostageCage extends BaseEntity {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {string} options.name - The islander's name ("Ama")
   * @param {THREE.Vector3} options.position - Floor point in the middle of the cage
   * @param {number} [options.yaw] - Which way the islander faces
   * @param {Object} options.player - Who frees them (position, health, isDevSuspended)
   * @param {(cage: HostageCage) => void} [options.onFreed]
   * @param {Object} [options.cfg] - Overrides config.levels.level03.hostages
   */
  constructor(gameWorld, { name, position, yaw = 0, player, onFreed = null, cfg = config.levels.level03.hostages }) {
    super(name);
    this.gameWorld = gameWorld;
    this.physicsWorld = gameWorld.physics;
    this.position = position.clone();
    this.player = player;
    this.onFreed = onFreed;
    this.cfg = cfg;
    this.locked = true;
    this.freed = false;
    this.progress = 0;
    this._opening = 0;
    this._time = Math.random() * 10;
    this._promptLabel = null;

    this.mesh = new THREE.Group();
    this.mesh.name = 'HostageCage';
    this.mesh.position.copy(this.position);

    this._baseMaterial = new THREE.MeshStandardMaterial({ color: COLORS.base, flatShading: true });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS + 0.15, RADIUS + 0.25, 0.25, 16), this._baseMaterial);
    ring.position.y = 0.125;
    this.mesh.add(ring);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS * 0.6, RADIUS + 0.15, 0.3, 16), this._baseMaterial);
    cap.position.y = HEIGHT + 0.15;
    this.mesh.add(cap);
    this.cap = cap;

    this._barMaterial = new THREE.MeshBasicMaterial({ color: COLORS.bar, toneMapped: false });
    this.bars = new THREE.Group();
    const barGeometry = new THREE.CylinderGeometry(0.04, 0.04, HEIGHT, 5);
    barGeometry.translate(0, HEIGHT / 2, 0);
    for (let i = 0; i < BARS; i++) {
      const angle = (i / BARS) * Math.PI * 2;
      const bar = new THREE.Mesh(barGeometry, this._barMaterial);
      bar.position.set(Math.sin(angle) * RADIUS, 0, Math.cos(angle) * RADIUS);
      this.bars.add(bar);
    }
    this.mesh.add(this.bars);

    // The islander: a soldier figure in plain clothes, with no gun
    this.villager = new SoldierModel({ suitColor: COLORS.villager, visorColor: COLORS.hair, helmetColor: COLORS.shirt });
    this.villager.gun.visible = false;
    this.villager.mesh.rotation.y = yaw;
    this.villager.mesh.position.y = 0.25;
    this.mesh.add(this.villager.mesh);

    this.collider = this.physicsWorld.createStaticCylinder(HEIGHT / 2, RADIUS + 0.1,
      { x: position.x, y: position.y + HEIGHT / 2, z: position.z });
  }

  /** The Warden is gone: the cage can be opened now. */
  unlock() {
    this.locked = false;
  }

  gameplayUpdate(delta) {
    if (this.freed) return;
    const player = this.player;
    const near = !!player && !(player.health && player.health.isDead) && !player.isDevSuspended &&
      Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z) <= this.cfg.radius;
    if (!near) {
      this.progress = 0;
      this._setPrompt(null);
      return;
    }
    if (this.locked) {
      this._setPrompt('LOCKED: THE WARDEN HOLDS THE KEY');
      return;
    }
    if (this.gameWorld.input.isActionDown('specialAction')) {
      this.progress += delta;
      if (this.progress >= this.cfg.holdSeconds) {
        this.free();
        return;
      }
      const percent = Math.floor((10 * this.progress) / this.cfg.holdSeconds) * 10;
      this._setPrompt(`FREEING ${this.name.toUpperCase()} ${percent}%`);
    } else {
      this.progress = 0;
      this._setPrompt(`HOLD TO FREE ${this.name.toUpperCase()}`);
    }
  }

  /** Opens the cage (once). */
  free() {
    if (this.freed) return;
    this.freed = true;
    this.locked = false;
    this._setPrompt(null);
    if (this.collider) {
      this.physicsWorld.removeRigidBody(this.collider.rigidBody);
      this.collider = null;
    }
    if (this.onFreed) this.onFreed(this);
  }

  _setPrompt(label) {
    if (label === this._promptLabel) return;
    this._promptLabel = label;
    const ui = this.gameWorld.ui;
    if (!ui) return;
    if (label) ui.showPrompt('E', label, PROMPT_COLOR, this);
    else ui.hidePrompt(this);
  }

  lateUpdate(delta) {
    this._time += delta;
    const arms = this.villager.arms;
    if (this.freed) {
      // The bars sink away and the islander cheers
      this._opening = Math.min(1, this._opening + delta / OPEN_SECONDS);
      this.bars.position.y = -HEIGHT * this._opening;
      this.bars.visible = this._opening < 1;
      this.cap.position.y = HEIGHT + 0.15 + this._opening * 0.6;
      const wave = Math.sin(this._time * 8) * 0.3;
      arms[0].rotation.set(-2.7 + wave, 0, -0.2);
      arms[1].rotation.set(-2.7 - wave, 0, 0.2);
      return;
    }
    // Waiting: arms hanging, swaying a little, bars pulsing
    const sway = Math.sin(this._time * 1.3) * 0.08;
    arms[0].rotation.set(sway, 0, -0.1);
    arms[1].rotation.set(-sway, 0, 0.1);
    this.villager.body.rotation.z = sway * 0.3;
    this._barMaterial.color.setHex(COLORS.bar).multiplyScalar(0.75 + 0.25 * Math.sin(this._time * 3));
  }

  dispose() {
    this._setPrompt(null);
    if (this.collider) {
      this.physicsWorld.removeRigidBody(this.collider.rigidBody);
      this.collider = null;
    }
    this.villager.dispose();
    super.dispose(); // Ring, cap and bars (the bars share one geometry and material)
  }
}
