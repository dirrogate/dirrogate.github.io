// Phone camera page (CLAUDE.md #158), spike: connects to the Quest by code, enters Chrome AR, shows the
// Quest's gear layout as outline boxes plus a live marker at the DJ's head, and reports link latency.
// Placement is rough (tap the floor under the middle of the DJ table, turn with the buttons); the real
// calibration (tape X + lens touch) comes next.
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
  else if (m.k === 'pong') { const now = performance.now(); stats.rtt = now - m.t; const off = m.qt - (m.t + now) / 2; stats.off = stats.off === null ? off : stats.off * 0.8 + off * 0.2; }
  else if (m.k === 's') {
    stats.pkts++; stats.xr = m.xr; stats.last = performance.now();
    if (stats.off !== null) stats.age = performance.now() + stats.off - m.t;
    head.position.set(m.h[0], m.h[1], m.h[2]); head.quaternion.set(m.h[3], m.h[4], m.h[5], m.h[6]); head.visible = true;
  }
}

// ---------------------------------------------------------------- AR session
let hitSource = null, placing = true, uiHidden = false, yaw = 0;
const ov = $('#ov');
$('#bar').addEventListener('beforexrselect', e => e.preventDefault());   // buttons don't also "tap the floor"
$('#bAR').onclick = async () => {
  ov.hidden = false;   // the overlay root must be displayable when the session starts
  try {
    const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: ov } });
    $('#start').style.display = 'none'; renderer.domElement.style.display = '';
    await renderer.xr.setSession(session);
    const viewer = await session.requestReferenceSpace('viewer');
    hitSource = await session.requestHitTestSource({ space: viewer });
    session.addEventListener('select', onTap);
    session.addEventListener('end', () => { hitSource = null; ov.hidden = true; $('#start').style.display = ''; renderer.domElement.style.display = 'none'; });
  } catch (e) { ov.hidden = true; st('Could not start AR: ' + e.message); }
};
function onTap() {
  if (uiHidden) { uiHidden = false; ov.classList.remove('hide'); return; }   // a tap brings the buttons back
  if (!placing || !reticle.visible) return;
  const p = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
  const c = new THREE.Vector3().setFromMatrixPosition(renderer.xr.getCamera().matrixWorld);
  const d = c.sub(p); d.y = 0; d.normalize();
  yaw = Math.atan2(-d.x, -d.z);   // the rig's front (-z, where the audience is) faces the phone
  place.position.copy(p); place.rotation.set(0, yaw, 0); place.visible = true;
  placing = false; reticle.visible = false; $('#hint').style.display = 'none';
}
$('#bL').onclick = () => { yaw += THREE.MathUtils.degToRad(5); place.rotation.y = yaw; };
$('#bR').onclick = () => { yaw -= THREE.MathUtils.degToRad(5); place.rotation.y = yaw; };
$('#bPlace').onclick = () => { placing = true; $('#hint').style.display = ''; };
$('#bHide').onclick = () => { uiHidden = true; ov.classList.add('hide'); };
$('#bExit').onclick = () => { const s = renderer.xr.getSession(); if (s) s.end(); };

let infoT = 0;
renderer.setAnimationLoop((t, frame) => {
  if (frame && hitSource && placing) {
    const hits = frame.getHitTestResults(hitSource);
    if (hits.length) { const pose = hits[0].getPose(renderer.xr.getReferenceSpace()); reticle.visible = true; reticle.matrix.fromArray(pose.transform.matrix); }
    else reticle.visible = false;
  }
  if (t - infoT > 250) {
    infoT = t;
    const live = link && link.isOpen, stale = performance.now() - stats.last > 1000;
    $('#info').textContent = live
      ? `Quest ${stats.xr ? 'in XR' : 'not in XR yet'} · round trip ${stats.rtt.toFixed(0)} ms · pose age ${stale ? 'no data' : stats.age.toFixed(0) + ' ms'} · ${stats.pps} packets/s`
      : 'Not connected to the Quest (' + (STATUS[linkState] || linkState || 'idle') + ')';
  }
  renderer.render(scene, camera);
});
window.spect = { stats, gear, head, place };   // debugging handle
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
