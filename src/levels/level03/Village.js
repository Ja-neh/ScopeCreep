import * as THREE from 'three';
import { BuildingKit } from './BuildingKit.js';
import { VillageHall } from './VillageHall.js';
import { createRandom } from '../../rendering/Noise.js';

const SEED = 1931; // The same village every time

// Layout on the village plateau (BeachEnvironment's 'village' layout: an oval 400 m across and
// 490 m long around (0, -400)), in world x, z. The jungle path comes up from the south to the
// gate; the avenue runs north from the gate to the square, where the hall stands on the north
// side with the graveyard beside it. Cross streets run east-west off the avenue, and side
// streets link them further out.
const GATE = { x: 0, z: -162 };
const SQUARE = { x: 0, z: -560, radius: 26 };
const HALL_CENTRE = { x: 0, z: -608 };
const GRAVEYARD = { x: 48, z: -597, w: 34, d: 26 };
const AVENUE_WIDTH = 9;
const STREET_WIDTH = 7;
const CROSS_STREETS = [ // z, and how far the street runs either side of the avenue
  { z: -220, reach: 118 }, { z: -290, reach: 160 }, { z: -360, reach: 176 }, { z: -430, reach: 176 }, { z: -500, reach: 164 }
];
const SIDE_STREETS = [
  { x: -85, from: -220, to: -500 }, { x: 85, from: -220, to: -500 },
  { x: -155, from: -290, to: -500 }, { x: 155, from: -290, to: -500 }
];
// Alien ships that landed in the village: centre, hull radius, which way the ramp faces
const SHIPS = [
  { x: -45, z: -255, radius: 10, yaw: 0.6 },
  { x: 42, z: -395, radius: 15, yaw: -0.4 },
  { x: -120, z: -325, radius: 12, yaw: 2.2 },
  { x: 120, z: -465, radius: 11, yaw: 1.1 },
  { x: -62, z: -568, radius: 10, yaw: -0.9, light: true }
];
const SHIP_BELLY = 3.4;     // Clearance under the hull: you can walk (and hide) under a ship
const SHIP_CLEARING = 6;    // No houses this close to a ship's rim
// The ships whose crews set up the force field's generators (index into SHIPS), and what the
// generators are called; each stands a few meters beyond the foot of its ship's ramp
const GENERATOR_SHIPS = [{ ship: 2, name: 'West generator' }, { ship: 3, name: 'East generator' }, { ship: 4, name: 'Square generator' }];
const GENERATOR_PAST_RAMP = 3;
// Lanterns with a real light (each is a point light: keep the total small). The other lamp
// posts only glow, or are dead.
const LIT_LANTERNS = [{ x: 6.4, z: -168 }, { x: -5.4, z: -352 }, { x: 7.2, z: -538 }];
const EDGE_MARGIN = 6;      // Buildings stay this far inside the plateau's edge
const DEAD_TREES = 70;
const MESH_TILE = 100;      // The merged village is cut into tiles this size (culling, drawing near to far)
const STREET_JUNK = 40;     // Crates and barrels left in the streets (cover)

const HOUSE = {
  storey: 3.3,
  wall: 0.3,
  doorWidth: 1.6,
  doorHeight: 2.3,
  porchDepth: 1.8,
  fenceGap: 1.2
};

const COLORS = {
  walls: [0x8a8070, 0x7d7465, 0x948a78, 0x6f6a60, 0x857a66, 0x77705f],
  roofs: [0x4e3b30, 0x5a4636, 0x3f3833, 0x604a3a, 0x473f3a],
  wood: 0x4a3a2c,
  darkWood: 0x2e241c,
  plank: 0x6b5843,
  window: 0x10151d,
  doorway: 0x07090c,
  litWindow: 0xd9c27a,   // A candle somebody left burning
  alienWindow: 0x58e07a, // Something green inside
  stone: 0x7b776e,
  darkStone: 0x55524c,
  street: 0x4f4335,
  square: 0x5f5b54,
  water: 0x1d2a22,
  scorch: 0x26221d,
  lamp: 0xffd08a,
  deadLamp: 0x2b2b2b,
  bark: 0x3b3029,
  grave: 0x8c8a84,
  graveDark: 0x6a6964,
  earth: 0x3a2f24,
  hull: 0x7d8690,
  hullDark: 0x3a4048,
  belly: 0x163a35,       // The underside glows faintly
  dome: 0x2b7f6c,
  alien: 0x6dff8f,
  alienBlue: 0x66e8ff,
  pod: 0x2f4a33
};

/**
 * Village
 * Level 3's village on the plateau at the island's far end, at night: an avenue from the gate to
 * the square, cross and side streets lined with old, creepy houses (weathered walls, crooked
 * roofs, boarded and broken windows, a candle here and there, sagging porches, ruins, walk-in
 * houses to fight from), dead trees, a graveyard by the hall, and alien ships that landed among
 * the houses, glowing green, with alien growth creeping up the walls. Laid out from a fixed seed,
 * so it is the same every time. Everything static is merged into two meshes per 70 m tile, with
 * box and cylinder colliders (see BuildingKit).
 *
 * Gives the level its layout: spawn points, streets, the square, the hall (VillageHall), the
 * houses and the ships.
 */
export class Village {
  /**
   * @param {GameWorld} gameWorld
   * @param {BeachEnvironment} environment - Built with the 'village' layout (ground heights, plateau)
   */
  constructor(gameWorld, environment) {
    this.gameWorld = gameWorld;
    this.environment = environment;
    this.kit = new BuildingKit(gameWorld.physics);
    this.group = new THREE.Group();
    this.group.name = 'Village';
    this.random = createRandom(SEED);
    this.lights = [];
    this.hall = null;
    this.houses = [];      // Buildings: { x, z, w, d, yaw, type: closed | open | ruin, front, bounds, ... }
    this.lots = [];        // Empty lots (a dead tree, a well, a broken fence)
    this.ships = [];       // { x, z, radius, yaw, belly, ramp }
    this.generatorSpots = []; // { name, position }: where the force field's generators stand
    this.streets = [];     // { from, to, width, name }
    this.square = { ...SQUARE };
    this.gate = { ...GATE };
    this.graveyard = { ...GRAVEYARD };
    this.spawnPoints = {};
    this.clearings = [];

    this._streetRects = [];
    this._blocked = [];    // Rectangles nothing else may overlap (houses, hall, graveyard, gate)
    this._reserved = [];   // Circles kept clear of houses (the square, ships, the supply crate)
    this._obstacles = [];  // Small round obstacles (trees, ship legs, posts) for isOpenGround
    this._keepClear = [];  // Doorsteps: no trees or junk in front of a door
  }

  build() {
    this._layStreets();

    // The hall closes the north side of the square
    this.hall = new VillageHall(new THREE.Vector3(HALL_CENTRE.x, this._ground(HALL_CENTRE.x, HALL_CENTRE.z), HALL_CENTRE.z));
    this.hall.build(this.kit, this.group);
    this._block(this.hall.bounds, 3);

    this._buildSquare();
    this._buildGraveyard();
    this._buildGate();
    for (const ship of SHIPS) this._buildShip(ship);
    for (const { ship: index, name } of GENERATOR_SHIPS) {
      const ship = this.ships[index];
      const x = ship.ramp.x + Math.sin(ship.yaw) * GENERATOR_PAST_RAMP;
      const z = ship.ramp.z + Math.cos(ship.yaw) * GENERATOR_PAST_RAMP;
      this.generatorSpots.push({ name, position: new THREE.Vector3(x, this._ground(x, z), z) });
    }

    // The supply crate the helicopters dropped just inside the gate
    const crate = { x: GATE.x + 9, z: GATE.z - 10 };
    this._reserved.push({ x: crate.x, z: crate.z, radius: 3 });

    // Houses along every street, the avenue first, then around the square
    for (const street of this.streets) this._lineStreet(street);
    this._ringSquare();

    this._buildLampPosts();
    this._scatterDeadTrees();
    this._scatterStreetJunk();

    this.group.add(this.kit.finish('VillageBuildings', { tileSize: MESH_TILE }));
    this.gameWorld.environmentGroup.add(this.group);

    // Where things start: on the jungle path below the gate, facing into the village
    const startZ = GATE.z + 34;
    const startX = this.environment.pathCentreX(startZ);
    this.spawnPoints.start = new THREE.Vector3(startX, this._ground(startX, startZ) + 0.2, startZ);
    this.spawnPoints.squad = [-3, 3, -6, 6].map((offset, i) => {
      const z = startZ + 4 + Math.floor(i / 2) * 3;
      const x = startX + offset;
      return new THREE.Vector3(x, this._ground(x, z) + 0.1, z);
    });
    this.spawnPoints.supplyCrate = new THREE.Vector3(crate.x, this._ground(crate.x, crate.z), crate.z);
    this.clearings.push({ x: crate.x, z: crate.z, radius: 3 }, { x: startX, z: startZ, radius: 8 });
  }

  // ---------------------------------------------------------------------------
  // Streets, the square, the gate
  // ---------------------------------------------------------------------------

  _layStreets() {
    this.streets.push({ from: { x: GATE.x, z: GATE.z + 4 }, to: { x: SQUARE.x, z: SQUARE.z + SQUARE.radius - 2 }, width: AVENUE_WIDTH, name: 'avenue' });
    for (const cross of CROSS_STREETS) {
      for (const side of [-1, 1]) {
        this.streets.push({ from: { x: side * AVENUE_WIDTH / 2, z: cross.z }, to: { x: side * cross.reach, z: cross.z }, width: STREET_WIDTH, name: `cross${cross.z}` });
      }
    }
    for (const street of SIDE_STREETS) {
      this.streets.push({ from: { x: street.x, z: street.from - STREET_WIDTH / 2 }, to: { x: street.x, z: street.to + STREET_WIDTH / 2 }, width: STREET_WIDTH, name: `side${street.x}` });
    }

    for (const street of this.streets) {
      const half = street.width / 2;
      this._streetRects.push({
        minX: Math.min(street.from.x, street.to.x) - half, maxX: Math.max(street.from.x, street.to.x) + half,
        minZ: Math.min(street.from.z, street.to.z) - half, maxZ: Math.max(street.from.z, street.to.z) + half
      });
      // Packed dirt, just above the ground
      const dx = street.to.x - street.from.x;
      const dz = street.to.z - street.from.z;
      const length = Math.hypot(dx, dz);
      const midX = (street.from.x + street.to.x) / 2;
      const midZ = (street.from.z + street.to.z) / 2;
      const frame = this.kit.frame(midX, this._ground(midX, midZ), midZ, Math.atan2(dx, dz));
      this.kit.box(frame, street.width, 0.06, length + street.width, 0, 0.03, 0, COLORS.street);
    }
  }

  /** The cobbled square with a dry fountain in the middle, alien crystals pushing up around it. */
  _buildSquare() {
    const kit = this.kit;
    const r = this.random;
    const frame = kit.frame(SQUARE.x, this._ground(SQUARE.x, SQUARE.z), SQUARE.z);
    kit.cylinder(frame, SQUARE.radius, 0.08, 0, 0, 0, COLORS.square, { segments: 32 });
    kit.cylinder(frame, 3.2, 0.8, 0, 0, 0, COLORS.stone, { solid: true, segments: 16 });
    kit.cylinder(frame, 2.9, 0.05, 0, 0.8, 0, COLORS.water, { segments: 16 });
    kit.cylinder(frame, 0.5, 2.4, 0, 0, 0, COLORS.darkStone, { solid: true, segments: 8 });
    kit.cylinder(frame, 1.3, 0.3, 0, 2.3, 0, COLORS.stone, { segments: 12 });
    kit.crystal(frame, 0.7, 1.2, 1.6, 0.8, COLORS.alien);
    kit.crystal(frame, 0.45, -1.1, 1.3, -0.9, COLORS.alien);
    for (let i = 0; i < 7; i++) {
      const angle = r() * Math.PI * 2;
      const distance = 9 + r() * 14;
      kit.crystal(frame, 0.35 + r() * 0.3, Math.cos(angle) * distance, 0.7, Math.sin(angle) * distance, COLORS.alien);
    }
    this._reserved.push({ x: SQUARE.x, z: SQUARE.z, radius: SQUARE.radius, square: true });
    this._obstacles.push({ x: SQUARE.x, z: SQUARE.z, radius: 3.2 });
  }

  /** The old village gate: two stone posts, a crooked beam with a hanging sign, broken walls. */
  _buildGate() {
    const kit = this.kit;
    const r = this.random;
    const frame = kit.frame(GATE.x, this._ground(GATE.x, GATE.z), GATE.z);
    const postX = AVENUE_WIDTH / 2 + 1.2;
    for (const side of [-1, 1]) {
      kit.box(frame, 1.1, 3.8, 1.1, side * postX, 1.9, 0, COLORS.stone, { solid: true });
      kit.box(frame, 1.4, 0.3, 1.4, side * postX, 3.95, 0, COLORS.darkStone);
      // A low stone wall either side, fallen in places
      let x = postX + 0.55;
      while (x < 32) {
        const length = 3 + r() * 4;
        const height = 0.8 + r() * 0.6;
        kit.box(frame, length, height, 0.6, side * (x + length / 2), height / 2, 0, COLORS.darkStone, { solid: true, roll: (r() - 0.5) * 0.06 });
        x += length + (r() < 0.5 ? 1.5 + r() * 2 : 0);
      }
    }
    kit.box(frame, 2 * postX + 1.0, 0.45, 0.5, 0, 4.4, 0, COLORS.darkWood, { roll: 0.04 });
    kit.box(frame, 3.2, 0.8, 0.08, 0.6, 3.55, 0.3, COLORS.plank, { roll: -0.22 });
    this._block({ minX: GATE.x - 34, maxX: GATE.x + 34, minZ: GATE.z - 1, maxZ: GATE.z + 1 }, 0);
  }

  // ---------------------------------------------------------------------------
  // Houses
  // ---------------------------------------------------------------------------

  /** What goes on the next lot: a house (closed, open or a ruin) or nothing much. */
  _rollLot() {
    const r = this.random;
    const roll = r();
    const type = roll < 0.12 ? 'empty' : roll < 0.25 ? 'ruin' : roll < 0.5 ? 'open' : 'closed';
    const storeys = type === 'closed' && r() < 0.3 ? 2 : 1;
    return {
      type,
      w: 7 + r() * 4,
      d: 6 + r() * 3,
      storeys,
      porch: type === 'closed' && storeys === 1 && r() < 0.35,
      fence: type !== 'empty' && r() < 0.3,
      setback: 1.5 + r() * 2,
      skew: (r() - 0.5) * 0.07   // Nothing here stands quite straight any more
    };
  }

  /** Lots along both sides of a street, doors facing it. */
  _lineStreet(street) {
    const r = this.random;
    const length = Math.hypot(street.to.x - street.from.x, street.to.z - street.from.z);
    const ux = (street.to.x - street.from.x) / length;
    const uz = (street.to.z - street.from.z) / length;
    const alongX = Math.abs(ux) > 0.5;
    for (const side of [-1, 1]) {
      const nx = alongX ? 0 : side; // From the street out to the houses
      const nz = alongX ? side : 0;
      const yaw = Math.atan2(-nx, -nz);
      let t = 4;
      while (t < length - 4) {
        const lot = this._rollLot();
        const footW = lot.w + (lot.fence ? 2 * HOUSE.fenceGap : 0);
        const out = street.width / 2 + lot.setback + (lot.porch ? HOUSE.porchDepth : 0) + lot.d / 2;
        const along = t + footW / 2;
        const house = {
          ...lot,
          x: street.from.x + ux * along + nx * out,
          z: street.from.z + uz * along + nz * out,
          yaw: yaw + lot.skew,
          street: street.name
        };
        house.bounds = this._footprint(house);
        if (this._fits(house.bounds)) {
          this._addLot(house);
          t += footW + 2 + r() * 5;
        } else {
          t += 3;
        }
      }
    }
  }

  /** A ring of houses around the square, facing in (not across the avenue, the hall or the graveyard). */
  _ringSquare() {
    const r = this.random;
    const inner = SQUARE.radius + 3;
    let angle = 0;
    while (angle < Math.PI * 2) {
      const lot = this._rollLot();
      if (lot.type === 'empty') lot.type = 'closed';
      lot.porch = false;
      lot.fence = false;
      const out = inner + lot.d / 2;
      const house = {
        ...lot,
        x: SQUARE.x + Math.cos(angle) * out,
        z: SQUARE.z + Math.sin(angle) * out,
        yaw: Math.atan2(-Math.cos(angle), -Math.sin(angle)) + lot.skew,
        street: 'square'
      };
      house.bounds = this._footprint(house);
      if (this._fits(house.bounds, true)) {
        this._addLot(house);
        angle += (lot.w + 2 + r() * 3) / inner;
      } else {
        angle += 0.08;
      }
    }
  }

  _addLot(house) {
    house.front = this._toWorld(house, 0, house.d / 2 + (house.porch ? HOUSE.porchDepth : 0) + house.setback + 1);
    this._block(house.bounds, 0);
    const doorstep = this._toWorld(house, 0, house.d / 2 + (house.porch ? HOUSE.porchDepth : 0) + 1);
    this._keepClear.push({ x: doorstep.x, z: doorstep.z, radius: 1.5 });
    if (house.type === 'empty') {
      this.lots.push(house);
      this._buildEmptyLot(house);
      return;
    }
    this.houses.push(house);
    this._buildHouse(house);
  }

  _buildHouse(house) {
    const kit = this.kit;
    const r = this.random;
    const frame = kit.frame(house.x, this._ground(house.x, house.z), house.z, house.yaw);
    const wallColor = this._pick(COLORS.walls);
    const { w, d } = house;

    if (house.type === 'ruin') {
      this._buildRuin(frame, house, wallColor);
      if (house.fence) this._buildFence(frame, house);
      return;
    }

    const h = house.storeys * HOUSE.storey;
    if (house.type === 'closed') this._buildClosedHouse(frame, house, h, wallColor);
    else this._buildOpenHouse(frame, house, h, wallColor);

    // Eaves beam and a crooked gable roof; some have fallen in, down to bare rafters
    const rise = w * (0.28 + r() * 0.12);
    kit.box(frame, w + 0.4, 0.2, d + 0.4, 0, h + 0.1, 0, COLORS.wood);
    if (house.type === 'closed' && r() < 0.15) {
      this._buildCavedRoof(frame, w + 0.8, rise, d + 0.8, h + 0.2);
    } else {
      kit.roof(frame, w + 0.8, rise, d + 0.8, 0, h + 0.2, 0, this._pick(COLORS.roofs), {
        pitch: (r() - 0.5) * 0.06,
        roll: (r() - 0.5) * 0.07
      });
    }
    if (r() < 0.45) {
      const side = r() < 0.5 ? -1 : 1;
      kit.box(frame, 0.7, 2.0, 0.7, side * w * 0.28, h + 0.2 + rise * 0.44 + 0.5, -d * 0.2, COLORS.darkStone, { roll: (r() - 0.5) * 0.12 });
    }
    if (r() < 0.22) this._buildAlienGrowth(frame, house, h);
    if (house.fence) this._buildFence(frame, house);
  }

  /** A solid block: a door (shut, ajar, boarded or gone), windows on every floor, maybe a porch. */
  _buildClosedHouse(frame, house, h, wallColor) {
    const kit = this.kit;
    const r = this.random;
    const { w, d } = house;
    kit.box(frame, w, h, d, 0, h / 2, 0, wallColor, { solid: true });
    if (house.storeys > 1) kit.box(frame, w + 0.1, 0.2, d + 0.1, 0, HOUSE.storey, 0, COLORS.wood);

    // The door
    const front = d / 2 + 0.04;
    const doorKind = r();
    kit.box(frame, 1.4, 0.2, 0.12, 0, 2.25, front + 0.02, COLORS.darkWood);
    if (doorKind < 0.2) {
      kit.box(frame, 1.2, 2.1, 0.08, 0, 1.05, front, COLORS.doorway);           // Gone: a black hole
    } else if (doorKind < 0.45) {
      kit.box(frame, 1.2, 2.1, 0.08, 0, 1.05, front, COLORS.doorway);           // Hanging open
      const angle = 0.6 + r() * 0.6;
      kit.box(frame, 1.1, 2.05, 0.07, -0.6 + Math.cos(angle) * 0.55, 1.05, front + Math.sin(angle) * 0.55, COLORS.darkWood, { yaw: -angle });
    } else {
      kit.box(frame, 1.2, 2.1, 0.08, 0, 1.05, front, COLORS.darkWood);
      if (doorKind > 0.8) this._boards(frame, 0, 1.1, front + 0.03, 0, 1.4, 3, 0.6);
    }

    // Windows: the front, both sides, on every floor
    for (let storey = 0; storey < house.storeys; storey++) {
      const y = storey * HOUSE.storey + (storey === 0 ? 1.9 : 1.7);
      const xs = storey > 0 && w > 9 ? [-w * 0.3, 0, w * 0.3] : [-w * 0.3, w * 0.3];
      for (const x of xs) this._window(frame, x, y, front, 0);
      for (const side of [-1, 1]) this._window(frame, side * (w / 2 + 0.04), y, (r() - 0.5) * d * 0.3, side * Math.PI / 2);
    }

    if (house.porch) {
      const depth = HOUSE.porchDepth;
      const porchW = w * 0.6;
      kit.box(frame, porchW, 0.22, depth, 0, 0.11, d / 2 + depth / 2, COLORS.wood);
      const collapsed = r() < 0.25;
      for (const side of [-1, 1]) {
        if (collapsed && side > 0) continue;
        kit.box(frame, 0.18, 2.7, 0.18, side * (porchW / 2 - 0.15), 1.35, d / 2 + depth - 0.15, COLORS.darkWood, { roll: (r() - 0.5) * 0.12 });
      }
      kit.box(frame, porchW + 0.3, 0.12, depth + 0.3, collapsed ? 0.3 : 0, collapsed ? 2.0 : 2.75, d / 2 + depth / 2, COLORS.wood, {
        pitch: collapsed ? 0.45 : 0.12,
        roll: collapsed ? 0.25 : 0
      });
    } else {
      kit.box(frame, 1.6, 0.18, 0.7, 0, 0.09, d / 2 + 0.35, COLORS.darkStone);
    }
  }

  /**
   * A house you can walk into: walls with a doorway, a window gap at the back, a crate inside
   * to take cover behind, junk on the floor, and a ceiling collider so the camera stays inside.
   */
  _buildOpenHouse(frame, house, h, wallColor) {
    const kit = this.kit;
    const r = this.random;
    const { w, d } = house;
    const t = HOUSE.wall;
    const door = HOUSE.doorWidth;
    kit.box(frame, w, h, t, 0, h / 2, -d / 2 + t / 2, wallColor, { solid: true });
    for (const side of [-1, 1]) {
      kit.box(frame, t, h, d, side * (w / 2 - t / 2), h / 2, 0, wallColor, { solid: true });
      const segment = (w - door) / 2;
      kit.box(frame, segment, h, t, side * (door / 2 + segment / 2), h / 2, d / 2 - t / 2, wallColor, { solid: true });
      this._window(frame, side * (door / 2 + segment / 2), 1.9, d / 2 + 0.04, 0);
    }
    kit.box(frame, door, h - HOUSE.doorHeight, t, 0, HOUSE.doorHeight + (h - HOUSE.doorHeight) / 2, d / 2 - t / 2, wallColor);
    // Floorboards, a crate to crouch behind, a toppled shelf, and the ceiling
    kit.box(frame, w - 2 * t, 0.05, d - 2 * t, 0, 0.025, 0, COLORS.darkWood);
    kit.box(frame, 1.2, 0.9, 1.0, w * 0.18, 0.45, -d * 0.18, COLORS.wood, { solid: true, yaw: 0.3 });
    kit.box(frame, 0.5, 1.8, 1.4, -w / 2 + t + 0.6, 0.9, -d * 0.2, COLORS.darkWood, { roll: 0.35 + r() * 0.3 });
    kit.box(frame, w - 2 * t, 0.1, d - 2 * t, 0, h - 0.05, 0, COLORS.darkWood);
    const ceiling = new THREE.Vector3(0, h + 0.1, 0).applyMatrix4(frame);
    kit.collider(ceiling, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), house.yaw), w / 2, 0.1, d / 2);
  }

  /** Walls broken off at different heights, rubble, and a charred beam. No roof. */
  _buildRuin(frame, house, wallColor) {
    const kit = this.kit;
    const r = this.random;
    const { w, d } = house;
    const t = HOUSE.wall;
    const back = 1.6 + r() * 1.8;
    kit.box(frame, w, back, t, 0, back / 2, -d / 2 + t / 2, wallColor, { solid: true });
    for (const side of [-1, 1]) {
      const rear = d * 0.6;
      const rearH = 1.2 + r() * 1.8;
      kit.box(frame, t, rearH, rear, side * (w / 2 - t / 2), rearH / 2, -d / 2 + rear / 2, wallColor, { solid: true });
      const nub = d * 0.22;
      const nubH = 0.6 + r() * 1.0;
      kit.box(frame, t, nubH, nub, side * (w / 2 - t / 2), nubH / 2, d / 2 - nub / 2, wallColor, { solid: true });
    }
    const piece = w * 0.3;
    const pieceH = 1 + r() * 1.4;
    kit.box(frame, piece, pieceH, t, -w / 2 + piece / 2, pieceH / 2, d / 2 - t / 2, wallColor, { solid: true });
    for (let i = 0; i < 4; i++) {
      const size = 0.4 + r() * 0.6;
      kit.box(frame, size * 1.4, size, size, (r() - 0.5) * w * 0.6, size / 2, (r() - 0.5) * d * 0.6, COLORS.darkStone, {
        solid: size > 0.7,
        yaw: r() * Math.PI
      });
    }
    const beam = d * 0.8;
    kit.box(frame, 0.25, 0.25, beam, w * 0.2, beam * 0.17, 0, COLORS.darkWood, { pitch: -0.35, yaw: (r() - 0.5) * 0.5 });
    kit.box(frame, w - 2 * t, 0.04, d - 2 * t, 0, 0.02, 0, COLORS.earth);
  }

  /** Half a roof still on, the other half down to bare rafters. */
  _buildCavedRoof(frame, w, rise, d, y) {
    const kit = this.kit;
    const slope = Math.hypot(w / 2, rise);
    const angle = Math.atan2(rise, w / 2);
    kit.box(frame, slope, 0.15, d, -w / 4, y + rise / 2, 0, this._pick(COLORS.roofs), { roll: angle });
    for (let i = 0; i < 4; i++) {
      kit.box(frame, slope, 0.15, 0.15, w / 4, y + rise / 2, -d / 2 + 0.4 + i * (d - 0.8) / 3, COLORS.darkWood, { roll: -angle });
    }
    kit.box(frame, 0.2, 0.2, d, 0, y + rise, 0, COLORS.darkWood);
  }

  /** Glowing alien vines climbing the walls, and a pod at the foot of them. */
  _buildAlienGrowth(frame, house, h) {
    const kit = this.kit;
    const r = this.random;
    const { w, d } = house;
    const count = 2 + Math.floor(r() * 3);
    for (let i = 0; i < count; i++) {
      const height = 1.2 + r() * (h - 1.2);
      const onSide = r() < 0.5;
      const side = r() < 0.5 ? -1 : 1;
      const x = onSide ? side * (w / 2 + 0.05) : (r() - 0.5) * w * 0.8;
      const z = onSide ? (r() - 0.5) * d * 0.8 : d / 2 + 0.05;
      kit.box(frame, 0.12, height, 0.06, x, height / 2, z, COLORS.alien, { glow: true, roll: (r() - 0.5) * 0.3, yaw: onSide ? Math.PI / 2 : 0 });
    }
    const podX = (r() - 0.5) * w * 0.6;
    kit.box(frame, 0.9, 0.7, 0.8, podX, 0.35, d / 2 + 0.5, COLORS.pod, { yaw: r() });
    kit.crystal(frame, 0.3, podX + 0.6, 0.6, d / 2 + 0.8, COLORS.alien);
  }

  /** A broken picket fence down both sides of the lot (one collider per side). */
  _buildFence(frame, house) {
    const kit = this.kit;
    const r = this.random;
    const { w, d } = house;
    const zFront = d / 2 + (house.porch ? HOUSE.porchDepth : 0) + 0.6;
    const zBack = -d / 2;
    const span = zFront - zBack;
    const midZ = (zFront + zBack) / 2;
    for (const side of [-1, 1]) {
      const x = side * (w / 2 + HOUSE.fenceGap * 0.6);
      for (const y of [0.35, 0.8]) kit.box(frame, 0.06, 0.1, span, x, y, midZ, COLORS.wood, { pitch: (r() - 0.5) * 0.06 });
      for (let z = zBack; z <= zFront; z += 1.3) {
        if (r() < 0.2) continue; // Missing posts
        kit.box(frame, 0.1, 1.0, 0.1, x, 0.5, z, COLORS.darkWood, { roll: (r() - 0.5) * 0.3 });
      }
      kit.collider(new THREE.Vector3(x, 0.5, midZ).applyMatrix4(frame), this._yawQuaternion(house.yaw), 0.06, 0.5, span / 2);
    }
  }

  /** An empty lot: a dead tree, maybe an old well, and what is left of a fence. */
  _buildEmptyLot(lot) {
    const kit = this.kit;
    const r = this.random;
    const frame = kit.frame(lot.x, this._ground(lot.x, lot.z), lot.z, lot.yaw);
    const tree = this._toWorld(lot, (r() - 0.5) * lot.w * 0.5, (r() - 0.5) * lot.d * 0.5);
    this._buildDeadTree(tree.x, tree.z, 5 + r() * 3);
    if (r() < 0.35) {
      const x = lot.w * 0.25;
      kit.cylinder(frame, 0.9, 0.9, x, 0, -lot.d * 0.2, COLORS.stone, { solid: true, segments: 10 });
      kit.cylinder(frame, 0.75, 0.05, x, 0.86, -lot.d * 0.2, COLORS.doorway, { segments: 10 });
      for (const side of [-1, 1]) kit.box(frame, 0.12, 1.6, 0.12, x + side * 0.8, 1.6, -lot.d * 0.2, COLORS.darkWood);
      kit.roof(frame, 2.0, 0.6, 1.2, x, 2.4, -lot.d * 0.2, this._pick(COLORS.roofs), { roll: 0.08 });
    }
    for (let i = 0; i < 3; i++) {
      kit.box(frame, 0.1, 1.0, 0.1, -lot.w / 2 + i * 1.3, 0.45, lot.d / 2, COLORS.darkWood, { roll: (r() - 0.5) * 0.6 });
    }
  }

  /** A dead tree: a leaning bare trunk with a few crooked branches. */
  _buildDeadTree(x, z, height) {
    const kit = this.kit;
    const r = this.random;
    const frame = kit.frame(x, this._ground(x, z), z, r() * Math.PI * 2);
    const lean = (r() - 0.5) * 0.16;
    kit.box(frame, 0.45, height, 0.45, 0, height / 2, 0, COLORS.bark, { pitch: lean });
    const branches = 3 + Math.floor(r() * 3);
    for (let i = 0; i < branches; i++) {
      const length = 1.4 + r() * 1.8;
      const pitch = 0.6 + r() * 0.5;
      const yaw = r() * Math.PI * 2;
      const at = height * (0.5 + r() * 0.45);
      const along = Math.sin(pitch) * length / 2;
      kit.box(frame, 0.16, length, 0.16, Math.sin(yaw) * along, at + Math.cos(pitch) * length / 2, Math.cos(yaw) * along + at * Math.sin(lean), COLORS.bark, { pitch, yaw });
    }
    const collider = this.kit.physicsWorld.createStaticCylinder(height / 2, 0.3, new THREE.Vector3(x, this._ground(x, z) + height / 2, z));
    if (collider) this.kit.colliders.push(collider);
    this._obstacles.push({ x, z, radius: 0.5 });
  }

  // ---------------------------------------------------------------------------
  // The graveyard, the ships
  // ---------------------------------------------------------------------------

  /** Beside the hall: a low wall, crooked headstones and crosses, open graves and a crypt. */
  _buildGraveyard() {
    const kit = this.kit;
    const r = this.random;
    const { x, z, w, d } = GRAVEYARD;
    const frame = kit.frame(x, this._ground(x, z), z);
    // Wall, with a way in on the west side, facing the hall
    const wall = (wx, wz, length, alongX) => kit.box(frame, alongX ? length : 0.5, 0.9, alongX ? 0.5 : length, wx, 0.45, wz, COLORS.darkStone, { solid: true });
    wall(0, -d / 2, w, true);
    wall(0, d / 2, w, true);
    wall(w / 2, 0, d, false);
    const gap = 4;
    wall(-w / 2, -(d / 2 + gap / 2) / 2, d / 2 - gap / 2, false);
    wall(-w / 2, (d / 2 + gap / 2) / 2, d / 2 - gap / 2, false);

    // A crypt in the back corner
    kit.box(frame, 5, 3.2, 4, w / 2 - 4, 1.6, -d / 2 + 3, COLORS.stone, { solid: true });
    kit.roof(frame, 5.6, 1.4, 4.6, w / 2 - 4, 3.2, -d / 2 + 3, COLORS.darkStone);
    kit.box(frame, 1.4, 2.2, 0.08, w / 2 - 4 - 2.54, 1.1, -d / 2 + 3, COLORS.doorway, { yaw: Math.PI / 2 });

    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 8; col++) {
        const gx = -w / 2 + 4 + col * 3.2 + (r() - 0.5) * 0.6;
        const gz = -d / 2 + 4 + row * 4.2 + (r() - 0.5) * 0.6;
        if (gx > w / 2 - 8 && gz < -d / 2 + 6) continue; // The crypt
        const kind = r();
        if (kind < 0.15) continue;
        const tilt = { pitch: (r() - 0.5) * 0.35, roll: (r() - 0.5) * 0.3, yaw: (r() - 0.5) * 0.2 };
        if (kind < 0.3) {
          // A cross
          kit.box(frame, 0.15, 1.3, 0.15, gx, 0.65, gz, COLORS.graveDark, tilt);
          kit.box(frame, 0.7, 0.14, 0.14, gx, 0.95, gz, COLORS.graveDark, tilt);
        } else if (kind < 0.4) {
          // An open grave and its heap of earth
          kit.box(frame, 1.0, 0.05, 2.0, gx, 0.03, gz + 1.0, COLORS.doorway);
          kit.box(frame, 1.1, 0.5, 1.2, gx + 1.1, 0.2, gz + 1.0, COLORS.earth, { yaw: 0.2 });
        } else {
          const height = 0.7 + r() * 0.5;
          kit.box(frame, 0.7, height, 0.18, gx, height / 2, gz, kind < 0.7 ? COLORS.grave : COLORS.graveDark, { ...tilt, solid: true });
        }
      }
    }
    this._buildDeadTree(x - w / 2 + 3, z + d / 2 - 3, 7);
    this._buildDeadTree(x + w / 2 - 3, z + d / 2 - 4, 6);
    this._block({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 }, 2);
  }

  /**
   * An alien ship that landed in the village: a saucer hull up on four legs (you can walk under
   * it), a glowing dome, rim lights and belly ring, a ramp down from the hatch, scorched ground
   * and crystals growing around it.
   */
  _buildShip(spec) {
    const kit = this.kit;
    const r = this.random;
    const { x, z, radius: R, yaw } = spec;
    const ground = this._ground(x, z);
    const frame = kit.frame(x, ground, z, yaw);
    const belly = SHIP_BELLY;

    // The hull: a faintly glowing underside up to the rim, grey metal above, a bright seam between
    const underside = [[0, 0], [0.3, 0], [0.75, 0.06], [1, 0.12]];
    const topside = [[1, 0.13], [0.96, 0.16], [0.72, 0.21], [0.35, 0.25], [0, 0.26]];
    kit.lathe(frame, underside.map(([a, b]) => [a * R, b * R]), 0, belly, 0, COLORS.belly, { glow: true, segments: 28 });
    kit.lathe(frame, [[R * 1.004, 0.12 * R], [R * 1.004, 0.13 * R]], 0, belly, 0, COLORS.alien, { glow: true, segments: 28 });
    kit.lathe(frame, topside.map(([a, b]) => [a * R, b * R]), 0, belly, 0, COLORS.hull, { segments: 28 });
    // A ring of lights under the belly
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
      kit.box(frame, 0.7, 0.06, 0.7, Math.sin(angle) * R * 0.55, belly + 0.03 * R - 0.02, Math.cos(angle) * R * 0.55, COLORS.alienBlue, { glow: true, yaw: angle });
    }
    const dome = [];
    for (let i = 0; i <= 6; i++) {
      const t = (i / 6) * Math.PI / 2;
      dome.push([0.3 * R * Math.cos(t), 0.2 * R * Math.sin(t)]);
    }
    kit.lathe(frame, dome, 0, belly + 0.25 * R, 0, COLORS.dome, { glow: true, segments: 20 });
    kit.box(frame, 0.12, 0.08 * R, 0.12, 0, belly + 0.45 * R + 0.04 * R, 0, COLORS.hullDark);
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      kit.box(frame, 0.5, 0.22, 0.22, Math.sin(angle) * R * 0.985, belly + 0.14 * R, Math.cos(angle) * R * 0.985, i % 2 ? COLORS.alien : COLORS.alienBlue, { glow: true, yaw: angle });
    }
    kit.cylinder(frame, 0.12 * R, 0.08, 0, belly - 0.04, 0, COLORS.dome, { glow: true, segments: 16 });
    const hullCollider = kit.physicsWorld.createStaticCylinder(0.13 * R, R * 0.98, new THREE.Vector3(x, ground + belly + 0.13 * R, z));
    if (hullCollider) kit.colliders.push(hullCollider);

    // Four legs, leaning in to the hull, with foot pads
    for (let i = 0; i < 4; i++) {
      const angle = Math.PI / 4 + (i * Math.PI) / 2;
      const top = 0.5 * R;
      const foot = 0.68 * R;
      const length = Math.hypot(belly, foot - top);
      const pitch = -Math.asin((foot - top) / length);
      const mid = (top + foot) / 2;
      kit.box(frame, 0.5, length, 0.5, Math.sin(angle) * mid, belly / 2, Math.cos(angle) * mid, COLORS.hullDark, { yaw: angle, pitch, solid: true });
      kit.cylinder(frame, 0.8, 0.25, Math.sin(angle) * foot, 0, Math.cos(angle) * foot, COLORS.hullDark, { segments: 8 });
      const legPoint = new THREE.Vector3(Math.sin(angle) * foot, 0, Math.cos(angle) * foot).applyMatrix4(frame);
      this._obstacles.push({ x: legPoint.x, z: legPoint.z, radius: 1 });
    }

    // The ramp down from the hatch, lit from inside
    const hatch = 0.3 * R;
    const run = 6.5;
    const rampLength = Math.hypot(belly, run);
    kit.box(frame, 2.6, 0.2, rampLength, 0, belly / 2, hatch + run / 2, COLORS.hullDark, { pitch: Math.atan2(belly, run), solid: true });
    kit.box(frame, 2.2, 0.05, 1.6, 0, belly - 0.03, hatch - 0.5, COLORS.alien, { glow: true });
    for (const side of [-1, 1]) kit.box(frame, 0.1, 0.1, rampLength, side * 1.25, belly / 2 + 0.15, hatch + run / 2, COLORS.alienBlue, { glow: true, pitch: Math.atan2(belly, run) });

    // Scorched ground, and crystals growing where it landed
    kit.cylinder(frame, 1.15 * R, 0.04, 0, 0, 0, COLORS.scorch, { segments: 24 });
    for (let i = 0; i < 6; i++) {
      const angle = r() * Math.PI * 2;
      const distance = R * (0.8 + r() * 0.35);
      for (let j = 0; j < 2 + Math.floor(r() * 2); j++) {
        kit.crystal(frame, 0.3 + r() * 0.4, Math.sin(angle) * distance + (r() - 0.5) * 1.5, 0.6, Math.cos(angle) * distance + (r() - 0.5) * 1.5, COLORS.alien);
      }
    }

    if (spec.light) {
      const light = new THREE.PointLight(0x7dffa0, 22, 28, 2);
      light.position.set(x, ground + belly - 0.8, z);
      this.group.add(light);
      this.lights.push(light);
    }

    this._reserved.push({ x, z, radius: R + SHIP_CLEARING });
    this.ships.push({
      x, z, radius: R, yaw, belly,
      ramp: new THREE.Vector3(0, 0, hatch + run + 1).applyMatrix4(frame)
    });
  }

  // ---------------------------------------------------------------------------
  // Lamp posts, dead trees, junk in the streets
  // ---------------------------------------------------------------------------

  _buildLampPosts() {
    const r = this.random;
    const near = (x, z, list, distance) => list.some((p) => Math.hypot(p.x - x, p.z - z) < distance);
    const posts = [];
    for (const lantern of LIT_LANTERNS) {
      this._lampPost(lantern.x, lantern.z, 'lit');
      const y = this._ground(lantern.x, lantern.z);
      const light = new THREE.PointLight(0xffb46b, 18, 24, 2);
      light.position.set(lantern.x, y + 3.2, lantern.z);
      this.group.add(light);
      this.lights.push(light);
      posts.push(lantern);
    }
    // Along the avenue, alternating sides, and along the cross streets
    const crossZ = CROSS_STREETS.map((c) => c.z);
    let side = 1;
    for (let z = GATE.z - 14; z > SQUARE.z + SQUARE.radius; z -= 28) {
      side = -side;
      if (crossZ.some((cz) => Math.abs(cz - z) < 8)) continue;
      const x = side * (AVENUE_WIDTH / 2 + 0.7);
      if (near(x, z, posts, 10)) continue;
      posts.push({ x, z });
      this._lampPost(x, z, r() < 0.4 ? 'glow' : 'dead');
    }
    for (const cross of CROSS_STREETS) {
      for (let x = -cross.reach + 10; x < cross.reach - 10; x += 45) {
        if (Math.abs(x) < 10 || SIDE_STREETS.some((s) => Math.abs(s.x - x) < 8)) continue;
        const z = cross.z + (r() < 0.5 ? -1 : 1) * (STREET_WIDTH / 2 + 0.6);
        posts.push({ x, z });
        this._lampPost(x, z, r() < 0.3 ? 'glow' : 'dead');
      }
    }
  }

  /** A lamp post: lit (with a real light), glowing, or dead and bent. */
  _lampPost(x, z, state) {
    const kit = this.kit;
    const r = this.random;
    const frame = kit.frame(x, this._ground(x, z), z, r() * Math.PI);
    const bent = state === 'dead' && r() < 0.4 ? 0.12 : 0;
    kit.box(frame, 0.16, 3.0, 0.16, 0, 1.5, 0, COLORS.darkWood, { pitch: bent });
    kit.box(frame, 0.35, 0.45, 0.35, 0, 3.2, bent * 1.6, state === 'dead' ? COLORS.deadLamp : COLORS.lamp, { glow: state !== 'dead' });
    const collider = kit.physicsWorld.createStaticCylinder(1.5, 0.1, new THREE.Vector3(x, this._ground(x, z) + 1.5, z));
    if (collider) kit.colliders.push(collider);
    this._obstacles.push({ x, z, radius: 0.4 });
  }

  /** Dead trees in back yards and gaps between the houses. */
  _scatterDeadTrees() {
    const r = this.random;
    const v = this.environment.village;
    let placed = 0;
    for (let attempt = 0; attempt < DEAD_TREES * 6 && placed < DEAD_TREES; attempt++) {
      const x = v.x + (r() * 2 - 1) * v.halfWidth;
      const z = v.z + (r() * 2 - 1) * v.halfLength;
      if (!this._isFree(x, z, 2)) continue;
      this._buildDeadTree(x, z, 5 + r() * 4);
      placed++;
    }
  }

  /** Crates and barrels left at the street sides: cover in a street fight. */
  _scatterStreetJunk() {
    const kit = this.kit;
    const r = this.random;
    let placed = 0;
    for (let attempt = 0; attempt < STREET_JUNK * 6 && placed < STREET_JUNK; attempt++) {
      const street = this.streets[Math.floor(r() * this.streets.length)];
      const t = r();
      const side = r() < 0.5 ? -1 : 1;
      const alongX = Math.abs(street.to.x - street.from.x) > Math.abs(street.to.z - street.from.z);
      const edge = street.width / 2 + 0.8;
      const x = street.from.x + (street.to.x - street.from.x) * t + (alongX ? 0 : side * edge);
      const z = street.from.z + (street.to.z - street.from.z) * t + (alongX ? side * edge : 0);
      if (!this._isFree(x, z, 1.2, 0.3)) continue;
      const frame = kit.frame(x, this._ground(x, z), z, r() * Math.PI);
      if (r() < 0.5) {
        kit.box(frame, 1.1, 1.0, 1.1, 0, 0.5, 0, COLORS.wood, { solid: true });
        if (r() < 0.4) kit.box(frame, 0.8, 0.7, 0.8, 0.1, 1.35, 0, COLORS.plank, { solid: true, yaw: 0.5 });
      } else {
        kit.cylinder(frame, 0.45, 1.0, 0, 0, 0, COLORS.hullDark, { solid: true, segments: 10 });
        if (r() < 0.5) kit.cylinder(frame, 0.45, 1.0, 1.0, 0, 0.2, COLORS.darkWood, { solid: true, segments: 10 });
      }
      this._obstacles.push({ x, z, radius: 1.2 });
      placed++;
    }
  }

  // ---------------------------------------------------------------------------
  // Pieces
  // ---------------------------------------------------------------------------

  /** A window on a wall face at (x, y, z), turned by `yaw` to face out: dark, boarded, shuttered or lit. */
  _window(frame, x, y, z, yaw) {
    const kit = this.kit;
    const r = this.random;
    const kind = r();
    if (kind < 0.05 || kind > 0.92) {
      kit.box(frame, 1.0, 0.9, 0.08, x, y, z, kind < 0.05 ? COLORS.litWindow : COLORS.alienWindow, { glow: true, yaw });
      return;
    }
    kit.box(frame, 1.0, 0.9, 0.08, x, y, z, COLORS.window, { yaw });
    const nx = Math.sin(yaw);
    const nz = Math.cos(yaw);
    if (kind < 0.45) {
      this._boards(frame, x + nx * 0.05, y, z + nz * 0.05, yaw, 1.3, 2 + Math.floor(r() * 2), 0.7);
    } else if (kind < 0.6) {
      // One shutter left, hanging off its hinge
      const side = r() < 0.5 ? -1 : 1;
      kit.box(frame, 0.5, 0.95, 0.05, x + Math.cos(yaw) * side * 0.78 + nx * 0.08, y - 0.1, z - Math.sin(yaw) * side * 0.78 + nz * 0.08, COLORS.plank, { yaw, roll: side * (0.2 + r() * 0.3) });
    }
  }

  /** Planks nailed across an opening, each a little crooked. */
  _boards(frame, x, y, z, yaw, width, count, crooked) {
    const r = this.random;
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * 0.32;
      this.kit.box(frame, width, 0.16, 0.05, x, y + offset, z, COLORS.plank, { yaw, roll: (r() - 0.5) * crooked });
    }
  }

  // ---------------------------------------------------------------------------
  // Layout helpers
  // ---------------------------------------------------------------------------

  _ground(x, z) {
    return this.environment.heightAt(x, z);
  }

  _pick(list) {
    return list[Math.floor(this.random() * list.length)];
  }

  _yawQuaternion(yaw) {
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  }

  /** A point in a house's own frame (x across, z out of the front door) in world x, z. */
  _toWorld(house, lx, lz) {
    const cos = Math.cos(house.yaw);
    const sin = Math.sin(house.yaw);
    return { x: house.x + lx * cos + lz * sin, z: house.z - lx * sin + lz * cos };
  }

  /** The world rectangle a lot covers (the house, its porch and its fences). */
  _footprint(house) {
    const halfW = house.w / 2 + (house.fence ? HOUSE.fenceGap : 0);
    const front = house.d / 2 + (house.porch ? HOUSE.porchDepth : 0) + (house.fence ? 0.6 : 0);
    const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const lx of [-halfW, halfW]) {
      for (const lz of [-house.d / 2, front]) {
        const p = this._toWorld(house, lx, lz);
        bounds.minX = Math.min(bounds.minX, p.x);
        bounds.maxX = Math.max(bounds.maxX, p.x);
        bounds.minZ = Math.min(bounds.minZ, p.z);
        bounds.maxZ = Math.max(bounds.maxZ, p.z);
      }
    }
    return bounds;
  }

  _block(bounds, margin) {
    this._blocked.push({ minX: bounds.minX - margin, maxX: bounds.maxX + margin, minZ: bounds.minZ - margin, maxZ: bounds.maxZ + margin });
  }

  /** True if a lot fits: on the plateau, off the streets, clear of everything placed so far. */
  _fits(bounds, besideSquare = false) {
    const env = this.environment;
    for (const x of [bounds.minX, bounds.maxX]) {
      for (const z of [bounds.minZ, bounds.maxZ]) {
        if (!env.isInVillage(x, z, -EDGE_MARGIN)) return false;
      }
    }
    if (this._streetRects.some((rect) => rectsOverlap(bounds, rect, 0.8))) return false;
    if (this._blocked.some((rect) => rectsOverlap(bounds, rect, 1.2))) return false;
    return !this._reserved.some((c) => !(besideSquare && c.square) && rectTouchesCircle(bounds, c));
  }

  /**
   * True if a small thing (tree, crate) of `radius` can stand at (x, z): on the plateau, at least
   * `streetMargin` off the streets, clear of buildings, doorsteps and other obstacles.
   */
  _isFree(x, z, radius, streetMargin = radius) {
    if (!this.environment.isInVillage(x, z, -EDGE_MARGIN)) return false;
    const point = { minX: x, maxX: x, minZ: z, maxZ: z };
    if (this._streetRects.some((rect) => rectsOverlap(point, rect, streetMargin))) return false;
    if (this._blocked.some((rect) => rectsOverlap(point, rect, radius))) return false;
    const touches = (c) => Math.hypot(x - c.x, z - c.z) < c.radius + radius;
    return !this._reserved.some(touches) && !this._obstacles.some(touches) && !this._keepClear.some(touches);
  }

  /**
   * The nearest spot on a street to (x, z): on the street's middle line, moved over towards (x, z)
   * but kept a meter inside the street's edge.
   * @returns {{x: number, z: number}}
   */
  streetSpotNear(x, z) {
    let best = null;
    let bestDistance = Infinity;
    for (const street of this.streets) {
      const cx = Math.max(Math.min(street.from.x, street.to.x), Math.min(x, Math.max(street.from.x, street.to.x)));
      const cz = Math.max(Math.min(street.from.z, street.to.z), Math.min(z, Math.max(street.from.z, street.to.z)));
      const distance = Math.hypot(x - cx, z - cz);
      if (distance < bestDistance) {
        bestDistance = distance;
        const over = Math.min(distance, street.width / 2 - 1);
        best = distance > 0
          ? { x: cx + ((x - cx) / distance) * over, z: cz + ((z - cz) / distance) * over }
          : { x: cx, z: cz };
      }
    }
    return best;
  }

  /** True if (x, z) is open ground (not inside a house, the hall, a wall, a tree or a ship's leg). */
  isOpenGround(x, z, margin = 0.5) {
    const point = { minX: x, maxX: x, minZ: z, maxZ: z };
    for (const house of this.houses) {
      if (rectsOverlap(point, house.bounds, margin)) return false;
    }
    if (this.hall.contains(x, z)) return this.hall.isOpenFloor(x, z, margin);
    const hall = this.hall.bounds;
    if (rectsOverlap(point, hall, margin)) return false;
    const g = GRAVEYARD;
    if (rectsOverlap(point, { minX: g.x - g.w / 2, maxX: g.x + g.w / 2, minZ: g.z - g.d / 2, maxZ: g.z + g.d / 2 }, margin)) return false;
    return !this._obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.radius + margin);
  }

  dispose() {
    if (this.hall) {
      this.hall.dispose();
      this.hall = null;
    }
    for (const light of this.lights) {
      if (light.parent) light.parent.remove(light);
      light.dispose();
    }
    this.lights = [];
    this.kit.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

function rectsOverlap(a, b, margin) {
  return a.minX < b.maxX + margin && a.maxX > b.minX - margin && a.minZ < b.maxZ + margin && a.maxZ > b.minZ - margin;
}

function rectTouchesCircle(rect, circle) {
  const x = Math.max(rect.minX, Math.min(circle.x, rect.maxX));
  const z = Math.max(rect.minZ, Math.min(circle.z, rect.maxZ));
  return Math.hypot(x - circle.x, z - circle.z) < circle.radius;
}
