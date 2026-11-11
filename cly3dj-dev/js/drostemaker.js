// #705 DROSTE MAKER (owner, 11 Nov): a still or a short clip becomes a seamless picture-inside-itself loop, 2 or 4 bars
// long at the desk's master tempo, rendered 16:9 (1280 x 720) to an MP4 in the VIDEOS bank (and from there the CYCLO list).
// Runs in the VJ desk window (vjdesk.html), WebGL1 + WebCodecs + mp4-muxer, so the DirroVJ engine page is not touched.
//   ZOOM   the copy is a smaller picture of the frame at a spot you drag (size on the slider, TURN = it sits turned); the
//          view flies into it over the loop. At the end the copy fills the screen and IS the first frame: no seam.
//   SPIRAL Escher's 'Print Gallery' twist of the same nesting (the flower GIF): log-polar, one period per loop.
//   MOUTH  the copy sits in the mouth, seen only through the open lips (MediaPipe face landmarks, inner lip line per frame).
//          The copy plays the same frame as the outer picture, so the loop must start and end with the mouth open wide
//          enough to hold the copy: the trimmer shows it, AUTO SIZE fits the copy inside the lips at IN.
// Every level of the nesting shows the same source frame, so one texture and one mask per output frame are enough.
// Clips: IN / OUT trimmer, LOOP MATCH (how alike OUT and IN look), SNAP LOOP (best OUT within 0.6 s), the clip is
// sped up or slowed to fit the bars (shown; outside 0.5x .. 2x it warns).
const W = 1280, H = 720, ASP = W / H, FPS = 30;
const LIPS = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];   // MediaPipe face mesh inner lip line
const MP = new URL('../vendor/mediapipe/', import.meta.url).href;

const VS = `attribute vec2 p; varying vec2 vUv; void main() { vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `precision highp float; varying vec2 vUv;
uniform sampler2D tex, mask; uniform float asp, s, a, z, mode, edgeOn; uniform vec2 o;
vec2 rot(vec2 p, float t) { float c = cos(t), n = sin(t); return vec2(c * p.x - n * p.y, n * p.x + c * p.y); }
vec2 fuv(vec2 p) { return p / vec2(asp, 1.0) + 0.5; }
bool inFrame(vec2 p) { return abs(p.x) <= 0.5 * asp && abs(p.y) <= 0.5; }
void main() {
  vec2 q = (vUv - 0.5) * vec2(asp, 1.0);
  float c = cos(a), n = sin(a);
  // fixed point of M(p) = o + s R(a) p
  float a11 = 1.0 - s * c, a12 = s * n, a21 = -s * n, a22 = 1.0 - s * c, det = a11 * a22 - a12 * a21;
  vec2 fp = vec2(a22 * o.x - a12 * o.y, -a21 * o.x + a11 * o.y) / det;
  vec2 p; float shade = 1.0;
  if (mode > 0.5) {   // SPIRAL: log-polar about the fixed point, one turn = one level down, one loop = one level
    vec2 d = q - fp; float L = -log(s), al = atan(L / 6.2831853), f = cos(al);
    vec2 w = vec2(log(max(length(d), 1e-6)), atan(d.y, d.x));
    vec2 b = f * vec2(cos(al), sin(al)); float bb = dot(b, b);
    w = vec2(w.x * b.x + w.y * b.y, w.y * b.x - w.x * b.y) / bb;   // w / b
    w.x -= z * L;
    p = fp + exp(w.x) * vec2(cos(w.y), sin(w.y));
    for (int i = 0; i < 12; i++) { if (inFrame(p)) break; p = fp + s * rot(p - fp, a); }   // too far out: one level in
  } else {
    p = fp + pow(s, z) * rot(q - fp, a * z);
  }
  for (int i = 0; i < 10; i++) {   // inside the copy (and through the hole): step back out to the frame it shows
    vec2 r = rot(p - o, -a) / s;
    if (!inFrame(r)) break;
    if (texture2D(mask, fuv(p)).r < 0.5) break;
    float e = min(0.5 * asp - abs(r.x), 0.5 - abs(r.y)); shade *= mix(1.0 - 0.45 * edgeOn, 1.0, smoothstep(0.0, 0.01, e));
    p = r;
  }
  vec2 uv = fuv(p); uv = 1.0 - abs(1.0 - mod(uv, 2.0));
  gl_FragColor = vec4(texture2D(tex, uv).rgb * shade, 1.0);
}`;

export function makeDroste({ media, getBpm, onSaved, root }) {
  const $ = id => root.querySelector('#' + id);
  root.innerHTML = `
  <div class="row" style="margin-top:6px"><b style="min-width:92px">MAKER</b><button id="dmOpen">OPEN…</button><input type="file" id="dmFile" accept="image/*,video/*" hidden>
    <span id="dmName" class="note" style="margin:0">right-click an IMAGES / VIDEOS cell: SEND TO DROSTE</span></div>
  <div class="row"><button data-dm="zoom">ZOOM</button><button data-dm="spiral">SPIRAL</button><button data-dm="mouth">MOUTH</button><span style="width:10px"></span>
    <button data-dmb="2">2 BARS</button><button data-dmb="4">4 BARS</button><span style="width:10px"></span><button id="dmTurn">TURN</button>
    <label class="kv"><span style="width:62px">Copy size</span><input type="range" id="dmSize" min="0.03" max="0.6" step="0.005"></label></div>
  <div style="position:relative;max-width:640px"><canvas id="dmCv" width="${W}" height="${H}" style="width:100%;display:block;background:#000;border-radius:6px;cursor:crosshair"></canvas>
    <canvas id="dmOv" width="640" height="360" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></canvas></div>
  <div class="row" id="dmTrim" style="display:none"><span style="width:30px">IN</span><input type="range" id="dmIn" min="0" max="1" step="0.01" style="flex:1"><span style="width:38px">OUT</span><input type="range" id="dmOut" min="0" max="1" step="0.01" style="flex:1"><button id="dmSnap">SNAP LOOP</button></div>
  <div class="row" id="dmMouth" style="display:none"><button id="dmTrack">TRACK MOUTH</button><button id="dmAuto">AUTO SIZE</button></div>
  <div class="row"><button id="dmRender">RENDER MP4</button><span id="dmSt" class="note" style="margin:0"></span></div>`;
  const S = load(), cv = $('dmCv'), ov = $('dmOv'), og = ov.getContext('2d');
  let src = null;   // { kind: 'image' | 'video', el, name, dur }
  let track = null;  // MOUTH: [{ t, pts: [[x, y] .. ] (frame uv, y down) }]
  let busy = false, raf = 0, prevT = 0;
  const frameC = document.createElement('canvas'); frameC.width = W; frameC.height = H; const fg = frameC.getContext('2d');
  const maskC = document.createElement('canvas'); maskC.width = 320; maskC.height = 180; const mg = maskC.getContext('2d');
  // ---- GL
  const gl = cv.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
  const prog = (() => { const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p); return p; })();
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = n => gl.getUniformLocation(prog, n);
  const mkTex = unit => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
  const tTex = mkTex(0), tMask = mkTex(1); gl.uniform1i(U('tex'), 0); gl.uniform1i(U('mask'), 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  function draw(z, mouth) {   // frameC / maskC already hold this frame
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frameC);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tMask); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskC);
    const o = mouth ? mouth.o : [S.ox, S.oy];
    gl.uniform1f(U('asp'), ASP); gl.uniform1f(U('s'), S.size); gl.uniform1f(U('a'), S.mode === 'zoom' && S.turn ? S.angle : 0); gl.uniform1f(U('z'), z);
    gl.uniform1f(U('mode'), S.mode === 'spiral' ? 1 : 0); gl.uniform1f(U('edgeOn'), S.mode === 'mouth' ? 0 : 1); gl.uniform2f(U('o'), o[0], o[1]);
    gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  // ---- frame + mask for a source time
  function cover(el, w, h) { const ew = el.videoWidth || el.naturalWidth || el.width, eh = el.videoHeight || el.naturalHeight || el.height, k = Math.max(w / ew, h / eh); return [(w - ew * k) / 2, (h - eh * k) / 2, ew * k, eh * k]; }
  function paintFrame() { const [x, y, w, h] = cover(src.el, W, H); fg.fillStyle = '#000'; fg.fillRect(0, 0, W, H); fg.drawImage(src.el, x, y, w, h); }
  function lipsAt(t) {   // tracked inner lip line at source time t (lerped), frame uv y down
    if (!track || !track.length) return null;
    let i = 0; while (i < track.length - 1 && track[i + 1].t <= t) i++;
    const A = track[i], B = track[Math.min(i + 1, track.length - 1)]; if (!A.pts && !B.pts) return null;
    if (!A.pts || !B.pts || B.t === A.t) return (A.pts || B.pts);
    const k = Math.max(0, Math.min(1, (t - A.t) / (B.t - A.t))); return A.pts.map((p, j) => [p[0] + (B.pts[j][0] - p[0]) * k, p[1] + (B.pts[j][1] - p[1]) * k]);
  }
  function paintMask(t) {   // white = the copy may show through here
    mg.fillStyle = S.mode === 'mouth' ? '#000' : '#fff'; mg.fillRect(0, 0, 320, 180);
    if (S.mode !== 'mouth') return null;
    const L = lipsAt(t); if (!L) return null;
    mg.fillStyle = '#fff'; mg.beginPath(); L.forEach(([x, y], i) => i ? mg.lineTo(x * 320, y * 180) : mg.moveTo(x * 320, y * 180)); mg.closePath(); mg.fill();
    let cx = 0, cy = 0; for (const [x, y] of L) { cx += x; cy += y; } cx /= L.length; cy /= L.length;
    return { o: [(cx - 0.5) * ASP, 0.5 - cy], L };
  }
  // ---- source
  async function setSource(file, name) {
    stopPreview(); track = null;
    const url = URL.createObjectURL(file), vid = /^video\//.test(file.type) || /\.(mp4|webm|mov|m4v)$/i.test(name);
    if (src && src.url) URL.revokeObjectURL(src.url);
    if (vid) {
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = () => no(new Error('cannot read this video')); });
      src = { kind: 'video', el: v, name, url, dur: v.duration || 0 };
      S.inT = 0; S.outT = Math.min(src.dur, 4);
    } else {
      const im = new Image(); await new Promise((ok, no) => { im.onload = ok; im.onerror = () => no(new Error('cannot read this picture')); im.src = url; }); src = { kind: 'image', el: im, name, url, dur: 0 };
    }
    $('dmName').textContent = name + (src.kind === 'video' ? ` · ${src.dur.toFixed(2)} s` : ' · still');
    $('dmTrim').style.display = src.kind === 'video' ? '' : 'none'; if (src.kind === 'video') { for (const id of ['dmIn', 'dmOut']) { $(id).max = src.dur; } $('dmIn').value = S.inT; $('dmOut').value = S.outT; }
    ui(); startPreview(); if (src.kind === 'video') matchNow();
  }
  // ---- timing
  const bars = () => (S.bars === 4 ? 4 : 2), bpm = () => { const b = getBpm(); return b > 0 ? b : 120; }, loopLen = () => bars() * 4 * 60 / bpm();
  const speed = () => src && src.kind === 'video' ? Math.max(0.05, S.outT - S.inT) / loopLen() : 1;
  const srcTime = z => S.inT + z * Math.max(0.05, S.outT - S.inT);
  // ---- preview: plays the loop live (the clip at the speed it will have)
  function startPreview() { if (raf || !src) return; prevT = performance.now(); const step = async now => { raf = requestAnimationFrame(step); if (busy) return; await previewFrame(now); }; raf = requestAnimationFrame(step); }
  function stopPreview() { if (raf) cancelAnimationFrame(raf); raf = 0; if (src && src.kind === 'video') src.el.pause(); }
  let lastSeek = -1, seeking = false;
  async function previewFrame(now) {
    if (!src || !root.offsetParent) return;
    const z = ((now - prevT) / 1000 / loopLen()) % 1;
    if (src.kind === 'video') {
      const want = srcTime(z), v = src.el;
      if (v.paused || Math.abs(v.currentTime - want) > 0.25) { if (!seeking) { seeking = true; v.playbackRate = Math.max(0.25, Math.min(4, speed())); v.currentTime = want; v.play().catch(() => {}); setTimeout(() => { seeking = false; }, 120); } }
      else if (Math.abs(v.playbackRate - speed()) > 0.01) v.playbackRate = Math.max(0.25, Math.min(4, speed()));
    }
    paintFrame(); const m = paintMask(src.kind === 'video' ? src.el.currentTime : 0); draw(src.kind === 'video' ? (src.el.currentTime - S.inT) / Math.max(0.05, S.outT - S.inT) : z, m); overlay(m);
  }
  function overlay(m) {   // the copy's outline, the lips
    og.clearRect(0, 0, 640, 360); if (!src) return;
    og.strokeStyle = 'rgba(255,210,90,0.9)'; og.lineWidth = 1.5;
    if (m && m.L) { og.beginPath(); m.L.forEach(([x, y], i) => i ? og.lineTo(x * 640, y * 360) : og.moveTo(x * 640, y * 360)); og.closePath(); og.stroke(); }
  }
  // ---- seek helper for exact frames
  function seek(v, t) { return new Promise(ok => { const done = () => { v.removeEventListener('seeked', done); ok(); }; v.addEventListener('seeked', done); v.currentTime = Math.max(0, Math.min(v.duration - 0.001, t)); }); }
  // ---- LOOP MATCH / SNAP LOOP
  const thumb = document.createElement('canvas'); thumb.width = 64; thumb.height = 36; const tg = thumb.getContext('2d', { willReadFrequently: true });
  function sig() { const [x, y, w, h] = cover(src.el, 64, 36); tg.drawImage(src.el, x, y, w, h); const d = tg.getImageData(0, 0, 64, 36).data, g = new Float32Array(64 * 36); for (let i = 0; i < g.length; i++) g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.5 + d[i * 4 + 2] * 0.2; return g; }
  const likeness = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return Math.max(0, 100 - s / a.length / 2.55 * 2); };
  async function matchNow() {
    if (!src || src.kind !== 'video' || busy) return; busy = true; stopPreview();
    try { const v = src.el; await seek(v, S.inT); const a = sig(); await seek(v, S.outT); const b = sig(); S.match = Math.round(likeness(a, b)); }
    finally { busy = false; ui(); startPreview(); }
  }
  async function snapLoop() {
    if (!src || src.kind !== 'video' || busy) return; busy = true; stopPreview(); st('SNAP LOOP: looking for the best OUT…');
    try {
      const v = src.el; await seek(v, S.inT); const a = sig(); let best = S.outT, bs = -1;
      for (let t = Math.max(S.inT + 0.3, S.outT - 0.6); t <= Math.min(src.dur, S.outT + 0.6); t += 1 / 15) { await seek(v, t); const k = likeness(a, sig()); if (k > bs) { bs = k; best = t; } }
      S.outT = Math.round(best * 100) / 100; S.match = Math.round(bs); $('dmOut').value = S.outT; save(); st('');
    } finally { busy = false; ui(); startPreview(); }
  }
  // ---- MOUTH tracking (MediaPipe face landmarks, 15 samples a second over IN..OUT)
  let fl = null;
  async function landmarker() {
    if (fl) return fl;
    const { FilesetResolver, FaceLandmarker } = await import(MP + 'vision_bundle.mjs');
    const fs = await FilesetResolver.forVisionTasks(MP + 'wasm');
    const make = delegate => FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: MP + 'face_landmarker.task', delegate }, runningMode: 'VIDEO', numFaces: 1 });
    try { fl = await make('GPU'); } catch { fl = await make('CPU'); }
    return fl;
  }
  async function trackMouth() {
    if (!src || busy) return; busy = true; stopPreview();
    try {
      st('MOUTH: loading the face model…'); const L = await landmarker(); const out = [];
      const times = src.kind === 'video' ? [] : [0]; if (src.kind === 'video') for (let t = S.inT; t <= S.outT + 1e-3; t += 1 / 15) times.push(t);
      let ts = performance.now();
      for (let i = 0; i < times.length; i++) {
        if (src.kind === 'video') await seek(src.el, times[i]);
        paintFrame(); const r = L.detectForVideo(frameC, ts += 67), f = r && r.faceLandmarks && r.faceLandmarks[0];
        out.push({ t: times[i], pts: f ? LIPS.map(k => [f[k].x, f[k].y]) : null });
        if (i % 5 === 0) st(`MOUTH: tracking ${i + 1} / ${times.length}…`);
      }
      // fill gaps (frames with no face) from the nearest found
      for (let i = 0; i < out.length; i++) if (!out[i].pts) { for (let d = 1; d < out.length; d++) { const j = out[i - d] && out[i - d].pts ? i - d : out[i + d] && out[i + d].pts ? i + d : -1; if (j >= 0) { out[i].pts = out[j].pts; break; } } }
      if (!out.some(x => x.pts)) { track = null; st('MOUTH: no face found. Use a clip with the face large and in good light.'); return; }
      track = out; autoSize(); st(`MOUTH: tracked ${out.length} frames. ${openAtLoop()}`);
    } catch (e) { st('MOUTH: ' + (e.message || e)); }
    finally { busy = false; ui(true); startPreview(); }
  }
  function lipBox(t) { const L = lipsAt(t); if (!L) return null; let x0 = 1, x1 = 0, y0 = 1, y1 = 0; for (const [x, y] of L) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { w: (x1 - x0) * ASP, h: y1 - y0 }; }
  function autoSize() {   // the biggest copy (16:9, size = its height) that sits inside the lips at the loop point
    const b = lipBox(S.inT); if (!b) return; S.size = Math.max(0.03, Math.min(0.6, Math.min(b.w * 0.62 / ASP, b.h * 0.62))); save(); ui(true);
  }
  function openAtLoop() { const b = lipBox(S.inT); if (!b) return ''; return b.h * 0.62 >= S.size * 0.95 && b.w * 0.62 >= S.size * ASP * 0.95 ? 'The mouth holds the copy at the loop point.' : 'The mouth is not open enough at IN for this copy size: move IN to where it is wide open, or AUTO SIZE.'; }
  // ---- RENDER: every frame seeked, drawn and encoded with its exact time (WebCodecs H.264 + mp4-muxer): a frame-exact loop
  async function render() {
    if (!src || busy) return;
    if (!window.VideoEncoder) { st('This browser has no WebCodecs encoder (use Chrome or Edge).'); return; }
    if (S.mode === 'mouth' && !track) { st('MOUTH: press TRACK MOUTH first.'); return; }
    busy = true; stopPreview();
    try {
      const { Muxer, ArrayBufferTarget } = await import(new URL('../vendor/mp4muxer/mp4-muxer.mjs', import.meta.url).href);
      const N = Math.round(loopLen() * FPS), mux = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory' });
      let encErr = null; const enc = new VideoEncoder({ output: (c, m) => mux.addVideoChunk(c, m), error: e => { encErr = e; } });
      enc.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 10e6, framerate: FPS });
      for (let i = 0; i < N; i++) {
        const z = i / N, t = srcTime(z);
        if (src.kind === 'video') await seek(src.el, t);
        paintFrame(); draw(z, paintMask(src.kind === 'video' ? t : 0));
        const fr = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
        enc.encode(fr, { keyFrame: i % 30 === 0 }); fr.close();
        if (encErr) throw encErr;
        while (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 5));
        if (i % 10 === 0) st(`Rendering ${i + 1} / ${N} frames…`);
      }
      await enc.flush(); enc.close(); mux.finalize();
      const blob = new Blob([mux.target.buffer], { type: 'video/mp4' });
      const base = (src.name || 'droste').replace(/\.[^.]+$/, '').slice(0, 40), name = `droste ${S.mode} ${bars()}bars ${base}.mp4`;
      const saved = await media.importFile('Video', new File([blob], name, { type: 'video/mp4' }));
      onSaved && onSaved('Video', saved);
      st(`Saved to VIDEOS: ${saved} (${loopLen().toFixed(2)} s, ${bars()} bars at ${bpm().toFixed(1)} BPM, ${(blob.size / 1e6).toFixed(1)} MB).`);
    } catch (e) { st('Render failed: ' + (e.message || e)); }
    finally { busy = false; ui(true); startPreview(); }
  }
  // ---- UI
  function st(t) { $('dmSt').textContent = t; }
  function ui(keep) {
    for (const b of root.querySelectorAll('[data-dm]')) b.classList.toggle('on', S.mode === b.dataset.dm);
    for (const b of root.querySelectorAll('[data-dmb]')) b.classList.toggle('on', bars() === +b.dataset.dmb);
    $('dmTurn').classList.toggle('on', !!S.turn); $('dmTurn').disabled = S.mode !== 'zoom'; $('dmSize').value = S.size;
    $('dmMouth').style.display = S.mode === 'mouth' ? '' : 'none'; if (!src || src.kind !== 'video') $('dmTrim').style.display = 'none';
    const sp = speed(), info = src && src.kind === 'video' ? ` · IN ${S.inT.toFixed(2)} s · OUT ${S.outT.toFixed(2)} s · loop match ${S.match ?? '-'}% · plays ${sp.toFixed(2)}x${sp < 0.5 || sp > 2 ? ' (far from 1x: trim closer to ' + loopLen().toFixed(1) + ' s)' : ''}` : '';
    if (!keep && !busy && src) st(`${bars()} bars = ${loopLen().toFixed(2)} s at ${bpm().toFixed(1)} BPM${getBpm() > 0 ? '' : ' (no beat: 120)'}${info}`);
  }
  function load() { let s = {}; try { s = JSON.parse(localStorage.getItem('vire.vjDroste') || '{}'); } catch {} return { mode: 'zoom', bars: 2, size: 0.3, turn: false, angle: 0.5, ox: 0, oy: 0, inT: 0, outT: 4, match: null, ...s }; }
  function save() { try { const { match, inT, outT, ...k } = S; localStorage.setItem('vire.vjDroste', JSON.stringify(k)); } catch {} }
  root.querySelectorAll('[data-dm]').forEach(b => b.onclick = () => { S.mode = b.dataset.dm; save(); ui(); });
  root.querySelectorAll('[data-dmb]').forEach(b => b.onclick = () => { S.bars = +b.dataset.dmb; save(); ui(); });
  $('dmTurn').onclick = () => { S.turn = !S.turn; save(); ui(); };
  $('dmSize').oninput = e => { S.size = +e.target.value; save(); ui(); };
  $('dmOpen').onclick = () => $('dmFile').click();
  $('dmFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) setSource(f, f.name).catch(err => st(err.message)); };
  $('dmIn').oninput = e => { S.inT = Math.min(+e.target.value, S.outT - 0.2); e.target.value = S.inT; ui(); };
  $('dmOut').oninput = e => { S.outT = Math.max(+e.target.value, S.inT + 0.2); e.target.value = S.outT; ui(); };
  $('dmIn').onchange = $('dmOut').onchange = () => matchNow();
  $('dmSnap').onclick = () => snapLoop(); $('dmTrack').onclick = () => trackMouth(); $('dmAuto').onclick = () => { autoSize(); st(openAtLoop()); };
  $('dmRender').onclick = () => render();
  // drag on the picture = where the copy sits (ZOOM / SPIRAL); the wheel = its size
  const toC = e => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width - 0.5) * ASP, 0.5 - (e.clientY - r.top) / r.height]; };
  let drag = false;
  cv.onpointerdown = e => { if (S.mode === 'mouth') return; drag = true; cv.setPointerCapture(e.pointerId); [S.ox, S.oy] = toC(e); };
  cv.onpointermove = e => { if (!drag) return; const [x, y] = toC(e), lim = 0.5 * (1 - S.size); S.ox = Math.max(-lim * ASP, Math.min(lim * ASP, x)); S.oy = Math.max(-lim, Math.min(lim, y)); };
  cv.onpointerup = () => { if (drag) { drag = false; save(); } };
  cv.onwheel = e => { e.preventDefault(); S.size = Math.max(0.03, Math.min(0.6, S.size * (e.deltaY > 0 ? 0.95 : 1.05))); save(); ui(); };
  ui();
  root.__dm = { get busy() { return busy; }, get src() { return src; }, S, ui };   // test hook
  return { setSource, get busy() { return busy; } };
}
