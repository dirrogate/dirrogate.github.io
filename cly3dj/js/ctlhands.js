// #276 (owner): in controller mode the 3D hands are shown holding the controllers. The generic hand model (the same
// one used for tracked hands) is posed here from fixed grip angles, fixed to the controller's grip space; the trigger
// curls the index finger, the grip button the middle / ring / pinky, touching the thumbstick or buttons lowers the thumb.
// The model's bones are flat (all children of the armature) in WebXR joint convention: -Z along the bone toward the
// fingertip, +Y out of the back of the hand, so a finger curls by turning each joint about its own X axis.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const CH = f => [`${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`];
const THUMB = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];
const D = Math.PI / 180;

// Pose numbers (degrees), open = button released, shut = fully pressed. Tuned on the PC against the Touch Plus model.
export const POSE = {
  index: { open: [18, 22, 12], shut: [40, 55, 35], rest: [60, 80, 45] },
  gloveSoft: 0.45,
  gloveO: { thumb: 1, swing: 0.2, roll: 0.2, index: 0.8 },   // #302 glove O: thumb turn 20 %, index curl 80 % (PC: glove tips 11 mm apart, was 33 mm with the thumb under the index)   // #301 glove mode: relaxed curls at 45 % (pressing the grip still closes the fist fully)      // on the trigger; rest = curled when not pressed (#295)
  rest: { open: [55, 75, 40], shut: [75, 85, 45] },       // middle / ring / pinky round the handle
  thumb: { open: [8, 10, 10], down: [18, 22, 18], spread: 0 },
  // #280 grip = an O of thumb and index (tips meeting), blended from whatever the trigger / thumb were doing
  O: { index: [25, 70, 50], thumb: [5, 30, 15], swing: 45, swingAxis: 'z', roll: 20 },   // PC: tips 1.6 cm apart (touching), a round opening ~4 cm
  // where the hand sits in grip space (right hand; the left is the mirror in X; grip -Z runs along the handle toward
  // the face): back of the hand facing out (+X),
  // the knuckle line along the handle (index at the front by the trigger, pinky toward the back), the middle knuckle at `knuckle`
  // #291 owner's live fit from the tablet (DJ TOOLS > HAND FIT): move (mm, grip space: x out, y up, z back) and turn
  // (deg, about the middle knuckle: rx tips the fingers up / down, ry swings them in / out, rz rolls the hand); mirrored for the left
  adj: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
  handle: [0, -0.6, 1], knuckle: [0.056, 0, 0], twist: 0,   // #290 (owner: the 3D hand sat inside the real one) knuckle 3 cm further out (was 0.026); mirrored for the left hand
};

export function createControllerHand(handed, url, material) {
  const root = new THREE.Group(); root.name = 'ctlHand-' + handed;
  const holder = new THREE.Group(); root.add(holder);
  const h = { handed, root, holder, ready: false, bones: {}, bind: {}, t: 0, g: 0, th: 0, cur: '' };
  new GLTFLoader().loadAsync(url).then(gltf => {
    const s = gltf.scene; holder.add(s);
    s.traverse(o => {
      if (o.isBone) { h.bones[o.name] = o; h.bind[o.name] = { p: o.position.clone(), q: o.quaternion.clone() }; }
      if (o.isMesh) { o.material = material; o.castShadow = false; o.frustumCulled = false; }
    });
    h.ready = true; h.cur = ''; place(h, handed); update(h, 0, 0, false);
  }).catch(e => console.warn('controller hand', e));
  h.update = (t, g, th) => update(h, t, g, th);
  h.place = () => place(h, handed);
  return h;
}

function place(h, handed) {
  if (!h.ready) return;
  const B = h.bind, sx = handed === 'left' ? -1 : 1;
  const n = new THREE.Vector3(0, 1, 0).applyQuaternion(B['wrist'].q).normalize();
  const f = B['middle-finger-phalanx-proximal'].p.clone().sub(B['wrist'].p); f.addScaledVector(n, -f.dot(n)).normalize();
  const nt = new THREE.Vector3(sx, 0, 0), at = new THREE.Vector3().fromArray(POSE.handle).normalize();
  const ft = new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0), at).normalize();   // same for both hands
  if (POSE.twist) ft.applyAxisAngle(nt, POSE.twist * D * sx);
  const mb = new THREE.Matrix4().makeBasis(n, f, new THREE.Vector3().crossVectors(n, f));
  const mt = new THREE.Matrix4().makeBasis(nt, ft, new THREE.Vector3().crossVectors(nt, ft));
  const R = mt.multiply(mb.transpose());
  h.holder.quaternion.setFromRotationMatrix(R);
  const k = B['middle-finger-phalanx-proximal'].p.clone().applyQuaternion(h.holder.quaternion);
  h.holder.position.set(POSE.knuckle[0] * sx, POSE.knuckle[1], POSE.knuckle[2]).sub(k);
  { // #291 the owner's fit: turn about the middle knuckle, then move
    const A = POSE.adj || {}, K = new THREE.Vector3(POSE.knuckle[0] * sx, POSE.knuckle[1], POSE.knuckle[2]);
    const qa = new THREE.Quaternion().setFromEuler(new THREE.Euler((A.rx || 0) * D, (A.ry || 0) * D * sx, (A.rz || 0) * D * sx, 'XYZ'));
    h.holder.quaternion.premultiply(qa); h.holder.position.sub(K).applyQuaternion(qa).add(K);
    h.holder.position.add(new THREE.Vector3((A.x || 0) * sx, A.y || 0, A.z || 0).multiplyScalar(0.001));
  }
  // #283 the middle of the closed O (thumb tip and index tip at full grip), in root (grip) space: while the grip is
  // held this fixed point is the ball and the touch point, so a knob or fader never slips as the grip pressure varies
  pose(h, 0, 1, false); h.holder.updateMatrix();
  const it = h.bones['index-finger-tip'], tt = h.bones['thumb-tip']; it.updateWorldMatrix(true, false); tt.updateWorldMatrix(true, false);
  const inv = new THREE.Matrix4().copy(h.root.matrixWorld).invert();
  h.oLocal = new THREE.Vector3().setFromMatrixPosition(it.matrixWorld).add(new THREE.Vector3().setFromMatrixPosition(tt.matrixWorld)).multiplyScalar(0.5).applyMatrix4(inv);
  // #284 the closed O's index fingertip (6 mm past the tip joint): the touch point while a button is held
  // #293 (owner) back on the INDEX tip (#289 had moved it to the thumb)
  const dj = h.bones['index-finger-phalanx-distal']; dj.updateWorldMatrix(true, false);
  const ti = new THREE.Vector3().setFromMatrixPosition(it.matrixWorld).applyMatrix4(inv), di = new THREE.Vector3().setFromMatrixPosition(dj.matrixWorld).applyMatrix4(inv);
  h.tipO = ti.clone().addScaledVector(ti.clone().sub(di).normalize(), 0.006);
  // #294 (owner) THE touch point and ball, fixed in grip space: the inner side of the relaxed thumb's pad (60 % of the
  // way from the thumb's last joint to its tip, 8 mm toward the index fingertip). A press closes the O and slides the
  // drawn hand (h.oShift, eased with the press) so the middle of the O lands on that point: the fingers close round
  // whatever the ball was on, and the touch point itself never moves.
  pose(h, 0, 0, false, true); h.holder.updateMatrix(); it.updateWorldMatrix(true, false); tt.updateWorldMatrix(true, false);   // #295 measured with the old straight index, so the ball stays where it was
  const tdj = h.bones['thumb-phalanx-distal']; tdj.updateWorldMatrix(true, false);
  const P = o => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
  const td = P(tdj), tp = P(tt), ip = P(it), pad = td.clone().lerp(tp, 0.6);
  h.tipRest = pad.clone().addScaledVector(ip.sub(pad).normalize(), 0.008);
  h.basePos = h.holder.position.clone();
  h.oShift = h.tipRest.clone().sub(h.oLocal);   // root (grip) space = the holder's parent space
  h.cur = '';
}

const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qr = new THREE.Quaternion(), ax = new THREE.Vector3(), vv = new THREE.Vector3();
// turn joints[k+1..] about joint k's own X axis by -angle (curl toward the palm)
function curl(h, chain, k, deg, axis = 'x') {
  const j = h.bones[chain[k]]; if (!j || !deg) return;
  ax.set(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0).applyQuaternion(j.quaternion);
  qr.setFromAxisAngle(ax, -deg * D);
  for (let i = k; i < chain.length; i++) {
    const b = h.bones[chain[i]]; if (!b) continue;
    if (i > k) b.position.sub(j.position).applyQuaternion(qr).add(j.position);
    b.quaternion.premultiply(qr);
  }
}
const lerp3 = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const add3 = (a, b, k) => a.map((x, i) => x + b[i] * k);
const _ta = new THREE.Vector3(), _tb = new THREE.Vector3();
function pose(h, t, g, th, openIndex = false) {
  for (const n in h.bind) { h.bones[n].position.copy(h.bind[n].p); h.bones[n].quaternion.copy(h.bind[n].q); }
  // #280 (owner): the grip closes thumb and index into an O (record grabs, the power dial, faders and knobs look like
  // real fingers on the casts); the trigger alone curls the index (scratching). Grip wins over the trigger.
  // #284 (owner): the trigger closes the O too (knobs, faders, scratching); the grip also curls the other three fingers
  const O = POSE.O, o = Math.max(t, g);
  // #295 (owner): the index rests curled into the palm and only comes up to close the O on a press
  const idx = lerp3(openIndex ? POSE.index.open : POSE.index.rest, h.soft ? O.index.map(v => v * POSE.gloveO.index) : O.index, o), rest = lerp3(POSE.rest.open, POSE.rest.shut, g);
  // #301 GLOVE mode: a looser relaxed hand (the robot's thick fingers crushed into each other in the full fist)
  if (h.soft) { const k = POSE.gloveSoft; for (let j = 0; j < 3; j++) { rest[j] *= k + (1 - k) * g; if (!openIndex) idx[j] = lerp3(POSE.index.rest.map(v => v * k), O.index.map(v => v * POSE.gloveO.index), o)[j]; } }
  for (const f of FINGERS) { const c = CH(f), a = f === 'index-finger' ? idx : rest; for (let j = 0; j < 3; j++) curl(h, c, j + 1, a[j]); }
  // #293 (owner): the thumb moves naturally again (#292 had it fixed in the O); the ball is back on the index tip
  // #302 glove: its thumb is longer than the skin hand's, so its O uses a smaller thumb turn (POSE.gloveO) or it slid under the index
  const GO = h.soft ? POSE.gloveO : { thumb: 1, swing: 1, roll: 1, index: 1 };
  const tp = lerp3(th ? POSE.thumb.down : POSE.thumb.open, O.thumb.map(v => v * GO.thumb), o);
  if (O.swing) curl(h, THUMB, 0, O.swing * GO.swing * o * (h.handed === 'left' ? -1 : 1), O.swingAxis || 'z');   // thumb across toward the index
  if (O.roll) curl(h, THUMB, 0, O.roll * GO.roll * o * (h.handed === 'left' ? -1 : 1), 'y');
  for (let j = 0; j < 3; j++) curl(h, THUMB, j, tp[j]);
}
const _t = new THREE.Vector3(), _d = new THREE.Vector3(), _inv = new THREE.Matrix4();
function update(h, t, g, th) {
  if (!h.ready) return;
  const key = `${t.toFixed(2)}|${g.toFixed(2)}|${th ? 1 : 0}`; if (key === h.cur) return; h.cur = key;
  pose(h, t, g, th);
  if (h.basePos && h.oShift) h.holder.position.copy(h.basePos).addScaledVector(h.oShift, Math.max(t, g));   // #294 the O onto the ball
  // #280 / #289 the blue ball and the touch point follow the thumb tip (6 mm past the tip joint, which is inside the
  // skin), in the hand root's space (= grip space)
  h.holder.updateMatrix();
  const tb = h.bones['index-finger-tip'], db = h.bones['index-finger-phalanx-distal'];   // #293 the index tip again
  tb.updateWorldMatrix(true, false); db.updateWorldMatrix(true, false); _inv.copy(h.root.matrixWorld).invert();
  _t.setFromMatrixPosition(tb.matrixWorld).applyMatrix4(_inv); _d.setFromMatrixPosition(db.matrixWorld).applyMatrix4(_inv);
  (h.tipLive || (h.tipLive = new THREE.Vector3())).copy(_t).addScaledVector(_d.subVectors(_t, _d).normalize(), 0.006);
}

// #300 (owner: the glove looked mangled / squashed). The glove follows the skin hand's 25 joints through robot2.js's
// solver, which also shifted it so its index fingertip sat on the tracked one (#247). Since the index rests curled
// (#295) that shift chased a fingertip inside the fist and dragged the glove's hand through itself. Now no fingertip
// shift: the glove's middle knuckle is put on the skin hand's middle knuckle each frame (its long cuff then sits back
// over the wrist, as measured in #287).
const _gv = new THREE.Vector3(), _gw = new THREE.Vector3();
export function driveGloveHand(g, H, J, dt) {
  if (!H.node0) H.node0 = H.node.position.clone();
  H.node.position.copy(H.node0); H.node.updateMatrixWorld(true); H.off = null;
  g.hand(H, { joints: J, tip: J.get('index-finger-tip'), curlIndex: 1 }, dt);   // tip + curl 1 = robot2 skips its fingertip shift
  const want = J.get('middle-finger-phalanx-proximal'); if (!want || !H.B.Middle_Proximal) return;
  H.B.Middle_Proximal.getWorldPosition(_gv);
  H.node.getWorldPosition(_gw).add(want).sub(_gv);
  H.node.parent.updateWorldMatrix(true, false); H.node.position.copy(H.node.parent.worldToLocal(_gw)); H.node.updateMatrixWorld(true);
}

// #303 (owner: cap it properly, and smoother without more triangles). Done once on the glove's own geometry (both
// gloves share it), nothing in the licensed GLB is changed:
//  - smooth shading: vertices at the same spot share an averaged normal when their faces are within 50 deg of each
//    other (sharp creases between the plates and the glove stay sharp); the triangle count is unchanged;
//  - the cuff's open end is closed with a fan from its own rim (16 triangles or so), skinned like the rim, so it moves
//    with the glove exactly (replaces #302's black disc).
export function gloveCap(H) {
  const mesh = H.mesh; if (!mesh || !mesh.geometry || mesh.geometry.userData.vireFixed) return;
  const g = mesh.geometry, pa = g.attributes.position, na = g.attributes.normal, n = pa.count;
  // weld by position
  const key = i => `${pa.getX(i).toFixed(5)},${pa.getY(i).toFixed(5)},${pa.getZ(i).toFixed(5)}`;
  const wid = new Int32Array(n), ids = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); let w = ids.get(k); if (w === undefined) ids.set(k, w = ids.size); wid[i] = w; }
  // 1. smooth normals within 50 deg
  if (na) {
    const groups = new Map(); for (let i = 0; i < n; i++) { let a = groups.get(wid[i]); if (!a) groups.set(wid[i], a = []); a.push(i); }
    const out = new Float32Array(n * 3), v = new THREE.Vector3(), u = new THREE.Vector3(), cs = Math.cos(50 * Math.PI / 180);
    for (const a of groups.values()) for (const i of a) {
      v.fromBufferAttribute(na, i); const sum = new THREE.Vector3();
      for (const j of a) { u.fromBufferAttribute(na, j); if (u.dot(v) > cs) sum.add(u); }
      sum.normalize(); out.set([sum.x, sum.y, sum.z], i * 3);
    }
    na.array.set(out); na.needsUpdate = true;
  }
  // 2. cap the cuff: boundary edges (welded) of the Root-skinned part, the biggest loop
  const sk = mesh.skeleton, ri = sk.bones.indexOf(H.B.Root), si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const main = i => { let b = 0, bw = -1; for (let c = 0; c < 4; c++) { const w = sw.getComponent(i, c); if (w > bw) { bw = w; b = si.getComponent(i, c); } } return b; };
  const A = g.index.array, ec = new Map(), rep = new Map();
  for (let t = 0; t < A.length; t += 3) for (const [x, y] of [[A[t], A[t + 1]], [A[t + 1], A[t + 2]], [A[t + 2], A[t]]]) {
    const a = wid[x], b = wid[y], k = a < b ? a + '_' + b : b + '_' + a; ec.set(k, (ec.get(k) || 0) + 1); rep.set(a, x); rep.set(b, y);
  }
  const adj = new Map(); for (const [k, c] of ec) if (c === 1) { const [a, b] = k.split('_').map(Number); (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); }
  const seen = new Set(); let best = null;
  for (const st of adj.keys()) {
    if (seen.has(st)) continue;
    const loop = [st]; seen.add(st); let prev = -1, cur = st;
    for (;;) { const nx = (adj.get(cur) || []).find(x => x !== prev && !seen.has(x)); if (nx === undefined) break; loop.push(nx); seen.add(nx); prev = cur; cur = nx; }
    const rootish = loop.filter(w => main(rep.get(w)) === ri).length / loop.length;
    if (loop.length >= 6 && rootish > 0.6 && (!best || loop.length > best.length)) best = loop;
  }
  if (best && ri >= 0) {
    const vs = best.map(w => rep.get(w)), P = i => new THREE.Vector3().fromBufferAttribute(pa, i);
    const c = vs.reduce((s, i) => s.add(P(i)), new THREE.Vector3()).multiplyScalar(1 / vs.length);
    let nrm = new THREE.Vector3(); for (let k = 0; k < vs.length; k++) nrm.add(new THREE.Vector3().crossVectors(P(vs[k]).sub(c), P(vs[(k + 1) % vs.length]).sub(c)));
    nrm.normalize();
    const all = new THREE.Vector3(); for (let i = 0; i < n; i++) all.add(P(i)); all.multiplyScalar(1 / n);
    const outward = c.clone().sub(all).dot(nrm) > 0; if (!outward) nrm.negate();
    // new vertices: the rim again (with the cap's normal) + the centre
    const add = vs.length + 1, attrs = {};
    for (const [name, at] of Object.entries(g.attributes)) {
      const isz = at.itemSize, arr = new at.array.constructor((n + add) * isz); arr.set(at.array);
      for (let k = 0; k <= vs.length; k++) {
        const src = k < vs.length ? vs[k] : vs[0], o = (n + k) * isz;
        for (let q = 0; q < isz; q++) arr[o + q] = at.array[src * isz + q];
      }
      attrs[name] = new THREE.BufferAttribute(arr, isz, at.normalized);
    }
    const o = (n + vs.length) * 3; attrs.position.array.set([c.x, c.y, c.z], o);
    for (let k = 0; k <= vs.length; k++) attrs.normal.array.set([nrm.x, nrm.y, nrm.z], (n + k) * 3);
    attrs.skinIndex.array.set([ri, 0, 0, 0], (n + vs.length) * 4); attrs.skinWeight.array.set([1, 0, 0, 0], (n + vs.length) * 4);
    const tri = [], cen = n + vs.length;
    for (let k = 0; k < vs.length; k++) {
      const a = n + k, b = n + (k + 1) % vs.length;
      const fn = new THREE.Vector3().crossVectors(P(vs[k]).sub(c), P(vs[(k + 1) % vs.length]).sub(c));
      if (fn.dot(nrm) > 0) tri.push(cen, a, b); else tri.push(cen, b, a);
    }
    const ng = new THREE.BufferGeometry();
    for (const [name, at] of Object.entries(attrs)) ng.setAttribute(name, at);
    const IA = Array.from(A).concat(tri); ng.setIndex(IA);
    ng.boundingSphere = g.boundingSphere; ng.boundingBox = g.boundingBox; ng.userData.vireFixed = true;
    H.capTris = tri.length / 3;
    return ng;
  }
  g.userData.vireFixed = true;
  return null;
}
export function gloveHide(g, H) { g.hand(H, null, 1); }   // #302

// #304 (owner): the glove's white pads in the same chrome as the robot's helmet (metalness 1, roughness 0.14, #245).
// The glove has one painted texture, so the pads are found per pixel: the brighter the painted colour, the more chrome.
export function chromePads(mat) {
  mat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', '#include <map_fragment>\n  float vireChrome = smoothstep(0.45, 0.7, dot(diffuseColor.rgb, vec3(0.3333)));')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = mix(metalnessFactor, 1.0, vireChrome);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.14, vireChrome);');
  };
  mat.customProgramCacheKey = () => 'vire-glove-chrome';
  mat.needsUpdate = true;
}
