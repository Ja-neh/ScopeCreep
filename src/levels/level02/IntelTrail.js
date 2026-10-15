import * as THREE from 'three';
import { BaseEntity } from '../../entities/BaseEntity.js';
import config from '../../config.json';

// The islanders' trail: notes and dead radios left by the people the aliens took. One sits in
// each zone, roughly on the way inland, telling the story the squad walks into (the village,
// the gate, the hall of lights that Level 3 finishes). Positions are a z-line and a landmark x
// each spot is pulled towards from the jungle path, so they sit off the trail but findable.
//
// `towardX` is where the spot leans: the crew trails (west of the path) for the early ones,
// then the holdout posts themselves (the rocks, the outskirts) as the trail tightens.
const SPOTS = [
  {
    id: 'beach-note',
    zone: 'beach',
    kind: 'note',
    z: 150,
    towardX: -8,
    title: 'A Waterlogged Note',
    text: 'Day eleven since the first escape. We burned the boats so the others could not be found.'
  },
  {
    id: 'forest-radio',
    zone: 'forest',
    kind: 'radio',
    z: 40,
    towardX: -30,
    title: 'A Dead Radio',
    text: 'Signal repeating: ...anyone on this channel, the tall ones are listening... do not use the path lights...'
  },
  {
    id: 'forest-note',
    zone: 'forest',
    kind: 'note',
    z: -20,
    towardX: 20,
    title: "A Child's Crayon Drawing",
    text: 'A village drawn in green crayon. A gate at the top, a sun with too many rays, and a note: do not go past the big gate.'
  },
  {
    id: 'rocks-radio',
    zone: 'rocks',
    kind: 'radio',
    z: -140,
    towardX: -60,
    title: 'A Cracked Field Radio',
    text: 'The tall ones walk the rocks at dusk. We hid the children in the root cellar by the old well. The gate watches itself.'
  },
  {
    id: 'outskirts-note',
    zone: 'outskirts',
    kind: 'note',
    z: -250,
    towardX: -30,
    title: 'A Half-Burned Log',
    text: 'If the marines come: the gate at the village. They took everyone inside the hall. The lights in the sky there never sleep.'
  }
];

const GROUND_CLEAR_RADIUS = 1.2;   // Meters of open ground a spot must have
const FIND_RADIUS_FALLBACK = 2.2;  // Interaction reach when config has no intel block

/**
 * IntelTrail
 * The islanders' notes and dead radios, strewn across the island for the player to find on the
 * way inland ([E] to read). Each find is a toast (the story, in the islanders' own words) and a
 * map pin ([M]); the map also shows the unfound ones faintly, so the trail reads as something to
 * follow. Visual only: no colliders (you step over paper), one small mesh each.
 *
 * Updated in Phase 5: the nearest track pulses its glow, the proximity prompt is shown, and [E]
 * collects it. Story order is not enforced; each spot carries its own piece of the story.
 */
export class IntelTrail extends BaseEntity {
  /**
   * @param {GameWorld} gameWorld
   * @param {Object} options
   * @param {BeachEnvironment} options.environment
   * @param {Player} options.player
   * @param {BeachCover} options.cover - The scenery, so a spot never lands inside a trunk or rock
   * @param {number} [options.radius] - Interaction reach (config.intel.radius)
   */
  constructor(gameWorld, { environment, player, cover, radius = (config.intel ? config.intel.radius : FIND_RADIUS_FALLBACK) }) {
    super('IntelTrail');
    this.gameWorld = gameWorld;
    this.environment = environment;
    this.player = player;
    this.cover = cover;
    this.radius = radius;
    this.spots = [];
    this.foundCount = 0;
    this.group = new THREE.Group();
    this.group.name = 'IntelTrail';
    this.mesh = this.group; // BaseEntity/GameWorld mount the mesh; the trail is one group
    this._time = 0;
    this._near = null;

    this.materials = {
      paper: new THREE.MeshStandardMaterial({ color: 0xf2e8cc, roughness: 0.9, flatShading: true }),
      ink: new THREE.MeshStandardMaterial({ color: 0x3d3630, roughness: 0.8 }),
      radio: new THREE.MeshStandardMaterial({ color: 0x39423a, roughness: 0.7, metalness: 0.25 }),
      radioAccent: new THREE.MeshStandardMaterial({ color: 0x23292b, roughness: 0.8 }),
      glow: new THREE.MeshBasicMaterial({ color: 0xffd166, toneMapped: false })
    };

    this._build();
  }

  /** Lays every spot on clear, dry ground and builds its little mesh. */
  _build() {
    for (const spot of SPOTS) {
      const z = spot.z;
      const pathX = this.environment.pathCentreX(z);
      const x = pathX + (spot.towardX - pathX) * 0.7;
      const at = this._findGround(x, z);
      if (!at) continue; // A drowned spot is skipped; the rest of the trail still tells the story

      const mesh = spot.kind === 'radio' ? this._buildRadio() : this._buildNote();
      mesh.position.set(at.x, at.y, at.z);
      mesh.rotation.y = Math.random() * Math.PI * 2;
      this.group.add(mesh);
      this.spots.push({ ...spot, x: at.x, y: at.y, found: false, mesh });
    }
  }

  /** A sheet of paper on a small rock, weighted down. */
  _buildNote() {
    const group = new THREE.Group();
    const { paper, ink } = this.materials;
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.015, 0.42), paper);
    sheet.rotation.y = 0.3;
    sheet.position.y = 0.28;
    sheet.castShadow = true;
    group.add(sheet);
    const weight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.12), ink);
    weight.position.set(0.14, 0.3, -0.18);
    group.add(weight);
    const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), ink);
    stone.position.y = 0.14;
    stone.scale.set(1, 0.7, 1);
    group.add(stone);
    return group;
  }

  /** A field radio, dead, with a stuck indicator light (the glow picks up while unfound). */
  _buildRadio() {
    const group = new THREE.Group();
    const { radio, radioAccent } = this.materials;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.22), radio);
    body.position.y = 0.4;
    body.rotation.x = -0.12;
    body.castShadow = true;
    group.add(body);
    const speaker = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.02), radioAccent);
    speaker.position.set(-0.05, 0.4, 0.12);
    speaker.rotation.x = -0.12;
    group.add(speaker);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), radioAccent);
    antenna.position.set(0.16, 0.75, 0);
    antenna.rotation.z = -0.18;
    group.add(antenna);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), this.materials.glow);
    lens.position.set(0.14, 0.47, 0.11);
    group.add(lens);
    return group;
  }

  /** Clear, dry ground near (x, z), or null. */
  _findGround(x, z) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const px = x + (Math.random() - 0.5) * 6;
      const pz = z + (Math.random() - 0.5) * 6;
      if (this.environment.heightAt(px, pz) > 0.24 && this._isClear(px, pz)) {
        return { x: px, y: this.environment.heightAt(px, pz), z: pz };
      }
    }
    return this.environment.heightAt(x, z) > 0.24 ? { x, y: this.environment.heightAt(x, z), z } : null;
  }

  _isClear(x, z) {
    return this.cover ? this.cover.isClearOfSolids(x, z, GROUND_CLEAR_RADIUS) : true;
  }

  /** How many spots the trail holds (the sandbox can read it without touching the spots). */
  get totalCount() {
    return this.spots.length;
  }

  /** The map snapshot: every spot, found or not, so the chart can tell them apart. */
  mapMarkers() {
    return this.spots.map((spot) => ({
      x: spot.x,
      z: spot.z,
      kind: spot.kind,
      found: spot.found,
      label: spot.found ? (spot.kind === 'radio' ? 'RADIO' : 'NOTE') : '?'
    }));
  }

  /**
   * Phase 5: the nearest unfound spot pulses its glow, shows its prompt, and a press of [E]
   * collects it — a toast with the islander's words.
   */
  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    if (!this.player || this.spots.length === 0) return;
    this._time += delta;
    const pulse = 0.5 + 0.5 * Math.sin(this._time * 2.4);

    // The nearest unfound spot in reach; the glow of every unfound radio follows the pulse
    let near = null;
    let nearDistance = Infinity;
    for (const spot of this.spots) {
      if (spot.found) continue;
      if (spot.kind === 'radio') this.materials.glow.color.setHSL(0.11, 0.9, 0.35 + pulse * 0.3);
      const distance = Math.hypot(this.player.position.x - spot.x, this.player.position.z - spot.z);
      if (distance <= this.radius && distance < nearDistance) {
        nearDistance = distance;
        near = spot;
      }
    }

    const ui = gameWorld.ui;
    const suspended = this.player.isDevSuspended || (this.player.health && this.player.health.isDead);
    if (!near || suspended) {
      if (this._near && ui) ui.hidePrompt(this);
      this._near = null;
      return;
    }

    const label = near.kind === 'radio' ? 'LISTEN TO RADIO' : 'READ NOTE';
    if (ui && this._near !== near) ui.showPrompt('E', label, '#9ad06b', this);
    this._near = near;

    if (gameWorld.input.isActionJustPressed('specialAction')) this._collect(near);
  }

  /** Collects (or re-reads) one spot: mark it found, count it, and tell the player its story. */
  _collect(spot) {
    const first = !spot.found;
    if (first) {
      spot.found = true;
      this.foundCount += 1;
      spot.mesh.visible = false; // Read once: it drops off the ground and the map shows it found
    }
    const ui = this.gameWorld.ui;
    if (!ui) return;
    ui.showToast(`${spot.title} — “${spot.text}”`, 'info', 6000);
    if (first) {
      ui.showToast(`Islanders' trail: ${this.foundCount} of ${this.totalCount} found (map: [M])`, 'success', 3000);
    }
  }

  dispose() {
    if (this._near && this.gameWorld.ui) this.gameWorld.ui.hidePrompt(this);
    if (this.group) { // The world and the level can both call dispose: only the first tears down
      this.group.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
      });
      if (this.group.parent) this.group.parent.remove(this.group);
    }
    for (const material of Object.values(this.materials)) material.dispose();
    this.spots = [];
    this.group = null;
    this.mesh = null;
    super.dispose();
  }
}
