import * as THREE from 'three';
import { BaseLevel } from './BaseLevel.js';
import { Player } from '../entities/Player.js';
import { SoldierModel } from '../entities/models/SoldierModel.js';
import { AlienModel } from '../entities/models/AlienModel.js';
import { WeaponController } from '../weapons/WeaponController.js';
import { WeaponPickup } from '../entities/WeaponPickup.js';
import { HUMAN_CHARACTERS, ALIEN_CHARACTERS } from '../entities/models/CharacterRoster.js';

/** Small calibration scene for imported skins, poses, visibility and resource cleanup. */
export class CharacterTestLevel extends BaseLevel {
  constructor(gameWorld) {
    super(gameWorld, 'Character Lab');
    this.models = [];
    this.elapsed = 0;
  }

  get controls() {
    return [
      { actions: ['forward', 'backward', 'steerLeft', 'steerRight'], label: 'Walk around the cast' },
      { actions: ['specialAction'], label: 'Pick up nearby rifle' },
      { actions: ['firePrimary', 'aimDownSights'], label: 'Shoot / aim' },
      { actions: ['toggleCamera'], label: 'First / third person' },
      { actions: ['crouch'], label: 'Crouch' },
      { actions: ['characterPower'], label: 'Character power' },
      { actions: ['pause'], label: 'Options / return to menu' }
    ];
  }

  async init() {
    await super.init();
    const gw = this.gameWorld;
    const sky = this.trackDisposable(new THREE.HemisphereLight(0xddeeff, 0x746354, 2.2));
    const sun = this.trackDisposable(new THREE.DirectionalLight(0xffe9d2, 3));
    sun.position.set(-10, 18, 12);
    gw.environmentGroup.add(sky, sun);
    const floor = this.trackDisposable(new THREE.Mesh(new THREE.PlaneGeometry(100, 100),
      new THREE.MeshStandardMaterial({ color: 0x263746, roughness: 0.9 })));
    floor.rotation.x = -Math.PI / 2;
    gw.environmentGroup.add(floor);
    this.groundCollider = gw.physics.createGround(100);
    const grid = this.trackDisposable(new THREE.GridHelper(60, 30, 0x7e95a3, 0x3c5262));
    grid.position.y = 0.01;
    gw.environmentGroup.add(grid);
    this.player = new Player(gw, { position: new THREE.Vector3(0, 0.05, 12), canCrouch: true, maxHealth: 100 });
    gw.addEntity(this.player);
    this.weapons = new WeaponController(gw, this.player);
    gw.addEntity(this.weapons);
    gw.addEntity(new WeaponPickup(gw, this.player, this.weapons, new THREE.Vector3(1, 0.12, 11)));
    const cast = HUMAN_CHARACTERS.map(c=>c.id);
    cast.forEach((characterId, index) => {
      const model = this.trackDisposable(new SoldierModel({ characterId }));
      model.mesh.position.set((index - (cast.length-1)/2) * 3, 0, 2);
      model.mesh.rotation.y = Math.PI;
      gw.entitiesGroup.add(model.mesh);
      this.models.push(model);
    });
    ALIEN_CHARACTERS.forEach((characterId, index) => {
      const model = this.trackDisposable(new AlienModel({ characterId, scale: characterId === 'bahamut-xvi' ? 2.3 : 1.45, backpack: true }));
      model.mesh.position.set((index - (ALIEN_CHARACTERS.length-1)/2) * 8, 0, -6);
      model.mesh.rotation.y = Math.PI;
      gw.entitiesGroup.add(model.mesh);
      this.models.push(model);
    });
    this.ready = Promise.all([this.player.model.character.ready, ...this.models.map(m => m.character.ready)]);
    this.ready.then(()=>{
      if (!this.isInitialized) return;
      const count=this.models.filter(m=>cast.includes(m.character.id) && m.character.motion).length;
      console.info(`[CharacterLab] Recorded motion ready: ${count}/${cast.length} main characters`);
      gw.ui.showToast(`Recorded motion ready for ${count} main characters`, 'info', 4000);
    });
    gw.ui.showToast('Character Lab: main cast in front, creatures behind. Walk around to inspect.', 'info', 7000);
  }

  gameplayUpdate(delta) {
    this.elapsed += delta;
    const phase = this.elapsed % 28;
    for (const model of this.models) {
      const skin=model.character;
      if (model instanceof AlienModel) {
        const flying=model.canFly && phase>=6 && phase<18;
        model.mesh.position.y=flying ? Math.sin((phase-6)/12*Math.PI)*3 : 0;
        if (model.canFly) {
          model.demoActor ||= {velocity:new THREE.Vector3(),isFlying:false,isGrounded:true};
          model.demoActor.isFlying=flying;
          model.demoActor.isGrounded=!flying;
          skin.setActor(model.demoActor);
        }
        const pulse=Math.floor(this.elapsed/2);
        if (model._demoPulse!==pulse) { model.releasePower(); model._demoPulse=pulse; }
        model.animate(delta,phase<6 ? 2.2 : 0,phase>=12 && phase<16);
        continue;
      }
      // First four seconds expose the normal empty-handed stance for inspection.
      model.gun.visible=phase>=4;
      skin.reloadProgress=phase>=16 && phase<19 ? (phase-16)/3 : 1;
      skin.pickupProgress=phase>=24 ? (phase-24)/4 : -1;
      skin.setCrouchAmount(phase>=19 && phase<24 ? 1 : 0);
      model.animate(delta, phase<4 ? 0 : phase<6 ? 2.2 : phase<12 ? 5 : phase>=21 && phase<24 ? 1.3 : 0,
        phase>=12 && phase<16);
      model.setHitFlash(0);
    }
  }

  dispose() {
    if (this.groundCollider) this.gameWorld.physics.removeCollider(this.groundCollider, true);
    this.groundCollider = null;
    super.dispose();
    this.models = [];
  }
}
