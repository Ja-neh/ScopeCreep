import * as THREE from 'three';
import { IslandLevel, CREW_NAMES } from './IslandLevel.js';
import { Level02 } from './Level02.js';
import { SoldierModel } from '../entities/models/SoldierModel.js';
import { squadCharacter } from '../entities/models/CharacterRoster.js';

/** The captive escape aboard the alien transport, before the beach landing. */
export class Level01Spaceship extends IslandLevel {
  constructor(gameWorld) {
    super(gameWorld, 'Level 1: Escape the Spaceship');
    this.state = 'escape';
    this.floorY = 0;
    this.escapeTimer = 0;
    this.captives = [];
  }

  _environmentOptions() { return { look: 'night' }; }
  getMapTerrain() { return null; }
  _clearings() { return [{ x: 0, z: 0, radius: 65 }]; }
  _isWalkable(x, z) { return Math.abs(x) < 9 && z > -43 && z < 43; }
  _playerSpawn() { return { position: new THREE.Vector3(0, this.floorY + 0.2, 36), yaw: 0 }; }

  async _buildWorld() {
    const gw = this.gameWorld;
    this.floorY = this.environment.heightAt(0, 0) + 22;
    const ship = new THREE.Group();
    ship.name = 'Alien transport interior';
    const hull = new THREE.MeshStandardMaterial({ color: 0x263943, metalness: 0.8, roughness: 0.35 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x12242d, metalness: 0.8, roughness: 0.3 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x64d6cf, emissive: 0x247a75, emissiveIntensity: 1.5 });
    const parts = [];
    const colliders = [];
    const box = (x, y, z, sx, sy, sz, material, solid = false) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      ship.add(mesh);
      parts.push(mesh);
      if (solid) colliders.push(gw.physics.createStaticBox({ x: sx / 2, y: sy / 2, z: sz / 2 }, mesh.position));
    };
    const y = this.floorY;
    box(0, y - 0.8, 0, 22, 1.6, 90, hull, true);
    box(-11, y + 5, 0, 0.8, 10, 90, hull, true);
    box(11, y + 5, 0, 0.8, 10, 90, hull, true);
    box(0, y + 10, 0, 22, 0.7, 90, trim, true);
    box(0, y + 5, 45, 22, 10, 0.8, hull, true);
    box(0, y + 5, -45, 22, 10, 0.8, hull, true);
    for (let z = -38; z <= 38; z += 10) {
      box(0, y + 0.02, z, 18, 0.06, 0.18, glow);
      for (const side of [-1, 1]) {
        box(side * 10.55, y + 4.5, z, 0.2, 7, 0.3, glow);
        box(side * 7.8, y + 1.2, z + 3, 4, 2.4, 0.55, trim);
      }
    }
    for (const side of [-1, 1]) {
      for (let z = -34; z <= -14; z += 2.5) {
        box(side * 6.6, y + 2.3, z, 0.16, 4.6, 0.18, glow);
      }
    }
    for (const z of [10, -12, -32]) {
      const light = new THREE.PointLight(0x5cddd9, 4, 28);
      light.position.set(0, y + 8, z);
      ship.add(light);
    }
    gw.environmentGroup.add(ship);
    this.trackDisposable({ dispose: () => {
      ship.parent?.remove(ship);
      for (const part of parts) part.geometry.dispose();
      for (const material of [hull, trim, glow]) material.dispose();
      for (const collider of colliders) if (collider) gw.physics.removeCollider(collider);
    } });
  }

  async _startScenario() {
    const cells = [[-8.3, -22], [-8.3, -30], [8.3, -22], [8.3, -30]];
    for (let i = 0; i < cells.length; i++) {
      const model = new SoldierModel({ characterId: squadCharacter(CREW_NAMES[i], this.player.characterId, i) });
      model.gun.visible = false;
      model.character.setArmed(false);
      model.mesh.position.set(cells[i][0], this.floorY + 0.1, cells[i][1]);
      model.mesh.rotation.y = cells[i][0] < 0 ? -Math.PI / 2 : Math.PI / 2;
      this.gameWorld.environmentGroup.add(model.mesh);
      this.captives.push(model);
    }
    for (const [x, z] of [[-4, 14], [4, -4], [-3, -24], [4, -34]]) {
      this.createAlien('brute', x, z, this.floorY + 0.1);
    }
    this._showObjective('BREAK FREE', 'Defeat the alien guards and reach the captive bay.');
  }

  _updateScenario(delta) {
    if (this.state === 'escape' && this.squad.aliveCount === 0) {
      this.state = 'bridge';
      for (const captive of this.captives) {
        captive.mesh.parent?.remove(captive.mesh);
        captive.dispose();
      }
      this.captives = [];
      for (let i = 0; i < 4; i++) {
        this.spawnSquadMate(CREW_NAMES[i], new THREE.Vector3((i - 1.5) * 2, this.floorY + 0.1, -25));
      }
      this.allies.followLeader();
      this.gameWorld.ui?.showToast('The captives are free. Take the bridge!', 'success', 3500);
    }
    if (this.state === 'bridge') {
      this._showObjective('TAKE THE BRIDGE', 'Lead the freed captives to the controls at the front of the ship.');
      if (this.player.position.z < -38) {
        this.state = 'returning';
        this.escapeTimer = 5;
        this.gameWorld.music?.setState('victory');
        this.gameWorld.ui?.hideObjective();
        this.gameWorld.ui?.showCinematic('COURSE: EARTH', 'The stolen ship turns toward home. Brace for the beach landing.');
      }
    }
    if (this.state === 'returning') {
      this.escapeTimer -= delta;
      if (this.escapeTimer <= 0) {
        this.state = 'transitioning';
        this.gameWorld.ui?.hideCinematic();
        this.gameWorld.loadLevel(new Level02(this.gameWorld));
      }
    }
  }

  dispose() {
    for (const captive of this.captives) {
      captive.mesh.parent?.remove(captive.mesh);
      captive.dispose();
    }
    this.captives = [];
    super.dispose();
  }
}
