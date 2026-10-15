import config from '../config.json';

export class AirStrikeMission {
  constructor(gameWorld, playerJet, targets) {
    this.gameWorld = gameWorld;
    this.playerJet = playerJet;
    this.targets = targets;
    this.winScore = config.airStrike.winScore;
    this.elapsed = 0;
    this.score = 0;
    this._scoredTargets = new Set();
    this.state = 'ready';
  }

  start() {
    if (this.state !== 'ready') return;
    this.state = 'active';
    this.gameWorld.ui?.showObjective(
      'REACH THE STRIKE SCORE TARGET',
      `SCORE: 0 / ${this.winScore}  |  Targets remaining: ${this.targets.length}`
    );
    this.gameWorld.ui?.showToast(`Destroy targets to score points. Reach ${this.winScore} to complete the strike!`, 'warning', 4500);
  }

  update(delta) {
    if (this.state !== 'active') return;
    this.elapsed += delta;

    if (this.playerJet?.isDestroyed) {
      this._finish(false, 'Your jet was shot down before the strike was complete.');
      return;
    }

    for (const target of this.targets) {
      if (!target.isDestroyed || this._scoredTargets.has(target)) continue;
      this._scoredTargets.add(target);
      this.score += target.scoreValue;
      this.gameWorld.ui?.showToast(`${target.name} destroyed! +${target.scoreValue} points`, 'success', 1800);
    }

    const remaining = this.targets.filter((target) => !target.isDestroyed).length;
    if (this.score >= this.winScore) {
      this._finish(true, `Strike score target reached: ${this.score} points.`);
      return;
    }
    this.gameWorld.ui?.showObjective(
      'REACH THE STRIKE SCORE TARGET',
      `SCORE: ${this.score} / ${this.winScore}  |  Targets remaining: ${remaining}`
    );
  }

  _finish(victory, message) {
    this.state = victory ? 'won' : 'lost';
    this.gameWorld.input.exitPointerLock();
    const ui = this.gameWorld.ui;
    if (!ui) return;
    ui.hideObjective();
    this.gameWorld.isPaused = true;
    ui.showMissionResult({
      outcome: victory ? 'victory' : 'defeat',
      title: victory ? 'STRIKE COMPLETE' : 'STRIKE FAILED',
      message,
      stats: [
        { label: 'Time', value: `${Math.floor(this.elapsed / 60)}:${Math.floor(this.elapsed % 60).toString().padStart(2, '0')}` },
        { label: 'Score', value: String(this.score) },
        { label: 'Score required', value: String(this.winScore) },
        { label: 'Targets destroyed', value: String(this._scoredTargets.size) },
        { label: 'Targets remaining', value: String(this.targets.filter((target) => !target.isDestroyed).length) }
      ],
      actions: [
        { label: 'Retry', onClick: () => this.gameWorld.restartCurrentLevel() },
        { label: 'Main menu', onClick: () => this.gameWorld.returnToMainMenu() }
      ]
    });
  }

  dispose() {
    this.playerJet = null;
    this.targets = [];
    this._scoredTargets.clear();
  }
}
