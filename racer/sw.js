/* sw.js — offline cache, so Apex Rush works installed on a phone with no
 * connection. Bump CACHE when any file changes. */
const CACHE = 'apex-rush-v1';
const FILES = [
  './', './index.html', './manifest.webmanifest', './icon.svg',
  './css/style.css',
  './js/mathx.js', './js/gl.js', './js/geom.js', './js/tune.js', './js/scene.js',
  './js/input.js', './js/car.js', './js/carmodel.js', './js/camera.js',
  './js/effects.js', './js/track.js', './js/tracks.js', './js/trackmesh.js',
  './js/scenery.js', './js/race.js', './js/ai.js', './js/touch.js',
  './js/ui.js', './js/game.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
