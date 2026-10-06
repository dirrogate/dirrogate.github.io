// SpatialED #24 TAKE (narrator-plan.md): record the professor's voice (the mixer's MIC, after its pitch and voice
// settings) together with his head and hands, against one clock, for stamping as a narrator record.
//  - A virtual mirror: Dirro stands ~1.3 m in front of you and moves as your reflection (live while you wait and
//    record, from the recording while you review). Optional wireframe skeleton.
//  - CALIBRATE: one second standing naturally; fixes the take's floor origin (under your head), your facing (becomes
//    +z, the narrator's front) and your eye height.
//  - Motion is stored in that take frame, ~30 frames a second: head (position, turn), each hand (wrist, fingers
//    direction, index -> pinky direction, the 21 hand-tracking joints when hands are tracked).
//  - Audio (#41): raw samples from the graph (rec-worklet.js): the voice, and the mix as heard; MP3 at STAMP (main.js).
import * as THREE from 'three';
import { Avatar, xrPose, HANDS_J } from './director.js';

const ROOT = 'SpatialVinyl', V1_ROOT = 'Spatial Records', OLD_ROOT = 'sed-takes', MIRROR_DIST = 1.3, FPS = 30, MODEL = 'models/avatar/DirrogateAvatar_face.glb';
const R3 = v => Math.round(v * 1000) / 1000;

// #41 Spatial Vinyl on this headset (and the same on the PC, web\SpatialVinyl): one folder per lesson (the series),
//   SpatialVinyl/<series>/<name>.mp3        the record: mix or voice, with ID3 title and pictures (front 3, back 4,
//                                            label = Media 6), so MP3Tag can edit it and any player can play it
//   SpatialVinyl/<series>/<name>.voice.mp3  the voice alone when the record is a mix (Rhubarb's input)
//   SpatialVinyl/<series>/<name>.sv.json    { v: 2, kind: 'spatial-record', name, series, made, duration, audio, voice,
//                                            source, vinyl (the narrator side, GLB paths relative to the lesson
//                                            folder), motion, lips, transcript, pc }
// Read-only fallbacks: #29 "Spatial Records" (flat, .webm + .sv.json + .jpg pictures), #24 "sed-takes".
export const seriesOf = f => f.replace(/\..*$/, '').replace(/_\d+$/, '');
async function root(name, create = true) { return (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create }); }
async function folder(file, create = true) { return (await root(ROOT, create)).getDirectoryHandle(seriesOf(file), { create }); }
export async function saveTakeFile(name, data) {
  const fh = await (await folder(name)).getFileHandle(name, { create: true }), w = await fh.createWritable();
  await w.write(data); await w.close();
}
export async function readTakeFile(name) {
  try { return await (await (await folder(name, false)).getFileHandle(name)).getFile(); } catch {}
  for (const r of [V1_ROOT, OLD_ROOT]) try { return await (await (await root(r, false)).getFileHandle(name)).getFile(); } catch {}
  throw new Error(name + ' is not on this headset');
}
export async function removeTakeFile(name) { try { await (await folder(name, false)).removeEntry(name); } catch {} }
export async function hasTakeFile(name) { try { await (await folder(name, false)).getFileHandle(name); return true; } catch { return false; } }
export async function hasOldFile(name) { for (const r of [V1_ROOT, OLD_ROOT]) try { await (await root(r, false)).getFileHandle(name); return true; } catch {} return false; }
export const PIC_SLOTS = ['front', 'back', 'label'];
export async function svRead(name) {   // v2 only (SpatialVinyl); the caller migrates older ones
  try { return JSON.parse(await (await (await (await folder(name, false)).getFileHandle(name + '.sv.json')).getFile()).text()); } catch { return null; }
}
export async function svReadOld(name) { try { return JSON.parse(await (await (await (await root(V1_ROOT, false)).getFileHandle(name + '.sv.json')).getFile()).text()); } catch { return null; } }
export async function svWrite(name, sv) { await saveTakeFile(name + '.sv.json', JSON.stringify(sv)); }
export async function svList() {
  const out = [];
  try { for await (const [d, h] of (await root(ROOT)).entries()) if (h.kind === 'directory') for await (const [n] of h.entries()) if (/\.sv\.json$/.test(n)) out.push(n.replace(/\.sv\.json$/, '')); } catch {}
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
export const lessonGlb = g => g && /^\.\.\//.test(g) && !/^\.\.\/\.\.\//.test(g) ? '../' + g : g;   // narrator/-relative -> SpatialVinyl/<series>/-relative
export const svVinyl = series => ({ version: 1, title: 'Dirro: ' + series, persist: true, board: false, credits: '',
  stage: { position: [0, 0, -2.0], rotationY: 0, scale: 1, plinth: 0.6 },
  actors: [{ glb: '../../models/avatar/DirrogateAvatar_face.glb', face: true, pose: 'relaxed', puppet: true }] });   // glb relative to the lesson folder

// ---------------------------------------------------------------- WAV, MP3, ID3 (#41)
export function wavBlob(pcm, ch, rate) {
  const h = new DataView(new ArrayBuffer(44)), n = pcm.length * 2, w = (o, s) => { for (let i = 0; i < 4; i++) h.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); h.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, ch, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * ch * 2, true); h.setUint16(32, ch * 2, true); h.setUint16(34, 16, true); w(36, 'data'); h.setUint32(40, n, true);
  return new Blob([h.buffer, pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + n)], { type: 'audio/wav' });
}
let mp3w = null, mp3id = 0; const mp3wait = new Map();
export function encodeMp3(pcm, ch, rate, kbps) {
  if (!mp3w) { mp3w = new Worker(new URL('./mp3-worker.js', import.meta.url)); mp3w.onmessage = e => { const r = mp3wait.get(e.data.id); mp3wait.delete(e.data.id); if (r) e.data.error ? r[1](new Error(e.data.error)) : r[0](e.data.mp3); }; }
  return new Promise((res, rej) => { const id = ++mp3id; mp3wait.set(id, [res, rej]); const c = pcm.slice(); mp3w.postMessage({ id, pcm: c, ch, rate, kbps }, [c.buffer]); });
}
// an ID3v2.3 tag: title, artist, album, and pictures (front = Cover (front) 3, back = Cover (back) 4, label = Media 6)
export async function id3Tag({ title = '', artist = '', album = '', front = null, back = null, label = null }) {
  const enc = new TextEncoder(), frames = [];
  const frame = (id, body) => { const h = new Uint8Array(10); h.set(enc.encode(id)); const n = body.length; h[4] = n >>> 24; h[5] = (n >>> 16) & 255; h[6] = (n >>> 8) & 255; h[7] = n & 255; frames.push(h, body); };
  const text = s => { const u = new Uint8Array(1 + 2 + s.length * 2); u[0] = 1; u[1] = 0xFF; u[2] = 0xFE; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); u[3 + 2 * i] = c & 255; u[4 + 2 * i] = c >> 8; } return u; };   // UTF-16 with BOM
  if (title) frame('TIT2', text(title)); if (artist) frame('TPE1', text(artist)); if (album) frame('TALB', text(album));
  for (const [blob, type, desc] of [[front, 3, 'Cover (front)'], [back, 4, 'Cover (back)'], [label, 6, 'Label A']]) {
    if (!blob) continue;
    const img = new Uint8Array(await blob.arrayBuffer()), mime = enc.encode(blob.type || 'image/jpeg'), d = enc.encode(desc);
    const body = new Uint8Array(1 + mime.length + 1 + 1 + d.length + 1 + img.length); let o = 0;
    body[o++] = 0; body.set(mime, o); o += mime.length; body[o++] = 0; body[o++] = type; body.set(d, o); o += d.length; body[o++] = 0; body.set(img, o);
    frame('APIC', body);
  }
  let size = 0; for (const f of frames) size += f.length;
  const tag = new Uint8Array(10 + size); tag.set(enc.encode('ID3')); tag[3] = 3; tag[4] = 0; tag[5] = 0;
  tag[6] = (size >>> 21) & 127; tag[7] = (size >>> 14) & 127; tag[8] = (size >>> 7) & 127; tag[9] = size & 127;
  let o = 10; for (const f of frames) { tag.set(f, o); o += f.length; }
  return tag;
}
export function stripId3(u8) {   // the audio after any leading ID3v2 tag(s)
  let o = 0;
  while (u8.length - o > 10 && u8[o] === 0x49 && u8[o + 1] === 0x44 && u8[o + 2] === 0x33) {
    const sz = (u8[o + 6] << 21) | (u8[o + 7] << 14) | (u8[o + 8] << 7) | u8[o + 9]; o += 10 + sz + ((u8[o + 5] & 0x10) ? 10 : 0);
  }
  return u8.subarray(o);
}
export async function retag(mp3Blob, tags) { const a = stripId3(new Uint8Array(await mp3Blob.arrayBuffer())); return new Blob([await id3Tag(tags), a], { type: 'audio/mpeg' }); }

export class TakeStudio {
  constructor({ renderer, scene, rig, engine, getInputs, toast, ensureMic, onChange }) {
    Object.assign(this, { renderer, scene, rig, engine, getInputs, toast, ensureMic, onChange });
    this.state = 'closed'; this.msg = ''; this.skeleton = false; this.frames = []; this.pcm = null; this.duration = 0; this.calib = null; this.source = 'voice';
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
  // #41 REC: raw samples from the graph (rec-worklet.js): the voice (mixer MIC after pitch / effects) and the mix as
  // heard (master after the limiter). source 'voice' or 'mix' chooses which becomes the record; the voice is always
  // kept for the lips. Head and hands are stamped on the same AudioContext clock as the first recorded sample.
  async record() {
    if (!this.calib) { this.say('CALIBRATE first.'); return; }
    if (this.state === 'rec') return;
    try { await this.ensureMic(); } catch (e) { this.say('No microphone: ' + e.message); return; }
    const E = this.engine, m = E.mic, ctx = E.ctx; if (!m) { this.say('The MIC is not open (Settings: Mic route "Through the mixer").'); return; }
    if (!this.node) {
      await ctx.audioWorklet.addModule(new URL('./rec-worklet.js', import.meta.url));
      this.node = new AudioWorkletNode(ctx, 'sed-rec', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1] });
      this.sink = ctx.createGain(); this.sink.gain.value = 0; this.node.connect(this.sink).connect(ctx.destination);   // pulled by the graph, silent
      this.node.port.onmessage = e => this.onRec(e.data);
    }
    try { m.on.connect(this.node, 0, 0); } catch {}
    try { E.limiter.connect(this.node, 0, 1); } catch {}
    this.vParts = []; this.mParts = []; this.frames = []; this.pcm = null; this.t0 = null; this.lastF = -1; this.rate = ctx.sampleRate;
    this.state = 'rec'; this.say('● Recording' + (this.source === 'mix' ? ' the mix (music + voice)' : ' your voice') + ': speak and gesture. STOP when done.');
    this.node.port.postMessage('start');
  }
  onRec(d) {
    if (d.t0 != null) this.t0 = d.t0;
    if (d.v) { this.vParts.push(d.v); this.mParts.push(d.m); }
    if (d.done) {
      const cat = parts => { let n = 0; for (const p of parts) n += p.length; const o = new Int16Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
      const voice = cat(this.vParts), mix = cat(this.mParts); this.vParts = this.mParts = [];
      try { this.engine.mic && this.engine.mic.on.disconnect(this.node); } catch {}
      try { this.engine.limiter.disconnect(this.node); } catch {}
      this.pcm = { rate: this.rate, voice, mix: this.source === 'mix' ? mix : null };
      this.duration = voice.length / this.rate;
      this.state = 'review'; this.say(`Take: ${this.duration.toFixed(1)} s${this.source === 'mix' ? ' (mix)' : ''}. PLAY to check, REC again to retake, or DONE.`);
    }
  }
  stop() { if (this.state === 'rec' && this.node) this.node.port.postMessage('stop'); }
  audioNow() { return this.state === 'rec' && this.t0 != null ? this.engine.ctx.currentTime - this.t0 : null; }
  play() {
    if (!this.pcm) return;
    this.stopPlay();
    const P = this.pcm, b = P.mix ? wavBlob(P.mix, 2, P.rate) : wavBlob(P.voice, 1, P.rate);
    const a = this.audio = new Audio(URL.createObjectURL(b));
    a.onended = () => { this.state = 'review'; this.say('PLAY again, REC to retake, or DONE.'); };
    a.play().then(() => { this.state = 'play'; this.say('▶ Playing back the take on the mirror'); }).catch(e => this.say('Playback failed: ' + e.message));
  }
  stopPlay() { if (this.audio) { try { this.audio.pause(); URL.revokeObjectURL(this.audio.src); } catch {} this.audio = null; } }
  stopAll() { this.stop(); this.stopPlay(); }
  // the finished take: the PCM (voice, and the mix when recorded) and the motion (null until a take is recorded)
  result() {
    if (!this.pcm) return null;
    return { pcm: this.pcm, source: this.pcm.mix ? 'mix' : 'voice', duration: this.duration,
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
    const ta = this.audioNow();   // #41 seconds since the first recorded sample (audio clock)
    if (ta != null && ta >= (this.lastF + 1) / FPS) { this.lastF = Math.floor(ta * FPS); this.frames.push(this.toTake(live, ta)); }
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
