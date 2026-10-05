// #209 PerfCap (phase 1): records everything the gear does during a set, on the Quest, for an offline re-render later
// (see the project doc perfcap-plan.md). It records exactly the messages the spectator link sends the phone (the
// moving parts, records with their grooves and labels, LED wall / VideoVinyl / sky state, head, hands and
// controllers, 30 a second), whether or not a phone is connected, so the render page can replay them with the
// phone's own mirror code. Plus PerfCap marks: floor marks touched with the controller tip (camera calibration).
//
// Storage: the Quest's private storage, 'sed-perf/<take>/part-NNN.gz', one gzip part per 5 minutes (a crash
// loses at most the part being written). Each part is gzip'd NDJSON: one JSON object per line,
//   { "t": ms since the take started, "c": channel ("ctl" | "state" | "pc"), "m": message }
// The first line of part 1 is the header { t: 0, c: 'pc', m: { k: 'perfcap', v: 1, wall, app, rate } }; the last
// line of the last part is { c: 'pc', m: { k: 'end', ... } }. Save take downloads one file, <take>.c3perf: the line
// 'C3PERF1', a JSON line { name, parts: [byte length of each part] }, then the parts' gzip bytes back to back.
const ROOT = 'sed-perf', PART_MS = 5 * 60 * 1000;
const enc = new TextEncoder();

async function rootDir() { return (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, { create: true }); }

export function makePerfCap({ toast }) {
  const P = { on: false, name: '', t0: 0, wall: 0, lines: 0, bytes: 0, parts: 0, marks: [], err: '', last: '' };
  let dir = null, part = null, buf = [], bufLen = 0, flushT = null, partT0 = 0, chain = Promise.resolve();
  try { P.marks = JSON.parse(localStorage.getItem('sed.perfMarks') || '[]'); } catch {}

  async function openPart() {
    P.parts++;
    const fh = await dir.getFileHandle(`part-${String(P.parts).padStart(3, '0')}.gz`, { create: true });
    const file = await fh.createWritable();
    const cs = new CompressionStream('gzip'), w = cs.writable.getWriter();
    const piped = cs.readable.pipeTo(file);   // closes the file when the gzip stream ends
    part = { w, piped }; partT0 = performance.now();
  }
  async function closePart() {
    if (!part) return; const p = part; part = null;
    await p.w.close(); await p.piped;
  }
  function flush() {
    if (!buf.length) return;
    const data = enc.encode(buf.join('')); buf = []; bufLen = 0; P.bytes += data.length;
    chain = chain.then(async () => {
      if (!part) return;
      await part.w.write(data);
      if (performance.now() - partT0 > PART_MS) { await closePart(); await openPart(); }   // a closed part is safe on disk
    }).catch(e => { P.err = e.message; });
  }
  function write(c, m) {
    if (!P.on) return;
    const line = JSON.stringify({ t: Math.round(performance.now() - P.t0), c, m }) + '\n';
    buf.push(line); bufLen += line.length; P.lines++;
    if (bufLen > 256 * 1024) flush();
  }

  async function start() {
    if (P.on) return;
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    P.name = `Cly3DJ_perf_${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    try {
      dir = await (await rootDir()).getDirectoryHandle(P.name, { create: true });
      P.parts = 0; P.lines = 0; P.bytes = 0; P.err = '';
      await openPart();
    } catch (e) { P.err = e.message; toast && toast('PerfCap: ' + e.message, 4000); return; }
    P.t0 = performance.now(); P.wall = Date.now(); P.on = true;
    write('pc', { k: 'perfcap', v: 1, wall: P.wall, app: 'Cly3DJ', rate: 30, marks: P.marks });
    flushT = setInterval(flush, 1000);
    toast && toast('PerfCap recording', 2000);
  }
  async function stop() {
    if (!P.on) return;
    write('pc', { k: 'end', dur: Math.round(performance.now() - P.t0), lines: P.lines + 1 });
    P.on = false; clearInterval(flushT); flush();
    await chain; await closePart().catch(e => { P.err = e.message; });
    const s = Math.round((performance.now() - P.t0) / 1000);
    P.last = `${P.name} (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}, ${(P.bytes / 1048576).toFixed(1)} MB before gzip)`;
    toast && toast('PerfCap saved: ' + P.last, 4000);
  }
  // a floor mark touched with the controller tip (rig space), numbered in order; kept for the next takes too
  function mark(p) {
    const n = P.marks.length + 1; P.marks.push({ n, p });
    try { localStorage.setItem('sed.perfMarks', JSON.stringify(P.marks)); } catch {}
    write('pc', { k: 'mark', n, p });
    toast && toast(`PerfCap mark ${n} saved`, 1500);
  }
  function clearMarks() { P.marks = []; try { localStorage.removeItem('sed.perfMarks'); } catch {} write('pc', { k: 'marks-cleared' }); }
  async function takes() {   // [{ name, parts, size }] newest first
    const out = [];
    try { for await (const [name, h] of (await rootDir()).entries()) {
      if (h.kind !== 'directory') continue; let size = 0, parts = 0;
      for await (const [, f] of h.entries()) if (f.kind === 'file') { size += (await f.getFile()).size; parts++; }
      out.push({ name, parts, size });
    } } catch {}
    return out.sort((a, b) => b.name.localeCompare(a.name));
  }
  async function partsOf(name) {
    const d = await (await rootDir()).getDirectoryHandle(name), files = [];
    for await (const [n, f] of d.entries()) if (f.kind === 'file' && /^part-\d+\.gz$/.test(n)) files.push([n, await f.getFile()]);
    return files.sort((a, b) => a[0].localeCompare(b[0])).map(f => f[1]);
  }
  async function takeFile(name) {   // the .c3perf container (see the top)
    const parts = await partsOf(name);
    const head = enc.encode('C3PERF1\n' + JSON.stringify({ name, parts: parts.map(p => p.size) }) + '\n');
    return new File([head, ...parts], name + '.c3perf', { type: 'application/octet-stream' });
  }
  async function download(name) {
    if (!name) { const t = await takes(); if (!t.length) { toast && toast('No PerfCap takes yet', 2500); return; } name = t[0].name; }
    const f = await takeFile(name), a = document.createElement('a'), u = URL.createObjectURL(f);
    a.href = u; a.download = f.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000);
    toast && toast(`Saving ${f.name} (${(f.size / 1048576).toFixed(1)} MB) to Downloads`, 3000);
  }
  // read a take back (render page / tests): a take name, or a .c3perf file -> array of { t, c, m }
  async function read(src) {
    let blobs;
    if (typeof src === 'string') blobs = await partsOf(src);
    else {
      const head = new TextDecoder().decode(await src.slice(0, 4096).arrayBuffer()), i1 = head.indexOf('\n'), i2 = head.indexOf('\n', i1 + 1);
      if (head.slice(0, i1) !== 'C3PERF1') throw new Error('not a PerfCap file');
      const idx = JSON.parse(head.slice(i1 + 1, i2)); let off = enc.encode(head.slice(0, i2 + 1)).length; blobs = [];
      for (const n of idx.parts) { blobs.push(src.slice(off, off + n)); off += n; }
    }
    const out = [];
    for (const b of blobs) {
      const text = await new Response(b.stream().pipeThrough(new DecompressionStream('gzip'))).text();
      for (const l of text.split('\n')) if (l) out.push(JSON.parse(l));
    }
    return out;
  }
  return { P, start, stop, write, mark, clearMarks, takes, takeFile, download, read, get on() { return P.on; } };
}
