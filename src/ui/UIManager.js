import { InteractionPrompt } from './components/InteractionPrompt.js';
import { StationHUD } from './components/StationHUD.js';
import { Crosshair } from './components/Crosshair.js';
import { HealthBar } from './components/HealthBar.js';
import { ToastNotification } from './components/ToastNotification.js';
import { StatusIndicator } from './components/StatusIndicator.js';
import { WeaponHUD } from './components/WeaponHUD.js';
import { PlayerHealthBar } from './components/PlayerHealthBar.js';
import { BossHealthBar } from './components/BossHealthBar.js';
import { DamageFlash } from './components/DamageFlash.js';
import { ObjectivePanel } from './components/ObjectivePanel.js';
import { MissionResult } from './components/MissionResult.js';
import { CinematicOverlay } from './components/CinematicOverlay.js';
import { FPSDisplay } from './components/FPSDisplay.js';
import { ControlsHelper } from './components/ControlsHelper.js';
import { DevToolsWidget } from './components/DevToolsWidget.js';
import { MainMenu } from './components/MainMenu.js';
import { PauseMenu } from './components/PauseMenu.js';
import { PauseButton } from './components/PauseButton.js';

/**
 * UIManager.js
 * Central orchestrator for all HTML/DOM UI overlays in the game.
 * Owned by GameWorld and accessible by entities via `gameWorld.ui`.
 */
export class UIManager {
  /**
   * @param {HTMLElement} [container] - The root container for HUD overlays (defaults to #ui-overlay or document.body)
   */
  constructor(container) {
    this.container = container || document.getElementById('ui-overlay') || document.body;

    // Component instances
    this.prompt = new InteractionPrompt(this.container);
    this.stationHUD = new StationHUD(this.container);
    this.crosshair = new Crosshair(this.container);
    this.healthBar = new HealthBar(this.container);
    this.toast = new ToastNotification(this.container);
    this.statusIndicator = new StatusIndicator(this.container);
    this.weaponHUD = new WeaponHUD(this.container);
    this.playerHealth = new PlayerHealthBar(this.container);
    this.bossHealth = new BossHealthBar(this.container);
    this.damageFlash = new DamageFlash(this.container);
    this.objectivePanel = new ObjectivePanel(this.container);
    this.missionResult = new MissionResult(this.container);
    this.cinematic = new CinematicOverlay(this.container);
    this.fpsDisplay = new FPSDisplay(this.container);
    this.controlsHelper = new ControlsHelper(this.container);
    this.controlsHelper.hide(); // Hidden until level loads
    this.devTools = new DevToolsWidget(this.container);
    this.devTools.hide(); // Hidden by default until a level requests dev tools

    // Menus & Pause components
    this.mainMenu = new MainMenu(this.container);
    this.pauseMenu = new PauseMenu(this.container);
    this.pauseButton = new PauseButton(this.container);
  }

  // =========================================================================
  // Interaction Prompts
  // =========================================================================

  /**
   * Show interaction prompt (e.g. [E] TAKE SHIP HELM)
   * @param {string} key
   * @param {string} label
   * @param {string} [accentColor]
   * @param {any} [sourceId]
   */
  showPrompt(key, label, accentColor, sourceId = null) {
    if (this.prompt) {
      this.prompt.show(key, label, accentColor, sourceId);
    }
  }

  /**
   * Hide interaction prompt
   * @param {any} [sourceId]
   */
  hidePrompt(sourceId = null) {
    if (this.prompt) {
      this.prompt.hide(sourceId);
    }
  }

  // =========================================================================
  // Station HUD & Crosshair
  // =========================================================================

  /**
   * Show full-screen station HUD
   * @param {'helm'|'artillery'|'flak'} type
   * @param {Object} [config]
   */
  showStationHUD(type, config = {}) {
    if (this.stationHUD) {
      this.stationHUD.show(type, config);
    }
  }

  /**
   * Update active station HUD with fresh telemetry or firing state
   * @param {'helm'|'artillery'|'flak'} type
   * @param {Object} data
   */
  updateStationHUD(type, data) {
    if (this.stationHUD) {
      this.stationHUD.update(type, data);
    }
  }

  /**
   * Hide active station HUD
   */
  hideStationHUD() {
    if (this.stationHUD) {
      this.stationHUD.hide();
    }
  }

  /**
   * Show center-screen crosshair reticle
   * @param {'artillery'|'flak'|string} type
   */
  showCrosshair(type) {
    if (this.crosshair) {
      this.crosshair.show(type);
    }
  }

  /**
   * Hide crosshair reticle
   */
  hideCrosshair() {
    if (this.crosshair) {
      this.crosshair.hide();
    }
  }

  /**
   * Rifle crosshair: spread the ticks to the weapon's current accuracy cone
   * @param {number} spreadRadians
   * @param {number} fovDegrees
   */
  setCrosshairSpread(spreadRadians, fovDegrees) {
    if (this.crosshair) {
      this.crosshair.setSpread(spreadRadians, fovDegrees);
    }
  }

  /**
   * Flash the crosshair to confirm a hit (or a kill)
   * @param {boolean} [kill=false]
   */
  flashCrosshairHit(kill = false) {
    if (this.crosshair) {
      this.crosshair.flashHit(kill);
    }
  }

  // =========================================================================
  // Player Health & Damage Feedback
  // =========================================================================

  /**
   * Show the player's health bar
   */
  showPlayerHealth() {
    if (this.playerHealth) {
      this.playerHealth.show();
    }
  }

  /**
   * @param {number} current
   * @param {number} max
   */
  updatePlayerHealth(current, max) {
    if (this.playerHealth) {
      this.playerHealth.update(current, max);
    }
  }

  /**
   * Hide the player's health bar
   */
  hidePlayerHealth() {
    if (this.playerHealth) {
      this.playerHealth.hide();
    }
  }

  /**
   * Show a boss's health bar (top centre, under the objective)
   * @param {string} name
   */
  showBossHealth(name) {
    if (this.bossHealth) {
      this.bossHealth.show(name);
    }
  }

  /**
   * @param {number} current
   * @param {number} max
   * @param {boolean} [shielded=false] - The boss cannot be hurt right now
   */
  updateBossHealth(current, max, shielded = false) {
    if (this.bossHealth) {
      this.bossHealth.update(current, max, shielded);
    }
  }

  /**
   * Hide the boss health bar
   */
  hideBossHealth() {
    if (this.bossHealth) {
      this.bossHealth.hide();
    }
  }

  /**
   * Red flash around the screen edges (the player was hurt)
   */
  flashDamage() {
    if (this.damageFlash) {
      this.damageFlash.flash();
    }
  }

  // =========================================================================
  // Mission Objective & Result
  // =========================================================================

  /**
   * Show or update the current objective (top centre)
   * @param {string} title
   * @param {string} [detail]
   */
  showObjective(title, detail = '') {
    if (this.objectivePanel) {
      this.objectivePanel.show(title, detail);
    }
  }

  /**
   * Hide the objective panel
   */
  hideObjective() {
    if (this.objectivePanel) {
      this.objectivePanel.hide();
    }
  }

  /**
   * Show the end-of-mission screen
   * @param {{outcome: 'victory'|'defeat', title: string, message?: string,
   *          stats?: Array<{label: string, value: string}>, actions?: Array<{label: string, onClick: Function}>}} result
   */
  showMissionResult(result) {
    if (this.missionResult) {
      this.missionResult.show(result);
    }
  }

  /**
   * Hide the end-of-mission screen
   */
  hideMissionResult() {
    if (this.missionResult) {
      this.missionResult.hide();
    }
  }

  // =========================================================================
  // Cinematic (camera sequences)
  // =========================================================================

  /**
   * Letterbox bars and a title card; hides the gameplay HUD until hideCinematic()
   * @param {string} title
   * @param {string} [subtitle]
   * @param {string} [hint] - e.g. '[Space] Skip'
   */
  showCinematic(title, subtitle = '', hint = '') {
    if (this.cinematic) {
      this.cinematic.show(title, subtitle, hint);
      this.container.classList.add('ui-cinematic-active');
    }
  }

  /**
   * Remove the letterbox and bring the HUD back
   */
  hideCinematic() {
    if (this.cinematic) {
      this.cinematic.hide();
      this.container.classList.remove('ui-cinematic-active');
    }
  }

  // =========================================================================
  // Infantry Weapon HUD
  // =========================================================================

  /**
   * Show the weapon and ammo panel
   */
  showWeaponHUD() {
    if (this.weaponHUD) {
      this.weaponHUD.show();
    }
  }

  /**
   * @param {{name: string, ammo: number|null, reserve: number, reloadProgress: number|null}} state
   */
  updateWeaponHUD(state) {
    if (this.weaponHUD) {
      this.weaponHUD.update(state);
    }
  }

  /**
   * Hide the weapon and ammo panel
   */
  hideWeaponHUD() {
    if (this.weaponHUD) {
      this.weaponHUD.hide();
    }
  }

  // =========================================================================
  // Warship Health Bar
  // =========================================================================

  /**
   * Update warship hull health bar
   * @param {number} current
   * @param {number} max
   * @param {boolean} [isDestroyed=false]
   */
  updateHealthBar(current, max, isDestroyed = false) {
    if (this.healthBar) {
      this.healthBar.show();
      this.healthBar.update(current, max, isDestroyed);
    }
  }

  /**
   * Hide warship hull health bar
   */
  hideHealthBar() {
    if (this.healthBar) {
      this.healthBar.hide();
    }
  }

  /**
   * Show warship hull health bar
   */
  showHealthBar() {
    if (this.healthBar) {
      this.healthBar.show();
    }
  }

  // =========================================================================
  // Toast Notifications
  // =========================================================================

  /**
   * Display transient toast message
   * @param {string} message
   * @param {'success'|'info'|'warning'|'danger'} [variant='info']
   * @param {number} [durationMs=2200]
   */
  showToast(message, variant = 'info', durationMs = 2200) {
    if (this.toast) {
      this.toast.show(message, variant, durationMs);
    }
  }

  // =========================================================================
  // Status Indicator
  // =========================================================================

  /**
   * Show a persistent status badge (e.g. "HIDDEN") until hideStatusIndicator is called
   * @param {string} text
   * @param {'success'|'info'|'warning'|'danger'} [variant='info']
   */
  showStatusIndicator(text, variant = 'info') {
    if (this.statusIndicator) {
      this.statusIndicator.show(text, variant);
    }
  }

  /**
   * Hide the status badge
   */
  hideStatusIndicator() {
    if (this.statusIndicator) {
      this.statusIndicator.hide();
    }
  }

  // =========================================================================
  // Performance & FPS Display
  // =========================================================================

  /**
   * Update framerate and frame-time diagnostics display
   * @param {number} fps
   * @param {number} frameTime
   */
  updateFPS(fps, frameTime, renderScale = 1) {
    if (this.fpsDisplay) {
      this.fpsDisplay.update(fps, frameTime, renderScale);
    }
  }

  // =========================================================================
  // Controls Helper
  // =========================================================================

  /**
   * Show controls helper card
   */
  showControlsHelper(lines = null) {
    if (this.controlsHelper) {
      this.controlsHelper.setLines(lines);
      this.controlsHelper.show();
    }
  }

  /**
   * Hide controls helper card
   */
  hideControlsHelper() {
    if (this.controlsHelper) {
      this.controlsHelper.hide();
    }
  }

  // =========================================================================
  // Dev Tools Widget
  // =========================================================================

  /**
   * Show developer camera and collider inspection tools
   * @param {Object} callbacks
   */
  showDevTools(callbacks = {}) {
    if (this.devTools) {
      this.devTools.show(callbacks);
    }
  }

  /**
   * Update dev tools camera button state
   * @param {'PLAYER'|'AERIAL'} mode
   */
  updateDevToolsCamera(mode) {
    if (this.devTools) {
      this.devTools.updateCameraButton(mode);
    }
  }

  /**
   * Update dev tools collider button state
   * @param {boolean} visible
   */
  updateDevToolsColliders(visible) {
    if (this.devTools) {
      this.devTools.updateCollidersButton(visible);
    }
  }

  /**
   * Hide developer tools
   */
  hideDevTools() {
    if (this.devTools) {
      this.devTools.hide();
    }
  }

  // =========================================================================
  // Menus & Pause System
  // =========================================================================

  /**
   * Show Main Menu level selector
   * @param {Array<Object>} levels
   * @param {Function} onSelectLevel
   */
  showMainMenu(levels, onSelectLevel) {
    if (this.mainMenu) {
      this.mainMenu.show(levels, onSelectLevel);
    }
  }

  /**
   * Hide Main Menu
   */
  hideMainMenu() {
    if (this.mainMenu) {
      this.mainMenu.hide();
    }
  }

  /**
   * Show Pause & Options Menu
   * @param {Object} callbacks
   */
  showPauseMenu(callbacks) {
    if (this.pauseMenu) {
      this.pauseMenu.show(callbacks);
    }
  }

  /**
   * Hide Pause Menu
   */
  hidePauseMenu() {
    if (this.pauseMenu) {
      this.pauseMenu.hide();
    }
  }

  /**
   * Show in-game Pause Button
   * @param {Function} onClick
   */
  showPauseButton(onClick) {
    if (this.pauseButton) {
      this.pauseButton.show(onClick);
    }
  }

  /**
   * Hide in-game Pause Button
   */
  hidePauseButton() {
    if (this.pauseButton) {
      this.pauseButton.hide();
    }
  }

  /**
   * Resets all in-level HUD overlays when returning to main menu or switching stages
   */
  resetLevelHUD() {
    this.hidePrompt();
    this.hideStationHUD();
    this.hideCrosshair();
    this.hideHealthBar();
    this.hideStatusIndicator();
    this.hideWeaponHUD();
    this.hidePlayerHealth();
    this.hideBossHealth();
    this.hideObjective();
    this.hideMissionResult();
    this.hideCinematic();
    if (this.damageFlash) this.damageFlash.clear();
    this.hidePauseMenu();
    this.hidePauseButton();
    this.hideDevTools();
    if (this.controlsHelper) {
      this.controlsHelper.hide();
    }
  }

  // =========================================================================
  // Per-Frame Update & Lifecycle
  // =========================================================================

  /**
   * Per-frame update hook for animated or time-decayed UI elements
   * @param {number} delta - Frame delta in seconds
   */
  update(delta) {
    // Will update toast decay, FPS tracker, etc.
    if (this.toast && typeof this.toast.update === 'function') {
      this.toast.update(delta);
    }
  }

  /**
   * Tear down and remove all UI elements
   */
  dispose() {
    if (this.prompt) {
      this.prompt.dispose();
      this.prompt = null;
    }
    if (this.stationHUD && typeof this.stationHUD.dispose === 'function') {
      this.stationHUD.dispose();
      this.stationHUD = null;
    }
    if (this.crosshair && typeof this.crosshair.dispose === 'function') {
      this.crosshair.dispose();
      this.crosshair = null;
    }
    if (this.healthBar && typeof this.healthBar.dispose === 'function') {
      this.healthBar.dispose();
      this.healthBar = null;
    }
    if (this.toast && typeof this.toast.dispose === 'function') {
      this.toast.dispose();
      this.toast = null;
    }
    if (this.statusIndicator) {
      this.statusIndicator.dispose();
      this.statusIndicator = null;
    }
    if (this.weaponHUD) {
      this.weaponHUD.dispose();
      this.weaponHUD = null;
    }
    if (this.playerHealth) {
      this.playerHealth.dispose();
      this.playerHealth = null;
    }
    if (this.bossHealth) {
      this.bossHealth.dispose();
      this.bossHealth = null;
    }
    if (this.damageFlash) {
      this.damageFlash.dispose();
      this.damageFlash = null;
    }
    if (this.objectivePanel) {
      this.objectivePanel.dispose();
      this.objectivePanel = null;
    }
    if (this.cinematic) {
      this.cinematic.dispose();
      this.cinematic = null;
    }
    if (this.missionResult) {
      this.missionResult.dispose();
      this.missionResult = null;
    }
    if (this.fpsDisplay && typeof this.fpsDisplay.dispose === 'function') {
      this.fpsDisplay.dispose();
      this.fpsDisplay = null;
    }
    if (this.controlsHelper && typeof this.controlsHelper.dispose === 'function') {
      this.controlsHelper.dispose();
      this.controlsHelper = null;
    }
    if (this.devTools && typeof this.devTools.dispose === 'function') {
      this.devTools.dispose();
      this.devTools = null;
    }
    if (this.mainMenu && typeof this.mainMenu.dispose === 'function') {
      this.mainMenu.dispose();
      this.mainMenu = null;
    }
    if (this.pauseMenu && typeof this.pauseMenu.dispose === 'function') {
      this.pauseMenu.dispose();
      this.pauseMenu = null;
    }
    if (this.pauseButton && typeof this.pauseButton.dispose === 'function') {
      this.pauseButton.dispose();
      this.pauseButton = null;
    }
  }
}
