// Song sources (CLAUDE.md #32).
//  * PC: files are streamed from the PC's web server. Rekopy XML uses relative "Collection/..." paths;
//    the full Rekordbox XML uses absolute file://localhost/D:/Music_Crates/... paths, mapped to /vire-music/.
//  * Headset: the browser cannot read Quest folders directly, so tracks are imported once into the
//    browser's private storage (Origin Private File System) and read from there, offline.

export const PC_ROOTS = [
  { prefix: 'file://localhost/D:/Music_Crates/', url: '../vire-music/' },
];

// #544 a playlist XML written by hand or by an AI can spell a song's place many ways: Rekopy's relative 'Collection/x.mp3',
// Rekordbox's file://localhost/D:/Music_Crates/..., file:///D:/..., a bare Windows path (D:\Music_Crates\...\Collection\x.mp3),
// a Quest path (/storage/emulated/0/Music/Collection/x.mp3, file:///sdcard/Music/Collection/...), encoded or not.
// All of them come down to one plain path; anything under a PC root goes to /vire-music/, anything else inside a folder named
// Collection goes to the page's own Collection/ (the PC's web/Collection link to D:\Music_Crates\VinylRealityLite_Crate\Collection).
const dec = s => { try { return decodeURIComponent(s); } catch { return s; } };
const enc = p => p.split('/').map(x => encodeURIComponent(x)).join('/');
export function plainPath(loc) {   // decoded, forward slashes, no file:// / drive-host prefix
  let p = dec(String(loc || '').trim()).replace(/\\/g, '/');
  p = p.replace(/^file:\/\/(localhost)?\/*/i, '');   // file://localhost/D:/..  file:///D:/..  file:///storage/..
  return p.replace(/^\/+(?=[A-Za-z]:\/)/, '');
}
export function pcResolver(loc) {
  if (!loc) return null;
  const raw = String(loc).trim();
  const absolute = /^file:/i.test(raw) || /^[A-Za-z]:[\\/]/.test(raw) || /^[\\/]/.test(raw) || raw.includes('\\');
  if (!absolute) return { url: enc(plainPath(raw)) };   // relative (Rekopy): same as before, re-encoded so spaces, # and % are safe
  const p = plainPath(raw), lp = p.toLowerCase();
  for (const r of PC_ROOTS) { const pre = r.prefix.replace(/^file:\/\/localhost\//i, '').toLowerCase(); if (lp.startsWith(pre)) return { url: r.url + enc(p.slice(pre.length)) }; }
  const i = lp.lastIndexOf('/collection/');
  if (i >= 0) return { url: 'Collection/' + enc(p.slice(i + 12)) };
  return null;
}

// ---------------------------------------------------------------- OPFS library
const ROOT = 'vire-library';
const norm = s => s.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();

async function rootDir(create = true) {
  const r = await navigator.storage.getDirectory();
  return r.getDirectoryHandle(ROOT, { create });
}
async function dirFor(path, create) {
  const parts = path.split('/'); parts.pop();
  let d = await rootDir(create);
  for (const p of parts) if (p) d = await d.getDirectoryHandle(p, { create });
  return d;
}

export function opfsSupported() { return !!(navigator.storage && navigator.storage.getDirectory); }

// Copy picked files into the library. relPath keeps folder structure when a folder was picked.
// #544 playlist XMLs decide what is copied: when the picked files (or the XMLs already on this headset, extraXml) include a
// Rekordbox / AI playlist XML, only the songs it names are copied (by file name), so picking the whole Music/Collection folder
// copies a 26-song playlist, not the whole collection (folder picks only; Import files copies what you picked). Files already stored with the same size are skipped.
export function xmlSongNames(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/Location\s*=\s*"([^"]*)"/gi)) { const n = plainPath(m[1].replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"')).split('/').pop(); if (n) out.add(n.toLowerCase()); }
  return out;
}
export async function importFiles(fileList, onProgress, extraXml = [], filter = true) {   // filter false: copy every picked file (Import files)
  if (navigator.storage.persist) { try { await navigator.storage.persist(); } catch {} }
  let files = [...fileList].filter(f => /\.(mp3|m4a|aac|wav|aiff?|flac|ogg|xml|mp4|m4v|webm|mov)$/i.test(f.name));   // #177: + VideoVinyl videos
  const xmlTexts = [...extraXml];
  for (const f of files) if (/\.xml$/i.test(f.name)) xmlTexts.push(await f.text());
  const want = new Set(); for (const t of xmlTexts) for (const n of xmlSongNames(t)) want.add(n);
  const stem = n => n.toLowerCase().replace(/\.[^.]+$/, ''), wantStem = new Set([...want].map(stem));
  const picked = files.length;
  if (filter && want.size) files = files.filter(f => /\.xml$/i.test(f.name) || want.has(f.name.toLowerCase()) || (/\.(mp4|m4v|webm|mov)$/i.test(f.name) && wantStem.has(stem(f.name))));
  const have = new Map((await loadIndex()).map(x => [x.path.toLowerCase(), x.size]));
  const relOf = f => (f.webkitRelativePath || f.name).replace(/\\/g, '/');
  const skipped = files.filter(f => have.get(relOf(f).toLowerCase()) === f.size).length;
  files = files.filter(f => have.get(relOf(f).toLowerCase()) !== f.size);
  let done = 0, bytes = 0; const total = files.reduce((a, f) => a + f.size, 0);
  for (const f of files) {
    const rel = relOf(f);
    const dir = await dirFor(rel, true);
    const fh = await dir.getFileHandle(rel.split('/').pop(), { create: true });
    const w = await fh.createWritable();
    await w.write(f); await w.close();
    done++; bytes += f.size;
    onProgress && onProgress({ done, count: files.length, bytes, total, name: f.name });
  }
  await rebuildIndex();
  return { copied: files.length, skipped, picked, filtered: filter && want.size > 0, songs: want.size };
}

// Index of every stored file: [{ path, size }]
export async function rebuildIndex() {
  const out = [];
  async function walk(d, pre) {
    for await (const [name, h] of d.entries()) {
      if (h.kind === 'directory') await walk(h, pre + name + '/');
      else if (name !== 'index.json') { const f = await h.getFile(); out.push({ path: pre + name, size: f.size, t: f.lastModified }); }   // #544 t: which XML came in last
    }
  }
  const r = await rootDir(true);
  await walk(r, '');
  const fh = await r.getFileHandle('index.json', { create: true });
  const w = await fh.createWritable(); await w.write(JSON.stringify(out)); await w.close();
  return out;
}
export async function loadIndex() {
  try {
    const r = await rootDir(false);
    const f = await (await r.getFileHandle('index.json')).getFile();
    return JSON.parse(await f.text());
  } catch { return []; }
}
export async function readFile(path) {
  const d = await dirFor(path, false);
  return (await d.getFileHandle(path.split('/').pop())).getFile();
}
export async function clearLibrary() {
  const r = await navigator.storage.getDirectory();
  try { await r.removeEntry(ROOT, { recursive: true }); } catch {}
}
export async function usage() {
  try { const e = await navigator.storage.estimate(); return e; } catch { return null; }
}

// Match Rekordbox locations to imported files: longest matching tail of the path wins, then file name.
export function opfsResolver(index) {
  const byTail = new Map();
  for (const it of index) {
    const segs = norm(it.path).split('/');
    for (let k = 1; k <= segs.length; k++) {
      const tail = segs.slice(-k).join('/');
      const cur = byTail.get(tail);
      byTail.set(tail, cur === undefined ? it.path : (cur === it.path ? cur : null)); // null = ambiguous
    }
  }
  return loc => {
    const segs = norm(plainPath(loc)).split('/');   // #544 any spelling (see pcResolver)
    for (let k = Math.min(segs.length, 6); k >= 1; k--) {
      const hit = byTail.get(segs.slice(-k).join('/'));
      if (hit) return { opfs: hit };
    }
    return null;
  };
}
