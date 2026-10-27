// #507 DirroVJ desk, output side (CLAUDE.md #507, project doc dirrovj-plan.md phase 3). Runs inside the DirroVJ page (studio.js, vj).
// The studio's composite (the Quest's picture + backdrop + overlays) becomes one source among several. Two buses A / B and a crossfader
// make the program picture on the screen (HDMI) and on Twitch. Sources: QUEST, FRACTAL (Amiga-style Mandelbrot landscape), WEBCAM,
// LED CLIP, BLACK. The control window (vjdesk.html) talks to this page over a BroadcastChannel; it gets the state, the queue and a small
// program preview, and sends commands back. Scroller desk: Twitch chat (read here, anonymous) + HoloSMS (forwarded by the Quest) in one
// queue; APPROVE sends the line to the Quest's own sine scroller ('vjsine'), which the Quest accepts only from a DirroVJ the DJ allowed.
// LINE IN: an audio input on this laptop replaces the Quest's sound for Twitch. No beat sync anywhere: the VJ fades and rides by hand.
import { TwitchChat } from './chat.js';
import { makeComics } from './comics.js';   // #516 DirroComics

const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const MIX_FS = `uniform sampler2D tA, tB; uniform vec4 fA, fB; uniform float kA, kB, x; varying vec2 vUv;
vec3 src(sampler2D t, vec4 f, float k) { if (k < 0.5) return vec3(0.0); return texture2D(t, f.xy + vUv * f.zw).rgb; }
void main() { gl_FragColor = vec4(mix(src(tA, fA, kA), src(tB, fB, kB), x), 1.0); }`;
// heights (r), colour detail (g), inside the set (b). Four formulas; inside the set the height comes from an orbit trap (how close the
// orbit passes the axes and the origin), so the old flat plateau becomes ridges, domes and swirls (#508)
const H_FS = `uniform vec2 c0, jc; uniform float span, maxI, ftype; varying vec2 vUv;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() {
  vec2 p = c0 + (vUv - 0.5) * span, z, c;
  if (ftype > 0.5 && ftype < 1.5) { z = p; c = jc; } else { z = vec2(0.0); c = p; }
  float n = 0.0, trap = 1e9, ax = 1e9; bool inside = true;
  for (int i = 0; i < 400; i++) {
    if (float(i) >= maxI) break;
    if (ftype > 1.5 && ftype < 2.5) { z = abs(z); z = vec2(z.x * z.x - z.y * z.y, -2.0 * z.x * z.y) + c; }   // Burning Ship
    else if (ftype > 2.5) z = cmul(cmul(z, z), z) + c;                                                     // z^3 + c
    else z = cmul(z, z) + c;                                                                               // Mandelbrot / Julia
    trap = min(trap, length(z)); ax = min(ax, min(abs(z.x), abs(z.y)));
    if (dot(z, z) > 64.0) { inside = false; break; }
    n += 1.0;
  }
  float h, d;
  if (inside) {
    float r = clamp(trap * 1.6, 0.0, 1.0), q = clamp(ax * 6.0, 0.0, 1.0);
    h = 0.36 + 0.22 * (1.0 - r) + 0.12 * (1.0 - q) * (1.0 - q);   // domes round the orbit's centre, ridges along the axes
    d = fract(r * 3.0 + q);
  } else {
    float sm = n + 1.0 - log2(log2(max(dot(z, z), 1.0001)) * 0.5);
    h = pow(clamp(sm / maxI, 0.0, 1.0), 0.45) * 0.78; d = fract(sm * 0.05);
  }
  gl_FragColor = vec4(h, d, inside ? 1.0 : 0.0, 1.0);
}`;
// the landscape: a ray through each chunky pixel walks the height map; flat-topped columns, tops lighter than sides.
// PUMP (beat or the VJ's tap) shoots the outside spikes up and moves the inside only a little.
const R_FS = `uniform sampler2D hT; uniform vec3 ro, cx, cy, cz; uniform float HS, pal, pump, cyc, flash; uniform vec2 res; varying vec2 vUv;
vec3 band(vec3 a, vec3 b, float h, float n) { float q = floor(h * n) / n; return mix(a, b, q); }
vec3 hsv(float h, float s, float v) { vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }
vec3 colG(float h, float d) {
  if (h < 0.02) return vec3(0.0, 0.78, 0.0);
  if (h < 0.30) return band(vec3(0.0, 0.62, 0.0), vec3(0.0, 0.30, 0.02), h / 0.30, 6.0);
  if (h < 0.55) return band(vec3(0.42, 0.22, 0.12), vec3(0.78, 0.48, 0.32), (h - 0.30) / 0.25, 5.0);
  return band(vec3(0.36, 0.33, 0.40), vec3(0.60, 0.52, 0.66), fract((h - 0.55) * 4.0 + d * 0.5), 5.0);
}
vec3 colI(float h, float d) {
  if (h < 0.10) return band(vec3(0.20, 0.20, 0.55), vec3(0.20, 0.45, 0.70), h / 0.10, 4.0);
  if (h < 0.14) return vec3(0.88, 0.76, 0.30);
  if (h < 0.50) return band(vec3(0.08, 0.50, 0.12), vec3(0.03, 0.30, 0.06), (h - 0.14) / 0.36, 6.0);
  return band(vec3(0.42, 0.40, 0.18), vec3(0.85, 0.85, 0.80), fract((h - 0.5) * 3.0 + d * 0.4), 4.0);   // rock to snow
}
vec3 colL(float h, float d) {   // LAVA
  float q = floor(fract(h * 1.4 + d * 0.25 + cyc) * 8.0) / 8.0;
  return h < 0.03 ? vec3(0.05, 0.0, 0.0) : mix(mix(vec3(0.15, 0.0, 0.02), vec3(0.85, 0.12, 0.02), smoothstep(0.0, 0.5, q)), vec3(1.0, 0.85, 0.25), smoothstep(0.5, 1.0, q));
}
vec3 colC(float h, float d) {   // ICE
  float q = floor(fract(h * 1.2 + d * 0.3 + cyc) * 7.0) / 7.0;
  return h < 0.03 ? vec3(0.02, 0.04, 0.12) : mix(vec3(0.05, 0.15, 0.45), vec3(0.85, 0.97, 1.0), q);
}
vec3 colP(float h, float d) {   // COPPER: Amiga copper-bar rainbow, CYCLE rolls it
  return h < 0.03 ? vec3(0.0, 0.0, 0.08) : hsv(floor(fract(h * 2.5 + d * 0.3 + cyc) * 16.0) / 16.0, 0.85, 1.0);
}
vec3 colN(float h, float d) {   // NEON
  float q = fract(h * 3.0 + d * 0.5 + cyc), s = step(0.86, fract(h * 12.0 + cyc * 3.0));
  return h < 0.03 ? vec3(0.03, 0.0, 0.06) : mix(mix(vec3(0.10, 0.0, 0.18), vec3(0.9, 0.1, 0.8), q), vec3(0.2, 1.0, 1.0), s);
}
vec3 pick(float h, float d) {
  if (pal < 0.5) return colG(h, d); if (pal < 1.5) return colI(h, d); if (pal < 2.5) return colL(h, d);
  if (pal < 3.5) return colC(h, d); if (pal < 4.5) return colP(h, d); return colN(h, d);
}
vec3 T(vec2 p) { if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) return vec3(0.0); return texture2D(hT, p).rgb; }
float lift(vec3 t) { return min(t.r * (1.0 + pump * mix(smoothstep(0.15, 0.7, t.r) * 0.9, 0.12, t.b)), 1.1); }   // capped: a kick never lifts a spike into the camera   // spikes jump, the inside breathes
void main() {
  vec2 sp = (vUv * 2.0 - 1.0) * vec2(res.x / res.y, 1.0);
  vec3 rd = normalize(cx * sp.x + cy * sp.y + cz * 1.7);
  vec3 col = vec3(0.0); float t = 0.01; vec2 pxz = ro.xz;
  for (int i = 0; i < 260; i++) {
    vec3 q = ro + rd * t; vec3 tx = T(q.xz); float h = lift(tx) * HS;
    if (q.y <= h) {
      bool side = lift(T(pxz)) * HS < h - 0.0004;
      col = pick(tx.r, tx.g) * (side ? 0.62 : 1.0) * (1.0 - smoothstep(1.6, 3.0, t) * 0.4) * (1.0 + flash * 0.35); break;
    }
    pxz = q.xz; t += 0.002 + t * 0.012; if (t > 3.2) break;
  }
  gl_FragColor = vec4(min(col, 1.0), 1.0);
}`;
const FRACTALS = {   // #508 per formula: start centre and span, zoom targets
  mandel: { t: 0, c: [-0.6, 0], span: 3.2, tg: [[-0.7453, 0.1127], [-0.1011, 0.9563], [-1.25, 0.02], [0.285, 0.01], [-0.77, -0.09]] },
  julia: { t: 1, c: [0, 0], span: 3.0, tg: [[0, 0], [0.3, 0.2], [-0.4, 0.1]] },
  ship: { t: 2, c: [-0.45, -0.5], span: 3.4, tg: [[-1.762, -0.028], [-1.6, -0.0], [-0.53, -0.62]] },
  multi: { t: 3, c: [0, 0], span: 2.8, tg: [[0.38, 0.0], [-0.19, 0.33], [-0.19, -0.33]] },
};
const PALS = ['green', 'island', 'lava', 'ice', 'copper', 'neon'];
const SOURCES = ['quest', 'fractal', 'webcam', 'led', 'comic', 'black'];   // #516 comic = DirroComics page

export function makeDesk({ THREE, renderer, fixed, led, getLink, getQuestAudio }) {
  const D = { a: 'quest', b: 'fractal', x: 0, fadeTo: null, fadeMs: 2000, fr: { type: 'mandel', pal: 'green', speed: 1, height: 1, react: 0, beat: 0.8, cycle: 0.3, zoom: 1 }, kick: 0, audio: 'quest', lineDev: '', lineErr: '', sine: true, ch: '', chat: 'off' };
  try { Object.assign(D.fr, JSON.parse(localStorage.getItem('vire.vjFr') || '{}')); } catch {}
  const queue = []; let qid = 1;
  const quad = mat => { const sc = new THREE.Scene(), m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false; sc.add(m); return sc; };
  const oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const NEAR = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false };
  const hRT = new THREE.WebGLRenderTarget(512, 512, { ...NEAR, type: THREE.HalfFloatType }), fRT = new THREE.WebGLRenderTarget(320, 256, NEAR);
  const hMat = new THREE.ShaderMaterial({ uniforms: { c0: { value: new THREE.Vector2(-0.6, 0) }, jc: { value: new THREE.Vector2(-0.8, 0.156) }, span: { value: 3.2 }, maxI: { value: 96 }, ftype: { value: 0 } }, vertexShader: VS, fragmentShader: H_FS, depthTest: false, depthWrite: false }), hSc = quad(hMat);
  const rU = { hT: { value: hRT.texture }, ro: { value: new THREE.Vector3() }, cx: { value: new THREE.Vector3() }, cy: { value: new THREE.Vector3() }, cz: { value: new THREE.Vector3() }, HS: { value: 0.25 }, pal: { value: 0 }, pump: { value: 0 }, cyc: { value: 0 }, flash: { value: 0 }, res: { value: new THREE.Vector2(320, 256) } };
  const rMat = new THREE.ShaderMaterial({ uniforms: rU, vertexShader: VS, fragmentShader: R_FS, depthTest: false, depthWrite: false }), rSc = quad(rMat);
  const camTex = new THREE.VideoTexture(fixed.video); camTex.colorSpace = THREE.NoColorSpace; camTex.generateMipmaps = false;
  const ledTex = led.video ? new THREE.VideoTexture(led.video) : null; if (ledTex) { ledTex.colorSpace = THREE.NoColorSpace; ledTex.generateMipmaps = false; }
  const mU = { tA: { value: null }, tB: { value: null }, fA: { value: new THREE.Vector4(0, 0, 1, 1) }, fB: { value: new THREE.Vector4(0, 0, 1, 1) }, kA: { value: 0 }, kB: { value: 0 }, x: { value: 0 } };
  const mMat = new THREE.ShaderMaterial({ uniforms: mU, vertexShader: VS, fragmentShader: MIX_FS, depthTest: false, depthWrite: false }), mSc = quad(mMat);
  const comics = makeComics({ THREE, renderer, fixed, send: m => bc.postMessage(m), onChange: () => post(),   // #516
    requestRgbd: still => { const L = getLink(); if (!L || !L.isOpen) return 'no Quest link (connect DirroVJ to the Quest first)'; L.send('ctl', { k: 'cxgrab', still: !!still, ms: 5000 }); return ''; } });   // #520
  let comicTex = null;

  // ---- fractal flight: zoom in toward a target and out again (ping-pong), orbit round it; REACT lifts the heights on the bass
  const F = { z: 0, dir: 1, a: 0, ti: 0, j: 0, type: '', c: new THREE.Vector2(-0.6, 0) };
  let an = null, anBuf = null, anTrack = null, bass = 0, avg = 0, kickT = 0, pulse = 0, cyc = 0;
  // #508 kicks: bass energy jumping well over its running average (no BPM, no lock: each kick is heard, then the peaks fall back)
  function analyse(dt, now) {
    const tr = getQuestAudio && getQuestAudio();
    if (tr !== anTrack) { anTrack = tr; an = null; if (tr && tr.readyState === 'live') { try { const ac = analyse.ac || (analyse.ac = new AudioContext()); const s = ac.createMediaStreamSource(new MediaStream([tr])); an = ac.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0.1; s.connect(an); anBuf = new Uint8Array(an.frequencyBinCount); } catch { an = null; } } }
    if (an) {
      if (analyse.ac && analyse.ac.state === 'suspended') analyse.ac.resume().catch(() => {});
      an.getByteFrequencyData(anBuf); let s = 0; for (let i = 1; i < 6; i++) s += anBuf[i]; const v = s / (5 * 255);
      bass = v > bass ? v : bass * 0.88; avg += (v - avg) * Math.min(1, dt * 1.5);
      if (v > 0.22 && v > avg * 1.32 && now - kickT > 230) { kickT = now; pulse = 1; D.kick++; if (peers) post(); }
    } else bass *= 0.9;
    pulse *= Math.exp(-dt * 5.5);
  }
  function fractal(dt, now) {
    const fr = D.fr, FD = FRACTALS[fr.type] || FRACTALS.mandel; analyse(dt, now);
    if (F.type !== fr.type) { F.type = fr.type; F.z = 0; F.dir = 1; F.ti = 0; }
    F.z += F.dir * dt * 0.06 * fr.speed * fr.zoom; const zmax = FD.t === 1 ? 2.5 : 6.5;
    if (F.z > zmax) { F.z = zmax; F.dir = -1; } if (F.z < 0) { F.z = 0; F.dir = 1; F.ti = (F.ti + 1) % FD.tg.length; }
    const tg = FD.tg[F.ti % FD.tg.length], k = Math.min(1, F.z / 2.5); F.c.set(FD.c[0] + (tg[0] - FD.c[0]) * k, FD.c[1] + (tg[1] - FD.c[1]) * k);
    F.j += dt * 0.07 * fr.speed; hMat.uniforms.jc.value.set(0.7885 * Math.cos(F.j), 0.7885 * Math.sin(F.j));   // Julia: c runs round a circle, the landscape morphs
    hMat.uniforms.c0.value.copy(F.c); hMat.uniforms.span.value = FD.span * Math.exp(-F.z); hMat.uniforms.maxI.value = Math.min(380, 80 + F.z * 40); hMat.uniforms.ftype.value = FD.t;
    F.a += dt * 0.12 * fr.speed; cyc = (cyc + dt * fr.cycle * 0.25) % 1;
    const R = 0.62, ro = rU.ro.value.set(0.5 + Math.sin(F.a) * R, 0.42, 0.5 + Math.cos(F.a) * R), tgt = new THREE.Vector3(0.5, 0.02, 0.5);
    const cz = tgt.clone().sub(ro).normalize(), cx = new THREE.Vector3().crossVectors(cz, new THREE.Vector3(0, 1, 0)).normalize(), cy = new THREE.Vector3().crossVectors(cx, cz);
    rU.cx.value.copy(cx); rU.cy.value.copy(cy); rU.cz.value.copy(cz);
    rU.HS.value = 0.22 * fr.height * (1 + fr.react * bass * 0.9); rU.pal.value = Math.max(0, PALS.indexOf(fr.pal));
    rU.pump.value = pulse * fr.beat; rU.flash.value = pulse * fr.beat * 0.6; rU.cyc.value = cyc;
    renderer.setRenderTarget(hRT); renderer.render(hSc, oc);
    renderer.setRenderTarget(fRT); renderer.render(rSc, oc);
  }
  function cover(tw, th, W, H, out) { if (!tw || !th) return out.set(0, 0, 1, 1); const k = Math.max(W / tw, H / th), w = W / (tw * k), h = H / (th * k); return out.set((1 - w) / 2, (1 - h) / 2, w, h); }
  function bind(name, U, fit, W, H, questTex) {   // a bus's texture and its cover crop
    if (name === 'quest') { U.value = questTex; fit.set(0, 0, 1, 1); return 1; }
    if (name === 'fractal') { U.value = fRT.texture; cover(320, 256, W, H, fit); return 1; }
    if (name === 'comic') { if (!comicTex) return 0; U.value = comicTex; cover(1920, 1080, W, H, fit); return 1; }   // #516
    if (name === 'webcam') { const v = fixed.video; if (!fixed.on || !v.videoWidth) return 0; U.value = camTex; cover(v.videoWidth, v.videoHeight, W, H, fit); return 1; }
    if (name === 'led') { const v = led.video; if (!ledTex || !led.on || !v || !v.videoWidth) return 0; U.value = ledTex; cover(v.videoWidth, v.videoHeight, W, H, fit); return 1; }
    return 0;
  }
  // ---- the program picture: called by studio.js with its composite, draws to the screen
  let lastT = 0, pvT = 0; const pv = document.createElement('canvas'); pv.width = 256; pv.height = 144;
  let outT = 0;   // #519 last program frame: the desk says when DirroVJ is waiting for the Quest
  function output(questTex, now, W, H) {
    outT = now;
    const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
    if (D.fadeTo != null) { const step = dt * 1000 / Math.max(50, D.fadeMs); D.x += Math.sign(D.fadeTo - D.x) * step; if (Math.abs(D.fadeTo - D.x) <= step) { D.x = D.fadeTo; D.fadeTo = null; post(); } }
    const used = (D.x < 1 ? [D.a] : []).concat(D.x > 0 ? [D.b] : []);
    if (used.includes('fractal')) fractal(dt, now);
    comics.tick(questTex, now, dt); comicTex = used.includes('comic') ? comics.render(W, H) : null;   // #516
    mU.kA.value = bind(D.a, mU.tA, mU.fA.value, W, H, questTex); mU.kB.value = bind(D.b, mU.tB, mU.fB.value, W, H, questTex); mU.x.value = D.x;
    renderer.setRenderTarget(null); renderer.render(mSc, oc);
    if (peers && now - pvT > 250) { pvT = now; try { pv.getContext('2d').drawImage(renderer.domElement, 0, 0, 256, 144); bc.postMessage({ k: 'pv', img: pv.toDataURL('image/jpeg', 0.6) }); } catch {} }
  }
  // ---- scroller desk
  function enqueue(src, who, t, id) {
    t = String(t || '').replace(/\s+/g, ' ').trim().slice(0, 140); if (!t) return;
    if (id && queue.some(q => q.ext === id)) return;
    queue.unshift({ id: qid++, ext: id || null, src, who: who || '', t, at: Date.now() }); if (queue.length > 80) queue.length = 80; post();
  }
  const chat = new TwitchChat(what => {
    D.chat = chat.status;
    if (what !== 'status') { const m = chat.msgs[chat.msgs.length - 1]; if (m && !m.sys && m !== chat._last) { chat._last = m; enqueue('chat', m.name || '', (m.toks || []).map(k => k.t).join('')); } }
    post();
  });
  function onStu(m) { if (m.ch && m.ch !== D.ch) { D.ch = m.ch; chat.stop(); chat.start(m.ch); post(); } }
  function onVjSms(m) { for (const [id, t] of m.items || []) enqueue('sms', 'HoloSMS', t, 'sms:' + id); }
  function approve(id, t) {
    const q = id != null ? queue.find(x => x.id === id) : null, text = q ? q.t : t; if (!text) return;
    const L = getLink(); if (L && L.isOpen) L.send('ctl', { k: 'vjsine', t: text });
    if (q) { q.sent = Date.now(); queue.splice(queue.indexOf(q), 1); queue.push(q); }
    post();
  }
  // ---- LINE IN
  let lineTrack = null;
  async function setAudio(src, dev) {
    D.audio = src; D.lineDev = dev || D.lineDev; D.lineErr = '';
    if (lineTrack) { lineTrack.stop(); lineTrack = null; }
    if (src === 'line') {
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: D.lineDev ? { exact: D.lineDev } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } }); lineTrack = s.getAudioTracks()[0]; }
      catch (e) { D.lineErr = e.message; D.audio = 'quest'; }
    }
    onAudio && onAudio(); post();
  }
  let onAudio = null;
  let devCache = null, devT = 0;   // #518 the input list is asked for at most every 5 s (it was every state post)
  async function devices() { const now = performance.now(); if (devCache && now - devT < 5000) return devCache; devT = now; try { devCache = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput').map(d => [d.deviceId, d.label || 'Input']); } catch { devCache = []; } return devCache; }
  // ---- the control window
  const bc = new BroadcastChannel('dirrovj'); let peers = 0, postT = 0;
  async function post() {
    const now = performance.now(); if (now - postT < 60) { clearTimeout(post.t); post.t = setTimeout(post, 70); return; } postT = now;
    bc.postMessage({ k: 'state', D: { ...D, fr: { ...D.fr } }, queue, devs: await devices(), sources: SOURCES, C: comics.state(), live: performance.now() - outT < 1500 });
  }
  bc.onmessage = e => {
    const m = e.data || {}; peers = 1;
    if (m.k === 'hello') { post(); if (!m.again) comics.sendList(); }
    else if (m.k === 'cx') comics.onMsg(m);   // #516 DirroComics
    else if (m.k === 'bus') { if (SOURCES.includes(m.v)) D[m.bus === 'b' ? 'b' : 'a'] = m.v; post(); }
    else if (m.k === 'x') { D.x = Math.max(0, Math.min(1, +m.v)); D.fadeTo = null; post(); }
    else if (m.k === 'cut') { D.x = D.x < 0.5 ? 1 : 0; D.fadeTo = null; post(); }
    else if (m.k === 'auto') { D.fadeMs = +m.ms || D.fadeMs; D.fadeTo = D.x < 0.5 ? 1 : 0; post(); }
    else if (m.k === 'fr') { Object.assign(D.fr, m.v || {}); try { localStorage.setItem('vire.vjFr', JSON.stringify(D.fr)); } catch {} post(); }
    else if (m.k === 'pump') { pulse = 1; D.kick++; }   // #508 the VJ's own hit
    else if (m.k === 'approve') approve(m.id);
    else if (m.k === 'reject') { const i = queue.findIndex(x => x.id === m.id); if (i >= 0) queue.splice(i, 1); post(); }
    else if (m.k === 'say') approve(null, String(m.t || '').slice(0, 120));
    else if (m.k === 'audio') setAudio(m.v, m.dev);
  };
  setInterval(() => { if (peers) post(); }, 1500);
  // #519 the Quest hasn't turned DirroVJ on (no program frames): keep DirroComics editing alive (desk preview, grabs, AUTO).
  // tick() draws only into its own render targets, never to the screen, so it doesn't fight the camera page's own drawing.
  let idleT = 0; setInterval(() => { const now = performance.now(); if (now - outT < 1000 || !peers) return; const dt = idleT ? Math.min(0.25, (now - idleT) / 1000) : 0.12; idleT = now; try { comics.tick(null, now, dt); } catch (e) { console.warn('comics idle', e); } }, 120);
  return { D, output, onStu, onVjSms, set onAudio(f) { onAudio = f; }, audioTrack: () => (D.audio === 'line' && lineTrack && lineTrack.readyState === 'live' ? lineTrack : null), queue, comics, onCx: m => { if (m.blob) comics.onMsg({ k: 'cx', op: 'add', files: [{ blob: m.blob, name: m.name || 'quest-rgbd' }] }); else if (m.t) bc.postMessage({ k: 'cxmsg', t: 'Quest: ' + m.t }); }, _F: F };   // #520 GRAB RGB-D replies
}
