import * as THREE from 'three';

/** Analytic limb solver with an explicit bend direction and unreachable-target clamping. */
export class TwoBoneIK {
  constructor() {
    this.a = new THREE.Vector3(); this.b = new THREE.Vector3(); this.c = new THREE.Vector3();
    this.axis = new THREE.Vector3(); this.pole = new THREE.Vector3(); this.elbow = new THREE.Vector3();
    this.from = new THREE.Vector3(); this.to = new THREE.Vector3();
    this.rotation = new THREE.Quaternion(); this.world = new THREE.Quaternion();
    this.parent = new THREE.Quaternion();
  }

  aim(bone, child, target) {
    bone.getWorldPosition(this.a);
    child.getWorldPosition(this.b);
    this.from.subVectors(this.b, this.a).normalize();
    this.to.subVectors(target, this.a).normalize();
    if (this.from.lengthSq() < 0.5 || this.to.lengthSq() < 0.5) return;
    this.rotation.setFromUnitVectors(this.from, this.to);
    bone.getWorldQuaternion(this.world).premultiply(this.rotation);
    bone.parent.getWorldQuaternion(this.parent).invert();
    bone.quaternion.copy(this.parent.multiply(this.world));
    bone.updateWorldMatrix(false, true);
  }

  solve(upper, lower, end, target, bend) {
    upper.updateWorldMatrix(true, true);
    upper.getWorldPosition(this.a); lower.getWorldPosition(this.b); end.getWorldPosition(this.c);
    const l1 = this.a.distanceTo(this.b), l2 = this.b.distanceTo(this.c);
    if (l1 < 1e-5 || l2 < 1e-5) return;
    this.axis.subVectors(target, this.a);
    // Reserve flexion even at the edge of reach; a fully straight limb has an
    // unstable bend plane and snaps between mirrored knee/elbow solutions.
    const distance = THREE.MathUtils.clamp(this.axis.length(), Math.abs(l1 - l2) + 1e-4, (l1 + l2) * 0.985);
    if (this.axis.lengthSq() < 1e-8) this.axis.set(0, -1, 0);
    this.axis.normalize();
    this.pole.copy(bend).addScaledVector(this.axis, -bend.dot(this.axis));
    if (this.pole.lengthSq() < 1e-6) this.pole.set(1, 0, 0).addScaledVector(this.axis, -this.axis.x);
    if (this.pole.lengthSq() < 1e-6) this.pole.set(0, 0, 1);
    this.pole.normalize();
    const along = (l1*l1 + distance*distance - l2*l2) / (2*distance);
    this.elbow.copy(this.a).addScaledVector(this.axis, along)
      .addScaledVector(this.pole, Math.sqrt(Math.max(0, l1*l1 - along*along)));
    // aim() reuses a/b, so preserve the clamped endpoint separately.
    this.c.copy(this.a).addScaledVector(this.axis, distance);
    this.aim(upper, lower, this.elbow);
    this.aim(lower, end, this.c);
  }
}
