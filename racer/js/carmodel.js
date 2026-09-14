/* carmodel.js — builds the low-poly car bodies from the shape numbers in
 * tune.js. One mesh per car model, plus one shared wheel mesh. */
(function (global) {
  'use strict';

  /* Half-track as a fraction of the body half-width. game.js places the
   * wheels with this, and buildBody puts the arches over the same spot. */
  const TRACK = 0.86;

  function hex(h) {
    if (typeof h === 'string') h = parseInt(h.replace('#', ''), 16);
    return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
  }
  function shade(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
  function mixc(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  /* Body geometry. Colours are baked white-ish so the per-instance tint can
   * recolour a car without rebuilding geometry — except the glass and trim,
   * which stay fixed. */
  function buildBody(spec) {
    const S = spec.shape;
    const b = new Geom.Builder();
    const body = hex(spec.body);
    const dark = shade(body, 0.52);
    const deck = shade(body, 0.88);
    const glass = hex(spec.glass);
    const accent = hex(spec.accent);
    const trim = shade(dark, 0.55);
    const w = S.w, l = S.l, roof = S.roof, nose = S.nose;

    const O = Geom.outline;
    const sec = (y, sw, sl, r, nt, dz, col) =>
      ({ y, pts: Geom.scaleOutline(O(w * sw, l * sl, r, nt), 1, 1, dz * l), col });

    /* Lower body: floor -> widest beltline -> shoulder -> flat deck. */
    b.loft([
      sec(0.15, 0.80, 0.94, 0.55, nose, 0.01, dark),
      sec(0.38, 1.00, 1.00, 0.50, nose, 0, body),
      sec(0.55, 0.98, 0.95, 0.50, nose * 0.95, 0, body),
      sec(0.63, 0.94, 0.88, 0.52, nose * 0.90, -0.01, deck)
    ], true, true);

    /* Greenhouse: a separate, much smaller loft so the glass reads as a
     * cabin instead of swallowing the whole roof. */
    const rh = 0.63 + 0.30 * roof;
    b.loft([
      sec(0.63, 0.66, 0.52, 0.60, 1, -0.20, glass),
      sec(rh, 0.56, 0.44, 0.66, 1, -0.24, glass),
      sec(rh + 0.05, 0.50, 0.39, 0.70, 1, -0.25, body)
    ], false, true);

    /* Front splitter, side skirts, rear diffuser. */
    b.box(0, 0.19, l * 0.86, w * 1.12, 0.07, 0.30, accent);
    b.box(w * 0.96, 0.20, -l * 0.06, 0.10, 0.09, l * 0.9, trim);
    b.box(-w * 0.96, 0.20, -l * 0.06, 0.10, 0.09, l * 0.9, trim);
    b.box(0, 0.20, -l * 0.90, w * 1.0, 0.10, 0.22, trim);

    /* Rear wing. The `wing` number in tune.js sets how much of a shelf it is. */
    if (S.wing > 0.3) {
      const wy = 0.66 + S.wing * 0.34;
      for (const sx of [-1, 1]) {
        b.box(sx * w * 0.46, (wy + 0.63) * 0.5, -l * 0.80, 0.07, wy - 0.63, 0.20, trim);
      }
      b.box(0, wy, -l * 0.82, w * 1.48, 0.06, 0.28 + S.wing * 0.16, accent);
    }

    /* Wheel arches. These must line up with where game.js draws the wheels
     * (half-track = shape.w * 0.93) and with the axle offsets in tune.js. */
    const P = Object.assign({}, TUNE.PHYS, spec.phys || {});
    const hw = w * TRACK;
    for (const az of [P.AXLE_FRONT, -P.AXLE_REAR]) {
      for (const sx of [-1, 1]) {
        const xi = sx * (hw - 0.135), xo = sx * (hw + 0.135);
        b.fenderX(Math.min(xi, xo), Math.max(xi, xo), Car.WHEEL_RADIUS, az,
                  Car.WHEEL_RADIUS + 0.025, 0.045, 8, body);
      }
    }

    /* Mirrors and a roof scoop, to break up the flat panels. */
    b.box(w * 0.96, 0.60, l * 0.16, 0.15, 0.06, 0.13, trim);
    b.box(-w * 0.96, 0.60, l * 0.16, 0.15, 0.06, 0.13, trim);
    b.box(0, 0.655, l * 0.44, w * 0.46, 0.04, l * 0.26, trim);

    return b.build();
  }

  /* Lights live in their own mesh so they can be lit up independently
   * (night track headlights, brake lights). */
  function buildLights(spec) {
    const S = spec.shape;
    const b = new Geom.Builder();
    const w = S.w, l = S.l;
    const headlight = [1.0, 0.96, 0.80];
    const tail = [1.0, 0.20, 0.16];
    for (const sx of [-1, 1]) {
      b.box(sx * w * 0.46, 0.46, l * 0.855, 0.26, 0.09, 0.06, headlight);
      b.box(sx * w * 0.48, 0.50, -l * 0.925, 0.28, 0.08, 0.05, tail);
    }
    b.box(0, 0.505, -l * 0.925, w * 0.42, 0.04, 0.05, tail);
    return b.build();
  }

  function buildWheel() {
    const b = new Geom.Builder();
    b.wheelX(Car.WHEEL_RADIUS, 0.26, 12, [0.075, 0.075, 0.09], [0.62, 0.65, 0.72]);
    return b.build();
  }

  global.CarModel = { buildBody, buildLights, buildWheel, hex, shade, mixc, TRACK };
})(window);
