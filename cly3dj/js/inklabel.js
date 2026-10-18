// #394 ink surfaces: the weather-beaten labels on the milk crates, and the marker strokes shared with the whiteboard.
// A label is a canvas texture (aged paper base + an ink layer) on one or more planes; a marker tip or the duster
// touching a plane draws on / rubs out the ink layer. The ink is kept per crate in localStorage as a PNG.
import * as THREE from 'three';

export const MARKER_COLORS = [
  { name: 'BLACK', hex: 0x1a1b1f, css: '#15161a' },
  { name: 'RED', hex: 0xc8202c, css: '#c41a26' },
  { name: 'BLUE', hex: 0x1f4fb8, css: '#1c47b0' },
];
// handwriting stack: Quest browser (Android) has Coming Soon / Dancing Script; Windows Segoe Print / Ink Free
export const HAND_FONT = '"Permanent Marker","Segoe Print","Ink Free","Bradley Hand","Coming Soon","Comic Sans MS",cursive';

// one marker stroke segment in canvas pixels: a felt nib, solid in the middle, a little uneven at the edge
export function penSeg(g, x0, y0, x1, y1, pen, r) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / Math.max(0.6, r * 0.35)));
  g.save();
  if (pen.erase) {
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.7, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  } else {
    g.strokeStyle = pen.css; g.lineCap = 'round'; g.lineJoin = 'round';
    g.globalAlpha = pen.alpha || 0.92; g.lineWidth = 2 * r; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.globalAlpha = 0.25; g.lineWidth = 2 * r * 1.18; g.stroke();   // the felt bleeding a little at the edges
  }
  g.restore();
}

// aged paper label: yellowed, stained, scuffed, torn corners, two strips of old tape. Seeded so each crate differs.
function paperBase(W, H, seed) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  let s = seed * 9301 + 49297; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // torn outline
  const pts = [], m = 10, j = () => (rnd() - 0.5) * 7;
  for (let x = m; x <= W - m; x += 14) pts.push([x, m + j()]);
  for (let y = m; y <= H - m; y += 14) pts.push([W - m + j(), y]);
  for (let x = W - m; x >= m; x -= 14) pts.push([x, H - m + j()]);
  for (let y = H - m; y >= m; y -= 14) pts.push([m + j(), y]);
  const cut = Math.floor(rnd() * 4); pts.splice(cut * Math.floor(pts.length / 4), 3);   // one corner torn off
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
  g.save(); g.clip();
  const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#e2d3a8'); gr.addColorStop(0.5, '#d8c48f'); gr.addColorStop(1, '#c9b27a');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) {   // water stains and grime
    const x = rnd() * W, y = rnd() * H, r = 20 + rnd() * 110, st = g.createRadialGradient(x, y, r * 0.6, x, y, r);
    const a = 0.08 + rnd() * 0.16; st.addColorStop(0, `rgba(120,90,40,${a * 0.4})`); st.addColorStop(0.92, `rgba(105,75,30,${a})`); st.addColorStop(1, 'rgba(105,75,30,0)');
    g.fillStyle = st; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(80,60,30,${0.05 + rnd() * 0.12})`; g.lineWidth = 0.6 + rnd() * 1.5; g.beginPath(); const x = rnd() * W, y = rnd() * H; g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 80, y + (rnd() - 0.5) * 18); g.stroke(); }   // scuffs
  const ed = g.createLinearGradient(0, 0, 0, H); ed.addColorStop(0, 'rgba(90,65,25,0.28)'); ed.addColorStop(0.12, 'rgba(90,65,25,0)'); ed.addColorStop(0.88, 'rgba(90,65,25,0)'); ed.addColorStop(1, 'rgba(90,65,25,0.32)');
  g.fillStyle = ed; g.fillRect(0, 0, W, H);   // darker, dirtier edges
  const id = g.getImageData(0, 0, W, H), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 18; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.8; } g.putImageData(id, 0, 0);   // paper grain
  g.restore();
  g.strokeStyle = 'rgba(70,50,20,0.35)'; g.lineWidth = 2; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
  for (const side of [0, 1]) {   // old yellowed tape
    g.save(); g.translate(side ? W - 30 : 30, H / 2 + (rnd() - 0.5) * 30); g.rotate((side ? 1 : -1) * (1.45 + rnd() * 0.2));
    g.fillStyle = 'rgba(232,214,150,0.55)'; g.fillRect(-H * 0.32, -16, H * 0.64, 32);
    g.strokeStyle = 'rgba(150,120,60,0.35)'; g.lineWidth = 1; g.strokeRect(-H * 0.32, -16, H * 0.64, 32); g.restore();
  }
  return c;
}

export class InkLabel {
  // w, h in metres; planes are added with addPlane(parent, position, rotationY)
  constructor(w, h, opts = {}) {
    this.w = w; this.h = h; this.key = opts.key || null;
    const CW = 512, CH = Math.round(512 * h / w); this.CW = CW; this.CH = CH;
    this.base = paperBase(CW, CH, opts.seed || 1);
    this.ink = document.createElement('canvas'); this.ink.width = CW; this.ink.height = CH; this.inkG = this.ink.getContext('2d');
    this.canvas = document.createElement('canvas'); this.canvas.width = CW; this.canvas.height = CH; this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    this.mat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.92, metalness: 0, transparent: true, alphaTest: 0.05 });
    this.planes = []; this.strokes = new Map(); this.dirty = false; this.t = 0; this.saveT = 0;
    this.load(); this.compose();
  }
  addPlane(parent, pos, rotY) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(this.w, this.h), this.mat);
    m.position.copy(pos); m.rotation.y = rotY; m.userData.inkLabel = this; m.renderOrder = 1; parent.add(m); this.planes.push(m); return m;
  }
  compose() { const g = this.g; g.clearRect(0, 0, this.CW, this.CH); g.drawImage(this.base, 0, 0); g.drawImage(this.ink, 0, 0); this.tex.needsUpdate = true; this.dirty = false; this.t = performance.now(); }
  // world point P from a marker tip (pen = colour) or the duster (pen.erase, pen.R metres). Returns 'write' / 'erase' / null
  touch(key, P, pen) {
    for (const m of this.planes) {
      if (!m.visible || !m.parent || !m.parent.visible) continue;
      m.updateMatrixWorld(); const l = m.worldToLocal(_v.copy(P)), ws = m.getWorldScale(_s).x || 1, zw = l.z * ws;
      const reach = pen.erase ? 0.012 : 0.004;
      if (Math.abs(l.x) > this.w / 2 + (pen.erase ? 0.03 : 0) || Math.abs(l.y) > this.h / 2 + (pen.erase ? 0.03 : 0) || zw > reach || zw < -0.025) continue;
      const k = key + '|' + this.planes.indexOf(m), x = (l.x / this.w + 0.5) * this.CW, y = (0.5 - l.y / this.h) * this.CH, ppm = this.CW / this.w;
      const r = pen.erase ? (pen.R || 0.04) * ppm : Math.max(1.5, (0.0016 + Math.min(1, Math.max(0, (reach - zw) / 0.012)) * 0.0012) * ppm);
      const last = this.strokes.get(k); this.strokes.set(k, { x, y });
      for (const kk of this.strokes.keys()) if (kk !== k && kk.startsWith(key + '|')) this.strokes.delete(kk);
      if (last && Math.hypot(x - last.x, y - last.y) < this.CW * 0.4) penSeg(this.inkG, last.x, last.y, x, y, pen, r); else penSeg(this.inkG, x, y, x, y, pen, r);
      this.dirty = true; return pen.erase ? 'erase' : 'write';
    }
    this.lift(key); return null;
  }
  lift(key) { for (const kk of [...this.strokes.keys()]) if (kk.startsWith(key + '|')) this.strokes.delete(kk); }
  // the playlist's name, written like a quick marker scrawl (a little crooked, letters jittered)
  writeText(text, css = MARKER_COLORS[0].css) {
    const g = this.inkG, W = this.CW, H = this.CH; text = (text || '').toUpperCase().slice(0, 28); if (!text) return;
    let fs = Math.round(H * 0.52); g.font = `700 ${fs}px ${HAND_FONT}`;
    while (fs > 16 && g.measureText(text).width > W * 0.8) { fs -= 2; g.font = `700 ${fs}px ${HAND_FONT}`; }
    const tw = g.measureText(text).width; let x = (W - tw) / 2; const y0 = H * 0.56;
    g.save(); g.fillStyle = css; g.textBaseline = 'middle'; g.globalAlpha = 0.9;
    const tilt = (Math.random() - 0.5) * 0.06;
    for (const ch of text) {
      const cw = g.measureText(ch).width;
      g.save(); g.translate(x + cw / 2, y0 + (x - W / 2) * tilt + (Math.random() - 0.5) * fs * 0.06); g.rotate((Math.random() - 0.5) * 0.09 + tilt);
      g.strokeStyle = css; g.lineWidth = fs * 0.075; g.lineJoin = 'round'; g.strokeText(ch, -cw / 2, 0); g.fillText(ch, -cw / 2, 0); g.globalAlpha = 0.3; g.fillText(ch, -cw / 2 + 0.8, 0.6); g.restore(); x += cw * 1.04;   // a fat felt tip
    }
    g.restore();
    this.compose(); this.save(true);
  }
  clear() { this.inkG.clearRect(0, 0, this.CW, this.CH); this.compose(); this.save(true); }
  tick() {
    const now = performance.now();
    if (this.dirty && now - this.t > 66) { this.compose(); this.saveT = now; this.pend = true; }
    if (this.pend && now - this.saveT > 1500 && !this.strokes.size) this.save(true);
  }
  save(now) { this.pend = false; if (!this.key) return; try { localStorage.setItem('vire.milkLabel.' + this.key, this.ink.toDataURL('image/png')); } catch {} }
  load() {
    if (!this.key) return; let u = null; try { u = localStorage.getItem('vire.milkLabel.' + this.key); } catch {}
    if (!u) return; const im = new Image(); im.onload = () => { this.inkG.drawImage(im, 0, 0, this.CW, this.CH); this.compose(); }; im.src = u;
  }
  forget() { if (this.key) try { localStorage.removeItem('vire.milkLabel.' + this.key); } catch {} }
  dispose() { for (const m of this.planes) { m.parent && m.parent.remove(m); m.geometry.dispose(); } this.tex.dispose(); this.mat.dispose(); }
}
const _v = new THREE.Vector3(), _s = new THREE.Vector3();
