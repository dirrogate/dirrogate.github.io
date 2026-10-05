// SpatialED Phase 1 (CLAUDE.md #7): the Spatial Vinyl lesson player. A record side can carry a lesson, a
// `side.json` next to its audio (named on the track as `lesson`, see main.js EXAMPLES). Every object in the lesson
// is a pure function of the deck's playhead t (seconds of the audio): no physics and no state that builds up while
// playing. So pause is t standing still, scratching backwards plays the scene backwards, a needle drop jumps it,
// and later every student device that receives t draws the same frame.
//
// side.json (version 1, times in seconds of the audio, positions in metres):
//   title                       shown on the chapter board before the first chapter
//   stage    { position [x,y,z] in rig space (the gear's space; the DJ stands at +z), rotationY (deg), scale,
//              plinth (radius m, 0 = none) }
//   chapters [{ t, title }]      chapter starts (the 2 to 3 s silences the grooves show as dark bands)
//   actors   [{ glb (relative to side.json), clip (name, default the first), t0 (audio time of clip time 0),
//              loop (false = hold the first / last pose outside the clip), position, rotationY, scale }]
//   trajectories [{ points [[x,y,z]...] (stage space), t0, t1 (drawn from 0 to 100 % over [t0, t1]),
//              width (m), color }]
//
// SpatialED #8 placement: a lesson starts as a diorama on its deck, floating DECK_LIFT above the record and turning
// with it. Grip inside its volume (an invisible cylinder round the plinth, outlined while a hand is in it) to carry
// it; a second grip stretches it (hands apart = bigger, the line between the hands turns it, never tilts it); with
// one hand the thumbstick scales (up / down) and turns (left / right). Let go near 1:1 and it snaps to life size on
// the floor; let go small over a deck and it settles back onto that record. A new record always starts on its deck.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';

const DEG = Math.PI / 180;
const loader = new GLTFLoader();
const DECK_R = 0.13, DECK_LIFT = 0.07;          // on the record: 13 cm radius (a 12" record is 15 cm), 7 cm above it
const MIN_S = 0.02, MAX_S = 1.5, SNAP1 = 0.2;   // scale limits; within 20 % of 1:1 = life size
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const yawOfQ = q => { _e.setFromQuaternion(q, 'YXZ'); return _e.y; };

export class LessonPlayer {
  constructor(parent) {
    this.root = new THREE.Group(); this.root.name = 'lesson'; this.root.visible = false; parent.add(this.root);
    this.sides = new Map();   // url -> { status: 'loading' | 'ready' | 'failed', L, error }
    this.cur = null;          // the side drawn now
    this.onStatus = null;     // (text) => void, for a toast when a side loads or fails
    this.place = null;        // { deck: i } = diorama on that deck's record; { free: true } = put somewhere by hand
    this.pose = { pos: new THREE.Vector3(), yaw: 0, scale: 1 };   // the stage group's transform in rig space
    this.seats = [];          // per deck: the record's Object3D (or null), from step()
    this.lastRec = null;      // the record (object) the lesson came in on: a new one starts on its deck again
    this.hand = [null, null]; // hand points (world) for the outline
    this.grab = null;         // { one: {...} } or { two: {...} }
    this.cage = makeCage();   // the volume's outline, shown while a hand is inside it or holding it
    this.root.add(this.cage);
  }

  // decks: [{ track, pos, rate, gain }] for both decks. The deck playing a lesson drives it; with a lesson on both
  // decks, the louder channel wins (faders and crossfader), like the LED wall's DECKS mode.
  step(decks) {
    let best = null, bi = -1;
    this.seats = decks.map(d => d.seat || null);
    decks.forEach((d, i) => { if (d.track && d.track.lesson && (!best || d.gain > best.gain)) { best = d; bi = i; } });
    const url = best ? new URL(best.track.lesson, location.href).href : null;
    const s = url ? this.want(url) : null;
    const L = s && s.status === 'ready' ? s.L : null;
    if (L !== this.cur) {
      if (this.cur) this.root.remove(this.cur.group);
      this.cur = L; if (L) { this.root.add(L.group); L.chapter = -2; }
      this.root.visible = !!L;
    }
    if (!L) { this.lastRec = null; this.grab = null; this.cage.visible = false; return null; }
    if (best.rec !== this.lastRec) { this.lastRec = best.rec; this.place = { deck: bi }; this.grab = null; }   // a record just went on
    if (this.place.deck != null && !this.seats[this.place.deck]) this.place = { deck: bi };   // its record moved decks
    if (this.place.deck != null) this.seatPose(L, this.place.deck);
    const g = L.group; g.position.copy(this.pose.pos); g.rotation.set(0, this.pose.yaw, 0); g.scale.setScalar(this.pose.scale);
    this.apply(L, best.pos);
    this.drawCage(L);
    return L;
  }
  isFree() { return !!(this.cur && this.place && this.place.free); }

  // ---------------------------------------------------------------- placement
  // the diorama on a deck: centred on the record, DECK_LIFT above it, turning with it
  seatPose(L, i) {
    const seat = this.seats[i]; if (!seat) return;
    this.root.updateWorldMatrix(true, false); seat.updateWorldMatrix(true, false);
    this.pose.pos.copy(this.root.worldToLocal(seat.getWorldPosition(_v)));
    this.pose.pos.y += DECK_LIFT / this.rootScale();
    this.root.getWorldQuaternion(_q2).invert();
    this.pose.yaw = yawOfQ(_q.multiplyQuaternions(_q2, seat.getWorldQuaternion(_q)));
    this.pose.scale = DECK_R / L.radius;
  }
  rootScale() { return this.root.getWorldScale(_v2).x || 1; }
  local(P, out = new THREE.Vector3()) { this.root.updateWorldMatrix(true, false); return this.root.worldToLocal(out.copy(P)); }

  // Is the world point P inside the volume? null, or 'small' (diorama size: take the grip before the gear does) /
  // 'big' (room size: only grips nothing else wanted)
  hitTest(P) {
    const L = this.cur; if (!L) return null;
    L.group.updateWorldMatrix(true, false);
    const l = L.group.worldToLocal(_v.copy(P)), m = 0.03 / (this.pose.scale * this.rootScale());   // 3 cm of grace
    if (Math.hypot(l.x, l.z) > L.radius + m || l.y < -m || l.y > L.height + m) return null;
    return this.pose.scale < 0.5 ? 'small' : 'big';
  }
  hover(i, P) { this.hand[i] = P ? P.clone() : null; }

  grab1(P) {   // one hand: carry it (a diorama on a deck comes off the deck)
    this.place = { free: true };
    this.grab = { one: { off: this.pose.pos.clone().sub(this.local(P)) } };
  }
  move1(P) { const o = this.grab && this.grab.one; if (o) this.pose.pos.copy(this.local(P)).add(o.off); }
  // thumbstick while one hand holds it: up / down = bigger / smaller, left / right = turn, about the hand
  stick(P, ax, ay, dt) {
    const o = this.grab && this.grab.one; if (!o) return;
    const h = this.local(P), p = this.pose;
    if (Math.abs(ay) > 0.2) {
      const s = Math.min(MAX_S, Math.max(MIN_S, p.scale * Math.exp(-ay * dt * 1.4))), f = s / p.scale;
      p.pos.sub(h).multiplyScalar(f).add(h); p.scale = s;
    }
    if (Math.abs(ax) > 0.2) {
      const a = -ax * dt * 1.2; _v.subVectors(p.pos, h).applyAxisAngle(_v2.set(0, 1, 0), a); p.pos.copy(h).add(_v); p.yaw += a;
    }
    o.off.subVectors(p.pos, h);
  }
  grab2(Pa, Pb) {   // second hand: from now on the two hands hold it
    this.place = { free: true };
    const a = this.local(Pa), b = this.local(Pb), p = this.pose, mid = a.clone().add(b).multiplyScalar(0.5);
    const mloc = mid.sub(p.pos).applyAxisAngle(_v.set(0, 1, 0), -p.yaw).divideScalar(p.scale);
    this.grab = { two: { d0: Math.max(0.02, a.distanceTo(b)), ang0: Math.atan2(-(b.z - a.z), b.x - a.x), s0: p.scale, yaw0: p.yaw, mloc } };
  }
  move2(Pa, Pb) {
    const t = this.grab && this.grab.two; if (!t) return;
    const a = this.local(Pa), b = this.local(Pb), p = this.pose;
    p.scale = Math.min(MAX_S, Math.max(MIN_S, t.s0 * a.distanceTo(b) / t.d0));
    p.yaw = t.yaw0 + (Math.atan2(-(b.z - a.z), b.x - a.x) - t.ang0);
    const mid = a.add(b).multiplyScalar(0.5);
    p.pos.copy(mid).sub(_v.copy(t.mloc).multiplyScalar(p.scale).applyAxisAngle(_v2.set(0, 1, 0), p.yaw));
  }
  // let go. Returns what happened, for a buzz / toast: 'life' (snapped to 1:1 on the floor), 'deck' (back on a
  // record) or null
  release() {
    this.grab = null; const L = this.cur, p = this.pose; if (!L || !this.place || !this.place.free) return null;
    if (Math.abs(p.scale - 1) < SNAP1) { p.scale = 1; p.pos.y = 0; return 'life'; }
    if (p.scale < 0.35) {   // small and over a record: back on that deck
      for (let i = 0; i < this.seats.length; i++) {
        const s = this.seats[i]; if (!s) continue;
        const sp = this.local(s.getWorldPosition(_v));
        if (Math.hypot(p.pos.x - sp.x, p.pos.z - sp.z) < 0.2 && p.pos.y - sp.y > -0.05 && p.pos.y - sp.y < 0.45) { this.place = { deck: i }; return 'deck'; }
      }
    }
    return null;
  }
  // desktop keys: bigger / smaller about its centre, and deck <-> life size at the default spot
  nudgeScale(f) {
    const L = this.cur; if (!L) return; this.place = { free: true }; const p = this.pose;
    p.scale = Math.min(MAX_S, Math.max(MIN_S, p.scale * f));
  }
  toggleDeckRoom() {
    const L = this.cur; if (!L) return null;
    if (this.place && this.place.free) { const i = this.seats.findIndex(Boolean); if (i >= 0) { this.place = { deck: i }; return 'deck'; } return null; }
    this.place = { free: true }; this.pose.pos.copy(L.home.pos); this.pose.yaw = L.home.yaw; this.pose.scale = L.home.scale; return 'life';
  }

  // the outline: shown while a hand is inside the volume or holding it; green when a let-go would make it life size
  drawCage(L) {
    const c = this.cage, p = this.pose;
    const near = !!this.grab || this.hand.some(h => h && this.hitTest(h));
    c.visible = near; if (!near) return;
    c.position.copy(p.pos); c.rotation.set(0, p.yaw, 0);
    c.scale.set(L.radius * p.scale, L.height * p.scale, L.radius * p.scale);
    c.material.color.setHex(this.grab && Math.abs(p.scale - 1) < SNAP1 ? 0x5dff8a : 0x39d0ff);
  }

  want(url) {
    let s = this.sides.get(url);
    if (!s) {
      s = { status: 'loading' }; this.sides.set(url, s);
      load(url).then(L => { s.status = 'ready'; s.L = L; this.say(`Lesson ready: ${L.title}`); })
        .catch(e => { s.status = 'failed'; s.error = e; console.warn('lesson', url, e); this.say(`Lesson not loaded: ${e.message}`); });
    }
    return s;
  }
  say(t) { if (this.onStatus) try { this.onStatus(t); } catch {} }

  // t -> the whole scene. Called every frame; cheap (one mixer evaluation per actor, one draw-range per trajectory).
  apply(L, t) {
    for (const a of L.actors) {
      let ct = t - a.t0;
      if (a.loop) ct = ((ct % a.dur) + a.dur) % a.dur;
      else ct = Math.min(Math.max(ct, 0), a.dur - 1e-4);
      a.action.time = ct; a.action.paused = false; a.mixer.update(0);
    }
    for (const tr of L.trajs) {
      const r = Math.min(1, Math.max(0, (t - tr.t0) / Math.max(1e-3, tr.t1 - tr.t0)));
      tr.mesh.geometry.setDrawRange(0, Math.floor(r * tr.quads) * 6);
      tr.mesh.visible = r > 0;
    }
    let c = -1; for (let i = 0; i < L.chapters.length; i++) if (L.chapters[i].t <= t + 0.05) c = i;
    if (c !== L.chapter) { L.chapter = c; drawBoard(L, c); }
  }

  // for later phases and the tablet: chapter starts of the side now drawn
  chapters() { return this.cur ? this.cur.chapters.slice() : []; }
}

async function load(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url.split('/').pop()}: HTTP ${r.status}`);
  const side = await r.json();
  const base = new URL(url, location.href);
  const st = side.stage || {};
  const group = new THREE.Group(); group.name = 'lesson:' + (side.title || '');
  const home = { pos: new THREE.Vector3().fromArray(st.position || [0, 0, -2.4]), yaw: (st.rotationY || 0) * DEG, scale: st.scale || 1 };   // life size spot (desktop L key)

  const plinthR = st.plinth == null ? 1.7 : st.plinth;
  if (plinthR > 0) {   // a dark floor disc so the lesson reads as a place, with a faint rim
    const disc = new THREE.Mesh(new THREE.CircleGeometry(plinthR, 64), new THREE.MeshStandardMaterial({ color: 0x151b26, roughness: 0.9 }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.002; group.add(disc);
    const rim = new THREE.Mesh(new THREE.RingGeometry(plinthR - 0.02, plinthR, 96), new THREE.MeshBasicMaterial({ color: 0x2a6f8a }));
    rim.rotation.x = -Math.PI / 2; rim.position.y = 0.004; group.add(rim);
  }

  const actors = [];
  for (const a of side.actors || []) {
    const gltf = await loader.loadAsync(new URL(a.glb, base).href);
    const obj = gltf.scene;
    obj.position.fromArray(a.position || [0, 0, 0]); obj.rotation.y = (a.rotationY || 0) * DEG; obj.scale.setScalar(a.scale || 1);
    group.add(obj);
    const clip = (a.clip && gltf.animations.find(k => k.name === a.clip)) || gltf.animations[0];
    if (!clip) { actors.push(null); continue; }   // a still prop: placed, nothing to drive
    const mixer = new THREE.AnimationMixer(obj), action = mixer.clipAction(clip);
    action.setLoop(a.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); action.clampWhenFinished = true; action.play();
    actors.push({ mixer, action, dur: clip.duration || 1e-3, t0: a.t0 || 0, loop: !!a.loop });
  }

  const trajs = (side.trajectories || []).map(tr => makeTrail(tr)).filter(Boolean);
  for (const tr of trajs) group.add(tr.mesh);

  const chapters = (side.chapters || []).map(c => ({ t: +c.t || 0, title: String(c.title || '') })).sort((p, q) => p.t - q.t);
  const board = makeBoard(); board.position.set(0, 2.45, -0.2); group.add(board);
  const L = { url, title: side.title || 'Lesson', group, actors: actors.filter(Boolean), trajs, chapters, board, chapter: -2,
    home, radius: plinthR > 0 ? plinthR : 1.7, height: 2.7 };
  drawBoard(L, -1);
  return L;
}

// unit cylinder outline (radius 1, height 1): two rings and four posts, scaled to the volume
function makeCage() {
  const pts = [], N = 48;
  for (const y of [0, 1]) for (let k = 0; k < N; k++) {
    const a = k / N * Math.PI * 2, b = (k + 1) / N * Math.PI * 2;
    pts.push(Math.cos(a), y, Math.sin(a), Math.cos(b), y, Math.sin(b));
  }
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; pts.push(Math.cos(a), 0, Math.sin(a), Math.cos(a), 1, Math.sin(a)); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const m = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x39d0ff, transparent: true, opacity: 0.6, depthWrite: false }));
  m.visible = false; m.renderOrder = 4; m.raycast = () => {};
  return m;
}

// a flat ribbon on the floor along the polyline, resampled every 2 cm, revealed by draw range
function makeTrail(tr) {
  const pts = (tr.points || []).map(p => new THREE.Vector3().fromArray(p));
  if (pts.length < 2) return null;
  const step = 0.02, w = (tr.width || 0.05) / 2, samples = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let k = 1; k <= n; k++) samples.push(a.clone().lerp(b, k / n));
  }
  const pos = [], idx = [], up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), side = new THREE.Vector3();
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i], q = samples[Math.min(i + 1, samples.length - 1)], o = samples[Math.max(i - 1, 0)];
    dir.subVectors(q, o); if (dir.lengthSq() < 1e-10) dir.set(1, 0, 0);
    side.crossVectors(up, dir).normalize().multiplyScalar(w);
    pos.push(p.x + side.x, p.y, p.z + side.z, p.x - side.x, p.y, p.z - side.z);
    if (i) { const b = (i - 1) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.setDrawRange(0, 0);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(tr.color || '#39d0ff'), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 2; mesh.visible = false;
  return { mesh, quads: samples.length - 1, t0: +tr.t0 || 0, t1: +tr.t1 || 0 };
}

// the chapter board: a small floating sign above the stage
function makeBoard() {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 192;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.userData.cv = cv; m.userData.tex = tex; m.renderOrder = 3;
  return m;
}
function drawBoard(L, c) {
  const cv = L.board.userData.cv, g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(11,13,18,0.78)'; roundRect(g, 4, 4, W - 8, H - 8, 28); g.fill();
  g.strokeStyle = '#2a6f8a'; g.lineWidth = 4; g.stroke();
  const top = c < 0 ? 'LESSON' : `CHAPTER ${c + 1} OF ${L.chapters.length}`;
  const main = c < 0 ? L.title : (L.chapters[c].title || `Chapter ${c + 1}`);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#39d0ff'; g.font = 'bold 40px system-ui, sans-serif'; g.fillText(top, W / 2, 58);
  g.fillStyle = '#eef3f7'; g.font = 'bold 64px system-ui, sans-serif'; g.fillText(fit(g, main, W - 80), W / 2, 128);
  L.board.userData.tex.needsUpdate = true;
}
function fit(g, s, w) { let t = s; while (t.length > 3 && g.measureText(t).width > w) t = t.slice(0, -2); return t === s ? s : t.slice(0, -1) + '…'; }
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
