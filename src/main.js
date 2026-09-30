import { GameWorld } from './core/GameWorld.js';
import { Level01 } from './levels/Level01.js';
import { TestLevel } from './levels/TestLevel.js';

/**
 * Level Registry defining all available stages in ScopeCreep
 */
const AVAILABLE_LEVELS = [
  {
    id: 'level01',
    title: 'Level 1: Operation Retake',
    create: (gw) => new Level01(gw)
  },
  {
    id: 'testlevel',
    title: 'Sandbox: Flat Ground',
    create: (gw) => new TestLevel(gw)
  }
];

async function bootstrap() {
  // 1. Initialize root GameWorld instance
  const canvas = document.querySelector('#game-canvas');
  const gameWorld = new GameWorld(canvas);
  await gameWorld.init(); // Initialize Rapier Physics WASM

  // 2. Start the main game loop
  gameWorld.start();

  // 3. Navigation helper to present the tactical level selection menu
  const showMenu = () => {
    gameWorld.ui.resetLevelHUD();
    gameWorld.ui.showMainMenu(AVAILABLE_LEVELS, async (selectedLevel) => {
      gameWorld.ui.hideMainMenu();
      gameWorld.ui.showToast(`Deploying: ${selectedLevel.title}`, 'info', 3000);
      const levelInstance = selectedLevel.create(gameWorld);
      await gameWorld.loadLevel(levelInstance);
    });
  };

  // Wire return-to-main-menu hook
  gameWorld.setMainMenuHandler(() => {
    showMenu();
  });

  // 4. Present main menu on initial launch
  showMenu();

  console.log('GameWorld initialized. Tactical Main Menu ready.');
}

bootstrap().catch(console.error);

