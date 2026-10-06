// SpatialED #11 student page: joins the professor's class by code, then draws the lesson the professor plays.
// Everything in a lesson is a pure function of the playhead t, so the student device only needs the side, t, its
// speed and the professor's size and turn (classroom.js packet); it runs its own clock between packets.
// ARCore phones: View in AR, point at the floor or a table, tap to place. Other devices: an orbit view.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';
import { LessonPlayer } from './lesson.js';
import { studentLink } from './net-link.js';

const $ = s => document.querySelector(s);
const STORE = 'sed.student';

// ---------------------------------------------------------------- scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const BG = new THREE.Color(0x0b0d12); scene.background = BG;
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(2, 4, 3); scene.add(sun);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 100);
camera.position.set(0, 1.6, 3.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.8, 0); controls.enableDamping = true; controls.update();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const anchor = new THREE.Group(); scene.add(anchor);   // where the lesson stands (AR: where the student tapped)
const lesson = new LessonPlayer(anchor);
lesson.onStatus = t => { last.msg = t; };

const reticle = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.09, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x39d0ff }));
reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);

// ---------------------------------------------------------------- the professor's lesson, with our own clock
const last = { u: null, t: 0, r: 0, s: 1, y: 0, l: null, nd: 1, h: 1, at: 0, hs: -1, msg: '' };
let tShown = 0, framed = 0, link = null, joined = false;
function onPacket(m) {
  if (!m || m.k !== 'les') return;
  if (m.hs != null && m.hs < last.hs && m.u === last.u) return;   // an older packet arriving late
  Object.assign(last, { u: m.u, t: m.t || 0, r: m.r || 0, s: m.s || 1, y: m.y || 0, l: m.l || null, mo: m.mo || null, nd: m.nd == null ? 1 : m.nd, h: m.h == null ? 1 : m.h, at: performance.now(), hs: m.hs != null ? m.hs : last.hs });
}
function tNow() { return last.t + last.r * Math.min(1.5, (performance.now() - last.at) / 1000); }   // coast at most 1.5 s

// ---------------------------------------------------------------- join
try { const s = JSON.parse(localStorage.getItem(STORE) || '{}'); if (s.code) $('#code').value = s.code; if (s.name) $('#name').value = s.name; } catch {}
const q = new URLSearchParams(location.search); if (q.get('code')) $('#code').value = q.get('code').replace(/\D/g, '').slice(0, 4);
$('#go').onclick = () => {
  const code = $('#code').value.replace(/\D/g, ''), name = $('#name').value.trim() || 'Student';
  if (code.length !== 4) { $('#jmsg').textContent = 'The class code has 4 digits.'; return; }
  try { localStorage.setItem(STORE, JSON.stringify({ code, name })); } catch {}
  join(code, name);
};
function join(code, name) {
  $('#join').classList.add('hidden'); $('#bar').classList.remove('hidden');
  say(`Calling class <b>${code}</b>…`);
  if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
  link = studentLink(code, {
    onStatus: s => {
      if (s === 'relay') say(`Calling class <b>${code}</b>…`);
      else if (s === 'relay-retry') say('Reaching the handshake service… (needs internet for a moment)');
      else if (s === 'no-class') say(`No answer from class <b>${code}</b>. Check the code and that the professor pressed START on the tablet's CLASS page. Same Wi-Fi?`);
      else if (/^error/.test(s)) say('Connection error: ' + s.slice(7));
    },
    onOpen: () => { joined = true; link.send('ctl', { k: 'hello', name }); say('Connected. Waiting for the professor to play a lesson…'); },
    onMessage: m => onPacket(m),
    onClose: () => { joined = false; say('The class link closed. Tap Leave and join again.'); },
  });
}
$('#leaveBtn').onclick = () => { if (renderer.xr.isPresenting) renderer.xr.getSession().end(); if (link) link.close(); location.reload(); };
function say(html) { $('#status').innerHTML = html; }

// ---------------------------------------------------------------- AR (ARCore phones)
let hitSource = null, placed = false;
if (navigator.xr) navigator.xr.isSessionSupported('immersive-ar').then(ok => { if (ok) $('#arBtn').classList.remove('hidden'); }).catch(() => {});
$('#ov').addEventListener('beforexrselect', e => e.preventDefault());   // taps on the buttons don't place the lesson
$('#arBtn').onclick = async () => {
  try {
    const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: $('#ov') } });
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);
    hitSource = await session.requestHitTestSource({ space: await session.requestReferenceSpace('viewer') });
    scene.background = null; controls.enabled = false; placed = false; anchor.visible = false;
    $('#arBtn').classList.add('hidden'); $('#exitBtn').classList.remove('hidden'); $('#placeBtn').classList.remove('hidden'); $('#hint').style.display = 'block';
    session.addEventListener('select', place);
    session.addEventListener('end', () => {
      hitSource = null; reticle.visible = false; scene.background = BG; controls.enabled = true; anchor.position.set(0, 0, 0); anchor.rotation.set(0, 0, 0); anchor.visible = true; framed = 0;
      $('#arBtn').classList.remove('hidden'); $('#exitBtn').classList.add('hidden'); $('#placeBtn').classList.add('hidden'); $('#hint').style.display = 'none';
    });
  } catch (e) { say('AR could not start: ' + e.message); }
};
$('#exitBtn').onclick = () => { const s = renderer.xr.getSession(); if (s) s.end(); };
$('#placeBtn').onclick = () => { placed = false; anchor.visible = false; $('#hint').style.display = 'block'; };
const _p = new THREE.Vector3(), _c = new THREE.Vector3();
function place() {
  if (placed || !reticle.visible) return;
  _p.setFromMatrixPosition(reticle.matrix); anchor.position.copy(_p);
  renderer.xr.getCamera().getWorldPosition(_c);
  anchor.rotation.set(0, Math.atan2(_c.x - _p.x, _c.z - _p.z), 0);   // the lesson's front (+z) toward the student
  placed = true; anchor.visible = true; reticle.visible = false; $('#hint').style.display = 'none';
}

// ---------------------------------------------------------------- frame
let lastLine = '';
renderer.setAnimationLoop((ts, frame) => {
  if (frame && hitSource && !placed) {
    const hits = frame.getHitTestResults(hitSource);
    if (hits.length) { const pose = hits[0].getPose(renderer.xr.getReferenceSpace()); reticle.visible = !!pose; if (pose) reticle.matrix.fromArray(pose.transform.matrix); }
    else reticle.visible = false;
  }
  // our clock: follow the estimate, snap on jumps (needle drop, scratch), glide on small drift
  const te = tNow(), d = te - tShown;
  tShown = Math.abs(d) > 0.25 ? te : tShown + d * 0.3;
  const L = last.u ? lesson.remote(last.u, tShown, last.s, last.y, last.l, !!last.nd, last.h, last.mo) : lesson.show(null);
  if (L && !renderer.xr.isPresenting) frame3(L);
  if (joined) {
    const stale = performance.now() - last.at > 2500;
    const line = !last.u ? 'Connected. Waiting for the professor to play a lesson…'
      : !L ? `Loading the lesson… ${last.msg}`
      : `<b>${L.title}</b> · ${L.chapter >= 0 ? `Chapter ${L.chapter + 1}: ${L.chapters[L.chapter].title}` : 'start'}${stale ? ' · (no signal)' : ''}`;
    if (line !== lastLine) { lastLine = line; say(line); }
  }
  controls.update();
  renderer.render(scene, camera);
});
// orbit view: frame the lesson whenever its size changes a lot (diorama on the deck <-> life size)
function frame3(L) {
  const s = last.s || 1; if (framed && Math.abs(Math.log(s / framed)) < 0.3) return;
  framed = s; const R = L.radius * s, H = L.height * s;
  controls.target.set(0, H * 0.4, 0);
  camera.position.set(0, H * 0.4 + R * 1.2, R * 2.6); camera.near = Math.max(0.005, R * 0.02); camera.updateProjectionMatrix();
}
window.__student = { lesson, last, onPacket };   // for testing in a desktop browser
