// #751 PROGRAM REC writer: the .mkv lives in the browser's private storage (folder vire-progrec), written in place with a sync access
// handle and flushed every 2 s, so a crash or a closed tab keeps everything up to the last flush.
let h = null, pos = 0, flushT = 0;
onmessage = async e => {
  const m = e.data;
  try {
    if (m.k === 'open') {
      const root = await navigator.storage.getDirectory(), dir = await root.getDirectoryHandle('vire-progrec', { create: true });
      const f = await dir.getFileHandle(m.name, { create: true }); h = await f.createSyncAccessHandle(); h.truncate(0); pos = 0; flushT = performance.now();
      postMessage({ k: 'open' });
    } else if (m.k === 'data' && h) {
      const b = new Uint8Array(m.d); let n = 0; while (n < b.length) n += h.write(b.subarray(n), { at: pos + n }); pos += b.length;
      const now = performance.now(); if (now - flushT > 2000) { flushT = now; h.flush(); }
      postMessage({ k: 'pos', pos });
    } else if (m.k === 'close' && h) { h.flush(); h.close(); h = null; postMessage({ k: 'closed', pos }); }
  } catch (err) { postMessage({ k: 'err', e: String(err && err.message || err) }); }
};
