import * as THREE from 'three';
import { AnchoredShip } from './AnchoredShip.js';
import { HelicopterModel } from '../../entities/models/HelicopterModel.js';

// Ship placement: side-on to the landing beach with its starboard side facing the island
const SHIP_POSITION = new THREE.Vector3(0, 0, 225);
const SHIP_HEADING = Math.PI / 2;

// Boarding layout in the ship's local frame (meters). The deck sits at 4.92 m with a 1.14 m
// railing along the side (x ≈ 9.75–10.4 here), too high to step over, so a short ramp climbs
// onto a platform just above the railing and the gangway runs from its outer edge down to the sand.
// Ramps rather than steps: the character controller climbs slopes smoothly but stalls on 0.4 m risers.
const DECK_HEIGHT = 4.92;
const PLATFORM_HEIGHT = 6.12;    // Just above the railing top (6.06)
const BOARDING_Z = -10;          // Open starboard deck beside the rear main gun
const BOARDING_WIDTH = 2.4;
const RAMP_START_X = 6.2;        // Foot of the ramp on deck (the raised gun platform starts inboard of x ≈ 5.5)
const PLATFORM_INNER_X = 9.2;
const PLATFORM_OUTER_X = 11.0;   // Just outboard of the railing
const SLAB_DEPTH = 0.6;          // Collider thickness under walking surfaces
const GANGWAY_FOOT_X = 29;       // Lands on dry sand at world z = 196
const DECK_SPAWN_X = 6.9;        // On the foot of the ramp, facing the beach

// Helicopters parked on the beach either side of the gangway (world x, z, heading)
const HELICOPTER_SPOTS = [
  { x: -45, z: 180, heading: 0.25 },
  { x: 28, z: 180, heading: -0.2 }
];
const HELICOPTER_IDLE_ROTOR_SPEED = 3.0; // rad/s: engines ticking over after landing
const HELICOPTER_COVER_CENTRE = new THREE.Vector3(0, 2.0, 0.2);
const HELICOPTER_COVER_HALF = { x: 1.3, y: 1.2, z: 3.3 };

/**
 * LandingZone
 * Level 2's arrival point: our battleship anchored off the beach, a boarding ramp and a
 * gangway down to the sand, and the two helicopters parked on the beach as cover.
 */
export class LandingZone {
  /**
   * @param {GameWorld} gameWorld
   * @param {BeachEnvironment} environment - Supplies ground heights for the gangway foot and skids
   */
  constructor(gameWorld, environment) {
    this.gameWorld = gameWorld;
    this.physicsWorld = gameWorld.physics;
    this.environment = environment;

    this.ship = null;
    this.boarding = null;
    this.helicopters = [];
    this.colliders = [];
    this.spawnPoints = {};
    this.clearings = []; // { x, z, radius } circles that scenery must leave open

    this.materials = {
      metal: new THREE.MeshStandardMaterial({ color: 0x59616a, roughness: 0.55, metalness: 0.6 }),
      rail: new THREE.MeshStandardMaterial({ color: 0xb3bcc4, roughness: 0.4, metalness: 0.7 })
    };

    // Scratchpads for collider placement
    this._worldPos = new THREE.Vector3();
    this._worldQuat = new THREE.Quaternion();
  }

  async build() {
    const group = this.gameWorld.environmentGroup;

    // 1. Anchored ship
    this.ship = new AnchoredShip(this.gameWorld, { position: SHIP_POSITION, heading: SHIP_HEADING });
    await this.ship.load();
    group.add(this.ship.mesh);

    // 2. Boarding ramp, platform and gangway, built in the ship's frame
    this.boarding = new THREE.Group();
    this.boarding.name = 'LandingZone_Boarding';
    this.boarding.position.copy(this.ship.mesh.position);
    this.boarding.quaternion.copy(this.ship.mesh.quaternion);
    this.boarding.updateMatrixWorld(true);
    group.add(this.boarding);
    this._buildBoarding();

    // 3. Helicopters parked on the sand
    for (const spot of HELICOPTER_SPOTS) {
      this._parkHelicopter(spot);
    }
  }

  /**
   * Ramp from the deck up to a platform over the railing, then the gangway down to the sand.
   */
  _buildBoarding() {
    // Platform over the railing: a block reaching 0.3 m into the deck so there is no seam
    const bottom = DECK_HEIGHT - 0.3;
    const size = new THREE.Vector3(PLATFORM_OUTER_X - PLATFORM_INNER_X, PLATFORM_HEIGHT - bottom, BOARDING_WIDTH);
    const centre = new THREE.Vector3((PLATFORM_INNER_X + PLATFORM_OUTER_X) / 2, (PLATFORM_HEIGHT + bottom) / 2, BOARDING_Z);
    const platform = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), this.materials.metal);
    platform.position.copy(centre);
    platform.castShadow = true;
    platform.receiveShadow = true;
    this.boarding.add(platform);
    this._addBoardingCollider(centre, size, null);

    // Ramp up from the deck
    const rampFoot = new THREE.Vector3(RAMP_START_X, DECK_HEIGHT, BOARDING_Z);
    const platformInner = new THREE.Vector3(PLATFORM_INNER_X, PLATFORM_HEIGHT, BOARDING_Z);
    this._buildWalkway(rampFoot, platformInner, { rails: false });

    // Gangway down to the sand
    const platformOuter = new THREE.Vector3(PLATFORM_OUTER_X, PLATFORM_HEIGHT, BOARDING_Z);
    const footWorld = this.ship.localToWorld(GANGWAY_FOOT_X, 0, BOARDING_Z);
    const gangwayFoot = new THREE.Vector3(GANGWAY_FOOT_X, this.environment.heightAt(footWorld.x, footWorld.z), BOARDING_Z);
    this._buildWalkway(platformOuter, gangwayFoot, { rails: true });

    const rampT = (DECK_SPAWN_X - RAMP_START_X) / (PLATFORM_INNER_X - RAMP_START_X);
    const spawnY = DECK_HEIGHT + rampT * (PLATFORM_HEIGHT - DECK_HEIGHT) + 0.15;
    this.spawnPoints.deck = this.ship.localToWorld(DECK_SPAWN_X, spawnY, BOARDING_Z);
    this.spawnPoints.gangwayFoot = this.ship.localToWorld(gangwayFoot.x + 1.5, gangwayFoot.y + 0.3, gangwayFoot.z);

    // Keep the gangway's foot and the walk up the beach open
    this.clearings.push({ x: footWorld.x, z: footWorld.z, radius: 10 });
    this.clearings.push({ x: footWorld.x, z: footWorld.z - 14, radius: 8 });
  }

  /**
   * A sloped walkway between two points in the ship's frame that differ only in x and y.
   * The collider is a deep slab whose top face is the walking surface; its lower end runs 1 m
   * on into the deck or sand so there is no lip, and its upper end stops flush with the platform.
   */
  _buildWalkway(start, end, { rails }) {
    const high = start.y >= end.y ? start : end;
    const low = start.y >= end.y ? end : start;
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const length = start.distanceTo(end);

    // Visual: local +X runs from start to end, the walking surface lies on the group's origin plane
    const walkway = new THREE.Group();
    walkway.position.addVectors(start, end).multiplyScalar(0.5);
    walkway.rotation.z = angle;
    this.boarding.add(walkway);

    const halfWidth = BOARDING_WIDTH / 2;
    this._addPart(walkway, new THREE.BoxGeometry(length, 0.12, BOARDING_WIDTH), this.materials.metal, 0, -0.06, 0);
    for (const side of [-1, 1]) {
      this._addPart(walkway, new THREE.BoxGeometry(length, 0.35, 0.1), this.materials.metal, 0, -0.15, side * halfWidth);
    }
    if (rails) {
      const posts = Math.floor(length / 2) + 1;
      for (const side of [-1, 1]) {
        this._addPart(walkway, new THREE.BoxGeometry(length, 0.06, 0.06), this.materials.rail, 0, 1.0, side * halfWidth);
        for (let i = 0; i < posts; i++) {
          const x = -length / 2 + (i * length) / (posts - 1);
          this._addPart(walkway, new THREE.BoxGeometry(0.06, 1.0, 0.06), this.materials.rail, x, 0.5, side * halfWidth);
        }
      }
    } else {
      // Grip cleats across the ramp
      for (let x = -length / 2 + 0.3; x < length / 2; x += 0.45) {
        this._addPart(walkway, new THREE.BoxGeometry(0.05, 0.03, BOARDING_WIDTH - 0.2), this.materials.rail, x, 0.015, 0);
      }
    }

    // Collider slab
    const downhill = new THREE.Vector3().subVectors(low, high).normalize();
    const slabLow = low.clone().addScaledVector(downhill, 1.0);
    const up = new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0);
    const centre = new THREE.Vector3()
      .addVectors(high, slabLow)
      .multiplyScalar(0.5)
      .addScaledVector(up, -SLAB_DEPTH / 2);
    const size = new THREE.Vector3(high.distanceTo(slabLow), SLAB_DEPTH, BOARDING_WIDTH);
    const localRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
    this._addBoardingCollider(centre, size, localRotation);
  }

  _addPart(parent, geometry, material, x, y, z) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /**
   * Adds a static box collider given in the ship's local frame.
   */
  _addBoardingCollider(localCentre, size, localRotation) {
    this.ship.mesh.localToWorld(this._worldPos.copy(localCentre));
    this._worldQuat.copy(this.ship.mesh.quaternion);
    if (localRotation) this._worldQuat.multiply(localRotation);

    const collider = this.physicsWorld.createStaticBox(
      { x: size.x / 2, y: size.y / 2, z: size.z / 2 },
      this._worldPos,
      this._worldQuat
    );
    if (collider) this.colliders.push(collider);
  }

  _parkHelicopter({ x, z, heading }) {
    const model = new HelicopterModel();
    model.mesh.position.set(x, 0, z);
    model.mesh.rotation.y = heading;
    model.mesh.updateMatrixWorld(true);

    // Rest the skids on the highest sand under them
    let groundY = -Infinity;
    for (const [sx, sz] of [[-1.1, -2.7], [1.1, -2.7], [-1.1, 2.3], [1.1, 2.3]]) {
      const corner = model.mesh.localToWorld(new THREE.Vector3(sx, 0, sz));
      groundY = Math.max(groundY, this.environment.heightAt(corner.x, corner.z));
    }
    model.mesh.position.y = groundY;
    model.mesh.updateMatrixWorld(true);
    model.rotorSpeed = HELICOPTER_IDLE_ROTOR_SPEED;
    this.gameWorld.environmentGroup.add(model.mesh);

    // Fuselage block as cover (the tail boom is left passable)
    model.mesh.localToWorld(this._worldPos.copy(HELICOPTER_COVER_CENTRE));
    const collider = this.physicsWorld.createStaticBox(HELICOPTER_COVER_HALF, this._worldPos, model.mesh.quaternion);
    if (collider) this.colliders.push(collider);

    this.helicopters.push(model);
    this.clearings.push({ x, z, radius: 9 }); // Rotor disc
  }

  /**
   * Spins the parked helicopters' rotors. Call once per frame in Phase 5.
   */
  update(delta) {
    for (const helicopter of this.helicopters) {
      helicopter.update(delta);
    }
  }

  dispose() {
    for (const collider of this.colliders) {
      this.physicsWorld.removeRigidBody(collider.rigidBody);
    }
    this.colliders = [];
    this.clearings = [];

    for (const helicopter of this.helicopters) {
      helicopter.dispose();
    }
    this.helicopters = [];

    if (this.boarding) {
      this.boarding.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
      });
      if (this.boarding.parent) this.boarding.parent.remove(this.boarding);
      this.boarding = null;
    }
    for (const material of Object.values(this.materials)) {
      material.dispose();
    }

    if (this.ship) {
      this.ship.dispose();
      this.ship = null;
    }
  }
}
