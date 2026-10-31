import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

let cachedGLTF = null;
let loadPromise = null;

/**
 * Loads and caches the Mr-overalls.glb asset once so instances share GLTF data.
 */
function loadMrOverallsAsset() {
  if (typeof Image === 'undefined') {
    return Promise.resolve({ scene: new THREE.Group(), animations: [] });
  }
  if (cachedGLTF) return Promise.resolve(cachedGLTF);
  if (loadPromise) return loadPromise;

  const base = import.meta.env?.BASE_URL || '/';
  const url = `${base}assets/Mr-overalls.glb`;

  loadPromise = new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        cachedGLTF = gltf;
        resolve(gltf);
      },
      undefined,
      (err) => {
        console.error('[MrOverallsModel] Failed to load GLB from:', url, err);
        // Try fallback without leading slash if necessary
        loader.load(
          'assets/Mr-overalls.glb',
          (gltf2) => {
            cachedGLTF = gltf2;
            resolve(gltf2);
          },
          undefined,
          (err2) => reject(err2)
        );
      }
    );
  });

  return loadPromise;
}

/**
 * Creates an in-place version of a locomotion AnimationClip by stripping horizontal
 * root translation tracks. This prevents the animated mesh from sliding out of the
 * physics capsule while still preserving pelvic bounce, leg strides, and arm swings.
 */
function createInPlaceClip(clip) {
  const cloned = clip.clone();
  cloned.tracks = cloned.tracks.filter((track) => {
    // Strip root bone translation
    const isRootPos = /(?:^|\/|\.)root\.position$/i.test(track.name);
    return !isRootPos;
  });
  return cloned;
}

const LOWER_BODY_PATTERN = /(?:^|\/|\.)(root|pelvis|thigh_[lr]|calf_[lr]|foot_[lr]|ball_[lr]|ball_leaf_[lr])\./i;

/**
 * Creates a lower-body-only version of a locomotion clip (pelvis, legs, feet)
 * so the character's legs continue to stride naturally while the upper body shoots.
 */
function createLowerBodyClip(clip) {
  const cloned = clip.clone();
  cloned.name = `${clip.name}_lower`;
  cloned.tracks = cloned.tracks.filter((track) => {
    if (/(?:^|\/|\.)root\.position$/i.test(track.name)) return false;
    return LOWER_BODY_PATTERN.test(track.name);
  });
  return cloned;
}

/**
 * Creates an upper-body-only version of a clip (spine, arms, hands, head)
 * for layered shooting while walking or sprinting.
 */
function createUpperBodyClip(clip) {
  const cloned = clip.clone();
  cloned.name = `${clip.name}_upper`;
  cloned.tracks = cloned.tracks.filter((track) => {
    return !LOWER_BODY_PATTERN.test(track.name);
  });
  return cloned;
}

/**
 * Procedural tactical handgun model attached to Mr. Overalls' right hand.
 */
export function createHandgunMesh() {
  const group = new THREE.Group();
  group.name = 'Handgun';

  const slideMat = new THREE.MeshStandardMaterial({
    color: 0x1f2328,
    roughness: 0.35,
    metalness: 0.85
  });

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x2d3238,
    roughness: 0.7,
    metalness: 0.2
  });

  const gripMat = new THREE.MeshStandardMaterial({
    color: 0x121417,
    roughness: 0.9,
    metalness: 0.1
  });

  const sightMat = new THREE.MeshBasicMaterial({
    color: 0x00f5a0
  });

  // Upper Slide
  const slideGeo = new THREE.BoxGeometry(0.032, 0.042, 0.19);
  const slide = new THREE.Mesh(slideGeo, slideMat);
  slide.position.set(0, 0.045, -0.04);
  slide.castShadow = true;
  group.add(slide);

  // Barrel tip / muzzle opening
  const barrelGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.04, 8);
  barrelGeo.rotateX(Math.PI / 2);
  const barrel = new THREE.Mesh(barrelGeo, slideMat);
  barrel.position.set(0, 0.045, -0.14);
  group.add(barrel);

  // Lower frame / receiver & accessory rail
  const frameGeo = new THREE.BoxGeometry(0.03, 0.035, 0.16);
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.position.set(0, 0.02, -0.035);
  frame.castShadow = true;
  group.add(frame);

  // Grip handle
  const gripGeo = new THREE.BoxGeometry(0.028, 0.11, 0.048);
  const grip = new THREE.Mesh(gripGeo, gripMat);
  grip.position.set(0, -0.04, 0.02);
  grip.rotation.x = -0.26; // Natural ergonomic pistol grip rake angle
  grip.castShadow = true;
  group.add(grip);

  // Trigger guard
  const guardGeo = new THREE.BoxGeometry(0.016, 0.032, 0.045);
  const guard = new THREE.Mesh(guardGeo, frameMat);
  guard.position.set(0, -0.008, -0.015);
  group.add(guard);

  // Trigger
  const triggerGeo = new THREE.BoxGeometry(0.008, 0.02, 0.012);
  const trigger = new THREE.Mesh(triggerGeo, slideMat);
  trigger.position.set(0, -0.006, -0.01);
  trigger.rotation.x = 0.2;
  group.add(trigger);

  // Night-sights (front & rear illuminated dots)
  const frontSightGeo = new THREE.BoxGeometry(0.008, 0.009, 0.012);
  const frontSight = new THREE.Mesh(frontSightGeo, sightMat);
  frontSight.position.set(0, 0.07, -0.125);
  group.add(frontSight);

  const rearSightGeo = new THREE.BoxGeometry(0.018, 0.009, 0.01);
  const rearSight = new THREE.Mesh(rearSightGeo, sightMat);
  rearSight.position.set(0, 0.07, 0.045);
  group.add(rearSight);

  // Muzzle transform marker for tracers / particle effects
  const muzzle = new THREE.Object3D();
  muzzle.name = 'Muzzle';
  muzzle.position.set(0, 0.045, -0.165);
  group.add(muzzle);

  // Muzzle flash light
  const flashLight = new THREE.PointLight(0xffddaa, 0, 4);
  flashLight.position.set(0, 0.045, -0.17);
  group.add(flashLight);

  return { mesh: group, muzzle, flashLight };
}

/**
 * MrOverallsModel
 * Dedicated character controller & animation manager for Mr-overalls.glb in Level 1.
 * Self-contained in its own bubble: handles loading, animation crossfading, gun attachment,
 * locomotion (walk/sprint/jog), randomized idle, shooting, death, and scripted chest opening.
 */
export class MrOverallsModel {
  /**
   * @param {number} radius - Capsule radius in meters
   * @param {number} halfHeight - Capsule half-height in meters
   * @param {number} capsuleCenter - Vertical offset from base to capsule center
   * @param {Object} [options]
   */
  constructor(radius = 0.45, halfHeight = 0.55, capsuleCenter = 1.0, options = {}) {
    this.options = options;
    this.capsuleRadius = radius;
    this.capsuleHalfHeight = halfHeight;
    this.capsuleCenter = capsuleCenter;

    // Outer root mesh added to Player.mesh
    this.mesh = new THREE.Group();
    this.mesh.name = 'MrOverallsAvatar';

    // Model hierarchy and bone references
    this.avatarRoot = null;
    this.handBone = null;
    this.handgun = null;
    this.handgunPivot = null;

    // Animation & Mixer state
    this.mixer = null;
    this.actions = {};
    this.currentAction = null;
    this.currentActionName = null;
    this.currentLowerAction = null;

    // Animation preferences: user can toggle between jog and sprint
    // (default is 'jog', easily toggled via this.useSprintAnim = true)
    this.useSprintAnim = options.useSprintAnim === true;

    // State flags
    this.hasGun = options.hasGun !== undefined ? options.hasGun : true;
    this.isLoaded = false;
    this.isDead = false;
    this.isShooting = false;
    this.isOpeningChest = false;
    this.shootTimer = 0;
    this.chestTimer = 0;
    this.flashTimer = 0;

    // Idle randomization timing
    this.idleDuration = 2.5;
    this.idleTimer = 0;
    this.lastIdleIndex = 1;

    // Compatibility dummies for PlayerModel interface
    this.bodyMesh = null;
    this.visorMesh = null;
    this.packMesh = null;
    this.colliderDebugGroup = null;

    // Build debug collider wireframe
    this._createColliderDebugMesh();

    // Unified interface matching PlayerModel.character
    this.character = {
      animate: (delta, speed, isAiming) => this.update(delta, speed, isAiming),
      setActor: (actor) => { this.actor = actor; },
      setVisible: (visible) => this.setVisible(visible),
      setCrouchAmount: (amount) => this.setCrouchAmount(amount),
      dispose: () => this.dispose(),
      ready: null
    };

    // Load and initialize avatar
    this.readyPromise = this._init();
    this.character.ready = this.readyPromise;
  }

  async _init() {
    try {
      const gltf = await loadMrOverallsAsset();
      this._buildAvatar(gltf);
      this.isLoaded = true;
      return this;
    } catch (err) {
      console.error('[MrOverallsModel] Initialization failed:', err);
      throw err;
    }
  }

  _buildAvatar(gltf) {
    // Clone scene with skeleton preserving SkinnedMesh bindings
    this.avatarRoot = SkeletonUtils.clone(gltf.scene);
    this.avatarRoot.name = 'MrOverallsMesh';

    // Ground the model so feet touch Y = 0 (base of the capsule)
    this.avatarRoot.position.set(0, 0, 0);

    // Rotate 180 deg so character faces -Z (camera looks at his back)
    this.avatarRoot.rotation.y = Math.PI;

    // Scale character up by 1.5x
    const modelScale = this.options?.scale !== undefined ? this.options.scale : 1.5;
    this.avatarRoot.scale.setScalar(modelScale);

    // Setup shadows and materials
    this.avatarRoot.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        if (node.material) {
          node.material.depthWrite = true;
        }
      }
      if (node.isBone && node.name === 'hand_r') {
        this.handBone = node;
      }
    });

    this.mesh.add(this.avatarRoot);

    // Attach procedural handgun to right hand bone
    this._attachHandgun();

    // Initialize animation mixer and prepare actions
    this._initAnimations(gltf.animations);

    // Start with a random idle animation
    this._playRandomIdle(0);
  }

  /**
   * Attaches procedural handgun model snuggly into the right hand palm.
   */
  _attachHandgun() {
    this.handgun = createHandgunMesh();

    // Grip pivot allows precise offset and rotation inside the hand bone
    this.handgunPivot = new THREE.Group();
    this.handgunPivot.name = 'HandgunGripPivot';

    // Calibrated position & rotation relative to hand_r bone:
    // hand_r points along +Y to fingers, palm faces -X.
    // Orient barrel forward along the arm/fingers (+Y), slide top towards back of hand (+X)
    this.handgunPivot.position.set(-0.02, 0.08, 0.01);
    this.handgunPivot.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
    this.handgunPivot.visible = this.hasGun;

    this.handgunPivot.add(this.handgun.mesh);

    if (this.handBone) {
      this.handBone.add(this.handgunPivot);
    } else {
      // Fallback: search by name
      const found = this.avatarRoot.getObjectByName('hand_r');
      if (found) {
        this.handBone = found;
        this.handBone.add(this.handgunPivot);
      } else {
        console.warn('[MrOverallsModel] hand_r bone not found, gun attached to avatar root.');
        this.avatarRoot.add(this.handgunPivot);
      }
    }
  }

  /**
   * Sets whether the procedural handgun is visible in the player's hand.
   * @param {boolean} visible
   */
  setGunVisible(visible) {
    this.hasGun = !!visible;
    if (this.handgunPivot) {
      this.handgunPivot.visible = this.hasGun;
    }
  }

  /**
   * Parses GLTF animations, converts locomotion clips to in-place, and builds actions.
   */
  _initAnimations(clips) {
    if (!clips || clips.length === 0) return;

    this.mixer = new THREE.AnimationMixer(this.avatarRoot);

    clips.forEach((clip) => {
      const name = clip.name;

      if (name === 'idle_loop_fit') {
        this.actions.idle1 = this.mixer.clipAction(clip);
        this.actions.idle1.setLoop(THREE.LoopRepeat);
      } else if (name === 'idle_no_loop_fit') {
        this.actions.idle2 = this.mixer.clipAction(clip);
        this.actions.idle2.setLoop(THREE.LoopRepeat);
      } else if (name === 'walk_loop_fit') {
        const inPlace = createInPlaceClip(clip);
        this.actions.walk = this.mixer.clipAction(inPlace);
        this.actions.walk.setLoop(THREE.LoopRepeat);

        const lower = createLowerBodyClip(clip);
        this.actions.walkLower = this.mixer.clipAction(lower);
        this.actions.walkLower.setLoop(THREE.LoopRepeat);
      } else if (name === 'jog_fwd_loop_fit') {
        const inPlace = createInPlaceClip(clip);
        this.actions.jog = this.mixer.clipAction(inPlace);
        this.actions.jog.setLoop(THREE.LoopRepeat);

        const lower = createLowerBodyClip(clip);
        this.actions.jogLower = this.mixer.clipAction(lower);
        this.actions.jogLower.setLoop(THREE.LoopRepeat);
      } else if (name === 'sprint_loop_fit') {
        const inPlace = createInPlaceClip(clip);
        this.actions.sprint = this.mixer.clipAction(inPlace);
        this.actions.sprint.setLoop(THREE.LoopRepeat);

        const lower = createLowerBodyClip(clip);
        this.actions.sprintLower = this.mixer.clipAction(lower);
        this.actions.sprintLower.setLoop(THREE.LoopRepeat);
      } else if (name === 'pistol_shoot_fit') {
        this.actions.shoot = this.mixer.clipAction(clip);
        this.actions.shoot.setLoop(THREE.LoopOnce, 1);
        this.actions.shoot.clampWhenFinished = true;

        const upper = createUpperBodyClip(clip);
        this.actions.shootUpper = this.mixer.clipAction(upper);
        this.actions.shootUpper.setLoop(THREE.LoopOnce, 1);
        this.actions.shootUpper.clampWhenFinished = true;
      } else if (name === 'chest_open_fit') {
        this.actions.chestOpen = this.mixer.clipAction(clip);
        this.actions.chestOpen.setLoop(THREE.LoopOnce, 1);
        this.actions.chestOpen.clampWhenFinished = true;
      } else if (name === 'death01_fit') {
        this.actions.death = this.mixer.clipAction(clip);
        this.actions.death.setLoop(THREE.LoopOnce, 1);
        this.actions.death.clampWhenFinished = true;
      }
    });

    // Handle animation finish callbacks for one-shots
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.actions.shoot || e.action === this.actions.shootUpper) {
        this._onShootFinished();
      } else if (e.action === this.actions.chestOpen) {
        this.isOpeningChest = false;
        if (this._onChestOpenComplete) {
          this._onChestOpenComplete();
          this._onChestOpenComplete = null;
        }
        this._playRandomIdle(0.3);
      }
    });
  }

  /**
   * Smoothly crossfades to a target action.
   */
  _crossFade(targetAction, targetName, duration = 0.25) {
    if (!targetAction || targetAction === this.currentAction) return;

    const prevAction = this.currentAction;
    this.currentAction = targetAction;
    this.currentActionName = targetName;

    targetAction.enabled = true;
    targetAction.setEffectiveTimeScale(1);
    targetAction.setEffectiveWeight(1);
    targetAction.play();

    if (prevAction) {
      prevAction.crossFadeTo(targetAction, duration, true);
    } else {
      targetAction.fadeIn(duration);
    }
  }

  /**
   * Randomly chooses between the two idle animations (idle_loop_fit and idle_no_loop_fit)
   * and smoothly crossfades to it.
   */
  _playRandomIdle(duration = 0.35) {
    // Alternate or pick with weighted randomness (50/50)
    const chooseIndex = Math.random() < 0.5 ? 1 : 2;
    this.lastIdleIndex = chooseIndex;
    const targetAction = chooseIndex === 1 ? (this.actions.idle1 || this.actions.idle2) : (this.actions.idle2 || this.actions.idle1);
    const targetName = chooseIndex === 1 ? 'idle1' : 'idle2';

    this._crossFade(targetAction, targetName, duration);
    this.idleTimer = 0;
    // Set next random idle duration around 2.5 to 5.0 seconds
    this.idleDuration = 2.5 + Math.random() * 2.5;
  }

  /**
   * Helper that checks if the actor is actively holding down the primary fire trigger.
   */
  _isHoldingTrigger() {
    if (!this.actor || !this.actor.input) return false;
    const isLocked = this.actor.input.isPointerLocked !== false;
    return (
      isLocked &&
      typeof this.actor.input.isActionDown === 'function' &&
      this.actor.input.isActionDown('firePrimary') &&
      this.hasGun &&
      !this.isDead &&
      !this.actor.isDead &&
      !this.actor.isMounted &&
      !this.actor.isFrozen &&
      !this.actor.isDevSuspended
    );
  }

  /**
   * Triggers the shoot animation (pistol_shoot_fit) as a crisp action,
   * activating muzzle flash light, gunshot audio, and recoil feel.
   * If held, loops continuously every clip cycle.
   * @param {boolean} [force=false] - Force re-triggering even if currently playing
   */
  shoot(force = false) {
    if (!this.hasGun || !this.isLoaded || this.isDead || this.isOpeningChest) return false;
    if (!this.actions.shoot) return false;
    if (this.isShooting && this.shootTimer > 0 && !force) return false;

    this.isShooting = true;
    const timeScale = 1.35;
    this.shootTimer = 0.633 / timeScale; // Duration is ~0.468s per shot cycle

    const speed = this.actor ? Math.hypot(this.actor.velocity.x, this.actor.velocity.z) : 0;
    const isMoving = speed > 0.15;

    if (isMoving) {
      // Shooting while moving:
      // 1. Play upper-body shoot animation on arms/torso
      const shootUpper = this.actions.shootUpper || this.actions.shoot;
      shootUpper.stop();
      shootUpper.reset();
      shootUpper.setEffectiveTimeScale(timeScale);
      shootUpper.setEffectiveWeight(1);
      shootUpper.play();

      // 2. Play lower-body walk/jog animation so legs continue walking!
      const isSprinting = this.actor?.isSprinting === true;
      const lowerAction = isSprinting
        ? (this.useSprintAnim ? (this.actions.sprintLower || this.actions.jogLower) : (this.actions.jogLower || this.actions.sprintLower))
        : this.actions.walkLower;

      if (lowerAction) {
        lowerAction.enabled = true;
        lowerAction.setEffectiveTimeScale(1);
        lowerAction.setEffectiveWeight(1);
        lowerAction.play();
      }

      // Fade out previous full-body action so arms don't fight
      if (this.currentAction && this.currentAction !== shootUpper && this.currentAction !== lowerAction) {
        this.currentAction.fadeOut(0.08);
      }

      this.currentAction = shootUpper;
      this.currentActionName = 'shootUpper';
      this.currentLowerAction = lowerAction;
    } else {
      // Standing still: play full body shoot
      const shootAction = this.actions.shoot;
      shootAction.stop();
      shootAction.reset();
      shootAction.setEffectiveTimeScale(timeScale);
      shootAction.setEffectiveWeight(1);
      shootAction.play();

      if (this.currentAction && this.currentAction !== shootAction) {
        this.currentAction.crossFadeTo(shootAction, 0.08, true);
      }

      this.currentAction = shootAction;
      this.currentActionName = 'shoot';
      this.currentLowerAction = null;
    }

    // Flash muzzle light
    if (this.handgun?.flashLight) {
      this.handgun.flashLight.intensity = 3.5;
      this.flashTimer = 0.06;
    }

    // Gunshot audio
    if (this.actor?.gameWorld?.audio) {
      this.actor.gameWorld.audio.play('gunshot', this.actor.position, 0.75);
    }

    return true;
  }

  /**
   * Called when shooting completes to seamlessly transition back to idle or locomotion.
   */
  _onShootFinished() {
    if (!this.isShooting) return;
    if (this._isHoldingTrigger()) {
      this.shoot(true);
      return;
    }
    this.isShooting = false;
    this.shootTimer = 0;

    const speed = this.actor ? Math.hypot(this.actor.velocity.x, this.actor.velocity.z) : 0;
    const isMoving = speed > 0.15;

    // Fade out layered lower action if active
    if (this.currentLowerAction) {
      this.currentLowerAction.fadeOut(0.2);
      this.currentLowerAction = null;
    }

    // Fade out shoot actions
    if (this.actions.shootUpper) {
      this.actions.shootUpper.fadeOut(0.2);
    }
    if (this.actions.shoot) {
      this.actions.shoot.fadeOut(0.2);
    }

    if (isMoving) {
      const isSprinting = this.actor?.isSprinting === true;
      const moveAction = isSprinting
        ? (this.useSprintAnim ? (this.actions.sprint || this.actions.jog) : (this.actions.jog || this.actions.sprint))
        : this.actions.walk;
      const moveName = isSprinting ? (this.useSprintAnim ? 'sprint' : 'jog') : 'walk';

      moveAction.enabled = true;
      moveAction.setEffectiveTimeScale(1);
      moveAction.setEffectiveWeight(1);
      moveAction.fadeIn(0.2).play();

      this.currentAction = moveAction;
      this.currentActionName = moveName;
    } else {
      this._playRandomIdle(0.25);
    }
  }

  /**
   * Triggers the scripted chest open animation (chest_open_fit).
   * Reserved for upcoming chest/crate interaction.
   * @param {Object} [options]
   * @param {Function} [options.onComplete] - Callback when animation finishes
   */
  playChestOpen({ onComplete = null } = {}) {
    if (!this.isLoaded || this.isDead || !this.actions.chestOpen) return false;

    this.isOpeningChest = true;
    this._onChestOpenComplete = onComplete;
    this.chestTimer = 1.37; // Clip duration is ~1.367s

    const chestAction = this.actions.chestOpen;
    chestAction.reset();
    chestAction.setEffectiveTimeScale(1.0);
    chestAction.setEffectiveWeight(1);
    chestAction.play();

    if (this.currentAction && this.currentAction !== chestAction) {
      this.currentAction.crossFadeTo(chestAction, 0.2, true);
    }

    return true;
  }

  /**
   * Triggers the death animation (death01_fit) when character dies.
   */
  playDeath() {
    if (this.isDead || !this.isLoaded || !this.actions.death) return;

    this.isDead = true;
    this.isShooting = false;
    this.isOpeningChest = false;

    const deathAction = this.actions.death;
    deathAction.reset();
    deathAction.setEffectiveTimeScale(1.0);
    deathAction.setEffectiveWeight(1);
    deathAction.play();

    if (this.currentAction && this.currentAction !== deathAction) {
      this.currentAction.crossFadeTo(deathAction, 0.2, true);
    }
  }

  /**
   * Main per-frame animation and state machine update.
   * Called during Phase 5 (gameplayUpdate).
   * @param {number} delta - Frame delta seconds
   * @param {number} speed - Character horizontal movement speed in m/s
   * @param {boolean} isAiming - Aiming down sights flag
   */
  update(delta, speed = 0, isAiming = false) {
    if (!this.isLoaded || !this.mixer) return;

    // Advance animation mixer
    this.mixer.update(delta);

    // Muzzle flash light timeout
    if (this.flashTimer > 0) {
      this.flashTimer -= delta;
      if (this.flashTimer <= 0 && this.handgun?.flashLight) {
        this.handgun.flashLight.intensity = 0;
      }
    }

    // Dead or performing chest open: let the one-shot finish without locomotion interruption
    if (this.isDead) {
      return;
    }

    if (this.isOpeningChest) {
      this.chestTimer -= delta;
      if (this.chestTimer <= 0) {
        this.isOpeningChest = false;
        this._playRandomIdle(0.3);
      }
      return;
    }

    // While shooting: maintain and update lower-body locomotion if moving!
    if (this.isShooting) {
      const isMoving = speed > 0.15;
      const isSprinting = this.actor?.isSprinting === true;

      if (isMoving) {
        // If moving while shooting, ensure upper body is shooting and lower body is striding
        if (this.currentAction === this.actions.shoot && this.actions.shootUpper) {
          this.actions.shoot.fadeOut(0.08);
          this.actions.shootUpper.reset().fadeIn(0.08).play();
          this.currentAction = this.actions.shootUpper;
          this.currentActionName = 'shootUpper';
        }

        const targetLower = isSprinting
          ? (this.useSprintAnim ? (this.actions.sprintLower || this.actions.jogLower) : (this.actions.jogLower || this.actions.sprintLower))
          : this.actions.walkLower;

        if (this.currentLowerAction !== targetLower) {
          if (this.currentLowerAction) this.currentLowerAction.fadeOut(0.12);
          if (targetLower) targetLower.reset().fadeIn(0.12).play();
          this.currentLowerAction = targetLower;
        }

        if (this.currentLowerAction) {
          const nominalSpeed = isSprinting ? (this.useSprintAnim ? 10.0 : 7.0) : 3.8;
          this.currentLowerAction.timeScale = THREE.MathUtils.clamp(speed / nominalSpeed, 0.7, 1.4);
        }
      } else {
        if (this.currentLowerAction) {
          this.currentLowerAction.fadeOut(0.15);
          this.currentLowerAction = null;
        }
        if (this.currentAction === this.actions.shootUpper && this.actions.shoot) {
          this.actions.shootUpper.fadeOut(0.08);
          this.actions.shoot.reset().fadeIn(0.08).play();
          this.currentAction = this.actions.shoot;
          this.currentActionName = 'shoot';
        }
      }

      this.shootTimer -= delta;
      if (this.shootTimer <= 0) {
        if (this._isHoldingTrigger()) {
          this.shoot(true);
        } else {
          this._onShootFinished();
        }
      }
      return;
    }

    // Determine target locomotion state
    const isMoving = speed > 0.15;
    const isSprinting = this.actor?.isSprinting === true;

    if (!this.isShooting) {
      if (!isMoving) {
        // Idle state: manage random idle switching
        this.idleTimer += delta;
        if (this.currentActionName !== 'idle1' && this.currentActionName !== 'idle2') {
          this._playRandomIdle(0.25);
        } else if (this.idleTimer >= this.idleDuration) {
          this._playRandomIdle(0.4);
        }
      } else if (isSprinting) {
        // Sprint / Jog state:
        const sprintAction = this.useSprintAnim ? (this.actions.sprint || this.actions.jog) : (this.actions.jog || this.actions.sprint);
        const actionName = this.useSprintAnim ? 'sprint' : 'jog';

        if (this.currentActionName !== actionName) {
          this._crossFade(sprintAction, actionName, 0.22);
        }
        // Match foot cadence with actual speed
        const nominalSpeed = this.useSprintAnim ? 10.0 : 7.0;
        if (sprintAction) {
          sprintAction.timeScale = THREE.MathUtils.clamp(speed / nominalSpeed, 0.8, 1.4);
        }
      } else {
        // Walk state
        if (this.currentActionName !== 'walk' && this.actions.walk) {
          this._crossFade(this.actions.walk, 'walk', 0.22);
        }
        if (this.actions.walk) {
          // Match walk stride with speed
          this.actions.walk.timeScale = THREE.MathUtils.clamp(speed / 3.8, 0.7, 1.35);
        }
      }
    }
  }

  /**
   * Helper to retrieve world position of the handgun muzzle (for tracers/effects).
   */
  getMuzzleWorldPosition(outVec = new THREE.Vector3()) {
    if (this.handgun?.muzzle) {
      return this.handgun.muzzle.getWorldPosition(outVec);
    }
    return outVec.copy(this.mesh.position).add({ x: 0, y: 1.2, z: -0.5 });
  }

  /**
   * Toggles avatar visibility for 1st-person mode or camera proximity occlusion.
   */
  setFirstPerson(isFirstPerson) {
    if (this.avatarRoot) {
      this.avatarRoot.visible = !isFirstPerson;
    }
  }

  /**
   * Squashes the avatar towards the ground for crouching (optional compatibility).
   */
  setCrouchAmount(amount) {
    if (this.avatarRoot) {
      const squash = 1 - 0.25 * amount;
      this.avatarRoot.scale.y = squash;
    }
  }

  /**
   * Toggles whole avatar mesh visibility (e.g. when mounting a vehicle/turret).
   */
  setVisible(visible) {
    this.mesh.visible = visible;
  }

  /**
   * Toggles visibility of collider debug wireframe.
   */
  setColliderDebugVisible(visible) {
    if (this.colliderDebugGroup) {
      this.colliderDebugGroup.visible = visible;
    }
  }

  /**
   * Builds the neon cyan capsule wireframe for collider debug (matching PlayerModel).
   */
  _createColliderDebugMesh() {
    this.colliderDebugGroup = new THREE.Group();
    this.colliderDebugGroup.name = 'MrOveralls_Collider_Debug';
    this.colliderDebugGroup.userData = { noCollision: true };

    const length = this.capsuleHalfHeight * 2;
    const capsuleGeo = new THREE.CapsuleGeometry(this.capsuleRadius, length, 8, 16);

    const wireframeMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4,
      wireframe: true,
      transparent: true,
      opacity: 0.95
    });

    const wireMesh = new THREE.Mesh(capsuleGeo, wireframeMat);
    wireMesh.position.set(0, this.capsuleCenter, 0);
    wireMesh.userData = { noCollision: true };
    this.colliderDebugGroup.add(wireMesh);

    this.colliderDebugGroup.visible = false;
    this.mesh.add(this.colliderDebugGroup);
  }

  /**
   * Clean up all geometries, materials, mixers, and remove from parent.
   */
  dispose() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.avatarRoot);
      this.mixer = null;
    }

    if (this.handgun?.mesh) {
      this.handgun.mesh.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose());
          else node.material.dispose();
        }
      });
    }

    if (this.avatarRoot) {
      this.avatarRoot.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose());
          else node.material.dispose();
        }
      });
    }

    if (this.colliderDebugGroup) {
      this.colliderDebugGroup.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) node.material.dispose();
      });
    }

    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
  }
}
