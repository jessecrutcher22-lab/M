/* tracks.js — the circuits.
 *
 * A layout is written as a list of [bearing°, radius, height] samples around
 * a loop. Because every point is defined by its angle from the centre, the
 * resulting closed curve is star-shaped and therefore CANNOT cross itself —
 * which makes hand-authoring a new circuit quick and safe. Character comes
 * from how hard the radius swings: gentle swings give fast sweepers, sharp
 * ones give hairpins.
 *
 * Adding a track: add an entry here. Nothing else needs to change. */
(function (global) {
  'use strict';

  function shapeToPoints(shape) {
    return shape.map(([deg, r, y]) => {
      const a = deg * Math.PI / 180;
      return [Math.cos(a) * r, Math.sin(a) * r, y || 0];
    });
  }

  const DEFS = [
    {
      id: 'coast',
      name: 'AZURE COAST',
      blurb: 'Long fast sweepers above the sea. Carry speed, brake late.',
      env: 'coast',
      scenery: 'coast',
      width: 18,
      runoff: 9,
      accent: '#2ec4b6',
      shape: [
        [0, 520], [22, 545], [45, 485], [68, 400], [90, 375],
        [112, 415], [135, 505], [158, 550], [180, 525], [200, 430],
        [218, 358], [235, 342], [252, 392], [270, 472], [292, 542],
        [315, 558], [338, 548]
      ]
    },
    {
      id: 'neon',
      name: 'NEON MILE',
      blurb: 'Downtown at midnight. Short bursts between hard, tight corners.',
      env: 'night',
      scenery: 'city',
      width: 16,
      runoff: 5,
      accent: '#ff2e6a',
      shape: [
        [0, 395], [17, 385], [32, 268], [48, 238], [64, 315],
        [80, 372], [96, 366], [110, 258], [125, 222], [142, 238],
        [159, 320], [176, 374], [192, 368], [208, 275], [223, 228],
        [239, 242], [256, 328], [273, 388], [289, 398], [305, 318],
        [319, 262], [333, 276], [347, 348]
      ]
    },
    {
      id: 'ridge',
      name: 'RIDGE PASS',
      blurb: 'A climb and a plunge. Blind crests, cold tarmac, no room.',
      env: 'mountain',
      scenery: 'alpine',
      width: 17,
      runoff: 7,
      accent: '#ffc734',
      shape: [
        [0, 600, 0], [25, 625, 14], [50, 525, 32], [72, 392, 48],
        [92, 342, 60], [112, 392, 68], [135, 508, 72], [158, 595, 62],
        [180, 615, 46], [202, 545, 30], [222, 428, 17], [240, 340, 8],
        [258, 330, 2], [275, 408, 0], [295, 525, 0], [318, 605, 0],
        [340, 620, 0]
      ]
    }
  ];

  const TRACKS = DEFS.map(d => Object.assign({}, d, { points: shapeToPoints(d.shape) }));

  function byId(id) { return TRACKS.find(t => t.id === id) || TRACKS[0]; }

  global.Tracks = { list: TRACKS, byId, shapeToPoints };
})(window);
