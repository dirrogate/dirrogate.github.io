// Phone camera page (CLAUDE.md #158, #160): connects to the Quest by code, enters Chrome AR, shows the
// Quest's gear layout as outline boxes plus a live marker at the DJ's head, and reports link latency.
// Placement: Calibrate (tape X tap + the DJ touching the lens and the X with the controller tip), Fix (re-tap
// the X after drift), or Rough place (tap the floor under the middle of the DJ table).
import * as THREE from 'three';
import { spectatorLink } from './net-link.js';

const $ = s => document.querySelector(s);
const DIMS = { // metres, W x H x D, and how far the object's origin sits above its feet (layout.js "base")
  deckA: [0.453, 0.10, 0.353, 0.018], deckB: [0.453, 0.10, 0.353, 0.018], mixer: [0.26, 0.10, 0.353, 0],
  crate: [0.36, 0.30, 0.34, 0], milk: [0.345, 0.28, 0.345, 0],
};
const COL = { deckA: 0x39a8ff, deckB: 0x39a8ff, mixer: 0xffc040, crate: 0x40d080, milk: 0x30b060, case: 0xb0b8c8 };

// ---------------------------------------------------------------- UI
let link = null, stats = { rtt: 0, off: null, pkts: 0, pps: 0, age: 0, last: 0, xr: 0 }, linkState = '';
try { $('#code').value = localStorage.getItem('vire.spectJoin') || ''; } catch {}
const st = t => { $('#st').textContent = t; };
const STATUS = { relay: 'Relay reached, calling the Quest…', 'relay-retry': 'No internet for the handshake, retrying…', 'quest-offline': 'Quest not found: is its Spectator camera On, same code?',
  connecting: 'Connecting to the Quest…', connected: 'Connected to the Quest', disconnected: 'Link lost', failed: 'Link failed (are both on the same Wi-Fi?)' };
$('#bConnect').onclick = () => {
  const code = $('#code').value.trim();
  if (!/^\d{5}$/.test(code)) { st('Enter the 5-digit code from the Quest'); return; }
  try { localStorage.setItem('vire.spectJoin', code); } catch {}
  if (link) link.close();
  st('Reaching the relay…');
  link = spectatorLink(code, {
    onStatus: s => { linkState = s; st(STATUS[s] || s); },
    onState: s => { linkState = s; st(STATUS[s] || s); },
    onOpen: () => { linkState = 'connected'; st(STATUS.connected); $('#bAR').disabled = false; },
    onClose: () => { linkState = 'disconnected'; st(STATUS.disconnected); },
    onMessage: onMsg,
  });
};
setInterval(() => { if (link && link.isOpen) link.send('ctl', { k: 'ping', t: performance.now() }); stats.pps = stats.pkts; stats.pkts = 0; }, 1000);

// ---------------------------------------------------------------- scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local');
document.body.appendChild(renderer.domElement); renderer.domElement.style.display = 'none';
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.02, 50);
scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.2));
const place = new THREE.Group(); place.visible = false; scene.add(place);   // the DJ rig, positioned on the phone's floor
const gear = new THREE.Group(); place.add(gear);
const head = new THREE.Group(); place.add(head); head.visible = false;
{
  const m = new THREE.MeshBasicMaterial({ color: 0xff3050, wireframe: true, transparent: true, opacity: 0.7 });
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), m));
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 8), new THREE.MeshBasicMaterial({ color: 0xff3050 }));
  nose.rotation.x = -Math.PI / 2; nose.position.z = -0.16; head.add(nose);   // points where the DJ looks
}
const reticle = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x39a8ff }));
reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);

function box(w, h, d, color) {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0);   // origin at the feet
  const o = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.35, roughness: 0.6, depthWrite: false }));
  o.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color })));
  return o;
}
function buildLayout(L) {
  gear.clear();
  for (const k in L.cases || {}) { const v = L.cases[k]; const b = box(v[4], v[6], v[5], COL.case); b.position.set(v[0], v[1], v[2]); b.rotation.y = v[3]; gear.add(b); }
  for (const k in L.items || {}) {
    const v = L.items[k], key = k.startsWith('milk') ? 'milk' : k, d = DIMS[key]; if (!d) continue;   // neon sign left out for now
    const b = box(d[0], d[1], d[2], COL[key]); b.position.set(v[0], v[1] - d[3], v[2]); b.rotation.y = v[3]; gear.add(b);
  }
}
function onMsg(m) {
  if (m.k === 'layout') buildLayout(m.layout);
  else if (m.k === 'calpt') onCalPoint(m);
  else if (m.k === 'pong') { const now = performance.now(); stats.rtt = now - m.t; const off = m.qt - (m.t + now) / 2; stats.off = stats.off === null ? off : stats.off * 0.8 + off * 0.2; }
  else if (m.k === 's') {
    stats.pkts++; stats.xr = m.xr; stats.last = performance.now();
    if (stats.off !== null) stats.age = performance.now() + stats.off - m.t;
    head.position.set(m.h[0], m.h[1], m.h[2]); head.quaternion.set(m.h[3], m.h[4], m.h[5], m.h[6]);
  }
}

// ---------------------------------------------------------------- AR session, placement, calibration
// Calibration (#160): two points known to both devices. The phone marks the tape X by a tap (hit test on
// the floor) and knows where its own lens is; the Quest touches the lens and then the X with the controller
// tip. Gravity is shared, so a yaw + offset maps the DJ rig onto the phone's floor:
//   phone = R(yaw) * rig + t,   yaw from the X->lens direction on both sides,   t from the X.
const Y = new THREE.Vector3(0, 1, 0);
let hitSource = null, touchSource = null, lastTouch = null, mode = 'find', uiHidden = false, yaw = 0;
const cal = { Xp: null, Lp: null, Xq: null, Lq: null, ok: false, err: null };
const poseLog = [];                        // [phone time, lens position] for the last 3 s
const ov = $('#ov'), hint = $('#hint');
const xMark = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.065, 4).rotateX(-Math.PI / 2).rotateY(Math.PI / 4), new THREE.MeshBasicMaterial({ color: 0x00e0ff }));
xMark.visible = false; scene.add(xMark);
$('#bar').addEventListener('beforexrselect', e => e.preventDefault());   // buttons don't also "tap the floor"

const HINTS = {
  find: 'Move the phone slowly until the floor is found (a blue ring appears). Then press Calibrate (or Rough place).',
  place: 'Tap the floor under the middle of the DJ table.',
  calX: 'Calibrate 1/3: tap the tape X on the screen.',
  calLens: 'Calibrate 2/3 (DJ): touch this phone\'s back camera lens with the controller tip, pull the trigger. Keep the phone still.',
  calQX: 'Calibrate 3/3 (DJ): touch the tape X with the controller tip, pull the trigger.',
  fix: 'Fix: tap the tape X on the screen again.',
};
function setMode(m, text) {
  mode = m; hint.textContent = text || HINTS[m] || ''; hint.style.display = (m === 'live' && !text) ? 'none' : '';
  hint.classList.toggle('go', m !== 'live' && m !== 'find');
  if (text && m === 'live') setTimeout(() => { if (mode === 'live') hint.style.display = 'none'; }, 5000);
}
const needLink = () => { if (link && link.isOpen) return true; setMode(mode, 'Not connected to the Quest: go back and Connect first.'); return false; };

$('#bAR').onclick = async () => {
  ov.hidden = false;   // the overlay root must be displayable when the session starts
  try {
    const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: ov } });
    $('#start').style.display = 'none'; renderer.domElement.style.display = '';
    await renderer.xr.setSession(session);
    const viewer = await session.requestReferenceSpace('viewer');
    hitSource = await session.requestHitTestSource({ space: viewer });
    touchSource = await session.requestHitTestSourceForTransientInput({ profile: 'generic-touchscreen' }).catch(() => null);
    session.addEventListener('select', onTap);
    session.addEventListener('end', () => { hitSource = touchSource = null; ov.hidden = true; $('#start').style.display = ''; renderer.domElement.style.display = 'none'; if (link && link.isOpen) link.send('ctl', { k: 'cal', step: 'cancel' }); });
    setMode(cal.ok ? 'live' : 'find');
  } catch (e) { ov.hidden = true; st('Could not start AR: ' + e.message); }
};

// where the finger touched the floor (falls back to the centre ring)
function tapPoint() {
  if (lastTouch && performance.now() - lastTouch.t < 600) return lastTouch.p.clone();
  return reticle.visible ? new THREE.Vector3().setFromMatrixPosition(reticle.matrix) : null;
}
function lensNow() { return new THREE.Vector3().setFromMatrixPosition(renderer.xr.getCamera().matrixWorld); }
function lensAt(phoneT) { // lens position at a past moment (the DJ pulled the trigger a few ms before we heard)
  let best = null, bd = 1e9; for (const e of poseLog) { const d = Math.abs(e[0] - phoneT); if (d < bd) { bd = d; best = e[1]; } }
  return best && bd < 400 ? best.clone() : lensNow();
}

function onTap() {
  if (uiHidden) { uiHidden = false; ov.classList.remove('hide'); return; }   // a tap brings the buttons back
  const p = tapPoint();
  if (mode === 'place' && p) {
    const d = lensNow().sub(p); d.y = 0; d.normalize();
    yaw = Math.atan2(-d.x, -d.z);   // rough: the rig's front (-z, where the audience is) faces the phone
    place.position.copy(p); place.rotation.set(0, yaw, 0); place.visible = true; cal.ok = false;
    setMode('live', 'Roughly placed. Calibrate for an exact fit.');
  } else if (mode === 'calX' && p) {
    cal.Xp = p; xMark.position.copy(p); xMark.visible = true;
    if (!needLink()) return;
    link.send('ctl', { k: 'cal', step: 'lens' }); setMode('calLens');
  } else if (mode === 'fix' && p) {
    cal.Xp = p; xMark.position.copy(p); xMark.visible = true; solve(true);
    setMode('live', 'Fixed: position re-aligned on the X.');
  }
}
function onCalPoint(m) {
  const q = new THREE.Vector3().fromArray(m.p);
  if (m.step === 'lens' && mode === 'calLens') {
    cal.Lq = q; cal.Lp = lensAt(stats.off === null ? performance.now() : m.qt - stats.off);
    link.send('ctl', { k: 'cal', step: 'x' }); setMode('calQX');
  } else if (m.step === 'x' && mode === 'calQX') {
    cal.Xq = q; solve(false);
    link.send('ctl', { k: 'cal', step: 'done', err: cal.err });
    setMode('live', `Calibrated. Distances match within ${cal.err} cm` + (cal.err > 5 ? ' (high: try again, touch the lens centre and the X centre).' : '.'));
  }
}
const ang = v => Math.atan2(-v.z, v.x);    // heading of a flat vector, same sense as a rotation about +Y
function solve(keepYaw) {
  if (!keepYaw) {
    const vq = cal.Lq.clone().sub(cal.Xq); vq.y = 0; const vp = cal.Lp.clone().sub(cal.Xp); vp.y = 0;
    yaw = ang(vp) - ang(vq);
    const dq = cal.Lq.distanceTo(cal.Xq), dp = cal.Lp.distanceTo(cal.Xp);
    cal.err = Math.round(Math.abs(dq - dp) * 1000) / 10;   // cm: both devices should agree on the X-to-lens distance
  }
  const R = new THREE.Quaternion().setFromAxisAngle(Y, yaw);
  place.position.copy(cal.Xp).sub(cal.Xq.clone().applyQuaternion(R));
  place.rotation.set(0, yaw, 0); place.visible = true; cal.ok = true;
}
function turn(deg) { // turn about the X once calibrated (it is the pinned point), else about the placement point
  const d = THREE.MathUtils.degToRad(deg), pivot = cal.ok ? cal.Xp : place.position.clone();
  const R = new THREE.Quaternion().setFromAxisAngle(Y, d);
  place.position.sub(pivot).applyQuaternion(R).add(pivot); yaw += d; place.rotation.y = yaw;
}
$('#bCal').onclick = () => { if (!needLink()) return; setMode('calX'); };
$('#bFix').onclick = () => { if (!cal.Xq) { setMode(mode, 'Calibrate once first; Fix re-uses it.'); return; } setMode('fix'); };
$('#bL').onclick = () => turn(1);
$('#bR').onclick = () => turn(-1);
$('#bPlace').onclick = () => setMode('place');
$('#bMark').onclick = () => { showHead = !showHead; $('#bMark').classList.toggle('on', showHead); };
$('#bHide').onclick = () => { uiHidden = true; ov.classList.add('hide'); };
$('#bExit').onclick = () => { const s = renderer.xr.getSession(); if (s) s.end(); };
let showHead = true; $('#bMark').classList.add('on');

let infoT = 0, camT = 0;
const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _inv = new THREE.Matrix4(), _m = new THREE.Matrix4();
renderer.setAnimationLoop((t, frame) => {
  if (frame) {
    const now = performance.now();
    poseLog.push([now, lensNow()]); while (poseLog.length && now - poseLog[0][0] > 3000) poseLog.shift();
    const ref = renderer.xr.getReferenceSpace();
    if (hitSource) {
      const hits = frame.getHitTestResults(hitSource);
      const show = mode !== 'live';
      if (hits.length && show) { reticle.visible = true; reticle.matrix.fromArray(hits[0].getPose(ref).transform.matrix); }
      else reticle.visible = false;
      if (mode === 'find' && hits.length && !hint.dataset.found) { hint.dataset.found = 1; setMode('find', 'Floor found. Press Calibrate (or Rough place).'); }
    }
    if (touchSource) for (const r of frame.getHitTestResultsForTransientInput(touchSource))
      if (r.results.length) lastTouch = { t: now, p: new THREE.Vector3().setFromMatrixPosition(_m.fromArray(r.results[0].getPose(ref).transform.matrix)) };
    // once calibrated, tell the Quest where this camera is and how wide it sees (5x a second)
    if (cal.ok && link && link.isOpen && t - camT > 200) {
      camT = t; const xc = renderer.xr.getCamera(), c0 = xc.cameras && xc.cameras[0];
      if (c0) {
        place.updateMatrixWorld(); _m.multiplyMatrices(_inv.copy(place.matrixWorld).invert(), xc.matrixWorld); _m.decompose(_p, _q, _s);
        const P = c0.projectionMatrix.elements, fov = 2 * Math.atan(1 / P[5]), asp = P[5] / P[0];
        link.send('state', { k: 'cam', p: _p.toArray().map(v => Math.round(v * 1000) / 1000), q: _q.toArray().map(v => Math.round(v * 10000) / 10000), fov, asp });
      }
    }
  }
  head.visible = showHead && performance.now() - stats.last < 1000;
  if (t - infoT > 250) {
    infoT = t;
    const live = link && link.isOpen, stale = performance.now() - stats.last > 1000;
    $('#info').textContent = live
      ? `Quest ${stats.xr ? 'in XR' : 'not in XR yet'} · round trip ${stats.rtt.toFixed(0)} ms · pose age ${stale ? 'no data' : stats.age.toFixed(0) + ' ms'} · ${stats.pps}/s` + (cal.ok ? ` · cal ${cal.err ?? '-'} cm` : ' · not calibrated')
      : 'Not connected to the Quest (' + (STATUS[linkState] || linkState || 'idle') + ')';
  }
  renderer.render(scene, camera);
});
window.spect = { stats, gear, head, place, cal, solve, _set: v => Object.assign(cal, v), get link() { return link; } };   // debugging handle
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
