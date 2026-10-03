/**
 * StateMachine
 * Minimal finite state machine for AI brains. Each state is an object with optional
 * enter(owner), update(owner, delta) and exit(owner) methods; `update` may return the
 * name of the next state to switch to.
 */
export class StateMachine {
  /**
   * @param {Object} owner - Passed to every state callback
   * @param {Object<string, {enter?: Function, update?: Function, exit?: Function}>} states
   * @param {string} initial - Name of the starting state
   */
  constructor(owner, states, initial) {
    this.owner = owner;
    this.states = states;
    this.current = null;
    this.timeInState = 0;
    this.change(initial);
  }

  /**
   * Switches state (no-op when already in it).
   */
  change(name) {
    if (name === this.current) return;
    const previous = this.states[this.current];
    if (previous && previous.exit) previous.exit(this.owner);

    this.current = name;
    this.timeInState = 0;
    const next = this.states[name];
    if (next && next.enter) next.enter(this.owner);
  }

  /**
   * Runs the current state; switches if it returns another state's name.
   */
  update(delta) {
    this.timeInState += delta;
    const state = this.states[this.current];
    if (!state || !state.update) return;
    const next = state.update(this.owner, delta);
    if (next && next !== this.current) this.change(next);
  }

  is(name) {
    return this.current === name;
  }
}
