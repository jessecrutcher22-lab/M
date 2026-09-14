/* trackmesh.js — generates all the circuit geometry from a TrackPath.
 *
 * Everything here is derived from the centreline: tarmac, edge lines, kerbs
 * on the corners, runoff, barriers, terrain and the start line. Nothing is
 * authored per track. */
(function (global) {
  'use strict';

  /* Deterministic noise so a track looks identical every time it loads. */
  function hash(i) {
    let x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  const SURFACES = {
    coast:  { road: [0.215, 0.22, 0.235], roadAlt: [0.235, 0.24, 0.255],
              verge: [0.80, 0.72, 0.50], terrain: [0.62, 0.72, 0.42],
              base: [0.16, 0.46, 0.62], line: [0.93, 0.93, 0.90],
              wall: [0.92, 0.93, 0.95], wallAlt: [0.86, 0.24, 0.26] },
    city:   { road: [0.155, 0.16, 0.185], roadAlt: [0.175, 0.18, 0.205],
              verge: [0.20, 0.20, 0.24], terrain: [0.12, 0.12, 0.15],
              base: [0.07, 0.07, 0.10], line: [0.88, 0.90, 0.94],
              wall: [0.24, 0.25, 0.30], wallAlt: [0.16, 0.17, 0.22] },
    alpine: { road: [0.20, 0.205, 0.215], roadAlt: [0.225, 0.23, 0.24],
              verge: [0.52, 0.52, 0.50], terrain: [0.30, 0.40, 0.30],
              base: [0.42, 0.46, 0.50], line: [0.94, 0.94, 0.92],
              wall: [0.80, 0.81, 0.84], wallAlt: [0.55, 0.14, 0.16] }
  };

  const KERB_A = [0.86, 0.16, 0.18];
  const KERB_B = [0.94, 0.94, 0.92];

  /* Where a corner is sharp enough to deserve a kerb. */
  const KERB_RADIUS = 260;

  /* Cross-section of the ground beside the track, as
   * [metres beyond the runoff, height drop]. Step 0 is the white line itself
   * and step 1 the outer edge of the flat runoff (which scales with the
   * track's own runoff width); past that the land falls away in absolute
   * metres, so a street circuit and an open circuit both look right. */
  const TERRAIN = [[0, 0], [0, -0.10], [34, -1.2], [68, -4.5], [102, -12], [136, -24]];

  function crossOffset(runoff, k) { return k === 0 ? 0 : runoff + TERRAIN[k][0]; }

  /* Smooth, deterministic ground relief. Depends only on (node, step, side),
   * which is what keeps the terrain watertight. */
  function relief(i, k, sx) {
    if (k <= 1) return 0;
    const f = (k - 1) * 1.35;
    return (Math.sin(i * 0.19 + k * 1.7 + (sx > 0 ? 2.1 : 0)) * 0.6 +
            Math.sin(i * 0.061 + k * 0.7 + (sx > 0 ? 1.3 : 0)) * 0.4) * f;
  }

  function terrainShade(S, i, k) {
    const v = 0.94 + (Math.sin(i * 0.37 + k * 2.3) * 0.5 + 0.5) * 0.14;
    return [S.terrain[0] * v, S.terrain[1] * v, S.terrain[2] * v];
  }

  function buildSurface(path, def) {
    const S = SURFACES[def.scenery] || SURFACES.coast;
    const b = new Geom.Builder();
    const nodes = path.nodes;
    const N = nodes.length;
    const runoff = path.runoff;

    const at = (nd, lat, dy) => [nd.x + nd.rx * lat, nd.y + (dy || 0), nd.z + nd.rz * lat];

    for (let i = 0; i < N; i++) {
      const a = nodes[i], c = nodes[(i + 1) % N];
      const hwA = a.width / 2, hwC = c.width / 2;
      const alt = (i >> 1) & 1;

      /* Tarmac. Alternating shades every other segment give the road a
       * faint banding that reads as speed without needing textures. */
      const road = alt ? S.roadAlt : S.road;
      b.quad(at(a, -hwA), at(c, -hwC), at(c, hwC), at(a, hwA), road);

      /* Edge lines. */
      for (const sx of [-1, 1]) {
        b.quad(at(a, sx * (hwA - 0.55), 0.012), at(c, sx * (hwC - 0.55), 0.012),
               at(c, sx * (hwC - 0.15), 0.012), at(a, sx * (hwA - 0.15), 0.012),
               sx < 0 ? S.line : S.line);
      }

      /* Kerbs, on the inside of a corner and on the outside at its exit. */
      if (a.radius < KERB_RADIUS) {
        const inside = -MX.sign(a.curv);
        const kc = ((i >> 1) & 1) ? KERB_A : KERB_B;
        const w = 1.35 * MX.clamp(KERB_RADIUS / a.radius - 1, 0.35, 1);
        for (const sx of (a.radius < 130 ? [inside, -inside] : [inside])) {
          b.quad(at(a, sx * hwA, 0.02), at(c, sx * hwC, 0.02),
                 at(c, sx * (hwC + w), 0.09), at(a, sx * (hwA + w), 0.09),
                 sx > 0 ? kc : kc);
          // Winding has to flip on the left-hand side to keep normals up.
        }
      }

      /* Runoff, then terrain falling away from the circuit.
       * The height offset must be a pure function of (node, step, side) or
       * neighbouring quads disagree at their shared corners and the mesh
       * tears open. */
      for (const sx of [-1, 1]) {
        for (let k = 0; k < TERRAIN.length - 1; k++) {
          const d0 = TERRAIN[k][1], d1 = TERRAIN[k + 1][1];
          const col = k === 0 ? S.verge : terrainShade(S, i, k);
          const w0 = crossOffset(runoff, k), w1 = crossOffset(runoff, k + 1);
          const A0 = at(a, sx * (hwA + w0), d0 + relief(i, k, sx));
          const C0 = at(c, sx * (hwC + w0), d0 + relief(i + 1, k, sx));
          const A1 = at(a, sx * (hwA + w1), d1 + relief(i, k + 1, sx));
          const C1 = at(c, sx * (hwC + w1), d1 + relief(i + 1, k + 1, sx));
          if (sx < 0) b.quad(A1, C1, C0, A0, col);
          else b.quad(A0, C0, C1, A1, col);
        }
      }
    }

    /* A single plane far below, so nothing can ever show through: sea on the
     * coast, a valley floor in the mountains, dark ground downtown. */
    {
      let minY = Infinity, minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const nd of nodes) {
        minY = Math.min(minY, nd.y);
        minX = Math.min(minX, nd.x); maxX = Math.max(maxX, nd.x);
        minZ = Math.min(minZ, nd.z); maxZ = Math.max(maxZ, nd.z);
      }
      const y = minY - 15;
      const pad = 2200;
      b.quad([minX - pad, y, minZ - pad], [minX - pad, y, maxZ + pad],
             [maxX + pad, y, maxZ + pad], [maxX + pad, y, minZ - pad], S.base);
    }

    /* Start / finish: a checkerboard band across the road. */
    const sNode = path.nodeAt(path.startS);
    const nx = path.nodeAt(path.startS + 3);
    const hw = sNode.width / 2;
    const cells = 16;
    for (let k = 0; k < cells; k++) {
      const l0 = -hw + (k / cells) * hw * 2, l1 = -hw + ((k + 1) / cells) * hw * 2;
      for (let r = 0; r < 2; r++) {
        const p = r === 0 ? sNode : nx;
        const q = r === 0 ? nx : path.nodeAt(path.startS + 6);
        const col = ((k + r) & 1) ? [0.95, 0.95, 0.93] : [0.09, 0.09, 0.11];
        b.quad(at(p, l0, 0.02), at(q, l0, 0.02), at(q, l1, 0.02), at(p, l1, 0.02), col);
      }
    }
    return b.build();
  }

  /* Guard rails on both sides, plus posts. On the night circuit the rail
   * carries an emissive strip, which is most of that track's look. */
  function buildBarriers(path, def) {
    const S = SURFACES[def.scenery] || SURFACES.coast;
    const b = new Geom.Builder();
    const nodes = path.nodes, N = nodes.length;
    const H = 1.15, T = 0.22;
    const at = (nd, lat, dy) => [nd.x + nd.rx * lat, nd.y + (dy || 0), nd.z + nd.rz * lat];

    for (let i = 0; i < N; i++) {
      const a = nodes[i], c = nodes[(i + 1) % N];
      const oA = a.width / 2 + path.runoff, oC = c.width / 2 + path.runoff;
      const sink = -0.15;
      const col = ((i >> 2) & 1) ? S.wall : S.wallAlt;
      for (const sx of [-1, 1]) {
        const i0 = at(a, sx * oA, sink), i1 = at(c, sx * oC, sink);
        const o0 = at(a, sx * (oA + T), sink), o1 = at(c, sx * (oC + T), sink);
        const iu0 = at(a, sx * oA, H), iu1 = at(c, sx * oC, H);
        const ou0 = at(a, sx * (oA + T), H), ou1 = at(c, sx * (oC + T), H);
        // Track-facing wall.
        if (sx < 0) b.quad(i0, i1, iu1, iu0, col); else b.quad(iu0, iu1, i1, i0, col);
        // Top cap.
        if (sx < 0) b.quad(iu0, iu1, ou1, ou0, col); else b.quad(ou0, ou1, iu1, iu0, col);
        // Outer face.
        if (sx < 0) b.quad(ou0, ou1, o1, o0, col); else b.quad(o0, o1, ou1, ou0, col);
      }
    }
    return b.build();
  }

  /* The start gantry: two towers and a beam over the grid. */
  function buildGantry(path, def) {
    const b = new Geom.Builder();
    const nd = path.nodeAt(path.startS);
    const hw = nd.width / 2 + 1.5;
    const post = [0.90, 0.91, 0.94], dark = [0.11, 0.12, 0.16];
    b.cylinderY(-hw, 0, 0, 0.42, 0.36, 8.2, 8, post);
    b.cylinderY(hw, 0, 0, 0.42, 0.36, 8.2, 8, post);
    b.box(0, 8.6, 0, hw * 2 + 1.2, 1.5, 0.7, dark);
    b.box(0, 8.6, 0.38, hw * 1.5, 0.9, 0.06, [0.95, 0.95, 0.92]);
    // Start lights.
    for (let k = -2; k <= 2; k++) b.box(k * 1.5, 7.4, 0.42, 0.55, 0.55, 0.14, dark);
    return b.build();
  }

  /* Lamp posts / floodlights, one mesh instanced along the track. */
  function buildLightPost(scenery) {
    const b = new Geom.Builder();
    const grey = scenery === 'city' ? [0.20, 0.21, 0.26] : [0.72, 0.73, 0.76];
    b.cylinderY(0, 0, 0, 0.20, 0.14, 8.5, 6, grey);
    b.box(0, 8.5, 1.1, 0.16, 0.16, 2.3, grey);
    b.box(0, 8.35, 2.1, 0.9, 0.22, 0.55, [1.0, 0.95, 0.75]);
    return b.build();
  }

  function buildStartLine(path) { return path.nodeAt(path.startS); }

  global.TrackMesh = {
    buildSurface, buildBarriers, buildGantry, buildLightPost, SURFACES, hash
  };
})(window);
