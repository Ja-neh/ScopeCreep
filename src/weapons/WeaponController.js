import * as THREE from 'three';
import { BaseEntity } from '../entities/BaseEntity.js';
import { CameraMode } from '../entities/components/SpringArmCamera.js';
import { HitscanWeapon } from './HitscanWeapon.js';
import { MeleeWeapon } from './MeleeWeapon.js';
import { WeaponEffects } from './WeaponEffects.js';
import { createWeaponMaterials, createRifleModel, createKnifeModel, createBombModel, disposeModelGeometry } from './WeaponModels.js';
import config from '../config.json';

// Camera and pose feel while armed (visual, not balance)
const SHOULDER_OFFSET = 0.75;                              // Over-the-shoulder view so the crosshair clears the head
const ADS_FOV = 42;                                        // Field of view while aiming down sights (degrees)
const ADS_DISTANCE = 2.4;                                  // Third-person camera distance while aiming
const ADS_BLEND_RATE = 12;
const HELD_PIVOT = new THREE.Vector3(0.32, 1.38, -0.1);   // Right shoulder in the avatar's frame
const VIEW_OFFSET = new THREE.Vector3(0.24, -0.22, -0.5); // First-person gun position in camera space
const VIEW_OFFSET_ADS = new THREE.Vector3(0, -0.16, -0.42);
const RECOIL_KICK = 0.06;                                  // Visual kickback of the gun per shot (meters)
const SHOULDER_SHOT_DROP = 0.25;                           // Third-person shots leave the shoulder, below the eye

const SLOT_CYCLE = ['rifle', 'knife', 'bomb'];
const WEAPON_NAMES = { rifle: 'MACHINE GUN', knife: 'KNIFE', bomb: 'BOMB' };

/**
 * WeaponController
 * Gives a Player a machine gun, a knife and a plasma bomb: switching (1 / 2 / 3 / mouse wheel),
 * quick knife (Q), reload (R), aim down sights (right mouse), recoil, tracers and impacts, a held
 * model on the avatar and a first-person view model, plus the crosshair and slot HUD. The bomb is
 * thrown through the shared grenade pool (an arc to the crosshair, blast-only damage).
 * Attached by levels that need infantry combat, so Player itself stays weapon-free.
 * Add it to the GameWorld after its Player so its Phase 6 update runs after the camera has moved.
 *
 * - Phase 5 (gameplayUpdate): input, firing, melee hits, bomb throws, ammo and HUD
 * - Phase 6 (lateUpdate): aim zoom, held / view model poses, effects
 */
export class WeaponController extends BaseEntity {
  /**
   * @param {GameWorld} gameWorld
   * @param {Player} player
   * @param {Object} [options]
   * @param {(position: THREE.Vector3) => void} [options.onGunshot] - Called per shot (for AI hearing)
   * @param {(origin: THREE.Vector3, point: THREE.Vector3) => void} [options.onBulletImpact] - Called
   *   per shot that lands, with its flight line: lets levels damage thin scenery (bushes) that
   *   has no collider to stop the bullet
   */
  constructor(gameWorld, player, { onGunshot = null, onBulletImpact = null } = {}) {
    super('WeaponController');
    this.gameWorld = gameWorld;
    this.player = player;
    this.onGunshot = onGunshot;
    this.onBulletImpact = onBulletImpact;

    this.gunCfg = config.weapons.machineGun;
    this.knifeCfg = config.weapons.knife;
    this.bombCfg = config.weapons.bomb;
    this.switchSeconds = config.weapons.switchSeconds;

    this.rifle = new HitscanWeapon(this.gunCfg);
    this.knife = new MeleeWeapon(this.knifeCfg);
    this.bombsLeft = this.bombCfg.count;
    this.equipped = 'rifle';
    this.switchTimer = 0;
    this.quickMeleeTimer = 0; // > 0 while a quick knife swing stands in for the gun
    this.throwTimer = 0;      // Cools down between bomb throws and clocks the toss pose
    this.isAiming = false;
    this._adsBlend = 0;
    this._recoil = 0;
    this._recoilPitch = 0; // Aim climb not yet settled back

    // Held copy on the avatar (third person) and a view-model copy in front of the camera (first person)
    this.materials = createWeaponMaterials();
    this.heldPivot = new THREE.Group();
    this.heldPivot.position.copy(HELD_PIVOT);
    player.mesh.add(this.heldPivot);
    this.heldRifle = createRifleModel(this.materials);
    this.heldKnife = createKnifeModel(this.materials);
    this.heldBomb = createBombModel(this.materials);
    this.heldPivot.add(this.heldRifle.mesh, this.heldKnife.mesh, this.heldBomb.mesh);

    this.viewModel = new THREE.Group();
    this.viewModel.name = 'WeaponViewModel';
    this.viewRifle = createRifleModel(this.materials);
    this.viewKnife = createKnifeModel(this.materials);
    this.viewBomb = createBombModel(this.materials);
    this.viewModel.add(this.viewRifle.mesh, this.viewKnife.mesh, this.viewBomb.mesh);
    this.viewModel.traverse((child) => { if (child.isMesh) child.castShadow = false; });
    this.viewModel.visible = false;
    gameWorld.effectsGroup.add(this.viewModel);

    this.effects = new WeaponEffects(gameWorld.effectsGroup);

    // Camera defaults, restored on dispose
    this._baseFov = gameWorld.camera.fov;
    this._baseDistance = player.springArm.thirdPersonDistance;
    this._baseShoulder = player.springArm.shoulderOffset;
    player.springArm.shoulderOffset = SHOULDER_OFFSET;

    // Scratchpads (no allocations per frame or per shot)
    this._aimRay = null;
    this._camPos = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this._aimPoint = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._tmp = new THREE.Vector3();

    this._hud = { weapon: null, ammo: -1, reserve: -1, bombs: -1, reloadStep: -2 };
    if (gameWorld.ui) {
      gameWorld.ui.showCrosshair('rifle');
      gameWorld.ui.showWeaponHUD();
    }
    this._showModels();
    this._refreshHud(true);
  }

  /**
   * The weapon in hand right now (a quick knife swing briefly replaces the gun).
   */
  get activeWeapon() {
    return this.quickMeleeTimer > 0 ? 'knife' : this.equipped;
  }

  /**
   * Phase 5: weapon timers, input, firing and melee hits.
   */
  gameplayUpdate(delta, gameWorld = this.gameWorld) {
    const input = gameWorld.input;
    const player = this.player;

    this.rifle.update(delta);
    if (this.knife.update(delta)) this._resolveStrike(gameWorld);
    if (this.switchTimer > 0) this.switchTimer -= delta;
    if (this.throwTimer > 0) this.throwTimer -= delta;
    if (this.quickMeleeTimer > 0) {
      this.quickMeleeTimer -= delta;
      if (this.quickMeleeTimer <= 0) this._showModels();
    }

    const canAct = input.isPointerLocked && !player.isDevSuspended && !player.isMounted;
    this.isAiming = canAct && this.activeWeapon === 'rifle' && input.isActionDown('aimDownSights');

    if (canAct) {
      if (input.isActionJustPressed('weaponPrimary')) {
        this._equip('rifle');
      } else if (input.isActionJustPressed('weaponMelee')) {
        this._equip('knife');
      } else if (input.isActionJustPressed('weaponBomb')) {
        this._equip('bomb');
      } else if (input.isActionJustPressed('weaponNext')) {
        this._equip(SLOT_CYCLE[(SLOT_CYCLE.indexOf(this.equipped) + 1) % SLOT_CYCLE.length]);
      } else if (input.isActionJustPressed('weaponPrev')) {
        this._equip(SLOT_CYCLE[(SLOT_CYCLE.indexOf(this.equipped) + SLOT_CYCLE.length - 1) % SLOT_CYCLE.length]);
      }

      if (input.isActionJustPressed('reload') && this.equipped === 'rifle') {
        if (this.rifle.startReload() && gameWorld.audio) gameWorld.audio.play('reload');
      }

      // Quick knife: swing without switching weapons
      if (input.isActionJustPressed('quickMelee') && this.equipped === 'rifle' && this.quickMeleeTimer <= 0 && this.knife.startAttack()) {
        this.rifle.cancelReload();
        this.quickMeleeTimer = this.knifeCfg.cooldown;
        this._showModels();
      }

      if (this.switchTimer <= 0 && this.quickMeleeTimer <= 0) {
        if (this.equipped === 'rifle' && input.isActionDown('firePrimary')) {
          this._fireRifle(gameWorld);
        } else if (this.equipped === 'knife' && input.isActionJustPressed('firePrimary')) {
          this.knife.startAttack();
        } else if (this.equipped === 'bomb' && input.isActionDown('firePrimary')) {
          this._throwBomb(gameWorld);
        }
      }
    }

    // Recoil settles back once the trigger is released (the climb itself happens in _fireRifle)
    const firingRifle = canAct && this.equipped === 'rifle' && this.switchTimer <= 0 &&
      this.quickMeleeTimer <= 0 && input.isActionDown('firePrimary');
    if (!firingRifle && this._recoilPitch > 0) {
      const recover = this._recoilPitch * Math.min(1, this.gunCfg.recoilRecoveryRate * delta);
      player.pitch = Math.max(-1.4, player.pitch - recover);
      this._recoilPitch -= recover;
    }

    this._refreshHud(false);
  }

  _equip(weapon) {
    if (weapon === this.equipped) return;
    this.equipped = weapon;
    this.switchTimer = this.switchSeconds;
    this.rifle.cancelReload();
    this._showModels();
    this._refreshHud(true);
  }

  _fireRifle(gameWorld) {
    if (!this.rifle.canFire()) {
      if (this.rifle.ammo === 0 && this.rifle.startReload() && gameWorld.audio) {
        gameWorld.audio.play('reload');
      }
      return;
    }

    const player = this.player;
    this._computeAim(gameWorld);
    const moving = Math.hypot(player.velocity.x, player.velocity.z) > 0.5;
    const spread = this.rifle.currentSpread({ aiming: this.isAiming, moving, crouching: player.isCrouching });
    const result = this.rifle.fire({
      physicsWorld: gameWorld.physics,
      origin: this._origin,
      aimPoint: this._aimPoint,
      spread,
      excludeCollider: player.collider,
      source: player
    });
    if (!result) return;

    if (gameWorld.audio) gameWorld.audio.play('gunshot');

    // Effects leave from the gun the player can see
    this._visibleMuzzle(this._muzzle);
    this.effects.muzzleFlash(this._muzzle, result.point);
    this.effects.tracer(this._muzzle, result.point);
    this._tmp.subVectors(result.point, this._muzzle).normalize();
    this.effects.muzzleSmoke(this._muzzle, this._tmp, 0.45);
    if (result.hit) {
      const surface = result.entity ? 'hit' : (result.collider.userData && result.collider.userData.isTerrain ? 'dust' : 'spark');
      this.effects.impact(result.point, surface);
      // Bullet holes only on fixed surfaces: decks and characters move out from under a decal
      const hitSurface = result.collider.rigidBody;
      if (gameWorld.decals && hitSurface && typeof hitSurface.isFixed === 'function' && hitSurface.isFixed()) {
        gameWorld.decals.spawn(result.point, result.normal, 'bullet');
      }
    }
    if (result.damaged && gameWorld.audio) {
      gameWorld.audio.play('hit');
    }
    if (result.damaged && gameWorld.ui) {
      gameWorld.ui.flashCrosshairHit(result.killed);
    }

    // Recoil: the aim climbs and wanders a little (tracked so it can settle back after release)
    const recoilScale = this.isAiming ? 0.6 : 1;
    const climb = Math.min(1.4 - player.pitch, this.gunCfg.recoilPitch * recoilScale);
    player.pitch += climb;
    player.yaw += (Math.random() - 0.5) * 2 * this.gunCfg.recoilYaw * recoilScale;
    this._recoilPitch += climb;
    this._recoil = RECOIL_KICK;

    // The shot's flight line: thin scenery with no collider (a bush) is told what crossed it
    if (this.onBulletImpact && result.hit) this.onBulletImpact(this._origin, result.point);
    if (this.onGunshot) this.onGunshot(this._origin);
  }

  /**
   * Throws a plasma bomb: the point under the crosshair (scattered a little — it is a throw, not
   * a shot), lobbed by the shared grenade pool. The blast hurts the aliens and tears up cover.
   */
  _throwBomb(gameWorld) {
    if (this.bombsLeft <= 0 || this.throwTimer > 0) return;
    const pool = gameWorld.projectilePool;
    if (!pool || typeof pool.fireGrenade !== 'function') return;

    this._computeAim(gameWorld, this.bombCfg.range);
    if (this.bombCfg.aimError > 0) {
      this._aimPoint.x += (Math.random() - 0.5) * 2 * this.bombCfg.aimError;
      this._aimPoint.z += (Math.random() - 0.5) * 2 * this.bombCfg.aimError;
    }
    pool.fireGrenade({
      origin: this._origin,
      target: this._aimPoint,
      source: this.player,
      excludeCollider: this.player.collider
    });
    this.bombsLeft--;
    this.throwTimer = this.bombCfg.throwSeconds;
    // The throw is loud: aliens nearby turn towards it
    if (this.onGunshot) this.onGunshot(this._origin);
    this._refreshHud(true);
  }

  /**
   * Shots go from the shoulder (or eye, in first person) to whatever is under the crosshair.
   * The crosshair ray starts level with the player so nothing between camera and player catches it.
   */
  _computeAim(gameWorld, range = this.gunCfg.range) {
    const player = this.player;
    const camera = gameWorld.camera;
    this._camPos.copy(camera.position);
    camera.getWorldDirection(this._camDir);

    this._eye.set(player.position.x, player.position.y + player.springArm.eyeHeight, player.position.z);
    this._origin.copy(this._eye);
    if (player.cameraMode !== CameraMode.FIRST_PERSON) {
      this._origin.y -= SHOULDER_SHOT_DROP;
      this._origin.x += Math.cos(player.yaw) * HELD_PIVOT.x;
      this._origin.z -= Math.sin(player.yaw) * HELD_PIVOT.x;
    }

    const start = Math.max(0, this._tmp.subVectors(this._eye, this._camPos).dot(this._camDir));
    this._tmp.copy(this._camPos).addScaledVector(this._camDir, start);

    const physics = gameWorld.physics;
    if (!this._aimRay) {
      this._aimRay = new physics.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    }
    this._aimRay.origin.x = this._tmp.x;
    this._aimRay.origin.y = this._tmp.y;
    this._aimRay.origin.z = this._tmp.z;
    this._aimRay.dir.x = this._camDir.x;
    this._aimRay.dir.y = this._camDir.y;
    this._aimRay.dir.z = this._camDir.z;
    const hit = physics.castRay(this._aimRay, range, true, undefined, undefined, player.collider);
    this._aimPoint.copy(this._tmp).addScaledVector(this._camDir, hit ? hit.timeOfImpact : range);
  }

  _visibleMuzzle(out) {
    const muzzle = this.viewModel.visible ? this.viewRifle.muzzle : this.heldRifle.muzzle;
    return muzzle.getWorldPosition(out);
  }

  _resolveStrike(gameWorld) {
    const player = this.player;
    this._origin.set(player.position.x, player.position.y + player.springArm.eyeHeight - 0.3, player.position.z);
    const result = this.knife.strike({
      physicsWorld: gameWorld.physics,
      origin: this._origin,
      yaw: player.yaw,
      pitch: player.pitch,
      excludeCollider: player.collider,
      source: player
    });
    if (result.hit) {
      this.effects.impact(result.point, 'hit');
      if (gameWorld.audio) gameWorld.audio.play('hit');
      if (gameWorld.ui) gameWorld.ui.flashCrosshairHit(result.killed);
    }
  }

  /**
   * Phase 6: aim zoom, held and view model poses, effects, crosshair size.
   */
  lateUpdate(delta, gameWorld = this.gameWorld) {
    const player = this.player;
    const camera = gameWorld.camera;

    // Aim-down-sights zoom
    const adsTarget = this.isAiming ? 1 : 0;
    this._adsBlend += (adsTarget - this._adsBlend) * Math.min(1, ADS_BLEND_RATE * delta);
    const fov = THREE.MathUtils.lerp(this._baseFov, ADS_FOV, this._adsBlend);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    player.springArm.thirdPersonDistance = THREE.MathUtils.lerp(this._baseDistance, ADS_DISTANCE, this._adsBlend);

    this._recoil = Math.max(0, this._recoil - delta * 0.6);

    // Held weapon: follows aim pitch, lowers when crouching, hidden whenever the body is
    this.heldPivot.position.y = HELD_PIVOT.y * (1 - 0.35 * player.crouchAmount);
    this.heldPivot.rotation.x = player.pitch;
    this.heldPivot.visible = player.bodyMesh.visible;
    this.heldRifle.mesh.position.z = this._recoil;

    // First-person view model in front of the camera
    const firstPerson = player.cameraMode === CameraMode.FIRST_PERSON && !player.isDevSuspended && !player.isMounted;
    this.viewModel.visible = firstPerson;
    if (firstPerson) {
      this._tmp.lerpVectors(VIEW_OFFSET, VIEW_OFFSET_ADS, this._adsBlend);
      this._tmp.z += this._recoil;
      if (this.switchTimer > 0) this._tmp.y -= (this.switchTimer / this.switchSeconds) * 0.3;
      this.viewModel.position.copy(this._tmp).applyQuaternion(camera.quaternion).add(camera.position);
      this.viewModel.quaternion.copy(camera.quaternion);
    }

    // Knife swing: a quick stab forward and down
    const swing = this.activeWeapon === 'knife' ? this.knife.swingProgress : 1;
    const arc = swing < 1 ? Math.sin(swing * Math.PI) : 0;
    this.heldKnife.mesh.rotation.x = -arc * 1.2;
    this.heldKnife.mesh.position.z = -arc * 0.25;
    this.viewKnife.mesh.rotation.x = -arc * 1.2;
    this.viewKnife.mesh.position.z = -arc * 0.25;

    // Bomb: rests in the hand; a throw flicks it forward
    const toss = this.activeWeapon === 'bomb' && this.throwTimer > 0
      ? Math.sin((1 - this.throwTimer / this.bombCfg.throwSeconds) * Math.PI)
      : 0;
    this.heldBomb.mesh.rotation.x = -toss * 1.4;
    this.viewBomb.mesh.rotation.x = -toss * 1.4;

    this.effects.update(delta);

    if (gameWorld.ui && this.activeWeapon === 'rifle') {
      const moving = Math.hypot(player.velocity.x, player.velocity.z) > 0.5;
      const spread = this.rifle.currentSpread({ aiming: this.isAiming, moving, crouching: player.isCrouching });
      gameWorld.ui.setCrosshairSpread(spread, camera.fov);
    }
  }

  _showModels() {
    const weapon = this.activeWeapon;
    this.heldRifle.mesh.visible = weapon === 'rifle';
    this.heldKnife.mesh.visible = weapon === 'knife';
    this.heldBomb.mesh.visible = weapon === 'bomb';
    this.viewRifle.mesh.visible = weapon === 'rifle';
    this.viewKnife.mesh.visible = weapon === 'knife';
    this.viewBomb.mesh.visible = weapon === 'bomb';
  }

  /**
   * Sends the ammo panel new values only when something it shows has changed.
   */
  _refreshHud(force) {
    const ui = this.gameWorld.ui;
    if (!ui) return;

    const weapon = this.activeWeapon;
    const reloadStep = this.rifle.isReloading ? Math.floor(this.rifle.reloadProgress * 50) : -1;
    const hud = this._hud;
    if (!force && hud.weapon === weapon && hud.ammo === this.rifle.ammo &&
        hud.reserve === this.rifle.reserve && hud.bombs === this.bombsLeft && hud.reloadStep === reloadStep) {
      return;
    }
    hud.weapon = weapon;
    hud.ammo = this.rifle.ammo;
    hud.reserve = this.rifle.reserve;
    hud.bombs = this.bombsLeft;
    hud.reloadStep = reloadStep;

    ui.updateWeaponHUD({
      name: WEAPON_NAMES[weapon],
      slot: SLOT_CYCLE.indexOf(weapon) + 1,
      ammo: weapon === 'rifle' ? this.rifle.ammo : (weapon === 'bomb' ? this.bombsLeft : null),
      reserve: weapon === 'rifle' ? this.rifle.reserve : null,
      reloadProgress: reloadStep >= 0 ? reloadStep / 50 : null
    });
  }

  dispose() {
    const camera = this.gameWorld.camera;
    camera.fov = this._baseFov;
    camera.updateProjectionMatrix();
    if (this.player.springArm) {
      this.player.springArm.thirdPersonDistance = this._baseDistance;
      this.player.springArm.shoulderOffset = this._baseShoulder;
    }

    disposeModelGeometry(this.heldPivot);
    disposeModelGeometry(this.viewModel);
    for (const material of Object.values(this.materials)) material.dispose();
    this.effects.dispose();

    if (this.gameWorld.ui) {
      this.gameWorld.ui.hideCrosshair();
      this.gameWorld.ui.hideWeaponHUD();
    }
    super.dispose();
  }
}
