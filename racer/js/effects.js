/* effects.js — skid marks, tyre smoke and blob shadows.
 *
 * Skid marks go into an append-only ring buffer on the GPU: each new segment
 * overwrites the oldest one and only those few vertices are re-uploaded, so
 * thousands of marks cost almost nothing per frame. */
(function (global) {
  'use strict';

  const F = () => TUNE.FX;

  /* Local (right, forward) offset -> world position on the car. */
  function local2world(car, lx, lz, out) {
    const s = Math.sin(car.yaw), c = Math.cos(car.yaw);
    out[0] = car.x + lx * c + lz * s;
    out[1] = car.z - lx * s + lz * c;
    return out;
  }

  class Effects {
    constructor(renderer) {
      this.renderer = renderer;
      const fx = F();
      // Skid marks. 6 cars * 2 axles * 2 sides worth of segments.
      this.skidCapacity = 2600;
      this.skid = renderer.createDynamic(this.skidCapacity * 6, {
        depthWrite: false, polygonOffset: 3, persistent: true
      });
      this.skidCursor = 0;
      this.smoke = renderer.createDynamic(fx.SMOKE_MAX * 24, { depthWrite: false });
      this.shadows = renderer.createDynamic(64 * 6, { depthWrite: false, polygonOffset: 2 });
      this.particles = [];
      this.emitters = new Map();
      this.tmpA = [0, 0]; this.tmpB = [0, 0];
      this.smokeBudget = 0;
    }

    trackCar(car, opts) {
      this.emitters.set(car, {
        wheels: [
          { lx: -1, lz: -1, prevL: null, prevR: null },   // rear left
          { lx: 1, lz: -1, prevL: null, prevR: null }     // rear right
        ],
        quality: (opts && opts.quality) || 1,
        smokeAccum: 0,
        halfWidth: (car.spec.shape.w + 0.02),
        rearZ: -car.P.AXLE_REAR
      });
    }

    reset() {
      this.particles.length = 0;
      this.smoke.clear();
      this.shadows.clear();
      // Wipe the trail by collapsing every quad to a point.
      const zero = [0, -50, 0];
      for (let i = 0; i < this.skidCapacity; i++) {
        this.skid.quadAt(i, zero, zero, zero, zero, 0, 0, 0, 0);
      }
      this.skid.touch(0, this.skidCapacity * 6);
      this.skidCursor = 0;
      for (const e of this.emitters.values()) {
        for (const w of e.wheels) { w.prevL = null; w.prevR = null; }
      }
    }

    /* cars: array of Car. cam: ChaseCamera (for billboarding). */
    update(dt, cars, cam, groundY) {
      const fx = F();
      this.shadows.clear();
      const gy = groundY === undefined ? 0.02 : groundY;

      for (const car of cars) {
        const e = this.emitters.get(car);
        if (!e) continue;
        this._shadow(car, gy);

        const drift = car.driftAmount;
        const laying = drift > fx.SKID_THRESHOLD && car.speed > 4 && !car.airborne;

        for (const w of e.wheels) {
          const inner = w.lx * e.halfWidth - fx.SKID_WIDTH * 0.5 * w.lx;
          const outer = w.lx * e.halfWidth + fx.SKID_WIDTH * 0.5 * w.lx;
          const L = local2world(car, inner, e.rearZ, [0, 0]);
          const R = local2world(car, outer, e.rearZ, [0, 0]);
          if (!laying) { w.prevL = null; w.prevR = null; continue; }
          if (w.prevL) {
            const moved = Math.hypot(L[0] - w.prevL[0], L[1] - w.prevL[1]);
            if (moved < 0.35) continue;
            const a = fx.SKID_ALPHA * MX.clamp((drift - fx.SKID_THRESHOLD) * 2.2, 0.15, 1);
            const y = car.y + 0.025;
            this.skid.quadAt(this.skidCursor,
              [w.prevL[0], y, w.prevL[1]], [w.prevR[0], y, w.prevR[1]],
              [R[0], y, R[1]], [L[0], y, L[1]],
              0.06, 0.055, 0.06, a);
            this.skidCursor = (this.skidCursor + 1) % this.skidCapacity;
          }
          w.prevL = L; w.prevR = R;
        }

        /* Smoke. Budgeted so a six-car pile of drifts cannot tank the frame. */
        if (drift > fx.SKID_THRESHOLD + 0.06 && car.speed > 6) {
          e.smokeAccum += dt * fx.SMOKE_RATE * drift * e.quality;
          while (e.smokeAccum >= 1 && this.particles.length < fx.SMOKE_MAX) {
            e.smokeAccum -= 1;
            const side = Math.random() < 0.5 ? -1 : 1;
            const p = local2world(car, side * e.halfWidth, e.rearZ - 0.2, [0, 0]);
            this.particles.push({
              x: p[0] + (Math.random() - 0.5) * 0.4,
              y: car.y + 0.22 + Math.random() * 0.2,
              z: p[1] + (Math.random() - 0.5) * 0.4,
              vx: -car.velX * 0.10 + (Math.random() - 0.5) * 1.4,
              vy: fx.SMOKE_RISE * (0.6 + Math.random() * 0.8),
              vz: -car.velZ * 0.10 + (Math.random() - 0.5) * 1.4,
              size: 0.30 + Math.random() * 0.25,
              life: fx.SMOKE_LIFE * (0.7 + Math.random() * 0.6),
              maxLife: fx.SMOKE_LIFE,
              tone: 0.82 + Math.random() * 0.18
            });
          }
        } else {
          e.smokeAccum = 0;
        }
      }

      this._updateSmoke(dt, cam);
    }

    /* A soft elliptical blob under the car. Cheaper and, for this art style,
     * better looking than a real shadow map. */
    _shadow(car, gy) {
      const S = car.spec.shape;
      const s = Math.sin(car.yaw), c = Math.cos(car.yaw);
      const w = S.w * 1.15, l = S.l * 0.92;
      this.shadows.disc(car.x, car.y + gy, car.z,
        c * w, 0, -s * w,      // local right axis, scaled to the car's width
        s * l, 0, c * l,       // local forward axis, scaled to its length
        1, 0, 0, 0, 0.38, 10);
    }

    _updateSmoke(dt, cam) {
      const fx = F();
      this.smoke.clear();
      if (!this.particles.length) return;

      // Camera basis for billboarding.
      let fx0 = cam.tx - cam.x, fy0 = cam.ty - cam.y, fz0 = cam.tz - cam.z;
      let fl = Math.hypot(fx0, fy0, fz0) || 1;
      fx0 /= fl; fy0 /= fl; fz0 /= fl;
      // right = normalize(cross(forward, worldUp)) with worldUp = (0,1,0)
      let rx = -fz0, ry = 0, rz = fx0;
      const rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl; ry /= rl; rz /= rl;
      // up = cross(right, forward)
      const ux = ry * fz0 - rz * fy0;
      const uy = rz * fx0 - rx * fz0;
      const uz = rx * fy0 - ry * fx0;

      const keep = [];
      for (const p of this.particles) {
        p.life -= dt;
        if (p.life <= 0) continue;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.vx *= 1 - 1.7 * dt; p.vz *= 1 - 1.7 * dt; p.vy *= 1 - 0.9 * dt;
        p.size += fx.SMOKE_GROW * dt;
        const t = p.life / p.maxLife;
        const a = Math.min(1, t * 2.2) * Math.min(1, t * 1.2) * 0.20;
        this.smoke.disc(p.x, p.y, p.z, rx, ry, rz, ux, uy, uz, p.size,
                        p.tone, p.tone, p.tone * 1.02, a, 7);
        keep.push(p);
      }
      this.particles = keep;
    }
  }

  global.Effects = Effects;
})(window);
