import * as THREE from 'three';
import { TwoBoneIK } from '../entities/models/TwoBoneIK.js';
import { consolidateMeshes } from '../rendering/MeshMerge.js';

/** Lightweight gloved view arms: separate from the hidden third-person body. */
export class FirstPersonHands {
  constructor(parent, materials) {
    this.mesh = new THREE.Group();
    this.mesh.name = 'FirstPersonHands';
    parent.add(this.mesh);
    this.ik = new TwoBoneIK();
    this.target = new THREE.Vector3();
    this.pole = new THREE.Vector3();
    this.arms = [];
    const part = (parent, geometry, material, x, y, z) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z); parent.add(mesh); return mesh;
    };
    for (const side of [-1, 1]) {
      const upper = new THREE.Bone(), lower = new THREE.Bone(), hand = new THREE.Bone();
      upper.position.set(side*0.25, -0.16, 0.1);
      lower.position.y = -0.32; hand.position.y = -0.29;
      this.mesh.add(upper); upper.add(lower); lower.add(hand);
      part(upper, new THREE.CapsuleGeometry(0.053, 0.22, 3, 8), materials.polymer, 0, -0.16, 0);
      part(lower, new THREE.CapsuleGeometry(0.044, 0.2, 3, 8), materials.polymer, 0, -0.145, 0);
      const glove = new THREE.Group();
      hand.add(glove);
      part(glove, new THREE.BoxGeometry(0.075, 0.045, 0.09), materials.polymer, side*0.028, -0.015, -0.015);
      // Bent glove fingers wrap around the grip; the index lies beside the trigger.
      for (let i=0; i<4; i++) {
        const finger = new THREE.Group();
        finger.position.set(side*0.025, -0.025, -0.05+i*0.022);
        glove.add(finger);
        const first = part(finger, new THREE.CapsuleGeometry(0.009, 0.025, 2, 5), materials.polymer, -side*0.022, -0.008, 0);
        first.rotation.z = side*0.9;
        part(finger, new THREE.CapsuleGeometry(0.009, 0.018, 2, 5), materials.polymer, -side*0.038, -0.026, 0);
      }
      const thumb = part(glove, new THREE.CapsuleGeometry(0.012, 0.035, 2, 5), materials.polymer, -side*0.023, 0.01, 0.008);
      thumb.rotation.z = -side*0.7;
      glove.updateWorldMatrix(true, true);
      for (const finger of [...glove.children]) {
        if (finger.isMesh) continue;
        for (const mesh of [...finger.children]) glove.attach(mesh);
        finger.removeFromParent();
      }
      consolidateMeshes(glove, materials.polymer, materials.charge);
      this.arms.push({ upper, lower, hand, side });
    }
  }

  update(rifle, reloadProgress = 1) {
    for (const arm of this.arms) {
      arm.upper.quaternion.identity(); arm.lower.quaternion.identity();
      const grip = rifle.userData.grips[arm.side > 0 ? 'right' : 'left'];
      this.target.copy(grip);
      if (arm.side < 0 && reloadProgress < 1) {
        this.target.copy(rifle.userData.grips.magazine);
        this.target.y -= Math.sin(reloadProgress*Math.PI)*0.18;
      }
      rifle.localToWorld(this.target);
      this.pole.set(arm.side, -1, 0.4).transformDirection(this.mesh.matrixWorld);
      this.ik.solve(arm.upper, arm.lower, arm.hand, this.target, this.pole);
      rifle.getWorldQuaternion(this.ik.world);
      arm.hand.parent.getWorldQuaternion(this.ik.parent).invert();
      arm.hand.quaternion.copy(this.ik.parent.multiply(this.ik.world));
    }
  }
}
