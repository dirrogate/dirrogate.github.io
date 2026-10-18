// #395 WHITEBOARD (replaces the #341 chalkboard look): a white enamel board in a brushed aluminium frame with black
// corner caps, like the record crate's panelling. Three magnetic marker pens (black, red, blue) and a magnetic duster
// stick to it. Grip (hands: pinch) a marker to take it: it sits in the hand like a pen, tip forward and a little down;
// touch the board (or a milk crate label) with the tip to write. Let go near the board: it sticks there (magnet);
// let go anywhere else: it flies back to its spot on the board. The duster is held as you grabbed it (felt to the
// board) and rubs out where the felt touches. Markers and duster stay real size on a stretched board.
// #400 (owner: more realistic) the board is lit enamel now (it was an unlit screen): glossy clear coat with a gloss map
// (dull wipe smears and cleaning swirls, matte where there is ink, a little duller where it was rubbed), a fine orange-peel
// bump, ghosts of rubbed-out ink that build up, and felt-tip strokes (chisel width by direction, pooling where the pen
// rests, dry streaks when fast). Markers: open "dirrovinyl" dry-erase pens, no caps, printed barrel, chisel
// felt nib, the owner's Gemini crest embossed on the end plug.
import * as THREE from 'three';
import { ChatPanel } from './chat.js';
import { MARKER_COLORS, penSeg } from './inklabel.js';

function brushedAlu() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#b9bcc2'; g.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 900; i++) { const y = Math.random() * 64, a = 0.04 + Math.random() * 0.08; g.strokeStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(60,62,68,${a})`; g.lineWidth = 0.5 + Math.random(); g.beginPath(); g.moveTo(0, y); g.lineTo(256, y + (Math.random() - 0.5) * 0.6); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
let _alu = null, _abs = null;
function mats() {
  if (!_alu) {
    _alu = new THREE.MeshStandardMaterial({ color: 0xc4c7cc, map: brushedAlu(), metalness: 0.85, roughness: 0.42 });
    _abs = new THREE.MeshStandardMaterial({ color: 0x141416, metalness: 0.15, roughness: 0.55 });
  }
  return { alu: _alu, abs: _abs };
}
const FW = 0.022, FD = 0.016;   // frame face width and depth (real metres, whatever the board's size)
const RB = 26, R_INK = 150, R_RUB = 70;   // gloss map greys (roughness x 255): enamel, dry ink, rubbed

// colour helper for the felt stroke: pools a little darker
function mix(hex, to, k) { const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16); const ch = s => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k); return `rgb(${ch(16)},${ch(8)},${ch(0)})`; }
const PEN_STYLE = MARKER_COLORS.map(c => ({ css: c.css, dark: mix(c.css, '#000000', 0.25) }));

// one felt-tip segment on the board (canvas px). o: { w (half width px), chisel: [x, y] unit or null, v (px/ms), dwell, first, offs: the stroke's streak lines }
function feltSeg(g, x0, y0, x1, y1, st, o) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  let w = o.w;
  if (o.chisel && len > 0.5) { const s = Math.abs((dx * o.chisel[1] - dy * o.chisel[0]) / len); w = o.w * (0.42 + 0.78 * s); }   // across the chisel's wide edge = the full width
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  if (o.first || o.dwell) {   // the felt resting on the enamel: ink pools into a darker dot
    g.globalAlpha = o.first ? 0.35 : 0.12; g.fillStyle = st.dark; g.beginPath(); g.arc(x1, y1, w * 1.12, 0, Math.PI * 2); g.fill();
  }
  if (len > 0.01) {
    const streak = Math.min(1, Math.max(0, (o.v - 1.1) / 1.6));
    g.globalAlpha = 1; g.strokeStyle = st.css; g.lineWidth = 2 * w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();   // solid felt line (one alpha: no beads where segments meet)
    if (streak > 0 && o.offs) {   // fast: the felt runs dry in a few lines that keep their place along the whole stroke
      const nx = -dy / len, ny = dx / len; g.globalCompositeOperation = 'destination-out'; g.lineCap = 'butt';   // butt ends: round ones overlapped into dots
      g.lineJoin = 'round'; const pp = o.pp || [x0, y0];   // from the point before: this segment's round cap filled the end of the last one
      for (const s of o.offs) { g.globalAlpha = streak * s.a; g.lineWidth = Math.max(0.6, s.lw * w); g.beginPath(); g.moveTo(pp[0] + nx * s.o * w, pp[1] + ny * s.o * w); g.lineTo(x0 + nx * s.o * w, y0 + ny * s.o * w); g.lineTo(x1 + nx * s.o * w, y1 + ny * s.o * w); g.stroke(); }
    }
  }
  g.restore();
}

export class WhiteBoard extends ChatPanel {
  _buildBoard() {
    const W = this.W, H = this.H;
    this.board = false; this.strokes = new Map(); this.bDirty = false; this.bT = 0;
    const BW = 1024, BH = 1280; this.BW = BW; this.BH = BH;
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const base = this.bBase = document.createElement('canvas'); base.width = BW; base.height = BH;
    { const g = base.getContext('2d'); g.fillStyle = '#f2f3f0'; g.fillRect(0, 0, BW, BH);
      for (let i = 0; i < 8; i++) { const x = rnd() * BW, y = rnd() * BH, r = 150 + rnd() * 300, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(150,155,165,${0.02 + rnd() * 0.025})`); gr.addColorStop(1, 'rgba(150,155,165,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }   // old duster greying
      const id = g.getImageData(0, 0, BW, BH), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 3; d[i] += n; d[i + 1] += n; d[i + 2] += n; } g.putImageData(id, 0, 0);
    }
    // ghosts of ink rubbed out long ago, and the ones this session's duster leaves (bGhost builds up as you rub)
    this.bGhost = document.createElement('canvas'); this.bGhost.width = BW; this.bGhost.height = BH; this.bGhostG = this.bGhost.getContext('2d');
    { const g = this.bGhostG; for (let i = 0; i < 18; i++) {
      g.strokeStyle = ['#1c47b0', '#15161a', '#c41a26'][i % 3]; g.globalAlpha = 0.025 + rnd() * 0.03; g.lineWidth = 5 + rnd() * 8; g.lineCap = 'round';
      g.beginPath(); let x = rnd() * BW, y = rnd() * BH; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * 240; y += (rnd() - 0.5) * 90; g.lineTo(x, y); } g.stroke(); } g.globalAlpha = 1; }
    this.bInk = document.createElement('canvas'); this.bInk.width = BW; this.bInk.height = BH; this.bInkG = this.bInk.getContext('2d');
    this.bCanvas = document.createElement('canvas'); this.bCanvas.width = BW; this.bCanvas.height = BH; this.bG = this.bCanvas.getContext('2d');
    this.bTex = new THREE.CanvasTexture(this.bCanvas); this.bTex.colorSpace = THREE.SRGBColorSpace; this.bTex.anisotropy = 4;
    // gloss map (half size; roughness in green): glossy enamel, dull smears and cleaning swirls; ink and rubbing dull it
    const RW = 512, RH = 640; this.RW = RW; this.RH = RH;
    const rb = this.rBase = document.createElement('canvas'); rb.width = RW; rb.height = RH;
    { const g = rb.getContext('2d'); g.fillStyle = `rgb(${RB},${RB},${RB})`; g.fillRect(0, 0, RW, RH);
      for (let i = 0; i < 14; i++) { const x = rnd() * RW, y = rnd() * RH, r = 40 + rnd() * 140, v = 60 + rnd() * 50, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${v},${v},${v},0.55)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }   // wipe smears
      g.lineCap = 'round'; for (let i = 0; i < 40; i++) { const v = 50 + rnd() * 40; g.strokeStyle = `rgba(${v},${v},${v},${0.15 + rnd() * 0.2})`; g.lineWidth = 2 + rnd() * 6; const cx = rnd() * RW, cy = rnd() * RH, r = 20 + rnd() * 70, a = rnd() * 6; g.beginPath(); g.arc(cx, cy, r, a, a + 1 + rnd() * 2.5); g.stroke(); }   // cleaning swirls
    }
    this.rCanvas = document.createElement('canvas'); this.rCanvas.width = RW; this.rCanvas.height = RH; this.rG = this.rCanvas.getContext('2d'); this.rG.drawImage(rb, 0, 0);
    this.rTex = new THREE.CanvasTexture(this.rCanvas); this.rTex.colorSpace = THREE.NoColorSpace;
    // orange peel: a fine soft ripple in the enamel, only seen in the reflections
    const pc = document.createElement('canvas'); pc.width = pc.height = 256;
    { const g = pc.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 1400; i++) { const x = rnd() * 256, y = rnd() * 256, r = 3 + rnd() * 7, v = rnd() < 0.5 ? 255 : 0, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${v},${v},${v},0.10)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`); for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) { g.save(); g.translate(ox, oy); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); g.restore(); } } }
    const peel = new THREE.CanvasTexture(pc); peel.wrapS = peel.wrapT = THREE.RepeatWrapping; peel.repeat.set(5, 6); peel.colorSpace = THREE.NoColorSpace;
    this.bMat = new THREE.MeshPhysicalMaterial({ map: this.bTex, roughness: 1, roughnessMap: this.rTex, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 1, clearcoatRoughnessMap: this.rTex, bumpMap: peel, bumpScale: 0.35, specularIntensity: 0.6, envMapIntensity: 1 });
    this._compose();
    // the frame: four brushed aluminium rails, black corner caps
    const M = mats(), fr = this.frame = new THREE.Group(); this.obj.add(fr);
    this.rails = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), M.alu); fr.add(m); return m; });
    this.caps = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), M.abs); fr.add(m); return m; });
    const back = this.obj.children[0]; if (back && back.material) back.material = M.alu;
    this._fs = 0; this._fitFrame();
  }
  _fitFrame() {
    const s = this.obj.scale.x, W = this.W, H = this.H, fw = FW / s, fd = FD / s, cz = (FD / 2 - 0.004) / s;
    const [top, bot, lft, rgt] = this.rails;
    top.scale.set(W + 2 * fw, fw, fd); top.position.set(0, H / 2 + fw / 2, cz);
    bot.scale.set(W + 2 * fw, fw, fd); bot.position.set(0, -H / 2 - fw / 2, cz);
    lft.scale.set(fw, H, fd); lft.position.set(-W / 2 - fw / 2, 0, cz);
    rgt.scale.set(fw, H, fd); rgt.position.set(W / 2 + fw / 2, 0, cz);
    const c = 0.03 / s;
    [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sy], i) => { this.caps[i].scale.set(c, c, fd * 1.25); this.caps[i].position.set(sx * (W / 2 + fw / 2), sy * (H / 2 + fw / 2), cz + 0.001 / s); });
    this._fs = s;
    if (this.tools) for (const t of this.tools) if (!t.held && !t.flying) t.place();
  }
  setBoard(on) {
    this.board = !!on; this.strokes.clear();
    if (!this._scrMat0) this._scrMat0 = this.scr.material;
    this.scr.material = this.board ? this.bMat : this._scrMat0;   // #400 lit enamel (the chat look stays an unlit screen)
  }
  _compose() {
    const g = this.bG; g.drawImage(this.bBase, 0, 0); g.drawImage(this.bGhost, 0, 0); g.drawImage(this.bInk, 0, 0);
    this.bTex.needsUpdate = true; if (this.rTex) this.rTex.needsUpdate = true; this.bDirty = false; this.bT = performance.now();
  }
  wipe() {   // the tablet's WIPE: a proper clean with spray: ink gone, the ghosts mostly too, the gloss back
    this.bInkG.clearRect(0, 0, this.BW, this.BH);
    const g = this.bGhostG; g.save(); g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.7; g.fillRect(0, 0, this.BW, this.BH); g.restore();
    this.rG.drawImage(this.rBase, 0, 0); this._compose();
  }
  touch() { return null; }   // fingertips no longer write: take a marker
  // a marker tip / the duster at world point P. extra: { chisel: world vector of the nib's wide edge }. Returns 'write' / 'erase' / null
  inkAt(key, P, pen, extra) {
    if (!this.on || !this.board || this.held) { this.strokes.delete(key); return null; }
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P)), sc = this.obj.scale.x, zw = l.z * sc, reach = pen.erase ? 0.012 : 0.004;
    if (Math.abs(l.x) > this.W / 2 || Math.abs(l.y) > this.H / 2 || zw > reach || zw < -0.03) { this.strokes.delete(key); return null; }
    const x = (l.x / this.W + 0.5) * this.BW, y = (0.5 - l.y / this.H) * this.BH, ppm = this.BW / (this.W * sc), now = performance.now();
    const last = this.strokes.get(key); this.strokes.set(key, { x, y, t: now, px: last ? last.x : x, py: last ? last.y : y, offs: last ? last.offs : [0, 1, 2].map(() => ({ o: (Math.random() - 0.5) * 1.3, a: 0.3 + Math.random() * 0.4, lw: 0.12 + Math.random() * 0.22 })) });
    const k = this.RW / this.BW, jump = last && Math.hypot(x - last.x, y - last.y) > 250, x0 = last && !jump ? last.x : x, y0 = last && !jump ? last.y : y;
    if (pen.erase) {
      const r = (pen.R || 0.045) * ppm;
      // a duster never takes it all: a trace of what it rubs goes into the ghosts
      const g = this.bGhostG; g.save(); g.beginPath(); g.arc(x, y, r * 0.9, 0, Math.PI * 2); g.clip(); g.globalAlpha = 0.05; g.drawImage(this.bInk, 0, 0); g.restore();
      penSeg(this.bInkG, x0, y0, x, y, pen, r);
      const rg = this.rG, gr = rg.createRadialGradient(x * k, y * k, 0, x * k, y * k, r * k); gr.addColorStop(0, `rgba(${R_RUB},${R_RUB},${R_RUB},0.35)`); gr.addColorStop(1, `rgba(${R_RUB},${R_RUB},${R_RUB},0)`);
      rg.fillStyle = gr; rg.fillRect(x * k - r * k, y * k - r * k, 2 * r * k, 2 * r * k);   // rubbed: a touch duller
      this.bDirty = true; return 'erase';
    }
    const st = pen.style || { css: pen.css, core: pen.css, dark: pen.css };
    const press = Math.min(1, Math.max(0, (reach - zw) / 0.012)), w = Math.max(1.5, (0.0019 + press * 0.0011) * ppm);
    let chisel = null;
    if (extra && extra.chisel) { const c = _c.copy(extra.chisel).applyQuaternion(this.obj.getWorldQuaternion(_q).invert()); const n = Math.hypot(c.x, c.y); if (n > 0.2) chisel = [c.x / n, -c.y / n]; }
    const dt = last ? now - last.t : 0, d = Math.hypot(x - x0, y - y0);
    feltSeg(this.bInkG, x0, y0, x, y, st, { w, chisel, v: dt > 0 ? d / dt : 0, first: !last || jump, dwell: last && d < 0.6 && dt > 30, offs: this.strokes.get(key).offs, pp: last && !jump ? [last.px, last.py] : null });
    const rg = this.rG; rg.save(); rg.strokeStyle = `rgb(${R_INK},${R_INK},${R_INK})`; rg.lineCap = 'round'; rg.lineWidth = 2 * w * k * 1.1; rg.beginPath(); rg.moveTo(x0 * k, y0 * k); rg.lineTo(x * k + 0.01, y * k); rg.stroke(); rg.restore();   // dry ink is matte on the gloss
    this.bDirty = true; return 'write';
  }
  lift(key) { this.strokes.delete(key); }
  tickBoard() { if (this.obj.scale.x !== this._fs) this._fitFrame(); if (this.board && this.bDirty && performance.now() - this.bT > 66) this._compose(); }
  scaleTo(s) { this.obj.scale.setScalar(Math.min(6, Math.max(0.5, s))); this._fitFrame(); }
  reset(save = true) { super.reset(save); if (this.rails) this._fitFrame(); }
}

// ---- the tools: three dirrovinyl marker pens and the duster, each a prop (hit / grab / hold / release / obj) for xr.js
const PEN_L = 0.13, PEN_R = 0.0072;
// the printed barrel: the canvas runs round the barrel (x) and along it (y, top = the nib end)
function barrelLabel(col, name) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 1024; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 512, 0); gr.addColorStop(0, '#f4f5f6'); gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(1, '#eceef0');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 1024);
  g.fillStyle = col.css; g.fillRect(0, 930, 512, 94);   // a colour band at the back, by the end plug
  g.fillRect(0, 868, 512, 18);
  // u = 0 faces the barrel's +z (out of the board when it is stuck there): the wordmark at u = 0 and 0.5 (x 0 / 512 wrap,
  // and 256), the small print on the sides (x 128 / 384)
  for (const cx of [0, 256, 512]) {
    g.save(); g.translate(cx, 470); g.rotate(-Math.PI / 2);
    g.fillStyle = col.css; g.beginPath(); g.roundRect(-330, -62, 660, 124, 22); g.fill();
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 88px system-ui,sans-serif';
    try { g.letterSpacing = '-2px'; } catch {}
    g.fillText('dirrovinyl', 18, 4); try { g.letterSpacing = '0px'; } catch {}
    g.beginPath(); g.arc(-276, 0, 24, 0, Math.PI * 2); g.fill(); g.fillStyle = col.css; g.beginPath(); g.arc(-276, 0, 8, 0, Math.PI * 2); g.fill();   // a little record before the name
    g.restore();
  }
  for (const cx of [128, 384]) {
    g.save(); g.translate(cx, 470); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#4c5159'; g.font = '700 34px system-ui,sans-serif'; g.fillText('DRY ERASE  ·  CHISEL TIP  ·  ' + name, 0, -26);
    g.fillStyle = '#8a8f97'; g.font = '500 26px system-ui,sans-serif'; g.fillText('LOW ODOUR · NON-TOXIC · WHITEBOARDS & VINYL CRATES', 0, 22);
    g.restore();
  }
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.035})`; g.fillRect(Math.random() * 512, Math.random() * 1024, 1 + Math.random() * 3, 1); }   // handling scuffs
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
let gemTex = null;
function gemini() { if (!gemTex) { gemTex = new THREE.TextureLoader().load('models/avatar/gemini_emboss.png'); gemTex.colorSpace = THREE.NoColorSpace; gemTex.anisotropy = 4; } return gemTex; }

class BoardTool {
  constructor(board, rig, kind, i) {
    this.board = board; this.rig = rig; this.kind = kind; this.i = i; this.held = false; this.flying = null; this.stuck = null;
    const o = this.obj = new THREE.Group(); o.name = kind === 'duster' ? 'boardDuster' : 'marker' + i; o.userData.noMirror = true;
    if (kind === 'marker') {
      const col = this.color = MARKER_COLORS[i], seg = 36;
      const barrelM = new THREE.MeshPhysicalMaterial({ map: barrelLabel(col, col.name), roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.25 });
      const plastic = new THREE.MeshPhysicalMaterial({ color: 0xe8e9eb, roughness: 0.38, clearcoat: 0.2 });
      const colM = new THREE.MeshPhysicalMaterial({ color: col.hex, roughness: 0.35, clearcoat: 0.4, clearcoatRoughness: 0.2 });
      const y = v => v - PEN_L / 2;   // lengths from the back end
      const add = (geo, m, y0, y1) => { const me = new THREE.Mesh(geo, m); me.position.y = y((y0 + y1) / 2); o.add(me); return me; };
      add(new THREE.CylinderGeometry(PEN_R * 0.97, PEN_R * 0.92, 0.008, seg), colM, 0, 0.008);   // the end plug
      const face = new THREE.Mesh(new THREE.CircleGeometry(PEN_R * 0.9, seg), new THREE.MeshPhysicalMaterial({ color: col.hex, roughness: 0.4, clearcoat: 0.4, bumpMap: gemini(), bumpScale: 3 }));
      face.rotation.x = Math.PI / 2; face.position.y = y(-0.0002); o.add(face);   // #400 the Gemini crest embossed on the back
      add(new THREE.CylinderGeometry(PEN_R, PEN_R, 0.094, seg), barrelM, 0.008, 0.102);   // the printed barrel
      add(new THREE.CylinderGeometry(PEN_R * 0.52, PEN_R, 0.016, seg), plastic, 0.102, 0.118);   // the tapered grip
      for (let r = 0; r < 4; r++) add(new THREE.TorusGeometry(PEN_R * (0.95 - r * 0.1), 0.0004, 6, seg), plastic, 0.104 + r * 0.0035, 0.104 + r * 0.0035).rotation.x = Math.PI / 2;   // grip rings
      add(new THREE.CylinderGeometry(PEN_R * 0.42, PEN_R * 0.5, 0.004, seg), colM, 0.118, 0.122);   // the collar
      const felt = new THREE.MeshStandardMaterial({ color: col.hex, roughness: 1 });
      const nib = add(new THREE.BoxGeometry(0.0055, 0.0085, 0.0024), felt, 0.122, 0.1305);   // the chisel nib (wide edge along x)
      nib.rotation.x = 0.0; nib.geometry.translate(0, 0, 0); this.nib = nib;
      this.tipL = new THREE.Vector3(0, y(0.1305), 0);
      this.pen = { css: col.css, style: PEN_STYLE[i] };
      // in the hand like a pen: tip forward and 30 deg down from the grip, barrel through the fist
      const dir = new THREE.Vector3(0, -0.5, -0.866), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      this.penOff = new THREE.Matrix4().compose(dir.clone().multiplyScalar(0.03), q, new THREE.Vector3(1, 1, 1));
    } else {
      const wood = new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.5, metalness: 0.2 }), felt = new THREE.MeshStandardMaterial({ color: 0x8b8f96, roughness: 1 });
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.05, 0.022), wood); top.position.z = 0.013; o.add(top);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.012), wood); grip.position.z = 0.03; o.add(grip);
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.05, 0.004), felt); f.position.z = 0.0; o.add(f);
      this.feltL = new THREE.Vector3(0, 0, -0.002);
      this.pen = { erase: true, R: 0.045 };
    }
    this.dock = this.home();
    board.obj.add(o); this.place();
  }
  home() {   // its spot on the board, in real metres from the board's corner
    const W = this.board.W, H = this.board.H;
    return this.kind === 'duster' ? { x: -W / 2, y: -H / 2, dx: 0.075, dy: 0.045, ang: 0 } : { x: W / 2, y: -H / 2, dx: -0.085, dy: 0.03 + this.i * 0.024, ang: -Math.PI / 2 };
  }
  place() {   // stuck on the board: real size, lying on the enamel (marker axis along the board, duster felt to it)
    const b = this.board, s = b.obj.scale.x, d = this.stuck || this.dock, o = this.obj;
    if (o.parent !== b.obj) b.obj.add(o);
    o.scale.setScalar(1 / s);
    const z = (this.kind === 'duster' ? 0.002 : PEN_R + 0.0008) / s;
    o.position.set(d.x + (d.dx || 0) / s, d.y + (d.dy || 0) / s, z);
    o.quaternion.setFromAxisAngle(_Z, d.ang || 0);
  }
  hit(P) {
    if (!this.board.on || this.flying) return false;
    this.obj.updateMatrixWorld();
    if (this.kind === 'marker') {
      const a = this.obj.localToWorld(_a.set(0, -PEN_L / 2, 0)), b = this.obj.localToWorld(_b.set(0, PEN_L / 2, 0));
      return segDist(P, a, b) < 0.022;
    }
    const l = this.obj.worldToLocal(_v.copy(P)), s = this.obj.getWorldScale(_s).x;
    return Math.abs(l.x * s) < 0.075 && Math.abs(l.y * s) < 0.045 && l.z * s > -0.02 && l.z * s < 0.06;
  }
  grab(st) { this.held = true; this.holder = st || null; this.flying = null; this.rig.attach(this.obj); this.obj.scale.setScalar(1); }
  hold(world) { this.rig.updateMatrixWorld(); _m.copy(this.rig.matrixWorld).invert().multiply(world); _m.decompose(this.obj.position, this.obj.quaternion, _s); this.obj.scale.setScalar(1); }
  release() {
    this.held = false; this.holder = null; this.board.lift(this.key());
    const b = this.board; b.obj.updateMatrixWorld();
    const c = this.obj.getWorldPosition(_v), l = b.obj.worldToLocal(_a.copy(c)), s = b.obj.scale.x;
    if (b.on && Math.abs(l.x) < b.W / 2 && Math.abs(l.y) < b.H / 2 && l.z * s > -0.02 && l.z * s < 0.07) {   // near the enamel: the magnet takes it where it is
      let ang = 0;
      if (this.kind === 'marker') { const ax = _b.set(0, 1, 0).applyQuaternion(this.obj.getWorldQuaternion(_q)); const la = ax.applyQuaternion(b.obj.getWorldQuaternion(_q2).invert()); ang = Math.atan2(-la.x, la.y); }
      else { const ax = _b.set(1, 0, 0).applyQuaternion(this.obj.getWorldQuaternion(_q)); const la = ax.applyQuaternion(b.obj.getWorldQuaternion(_q2).invert()); ang = Math.atan2(la.y, la.x); }
      this.stuck = { x: l.x, y: l.y, ang }; this._flyTo(0.12); return 'stuck';
    }
    this.stuck = null; this._flyTo(0.45); return 'home';   // let go in the air: back to its spot on the board
  }
  _flyTo(dur) { const b = this.board, o = this.obj; b.obj.attach(o); this.flying = { t: 0, dur, p0: o.position.clone(), q0: o.quaternion.clone(), s0: o.scale.x }; }
  key() { return this.kind + this.i; }
  tick(dt) {
    const f = this.flying; if (!f) return;
    f.t += dt; const k = Math.min(1, f.t / f.dur), e = k * k * (3 - 2 * k);
    this.place(); const p1 = this.obj.position.clone(), q1 = this.obj.quaternion.clone(), s1 = this.obj.scale.x;
    this.obj.position.lerpVectors(f.p0, p1, e); this.obj.position.addScaledVector(_c.set(0, 0, 1), Math.sin(k * Math.PI) * (f.dur > 0.2 ? 0.08 : 0.01) / this.board.obj.scale.x);
    this.obj.quaternion.slerpQuaternions(f.q0, q1, e); this.obj.scale.setScalar(f.s0 + (s1 - f.s0) * e);
    if (k >= 1) { this.flying = null; this.place(); }
  }
  point(out) { return this.obj.localToWorld(out.copy(this.kind === 'marker' ? this.tipL : this.feltL)); }   // where it writes / rubs, world
  chisel(out) { return out.set(1, 0, 0).applyQuaternion(this.obj.getWorldQuaternion(_q)); }   // the nib's wide edge, world
}

// the set of tools for one board. targets: ink surfaces (the board, milk crate labels). xr: for the buzz
export function makeBoardTools(board, rig) {
  const tools = [0, 1, 2].map(i => new BoardTool(board, rig, 'marker', i)); tools.push(new BoardTool(board, rig, 'duster', 0));
  board.tools = tools;
  const ex = { chisel: new THREE.Vector3() };
  return {
    tools,
    props: () => (board.on ? tools : []),
    tick(dt, targets, xr) {
      for (const t of tools) {
        t.tick(dt);
        if (!t.held) continue;
        t.obj.updateMatrixWorld(); const P = t.point(_p), k = t.key();
        if (t.kind === 'marker') t.chisel(ex.chisel);
        let r = null;
        for (const s of targets) { const rr = s.inkAt ? s.inkAt(k, P, t.pen, ex) : s.touch(k, P, t.pen); if (rr) r = rr; }
        if (r && t.holder && xr && performance.now() - (t.buzzT || 0) > (r === 'erase' ? 60 : 90)) { t.buzzT = performance.now(); xr.buzz(t.holder, r === 'erase' ? 0.18 : 0.1, 8); }   // the squeak of felt on enamel
      }
    },
    home() { for (const t of tools) { if (t.held) continue; t.stuck = null; t.flying = null; t.place(); } },
  };
}
function segDist(P, a, b) { _c.subVectors(b, a); const t = Math.max(0, Math.min(1, _d.subVectors(P, a).dot(_c) / _c.lengthSq())); return _d.copy(a).addScaledVector(_c, t).distanceTo(P); }
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _Z = new THREE.Vector3(0, 0, 1);
