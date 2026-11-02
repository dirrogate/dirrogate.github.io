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
// #585 rebuilt (see the frame section): swept concrete / wrought-iron profile, doorway or bay window, TRIM LIGHT.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/three/utils/BufferGeometryUtils.js';

export const MAX_PORTALS = 6;
const KEY = 'vire.portals', OLD_KEY = 'vire.portal';   // #345 kept one portal under vire.portal
const HALF0 = new THREE.Vector2(0.3, 0.75);   // a new frame's half-size (metres) -- ~ a floor mirror
const HMIN = 0.08, HMAX = 2.5;                // half-size limits per side: 16 cm .. 5 m
const GRAB = 0.045;                           // handle reach (m)

// #585 (owner: 'a resizable concrete / wrought-iron rim, curved rectangular port window that belongs in a castle, a club
// or a spaceship pod; both as a doorway and a bay window'). The #540 trim was a flat 11 cm band whose colour multiplied a
// dark texture, so it rendered black. Now a moulded profile is swept round the opening (sizes in metres stay the same
// whatever the frame's size): a wrought-iron reveal 16-20 cm deep (the bay / tunnel), an iron front lip with forged
// studs, a narrow light groove (TRIM LIGHT: off / red / cyan / amber), then a bevelled concrete surround. A window is
// the same on all four sides (no sill or step), so it works turned sideways or flat; a doorway (DOORWAYS on PORTALS
// SETUP: the first k frames) is open at the bottom with square bottom corners, stands on the floor, stays upright.
// Quest budget: ~650 triangles of trim, 90 studs at 16 triangles in one instanced draw, 3 merged handles; 5 draws a frame.
const RIM = 0.17;                                // concrete outer edge, from the opening edge
const cornerRadius = (hx, hy) => Math.min(0.30, 0.42 * Math.min(hx, hy));
const GLOWS = { off: null, red: 0xff2a2a, cyan: 0x36d8ff, amber: 0xffa53a };
const GLOW_ORDER = ['off', 'red', 'cyan', 'amber'];

// Shared GLSL injected into any material's own shader. World position -> each portal's local space (its inverse world
// matrix); the line from the camera to this fragment crosses the portal's plane inside its rounded rectangle = discard.
// portalR = corner radius (top, bottom); a doorway's bottom is 0 = square.
const DECL = `
#ifdef USE_PORTAL
  uniform mat4 portalInv[${MAX_PORTALS}]; uniform vec2 portalHalf[${MAX_PORTALS}]; uniform vec2 portalR[${MAX_PORTALS}]; uniform int portalN;
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
      vec2 h = portalHalf[i], p = mix(pc.xy, pf.xy, pc.z / (pc.z - pf.z)), q = abs(p);
      float rr = p.y > 0.0 ? portalR[i].x : portalR[i].y;
      vec2 d = q - h + rr;
      if (length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - rr < 0.0) discard;
    }
  }
#endif`;

// ---------- procedural textures (256 px, 0.5 m x 0.5 m of surface, tiled; uv is in metres) ----------
const hash = (x, y) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };
function vnoise(x, y, p) {   // tileable value noise, period p cells
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const h = (a, b) => hash(((a % p) + p) % p, ((b % p) + p) % p);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}
const fbm = (x, y, o, p) => { let a = 0, w = 0.5, t = 0; for (let i = 0; i < o; i++) { a += w * vnoise(x, y, p); t += w; x *= 2; y *= 2; p *= 2; w *= 0.5; } return a / t; };
function bake(N, fn) {   // fn(u, v) -> { c:[r,g,b], h, r (rough), m (metal) } ; returns colour, height, rough/metal canvases
  if (typeof document === 'undefined') return null;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const C = mk(), H = mk(), O = mk(), cd = C.getContext('2d').createImageData(N, N), hd = H.getContext('2d').createImageData(N, N), od = O.getContext('2d').createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = (y * N + x) * 4, o = fn(x / N, y / N);
    cd.data[k] = o.c[0]; cd.data[k + 1] = o.c[1]; cd.data[k + 2] = o.c[2]; cd.data[k + 3] = 255;
    const hv = Math.max(0, Math.min(255, o.h * 255)); hd.data[k] = hd.data[k + 1] = hd.data[k + 2] = hv; hd.data[k + 3] = 255;
    od.data[k] = 255; od.data[k + 1] = o.r * 255; od.data[k + 2] = o.m * 255; od.data[k + 3] = 255;
  }
  C.getContext('2d').putImageData(cd, 0, 0); H.getContext('2d').putImageData(hd, 0, 0); O.getContext('2d').putImageData(od, 0, 0);
  const tex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const T = { map: tex(C, true), bump: tex(H), orm: tex(O) }; for (const k in T) T[k].repeat.set(2, 2);   // 256 px over 0.5 m
  return T;
}
// cast concrete / castle stone: mid grey, aggregate speckle, soft stains and water streaks, pits, a joint every 50 cm
const concreteTx = bake(256, (u, v) => {
  const st = fbm(u * 2, v * 2, 4, 2), ag = vnoise(u * 110, v * 110, 110), ag2 = vnoise(u * 45 + 7, v * 45, 45), pit = vnoise(u * 70 + 3, v * 70, 70);
  const ju = Math.abs(u - 0.5) * 2, joint = ju > 0.976 ? 1 : 0;   // one joint per 0.5 m tile
  let l = 150 + (ag - 0.5) * 34 + (ag2 - 0.5) * 22 - (st - 0.5) * 60 - joint * 60; const p = pit > 0.9; if (p) l -= 50;
  const warm = 8 * (st - 0.3);
  return { c: [l + warm, l + warm * 0.5, l - 3], h: 0.55 + (ag - 0.5) * 0.25 - (p ? 0.45 : 0) - joint * 0.5, r: 0.9 + 0.08 * ag, m: 0 };
});
// wrought iron: hammered dark metal (dents), rust patches (not metal, rough), worn brighter high spots
const ironTx = bake(256, (u, v) => {
  const ham = fbm(u * 20, v * 20, 2, 20), rust = fbm(u * 3 + 3.1, v * 3, 4, 3), gr = vnoise(u * 100, v * 100, 100);
  const rk = Math.max(0, Math.min(1, (rust - 0.55) * 5));
  const ir = 70 + ham * 45 + gr * 12, rr = [118 + gr * 50, 58 + gr * 26, 30 + gr * 12];
  return { c: [ir * (1 - rk) + rr[0] * rk, (ir - 3) * (1 - rk) + rr[1] * rk, (ir - 6) * (1 - rk) + rr[2] * rk],
    h: 0.35 + ham * 0.5 + rk * 0.15 * gr, r: 0.5 + 0.2 * (1 - ham) + 0.35 * rk, m: 0.6 * (1 - rk) };
});
const pbr = (T, o) => new THREE.MeshStandardMaterial(Object.assign(T ? { map: T.map, bumpMap: T.bump, roughnessMap: T.orm, metalnessMap: T.orm, roughness: 1, metalness: 1 } : {}, o));
const stoneMat = pbr(concreteTx, { color: 0xffffff, bumpScale: 1.2 });
const ironMat = pbr(ironTx, { color: 0xffffff, bumpScale: 2.0 });
const studMat = ironMat;

// ---------- the swept frame ----------
// Profile in (s = out from the opening edge, z = toward the viewer), as a closed polygon, with the material of the
// segment that starts at each point: 0 iron, 1 concrete, 2 light groove. D = half depth of the reveal.
function profile(D) {
  return [
    [0, -D, 0], [0, D, 0],                     // iron reveal (the tunnel)
    [0.042, D, 0], [0.042, D - 0.012, 2],      // iron front lip, step down into the groove
    [0.054, D - 0.012, 1],                     // groove floor (light)
    [0.064, D + 0.028, 1], [0.150, D + 0.028, 1], [RIM, D + 0.008, 1],   // concrete: inner bevel, face, outer bevel
    [RIM, -D, 1],                              // outer side, then the back face back to the start
  ];
}
// Path round the opening: points with outward normals. closed = window; open (doorway) runs from the floor at the right,
// over the top, down to the floor at the left.
function pathPts(hx, hy, rT, rB, closed) {
  const P = [], arc = (cx, cy, r, a0, a1, n = 7) => { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; P.push([cx + r * Math.cos(a), cy + r * Math.sin(a), Math.cos(a), Math.sin(a)]); } };
  const H = Math.PI / 2;
  if (closed) {
    arc(hx - rT, hy - rT, rT, 0, H); arc(-hx + rT, hy - rT, rT, H, 2 * H); arc(-hx + rB, -hy + rB, rB, 2 * H, 3 * H); arc(hx - rB, -hy + rB, rB, 3 * H, 4 * H);
  } else {
    P.push([hx, -hy, 1, 0]); arc(hx - rT, hy - rT, rT, 0, H); arc(-hx + rT, hy - rT, rT, H, 2 * H); P.push([-hx, -hy, -1, 0]);
  }
  return P;
}
function sweep(hx, hy, rT, rB, closed, D) {
  const pro = profile(D), path = pathPts(hx, hy, rT, rB, closed), N = path.length;
  let area = 0; for (let k = 0; k < pro.length; k++) { const a = pro[k], b = pro[(k + 1) % pro.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area > 0 ? 1 : -1;
  const pos = [], nor = [], uv = [], byMat = [[], [], []];   // indices per material: one draw each
  let vprof = 0;
  for (let k = 0; k < pro.length; k++) {
    const a = pro[k], b = pro[(k + 1) % pro.length], ds = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(ds, dz);
    if (L < 1e-6) continue;
    const ns = sgn * dz / L, nz = -sgn * ds / L, base = pos.length / 3, idx = byMat[a[2]];
    for (const [s, z, vv] of [[a[0], a[1], vprof], [b[0], b[1], vprof + L]]) {
      let u = 0, px = 0, py = 0;
      for (let i = 0; i < N; i++) {
        const p = path[i], x = p[0] + p[2] * s, y = p[1] + p[3] * s;
        if (i) u += Math.hypot(x - px, y - py); px = x; py = y;
        pos.push(x, y, z); nor.push(p[2] * ns, p[3] * ns, nz); uv.push(u, vv);
      }
    }
    const M = closed ? N : N - 1;
    for (let i = 0; i < M; i++) {
      const j = (i + 1) % N, A = base + i, B = base + j, C = base + N + j, Dd = base + N + i;
      // pick the winding that faces along the given normal
      const va = new THREE.Vector3(pos[A * 3], pos[A * 3 + 1], pos[A * 3 + 2]), vb = new THREE.Vector3(pos[B * 3], pos[B * 3 + 1], pos[B * 3 + 2]), vc = new THREE.Vector3(pos[C * 3], pos[C * 3 + 1], pos[C * 3 + 2]);
      const gnrm = vb.sub(va).cross(vc.sub(va)), want = new THREE.Vector3(nor[A * 3], nor[A * 3 + 1], nor[A * 3 + 2]);
      if (gnrm.dot(want) >= 0) idx.push(A, B, C, A, C, Dd); else idx.push(A, C, B, A, Dd, C);
    }
    vprof += L;
  }
  if (!closed) {   // doorway: cap the two ends standing on the floor
    const tri = THREE.ShapeUtils.triangulateShape(pro.map(p => new THREE.Vector2(p[0], p[1])), []);
    for (const [pi, nx, ny, flip] of [[0, 0, -1, false], [N - 1, 0, -1, true]]) {
      const p = path[pi], base = pos.length / 3, idx = byMat[1];
      for (const q of pro) { pos.push(p[0] + p[2] * q[0], p[1] + p[3] * q[0], q[1]); nor.push(nx, ny, 0); uv.push(q[0], q[1]); }
      for (const t of tri) { const [a, b, c] = t.map(v => base + v); if (flip) idx.push(a, b, c); else idx.push(a, c, b); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const idx = [].concat(...byMat); g.setIndex(idx);
  let o = 0; byMat.forEach((l, mi) => { if (l.length) g.addGroup(o, l.length, mi); o += l.length; });
  return { geo: g, path };
}
// forged iron hardware: studs on the lip, pull bars (width / height handles), a ring on the corner (both)
const studGeo = new THREE.CylinderGeometry(0.0055, 0.009, 0.007, 8, 1).rotateX(Math.PI / 2).translate(0, 0, 0.0035);   // low forged boss
const MAX_STUDS = 90;
function pullBar(len) {   // a forged pull handle: bar on two stand-off posts, along its local y (one merged mesh)
  const parts = [new THREE.CylinderGeometry(0.011, 0.011, len, 8, 1).translate(0, 0, 0.055)];
  for (const sy of [-1, 1]) {
    parts.push(new THREE.CylinderGeometry(0.008, 0.01, 0.05, 6, 1).rotateX(Math.PI / 2).translate(0, sy * (len / 2 - 0.02), 0.032));
    parts.push(new THREE.SphereGeometry(0.013, 8, 5).translate(0, sy * len / 2, 0.055));
  }
  return new THREE.Mesh(mergeGeometries(parts), ironMat);
}
function cornerRing() {
  const ring = new THREE.TorusGeometry(0.03, 0.008, 6, 16).rotateZ(Math.PI / 4).translate(0.012, 0.012, 0.05);
  const lug = new THREE.CylinderGeometry(0.009, 0.011, 0.045, 6, 1).rotateX(Math.PI / 2).translate(-0.012, -0.012, 0.03);
  return new THREE.Mesh(mergeGeometries([ring.toNonIndexed(), lug.toNonIndexed()]), ironMat);
}

// One window: obj (in rig space, scale always 1 -- size is `half`), swept trim, studs, handles.
class PortalFrame {
  constructor(set) {
    this.set = set; this.half = HALF0.clone(); this.held = false; this._edge = null; this._g = null; this.door = false; this.r = new THREE.Vector2();
    const g = this.obj = new THREE.Group(); g.name = 'portal'; g.visible = false; g.userData.noMirror = true; set.rig.add(g);
    this.glowMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.2, emissive: 0x000000 });
    this.trim = new THREE.Mesh(new THREE.BufferGeometry(), [ironMat, stoneMat, this.glowMat]); g.add(this.trim);
    this.studs = new THREE.InstancedMesh(studGeo, studMat, MAX_STUDS); this.studs.count = 0; g.add(this.studs);
    this.handles = { x: pullBar(0.22), y: pullBar(0.22), xy: cornerRing() };
    this.handles.y.rotation.z = Math.PI / 2;
    for (const k in this.handles) g.add(this.handles[k]);
    this._fit();
  }
  setGlow(name) { const c = GLOWS[name]; this.glowMat.emissive.setHex(c || 0); this.glowMat.emissiveIntensity = c ? 2.2 : 0; this.glowMat.color.setHex(c ? 0x222222 : 0x1a1a1a); }
  setDoor(on) { on = !!on; if (on === this.door) return; this.door = on; if (on) this._floor(); this._fit(); }
  _floor() {   // a doorway stands on the floor (rig y = 0) and stays upright
    const e = new THREE.Euler().setFromQuaternion(this.obj.quaternion, 'YXZ'); this.obj.quaternion.setFromAxisAngle(_y, e.y);
    this.obj.position.y = this.half.y;
  }
  _fit() {
    const { x: hx, y: hy } = this.half, door = this.door, D = door ? 0.08 : 0.10;
    const rT = cornerRadius(hx, hy), rB = door ? 0 : rT; this.r.set(rT, rB);
    this.trim.geometry.dispose();
    const { geo, path } = sweep(hx, hy, rT, rB, !door, D); this.trim.geometry = geo;
    // studs every ~13 cm along the middle of the iron lip
    const sMid = 0.021, pts = path.map(p => [p[0] + p[2] * sMid, p[1] + p[3] * sMid]); let acc = 0.055, n = 0; const m = new THREE.Matrix4();
    const segs = door ? pts.length - 1 : pts.length;
    for (let i = 0; i < segs && n < MAX_STUDS; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (acc <= L && n < MAX_STUDS) { const t = acc / L; m.makeTranslation(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, D); this.studs.setMatrixAt(n++, m); acc += 0.13; }
      acc -= L;
    }
    this.studs.count = n; this.studs.instanceMatrix.needsUpdate = true;
    // handles just outside the concrete
    const o = RIM + 0.035;
    this.handles.x.position.set(hx + o, door ? hy * 0.1 : 0, 0);
    this.handles.y.position.set(0, hy + o, 0);
    this.handles.xy.position.set(hx + o + 0.01, hy + o + 0.01, 0);
    if (door && !this.held) this.obj.position.y = hy;
  }

  hit(P) {   // grab box: the trim frame + slack
    if (!this.obj.visible) return false;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P));
    return Math.abs(l.x) < this.half.x + RIM + 0.08 && Math.abs(l.y) < this.half.y + RIM + 0.08 && Math.abs(l.z) < 0.16;
  }

  // Which handle the hand is on (trigger / pinch): 'x' side bar, 'y' top bar, 'xy' corner ring
  corner(P) {
    this._edge = null; if (!this.obj.visible) return false;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P));
    if (Math.abs(l.z) > 0.14) return false;
    const R = this.handles.xy.position, S = this.handles.x.position, T = this.handles.y.position;
    if (Math.hypot(l.x - R.x, l.y - R.y) < GRAB + 0.02) this._edge = 'xy';
    else if (Math.abs(l.x - S.x) < GRAB && Math.abs(l.y - S.y) < 0.14) this._edge = 'x';
    else if (Math.abs(l.y - T.y) < GRAB && Math.abs(l.x - T.x) < 0.14) this._edge = 'y';
    return !!this._edge;
  }

  // s = how far the hand is from the centre now / at the start (the object's scale stays 1): handle follows
  scaleTo(s) {
    if (!this._g) this._g = { half: this.half.clone(), edge: this._edge || 'xy' };
    const { half: b, edge: e } = this._g, cl = v => Math.min(HMAX, Math.max(HMIN, v));
    if (e !== 'y') this.half.x = cl(b.x * s);
    if (e !== 'x') this.half.y = cl(b.y * s);
    this._fit(); if (this.door) this.obj.position.y = this.half.y;   // a doorway grows upward from the floor
  }

  grab() { this.held = true; this._edge = null; this._g = null; }
  hold(world) {
    this.set.rig.updateMatrixWorld();
    _m.copy(this.set.rig.matrixWorld).invert().multiply(world);
    _m.decompose(this.obj.position, this.obj.quaternion, _s);
    this.obj.scale.set(1, 1, 1);
    if (this.door) this._floor();
  }
  release() { this.held = false; if (this.door) this._floor(); this.save(); }
  save() { this._g = null; this._edge = null; this.set.save(); }
  place(h) { this.obj.position.copy(h.p); this.obj.quaternion.setFromAxisAngle(_y, h.yaw); this.obj.scale.set(1, 1, 1); if (this.door) this._floor(); }
}

export class Portals {
  // home(i): { p: Vector3, yaw } in rig space, frame i's start spot (the first in front of the mirror, the rest along the wall)
  constructor(rig, home) {
    this.rig = rig; this.home = home; this.on = false; this.n = 1; this.list = []; this.doors = 0; this.glow = 'off';   // #585
    this._mats = new Set();
    this._u = { portalInv: { value: Array.from({ length: MAX_PORTALS }, () => new THREE.Matrix4()) },
      portalHalf: { value: Array.from({ length: MAX_PORTALS }, () => HALF0.clone()) },
      portalR: { value: Array.from({ length: MAX_PORTALS }, () => new THREE.Vector2()) }, portalN: { value: 0 } };
    this._load();
  }
  _frame(i) { while (this.list.length <= i) this.list.push(new PortalFrame(this)); return this.list[i]; }
  active() { return this.on ? this.list.slice(0, this.n) : []; }   // the grabbable ones (xr.js props)
  _load() {
    let s = null; try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
    if (!s) { try { const o = JSON.parse(localStorage.getItem(OLD_KEY) || 'null');   // #345 single portal
      if (o && o.p && o.q) s = { on: o.on, n: 1, f: [{ p: o.p, q: o.q, h: [HALF0.x * (o.s || 1), HALF0.y * (o.s || 1)] }] }; } catch {} }
    this.n = Math.min(MAX_PORTALS, Math.max(1, (s && s.n) || 1));
    this.doors = Math.min(this.n, Math.max(0, (s && s.doors) | 0)); this.glow = s && GLOWS[s.glow] !== undefined ? s.glow : 'off';   // #585
    for (let i = 0; i < this.n; i++) {
      const f = this._frame(i), d = s && s.f && s.f[i];
      if (d && d.p && d.q) { f.obj.position.fromArray(d.p); f.obj.quaternion.fromArray(d.q); if (d.h) f.half.fromArray(d.h); f._fit(); }
      else f.place(this.home(i, this.n));
    }
    this._styles();
    this.setOn(!!(s && s.on), false);
  }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ on: this.on, n: this.n, doors: this.doors, glow: this.glow,
      f: this.list.slice(0, this.n).map(f => ({ p: f.obj.position.toArray(), q: f.obj.quaternion.toArray(), h: f.half.toArray() })) })); } catch {}
  }
  _show() { this.list.forEach((f, i) => { f.obj.visible = this.on && i < this.n; }); this._u.portalN.value = this.on ? this.n : 0; }
  // #585 the first `doors` frames are doorways (on the floor, open at the bottom), the rest bay windows; TRIM LIGHT colour
  _styles() { this.list.forEach((f, i) => { f.setDoor(i < this.doors); f.setGlow(this.glow); }); }
  setDoors(k) { this.doors = Math.min(this.n, Math.max(0, k | 0)); this._styles(); this.save(); }
  stepGlow(d) { const i = GLOW_ORDER.indexOf(this.glow); this.glow = GLOW_ORDER[((i < 0 ? 0 : i) + d + GLOW_ORDER.length) % GLOW_ORDER.length]; this._styles(); this.save(); }
  setOn(on, save = true) { this.on = !!on; this._show(); if (save) this.save(); }
  // more frames: the new ones start at their spots across the wall; fewer: the extra ones are put away (kept for later)
  setCount(n) {
    n = Math.min(MAX_PORTALS, Math.max(1, n | 0));
    for (let i = this.n; i < n; i++) { const f = this._frame(i); f.half.copy(HALF0); f._fit(); f.place(this.home(i, n)); }
    this.n = n; this.doors = Math.min(this.doors, n); this._styles(); this._show(); this.save();
  }
  reset() { for (let i = 0; i < this.n; i++) { const f = this._frame(i); f.half.copy(HALF0); f._fit(); f.place(this.home(i, this.n)); } this._styles(); this.save(); }
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
      this._u.portalInv.value[i].copy(f.obj.matrixWorld).invert(); this._u.portalHalf.value[i].copy(f.half); this._u.portalR.value[i].copy(f.r);
    }
  }
}
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);
