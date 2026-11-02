// #592 ROOM SNAP: the Quest's Space Setup planes (WebXR plane-detection) in rig space, so portal frames can sit exactly on
// real walls, fill scanned door / window frames, or open a skylight in the ceiling, without trusting CAM FIT for placement.
// Plane space: y = the plane's normal, the outline lies in x / z. We flip the normal toward the viewer, so it points into the room.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
export const SNAP_IN = 0.15, SNAP_OUT = 0.3, GAP = 0.03;   // catch distance, let-go distance, frame back to surface (the trim is 6 cm deep)

export class RoomSnap {
  constructor(rig) { this.rig = rig; this.planes = []; this.cache = new Map(); this.t = 0; this.gen = 0; }
  get ok() { return this.planes.length > 0; }
  // frame / ref from renderer.xr; eye = the viewer's position in rig space
  update(frame, ref, eye) {
    if (!frame || !ref || !frame.detectedPlanes) { this.planes = []; return; }
    this.rig.updateMatrixWorld(); const rI = _m2.copy(this.rig.matrixWorld).invert(), out = [], seen = new Set();
    for (const p of frame.detectedPlanes) {
      const pose = frame.getPose(p.planeSpace, ref); if (!pose) continue;
      let e = this.cache.get(p);
      if (!e) { e = { M: new THREE.Matrix4(), inv: new THREE.Matrix4(), n: new THREE.Vector3(), o: new THREE.Vector3(), pts: [], t: -1, label: '' }; this.cache.set(p, e); }
      e.M.fromArray(pose.transform.matrix).premultiply(rI); e.inv.copy(e.M).invert();
      e.o.setFromMatrixPosition(e.M); e.n.set(0, 1, 0).transformDirection(e.M);
      if (eye && _v.copy(eye).sub(e.o).dot(e.n) < 0) e.n.negate();
      if (e.t !== p.lastChangedTime || !e.pts.length) { e.t = p.lastChangedTime; e.loc = p.polygon.map(v => new THREE.Vector2(v.x, v.z)); }
      e.pts = e.loc.map(v => new THREE.Vector3(v.x, 0, v.y).applyMatrix4(e.M));
      const L = (p.semanticLabel || '').toLowerCase(), vert = Math.abs(e.n.dot(UP)) < 0.3, down = e.n.dot(UP) < -0.7;
      e.label = /door/.test(L) ? 'door' : /window/.test(L) ? 'window' : /ceil/.test(L) || (!L && down && e.o.y > 1.6) ? 'ceiling' : /floor/.test(L) ? 'floor' : /wall/.test(L) || (!L && vert) ? 'wall' : 'other';
      out.push(e); seen.add(p);
    }
    for (const k of this.cache.keys()) if (!seen.has(k)) this.cache.delete(k);
    if (!this.planes.length && out.length) this.gen++;   // the scan (re)appeared: main.js re-pins saved frames
    this.planes = out;
  }
  // is P (rig space) over this plane's outline (+ margin)? local x / z test against the polygon
  inside(e, P, margin = 0.1) {
    _v.copy(P).applyMatrix4(e.inv); let c = false; const L = e.loc, n = L.length;
    for (let i = 0, j = n - 1; i < n; j = i++) { const a = L[i], b = L[j]; if ((a.y > _v.z) !== (b.y > _v.z) && _v.x < (b.x - a.x) * (_v.z - a.y) / (b.y - a.y) + a.x) c = !c; }
    if (c) return true;
    for (let i = 0, j = n - 1; i < n; j = i++) { if (segDist(_v.x, _v.z, L[j], L[i]) < margin) return true; } return false;
  }
  dist(e, P) { return _v.copy(P).sub(e.o).dot(e.n); }
  // the nearest plane with one of these labels whose surface P is within maxD of and over
  nearest(P, labels, maxD) {
    let best = null, bd = maxD;
    for (const e of this.planes) { if (!labels.includes(e.label)) continue; const d = Math.abs(this.dist(e, P)); if (d < bd && this.inside(e, P)) { bd = d; best = e; } }
    return best;
  }
  byLabel(l) { return this.planes.filter(e => e.label === l); }
  // a frame's pose flat on plane e: opening GAP off the surface, facing into the room; walls keep the frame upright,
  // ceilings keep its turn (yHint = the frame's current up, or the viewer's look direction)
  pose(e, P, yHint, outP, outQ) {
    const Z = _z.copy(e.n), Y = _y.copy(Math.abs(Z.dot(UP)) < 0.7 ? UP : yHint).addScaledVector(Z, -Z.dot(Math.abs(Z.dot(UP)) < 0.7 ? UP : yHint));
    if (Y.lengthSq() < 1e-6) Y.set(0, 0, -1).addScaledVector(Z, -Z.z); Y.normalize(); const X = _x.crossVectors(Y, Z).normalize();
    outQ.setFromRotationMatrix(_m.makeBasis(X, Y, Z));
    outP.copy(P).addScaledVector(Z, GAP - this.dist(e, P));
  }
  // fill a scanned door / window frame: centre, upright pose, half size along the frame's own axes
  fit(e, outP, outQ, outHalf) {
    const c = _c.set(0, 0, 0); for (const p of e.pts) c.add(p); c.divideScalar(e.pts.length || 1);
    this.pose(e, c, UP, outP, outQ); const X = _x.set(1, 0, 0).applyQuaternion(outQ), Y = _y.set(0, 1, 0).applyQuaternion(outQ);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of e.pts) { _v.copy(p).sub(outP); const a = _v.dot(X), b = _v.dot(Y); x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); }
    outP.addScaledVector(X, (x0 + x1) / 2).addScaledVector(Y, (y0 + y1) / 2); outHalf.set((x1 - x0) / 2, (y1 - y0) / 2);
  }
  // #593 SCAN PORTALS: a cut-out covering the whole surface (outline's bounding box + 2 cm), as a rig-space pose
  cutout(e, outM, outHalf) {
    const c = _c.set(0, 0, 0); for (const p of e.pts) c.add(p); c.divideScalar(e.pts.length || 1);
    const P = _p.set(0, 0, 0), Q = _q.set(0, 0, 0, 1); this.pose(e, c, Math.abs(e.n.y) > 0.7 ? _h.set(0, 0, -1) : UP, P, Q);
    P.addScaledVector(e.n, -0.03 + 0.005);   // on the surface, not the 3 cm frame gap
    const X = _x.set(1, 0, 0).applyQuaternion(Q), Y = _y.set(0, 1, 0).applyQuaternion(Q); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of e.pts) { _v.copy(p).sub(P); const a = _v.dot(X), b = _v.dot(Y); x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); }
    P.addScaledVector(X, (x0 + x1) / 2).addScaledVector(Y, (y0 + y1) / 2); outHalf.set((x1 - x0) / 2 + 0.02, (y1 - y0) / 2 + 0.02);
    return outM.compose(P, Q, _one);
  }
  // #593 the laser on the scan: o / d in rig space -> { e, t, P } for the nearest surface it hits inside its outline
  ray(o, d) {
    let best = null;
    for (const e of this.planes) { if (e.label === 'other') continue; const dn = d.dot(e.n); if (Math.abs(dn) < 1e-4) continue;
      const t = _v.copy(e.o).sub(o).dot(e.n) / dn; if (t <= 0.05 || (best && t >= best.t)) continue;
      const P = o.clone().addScaledVector(d, t); if (this.inside(e, P, 0)) best = { e, t, P }; }
    return best;
  }
}
function segDist(x, y, a, b) { const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L)) : 0; return Math.hypot(x - a.x - t * dx, y - a.y - t * dy); }
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _h = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
