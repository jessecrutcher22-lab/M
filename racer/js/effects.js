/* effects.js — blob shadows under the cars.
 *
 * This file used to carry the skid-mark trail and the tyre-smoke particle
 * system. Both existed to dramatise sliding; the car no longer slides, so
 * they have been removed rather than left switched off. */
(function (global) {
  'use strict';

  class Effects {
    constructor(renderer) {
      this.renderer = renderer;
      this.shadows = renderer.createDynamic(64 * 12, {
        depthWrite: false, polygonOffset: 2
      });
      this.cars = new Set();
    }

    trackCar(car) { this.cars.add(car); }

    reset() {
      this.shadows.clear();
      this.cars.clear();
    }

    update(dt, cars, cam, groundY) {
      const gy = groundY === undefined ? 0.02 : groundY;
      this.shadows.clear();
      for (const car of cars) this._shadow(car, gy);
    }

    /* A soft ellipse under the car. Cheaper and, for this art style, better
     * looking than a real shadow map. */
    _shadow(car, gy) {
      const S = car.spec.shape;
      const s = Math.sin(car.yaw), c = Math.cos(car.yaw);
      const w = S.w * 1.15, l = S.l * 0.92;
      this.shadows.disc(car.x, car.y + gy, car.z,
        c * w, 0, -s * w,      // local right axis, scaled to the car's width
        s * l, 0, c * l,       // local forward axis, scaled to its length
        1, 0, 0, 0, TUNE.FX.SHADOW_ALPHA, 10);
    }
  }

  global.Effects = Effects;
})(window);
