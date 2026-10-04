import * as THREE from 'three';

// The hall, in its own frame: the entrance faces +z (towards the square)
const WIDTH = 24;
const DEPTH = 30;
const WALL_HEIGHT = 9;
const WALL = 0.8;              // Wall thickness
const ENTRANCE_WIDTH = 7;
const ENTRANCE_HEIGHT = 6.5;
const ROOF_RISE = 5;
const FLOOR = 0.15;            // Stone floor, a step up from the ground
const PILLAR_RADIUS = 0.7;
const PILLAR_X = 5.5;
const PILLAR_Z = [-8, 0, 8];
const DAIS = { width: 10, height: 0.4, depth: 5 }; // Where the Warden waits, at the back
const WINDOW_Z = [-9, 0, 9];
const CAGE_X = 8.6;      // Hostage cages: between the pillars and the side walls...
const CAGE_Z = [-4, 4];  // ...between the pillars along the hall

const COLORS = {
  stone: 0x8f8778,
  darkStone: 0x5f5a52,
  floor: 0x6e675d,
  roof: 0x5a3b2e,
  beam: 0x4a3627,
  window: 0x3f9e8f,      // Lit from inside by the aliens' green glow
  alien: 0x6dff8f
};

/**
 * VillageHall
 * The old village hall at the north side of the square: stone walls, a wide entrance facing the
 * square, glowing windows, two rows of pillars down the hall and a dais at the back where the
 * Warden waits. Alien conduits glow green on the pillars, and a green light fills the hall.
 * Built with the village's BuildingKit (merged with the rest of the village); this class keeps
 * the hall's layout for the level: entrance, pillars, dais, bounds.
 */
export class VillageHall {
  /**
   * @param {THREE.Vector3} centre - Ground point at the middle of the hall
   * @param {number} [yaw=0] - Which way the entrance faces (0 = +z, south)
   */
  constructor(centre, yaw = 0) {
    this.centre = centre.clone();
    this.yaw = yaw;
    this.width = WIDTH;
    this.depth = DEPTH;
    this.wallHeight = WALL_HEIGHT;
    this.entranceWidth = ENTRANCE_WIDTH;
    this.entranceHeight = ENTRANCE_HEIGHT;

    this.entrance = new THREE.Vector3();   // Just outside the doorway
    this.doorway = new THREE.Vector3();    // In the doorway
    this.dais = new THREE.Vector3();       // Top centre of the dais
    this.pillars = [];                     // Base centre of each pillar: left row back to front, then the right row
    this.supplyPoint = new THREE.Vector3(); // Just inside the door, to one side (a supply crate)
    this.cageSpots = [];                   // Floor points between the pillars and the side walls (hostage cages)
    this.forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); // From the dais towards the door
    this.light = null;
    this._frame = null;
  }

  /**
   * Lays the hall out with `kit` (walls, colliders) and adds its light to `group`.
   * @param {BuildingKit} kit
   * @param {THREE.Group} group
   */
  build(kit, group) {
    const frame = kit.frame(this.centre.x, this.centre.y, this.centre.z, this.yaw);
    this._frame = frame;
    const halfW = WIDTH / 2;
    const halfD = DEPTH / 2;
    const midH = WALL_HEIGHT / 2;

    // Walls: back, sides, and the front either side of the entrance, with a lintel over it
    kit.box(frame, WIDTH, WALL_HEIGHT, WALL, 0, midH, -halfD + WALL / 2, COLORS.stone, { solid: true });
    for (const side of [-1, 1]) {
      kit.box(frame, WALL, WALL_HEIGHT, DEPTH, side * (halfW - WALL / 2), midH, 0, COLORS.stone, { solid: true });
      const segment = (WIDTH - ENTRANCE_WIDTH) / 2;
      kit.box(frame, segment, WALL_HEIGHT, WALL, side * (ENTRANCE_WIDTH / 2 + segment / 2), midH, halfD - WALL / 2, COLORS.stone, { solid: true });
      // Windows high up the side walls, glowing from inside
      for (const z of WINDOW_Z) {
        kit.box(frame, WALL + 0.1, 2.6, 2.0, side * (halfW - WALL / 2), 5.6, z, COLORS.window, { glow: true });
      }
    }
    const lintel = WALL_HEIGHT - ENTRANCE_HEIGHT;
    kit.box(frame, ENTRANCE_WIDTH, lintel, WALL, 0, ENTRANCE_HEIGHT + lintel / 2, halfD - WALL / 2, COLORS.darkStone, { solid: true });
    // A plinth course around the base
    kit.box(frame, WIDTH + 0.3, 0.6, 0.3, 0, 0.3, -halfD - 0.05, COLORS.darkStone);

    // Floor, pillars with alien conduits, and the dais
    kit.box(frame, WIDTH - 2 * WALL, FLOOR, DEPTH - 2 * WALL, 0, FLOOR / 2, 0, COLORS.floor, { solid: true });
    for (const side of [-1, 1]) {
      for (const z of PILLAR_Z) {
        const pillar = kit.cylinder(frame, PILLAR_RADIUS, WALL_HEIGHT - FLOOR, side * PILLAR_X, FLOOR, z, COLORS.darkStone, { solid: true });
        this.pillars.push(new THREE.Vector3(pillar.position.x, this.centre.y + FLOOR, pillar.position.z));
        kit.box(frame, 0.16, 5.5, 0.16, side * (PILLAR_X - PILLAR_RADIUS - 0.02), FLOOR + 3.2, z, COLORS.alien, { glow: true });
      }
    }
    const daisZ = -halfD + WALL + DAIS.depth / 2;
    kit.box(frame, DAIS.width, DAIS.height, DAIS.depth, 0, FLOOR + DAIS.height / 2, daisZ, COLORS.darkStone, { solid: true });
    kit.crystal(frame, 1.1, 0, FLOOR + DAIS.height + 2.6, -halfD + WALL + 0.9, COLORS.alien);

    // Roof: beams across, a gable over them, and a slab collider so cameras stay inside
    for (const z of [-10, 0, 10]) {
      kit.box(frame, WIDTH - 2 * WALL, 0.4, 0.4, 0, WALL_HEIGHT - 0.3, z, COLORS.beam);
    }
    kit.roof(frame, WIDTH + 1.2, ROOF_RISE, DEPTH + 1.2, 0, WALL_HEIGHT, 0, COLORS.roof);
    const roofCentre = new THREE.Vector3(0, WALL_HEIGHT + 0.15, 0).applyMatrix4(frame);
    kit.collider(roofCentre, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw), halfW, 0.15, halfD);

    // Layout for the level
    this.doorway.set(0, 0, halfD).applyMatrix4(frame);
    this.entrance.set(0, 0, halfD + 4).applyMatrix4(frame);
    this.dais.set(0, FLOOR + DAIS.height, daisZ).applyMatrix4(frame);
    this.supplyPoint.set(halfW - WALL - 2.5, 0, halfD - WALL - 2.5).applyMatrix4(frame);
    for (const side of [-1, 1]) {
      for (const z of CAGE_Z) this.cageSpots.push(new THREE.Vector3(side * CAGE_X, FLOOR, z).applyMatrix4(frame));
    }
    this._daisDepthZ = daisZ;

    // The aliens' green glow fills the hall
    this.light = new THREE.PointLight(0x7dffa0, 30, 32, 2);
    this.light.position.set(0, 5, daisZ + 2).applyMatrix4(frame);
    group.add(this.light);
  }

  /** The hall's footprint on the ground (world x/z extents, for spawning and checks). */
  get bounds() {
    const halfW = WIDTH / 2;
    const halfD = DEPTH / 2;
    const corners = [[-halfW, -halfD], [halfW, -halfD], [-halfW, halfD], [halfW, halfD]]
      .map(([x, z]) => new THREE.Vector3(x, 0, z).applyMatrix4(this._frame));
    return {
      minX: Math.min(...corners.map((c) => c.x)),
      maxX: Math.max(...corners.map((c) => c.x)),
      minZ: Math.min(...corners.map((c) => c.z)),
      maxZ: Math.max(...corners.map((c) => c.z))
    };
  }

  /** True if (x, z) is inside the hall's walls. */
  contains(x, z) {
    const local = this._toLocal(x, z);
    return Math.abs(local.x) < WIDTH / 2 - WALL && Math.abs(local.z) < DEPTH / 2 - WALL;
  }

  /**
   * True if someone can stand at (x, z) inside the hall: clear of the walls, the pillars and the
   * dais by `margin`.
   */
  isOpenFloor(x, z, margin = 0.5) {
    const local = this._toLocal(x, z);
    if (Math.abs(local.x) > WIDTH / 2 - WALL - margin || Math.abs(local.z) > DEPTH / 2 - WALL - margin) return false;
    for (const side of [-1, 1]) {
      for (const pz of PILLAR_Z) {
        if (Math.hypot(local.x - side * PILLAR_X, local.z - pz) < PILLAR_RADIUS + margin) return false;
      }
    }
    return !(Math.abs(local.x) < DAIS.width / 2 + margin && Math.abs(local.z - this._daisDepthZ) < DAIS.depth / 2 + margin);
  }

  _toLocal(x, z) {
    if (!this._inverse) this._inverse = new THREE.Matrix4().copy(this._frame).invert();
    return new THREE.Vector3(x, 0, z).applyMatrix4(this._inverse);
  }

  dispose() {
    if (this.light) {
      if (this.light.parent) this.light.parent.remove(this.light);
      this.light.dispose();
      this.light = null;
    }
  }
}
