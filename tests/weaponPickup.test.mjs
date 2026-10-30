import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WeaponPickup } from '../src/entities/WeaponPickup.js';

function fixture() {
  let pressed = true, equips = 0;
  const ui = { showPrompt() {}, hidePrompt() {}, showToast() {} };
  const player = { position: new THREE.Vector3(), model: { character: {} } };
  const weapons = { switchTimer: 0, pickUpRifle() { equips++; } };
  const gw = { ui, input: { isActionJustPressed: () => pressed } };
  const pickup = new WeaponPickup(gw, player, weapons, new THREE.Vector3(0.5, 0.65, 0));
  return { pickup, player, equips: () => equips, release: () => { pressed = false; } };
}

test('a rifle is equipped only after the reach finishes and cannot be collected twice', () => {
  const f = fixture();
  f.pickup.gameplayUpdate(0.1); f.release();
  assert.equal(f.equips(), 0);
  assert.ok(f.player.model.character.pickupTarget);
  for (let elapsed=0; elapsed<f.pickup.cfg.reachSeconds+0.2; elapsed+=0.1) f.pickup.gameplayUpdate(0.1);
  assert.equal(f.equips(), 1);
  assert.equal(f.pickup.mesh.visible, false);
  assert.equal(f.player.model.character.pickupTarget, null);
  f.pickup.dispose();
});

test('leaving reach cancels collection and releases the arm target', () => {
  const f = fixture();
  f.pickup.gameplayUpdate(0.1); f.release();
  f.player.position.x = 20;
  f.pickup.gameplayUpdate(1);
  assert.equal(f.equips(), 0);
  assert.equal(f.pickup.active, false);
  assert.equal(f.player.model.character.pickupTarget, null);
  assert.equal(f.pickup.mesh.visible, true);
  f.pickup.dispose();
});
