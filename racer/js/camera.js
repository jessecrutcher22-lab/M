/* camera.js — the chase camera.
 *
 * Half the sensation of speed comes from here, not from the car. The rules:
 *   - the camera lags behind the car in both position and heading
 *   - it swings wide during a drift so you can still see the corner exit
 *   - it pulls back and widens its FOV as you go faster
 *   - it shakes a little at high speed */
(function (global) {
  'use strict';

  class ChaseCamera {
    constructor() {
      this.x = 0; this.y = 4; this.z = -10;
      this.tx = 0; this.ty = 0; this.tz = 0;
      this.ux = 0; this.uy = 1; this.uz = 0;
      this.yaw = 0;
      this.fov = TUNE.CAM.FOV_BASE;
      this.shakeT = 0;
      this.mode = 0;           // 0 = chase, 1 = close chase, 2 = bumper
      this.impact = 0;
    }

    snapTo(car) {
      const C = TUNE.CAM;
      this.yaw = car.yaw;
      this.x = car.x - Math.sin(car.yaw) * C.DISTANCE;
      this.z = car.z - Math.cos(car.yaw) * C.DISTANCE;
      this.y = car.y + C.HEIGHT;
      this.fov = C.FOV_BASE;
    }

    /* Called after the car has been integrated. */
    update(dt, car, opts) {
      const C = TUNE.CAM;
      opts = opts || {};
      const speedRatio = MX.clamp(car.speed / car.topSpeed, 0, 1.1);

      /* Heading: lag behind the car, and add a slice of the sideslip angle so
       * the camera trails wide through a drift instead of staring at the
       * side of the car. */
      const beta = Math.atan2(car.v, Math.max(Math.abs(car.u), 3));
      const targetYaw = car.yaw + beta * C.DRIFT_OFFSET;
      this.yaw = MX.dampAngle(this.yaw, targetYaw, C.YAW_LAG, dt);

      const dist = C.DISTANCE + C.DISTANCE_SPEED * speedRatio +
        (this.mode === 1 ? -2.6 : 0);
      const height = C.HEIGHT + speedRatio * 0.35 + (this.mode === 1 ? -0.7 : 0);

      let px, py, pz;
      if (this.mode === 2) {
        // Bumper cam: rigidly attached, no lag — it reads as much faster.
        px = car.x + Math.sin(car.yaw) * 0.9;
        pz = car.z + Math.cos(car.yaw) * 0.9;
        py = car.y + 0.85;
        this.x = px; this.y = py; this.z = pz;
      } else {
        px = car.x - Math.sin(this.yaw) * dist;
        pz = car.z - Math.cos(this.yaw) * dist;
        py = car.y + height;
        // Position lag. Slightly stiffer at high speed so it never falls behind.
        const lag = C.LAG * (0.75 + 0.55 * speedRatio);
        this.x = MX.damp(this.x, px, lag, dt);
        this.y = MX.damp(this.y, py, lag * 1.5, dt);
        this.z = MX.damp(this.z, pz, lag, dt);
      }

      /* Aim well ahead of the car — looking at the car itself makes corners
       * feel blind and kills the sense of speed. */
      const ahead = C.LOOK_AHEAD * (0.55 + 0.65 * speedRatio);
      const aimYaw = this.mode === 2 ? car.yaw : MX.lerp(car.yaw, this.yaw, 0.25);
      this.tx = car.x + Math.sin(aimYaw) * ahead;
      this.tz = car.z + Math.cos(aimYaw) * ahead;
      this.ty = car.y + 1.05;

      /* FOV widens with speed. This is the single biggest "it feels fast"
       * lever in the whole game. */
      const fovTarget = C.FOV_BASE + C.FOV_SPEED * Math.pow(speedRatio, 1.25) +
        (this.mode === 2 ? 6 : 0) + (opts.boost ? 6 : 0);
      this.fov = MX.damp(this.fov, fovTarget, C.FOV_LAG, dt);

      /* Shake: nothing at cruising speed, a real rumble near the top end,
       * plus a kick whenever you hit something. */
      this.shakeT += dt;
      const over = MX.clamp((car.speed - C.SHAKE_START) / Math.max(car.topSpeed - C.SHAKE_START, 1), 0, 1);
      this.impact = Math.max(0, this.impact - dt * 3.2);
      const amp = C.SHAKE_AMOUNT * over * over + this.impact * 0.35 +
        (opts.rough || 0) * 0.06;
      if (amp > 0.0005) {
        const t = this.shakeT * C.SHAKE_FREQ;
        const sx = Math.sin(t * 1.7) * Math.sin(t * 0.63);
        const sy = Math.sin(t * 2.3 + 1.1) * Math.sin(t * 0.51);
        this.x += sx * amp;
        this.y += sy * amp;
        this.tx += sx * amp * 0.4;
        this.ty += sy * amp * 0.4;
      }

      // A touch of roll into the corner, applied through the up-vector.
      const rollTarget = (-car.roll * 1.1 - beta * 0.055) * C.ROLL;
      this.roll = MX.damp(this.roll || 0, rollTarget, 6, dt);
      this.ux = Math.sin(this.roll) * Math.cos(this.yaw);
      this.uy = Math.cos(this.roll);
      this.uz = -Math.sin(this.roll) * Math.sin(this.yaw);
    }

    kick(strength) { this.impact = Math.min(1.2, this.impact + strength); }

    cycleMode() { this.mode = (this.mode + 1) % 3; return this.mode; }
  }

  global.ChaseCamera = ChaseCamera;
})(window);
