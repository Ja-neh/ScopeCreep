/**
 * InputManager
 * Standalone input abstraction layer mapping raw keyboard and mouse events
 * to semantic game actions (movement, flight axes, turret aiming, firing).
 */
export class InputManager {
  constructor(domElement = window) {
    this.domElement = domElement;

    // Raw key & mouse state tracking
    this.keysDown = new Set();
    this.keysJustPressed = new Set();
    this.keysJustReleased = new Set();

    this.mouseButtonsDown = new Set();
    this.mouseButtonsJustPressed = new Set();
    this.mouseButtonsJustReleased = new Set();

    // Mouse positions and deltas
    this.mousePosition = { x: 0, y: 0 };
    this.mouseNormalized = { x: 0, y: 0 }; // [-1, 1] range
    this.mouseDelta = { x: 0, y: 0 };
    this.isPointerLocked = false;

    // Action mappings (Action Name -> Array of Keys / Mouse Buttons)
    this.actionBindings = {
      // Locomotion (Player & Ship)
      forward: ['KeyW', 'ArrowUp'],
      backward: ['KeyS', 'ArrowDown'],
      steerLeft: ['KeyA', 'ArrowLeft'],
      steerRight: ['KeyD', 'ArrowRight'],

      // Character Locomotion
      jump: ['Space'],
      sprint: ['ShiftLeft', 'ShiftRight'],

      // Weapons & Station Interaction
      firePrimary: ['Mouse0', 'KeyF'],      // Left mouse or F
      specialAction: ['KeyE'],               // E: Mount / Dismount station

      // Views & Dev Tools
      toggleCamera: ['KeyV', 'KeyC', 'Tab'], // 1st / 3rd person toggle
      toggleColliders: ['KeyB', 'F2'],       // Debug collider toggle
      pause: ['Escape', 'KeyP']
    };

    // Bind event callbacks
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);

    this._attachListeners();
  }

  _attachListeners() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);

    // Prevent right-click context menu inside the game canvas
    window.addEventListener('contextmenu', this._onContextMenu);
  }

  _onContextMenu(e) {
    e.preventDefault();
  }

  _onKeyDown(e) {
    if (e.code === 'Tab' || e.code === 'F2' || e.code === 'F1') {
      e.preventDefault(); // Prevent browser from triggering default hotkeys/search
    }
    if (!this.keysDown.has(e.code)) {
      this.keysJustPressed.add(e.code);
    }
    this.keysDown.add(e.code);
  }

  _onKeyUp(e) {
    this.keysDown.delete(e.code);
    this.keysJustReleased.add(e.code);
  }

  _onMouseDown(e) {
    const buttonId = `Mouse${e.button}`;
    if (!this.mouseButtonsDown.has(buttonId)) {
      this.mouseButtonsJustPressed.add(buttonId);
    }
    this.mouseButtonsDown.add(buttonId);
  }

  _onMouseUp(e) {
    const buttonId = `Mouse${e.button}`;
    this.mouseButtonsDown.delete(buttonId);
    this.mouseButtonsJustReleased.add(buttonId);
  }

  _onMouseMove(e) {
    if (this.isPointerLocked) {
      this.mouseDelta.x += e.movementX || 0;
      this.mouseDelta.y += e.movementY || 0;
    } else {
      this.mousePosition.x = e.clientX;
      this.mousePosition.y = e.clientY;
      this.mouseNormalized.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseNormalized.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this.mouseDelta.x += e.movementX || 0;
      this.mouseDelta.y += e.movementY || 0;
    }
  }

  _onPointerLockChange() {
    this.isPointerLocked = document.pointerLockElement !== null;
  }

  /**
   * Request browser pointer lock on an element (e.g. canvas)
   */
  requestPointerLock(element) {
    if (element && element.requestPointerLock) {
      try {
        const promise = element.requestPointerLock();
        if (promise && typeof promise.catch === 'function') {
          promise.catch(() => { });
        }
      } catch (err) {
        // Silently catch browser policy or user activation errors
      }
    }
  }

  /**
   * Exit pointer lock
   */
  exitPointerLock() {
    if (document.exitPointerLock) {
      document.exitPointerLock();
    }
  }

  /**
   * Rebind or add an action mapping
   */
  bindAction(actionName, keys) {
    this.actionBindings[actionName] = Array.isArray(keys) ? keys : [keys];
  }

  /**
   * Check if a semantic action is currently held down
   */
  isActionDown(actionName) {
    const keys = this.actionBindings[actionName];
    if (!keys) return false;
    return keys.some(key => this.keysDown.has(key) || this.mouseButtonsDown.has(key));
  }

  /**
   * Check if a semantic action was pressed on this exact frame
   */
  isActionJustPressed(actionName) {
    const keys = this.actionBindings[actionName];
    if (!keys) return false;
    return keys.some(key => this.keysJustPressed.has(key) || this.mouseButtonsJustPressed.has(key));
  }

  /**
   * Check if a semantic action was released on this frame
   */
  isActionJustReleased(actionName) {
    const keys = this.actionBindings[actionName];
    if (!keys) return false;
    return keys.some(key => this.keysJustReleased.has(key) || this.mouseButtonsJustReleased.has(key));
  }

  /**
   * Get an axis value between -1 and 1 based on two opposing actions
   * e.g. getAxis('steerLeft', 'steerRight') or getAxis('backward', 'forward')
   */
  getAxis(negativeAction, positiveAction) {
    let axis = 0;
    if (this.isActionDown(negativeAction)) axis -= 1;
    if (this.isActionDown(positiveAction)) axis += 1;
    return axis;
  }

  /**
   * Check raw key state
   */
  isKeyDown(code) {
    return this.keysDown.has(code);
  }

  /**
   * Must be called at the end of every animation frame to clear single-frame transitions.
   */
  update() {
    this.keysJustPressed.clear();
    this.keysJustReleased.clear();
    this.mouseButtonsJustPressed.clear();
    this.mouseButtonsJustReleased.clear();

    // Reset deltas
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
  }

  /**
   * Clean up event listeners on teardown / scene transition
   */
  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    window.removeEventListener('contextmenu', this._onContextMenu);

    this.keysDown.clear();
    this.keysJustPressed.clear();
    this.keysJustReleased.clear();
    this.mouseButtonsDown.clear();
    this.mouseButtonsJustPressed.clear();
    this.mouseButtonsJustReleased.clear();
  }
}
