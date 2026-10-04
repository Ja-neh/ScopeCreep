import * as THREE from 'three';
import { IslandLevel, CREW_NAMES } from './IslandLevel.js';
import { Village } from './level03/Village.js';
import { SupplyCrate } from './level02/SupplyCrate.js';
import config from '../config.json';

/**
 * Level03
 * Level 3: The Village. The finale, at night: the squad comes up the jungle path to the village
 * on the plateau at the island's far end, fights through its streets to the square, brings down
 * the force field over the hall, defeats the Warden inside and frees the hostages.
 *
 * Built in phases. So far: the night village (a big old village of streets, creepy houses and
 * landed alien ships, the square, the hall) with the player and squad arriving at the gate and
 * making for the square. On-foot combat, downed and revive come from IslandLevel.
 *
 * Level03TestLevel extends this with a respawning alien group and the sandbox dev tools.
 */
export class Level03 extends IslandLevel {
  constructor(gameWorld, name = 'Level 3: The Village') {
    super(gameWorld, name);
    this.cfg = config.levels.level03;
    this.village = null;
    this.supplyCrate = null;
    this.state = 'approach'; // approach -> square
  }

  // ---------------------------------------------------------------------------
  // IslandLevel hooks
  // ---------------------------------------------------------------------------

  /** Night, on the island with the big village; the moon's shadows follow the camera round it. */
  _environmentOptions() {
    return { look: 'night', layout: 'village', shadowCentre: new THREE.Vector3(0, 12, -400), shadowHalfExtent: 120, shadowFollowsCamera: true };
  }

  /** Trees around the village cast shadows; the rest of the island does not. */
  _coverOptions() {
    return { castsShadow: (x, z) => z < -110 };
  }

  async _buildWorld() {
    this.village = this.trackDisposable(new Village(this.gameWorld, this.environment));
    this.village.build();
  }

  _clearings() {
    return this.village.clearings;
  }

  /** On the jungle path just below the village gate, facing in. */
  _playerSpawn() {
    return { position: this.village.spawnPoints.start, yaw: 0 };
  }

  /** A supply crate the helicopters dropped by the gate. */
  _createProps() {
    this.supplyCrate = new SupplyCrate(this.gameWorld, {
      position: this.village.spawnPoints.supplyCrate,
      player: this.player,
      weapons: this.weapons
    });
    this.gameWorld.addEntity(this.supplyCrate);
  }

  _resultText(victory) {
    if (victory) {
      return { title: 'THE ISLAND IS OURS AGAIN', message: 'The Warden is gone and our people are free.' };
    }
    return {
      title: 'MISSION FAILED',
      message: this.allies && this.allies.aliveMates === 0
        ? 'Your whole squad went down in the village.'
        : 'You bled out before help could reach you.'
    };
  }

  _lowHealthHint() {
    return 'Low health! Patch up at the supply crate by the village gate [E].';
  }

  /** Not inside a house, a wall or under a ship's leg either. */
  _isWalkable(x, z) {
    return super._isWalkable(x, z) && (!this.village || this.village.isOpenGround(x, z, 0.8));
  }

  // ---------------------------------------------------------------------------
  // Scenario
  // ---------------------------------------------------------------------------

  async _startScenario() {
    this.spawnCrew();
    this._showObjective('OBJECTIVE', 'Get into the village and reach the square');
  }

  /** The crew, just behind the player on the path, following at once. */
  spawnCrew() {
    for (let i = 0; i < this.aiCrewCount; i++) {
      const position = this.village.spawnPoints.squad[i % this.village.spawnPoints.squad.length];
      const mate = this.spawnSquadMate(CREW_NAMES[i % CREW_NAMES.length], position);
      mate.yaw = 0;
    }
    this.allies.followLeader();
  }

  _updateScenario() {
    if (this.state === 'approach') {
      const square = this.village.square;
      const distance = Math.hypot(this.player.position.x - square.x, this.player.position.z - square.z);
      this._showObjective('OBJECTIVE', `Get into the village and reach the square — ${Math.round(distance)} m`);
      if (distance <= this.cfg.squareReachRadius) {
        this.state = 'square';
        this._showObjective('THE SQUARE', 'The hall is ahead. Find a way in.');
        if (this.gameWorld.ui) this.gameWorld.ui.showToast('The square is quiet. Too quiet.', 'info', 3000);
      }
    }
  }

  dispose() {
    this.supplyCrate = null; // Entity: the GameWorld disposes it
    super.dispose();         // Also the village (tracked)
    this.village = null;
  }
}
