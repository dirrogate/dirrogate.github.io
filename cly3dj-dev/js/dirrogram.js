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
import { PersonMask } from './dirro-mask.js';   // #428
import { WallFx } from './wallfx.js';   // #439 MANDEL / RETRO-SCENE, drawn here from the Quest's clock and beat

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
// #427 texts from the Quest while live (scroller, NOW SPINNING) win over this phone's own
const liveCfg = { scroll: '', np: '', wall: null, img: '', holo: [], bcn: null };
// #435 approved HoloSMS ride along on the hologram scroller after the DJ's text
const scrollText = () => [liveCfg.scroll || S.scroll, ...liveCfg.holo].join('  \u2726  '), npText = () => liveCfg.np || S.np;

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
let src = null;   // { tex, el, w, h }

// #428 PEOPLE: the people in the camera picture drawn back over the show (MediaPipe mask), lit by the lasers behind them.
// The finished frame is copied to a texture; the light the show added around each person's outline (frame minus the
// camera picture) spills onto them, brightest on the edge, so a beam that meets a hand ends in a glow there.
const people = { on: false, mask: new PersonMask(), fb: null, fx: 0 };
// #439 people FX (the FX button): what the person in front of the phone becomes, drawn into the recording too.
// 1 OP-ART: filled with rings from their middle, pulsing on the beat, outlined; 2 NEON: a glowing outline on the kick;
// 3 ECHO: fading copies of their last second of moves; 4 HOLO: the cyan scanline look of the hologram scroller.
// Cyan and pink swap every 4 beats.
const PFX = ['', 'OP-ART', 'NEON', 'ECHO', 'HOLO'];
const ovScene = new THREE.Scene();
const ovMat = new THREE.ShaderMaterial({
  uniforms: { uVid: { value: null }, uMask: { value: null }, uFb: { value: null }, uK: bgMat.uniforms.uK, uPx: { value: new THREE.Vector2(1e-3, 1e-3) },
    uTrail: { value: null }, uMode: { value: 0 }, uT: { value: 0 }, uKick: { value: 0 }, uBeat: { value: 0 }, uBar: { value: 0 }, uAsp: { value: 1 },
    uCen: { value: new THREE.Vector2(0.5, 0.5) }, uMpx: { value: new THREE.Vector2(1 / 256, 1 / 256) } },   // #439 people FX
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D uVid, uMask, uFb, uTrail; uniform vec2 uK, uPx, uCen, uMpx; uniform float uMode, uT, uKick, uBeat, uBar, uAsp; varying vec2 vUv;
vec3 lightAt(vec2 p) { vec2 c = 0.5 + (p - 0.5) * uK; return max(texture2D(uFb, p).rgb - texture2D(uVid, c).rgb, 0.0); }
void main() {
  vec2 cuv = 0.5 + (vUv - 0.5) * uK, mc = vec2(cuv.x, 1.0 - cuv.y);
  float m = smoothstep(0.4, 0.8, texture2D(uMask, mc).r);
  bool alt = mod(uBar, 2.0) < 1.0;
  vec3 A = alt ? vec3(0.22, 0.9, 1.0) : vec3(1.0, 0.16, 0.55), B = alt ? vec3(1.0, 0.16, 0.55) : vec3(0.22, 0.9, 1.0);
  if (uMode > 1.5 && uMode < 2.5) {   // NEON: a line where the mask changes, the person dimmed under it
    float mx = 0.0, mn = 1.0;
    for (int i = 0; i < 8; i++) { float a = float(i) * 0.7854; float v = texture2D(uMask, mc + vec2(cos(a), sin(a)) * uMpx * 2.5).r; mx = max(mx, v); mn = min(mn, v); }
    float e = smoothstep(0.2, 0.7, mx - mn);
    if (m < 0.01 && e < 0.02) discard;
    gl_FragColor = vec4(mix(texture2D(uVid, cuv).rgb * 0.5, A * (1.5 + 1.5 * uKick), e), max(m, e)); return;
  }
  if (uMode > 2.5 && uMode < 3.5) {   // ECHO: the trail of the last second, coloured by age, behind the person
    float tr = texture2D(uTrail, mc).r, gh = smoothstep(0.12, 0.7, tr) * (1.0 - m);
    if (m < 0.01 && gh < 0.02) discard;
    gl_FragColor = vec4(mix(mix(B, A, tr) * (0.9 + 0.6 * uKick), texture2D(uVid, cuv).rgb, m), max(m, gh * 0.8)); return;
  }
  if (m < 0.01) discard;
  vec3 vid = texture2D(uVid, cuv).rgb, L = vec3(0.0);
  for (int i = 0; i < 6; i++) { float a = float(i) * 1.0472; L += lightAt(vUv + vec2(cos(a), sin(a)) * uPx * 14.0); }
  L /= 6.0;
  float rim = clamp(m * (1.0 - m) * 4.0, 0.0, 1.0);
  if (uMode > 0.5 && uMode < 1.5) {   // OP-ART: rings from the person's middle, moving out two a beat, a pink / cyan outline
    float bit = step(0.5, fract(length((vUv - uCen) * vec2(uAsp, 1.0)) * 34.0 - uBeat * 2.0));
    vec3 c = mix(vec3(0.02, 0.0, 0.06), mix(vec3(0.94), A, 0.35) * (1.0 + 0.4 * uKick), bit);
    gl_FragColor = vec4(mix(c, B * 1.4, smoothstep(0.35, 0.95, rim)), m); return;
  }
  if (uMode > 3.5) {   // HOLO
    float l = dot(vid, vec3(0.3, 0.59, 0.11)), scan = 0.55 + 0.45 * sin(vUv.y * 700.0 - uT * 9.0), fl = 0.9 + 0.1 * sin(uT * 37.0) * sin(uT * 13.0);
    vec3 c = vec3(0.25, 0.9, 1.0) * (0.2 + 1.3 * l) * scan * fl + L * rim + vec3(1.0, 0.1, 0.6) * rim * 0.6;
    gl_FragColor = vec4(c * (1.0 + 0.4 * uKick), m * 0.88); return;
  }
  gl_FragColor = vec4(vid + L * (0.35 + 1.8 * rim), m);
}`,
  transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
});
ovScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ovMat));
function peopleFb() {   // a copy of the drawn frame, the drawing-buffer size
  const v = renderer.getDrawingBufferSize(new THREE.Vector2());
  if (!people.fb || people.fb.image.width !== v.x || people.fb.image.height !== v.y) {
    if (people.fb) people.fb.dispose(); people.fb = new THREE.FramebufferTexture(v.x, v.y); people.fb.minFilter = people.fb.magFilter = THREE.LinearFilter;
    ovMat.uniforms.uPx.value.set(1 / v.x, 1 / v.y);
  }
  return people.fb;
}
async function setPeople(on) {
  people.on = on; $('bPeople').textContent = on ? 'PEOPLE: ON' : 'PEOPLE';
  if (on && people.mask.state !== 'ready') {
    toast('Loading the people cutout\u2026');
    const st = await people.mask.load();
    if (st !== 'ready') { people.on = false; $('bPeople').textContent = 'PEOPLE'; toast('People cutout not available here'); return; }
    toast('People cutout on');
  }
}

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
  const np = npText(); g.fillStyle = '#ffffff'; let fs = 52; g.font = `700 ${fs}px system-ui, sans-serif`;
  while (g.measureText(np).width > 950 && fs > 24) { fs -= 2; g.font = `700 ${fs}px system-ui, sans-serif`; }
  g.fillText(np, 36, 88); capTex.needsUpdate = true;
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
  uniforms: { uT: { value: 0 }, uKick: { value: 0 }, uMix: { value: 0 }, uCap: { value: 0 }, uImg: { value: promoTex }, uCapTex: { value: capTex }, uGrid: { value: new THREE.Vector2(160, 90) },
    uGridOn: { value: 1 }, uFill: { value: 0.78 }, uGlow: { value: 1 } },   // #434 LED grid from the tablet
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform float uT, uKick, uMix, uCap, uGridOn, uFill, uGlow; uniform sampler2D uImg, uCapTex; uniform vec2 uGrid; varying vec2 vUv;
vec3 pal(float t) { return 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + t)); }
vec3 fractal(vec2 uv) {
  vec2 z = (uv - 0.5) * vec2(3.2, 1.8) / (1.0 + 0.12 * uKick);
  float a = uT * 0.11; vec2 c = 0.7885 * vec2(cos(a), sin(a)); float n = 0.0;
  for (int k = 0; k < 40; k++) { z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c; if (dot(z, z) > 16.0) break; n += 1.0; }
  float s = n / 40.0; return pal(s * 1.6 + uT * 0.05) * pow(s, 0.55) * (0.75 + 0.6 * uKick);
}
void main() {
  vec2 g = vUv * uGrid, cell = uGridOn > 0.5 ? (floor(g) + 0.5) / uGrid : vUv, f = fract(g);
  vec3 col = mix(fractal(cell), texture2D(uImg, cell).rgb, uMix);
  float band = step(cell.y, 0.2) * uCap;
  vec4 cp = texture2D(uCapTex, vec2(cell.x, cell.y / 0.2));
  col = mix(col, col * 0.3, band); col = mix(col, cp.rgb, cp.a * band * step(0.0, 0.2 - cell.y));
  float e = (1.0 - uFill) * 0.5 + 0.03, led = smoothstep(0.0, e, f.x) * smoothstep(1.0, 1.0 - e, f.x) * smoothstep(0.0, e, f.y) * smoothstep(1.0, 1.0 - e, f.y);
  if (uGridOn < 0.5) led = 1.0;
  gl_FragColor = vec4(col * (0.18 + 1.05 * led) * 1.25 * uGlow, 1.0);
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
  const txt = scrollText() + '      ';
  let w = Math.ceil(g.measureText(txt).width);
  if (w > 4096) { fs = Math.floor(fs * 4096 / w); w = 4096; }
  if (scrCv.width !== w) scrTex.dispose();   // three allocates texture storage once: a new width needs a new texture
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
const robotReady = robot.load(ROBOT_GLB).catch(e => { console.warn('robot', e); toast('DIRRODJ did not load'); });

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
// #438 AIM WITH BEACON: the Quest's two DirroBeacons (rig space, sent in the config) and the DJ's head (the live pose)
// seen from this phone: three taps, LEFT beacon, the DJ in the headset, RIGHT beacon. Rig -> stage: (x, y, z) ->
// (-x, y, -z) (the DJ looks down the rig's -z at the crowd; the stage's +z faces the crowd), origin = the Quest's rig.
// Each tap is a direction on the gyroscope: the horizontal angles between them hold whatever the phone's yaw, and each
// tilt is true to gravity. Search the floor for the spot that sees those angles (phone height from the tilts and a
// 1.45 m guess), then the turn that lines the phone's yaw up with the stage. Two beacons alone leave a circle of
// answers (PC test: 1.5 to 10 m off); the DJ, ~2 m in front of them, pins it (0.3 m at 6 m, 0.6 m at 10 m, 1.2 m at
// 15 m with 0.7 deg hand taps and beacons 3 m apart).
const BCN = { fix: null, step: 0, dirs: [], pts: [] };
const toStage = a => V(-a[0], a[1], -a[2]);
function bcnStage() { const b = liveCfg.bcn; if (!b || !b.L || !b.R) return null; return { L: toStage(b.L), R: toStage(b.R) }; }
function djHead() { const m = netLive(performance.now()) && NET.snaps.length ? NET.snaps[NET.snaps.length - 1].m : null; return m && m.h ? toStage(m.h) : V(0, 1.7, 0); }
function bcnSolve(dirs, pts) {
  const az = (x, z) => Math.atan2(x, -z), wrap = a => Math.atan2(Math.sin(a), Math.cos(a)), el = v => Math.atan2(v.y, Math.hypot(v.x, v.z));
  const sT = 0.7 * Math.PI / 180, sE = Math.PI / 180, vP = 0.35 * 0.35, a0 = az(dirs[0].x, dirs[0].z);
  const th = dirs.map(d => wrap(az(d.x, d.z) - a0)), e = dirs.map(el);
  if (Math.max(...th.map(Math.abs)) < 0.5 * Math.PI / 180) return null;   // all taps on one spot
  const c = pts.reduce((s2, p) => s2.add(p), V()).multiplyScalar(1 / pts.length);
  const cost = (px, pz) => {
    const b0 = az(pts[0].x - px, pts[0].z - pz); let C = 0; const ys = [], vs = [];
    pts.forEach((p, i) => { const r = Math.hypot(p.x - px, p.z - pz); if (i) C += ((wrap(az(p.x - px, p.z - pz) - b0) - th[i]) / sT) ** 2; ys.push(p.y - r * Math.tan(e[i])); vs.push((r * sE) ** 2 + 1e-4); });
    let num = 1.45 / vP, den = 1 / vP; ys.forEach((y, i) => { num += y / vs[i]; den += 1 / vs[i]; }); const py = num / den;
    ys.forEach((y, i) => { C += (py - y) ** 2 / vs[i]; }); C += (py - 1.45) ** 2 / vP;
    return { c: C, py };
  };
  let best = null;
  for (let pz = c.z + 0.8; pz <= c.z + 40; pz += 0.25) for (let px = c.x - 25; px <= c.x + 25; px += 0.25) { const r = cost(px, pz); if (!best || r.c < best.c) best = { ...r, px, pz }; }
  const b0 = best;
  for (let pz = b0.pz - 0.3; pz <= b0.pz + 0.3; pz += 0.02) for (let px = b0.px - 0.3; px <= b0.px + 0.3; px += 0.02) { const r = cost(px, pz); if (r.c < best.c) best = { ...r, px, pz }; }
  const P = V(best.px, best.py, best.pz);
  // the turn: each tap's yaw minus that point's bearing on the stage (circular mean); three's Y turn by phi lowers az by phi
  let sx = 0, sy = 0; dirs.forEach((d, i) => { const dd = wrap(az(d.x, d.z) - az(pts[i].x - P.x, pts[i].z - P.z)); sx += Math.cos(dd); sy += Math.sin(dd); });
  const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -Math.atan2(sy, sx));
  return { q, pos: P.clone().applyQuaternion(q).negate(), P, dist: Math.hypot(P.x - c.x, P.z - c.z), cost: best.c };
}
function place() {
  if (BCN.fix) {   // #438 placed from the beacons: the Quest's own layout
    stage.quaternion.copy(BCN.fix.q); stage.position.copy(BCN.fix.pos);
    booth.position.set(S.robotX, 0, S.robotZ);
    stage.visible = true; stage.updateMatrixWorld(true); aimLaser(); return;
  }
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
  src = { tex, el: video, get w() { return video.videoWidth || 1280; }, get h() { return video.videoHeight || 720; } };
  bgMat.uniforms.uTex.value = tex; bgMat.uniforms.uOn.value = 1;
}
async function startDemo() {   // the PC test picture (web/_test/stage_demo.png, not shipped)
  const tex = await new THREE.TextureLoader().loadAsync(Q.get('demo') && Q.get('demo') !== '1' ? Q.get('demo') : '_test/stage_demo.png');
  tex.colorSpace = THREE.NoColorSpace; const img = tex.image;
  src = { tex, el: img, w: img.width, h: img.height }; bgMat.uniforms.uTex.value = tex; bgMat.uniforms.uOn.value = 1;
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
const beat = { t0: performance.now(), count: 0, kick: 0, phase: 0, lastKick: 0 };
function beatStep(now, dt) {
  beat.kick *= Math.exp(-dt / 0.18);
  if (netLive(now) && NET.b) {   // #427 the Quest's beat: the last bass onset (on this phone's clock) and the track's tempo
    const iv = beatIv(), anchor = NET.anchor;
    if (!iv || now - anchor > 4000) return;   // no music: no beats (the laser dims itself)
    const pos = (now - anchor) / iv, ph = pos - Math.floor(pos);
    if (ph < beat.phase - 0.5 && now - beat.lastKick > iv * 0.5) { beat.count++; beat.kick = 1; beat.lastKick = now; }
    beat.phase = ph; return;
  }
  const iv = 60000 / S.bpm, b = (now - beat.t0) / iv, n = Math.floor(b);
  if (n !== beat.count) { beat.count = n; beat.kick = 1; beat.lastKick = now; }
  beat.phase = b - n;
}

// ---------------------------------------------------------------- live link (#427, Phase B): the relay room from the QR (#relay=wss://…&room=KEY)
const HQ = new URLSearchParams(location.hash.slice(1));
const NET = { relay: HQ.get('relay') || Q.get('relay') || '', room: HQ.get('room') || Q.get('room') || '', ws: null, state: 'off', rtt: 0, retry: 0, retryT: 0,
  offs: [], cd: null, last: -1e9, snaps: [], b: null, bn: -1, anchor: 0, onsets: [], l: null, lAt: 0, imgs: new Map(), tv: null, tvAt: 0 };
const netLive = now => now - NET.last < 1500;
function beatIv() {
  const bpm = NET.b && NET.b.bpm;
  if (bpm >= 60 && bpm <= 200) { let iv = 60000 / bpm; while (iv < 300) iv *= 2; while (iv > 1000) iv /= 2; return iv; }   // the kick, not the hi-hat
  const o = NET.onsets, d = []; for (let i = 1; i < o.length; i++) { const x = o[i] - o[i - 1]; if (x > 280 && x < 1500) d.push(x); }
  if (d.length < 3) return 0; d.sort((a, b) => a - b); return d[d.length >> 1];
}
function netConnect() {
  if (!NET.relay || !NET.room) return;
  let ws; try { ws = new WebSocket(`${NET.relay}/r/${encodeURIComponent(NET.room)}?role=fan`); } catch (e) { NET.state = 'error'; return; }
  NET.ws = ws; NET.state = 'connecting';
  ws.onopen = () => { NET.state = 'open'; NET.retry = 0; ws.send(JSON.stringify({ k: 'ping', c: performance.now() })); };
  ws.onclose = () => { if (NET.ws !== ws) return; NET.ws = null; NET.state = 'retrying'; NET.retry++; NET.retryT = performance.now() + Math.min(10000, 800 * Math.pow(1.6, NET.retry)); };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } netMsg(m, performance.now()); };
}
function netMsg(m, now) {
  if (m.k === 'smsok') { toast('Sent! It goes up if the DJ picks it.'); return; }   // #435
  if (m.k === 'smsw') { toast(`One message every 3 minutes: next one in ${m.s >= 60 ? Math.floor(m.s / 60) + ' min ' + (m.s % 60) + ' s' : m.s + ' s'}`); return; }
  if (m.k === 'pong') { const r = now - m.c; NET.rtt = NET.rtt ? NET.rtt + (r - NET.rtt) * 0.25 : r; return; }
  if (m.k === 'i' && m.id && m.d) {   // #434 a picture from the Quest's LED wall (kept, the last 8)
    if (NET.imgs.has(m.id)) return;
    const im = new Image(); im.onload = () => { const t = new THREE.Texture(im); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; NET.imgs.set(m.id, t);
      while (NET.imgs.size > 8) { const k = NET.imgs.keys().next().value; NET.imgs.get(k).dispose(); NET.imgs.delete(k); } }; im.src = m.d; return;
  }
  if (m.k === 'f' && m.d) {   // #434 a CLY3DTV frame (192 x 108)
    const im = new Image(); im.onload = () => { if (!NET.tv) { NET.tv = new THREE.Texture(im); NET.tv.colorSpace = THREE.SRGBColorSpace; } else NET.tv.image = im; NET.tv.needsUpdate = true; NET.tvAt = performance.now(); }; im.src = m.d; return;
  }
  if (m.k === 'c') {
    liveCfg.wall = m.wall || null; liveCfg.img = m.img || ''; liveCfg.bcn = m.bcn || null;   // #434, #438
    { const h = Array.isArray(m.holo) ? m.holo.map(x => String(x).slice(0, 140)) : []; if (h.join('\n') !== liveCfg.holo.join('\n')) { liveCfg.holo = h; drawScroller(); } }   // #435
    if ((m.scroll || '') !== liveCfg.scroll) { liveCfg.scroll = m.scroll || ''; drawScroller(); }
    if ((m.np || '') !== liveCfg.np) { liveCfg.np = m.np || ''; drawCaption(); if (liveCfg.np) capUntil = T + 10; }   // a new track: NOW SPINNING for 10 s
    return;
  }
  if (m.k !== 'p') return;
  NET.last = now;
  // clock: the smallest (arrival - Quest time) over the last 10 s, less half of each leg's round trip = the Quest clock on this phone
  NET.offs.push([now, now - m.t]); while (NET.offs.length && now - NET.offs[0][0] > 10000) NET.offs.shift();
  let mn = Infinity; for (const o of NET.offs) mn = Math.min(mn, o[1]);
  NET.cd = mn - ((m.qr || 0) + (NET.rtt || 0)) / 2;
  if (m.b) {
    NET.b = m.b;
    if (m.b.n !== NET.bn) { NET.bn = m.b.n; NET.anchor = m.b.lt + NET.cd; NET.onsets.push(NET.anchor); if (NET.onsets.length > 9) NET.onsets.shift(); }
  }
  if (m.l) { NET.l = m.l; NET.lAt = now; }
  NET.snaps.push({ at: now, m }); while (NET.snaps.length > 6) NET.snaps.shift();
}
// the pose 110 ms back in time, between the two messages around it (15 a second arrive), so DIRRODJ moves smoothly
const lerpQ = (a, i, b, k, out) => {   // four numbers at i: nlerp the shorter way
  let d = a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3]; const sg = d < 0 ? -1 : 1, q = [];
  for (let j = 0; j < 4; j++) q.push(a[i + j] + (sg * b[i + j] - a[i + j]) * k);
  const n = Math.hypot(...q) || 1; for (let j = 0; j < 4; j++) out[i + j] = q[j] / n;
};
function netPose(now) {
  const S2 = NET.snaps; if (!S2.length) return null;
  const t = now - 110; let a = S2[0], b = S2[S2.length - 1];
  for (let i = 0; i < S2.length - 1; i++) if (S2[i].at <= t && S2[i + 1].at >= t) { a = S2[i]; b = S2[i + 1]; break; }
  if (t <= a.at || a === b) return a.m;
  if (t >= b.at) return b.m;
  const k = (t - a.at) / (b.at - a.at), A = a.m, B = b.m, h = B.h.slice();
  for (let j = 0; j < 3; j++) h[j] = A.h[j] + (B.h[j] - A.h[j]) * k; lerpQ(A.h, 3, B.h, k, h);
  const hd = (B.hd || []).map(([i, kind, v]) => {
    const pa = (A.hd || []).find(x => x[0] === i && x[1] === kind); if (!pa || pa[2].length !== v.length) return [i, kind, v];
    const o = v.slice(), u = pa[2];
    if (kind === 'c') { for (let j = 0; j < 3; j++) o[j] = u[j] + (v[j] - u[j]) * k; lerpQ(u, 3, v, k, o); }
    else for (let j = 0; j < v.length; j++) o[j] = u[j] + (v[j] - u[j]) * k;
    return [i, kind, o];
  });
  return { h, hd, av: B.av };
}
// the laser follows the Quest's (pattern, colour, beams, spread, speed, haze...); this phone keeps its own aim and length
function netLaser(now) {
  const l = NET.l; if (!l || !netLive(now)) return;
  if (!!l.on !== laser.on) laser.setOn(!!l.on, false);
  for (const k of ['pat', 'col', 'n', 'spread', 'speed', 'haze', 'drift']) if (l[k] !== undefined) laser[k] = l[k];
  laser.smoke = l.smoke === 'off' ? 'off' : 'beams';   // light sheets cost too much on a phone
  laser.auto = !!l.auto; laser.beats = 1;               // never its own random pattern / colour change: the Quest's come in
  if (typeof l.ph === 'number') { const d = l.ph - laser.ph; laser.ph += Math.abs(d) > 3 ? d : d * 0.15; }
}

// ---------------------------------------------------------------- the robot: live poses first, its own dancing mixed in
// live = the #278 'av' state tick (Quest rig space): h = head [x, y, z, qx, qy, qz, qw], hd = [[i, 'c' | 'h', v]], av = { hs, c, m }
const live = { msg: null, seen: -1e9, ref: null, w: 0 };
export function feedPose(m) { netMsg(Object.assign({ k: 'p', t: performance.now() }, m), performance.now()); }   // tests: a fake Quest message
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
  const fresh = netLive(now) && NET.snaps.length > 0; live.msg = fresh ? netPose(now) : live.msg;
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
let last = performance.now(), T = 0, promoT = 0, capUntil = 0, netShown = '';
function netStatus(now) {   // the pill top right: LIVE with the round trip, or what the link is doing
  if (!NET.relay) return;
  const s = netLive(now) ? `\u25cf LIVE ${Math.round(NET.rtt)} ms` : NET.state === 'open' ? '\u25cb WAITING FOR THE DJ' : '\u25cb CONNECTING';
  if (s === netShown) return; netShown = s; const el = $('net'); el.textContent = s; el.classList.remove('hide'); el.classList.toggle('on', netLive(now));
}
// #439 the wall visuals on this phone: the Quest's show clock (its time less the clock offset) and its beat count
const FOLLOW_FRAMES = new Set(['clips', 'cam', 'live', 'solo', 'decks', 'screen', 'vmat']);
let wfx = null, wfxTex = null;
function wallFx(now, q) {
  if (!wfx) { wfx = new WallFx(); wfxTex = new THREE.CanvasTexture(wfx.canvas); wfxTex.colorSpace = THREE.SRGBColorSpace; }
  const qn = now - (NET.cd || 0), iv = beatIv(), lv = NET.b && iv && now - NET.anchor < 4000;
  const bp = lv ? NET.bn + (now - NET.anchor) / iv : qn / 500, L = q.lp ? NET.imgs.get(q.lp) : null;
  const mode = q.m === 'mandel' ? 'mandel' : q.m === 'vdancer' ? 'rings' : q.m === 'meta' ? 'meta' : q.s === 'loop' && L ? 'loop' : 'dancer';   // #442
  if (wfx.frame({ mode, t: qn - (q.t0 || 0), bp, kick: beat.kick, loop: L && L.image, lt: qn - (q.lt0 || 0), rp: q.rp, mp: q.mp })) wfxTex.needsUpdate = true;
  return wfxTex;
}
const _cq = new THREE.Quaternion();
function frame() {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; T += dt;
  if (NET.relay && !NET.ws && now >= NET.retryT) netConnect();
  if (NET.ws && NET.ws.readyState === 1 && now - (NET.pingT || 0) > 3000) { NET.pingT = now; NET.ws.send(JSON.stringify({ k: 'ping', c: now })); }
  netStatus(now);
  beatStep(now, dt);
  camQuat(_cq); camera.quaternion.copy(_cq); camera.updateMatrixWorld();
  // LED wall: fractal, a promo card for 6 s every 24 s, NOW SPINNING band 10 s in every 30 s
  promoT += dt; const pc = promoT % 24, cc = T % 30;
  const wu = wallMat.uniforms; wu.uT.value = T; wu.uKick.value = beat.kick;
  {   // #434 what the wall shows: the tablet's WALL choice while live (AUTO otherwise), and its LED grid
    const Wc = netLive(now) && liveCfg.wall ? liveCfg.wall : null, src = Wc ? Wc.src : 'auto', q = Wc && Wc.q;
    const pic = liveCfg.img && netLive(now) ? NET.imgs.get(liveCfg.img) : null, tv = NET.tv && now - NET.tvAt < 3000 ? NET.tv : null, auto = pic || (pc > 18 ? promoTex : null);
    let tgt;
    if (src === 'follow') {   // #439 the Quest's LED wall: MANDEL / RETRO-SCENE drawn here, a picture, or the wall's frames; OFF = AUTO
      const m = q ? q.m : 'off';
      tgt = m === 'mandel' || m === 'retro' || m === 'vdancer' || m === 'meta' ? wallFx(now, q) : m === 'pics' ? pic : FOLLOW_FRAMES.has(m) ? tv : auto;
    } else tgt = src === 'fractal' ? null : src === 'pictures' ? pic : src === 'tv' ? tv : auto;
    if (tgt) wu.uImg.value = tgt;
    wu.uMix.value += ((tgt ? 1 : 0) - wu.uMix.value) * Math.min(1, dt * 3);
    const cols = Wc ? Wc.cols : 160; wu.uGridOn.value = cols > 0 ? 1 : 0; if (cols > 0) wu.uGrid.value.set(cols, Math.round(cols * 9 / 16));
    wu.uFill.value = Wc ? Wc.fill : 0.78; wu.uGlow.value = Wc ? Wc.glow : 1;
  }
  wu.uCap.value += ((cc < 10 || T < capUntil ? 1 : 0) - wu.uCap.value) * Math.min(1, dt * 4);
  scrMat.uniforms.uT.value = T; scrMat.uniforms.uKick.value = beat.kick; scrMat.uniforms.uOff.value = (T * 0.07) % 1;
  for (const d of decks) if (d.userData.platter) d.userData.platter.rotation.y -= dt * (33.333 / 60) * Math.PI * 2;
  if (stage.visible) {
    robotStep(now, dt, T);
    netLaser(now); laser.tick(dt, beat, camera.getWorldPosition(_t));
  }
  renderer.clear(); renderer.render(bgScene, bgCam); renderer.clearDepth(); renderer.render(scene, camera);
  if (people.on && people.mask.seg && src && src.el) {   // #428
    people.mask.step(src.el, now);
    if (people.mask.tex) {
      const fb = peopleFb(); renderer.copyFramebufferToTexture(fb);
      ovMat.uniforms.uFb.value = fb; ovMat.uniforms.uVid.value = src.tex; ovMat.uniforms.uMask.value = people.mask.tex;
      {   // #439 people FX
        const u = ovMat.uniforms, pm = people.mask, K = bgMat.uniforms.uK.value;
        u.uMode.value = people.fx; u.uT.value = T; u.uKick.value = beat.kick; u.uBeat.value = beat.count + beat.phase; u.uBar.value = Math.floor(beat.count / 4);
        u.uTrail.value = pm.ttex; u.uMpx.value.set(1 / (pm.w || 256), 1 / (pm.h || 256)); u.uAsp.value = canvas.clientWidth / Math.max(1, canvas.clientHeight);
        u.uCen.value.set(0.5 + (pm.cx - 0.5) / K.x, 0.5 + (0.5 - pm.cy) / K.y);
      }
      renderer.render(ovScene, bgCam);
    }
  }
}

// ---------------------------------------------------------------- UI
let toastT = 0;
function toast(s) { const t = $('toast'); t.textContent = s; t.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => { t.style.opacity = 0; }, 1800); }
const show = (id, on) => { $(id).classList.toggle('hide', !on); if (on && (id === 'aimMenu' || id === 'panel' || id === 'sms')) overBar(); };
// #438 the boxes over the button bar sit above its real height (it wraps onto two rows on a phone)
function overBar() { const h = $('bar').offsetHeight || 50; for (const id of ['aimMenu', 'panel', 'sms']) $(id).style.bottom = `calc(env(safe-area-inset-bottom) + ${h + 28}px)`; }
window.addEventListener('resize', () => overBar());
function aim() {
  BCN.fix = null; BCN.step = 0;   // #438 a plain AIM ends a beacon placement
  aimF = V(0, 0, -1).applyQuaternion(camQuat(new THREE.Quaternion()));
  if (selfie) aimF.negate();   // aimed with the front camera: the booth is behind the phone's screen side
  place(); show('aim', false); show('hint', false); toast('Placed. Tap AIM again to re-centre.');
}
const ROWS = [
  ['dist', 'DISTANCE', 1, 25, 0.5, v => v.toFixed(1) + ' m'],
  ['lift', 'STAGE HEIGHT', -2, 2, 0.1, v => (v >= 0 ? '+' : '') + v.toFixed(1) + ' m'],
  ['robotX', 'DIRRODJ LEFT / RIGHT', -5, 5, 0.25, v => v.toFixed(2) + ' m'],
  ['robotZ', 'DIRRODJ BACK / FRONT', -2, 2, 0.25, v => v.toFixed(2) + ' m'],
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
// #438 AIM opens a choice: AIM (the ring on the centre DJ, as before) or AIM WITH BEACON (DirroBeacon venues only)
function aimMenu(on) { show('aimMenu', on); if (on) { show('panel', false); show('sms', false); $('mBcn').classList.toggle('off', !bcnStage()); } }
$('bAim').onclick = () => aimMenu($('aimMenu').classList.contains('hide'));
$('mAim').onclick = () => { aimMenu(false); BCN.step = 0; $('hint').textContent = 'Point the ring at the centre DJ, then tap'; show('aim', true); show('hint', true); aimF = null; BCN.fix = null; stage.visible = false; };
const BCN_HINT = ['', 'Put the ring on the LEFT beacon light, then tap', 'Now on the DJ in the headset (the head), then tap', 'Now the RIGHT beacon light, then tap'];
$('mBcn').onclick = () => {
  if (!bcnStage()) { toast('No DirroBeacons at this venue: use AIM'); return; }
  if (selfie) { toast('Switch to the back camera for the beacons'); return; }
  aimMenu(false); BCN.step = 1; BCN.dirs = []; BCN.pts = []; $('hint').textContent = BCN_HINT[1]; show('aim', true); show('hint', true);
};
function ringTap() {
  if (BCN.step) {
    const Bs = bcnStage(); if (!Bs) { BCN.step = 0; toast('The beacons are gone: use AIM'); return; }
    BCN.dirs.push(V(0, 0, -1).applyQuaternion(camQuat(new THREE.Quaternion())));
    BCN.pts.push(BCN.step === 1 ? Bs.L : BCN.step === 2 ? djHead() : Bs.R);
    if (BCN.step < 3) { BCN.step++; $('hint').textContent = BCN_HINT[BCN.step]; return; }
    BCN.step = 0;
    const fix = bcnSolve(BCN.dirs, BCN.pts);
    if (!fix) { toast('Those taps were all on one spot: try again'); BCN.step = 1; BCN.dirs = []; BCN.pts = []; $('hint').textContent = BCN_HINT[1]; return; }
    BCN.fix = fix; aimF = null; place(); show('aim', false); show('hint', false); $('hint').textContent = 'Point the ring at the centre DJ, then tap';
    toast(`Placed from the beacons: ${fix.dist.toFixed(1)} m from the stage`); return;
  }
  aim();
}
$('aim').onclick = ringTap;
$('bSet').onclick = () => { show('sms', false); const p = $('panel'); if (p.classList.contains('hide')) buildPanel(); p.classList.toggle('hide'); overBar(); aimMenu(false); };
$('bFlip').onclick = async () => {
  if (!stream) { toast('No camera on this device'); return; }
  selfie = !selfie; document.body.classList.toggle('selfie', selfie); $('bFlip').textContent = selfie ? 'BACK CAM' : 'SELFIE';
  try { await startCamera(selfie); resize(); } catch (e) { toast(e.message); }
  if (selfie && !people.on) setPeople(true);   // a selfie wants the show behind you
};
$('bPeople').onclick = () => setPeople(!people.on);
$('bPfx').onclick = async () => {   // #439
  people.fx = (people.fx + 1) % PFX.length; $('bPfx').textContent = people.fx ? 'FX: ' + PFX[people.fx] : 'FX';
  if (people.fx && !people.on) await setPeople(true);
  if (people.fx) toast(['', 'Your friend in op-art rings', 'Neon outline on the kick', 'Echo trails of every move', 'Hologram'][people.fx]);
};
// #437 RECORD: what is on screen (camera picture, the show, the people cutout; never the buttons) plus the phone's
// microphone (the club sound), up to 30 s, saved straight to the phone. MP4 where the phone can make it (iPhone,
// newer Android Chrome), else WebM. No watermark (owner: the scene carries the branding).
const rec = { on: false, mr: null, chunks: [], t0: 0, mic: null, timer: 0, vs: null };
function recMime() {
  if (!window.MediaRecorder) return '';
  for (const m of ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}
async function recStart() {
  if (!window.MediaRecorder || !canvas.captureStream) { toast('Recording is not supported in this browser'); return; }
  if (rec.mic === null) { try { rec.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); } catch (e) { rec.mic = false; toast('No microphone: recording without sound'); } }
  const vs = rec.vs = canvas.captureStream(30), tracks = [...vs.getVideoTracks()]; if (rec.mic) tracks.push(...rec.mic.getAudioTracks());
  const mime = recMime(); let mr;
  try { mr = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : { videoBitsPerSecond: 6e6 }); } catch (e) { for (const t of vs.getTracks()) t.stop(); toast('Could not start recording'); return; }
  rec.chunks = []; mr.ondataavailable = e => { if (e.data && e.data.size) rec.chunks.push(e.data); };
  mr.onstop = () => recSave(mr.mimeType || mime);
  mr.start(1000); rec.mr = mr; rec.on = true; rec.t0 = performance.now();
  $('bRec').classList.add('recOn'); recTick(); rec.timer = setInterval(recTick, 250);
}
function recTick() { const s = (performance.now() - rec.t0) / 1000; $('bRec').textContent = `\u25a0 ${Math.floor(s)} s`; if (s >= 30) recStop(); }
function recStop() {
  if (!rec.on) return; rec.on = false; clearInterval(rec.timer);
  try { rec.mr.stop(); } catch (e) {}
  $('bRec').classList.remove('recOn'); $('bRec').textContent = '\u25cf REC';
}
function recSave(type) {
  if (rec.vs) { for (const t of rec.vs.getTracks()) t.stop(); rec.vs = null; }   // the microphone stays open for the next clip
  const blob = new Blob(rec.chunks, { type: (type || 'video/webm').split(';')[0] }); rec.chunks = [];
  if (!blob.size) { toast('Nothing recorded'); return; }
  const ext = /mp4/.test(blob.type) ? 'mp4' : 'webm', d = new Date(), p = n => String(n).padStart(2, '0');
  const name = `cly3dj-dirrogram-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
  toast(`Saved ${name} (${(blob.size / 1048576).toFixed(1)} MB)`);
}
$('bRec').onclick = () => { if (rec.on) recStop(); else recStart(); };
document.addEventListener('visibilitychange', () => { if (document.hidden) recStop(); });   // the phone locked or switched app: keep what was filmed
// #435 HoloSMS: up to 140 characters to the DJ's tablet; the DJ decides what reaches the hologram scroller
$('bSms').onclick = () => { show('panel', false); const box = $('sms'), on = box.classList.contains('hide'); show('sms', on); if (on) setTimeout(() => $('smsIn').focus(), 50); };
$('smsCancel').onclick = () => show('sms', false);
$('smsIn').oninput = () => { $('smsN').textContent = `${[...$('smsIn').value].length} / 140`; };
$('smsSend').onclick = () => {
  const t = $('smsIn').value.replace(/\s+/g, ' ').trim().slice(0, 140); if (!t) return;
  if (!NET.ws || NET.ws.readyState !== 1 || !netLive(performance.now())) { toast('Not connected to the DJ right now'); return; }
  NET.ws.send(JSON.stringify({ k: 'sms', t })); $('smsIn').value = ''; $('smsN').textContent = '0 / 140'; show('sms', false);
};
// tapping anywhere while the ring shows = AIM
canvas.addEventListener('click', () => { if (!$('aim').classList.contains('hide') && (BCN.step || !aimF)) ringTap(); });

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
  show('start', false); show('bar', true); aimMenu(true);   // #438 start with the AIM choice
  resize();
  if (Q.has('demo')) { aimF = V(0, 0, -1); place(); aimMenu(false); }   // PC: placed straight ahead
};

// ---------------------------------------------------------------- start
drawCaption(); drawPromo(); drawScroller(); resize();
buildBooth().then(() => robotReady).then(() => { window.__dirroReady = true; });
renderer.setAnimationLoop(frame);
window.dirro = { get wfx() { return wfx; }, wallFx, /* #439 */ BCN, bcnSolve, bcnStage, liveCfg, rec, recStart, recStop, NET, people, setPeople, S, stage, booth, robot, laser, camera, scene, renderer, place, feedPose, live, beat, wall, scroller, set aim(v) { aimF = v; place(); }, get yaw() { return yaw; }, set yaw(v) { yaw = v; }, set pitch(v) { pitch = v; } };
