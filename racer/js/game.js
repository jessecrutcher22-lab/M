/* game.js — boot, the fixed-timestep loop, and (for now) the handling
 * playground: one car on a flat plane with reference markers so the driving
 * model can be judged on its own before any track exists. */
(function (global) {
  'use strict';

  const FIXED_DT = 1 / 120;      // physics runs at 120 Hz regardless of frame rate
  const MAX_FRAME = 0.25;

  const Game = {
    renderer: null, input: null, cam: null, hud: null, fx: null,
    car: null, env: null, meshes: {},
    running: false, time: 0, fps: 60, showDebug: true
  };

  /* ------------------------------------------------------- scene assembly */

  /* A big two-tone plane. The checker is what makes speed readable when there
   * is no track and no scenery yet. */
  function buildGround(env, extent, cell) {
    const b = new Geom.Builder();
    const n = Math.round(extent / cell);
    for (let i = -n; i < n; i++) {
      for (let j = -n; j < n; j++) {
        const x0 = i * cell, z0 = j * cell;
        const c = ((i + j) & 1) ? env.groundA : env.groundB;
        // Wound counter-clockwise seen from above so the normal points +Y.
        b.quad([x0, 0, z0], [x0, 0, z0 + cell],
               [x0 + cell, 0, z0 + cell], [x0 + cell, 0, z0], c);
      }
    }
    return b.build();
  }

  /* A strip of tarmac with dashes. Something to judge speed and braking
   * distance against while the handling is being tuned. */
  function buildStrip() {
    const b = new Geom.Builder();
    const road = [0.20, 0.205, 0.225], line = [0.90, 0.90, 0.86];
    const halfW = 13, z0 = -420, z1 = 980;
    b.quad([-halfW, 0.02, z0], [-halfW, 0.02, z1], [halfW, 0.02, z1], [halfW, 0.02, z0], road);
    for (const sx of [-1, 1]) {
      const x = sx * (halfW - 0.55);
      b.quad([x - 0.16, 0.03, z0], [x - 0.16, 0.03, z1], [x + 0.16, 0.03, z1], [x + 0.16, 0.03, z0], line);
    }
    // Centre dashes every 22 m: the main speed cue.
    for (let z = z0; z < z1; z += 22) {
      b.quad([-0.20, 0.03, z], [-0.20, 0.03, z + 9], [0.20, 0.03, z + 9], [0.20, 0.03, z], line);
    }
    // Distance boards every 100 m so braking can be measured by eye.
    for (let z = 100; z < 900; z += 100) {
      const n = Math.round(z / 100);
      for (let k = 0; k < n; k++) {
        b.box(halfW + 2.2, 1.5, z + k * 0.9, 0.16, 1.9, 0.55, k % 2 ? line : [0.85, 0.15, 0.2]);
      }
    }
    return b.build();
  }

  function buildPylon() {
    const b = new Geom.Builder();
    b.cylinderY(0, 0, 0, 0.42, 0.42, 0.12, 8, [0.14, 0.14, 0.16]);
    b.cone(0, 0.10, 0, 0.30, 1.0, 8, [1.0, 0.42, 0.10]);
    b.cylinderY(0, 0.52, 0, 0.19, 0.17, 0.16, 8, [0.96, 0.96, 0.96]);
    return b.build();
  }

  function buildGate() {
    const b = new Geom.Builder();
    const post = [0.85, 0.86, 0.90], stripe = [0.10, 0.10, 0.13];
    b.box(-7, 3.2, 0, 0.7, 6.4, 0.7, post);
    b.box(7, 3.2, 0, 0.7, 6.4, 0.7, post);
    b.box(0, 6.9, 0, 15.4, 1.5, 0.6, stripe);
    for (let i = -7; i <= 7; i += 2) b.box(i, 6.9, 0.32, 1, 1.5, 0.04, i % 4 === 0 ? post : stripe);
    return b.build();
  }

  function buildPlayground() {
    const R = Game.renderer;
    const env = Game.env;
    const M = Game.meshes;

    M.ground = R.createMesh(buildGround(env, 900, 18), { capacity: 1 });
    M.ground.add(MX.compose(MX.m4(), 0, 0, 0, 0, 1, 1, 1), 1, 1, 1, 0);
    M.ground.freeze();

    /* Reference markers: a grid to judge speed, a slalom to judge turn-in,
     * and a big circle to judge steady-state grip and drift. */
    M.strip = R.createMesh(buildStrip(), { capacity: 1 });
    M.strip.add(MX.compose(MX.m4(), 0, 0, 0, 0, 1, 1, 1), 1, 1, 1, 0);
    M.strip.freeze();

    M.pylon = R.createMesh(buildPylon(), { capacity: 512 });
    const m = MX.m4();
    for (let i = -6; i <= 6; i++) {
      for (let j = -6; j <= 6; j++) {
        if (Math.abs(i) < 2 && Math.abs(j) < 2) continue;
        M.pylon.add(MX.compose(m, i * 70, 0, j * 70, 0, 1, 1, 1), 1, 1, 1, 0);
      }
    }
    for (let i = 0; i < 14; i++) {          // slalom, 34 m apart
      M.pylon.add(MX.compose(m, (i % 2 ? 7 : -7), 0, 60 + i * 34, 0, 1, 1, 1), 0.6, 0.9, 1.4, 0);
    }
    for (let i = 0; i < 36; i++) {          // 55 m radius skid pad
      const a = (i / 36) * MX.TAU;
      M.pylon.add(MX.compose(m, -180 + Math.cos(a) * 55, 0, Math.sin(a) * 55, 0, 1, 1, 1), 1.4, 0.7, 0.7, 0);
    }
    M.pylon.freeze();

    M.gate = R.createMesh(buildGate(), { capacity: 2 });
    M.gate.add(MX.compose(m, 0, 0, 30, 0, 1, 1, 1), 1, 1, 1, 0);
    M.gate.freeze();

    // Car meshes for the currently selected car.
    const spec = TUNE.CARS[Game.carIndex];
    M.body = R.createMesh(CarModel.buildBody(spec), { capacity: 8 });
    M.lights = R.createMesh(CarModel.buildLights(spec), { capacity: 8 });
    M.wheel = R.createMesh(CarModel.buildWheel(), { capacity: 32 });
  }

  /* Push the car's transforms into the instance buffers. */
  const _m = MX.m4(), _w = MX.m4(), _l = MX.m4();
  function drawCar(car, tint, emis) {
    const M = Game.meshes;
    const P = car.P;
    // A little ride height movement so the body is never rigid.
    const ride = car.y - MX.clamp(car.ax * 0.004, -P.SUSPENSION_TRAVEL, P.SUSPENSION_TRAVEL);
    MX.composeCar(_m, car.x, ride, car.z, car.yaw, car.pitch, car.roll);
    M.body.add(_m, tint[0], tint[1], tint[2], 0);
    M.lights.add(_m, 1, 1, 1, emis === undefined ? 0.55 : emis);

    const hw = car.spec.shape.w * CarModel.TRACK;
    const axles = [
      [P.AXLE_FRONT, car.steerAngle], [-P.AXLE_REAR, 0]
    ];
    for (const [az, steer] of axles) {
      for (const side of [-1, 1]) {
        MX.composeCar(_l, side * hw, Car.WHEEL_RADIUS - car.y, az, steer, -car.wheelSpin, 0);
        MX.multiply(_w, _m, _l);
        M.wheel.add(_w, 1, 1, 1, 0);
      }
    }
  }

  /* ------------------------------------------------------------ the loop */

  let lastT = 0, acc = 0, fpsAcc = 0, fpsN = 0;

  function frame(t) {
    if (!Game.running) return;
    requestAnimationFrame(frame);
    const now = t / 1000;
    let dt = lastT ? Math.min(now - lastT, MAX_FRAME) : FIXED_DT;
    lastT = now;

    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.4) { Game.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }

    const ctrl = Game.input.update(dt);

    acc += dt;
    let steps = 0;
    while (acc >= FIXED_DT && steps < 8) { step(FIXED_DT, ctrl); acc -= FIXED_DT; steps++; }
    if (steps === 8) acc = 0;      // never spiral if the tab was backgrounded

    render(dt, ctrl);
    Game.input.endFrame();
  }

  function step(dt, ctrl) {
    Game.time += dt;
    Game.car.update(dt, ctrl, { grip: 1, drag: 0 });
  }

  function render(dt, ctrl) {
    const R = Game.renderer;
    R.resize(2);

    Game.cam.update(dt, Game.car);
    Game.fx.update(dt, [Game.car], Game.cam, 0.02);

    const M = Game.meshes;
    M.body.reset(); M.lights.reset(); M.wheel.reset();
    drawCar(Game.car, CarModel.hex(Game.car.spec.body), Game.car.speed > 1 ? 0.5 : 0.9);

    R.render(Game.cam, Game.env);

    Game.hud.update(Game.car, null);
    if (Game.showDebug) {
      const c = Game.car;
      Game.hud.setDebug(
        'fps      ' + Game.fps.toFixed(0) + '\n' +
        'speed    ' + c.kmh.toFixed(0) + ' km/h  (' + c.speed.toFixed(1) + ' m/s)\n' +
        'top      ' + (c.topSpeed * 3.6).toFixed(0) + ' km/h\n' +
        'slip R   ' + (c.slipRear * 57.3).toFixed(1) + '°\n' +
        'drift    ' + c.driftAmount.toFixed(2) + '\n' +
        'yaw rate ' + c.r.toFixed(2) + ' rad/s\n' +
        'steer    ' + (c.steerAngle * 57.3).toFixed(1) + '°\n' +
        'lat a    ' + (c.ay / 9.81).toFixed(2) + ' g\n' +
        'long a   ' + (c.ax / 9.81).toFixed(2) + ' g\n' +
        '[C] camera  [R] reset  [F1] hide');
    } else {
      Game.hud.setDebug('');
    }

    handleHotkeys(ctrl);
  }

  function handleHotkeys(ctrl) {
    const I = Game.input;
    if (I.tapped('camera')) Game.cam.cycleMode();
    if (I.tappedCode('F1')) Game.showDebug = !Game.showDebug;
    if (I.tappedCode('Digit1')) selectCar(0);
    if (I.tappedCode('Digit2')) selectCar(1);
    if (I.tappedCode('Digit3')) selectCar(2);
    if (I.tappedCode('Digit4')) selectCar(3);
    if (ctrl.resetHeld > 0 || I.tapped('reset')) respawn();
  }

  function respawn() {
    Game.car.reset(0, 0, 0);
    Game.cam.snapTo(Game.car);
    Game.fx.reset();
  }

  /* Swap the car model live — handy while tuning. */
  function selectCar(i) {
    if (i === Game.carIndex) return;
    Game.carIndex = i;
    const spec = TUNE.CARS[i];
    const R = Game.renderer, M = Game.meshes;
    R.removeMesh(M.body);
    R.removeMesh(M.lights);
    M.body = R.createMesh(CarModel.buildBody(spec), { capacity: 8 });
    M.lights = R.createMesh(CarModel.buildLights(spec), { capacity: 8 });

    const keep = { x: Game.car.x, z: Game.car.z, yaw: Game.car.yaw };
    Game.car = new Car(spec, { isPlayer: true });
    Game.car.reset(keep.x, keep.z, keep.yaw);
    Game.fx.emitters.clear();
    Game.fx.trackCar(Game.car, { quality: 1 });
    Game.hud.banner(spec.name, '#00e5ff');
  }

  /* ---------------------------------------------------------------- boot */

  function boot(canvas) {
    Game.renderer = new GL.Renderer(canvas);
    Game.renderer.resize(2);
    Game.input = new Input();
    Game.hud = new UI.HUD();
    Game.cam = new ChaseCamera();
    Game.env = Scene.env('test');
    Game.carIndex = 0;

    buildPlayground();
    Game.fx = new Effects(Game.renderer);

    Game.car = new Car(TUNE.CARS[0], { isPlayer: true });
    Game.car.reset(0, 0, 0);
    Game.fx.trackCar(Game.car, { quality: 1 });
    Game.cam.snapTo(Game.car);

    Game.hud.show(true);
    Game.hud.banner('STEP 1 &mdash; HANDLING PLAYGROUND<br><span style="font-size:.42em;letter-spacing:.3em;opacity:.7">' +
      'WASD / ARROWS &nbsp; SPACE = HANDBRAKE &nbsp; 1-4 = SWAP CAR &nbsp; C = CAMERA</span>', '#ffc734');

    Game.running = true;
    requestAnimationFrame(frame);

    window.addEventListener('resize', () => Game.renderer.resize(2));
    document.addEventListener('visibilitychange', () => { lastT = 0; acc = 0; });
  }

  global.Game = Game;
  global.Game.boot = boot;
})(window);
