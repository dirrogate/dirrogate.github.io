import * as THREE from 'three';

// ---- Record geometry constants (metres). Time maps linearly to radius (constant groove pitch). ----
export const REC = {
  R: 0.1524,        // 12" disc radius
  EDGE: 0.1500,     // raised rim / lead-in starts
  OUT: 0.1460,      // first modulated groove (t = 0)
  IN: 0.0620,       // last modulated groove (t = duration)
  RUNOUT: 0.0540,   // run-out groove ends, label edge starts
  LABEL: 0.0500,
  HOLE: 0.0036,
  THICK: 0.0019,
};
// After the music ends the stylus runs down the lead-out spiral (3 s) into the locked run-out groove.
export const timeToRadius = (t, dur) => {
  dur = Math.max(1, dur);
  if (t > dur) return REC.IN - (REC.IN - REC.RUNOUT - 0.0015) * Math.min(1, (t - dur) / 3);
  return REC.OUT - (REC.OUT - REC.IN) * Math.max(0, t / dur);
};
export const radiusToTime = (r, dur) => Math.min(dur, Math.max(0, (REC.OUT - r) / (REC.OUT - REC.IN) * dur));

const texCache = {};

function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// Shared anisotropy direction map: groove tangent at every texel, encoded in RG, strength in B.
export function grooveAnisoMap() {
  if (texCache.aniso) return texCache.aniso;
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const u = (px + 0.5) / S - 0.5, v = (1 - (py + 0.5) / S) - 0.5;
    const r = Math.hypot(u, v) || 1e-6;
    const tx = -v / r, ty = u / r;
    const rm = r * 2 * REC.R;
    const inGroove = rm < REC.EDGE && rm > REC.RUNOUT;
    const i = (py * S + px) * 4;
    d[i] = (tx * 0.5 + 0.5) * 255; d[i + 1] = (ty * 0.5 + 0.5) * 255;
    d[i + 2] = inGroove ? 255 : 0; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8;
  return (texCache.aniso = t);
}

// Per-side colour + roughness maps from the track's loudness envelope.
// Loud passages are cut with wider groove spacing and read lighter/rougher; quiet passages
// and breakdowns read as darker, glossier bands -- the same thing you see on real vinyl.
let REC_TEX = 2048;
export function setRecordTexSize(n) { REC_TEX = n; }

// #137 (owner): record sides without a 2048 disc texture. Everything outside the label is a function of the radius
// only, so it lives in a 1024 x 1 ring strip (RGB = the vinyl colour in sRGB, A = the roughness byte of the old 512
// roughness map), read in the shader by the distance from the disc centre. Same rings as the old 2048 canvas: 1024
// texels over 0..R is exactly its pixel density, one texel per step from REC.OUT to REC.IN, lightness from the track's
// loudness envelope (L = 5 + 30 e^0.8, hsl 225 / 6 %), same lead-in, run-out, run-out line and roughness values
// (DO NOT BREAK rules unchanged; no normal map, no synthetic rings). The label is a small canvas (512, 128 for records
// lying far away) covering only LABEL_BUMP_R, read through uv1 like the label relief map. Hot cue marks are drawn in
// the shader from uniforms. GPU memory per record side: ~1.4 MB (was ~24 MB).
const STRIP_N = 1024;
function hslRgb(h, s, l) {   // CSS hsl() -> sRGB bytes
  const c = new THREE.Color().setHSL(h / 360, s, l, THREE.SRGBColorSpace), o = {};
  c.getRGB(o, THREE.SRGBColorSpace); return [o.r * 255, o.g * 255, o.b * 255];
}
const hexRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export function drawRecordSide({ env, duration, cues, labelImg, title, artist, bpm, side, showText, blank, split, vinyl = '#0b0b0c', size, low }) {
  // ---- ring strip
  const N = STRIP_N, px = N / REC.R, data = new Uint8Array(N * 4);
  const G = rough => Math.round(Math.min(255, rough / 0.86 * 255));
  const A_DULL = 0.076;   // #99
  const rc = i => (i + 0.5) / px;   // texel centre radius
  const set = (i, rgb, a) => { const o = i * 4; if (rgb) { data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; } if (a !== undefined) data[o + 3] = a; };
  const band = (r0, r1, rgb, a) => { for (let i = 0; i < N; i++) { const r = rc(i); if (r <= r0 && r > r1) set(i, rgb, a); } };   // r0 > r1
  band(REC.R, 0, hexRgb(vinyl), 0);
  band(REC.R, REC.EDGE, hexRgb('#151516'));
  let lo = 0, hi = 1;
  if (env) { const srt = Array.from(env).sort((x, y) => x - y); lo = srt[Math.floor(srt.length * 0.03)]; hi = srt[Math.floor(srt.length * 0.995)] || 1; }
  const span = Math.max(1e-6, hi - lo);
  if (!blank) {
    band(REC.EDGE, REC.OUT, hexRgb('#101012'));
    const steps = Math.round((REC.OUT - REC.IN) * px);
    for (let i = 0; i < N; i++) {
      const r = rc(i); if (r > REC.OUT || r <= REC.IN) continue;
      const k = Math.min(steps - 1, Math.max(0, Math.floor((REC.OUT - r) * px)));
      let e = 0.5;
      if (env) {   // average of the envelope bins inside this ring (as the old canvas did per pixel ring)
        const b0 = Math.floor(k / steps * env.length), b1 = Math.max(b0 + 1, Math.floor((k + 1) / steps * env.length));
        let sum = 0; for (let j = b0; j < b1 && j < env.length; j++) sum += env[j];
        e = Math.min(1, Math.max(0, (sum / (b1 - b0) - lo) / span));
      }
      set(i, hslRgb(225, 0.06, (5 + 30 * Math.pow(e, 0.8)) / 100), G(0.03 + A_DULL + 0.04 * e));
    }
    band(REC.IN, REC.RUNOUT, hexRgb('#0d0d0f'));
    band(REC.RUNOUT + 0.0012 + 1 / px, REC.RUNOUT + 0.0012 - 1 / px, hexRgb('#2a2a2e'));   // run-out line, 2 px
    band(REC.R, REC.EDGE, null, G(0.06 + A_DULL)); band(REC.EDGE, REC.OUT, null, G(0.04 + A_DULL)); band(REC.IN, REC.LABEL, null, G(0.04 + A_DULL));
  } else {
    band(REC.EDGE, REC.RUNOUT, hexRgb('#0e0e10'));
    band(REC.R, REC.EDGE, null, 235); band(REC.EDGE, REC.OUT, null, 230); band(REC.OUT, REC.IN, null, 0); band(REC.IN, REC.LABEL, null, 230);
  }
  band(REC.LABEL, -1, null, 200);   // label: matte paper
  const strip = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  strip.colorSpace = THREE.SRGBColorSpace; strip.generateMipmaps = true; strip.minFilter = THREE.LinearMipmapLinearFilter; strip.magFilter = THREE.LinearFilter;
  strip.wrapS = strip.wrapT = THREE.ClampToEdgeWrapping; strip.needsUpdate = true;
  // ---- hot cue marks: 5 px arcs, 0.18 rad wide, at 12 o'clock of the canvas
  const cueList = [];
  if (!blank && cues && duration) for (const q of cues) if (cueList.length < 16) cueList.push({ rn: timeToRadius(q.time, duration) / REC.R, color: new THREE.Color(q.color) });
  // ---- label canvas (covers LABEL_BUMP_R, read through uv1)
  const S = size || (low ? 128 : 512), c = document.createElement('canvas'); c.width = c.height = S; c.vireLabelR = LABEL_BUMP_R;
  const g = c.getContext('2d'); const C = S / 2, lpx = S / (2 * LABEL_BUMP_R), lr = REC.LABEL * lpx;
  g.fillStyle = vinyl; g.fillRect(0, 0, S, S);
  g.save(); g.beginPath(); g.arc(C, C, lr, 0, Math.PI * 2); g.clip();
  const hue = hash(title || 'blank') % 360;
  if (labelImg) {
    const s = Math.max(2 * lr / labelImg.width, 2 * lr / labelImg.height);
    g.drawImage(labelImg, C - labelImg.width * s / 2, C - labelImg.height * s / 2, labelImg.width * s, labelImg.height * s);
  } else {
    const gr = g.createRadialGradient(C, C, 0, C, C, lr);
    gr.addColorStop(0, blank ? '#d8d4c8' : `hsl(${hue},55%,52%)`);
    gr.addColorStop(1, blank ? '#bdb8aa' : `hsl(${(hue + 30) % 360},60%,34%)`);
    g.fillStyle = gr; g.fillRect(C - lr, C - lr, 2 * lr, 2 * lr);
  }
  if (showText && !blank) {
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(C - lr, C + lr * 0.28, 2 * lr, lr * 0.62);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `600 ${Math.round(lr * 0.15)}px system-ui, sans-serif`;
    fitText(g, title || '', C, C + lr * 0.42, lr * 1.6);
    g.font = `400 ${Math.round(lr * 0.11)}px system-ui, sans-serif`;
    fitText(g, artist || '', C, C + lr * 0.60, lr * 1.5);
    g.font = `700 ${Math.round(lr * 0.12)}px system-ui, sans-serif`;
    g.fillText(bpm ? `${bpm.toFixed(bpm % 1 ? 1 : 0)} BPM` : '', C, C + lr * 0.77);
  }
  g.fillStyle = labelImg ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.25)';
  g.beginPath(); g.arc(C - lr * 0.62, C - lr * 0.18, lr * 0.14, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.font = `800 ${Math.round(lr * 0.16)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(side || '', C - lr * 0.62, C - lr * 0.18);
  if (split) { g.font = `700 ${Math.round(lr * 0.09)}px system-ui, sans-serif`; g.fillText('VOX | INST', C + lr * 0.5, C - lr * 0.18); }
  g.restore();
  g.beginPath(); g.arc(C, C, REC.HOLE * lpx, 0, Math.PI * 2); g.fillStyle = '#000'; g.fill();
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; map.channel = 1;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  return { map, strip, cues: cueList, labelCanvas: c };
}
// The record side material (#137): MeshPhysical as before (#58 / #93 gloss settings), colour and roughness from the
// ring strip outside the label, the label canvas inside it. Works without a label map (the crate's riding disc).
export function recordMaterial(extra = {}) {
  const u = { uStrip: { value: null }, uLabelN: { value: REC.LABEL / REC.R }, uCueN: { value: 0 },
    uCue: { value: Array.from({ length: 16 }, () => new THREE.Vector2()) }, uCueC: { value: Array.from({ length: 16 }, () => new THREE.Color()) } };
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.86, clearcoat: 0, anisotropy: 0, specularIntensity: 0.15, envMapIntensity: 0.14, ...extra });
  m.userData.rec = u;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying vec2 vDiscUv;\nvoid main() {').replace('#include <uv_vertex>', '#include <uv_vertex>\nvDiscUv = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', `uniform sampler2D uStrip; uniform float uLabelN; uniform int uCueN; uniform vec2 uCue[16]; uniform vec3 uCueC[16];
varying vec2 vDiscUv;
void main() {`).replace('#include <map_fragment>', `vec2 vdp = vDiscUv - 0.5; float vrn = length(vdp) * 2.0;
vec4 vireStrip = texture2D(uStrip, vec2(vrn, 0.5));
vec3 vireCol = vireStrip.rgb;
#ifdef USE_MAP
{ vec4 lab = texture2D(map, vMapUv); float aw = fwidth(vrn); vireCol = mix(vireCol, lab.rgb, 1.0 - smoothstep(uLabelN - aw, uLabelN + aw, vrn)); }
#endif
{ float va = atan(vdp.y, vdp.x);
  for (int i = 0; i < 16; i++) { if (i >= uCueN) break; if (abs(vrn - uCue[i].x) < 2.5 / 1024.0 && abs(va - 1.5707963) < 0.09) vireCol = uCueC[i]; } }
diffuseColor.rgb *= vireCol;`).replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * vireStrip.a;');
  };
  m.customProgramCacheKey = () => 'vire-record-strip';
  return m;
}
// put a drawRecordSide() result on a recordMaterial (disposes what it replaces)
export function setRecordSide(mat, s, withLabel = true) {
  const u = mat.userData.rec;
  if (u.uStrip.value) u.uStrip.value.dispose();
  u.uStrip.value = s.strip;
  if (mat.map && mat.map !== s.map) mat.map.dispose();
  mat.map = withLabel ? s.map : null;
  if (!withLabel) s.map.dispose();
  u.uCueN.value = s.cues.length;
  s.cues.forEach((q, i) => { u.uCue.value[i].set(q.rn, 0); u.uCueC.value[i].copy(q.color); });
  mat.needsUpdate = true;
}

// Visible grooves (CLAUDE.md #46): a normal map of concentric ridges, exaggerated to ~0.6 mm pitch
// (real 12" singles are cut wide, but true grooves are too fine to resolve in a headset). Loud passages
// get deeper ridges, so the bands of the track read in the light. Lead-in and run-out get a few wide turns.
const normalCache = new Map();
function grooveNormalMap(env) {
  const key = env ? env : 'flat';
  if (normalCache.has(key)) return normalCache.get(key);
  const S = 2048, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
  const mPerPx = 2 * REC.R / S, pitch = 0.0018;   // 1.4 mm ridges: fine enough to look like grooves, coarse enough for a headset to resolve
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const u = (px + 0.5) / S - 0.5, v = (1 - (py + 0.5) / S) - 0.5;
    const rn = Math.hypot(u, v) || 1e-6, r = rn * 2 * REC.R;
    let amp = 0, ph = 0;
    if (r < REC.OUT && r > REC.IN) {
      const tn = (REC.OUT - r) / (REC.OUT - REC.IN);
      const e = env ? env[Math.min(env.length - 1, Math.floor(tn * env.length))] : 0.6;
      amp = 0.2 + 0.25 * e; ph = r / pitch;
    } else if ((r < REC.EDGE && r >= REC.OUT) || (r <= REC.IN && r > REC.RUNOUT)) { amp = 0.35; ph = r / 0.002; }
    const slope = amp * Math.cos(2 * Math.PI * ph);
    const nx = (u / rn) * slope, ny = (v / rn) * slope, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const i = (py * S + px) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = nz * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8;
  if (normalCache.size > 4) { const k = normalCache.keys().next().value; normalCache.get(k).dispose(); normalCache.delete(k); }
  normalCache.set(key, t);
  return t;
}

function fitText(g, s, x, y, w) {
  let t = s; while (t.length > 3 && g.measureText(t).width > w) t = t.slice(0, -2);
  if (t !== s) t = t.slice(0, -1) + '…';
  g.fillText(t, x, y);
}

// Label relief (owner, #94; normal map since #100): a 256 px relief map covering only the label (+12 %), read through uv1 so its pixels
// all land on the label. Printed ink stands slightly proud (high-pass of the label's own lightness, so text and
// line edges emboss and flat colour stays flat; #99: plus a mid-scale and tone term so picture features emboss too), fine paper grain, the raised pressing ring, a small step down at
// the label edge and a lip round the spindle hole. Everything outside the label is exactly 128 = flat, so the
// grooves get no relief (DO NOT BREAK: no groove normal/bump). Built only for records within arm's length.
export const LABEL_BUMP_R = REC.LABEL * 1.12;
// #149 (owner: first lean-in over a record hitched while its label relief was built, ~30 ms on the PC, several times
// that on Quest): the same relief built in a worker (js/bump-worker.js); the main thread only makes an ImageBitmap
// and uploads the result. Falls back to labelBumpMap() where workers / OffscreenCanvas are missing.
let bumpWorker = null, bumpSeq = 0;
const bumpWait = new Map();
export function labelBumpMapAsync(canvas, seedStr = '') {
  if (bumpWorker === null) {
    try {
      if (typeof OffscreenCanvas === 'undefined') throw new Error('no OffscreenCanvas');
      bumpWorker = new Worker(new URL('./bump-worker.js', import.meta.url));
      bumpWorker.onmessage = e => { const w = bumpWait.get(e.data.id); bumpWait.delete(e.data.id); if (w) w(e.data.data); };
      bumpWorker.onerror = () => { bumpWorker = false; for (const w of bumpWait.values()) w(null); bumpWait.clear(); };
    } catch (e) { bumpWorker = false; }
  }
  if (!bumpWorker || !canvas.vireLabelR) return Promise.resolve(labelBumpMap(canvas, seedStr));
  const N = 256;
  return createImageBitmap(canvas).then(bmp => new Promise(res => {
    const id = ++bumpSeq;
    bumpWait.set(id, data => {
      if (!data) { res(labelBumpMap(canvas, seedStr)); return; }
      const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.colorSpace = THREE.NoColorSpace; t.channel = 1; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
      res(t);
    });
    bumpWorker.postMessage({ id, bmp, seed: seedStr, N, labelFrac: REC.LABEL / LABEL_BUMP_R, ringFrac: 0.82 * REC.LABEL / LABEL_BUMP_R, holeFrac: REC.HOLE / LABEL_BUMP_R }, [bmp]);
  }));
}
export function labelBumpMap(mapCanvas, seedStr = '') {
  const N = 256, S = mapCanvas.width, C = S / 2, pxS = S / (2 * (mapCanvas.vireLabelR || REC.R)), cropR = LABEL_BUMP_R * pxS;   // #137: label-only canvases
  const a = document.createElement('canvas'); a.width = a.height = N;
  const b = document.createElement('canvas'); b.width = b.height = N;
  const ga = a.getContext('2d'), gb = b.getContext('2d');
  ga.drawImage(mapCanvas, C - cropR, C - cropR, 2 * cropR, 2 * cropR, 0, 0, N, N);
  gb.filter = 'blur(1.5px)'; gb.drawImage(a, 0, 0); gb.filter = 'none';
  const c2 = document.createElement('canvas'); c2.width = c2.height = N; const gc = c2.getContext('2d');
  gc.filter = 'blur(7px)'; gc.drawImage(a, 0, 0); gc.filter = 'none';
  const A = ga.getImageData(0, 0, N, N), B = gb.getImageData(0, 0, N, N), W = gc.getImageData(0, 0, N, N), out = ga.createImageData(N, N);
  const px = N / (2 * LABEL_BUMP_R), lr = REC.LABEL * px, ring = REC.LABEL * 0.82 * px, hole = REC.HOLE * px;
  let seed = (hash(seedStr) % 2147483646) + 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lum = (d, i) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
  const H = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4, r = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2);
    let h = 128;
    if (r < lr) {
      // picture relief (#99): darker ink stands proud at two scales, so photos and shapes emboss, not only sharp text
      h += Math.max(-30, Math.min(30, 2.2 * (lum(B.data, i) - lum(A.data, i))));    // fine: line and text edges
      h += Math.max(-28, Math.min(28, 0.9 * (lum(W.data, i) - lum(A.data, i))));    // mid: shapes and features
      h += Math.max(-14, Math.min(14, 0.12 * (140 - lum(A.data, i))));              // tone: dark areas a touch higher
      h += (rnd() - 0.5) * 7;                                                         // paper grain
      h += 34 * Math.exp(-(((r - ring) / 1.3) ** 2));                                 // pressing ring
      h += 30 * Math.exp(-(((r - hole - 2.2) / 1.2) ** 2));                           // spindle-hole lip
      h -= 22 * Math.exp(-(((r - lr + 1) / 1.1) ** 2));                               // step down at the label edge
    }
    H[y * N + x] = Math.max(0, Math.min(255, h)) / 255;
  }
  // #100: baked into a tangent-space normal map. three's bumpMap measures the height step per SCREEN pixel, so the
  // relief grew with distance and faded close up; a normal map's slope is per texel, i.e. fixed on the label.
  // K = 4 matches the old bumpScale 4 at arm's length (~1 texel per pixel on Quest 3). Steep slopes are compressed
  // (soft knee at SK) so ink edges and the ring don't swing the normal into the dark/bright parts of the environment.
  const K = 4, SK = 0.3, soft = v => v / (1 + Math.abs(v) / SK);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4, at = (xx, yy) => H[Math.min(N - 1, Math.max(0, yy)) * N + Math.min(N - 1, Math.max(0, xx))];
    const du = soft(K * 0.5 * (at(x + 1, y) - at(x - 1, y)));       // dH along +u
    const dv = soft(K * 0.5 * (at(x, y - 1) - at(x, y + 1)));       // dH along +v (canvas rows run down, v runs up)
    const l = Math.hypot(du, dv, 1);
    out.data[i] = Math.round((-du / l * 0.5 + 0.5) * 255); out.data[i + 1] = Math.round((-dv / l * 0.5 + 0.5) * 255);
    out.data[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); out.data[i + 3] = 255;
  }
  ga.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(a); t.colorSpace = THREE.NoColorSpace; t.channel = 1;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
export function glowTexture() {
  if (texCache.glow) return texCache.glow;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (texCache.glow = t);
}

// One strobe dot per texture repeat.
export function strobeDotTexture() {
  if (texCache.dot) return texCache.dot;
  const c = document.createElement('canvas'); c.width = 32; c.height = 32;
  const g = c.getContext('2d'); g.fillStyle = '#1a1a1c'; g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#e8e8ea'; g.beginPath(); g.arc(16, 16, 7, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return (texCache.dot = t);
}

export function brushedTexture(base = 180) {
  const key = 'brushed' + base;
  if (texCache[key]) return texCache[key];
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); const img = g.createImageData(S, S); const d = img.data;
  for (let y = 0; y < S; y++) {
    let v = base + (Math.random() - 0.5) * 18;
    for (let x = 0; x < S; x++) { v += (Math.random() - 0.5) * 3; v = v * 0.98 + base * 0.02; const i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return (texCache[key] = t);
}

// Canvas-backed screen helper.
export class Screen {
  constructor(w, h) {
    this.canvas = document.createElement('canvas'); this.canvas.width = w; this.canvas.height = h;
    this.g = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }
  commit() { this.texture.needsUpdate = true; }
}
export { fitText };

// ---- Mixer face: brushed aluminium with printed legends and recessed fader slots.
// layout: { W, D, knobs:[{x,z,r,label}], slots:[{x,z,w,d}], texts:[{x,z,text,size,bold}], ticks:[{x,z,r}] } (mixer-local metres)
function canvasR8(cv, srgb) {
  const w = cv.width, h = cv.height, src = cv.getContext('2d').getImageData(0, 0, w, h).data, r8 = new Uint8Array(w * h);
  const lut = new Uint8Array(256); for (let i = 0; i < 256; i++) { const v = i / 255; lut[i] = Math.round(255 * (srgb ? (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) : v)); }
  // canvas rows run top-down; flip so the texture matches a CanvasTexture (flipY) on the same UVs
  for (let y = 0; y < h; y++) { const so = (h - 1 - y) * w * 4, dO = y * w; for (let x = 0; x < w; x++) { const i = so + x * 4; r8[dO + x] = lut[Math.round((src[i] + src[i + 1] + src[i + 2]) / 3)]; } }
  const t = new THREE.DataTexture(r8, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}
export function mixerFaceTextures(layout) {
  const { W, D } = layout;
  const CW = 1024, CH = Math.round(1024 * D / W);
  const px = (x, z) => [(x + W / 2) / W * CW, (z + D / 2) / D * CH];
  const k = CW / W; // pixels per metre

  // colour: brushed aluminium, grain along x
  const c = document.createElement('canvas'); c.width = CW; c.height = CH;
  const g = c.getContext('2d'); const img = g.createImageData(CW, CH); const d = img.data;
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < CH; y++) {
    const row = 148 + (rnd() - 0.5) * 26;
    let v = row;
    for (let x = 0; x < CW; x++) {
      v += (rnd() - 0.5) * 7; v = v * 0.93 + row * 0.07;
      const i = (y * CW + x) * 4; d[i] = v; d[i + 1] = v + 2; d[i + 2] = v + 6; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // soft vertical light falloff so it doesn't look flat
  const lg = g.createLinearGradient(0, 0, 0, CH); lg.addColorStop(0, 'rgba(255,255,255,0.06)'); lg.addColorStop(1, 'rgba(0,0,0,0.10)');
  g.fillStyle = lg; g.fillRect(0, 0, CW, CH);

  // bump: flat panel, slots cut in with a bevel, screws
  const b = document.createElement('canvas'); b.width = CW; b.height = CH;
  const bg = b.getContext('2d'); bg.fillStyle = 'rgb(160,160,160)'; bg.fillRect(0, 0, CW, CH);

  for (const s of layout.slots) {
    const [x, y] = px(s.x - s.w / 2, s.z - s.d / 2); const w = s.w * k, h = s.d * k;
    // printed dark surround + slot
    g.fillStyle = 'rgba(20,20,22,0.55)'; roundRect(g, x - 4, y - 4, w + 8, h + 8, 5); g.fill();
    g.fillStyle = '#060607'; roundRect(g, x, y, w, h, 3); g.fill();
    // bevel in the bump map: ramp down into the slot
    for (let e = 6; e >= 0; e--) { bg.fillStyle = `rgb(${60 + e * 16},${60 + e * 16},${60 + e * 16})`; roundRect(bg, x - e, y - e, w + 2 * e, h + 2 * e, 3 + e); bg.fill(); }
    bg.fillStyle = 'rgb(20,20,20)'; roundRect(bg, x, y, w, h, 3); bg.fill();
  }
  // knob tick rings, printed
  // dotted scale like Vinyl Reality's mixer: 11 dots over 300 degrees, larger at the ends and centre
  g.fillStyle = '#17181b';
  for (const t of layout.ticks) {
    const [cx, cy] = px(t.x, t.z); const rr = (t.r * 1.18 + 0.0035) * k;
    for (let a = -150; a <= 150; a += 30) {
      const rad = a * Math.PI / 180, big = Math.abs(a) === 150 || a === 0;
      g.beginPath(); g.arc(cx + Math.sin(rad) * rr, cy - Math.cos(rad) * rr, (big ? 0.00075 : 0.00048) * k, 0, Math.PI * 2); g.fill();
    }
  }
  // fader scales
  for (const f of layout.faderScales || []) {
    for (let i = 0; i <= 10; i++) {
      const z = f.z0 + (f.z1 - f.z0) * i / 10; const [x, y] = px(f.x, z);
      g.fillStyle = '#1b1c1f'; g.fillRect(x - (i % 5 ? 5 : 9), y - 1, i % 5 ? 10 : 18, 2);
    }
  }
  // legends
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const t of layout.texts) {
    const [x, y] = px(t.x, t.z); g.fillStyle = t.color || '#15161a';
    g.font = `${t.bold ? 700 : 600} ${Math.round((t.size || 0.0036) * k)}px system-ui, Arial, sans-serif`;
    g.textAlign = t.align || 'center'; g.fillText(t.text, x, y);
  }
  // screws
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const [x, y] = px(sx * (W / 2 - 0.007), sz * (D / 2 - 0.007)); const r = 0.0028 * k;
    const sg = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r); sg.addColorStop(0, '#d9dbe0'); sg.addColorStop(1, '#55585e');
    g.fillStyle = sg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2a2b2f'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - r * 0.7, y - r * 0.2); g.lineTo(x + r * 0.7, y + r * 0.2); g.stroke();
    bg.fillStyle = 'rgb(200,200,200)'; bg.beginPath(); bg.arc(x, y, r, 0, Math.PI * 2); bg.fill();
  }

  // #134: both maps are greyscale (the face's slight blue cast is the material colour), so they go to the GPU as
  // one-channel R8 textures: 2 x 1.9 MB with mips instead of 2 x 7.7 MB RGBA. R8 has no sRGB format, so the colour
  // map is converted to linear here.
  const map = canvasR8(c, true); map.anisotropy = 8;
  const bumpMap = canvasR8(b, false);
  return { map, bumpMap };
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}

// Satin / brushed steel like the reference SL-1200 photos (CLAUDE.md #51): fine directional grain,
// soft broad highlights instead of mirror chrome.
export function satinSteel({ color = 0xc6c9ce, rough = 0.34, repeat = 4, env = 0.5, physical = true } = {}) {   // physical:false = MeshStandard (cheaper, no anisotropy) for small parts (#84)
  const grain = brushedTexture(205); // bright grain for the colour
  if (!texCache.satinRough) {
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'); const img = g.createImageData(S, S); const d = img.data;
    for (let y = 0; y < S; y++) { let v = 128 + (Math.random() - 0.5) * 40; for (let x = 0; x < S; x++) { v += (Math.random() - 0.5) * 8; v = v * 0.97 + 128 * 0.03; const i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; texCache.satinRough = t;
  }
  const map = grain.clone(); map.needsUpdate = true; map.repeat.set(repeat, repeat);
  const rmap = texCache.satinRough.clone(); rmap.needsUpdate = true; rmap.repeat.set(repeat, repeat);
  const P = { color, map, roughnessMap: rmap, roughness: rough * 1.6, metalness: 1, bumpMap: rmap, bumpScale: 0.15, envMapIntensity: env };
  return physical ? new THREE.MeshPhysicalMaterial({ ...P, anisotropy: 0.45 }) : new THREE.MeshStandardMaterial(P);
}
