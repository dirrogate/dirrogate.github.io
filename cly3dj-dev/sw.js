// Service worker (CLAUDE.md #66, reworked #222). Lets the app be installed, and lets it start with no network once
// it has been opened online once.
// #222 (owner, outdoors with no Wi-Fi: the installed app showed the browser's "no internet" page):
//  - the page is always filed under one key, <scope>index.html, whatever address it was opened with
//    (…/cly3dj/, …/cly3dj/index.html, ?role=camera…). Before, a visit to …/cly3dj/ was saved only under that
//    address, and the home-screen icon (start_url index.html) found nothing offline.
//  - the whole app is saved on install (APP below), not only the files a session happened to use.
//  - network first, but never waits more than NET_WAIT for it: a Wi-Fi with no internet (phone hotspot without
//    data, dead router) used to hang every request. After one slow or failed request the worker goes straight
//    to the saved copies for OFFLINE_HOLD (and refreshes them in the background).
// Songs and videos are never cached here: streamed songs (/vire-music/, range requests) go straight to the
// network, and songs imported on the headset live in the app's own storage (OPFS).
const CACHE = 'vire-app-v29';   // #500 DirroVJ page, 192 kbit/s master sound
const NET_WAIT = 2500, OFFLINE_HOLD = 30000;
const APP = [
  'index.html', 'spectator.html', 'dirrovj.html', 'venue.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  ...['artfetch', 'loopbank', 'inklabel', 'whiteboard', 'audio', 'beat', 'bump-worker', 'camtest', 'chat', 'deck-glb', 'deck-inst', 'deck-worklet', 'decode-worker', 'director', 'env', 'fakelight', 'fixedcam', 'fixlook',
    'facetwall', 'flightcase', 'fx', 'dirro-host', 'dirrogram', 'wallfx', 'wallfx-worker', 'gopro', 'laser', 'realdepth', 'camfit', 'id3', 'layout', 'ledwall', 'library', 'lookmatch', 'main', 'medialib', 'merge', 'mic-worklet', 'models', 'movieprops', 'neon', 'net-link',
    'keycol', 'neonenv', 'pcampack', 'perfcap', 'sleeves', 'phonelib', 'portal', 'robot', 'robot2', 'skybox', 'spectator-client', 'spectator-host', 'spectator', 'storage', 'stream', 'studio', 'textures', 'tools', 'venue', 'videovinyl', 'vset', 'xr'].map(n => `js/${n}.js`),
  ...['flight_case_kit', 'flight_case_kit_ktx', 'milk_crate', 'milk_crate_ktx', 'mixer_parts', 'neon_sign_glass', 'neon_sign_glass_ktx',
    'record_crate', 'record_crate_ktx', 'turntable', 'avatar/robot', 'avatar/avatar_robot', 'avatar/avatar_robot_v2', 'avatar/dirroface'].map(n => `models/${n}.glb`),
  'models/avatar/gemini_emboss.png', 'models/slipmat_left.jpg', 'models/slipmat_right.jpg', 'models/turntable_ao.json', 'models/turntable_ao.png',
  'vendor/three/three.module.js', 'vendor/qrcode/qrcode.mjs', 'dirrogram.html', 'retroscene.png', 'mattes/matte1.mp4', 'vendor/three/OrbitControls.js', 'vendor/three/RoomEnvironment.js',
  'vendor/three/loaders/GLTFLoader.js', 'vendor/three/loaders/KTX2Loader.js', 'vendor/three/utils/BufferGeometryUtils.js', 'vendor/three/utils/WorkerPool.js',
  'vendor/three/libs/ktx-parse.module.js', 'vendor/three/libs/zstddec.module.js', 'vendor/three/libs/motion-controllers.module.js',
  'vendor/three/libs/basis/basis_transcoder.js', 'vendor/three/libs/basis/basis_transcoder.wasm',
  'vendor/three/webxr/XRControllerModelFactory.js', 'vendor/three/webxr/XRHandModelFactory.js', 'vendor/three/webxr/XRHandMeshModel.js', 'vendor/three/webxr/XRHandPrimitiveModel.js',
  'vendor/webxr-input-profiles/profilesList.json', 'fonts/Monoton.woff2', 'fonts/NotoDevanagariBold.woff2', 'fonts/NotoDevanagariBoldLatin.woff2', 'graff/graff1.png', 'graff/graff2.png', 'graff/decal_lane.png', 'graff/decal_arrow.png', 'graff/decal_tyre.png', 'graff/decal_oil.png', 'graff/decal_leaves.png', 'graff/decal_poster.png', 'graff/decal_rust.png', 'graff/decal_stickers.png', 'plates/alley1.jpg', 'plates/alley2.jpg', 'plates/alley3.jpg', 'surfaces/cobblestone/diff.jpg', 'surfaces/cobblestone/disp.png', 'surfaces/cobblestone/rough.jpg', 'surfaces/concrete/diff.jpg', 'surfaces/concrete/disp.png', 'surfaces/asphalt/diff.jpg', 'surfaces/asphalt/disp.png', 'surfaces/asphalt/rough.jpg', 'models/props/street_lamp_01.glb', 'models/props/street_lamp_02.glb', 'models/props/covered_car.glb', 'models/props/concrete_road_barrier.glb', 'models/props/exterior_aircon.glb', 'models/props/exterior_aircon_rusted.glb', 'models/props/water_manhole.glb',
  ...['generic-hand', 'meta-quest-touch-plus', 'meta-quest-touch-pro', 'oculus-touch-v3'].flatMap(p => ['profile.json', 'left.glb', 'right.glb'].map(f => `vendor/webxr-input-profiles/${p}/${f}`)),
];
const SCOPE = self.registration.scope, PAGE = SCOPE + 'index.html';
let offlineUntil = 0;

// the key a request is saved under: every page address in scope is the one page
function keyOf(req) {
  const u = new URL(req.url);
  if (req.mode === 'navigate' || u.href.split(/[?#]/)[0] === SCOPE) {
    const path = u.origin + u.pathname;
    return path === SCOPE || path === PAGE ? PAGE : path;
  }
  return u.origin + u.pathname;
}
// a redirected response can't answer a navigation, so store a clean copy
async function clean(res) {
  if (!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}
async function save(cache, key, res) {
  if (res && res.ok && res.type === 'basic') { try { await cache.put(key, await clean(res.clone())); } catch {} }
}

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(APP.map(f => {
    const u = new URL(f, SCOPE).href;
    return fetch(u, { cache: 'no-cache' }).then(r => save(c, u, r)).catch(() => null);
  }))));
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));
// the page sends the files it loaded before this worker took control, so even the first visit is kept
self.addEventListener('message', e => {
  const urls = (e.data && e.data.cache) || [];
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(urls.map(u => {
    const key = keyOf(new Request(u));
    return fetch(u).then(r => save(c, key, r)).catch(() => null);
  }))));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.headers.has('range') || /\/vire-music\//.test(url.pathname) || /\.(mp3|m4a|wav|flac|aiff?|ogg|mp4|m4v|webm|mov)$/i.test(url.pathname)) return;   // #177: videos never cached here
  if (/\/api\//.test(url.pathname)) return;   // the PC server's live data (taps)
  const nav = req.mode === 'navigate';
  e.respondWith((async () => {
    const cache = await caches.open(CACHE), key = keyOf(req);
    const saved = () => cache.match(key).then(h => h || cache.match(req, { ignoreSearch: true })).then(h => h || (nav ? cache.match(PAGE) : null));
    // #178: always revalidate with the server (a 304 costs almost nothing): GitHub Pages' max-age=600 otherwise
    // kept yesterday's code for 10 minutes after a push
    const net = fetch(nav ? req.url : req, { cache: 'no-cache' }).then(async res => {
      offlineUntil = 0; await save(cache, key, res); return nav ? clean(res) : res;
    });
    if (Date.now() < offlineUntil) {   // recently offline: saved copy now, refresh quietly
      const hit = await saved();
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    }
    let timer;
    const late = new Promise(res => { timer = setTimeout(res, NET_WAIT, 'late'); });
    try {
      const first = await Promise.race([net, late]);
      if (first !== 'late') { clearTimeout(timer); return first; }
      const hit = await saved();   // network too slow: use the saved copy if there is one
      if (hit) { offlineUntil = Date.now() + OFFLINE_HOLD; e.waitUntil(net.catch(() => {})); return hit; }
      return await net;
    } catch (err) {
      clearTimeout(timer); offlineUntil = Date.now() + OFFLINE_HOLD;
      const hit = await saved();
      if (hit) return hit;
      throw err;
    }
  })());
});
