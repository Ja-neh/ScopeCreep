import * as THREE from 'three';
import config from '../../config.json';

/**
 * ShipBuoyancy
 * Computes multi-probe wave height sampling across the hull (Bow, Stern, Port, Starboard, Center)
 * and calculates dampened naval sway, heave bobbing, longitudinal pitch, and lateral roll.
 */
export class ShipBuoyancy {
  constructor(options = {}) {
    const buoyCfg = config.ship.buoyancy;
    this.draft = options.draft || buoyCfg.draft;
    this.heaveScale = options.heaveScale || buoyCfg.heaveScale; // vertical bobbing amplitude
    this.pitchScale = options.pitchScale || buoyCfg.pitchScale; // longitudinal pitch tilt
    this.rollScale = options.rollScale || buoyCfg.rollScale;   // lateral roll tilt

    this.currentPitch = 0;
    this.currentRoll = 0;

    // Probes for wave height sampling (Bow, Stern, Port, Starboard, Center)
    this.buoyancyProbes = [
      new THREE.Vector3(0, 0, -28),  // Bow (Front)
      new THREE.Vector3(0, 0, 28),   // Stern (Back)
      new THREE.Vector3(-6.5, 0, 0), // Port (Left)
      new THREE.Vector3(6.5, 0, 0),  // Starboard (Right)
      new THREE.Vector3(0, 0, 0)     // Center
    ];
    this._tempProbeWorld = new THREE.Vector3();
  }

  /**
   * Samples water wave heights at all probes and adjusts vessel mesh transform.
   * @param {THREE.Object3D} mesh
   * @param {WaterMesh|Ocean} water
   * @param {number} delta
   */
  update(mesh, water, delta) {
    if (!mesh || !water || !water.getWaveHeight) return;

    mesh.updateMatrixWorld();

    // Sample wave heights at 5 hull probe locations
    this._tempProbeWorld.copy(this.buoyancyProbes[0]).applyMatrix4(mesh.matrixWorld);
    const hBow = water.getWaveHeight(this._tempProbeWorld.x, this._tempProbeWorld.z);

    this._tempProbeWorld.copy(this.buoyancyProbes[1]).applyMatrix4(mesh.matrixWorld);
    const hStern = water.getWaveHeight(this._tempProbeWorld.x, this._tempProbeWorld.z);

    this._tempProbeWorld.copy(this.buoyancyProbes[2]).applyMatrix4(mesh.matrixWorld);
    const hPort = water.getWaveHeight(this._tempProbeWorld.x, this._tempProbeWorld.z);

    this._tempProbeWorld.copy(this.buoyancyProbes[3]).applyMatrix4(mesh.matrixWorld);
    const hStarboard = water.getWaveHeight(this._tempProbeWorld.x, this._tempProbeWorld.z);

    this._tempProbeWorld.copy(this.buoyancyProbes[4]).applyMatrix4(mesh.matrixWorld);
    const hCenter = water.getWaveHeight(this._tempProbeWorld.x, this._tempProbeWorld.z);

    // Target floating altitude: massive warship inertia dampens small surface wave motions
    const avgWaterHeight = (hBow + hStern + hPort + hStarboard + hCenter * 2.0) / 6.0;

    const targetY = (avgWaterHeight * this.heaveScale) - this.draft;
    const targetPitch = Math.atan2(hStern - hBow, 56.0) * this.pitchScale;
    const targetRoll = Math.atan2(hPort - hStarboard, 13.0) * this.rollScale;

    // Heavy warship inertial damping: slow, steady naval sway
    mesh.position.y += (targetY - mesh.position.y) * Math.min(1.0, 1.2 * delta);
    this.currentPitch += (targetPitch - this.currentPitch) * Math.min(1.0, 1.0 * delta);
    this.currentRoll += (targetRoll - this.currentRoll) * Math.min(1.0, 1.0 * delta);

    mesh.rotation.x = this.currentPitch;
    mesh.rotation.z = this.currentRoll;
  }
}
