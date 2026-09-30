import { GameWorld } from './core/GameWorld.js';
import { Level01 } from './levels/Level01.js';
import { TestLevel } from './levels/TestLevel.js';

async function bootstrap() {
  // 1. Initialize root GameWorld instance
  const canvas = document.querySelector('#game-canvas');
  const gameWorld = new GameWorld(canvas);
  await gameWorld.init(); // Initialize Rapier Physics

  // 2. Load initial level
  await gameWorld.loadLevel(new Level01(gameWorld));

  // 3. Start the main game loop
  gameWorld.start();



  console.log('GameWorld initialized. Level active.');
}

bootstrap().catch(console.error);
