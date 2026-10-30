import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { TwoBoneIK } from './TwoBoneIK.js';
import { HumanoidAnimationPlayer } from './HumanoidAnimationPlayer.js';

export const CHARACTER_IDS = ['deadpool', 'ashe', 'firion', 'junker-queen', 'gorr', 'bob', 'galiant', 'bahamut-nt', 'bahamut-xvi'];
const assets = new Map();
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();

function disposeAsset(gltf) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  gltf.scene.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    texture.dispose();
    texture.source?.data?.close?.();
  }
}

/** Share immutable geometry/textures; keep poses and damage materials per actor. */
function acquire(id) {
  let entry = assets.get(id);
  if (!entry) {
    entry = { refs: 0, gltf: null };
    const base = import.meta.env?.BASE_URL || '/';
    entry.promise = new GLTFLoader().loadAsync(`${base}assets/characters/${id}.glb`).then(async (gltf) => {
      if (!['galiant','bahamut-nt','bahamut-xvi'].includes(id)) {
        try {
          const response=await fetch(`${base}assets/animations/${id}.json`);
          if (response.ok) gltf.motion=await response.json();
        } catch { /* The procedural fallback remains available if a motion file is unavailable. */ }
      }
      entry.gltf = gltf;
      if (entry.refs === 0) disposeAsset(gltf);
      return gltf;
    }).catch((error) => {
      // A stopped/restarted dev server must not poison subsequent level loads.
      if (assets.get(id) === entry) assets.delete(id);
      throw error;
    });
    assets.set(id, entry);
  }
  entry.refs++;
  return {
    promise: entry.promise,
    release() {
      if (--entry.refs !== 0) return;
      if (assets.get(id) === entry) assets.delete(id);
      if (entry.gltf) disposeAsset(entry.gltf);
    }
  };
}

/** Visual-only skin. Physics, weapons and entity lifecycles stay with their owners. */
export class CharacterVisual {
  constructor(parent, id, { height = 1.9, hide = [], weakSpot = false,
    enabled = typeof Image !== 'undefined', acquireAsset = acquire } = {}) {
    if (!CHARACTER_IDS.includes(id)) throw new Error(`Unknown character: ${id}`);
    this.id = id;
    this.group = null;
    if (enabled) {
      this.group = new THREE.Group();
      this.group.name = `CharacterVisual:${id}`;
      this.group.userData.noCollision = true;
      parent.add(this.group);
    }
    this.hide = hide;
    this.height = height;
    this.loaded = false;
    this.disposed = false;
    this.phase = 0;
    this.actor = null;
    this.crouch = 0;
    this.recoil = 0;
    this.recoilVelocity = 0;
    this.aimBlend = 0;
    this.ik = new TwoBoneIK();
    this.target = new THREE.Vector3();
    this.bend = new THREE.Vector3();
    this.localVelocity = new THREE.Vector3();
    this.orientation = new THREE.Quaternion();
    this.inverseOrientation = new THREE.Quaternion();
    this.shoulderLeft = new THREE.Vector3();
    this.shoulderRight = new THREE.Vector3();
    this.weaponCenter = new THREE.Vector3();
    this.motionSpeed = 0;
    this.motion = null;
    this.armed = false;
    this.reloadProgress = 1;
    this.pickupProgress = -1;
    this.throwProgress = -1;
    this.armLength = 0.5;
    this.pelvisDrop = 0.06;
    this.feet = [];
    this.weapon = null;
    this.pickupTarget = null;
    this.pickupBlend = 0;
    this.materials = [];
    this.joints = {};
    this._hidden = new Map();
    this._weakSpot = weakSpot;
    this.ready = Promise.resolve(false);
    if (!enabled) return;
    this.lease = acquireAsset(id);
    this.ready = this.lease.promise.then((asset) => {
      if (this.disposed) return false;
      this._attach(asset);
      return true;
    }).catch((error) => {
      console.warn(`[Characters] ${id} unavailable; keeping procedural avatar.`, error);
      return false;
    });
  }

  _attach(gltf) {
    this.root = clone(gltf.scene);
    this.root.rotation.y += Math.PI;
    this.group.add(this.root);
    this.root.updateMatrixWorld(true);
    // Normalize relative to this visual, independent of its actor's position/scale.
    const savedParent = this.group.parent;
    const savedScale = this.group.scale.clone();
    this.group.removeFromParent();
    this.group.scale.setScalar(1);
    this.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    const scale = this.height / Math.max(0.001, box.max.y - box.min.y);
    this.root.scale.multiplyScalar(scale);
    this.root.position.set(-(box.min.x + box.max.x) * 0.5 * scale, -box.min.y * scale,
      -(box.min.z + box.max.z) * 0.5 * scale);
    this.rootRestY = this.root.position.y;
    this.group.updateMatrixWorld(true);
    this.root.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        node.frustumCulled = false; // Animated bounds can extend beyond the bind pose.
        const copy = (material) => {
          const result = material.clone();
          result.transparent = false;
          result.alphaTest = 0.5;
          result.depthWrite = true;
          result.side = THREE.DoubleSide;
          result.userData.baseEmissive = result.emissive?.clone();
          this.materials.push(result);
          return result;
        };
        node.material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material);
      }
      if (node.isBone && node.name.startsWith('SC_')) {
        const world = node.getWorldQuaternion(new THREE.Quaternion()).invert();
        this.joints[node.name.slice(3)] = { bone: node, rest: node.quaternion.clone(),
          x: X.clone().applyQuaternion(world), z: Z.clone().applyQuaternion(world), neutral: 0 };
      }
    });
    // Bring source A/T poses down into a relaxed stance using the actual bind directions.
    for (const side of ['left', 'right']) {
      const arm = this.joints[`${side}UpperArm`], elbow = this.joints[`${side}Forearm`];
      if (arm && elbow) {
        const direction = elbow.bone.getWorldPosition(new THREE.Vector3()).sub(arm.bone.getWorldPosition(new THREE.Vector3()));
        const desired = Math.atan2(-1, Math.sign(direction.x) * 0.12);
        arm.neutral = THREE.MathUtils.euclideanModulo(desired - Math.atan2(direction.y, direction.x) + Math.PI, Math.PI * 2) - Math.PI;
      }
    }
    this.chest = new THREE.Vector3(0, this.height * 0.6, 0);
    this.joints.spine?.bone.getWorldPosition(this.chest);
    let lengthSum = 0, lengthCount = 0;
    for (const side of ['left', 'right']) {
      const upper = this.joints[side+'UpperArm']?.bone, lower = this.joints[side+'Forearm']?.bone,
        end = this.joints[side+'Hand']?.bone;
      if (upper && lower && end) {
        upper.getWorldPosition(this.shoulderLeft); lower.getWorldPosition(this.shoulderRight);
        end.getWorldPosition(this.target);
        lengthSum += this.shoulderLeft.distanceTo(this.shoulderRight) + this.shoulderRight.distanceTo(this.target);
        lengthCount++;
      }
    }
    if (lengthCount) this.armLength = lengthSum / lengthCount;
    for (const side of ['left', 'right']) {
      const upper = this.joints[side+'Thigh']?.bone, lower = this.joints[side+'Shin']?.bone,
        end = this.joints[side+'Foot']?.bone;
      if (upper && lower && end) {
        const rest = end.getWorldPosition(new THREE.Vector3());
        this.group.worldToLocal(rest);
        this.feet.push({ upper, lower, end, rest, anchor: new THREE.Vector3(), planted: false,
          support: null, supportPoint: new THREE.Vector3(), restRotation: end.getWorldQuaternion(new THREE.Quaternion()), offset: side === 'left' ? 0 : 0.5 });
      }
    }
    this.group.scale.copy(savedScale);
    savedParent.add(this.group);
    for (const node of this.hide) {
      this._hidden.set(node, node.visible);
      node.visible = false;
    }
    if (this._weakSpot) {
      this.weakSpot = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xff8a3d, emissive: 0xff5a0a, emissiveIntensity: 2 }));
      this.weakSpot.position.copy(this.chest);
      this.weakSpot.position.z += 0.33;
      this.group.add(this.weakSpot);
    }
    this.loaded = true;
    if (gltf.motion?.clips?.length) this.motion=new HumanoidAnimationPlayer(this.root,gltf.motion);
    this.animate(0, 0, false);
  }

  _pose(role, pitch = 0, roll = 0) {
    const joint = this.joints[role];
    if (!joint) return;
    joint.bone.quaternion.copy(joint.rest);
    joint.bone.quaternion.multiply(_q.setFromAxisAngle(joint.x, pitch));
    joint.bone.quaternion.multiply(_q.setFromAxisAngle(joint.z, joint.neutral + roll));
  }

  animate(delta, speed, aiming, raise = 0) {
    if (!this.loaded || this.disposed) return;
    this.motionSpeed = THREE.MathUtils.damp(this.motionSpeed, speed, 10, delta);
    speed = this.motionSpeed;
    this.phase += delta * (speed > 0.1 ? Math.min(18, 4 + speed * 1.8) : 0);
    this.aimBlend = THREE.MathUtils.damp(this.aimBlend, aiming ? 1 : 0, 12, delta);
    // A damped recoil spring, substepped to remain stable during slow frames.
    let remaining = Math.min(delta, 0.1);
    while (remaining > 0) {
      const dt = Math.min(remaining, 1 / 120);
      this.recoilVelocity += (-150 * this.recoil - 22 * this.recoilVelocity) * dt;
      this.recoil += this.recoilVelocity * dt;
      remaining -= dt;
    }
    if (this.motion) {
      this.root.position.y=this.rootRestY;
      let forward=1, sideways=0;
      if (this.actor) {
        this.group.getWorldQuaternion(this.orientation);
        this.localVelocity.copy(this.actor.velocity).applyQuaternion(this.inverseOrientation.copy(this.orientation).invert());
        forward=-this.localVelocity.z;
        sideways=this.localVelocity.x;
      }
      this.airTime=this.actor?.isGrounded===false ? (this.airTime || 0)+delta : 0;
      const airborne=this.airTime>0.14 && Math.abs(this.actor?.verticalVelocity || 0)>2.5;
      this.motion.update(delta,speed,{ aiming, crouch:this.crouch, airborne,
        forward, sideways, reload:this.reloadProgress, pickup:this.pickupProgress, grenade:this.throwProgress,
        sprinting:this.actor?.isPlayer ? this.actor.isSprinting : null });
      // Rifle clips provide the lower-body gait. Empty hands need relaxed shoulders,
      // not the invisible-rifle pose baked into the source upper-body animation.
      if (!this.armed && this.pickupProgress<0 && this.throwProgress<0) this._relaxArms(speed);
      if (raise>0) {
        this._pose('leftUpperArm',raise*2.5);
        this._pose('rightUpperArm',raise*2.5);
        this._pose('leftForearm',0.5);
        this._pose('rightForearm',0.5);
      }
      this._groundAuthoredFeet();
      return;
    }
    const stride = this.actor?.isFlying ? 0 : Math.min(1, speed / 4);
    const swing = Math.sin(this.phase) * stride * 0.48;
    this._pose('leftThigh', swing);
    this._pose('rightThigh', -swing);
    this._pose('leftShin', -0.12 - Math.max(0, -Math.sin(this.phase)) * stride * 1.15);
    this._pose('rightShin', -0.12 - Math.max(0, Math.sin(this.phase)) * stride * 1.15);
    this._pose('leftUpperArm', raise * 2.5 + this.aimBlend * 0.9 - (1-this.aimBlend) * swing * 0.6);
    this._pose('rightUpperArm', raise * 2.5 + this.aimBlend * 0.9 + (1-this.aimBlend) * swing * 0.6);
    this._pose('leftForearm', 0.35 + this.aimBlend * 0.55);
    this._pose('rightForearm', 0.35 + this.aimBlend * 0.55);
    const crouch = Math.max(this.crouch, this.pickupBlend * 0.8);
    const humanoid = !this.id.startsWith('bahamut') && this.id !== 'galiant';
    this.root.position.y = this.rootRestY - crouch * this.height * 0.22
      - (humanoid && this.feet.length === 2 ? this.pelvisDrop + Math.abs(Math.sin(this.phase)) * stride * 0.025 : 0);
    this._pose('spine', Math.sin(this.phase * 0.5) * 0.015 - raise * 0.15 + crouch * 0.18);
    this.wingTime=(this.wingTime || 0)+delta;
    const flap=this.actor?.isFlying ? Math.sin(this.wingTime*5)*0.55 : Math.sin(this.wingTime)*0.045;
    this._pose('leftWing', 0, flap);
    this._pose('rightWing', 0, -flap);
    this._pose('tail', 0, Math.sin(this.phase * 0.45) * 0.08);
    if (this.actor && !this.id.startsWith('bahamut') && this.id !== 'galiant') {
      this._groundFeet(speed);
    }
  }

  setActor(actor) { this.actor = actor; }
  setArmed(armed) { this.armed = armed; }
  resetPose() {
    this.pickupTarget=null;this.pickupBlend=0;this.motionSpeed=0;
    this.crouch=this.recoil=this.recoilVelocity=this.aimBlend=this.airTime=0;
    this.reloadProgress=1;this.pickupProgress=this.throwProgress=-1;
    this.motion?.reset();this.setHitFlash(0);
    for(const foot of this.feet) foot.planted=false;
  }

  _relaxArms(speed) {
    const swing=Math.sin(this.phase)*Math.min(0.35,speed*0.07);
    this._pose('leftUpperArm',-swing,0.06);
    this._pose('rightUpperArm',swing,-0.06);
    this._pose('leftForearm',0.12);
    this._pose('rightForearm',0.12);
  }
  kickRecoil() { this.recoilVelocity += 0.65; this.motion?.fire(); }

  _groundAuthoredFeet() {
    const actor=this.actor, physics=actor?.physicsWorld;
    if (!physics?.world || !physics.RAPIER || actor.isGrounded===false) return;
    if (!this.footRay) this.footRay=new physics.RAPIER.Ray({x:0,y:0,z:0},{x:0,y:-1,z:0});
    this.group.updateWorldMatrix(true,true);
    for (const foot of this.feet) {
      foot.end.getWorldPosition(this.target);
      this.footRay.origin.x=this.target.x;
      this.footRay.origin.y=this.target.y+0.35;
      this.footRay.origin.z=this.target.z;
      const hit=physics.castRay(this.footRay,0.85,true,undefined,undefined,actor.collider);
      if (!hit) continue;
      const floor=this.footRay.origin.y-hit.timeOfImpact+foot.rest.y;
      // Recorded swing trajectories remain intact. Correct penetration/contact only.
      if (this.target.y > floor+0.045) continue;
      this.target.y=floor;
      this.bend.set(0,0,-1).transformDirection(this.group.matrixWorld);
      this.ik.solve(foot.upper,foot.lower,foot.end,this.target,this.bend);
    }
  }

  /** Fit stock/grips inside both arms' reach instead of using one human size for every rig. */
  fitWeapon(weapon, aiming = false, recoil = 0) {
    if (!this.loaded || !this.joints.leftUpperArm || !this.joints.rightUpperArm) return;
    this.group.updateWorldMatrix(true, true);
    this.joints.leftUpperArm.bone.getWorldPosition(this.shoulderLeft);
    this.joints.rightUpperArm.bone.getWorldPosition(this.shoulderRight);
    this.weaponCenter.addVectors(this.shoulderLeft, this.shoulderRight).multiplyScalar(0.5);
    weapon.parent.worldToLocal(this.weaponCenter);
    const factor = this.armLength / 0.5;
    weapon.scale.setScalar(Math.min(0.95, this.armLength / 0.85));
    weapon.position.copy(this.weaponCenter);
    weapon.position.x += 0.045 * factor;
    weapon.position.y -= (0.18 - this.aimBlend * 0.04) * factor;
    // Keep the receiver in front of the chest; the stock reaches back to the shoulder.
    weapon.position.z -= 0.20 * factor;
    weapon.position.z += recoil;
  }

  _groundFeet(speed) {
    const actor = this.actor, physics = actor.physicsWorld;
    if (!physics?.world || !physics.RAPIER) return;
    if (!this.footRay) this.footRay = new physics.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    const grounded = actor.isGrounded !== false;
    this.group.updateWorldMatrix(true, true);
    this.group.getWorldQuaternion(this.orientation);
    this.localVelocity.copy(actor.velocity).applyQuaternion(this.inverseOrientation.copy(this.orientation).invert());
    const moving = speed > 0.15;
    const stride = Math.min(0.65, speed * 0.15);
    for (const foot of this.feet) {
      const phase = ((this.phase / (Math.PI * 2) + foot.offset) % 1 + 1) % 1;
      const stance = !moving || phase < 0.6;
      const t = stance ? phase / 0.6 : (phase - 0.6) / 0.4;
      this.target.copy(foot.rest);
      this.target.y = Math.max(0.08, foot.rest.y);
      const along = moving ? (stance ? 0.5 - t : -0.5 + t*t*(3-2*t)) * stride : 0;
      if (moving) {
        this.target.x += this.localVelocity.x / speed * along;
        this.target.z += this.localVelocity.z / speed * along;
      }
      this.group.localToWorld(this.target);
      if (grounded) {
        this.footRay.origin.x = this.target.x;
        this.footRay.origin.y = this.target.y + 0.45;
        this.footRay.origin.z = this.target.z;
        const hit = physics.castRay(this.footRay, 1.1, true, undefined, undefined, actor.collider);
        if (hit) {
          // The ankle is above the sole. Using a universal 8 cm target was
          // dragging long-booted rigs below their soles and locking their knees.
          const floor = this.footRay.origin.y - hit.timeOfImpact + foot.rest.y;
          this.target.y = floor + (!stance && moving ? Math.sin(t*Math.PI)*0.22 : 0);
          if (stance && moving) {
            const support = hit.collider?.parent?.();
            if (!foot.planted || foot.support?.handle !== support?.handle) {
              foot.anchor.copy(this.target);
              foot.support = support;
              if (support) {
                foot.supportPoint.copy(foot.anchor).sub(support.translation());
                this.orientation.copy(support.rotation()).invert();
                foot.supportPoint.applyQuaternion(this.orientation);
              }
              foot.planted = true;
            }
            if (foot.support) {
              this.orientation.copy(foot.support.rotation());
              foot.anchor.copy(foot.supportPoint).applyQuaternion(this.orientation).add(foot.support.translation());
            }
            // Release rather than over-stretching a planted foot during sudden turns.
            if (foot.anchor.distanceToSquared(this.target) < 0.45) this.target.copy(foot.anchor);
            else foot.planted = false;
          } else foot.planted = false;
        } else foot.planted = false;
      } else {
        foot.planted = false;
        this.target.y += 0.12;
      }
      this.bend.set(0, 0, -1).transformDirection(this.group.matrixWorld);
      this.ik.solve(foot.upper, foot.lower, foot.end, this.target, this.bend);
      // Keep the boot level while the shin bends, rather than rotating it into the floor.
      this.group.getWorldQuaternion(this.orientation).multiply(foot.restRotation);
      foot.end.parent.getWorldQuaternion(this.inverseOrientation).invert();
      foot.end.quaternion.copy(this.inverseOrientation.multiply(this.orientation));
    }
  }

  /** Called after the held weapon's current frame pose, so hands cannot lag the gun. */
  poseWeapon(weapon, twoHanded = true, reloadProgress = 1) {
    if (!this.loaded || this.disposed) return;
    this.weapon = weapon;
    this.reloadProgress=reloadProgress;
    if (this.motion && this.pickupProgress>=0) return;
    weapon.updateWorldMatrix(true, true);
    for (const side of ['right', 'left']) {
      const upper = this.joints[side+'UpperArm']?.bone, lower = this.joints[side+'Forearm']?.bone,
        hand = this.joints[side+'Hand']?.bone;
      const socket = weapon.userData.grips?.[side];
      if (!upper || !lower || !hand || !socket || (side === 'left' && !twoHanded)) continue;
      if (this.motion && reloadProgress<1 && side==='left') continue;
      weapon.localToWorld(this.target.copy(socket));
      if (side === 'left' && reloadProgress < 1) {
        const magazine = weapon.userData.grips?.magazine;
        if (magazine) {
          weapon.localToWorld(this.target.copy(magazine));
          this.target.y -= Math.sin(reloadProgress*Math.PI) * 0.18;
        }
      }
      if (this.pickupTarget && side === 'right') this.target.lerp(this.pickupTarget, this.pickupBlend);
      // The recorded elbow can point through a differently proportioned torso.
      // Explicit outward poles keep both elbows outside the ribs.
      this.bend.set(side === 'right' ? 1 : -1, -0.65, 0.15).transformDirection(this.group.matrixWorld);
      this.ik.solve(upper, lower, hand, this.target, this.bend);
    }
  }

  setHitFlash(amount) {
    for (const material of this.materials) {
      if (!material.emissive) continue;
      material.emissive.copy(material.userData.baseEmissive);
      material.emissive.r += amount * 0.7;
    }
  }

  setVisible(visible) { if (this.group) this.group.visible = visible; }
  setCrouchAmount(amount) { this.crouch = THREE.MathUtils.clamp(amount, 0, 1); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.motion?.dispose();
    const skeletons = new Set();
    this.root?.traverse((node) => { if (node.skeleton) skeletons.add(node.skeleton); });
    for (const skeleton of skeletons) skeleton.dispose();
    for (const material of this.materials) material.dispose();
    this.weakSpot?.geometry.dispose();
    this.weakSpot?.material.dispose();
    for (const [node, visible] of this._hidden) node.visible = visible;
    this.group?.removeFromParent();
    this.lease?.release();
  }
}
