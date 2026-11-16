// #754 RECORDINGS FOLDER: after a take ends (VIDREC / PROGRAM REC .mkv on DirroVJ, REC MASTER .wav on DirroDJ) a copy goes to a folder
// the owner picked once. The take itself is still recorded crash-safe in the browser's private storage first; this only copies it out.
// The folder handle lives in IndexedDB (shared by every page of this address); Chrome asks for write permission on first use and
// may ask again after a restart (then the copy waits as 'pending' until a click on the desk / start page allows it).
const DB = 'vire-recdir', ST = 'h', PEND = 'vire.recPending';
const SRC_DIR = { progrec: 'vire-progrec', master: 'vire-rec' };
function idb() { return new Promise((ok, no) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }
async function idbDo(mode, f) { const db = await idb(); return new Promise((ok, no) => { const t = db.transaction(ST, mode), s = t.objectStore(ST), r = f(s); t.oncomplete = () => ok(r && r.result); t.onerror = () => no(t.error); }); }
export const canPick = () => typeof window !== 'undefined' && !!window.showDirectoryPicker;
export async function getFolder() { try { return (await idbDo('readonly', s => s.get('dir'))) || null; } catch { return null; } }
export async function setFolder(h) { try { await idbDo('readwrite', s => h ? s.put(h, 'dir') : s.delete('dir')); } catch {} }
export async function chooseFolder() { const h = await window.showDirectoryPicker({ id: 'dirro-rec', mode: 'readwrite', startIn: 'videos' }); await setFolder(h); return h; }
export async function folderPerm(h, ask) {
  if (!h) return false; const o = { mode: 'readwrite' };
  try { let p = await h.queryPermission(o); if (p !== 'granted' && ask) p = await h.requestPermission(o); return p === 'granted'; } catch { return false; }
}
export function pending() { try { return JSON.parse(localStorage.getItem(PEND) || '[]').filter(x => x && x.src && x.name); } catch { return []; } }
function setPending(a) { try { localStorage.setItem(PEND, JSON.stringify(a.slice(-40))); } catch {} }
function addPending(src, name) { const a = pending().filter(x => !(x.src === src && x.name === name)); a.push({ src, name }); setPending(a); }
async function opfsFile(src, name) { const r = await navigator.storage.getDirectory(), d = await r.getDirectoryHandle(SRC_DIR[src], { create: true }); return (await d.getFileHandle(name)).getFile(); }
// copy one take: 'copied' | 'no-folder' | 'need-permission' | 'error: ...'; a take that couldn't go waits in the pending list (except no folder)
export async function copyTake(src, name, ask = false) {
  const h = await getFolder(); if (!h) return 'no-folder';
  if (!(await folderPerm(h, ask))) { addPending(src, name); return 'need-permission'; }
  try {
    const f = await opfsFile(src, name), fh = await h.getFileHandle(name, { create: true }), w = await fh.createWritable();
    await f.stream().pipeTo(w);
    setPending(pending().filter(x => !(x.src === src && x.name === name)));
    return 'copied';
  } catch (e) { addPending(src, name); return 'error: ' + (e && e.message || e); }
}
export async function copyPending(ask = true) { let ok = 0, bad = 0; for (const x of pending()) { const r = await copyTake(x.src, x.name, ask); if (r === 'copied') ok++; else bad++; } return { ok, bad }; }
export const copyLabel = r => r === 'copied' ? 'copied to the recordings folder' : r === 'no-folder' ? 'no recordings folder chosen (kept in the browser)' : r === 'need-permission' ? 'waiting: click COPY PENDING to allow the folder' : r ? 'copy failed: ' + r.replace(/^error: /, '') : '';
