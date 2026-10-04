import * as THREE from 'three';
import { BaseEntity } from '../../entities/BaseEntity.js';
import { consolidateMeshes } from '../../rendering/MeshMerge.js';
import config from '../../config.json';

const CORE_HEIGHT = 4.1; // The core floats over the top of the machine
const COLLIDER = { radius: 1.2, halfHeight: 1.6 };
const PROMPT_COLOR = '#5cf2d6';
const COLORS = {
  metal: 0x3a4048,
  dark: 0x23272d,
  glow: 0x7dffa0,
  dead: 0x2a2d31
};
const _UP = new THREE.Vector3(0, 1, 0);

/**
 * ShieldGenerator
 * An alien machine that feeds the force field over the village hall: a squat base, fins with
 * glowing edges, a spinning core inside a ring, a green light, and a beam of power running up
 * to the top of the dome (so you can follow the beams to find them). Stand next to it and hold
 * [E] (specialAction) for `holdSeconds` to shut it down; let go and the progress drains away
 * again. Shut down, it goes dark, its light and beam die, and onShutDown() is called.
 * Low cover too (a static collider).
 *
 * - Phase 5 (gameplayUpdate): the hold-to-shut-down interaction and its prompt
 * - Phase 6 (lateUpdate): spinning core and ring, flickering beam
 * Balance values come from config.json (`levels.level03.generator`).
 */
export class ShieldGenerator extends BaseEntity {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {string} options.name - Shown in messages ("West generator is down")
   * @param {THREE.Vector3} options.position - Ground point
   * @param {Object} options.player - Who can shut it down (position, health, isDevSuspended)
   * @param {THREE.Vector3} [options.beamTarget] - Where its power goes (the top of the dome)
   * @param {(generator: ShieldGenerator) => void} [options.onShutDown]
   * @param {Object} [options.cfg] - Overrides config.levels.level03.generator
   */
  constructor(gameWorld, { name, position, player, beamTarget = null, onShutDown = null, cfg = config.levels.level03.generator }) {
    super(name);
    this.gameWorld = gameWorld;
    this.physicsWorld = gameWorld.physics;
    this.position = position.clone();
    this.player = player;
    this.onShutDown = onShutDown;
    this.cfg = cfg;
    this.progress = 0;        // Seconds of holding [E] so far
    this.isShutDown = false;
    this._promptLabel = null;
    this._time = Math.random() * 10;

    this.mesh = new THREE.Group();
    this.mesh.name = 'ShieldGenerator';
    this.mesh.position.copy(this.position);
    this._buildModel();

    // Its power, running up to the dome
    this.beam = null;
    if (beamTarget) {
      const from = new THREE.Vector3(0, CORE_HEIGHT, 0);
      const to = beamTarget.clone().sub(this.position);
      const length = to.distanceTo(from);
      const geometry = new THREE.CylinderGeometry(0.3, 0.3, 1, 6, 1, true); // Thick enough to see from across the village
      geometry.translate(0, 0.5, 0);
      this.beam = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: COLORS.glow, transparent: true, opacity: 0.5, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false, fog: false
      }));
      this.beam.position.copy(from);
      this.beam.scale.set(1, length, 1);
      this.beam.quaternion.setFromUnitVectors(_UP, to.sub(from).normalize());
      this.beam.frustumCulled = false;
      this.mesh.add(this.beam);
    }

    this.light = new THREE.PointLight(0x7dffa0, 14, 20, 2);
    this.light.position.set(0, CORE_HEIGHT, 0);
    this.mesh.add(this.light);

    this.collider = this.physicsWorld.createStaticCylinder(COLLIDER.halfHeight, COLLIDER.radius,
      { x: position.x, y: position.y + COLLIDER.halfHeight, z: position.z });
  }

  _buildModel() {
    const body = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: COLORS.metal });
    const dark = new THREE.MeshStandardMaterial({ color: COLORS.dark });
    const glow = new THREE.MeshStandardMaterial({ color: COLORS.glow, emissive: COLORS.glow, emissiveIntensity: 1 });
    const add = (geometry, material, x, y, z, yaw = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.y = yaw;
      body.add(mesh);
      return mesh;
    };
    add(new THREE.CylinderGeometry(1.5, 1.7, 0.6, 10), metal, 0, 0.3, 0);
    add(new THREE.CylinderGeometry(0.45, 0.55, 2.0, 8), dark, 0, 1.6, 0);
    add(new THREE.CylinderGeometry(0.75, 0.6, 0.2, 10), metal, 0, 3.45, 0);
    for (let i = 0; i < 4; i++) {
      const yaw = (i * Math.PI) / 2 + Math.PI / 4;
      const x = Math.sin(yaw) * 0.85;
      const z = Math.cos(yaw) * 0.85;
      add(new THREE.BoxGeometry(0.16, 2.4, 0.8), metal, x, 1.8, z, yaw + Math.PI / 2);
      add(new THREE.BoxGeometry(0.06, 2.0, 0.06), glow, Math.sin(yaw) * 1.27, 1.9, Math.cos(yaw) * 1.27, yaw);
    }

    this._solidMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4, flatShading: true });
    this._glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const merged = consolidateMeshes(body, this._solidMaterial, this._glowMaterial);
    for (const mesh of merged) {
      mesh.castShadow = mesh.material === this._solidMaterial;
      mesh.receiveShadow = true;
    }
    this.glowParts = merged.find((mesh) => mesh.material === this._glowMaterial) || null;
    metal.dispose();
    dark.dispose();
    glow.dispose();
    this.mesh.add(body);

    this._coreMaterial = new THREE.MeshBasicMaterial({ color: COLORS.glow, toneMapped: false });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), this._coreMaterial);
    this.core.position.y = CORE_HEIGHT;
    this.mesh.add(this.core);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.05, 6, 24), this._coreMaterial);
    this.ring.position.y = CORE_HEIGHT;
    this.mesh.add(this.ring);
  }

  // ---------------------------------------------------------------------------
  // Phase 5
  // ---------------------------------------------------------------------------

  gameplayUpdate(delta) {
    if (this.isShutDown) return;
    const player = this.player;
    const near = !!player && !(player.health && player.health.isDead) && !player.isDevSuspended &&
      Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z) <= this.cfg.radius;
    const holding = near && this.gameWorld.input.isActionDown('specialAction');

    if (holding) this.progress = Math.min(this.cfg.holdSeconds, this.progress + delta);
    else this.progress = Math.max(0, this.progress - delta * this.cfg.drainPerSecond);
    if (this.progress >= this.cfg.holdSeconds) {
      this.shutDown();
      return;
    }

    let label = null;
    if (near) {
      const percent = Math.floor((10 * this.progress) / this.cfg.holdSeconds) * 10;
      label = holding ? `SHUTTING DOWN ${percent}%` : `HOLD TO SHUT DOWN THE ${this.name.toUpperCase()}`;
    }
    this._setPrompt(label);
  }

  /** Switches it off for good. */
  shutDown() {
    if (this.isShutDown) return;
    this.isShutDown = true;
    this.progress = this.cfg.holdSeconds;
    this._setPrompt(null);
    this.light.intensity = 0; // Not visible = false: that would change the light count and recompile shaders
    this._coreMaterial.color.setHex(COLORS.dead);
    if (this.glowParts) this.glowParts.visible = false;
    if (this.beam) this.beam.visible = false;
    if (this.onShutDown) this.onShutDown(this);
  }

  _setPrompt(label) {
    if (label === this._promptLabel) return;
    this._promptLabel = label;
    const ui = this.gameWorld.ui;
    if (!ui) return;
    if (label) ui.showPrompt('E', label, PROMPT_COLOR, this);
    else ui.hidePrompt(this);
  }

  // ---------------------------------------------------------------------------
  // Phase 6
  // ---------------------------------------------------------------------------

  lateUpdate(delta) {
    if (this.isShutDown) return;
    this._time += delta;
    const strain = this.progress / this.cfg.holdSeconds; // Spins up as it is shut down
    this.core.rotation.y += delta * (1.2 + strain * 8);
    this.core.position.y = CORE_HEIGHT + Math.sin(this._time * 2) * 0.08;
    this.ring.rotation.x = Math.PI / 2 + Math.sin(this._time * 0.7) * 0.4;
    this.ring.rotation.y += delta * (0.8 + strain * 6);
    if (this.beam) this.beam.material.opacity = 0.4 + 0.15 * Math.sin(this._time * 9) + strain * 0.3;
  }

  dispose() {
    this._setPrompt(null);
    if (this.collider) {
      this.physicsWorld.removeRigidBody(this.collider.rigidBody);
      this.collider = null;
    }
    if (this.light) this.light.dispose();
    super.dispose(); // Geometries and materials (the core and ring share one material)
  }
}
