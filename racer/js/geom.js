/* geom.js — procedural geometry. Everything in the game is generated here;
 * there are no model files to download. Meshes are flat-shaded triangle
 * soups (per-face normals, duplicated vertices) which is what gives the
 * crisp low-poly look. */
(function (global) {
  'use strict';

  class Builder {
    constructor() {
      this.pos = [];
      this.nrm = [];
      this.col = [];
      this.c = [1, 1, 1];
    }

    color(r, g, b) { this.c[0] = r; this.c[1] = g; this.c[2] = b; return this; }
    colorHex(h) {
      return this.color(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255);
    }

    tri(a, b, c, col) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const k = col || this.c;
      for (const p of [a, b, c]) {
        this.pos.push(p[0], p[1], p[2]);
        this.nrm.push(nx, ny, nz);
        this.col.push(k[0], k[1], k[2]);
      }
      return this;
    }

    quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); return this; }

    /* Axis-aligned box centred at (x,y,z). */
    box(x, y, z, sx, sy, sz, col) {
      const hx = sx / 2, hy = sy / 2, hz = sz / 2;
      const p = [
        [x - hx, y - hy, z - hz], [x + hx, y - hy, z - hz],
        [x + hx, y + hy, z - hz], [x - hx, y + hy, z - hz],
        [x - hx, y - hy, z + hz], [x + hx, y - hy, z + hz],
        [x + hx, y + hy, z + hz], [x - hx, y + hy, z + hz]
      ];
      this.quad(p[4], p[5], p[6], p[7], col); // +z
      this.quad(p[1], p[0], p[3], p[2], col); // -z
      this.quad(p[5], p[1], p[2], p[6], col); // +x
      this.quad(p[0], p[4], p[7], p[3], col); // -x
      this.quad(p[3], p[7], p[6], p[2], col); // +y
      this.quad(p[0], p[1], p[5], p[4], col); // -y
      return this;
    }

    /* Cylinder around the X axis (a wheel): dark tyre, a rim face, and a few
     * spokes so you can see the wheel turning. */
    wheelX(radius, width, sides, col, rimCol) {
      const hw = width / 2;
      const rr = radius * 0.66;          // where the tyre ends and the rim begins
      const spokes = 4;
      for (let i = 0; i < sides; i++) {
        const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
        const y0 = Math.cos(a0), z0 = Math.sin(a0);
        const y1 = Math.cos(a1), z1 = Math.sin(a1);
        // Tread.
        this.quad([-hw, y0 * radius, z0 * radius], [hw, y0 * radius, z0 * radius],
                  [hw, y1 * radius, z1 * radius], [-hw, y1 * radius, z1 * radius], col);
        // Sidewall ring.
        this.quad([hw, y0 * radius, z0 * radius], [hw, y0 * rr, z0 * rr],
                  [hw, y1 * rr, z1 * rr], [hw, y1 * radius, z1 * radius], col);
        this.quad([-hw, y0 * rr, z0 * rr], [-hw, y0 * radius, z0 * radius],
                  [-hw, y1 * radius, z1 * radius], [-hw, y1 * rr, z1 * rr], col);
        // Rim face, with spokes picked out in the lighter colour.
        const spoke = (Math.floor(i * spokes / sides * 2) % 2) === 0;
        const cc = spoke ? rimCol : [col[0] * 1.6 + 0.06, col[1] * 1.6 + 0.06, col[2] * 1.6 + 0.07];
        this.tri([hw, 0, 0], [hw, y0 * rr, z0 * rr], [hw, y1 * rr, z1 * rr], cc);
        this.tri([-hw, 0, 0], [-hw, y1 * rr, z1 * rr], [-hw, y0 * rr, z0 * rr], cc);
      }
      return this;
    }

    /* A wheel arch: a half-tube over the top of a wheel, spanning x0..x1.
     * Without these the wheels poke through the bodywork. */
    fenderX(x0, x1, y, z, radius, thick, segs, col) {
      segs = segs || 7;
      const ro = radius + thick;
      for (let i = 0; i < segs; i++) {
        const a0 = Math.PI * (i / segs), a1 = Math.PI * ((i + 1) / segs);
        const z0 = z + Math.cos(a0) * ro, y0 = y + Math.sin(a0) * ro;
        const z1 = z + Math.cos(a1) * ro, y1 = y + Math.sin(a1) * ro;
        const iz0 = z + Math.cos(a0) * radius, iy0 = y + Math.sin(a0) * radius;
        const iz1 = z + Math.cos(a1) * radius, iy1 = y + Math.sin(a1) * radius;
        // Outer skin over the top of the wheel.
        this.quad([x0, y0, z0], [x0, y1, z1], [x1, y1, z1], [x1, y0, z0], col);
        // The lip you see from the side.
        this.quad([x1, y0, z0], [x1, y1, z1], [x1, iy1, iz1], [x1, iy0, iz0], col);
        this.quad([x0, iy0, iz0], [x0, iy1, iz1], [x0, y1, z1], [x0, y0, z0], col);
      }
      return this;
    }

    /* Cylinder around Y (posts, trunks, barrels). */
    cylinderY(x, y, z, r0, r1, h, sides, col) {
      for (let i = 0; i < sides; i++) {
        const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        this.quad(
          [x + c0 * r0, y, z + s0 * r0], [x + c1 * r0, y, z + s1 * r0],
          [x + c1 * r1, y + h, z + s1 * r1], [x + c0 * r1, y + h, z + s0 * r1], col);
        this.tri([x, y + h, z], [x + c0 * r1, y + h, z + s0 * r1], [x + c1 * r1, y + h, z + s1 * r1], col);
      }
      return this;
    }

    cone(x, y, z, r, h, sides, col) {
      for (let i = 0; i < sides; i++) {
        const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
        this.tri([x, y + h, z],
          [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r],
          [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], col);
      }
      return this;
    }

    /* Loft: connect a stack of same-length outlines into a closed hull.
     * sections = [{ y, pts:[[x,z],...], col:[r,g,b] }, ...] bottom to top.
     * This is how the car bodies and most scenery shapes are made. */
    loft(sections, capBottom, capTop) {
      const n = sections[0].pts.length;
      for (let s = 0; s < sections.length - 1; s++) {
        const A = sections[s], B = sections[s + 1];
        const col = B.col || A.col || this.c;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          this.quad(
            [A.pts[i][0], A.y, A.pts[i][1]],
            [A.pts[j][0], A.y, A.pts[j][1]],
            [B.pts[j][0], B.y, B.pts[j][1]],
            [B.pts[i][0], B.y, B.pts[i][1]], col);
        }
      }
      if (capBottom !== false) {
        const A = sections[0];
        for (let i = 1; i < n - 1; i++) {
          this.tri([A.pts[0][0], A.y, A.pts[0][1]],
            [A.pts[i + 1][0], A.y, A.pts[i + 1][1]],
            [A.pts[i][0], A.y, A.pts[i][1]], A.col || this.c);
        }
      }
      if (capTop !== false) {
        const B = sections[sections.length - 1];
        for (let i = 1; i < n - 1; i++) {
          this.tri([B.pts[0][0], B.y, B.pts[0][1]],
            [B.pts[i][0], B.y, B.pts[i][1]],
            [B.pts[i + 1][0], B.y, B.pts[i + 1][1]], B.col || this.c);
        }
      }
      return this;
    }

    build() {
      return {
        pos: new Float32Array(this.pos),
        nrm: new Float32Array(this.nrm),
        col: new Float32Array(this.col)
      };
    }
  }

  /* Rounded-rectangle outline used for car body sections and buildings.
   * `w` half-width, `l` half-length, `r` corner rounding 0..1. */
  function outline(w, l, r, noseTaper) {
    const nt = noseTaper === undefined ? 1 : noseTaper;
    const k = r;
    return [
      [0, l],                       // nose centre
      [w * nt * k, l * (1 - 0.06)],
      [w * nt, l * (1 - 0.30)],
      [w, l * 0.10],
      [w, -l * 0.70],
      [w * k, -l],
      [-w * k, -l],
      [-w, -l * 0.70],
      [-w, l * 0.10],
      [-w * nt, l * (1 - 0.30)],
      [-w * nt * k, l * (1 - 0.06)]
    ];
  }

  function scaleOutline(pts, sx, sz, dz) {
    return pts.map(p => [p[0] * sx, p[1] * sz + (dz || 0)]);
  }

  global.Geom = { Builder, outline, scaleOutline };
})(window);
