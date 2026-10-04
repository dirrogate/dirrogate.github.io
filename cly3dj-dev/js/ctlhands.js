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
  index: { open: [18, 22, 12], shut: [40, 55, 35] },      // on the trigger
  rest: { open: [55, 75, 40], shut: [75, 85, 45] },       // middle / ring / pinky round the handle
  thumb: { open: [8, 10, 10], down: [18, 22, 18], spread: 0 },
  // where the hand sits in grip space (right hand; the left is the mirror in X; grip -Z runs along the handle toward
  // the face): back of the hand facing out (+X),
  // the knuckle line along the handle (index at the front by the trigger, pinky toward the back), the middle knuckle at `knuckle`
  handle: [0, -0.6, 1], knuckle: [0.026, 0, 0], twist: 0,
};

export function createControllerHand(handed, url, material) {
  const root = new THREE.Group(); root.name = 'ctlHand-' + handed;
  const holder = new THREE.Group(); root.add(holder);
  const h = { root, holder, ready: false, bones: {}, bind: {}, t: 0, g: 0, th: 0, cur: '' };
  new GLTFLoader().loadAsync(url).then(gltf => {
    const s = gltf.scene; holder.add(s);
    s.traverse(o => {
      if (o.isBone) { h.bones[o.name] = o; h.bind[o.name] = { p: o.position.clone(), q: o.quaternion.clone() }; }
      if (o.isMesh) { o.material = material; o.castShadow = false; o.frustumCulled = false; }
    });
    h.ready = true; h.cur = ''; place(h, handed); update(h, 0, 0, 0);
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
}

const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qr = new THREE.Quaternion(), ax = new THREE.Vector3(), vv = new THREE.Vector3();
// turn joints[k+1..] about joint k's own X axis by -angle (curl toward the palm)
function curl(h, chain, k, deg) {
  const j = h.bones[chain[k]]; if (!j || !deg) return;
  ax.set(1, 0, 0).applyQuaternion(j.quaternion);
  qr.setFromAxisAngle(ax, -deg * D);
  for (let i = k; i < chain.length; i++) {
    const b = h.bones[chain[i]]; if (!b) continue;
    if (i > k) b.position.sub(j.position).applyQuaternion(qr).add(j.position);
    b.quaternion.premultiply(qr);
  }
}
const lerp3 = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
function update(h, t, g, th) {
  if (!h.ready) return;
  const key = `${t.toFixed(2)}|${g.toFixed(2)}|${th ? 1 : 0}`; if (key === h.cur) return; h.cur = key;
  for (const n in h.bind) { h.bones[n].position.copy(h.bind[n].p); h.bones[n].quaternion.copy(h.bind[n].q); }
  const idx = lerp3(POSE.index.open, POSE.index.shut, t), rest = lerp3(POSE.rest.open, POSE.rest.shut, g);
  for (const f of FINGERS) { const c = CH(f), a = f === 'index-finger' ? idx : rest; for (let k = 0; k < 3; k++) curl(h, c, k + 1, a[k]); }
  const tp = th ? POSE.thumb.down : POSE.thumb.open; for (let k = 0; k < 3; k++) curl(h, THUMB, k, tp[k]);
}
