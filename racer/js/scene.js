/* scene.js — lighting / sky / fog presets. One per track setting, plus a
 * neutral one for the physics test plane. */
(function (global) {
  'use strict';

  function norm(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  const ENVS = {
    /* Bright, neutral, high contrast — used by the handling playground. */
    test: {
      skyTop: [0.16, 0.42, 0.78], skyMid: [0.48, 0.72, 0.95], skyBottom: [0.70, 0.82, 0.92],
      horizon: 0.46, sunScreen: [0.72, 0.80], sunGlow: [0.35, 0.30, 0.16],
      fogCol: [0.70, 0.82, 0.92], fogNear: 220, fogFar: 720, far: 1400,
      sunDir: norm([0.42, 0.80, 0.43]), sunCol: [0.95, 0.92, 0.84],
      hemiSky: [0.42, 0.55, 0.78], hemiGround: [0.30, 0.28, 0.24], ambient: 0.55,
      groundA: [0.32, 0.56, 0.31], groundB: [0.26, 0.47, 0.26]
    },

    /* Coastal — hot afternoon, sea haze, sand and turquoise. */
    coast: {
      skyTop: [0.10, 0.36, 0.72], skyMid: [0.42, 0.70, 0.94], skyBottom: [0.86, 0.86, 0.82],
      horizon: 0.44, sunScreen: [0.80, 0.72], sunGlow: [0.55, 0.42, 0.20],
      fogCol: [0.83, 0.85, 0.83], fogNear: 260, fogFar: 800, far: 1600,
      sunDir: norm([0.55, 0.68, 0.48]), sunCol: [1.02, 0.95, 0.80],
      hemiSky: [0.45, 0.62, 0.85], hemiGround: [0.44, 0.38, 0.28], ambient: 0.60,
      groundA: [0.82, 0.74, 0.52], groundB: [0.76, 0.69, 0.48]
    },

    /* City night — deep blue, neon bounce, tight fog for atmosphere. */
    night: {
      skyTop: [0.015, 0.02, 0.06], skyMid: [0.05, 0.06, 0.16], skyBottom: [0.10, 0.08, 0.16],
      horizon: 0.40, sunScreen: [0.22, 0.86], sunGlow: [0.10, 0.11, 0.22],
      fogCol: [0.055, 0.06, 0.12], fogNear: 130, fogFar: 460, far: 1000,
      sunDir: norm([-0.35, 0.72, -0.30]), sunCol: [0.30, 0.33, 0.52],
      hemiSky: [0.14, 0.16, 0.36], hemiGround: [0.16, 0.08, 0.20], ambient: 0.62,
      groundA: [0.10, 0.10, 0.14], groundB: [0.09, 0.09, 0.13],
      night: true
    },

    /* Mountain — cold, thin air, low sun, pine and snow. */
    mountain: {
      skyTop: [0.09, 0.24, 0.52], skyMid: [0.40, 0.60, 0.82], skyBottom: [0.80, 0.76, 0.80],
      horizon: 0.42, sunScreen: [0.24, 0.56], sunGlow: [0.62, 0.34, 0.14],
      fogCol: [0.72, 0.76, 0.84], fogNear: 200, fogFar: 620, far: 1500,
      sunDir: norm([-0.62, 0.42, 0.30]), sunCol: [1.05, 0.86, 0.68],
      hemiSky: [0.38, 0.50, 0.74], hemiGround: [0.30, 0.32, 0.30], ambient: 0.58,
      groundA: [0.30, 0.42, 0.30], groundB: [0.28, 0.39, 0.29]
    }
  };

  function env(name) {
    return Object.assign({}, ENVS[name] || ENVS.test);
  }

  global.Scene = { env, ENVS };
})(window);
