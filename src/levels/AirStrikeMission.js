export class AirStrikeMission {
  constructor(gameWorld, playerJet, targets) {
    this.gameWorld = gameWorld;
    this.playerJet = playerJet;
    this.targets = targets;
    this.elapsed = 0;
    this.state = 'ready';
  }

  start() {
    if (this.state !== 'ready') return;
    this.state = 'active';
    this.gameWorld.ui?.showObjective(
      'DESTROY ENEMY COASTAL TARGETS',
      `Targets remaining: ${this.targets.length} — dive to line up your guns.`
    );
    this.gameWorld.ui?.showToast('Enemy radar, gun batteries, and supply ships ahead. Make your attack run!', 'warning', 4500);
  }

  update(delta) {
    if (this.state !== 'active') return;
    this.elapsed += delta;

    if (this.playerJet?.isDestroyed) {
      this._finish(false, 'Your jet was shot down before the strike was complete.');
      return;
    }

    const remaining = this.targets.filter((target) => !target.isDestroyed).length;
    if (remaining === 0) {
      this._finish(true, 'All enemy coastal targets have been destroyed.');
      return;
    }
    this.gameWorld.ui?.showObjective(
      'DESTROY ENEMY COASTAL TARGETS',
      `Targets remaining: ${remaining}  |  Destroyed: ${this.targets.length - remaining}/${this.targets.length}`
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
        { label: 'Targets destroyed', value: String(this.targets.length - this.targets.filter((target) => !target.isDestroyed).length) },
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
  }
}
