// #393 Record Maker: sleeve art from Discogs and MusicBrainz (Cover Art Archive), fetched on the tablet before stamping.
// Search by song title + artist, list the releases (vinyl first), open one, then pick its SLEEVE (front), LABEL A and BACK.
//  - MusicBrainz / Cover Art Archive: no key; images come typed (Front, Back, Medium = the disc label). 1 request a second.
//  - Discogs: needs the owner's personal token (60 requests a minute). Its images are untyped (primary = front).
//    i.discogs.com sends no CORS header, so a browser can't read the pixels: those go through the wsrv.nl image proxy.
// The token is never in the code or the repo: it is kept in this device's storage ('vire.discogsToken'), set once by
// opening the app with ?discogs=TOKEN (removed from the address straight away), by TOKEN… on the FETCH ART page, or on
// the PC from web/discogs.local.json ({"token": "..."}; keep that file out of cly3dj-dev / cly3dj).
const MB = 'https://musicbrainz.org/ws/2/', CAA = 'https://coverartarchive.org/', DG = 'https://api.discogs.com/';
const viaProxy = u => 'https://wsrv.nl/?url=' + encodeURIComponent(u);
const https = u => (u || '').replace(/^http:\/\//, 'https://');

export function discogsToken() { try { return localStorage.getItem('vire.discogsToken') || ''; } catch { return ''; } }
export function setDiscogsToken(t) { try { t ? localStorage.setItem('vire.discogsToken', t.trim()) : localStorage.removeItem('vire.discogsToken'); } catch {} }
export async function initDiscogsToken() {
  try {
    const u = new URL(location.href), q = u.searchParams.get('discogs');
    if (q) { setDiscogsToken(q); u.searchParams.delete('discogs'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); }
  } catch {}
  if (!discogsToken()) try { const r = await fetch('discogs.local.json', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (j && j.token) setDiscogsToken(j.token); } } catch {}
  return !!discogsToken();
}

let mbNext = 0;   // MusicBrainz asks for at most one request a second
async function mbJson(url) {
  const wait = mbNext - performance.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait));
  mbNext = performance.now() + 1100;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`MusicBrainz HTTP ${r.status}`);
  return r.json();
}
async function dgJson(path, params = {}) {
  const tok = discogsToken(); if (!tok) throw new Error('no Discogs token on this device (TOKEN…)');
  const u = new URL(DG + path); for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  u.searchParams.set('token', tok);   // a query parameter, not a header: no CORS pre-flight
  const r = await fetch(u);
  if (r.status === 401) throw new Error('Discogs refused the token (TOKEN… to set it again)');
  if (r.status === 429) throw new Error('Discogs: too many requests, wait a minute');
  if (!r.ok) throw new Error(`Discogs HTTP ${r.status}`);
  return r.json();
}
const isVinyl = f => /vinyl|\blp\b|12"|7"|10"/i.test(f || '');
const mbQ = s => '"' + s.replace(/["\\]/g, ' ').trim() + '"';

// "Artist - Title" or just a title -> { artist, title }
export function splitQuery(q) {
  const m = (q || '').split(/\s+[-–]\s+/);
  return m.length > 1 ? { artist: m[0].trim(), title: m.slice(1).join(' - ').trim() } : { artist: '', title: (q || '').trim() };
}

// -> [{ src: 'discogs' | 'mb', id, title, artist, year, format, vinyl, thumb }], and the errors met (per source)
export async function searchArt(title, artist, { discogs = true, mb = true } = {}) {
  const errors = [], jobs = [];
  if (discogs) jobs.push((async () => {
    let j = await dgJson('database/search', { type: 'release', track: title, artist, per_page: 24 });
    if (!j.results.length) j = await dgJson('database/search', { type: 'release', q: `${artist} ${title}`.trim(), per_page: 24 });
    return j.results.map(x => {
      const parts = (x.title || '').split(' - '), fmt = (x.format || []).join(' ');
      return { src: 'discogs', id: x.id, artist: parts.length > 1 ? parts[0] : '', title: parts.length > 1 ? parts.slice(1).join(' - ') : x.title,
        year: x.year || '', format: fmt, label: (x.label || [])[0] || '', vinyl: isVinyl(fmt), thumb: x.thumb || x.cover_image || '' };
    });
  })().catch(e => { errors.push('Discogs: ' + e.message); return []; }));
  if (mb) jobs.push((async () => {
    const q = `recording:${mbQ(title)}` + (artist ? ` AND artist:${mbQ(artist)}` : '');
    const j = await mbJson(`${MB}recording/?query=${encodeURIComponent(q)}&fmt=json&limit=25`);
    const seen = new Set(), out = [];
    for (const rec of (j && j.recordings) || []) for (const rel of rec.releases || []) {
      if (seen.has(rel.id) || out.length >= 24) continue; seen.add(rel.id);
      const fmt = (rel.media || []).map(m => m.format).filter(Boolean).join(' + ');
      const ac = (rel['artist-credit'] || rec['artist-credit'] || []).map(a => a.name + (a.joinphrase || '')).join('');
      out.push({ src: 'mb', id: rel.id, rg: rel['release-group'] && rel['release-group'].id, title: rel.title, artist: ac, year: (rel.date || '').slice(0, 4),
        format: fmt, label: '', vinyl: isVinyl(fmt), thumb: `${CAA}release/${rel.id}/front-250` });
    }
    return out;
  })().catch(e => { errors.push('MusicBrainz: ' + e.message); return []; }));
  const lists = await Promise.all(jobs);
  // vinyl first, then the rest; the two sources interleaved so both show on the first page
  const merged = [];
  for (const want of [true, false]) {
    const ls = lists.map(l => l.filter(x => x.vinyl === want));
    for (let i = 0; ls.some(l => i < l.length); i++) for (const l of ls) if (i < l.length) merged.push(l[i]);
  }
  return { results: merged, errors };
}

// one release's pictures -> [{ url (full), thumb, kind: 'front' | 'back' | 'label' | 'other', src }]
export async function releaseImages(rel) {
  if (rel.src === 'discogs') {
    const j = await dgJson(`releases/${rel.id}`);
    return (j.images || []).map(i => ({ url: i.uri, thumb: i.uri150 || i.uri, kind: i.type === 'primary' ? 'front' : 'other', src: 'discogs', w: i.width, h: i.height }));
  }
  const kindOf = t => t.includes('Front') ? 'front' : t.includes('Back') ? 'back' : t.includes('Medium') ? 'label' : 'other';
  const map = j => (j.images || []).map(i => ({ url: https((i.thumbnails && (i.thumbnails['1200'] || i.thumbnails.large)) || i.image),
    thumb: https((i.thumbnails && (i.thumbnails['250'] || i.thumbnails.small)) || i.image), kind: kindOf(i.types || []), src: 'mb' }));
  let j = await mbJson(`${CAA}release/${rel.id}`);
  if ((!j || !j.images || !j.images.length) && rel.rg) j = await mbJson(`${CAA}release-group/${rel.rg}`);
  return j ? map(j) : [];
}
// first guess at the three slots: typed pictures where the source has them, else primary = sleeve, next = back
export function guessSlots(imgs) {
  const s = { front: imgs.find(i => i.kind === 'front') || imgs[0] || null, label: imgs.find(i => i.kind === 'label') || null, back: imgs.find(i => i.kind === 'back') || null };
  if (!s.back && imgs[0] && imgs[0].src === 'discogs') s.back = imgs.find(i => i !== s.front) || null;
  return s;
}

// the picture's bytes (Discogs through the proxy)
export async function imageBlob(url, src) {
  const go = async u => { const r = await fetch(u); if (!r.ok) throw new Error(`picture HTTP ${r.status}`); const b = await r.blob(); if (!/^image\//.test(b.type) && b.size < 2000) throw new Error('not a picture'); return b; };
  if (src === 'discogs' || /i\.discogs\.com/.test(url)) return go(viaProxy(url));
  try { return await go(url); } catch (e) { return go(viaProxy(url)); }
}

// thumbnails for the tablet: url -> ImageBitmap | 'loading' | null; onLoad redraws the page
const thumbs = new Map(); let thumbActive = 0; const thumbQ = [];
export function artThumb(url, src, onLoad) {
  if (!url) return null;
  if (thumbs.has(url)) return thumbs.get(url);
  thumbs.set(url, 'loading'); thumbQ.push({ url, src, onLoad }); pumpThumbs();
  return 'loading';
}
function pumpThumbs() {
  while (thumbActive < 4 && thumbQ.length) {
    const { url, src, onLoad } = thumbQ.shift(); thumbActive++;
    imageBlob(url, src).then(b => createImageBitmap(b, { resizeWidth: 160, resizeQuality: 'medium' })).then(bm => thumbs.set(url, bm)).catch(() => thumbs.set(url, null))
      .finally(() => { thumbActive--; if (thumbs.size > 300) { const k = thumbs.keys().next().value; const v = thumbs.get(k); if (v && v.close) v.close(); thumbs.delete(k); } onLoad && onLoad(); pumpThumbs(); });
  }
}
