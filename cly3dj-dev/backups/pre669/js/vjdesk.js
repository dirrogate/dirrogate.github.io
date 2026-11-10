// #507 DirroVJ desk, output side (CLAUDE.md #507, project doc dirrovj-plan.md phase 3). Runs inside the DirroVJ page (studio.js, vj).
// The studio's composite (the Quest's picture + backdrop + overlays) becomes one source among several. Two buses A / B and a crossfader
// make the program picture on the screen (HDMI) and on Twitch. Sources: QUEST, FRACTAL (Amiga-style Mandelbrot landscape), WEBCAM,
// LED CLIP, BLACK. The control window (vjdesk.html) talks to this page over a BroadcastChannel; it gets the state, the queue and a small
// program preview, and sends commands back. Scroller desk: Twitch chat (read here, anonymous) + HoloSMS (forwarded by the Quest) in one
// queue; APPROVE sends the line to the Quest's own sine scroller ('vjsine'), which the Quest accepts only from a DirroVJ the DJ allowed.
// LINE IN: an audio input on this laptop replaces the Quest's sound for Twitch. No beat sync anywhere: the VJ fades and rides by hand.
import { TwitchChat } from './chat.js';
import { makeComics } from './comics.js';   // #516 DirroComics
import * as media from './medialib.js';   // #532 IMAGES / VIDEOS / PANOS clip decks
import { holoDefaults, makeHoloDesk } from './holodesk.js';   // #573 HOLO: Holodancer performers (small modules; the atlas video loads on first use)
import { Scroller } from './tools.js';
import { makeDirroverse } from './dirroverse.js';   // #662 DIRROVERSE: Cyber-Window sets (the studio on this laptop) on the buses   // #556 the same bitmap sine scroller as the Quest's, for the program when there is no Quest
// #550 DANCER: js/dancerdesk.js is imported only when the desk first needs her (its loaders, post chain and the 5 MB GLB stay out of the start)
function dzDefaults() {
  const S = { loaded: false, loading: false, err: '', clip: '', clips: [], stage: 'rim', outfit: 'Red', speed: 1, soft: { c1: '#35d6ff', c2: '#ffa24a', rim: 1, face: 1 }, props: { manhole: false, pumpkin: false, fog: false }, fog: { den: 0.5, h: 0.8, speed: 0.6, col: 'cold' }, cam: { mode: 'orbit', x: 0, y: 8, zoom: 1 }, pv: false, rec: { on: false, t: 0, msg: '' } };
  try { const o = JSON.parse(localStorage.getItem('vire.dancer') || '{}'); for (const k of ['clip', 'stage', 'outfit']) if (typeof o[k] === 'string') S[k] = o[k]; if (+o.speed > 0) S.speed = Math.max(0.25, Math.min(2, +o.speed)); if (o.soft && typeof o.soft === 'object') Object.assign(S.soft, o.soft); for (const k of ['props', 'fog', 'cam']) if (o[k] && typeof o[k] === 'object') Object.assign(S[k], o[k]); } catch {}
  S.props.manhole = S.props.pumpkin = false;   // #558 the PROPS row is gone (props stay in dancerdesk.js, switched off)
  return S;
}

const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const MIX_FS = `uniform sampler2D tA, tB; uniform vec4 fA, fB; uniform float kA, kB, x; varying vec2 vUv;
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
vec3 src(sampler2D t, vec4 f, float k) { if (k < 0.5) return vec3(0.0); vec3 c = texture2D(t, f.xy + vUv * f.zw).rgb; return k > 1.5 ? clamp(srgb(c), 0.0, 1.0) : c; }
void main() { gl_FragColor = vec4(mix(src(tA, fA, kA), src(tB, fB, kB), x), 1.0); }`;
// #668 HOLO+CAM: the webcam with the Holodancer stood on a spot in it (feet at F, her height hH of the frame), a soft contact
// shadow under her feet and her colours pulled toward the webcam's light. cut > 0 hides her below a line (a bar front, a rail)
const HC_FS = `uniform sampler2D cam, ho; uniform vec4 cf; uniform vec2 F, foot; uniform vec3 mean; uniform float hoOn, A, k, flip, shadow, light, cut, sEl, hH; varying vec2 vUv;
void main() {
  vec3 c = texture2D(cam, cf.xy + vUv * cf.zw).rgb;
  if (hoOn > 0.5) {
    vec2 dq = vUv - F; dq.x *= A;
    vec2 e = dq / vec2(0.17 * hH, 0.17 * hH * max(0.12, sEl));
    c *= 1.0 - shadow * 0.75 * (1.0 - smoothstep(0.2, 1.0, length(e)));
    vec2 r = foot + vec2((flip > 0.5 ? -1.0 : 1.0) * dq.x / (16.0 / 9.0), dq.y) * k;
    bool hide = cut > 0.0 && 1.0 - vUv.y > cut;
    if (!hide && r.x > 0.0 && r.x < 1.0 && r.y > 0.0 && r.y < 1.0) {
      vec4 h = texture2D(ho, r);
      float L = dot(mean, vec3(0.299, 0.587, 0.114));
      vec3 tint = mean / max(max(mean.r, mean.g), max(mean.b, 0.02));
      vec3 g = mix(vec3(1.0), tint * clamp(0.45 + L * 1.6, 0.45, 1.25), light);
      float a = clamp(h.a, 0.0, 1.0);
      c = c * (1.0 - a) + h.rgb * g;
    }
  }
  gl_FragColor = vec4(c, 1.0);
}`;
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
const SOURCES = ['quest', 'fractal', 'webcam', 'led', 'comic', 'dancer', 'holo', 'dverse', 'cast', 'hocam'];   // #667 cast = the Quest 3 casting window, #668 hocam = Holodancer stood in the webcam   // #573 holo = Holodancer, #662 dverse = DirroVerse
// (was) const SOURCES = ['quest', 'fractal', 'webcam', 'led', 'comic', 'dancer'];   // #516 comic = DirroComics page, #550 dancer = DirroDancer, #555 BLACK removed (owner: never used)

const HP0 = { x: 0.5, y: 0.8, h: 0.4, el: 8, face: 0, flip: false, shadow: 0.55, light: 0.6, cut: 0 };   // #668 x, y = her feet (0..1, from the top left), h = her height (part of the frame)
export function makeDesk({ THREE, renderer, fixed, led, getLink, getQuestAudio, studioCtl }) {
  const D = { a: 'quest', b: 'fractal', x: 0, fadeTo: null, fadeMs: 2000, fr: { type: 'mandel', pal: 'green', speed: 1, height: 1, react: 0, beat: 0.8, cycle: 0.3, zoom: 1 }, kick: 0, audio: 'quest', lineDev: '', lineErr: '', sine: true, ch: '', chat: 'off', media: '', ledKind: 'clip', panoYaw: 0, dz: dzDefaults(), holo: holoDefaults(), chDesk: '', audioAuto: false, lsc: '', cue: '',
    tempo: 'line', bpm: 0, beatN: 0, dv: { set: '', sets: [], files: [], arrivals: [], status: '', studio: '', cam: true, playing: '', job: null, match: 0.7 },
    cast: { on: false, label: '', l: 0, r: 0, t: 0, b: 0 }, hp: { ...HP0 } };   // #667 CAST crop, #668 HOLO+CAM placement   // #662 master tempo (LINE IN / TAP) + DirroVerse   // #557 cue: 'a' | 'b' = the desk monitor shows that bus alone (program unchanged)
  try { D.chDesk = localStorage.getItem('vire.vjChat') || ''; } catch {}   // #556 the desk's own Twitch chat channel (the Quest's wins while linked)
  try { Object.assign(D.fr, JSON.parse(localStorage.getItem('vire.vjFr') || '{}')); } catch {}
  try { const o = JSON.parse(localStorage.getItem('vire.vjCast') || '{}'); for (const k of ['l', 'r', 't', 'b']) if (+o[k] >= 0) D.cast[k] = Math.min(0.45, +o[k]); } catch {}
  try { const o = JSON.parse(localStorage.getItem('vire.vjHp') || '{}'); for (const k of Object.keys(HP0)) if (o[k] != null) D.hp[k] = typeof HP0[k] === 'boolean' ? !!o[k] : +o[k]; } catch {}
  const queue = []; let qid = 1;
  const quad = mat => { const sc = new THREE.Scene(), m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false; sc.add(m); return sc; };
  const oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const NEAR = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false };
  const hRT = new THREE.WebGLRenderTarget(512, 512, { ...NEAR, type: THREE.HalfFloatType }), fRT = new THREE.WebGLRenderTarget(320, 256, NEAR);
  const hMat = new THREE.ShaderMaterial({ uniforms: { c0: { value: new THREE.Vector2(-0.6, 0) }, jc: { value: new THREE.Vector2(-0.8, 0.156) }, span: { value: 3.2 }, maxI: { value: 96 }, ftype: { value: 0 } }, vertexShader: VS, fragmentShader: H_FS, depthTest: false, depthWrite: false }), hSc = quad(hMat);
  const rU = { hT: { value: hRT.texture }, ro: { value: new THREE.Vector3() }, cx: { value: new THREE.Vector3() }, cy: { value: new THREE.Vector3() }, cz: { value: new THREE.Vector3() }, HS: { value: 0.25 }, pal: { value: 0 }, pump: { value: 0 }, cyc: { value: 0 }, flash: { value: 0 }, res: { value: new THREE.Vector2(320, 256) } };
  const rMat = new THREE.ShaderMaterial({ uniforms: rU, vertexShader: VS, fragmentShader: R_FS, depthTest: false, depthWrite: false }), rSc = quad(rMat);
  const camTex = new THREE.VideoTexture(fixed.video); camTex.colorSpace = THREE.NoColorSpace; camTex.generateMipmaps = false;
  let dvx = null; const dvGet = () => dvx || (dvx = makeDirroverse({ THREE, renderer, camTex, camVideo: fixed.video, S: D.dv, post: () => post() }));   // #662
  // #667 CAST: the Quest 3 casting window (Chrome's casting page, picked in the desk window with getDisplayMedia, video only)
  const castV = document.createElement('video'); castV.muted = true; castV.playsInline = true; castV.autoplay = true;
  const castTex = new THREE.VideoTexture(castV); castTex.colorSpace = THREE.NoColorSpace; castTex.generateMipmaps = false;
  function setCast(stream) {
    const old = castV.srcObject; if (old && old !== stream) { try { old.getTracks().forEach(t => t.stop()); } catch {} }
    castV.srcObject = stream || null; D.cast.on = !!stream; D.cast.label = '';
    if (stream) { const tr = stream.getVideoTracks()[0]; if (tr) { D.cast.label = tr.label || ''; tr.addEventListener('ended', () => { if (castV.srcObject === stream) setCast(null); }); } castV.play().catch(() => {}); }
    post();
  }
  // #668 HOLO+CAM: composite target at the program's shape, so a click on the desk monitor is where her feet go
  const hcRT = new THREE.WebGLRenderTarget(1280, 720, { depthBuffer: false, generateMipmaps: false });
  const hcU = { cam: { value: camTex }, ho: { value: null }, cf: { value: new THREE.Vector4(0, 0, 1, 1) }, F: { value: new THREE.Vector2() }, foot: { value: new THREE.Vector2() }, mean: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
    hoOn: { value: 0 }, A: { value: 16 / 9 }, k: { value: 1 }, flip: { value: 0 }, shadow: { value: 0 }, light: { value: 0 }, cut: { value: 0 }, sEl: { value: 0.2 }, hH: { value: 0.4 } };
  const hcSc = quad(new THREE.ShaderMaterial({ uniforms: hcU, vertexShader: VS, fragmentShader: HC_FS, depthTest: false, depthWrite: false }));
  const mc = document.createElement('canvas'); mc.width = mc.height = 8; const mcx = mc.getContext('2d', { willReadFrequently: true });
  let hcT = -1, meanT = 0;
  function hoCam(U, fit, W, H, now) {
    if (hcT !== now) {
      hcT = now;
      const A = W / H, hw = Math.max(320, Math.min(1920, Math.round(720 * A))), P = D.hp, v = fixed.video;
      if (hcRT.width !== hw) hcRT.setSize(hw, 720);
      cover(v.videoWidth, v.videoHeight, W, H, hcU.cf.value);
      if (now - meanT > 400) { meanT = now; try { mcx.drawImage(v, 0, 0, 8, 8); const d = mcx.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } const n = d.length / 4 * 255; hcU.mean.value.set(r / n, g / n, b / n); } catch {} }
      const pl = ho && ho.ready ? ho.renderPlaced(now, P) : null;
      hcU.hoOn.value = pl ? 1 : 0;
      if (pl) { hcU.ho.value = pl.tex; hcU.foot.value.copy(pl.foot); hcU.k.value = Math.max(0.02, pl.head.y - pl.foot.y) / Math.max(0.03, +P.h || 0.4); }
      hcU.F.value.set(+P.x, 1 - +P.y); hcU.A.value = A; hcU.flip.value = P.flip ? 1 : 0; hcU.shadow.value = +P.shadow || 0; hcU.light.value = +P.light || 0;
      hcU.cut.value = +P.cut || 0; hcU.sEl.value = Math.sin(Math.max(5, Math.min(80, +P.el || 0)) * Math.PI / 180); hcU.hH.value = +P.h || 0.4;
      const prev = renderer.getRenderTarget(); renderer.setRenderTarget(hcRT); renderer.render(hcSc, oc); renderer.setRenderTarget(prev);
    }
    U.value = hcRT.texture; fit.set(0, 0, 1, 1); return 1;
  }
  let ledTex = null, lastLedVid = null, ledImgTex = null, lastLedImg = null;
  const mU = { tA: { value: null }, tB: { value: null }, fA: { value: new THREE.Vector4(0, 0, 1, 1) }, fB: { value: new THREE.Vector4(0, 0, 1, 1) }, kA: { value: 0 }, kB: { value: 0 }, x: { value: 0 } };
  const mMat = new THREE.ShaderMaterial({ uniforms: mU, vertexShader: VS, fragmentShader: MIX_FS, depthTest: false, depthWrite: false }), mSc = quad(mMat);
  // #563 every DirroComics grab (GRAB QUEST / GRAB WEBCAM stills, GRAB RGB-D clips and stills) also lands in the desk's IMAGES or VIDEOS bank
  async function toBank(blob, name) {
    try { const vid = /^video\//.test(blob.type) || /\.(mp4|webm|mov|m4v)$/i.test(name), folder = vid ? 'Video' : 'Images';
      let n = String(name || (vid ? 'grab.webm' : 'grab.jpg')); if (!/\.[a-z0-9]{2,4}$/i.test(n)) n += vid ? (/mp4/.test(blob.type) ? '.mp4' : '.webm') : (/png/.test(blob.type) ? '.png' : '.jpg');
      const saved = await media.importFile(folder, new File([blob], n, { type: blob.type })); bc.postMessage({ k: 'bank', folder, name: saved }); bc.postMessage({ k: 'cxmsg', t: 'Grab also saved to ' + (vid ? 'VIDEOS' : 'IMAGES') + ': ' + saved }); }
    catch (e) { bc.postMessage({ k: 'cxmsg', t: 'Grab not saved to the bank: ' + (e.message || e) }); }
  }
  const comics = makeComics({ THREE, renderer, fixed, send: m => bc.postMessage(m), onChange: () => post(), onGrab: toBank,   // #516
    relayAsk: o => { const L = getLink(); if (!L || !L.isOpen) return 'no Quest link'; L.send('ctl', o); return ''; },   // #524 vjask / vjclog through the Quest
    requestRgbd: still => { const L = getLink(); if (!L || !L.isOpen) return 'no Quest link (connect DirroVJ to the Quest first)'; L.send('ctl', { k: 'cxgrab', still: !!still, ms: 5000 }); return ''; } });   // #520
  let comicTex = null;
  // #550 DANCER: her own renderer + canvas (js/dancerdesk.js), loaded on first use
  let dz = null, dzP = null;
  const dzLoad = () => dzP || (dzP = import('./dancerdesk.js').then(m => { dz = m.makeDancer({ S: D.dz, post: () => post(), bc, media }); dz.ensure(); return dz; }).catch(e => { D.dz.err = 'load: ' + (e.message || e); dzP = null; post(); }));
  const dzNeed = used => !!dz && (used.includes('dancer') || dz.recording);
  // #573 HOLO: drawn with this renderer into its own target, only while the T-bar shows (or CUE) its bus
  let ho = null;
  const hoLoad = () => { if (!ho) ho = makeHoloDesk({ THREE, renderer, S: D.holo, post: () => post() }); ho.ensure(); return ho; };
  const hoNeed = used => !!ho && (used.includes('holo') || used.includes('hocam'));   // #668
  // #575 SEND TO DIRROGRAM: every 2 s (and on a change) the performer + where the dance is, through the Quest link; the Quest puts it
  // in the config the relay keeps for the phones (dirro-host.js setHolo), the phones keep in step on the Quest clock they already track
  let hoSent = false;
  function holoGram() {
    const H = D.holo, L = getLink(), open = !!(L && L.isOpen);
    if (!open) { hoSent = false; return; }
    if (!H.gram || !ho || !ho.ready || !ho.player.meta) { if (hoSent) { L.send('ctl', { k: 'vjholo', on: false }); hoSent = false; } return; }
    L.send('ctl', { k: 'vjholo', on: true, id: H.perf, src: H.pub.replace(/\/?$/, '/') + H.perf + '/performer.json', pos: ho.t, sp: H.speed, dur: ho.player.meta.duration || ho.player.video.duration || 0 });
    hoSent = true;
  }
  setInterval(holoGram, 2000);
  fetch('holo/library.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => {
    if (!j || !Array.isArray(j.performers)) return;
    D.holo.lib = j.performers.map(p => ({ id: p.id, name: p.name || p.id, path: 'holo/' + p.id + '/performer.json', layout: p.layout || '' }));
    if (['holo', 'hocam'].includes(D.a) || ['holo', 'hocam'].includes(D.b)) hoLoad(); post();
  }).catch(() => {});   // #552 no own preview: she is drawn where the T-bar shows her, or for REC

  // ---- fractal flight: zoom in toward a target and out again (ping-pong), orbit round it; REACT lifts the heights on the bass
  const F = { z: 0, dir: 1, a: 0, ti: 0, j: 0, type: '', c: new THREE.Vector2(-0.6, 0) };
  let an = null, anBuf = null, anTrack = null, bass = 0, avg = 0, kickT = 0, pulse = 0, cyc = 0;
  // #508 kicks: bass energy jumping well over its running average (no BPM, no lock: each kick is heard, then the peaks fall back)
  function analyse(dt, now) {
    const tr = liveAudio();   // #556 BEAT listens to whatever sound is live (Quest, LINE IN or the automatic LINE IN)
    if (tr !== anTrack) { anTrack = tr; an = null; if (tr && tr.readyState === 'live') { try { const ac = analyse.ac || (analyse.ac = new AudioContext()); const s = ac.createMediaStreamSource(new MediaStream([tr])); an = ac.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0.1; s.connect(an); anBuf = new Uint8Array(an.frequencyBinCount); } catch { an = null; } } }
    if (an) {
      if (analyse.ac && analyse.ac.state === 'suspended') analyse.ac.resume().catch(() => {});
      an.getByteFrequencyData(anBuf); let s = 0; for (let i = 1; i < 6; i++) s += anBuf[i]; const v = s / (5 * 255);
      bass = v > bass ? v : bass * 0.88; avg += (v - avg) * Math.min(1, dt * 1.5);
      if (v > 0.22 && v > avg * 1.32 && now - kickT > 230) {
        if (D.tempo === 'line') { tempoKick(now); pulse = 1; D.kick++; if (peers) post(); }   // #662 LINE IN: each kick is a beat (and feeds the BPM readout)
        kickT = now;
      }
    } else bass *= 0.9;
    if (D.tempo === 'tap' && D.bpm > 0) {   // #662 TAP: a steady clock at the tapped BPM
      const per = 60000 / D.bpm; if (!tClock.next || tClock.next < now - per) tClock.next = now;
      if (now >= tClock.next) { tClock.next += per; pulse = 1; D.kick++; D.beatN++; if (peers) post(); }
    }
    pulse *= Math.exp(-dt * 5.5);
  }
  // #662 master tempo: LINE IN estimates the BPM from the kick spacing (median of the last 8, folded into 70..180); TAP = taps averaged
  const tClock = { next: 0, kicks: [], taps: [] };
  function tempoKick(now) {
    const K = tClock.kicks; K.push(now); while (K.length > 9) K.shift(); D.beatN++;
    if (K.length >= 5) { const iv = K.slice(1).map((t, i) => t - K[i]).filter(x => x > 250 && x < 1600).sort((a, b) => a - b);
      if (iv.length >= 4) { let b = 60000 / iv[iv.length >> 1]; while (b < 70) b *= 2; while (b > 180) b /= 2; D.bpm = Math.round((D.bpm ? D.bpm * 0.7 + b * 0.3 : b) * 10) / 10; } }
  }
  function tempoTap(now) {
    const T = tClock.taps; if (T.length && now - T[T.length - 1] > 2000) T.length = 0; T.push(now); while (T.length > 8) T.shift();
    D.tempo = 'tap';
    if (T.length >= 2) { const iv = T.slice(1).map((t, i) => t - T[i]), m = iv.reduce((a, b) => a + b, 0) / iv.length; D.bpm = Math.round(60000 / m * 10) / 10; }
    tClock.next = now; pulse = 1; D.kick++; D.beatN++;   // the tap is the downbeat
  }
  function fractal(dt, now) {
    const fr = D.fr, FD = FRACTALS[fr.type] || FRACTALS.mandel;
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
  function bind(name, U, fit, W, H, questTex, now) {   // a bus's texture and its cover crop
    if (name === 'quest') { U.value = questTex; fit.set(0, 0, 1, 1); return 1; }
    if (name === 'fractal') { U.value = fRT.texture; cover(320, 256, W, H, fit); return 1; }
    if (name === 'dancer') { if (!dz || !dz.ready) return 0; U.value = dz.tex; cover(1280, 720, W, H, fit); return 1; }   // #550
    if (name === 'holo') { if (!ho || !ho.ready) return 0; U.value = ho.tex; cover(1280, 720, W, H, fit); return 1; }   // #573
    if (name === 'comic') { if (!comicTex) return 0; U.value = comicTex; cover(1920, 1080, W, H, fit); return 1; }   // #516
    if (name === 'dverse') { const t = dvx && dvx.ready ? dvx.render(now) : null; if (!t) return 0; U.value = t; cover(dvx.w, dvx.h, W, H, fit); return 1; }   // #662
    if (name === 'cast') { const v = castV; if (!D.cast.on || !v.videoWidth) return 0;   // #667 crop off the casting page's own frame, then cover
      const C = D.cast, w = Math.max(0.05, 1 - C.l - C.r), h = Math.max(0.05, 1 - C.t - C.b); cover(v.videoWidth * w, v.videoHeight * h, W, H, fit);
      fit.set(C.l + fit.x * w, C.b + fit.y * h, fit.z * w, fit.w * h); U.value = castTex; return 1; }
    if (name === 'hocam') { const v = fixed.video; if (!fixed.on || !v.videoWidth) return 0; return hoCam(U, fit, W, H, now); }   // #668
    if (name === 'webcam') { const v = fixed.video; if (!fixed.on || !v.videoWidth) return 0; U.value = camTex; cover(v.videoWidth, v.videoHeight, W, H, fit); return 1; }
    if (name === 'led') {
      if (D.ledKind === 'pano') {
        const dt = studioCtl && studioCtl.renderDome ? studioCtl.renderDome(W, H, now) : null;
        if (!dt) return 0;
        U.value = dt; fit.set(0, 0, 1, 1); return 2;
      }
      if (!led.on) return 0;
      if (led.img && led.curImage) {
        if (lastLedImg !== led.curImage) {
          lastLedImg = led.curImage;
          if (ledImgTex) ledImgTex.dispose();
          ledImgTex = new THREE.Texture(lastLedImg); ledImgTex.flipY = false; ledImgTex.colorSpace = THREE.NoColorSpace; ledImgTex.generateMipmaps = false; ledImgTex.minFilter = ledImgTex.magFilter = THREE.LinearFilter; ledImgTex.needsUpdate = true;
        }
        U.value = ledImgTex; cover(lastLedImg.width, lastLedImg.height, W, H, fit); return 1;
      }
      const v = led.video; if (!v || !v.videoWidth) return 0;
      if (v.paused) v.play().catch(() => {});
      if (lastLedVid !== v) {
        lastLedVid = v;
        if (ledTex) ledTex.dispose();
        ledTex = new THREE.VideoTexture(v); ledTex.colorSpace = THREE.NoColorSpace; ledTex.generateMipmaps = false; ledTex.minFilter = ledTex.magFilter = THREE.LinearFilter;
      }
      if (v.readyState >= 2) ledTex.needsUpdate = true;
      U.value = ledTex; cover(v.videoWidth, v.videoHeight, W, H, fit); return 1;
    }
    return 0;
  }
  // ---- the program picture: called by studio.js with its composite, draws to the screen
  let lastT = 0, pvT = 0; const PVW = 480, PVH = 270, pv = document.createElement('canvas'); pv.width = PVW; pv.height = PVH;   // #557 desk monitor 480 x 270 (was 256 x 144)
  const pvRT = new THREE.WebGLRenderTarget(PVW, PVH, { depthBuffer: false }), pvBuf = new Uint8Array(PVW * PVH * 4), pvImg = new ImageData(PVW, PVH);   // #557 CUE picture
  let outT = 0;   // #519 last program frame: the desk says when DirroVJ is waiting for the Quest
  function output(questTex, now, W, H) {
    outT = now;
    const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016); lastT = now;
    if (D.fadeTo != null) { const step = dt * 1000 / Math.max(50, D.fadeMs); D.x += Math.sign(D.fadeTo - D.x) * step; if (Math.abs(D.fadeTo - D.x) <= step) { D.x = D.fadeTo; D.fadeTo = null; post(); } }
    if ((D.cue === 'a' && D.x <= 0) || (D.cue === 'b' && D.x >= 1)) { D.cue = ''; post(); }   // #557 the T-bar reached the cued bus: it is LIVE now, CUE ends
    const onAir = (D.x < 1 ? [D.a] : []).concat(D.x > 0 ? [D.b] : []), cueSrc = D.cue ? D[D.cue] : '';
    const used = cueSrc && !onAir.includes(cueSrc) ? onAir.concat([cueSrc]) : onAir;   // a cued source is drawn too (FRACTAL, DANCER, COMICS)
    analyse(dt, now);   // #662 the master tempo runs whatever is on the buses
    if (used.includes('fractal')) fractal(dt, now);
    if (dzNeed(used)) dz.render(now);
    if (ho && used.includes('holo')) ho.render(now);   // #668 HOLO+CAM draws her itself (in bind)
    if (castV.srcObject) { if (used.includes('cast')) { if (castV.paused) castV.play().catch(() => {}); } else if (!castV.paused) castV.pause(); }   // #667
    { const hv = ho && ho.player && ho.player.video;   // #666 off air = no decoding: the holo atlas and the DirroVerse loop pause when no bus (or CUE) shows them
      if (hv && hv.src) { if (hoNeed(used)) { if (hv.paused) hv.play().catch(() => {}); } else if (!hv.paused) hv.pause(); }
      if (dvx) dvx.active(used.includes('dverse')); }   // #573   // #550 only while the T-bar shows her bus, or REC runs
    comics.tick(questTex, now, dt); comicTex = used.includes('comic') ? comics.render(W, H) : null;   // #516
    mU.kA.value = D.x < 1 ? bind(D.a, mU.tA, mU.fA.value, W, H, questTex, now) : 0;
    mU.kB.value = D.x > 0 ? bind(D.b, mU.tB, mU.fB.value, W, H, questTex, now) : 0;
    mU.x.value = D.x;
    renderer.setRenderTarget(null); renderer.render(mSc, oc);
    if (lsc.on) { lsc.tick(dt); lscTex.needsUpdate = true; const ac = renderer.autoClear; renderer.autoClear = false; renderer.render(lscSc, oc); renderer.autoClear = ac; }   // #556 local scroller over the program (no Quest)
    if (peers && now - pvT > 250 && cueSrc) {   // #557 CUE: the cued bus alone into a small target, read back for the desk monitor (Twitch / DirroTV keep the program)
      pvT = now;
      try {
        mU.kA.value = bind(cueSrc, mU.tA, mU.fA.value, W, H, questTex, now); mU.kB.value = 0; mU.x.value = 0;
        renderer.setRenderTarget(pvRT); renderer.render(mSc, oc); renderer.readRenderTargetPixels(pvRT, 0, 0, PVW, PVH, pvBuf); renderer.setRenderTarget(null);
        const row = PVW * 4; for (let y = 0; y < PVH; y++) pvImg.data.set(pvBuf.subarray((PVH - 1 - y) * row, (PVH - y) * row), y * row);
        pv.getContext('2d').putImageData(pvImg, 0, 0); bc.postMessage({ k: 'pv', img: pv.toDataURL('image/jpeg', 0.7), cue: D.cue });
      } catch (e) { console.warn('cue preview', e); }
    }
    if (peers && now - pvT > 250) { pvT = now; try { pv.getContext('2d').drawImage(renderer.domElement, 0, 0, PVW, PVH); bc.postMessage({ k: 'pv', img: pv.toDataURL('image/jpeg', 0.6) }); } catch {} }
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
  function chatChan() { return D.chQ || D.chDesk || ''; }   // #556 the Quest's channel while it sends one, else the desk's
  function chatFollow() { const c = chatChan(); if (c !== D.ch) { D.ch = c; chat.stop(); if (c) chat.start(c); post(); } }
  function onStu(m) {
    if ('sh' in m && JSON.stringify(m.sh) !== JSON.stringify(D.sh)) { D.sh = m.sh; post(); }   // #523 SHOWTIME! state from the Quest
    if (m.ch && m.ch !== D.chQ) { D.chQ = m.ch; chatFollow(); }
  }
  function onVjSms(m) { for (const [id, t] of m.items || []) enqueue('sms', 'HoloSMS', t, 'sms:' + id); }
  // #556 no Quest link: approved lines go to a sine scroller drawn over DirroVJ's own program (all buses, Twitch, DirroTV); CLEAR on the desk stops it
  const lsc = new Scroller(); lsc.save = () => {};
  const lscTex = new THREE.CanvasTexture(lsc.canvas); lscTex.colorSpace = THREE.SRGBColorSpace; lscTex.generateMipmaps = false; lscTex.minFilter = THREE.LinearFilter;
  const lscSc = new THREE.Scene(); { const h = 2 * (1280 * 128 / 768) / 720, m = new THREE.Mesh(new THREE.PlaneGeometry(2, h), new THREE.MeshBasicMaterial({ map: lscTex, transparent: true, depthTest: false, depthWrite: false })); m.position.y = -1 + h / 2 + 0.03; m.frustumCulled = false; lscSc.add(m); }
  const questLinked = () => { const L = getLink(); return !!(L && L.isOpen); };
  function approve(id, t) {
    const q = id != null ? queue.find(x => x.id === id) : null, text = q ? q.t : t; if (!text) return;
    const L = getLink(); if (L && L.isOpen) L.send('ctl', { k: 'vjsine', t: text });
    else { lsc.start(text); D.lsc = text; }
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
  // #556 automatic LINE IN: when the desk is on QUEST sound but no Quest sound has come for 3 s, this laptop's input (the picked one, else the
  // default) stands in for Twitch, DirroTV and BEAT; it is let go as soon as the Quest's sound is back. The DIRROVJ page may ask once for the mic.
  let autoTrack = null, autoBusy = false, qGoneT = 0;
  const qAudio = () => { const t = getQuestAudio && getQuestAudio(); return t && t.readyState === 'live' ? t : null; };
  const liveAudio = () => (D.audio === 'line' && lineTrack && lineTrack.readyState === 'live' ? lineTrack : null) || qAudio() || (autoTrack && autoTrack.readyState === 'live' ? autoTrack : null);
  setInterval(async () => {
    const now = performance.now(), q = qAudio();
    if (q || D.audio !== 'quest') { qGoneT = 0; if (autoTrack) { autoTrack.stop(); autoTrack = null; D.audioAuto = false; onAudio && onAudio(); post(); } return; }
    if (!qGoneT) qGoneT = now;
    if (autoTrack || autoBusy || now - qGoneT < 3000) return;
    autoBusy = true;
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: D.lineDev ? { ideal: D.lineDev } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } });
      if (qAudio() || D.audio !== 'quest') s.getTracks().forEach(t => t.stop()); else { autoTrack = s.getAudioTracks()[0]; D.audioAuto = true; D.lineErr = ''; onAudio && onAudio(); post(); } }
    catch (e) { D.lineErr = 'automatic LINE IN: ' + e.message; qGoneT = now + 27000; post(); }   // try again in 30 s
    finally { autoBusy = false; }
  }, 1000);
  let devCache = null, devT = 0;   // #518 the input list is asked for at most every 5 s (it was every state post)
  async function devices() { const now = performance.now(); if (devCache && now - devT < 5000) return devCache; devT = now; try { devCache = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput').map(d => [d.deviceId, d.label || 'Input']); } catch { devCache = []; } return devCache; }
  // ---- the control window
  const bc = new BroadcastChannel('dirrovj'); let peers = 0, postT = 0;
  async function post() {
    const now = performance.now(); if (now - postT < 60) { clearTimeout(post.t); post.t = setTimeout(post, 70); return; } postT = now;
    D.qlink = questLinked(); if (!D.qlink && D.chQ) { D.chQ = ''; chatFollow(); }   // #556 the Quest's chat channel only counts while it is linked
    bc.postMessage({ k: 'state', D: { ...D, fr: { ...D.fr } }, tw: studioCtl && studioCtl.twState ? studioCtl.twState() : null, air: studioCtl && studioCtl.airState ? studioCtl.airState() : null, queue, devs: await devices(), sources: SOURCES, C: comics.state(), live: outT > 0 && performance.now() - outT < 3000 });
  }
  bc.onmessage = e => {
    const m = e.data || {}; peers = 1;
    if (m.k === 'hello') { post(); if (!m.again) comics.sendList(); }
    else if (m.k === 'cx') comics.onMsg(m);   // #516 DirroComics
    else if (m.k === 'dz') { const p = dzLoad(); if (p) p.then(z => z && z.onMsg(m)); }
    else if (m.k === 'holo') { hoLoad().onMsg(m); if (m.op === 'gram' || m.op === 'perf' || m.op === 'speed' || m.op === 'restart') setTimeout(holoGram, m.op === 'perf' ? 1500 : 50); }   // #573 HOLO panel, #575 tell the phones at once   // #550 DANCER panel and DANCER CLIPS
    else if (m.k === 'tw') { if (studioCtl) { if (m.op === 'key') studioCtl.setTwKey(m.key); else studioCtl.twToggle(m.key); } post(); }   // #532 Twitch key + GO LIVE on the VJ desk
    else if (m.k === 'media') {   // #532 / #533 IMAGES / VIDEOS / PANOS clip decks
      const { folder, name } = m; if (!folder || !name) return;
      D.media = folder + '/' + name;
      const actBus = D.x <= 0.5 ? 'a' : 'b';
      if (folder === 'Images' || folder === 'Video') {
        D.ledKind = 'clip'; D[actBus] = 'led'; post();
        media.getFile(folder, name).then(f => {
          if (!f) return;
          led.play(f, true);
          if (studioCtl && studioCtl.setVisuals) studioCtl.setVisuals();
          post();
        }).catch(() => {});
      } else if (folder === 'Pano' || folder === 'Video pano') {
        D.ledKind = 'pano'; D[actBus] = 'led';
        if (studioCtl && studioCtl.pickPano) studioCtl.pickPano(folder, name);
        const L = getLink(); if (L && L.isOpen && D.sh && D.sh.o && !D.sh.o.dome) L.send('ctl', { k: 'vjshow', cam: '', opt: 'dome', v: true });
        post();
      }
    }
    else if (m.k === 'panoYaw') { D.panoYaw = Math.max(0, Math.min(360, +m.v || 0)); if (studioCtl && studioCtl.setPanoYaw) studioCtl.setPanoYaw(D.panoYaw); post(); }
    else if (m.k === 'show') {
      if (m.cam === 'pcam' && !fixed.on && fixed.start) fixed.start().catch(() => {});
      if (m.cam) { const act = D.x < 0.5 ? 'a' : 'b'; if (D[act] === 'webcam') { D[act] = 'quest'; post(); } }
      const L = getLink(); if (L && L.isOpen) L.send('ctl', { k: 'vjshow', cam: m.cam || '', opt: m.opt || '', v: !!m.v }); else bc.postMessage({ k: 'cxmsg', t: 'SHOWTIME!: no Quest link' });
    }   // #523 / #530
    else if (m.k === 'bus') { if (SOURCES.includes(m.v)) { if (m.v === 'webcam' && !fixed.on && fixed.start) fixed.start().catch(() => {}); if (m.v === 'dancer') dzLoad(); if (m.v === 'holo') hoLoad(); if (m.v === 'hocam') { if (!fixed.on && fixed.start) fixed.start().catch(() => {}); hoLoad(); } if (m.v === 'dverse') { const x = dvGet(); if (!D.dv.sets.length) x.list(); } D[m.bus === 'b' ? 'b' : 'a'] = m.v; } post(); }
    else if (m.k === 'x') { D.x = Math.max(0, Math.min(1, +m.v)); D.fadeTo = null; post(); }
    else if (m.k === 'cue') { const b = m.bus === 'a' || m.bus === 'b' ? m.bus : ''; const live = b && ((b === 'a' && D.x <= 0) || (b === 'b' && D.x >= 1)); D.cue = !b || live || D.cue === b ? '' : b; post(); }   // #557 tap = CUE, tap again = out of CUE; the fully live bus can't be cued
    else if (m.k === 'cut') { D.x = D.x < 0.5 ? 1 : 0; D.fadeTo = null; post(); }
    else if (m.k === 'auto') { D.fadeMs = +m.ms || D.fadeMs; D.fadeTo = D.x < 0.5 ? 1 : 0; post(); }
    else if (m.k === 'fr') { Object.assign(D.fr, m.v || {}); try { localStorage.setItem('vire.vjFr', JSON.stringify(D.fr)); } catch {} post(); }
    else if (m.k === 'pump') { pulse = 1; D.kick++; }   // #508 the VJ's own hit
    else if (m.k === 'tap') { tempoTap(performance.now()); post(); }   // #662 TAP (button or T)
    else if (m.k === 'tempo') { D.tempo = m.v === 'tap' ? 'tap' : 'line'; if (D.tempo === 'line') tClock.kicks.length = 0; post(); }
    else if (m.k === 'nudge') { if (D.bpm > 0) D.bpm = Math.max(40, Math.min(220, Math.round((D.bpm + (+m.d || 0)) * 10) / 10)); post(); }
    else if (m.k === 'tvpair') { if (studioCtl && studioCtl.tvPair) studioCtl.tvPair(String(m.code || '')).then(t => bc.postMessage({ k: 'cxmsg', t })).catch(e => bc.postMessage({ k: 'cxmsg', t: 'DirroTV: ' + e.message })); }   // #662 SOLO: pair a TV from the desk
    else if (m.k === 'cast') { if (m.op === 'stop') setCast(null); else if (m.op === 'crop' && m.v) { for (const k of ['l', 'r', 't', 'b']) if (m.v[k] != null) D.cast[k] = Math.max(0, Math.min(0.45, +m.v[k] || 0)); try { localStorage.setItem('vire.vjCast', JSON.stringify({ l: D.cast.l, r: D.cast.r, t: D.cast.t, b: D.cast.b })); } catch {} } post(); }   // #667
    else if (m.k === 'hp') { if (m.reset) Object.assign(D.hp, HP0); else if (m.v) for (const k of Object.keys(HP0)) if (m.v[k] != null) D.hp[k] = typeof HP0[k] === 'boolean' ? !!m.v[k] : +m.v[k];   // #668
      try { localStorage.setItem('vire.vjHp', JSON.stringify(D.hp)); } catch {} post(); }
    else if (m.k === 'dv') {   // #662 DirroVerse
      const x = dvGet();
      if (m.act === 'list') x.list();
      else if (m.act === 'load') { x.load(String(m.set || '')); if (!fixed.on && fixed.start) fixed.start().catch(() => {}); }
      else if (m.act === 'cam') { D.dv.cam = !!m.v; if (D.dv.cam && !fixed.on && fixed.start) fixed.start().catch(() => {}); post(); }
      else if (m.act === 'arrive') x.arrive(String(m.file || ''));
      else if (m.act === 'stopArr') { D.dv.playing = ''; post(); }
      else if (m.act === 'render') x.renderArrival(String(m.name || '').slice(0, 40));
      else if (m.act === 'look') { D.dv.match = Math.max(0, Math.min(1, +m.match || 0)); post(); }   // #664 webcam palette match to the plate
    }
    else if (m.k === 'approve') approve(m.id);
    else if (m.k === 'reject') { const i = queue.findIndex(x => x.id === m.id); if (i >= 0) queue.splice(i, 1); post(); }
    else if (m.k === 'say') approve(null, String(m.t || '').slice(0, 120));
    else if (m.k === 'audio') setAudio(m.v, m.dev);
    else if (m.k === 'chan') { D.chDesk = String(m.v || '').replace(/^#/, '').trim().toLowerCase().slice(0, 40); try { localStorage.setItem('vire.vjChat', D.chDesk); } catch {} chatFollow(); }   // #556
    else if (m.k === 'lsc') { lsc.stop(); D.lsc = ''; post(); }   // #556 CLEAR the local scroller
  };
  setInterval(() => { if (peers) post(); }, 1500);
  if (D.a === 'dancer' || D.b === 'dancer') dzLoad();
  setTimeout(chatFollow, 1500);   // #556 the desk's own chat channel, if no Quest sends one
  // #519 the Quest hasn't turned DirroVJ on (no program frames): keep DirroComics editing alive (desk preview, grabs, AUTO).
  // tick() draws only into its own render targets, never to the screen, so it doesn't fight the camera page's own drawing.
  let idleT = 0; setInterval(() => { const now = performance.now(); if (now - outT < 1000 || !peers) return; if (dzNeed([])) try { dz.render(now); } catch (e) { console.warn('dancer idle', e); }   // #550 REC with no program frames
    const dt = idleT ? Math.min(0.25, (now - idleT) / 1000) : 0.12; idleT = now; try { comics.tick(null, now, dt); } catch (e) { console.warn('comics idle', e); } }, 120);
  return { D, post, output, setCast, onStu, onVjSms, set onAudio(f) { onAudio = f; }, audioTrack: () => (D.audio === 'line' && lineTrack && lineTrack.readyState === 'live' ? lineTrack : null) || (autoTrack && autoTrack.readyState === 'live' ? autoTrack : null), queue, comics, onCx: m => { if (m.star) { comics.onStar(m.star); return; } if (m.blob) { comics.onMsg({ k: 'cx', op: 'add', files: [{ blob: m.blob, name: m.name || 'quest-rgbd' }] }); toBank(m.blob, m.name || 'quest-rgbd'); } else if (m.t) bc.postMessage({ k: 'cxmsg', t: 'Quest: ' + m.t }); }, _F: F };   // #520 GRAB RGB-D replies
}
