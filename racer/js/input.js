/* input.js — keyboard + gamepad, collapsed into one analogue control state. */
(function (global) {
  'use strict';

  const KEYMAP = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'handbrake',
    KeyR: 'reset',
    ShiftLeft: 'boostless', ShiftRight: 'boostless',
    Escape: 'escape', Enter: 'enter', KeyC: 'camera'
  };

  class Input {
    constructor() {
      this.keys = Object.create(null);
      this.pressed = Object.create(null);   // edge-triggered, cleared each frame
      this.raw = Object.create(null);       // raw KeyboardEvent.code set
      this.rawPressed = Object.create(null);
      this.gamepadIndex = null;
      this.gamepadName = '';
      this.state = {
        throttle: 0, brake: 0, steer: 0,
        handbrake: false, reset: false, resetHeld: 0, usingPad: false
      };
      this._bind();
    }

    _bind() {
      window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        const a = KEYMAP[e.code];
        if (a) { this.keys[a] = true; this.pressed[a] = true; }
        this.raw[e.code] = true;
        this.rawPressed[e.code] = true;
        // Stop the page scrolling out from under the game.
        if (a || e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      });
      window.addEventListener('keyup', (e) => {
        const a = KEYMAP[e.code];
        if (a) this.keys[a] = false;
        this.raw[e.code] = false;
      });
      window.addEventListener('blur', () => {
        for (const k in this.keys) this.keys[k] = false;
        for (const k in this.raw) this.raw[k] = false;
      });
      window.addEventListener('gamepadconnected', (e) => {
        this.gamepadIndex = e.gamepad.index;
        this.gamepadName = e.gamepad.id;
      });
      window.addEventListener('gamepaddisconnected', (e) => {
        if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null;
      });
    }

    /* Call once per frame, before anything reads `state`. */
    update(dt) {
      const s = this.state;
      let throttle = this.keys.up ? 1 : 0;
      let brake = this.keys.down ? 1 : 0;
      let steer = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
      let handbrake = !!this.keys.handbrake;
      let reset = !!this.keys.reset;
      let pad = false;

      const gp = this._pad();
      if (gp) {
        const dead = (v) => (Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86);
        const ax = dead(gp.axes[0] || 0);
        const rt = gp.buttons[7] ? gp.buttons[7].value : 0;
        const lt = gp.buttons[6] ? gp.buttons[6].value : 0;
        const aBtn = gp.buttons[0] && gp.buttons[0].pressed;
        const xBtn = gp.buttons[2] && gp.buttons[2].pressed;
        const bBtn = gp.buttons[1] && gp.buttons[1].pressed;
        if (Math.abs(ax) > 0.02 || rt > 0.04 || lt > 0.04 || aBtn || xBtn || bBtn) pad = true;
        if (Math.abs(ax) > Math.abs(steer)) steer = ax;
        throttle = Math.max(throttle, rt);
        brake = Math.max(brake, lt);
        handbrake = handbrake || !!aBtn || !!xBtn;
        reset = reset || !!bBtn;
        // Face buttons double as menu confirm.
        if (aBtn && !this._padA) this.pressed.enter = true;
        this._padA = aBtn;
      }

      s.throttle = throttle;
      s.brake = brake;
      s.steer = MX.clamp(steer, -1, 1);
      s.handbrake = handbrake;
      s.reset = reset;
      s.resetHeld = reset ? s.resetHeld + dt : 0;
      s.usingPad = pad;
      return s;
    }

    _pad() {
      if (!navigator.getGamepads) return null;
      const pads = navigator.getGamepads();
      if (this.gamepadIndex !== null && pads[this.gamepadIndex]) return pads[this.gamepadIndex];
      for (const p of pads) {
        if (p && p.connected) { this.gamepadIndex = p.index; this.gamepadName = p.id; return p; }
      }
      return null;
    }

    /* Edge-triggered helpers for menus. */
    tapped(action) { return !!this.pressed[action]; }
    tappedCode(code) { return !!this.rawPressed[code]; }
    endFrame() {
      for (const k in this.pressed) this.pressed[k] = false;
      for (const k in this.rawPressed) this.rawPressed[k] = false;
    }
  }

  global.Input = Input;
})(window);
