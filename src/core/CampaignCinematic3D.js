import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SoldierModel } from '../entities/models/SoldierModel.js';
import { AlienModel } from '../entities/models/AlienModel.js';
import { HUMAN_CHARACTERS, getSelectedCharacter } from '../entities/models/CharacterRoster.js';
import { SquadTransport } from '../levels/level02/SquadTransport.js';
import { Village } from '../levels/level03/Village.js';
import { AMBUSH_ROUTES, CAPTURE_POSITIONS, SQUARE_CAMERAS } from './CampaignBlocking.js';
import { BRIG_PLAYER, BRIG_CAPTIVES, createCaptiveCell } from '../levels/level01/CaptiveCells.js';

const smooth = (a, b, t) => THREE.MathUtils.smoothstep(t, a, b);
const lerp = THREE.MathUtils.lerp;

/** In-engine, model-driven campaign cutscenes rendered through GameWorld's WebGL renderer. */
export class CampaignCinematic3D {
  constructor(gameWorld) {
    this.gameWorld = gameWorld;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x071526);
    this.scene.fog = new THREE.Fog(0x071526, 45, 140);
    this.camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, .1, 250);
    this.scene.add(new THREE.HemisphereLight(0x91b7c5, 0x182321, 2.3));
    const moon = new THREE.DirectionalLight(0xb8d9e7, 3.3);
    moon.position.set(-22, 40, 28); moon.castShadow = true;
    this.scene.add(moon);
    const red = new THREE.PointLight(0xff5545, 60, 65);
    red.position.set(0, 10, -16); this.scene.add(red);
    this.props = [];
    this.actors = [];
    this._ray = new THREE.Ray();
    this._desiredCamera = new THREE.Vector3();
    this._cameraTarget = new THREE.Vector3();
    this._hit = new THREE.Vector3();
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._voices = [];
    this._cues = new Set();
    this._buildIsland();
    this._buildVillage();
    this._buildShipInterior();
    this._buildCast();
    this._buildAbduction();
    this.time = 0;
    this._soundChapter = -1;
    this._nextActionSound = 0;
    this.running = false;
  }

  _mesh(geometry, material, parent, position, rotation = null) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); this.props.push(mesh);
    return mesh;
  }

  _buildIsland() {
    this.island = new THREE.Group(); this.scene.add(this.island);
    const sand = new THREE.MeshStandardMaterial({ color: 0x706b53, roughness: 1 });
    const grass = new THREE.MeshStandardMaterial({ color: 0x3a2f24, roughness: 1 });
    const wall = new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: .96 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x4e3b30, roughness: .9 });
    const sea = new THREE.MeshStandardMaterial({ color: 0x133645, metalness: .2, roughness: .35 });
    this._mesh(new THREE.PlaneGeometry(300, 300), sea, this.island, [0, -.22, 0], [-Math.PI / 2, 0, 0]);
    this._mesh(new THREE.CylinderGeometry(56, 59, 1, 40), sand, this.island, [0, -.5, -2]);
    this._mesh(new THREE.CylinderGeometry(36, 42, .6, 40), grass, this.island, [0, -.12, -16]);
    for (let i = 0; i < 12; i++) {
      const x = [-22, -15, -8, 8, 15, 22][i % 6], z = -13 - Math.floor(i / 6) * 9;
      const house = new THREE.Group(); house.position.set(x, 0, z);
      this.island.add(house);
      this._mesh(new THREE.BoxGeometry(4.8, 3.7, 4.5), wall, house, [0, 1.85, 0]);
      this._mesh(new THREE.ConeGeometry(4.2, 2.1, 4), roof, house, [0, 4.3, 0], [0, Math.PI / 4, 0]);
      const windowMat = new THREE.MeshBasicMaterial({ color: i % 4 ? 0x10151d : 0xd9c27a });
      this._mesh(new THREE.PlaneGeometry(.8, .9), windowMat, house, [0, 2, 2.26]);
    }
    this._mesh(new THREE.BoxGeometry(14, 7, 10), wall, this.island, [0, 3.5, -37]);
    this._mesh(new THREE.ConeGeometry(10, 4, 4), roof, this.island, [0, 9, -37], [0, Math.PI / 4, 0]);
    this._mesh(new THREE.BoxGeometry(7, 6, .4), new THREE.MeshStandardMaterial({ color: 0x2e241c }), this.island, [0, 3, -31.8]);
    const trunk = new THREE.MeshStandardMaterial({ color: 0x3b3029 });
    const leaves = new THREE.MeshStandardMaterial({ color: 0x25362e });
    for (let i = 0; i < 15; i++) {
      const a = i * 2.4, radius = 23 + (i % 4) * 5;
      const x = Math.cos(a) * radius, z = -14 + Math.sin(a) * radius;
      this._mesh(new THREE.CylinderGeometry(.18, .33, 5.5, 5), trunk, this.island, [x, 2.75, z]);
      this._mesh(new THREE.ConeGeometry(2.1, 5.1, 6), leaves, this.island, [x, 6.7, z]);
    }
    this.ships = [
      new SquadTransport(this.island, new THREE.Vector3(0, 42, -12)),
      new SquadTransport(this.island, new THREE.Vector3(-27, 36, -28)),
      new SquadTransport(this.island, new THREE.Vector3(27, 39, -28))
    ];
    this.ships[0].mesh.scale.setScalar(2.6);
    this.ships[1].mesh.scale.setScalar(1.65);
    this.ships[2].mesh.scale.setScalar(1.8);
    this.ships.forEach((ship) => ship.mesh.rotation.y = 0);
    this.cages = [];
    const bar = new THREE.MeshStandardMaterial({ color: 0x64d8d0, emissive: 0x146c6a, metalness: .55 });
    for (const x of [-9, 0, 9]) {
      const cage = new THREE.Group(); cage.position.set(x, 0, 8);
      this.island.add(cage); this.cages.push(cage);
      for (let j = 0; j < 9; j++) {
        const a = j * Math.PI * 2 / 9;
        this._mesh(new THREE.CylinderGeometry(.08, .08, 3.2, 6), bar, cage,
          [Math.cos(a) * 2, 1.6, Math.sin(a) * 2]);
      }
      this._mesh(new THREE.CylinderGeometry(2.2, 2.2, .15, 12), bar, cage, [0, 3.3, 0]);
      cage.visible = false;
    }
    const shield = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x56d6dd, transparent: true, opacity: .19, side: THREE.DoubleSide, depthWrite: false }));
    shield.position.set(0, 0, -25); this.island.add(shield); this.shield = shield;
    this.props.push(shield);
    this.generators = [];
    for (const x of [-13, 0, 13]) {
      const generator = this._mesh(new THREE.CylinderGeometry(.9, 1.2, 3.5, 8),
        new THREE.MeshStandardMaterial({ color: 0x4cd7d3, emissive: 0x17827e, emissiveIntensity: 2 }),
        this.island, [x, 1.8, -22]);
      this.generators.push(generator);
    }
  }

  _buildShipInterior() {
    this.interior = new THREE.Group(); this.scene.add(this.interior);
    this.interiorShell = new THREE.Group(); this.interior.add(this.interiorShell);
    const metal = new THREE.MeshStandardMaterial({ color: 0x263a46, metalness: .8, roughness: .3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x10232e, metalness: .7, roughness: .35 });
    const glow = new THREE.MeshBasicMaterial({ color: 0x74efeb });
    this._mesh(new THREE.BoxGeometry(36, .5, 36), metal, this.interiorShell, [0, -.25, 0]);
    this._mesh(new THREE.BoxGeometry(36, 14, .6), dark, this.interiorShell, [0, 7, -18]);
    this._mesh(new THREE.BoxGeometry(.6, 14, 36), metal, this.interiorShell, [-18, 7, 0]);
    this._mesh(new THREE.BoxGeometry(.6, 14, 36), metal, this.interiorShell, [18, 7, 0]);
    this._mesh(new THREE.BoxGeometry(36, .5, 36), dark, this.interiorShell, [0, 14, 0]);
    for (let i = -2; i <= 2; i++) {
      this._mesh(new THREE.BoxGeometry(.18, .08, 35), glow, this.interiorShell, [i * 6, .06, 0]);
      this._mesh(new THREE.BoxGeometry(4, .12, .3), glow, this.interiorShell, [i * 6, 13.8, -8]);
    }
    const bridge = this._mesh(new THREE.BoxGeometry(5, 2, 2), metal, this.interiorShell, [0, 1, -15]);
    bridge.name = 'Alien bridge console';
    this.brigCells = [BRIG_PLAYER, ...BRIG_CAPTIVES].map(position => {
      const cell = createCaptiveCell();
      cell.group.position.set(...position); this.interior.add(cell.group);
      return cell;
    });
    const brigLight = new THREE.PointLight(0xb8ffe4, 18, 28, 1.3);
    brigLight.position.set(17, 4.3, -47); this.interior.add(brigLight);
    this.shipBlockers = [];
    this.interior.visible = false;
    const base = import.meta.env?.BASE_URL || '/';
    this.shipReady = new GLTFLoader().loadAsync(`${base}assets/inside-spaceship.glb`).then((gltf) => {
      this.shipModel = gltf.scene;
      this.interior.add(this.shipModel);
      this.interiorShell.visible = false;
      this.shipModel.updateMatrixWorld(true);
      this.shipModel.traverse(node => {
        if (/^(COL-|SPAWN-)/i.test(node.name)) {
          node.visible = false;
          if (node.isMesh && node.name.startsWith('COL-'))
            this.shipBlockers.push(new THREE.Box3().setFromObject(node).expandByScalar(.22));
        } else if (node.isMesh) {
          node.receiveShadow = true;
          for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
            if (/glass|window/i.test(`${node.name} ${mat.name}`)) {
              mat.transparent = true; mat.opacity = .22; mat.depthWrite = false;
            }
          }
        }
      });
    }).catch((error) => {
      console.warn('Cinematic spaceship interior unavailable; using the built-in set.', error);
    });
  }

  _buildVillage() {
    this.villageStage = new THREE.Group(); this.scene.add(this.villageStage);
    this.villageBlockers = [];
    const physics = {
      createStaticBox: (half, position, quaternion = new THREE.Quaternion()) => {
        const bounds = new THREE.Box3(new THREE.Vector3(-half.x,-half.y,-half.z), new THREE.Vector3(half.x,half.y,half.z));
        bounds.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(position.x,position.y,position.z),quaternion,new THREE.Vector3(1,1,1)));
        this.villageBlockers.push(bounds.expandByScalar(.3));
        return null;
      },
      createStaticCylinder: () => null, removeRigidBody: () => {}
    };
    const environment = {
      village: { x: 0, z: -400, halfWidth: 200, halfLength: 245 },
      heightAt: () => 0,
      pathCentreX: () => 0,
      isInVillage: (x, z) => Math.abs(x) < 200 && z > -645 && z < -155
    };
    this.village = new Village({ physics, environmentGroup: this.villageStage }, environment);
    this.village.build();
    this.cages.forEach((cage, i) => { this.villageStage.add(cage); cage.position.set((i - 1) * 6, 0, -542); });
    this.villageStage.add(this.shield);
    this.shield.position.set(0, 0, -608);
    this.shield.scale.setScalar(3.8);
    this.generators.forEach((generator, i) => {
      this.villageStage.add(generator);
      generator.position.set((i - 1) * 28, 1.8, -576 + (i % 2) * 13);
    });
    this._mesh(new THREE.PlaneGeometry(600, 650),
      new THREE.MeshStandardMaterial({ color: 0x3a2f24, roughness: 1 }),
      this.villageStage, [0, -.15, -400], [-Math.PI / 2, 0, 0]);
    this.villageStage.visible = false;
  }

  _buildCast() {
    const selected = getSelectedCharacter();
    const order = [selected, ...HUMAN_CHARACTERS.map((character) => character.id).filter((id) => id !== selected)];
    this.humans = order.map((id) => {
      const model = new SoldierModel({ characterId: id });
      this.actors.push(model); this.scene.add(model.mesh); return model;
    });
    this.civilians = Array.from({ length: 5 }, (_, i) => {
      const model = new SoldierModel({ characterId: order[(i + 1) % order.length] });
      model.gun.visible = false; model.character.setArmed(false);
      this.actors.push(model); this.scene.add(model.mesh); return model;
    });
    this.aliens = ['gorr', 'galiant', 'gorr', 'galiant', 'bahamut-nt'].map((id) => {
      const model = new AlienModel({ characterId: id });
      this.actors.push(model); this.scene.add(model.mesh); return model;
    });
    this.ready = Promise.all([...this.actors.map((actor) => actor.character?.ready).filter(Boolean), this.shipReady]);
    const beamGeometry = new THREE.CylinderGeometry(.08, .08, 1, 8);
    const beamMaterial = new THREE.MeshBasicMaterial({ color: 0xff623b, transparent: true, opacity: .85 });
    this.beams = Array.from({ length: 4 }, () => {
      const mesh = new THREE.Mesh(beamGeometry, beamMaterial);
      this.scene.add(mesh); return mesh;
    });
    this.beamGeometry = beamGeometry; this.beamMaterial = beamMaterial;
    this._hideCast();
  }

  _buildAbduction() {
    this.tractor = new THREE.Group();
    this.tractor.position.set(0, 0, -542); this.villageStage.add(this.tractor);
    this.tractorMaterial = new THREE.MeshBasicMaterial({ color: 0x63ff74, transparent: true,
      opacity: .13, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    this._mesh(new THREE.CylinderGeometry(3.5, 9.5, 30, 48, 1, true),
      this.tractorMaterial, this.tractor, [0,15,0]);
    this.liftRings = Array.from({ length: 7 }, () => {
      const mat = new THREE.MeshBasicMaterial({ color: 0x84ff9d, transparent: true, opacity: .35,
        depthWrite: false, blending: THREE.AdditiveBlending });
      return this._mesh(new THREE.TorusGeometry(1,.018,4,48),mat,this.tractor,[0,0,0],[Math.PI/2,0,0]);
    });
    const positions = new Float32Array(180 * 3);
    for (let i=0; i<180; i++) {
      const angle=i*2.39996, radius=2+((i*37)%65)/10;
      positions[i*3]=Math.cos(angle)*radius; positions[i*3+1]=(i*1.73)%30;
      positions[i*3+2]=Math.sin(angle)*radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    const material = new THREE.PointsMaterial({ color: 0xb5ffb7, size: .12, transparent: true,
      opacity: .8, depthWrite: false, blending: THREE.AdditiveBlending });
    this.liftParticles = new THREE.Points(geometry,material); this.tractor.add(this.liftParticles);
    this.tractorLight = new THREE.PointLight(0x63ff74,100,40,1.2);
    this.tractorLight.position.set(0,5,0); this.tractor.add(this.tractorLight);
    this.tractor.visible = false;
  }

  _hideCast() {
    for (const actor of this.actors) actor.mesh.visible = false;
    for (const beam of this.beams) beam.visible = false;
  }

  play({ scene = 'prologue', duration = 32, onFinished }) {
    this.stop();
    this.mode = scene;
    this.duration = duration;
    this.onFinished = onFinished;
    this.time = 0;
    const selected = getSelectedCharacter();
    this.humans.sort((a,b) => (a.character.id === selected ? -1 : b.character.id === selected ? 1 : 0));
    this._cues.clear();
    for (const actor of this.actors) {
      actor.character?.resetPose?.(); actor.body.rotation.set(0,0,0);
      actor.body.position.y = 0; actor._lastSafePosition = null;
    }
    this._soundChapter = -1;
    this._nextActionSound = 0;
    this.running = true;
    this.gameWorld.cinematic = this;
    this.update(0);
  }

  stop() {
    this._stopVoices();
    this.running = false;
    if (this.gameWorld.cinematic === this) this.gameWorld.cinematic = null;
    this.onFinished = null;
  }

  hold() {
    this._stopVoices();
    this.running = false;
    this.onFinished = null;
  }

  update(delta) {
    if (!this.running) return;
    this.time += delta;
    this._delta = Math.min(delta, .1);
    const chapterSeconds = this.duration / 5;
    const chapter = this.mode === 'prologue' ? Math.min(4, Math.floor(this.time / chapterSeconds))
      : ({ breakout: 4, beach: 6, dome: 5 }[this.mode] ?? 0);
    const u = this.mode === 'prologue' ? (this.time - chapter * chapterSeconds) / chapterSeconds : this.time / this.duration;
    if (chapter !== this._soundChapter) {
      this._stopVoices(); this._cues.clear(); this._soundChapter = chapter;
      for (const actor of this.actors) actor._lastSafePosition = null;
    }
    this._hideCast();
    this.interior.visible = chapter === 4;
    this.villageStage.visible = chapter < 4 || chapter === 5;
    this.island.visible = chapter === 6;
    this.tractor.visible = chapter === 3;
    this.scene.background.setHex(chapter === 4 ? 0x0b1c27 : chapter === 1 ? 0x301b23 : 0x071526);
    this._animateChapter(chapter, Math.min(1, u), delta);
    if (this.time >= this.duration) {
      const done = this.onFinished;
      this.hold();
      done?.();
    }
  }

  _place(actor, x, z, yaw = 0, y = 0, speed = 0, aiming = false) {
    actor.mesh.visible = true;
    // The cinematic is outside the physics step, so use the village's placement
    // query instead of writing a moving body through a building.
    if (this.villageStage.visible && y < .5 && !this.village.isOpenGround(x,z,.65)) {
      const safe = actor._lastSafePosition;
      if (!safe) { actor.mesh.visible = false; return; }
      x = safe.x; z = safe.z; speed = 0;
    } else {
      actor._lastSafePosition ||= new THREE.Vector3();
      actor._lastSafePosition.set(x,0,z);
    }
    actor.mesh.position.set(x, y, z);
    actor.mesh.rotation.set(0, yaw, 0);
    actor.animate(this._delta, speed, aiming);
  }

  _stopVoices() {
    for (const voice of this._voices) { try { voice.stop(); } catch { /* already ended */ } }
    this._voices.length = 0;
  }

  _cue(key, sound, position = null, volume = 1) {
    if (this._cues.has(key)) return false;
    const voice = this.gameWorld.audio?.play(sound,position,volume);
    if (!voice) return false; // permit retry after the browser's audio gesture
    this._cues.add(key); this._voices.push(voice);
    return true;
  }

  _camera(from, target) {
    this._desiredCamera.set(...from); this._cameraTarget.set(...target);
    this._ray.origin.copy(this._cameraTarget);
    this._ray.direction.subVectors(this._desiredCamera,this._cameraTarget).normalize();
    let distance = this._desiredCamera.distanceTo(this._cameraTarget);
    const blockers = this.interior.visible ? this.shipBlockers : this.villageStage.visible ? this.villageBlockers : [];
    for (const box of blockers) {
      if (box.containsPoint(this._cameraTarget)) continue;
      if (this._ray.intersectBox(box,this._hit)) distance = Math.min(distance, Math.max(.5,this._hit.distanceTo(this._cameraTarget)-.25));
    }
    this.camera.position.copy(this._cameraTarget).addScaledVector(this._ray.direction,distance);
    this.camera.lookAt(this._cameraTarget);
    this.camera.updateMatrixWorld();
  }

  _squareCamera(name, u) {
    const shot = SQUARE_CAMERAS[name];
    this._camera(shot.from.map((v,i)=>lerp(v,shot.to[i],u)),shot.target);
  }

  _beam(index, from, to, visible = true) {
    const beam = this.beams[index]; beam.visible = visible;
    if (!visible) return;
    const a = this._a.set(...from), b = this._b.set(...to);
    beam.position.copy(a).add(b).multiplyScalar(.5);
    beam.scale.set(1, a.distanceTo(b), 1);
    beam.quaternion.setFromUnitVectors(this._up, b.sub(a).normalize());
  }

  _animateChapter(chapter, u, delta) {
    const t = this.time;
    const villageChapter = chapter < 4;
    const shipParent = villageChapter ? this.villageStage : this.island;
    this.ships.forEach((ship) => { if (ship.mesh.parent !== shipParent) shipParent.add(ship.mesh); });
    this.ships.forEach((ship, i) => { ship.mesh.visible = chapter !== 4 && chapter !== 5; ship.mesh.rotation.z = Math.sin(t * 1.5 + i) * .035; });
    this.cages.forEach((cage) => cage.visible = chapter === 2 || chapter === 5);
    this.humans.forEach(actor => { actor.gun.visible = chapter >= 5; actor.character.crouch = 0; });
    this.shield.visible = chapter === 5;
    this.generators.forEach((generator) => generator.visible = chapter === 5);
    if (chapter === 6) {
      this.ships[0].mesh.position.set(0, 22 - smooth(0, .5, u) * 15, 11);
      this.ships[1].mesh.visible = false; this.ships[2].mesh.visible = false;
      this.humans.forEach((actor, i) => this._place(actor, (i - 2) * 2.4,
        19 - smooth(.2, .65, u) * 11, Math.PI, 0, u > .35 ? 3 : 0, u > .6));
      this.aliens.slice(0, 4).forEach((actor, i) => this._place(actor, -14 + i * 9, -8 + Math.sin(t * 2 + i) * .5,
        0, 0, 1.2, true));
      this._camera([24 - u * 9, 9, 31 - u * 7], [0, 3, 1]);
      this._cue('landing','flyby',null,.8);
      if (u > .2 && u < .65) this._cue(`step-${Math.floor(t*2.5)}`,'footstepSand',null,.7);
    } else if (chapter === 0) {
      this.ships.forEach((ship,i) => ship.mesh.position.set(i===0?0:i===1?-34:34,
        lerp(82+i*8,38+i*7,smooth(0,1,u)),i===0?-542:-563));
      this.humans.forEach((actor,i)=>this._place(actor,(i-2)*3,-543,0));
      this._squareCamera('arrival',u);
      this._cue('arrival','flyby',null,.9);
    } else if (chapter === 1) {
      this.ships.forEach((ship,i)=>ship.mesh.position.set(i===0?0:i===1?-34:34,38+i*7,i===0?-542:-563));
      const retreat = smooth(.1,.6,u);
      this.humans.forEach((actor,i)=>{
        actor.character.crouch = smooth(.5,.7,u)*.7;
        this._place(actor,(i-2)*2.8,-546+retreat*4,Math.PI,0,u>.1&&u<.6?1.4:0);
      });
      // The guards close from both flanks. Only the rifle-equipped aliens fire.
      this.aliens.slice(0,4).forEach((actor,i)=>{
        const route=AMBUSH_ROUTES[i], advance=smooth(0,.7,u);
        const x=lerp(route.from[0],route.to[0],advance), z=lerp(route.from[1],route.to[1],advance);
        const victim=this.humans[i].mesh.position;
        this._place(actor,x,z,Math.atan2(x-victim.x,z-victim.z),0,u<.7?1.3:0,actor.hasGun);
        const shotPhase=(t+i*.23)%1.05;
        if (actor.hasGun && u>.18 && u<.9 && shotPhase<.09) {
          actor.mesh.updateMatrixWorld(true);
          actor.muzzle.getWorldPosition(this._a);
          const muzzle=[this._a.x,this._a.y,this._a.z];
          this._beam(i,muzzle,[victim.x+.7,.2,victim.z-.8]);
          if (this._cue(`shot-${i}-${Math.floor((t+i*.23)/1.05)}`,'gunshot',actor.mesh.position,.8))
            actor.character.kickRecoil();
        }
      });
      this._squareCamera('ambush',u);
      this._cue('ambush-call','alienCall',this.aliens[1].mesh.position,.85);
      if (u>.1&&u<.6) this._cue(`steps-${Math.floor(t*2.5)}`,'footstep',this.humans[2].mesh.position,.85);
    } else if (chapter === 2) {
      this.ships.forEach((ship,i)=>ship.mesh.position.set(i===0?0:i===1?-34:34,38+i*7,i===0?-542:-563));
      this.humans.forEach((actor,i)=>this._place(actor,...CAPTURE_POSITIONS[i],0));
      this.cages.forEach(cage=>{cage.position.y=0; cage.scale.y=Math.max(.02,smooth(0,.4,u));});
      this.aliens.slice(0,4).forEach((actor,i)=>this._place(actor,...AMBUSH_ROUTES[i].to,Math.PI,0,0,actor.hasGun));
      this._squareCamera('capture',u);
      this._cue('containment','abduction',null,.7);
    } else if (chapter === 3) {
      const lift = smooth(.16,.96,u);
      this.ships.forEach((ship,i)=>ship.mesh.position.set(i===0?0:i===1?-34:34,38+i*7,i===0?-542:-563));
      this.tractorMaterial.opacity = .08 + .09*smooth(0,.2,u);
      this.tractorLight.intensity = 80 + Math.sin(t*12)*12;
      this.liftRings.forEach((ring,i)=>{
        const y=(t*7+i*30/7)%30, r=9.5-y*.2;
        ring.position.y=y; ring.scale.setScalar(r);
      });
      const points=this.liftParticles.geometry.attributes.position;
      for(let i=0;i<points.count;i++) points.array[i*3+1]=(points.array[i*3+1]+delta*6)%30;
      points.needsUpdate=true;
      this.humans.forEach((actor, i) => {
        const [x,z]=CAPTURE_POSITIONS[i];
        this._place(actor,x*(1-lift*.65),z,Math.sin(t*.8+i)*.15, lift*30,0);
        actor.mesh.rotation.z=Math.sin(t*1.2+i)*.08*lift;
        actor.mesh.visible=lift<.99;
      });
      this._camera([13,lerp(6,25,lift),-535],[0,lerp(8,27,lift),-542]);
      this._cue(`tractor-${Math.floor(t/1.8)}`,'abduction',null,.85);
    } else if (chapter === 4) {
      const escape=smooth(.58,.96,u);
      this.brigCells.forEach((cell,i)=>{
        cell.group.scale.y=i===0?Math.max(.01,1-smooth(.42,.56,u)):1;
        cell.group.visible=i!==0||u<.58;
      });
      this.humans.forEach((actor,i)=>{
        const [x,y,z]=i===0?BRIG_PLAYER:BRIG_CAPTIVES[i-1];
        this._place(actor,x-(i===0?escape:0),z+(i===0?escape:0),i===0?-Math.PI*.75:0,y,i===0&&u>.58&&u<.96?.8:0);
      });
      // All three shots stay inside the 18x18m brig, below its five-metre roof.
      if(u<.38) this._camera([8.7+u*2,2.7,-50],[17,1.35,-46]);
      else if(u<.62) this._camera([21.7,2,-51],[19,1.3,-49]);
      else this._camera([21.7,2.5,-50],[18,1.3,-46.8]);
      if(u>.42) this._cue('cell-break','cageOpen',null,.8);
      if(u>.58&&u<.96) this._cue(`escape-step-${Math.floor(t*1.8)}`,'footstep',null,.65);
    } else {
      this.humans.forEach((actor, i) => this._place(actor, -8 + i * 2 + u * 3, -540 - u * 9, Math.PI, 0, 2));
      this.aliens.slice(0, 4).forEach((actor, i) => this._place(actor, -9 + i * 6, -588, 0, 0, 0, true));
      this.generators.forEach((generator, i) => generator.material.emissiveIntensity = 2 * (1 - smooth(.22 + i * .18, .4 + i * .18, u)));
      this.shield.material.opacity = .19 * (1 - smooth(.7, .9, u));
      this._camera([12-u*3,18,-538-u*4], [0,12,-608]);
    }
  }

  dispose() {
    this.stop();
    this.actors.forEach((actor) => { actor.mesh.parent?.remove(actor.mesh); actor.dispose(); });
    this.ships.forEach((ship) => ship.dispose());
    this.village.dispose();
    this.brigCells.forEach(cell=>cell.dispose());
    this.liftParticles.geometry.dispose(); this.liftParticles.material.dispose();
    this.shipModel?.traverse((node) => {
      node.geometry?.dispose();
      for (const material of !node.material ? [] : Array.isArray(node.material) ? node.material : [node.material]) {
        for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
        material.dispose();
      }
    });
    this.props.forEach((mesh) => { mesh.geometry?.dispose(); mesh.material?.dispose(); });
    this.beamGeometry.dispose(); this.beamMaterial.dispose();
  }
}
