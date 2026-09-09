/* mathx.js — tiny vector / matrix maths for the renderer.
 * Everything lives on the global `MX` so the files can be plain <script> tags
 * (which means index.html opens straight from disk, no server, no build step). */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sign(v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); }

  /* Frame-rate independent exponential smoothing.
   * `rate` is roughly "how many e-folds per second" — bigger = snappier. */
  function damp(current, target, rate, dt) {
    return lerp(current, target, 1 - Math.exp(-rate * dt));
  }

  /* Shortest signed angular difference, result in (-PI, PI]. */
  function angleDelta(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  function dampAngle(current, target, rate, dt) {
    return current + angleDelta(current, target) * (1 - Math.exp(-rate * dt));
  }

  /* Move `current` toward `target` by at most `maxStep`. */
  function approach(current, target, maxStep) {
    const d = target - current;
    if (Math.abs(d) <= maxStep) return target;
    return current + Math.sign(d) * maxStep;
  }

  /* ---------------------------------------------------------------- mat4
   * Column-major, same layout as WebGL expects. */

  function m4() { return new Float32Array(16); }

  function identity(out) {
    out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
    return out;
  }

  function multiply(out, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      out[i * 4]     = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return out;
  }

  function perspective(out, fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
    return out;
  }

  function lookAt(out, ex, ey, ez, cx, cy, cz, ux, uy, uz) {
    let zx = ex - cx, zy = ey - cy, zz = ez - cz;
    let l = Math.hypot(zx, zy, zz) || 1;
    zx /= l; zy /= l; zz /= l;
    // x = normalize(cross(up, z))
    let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
    l = Math.hypot(xx, xy, xz);
    if (l < 1e-6) { xx = 1; xy = 0; xz = 0; } else { xx /= l; xy /= l; xz /= l; }
    // y = cross(z, x)
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * ex + xy * ey + xz * ez);
    out[13] = -(yx * ex + yy * ey + yz * ez);
    out[14] = -(zx * ex + zy * ey + zz * ez);
    out[15] = 1;
    return out;
  }

  /* Compose translate * rotateY * uniform-ish scale — the only transform the
   * game ever needs for an instance (props are baked at the right size). */
  function compose(out, x, y, z, yaw, sx, sy, sz) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    out[0] = c * sx;  out[1] = 0;   out[2] = -s * sx; out[3] = 0;
    out[4] = 0;       out[5] = sy;  out[6] = 0;       out[7] = 0;
    out[8] = s * sz;  out[9] = 0;   out[10] = c * sz; out[11] = 0;
    out[12] = x;      out[13] = y;  out[14] = z;      out[15] = 1;
    return out;
  }

  /* Full car transform: yaw + a little pitch (squat/dive) and roll (body lean). */
  function composeCar(out, x, y, z, yaw, pitch, roll) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    // R = Ry * Rx(pitch) * Rz(roll)
    out[0]  = cy * cr + sy * sp * sr;
    out[1]  = cp * sr;
    out[2]  = -sy * cr + cy * sp * sr;
    out[3]  = 0;
    out[4]  = -cy * sr + sy * sp * cr;
    out[5]  = cp * cr;
    out[6]  = sy * sr + cy * sp * cr;
    out[7]  = 0;
    out[8]  = sy * cp;
    out[9]  = -sp;
    out[10] = cy * cp;
    out[11] = 0;
    out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
    return out;
  }

  global.MX = {
    TAU, clamp, lerp, sign, damp, dampAngle, angleDelta, approach,
    m4, identity, multiply, perspective, lookAt, compose, composeCar
  };
})(window);
