import * as THREE from 'three';
import { IslandLevel, CREW_NAMES } from './IslandLevel.js';
import { Village } from './level03/Village.js';
import { BossArena } from './level03/BossArena.js';
import { ForceFieldDome } from './level03/ForceFieldDome.js';
import { ShieldGenerator } from './level03/ShieldGenerator.js';
import { SupplyCrate } from './level02/SupplyCrate.js';
import config from '../config.json';

const DOME_RADIUS = 22;  // The force field covers the hall and a little of the ground round it
const GUARD_DISTANCE = 6; // Generator guards start this far from their generator

/**
 * Level03
 * Level 3: The Village. The finale, at night: the squad comes up the jungle path to the village
 * on the plateau at the island's far end, fights through its streets to the square, brings down
 * the force field over the hall, defeats the Warden inside and frees the hostages.
 *
 * Built in phases. So far: the night village (a big old village of streets, creepy houses and
 * landed alien ships, the square, the hall) with the player and squad arriving at the gate and
 * shutting down the three generators (ShieldGenerator, by three of the landed ships, each with
 * two guards) that feed the force field over the hall (ForceFieldDome). When the dome falls, into
 * the hall, where the Warden wakes (BossArena). Bringing it down wins, for now (the hostages
 * come in a later phase). On-foot combat, downed and revive come from IslandLevel.
 *
 * Level03TestLevel extends this with a respawning alien group and the sandbox dev tools.
 */
export class Level03 extends IslandLevel {
  constructor(gameWorld, name = 'Level 3: The Village') {
    super(gameWorld, name);
    this.cfg = config.levels.level03;
    this.village = null;
    this.supplyCrate = null;
    this.hallCrate = null;
    this.dome = null;
    this.generators = [];
    this.arena = null;
    this.state = 'generators'; // generators -> hall -> boss -> victory (-> won)
    this._victoryTimer = 0;
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
    this.dome = this.trackDisposable(new ForceFieldDome(this.gameWorld, { centre: this.village.hall.centre, radius: DOME_RADIUS }));
    this.dome.build();
  }

  _clearings() {
    return this.village.clearings;
  }

  /** On the jungle path just below the village gate, facing in. */
  _playerSpawn() {
    return { position: this.village.spawnPoints.start, yaw: 0 };
  }

  /** Supply crates the helicopters dropped: one by the gate, one just inside the hall door. */
  _createProps() {
    this.supplyCrate = new SupplyCrate(this.gameWorld, {
      position: this.village.spawnPoints.supplyCrate,
      player: this.player,
      weapons: this.weapons
    });
    this.gameWorld.addEntity(this.supplyCrate);
    this.hallCrate = new SupplyCrate(this.gameWorld, {
      position: this.village.hall.supplyPoint,
      player: this.player,
      weapons: this.weapons
    });
    this.gameWorld.addEntity(this.hallCrate);

    // The generators that feed the force field, their beams running up to the top of the dome
    this.generators = this.village.generatorSpots.map(({ name, position }) => {
      const generator = new ShieldGenerator(this.gameWorld, {
        name,
        position,
        player: this.player,
        beamTarget: this.dome.top,
        onShutDown: (g) => this._onGeneratorShutDown(g)
      });
      this.gameWorld.addEntity(generator);
      return generator;
    });
  }

  /** Two troopers guard each generator, patrolling round it. */
  spawnGuards() {
    for (const generator of this.generators) {
      for (let i = 0; i < this.cfg.generatorGuards; i++) {
        const angle = (i / this.cfg.generatorGuards) * Math.PI * 2 + 0.6;
        const x = generator.position.x + Math.cos(angle) * GUARD_DISTANCE;
        const z = generator.position.z + Math.sin(angle) * GUARD_DISTANCE;
        this.createAlien('trooper', x, z);
      }
    }
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
    return 'Low health! Patch up at a supply crate [E]: by the village gate, or just inside the hall door.';
  }

  /** Not inside a house, a wall, under a ship's leg or in the force field either. */
  _isWalkable(x, z) {
    if (this.dome && this.dome.blocks(x, z, 1)) return false;
    return super._isWalkable(x, z) && (!this.village || this.village.isOpenGround(x, z, 0.8));
  }

  /** The force field shimmers (and collapses) every frame. */
  _updateWorld(delta) {
    if (this.dome) this.dome.update(delta);
  }

  // ---------------------------------------------------------------------------
  // Scenario
  // ---------------------------------------------------------------------------

  async _startScenario() {
    this.spawnCrew();
    this.spawnGuards();
    this._showGeneratorObjective();
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

  _updateScenario(delta) {
    const hall = this.village.hall;
    const p = this.player.position;
    switch (this.state) {
      case 'generators':
        this._showGeneratorObjective();
        break;
      case 'hall': {
        const distance = Math.hypot(p.x - hall.doorway.x, p.z - hall.doorway.z);
        this._showObjective('THE HALL', `The force field is down. Get inside the hall — ${Math.round(distance)} m`);
        if (hall.contains(p.x, p.z)) this.startBossFight();
        break;
      }
      case 'boss':
        this.arena.update(delta);
        if (this.state === 'boss') this._showBossObjective();
        break;
      case 'victory':
        this._victoryTimer -= delta;
        if (this._victoryTimer <= 0) this._finish(true);
        break;
    }
  }

  /** How many generators are down, and how far the nearest one still running is. */
  _showGeneratorObjective() {
    const running = this.generators.filter((g) => !g.isShutDown);
    const down = this.generators.length - running.length;
    const p = this.player.position;
    let nearest = Infinity;
    for (const g of running) nearest = Math.min(nearest, Math.hypot(p.x - g.position.x, p.z - g.position.z));
    this._showObjective('OBJECTIVE',
      `A force field covers the hall. Shut down its generators (follow the beams) — ${down}/${this.generators.length}, nearest ${Math.round(nearest)} m`);
  }

  _onGeneratorShutDown(generator) {
    const left = this.generators.filter((g) => !g.isShutDown).length;
    const ui = this.gameWorld.ui;
    if (left > 0) {
      if (ui) ui.showToast(`${generator.name} is down. ${left} to go.`, 'success', 3000);
      return;
    }
    this.dome.collapse();
    if (this.state === 'generators') this.state = 'hall';
    if (ui) ui.showToast('The force field is collapsing! Get into the hall!', 'success', 4000);
  }

  /** Shuts every generator down at once; `instant` also drops the dome without its collapse (dev tools, tests). */
  shutDownGenerators({ instant = false } = {}) {
    for (const generator of this.generators) generator.shutDown();
    if (instant) this.dome.collapse({ instant: true });
  }

  /** The Warden wakes: the fight in the hall begins. */
  startBossFight() {
    this.state = 'boss';
    this.arena = this.trackDisposable(new BossArena(this, this.village.hall, { onDefeated: () => this._onWardenDefeated() }));
    this.arena.start();
    this._showBossObjective();
  }

  _showBossObjective() {
    const warden = this.arena.warden;
    if (warden.shielded) {
      const left = this.arena.crystalsLeft;
      this._showObjective('THE WARDEN', `Shoot the shield crystals on the pillars — ${left} left`);
    } else {
      this._showObjective('THE WARDEN', 'The shield is down: bring the Warden down');
    }
  }

  /** The Warden has fallen: a moment to take it in, then the mission is won. */
  _onWardenDefeated() {
    this.state = 'victory';
    this._victoryTimer = this.cfg.victoryDelaySeconds;
    this._showObjective('THE WARDEN IS DOWN', 'The village is ours');
  }

  dispose() {
    this.supplyCrate = null; // Entities: the GameWorld disposes them
    this.hallCrate = null;
    this.generators = [];
    super.dispose();         // Also the village, the dome and the arena (tracked)
    this.village = null;
    this.dome = null;
    this.arena = null;
  }
}
