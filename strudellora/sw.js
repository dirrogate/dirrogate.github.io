// ═══════════════════════════════════════════════════════════════
// STRUDELLORA SERVICE WORKER
// Caches the app shell + WebLLM model weights for full offline use.
//
// Strategy:
//   App shell (HTML/JS/CSS)  → Cache First, update in background
//   CDN scripts (Three, etc) → Cache First
//   WebLLM model weights      → Cache First (large files, never change)
//   Strudel.cc iframe         → Network First, fall back to placeholder
//   Everything else           → Network First
// ═══════════════════════════════════════════════════════════════

const APP_VERSION  = 'v1';
const SHELL_CACHE  = `strudellora-shell-${APP_VERSION}`;
const MODEL_CACHE  = `strudellora-model-${APP_VERSION}`;
const CDN_CACHE    = `strudellora-cdn-${APP_VERSION}`;

// ── App shell files (served from your GitHub Pages origin) ─────
// These are fetched and cached on SW install.
const SHELL_FILES = [
    './',
    './strudellora.html',
    './speech.js',
    './avatar.js',
    './manifest.json',
];

// ── CDN scripts ─────────────────────────────────────────────────
// Cached on first fetch, served from cache thereafter.
const CDN_ORIGINS = [
    'cdnjs.cloudflare.com',
    'cdn.jsdelivr.net',
    'esm.run',
    'esm.sh',
    'unpkg.com',
];

// ── WebLLM model weight origins ─────────────────────────────────
// All HuggingFace / WebLLM CDN traffic is treated as model weight
// traffic and stored in the dedicated (large) model cache.
const MODEL_ORIGINS = [
    'huggingface.co',
    'hf.co',
    'cdn.jsdelivr.net',   // WebLLM also pulls wasm from here
];

// WebLLM weight URL patterns (to distinguish from other jsdelivr CDN)
const MODEL_URL_PATTERNS = [
    /mlc-ai/,
    /webllm/,
    /MLC/,
    /params_shard/,
    /\.wasm/,
    /tokenizer/,
    /ndarray-cache/,
    /mlc-chat-config/,
];

function isModelURL(url) {
    return MODEL_URL_PATTERNS.some(p => p.test(url));
}

function isCDNURL(url) {
    return CDN_ORIGINS.some(origin => url.includes(origin)) && !isModelURL(url);
}

// ── INSTALL ─────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(SHELL_FILES))
            .then(() => self.skipWaiting())
            .catch(err => console.warn('[SW] Shell cache failed:', err))
    );
});

// ── ACTIVATE (clean up old caches) ──────────────────────────────
self.addEventListener('activate', (event) => {
    const validCaches = [SHELL_CACHE, MODEL_CACHE, CDN_CACHE];
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(k => !validCaches.includes(k))
                    .map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// ── FETCH ────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = request.url;

    // Don't intercept non-GET or chrome-extension requests
    if (request.method !== 'GET') return;
    if (url.startsWith('chrome-extension://')) return;

    // Strudel.cc iframe — network first, don't cache (external app)
    if (url.includes('strudel.cc')) {
        event.respondWith(fetch(request).catch(() =>
            new Response(strudelOfflinePlaceholder(), {
                headers: { 'Content-Type': 'text/html' }
            })
        ));
        return;
    }

    // WebLLM model weights — cache first, then network, report progress
    if (isModelURL(url)) {
        event.respondWith(cacheFirstModel(request));
        return;
    }

    // CDN scripts — cache first
    if (isCDNURL(url)) {
        event.respondWith(cacheFirst(request, CDN_CACHE));
        return;
    }

    // App shell — cache first, update in background
    if (url.includes(self.location.origin)) {
        event.respondWith(cacheFirst(request, SHELL_CACHE));
        return;
    }

    // Everything else — network first
    event.respondWith(
        fetch(request).catch(() => caches.match(request))
    );
});

// ── STRATEGIES ───────────────────────────────────────────────────

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

// Model weight caching with progress reporting to the page
let modelTotal   = 0;
let modelDone    = 0;
let modelCounted = false;

async function cacheFirstModel(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (!response.ok) return response;

        // Clone before consuming
        const responseToCache = response.clone();
        const cache = await caches.open(MODEL_CACHE);
        await cache.put(request, responseToCache);

        // Report progress to all open clients
        modelDone++;
        const filename = request.url.split('/').pop();
        notifyClients({
            type:  'CACHE_PROGRESS',
            file:  filename,
            done:  modelDone,
            total: modelTotal || '?',
        });

        // If this looks like the last shard, fire CACHE_COMPLETE
        // WebLLM fetches a fixed set; we heuristically detect completion
        // by checking if the model cache has reached a stable count.
        checkIfCacheComplete();

        return response;
    } catch (err) {
        console.warn('[SW] Model fetch failed:', err);
        return new Response('Model weight fetch failed.', { status: 503 });
    }
}

async function checkIfCacheComplete() {
    const cache = await caches.open(MODEL_CACHE);
    const keys  = await cache.keys();
    // Qwen 0.5B has ~8 weight shards + config files ≈ 12-15 entries total.
    // Fire CACHE_COMPLETE once we've seen at least 10 model cache entries
    // and nothing new for 3 seconds — robust across model size variants.
    clearTimeout(self._completeTimer);
    self._completeTimer = setTimeout(async () => {
        const finalKeys = await cache.keys();
        if (finalKeys.length >= 8) {
            notifyClients({ type: 'CACHE_COMPLETE', count: finalKeys.length });
        }
    }, 3000);
}

async function notifyClients(data) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(client => client.postMessage(data));
}

// ── OFFLINE STRUDEL PLACEHOLDER ─────────────────────────────────
function strudelOfflinePlaceholder() {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { background:#0a0a0a; color:#555; font-family:monospace;
         display:flex; align-items:center; justify-content:center;
         height:100vh; margin:0; flex-direction:column; gap:12px; }
  h2 { color:#f59e0b; font-size:14px; margin:0; }
  p  { font-size:12px; text-align:center; max-width:280px; line-height:1.6; }
  code { color:#a3e635; background:#111; padding:2px 6px; border-radius:3px; }
</style>
</head>
<body>
  <h2>strudel.cc unavailable offline</h2>
  <p>You're offline. Copy generated Strudel code from the left panel and paste it into strudel.cc when you're back online.</p>
  <p>Generated code is in your chat history on the left.</p>
</body>
</html>`;
}
