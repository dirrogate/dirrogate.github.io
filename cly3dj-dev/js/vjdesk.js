// #507 DirroVJ desk, output side (CLAUDE.md #507, project doc dirrovj-plan.md phase 3). Runs inside the DirroVJ page (studio.js, vj).
// The studio's composite (the Quest's picture + backdrop + overlays) becomes one source among several. Two buses A / B and a crossfader
// make the program picture on the screen (HDMI) and on Twitch. Sources: QUEST, FRACTAL (Amiga-style Mandelbrot landscape), WEBCAM,
// LED CLIP, BLACK. The control window (vjdesk.html) talks to this page over a BroadcastChannel; it gets the state, the queue and a small
// program preview, and sends commands back. Scroller desk: Twitch chat (read here, anonymous) + HoloSMS (forwarded by the Quest) in one
// queue; APPROVE sends the line to the Quest's own sine scroller ('vjsine'), which the Quest accepts only from a DirroVJ the DJ allowed.
// LINE IN: an audio input on this laptop replaces the Quest's sound for Twitch. No beat sync anywhere: the VJ fades and rides by hand.
import { TwitchChat } from './chat.js';

const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const MIX_FS = `uniform sampler2D tA, tB; uniform vec4 fA, fB; uniform float kA, kB, x; varying vec2 vUv;
vec3 src(sampler2D t, vec4 f, float k) { if (k < 0.5) return vec3(0.0); return texture2D(t, f.xy + vUv * f.zw).rgb; }
void main() { gl_FragColor = vec4(mix(src(tA, fA, kA), src(tB, fB, kB), x), 1.0); }`;
// heights: smooth escape count of the Mandelbrot set; the set itself is the plateau, the spikes stand along its edge
const H_FS = `uniform vec2 c0; uniform float span, maxI; varying vec2 vUv;
void main() {
  vec2 c = c0 + (vUv - 0.5) * span, z = vec2(0.0); float n = 0.0; bool inside = true;
  for (int i = 0; i < 400; i++) { if (float(i) >= maxI) break; z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c; if (dot(z, z) > 64.0) { inside = false; break; } n += 1.0; }
  float h = 0.62;
  if (!inside) { float sm = n + 1.0 - log2(log2(max(dot(z, z), 1.0001)) * 0.5); h = pow(clamp(sm / maxI, 0.0, 1.0), 0.45) * 0.78; }
  gl_FragColor = vec4(h, 0.0, 0.0, 1.0);
}`;
// the landscape: a ray through each chunky pixel walks the height map; columns are flat-topped (nearest texel), tops lighter than sides
const R_FS = `uniform sampler2D hT; uniform vec3 ro, cx, cy, cz; uniform float HS, pal; uniform vec2 res; varying vec2 vUv;
vec3 band(vec3 a, vec3 b, float h, float n) { float q = floor(h * n) / n; return mix(a, b, q); }
vec3 colG(float h) {   // GREEN: bright plain, darker green contours, brown slopes, grey-mauve heights
  if (h < 0.02) return vec3(0.0, 0.78, 0.0);
  if (h < 0.30) return band(vec3(0.0, 0.62, 0.0), vec3(0.0, 0.30, 0.02), h / 0.30, 6.0);
  if (h < 0.55) return band(vec3(0.42, 0.22, 0.12), vec3(0.78, 0.48, 0.32), (h - 0.30) / 0.25, 5.0);
  return band(vec3(0.36, 0.33, 0.40), vec3(0.47, 0.42, 0.50), (h - 0.55) / 0.25, 4.0);
}
vec3 colI(float h) {   // ISLAND: sea in bands, sand, green woods, dark olive top
  if (h < 0.10) return band(vec3(0.20, 0.20, 0.55), vec3(0.20, 0.45, 0.70), h / 0.10, 4.0);
  if (h < 0.14) return vec3(0.88, 0.76, 0.30);
  if (h < 0.55) return band(vec3(0.08, 0.50, 0.12), vec3(0.03, 0.30, 0.06), (h - 0.14) / 0.41, 6.0);
  return band(vec3(0.30, 0.28, 0.12), vec3(0.22, 0.20, 0.08), (h - 0.55) / 0.25, 3.0);
}
float H(vec2 p) { if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) return 0.0; return texture2D(hT, p).r; }
void main() {
  vec2 sp = (vUv * 2.0 - 1.0) * vec2(res.x / res.y, 1.0);
  vec3 rd = normalize(cx * sp.x + cy * sp.y + cz * 1.7);
  vec3 col = vec3(0.0); float t = 0.01; vec2 pxz = ro.xz; bool hit = false;
  for (int i = 0; i < 260; i++) {
    vec3 q = ro + rd * t; float h = H(q.xz) * HS;
    if (q.y <= h) {
      float hn = h / HS; vec3 c = pal < 0.5 ? colG(hn) : colI(hn);
      bool side = H(pxz) * HS < h - 0.0004;           // the column before this one was lower: the ray went into this column's side (darker), else onto its top
      col = c * (side ? 0.62 : 1.0) * (1.0 - smoothstep(1.6, 3.0, t) * 0.4); hit = true; break;
    }
    pxz = q.xz; t += 0.002 + t * 0.012; if (t > 3.2) break;
  }
  if (!hit) col = pal < 0.5 ? vec3(0.0) : vec3(0.0);
  gl_FragColor = vec4(col, 1.0);
}`;
const TARGETS = [[-0.7453, 0.1127], [-0.1011, 0.9563], [-1.2500, 0.0200], [0.2850, 0.0100], [-0.7700, -0.0900]];
const SOURCES = ['quest', 'fractal', 'webcam', 'led', 'black'];

export function makeDesk({ THREE, renderer, fixed, led, getLink, getQuestAudio }) {
  const D = { a: 'quest', b: 'fractal', x: 0, fadeTo: null, fadeMs: 2000, fr: { pal: 'green', speed: 1, height: 1, react: 0, zoom: 1 }, audio: 'quest', lineDev: '', lineErr: '', sine: true, ch: '', chat: 'off' };
  try { Object.assign(D.fr, JSON.parse(localStorage.getItem('vire.vjFr') || '{}')); } catch {}
  const queue = []; let qid = 1;
  const quad = mat => { const sc = new THREE.Scene(), m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false; sc.add(m); return sc; };
  const oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const NEAR = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false };
  const hRT = new THREE.WebGLRenderTarget(512, 512, NEAR), fRT = new THREE.WebGLRenderTarget(320, 256, NEAR);
  const hMat = new THREE.ShaderMaterial({ uniforms: { c0: { value: new THREE.Vector2(-0.6, 0) }, span: { value: 3.2 }, maxI: { value: 96 } }, vertexShader: VS, fragmentShader: H_FS, depthTest: false, depthWrite: false }), hSc = quad(hMat);
  const rU = { hT: { value: hRT.texture }, ro: { value: new THREE.Vector3() }, cx: { value: new THREE.Vector3() }, cy: { value: new THREE.Vector3() }, cz: { value: new THREE.Vector3() }, HS: { value: 0.25 }, pal: { value: 0 }, res: { value: new THREE.Vector2(320, 256) } };
  const rMat = new THREE.ShaderMaterial({ uniforms: rU, vertexShader: VS, fragmentShader: R_FS, depthTest: false, depthWrite: false }), rSc = quad(rMat);
  const camTex = new THREE.VideoTexture(fixed.video); camTex.colorSpace = THREE.NoColorSpace; camTex.generateMipmaps = false;
  const ledTex = led.video ? new THREE.VideoTexture(led.video) : null; if (ledTex) { ledTex.colorSpace = THREE.NoColorSpace; ledTex.generateMipmaps = false; }
  const mU = { tA: { value: null }, tB: { value: null }, fA: { value: new THREE.Vector4(0, 0, 1, 1) }, fB: { value: new THREE.Vector4(0, 0, 1, 1) }, kA: { value: 0 }, kB: { value: 0 }, x: { value: 0 } };
  const mMat = new THREE.ShaderMaterial({ uniforms: mU, vertexShader: VS, fragmentShader: MIX_FS, depthTest: false, depthWrite: false }), mSc = quad(mMat);

  // ---- fractal flight: zoom in toward a target and out again (ping-pong), orbit round it; REACT lifts the heights on the bass
  const F = { z: 0, dir: 1, a: 0, ti: 0, c: new THREE.Vector2(-0.6, 0) };
  let an = null, anBuf = null, anTrack = null, bass = 0;
  function analyse() {
    const tr = getQuestAudio && getQuestAudio();
    if (tr !== anTrack) { anTrack = tr; an = null; if (tr && tr.readyState === 'live') { try { const ac = analyse.ac || (analyse.ac = new AudioContext()); const s = ac.createMediaStreamSource(new MediaStream([tr])); an = ac.createAnalyser(); an.fftSize = 512; s.connect(an); anBuf = new Uint8Array(an.frequencyBinCount); } catch { an = null; } } }
    if (!an) { bass *= 0.9; return; }
    if (analyse.ac && analyse.ac.state === 'suspended') analyse.ac.resume().catch(() => {});
    an.getByteFrequencyData(anBuf); let s = 0; for (let i = 1; i < 8; i++) s += anBuf[i]; const v = s / (7 * 255);
    bass = v > bass ? v : bass * 0.88;
  }
  function fractal(dt) {
    const fr = D.fr; analyse();
    F.z += F.dir * dt * 0.06 * fr.speed * fr.zoom; if (F.z > 7) { F.z = 7; F.dir = -1; } if (F.z < 0) { F.z = 0; F.dir = 1; F.ti = (F.ti + 1) % TARGETS.length; }
    const tg = TARGETS[F.ti], k = Math.min(1, F.z / 2.5); F.c.set(-0.6 + (tg[0] + 0.6) * k, tg[1] * k);
    hMat.uniforms.c0.value.copy(F.c); hMat.uniforms.span.value = 3.2 * Math.exp(-F.z); hMat.uniforms.maxI.value = Math.min(380, 80 + F.z * 40);
    F.a += dt * 0.12 * fr.speed;
    const R = 0.62, ro = rU.ro.value.set(0.5 + Math.sin(F.a) * R, 0.42, 0.5 + Math.cos(F.a) * R), tgt = new THREE.Vector3(0.5, 0.02, 0.5);
    const cz = tgt.clone().sub(ro).normalize(), cx = new THREE.Vector3().crossVectors(cz, new THREE.Vector3(0, 1, 0)).normalize(), cy = new THREE.Vector3().crossVectors(cx, cz);
    rU.cx.value.copy(cx); rU.cy.value.copy(cy); rU.cz.value.copy(cz);
    rU.HS.value = 0.22 * fr.height * (1 + fr.react * bass * 0.9); rU.pal.value = fr.pal === 'island' ? 1 : 0;
    renderer.setRenderTarget(hRT); renderer.render(hSc, oc);
    renderer.setRenderTarget(fRT); renderer.render(rSc, oc);
  }
  function cover(tw, th, W, H, out) { if (!tw || !th) return out.set(0, 0, 1, 1); const k = Math.max(W / tw, H / th), w = W / (tw * k), h = H / (th * k); return out.set((1 - w) / 2, (1 - h) / 2, w, h); }
  function bind(name, U, fit, W, H, questTex) {   // a bus's texture and its cover crop
    if (name === 'quest') { U.value = questTex; fit.set(0, 0, 1, 1); return 1; }
    if (name === 'fractal') { U.value = fRT.texture; cover(320, 256, W, H, fit); return 1; }
    if (name === 'webcam') { const v = fixed.video; if (!fixed.on || !v.videoWidth) return 0; U.value = camTex; cover(v.videoWidth, v.videoHeight, W, H, fit); return 1; }
    if (name === 'led') { const v = led.video; if (!ledTex || !led.on || !v || !v.videoWidth) return 0; U.value = ledTex; cover(v.videoWidth, v.videoHeight, W, H, fit); return 1; }
    return 0;
  }
  // ---- the program picture: called by studio.js with its composite, draws to the screen
  let lastT = 0, pvT = 0; const pv = document.createElement('canvas'); pv.width = 256; pv.height = 144;
  function output(questTex, now, W, H) {
    const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
    if (D.fadeTo != null) { const step = dt * 1000 / Math.max(50, D.fadeMs); D.x += Math.sign(D.fadeTo - D.x) * step; if (Math.abs(D.fadeTo - D.x) <= step) { D.x = D.fadeTo; D.fadeTo = null; post(); } }
    const used = (D.x < 1 ? [D.a] : []).concat(D.x > 0 ? [D.b] : []);
    if (used.includes('fractal')) fractal(dt);
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
  async function devices() { try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput').map(d => [d.deviceId, d.label || 'Input']); } catch { return []; } }
  // ---- the control window
  const bc = new BroadcastChannel('dirrovj'); let peers = 0, postT = 0;
  async function post() {
    const now = performance.now(); if (now - postT < 60) { clearTimeout(post.t); post.t = setTimeout(post, 70); return; } postT = now;
    bc.postMessage({ k: 'state', D: { ...D, fr: { ...D.fr } }, queue, devs: await devices(), sources: SOURCES });
  }
  bc.onmessage = e => {
    const m = e.data || {}; peers = 1;
    if (m.k === 'hello') post();
    else if (m.k === 'bus') { if (SOURCES.includes(m.v)) D[m.bus === 'b' ? 'b' : 'a'] = m.v; post(); }
    else if (m.k === 'x') { D.x = Math.max(0, Math.min(1, +m.v)); D.fadeTo = null; post(); }
    else if (m.k === 'cut') { D.x = D.x < 0.5 ? 1 : 0; D.fadeTo = null; post(); }
    else if (m.k === 'auto') { D.fadeMs = +m.ms || D.fadeMs; D.fadeTo = D.x < 0.5 ? 1 : 0; post(); }
    else if (m.k === 'fr') { Object.assign(D.fr, m.v || {}); try { localStorage.setItem('vire.vjFr', JSON.stringify(D.fr)); } catch {} post(); }
    else if (m.k === 'approve') approve(m.id);
    else if (m.k === 'reject') { const i = queue.findIndex(x => x.id === m.id); if (i >= 0) queue.splice(i, 1); post(); }
    else if (m.k === 'say') approve(null, String(m.t || '').slice(0, 120));
    else if (m.k === 'audio') setAudio(m.v, m.dev);
  };
  setInterval(() => { if (peers) post(); }, 1500);
  return { D, output, onStu, onVjSms, set onAudio(f) { onAudio = f; }, audioTrack: () => (D.audio === 'line' && lineTrack && lineTrack.readyState === 'live' ? lineTrack : null), queue, _F: F };
}
