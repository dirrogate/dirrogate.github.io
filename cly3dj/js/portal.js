// #345 PORTAL (owner): a rectangular "real world window". Cut it into any prop or room (FacetWall today; any future
// glb room/cabin later, one call: Portals.cutInto(obj)) and the part of that mesh seen through the rectangle stops
// drawing, so whatever is really there shows instead -- the Quest's passthrough camera in AR, or just empty space in VR.
// A thin bezel frame marks its edges in passthrough and on the Twitch picture (HEADSET CAM / SHOWTIME! both render
// the normal scene, so the cut shows up there too with no extra plumbing).
// #346 (owner): up to MAX_PORTALS frames (the PORTALS SETUP page sets how many), each any rectangle: trigger / pinch
// on the handle on its right side = width, on its top = height, on the corner = both (grip anywhere on the
// frame moves it, a second grip stretches it evenly). The cut is now a true window: from each eye (and each stream
// camera) only what lies BEYOND the frame, seen through it, is removed -- so with the wall wrapped all the way round,
// a portal in front never punches through the panels behind the DJ, and it cuts the sky dome behind it too.
// #540 (owner, redcastle2_1.jpg): curved-edge portal opening (rounded corners) set in a weathered concrete/stone
// surround with a rusty wrought-iron inner trim band and forged iron corner rivets. Sizing handles are forged rusty
// wrought iron (side bar = width, top bar = height, top-right forged ring = both). No more garish silver.
import * as THREE from 'three';

export const MAX_PORTALS = 6;
const KEY = 'vire.portals', OLD_KEY = 'vire.portal';   // #345 kept one portal under vire.portal
const HALF0 = new THREE.Vector2(0.3, 0.75);   // a new frame's half-size (metres) -- ~ a floor mirror
const HMIN = 0.08, HMAX = 2.5;                // half-size limits per side: 16 cm .. 5 m
const GRAB = 0.045;                           // handle reach (m)

// Trim dimensions
const IRON_W = 0.026, IRON_D = 0.042;         // inner wrought iron band
const STONE_W = 0.085, STONE_D = 0.034;       // outer weathered concrete / castle stone surround
const TOTAL_W = IRON_W + STONE_W;
const cornerRadius = (hx, hy) => Math.min(0.20, 0.45 * Math.min(hx, hy));

// Shared GLSL injected into any material's own shader. World position -> each portal's local space (its inverse world
// matrix); the line from the camera to this fragment crosses the portal's plane inside its rounded rectangle = discard.
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
      vec2 h = portalHalf[i];
      vec2 q = abs(mix(pc.xy, pf.xy, pc.z / (pc.z - pf.z)));
      float rr = min(0.20, 0.45 * min(h.x, h.y));   // #540 rounded corners
      vec2 d = q - h + rr;
      if (length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - rr < 0.0) discard;
    }
  }
#endif`;

// Procedural materials: weathered castle concrete & rusty wrought iron
function makeNoiseTex(w, h, fn) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const imgData = ctx.createImageData(w, h);
  const data = imgData.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const [r, g, b] = fn(x / w, y / h);
      data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Weathered concrete / stone material matching redcastle
const stoneTex = makeNoiseTex(256, 256, (u, v) => {
  const n = (Math.sin(u * 28.0) * Math.cos(v * 31.0) * 0.5 + 0.5) * 0.25 +
            (Math.sin(u * 73.0 + v * 62.0) * 0.5 + 0.5) * 0.15 + (Math.random() * 0.6);
  // Dark weathered castle concrete tones
  const r = 70 + Math.floor(n * 45);
  const g = 64 + Math.floor(n * 38);
  const b = 60 + Math.floor(n * 34);
  return [r, g, b];
});

const stoneMat = new THREE.MeshStandardMaterial({
  color: 0x58514a,
  roughness: 0.94,
  metalness: 0.06,
  map: stoneTex || null,
});

// Rusty wrought iron material
const ironTex = makeNoiseTex(256, 256, (u, v) => {
  const grain = (Math.sin(u * 60.0) * 0.5 + 0.5) * 0.3 + (Math.random() * 0.7);
  // Rusty dark iron tones: charcoal black mixed with oxide brown/orange
  const isRust = Math.random() < 0.38;
  if (isRust) {
    return [75 + Math.floor(grain * 40), 38 + Math.floor(grain * 25), 24 + Math.floor(grain * 15)];
  }
  return [32 + Math.floor(grain * 18), 30 + Math.floor(grain * 18), 28 + Math.floor(grain * 16)];
});

const ironMat = new THREE.MeshStandardMaterial({
  color: 0x3d322c,
  roughness: 0.82,
  metalness: 0.68,
  map: ironTex || null,
});

// Build 3D looped frame geometry with rounded corners
function createFrameGeo(hx, hy, r, w, d, zCenter = 0, innerOffset = 0) {
  const arcSegs = 6;
  const innerPts = [], outerPts = [];
  const cx = Math.max(0, hx - r), cy = Math.max(0, hy - r);
  const inR = r + innerOffset;
  const outR = inR + w;

  function addCorner(cenX, cenY, startAngle, endAngle) {
    for (let i = 0; i < arcSegs; i++) {
      const a = startAngle + (endAngle - startAngle) * (i / arcSegs);
      const cos = Math.cos(a), sin = Math.sin(a);
      innerPts.push([cenX + inR * cos, cenY + inR * sin]);
      outerPts.push([cenX + outR * cos, cenY + outR * sin]);
    }
  }

  addCorner(cx, cy, 0, Math.PI * 0.5);
  addCorner(-cx, cy, Math.PI * 0.5, Math.PI);
  addCorner(-cx, -cy, Math.PI, Math.PI * 1.5);
  addCorner(cx, -cy, Math.PI * 1.5, Math.PI * 2);

  const N = innerPts.length;
  const zF = zCenter + d * 0.5, zB = zCenter - d * 0.5;
  const pos = [], norm = [], uv = [], indices = [];

  // 1. Front face (+Z)
  const baseF = 0;
  for (let i = 0; i < N; i++) {
    pos.push(innerPts[i][0], innerPts[i][1], zF);
    norm.push(0, 0, 1);
    uv.push(i / N * 4, 0);
    pos.push(outerPts[i][0], outerPts[i][1], zF);
    norm.push(0, 0, 1);
    uv.push(i / N * 4, 1);
  }
  for (let i = 0; i < N; i++) {
    const next = (i + 1) % N;
    const i0 = baseF + i * 2, i1 = baseF + i * 2 + 1;
    const n0 = baseF + next * 2, n1 = baseF + next * 2 + 1;
    indices.push(i0, i1, n1, i0, n1, n0);
  }

  // 2. Inner face (towards opening)
  const baseIn = pos.length / 3;
  for (let i = 0; i < N; i++) {
    const next = (i + 1) % N, prev = (i - 1 + N) % N;
    const dx = innerPts[next][0] - innerPts[prev][0];
    const dy = innerPts[next][1] - innerPts[prev][1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len, ny = -dx / len;
    pos.push(innerPts[i][0], innerPts[i][1], zF);
    norm.push(nx, ny, 0);
    uv.push(i / N * 4, 1);
    pos.push(innerPts[i][0], innerPts[i][1], zB);
    norm.push(nx, ny, 0);
    uv.push(i / N * 4, 0);
  }
  for (let i = 0; i < N; i++) {
    const next = (i + 1) % N;
    const i0 = baseIn + i * 2, i1 = baseIn + i * 2 + 1;
    const n0 = baseIn + next * 2, n1 = baseIn + next * 2 + 1;
    indices.push(i0, n0, n1, i0, n1, i1);
  }

  // 3. Outer face
  const baseOut = pos.length / 3;
  for (let i = 0; i < N; i++) {
    const next = (i + 1) % N, prev = (i - 1 + N) % N;
    const dx = outerPts[next][0] - outerPts[prev][0];
    const dy = outerPts[next][1] - outerPts[prev][1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    pos.push(outerPts[i][0], outerPts[i][1], zF);
    norm.push(nx, ny, 0);
    uv.push(i / N * 4, 1);
    pos.push(outerPts[i][0], outerPts[i][1], zB);
    norm.push(nx, ny, 0);
    uv.push(i / N * 4, 0);
  }
  for (let i = 0; i < N; i++) {
    const next = (i + 1) % N;
    const i0 = baseOut + i * 2, i1 = baseOut + i * 2 + 1;
    const n0 = baseOut + next * 2, n1 = baseOut + next * 2 + 1;
    indices.push(i0, i1, n1, i0, n1, n0);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(indices);
  return geo;
}

// Reusable rivet & handle shapes (rusty wrought iron)
const rivetGeo = new THREE.SphereGeometry(0.007, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
const handleBarGeoX = new THREE.CylinderGeometry(0.006, 0.006, 0.12, 8);
handleBarGeoX.rotateZ(Math.PI * 0.5);
const handleBarGeoY = new THREE.CylinderGeometry(0.006, 0.006, 0.12, 8);
const handleRingGeo = new THREE.TorusGeometry(0.022, 0.0055, 8, 16);

// One window: obj (in rig space, scale always 1 -- size is `half`), stone & iron trim, forged iron handles.
class PortalFrame {
  constructor(set) {
    this.set = set; this.half = HALF0.clone(); this.held = false; this._edge = null; this._g = null;
    const g = this.obj = new THREE.Group(); g.name = 'portal'; g.visible = false; g.userData.noMirror = true; set.rig.add(g);

    // Meshes for concrete and iron trim
    this.stoneMesh = new THREE.Mesh(new THREE.BufferGeometry(), stoneMat);
    this.ironMesh = new THREE.Mesh(new THREE.BufferGeometry(), ironMat);
    g.add(this.stoneMesh);
    g.add(this.ironMesh);

    // Corner rivets (4 decorative forged iron studs on the inner band)
    this.rivets = [0, 1, 2, 3].map(() => {
      const r = new THREE.Mesh(rivetGeo, ironMat);
      g.add(r);
      return r;
    });

    // Rusty wrought-iron handles: side bar (x/width), top bar (y/height), corner ring (xy/both)
    this.handles = {
      x: new THREE.Mesh(handleBarGeoY, ironMat),
      y: new THREE.Mesh(handleBarGeoX, ironMat),
      xy: new THREE.Mesh(handleRingGeo, ironMat),
    };
    g.add(this.handles.x);
    g.add(this.handles.y);
    g.add(this.handles.xy);

    this._fit();
  }

  _fit() {
    const { x: hx, y: hy } = this.half;
    const r = cornerRadius(hx, hy);

    // Update trim geometries
    if (this.stoneMesh.geometry) this.stoneMesh.geometry.dispose();
    this.stoneMesh.geometry = createFrameGeo(hx, hy, r, STONE_W, STONE_D, 0.005, IRON_W);

    if (this.ironMesh.geometry) this.ironMesh.geometry.dispose();
    this.ironMesh.geometry = createFrameGeo(hx, hy, r, IRON_W, IRON_D, 0.012, 0);

    // Place decorative rivets on the inner iron band corners
    const rivR = r + IRON_W * 0.5, cx = Math.max(0, hx - r), cy = Math.max(0, hy - r);
    const diag = Math.SQRT1_2;
    const zRiv = 0.012 + IRON_D * 0.5;
    this.rivets[0].position.set(cx + rivR * diag, cy + rivR * diag, zRiv);
    this.rivets[1].position.set(-cx - rivR * diag, cy + rivR * diag, zRiv);
    this.rivets[2].position.set(-cx - rivR * diag, -cy - rivR * diag, zRiv);
    this.rivets[3].position.set(cx + rivR * diag, -cy - rivR * diag, zRiv);

    // Place rusty sizing handles outside the trim
    // Right side bar: width sizing
    this.handles.x.position.set(hx + TOTAL_W + 0.012, 0, 0.015);
    // Top bar: height sizing
    this.handles.y.position.set(0, hy + TOTAL_W + 0.012, 0.015);
    // Top-right corner forged iron ring: dual-axis sizing
    this.handles.xy.position.set(hx + TOTAL_W + 0.012, hy + TOTAL_W + 0.012, 0.015);
  }

  hit(P) {   // grab box: the trim frame + slack
    if (!this.obj.visible) return false;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P));
    return Math.abs(l.x) < this.half.x + TOTAL_W + 0.06 && Math.abs(l.y) < this.half.y + TOTAL_W + 0.06 && Math.abs(l.z) < 0.07;
  }

  // Which handle the hand is on (trigger / pinch): 'x' side bar, 'y' top bar, 'xy' corner ring
  corner(P) {
    this._edge = null; if (!this.obj.visible) return false;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P)), { x: hx, y: hy } = this.half;
    if (Math.abs(l.z) > 0.08) return false;

    const ringPos = this.handles.xy.position;
    const sidePos = this.handles.x.position;
    const topPos = this.handles.y.position;

    if (Math.hypot(l.x - ringPos.x, l.y - ringPos.y) < GRAB + 0.015) {
      this._edge = 'xy';
    } else if (Math.abs(l.x - sidePos.x) < GRAB && Math.abs(l.y - sidePos.y) < 0.08) {
      this._edge = 'x';
    } else if (Math.abs(l.y - topPos.y) < GRAB && Math.abs(l.x - topPos.x) < 0.08) {
      this._edge = 'y';
    }
    return !!this._edge;
  }

  // s = how far the hand is from the centre now / at the start (the object's scale stays 1): handle follows
  scaleTo(s) {
    if (!this._g) this._g = { half: this.half.clone(), edge: this._edge || 'xy' };
    const { half: b, edge: e } = this._g, cl = v => Math.min(HMAX, Math.max(HMIN, v));
    if (e !== 'y') this.half.x = cl(b.x * s);
    if (e !== 'x') this.half.y = cl(b.y * s);
    this._fit();
  }

  grab() { this.held = true; this._edge = null; this._g = null; }
  hold(world) {
    this.set.rig.updateMatrixWorld();
    _m.copy(this.set.rig.matrixWorld).invert().multiply(world);
    _m.decompose(this.obj.position, this.obj.quaternion, _s);
    this.obj.scale.set(1, 1, 1);
  }
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
