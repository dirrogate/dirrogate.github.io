// DJ CAM (CLAUDE.md #220): a virtual camera on the LED wall, plus an avatar of the DJ that copies the DJ's head and
// hands. Everything here runs on the Quest; no phone. The avatar lives on its own layer (AV_LAYER), so the headset's
// eye cameras never draw it (the DJ sees his real body); only the DJ CAM camera sees it. Whatever is on the LED wall
// reaches the Meta cast when the DJ looks at the wall.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';

export const AV_LAYER = 6;   // 1/2 = three's XR eyes, 5 = deck-inst HIDE_LAYER
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _v = [...Array(12)].map(() => new THREE.Vector3());
const _q = [...Array(6)].map(() => new THREE.Quaternion());
const _m = new THREE.Matrix4();

// orientation from a "fingers" direction and an index -> pinky direction (same construction for target and rest)
function basisQ(f, s, out) {
  const F = _v[10].copy(f).normalize(), N = _v[11].crossVectors(F, s).normalize(), S = _v[9].crossVectors(N, F);
  return out.setFromRotationMatrix(_m.makeBasis(S, N, F));
}
function worldQ(o, out) { return o.getWorldQuaternion(out); }
function worldP(o, out) { return o.getWorldPosition(out); }
function setWorldQ(bone, q) {   // bone world orientation = q
  const pq = bone.parent.getWorldQuaternion(_q[5]).invert();
  bone.quaternion.copy(pq.multiply(q)); bone.updateMatrixWorld(true);
}
function rotWorld(bone, dq) { setWorldQ(bone, _q[4].copy(dq).multiply(worldQ(bone, _q[3]))); }
function aim(bone, child, target) {   // turn bone so that child lies along bone -> target
  const b = worldP(bone, _v[0]), c = worldP(child, _v[1]);
  const cur = _v[2].subVectors(c, b).normalize(), des = _v[3].subVectors(target, b);
  if (des.lengthSq() < 1e-10 || cur.lengthSq() < 0.5) return;
  rotWorld(bone, _q[2].setFromUnitVectors(cur, des.normalize()));
}
function aimDir(bone, child, dir) { const b = worldP(bone, _v[4]); aim(bone, child, _v[5].copy(b).add(dir)); }
// two-bone IK: upper -> mid -> end reaches T, elbow / knee toward pole
function twoBone(upper, mid, end, T, pole) {
  const S = worldP(upper, _v[6]).clone(), E0 = worldP(mid, _v[7]).clone(), H0 = worldP(end, _v[8]).clone();
  const a = S.distanceTo(E0), b = E0.distanceTo(H0);
  const D = T.clone().sub(S); let d = D.length(); if (d < 1e-5) return;
  const dir = D.divideScalar(d); d = clamp(d, Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const pv = pole.clone().sub(S); pv.addScaledVector(dir, -pv.dot(dir)); if (pv.lengthSq() < 1e-8) pv.set(0, -1, 0); pv.normalize();
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const elbow = S.clone().addScaledVector(dir, a * cosA).addScaledVector(pv, a * sinA);
  aim(upper, mid, elbow);
  aim(mid, end, S.addScaledVector(dir, d));
}

const FINGERS = [   // RPM bone prefix, WebXR joint names base -> tip
  ['Thumb', ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']],
  ['Index', ['index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip']],
  ['Middle', ['middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip']],
  ['Ring', ['ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip']],
  ['Pinky', ['pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip']],
];

export class Avatar {
  constructor(rig) {
    this.rig = rig; this.root = new THREE.Group(); this.root.name = 'avatar'; rig.add(this.root);
    this.ready = false; this.standEye = null; this.yaw = null; this.hipsXZ = null; this.mouthV = 0;
    this.arm = [null, null]; this.foot = [null, null]; this.status = 'loading';
  }
  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const m = gltf.scene; this.root.add(m);
    const B = {}; this.mouth = [];
    m.traverse(o => {
      if (o.isBone) B[o.name] = o;
      if (o.isMesh) {
        o.layers.set(AV_LAYER); o.frustumCulled = false; o.castShadow = o.receiveShadow = false;
        const d = o.morphTargetDictionary; if (d && d.mouthOpen != null) this.mouth.push([o, d.mouthOpen]);
      }
    });
    for (const n of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftEye', 'RightEye', 'LeftArm', 'RightArm']) if (!B[n]) throw new Error('avatar rig: no ' + n + ' bone (Ready Player Me rig expected)');
    this.B = B;
    this.root.position.set(0, 0, 0); this.root.quaternion.identity(); this.root.scale.setScalar(1); this.root.updateMatrixWorld(true);
    const inv = this.root.matrixWorld.clone().invert(), rqInv = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.bind = new Map(); this.rp = {}; this.rq = {};
    for (const [n, b] of Object.entries(B)) {
      this.bind.set(b, b.quaternion.clone());
      this.rp[n] = b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
      this.rq[n] = rqInv.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion()));
    }
    const eye = this.rp.LeftEye.clone().add(this.rp.RightEye).multiplyScalar(0.5);
    this.restEye = eye; this.restEyeY = eye.y;
    this.fwdSign = eye.z - this.rp.Head.z >= 0 ? 1 : -1;   // RPM faces +Z
    this.F = new THREE.Quaternion().setFromAxisAngle(UP, this.fwdSign > 0 ? Math.PI : 0);   // XR camera frame in root space
    this.Finv = this.F.clone().invert();
    this.ankleY = B.LeftFoot ? this.rp.LeftFoot.y : 0.1;
    this.restHand = ['Left', 'Right'].map(s => {   // rest hand frame (root space) for the basis mapping
      if (!B[s + 'Hand'] || !B[s + 'HandMiddle1'] || !B[s + 'HandIndex1'] || !B[s + 'HandPinky1']) return null;
      const f = this.rp[s + 'HandMiddle1'].clone().sub(this.rp[s + 'Hand']), sd = this.rp[s + 'HandPinky1'].clone().sub(this.rp[s + 'HandIndex1']);
      return { inv: basisQ(f, sd, new THREE.Quaternion()).invert(), q: this.rq[s + 'Hand'] };
    });
    this.ready = true; this.status = 'ready';
    return this;
  }

  // pose: { head: {p: Vector3 world eye point, q: Quaternion world (XR camera)}, hands: [left, right] each null or
  //   { p: wrist world, f: fingers dir, s: index->pinky dir, joints?: Map name->world pos, curl?: 0..1, curlIndex?: 0..1 } },
  //   floorY (world), mic (0..1), dt
  update(pose) {
    if (!this.ready || !pose || !pose.head) return;
    const { head, hands, floorY = 0, dt = 1 / 60 } = pose, B = this.B;
    const headY = head.p.y - floorY;
    // standing eye height: rises at once, sinks very slowly (so crouching doesn't shrink the avatar)
    this.standEye = this.standEye == null ? Math.max(headY, 1.45) : Math.max(this.standEye - 0.004 * dt, headY);
    const s = clamp(this.standEye / this.restEyeY, 0.8, 1.3);
    // body yaw: follows the head, pulled toward the hands, never more than ~50 deg off the head
    const hf = _v[0].set(0, 0, -1).applyQuaternion(head.q); hf.y = 0;
    let headYaw = hf.lengthSq() > 1e-4 ? Math.atan2(hf.x, hf.z) : (this.yaw ?? 0);
    let tgt = headYaw;
    const hv = (hands || []).filter(Boolean);
    if (hv.length) {
      const mid = _v[1].set(0, 0, 0); hv.forEach(h => mid.add(h.p)); mid.multiplyScalar(1 / hv.length).sub(head.p); mid.y = 0;
      if (mid.lengthSq() > 0.01) { const hy = Math.atan2(mid.x, mid.z); tgt = headYaw + 0.5 * Math.atan2(Math.sin(hy - headYaw), Math.cos(hy - headYaw)); }
    }
    if (this.yaw == null) this.yaw = tgt;
    let dy = Math.atan2(Math.sin(tgt - this.yaw), Math.cos(tgt - this.yaw));
    this.yaw += dy * Math.min(1, dt * 3);
    dy = Math.atan2(Math.sin(this.yaw - headYaw), Math.cos(this.yaw - headYaw)); if (Math.abs(dy) > 0.9) this.yaw = headYaw + Math.sign(dy) * 0.9;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);   // right of the body
    // hips under / behind the head; follow lazily, crouch when the head drops well below standing height
    const want = head.p.clone().addScaledVector(fwd, -(this.restEye.z * this.fwdSign) * s); want.y = 0;
    if (!this.hipsXZ) this.hipsXZ = want.clone();
    const off = want.clone().sub(this.hipsXZ), dist = off.length();
    if (dist > 0.22) this.hipsXZ.addScaledVector(off, (dist - 0.22) / dist);
    this.hipsXZ.lerp(want, Math.min(1, dt * 1.2));
    const drop = Math.max(0, this.standEye - headY - 0.12) * 0.85;
    // root (world): yaw so the avatar faces fwd, feet at the floor
    const rootYaw = Math.atan2(fwd.x, fwd.z) + (this.fwdSign > 0 ? 0 : Math.PI);
    const rootQw = _q[0].setFromAxisAngle(UP, rootYaw);
    const rigQ = this.rig.getWorldQuaternion(_q[1]);
    this.root.quaternion.copy(rigQ.clone().invert().multiply(rootQw));
    this.root.scale.setScalar(s);
    const rootW = new THREE.Vector3(this.hipsXZ.x, floorY - drop, this.hipsXZ.z);
    this.root.position.copy(this.rig.worldToLocal(rootW.clone()));
    for (const [b, q] of this.bind) b.quaternion.copy(q);
    this.root.updateMatrixWorld(true);
    // spine: bend the chain so hips -> eyes points at the real eyes
    const eyeW = () => worldP(B.LeftEye, _v[2]).add(worldP(B.RightEye, _v[3])).multiplyScalar(0.5);
    const hipsW = worldP(B.Hips, new THREE.Vector3());
    const cur = eyeW().sub(hipsW).normalize(), des = head.p.clone().sub(hipsW).normalize();
    const qs = new THREE.Quaternion().setFromUnitVectors(cur, des);
    const ang = 2 * Math.acos(clamp(Math.abs(qs.w), -1, 1)); if (ang > 1.1) qs.slerp(new THREE.Quaternion(), 1 - 1.1 / ang);
    const third = new THREE.Quaternion().slerp(qs, 1 / 3);
    for (const n of ['Spine', 'Spine1', 'Spine2']) rotWorld(B[n], third);
    // neck takes 40 % of the head's turn, head the rest (exact)
    // rq.* are root-space rest orientations. At rest the camera would be rootQ * F and the head rootQ * rq.Head,
    // so head = camera * F^-1 * rq.Head (the root's turn cancels out)
    const HdW = head.q.clone().multiply(this.Finv).multiply(this.rq.Head);
    const Hc = worldQ(B.Head, new THREE.Quaternion());
    const delta = HdW.clone().multiply(Hc.clone().invert());
    rotWorld(B.Neck, new THREE.Quaternion().slerp(delta, 0.4));
    setWorldQ(B.Head, HdW);
    // put the avatar's eyes exactly on the real eyes
    const err = head.p.clone().sub(eyeW());
    this.root.position.add(err.applyQuaternion(rigQ.clone().invert()));
    this.root.updateMatrixWorld(true);
    // arms
    const down = new THREE.Vector3(0, -1, 0);
    ['Left', 'Right'].forEach((side, i) => {
      const up = B[side + 'Arm'], lo = B[side + 'ForeArm'], hb = B[side + 'Hand']; if (!up || !lo || !hb) return;
      const h = hands && hands[i], sh = worldP(up, new THREE.Vector3()), sgn = i ? 1 : -1;   // left hand on the body's left (-right)
      let T;
      if (h) T = h.p.clone();
      else T = sh.clone().addScaledVector(down, 0.55 * s).addScaledVector(right, sgn * 0.08 * s).addScaledVector(fwd, 0.08 * s);
      if (!this.arm[i]) this.arm[i] = T.clone();
      this.arm[i].lerp(T, Math.min(1, dt * (h ? 25 : 4)));
      const pole = sh.clone().addScaledVector(down, 0.5).addScaledVector(right, sgn * 0.35).addScaledVector(fwd, -0.35);
      twoBone(up, lo, hb, this.arm[i], pole);
      const rh = this.restHand[i];
      if (h && rh) {
        setWorldQ(hb, basisQ(h.f, h.s, new THREE.Quaternion()).multiply(rh.inv).multiply(rh.q));
        this.fingers(side, i, h);
      }
    });
    // legs: feet planted under the hips, knees forward
    ['Left', 'Right'].forEach((side, i) => {
      const ul = B[side + 'UpLeg'], lg = B[side + 'Leg'], ft = B[side + 'Foot']; if (!ul || !lg || !ft) return;
      const sgn = i ? 1 : -1;
      const want = new THREE.Vector3(this.hipsXZ.x, floorY + this.ankleY * s, this.hipsXZ.z).addScaledVector(right, sgn * 0.11 * s);
      if (!this.foot[i] || this.foot[i].distanceTo(want) > 0.3) this.foot[i] = want.clone();
      this.foot[i].lerp(want, Math.min(1, dt * 4));
      const hp = worldP(ul, new THREE.Vector3());
      twoBone(ul, lg, ft, this.foot[i], hp.clone().addScaledVector(fwd, 0.6).addScaledVector(down, 0.4));
      setWorldQ(ft, new THREE.Quaternion().setFromAxisAngle(UP, rootYaw).multiply(this.rq[side + 'Foot']));
    });
    // mouth from the mic
    const mv = clamp(((pose.mic || 0) - 0.02) * 4, 0, 1);
    this.mouthV += (mv - this.mouthV) * Math.min(1, dt * (mv > this.mouthV ? 25 : 10));
    for (const [o, k] of this.mouth) o.morphTargetInfluences[k] = this.mouthV * 0.8;
  }
  fingers(side, i, h) {
    const B = this.B;
    if (h.joints) {   // hand tracking: each finger bone along the tracked bone
      for (const [name, js] of FINGERS) for (let k = 0; k < 3; k++) {
        const bone = B[side + 'Hand' + name + (k + 1)], child = B[side + 'Hand' + name + (k + 2)];
        const a = h.joints.get(js[k]), b = h.joints.get(js[k + 1]);
        if (bone && child && a && b) aimDir(bone, child, b.clone().sub(a));
      }
      return;
    }
    // controller / no joints: curl the fingers toward the palm (grip), index by the trigger
    const f = h.f.clone().normalize(), sd = h.s.clone().normalize();
    const palm = i === 0 ? new THREE.Vector3().crossVectors(sd, f) : new THREE.Vector3().crossVectors(f, sd);
    const axis = new THREE.Vector3().crossVectors(f, palm).normalize();
    for (const [name] of FINGERS) {
      const c = name === 'Index' ? (h.curlIndex ?? h.curl ?? 0.2) : name === 'Thumb' ? (h.curl ?? 0.2) * 0.4 : (h.curl ?? 0.2);
      const dq = new THREE.Quaternion().setFromAxisAngle(axis, c * 0.75);
      for (let k = 1; k <= 3; k++) { const b = B[side + 'Hand' + name + k]; if (b) rotWorld(b, dq); }
    }
  }
}

// Gather the DJ's pose from WebXR (head = XR camera, hands = joints or controller grips)
const HANDS_J = ['wrist', ...FINGERS.flatMap(f => f[1])];
export function xrPose(renderer, inputs) {
  const xc = renderer.xr.getCamera(); xc.updateMatrixWorld();
  const head = { p: new THREE.Vector3().setFromMatrixPosition(xc.matrixWorld), q: xc.getWorldQuaternion(new THREE.Quaternion()) };
  const hands = [null, null];
  for (const st of inputs || []) {
    if (!st || !st.connected || !st.source) continue;
    const i = st.source.handedness === 'left' ? 0 : st.source.handedness === 'right' ? 1 : -1; if (i < 0) continue;
    if (st.isHand) {
      const J = st.hand.joints; if (!J || !J.wrist || !J.wrist.visible) continue;
      const joints = new Map();
      for (const n of HANDS_J) { const j = J[n]; if (j && j.visible) joints.set(n, j.getWorldPosition(new THREE.Vector3())); }
      const w = joints.get('wrist'), mp = joints.get('middle-finger-phalanx-proximal'), ip = joints.get('index-finger-phalanx-proximal'), pp = joints.get('pinky-finger-phalanx-proximal');
      if (!w || !mp || !ip || !pp) continue;
      hands[i] = { p: w, f: mp.clone().sub(w), s: pp.clone().sub(ip), joints };
    } else if (st.grip) {
      st.grip.updateMatrixWorld();
      const gq = st.grip.getWorldQuaternion(new THREE.Quaternion()), gp = st.grip.getWorldPosition(new THREE.Vector3());
      const gp2 = st.source.gamepad, bt = gp2 && gp2.buttons;
      hands[i] = {
        p: gp.clone().add(new THREE.Vector3(0, 0, 0.07).applyQuaternion(gq)),   // wrist sits a little behind the grip centre
        f: new THREE.Vector3(0, -0.35, -1).applyQuaternion(gq), s: new THREE.Vector3(0, -1, 0.25).applyQuaternion(gq),
        curl: bt && bt[1] ? 0.25 + 0.75 * bt[1].value : 0.3, curlIndex: bt && bt[0] ? 0.15 + 0.85 * bt[0].value : 0.2,
        tip: st.tip ? st.tip.clone() : null,   // #247: the blue tip ball; the robot's index fingertip is put on it
      };
    }
  }
  return { head, hands };
}

// Desktop (no headset): a DJ standing at the decks, nodding, left hand on deck A, right hand on the mixer
export function demoPose(rig, gear, t) {
  const L = (x, y, z) => rig.localToWorld(new THREE.Vector3(x, y, z));
  const rq = rig.getWorldQuaternion(new THREE.Quaternion());
  const bob = Math.sin(t * Math.PI * 2 * 2.1);   // ~126 BPM nod
  const mx = gear.mixer.x, mz = gear.mixer.z, a = gear.deckA, top = gear.top;
  const head = {
    p: L(mx + 0.05 + 0.03 * Math.sin(t * 0.7), 1.62 + 0.012 * bob, mz + 0.38),
    q: rq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.55 + 0.05 * bob, 0.15 * Math.sin(t * 0.4), 0, 'YXZ'))),
  };
  const sc = Math.sin(t * 3.1);   // scratch back and forth on deck A's record edge
  // #248: wrists 4 cm higher (the demo's fingertips sat 2 to 4 cm under the plinth and mixer tops)
  const lp = L(a.x + 0.06 + 0.04 * sc, top + 0.11, a.z + 0.13 + 0.02 * Math.cos(t * 3.1));
  const rp = L(mx + 0.02 + 0.05 * Math.sin(t * 0.9), top + 0.10, mz + 0.14);
  const d = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(rq);
  return { head, hands: [
    { p: lp, f: d(0.15, -0.45, -1), s: d(-1, 0, 0.1), curl: 0.3, curlIndex: 0.25 },
    { p: rp, f: d(-0.1, -0.5, -1), s: d(1, 0, 0.1), curl: 0.45, curlIndex: 0.3 },
  ] };
}

// The DJ CAM: renders the stage (with the avatar) from a preset angle into a 16:9 texture for the LED wall
export const CAM_PRESETS = {
  front: { label: 'FRONT', fov: 38 }, wide: { label: 'WIDE', fov: 50 }, low: { label: 'LOW', fov: 55 },
  platters: { label: 'PLATTERS', fov: 45 }, faders: { label: 'FADERS', fov: 40 }, crate: { label: 'CRATE', fov: 48 }, top: { label: 'TOP', fov: 50 },
};
export class DjCam {
  constructor(renderer, rig) {
    this.renderer = renderer; this.rig = rig;
    this.cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 40); this.cam.layers.enable(AV_LAYER); rig.add(this.cam);
    const half = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    this.rt = new THREE.WebGLRenderTarget(1024, 576, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: 4 });
    this.rt.texture.name = 'djcam';
    this.preset = 'front'; this.n = 0; this.t = 0; this.lastMs = 0; this.ms = 0;
  }
  aimAt(gear, dj) {   // rig-local positions
    const m = gear.mixer, A = gear.deckA, Bk = gear.deckB, c = gear.crate, top = gear.top, z = dj.z;
    const P = {
      front: [[m.x, 1.55, m.z - 1.65], [m.x, 1.22, (m.z + z) / 2]],
      wide: [[m.x + 1.5, 1.95, m.z - 1.8], [m.x, 1.1, (m.z + z) / 2]],
      low: [[m.x - 0.35, top - 0.05, m.z - 0.75], [m.x, 1.4, z]],
      platters: [[A.x - 0.62, top + 0.1, A.z - 0.12], [Bk.x, top - 0.02, Bk.z + 0.05]],
      faders: [[m.x, top + 0.42, m.z - 0.42], [m.x, top - 0.02, m.z + 0.05]],
      crate: [[c.x - 0.35, 1.45, c.z - 0.75], [c.x, 0.55, c.z]],
      top: [[m.x, 2.7, m.z + 0.35], [m.x, top, m.z + 0.08]],
    }[this.preset] || null;
    if (!P) return;
    const tw = this.t, sway = 0.006;   // a hint of hand-held drift
    this.cam.position.set(P[0][0] + sway * Math.sin(tw * 0.53), P[0][1] + sway * Math.sin(tw * 0.71), P[0][2]);
    this.cam.updateMatrixWorld();
    this.cam.lookAt(this.rig.localToWorld(new THREE.Vector3(...P[1])));
    const fov = CAM_PRESETS[this.preset].fov; if (this.cam.fov !== fov) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
  }
  // every: render one frame in `every` (90 Hz headset / 3 = 30 fps). prep() hides what the cam mustn't see and returns
  // an undo function.
  render(scene, dt, every, prep) {
    this.t += dt;
    if (++this.n % every) return false;
    const r = this.renderer, t0 = performance.now();
    const prevRT = r.getRenderTarget(), prevXR = r.xr.enabled, prevSh = r.shadowMap.autoUpdate;
    const undo = prep ? prep() : null;
    try {
      r.xr.enabled = false; r.shadowMap.autoUpdate = false;
      r.setRenderTarget(this.rt); r.clear(); r.render(scene, this.cam);
    } finally {
      r.xr.enabled = prevXR; r.shadowMap.autoUpdate = prevSh; r.setRenderTarget(prevRT);
      if (undo) undo();
    }
    this.ms = this.ms * 0.9 + (performance.now() - t0) * 0.1;
    return true;
  }
}
