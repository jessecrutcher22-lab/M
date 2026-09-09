/* touch.js — phone and tablet controls.
 *
 * Left half of the screen is an analogue steering pad: put a thumb down
 * anywhere and slide, and the steering is relative to where you started, so
 * you never have to look for a wheel. Right side has the pedals. Auto-gas is
 * on by default because holding a throttle button and steering at the same
 * time is miserable on a phone. */
(function (global) {
  'use strict';

  const STEER_TRAVEL = 0.13;     // fraction of screen width for full lock

  function isTouchDevice() {
    return (('ontouchstart' in window) || navigator.maxTouchPoints > 0) &&
      window.matchMedia('(pointer: coarse)').matches;
  }

  class TouchControls {
    constructor(root) {
      this.enabled = false;
      this.autoGas = true;
      this.tilt = false;
      this.tiltZero = null;
      this.tiltValue = 0;
      this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, reset: false };
      this.steerPointer = null;
      this.steerOrigin = 0;
      this.buttons = { gas: false, brake: false, hand: false };
      this._build(root);
      this._bind();
    }

    _build(root) {
      const el = document.createElement('div');
      el.id = 'touch';
      el.innerHTML =
        '<div class="tsteer" id="tSteer">' +
          '<div class="tsteer-track"><div class="tsteer-knob" id="tKnob"></div></div>' +
          '<div class="tsteer-hint">SLIDE TO STEER</div>' +
        '</div>' +
        '<div class="tpads">' +
          '<div class="tbtn hand" data-btn="hand"><span>DRIFT</span></div>' +
          '<div class="tbtn brake" data-btn="brake"><span>BRAKE</span></div>' +
          '<div class="tbtn gas" data-btn="gas"><span>GAS</span></div>' +
        '</div>';
      root.appendChild(el);
      this.el = el;
      this.knob = el.querySelector('#tKnob');
      this.steerZone = el.querySelector('#tSteer');
      this.el.classList.toggle('autogas', this.autoGas);
    }

    _bind() {
      const opts = { passive: false };

      // Steering: relative drag anywhere in the left zone.
      this.steerZone.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.steerPointer = e.pointerId;
        this.steerOrigin = e.clientX;
        this.steerZone.setPointerCapture(e.pointerId);
        this.steerZone.classList.add('active');
      }, opts);
      this.steerZone.addEventListener('pointermove', (e) => {
        if (e.pointerId !== this.steerPointer) return;
        e.preventDefault();
        const travel = window.innerWidth * STEER_TRAVEL;
        this.state.steer = MX.clamp((e.clientX - this.steerOrigin) / travel, -1, 1);
        this.knob.style.transform = 'translateX(' + (this.state.steer * 46) + 'px)';
      }, opts);
      const endSteer = (e) => {
        if (e.pointerId !== this.steerPointer) return;
        this.steerPointer = null;
        this.state.steer = 0;
        this.knob.style.transform = 'translateX(0px)';
        this.steerZone.classList.remove('active');
      };
      this.steerZone.addEventListener('pointerup', endSteer);
      this.steerZone.addEventListener('pointercancel', endSteer);

      // Pedals. Pointer capture means a thumb sliding off still releases.
      for (const b of this.el.querySelectorAll('.tbtn')) {
        const key = b.dataset.btn;
        const down = (e) => {
          e.preventDefault();
          this.buttons[key] = true;
          b.classList.add('on');
          b.setPointerCapture(e.pointerId);
        };
        const up = (e) => { this.buttons[key] = false; b.classList.remove('on'); };
        b.addEventListener('pointerdown', down, opts);
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
        b.addEventListener('lostpointercapture', up);
      }
    }

    setEnabled(on) {
      this.enabled = on;
      this.el.classList.toggle('on', on);
    }

    setAutoGas(on) {
      this.autoGas = on;
      this.el.classList.toggle('autogas', on);
    }

    /* iOS needs an explicit permission prompt, triggered from a real tap. */
    async requestTilt() {
      const D = window.DeviceOrientationEvent;
      if (!D) return false;
      try {
        if (typeof D.requestPermission === 'function') {
          const res = await D.requestPermission();
          if (res !== 'granted') return false;
        }
      } catch (e) { return false; }
      window.addEventListener('deviceorientation', (e) => {
        // In landscape the useful axis is gamma (front-back tilt of the device).
        const raw = (e.gamma === null || e.gamma === undefined) ? 0 : e.gamma;
        if (this.tiltZero === null) this.tiltZero = raw;
        this.tiltValue = MX.clamp((raw - this.tiltZero) / 22, -1, 1);
      });
      this.tilt = true;
      return true;
    }

    recentreTilt() { this.tiltZero = null; }
    setTilt(on) { this.tilt = on && !!this.tiltZero !== null; }

    /* Merge into the shared control state. */
    apply(state, dt) {
      if (!this.enabled) return state;
      const steer = this.tilt ? this.tiltValue : this.state.steer;
      if (Math.abs(steer) > Math.abs(state.steer)) state.steer = steer;

      const braking = this.buttons.brake;
      let throttle = this.buttons.gas ? 1 : 0;
      if (this.autoGas && !braking) throttle = 1;
      state.throttle = Math.max(state.throttle, throttle);
      state.brake = Math.max(state.brake, braking ? 1 : 0);
      state.handbrake = state.handbrake || this.buttons.hand;
      return state;
    }
  }

  global.TouchControls = TouchControls;
  global.TouchControls.isTouchDevice = isTouchDevice;
})(window);
