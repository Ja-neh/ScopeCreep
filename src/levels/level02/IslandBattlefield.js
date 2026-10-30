import * as THREE from 'three';
import { createRandom } from '../../rendering/Noise.js';
import { createWeatheringMaps } from '../../rendering/SurfaceDetail.js';

// A fixed seed keeps the debris field consistent while covering the whole battlefield.
const SEED = 80421;
const WRECKS = [
  'plane', 'truck', 'building', 'helicopter', 'car', 'plane', 'building',
  'truck', 'helicopter', 'building', 'plane', 'car', 'truck', 'building',
  'helicopter', 'plane', 'truck', 'car', 'building', 'helicopter', 'plane',
  'building', 'truck', 'helicopter', 'car', 'plane', 'building', 'truck',
  'helicopter', 'building', 'plane', 'truck', 'car', 'helicopter', 'building'
];
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

export class IslandBattlefield {
  constructor(gameWorld, environment, clearings = []) {
    this.gameWorld = gameWorld;
    this.environment = environment;
    this.clearings = clearings;
    this.wrecks = [];
    this.colliders = [];
    this.smokeMaterials = [];
    this.time = 0;
    this.weathering = createWeatheringMaps();
    this.smokeTexture = createSmokeTexture();
    this.materials = {
      hull: new THREE.MeshStandardMaterial({ color: 0x343737, roughness: 0.4, metalness: 0.8, normalMap: this.weathering.normal, roughnessMap: this.weathering.roughness }),
      paint: new THREE.MeshStandardMaterial({ color: 0x525144, roughness: 0.48, metalness: 0.62, normalMap: this.weathering.normal, roughnessMap: this.weathering.roughness }),
      concrete: new THREE.MeshStandardMaterial({ color: 0x62615b, roughness: 0.96, flatShading: true, normalMap: this.weathering.normal }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x171918, roughness: 1 }),
      smoke: new THREE.SpriteMaterial({ map: this.smokeTexture, color: 0x45454a, transparent: true, opacity: 0.62, depthWrite: false })
    };
  }

  build() {
    const random = createRandom(SEED + (this.environment.layoutName === 'village' ? 1 : 0));
    const spots = [];
    const beach = this.environment.layoutName !== 'village';
    const columns = beach ? 7 : 3;
    const rows = beach ? 5 : 3;
    const count = beach ? WRECKS.length : 9;
    const minX = beach ? -250 : -205;
    const maxX = beach ? 250 : 205;
    const minZ = beach ? -490 : -285;
    const maxZ = beach ? 170 : 80;
    const cellWidth = (maxX - minX) / columns;
    const cellDepth = (maxZ - minZ) / rows;
    const minSpacing = beach ? 17 : 30;

    // Jitter positions within map-wide cells so wrecks appear inland, on the hills,
    // across the center and along the beach instead of clustering at the edges.
    for (let i = 0; i < count; i++) {
      const column = i % columns;
      const row = Math.floor(i / columns) % rows;
      let spot = null;
      for (let attempt = 0; attempt < 35 && !spot; attempt++) {
        const x = minX + (column + 0.08 + random() * 0.84) * cellWidth;
        const z = minZ + (row + 0.08 + random() * 0.84) * cellDepth;
        const y = this.environment.heightAt(x, z);
        if (y < 1 || this.environment.slopeAt(x, z) > 0.55) continue;
        if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < minSpacing)) continue;
        if (this.clearings.some((c) => Math.hypot(c.x - x, c.z - z) < c.radius + 12)) continue;
        spot = { x, z, y, yaw: random() * Math.PI * 2 };
      }
      if (spot) spots.push(spot);
    }
    spots.forEach((spot, i) => this._buildWreck(WRECKS[i], spot, random));

    // Keep a visible wreck cluster in the player's forward view from the gangway.
    // These sit in the middle of the beach approach, with enough gaps to move between them.
    if (beach) {
      const centralTypes = ['plane', 'truck', 'car', 'truck', 'plane', 'car', 'truck'];
      const centralSpots = [];
      for (let i = 0; i < centralTypes.length; i++) {
        let spot = null;
        for (let attempt = 0; attempt < 120 && !spot; attempt++) {
          const x = -54 + random() * 108;
          const z = 123 + random() * 43;
          const y = this.environment.heightAt(x, z);
          if (y < 0.8 || this.environment.inlandDistance(x, z) < 3) continue;
          if (this.environment.slopeAt(x, z) > 0.48) continue;
          if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 14)) continue;
          if (centralSpots.some((s) => Math.hypot(s.x - x, s.z - z) < 14)) continue;
          if (this.clearings.some((c) => Math.hypot(c.x - x, c.z - z) < c.radius + 10)) continue;
          spot = { x, z, y, yaw: random() * Math.PI * 2 };
        }
        if (spot) centralSpots.push(spot);
      }
      centralSpots.forEach((spot, i) => this._buildWreck(centralTypes[i], spot, random));
      spots.push(...centralSpots);

      // More vehicles and aircraft continue across the rest of the beach frontage.
      const frontageTypes = [
        'plane', 'truck', 'car', 'truck', 'plane', 'car',
        'car', 'plane', 'truck', 'car', 'truck', 'plane',
        'truck', 'car', 'plane', 'truck', 'car', 'plane'
      ];
      const frontageSpots = [];
      const columns = 6;
      for (let i = 0; i < frontageTypes.length; i++) {
        const row = Math.floor(i / columns);
        const column = i % columns;
        const rowBounds = [
          { minX: -215, maxX: 215, minZ: 88, maxZ: 112 },
          { minX: -180, maxX: 180, minZ: 108, maxZ: 133 },
          { minX: -140, maxX: 140, minZ: 129, maxZ: 153 }
        ][row];
        let spot = null;
        for (let attempt = 0; attempt < 50 && !spot; attempt++) {
          const x = rowBounds.minX + (column + 0.12 + random() * 0.76) * ((rowBounds.maxX - rowBounds.minX) / columns);
          const z = rowBounds.minZ + random() * (rowBounds.maxZ - rowBounds.minZ);
          const y = this.environment.heightAt(x, z);
          if (y < 0.8 || this.environment.inlandDistance(x, z) < 3) continue;
          if (this.environment.slopeAt(x, z) > 0.48) continue;
          if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 15)) continue;
          if (frontageSpots.some((s) => Math.hypot(s.x - x, s.z - z) < 15)) continue;
          if (this.clearings.some((c) => Math.hypot(c.x - x, c.z - z) < c.radius + 10)) continue;
          spot = { x, z, y, yaw: random() * Math.PI * 2 };
        }
        if (spot) frontageSpots.push(spot);
      }
      frontageSpots.forEach((spot, i) => this._buildWreck(frontageTypes[i], spot, random));
    }
  }

  _buildWreck(type, spot, random) {
    const root = new THREE.Group();
    root.name = `BattlefieldWreck_${type}`;
    root.position.set(spot.x, spot.y, spot.z);
    root.rotation.y = spot.yaw;
    const { hull, paint, rubber } = this.materials;
    const box = (parent, w, h, d, x, y, z, mat = hull, rot = null) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      if (rot) mesh.rotation.set(...rot);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    if (type === 'plane') {
      // Crumpled single-engine fighter: fuselage, snapped wings, tail and a broken propeller.
      // Lower the fuselage and wing roots so their undersides rest on the terrain at root Y.
      box(root, 1.35, 1.15, 11, 0, 0.58, 0, hull, [0, 0, 0.07]);
      box(root, 12, 0.42, 2.6, -0.6, 0.28, 0.3, paint, [0, 0, -0.12]);
      box(root, 3.4, 0.35, 2.1, 0.2, 1.75, -4.2, hull, [0.13, 0, 0.3]);
      box(root, 0.22, 1.5, 1.5, 0, 1.45, -4.6, paint, [0, 0, -0.24]);
      box(root, 0.16, 3.3, 0.2, 0, 2.0, 5.1, hull, [0, 0, 0.2]);
      box(root, 3.2, 0.18, 0.2, 0, 0.9, 5.1, paint, [0, 0, 0.12]);
    } else if (type === 'helicopter') {
      box(root, 2.7, 2, 5.8, 0, 1.1, 0, hull, [0, 0, 0.1]);
      box(root, 2.0, 1.25, 2.3, 0, 1.8, -2.7, paint, [0.1, 0, 0]);
      box(root, 0.45, 0.45, 5.5, 0.2, 1.15, 4.4, hull, [0.25, 0, 0.16]);
      box(root, 2.4, 0.18, 0.5, 0.2, 3.1, 0, paint, [0, 0, 0.14]);
      box(root, 0.22, 0.16, 8.5, 0, 3.15, 0, hull, null);
      box(root, 0.2, 0.16, 6.7, 0, 3.17, 0, hull, [0, 0.7, 0]);
      box(root, 2.2, 0.2, 0.25, 0.2, 1.0, 4.8, paint);
    } else if (type === 'truck' || type === 'car') {
      const truck = type === 'truck';
      box(root, truck ? 2.8 : 2.5, truck ? 1.45 : 1.1, truck ? 6.2 : 4.4, 0, truck ? 0.95 : 0.75, 0, hull, [0, 0, 0.12]);
      box(root, truck ? 2.15 : 2.05, truck ? 1.5 : 0.9, truck ? 2.5 : 2.2, 0, truck ? 2.15 : 1.55, -1.0, paint, [0.08, 0, -0.12]);
      for (const x of [-1.25, 1.25]) for (const z of (truck ? [-2.15, 0, 2.15] : [-1.35, 1.35])) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(truck ? 0.54 : 0.48, truck ? 0.54 : 0.48, 0.28, 8), rubber);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.5, z);
        wheel.castShadow = true;
        root.add(wheel);
      }
      box(root, 1.9, 0.2, 1.1, 0, 1.15, 1.7, hull, [0, 0, 0.3]);
    } else {
      // A collapsed coastal outbuilding: broken wall stubs and a fallen roof slab.
      const concrete = this.materials.concrete;
      box(root, 10, 0.55, 8, 0, 0.25, 0, concrete, [0.04, 0, -0.08]);
      box(root, 7.2, 0.42, 0.55, -0.8, 2.1, -2.6, concrete, [0, 0, 0.22]);
      box(root, 0.58, 2.8, 5.2, -3.2, 1.4, -0.2, concrete, [0.02, 0, -0.04]);
      box(root, 0.55, 2.2, 3.8, 3.1, 1.05, 1.3, concrete, [0.1, 0, 0.08]);
      box(root, 6.4, 0.45, 0.55, 1.2, 1.0, 3.0, concrete, [0, 0, -0.16]);
      for (let i = 0; i < 7; i++) {
        const size = 0.45 + random() * 0.9;
        const debris = box(root, size * 1.4, size * 0.75, size, (random() - 0.5) * 7, 0.45 + random() * 0.22, (random() - 0.5) * 6, i % 2 ? hull : concrete, [random() * 0.4, random() * 0.8, random() * 0.55]);
        debris.rotation.y = random() * Math.PI;
      }
    }
    this._addSmoke(root, random);
    this.gameWorld.environmentGroup.add(root);
    root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

    const dimensions = type === 'plane' ? [4.8, 0.9, 5.8] : type === 'helicopter' ? [2.0, 0.8, 3.5] : type === 'truck' ? [1.9, 1.0, 3.0] : type === 'building' ? [4.8, 1.4, 3.8] : [1.5, 0.65, 2.3];
    _q.setFromAxisAngle(_up, spot.yaw);
    const collider = this.gameWorld.physics.createStaticBox(
      { x: dimensions[0], y: dimensions[1], z: dimensions[2] },
      { x: spot.x, y: spot.y + dimensions[1], z: spot.z }, _q);
    if (collider) this.colliders.push(collider);
    this.wrecks.push({ mesh: root, type, x: spot.x, z: spot.z, smoke: root.userData.smoke });
  }

  _addSmoke(root, random) {
    const smoke = [];
    for (let i = 0; i < 2; i++) {
      const x = (random() - 0.5) * 2.6;
      const z = (random() - 0.5) * 4.2;
      const smokeMaterial = this.materials.smoke.clone();
      this.smokeMaterials.push(smokeMaterial);
      const puff = new THREE.Sprite(smokeMaterial);
      puff.position.set(x * 0.7, 3.8 + random() * 1.2, z);
      puff.scale.set(3.8, 5.2, 1);
      root.add(puff);
      smoke.push({ puff, phase: random() * Math.PI * 2 });
    }
    root.userData.smoke = smoke;
  }

  update(delta) {
    this.time += delta;
    for (const wreck of this.wrecks) for (const plume of wreck.smoke) {
      const smokePhase = (this.time * 0.16 + plume.phase) % 1;
      plume.puff.position.y = 3.2 + smokePhase * 3.2;
      plume.puff.scale.set(3.4 + smokePhase * 3.3, 4.4 + smokePhase * 4.5, 1);
      plume.puff.material.opacity = 0.48 * Math.sin(Math.PI * smokePhase);
    }
  }

  dispose() {
    for (const collider of this.colliders) this.gameWorld.physics.removeRigidBody(collider.rigidBody);
    this.colliders = [];
    for (const wreck of this.wrecks) {
      wreck.mesh.traverse((child) => { if (child.geometry && !child.isSprite) child.geometry.dispose(); });
      wreck.mesh.parent?.remove(wreck.mesh);
    }
    this.wrecks = [];
    for (const material of this.smokeMaterials) material.dispose();
    this.smokeMaterials = [];
    for (const material of Object.values(this.materials)) material.dispose();
    this.weathering.normal.dispose();
    this.weathering.roughness.dispose();
    this.smokeTexture.dispose();
  }
}

function createSmokeTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size * 2 - 1;
    const dy = (y + 0.5) / size * 2 - 1;
    const radius = Math.sqrt(dx * dx + dy * dy);
    const noise = 0.78 + 0.22 * Math.sin(x * 0.71 + Math.sin(y * 0.43) * 2.4) * Math.sin(y * 0.59 + x * 0.17);
    const alpha = Math.max(0, Math.min(1, (1 - radius) * 2.1)) * noise;
    const i = (y * size + x) * 4;
    data.set([110, 112, 117, Math.round(alpha * 255)], i);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}
