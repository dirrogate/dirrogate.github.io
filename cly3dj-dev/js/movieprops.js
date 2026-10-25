// #478 MOVIE PROPS (owner, 25 Oct): VJ TOOLS > MOVIE PROPS puts set-dressing props into the room, for filming a scene in passthrough or on the PC:
//   PUDDLE  a wet-looking patch of ground cut out by a MATTE picture (premade ones, or your own), with ripples, rain drops and reflections
//           of the neon signs (worked out in the puddle's own shader: no second render of the scene, cheap on the Quest)
//   RAIN    falling streaks in a box          FOG  soft drifting puffs in a box (FOG: low and slow, SMOKE: rises and fades)
//   GLB     any .glb you add (lamp post, air conditioner, car...)
//   NEON    a neon sign from typed text (English / Hindi), horizontal or vertical, colour, outline / solid / Monoton, frame, flicker
//   GRAFFITI a PNG with transparency on a flat card (graff1 / graff2 or your own), tint, brightness, glow
// Every prop is carried and sized with the same handles as the WATER in fx.js (CLAUDE.md #379):
//   floor props (puddle, rain, fog): grip / pinch the ring on its post to carry it (it stays level), trigger / pinch the cube on the other post to size w x d.
//   wall props (neon, graffiti, glb): grip / pinch the ring to carry it (any angle), trigger / pinch the cube to size it, or grip with the other hand too and stretch.
// The handles are DJ-only (USER_LAYER): never in the stream, AVACAM, GoPro or the recordings. The props themselves are normal scene objects.
// Fonts: Noto Sans Devanagari Bold and Monoton, both SIL Open Font License. Files you add live in the app's private storage (OPFS 'vire-props').
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';
import { USER_LAYER } from './fx.js';

const KEY = 'vire.movieprops', POST_H = 0.26;
const YAX = new THREE.Vector3(0, 1, 0), _r = new THREE.Ray(), _inv = new THREE.Matrix4(), _bx = new THREE.Box3();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
function userOnly(o) { o.traverse(c => { c.layers.set(USER_LAYER); if (c.isMesh) { c.raycast = () => {}; c.castShadow = c.receiveShadow = false; } }); }
function noRay(o) { o.traverse(c => { if (c.isMesh || c.isLine || c.isPoints) c.raycast = () => {}; }); }

export const COLORS = [['PINK', '#ff2d95'], ['CYAN', '#19e6ff'], ['AMBER', '#ffb02e'], ['GREEN', '#39ff7a'], ['VIOLET', '#a455ff'], ['RED', '#ff2b2b'], ['WARM WHITE', '#fff1d0']];
export const PRESETS = ['DIRRO DJ', 'NEON', 'मुंबई', 'चाय', 'होटल', 'संगीत', 'डीजे', 'खुला है', 'प्रेम', 'BAR', 'हेलो मुंबई'];
export const NEON_FONTS = ['NOTO OUTLINE', 'NOTO SOLID', 'MONOTON'];
export const FOG_COLORS = [['GREY', '#aab4c0'], ['TEAL', '#5fb8c8'], ['MAGENTA', '#d45cc0'], ['AMBER', '#e0a050'], ['WHITE', '#ffffff']];
export const MATTES = ['SCATTERED', 'BIG PUDDLE', 'GUTTER', 'CRACKED', 'COBBLES'];   // COBBLES: the WET COBBLE ground (tiles, stones tilt the reflections, streaked lamp / neon reflections)
// #482 SURFACES: a ground made from texture maps. Each surface has slots for the maps (any can stay empty) plus its real-world tile size and displacement depth.
export const SURF_SLOTS = [['diff', 'DIFFUSE'], ['disp', 'DISPLACEMENT'], ['rough', 'ROUGHNESS'], ['nor', 'NORMAL'], ['ao', 'AO']];
const SURF_BUILTIN = {
  COBBLESTONE: { tile: 1.0, disp: 1.0, slots: { diff: 'surfaces/cobblestone/diff.jpg', disp: 'surfaces/cobblestone/disp.png', rough: 'surfaces/cobblestone/rough.jpg' } },
  ASPHALT: { tile: 1.6, disp: 0.6, slots: { diff: 'surfaces/asphalt/diff.jpg', disp: 'surfaces/asphalt/disp.png', rough: 'surfaces/asphalt/rough.jpg' } },
};
const SKEY = 'vire.surfaces';
// #483 ready-made street props (real-world size, lightweight GLB: decimated, WebP textures)
export const GLB_BUILTIN = {
  'street_lamp_01.glb': 'models/props/street_lamp_01.glb', 'street_lamp_02.glb': 'models/props/street_lamp_02.glb', 'covered_car.glb': 'models/props/covered_car.glb',
  'concrete_road_barrier.glb': 'models/props/concrete_road_barrier.glb', 'exterior_aircon.glb': 'models/props/exterior_aircon.glb', 'exterior_aircon_rusted.glb': 'models/props/exterior_aircon_rusted.glb',
};
export const GRAFF_BUILTIN = ['graff1.png', 'graff2.png'];
export const GRAFF_TINTS = [['OFF', null], ['WHITE', '#ffffff'], ['PINK', '#ff2d95'], ['CYAN', '#19e6ff'], ['AMBER', '#ffb02e'], ['BLACK', '#000000']];

// ------------------------------------------------------------------ the app's private file storage for added matte pictures, PNGs and GLBs
async function kdir(kind) { return (await (await navigator.storage.getDirectory()).getDirectoryHandle('vire-props', { create: true })).getDirectoryHandle(kind, { create: true }); }
export async function listFiles(kind) {
  const out = [];
  try { for await (const [name, h] of (await kdir(kind)).entries()) if (h.kind === 'file') out.push(name); } catch {}
  return out.sort((a, b) => a.localeCompare(b));
}
export async function getFile(kind, name) { try { return await (await (await kdir(kind)).getFileHandle(name)).getFile(); } catch { return null; } }
export async function putFile(kind, file) {
  const name = file.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120), w = await (await (await kdir(kind)).getFileHandle(name, { create: true })).createWritable();
  await file.stream().pipeTo(w); return name;
}
export async function removeFile(kind, name) { try { await (await kdir(kind)).removeEntry(name); } catch {} }

// ------------------------------------------------------------------ fonts
let fontsP = null;
function ensureFonts() {
  if (fontsP) return fontsP;
  const mk = (fam, file) => { const f = new FontFace(fam, `url(./fonts/${file})`, { weight: file.startsWith('Monoton') ? '400' : '700' }); document.fonts.add(f); return f.load(); };
  fontsP = Promise.all([mk('DirroDev', 'NotoDevanagariBold.woff2'), mk('DirroDevLat', 'NotoDevanagariBoldLatin.woff2'), mk('DirroMono', 'Monoton.woff2')]).catch(e => { console.warn('movieprops fonts', e); });
  return fontsP;
}
const mix = (hex, k) => { const c = new THREE.Color(hex); c.lerp(new THREE.Color(1, 1, 1), k); return '#' + c.getHexString(); };
function graphemes(s) { try { return [...new Intl.Segmenter('hi', { granularity: 'grapheme' }).segment(s)].map(x => x.segment); } catch { return [...s]; } }

// neon tube text on a transparent canvas: glow, coloured tube, hot white core
async function renderNeon(text, fontIdx, vertical, hex, frame) {
  await ensureFonts();
  const mono = fontIdx === 2, solid = fontIdx === 1;
  const fam = mono ? '"DirroMono","DirroDevLat","DirroDev"' : '"DirroDevLat","DirroDev",sans-serif', wt = mono ? 400 : 700;
  const raw = (text || ' ').replace(/\r/g, '');
  const lines = vertical ? graphemes(raw.replace(/\n/g, '')).map(ch => (ch === ' ' ? ' ' : ch)) : raw.split('\n');
  let FS = 150; const meas = document.createElement('canvas').getContext('2d');
  const lh = f => f * (mono ? 1.25 : 1.65);
  const size = f => { meas.font = `${wt} ${f}px ${fam}`; let mw = 0; for (const l of lines) mw = Math.max(mw, meas.measureText(l).width); return mw; };
  let pad = frame ? 120 : 80, mw = size(FS), W = mw + pad * 2, H = lines.length * lh(FS) + pad * 2;
  const k = Math.min(1, 3000 / Math.max(W, H)); if (k < 1) { FS *= k; pad *= k; mw = size(FS); W = mw + pad * 2; H = lines.length * lh(FS) + pad * 2; }
  const LH = lh(FS), c = document.createElement('canvas'); c.width = Math.ceil(W); c.height = Math.ceil(H);
  const g = c.getContext('2d'); g.font = `${wt} ${FS}px ${fam}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineCap = 'round';
  const each = fn => lines.forEach((l, i) => fn(l, c.width / 2, pad + LH * (i + 0.5)));
  const hot = mix(hex, 0.78);
  if (solid || mono) {
    g.fillStyle = hex; g.shadowColor = hex; g.shadowBlur = FS * 0.5; each((l, x, y) => g.fillText(l, x, y)); g.shadowBlur = FS * 0.2; each((l, x, y) => g.fillText(l, x, y));
    g.shadowBlur = 0; g.fillStyle = hot; each((l, x, y) => g.fillText(l, x, y));
  } else {   // a clean tube round each letter: stroke it, then cut the letter's inside out (so the overlapping contours of the font do not show)
    const ring = (outer, inner, col) => {
      const k = document.createElement('canvas'); k.width = c.width; k.height = c.height; const q = k.getContext('2d');
      q.font = g.font; q.textAlign = 'center'; q.textBaseline = 'middle'; q.lineJoin = 'round'; q.strokeStyle = col; q.lineWidth = FS * outer * 2;
      lines.forEach((l, i) => q.strokeText(l, c.width / 2, pad + LH * (i + 0.5)));
      q.globalCompositeOperation = 'destination-out'; q.fillStyle = '#000'; lines.forEach((l, i) => q.fillText(l, c.width / 2, pad + LH * (i + 0.5)));
      if (inner > 0) { q.strokeStyle = '#000'; q.lineWidth = FS * inner * 2; lines.forEach((l, i) => q.strokeText(l, c.width / 2, pad + LH * (i + 0.5))); }
      return k;
    };
    g.shadowColor = hex; g.shadowBlur = FS * 0.5; const t1 = ring(0.05, 0, hex); g.drawImage(t1, 0, 0); g.drawImage(t1, 0, 0);
    g.shadowBlur = FS * 0.15; g.drawImage(ring(0.035, 0, hex), 0, 0);
    g.shadowBlur = 0; g.drawImage(ring(0.0225, 0.0075, hot), 0, 0);
  }
  if (frame) {
    const fx = pad * 0.42, r = pad * 0.5, w = c.width - fx * 2, h = c.height - fx * 2;
    const path = () => { g.beginPath(); g.roundRect(fx, fx, w, h, r); };
    g.strokeStyle = hex; g.shadowColor = hex;
    g.lineWidth = FS * 0.06; g.shadowBlur = FS * 0.45; path(); g.stroke(); path(); g.stroke();
    g.shadowBlur = FS * 0.12; path(); g.stroke(); g.shadowBlur = 0; g.strokeStyle = hot; g.lineWidth = FS * 0.02; path(); g.stroke();
  }
  return { canvas: c, unit: 0.3 / LH };   // metres per pixel at scale 1: one text line is 30 cm tall
}

// ------------------------------------------------------------------ matte pictures (grey: white = wet)
function nz(seed) {   // value noise on a 64 grid, wrapped
  const N = 64, a = new Float32Array(N * N); let s = seed * 9301 + 49297;
  for (let i = 0; i < a.length; i++) { s = (s * 9301 + 49297) % 233280; a[i] = s / 233280; }
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const h = (i, j) => a[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
    return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
  };
}
function makeCobbles() {   // irregular rounded setts: jittered Voronoi cells, wobbly joints, each stone a little dome with its own tilt and brightness. R = joints white / stone tops grey, G = stone brightness
  const S = 512, N = 9, TAU = Math.PI * 2, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), im = g.createImageData(S, S);
  const rnd = (a, b, k) => { let h = (a * 374761393 + b * 668265263 + k * 2147483647) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const pts = []; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pts.push({ x: i + 0.12 + 0.76 * rnd(i, j, 1), y: j + 0.12 + 0.76 * rnd(i, j, 2), tx: (rnd(i, j, 3) - 0.5) * 0.9, ty: (rnd(i, j, 4) - 0.5) * 0.9, br: rnd(i, j, 5), sz: 0.85 + 0.3 * rnd(i, j, 6) });
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let px = x / S * N, py = y / S * N;
    const wx = 0.13 * Math.sin(TAU * (py * 2 / N) + 1.3) + 0.07 * Math.sin(TAU * (py * 5 / N) + 0.4) + 0.05 * Math.sin(TAU * ((px + py) * 4 / N)), wy = 0.13 * Math.sin(TAU * (px * 2 / N) + 2.1) + 0.07 * Math.sin(TAU * (px * 6 / N) + 1.1) + 0.05 * Math.sin(TAU * ((px - py) * 3 / N));
    px += wx; py += wy;
    const i0 = Math.floor(px), j0 = Math.floor(py); let f1 = 9, f2 = 9, id = null, cx = 0, cy = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i0 + di, jj = j0 + dj, p = pts[((jj % N) + N) % N * N + ((ii % N) + N) % N], qx = p.x + (ii - (((ii % N) + N) % N)), qy = p.y + (jj - (((jj % N) + N) % N)), d = Math.hypot(px - qx, py - qy) / p.sz;
      if (d < f1) { f2 = f1; f1 = d; id = p; cx = qx; cy = qy; } else if (d < f2) f2 = d;
    }
    const e = f2 - f1, st = Math.min(1, Math.max(0, (e - 0.03) / 0.15)), dome = Math.pow(st * st * (3 - 2 * st), 0.8);
    const fine = 0.025 * Math.sin(TAU * (x * 23 / S) + id.br * 9) * Math.sin(TAU * (y * 31 / S) + id.br * 5) + 0.02 * Math.sin(TAU * ((x + y) * 61 / S));
    let h = dome * (1 - 0.45 * f1 * f1) + (id.tx * (px - cx) + id.ty * (py - cy)) * 0.22 * dome + fine * dome;
    const m = Math.min(1, Math.max(0, 1 - h * 1.1)), i = (y * S + x) * 4;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = 0; im.data[i] = m * 255; im.data[i + 1] = id.br * 255; im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0); return c;
}
function makeMatte(idx) {
  if (idx === 4) return makeCobbles();
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), im = g.createImageData(S, S), n1 = nz(11 + idx), n2 = nz(77 + idx);
  const fbm = (x, y) => (n1(x, y) * 0.55 + n1(x * 2.1, y * 2.1) * 0.28 + n2(x * 4.3, y * 4.3) * 0.17);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S; let m;
    if (idx === 0) m = fbm(u * 9, v * 9);                                                              // many small / medium puddles
    else if (idx === 1) { const d = Math.hypot(u - 0.5, v - 0.5) * 2; m = 1 - d * 1.15 + (fbm(u * 5, v * 5) - 0.5) * 0.8; }   // one big irregular puddle
    else if (idx === 2) { const d = Math.abs(v - 0.5) * 2; m = 1 - d * 1.5 + (fbm(u * 6, v * 3) - 0.5) * 0.7; }       // a gutter along the width
    else { const r = 1 - Math.abs(fbm(u * 7, v * 7) - 0.5) * 3.2; m = r * 0.9 + fbm(u * 3, v * 3) * 0.2; }            // cracked ground: thin joined channels
    const b = clamp(m, 0, 1) * 255, i = (y * S + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = b; im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0); return c;
}

// ------------------------------------------------------------------ puddle shader
const PUD_V = `varying vec2 vUv; varying vec3 vW, vLV, vTx, vTy, vNn;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
  vLV = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz - position;
  vTx = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0)); vTy = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0)); vNn = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0)); }`;
const PUD_F = `precision highp float;
uniform sampler2D uMatte, uS0, uS1, uS2, uS3; uniform float uWet, uSoft, uInv, uRip, uRain, uRefl, uT, uDark, uSize, uCobble, uStreak, uBump; uniform vec2 uTile, uFocus;
uniform vec3 uSky, uTint; uniform mat4 uSI[4]; uniform vec4 uSD[4];
uniform float uSurf, uTileM, uDispAmt, uCover, uAmb, uHasD, uHasR, uHasN, uHasA, uHasC; uniform sampler2D uDiff, uDisp, uRoughT, uNormT, uAOT; uniform vec2 uWD; uniform vec4 uLP[4]; uniform vec3 uLC[4];
varying vec2 vUv; varying vec3 vW, vLV, vTx, vTy, vNn;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float height(vec2 p){
  float h = 0.012 * sin(p.x * 9.0 + uT * 1.3) * sin(p.y * 8.0 - uT * 1.1) + 0.008 * sin((p.x + p.y) * 17.0 - uT * 2.1);
  for (int L = 0; L < 2; L++) {
    float sc = L == 0 ? 2.0 : 2.9; vec2 q = p * sc + (L == 0 ? 0.0 : 17.3), id = floor(q), f = fract(q) - 0.5;
    float r = h21(id + float(L) * 7.1);
    if (r > 0.45) {
      float ph = fract(uT * uRain * (0.25 + 0.5 * r) + r * 5.0);
      vec2 c = (vec2(h21(id + 3.1), h21(id + 8.7)) - 0.5) * 0.35;
      float d = length(f - c), rad = ph * 0.42, x = d - rad;
      h += sin(x * 60.0) * exp(-x * x * 160.0) * (1.0 - ph) * 0.05;
    }
  }
  return h;
}
vec3 sgn(vec3 R, float blur, float streak){
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec4 d = uSD[i]; if (d.z <= 0.0) continue;
    vec3 P = (uSI[i] * vec4(vW, 1.0)).xyz, Rl = (uSI[i] * vec4(R, 0.0)).xyz;
    if (abs(Rl.z) < 1e-4) continue;
    float t = -P.z / Rl.z; if (t <= 0.0) continue;
    vec3 H = P + t * Rl; vec2 uv = H.xy / (2.0 * d.xy) + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
    float lod = 0.5 + blur + log2(1.0 + t);
    int nn = streak > 0.0 ? 5 : 1; vec3 sum = vec3(0.0);
    for (int k = 0; k < 5; k++) {   // wet cobbles: the reflection is smeared along the sign's height (long streaks toward you)
      if (k >= nn) break; vec2 u2 = vec2(uv.x, uv.y + (nn == 1 ? 0.0 : (float(k) - 2.0) * streak * 0.1));
      vec4 s = i == 0 ? textureLod(uS0, u2, lod) : i == 1 ? textureLod(uS1, u2, lod) : i == 2 ? textureLod(uS2, u2, lod) : textureLod(uS3, u2, lod);
      sum += s.rgb * s.a;
    }
    acc += sum / float(nn) * d.z * (nn == 1 ? 4.0 : 6.5);
  }
  return acc;
}
// #482 a ground from texture maps: parallax + displacement-lit relief, damp / wet darkening, water pooling in the low parts, reflections of lamps and neon, lit by the 4 nearest lamps
vec4 surfColor(){
  vec2 e2 = min(vUv, 1.0 - vUv); float edge = smoothstep(0.0, 0.05, min(e2.x, e2.y)); if (edge < 0.003) discard;
  vec2 uv = vUv * uTile; float depthM = 0.04 * uDispAmt;
  vec3 lv = vec3(vLV.x * uWD.x, vLV.y * uWD.y, max(vLV.z, 0.08));
  if (uHasD > 0.5) uv -= clamp(lv.xy / lv.z, vec2(-3.0), vec2(3.0)) * (1.0 - texture2D(uDisp, uv).r) * depthM / uTileM;
  vec3 alb = uHasC > 0.5 ? texture2D(uDiff, uv).rgb : vec3(0.18);
  float h = uHasD > 0.5 ? texture2D(uDisp, uv).r : 0.5;
  float rg = uHasR > 0.5 ? texture2D(uRoughT, uv).r : 0.7, ao = uHasA > 0.5 ? texture2D(uAOT, uv).r : 1.0;
  vec2 tilt = vec2(0.0);
  if (uHasD > 0.5) { float te = 1.0 / 1024.0; tilt -= vec2(texture2D(uDisp, uv + vec2(te, 0.0)).r - texture2D(uDisp, uv - vec2(te, 0.0)).r, texture2D(uDisp, uv + vec2(0.0, te)).r - texture2D(uDisp, uv - vec2(0.0, te)).r) * depthM / (2.0 * te * uTileM); }
  if (uHasN > 0.5) { vec3 nt = texture2D(uNormT, uv).xyz * 2.0 - 1.0; tilt += nt.xy / max(nt.z, 0.3) * 0.6; }
  float wl = uWet * 0.5, wm = uHasD > 0.5 ? (1.0 - smoothstep(wl - 0.04, wl + 0.04, h)) * step(0.02, uWet) : 0.0;
  vec2 pr = vW.xz; float e = 0.01, h0 = height(pr), hx = height(pr + vec2(e, 0.0)), hy = height(pr + vec2(0.0, e));
  vec2 rt = vec2(-(hx - h0) / e, -(hy - h0) / e) * uRip * 0.35;
  vec3 N = normalize(vNn + (vTx * tilt.x + vTy * tilt.y) * (1.0 - wm) + vec3(rt.x, 0.0, rt.y) * wm);
  alb *= (1.0 - 0.45 * uWet) * (1.0 - 0.6 * wm);
  float r = mix(rg * (1.0 - 0.7 * uWet), 0.03, wm);
  vec3 Lt = vec3(0.55, 0.65, 0.9) * uAmb;
  for (int i = 0; i < 4; i++) { if (uLP[i].y < -50.0) continue; vec3 d = uLP[i].xyz - vW; float dd = dot(d, d); Lt += uLC[i] * (1.0 / (1.0 + dd * 0.25)) * (max(dot(N, normalize(d)), 0.0) * 0.85 + 0.15) * 4.0; }
  vec3 dif = alb * Lt * ao;
  vec3 V = normalize(vW - cameraPosition), R = reflect(V, N); R.y = max(abs(R.y), 0.03);
  float ndv = clamp(dot(N, -V), 0.0, 1.0), gloss = 1.0 - r, fr = (0.03 + 0.97 * pow(1.0 - ndv, 5.0)) * (0.25 + 0.75 * gloss) * 2.2;
  float dist = length(vW - cameraPosition), coc = uFocus.y > 0.0 ? min(6.0, uFocus.y * 10.0 * abs(dist - uFocus.x) / max(dist, 0.3)) : 0.0;
  vec3 sky = uSky * mix(1.6, 0.4, clamp(R.y * 1.5, 0.0, 1.0));
  vec3 refl = (sky + sgn(R, r * 6.0 + coc * 0.8 + length(N.xz) * 8.0, step(0.55, gloss))) * fr * uRefl * ao;
  refl += vec3(0.55, 0.65, 0.8) * max(h0, 0.0) * 1.4 * uRip * min(uRain, 1.5) * wm;
  return vec4((dif * uCover + refl) * edge, uCover * edge);
}
void main(){
  if (uSurf > 0.5) { gl_FragColor = surfColor();
  #include <colorspace_fragment>
  return; }
  vec2 muv = vUv * uTile; float m = texture2D(uMatte, muv).r; if (uInv > 0.5) m = 1.0 - m;
  float t = 1.0 - uWet;
  float mask = smoothstep(t - uSoft, t + uSoft + 0.001, m);
  vec2 e2 = min(vUv, 1.0 - vUv); float edge = smoothstep(0.0, 0.07, min(e2.x, e2.y));
  if (uCobble > 0.5) mask = max(mask, uWet * 0.9 * (0.6 + 0.8 * texture2D(uMatte, muv).g));   // stone tops are damp too, the joints hold the water
  mask *= edge; if (mask < 0.003) discard;
  vec2 p = vW.xz; float e = 0.01, h0 = height(p), hx = height(p + vec2(e, 0.0)), hy = height(p + vec2(0.0, e));
  vec2 bump = vec2(0.0); float rough = 1.0, jb = 0.0, isJoint = 0.0;
  if (uCobble > 0.5) {   // every stone is a little dome: its slope tilts the reflection; the tops are rougher than the joints
    float te = 1.0 / 512.0;
    bump = vec2(texture2D(uMatte, muv + vec2(te, 0.0)).r - texture2D(uMatte, muv - vec2(te, 0.0)).r, texture2D(uMatte, muv + vec2(0.0, te)).r - texture2D(uMatte, muv - vec2(0.0, te)).r) * uBump;
    isJoint = smoothstep(0.55, 0.92, m); rough = mix(1.0, 0.5, isJoint) * (0.72 + 0.55 * texture2D(uMatte, muv).g); jb = mix(1.6, 0.3, isJoint);   // polished, slightly soft stone tops; dark dirty joints; every stone wears differently
  }
  vec3 n = normalize(vec3(-(hx - h0) / e * uRip * 0.35 + bump.x, 1.0, -(hy - h0) / e * uRip * 0.35 + bump.y));
  vec3 V = normalize(vW - cameraPosition), R = reflect(V, n); R.y = max(abs(R.y), 0.03);
  float fr = (0.18 + 0.82 * pow(1.0 - clamp(dot(n, -V), 0.0, 1.0), 4.0)) * rough;
  float dist = length(vW - cameraPosition), coc = uFocus.y > 0.0 ? min(6.0, uFocus.y * 10.0 * abs(dist - uFocus.x) / max(dist, 0.3)) : 0.0;
  vec3 sky = uSky * mix(1.6, 0.4, clamp(R.y * 1.5, 0.0, 1.0));
  vec3 refl = (sky + sgn(R, length(n.xz) * 14.0 + coc * 0.8 + jb, uStreak)) * fr * uRefl;
  refl += uTint * 0.008 + vec3(0.55, 0.65, 0.8) * max(h0, 0.0) * 1.4 * uRip * min(uRain, 1.5);   // bright rim on the drop rings
  float a = min(1.0, mask * uDark + isJoint * 0.22);
  gl_FragColor = vec4(refl * mask, a);
  #include <colorspace_fragment>
}`;
const DUMMY = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); DUMMY.needsUpdate = true;

// ------------------------------------------------------------------ rain / fog shaders
const RAIN_V = `uniform vec3 uBox; uniform float uT, uSpeed, uLen, uWind, uA; attribute float aR; attribute float aEnd; varying float vA;
void main(){
  float fall = fract(position.y - uT * uSpeed / uBox.y * (0.75 + 0.5 * aR));
  vec3 p = vec3(position.x, fall, position.z) * uBox - vec3(uBox.x * 0.5, 0.0, uBox.z * 0.5);
  p.x += uWind * (1.0 - fall) * uBox.y * 0.25;
  p += vec3(uWind * 0.35, 1.0, 0.0) * uLen * aEnd;
  vA = (1.0 - aEnd) * uA * (0.5 + 0.5 * aR);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const RAIN_F = `uniform vec3 uCol; varying float vA; void main(){ gl_FragColor = vec4(uCol, vA);
  #include <colorspace_fragment>
}`;
const DEPTH_GLSL = `uniform sampler2DArray uDepth; uniform float uDOn; uniform float uDLayer; uniform mat4 uDView; uniform mat4 uDProj; uniform mat4 uDInvProj; uniform mat4 uDNorm;
float realGap(vec3 P) {   // as in laser.js (#413): > 0 = P lies behind the real surface on its depth-camera ray; -1000 = no depth there
  if (uDOn < 0.5) return -1e3;
  vec4 pv = uDView * vec4(P, 1.0); vec4 c = uDProj * pv; if (c.w <= 1e-4) return -1e3;
  vec3 n = c.xyz / c.w; if (abs(n.x) > 1.0 || abs(n.y) > 1.0) return -1e3;
  vec2 buf = (uDNorm * vec4(n.xy * 0.5 + 0.5, 0.0, 1.0)).xy;
  float d = min(textureLod(uDepth, vec3(buf, uDLayer), 0.0).r, 0.9999);
  if (d >= 0.9998) return -1e3;
  vec4 rv = uDInvProj * vec4(n.xy, d * 2.0 - 1.0, 1.0); rv.xyz /= rv.w;
  return length(pv.xyz) - length(rv.xyz);
}
`;
const FOG_V = `uniform vec3 uBox; uniform float uT, uSpeed, uSmoke, uSize; uniform vec4 uLP[4]; uniform vec3 uLC[4];
attribute vec3 aC; attribute vec3 aP; varying vec2 vUv; varying float vF; varying float vD; varying vec3 vL; varying vec3 vW;
void main(){
  float t = uT * uSpeed; vec3 c = aC;
  c.x += 0.07 * sin(t * 0.7 + aP.x * 6.28); c.z += 0.07 * cos(t * 0.6 + aP.y * 6.28);
  float fade = 1.0;
  if (uSmoke > 0.5) { c.y = fract(aC.y + t * 0.06 * (0.6 + aP.z)); fade = sin(3.14159 * c.y); } else { c.y = aC.y * 0.55; c.x += 0.05 * sin(t * 0.3 + aP.z * 9.0); }
  vec3 ctr = (c - vec3(0.5, 0.0, 0.5)) * uBox;
  vec3 wc = (modelMatrix * vec4(ctr, 1.0)).xyz, L = vec3(0.0);   // light from the nearest lamps / neon signs, falling off with distance
  for (int i = 0; i < 4; i++) { float d = length(wc - uLP[i].xyz) / max(uLP[i].w, 0.1); L += uLC[i] / (1.0 + d * d * 2.5); }
  vL = L;
  vec4 mv = modelViewMatrix * vec4(ctr, 1.0);
  float a = aP.x * 6.28 + t * 0.05 * (aP.z - 0.5), ca = cos(a), sa = sin(a);
  vec2 o = vec2(ca * position.x - sa * position.y, sa * position.x + ca * position.y) * uSize * (0.7 + 0.6 * aP.z);
  mv.xy += o; vUv = position.xy + 0.5; vF = fade; vD = -mv.z; vW = (inverse(viewMatrix) * mv).xyz;
  gl_Position = projectionMatrix * mv;
}`;
const FOG_F = DEPTH_GLSL + `uniform sampler2D uTex; uniform vec3 uCol; uniform float uDen, uAmb, uLit, uT, uFloor;
varying vec2 vUv; varying float vF; varying float vD; varying vec3 vL; varying vec3 vW;
void main(){
  vec4 s = texture2D(uTex, vUv);
  float lum = dot(vL, vec3(0.33)) * uLit;
  vec2 q = (vUv - 0.5) * 1.35; float ca = cos(1.1), sa = sin(1.1); q = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y) + 0.5 + vec2(uT * 0.004, -uT * 0.003);
  vec4 s2 = texture2D(uTex, q);   // a second, turned and larger look at the same puff: breaks up the flat card
  float a = s.a * mix(0.55, 1.25, s2.a) * uDen * vF * smoothstep(0.15, 0.9, vD) * (1.0 + 0.7 * lum);
  a *= smoothstep(0.0, 0.3, vW.y - uFloor);   // tapers off before it meets the ground instead of cutting along it
  float g = realGap(vW); if (g > -900.0) a *= smoothstep(0.0, 0.4, -g);   // soft against real walls, people, hands: fog sits in the room instead of through it
  gl_FragColor = vec4(uCol * uAmb * (0.85 + 0.15 * s.r) + vL * uLit * (0.6 + 0.4 * uCol), min(a, 0.9));
  #include <colorspace_fragment>
}`;
let cloudTex = null;
function cloud() {   // a soft round puff with cloudy noise inside and no edge at all (it is gone well before the quad ends)
  if (cloudTex) return cloudTex;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), im = g.createImageData(S, S), TAU = Math.PI * 2;
  const ph = [0.7, 2.1, 4.3, 5.9, 1.2, 3.3];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x / S - 0.5) * 2, v = (y / S - 0.5) * 2, r2 = u * u + v * v;
    const n = 0.5 + 0.25 * Math.sin(u * 5.1 + ph[0]) * Math.cos(v * 4.3 + ph[1]) + 0.15 * Math.sin(u * 11 + v * 7 + ph[2]) + 0.1 * Math.cos(u * 17 - v * 13 + ph[3]) * Math.sin(v * 9 + ph[4]);
    const fall = Math.max(0, 1 - r2), a = Math.pow(fall, 2.2) * (0.35 + 0.9 * n), i = (y * S + x) * 4;
    im.data[i] = 150 + 105 * n; im.data[i + 1] = im.data[i] ; im.data[i + 2] = im.data[i]; im.data[i + 3] = Math.min(255, a * 255);
  }
  g.putImageData(im, 0, 0); cloudTex = new THREE.CanvasTexture(c); cloudTex.colorSpace = THREE.SRGBColorSpace; return cloudTex;
}

// ------------------------------------------------------------------ base prop (the interface xr.js drives: obj, hit, grab, hold, release, scaleTo, corner / knob)
class Prop {
  constructor(mp, type, floor) {
    this.mp = mp; this.type = type; this.floor = floor; this.held = false; this.t = Math.random() * 10; this.dead = false;
    const g = this.obj = new THREE.Group(); g.name = 'movieprop_' + type; mp.rig.add(g);
    this.ringAt = new THREE.Vector3(); this.cubeAt = new THREE.Vector3();
    this.ring = new THREE.Group(); this.torus = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 10, 32), new THREE.MeshBasicMaterial({ color: 0x39a8ff, toneMapped: false })); this.ring.add(this.torus);
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.035), new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.3, metalness: 0.8 }));
    this.handles = new THREE.Group(); this.handles.add(this.ring, this.cube); g.add(this.handles);
    if (floor) {   // posts like the WATER's
      const pm = new THREE.MeshBasicMaterial({ color: 0x39a8ff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
      const stick = () => { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, POST_H, 6), pm); s.position.y = -POST_H / 2; return s; };
      this.ring.add(stick()); this.cube.add(stick()); this.torus.rotation.x = Math.PI / 2;
    }
    userOnly(this.handles);
  }
  placeHandles() {
    const s = this.floor ? 1 : 1 / Math.max(1e-3, this.obj.scale.x);
    this.ring.position.copy(this.ringAt); this.cube.position.copy(this.cubeAt); this.ring.scale.setScalar(s); this.cube.scale.setScalar(s);
  }
  wp(o, out) { o.updateWorldMatrix(true, false); return o.getWorldPosition(out); }
  hit(P) { return this.wp(this.ring, _v).distanceTo(P) < 0.07; }
  grab() { this.held = true; this.mp.select(this); }
  hold(world) {
    const rig = this.mp.rig; rig.updateMatrixWorld(); _m.copy(rig.matrixWorld).invert().multiply(world); _m.decompose(_p, _q, _s);
    if (this.floor) {   // stays level: keep the yaw, put the ring where the hand carries it
      _e.setFromQuaternion(_q, 'YXZ'); const yaw = _e.y; _v2.copy(this.ringAt).applyMatrix4(_m);
      _v.copy(this.ringAt).applyAxisAngle(YAX, yaw);
      this.obj.position.set(_v2.x - _v.x, clamp(_v2.y - _v.y, -0.3, 2), _v2.z - _v.z); this.obj.rotation.set(0, yaw, 0);
    } else { this.obj.position.copy(_p); this.obj.quaternion.copy(_q); }
  }
  release() { this.held = false; this.mp.save(); }
  corner(P) { return this.wp(this.cube, _v).distanceTo(P) < 0.06; }
  scaleTo(s) { const k = clamp(s, 0.05, 20); this.obj.scale.setScalar(k); this.placeHandles(); this.mp.save(); }
  save() { this.mp.save(); }
  dispose() { this.dead = true; this.obj.parent && this.obj.parent.remove(this.obj); this.obj.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  resize(k) { this.scaleTo(this.obj.scale.x * k); }
  tick() {}
  localBox() { const t = 0.04 / Math.max(this.obj.scale.x, 1e-3); return _bx.set(_v.set(-(this.hw || 0.1), -(this.hh || 0.1), -t), _v2.set(this.hw || 0.1, this.hh || 0.1, t)); }   // the box the placement laser aims at (obj-local)
  rayT(o, d) {   // distance along a world ray to the box (-1: none, or the ray starts inside it)
    const b = this.localBox().clone(); this.obj.updateWorldMatrix(true, false); _inv.copy(this.obj.matrixWorld).invert();
    _r.origin.copy(o).applyMatrix4(_inv); _p.copy(o).add(d).applyMatrix4(_inv).sub(_r.origin); const L = _p.length(); if (L < 1e-9) return -1; _r.direction.copy(_p).divideScalar(L);
    if (b.containsPoint(_r.origin)) return -1; const h = _r.intersectBox(b, _p); return h ? _r.origin.distanceTo(h) / L : -1;
  }
  base() { const o = this.obj; return { type: this.type, p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.x }; }
  setBase(d) { if (d.p) this.obj.position.fromArray(d.p); if (d.q) this.obj.quaternion.fromArray(d.q); if (d.s) this.obj.scale.setScalar(d.s); this.placeHandles(); }
  snap() { return this.base(); }
}

// floor props: a box of w x d (x h), sized by the cube knob (like the WATER)
class BoxProp extends Prop {
  constructor(mp, type) { super(mp, type, true); this.w = 3; this.d = 3; this.h = 2; }
  layout() { this.ringAt.set(0, POST_H, this.d / 2); this.cubeAt.set(this.w / 2, POST_H, this.d / 2); this.placeHandles(); this.onSize && this.onSize(); }
  setSize(w, d) { this.w = clamp(w, 0.3, 14); this.d = clamp(d, 0.3, 14); this.layout(); }
  localBox() { return _bx.set(_v.set(-this.w / 2, this.type === 'puddle' ? -0.05 : -0.08, -this.d / 2), _v2.set(this.w / 2, this.type === 'puddle' ? 0.05 : 0, this.d / 2)); }   // rain / fog: only the ground footprint is aimed at (a puddle inside it wins)
  knob(P) { return this.wp(this.cube, _v).distanceTo(P) < 0.05; }
  knobMove(P) { this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P)); this.setSize(Math.abs(l.x) * 2, Math.abs(l.z) * 2); }
  knobEnd() { this.mp.save(); }
  corner() { return false; }
  scaleTo() {}
  resize(k) { this.setSize(this.w * k, this.d * k); this.mp.save(); }
}

class Puddle extends BoxProp {
  constructor(mp) {
    super(mp, 'puddle'); this.matte = 'SCATTERED'; this.wet = 0.5; this.soft = 0.06; this.rip = 0.8; this.rain = 0.6; this.refl = 1; this.inv = false; this.dark = 0.6; this.stone = 0.8; this.surf = ''; this.cover = 1; this.amb = 0.12; this.sdirty = true;
    this.U = {
      uMatte: { value: DUMMY }, uS0: { value: DUMMY }, uS1: { value: DUMMY }, uS2: { value: DUMMY }, uS3: { value: DUMMY }, uWet: { value: 0.5 }, uSoft: { value: 0.06 }, uInv: { value: 0 }, uRip: { value: 0.8 }, uRain: { value: 0.6 },
      uRefl: { value: 1 }, uT: { value: 0 }, uDark: { value: 0.55 }, uSize: { value: 3 }, uCobble: { value: 0 }, uStreak: { value: 0 }, uBump: { value: 1.1 }, uTile: { value: new THREE.Vector2(1, 1) }, uSurf: { value: 0 }, uTileM: { value: 1 }, uDispAmt: { value: 1 }, uCover: { value: 1 }, uAmb: { value: 0.12 }, uHasD: { value: 0 }, uHasR: { value: 0 }, uHasN: { value: 0 }, uHasA: { value: 0 }, uHasC: { value: 0 }, uDiff: { value: DUMMY }, uDisp: { value: DUMMY }, uRoughT: { value: DUMMY }, uNormT: { value: DUMMY }, uAOT: { value: DUMMY }, uWD: { value: new THREE.Vector2(1, 1) }, uLP: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -99, 0, 1)) }, uLC: { value: [0, 1, 2, 3].map(() => new THREE.Color()) }, uFocus: { value: new THREE.Vector2(3, 0) }, uSky: { value: new THREE.Color(0.014, 0.02, 0.032) }, uTint: { value: new THREE.Color(0.1, 0.5, 0.6) },
      uSI: { value: [0, 1, 2, 3].map(() => new THREE.Matrix4()) }, uSD: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
    };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: PUD_V, fragmentShader: PUD_F, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat); m.rotation.x = -Math.PI / 2; m.renderOrder = 2; m.frustumCulled = false; noRay(m); this.obj.add(m);
    this.onSize = () => { this.mesh.scale.set(this.w, this.d, 1); this.U.uSize.value = Math.max(this.w, this.d); };
    this.layout(); this.setMatte(this.matte);
  }
  setMatte(name) { this.matte = name; this.U.uMatte.value = this.mp.matteTex(name, () => { this.U.uMatte.value = this.mp.matteTex(name); }); this.save(); }
  setSurface(name) { this.surf = name || ''; this.sdirty = true; this.save(); }
  surfSync() {   // (re)bind the maps of the chosen surface; maps still loading come in through the callback
    this.sdirty = false; const U = this.U, S = this.mp.surfaces.get(this.surf); if (!S) { U.uSurf.value = 0; return; }
    U.uSurf.value = 1; U.uTileM.value = S.tile; U.uDispAmt.value = S.disp;
    const bind = (slot, tu, hf) => { const t = this.mp.surfTex(this.surf, slot, () => { this.sdirty = true; }); U[tu].value = t || DUMMY; U[hf].value = t ? 1 : 0; };
    bind('diff', 'uDiff', 'uHasC'); bind('disp', 'uDisp', 'uHasD'); bind('rough', 'uRoughT', 'uHasR'); bind('nor', 'uNormT', 'uHasN'); bind('ao', 'uAOT', 'uHasA');
  }
  tick(dt) {
    const U = this.U; this.t += dt; U.uT.value = this.t; U.uWet.value = this.wet; U.uSoft.value = this.soft; U.uInv.value = this.inv ? 1 : 0; U.uRip.value = this.rip; U.uRain.value = this.rain; U.uRefl.value = this.refl; U.uDark.value = this.dark;
    if (this.sdirty) this.surfSync();
    if (U.uSurf.value > 0.5) {
      U.uCover.value = this.cover; U.uAmb.value = this.amb; U.uWD.value.set(this.w, this.d); U.uTile.value.set(this.w / U.uTileM.value, this.d / U.uTileM.value);
      const Lx = this.mp.neonsNear(_v.setFromMatrixPosition(this.obj.matrixWorld), 4);
      for (let i = 0; i < 4; i++) { const n = Lx[i]; if (n) { const li = n.light(); U.uLP.value[i].set(li.pos.x, li.pos.y, li.pos.z, li.r); U.uLC.value[i].set(li.col.r, li.col.g, li.col.b).multiplyScalar(li.k * 0.5); } else U.uLP.value[i].set(0, -99, 0, 1); }
    }
    const cob = this.matte === 'COBBLES' && !this.surf; U.uCobble.value = cob ? 1 : 0; U.uStreak.value = cob ? 1 : 0; if (U.uSurf.value < 0.5) U.uTile.value.set(cob ? this.w / (0.9 * this.stone) : 1, cob ? this.d / (0.9 * this.stone) : 1);
    U.uFocus.value.set(this.mp.focus.dist, this.mp.focus.on ? this.mp.focus.ap : 0);
    this.obj.updateWorldMatrix(true, false); _v.setFromMatrixPosition(this.obj.matrixWorld);
    const list = this.mp.neonsNear(_v, 4);
    for (let i = 0; i < 4; i++) {
      const n = list[i], d = U.uSD.value[i];
      if (n) { const r = n.refObj(), hh = n.refHalf(); r.updateWorldMatrix(true, false); U.uSI.value[i].copy(r.matrixWorld).invert(); d.set(hh[0], hh[1], n.lit(), 0); U['uS' + i].value = n.tex; } else { d.set(0, 0, 0, 0); U['uS' + i].value = DUMMY; }
    }
  }
  snap() { return { ...this.base(), w: this.w, d: this.d, matte: this.matte, wet: this.wet, rip: this.rip, rain: this.rain, refl: this.refl, inv: this.inv, soft: this.soft, dark: this.dark, stone: this.stone, surf: this.surf, cover: this.cover, amb: this.amb }; }
  apply(d) { for (const k of ['wet', 'rip', 'rain', 'refl', 'inv', 'soft', 'dark', 'stone', 'cover', 'amb']) if (d[k] !== undefined) this[k] = d[k]; this.setBase(d); this.setSize(d.w || 3, d.d || 3); if (d.matte) this.setMatte(d.matte); if (d.surf) this.setSurface(d.surf); }
}

class Rain extends BoxProp {
  constructor(mp) {
    super(mp, 'rain'); this.w = 4; this.d = 4; this.h = 3; this.amt = 0.3; this.speed = 7; this.len = 0.5; this.wind = 0.1;
    const N = 6000, pos = new Float32Array(N * 6), aR = new Float32Array(N * 2), aE = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { const x = Math.random(), y = Math.random(), z = Math.random(), r = Math.random(); for (let k = 0; k < 2; k++) { pos.set([x, y, z], (i * 2 + k) * 3); aR[i * 2 + k] = r; aE[i * 2 + k] = k; } }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aR', new THREE.BufferAttribute(aR, 1)); geo.setAttribute('aEnd', new THREE.BufferAttribute(aE, 1));
    this.U = { uBox: { value: new THREE.Vector3(4, 3, 4) }, uT: { value: 0 }, uSpeed: { value: 7 }, uLen: { value: 0.5 }, uWind: { value: 0.1 }, uA: { value: 0.4 }, uCol: { value: new THREE.Color(0.75, 0.85, 1) } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: RAIN_V, fragmentShader: RAIN_F, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    this.lines = new THREE.LineSegments(geo, this.mat); this.lines.frustumCulled = false; noRay(this.lines); this.obj.add(this.lines);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x39a8ff, transparent: true, opacity: 0.35, toneMapped: false }));
    this.edge = edge; this.obj.add(edge); userOnly(edge);
    this.onSize = () => { this.U.uBox.value.set(this.w, this.h, this.d); this.edge.scale.set(this.w, this.h, this.d); this.edge.position.y = this.h / 2; };
    this.layout();
  }
  tick(dt) { const U = this.U; this.t += dt; U.uT.value = this.t; U.uSpeed.value = this.speed; U.uLen.value = this.len; U.uWind.value = this.wind; this.lines.geometry.setDrawRange(0, Math.max(2, Math.round(this.amt * 6000)) * 2); this.U.uBox.value.set(this.w, this.h, this.d); }
  snap() { return { ...this.base(), w: this.w, d: this.d, h: this.h, amt: this.amt, speed: this.speed, len: this.len, wind: this.wind }; }
  apply(d) { for (const k of ['amt', 'speed', 'len', 'wind', 'h']) if (d[k] !== undefined) this[k] = d[k]; this.setBase(d); this.setSize(d.w || 4, d.d || 4); }
}

class Fog extends BoxProp {
  constructor(mp) {
    super(mp, 'fog'); this.w = 4; this.d = 4; this.h = 2.5; this.den = 0.4; this.smoke = false; this.col = 0; this.speed = 1; this.amb = 0.3; this.lit = 1; this.dep = true;
    const N = 90, base = new THREE.PlaneGeometry(1, 1), geo = new THREE.InstancedBufferGeometry(); geo.index = base.index; geo.setAttribute('position', base.attributes.position); geo.instanceCount = N;
    const aC = new Float32Array(N * 3), aP = new Float32Array(N * 3); for (let i = 0; i < N * 3; i++) { aC[i] = i % 3 === 1 ? Math.random() : (Math.random() + Math.random()) / 2; aP[i] = Math.random(); }   // x / z crowd toward the middle: no visible box edge
    geo.setAttribute('aC', new THREE.InstancedBufferAttribute(aC, 3)); geo.setAttribute('aP', new THREE.InstancedBufferAttribute(aP, 3));
    this.U = { uBox: { value: new THREE.Vector3(4, 2.5, 4) }, uT: { value: 0 }, uSpeed: { value: 1 }, uSmoke: { value: 0 }, uSize: { value: 2 }, uTex: { value: cloud() }, uCol: { value: new THREE.Color(FOG_COLORS[0][1]) }, uDen: { value: 0.5 }, uAmb: { value: 0.5 }, uLit: { value: 1 }, uFloor: { value: 0 }, uLP: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -99, 0, 1)) }, uLC: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
      uDepth: { value: null }, uDOn: { value: 0 }, uDLayer: { value: 0 }, uDView: { value: new THREE.Matrix4() }, uDProj: { value: new THREE.Matrix4() }, uDInvProj: { value: new THREE.Matrix4() }, uDNorm: { value: new THREE.Matrix4() } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: FOG_V, fragmentShader: FOG_F, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; this.mat.uniforms.uT = this.U.uT; noRay(this.mesh); this.obj.add(this.mesh);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x39a8ff, transparent: true, opacity: 0.35, toneMapped: false }));
    this.edge = edge; this.obj.add(edge); userOnly(edge);
    this.onSize = () => { this.edge.scale.set(this.w, this.h, this.d); this.edge.position.y = this.h / 2; };
    this.layout();
  }
  tick(dt) {
    const U = this.U; this.t += dt; U.uT.value = this.t; U.uSpeed.value = this.speed; U.uSmoke.value = this.smoke ? 1 : 0; U.uDen.value = this.den * 0.9; U.uCol.value.set(FOG_COLORS[this.col % FOG_COLORS.length][1]); U.uAmb.value = this.amb; U.uLit.value = this.lit; U.uFloor.value = this.obj.getWorldPosition(_v2).y - 0.02;
    this.obj.updateWorldMatrix(true, false); _v.setFromMatrixPosition(this.obj.matrixWorld); _v.y += this.h * 0.3;
    const L = this.mp.neonsNear(_v, 4);
    for (let i = 0; i < 4; i++) { const n = L[i]; if (n) { const li = n.light(); U.uLP.value[i].set(li.pos.x, li.pos.y, li.pos.z, li.r); U.uLC.value[i].set(li.col.r, li.col.g, li.col.b).multiplyScalar(li.k * 0.5); } else { U.uLP.value[i].set(0, -99, 0, 1); U.uLC.value[i].set(0, 0, 0); } }
    const D = this.dep ? this.mp.depth : null; U.uDOn.value = D ? 1 : 0;
    if (D) { U.uDepth.value = D.tex; U.uDLayer.value = D.layer; U.uDView.value.copy(D.view); U.uDProj.value.copy(D.proj); U.uDInvProj.value.copy(D.invProj); U.uDNorm.value.copy(D.norm); }
    U.uBox.value.set(this.w, this.h, this.d); U.uSize.value = clamp(0.22 * Math.max(this.w, this.d) + 0.4, 0.6, 2.4);
  }
  snap() { return { ...this.base(), w: this.w, d: this.d, h: this.h, den: this.den, smoke: this.smoke, col: this.col, speed: this.speed, amb: this.amb, lit: this.lit, dep: this.dep }; }
  apply(d) { for (const k of ['den', 'smoke', 'col', 'speed', 'h', 'amb', 'lit', 'dep']) if (d[k] !== undefined) this[k] = d[k]; this.setBase(d); this.setSize(d.w || 4, d.d || 4); }
}

// wall props: a flat card (neon, graffiti) or a model, sized as a whole by the cube
class NeonSign extends Prop {
  constructor(mp) {
    super(mp, 'neon', false); this.text = 'DIRRO DJ'; this.font = 0; this.vert = false; this.col = 0; this.frame = false; this.flick = 0.3; this.glow = 1; this.hw = 0.5; this.hh = 0.15; this.tex = DUMMY; this.fl = 1; this.seq = 0;
    this.mat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, opacity: 1 }); this.bias = biasMat(this.mat);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat); this.mesh.renderOrder = 4; noRay(this.mesh); this.obj.add(this.mesh);
    mp.neons.push(this); this.mesh.visible = false; this.render();
  }
  async render() {
    const my = ++this.seq, r = await renderNeon(this.text, this.font, this.vert, COLORS[this.col % COLORS.length][1], this.frame);
    if (my !== this.seq || this.dead) return;
    const t = new THREE.CanvasTexture(r.canvas); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4;
    const old = this.tex; this.tex = t; this.mat.map = t; this.mat.needsUpdate = true; if (old && old !== DUMMY) old.dispose();
    this.hw = r.canvas.width * r.unit / 2; this.hh = r.canvas.height * r.unit / 2; this.mesh.scale.set(this.hw * 2, this.hh * 2, 1); this.mesh.visible = true;
    this.ringAt.set(-this.hw - 0.07, -this.hh - 0.07, 0); this.cubeAt.set(this.hw + 0.07, this.hh + 0.07, 0); this.placeHandles();
  }
  set(k, v) { this[k] = v; if (['text', 'font', 'vert', 'col', 'frame'].includes(k)) this.render(); this.save(); }
  lit() { return this.mesh.visible ? this.fl * this.glow : 0; }
  refObj() { return this.obj; }
  refHalf() { return [this.hw, this.hh]; }
  light() { this.obj.updateWorldMatrix(true, false); return { pos: _v3.setFromMatrixPosition(this.obj.matrixWorld).clone(), r: Math.max(this.hw, this.hh) * this.obj.scale.x * 4 + 0.5, col: new THREE.Color(COLORS[this.col % COLORS.length][1]), k: this.lit() * 0.9 }; }
  tick(dt) {
    this.t += dt;
    if (this.flick > 0) {   // buzzing tube: now and then a short dip, a stutter
      const r = Math.sin(this.t * 37) * Math.sin(this.t * 11.3 + 1.7), dip = r > 0.93 - this.flick * 0.12 ? 0.35 : 1; this.fl += (dip - this.fl) * Math.min(1, dt * 40);
    } else this.fl = 1;
    this.mat.opacity = clamp(this.fl * (0.55 + 0.45 * this.glow), 0, 1.5); this.bias.value = this.mp.cocFor(this.obj);
  }
  dispose() { const i = this.mp.neons.indexOf(this); if (i >= 0) this.mp.neons.splice(i, 1); super.dispose(); }
  snap() { return { ...this.base(), text: this.text, font: this.font, vert: this.vert, col: this.col, frame: this.frame, flick: this.flick, glow: this.glow }; }
  apply(d) { for (const k of ['text', 'font', 'vert', 'col', 'frame', 'flick', 'glow']) if (d[k] !== undefined) this[k] = d[k]; this.setBase(d); this.render(); }
}

class Lamp extends Prop {   // a warm glow (street lamp, window, bulb): a halo card that always faces the viewer, lights the fog and is reflected in the wet ground
  constructor(mp) {
    super(mp, 'lamp', false); this.col = 2; this.bright = 1; this.flick = 0; this.size = 0.7; this.fl = 1; this.tex = DUMMY; this.hw = this.hh = 0.35;
    this.mat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }); this.mat.fog = false;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat); this.mesh.renderOrder = 4; noRay(this.mesh); this.obj.add(this.mesh);
    mp.neons.push(this); this.paint(); this.ringAt.set(-0.45, -0.45, 0); this.cubeAt.set(0.45, 0.45, 0); this.placeHandles();
  }
  paint() {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), col = COLORS[this.col % COLORS.length][1], gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.07, mix(col, 0.8)); gr.addColorStop(0.22, col); gr.addColorStop(0.5, col + '55'); gr.addColorStop(1, col + '00'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; const old = this.tex; this.tex = t; this.mat.map = t; this.mat.needsUpdate = true; if (old && old !== DUMMY) old.dispose();
  }
  set(k, v) { this[k] = v; if (k === 'col') this.paint(); this.save(); }
  lit() { return this.bright * this.fl * 0.6; }
  refObj() { return this.mesh; }
  refHalf() { return [0.5, 0.5]; }
  light() { this.obj.updateWorldMatrix(true, false); return { pos: _v3.setFromMatrixPosition(this.obj.matrixWorld).clone(), r: this.size * this.obj.scale.x * 5 + 0.5, col: new THREE.Color(COLORS[this.col % COLORS.length][1]), k: this.bright * this.fl * 1.3 }; }
  tick(dt) {
    this.t += dt;
    if (this.flick > 0) { const r = Math.sin(this.t * 31) * Math.sin(this.t * 9.7 + 0.6), dip = r > 0.9 - this.flick * 0.1 ? 0.4 : 1; this.fl += (dip - this.fl) * Math.min(1, dt * 30); } else this.fl = 1;
    const coc = this.mp.cocFor(this.obj), sz = this.size * (1 + coc * 0.32);   // out of focus: a bigger, fainter disc (bokeh)
    this.mesh.scale.set(sz, sz, 1); this.mat.opacity = clamp(this.bright * this.fl / (1 + coc * 0.45), 0, 2);
    const cam = this.mp.viewCam(); cam.updateMatrixWorld(); this.obj.updateWorldMatrix(true, false);
    cam.getWorldQuaternion(_q2); this.obj.getWorldQuaternion(_q); this.mesh.quaternion.copy(_q.invert().multiply(_q2));   // always faces the viewer
  }
  dispose() { const i = this.mp.neons.indexOf(this); if (i >= 0) this.mp.neons.splice(i, 1); super.dispose(); }
  snap() { return { ...this.base(), col: this.col, bright: this.bright, flick: this.flick, size: this.size }; }
  apply(d) { for (const k of ['col', 'bright', 'flick', 'size']) if (d[k] !== undefined) this[k] = d[k]; this.setBase(d); this.paint(); }
}

class Graffiti extends Prop {
  constructor(mp) {
    super(mp, 'graffiti', false); this.src = 'graff1.png'; this.tint = 1; this.bright = 1; this.opac = 1; this.glow = false; this.hw = 0.5; this.hh = 0.5; this.seq = 0;
    this.mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }); this.bias = biasMat(this.mat);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat); this.mesh.renderOrder = 3; noRay(this.mesh); this.obj.add(this.mesh); this.mesh.visible = false; this.load();
  }
  async load() {
    const my = ++this.seq; let url = null, blobUrl = null;
    if (GRAFF_BUILTIN.includes(this.src)) url = './graff/' + this.src; else { const f = await getFile('png', this.src); if (!f) { this.mp.env.toast('Graffiti picture "' + this.src + '" is not in this device\'s storage', 3000); return; } url = blobUrl = URL.createObjectURL(f); }
    let bmp; try { bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); } catch (e) { return; } finally { if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 4000); }
    if (my !== this.seq || this.dead) return;
    const c = document.createElement('canvas'), W = bmp.naturalWidth || bmp.width, H = bmp.naturalHeight || bmp.height, k = Math.min(1, 2048 / Math.max(W, H)); c.width = Math.round(W * k); c.height = Math.round(H * k);
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, c.width, c.height);
    const tc = GRAFF_TINTS[this.tint % GRAFF_TINTS.length][1];
    if (tc) { g.globalCompositeOperation = 'source-in'; g.fillStyle = tc; g.fillRect(0, 0, c.width, c.height); }   // colour all that is drawn, keep its edges
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; const old = this.mat.map; this.mat.map = t; this.mat.needsUpdate = true; if (old) old.dispose();
    const asp = c.width / c.height, h = 1, w = asp; this.hw = w / 2; this.hh = h / 2; this.mesh.scale.set(w, h, 1); this.mesh.visible = true;
    this.ringAt.set(-this.hw - 0.07, -this.hh - 0.07, 0); this.cubeAt.set(this.hw + 0.07, this.hh + 0.07, 0); this.placeHandles(); this.look();
  }
  tick() { this.bias.value = this.mp.cocFor(this.obj); }
  look() { const m = this.mat; m.blending = this.glow ? THREE.AdditiveBlending : THREE.NormalBlending; m.opacity = clamp(this.opac, 0, 1); m.color.setScalar(this.bright); m.needsUpdate = true; }
  set(k, v) { this[k] = v; if (k === 'src') this.tint = v === 'graff1.png' ? 1 : 0; if (k === 'src' || k === 'tint') this.load(); else this.look(); this.save(); }
  snap() { return { ...this.base(), src: this.src, tint: this.tint, bright: this.bright, opac: this.opac, glow: this.glow }; }
  apply(d) { for (const k of ['src', 'tint', 'bright', 'opac', 'glow']) if (d[k] !== undefined) this[k] = d[k]; this.setBase(d); this.load(); }
}

class GlbProp extends Prop {
  constructor(mp) { super(mp, 'glb', false); this.src = ''; this.hw = 0.3; this.state = 'empty'; }
  async load(name) {
    this.src = name; this.state = 'loading'; const bi = GLB_BUILTIN[name]; let f = null;
    if (bi) { try { f = await (await fetch(bi)).blob(); } catch {} } else f = await getFile('glb', name);
    if (!f) { this.state = 'missing'; this.mp.env.toast('Model "' + name + '" is not in this device\'s storage', 3000); return; }
    try {
      const gltf = await new GLTFLoader().parseAsync(await f.arrayBuffer(), ''); if (this.dead) return;
      const root = gltf.scene, box = new THREE.Box3().setFromObject(root), sz = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
      const k = GLB_BUILTIN[name] ? 1 : 1.2 / Math.max(sz.x, sz.y, sz.z, 1e-3), inner = new THREE.Group(); inner.add(root); root.position.set(-ctr.x, -box.min.y, -ctr.z); inner.scale.setScalar(k); noRay(inner);
      inner.traverse(o => { if (o.isMesh) { o.frustumCulled = false; } });
      if (this.inner) this.obj.remove(this.inner); this.inner = inner; this.obj.add(inner);
      const hx = sz.x * k / 2 + 0.08, hz = sz.z * k / 2 + 0.08; this.ringAt.set(hx, 0.04, hz); this.cubeAt.set(-hx, sz.y * k + 0.04, -hz); this.box = new THREE.Box3(new THREE.Vector3(-sz.x * k / 2, 0, -sz.z * k / 2), new THREE.Vector3(sz.x * k / 2, sz.y * k, sz.z * k / 2)); this.state = 'ok'; this.placeHandles();
    } catch (e) { console.warn('glb prop', e); this.state = 'failed'; this.mp.env.toast('That GLB could not be read (compressed formats other than plain / KTX2 are not supported)', 4000); }
  }
  localBox() { return this.box || super.localBox(); }
  snap() { return { ...this.base(), src: this.src }; }
  apply(d) { this.setBase(d); if (d.src) this.load(d.src); }
}


// ------------------------------------------------------------------ #479 the placement laser: B on the right controller turns a beam on / off.
// Aim at a prop (its box lights up), squeeze the trigger to take hold of it, let go to put it down.
//   while held:  the hand carries it along the beam (floor props slide along the floor where the beam lands, and stay level)
//                thumbstick back / forward  = pull it closer / push it away
//                thumbstick left / right    = turn it
//                grip + thumbstick up / down = bigger / smaller
// DJ-only (USER_LAYER) like the other handles; switch it off with B again before recording.
class Placer {
  constructor(mp) {
    this.mp = mp; this.on = false; this.base = 1; this.pull = 0; this.held = null; this.hover = null; this.bWas = false; this.trigWas = false;
    const g = this.g = new THREE.Group(); g.name = 'placerLaser'; g.visible = false;
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0x39d0ff, transparent: true, opacity: 0.85, toneMapped: false });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 1, 6), this.beamMat); g.add(this.beam);
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), this.beamMat); g.add(this.dot);
    this.hl = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x39d0ff, toneMapped: false })); this.hl.visible = false;
    userOnly(g); userOnly(this.hl);
    this.o = new THREE.Vector3(); this.d = new THREE.Vector3(); this.rm = new THREE.Matrix4(); this.off = new THREE.Matrix4(); this.q0 = new THREE.Quaternion(); this.yawAdd = 0; this.lat = new THREE.Vector3();
  }
  attach(scene) { if (!this.g.parent) scene.add(this.g); }
  active(st) { return this.on && st.source && st.source.handedness === 'right'; }
  toggle(on = !this.on) {
    this.on = on; this.g.visible = on; if (!on) { this.drop(); this.setHover(null); }
    this.mp.env.toast(on ? 'PLACEMENT LASER on: aim at a prop, trigger to take hold. Thumbstick: back / forward = closer / away, left / right = turn, grip + up / down = size. B = off.' : 'Placement laser off', on ? 5200 : 1500);
    this.mp.listCb && this.mp.listCb();
  }
  setHover(p) {
    if (this.hover === p) return; this.hover = p; const h = this.hl;
    if (h.parent) h.parent.remove(h);
    if (p) { p.obj.add(h); const b = p.localBox().clone(), sz = b.getSize(_v2), c = b.getCenter(_v); h.position.copy(c); h.scale.set(Math.max(sz.x, 0.02), Math.max(sz.y, 0.02), Math.max(sz.z, 0.02)); h.visible = true; } else h.visible = false;
  }
  pick(o, d) {
    let best = null, bt = 1e9;
    for (const p of this.mp.props()) { const t = p.rayT(o, d); if (t > 0 && t < bt) { bt = t; best = p; } }
    return best ? { p: best, t: bt } : null;
  }
  grab(p, t, ray) {
    this.held = p; p.held = true; this.mp.select(p); this.yawAdd = 0; this.hl.material.color.set(0xffa030); this.beamMat.color.set(0xffa030);
    p.obj.updateWorldMatrix(true, false); p.obj.matrixWorld.decompose(_p, this.q0, _s);
    this.off.copy(this.rm).invert().multiply(p.obj.matrixWorld);   // the prop in the beam's own space (lever arm included)
    if (p.floor) {
      this.y0 = _p.y; const dy = this.d.y, hz = Math.hypot(this.d.x, this.d.z) || 1; let base;
      if (dy < -0.04) { const tt = (this.y0 - this.o.y) / dy; base = Math.hypot(this.d.x * tt, this.d.z * tt); } else base = Math.hypot(_p.x - this.o.x, _p.z - this.o.z);
      this.base = base; this.pull = 0; this.lat.set(_p.x - (this.o.x + this.d.x / hz * base), 0, _p.z - (this.o.z + this.d.z / hz * base));
    }
  }
  drop() { const p = this.held; if (!p) return; this.held = null; p.held = false; p.mp.save(); this.hl.material.color.set(0x39d0ff); this.beamMat.color.set(0x39d0ff); }
  step(st, dt, buzz) {
    const gp = st.source && st.source.gamepad; if (!gp || !gp.buttons) return;
    const b = gp.buttons[5], bp = !!(b && b.pressed); if (bp && !this.bWas) { this.toggle(); buzz(st, 0.4, 30); } this.bWas = bp;
    if (!this.on) return;
    st.ray.updateMatrixWorld(); this.rm.copy(st.ray.matrixWorld); this.o.setFromMatrixPosition(this.rm); this.d.set(0, 0, -1).transformDirection(this.rm);
    const tr = gp.buttons[0] && gp.buttons[0].value > 0.6, grip = !!(gp.buttons[1] && gp.buttons[1].pressed);
    let len = 6, hit = null;
    if (!this.held) {
      hit = this.pick(this.o, this.d); this.setHover(hit ? hit.p : null); if (hit) len = hit.t;
      if (tr && !this.trigWas && hit) { this.grab(hit.p, hit.t, st.ray); buzz(st, 0.5, 40); }
    } else {
      const p = this.held, ax = gp.axes && gp.axes.length >= 4 ? gp.axes : null, sx = ax && Math.abs(ax[2]) > 0.15 ? ax[2] : 0, sy = ax && Math.abs(ax[3]) > 0.15 ? ax[3] : 0;
      if (!tr) { this.drop(); buzz(st, 0.3, 25); }
      else {
        this.yawAdd -= sx * dt * 1.4;
        if (grip) { if (sy) p.resize(Math.exp(-sy * dt * 0.9)); } else if (sy) { const k = sy * dt * (0.8 + (p.floor ? this.base : -this.off.elements[14]) * 0.8); if (p.floor) this.pull = clamp(this.pull - k, 0.3 - this.base, 25); else { _p.setFromMatrixPosition(this.off); this.off.setPosition(_p.x, _p.y, clamp(_p.z + k, -25, -0.2)); } }
        const rig = this.mp.rig; rig.updateMatrixWorld();
        if (p.floor) {   // slides along the floor: where the beam meets it (or the last distance), plus the carry-over from the grab
          const dy = this.d.y, hz = Math.hypot(this.d.x, this.d.z) || 1;
          if (dy < -0.04) { const tt = (this.y0 - this.o.y) / dy; this.base = Math.hypot(this.d.x * tt, this.d.z * tt); }
          const Dt = Math.max(0.3, this.base + this.pull);
          _v.set(this.o.x + this.d.x / hz * Dt + this.lat.x, this.y0, this.o.z + this.d.z / hz * Dt + this.lat.z);
          rig.worldToLocal(_v); p.obj.position.copy(_v);
          _q.setFromAxisAngle(YAX, this.yawAdd).multiply(this.q0); _e.setFromQuaternion(_q, 'YXZ'); p.obj.rotation.set(0, _e.y, 0);
        } else {
          _m.copy(this.rm).multiply(this.off); _m.decompose(_p, _q, _s);
          _q.copy(this.q0).premultiply(new THREE.Quaternion().setFromAxisAngle(YAX, this.yawAdd));
          // follow the hand's position only; the stick sets the turn
          _v.copy(_p); rig.worldToLocal(_v); p.obj.position.copy(_v);
          rig.getWorldQuaternion(_q2).invert(); p.obj.quaternion.copy(_q2.multiply(_q));
        }
        p.placeHandles(); len = Math.max(0.1, _v2.copy(p.obj.getWorldPosition(_v3)).sub(this.o).length());
      }
    }
    this.trigWas = tr;
    // the beam
    const e = this.held ? _v3.copy(this.held.obj.getWorldPosition(_v2)) : _v3.copy(this.o).addScaledVector(this.d, len);
    _v2.copy(e).sub(this.o); const L = Math.max(0.05, _v2.length());
    this.beam.position.copy(this.o).addScaledVector(_v2, 0.5); this.beam.scale.set(1, L, 1); this.beam.quaternion.setFromUnitVectors(YAX, _v2.normalize());
    this.dot.position.copy(e); this.dot.visible = !!(hit || this.held);
  }
}
const _q2 = new THREE.Quaternion(), _v3 = new THREE.Vector3();

// ------------------------------------------------------------------ manager
// env: { rig, camera, renderer, toast }
export class MovieProps {
  constructor(env) {
    this.env = env; this.rig = env.rig; this.placer = new Placer(this); this.items = []; this.neons = []; this.selId = null; this.loaded = false; this.lists = { matte: [], glb: [], png: [] }; this.mattes = new Map(); this.surfaces = new Map(); this.stex = new Map(); this.loadSurfaces(); this.saveT = 0; this.depth = null; this.focus = { on: false, dist: 3, ap: 0.5, a: 2, b: 8, time: 3, rack: null }; this.loadCam();
    if (env.scene) this.placer.attach(env.scene);
    this.refreshLists();
  }
  props() { return this.items.filter(p => !p.dead); }
  setDepth(D) { this.depth = D || null; }   // RealDepth.laserData() while the headset gives a depth map, else null (fog then ignores the real room)
  viewCam() { return this.env.renderer.xr.isPresenting ? this.env.renderer.xr.getCamera() : this.env.camera; }
  // out of focus: how many mip levels / how big a disc, for something at this object's distance (0 when FOCUS is off)
  cocFor(o) {
    const f = this.focus; if (!f.on) return 0; const cam = this.viewCam(); cam.updateMatrixWorld(); o.updateWorldMatrix(true, false);
    const d = _v2.setFromMatrixPosition(o.matrixWorld).distanceTo(_v3.setFromMatrixPosition(cam.matrixWorld)); return Math.min(6, f.ap * 10 * Math.abs(d - f.dist) / Math.max(d, 0.3));
  }
  rack(toB) {   // pull the focus from A to B (or back) over RACK TIME
    const f = this.focus; f.rack = { t: 0, from: toB ? f.a : f.b, to: toB ? f.b : f.a }; f.on = true; f.dist = f.rack.from;
  }
  tickFocus(dt) {
    const r = this.focus.rack; if (!r) return; r.t += dt; const k = clamp(r.t / Math.max(0.2, this.focus.time), 0, 1), e = k * k * (3 - 2 * k);
    this.focus.dist = Math.exp(Math.log(r.from) * (1 - e) + Math.log(r.to) * e); if (k >= 1) { this.focus.rack = null; this.saveCam(); }
  }
  saveCam() { try { const f = this.focus; localStorage.setItem(KEY + '.cam', JSON.stringify({ on: f.on, dist: f.dist, ap: f.ap, a: f.a, b: f.b, time: f.time })); } catch {} }
  loadCam() { try { const d = JSON.parse(localStorage.getItem(KEY + '.cam') || 'null'); if (d) Object.assign(this.focus, d, { rack: null }); } catch {} }
  get sel() { return this.items.find(p => p === this.selected) || null; }
  select(p) { this.selected = p; }
  async refreshLists() { for (const k of Object.keys(this.lists)) this.lists[k] = await listFiles(k); this.lists.glb = [...Object.keys(GLB_BUILTIN), ...this.lists.glb]; this.listCb && this.listCb(); }
  matteTex(name, cb) {
    let e = this.mattes.get(name); if (e) return e.tex;
    const i = MATTES.indexOf(name);
    if (i >= 0) { const t = new THREE.CanvasTexture(makeMatte(i)); t.wrapS = t.wrapT = i === 4 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; t.anisotropy = 4; this.mattes.set(name, { tex: t }); return t; }
    this.mattes.set(name, { tex: DUMMY });   // uploaded picture: loads async, the puddle picks it up through cb
    getFile('matte', name).then(async f => {
      if (!f) return; const b = await createImageBitmap(f), c = document.createElement('canvas'); c.width = Math.min(1024, b.width); c.height = Math.min(1024, b.height);
      const g = c.getContext('2d'); g.drawImage(b, 0, 0, c.width, c.height); const t = new THREE.CanvasTexture(c); this.mattes.set(name, { tex: t }); if (cb) cb();
    }).catch(() => {});
    return DUMMY;
  }
  // ---- surfaces (built-ins + the ones you make). Slot value: a path under surfaces/ (shipped with the app) or a file name in the app's private storage (kind 'surf')
  loadSurfaces() {
    this.surfaces.clear(); for (const [k, v] of Object.entries(SURF_BUILTIN)) this.surfaces.set(k, { tile: v.tile, disp: v.disp, slots: { ...v.slots }, builtin: true });
    let st = {}; try { st = JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch {}
    for (const [k, v] of Object.entries(st)) { const b = this.surfaces.get(k); if (b) { b.tile = v.tile ?? b.tile; b.disp = v.disp ?? b.disp; Object.assign(b.slots, v.slots || {}); } else this.surfaces.set(k, { tile: v.tile || 1, disp: v.disp ?? 1, slots: { ...(v.slots || {}) }, builtin: false }); }
  }
  saveSurfaces() { try { const o = {}; for (const [k, v] of this.surfaces) o[k] = { tile: v.tile, disp: v.disp, slots: v.slots }; localStorage.setItem(SKEY, JSON.stringify(o)); } catch {} }
  surfNames() { return [...this.surfaces.keys()]; }
  addSurface(name) { name = (name || '').trim().toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 24); if (!name || this.surfaces.has(name)) return null; this.surfaces.set(name, { tile: 1, disp: 1, slots: {}, builtin: false }); this.saveSurfaces(); return name; }
  removeSurface(name) { const S = this.surfaces.get(name); if (!S || S.builtin) return; for (const v of Object.values(S.slots)) if (!v.startsWith('surfaces/')) removeFile('surf', v); this.surfaces.delete(name); this.saveSurfaces(); for (const p of this.items) if (p.surf === name) p.setSurface(''); }
  setSlot(name, slot, file) {   // file = a picked File, or null to clear
    const S = this.surfaces.get(name); if (!S) return Promise.resolve();
    const old = S.slots[slot]; const done = () => { for (const k of [...this.stex.keys()]) if (k.startsWith(name + '|' + slot + '|')) this.stex.delete(k); this.saveSurfaces(); for (const p of this.items) if (p.surf === name) p.sdirty = true; };
    if (!file) { if (old && !old.startsWith('surfaces/')) removeFile('surf', old); delete S.slots[slot]; if (SURF_BUILTIN[name] && SURF_BUILTIN[name].slots[slot]) S.slots[slot] = null; done(); return Promise.resolve(); }
    const ext = (file.name.match(/\.[a-z0-9]+$/i) || ['.png'])[0].toLowerCase(), fn = (name + '__' + slot + ext).replace(/[^A-Za-z0-9_.-]/g, '_');
    return putFile('surf', new File([file], fn)).then(() => { S.slots[slot] = fn; done(); });
  }
  touchSurf(name) { for (const p of this.items) if (p.surf === name) p.sdirty = true; }
  pickSurf(name, slot, done) {   // a file picker for one map slot of a surface
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
    i.onchange = async () => { const f = i.files && i.files[0]; if (!f) return; try { await this.setSlot(name, slot, f); done(); } catch (e) { this.env.toast('Could not add that picture: ' + (e.message || e), 3500); } };
    i.click();
  }
  surfTex(name, slot, cb) {   // null = nothing in that slot (yet)
    const S = this.surfaces.get(name), v = S && S.slots[slot]; if (!v) return null;
    const key = name + '|' + slot + '|' + v, hit = this.stex.get(key); if (hit !== undefined) return hit;
    this.stex.set(key, null);
    const fin = t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (slot === 'diff') t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; this.stex.set(key, t); if (cb) cb(); };
    if (v.startsWith('surfaces/')) new THREE.TextureLoader().load(v, fin, undefined, () => {});
    else getFile('surf', v).then(async f => {
      if (!f) return; const b = await createImageBitmap(f), c = document.createElement('canvas'), k = Math.min(1, 2048 / Math.max(b.width, b.height)); c.width = Math.round(b.width * k); c.height = Math.round(b.height * k);
      c.getContext('2d').drawImage(b, 0, 0, c.width, c.height); fin(new THREE.CanvasTexture(c));
    }).catch(() => {});
    return null;
  }
  neonsNear(P, n) { return this.neons.filter(s => s.mesh.visible && !s.dead).map(s => [s, s.obj.getWorldPosition(_v2).distanceToSquared(P)]).sort((a, b) => a[1] - b[1]).slice(0, n).map(x => x[0]); }
  // where a new prop appears: 1.3 m in front of the viewer on the floor (floor props) or at chest height (wall props)
  spot(floor) {
    const cam = this.env.renderer.xr.isPresenting ? this.env.renderer.xr.getCamera() : this.env.camera;
    cam.updateMatrixWorld(); const w = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld), f = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
    w.addScaledVector(f, 1.3).addScaledVector(new THREE.Vector3(-f.z, 0, f.x), ((this.items.length % 3) - 1) * 0.5);   // a few in a row, so they do not pile up
    const l = this.rig.worldToLocal(w.clone()); const yaw = Math.atan2(-f.x, -f.z);
    return { p: new THREE.Vector3(l.x, floor ? 0.01 : Math.max(1.0, l.y - 0.25), l.z), yaw };
  }
  spawn(type, opt = {}) {
    const P = { puddle: Puddle, rain: Rain, fog: Fog, neon: NeonSign, graffiti: Graffiti, glb: GlbProp, lamp: Lamp }[type]; if (!P) return null;
    const p = new P(this), s = this.spot(p.floor); p.obj.position.copy(s.p); p.obj.rotation.set(0, s.yaw, 0); p.placeHandles();
    if (type === 'glb' && opt.src) p.load(opt.src); if (type === 'graffiti' && opt.src) { p.src = opt.src; p.tint = opt.src === 'graff1.png' ? 1 : 0; p.load(); }
    this.items.push(p); this.selected = p; this.save(); return p;
  }
  remove(p) { const i = this.items.indexOf(p); if (i >= 0) this.items.splice(i, 1); p.dispose(); if (this.selected === p) this.selected = this.items[this.items.length - 1] || null; this.save(); }
  clear() { for (const p of this.items.splice(0)) p.dispose(); this.selected = null; this.save(); }
  // #485 ALLEY SCENE: one tap dresses the area in front of you (the real room / alley stays as the passthrough background):
  // wet cobblestone with shallow water, two street lamps with halos, rain, cold fog and a covered car parked far down the lane.
  async alleyScene() {
    this.clear(); const cam = this.viewCam(); cam.updateMatrixWorld();
    const o = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld), f = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x), yaw = Math.atan2(-f.x, -f.z);
    const at = (x, d, y = 0) => this.rig.worldToLocal(o.clone().addScaledVector(f, d).addScaledVector(r, x)).setY(y);
    const put = (p, x, d, ry = 0) => { p.obj.position.copy(at(x, d, p.floor ? 0.01 : 0)); p.obj.rotation.set(0, yaw + ry, 0); p.placeHandles(); return p; };
    const halo = (g, size, bright) => {   // a LAMP halo on the bulb of a street-lamp model
      const h = this.spawn('lamp'); g.obj.updateWorldMatrix(true, true); let bb = null;
      g.obj.traverse(m => { if (m.isMesh && m.material && /bulb/i.test(m.material.name)) { const b = new THREE.Box3().setFromObject(m); bb = bb ? bb.union(b) : b; } });
      const w = bb ? bb.getCenter(new THREE.Vector3()) : g.obj.localToWorld(new THREE.Vector3(0, 3.4, 0));
      h.obj.position.copy(this.rig.worldToLocal(w)); h.size = size; h.bright = bright; h.flick = 0.12; h.col = 2; h.placeHandles(); return h;
    };
    const gr = this.spawn('puddle'); gr.setSurface('COBBLESTONE'); gr.setSize(5.5, 15); gr.wet = 0.55; gr.refl = 1.7; gr.rip = 0.7; gr.rain = 0.8; gr.amb = 0.1; gr.cover = 0.92; put(gr, 0, 8.2);
    const l1 = this.spawn('glb'); await l1.load('street_lamp_01.glb'); put(l1, -2.3, 6.5, 0.3); halo(l1, 1.5, 1.1);
    const l2 = this.spawn('glb'); await l2.load('street_lamp_02.glb'); put(l2, 2.3, 11.5, -0.3); halo(l2, 1.0, 0.8);
    const car = this.spawn('glb'); await car.load('covered_car.glb'); put(car, 2.1, 14.5, 0.12);
    const rn = this.spawn('rain'); rn.setSize(7, 15); rn.h = 5; rn.amt = 0.25; rn.layout && rn.layout(); put(rn, 0, 8.2);
    const fg = this.spawn('fog'); fg.setSize(7, 16); fg.h = 2.0; fg.col = 1; fg.den = 0.3; fg.amb = 0.45; fg.layout && fg.layout(); put(fg, 0, 8.7);
    this.selected = gr; this.save(); return gr;
  }
  tick(dt) { this.tickFocus(dt); for (const p of this.items) p.tick(dt); if (this.saveT > 0 && (this.saveT -= dt) <= 0) this.saveNow(); }
  save() { this.saveT = 0.6; }
  saveNow() { try { localStorage.setItem(KEY, JSON.stringify(this.items.filter(p => !p.dead).map(p => p.snap()))); } catch {} }
  load() {
    if (this.loaded) return; this.loaded = true; let a = []; try { a = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch {}
    for (const d of a) { const p = this.spawn(d.type); if (p) p.apply(d); }
    this.selected = this.items[this.items.length - 1] || null;
  }
  pickFile(kind, accept, done) {   // a file picker (the headset may not allow one while it is in VR: add files from the desktop page, or before entering VR)
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept;
    i.onchange = async () => { const f = i.files && i.files[0]; if (!f) return; try { const n = await putFile(kind, f); await this.refreshLists(); done(n); } catch (e) { this.env.toast('Could not add that file: ' + (e.message || e), 3500); } };
    i.click();
  }
}
