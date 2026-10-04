/**
 * Standalone input abstraction layer mapping raw keyboard and mouse events
 * to semantic game actions (movement, flight axes, turret aiming, firing).
 */
export class InputManager {
  constructor() {
    // Raw key & mouse state tracking
    this.keysDown = new Set();
    this.keysJustPressed = new Set();
    this.keysJustReleased = new Set();

    this.mouseButtonsDown = new Set();
    this.mouseButtonsJustPressed = new Set();
    this.mouseButtonsJustReleased = new Set();

    // Mouse positions and deltas
    this.mousePosition = { x: 0, y: 0 };
    this.mouseDelta = { x: 0, y: 0 };
    this.mouseNormalized = { x: 0, y: 0 };
    this._lastClientX = undefined;
    this._lastClientY = undefined;

    this.actionBindings = {
      forward: ['KeyW', 'ArrowUp'],
      backward: ['KeyS', 'ArrowDown'],
      steerLeft: ['KeyA', 'ArrowLeft'],
      steerRight: ['KeyD', 'ArrowRight'],

      aimLeft: ['KeyA', 'ArrowLeft'],
      aimRight: ['KeyD', 'ArrowRight'],
      aimUp: ['KeyW', 'ArrowUp'],
      aimDown: ['KeyS', 'ArrowDown'],

      jump: ['Space'],
      sprint: ['ShiftLeft', 'ShiftRight'],
      // Not Ctrl: Chrome reserves Ctrl+W (close tab), which players would hit while moving
      crouch: ['KeyC'],

      firePrimary: ['Mouse0', 'KeyF'],
      specialAction: ['KeyE'],

      // Infantry weapons (wheel "buttons" are single-frame presses)
      reload: ['KeyR'],
      weaponPrimary: ['Digit1'],
      weaponMelee: ['Digit2'],
      weaponNext: ['WheelDown'],
      weaponPrev: ['WheelUp'],
      quickMelee: ['KeyQ'],
      aimDownSights: ['Mouse2'],

      mouseLook: ['Mouse0', 'Mouse2'],

      toggleCamera: ['KeyV', 'Tab'],
      toggleColliders: ['KeyB', 'F2'],
      devCamera: ['F1'],
      devSpawn: ['F3'],
      devSquad: ['F4'],
      skipCutscene: ['Space', 'Enter'],
      pause: ['Escape', 'KeyP']
    };

    // Bind event callbacks
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);

    this._attachListeners();
  }

  /**
   * Real-time check if browser pointer lock is currently active
   */
  get isPointerLocked() {
    return typeof document !== 'undefined' && document.pointerLockElement !== null;
  }

  _attachListeners() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    document.addEventListener('pointerlockerror', this._onPointerLockChange);

    // Prevent right-click context menu inside the game canvas
    window.addEventListener('contextmenu', this._onContextMenu);
  }

  _onContextMenu(e) {
    e.preventDefault();
  }

  _onKeyDown(e) {
    if (e.code === 'Tab' || e.code === 'F1' || e.code === 'F2' || e.code === 'F3' || e.code === 'F4') {
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
    let dx = e.movementX || 0;
    let dy = e.movementY || 0;

    // Fallback: when not pointer-locked or if browser movementX/Y is zero/missing,
    // compute deltas from client coordinates to ensure smooth mouse tracking
    if (!this.isPointerLocked) {
      if (this._lastClientX !== undefined && (dx === 0 && dy === 0)) {
        dx = e.clientX - this._lastClientX;
        dy = e.clientY - this._lastClientY;
      }
      this._lastClientX = e.clientX;
      this._lastClientY = e.clientY;
    } else {
      this._lastClientX = undefined;
      this._lastClientY = undefined;
    }

    this.mouseDelta.x += dx;
    this.mouseDelta.y += dy;

    this.mousePosition.x = e.clientX;
    this.mousePosition.y = e.clientY;
    this.mouseNormalized.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouseNormalized.y = -(e.clientY / window.innerHeight) * 2 + 1;
  }

  /**
   * Mouse wheel notches become single-frame 'WheelUp' / 'WheelDown' button presses.
   */
  _onWheel(e) {
    if (e.deltaY > 0) this.mouseButtonsJustPressed.add('WheelDown');
    else if (e.deltaY < 0) this.mouseButtonsJustPressed.add('WheelUp');
  }

  _onPointerLockChange() {
    this._lastClientX = undefined;
    this._lastClientY = undefined;
  }

  /**
   * Request browser pointer lock on an element (e.g. canvas)
   * Prefers unadjustedMovement for direct raw mouse input without OS acceleration lag.
   */
  requestPointerLock(element) {
    if (element && element.requestPointerLock) {
      try {
        const promise = element.requestPointerLock({ unadjustedMovement: true });
        if (promise && typeof promise.catch === 'function') {
          promise.catch(() => {
            // Fallback for browsers that do not support unadjustedMovement options
            try {
              const fallbackPromise = element.requestPointerLock();
              if (fallbackPromise && typeof fallbackPromise.catch === 'function') {
                fallbackPromise.catch(() => { });
              }
            } catch (e) { }
          });
        }
      } catch (err) {
        try {
          element.requestPointerLock();
        } catch (e) { }
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
   * Check semantic actions
   */
  isActionDown(actionName) {
    const keys = this.actionBindings[actionName];
    if (!keys) return false;
    return keys.some(key => this.keysDown.has(key) || this.mouseButtonsDown.has(key));
  }

  isActionJustPressed(actionName) {
    const keys = this.actionBindings[actionName];
    if (!keys) return false;
    return keys.some(key => this.keysJustPressed.has(key) || this.mouseButtonsJustPressed.has(key));
  }

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
   * Check mouse buttons
   */
  isMouseButtonDown(buttonId) {
    return this.mouseButtonsDown.has(buttonId);
  }

  isMouseButtonJustPressed(buttonId) {
    return this.mouseButtonsJustPressed.has(buttonId);
  }

  isMouseButtonJustReleased(buttonId) {
    return this.mouseButtonsJustReleased.has(buttonId);
  }

  /**
   * Must be called at the end of every animation frame to clear single-frame transitions.
   */
  update() {
    this.keysJustPressed.clear();
    this.keysJustReleased.clear();
    this.mouseButtonsJustPressed.clear();
    this.mouseButtonsJustReleased.clear();

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
    window.removeEventListener('wheel', this._onWheel);
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
