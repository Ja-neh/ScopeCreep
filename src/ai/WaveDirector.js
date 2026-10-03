/**
 * WaveDirector
 * Runs a sequence of enemy waves: spawns each wave's units a few at a time across its lanes,
 * waits until they are all dead, pauses, then starts the next. Knows nothing about levels or
 * entity types: the level supplies a spawn callback and the current alive count.
 *
 * A wave is { trooper: 6, brute: 1, lanes: ['centre', 'west'] } (any unit type names work):
 * units are dealt round-robin across the lanes, heavier units (listed later) arriving last.
 */
export class WaveDirector {
  /**
   * @param {Object} options
   * @param {Array<Object>} options.waves - Wave definitions (e.g. config.levels.level02.waves)
   * @param {number} options.betweenWavesSeconds - Pause after a wave is cleared
   * @param {number} options.spawnIntervalSeconds - Time between individual spawns
   * @param {(type: string, lane: string) => Object|null} options.spawn - Creates one unit
   * @param {() => number} options.aliveCount - Units of the waves still alive
   * @param {string[]} [options.unitTypes] - Unit keys in arrival order
   */
  constructor({ waves, betweenWavesSeconds, spawnIntervalSeconds, spawn, aliveCount, unitTypes = ['trooper', 'brute'] }) {
    this.waves = waves;
    this.betweenWavesSeconds = betweenWavesSeconds;
    this.spawnIntervalSeconds = spawnIntervalSeconds;
    this.spawn = spawn;
    this.aliveCount = aliveCount;
    this.unitTypes = unitTypes;

    this.state = 'idle'; // idle -> spawning -> fighting -> between -> ... -> done
    this.waveIndex = -1;
    this.queue = [];
    this._timer = 0;
  }

  /** 1-based number of the current wave (0 before the first). */
  get waveNumber() {
    return this.waveIndex + 1;
  }

  get totalWaves() {
    return this.waves.length;
  }

  /** Enemies of the current wave still to come plus those alive. */
  get remaining() {
    return this.queue.length + this.aliveCount();
  }

  get isDone() {
    return this.state === 'done';
  }

  start() {
    if (this.state === 'idle') this._beginWave(0);
  }

  update(delta) {
    switch (this.state) {
      case 'spawning':
        this._timer -= delta;
        while (this._timer <= 0 && this.queue.length > 0) {
          const unit = this.queue.shift();
          this.spawn(unit.type, unit.lane);
          this._timer += this.spawnIntervalSeconds;
        }
        if (this.queue.length === 0) this.state = 'fighting';
        break;

      case 'fighting':
        if (this.aliveCount() === 0) {
          if (this.waveIndex >= this.waves.length - 1) {
            this.state = 'done';
          } else {
            this.state = 'between';
            this._timer = this.betweenWavesSeconds;
          }
        }
        break;

      case 'between':
        this._timer -= delta;
        if (this._timer <= 0) this._beginWave(this.waveIndex + 1);
        break;
    }
  }

  _beginWave(index) {
    this.waveIndex = index;
    this.queue = WaveDirector.expand(this.waves[index], this.unitTypes);
    this.state = 'spawning';
    this._timer = 0;
  }

  /**
   * Turns a wave definition into an ordered spawn list of { type, lane }.
   */
  static expand(wave, unitTypes) {
    const lanes = wave.lanes && wave.lanes.length > 0 ? wave.lanes : ['centre'];
    const list = [];
    let laneIndex = 0;
    for (const type of unitTypes) {
      for (let i = 0; i < (wave[type] || 0); i++) {
        list.push({ type, lane: lanes[laneIndex % lanes.length] });
        laneIndex++;
      }
    }
    return list;
  }
}
