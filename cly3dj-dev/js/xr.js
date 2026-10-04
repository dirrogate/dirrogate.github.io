// XR input: controllers and tracked hands.
//
// Direct interaction only (CLAUDE.md #29): no rays. A DJ touches the gear.
//  * Hand pinch, or controller trigger/grip, close to a control grabs it.
//  * An index fingertip (or the controller tip) pokes buttons and the crate screen.
//  * A fingertip resting on the vinyl holds it; moving it scratches.
import * as THREE from 'three';
import { XRControllerModelFactory } from '../vendor/three/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from '../vendor/three/webxr/XRHandModelFactory.js';
import { createControllerHand } from './ctlhands.js';   // #276
const LIFT_OUT = 0.05;
// #260 the record on a deck: 12" or 7" sizes (lift zone just past a 45's label, 1.2 cm)
let REC12 = null; const RD = d => (d.record && d.record.dims) || REC12; const LO = D => (D.SIZE === 7 ? 0.012 : LIFT_OUT);   // #136: record lift-off zone reaches this far past the label edge (m)

const REACH = 0.03;        // metres, direct-grab radius for knobs/faders
const ARM_REACH = 0.05;
const PINCH_ON = 0.018, PINCH_OFF = 0.032;
const PLATTER_R = 0.166;
const PITCH_STEP = 0.0001;   // #270 (owner): 0.01 % per thumbstick flick (was 0.05 %)

export function setupXR(ctx) {
  REC12 = ctx.REC;   // #260
  const { renderer, scene } = ctx;
  // #215 controller and hand models ship with the app (vendor/webxr-input-profiles), so nothing is fetched from
  // cdn.jsdelivr.net: works offline and can't break if the CDN changes. Quest 3/3S, Quest Pro, Quest 2 + hands.
  const PROF = new URL('../vendor/webxr-input-profiles', import.meta.url).href;   // no trailing slash: motion-controllers adds '/'
  const cmf = new XRControllerModelFactory().setPath(PROF);
  const hmf = new XRHandModelFactory().setPath(PROF + '/generic-hand/');

  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const tipGeo = new THREE.SphereGeometry(0.006, 12, 8);
  // #140 (owner): the blue tip ball sits at the front centre of the controller's own model (the fixed grip-space
  // point was off to one side on Quest 3 Touch Plus). Measured once from the loaded model: the front-most 2.5 cm of
  // its vertices give the centre (x, y); the ball's centre sits 2 mm inside the front face. Fallback until the model loads.
  const TIP_DEFAULT = new THREE.Vector3(0, -0.01, -0.055);
  function measureTip(grip) {
    const inv = new THREE.Matrix4().copy(grip.matrixWorld).invert(), v = new THREE.Vector3(), pts = [];
    grip.traverse(o => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      o.updateMatrixWorld(); const P = o.geometry.attributes.position, M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      for (let i = 0; i < P.count; i += Math.max(1, Math.floor(P.count / 4000))) pts.push(v.fromBufferAttribute(P, i).applyMatrix4(M).clone());
    });
    if (pts.length < 50) return null;   // model not loaded yet
    let minZ = Infinity; for (const p of pts) minZ = Math.min(minZ, p.z);
    if (minZ < -0.2 || minZ > 0) return null;
    let x = 0, y = 0, n = 0; for (const p of pts) if (p.z < minZ + 0.025) { x += p.x; y += p.y; n++; }
    return n ? new THREE.Vector3(x / n, y / n, minZ + 0.002) : null;
  }

  const inputs = [0, 1].map(i => {
    const ray = renderer.xr.getController(i);
    const grip = renderer.xr.getControllerGrip(i);
    const hand = renderer.xr.getHand(i);
    scene.add(ray, grip, hand);
    try { grip.add(cmf.createControllerModel(grip)); } catch (e) { console.warn(e); }
    let handModel = null;
    try { handModel = hmf.createHandModel(hand, 'mesh'); hand.add(handModel); } catch (e) { console.warn(e); }
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.7 }));
    line.visible = false; // no pointing rays
    // #140 (owner): a solid, depth-tested ball, so it reads as a nub on the controller's nose (it used to be drawn
    // over the model and looked like a dot floating off to one side). Hands keep the same ball at the fingertip.
    const tipDot = new THREE.Mesh(tipGeo, new THREE.MeshBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.3, depthWrite: false }));   // #279 semi-transparent; #282 40 % more (0.5 -> 0.3)
    tipDot.visible = false; scene.add(tipDot);
    const hitDot = new THREE.Mesh(tipGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    hitDot.visible = false; scene.add(hitDot);
    const anchor = new THREE.Object3D(); scene.add(anchor); // follows the pinch/grip; held records attach here
    const st = {
      i, ray, grip, hand, handModel, handMatFor: null, line, tipDot, hitDot, anchor, source: null, isHand: false, connected: false,
      pointer: { mouse: false, ray: new THREE.Ray(), space: ray, drag: null },
      rayActive: false, direct: null, pinching: false, squeezing: false,
      tip: new THREE.Vector3(), pinchPt: new THREE.Vector3(), poke: new Map(), scratch: null, scrollT: 0,
    };
    ray.addEventListener('connected', e => { st.source = e.data; st.isHand = !!e.data.hand; st.connected = true; st.tipLocal = null; });
    ray.addEventListener('disconnected', () => { release(st); st.connected = false; if (st.occS) st.occS.visible = st.occC.visible = false; line.visible = false; tipDot.visible = false; hitDot.visible = false; });
    // controllers: trigger or grip grabs whatever is at the tip. Hands: pinches are detected from joints.
    // the crate LCD's mic button is checked first, inside the select event itself: focusing the search
    // field needs a user gesture for the Meta system keyboard (with voice dictation) to appear (#73)
    // #104 (owner): on the turntables (tonearm, power dial, platter, record) only the TRIGGER acts; the grip
    // (middle finger) still grabs and moves everything else. A grab ends only when its own button is let go.
    const down = btn => {
      if (ctx.crateMicSelect(st.isHand ? st.pinchPt : st.tip)) { buzz(st, 0.4, 20); return; }
      if (!st.isHand) { const hl = ctlTipLocal(st); if (hl) { st.grip.updateMatrixWorld(); st.grip.localToWorld(st.tip.copy(hl)); } }   // #283 / #284 grab from the closed O's fingertip, not last frame's
      if (!st.isHand && !st.direct && grabStart(st, st.tip, btn)) st.btn = btn;
    };
    const up = btn => { if (!st.isHand && (!st.direct || st.btn === btn)) release(st); };
    ray.addEventListener('selectstart', () => down('trigger')); ray.addEventListener('selectend', () => up('trigger'));
    ray.addEventListener('squeezestart', () => down('grip')); ray.addEventListener('squeezeend', () => up('grip'));
    return st;
  });

  // ---------------------------------------------------------------- helpers
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), m4 = new THREE.Matrix4();
  const joint = (st, name) => st.hand.joints && st.hand.joints[name];
  function jointPos(st, name, out) { const j = joint(st, name); if (!j || !j.visible) return null; return j.getWorldPosition(out); }

  // Yaw of an orientation about world up (for turning knobs and rotating furniture).
  function yawOf(q) { const x = v1.set(1, 0, 0).applyQuaternion(q); return Math.atan2(-x.z, x.x); }
  function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
  function handQuat(st, out) {
    if (st.isHand) { const w = joint(st, 'wrist'); if (w) return w.getWorldQuaternion(out); }
    return st.grip.getWorldQuaternion(out);
  }

  // #222 the hand's turn about the LED wall's front axis (its X axis seen in the wall's un-turned frame)
  const _wq = new THREE.Quaternion(), _we = new THREE.Euler();
  function wallRoll(st) {
    const w = ctx.ledwall; w.parent.getWorldQuaternion(_wq); _wq.multiply(q1.setFromEuler(_we.set(0, w.rotation.y, 0))).invert();
    const x = v1.set(1, 0, 0).applyQuaternion(handQuat(st, q1)).applyQuaternion(_wq);
    return Math.atan2(x.y, x.x);
  }
  // #248 the hand's tilt toward / away from you, in the same un-turned wall frame (pitch of its pointing direction)
  function wallPitch(st) {
    const w = ctx.ledwall; w.parent.getWorldQuaternion(_wq); _wq.multiply(q1.setFromEuler(_we.set(0, w.rotation.y, 0))).invert();
    const f = v1.set(0, 0, -1).applyQuaternion(handQuat(st, q1)).applyQuaternion(_wq);
    return Math.atan2(f.y, Math.hypot(f.x, f.z));
  }
  function rayDown(st) {
    const p = st.pointer; syncRay(st);
    st.rayActive = ctx.pointerDown(p) || false;
    if (p.drag == null) st.rayActive = false; // clicks finish immediately
  }
  function rayUp(st) { ctx.pointerUp(st.pointer); st.rayActive = false; }
  function syncRay(st) {
    st.ray.updateMatrixWorld();
    m4.identity().extractRotation(st.ray.matrixWorld);
    st.pointer.ray.origin.setFromMatrixPosition(st.ray.matrixWorld);
    st.pointer.ray.direction.set(0, 0, -1).applyMatrix4(m4).normalize();
  }

  // ---------------------------------------------------------------- direct grabs
  function knobList() {
    const out = [];
    for (const [id, g] of Object.entries(ctx.mixer.userData.controls)) {
      if (ctx.mixVal[id] === undefined) continue;
      out.push({ id, g, kind: id.endsWith('.fader') || id === 'xfader' ? 'slider' : 'knob' });
    }
    for (const d of ctx.decks) out.push({ id: 'pitch', deck: d, g: d.g.userData.pitchCap, kind: 'pitch' });
    return out;
  }
  function headshellDist(d, P) {
    const u = d.g.userData, pg = u.arm.userData.pitch;
    if (u.headPts) {   // GLB deck: distance to the cartridge + finger lift itself, reach 2 cm (CLAUDE.md #62)
      let best = Infinity; pg.updateMatrixWorld();
      for (const q of u.headPts) best = Math.min(best, v2.copy(q).applyMatrix4(pg.matrixWorld).distanceTo(P));
      return best + ARM_REACH - 0.02;
    }
    const s = u.stylusLocal ? u.stylusLocal : v1.set(-0.008, -0.016, ctx.ARM.L - 0.006);
    let best = Infinity;
    for (let k = 0; k <= 7; k++) {
      const w = pg.localToWorld(v2.set(s.x, s.y + 0.008, s.z - k * 0.01));
      best = Math.min(best, w.distanceTo(P));
    }
    return best;
  }
  function stylusWorld(d, out) {
    const u = d.g.userData;
    return u.arm.userData.pitch.localToWorld(u.stylusLocal ? out.copy(u.stylusLocal) : out.set(-0.008, -0.016, ctx.ARM.L - 0.006));
  }

  const SPINDLE_GEAR = 0.015625; // #107-#109, #270, #272 (owner): 1/64 of a real spindle's travel (10 deg of wrist = 0.8 ms)
  // #120: how hard a finger presses on the platter rim (N), for the worklet's friction model. Tracking can't
  // measure force, so: controllers = the analogue trigger (0.35 N at the click point .. 2 N squeezed); fingertip =
  // how far the tracked tip sits inside the platter's edge (0.35 N just touching .. 2 N at 12 mm); pinch = 0.6 N.
  // For scale: ~0.9 N of still finger stalls a Classic (MK2) platter; under ~0.5 N the servo wins it back.
  function rimForce(st, r) { return rimForce0(st, r); }   // #272: friction back to normal (#270/#271 changed it); the nudge is halved in the worklet
  function rimForce0(st, r) {
    if (!st.isHand) {
      const b = st.source && st.source.gamepad && st.source.gamepad.buttons && st.source.gamepad.buttons[0];
      const v = b ? b.value : 0.5;
      return 0.35 + 1.65 * Math.max(0, Math.min(1, (v - 0.25) / 0.75));
    }
    if (st.direct && st.direct.kind === 'scratch') return 0.6;   // pinching the rim
    return 0.35 + 1.65 * Math.max(0, Math.min(1, (PLATTER_R + 0.008 - r) / 0.012));
  }
  function rimR(d, l) { return Math.hypot(l.x - ctx.DECK.spindle.x, l.z - ctx.DECK.spindle.z); }
  // #120: controller feel. Classic motor not driving: a tick per cogging detent (48 per turn) while the hand turns
  // the platter. A held record rubbing on the mat / the motor straining: a soft rumble.
  function deckFeel(st, dt) {
    const s = st.direct && st.direct.kind === 'scratch' ? st.direct.s : st.scratch;
    if (!s || st.isHand || !ctx.deckState) { st.detK = null; return; }
    const f = ctx.deckState(s.deck), S = f.st;
    if (f.model === 'classic' && !f.driving && S.pang != null && Math.abs(S.prate || 0) < 0.3) {
      const k = Math.floor(S.pang * 48 / (2 * Math.PI));
      if (st.detK != null && k !== st.detK) buzz(st, 0.12, 6);
      st.detK = k;
    } else st.detK = null;
    st.rubT = (st.rubT || 0) - dt;
    if (st.rubT <= 0) {
      const v = Math.min(0.3, Math.abs(S.slip || 0) * 0.08 + Math.max(0, Math.abs(S.load || 0) - 0.6) * 0.3);
      if (v > 0.03) buzz(st, v, 45);
      st.rubT = 0.04;
    }
  }
  function grabStart(st, P, btn) {
    if (st.direct) return true;
    if (!st.isHand && st.scratch) { ctx.scratchEnd(st.scratch); st.scratch = null; }   // #282 a touch-nudge gives way to a button grab
    const deckOk = st.isHand || btn !== 'grip';   // #104: turntable actions = trigger (or hand pinch)
    if (ctx.getHeld() && ctx.getHeld().attach === st.anchor) return true; // already holding a record
    // #229 the other hand on the record peeking out of a sleeve in your hand: slide it out
    // #242 also a sleeve lying about (any hand but the one holding that sleeve)
    if (ctx.sleeveSlideTest) {
      const sl = ctx.sleeveSlideTest(P, st.anchor);
      if (sl) { st.direct = { kind: 'sleeveSlide', sl: sl.sl, y0: sl.y0, s0: sl.s0 }; buzz(st, 0.3, 20); return true; }
    }
    // #242 a sleeve lying about: grab it anywhere to pick it up again
    if (ctx.sleeveGrabTest) { const h = ctx.sleeveGrabTest(P); if (h && h.sl) { updateAnchor(st); if (ctx.sleeveGrab(st.anchor, P)) { st.direct = { kind: 'sleeve' }; buzz(st, 0.4, 30); return true; } } }
    // 0. target lamp, controllers only: the trigger (or grip) at the lamp head toggles it (CLAUDE.md #58).
    //    Controllers never toggle it by hovering; bare hands still press it with a fingertip poke.
    if (!st.isHand) for (const d of ctx.decks) {
      const t = d.g.userData.target; if (!t) continue;
      t.grp.getWorldPosition(v2); v2.y += t.headY;
      if (Math.hypot(P.x - v2.x, P.z - v2.z) < 0.02 && P.y - v2.y < 0.025 && P.y - v2.y > -0.03) {
        ctx.pressControl({ deck: d.name, id: 'target' }); st.direct = { kind: 'tap' }; buzz(st, 0.5, 30); return true;
      }
    }
    // 0a. #189 the mixer's tablet: grip (controllers) or pinch (hands) on its frame picks it up; it keeps its pose
    //     relative to the hand while held (main.js places it; it stays a child of the mixer so the phone mirrors it)
    // #195 (owner): pick-up = grip only (hands: pinch); resize = trigger (or pinch) on the lower-right corner handle and
    // drag, or a second grip on the tablet while the other hand holds it, pulling apart
    {
      const tb = ctx.mixer.userData.tablet;
      if (tb) {
        tb.updateMatrixWorld();
        const l = tb.worldToLocal(v2.copy(P)), corner = tb.localToWorld(v1.set(0.095, 0.035, 0));   // #196b the silver corner L (#202 top-right)
        const onCorner = corner.distanceTo(P) < 0.03 * Math.max(1, tb.scale.x * 0.8);
        const inside = Math.abs(l.x) < 0.115 && Math.abs(l.y) < 0.05 && l.z > -0.035 && l.z < 0.035;
        const docked = tb.position.distanceTo(ctx.mixer.userData.tabletDock.p) < 1e-4;
        if (onCorner && !docked && (st.isHand || btn !== 'grip')) {
          const c = tb.getWorldPosition(new THREE.Vector3());
          st.direct = { kind: 'tabletScale', c0: c, d0: Math.max(0.02, c.distanceTo(P)), s0: tb.scale.x }; buzz(st, 0.4, 25); return true;
        }
        if (inside && (btn === 'grip' || st.isHand)) {
          const other = inputs.find(o => o !== st && o.direct && o.direct.kind === 'tablet');
          if (other && !docked) {   // second hand: two-handed stretch (the first hand keeps holding it)
            st.direct = { kind: 'tabletStretch', other, d0: Math.max(0.02, pinchOf(other).distanceTo(P)), s0: tb.scale.x }; buzz(st, 0.5, 40); buzz(other, 0.5, 40); return true;
          }
          ctx.tabletGrab && ctx.tabletGrab();
          updateAnchor(st); tb.updateMatrixWorld();
          st.direct = { kind: 'tablet', off: new THREE.Matrix4().copy(st.anchor.matrixWorld).invert().multiply(tb.matrixWorld) };
          buzz(st, 0.4, 25); return true;
        }
      }
    }
    // 0b. 33 / 45, controllers only: trigger (or grip) at the button, never by hovering (owner, #64)
    if (!st.isHand) {
      let best = null, bd = 0.016;
      for (const d of ctx.decks) for (const [key, id] of [['b33', 'rpm33'], ['b45', 'rpm45'], ['x2', 'x2']]) {   // #253 + X2
        const b = d.g.userData[key]; if (!b) continue; b.getWorldPosition(v2);
        const dd = Math.hypot(P.x - v2.x, P.z - v2.z); if (dd < bd && P.y - v2.y < 0.03 && P.y - v2.y > -0.015) { bd = dd; best = { deck: d.name, id }; }
      }
      if (best) { ctx.pressControl(best); st.direct = { kind: 'tap' }; buzz(st, 0.5, 30); return true; }
    }
    // 1. tonearm
    // grab zone covers the whole headshell and cartridge: points from the stylus 7 cm back along the arm
    if (deckOk) for (const d of ctx.decks) {
      if (headshellDist(d, P) < ARM_REACH) { ctx.armGrab(d); st.direct = { kind: 'arm', d, y0: P.y }; buzz(st); return true; }
    }
    // 1b. power dial: twist it (about a quarter turn) to switch the deck on or off
    // #252 (owner): with controllers the power dial and START / STOP answer the grip only (a trigger or a brushing tip
    // never switches a deck off or stops it); bare hands as before (pinch the dial, poke the button)
    const gripOk = st.isHand || btn === 'grip';
    if (gripOk) for (const d of ctx.decks) {
      const pk = d.g.userData.powerKnob;
      if (pk && pk.getWorldPosition(v2).distanceTo(P) < 0.035) { st.direct = { kind: 'power', d, yaw0: yawOf(handQuat(st, q1)), done: false }; buzz(st); return true; }
    }
    if (!st.isHand && btn === 'grip') for (const d of ctx.decks) {
      const sb = d.g.userData.start; if (!sb) continue;
      sb.getWorldPosition(v2);
      if (Math.hypot(P.x - v2.x, P.z - v2.z) < 0.03 && P.y - v2.y < 0.04 && P.y - v2.y > -0.02) { ctx.pressControl({ deck: d.name, id: 'start' }, st); st.direct = { kind: 'tap' }; buzz(st, 0.5, 30); return true; }
    }
    // #256 the 45 adapter (in its recess, on a spindle or lying about): grip (controllers) or pinch (hands)
    if (gripOk && ctx.spiderGrabTest) {
      const sp = ctx.spiderGrabTest(P);
      if (sp) { updateAnchor(st); ctx.spiderGrab(sp, st.anchor); st.direct = { kind: 'spider' }; buzz(st, 0.3, 20); return true; }
    }
    // 2. faders, pitch, knobs
    // #195 knobs, faders and pitch faders take the trigger (hands: pinch). (#282 tried the grip; #284 owner: back to the
    // trigger, the 3D hand closes its thumb-and-index O on the trigger now)
    let best = null, bestD = REACH;
    if (deckOk) for (const k of knobList()) {
      k.g.getWorldPosition(v2); v2.y += 0.012;
      const dd = v2.distanceTo(P); if (dd < bestD) { bestD = dd; best = k; }
    }
    if (best) {
      // #230 faders and pitch move relative to where they were grabbed (the cap no longer jumps to the pinch)
      if (best.kind === 'knob') st.direct = { kind: 'knob', id: best.id, yawL: yawOf(handQuat(st, q1)) };
      else if (best.kind === 'slider') st.direct = { kind: 'slider', id: best.id, v0: ctx.mixVal[best.id], m0: ctx.sliderFromLocal(best.id, ctx.mixer.worldToLocal(v2.copy(P))) };
      else { st.direct = { kind: 'pitch', d: best.deck, v0: best.deck.pitch, m0: ctx.pitchFromLocalZ(best.deck, best.deck.g.worldToLocal(v2.copy(P)).z) }; ctx.setLastTouched(best.deck.i); ctx.heldPitch.add(best.deck.i); }
      st.direct.hist = []; st.direct.dmin = Infinity;
      buzz(st); return true;
    }
    // 3. platter and record (CLAUDE.md #35): label = lift off (only after a 3 cm lift), grooves = scratch,
    //    platter rim = nudge. Grabbing the edge never takes the record off.
    //    #104 (owner): lift-off zone = the plain vinyl ring just outside the label, from 3 mm to 2 cm past its
    //    edge; the label itself does nothing (kept free for the spindle); scratch = the grooves beyond that.
    // #181 (owner): the grip also lifts a record off the platter (label or the ring just outside it), like pulling one
    // from a sleeve; every other turntable action stays trigger-only (#104)
    if (!deckOk) for (const d of ctx.decks) {
      if (!d.record) continue;
      const l = d.g.worldToLocal(v2.copy(P));
      const r = Math.hypot(l.x - ctx.DECK.spindle.x, l.z - ctx.DECK.spindle.z), h = l.y - (d.g.userData.platterSurface + RD(d).THICK);
      if (h > -0.035 && h < 0.05 && r < RD(d).LABEL + LO(RD(d))) { st.direct = { kind: 'lift', d, y0: P.y }; buzz(st, 0.2, 15); return true; }
    }
    if (deckOk) for (const d of ctx.decks) {
      const l = d.g.worldToLocal(v2.copy(P));
      const r = Math.hypot(l.x - ctx.DECK.spindle.x, l.z - ctx.DECK.spindle.z);
      const h = l.y - (d.g.userData.platterSurface + RD(d).THICK);
      if (h < -0.035 || h > 0.05 || r > PLATTER_R + 0.015) continue;
      // #106 (owner): twist only on the spindle itself (3.5 mm pin + 4.5 mm reach, from the record surface to
      // 2 cm above it); the rest of the label does nothing, so a hand resting there never twists by accident
      if (d.record && r < 0.008 && h > -0.005 && h < 0.02) { st.direct = { kind: 'spindle', d, yawL: yawOf(handQuat(st, q1)), acc: 0 }; buzz(st, 0.3, 15); return true; }   // #105
      // #107: lift zone widened 5 mm into the label (45-70 mm radius); inside that the label does nothing
      if (d.record && r < RD(d).LABEL - 0.005) { st.direct = { kind: 'tap' }; return true; }
      // #136 (owner): lift zone 3 cm wider (label edge + 5 cm, was + 2 cm); lifting a record off was too fiddly
      // #249 (owner): with a controller the record only comes off with the grip (block above); the trigger there scratches,
      // so a rough scratch that pulls up can never take it off. Bare hands still lift with a pinch.
      if (st.isHand && d.record && r < RD(d).LABEL + LO(RD(d))) { st.direct = { kind: 'lift', d, y0: P.y }; buzz(st, 0.2, 15); return true; }
      // #273 (owner): the trigger on the record's edge holds the record (and the mat under it) still while the
      // platter keeps spinning underneath, as on an SL-1200; it never lifts. Only the platter rim beyond the
      // record (the strobe dots) nudges.
      if (d.record && r < RD(d).R + 0.003) { st.direct = { kind: 'scratch', d, s: ctx.scratchBegin(d, l) }; buzz(st); return true; }
      if (r > RD(d).R + 0.003) { st.direct = { kind: 'scratch', d, s: ctx.scratchBegin(d, l, true, st.isHand ? 0.6 : rimForce(st, r)) }; buzz(st, 0.2, 15); return true; }
    }
    // 3b. a record lying around (thrown or dropped): grab it anywhere on the disc
    for (const L of ctx.loose) {
      const c = L.rec.group.getWorldPosition(v1), n = v2.set(0, 1, 0).applyQuaternion(L.rec.mesh.getWorldQuaternion(q1));
      const rel = P.clone().sub(c), h = rel.dot(n), radial = rel.addScaledVector(n, -h).length();
      if (Math.abs(h) < 0.04 && radial < (L.rec.dims || ctx.REC).R + 0.02) { updateAnchor(st); ctx.pickUpLoose(L.rec, st.anchor); st.direct = { kind: 'held' }; buzz(st); return true; }
    }
    // 3c. crate lid: grab the handle or the lid's free edge and swing it on its hinges; let go and it
    //     falls shut or back open depending on which side of upright it is (main.js stepLid)
    //     Lid shut: its carry handle picks up the whole crate instead (owner, #86).
    const lg = ctx.lidGrabTest(P);
    if (lg === 'handle' && ctx.lidShut() && gripOk) {   // #253 carrying the crate = grip
      const g = ctx.MOVABLE.crate;
      st.direct = { kind: 'move', target: 'crate', stMove: ctx.stage.beginMove('crate'), p0: P.clone(), pos0: g.position.clone(), yaw0: g.rotation.y, hyaw0: yawOf(handQuat(st, q1)) };
      buzz(st); return true;
    }
    if (lg) { ctx.lidGrab(); st.direct = { kind: 'lid', off: ctx.lidOffset(P) }; buzz(st); return true; }
    // 4. the record riding out of its sleeve: grab its top half to pull it
    const cl = ctx.crate.worldToLocal(v2.copy(P));
    const C = ctx.CRATE;
    const cd = ctx.crateDisc;
    const lidOpen = ctx.crateLidOpen();
    // 4a. #229 / #274 (checked first) a hand on the selected sleeve, up to its top edge: the sleeve comes out with the record
    if (lidOpen && ctx.sleeveGrabTest && ctx.sleeveGrabTest(P)) {
      updateAnchor(st); if (ctx.sleeveGrab(st.anchor, P)) { st.direct = { kind: 'sleeve' }; buzz(st, 0.4, 30); return true; }
    }
    // 4b. the record riding out above the sleeve: only the record comes out
    if (lidOpen && cd.visible && Math.abs(cl.z - cd.position.z) < 0.05 && cl.y > cd.position.y - 0.03 && Math.hypot(cl.x - cd.position.x, cl.y - cd.position.y) < ctx.REC.R + 0.02) {
      updateAnchor(st); if (ctx.pullSelected(st.anchor)) { st.direct = { kind: 'held' }; buzz(st); return true; }
    }
    // 5. digging: pinch inside the crate and move along the rack to flip, lift out to pull
    if (lidOpen && Math.abs(cl.x) < C.W / 2 && Math.abs(cl.z) < C.D / 2 && cl.y > 0.05 && cl.y < C.H + 0.15) {
      st.direct = { kind: 'dig', y0: cl.y }; digTo(cl.z); buzz(st); return true;
    }
    // 6. gear bodies, flight-case bottom handles (resize), flight-case bodies (move)
    // #253 (owner): moving, turning, tilting and resizing stage items (decks, mixer, crates, milk crates, LED wall,
    // neon, flight cases) = the grip on controllers; the trigger never moves them. Bare hands: pinch, as before.
    const hit = gripOk ? hitMovable(P) : null;
    // neon sign: a second hand on the other centre bar resizes it (pull apart = bigger); anywhere else is ignored
    if (hit && hit.key === 'neon') {
      const other = inputs.find(o => o !== st && o.direct && o.direct.kind === 'move' && o.direct.target === 'neon');
      if (other) {
        const a = neonBar(pinchOf(other)), b = neonBar(P);
        if (a && b && a !== b) {
          ctx.stage.endMove(other.direct.stMove);
          const R = { a: other, b: st, d0: Math.max(0.02, pinchOf(other).distanceTo(P)), s0: ctx.neon.scale.x };
          other.direct = { kind: 'neonScale', R }; st.direct = { kind: 'neonScale', R };
          buzz(st, 0.5, 40); buzz(other, 0.5, 40); return true;
        }
        st.direct = { kind: 'tap' }; return true;
      }
    }
    // #222 LED wall: grab the middle of the screen and twist the wrist = turn it (portrait / landscape); it settles
    // on 0 or 90 deg when let go. Grabbing nearer the edges still moves it; a second hand still resizes (below).
    if (hit && hit.key === 'ledwall' && !inputs.some(o => o !== st && o.direct && o.direct.target === 'ledwall')) {
      const l = ctx.ledwall.worldToLocal(v2.copy(P));
      if (Math.abs(l.x) < ctx.LED.W * 0.22 && Math.abs(l.y) < ctx.LED.H * 0.3) {
        st.direct = { kind: 'ledTurn', target: 'ledwall', roll0: ctx.ledwall.rotation.z, h0: wallRoll(st), tilt0: ctx.ledwall.rotation.x, p0: wallPitch(st), axis: null };
        buzz(st, 0.4, 30); ctx.toast && ctx.toast('Twist your wrist to turn the LED wall, or tip your hand toward / away from you to tilt it', 2500); return true;
      }
    }
    // #176 LED wall: a second hand anywhere on it while the other hand holds it = resize (pull apart = bigger)
    if (hit && hit.key === 'ledwall') {
      const other = inputs.find(o => o !== st && o.direct && o.direct.kind === 'move' && o.direct.target === 'ledwall');
      if (other) {
        ctx.stage.endMove(other.direct.stMove);
        const R = { a: other, b: st, d0: Math.max(0.02, pinchOf(other).distanceTo(P)), s0: ctx.ledwall.scale.x };
        other.direct = { kind: 'ledScale', R }; st.direct = { kind: 'ledScale', R };
        buzz(st, 0.5, 40); buzz(other, 0.5, 40); return true;
      }
    }
    if (hit && ctx.cases[hit.key]) {
      // second hand on a case the other hand already holds = two-handed resize (CLAUDE.md #43)
      const other = inputs.find(o => o !== st && o.direct && o.direct.kind === 'move' && o.direct.target === hit.key);
      if (other) { startTwoHand(other, st, hit.key); buzz(st, 0.5, 40); buzz(other, 0.5, 40); return true; }
    }
    if (hit) {
      const g = ctx.MOVABLE[hit.key];
      if (ctx.flyingMilk && ctx.flyingMilk.has(g)) { ctx.flyingMilk.delete(g); g.rotation.x = 0; g.rotation.z = 0; }   // #200 caught mid-bounce
      st.direct = { kind: 'move', target: hit.key, stMove: ctx.stage.beginMove(hit.key), p0: P.clone(), pos0: g.position.clone(), yaw0: g.rotation.y, hyaw0: yawOf(handQuat(st, q1)) };
      buzz(st); return true;
    }
    return false;
  }
  // Where on the stage is P? Gear sides first (not their tops, where the controls are), then the
  // bottom resize handles of the flight cases, then the cases themselves.
  const GEAR = {
    deckA: { x: 0.24, z: 0.19, y0: -0.03, y1: 0.075 }, deckB: { x: 0.24, z: 0.19, y0: -0.03, y1: 0.075 },
    mixer: { x: 0.14, z: 0.19, y0: 0, y1: 0.09 }, crate: { x: 0.2, z: 0.19, y0: 0, y1: 0.32 },
    milk: { x: 0.19, z: 0.19, y0: 0, y1: 0.29 },
    neon: { x: 0.33, z: 0.07, y0: -0.33, y1: 0.33 },   // sign-local (unscaled) units: worldToLocal takes its scale out
    ledwall: { x: 0.84, z: 0.08, y0: -0.49, y1: 0.49 },   // #176, wall-local (unscaled)
  };
  // which centre bar of the neon sign P is on: -1 left, 1 right, 0 neither
  function neonBar(P) {
    const l = ctx.neon.worldToLocal(v1.copy(P)), N = ctx.NEON;
    if (Math.abs(l.y) > N.pillarHalfH + 0.025 || Math.abs(l.z) > 0.07 || Math.abs(Math.abs(l.x) - Math.abs(N.pillarX)) > 0.05) return 0;
    return Math.sign(l.x);
  }
  function hitMovable(P) {
    for (const k of [...Object.keys(GEAR), ...Object.keys(ctx.stage.items).filter(k => /^milk\d$/.test(k))]) {   // + spawned milk crates (#88)
      const o = ctx.MOVABLE[k]; if (!o || !o.visible) continue;   // #235 switched-off pieces can't be grabbed
      // #200 milk crates: the grab box follows the crate's real size (#193 made it longer and taller than the old box), 3 cm
      // of reach round the sides and 6 cm over the rim, so it can be picked up by its rim, ends or sides
      const M = ctx.MILK, b = k.startsWith('milk') && M ? { x: M.W / 2 + 0.03, z: M.D / 2 + 0.03, y0: -0.02, y1: M.H + 0.06 } : GEAR[k];
      const l = o.worldToLocal(v2.copy(P));
      if (Math.abs(l.x) < b.x && Math.abs(l.z) < b.z && l.y > b.y0 && l.y < b.y1) return { key: k };
    }
    for (const k in ctx.cases) {
      const c = ctx.cases[k], l = c.group.worldToLocal(v2.copy(P));
      if (Math.abs(l.x) < c.W / 2 + 0.03 && Math.abs(l.z) < c.D / 2 + 0.03 && l.y > 0.08 && l.y < c.H + 0.03) return { key: k };
    }
    return null;
  }
  const pinchOf = s => (s.isHand ? s.pinchPt : s.tip);
  // Both hands on a case: pull apart / push together along the axis the hands are on to change width
  // (hands on the left and right sides) or depth (front and back); raise or lower both to change height.
  function startTwoHand(a, b, key) {
    ctx.stage.endMove(a.direct.stMove);           // the first hand was carrying it: leave it where it is
    const c = ctx.cases[key], g = c.group; g.updateMatrixWorld(true);
    const la = g.worldToLocal(pinchOf(a).clone()), lb = g.worldToLocal(pinchOf(b).clone());
    const axis = Math.abs(la.x - lb.x) >= Math.abs(la.z - lb.z) ? 'x' : 'z';
    const R = { key, axis, a, b, W0: c.W, D0: c.D, H0: c.H,
      sep0: Math.abs(axis === 'x' ? la.x - lb.x : la.z - lb.z), y0: (pinchOf(a).y + pinchOf(b).y) / 2 };
    a.direct = { kind: 'twoHand', R }; b.direct = { kind: 'twoHand', R };
  }
  function twoHandStep(R) {
    const c = ctx.cases[R.key], g = c.group;
    const la = g.worldToLocal(pinchOf(R.a).clone()), lb = g.worldToLocal(pinchOf(R.b).clone());
    const sep = Math.abs(R.axis === 'x' ? la.x - lb.x : la.z - lb.z);
    const dH = (pinchOf(R.a).y + pinchOf(R.b).y) / 2 - R.y0;
    ctx.stage.resize(R.key, R.axis === 'x' ? R.W0 + sep - R.sep0 : c.W, R.axis === 'z' ? R.D0 + sep - R.sep0 : c.D, R.H0 + dH, null);
  }

  function digTo(localZ) {
    const C = ctx.CRATE; const front = C.D / 2 - 0.03;
    const k = Math.round((front - localZ) / C.pitch);
    const idx = ctx.sleeveMap[Math.max(0, Math.min(C.slots - 1, k))];
    if (idx >= 0 && idx !== ctx.crateState.sel) { ctx.crateState.sel = idx; ctx.drawCrateScreen(); ctx.layoutSleeves(); }
  }

  function grabMove(st, P) {
    const g = st.direct; if (!g) return;
    if (g.kind === 'arm') {
      const l = g.d.g.worldToLocal(v2.copy(P)); const pv = g.d.g.userData.pivot;
      if (ctx.armDrag(g.d, Math.atan2(l.x - pv.x, l.z - pv.z), P.y - g.y0) === 'drop') buzz(st, 0.6, 35);   // #104: needle found the lead-in
      if (g.d.arm.dragDown && (g.buzzT = (g.buzzT || 0) + 1) % 3 === 0) buzz(st, 0.15, 12);   // feel the grooves
    } else if (g.frozen) {   // #230 fingers opening: the control stays put
      if (g.kind === 'knob') g.yawL = yawOf(handQuat(st, q1));
    } else if (g.kind === 'knob') {
      // Hard stops (owner, 26 Sep): the value moves by each frame's twist and is clamped at 0 / 1, so turning
      // past an end does nothing and turning back leaves the stop at once. The old version mapped the total
      // twist since the grab through wrap(), which jumped from -180 to +180 deg and flipped min <-> max.
      const y = yawOf(handQuat(st, q1));
      const dy = Math.max(-0.6, Math.min(0.6, wrap(y - g.yawL))); g.yawL = y;   // cap: ignore yaw flips when the hand points straight up/down
      let nv = ctx.mixVal[g.id] - dy / (300 * Math.PI / 180) * 1.2;   // turn clockwise (seen from above) = up
      // #254 (owner) sticky PAN: centred, it holds until turned 8 % of its travel away (a brush can't swing it);
      // turned back within 3 % of the middle it settles there again. The hold keeps the turn so far in g.panAcc.
      if (g.id.endsWith('.pan')) {
        if (ctx.mixVal[g.id] === 0.5) { g.panAcc = (g.panAcc || 0) + (nv - 0.5); nv = Math.abs(g.panAcc) > 0.08 ? 0.5 + g.panAcc : 0.5; if (nv !== 0.5) g.panAcc = 0; }
        else if (Math.abs(nv - 0.5) < 0.03 && Math.abs(ctx.mixVal[g.id] - 0.5) >= 0.03) { nv = 0.5; g.panAcc = 0; buzz(st, 0.3, 12); }
      }
      ctx.setMix(g.id, nv);
    } else if (g.kind === 'slider') {
      const m = ctx.sliderFromLocal(g.id, ctx.mixer.worldToLocal(v2.copy(P)));
      if (g.m0 == null) { g.m0 = m; g.v0 = ctx.mixVal[g.id]; }
      ctx.setMix(g.id, g.v0 + (m - g.m0));
    } else if (g.kind === 'pitch') {
      const m = ctx.pitchFromLocalZ(g.d, g.d.g.worldToLocal(v2.copy(P)).z);
      // #253 fine pitch: while the other hand pulls its trigger (or pinches), the fader moves at quarter speed;
      // switching in or out re-anchors here, so the pitch never jumps
      // #265 (owner DJs with one controller): squeezing the grip on the SAME controller that holds the fader is fine mode;
      // the other hand's trigger / pinch still works too (bare hands: only that way)
      const gpS = !st.isHand && st.source && st.source.gamepad, ob = st.btn === 'grip' ? 0 : 1, ownGrip = !!(gpS && gpS.buttons[ob] && gpS.buttons[ob].pressed);   // #282 the fader is held with the grip: fine = the same controller's trigger
      const fine = ownGrip || inputs.some(o => o !== st && o.connected && (o.isHand ? !!o.pinching : !!(o.source && o.source.gamepad && o.source.gamepad.buttons[0] && o.source.gamepad.buttons[0].pressed)));
      if (g.m0 == null || fine !== !!g.fine) { g.m0 = m; g.v0 = g.d.pitch; if (fine !== !!g.fine) { g.fine = fine; buzz(st, fine ? 0.35 : 0.2, 15); } }
      ctx.setPitch(g.d, g.v0 + (m - g.m0) * (fine ? 0.25 : 1));
    } else if (g.kind === 'spindle') {
      // #105: twist about the vertical, 1:1 like a real spindle; clockwise from above = forward. A tick every 5 ms.
      const y = yawOf(handQuat(st, q1)), dy = Math.max(-0.6, Math.min(0.6, wrap(y - g.yawL))); g.yawL = y;
      const sec = -dy / (2 * Math.PI) * 1.8 * SPINDLE_GEAR;   // #109: 10 deg = 3.1 ms
      if (Math.abs(sec) > 1e-5) { ctx.spindleTwist(g.d, sec); g.acc += Math.abs(sec); if (g.acc >= 0.001) { g.acc -= 0.001; buzz(st, 0.2, 8); } }   // tick every 2.5 ms (#109)
    } else if (g.kind === 'lift') {
      if (P.y - g.y0 > 0.03) { updateAnchor(st); ctx.pickUpFromDeck(g.d, st.anchor); st.direct = { kind: 'held' }; buzz(st); }
    } else if (g.kind === 'scratch') {
      const l = g.d.g.worldToLocal(v2.copy(P));
      ctx.scratchMove(g.s, l, g.s.nudge ? rimForce(st, rimR(g.d, l)) : undefined);
    } else if (g.kind === 'lid') {
      ctx.lidDragTo(P, g.off);
    } else if (g.kind === 'sleeveSlide') {   // #229
      const r = ctx.sleeveSlideTo(P, g);
      if (r === null) st.direct = null;
      else if (r === 'out') {
        updateAnchor(st);   // #242 the sleeve stays where it is (in the other hand or lying about)
        if (ctx.sleevePulled(g, st.anchor)) { st.direct = { kind: 'held' }; buzz(st, 0.5, 40); } else st.direct = null;
      } else if ((g.bz = (g.bz || 0) + 1) % 4 === 0) buzz(st, 0.1, 8);   // the record rubbing on the inner sleeve
    } else if (g.kind === 'dig') {
      const cl = ctx.crate.worldToLocal(v2.copy(P));
      if (cl.y > ctx.CRATE.H + 0.1) { updateAnchor(st); if (ctx.pullSelected(st.anchor)) { st.direct = { kind: 'held' }; buzz(st); } }
      else digTo(cl.z);
    } else if (g.kind === 'move') {
      // gear lifts with the hand and settles onto whatever case is under it on release; cases stay on the floor
      const obj = ctx.MOVABLE[g.target];
      const delta = v2.copy(P).sub(g.p0).applyQuaternion(obj.parent.getWorldQuaternion(q1).invert());
      const isCase = !!ctx.cases[g.target];
      obj.position.set(g.pos0.x + delta.x, isCase ? g.pos0.y : Math.max(0, g.pos0.y + delta.y), g.pos0.z + delta.z);
      obj.rotation.y = g.yaw0 + wrap(yawOf(handQuat(st, q1)) - g.hyaw0);
      if (!isCase) ctx.clampStack(g.target);   // #142: crates can't sink into what is under them
      // hand velocity (world), so a milk crate can be tossed (#88)
      const now = performance.now();
      if (g.lastP) { const dtm = Math.max(0.004, (now - g.lastT) / 1000), v = v1.copy(P).sub(g.lastP).divideScalar(dtm); g.vel = g.vel ? g.vel.lerp(v, 0.4) : v.clone(); }
      g.lastP = (g.lastP || new THREE.Vector3()).copy(P); g.lastT = now;
    } else if (g.kind === 'tablet') {   // #189
      updateAnchor(st); ctx.tabletHold(new THREE.Matrix4().multiplyMatrices(st.anchor.matrixWorld, g.off));
    } else if (g.kind === 'tabletScale') {   // #195 corner drag: size follows the distance from the tablet's centre
      ctx.tabletScale(g.s0 * g.c0.distanceTo(P) / g.d0);
    } else if (g.kind === 'tabletStretch') {   // #195 two grips: size follows the distance between the hands
      if (!g.other.direct || g.other.direct.kind !== 'tablet') st.direct = null;
      else ctx.tabletScale(g.s0 * pinchOf(g.other).distanceTo(P) / g.d0);
    } else if (g.kind === 'power') {
      const dy = wrap(yawOf(handQuat(st, q1)) - g.yaw0);
      if (!g.done && Math.abs(dy) > 0.35) { ctx.setPower(g.d, g.d.power === false); g.done = true; buzz(st, 0.6, 40); }
    } else if (g.kind === 'neonScale') {
      if (g.R.a === st) ctx.setNeonScale(g.R.s0 * pinchOf(g.R.a).distanceTo(pinchOf(g.R.b)) / g.R.d0);
    } else if (g.kind === 'ledTurn') {   // #222 twist = portrait / landscape; #248 tip toward / away = tilt
      const dr = wrap(wallRoll(st) - g.h0), dp = wallPitch(st) - g.p0;
      if (!g.axis && Math.max(Math.abs(dr), Math.abs(dp)) > 0.17) { g.axis = Math.abs(dr) >= Math.abs(dp) ? 'roll' : 'tilt'; buzz(st, 0.3, 20); }   // the first 10 deg decide which, then it stays on that one
      if (g.axis === 'roll') ctx.ledwall.rotation.z = g.roll0 + dr;
      else if (g.axis === 'tilt') ctx.ledwall.rotation.x = Math.max(-0.8, Math.min(0.8, g.tilt0 + dp));   // up to ~45 deg either way
    } else if (g.kind === 'ledScale') {
      if (g.R.a === st) ctx.setLedScale(g.R.s0 * pinchOf(g.R.a).distanceTo(pinchOf(g.R.b)) / g.R.d0);
    } else if (g.kind === 'twoHand') {
      if (g.R.a === st) twoHandStep(g.R);            // computed once per frame, by the first hand
    }
  }

  function release(st) {
    const g = st.direct; st.direct = null;
    if (st.rayActive) rayUp(st);
    if (!g) return;
    if (g.kind === 'arm') ctx.armRelease(g.d);
    else if (g.kind === 'pitch') ctx.heldPitch.delete(g.d.i);
    else if (g.kind === 'scratch') ctx.scratchEnd(g.s);
    else if (g.kind === 'held') { const h = ctx.getHeld(); if (h && h.attach === st.anchor) ctx.releaseHeld(); }
    else if (g.kind === 'move') { ctx.stage.endMove(g.stMove); if (g.target.startsWith('milk')) ctx.releaseMilk(g.target, g.vel); else ctx.settleStack(g.target); }   // #200 milk: releaseMilk drops / throws / settles it
    else if (g.kind === 'lid') ctx.lidRelease();
    else if (g.kind === 'spider') { ctx.spiderRelease(st.anchor); buzz(st, 0.3, 20); }   // #256
    else if (g.kind === 'sleeve') ctx.sleeveRelease(st.anchor);   // #242 let go: it stays there (over the record crate: back in)
    else if (g.kind === 'tablet') { for (const o of inputs) if (o !== st && o.direct && o.direct.kind === 'tabletStretch') o.direct = null; if (ctx.tabletRelease()) buzz(st, 0.6, 35); }   // #189 (a buzz when it snaps into the slot)
    else if (g.kind === 'tabletScale' || g.kind === 'tabletStretch') ctx.saveTablet();
    else if (g.kind === 'ledTurn') { if (g.axis === 'tilt') ctx.ledTilted && ctx.ledTilted(); else ctx.ledTurned(); buzz(st, 0.5, 30); }   // #222 settle on portrait / landscape; #248 a tilt just stays
    else if (g.kind === 'ledScale') {
      const o = g.R.a === st ? g.R.b : g.R.a;
      if (o.direct && o.direct.kind === 'ledScale') o.direct = null;
      ctx.saveLedScale(); ctx.stage.save();
    }
    else if (g.kind === 'neonScale') {
      const o = g.R.a === st ? g.R.b : g.R.a;
      if (o.direct && o.direct.kind === 'neonScale') o.direct = null;   // either hand letting go ends the resize
      ctx.saveNeonScale(); ctx.stage.save();
    }
    else if (g.kind === 'twoHand') {
      const o = g.R.a === st ? g.R.b : g.R.a;
      if (o.direct && o.direct.kind === 'twoHand') o.direct = null;   // either hand letting go ends the resize
      ctx.stage.save();
    }
  }

  function buzz(st, v = 0.35, ms = 25) {
    const a = st.source && st.source.gamepad && st.source.gamepad.hapticActuators && st.source.gamepad.hapticActuators[0];
    if (a && a.pulse) a.pulse(v, ms);
  }

  function updateAnchor(st) {
    if (st.isHand) st.anchor.position.copy(st.pinchPt); else st.grip.getWorldPosition(st.anchor.position);
    handQuat(st, st.anchor.quaternion);
    st.anchor.updateMatrixWorld();
  }

  // ---------------------------------------------------------------- pokes (fingertip / controller tip)
  function buttonList() {
    const out = [];
    const mc = ctx.mixer.userData.controls;
    for (const id of ['sync', 'splitcue', 'mic', 'A.cue', 'B.cue', 'A.beat1', 'B.beat1']) out.push({ g: mc[id], c: { mixer: true, id }, r: 0.013 });   // all centre buttons the same size now (#89)
    for (const d of ctx.decks) {
      const u = d.g.userData;
      out.push({ g: u.start, c: { deck: d.name, id: 'start' }, r: 0.022 });
      out.push({ g: u.b33, c: { deck: d.name, id: 'rpm33' }, r: 0.012 });
      out.push({ g: u.b45, c: { deck: d.name, id: 'rpm45' }, r: 0.012 });
      if (u.x2) out.push({ g: u.x2, c: { deck: d.name, id: 'x2' }, r: 0.01 });   // #253
      if (u.target) out.push({ g: u.target.grp, c: { deck: d.name, id: 'target' }, r: 0.016, top: () => u.target.headY - 0.006 });
    }
    return out;
  }
  let buttons = null;

  function pokes(st, T) {
    buttons = buttons || buttonList();
    let lift = 0;   // #282 how far the fingertip has sunk below a button cap (the 3D hand is drawn that much higher)
    for (const b of buttons) {
      if ((b.c.id === 'target' || b.c.id === 'rpm33' || b.c.id === 'rpm45' || b.c.id === 'x2' || b.c.id === 'start') && !st.isHand) continue;   // controllers: trigger (START / STOP: grip, #252) only, see grabStart
      b.g.getWorldPosition(v2); v2.y += b.top ? b.top() + 0.006 : 0.006;
      const h = T.y - v2.y, dxz = Math.hypot(T.x - v2.x, T.z - v2.z);
      if (dxz < b.r * 1.2 && h < -0.004 && h > -0.03) lift = Math.max(lift, -0.004 - h);   // cap top = 4 mm under the press line (tip on the cap, pressed in)
      const key = b;
      const armed = st.poke.get(key) !== false;
      if (dxz < b.r && h < 0.006 && h > -0.02) {
        if (armed) { ctx.pressControl(b.c, st); st.poke.set(key, false); buzz(st, 0.5, 30); }
        else if (b.c.id && b.c.id.endsWith('.beat1')) ctx.holdBeat1(ctx.decks[b.c.id[0] === 'A' ? 0 : 1], st);   // #117: still pressing (long press clears)
      }
      else if (h > 0.02 || dxz > b.r * 2) { if (!armed && b.c.id && b.c.id.endsWith('.beat1')) ctx.releaseBeat1(st); st.poke.set(key, true); }
    }
    st.pokeLift = (st.pokeLift || 0) + (Math.min(0.03, lift) - (st.pokeLift || 0)) * 0.5;
    // mixer readout (#116): poke the tempo number to cycle ORIG BPM / BPM / KEY
    {
      const ms = ctx.mixer.userData.screen, l = ms.worldToLocal(v2.copy(T));
      const sw = ms.geometry.parameters.width, sh = ms.geometry.parameters.height;
      const inside = Math.abs(l.x) < sw / 2 && Math.abs(l.y) < sh / 2, armed = st.poke.get(ms) !== false;
      if (inside && l.z < 0.006 && l.z > -0.015) { if (armed && ctx.mixScreenPress({ x: l.x / sw + 0.5, y: l.y / sh + 0.5 })) { st.poke.set(ms, false); buzz(st, 0.4, 20); } }
      else if (!inside || l.z > 0.02) { if (!armed && ctx.mixScreenRelease) ctx.mixScreenRelease(); st.poke.set(ms, true); }   // #222 fingertip off = end of a long press
    }
    // crate screen
    const scr = ctx.crate.userData.screen;
    const l = scr.worldToLocal(v2.copy(T));
    const sw = scr.geometry.parameters.width, sh = scr.geometry.parameters.height;
    const inside = Math.abs(l.x) < sw / 2 && Math.abs(l.y) < sh / 2;
    const armed = st.poke.get(scr) !== false;
    if (inside && l.z < 0.008 && l.z > -0.02 && ctx.crateLidOpen()) {
      if (armed) { ctx.crateScreenPress({ x: l.x / sw + 0.5, y: l.y / sh + 0.5 }); st.poke.set(scr, false); buzz(st, 0.4, 20); }
    } else if (!inside || l.z > 0.02) { if (!armed && ctx.crateScreenRelease) ctx.crateScreenRelease(); st.poke.set(scr, true); }   // #226 fingertip off = end of a long press
    // fingertip on the vinyl (hands): touch = hold, move = scratch, lift = let go
    // #282 (owner) controllers: the blue ball on the platter's edge nudges with no button (forward / back with the ball);
    // the record itself still needs the trigger
    if (!st.direct) {
      const ctl = !st.isHand;
      let touching = null, local = null;
      for (const d of ctx.decks) {
          const ll = d.g.worldToLocal(v2.copy(T));
        const r = Math.hypot(ll.x - ctx.DECK.spindle.x, ll.z - ctx.DECK.spindle.z);
        const h = ll.y - (d.g.userData.platterSurface + RD(d).THICK);
        const cur = st.scratch && st.scratch.deck === d;
        let on = false, rim = false;
        if (cur && st.scratch.nudge) on = rim = r > RD(d).R - 0.01 && r < PLATTER_R + 0.02 && h < 0.02 && h > -0.03;
        else if (cur) on = !ctl && h < 0.02 && r < RD(d).R + 0.01;
        else if (r > RD(d).R + 0.002 && r < PLATTER_R + 0.01 && h < 0.004 && h > -0.022) on = rim = true;   // side of the platter
        else if (d.record && !ctl) on = h < 0.008 && h > -0.015 && r > RD(d).LABEL + LO(RD(d)) && r < RD(d).R + 0.002;   // on the grooves (#104), to the very edge (#273)
        if (on) { touching = d; local = ll.clone(); local.rim = rim; break; }
      }
      if (touching) {
        const F = local.rim ? (ctl ? 0.35 + 1.65 * Math.max(0, Math.min(1, (PLATTER_R + 0.008 - rimR(touching, local)) / 0.012)) : rimForce(st, rimR(touching, local))) : undefined;   // #282 ball depth on the rim
        if (!st.scratch || st.scratch.deck !== touching) { if (st.scratch) ctx.scratchEnd(st.scratch); st.scratch = ctx.scratchBegin(touching, local, local.rim, F); buzz(st, 0.2, 15); }
        else ctx.scratchMove(st.scratch, local, F);
      } else if (st.scratch) { ctx.scratchEnd(st.scratch); st.scratch = null; }
    }
  }

  // #230 precise let-go for knobs, faders and pitch with bare hands. Tracking calls it a pinch until the fingers are
  // 3.2 cm apart, and the control used to follow the hand all the while they opened: hit and miss. Now the control
  // freezes as soon as the pinch opens 5 mm past its tightest, and rolls back ~60 ms (the slip already under way).
  // Close the pinch again (within 3 mm of the tightest) and it carries on from there without a jump.
  const CTL = { knob: 1, slider: 1, pitch: 1 };
  const ctlGet = g => g.kind === 'pitch' ? g.d.pitch : ctx.mixVal[g.id];
  const ctlPut = (g, v) => { if (g.kind === 'pitch') ctx.setPitch(g.d, v); else ctx.setMix(g.id, v); };
  function ctlLetGo(st, dd) {
    const g = st.direct; if (!g || !CTL[g.kind] || !st.pinching) return;
    const now = performance.now();
    if (!g.frozen) {
      g.hist.push({ t: now, v: ctlGet(g) }); while (g.hist.length && now - g.hist[0].t > 300) g.hist.shift();
      if (dd < g.dmin) g.dmin = dd;
      if (dd > g.dmin + 0.005) {
        g.frozen = true;
        let back = null; for (let i = g.hist.length - 1; i >= 0; i--) if (now - g.hist[i].t >= 60) { back = g.hist[i].v; break; }
        if (back != null) ctlPut(g, back);
      }
    } else if (dd < g.dmin + 0.003) {   // pinched again: carry on from here
      g.frozen = false; g.hist.length = 0; g.m0 = null;
    }
  }

  // ---------------------------------------------------------------- per-frame
  function update(dt) {
    for (const st of inputs) {
      if (!st.connected) continue;
      // tip + pinch points
      let hasTip = false;
      if (st.isHand) {
        const it = jointPos(st, 'index-finger-tip', st.tip), tt = jointPos(st, 'thumb-tip', v2);
        // #228 finger spin: the index finger's direction (knuckle to tip) and whether it is held out straight
        {
          const F = st.finger || (st.finger = { tip: new THREE.Vector3(), dir: new THREE.Vector3(), ok: false, st });
          const kn = it && jointPos(st, 'index-finger-phalanx-proximal', v1);
          F.ok = !!(kn && tt) && !st.pinching && st.tip.distanceTo(kn) > 0.055 && st.tip.distanceTo(tt) > 0.05;
          if (F.ok) { F.tip.copy(st.tip); F.dir.copy(st.tip).sub(kn).normalize(); }
        }
        if (it && tt) {
          hasTip = true;
          st.pinchPt.copy(st.tip).add(tt).multiplyScalar(0.5);
          const dd = st.tip.distanceTo(tt);
          ctlLetGo(st, dd);   // #230
          if (!st.pinching && dd < PINCH_ON) {
            st.pinching = true;
            grabStart(st, st.pinchPt);
          } else if (st.pinching && dd > PINCH_OFF) { st.pinching = false; release(st); }
        }
      } else {
        // tip just protruding from the controller's front edge (grip space: -z forward)
        st.grip.updateMatrixWorld();
        if (!st.tipLocal) st.tipLocal = measureTip(st.grip);
        const hl = ctlTipLocal(st);   // #280 / #283 3D hands: index fingertip, or the middle of the O while the grip is held
        st.grip.localToWorld(st.tip.copy(hl || st.tipLocal || TIP_DEFAULT));
        st.pinchPt.copy(st.tip); hasTip = true;
      }
      st.tipDot.visible = hasTip && !(st.isHand && handMode === 'real'); if (hasTip) st.tipDot.position.copy(st.tip);
      if (st.isHand) applyHandLook(st);
      ctlHandStep(st);   // #276
      updateOccluder(st);
      updateAnchor(st);

      if (st.direct) grabMove(st, st.isHand ? st.pinchPt : st.tip);
      else if (hasTip) pokes(st, st.tip);
      deckFeel(st, dt);

      // thumbstick: rotate / raise furniture while moving it, scroll the crate while the hand is at it
      const gp = st.source && st.source.gamepad;
      if (gp && gp.axes && gp.axes.length >= 4) {
        const ax = gp.axes[2], ay = gp.axes[3];
        const mv = (st.direct && st.direct.kind === 'move') ? st.direct : null;
        const pd = !mv && !st.isHand ? pitchFaderNear(st.tip) : null;
        if (pd) {
          // flick forward = -0.05 %, back = +0.05 % (flipped by the owner, 26 Sep: matches the fader, whose + end is
          // toward the DJ); hold to repeat
          const dir = ay < -0.7 ? -1 : ay > 0.7 ? 1 : 0;
          if (!dir) { st.flickArmed = true; st.flickT = 0; }
          else if (st.flickArmed) { ctx.nudgePitch(pd, dir * PITCH_STEP); buzz(st, 0.25, 12); st.flickArmed = false; st.flickT = 0.45; }
          else { st.flickT -= dt; if (st.flickT <= 0) { ctx.nudgePitch(pd, dir * PITCH_STEP); buzz(st, 0.15, 8); st.flickT = 0.08; } }
        } else if (mv) {
          const obj = ctx.MOVABLE[mv.target];
          if (Math.abs(ax) > 0.2) { obj.rotation.y -= ax * dt * 1.2; if (mv.yaw0 !== undefined) mv.yaw0 -= ax * dt * 1.2; }

        } else if (nearCrate(st.tip)) {
          st.scrollT -= dt;
          if (Math.abs(ay) > 0.5 && st.scrollT <= 0) { ctx.crateSelect(Math.sign(ay)); st.scrollT = 0.14; }
          if (Math.abs(ay) <= 0.5) st.scrollT = 0;
        }
      }
    }
  }

  // ---------------------------------------------------------------- hand look
  // 'real': the tracked hand mesh writes depth and transparent black, which punches a hole in the
  // virtual scene so the passthrough camera image of your actual hand shows through, in front of the
  // decks. '3d': a shaded skin-tone hand (always used in full VR).
  const OCCLUDER = new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending });
  const SKIN = new THREE.MeshStandardMaterial({ color: 0xbe8969,   // #269 owner: 5% darker (was 0xc8906f)
    roughness: 0.55, metalness: 0 });
  let handMode = '3d';
  function setHandMode(m) { handMode = m; for (const st of inputs) st.handMatFor = null; }
  function applyHandLook(st) {
    if (!st.handModel || st.handMatFor === handMode) return;
    let found = false;
    st.handModel.traverse(o => {
      if (!o.isMesh) return; found = true;
      o.material = SKIN; o.castShadow = false; o.frustumCulled = false;
    });
    st.handModel.visible = handMode !== 'real';   // real hands use the joint capsules below instead
    if (found) st.handMatFor = handMode; // the mesh arrives asynchronously; retry until it has
  }

  // #276 (owner) controller mode: a 3D hand holding each controller (DJ TOOLS > CONTROLLERS: 3D HANDS / CONTROLLER).
  // It is not a child of the grip (measureTip reads the grip's meshes), it copies the grip's pose each frame.
  let ctlLook = '3dhands';
  try { const v = localStorage.getItem('vire.ctlLook'); if (v === 'controller' || v === '3dhands') ctlLook = v; } catch (e) {}
  function setCtlLook(v) { ctlLook = v; try { localStorage.setItem('vire.ctlLook', v); } catch (e) {} }
  // #284 the ball / touch point is the index fingertip: relaxed with no button, the fingertip of the closed O while the
  // trigger or grip is held (a fixed point, so a held knob, fader or record never slips as the pressure varies)
  function ctlTipLocal(st) {
    const h = st.ctlHand; if (ctlLook !== '3dhands' || !h || !h.root.visible || !h.tipLive) return null;
    const gp = st.source && st.source.gamepad, b = gp ? gp.buttons : [];
    return (b[0] && b[0].pressed) || (b[1] && b[1].pressed) ? (h.tipO || h.tipLive) : h.tipLive;
  }
  function ctlHandStep(st) {
    const want = st.connected && !st.isHand && ctlLook === '3dhands' && st.source && (st.source.handedness === 'left' || st.source.handedness === 'right');
    // #279 (owner): 3D hands mode shows just the hand, no controller inside it
    const ctlModel = st.grip.children[0]; if (ctlModel) ctlModel.visible = !want;
    if (!want) { if (st.ctlHand) st.ctlHand.root.visible = false; return; }
    const hd = st.source.handedness;
    if (!st.ctlHand || st.ctlHand.handed !== hd) {
      if (st.ctlHand) scene.remove(st.ctlHand.root);
      st.ctlHand = createControllerHand(hd, PROF + '/generic-hand/' + hd + '.glb', SKIN); st.ctlHand.handed = hd;
      st.ctlHand.root.matrixAutoUpdate = false; scene.add(st.ctlHand.root);
    }
    const h = st.ctlHand; h.root.visible = true;
    st.grip.updateMatrixWorld(); h.root.matrix.copy(st.grip.matrixWorld);
    if (st.direct) st.pokeLift = 0;
    if (st.pokeLift > 0.0005) { h.root.matrix.elements[13] += st.pokeLift; st.tipDot.position.y += st.pokeLift; }   // #282 finger rests on the cap, not through it
    h.root.matrixWorldNeedsUpdate = true;
    const gp = st.source.gamepad, b = gp ? gp.buttons : [];
    const val = i => (b[i] ? (b[i].value || (b[i].pressed ? 1 : 0)) : 0);
    const thumb = [3, 4, 5].some(i => b[i] && (b[i].touched || b[i].pressed));
    // #284 buttons drive the pose as pressed / released, eased over ~80 ms (the analog value made the touch point wander)
    const ease = (k, on) => (st[k] = (st[k] || 0) + Math.max(-1, Math.min(1, ((on ? 1 : 0) - (st[k] || 0)))) * Math.min(1, 1 / 60 / 0.08 * 1.5));
    h.update(Math.round(ease('tA', b[0] && b[0].pressed) * 20) / 20, Math.round(ease('gA', b[1] && b[1].pressed) * 20) / 20, thumb);
  }

  // Passthrough cut-out built straight from the tracked joints (CLAUDE.md #44): a sphere on every joint
  // and a capsule along every bone, sized from each joint's measured radius. It fits your own hand,
  // and unlike the generic skinned hand it cannot twist or pinch when tracking is shaky.
  const FINGERS = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
  const CHAIN = f => f === 'thumb'
    ? ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']
    : ['wrist', `${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`];
  const SEGS = [];
  for (const f of FINGERS) { const c = CHAIN(f); for (let i = 0; i < c.length - 1; i++) SEGS.push([c[i], c[i + 1]]); }
  // palm webbing so the palm is solid
  for (const [a, b] of [['index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal'], ['middle-finger-phalanx-proximal', 'ring-finger-phalanx-proximal'],
    ['ring-finger-phalanx-proximal', 'pinky-finger-phalanx-proximal'], ['thumb-metacarpal', 'index-finger-metacarpal'], ['thumb-phalanx-proximal', 'index-finger-phalanx-proximal'],
    ['index-finger-metacarpal', 'middle-finger-metacarpal'], ['middle-finger-metacarpal', 'ring-finger-metacarpal'], ['ring-finger-metacarpal', 'pinky-finger-metacarpal'],
    ['wrist', 'middle-finger-phalanx-proximal'], ['wrist', 'ring-finger-phalanx-proximal'], ['index-finger-metacarpal', 'pinky-finger-phalanx-proximal'],
    ['pinky-finger-metacarpal', 'index-finger-phalanx-proximal']]) SEGS.push([a, b]);
  const JOINTS = ['wrist', ...FINGERS.flatMap(f => CHAIN(f).slice(1))];
  const GROW = 1.064, PAD = 0.001; // a touch larger than the real hand so no virtual edge crosses a finger
  const sphG = new THREE.SphereGeometry(1, 12, 8), cylG = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
  for (const st of inputs) {
    st.occS = new THREE.InstancedMesh(sphG, OCCLUDER, JOINTS.length);
    st.occC = new THREE.InstancedMesh(cylG, OCCLUDER, SEGS.length);
    for (const m of [st.occS, st.occC]) { m.renderOrder = -10; m.frustumCulled = false; m.visible = false; scene.add(m); }
  }
  const jp = {}, jr = {}, mtx = new THREE.Matrix4(), qq = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), dirV = new THREE.Vector3(), mid = new THREE.Vector3(), scl = new THREE.Vector3();
  function updateOccluder(st) {
    const on = st.isHand && handMode === 'real' && st.connected;
    st.occS.visible = st.occC.visible = false;
    if (!on || !st.hand.joints) return;
    for (const n of JOINTS) {
      const j = st.hand.joints[n]; if (!j || !j.visible) return;   // lost tracking: show nothing rather than a broken shape
      jp[n] = (jp[n] || new THREE.Vector3()); j.getWorldPosition(jp[n]);
      jr[n] = (j.jointRadius || 0.008) * GROW + PAD;
    }
    JOINTS.forEach((n, i) => { mtx.compose(jp[n], qq.identity(), scl.setScalar(jr[n])); st.occS.setMatrixAt(i, mtx); });
    SEGS.forEach(([a, b], i) => {
      dirV.subVectors(jp[b], jp[a]); const len = dirV.length() || 1e-4;
      mid.addVectors(jp[a], jp[b]).multiplyScalar(0.5);
      qq.setFromUnitVectors(up, dirV.multiplyScalar(1 / len));
      const r = Math.min(jr[a], jr[b]);
      mtx.compose(mid, qq, scl.set(r, len, r)); st.occC.setMatrixAt(i, mtx);
    });
    st.occS.instanceMatrix.needsUpdate = st.occC.instanceMatrix.needsUpdate = true;
    st.occS.visible = st.occC.visible = true;
  }

  function pitchFaderNear(P) {
    for (const d of ctx.decks) {
      const t = d.g.userData.pitchTravel; const l = d.g.worldToLocal(v2.copy(P));
      if (Math.abs(l.x - t.x) < 0.035 && l.z > t.z0 - 0.03 && l.z < t.z1 + 0.03 && l.y > 0.05 && l.y < 0.2) return d;
    }
    return null;
  }
  function nearCrate(P) {
    const cl = ctx.crate.worldToLocal(v2.copy(P)); const C = ctx.CRATE;
    return Math.abs(cl.x) < C.W / 2 + 0.12 && Math.abs(cl.z) < C.D / 2 + 0.15 && cl.y > -0.05 && cl.y < C.H + 0.35;
  }
  function end() { for (const st of inputs) release(st); }

  // #228 for the finger spin: each tracked hand's index finger, and every fingertip / controller tip (to flick the rim)
  const fingers = () => inputs.filter(st => st.connected && st.isHand && st.finger && st.finger.ok).map(st => st.finger);
  const tips = () => inputs.filter(st => st.connected).map(st => ({ st, p: st.tip, anchor: st.anchor, hand: st.isHand }));
  const buzzAnchor = (anchor, v, ms) => { const st = inputs.find(o => o.anchor === anchor); if (st) buzz(st, v, ms); };   // #243
  return { update, end, inputs, setHandMode, setCtlLook, getCtlLook: () => ctlLook, fingers, tips, buzz, buzzAnchor, _t: { grabStart, grabMove, release, pokes, updateAnchor } };
}
