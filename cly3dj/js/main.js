import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';
import { parseLibrary } from './library.js';
import { readID3 } from './id3.js';
import { AudioEngine, PITCH_RANGE } from './audio.js';
import { REC, timeToRadius, radiusToTime, Screen, fitText, drawRecordSide, recordMaterial, setRecordSide, grooveAnisoMap } from './textures.js';
import { setupXR } from './xr.js';
import { makeNeonSign, bakeNeonImpostor, neonGlowTexture, GLOW_E, NEON, upgradeNeon } from './neon.js';
import { makeLedWall, LedPlayer, LED } from './ledwall.js';
import { DeckVideo, VIDEO_EXT, vvKey, baseName, deckGains } from './videovinyl.js';
import { glowMaterial, setGlowMode, makeBlob, placeBlob } from './fakelight.js';
import { loadDeckTemplate, makeGlbDeck, GLB_CREDIT } from './deck-glb.js';
import { instanceDecks, HIDE_LAYER } from './deck-inst.js';
import * as store from './storage.js';
import { EnvLight } from './env.js';
import { Skybox, detectLayout, leftEyeCanvas, brightestDir, savePano, loadPano, openPanoVideo, closePanoVideo } from './skybox.js';
import * as media from './medialib.js';
import { Stage, FlightCase } from './layout.js';
import { loadCaseKit } from './flightcase.js';
import { setRecordTexSize } from './textures.js';
import {
  initMaterials, MAT, tabletBodyMat, TABLET_T, makeDeck, makeMixer, makeCrate, makeMilkCrate, loadMilkCrate, loadMilkCrateBaked, upgradeMilkCrate, loadRecordCrateBaked, upgradeRecordCrate, loadMixerParts, initKTX2, loadBaked, MILK_CREDIT, Record3D, armYawForRadius,
  DECK, MIX, CRATE, MILK, W33, ARM, LID,
} from './models.js';

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
const CAMERA_ROLE = params.get('role') === 'camera';   // #161: this page is the spectator phone (spectator.html sends it here)
// start-screen settings, remembered per browser
const SETTINGS_DEFAULT = { source: 'pc', xml: 'rekordbox.xml', hands: 'real', glow: 'add', shadows: 'blob', env: 'studio', envMix: 50, micDevice: '', micEcho: false, micRoute: 'app',
  deckModel: 'classic', recWeight: '180', slipmat: 'slick', pll: false, spect: 'off', sky: 'off', arRefl: 60,
  skyH: 1.5, skyTurn: 0, skyType: 'auto', skyKey: 'on', skyFile: '', skyMedia: '' };   // turntable physics (#120)
const settings = (() => { try { return { ...SETTINGS_DEFAULT, ...JSON.parse(localStorage.getItem('vire.settings') || '{}') }; } catch { return { ...SETTINGS_DEFAULT }; } })();
if (params.get('xml')) { settings.source = 'pc'; settings.xml = params.get('xml'); }
if (settings.env === 'camera') settings.env = 'studio'; // camera snapshots removed (CLAUDE.md #39)
// #114: Recording-friendly mode removed (always 90 Hz, 'interactive' audio); the owner records with the Quest
// recorder's mic off, so the voice goes through the mixer; wired headphones, so no echo cancelling by default
if (!settings.mig114) { delete settings.perf; settings.micRoute = 'app'; settings.micEcho = false; settings.mig114 = 1; saveSettings(); }
let spect = null;   // #158 spectator host (declared early: drawMixScreen reads it, #164)
function saveSettings() { try { localStorage.setItem('vire.settings', JSON.stringify(settings)); } catch {} }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DECK_NAMES = ['A', 'B'];

// ------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
if (CAMERA_ROLE) { renderer.setPixelRatio(1); renderer.shadowMap.enabled = false; }   // #161: phone GPU
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color(0x0b0d12);
scene.background = BG;
const envLight = new EnvLight(renderer, scene, 1.0);   // environment carries the ambient light now (#82)

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 30); // tighter range = better depth precision in XR
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.12;
controls.minDistance = 0.25; controls.maxDistance = 4;
controls.maxPolarAngle = Math.PI * 0.49;

initMaterials();
const rig = new THREE.Group(); scene.add(rig);
const room = new THREE.Group(); rig.add(room); // hidden in passthrough

// Lights (owner, #82): environment-driven. The studio room / the owner's chosen image (scene.environment) gives
// the ambient light and reflections; one soft key from above remains for shape (and shadows outside
// Recording-friendly mode). The hemisphere fill and the blue/purple accent point lights are gone: every
// punctual light is a per-pixel cost on every lit material. Remaining punctual lights: key + the two
// decks' target-lamp spots.
const key = new THREE.DirectionalLight(0xffffff, 1.0);
key.position.set(0.4, 2.6, 1.2); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -1.2; key.shadow.camera.right = 1.5;
key.shadow.camera.top = 1; key.shadow.camera.bottom = -1; key.shadow.bias = -0.0004;
rig.add(key); rig.add(key.target); key.target.position.set(0.1, 0.9, 0);
const KEY_POS = key.position.clone();
// #182 grounded panorama skybox (skybox.js). Centred where the DJ stands: the XR origin, which is rig (0.05, 0, 0.62)
// because the rig is moved by (-0.05, 0, -0.62) in the headset. With real-time shadows a shadow-only floor
// catches the gear's shadows on the panorama's floor (the studio floor is hidden then).
const skybox = new Skybox(renderer); rig.add(skybox.group); skybox.group.position.x = 0.05; skybox.group.position.z = 0.62;
const skyShadow = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.ShadowMaterial({ opacity: 0.4 }));
skyShadow.rotation.x = -Math.PI / 2; skyShadow.position.y = 0.001; skyShadow.receiveShadow = true; skyShadow.visible = false; skyShadow.raycast = () => {};
rig.add(skyShadow);
let skyKeyLight = null;   // brightest direction + colour of the chosen image (for the key light)

// floor
const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.MeshStandardMaterial({ color: 0x0d0f15, roughness: 0.85, metalness: 0.1 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; room.add(floor);

// Gear (CLAUDE.md #38): each turntable, the mixer and the crate is its own movable object in rig space.
// Two resizable flight cases act as plinths; gear rests on whichever case is under it.
const DECK_X = MIX.W / 2 + DECK.W / 2 + 0.012;
let deckModel = 'procedural';
window.__vireStage = 'modules loaded; loading turntable GLB';
try { await loadDeckTemplate('models/turntable.glb'); deckModel = 'glb'; } catch (e) { console.warn('Deck GLB not loaded, using procedural decks', e); }
const deckGroups = deckModel === 'glb' ? [makeGlbDeck('A'), makeGlbDeck('B')] : [makeDeck('A'), makeDeck('B')];
deckGroups.forEach((d, i) => {
  rig.add(d);
  const k = i ? 'deckB' : 'deckA';
  d.traverse(o => {
    if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true;
    if (o.userData.control || o.userData.platterOf) return;
    // grab the body sides / feet to move a deck (never the top plate, where the controls are)
    const glbBody = /^polySurface20|^polySurface[2789]_foot|^polySurface[2789]_metal/.test(o.name);
    if (glbBody || (deckModel !== 'glb' && (o.material === MAT.black || o.material === MAT.alu))) o.userData.move = k;
  });
});
window.__vireStage = 'loading mixer parts';
try { await loadMixerParts('models/mixer_parts.glb'); } catch (e) { console.warn('mixer parts GLB not loaded, using procedural buttons/knobs/caps', e); }   // #134
window.__vireStage = 'building mixer';
const deckInst = deckModel === 'glb' ? instanceDecks(deckGroups[0], deckGroups[1], scene) : null;   // #154: one draw for each part both decks share
const mixer = makeMixer(); rig.add(mixer);
mixer.traverse(o => { if (o.isMesh && !o.userData.control && o.material === MAT.black) o.userData.move = 'mixer'; });

const crate = makeCrate();
const crateRig = new THREE.Group(); rig.add(crateRig);
crate.position.set(0, 0, 0); crateRig.add(crate);
crate.traverse(o => { if (o.isMesh && !o.userData.crateSleeves && !o.userData.crateScreen && !o.userData.lid) o.userData.move = 'crate'; });

// ---- crate lid on hinges (owner, 26 Sep). Grab the handle (on top when shut) or the lid's free edge and
// swing it; let go and it falls the way its weight takes it: past LID.BAL (just forward of upright) it
// drops shut, behind that it falls back onto its open stop. Desktop: click the lid to open/close it,
// drag up/down to swing it. While it's shut the records can't be flipped or pulled and the selected
// record sinks back into its sleeve. State survives reloads (localStorage 'vire.crateLid').
const lidSt = { a: LID.OPEN, v: 0, mode: null, goal: 'open', t: 0, from: 0, wasOpen: true };
try {   // saved as 'open', 'closed' or a resting angle in radians (#86)
  const v = localStorage.getItem('vire.crateLid'), n = parseFloat(v);
  if (v === 'closed') { lidSt.a = LID.CLOSED; lidSt.goal = 'closed'; }
  else if (Number.isFinite(n)) { lidSt.a = clamp(n, LID.OPEN, LID.CLOSED); lidSt.goal = null; }
  lidSt.wasOpen = lidSt.a < 0.3 && lidSt.goal !== 'closed';
} catch (e) {}
crate.userData.lid.rotation.x = lidSt.a;
function crateLidOpen() { return lidSt.a < 0.3 && lidSt.goal !== 'closed'; }
function lidAngleOf(worldP) { // hinge-relative angle of a point, in the crate's y-z plane
  const l = crate.worldToLocal(_lidV.copy(worldP));
  return Math.atan2(l.z - LID.PIVOT.z, l.y - LID.PIVOT.y);
}
const _lidV = new THREE.Vector3();
function lidGrab() { lidSt.mode = 'hand'; lidSt.goal = null; lidSt.v = 0; }
function lidSet(a) { lidSt.a = clamp(a, LID.OPEN, LID.CLOSED); }
// Let go (owner, #86): a friction hinge. Within 20 deg of shut it drops closed; opened past 100 deg it falls back
// onto its open stop (~114 deg); anywhere in between it stays exactly where it was left.
const LID_SNAP_SHUT = LID.CLOSED - 20 * Math.PI / 180, LID_SNAP_OPEN = LID.CLOSED - 100 * Math.PI / 180;
function lidRelease() {
  lidSt.v = 0;
  if (lidSt.a > LID_SNAP_SHUT) { lidSt.mode = 'fall'; lidSt.goal = 'closed'; }
  else if (lidSt.a < LID_SNAP_OPEN) { lidSt.mode = 'fall'; lidSt.goal = 'open'; }
  else { lidSt.mode = null; lidSt.goal = null; saveLid(); }
}
function saveLid() { try { localStorage.setItem('vire.crateLid', lidSt.goal === 'closed' ? 'closed' : lidSt.goal === 'open' ? 'open' : lidSt.a.toFixed(3)); } catch (e) {} }
function lidShut() { return !lidSt.mode && lidSt.a >= LID.CLOSED - 0.01; }
function lidToggle() {
  const shut = lidSt.goal === 'closed' || (lidSt.goal === null && lidSt.a > LID.BAL);
  lidSt.goal = shut ? 'open' : 'closed'; lidSt.mode = 'ease'; lidSt.from = lidSt.a; lidSt.t = 0;
}
function stepLid(dt) {
  const L = lidSt;
  if (L.mode === 'ease') {            // lifted and lowered by hand: smooth, ~0.8 s end to end
    const to = L.goal === 'closed' ? LID.CLOSED : LID.OPEN;
    L.t = Math.min(1, L.t + dt / (0.8 * Math.abs(to - L.from) / (LID.CLOSED - LID.OPEN) + 0.15));
    const k = L.t * L.t * (3 - 2 * L.t); L.a = L.from + (to - L.from) * k;
    if (L.t >= 1) { L.mode = null; saveLid(); }
  } else if (L.mode === 'fall') {     // let go: gravity about the hinge, small bounce on the stop
    const to = L.goal === 'closed' ? LID.CLOSED : LID.OPEN, dir = L.goal === 'closed' ? 1 : -1;
    L.v += dir * 7 * (Math.abs(Math.sin(L.a - LID.BAL)) + 0.25) * dt; L.a += L.v * dt;
    if (dir * (L.a - to) >= 0) {
      L.a = to;
      if (Math.abs(L.v) > 0.8) L.v = -L.v * 0.18; else { L.v = 0; L.mode = null; saveLid(); }
    }
  }
  crate.userData.lid.rotation.x = L.a;
  const open = crateLidOpen();
  if (open !== L.wasOpen) {
    L.wasOpen = open; layoutSleeves();
  }
}
// XR direct touch: the handle's grip bar, or anywhere along the lid's free edge
function lidGrabTest(P) {
  const lid = crate.userData.lid, h = crate.userData.lidHandle;
  const l = lid.worldToLocal(_lidV.copy(P));
  if (Math.abs(l.x) < h.x + 0.02 && Math.hypot(l.y - h.y, l.z - h.z) < 0.035) return 'handle';
  const top = LID.Y0 + LID.LL;
  return (Math.abs(l.x) < CRATE.W / 2 + 0.02 && l.y > top - 0.045 && l.y < top + 0.03 && l.z > -LID.T - 0.03 && l.z < 0.02) ? 'edge' : null;
}

// spare crate for records mid-set (CLAUDE.md #61): the owner's "Plastic Crate 02" GLB in black,
// or a procedural green milk crate if the model is missing
// (#68: owner chose the built-in green milk crate over the plastic crate GLB; loadMilkCrate() is kept but unused)
const milk = makeMilkCrate();
rig.add(milk);
milk.traverse(o => { if (o.isMesh) o.userData.move = 'milk'; });
// More milk crates (owner, #88): spawned from the crate icon on the lid screen, up to 6 in all. Keys milk2..milk6
// are ordinary stage items (saved with the layout); which ones exist is kept in 'vire.milkKeys'. Tossing an
// extra crate away (thrown or dragged more than 3 m from the decks) deletes it with its records.
const MILK_MAX = 6, MILK_FAR = 3.0;   // desktop drag-away distance from the decks (thrown: see releaseMilk, #200)
const extraMilk = {};
function newMilk(key) { const m = makeMilkCrate(); m.userData.key = key; rig.add(m); m.traverse(o => { if (o.isMesh) o.userData.move = key; }); extraMilk[key] = m; return m; }
try { for (const k of JSON.parse(localStorage.getItem('vire.milkKeys') || '[]')) if (/^milk[2-6]$/.test(k)) newMilk(k); } catch (e) {}
milk.userData.key = 'milk';
function milks() { return [milk, ...Object.values(extraMilk)]; }
// #124: Blender-baked crate body; crates already in the scene switch over when it arrives, the procedural body stays
// if the file is missing
initKTX2(renderer);   // #132
loadRecordCrateBaked('models/record_crate.glb').then(() => upgradeRecordCrate(crate))   // #127
  .catch(e => console.warn('record crate GLB not loaded, keeping the procedural crate', e));
Promise.resolve()   // #192: the cut-out crate (models.js) replaces the baked GLB; loadMilkCrateBaked / upgradeMilkCrate kept for a switch back
  .catch(e => console.warn('milk crate GLB not loaded, keeping the procedural crate', e));
function milkOf(o) { const all = milks(); while (o) { if (all.includes(o)) return o; o = o.parent; } return null; }
// neon sign prop (CLAUDE.md #80): moves like the gear; two hands on the two centre bars resize it; its size is
// kept in localStorage 'vire.neonScale'
const neon = makeNeonSign();
rig.add(neon);
neon.traverse(o => { if (o.isMesh) o.userData.move = 'neon'; });
bakeNeonImpostor(renderer, neon);   // far LOD image (CLAUDE.md #83)
upgradeNeon(neon, loadBaked).then(() => { if (!renderer.xr.isPresenting) bakeNeonImpostor(renderer, neon); }).catch(e => console.warn('neon GLB not loaded, keeping the procedural sign', e));   // #133; #144 far image re-baked from the glass sign

// ---- fake light (owner, #96; fakelight.js): the neon's glow on the wall behind it and blob shadows, instead of
// real lights and shadow maps. Both are switched on the start screen (Neon wall glow, Shadows).
const WALL_Z = -0.6;   // studio back wall (rig z) for full VR and desktop; in passthrough your real wall is used
const studioWall = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.4), new THREE.MeshStandardMaterial({ color: 0x17171b, roughness: 0.95, metalness: 0 }));
studioWall.position.set(0, 1.7, WALL_Z); studioWall.receiveShadow = true; studioWall.raycast = () => {}; room.add(studioWall);
const glowMat = glowMaterial(neonGlowTexture());
const wallGlow = new THREE.Mesh(new THREE.PlaneGeometry(2 * GLOW_E, 2 * GLOW_E), glowMat);
wallGlow.renderOrder = 2; wallGlow.raycast = () => {}; neon.add(wallGlow);
let arMode = false;
const GLOW_BACK = 0.05;   // passthrough: the glow lands 5 cm behind the tubes, so hang the sign ~5 cm off your real wall
function stepWallGlow() {
  studioWall.visible = settings.glow !== 'off';
  if (settings.glow === 'off') { wallGlow.visible = false; return; }
  const s = neon.scale.x; let d;   // tubes-to-wall distance, metres
  if (arMode) d = GLOW_BACK;
  else {   // full VR / desktop: the glow lands on the studio wall when the sign faces it from up to 60 cm away
    const yaw = Math.atan2(Math.sin(neon.rotation.y), Math.cos(neon.rotation.y));
    d = neon.position.z + 0.03 * s - WALL_Z;
    if (Math.abs(yaw) > 0.6 || d < 0 || d > 0.6) { wallGlow.visible = false; return; }
  }
  wallGlow.visible = true;
  wallGlow.position.z = 0.03 - d / s;                 // neon-local units (the group is scaled)
  wallGlow.scale.setScalar(1 + d * 1.2);              // further from the wall = wider, softer (#98: spread less)
  glowMat.uniforms.uI.value = (neon.userData.level ?? 1) * 0.5 / (1 + (d / 0.12) ** 2);   // #98: tighter, deeper-red texture; was 0.75 with the wide one   // and dimmer; flickers with the tubes
}
// blob shadows: one soft quad under each piece of gear, crate and flight case (rig space) and under records in
// the air or lying about (scene space). Each lands on the highest known surface under it: floor, flight case,
// record crate or milk crate. Above an unknown surface (a real table in passthrough) it fades out by 35 cm.
const blobs = new Map(), _bp = new THREE.Vector3();
function blobFor(key, kind, parent) { let b = blobs.get(key); if (!b) { b = makeBlob(kind); parent.add(b); blobs.set(key, b); } return b; }
function supportUnderItem(key, x, z, bottom) {
  let y = 0; const c = stage.caseTopAt(x, z, key); if (c.key && c.y <= bottom + 0.02) y = Math.max(y, c.y);
  for (const [k2, it] of Object.entries(stage.items)) {
    if (k2 === key || !/^(crate|milk\d?)$/.test(k2)) continue;
    const o = it.obj, rc = k2 === 'crate', H = rc ? CRATE.H : MILK.H, W = rc ? CRATE.W : MILK.W, D = rc ? CRATE.D : MILK.D;
    const dx = x - o.position.x, dz = z - o.position.z, cs = Math.cos(o.rotation.y), sn = Math.sin(o.rotation.y);
    const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
    if (Math.abs(lx) < W / 2 && Math.abs(lz) < D / 2) { const top = o.position.y + H; if (top <= bottom + 0.02) y = Math.max(y, top); }
  }
  return y;
}
// #142 (owner): the record crate and the milk crates have a solid underside. While one is carried it can't sink
// into what is below it (floor, flight case, another crate, a turntable or the mixer): its bottom stays on the
// highest top under its footprint, so crates stack instead of cutting through. Let go within 6 cm above such a
// top and it settles onto it. Footprints are oriented rectangles in rig space (SAT test), 1 cm inset so crates can
// stand snugly side by side without climbing onto each other.
const STACK_KEYS = /^(crate|milk\d?)$/;
function localBoxOf(o) {   // gear (decks, mixer): the object's own-frame bounding box, measured once
  if (o.userData.__lbox) return o.userData.__lbox;
  o.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(o.matrixWorld).invert(), b = new THREE.Box3(), bb = new THREE.Box3(), M = new THREE.Matrix4();
  o.traverseVisible(m => {
    if (!m.isMesh || !m.geometry || m.isInstancedMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material]; if (mats.every(x => x && x.visible === false)) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    b.union(bb.copy(m.geometry.boundingBox).applyMatrix4(M.multiplyMatrices(inv, m.matrixWorld)));
  });
  return (o.userData.__lbox = b);
}
function footprint(o, W, D, cx = 0, cz = 0) {   // oriented rectangle of object o (rig space)
  const c = Math.cos(o.rotation.y), sn = Math.sin(o.rotation.y);
  return { x: o.position.x + cx * c + cz * sn, z: o.position.z - cx * sn + cz * c, ux: [c, -sn], uz: [sn, c], hw: W / 2, hd: D / 2 };
}
function rectsOverlap(a, b) {
  const proj = (r, ax) => r.hw * Math.abs(r.ux[0] * ax[0] + r.ux[1] * ax[1]) + r.hd * Math.abs(r.uz[0] * ax[0] + r.uz[1] * ax[1]);
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const ax of [a.ux, a.uz, b.ux, b.uz]) if (Math.abs(dx * ax[0] + dz * ax[1]) > proj(a, ax) + proj(b, ax)) return false;
  return true;
}
function stackTops(key) {   // [{ top, key }] of everything under the footprint of stack item `key`
  const o = stage.items[key].obj, rc = key === 'crate';
  const me = footprint(o, (rc ? CRATE.W : MILK.W) - 0.02, (rc ? CRATE.D : MILK.D) - 0.02);
  const out = [];
  for (const k in cases) { const c = cases[k], g = c.group; if (rectsOverlap(me, footprint(g, c.W, c.D))) out.push({ top: g.position.y + c.H, key: k }); }
  for (const [k, it] of Object.entries(stage.items)) {
    if (k === key || k === 'neon' || k === 'ledwall') continue;
    const g = it.obj; let fp, top;
    if (STACK_KEYS.test(k)) { const r2 = k === 'crate'; fp = footprint(g, r2 ? CRATE.W : MILK.W, r2 ? CRATE.D : MILK.D); top = g.position.y + (r2 ? CRATE.H : MILK.H); }
    else { const b = localBoxOf(g); fp = footprint(g, b.max.x - b.min.x, b.max.z - b.min.z, (b.max.x + b.min.x) / 2, (b.max.z + b.min.z) / 2); top = g.position.y + b.max.y; }
    if (rectsOverlap(me, fp)) out.push({ top, key: k });
  }
  return out;
}
function stackFloor(key, bottom = Infinity) {   // highest top under it that its bottom could rest on (<= bottom + 3 cm)
  let y = 0; for (const t of stackTops(key)) if (t.top <= bottom + 0.03) y = Math.max(y, t.top);
  return y;
}
function clampStack(key) {   // while carried: never below the highest top under its footprint
  if (!STACK_KEYS.test(key) || !stage.items[key]) return;
  const p = stage.items[key].obj.position; let y = 0; for (const t of stackTops(key)) y = Math.max(y, t.top);
  if (p.y < y) p.y = y;
}
function settleStack(key) {   // let go: settle onto the top just under it (within 6 cm), otherwise stay put
  if (!STACK_KEYS.test(key) || !stage.items[key]) return;
  const p = stage.items[key].obj.position, y = stackFloor(key, p.y);
  if (p.y - y < 0.06) p.y = y;
  stage.save();
}
const BLOB_GEAR = { deckA: [DECK.W, DECK.D, 0.58], deckB: [DECK.W, DECK.D, 0.58], mixer: [MIX.W, MIX.D, 0.58], crate: [CRATE.W + 0.016, CRATE.D + 0.016, 0.63] };   // #98: 15% darker
function stepBlobs() {
  const on = settings.shadows === 'blob' || settings.shadows === 'both';
  if (!on) { for (const b of blobs.values()) b.visible = false; return; }
  const items = { ...BLOB_GEAR }; for (const k of Object.keys(stage.items)) if (k.startsWith('milk')) items[k] = [MILK.W, MILK.D, 0.52];
  for (const [k, b] of blobs) if (!k.startsWith('rec') && !items[k] && !cases[k]) b.visible = false;   // removed milk crates
  for (const [k, [w, d, str]] of Object.entries(items)) {
    const it = stage.items[k]; if (!it) continue; const o = it.obj;
    const bottom = o.position.y - (it.base || 0), sy = supportUnderItem(k, o.position.x, o.position.z, bottom);
    placeBlob(blobFor(k, 'box', rig), o.position.x, sy, o.position.z, w, d, o.rotation.y, bottom - sy, str);
  }
  for (const k in cases) { const c = cases[k], g = c.group; placeBlob(blobFor(k, 'box', rig), g.position.x, 0, g.position.z, c.W, c.D, g.rotation.y, g.position.y, 0.52); }
  // no blobs under records (owner, #98: they glitched)
}
// real-time shadows: only when chosen, and never in Recording-friendly mode in the headset
function applyShadows(xrLight = false) {
  const rt = (settings.shadows === 'realtime' || settings.shadows === 'both') && !xrLight;
  key.castShadow = rt;
  if (renderer.shadowMap.enabled !== rt) { renderer.shadowMap.enabled = rt; scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); }); }
}
setGlowMode(glowMat, settings.glow);
applyShadows(false);   // desktop default: per the Shadows setting (blob by default = no shadow map)
// LED wall (#176): moves like the neon sign; wheel / two hands resize it; size kept in 'vire.ledScale'
const ledwall = makeLedWall(); rig.add(ledwall);
try { const s = parseFloat(localStorage.getItem('vire.ledScale')); if (s > 0) ledwall.scale.setScalar(clamp(s, 0.4, 4)); } catch (e) {}
const ledBase = () => (LED.H / 2 + LED.BEZ) * ledwall.scale.x;
function setLedScale(s) { s = clamp(s, 0.4, 4); ledwall.scale.setScalar(s); if (stage) stage.items.ledwall.base = ledBase(); return s; }
function saveLedScale() { try { localStorage.setItem('vire.ledScale', String(ledwall.scale.x)); } catch (e) {} }
const led = new LedPlayer(ledwall);
// #188 / #195 / #196 camera preview: the spectator phone's picture (small JPEGs, ~6 a second) while grading from the
// mixer's CAMERA tab. #196 (owner): a thin screen (3 mm) that lives inside the 7 mm tablet and slides up out of its top
// edge when PREVIEW goes on, and back down inside when it goes off (eased, like the deck lamps). Headset only (noMirror).
const PVL = { W: 0.196, H: 0.078, T: 0.003, UP: 0.075 };   // UP: lid centre height when out (4 mm stays inside the tablet)
const pvLid = new THREE.Group(); pvLid.name = 'previewLid'; pvLid.visible = false; pvLid.userData.noMirror = true;
pvLid.position.set(0, 0, -0.0005); mixer.userData.tablet.add(pvLid);
const pvTex = new THREE.Texture(); pvTex.colorSpace = THREE.SRGBColorSpace; pvTex.flipY = false;
{ const body = new THREE.Mesh(new THREE.BoxGeometry(PVL.W, PVL.H, PVL.T), tabletBodyMat()); body.raycast = () => {}; pvLid.add(body); }
const pvScreen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x202020, toneMapped: false }));
pvScreen.position.set(0, 0, PVL.T / 2 + 0.0004); pvScreen.raycast = () => {}; pvLid.add(pvScreen);
// #197 (owner): held on its side (portrait), the lid comes out of whichever short edge is on top instead, which makes it
// a tall portrait panel above the tablet; the picture is turned to stay upright. Changing side = slide in, switch, slide out.
let pvDir = 'up';   // 'up' = out of the top edge; 'px' / 'nx' = out of the +x / -x short edge
const PV_SIDE = PVL.W / 2 + 0.1 - 0.004;   // lid centre when out sideways (4 mm stays in the tablet)
function pvAspect(a) {   // fit the phone's picture inside the lid's screen area, letterboxed (area turned for the side modes)
  const side = pvDir !== 'up', W = (side ? PVL.H : PVL.W) - 0.006, H = (side ? PVL.W : PVL.H) - 0.006;
  if (a > W / H) pvScreen.scale.set(W, W / a, 1); else pvScreen.scale.set(H * a, H, 1);
  pvScreen.rotation.z = pvDir === 'px' ? -Math.PI / 2 : pvDir === 'nx' ? Math.PI / 2 : 0;
}
pvAspect(0.45);
let pvLidT = 0;   // 0 = inside, 1 = out
const _pvUp = new THREE.Vector3(), _tqi = new THREE.Quaternion();
function pvWantDir() { return tabletDir(pvDir); }
function tabletDir(cur) {   // which tablet edge points most upward, with a dead zone so it doesn't flicker at 45 deg (cur = current answer)
  if (TABLET.position.distanceTo(TDOCK.p) < 1e-4) return 'up';
  _pvUp.set(0, 1, 0).applyQuaternion(TABLET.getWorldQuaternion(_tqi).invert());
  const ang = Math.atan2(_pvUp.x, _pvUp.y) * 180 / Math.PI;   // 0 = upright landscape, +90 = +x edge up
  if (cur === 'up') return ang > 55 ? 'px' : ang < -55 ? 'nx' : 'up';
  if (cur === 'px') return ang < 35 ? (ang < -55 ? 'nx' : 'up') : 'px';
  return ang > -35 ? (ang > 55 ? 'px' : 'up') : 'nx';
}
function stepPvLid(dt) {
  const dir = pvWanted ? pvWantDir() : pvDir;
  const want = pvWanted && dir === pvDir ? 1 : 0;   // a new side: slide in first
  if (pvLidT === 0 && dir !== pvDir) { pvDir = dir; pvAspect(pvA); }
  if (pvLidT === want && (want === 0 ? !pvLid.visible : true)) return;
  pvLidT = want > pvLidT ? Math.min(1, pvLidT + dt / 0.45) : Math.max(0, pvLidT - dt / 0.45);
  const e = pvLidT * pvLidT * (3 - 2 * pvLidT);
  pvLid.position.x = pvDir === 'px' ? PV_SIDE * e : pvDir === 'nx' ? -PV_SIDE * e : 0;
  pvLid.position.y = pvDir === 'up' ? PVL.UP * e : 0;
  pvLid.visible = pvLidT > 0;
}
let pvWanted = false, pvLast = 0, pvDecoding = false, pvA = 0.45;
function onPreviewFrame(buf) {
  if (!pvWanted || pvDecoding) return; pvDecoding = true;
  createImageBitmap(new Blob([buf], { type: 'image/jpeg' }), { imageOrientation: 'flipY' }).then(b => {
    const old = pvTex.image; pvTex.image = b; pvTex.needsUpdate = true; if (old && old.close) old.close();
    if (!pvScreen.material.map) { pvScreen.material.map = pvTex; pvScreen.material.color.setScalar(1); pvScreen.material.needsUpdate = true; }
    const a = b.width / b.height; if (Math.abs(a - pvA) > 0.01) { pvA = a; pvAspect(a); }
    pvLast = performance.now();
  }).catch(() => {}).finally(() => { pvDecoding = false; });
}
function setPreview(on) {
  pvWanted = on;   // #196 stepPvLid slides the lid out / in
  if (spect && spect.camSet) spect.camSet({ what: 'preview', v: on });
  drawMixScreen();
}
led.onChange = () => drawMixScreen();
// #177 VideoVinyl + LED wall modes. LED WALL cycles OFF -> CLIPS (if videos were picked) -> DECKS -> OFF.
let ledMode = 'off';
const deckVid = [new DeckVideo(), new DeckVideo()];
let vvIndex = new Map();          // headset: title key -> OPFS path of the video
const vvPC = new Map();           // PC: title key -> Promise<url|null> (HEAD videos/<title>.mp4)
function vvSource(t) {
  const key = vvKey(t.name);
  if (settings.source === 'headset') { const p = vvIndex.get(key); return Promise.resolve(p ? store.readFile(p) : null); }
  if (!vvPC.has(key)) {
    const url = 'videos/' + encodeURIComponent(t.name.trim()) + '.mp4';
    vvPC.set(key, fetch(url, { method: 'HEAD' }).then(r => (r.ok ? url : null)).catch(() => null));
  }
  return vvPC.get(key);
}
// #185 (owner): a Video library clip put on a deck from the mixer's Video page replaces the title match for the record
// that is on the deck now; it clears when that record comes off.
const vvOverride = [null, null];   // { rec, name }
function vvStep(d) {   // per frame: open/close the deck's video to match its track, then follow the playhead
  if (vvOverride[d.i] && vvOverride[d.i].rec !== d.record) vvOverride[d.i] = null;
  const dv = deckVid[d.i], ov = vvOverride[d.i], t = d.record && d.track, want = ov ? 'media:Video/' + ov.name : t ? vvKey(t.name) : null;
  if (want !== dv.want) {
    dv.want = want; dv.close();
    const srcP = ov ? media.getFile('Video', ov.name) : t ? vvSource(t) : null;
    if (srcP) srcP.then(src => { if (src && dv.want === want) { dv.open(want, src); drawMixScreen(); } }).catch(() => {});
    drawMixScreen();
  }
  if (dv.v) dv.follow(engine.ctx ? engine.pos(d.i) : 0, engine.state.decks[d.i].rate || 0);
}
function setLedMode(m) {
  if (m === 'clips' && !led.hasFiles) m = 'decks';
  if (m !== 'clips' && led.on) led.stop();
  ledMode = m;
  if (m === 'clips') led.playRandom();
  else if (m === 'off') ledwall.userData.setVideo(null);
  drawMixScreen();
}
function setNeonScale(s) { s = clamp(s, 0.3, 4); neon.scale.setScalar(s); neon.userData.setLodScale(s); if (stage) stage.items.neon.base = NEON.R * s; return s; }
function saveNeonScale() { try { localStorage.setItem('vire.neonScale', String(neon.scale.x)); } catch (e) {} }
try { const s = parseFloat(localStorage.getItem('vire.neonScale')); if (s > 0) { neon.scale.setScalar(clamp(s, 0.3, 4)); neon.userData.setLodScale(neon.scale.x); } } catch (e) {}
// one flight case (owner, #84): the second case under the record crate is gone; the crate has no gravity, so it
// stands on the floor, on the milk crate or (in passthrough) on real furniture wherever it is let go
window.__vireStage = 'building flight case';
const cases = { caseA: new FlightCase('caseA', 1.3, 0.52, 0.88) };
loadCaseKit('models/flight_case_kit.glb', loadBaked).then(() => { for (const c of Object.values(cases)) c.build(); }).catch(e => console.warn('flight case kit not loaded, keeping the procedural case', e));   // #135
const stage = new Stage(rig, {
  deckA: { obj: deckGroups[0], base: 0.018 },
  deckB: { obj: deckGroups[1], base: 0.018 },
  mixer: { obj: mixer, base: 0 },
  crate: { obj: crateRig, base: 0 },
  milk: { obj: milk, base: 0 },
  ...Object.fromEntries(Object.entries(extraMilk).map(([k, m]) => [k, { obj: m, base: 0 }])),
  neon: { obj: neon, base: NEON.R * neon.scale.x },
  ledwall: { obj: ledwall, base: ledBase() },
}, cases, {
  items: { deckA: [-DECK_X, 0.898, 0, 0], deckB: [DECK_X, 0.898, 0, 0], mixer: [0, 0.88, 0, 0], crate: [0.98, 0, 0.12, -0.5], milk: [-1.0, 0, 0.15, 0.35], milk2: [-1.0, 0, 0.68, 0.35], milk3: [-1.47, 0, 0.3, 0.2], milk4: [-1.47, 0, 0.83, 0.2], milk5: [-1.0, 0, 1.21, 0.35], milk6: [-1.47, 0, 1.36, 0.2], neon: [0, 1.45, -0.5, 0], ledwall: [-2.0, 1.6, -0.55, 0] },
  cases: { caseA: [0, 0, 0, 0, 1.3, 0.52, 0.88] },
});
const MOVABLE = new Proxy({}, { get: (_, k) => stage.object(k) });
function saveLayout() { stage.save(); }
// #84 migration: layouts saved with the second flight case had the record crate standing on it; with that case
// gone, put the crate on the floor (once) instead of leaving it floating
try { const L = JSON.parse(localStorage.getItem('vire.layout2')); if (L && L.cases && L.cases.caseB) { const c = L.cases.caseB, p = crateRig.position; if (Math.abs(p.y - (c[1] + c[6])) < 0.04) p.y = 0; stage.save(); } } catch (e) {}
function saveMilkKeys() { try { localStorage.setItem('vire.milkKeys', JSON.stringify(Object.keys(extraMilk))); } catch (e) {} }
function spawnMilk() {
  const free = ['milk2', 'milk3', 'milk4', 'milk5', 'milk6'].find(k => !extraMilk[k]);
  if (!free) { toast(`That's the lot: ${MILK_MAX} milk crates`); return null; }
  const m = newMilk(free); stage.items[free] = { obj: m, base: 0 };
  placeMilk(m);   // on the floor near the record crate
  m.scale.setScalar(0.01); m.userData.pop = 0;   // grows in over ~0.25 s (stepMilkCrates)
  saveMilkKeys(); stage.save(); toast('Milk crate added. Toss it away to remove it');
  return m;
}
function removeMilk(key) {
  const m = extraMilk[key]; if (!m) return;
  for (let i = loose.length - 1; i >= 0; i--) if (loose[i].milk === m) { loose[i].rec.dispose(); loose.splice(i, 1); }   // its records go back to the library
  rig.remove(m); m.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
  delete extraMilk[key]; delete stage.items[key]; flyingMilk.delete(m);
  saveMilkKeys(); stage.save(); toast('Milk crate removed');
}
// let go of a moved milk crate. #200 (owner): thrown or dropped it flies with simple physics: gravity, bounces
// (plastic crate: 35 % of the landing speed comes back), skids to a stop with friction, spins and rocks back flat on
// its base; it lands on anything under it (case, other crates) and knocks back off their sides. Once it is more than
// 1 m from you (horizontally) it shrinks away over 1 s: an extra crate is deleted with its records, the first crate
// comes back beside the record crate. On the desktop, dragged beyond 3 m from the decks an extra crate is deleted.
const flyingMilk = new Map();
const MILK_GONE_R = 1.0, MILK_GONE_T = 1.0, MILK_E = 0.35, MILK_MU = 0.45;
function placeMilk(m) {   // first free spot on the floor round the record crate (front first), clear of the case and crates
  const c = crateRig, up = new THREE.Vector3(0, 1, 0), blockers = [cases.caseA.group, crateRig, ...milks().filter(x => x !== m)].map(o => new THREE.Box3().setFromObject(o).expandByScalar(0.03));
  m.rotation.set(0, c.rotation.y, 0); m.position.set(c.position.x, 0, c.position.z + 0.5);
  for (const r of [0.45, 0.85, 1.25]) for (const deg of [0, 45, -45, 90, -90, 135, -135, 180]) {
    const off = new THREE.Vector3(0, 0, r).applyAxisAngle(up, c.rotation.y + deg * Math.PI / 180);
    m.position.set(c.position.x + off.x, 0, c.position.z + off.z); m.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(m);
    if (!blockers.some(b => b.intersectsBox(bb))) return;
  }
}
function releaseMilk(key, vel) {
  const m = key === 'milk' ? milk : extraMilk[key]; if (!m) return;
  const v = vel ? vel.clone().applyQuaternion(rig.getWorldQuaternion(new THREE.Quaternion()).invert()) : new THREE.Vector3();
  const air = m.position.y - (stage.items[key] ? stackFloor(key, m.position.y + 0.01) : 0);
  if (v.length() > 0.5 || air > 0.02) {
    m.rotation.reorder('YXZ');   // y = heading, x / z = tilt
    const sp = v.length(), r = () => Math.random() - 0.5;
    flyingMilk.set(m, { key, vel: v, spin: r() * 2 * Math.min(6, 1 + sp * 1.2), tv: new THREE.Vector2(r() * sp * 1.4, r() * sp * 1.4), ground: false, t: 0 });
    return;
  }
  if (stage.items[key]) settleStack(key);
  if (key !== 'milk' && Math.hypot(m.position.x, m.position.z) > MILK_FAR) removeMilk(key);
}
function stepFlyingMilk(m, f, h) {
  const v = f.vel, p = m.position, rot = m.rotation, key = f.key, staged = !!stage.items[key];
  const sink = () => MILK.D / 2 * Math.abs(Math.sin(rot.x)) + MILK.W / 2 * Math.abs(Math.sin(rot.z));   // tilted: a corner dips below the origin
  v.y -= GRAV * h;
  // sideways, knocking back off anything taller than where the crate's bottom is (the flight case, a stack)
  const ox = p.x, oz = p.z; p.x += v.x * h; p.z += v.z * h; rot.y += f.spin * h;
  if (staged) {
    let top = 0; for (const t of stackTops(key)) top = Math.max(top, t.top);
    if (top > p.y - sink() + 0.04) { p.x = ox; p.z = oz; v.x *= -0.3; v.z *= -0.3; f.spin *= 0.5; f.tv.x += (Math.random() - 0.5) * 2; }
  }
  // tilt: free in the air (limited), springs back flat on its base once it is down
  if (f.ground) f.tv.addScaledVector(new THREE.Vector2(rot.x, rot.z), -80 * h).multiplyScalar(Math.max(0, 1 - 13 * h));
  rot.x += f.tv.x * h; rot.z += f.tv.y * h;
  for (const a of ['x', 'z']) if (Math.abs(rot[a]) > 0.7) { rot[a] = Math.sign(rot[a]) * 0.7; f.tv[a === 'x' ? 'x' : 'y'] *= -0.3; }
  // down: bounce, or come to rest on the floor / whatever is under it
  const was = p.y - sink();   // #201 bottom before this step: tops below it can catch the crate (no tunnelling at speed)
  p.y += v.y * h;
  const s = sink(), fl = staged ? stackFloor(key, Math.max(was, p.y - s) + 0.03) : 0;
  if (p.y - s <= fl) {
    p.y = fl + s;
    if (v.y < 0) {
      const hit = -v.y;
      if (hit > 0.6) {
        v.y = hit * MILK_E; v.x *= 0.7; v.z *= 0.7; f.spin *= 0.6;
        f.tv.x += (Math.random() - 0.5) * hit * 0.6; f.tv.y += (Math.random() - 0.5) * hit * 0.6; f.ground = false;
      } else { v.y = 0; f.ground = true; }
    }
  } else if (p.y - s > fl + 0.005) f.ground = false;
  if (f.ground) {   // skidding: friction slows it, the spin dies away
    const hs = Math.hypot(v.x, v.z), dec = MILK_MU * GRAV * h;
    if (hs <= dec) { v.x = 0; v.z = 0; } else { v.x *= (hs - dec) / hs; v.z *= (hs - dec) / hs; }
    f.spin *= Math.max(0, 1 - 6 * h);
  }
}
function stepMilkCrates(dt) {
  for (const m of milks()) if (m.userData.pop !== undefined) {
    m.userData.pop = Math.min(1, m.userData.pop + dt / 0.25); const k = m.userData.pop; m.scale.setScalar(Math.max(0.01, k * k * (3 - 2 * k)));
    if (k >= 1) delete m.userData.pop;
  }
  camera.getWorldPosition(_eyeM);
  for (const [m, f] of flyingMilk) {
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = Math.min(dt, 0.1) / n;
    m.position.y -= f.off || 0;   // #201 the shrink-away lift is visual only
    for (let i = 0; i < n; i++) stepFlyingMilk(m, f, h);
    m.position.y += f.off || 0;
    f.t += dt;
    if (f.gone !== undefined) {   // past 1 m: shrinks away over 1 s while it keeps moving
      // #201 it shrinks about its middle (the origin is at its base, so it looked like it sank through the floor)
      f.gone += dt; const k = Math.min(1, f.gone / MILK_GONE_T), sc = Math.max(0.01, 1 - k * k * (3 - 2 * k)); m.scale.setScalar(sc);
      m.position.y += MILK.H / 2 * (1 - sc) - (f.off || 0); f.off = MILK.H / 2 * (1 - sc);
      if (k >= 1) {
        if (f.key !== 'milk') { removeMilk(f.key); continue; }
        flyingMilk.delete(m); placeMilk(m); m.scale.setScalar(0.01); m.userData.pop = 0; stage.save(); continue;   // the first crate comes back
      }
      continue;
    }
    m.getWorldPosition(_milkW);
    if (Math.hypot(_milkW.x - _eyeM.x, _milkW.z - _eyeM.z) > MILK_GONE_R) { f.gone = 0; continue; }
    const r = m.rotation, still = f.ground && Math.hypot(f.vel.x, f.vel.z) < 0.01 && Math.abs(f.spin) < 0.05 && Math.abs(r.x) < 0.004 && Math.abs(r.z) < 0.004 && f.tv.length() < 0.05;
    if (still || f.t > 8) {
      r.x = 0; r.z = 0; m.position.y = stage.items[f.key] ? stackFloor(f.key, m.position.y + 0.01) : 0;
      flyingMilk.delete(m); stage.save();
    }
  }
}
const _eyeM = new THREE.Vector3(), _milkW = new THREE.Vector3(), _eyeB = new THREE.Vector3(), _recB = new THREE.Vector3();
function resetLayout() { for (const k of Object.keys(extraMilk)) removeMilk(k); setNeonScale(1); saveNeonScale(); stage.reset(); }

// screens
const mixScreen = new Screen(768, 304);
// #198 (owner): held on its side, the tablet's menu turns portrait too, at the same moment as the preview lid (same edge
// logic and dead zone). Portrait pages draw on their own 304 x 768 canvas whose texture is turned 90 deg on the same
// screen; mixScreenPress maps taps back onto it.
const mixScreenP = new Screen(304, 768); mixScreenP.texture.center.set(0.5, 0.5);
let scrDir = 'up';
const scr = () => (scrDir === 'up' ? mixScreen : mixScreenP), portrait = () => scrDir !== 'up';
const vpPer = () => (scrDir === 'up' ? 8 : 12);   // thumbnails a page on the Video page
function stepScrDir() {
  const dir = tabletDir(scrDir); if (dir === scrDir) return;
  scrDir = dir;
  if (dir !== 'up') mixScreenP.texture.rotation = dir === 'px' ? -Math.PI / 2 : Math.PI / 2;
  const m = mixer.userData.screen.material; m.map = scr().texture; m.needsUpdate = true;
  drawMixScreen();
}
// #189 the mixer's tablet (models.js): held in the hand (xr.js 'tablet' grab), stays where it is let go, snaps into the
// mixer's slot within 8 cm. Its pose is kept (mixer-local) in 'vire.tablet'. It stays a child of the mixer, so the phone
// mirrors it like any other mixer part.
const TABLET = mixer.userData.tablet, TDOCK = mixer.userData.tabletDock;
// #195 (owner): resizable while out of the slot (trigger on the lower-right corner handle and drag, or grip both sides
// and pull apart); docked it is always size 1 (it has to fit the slot), and picking it up again restores its size.
let tabletFreeScale = 1;
function saveTablet() { try { localStorage.setItem('vire.tablet', JSON.stringify({ p: TABLET.position.toArray(), q: TABLET.quaternion.toArray(), s: TABLET.scale.x, fs: tabletFreeScale })); } catch {} }
try { const t = JSON.parse(localStorage.getItem('vire.tablet') || 'null'); if (t) { TABLET.position.fromArray(t.p); TABLET.quaternion.fromArray(t.q); TABLET.scale.setScalar(t.s || 1); tabletFreeScale = t.fs || t.s || 1; } } catch {}
const tabletDocked = () => TABLET.position.distanceTo(TDOCK.p) < 1e-4;
function tabletGrab() { if (tabletDocked() && tabletFreeScale !== 1) TABLET.scale.setScalar(tabletFreeScale); }
function tabletScale(s) { s = clamp(s, 0.7, 3); TABLET.scale.setScalar(s); tabletFreeScale = s; }
// #196b (owner: nothing may stick out) corner handle: the #195 L, flush on the tablet's face at the lower-right corner,
// now brushed silver (streaks in the roughness, anisotropy along them) with a raised diagonal down-right arrow near the
// top of its upright arm so it reads as "drag to stretch". One plane, cut out with alpha (one draw call). Not mirrored.
// #202 (owner): the L and its arrow moved to the TOP-right corner, arrow pointing up and out, so it reads as "this lifts
// out" (it is still the resize handle: trigger + drag)
const TAB_CORNER = new THREE.Vector3(0.095, 0.035, 0);   // xr.js resize zone centre
{ const N = 160, mm = N / 16;   // 16 x 16 mm plate
  const L = document.createElement('canvas'); L.width = L.height = N; const lg = L.getContext('2d');   // alpha: the L
  lg.fillStyle = '#000'; lg.fillRect(0, 0, N, N); lg.fillStyle = '#fff';
  lg.beginPath(); lg.roundRect(N - 6 * mm, 0, 6 * mm, N, 1.2 * mm); lg.fill(); lg.beginPath(); lg.roundRect(0, 0, N, 4.5 * mm, 1.2 * mm); lg.fill();   // #197 arm 4.5 mm (room for the arrow at the joint); #202 along the top
  const A = document.createElement('canvas'); A.width = A.height = N; const ag = A.getContext('2d');   // height: the arrow
  ag.fillStyle = '#000'; ag.fillRect(0, 0, N, N); ag.strokeStyle = ag.fillStyle = '#fff'; ag.lineCap = 'round'; ag.lineWidth = 0.65 * mm;
  const cx = N - 3 * mm, cy = 2.3 * mm, r = 1.5 * mm;   // #197 arrow on the L's joint (the corner square); #202 up-right
  ag.beginPath(); ag.moveTo(cx - r, cy + r); ag.lineTo(cx + r * 0.75, cy - r * 0.75); ag.stroke();
  ag.beginPath(); ag.moveTo(cx + r, cy - r); ag.lineTo(cx + r - 1.4 * mm, cy - r); ag.lineTo(cx + r, cy - r + 1.4 * mm); ag.closePath(); ag.fill();
  const B = document.createElement('canvas'); B.width = B.height = N; const bg = B.getContext('2d'); bg.filter = 'blur(1.5px)'; bg.drawImage(A, 0, 0);
  const h = bg.getImageData(0, 0, N, N).data, nd = new ImageData(N, N), H = (x, y) => h[(Math.min(N - 1, Math.max(0, y)) * N + Math.min(N - 1, Math.max(0, x))) * 4] / 255;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4, nx = -(H(x + 1, y) - H(x - 1, y)) * 2.5, ny = (H(x, y + 1) - H(x, y - 1)) * 2.5, l = Math.hypot(nx, ny, 1);   // raised
    nd.data[i] = (nx / l * 0.5 + 0.5) * 255; nd.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; nd.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; nd.data[i + 3] = 255;
  }
  const NC = document.createElement('canvas'); NC.width = NC.height = N; NC.getContext('2d').putImageData(nd, 0, 0);
  const R = document.createElement('canvas'); R.width = R.height = N; const rg = R.getContext('2d');   // brushing: fine horizontal streaks
  let sd = 5; const rn = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  for (let y = 0; y < N; y++) { const v = Math.round(70 + rn() * 60); rg.fillStyle = `rgb(${v},${v},${v})`; rg.fillRect(0, y, N, 1); }
  const silver = new THREE.MeshPhysicalMaterial({ color: 0xd9dde3, metalness: 1, roughness: 1, roughnessMap: new THREE.CanvasTexture(R), anisotropy: 0.6,
    normalMap: new THREE.CanvasTexture(NC), normalScale: new THREE.Vector2(2.2, 2.2), alphaMap: new THREE.CanvasTexture(L), alphaTest: 0.5 });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 0.016), silver);
  plate.position.set(0.1 - 0.008, 0.04 - 0.008, TABLET_T / 2 + 0.0013); plate.userData.noMirror = true; plate.name = 'tabletCorner'; plate.raycast = () => {};
  TABLET.add(plate); }
const _tm = new THREE.Matrix4(), _tp = new THREE.Vector3(), _tq = new THREE.Quaternion(), _ts = new THREE.Vector3();
function tabletHold(world) {   // world pose from the hand -> mixer-local
  mixer.updateMatrixWorld(); _tm.copy(mixer.matrixWorld).invert().multiply(world).decompose(_tp, _tq, _ts);
  TABLET.position.copy(_tp); TABLET.quaternion.copy(_tq);
}
function tabletRelease() {
  const snap = TABLET.position.distanceTo(TDOCK.p) < 0.08;
  if (snap) { tabletFreeScale = TABLET.scale.x; TABLET.position.copy(TDOCK.p); TABLET.quaternion.copy(TDOCK.q); TABLET.scale.setScalar(1); }
  saveTablet(); return snap;
}
function tabletDock() { tabletFreeScale = TABLET.scale.x; TABLET.position.copy(TDOCK.p); TABLET.quaternion.copy(TDOCK.q); TABLET.scale.setScalar(1); saveTablet(); }
mixer.userData.screen.material.map = mixScreen.texture; mixer.userData.screen.material.needsUpdate = true;
const crateScreen = new Screen(1024, 960);   // same shape as the lid monitor (flush lid, 32 x 30 cm LCD)
const CS = { head: 74, foot: 66, rows: 13, rh: 62 };   // crate screen layout (CLAUDE.md #61, #70)
crate.userData.screen.material.emissiveMap = crateScreen.texture; crate.userData.screen.material.needsUpdate = true;

// ------------------------------------------------------------------ camera presets
// presets are local to the group they look at, so they follow when you move things
const CAMS = {
  dj: { pos: [0.16, 0.7, 0.98], tgt: [0.2, 0.04, -0.04], of: () => mixer },
  top: { pos: [0.1, 1.15, 0.08], tgt: [0.1, 0.08, 0.0], of: () => mixer },
  crate: { pos: [-0.065, 0.83, 0.67], tgt: [-0.01, 0.24, -0.02], of: () => crateRig },
};
let camTween = null;
function setCam(name, instant = false) {
  const c = CAMS[name];
  document.querySelectorAll('#hud [data-cam]').forEach(b => b.classList.toggle('on', b.dataset.cam === name));
  const g = c.of(); g.updateWorldMatrix(true, false);
  // presets follow the object's position and turn, but always look level
  const e = new THREE.Euler(0, g.rotation.y, 0);
  const wp = new THREE.Vector3(); g.getWorldPosition(wp);
  const lw = v => new THREE.Vector3(...v).applyEuler(e).add(wp);
  const to = { pos: lw(c.pos), tgt: lw(c.tgt) };
  if (instant) { camera.position.copy(to.pos); controls.target.copy(to.tgt); controls.update(); return; }
  camTween = { t: 0, from: { pos: camera.position.clone(), tgt: controls.target.clone() }, to };
}
setCam('dj', true);
document.querySelectorAll('#hud [data-cam]').forEach(b => b.onclick = () => setCam(b.dataset.cam));

// ------------------------------------------------------------------ UI helpers
let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.style.opacity = 1;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.style.opacity = 0, ms);
}
const tip = $('#tip');
function showTip(text, x, y) { if (!text) { tip.style.display = 'none'; return; } tip.textContent = text; tip.style.display = 'block'; tip.style.left = (x + 16) + 'px'; tip.style.top = (y + 12) + 'px'; }
$('#resetBtn').onclick = () => { resetLayout(); toast('Gear and flight cases back to their default spots'); };
$('#helpBtn').onclick = () => { const h = $('#help'); h.style.display = h.style.display === 'block' ? 'none' : 'block'; };

// ------------------------------------------------------------------ state
const engine = new AudioEngine();
let lib = null;
const decks = [0, 1].map(i => ({
  i, name: DECK_NAMES[i], g: deckGroups[i], record: null, side: null, track: null, duration: 0,
  loaded: false, loading: false, motorOn: false, power: true, speed: 1, pitch: 0, platterAngle: 0, recAngle: 0, angleOffset: 0,
  arm: { yaw: deckGroups[i].userData.restYaw || 0, lift: 1, targetYaw: deckGroups[i].userData.restYaw || 0, targetLift: 1, onLand: null, parking: false },
  loadToken: 0,
}));
let held = null;           // Record3D in the "hand"
let lastTouched = 0;       // phase lead for SYNC (CLAUDE.md #8)
let syncAnim = null;
let syncFlash = { t: 0, color: 'blue' };
let splitCue = false;
const cueOn = [false, false];

// mixer control values (0..1, 0.5 neutral) and defaults
const MIXDEF = {
  'A.trim': 0.5, 'A.hi': 0.5, 'A.mid': 0.5, 'A.low': 0.5, 'A.filter': 0.5, 'A.pan': 0.5, 'A.fader': 0.8,
  'B.trim': 0.5, 'B.hi': 0.5, 'B.mid': 0.5, 'B.low': 0.5, 'B.filter': 0.5, 'B.pan': 0.5, 'B.fader': 0.8,
  master: 0.8, xfader: 0, 'mic.gain': 0.5, 'mic.pitch': 0.5,
};
const mixVal = { ...MIXDEF };

function applyMix(id) {
  if (!engine.ctx) return;
  const v = mixVal[id];
  if (id === 'master') return engine.setMaster(v);
  if (id === 'xfader') return engine.setCrossfader(v);
  if (id === 'mic.gain') return engine.setMicGain(v);
  if (id === 'mic.pitch') return engine.setMicPitch(v);
  const [ch, what] = id.split('.'); const i = ch === 'A' ? 0 : 1;
  if (what === 'trim') engine.setTrim(i, v);
  else if (what === 'hi' || what === 'mid' || what === 'low') engine.setEQ(i, what, v);
  else if (what === 'filter') engine.setFilter(i, v);
  else if (what === 'pan') engine.setPan(i, v);
  else if (what === 'fader') engine.setFader(i, v);
}
function mixLabel(id) {
  const v = mixVal[id];
  const [ch, what] = id.includes('.') ? id.split('.') : ['', id];
  const pre = ch ? ch + ' ' : '';
  switch (what) {
    case 'trim': return `${pre}Trim ${((v - 0.5) * 24).toFixed(1)} dB`;
    case 'hi': case 'mid': case 'low': {
      const db = v < 0.5 ? -40 * Math.pow(1 - v / 0.5, 1.6) : (v - 0.5) / 0.5 * 6;
      return `${pre}${what.toUpperCase()} ${db <= -39.5 ? 'KILL' : db.toFixed(1) + ' dB'}`;
    }
    case 'filter': return `${pre}Filter ${Math.abs(v - 0.5) < 0.04 ? 'off' : v < 0.5 ? 'low-pass' : 'high-pass'}`;
    case 'pan': {
      const p = (v - 0.5) * 2; const t = decks[ch === 'A' ? 0 : 1].track;
      const s = t && t.split ? (p < -0.95 ? ' (vocal only)' : p > 0.95 ? ' (instrumental only)' : '') : '';
      return `${pre}Pan ${Math.abs(p) < 0.02 ? 'C' : (p < 0 ? 'L' : 'R') + Math.round(Math.abs(p) * 100)}${s}`;
    }
    case 'fader': return `${pre}Fader ${Math.round(v * 100)}%`;
    case 'master': return `Master ${Math.round(v * 100)}%`;
    case 'gain': if (settings.micRoute !== 'app') return v <= 0.5 ? 'Talkover: no duck (voice comes from the Quest / BeamXR mic)' : `Music ducks ${engine.micDuckDb(v).toFixed(0)} dB while MIC is on`;
      return v <= 0.5 ? `Mic level ${v < 0.01 ? 'off' : (20 * Math.log10(Math.pow(v / 0.5, 2) * 2)).toFixed(1) + ' dB'}` : `Mic full, music ducks ${engine.micDuckDb(v).toFixed(0)} dB while MIC is on`;
    case 'pitch': if (settings.micRoute !== 'app') return 'Voice pitch: only with Mic route "Through the mixer"';
    { const st = engine.micSemitones(v); return `Mic pitch ${st === 0 ? '0' : (st > 0 ? '+' : '') + st.toFixed(1)} semitones`; }
    case 'xfader': return `Crossfader ${v < -0.02 ? 'A ' + Math.round(-v * 100) : v > 0.02 ? 'B ' + Math.round(v * 100) : 'centre'}`;
  }
  return id;
}
function updateMixVisual(id) {
  const c = mixer.userData.controls[id]; if (!c) return;
  const v = mixVal[id];
  if (id === 'xfader') { const t = mixer.userData.xTravel; c.position.x = t.x0 + (v + 1) / 2 * (t.x1 - t.x0); return; }
  if (id.endsWith('.fader')) { const t = mixer.userData.faderTravel; c.position.z = t.z1 - v * (t.z1 - t.z0); return; }
  c.rotation.y = -((v - 0.5) * 300) * Math.PI / 180;
  if (mixer.userData.syncKnob) mixer.userData.syncKnob(c);
}
Object.keys(mixVal).forEach(updateMixVisual);

// ------------------------------------------------------------------ library + crate
const crateState = { pl: 0, sel: 0 };
const sideCache = new Map(); // track id -> Promise<{bytes, art}>
const artCache = new Map();  // track id -> ImageBitmap|null
const artBlobs = new Map();  // track id -> the cover as stored in the MP3 (sent as-is to the spectator phone, #161)

function currentList() { return search.results ? search.results : lib ? lib.playlists[crateState.pl].records : []; }

// ---- crate search (owner, 26 Sep; CLAUDE.md #73). Whole collection, every field: title, artist, genre,
// key and BPM ('128' = within 1 BPM, '124-130' = range). All words must match. Results replace the
// crate's list (screen and sleeves) until cleared. Typed on the LCD's own keyboard (fingertip / controller
// tip pokes, mouse clicks), or through a real <input>: the mic button focuses it, which brings up the Meta
// system keyboard with its voice dictation in the headset (needs a trigger press or pinch, i.e. a user
// gesture), and a normal text field on the desktop ('/' key).
const search = { q: '', results: null, kb: false, keys: [], btns: [], flash: null, hint: 0 };
const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function matchTok(r, t) {
  let m;
  if ((m = t.match(/^(\d{2,3}(?:\.\d+)?)-(\d{2,3}(?:\.\d+)?)$/))) {
    const a = Math.min(+m[1], +m[2]), b = Math.max(+m[1], +m[2]);
    return r.bpm && r.bpm >= a - 0.05 && r.bpm <= b + 0.05 ? 2 : -1;
  }
  if (/^\d{2,3}(\.\d+)?$/.test(t) && +t >= 50 && +t <= 220 && r.bpm && Math.abs(r.bpm - +t) <= 1) return 3;
  if (/^([a-g][#b]?m?|\d{1,2}[ab])$/.test(t) && norm(r.key) === t) return 3;
  const h = r._hay, i = h.indexOf(t); if (i < 0) return -1;
  if (r._title.startsWith(t)) return 4;
  return i === 0 || h[i - 1] === ' ' ? 2 : 1;
}
function runSearch() {
  const q = norm(search.q).trim();
  if (!lib || !q) { search.results = null; return; }
  const toks = q.split(/\s+/).filter(Boolean), out = [];
  for (const r of lib.records) {
    if (r._hay === undefined) { r._title = norm(r.title); r._hay = norm(`${r.title} ${r.artist || ''} ${r.genre || ''} ${r.key || ''}`); }
    let score = 0;
    for (const t of toks) { const m = matchTok(r, t); if (m < 0) { score = -1; break; } score += m; }
    if (score >= 0) out.push({ r, score });
  }
  out.sort((a, b) => (a.r.missing - b.r.missing) || (b.score - a.score) || a.r.title.localeCompare(b.r.title));
  search.results = out.map(o => o.r);
}
function setQuery(q) {
  search.q = q; runSearch(); crateState.sel = 0;
  if (searchInput.value !== q) searchInput.value = q;
  drawCrateScreen(); layoutSleeves();
}
function exitSearch() {
  search.q = ''; search.results = null; search.kb = false; searchInput.value = '';
  if (document.activeElement === searchInput) searchInput.blur();
  crateState.sel = 0; drawCrateScreen(); layoutSleeves();
}
function kbKey(k) {
  if (k === 'DONE') { search.kb = false; drawCrateScreen(); return; }
  let q = search.q;
  if (k === '⌫') q = q.slice(0, -1); else if (k === 'SPACE') q += ' '; else if (k === 'CLEAR') q = ''; else q += k.toLowerCase();
  search.flash = { k, t: performance.now() }; setTimeout(drawCrateScreen, 150);
  setQuery(q);
}
// the real text field (native keyboard / dictation in the headset, typing on the desktop)
const searchInput = document.createElement('input');
Object.assign(searchInput, { type: 'search', placeholder: 'Search the crate: title, artist, genre, key, BPM', autocomplete: 'off', spellcheck: false, enterKeyHint: 'search' });
searchInput.id = 'crateSearch';
searchInput.style.cssText = 'position:fixed;left:50%;top:52px;transform:translateX(-50%);width:min(460px,76vw);padding:8px 12px;font:500 15px system-ui,sans-serif;border-radius:8px;border:1px solid #4aa8f0;background:#141925;color:#e6e9ec;z-index:50;opacity:0;pointer-events:none';
document.body.appendChild(searchInput);
searchInput.addEventListener('focus', () => { searchInput.style.opacity = 1; searchInput.style.pointerEvents = 'auto'; });
searchInput.addEventListener('blur', () => { searchInput.style.opacity = 0; searchInput.style.pointerEvents = 'none'; });
searchInput.addEventListener('input', () => setQuery(searchInput.value));
searchInput.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') searchInput.blur();
  if (e.key === 'Escape') { if (!searchInput.value) exitSearch(); searchInput.blur(); }
});
function openNativeKeyboard() {
  searchInput.value = search.q;
  try { searchInput.focus({ preventScroll: true }); searchInput.setSelectionRange(search.q.length, search.q.length); } catch (e) {}
  const ok = document.activeElement === searchInput;
  if (!ok) { search.hint = performance.now() + 3000; drawCrateScreen(); setTimeout(drawCrateScreen, 3100); }
  return ok;
}
// XR: a trigger press or pinch at the mic button (a real user gesture, so the system keyboard may open)
function crateMicSelect(P) {
  if (!crateLidOpen() || !search.btns.length) return false;
  const scr = crate.userData.screen, l = scr.worldToLocal(P.clone());
  const sw = scr.geometry.parameters.width, sh = scr.geometry.parameters.height, c = crateScreen.canvas;
  if (Math.abs(l.z) > 0.04) return false;
  const px = (l.x / sw + 0.5) * c.width, py = (0.5 - l.y / sh) * c.height, mg = 0.02 / sw * c.width;
  const b = search.btns.find(b => b.id === 'mic');
  if (!b || px < b.x - mg || px > b.x + b.w + mg || py < b.y - mg || py > b.y + b.h + mg) return false;
  openNativeKeyboard(); return true;
}

async function loadLibrary() {
  sideCache.clear();
  try {
    let text, resolve, from;
    if (settings.source === 'headset') {
      if (!store.opfsSupported()) throw new Error('this browser has no private file storage');
      const index = await store.loadIndex();
      const xmls = index.filter(f => /\.xml$/i.test(f.path));
      if (!xmls.length) throw new Error(index.length ? 'no Rekordbox XML among the imported files' : 'nothing imported yet');
      const pick = xmls.find(f => /(^|\/)rekordbox\.xml$/i.test(f.path)) || xmls[0];
      text = await (await store.readFile(pick.path)).text();
      resolve = store.opfsResolver(index); from = pick.path + ' on this headset';
      vvIndex = new Map(index.filter(f => VIDEO_EXT.test(f.path)).map(f => [vvKey(baseName(f.path)), f.path]));   // #177
    } else {
      const tryXml = [settings.xml, ...['rekordbox.xml', 'ViRE_rekordbox.xml'].filter(x => x !== settings.xml)];
      for (const x of tryXml) { const r = await fetch(x); if (r.ok) { text = await r.text(); from = x; break; } }
      if (!text) throw new Error('no library XML found on the PC');
      resolve = store.pcResolver;
    }
    lib = parseLibrary(text, resolve);
    const pairs = lib.records.filter(r => r.paired).length;
    const splits = [...lib.tracks.values()].filter(t => t.split).length;
    const missing = [...lib.tracks.values()].filter(t => t.missing).length;
    $('#libstatus').textContent = `${from}: ${lib.tracks.size} tracks${missing ? ` (${missing} not found)` : ''}, ${lib.records.length} records, ${pairs} with A/B sides, ${splits} split sides, ${lib.playlists.length - 1} playlists`;
  } catch (e) {
    lib = null;
    $('#libstatus').textContent = `No library: ${e.message}`;
  }
  crateState.pl = 0; crateState.sel = 0; search.q = ''; search.results = null; searchInput.value = '';
  drawCrateScreen(); layoutSleeves();
}

// BPM priority (owner, #102): the MP3's own ID3 BPM (TBPM) first, Rekordbox only when the file has none.
// Read whenever the tag is read (cover art for the crate, or the whole file when a record is pulled).
function useID3Bpm(track, tag) {
  if (track && tag && tag.key && !track.id3Key) track.id3Key = tag.key;   // TKEY, shown by the mixer's KEY mode (#116)
  if (!track || !tag || !(tag.bpm > 0) || track.bpmSrc === 'id3') return;
  track.rbBpm = track.bpm; track.bpm = tag.bpm; track.bpmSrc = 'id3';
  // #118 (owner): the crate list (and its BPM search) keeps showing the Rekordbox XML BPM for now; only the
  // decks use the ID3 BPM. Reading BPM/key from every MP3 for the crate may come later.
}
// Cover art only: read just the ID3 tag (a few hundred KB at most), not the whole song (CLAUDE.md #41).
const artPending = new Map(); let artActive = 0; const artQueue = [];
function fetchArt(track) {
  if (!track || track.missing) return Promise.resolve(null);
  if (artCache.has(track.id)) return Promise.resolve(artCache.get(track.id));
  if (artPending.has(track.id)) return artPending.get(track.id);
  const p = new Promise(res => artQueue.push({ track, res }));
  artPending.set(track.id, p); pumpArt(); return p;
}
async function pumpArt() {
  while (artActive < 2 && artQueue.length) {
    const { track, res } = artQueue.shift(); artActive++;
    (async () => {
      let art = null;
      try {
        let head;
        const part = async (a, b) => {
          if (track.opfs) return (await store.readFile(track.opfs)).slice(a, b).arrayBuffer();
          const r = await fetch(track.url, { headers: { Range: `bytes=${a}-${b - 1}` } });
          return r.arrayBuffer();
        };
        head = new Uint8Array(await part(0, 10));
        if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
          const size = ((head[6] & 127) << 21) | ((head[7] & 127) << 14) | ((head[8] & 127) << 7) | (head[9] & 127);
          const tag = await part(0, Math.min(size + 10, 4 * 1024 * 1024));
          const t = readID3(tag); useID3Bpm(track, t); if (t.picture) { art = await createImageBitmap(t.picture); artBlobs.set(track.id, t.picture); }
        }
      } catch (e) { /* no art */ }
      artCache.set(track.id, art); artPending.delete(track.id); res(art);
    })().finally(() => { artActive--; pumpArt(); });
  }
}

function fetchSide(track) {
  if (!track || track.missing) return Promise.resolve(null);
  if (sideCache.has(track.id)) return sideCache.get(track.id);
  const p = (async () => {
    let bytes;
    if (track.opfs) bytes = await (await store.readFile(track.opfs)).arrayBuffer();
    else {
      const r = await fetch(track.url);
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${decodeURIComponent(track.url)}`);
      bytes = await r.arrayBuffer();
    }
    let art = null;
    try {
      const tag = readID3(bytes); useID3Bpm(track, tag);
      if (tag.picture) { art = await createImageBitmap(tag.picture); artBlobs.set(track.id, tag.picture); }
    } catch (e) { console.warn('art', e); }
    artCache.set(track.id, art);
    return { bytes, art };
  })();
  sideCache.set(track.id, p);
  p.catch(() => sideCache.delete(track.id));
  // keep the byte cache small
  if (sideCache.size > 10) { const k = sideCache.keys().next().value; sideCache.delete(k); }
  return p;
}

// Grooves while you hold the record (#70): like Vinyl Reality, pulling a record starts decoding its playing
// side in the background (worker), so the grooves appear in your hand and the deck starts at once when you
// drop it on. The decoded PCM waits in a 2-entry cache for the deck; the groove envelope (32 KB per side) is
// kept for every side ever decoded, so a record you pull again shows its grooves immediately.
const envCache = new Map();      // track id -> { env, duration }
const decodeCache = new Map();   // track id -> Promise<decoded PCM>, taken (and removed) by loadSide
function showEnv(rec3d, side) {
  const t = rec3d.track(side), e = t && envCache.get(t.id);
  if (e && !rec3d.disposed && rec3d.envs[side] !== e.env) { rec3d.envs[side] = e.env; rec3d.durations[side] = e.duration; rec3d.redraw(side); }
}
function predecode(rec3d, side) {
  const t = rec3d.track(side); if (!t || t.missing) return;
  showEnv(rec3d, side);
  if (!decodeCache.has(t.id)) {
    while (decodeCache.size >= 2) decodeCache.delete(decodeCache.keys().next().value);
    const p = (async () => {
      await engine.init();
      const data = await fetchSide(t);
      const dec = await engine.decode(data.bytes.slice(0));
      envCache.set(t.id, { env: dec.env, duration: dec.duration });
      return dec;
    })();
    p.catch(() => decodeCache.delete(t.id));
    decodeCache.set(t.id, p);
  }
  decodeCache.get(t.id).then(() => showEnv(rec3d, side)).catch(() => {});
}
async function prepareArt(rec3d) {
  for (const s of ['A', 'B']) {
    const t = rec3d.track(s); if (!t || t.missing) continue;
    try {
      const d = await fetchSide(t);
      if (d && d.art) { rec3d.labelImgs[s] = d.art; rec3d.redraw(s); }
    } catch (e) { toast(e.message); }
  }
}

// Crate screen (CLAUDE.md #61, #72, #73): header, search bar, rows, optional on-screen keyboard, footer.
const SB = { y: 74, h: 70 };   // search bar right under the header
const KB = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', '-'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '#', '⌫'],
  ['SPACE', '.', 'CLEAR', 'DONE'],
];
const KBW = { '⌫': 2, SPACE: 5, CLEAR: 2, DONE: 2 };
const EMOJI = '"Segoe UI Emoji","Noto Color Emoji","Apple Color Emoji",system-ui';
function drawCrateScreen() {
  const { g, canvas: c } = crateScreen; const W = c.width, H = c.height;
  g.fillStyle = '#101316'; g.fillRect(0, 0, W, H);
  g.textBaseline = 'middle';
  if (!lib) { g.fillStyle = '#8d96a1'; g.font = '500 34px system-ui'; g.textAlign = 'left'; g.fillText('No library', 30, 60); crateScreen.commit(); return; }
  const pl = lib.playlists[crateState.pl];
  const list = currentList(), searching = !!search.results;
  // header
  g.fillStyle = '#1a1f25'; g.fillRect(0, 0, W, CS.head);
  g.fillStyle = '#4aa8f0'; g.font = '600 36px system-ui'; g.textAlign = 'left';
  g.fillText('◀', 20, CS.head / 2); g.textAlign = 'right'; g.fillText('▶', W - 20, CS.head / 2);
  g.fillStyle = '#e6e9ec'; g.font = '600 32px system-ui'; g.textAlign = 'center';
  fitText(g, searching ? `Search · ${list.length} result${list.length === 1 ? '' : 's'}` : `Crate > ${pl.path}`, W / 2, CS.head / 2, W - 150);
  // search bar: field | keyboard | mic | clear
  const by = SB.y + 8, bh = SB.h - 14;
  search.btns = [
    { id: 'field', x: 12, y: by, w: W - 12 - 4 * 78 - 16, h: bh },
    { id: 'milk', x: W - 4 * 78 - 4, y: by, w: 70, h: bh },
    { id: 'kb', x: W - 3 * 78 - 4, y: by, w: 70, h: bh },
    { id: 'mic', x: W - 2 * 78 - 4, y: by, w: 70, h: bh },
    { id: 'clear', x: W - 78 - 4, y: by, w: 70, h: bh },
  ];
  const f = search.btns[0];
  g.fillStyle = search.kb ? '#1d2a38' : '#171c22'; g.fillRect(f.x, f.y, f.w, f.h);
  g.strokeStyle = search.kb || searching ? '#4aa8f0' : '#2c343d'; g.lineWidth = 2; g.strokeRect(f.x + 1, f.y + 1, f.w - 2, f.h - 2);
  g.textAlign = 'left'; g.font = `30px ${EMOJI}`; g.fillStyle = '#8d96a1'; g.fillText('🔍', f.x + 12, f.y + bh / 2);
  const hint = performance.now() < search.hint;
  g.font = '500 30px system-ui'; g.fillStyle = search.q && !hint ? '#ffffff' : '#6f7985';
  fitText2(g, hint ? 'Pinch or pull the trigger on 🎤 for the Meta keyboard' : search.q ? search.q + (search.kb ? '▏' : '') : 'Search title, artist, genre, key, BPM', f.x + 58, f.y + bh / 2, f.w - 70);
  for (const b of search.btns.slice(1)) {
    const on = (b.id === 'kb' && search.kb) || (b.id === 'mic' && document.activeElement === searchInput);
    g.fillStyle = on ? '#23527c' : '#1b2128'; g.fillRect(b.x, b.y, b.w, b.h);
    g.textAlign = 'center'; g.font = `34px ${EMOJI}`; g.fillStyle = b.id === 'clear' ? (search.q ? '#e6e9ec' : '#3d454e') : '#e6e9ec';
    if (b.id === 'milk') { drawMilkIcon(g, b.x + b.w / 2, b.y + bh / 2, Object.keys(extraMilk).length + 1 < MILK_MAX); continue; }
    g.fillText(b.id === 'kb' ? '⌨' : b.id === 'mic' ? '🎤' : '✕', b.x + b.w / 2, b.y + bh / 2 + 2);
  }
  // keyboard layout (bottom, above the footer) decides how many rows fit
  const footTop = H - CS.foot, kbH = KB.length * 68 + 8, kbY = footTop - kbH;
  const y0 = SB.y + SB.h + 4, RH = CS.rh;
  const ROWS = Math.floor(((search.kb ? kbY - 4 : footTop) - y0) / RH);
  // rows
  let start = clamp(crateState.sel - Math.min(4, ROWS >> 1), 0, Math.max(0, list.length - ROWS));
  if (!list.length) { g.textAlign = 'center'; g.fillStyle = '#6f7985'; g.font = '500 32px system-ui'; g.fillText(searching ? 'No matches' : 'Empty playlist', W / 2, y0 + RH * 1.5); }
  for (let k = 0; k < ROWS && start + k < list.length; k++) {
    const idx = start + k, r = list[idx], y = y0 + k * RH;
    const sel = idx === crateState.sel;
    if (sel) { g.fillStyle = '#23527c'; g.fillRect(6, y + 1, W - 12, RH - 2); }
    else { g.fillStyle = '#1b2026'; g.fillRect(16, y + RH - 1, W - 32, 1); }
    g.textAlign = 'left'; g.fillStyle = r.missing ? '#4c535c' : sel ? '#ffffff' : '#dde1e5';
    g.font = `${sel ? 600 : 500} 34px system-ui`;
    const badge = (r.paired ? 'A|B ' : '') + ((r.sides.A && r.sides.A.split) || (r.sides.B && r.sides.B.split) ? 'S ' : '');
    fitText2(g, `${r.title}${r.artist ? ' - ' + r.artist : ''}`, 22, y + RH / 2, W - 250);
    g.textAlign = 'right'; g.font = '600 26px system-ui'; g.fillStyle = '#f1b650'; g.fillText(badge, W - 138, y + RH / 2);
    g.fillStyle = sel ? '#ffffff' : '#aab2bc'; g.font = '600 32px system-ui';
    g.fillText(r.bpm ? r.bpm.toFixed(r.bpm % 1 ? 1 : 0) : '', W - 22, y + RH / 2);
  }
  // on-screen keyboard: 10 units per row, ~3 cm keys on the LCD
  search.keys = [];
  if (search.kb) {
    g.fillStyle = '#0b0e11'; g.fillRect(0, kbY, W, kbH);
    const U = (W - 24) / 10, fl = search.flash && performance.now() - search.flash.t < 140 ? search.flash.k : null;
    KB.forEach((row, ri) => {
      const units = row.reduce((a, k) => a + (KBW[k] || 1), 0);
      let x = 12 + (10 - units) * U / 2; const y = kbY + 8 + ri * 68;
      for (const k of row) {
        const w = (KBW[k] || 1) * U;
        search.keys.push({ k, x, y, w, h: 62 });
        g.fillStyle = k === fl ? '#4aa8f0' : k === 'DONE' ? '#23527c' : '#20262d'; g.fillRect(x + 3, y, w - 6, 62);
        g.fillStyle = '#e6e9ec'; g.textAlign = 'center'; g.font = k.length > 1 ? '600 26px system-ui' : '600 32px system-ui';
        g.fillText(k === 'SPACE' ? 'space' : k === 'CLEAR' ? 'clear' : k === 'DONE' ? 'done' : k, x + w / 2, y + 32);
        x += w;
      }
    });
  }
  // footer: key | length | genre | position
  const r = list[crateState.sel];
  g.fillStyle = '#1a1f25'; g.fillRect(0, H - CS.foot, W, CS.foot);
  g.fillStyle = '#e6e9ec'; g.font = '500 30px system-ui'; g.textAlign = 'left';
  const fy = H - CS.foot / 2;
  if (r) {
    const m = Math.floor(r.duration / 60), s = Math.round(r.duration % 60);
    g.fillText(r.key || '—', 22, fy);
    g.fillText(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`, 180, fy);
    fitText2(g, r.genre || '', 340, fy, 420);
  }
  g.textAlign = 'right'; g.fillStyle = '#aab2bc';
  g.fillText(`${list.length ? crateState.sel + 1 : 0} / ${list.length}`, W - 22, fy);
  crateScreen.commit();
  crateScreen.rows = { start, ROWS, RH, y0, kbY: search.kb ? kbY : Infinity };
}
// little green milk crate with a plus: spawns another crate (#88)
function drawMilkIcon(g, cx, cy, can) {
  g.save(); g.strokeStyle = can ? '#3fbf6a' : '#3d454e'; g.lineWidth = 3;
  g.strokeRect(cx - 20, cy - 10, 32, 22);
  for (const x of [-12, -4, 4]) { g.beginPath(); g.moveTo(cx + x, cy - 10); g.lineTo(cx + x, cy + 12); g.stroke(); }
  g.strokeStyle = can ? '#e6e9ec' : '#3d454e'; g.lineWidth = 3.5;
  g.beginPath(); g.moveTo(cx + 19, cy - 20); g.lineTo(cx + 19, cy - 6); g.moveTo(cx + 12, cy - 13); g.lineTo(cx + 26, cy - 13); g.stroke();
  g.restore();
}
function fitText2(g, s, x, y, w) { let t = s; while (t.length > 3 && g.measureText(t).width > w) t = t.slice(0, -2); if (t !== s) t = t.slice(0, -1) + '…'; g.fillText(t, x, y); }

// Sleeves: a window of CRATE.slots records around the selection. Index 0 is at the front (toward the DJ).
const sleeveMap = []; // slot -> record index
// The selected record rides half-way out of its sleeve so it is easy to grab (CLAUDE.md #35).
window.__vireStage = 'building crate disc';
const crateDisc = (() => {
  const grp = new THREE.Group(); grp.visible = false; crate.add(grp);
  const side = drawRecordSide({ env: null, duration: 1, cues: null, title: '', side: '', blank: false, showText: false, low: true });
  const mat = recordMaterial({ anisotropyMap: grooveAnisoMap() }); setRecordSide(mat, side, false);   // #137: ring strip, no disc texture (its label is the separate circles below)
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(REC.R, REC.R, REC.THICK, 96), mat);
  disc.rotation.x = Math.PI / 2; grp.add(disc);
  const lc = document.createElement('canvas'); lc.width = lc.height = 256;
  const ltex = new THREE.CanvasTexture(lc); ltex.colorSpace = THREE.SRGBColorSpace;
  const lmat = new THREE.MeshStandardMaterial({ map: ltex, roughness: 0.8 });
  for (const zz of [1, -1]) { const l = new THREE.Mesh(new THREE.CircleGeometry(REC.LABEL, 48), lmat); l.position.z = zz * (REC.THICK / 2 + 0.0002); if (zz < 0) l.rotation.y = Math.PI; grp.add(l); }
  grp.traverse(o => { if (o.isMesh) o.userData.crateDisc = true; });
  grp.userData = { canvas: lc, tex: ltex, target: new THREE.Vector3(), tilt: 0 };
  return grp;
})();
// Album jackets on the sleeves nearest the selection only (the rest are plain): ~10 small textures,
// covers read from each track's ID3 tag in the background (CLAUDE.md #41).
const COVER_N = 10;
const coverPool = Array.from({ length: COVER_N }, () => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.312, 0.312), new THREE.MeshStandardMaterial({ map: t, roughness: 0.75 }));
  m.visible = false; m.userData = { canvas: c, tex: t, rec: null, hasArt: false, crateCover: true }; crate.add(m);
  return m;
});
function drawJacket(mesh, r) {
  const u = mesh.userData, g = u.canvas.getContext('2d');
  const t = r.sides.A || r.sides.B; const art = t && artCache.get(t.id);
  u.hasArt = !!art;
  if (art) { const s = Math.max(256 / art.width, 256 / art.height); g.drawImage(art, 128 - art.width * s / 2, 128 - art.height * s / 2, art.width * s, art.height * s); }
  else {
    let h = 0; for (const ch of r.title) h = (h * 31 + ch.charCodeAt(0)) >>> 0; h %= 360;
    const gr = g.createLinearGradient(0, 0, 256, 256); gr.addColorStop(0, `hsl(${h},45%,40%)`); gr.addColorStop(1, `hsl(${(h + 40) % 360},50%,18%)`);
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.arc(128, 150, 90, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = '700 22px system-ui'; fitText2(g, r.title, 16, 34, 224);
    g.font = '400 16px system-ui'; g.fillStyle = 'rgba(255,255,255,0.8)'; fitText2(g, r.artist || '', 16, 58, 224);
    if (r.bpm) { g.font = '700 15px system-ui'; g.textAlign = 'right'; g.fillText(`${r.bpm.toFixed(r.bpm % 1 ? 1 : 0)} BPM`, 240, 240); }
  }
  u.tex.needsUpdate = true;
}
function assignCovers(list, slots) { // slots: [{ idx, p, q }] nearest first
  const want = slots.slice(0, COVER_N);
  coverPool.forEach((m, i) => {
    const s = want[i]; if (!s) { m.visible = false; return; }
    const r = list[s.idx];
    m.position.copy(s.p).add(new THREE.Vector3(0, 0, 0.0009).applyQuaternion(s.q)); m.quaternion.copy(s.q); m.scale.set(1, s.sy ?? 1, 1); m.visible = true;   // #153: lid shut = squashed like the jacket (was poking through the floor)
    if (m.userData.rec !== r || (!m.userData.hasArt && artCache.get((r.sides.A || r.sides.B).id))) { m.userData.rec = r; drawJacket(m, r); }
    const t = r.sides.A || r.sides.B;
    if (t && !t.missing && !artCache.has(t.id)) fetchArt(t).then(a => { if (a && m.userData.rec === r) drawJacket(m, r); });
  });
}

function drawCrateDiscLabel(r) {
  const { canvas: c, tex } = crateDisc.userData; const g = c.getContext('2d');
  const t = r && (r.sides.A || r.sides.B); const art = t && artCache.get(t.id);
  let h = 0; for (const ch of (r ? r.title : '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; h %= 360;
  g.save(); g.clearRect(0, 0, 256, 256); g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.clip();
  if (art) { const s = Math.max(256 / art.width, 256 / art.height); g.drawImage(art, 128 - art.width * s / 2, 128 - art.height * s / 2, art.width * s, art.height * s); }
  else {
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, `hsl(${h},55%,52%)`); gr.addColorStop(1, `hsl(${(h + 30) % 360},60%,34%)`);
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '600 22px system-ui'; fitText2(g, r ? r.title : '', 128, 170, 200);
    g.font = '700 18px system-ui'; g.fillText(r && r.bpm ? `${r.bpm.toFixed(r.bpm % 1 ? 1 : 0)} BPM` : '', 128, 200);
  }
  g.fillStyle = '#000'; g.beginPath(); g.arc(128, 128, 6, 0, Math.PI * 2); g.fill();
  g.restore(); tex.needsUpdate = true;
}
function layoutSleeves() {
  const list = currentList(); const S = crate.userData.sleeves;
  const n = Math.min(CRATE.slots, list.length);
  const start = clamp(crateState.sel - 8, 0, Math.max(0, list.length - n));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
  const front = CRATE.D / 2 - 0.03, shut = !crateLidOpen();
  // #129: keep every jacket inside the case. Bottoms stand on the floor (the old -4 cm sank them through it);
  // the pitch shrinks so the last one clears the back wall even with its lean; with the lid shut the jackets
  // are squashed to fit under it (hidden then anyway: a 315 mm sleeve is taller than the 288 mm inside).
  const FLOOR = 0.012, SH = 0.315, backZ = -CRATE.D / 2 + 0.012 + 0.0015 + SH / 2 * Math.sin(0.08);
  const pitch = Math.min(CRATE.pitch, (front - 0.02 - backZ) / (CRATE.slots - 1));
  const hy = shut ? (CRATE.H - FLOOR - 0.006) / SH : 1;
  for (let k = 0; k < CRATE.slots; k++) {
    const idx = start + k; sleeveMap[k] = idx < list.length ? idx : -1;
    if (k >= n) { m.makeScale(0, 0, 0); S.setMatrixAt(k, m); continue; }
    const rel = idx - crateState.sel;
    let z = front - k * pitch, y = FLOOR + 0.001 + SH * hy / 2, tilt = -0.08;
    const yDisc = 0.012 + 0.315 / 2 - 0.04;               // the record riding out keeps its old height
    if (rel < 0) { tilt = 0.32; z += 0.012; }              // flipped past: lean toward the DJ
    if (rel === 0 && shut) tilt = 0.05;                   // lid shut: selection stays down in its sleeve
    else if (rel === 0) { tilt = 0.05; y += 0.012; }       // selected: sleeve nudged up, record pops out (below)
    if (rel !== 0 || shut) y = Math.max(y, FLOOR + 0.001 + SH * hy / 2 * Math.cos(tilt) + 0.0007 * Math.abs(Math.sin(tilt)));
    if (rel > 0) z -= 0.02;                                 // gap behind the selection
    e.set(tilt, 0, 0); q.setFromEuler(e); p.set(0, y, z);
    const r = list[idx];
    s.set(1, hy, r && r.missing ? 0.001 : 1);
    m.compose(p, q, s); S.setMatrixAt(k, m);
    if (rel === 0 && r && !r.missing && !shut) {
      crateDisc.userData.target.set(0, yDisc + 0.012 + 0.315 / 2 - 0.005, z); crateDisc.userData.tilt = tilt;
      if (!crateDisc.visible) { crateDisc.position.set(0, yDisc + 0.012, z); crateDisc.visible = true; }
      if (crateDisc.userData.rec !== r) {
        crateDisc.userData.rec = r; crateDisc.position.y = yDisc + 0.012; drawCrateDiscLabel(r);
        const t = r.sides.A || r.sides.B; // fetch cover art in the background for the label
        if (t && !t.missing && !artCache.has(t.id)) fetchArt(t).then(() => { if (crateDisc.userData.rec === r) drawCrateDiscLabel(r); });
      }
    }
  }
  // covers: selection first, then the sleeves leaning toward you, then just behind
  const near = [];
  for (let k = 0; k < n; k++) {
    const idx = start + k, rel = idx - crateState.sel, r = list[idx];
    if (!r || r.missing || rel < -4 || rel > 5) continue;
    S.getMatrixAt(k, m); m.decompose(p, q, s);
    near.push({ idx, rel, p: p.clone(), q: q.clone(), sy: s.y });   // #153: covers squash with their jackets
  }
  near.sort((a, b) => (Math.abs(a.rel) + (a.rel > 0 ? 0.5 : 0)) - (Math.abs(b.rel) + (b.rel > 0 ? 0.5 : 0)));
  assignCovers(list, near);
  const selRec = list[crateState.sel];
  if (shut || !selRec || selRec.missing || (held && held.rec === selRec) || copiesOut(selRec) >= COPIES) crateDisc.visible = false;
  S.instanceMatrix.needsUpdate = true;
}
function crateSelect(delta) {
  const list = currentList(); if (!list.length) return;
  crateState.sel = clamp(crateState.sel + delta, 0, list.length - 1);
  drawCrateScreen(); layoutSleeves();
}
function cratePlaylist(delta) {
  if (!lib) return;
  if (search.results) { exitSearch(); return; }
  crateState.pl = (crateState.pl + delta + lib.playlists.length) % lib.playlists.length;
  crateState.sel = 0; drawCrateScreen(); layoutSleeves();
  toast(lib.playlists[crateState.pl].path, 1400);
}
// #131 (owner): the crate holds 3 copies of every record. A copy is "out" while it is in a hand, on a deck, lying
// around or in a milk crate; the next copy rides up out of its sleeve until all 3 are out.
var COPIES = 3;   // var: layoutSleeves may run before this line during start-up
function copiesOut(r) {
  let n = (held && held.rec === r) ? 1 : 0;
  for (const d of decks) if (d.record && d.record.rec === r) n++;
  let ls = []; try { ls = loose; } catch (e) {}   // start-up: layoutSleeves can run before `loose` exists
  for (const L of ls) if (L.rec && L.rec.rec === r) n++;
  return n;
}
// attach: optional Object3D (an XR hand/controller anchor) the record follows; none = desktop camera hold
function pullSelected(attach = null) {
  const r = currentList()[crateState.sel];
  if (!r) return null;
  if (r.missing) { toast(`Can't find this track's file (${decodeURIComponent(r.sides.A ? r.sides.A.location : r.sides.B.location).slice(-60)})`, 3500); return null; }
  if (held && held.rec === r) { held.attach = attach; return held; }
  if (!crateLidOpen()) { toast('Open the crate lid first'); return null; }
  const out = copiesOut(r);
  if (out >= COPIES) { toast(`All ${COPIES} copies of this record are out`, 2200); return null; }
  if (out > 0) toast(`Copy ${out + 1} of ${COPIES}`, 1200);
  if (held) returnHeld();
  held = new Record3D(r);
  held.attach = attach;
  held.group.scale.setScalar(1);
  scene.add(held.group);
  prepareArt(held);
  showEnv(held, held.sideUp === 'A' ? 'B' : 'A');
  predecode(held, held.sideUp);
  layoutSleeves();
  return held;
}
// XR: lift a record off a deck into a hand
function pickUpFromDeck(d, attach) {
  if (!d.record) return null;
  if (held) returnHeld();
  liftNeedle(d, true); d.loadToken++; engine.unload(d.i);
  const r = d.record; d.record = null; d.loaded = false; d.track = null; d.side = null;
  engine.post({ type: 'record', deck: d.i, on: false });
  d.g.remove(r.group); scene.add(r.group);
  for (const m of d.g.userData.slipmat || []) m.visible = true;
  held = r; held.attach = attach; layoutSleeves(); return r;
}
// XR: let go of the held record. Over a platter it goes on (face up = side played), otherwise back to the crate.
const _up = new THREE.Vector3(), _wq = new THREE.Quaternion(), _sp = new THREE.Vector3(), _rc = new THREE.Vector3();
function releaseHeld() {
  if (!held) return;
  held.group.getWorldPosition(_rc);
  for (const d of decks) {
    _sp.set(DECK.spindle.x, d.g.userData.platterSurface, DECK.spindle.z); d.g.localToWorld(_sp);
    const dy = _rc.y - _sp.y;
    if (Math.hypot(_rc.x - _sp.x, _rc.z - _sp.z) < 0.13 && dy > -0.06 && dy < 0.3) {
      _up.set(0, 1, 0).applyQuaternion(held.mesh.getWorldQuaternion(_wq));
      const side = _up.y >= 0 ? 'A' : 'B';
      held.sideUp = side; held.flipT = side === 'A' ? 0 : 1; held.attach = null;
      placeOnDeck(d, held); return;
    }
  }
  // anywhere else in XR: let go = it flies with the hand's momentum and lands (CLAUDE.md #49)
  if (renderer.xr.isPresenting && held.vel) { throwRecord(held); held = null; layoutSleeves(); return; }
  returnHeld();
}

// ---- loose records: thrown, dropped, lying on cases or the floor
const loose = [];
let lastHeldRef = null;
const GRAV = 9.81, R_DISC = REC.R;
function throwRecord(r) {
  r.attach = null;
  loose.push({ rec: r, vel: (r.vel || new THREE.Vector3()).clone(), ang: (r.angVel || new THREE.Vector3()).clone(), resting: false, since: performance.now() });
  r.mesh.userData.loose = true;
  const free = loose.filter(l => !l.inMilk);
  while (free.length > 20) { const o = free.shift(); loose.splice(loose.indexOf(o), 1); scene.remove(o.rec.group); o.rec.dispose(); }
}
function pickUpLoose(r, attach) {
  const i = loose.findIndex(l => l.rec === r); if (i < 0) return null;
  const L = loose[i]; loose.splice(i, 1); r.mesh.userData.loose = false;
  if (L.inMilk) { const mc = L.milk, m = mc.userData.records, k = m.indexOf(r); if (k >= 0) m.splice(k, 1); scene.attach(r.group); resettleMilk(mc); }
  if (held) returnHeld();
  held = r; held.attach = attach; held.vel = null; r.setLOD(false); layoutSleeves(); return r;
}
// ---- spare crate contents (CLAUDE.md #62): real physics inside the crate. Records flying in are moved into
// the crate's own frame and bounce off five planes: the floor (or the pile) and the four inner walls, using
// the disc's exact extent along each wall normal. Where one lands depends on how it arrives: nearly flat ->
// lies flat (stacking on the flat ones below); on edge -> tips over, and leans on a wall if one is within
// reach, otherwise falls flat. They ride with the crate and can be picked up again.
function crateNormal(L, out) {
  L.milk.getWorldQuaternion(_cq).invert();
  return out.set(0, 1, 0).applyQuaternion(L.rec.mesh.getWorldQuaternion(_cq2).premultiply(_cq)).normalize();
}
const _cq = new THREE.Quaternion(), _cq2 = new THREE.Quaternion(), _cn = new THREE.Vector3(), _cv = new THREE.Vector3();
function enterMilk(L, mc = milk) {
  const g = L.rec.group;
  mc.attach(g);
  mc.getWorldQuaternion(_cq).invert();
  L.vel.applyQuaternion(_cq); L.ang.applyQuaternion(_cq);
  L.inMilk = true; L.milk = mc; L.resting = false; L.leaning = false; L.pose = null;
  if (!mc.userData.records.includes(L.rec)) mc.userData.records.push(L.rec);
  while (mc.userData.records.length > 60) {                 // keep memory sane: oldest goes back to the library
    const old = mc.userData.records.shift(), k = loose.findIndex(l => l.rec === old);
    if (k >= 0) loose.splice(k, 1); mc.remove(old.group); old.dispose();
  }
}
// desktop: drop the held record in from just above the rim, tilted at random
function milkDrop(r, mc = milk) {
  const I = mc.userData.inner, L = { rec: r, vel: new THREE.Vector3(0, -0.4, 0), ang: new THREE.Vector3(), resting: false, milk: mc };
  loose.push(L); r.attach = null; r.mesh.userData.loose = true;
  mc.add(r.group);
  r.group.position.set((Math.random() - 0.5) * (I.x - R_DISC) * 1.6, I.rim + 0.1, (Math.random() - 0.5) * (I.z - R_DISC) * 1.6);
  const tilt = Math.random() * 1.3, az = Math.random() * Math.PI * 2;
  r.group.quaternion.setFromAxisAngle(new THREE.Vector3(Math.cos(az), 0, Math.sin(az)), tilt);
  L.inMilk = true; L.pose = null; mc.userData.records.push(r);
}
function crateRecs(except, mc) { return loose.filter(l => l.inMilk && l.resting && l !== except && l.milk === mc); }
// top of the flat pile under a disc footprint centred at (x, z)
function pileTop(x, z, except, reach = 2 * R_DISC * 0.85, mc = except.milk) {
  let h = mc.userData.inner.floor;
  for (const o of crateRecs(except, mc)) if (o.pose === 'flat') { const p = o.rec.group.position; if (Math.hypot(x - p.x, z - p.z) < reach) h = Math.max(h, p.y + REC.THICK / 2); }
  return h;
}
function stepMilk(L, dt) {
  const g = L.rec.group, I = L.milk.userData.inner, p = g.position;
  L.vel.y -= GRAV * dt; L.vel.multiplyScalar(1 - 0.5 * dt);
  p.addScaledVector(L.vel, dt);
  const w = L.ang.length();
  if (w > 1e-4) { _dq.setFromAxisAngle(_dax.copy(L.ang).multiplyScalar(1 / w), w * dt); g.quaternion.premultiply(_dq).normalize(); }
  L.ang.multiplyScalar(1 - 0.6 * dt);
  g.updateMatrixWorld(true);
  const n = crateNormal(L, _cn), T = REC.THICK / 2;
  // four wall planes: the disc reaches R*sqrt(1 - n.a^2) along axis a
  const ex = R_DISC * Math.sqrt(Math.max(0, 1 - n.x * n.x)) + T * Math.abs(n.x);
  const ez = R_DISC * Math.sqrt(Math.max(0, 1 - n.z * n.z)) + T * Math.abs(n.z);
  if (p.x + ex > I.x) { p.x = I.x - ex; L.vel.x = -Math.abs(L.vel.x) * 0.3; L.ang.multiplyScalar(0.7); }
  if (p.x - ex < -I.x) { p.x = -I.x + ex; L.vel.x = Math.abs(L.vel.x) * 0.3; L.ang.multiplyScalar(0.7); }
  if (p.z + ez > I.z) { p.z = I.z - ez; L.vel.z = -Math.abs(L.vel.z) * 0.3; L.ang.multiplyScalar(0.7); }
  if (p.z - ez < -I.z) { p.z = -I.z + ez; L.vel.z = Math.abs(L.vel.z) * 0.3; L.ang.multiplyScalar(0.7); }
  // floor / pile plane under the lowest rim point
  const low = R_DISC * Math.sqrt(Math.max(0, 1 - n.y * n.y)) + T * Math.abs(n.y);
  const u = _cv.set(0, -1, 0).addScaledVector(n, n.y); const ul = u.length();
  const lx = ul > 1e-3 ? p.x + u.x / ul * R_DISC : p.x, lz = ul > 1e-3 ? p.z + u.z / ul * R_DISC : p.z;
  const sup = pileTop(lx, lz, L, R_DISC);
  if (p.y - low <= sup && L.vel.y <= 0) {
    p.y = sup + low;
    if (L.vel.y < -0.9) { L.vel.y *= -0.25; L.vel.x *= 0.5; L.vel.z *= 0.5; L.ang.multiplyScalar(0.5); return; }
    settleInMilk(L, n, lx, lz, sup);
  }
}
function settleInMilk(L, n, lx, lz, sup) {
  const g = L.rec.group, I = L.milk.userData.inner, p = g.position, T = REC.THICK / 2;
  const up = new THREE.Vector3(0, 1, 0), rest = (nTarget) => {
    const nNow = crateNormal(L, new THREE.Vector3());
    if (nNow.dot(nTarget) < 0) nTarget.negate();
    // rotate the group so the disc normal (seen in crate space) becomes nTarget
    g.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(nNow, nTarget)).normalize();
  };
  const layFlat = (cx, cz) => {
    cx = clamp(cx, -I.x + R_DISC, I.x - R_DISC); cz = clamp(cz, -I.z + R_DISC, I.z - R_DISC);
    rest(up.clone()); p.set(cx, pileTop(cx, cz, L) + T + 0.0004, cz); L.pose = 'flat';
  };
  const tilt = Math.acos(Math.min(1, Math.abs(n.y)));
  if (tilt < 0.6) layFlat(p.x, p.z);                      // arrived nearly flat
  else {
    // on edge: it tips over away from its contact point...
    const d = new THREE.Vector3(p.x - lx, 0, p.z - lz); if (d.lengthSq() < 1e-8) d.set(1, 0, 0); d.normalize();
    // ...into the nearest wall in that direction, if the disc is long enough to reach it
    let D = Infinity, wall = null;
    if (d.x > 1e-3) { const t = (I.x - lx) / d.x; if (t < D) { D = t; wall = 'x+'; } }
    if (d.x < -1e-3) { const t = (-I.x - lx) / d.x; if (t < D) { D = t; wall = 'x-'; } }
    if (d.z > 1e-3) { const t = (I.z - lz) / d.z; if (t < D) { D = t; wall = 'z+'; } }
    if (d.z < -1e-3) { const t = (-I.z - lz) / d.z; if (t < D) { D = t; wall = 'z-'; } }
    // lean square-on to that wall: tip direction = the wall's normal, distance measured straight to it
    if (wall) {
      d.set(wall[0] === 'x' ? (wall[1] === '+' ? 1 : -1) : 0, 0, wall[0] === 'z' ? (wall[1] === '+' ? 1 : -1) : 0);
      D = wall[0] === 'x' ? (d.x > 0 ? I.x - lx : lx + I.x) : (d.z > 0 ? I.z - lz : lz + I.z);
    }
    const already = crateRecs(L, L.milk).filter(o => o.pose === 'lean' && o.wall === wall).length;
    D -= already * (2 * T + 0.003) * 1.4;                    // lean on the ones already leaning there
    if (D > 0.02 && D < 2 * R_DISC * 0.94) {
      const a = Math.min(1.35, Math.acos(D / (2 * R_DISC)));   // angle above the floor
      rest(up.clone().multiplyScalar(Math.cos(a)).addScaledVector(d, -Math.sin(a)).normalize());
      p.set(lx + d.x * R_DISC * Math.cos(a), sup + R_DISC * Math.sin(a) + T, lz + d.z * R_DISC * Math.cos(a));
      // keep the whole disc inside along the wall it leans on (its full radius sticks out sideways)
      if (d.x) p.z = clamp(p.z, -I.z + R_DISC, I.z - R_DISC); else p.x = clamp(p.x, -I.x + R_DISC, I.x - R_DISC);
      L.pose = 'lean'; L.wall = wall;
    } else layFlat(lx + d.x * R_DISC, lz + d.z * R_DISC);   // nothing to lean on: falls flat
  }
  L.vel.set(0, 0, 0); L.ang.set(0, 0, 0); L.resting = true;
}
// after taking one out, flat records that were on top of it drop down
function resettleMilk(mc) {
  const flats = crateRecs(null, mc).filter(o => o.pose === 'flat').sort((a, b) => a.rec.group.position.y - b.rec.group.position.y);
  const done = [];
  for (const o of flats) {
    const p = o.rec.group.position; let h = mc.userData.inner.floor;
    for (const q of done) { const qp = q.rec.group.position; if (Math.hypot(p.x - qp.x, p.z - qp.z) < 2 * R_DISC * 0.85) h = Math.max(h, qp.y + REC.THICK / 2); }
    p.y = h + REC.THICK / 2 + 0.0004; done.push(o);
  }
}
function inMilk(o) { return !!milkOf(o); }

// Height fields for resting records (CLAUDE.md #58): the real top of each piece of gear, rasterised once from
// its own triangles in its local frame (1 cm cells, highest triangle wins). A record thrown onto a deck or the
// mixer lies on the highest knob, arm or lid under it instead of sinking into the geometry.
function buildHeightField(root, skip) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), M = new THREE.Matrix4();
  const tris = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const skipped = o => { for (let q = o; q && q !== root; q = q.parent) if (skip && skip(q)) return true; return false; };
  root.traverseVisible(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    if (o.isInstancedMesh && !o.userData.knobIds) return;   // instanced knobs count (#84); sleeves, rivets, LEDs don't
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.every(m => !m || m.visible === false)) return;
    if (skipped(o)) return;
    const P = o.geometry.attributes.position, I = o.geometry.index, n = I ? I.count : P.count;
    const IM = new THREE.Matrix4();
    for (let inst = 0; inst < (o.isInstancedMesh ? o.count : 1); inst++) {
    M.multiplyMatrices(inv, o.matrixWorld);
    if (o.isInstancedMesh) { o.getMatrixAt(inst, IM); M.multiply(IM); }
    for (let t = 0; t + 2 < n; t += 3) {
      a.fromBufferAttribute(P, I ? I.getX(t) : t).applyMatrix4(M);
      b.fromBufferAttribute(P, I ? I.getX(t + 1) : t + 1).applyMatrix4(M);
      c.fromBufferAttribute(P, I ? I.getX(t + 2) : t + 2).applyMatrix4(M);
      const tx0 = Math.min(a.x, b.x, c.x), tx1 = Math.max(a.x, b.x, c.x), tz0 = Math.min(a.z, b.z, c.z), tz1 = Math.max(a.z, b.z, c.z);
      tris.push(tx0, tx1, tz0, tz1, Math.max(a.y, b.y, c.y));
      x0 = Math.min(x0, tx0); x1 = Math.max(x1, tx1); z0 = Math.min(z0, tz0); z1 = Math.max(z1, tz1);
    }
    }
  });
  const cell = 0.01, nx = Math.max(1, Math.ceil((x1 - x0) / cell)), nz = Math.max(1, Math.ceil((z1 - z0) / cell));
  const h = new Float32Array(nx * nz).fill(-Infinity);
  for (let i = 0; i < tris.length; i += 5) {
    const i0 = Math.max(0, Math.floor((tris[i] - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((tris[i + 1] - x0) / cell));
    const j0 = Math.max(0, Math.floor((tris[i + 2] - z0) / cell)), j1 = Math.min(nz - 1, Math.floor((tris[i + 3] - z0) / cell));
    const y = tris[i + 4];
    for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) if (y > h[j * nx + k]) h[j * nx + k] = y;
  }
  // local x,z -> top y (or -Infinity outside the footprint)
  return (x, z) => {
    const k = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell);
    return k < 0 || j < 0 || k >= nx || j >= nz ? -Infinity : h[j * nx + k];
  };
}
let deckHF = null, mixerHF = null;
function gearFields() {
  if (!deckHF) {
    const u = decks[0].g.userData;
    // records, sprites and the (moving) platter are handled separately
    deckHF = buildHeightField(decks[0].g, o => o === u.platter || (o.userData && o.userData.isRecord) || decks.some(d => d.record && o === d.record.group));
    mixerHF = buildHeightField(mixer);
  }
}
// What is under a point: floor, a flight-case top, a deck or mixer top, an empty platter, the crate.
// Never mutates p and uses its own scratch vectors (the old version shared them with stepLoose, which
// corrupted the disc normal and left records standing at 75-90 degrees in the gear).
const _su = new THREE.Vector3(), _su2 = new THREE.Vector3();
function surfaceUnder(p) {
  gearFields();
  let best = { y: 0, kind: 'floor' };
  rig.worldToLocal(_su.copy(p));
  const c = stage.caseTopAt(_su.x, _su.z);
  if (c.key) { const y = rig.localToWorld(_su2.set(_su.x, c.y, _su.z)).y; if (y <= p.y + 0.05 && y > best.y) best = { y, kind: 'case' }; }
  for (const d of decks) {
    const l = d.g.worldToLocal(_su.copy(p));
    const onPlatter = Math.hypot(l.x - DECK.spindle.x, l.z - DECK.spindle.z) < 0.12;
    let ly = -Infinity;
    if (onPlatter) ly = d.g.userData.platterSurface + (d.record ? REC.THICK + 0.001 : 0);
    else if (Math.hypot(l.x - DECK.spindle.x, l.z - DECK.spindle.z) < 0.168) ly = d.g.userData.platterSurface;
    ly = Math.max(ly, deckHF(l.x, l.z));
    if (ly === -Infinity) continue;
    const top = d.g.localToWorld(_su2.set(l.x, ly, l.z)).y;
    if (top <= p.y + 0.05 && top > best.y) best = { y: top, kind: onPlatter && !d.record ? 'platter' : 'gear', d };
  }
  const ml = mixer.worldToLocal(_su.copy(p)), my = mixerHF(ml.x, ml.z);
  if (my > -Infinity) { const top = mixer.localToWorld(_su2.set(ml.x, my, ml.z)).y; if (top <= p.y + 0.05 && top > best.y) best = { y: top, kind: 'gear' }; }
  // records already lying there: they stack
  for (const o of loose) {
    if (!o.resting || o.inMilk || o.leaning) continue;
    const op = o.rec.group.position, top = op.y + REC.THICK / 2;
    if (Math.hypot(p.x - op.x, p.z - op.z) < R_DISC && top <= p.y + 0.05 && top > best.y) best = { y: top, kind: best.kind === 'case' ? 'case' : 'gear' };
  }
  const cl = crate.worldToLocal(_su.copy(p));
  let crateRim = -Infinity;   // world height of the record crate's rim when p is over it
  if (Math.abs(cl.x) < CRATE.W / 2 && Math.abs(cl.z) < CRATE.D / 2 && cl.y > -0.05 && cl.y < CRATE.H + 0.4) {
    crateRim = crate.localToWorld(_su2.set(0, CRATE.H, 0)).y;
    if (crateLidOpen()) best = { y: crate.localToWorld(_su2.set(0, CRATE.H * 0.6, 0)).y, kind: 'crate' };
    else { const y = crate.localToWorld(_su2.set(0, LID.PIVOT.y + LID.T + 0.004, 0)).y; if (y <= p.y + 0.05 && y > best.y) best = { y, kind: 'gear' }; }   // lid shut: records rest on it
  }
  // The milk crate only takes the record if it is not underneath the record crate (#87): with the record crate
  // standing on it, a record dropped over both used to go into the milk crate "through" the record crate.
  let topMilk = crateRim;   // with milk crates stacked, the highest one under the point takes the record
  for (const mc of milks()) {
    if (flyingMilk.has(mc)) continue;
    const mk = mc.worldToLocal(_su.copy(p));
    if (Math.abs(mk.x) < MILK.W / 2 && Math.abs(mk.z) < MILK.D / 2 && mk.y > -0.05 && mk.y < MILK.H + 0.4) {
      const milkRim = mc.localToWorld(_su2.set(0, MILK.H, 0)).y;
      if (milkRim > topMilk) { topMilk = milkRim; best = { y: milkRim, kind: 'milk', m: mc }; }
    }
  }
  return best;
}
// The support under the whole disc: centre plus two rings of samples. An empty platter under the centre
// wins (the record drops onto it and plays); otherwise the highest thing under any part of the disc.
const _smp = new THREE.Vector3();
function supportUnder(pos) {
  const s = surfaceUnder(pos);
  if (s.kind === 'platter' || s.kind === 'crate' || s.kind === 'milk') return s;
  const out = { y: s.y, kind: s.kind, d: s.d };
  for (const rr of [0.5, 0.95]) for (let k = 0; k < 12; k++) {
    const a = k * Math.PI / 6;
    const sk = surfaceUnder(_smp.set(pos.x + Math.cos(a) * R_DISC * rr, pos.y, pos.z + Math.sin(a) * R_DISC * rr));
    if (sk.kind === 'crate' || sk.kind === 'milk' || sk.y <= out.y) continue;
    out.y = sk.y; out.kind = sk.kind === 'case' ? 'case' : 'gear';
  }
  return out;
}
const _dn = new THREE.Vector3(), _dq = new THREE.Quaternion(), _dq2 = new THREE.Quaternion(), _dax = new THREE.Vector3(), _dup = new THREE.Vector3();
function stepLoose(dt) {
  const eye = camera.getWorldPosition(new THREE.Vector3());
  for (let i = loose.length - 1; i >= 0; i--) {
    const L = loose[i], g = L.rec.group;
    if (L.inMilk) { if (!L.resting) stepMilk(L, dt); L.rec.setLOD(g.getWorldPosition(_cv).distanceTo(eye) > 0.3); continue; }
    if (!L.resting) {
      L.vel.y -= GRAV * dt;
      L.vel.multiplyScalar(1 - 0.5 * dt);              // a flat disc sheds speed quickly in air
      g.position.addScaledVector(L.vel, dt);
      const w = L.ang.length();
      if (w > 1e-4) { _dq.setFromAxisAngle(_dax.copy(L.ang).multiplyScalar(1 / w), w * dt); g.quaternion.premultiply(_dq).normalize(); }
      L.ang.multiplyScalar(1 - 0.6 * dt);
      // disc normal (unit, world) and the drop of its lowest rim point below the centre
      g.updateMatrixWorld(true);
      const n = _dn.set(0, 1, 0).applyQuaternion(L.rec.mesh.getWorldQuaternion(_dq)).normalize();
      const low = R_DISC * Math.sqrt(Math.max(0, 1 - n.y * n.y)) + REC.THICK / 2 * Math.abs(n.y);
      const s = supportUnder(g.position);
      if (s.kind === 'milk') { enterMilk(L, s.m); continue; }       // over the spare crate: its own physics takes over
      if (g.position.y - low <= s.y && L.vel.y <= 0) {
        if (s.kind === 'platter') { const side = n.y >= 0 ? 'A' : 'B'; loose.splice(i, 1); L.rec.mesh.userData.loose = false; L.rec.sideUp = side; L.rec.flipT = side === 'A' ? 0 : 1; L.rec.setLOD(false); placeOnDeck(s.d, L.rec); continue; }
        if (s.kind === 'crate') { loose.splice(i, 1); scene.remove(g); L.rec.dispose(); layoutSleeves(); continue; }
        g.position.y = s.y + low;
        L.vel.y = -L.vel.y * 0.3; L.vel.x *= 0.55; L.vel.z *= 0.55; L.ang.multiplyScalar(0.4);
        // tip toward flat on whichever face is nearer to up
        const flat = _dq2.setFromUnitVectors(n, _dup.set(0, n.y >= 0 ? 1 : -1, 0));
        const half = new THREE.Quaternion().slerp(flat, 0.5);
        g.quaternion.premultiply(half).normalize();
        if (Math.abs(L.vel.y) < 0.35) {
          // come to rest exactly flat, on top of the highest support under the disc
          g.updateMatrixWorld(true);
          const n2 = _dn.set(0, 1, 0).applyQuaternion(L.rec.mesh.getWorldQuaternion(_dq)).normalize();
          g.quaternion.premultiply(_dq2.setFromUnitVectors(n2, _dup.set(0, n2.y >= 0 ? 1 : -1, 0))).normalize();
          g.position.y = supportUnder(g.position).y + REC.THICK / 2 + 0.0005;
          L.vel.set(0, 0, 0); L.ang.set(0, 0, 0); L.resting = true; L.onFloor = s.kind === 'floor';
          leanIfAgainstSide(L);
        }
      }
    }
    // low detail when it lies on the floor or is more than about a foot from your eyes
    L.rec.setLOD(L.onFloor || g.position.distanceTo(eye) > 0.3);
  }
}
// Leaning (CLAUDE.md #61): a record that comes to rest beside something at least 3 cm taller (a deck, the
// mixer, a flight case, the milk crate) leans against it at 45 degrees: bottom edge on the lower surface,
// upper part resting on the top edge of the obstacle, or against its side if it is taller than the lean.
function leanIfAgainstSide(L) {
  const g = L.rec.group, c = g.position.clone();
  const probe = new THREE.Vector3();
  const base = surfaceUnder(probe.set(c.x, c.y + 0.02, c.z));
  if (base.kind === 'crate' || base.kind === 'milk') return;
  let best = null;
  for (const rr of [0.3, 0.55, 0.8, 1.0, 1.15]) {
    for (let k = 0; k < 16; k++) {
      const a = k * Math.PI / 8, dx = Math.cos(a), dz = Math.sin(a);
      const x = c.x + dx * R_DISC * rr, z = c.z + dz * R_DISC * rr;
      const h = Math.max(surfaceUnder(probe.set(x, base.y + 2.5, z)).y, surfaceUnder(probe.set(x, base.y + 0.3, z)).y);
      if (h > base.y + 0.03 && (!best || h > best.h + 0.01)) best = { h, dx, dz, w: R_DISC * rr };
    }
    if (best) break;   // nearest ring with a rise wins
  }
  if (!best) return;
  const lean = Math.PI / 4, dh = best.h - base.y, R2 = 2 * R_DISC;
  const b = Math.min(dh / Math.tan(lean), R2 * Math.cos(lean));     // bottom edge distance from the obstacle
  const d = new THREE.Vector3(best.dx, 0, best.dz);
  const wall = new THREE.Vector3(c.x, base.y, c.z).addScaledVector(d, best.w);
  const p0 = wall.clone().addScaledVector(d, -b);
  g.position.copy(p0).addScaledVector(d, R_DISC * Math.cos(lean)).add(new THREE.Vector3(0, R_DISC * Math.sin(lean) + REC.THICK / 2, 0));
  g.updateMatrixWorld(true);
  const n0 = new THREE.Vector3(0, 1, 0).applyQuaternion(L.rec.mesh.getWorldQuaternion(new THREE.Quaternion()));
  const n = new THREE.Vector3(0, Math.cos(lean), 0).addScaledVector(d, -Math.sin(lean)).normalize();
  if (n0.y < 0) n.negate();
  g.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(n0, n)).normalize();
  L.leaning = true; L.onFloor = false;
}
function returnHeld() {
  if (!held) return;
  scene.remove(held.group); held.dispose(); held = null; layoutSleeves();
}

// ------------------------------------------------------------------ decks
function deckOf(name) { return decks[name === 'A' ? 0 : 1]; }

async function placeOnDeck(d, rec3d) {
  if (held === rec3d) held = null;
  rec3d.attach = null;
  if (d.record) { // old record goes back to the crate
    liftNeedle(d, true);
    d.g.remove(d.record.group); d.record.dispose(); d.record = null;
    engine.unload(d.i); d.loaded = false;
  }
  d.record = rec3d;
  scene.remove(rec3d.group);
  rec3d.group.position.set(DECK.spindle.x, d.g.userData.platterSurface + REC.THICK / 2, DECK.spindle.z);
  rec3d.group.quaternion.identity(); rec3d.group.scale.setScalar(1);
  d.g.add(rec3d.group);
  for (const m of d.g.userData.slipmat || []) m.visible = false; // the record covers the mat; hiding it avoids depth fighting
  engine.post({ type: 'record', deck: d.i, on: true });   // #120: it lands still; the slipmat pulls it up to platter speed
  d.recAngle = d.platterAngle;
  layoutSleeves();
  await loadSide(d);
}

async function loadSide(d) {
  const token = ++d.loadToken;
  const rec3d = d.record; const side = rec3d.sideUp; const t = rec3d.track(side);
  d.side = side; d.track = t; d.loaded = false; d.duration = t ? t.duration : 0;
  engine.unload(d.i);
  if (!t || t.missing) { toast(`Deck ${d.name}: side ${side} is blank`); return; }
  d.loading = true;
  try {
    await engine.init();
    // decoded already if the record was pulled a moment ago (#70); else decode now
    const ahead = decodeCache.get(t.id);
    if (ahead) decodeCache.delete(t.id);
    let decoded;
    if (ahead) decoded = await ahead;
    else {
      const data = await fetchSide(t);
      if (token !== d.loadToken) return;
      decoded = await engine.decode(data.bytes.slice(0));
      envCache.set(t.id, { env: decoded.env, duration: decoded.duration });
    }
    if (token !== d.loadToken) return;
    if (rec3d.envs[side] !== decoded.env) { rec3d.envs[side] = decoded.env; rec3d.durations[side] = decoded.duration; rec3d.redraw(side); }
    d.duration = decoded.duration;
    engine.load(d.i, decoded, t, 0);
    d.loaded = true;
    // record angle continues from where the record is (#120: the record has its own angle; the platter turns under it)
    d.angleOffset = d.recAngle;
  } catch (e) {
    console.error(e); toast(`Deck ${d.name}: ${e.message}`, 4000);
  } finally { if (token === d.loadToken) d.loading = false; }
}

function flipOnDeck(d) {
  if (!d.record) return;
  const st = engine.state.decks[d.i];
  if (d.motorOn || Math.abs(st.rate) > 0.05 || Math.abs(st.prate || 0) > 0.05) { toast('Stop the deck before flipping the record'); return; }
  liftNeedle(d, true);
  d.record.sideUp = d.record.sideUp === 'A' ? 'B' : 'A';
  loadSide(d);
}

function setMotor(d, on) {
  if (on && d.power === false) return;          // START does nothing with the power off
  engine.deck(d.i, 'windUp', false);             // START / STOP always use the normal motor torque
  d.motorOn = on; engine.deck(d.i, 'motorOn', on);
}
// Power dial (CLAUDE.md #48): off = every deck light out, motor released, platter winds down on its own.
// Wind back up (owner, #85): power back on while the platter is still coasting (and the motor was running when
// it was switched off) re-engages the motor, so the platter picks up speed again from where it is. Once it
// has come to a dead stop, START is needed as before.
function setPower(d, on) {
  if (!on) d.motorWasOn = d.motorOn;
  d.power = on; engine.deck(d.i, 'power', on);
  if (!on) { engine.deck(d.i, 'windUp', false); d.motorOn = false; engine.deck(d.i, 'motorOn', false); }
  else if (d.motorWasOn && Math.abs(engine.state.decks[d.i].rate) > 0.01) { engine.deck(d.i, 'windUp', true); d.motorOn = true; engine.deck(d.i, 'motorOn', true); }   // gentle catch (#90)
  if (on) d.motorWasOn = false;
}
function setSpeed(d, s) { d.speed = s; engine.deck(d.i, 'speed', s); }
function setPitch(d, p, fromUser = false) {
  p = clamp(p, -PITCH_RANGE, PITCH_RANGE);
  if (fromUser && Math.abs(p) < 0.0035) p = 0; // centre detent
  d.pitch = p; engine.deck(d.i, 'pitch', p);
  const t = d.g.userData.pitchTravel;
  d.g.userData.pitchCap.position.z = (t.z0 + t.z1) / 2 + (p / PITCH_RANGE) * (t.z1 - t.z0) / 2;
}

// tonearm
function restYaw(d) { return d.g.userData.restYaw || 0; }
function armTilt(u, lift) { return (u.armDown || 0) - (u.armLift || 0.075) * lift; }
function liftNeedle(d, park) {
  engine.deck(d.i, 'needle', false);
  d.arm.targetLift = 1; d.arm.onLand = null;
  if (park) { d.arm.parking = true; }
}
function dropNeedleAt(d, time) {
  if (!d.loaded) { toast(d.loading ? 'Still loading…' : `Deck ${d.name} has nothing to play`); return; }
  engine.deck(d.i, 'needle', false);
  d.arm.parking = false;
  d.arm.targetLift = 1;
  d.arm.cueTime = time;
  d.arm.targetYaw = armYawForRadius(d.g.userData.pivot, DECK.spindle, timeToRadius(time, d.duration));
  d.arm.onLand = () => { engine.post({ type: 'seek', deck: d.i, time: d.arm.cueTime }); engine.deck(d.i, 'needle', true); };
  d.arm.wantDown = true;
}

// Tonearm moved by hand (XR or mouse). CLAUDE.md #61: grabbing it while it plays keeps the stylus in
// the vinyl; dragging it across the record crosses grooves (one revolution of audio per groove) and the
// worklet makes the scrape. Lift your hand ~7 cm (or drag off the record) to lift the needle.
function armGrab(d) {
  const a = d.arm, st = engine.state.decks[d.i];
  a.manual = true; a.manualYaw = a.yaw; a.onLand = null; a.wantDown = false; a.auto = false; a.pendingR = null; a.prevR = armRadius(d, a.yaw);
  if (st.needle && d.loaded) {
    a.dragDown = true; a.lastDragT = radiusToTime(armRadius(d, a.yaw), d.duration);
    engine.post({ type: 'needleDrag', deck: d.i, active: true });
  } else { a.dragDown = false; liftNeedle(d, false); }
}
function armRadius(d, yaw) { const u = d.g.userData; return Math.hypot(u.pivot.x + ARM.L * Math.sin(yaw) - DECK.spindle.x, u.pivot.z + ARM.L * Math.cos(yaw) - DECK.spindle.z); }
function endNeedleDrag(d) { if (d.arm.dragDown) { d.arm.dragDown = false; engine.post({ type: 'needleDrag', deck: d.i, active: false }); } }
// #104 (owner): carrying the raised arm in over the record, the needle finds it by itself: once the stylus
// crosses into the lead-in (from outside the disc edge inwards, up to the first music groove) the arm leaves
// the hand, settles on the first groove and lowers gently onto it, so the record plays from its start.
const DROP_OUT = REC.EDGE + 0.003, DROP_IN = REC.OUT;
function armDrag(d, yaw, lift = 0) {
  const a = d.arm; if (a.auto) return 'dropped';
  a.manualYaw = clamp(yaw, -1.2, 0.25);
  if (!a.dragDown) {
    const r = armRadius(d, a.manualYaw), was = a.prevR; a.prevR = r;
    if (d.loaded && d.record && was > DROP_OUT && r <= DROP_OUT && r >= DROP_IN - 0.004) {
      a.auto = true; a.manual = false;
      a.yaw = a.targetYaw = armYawForRadius(d.g.userData.pivot, DECK.spindle, REC.OUT);
      a.parking = false; a.wantDown = true; a.cueTime = radiusToTime(REC.OUT, d.duration);
      a.onLand = () => { engine.post({ type: 'seek', deck: d.i, time: a.cueTime }); engine.deck(d.i, 'needle', true); };
      return 'drop';
    }
    return;
  }
  const r = armRadius(d, a.manualYaw);
  if (lift > 0.07 || r > REC.EDGE + 0.002 || r < REC.IN - 0.006) { endNeedleDrag(d); liftNeedle(d, false); return; }   // 7 cm up lifts (owner)
  const T = radiusToTime(Math.min(REC.EDGE, Math.max(REC.IN, r)), d.duration), dT = T - a.lastDragT;
  if (Math.abs(dT) > 1e-4) { a.lastDragT = T; engine.post({ type: 'needleDrag', deck: d.i, delta: dT }); }
}
// let go without dropping anywhere new (desktop click on the arm)
function armCancel(d) { const a = d.arm; if (a.auto) return; a.manual = false; a.targetYaw = a.yaw = a.manualYaw; endNeedleDrag(d); }
function armRelease(d) {
  const a = d.arm; if (a.auto) { a.auto = false; return; }   // #104: already dropping onto the lead-in
  if (a.dragDown) { a.manual = false; a.yaw = a.targetYaw = a.manualYaw; endNeedleDrag(d); return; }   // stays in the groove
  a.manual = false; a.yaw = a.manualYaw;
  const u = d.g.userData;
  const nx = u.pivot.x + ARM.L * Math.sin(a.yaw), nz = u.pivot.z + ARM.L * Math.cos(a.yaw);
  const r = Math.hypot(nx - DECK.spindle.x, nz - DECK.spindle.z);
  if (d.loaded && r < REC.EDGE && r > REC.IN - 0.004) {
    a.cueTime = radiusToTime(r, d.duration); a.targetYaw = a.yaw; a.parking = false; a.wantDown = true;
    a.onLand = () => { engine.post({ type: 'seek', deck: d.i, time: a.cueTime }); engine.deck(d.i, 'needle', true); };
  } else if (d.record && d.track && !d.loaded && r < REC.EDGE && r > REC.IN - 0.004) {
    // #181 (owner): let go over a record whose grooves are still loading: hover there and drop by itself once it's ready
    a.targetYaw = a.yaw; a.parking = false; a.pendingR = r;
  } else { a.targetYaw = a.yaw; a.parking = r > REC.R; }
}
function updateArm(d, dt) {
  const a = d.arm, u = d.g.userData;
  const st = engine.state.decks[d.i];
  if (a.pendingR != null) {   // #181: arm waiting over a loading record
    if (a.manual || !d.record || !d.track) a.pendingR = null;
    else if (d.loaded) {
      a.cueTime = radiusToTime(a.pendingR, d.duration); a.pendingR = null; a.targetYaw = a.yaw; a.wantDown = true;
      a.onLand = () => { engine.post({ type: 'seek', deck: d.i, time: a.cueTime }); engine.deck(d.i, 'needle', true); };
    }
  }
  if (a.manual) {
    a.yaw = a.manualYaw; a.lift = a.dragDown ? 0 : Math.min(1, a.lift + dt * 6);
    u.arm.userData.yaw.rotation.y = a.yaw; u.arm.userData.pitch.rotation.x = armTilt(u, a.lift); return;
  }
  if (st.needle && d.loaded) {
    // stylus rides the groove
    const r = timeToRadius(engine.pos(d.i), d.duration);
    a.yaw = a.targetYaw = armYawForRadius(u.pivot, DECK.spindle, r);
    a.lift = a.targetLift = 0;
  } else {
    if (a.parking) a.targetYaw = restYaw(d);
    const yawDone = Math.abs(a.targetYaw - a.yaw) < 0.002;
    if (!yawDone) {
      // lift first, then swing
      a.lift = Math.min(1, a.lift + dt * 5);
      if (a.lift >= 1) a.yaw += Math.sign(a.targetYaw - a.yaw) * Math.min(Math.abs(a.targetYaw - a.yaw), dt * 1.4);
    } else if (a.wantDown && a.onLand) {
      a.lift = Math.max(0, a.lift - dt * (a.lift > 0.25 ? 3.2 : 1.6));   // #104: ease the last bit onto the vinyl
      if (a.lift <= 0) { const f = a.onLand; a.onLand = null; a.wantDown = false; f(); }
    } else {
      a.lift += (a.targetLift - a.lift) * Math.min(1, dt * 8);
      if (a.parking && yawDone) a.parking = false;
    }
  }
  u.arm.userData.yaw.rotation.y = a.yaw;
  u.arm.userData.pitch.rotation.x = armTilt(u, a.lift);
}

// ------------------------------------------------------------------ SYNC (CLAUDE.md #2, #8, #12)
// #102/#116: the track's BPM = the MP3's ID3 BPM (TBPM); Rekordbox's AverageBpm only when the file has none.
// No beat grid anywhere: a single number per track.
function trackBpm(d) { return d.loaded && d.track ? bpmOf(d.track) : 0; }   // #117: ID3, else tapped, else 0
const LOCK_NUDGE_MAX = 0.08;   // #116: largest temporary speed change while LOCK aligns beats (8 %)
function effBpm(d) { return trackBpm(d) * d.speed * (1 + d.pitch); }

function doSync() {
  const [a, b] = decks;
  const ba = trackBpm(a), bb = trackBpm(b);
  if (!ba || !bb) { flashSync('red'); toast(`LOCK needs a BPM on both decks (no BPM on deck ${!ba && !bb ? 'A or B' : !ba ? 'A' : 'B'}: tap BEAT 1 on the beat)`, 2600); return; }
  const target = (effBpm(a) + effBpm(b)) / 2;
  const pa = target / (ba * a.speed) - 1, pb = target / (bb * b.speed) - 1;
  if (Math.abs(pa) > PITCH_RANGE + 1e-6 || Math.abs(pb) > PITCH_RANGE + 1e-6) {
    flashSync('red'); toast(`Meeting point ${target.toFixed(1)} BPM is outside ±16% for one deck`); return;
  }
  syncAnim = { t: 0, dur: 0.4, from: [a.pitch, b.pitch], to: [pa, pb], target };
  flashSync('blue');
}
function stepSync(dt) {
  if (!syncAnim) return;
  syncAnim.t += dt;
  const k = Math.min(1, syncAnim.t / syncAnim.dur), e = k * k * (3 - 2 * k);
  for (const d of decks) {
    if (heldPitch.has(d.i)) continue; // DJ is holding that fader: hands off
    setPitch(d, k >= 1 ? syncAnim.to[d.i] : syncAnim.from[d.i] + (syncAnim.to[d.i] - syncAnim.from[d.i]) * e);   // exact target on the last step
  }
  if (k >= 1) {
    const target = syncAnim.target; syncAnim = null;
    // #116 (owner): after meeting halfway, one nudge lines the follower's tapped beats up with the lead's, to the
    // NEAREST beat (not the bar). Needs BEAT 1 tapped on both decks; otherwise tempo only.
    const t0 = decks[0].track, t1 = decks[1].track, a0 = t0 && beat1Of(t0), a1 = t1 && beat1Of(t1);
    if (a0 != null && a1 != null) {
      engine.post({ type: 'phase', lead: lastTouched, beat1: [a0, a1], bpm: [trackBpm(decks[0]), trackBpm(decks[1])], maxE: LOCK_NUDGE_MAX });
      toast(`LOCK ${target.toFixed(2)} BPM · aligning deck ${DECK_NAMES[1 - lastTouched]} to ${DECK_NAMES[lastTouched]}`, 1800);
    } else toast(`LOCK ${target.toFixed(2)} BPM · tempo only (tap BEAT 1 on ${a0 == null && a1 == null ? 'both decks' : 'deck ' + DECK_NAMES[a0 == null ? 0 : 1]} to align beats)`, 3000);
  }
}
function flashSync(color) { syncFlash = { t: 0.9, color }; }

engine.on(m => {
  if (m.type === 'phaseDone') {
    if (m.ok) toast(`LOCK: deck ${DECK_NAMES[m.follower]} ${m.offset >= 0 ? 'pushed' : 'held back'} ${Math.abs(m.offset).toFixed(2)} beat over ${m.seconds.toFixed(1)} s`, 2200);
    else toast('LOCK: beats not aligned (both decks must be playing, hands off the follower)', 2600);
  }
});

// ------------------------------------------------------------------ pointer interaction
// One code path for every ray-casting pointer: the mouse, an XR controller ray, or a hand ray.
// p = { ray: THREE.Ray, mouse: bool, x, y (screen, mouse only), shift, space (XR ray Object3D), drag }
const raycaster = new THREE.Raycaster(); raycaster.layers.enable(HIDE_LAYER);   // #154: the decks' instanced parts are picked through their hidden originals
const ndc = new THREE.Vector2();
const activePointers = new Set();
const scratches = new Set();     // active hand-on-record states (mouse, rays, fingers)
const heldPitch = new Set();     // deck indices whose pitch fader is being held
let hoverDeck = null;
let lastKnobClick = { id: null, t: 0 };

// three's raycaster also hits hidden objects: skip anything hidden (the decks' unused 1 m target-lamp glow sprites
// sat invisibly over the mixer and swallowed clicks, found in #84)
const shown = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
function castRay(ray, objects) { raycaster.ray.copy(ray); raycaster.near = 0; raycaster.far = 20; return raycaster.intersectObjects(objects, true).filter(h => shown(h.object)); }
function rayPlaneY(ray, y) { return ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3()); }
function mouseRay(e) { ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); raycaster.setFromCamera(ndc, camera); return raycaster.ray.clone(); }
function interactive() { return [deckGroups[0], deckGroups[1], mixer, crateRig, ...milks(), neon, ledwall, cases.caseA.group, ...loose.filter(l => !l.inMilk).map(l => l.rec.group)]; }
// instanced parts (the mixer knobs, #84): a hit on instance i stands for that knob's proxy object
function hitTarget(hit) { const o = hit.object, ids = o.userData.knobIds; return ids && hit.instanceId !== undefined ? mixer.userData.controls[ids[hit.instanceId]] : o; }
function controlOf(o) {
  while (o) { const u = o.userData; if (u && (u.control || u.record || u.crateSleeves || u.crateScreen || u.mixScreen || u.crateDisc || u.crateCover || u.platterOf || u.lid || u.move || u.resize)) return o; o = o.parent; }
  return null;
}
function deckGroupOf(o) { while (o) { if (o === deckGroups[0]) return decks[0]; if (o === deckGroups[1]) return decks[1]; o = o.parent; } return null; }
function inCrate(o) { while (o) { if (o === crateRig) return true; o = o.parent; } return false; }

// ---- shared actions (also used by direct hand/controller touch in xr.js) ----
function setMix(id, v) {
  mixVal[id] = clamp(v, id === 'xfader' ? -1 : 0, 1); applyMix(id); updateMixVisual(id);
}
function pressControl(c, src) { // buttons; returns true if handled (src: who pressed, for BEAT 1 long press)
  if (c.deck) {
    const d = deckOf(c.deck);
    { const bu = d.g.userData, b = c.id === 'start' ? bu.start : c.id === 'rpm33' ? bu.b33 : c.id === 'rpm45' ? bu.b45 : null; if (b && b.userData.press) b.userData.press(); }
    if (c.id === 'start') { setMotor(d, !d.motorOn); return true; }
    if (c.id === 'power') { setPower(d, d.power === false); return true; }
    if (c.id === 'target') { const t = d.g.userData.target; if (t) t.raised = !t.raised; return true; }
    if (c.id === 'rpm33') { setSpeed(d, 1); return true; }
    if (c.id === 'rpm45') { setSpeed(d, 45 / (100 / 3)); return true; }
    if (c.id === 'arm') { const st = engine.state.decks[d.i]; if (st.needle || d.arm.lift < 0.5) liftNeedle(d, true); else dropNeedleAt(d, 0); return true; }
  } else if (c.mixer) {
    const id = c.id;
    { const b = mixer.userData.controls[id]; if (b && b.userData.press) b.userData.press(); }
    if (id === 'mic') { toggleMic(); return true; }
    if (id === 'sync') { doSync(); return true; }
    if (id === 'splitcue') { splitCue = !splitCue; engine.setSplitCue(splitCue); toast(splitCue ? 'Split cue: master left ear, cue right ear' : 'Split cue off'); return true; }
    if (id.endsWith('.beat1')) { tapBeat1(decks[id[0] === 'A' ? 0 : 1], src || 'mouse'); return true; }
    if (id.endsWith('.cue')) { const i = id[0] === 'A' ? 0 : 1; cueOn[i] = !cueOn[i]; engine.setCue(i, cueOn[i]); return true; }
  }
  return false;
}
// microphone (CLAUDE.md #60): first press asks for the mic (if not already allowed on the start screen)
let micOn = false, micBusy = false;
async function toggleMic() {
  if (!engine.ctx || micBusy) return;
  if (micOn) { micOn = false; engine.setMicOn(false); toast('Mic off'); return; }
  // #113 Mic route 'quest' (default): the app never opens the mic. The voice reaches the recording / stream
  // through the Quest recorder's own mic ("Include mic audio") or BeamXR's mic, so no delayed copy of it
  // is played into the headphones (= no echo). MIC then only does the talkover duck.
  if (settings.micRoute !== 'app') {
    if (engine.mic) engine.micClose();
    micOn = true; engine.setMicOn(true);
    const d = engine.micDuckDb();
    toast(d < 0 ? `Talkover: music ${d.toFixed(0)} dB` : 'Talkover on. Turn LEVEL · DUCK right to duck the music', 2500);
    return;
  }
  micBusy = true;
  try {
    await engine.micOpen({ deviceId: settings.micDevice || undefined, echo: settings.micEcho !== false });
    const rt = engine.micRoundTripMs();
    micOn = true; engine.setMicOn(true); toast('Mic live: ' + engine.mic.label + (rt ? ` · you hear yourself ~${rt} ms late` : ''), 3500);
  } catch (e) { toast('Microphone: ' + (e.name === 'NotAllowedError' ? 'permission denied' : e.name === 'OverconstrainedError' ? 'that mic is not connected' : e.message), 3500); }
  micBusy = false;
}
function micLevel() {
  const m = engine.mic; if (!m || !micOn) return 0;
  m.meter.getFloatTimeDomainData(m.meterBuf); let p = 0; for (const x of m.meterBuf) { const a = Math.abs(x); if (a > p) p = a; } return p;
}
function crateScreenPress(uv) {
  const c = crateScreen.canvas; const px = uv.x * c.width, py = (1 - uv.y) * c.height;
  const inR = b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
  if (py < CS.head) { if (search.results) exitSearch(); else cratePlaylist(px < c.width / 2 ? -1 : 1); return; }
  if (py < SB.y + SB.h) {
    const b = search.btns.find(inR); if (!b) return;
    if (b.id === 'mic') openNativeKeyboard();
    else if (b.id === 'milk') { spawnMilk(); drawCrateScreen(); }
    else if (b.id === 'clear') exitSearch();
    else if (b.id === 'kb') { search.kb = !search.kb; drawCrateScreen(); }
    else { search.kb = true; drawCrateScreen(); }
    return;
  }
  const R = crateScreen.rows;
  if (py >= R.kbY) { const key = search.keys.find(inR); if (key) kbKey(key.k); return; }
  const k = Math.floor((py - R.y0) / R.RH);
  if (k >= 0 && k < R.ROWS) {
    const idx = R.start + k;
    if (idx === crateState.sel) pullSelected();
    else if (idx < currentList().length) { crateState.sel = idx; drawCrateScreen(); layoutSleeves(); }
  }
}
function pitchFromLocalZ(d, z) { const t = d.g.userData.pitchTravel; return ((z - (t.z0 + t.z1) / 2) / ((t.z1 - t.z0) / 2)) * PITCH_RANGE; }
function sliderFromLocal(id, l) {
  if (id === 'xfader') { const t = mixer.userData.xTravel; return clamp((l.x - t.x0) / (t.x1 - t.x0) * 2 - 1, -1, 1); }
  const t = mixer.userData.faderTravel; return clamp((t.z1 - l.z) / (t.z1 - t.z0), 0, 1);
}

// Hand on the record. Angles are around the spindle in deck-local XZ; +angle = forward (clockwise from above).
// nudge = a hand on the platter rim: friction slows it a touch, pushing along speeds it up (CLAUDE.md #35)
// #120: the hand's angle (unwrapped, rad) goes to the worklet, which ties the record to it with a stiff spring
// (the platter keeps turning under the slipmat). force = how hard a finger presses on the platter rim (N).
function scratchBegin(d, localPoint, nudge = false, force) {
  const s = { deck: d, nudge, lastAng: Math.atan2(localPoint.z - DECK.spindle.z, localPoint.x - DECK.spindle.x), lastT: performance.now(), rate: 0, lastMove: performance.now(), holding: false, ang: 0, force: force != null ? force : RIM_FORCE_LIGHT };
  scratches.add(s); return s;
}
const RIM_FORCE_LIGHT = 0.35;   // N: a fingertip resting on the platter's side
function handRate(s) { return s.rate; }
function postHand(s, holding) {
  if (s.nudge) engine.post({ type: 'touch', deck: s.deck.i, active: holding, rate: s.rate, force: s.force });
  else engine.post(holding ? { type: 'hand', deck: s.deck.i, holding: true, rate: s.rate, ang: s.ang } : { type: 'hand', deck: s.deck.i, holding: false });
}
function scratchMove(s, localPoint, force) {
  const d = s.deck;
  if (force != null) s.force += (force - s.force) * 0.3;   // tracking jitter: smooth the pressing force
  if (!s.holding) { s.holding = true; s.rate = s.nudge ? 0 : engine.state.decks[d.i].rate; postHand(s, true); }
  const ang = Math.atan2(localPoint.z - DECK.spindle.z, localPoint.x - DECK.spindle.x);
  let da = ang - s.lastAng; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
  const now = performance.now(); const dtm = Math.max(4, now - s.lastT) / 1000;
  s.rate = s.rate * 0.4 + ((da / dtm) / W33) * 0.6;
  s.ang += da;
  s.lastAng = ang; s.lastT = now; s.lastMove = now;
  postHand(s, true);
}
// Spindle twist (owner, #105): pinch the spindle / label and twist. The record moves by exactly the twisted
// angle, like a real spindle (one turn = 1.8 s of audio, 10 deg = 50 ms), while the motor keeps turning at
// pitch-fader speed, so the tempo is untouched. Positive seconds = forward (clockwise seen from above).
function spindleTwist(d, seconds) {
  if (!d.loaded || !seconds) return;
  engine.post({ type: 'shift', deck: d.i, delta: seconds }); d.twistT = performance.now();
}
function scratchEnd(s) { if (s.holding) postHand(s, false); scratches.delete(s); }
function scratchIdle() { // a still hand holds the record still
  const now = performance.now();
  for (const s of scratches) if (s.holding && now - s.lastMove > 45) {
    s.rate *= 0.5; if (Math.abs(s.rate) < 0.01) s.rate = 0;
    postHand(s, true);
  }
}

const NAMES = { preview: 'the camera preview', neon: 'the neon sign', ledwall: 'the LED wall', deckA: 'turntable A', deckB: 'turntable B', mixer: 'the mixer', crate: 'the record crate', caseA: 'flight case 1', caseB: 'flight case 2' };
// Resize from a bottom handle. P = new handle position in world (horizontal change), dH = height change.
function resizeCase(dr, P, dH) {
  const c = cases[dr.key], g = c.group, h = dr.h;
  let W = dr.W0, D = dr.D0;
  if (P) {
    const d = P.clone().sub(dr.grab); d.applyQuaternion(g.parent.getWorldQuaternion(new THREE.Quaternion()).invert()); // rig space
    const cs = Math.cos(g.rotation.y), sn = Math.sin(g.rotation.y);
    const lx = d.x * cs - d.z * sn, lz = d.x * sn + d.z * cs;
    if (h.sx) W = dr.W0 + h.sx * lx;
    if (h.sz) D = dr.D0 + h.sz * lz;
  } else if (dr.lastWD) { W = dr.lastWD[0]; D = dr.lastWD[1]; }
  dr.lastWD = [W, D];
  if (dH !== null && dH !== undefined) dr.H = dr.H0 + dH;
  stage.resize(dr.key, W, D, dr.H !== undefined ? dr.H : c.H, { sx: h.sx, sz: h.sz, W0: dr.W0, D0: dr.D0, pos0: dr.pos0 });
}

// ---- generic ray pointer ----
function pointerDown(p) {
  engine.resume();
  const hit = castRay(p.ray, interactive())[0];
  if (held && !held.attach) { // desktop-style held record: click a deck to place, the crate to put back
    if (hit) {
      const d = deckGroupOf(hit.object);
      if (d) { placeOnDeck(d, held); return true; }
      if (inCrate(hit.object)) { returnHeld(); return true; }
      const mc = milkOf(hit.object); if (mc) { const r = held; held = null; scene.attach(r.group); milkDrop(r, mc); layoutSleeves(); return true; }
    }
  }
  if (!hit) return false;
  const obj = controlOf(hitTarget(hit)); if (!obj) return false;
  const u = obj.userData;
  p.start = { x: p.x, y: p.y, t: performance.now(), point: hit.point.clone() };
  if (u.lid && u.lidHandle && lidShut()) {   // shut lid: the carry handle moves the whole crate (#86)
    const g = MOVABLE.crate;
    p.drag = { kind: 'move', target: 'crate', st: stage.beginMove('crate'), y: hit.point.y, grab: hit.point.clone(), pos0: g.position.clone(), yaw0: g.rotation.y, x0: p.x };
    activePointers.add(p); return true;
  }
  if (u.lid) { p.drag = { kind: 'lid', y0: p.y, a0: lidSt.a, moved: false }; activePointers.add(p); return true; }
  if (u.mixScreen) { mixScreenPress(hit.uv); return true; }
  if (u.crateScreen) { if (crateLidOpen()) crateScreenPress(hit.uv); return true; }
  if (u.crateDisc) { pullSelected(p.space); layoutSleeves(); return true; }
  if ((u.crateSleeves || u.crateCover) && !crateLidOpen()) return true;
  if (u.crateSleeves || u.crateCover) {
    const idx = u.crateCover ? currentList().indexOf(u.rec) : sleeveMap[hit.instanceId];
    if (idx === crateState.sel) pullSelected(p.space); else if (idx >= 0) { crateState.sel = idx; drawCrateScreen(); layoutSleeves(); }
    return true;
  }
  if (u.record) {
    if (u.loose) { pickUpLoose(u.record, p.space || null); return true; }
    const d = deckGroupOf(obj); if (!d) return true;
    const local = d.g.worldToLocal(hit.point.clone());
    p.drag = { kind: 'record', deck: d, y: hit.point.y, local, scratch: scratchBegin(d, local) };
    activePointers.add(p); return true;
  }
  if (u.resize) {
    const c = cases[u.resize.key], g = c.group;
    p.drag = { kind: 'resize', key: u.resize.key, h: u.resize, grab: hit.point.clone(), y: hit.point.y, y0: p.y, W0: c.W, D0: c.D, H0: c.H, pos0: g.position.clone() };
    activePointers.add(p); return true;
  }
  if (u.move) {
    const g = MOVABLE[u.move];
    p.drag = { kind: 'move', target: u.move, st: stage.beginMove(u.move), y: hit.point.y, grab: hit.point.clone(), pos0: g.position.clone(), yaw0: g.rotation.y, x0: p.x };
    activePointers.add(p); return true;
  }
  const c = u.control; if (!c) return true;
  if (c.deck && c.id === 'arm') {
    const d = deckOf(c.deck); armGrab(d);
    p.drag = { kind: 'arm', deck: d, control: c, y: hit.point.y, moved: false }; activePointers.add(p); return true;
  }
  if (pressControl(c)) return true;
  if (c.deck && c.id === 'pitch') {
    const d = deckOf(c.deck); lastTouched = d.i; heldPitch.add(d.i);
    p.drag = { kind: 'pitch', deck: d, y: hit.point.y }; activePointers.add(p); return true;
  }
  if (c.mixer) {
    const id = c.id;
    if (id.endsWith('.fader') || id === 'xfader') { p.drag = { kind: 'slider', id, y: hit.point.y }; activePointers.add(p); return true; }
    const now = performance.now(); // knob; double-click resets
    if (p.mouse && lastKnobClick.id === id && now - lastKnobClick.t < 320) setMix(id, MIXDEF[id]);
    lastKnobClick = { id, t: now };
    p.drag = { kind: 'knob', id, lastY: p.y, v0: mixVal[id] };
    if (!p.mouse) { p.drag.dir0 = p.ray.direction.clone(); p.drag.x0 = new THREE.Vector3(1, 0, 0).applyQuaternion(p.space.getWorldQuaternion(new THREE.Quaternion())); }
    activePointers.add(p); p.tip = mixLabel(id); return true;
  }
  return true;
}

const _q = new THREE.Quaternion(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
function pointerMove(p) {
  const dr = p.drag; if (!dr) return;
  p.tip = '';
  if (dr.kind === 'lid') { // mouse: drag down pulls the lid toward you and shut, up lifts it open
    if (!dr.moved && Math.abs(p.y - dr.y0) < 4) return;
    if (!dr.moved) { dr.moved = true; lidGrab(); }
    lidSet(dr.a0 + (p.y - dr.y0) * 0.009); p.tip = 'Crate lid'; return;
  }
  if (dr.kind === 'arm') {
    if (p.mouse && Math.hypot(p.x - p.start.x, p.y - p.start.y) < 4 && !dr.moved) return;
    dr.moved = true;
    const t = p.ray.direction.y ? (dr.y - p.ray.origin.y) / p.ray.direction.y : -1; if (t <= 0) return;
    const w = p.ray.at(t, _a), l = dr.deck.g.worldToLocal(w), pv = dr.deck.g.userData.pivot;
    armDrag(dr.deck, Math.atan2(l.x - pv.x, l.z - pv.z));
    p.tip = dr.deck.arm.dragDown ? 'Dragging the needle across the record' : 'Tonearm';
    return;
  }
  if (dr.kind === 'knob') {
    if (p.mouse) { const dy = p.y - dr.lastY; dr.lastY = p.y; setMix(dr.id, mixVal[dr.id] - dy / (p.shift ? 900 : 220)); }
    else { // twist the controller around its pointing direction, like turning a knob
      const x1 = _a.set(1, 0, 0).applyQuaternion(p.space.getWorldQuaternion(_q));
      const n = dr.dir0;
      const u0 = _b.copy(dr.x0).addScaledVector(n, -dr.x0.dot(n)).normalize();
      const u1 = x1.addScaledVector(n, -x1.dot(n)).normalize();
      const ang = Math.atan2(_c.crossVectors(u0, u1).dot(n), u0.dot(u1));
      dr.x0.copy(u1);   // incremental with hard stops at both ends (no wrap from max to min)
      setMix(dr.id, mixVal[dr.id] + Math.max(-0.6, Math.min(0.6, ang)) / (300 * Math.PI / 180) * 1.3);
    }
    p.tip = mixLabel(dr.id);
  } else if (dr.kind === 'slider') {
    const hp = rayPlaneY(p.ray, dr.y); if (!hp) return;
    setMix(dr.id, sliderFromLocal(dr.id, mixer.worldToLocal(hp))); p.tip = mixLabel(dr.id);
  } else if (dr.kind === 'pitch') {
    const hp = rayPlaneY(p.ray, dr.y); if (!hp) return;
    const d = dr.deck; setPitch(d, pitchFromLocalZ(d, d.g.worldToLocal(hp).z), true);
    p.tip = `${d.name} pitch ${(d.pitch * 100 >= 0 ? '+' : '')}${(d.pitch * 100).toFixed(2)}%  ${effBpm(d) ? effBpm(d).toFixed(2) + ' BPM' : ''}`;
  } else if (dr.kind === 'record') {
    const hp = rayPlaneY(p.ray, dr.y); if (!hp) return;
    if (p.mouse && !dr.scratch.holding && Math.hypot(p.x - p.start.x, p.y - p.start.y) < 4) return;
    scratchMove(dr.scratch, dr.deck.g.worldToLocal(hp));
  } else if (dr.kind === 'move') {
    const g = MOVABLE[dr.target];
    if (p.mouse && p.shift) { g.rotation.y = dr.yaw0 - (p.x - dr.x0) * 0.006; return; }
    const hp = rayPlaneY(p.ray, dr.y); if (!hp) return;
    const delta = hp.sub(dr.grab); const par = g.parent; // rig space delta
    const q = par.getWorldQuaternion(_q).invert(); delta.applyQuaternion(q);
    g.position.set(dr.pos0.x + delta.x, g.position.y, dr.pos0.z + delta.z);
    clampStack(dr.target);   // #142
    p.tip = `Moving ${NAMES[dr.target]} (wheel: rotate, Shift+wheel: height)`;
  } else if (dr.kind === 'resize') {
    if (p.mouse && p.shift) resizeCase(dr, null, (dr.y0 - p.y) / 400); else resizeCase(dr, rayPlaneY(p.ray, dr.y), null);
    const c = cases[dr.key]; p.tip = `Case ${(c.W * 100).toFixed(0)} × ${(c.D * 100).toFixed(0)} cm, ${(c.H * 100).toFixed(0)} cm high  (Shift-drag: height)`;
  }
}

function pointerUp(p) {
  const dr = p.drag; if (!dr) return;
  if (dr.kind === 'lid') { if (dr.moved) lidRelease(); else lidToggle(); }
  if (dr.kind === 'arm') {
    if (!dr.moved) { armCancel(dr.deck); pressControl(dr.control); }   // a plain click: cue / lift and park as before
    else armRelease(dr.deck);
  }
  if (dr.kind === 'record') {
    const s = dr.scratch, d = dr.deck;
    if (!s.holding && performance.now() - p.start.t < 350) { // click on the grooves = needle drop there
      const r = Math.hypot(dr.local.x - DECK.spindle.x, dr.local.z - DECK.spindle.z);
      if (d.loaded && r > REC.IN - 0.002 && r < REC.EDGE) dropNeedleAt(d, radiusToTime(r, d.duration));
    }
    scratchEnd(s);
  }
  if (dr.kind === 'pitch') heldPitch.delete(dr.deck.i);
  if (dr.kind === 'move') { stage.endMove(dr.st); settleStack(dr.target); if (dr.target.startsWith('milk')) releaseMilk(dr.target, null); }
  if (dr.kind === 'resize') stage.save();
  p.drag = null; activePointers.delete(p);
}

// ---- mouse binding ----
const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', e => e.preventDefault());
const mouse = { mouse: true, ray: new THREE.Ray(), x: 0, y: 0, shift: false, drag: null };
function mouseSync(e) { mouse.ray.copy(mouseRay(e)); mouse.x = e.clientX; mouse.y = e.clientY; mouse.shift = e.shiftKey; }

canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  mouseSync(e);
  if (pointerDown(mouse)) { e.stopImmediatePropagation(); canvas.setPointerCapture(e.pointerId); showTip(mouse.tip, e.clientX, e.clientY); }
}, { capture: true });
canvas.addEventListener('pointermove', e => {
  mouseSync(e);
  if (!mouse.drag) { hover(e); return; }
  pointerMove(mouse); showTip(mouse.tip, e.clientX, e.clientY);
});
function mouseUp() { releaseBeat1('mouse'); pointerUp(mouse); showTip(''); }
canvas.addEventListener('pointerup', mouseUp);
canvas.addEventListener('pointercancel', mouseUp);

function hover(e) {
  const hit = castRay(mouse.ray, interactive())[0];
  const obj = hit && controlOf(hitTarget(hit));
  canvas.style.cursor = obj ? (obj.userData.move ? 'move' : 'pointer') : held ? 'copy' : 'default';
  hoverDeck = hit ? deckGroupOf(hit.object) : null;
  const c = obj && obj.userData.control;
  if (c && c.mixer && mixVal[c.id] !== undefined) showTip(mixLabel(c.id), e.clientX, e.clientY);
  else if (c && c.deck && c.id === 'pitch') { const d = deckOf(c.deck); showTip(`${d.name} pitch ${(d.pitch * 100).toFixed(2)}%`, e.clientX, e.clientY); }
  else if (c && c.id && c.id.endsWith('.beat1')) showTip(`BEAT 1 (deck ${c.id[0]}): tap on beat 1; keep tapping on the beat to measure BPM; hold to clear`, e.clientX, e.clientY);
  else if (obj && obj.userData.mixScreen) showTip('Tap the tempo readout to cycle: ORIG BPM (ID3 tag) → BPM (playing now) → KEY (moves with pitch)', e.clientX, e.clientY);
  else if (c && c.id === 'sync') showTip(`LOCK: sync the decks (lead: deck ${DECK_NAMES[lastTouched]})`, e.clientX, e.clientY);
  else if (c && c.id === 'arm') showTip('Tonearm: click to cue to start / lift and park; drag to move it (drag while playing to scrape across the record)', e.clientX, e.clientY);
  else if (obj && obj.userData.lid && obj.userData.lidHandle && lidShut()) showTip('Handle: drag to carry the crate (Shift-drag to turn it)', e.clientX, e.clientY);
  else if (obj && obj.userData.lid) showTip('Crate lid: click to open / close, or drag up and down to swing it (O)', e.clientX, e.clientY);
  else if (obj && obj.userData.move === 'ledwall') showTip('LED wall: drag to move, Shift-drag to rotate, wheel to resize (headset: grab it with both hands and pull apart)', e.clientX, e.clientY);
  else if (obj && obj.userData.move === 'neon') showTip('Neon sign: drag to move, Shift-drag to rotate, wheel to resize (headset: grab both centre bars and pull apart)', e.clientX, e.clientY);
  else if (obj && obj.userData.move) showTip(`Drag to move ${NAMES[obj.userData.move] || (obj.userData.move.startsWith('milk') ? 'the milk crate' : 'it')}, Shift-drag to rotate`, e.clientX, e.clientY);
  else if (obj && obj.userData.resize) showTip('Drag to resize the case; Shift-drag up/down for height', e.clientX, e.clientY);
  else showTip('');
}

canvas.addEventListener('wheel', e => {
  if (mouse.drag && mouse.drag.kind === 'move') { // rotate while moving
    e.preventDefault(); e.stopImmediatePropagation();
    const o = MOVABLE[mouse.drag.target];
    if (e.shiftKey && !cases[mouse.drag.target]) { o.position.y = Math.max(0, o.position.y - Math.sign(e.deltaY) * 0.02); clampStack(mouse.drag.target); }
    else o.rotation.y += Math.sign(e.deltaY) * 0.05;
    return;
  }
  mouseSync(e);
  const hit = castRay(mouse.ray, interactive())[0];
  const obj = hit && controlOf(hitTarget(hit));
  if (!obj) return;
  const u = obj.userData;
  if (u.move === 'ledwall') { e.preventDefault(); e.stopImmediatePropagation(); setLedScale(ledwall.scale.x * (e.deltaY < 0 ? 1.05 : 1 / 1.05)); saveLedScale(); stage.save(); showTip(`LED wall ${(LED.W * ledwall.scale.x * 100).toFixed(0)} cm wide`, e.clientX, e.clientY); return; }
  if (u.move === 'neon') { e.preventDefault(); e.stopImmediatePropagation(); setNeonScale(neon.scale.x * (e.deltaY < 0 ? 1.05 : 1 / 1.05)); saveNeonScale(); showTip(`Neon sign ${(NEON.DIA * neon.scale.x * 100).toFixed(0)} cm across`, e.clientX, e.clientY); return; }
  if (u.crateScreen || u.crateSleeves || u.crateCover) { e.preventDefault(); e.stopImmediatePropagation(); if (crateLidOpen()) crateSelect(Math.sign(e.deltaY)); return; }
  if (u.record && !u.loose) {   // #105 spindle twist on desktop: wheel over the spindle (#106), 5 ms a notch (Shift: 1 ms)
    const d = deckGroupOf(obj), l = d && d.g.worldToLocal(hit.point.clone());
    if (d && Math.hypot(l.x - DECK.spindle.x, l.z - DECK.spindle.z) < 0.006) {   // #106: the spindle only
      e.preventDefault(); e.stopImmediatePropagation();
      spindleTwist(d, (e.shiftKey ? 0.0000625 : 0.0003125) * -Math.sign(e.deltaY));   // #109: half of #108
      showTip(`Spindle twist ${e.deltaY < 0 ? 'forward' : 'back'} ${e.shiftKey ? 0.06 : 0.31} ms`, e.clientX, e.clientY); return;
    }
  }
  const c = u.control;
  if (c && c.mixer && mixVal[c.id] !== undefined) {
    e.preventDefault(); e.stopImmediatePropagation();
    const step = (e.shiftKey ? 0.005 : 0.025) * -Math.sign(e.deltaY);
    setMix(c.id, mixVal[c.id] + (c.id === 'xfader' ? step * 2 : step)); showTip(mixLabel(c.id), e.clientX, e.clientY);
  } else if (c && c.deck && c.id === 'pitch') {
    e.preventDefault(); e.stopImmediatePropagation();
    const d = deckOf(c.deck); lastTouched = d.i;
    setPitch(d, d.pitch + (e.shiftKey ? 0.0005 : 0.0025) * Math.sign(e.deltaY));
    showTip(`${d.name} pitch ${(d.pitch * 100).toFixed(2)}%`, e.clientX, e.clientY);
  }
}, { capture: true, passive: false });

// ------------------------------------------------------------------ keyboard
addEventListener('keydown', e => {
  if ($('#start').style.display !== 'none' || e.target === searchInput) return;
  const k = e.key;
  if (k === '/') { e.preventDefault(); openNativeKeyboard(); return; }
  if (k === '1') setCam('dj'); else if (k === '2') setCam('top'); else if (k === '3') setCam('crate');
  else if (k === 'h' || k === 'H') $('#helpBtn').click();
  else if (k === 'z' || k === 'Z') setMotor(decks[0], !decks[0].motorOn);
  else if (k === 'm' || k === 'M') setMotor(decks[1], !decks[1].motorOn);
  else if (k === 's' || k === 'S') doSync();
  else if (k === 'ArrowDown') { e.preventDefault(); crateSelect(1); }
  else if (k === 'ArrowUp') { e.preventDefault(); crateSelect(-1); }
  else if (k === 'PageDown') crateSelect(10); else if (k === 'PageUp') crateSelect(-10);
  else if (k === '[') cratePlaylist(-1); else if (k === ']') cratePlaylist(1);
  else if (k === 'Enter') pullSelected();
  else if (k === 'Escape') returnHeld();
  else if (k === 'o' || k === 'O') lidToggle();
  else if (k === 'f' || k === 'F') {
    if (held) { held.sideUp = held.sideUp === 'A' ? 'B' : 'A'; const t = held.track(held.sideUp); if (t) predecode(held, held.sideUp); if (!t) toast(`Side ${held.sideUp} is blank`); }
    else if (hoverDeck) flipOnDeck(hoverDeck);
  } else if (k === 'l' || k === 'L') {
    if (held) held.toggleText(); else if (hoverDeck && hoverDeck.record) hoverDeck.record.toggleText();
  }
});

// ------------------------------------------------------------------ mixer screen
let screenTimer = 0;
// Beat LEDs (#109): the beat you HEAR, i.e. the playhead minus the audio output latency (the headset plays
// sound some ms after the worklet renders it), and redrawn the moment the beat changes instead of waiting
// for the 15 fps screen tick, so the LED lands on the kick instead of up to ~70 ms either side of it.
// BEAT 1 = tap button (owner, #117). No audio analysis anywhere: everything here comes from the DJ's taps.
// - One tap sets beat 1 (the heard moment: playhead - output latency x rate) for the mixer LEDs.
// - Keep tapping on the beat: every further tap in the same run updates a tapped BPM (least-squares line through
//   the taps). Taps are timed in seconds INTO THE SONG, so the pitch fader / platter speed doesn't change the
//   result: it is the track's own BPM. A run ends after a pause of 1.75 beats (2.5 s before the 2nd tap), so slow
//   songs are fine (65 BPM = 0.92 s a beat). One missed beat inside a run is allowed; a tap under 60 % of a beat
//   after the last one is ignored (double hit). The run's FIRST tap stays beat 1.
// - Long press (0.8 s) clears beat 1 and the tapped BPM for that track; the button blinks to confirm.
// - The track's ID3 BPM always wins (#117). A tapped BPM is used only when the MP3 has no BPM tag; with neither,
//   the HUD says "no BPM" and the LEDs stay grey.
// Stored per track (key '<artist>|<title>|<side>') as { beat1 s, bpm, taps, updated }: always in this browser
// ('vire.taps'), and auto-saved to the sidecar web/cly3dj_taps.json through server.js POST api/taps. Where there is
// no such endpoint (static host), a static cly3dj_taps.json is still read, and saves stay on this device.
function heardPos(d) {
  const c = engine.ctx, lat = c ? (c.outputLatency || 0) + (c.baseLatency || 0) : 0;
  return engine.pos(d.i) - lat * engine.state.decks[d.i].rate;
}
function tapKey(t) { return `${t.artist}|${t.title}|${t.side || ''}`.toLowerCase(); }
const taps = (() => {
  const map = new Map();
  try { const j = JSON.parse(localStorage.getItem('vire.taps') || '{}'); for (const [k, e] of Object.entries(j)) if (e && typeof e === 'object') map.set(k, e); } catch {}
  try {   // #116's one-key-per-track form, moved over once
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i); if (!k || !k.startsWith('vire.tap.')) continue;
      const v = +localStorage.getItem(k), key = k.slice(9);
      if (Number.isFinite(v) && !map.has(key)) map.set(key, { beat1: v, updated: Date.now() });
      localStorage.removeItem(k);
    }
  } catch {}
  return { map, pending: new Map(), deleted: {}, status: 'local', timer: 0, busy: false };
})();
function tapsLocal() { try { localStorage.setItem('vire.taps', JSON.stringify(Object.fromEntries(taps.map))); } catch {} }
tapsLocal();
function tapEntry(t) {
  const k = tapKey(t);
  if (!taps.map.has(k)) {   // #110 kept beat 1 under the Rekordbox TrackID: move it over the first time we see it
    try { const old = 'vire.beat1.' + t.id, v = localStorage.getItem(old); if (v !== null) { localStorage.removeItem(old); if (Number.isFinite(+v)) { setTap(t, { beat1: +v }); } } } catch {}
  }
  return taps.map.get(k) || null;
}
function setTap(t, e) {   // e = null clears the track
  const k = tapKey(t), now = Date.now();
  if (e) { const cur = taps.map.get(k) || {}; const n = { ...cur, ...e, updated: now }; taps.map.set(k, n); taps.pending.set(k, n); delete taps.deleted[k]; }
  else { taps.map.delete(k); taps.pending.set(k, null); taps.deleted[k] = now; }
  tapsLocal(); saveTapsSoon();
}
function saveTapsSoon(ms = 400) { clearTimeout(taps.timer); taps.timer = setTimeout(pushTaps, ms); }
async function pushTaps() {
  if (!taps.pending.size || taps.busy) return;
  if (taps.status === 'static') return;   // no endpoint on this host: this device only
  taps.busy = true; taps.status = 'saving';
  const body = { tracks: Object.fromEntries(taps.pending), deleted: { ...taps.deleted } }, sent = new Map(taps.pending);
  try {
    const r = await fetch('api/taps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    for (const [k, v] of sent) if (taps.pending.get(k) === v) { taps.pending.delete(k); delete taps.deleted[k]; }
    taps.status = 'saved';
  } catch (e) { taps.status = 'retry'; console.warn('taps sidecar save failed', e); clearTimeout(taps.timer); taps.timer = setTimeout(pushTaps, 30000); }
  taps.busy = false; if (taps.pending.size && taps.status === 'saved') saveTapsSoon();
}
async function loadTapsSidecar() {
  let j = null, api = false;
  try { const r = await fetch('api/taps', { cache: 'no-store' }); if (r.ok && /json/.test(r.headers.get('content-type') || '')) { j = await r.json(); api = true; } } catch {}
  if (!j) try { const r = await fetch('cly3dj_taps.json', { cache: 'no-store' }); if (r.ok) j = await r.json(); } catch {}
  taps.status = api ? 'saved' : 'static';
  if (j && j.tracks) for (const [k, e] of Object.entries(j.tracks)) {
    const cur = taps.map.get(k);
    if (!e || taps.deleted[k] > (e.updated || 0)) continue;
    if (!cur || (e.updated || 0) > (cur.updated || 0)) taps.map.set(k, e);
    else if ((cur.updated || 0) > (e.updated || 0) && api) taps.pending.set(k, cur);   // newer here: send it up
  }
  if (api) for (const [k, cur] of taps.map) if (!(j.tracks && j.tracks[k])) taps.pending.set(k, cur);   // only on this device so far
  tapsLocal(); for (const d of decks) d.ledShown = undefined;
  if (taps.pending.size) saveTapsSoon(50);
}
loadTapsSidecar();
function beat1Of(t) { const e = t && tapEntry(t); return e && Number.isFinite(e.beat1) ? e.beat1 : null; }
function tapBpmOf(t) { const e = t && tapEntry(t); return e && e.bpm > 0 ? e.bpm : 0; }
// the BPM the app plays and LOCKs with: the MP3's ID3 BPM, else a tapped one, else none (#117)
// #119 (owner): ID3 BPM first, else the Rekordbox XML BPM (AverageBpm, a single number: never its beat grid), else a
// tapped BPM. Every XML track has AverageBpm, so tapping for BPM is only needed if one is ever missing.
function fileBpmSrc(t) { return !t ? '' : t.bpmSrc === 'id3' ? 'id3' : t.bpm > 0 ? 'rb' : ''; }
function rbBpmOf(t) { return !t ? 0 : t.bpmSrc === 'id3' ? t.rbBpm || 0 : t.bpm || 0; }
function bpmOf(t) { return !t ? 0 : fileBpmSrc(t) ? t.bpm : tapBpmOf(t); }

const TAP_FIRST_GAP = 2.5, TAP_GAP_BEATS = 1.75, TAP_MIN = 0.6, HOLD_CLEAR = 0.8;
const tapRuns = [null, null], holds = [null, null], blinkUntil = [0, 0];
function fitTaps(run) {   // least squares: time = a + beat x period
  const n = run.t.length; if (n < 2) return 0;
  let sk = 0, st = 0, skk = 0, skt = 0;
  for (let i = 0; i < n; i++) { const k = run.k[i], t = run.t[i]; sk += k; st += t; skk += k * k; skt += k * t; }
  const per = (n * skt - sk * st) / (n * skk - sk * sk);
  return per > 0 ? 60 / per : 0;
}
function tapBeat1(d, src = 'mouse') {
  if (!d.loaded || !d.track) { toast(`Deck ${d.name}: no record playing`); return; }
  const t = d.track, p = heardPos(d), now = performance.now() / 1000, rate = Math.abs(engine.state.decks[d.i].rate) || 1;
  holds[d.i] = { t0: now, seen: now, src, cleared: false };
  let run = tapRuns[d.i];
  if (run && run.track !== t) run = null;
  if (run) {
    const per = run.per || 0, dt = p - run.t[run.t.length - 1];
    if (dt <= 0) run = null;
    else if (per && dt < TAP_MIN * per) { toast(`Deck ${d.name}: tap ignored (too soon)`, 900); return; }
    else if (per) {
      const n = Math.round(dt / per);
      if (n < 1 || n > 2 || Math.abs(dt / per - n) > 0.3) run = null;   // off the beat: start again
      else { run.t.push(p); run.k.push(run.k[run.k.length - 1] + n); }
    } else { run.t.push(p); run.k.push(1); }
  }
  if (!run) {
    tapRuns[d.i] = { track: t, t: [p], k: [0], per: 0, wall: now };
    setTap(t, { beat1: p }); d.ledShown = undefined;
    toast(`Deck ${d.name}: beat 1 set${bpmOf(t) ? '' : ' (no BPM yet: keep tapping on the beat)'}`, 1400);
    return;
  }
  const bpm = fitTaps(run);
  if (!(bpm >= 30 && bpm <= 300)) { run.t.pop(); run.k.pop(); toast(`Deck ${d.name}: tap ignored (too soon)`, 900); return; }
  run.wall = now; run.per = 60 / bpm;
  {
    run.bpm = bpm; run.rate = rate;
    const fs = fileBpmSrc(t);
    toast(`Deck ${d.name}: tap ${run.t.length} · ${bpm.toFixed(2)} BPM${fs ? ` (${fs === 'id3' ? 'ID3' : 'RB'} ${+t.bpm.toFixed(2)} is used)` : ''}`, 1200);
  }
}
function stepTaps() {
  const now = performance.now() / 1000;
  for (const d of decks) {
    const run = tapRuns[d.i];
    if (run) {
      const rate = Math.abs(engine.state.decks[d.i].rate) || 1;
      const gap = run.per ? Math.max(1.0, TAP_GAP_BEATS * run.per / rate) : TAP_FIRST_GAP;
      if (now - run.wall > gap || !d.loaded || d.track !== run.track) {   // run over: keep its BPM
        tapRuns[d.i] = null;
        if (run.bpm && d.track === run.track) { setTap(run.track, { bpm: +run.bpm.toFixed(3), taps: run.t.length }); d.ledShown = undefined; }
      }
    }
    const h = holds[d.i];
    if (h && !h.cleared) {
      if (h.src !== 'mouse' && now - h.seen > 0.15) holds[d.i] = null;   // hand/controller lost contact (tracking gap)
      else if (now - h.t0 >= HOLD_CLEAR) { h.cleared = true; clearTaps(d); }
    }
  }
}
function holdBeat1(d, src) { const h = holds[d.i]; if (h && h.src === src) h.seen = performance.now() / 1000; }
function releaseBeat1(src) { for (let i = 0; i < 2; i++) if (holds[i] && holds[i].src === src) holds[i] = null; }
function clearTaps(d) {
  tapRuns[d.i] = null; blinkUntil[d.i] = performance.now() / 1000 + 1.0;
  if (d.track) setTap(d.track, null);
  d.ledShown = undefined; toast(`Deck ${d.name}: beat 1 and tapped BPM cleared`, 1400);
}
function ledBeat(d) {
  if (!d.loaded || !d.track) return null;
  const t = d.track, a = beat1Of(t), bpm = tapRuns[d.i] && tapRuns[d.i].track === t && tapRuns[d.i].bpm && !fileBpmSrc(t) ? tapRuns[d.i].bpm : bpmOf(t);
  if (a === null || !bpm) return null;
  const b = (heardPos(d) - a) * bpm / 60;
  return ((Math.floor(b + 1e-6) % 4) + 4) % 4;
}
// Mixer readout modes (owner, #116): tap the big number / its label to cycle ORIG BPM -> BPM -> KEY -> ORIG ...
// ORIG = the MP3's ID3 BPM only. BPM = playing tempo now. KEY = the key it sounds in now: vinyl has no key lock,
// so pitch moves the key too (12 x log2 of the speed ratio; ~6 % = 1 semitone). Key from ID3 TKEY, else Rekordbox.
const BPM_MODES = ['orig', 'cur', 'key'];
const bpmMode = (() => { try { const v = JSON.parse(localStorage.getItem('vire.bpmMode')); if (Array.isArray(v) && v.length === 2 && v.every(m => BPM_MODES.includes(m))) return v; } catch {} return ['cur', 'cur']; })();
const SP_HIT = [];   // #164 spectator strip buttons
const MS_HIT = [null, null];   // tap areas on the mixer screen canvas, set while drawing
// ---- #185 mixer Video page: the media library pushed from the phone (Pano, Video pano, Video, Images), 8 thumbnails a
// page; pick one, then where it goes (sky, a deck's VideoVinyl, the LED wall). LED WALL mode lives here too now.
let videoPage = false, vpFolder = 'Pano', vpItems = [], vpPg = 0, vpSel = null;
const VP_HIT = [], vpThumbs = new Map();   // 'folder/name' -> ImageBitmap | 'loading' | null
const VP_TABS = { Pano: 'PANO', 'Video pano': 'VIDEO PANO', Video: 'VIDEO', Images: 'IMAGES', Camera: 'CAMERA' };
async function vpLoad() {
  if (vpFolder === 'Camera') { vpItems = []; drawMixScreen(); return; }
  vpItems = await media.list(vpFolder);
  if (vpSel && !vpItems.some(i => i.name === vpSel)) vpSel = null;
  vpPg = Math.min(vpPg, Math.max(0, Math.ceil(vpItems.length / vpPer()) - 1));
  drawMixScreen();
}
function vpThumb(folder, name) {
  const k = folder + '/' + name; if (vpThumbs.has(k)) return vpThumbs.get(k);
  vpThumbs.set(k, 'loading');
  media.getThumb(folder, name).then(b => b ? createImageBitmap(b) : null).then(bm => { vpThumbs.set(k, bm); drawMixScreen(); }).catch(() => vpThumbs.set(k, null));
  return 'loading';
}
function setVideoPage(on) { videoPage = on; if (on) vpLoad(); drawMixScreen(); }
async function vpAct(what) {
  const name = vpSel; if (!name) { toast('Pick a thumbnail first'); return; }
  if (what === 'sky') return useSkyMedia(vpFolder, name).catch(e => toast('Sky: ' + e.message, 4000));
  if (what === 'skyoff') { settings.sky = 'off'; saveSettings(); syncSettingsUI(); applySky(); drawMixScreen(); return; }
  const f = await media.getFile(vpFolder, name); if (!f) return;
  if (what === 'deckA' || what === 'deckB') {
    const d = decks[what === 'deckA' ? 0 : 1];
    if (!d.record) { toast(`No record on ${d.name}: put one on first`); return; }
    vvOverride[d.i] = { rec: d.record, name }; toast(`${d.name}: ${name} (until this record comes off)`, 2500);
  } else if (what === 'lednow') { led.add(f); led.play(f, led.files.length < 2); ledMode = 'clips'; }
  else if (what === 'ledadd') { const n = led.add(f); toast(`LED playlist: ${n} item${n > 1 ? 's' : ''}`, 2000); }
  drawMixScreen();
}
// #188 CAMERA tab: the spectator phone's virtual set, key and Look match, changed from here; the phone applies each
// change and reports back (spect.cam), so this page always shows the phone's real values.
const CAM_ROWS = [
  [['Strength', 'key', 'thr', 0.01], ['Softness', 'key', 'soft', 0.01], ['Spill', 'key', 'spill', 0.05], ['Light wrap', 'key', 'wrap', 0.05]],
  [['Colour match', 'key', 'cmatch', 0.05], ['Look strength', 'look', 'strength', 0.05], ['Grain', 'look', 'grain', 0.05]],
];
function wrapText(g, s, x, y, w, lh, max) {   // #198 word-wrapped text (portrait pages); the last line is cut with …
  const words = s.split(' '); let line = '', n = 0;
  for (let i = 0; i < words.length; i++) {
    const t = line ? line + ' ' + words[i] : words[i];
    if (line && g.measureText(t).width > w) {
      if (n === max - 1) { fitText2(g, [line, ...words.slice(i)].join(' '), x, y + n * lh, w); return n + 1; }
      g.fillText(line, x, y + n * lh); n++; line = words[i];
    } else line = t;
  }
  if (line) { fitText2(g, line, x, y + n * lh, w); n++; }
  return n;
}
function drawCamTab(btn, y0) {
  const { g, canvas: c } = scr(); const W = c.width, H = c.height, P = portrait();
  const cs = spect && spect.cam, dim = !cs;
  const send = o => { if (spect && spect.camSet) spect.camSet(o); };
  const top = [
    ['SET', cs && cs.set, () => send({ what: 'set', v: !cs.set })],
    ['AUTO KEY', false, () => { send({ what: 'auto' }); toast('Auto key: point the phone at the empty green screen', 3000); }],
    ['MATTE', cs && cs.matte, () => send({ what: 'matte', v: !cs.matte })],
    ['PREVIEW', pvWanted, () => setPreview(!pvWanted)],
    ['LOOK', cs && cs.L && cs.L.on, () => send({ what: 'look', key: 'on', v: !cs.L.on })],
    ['ROOM LIGHT', cs && cs.L && cs.L.room, () => send({ what: 'look', key: 'room', v: !cs.L.room })],
  ];
  const per = P ? 3 : 6, bw = (W - 16 - (per - 1) * 6) / per;   // portrait: 2 rows of 3
  top.forEach(([label, on, act], i) => {
    const off = dim && label !== 'PREVIEW';
    btn(8 + (i % per) * (bw + 6), y0 + Math.floor(i / per) * 42, bw, 36, label, !!on, off ? null : act, off);
  });
  const cols = P ? [CAM_ROWS.flat()] : CAM_ROWS, colW = P ? W - 16 : (W - 24) / 2, ry = y0 + (P ? 92 : 46);
  cols.forEach((col, ci) => col.forEach(([label, what, key, step], ri) => {
    const cx = 8 + ci * (colW + 8), cy = ry + ri * 42;
    g.fillStyle = '#0d1422'; g.fillRect(cx, cy, colW, 36);
    g.fillStyle = dim ? '#56627a' : '#dfe6f2'; g.font = '600 17px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(label, cx + 10, cy + 19);
    const src = cs ? (what === 'key' ? cs.K : cs.L) : null, v = src ? src[key] : null;
    g.textAlign = 'right'; g.fillStyle = dim ? '#56627a' : '#fff'; g.font = '700 18px ui-monospace, monospace';
    g.fillText(v == null ? '--' : what === 'look' ? Math.round(v * 100) + '%' : v.toFixed(2), cx + colW - 110, cy + 19);
    g.textBaseline = 'alphabetic';
    const bump = d => () => { const nv = Math.round((v + d) * 1000) / 1000; src[key] = nv; send({ what, key, v: nv }); drawMixScreen(); };
    btn(cx + colW - 100, cy + 2, 44, 32, '−', false, dim ? null : bump(-step), dim);
    btn(cx + colW - 50, cy + 2, 44, 32, '+', false, dim ? null : bump(step), dim);
  }));
  g.textAlign = 'left'; g.font = '500 15px system-ui'; g.fillStyle = cs ? '#8c96a8' : '#c9a040';
  const stTxt = !cs ? 'Phone not connected: Settings > Spectator camera On, then Connect on the phone and start its camera.'
    : `Phone ${cs.fps} fps · ${cs.ar ? 'camera on' : 'camera not started'} · ${cs.cal ? 'calibrated' : 'not calibrated'}${cs.can ? '' : ' · no camera access'}` + (pvWanted ? (performance.now() - pvLast < 2000 ? ' · preview live' : ' · preview waiting') : '');
  const extra = cs && (cs.auto || cs.look) ? [cs.auto, cs.look].filter(Boolean).join(' · ') : '';
  if (P) {   // portrait: the status lines wrap under the steppers
    let y = ry + CAM_ROWS.flat().length * 42 + 24;
    y += wrapText(g, stTxt, 12, y, W - 24, 20, 5) * 20 + 8;
    if (extra) { g.fillStyle = '#56627a'; g.font = '500 13px system-ui'; wrapText(g, extra, 12, y, W - 24, 18, 4); }
    return;
  }
  fitText2(g, stTxt, 12, H - 30, W - 24);
  if (extra) { g.fillStyle = '#56627a'; g.font = '500 13px system-ui'; fitText2(g, extra, 12, H - 10, W - 24); }
}
function drawVideoPage() {
  const { g, canvas: c } = scr(); const W = c.width, H = c.height, P = portrait(), PER = vpPer();
  VP_HIT.length = 0;
  g.fillStyle = '#05070c'; g.fillRect(0, 0, W, H);
  const btn = (x, y, w, h, label, on, act, dim) => {
    g.fillStyle = on ? '#c8202c' : dim ? '#2a3140' : '#c9ced8'; g.fillRect(x, y, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = on ? '#fff' : dim ? '#56627a' : '#3a4252';
    let fs = 17; g.font = `700 ${fs}px system-ui`;
    while (fs > 11 && g.measureText(label).width > w - 8) g.font = `700 ${--fs}px system-ui`;   // #198 narrow portrait buttons
    g.fillText(label, x + w / 2, y + h / 2 + 1); g.textBaseline = 'alphabetic';
    if (act) VP_HIT.push({ x, y, w, h, act });
  };
  const pick = f => () => { vpFolder = f; vpSel = null; vpPg = 0; vpLoad(); };
  if (P) {   // #198 portrait: tabs in 2 rows of 3 (the last one is MIXER); top and bottom keep clear of the corner L
    const tabs = [...media.FOLDERS, 'Camera'], tw = (W - 30 - 12) / 3;
    tabs.forEach((f, i) => btn(22 + (i % 3) * (tw + 6), 28 + Math.floor(i / 3) * 40, tw, 34, VP_TABS[f], f === vpFolder, pick(f)));
    btn(22 + 2 * (tw + 6), 68, tw, 34, 'MIXER', false, () => setVideoPage(false));
  } else {
    let x = 8;
    for (const f of [...media.FOLDERS, 'Camera']) { const w = f === 'Video pano' ? 140 : f === 'Camera' ? 104 : 96; btn(x, 8, w, 32, VP_TABS[f], f === vpFolder, pick(f)); x += w + 6; }
    btn(W - 8 - 100, 8, 100, 32, 'MIXER', false, () => setVideoPage(false));
  }
  const y0 = P ? 112 : 48;
  if (vpFolder === 'Camera') { drawCamTab(btn, y0); return; }
  // thumbnails: 4 x 2 (portrait 2 x 6)
  const COLS = P ? 2 : 4, CW = (W - 16 - (COLS - 1) * 8) / COLS, TH = P ? 64 : 76, CH = TH + 20;
  const pages = Math.max(1, Math.ceil(vpItems.length / PER)); vpPg = Math.min(vpPg, pages - 1);
  if (!vpItems.length) {
    g.fillStyle = '#8c96a8'; g.font = '500 18px system-ui'; g.textAlign = 'left';
    if (P) { const n = wrapText(g, `Nothing in ${vpFolder} on this headset yet.`, 16, y0 + 40, W - 32, 26, 3); wrapText(g, 'On the phone: Library, Import, then Push to Quest.', 16, y0 + 52 + n * 26, W - 32, 26, 3); }
    else { g.fillText(`Nothing in ${vpFolder} on this headset yet.`, 16, y0 + 40); g.fillText('On the phone: Library, Import, then Push to Quest.', 16, y0 + 66); }
  }
  const cur = settings.env === 'image' && settings.sky === 'on' ? settings.skyMedia : '';
  vpItems.slice(vpPg * PER, vpPg * PER + PER).forEach((it, i) => {
    const cx = 8 + (i % COLS) * (CW + 8), cy = y0 + Math.floor(i / COLS) * (CH + 6);
    const t = vpThumb(vpFolder, it.name);
    g.fillStyle = '#121824'; g.fillRect(cx, cy, CW, TH);
    if (t && t !== 'loading') {   // cover the cell
      const s = Math.max(CW / t.width, TH / t.height), sw = CW / s, sh = TH / s;
      g.drawImage(t, (t.width - sw) / 2, (t.height - sh) / 2, sw, sh, cx, cy, CW, TH);
    }
    const on = [vvOverride[0], vvOverride[1]].map(o => o && vpFolder === 'Video' && o.name === it.name);
    const tag = cur === vpFolder + '/' + it.name ? 'SKY' : on[0] ? 'A' : on[1] ? 'B' : led.name === it.name ? 'LED' : '';
    if (tag) { g.fillStyle = '#40d080'; g.fillRect(cx + 4, cy + 4, 14 + tag.length * 11, 20); g.fillStyle = '#05070c'; g.font = '700 14px system-ui'; g.textAlign = 'left'; g.fillText(tag, cx + 9, cy + 19); }
    if (it.name === vpSel) { g.strokeStyle = '#39a8ff'; g.lineWidth = 4; g.strokeRect(cx + 2, cy + 2, CW - 4, TH + 16); }
    g.fillStyle = it.name === vpSel ? '#fff' : '#b8c0cf'; g.font = '500 14px system-ui'; g.textAlign = 'left';
    fitText2(g, it.name.replace(/\.[^.]+$/, ''), cx + 2, cy + TH + 15, CW - 4);
    VP_HIT.push({ x: cx, y: cy, w: CW, h: CH, act: () => { vpSel = it.name === vpSel ? null : it.name; drawMixScreen(); } });
  });
  // bottom bar: pages, targets for this folder, LED mode (portrait: targets get a row of their own)
  const by = P ? H - 62 : H - 44, bh = 36, bx = P ? 26 : 8;
  btn(bx, by, 44, bh, '‹', false, () => { vpPg = Math.max(0, vpPg - 1); drawMixScreen(); }, vpPg === 0);
  btn(bx + 48, by, 44, bh, '›', false, () => { vpPg = Math.min(pages - 1, vpPg + 1); drawMixScreen(); }, vpPg >= pages - 1);
  const T = { Pano: [['SKY', 'sky'], ['SKY OFF', 'skyoff']], 'Video pano': [['SKY', 'sky'], ['SKY OFF', 'skyoff']],
    Video: [['DECK A', 'deckA'], ['DECK B', 'deckB'], ['LED NOW', 'lednow'], ['+ LED', 'ledadd']], Images: [['LED NOW', 'lednow'], ['+ LED', 'ledadd']] }[vpFolder];
  const tw = P ? (W - 16 - (T.length - 1) * 6) / T.length : 98, ty = P ? H - 106 : by;
  let x = P ? 8 : 108;
  for (const [label, what] of T) { const dim = !vpSel && what !== 'skyoff'; btn(x, ty, tw, bh, label, false, dim ? null : () => vpAct(what), dim); x += tw + 6; }
  btn(W - (P ? 26 : 8) - 140, by, 140, bh, { off: 'LED OFF', clips: 'LED CLIPS', decks: 'LED DECKS' }[ledMode], ledMode !== 'off', () => setLedMode({ off: 'clips', clips: 'decks', decks: 'off' }[ledMode]));
}
const NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
function parseKey(k) {
  k = (k || '').trim(); if (!k) return null;
  let m = k.match(/^(\d{1,2})\s*([AB])$/i);   // Camelot: 8B = C major, 8A = A minor
  if (m) { const n = +m[1]; if (n < 1 || n > 12) return null; const maj = (7 * (n - 8) + 120) % 12; return m[2].toUpperCase() === 'B' ? { i: maj, minor: false } : { i: (maj + 9) % 12, minor: true }; }
  m = k.match(/^([A-Ga-g])\s*([#b♯♭]?)\s*(m|min|minor|maj|major)?$/);
  if (!m) return null;
  let i = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
  if (m[2] === '#' || m[2] === '♯') i++; else if (m[2] === 'b' || m[2] === '♭') i--;
  return { i: (i + 12) % 12, minor: !!m[3] && m[3][0].toLowerCase() === 'm' && m[3].toLowerCase() !== 'maj' && m[3].toLowerCase() !== 'major' };
}
const keyName = (i, minor) => NOTES[((i % 12) + 12) % 12] + (minor ? 'm' : '');
function readout(d, st) {
  const t = d.loaded ? d.track : null, mode = bpmMode[d.i];
  if (mode === 'orig') {
    // #119: ID3 if the file has one ("ORIG · ID3", Rekordbox shown alongside), else the XML value as "RB:BPM"
    const fs = fileBpmSrc(t), tb = t && tapBpmOf(t), rb = rbBpmOf(t);
    const extra = (fs === 'id3' && rb ? ` · RB:${+rb.toFixed(2)}` : '') + (tb ? ` · tap ${tb.toFixed(2)}` : '');
    return { big: fs ? String(+t.bpm.toFixed(2)) : '--.-', label: (fs === 'rb' ? 'RB:BPM' : 'ORIG BPM') + (t ? (fs === 'id3' ? ' · ID3' : fs ? '' : ' · none') + extra : '') };
  }
  if (mode === 'key') {
    const src = t && (t.id3Key || t.key), k = parseKey(src);
    if (!k) return { big: '--', label: 'KEY' + (t ? ' · none' : '') };
    const ratio = d.speed * (1 + d.pitch), semis = 12 * Math.log2(ratio), n = Math.round(semis);
    const orig = keyName(k.i, k.minor);
    return { big: keyName(k.i + n, k.minor), label: Math.abs(semis) >= 0.05 ? `KEY · ${orig} ${semis >= 0 ? '+' : ''}${semis.toFixed(1)} st` : 'KEY' };
  }
  const run = t && tapRuns[d.i] && tapRuns[d.i].track === t ? tapRuns[d.i] : null;
  const live = run && run.bpm && !fileBpmSrc(t) ? run.bpm : trackBpm(d);
  const eff = t ? live * Math.abs(st.rate || d.speed * (1 + d.pitch)) : 0;
  const src = !t ? '' : run ? ` · tapping (${run.t.length})` : fileBpmSrc(t) === 'id3' ? '' : fileBpmSrc(t) === 'rb' ? ' · RB' : live ? ' · tapped' : ' · none, tap BEAT 1';
  return { big: eff ? eff.toFixed(1) : '--.-', label: 'BPM' + src };
}
function mixScreenPress(uv) {
  if (!uv) return;
  // #198 portrait: the canvas is turned 90 deg on the screen, so map the screen's uv back onto it
  const c = scr().canvas;
  const px = (scrDir === 'px' ? 1 - uv.y : scrDir === 'nx' ? uv.y : uv.x) * c.width;
  const py = (scrDir === 'px' ? 1 - uv.x : scrDir === 'nx' ? uv.x : 1 - uv.y) * c.height;
  if (videoPage) { for (const b of VP_HIT) if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) { b.act(); drawMixScreen(); return true; } return true; }   // #185
  // #164 spectator strip: MR GUI (helpers on/off) and CELL REC (phone goes clean for recording)
  for (const b of SP_HIT) if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) { b.act(); drawMixScreen(); return true; }
  for (let i = 0; i < 2; i++) {
    const b = MS_HIT[i]; if (!b || px < b.x || px > b.x + b.w || py < b.y || py > b.y + b.h) continue;
    bpmMode[i] = BPM_MODES[(BPM_MODES.indexOf(bpmMode[i]) + 1) % BPM_MODES.length];
    try { localStorage.setItem('vire.bpmMode', JSON.stringify(bpmMode)); } catch {}
    drawMixScreen(); return true;
  }
  return false;
}
// one deck's panel; the landscape page puts them side by side, the portrait one (#198) stacks them
function drawDeckPanel(g, d, x0, y0, w, h, P) {
  const dy = y0 - 6, DOTS = 186 + dy, TXT = 202 + dy;   // #166: beat dots + needle state right under the BPM
  g.fillStyle = '#0d1422'; g.fillRect(x0, y0, w, h);
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.fillStyle = d.i === lastTouched ? '#39a8ff' : '#56627a'; g.font = '700 22px system-ui';
  g.fillText(d.name + (d.i === lastTouched ? ' • LEAD' : ''), x0 + 12, 34 + dy);
  const t = d.track;
  g.fillStyle = '#dfe6f2'; g.font = '600 22px system-ui';
  fitText2(g, d.loading ? 'Loading…' : t ? t.title : (d.record ? `Side ${d.side} blank` : 'No record'), x0 + 12, 66 + dy, w - 24);
  g.fillStyle = '#8c96a8'; g.font = '400 17px system-ui';
  fitText2(g, t ? `${deckVid[d.i].v ? 'VV  ·  ' : ''}${t.artist}${d.side ? '  ·  side ' + d.side : ''}${t.split ? '  ·  split' : ''}` : '', x0 + 12, 90 + dy, w - 24);
  const st = engine.state.decks[d.i];
  const rd = readout(d, st);
  g.fillStyle = '#fff'; g.font = '700 46px system-ui'; g.fillText(rd.big, x0 + 12, 150 + dy);
  g.fillStyle = '#8c96a8'; g.font = '500 17px system-ui'; fitText2(g, rd.label, x0 + 14, 172 + dy, w * 0.62);
  MS_HIT[d.i] = { x: x0 + 6, y: 100 + dy, w: w * 0.62, h: 84 };
  g.textAlign = 'right'; g.fillStyle = Math.abs(d.pitch) < 0.0005 ? '#40ff70' : '#f2b640'; g.font = '600 24px system-ui';
  g.fillText(`${d.pitch >= 0 ? '+' : ''}${(d.pitch * 100).toFixed(2)}%`, x0 + w - 12, 128 + dy);
  g.fillStyle = '#8c96a8'; g.font = '500 17px system-ui'; g.fillText(d.speed > 1.1 ? '45 RPM' : '33 RPM', x0 + w - 12, 152 + dy);
  if (d.loaded) {
    const pos = engine.pos(d.i), rem = Math.max(0, d.duration - pos);
    g.fillStyle = '#dfe6f2'; g.font = '600 22px ui-monospace, monospace';
    g.fillText('-' + fmt(rem), x0 + w - 12, 182 + dy);
    // #165 (owner): no progress bar; the grooves on the record show where you are
    // beat phase dots
    const beatInBar = ledBeat(d);   // #117: grey until beat 1 and a BPM exist
    for (let k = 0; k < 4; k++) { g.fillStyle = k === beatInBar ? '#39a8ff' : '#26324a'; g.fillRect(x0 + 12 + k * 30, DOTS, 24, 10); }
    if (t && tapEntry(t)) {   // sidecar save state for this track (portrait: its own line, the panel is narrower)
      const tx = { saved: 'taps saved', saving: 'saving…', retry: 'not saved: retrying', static: 'saved on this device', local: 'saved on this device' }[taps.status] || '';
      g.textAlign = P ? 'left' : 'right'; g.fillStyle = taps.status === 'saved' ? '#56627a' : '#c9a040'; g.font = '500 13px system-ui';
      g.fillText(tx, P ? x0 + 12 : x0 + w - 12, P ? TXT + 22 : TXT);
    }
    g.textAlign = 'left'; g.fillStyle = st.needle ? '#40ff70' : '#56627a'; g.font = '600 15px system-ui';
    g.fillText(st.needle ? 'NEEDLE DOWN' : 'NEEDLE UP', x0 + 140, TXT);
  }
}
function drawTopBtn(g, x, y, w, h, label, on) {
  g.fillStyle = on ? '#c8202c' : '#c9ced8'; g.fillRect(x, y, w, h);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = on ? '#fff' : '#5a6272'; g.font = '700 22px system-ui';
  g.fillText(label, x + w / 2, y + h / 2 + 1); g.textBaseline = 'alphabetic';
}
function drawPhoneIcon(g, px, py, pw, ph, on) {   // small phone icon; its LED is green while the spectator phone is connected (#169)
  g.strokeStyle = '#8c96a8'; g.lineWidth = 2; g.beginPath(); g.roundRect(px, py, pw, ph, 3); g.stroke();
  g.fillStyle = '#8c96a8'; g.fillRect(px + 4, py + ph - 4, pw - 8, 2);
  g.fillStyle = on ? '#40ff70' : '#56627a'; g.beginPath(); g.arc(px + pw / 2, py + 7, 3, 0, Math.PI * 2); g.fill();
}
function drawMixScreen() {
  if (videoPage) { drawVideoPage(); scr().commit(); return; }   // #185
  const { g, canvas: c } = scr(); const W = c.width, H = c.height, P = portrait();
  const sp = settings.spect === 'on' && spect ? spect.ui() : null;   // #164/#167: MR GUI toggle
  g.fillStyle = '#05070c'; g.fillRect(0, 0, W, H);
  SP_HIT.length = 0;
  const on = ledMode !== 'off';   // VIDEO is red while the LED wall plays
  if (P) {   // #198 portrait: MR GUI and VIDEO get a strip of their own on top, the decks are stacked under it
    // (keep clear of the silver corner L: #202 it is top-left when held +x edge up, bottom-right the other way)
    const TOP = 76, ph = (H - TOP - 12) / 2, w = 120, h = 40, y = 28;
    for (const d of decks) drawDeckPanel(g, d, 6, TOP + d.i * (ph + 6), W - 12, ph, true);
    drawTopBtn(g, W - 14 - w, y, w, h, 'VIDEO', on);
    SP_HIT.push({ x: W - 20 - w, y: y - 8, w: w + 12, h: h + 16, act: () => setVideoPage(true) });
    if (sp) {
      drawTopBtn(g, 24, y, w, h, 'MR GUI', sp.mr); drawPhoneIcon(g, 24 + w + 8, y + (h - 24) / 2, 14, 24, sp.phone);
      SP_HIT.push({ x: 18, y: y - 8, w: w + 12, h: h + 16, act: () => spect.setMR(!sp.mr) });
    }
    scr().commit(); return;
  }
  for (const d of decks) drawDeckPanel(g, d, d.i ? W / 2 + 6 : 6, 6, W / 2 - 12, H - 12, false);
  { // #185 VIDEO: deck B's top row (was the #176 LED WALL switch, which is on the Video page now)
    const w = 108, h = 28, y = 12, x = W - 36 - w;   // #202 moved in, clear of the corner L (now top-right)
    drawTopBtn(g, x, y, w, h, 'VIDEO', on);
    SP_HIT.push({ x: x - 6, y: 4, w: w + 12, h: h + 16, act: () => setVideoPage(true) });
  }
  if (sp) {   // #174: MR GUI toggle + phone icon on deck A's top row, right-aligned to its panel (the divider stays clear)
    const right = W / 2 - 14, pw = 14, ph = 24, w = 108, h = 28, y = 12;
    const px = right - pw, x = px - 10 - w;
    drawTopBtn(g, x, y, w, h, 'MR GUI', sp.mr); drawPhoneIcon(g, px, y + (h - ph) / 2, pw, ph, sp.phone);
    SP_HIT.push({ x: x - 6, y: 4, w: w + 12, h: h + 16, act: () => spect.setMR(!sp.mr) });
  }
  mixScreen.commit();
}
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ------------------------------------------------------------------ frame loop
const clock = new THREE.Clock();
const camFwd = new THREE.Vector3(), camDown = new THREE.Vector3(), camRight = new THREE.Vector3();
const qFace = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.35, 0, 0));
const qHoldXR = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2)); // disc +Y -> hand +X
const _holdOff = new THREE.Vector3();

function wrapPi(a) { a %= 2 * Math.PI; return a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a; }
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  if (camTween) {
    camTween.t = Math.min(1, camTween.t + dt * 1.6); const k = camTween.t * camTween.t * (3 - 2 * camTween.t);
    camera.position.lerpVectors(camTween.from.pos, camTween.to.pos, k);
    controls.target.lerpVectors(camTween.from.tgt, camTween.to.tgt, k);
    if (camTween.t >= 1) camTween = null;
  }
  if (!renderer.xr.isPresenting) controls.update();

  stepSync(dt);

  // scratch: a still hand holds the record
  scratchIdle();
  stepLid(dt);
  neon.userData.update(dt);   // random flicker bursts (#86)
  if (crateDisc.visible) { // record rides up out of its sleeve
    crateDisc.position.lerp(crateDisc.userData.target, Math.min(1, dt * 10));
    crateDisc.rotation.x = crateDisc.userData.tilt;
  }
  if (xr && renderer.xr.isPresenting) xr.update(dt);

  for (const d of decks) {
    const u = d.g.userData, st = engine.state.decks[d.i];
    const rate = st.rate;                                   // the record's speed (what you hear)
    const prate = st.prate != null ? st.prate : rate;       // #120: the platter's own speed
    // Angles (CLAUDE.md #59): advance smoothly by the current speed every frame and steer gently toward the
    // worklet's value. It reports ~60 times a second with a few ms of jitter; using it raw made the platter
    // judder by up to half a dot spacing per frame. #120: platter and record are separate bodies, so each
    // has its own angle; the record follows the audio playhead, the platter the worklet's platter angle.
    const ago = Math.min(0.1, (performance.now() - engine.stateAt) / 1000);
    d.platterAngle += prate * W33 * dt;
    if (st.pang != null) {
      const err = wrapPi(st.pang + prate * W33 * ago - d.platterAngle);
      if (Math.abs(err) > 0.35) d.platterAngle += err; else d.platterAngle += err * Math.min(1, dt * 4);
    }
    const sc = [...scratches].find(x => x.deck === d && x.holding && !x.nudge);
    const visRate = sc ? handRate(sc) : rate;
    d.recAngle += visRate * W33 * dt;
    const recTarget = d.loaded ? engine.pos(d.i) * W33 + d.angleOffset : st.rang != null ? st.rang + rate * W33 * ago : d.platterAngle;
    {
      const err = wrapPi(recTarget - d.recAngle);
      if (Math.abs(err) > 0.35) d.recAngle += err;
      else d.recAngle += err * Math.min(1, dt * (sc || performance.now() - (d.twistT || 0) < 250 ? 12 : 2.5));   // twist: follow fast
    }
    u.platter.rotation.y = -d.platterAngle;
    if (d.record) { d.record.group.rotation.y = -d.recAngle; d.record.updateFlip(dt); }
    const pw = d.power !== false ? 1 : 0;
    if (u.strobe) {
      const S = u.strobe, w = prate * W33;                       // rad/s (#120: the platter's dots)
      d.frameDt = (d.frameDt || 1 / 72) * 0.9 + Math.min(1 / 30, Math.max(1 / 120, dt)) * 0.1;
      S.uni.uBlur.value = Math.min(0.75, Math.abs(w) * d.frameDt * S.kU);
      // strobe lamp: 100 flashes/s; per flash the dots advance a fraction `a` of their pitch (wrapped), so a
      // row stands still when the speed matches its calibration and drifts slowly either side of it
      const nom = W33 * d.speed, off = [0, 0, 0, 0];
      S.rows.forEach((r, k) => {
        const sR = w / (nom * (1 + r.p)); const a = sR - Math.round(sR);
        r.phi += a * S.F * (S.P / S.kU) * dt;                    // apparent angle, rad (texture dot pitch)
        const o = S.kU * (r.phi - d.platterAngle); off[k] = o - Math.floor(o / S.P) * S.P;
      });
      S.uni.uStrobe.value.set(off[0], off[1], off[2], off[3]);
      S.lampPt.getWorldPosition(S.uni.uLampPos.value);
      S.uni.uLampCol.value.setRGB(9 * pw, 0.35 * pw, 0.12 * pw);
      S.lens.emissiveIntensity = 2.2 * pw;
    }
    if (u.powerKnob) u.powerKnob.rotation.y += ((pw ? 0 : 1.1) - u.powerKnob.rotation.y) * Math.min(1, dt * 12);
    if (u.target) u.target.step(dt, pw); else if (u.targetLight) u.targetLight.userData.set(0.6 * pw);
    for (const row of u.strobeRows) {
      const step = prate * W33 / 100, sp = 2 * Math.PI / row.N;
      let dd = step % sp; if (dd > sp / 2) dd -= sp; if (dd < -sp / 2) dd += sp;
      row.angle += dd * 100 * dt; row.mesh.rotation.y = -row.angle;
    }
    u.strobeLamp.userData.set(0.8); u.strobeLight.intensity = 0.25;
    u.start.userData.set(pw * (d.motorOn ? 1 : 0.08));
    u.b33.userData.set(pw * (d.speed < 1.1 ? 0.9 : 0.05)); u.b45.userData.set(pw * (d.speed > 1.1 ? 0.9 : 0.05));
    if (u.b33.userData.led) { u.b33.userData.led(pw * (d.speed < 1.1 ? 1 : 0)); u.b45.userData.led(pw * (d.speed > 1.1 ? 1 : 0)); }
    u.zeroLED.userData.set(pw * (Math.abs(d.pitch) < 0.0005 ? 1 : 0.05));
    updateArm(d, dt);
  }

  // meters
  if (engine.ctx) for (let c = 0; c < 2; c++) {
    const lv = engine.level(c); const db = 20 * Math.log10(lv + 1e-6);
    mixer.userData.meters[c].forEach((l, i) => l.userData.set((db > -30 + i * 3.3 ? 1 : 0.03) * 0.97 * 0.95 * 0.9));   // glow 3%, 5%, then 10% lower (owner, 26 Sep)
  }
  const mc = mixer.userData.controls;
  mc['A.cue'].userData.set(cueOn[0] ? 1 : 0.06); mc['B.cue'].userData.set(cueOn[1] ? 1 : 0.06);
  stepTaps();
  for (const d of decks) {
    const bl = blinkUntil[d.i] - performance.now() / 1000;   // #117: cleared = 4 quick blinks
    mc[d.name + '.beat1'].userData.set(bl > 0 ? (Math.floor(bl * 8) % 2 ? 1 : 0.02) : d.loaded && d.track && beat1Of(d.track) !== null && d.ledShown === 0 ? 1 : 0.06);   // #110: flashes on beat 1 once tapped
  }
  mc.splitcue.userData.set(splitCue ? 1 : 0.06);
  mc.mic.userData.set(micOn ? 0.75 + Math.min(0.6, micLevel() * 2) : 0.06);
  syncFlash.t = Math.max(0, syncFlash.t - dt);
  mc.sync.userData.setColor(syncFlash.color === 'red' && syncFlash.t > 0 ? 0xff3030 : 0x39a8ff);
  mc.sync.userData.set(0.15 + syncFlash.t);

  // held record floats in front of the camera
  stepLoose(dt);
  stepMilkCrates(dt);
  stepWallGlow(); stepBlobs();
  // label relief (#94): on within arm's length of your eyes (0.65 m), off again past 0.8 m
  camera.getWorldPosition(_eyeB);
  for (const r of [decks[0].record, decks[1].record, held, ...loose.map(l => l.rec)]) {
    if (!r || r.disposed) continue;
    const dd = r.group.getWorldPosition(_recB).distanceTo(_eyeB);
    r.setBump(r.bumpOn ? dd < 0.8 : dd < 0.65);
  }
  if (held !== lastHeldRef) { lastHeldRef = held; if (held) { held.prevOk = false; held.vel = null; held.angVel = null; } }
  if (held && held.attach) {
    // in a hand: hold it by the edge, disc face pointing out of the side of the hand
    held.attach.updateMatrixWorld();
    const prevP = held.group.position.clone(), prevQ = held.group.quaternion.clone();
    held.group.position.copy(held.attach.localToWorld(_holdOff.set(0, 0, -0.135)));
    held.group.quaternion.copy(held.attach.getWorldQuaternion(_wq)).multiply(qHoldXR);
    // track the hand's momentum so a release can throw the record
    if (dt > 0 && held.prevOk) {
      const v = held.group.position.clone().sub(prevP).multiplyScalar(1 / dt);
      held.vel = held.vel ? held.vel.lerp(v, 0.5) : v;
      const dq = held.group.quaternion.clone().multiply(prevQ.invert());
      const ang = 2 * Math.acos(Math.min(1, Math.abs(dq.w))), s = Math.sqrt(Math.max(1e-9, 1 - dq.w * dq.w));
      const av = new THREE.Vector3(dq.x / s, dq.y / s, dq.z / s).multiplyScalar((dq.w < 0 ? -ang : ang) / dt);
      held.angVel = held.angVel ? held.angVel.lerp(av, 0.5) : av;
    }
    held.prevOk = true;
  } else if (held && !renderer.xr.isPresenting) {
    camera.getWorldDirection(camFwd);
    camRight.crossVectors(camFwd, camera.up).normalize();
    camDown.crossVectors(camRight, camFwd).normalize().negate();
    held.group.position.copy(camera.position).addScaledVector(camFwd, 0.55).addScaledVector(camDown, 0.12).addScaledVector(camRight, 0.1);
    held.group.quaternion.copy(camera.quaternion).multiply(qFace);
    held.updateFlip(dt);
  }

  screenTimer += dt;
  let beatChanged = false;
  for (const d of decks) { const k = ledBeat(d); if (k !== d.ledShown) { d.ledShown = k; beatChanged = true; } }
  if (beatChanged || screenTimer > 1 / 15) { screenTimer = 0; drawMixScreen(); }
  if (deckInst) deckInst.update();   // #154
  for (const d of decks) vvStep(d);   // #177 VideoVinyl
  stepPvLid(dt);   // #196 preview lid
  stepScrDir();    // #198 portrait menu
  if (ledMode === 'decks') ledwall.userData.setDecks(deckVid[0].tex, deckVid[1].tex, ...deckGains(mixVal));
  if (spect) spect.tick(dt);          // #158 spectator camera (nothing when off / no phone)
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ XR input (hands + controllers)
const xr = CAMERA_ROLE ? null : setupXR({   // #161: the phone has no hands or controllers to drive
  renderer, scene, crateRig, crate, mixer, decks, MOVABLE, saveLayout, mixVal, heldPitch, sleeveMap, crateState,
  stage, cases, resizeCase, deckGroups, clampStack, settleStack,
  REC, DECK, CRATE, ARM,
  castRay, interactive, pointerDown, pointerMove, pointerUp, tabletGrab, tabletHold, tabletRelease, tabletScale, saveTablet,
  setMix, pressControl, setPitch, setPower, pitchFromLocalZ, sliderFromLocal, setLastTouched: i => { lastTouched = i; },
  scratchBegin, scratchMove, scratchEnd, spindleTwist,
  deckState: d => ({ st: engine.state.decks[d.i], driving: !!d.motorOn && d.power !== false, model: settings.deckModel }),   // #120 haptics
  armGrab, armDrag, armRelease,
  getHeld: () => held, pullSelected, pickUpFromDeck, releaseHeld, loose, pickUpLoose,
  crateScreenPress, mixScreenPress, holdBeat1, releaseBeat1, crateSelect, drawCrateScreen, layoutSleeves, crateDisc,
  neon, NEON, setNeonScale, saveNeonScale, releaseMilk, MILK, flyingMilk, ledwall, setLedScale, saveLedScale,
  lidShut, crateLidOpen, crateMicSelect, lidGrabTest, lidGrab, lidRelease, lidDragTo: (P, off) => lidSet(lidAngleOf(P) + off), lidOffset: P => lidSt.a - lidAngleOf(P),
  nudgePitch: (d, delta) => { lastTouched = d.i; setPitch(d, d.pitch + delta); },
});

// ------------------------------------------------------------------ start screen / XR
async function begin(mode) {
  // #114: one mode only: 90 Hz, foveation 0.5, 'interactive' audio (smallest buffers = least mic delay)
  await engine.init({ latencyHint: 'interactive' }); await engine.resume();
  sendPhysics();
  Object.keys(mixVal).forEach(applyMix);
  $('#start').style.display = 'none';
  if (mode === 'desktop') return;
  try {
    setRecordTexSize(2048); // only a few full-detail records exist at once; grooves need the resolution
    applyShadows(false);   // real-time shadows per the Shadows setting (#96)
    renderer.setPixelRatio(1);
    const session = await navigator.xr.requestSession(mode, { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setFoveation(0.5);
    await renderer.xr.setSession(session);
    if (session.updateTargetFrameRate && session.supportedFrameRates) {
      const want = 90; const rates = [...session.supportedFrameRates];
      if (rates.includes(want)) session.updateTargetFrameRate(want).catch(() => {});
    }
    rig.position.set(-0.05, 0, -0.62);
    xr.setHandMode(mode === 'immersive-ar' && settings.hands === 'real' ? 'real' : '3d');
    // passthrough rooms are much dimmer than the studio environment: tone reflections down so metal isn't self-lit
    arMode = mode === 'immersive-ar';
    if (mode === 'immersive-ar') { scene.background = null; room.visible = false; skybox.group.visible = skyShadow.visible = false; scene.environmentIntensity = settings.arRefl / 100; }
    else applySky();   // #182: stereo panoramas split per eye while presenting   // #180: was a fixed 0.28, now Settings > Reflections in passthrough (default 60 %)
    session.addEventListener('end', () => { arMode = false; applyShadows(false); xr.end(); rig.position.set(0, 0, 0); applySky(); scene.environmentIntensity = envLight.intensity; });
    toast('Reach out and touch: pinch or grip right at a knob, fader, tonearm or record', 5000);
  } catch (e) { toast('Could not start XR: ' + e.message, 4000); }
}

// ---- environment light
function envImageStored() { try { return localStorage.getItem('vire.envimage'); } catch { return null; } }
async function applyEnv() {
  envLight.stopCamera(); envLight.mix = settings.envMix / 100;
  if (settings.env === 'image') {
    const url = envImageStored();
    if (!url) { envLight.setImage(null); skybox.setImage(null); applySky(); return; }
    const im = new Image(); im.src = url; await im.decode().catch(() => {}); envLight.setImage(im);
    skyKeyLight = im.width ? brightestDir(im) : null;
    if (settings.sky === 'on') await ensureSky();
  } else { envLight.setImage(null); skyKeyLight = null; }
  applySky();
}
// #182: layout of a picture (per Settings > Pano type): { layout: 'mono' | 'ou' | 'sbs', swap } or null = not a panorama
function skyLayoutFor(w, h) {
  const t = settings.skyType;
  if (t === 'auto') { const l = detectLayout(w, h); return l ? { layout: l, swap: false } : null; }
  return { layout: t.replace('-swap', ''), swap: t.endsWith('-swap') };
}
// Use a picked (or stored) image file: the lighting copy (left eye, <= 2048 wide) and, for panoramas, the full-size sky.
async function useSkyFile(f, fresh) {
  const bmp = await createImageBitmap(f), L = skyLayoutFor(bmp.width, bmp.height);
  let c;
  if (L) c = leftEyeCanvas(bmp, L.layout, L.swap, 2048);
  else {   // #143 / #175: landscape photos keep up to 2048 px wide, others 1024
    c = document.createElement('canvas');
    c.width = Math.min(bmp.width / bmp.height >= 1.3 ? 2048 : 1024, bmp.width); c.height = Math.round(c.width * bmp.height / bmp.width);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);   // #178: keep this line out of the comment above
  }
  const dims = [bmp.width, bmp.height]; bmp.close();
  try { localStorage.setItem('vire.envimage', c.toDataURL('image/jpeg', 0.85)); } catch { if (fresh) toast('Image too large to remember; it will be used this session only'); }
  envLight.setImage(c); skyKeyLight = brightestDir(c);
  if (L) { try { closeSkyVideo(); await skybox.load(f, L.layout, L.swap); skybox.setHeight(settings.skyH); } catch (e) { skybox.setImage(null); toast('Panorama too big for this device: ' + e.message, 4000); } }
  else skybox.setImage(null);
  skyInfo(dims, L); applySky();
}
async function ensureSky() {   // full-size panorama from storage, loaded when first shown
  if (skybox.tex || settings.env !== 'image') return;
  if (settings.skyMedia) {   // #185 chosen from the media library (mixer Video page)
    const i = settings.skyMedia.indexOf('/'), folder = settings.skyMedia.slice(0, i), f = await media.getFile(folder, settings.skyMedia.slice(i + 1));
    if (f) { if (folder === 'Video pano') await useSkyVideo(f); else await useSkyFile(f, false); return; }
  }
  const f = await loadPano(); if (f) await useSkyFile(f, false);
}
// #185 sky from the library: a still (Pano) or a looping video panorama (Video pano)
let skyVid = null;
function closeSkyVideo() { if (skyVid) { closePanoVideo(skyVid); skyVid = null; } }
async function useSkyMedia(folder, name) {
  const f = await media.getFile(folder, name); if (!f) { toast('Not on this headset: ' + name); return; }
  settings.skyMedia = folder + '/' + name; settings.skyFile = name + ':' + f.size;
  const p = skyPrefs()[settings.skyFile] || { h: 1.5, turn: 0, type: 'auto', key: 'on' };
  Object.assign(settings, { skyH: p.h, skyTurn: p.turn, skyType: p.type, skyKey: p.key, env: 'image', sky: 'on' });
  saveSettings(); syncSettingsUI();
  if (folder === 'Video pano') await useSkyVideo(f); else { closeSkyVideo(); await useSkyFile(f, true); }
  toast('Sky: ' + name, 2000);
}
async function useSkyVideo(f) {
  closeSkyVideo();
  const { video, snap } = await openPanoVideo(f); skyVid = video;
  const L = skyLayoutFor(video.videoWidth, video.videoHeight) || { layout: 'mono', swap: false };
  const c = leftEyeCanvas(snap, L.layout, L.swap, 2048);
  try { localStorage.setItem('vire.envimage', c.toDataURL('image/jpeg', 0.85)); } catch {}
  envLight.setImage(c); skyKeyLight = brightestDir(c);
  skybox.setVideo(video, L.layout, L.swap); skybox.setHeight(settings.skyH);
  skyInfo([video.videoWidth, video.videoHeight], L); applySky();
}
function skyInfo(dims, L) {
  const el = $('#skyInfo'); if (!el) return;
  if (!dims) { el.textContent = ''; return; }
  if (!L) { el.textContent = `${dims[0]} x ${dims[1]}: not a 360 panorama, shown as a wrap-around picture (no grounded floor).`; return; }
  const eyeW = L.layout === 'sbs' ? dims[0] / 2 : dims[0], ppd = eyeW / 360;
  el.textContent = `${dims[0]} x ${dims[1]}, ${L.layout === 'mono' ? 'mono' : 'stereo ' + (L.layout === 'ou' ? 'over-under' : 'side-by-side')}` +
    (skybox.size && skybox.size[0] < dims[0] ? ` (shown at ${skybox.size[0]} x ${skybox.size[1]})` : '') + `, ${ppd.toFixed(1)} px per degree` +
    (ppd < 15 ? ': soft in the headset; 8192 x 4096 mono is sharp.' : '.') + ' Orbit the view and set the height until the floor stops sliding under the gear.';
}
// #175 / #182: skybox. With an image chosen and 'Show as surroundings' on, the studio room is hidden in Desktop and
// Full VR. A 360 panorama becomes the grounded skybox; other pictures stay a plain background. Passthrough always
// shows the real room.
const DEG = Math.PI / 180;
function applySky() {
  const want = !arMode && settings.env === 'image' && settings.sky === 'on';
  const full = want && !!skybox.tex, bg = want && !full && envLight.skyTex;
  scene.background = arMode ? null : bg ? envLight.skyTex : full ? null : BG;
  skybox.group.visible = full; skyShadow.visible = full;
  if (skyVid) { if (full) skyVid.play().catch(() => {}); else skyVid.pause(); }   // #185 video pano only decodes while shown
  skybox.setStereo(renderer.xr.isPresenting);
  room.visible = !arMode && !full && !bg;
  const turn = settings.env === 'image' ? settings.skyTurn * DEG : 0;
  skybox.setTurn(turn); scene.environmentRotation.set(0, turn, 0); scene.backgroundRotation.set(0, turn, 0);
  // key light from the picture's brightest area (windows, lamps), at least 35 deg up so shadows stay short
  if (full && settings.skyKey === 'on' && skyKeyLight) {
    const d = skyKeyLight.dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
    const hz = Math.hypot(d.x, d.z) || 1, up = Math.max(d.y, Math.sin(35 * DEG)), k = Math.sqrt(1 - up * up) / hz;
    key.position.set(d.x * k, up, d.z * k).multiplyScalar(2.7).add(key.target.position);
    key.color.setRGB(1, 1, 1).lerp(skyKeyLight.color, 0.5);
  } else { key.position.copy(KEY_POS); key.color.setRGB(1, 1, 1); }
}
// per-image pano settings (height, turn, type, key light), keyed by file name + size
function skyPrefs() { try { return JSON.parse(localStorage.getItem('vire.skyPrefs') || '{}'); } catch { return {}; } }
function saveSkyPrefs() {
  if (!settings.skyFile) return; const m = skyPrefs();
  m[settings.skyFile] = { h: settings.skyH, turn: settings.skyTurn, type: settings.skyType, key: settings.skyKey };
  try { localStorage.setItem('vire.skyPrefs', JSON.stringify(m)); } catch {}
}
$('#fEnv').onchange = async e => {
  const f = e.target.files && e.target.files[0]; if (!f) return; e.target.value = '';
  settings.skyFile = f.name + ':' + f.size; settings.skyMedia = ''; closeSkyVideo();
  const p = skyPrefs()[settings.skyFile] || { h: 1.5, turn: 0, type: 'auto', key: 'on' };
  Object.assign(settings, { skyH: p.h, skyTurn: p.turn, skyType: p.type, skyKey: p.key });
  settings.env = 'image'; saveSettings(); syncSettingsUI();
  skybox.setImage(null); await savePano(f);   // full size kept in the site's storage (OPFS)
  await useSkyFile(f, true);
};
$('#sSkyH').oninput = e => { settings.skyH = +e.target.value; saveSettings(); saveSkyPrefs(); $('#skyHVal').textContent = settings.skyH.toFixed(2) + ' m'; skybox.setHeight(settings.skyH); };
$('#sSkyTurn').oninput = e => { settings.skyTurn = +e.target.value; saveSettings(); saveSkyPrefs(); $('#skyTurnVal').textContent = settings.skyTurn + '°'; applySky(); };
$('#sSkyType').onchange = async e => { settings.skyType = e.target.value; saveSettings(); saveSkyPrefs(); skybox.setImage(null); closeSkyVideo(); await ensureSky(); applySky(); };
$('#sSkyKey').onchange = e => { settings.skyKey = e.target.value; saveSettings(); saveSkyPrefs(); applySky(); };
$('#bEnvImg').onclick = () => $('#fEnv').click();
// #176 LED wall videos: picked each session (the browser can't keep a folder), up to 5, played muted
$('#bLedPick').onclick = () => $('#fLed').click();
$('#fLed').onchange = e => {
  const all = [...(e.target.files || [])], n = led.setFiles(all);
  $('#ledList').textContent = n ? `${n} video${n > 1 ? 's' : ''}: ${led.files.map(f => f.name).join(' · ')}` + (all.length > 5 ? '  (only the first 5 are used)' : '') : 'No playable videos in that pick (mp4 / webm).';
  drawMixScreen();
};
$('#sArRefl').oninput = e => { settings.arRefl = +e.target.value; saveSettings(); $('#arReflVal').textContent = settings.arRefl + '%'; if (arMode) scene.environmentIntensity = settings.arRefl / 100; };
$('#sEnvMix').oninput = e => { settings.envMix = +e.target.value; saveSettings(); envLight.setMix(settings.envMix / 100); $('#envMixVal').textContent = settings.envMix + '%'; };

// ---- settings UI
function syncSettingsUI() {
  $('#sSource').value = settings.source; $('#sXml').value = settings.xml; $('#sHands').value = settings.hands;
  $('#sGlow').value = settings.glow; $('#sShadows').value = settings.shadows; $('#sMicRoute').value = settings.micRoute; showMicRoute();
  $('#sEnv').value = settings.env; $('#sEnvMix').value = settings.envMix; $('#envMixVal').textContent = settings.envMix + '%';
  $('#sSpect').value = settings.spect; $('#rowSpect').hidden = settings.spect !== 'on'; $('#spectCode').textContent = spectCode();
  $('#sDeckModel').value = settings.deckModel; $('#sRecWeight').value = settings.recWeight; $('#sSlipmat').value = settings.slipmat; $('#cPll').checked = !!settings.pll;
  $('#bEnvImg').hidden = settings.env !== 'image'; $('#rowEnvMix').hidden = settings.env === 'studio';
  $('#sArRefl').value = settings.arRefl; $('#arReflVal').textContent = settings.arRefl + '%';
  $('#sSky').value = settings.sky; $('#rowSky').hidden = settings.env === 'studio';
  const skyAdj = settings.env !== 'image' || settings.sky !== 'on';
  for (const id of ['#rowSkyH', '#rowSkyTurn', '#rowSkyType', '#rowSkyKey', '#skyInfo']) $(id).hidden = skyAdj;
  $('#sSkyH').value = settings.skyH; $('#skyHVal').textContent = (+settings.skyH).toFixed(2) + ' m';
  $('#sSkyTurn').value = settings.skyTurn; $('#skyTurnVal').textContent = settings.skyTurn + '°';
  $('#sSkyType').value = settings.skyType; $('#sSkyKey').value = settings.skyKey;
  $('#rowXml').hidden = settings.source !== 'pc';
  $('#rowImport').hidden = settings.source !== 'headset';
  if (settings.source === 'headset') showStorage();
}
// Browsers may wipe site storage unless it is marked persistent (CLAUDE.md #40). Installed apps get it
// most reliably, so the page is also an installable app (manifest + service worker).
async function showPersist() {
  let p = false; try { p = await navigator.storage.persisted(); } catch {}
  $('#persistStatus').textContent = p
    ? `Storage is persistent on ${location.host}: songs stay until you press Clear.`
    : `Storage on ${location.host} is NOT persistent yet: the browser may clear it when it closes. Press "Keep songs on this headset", and if it is refused, install Cly3DJ from the browser menu (Install app / Add to home) and open it from there. Always use the same address; a different address has separate storage.`;
  $('#bPersist').hidden = p;
}
$('#bPersist').onclick = async () => {
  let ok = false; try { ok = await navigator.storage.persist(); } catch {}
  toast(ok ? 'Songs will be kept' : 'The browser refused: install Cly3DJ as an app and open it from there', 5000); showPersist();
};
window.__vireStage = 'service worker';
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(reg => {
  // hand the worker everything this page already loaded (app code, three.js, models) for offline use (#66)
  const own = u => u.startsWith(location.origin) && !/\/vire-music\/|\.(mp3|m4a|wav|flac|aiff?|ogg|mp4|m4v|webm|mov)(\?|$)/i.test(u);
  const urls = [location.href.split('#')[0], ...performance.getEntriesByType('resource').map(r => r.name).filter(own)];
  if (reg.active) reg.active.postMessage({ cache: [...new Set(urls)] });
}).catch(() => {});

async function showStorage() {
  showPersist();
  const idx = await store.loadIndex(); const est = await store.usage();
  const mb = n => (n / 1048576).toFixed(0) + ' MB';
  $('#impStatus').textContent = `${idx.filter(f => !/\.xml$/i.test(f.path) && !VIDEO_EXT.test(f.path)).length} songs, ${idx.filter(f => VIDEO_EXT.test(f.path)).length} VideoVinyl videos, ${idx.filter(f => /\.xml$/i.test(f.path)).length} XML stored` +
    (est ? ` · using ${mb(est.usage || 0)} of ${mb(est.quota || 0)} available to this site` : '');
}
for (const [id, k] of [['#sSource', 'source'], ['#sXml', 'xml'], ['#sHands', 'hands'], ['#sEnv', 'env'], ['#sGlow', 'glow'], ['#sShadows', 'shadows'], ['#sMicRoute', 'micRoute'],
  ['#sDeckModel', 'deckModel'], ['#sRecWeight', 'recWeight'], ['#sSlipmat', 'slipmat'], ['#sSpect', 'spect'], ['#sSky', 'sky']]) {
  $(id).onchange = e => {
    settings[k] = e.target.value; saveSettings(); syncSettingsUI();
    if (k === 'deckModel' || k === 'recWeight' || k === 'slipmat') sendPhysics();
    if (k === 'glow') setGlowMode(glowMat, settings.glow);
    if (k === 'micRoute') { if (micOn) { micOn = false; engine.setMicOn(false); } if (engine.mic) engine.micClose(); showMicRoute(); }
    if (k === 'shadows') applyShadows(false);
    if (k === 'spect') applySpect();
    if (k === 'sky') ensureSky().then(applySky);
    if (k === 'source' || k === 'xml') loadLibrary();
    if (k === 'env') { if (settings.env === 'image' && !envImageStored()) $('#fEnv').click(); applyEnv(); }
  };
}
$('#cPll').onchange = e => { settings.pll = e.target.checked; saveSettings(); sendPhysics(); };
// #120: turntable physics settings go to the deck worklet (both decks)
function sendPhysics() {
  engine.post({ type: 'physics', model: settings.deckModel, recMass: (+settings.recWeight || 180) / 1000, mat: settings.slipmat, pll: !!settings.pll });
}
// #113: the device / feedback-guard rows only matter when the app opens the mic itself
function showMicRoute() { $('#rowMicApp').hidden = settings.micRoute !== 'app'; }
$('#sMicRoute').value = settings.micRoute; showMicRoute();
// microphone choice (CLAUDE.md #60). Device names only appear once the browser has mic permission.
async function listMics() {
  const sel = $('#sMic'); if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) { $('#micStatus').textContent = 'No microphone access on this page (needs HTTPS).'; return; }
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
  sel.innerHTML = '<option value="">Default (headset\'s own mic)</option>' + devs.map((d, i) => `<option value="${d.deviceId}">${(d.label || 'Microphone ' + (i + 1)).replace(/</g, '&lt;')}</option>`).join('');
  sel.value = devs.some(d => d.deviceId === settings.micDevice) ? settings.micDevice : '';
}
$('#sMic').onchange = e => { settings.micDevice = e.target.value; saveSettings(); if (engine.mic) { engine.micClose(); if (micOn) { micOn = false; toggleMic(); } } };
$('#cMicEcho').checked = settings.micEcho !== false;
$('#cMicEcho').onchange = e => { settings.micEcho = e.target.checked; saveSettings(); if (engine.mic) { engine.micClose(); if (micOn) { micOn = false; toggleMic(); } } };
$('#bMicAllow').onclick = async () => {
  try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach(t => t.stop()); $('#micStatus').textContent = 'Microphone allowed. Pick one above; plug-in (USB-C) mics appear here too.'; }
  catch (e) { $('#micStatus').textContent = 'Microphone not allowed: ' + (e.message || e.name); }
  listMics();
};
listMics().catch(() => {});
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => listMics().catch(() => {}));
async function runImport(files) {
  if (!files || !files.length) return;
  $('#impStatus').textContent = 'Copying…';
  try {
    const n = await store.importFiles(files, p => { $('#impStatus').textContent = `Copying ${p.done}/${p.count} (${(p.bytes / 1048576).toFixed(0)} of ${(p.total / 1048576).toFixed(0)} MB): ${p.name}`; });
    toast(`Imported ${n} files`); await showStorage(); await loadLibrary();
  } catch (e) { $('#impStatus').textContent = 'Import failed: ' + e.message; }
}
$('#bImpFolder').onclick = () => $('#fFolder').click();
$('#bImpFiles').onclick = () => $('#fFiles').click();
$('#fFolder').onchange = e => runImport(e.target.files);
$('#fFiles').onchange = e => runImport(e.target.files);
$('#bImpClear').onclick = async () => { if (!confirm('Remove all songs imported into this browser?')) return; await store.clearLibrary(); await showStorage(); loadLibrary(); };
$('#credit').textContent = [deckModel === 'glb' ? 'Turntable: ' + GLB_CREDIT : '', milk.userData.glb ? 'Record crate: ' + MILK_CREDIT : ''].filter(Boolean).join(' · ');
syncSettingsUI();
$('#bDesktop').onclick = () => begin('desktop');
$('#bVR').onclick = () => begin('immersive-vr');
$('#bAR').onclick = () => begin('immersive-ar');
if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then(ok => { $('#bVR').hidden = !ok; }).catch(() => {});
  navigator.xr.isSessionSupported('immersive-ar').then(ok => { $('#bAR').hidden = !ok; }).catch(() => {});
  navigator.xr.isSessionSupported('immersive-vr').catch(e => { window.__vireStage = 'xr check failed: ' + e.message; });
}

// ---- spectator camera (#158): loaded only when switched on; default off (`spect` is declared near the top)
function spectCode() {
  let c = null; try { c = localStorage.getItem('vire.spectCode'); } catch {}
  if (!c || !/^\d{5}$/.test(c)) { c = String(10000 + Math.floor(Math.random() * 90000)); try { localStorage.setItem('vire.spectCode', c); } catch {} }
  return c;
}
async function applySpect() {
  if (settings.spect !== 'on') { if (spect) { spect.close(); spect = null; } return; }
  if (spect) return;
  try {
    const m = await import('./spectator-host.js');
    if (settings.spect === 'on' && !spect) spect = m.startHost({ code: spectCode(), stage, rig, scene, renderer, camera, toast, getInputs: () => xr && xr.inputs,
      getRecords: () => [decks[0].record, decks[1].record, held, ...loose.map(l => l.rec)].filter(Boolean), artBlobs, getLed: () => led.state(),
      getVV: () => ({ mode: ledMode, gains: deckGains(mixVal), decks: deckVid.map((dv, i) => dv.v ? [i, dv.key, engine.ctx ? engine.pos(i) : 0, engine.state.decks[i].rate || 0] : null).filter(Boolean) }),
      getSky: () => ({ h: settings.skyH, turn: settings.skyTurn, type: settings.skyType, key: settings.skyKey, file: settings.skyFile, media: settings.env === 'image' ? settings.skyMedia : '' }),
      onMedia: () => { if (videoPage) vpLoad(); },
      onCam: m => { if (m && pvWanted && !m.pv && spect) spect.camSet({ what: 'preview', v: true }); if (videoPage && vpFolder === 'Camera') drawMixScreen(); },   // a reconnected phone gets PREVIEW back
      onPreview: onPreviewFrame });
  } catch (e) { toast('Spectator camera failed to start: ' + e.message, 4000); }
}
syncSettingsUI();
if (!CAMERA_ROLE) applySpect();
applyEnv();
if (!CAMERA_ROLE) loadLibrary();
drawMixScreen();
// debugging handle
window.vire = { THREE, TABLET, get scrDir() { return scrDir; }, drawMixScreen, tabletHold, tabletRelease, tabletDock, tabletScale, tabletGrab, setPreview, pvLid, get pvLidT() { return pvLidT; }, media, setVideoPage, vpAct, get vp() { return { videoPage, vpFolder, vpItems, vpSel, vvOverride }; }, useSkyMedia, led, ledwall, setLedScale, deckVid, setLedMode, get ledMode() { return ledMode; }, layoutSleeves, copiesOut, crateDisc, mixScreenPress, bpmMode, tapBeat1, beat1Of, bpmOf, taps, tapRuns, stepTaps, releaseBeat1, clearTaps, loadTapsSidecar, spawnMilk, removeMilk, extraMilk, flyingMilk, placeMilk, milks, releaseMilk, stepMilkCrates, lidGrab, lidRelease, lidSet, lidShut, setMix, neon, setNeonScale, search, setQuery, exitSearch, crateScreenPress, drawCrateScreen, lidToggle, lidSt, crateLidOpen, stepLid, milk, milkDrop, armGrab, armDrag, armRelease, pressControl, get micOn() { return micOn; }, stepLoose, testThrow() { const h = held; throwRecord(h); held = null; return h; }, surfaceUnder, supportUnder, stage, cases, crateRig, clampStack, settleStack, stackTops, envLight, deckInst, renderer, loose, releaseHeld, crate, mixer, mixVal, xr, engine, decks, get lib() { return lib; }, crateState, pullSelected, placeOnDeck, doSync, setPitch, setMotor, dropNeedleAt, get held() { return held; }, camera, controls, setCam, skybox, applySky, key, scene, settings };
window.__vireStage = 'ready'; window.__vireReady = true;   // #138
// #161 spectator phone: same scene, no audio / library / input; the client module takes over the loop
if (CAMERA_ROLE) {
  $('#start').style.display = 'none'; const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
  import('./spectator-client.js').then(m => m.startCamera({ THREE, renderer, scene, camera, rig, room, stage, cases, decks, deckInst, neon,
    newMilk, stepWallGlow, stepBlobs, Record3D, BG, led, skybox, envLight, key })).catch(e => { document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:0;left:0;right:0;color:#fbb;background:#300;padding:8px;z-index:99">Spectator failed: ${e.message}</pre>`); });
}
