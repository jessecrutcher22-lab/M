/* race.js — everything that turns "a car on a surface" into a race:
 * checkpoints, laps, timing, standings, the countdown, off-track penalties,
 * barrier and car-to-car collisions, and the reset. */
(function (global) {
  'use strict';

  const CAR_RADIUS = 1.45;          // m, for car-to-car contact
  const CHECKPOINT_WINDOW = 140;    // m of tolerance when collecting one

  class Racer {
    constructor(car, opts) {
      this.car = car;
      this.name = opts.name;
      this.isPlayer = !!opts.isPlayer;
      this.colour = opts.colour;
      this.reset();
    }
    reset() {
      this.lap = 0;
      this.nextCp = 0;
      this.started = false;
      this.lapStart = 0;
      this.lapTimes = [];
      this.bestLap = null;
      this.totalTime = null;
      this.finished = false;
      this.finishOrder = 0;
      this.position = 1;
      this.progress = 0;
      this.s = 0;
      this.lateral = 0;
      this.node = 0;
      this.hint = -1;
      this.offTrack = false;
      this.wrongWay = 0;
      this.lastSafe = null;
      this.gap = null;
    }
  }

  class Race {
    constructor(path, def, racers, opts) {
      opts = opts || {};
      this.path = path;
      this.def = def;
      this.racers = racers;
      this.laps = opts.laps || TUNE.RACE.LAPS;
      this.time = 0;
      this.countdown = TUNE.RACE.COUNTDOWN;
      this.state = 'countdown';       // countdown -> racing -> finished
      this.finishCount = 0;
      this.events = [];               // {type, racer, ...} drained by the UI
      this.gridUp();
    }

    /* Line the field up behind the start, staggered two abreast. */
    gridUp() {
      const P = this.path;
      this.racers.forEach((r, i) => {
        const g = P.gridSlot(i);
        r.car.reset(g.x, g.z, g.yaw);
        r.car.y = g.y;
        r.reset();
        const n = P.nearest(g.x, g.z);
        r.s = n.s; r.node = n.node; r.hint = n.node;
        r.lastSafe = { x: g.x, z: g.z, yaw: g.yaw, s: n.s };
        r.progress = n.s - P.length;    // behind the line on lap 0
      });
      this.time = 0;
      this.countdown = TUNE.RACE.COUNTDOWN;
      this.state = 'countdown';
      this.finishCount = 0;
      this.events.length = 0;
    }

    get racingStarted() { return this.state !== 'countdown'; }

    /* Are the controls live yet? Everything is frozen during the countdown. */
    controlsFor(r, ctrl) {
      if (this.state === 'countdown') return { throttle: 0, brake: 1, steer: 0, handbrake: true };
      if (r.finished) {
        // Coast to a stop after the flag rather than stopping dead.
        return { throttle: 0, brake: 0.25, steer: ctrl ? ctrl.steer * 0.5 : 0, handbrake: false };
      }
      return ctrl;
    }

    /* Surface under a car: grip multiplier and extra drag. */
    surfaceFor(r) {
      const halfW = this.path.nodes[r.node].width / 2;
      const over = Math.abs(r.lateral) - halfW;
      if (over <= 0) return { grip: 1, drag: 0 };
      const P = TUNE.PHYS;
      const t = MX.clamp(over / 3, 0, 1);      // a wheel off is less bad than all four
      return {
        grip: MX.lerp(1, P.OFFTRACK_GRIP, t),
        drag: P.OFFTRACK_DRAG * t
      };
    }

    /* Called once per physics step, after every car has been integrated. */
    step(dt) {
      const P = this.path;
      this.time += dt;

      if (this.state === 'countdown') {
        this.countdown -= dt;
        if (this.countdown <= 0) { this.state = 'racing'; this.countdown = 0; }
      }

      for (const r of this.racers) {
        const car = r.car;
        const n = P.nearest(car.x, car.z, r.hint);
        r.hint = n.node; r.node = n.node; r.s = n.s; r.lateral = n.lateral;

        // Ride height follows the track surface.
        car.y = MX.damp(car.y, P.nodes[n.node].y, 12, dt);

        r.offTrack = Math.abs(n.lateral) > P.nodes[n.node].width / 2 + 0.4;
        this._walls(r, dt);
        this._checkpoints(r);
        this._wrongWay(r, dt);
      }

      this._contacts();
      this._standings();
    }

    /* Barriers. Push the car back inside and take the speed the impact
     * deserves — glancing blows cost little, square hits cost a lot. */
    _walls(r, dt) {
      const P = TUNE.PHYS;
      const nd = this.path.nodes[r.node];
      const limit = nd.width / 2 + this.path.runoff - 1.0;
      const lat = r.lateral;
      if (Math.abs(lat) <= limit) return;

      const car = r.car;
      const sx = MX.sign(lat);
      const over = Math.abs(lat) - limit;
      car.x -= nd.rx * sx * over;
      car.z -= nd.rz * sx * over;
      r.lateral = sx * limit;

      // Inward wall normal.
      const nx = -sx * nd.rx, nz = -sx * nd.rz;
      const vn = car.velX * nx + car.velZ * nz;
      if (vn < 0) {
        const hit = -vn;
        car.impulse(-nx * vn * (1 + P.WALL_BOUNCE), -nz * vn * (1 + P.WALL_BOUNCE));
        car.scrub(MX.lerp(1, P.WALL_SCRUB, MX.clamp(hit / 18, 0, 1)));
        car.r *= 0.55;
        this.events.push({ type: 'wall', racer: r, force: MX.clamp(hit / 22, 0, 1) });
      } else {
        car.scrub(0.995);      // scraping along the barrier
      }
    }

    /* Checkpoints have to be collected in order, so cutting the course or
     * reversing back over the line does not count. */
    _checkpoints(r) {
      if (r.finished) return;
      const P = this.path;
      const cps = P.checkpoints;
      const target = cps[r.nextCp];
      const d = P.delta(r.s, target.s);
      if (d > 0 || d < -CHECKPOINT_WINDOW) return;      // not reached yet

      r.nextCp = (r.nextCp + 1) % cps.length;
      if (Math.abs(r.lateral) < P.nodes[r.node].width / 2 + P.runoff) {
        r.lastSafe = { x: r.car.x, z: r.car.z, yaw: P.nodes[r.node].yaw, s: r.s };
      }
      if (r.nextCp === 1) this._crossLine(r);
    }

    _crossLine(r) {
      if (!r.started) {
        r.started = true;
        r.lap = 1;
        r.lapStart = this.time;
        return;
      }
      const t = this.time - r.lapStart;
      r.lapTimes.push(t);
      if (r.bestLap === null || t < r.bestLap) {
        r.bestLap = t;
        this.events.push({ type: 'bestlap', racer: r, time: t });
      } else {
        this.events.push({ type: 'lap', racer: r, time: t });
      }
      r.lapStart = this.time;
      r.lap++;
      if (r.lap > this.laps) {
        r.lap = this.laps;
        r.finished = true;
        r.totalTime = this.time;
        r.finishOrder = ++this.finishCount;
        this.events.push({ type: 'finish', racer: r });
        if (r.isPlayer || this.finishCount >= this.racers.length) this.state = 'finished';
      }
    }

    _wrongWay(r, dt) {
      const nd = this.path.nodes[r.node];
      const dot = r.car.velX * nd.dx + r.car.velZ * nd.dz;
      if (dot < -3 && r.car.speed > 4) r.wrongWay = Math.min(2, r.wrongWay + dt);
      else r.wrongWay = Math.max(0, r.wrongWay - dt * 2);
    }

    /* Car-to-car: separate the pair and trade a little momentum. Deliberately
     * soft — being punted off by an AI is not fun. */
    _contacts() {
      const rs = this.racers;
      for (let i = 0; i < rs.length; i++) {
        for (let j = i + 1; j < rs.length; j++) {
          const a = rs[i].car, b = rs[j].car;
          let dx = b.x - a.x, dz = b.z - a.z;
          const d2 = dx * dx + dz * dz;
          const min = CAR_RADIUS * 2;
          if (d2 > min * min || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          dx /= d; dz /= d;
          const push = (min - d) * 0.5;
          a.x -= dx * push; a.z -= dz * push;
          b.x += dx * push; b.z += dz * push;
          // Closing speed along the contact normal.
          const rel = (b.velX - a.velX) * dx + (b.velZ - a.velZ) * dz;
          if (rel < 0) {
            const k = -rel * 0.45;
            a.impulse(-dx * k, -dz * k);
            b.impulse(dx * k, dz * k);
            if (-rel > 6) this.events.push({ type: 'contact', racer: rs[i], other: rs[j] });
          }
        }
      }
    }

    /* Standings: distance covered, then finish order for anyone home. */
    _standings() {
      const L = this.path.length;
      for (const r of this.racers) {
        r.progress = (r.started ? (r.lap - 1) : -1) * L + r.s;
      }
      const order = this.racers.slice().sort((a, b) => {
        if (a.finished && b.finished) return a.finishOrder - b.finishOrder;
        if (a.finished) return -1;
        if (b.finished) return 1;
        return b.progress - a.progress;
      });
      order.forEach((r, i) => {
        r.position = i + 1;
        const ahead = order[i - 1];
        r.gap = ahead ? (ahead.progress - r.progress) : 0;
      });
      this.order = order;
    }

    /* Put a stuck or beached car back on track at its last valid checkpoint. */
    respawn(r) {
      const safe = r.lastSafe;
      if (!safe) return;
      const P = this.path;
      const n = P.nearest(safe.x, safe.z);
      const g = P.sample(n.s, P.lineAt(n.node), {});
      r.car.reset(g.x, g.z, g.yaw);
      r.car.y = g.y;
      r.car.u = 12;                 // roll away rather than starting from dead stop
      r.hint = n.node;
      this.events.push({ type: 'respawn', racer: r });
    }

    drainEvents() {
      const e = this.events.slice();
      this.events.length = 0;
      return e;
    }

    /* What the HUD needs each frame. */
    hudFor(r) {
      return {
        position: r.position,
        total: this.racers.length,
        lap: Math.max(1, r.lap),
        laps: this.laps,
        lapTime: r.started ? this.time - r.lapStart : 0,
        bestLap: r.bestLap,
        wrongWay: r.wrongWay > 0.55 && !r.finished
      };
    }
  }

  global.Racer = Racer;
  global.Race = Race;
})(window);
