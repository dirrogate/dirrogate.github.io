// TOOLS (CLAUDE.md #224): shared bits for the mixer tablet's TOOLS page.
//  - an original chunky 6 x 7 bitmap font (Amiga-demo style) plus three 8 x 8 emoji sprites, used by the VJ
//    Scroller, the on-tablet keyboard and its text field
//  - Scroller: a sine-wave text scroller across the bottom of the LED wall, over whatever the wall shows
//  - Record Maker storage: "pressings" (title, sound source, label picture) kept in the app's own storage
//    (OPFS 'vire-press'), and the generic blank-record sound (quiet vinyl crackle with track bands)
import * as THREE from 'three';

// ---------------------------------------------------------------- bitmap font
const G = {
  A: '..##..|.#..#.|#....#|#....#|######|#....#|#....#', B: '#####.|#....#|#....#|#####.|#....#|#....#|#####.',
  C: '.####.|#....#|#.....|#.....|#.....|#....#|.####.', D: '####..|#...#.|#....#|#....#|#....#|#...#.|####..',
  E: '######|#.....|#.....|#####.|#.....|#.....|######', F: '######|#.....|#.....|#####.|#.....|#.....|#.....',
  G: '.####.|#....#|#.....|#..###|#....#|#....#|.####.', H: '#....#|#....#|#....#|######|#....#|#....#|#....#',
  I: '.####.|..##..|..##..|..##..|..##..|..##..|.####.', J: '...###|....#.|....#.|....#.|#...#.|#...#.|.###..',
  K: '#...#.|#..#..|#.#...|##....|#.#...|#..#..|#...#.', L: '#.....|#.....|#.....|#.....|#.....|#.....|######',
  M: '#....#|##..##|#.##.#|#.##.#|#....#|#....#|#....#', N: '#....#|##...#|#.#..#|#..#.#|#...##|#....#|#....#',
  O: '.####.|#....#|#....#|#....#|#....#|#....#|.####.', P: '#####.|#....#|#....#|#####.|#.....|#.....|#.....',
  Q: '.####.|#....#|#....#|#....#|#..#.#|#...#.|.###.#', R: '#####.|#....#|#....#|#####.|#..#..|#...#.|#....#',
  S: '.####.|#....#|#.....|.####.|.....#|#....#|.####.', T: '######|..##..|..##..|..##..|..##..|..##..|..##..',
  U: '#....#|#....#|#....#|#....#|#....#|#....#|.####.', V: '#....#|#....#|#....#|#....#|.#..#.|.#..#.|..##..',
  W: '#....#|#....#|#....#|#.##.#|#.##.#|##..##|#....#', X: '#....#|.#..#.|..##..|..##..|..##..|.#..#.|#....#',
  Y: '#....#|.#..#.|..##..|..##..|..##..|..##..|..##..', Z: '######|....#.|...#..|..#...|.#....|#.....|######',
  0: '.####.|#...##|#..#.#|#.#..#|##...#|#....#|.####.', 1: '..##..|.###..|..##..|..##..|..##..|..##..|.####.',
  2: '.####.|#....#|.....#|...##.|.##...|#.....|######', 3: '.####.|#....#|.....#|..###.|.....#|#....#|.####.',
  4: '...##.|..#.#.|.#..#.|#...#.|######|....#.|....#.', 5: '######|#.....|#####.|.....#|.....#|#....#|.####.',
  6: '.####.|#.....|#.....|#####.|#....#|#....#|.####.', 7: '######|.....#|....#.|...#..|..#...|..#...|..#...',
  8: '.####.|#....#|#....#|.####.|#....#|#....#|.####.', 9: '.####.|#....#|#....#|.#####|.....#|.....#|.####.',
  '!': '..##..|..##..|..##..|..##..|..##..|......|..##..', '?': '.####.|#....#|....#.|...#..|..#...|......|..#...',
  '.': '......|......|......|......|......|..##..|..##..', ',': '......|......|......|......|..##..|..##..|.#....',
  "'": '..##..|..##..|.#....|......|......|......|......', '-': '......|......|......|.####.|......|......|......',
  ':': '......|..##..|..##..|......|..##..|..##..|......', '&': '.##...|#..#..|.##...|.##..#|#..##.|#...#.|.###.#',
  '+': '......|..##..|..##..|######|..##..|..##..|......', '/': '.....#|....#.|...#..|..#...|.#....|#.....|......',
  '(': '...##.|..#...|.#....|.#....|.#....|..#...|...##.', ')': '.##...|...#..|....#.|....#.|....#.|...#..|.##...',
  '#': '.#..#.|######|.#..#.|.#..#.|######|.#..#.|......', '@': '.####.|#....#|#.##.#|#.##.#|#.###.|#.....|.####.',
  '=': '......|......|######|......|######|......|......', ' ': '......|......|......|......|......|......|......',
  // emoji (8 x 8, drawn one row higher, always yellow)
  '☺': '..####..|.#....#.|#.#..#.#|#......#|#.#..#.#|#..##..#|.#....#.|..####..',
  '☹': '..####..|.#....#.|#.#..#.#|#......#|#..##..#|#.#..#.#|.#....#.|..####..',
  '👍': '....##..|...###..|..###...|########|##.#####|##.####.|##.#####|##.####.',
};
export const EMOJI = ['☺', '☹', '👍'];
const GLYPH = new Map(Object.entries(G).map(([k, v]) => [k, v.split('|').map(r => [...r].map(c => c === '#'))]));
export const FONT_OK = ch => GLYPH.has(ch);
export function cleanText(s, max = 120) { return [...s.toUpperCase()].filter(FONT_OK).slice(0, max).join(''); }
export function glyph(ch) { return GLYPH.get(ch) || GLYPH.get('?'); }
export const isEmoji = ch => EMOJI.includes(ch);
// draw a string in the bitmap font; px = size of one font pixel; color = css or (x) => css. Returns the width.
export function drawBitText(g, s, x, y, px, color, bold = true) {
  let cx = x;
  for (const ch of s) {
    const gl = glyph(ch), em = isEmoji(ch), dy = em ? -px : 0;
    for (let r = 0; r < gl.length; r++) for (let c = 0; c < gl[r].length; c++) {
      if (!gl[r][c]) continue;
      g.fillStyle = em ? '#ffd23a' : typeof color === 'function' ? color(cx + c * px) : color;
      g.fillRect(cx + c * px, y + dy + r * px, px * (bold ? 1.4 : 1), px);
    }
    cx += (gl[0].length + 1) * px;
  }
  return cx - x;
}
export const bitWidth = (s, px) => [...s].reduce((w, ch) => w + (glyph(ch)[0].length + 1) * px, 0);

// ---------------------------------------------------------------- VJ Scroller on the LED wall
export class Scroller {
  constructor(wall, LED) {
    this.wall = wall; this.LED = LED; this.on = false; this.t = 0; this.x = 0; this.n = 0;
    const s = (() => { try { return JSON.parse(localStorage.getItem('vire.scroller') || '{}'); } catch { return {}; } })();
    this.text = s.text || 'CLY3DJ ☺ VINYL IN MIXED REALITY 👍'; this.wave = s.wave ?? 6; this.speed = s.speed ?? 5;
    this.canvas = document.createElement('canvas'); this.canvas.width = 768; this.canvas.height = 128;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = THREE.NearestFilter; this.tex.generateMipmaps = false; this.tex.minFilter = THREE.LinearFilter;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false, depthWrite: false }));
    this.mesh.raycast = () => {};   // never blocks grabbing the wall
    this.mesh.renderOrder = 5; this.mesh.visible = false; this.mesh.userData.noMirror = true;
    this.holder = new THREE.Group(); this.holder.add(this.mesh); wall.add(this.holder);
  }
  save() { try { localStorage.setItem('vire.scroller', JSON.stringify({ text: this.text, wave: this.wave, speed: this.speed })); } catch {} }
  start(text) { if (text != null) this.text = text; this.save(); this.on = true; this.x = this.canvas.width; this.mesh.visible = true; }
  stop() { this.on = false; this.mesh.visible = false; }
  // per frame: keep the band on the bottom edge of the upright picture (the wall may be turned to portrait)
  tick(dt) {
    if (!this.on) return;
    const LED = this.LED, snap = Math.round(this.wall.rotation.z / (Math.PI / 2)) * (Math.PI / 2);
    const side = Math.abs(Math.round(snap / (Math.PI / 2))) % 2 === 1;
    const aW = side ? LED.H : LED.W, aH = side ? LED.W : LED.H, bh = Math.min(aH * 0.3, aW * 128 / 768);
    this.holder.rotation.z = -snap;
    this.mesh.scale.set(aW, bh, 1); this.mesh.position.set(0, -aH / 2 + bh / 2 + aH * 0.02, LED.D / 2 + 0.004);
    this.t += dt;
    if (++this.n % 2) return;   // redraw at half the frame rate (~45 / 36 fps)
    const g = this.g, W = this.canvas.width, H = this.canvas.height, px = 6;
    this.x -= (50 + this.speed * 42) * dt * 2;
    const tw = bitWidth(this.text, px);
    if (this.x < -tw) this.x = W;
    g.clearRect(0, 0, W, H);
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.5, 'rgba(0,0,0,0.28)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    const amp = this.wave * 4.2, base = H / 2 - 3.5 * px, t = this.t;
    // a sine scroller bends every column of every letter on the same wave; rainbow raster colours
    let cx = this.x;
    for (const ch of this.text) {
      const gl = glyph(ch), em = isEmoji(ch), cw = (gl[0].length + 1) * px;
      if (cx > W) break;
      if (cx + cw > 0) for (let c = 0; c < gl[0].length; c++) {
        const x = cx + c * px, y = base + Math.sin(x * 0.011 + t * 3.1) * amp + (em ? -px : 0);
        const col = em ? '#ffd23a' : `hsl(${(x * 0.45 + t * 90) % 360},100%,60%)`;
        for (let r = 0; r < gl.length; r++) {
          if (!gl[r][c]) continue;
          g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x + 3, y + r * px + 3, px * 1.4, px);
          g.fillStyle = col; g.fillRect(x, y + r * px, px * 1.4, px);
        }
      }
      cx += cw;
    }
    this.tex.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- Record Maker: pressings
async function pressDir() { return (await navigator.storage.getDirectory()).getDirectoryHandle('vire-press', { create: true }); }
export async function listPressings() {
  try { const f = await (await (await pressDir()).getFileHandle('index.json')).getFile(); return JSON.parse(await f.text()) || []; } catch { return []; }
}
async function writeIndex(list) {
  const fh = await (await pressDir()).getFileHandle('index.json', { create: true }); const w = await fh.createWritable();
  await w.write(JSON.stringify(list)); await w.close();
}
export async function savePressing(p, labelBlob) {
  if (labelBlob) {
    const fh = await (await pressDir()).getFileHandle(p.id + '.jpg', { create: true }); const w = await fh.createWritable();
    await w.write(labelBlob); await w.close(); p.label = p.id + '.jpg';
  }
  const list = await listPressings(); list.push(p); await writeIndex(list); return p;
}
export async function deletePressing(id) {
  const list = (await listPressings()).filter(p => p.id !== id); await writeIndex(list);
  try { await (await pressDir()).removeEntry(id + '.jpg'); } catch {}
}
export async function readLabel(p) {
  if (!p.label) return null;
  try { return await (await (await pressDir()).getFileHandle(p.label)).getFile(); } catch { return null; }
}
// a square label picture (512 px JPEG, centre crop) from any image file
export async function labelFrom(file) {
  const bm = await createImageBitmap(file); const S = 512, c = new OffscreenCanvas(S, S), g = c.getContext('2d');
  const s = Math.max(S / bm.width, S / bm.height), w = bm.width * s, h = bm.height * s;
  g.drawImage(bm, (S - w) / 2, (S - h) / 2, w, h); bm.close && bm.close();
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
}
// the blank record's sound (#227, was sparse loud clicks over almost no hiss at 22 kHz): 3 minutes of vinyl surface
// noise at 44.1 kHz, built once per session (about 0.5 s of work, in slices), mono 16-bit WAV. Seeded, so every blank sounds and looks
// the same. Layers:
//  - surface hiss: band-limited noise (about 300 Hz to 9 kHz), a little louder and softer once per turn (33 rpm = 1.8 s)
//  - crackle bed: a few hundred tiny ticks a second, sizes on a power law (mostly faint, now and then a loud one),
//    each an impulse rung through a bright band-pass (2 to 6 kHz) so it crackles instead of thudding
//  - pops: a couple a second, lower (about 900 Hz) and longer
//  - two scratches on the vinyl that tick once per turn, at fixed spots
//  - rumble: soft noise under 40 Hz
// Four "tracks" with quieter lead-in gaps, so the grooves show the usual bands; the run-out ticks once per turn.
let blankBuf = null;
export async function blankWav() {   // async: built in 1 s slices between frames, so the headset never hitches
  if (blankBuf) return blankBuf.slice(0);
  const rate = 44100, secs = 180, n = rate * secs, data = new Int16Array(n), TURN = 60 / 33.333, TS = TURN * rate;
  let x = 2463534242; const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  // band-pass biquads, scaled so an impulse of size a rings to a peak of about a
  const bp = (f, q) => { const w = 2 * Math.PI * f / rate, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    return { g: a0 / al, b0: al / a0, b2: -al / a0, a1: -2 * Math.cos(w) / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0, k: 0 }; };
  const run = f => { const v = f.k * f.g; f.k = 0; const y = f.b0 * v + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2; f.x2 = f.x1; f.x1 = v; f.y2 = f.y1; f.y1 = y; return y; };
  const tA = bp(2600, 0.9), tB = bp(4800, 1.1), pop = bp(900, 1.4);
  const gapAt = s => s < 2 || s > secs - 6 || (s > 44 && s < 47) || (s > 90 && s < 93) || (s > 135 && s < 138);
  const next = r => Math.max(1, Math.round(-Math.log(1 - rnd()) * rate / r));   // Poisson: samples to the next event
  let nTick = next(320), nPop = next(1.8);
  const scr = [];   // scratches: once per turn at fixed places on the record, stronger in the run-out
  for (let t = 0; t * TS < n; t++) for (const [p, a] of [[0.23, 0.11], [0.71, 0.06]]) { const at = Math.round((t + p) * TS); if (at < n) scr.push([at, a * (at > n - 6 * rate ? 1.5 : 1)]); }
  scr.sort((a, b) => a[0] - b[0]); let si = 0;
  let hp = 0, hpx = 0, lpH = 0, rum = 0, rum2 = 0, gap = true, wob = 1, hissG = 0.016;
  for (let i = 0; i < n; i++) {
    if (i % rate === 0 && i) await new Promise(r => setTimeout(r, 0));
    if ((i & 1023) === 0) {   // slow things, once per 23 ms
      const s = i / rate; gap = gapAt(s); wob = 1 + 0.25 * Math.sin(2 * Math.PI * s / TURN); hissG = (gap ? 0.009 : 0.016) * wob;
      rum += ((rnd() * 2 - 1) - rum) * 0.15;
    }
    const w = rnd() * 2 - 1; hp = 0.957 * (hp + w - hpx); hpx = w; lpH += (hp - lpH) * 0.72;   // hiss ~300 Hz to 9 kHz
    if (--nTick <= 0) {   // crackle bed: power-law sizes, mostly faint
      const a = Math.min(0.14, 0.003 * Math.pow(rnd() + 1e-4, -0.6)) * (rnd() < 0.5 ? -1 : 1);
      (rnd() < 0.6 ? tA : tB).k += a; nTick = next(gap ? 90 : 320);
    }
    if (--nPop <= 0) { pop.k += (0.04 + rnd() * 0.10) * (rnd() < 0.5 ? -1 : 1); nPop = next(gap ? 0.6 : 1.8); }
    if (si < scr.length && scr[si][0] === i) pop.k += scr[si++][1] * (0.85 + rnd() * 0.3);
    rum2 += (rum - rum2) * 0.004;
    const v = lpH * hissG + run(tA) + run(tB) * 0.8 + run(pop) + rum2 * 0.02;
    data[i] = v > 1 ? 32767 : v < -1 ? -32767 : (v * 32767) | 0;
  }
  const buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const str = (o, t) => { for (let k = 0; k < t.length; k++) dv.setUint8(o + k, t.charCodeAt(k)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * 2, true);
  new Int16Array(buf, 44).set(data);
  blankBuf = buf; return buf.slice(0);
}

// ---------------------------------------------------------------- on-tablet keyboard layout
export const KEY_ROWS = ['1234567890', 'QWERTYUIOP', "ASDFGHJKL'", 'ZXCVBNM,.!?-'];
