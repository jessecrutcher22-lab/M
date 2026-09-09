/* car.js — the driving model. This is the part that has to feel good.
 *
 * The car is a two-wheel ("bicycle") model: one front tyre, one rear tyre,
 * each generating lateral force from its slip angle through a simplified
 * Pacejka curve. Drift, counter-steer and power-oversteer all fall out of
 * that naturally rather than being special-cased.
 *
 * Body frame:  +Z forward, +X right, yaw increases clockwise (turning right).
 * All the numbers it reads live in tune.js. */
(function (global) {
  'use strict';

  const WHEEL_RADIUS = 0.31;

  /* Simplified Pacejka magic formula, normalised so the peak is ~1.0. */
  function tyreCurve(slip, stiff, shape) {
    return Math.sin(shape * Math.atan(stiff * slip));
  }

  class Car {
    constructor(spec, opts) {
      opts = opts || {};
      this.spec = spec;
      this.isPlayer = !!opts.isPlayer;
      this.name = opts.name || spec.name;

      // Flatten the shared constants with this car's overrides.
      this.P = Object.assign({}, TUNE.PHYS, spec.phys || {});

      /* Solve aero drag so the car tops out at exactly P.TOP_SPEED:
       *   thrust_at_Vmax = ENGINE_FORCE * (1 - TORQUE_FADE)
       *   thrust = DRAG*V^2 + ROLL_RESIST*V                     */
      const P = this.P;
      const thrustTop = P.ENGINE_FORCE * (1 - P.TORQUE_FADE);
      P.DRAG = Math.max(0.05,
        (thrustTop - P.ROLL_RESIST * P.TOP_SPEED) / (P.TOP_SPEED * P.TOP_SPEED));

      this.wheelbase = P.AXLE_FRONT + P.AXLE_REAR;
      this.reset(0, 0, 0);
    }

    reset(x, z, yaw) {
      this.x = x; this.y = 0; this.z = z;
      this.yaw = yaw || 0;
      this.u = 0;              // longitudinal velocity, body frame (m/s)
      this.v = 0;              // lateral velocity, body frame (+ = to the right)
      this.r = 0;              // yaw rate (rad/s)
      this.steerAngle = 0;
      this.ax = 0; this.ay = 0;
      this.pitch = 0; this.roll = 0;
      this.pitchVel = 0; this.rollVel = 0;
      this.wheelSpin = 0;
      this.slipFront = 0; this.slipRear = 0;
      this.driftAmount = 0;    // 0..1, drives smoke / skids / scoring
      this.rpm = 0.15;
      this.gear = 1;
      this.speed = 0;
      this.velX = 0; this.velZ = 0;
      this.airborne = false;
      this.collisionFlash = 0;
    }

    get topSpeed() { return this.P.TOP_SPEED; }

    /* controls: {throttle 0..1, brake 0..1, steer -1..1, handbrake bool}
     * surface:  {grip: mu multiplier, drag: extra N}  — from the track. */
    update(dt, controls, surface) {
      const P = this.P;
      const g = P.GRAVITY;
      surface = surface || { grip: 1, drag: 0 };

      const throttle = MX.clamp(controls.throttle || 0, 0, 1);
      const brake = MX.clamp(controls.brake || 0, 0, 1);
      const handbrake = !!controls.handbrake;

      const u = this.u, v = this.v, r = this.r;
      const speed = Math.hypot(u, v);
      this.speed = speed;

      /* ---- steering ----------------------------------------------------
       * Lock shrinks with speed. Without this you cannot hold a straight
       * line at 250 km/h; with it, the car feels precise at both ends. */
      const speedT = Math.pow(MX.clamp(speed / P.STEER_FALLOFF_SPEED, 0, 1),
                              P.STEER_FALLOFF_CURVE);
      const maxSteer = MX.lerp(P.STEER_MAX_LOW, P.STEER_MAX_HIGH, speedT);
      const steerTarget = MX.clamp(controls.steer || 0, -1, 1) * maxSteer;
      const steerRate = (Math.abs(steerTarget) >= Math.abs(this.steerAngle))
        ? P.STEER_RATE : P.STEER_RETURN;
      this.steerAngle = MX.approach(this.steerAngle, steerTarget, steerRate * maxSteer / P.STEER_MAX_LOW * dt);
      const delta = this.steerAngle;

      /* ---- vertical load, including weight transfer and downforce ------- */
      const downforce = P.DOWNFORCE * speed * speed;
      const weight = P.MASS * g + downforce;
      const wb = this.wheelbase;
      let loadF = weight * P.AXLE_REAR / wb;
      let loadR = weight * P.AXLE_FRONT / wb;
      // Accelerating pushes load rearward, braking pushes it forward.
      const transfer = P.MASS * this.ax * P.CG_HEIGHT / wb;
      loadF = Math.max(200, loadF - transfer);
      loadR = Math.max(200, loadR + transfer);

      /* ---- longitudinal force ------------------------------------------ */
      let Flong = 0;
      const torque = 1 - P.TORQUE_FADE *
        Math.pow(MX.clamp(Math.abs(u) / P.TOP_SPEED, 0, 1), P.TORQUE_SHAPE);

      if (u < -0.5) {
        // Rolling backwards: throttle acts as the brake.
        Flong += throttle * P.BRAKE_FORCE * 0.8;
        if (u > -P.REVERSE_MAX) Flong -= brake * P.REVERSE_FORCE;
      } else {
        Flong += throttle * P.ENGINE_FORCE * torque;
        if (u > 0.6) Flong -= brake * P.BRAKE_FORCE;
        else Flong -= brake * P.REVERSE_FORCE;   // rolls into reverse
      }
      // Engine braking on lift-off, so coasting scrubs speed like you expect.
      if (throttle < 0.02 && u > 0.5) Flong -= P.ENGINE_BRAKE * MX.clamp(u / 6, 0, 1);
      if (handbrake) Flong -= MX.sign(u) * P.HANDBRAKE_DRAG;
      // Resistance.
      Flong -= P.DRAG * u * Math.abs(u);
      Flong -= P.ROLL_RESIST * u;
      Flong -= MX.sign(u) * surface.drag;

      const tractionForce = Flong;   // rear-wheel drive

      /* ---- tyre grip ----------------------------------------------------- */
      const surfGrip = surface.grip;
      let muF = P.GRIP_FRONT * surfGrip;
      let muR = P.GRIP_REAR * surfGrip;
      if (handbrake) muR *= P.HANDBRAKE_GRIP;
      // Power oversteer: standing on the throttle unsticks the rear.
      if (throttle > 0.4 && speed > 4) {
        muR *= 1 - P.DRIFT_THROTTLE_BOOST * (throttle - 0.4) / 0.6 *
               MX.clamp(1 - speed / (P.TOP_SPEED * 0.75), 0.25, 1);
      }
      /* Friction circle: force spent driving or braking is force the tyre
       * cannot spend cornering. */
      const longUse = MX.clamp(Math.abs(tractionForce) / (muR * loadR), 0, 1);
      muR *= Math.sqrt(Math.max(0.04, 1 - P.FRICTION_CIRCLE * longUse * longUse));
      if (brake > 0.05) {
        const brakeUse = MX.clamp(brake * P.BRAKE_FORCE * 0.45 / (muF * loadF), 0, 1);
        muF *= Math.sqrt(Math.max(0.15, 1 - P.FRICTION_CIRCLE * brakeUse * brakeUse));
      }

      /* ---- slip angles ---------------------------------------------------
       * Clamped denominator so the model stays sane at walking pace. */
      const uSafe = Math.max(Math.abs(u), 2.2);
      const slipF = Math.atan2(v + r * P.AXLE_FRONT, uSafe) - delta * MX.sign(u || 1);
      const slipR = Math.atan2(v - r * P.AXLE_REAR, uSafe);
      this.slipFront = slipF;
      this.slipRear = slipR;

      /* GRIP_ASSIST flattens the top of the grip curve so going slightly
       * over the limit does not instantly throw the car away. */
      const assist = (slip) =>
        1 + P.GRIP_ASSIST * (1 - MX.clamp(Math.abs(slip) / (P.SLIP_PEAK * 2), 0, 1));

      const Fyf = -muF * assist(slipF) * loadF *
        tyreCurve(slipF, P.TYRE_STIFF, P.TYRE_SHAPE);
      const Fyr = -muR * assist(slipR) * loadR *
        tyreCurve(slipR, P.TYRE_STIFF, P.TYRE_SHAPE);

      /* Fade the tyre model out at a crawl — below ~2 m/s the slip angles are
       * meaningless and the car would jitter. */
      const lowFade = MX.clamp(speed / 2.2, 0, 1);

      /* ---- integrate ------------------------------------------------------ */
      const ax = tractionForce / P.MASS;
      let ay = (Fyf * Math.cos(delta) + Fyr) / P.MASS * lowFade;

      let yawAcc = (P.AXLE_FRONT * Fyf * Math.cos(delta) - P.AXLE_REAR * Fyr)
        / P.YAW_INERTIA * lowFade;

      // Sideslip: how far the car is travelling sideways relative to its nose.
      const beta = Math.atan2(v, Math.max(Math.abs(u), 1));
      // Auto counter-steer: gently rotates the nose back toward the direction
      // of travel once the slide gets big. Recovery stays the driver's job,
      // this just makes it possible without perfect inputs.
      const excess = MX.clamp(Math.abs(beta) - 0.10, 0, 1.2);
      yawAcc += P.COUNTER_ASSIST * MX.sign(beta) * excess * MX.clamp(speed / 12, 0, 1);
      // Yaw damping, weighted toward slides so turn-in stays sharp.
      yawAcc -= P.SPIN_DAMP * r * (0.3 + 0.7 * MX.clamp(Math.abs(beta) / 0.4, 0, 1));

      this.u = u + (ax + v * r) * dt;
      this.v = v + (ay - u * r) * dt;
      this.r = MX.clamp(r + yawAcc * dt, -P.MAX_YAW_RATE, P.MAX_YAW_RATE);

      // Direct lateral damping — the "arcade planted" feel on top of the tyres.
      this.v -= this.v * MX.clamp(P.LATERAL_BLEED * surfGrip * dt, 0, 0.9);

      if (Math.abs(this.u) < 0.06 && throttle < 0.02 && speed < 0.5) {
        this.u = 0; this.v = 0; this.r *= 0.7;
      }

      this.yaw += this.r * dt;
      if (this.yaw > Math.PI) this.yaw -= MX.TAU;
      if (this.yaw < -Math.PI) this.yaw += MX.TAU;

      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      this.velX = this.u * s + this.v * c;
      this.velZ = this.u * c - this.v * s;
      this.x += this.velX * dt;
      this.z += this.velZ * dt;

      this.ax = ax;
      this.ay = ay;
      this.speed = Math.hypot(this.u, this.v);

      /* ---- derived values for the visuals -------------------------------- */
      // How sideways are we? Blend of rear slip and raw sideslip.
      const slipMag = Math.max(Math.abs(slipR) / (P.SLIP_PEAK * 1.9),
                               Math.abs(beta) / 0.45);
      this.driftAmount = MX.clamp(slipMag, 0, 1.35) *
                         MX.clamp(this.speed / 7, 0, 1);
      if (handbrake && this.speed > 5) this.driftAmount = Math.max(this.driftAmount, 0.75);

      // Body squat/dive and lean, critically damped toward the target angle.
      const pitchTarget = MX.clamp(-this.ax * P.PITCH_GAIN, -0.09, 0.09);
      const rollTarget = MX.clamp(this.ay * P.ROLL_GAIN, -0.12, 0.12);
      this.pitch = MX.damp(this.pitch, pitchTarget, P.BODY_DAMP, dt);
      this.roll = MX.damp(this.roll, rollTarget, P.BODY_DAMP, dt);

      // Wheels turn with road speed, plus a bit of spin-up when slipping.
      const spinBoost = 1 + this.driftAmount * 0.6 + throttle * longUse * 0.9;
      this.wheelSpin = (this.wheelSpin + (this.u / WHEEL_RADIUS) * spinBoost * dt) % MX.TAU;

      // A fake 6-speed box purely so the engine note and tacho have shape.
      const sr = MX.clamp(Math.abs(this.u) / P.TOP_SPEED, 0, 1);
      const gearF = sr * 6;
      this.gear = Math.min(6, Math.floor(gearF) + 1);
      this.rpm = MX.clamp(0.18 + (gearF - Math.floor(gearF)) * 0.78 +
                          this.driftAmount * 0.12 + throttle * 0.06, 0, 1);
      if (this.collisionFlash > 0) this.collisionFlash -= dt;
    }

    /* Add a world-space velocity change — barriers and car-to-car contact. */
    impulse(wx, wz) {
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      this.u += wx * s + wz * c;      // world -> body
      this.v += wx * c - wz * s;
      this.collisionFlash = 0.25;
    }

    /* Scrub forward speed off, as a wall scrape does. */
    scrub(factor) { this.u *= factor; }

    /* World-space velocity, for collision maths. */
    get worldVel() { return [this.velX, this.velZ]; }

    get kmh() { return this.speed * 3.6; }
    get wheelRadius() { return WHEEL_RADIUS; }
  }

  global.Car = Car;
  global.Car.WHEEL_RADIUS = WHEEL_RADIUS;
})(window);
