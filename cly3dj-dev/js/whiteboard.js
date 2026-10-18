// #395 WHITEBOARD (replaces the #341 chalkboard look): a white enamel board in a brushed aluminium frame with black
// corner caps, like the record crate's panelling. Three magnetic marker pens (black, red, blue) and a magnetic duster
// stick to it. Grip (hands: pinch) a marker to take it: it sits in the hand like a pen, tip forward and a little down;
// touch the board (or a milk crate label) with the tip to write. Let go near the board: it sticks there (magnet);
// let go anywhere else: it flies back to its spot on the board. The duster is held as you grabbed it (felt to the
// board) and rubs out where the felt touches. Markers and duster stay real size on a stretched board.
import * as THREE from 'three';
import { ChatPanel } from './chat.js';
import { MARKER_COLORS, penSeg } from './inklabel.js';

function brushedAlu() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#b9bcc2'; g.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 900; i++) { const y = Math.random() * 64, a = 0.04 + Math.random() * 0.08; g.strokeStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(60,62,68,${a})`; g.lineWidth = 0.5 + Math.random(); g.beginPath(); g.moveTo(0, y); g.lineTo(256, y + (Math.random() - 0.5) * 0.6); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
let _alu = null, _abs = null, _rivet = null;
function mats() {
  if (!_alu) {
    _alu = new THREE.MeshStandardMaterial({ color: 0xc4c7cc, map: brushedAlu(), metalness: 0.85, roughness: 0.42 });
    _abs = new THREE.MeshStandardMaterial({ color: 0x141416, metalness: 0.15, roughness: 0.55 });
    _rivet = new THREE.MeshStandardMaterial({ color: 0x9a9ca1, metalness: 1, roughness: 0.35 });
  }
  return { alu: _alu, abs: _abs, rivet: _rivet };
}
const FW = 0.022, FD = 0.016;   // frame face width and depth (real metres, whatever the board's size)

export class WhiteBoard extends ChatPanel {
  _buildBoard() {
    const W = this.W, H = this.H;
    this.board = false; this.strokes = new Map(); this.bDirty = false; this.bT = 0;
    const BW = 1024, BH = 1280; this.BW = BW; this.BH = BH;
    const base = this.bBase = document.createElement('canvas'); base.width = BW; base.height = BH;
    { const g = base.getContext('2d'); g.fillStyle = '#f3f4f1'; g.fillRect(0, 0, BW, BH);
      let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 22; i++) {   // ghosts of old marker that never quite came off
        g.strokeStyle = `rgba(${90 + rnd() * 60},${100 + rnd() * 40},${130 + rnd() * 60},${0.025 + rnd() * 0.035})`; g.lineWidth = 6 + rnd() * 18; g.lineCap = 'round';
        g.beginPath(); let x = rnd() * BW, y = rnd() * BH; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 300; y += (rnd() - 0.5) * 120; g.lineTo(x, y); } g.stroke();
      }
      for (let i = 0; i < 10; i++) { const x = rnd() * BW, y = rnd() * BH, r = 150 + rnd() * 300, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(150,155,165,${0.03 + rnd() * 0.03})`); gr.addColorStop(1, 'rgba(150,155,165,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }   // duster smears
      const sh = g.createLinearGradient(0, 0, BW, BH); sh.addColorStop(0, 'rgba(255,255,255,0.35)'); sh.addColorStop(0.45, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.05)'); g.fillStyle = sh; g.fillRect(0, 0, BW, BH);   // enamel sheen
    }
    this.bInk = document.createElement('canvas'); this.bInk.width = BW; this.bInk.height = BH; this.bInkG = this.bInk.getContext('2d');
    this.bCanvas = document.createElement('canvas'); this.bCanvas.width = BW; this.bCanvas.height = BH; this.bG = this.bCanvas.getContext('2d');
    this.bTex = new THREE.CanvasTexture(this.bCanvas); this.bTex.colorSpace = THREE.SRGBColorSpace; this.bTex.anisotropy = 4;
    this._compose();
    // the frame: four brushed aluminium rails, black corner caps, a rivet in each rail end
    const M = mats(), fr = this.frame = new THREE.Group(); this.obj.add(fr);
    this.rails = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), M.alu); fr.add(m); return m; });
    this.caps = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), M.abs); fr.add(m); return m; });
    const back = this.obj.children[0]; if (back && back.material) { back.material = M.alu; }
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
    this.scr.material.map = this.board ? this.bTex : this.tex; this.scr.material.color.setHex(this.board ? 0xe9e9e7 : 0xffffff); this.scr.material.needsUpdate = true;
  }
  touch() { return null; }   // fingertips no longer write: take a marker
  // a marker tip / the duster at world point P. Returns 'write' / 'erase' / null
  inkAt(key, P, pen) {
    if (!this.on || !this.board || this.held) { this.strokes.delete(key); return null; }
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P)), sc = this.obj.scale.x, zw = l.z * sc, reach = pen.erase ? 0.012 : 0.004;
    if (Math.abs(l.x) > this.W / 2 || Math.abs(l.y) > this.H / 2 || zw > reach || zw < -0.03) { this.strokes.delete(key); return null; }
    const x = (l.x / this.W + 0.5) * this.BW, y = (0.5 - l.y / this.H) * this.BH, ppm = this.BW / (this.W * sc);
    const r = pen.erase ? (pen.R || 0.045) * ppm : Math.max(1.5, (0.0016 + Math.min(1, Math.max(0, (reach - zw) / 0.012)) * 0.0012) * ppm);
    const last = this.strokes.get(key); this.strokes.set(key, { x, y });
    if (last && Math.hypot(x - last.x, y - last.y) < 250) penSeg(this.bInkG, last.x, last.y, x, y, pen, r); else penSeg(this.bInkG, x, y, x, y, pen, r);
    this.bDirty = true; return pen.erase ? 'erase' : 'write';
  }
  lift(key) { this.strokes.delete(key); }
  tickBoard() { if (this.obj.scale.x !== this._fs) this._fitFrame(); if (this.board && this.bDirty && performance.now() - this.bT > 66) this._compose(); }
  scaleTo(s) { this.obj.scale.setScalar(Math.min(6, Math.max(0.5, s))); this._fitFrame(); }
  reset(save = true) { super.reset(save); if (this.rails) this._fitFrame(); }
}

// ---- the tools: three marker pens and the duster, each a prop (hit / grab / hold / release / obj) for xr.js
const PEN_L = 0.128, PEN_R = 0.0068;
class BoardTool {
  constructor(board, rig, kind, i) {
    this.board = board; this.rig = rig; this.kind = kind; this.i = i; this.held = false; this.flying = null; this.stuck = null;
    const o = this.obj = new THREE.Group(); o.name = kind === 'duster' ? 'boardDuster' : 'marker' + i; o.userData.noMirror = true;
    if (kind === 'marker') {
      const col = this.color = MARKER_COLORS[i];
      const barrel = new THREE.MeshStandardMaterial({ color: 0xe9eaec, roughness: 0.45, metalness: 0.05 }), cm = new THREE.MeshStandardMaterial({ color: col.hex, roughness: 0.4, metalness: 0.05 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(PEN_R, PEN_R, PEN_L * 0.62, 18), barrel); body.position.y = -PEN_L * 0.04; o.add(body);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(PEN_R * 1.01, PEN_R * 1.01, PEN_L * 0.16, 18), cm); band.position.y = -PEN_L * 0.12; o.add(band);   // the colour label round the barrel
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(PEN_R * 1.12, PEN_R * 1.12, PEN_L * 0.26, 18), cm); cap.position.y = -PEN_L * 0.37; o.add(cap);   // the magnetic cap, posted on the back
      const clip = new THREE.Mesh(new THREE.BoxGeometry(0.003, PEN_L * 0.22, 0.0035), cm); clip.position.set(0, -PEN_L * 0.36, PEN_R * 1.2); o.add(clip);
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(PEN_R * 0.45, PEN_R, PEN_L * 0.12, 18), barrel); cone.position.y = PEN_L * 0.33; o.add(cone);
      const nib = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0024, 0.009, 10), new THREE.MeshStandardMaterial({ color: col.hex, roughness: 0.9 })); nib.position.y = PEN_L * 0.39 + 0.0045; o.add(nib);
      this.tipL = new THREE.Vector3(0, PEN_L * 0.39 + 0.009, 0);
      this.pen = { css: col.css };
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
  // stuck on the board: real size, lying on the enamel (marker axis along the board, duster felt to it)
  place() {
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
  _flyTo(dur) {   // ease from where it is (world) to its place on the board
    const b = this.board, o = this.obj; b.obj.attach(o);
    this.flying = { t: 0, dur, p0: o.position.clone(), q0: o.quaternion.clone(), s0: o.scale.x };
  }
  key() { return this.kind + this.i; }
  tick(dt) {
    const f = this.flying; if (!f) return;
    f.t += dt; const k = Math.min(1, f.t / f.dur), e = k * k * (3 - 2 * k);
    this.place(); const p1 = this.obj.position.clone(), q1 = this.obj.quaternion.clone(), s1 = this.obj.scale.x;
    this.obj.position.lerpVectors(f.p0, p1, e); this.obj.position.addScaledVector(_c.set(0, 0, 1), Math.sin(k * Math.PI) * (f.dur > 0.2 ? 0.08 : 0.01) / this.board.obj.scale.x);
    this.obj.quaternion.slerpQuaternions(f.q0, q1, e); this.obj.scale.setScalar(f.s0 + (s1 - f.s0) * e);
    if (k >= 1) { this.flying = null; this.place(); }
  }
  // where it writes / rubs, in world space
  point(out) { return this.obj.localToWorld(out.copy(this.kind === 'marker' ? this.tipL : this.feltL)); }
}

// the set of tools for one board. targets(): ink surfaces (the board, milk crate labels). xr: for the buzz
export function makeBoardTools(board, rig) {
  const tools = [0, 1, 2].map(i => new BoardTool(board, rig, 'marker', i)); tools.push(new BoardTool(board, rig, 'duster', 0));
  board.tools = tools;
  return {
    tools,
    props: () => (board.on ? tools : []),
    tick(dt, targets, xr) {
      for (const t of tools) {
        t.tick(dt);
        if (!t.held) continue;
        t.obj.updateMatrixWorld(); const P = t.point(_p), k = t.key();
        let r = null;
        for (const s of targets) { const rr = s.inkAt ? s.inkAt(k, P, t.pen) : s.touch(k, P, t.pen); if (rr) { r = rr; } }
        if (r && t.holder && xr && performance.now() - (t.buzzT || 0) > (r === 'erase' ? 60 : 90)) { t.buzzT = performance.now(); xr.buzz(t.holder, r === 'erase' ? 0.18 : 0.1, 8); }   // the squeak of felt on enamel
      }
    },
    home() { for (const t of tools) { if (t.held) continue; t.stuck = null; t.flying = null; t.place(); } },
  };
}
function segDist(P, a, b) { _c.subVectors(b, a); const t = Math.max(0, Math.min(1, _d.subVectors(P, a).dot(_c) / _c.lengthSq())); return _d.copy(a).addScaledVector(_c, t).distanceTo(P); }
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _Z = new THREE.Vector3(0, 0, 1);
