/* track.js — turns a handful of control points into a whole circuit.
 *
 * A track definition is just a closed list of points (see tracks.js). This
 * file fits a Catmull-Rom spline through them, resamples it at a uniform
 * spacing, and generates every piece of geometry from that: tarmac, kerbs,
 * lines, verges, barriers, start line and checkpoints. Adding a track costs
 * a dozen coordinates and nothing else. */
(function (global) {
  'use strict';

  const NODE_SPACING = 4.0;      // m between centreline samples
  const GRID_CELL = 24;          // m, spatial grid for nearest-point lookups

  /* Catmull-Rom through p1..p2, with p0/p3 as the neighbouring points. */
  function crom(p0, p1, p2, p3, t, out) {
    const t2 = t * t, t3 = t2 * t;
    for (let i = 0; i < 3; i++) {
      out[i] = 0.5 * ((2 * p1[i]) +
        (-p0[i] + p2[i]) * t +
        (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
        (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
    }
    return out;
  }

  /* ------------------------------------------------------------ TrackPath
   * The centreline, resampled at a uniform spacing, plus the queries the
   * rest of the game needs: where am I on the track, and how far off it. */
  class TrackPath {
    constructor(def) {
      this.def = def;
      this.width = def.width;
      this.halfWidth = def.width / 2;
      this.runoff = def.runoff === undefined ? 7 : def.runoff;
      this._build();
    }

    _build() {
      const cps = this.def.points.map(p => [p[0], p[2] || 0, p[1]]);   // x, y, z
      const n = cps.length;

      /* Walk the spline finely, then resample at a fixed arc length so every
       * node is the same distance apart. That makes distance-along-track a
       * usable coordinate for lap logic, AI and standings. */
      const fine = [];
      const tmp = [0, 0, 0];
      const STEPS = 40;
      for (let i = 0; i < n; i++) {
        const p0 = cps[(i - 1 + n) % n], p1 = cps[i];
        const p2 = cps[(i + 1) % n], p3 = cps[(i + 2) % n];
        for (let k = 0; k < STEPS; k++) {
          crom(p0, p1, p2, p3, k / STEPS, tmp);
          fine.push([tmp[0], tmp[1], tmp[2]]);
        }
      }
      // Cumulative arc length around the loop.
      const cum = [0];
      for (let i = 1; i <= fine.length; i++) {
        const a = fine[i - 1], b = fine[i % fine.length];
        cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
      }
      this.length = cum[fine.length];

      const count = Math.max(16, Math.round(this.length / NODE_SPACING));
      this.spacing = this.length / count;
      this.nodes = [];
      let fi = 0;
      for (let i = 0; i < count; i++) {
        const s = i * this.spacing;
        while (fi < fine.length - 1 && cum[fi + 1] < s) fi++;
        const seg = cum[fi + 1] - cum[fi] || 1;
        const t = (s - cum[fi]) / seg;
        const a = fine[fi], b = fine[(fi + 1) % fine.length];
        this.nodes.push({
          i, s,
          x: a[0] + (b[0] - a[0]) * t,
          y: a[1] + (b[1] - a[1]) * t,
          z: a[2] + (b[2] - a[2]) * t
        });
      }

      /* Tangent, right-vector and curvature for every node. Curvature is what
       * the AI brakes for and what decides where kerbs go. */
      const N = this.nodes.length;
      for (let i = 0; i < N; i++) {
        const p = this.nodes[(i - 1 + N) % N], q = this.nodes[(i + 1) % N];
        let dx = q.x - p.x, dz = q.z - p.z;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        const nd = this.nodes[i];
        nd.dx = dx; nd.dz = dz;
        nd.rx = dz; nd.rz = -dx;              // right-hand normal, matches +X = right
        nd.yaw = Math.atan2(dx, dz);
        nd.width = this.width * (this.def.widthAt ? this.def.widthAt(i / N) : 1);
      }
      for (let i = 0; i < N; i++) {
        const a = this.nodes[(i - 1 + N) % N], b = this.nodes[i], c = this.nodes[(i + 1) % N];
        // Signed curvature: positive = the track turns right.
        const d = MX.angleDelta(Math.atan2(a.dx, a.dz), Math.atan2(c.dx, c.dz));
        b.curv = d / (2 * this.spacing);
        b.radius = Math.abs(b.curv) > 1e-5 ? 1 / Math.abs(b.curv) : 1e6;
      }
      // Smooth curvature a little — raw values are noisy at this spacing.
      const sm = this.nodes.map((nd, i) => {
        let acc = 0;
        for (let k = -3; k <= 3; k++) acc += this.nodes[(i + k + N) % N].curv;
        return acc / 7;
      });
      for (let i = 0; i < N; i++) { this.nodes[i].curv = sm[i]; this.nodes[i].radius = Math.abs(sm[i]) > 1e-5 ? 1 / Math.abs(sm[i]) : 1e6; }

      this._buildGrid();
      this._buildCheckpoints();
      this._buildRacingLine();
    }

    /* Spatial hash so nearest() is O(1) instead of scanning 800 nodes. */
    _buildGrid() {
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const nd of this.nodes) {
        minX = Math.min(minX, nd.x); maxX = Math.max(maxX, nd.x);
        minZ = Math.min(minZ, nd.z); maxZ = Math.max(maxZ, nd.z);
      }
      const pad = this.halfWidth + this.runoff + 40;
      this.gMinX = minX - pad; this.gMinZ = minZ - pad;
      this.gW = Math.ceil((maxX - minX + pad * 2) / GRID_CELL);
      this.gH = Math.ceil((maxZ - minZ + pad * 2) / GRID_CELL);
      this.grid = new Array(this.gW * this.gH);
      const put = (cx, cz, i) => {
        if (cx < 0 || cz < 0 || cx >= this.gW || cz >= this.gH) return;
        const k = cz * this.gW + cx;
        (this.grid[k] || (this.grid[k] = [])).push(i);
      };
      const reach = Math.ceil((this.halfWidth + this.runoff + 20) / GRID_CELL);
      for (const nd of this.nodes) {
        const cx = Math.floor((nd.x - this.gMinX) / GRID_CELL);
        const cz = Math.floor((nd.z - this.gMinZ) / GRID_CELL);
        for (let a = -reach; a <= reach; a++) {
          for (let b = -reach; b <= reach; b++) put(cx + a, cz + b, nd.i);
        }
      }
      this.bounds = { minX, minZ, maxX, maxZ };
    }

    /* Nearest point on the centreline. Returns the node index, the distance
     * along the track, and the signed lateral offset (+ = right of centre). */
    nearest(x, z, hint) {
      const N = this.nodes.length;
      let best = -1, bestD = Infinity;
      const test = (i) => {
        const nd = this.nodes[i];
        const d = (nd.x - x) * (nd.x - x) + (nd.z - z) * (nd.z - z);
        if (d < bestD) { bestD = d; best = i; }
      };
      /* A hint from last frame turns this into a handful of comparisons —
       * cars only move a few metres between frames. */
      if (hint !== undefined && hint >= 0) {
        const span = 14;
        for (let k = -span; k <= span; k++) test((hint + k + N) % N);
        if (bestD < (this.spacing * span * 0.7) ** 2) return this._resolve(best, x, z);
      }
      const cx = Math.floor((x - this.gMinX) / GRID_CELL);
      const cz = Math.floor((z - this.gMinZ) / GRID_CELL);
      const cell = (cx >= 0 && cz >= 0 && cx < this.gW && cz < this.gH)
        ? this.grid[cz * this.gW + cx] : null;
      if (cell) { for (const i of cell) test(i); }
      else { for (let i = 0; i < N; i++) test(i); }
      return this._resolve(best, x, z);
    }

    _resolve(i, x, z) {
      const N = this.nodes.length;
      const nd = this.nodes[i];
      // Project onto the tangent for a sub-node-accurate s and lateral offset.
      const ex = x - nd.x, ez = z - nd.z;
      const along = ex * nd.dx + ez * nd.dz;
      const lat = ex * nd.rx + ez * nd.rz;
      let s = nd.s + along;
      if (s < 0) s += this.length;
      if (s >= this.length) s -= this.length;
      return { node: i, s, lateral: lat, y: nd.y, width: nd.width };
    }

    nodeAt(s) {
      const N = this.nodes.length;
      let i = Math.floor((s / this.length) * N) % N;
      if (i < 0) i += N;
      return this.nodes[i];
    }

    /* Position and heading a given distance along the track, offset sideways. */
    sample(s, lateral, out) {
      const nd = this.nodeAt(s);
      out = out || {};
      out.x = nd.x + nd.rx * (lateral || 0);
      out.z = nd.z + nd.rz * (lateral || 0);
      out.y = nd.y;
      out.yaw = nd.yaw;
      out.node = nd.i;
      return out;
    }

    /* Signed forward distance from a to b around the loop. */
    delta(a, b) {
      let d = b - a;
      if (d > this.length / 2) d -= this.length;
      if (d < -this.length / 2) d += this.length;
      return d;
    }

    /* Checkpoints every ~120 m. Passing them in order is what stops anyone
     * from cutting the course or reversing over the line. */
    _buildCheckpoints() {
      const target = 120;
      const count = Math.max(6, Math.round(this.length / target));
      this.checkpoints = [];
      for (let i = 0; i < count; i++) {
        const s = (i / count) * this.length;
        this.checkpoints.push({ i, s, node: this.nodeAt(s).i });
      }
      this.startS = 0;
    }

    /* A crude but effective racing line: pull toward the inside of corners,
     * with the amount scaled by how sharp the corner is. The AI follows this
     * with its own per-driver offset on top. */
    _buildRacingLine() {
      const N = this.nodes.length;
      const raw = this.nodes.map(nd => {
        // curv > 0 means the track turns right, so the inside of the corner is
        // the +lateral side. Getting this sign wrong puts every car on the
        // outside of every corner, which is exactly as bad as it sounds.
        const tight = MX.clamp(120 / Math.max(nd.radius, 30), 0, 1);
        return MX.sign(nd.curv) * tight * (nd.width * 0.5 - 3.2);
      });
      // Smooth it so the line does not zig-zag between adjacent corners.
      this.line = new Float32Array(N);
      for (let pass = 0; pass < 22; pass++) {
        for (let i = 0; i < N; i++) {
          const a = raw[(i - 1 + N) % N], b = raw[i], c = raw[(i + 1) % N];
          raw[i] = b * 0.5 + (a + c) * 0.25;
        }
      }
      for (let i = 0; i < N; i++) this.line[i] = raw[i];
    }

    lineAt(node) { return this.line[((node % this.line.length) + this.line.length) % this.line.length]; }

    /* Grid box positions: staggered rows behind the start line. */
    gridSlot(place) {
      const row = Math.floor(place / 2), col = place % 2;
      const s = this.startS - 14 - row * 11;
      const lat = (col === 0 ? -1 : 1) * (this.halfWidth * 0.42);
      return this.sample((s + this.length) % this.length, lat, {});
    }
  }

  global.TrackPath = TrackPath;
  global.TrackPath.NODE_SPACING = NODE_SPACING;
})(window);
