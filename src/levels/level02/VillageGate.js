import * as THREE from 'three';

// The village gate: where the beach layout's jungle path tops the plateau rim and the village
// road runs on. Everything is measured off `pathCentreX(GATE_Z)` at build time, so the gate
// straddles the path by construction. The numbers below come from a terrain/clearance probe of
// the plateau: the whole site is flat (h ~ 12 m), the gate line spans x -40..40 clear of solid
// cover, and the watchtower feet and the garrison posts are all on open ground.
const GATE_Z = -252;          // The plateau rim where the path meets the village
const POST_OFFSET = 7.5;      // Half the width of the opening (the frame posts)
const POST_HEIGHT = 8.2;      // The frame posts tower over the squad
const BEAM_TOP = 9.0;         // The crossbeam's centre, above the opening
const TOWER_OFFSET = 13;      // Watchtowers flank the opening, a step south of the wall line
const TOWER_Z = -247;
const TOWER_TOP = 6.4;        // The platform's walking surface, above the tower's own ground
const RIDGE_PERCH = { x: -25, z: -215 }; // The high ground west of the path (h ~ 14.3 m)
// The garrison's posts behind the line (offsets from the gate centre; the pairs are the queue)
const DEFENSE_SPOTS = [
  { dx: -5.5, dz: -3.4 },
  { dx: 5.5, dz: -3.4 },
  { dx: -2.8, dz: -5.2 },
  { dx: 2.8, dz: -5.2 },
  { dx: -7.5, dz: -6.0 },
  { dx: 7.5, dz: -6.0 }
];

const _quaternion = new THREE.Quaternion();

/**
 * VillageGate
 * Level 2's last set piece: the massive alien gate on the plateau rim, closing the path into
 * the village (Level 3). Two towering frame posts and a crossbeam over the opening, broken
 * walls running outward along the rim, and a watchtower on either flank — snipers' perches —
 * with a third ledge on the ridge west of the path. Behind the line, the garrison's posts.
 * Static structure: every solid part is a static box collider (see BeachWreckage for the
 * pattern); the clearings keep the trees and rocks off the site.
 */
export class VillageGate {
  /**
   * @param {GameWorld} gameWorld
   * @param {BeachEnvironment} environment
   */
  constructor(gameWorld, environment) {
    this.gameWorld = gameWorld;
    this.environment = environment;

    const x = environment.pathCentreX(GATE_Z);
    const y = environment.heightAt(x, GATE_Z);
    this.centre = { x, y, z: GATE_Z };

    /** Where the push inland ends: just through the opening, on the village road. */
    this.through = { x, y: environment.heightAt(x, GATE_Z - 6), z: GATE_Z - 6 };
    /** The gate approach, south of the line: where the garrison is sent to push the squad back. */
    this.approach = { x, y: environment.heightAt(x, GATE_Z + 10), z: GATE_Z + 10 };
    /** Where the gate walker steps out of the opening when it comes. */
    this.heavySpawn = { x, y: environment.heightAt(x, GATE_Z - 5), z: GATE_Z - 5 };

    /** The snipers' posts: both watchtower platforms and the ridge ledge (feet positions). */
    this.perches = [];
    for (const side of [-1, 1]) {
      const tx = x + side * TOWER_OFFSET;
      this.perches.push({ x: tx, y: environment.heightAt(tx, TOWER_Z) + TOWER_TOP + 0.05, z: TOWER_Z });
    }
    this.perches.push({
      x: RIDGE_PERCH.x,
      y: environment.heightAt(RIDGE_PERCH.x, RIDGE_PERCH.z) + 0.05,
      z: RIDGE_PERCH.z
    });

    /** The garrison's spawn posts, behind the line (feet positions). */
    this.defensePosts = DEFENSE_SPOTS.map(({ dx, dz }) => {
      const px = x + dx;
      const pz = GATE_Z + dz;
      return { x: px, y: environment.heightAt(px, pz) + 0.05, z: pz };
    });

    /** Ground the trees and rocks must leave open (the gate yard, and the ridge sniper's ledge). */
    this.clearings = [
      { x, z: GATE_Z, radius: 28 },
      { x: RIDGE_PERCH.x, z: RIDGE_PERCH.z, radius: 5 }
    ];

    this.mesh = new THREE.Group();
    this.mesh.name = 'VillageGate';
    this.colliders = [];

    this.materials = {
      stone: new THREE.MeshStandardMaterial({ color: 0x565b60, roughness: 0.85, flatShading: true }),
      darkStone: new THREE.MeshStandardMaterial({ color: 0x3c4146, roughness: 0.8, flatShading: true }),
      metal: new THREE.MeshStandardMaterial({ color: 0x4a5054, roughness: 0.6, metalness: 0.5, flatShading: true }),
      glow: new THREE.MeshStandardMaterial({ color: 0x6dff8f, emissive: 0x6dff8f, emissiveIntensity: 1.6, toneMapped: false })
    };
  }

  build() {
    const { x: cx, y: ground } = this.centre;
    const { stone, darkStone, metal, glow } = this.materials;

    // --- The frame: two massive posts with glowing veins, and the crossbeam over the opening ---
    for (const side of [-1, 1]) {
      const px = cx + side * POST_OFFSET;
      this._add(new THREE.BoxGeometry(2.4, POST_HEIGHT, 2.4), stone, px, ground + POST_HEIGHT / 2, GATE_Z);
      this._add(new THREE.BoxGeometry(2.7, 0.7, 2.7), darkStone, px, ground + POST_HEIGHT + 0.2, GATE_Z);
      // The vein: a strip of alien green down the south face, facing the approach
      this._add(new THREE.BoxGeometry(0.36, POST_HEIGHT - 2.4, 0.12), glow, px, ground + POST_HEIGHT / 2, GATE_Z + 1.26);
      this._addCollider({ x: 1.2, y: POST_HEIGHT / 2, z: 1.2 }, { x: px, y: ground + POST_HEIGHT / 2, z: GATE_Z });
    }

    const beamWidth = POST_OFFSET * 2 + 2.4 + 1.2;
    this._add(new THREE.BoxGeometry(beamWidth, 1.6, 2.8), darkStone, cx, ground + BEAM_TOP, GATE_Z);
    this._add(new THREE.BoxGeometry(POST_OFFSET * 2 - 1.0, 0.18, 0.18), glow, cx, ground + BEAM_TOP - 0.9, GATE_Z + 1.42);
    this._addCollider({ x: beamWidth / 2, y: 0.8, z: 1.4 }, { x: cx, y: ground + BEAM_TOP, z: GATE_Z });
    // Blades along the beam's top edge, leaning alternately
    for (let i = -2; i <= 2; i++) {
      const blade = this._add(new THREE.BoxGeometry(0.5, 1.2, 0.5), metal, cx + i * 3.4, ground + BEAM_TOP + 1.35, GATE_Z);
      blade.rotation.z = i % 2 === 0 ? 0.28 : -0.28;
    }

    // --- The walls: broken segments running outward along the rim, dropping as they go ---
    for (const side of [-1, 1]) {
      const segments = [
        { dx: 11.2, width: 5.0, height: 3.0 },
        { dx: 17.8, width: 5.0, height: 2.4 },
        { dx: 24.0, width: 3.0, height: 1.5 }
      ];
      for (const segment of segments) {
        const sx = cx + side * segment.dx;
        this._addWallSegment(sx, segment.width, segment.height, ground);
      }
      // Rubble at the wall's foot: a couple of fallen blocks
      this._add(new THREE.BoxGeometry(1.1, 0.7, 1.0), stone, cx + side * 14.6, ground + 0.35, GATE_Z - 1.8).rotation.y = side * 0.4;
      this._add(new THREE.BoxGeometry(0.8, 0.5, 0.8), darkStone, cx + side * 21.4, ground + 0.25, GATE_Z + 1.6).rotation.y = side * -0.7;
    }

    // --- The watchtowers: four legs, a platform, a rail, a ladder ---
    for (const side of [-1, 1]) this._buildWatchtower(cx + side * TOWER_OFFSET, TOWER_Z);

    this.mesh.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    this.gameWorld.environmentGroup.add(this.mesh);

    console.log(`[VillageGate] Gate at (${cx.toFixed(1)}, ${GATE_Z}): ${this.colliders.length} colliders, ` +
      `${this.perches.length} perches, ${this.defensePosts.length} posts.`);
  }

  _addWallSegment(x, width, height, ground) {
    const { stone, darkStone } = this.materials;
    this._add(new THREE.BoxGeometry(width, height, 1.7), stone, x, ground + height / 2, GATE_Z);
    this._add(new THREE.BoxGeometry(width + 0.3, 0.35, 1.9), darkStone, x, ground + height + 0.1, GATE_Z);
    this._addCollider({ x: width / 2, y: height / 2, z: 0.85 }, { x, y: ground + height / 2, z: GATE_Z });
  }

  /** One watchtower: legs sunk into the ground, a platform at TOWER_TOP, a rail and a ladder. */
  _buildWatchtower(tx, tz) {
    const { darkStone, metal, glow } = this.materials;
    const ground = this.environment.heightAt(tx, tz);

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        // Legs run half a metre into the ground: the east flank's ground falls away a little
        this._add(new THREE.BoxGeometry(0.4, TOWER_TOP + 1.0, 0.4), metal,
          tx + sx * 1.55, ground + TOWER_TOP / 2 - 0.5, tz + sz * 1.55);
      }
    }

    const platformY = ground + TOWER_TOP - 0.21;
    this._add(new THREE.BoxGeometry(4.8, 0.42, 4.8), darkStone, tx, platformY, tz);
    this._addCollider({ x: 2.4, y: 0.21, z: 2.4 }, { x: tx, y: platformY, z: tz });

    // Rails on three sides (the south edge stays open: that is where the sniper watches)
    for (const edge of [
      { x: 0, z: -2.3, w: 4.8, d: 0.12 },
      { x: -2.3, z: 0, w: 0.12, d: 4.8 },
      { x: 2.3, z: 0, w: 0.12, d: 4.8 }
    ]) {
      this._add(new THREE.BoxGeometry(edge.w, 0.12, edge.d), metal, tx + edge.x, ground + TOWER_TOP + 0.75, tz + edge.z);
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this._add(new THREE.BoxGeometry(0.12, 0.9, 0.12), metal, tx + sx * 2.3, ground + TOWER_TOP + 0.45, tz + sz * 2.3);
      }
    }
    // A green lamp on the rail: the towers' own little beacon over the gate
    this._add(new THREE.BoxGeometry(0.4, 0.4, 0.4), glow, tx, ground + TOWER_TOP + 0.55, tz - 2.3);

    // The ladder up the south face
    for (const sx of [-1, 1]) {
      this._add(new THREE.BoxGeometry(0.08, TOWER_TOP - 0.4, 0.08), metal, tx + sx * 0.5, ground + (TOWER_TOP - 0.4) / 2, tz + 1.62);
    }
    for (let i = 0; i < 7; i++) {
      this._add(new THREE.BoxGeometry(1.0, 0.06, 0.06), metal, tx, ground + 0.6 + i * 0.86, tz + 1.62);
    }
  }

  _addCollider(halfExtents, centre) {
    const collider = this.gameWorld.physics.createStaticBox(halfExtents, centre, _quaternion.identity());
    if (collider) this.colliders.push(collider);
  }

  _add(geometry, material, x, y, z) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    this.mesh.add(mesh);
    return mesh;
  }

  dispose() {
    for (const collider of this.colliders) {
      this.gameWorld.physics.removeRigidBody(collider.rigidBody);
    }
    this.colliders = [];

    this.mesh.traverse((child) => { if (child.geometry) child.geometry.dispose(); });
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);

    for (const material of Object.values(this.materials)) material.dispose();
  }
}
