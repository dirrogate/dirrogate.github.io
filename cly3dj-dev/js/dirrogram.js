// Dirrogram (audience-ar-plan.md, Mode 1 "Hologram"), Phase A: the page on its own, no relay, no Quest.
// The audience's phone camera picture with the Cly3DJ show drawn over it: the robot DJ behind its own decks, the
// hologram scroller in front of the booth, the LED wall behind and above (fractal, promo cards, NOW SPINNING) and
// the laser under the wall, all placed by one "point at the centre DJ and tap AIM" from the phone's gyroscope.
// Stage frame (metres): origin on the stage floor under the centre DJ, +x to the audience's right, +z toward the
// audience. The robot copies the owner when live poses arrive (feedPose, the #278 'av' message; Phase B relay), with
// its own beat bobbing mixed in; with nothing live it dances on its own.
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';
import { RobotAvatar2, ROBOT_GLB } from './robot2.js';
import { AV_LAYER } from './director.js';
import { Laser } from './laser.js';
import { initMaterials, makeMixer, loadMixerParts, DECK, MIX } from './models.js';
import { loadDeckTemplate, makeGlbDeck } from './deck-glb.js';

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- settings (per phone)
const KEY = 'dirro.set';
const DEF = { dist: 6, robotX: -2.3, robotZ: 0, lift: 0, fov: 64, bpm: 124,
  scroll: 'WELCOME TO THE DIRROGRAM  ✦  CLY3DJ LIVE ON VINYL  ✦  TWITCH.TV/DIRROGATE  ✦  FILM IT, SHARE IT  ✦', np: 'Cly3DJ · live vinyl set' };
const S = Object.assign({}, DEF);
try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
if (Q.get('np')) S.np = Q.get('np');
if (Q.get('scroll')) S.scroll = Q.get('scroll');
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

// ---------------------------------------------------------------- renderer, scenes
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
renderer.autoClear = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 80);
camera.layers.enable(AV_LAYER);   // the robot lives on the avatar layer
scene.add(camera);
{ const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.55; }
scene.add(new THREE.HemisphereLight(0x8899ff, 0x201018, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(2, 5, 6); scene.add(key);

// camera picture: a full-screen quad drawn first (raw sRGB through, no tone mapping), cover-cropped
const bgScene = new THREE.Scene(), bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const bgMat = new THREE.ShaderMaterial({
  uniforms: { uTex: { value: null }, uK: { value: new THREE.Vector2(1, 1) }, uOn: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D uTex; uniform vec2 uK; uniform float uOn; varying vec2 vUv; void main(){ vec2 uv = 0.5 + (vUv - 0.5) * uK; gl_FragColor = uOn > 0.5 ? vec4(texture2D(uTex, uv).rgb, 1.0) : vec4(0.02, 0.02, 0.035, 1.0); }',
  depthTest: false, depthWrite: false,
});
bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat));
let src = null;   // { tex, w, h }

// ---------------------------------------------------------------- the stage
const stage = new THREE.Group(); stage.name = 'stage'; scene.add(stage); stage.visible = false;
const ANCHOR = V(0, 1.3, 0);   // what the AIM ring points at: the centre DJ's chest

// LED wall: behind and above the DJs. Fractal / promo card / NOW SPINNING band, on an LED pixel grid.
const WALL = { w: 4.8, h: 2.7, y: 3.25, z: -1.6 };
const capCv = document.createElement('canvas'); capCv.width = 1024; capCv.height = 128;
const capTex = new THREE.CanvasTexture(capCv); capTex.colorSpace = THREE.SRGBColorSpace;
function drawCaption() {
  const g = capCv.getContext('2d'); g.clearRect(0, 0, 1024, 128);
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, 1024, 128);
  g.fillStyle = '#ff2a3c'; g.font = '800 30px system-ui, sans-serif'; g.textBaseline = 'middle'; g.fillText('NOW SPINNING', 36, 40);
  g.fillStyle = '#ffffff'; let fs = 52; g.font = `700 ${fs}px system-ui, sans-serif`;
  while (g.measureText(S.np).width > 950 && fs > 24) { fs -= 2; g.font = `700 ${fs}px system-ui, sans-serif`; }
  g.fillText(S.np, 36, 88); capTex.needsUpdate = true;
}
const promoCv = document.createElement('canvas'); promoCv.width = 512; promoCv.height = 288;
const promoTex = new THREE.CanvasTexture(promoCv); promoTex.colorSpace = THREE.SRGBColorSpace;
function drawPromo() {   // the built-in card; promo JPGs from a list come with Phase B (the Quest names them)
  const g = promoCv.getContext('2d'), W = 512, H = 288;
  const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#12051f'); gr.addColorStop(1, '#2a0610'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 112px system-ui, sans-serif';
  const a = g.measureText('CLY').width, b = g.measureText('3DJ').width, x0 = W / 2 - (a + b) / 2;
  g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.fillText('CLY', x0, 120); g.fillStyle = '#ff2a3c'; g.fillText('3DJ', x0 + a, 120);
  g.textAlign = 'center'; g.fillStyle = '#39e6ff'; g.font = '700 30px system-ui, sans-serif'; g.fillText('LIVE ON VINYL', W / 2, 200);
  g.fillStyle = '#ffffff'; g.font = '600 24px system-ui, sans-serif'; g.fillText('twitch.tv/dirrogate', W / 2, 246);
  promoTex.needsUpdate = true;
}
const wallMat = new THREE.ShaderMaterial({
  uniforms: { uT: { value: 0 }, uKick: { value: 0 }, uMix: { value: 0 }, uCap: { value: 0 }, uImg: { value: promoTex }, uCapTex: { value: capTex }, uGrid: { value: new THREE.Vector2(160, 90) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform float uT, uKick, uMix, uCap; uniform sampler2D uImg, uCapTex; uniform vec2 uGrid; varying vec2 vUv;
vec3 pal(float t) { return 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + t)); }
vec3 fractal(vec2 uv) {
  vec2 z = (uv - 0.5) * vec2(3.2, 1.8) / (1.0 + 0.12 * uKick);
  float a = uT * 0.11; vec2 c = 0.7885 * vec2(cos(a), sin(a)); float n = 0.0;
  for (int k = 0; k < 40; k++) { z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c; if (dot(z, z) > 16.0) break; n += 1.0; }
  float s = n / 40.0; return pal(s * 1.6 + uT * 0.05) * pow(s, 0.55) * (0.75 + 0.6 * uKick);
}
void main() {
  vec2 g = vUv * uGrid, cell = (floor(g) + 0.5) / uGrid, f = fract(g);
  vec3 col = mix(fractal(cell), texture2D(uImg, cell).rgb, uMix);
  float band = step(cell.y, 0.2) * uCap;
  vec4 cp = texture2D(uCapTex, vec2(cell.x, cell.y / 0.2));
  col = mix(col, col * 0.3, band); col = mix(col, cp.rgb, cp.a * band * step(0.0, 0.2 - cell.y));
  float led = smoothstep(0.0, 0.22, f.x) * smoothstep(1.0, 0.78, f.x) * smoothstep(0.0, 0.22, f.y) * smoothstep(1.0, 0.78, f.y);
  gl_FragColor = vec4(col * (0.18 + 1.05 * led) * 1.25, 1.0);
}`,
  toneMapped: false,
});
const wall = new THREE.Group(); wall.position.set(0, WALL.y, WALL.z); stage.add(wall);
{
  const screenM = new THREE.Mesh(new THREE.PlaneGeometry(WALL.w, WALL.h), wallMat); wall.add(screenM);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(WALL.w + 0.12, WALL.h + 0.12, 0.12), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.5, metalness: 0.6 }));
  frame.position.z = -0.065; wall.add(frame);
}

// hologram scroller: in front of the booth, floating at chest height
const SCR = { w: 3.4, h: 0.3, y: 1.15, z: 1.3 };   // under the DJs' faces
const scrCv = document.createElement('canvas'); scrCv.height = 128;
const scrTex = new THREE.CanvasTexture(scrCv); scrTex.wrapS = THREE.RepeatWrapping; scrTex.colorSpace = THREE.NoColorSpace;
const scrMat = new THREE.ShaderMaterial({
  uniforms: { uTex: { value: scrTex }, uT: { value: 0 }, uOff: { value: 0 }, uRep: { value: 1 }, uKick: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D uTex; uniform float uT, uOff, uRep, uKick; varying vec2 vUv;
void main() {
  vec2 uv = vec2(vUv.x * uRep + uOff, vUv.y); float dx = 0.0025 * uRep;
  float m = texture2D(uTex, uv).r, mr = texture2D(uTex, uv + vec2(dx, 0.0)).r, mb = texture2D(uTex, uv - vec2(dx, 0.0)).r;
  float scan = 0.72 + 0.28 * sin(vUv.y * 90.0 - uT * 9.0);
  float flick = 0.9 + 0.1 * sin(uT * 37.0) * sin(uT * 13.0);
  float edge = smoothstep(0.0, 0.07, vUv.x) * smoothstep(1.0, 0.93, vUv.x);
  vec3 c = vec3(0.25, 0.9, 1.0) * m + vec3(1.0, 0.1, 0.6) * max(mr - m, 0.0) * 0.8 + vec3(0.2, 0.4, 1.0) * max(mb - m, 0.0) * 0.8;
  c += vec3(0.05, 0.25, 0.4) * 0.12 * smoothstep(0.0, 0.5, 1.0 - abs(vUv.y - 0.5) * 2.0);   // faint light sheet behind the letters
  gl_FragColor = vec4(c * scan * flick * edge * (1.1 + 0.4 * uKick), 1.0);   // additive blend multiplies by alpha
}`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
});
const scroller = new THREE.Group(); scroller.position.set(0, SCR.y, SCR.z); stage.add(scroller);
scroller.add(new THREE.Mesh(new THREE.PlaneGeometry(SCR.w, SCR.h), scrMat));
{   // the projector line under it
  const lm = new THREE.MeshBasicMaterial({ color: 0x39e6ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(SCR.w * 0.9, 0.012), lm); line.position.y = -SCR.h / 2 - 0.05; scroller.add(line);
}
function drawScroller() {
  const g = scrCv.getContext('2d'); let fs = 88; g.font = `800 ${fs}px system-ui, sans-serif`;
  const txt = S.scroll + '      ';
  let w = Math.ceil(g.measureText(txt).width);
  if (w > 4096) { fs = Math.floor(fs * 4096 / w); w = 4096; }
  scrCv.width = w; g.font = `800 ${fs}px system-ui, sans-serif`;   // resizing clears and resets the context
  g.fillStyle = '#000'; g.fillRect(0, 0, w, 128); g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(txt, 0, 66);
  scrTex.needsUpdate = true;
  scrMat.uniforms.uRep.value = (SCR.w / SCR.h) / (w / 128);
}

// the robot's booth: a flight-case table, two turntables (spinning, records on) and the mixer, all facing the robot
const booth = new THREE.Group(); booth.name = 'booth'; stage.add(booth);
const robotRoot = new THREE.Group(); booth.add(robotRoot);
const gear = new THREE.Group(); gear.rotation.y = Math.PI; booth.add(gear);   // Cly3DJ gear faces a DJ looking down -z; the robot looks down +z
const TABLE = { h: 0.92, d: 0.5, z: 0.48 };
const decks = [];
async function buildBooth() {
  const DECK_X = MIX.W / 2 + DECK.W / 2 + 0.012, tw = 2 * DECK.W + MIX.W + 0.12;
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.55, metalness: 0.4 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.3, metalness: 1 });
  const table = new THREE.Mesh(new THREE.BoxGeometry(tw, TABLE.h, TABLE.d), caseMat); table.position.set(0, TABLE.h / 2, TABLE.z); booth.add(table);
  for (const y of [TABLE.h - 0.01, 0.01]) { const e = new THREE.Mesh(new THREE.BoxGeometry(tw + 0.01, 0.02, TABLE.d + 0.01), alu); e.position.set(0, y, TABLE.z); booth.add(e); }
  gear.position.set(0, TABLE.h, TABLE.z);
  initMaterials();
  try {
    await loadDeckTemplate('models/turntable.glb');
    for (const [nm, x] of [['A', -DECK_X], ['B', DECK_X]]) {
      const d = makeGlbDeck(nm); d.position.set(x, 0, 0); gear.add(d); decks.push(d);
      const u = d.userData;
      if (u.platter) {   // a black record with a red label on each platter
        const rec = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.002, 48), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.35, metalness: 0.2 }));
        rec.position.y = 0.002; u.platter.add(rec);
        const lab = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.0025, 32), new THREE.MeshStandardMaterial({ color: nm === 'A' ? 0xd01020 : 0xf0f0f0, roughness: 0.6 }));
        lab.position.y = 0.0025; u.platter.add(lab);
      }
    }
  } catch (e) { console.warn('decks', e); }
  try { await loadMixerParts('models/mixer_parts.glb'); } catch (e) { console.warn('mixer parts', e); }
  try { const m = makeMixer(); gear.add(m); } catch (e) { console.warn('mixer', e); const m = new THREE.Mesh(new THREE.BoxGeometry(MIX.W, MIX.H, MIX.D), caseMat); m.position.y = MIX.H / 2; gear.add(m); }
}
const robot = new RobotAvatar2(robotRoot);
const robotReady = robot.load(ROBOT_GLB).catch(e => { console.warn('robot', e); toast('Robot did not load'); });

// the laser: right under the LED wall, aimed at the audience (re-aimed at this phone on AIM)
const laser = new Laser(stage, () => ({ p: V(0, WALL.y - WALL.h / 2 - 0.25, WALL.z + 0.1), yaw: Math.PI, pitch: 0 }));
laser.obj.position.set(0, WALL.y - WALL.h / 2 - 0.25, WALL.z + 0.1);
Object.assign(laser, { auto: true, pat: 'fan', col: 'green', n: 10, spread: 70, haze: 0.7, len: 12, smoke: 'beams', drift: 1 });   // assigned, not set(): set() saves to this phone's storage
laser.setOn(true, false);
function aimLaser() {   // point the head at this phone (beams come straight at the person filming)
  stage.updateMatrixWorld(true);
  const me = stage.worldToLocal(camera.getWorldPosition(V())), o = laser.obj.position, d = me.clone().sub(o);
  const yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  laser.obj.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  laser.len = clamp(d.length() + 3, 6, 15);
}

// ---------------------------------------------------------------- placement (AIM)
let aimF = null;   // camera forward at the AIM tap (world)
function place() {
  if (!aimF) return;
  const f = aimF.clone().normalize(), anchor = f.clone().multiplyScalar(S.dist);
  stage.rotation.set(0, Math.atan2(-f.x, -f.z), 0);   // stage +z (toward the audience) points back at this phone
  stage.position.copy(anchor).sub(ANCHOR).add(V(0, S.lift, 0));
  booth.position.set(S.robotX, 0, S.robotZ);
  stage.visible = true; stage.updateMatrixWorld(true); aimLaser();
}

// ---------------------------------------------------------------- looking around: gyroscope, or mouse drag on a PC
let ori = null, gyro = false;
const _e = new THREE.Euler(), _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), _z = V(0, 0, 1);
const FLIP = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI);
window.addEventListener('deviceorientation', e => { if (e.alpha != null) { ori = e; gyro = true; } });
const screenAngle = () => (screen.orientation && screen.orientation.angle) || window.orientation || 0;
let yaw = 0, pitch = 0, selfie = false;
function camQuat(out) {
  if (gyro && ori) {
    const D = Math.PI / 180;
    _e.set(ori.beta * D, ori.alpha * D, -ori.gamma * D, 'YXZ'); out.setFromEuler(_e);
    out.multiply(_q1); out.multiply(_q0.setFromAxisAngle(_z, -screenAngle() * D));
  } else out.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ'));
  if (selfie) out.multiply(FLIP);   // the front camera looks out of the screen, at the user
  return out;
}
{   // desktop drag
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY]; });
  window.addEventListener('pointerup', () => { drag = null; });
  window.addEventListener('pointermove', e => {
    if (!drag || gyro) return;
    yaw += (e.clientX - drag[0]) * 0.004; pitch = clamp(pitch + (e.clientY - drag[1]) * 0.004, -1.4, 1.4); drag = [e.clientX, e.clientY];
  });
}

// ---------------------------------------------------------------- camera picture
const video = document.createElement('video'); video.playsInline = true; video.muted = true; video.autoplay = true; video.setAttribute('playsinline', '');
let stream = null;
async function startCamera(front) {
  if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('No camera here (the page needs https)');
  stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: front ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } });
  video.srcObject = stream; await video.play();
  const tex = new THREE.VideoTexture(video); tex.colorSpace = THREE.NoColorSpace; tex.minFilter = tex.magFilter = THREE.LinearFilter;
  src = { tex, get w() { return video.videoWidth || 1280; }, get h() { return video.videoHeight || 720; } };
  bgMat.uniforms.uTex.value = tex; bgMat.uniforms.uOn.value = 1;
}
async function startDemo() {   // the PC test picture (web/_test/stage_demo.png, not shipped)
  const tex = await new THREE.TextureLoader().loadAsync(Q.get('demo') && Q.get('demo') !== '1' ? Q.get('demo') : '_test/stage_demo.png');
  tex.colorSpace = THREE.NoColorSpace; const img = tex.image;
  src = { tex, w: img.width, h: img.height }; bgMat.uniforms.uTex.value = tex; bgMat.uniforms.uOn.value = 1;
}

// field of view: the camera picture's long side spans S.fov degrees; the 3D camera matches what the cover crop shows
function resize() {
  const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false);
  const ca = w / h, va = src ? src.w / src.h : ca, L = Math.tan(S.fov * Math.PI / 360);
  const vH = va >= 1 ? L / va : L, vW = va >= 1 ? L : L * va;   // half-tangents of the picture
  let visV;
  if (ca > va) { visV = vW / ca; bgMat.uniforms.uK.value.set(1, va / ca); }   // fills the width, top and bottom cropped
  else { visV = vH; bgMat.uniforms.uK.value.set(ca / va, 1); }
  camera.aspect = ca; camera.fov = 2 * Math.atan(visV) * 180 / Math.PI; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- beat clock (Phase A: local BPM; Phase B: the Quest's beat phase)
const beat = { t0: performance.now(), count: 0, kick: 0, phase: 0 };
function beatStep(now, dt) {
  const iv = 60000 / S.bpm, b = (now - beat.t0) / iv, n = Math.floor(b);
  if (n !== beat.count) { beat.count = n; beat.kick = 1; }
  beat.phase = b - n; beat.kick *= Math.exp(-dt / 0.18);
}

// ---------------------------------------------------------------- the robot: live poses first, its own dancing mixed in
// live = the #278 'av' state tick (Quest rig space): h = head [x, y, z, qx, qy, qz, qw], hd = [[i, 'c' | 'h', v]], av = { hs, c, m }
const live = { msg: null, seen: -1e9, ref: null, w: 0 };
export function feedPose(m) { live.msg = m; live.seen = performance.now(); }
const _M = new THREE.Matrix4(), _R = new THREE.Quaternion(), _t = V(), _hq = new THREE.Quaternion();
function liveFrame(m) {
  // the DJ's standing spot (eased) maps onto the robot's spot; the Quest DJ looks down -z, the robot down +z
  const hx = m.h[0], hz = m.h[2];
  if (!live.ref) live.ref = V(hx, 0, hz); else { live.ref.x += (hx - live.ref.x) * 0.01; live.ref.z += (hz - live.ref.z) * 0.01; }
  robotRoot.updateMatrixWorld(true); robotRoot.getWorldQuaternion(_R).multiply(FLIP);
  _M.copy(robotRoot.matrixWorld).multiply(new THREE.Matrix4().makeRotationY(Math.PI)).multiply(new THREE.Matrix4().makeTranslation(-live.ref.x, 0, -live.ref.z));
  const P = (x, y, z) => V(x, y, z).applyMatrix4(_M), Rq = q => _R.clone().multiply(q);
  const head = { p: P(m.h[0], m.h[1], m.h[2]), q: Rq(_hq.set(m.h[3], m.h[4], m.h[5], m.h[6])) };
  const hands = [null, null], av = m.av || { hs: [] };
  for (const [i, kind, v] of m.hd || []) {
    const side = av.hs[i] === 'l' ? 0 : av.hs[i] === 'r' ? 1 : -1; if (side < 0) continue;
    if (kind === 'h') {
      if (v.length < 75) continue;
      const joints = new Map(); HAND_SPEC.forEach((n, j) => joints.set(n, P(v[j * 3], v[j * 3 + 1], v[j * 3 + 2])));
      const w = joints.get('wrist'), mp = joints.get('middle-finger-phalanx-proximal'), ip = joints.get('index-finger-phalanx-proximal'), pp = joints.get('pinky-finger-phalanx-proximal');
      hands[side] = { p: w, f: mp.clone().sub(w), s: pp.clone().sub(ip), joints };
    } else {   // controller, as spectator-client.js
      const gp = P(v[0], v[1], v[2]), gq = Rq(new THREE.Quaternion(v[3], v[4], v[5], v[6]));
      const c = (av.c || []).find(x => x[0] === i) || [i, 0, 0];
      hands[side] = { p: gp.clone().add(V(0, 0, 0.07).applyQuaternion(gq)), f: V(0, -0.35, -1).applyQuaternion(gq), s: V(0, -1, 0.25).applyQuaternion(gq),
        curl: 0.25 + 0.75 * c[2], curlIndex: 0.15 + 0.85 * c[1], tip: c.length >= 6 ? P(c[3], c[4], c[5]) : null };
    }
  }
  return { head, hands, mic: av.m || 0 };
}
const HAND_SPEC = ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'];

// its own dance, in robot-root space (robot looks down +z; its right hand is at -x): head nods on the beat, one hand
// rides the left deck, the other works the mixer, and every 8 bars a hand goes up
const L = (x, y, z) => robotRoot.localToWorld(V(x, y, z));
const Ld = (x, y, z) => V(x, y, z).applyQuaternion(robotRoot.getWorldQuaternion(new THREE.Quaternion())).normalize();
function idleFrame(t) {
  const ph = beat.phase, bob = Math.pow(1 - ph, 3), bar = Math.floor(beat.count / 4), hype = (bar % 8 === 7);
  const nod = -0.32 - 0.16 * bob + 0.05 * Math.sin(t * 0.7), sway = 0.12 * Math.sin(t * Math.PI * S.bpm / 120);
  const head = { p: L(sway * 0.15, 1.6 - 0.035 * bob, 0.03), q: robotRoot.getWorldQuaternion(new THREE.Quaternion()).multiply(FLIP).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(nod, sway * 0.6, sway * 0.25, 'YXZ'))) };
  const top = TABLE.h + DECK.H + 0.06;
  // right hand (robot's right = -x): mixer faders / knobs, a small push on the beat
  const rx = -0.06 + 0.05 * Math.sin(t * 1.3), rz = TABLE.z - 0.05 + 0.03 * Math.sin(t * 0.9);
  const right = { p: L(rx - 0.04, top + 0.02 * bob, rz - 0.16), f: Ld(0.05, -0.6, 1), s: Ld(-1, 0, 0), curl: 0.45, curlIndex: 0.3 };
  // left hand: on the left deck's record (robot's left = +x), rocking it back and forth on the beat
  const sc = Math.sin((beat.count + ph) * Math.PI) * 0.035;
  let left = { p: L(0.42 + sc, top, TABLE.z - 0.17 + sc * 0.4), f: Ld(-0.15, -0.55, 1), s: Ld(1, 0, 0), curl: 0.35, curlIndex: 0.25 };
  if (hype) {   // hand up for a bar
    const up = Math.sin(Math.min(1, (beat.count % 4 + ph) / 4) * Math.PI);
    left = { p: L(0.3, top + 0.75 * up, 0.15), f: Ld(0, 1, 0.25), s: Ld(1, 0, 0), curl: 0.9 * up + 0.35 * (1 - up), curlIndex: 0.9 * up };
  }
  return { head, hands: [left, right], mic: 0 };
}
function robotStep(now, dt, t) {
  if (!robot.ready) return;
  const fresh = now - live.seen < 1000;
  live.w = clamp(live.w + (fresh ? dt * 3 : -dt * 1.5), 0, 1);
  const idle = idleFrame(t);
  let pose = idle;
  if (live.w > 0 && live.msg) {
    const lv = liveFrame(live.msg);
    // the owner's moves lead; the idle head nod rides on top at 30 %, hands are the owner's whenever they're tracked
    const nodQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.08 * Math.pow(1 - beat.phase, 3), 0, 0));
    const head = { p: idle.head.p.clone().lerp(lv.head.p, live.w), q: idle.head.q.clone().slerp(lv.head.q.clone().multiply(nodQ), live.w) };
    pose = { head, hands: [live.w > 0.5 && lv.hands[0] ? lv.hands[0] : idle.hands[0], live.w > 0.5 && lv.hands[1] ? lv.hands[1] : idle.hands[1]], mic: lv.mic };
  }
  pose.dt = dt;
  try { robot.update(pose); } catch (e) { if (!robot._warned) { robot._warned = true; console.warn(e); } }
}

// ---------------------------------------------------------------- frame loop
let last = performance.now(), T = 0, promoT = 0;
const _cq = new THREE.Quaternion();
function frame() {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; T += dt;
  beatStep(now, dt);
  camQuat(_cq); camera.quaternion.copy(_cq); camera.updateMatrixWorld();
  // LED wall: fractal, a promo card for 6 s every 24 s, NOW SPINNING band 10 s in every 30 s
  promoT += dt; const pc = promoT % 24, cc = T % 30;
  const wu = wallMat.uniforms; wu.uT.value = T; wu.uKick.value = beat.kick;
  wu.uMix.value += ((pc > 18 ? 1 : 0) - wu.uMix.value) * Math.min(1, dt * 3);
  wu.uCap.value += ((cc < 10 ? 1 : 0) - wu.uCap.value) * Math.min(1, dt * 4);
  scrMat.uniforms.uT.value = T; scrMat.uniforms.uKick.value = beat.kick; scrMat.uniforms.uOff.value = (T * 0.07) % 1;
  for (const d of decks) if (d.userData.platter) d.userData.platter.rotation.y -= dt * (33.333 / 60) * Math.PI * 2;
  if (stage.visible) {
    robotStep(now, dt, T);
    laser.tick(dt, beat, camera.getWorldPosition(_t));
  }
  renderer.clear(); renderer.render(bgScene, bgCam); renderer.clearDepth(); renderer.render(scene, camera);
}

// ---------------------------------------------------------------- UI
let toastT = 0;
function toast(s) { const t = $('toast'); t.textContent = s; t.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => { t.style.opacity = 0; }, 1800); }
const show = (id, on) => $(id).classList.toggle('hide', !on);
function aim() {
  aimF = V(0, 0, -1).applyQuaternion(camQuat(new THREE.Quaternion()));
  if (selfie) aimF.negate();   // aimed with the front camera: the booth is behind the phone's screen side
  place(); show('aim', false); show('hint', false); toast('Placed. Tap AIM again to re-centre.');
}
const ROWS = [
  ['dist', 'DISTANCE', 1, 25, 0.5, v => v.toFixed(1) + ' m'],
  ['lift', 'STAGE HEIGHT', -2, 2, 0.1, v => (v >= 0 ? '+' : '') + v.toFixed(1) + ' m'],
  ['robotX', 'ROBOT LEFT / RIGHT', -5, 5, 0.25, v => v.toFixed(2) + ' m'],
  ['robotZ', 'ROBOT BACK / FRONT', -2, 2, 0.25, v => v.toFixed(2) + ' m'],
  ['fov', 'CAMERA ANGLE', 40, 100, 1, v => v.toFixed(0) + '°'],
  ['bpm', 'BPM', 60, 180, 1, v => v.toFixed(0)],
];
function buildPanel() {
  const p = $('panel'); p.innerHTML = '';
  for (const [k, lab, a, b, st, fmt] of ROWS) {
    const r = document.createElement('div'); r.className = 'row';
    r.innerHTML = `<span class="lab">${lab}</span><button>−</button><span class="val"></span><button>+</button>`;
    const val = r.querySelector('.val'), upd = () => { val.textContent = fmt(S[k]); };
    const [m, pl] = r.querySelectorAll('button');
    const step = d => { S[k] = clamp(Math.round((S[k] + d * st) / st) * st, a, b); upd(); save(); if (k === 'fov') resize(); else place(); };
    m.onclick = () => step(-1); pl.onclick = () => step(1); upd(); p.appendChild(r);
  }
  for (const [k, lab, fn] of [['scroll', 'SCROLLER', drawScroller], ['np', 'NOW SPINNING', drawCaption]]) {
    const r = document.createElement('div'); r.className = 'row';
    r.innerHTML = `<span class="lab">${lab}</span><input type="text">`;
    const inp = r.querySelector('input'); inp.value = S[k];
    inp.onchange = () => { S[k] = inp.value || DEF[k]; save(); fn(); };
    p.appendChild(r);
  }
}
$('bAim').onclick = () => { if (!aimF) aim(); else { show('aim', true); show('hint', true); aimF = null; stage.visible = false; } };
$('aim').onclick = aim;
$('bSet').onclick = () => { const p = $('panel'); if (p.classList.contains('hide')) buildPanel(); p.classList.toggle('hide'); };
$('bFlip').onclick = async () => {
  if (!stream) { toast('No camera on this device'); return; }
  selfie = !selfie; document.body.classList.toggle('selfie', selfie); $('bFlip').textContent = selfie ? 'BACK CAM' : 'SELFIE';
  try { await startCamera(selfie); resize(); } catch (e) { toast(e.message); }
};
// tapping anywhere while the ring shows = AIM
canvas.addEventListener('click', () => { if (!aimF && !$('aim').classList.contains('hide')) aim(); });

$('go').onclick = async () => {
  $('err').textContent = '';
  try {   // iPhone: motion access only after a tap, asked here
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') toast('Motion access refused: drag to look around');
    }
  } catch (e) { /* desktop */ }
  try {
    if (Q.has('demo')) await startDemo(); else await startCamera(false);
  } catch (e) {
    $('err').textContent = (e && e.name === 'NotAllowedError') ? 'Camera access was refused. Allow it in the browser settings and try again.' : (e.message || String(e));
    try { await startDemo(); } catch (e2) { return; }
  }
  show('start', false); show('aim', true); show('hint', true); show('bar', true);
  resize();
  if (Q.has('demo')) { aimF = V(0, 0, -1); place(); show('aim', false); show('hint', false); }   // PC: placed straight ahead
};

// ---------------------------------------------------------------- start
drawCaption(); drawPromo(); drawScroller(); resize();
buildBooth().then(() => robotReady).then(() => { window.__dirroReady = true; });
renderer.setAnimationLoop(frame);
window.dirro = { S, stage, booth, robot, laser, camera, scene, renderer, place, feedPose, live, beat, wall, scroller, set aim(v) { aimF = v; place(); }, get yaw() { return yaw; }, set yaw(v) { yaw = v; }, set pitch(v) { pitch = v; } };
