/* gl.js — a small WebGL2 renderer built for exactly what this game needs:
 * flat-shaded low-poly instanced meshes, a gradient sky, fog, and two
 * dynamic buffers for skid marks and smoke. No dependencies.  */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------ shaders */

  const V_MAIN = `#version 300 es
  layout(location=0) in vec3 aPos;
  layout(location=1) in vec3 aNrm;
  layout(location=2) in vec3 aCol;
  layout(location=3) in vec4 iM0;
  layout(location=4) in vec4 iM1;
  layout(location=5) in vec4 iM2;
  layout(location=6) in vec4 iM3;
  layout(location=7) in vec4 iTint;   // rgb multiplier + emissive amount

  uniform mat4 uViewProj;

  out vec3 vNrm;
  out vec3 vCol;
  out vec3 vWorld;
  out float vEmis;

  void main() {
    mat4 M = mat4(iM0, iM1, iM2, iM3);
    vec4 wp = M * vec4(aPos, 1.0);
    vNrm = normalize(mat3(M) * aNrm);
    vCol = aCol * iTint.rgb;
    vEmis = iTint.a;
    vWorld = wp.xyz;
    gl_Position = uViewProj * wp;
  }`;

  const F_MAIN = `#version 300 es
  precision highp float;
  in vec3 vNrm;
  in vec3 vCol;
  in vec3 vWorld;
  in float vEmis;

  uniform vec3 uCamPos;
  uniform vec2 uFog;                  // fog start, fog end
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform vec3 uSkyCol;
  uniform vec3 uGroundCol;
  uniform vec3 uFogCol;
  uniform float uAmbient;

  out vec4 frag;

  void main() {
    vec3 N = normalize(vNrm);
    // Wrapped lambert: shaded faces keep some colour instead of going black,
    // which is what gives the low-poly look its readability.
    float ndl = max(dot(N, uSunDir), 0.0);
    float wrap = ndl * 0.88 + 0.12;
    vec3 hemi = mix(uGroundCol, uSkyCol, N.y * 0.5 + 0.5) * uAmbient;
    vec3 lit = vCol * (hemi + uSunCol * wrap) + vCol * vEmis;
    // Fog is computed per fragment, not per vertex: road and ground panels are
    // huge triangles and interpolating fog across them looks badly wrong.
    float d = distance(vWorld, uCamPos);
    float f = clamp((d - uFog.x) / max(uFog.y - uFog.x, 1.0), 0.0, 1.0);
    frag = vec4(mix(lit, uFogCol, f), 1.0);
  }`;

  /* Unlit, vertex-coloured, alpha-blended — skid marks and smoke. */
  const V_DYN = `#version 300 es
  layout(location=0) in vec3 aPos;
  layout(location=1) in vec4 aCol;
  uniform mat4 uViewProj;
  out vec4 vCol;
  out vec3 vWorld;
  void main() {
    vCol = aCol;
    vWorld = aPos;
    gl_Position = uViewProj * vec4(aPos, 1.0);
  }`;

  const F_DYN = `#version 300 es
  precision highp float;
  in vec4 vCol;
  in vec3 vWorld;
  uniform vec3 uFogCol;
  uniform vec3 uCamPos;
  uniform vec2 uFog;
  out vec4 frag;
  void main() {
    float d = distance(vWorld, uCamPos);
    float f = clamp((d - uFog.x) / max(uFog.y - uFog.x, 1.0), 0.0, 1.0);
    frag = vec4(mix(vCol.rgb, uFogCol, f), vCol.a * (1.0 - f));
  }`;

  /* Fullscreen gradient sky. */
  const V_SKY = `#version 300 es
  layout(location=0) in vec2 aPos;
  out vec2 vUv;
  void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.9999, 1.0); }`;

  const F_SKY = `#version 300 es
  precision highp float;
  in vec2 vUv;
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uBottom;
  uniform float uHorizon;    // screen height of the horizon, 0..1 from bottom
  uniform vec2 uSunPos;      // screen position of the sun glow
  uniform vec3 uSunGlow;
  out vec4 frag;
  void main() {
    float t = clamp((vUv.y - uHorizon) / max(1.0 - uHorizon, 0.001), 0.0, 1.0);
    float b = clamp(vUv.y / max(uHorizon, 0.001), 0.0, 1.0);
    vec3 c = vUv.y > uHorizon ? mix(uMid, uTop, pow(t, 0.75)) : mix(uBottom, uMid, b);
    // Cheap sun/moon bloom so the sky is not a flat ramp.
    float d = distance(vec2(vUv.x * 1.7, vUv.y), vec2(uSunPos.x * 1.7, uSunPos.y));
    c += uSunGlow * exp(-d * 6.0) * 1.2;
    frag = vec4(c, 1.0);
  }`;

  /* --------------------------------------------------------------- utils */

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('shader: ' + gl.getShaderInfoLog(s) + '\n' + src);
    }
    return s;
  }

  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(p));
    }
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  const INSTANCE_FLOATS = 20;   // mat4 (16) + tint rgb + emissive

  /* ---------------------------------------------------------------- Mesh
   * Static geometry + a growable per-instance buffer. Every draw is an
   * instanced draw, even for a single object — it keeps one code path. */
  class Mesh {
    constructor(gl, geo, opts) {
      opts = opts || {};
      this.gl = gl;
      this.count = geo.pos.length / 3;
      this.layer = opts.layer || 0;
      this.instances = 0;
      this.capacity = opts.capacity || 16;
      this.data = new Float32Array(this.capacity * INSTANCE_FLOATS);
      this.dirty = true;
      this.visible = true;

      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);

      const mk = (arr, loc, size) => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        return b;
      };
      mk(geo.pos, 0, 3);
      mk(geo.nrm, 1, 3);
      mk(geo.col, 2, 3);

      this.ibuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
      const stride = INSTANCE_FLOATS * 4;
      for (let i = 0; i < 5; i++) {
        const loc = 3 + i;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, stride, i * 16);
        gl.vertexAttribDivisor(loc, 1);
      }
      gl.bindVertexArray(null);
    }

    reset() { this.instances = 0; }

    /* mat: Float32Array(16); tint rgb multiplier; emis 0..1 */
    add(mat, r, g, b, emis) {
      if (this.instances >= this.capacity) this._grow();
      const o = this.instances * INSTANCE_FLOATS;
      this.data.set(mat, o);
      this.data[o + 16] = r === undefined ? 1 : r;
      this.data[o + 17] = g === undefined ? 1 : g;
      this.data[o + 18] = b === undefined ? 1 : b;
      this.data[o + 19] = emis || 0;
      this.instances++;
      this.dirty = true;
    }

    _grow() {
      this.capacity *= 2;
      const nd = new Float32Array(this.capacity * INSTANCE_FLOATS);
      nd.set(this.data);
      this.data = nd;
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf);
      gl.bufferData(gl.ARRAY_BUFFER, nd.byteLength, gl.DYNAMIC_DRAW);
    }

    /* Instance data that never changes (scenery) only needs uploading once. */
    freeze() { this._upload(); this.frozen = true; }

    _upload() {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.instances * INSTANCE_FLOATS);
      this.dirty = false;
    }

    dispose() {
      this.gl.deleteVertexArray(this.vao);
      this.gl.deleteBuffer(this.ibuf);
    }
  }

  /* -------------------------------------------------------- DynamicMesh
   * A growable triangle soup of (xyz, rgba) vertices, rebuilt each frame or
   * appended to over time. Used for skid marks and smoke billboards. */
  class DynamicMesh {
    constructor(gl, maxVerts, opts) {
      opts = opts || {};
      this.gl = gl;
      this.max = maxVerts;
      this.data = new Float32Array(maxVerts * 7);
      this.n = 0;
      this.lo = 0; this.hi = 0;      // dirty range, in vertices
      this.depthWrite = !!opts.depthWrite;
      this.additive = !!opts.additive;
      this.offset = opts.polygonOffset || 0;
      this.persistent = !!opts.persistent;

      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      this.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
      gl.bindVertexArray(null);
    }

    clear() { this.n = 0; this.lo = 0; this.hi = 0; }

    /* Mark a vertex range as needing re-upload (append-only buffers such as
     * the skid trail only ever touch a few vertices per frame). */
    touch(from, to) {
      if (this.hi === this.lo) { this.lo = from; this.hi = to; }
      else { this.lo = Math.min(this.lo, from); this.hi = Math.max(this.hi, to); }
    }

    /* Overwrite a quad in place, for ring-buffer trails. */
    quadAt(i, p0, p1, p2, p3, r, g, b, a) {
      const base = i * 6;
      if (base + 6 > this.max) return;
      const d = this.data;
      const put = (k, p) => {
        const o = (base + k) * 7;
        d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2];
        d[o + 3] = r; d[o + 4] = g; d[o + 5] = b; d[o + 6] = a;
      };
      put(0, p0); put(1, p1); put(2, p2);
      put(3, p0); put(4, p2); put(5, p3);
      this.touch(base, base + 6);
      if (base + 6 > this.n) this.n = base + 6;
    }

    vert(x, y, z, r, g, b, a) {
      if (this.n >= this.max) return false;
      const o = this.n * 7;
      const d = this.data;
      d[o] = x; d[o + 1] = y; d[o + 2] = z;
      d[o + 3] = r; d[o + 4] = g; d[o + 5] = b; d[o + 6] = a;
      this.n++;
      return true;
    }

    /* Two triangles from four corners, one flat colour. */
    quad(p0, p1, p2, p3, r, g, b, a) {
      if (this.n + 6 > this.max) return false;
      this.vert(p0[0], p0[1], p0[2], r, g, b, a);
      this.vert(p1[0], p1[1], p1[2], r, g, b, a);
      this.vert(p2[0], p2[1], p2[2], r, g, b, a);
      this.vert(p0[0], p0[1], p0[2], r, g, b, a);
      this.vert(p2[0], p2[1], p2[2], r, g, b, a);
      this.vert(p3[0], p3[1], p3[2], r, g, b, a);
      return true;
    }

    /* A soft round billboard: a fan whose rim alpha is zero, which fakes a
     * radial falloff without needing a texture. */
    disc(cx, cy, cz, rx, ry, rz, ux, uy, uz, radius, r, g, b, a, seg) {
      seg = seg || 7;
      if (this.n + seg * 3 > this.max) return false;
      const inner = 0.30;   // solid core, then fade out to the rim
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const c0 = Math.cos(a0) * radius, s0 = Math.sin(a0) * radius;
        const c1 = Math.cos(a1) * radius, s1 = Math.sin(a1) * radius;
        this.vert(cx, cy, cz, r, g, b, a);
        this.vert(cx + rx * c0 + ux * s0, cy + ry * c0 + uy * s0, cz + rz * c0 + uz * s0, r, g, b, a * inner * 0.0);
        this.vert(cx + rx * c1 + ux * s1, cy + ry * c1 + uy * s1, cz + rz * c1 + uz * s1, r, g, b, a * inner * 0.0);
      }
      return true;
    }

    upload() {
      if (!this.n) return;
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      if (this.persistent) {
        // Only the vertices that actually changed this frame.
        if (this.hi > this.lo) {
          gl.bufferSubData(gl.ARRAY_BUFFER, this.lo * 28,
            this.data, this.lo * 7, (this.hi - this.lo) * 7);
          this.lo = this.hi = 0;
        }
      } else {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.n * 7);
      }
    }
  }

  /* ------------------------------------------------------------ Renderer */

  class Renderer {
    constructor(canvas) {
      const gl = canvas.getContext('webgl2', {
        antialias: true, alpha: false, powerPreference: 'high-performance',
        depth: true, stencil: false
      });
      if (!gl) throw new Error('WebGL2 is not available in this browser.');
      this.gl = gl;
      this.canvas = canvas;
      this.main = program(gl, V_MAIN, F_MAIN);
      this.dyn = program(gl, V_DYN, F_DYN);
      this.sky = program(gl, V_SKY, F_SKY);
      this.meshes = [];
      this.dynamics = [];

      // Fullscreen triangle for the sky pass.
      this.skyVao = gl.createVertexArray();
      gl.bindVertexArray(this.skyVao);
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);

      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);

      this.viewProj = MX.m4();
      this.view = MX.m4();
      this.proj = MX.m4();
      this.dpr = 1;
    }

    createMesh(geo, opts) {
      const m = new Mesh(this.gl, geo, opts);
      this.meshes.push(m);
      return m;
    }

    removeMesh(mesh) {
      const i = this.meshes.indexOf(mesh);
      if (i >= 0) this.meshes.splice(i, 1);
      mesh.dispose();
    }

    createDynamic(maxVerts, opts) {
      const d = new DynamicMesh(this.gl, maxVerts, opts);
      this.dynamics.push(d);
      return d;
    }

    /* Remove every mesh and dynamic buffer — used when tearing a track down. */
    clearScene() {
      for (const m of this.meshes) m.dispose();
      this.meshes.length = 0;
      for (const d of this.dynamics) {
        this.gl.deleteVertexArray(d.vao);
        this.gl.deleteBuffer(d.buf);
      }
      this.dynamics.length = 0;
    }

    resize(maxDpr) {
      const c = this.canvas;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr || 2);
      const w = Math.round(c.clientWidth * dpr);
      const h = Math.round(c.clientHeight * dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w; c.height = h;
        this.gl.viewport(0, 0, w, h);
      }
      this.dpr = dpr;
      this.aspect = (c.clientWidth || 1) / (c.clientHeight || 1);
    }

    render(cam, env) {
      const gl = this.gl;
      MX.perspective(this.proj, cam.fov * Math.PI / 180, this.aspect, 0.3, env.far || 900);
      MX.lookAt(this.view, cam.x, cam.y, cam.z, cam.tx, cam.ty, cam.tz, cam.ux, cam.uy, cam.uz);
      MX.multiply(this.viewProj, this.proj, this.view);

      gl.depthMask(true);
      gl.clearColor(env.fogCol[0], env.fogCol[1], env.fogCol[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      /* --- sky --- */
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.sky.p);
      gl.bindVertexArray(this.skyVao);
      gl.uniform3fv(this.sky.u.uTop, env.skyTop);
      gl.uniform3fv(this.sky.u.uMid, env.skyMid);
      gl.uniform3fv(this.sky.u.uBottom, env.skyBottom);
      gl.uniform1f(this.sky.u.uHorizon, env.horizon === undefined ? 0.5 : env.horizon);
      gl.uniform2fv(this.sky.u.uSunPos, env.sunScreen || [0.5, 0.8]);
      gl.uniform3fv(this.sky.u.uSunGlow, env.sunGlow || [0, 0, 0]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST);

      /* --- opaque geometry --- */
      const M = this.main;
      gl.useProgram(M.p);
      gl.uniformMatrix4fv(M.u.uViewProj, false, this.viewProj);
      gl.uniform3f(M.u.uCamPos, cam.x, cam.y, cam.z);
      gl.uniform2f(M.u.uFog, env.fogNear, env.fogFar);
      gl.uniform3fv(M.u.uSunDir, env.sunDir);
      gl.uniform3fv(M.u.uSunCol, env.sunCol);
      gl.uniform3fv(M.u.uSkyCol, env.hemiSky);
      gl.uniform3fv(M.u.uGroundCol, env.hemiGround);
      gl.uniform3fv(M.u.uFogCol, env.fogCol);
      gl.uniform1f(M.u.uAmbient, env.ambient);

      gl.disable(gl.BLEND);
      gl.depthMask(true);
      let drawn = 0;
      for (const m of this.meshes) {
        if (!m.visible || !m.instances) continue;
        if (m.dirty && !m.frozen) m._upload();
        gl.bindVertexArray(m.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, m.instances);
        drawn += m.instances;
      }

      /* --- dynamic, blended layers --- */
      const D = this.dyn;
      gl.useProgram(D.p);
      gl.uniformMatrix4fv(D.u.uViewProj, false, this.viewProj);
      gl.uniform3f(D.u.uCamPos, cam.x, cam.y, cam.z);
      gl.uniform2f(D.u.uFog, env.fogNear, env.fogFar);
      gl.uniform3fv(D.u.uFogCol, env.fogCol);
      gl.enable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      for (const d of this.dynamics) {
        if (!d.n) continue;
        gl.depthMask(d.depthWrite);
        gl.blendFunc(gl.SRC_ALPHA, d.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
        if (d.offset) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -d.offset); }
        d.upload();
        gl.bindVertexArray(d.vao);
        gl.drawArrays(gl.TRIANGLES, 0, d.n);
        if (d.offset) gl.disable(gl.POLYGON_OFFSET_FILL);
      }
      gl.enable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.bindVertexArray(null);
      this.lastInstances = drawn;
    }
  }

  global.GL = { Renderer, Mesh, DynamicMesh };
})(window);
