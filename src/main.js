import { GameWorld } from './core/GameWorld.js';
import { LevelManager } from './core/LevelManager.js';
import { Level01 as Level1 } from './levels/Level01.js';
import { TestLevel } from './levels/TestLevel.js';

async function bootstrap() {
  // 1. Initialize root GameWorld instance
  const canvas = document.querySelector('#game-canvas');
  const gameWorld = new GameWorld(canvas);
  await gameWorld.init(); // Initialize Rapier Physics

  // 2. Initialize LevelManager
  const levelManager = new LevelManager(gameWorld);
  gameWorld.setLevelManager(levelManager);

  // 3. Load Level 1: Operation Retake (At Sea)
  await levelManager.loadLevel(new TestLevel(gameWorld));

  // 4. Start the main game loop
  gameWorld.start();

  // 5. Mount on-screen controls helper
  const overlay = document.querySelector('#ui-overlay');
  if (overlay) {
    const controlsHelp = document.createElement('div');
    controlsHelp.id = 'controls-helper';
    controlsHelp.innerHTML = `
      <div style="
        position: absolute;
        bottom: 20px;
        left: 20px;
        background: rgba(13, 17, 23, 0.88);
        color: #e6edf3;
        padding: 14px 20px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        font-family: monospace;
        font-size: 13px;
        line-height: 1.6;
        pointer-events: none;
        box-shadow: 0 4px 14px rgba(0,0,0,0.5);
      ">
        • <strong>Left Click:</strong> Lock Mouse<br/>
        • <strong>Escape:</strong> Unlock Mouse<br/>
        • <strong>W, A, S, D:</strong> Walk on Deck<br/>
        • <strong>Shift:</strong> Sprint &nbsp;|&nbsp; <strong>Space:</strong> Jump<br/>
        • <strong>[E]:</strong> Mount / Dismount Gun Turret (when in ring)<br/>
        • <strong>[V] / [C]:</strong> Toggle 1st / 3rd Person View<br/>
        • <strong>[B] / [F2]:</strong> Toggle Battleship Colliders<br/>
      </div>
    `;
    overlay.appendChild(controlsHelp);
  }

  console.log('GameWorld & LevelManager initialized. Level 1 (At Sea) active.');
}

bootstrap().catch(console.error);
