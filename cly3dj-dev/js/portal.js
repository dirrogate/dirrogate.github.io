// #345 PORTAL (owner): a rectangular "real world window". Cut it into any prop or room (FacetWall today; any future
// glb room/cabin later, one call: Portals.cutInto(obj)) and the part of that mesh seen through the rectangle stops
// drawing, so whatever is really there shows instead -- the Quest's passthrough camera in AR, or just empty space in VR.
// A thin bezel frame marks its edges in passthrough and on the Twitch picture (HEADSET CAM / SHOWTIME! both render
// the normal scene, so the cut shows up there too with no extra plumbing).
// #346 (owner): up to MAX_PORTALS frames (the PORTALS SETUP page sets how many), each any rectangle: trigger / pinch
// on the silver handle on its right side = width, on its top = height, on the corner L = both (grip anywhere on the
// frame moves it, a second grip stretches it evenly). The cut is now a true window: from each eye (and each stream
// camera) only what lies BEYOND the frame, seen through it, is removed -- so with the wall wrapped all the way round,
// a portal in front never punches through the panels behind the DJ, and it cuts the sky dome behind it too.
import * as THREE from 'three';

export const MAX_PORTALS = 6;
const KEY = 'vire.portals', OLD_KEY = 'vire.portal';   // #345 kept one portal under vire.portal
const HALF0 = new THREE.Vector2(0.3, 0.75);   // a new frame's half-size (metres) -- ~ a floor mirror
const HMIN = 0.08, HMAX = 2.5;                // half-size limits per side: 16 cm .. 5 m
const T = 0.014, D = 0.01, GRAB = 0.04;       // bezel bar, depth, handle reach (m)

// Shared GLSL injected into any material's own shader. World position -> each portal's local space (its inverse world
// matrix); the line from the camera to this fragment crosses the portal's plane inside its rectangle = discard.
const DECL = `
#ifdef USE_PORTAL
  uniform mat4 portalInv[${MAX_PORTALS}]; uniform vec2 portalHalf[${MAX_PORTALS}]; uniform int portalN;
  varying vec3 vPortalWP;
#endif`;
const VERT = `
#ifdef USE_PORTAL
  vPortalWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`;
const VERT_SM = VERT.replace('transformed', 'position');   // plain ShaderMaterials (the sky dome) have no 'transformed'
const FRAG = `
#ifdef USE_PORTAL
  for (int i = 0; i < ${MAX_PORTALS}; i++) {
    if (i >= portalN) break;
    vec3 pc = (portalInv[i] * vec4(cameraPosition, 1.0)).xyz, pf = (portalInv[i] * vec4(vPortalWP, 1.0)).xyz;
    if (pc.z * pf.z < 0.0) {   // camera and fragment on opposite sides of the window's plane
      vec2 d = abs(mix(pc.xy, pf.xy, pc.z / (pc.z - pf.z))) - portalHalf[i];
      if (max(d.x, d.y) < 0.0) discard;
    }
  }
#endif`;

const bezelMat = new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.28, metalness: 0.75 });
const tabMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.3, metalness: 0.9 });
const unitBox = new THREE.BoxGeometry(1, 1, 1);

// One window: obj (in rig space, scale always 1 -- the size is `half`), its bezel and three silver handles.
class PortalFrame {
  constructor(set) {
    this.set = set; this.half = HALF0.clone(); this.held = false; this._edge = null; this._g = null;
    const g = this.obj = new THREE.Group(); g.name = 'portal'; g.visible = false; g.userData.noMirror = true; set.rig.add(g);
    const box = (m) => { const b = new THREE.Mesh(unitBox, m); g.add(b); return b; };
    this.bars = [0, 1, 2, 3].map(() => box(bezelMat));   // top, bottom, left, right
    this.tabs = { x: box(tabMat), y: box(tabMat), c1: box(tabMat), c2: box(tabMat) };   // side, top, corner L (two strokes)
    this._fit();
  }
  _fit() {   // place the bars and handles for the current half-size
    const { x: hx, y: hy } = this.half, [tp, bt, lf, rt] = this.bars, t = this.tabs, L = 0.03, k = 0.006;
    const put = (m, w, h, d, x, y, z = 0) => { m.scale.set(w, h, d); m.position.set(x, y, z); };
    put(tp, 2 * hx + 2 * T, T, D, 0, hy + T / 2); put(bt, 2 * hx + 2 * T, T, D, 0, -hy - T / 2);
    put(lf, T, 2 * hy, D, -hx - T / 2, 0); put(rt, T, 2 * hy, D, hx + T / 2, 0);
    put(t.x, 0.022, Math.min(0.14, hy), 0.02, hx + T + 0.006, 0);    // side handle: width
    put(t.y, Math.min(0.14, hx), 0.022, 0.02, 0, hy + T + 0.006);    // top handle: height
    put(t.c1, L, k, D, hx - L / 2, hy - k / 2, 0.004); put(t.c2, k, L, D, hx - k / 2, hy - L / 2, 0.004);   // corner L: both
  }
  hit(P) {   // grab box: the frame + a little slack, front/back a few cm either side (it's a thin window)
    if (!this.obj.visible) return false;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P));
    return Math.abs(l.x) < this.half.x + 0.05 && Math.abs(l.y) < this.half.y + 0.05 && Math.abs(l.z) < 0.05;
  }
  // which handle the hand is on (trigger / pinch): 'x' side, 'y' top, 'xy' corner; xr.js then calls scaleTo()
  corner(P) {
    this._edge = null; if (!this.obj.visible) return false;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P)), { x: hx, y: hy } = this.half;
    if (Math.abs(l.z) > 0.06) return false;
    if (Math.hypot(l.x - (hx - 0.012), l.y - (hy - 0.012)) < GRAB) this._edge = 'xy';
    else if (Math.abs(l.x - (hx + T + 0.006)) < GRAB && Math.abs(l.y) < Math.max(GRAB, Math.min(0.07, hy / 2) + 0.02)) this._edge = 'x';
    else if (Math.abs(l.y - (hy + T + 0.006)) < GRAB && Math.abs(l.x) < Math.max(GRAB, Math.min(0.07, hx / 2) + 0.02)) this._edge = 'y';
    return !!this._edge;
  }
  // s = how far the hand is from the centre now / at the start (the object's scale stays 1): the handle's side follows
  scaleTo(s) {
    if (!this._g) this._g = { half: this.half.clone(), edge: this._edge || 'xy' };
    const { half: b, edge: e } = this._g, cl = v => Math.min(HMAX, Math.max(HMIN, v));
    if (e !== 'y') this.half.x = cl(b.x * s);
    if (e !== 'x') this.half.y = cl(b.y * s);
    this._fit();
  }
  grab() { this.held = true; this._edge = null; this._g = null; }
  hold(world) { this.set.rig.updateMatrixWorld(); _m.copy(this.set.rig.matrixWorld).invert().multiply(world); _m.decompose(this.obj.position, this.obj.quaternion, _s); this.obj.scale.set(1, 1, 1); }
  release() { this.held = false; this.save(); }
  save() { this._g = null; this._edge = null; this.set.save(); }
  place(h) { this.obj.position.copy(h.p); this.obj.quaternion.setFromAxisAngle(_y, h.yaw); this.obj.scale.set(1, 1, 1); }
}

export class Portals {
  // home(i): { p: Vector3, yaw } in rig space, frame i's start spot (the first in front of the mirror, the rest along the wall)
  constructor(rig, home) {
    this.rig = rig; this.home = home; this.on = false; this.n = 1; this.list = [];
    this._mats = new Set();
    this._u = { portalInv: { value: Array.from({ length: MAX_PORTALS }, () => new THREE.Matrix4()) },
      portalHalf: { value: Array.from({ length: MAX_PORTALS }, () => HALF0.clone()) }, portalN: { value: 0 } };
    this._load();
  }
  _frame(i) { while (this.list.length <= i) this.list.push(new PortalFrame(this)); return this.list[i]; }
  active() { return this.on ? this.list.slice(0, this.n) : []; }   // the grabbable ones (xr.js props)
  _load() {
    let s = null; try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
    if (!s) { try { const o = JSON.parse(localStorage.getItem(OLD_KEY) || 'null');   // #345 single portal
      if (o && o.p && o.q) s = { on: o.on, n: 1, f: [{ p: o.p, q: o.q, h: [HALF0.x * (o.s || 1), HALF0.y * (o.s || 1)] }] }; } catch {} }
    this.n = Math.min(MAX_PORTALS, Math.max(1, (s && s.n) || 1));
    for (let i = 0; i < this.n; i++) {
      const f = this._frame(i), d = s && s.f && s.f[i];
      if (d && d.p && d.q) { f.obj.position.fromArray(d.p); f.obj.quaternion.fromArray(d.q); if (d.h) f.half.fromArray(d.h); f._fit(); }
      else f.place(this.home(i, this.n));
    }
    this.setOn(!!(s && s.on), false);
  }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ on: this.on, n: this.n,
      f: this.list.slice(0, this.n).map(f => ({ p: f.obj.position.toArray(), q: f.obj.quaternion.toArray(), h: f.half.toArray() })) })); } catch {}
  }
  _show() { this.list.forEach((f, i) => { f.obj.visible = this.on && i < this.n; }); this._u.portalN.value = this.on ? this.n : 0; }
  setOn(on, save = true) { this.on = !!on; this._show(); if (save) this.save(); }
  // more frames: the new ones start at their spots across the wall; fewer: the extra ones are put away (kept for later)
  setCount(n) {
    n = Math.min(MAX_PORTALS, Math.max(1, n | 0));
    for (let i = this.n; i < n; i++) { const f = this._frame(i); f.half.copy(HALF0); f._fit(); f.place(this.home(i, n)); }
    this.n = n; this._show(); this.save();
  }
  reset() { for (let i = 0; i < this.n; i++) { const f = this._frame(i); f.half.copy(HALF0); f._fit(); f.place(this.home(i, this.n)); } this.save(); }
  // Cut the portals into every mesh under obj (FacetWall's group, the sky dome, any loaded room/cabin glb). Idempotent
  // per material -- call it again any time a new glb finishes loading and it just adds its materials to the registry.
  cutInto(obj) {
    obj.traverse(o => {
      if (!o.isMesh || !o.material) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) this._patch(m);
    });
  }
  _patch(m) {
    if (this._mats.has(m)) return; this._mats.add(m);
    m.defines = m.defines || {}; m.defines.USE_PORTAL = '';
    const u = this._u;
    if (m.isShaderMaterial) {   // own shader source: inject straight into it
      Object.assign(m.uniforms, u);
      m.vertexShader = m.vertexShader.replace('void main() {', DECL + '\nvoid main() {\n' + VERT_SM);
      m.fragmentShader = m.fragmentShader.replace('void main() {', DECL + '\nvoid main() {\n' + FRAG);
      m.needsUpdate = true; return;
    }
    const prev = m.onBeforeCompile;
    // three.js keys programs by onBeforeCompile.toString(), the same for every material patched here: fold in the
    // material's earlier hook / key so two patched materials with different hooks never share one program
    const oldKey = m.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey ? (prev ? prev.toString() : '') : m.customProgramCacheKey();
    m.customProgramCacheKey = () => oldKey + '|portal';
    m.onBeforeCompile = shader => {
      if (prev) prev(shader);
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT).replace('#include <common>', '#include <common>\n' + DECL);
      shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG).replace('#include <common>', '#include <common>\n' + DECL);
    };
    m.needsUpdate = true;
  }
  // per frame: keep the clip uniforms in step with wherever the frames have been dragged / resized to
  tick() {
    if (!this.on) return;
    for (let i = 0; i < this.n; i++) {
      const f = this.list[i]; f.obj.updateMatrixWorld();
      this._u.portalInv.value[i].copy(f.obj.matrixWorld).invert(); this._u.portalHalf.value[i].copy(f.half);
    }
  }
}
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);
