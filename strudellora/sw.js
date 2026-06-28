// ═══════════════════════════════════════════════════════════════
// STRUDELLORA SERVICE WORKER v2
//
// KEY CHANGE from v1: Model weights are NO LONGER cached by the SW.
// WebLLM manages its own persistent cache in IndexedDB (via the
// Cache API internally, but under its own origin key). If the SW
// also stores weights in Cache Storage, you get double the disk
// usage (~540MB instead of ~270MB) which blows the browser quota.
//
// Strategy:
//   App shell (HTML/JS/CSS)  → Cache First (SW manages this)
//   CDN scripts (Three, etc) → Cache First (SW manages this)
//   WebLLM model weights      → Pass through, DO NOT cache (WebLLM handles it)
//   Strudel.cc iframe         → Network first, offline placeholder on fail
//   Everything else           → Network first
// ═══════════════════════════════════════════════════════════════

const APP_VERSION = 'v2';
const SHELL_CACHE = `strudellora-shell-${APP_VERSION}`;
const CDN_CACHE   = `strudellora-cdn-${APP_VERSION}`;

// App shell — cached on SW install so the page loads offline instantly
const SHELL_FILES = [
    './',
    './index.html',
    './speech.js',
    './avatar.js',
    './manifest.json',
];

// CDN origins whose scripts we cache (but NOT model weights)
const CDN_SCRIPT_ORIGINS = [
    'cdnjs.cloudflare.com',
];

// Patterns that identify WebLLM model weight / wasm / config fetches.
// These are passed straight through — WebLLM caches them itself in IndexedDB.
const MODEL_PASSTHROUGH_PATTERNS = [
    /mlc-ai/,
    /web-llm/,
    /webllm/,
    /MLC/,
    /params_shard/,
    /\.wasm/,
    /tokenizer/,
    /ndarray-cache/,
    /mlc-chat-config/,
    /huggingface\.co/,
    /hf\.co/,
    /esm\.run/,
    /esm\.sh/,
    /cdn\.jsdelivr\.net.*mlc/i,
];

function isModelRequest(url) {
    return MODEL_PASSTHROUGH_PATTERNS.some(p => p.test(url));
}

function isCDNScript(url) {
    return CDN_SCRIPT_ORIGINS.some(o => url.includes(o));
}

// ── INSTALL ─────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(SHELL_FILES))
            .then(() => self.skipWaiting())
            .catch(err => console.warn('[SW] Shell pre-cache failed:', err))
    );
});

// ── ACTIVATE — delete old caches (v1 model cache freed here) ────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys
                .filter(k => k !== SHELL_CACHE && k !== CDN_CACHE)
                .map(k => {
                    console.log('[SW] Deleting old cache:', k);
                    return caches.delete(k);
                })
        )).then(() => self.clients.claim())
    );
});

// ── FETCH ────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = request.url;

    if (request.method !== 'GET') return;
    if (url.startsWith('chrome-extension://')) return;
    if (url.startsWith('blob:')) return;

    // WebLLM model weights / wasm — pass straight through, no SW caching
    if (isModelRequest(url)) return;

    // Strudel.cc — network first, offline placeholder on failure
    if (url.includes('strudel.cc')) {
        event.respondWith(
            fetch(request).catch(() => new Response(strudelPlaceholder(), {
                headers: { 'Content-Type': 'text/html' }
            }))
        );
        return;
    }

    // CDN scripts (Three.js etc) — cache first
    if (isCDNScript(url)) {
        event.respondWith(cacheFirst(request, CDN_CACHE));
        return;
    }

    // App shell (same origin) — cache first
    if (url.startsWith(self.location.origin)) {
        event.respondWith(cacheFirst(request, SHELL_CACHE));
        return;
    }

    // Everything else — network first, no caching
    event.respondWith(
        fetch(request).catch(() => caches.match(request))
    );
});

// ── CACHE FIRST STRATEGY ─────────────────────────────────────────
async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        return new Response('Offline — resource not cached.', { status: 503 });
    }
}

// ── OFFLINE STRUDEL PLACEHOLDER ──────────────────────────────────
function strudelPlaceholder() {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body{background:#0a0a0a;color:#555;font-family:monospace;
       display:flex;align-items:center;justify-content:center;
       height:100vh;margin:0;flex-direction:column;gap:12px}
  h2{color:#f59e0b;font-size:14px;margin:0}
  p{font-size:12px;text-align:center;max-width:280px;line-height:1.6}
</style></head><body>
  <h2>strudel.cc unavailable offline</h2>
  <p>You're offline. Copy generated code from the left panel and paste it into strudel.cc when back online.</p>
</body></html>`;
}
