// SpatialED #24 TAKE (narrator-plan.md): record the professor's voice (the mixer's MIC, after its pitch and voice
// settings) together with his head and hands, against one clock, for stamping as a narrator record.
//  - A virtual mirror: Dirro stands ~1.3 m in front of you and moves as your reflection (live while you wait and
//    record, from the recording while you review). Optional wireframe skeleton.
//  - CALIBRATE: one second standing naturally; fixes the take's floor origin (under your head), your facing (becomes
//    +z, the narrator's front) and your eye height.
//  - Motion is stored in that take frame, ~30 frames a second: head (position, turn), each hand (wrist, fingers
//    direction, index -> pinky direction, the 21 hand-tracking joints when hands are tracked).
//  - Audio: MediaRecorder on the mic's output (webm / opus). Kept in this device's storage, folder sed-takes.
import * as THREE from 'three';
import { Avatar, xrPose, HANDS_J } from './director.js';

const ROOT = 'sed-takes', MIRROR_DIST = 1.3, FPS = 30, MODEL = 'models/avatar/DirrogateAvatar_face.glb';
const R3 = v => Math.round(v * 1000) / 1000;

async function dir() { return (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, { create: true }); }
export async function saveTakeFile(name, data) {
  const fh = await (await dir()).getFileHandle(name, { create: true }), w = await fh.createWritable();
  await w.write(data); await w.close();
}
export async function readTakeFile(name) { return (await (await dir()).getFileHandle(name)).getFile(); }

export class TakeStudio {
  constructor({ renderer, scene, rig, engine, getInputs, toast, ensureMic, onChange }) {
    Object.assign(this, { renderer, scene, rig, engine, getInputs, toast, ensureMic, onChange });
    this.state = 'closed'; this.msg = ''; this.skeleton = false; this.frames = []; this.blob = null; this.duration = 0; this.calib = null;
  }
  say(m) { this.msg = m; this.onChange && this.onChange(); }

  // ---------------------------------------------------------------- open / close
  async open() {
    if (this.state !== 'closed') return;
    this.state = 'loading'; this.say('Loading the mirror…');
    this.mirrorRig = new THREE.Group(); this.mirrorRig.name = 'take-mirror'; this.scene.add(this.mirrorRig);
    this.av = new Avatar(this.mirrorRig);
    try { await this.av.load(MODEL, { eyes: true }); }
    catch (e) { this.state = 'closed'; this.say('Mirror model not loaded: ' + e.message); return; }
    this.skel = new THREE.SkeletonHelper(this.av.root); this.skel.visible = this.skeleton; this.scene.add(this.skel);
    this.state = 'idle'; this.say('Put the controllers down (hands tracked), stand naturally, then CALIBRATE.');
  }
  close() {
    this.stopAll();
    if (this.mirrorRig) { this.scene.remove(this.mirrorRig); this.mirrorRig = null; }
    if (this.skel) { this.scene.remove(this.skel); this.skel.dispose && this.skel.dispose(); this.skel = null; }
    this.av = null; this.state = 'closed';
  }
  toggleSkeleton() { this.skeleton = !this.skeleton; if (this.skel) this.skel.visible = this.skeleton; this.onChange && this.onChange(); }

  // ---------------------------------------------------------------- calibrate, record, review
  calibrate() {
    if (!this.av || this.state === 'rec') return;
    this.state = 'calib'; this.cal = { t0: performance.now(), n: 0, p: new THREE.Vector3(), f: new THREE.Vector3(), eye: 0 };
    this.say('Calibrating: stand naturally, look ahead…');
  }
  async record() {
    if (!this.calib) { this.say('CALIBRATE first.'); return; }
    if (this.state === 'rec') return;
    try { await this.ensureMic(); } catch (e) { this.say('No microphone: ' + e.message); return; }
    const m = this.engine.mic; if (!m) { this.say('The MIC is not open (Settings: Mic route "Through the mixer").'); return; }
    this.dest = this.dest || this.engine.ctx.createMediaStreamDestination(); m.on.connect(this.dest);
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    this.chunks = []; this.frames = []; this.blob = null;
    const rec = this.rec = new MediaRecorder(this.dest.stream, { mimeType: mime, audioBitsPerSecond: 96000 });
    rec.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    rec.onstop = () => {
      this.blob = new Blob(this.chunks, { type: mime }); this.duration = (performance.now() - this.t0) / 1000;
      try { m.on.disconnect(this.dest); } catch {}
      this.state = 'review'; this.say(`Take: ${this.duration.toFixed(1)} s. PLAY to check, REC again to retake, or DONE.`);
    };
    rec.onstart = () => { this.t0 = performance.now(); this.lastF = -1; this.state = 'rec'; this.say('● Recording: speak and gesture. STOP when done.'); };
    rec.start(250);
  }
  stop() { if (this.state === 'rec' && this.rec && this.rec.state !== 'inactive') this.rec.stop(); }
  play() {
    if (!this.blob) return;
    this.stopPlay();
    const a = this.audio = new Audio(URL.createObjectURL(this.blob));
    a.onended = () => { this.state = 'review'; this.say('PLAY again, REC to retake, or DONE.'); };
    a.play().then(() => { this.state = 'play'; this.say('▶ Playing back the take on the mirror'); }).catch(e => this.say('Playback failed: ' + e.message));
  }
  stopPlay() { if (this.audio) { try { this.audio.pause(); URL.revokeObjectURL(this.audio.src); } catch {} this.audio = null; } }
  stopAll() { this.stop(); this.stopPlay(); }
  // the finished take: audio blob and the motion JSON (null until a take is recorded)
  result() {
    if (!this.blob) return null;
    return { blob: this.blob, ext: 'webm', duration: this.duration,
      motion: { v: 1, rate: FPS, eye: R3(this.calib.eye), joints: HANDS_J, duration: R3(this.duration), frames: this.frames } };
  }

  // ---------------------------------------------------------------- every frame
  tick() {
    if (!this.av || this.state === 'closed' || this.state === 'loading') return;
    const live = xrPose(this.renderer, this.getInputs ? this.getInputs() : null);
    const now = performance.now();
    if (this.state === 'calib') {
      const C = this.cal, fw = new THREE.Vector3(0, 0, -1).applyQuaternion(live.head.q); fw.y = 0;
      C.p.add(live.head.p); if (fw.lengthSq() > 1e-4) C.f.add(fw.normalize()); C.n++;
      if (now - C.t0 > 1000 && C.n > 5) {
        const p = C.p.multiplyScalar(1 / C.n), f = C.f.lengthSq() > 1e-6 ? C.f.normalize() : new THREE.Vector3(0, 0, -1), floor = this.floorY();
        this.calib = { o: new THREE.Vector3(p.x, floor, p.z), yaw: Math.atan2(f.x, f.z), fwd: f.clone(), eye: p.y - floor };
        this.plane = { c: p.clone().addScaledVector(f, MIRROR_DIST).setY(floor), n: f.clone() };
        this.state = 'idle'; this.say(`Calibrated: eye height ${(this.calib.eye * 100).toFixed(0)} cm. REC to record.`);
      }
    }
    if (this.state === 'rec' && now - this.t0 >= (this.lastF + 1) * (1000 / FPS)) {
      this.lastF = Math.floor((now - this.t0) / (1000 / FPS));
      this.frames.push(this.toTake(live, (now - this.t0) / 1000));
    }
    // the mirror: live, or the recording while it plays back
    let pose = live;
    if (this.state === 'play' && this.audio && this.calib) pose = this.fromTake(sampleMotion({ frames: this.frames, joints: HANDS_J }, this.audio.currentTime));
    const plane = this.plane || this.loosePlane(live);
    this.av.update(reflectPose(pose, plane, this.floorY()));
  }
  floorY() { return this.rig.getWorldPosition(new THREE.Vector3()).y; }
  loosePlane(live) {   // before calibrating: a mirror 1.3 m ahead of wherever you look
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(live.head.q); f.y = 0; if (f.lengthSq() < 1e-6) f.set(0, 0, -1); f.normalize();
    return { c: live.head.p.clone().addScaledVector(f, MIRROR_DIST).setY(this.floorY()), n: f };
  }
  // world pose -> take frame (origin on the floor under the calibrated head, calibrated facing = +z)
  toTake(pose, t) {
    const C = this.calib, qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -C.yaw);
    const P = v => v.clone().sub(C.o).applyQuaternion(qy), V = v => v.clone().applyQuaternion(qy);
    const hq = qy.clone().multiply(pose.head.q), hp = P(pose.head.p);
    const f = { t: R3(t), h: [hp.x, hp.y, hp.z, hq.x, hq.y, hq.z, hq.w].map(R3) };
    ['l', 'r'].forEach((k, i) => {
      const h = pose.hands[i]; if (!h) return;
      const o = { p: P(h.p).toArray().map(R3), f: V(h.f).toArray().map(R3), s: V(h.s).toArray().map(R3) };
      if (h.joints) o.j = HANDS_J.flatMap(n => { const j = h.joints.get(n); return j ? P(j).toArray().map(R3) : [null, null, null]; });
      f[k] = o;
    });
    return f;
  }
  fromTake(tp) {   // take frame -> world (for the review on the mirror)
    const C = this.calib, qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), C.yaw);
    const P = v => v.clone().applyQuaternion(qy).add(C.o), V = v => v.clone().applyQuaternion(qy);
    return { head: { p: P(tp.head.p), q: qy.clone().multiply(tp.head.q) },
      hands: tp.hands.map(h => h && { p: P(h.p), f: V(h.f), s: V(h.s), joints: h.joints && new Map([...h.joints].map(([n, v]) => [n, P(v)])) }) };
  }
}

// ---------------------------------------------------------------- shared with the lesson player
// motion { frames: [{ t, h, l, r }], joints } at time t -> { head: { p, q }, hands: [l, r] } in the take frame
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
export function sampleMotion(M, t) {
  const F = M.frames; if (!F || !F.length) return null;
  let lo = 0, hi = F.length - 1;
  if (t <= F[0].t) hi = 0; else if (t >= F[hi].t) lo = hi;
  else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (F[m].t <= t) lo = m; else hi = m; }
  const a = F[lo], b = F[hi], k = hi === lo ? 0 : (t - a.t) / Math.max(1e-6, b.t - a.t);
  const L3 = (x, y) => new THREE.Vector3(x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k);
  const head = { p: L3(a.h, b.h), q: _qa.set(a.h[3], a.h[4], a.h[5], a.h[6]).clone().slerp(_qb.set(b.h[3], b.h[4], b.h[5], b.h[6]), k) };
  const hand = (x, y) => {
    if (!x) return null; if (!y) y = x;
    const o = { p: L3(x.p, y.p), f: L3(x.f, y.f), s: L3(x.s, y.s) };
    if (x.j && y.j) {
      o.joints = new Map(); const names = M.joints || HANDS_J;
      names.forEach((n, i) => { const u = x.j.slice(i * 3, i * 3 + 3), v = y.j.slice(i * 3, i * 3 + 3); if (u[0] != null && v[0] != null) o.joints.set(n, L3(u, v)); });
    }
    return o;
  };
  return { head, hands: [hand(a.l, b.l), hand(a.r, b.r)] };
}
// a pose seen in a mirror (plane through c, normal n): positions and directions reflected, left and right swapped
function reflectPose(pose, plane, floorY) {
  const n = plane.n, c = plane.c;
  const RP = p => p.clone().addScaledVector(n, -2 * p.clone().sub(c).dot(n)), RV = v => v.clone().addScaledVector(n, -2 * v.dot(n));
  const fw = RV(new THREE.Vector3(0, 0, -1).applyQuaternion(pose.head.q)), up = RV(new THREE.Vector3(0, 1, 0).applyQuaternion(pose.head.q));
  const z = fw.clone().negate(), x = new THREE.Vector3().crossVectors(up, z).normalize(), y = new THREE.Vector3().crossVectors(z, x);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  const hand = h => h && { p: RP(h.p), f: RV(h.f), s: RV(h.s), joints: h.joints && new Map([...h.joints].map(([k, v]) => [k, RP(v)])), curl: h.curl, curlIndex: h.curlIndex };
  return { head: { p: RP(pose.head.p), q }, hands: [hand(pose.hands[1]), hand(pose.hands[0])], floorY, dt: 1 / 60 };
}
