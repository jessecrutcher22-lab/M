/* ui.js — the HUD and the menu screens. Plain DOM over the WebGL canvas:
 * text stays crisp, and it costs nothing per frame. */
(function (global) {
  'use strict';

  function fmtTime(s) {
    if (s === null || s === undefined || !isFinite(s) || s < 0) return '—';
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(2);
  }
  function fmtGap(s) {
    if (s === null || s === undefined || !isFinite(s)) return '—';
    return '+' + s.toFixed(2);
  }
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  class HUD {
    constructor() {
      const $ = (id) => document.getElementById(id);
      this.root = $('hud');
      this.pos = $('hPos'); this.lap = $('hLap');
      this.time = $('hTime'); this.best = $('hBest');
      this.speed = $('hSpeed'); this.gear = $('hGear'); this.rpm = $('hRpm');
      this.flash = $('lapflash'); this.warn = $('warn');
      this.count = $('countdown'); this.debug = $('debug');
      this._last = {};
      this._warnOn = false;
      this._countTxt = '';
    }

    show(on) { this.root.classList.toggle('on', !!on); }

    /* Only touch the DOM when a value actually changed — this is called 60
     * times a second. */
    _set(el, key, value) {
      if (this._last[key] === value) return;
      this._last[key] = value;
      el.innerHTML = value;
    }

    update(car, info) {
      const kmh = Math.round(car.kmh);
      this._set(this.speed, 'sp', String(kmh));
      this._set(this.gear, 'g', String(car.gear));
      this.rpm.style.width = (car.rpm * 100).toFixed(1) + '%';

      if (info) {
        if (info.position) this._set(this.pos, 'p', info.position + '<small>/' + info.total + '</small>');
        if (info.lap) this._set(this.lap, 'l', Math.min(info.lap, info.laps) + '<small>/' + info.laps + '</small>');
        this._set(this.time, 't', fmtTime(info.lapTime));
        this._set(this.best, 'b', fmtTime(info.bestLap));
        if (!!info.wrongWay !== this._warnOn) {
          this._warnOn = !!info.wrongWay;
          this.warn.classList.toggle('on', this._warnOn);
        }
      }
    }

    setCountdown(text, isGo) {
      if (text === this._countTxt) return;
      this._countTxt = text;
      this.count.textContent = text;
      this.count.classList.toggle('go', !!isGo);
    }

    banner(text, colour) {
      this.flash.innerHTML = text;
      this.flash.style.color = colour || '#fff';
      this.flash.classList.remove('show');
      void this.flash.offsetWidth;     // restart the animation
      this.flash.classList.add('show');
    }

    setDebug(text) { this.debug.textContent = text || ''; }
  }

  /* ------------------------------------------------------------- menus */

  class Menu {
    constructor(root) {
      this.root = root;
      this.screens = {};
      this.current = null;
    }

    /* Register a screen built from an HTML string. */
    define(name, html) {
      const el = document.createElement('div');
      el.className = 'screen';
      el.dataset.name = name;
      el.innerHTML = html;
      this.root.appendChild(el);
      this.screens[name] = el;
      return el;
    }

    show(name) {
      this.root.classList.add('on');
      for (const k in this.screens) this.screens[k].classList.toggle('on', k === name);
      this.current = name;
    }

    hide() {
      this.root.classList.remove('on');
      for (const k in this.screens) this.screens[k].classList.remove('on');
      this.current = null;
    }

    q(sel) { return this.screens[this.current] ? this.screens[this.current].querySelector(sel) : null; }
    qa(sel) {
      return this.screens[this.current]
        ? Array.from(this.screens[this.current].querySelectorAll(sel)) : [];
    }
  }

  global.UI = { HUD, Menu, fmtTime, fmtGap, ordinal };
})(window);
