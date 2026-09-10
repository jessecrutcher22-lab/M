/* tune.js — EVERY number that decides how the game feels lives in this file.
 * Units are metres, seconds, radians, newtons, kilograms.
 * Handy conversions:  1 m/s = 3.6 km/h.  70 m/s = 252 km/h.
 *
 * If you only want to tweak one thing, try GRIP_FRONT / GRIP_REAR (how
 * planted the car is) or STEER_MAX_LOW (how sharp it turns at low speed). */
(function (global) {
  'use strict';

  const PHYS = {
    /* ---- chassis -------------------------------------------------------
     * The car is simulated as a "bicycle": one front tyre, one rear tyre.
     * That is the standard arcade-racing model — cheap, stable, and it
     * produces real slip angles, so drift and counter-steer come out of the
     * physics rather than being faked. */
    MASS: 1150,             // kg. Lower = twitchier, higher = more inertia.
    AXLE_FRONT: 1.42,       // m, centre of mass -> front axle
    AXLE_REAR: 1.45,        // m, centre of mass -> rear axle
    YAW_INERTIA: 1500,      // kg*m^2. LOWER = the car rotates more eagerly.
    CG_HEIGHT: 0.52,        // m. Drives weight transfer under power/braking.
    GRAVITY: 9.81,

    /* ---- engine & brakes -------------------------------------------------
     * TOP_SPEED and ENGINE_FORCE are deliberately independent knobs:
     *   ENGINE_FORCE  = how hard it launches (accel)
     *   TOP_SPEED     = where it stops pulling (aero drag is derived from it)
     * Change one without disturbing the other. */
    TOP_SPEED: 68,          // m/s (~245 km/h)
    ENGINE_FORCE: 9700,     // N at full throttle, before the torque curve.
    TORQUE_FADE: 0.62,      // Fraction of the push lost by top speed (0..1).
    TORQUE_SHAPE: 1.55,     // >1 keeps low-end punch, then falls away fast.
    BRAKE_FORCE: 16000,     // N. Arcade-strong: stops hard, stays controllable.
    REVERSE_FORCE: 5200,    // N
    REVERSE_MAX: 13,        // m/s cap when going backwards
    ENGINE_BRAKE: 1400,     // N of drag when you lift off the throttle

    /* ---- resistance ------------------------------------------------------
     * Aero drag is SOLVED from TOP_SPEED at load time, so you never have to
     * hand-balance the two:  DRAG = (F*(1-FADE) - ROLL*Vmax) / Vmax^2  */
    ROLL_RESIST: 12,        // N per (m/s) — matters most at low speed

    /* ---- tyres -----------------------------------------------------------
     * Lateral force uses a simplified Pacejka curve:
     *     F = load * mu * sin(SHAPE * atan(STIFF * slipAngle))
     * It rises steeply, peaks, then falls off — the fall-off is what makes a
     * slide keep sliding until you back off, which is the fun part. */
    GRIP_FRONT: 1.28,       // mu. Higher = the nose bites harder. ~1.3 gives
                            // about 1.5 g of cornering: grippy, but you can
                            // still feel and pass the limit.
    GRIP_REAR: 1.20,        // mu. Slightly below front = friendly oversteer.
    TYRE_STIFF: 9.5,        // How quickly grip builds with slip angle.
    TYRE_SHAPE: 1.62,       // Curve shape. ~1.6 gives a clear peak then fade.
    SLIP_PEAK: 0.16,        // rad (~9deg). Slip past this = you are drifting.

    /* Longitudinal force eats into the tyre's lateral budget (friction
     * circle). This is what lets you power-slide out of a slow corner. */
    FRICTION_CIRCLE: 0.85,  // 0 = no interaction, 1 = strict circle.

    /* ---- downforce -------------------------------------------------------
     * Fake aero load so the car is calm at 250 km/h but still loose at 80. */
    DOWNFORCE: 1.35,        // N per (m/s)^2, split front/rear

    /* ---- steering --------------------------------------------------------
     * The steering lock shrinks with speed. Without this the car is
     * undriveable on a straight at 250 km/h. */
    /* Lock is deliberately close to what the front tyres can actually use.
     * Give the car much more than this and the last third of the steering
     * travel does nothing, because the fronts are already past their peak
     * slip — which reads as vague, dead steering. */
    STEER_MAX_LOW: 0.46,    // rad (~26deg) of lock at a standstill
    /* Do not shrink the high-speed lock too far: catching a slide needs real
     * counter-lock, and a car that cannot counter-steer at 170 km/h simply
     * spins. This is the headroom, not the cornering lock. */
    STEER_MAX_HIGH: 0.130,  // rad (~7.4deg) of lock at STEER_FALLOFF_SPEED
    STEER_FALLOFF_SPEED: 55,// m/s at which the lock has fully shrunk
    STEER_FALLOFF_CURVE: 0.75, // <1 = tightens up early, >1 = late
    STEER_RATE: 6.2,        // rad/s the wheels turn toward your input
    STEER_RETURN: 9.0,      // rad/s they snap back to centre when you let go

    /* ---- handbrake -------------------------------------------------------
     * Space kills most of the rear grip. Tap it to snap the tail out, hold it
     * to keep a long drift going. */
    HANDBRAKE_GRIP: 0.30,   // rear mu multiplier while held
    HANDBRAKE_DRAG: 5200,   // N of extra slowing

    /* ---- arcade assists --------------------------------------------------
     * The bits that separate "fun in 5 seconds" from "simulator". */
    COUNTER_ASSIST: 2.6,    // Auto counter-steer torque during a real slide
                            // (rear tyre past its peak, not just any corner).
                            // 0 = raw and spinny, 4 = almost drives itself.
    GRIP_ASSIST: 0.22,      // Extra mu while you are near the grip limit, so
                            // small mistakes do not end the lap.
    LATERAL_BLEED: 1.1,     // Direct sideways-velocity damping (1/s). Makes
                            // the car feel planted rather than on ice.
    DRIFT_THROTTLE_BOOST: 0.30, // Extra rear slip when you are hard on the
                            // throttle mid-corner — power oversteer.
    /* Yaw-rate damping. This is the single most important number for how
     * SETTLED the steering feels. The bicycle model has an under-damped
     * yaw/sideslip mode: too little damping and the car hunts under a
     * steady steering input — it bites, washes out, bites again, which reads
     * as vague, rubbery steering. Turn-in sharpness is tyre-limited, not
     * damping-limited, so raising this costs nothing off the initial turn;
     * it only trims how far the car will hang out in a slide.
     *   2.0 = loose and lively   3.0 = planted and precise   */
    SPIN_DAMP: 2.8,
    MAX_YAW_RATE: 3.2,      // rad/s hard cap, so you can never helicopter.

    /* ---- body movement (cosmetic, but it sells the weight) -------------- */
    PITCH_GAIN: 0.010,      // rad per m/s^2 of longitudinal accel (squat/dive)
    ROLL_GAIN: 0.016,       // rad per m/s^2 of lateral accel (body lean)
    BODY_DAMP: 9.0,         // How fast the body settles
    SUSPENSION_TRAVEL: 0.06,// m of visual ride-height movement

    /* ---- off-track penalty ---------------------------------------------- */
    OFFTRACK_GRIP: 0.62,    // mu multiplier on grass/dirt
    OFFTRACK_DRAG: 2600,    // N of extra rolling drag off the racing surface
    WALL_BOUNCE: 0.35,      // How much speed you keep off a barrier
    WALL_SCRUB: 0.55        // How much forward speed a wall scrape costs
  };

  /* ---- camera ------------------------------------------------------------
   * The camera lags behind the car and pulls back as you go faster. That lag
   * is most of the reason a slow car can still feel fast. */
  const CAM = {
    HEIGHT: 2.70,           // m above the car
    DISTANCE: 7.30,         // m behind at a standstill
    DISTANCE_SPEED: 3.2,    // extra m of pull-back at top speed
    LOOK_AHEAD: 8.2,        // m in front of the car that the camera aims at
    LAG: 7.2,               // position follow rate (1/s). Lower = floatier.
    YAW_LAG: 5.4,           // heading follow rate. Lower = more drift drama.
    DRIFT_OFFSET: 0.55,     // how much the camera swings wide in a slide
    FOV_BASE: 60,           // degrees at a standstill
    FOV_SPEED: 22,          // extra degrees at top speed — the speed rush
    FOV_LAG: 3.4,
    ROLL: 0.38,             // how much the camera leans into a corner (0 = none)
    SHAKE_START: 38,        // m/s before any screen shake kicks in
    SHAKE_AMOUNT: 0.055,    // m of shake at top speed
    SHAKE_FREQ: 24
  };

  /* ---- effects ----------------------------------------------------------- */
  const FX = {
    SKID_THRESHOLD: 0.22,   // tyre slip (0..1) before marks are laid down
    SKID_LIFETIME: 9.0,     // s before a mark fades away
    SKID_MAX_SEGMENTS: 900, // ring buffer size per car
    SKID_WIDTH: 0.30,
    SKID_ALPHA: 0.55,
    SMOKE_RATE: 46,         // puffs per second at full slide
    SMOKE_LIFE: 1.05,       // s
    SMOKE_RISE: 1.6,        // m/s upward drift
    SMOKE_GROW: 1.15,       // m/s of expansion
    SMOKE_MAX: 260
  };

  /* ---- the roster --------------------------------------------------------
   * Each car overrides the shared PHYS values above. The stat bars in the
   * menu are 0..10 and are hand-set to match how the car actually drives. */
  const CARS = [
    {
      id: 'bolt',
      name: 'BOLT GT',
      tagline: 'Balanced. Does everything well, nothing badly.',
      body: '#e63946', accent: '#ffd166', glass: '#1d2b3a',
      shape: { w: 0.94, l: 2.18, roof: 0.74, nose: 0.80, wing: 0.55 },
      phys: {
        TOP_SPEED: 68, ENGINE_FORCE: 9700,     // 245 km/h, 0-100 in ~3.4s
        GRIP_FRONT: 1.28, GRIP_REAR: 1.20,
        MASS: 1150, YAW_INERTIA: 1500, SPIN_DAMP: 2.8,
        STEER_MAX_LOW: 0.46, STEER_RATE: 6.2
      },
      stats: { speed: 7, accel: 7, grip: 7, handling: 7 }
    },
    {
      id: 'vypr',
      name: 'VYPR X',
      tagline: 'Ballistic on the straights. Respect the corners.',
      body: '#f4a300', accent: '#2b2118', glass: '#1a1410',
      shape: { w: 0.99, l: 2.34, roof: 0.66, nose: 0.66, wing: 0.85 },
      phys: {
        TOP_SPEED: 80.5, ENGINE_FORCE: 9750,   // 290 km/h, but heavy off the line
        GRIP_FRONT: 1.17, GRIP_REAR: 1.12,
        MASS: 1320, YAW_INERTIA: 1900, SPIN_DAMP: 3.0,
        STEER_MAX_LOW: 0.40, STEER_RATE: 5.2,
        DOWNFORCE: 1.6
      },
      stats: { speed: 10, accel: 6, grip: 5, handling: 5 }
    },
    {
      id: 'kite',
      name: 'KITE R',
      tagline: 'Featherweight. Glued down, changes direction instantly.',
      body: '#2ec4b6', accent: '#f7f7f7', glass: '#16323a',
      shape: { w: 0.87, l: 1.98, roof: 0.82, nose: 0.86, wing: 0.30 },
      phys: {
        TOP_SPEED: 58, ENGINE_FORCE: 10250,    // 209 km/h, 0-100 in ~2.6s
        GRIP_FRONT: 1.29, GRIP_REAR: 1.23,
        MASS: 940, YAW_INERTIA: 1140, SPIN_DAMP: 3.2,   // precise, hard to unsettle
        STEER_MAX_LOW: 0.53, STEER_RATE: 7.6,
        LATERAL_BLEED: 1.5
      },
      stats: { speed: 5, accel: 8, grip: 10, handling: 9 }
    },
    {
      id: 'onyx',
      name: 'ONYX RS',
      tagline: 'Loose rear, huge power. Built to be sideways.',
      body: '#7b5cff', accent: '#12101c', glass: '#150f2a',
      shape: { w: 0.96, l: 2.24, roof: 0.70, nose: 0.74, wing: 0.95 },
      phys: {
        TOP_SPEED: 71, ENGINE_FORCE: 12600,    // 256 km/h, brutal launch
        GRIP_FRONT: 1.42, GRIP_REAR: 1.21,     // front/rear split = drift, but
                                               // not so wide it just spins
        MASS: 1210, YAW_INERTIA: 1380, SPIN_DAMP: 2.5,   // loose: hangs out in a slide
        STEER_MAX_LOW: 0.50, STEER_RATE: 6.8,
        DRIFT_THROTTLE_BOOST: 0.52,
        COUNTER_ASSIST: 3.1
      },
      stats: { speed: 8, accel: 10, grip: 6, handling: 8 }
    }
  ];

  /* AI personalities. Each opponent picks one — they are what stop the pack
   * from driving like a train of clones. */
  const AI_DRIVERS = [
    { name: 'RIVERA',  skill: 0.95, aggression: 0.85, mistake: 0.20, lineBias:  0.10 },
    { name: 'KOVACS',  skill: 0.90, aggression: 0.55, mistake: 0.32, lineBias: -0.22 },
    { name: 'TANAKA',  skill: 0.98, aggression: 0.40, mistake: 0.14, lineBias:  0.00 },
    { name: 'DUVAL',   skill: 0.86, aggression: 0.95, mistake: 0.45, lineBias:  0.26 },
    { name: 'OSEI',    skill: 0.92, aggression: 0.70, mistake: 0.26, lineBias: -0.12 },
    { name: 'BRENNAN', skill: 0.88, aggression: 0.62, mistake: 0.38, lineBias:  0.18 }
  ];

  const RACE = {
    LAPS: 3,
    OPPONENTS: 5,
    COUNTDOWN: 3.6,         // s of "3 2 1 GO"
    /* Rubber-banding keeps the pack close without being obvious. */
    RUBBER_AHEAD: 0.87,     // power multiplier for AI well ahead of you
    RUBBER_BEHIND: 1.19,    // power multiplier for AI well behind you
    RUBBER_RANGE: 330,      // m of gap over which the multiplier ramps
    RESET_HOLD: 0.35        // s you must hold R before the car is respawned
  };

  global.TUNE = { PHYS, CAM, FX, CARS, AI_DRIVERS, RACE };
})(window);
