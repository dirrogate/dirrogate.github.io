// #751 PROGRAM REC: DirroVJ records its own program picture (what goes to Twitch / DirroTV) with the master sound, on this laptop.
// Video: WebCodecs H.264, hardware encoder asked for first (on an NVIDIA laptop Chrome hands it to NVENC through Windows), a steady
// 30 fps (a slot missed by the program repeats the last picture). Sound: the same track Twitch gets (Quest master or LINE IN), mixed
// through our own 48 kHz context so a source change mid-show keeps one continuous track, Opus 192 kbit/s. Container: Matroska (.mkv)
// with live-style unknown sizes, written as it goes by a worker into the browser's private storage with a sync access handle (written
// in place and flushed every 2 s), so a crash keeps everything up to the last flush; the desk lists the takes and saves them out.
const FPS = 30, SLOT = 1e6 / FPS, GOP = 2 * FPS;
const te = new TextEncoder();
// ---- tiny Matroska writer
function vsize(n) {   // EBML size vint, shortest form
  for (let L = 1; L <= 8; L++) { if (n < 2 ** (7 * L) - 1) { const b = new Uint8Array(L); let v = n; for (let i = L - 1; i >= 0; i--) { b[i] = v & 0xff; v = Math.floor(v / 256); } b[0] |= 1 << (8 - L); return b; } }
  throw new Error('size');
}
const idB = id => { const a = []; while (id > 0) { a.unshift(id & 0xff); id = Math.floor(id / 256); } return new Uint8Array(a); };
const cat = parts => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
const el = (id, data) => cat([idB(id), vsize(data.length), data]);
const uint = (id, v) => { const a = []; do { a.unshift(v & 0xff); v = Math.floor(v / 256); } while (v > 0); return el(id, new Uint8Array(a)); };
const flt = (id, v) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return el(id, b); };
const str = (id, s) => el(id, te.encode(s));
const bin = (id, b) => el(id, new Uint8Array(b));
const UNKNOWN = new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
function opusHead(ch, rate, pre) { const b = new Uint8Array(19), d = new DataView(b.buffer); b.set(te.encode('OpusHead')); b[8] = 1; b[9] = ch; d.setUint16(10, pre, true); d.setUint32(12, rate, true); d.setInt16(16, 0, true); b[18] = 0; return b; }

export function makeProgRec({ canvas, audioTrack, setRes, onChange }) {
  const R = { on: false, starting: false, name: '', t0: 0, bytes: 0, frames: 0, dropped: 0, dup: 0, hw: '', res: 720, err: '', w: 0, h: 0, audio: false, last: '' };
  let ve = null, ae = null, worker = null, actx = null, aDst = null, aSrc = null, aSrcTrack = null, aReader = null, aFirst = null;
  let vConf = null, headerDone = false, clusterTs = -1, lastSlot = -1, vq = [], aq = [], lastATs = -1, lastAWall = 0, out = [], outN = 0, sendT = 0, prevFrame = null, keyN = 0;
  const post = () => onChange && onChange();
  function write(b) { out.push(b); outN += b.length; R.bytes += b.length; }
  function ship(force) {
    const now = performance.now(); if (!worker || !outN || (!force && now - sendT < 250)) return;
    sendT = now; const buf = cat(out); out = []; outN = 0; worker.postMessage({ k: 'data', d: buf.buffer }, [buf.buffer]);
  }
  function header() {
    const ebml = el(0x1A45DFA3, cat([uint(0x4286, 1), uint(0x42F7, 1), uint(0x42F2, 4), uint(0x42F3, 8), str(0x4282, 'matroska'), uint(0x4287, 4), uint(0x4285, 2)]));
    const info = el(0x1549A966, cat([uint(0x2AD7B1, 1000000), str(0x4D80, 'DirroVJ'), str(0x5741, 'DirroVJ PROGRAM REC')]));
    const vt = el(0xAE, cat([uint(0xD7, 1), uint(0x73C5, 1), uint(0x83, 1), uint(0x9C, 0), str(0x86, 'V_MPEG4/ISO/AVC'), ...(vConf ? [bin(0x63A2, vConf)] : []), uint(0x23E383, Math.round(1e9 / FPS)), el(0xE0, cat([uint(0xB0, R.w), uint(0xBA, R.h)]))]));
    const at = R.audio ? el(0xAE, cat([uint(0xD7, 2), uint(0x73C5, 2), uint(0x83, 2), uint(0x9C, 0), str(0x86, 'A_OPUS'), bin(0x63A2, opusHead(2, 48000, 312)), uint(0x56AA, 6500000), uint(0x56BB, 80000000), el(0xE1, cat([flt(0xB5, 48000), uint(0x9F, 2)]))])) : new Uint8Array(0);
    write(cat([ebml, idB(0x18538067), UNKNOWN, info, el(0x1654AE6B, cat([vt, at]))]));
    headerDone = true;
  }
  function block(track, tsUs, key, data) {
    const ms = Math.round(tsUs / 1000);
    if (clusterTs < 0 || (track === 1 && key) || ms - clusterTs > 30000 || ms - clusterTs < -30000) { clusterTs = ms; write(cat([idB(0x1F43B675), UNKNOWN, uint(0xE7, Math.max(0, ms))])); }
    const h = new Uint8Array(4); h[0] = 0x80 | track; new DataView(h.buffer).setInt16(1, ms - clusterTs); h[3] = key ? 0x80 : 0;
    write(el(0xA3, cat([h, data])));
  }
  function pump(final) {   // interleave by time: write what is older than both queues' newest
    if (!headerDone) { if (!vConf) return; header(); }
    if (clusterTs < 0) { while (vq.length && !vq[0].key) vq.shift(); if (!vq.length) return; aq = aq.filter(a => a.ts >= vq[0].ts - 50000); }
    const aLive = R.audio && performance.now() - lastAWall < 600;
    for (;;) {
      const v = vq[0], a = aq[0];
      if (v && a) { if (a.ts < v.ts) block(2, aq.shift().ts, true, a.d); else { vq.shift(); block(1, v.ts, v.key, v.d); } continue; }
      if (v && (!aLive || final)) { vq.shift(); block(1, v.ts, v.key, v.d); continue; }
      if (a && (final || vq.length === 0 && a.ts < (lastSlot + 1) * SLOT - 200000)) { aq.shift(); block(2, a.ts, true, a.d); continue; }
      break;
    }
    ship(final);
  }
  async function pickVideo(w, h, kbps) {
    for (const [codec, hwa] of [['avc1.640028', 'prefer-hardware'], ['avc1.4d0028', 'prefer-hardware'], ['avc1.640028', 'no-preference'], ['avc1.42e028', 'no-preference']]) {
      const c = { codec, width: w, height: h, bitrate: kbps * 1000, framerate: FPS, hardwareAcceleration: hwa, bitrateMode: 'variable', latencyMode: 'quality', avc: { format: 'avc' } };
      try { const s = await VideoEncoder.isConfigSupported(c); if (s && s.supported) return { c, hw: hwa === 'prefer-hardware' ? 'hardware (NVENC on an NVIDIA GPU)' : 'software' }; } catch {}
    }
    return null;
  }
  function audioHook() {   // follows the Twitch sound track (Quest master / LINE IN) without breaking our own continuous track
    const t = audioTrack && audioTrack(); if (!actx || t === aSrcTrack) return;
    try { if (aSrc) aSrc.disconnect(); } catch {} aSrc = null; aSrcTrack = t;
    if (t && t.readyState === 'live') { try { aSrc = actx.createMediaStreamSource(new MediaStream([t])); aSrc.connect(aDst); } catch {} }
  }
  async function startAudio() {
    if (typeof AudioEncoder === 'undefined' || typeof MediaStreamTrackProcessor === 'undefined') return false;
    try {
      const cfg = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
      if (!(await AudioEncoder.isConfigSupported(cfg)).supported) return false;
      actx = new AudioContext({ sampleRate: 48000 }); aDst = actx.createMediaStreamDestination(); aDst.channelCount = 2;
      const keep = actx.createConstantSource(); keep.offset.value = 0; keep.connect(aDst); keep.start();   // the track runs even with no source (silence)
      actx.resume().catch(() => {}); audioHook();
      ae = new AudioEncoder({ output: ch => { const d = new Uint8Array(ch.byteLength); ch.copyTo(d); aq.push({ ts: ch.timestamp, d }); lastATs = ch.timestamp; lastAWall = performance.now(); pump(false); }, error: e => { R.err = 'sound: ' + e.message; post(); } });
      ae.configure(cfg);
      const tr = aDst.stream.getAudioTracks()[0]; aReader = new MediaStreamTrackProcessor({ track: tr }).readable.getReader();
      (async () => { for (;;) { let r; try { r = await aReader.read(); } catch { break; } if (r.done) break; const a = r.value;
        if (!R.on || !ae || ae.state !== 'configured') { a.close(); continue; }
        if (!aFirst) aFirst = { ts: a.timestamp, wall: performance.now() };
        const ts = a.timestamp - aFirst.ts + (aFirst.wall - R.t0) * 1000;
        if (ts < 0) { a.close(); continue; }
        try { const d = new AudioData({ format: a.format, sampleRate: a.sampleRate, numberOfFrames: a.numberOfFrames, numberOfChannels: a.numberOfChannels, timestamp: ts, data: (() => { const n = a.allocationSize({ planeIndex: 0 }) * (a.format && a.format.endsWith('-planar') ? a.numberOfChannels : 1); const buf = new ArrayBuffer(n); if (a.format && a.format.endsWith('-planar')) { const per = n / a.numberOfChannels; for (let p = 0; p < a.numberOfChannels; p++) a.copyTo(new Uint8Array(buf, p * per, per), { planeIndex: p }); } else a.copyTo(buf, { planeIndex: 0 }); return buf; })() }); ae.encode(d); d.close(); } catch (e) { R.err = 'sound: ' + e.message; }
        a.close(); } })();
      return true;
    } catch (e) { R.err = 'sound: ' + e.message; return false; }
  }
  async function start(res) {
    if (R.on || R.starting) return; R.starting = true; R.err = ''; R.res = res === 1080 ? 1080 : 720; post();
    try {
      if (typeof VideoEncoder === 'undefined') throw new Error('this browser has no WebCodecs video encoder');
      setRes && setRes(R.res); await new Promise(r => setTimeout(r, 300));   // the program redraws at the new size first
      R.w = canvas.width & ~1; R.h = canvas.height & ~1;
      const pick = await pickVideo(R.w, R.h, R.res === 1080 ? 14000 : 8000); if (!pick) throw new Error('no H.264 encoder for ' + R.w + 'x' + R.h);
      R.hw = pick.hw;
      const d = new Date(), p2 = n => String(n).padStart(2, '0');
      R.name = `DirroVJ_show_${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}_${R.res}p.mkv`;
      worker = new Worker(new URL('./progrec-worker.js', import.meta.url), { type: 'module' });
      const opened = new Promise((ok, no) => { worker.onmessage = e => { const m = e.data; if (m.k === 'open') ok(); else if (m.k === 'err') { R.err = 'disk: ' + m.e; no(new Error(m.e)); post(); } else if (m.k === 'closed') { R.last = R.name; post(); } }; });
      worker.postMessage({ k: 'open', name: R.name }); await opened;
      Object.assign(R, { bytes: 0, frames: 0, dropped: 0, dup: 0 }); vConf = null; headerDone = false; clusterTs = -1; lastSlot = -1; vq = []; aq = []; out = []; outN = 0; aFirst = null; keyN = 0; lastATs = -1; lastAWall = 0;
      ve = new VideoEncoder({ output: (ch, meta) => { if (meta && meta.decoderConfig && meta.decoderConfig.description && !vConf) vConf = new Uint8Array(meta.decoderConfig.description instanceof ArrayBuffer ? meta.decoderConfig.description : meta.decoderConfig.description.buffer.slice(meta.decoderConfig.description.byteOffset, meta.decoderConfig.description.byteOffset + meta.decoderConfig.description.byteLength)); const b = new Uint8Array(ch.byteLength); ch.copyTo(b); vq.push({ ts: ch.timestamp, key: ch.type === 'key', d: b }); pump(false); }, error: e => { R.err = 'video: ' + e.message; post(); } });
      ve.configure(pick.c);
      R.t0 = performance.now(); R.on = true;
      R.audio = await startAudio();
    } catch (e) { R.err = e.message; await stop(true); }
    R.starting = false; post();
  }
  function frame(now) {   // called by studio.js right after the program is drawn (same task: the drawing buffer is still there)
    if (!R.on || !ve || ve.state !== 'configured') return;
    audioHook();
    const slot = Math.floor((now - R.t0) / (1000 / FPS)); if (slot <= lastSlot) return;
    if (ve.encodeQueueSize > 12) { R.dropped += slot - lastSlot; lastSlot = slot; return; }
    let f; try { f = new VideoFrame(canvas, { timestamp: slot * SLOT, duration: SLOT }); } catch (e) { R.err = 'frame: ' + e.message; return; }
    const gap = lastSlot < 0 ? 0 : Math.min(15, slot - lastSlot - 1);
    if (gap > 0 && prevFrame) for (let i = 1; i <= gap; i++) { const s = lastSlot + i, c = new VideoFrame(prevFrame, { timestamp: s * SLOT, duration: SLOT }); ve.encode(c, { keyFrame: s % GOP === 0 }); c.close(); R.dup++; }
    ve.encode(f, { keyFrame: lastSlot < 0 || Math.floor(slot / GOP) !== Math.floor(lastSlot / GOP) });
    if (prevFrame) prevFrame.close(); prevFrame = f; lastSlot = slot; R.frames++;
  }
  async function stop(fail) {
    const wasOn = R.on; R.on = false;
    try { if (ve && ve.state === 'configured') await ve.flush(); } catch {}
    try { if (ae && ae.state === 'configured') await ae.flush(); } catch {}
    if (wasOn) pump(true);
    try { if (ve) ve.close(); } catch {} try { if (ae) ae.close(); } catch {} ve = ae = null;
    try { if (aReader) aReader.cancel(); } catch {} aReader = null;
    try { if (actx) actx.close(); } catch {} actx = null; aSrc = null; aSrcTrack = null;
    if (prevFrame) { prevFrame.close(); prevFrame = null; }
    ship(true);
    if (worker) { const w = worker; worker = null; w.postMessage({ k: 'close' }); setTimeout(() => w.terminate(), 5000); }
    setRes && setRes(720); post();
  }
  const state = () => ({ on: R.on, starting: R.starting, name: R.name, sec: R.on ? (performance.now() - R.t0) / 1000 : 0, bytes: R.bytes, frames: R.frames, dropped: R.dropped, dup: R.dup, hw: R.hw, res: R.res, w: R.w, h: R.h, audio: R.audio, err: R.err, last: R.last });
  return { start, stop, frame, state, R };
}
