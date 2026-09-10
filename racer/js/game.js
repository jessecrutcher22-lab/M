/* game.js — boot, the fixed-timestep loop, and the game state machine:
 * car select -> track select -> race -> results. */
(function (global) {
  'use strict';

  const FIXED_DT = 1 / 120;      // physics runs at 120 Hz whatever the frame rate
  const MAX_FRAME = 0.25;

  const Game = {
    renderer: null, input: null, touch: null, cam: null, hud: null, menu: null,
    fx: null, env: null, meshes: {}, world: null,
    path: null, race: null, racers: [], ai: [],
    state: 'boot', running: false, fps: 60, showDebug: false,
    carIndex: 0, trackIndex: 0, quality: 1, mobile: false
  };

  /* =============================================================== world */

  function clearWorld() {
    Game.renderer.clearScene();
    Game.meshes = {};
    Game.fx = null;
  }

  function buildWorld(def) {
    const R = Game.renderer;
    clearWorld();

    Game.path = new TrackPath(def);
    Game.env = Scene.env(def.env);
    const M = Game.meshes;
    const id = MX.compose(MX.m4(), 0, 0, 0, 0, 1, 1, 1);

    const still = (geo) => {
      const m = R.createMesh(geo, { capacity: 1 });
      m.add(id, 1, 1, 1, 0);
      m.freeze();
      return m;
    };

    M.road = still(TrackMesh.buildSurface(Game.path, def));
    M.barrier = still(TrackMesh.buildBarriers(Game.path, def));

    const sNode = Game.path.nodeAt(Game.path.startS);
    M.gantry = R.createMesh(TrackMesh.buildGantry(Game.path, def), { capacity: 1 });
    M.gantry.add(MX.compose(MX.m4(), sNode.x, sNode.y, sNode.z, sNode.yaw, 1, 1, 1), 1, 1, 1, 0);
    M.gantry.freeze();

    if (Game.quality > 0.4) Scenery.build(R, Game.path, def, Game.env);

    /* One body/lights mesh per car model; colour comes from the instance
     * tint, so six cars still cost only a handful of draw calls. */
    M.bodies = TUNE.CARS.map(spec => R.createMesh(CarModel.buildBody(spec), { capacity: 8 }));
    M.lightSets = TUNE.CARS.map(spec => R.createMesh(CarModel.buildLights(spec), { capacity: 8 }));
    M.wheel = R.createMesh(CarModel.buildWheel(), { capacity: 40 });

    Game.fx = new Effects(R);
    Game.world = def;
  }

  /* Distinct liveries for the AI so you can tell rivals apart at a glance. */
  const AI_COLOURS = ['#3d7bff', '#39d98a', '#ff8c42', '#c65cff', '#f2f2f2', '#ff4d6d'];

  function buildField(def) {
    const R = TUNE.RACE;
    Game.racers = [];
    Game.ai = [];

    const playerSpec = TUNE.CARS[Game.carIndex];
    const pcar = new Car(playerSpec, { isPlayer: true });
    const player = new Racer(pcar, {
      name: 'YOU', isPlayer: true, colour: playerSpec.body
    });
    player.specIndex = Game.carIndex;
    Game.racers.push(player);
    Game.player = player;

    for (let i = 0; i < R.OPPONENTS; i++) {
      const p = TUNE.AI_DRIVERS[i % TUNE.AI_DRIVERS.length];
      // Give rivals a spread of machinery, never the player's exact car.
      const si = (Game.carIndex + 1 + i) % TUNE.CARS.length;
      const car = new Car(TUNE.CARS[si], {});
      const r = new Racer(car, { name: p.name, colour: AI_COLOURS[i % AI_COLOURS.length] });
      r.specIndex = si;
      r.personality = p;
      Game.racers.push(r);
    }

    Game.race = new Race(Game.path, def, Game.racers, { laps: R.LAPS });

    for (const r of Game.racers) {
      if (r.isPlayer) continue;
      r.ai = new AIDriver(r, Game.path, r.personality);
      Game.ai.push(r.ai);
    }

    for (const r of Game.racers) Game.fx.trackCar(r.car);
  }

  /* ================================================================ draw */

  const _m = MX.m4(), _w = MX.m4(), _l = MX.m4();

  function drawCar(r) {
    const M = Game.meshes;
    const car = r.car;
    const P = car.P;
    const tint = CarModel.hex(r.colour);
    MX.composeCar(_m, car.x, car.y, car.z, car.yaw, car.pitch, car.roll);
    M.bodies[r.specIndex].add(_m, tint[0], tint[1], tint[2], car.collisionFlash > 0 ? 0.5 : 0);

    // Lights glow at night, and the brake lights come on when you ask them to.
    const night = Game.env.night ? 0.9 : 0.3;
    const braking = car.speed > 1 && r.brakeLight ? 1.4 : 0;
    M.lightSets[r.specIndex].add(_m, 1, 1, 1, night + braking);

    const hw = car.spec.shape.w * CarModel.TRACK;
    for (const [az, steer] of [[P.AXLE_FRONT, car.steerAngle], [-P.AXLE_REAR, 0]]) {
      for (const side of [-1, 1]) {
        MX.composeCar(_l, side * hw, Car.WHEEL_RADIUS, az, steer, -car.wheelSpin, 0);
        MX.multiply(_w, _m, _l);
        M.wheel.add(_w, 1, 1, 1, 0);
      }
    }
  }

  function drawScene(dt) {
    const R = Game.renderer;
    const M = Game.meshes;
    if (!M.wheel) return;
    for (const b of M.bodies) b.reset();
    for (const l of M.lightSets) l.reset();
    M.wheel.reset();
    for (const r of Game.racers) drawCar(r);
    R.render(Game.cam, Game.env);
  }

  /* ================================================================ loop */

  let lastT = 0, acc = 0, fpsAcc = 0, fpsN = 0, qualityTimer = 0;

  function frame(t) {
    if (!Game.running) return;
    requestAnimationFrame(frame);
    const now = t / 1000;
    let dt = lastT ? Math.min(now - lastT, MAX_FRAME) : FIXED_DT;
    lastT = now;

    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { Game.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; autoQuality(dt); }

    const ctrl = Game.input.update(dt);
    if (Game.touch) Game.touch.apply(ctrl, dt);

    if (Game.state === 'race') {
      acc += dt;
      let steps = 0;
      while (acc >= FIXED_DT && steps < 8) { stepRace(FIXED_DT, ctrl); acc -= FIXED_DT; steps++; }
      if (steps === 8) acc = 0;
      updateRaceView(dt, ctrl);
    } else if (Game.state === 'menu' && Game.path) {
      // Slow orbit of the circuit behind the menus.
      orbit(dt);
    }

    if (Game.path) drawScene(dt);
    hotkeys(ctrl);
    Game.input.endFrame();
  }

  function stepRace(dt, ctrl) {
    const race = Game.race;
    for (const r of Game.racers) {
      const wanted = r.isPlayer ? ctrl : r.ai.update(dt, race);
      const c = race.controlsFor(r, wanted);
      r.brakeLight = c.brake > 0.05;
      r.car.update(dt, c, race.surfaceFor(r));
    }
    race.step(dt);
  }

  function updateRaceView(dt, ctrl) {
    const race = Game.race;
    const p = Game.player;
    const car = p.car;

    Game.cam.update(dt, car, { rough: p.offTrack ? 1 : 0 });
    Game.fx.update(dt, Game.racers.map(r => r.car), Game.cam, 0.03);

    for (const e of race.drainEvents()) onRaceEvent(e);

    if (race.state === 'countdown') {
      const n = Math.ceil(race.countdown - 0.6);
      Game.hud.setCountdown(n > 0 ? String(n) : 'GO!', n <= 0);
    } else {
      Game.hud.setCountdown('');
    }

    Game.hud.update(car, race.hudFor(p));

    if (ctrl.resetHeld > TUNE.RACE.RESET_HOLD) {
      race.respawn(p);
      Game.cam.snapTo(car);
      ctrl.resetHeld = 0;
    }

    if (race.state === 'finished' && !Game.resultsShown) {
      Game.resultsShown = true;
      setTimeout(showResults, 1600);
    }
    if (Game.showDebug) debugText();
  }

  function onRaceEvent(e) {
    if (e.type === 'wall' && e.racer.isPlayer) Game.cam.kick(e.force);
    if (e.type === 'contact' && e.racer.isPlayer) Game.cam.kick(0.25);
    if (!e.racer.isPlayer) return;
    if (e.type === 'bestlap') {
      Game.hud.banner('LAP ' + (e.racer.lap - 1) + ' &nbsp; ' + UI.fmtTime(e.time) +
        '<br><span style="font-size:.45em;letter-spacing:.3em;color:#00e5ff">FASTEST LAP</span>', '#fff');
    } else if (e.type === 'lap') {
      Game.hud.banner('LAP ' + (e.racer.lap - 1) + ' &nbsp; ' + UI.fmtTime(e.time), '#fff');
    } else if (e.type === 'finish') {
      Game.hud.banner('FINISH &nbsp; ' + UI.ordinal(e.racer.position), '#ffc734');
    }
  }

  /* A lazy camera circuit of the track, used behind the menus. */
  let orbitS = 0;
  function orbit(dt) {
    orbitS = (orbitS + dt * 46) % Game.path.length;
    const a = Game.path.sample(orbitS, 0, {});
    const b = Game.path.sample(orbitS + 70, 0, {});
    Game.cam.x = a.x - Math.sin(a.yaw) * 26; Game.cam.z = a.z - Math.cos(a.yaw) * 26;
    Game.cam.y = a.y + 11;
    Game.cam.tx = b.x; Game.cam.ty = b.y + 1; Game.cam.tz = b.z;
    Game.cam.ux = 0; Game.cam.uy = 1; Game.cam.uz = 0;
    Game.cam.fov = 55;
  }

  /* Drop scenery and effects if the device cannot hold a frame rate. */
  function autoQuality() {
    qualityTimer++;
    if (qualityTimer < 6) return;
    if (Game.fps < 34 && Game.quality > 0.35) {
      Game.quality = Math.max(0.35, Game.quality - 0.25);
      Game.renderer.maxDpr = Math.max(1, (Game.renderer.maxDpr || 2) - 0.5);
      qualityTimer = 0;
    }
  }

  function debugText() {
    const c = Game.player.car, p = Game.player;
    Game.hud.setDebug(
      'fps ' + Game.fps.toFixed(0) + '   q ' + Game.quality.toFixed(2) + '\n' +
      'kmh ' + c.kmh.toFixed(0) + '  load ' + c.cornerLoad.toFixed(2) + '\n' +
      's ' + p.s.toFixed(0) + '/' + Game.path.length.toFixed(0) +
      '  lat ' + p.lateral.toFixed(1) + '\n' +
      'cp ' + p.nextCp + '/' + Game.path.checkpoints.length + '  lap ' + p.lap);
  }

  /* =============================================================== menus */

  function statBars(stats) {
    const rows = [['SPEED', stats.speed], ['ACCEL', stats.accel],
                  ['GRIP', stats.grip], ['HANDLING', stats.handling]];
    return '<div class="bars">' + rows.map(([k, v]) =>
      '<div class="barrow"><span>' + k + '</span><span class="t"><i style="width:' +
      (v * 10) + '%"></i></span><span class="n">' + v + '</span></div>').join('') + '</div>';
  }

  /* A little top-down sketch of the circuit for the track cards. */
  function trackSvg(def, path) {
    const pts = path
      ? path.nodes.filter((n, i) => i % 3 === 0).map(n => [n.x, n.z])
      : def.points;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
    }
    const w = maxX - minX, h = maxZ - minZ, pad = 0.10 * Math.max(w, h);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + (p[0] - minX + pad).toFixed(1) + ' ' +
      (p[1] - minZ + pad).toFixed(1)).join(' ') + ' Z';
    const vb = [0, 0, w + pad * 2, h + pad * 2].join(' ');
    return '<svg class="map" viewBox="' + vb + '" preserveAspectRatio="xMidYMid meet">' +
      '<path d="' + d + '" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="' +
      (Math.max(w, h) * 0.055) + '" stroke-linejoin="round"/>' +
      '<path d="' + d + '" fill="none" stroke="' + def.accent + '" stroke-width="' +
      (Math.max(w, h) * 0.022) + '" stroke-linejoin="round"/>' +
      '<circle cx="' + (pts[0][0] - minX + pad).toFixed(1) + '" cy="' +
      (pts[0][1] - minZ + pad).toFixed(1) + '" r="' + (Math.max(w, h) * 0.035) +
      '" fill="#fff"/></svg>';
  }

  function buildMenus() {
    const menu = Game.menu;

    menu.define('car',
      '<div class="title">APEX <em>RUSH</em></div>' +
      '<div class="sub">CHOOSE YOUR CAR</div>' +
      '<div class="cards" id="carCards">' +
      TUNE.CARS.map((c, i) =>
        '<div class="card" data-i="' + i + '">' +
          '<div class="swatch" style="background:linear-gradient(90deg,' + c.body + ',' + c.accent + ')"></div>' +
          '<h3>' + c.name + '</h3><p>' + c.tagline + '</p>' + statBars(c.stats) +
        '</div>').join('') +
      '</div>' +
      '<div class="row"><button class="btn go" id="toTrack">CHOOSE TRACK</button>' +
      '<span class="hint" id="ctrlHint"></span></div>' +
      '<div class="keys">' +
      '<span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive</span>' +
      '<span><kbd>Space</kbd> handbrake</span><span><kbd>R</kbd> reset</span>' +
      '<span><kbd>C</kbd> camera</span><span>Gamepad supported</span></div>');

    menu.define('track',
      '<div class="title">SELECT <em>CIRCUIT</em></div>' +
      '<div class="sub">' + TUNE.RACE.LAPS + ' LAPS &middot; ' + (TUNE.RACE.OPPONENTS + 1) + ' CARS</div>' +
      '<div class="cards" id="trackCards">' +
      Tracks.list.map((t, i) => {
        const p = new TrackPath(t);
        return '<div class="card trackcard" data-i="' + i + '">' + trackSvg(t, p) +
          '<h3>' + t.name + '</h3><p>' + t.blurb + '</p>' +
          '<div class="meta"><span>' + (p.length / 1000).toFixed(2) + ' KM</span>' +
          '<span>' + p.checkpoints.length + ' CHECKPOINTS</span></div></div>';
      }).join('') +
      '</div>' +
      '<div class="row"><button class="btn go" id="startRace">RACE</button>' +
      '<button class="btn" id="backToCar">BACK</button></div>');

    menu.define('results',
      '<div class="title" id="resTitle">RESULTS</div>' +
      '<div class="sub" id="resSub"></div>' +
      '<div style="overflow-x:auto"><table class="results"><thead><tr>' +
      '<th></th><th>DRIVER</th><th>CAR</th><th>TIME</th><th>BEST LAP</th>' +
      '</tr></thead><tbody id="resBody"></tbody></table></div>' +
      '<div class="row"><button class="btn go" id="again">RACE AGAIN</button>' +
      '<button class="btn" id="changeTrack">CHANGE TRACK</button>' +
      '<button class="btn" id="changeCar">CHANGE CAR</button></div>');

    menu.define('paused',
      '<div class="title">PAUSED</div><div class="sub" id="pauseSub"></div>' +
      '<div class="row" style="margin-top:4vmin">' +
      '<button class="btn go" id="resume">RESUME</button>' +
      '<button class="btn" id="restart">RESTART RACE</button>' +
      '<button class="btn" id="quit">QUIT TO MENU</button></div>' +
      '<div class="row" id="mobileOpts" style="display:none;padding-top:1vmin">' +
      '<button class="btn" id="autoGas">AUTO-GAS: ON</button>' +
      '<button class="btn" id="tiltBtn">TILT STEERING: OFF</button></div>');

    /* --- wiring --- */
    const pick = (screen, listId, apply) => {
      menu.screens[screen].querySelector('#' + listId).addEventListener('click', (e) => {
        const card = e.target.closest('.card');
        if (!card) return;
        apply(Number(card.dataset.i));
        refreshSelection(screen, listId, screen === 'car' ? Game.carIndex : Game.trackIndex);
      });
    };
    pick('car', 'carCards', (i) => { Game.carIndex = i; });
    pick('track', 'trackCards', (i) => { Game.trackIndex = i; previewTrack(i); });

    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    on('toTrack', () => showTrackSelect());
    on('backToCar', () => showCarSelect());
    on('startRace', () => startRace());
    on('again', () => startRace());
    on('changeTrack', () => showTrackSelect());
    on('changeCar', () => showCarSelect());
    on('resume', () => resume());
    on('restart', () => startRace());
    on('quit', () => showCarSelect());
    on('autoGas', (e) => {
      Game.touch.setAutoGas(!Game.touch.autoGas);
      e.target.textContent = 'AUTO-GAS: ' + (Game.touch.autoGas ? 'ON' : 'OFF');
    });
    on('tiltBtn', async (e) => {
      if (!Game.touch.tilt) {
        const ok = await Game.touch.requestTilt();
        e.target.textContent = 'TILT STEERING: ' + (ok ? 'ON' : 'UNAVAILABLE');
      } else {
        Game.touch.tilt = false;
        e.target.textContent = 'TILT STEERING: OFF';
      }
    });
  }

  function refreshSelection(screen, listId, index) {
    const list = Game.menu.screens[screen].querySelector('#' + listId);
    for (const c of list.querySelectorAll('.card')) {
      c.classList.toggle('sel', Number(c.dataset.i) === index);
    }
  }

  function showCarSelect() {
    Game.state = 'menu';
    Game.hud.show(false);
    Game.menu.show('car');
    refreshSelection('car', 'carCards', Game.carIndex);
    const hint = document.getElementById('ctrlHint');
    if (hint) hint.textContent = Game.mobile
      ? 'Touch controls — slide the left side to steer'
      : 'Keyboard or gamepad';
    if (!Game.path) previewTrack(Game.trackIndex);
  }

  function showTrackSelect() {
    Game.state = 'menu';
    Game.hud.show(false);
    Game.menu.show('track');
    refreshSelection('track', 'trackCards', Game.trackIndex);
    previewTrack(Game.trackIndex);
  }

  /* Load a track just to look at it behind the menus. */
  function previewTrack(i) {
    const def = Tracks.list[i];
    if (Game.world && Game.world.id === def.id) return;
    buildWorld(def);
    buildField(def);
    orbitS = 0;
  }

  function startRace() {
    const def = Tracks.list[Game.trackIndex];
    if (!Game.world || Game.world.id !== def.id) buildWorld(def);
    buildField(def);
    Game.fx.reset();
    Game.resultsShown = false;
    Game.menu.hide();
    Game.hud.show(true);
    Game.state = 'race';
    Game.cam.snapTo(Game.player.car);
    Game.hud.banner(def.name, def.accent);
    acc = 0; lastT = 0;
    if (Game.touch) Game.touch.setEnabled(Game.mobile);
  }

  function pause() {
    if (Game.state !== 'race') return;
    Game.state = 'paused';
    Game.menu.show('paused');
    document.getElementById('pauseSub').textContent =
      Game.world.name + ' — LAP ' + Math.max(1, Game.player.lap) + ' OF ' + Game.race.laps;
    document.getElementById('mobileOpts').style.display = Game.mobile ? 'flex' : 'none';
    if (Game.touch) Game.touch.setEnabled(false);
  }

  function resume() {
    if (Game.state !== 'paused') return;
    Game.menu.hide();
    Game.state = 'race';
    lastT = 0; acc = 0;
    if (Game.touch) Game.touch.setEnabled(Game.mobile);
  }

  function showResults() {
    Game.state = 'results';
    Game.hud.show(false);
    if (Game.touch) Game.touch.setEnabled(false);
    Game.menu.show('results');

    const order = Game.race.order || Game.racers;
    const p = Game.player;
    document.getElementById('resTitle').innerHTML =
      p.finished ? UI.ordinal(p.position) + ' <em>PLACE</em>' : 'RACE <em>OVER</em>';
    document.getElementById('resSub').textContent =
      Game.world.name + ' — ' + Game.race.laps + ' LAPS';

    const winner = order[0];
    document.getElementById('resBody').innerHTML = order.map((r, i) => {
      const gapTxt = r.finished
        ? (i === 0 ? UI.fmtTime(r.totalTime) : '+' + (r.totalTime - winner.totalTime).toFixed(2))
        : 'DNF';
      return '<tr class="' + (r.isPlayer ? 'you' : '') + '">' +
        '<td class="p">' + (i + 1) + '</td>' +
        '<td>' + r.name + '</td>' +
        '<td style="color:' + r.colour + '">' + TUNE.CARS[r.specIndex].name + '</td>' +
        '<td>' + gapTxt + '</td>' +
        '<td>' + UI.fmtTime(r.bestLap) + '</td></tr>';
    }).join('');
  }

  /* =============================================================== input */

  function hotkeys(ctrl) {
    const I = Game.input;
    if (I.tapped('camera')) Game.cam.cycleMode();
    if (I.tappedCode('F1')) Game.showDebug = !Game.showDebug;
    if (I.tapped('escape')) {
      if (Game.state === 'race') pause();
      else if (Game.state === 'paused') resume();
    }
    if (Game.state !== 'race' && Game.state !== 'paused' && I.tapped('enter')) {
      if (Game.menu.current === 'car') showTrackSelect();
      else if (Game.menu.current === 'track') startRace();
      else if (Game.menu.current === 'results') startRace();
    }
  }

  /* ================================================================ boot */

  function boot(canvas) {
    Game.mobile = TouchControls.isTouchDevice();
    Game.quality = Game.mobile ? 0.7 : 1;

    Game.renderer = new GL.Renderer(canvas);
    Game.renderer.maxDpr = Game.mobile ? 1.5 : 2;
    Game.renderer.resize(Game.renderer.maxDpr);
    Game.input = new Input();
    Game.hud = new UI.HUD();
    Game.menu = new UI.Menu(document.getElementById('menu'));
    Game.cam = new ChaseCamera();
    Game.env = Scene.env('coast');
    Game.touch = new TouchControls(document.getElementById('overlay'));

    buildMenus();
    const pb = document.getElementById('pauseBtn');
    if (pb) pb.addEventListener('click', () => (Game.state === 'race' ? pause() : resume()));
    showCarSelect();

    Game.running = true;
    requestAnimationFrame(frame);

    window.addEventListener('resize', () => Game.renderer.resize(Game.renderer.maxDpr));
    window.addEventListener('orientationchange', () =>
      setTimeout(() => Game.renderer.resize(Game.renderer.maxDpr), 250));
    document.addEventListener('visibilitychange', () => {
      lastT = 0; acc = 0;
      if (document.hidden && Game.state === 'race') pause();
    });
  }

  Object.assign(Game, {
    boot, startRace, showCarSelect, showTrackSelect, showResults, pause, resume
  });
  global.Game = Game;
})(window);
