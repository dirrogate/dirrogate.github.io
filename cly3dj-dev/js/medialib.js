// #185 Media library (phone and Quest): folders of panoramas, video panoramas, videos (VideoVinyl + LED wall) and
// images, kept in the site's private storage (OPFS) under 'vire-media/<folder>/<name>', with a small JPEG
// thumbnail per item under 'vire-media/_thumbs/<folder>/<name>.jpg'. The phone imports files into it and pushes
// them to the Quest over the spectator link (net-link 'file' channel); the Quest's mixer Video page browses it.
// A transfer that stops half way is kept as '<name>.part' and resumed from where it stopped.
export const FOLDERS = ['Pano', 'Video pano', 'Video', 'Images'];
export const ACCEPT = { Pano: 'image/*', 'Video pano': 'video/*', Video: 'video/*', Images: 'image/*' };
export const isVideoName = n => /\.(mp4|m4v|webm|mov|mkv)$/i.test(n);
const ROOT = 'vire-media', THUMBS = '_thumbs';

async function rootDir() { return (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, { create: true }); }
async function folderDir(folder) { return (await rootDir()).getDirectoryHandle(folder, { create: true }); }
async function thumbDir(folder) { return (await (await rootDir()).getDirectoryHandle(THUMBS, { create: true })).getDirectoryHandle(folder, { create: true }); }
const safe = n => n.replace(/[\\/:*?"<>|]/g, '_').slice(0, 180);

export async function list(folder) {   // [{ folder, name, size, mtime }] sorted by name (no partial transfers)
  const out = [];
  try {
    for await (const [name, h] of (await folderDir(folder)).entries()) {
      if (h.kind !== 'file' || name.endsWith('.part')) continue;
      const f = await h.getFile(); out.push({ folder, name, size: f.size, mtime: f.lastModified });
    }
  } catch {}
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
export async function listAll() { const all = {}; for (const f of FOLDERS) all[f] = await list(f); return all; }
export async function getFile(folder, name) { try { return await (await (await folderDir(folder)).getFileHandle(name)).getFile(); } catch { return null; } }
export async function getThumb(folder, name) { try { return await (await (await thumbDir(folder)).getFileHandle(name + '.jpg')).getFile(); } catch { return null; } }
export async function putThumb(folder, name, blob) {
  if (!blob) return; const w = await (await (await thumbDir(folder)).getFileHandle(name + '.jpg', { create: true })).createWritable(); await w.write(blob); await w.close();
}
export async function remove(folder, name) {
  for (const n of [name, name + '.part']) { try { await (await folderDir(folder)).removeEntry(n); } catch {} }
  try { await (await thumbDir(folder)).removeEntry(name + '.jpg'); } catch {}
}
// #205 the #203 in-app recorder is gone: free the space its takes used on the phone (once, harmless if none)
export async function dropTakes() { try { await (await rootDir()).removeEntry('Takes', { recursive: true }); } catch {} }
export async function usage() { try { return await navigator.storage.estimate(); } catch { return null; } }

// ---- thumbnails: 320 px wide JPEG; stereo over-under panoramas show the top (left-eye) half
export async function makeThumb(file, folder) {
  const W = 320;
  let src, sw, sh;
  if (isVideoName(file.name) || /^video\//.test(file.type)) {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
    const url = URL.createObjectURL(file); v.src = url;
    try {
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video not readable')); setTimeout(() => rej(new Error('video timeout')), 8000); });
      v.currentTime = Math.min(1, (v.duration || 2) / 2);
      await new Promise(res => { v.onseeked = res; setTimeout(res, 3000); });
      src = v; sw = v.videoWidth; sh = v.videoHeight;
      return draw();
    } catch { return null; } finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
  }
  try { src = await createImageBitmap(file); sw = src.width; sh = src.height; return await draw(); } catch { return null; } finally { if (src && src.close) src.close(); }
  function draw() {
    let cy = 0, ch = sh;
    if ((folder === 'Pano' || folder === 'Video pano') && sw / sh > 0.9 && sw / sh < 1.1) ch = sh / 2;   // over-under: left eye only
    const H = Math.round(W * ch / sw), c = document.createElement('canvas'); c.width = W; c.height = Math.max(1, Math.min(H, 240));
    c.getContext('2d').drawImage(src, 0, cy, sw, ch, 0, 0, W, c.height);
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.72));
  }
}

// ---- import a picked file into a folder (#873). Written to '<name>.importing.part' first and renamed only when every
// byte is in, so a failed read never destroys the copy already in the library. A read Windows refuses (NotReadableError:
// cloud-only OneDrive / Google Drive file, file locked by another program, or changed since it was picked) is retried
// a few times (a cloud file may finish downloading meanwhile). 8 MB chunks (#872).
export async function importFile(folder, file, as) {   // #822 as: the name to keep it under (default: the file's own)
  const name = safe(as || file.name), d = await folderDir(folder), tmp = name + '.importing.part';
  try { await d.removeEntry(tmp); } catch {}
  const th = await d.getFileHandle(tmp, { create: true });
  const w = await th.createWritable();
  const readChunk = async (off, end) => {
    for (let tries = 0; ; tries++) {
      try { return await file.slice(off, end).arrayBuffer(); }
      catch (e) { if (e && e.name === 'NotReadableError' && tries < 3) { await new Promise(r => setTimeout(r, 700 * (tries + 1))); continue; } throw e; }
    }
  };
  try {
    const CHUNK = 8 * 1024 * 1024;
    for (let off = 0; off < file.size; off += CHUNK) await w.write(await readChunk(off, Math.min(file.size, off + CHUNK)));
    await w.close();
  } catch (e) {
    try { await w.abort(); } catch {}
    try { await d.removeEntry(tmp); } catch {}
    throw e;
  }
  try { await d.removeEntry(name); } catch {}
  if (th.move) await th.move(name);
  else { const f = await th.getFile(), w2 = await (await d.getFileHandle(name, { create: true })).createWritable(); await f.stream().pipeTo(w2); await d.removeEntry(tmp); }
  const copy = await getFile(folder, name);   // thumbnail from the library copy, not the picked file
  try { await putThumb(folder, name, await makeThumb(copy || file, folder).catch(() => null)); } catch {}
  return name;
}

// ---- receiving side of a push: resumes from '<name>.part'
export async function beginReceive(folder, name, size) {
  name = safe(name);
  const done = await getFile(folder, name);
  if (done && done.size === size) return { have: true };
  const d = await folderDir(folder), ph = await d.getFileHandle(name + '.part', { create: true });
  let off = (await ph.getFile()).size; if (off > size) off = 0;
  const w = await ph.createWritable({ keepExistingData: off > 0 }); if (off) await w.seek(off); else await w.truncate(0);
  let got = off, chain = Promise.resolve(), closed = false;
  const rx = {
    folder, name, size, off, get got() { return got; },
    write(buf) { got += buf.byteLength; chain = chain.then(() => w.write(buf)); return got >= size; },
    async finish() {   // all bytes in: commit and rename <name>.part -> <name>
      await chain; closed = true; await w.close();
      if (done) { try { await d.removeEntry(name); } catch {} }
      if (ph.move) await ph.move(name);
      else { const f = await ph.getFile(), w2 = await (await d.getFileHandle(name, { create: true })).createWritable(); await f.stream().pipeTo(w2); await d.removeEntry(name + '.part'); }
    },
    async abort() { if (closed) return; closed = true; try { await chain; await w.close(); } catch {} },   // keep what arrived (resume later)
  };
  return { have: false, off, rx };
}
