// Song sources (CLAUDE.md #32).
//  * PC: files are streamed from the PC's web server. Rekopy XML uses relative "Collection/..." paths;
//    the full Rekordbox XML uses absolute file://localhost/D:/Music_Crates/... paths, mapped to /vire-music/.
//  * Headset: the browser cannot read Quest folders directly, so tracks are imported once into the
//    browser's private storage (Origin Private File System) and read from there, offline.

export const PC_ROOTS = [
  { prefix: 'file://localhost/D:/Music_Crates/', url: '../vire-music/' },
];

export function pcResolver(loc) {
  if (!/^file:/i.test(loc)) return { url: loc };
  for (const r of PC_ROOTS) if (loc.toLowerCase().startsWith(r.prefix.toLowerCase())) return { url: r.url + loc.slice(r.prefix.length) };
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
export async function importFiles(fileList, onProgress) {
  if (navigator.storage.persist) { try { await navigator.storage.persist(); } catch {} }
  const files = [...fileList].filter(f => /\.(mp3|m4a|aac|wav|aiff?|flac|ogg|xml|mp4|m4v|webm|mov)$/i.test(f.name));   // #177: + VideoVinyl videos
  let done = 0, bytes = 0; const total = files.reduce((a, f) => a + f.size, 0);
  for (const f of files) {
    const rel = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
    const dir = await dirFor(rel, true);
    const fh = await dir.getFileHandle(rel.split('/').pop(), { create: true });
    const w = await fh.createWritable();
    await w.write(f); await w.close();
    done++; bytes += f.size;
    onProgress && onProgress({ done, count: files.length, bytes, total, name: f.name });
  }
  await rebuildIndex();
  return files.length;
}

// Index of every stored file: [{ path, size }]
export async function rebuildIndex() {
  const out = [];
  async function walk(d, pre) {
    for await (const [name, h] of d.entries()) {
      if (h.kind === 'directory') await walk(h, pre + name + '/');
      else if (name !== 'index.json') { const f = await h.getFile(); out.push({ path: pre + name, size: f.size }); }
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
    let p; try { p = decodeURIComponent(loc.replace(/^file:\/\/localhost\//i, '')); } catch { p = loc; }
    const segs = norm(p).split('/');
    for (let k = Math.min(segs.length, 6); k >= 1; k--) {
      const hit = byTail.get(segs.slice(-k).join('/'));
      if (hit) return { opfs: hit };
    }
    return null;
  };
}
