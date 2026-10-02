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
// the blank record's sound: 3 minutes of quiet vinyl crackle in four "tracks" with lead-in gaps, so the grooves
// show the usual bands; made once per session (16-bit mono WAV, 22.05 kHz)
let blankBuf = null;
export function blankWav() {
  if (blankBuf) return blankBuf.slice(0);
  const rate = 22050, secs = 180, n = rate * secs, data = new Int16Array(n);
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  let lp = 0, pop = 0;
  for (let i = 0; i < n; i++) {
    const s = i / rate, inGap = [44, 90, 135].some(b => s > b && s < b + 3) || s < 2 || s > secs - 4;
    lp += (rnd() * 2 - 1 - lp) * 0.08;                              // soft surface hiss
    if (rnd() < (inGap ? 2 : 7) / rate) pop = (rnd() * 0.25 + 0.05) * (rnd() < 0.5 ? -1 : 1);
    pop *= 0.93;
    const groove = inGap ? 0.004 : 0.012 + 0.006 * Math.sin(s * 0.7);
    data[i] = Math.max(-32767, Math.min(32767, (lp * groove * 4 + pop) * 32767));
  }
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, t) => { for (let k = 0; k < t.length; k++) v.setUint8(o + k, t.charCodeAt(k)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  new Int16Array(buf, 44).set(data);
  blankBuf = buf; return buf.slice(0);
}

// ---------------------------------------------------------------- on-tablet keyboard layout
export const KEY_ROWS = ['1234567890', 'QWERTYUIOP', "ASDFGHJKL'", 'ZXCVBNM,.!?-'];
