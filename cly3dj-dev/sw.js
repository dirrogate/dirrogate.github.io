// Service worker (CLAUDE.md #66). Lets the app be installed, and lets it start with no network once it has
// been opened online at least once: every app file is fetched from the network first (so updates arrive as
// soon as you're online) and the last good copy is kept for offline use.
// Songs are never cached here: streamed songs (/vire-music/, range requests) go straight to the network,
// and songs imported on the headset live in the app's own storage (OPFS), not in this cache.
const CACHE = 'vire-app-v1';   // (sw.js itself is always re-checked by the browser, so this change reaches everyone on the next load)
// files the app only fetches later (first record load, first MIC press): fetch them up front
const LATE = ['js/deck-worklet.js', 'js/decode-worker.js', 'js/mic-worklet.js', 'js/bump-worker.js', 'js/spectator-host.js', 'js/net-link.js', 'js/spectator-client.js', 'js/ledwall.js', 'js/videovinyl.js', 'js/camtest.js', 'js/vset.js', 'js/medialib.js', 'js/phonelib.js', 'js/skybox.js', 'vendor/three/libs/basis/basis_transcoder.js', 'vendor/three/libs/basis/basis_transcoder.wasm'];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(LATE.map(f => c.add(new URL(f, self.registration.scope).href).catch(() => null)))));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
// the page sends the files it loaded before this worker took control, so even the first visit is kept
self.addEventListener('message', e => {
  const urls = (e.data && e.data.cache) || [];
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(urls.map(u => fetch(u).then(r => r.ok && r.type === 'basic' ? c.put(u, r) : null).catch(() => null)))));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.headers.has('range') || /\/vire-music\//.test(url.pathname) || /\.(mp3|m4a|wav|flac|aiff?|ogg|mp4|m4v|webm|mov)$/i.test(url.pathname)) return;   // #177: videos never cached here
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // #178: always revalidate with the server (a 304 costs almost nothing). Without this the browser's own
      // HTTP cache (GitHub Pages: max-age=600) kept serving yesterday's app code for up to 10 minutes after a push.
      const res = await fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' });
      if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
