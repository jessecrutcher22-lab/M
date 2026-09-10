/* ai.js — the opponents.
 *
 * Each driver follows the track's racing line with a lookahead that grows
 * with speed, brakes for corners it can see coming, and carries a
 * personality: how close to the limit it drives, how far off the ideal line
 * it sits, how often it fumbles, and how hard it will fight for a gap.
 * Rubber-banding nudges their engine power so the pack stays together. */
(function (global) {
  'use strict';

  const BRAKE_DECEL = 13.5;      // m/s^2 the AI assumes it can shed
  const SCAN_STEP = 9;           // m between corner-speed samples
  const SCAN_MAX = 220;          // m of track the AI looks ahead

  class AIDriver {
    constructor(racer, path, personality) {
      this.r = racer;
      this.path = path;
      this.p = personality;
      const P = racer.car.P;
      this.baseEngine = P.ENGINE_FORCE;
      this.baseTop = P.TOP_SPEED;
      /* Cornering grip this driver will actually use. Derived from the car's
       * own tyres so a low-grip car is driven more carefully, then scaled by
       * skill — a 0.86 driver corners ~12% slower than a 0.98 one. Kept
       * comfortably under the real limit, because an AI at the limit spends
       * the race catching slides instead of racing. */
      /* The WEAKER axle sets how hard a car can be cornered — on an
       * oversteering car the rear lets go long before the average grip
       * suggests, and an AI that averages the two spins it every lap. */
      this.gripLimit = Math.min(P.GRIP_FRONT, P.GRIP_REAR);
      this.baseLatG = this.gripLimit * 1.02 * this.p.skill;
      this.latG = this.baseLatG;
      this.steerSmooth = 0;
      this.mistakeTimer = 2 + Math.random() * 6;
      this.mistake = null;
      this.wobble = Math.random() * 100;
      this.avoid = 0;
      this.stuck = 0;
      this.recover = 0;
      this.recoverTries = 0;
      this.ctrl = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    }

    update(dt, race) {
      const r = this.r, car = r.car, path = this.path;
      const c = this.ctrl;
      this.wobble += dt;

      this._rubberBand(race);
      this._rollMistake(dt);
      if (this._unstick(dt, race)) return c;

      /* ---- where to aim ------------------------------------------------- */
      const lookahead = 9 + car.speed * 0.72;
      const tNode = path.nodeAt(r.s + lookahead);
      let offset = path.lineAt(tNode.i) + this.p.lineBias * (tNode.width * 0.22);
      offset += this._avoidance(race, dt);
      if (this.mistake === 'wobble') offset += Math.sin(this.wobble * 7) * 3.4;
      // Never aim outside the white lines: the line plus avoidance together
      // must still leave the whole car on the road.
      offset = MX.clamp(offset, -tNode.width * 0.38, tNode.width * 0.38);

      const tx = tNode.x + tNode.rx * offset;
      const tz = tNode.z + tNode.rz * offset;
      const want = Math.atan2(tx - car.x, tz - car.z);
      let err = MX.angleDelta(car.yaw, want);

      /* Counter-steer. Oversteer in a right-hand corner puts the velocity to
       * the LEFT of the nose (beta < 0), and the answer is left lock — so the
       * correction is added, not subtracted. Getting this backwards makes the
       * car oscillate lock-to-lock and never recover. */
      const beta = Math.atan2(car.v, Math.max(Math.abs(car.u), 3));
      err += beta * 1.15 * this.p.skill;

      /* Proportional on heading error, derivative on yaw rate. The derivative
       * term is what keeps the loop stable at speed; without enough of it the
       * car saw-tooths down every straight. */
      const raw = MX.clamp(err * 2.2 - car.r * 0.85, -1, 1);
      // Hands are not instant. Rate-limiting also damps the loop.
      this.steerSmooth = MX.damp(this.steerSmooth, raw, 14, dt);
      c.steer = MX.clamp(this.steerSmooth, -1, 1);

      /* ---- how fast to be going ----------------------------------------- */
      let vTarget = car.P.TOP_SPEED;
      for (let d = 6; d < SCAN_MAX; d += SCAN_STEP) {
        const n = path.nodeAt(r.s + d);
        const vCorner = Math.sqrt(this.latG * 9.81 * Math.min(n.radius, 1200));
        // Fastest we can be now and still be down to vCorner by then.
        const vAllowed = Math.sqrt(vCorner * vCorner + 2 * BRAKE_DECEL * d);
        if (vAllowed < vTarget) vTarget = vAllowed;
      }
      if (this.mistake === 'late') vTarget *= 1.16;      // braked too late
      if (this.mistake === 'lift') vTarget *= 0.72;      // lifted for nothing
      if (r.offTrack) vTarget *= 0.8;

      const dv = car.speed - vTarget;
      if (dv < -0.5) { c.throttle = 1; c.brake = 0; }
      else if (dv > 1.5) { c.throttle = 0; c.brake = MX.clamp(dv / 7, 0.15, 1); }
      else { c.throttle = MX.clamp(0.55 - dv * 0.25, 0, 1); c.brake = 0; }

      /* Ease off while the car is loaded up in a corner. Full throttle plus
       * full lock spends the rear tyres' grip budget on the wrong thing. */
      const load = MX.clamp(Math.abs(car.r) * car.speed / (this.latG * 9.81), 0, 1);
      c.throttle *= 1 - 0.5 * load;

      // Off the road: back off and aim for the middle rather than the apex.
      if (r.offTrack) { c.throttle = Math.min(c.throttle, 0.55); c.brake = 0; }
      // Never crawl.
      if (car.speed < 4 && !r.finished) { c.throttle = 1; c.brake = 0; }

      /* A big slide: lift and let the counter-steer do its work. */
      if (Math.abs(beta) > 0.30) {
        c.throttle *= MX.clamp(1 - (Math.abs(beta) - 0.30) * 2.4, 0.1, 1);
        c.brake = 0;
      }
      c.handbrake = false;
      return c;
    }

    /* Beached against a barrier or spun around? Reverse out, and if that does
     * not work, take the drop back onto the track. Nothing kills a race like
     * an opponent parked in a wall for two laps. */
    _unstick(dt, race) {
      const r = this.r, car = r.car, c = this.ctrl;
      if (r.finished) return false;

      if (this.recover > 0) {
        this.recover -= dt;
        const nd = this.path.nodes[r.node];
        // Reverse away from wherever we are pointing, steering back to centre.
        const err = MX.angleDelta(car.yaw, nd.yaw);
        c.throttle = 0;
        c.brake = 1;
        c.steer = MX.clamp(-err * 2.0 - MX.sign(r.lateral) * 0.6, -1, 1);
        c.handbrake = false;
        if (this.recover <= 0) this.stuck = 0;
        return true;
      }

      if (car.speed < 4.5 && race.state === 'racing') {
        this.stuck += dt;
        if (this.stuck > 1.8) {
          this.stuck = 0;
          this.recoverTries++;
          // Two failed reverse-outs and we take the drop back onto the track,
          // rather than leaving a rival parked in a barrier for two laps.
          if (this.recoverTries > 2) { race.respawn(r); this.recoverTries = 0; }
          else this.recover = 1.4;
        }
      } else {
        this.stuck = Math.max(0, this.stuck - dt * 2);
        this.recoverTries = Math.max(0, this.recoverTries - dt * 0.25);
      }
      return false;
    }

    /* Rubber-banding: quietly trim engine power by the gap to the player so
     * a bad first corner does not end the race. */
    _rubberBand(race) {
      const R = TUNE.RACE;
      const player = race.racers.find(x => x.isPlayer);
      if (!player) return;
      const gap = this.r.progress - player.progress;   // + = this AI is ahead
      const t = MX.clamp(gap / R.RUBBER_RANGE, -1, 1);
      const mult = t > 0
        ? MX.lerp(1, R.RUBBER_AHEAD, t)
        : MX.lerp(1, R.RUBBER_BEHIND, -t);
      const P = this.r.car.P;
      P.ENGINE_FORCE = this.baseEngine * mult;
      P.TOP_SPEED = this.baseTop * MX.lerp(1, mult, 0.45);

      /* Engine power alone is a weak lever: these circuits are corner-limited,
       * not power-limited, so a car trailing by half a lap claws back almost
       * nothing from extra thrust. Nudging how hard the driver is willing to
       * corner is what actually closes a gap — and it reads as someone
       * pushing harder rather than as a cheat. Capped at what the car's
       * weaker axle can really do, so nobody rubber-bands into a spin. */
      this.latG = Math.min(this.baseLatG * MX.lerp(1, mult, 0.85),
                           this.gripLimit * 1.12);
    }

    /* Small, human errors. Not random twitching — a driver locking up into a
     * corner or running a touch wide, then recovering. */
    _rollMistake(dt) {
      this.mistakeTimer -= dt;
      if (this.mistakeTimer > 0) return;
      if (this.mistake) {
        this.mistake = null;
        this.mistakeTimer = 3.5 + Math.random() * 9;
        return;
      }
      if (Math.random() < this.p.mistake) {
        const kinds = ['wobble', 'late', 'lift'];
        this.mistake = kinds[Math.floor(Math.random() * kinds.length)];
        this.mistakeTimer = 0.5 + Math.random() * 1.1;
      } else {
        this.mistakeTimer = 2 + Math.random() * 5;
      }
    }

    /* Move off the line for a car just ahead. Aggressive drivers commit to a
     * side and stay there; cautious ones back out. */
    _avoidance(race, dt) {
      const r = this.r, path = this.path;
      let want = 0;
      for (const o of race.racers) {
        if (o === r) continue;
        const d = path.delta(r.s, o.s);
        if (d < 1 || d > 26) continue;
        const dl = o.lateral - r.lateral;
        if (Math.abs(dl) > 5.5) continue;
        const urgency = (1 - d / 26) * (0.5 + this.p.aggression);
        want += (dl >= 0 ? -1 : 1) * 5.0 * urgency;
      }
      this.avoid = MX.damp(this.avoid, MX.clamp(want, -7, 7), 3.5, dt);
      return this.avoid;
    }
  }

  global.AIDriver = AIDriver;
})(window);
