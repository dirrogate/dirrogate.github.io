// #185 Phone library screen: folders (Pano, Video pano, Video, Images) in the phone's Cly3DJ storage. Import
// copies files picked from the phone (Downloads etc.) in; Push sends the selected ones to the Quest over the
// spectator link ('file' channel), only what the Quest doesn't have, resuming a half-sent file. The screen stays
// awake while pushing (Wake Lock), because a sleeping phone drops the link.
import * as media from './medialib.js';

const CH = 64 * 1024;
const mb = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function makePhoneLibrary({ getLink, onChange }) {
  document.head.insertAdjacentHTML('beforeend', `<style>
    #spLib { position:fixed; inset:0; z-index:40; background:#0b0d12; color:#e6e8ec; font:15px/1.4 system-ui,sans-serif; display:flex; flex-direction:column; } #spLib[hidden] { display:none; }
    #spLib header { display:flex; align-items:center; gap:10px; padding:12px 12px 6px; } #spLib header h2 { flex:1; margin:0; font-size:22px; }
    #spLib .tabs { display:flex; gap:6px; padding:0 12px; overflow-x:auto; }
    #spLib button { font:600 14px system-ui,sans-serif; color:#e6e8ec; background:#1c2230; border:1px solid #2e3850; border-radius:10px; padding:10px 12px; white-space:nowrap; }
    #spLib button.on { border-color:#39a8ff; color:#fff; background:#16304a; } #spLib button:disabled { opacity:.4; }
    #spLib .tools { display:flex; flex-wrap:wrap; gap:6px; padding:8px 12px; }
    #spLib .st { padding:0 12px 6px; color:#8b909a; font-size:13px; min-height:18px; }
    #spLib .grid { flex:1; overflow:auto; display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; padding:4px 12px 16px; align-content:start; }
    #spLib .it { background:#121824; border:2px solid #1e2636; border-radius:10px; overflow:hidden; }
    #spLib .it.sel { border-color:#39a8ff; } #spLib .it img, #spLib .it .ph { width:100%; aspect-ratio:2/1; object-fit:cover; display:block; background:#1a2130; }
    #spLib .it .n { padding:5px 7px 0; font-size:12px; word-break:break-all; max-height:34px; overflow:hidden; }
    #spLib .it .m { padding:2px 7px 6px; font-size:11px; color:#8b909a; } #spLib .it .q { color:#40d080; }
  </style>`);
  document.body.insertAdjacentHTML('beforeend', `<div id="spLib" hidden>
    <header><h2>Library</h2><button id="lbClose">Close</button></header>
    <div class="tabs" id="lbTabs">${media.FOLDERS.map(f => `<button data-f="${f}">${f}</button>`).join('')}</div>
    <div class="tools">
      <button id="lbImp">Import…</button><button id="lbPush">Push to Quest</button><button id="lbAll">Select all</button>
      <button id="lbDelQ">Remove from Quest</button><button id="lbDelP">Remove from phone</button>
    </div>
    <div class="st" id="lbSt"></div><div class="st" id="lbUse"></div>
    <div class="grid" id="lbGrid"></div>
    <input type="file" id="lbFile" multiple hidden></div>`);
  const $ = s => document.querySelector(s), root = $('#spLib');
  let folder = 'Pano', items = [], sel = new Set(), busy = false, quest = null;   // quest: Map 'folder/name' -> size (null = unknown)
  const urls = [];
  const say = t => { $('#lbSt').textContent = t; };
  const waiters = new Map();
  function waitFor(kinds, f, n, ms) {
    return new Promise((res, rej) => {
      const key = f + '/' + n, t = setTimeout(() => { waiters.delete(key); rej(new Error('no answer from the Quest')); }, ms);
      waiters.set(key, { kinds, res: m => { clearTimeout(t); waiters.delete(key); res(m); } });
    });
  }
  function onMsg(m) {
    if (m.k === 'mls') { quest = new Map(m.items.map(([f, n, s]) => [f + '/' + n, s])); render(); return; }
    const w = waiters.get(m.f + '/' + m.n); if (w && w.kinds.includes(m.k)) w.res(m);
  }
  const linked = () => { const l = getLink(); return l && l.isOpen ? l : null; };
  function onLinkOpen() { quest = null; const l = linked(); if (l) l.send('ctl', { k: 'mls?' }); }

  async function load() {
    items = await media.list(folder); sel = new Set([...sel].filter(n => items.some(i => i.name === n)));
    await render(true);
    const u = await media.usage(); $('#lbUse').textContent = u ? `Phone storage for SpatialED: ${mb(u.usage || 0)} used of ${mb(u.quota || 0)} available` : '';
  }
  async function render(thumbs) {
    for (const b of document.querySelectorAll('#lbTabs button')) b.classList.toggle('on', b.dataset.f === folder);
    const l = linked();
    $('#lbPush').disabled = $('#lbDelQ').disabled = busy || !l || !sel.size; $('#lbDelP').disabled = busy || !sel.size; $('#lbImp').disabled = busy;
    const g = $('#lbGrid');
    if (thumbs) { urls.splice(0).forEach(u => URL.revokeObjectURL(u)); g.innerHTML = ''; }
    if (!items.length) { g.innerHTML = `<div class="st" style="grid-column:1/-1">Nothing in ${esc(folder)} yet. Import… picks files on this phone (for example from Downloads).</div>`; return; }
    if (thumbs) for (const it of items) {
      const d = document.createElement('div'); d.className = 'it'; d.dataset.n = it.name;
      const tb = await media.getThumb(folder, it.name); let im;
      if (tb) { const u = URL.createObjectURL(tb); urls.push(u); im = `<img src="${u}">`; } else im = '<div class="ph"></div>';
      d.innerHTML = `${im}<div class="n">${esc(it.name)}</div><div class="m"></div>`;
      d.onclick = () => { if (busy) return; sel.has(it.name) ? sel.delete(it.name) : sel.add(it.name); render(); };
      g.append(d);
    }
    for (const d of g.querySelectorAll('.it')) {
      const it = items.find(i => i.name === d.dataset.n); if (!it) continue;
      d.classList.toggle('sel', sel.has(it.name));
      const qs = quest && quest.get(folder + '/' + it.name);
      d.querySelector('.m').innerHTML = mb(it.size) + (qs === it.size ? ' · <span class="q">✓ on Quest</span>' : !l ? '' : quest ? ' · not on Quest' : '');
    }
  }
  $('#lbTabs').onclick = e => { const f = e.target.dataset && e.target.dataset.f; if (!f || busy) return; folder = f; sel.clear(); load(); };
  $('#lbClose').onclick = () => { root.hidden = true; };
  $('#lbAll').onclick = () => { sel = sel.size === items.length ? new Set() : new Set(items.map(i => i.name)); render(); };
  $('#lbImp').onclick = () => { const i = $('#lbFile'); i.accept = media.ACCEPT[folder]; i.click(); };
  $('#lbFile').onchange = async e => {
    const files = [...(e.target.files || [])]; e.target.value = ''; if (!files.length) return;
    busy = true; render();
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
    let n = 0;
    for (const f of files) {
      say(`Importing ${f.name} (${++n} of ${files.length}, ${mb(f.size)})…`);
      try { await media.importFile(folder, f); } catch (err) { say(`Could not import ${f.name}: ${err.message}`); await new Promise(r => setTimeout(r, 2500)); }
    }
    busy = false; say(`Imported ${n} into ${folder}. You can delete the originals from Downloads.`); await load(); onChange && onChange();
  };
  $('#lbDelP').onclick = async () => {
    if (!confirm(`Remove ${sel.size} item(s) from this phone? (The Quest keeps its copies.)`)) return;
    for (const n of sel) await media.remove(folder, n);
    sel.clear(); say('Removed from the phone.'); await load(); onChange && onChange();
  };
  $('#lbDelQ').onclick = () => {
    const l = linked(); if (!l) return;
    for (const n of sel) l.send('ctl', { k: 'mdel', f: folder, n });
    say('Removed from the Quest.');
  };
  // one item to the Quest: offer it, the Quest says where to start (resume) or that it has it, then the chunks
  async function sendOne(l, folder, name, label) {
    const file = await media.getFile(folder, name); if (!file) return false;
    const tb = await media.getThumb(folder, name);
    let thumb = null;
    if (tb) { const u = new Uint8Array(await tb.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); thumb = btoa(s); }
    const a0 = waitFor(['mgo', 'mok'], folder, name, 30000);
    l.send('ctl', { k: 'mput', f: folder, n: name, size: file.size, thumb });
    const a = await a0;
    if (a.k === 'mok') return true;
    const done = waitFor(['mok'], folder, name, 60 * 60000), t0 = performance.now();
    let last = 0;
    for (let pos = a.off; pos < file.size; pos += CH) {
      await l.sendBin(await file.slice(pos, Math.min(file.size, pos + CH)).arrayBuffer());
      const now = performance.now();
      if (now - last > 300) { last = now; const s = (now - t0) / 1000, sent = pos + CH - a.off;
        say(`${label}${name}: ${Math.min(100, Math.round((pos + CH) / file.size * 100))}% · ${(sent / 1048576 / Math.max(0.1, s)).toFixed(1)} MB/s` + (a.off ? ' (resumed)' : '')); }
    }
    say(`${label}${name}: saving on the Quest…`);
    await done;
    return true;
  }
  $('#lbPush').onclick = async () => {
    const l = linked(); if (!l || busy) return;
    if (!l.fileOpen) { say('This Quest page is older: reload SpatialED on the Quest, then Connect again.'); return; }
    busy = true; render();
    let lock = null; try { lock = await navigator.wakeLock.request('screen'); } catch {}
    const list = items.filter(i => sel.has(i.name));
    let k = 0;
    try {
      for (const it of list) {
        k++;
        if (quest && quest.get(folder + '/' + it.name) === it.size) continue;
        await sendOne(l, folder, it.name, `Pushing (${k} of ${list.length}) `);
      }
      say(`Pushed ${list.length} item(s) to the Quest.`);
    } catch (e) { say('Push stopped: ' + e.message + '. Push again to resume.'); }
    finally { busy = false; if (lock) lock.release().catch(() => {}); const l2 = linked(); if (l2) l2.send('ctl', { k: 'mls?' }); render(); }
  };
  // #206 media sync from the Quest's VIDEO page: the Quest asks for one file at a time ('mpull'); queued here
  let pullQ = Promise.resolve(), pullLock = null;
  function pull(f, n) {
    pullQ = pullQ.then(async () => {
      const l = linked(); if (!l) return;
      if (!pullLock) { try { pullLock = await navigator.wakeLock.request('screen'); } catch {} }
      let ok = false;
      try { ok = await sendOne(l, f, n, 'Sync to the Quest: '); } catch (e) { say('Sync: ' + e.message); }
      if (!ok) l.send('ctl', { k: 'mpullx', f, n });
      else say(`Sync: ${n} copied to the Quest.`);
    }).finally(() => { setTimeout(() => { if (pullLock) { pullLock.release().catch(() => {}); pullLock = null; } }, 5000); });
  }
  return { open() { root.hidden = false; load(); onLinkOpen(); }, onMsg, onLinkOpen, pull, refresh() { if (!root.hidden) load(); }, get folder() { return folder; } };
}
