// Arrangeable stage (CLAUDE.md #38): turntables, mixer, crate and two flight cases are all separate
// objects in rig space. Gear rests on whichever case is under its centre (or on the floor); moving a
// case carries whatever sits on it; resizing a case lifts what sits on it.
import * as THREE from 'three';
import { FlightCase } from './flightcase.js';

const STORE = 'vire.layout2';

export class Stage {
  // items: { key: { obj: Object3D, base: metres from object origin down to its feet } }
  constructor(rig, items, cases, defaults) {
    this.rig = rig; this.items = items; this.cases = cases; this.defaults = defaults;
    for (const k in cases) rig.add(cases[k].group);
    this.load();
  }
  // ---------- support
  caseTopAt(xr, zr, ignore) { // rig-space point -> highest case top under it
    let best = 0, bestKey = null;
    for (const k in this.cases) {
      if (k === ignore) continue;
      const c = this.cases[k], g = c.group;
      const dx = xr - g.position.x, dz = zr - g.position.z, cs = Math.cos(g.rotation.y), sn = Math.sin(g.rotation.y);
      const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;   // rig -> case-local, no matrices needed
      if (Math.abs(lx) <= c.W / 2 + 0.01 && Math.abs(lz) <= c.D / 2 + 0.01) {
        const top = g.position.y + c.H; if (top > best) { best = top; bestKey = k; }
      }
    }
    return { y: best, key: bestKey };
  }
  // No gravity (CLAUDE.md #42): gear stays exactly where it is put. It only snaps onto a case top when
  // it is let go within a few cm of it (or `force`, used when a case under it is resized).
  settle(key, force = false) {
    const it = this.items[key]; if (!it) return;
    const p = it.obj.position; const s = this.caseTopAt(p.x, p.z);
    if (s.key && (force || Math.abs(p.y - (s.y + it.base)) < 0.06)) { p.y = s.y + it.base; it.on = s.key; }
    else it.on = null;
  }
  settleAll() { for (const k in this.items) this.settle(k); }
  ridersOf(caseKey) {
    return Object.keys(this.items).filter(k => {
      const it = this.items[k]; const p = it.obj.position; const s = this.caseTopAt(p.x, p.z);
      return s.key === caseKey && Math.abs(p.y - (s.y + it.base)) < 0.02;
    });
  }
  // ---------- moving: cases carry their riders by temporarily parenting them
  beginMove(key) {
    const st = { key, riders: [] };
    if (this.cases[key]) {
      const g = this.cases[key].group;
      st.riders = this.ridersOf(key);
      for (const r of st.riders) g.attach(this.items[r].obj);
    }
    return st;
  }
  object(key) { return this.cases[key] ? this.cases[key].group : this.items[key].obj; }
  endMove(st) {
    for (const r of st.riders) this.rig.attach(this.items[r].obj);
    if (this.items[st.key]) this.settle(st.key); else for (const r of st.riders) this.settle(r, true);
    this.save();
  }
  // ---------- resizing a case from a bottom handle (sx, sz in {-1,0,1}); newW/D/H already clamped by the case
  resize(key, W, D, H, anchor) {
    const c = this.cases[key];
    const riders = this.ridersOf(key);
    c.size(W, D, H);
    // keep the far side fixed: shift the centre in case-local x/z
    if (anchor) {
      const g = c.group;
      const cx = anchor.sx ? -anchor.sx * anchor.W0 / 2 + anchor.sx * c.W / 2 : 0;
      const cz = anchor.sz ? -anchor.sz * anchor.D0 / 2 + anchor.sz * c.D / 2 : 0;
      const off = new THREE.Vector3(cx, 0, cz).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y);
      g.position.set(anchor.pos0.x + off.x, anchor.pos0.y, anchor.pos0.z + off.z);
    }
    for (const r of riders) this.settle(r, true);
  }
  // ---------- persistence
  snapshot() {
    const L = { items: {}, cases: {} };
    for (const k in this.items) { const o = this.items[k].obj; L.items[k] = [o.position.x, o.position.y, o.position.z, o.rotation.y]; }
    for (const k in this.cases) { const c = this.cases[k], g = c.group; L.cases[k] = [g.position.x, g.position.y, g.position.z, g.rotation.y, c.W, c.D, c.H]; }
    return L;
  }
  apply(L) {
    for (const k in this.cases) {
      const v = (L.cases || {})[k] || this.defaults.cases[k]; const c = this.cases[k];
      c.group.position.set(v[0], v[1], v[2]); c.group.rotation.set(0, v[3], 0); c.size(v[4], v[5], v[6]);
    }
    for (const k in this.items) {
      const v = (L.items || {})[k] || this.defaults.items[k]; const o = this.items[k].obj;
      o.position.set(v[0], v[1], v[2]); o.rotation.set(0, v[3], 0);
    }
    this.rig.updateMatrixWorld(true);
    this.settleAll();
  }
  save() { try { localStorage.setItem(STORE, JSON.stringify(this.snapshot())); } catch {} }
  load() { let L = this.defaults; try { const s = JSON.parse(localStorage.getItem(STORE)); if (s && s.items && s.cases) L = s; } catch {} this.apply(L); }
  reset() { this.apply(this.defaults); this.save(); }
}
export { FlightCase };
