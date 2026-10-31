import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Village } from '../src/levels/level03/Village.js';
import { AMBUSH_ROUTES, CAPTURE_POSITIONS, SQUARE_CAMERAS } from '../src/core/CampaignBlocking.js';

test('campaign cutscene can build the actual Level 3 village without gameplay colliders', () => {
  const parent = new THREE.Group();
  const physics = { createStaticBox: () => null, createStaticCylinder: () => null, removeRigidBody() {} };
  const environment = {
    village: { x: 0, z: -400, halfWidth: 200, halfLength: 245 },
    heightAt: () => 0,
    pathCentreX: () => 0,
    isInVillage: (x, z) => Math.abs(x) < 200 && z > -645 && z < -155
  };
  const village = new Village({ physics, environmentGroup: parent }, environment);
  village.build();
  assert.equal(parent.children.includes(village.group), true);
  assert.ok(village.houses.length > 0);
  assert.equal(village.ships.length, 5);
  for (const route of AMBUSH_ROUTES) {
    for (let i=0;i<=100;i++) {
      const u=i/100, x=THREE.MathUtils.lerp(route.from[0],route.to[0],u), z=THREE.MathUtils.lerp(route.from[1],route.to[1],u);
      assert.ok(village.isOpenGround(x,z,.65),`Ambush path crosses an obstacle at ${x}, ${z}`);
    }
  }
  for (const [x,z] of CAPTURE_POSITIONS) assert.ok(village.isOpenGround(x,z,.65),`Cage blocked at ${x},${z}`);
  for (const shot of Object.values(SQUARE_CAMERAS)) {
    for (let i=0;i<=100;i++) {
      const u=i/100;
      const x=THREE.MathUtils.lerp(shot.from[0],shot.to[0],u),z=THREE.MathUtils.lerp(shot.from[2],shot.to[2],u);
      assert.ok(village.isOpenGround(x,z,.65),`Camera dolly crosses an obstacle at ${x},${z}`);
    }
  }
  village.dispose();
});
