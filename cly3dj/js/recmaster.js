// #598 REC MASTER (owner, 3 Nov): records the clean master to a WAV file while the Quest's own screen recorder films the
// show. Same tap as the Twitch stream: after the master limiter, music + DJ mic, no cue, full stereo, no stream delay.
// Written in 1 s chunks to private storage (OPFS vire-rec/), so a long set never sits in memory; 16-bit PCM at the
// context's rate (48 kHz on the Quest): about 11.5 MB a minute, 690 MB an hour. On stop the header gets its sizes and
// the file goes to Downloads (after leaving VR if it was stopped in the headset). The last KEEP files stay in storage.
// In Premiere: put the WAV under the Quest video, Synchronize by audio, mute the Quest's own track.
const DIR = 'vire-rec', KEEP = 3, MAXB = 4.0e9;   // WAV sizes are 32-bit: stop well before 4 GB (about 5.8 h)
const pad = n => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
function wavHeader(bytes, rate, ch = 2) {
  const h = new DataView(new ArrayBuffer(44)), s = (o, t) => { for (let i = 0; i < 4; i++) h.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); h.setUint32(4, 36 + bytes, true); s(8, 'WAVE'); s(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, ch, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * ch * 2, true); h.setUint16(32, ch * 2, true); h.setUint16(34, 16, true); s(36, 'data'); h.setUint32(40, bytes, true);
  return h.buffer;
}
export class MasterRec {
  constructor(engine, { toast = () => {}, onChange = () => {}, inXR = () => false } = {}) {
    this.engine = engine; this.toast = toast; this.onChange = onChange; this.inXR = inXR;
    this.cur = null; this.busy = false; this.loaded = false; this.pending = []; this.last = '';
  }
  get on() { return !!this.cur; }
  get secs() { return this.cur ? (performance.now() - this.cur.t0) / 1000 : 0; }
  async dir() { return (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create: true }); }
  async start() {
    if (this.cur || this.busy) return; this.busy = true;
    try {
      const ctx = this.engine.ctx;
      if (ctx.state !== 'running') try { await ctx.resume(); } catch {}
      if (!this.loaded) { await ctx.audioWorklet.addModule(new URL('./rec-worklet.js', import.meta.url).href); this.loaded = true; }
      try { const e = await navigator.storage.estimate(); if (e.quota && e.quota - e.usage < 1.2e9) this.toast(`REC MASTER: only ${((e.quota - e.usage) / 1e9).toFixed(1)} GB free (about ${Math.max(0, Math.floor((e.quota - e.usage) / 6.9e8 * 60))} min)`, 4000); } catch {}
      const dir = await this.dir(); await this.prune(dir);
      const name = `DirroDJ_master_${stamp()}.wav`, fh = await dir.getFileHandle(name, { create: true }), w = await fh.createWritable();
      await w.write(new Uint8Array(44));   // the header, filled in on stop
      const node = new AudioWorkletNode(ctx, 'vire-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
      const sink = ctx.createGain(); sink.gain.value = 0; node.connect(sink).connect(ctx.destination);   // keeps the node pulled; silent
      const cur = { name, fh, w, node, sink, bytes: 0, t0: performance.now(), rate: ctx.sampleRate, q: Promise.resolve(), done: null, err: '' };
      cur.flushed = new Promise(ok => { cur.done = ok; });
      node.port.onmessage = e => {
        if (e.data && e.data.done) { cur.done(); return; }
        const b = e.data; cur.q = cur.q.then(() => cur.err ? null : w.write(b)).then(() => { cur.bytes += b.byteLength; if (cur.bytes > MAXB && this.cur === cur) { this.toast('REC MASTER: 4 GB WAV limit reached, saving', 4000); this.stop(); } })
          .catch(err => { if (!cur.err) { cur.err = err.message || String(err); this.toast('REC MASTER: write failed (' + cur.err + '), saving what there is', 5000); this.stop(); } });
      };
      this.engine.limiter.connect(node);
      this.cur = cur; this.toast(`REC MASTER: recording ${name} (WAV, ${Math.round(cur.rate / 100) / 10} kHz)`, 2500); this.onChange();
    } catch (e) { this.toast('REC MASTER failed: ' + (e.message || e), 4500); }
    finally { this.busy = false; }
  }
  async stop() {
    const cur = this.cur; if (!cur || this.busy) return; this.cur = null; this.busy = true; this.onChange();
    try {
      try { this.engine.limiter.disconnect(cur.node); } catch {}
      cur.node.port.postMessage('flush');
      await Promise.race([cur.flushed, new Promise(ok => setTimeout(ok, 1500))]);
      cur.node.disconnect(); cur.sink.disconnect();
      await cur.q;
      await cur.w.write({ type: 'write', position: 0, data: wavHeader(cur.bytes, cur.rate) }); await cur.w.close();
      const mb = (cur.bytes + 44) / 1e6, m = Math.floor(cur.bytes / cur.rate / 4 / 60), s = Math.round(cur.bytes / cur.rate / 4 % 60);
      this.last = cur.name;
      if (this.inXR()) { this.pending.push(cur.name); this.toast(`REC MASTER saved: ${m}:${pad(s)}, ${mb.toFixed(0)} MB. Leave VR, then tap SAVE on the page to put it in Downloads.`, 5000); }
      else { this.toast(`REC MASTER saved: ${m}:${pad(s)}, ${mb.toFixed(0)} MB, to Downloads`, 4000); await this.download(cur.name); }
    } catch (e) { this.toast('REC MASTER: could not finish the file: ' + (e.message || e), 5000); }
    finally { this.busy = false; this.onChange(); }
  }
  async download(name) {
    const f = await (await (await this.dir()).getFileHandle(name)).getFile(), url = URL.createObjectURL(f), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 15 * 60 * 1000);
  }
  // #637 TAKES (owner: nothing turned up in Downloads). A download fired by the browser on leaving VR has no tap behind it,
  // and the Quest Browser can drop it silently. So the takes kept in storage (the last KEEP) are offered on a big button
  // on the 2D page after leaving VR; tapping it IS the user gesture, and the files go to Downloads one after another.
  async takes() {   // the finished WAVs in storage, newest first: [{ name, size }]
    const dir = await this.dir(), out = [];
    for await (const [n, h] of dir.entries()) if (h.kind === 'file' && /\.wav$/i.test(n) && !(this.cur && this.cur.name === n)) { try { out.push({ name: n, size: (await h.getFile()).size }); } catch {} }
    return out.sort((a, b) => a.name < b.name ? 1 : -1);
  }
  async saveTakes() {   // the tablet's TAKES key
    let list; try { list = await this.takes(); } catch (e) { this.toast('TAKES: storage not readable (' + (e.message || e) + ')', 4000); return; }
    if (!list.length) { this.toast('TAKES: no recordings in storage yet', 3000); return; }
    for (const t of list) if (!this.pending.includes(t.name)) this.pending.push(t.name);
    if (this.inXR()) this.toast(`TAKES: ${list.length} recording${list.length > 1 ? 's' : ''} ready. Leave VR, then tap the SAVE button on the page`, 5000);
    else this.offer();
  }
  offer() {   // the 2D page's save banner for everything in pending
    if (!this.pending.length) return;
    let el = document.getElementById('vire-takes');
    if (!el) {
      el = document.createElement('div'); el.id = 'vire-takes';
      el.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:99999;display:flex;gap:10px;align-items:center;padding:12px 14px;background:#141922;border:1px solid #c8202c;border-radius:12px;font:600 18px system-ui,sans-serif;color:#e6e9ef;box-shadow:0 6px 24px rgba(0,0,0,.5)';
      document.body.appendChild(el);
    }
    const n = this.pending.length;
    el.innerHTML = '';
    const b = document.createElement('button'); b.textContent = `SAVE ${n} RECORDING${n > 1 ? 'S' : ''} TO DOWNLOADS`;
    b.style.cssText = 'font:700 20px system-ui,sans-serif;padding:14px 22px;border-radius:10px;border:0;background:#c8202c;color:#fff;cursor:pointer';
    const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Later';
    x.style.cssText = 'font:700 20px system-ui,sans-serif;padding:12px 16px;border-radius:10px;border:0;background:#2a3140;color:#c9ced8;cursor:pointer';
    b.onclick = async () => { b.disabled = true; b.textContent = 'SAVING…'; const list = this.pending.splice(0); let ok = 0;
      for (const nm of list) { try { await this.download(nm); ok++; } catch (e) { this.toast('Download failed for ' + nm, 4000); } await new Promise(r => setTimeout(r, 900)); }
      el.remove(); this.toast(`${ok} recording${ok === 1 ? '' : 's'} sent to Downloads (Quest: Files > Downloads; PC over USB: Internal shared storage\\Download)`, 6000); };
    x.onclick = () => el.remove();   // still in pending: TAKES or the next exit from VR offers them again
    el.append(b, x);
  }
  async flushDownloads() { const list = this.pending.splice(0); for (const n of list) { try { await this.download(n); } catch (e) { this.toast('REC MASTER: download failed for ' + n, 4000); } await new Promise(ok => setTimeout(ok, 800)); } }
  async prune(dir) {   // keep the newest KEEP - 1 old files, so the new one makes KEEP
    const names = []; for await (const [n, h] of dir.entries()) if (h.kind === 'file' && /\.wav$/i.test(n)) names.push(n);
    names.sort(); for (const n of names.slice(0, Math.max(0, names.length - (KEEP - 1)))) { try { await dir.removeEntry(n); } catch {} }
  }
}
