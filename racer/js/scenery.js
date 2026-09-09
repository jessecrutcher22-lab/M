/* scenery.js — roadside detail. This is what sells the sense of speed:
 * without things flicking past at the edge of vision, 250 km/h looks like
 * 60. Everything is instanced, so a thousand trees cost one draw call. */
(function (global) {
  'use strict';

  const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  /* ------------------------------------------------------------ prop meshes */

  function palm() {
    const b = new Geom.Builder();
    b.cylinderY(0, 0, 0, 0.30, 0.20, 7.5, 6, [0.42, 0.33, 0.22]);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * MX.TAU;
      const x = Math.cos(a) * 1.5, z = Math.sin(a) * 1.5;
      b.tri([0, 7.9, 0], [x * 1.6, 6.4, z * 1.6], [x * 0.4 - z * 0.7, 7.2, z * 0.4 + x * 0.7],
        [0.18, 0.52, 0.26]);
      b.tri([0, 7.9, 0], [x * 0.4 + z * 0.7, 7.2, z * 0.4 - x * 0.7], [x * 1.6, 6.4, z * 1.6],
        [0.22, 0.60, 0.30]);
    }
    return b.build();
  }

  function pine() {
    const b = new Geom.Builder();
    b.cylinderY(0, 0, 0, 0.34, 0.26, 2.2, 6, [0.32, 0.24, 0.18]);
    b.cone(0, 1.8, 0, 2.10, 3.6, 7, [0.13, 0.32, 0.20]);
    b.cone(0, 4.2, 0, 1.60, 3.2, 7, [0.16, 0.38, 0.23]);
    b.cone(0, 6.4, 0, 1.05, 2.6, 7, [0.19, 0.44, 0.26]);
    return b.build();
  }

  function rock() {
    const b = new Geom.Builder();
    const pts = [];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * MX.TAU;
      const r = 1.5 + hash(k * 3.3) * 1.1;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    b.loft([
      { y: 0, pts, col: [0.40, 0.39, 0.38] },
      { y: 1.5, pts: pts.map(p => [p[0] * 0.78, p[1] * 0.78]), col: [0.50, 0.49, 0.47] },
      { y: 2.4, pts: pts.map(p => [p[0] * 0.34, p[1] * 0.34]), col: [0.58, 0.57, 0.55] }
    ], false, true);
    return b.build();
  }

  /* City block. The lit windows live in a separate mesh so they can glow
   * without the walls glowing too. */
  function tower(seed, lit) {
    const b = new Geom.Builder();
    const w = 7 + hash(seed) * 7, d = 7 + hash(seed + 1) * 7;
    const h = 16 + hash(seed + 2) * 46;
    const shell = [0.13 + hash(seed + 3) * 0.06, 0.14 + hash(seed + 4) * 0.06, 0.19 + hash(seed + 5) * 0.07];
    if (!lit) {
      b.box(0, h / 2, 0, w, h, d, shell);
      b.box(0, h + 0.5, 0, w * 0.45, 1.0, d * 0.45, shell);
      return b.build();
    }
    const tone = [[1.0, 0.86, 0.55], [0.55, 0.85, 1.0], [1.0, 0.55, 0.72]][Math.floor(hash(seed + 9) * 3)];
    for (let y = 3; y < h - 2; y += 3.2) {
      for (let k = 0; k < 4; k++) {
        if (hash(seed * 13 + y * 7 + k) < 0.45) continue;
        const off = -0.30 + k * 0.20;
        b.box(off * w, y, d / 2 + 0.05, w * 0.13, 1.5, 0.06, tone);
        b.box(off * w, y, -d / 2 - 0.05, w * 0.13, 1.5, 0.06, tone);
        b.box(w / 2 + 0.05, y, off * d, 0.06, 1.5, d * 0.13, tone);
        b.box(-w / 2 - 0.05, y, off * d, 0.06, 1.5, d * 0.13, tone);
      }
    }
    return b.build();
  }

  /* Grandstand with a crowd baked in — one mesh, placed a few times. */
  function grandstand() {
    const b = new Geom.Builder();
    const frame = [0.80, 0.81, 0.85], deck = [0.28, 0.30, 0.36];
    for (let r = 0; r < 6; r++) {
      const y = 1.0 + r * 0.85, z = -r * 1.25;
      b.box(0, y - 0.45, z, 30, 0.9, 1.3, r % 2 ? frame : deck);
      for (let k = 0; k < 34; k++) {
        if (hash(r * 41 + k) < 0.24) continue;
        const c = [hash(r * 7 + k) * 0.8 + 0.2, hash(r * 7 + k + 1) * 0.8 + 0.2, hash(r * 7 + k + 2) * 0.8 + 0.2];
        b.box(-14.6 + k * 0.88, y + 0.35, z, 0.42, 0.7, 0.42, c);
      }
    }
    b.box(0, 7.4, -3.6, 31, 0.5, 9.5, frame);
    for (const sx of [-1, 1]) b.box(sx * 14.5, 4.0, -7.4, 0.6, 7.5, 0.6, frame);
    return b.build();
  }

  function cabin() {
    const b = new Geom.Builder();
    b.box(0, 1.7, 0, 7, 3.4, 6, [0.44, 0.31, 0.22]);
    b.loft([
      { y: 3.4, pts: [[-4.2, 3.8], [4.2, 3.8], [4.2, -3.8], [-4.2, -3.8]], col: [0.62, 0.64, 0.68] },
      { y: 5.4, pts: [[-0.5, 3.8], [0.5, 3.8], [0.5, -3.8], [-0.5, -3.8]], col: [0.88, 0.90, 0.94] }
    ], false, true);
    b.box(2.1, 4.6, 0, 0.8, 2.4, 0.8, [0.36, 0.34, 0.33]);
    return b.build();
  }

  function billboard(accent) {
    const b = new Geom.Builder();
    const c = CarModel.hex(accent);
    b.cylinderY(-2.6, 0, 0, 0.16, 0.14, 5.2, 5, [0.24, 0.24, 0.28]);
    b.cylinderY(2.6, 0, 0, 0.16, 0.14, 5.2, 5, [0.24, 0.24, 0.28]);
    b.box(0, 6.4, 0, 7.2, 3.0, 0.24, [0.10, 0.10, 0.13]);
    b.box(0, 6.4, 0.16, 6.4, 2.3, 0.05, c);
    return b.build();
  }

  /* ------------------------------------------------------------- placement */

  function build(renderer, path, def, env) {
    const nodes = path.nodes, N = nodes.length;
    const edge = path.runoff + 3;
    const m = MX.m4();
    const made = [];

    const mesh = (geo, cap) => {
      const x = renderer.createMesh(geo, { capacity: cap || 64 });
      made.push(x);
      return x;
    };
    /* Place a prop just past the barrier, `out` metres further out. */
    const place = (msh, i, sx, out, scale, tint, emis) => {
      const nd = nodes[i];
      const lat = sx * (nd.width / 2 + edge + out);
      const drop = -MX.clamp((edge + out - path.runoff) * 0.085, 0, 9);
      MX.compose(m, nd.x + nd.rx * lat, nd.y + drop, nd.z + nd.rz * lat,
        hash(i * 3.7 + sx) * MX.TAU, scale, scale, scale);
      msh.add(m, tint ? tint[0] : 1, tint ? tint[1] : 1, tint ? tint[2] : 1, emis || 0);
    };

    const stands = mesh(grandstand(), 8);
    // Grandstands flanking the start line.
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const nd = nodes[(Math.round(path.startS / path.spacing) - 14 + k * 9 + N) % N];
        const lat = sx * (nd.width / 2 + edge + 12);
        MX.compose(m, nd.x + nd.rx * lat, nd.y, nd.z + nd.rz * lat,
          nd.yaw + (sx > 0 ? Math.PI : 0), 1, 1, 1);
        stands.add(m, 1, 1, 1, 0);
      }
    }

    const posts = mesh(TrackMesh.buildLightPost(def.scenery), 200);
    const postStep = def.scenery === 'city' ? 9 : 22;
    for (let i = 0; i < N; i += postStep) {
      const sx = ((i / postStep) & 1) ? 1 : -1;
      const nd = nodes[i];
      const lat = sx * (nd.width / 2 + edge - 1.2);
      MX.compose(m, nd.x + nd.rx * lat, nd.y, nd.z + nd.rz * lat,
        nd.yaw + (sx > 0 ? Math.PI : 0), 1, 1, 1);
      posts.add(m, 1, 1, 1, env.night ? 0.85 : 0);
    }

    const boards = mesh(billboard(def.accent), 64);
    for (let i = 10; i < N; i += 47) {
      const sx = ((i / 47) & 1) ? 1 : -1;
      const nd = nodes[i];
      const lat = sx * (nd.width / 2 + edge + 4);
      MX.compose(m, nd.x + nd.rx * lat, nd.y, nd.z + nd.rz * lat,
        nd.yaw + (sx > 0 ? Math.PI : 0), 1, 1, 1);
      boards.add(m, 1, 1, 1, env.night ? 0.9 : 0);
    }

    if (def.scenery === 'coast') {
      const tree = mesh(palm(), 700), stone = mesh(rock(), 400);
      for (let i = 0; i < N; i += 3) {
        for (const sx of [-1, 1]) {
          const r = hash(i * 5.1 + sx * 2);
          if (r < 0.55) continue;
          place(tree, i, sx, 4 + r * 34, 0.8 + hash(i + sx) * 0.6);
        }
      }
      for (let i = 0; i < N; i += 7) {
        for (const sx of [-1, 1]) {
          if (hash(i * 2.3 + sx * 9) < 0.62) continue;
          place(stone, i, sx, 8 + hash(i + sx * 3) * 60, 0.7 + hash(i * 1.7) * 1.5,
            [0.92, 0.86, 0.70]);
        }
      }
    } else if (def.scenery === 'alpine') {
      const tree = mesh(pine(), 1200), stone = mesh(rock(), 600), hut = mesh(cabin(), 40);
      for (let i = 0; i < N; i += 2) {
        for (const sx of [-1, 1]) {
          const r = hash(i * 5.1 + sx * 2);
          if (r < 0.40) continue;
          place(tree, i, sx, 3 + r * 46, 0.75 + hash(i + sx) * 0.8);
        }
      }
      for (let i = 0; i < N; i += 5) {
        for (const sx of [-1, 1]) {
          if (hash(i * 2.3 + sx * 9) < 0.55) continue;
          place(stone, i, sx, 5 + hash(i + sx * 3) * 40, 0.8 + hash(i * 1.7) * 2.2);
        }
      }
      for (let i = 0; i < N; i += 61) place(hut, i, ((i / 61) & 1) ? 1 : -1, 22 + hash(i) * 20, 1);
    } else {
      // City: two tower meshes, one opaque and one of lit windows, drawn with
      // matching transforms so the glow lines up with the walls.
      for (let v = 0; v < 3; v++) {
        const shell = mesh(tower(v * 17 + 1, false), 200);
        const glow = mesh(tower(v * 17 + 1, true), 200);
        for (let i = v * 4; i < N; i += 11) {
          for (const sx of [-1, 1]) {
            if (hash(i * 3.1 + sx * 7 + v) < 0.45) continue;
            const nd = nodes[i];
            const out = 14 + hash(i + sx + v * 3) * 55;
            const lat = sx * (nd.width / 2 + edge + out);
            MX.compose(m, nd.x + nd.rx * lat, nd.y - 0.4, nd.z + nd.rz * lat,
              hash(i * 1.3 + sx) * MX.TAU, 1, 1, 1);
            shell.add(m, 1, 1, 1, 0);
            glow.add(m, 1, 1, 1, 1.15);
          }
        }
      }
    }

    for (const x of made) x.freeze();
    return made;
  }

  global.Scenery = { build, palm, pine, rock, tower, grandstand, cabin, billboard };
})(window);
