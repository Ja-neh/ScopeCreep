import { GameWorld } from './core/GameWorld.js';
import { preloadCampaignAssets } from './core/CampaignPreloader.js';
import { CampaignCinematic3D } from './core/CampaignCinematic3D.js';
import { Level01InsideSpaceship } from './levels/Level01InsideSpaceship.js';
import { Level02 } from './levels/Level02.js';
import { Level03 } from './levels/Level03.js';
import { CREDITS } from './levels/level03/credits.js';

/**
 * Level Registry defining all available stages in ScopeCreep
 */
const AVAILABLE_LEVELS = [
  {
    id: 'level01_inside_spaceship',
    title: 'Level 1: Inside Spaceship',
    create: (gw) => new Level01InsideSpaceship(gw)
  },
  {
    id: 'level02',
    title: 'Level 2: The Beach',
    create: (gw) => new Level02(gw)
  },
  {
    id: 'level03',
    title: 'Level 3: The Village',
    create: (gw) => new Level03(gw)
  }
];

async function bootstrap() {
  // 1. Initialize root GameWorld instance
  const canvas = document.querySelector('#game-canvas');
  const gameWorld = new GameWorld(canvas);
  gameWorld.ui.storyIntro.showLoading('Starting the game engine');
  await gameWorld.init(); // Initialize Rapier Physics WASM
  // The bar tracks actual asset downloads, including the ship, terrain, models and motion.
  for (;;) {
    try {
      await preloadCampaignAssets((fraction,label)=>gameWorld.ui.storyIntro.setLoadingProgress(fraction*.85,label));
      await gameWorld.audio.preloadSamples((fraction,label)=>gameWorld.ui.storyIntro.setLoadingProgress(.85+fraction*.06,label));
      break;
    } catch (error) {
      console.error('Campaign assets failed to load:',error);
      await gameWorld.ui.storyIntro.showLoadError(error.message);
      gameWorld.ui.storyIntro.showLoading('Retrying campaign assets');
    }
  }
  gameWorld.ui.storyIntro.setLoadingProgress(.92, 'Preparing 3D characters and scenes');
  gameWorld.campaignCinematic = new CampaignCinematic3D(gameWorld);
  await gameWorld.campaignCinematic.ready;
  gameWorld.ui.storyIntro.attachCinematic(gameWorld.campaignCinematic);
  gameWorld.ui.storyIntro.setLoadingProgress(1, 'Ready');

  // Dev server only (never in the production build): inspect the game from the browser console
  if (import.meta.env.DEV) {
    window.gameWorld = gameWorld;
  }

  // 2. Start the main game loop
  gameWorld.start();

  // 3. Navigation helper to present the tactical level selection menu
  const showMenu = () => {
    gameWorld.ui.resetLevelHUD();
    gameWorld.music.setEffectsOnly(false);
    gameWorld.music.setState('menu'); // The menu raises the loud trailer groove
    gameWorld.music.stinger('impact'); // ...with an impact each time it appears
    gameWorld.ui.showMainMenu(AVAILABLE_LEVELS, async (selectedLevel) => {
      gameWorld.ui.hideMainMenu();
      gameWorld.ui.showToast(`Deploying: ${selectedLevel.title}`, 'info', 3000);
      const levelInstance = selectedLevel.create(gameWorld);
      await gameWorld.loadLevel(levelInstance);
    }, () => gameWorld.ui.showCredits(CREDITS, 50, '', () => gameWorld.ui.hideCredits()));
  };

  // Wire return-to-main-menu hook
  gameWorld.setMainMenuHandler(() => {
    showMenu();
  });
  gameWorld.setLevelOpeningHandler((level, options) => {
    gameWorld.music.setEffectsOnly(true);
    return gameWorld.ui.storyIntro.showLevel(level.constructor.name, options);
  });

  // 4. Open with the story, then let the player choose any of the three levels.
  gameWorld.music.setEffectsOnly(true);
  await gameWorld.ui.storyIntro.show(() => {
    gameWorld.audio.unlock();
    gameWorld.music.setState('suspense');
    gameWorld.music.stinger('ambush');
  });
  showMenu();

  console.log('GameWorld initialized. Tactical Main Menu ready.');
}

bootstrap().catch(console.error);
