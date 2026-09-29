// Resizable flight case (CLAUDE.md #38): black laminate panels, aluminium angle extrusions on every edge,
// a double-rail lid seam, ball corners, rivets, butterfly latches and recessed side handles.
// Origin = bottom centre on the floor; top at y = H. Resize handles live only on the bottom corners and
// bottom edges, so nothing up top (where the gear sits) can change the size by accident.
import * as THREE from 'three';
import { satinSteel } from './textures.js';
import { mergeStatic } from './merge.js';
import { mergeGeometries } from '../vendor/three/utils/BufferGeometryUtils.js';

export const CASE_LIMITS = { W: [0.3, 2.2], D: [0.28, 0.9], H: [0.08, 0.98] };
const E = 0.022;      // extrusion size
const tex = {};

function laminate() {
  if (tex.lam) return tex.lam;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); const img = g.createImageData(S, S); const d = img.data;
  let seed = 3; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < S * S; i++) { const v = 18 + r() * 14 + (r() > 0.97 ? 10 : 0); d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v + 3; d[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(c); bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  return (tex.lam = { map, bump });
}
function brushed() {
  if (tex.alu) return tex.alu;
  const W = 512, H = 64, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); const img = g.createImageData(W, H); const d = img.data;
  let seed = 11; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < H; y++) { let v = 185 + (r() - 0.5) * 30; for (let x = 0; x < W; x++) { v += (r() - 0.5) * 6; v = v * 0.95 + 185 * 0.05; const i = (y * W + x) * 4; d[i] = d[i + 1] = v; d[i + 2] = v + 4; d[i + 3] = 255; } }
  g.putImageData(img, 0, 0);
  // two engraved grooves along the extrusion, like the rails in the reference photo
  g.fillStyle = 'rgba(40,40,45,0.7)'; g.fillRect(0, 20, W, 3); g.fillRect(0, 41, W, 3);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return (tex.alu = t);
}

const M = {};
function mats() {
  if (M.panel) return M;
  const lam = laminate();
  M.panel = new THREE.MeshStandardMaterial({ color: 0xffffff, map: lam.map, bumpMap: lam.bump, bumpScale: 1.5, roughness: 0.85, metalness: 0.05 });
  M.alu = new THREE.MeshStandardMaterial({ color: 0xa9acb2, map: brushed(), metalness: 1, roughness: 0.48, envMapIntensity: 0.4 });   // standard, not physical: the anisotropy was invisible on 22 mm extrusions (#84)
  M.chrome = satinSteel({ color: 0x8f9298, rough: 0.34, repeat: 2, env: 0.35, physical: false });   // satin, not self-lit
  M.bronze = new THREE.MeshStandardMaterial({ color: 0x4d4238, metalness: 0.85, roughness: 0.35 });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x151515, metalness: 0.4, roughness: 0.6 });
  M.handle = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.5 });
  M.rivet = new THREE.MeshStandardMaterial({ color: 0x9a9ca1, metalness: 1, roughness: 0.42, envMapIntensity: 0.4 });
  return M;
}

// #135: Blender flight-case kit (blender/flight_case/flight_case.blend -> web/models/flight_case_kit.glb + _ktx).
// Stretchable pieces instead of fixed models, so the case stays resizable: CaseAngle (real aluminium angle, unit
// length along x, rivets every 70 mm in the trim-sheet normal map), CaseRail (tongue-and-groove lid seam), CaseCorner
// (ball corner with three wings), CaseLatch, CaseHandle; all share one trim-sheet material (vertex colours, 1024 x 512
// normal + occlusion/roughness/metal). CaseLamTile carries the laminate material (dark grey, tileable 512 pebble normal
// map, world-scale UVs). build() places and stretches the pieces for the current size and merges them: 2 draw calls.
let KIT = null;
const TILE = 0.14, LAM = 0.16;   // trim-sheet period along a strip (2 rivets), laminate tile size (m)
const CELL = { chrome: [0.1875, 0.875], bronze: [0.5625, 0.875] };
export async function loadCaseKit(url, loadBaked) {
  if (KIT) return KIT;
  const gltf = await loadBaked(url);
  const get = n => { const o = gltf.scene.getObjectByName(n); if (!o || !o.isMesh) throw new Error('flight case kit: missing ' + n); return o; };
  const k = {}; for (const n of ['Angle', 'Rail', 'Corner', 'Latch', 'Handle', 'LamTile']) k[n] = get('Case' + n);
  const kit = k.Angle.material; kit.vertexColors = true; kit.name = 'case_kit';
  for (const t of [kit.normalMap, kit.roughnessMap, kit.aoMap]) if (t) { t.wrapS = THREE.RepeatWrapping; t.needsUpdate = true; }
  const lam = k.LamTile.material; lam.name = 'case_laminate';
  if (lam.normalMap) { lam.normalMap.wrapS = lam.normalMap.wrapT = THREE.RepeatWrapping; lam.normalMap.needsUpdate = true; }
  KIT = { angle: k.Angle.geometry, rail: k.Rail.geometry, corner: k.Corner.geometry, latch: k.Latch.geometry, handle: k.Handle.geometry, kit, lam };
  return KIT;
}
// copy of a kit piece placed by a basis (cols X, Y, Z = local x, y, z in case space) at position p; mirrored bases
// get their winding flipped. stretch: local x runs 0..1 over length L, strip UVs (v < 0.75) tile every TILE metres.
const _m = new THREE.Matrix4();
function piece(src, X, Y, Z, p, { L = 0, u0 = 0, color = null, cell = null } = {}) {
  const g = src.clone();
  if (L) {
    const P = g.attributes.position, U = g.attributes.uv;
    for (let i = 0; i < P.count; i++) if (U.getY(i) < 0.75) U.setX(i, (P.getX(i) * L + u0) / TILE);
  }
  if (color) { const C = g.attributes.color, c = new THREE.Color(color); for (let i = 0; i < C.count; i++) C.setXYZ(i, c.r, c.g, c.b); }
  if (cell) { const U = g.attributes.uv; for (let i = 0; i < U.count; i++) U.setXY(i, cell[0], cell[1]); }
  _m.makeBasis(X, Y, Z).setPosition(p);
  g.applyMatrix4(_m);
  if (_m.determinant() < 0) {   // mirrored: flip the winding and the tangent handedness
    const I = g.index; for (let i = 0; i < I.count; i += 3) { const a = I.getX(i + 1); I.setX(i + 1, I.getX(i + 2)); I.setX(i + 2, a); }
    const T = g.attributes.tangent; if (T) for (let i = 0; i < T.count; i++) T.setW(i, -T.getW(i));
  }
  return g;
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
function buildKit(fc) {
  const { W, D, H } = fc, P = fc.parts, key = fc.key, hw = W / 2, hd = D / 2;
  const parts = [];
  // 12 angles, outer corner on the case's edge lines; they stop 22 mm short of each corner, under the corner wings
  const EI = 0.022;
  const edge = (along, a, b, start, len) => {
    const L = len - 2 * EI;
    parts.push(piece(KIT.angle, along.clone().multiplyScalar(L), a, b, start.clone().addScaledVector(along, EI), { L, u0: -L / 2 + 0.25 * TILE }));
  };
  for (const sy of [-1, 1]) {
    const y = sy > 0 ? H : 0;
    for (const sz of [-1, 1]) edge(V3(1, 0, 0), V3(0, sy, 0), V3(0, 0, sz), V3(-hw, y, sz * hd), W);
    for (const sx of [-1, 1]) edge(V3(0, 0, 1), V3(0, sy, 0), V3(sx, 0, 0), V3(sx * hw, y, -hd), D);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) edge(V3(0, 1, 0), V3(sx, 0, 0), V3(0, 0, sz), V3(sx * hw, 0, sz * hd), H);
  // ball corners: chrome top and bottom (#153 owner: the top ones were dark bronze); bottom ones flattened: the case stands on them
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(piece(KIT.corner, V3(sx, 0, 0), V3(0, 1, 0), V3(0, 0, sz), V3(sx * hw, H, sz * hd), { color: 0xc4c7cc, cell: CELL.chrome }));
    parts.push(piece(KIT.corner, V3(sx, 0, 0), V3(0, -0.45, 0), V3(0, 0, sz), V3(sx * hw, 0, sz * hd), { color: 0x8f9298, cell: CELL.chrome }));
  }
  // lid seam rail and butterfly latches (the rail is cut under each latch dish)
  const S = 0.003;   // laminate inset
  if (H > 0.3) {
    const y = H - 0.095, lx = W > 0.34 ? (W > 0.7 ? [-W * 0.28, W * 0.28] : [0]) : [];
    const run = (len, gaps, place) => {   // rail pieces along 0..len skipping latch gaps (centres measured from the middle)
      let a = 0; const cuts = gaps.map(c => [len / 2 + c - 0.034, len / 2 + c + 0.034]).sort((p, q) => p[0] - q[0]);
      for (const [c0, c1] of [...cuts, [len, len]]) { if (c0 - a > 0.004) place(a, c0 - a); a = c1; }
    };
    const rail = (along, out, origin, len, gaps) => run(len, gaps, (a, L) =>
      parts.push(piece(KIT.rail, along.clone().multiplyScalar(L), V3(0, 1, 0), out, origin.clone().addScaledVector(along, a).setY(y - 0.015), { L, u0: a })));
    rail(V3(1, 0, 0), V3(0, 0, 1), V3(-hw + EI, 0, hd - S), W - 2 * EI, lx);
    rail(V3(-1, 0, 0), V3(0, 0, -1), V3(hw - EI, 0, -hd + S), W - 2 * EI, lx.map(x => -x));
    rail(V3(0, 0, -1), V3(1, 0, 0), V3(hw - S, 0, hd - EI), D - 2 * EI, []);
    rail(V3(0, 0, 1), V3(-1, 0, 0), V3(-hw + S, 0, -hd + EI), D - 2 * EI, []);
    for (const x of lx) {
      parts.push(piece(KIT.latch, V3(1, 0, 0), V3(0, 1, 0), V3(0, 0, 1), V3(x, y, hd - S)));
      parts.push(piece(KIT.latch, V3(-1, 0, 0), V3(0, 1, 0), V3(0, 0, -1), V3(-x, y, -hd + S)));
    }
  }
  if (H > 0.34) {   // recessed side handles
    const y = H * 0.62;
    parts.push(piece(KIT.handle, V3(1, 0, 0), V3(0, 1, 0), V3(0, 0, 1), V3(hw - S, y, 0)));
    parts.push(piece(KIT.handle, V3(-1, 0, 0), V3(0, 1, 0), V3(0, 0, -1), V3(-hw + S, y, 0)));
  }
  const metal = new THREE.Mesh(mergeGeometries(parts, false), KIT.kit);
  parts.forEach(g => g.dispose());
  // laminate body with world-scale UVs (the pebble grain keeps its size whatever the case size)
  const bw = W - 2 * S, bh = H - 2 * S, bd = D - 2 * S;
  const bg = new THREE.BoxGeometry(bw, bh, bd);
  { const Pp = bg.attributes.position, N = bg.attributes.normal, U = bg.attributes.uv;
    for (let i = 0; i < Pp.count; i++) {
      const x = Pp.getX(i), y = Pp.getY(i), z = Pp.getZ(i), nx = Math.abs(N.getX(i)), ny = Math.abs(N.getY(i));
      U.setXY(i, (nx > 0.5 ? z : x) / LAM, (ny > 0.5 ? z : y) / LAM);
    }
    bg.translate(0, H / 2, 0); }
  const body = new THREE.Mesh(bg, KIT.lam);
  for (const o of [body, metal]) { o.castShadow = true; o.receiveShadow = true; o.userData.move = key; P.add(o); }
  // invisible grab zones: bottom corners and bottom edges resize (as the old bottom extrusions did)
  const hz = new THREE.MeshBasicMaterial({ visible: false });
  const zone = (w, h, d, x, y, z, sx, sz) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hz); o.position.set(x, y, z); o.userData.resize = { key, sx, sz }; P.add(o); };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) zone(0.07, 0.06, 0.07, sx * hw, 0.03, sz * hd, sx, sz);
  for (const sz of [-1, 1]) zone(Math.max(0.01, W - 0.07), 0.045, 0.035, 0, 0.022, sz * hd, 0, sz);
  for (const sx of [-1, 1]) zone(0.035, 0.045, Math.max(0.01, D - 0.07), sx * hw, 0.022, 0, sx, 0);
}

export class FlightCase {
  constructor(key, W, D, H) {
    this.key = key; this.group = new THREE.Group(); this.group.name = key;
    this.parts = new THREE.Group(); this.group.add(this.parts);
    this.W = W; this.D = D; this.H = H;
    this.build();
  }
  size(W, D, H) {
    const L = CASE_LIMITS;
    this.W = Math.min(L.W[1], Math.max(L.W[0], W));
    this.D = Math.min(L.D[1], Math.max(L.D[0], D));
    this.H = Math.min(L.H[1], Math.max(L.H[0], H));
    this.build();
  }
  build() {
    const m = mats(); const { W, D, H } = this;
    for (const c of [...this.parts.children]) { this.parts.remove(c); c.traverse(o => o.geometry && o.geometry.dispose()); }
    if (KIT) { buildKit(this); return; }   // #135
    const P = this.parts, key = this.key;
    const add = (geo, mat, x, y, z, tag = 'move') => {
      const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true;
      if (tag === 'move') o.userData.move = key; else if (tag) o.userData.resize = { key, ...tag };
      P.add(o); return o;
    };
    // laminate body, set in a little so the extrusions stand proud
    const body = add(new THREE.BoxGeometry(W - 0.006, H - 0.006, D - 0.006), m.panel, 0, H / 2, 0);
    m.panel.map.repeat.set(3, 2);
    // 12 edge extrusions (bottom four are resize handles)
    const ex = (len, axis, x, y, z, tag) => {
      const g = axis === 'x' ? new THREE.BoxGeometry(len, E, E) : axis === 'y' ? new THREE.BoxGeometry(E, len, E) : new THREE.BoxGeometry(E, E, len);
      if (axis !== 'x') { // keep the groove running along the length
        const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v, u); }
      }
      return add(g, m.alu, x, y, z, tag);
    };
    const hw = W / 2, hd = D / 2;
    for (const sz of [-1, 1]) {
      ex(W, 'x', 0, H - E / 2, sz * (hd - E / 2 + 0.002));
      ex(W - 2 * E, 'x', 0, E / 2, sz * (hd - E / 2 + 0.002), { sx: 0, sz });
    }
    for (const sx of [-1, 1]) {
      ex(D, 'z', sx * (hw - E / 2 + 0.002), H - E / 2, 0);
      ex(D - 2 * E, 'z', sx * (hw - E / 2 + 0.002), E / 2, 0, { sx, sz: 0 });
      for (const sz of [-1, 1]) ex(H, 'y', sx * (hw - E / 2 + 0.002), H / 2, sz * (hd - E / 2 + 0.002));
    }
    // lid seam: double rail round the case near the top
    if (H > 0.3) {
      const y = H - 0.095;
      for (const sz of [-1, 1]) { add(new THREE.BoxGeometry(W - 2 * E, 0.03, 0.008), m.alu, 0, y, sz * (hd + 0.001)); }
      for (const sx of [-1, 1]) { add(new THREE.BoxGeometry(0.008, 0.03, D - 2 * E), m.alu, sx * (hw + 0.001), y, 0); }
    }
    // ball corners: dark metal on top, chrome at the bottom (bottom corners resize)
    const ballG = new THREE.SphereGeometry(0.02, 20, 14);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const t = add(ballG, m.chrome, sx * (hw - 0.006), H - 0.006, sz * (hd - 0.006)); t.scale.set(1.25, 1.1, 1.25);
      const b = add(ballG, m.chrome, sx * (hw - 0.006), 0.012, sz * (hd - 0.006), { sx, sz }); b.scale.set(1.25, 0.9, 1.25);
    }
    // rivets along the extrusions
    const pts = [];
    const line = (a, b, n) => { for (let i = 1; i < n; i++) pts.push(a.clone().lerp(b, i / n)); };
    const R = 0.0028, off = 0.0015;
    const every = len => Math.max(2, Math.round(len / 0.07));
    for (const sz of [-1, 1]) for (const y of [H - E / 2, E / 2]) {
      line(new THREE.Vector3(-hw, y, sz * (hd + off)), new THREE.Vector3(hw, y, sz * (hd + off)), every(W));
    }
    for (const sx of [-1, 1]) for (const y of [H - E / 2, E / 2]) line(new THREE.Vector3(sx * (hw + off), y, -hd), new THREE.Vector3(sx * (hw + off), y, hd), every(D));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      line(new THREE.Vector3(sx * (hw - E / 2), 0, sz * (hd + off)), new THREE.Vector3(sx * (hw - E / 2), H, sz * (hd + off)), every(H));
      line(new THREE.Vector3(sx * (hw + off), 0, sz * (hd - E / 2)), new THREE.Vector3(sx * (hw + off), H, sz * (hd - E / 2)), every(H));
    }
    const rv = new THREE.InstancedMesh(new THREE.SphereGeometry(R, 8, 6), m.rivet, pts.length);
    const mm = new THREE.Matrix4(); pts.forEach((p, i) => { mm.makeScale(1, 1, 1).setPosition(p); rv.setMatrixAt(i, mm); });
    rv.userData.move = key; P.add(rv);
    // butterfly latches on the front and back seams
    if (H > 0.3 && W > 0.34) {
      const y = H - 0.095;
      for (const sz of [-1, 1]) for (const lx of W > 0.7 ? [-W * 0.28, W * 0.28] : [0]) {
        const dish = add(new THREE.BoxGeometry(0.075, 0.07, 0.006), m.chrome, lx, y, sz * (hd + 0.004));
        const well = add(new THREE.BoxGeometry(0.052, 0.048, 0.002), m.dark, lx, y, sz * (hd + 0.0075));
        const plate = add(new THREE.BoxGeometry(0.03, 0.036, 0.003), m.chrome, lx, y - 0.004, sz * (hd + 0.009));
        const hinge = add(new THREE.CylinderGeometry(0.0035, 0.0035, 0.034, 10), m.chrome, lx, y + 0.016, sz * (hd + 0.01)); hinge.rotation.z = Math.PI / 2;
      }
    }
    // recessed side handles
    if (H > 0.34) {
      const y = H * 0.62;
      for (const sx of [-1, 1]) {
        add(new THREE.BoxGeometry(0.006, 0.09, 0.14), m.chrome, sx * (hw + 0.004), y, 0);
        add(new THREE.BoxGeometry(0.002, 0.065, 0.11), m.dark, sx * (hw + 0.0075), y, 0);
        add(new THREE.BoxGeometry(0.014, 0.014, 0.09), m.handle, sx * (hw + 0.01), y - 0.018, 0);
      }
    }
    // generous invisible grab zones on the bottom corners so they are easy to catch
    const hz = new THREE.MeshBasicMaterial({ visible: false });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.07, 0.06, 0.07), hz, sx * hw, 0.03, sz * hd, { sx, sz });
    mergeStatic(P);   // ~50 parts -> one mesh per material and grab/resize tag (#84); redone on every resize
  }
  // Bottom resize handles in case-local coordinates (for direct touch)
  handles() {
    const out = []; const hw = this.W / 2, hd = this.D / 2;
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) { if (!sx && !sz) continue; out.push({ sx, sz, p: new THREE.Vector3(sx * hw, 0.02, sz * hd) }); }
    return out;
  }
}
