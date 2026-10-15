import * as THREE from 'three';
import { SoldierModel } from '../../entities/models/SoldierModel.js';
import { createRandom } from '../../rendering/Noise.js';

// The remains of the first escape attempt: two landing boats that never left the sand, half-buried
// in the tidal wash where they burned, crates spilled from them, and the soldiers who did not get
// away. Seeded so every player finds the same story, and placed clear of the landing clearings so
// nothing blocks the squad's path up the beach.
const SEED = 5150;

const BOAT_MIN_GAP = 40;      // Waves and clearings keep boats at least this far apart
const CRATE_MIN_GAP = 6;      // ...and crates this far from anything solid
const SOLDIER_MAX_GAP = 11;   // Fallen soldiers lie within this of their boat
const SOLDIER_MIN_GAP = 3;

const BAND = { minX: -140, maxX: 140, minZ: 122, maxZ: 196 }; // Dry sand either side of the gangway walk

const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * BeachWreckage
 * Level 2's battlefield dressing: the burned boats, split crates and fallen soldiers of the
 * first, failed escape attempt, scattered along the south beach between the landing zone and the
 * jungle. Boats and crates are solid (cover); the fallen are not. Every prop is placed off the
 * landing clearings, the jungle path and the waterline.
 */
export class BeachWreckage {
  /**
   * @param {GameWorld} gameWorld
   * @param {BeachEnvironment} environment
   * @param {Object} [options]
   * @param {Array<{x: number, z: number, radius: number}>} [options.clearings] - Circles to avoid
   */
  constructor(gameWorld, environment, { clearings = [] } = {}) {
    this.gameWorld = gameWorld;
    this.environment = environment;
    this.clearings = clearings;

    this.boats = [];      // { mesh (Group), x, z, length, width, collider }
    this.crates = [];     // { mesh (Mesh), collider }
    this.soldiers = [];   // { model, x, z }
    this.colliders = [];

    this.materials = {
      charred: new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 0.95, flatShading: true }),
      burntWood: new THREE.MeshStandardMaterial({ color: 0x3a3129, roughness: 0.9, flatShading: true }),
      rust: new THREE.MeshStandardMaterial({ color: 0x5d4634, roughness: 0.8, metalness: 0.35, flatShading: true }),
      burntPaint: new THREE.MeshStandardMaterial({ color: 0x3f4245, roughness: 0.7, metalness: 0.25, flatShading: true }),
      crateWood: new THREE.MeshStandardMaterial({ color: 0x6f5638, roughness: 0.9, flatShading: true }),
      crateMetal: new THREE.MeshStandardMaterial({ color: 0x4c554c, roughness: 0.7, metalness: 0.3, flatShading: true })
    };
  }

  build() {
    const random = createRandom(SEED);
    const candidates = this._beachCandidates(random);

    // Two boats, far apart, each with its own debris field around it
    const boatSpots = this._pickSpots(candidates, 2, BOAT_MIN_GAP + 12);
    for (const [i, spot] of boatSpots.entries()) {
      const boat = i === 0 ? this._buildLandingCraft(spot, random) : this._buildPatrolBoat(spot, random);
      this.boats.push(boat);
      this._placeSoldiersAround(boat, random);
      this._placeCrateNear(boat, random);
    }
    // A couple more crates strewn along the walk up the beach
    const strays = this._pickSpots(candidates, 2, CRATE_MIN_GAP);
    for (const spot of strays) this.crates.push(this._buildCrate(spot, random));

    console.log(`[BeachWreckage] ${this.boats.length} wrecked boats, ${this.crates.length} crates, ` +
      `${this.soldiers.length} fallen soldiers.`);
  }

  /** Every prop the wreckage left behind (for tests and intel). */
  get count() {
    return this.boats.length + this.crates.length + this.soldiers.length;
  }

  // ---------------------------------------------------------------------------
  // Placement
  // ---------------------------------------------------------------------------

  /** Dry sand points in the beach band, jittered off a grid, clear of the landings. */
  _beachCandidates(random) {
    const spots = [];
    for (let gx = BAND.minX; gx <= BAND.maxX; gx += 9) {
      for (let gz = BAND.minZ; gz <= BAND.maxZ; gz += 7) {
        const x = gx + (random() - 0.5) * 6;
        const z = gz + (random() - 0.5) * 5;
        if (!this._spotIsClear(x, z, 3)) continue;
        const height = this.environment.heightAt(x, z);
        if (height < 0.25 || height > 2.6) continue; // Wet sand or sea
        if (this.environment.slopeAt(x, z) > 0.28) continue;
        spots.push({ x, z });
      }
    }
    // Shuffle so picks are spread over the whole beach, not just the west end
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    return spots;
  }

  /** The first `n` candidate spots that keep `gap` from each other and from every pick so far. */
  _pickSpots(candidates, n, gap) {
    const picked = [];
    const tooClose = (x, z) => picked.some((p) => Math.hypot(p.x - x, p.z - z) < gap);
    for (const spot of candidates) {
      if (picked.length >= n) break;
      if (tooClose(spot.x, spot.z)) continue;
      picked.push(spot);
    }
    return picked;
  }

  _spotIsClear(x, z, margin) {
    for (const clearing of this.clearings) {
      if (Math.hypot(x - clearing.x, z - clearing.z) < clearing.radius + margin) return false;
    }
    // Keep the walk off the sand and the jungle path mouth open
    return this.environment.pathDistance(x, z) > 4;
  }

  /** Fallen soldiers lie sprawled near their boat, a couple of meters from it. */
  _placeSoldiersAround(boat, random) {
    for (let i = 0; i < 2; i++) this._placeSoldier(boat, random);
  }

  _placeSoldier(boat, random) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = random() * Math.PI * 2;
      const distance = SOLDIER_MIN_GAP + random() * (SOLDIER_MAX_GAP - SOLDIER_MIN_GAP);
      const x = boat.x + Math.cos(angle) * distance;
      const z = boat.z + Math.sin(angle) * distance;
      if (!this._spotIsClear(x, z, 1.5)) continue;
      const height = this.environment.heightAt(x, z);
      if (height < 0.25) continue;
      if (this.soldiers.some((s) => Math.hypot(s.x - x, s.z - z) < 2.5)) continue;

      // The same soldier model as the crew, in the greys of a month in the sun and rain
      const model = new SoldierModel({ suitColor: 0x555c60, helmetColor: 0x333a3d, visorColor: 0x20262a });
      model.mesh.position.set(x, height, z);
      model.mesh.rotation.y = random() * Math.PI * 2;
      model.setFallen(1);
      model.mesh.traverse((child) => { if (child.isMesh) child.receiveShadow = true; });
      this.gameWorld.environmentGroup.add(model.mesh);
      this.soldiers.push({ model, x, z });
      return true;
    }
    return false;
  }

  /** One crates' worth of spilled cargo near a boat. */
  _placeCrateNear(boat, random) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = random() * Math.PI * 2;
      const distance = 4 + random() * 8;
      const x = boat.x + Math.cos(angle) * distance;
      const z = boat.z + Math.sin(angle) * distance;
      if (!this._spotIsClear(x, z, 1.5)) continue;
      if (this.environment.heightAt(x, z) < 0.25) continue;
      this.crates.push(this._buildCrate({ x, z }, random, true));
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // The props
  // ---------------------------------------------------------------------------

  /** A landing craft whose bow ramp never dropped: it burned where it beached. */
  _buildLandingCraft(spot, random) {
    const yaw = (random() - 0.5) * 0.7 + (random() < 0.5 ? 0 : Math.PI);
    const group = new THREE.Group();
    group.name = 'Wreck_LandingCraft';

    const sink = 0.5 + random() * 0.25;
    const ground = this.environment.heightAt(spot.x, spot.z);
    group.position.set(spot.x, ground - sink, spot.z);
    group.rotation.set((random() - 0.5) * 0.1, yaw, (random() - 0.5) * 0.16);

    const { charred, burntWood, rust } = this.materials;
    // Hull: sides, floor and transom, welded out of slabs
    this._add(group, new THREE.BoxGeometry(3.2, 1.5, 7.2), charred, 0, 0.75, 0);
    this._add(group, new THREE.BoxGeometry(0.16, 1.0, 7.2), burntWood, -1.6, 1.25, 0);
    this._add(group, new THREE.BoxGeometry(0.16, 1.0, 7.2), burntWood, 1.6, 1.25, 0);
    this._add(group, new THREE.BoxGeometry(3.2, 1.0, 0.16), burntWood, 0, 1.25, 3.6);
    // Bow ramp, dropped against the sand where it grounded
    const ramp = this._add(group, new THREE.BoxGeometry(3.0, 0.1, 2.4), rust, 0, 0.55, -4.6);
    ramp.rotation.x = -0.5;
    // Burnt cabin block, roof collapsed
    const cabin = this._add(group, new THREE.BoxGeometry(2.2, 1.0, 1.8), burntWood, 0, 2.0, 1.8);
    cabin.rotation.x = 0.22;
    this._add(group, new THREE.BoxGeometry(2.4, 0.1, 2.0), charred, 0.2, 2.5, 2.2).rotation.z = 0.3;

    group.traverse((child) => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
    this.gameWorld.environmentGroup.add(group);
    this._addBoatCollider(group.position, 1.8, 0.85, 3.8, group.rotation.y);
    return { mesh: group, x: spot.x, z: spot.z, length: 7.2, width: 3.2 };
  }

  /** A patrol boat broken in two on the sand, its outboards torn off. */
  _buildPatrolBoat(spot, random) {
    const yaw = random() * Math.PI * 2;
    const group = new THREE.Group();
    group.name = 'Wreck_PatrolBoat';

    const sink = 0.35 + random() * 0.2;
    const ground = this.environment.heightAt(spot.x, spot.z);
    group.position.set(spot.x, ground - sink, spot.z);
    group.rotation.set((random() - 0.5) * 0.12, yaw, (random() - 0.5) * 0.2);

    const { charred, burntWood, burntPaint, rust } = this.materials;
    // Stern half, forward half, pulled a meter apart and offset
    const stern = new THREE.Group();
    stern.position.z = 1.7;
    stern.rotation.y = 0.18;
    group.add(stern);
    this._add(stern, new THREE.BoxGeometry(2.3, 1.1, 3.4), charred, 0, 0.55, 0);
    this._add(stern, new THREE.BoxGeometry(0.14, 0.8, 3.4), burntWood, -1.15, 0.95, 0);
    this._add(stern, new THREE.BoxGeometry(0.14, 0.8, 3.4), burntWood, 1.15, 0.95, 0);
    this._add(stern, new THREE.BoxGeometry(2.2, 0.7, 1.4), burntPaint, 0, 1.5, 0.6);

    const bow = new THREE.Group();
    bow.position.set(0.7, 0, -2.1);
    bow.rotation.y = -0.35;
    bow.rotation.z = 0.24;
    group.add(bow);
    this._add(bow, new THREE.BoxGeometry(2.1, 1.0, 2.6), charred, 0, 0.5, 0);
    const point = this._add(bow, new THREE.ConeGeometry(1.05, 1.6, 4), burntPaint, 0, 0.5, -1.9);
    point.rotation.x = -Math.PI / 2;
    point.rotation.y = Math.PI / 4;
    point.scale.set(1, 1, 0.45);
    // An outboard torn loose and lying in the sand
    this._add(group, new THREE.BoxGeometry(0.4, 0.8, 0.5), rust, -1.9, 0.4, 1.2).rotation.z = 1.1;

    group.traverse((child) => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
    this.gameWorld.environmentGroup.add(group);
    this._addBoatCollider(group.position, 1.4, 0.6, 2.2, yaw);
    return { mesh: group, x: spot.x, z: spot.z, length: 5.4, width: 2.3 };
  }

  /** A supply crate, some upright, some burst open and tipped. */
  _buildCrate(spot, random, nearBoat = false) {
    const yaw = random() * Math.PI * 2;
    const scale = 0.85 + random() * 0.35;
    const metal = nearBoat ? random() < 0.5 : random() < 0.25;
    const material = metal ? this.materials.crateMetal : this.materials.crateWood;

    const group = new THREE.Group();
    group.name = 'Wreck_Crate';
    const height = this.environment.heightAt(spot.x, spot.z);
    const tipped = random() < 0.4;
    group.position.set(spot.x, height + (tipped ? 0.45 * scale : 0.5 * scale), spot.z);
    group.rotation.y = yaw;
    if (tipped) group.rotation.set((random() - 0.5) * 1.1, 0, Math.PI / 2 + (random() - 0.5) * 0.3);

    this._add(group, new THREE.BoxGeometry(1.0, 1.0, 1.0).scale(scale, scale, scale), material, 0, 0, 0);
    // A burst-open lid, lying beside it
    if (random() < 0.5) {
      const lid = this._add(group, new THREE.BoxGeometry(1.0, 0.08, 1.0).scale(scale, scale, scale), material,
        0, -0.5 * scale - 0.06, 0);
      lid.rotation.set(-0.5, 0, 0.3);
      lid.position.set(0.55, -0.42, -0.55);
    }

    group.traverse((child) => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
    this.gameWorld.environmentGroup.add(group);
    _quaternion.setFromAxisAngle(_up, yaw);
    const half = 0.5 * scale + 0.03;
    const collider = this.gameWorld.physics.createStaticBox({ x: half, y: half, z: half }, group.position, _quaternion);
    if (collider) this.colliders.push(collider);
    return { mesh: group, collider, x: spot.x, z: spot.z };
  }

  _addBoatCollider(position, halfWidth, halfHeight, halfLength, yaw) {
    _position.set(position.x, position.y + halfHeight + 0.35, position.z);
    _quaternion.setFromAxisAngle(_up, yaw);
    const collider = this.gameWorld.physics.createStaticBox(
      { x: halfWidth, y: halfHeight, z: halfLength }, _position, _quaternion);
    if (collider) this.colliders.push(collider);
  }

  _add(parent, geometry, material, x, y, z) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  dispose() {
    for (const collider of this.colliders) {
      this.gameWorld.physics.removeRigidBody(collider.rigidBody);
    }
    this.colliders = [];

    for (const boat of this.boats) {
      boat.mesh.traverse((child) => { if (child.geometry) child.geometry.dispose(); });
      if (boat.mesh.parent) boat.mesh.parent.remove(boat.mesh);
    }
    this.boats = [];
    for (const crate of this.crates) {
      crate.mesh.traverse((child) => { if (child.geometry) child.geometry.dispose(); });
      if (crate.mesh.parent) crate.mesh.parent.remove(crate.mesh);
    }
    this.crates = [];
    for (const soldier of this.soldiers) {
      soldier.model.dispose();
    }
    this.soldiers = [];

    for (const material of Object.values(this.materials)) material.dispose();
  }
}
