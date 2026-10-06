// SpatialED Phase 1 (CLAUDE.md #7): the Spatial Vinyl lesson player. A record side can carry a lesson, a
// `side.json` next to its audio (named on the track as `lesson`, see main.js EXAMPLES). Every object in the lesson
// is a pure function of the deck's playhead t (seconds of the audio): no physics and no state that builds up while
// playing. So pause is t standing still, scratching backwards plays the scene backwards, a needle drop jumps it,
// and later every student device that receives t draws the same frame.
//
// side.json (version 1, times in seconds of the audio, positions in metres):
//   title                       shown on the chapter board before the first chapter
//   persist                     (#20) true = stays when its record comes off (a narrator): frozen on its last frame,
//                               blinking; any record naming this side drives it again, keeping where it was put
//   board                       (#20) false = no chapter board
//   credits                     (optional) one line under the title on the board, e.g. model authors and licences
//   stage    { position [x,y,z] in rig space (the gear's space; the DJ stands at +z), rotationY (deg), scale,
//              plinth (radius m, 0 = none) }
//   chapters [{ t, title }]      chapter starts (the 2 to 3 s silences the grooves show as dark bands)
//   actors   [{ glb (relative to side.json), clip (name, default the first), t0 (audio time of clip time 0),
//              loop (false = hold the first / last pose outside the clip), position, rotationY, scale,
//              motion (SpatialED #9, optional): { glb, clip, t0, root, bones } borrows movement from another clip:
//                the `root` node's moves carry the actor round the stage, and each source pivot in `bones`
//                (name -> the actor's bone name, Mixamo prefix and _NN suffix ignored) adds its turn to that bone on
//                top of the actor's own clip (e.g. a looping idle). Lets a rigged character walk a route authored
//                on a simple figure.
//              fallback (optional): { glb, clip, t0, loop } used instead when glb can't be loaded (a model kept
//                only on the PC, not published),
//              face (#20): true = the face follows the driving record's lips (`lips` on its track: a Rhubarb
//                .lips.json, mouth cues against t) on the model's viseme_* morph targets, with ~70 ms crossfades
//                and blinks from t; without lips yet, the jaw follows the record's loudness,
//              pose (#20): 'relaxed' = arms down from a T-pose (Ready Player Me), plus breathing and small head
//                moves from t,
//              puppet (#25): true = an RPM rig driven by the driving record's TAKE motion (`motion` on its track:
//                .motion.json, head and hands against t) through director.js's Avatar (two-bone IK arms, fingers,
//                spine, planted feet); each frame starts from rest, so it scratches exactly. No motion = the idle }]
//   trajectories [{ points [[x,y,z]...] (stage space), t0, t1 (drawn from 0 to 100 % over [t0, t1]),
//              width (m), color }]
//
// SpatialED #8 placement: a lesson starts as a diorama on its deck, floating DECK_LIFT above the record (#12: facing
// the DJ, not turning with it). Grip inside its volume (an invisible cylinder round the plinth, outlined while a hand is in it) to carry
// it; a second grip stretches it (hands apart = bigger, the line between the hands turns it, never tilts it); with
// one hand the thumbstick scales (up / down) and turns (left / right). Let go near 1:1 and it snaps to life size on
// the floor; let go small over a deck and it settles back onto that record. A new record always starts on its deck.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';
import { Avatar } from './director.js';   // #25 puppet narrator
import { sampleMotion, readTakeFile } from './take.js';

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
    this.lips = new Map();    // #20 .lips.json url -> { status, cues }
    this.motions = new Map(); // #25 .motion.json url (or opfs-take:<name>) -> { status, M }
    this.suppress = null;     // #20 a persistent side the professor cleared
    this.lipGain = 0.75;      // #21 lip strength (tablet LIPS - / +): 1 = Rhubarb's full shapes
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
    let L = s && s.status === 'ready' ? s.L : null;
    // #20 a persistent side (a narrator) stays while no record drives it (or while the next one is still loading)
    if (!L && this.cur && this.cur.persist && this.suppress !== this.cur) L = this.cur;
    if (best && L && L === this.suppress && s && s.L === L) this.suppress = null;   // its record went on again
    if (L === this.suppress) L = null;
    this.show(L);
    if (!L) { this.live = null; this.lastRec = null; this.grab = null; this.cage.visible = false; return null; }
    const drv = best && s && s.L === L ? best : null;   // the record driving L now (null = frozen on its last frame)
    // #27 (owner) only the needle in the groove moves the lesson: turning the platter by hand with the needle up (or
    // the arm on its rest) leaves it where it was; a needle drop jumps to that spot
    if (drv) {
      const nd = drv.needle !== false, same = L.frame && L.frame.track === drv.track && drv.rec === this.lastRec;
      L.rel = drv.track.lesson;
      L.frame = { t: nd || !same ? drv.pos : L.frame.t, rate: nd ? drv.rate : 0, track: drv.track, env: drv.env, dur: drv.dur, needle: nd };
    }
    const F = L.frame || { t: 0, rate: 0 };
    this.live = { rel: L.rel, t: F.t, rate: drv ? F.rate : 0, lips: F.track && F.track.lips || null, motion: F.track && F.track.motion && !/^opfs/.test(F.track.motion) ? F.track.motion : null, needle: !!F.needle };   // #11 class packet
    if (drv && drv.rec !== this.lastRec) {   // a record just went on
      this.lastRec = drv.rec; this.grab = null;
      // #20 a persistent side keeps where it was put when the next record of its series goes on
      if (!L.persist || this.placedFor !== L) { this.place = { deck: bi }; this.placedFor = L; }
    }
    if (!drv) this.lastRec = null;
    if (!this.place) this.place = { free: true };
    if (this.place.deck != null && !this.seats[this.place.deck]) this.place = L.persist || bi < 0 ? { free: true } : { deck: bi };   // its record left that deck
    if (this.place.deck != null) this.seatPose(L, this.place.deck);
    const g = L.group; g.position.copy(this.pose.pos); g.rotation.set(0, this.pose.yaw, 0); g.scale.setScalar(this.pose.scale);
    this.apply(L, F.t, { lips: F.track && F.track.lips ? this.lipsFor(F.track.lips, F.track.url) : null, motion: F.track && F.track.motion ? this.motionFor(F.track.motion) : null, env: F.env, dur: F.dur, frozen: !drv || !F.needle, needle: !!F.needle, gain: this.lipGain });
    this.drawCage(L);
    return L;
  }
  // #20 the professor clears a persistent side (tablet); it comes back when one of its records goes on a deck again
  clear() { if (this.cur) { this.suppress = this.cur; this.show(null); this.live = null; this.cage.visible = false; } }

  // #20 lips for a record: its .lips.json; when there is none yet, ask the PC's server to make one (Rhubarb), and
  // look again every few seconds while it works. null meanwhile (the jaw follows the loudness).
  lipsFor(rel, audioRel) {
    const url = new URL(rel, location.href).href; let e = this.lips.get(url);
    if (!e) { e = { status: 'new', cues: null, next: 0, tries: 0 }; this.lips.set(url, e); }
    if (e.status === 'ready') return e.cues;
    if (e.status === 'busy' || e.status === 'failed' || performance.now() < e.next) return null;
    e.status = 'busy';
    (async () => {
      let r = await fetch(url, { cache: 'no-cache' }).catch(() => null);
      if ((!r || !r.ok) && audioRel) {   // not made yet: the server makes it (404 on a static host = no server)
        const src = decodeURI(new URL(audioRel, location.href).pathname.slice(new URL('.', location.href).pathname.length));
        r = await fetch('api/lips?src=' + encodeURIComponent(src), { cache: 'no-store' }).catch(() => null);
        if (r && r.status === 202) { e.status = 'wait'; e.next = performance.now() + 3000; if (++e.tries === 1) this.say('Making the lip sync (Rhubarb)…'); return; }
      }
      const j = r && r.ok && /json/.test(r.headers.get('content-type') || '') ? await r.json().catch(() => null) : null;
      if (j && j.cues) { e.cues = j.cues; e.status = 'ready'; if (e.tries) this.say('Lip sync ready'); }
      else { e.status = 'failed'; }
    })().catch(() => { e.status = 'failed'; });
    return null;
  }
  // #25 a take's motion: fetched once (or read from this device's sed-takes for a take the PC never got)
  motionFor(rel) {
    let e = this.motions.get(rel);
    if (!e) {
      e = { status: 'busy', M: null }; this.motions.set(rel, e);
      (async () => {
        const j = /^opfs-take:/.test(rel) ? JSON.parse(await (await readTakeFile(rel.slice(10) + '.motion.json')).text())
          : await fetch(new URL(rel, location.href).href, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null);
        if (j && j.frames && j.frames.length) { e.M = j; e.status = 'ready'; } else e.status = 'failed';
      })().catch(() => { e.status = 'failed'; });
    }
    return e.M;
  }
  isFree() { return !!(this.cur && this.place && this.place.free); }
  show(L) {
    if (L !== this.cur) {
      if (this.cur) this.root.remove(this.cur.group);
      this.cur = L; if (L) { this.root.add(L.group); L.chapter = -2; }
      this.root.visible = !!L;
    }
    return L;
  }

  // ---------------------------------------------------------------- SpatialED #11 classroom
  // professor: what the students need, about 15 times a second (u = the side.json as the record names it, relative to
  // the page, so a student page in the same folder finds it on any host)
  packet() {
    const v = this.live, L = this.cur; if (!v || !L) return { k: 'les', u: null };
    return { k: 'les', u: v.rel, t: +v.t.toFixed(3), r: +v.rate.toFixed(4), s: +this.pose.scale.toFixed(4), y: +this.pose.yaw.toFixed(4), d: this.place && this.place.deck != null ? 1 : 0, l: v.lips || undefined, mo: v.motion || undefined, nd: v.needle ? 1 : 0, h: +this.lipGain.toFixed(2) };
  }
  // student: draw the side the professor plays at t, at the professor's size and turn, centred on this root
  remote(rel, t, scale, yaw, lips, needle = true, gain = 1, motion = null) {
    const s = rel ? this.want(new URL(rel, location.href).href) : null;
    const L = this.show(s && s.status === 'ready' ? s.L : null); if (!L) return null;
    L.group.position.set(0, 0, 0); L.group.rotation.set(0, yaw || 0, 0); L.group.scale.setScalar(scale || 1);
    this.apply(L, t, { lips: lips ? this.lipsFor(lips, null) : null, motion: motion ? this.motionFor(motion) : null, needle, gain }); return L;
  }

  // ---------------------------------------------------------------- placement
  // the diorama on a deck: centred on the record, DECK_LIFT above it, facing the DJ as the deck does (#12 owner: it
  // no longer turns with the record)
  seatPose(L, i) {
    const seat = this.seats[i]; if (!seat) return;
    const face = seat.parent || seat;   // the deck group: the record spins inside it
    this.root.updateWorldMatrix(true, false); seat.updateWorldMatrix(true, false);
    this.pose.pos.copy(this.root.worldToLocal(seat.getWorldPosition(_v)));
    this.pose.pos.y += DECK_LIFT / this.rootScale();
    this.root.getWorldQuaternion(_q2).invert();
    this.pose.yaw = yawOfQ(_q.multiplyQuaternions(_q2, face.getWorldQuaternion(_q)));
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
  apply(L, t, F = null) {
    for (const a of L.actors) {
      const moved = a.puppet && F && F.motion ? applyPuppet(a, F.motion, t) : false;   // #25 first: it resets the bones
      if (a.face) applyFace(a, t, F);
      if (a.idle && !moved) applyIdle(a, t);
      if (a.mixer) {
        let ct = t - a.t0;
        if (a.loop) ct = ((ct % a.dur) + a.dur) % a.dur;
        else ct = Math.min(Math.max(ct, 0), a.dur - 1e-4);
        a.action.time = ct; a.action.paused = false; a.mixer.update(0);
      }
      if (a.motion) applyMotion(a, t);
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
  if (plinthR > 0 && st.showPlinth) {   // #21 owner: no base plate under any lesson (only if a side asks for showPlinth)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(plinthR, 64), new THREE.MeshStandardMaterial({ color: 0x151b26, roughness: 0.9 }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.002; group.add(disc);
    const rim = new THREE.Mesh(new THREE.RingGeometry(plinthR - 0.02, plinthR, 96), new THREE.MeshBasicMaterial({ color: 0x2a6f8a }));
    rim.rotation.x = -Math.PI / 2; rim.position.y = 0.004; group.add(rim);
  }

  const actors = [];
  for (const a0 of side.actors || []) {
    let a = a0, gltf;
    try { gltf = await loader.loadAsync(new URL(a.glb, base).href); }   // its own copy (a skinned scene can't be shared)
    catch (e) {
      if (!a0.fallback) throw e;
      console.warn('lesson actor', a0.glb, 'not loaded, using the fallback', e);
      a = { ...a0, motion: null, ...a0.fallback }; gltf = await loader.loadAsync(new URL(a.glb, base).href);
    }
    const obj = gltf.scene;
    if (a.pose === 'relaxed') relaxArms(obj);   // #20 before any transform: the model's own frame obj.rotation.y = (a.rotationY || 0) * DEG; obj.scale.setScalar(a.scale || 1);
    obj.traverse(m => { if (m.isSkinnedMesh) m.frustumCulled = false; });   // skinned bounds are the bind pose: never cull
    const wrap = new THREE.Group(); wrap.add(obj); group.add(wrap);   // the motion's root moves the wrap
    const act = { wrap, t0: a.t0 || 0, loop: !!a.loop };
    const clip = (a.clip && gltf.animations.find(k => k.name === a.clip)) || gltf.animations[0];
    if (clip) {
      act.mixer = new THREE.AnimationMixer(obj); act.action = act.mixer.clipAction(clip);
      act.action.setLoop(a.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); act.action.clampWhenFinished = true; act.action.play();
      act.dur = clip.duration || 1e-3;
    }
    obj.position.fromArray(a.position || [0, 0, 0]);
    if (a.motion) act.motion = await makeMotion(a.motion, base, obj);
    if (a.face) act.face = faceRig(obj);   // #20
    if (a.pose === 'relaxed') act.idle = idleRig(obj);   // #20
    if (a.puppet && !act.mixer) {   // #25 the Avatar adopts the model inside a group of its own in the wrap
      const pr = new THREE.Group(); pr.name = 'puppet'; wrap.add(pr);
      try { act.puppet = new Avatar(pr).setup(obj, { eyes: true }); act.pr = pr; }
      catch (e) { console.warn('lesson puppet', e); wrap.remove(pr); pr.remove(obj); wrap.add(obj); }
      if (act.puppet) act.idle = idleRig(obj);   // the bones Avatar re-binds are the same objects
    }
    if (act.mixer || act.motion || act.face || act.idle || act.puppet) actors.push(act);   // else a still prop: placed, nothing to drive
  }

  const trajs = (side.trajectories || []).map(tr => makeTrail(tr)).filter(Boolean);
  for (const tr of trajs) group.add(tr.mesh);

  const chapters = (side.chapters || []).map(c => ({ t: +c.t || 0, title: String(c.title || '') })).sort((p, q) => p.t - q.t);
  const board = makeBoard(); board.position.set(0, 2.45, -0.2); if (side.board !== false) group.add(board);
  const L = { url, persist: !!side.persist, title: side.title || 'Lesson', credits: String(side.credits || ''), group, actors: actors.filter(Boolean), trajs, chapters, board, chapter: -2,
    home, radius: plinthR > 0 ? plinthR : 1.7, height: 2.7 };
  drawBoard(L, -1);
  return L;
}

// ---------------------------------------------------------------- actors
const gltfCache = new Map();   // motion sources only (never added to the scene)
function loadGltf(url) { if (!gltfCache.has(url)) gltfCache.set(url, loader.loadAsync(url).catch(e => { gltfCache.delete(url); throw e; })); return gltfCache.get(url); }
const boneKey = n => String(n).replace(/^mixamorig:?/i, '').replace(/_\d+$/, '').toLowerCase();

// SpatialED #9 borrowed motion: a stand-in tree with the source clip's node names is driven by the source clip; its
// root's pose moves the actor's wrap, its pivots' turns are added onto the matching bones
async function makeMotion(m, base, obj) {
  const g = await loadGltf(new URL(m.glb, base).href);
  const src = (m.clip && g.animations.find(k => k.name === m.clip)) || g.animations[0];
  if (!src) throw new Error(`motion ${m.glb}: no animation`);
  const rootName = m.root || 'Figure', map = m.bones || {};
  const stand = new THREE.Object3D(); stand.name = rootName; const pivots = {};
  for (const k of Object.keys(map)) { const o = new THREE.Object3D(); o.name = k; stand.add(o); pivots[k] = o; }
  const keep = new Set([rootName, ...Object.keys(map)]);
  const clip = new THREE.AnimationClip(src.name, src.duration, src.tracks.filter(tr => keep.has(tr.name.split('.')[0])).map(tr => tr.clone()));
  const mixer = new THREE.AnimationMixer(stand), action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, Infinity); action.clampWhenFinished = true; action.play();
  const bones = {}; obj.traverse(b => { if (b.isBone) bones[boneKey(b.name)] = b; });
  const pairs = Object.entries(map).map(([k, name]) => ({ pivot: pivots[k], bone: bones[boneKey(name)] })).filter(p => p.bone)
    .map(p => ({ ...p, base: p.bone.quaternion.clone(), written: null }));   // #12 base = the bone's own clip pose
  return { stand, mixer, action, dur: src.duration || 1e-3, t0: m.t0 != null ? +m.t0 : null, pairs };
}
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion();
function applyMotion(a, t) {
  const M = a.motion, mt = Math.min(Math.max(t - (M.t0 != null ? M.t0 : a.t0), 0), M.dur - 1e-4);
  M.action.time = mt; M.action.paused = false; M.mixer.update(0);
  a.wrap.position.copy(M.stand.position); a.wrap.quaternion.copy(M.stand.quaternion);
  if (!M.pairs.length) return;
  a.wrap.updateMatrixWorld(true);
  a.wrap.getWorldQuaternion(_qa).invert();
  // #12 three's mixer writes a bone only when its clip value changed. With the record stopped or held, t stands still,
  // the actor's own clip writes nothing, and the turn was added again on top of last frame's (the head kept twisting,
  // the limbs kept swinging). So: if the bone still holds what we wrote last frame, put its own clip pose back first.
  for (const p of M.pairs) {
    if (p.written && p.bone.quaternion.equals(p.written)) p.bone.quaternion.copy(p.base);
    p.base.copy(p.bone.quaternion);
  }
  for (const p of M.pairs) {
    // the pivot's turn is in the figure's frame; seen from the bone it is R^-1 d R, R = the bone's turn in the figure
    const R = _qb.multiplyQuaternions(_qa, p.bone.getWorldQuaternion(_qb));
    _qc.copy(R).invert().multiply(p.pivot.quaternion).multiply(R);
    p.bone.quaternion.multiply(_qc);
    (p.written || (p.written = new THREE.Quaternion())).copy(p.bone.quaternion);
  }
}

// ---------------------------------------------------------------- #20 face and idle
// Rhubarb's shapes -> the Oculus visemes on Ready Player Me heads
const VIS = { A: 'viseme_PP', B: 'viseme_kk', C: 'viseme_E', D: 'viseme_aa', E: 'viseme_O', F: 'viseme_U', G: 'viseme_FF', H: 'viseme_nn', X: 'viseme_sil' };
const FACE_KEYS = [...new Set(Object.values(VIS))].concat(['eyeBlinkLeft', 'eyeBlinkRight', 'viseme_aa']);
const XFADE = 0.07;
function faceRig(obj) {
  const slots = {}; let n = 0;
  obj.traverse(m => { if (!m.morphTargetDictionary) return; for (const k of FACE_KEYS) { const i = m.morphTargetDictionary[k]; if (i != null) { (slots[k] = slots[k] || []).push([m, i]); n++; } } });
  return n ? { slots } : null;
}
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
function applyFace(a, t, F) {
  const S = a.face.slots, w = {};
  const cues = F && F.lips, talking = !F || F.needle !== false;   // #21 needle up: the record turns silently, the mouth rests
  if (!talking) { /* rest */ }
  else if (cues && cues.length) {   // binary search for the cue holding t, crossfade from the one before
    let lo = 0, hi = cues.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cues[mid][0] <= t) lo = mid; else hi = mid - 1; }
    const c = cues[lo], inside = t >= c[0] && t < c[1];
    if (inside) {
      const k = Math.min(1, Math.max(0, (t - c[0]) / XFADE)), cur = VIS[c[2]] || 'viseme_sil', prev = lo ? VIS[cues[lo - 1][2]] || 'viseme_sil' : 'viseme_sil';
      w[cur] = (w[cur] || 0) + k; w[prev] = (w[prev] || 0) + 1 - k;
    }
  } else if (F && F.env && F.dur > 0 && t >= 0 && t < F.dur) {   // no lips yet: the jaw follows the loudness
    const e = F.env[Math.min(F.env.length - 1, Math.floor(t / F.dur * F.env.length))] || 0;
    w.viseme_aa = Math.min(0.85, Math.max(0, (e - 0.12) * 1.5));
  }
  const g = F && F.gain != null ? F.gain : 1;   // #21 tone down (or push) the mouth shapes; silence stays silence
  if (g !== 1) for (const k in w) if (k !== 'viseme_sil') w[k] *= g;
  // blinks: one in each ~4.3 s block at a hashed moment, 0.16 s long; from t, or the wall clock while frozen
  const bt = F && F.frozen ? performance.now() / 1000 : t, blk = Math.floor(bt / 4.3), at = blk * 4.3 + 0.3 + hash(blk) * 3.4, d = Math.abs(bt - at - 0.08);
  const blink = d < 0.08 ? 1 - d / 0.08 : 0; w.eyeBlinkLeft = w.eyeBlinkRight = blink;
  for (const k of FACE_KEYS) { const v = w[k] || 0, sl = S[k]; if (sl) for (const [m, i] of sl) m.morphTargetInfluences[i] = v; }
}
// arms down from a T-pose: aim each upper arm and forearm along a world direction (the model's own frame, +z = front)
// #25 the take's head and hands at t drive the narrator. Its group is taken out of the lesson for the update, so
// Avatar works in the take's own frame (floor at 0, the professor's calibrated facing = +z = the narrator's front)
function applyPuppet(a, M, t) {
  const P = sampleMotion(M, Math.min(Math.max(t, 0), M.duration || t)); if (!P) return false;
  const pr = a.pr, par = pr.parent; if (!par) return false;
  par.remove(pr); pr.updateMatrixWorld(true);
  try { a.puppet.resetState(M.eye); a.puppet.update({ head: P.head, hands: P.hands, floorY: 0, dt: 1 }); }
  finally { par.add(pr); }
  return true;
}
function relaxArms(obj) {
  obj.updateMatrixWorld(true); const B = {};
  obj.traverse(b => { if (b.isBone) B[boneKey(b.name)] = b; });
  for (const [s, sx] of [['left', 1], ['right', -1]]) {
    const up = B[s + 'arm'], fore = B[s + 'forearm'], hand = B[s + 'hand'];
    if (!up || !fore || !hand) continue;
    aimBone(up, fore, new THREE.Vector3(0.16 * sx, -1, 0.02));
    aimBone(fore, hand, new THREE.Vector3(0.06 * sx, -1, 0.3));
  }
}
function aimBone(bone, child, dir) {
  bone.updateMatrixWorld(true);
  const a = bone.getWorldPosition(new THREE.Vector3()), b = child.getWorldPosition(new THREE.Vector3());
  const dq = new THREE.Quaternion().setFromUnitVectors(b.sub(a).normalize(), dir.normalize());
  const wq = bone.getWorldQuaternion(new THREE.Quaternion()), pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(pq.invert().multiply(dq.multiply(wq))); bone.updateMatrixWorld(true);
}
// breathing and small head moves, from t (so they scratch with the record)
function idleRig(obj) {
  const B = {}; obj.traverse(b => { if (b.isBone) B[boneKey(b.name)] = b; });
  const pick = n => B[n] ? { bone: B[n], rest: B[n].quaternion.clone() } : null;
  return { spine: pick('spine2') || pick('spine1'), neck: pick('neck'), head: pick('head') };
}
const _ie = new THREE.Euler(), _iq = new THREE.Quaternion();
function applyIdle(a, t) {
  const I = a.idle, set = (p, x, y, z) => { if (p) p.bone.quaternion.copy(p.rest).multiply(_iq.setFromEuler(_ie.set(x, y, z))); };
  set(I.spine, 0.018 * Math.sin(t * 2 * Math.PI / 4.2), 0, 0.006 * Math.sin(t * 0.9));
  set(I.neck, 0.02 * Math.sin(t * 0.7 + 1), 0.05 * Math.sin(t * 0.31), 0);
  set(I.head, 0.025 * Math.sin(t * 1.3), 0.07 * Math.sin(t * 0.43 + 2) + 0.03 * Math.sin(t * 1.7), 0.02 * Math.sin(t * 0.6));
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
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 232;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.3625), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
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
  if (L.credits) { g.fillStyle = '#9fb3c4'; g.font = '26px system-ui, sans-serif'; g.fillText(fit(g, L.credits, W - 60), W / 2, 190); }   // SpatialED #10
  L.board.userData.tex.needsUpdate = true;
}
function fit(g, s, w) { let t = s; while (t.length > 3 && g.measureText(t).width > w) t = t.slice(0, -2); return t === s ? s : t.slice(0, -1) + '…'; }
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
