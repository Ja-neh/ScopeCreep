import * as THREE from 'three';
import { CameraMode } from '../../entities/components/SpringArmCamera.js';
import { DamageInfo, DamageType } from '../../entities/components/HealthComponent.js';
import config from '../../config.json';

// Visual parameters only; smoke is cosmetic and does not change AI visibility.
const SMOKE_SECONDS = 5;
const SMOKE_PUFFS = 8;

/** Level-owned weapon attachment; WeaponController delegates Phase 5/6 and disposal. */
export class BeachThrowables {
  constructor(world, player, weapons, level) {
    this.world = world; this.player = player; this.weapons = weapons; this.level = level;
    this.cfg = config.levels.level02.grenade;
    this.ammo = this.cfg.count;
    this.selected = false; this.throwTime = -1; this.released = false;
    this.direction = new THREE.Vector3(); this.next = new THREE.Vector3();
    this.normal = new THREE.Vector3(); this.target = new THREE.Vector3();
    this.damage = new DamageInfo(0, DamageType.EXPLOSIVE, player);
    this.group = new THREE.Group();
    this.group.name = 'Level02_Throwables';
    world.effectsGroup.add(this.group);
    this.previewPosition = new THREE.Vector3();
    this.previewVelocity = new THREE.Vector3();
    this.previewNormal = new THREE.Vector3(0, 1, 0);
    this.markerAxis = new THREE.Vector3(0, 0, 1);
    this.previewTimer = 0.1;
    this.markerTime = 0;
    this.marker = new THREE.Group();
    this.marker.name = 'GrenadeLandingMarker'; this.marker.visible = false;
    this.markerMaterial = new THREE.MeshBasicMaterial({
      color: 0x49ff88, transparent: true, opacity: 0.85, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false
    });
    this.marker.add(new THREE.Mesh(new THREE.RingGeometry(0.48, 0.64, 40), this.markerMaterial));
    this.marker.add(new THREE.Mesh(new THREE.CircleGeometry(0.12, 20), this.markerMaterial));
    this.group.add(this.marker);
    this.grenadeGeometry = new THREE.SphereGeometry(0.09, 10, 8);
    this.grenadeMaterial = new THREE.MeshStandardMaterial({ color: 0x4d5436, roughness: 0.85 });
    this.metal = new THREE.MeshStandardMaterial({ color: 0x585d57, metalness: 0.6, roughness: 0.45 });
    this.sleeve = new THREE.MeshStandardMaterial({ color: 0x424c37, roughness: 1 });
    this.glove = new THREE.MeshStandardMaterial({ color: 0x292a24, roughness: 1 });
    this.rig = new THREE.Group();
    this.rig.name = 'GrenadeThrowArm';
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.32, 8), this.sleeve);
    upper.position.y = -0.16;
    this.rig.add(upper);
    this.elbow = new THREE.Group(); this.elbow.position.y = -0.32; this.rig.add(this.elbow);
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.29, 8), this.sleeve);
    forearm.position.y = -0.145; this.elbow.add(forearm);
    this.hand = new THREE.Group(); this.hand.position.y = -0.3; this.elbow.add(this.hand);
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.13, 0.13), this.glove);
    this.hand.add(fist);
    this.held = this._model(); this.held.position.set(0, -0.025, -0.08); this.hand.add(this.held);
    this.supportHand = new THREE.Group();
    const supportGlove = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.13, 0.13), this.glove);
    this.supportHand.add(supportGlove);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.25, 8), this.sleeve);
    cuff.position.set(-0.12, 0.08, 0); cuff.rotation.z = -0.9;
    this.supportHand.add(cuff); this.rig.add(this.supportHand);
    this.rig.visible = false; this.group.add(this.rig);
    this.projectiles = Array.from({ length: this.cfg.capacity }, () => {
      const mesh = this._model(false); mesh.visible = false; this.group.add(mesh);
      return { mesh, velocity: new THREE.Vector3(), life: 0 };
    });
    this.smokeGeometry = new THREE.SphereGeometry(1, 10, 8);
    this.smokeCursor = 0;
    this.smoke = Array.from({ length: this.cfg.capacity * SMOKE_PUFFS }, () => {
      const material = new THREE.MeshStandardMaterial({
        color: 0x77736a, roughness: 1, transparent: true, opacity: 0,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(this.smokeGeometry, material);
      mesh.name = 'GrenadeSmoke'; mesh.visible = false; this.group.add(mesh);
      return { mesh, velocity: new THREE.Vector3(), life: 0, duration: SMOKE_SECONDS, size: 1 };
    });
    this.blastGeometry = new THREE.IcosahedronGeometry(1, 1);
    this.blasts = Array.from({ length: this.cfg.capacity }, () => {
      const material = new THREE.MeshBasicMaterial({ color: 0xe7b36d, transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(this.blastGeometry, material);
      mesh.visible = false; this.group.add(mesh);
      return { mesh, life: 0 };
    });
  }
  _model(withPin = true) {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(this.grenadeGeometry, this.grenadeMaterial));
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.16, 0.035), this.metal);
    lever.position.set(0.07, 0.05, 0); lever.rotation.z = 0.25; group.add(lever);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.004, 4, 10), this.metal);
    ring.position.set(-0.04, 0.1, 0);
    if (withPin) { group.add(ring); group.pin = ring; }
    else ring.geometry.dispose();
    return group;
  }
  get blocksWeapons() { return this.selected || this.throwTime >= 0; }
  get canAct() {
    return this.world.input.isPointerLocked && !this.player.isDevSuspended &&
      !this.player.isMounted && !this.player.health.isDead &&
      !['won', 'lost'].includes(this.level.state);
  }
  gameplayUpdate(delta) {
    const input = this.world.input;
    // Projectiles already released keep their fuse, even when the player is downed.
    this._projectiles(delta);
    if (!this.canAct) {
      if (this.throwTime >= 0) this._cancel();
      return;
    }
    if (this.throwTime < 0) {
      if (input.isActionJustPressed('weaponPrimary') || input.isActionJustPressed('weaponMelee') ||
          input.isActionJustPressed('weaponNext') || input.isActionJustPressed('weaponPrev')) {
        this.selected = false;
        this.weapons._refreshHud(true);
      } else if (input.isActionJustPressed('weaponThrowable')) {
        if (this.ammo > 0) {
          this.selected = true; this.released = false; this.weapons.rifle.cancelReload();
          this.world.ui?.showToast(`Grenade selected (${this.ammo}) — click to throw; green: outside blast, red: too close`, 'info', 2500);
        } else this.world.ui?.showToast('No grenades left', 'warning', 1800);
      }
      if (this.selected && this.ammo > 0 && input.isActionJustPressed('firePrimary') &&
          this.weapons.quickMeleeTimer <= 0 && this.weapons.switchTimer <= 0) {
        this.throwTime = 0; this.released = false;
      }
    }
    if (this.throwTime >= 0) {
      const before = this.throwTime;
      this.throwTime += delta;
      if (!this.released && before < this.cfg.releaseSeconds && this.throwTime >= this.cfg.releaseSeconds) {
        this._pose(this.cfg.releaseSeconds);
        this._release();
      }
      if (this.throwTime >= this.cfg.throwSeconds) this._cancel();
    }
  }
  _cancel() {
    this.throwTime = -1; this.selected = false; this.rig.visible = false;
    this.marker.visible = false; this.previewTimer = 0.1;
    this.weapons._showModels(); this.weapons._refreshHud(true);
  }
  _release() {
    const projectile = this.projectiles.find(item => item.life <= 0);
    if (!projectile || this.ammo <= 0) return;
    this.released = true; this.ammo--;
    this.held.getWorldPosition(projectile.mesh.position);
    this._launchVelocity(projectile.velocity);
    projectile.life = this.cfg.fuseSeconds;
    projectile.mesh.visible = true;
    this.held.visible = false;
    this.world.ui?.showToast(`Grenade out — ${this.ammo} remaining`, 'info', 1500);
  }
  _pose(time) {
    const first = this.player.cameraMode === CameraMode.FIRST_PERSON;
    const crouch = 1 - 0.35 * this.player.crouchAmount;
    if (first) {
      this.rig.position.set(0.24, -0.24, -0.48).applyQuaternion(this.world.camera.quaternion).add(this.world.camera.position);
      this.rig.quaternion.copy(this.world.camera.quaternion);
    } else {
      this.player.mesh.updateWorldMatrix(true, false);
      this.rig.position.set(0.35, 1.4 * crouch, -0.05);
      this.player.mesh.localToWorld(this.rig.position);
      this.player.mesh.getWorldQuaternion(this.rig.quaternion);
    }
    // Ready -> pin preparation -> wind-up -> release -> relaxed follow-through.
    const keys = [[0, 0.55, 1.7], [0.15, 0.35, 2.1], [0.34, -2.1, 1.3],
      [0.48, 1.65, 0.12], [0.7, 1.95, 0.2], [0.95, 0.1, 0.5]];
    const t = time / this.cfg.throwSeconds * 0.95;
    let a = keys[0], b = keys[1];
    for (let i = 1; i < keys.length; i++) {
      b = keys[i]; a = keys[i - 1]; if (t <= b[0]) break;
    }
    const blend = THREE.MathUtils.smoothstep(t, a[0], b[0]);
    this.rig.rotateX(THREE.MathUtils.lerp(a[1], b[1], blend));
    this.elbow.rotation.x = THREE.MathUtils.lerp(a[2], b[2], blend);
    this.held.visible = !this.released;
    this.held.pin.visible = this.throwTime < 0 || t < 0.15;
    this.supportHand.visible = this.throwTime >= 0 && t < 0.28;
    this.supportHand.position.set(-0.06 - Math.max(0, t - 0.15) * 2, -0.31, -0.32);
    this.supportHand.rotation.x = -0.7;
    this.rig.updateWorldMatrix(true, true);
  }
  lateUpdate(delta = 0) {
    const active = this.blocksWeapons && this.canAct;
    this._updateMarker(delta, active && !this.released && this.ammo > 0);
    this.rig.visible = active && (this.player.cameraMode === CameraMode.FIRST_PERSON || this.player.bodyMesh.visible);
    if (active) {
      this.weapons.heldRifle.mesh.visible = false; this.weapons.heldKnife.mesh.visible = false;
      this.weapons.viewRifle.mesh.visible = false; this.weapons.viewKnife.mesh.visible = false;
      this._pose(Math.max(0, this.throwTime));
      this.world.ui?.updateWeaponHUD({ name: this.throwTime >= 0 ? 'THROWING GRENADE' : 'FRAG GRENADE', ammo: this.ammo, reserve: null, reloadProgress: null });
    } else this.weapons._showModels();
  }
  _launchVelocity(out) {
    this.world.camera.getWorldDirection(out);
    out.multiplyScalar(this.cfg.speed);
    out.y += this.cfg.upwardSpeed;
    out.add(this.player.velocity);
  }
  // Shared with the actual projectile so the preview includes velocity, gravity and bounces.
  _stepFlight(position, velocity, step) {
    velocity.y -= this.cfg.gravity * step;
    this.next.copy(position).addScaledVector(velocity, step);
    const hit = this.world.physics.traceSegment(position, this.next, this.player.collider);
    if (hit) {
      this.direction.subVectors(this.next, position).normalize();
      position.addScaledVector(this.direction, Math.max(0, hit.timeOfImpact - this.cfg.projectileRadius));
      this.normal.copy(hit.normal);
      const incoming = velocity.dot(this.normal);
      if (incoming < 0) velocity.addScaledVector(this.normal, -(1 + this.cfg.restitution) * incoming);
      velocity.multiplyScalar(this.cfg.friction);
    } else position.copy(this.next);
  }
  _updateMarker(delta, visible) {
    if (!visible) {
      this.marker.visible = false; this.previewTimer = 0.1;
      return;
    }
    this.markerTime += delta;
    this.previewTimer += delta;
    // At most ten predictions per second; no meshes or physics bodies are spawned.
    if (this.previewTimer >= 0.1) {
      this.previewTimer = 0;
      this._pose(this.cfg.releaseSeconds);
      this.held.getWorldPosition(this.previewPosition);
      this._launchVelocity(this.previewVelocity);
      let remaining = this.cfg.fuseSeconds;
      while (remaining > 1e-8) {
        const step = Math.min(remaining, this.cfg.maxStep);
        this._stepFlight(this.previewPosition, this.previewVelocity, step);
        remaining -= step;
      }
      // Project onto the surface beneath the predicted fuse endpoint, including uneven terrain.
      this.target.copy(this.previewPosition); this.target.y -= 40;
      const ground = this.world.physics.traceSegment(this.previewPosition, this.target, this.player.collider);
      this.marker.visible = !!ground;
      if (ground) {
        this.marker.position.copy(this.previewPosition);
        this.marker.position.y -= ground.timeOfImpact;
        this.previewNormal.copy(ground.normal).normalize();
        this.marker.position.addScaledVector(this.previewNormal, 0.035);
        this.marker.quaternion.setFromUnitVectors(this.markerAxis, this.previewNormal);
        this.target.copy(this.player.position); this.target.y += 0.9;
        const danger = this.previewPosition.distanceTo(this.target) < this.cfg.radius;
        this.markerMaterial.color.setHex(danger ? 0xff453b : 0x49ff88);
      }
      this._pose(Math.max(0, this.throwTime));
    }
    this.marker.scale.setScalar(1 + Math.sin(this.markerTime * 5) * 0.08);
  }
  _projectiles(delta) {
    for (const projectile of this.projectiles) {
      if (projectile.life <= 0) continue;
      let remaining = Math.min(delta, projectile.life);
      while (remaining > 1e-8) {
        const step = Math.min(remaining, this.cfg.maxStep);
        this._stepFlight(projectile.mesh.position, projectile.velocity, step);
        projectile.mesh.rotation.x += step * 6;
        projectile.mesh.rotation.z += step * 3;
        remaining -= step;
      }
      projectile.life -= delta;
      if (projectile.life <= 0) {
        projectile.mesh.visible = false;
        this._explode(projectile.mesh.position);
      }
    }
    for (const puff of this.smoke) {
      if (puff.life <= 0) continue;
      puff.life = Math.max(0, puff.life - delta);
      const t = 1 - puff.life / puff.duration;
      puff.mesh.position.addScaledVector(puff.velocity, delta);
      puff.mesh.rotation.y += delta * 0.12;
      puff.mesh.scale.set(puff.size * (1 + t * 3), puff.size * (0.8 + t * 3.5), puff.size * (1 + t * 3));
      puff.mesh.material.opacity = Math.min(1, t * 12) * (1 - t) ** 1.5 * 0.34;
      puff.mesh.visible = puff.life > 0;
    }
    for (const blast of this.blasts) {
      if (blast.life <= 0) continue;
      blast.life = Math.max(0, blast.life - delta);
      const t = 1 - blast.life / 0.6;
      blast.mesh.scale.setScalar(0.3 + t * 3.5);
      blast.mesh.material.color.setHex(t < 0.2 ? 0xffd18a : 0x70695e);
      blast.mesh.material.opacity = (1 - t) * 0.65;
      blast.mesh.visible = blast.life > 0;
    }
  }
  _explode(position) {
    const blast = this.blasts.find(item => item.life <= 0) || this.blasts[0];
    blast.mesh.position.copy(position); blast.life = 0.6; blast.mesh.visible = true;
    for (let i = 0; i < SMOKE_PUFFS; i++) {
      const puff = this.smoke[this.smokeCursor++ % this.smoke.length];
      const angle = i * Math.PI * 2 / SMOKE_PUFFS;
      const spread = 0.4 + Math.random() * 0.8;
      puff.duration = SMOKE_SECONDS * (0.8 + Math.random() * 0.2);
      puff.life = puff.duration; puff.size = 0.65 + Math.random() * 0.55;
      puff.mesh.position.copy(position);
      puff.mesh.position.x += Math.cos(angle) * spread;
      puff.mesh.position.z += Math.sin(angle) * spread;
      puff.mesh.position.y += 0.5;
      puff.velocity.set(Math.cos(angle) * 0.45 + 0.25, 0.5 + Math.random() * 0.35, Math.sin(angle) * 0.45);
      puff.mesh.rotation.set(Math.random(), angle, Math.random());
      puff.mesh.scale.setScalar(puff.size); puff.mesh.material.opacity = 0;
      puff.mesh.visible = true;
    }
    this.world.audio?.play('explosion');
    this.level.squad?.reportNoise(position);
    // Frag affects enemies and the thrower; squad friendly fire follows rifle convention.
    for (const entity of [this.player, ...(this.level.squad?.members || [])]) {
      if (!entity.health || entity.health.isDead) continue;
      this.target.copy(entity.position); this.target.y += 0.9;
      const distance = position.distanceTo(this.target);
      if (distance >= this.cfg.radius || !this.world.physics.isLineClear(position, this.target, 0)) continue;
      this.damage.amount = this.cfg.damage * (1 - distance / this.cfg.radius);
      entity.health.takeDamage(this.damage);
    }
  }
  dispose() {
    const geometries = new Set(), materials = new Set();
    this.group.traverse(child => {
      if (child.geometry) geometries.add(child.geometry);
      if (child.material) materials.add(child.material);
    });
    geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose());
    this.group.removeFromParent(); this.group.clear();
    this.world.ui?.clearBlood?.();
  }
}
