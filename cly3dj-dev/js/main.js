import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';
import { parseLibrary, addUnsorted, emptyLibrary } from './library.js';
import { readID3 } from './id3.js';
import { AudioEngine, PITCH_RANGE } from './audio.js';
import { REC, REC7, dimsOf, timeToRadius, radiusToTime, Screen, fitText, drawRecordSide, recordMaterial, setRecordSide, grooveAnisoMap } from './textures.js';
import { setupXR } from './xr.js';
import { makeNeonSign, bakeNeonImpostor, neonGlowTexture, GLOW_E, NEON, upgradeNeon } from './neon.js';
import { makeLedWall, LedPlayer, LED } from './ledwall.js';
import { WallFx, LOOP, RP_DEF, MP_DEF, FX_W, FX_H, PX_DEF, pxSize, OUT_W, OUT_H } from './wallfx.js';   // #439 MANDEL / RETRO-SCENE on the LED wall (and the phones)
import { Avatar, DjCam, CAM_PRESETS, xrPose, demoPose, AV_LAYER } from './director.js';
import { Streamer, SOURCES as STREAM_SRC, streamKey, STUDIO_MODES } from './stream.js';
import { onRelayFallback } from './net-link.js';   // #467 note on the tablet when a handshake falls back to ntfy.sh   // #380 STUDIO_MODES
import { KEY_LABEL } from './keycol.js';   // #347 key colour names   // #331 LIVE STREAM (Twitch)
import { GoPro, ZOOMS as GOPRO_ZOOMS } from './gopro.js';
import { RealDepth } from './realdepth.js';
import { solveCamFit, CAL_TARGETS } from './camfit.js';   // #415 HEADSET CAM auto fit   // #413 depth-camera-correct occlusion
import { Laser, PATTERNS as LASER_PATS, PAT_LABEL as LASER_PL, COLOURS as LASER_COLS, COL_LABEL as LASER_CL } from './laser.js';   // #406 laser head prop   // #337 movable camera for SHOW / AVACAM
import { TwitchChat, ChatPanel, drawChat, chatChannel } from './chat.js';   // #340 Twitch chat
import { WhiteBoard, makeBoardTools } from './whiteboard.js';   // #395 the whiteboard, markers and duster
import { InkLabel } from './inklabel.js';   // #394 milk crate labels
import { makeSleeves } from './sleeves.js';   // #347 PHONE CAM forearm sleeves
import { Portals } from './portal.js';   // #345 mirror portal: a real-world window, cut into FacetWall (or any glb room later); #346 up to 6, any rectangle
import { FacetWall, WALL_DEF } from './facetwall.js';   // #345 faceted backdrop (fractal or VIDEOWALL content) in front of the DJ booth
import { Beat } from './beat.js';   // #346 bass onsets on the master for the wall's BEAT
import { DirroHost, initRelayFromUrl, fanUrl, relayUrl, roomKey, WALL_SRC, WALL_LABEL, WALL_COLS } from './dirro-host.js';   // #427 DIRROGRAM: the show to the audience phones
import qrcode from '../vendor/qrcode/qrcode.mjs';   // #427 the room's QR (MIT, Kazuhiko Arase)
import { RobotAvatar } from './robot.js';
import { RobotAvatar2, ROBOT_GLB } from './robot2.js';
import { applyNeon } from './neonenv.js';   // #355 NEON CHROME   // #245 the licensed AvatarRobot (EntroPi Games)
import { Scroller, drawBitText, bitWidth, cleanText, FONT_OK, EMOJI as BIT_EMOJI, KEY_ROWS, listPressings, savePressing, deletePressing, readLabel, readPic, labelFrom, blankWav } from './tools.js';
import { discogsToken, setDiscogsToken, initDiscogsToken, splitQuery, searchArt, releaseImages, guessSlots, imageBlob, artThumb } from './artfetch.js';   // #393 FETCH ART
import { DeckVideo, VIDEO_EXT, vvKey, baseName, deckGains } from './videovinyl.js';
import { glowMaterial, setGlowMode, makeBlob, placeBlob } from './fakelight.js';
import { loadDeckTemplate, makeGlbDeck, GLB_CREDIT } from './deck-glb.js';
import { instanceDecks, HIDE_LAYER } from './deck-inst.js';
import { FX, USER_LAYER } from './fx.js';   // #379 VISUALS > FX: FLOAT and WATER
import * as store from './storage.js';
import * as loopDb from './loopbank.js';   // #470 loop slots and banks in private storage
import { EnvLight } from './env.js';
import { Skybox, detectLayout, leftEyeCanvas, brightestDir, savePano, loadPano, openPanoVideo, closePanoVideo } from './skybox.js';
import * as media from './medialib.js';
import { makePerfCap } from './perfcap.js';
import { Stage, FlightCase } from './layout.js';
import { loadCaseKit } from './flightcase.js';
import { setRecordTexSize, setGrooveK } from './textures.js';
import {
  initMaterials, MAT, tabletBodyMat, TABLET_T, makeDeck, makeButton, makeMixer, makeCrate, makeMilkCrate, loadMilkCrate, loadMilkCrateBaked, upgradeMilkCrate, loadRecordCrateBaked, upgradeRecordCrate, loadMixerParts, initKTX2, loadBaked, MILK_CREDIT, Record3D, armYawForRadius,
  DECK, MIX, CRATE, MILK, W33, ARM, LID, padCull,
} from './models.js';

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
const CAMERA_ROLE = params.get('role') === 'camera';   // #161: this page is the spectator phone (spectator.html sends it here)
// start-screen settings, remembered per browser
const SETTINGS_DEFAULT = { needleLift: 7, source: 'pc', xml: 'rekordbox.xml', hands: '3d', glow: 'add', shadows: 'blob', env: 'studio', envMix: 50, micDevice: '', micEcho: false, micRoute: 'app',
  deckModel: 'classic', recWeight: '180', slipmat: 'slick', pll: false, spect: 'off', sky: 'off', arRefl: 60, occlusion: false, roomHits: true,   // #411 (#415 occlusion off by default: owner prefers seeing the beams in DOME scenes)
  skyH: 1.5, skyTurn: 0, skyType: 'auto', skyKey: 'on', skyFile: '', skyMedia: '' };   // turntable physics (#120)
const settings = (() => { try { return { ...SETTINGS_DEFAULT, ...JSON.parse(localStorage.getItem('vire.settings') || '{}') }; } catch { return { ...SETTINGS_DEFAULT }; } })();
if (params.get('xml')) { settings.source = 'pc'; settings.xml = params.get('xml'); }
if (settings.env === 'camera') settings.env = 'studio'; // camera snapshots removed (CLAUDE.md #39)
// #114: Recording-friendly mode removed (always 90 Hz, 'interactive' audio); the owner records with the Quest
// recorder's mic off, so the voice goes through the mixer; wired headphones, so no echo cancelling by default
if (!settings.mig114) { delete settings.perf; settings.micRoute = 'app'; settings.micEcho = false; settings.mig114 = 1; saveSettings(); }
let dirro = null, dirroRoomT = 0, smsPg = 0;
const dirroMark = { want: '', t0: 0, prev: {} };   // #438 MARK LEFT / RIGHT: the next trigger press records the controller tip   // #435 smsPg: HOLOSMS page   // #427 DirroHost, set up at the end of start-up
let spect = null, spectErrShown = false;   // #158 spectator host (declared early: drawMixScreen reads it, #164)
function saveSettings() { try { localStorage.setItem('vire.settings', JSON.stringify(settings)); } catch {} }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let fx = null;   // #379 FLOAT / WATER (made next to the XR setup, once everything it looks at exists)
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
// #346 DOME (PORTALS SETUP): the same grounded sky, shown even in passthrough and with any light setting, sized 3-20 m
const dome = (() => { let s = null; try { s = JSON.parse(localStorage.getItem('vire.dome') || 'null'); } catch {} return { on: !!(s && s.on), r: Math.min(20, Math.max(3, (s && s.r) || 10)), turn: Math.min(359, Math.max(0, (s && s.turn) || 0)), ev: Math.min(1, Math.max(-3, +(s && s.ev) || 0)) }; })();   // #404 ev: DOME EXPOSURE   // #389 turn: the dome's own angle
const skyShadow = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.ShadowMaterial({ opacity: 0.4 }));
skyShadow.rotation.x = -Math.PI / 2; skyShadow.position.y = 0.001; skyShadow.receiveShadow = true; skyShadow.visible = false; skyShadow.raycast = () => {};
rig.add(skyShadow);
let skyKeyLight = null;   // brightest direction + colour of the chosen image (for the key light)
let skyAvg = null;   // #347 its average colour (display values 0..1): PHONE CAM LIGHT MATCH re-tints the DJ toward it
function panoAvg(src) {
  try { const c = document.createElement('canvas'); c.width = 32; c.height = 16; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0, 32, 16);
    const px = g.getImageData(0, 0, 32, 16).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < px.length; i += 4) { r += px[i]; gg += px[i + 1]; b += px[i + 2]; }
    const n = px.length / 4 * 255; return [r / n, gg / n, b / n]; } catch { return null; }
}

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
// #253 (owner, like the SL-1210MK7): an X2 button past the far (-) end of the pitch fader switches the range between
// +-8 % and +-16 %; its blue LED is on at +-16 %
deckGroups.forEach((g, gi) => {
  const u = g.userData, t = u.pitchTravel; if (u.x2) return;   // the GLB deck builds its own (a 33-style cap)
  const b = makeButton(0.016, 0.01, 0x3aa0ff, 'X2'); b.position.set(t.x, u.zeroLED.position.y - 0.001, t.z0 - 0.032); g.add(b);
  b.userData.mesh.userData.control = { deck: gi ? 'B' : 'A', id: 'x2' }; u.x2 = b;
});
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
// #394 (owner) every milk crate has a weather-beaten paper label on both long sides (one label, shown twice), to write on
// with a whiteboard marker; the playlist crate gets the playlist's name scrawled on it. Kept per crate ('vire.milkLabel.<key>').
function attachMilkLabel(m, key) {
  let h = 7; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  const lb = new InkLabel(0.21, 0.08, { key: CAMERA_ROLE ? null : key, seed: h + 3 });
  for (const sd of [1, -1]) { const p = lb.addPlane(m, new THREE.Vector3(sd * (MILK.W / 2 + 0.004), MILK.H - 0.058, 0), sd * Math.PI / 2); p.userData.move = key; }
  m.userData.label = lb; return lb;
}
attachMilkLabel(milk, 'milk');
function milkLabels() { const out = []; for (const m of milks()) if (m.userData.label) out.push(m.userData.label); return out; }
// More milk crates (owner, #88): spawned from the crate icon on the lid screen, up to 6 in all. Keys milk2..milk6
// are ordinary stage items (saved with the layout); which ones exist is kept in 'vire.milkKeys'. Tossing an
// extra crate away (thrown or dragged more than 3 m from the decks) deletes it with its records.
const MILK_MAX = 6, MILK_FAR = 3.0;   // desktop drag-away distance from the decks (thrown: see releaseMilk, #200)
const extraMilk = {};
function newMilk(key) { const m = makeMilkCrate(); m.userData.key = key; rig.add(m); m.traverse(o => { if (o.isMesh) o.userData.move = key; }); attachMilkLabel(m, key); extraMilk[key] = m; return m; }   // #394 label
try { for (const k of JSON.parse(localStorage.getItem('vire.milkKeys') || '[]')) if (/^milk[2-6]$/.test(k)) newMilk(k); } catch (e) {}
milk.userData.key = 'milk';
function milks() { return [milk, ...Object.values(extraMilk)].filter(m => m.parent); }   // #248 a switched-off first crate is out of the scene
// #235 stage pieces the DJ can switch off to save work (TOOLS: LED wall and neon sign in VJ TOOLS, the first milk
// crate in DJ TOOLS). Off = hidden, not hit by rays or hands, no shadow blob, nothing lands on it, and its per-frame
// work stops (LED videos / camera / scroller, neon flicker). It keeps its place in the saved layout.
function pieceObj(k) { return k === 'ledwall' ? ledwall : k === 'neon' ? neon : milk; }
function pieceOn(k) { return !(settings.pieces && settings.pieces[k] === false); }
function applyPiece(k) {
  const o = pieceObj(k), on = pieceOn(k);
  o.visible = on;
  o.traverse(m => {
    if (!m.isMesh && !m.isSprite && !m.isPoints && !m.isLine) return;
    if (!on && !m.userData.pieceOff) { m.userData.pieceOff = Object.prototype.hasOwnProperty.call(m, 'raycast') ? { own: m.raycast } : { own: null }; m.raycast = () => {}; }
    else if (on && m.userData.pieceOff) { const r = m.userData.pieceOff.own; if (r) m.raycast = r; else delete m.raycast; delete m.userData.pieceOff; }
  });
  // #236 LED wall off: clips keep running silently (not decoded) and the scroller keeps its text, both for the phone;
  // DECKS and CAM only ever show on the Quest, so those stop
  // #248 (owner): a switched-off milk crate leaves the scene altogether, so nothing at all can bump into it, land in
  // it or carry it along (it was only hidden); it comes back to the same spot when switched on
  if (k === 'milk') {
    if (!on && o.parent) { o.userData.homeParent = o.parent; o.parent.remove(o); }
    else if (on && !o.parent && o.userData.homeParent) o.userData.homeParent.add(o);
  }
  if (k === 'ledwall') { led.setSilent(!on); if (!on && (ledMode === 'decks' || ledMode === 'cam' || isLive(ledMode) || ledMode === 'screen')) setLedMode('off'); }
}
function setPiece(k, on) { settings.pieces = { ...(settings.pieces || {}), [k]: on }; saveSettings(); applyPiece(k); drawMixScreen(); }
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
  ledwall.userData.tick();   // #222 LED wall turn + picture fit (Quest and phone)
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
    if (k2 === key || !/^(crate|milk\d?)$/.test(k2) || !it.obj.visible) continue;   // #235 switched off
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
    if (!o.visible) { blobFor(k, 'box', rig).visible = false; continue; }   // #235 switched off
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
try { const s = parseFloat(localStorage.getItem('vire.ledScale')); if (s > 0) ledwall.scale.setScalar(clamp(s, 0.4, 8)); } catch (e) {}   // #358 up to 8x (12.8 m wide)
try { const c = parseFloat(localStorage.getItem('vire.ledCurve')); if (c > 0) ledwall.userData.setCurve(c); } catch (e) {}   // #358 curved LED wall (degrees of arc)
const ledBase = (r = ledwall.rotation.z) => ((Math.abs(Math.round(r / (Math.PI / 2))) % 2 ? LED.W : LED.H) / 2 + LED.BEZ) * ledwall.scale.x;   // #222 portrait: half the width is the half-height
function ledTurned() {   // #222 let go after a twist: settle on portrait / landscape, keep it off the floor, save
  const t = ledwall.userData.settle(); stage.items.ledwall.base = ledBase(t);
  if (ledwall.position.y < stage.items.ledwall.base) ledwall.position.y = stage.items.ledwall.base;
  toast(Math.abs(Math.round(t / (Math.PI / 2))) % 2 ? 'LED wall: portrait' : 'LED wall: landscape', 1500);
  setTimeout(() => stage.save(), 500);
}
function ledTilted() { toast('LED wall: tilted ' + Math.round(ledwall.rotation.x * 180 / Math.PI) + ' deg', 1500); setTimeout(() => stage.save(), 300); }   // #248
function toggleLedPortrait() { ledwall.userData.turnTo(ledwall.userData.portrait() ? 0 : Math.PI / 2); setTimeout(ledTurned, 450); }
function setLedScale(s) { s = clamp(s, 0.4, 8); ledwall.scale.setScalar(s); if (stage) stage.items.ledwall.base = ledBase(); return s; }
function setLedCurve(deg) { ledwall.userData.setCurve(deg); try { localStorage.setItem('vire.ledCurve', String(ledwall.userData.curveDeg())); } catch (e) {} }   // #358
function saveLedScale() { try { localStorage.setItem('vire.ledScale', String(ledwall.scale.x)); } catch (e) {} }
const led = new LedPlayer(ledwall);
const scroller = new Scroller(ledwall, LED);   // #224 VJ TOOLS scroller over the LED wall (#236 the phone draws its own copy)
// #220 DJ CAM: a virtual camera on the LED wall, with an avatar copying the DJ's head and hands (Quest only, no phone)
const djSet = (() => { try { return { preset: 'front', mirror: true, avatar: true, style: 'robot', ...JSON.parse(localStorage.getItem('vire.djcam') || '{}') }; } catch { return { preset: 'front', mirror: true, avatar: true, style: 'robot' }; } })();
function saveDjSet() { try { localStorage.setItem('vire.djcam', JSON.stringify(djSet)); } catch {} }
const djcam = CAMERA_ROLE ? null : new DjCam(renderer, rig);
let streamer = null;   // #331 set up once the audio engine exists (below)
const streamPhone = () => !!(streamer && streamer.active && (streamer.source === 'phone' || streamer.source === 'pcam'));   // the stream holds the phone's LIVE picture (#347 or PHONE CAM)
const pcamOpts = () => (streamer && streamer.active && streamer.source === 'pcam' ? streamer._pcamOpts() : {});   // #347 keep the PHONE CAM video when the LED wall asks for LIVE
if (djSet.preset === 'booth') djSet.preset = 'gopro';   // #338 BOOTH became the GOPRO angle
if (!CAM_PRESETS[djSet.preset]) djSet.preset = 'front';   // #338 only FRONT, FADERS, GOPRO are left
if (djcam) djcam.preset = djSet.preset;
// #221 avatar styles: ROBOT (Blender model models/avatar/robot.glb, robot.js, default) or HUMAN (the Ready Player Me GLB, loaded when first picked)
const avatars = {};
let avatar = null;
function useAvatarStyle(st) {
  if (CAMERA_ROLE) return;
  if (!avatars[st]) {
    if (st === 'human') { const a = new Avatar(rig); avatars.human = a; a.load('models/avatar/dirroface.glb').catch(e => { a.status = 'failed: ' + e.message; console.warn('avatar not loaded', e); }); }
    else { const a = new RobotAvatar2(rig); avatars.robot = a; a.load(ROBOT_GLB).then(() => robotNeon()).catch(e => { a.status = 'failed: ' + e.message; console.warn('robot avatar not loaded', e); }); }   // #355 NEON CHROME
  }
  for (const a of Object.values(avatars)) a.root.visible = false;
  avatar = avatars[st]; avatar.root.visible = djSet.avatar;
}
useAvatarStyle(djSet.style === 'human' ? 'human' : 'robot');
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
  const stuMon = monOn && streamer && streamer.stuRun;   // #380 the PREVIEW monitor shows the S8 STUDIO's output
  if ((!pvWanted && !stuMon) || (monOn && !stuMon) || pvDecoding) return; pvDecoding = true;
  createImageBitmap(new Blob([buf], { type: 'image/jpeg' }), { imageOrientation: stuMon ? 'none' : 'flipY' }).then(b => {
    const old = pvTex.image; pvTex.image = b; pvTex.needsUpdate = true; if (old && old.close) old.close();
    if (stuMon) { pvLast = performance.now(); return; }
    if (pvScreen.material.map !== pvTex) { pvScreen.material.map = pvTex; pvScreen.material.color.setScalar(1); pvScreen.material.needsUpdate = true; }
    const a = b.width / b.height; if (Math.abs(a - pvA) > 0.01) { pvA = a; pvAspect(a); }
    pvLast = performance.now();
  }).catch(() => {}).finally(() => { pvDecoding = false; });
}
// #339 PREVIEW (STREAM page, beside GO LIVE): the tablet's slide-out screen shows the stream's outgoing frame (~7 fps, 384 x 216), with a LIVE /
// REHEARSAL badge. Off air it runs the chosen source as a rehearsal (drawn, not sent). The phone PREVIEW and MONITOR
// share the screen: switching one on switches the other off.
let monOn = false, monT = 0;
const monCanvas = document.createElement('canvas'); monCanvas.width = 384; monCanvas.height = 216;
const monG = monCanvas.getContext('2d'), monTex = new THREE.CanvasTexture(monCanvas); monTex.colorSpace = THREE.SRGBColorSpace;
function setMonitor(on) {
  monOn = !!on;
  if (monOn) { if (spect && spect.camSet && pvWanted) spect.camSet({ what: 'preview', v: false }); pvWanted = true; pvScreen.material.map = monTex; pvScreen.material.color.setScalar(1); pvScreen.material.needsUpdate = true; pvA = 16 / 9; pvAspect(pvA); monT = 0; }
  else { pvWanted = false; pvScreen.material.map = null; pvScreen.material.color.setHex(0x202020); pvScreen.material.needsUpdate = true; }
  if (streamer) streamer.setRehearse(monOn);
  drawMixScreen();
}
function stepMonitor(now) {
  if (!monOn || !streamer || now - monT < 140) return; monT = now;
  const S = streamer, g = monG, W = 384, H = 216;
  let src = S.source === 'phone' ? liveVideo : S.source === 'headset' && !S.fit.gear ? S.camVideo : S.canvas;
  if (S.stuRun) src = pvTex.image || null;   // #380 S8 STUDIO: what the S8 puts out (its preview pictures, sent while PREVIEW is on)
  g.fillStyle = '#05070c'; g.fillRect(0, 0, W, H);
  const w = src && (src.videoWidth || src.width), h = src && (src.videoHeight || src.height);
  if (w && h) { const k = Math.min(W / w, H / h), dw = w * k, dh = h * k; try { g.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh); } catch (e) {} }
  const live = S.state === 'live', con = S.state === 'connecting';
  const tag = live ? '● LIVE ' + S.elapsed() : con ? 'CONNECTING…' : 'REHEARSAL · OFF AIR';
  g.font = '700 13px system-ui,sans-serif'; g.textBaseline = 'middle'; const tw = g.measureText(tag).width;
  g.fillStyle = live ? 'rgba(200,20,30,0.85)' : 'rgba(0,0,0,0.6)'; g.fillRect(6, 6, tw + 14, 20); g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText(tag, 13, 16.5);
  g.textAlign = 'right'; g.fillStyle = 'rgba(0,0,0,0.6)'; const sl = STREAM_SRC[S.source] || ''; const sw = g.measureText(sl).width; g.fillRect(W - sw - 20, 6, sw + 14, 20); g.fillStyle = '#dfe6f2'; g.fillText(sl, W - 13, 16.5);
  g.textBaseline = 'alphabetic'; monTex.needsUpdate = true;
}
function setPreview(on) {
  if (!on && monOn) return setMonitor(false);
  if (on && monOn) { monOn = false; if (streamer) streamer.setRehearse(false); pvScreen.material.map = pvTex.image ? pvTex : null; pvScreen.material.needsUpdate = true; }   // #339 the screen goes back to the phone
  pvWanted = on;   // #196 stepPvLid slides the lid out / in
  if (spect && spect.camSet) spect.camSet({ what: 'preview', v: on });
  drawMixScreen();
}
led.onChange = () => drawMixScreen();
// #177 VideoVinyl + LED wall modes. LED WALL cycles OFF -> CLIPS (if videos were picked) -> DECKS -> CAM (#220) -> OFF.
let ledMode = 'off';
if (!CAMERA_ROLE) for (const k of ['ledwall', 'neon', 'milk']) applyPiece(k);   // #235 pieces switched off last time stay off
const deckVid = [new DeckVideo(), new DeckVideo()];
let vvIndex = new Map();          // headset: title key -> OPFS path of the video
const vvPC = new Map();           // PC: title key -> Promise<url|null> (HEAD videos/<title>.mp4)
let libVV = new Map();            // #206 title key -> Library Video clip name
function refreshLibVV() { media.list('Video').then(v => { libVV = new Map(v.filter(i => VIDEO_EXT.test(i.name)).map(i => [vvKey(baseName(i.name)), i.name])); }).catch(() => {}); }
refreshLibVV();
function vvSource(t) {
  if (t.pressVideo) return media.getFile('Video', t.pressVideo);   // #224 a record pressed from a clip plays that clip
  const key = vvKey(t.name);
  const lib = () => (libVV.has(key) ? media.getFile('Video', libVV.get(key)) : null);   // #206 a Library Video clip with the title (e.g. synced from the phone)
  if (settings.source === 'headset') { const p = vvIndex.get(key); return Promise.resolve(p ? store.readFile(p) : lib()); }
  if (!vvPC.has(key)) {
    const url = 'videos/' + encodeURIComponent(t.name.trim()) + '.mp4';
    vvPC.set(key, fetch(url, { method: 'HEAD' }).then(r => (r.ok ? url : null)).catch(() => null));
  }
  return vvPC.get(key).then(u => u || lib());
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
// #238 LIVE CAM: the spectator phone's composite (camera + gear) as live video on the LED wall. The phone sends it on
// the link's video slot only while this mode is on (spect.liveCam); its own copy of the wall shows a LIVE card.
const liveVideo = document.createElement('video'); liveVideo.muted = true; liveVideo.playsInline = true; liveVideo.autoplay = true;
let liveTrack = null;
function onLiveTrack(t) {
  liveTrack = t; liveVideo.srcObject = t ? new MediaStream([t]) : null;
  if (t) liveVideo.play().catch(() => {}); else if (isLive(ledMode) || ledMode === 'screen') setLedMode('off');
  if (!t && streamer && streamer.active && streamer.source === 'phone') streamer.setSource('card');   // #331 phone gone: the stream falls back to the card (#347 PHONE CAM waits for it)
}
const livePossible = () => !!(liveTrack && spect && spect.ui && spect.ui().phone);
function isLive(m) { return m === 'live' || m === 'solo'; }   // #239 SOLO = the phone's camera only, no gear
function nextLedMode(m) {   // OFF > CLIPS > VIDVINYL ('decks') > MANDEL > RETRO-SCENE (#439) > AVACAM ('cam', #240 names) > LIVE > SOLO (the last two only with the phone linked) > OFF
  const order = ['off', 'clips', 'decks', 'mandel', 'retro', 'vdancer', 'meta', 'cam', 'live', 'solo', 'screen'];   // #358 PHONE SCREEN only while the phone shares
  let i = order.indexOf(m);
  for (let k = 0; k < order.length; k++) { i = (i + 1) % order.length; const o = order[i]; if (o === 'screen' ? phoneScreen && livePossible() : !isLive(o) || livePossible()) return o; }
  return 'off';
}
function clipsMode() { if (isLive(ledMode) && spect && spect.liveCam && !streamPhone()) spect.liveCam(false); ledMode = 'clips'; led.kind = null; fxTex = null; }   // #238 a clip from the LED list ends LIVE
const LED_LABEL = { off: 'LED OFF', clips: 'LED CLIPS', decks: 'LED VIDVINYL', mandel: 'LED MANDEL', retro: 'LED RETRO-SCENE', card: 'LED CARD', vdancer: 'LED VECTOR-DANCER', meta: 'LED METABALLS', cam: 'LED DirroDj📹', live: 'LED LIVE', solo: 'LED SOLO', screen: 'LED PHONE SCREEN' };
let phoneScreen = false;   // #358 the spectator phone is sharing its screen (its video slot carries it)
function onPhoneScreen(on) {
  phoneScreen = on;
  if (on) toast('Phone is sharing its screen: LED PHONE SCREEN on the VISUALS page', 3500);
  else if (ledMode === 'screen') setLedMode('off');
  drawMixScreen();
}
// #439 MANDEL and RETRO-SCENE (wallfx.js): one 160 x 90 picture, drawn 4x up with the LED grid / dot / glow (the
// DIRROGRAM page's, shared) into fxBig, which is the 3D wall's picture and the stream's / CLY3DTV's VIDEOWALL. The
// phones on FOLLOW draw their own copy from the same clock and beat. RETRO-SCENE = the op-art dancer, and every 8 bars
// a GRAB LOOP (5 s of headset camera) when there is one. AUTO swaps MANDEL and RETRO-SCENE every 16 or 32 bars.
const wfx = new WallFx();
const fxBig = Object.assign(document.createElement('canvas'), { width: OUT_W, height: OUT_H }), fxBigG = fxBig.getContext('2d');
let fxTex = null, fxMask = null, fxMaskK = '';
const ledFx = { t0: 0, s: 'dancer', sBar: 0, bar: 0, autoBar: 0, loop: null, li: 0, loopT0: 0, auto: 0 };
try { ledFx.auto = +localStorage.getItem('vire.wallAuto') || 0; } catch (e) {}
const grab = { on: false, n: 0, loops: [] };   // GRAB LOOP: the last 4, this session only
// #444 PIXELS 0 to 10: the render size of the wall visuals and the LED grid with it (wallfx.js PX); the slider sets both
let wallPx = PX_DEF, wallPxApplied = false;
try { const v = localStorage.getItem('vire.wallPx'); if (v !== null) wallPx = Math.max(0, Math.min(10, +v | 0)); } catch (e) {}
function setWallPx(l) {
  wallPx = Math.max(0, Math.min(10, Math.round(l))); wallPxApplied = true;
  try { localStorage.setItem('vire.wallPx', String(wallPx)); localStorage.setItem('vire.wallPxA', '1'); } catch (e) {}
  if (dirro) dirro.setWall('cols', pxSize(wallPx)[2]);
  fxMaskK = ''; if (isFxMode(ledMode)) fxPaint(); drawMixScreen();
}
// #446 the CARD page's picture / animated GIF on the LED wall too (ledMode 'card'). A still goes to the phones as the usual LED picture (512 x 288 JPEG);
// a GIF is cut to at most 64 frames on the grab loops' sprite sheet (112 x 63 a cell, a JPEG under 60 KB for the phones; 224 x 126 for the Quest), keeping its timing
const cardWall = { on: true, file: null, name: '', pic: null, loop: null, prev: 'off' };
try { cardWall.on = localStorage.getItem('vire.cardWall') !== '0'; } catch (e) {}
async function gifLoop(file) {
  const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' }); await dec.tracks.ready;
  const total = dec.tracks.selectedTrack.frameCount; if (!total) throw new Error('no frames');
  const N = Math.min(LOOP.n, total), pick = new Set(Array.from({ length: N }, (_, k) => Math.floor(k * total / N)));
  const mk = (w, h) => { const c = Object.assign(document.createElement('canvas'), { width: w * LOOP.cols, height: h * LOOP.rows }), g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); return [c, g]; };
  const [sheet, sg] = mk(LOOP.W2, LOOP.H2), [small, smg] = mk(LOOP.w, LOOP.h);
  let ms = 0, n = 0;
  for (let i = 0; i < total; i++) {
    const r = await dec.decode({ frameIndex: i }), im = r.image; ms += (im.duration || 100000) / 1000;
    if (pick.has(i)) {
      const iw = im.displayWidth || im.codedWidth, ih = im.displayHeight || im.codedHeight;
      const cell = (cw, ch, cg) => { const k = Math.min(cw / iw, ch / ih), w = iw * k, h = ih * k; cg.drawImage(im, (n % LOOP.cols) * cw + (cw - w) / 2, Math.floor(n / LOOP.cols) * ch + (ch - h) / 2, w, h); };
      cell(LOOP.W2, LOOP.H2, sg); cell(LOOP.w, LOOP.h, smg); n++;
    }
    im.close();
  }
  dec.close && dec.close();
  let d = ''; for (const q of [0.8, 0.65, 0.5, 0.4, 0.3, 0.22, 0.15]) { d = small.toDataURL('image/jpeg', q); if (d.length < 60000) break; }
  return { id: 'G' + (file.size % 99991).toString(36) + file.name.length.toString(36) + Date.now().toString(36).slice(-4), sheet, d: d.length < 60000 ? d : '', n, fps: Math.max(2, Math.min(24, n / Math.max(0.2, ms / 1000))) };
}
async function cardWallSet(file, show = true) {   // the CARD page's pick (null = back to the main card) as a LED wall source
  if (cardWall.pic && cardWall.pic.close) cardWall.pic.close();
  cardWall.pic = null; cardWall.loop = null; cardWall.file = file || null; cardWall.name = file ? file.name : '';
  if (!file) { if (ledMode === 'card') setLedMode(cardWall.prev && cardWall.prev !== 'card' ? cardWall.prev : 'off'); return; }
  if ((/\.gif$/i.test(file.name) || file.type === 'image/gif') && typeof ImageDecoder !== 'undefined') {
    toast('Preparing the GIF for the LED wall…', 2000);
    try { cardWall.loop = await gifLoop(file); } catch (e) { console.warn('GIF for the LED wall', e); }
  }
  if (!cardWall.loop) { try { cardWall.pic = await createImageBitmap(file); } catch (e) { toast('That picture would not open for the LED wall', 2500); return; } }
  if (cardWall.file !== file) return;   // another pick came meanwhile
  if (show && cardWall.on) { if (ledMode !== 'card') cardWall.prev = ledMode; setLedMode('card'); ledFx.loopT0 = performance.now(); }
  else drawMixScreen();
}
// #444 TAP BPM: the VJ taps the beat in; the effects (and the phones) run on it until a long press hands them back to the music
const wtap = { t: [], iv: 0, anchor: 0, last: 0, n: 0 };
const wtapOn = () => !!wtap.iv && performance.now() - wtap.last < 600000;
function tapWall() {
  const now = performance.now(); if (wtap.t.length && now - wtap.t[wtap.t.length - 1] > 2000) wtap.t = [];
  wtap.t.push(now); if (wtap.t.length > 8) wtap.t.shift();
  if (wtap.t.length >= 2) wtap.iv = Math.max(300, Math.min(1000, (wtap.t[wtap.t.length - 1] - wtap.t[0]) / (wtap.t.length - 1)));
  if (wtap.iv) { if (wtapOn()) wtap.n = Math.round(wtap.n + (now - wtap.anchor) / wtap.iv); wtap.anchor = now; }   // the tap is a beat: snap to it
  wtap.last = now; drawMixScreen();
}
function tapClear() { wtap.t = []; wtap.iv = 0; toast('TAP BPM off: the effects follow the music again', 2500); drawMixScreen(); }
const tapLbl = () => (wtapOn() ? 'TAP ' + Math.round(60000 / wtap.iv) : wtap.t.length ? 'TAP…' : 'TAP BPM');
function tapBeat() { if (!wtapOn()) return null; const k = Math.floor((performance.now() - wtap.anchor) / wtap.iv); return { count: wtap.n + k, last: wtap.anchor + k * wtap.iv }; }
const isFxMode = m => m === 'mandel' || m === 'retro' || m === 'vdancer' || m === 'meta' || m === 'card';
// #442 VECTOR-DANCER: moire rings through a matte (white on black) clip, 6 slots (slot 1 is the bundled DANCER 1; the rest load from VISUALS > Video)
const VD_SLOTS = 6, VD_BUILTIN = 'mattes/matte1.mp4';
const vd = { rp: { ...RP_DEF }, mp: { ...MP_DEF }, slots: ['@builtin', '', '', '', '', ''], sel: 0, pick: null, ok: false, vid: null, cv: null, g: null, url: '', cur: null, mask: new Uint8Array(FX_W * FX_H) };
try { const o = JSON.parse(localStorage.getItem('vire.vd') || '{}'); if (o.rp) Object.assign(vd.rp, o.rp); if (o.mp) Object.assign(vd.mp, o.mp); if (Array.isArray(o.slots) && o.slots.length === VD_SLOTS) vd.slots = o.slots.map(x => (typeof x === 'string' ? x : '')); if (typeof o.sel === 'number') vd.sel = o.sel; } catch (e) {}
function vdSave() { try { localStorage.setItem('vire.vd', JSON.stringify({ rp: vd.rp, mp: vd.mp, slots: vd.slots, sel: vd.sel })); } catch (e) {} }
function vdLabel(i) { const s = vd.slots[i]; return s === '@builtin' ? 'DANCER 1' : s ? s.replace(/\.[^.]+$/, '') : ''; }
async function vdLoad() {   // the selected slot's matte into the hidden video
  const s = vd.slots[vd.sel]; vd.ok = false;
  if (!s) { vd.cur = null; if (vd.vid) vd.vid.pause(); return; }
  if (!vd.vid) {
    vd.vid = Object.assign(document.createElement('video'), { muted: true, loop: true, playsInline: true });
    vd.cv = Object.assign(document.createElement('canvas'), { width: FX_W, height: FX_H }); vd.g = vd.cv.getContext('2d', { willReadFrequently: true });
  }
  if (vd.cur === s) { try { await vd.vid.play(); vd.ok = true; } catch (e) {} return; }
  let url = '';
  if (s === '@builtin') url = new URL(VD_BUILTIN, location.href).href;
  else {
    const f = await media.getFile('Video', s).catch(() => null);
    if (!f) { toast('The matte ' + s + ' is not on this headset', 3000); vd.slots[vd.sel] = ''; vd.cur = null; vdSave(); drawMixScreen(); return; }
    url = URL.createObjectURL(f);
  }
  if (vd.url.startsWith('blob:')) URL.revokeObjectURL(vd.url);
  vd.url = url; vd.cur = s; vd.vid.src = url;
  try { await vd.vid.play(); vd.ok = true; } catch (e) { toast('The matte video will not play (' + (e.name || e.message) + ')', 3500); }
}
function vdMask(W, H) {   // the matte at the render size: bytes, 255 where the clip is light
  const v = vd.vid; if (!vd.ok || !v || v.readyState < 2 || !vd.slots[vd.sel]) return null;
  if (vd.cv.width !== W || vd.cv.height !== H) { vd.cv.width = W; vd.cv.height = H; vd.mask = new Uint8Array(W * H); }
  vd.g.drawImage(v, 0, 0, W, H);
  const p = vd.g.getImageData(0, 0, W, H).data, m = vd.mask;
  for (let i = 0, k = 0; i < m.length; i++, k += 4) m[i] = p[k] > 110 ? 255 : 0;
  return m;
}
function vdSelect(i) { if (!vd.slots[i]) { vdPickFor(i); return; } vd.sel = i; vdSave(); if (ledMode === 'vdancer') vdLoad(); else setLedMode('vdancer'); drawMixScreen(); }
function vdPickFor(i) {   // to the clips page (VISUALS > Video): the next thumbnail tapped is this slot's matte
  vd.pick = i; toolsPage = null; videoPage = true; vpFolder = 'Video'; vpSel = null; vpSelFolder = null; vpPg = 0; vpLoad();
  toast(`Tap a clip to load it into matte slot ${i + 1} (white figure on black)`, 4500);
}
function vdAssign(name) { const i = vd.pick; vd.pick = null; if (i == null) return; vd.slots[i] = name; vd.sel = i; vdSave(); videoPage = false; setTools('vdancer'); if (ledMode === 'vdancer') vdLoad(); else setLedMode('vdancer'); }
function fxPaint() {
  const L = dirro ? dirro.wall : { cols: pxSize(wallPx)[2], fill: 0.78, glow: 1 }, g = fxBigG, cols = ledMode === 'mandel' ? FX_W : L.cols;   // #444 MANDEL always on its own 160 grid
  g.globalCompositeOperation = 'source-over'; g.imageSmoothingEnabled = false;
  g.filter = L.glow !== 1 ? `brightness(${L.glow})` : 'none'; g.drawImage(wfx.canvas, 0, 0, OUT_W, OUT_H); g.filter = 'none';
  if (cols > 0) {
    const k = cols + '|' + L.fill;
    if (k !== fxMaskK) {
      fxMaskK = k; fxMask = fxMask || Object.assign(document.createElement('canvas'), { width: OUT_W, height: OUT_H });
      const m = fxMask.getContext('2d'), rows = Math.round(cols * 9 / 16), cw = OUT_W / cols, ch = OUT_H / rows, dw = cw * L.fill, dh = ch * L.fill;
      m.fillStyle = '#2e2e2e'; m.fillRect(0, 0, OUT_W, OUT_H); m.fillStyle = '#fff';
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) m.fillRect(x * cw + (cw - dw) / 2, y * ch + (ch - dh) / 2, dw, dh);
    }
    g.globalCompositeOperation = 'multiply'; g.drawImage(fxMask, 0, 0); g.globalCompositeOperation = 'source-over';
  }
  if (fxTex) fxTex.needsUpdate = true;
}
function wallBeat(now) {   // beat position (beats: onset count + the part of a beat since) and the kick, as the phones work it out
  if (wtapOn()) { const ph = now - wtap.anchor; return { bp: wtap.n + ph / wtap.iv, kick: Math.exp(-(ph % wtap.iv) / 180) }; }   // #444 tapped in
  let iv = 0; const bpm = (dirroNow() || {}).bpm;
  if (bpm >= 60 && bpm <= 200) { iv = 60000 / bpm; while (iv < 300) iv *= 2; while (iv > 1000) iv /= 2; }
  if (iv && beat && beat.last && now - beat.last < 4000) return { bp: beat.count + (now - beat.last) / iv, kick: Math.exp(-(now - beat.last) / 180) };
  return { bp: now / 500, kick: 0 };   // no music: 120 BPM on the clock
}
function stepWallFx(now) {
  if (!wallPxApplied && dirro) { wallPxApplied = true; try { if (!localStorage.getItem('vire.wallPxA')) { localStorage.setItem('vire.wallPxA', '1'); dirro.setWall('cols', pxSize(wallPx)[2]); } } catch (e) {} }   // #444 once: the grid follows PIXELS
  if (!isFxMode(ledMode)) return;
  const { bp, kick } = wallBeat(now), bar = Math.floor(bp / 4);
  if (bar < ledFx.bar - 1) ledFx.sBar = ledFx.autoBar = bar;   // the beat count started again
  ledFx.bar = bar;
  if (ledFx.auto && ledMode !== 'card' && bar - ledFx.autoBar >= ledFx.auto) setLedMode(ledMode === 'mandel' ? 'retro' : 'mandel');
  if (ledMode === 'retro' && bar - ledFx.sBar >= 8) {   // every 8 bars: the dancer, or the next loop
    ledFx.sBar = bar;
    if (ledFx.s === 'loop' || !grab.loops.length) ledFx.s = 'dancer';
    else { ledFx.li = (ledFx.li + 1) % grab.loops.length; ledFx.loop = grab.loops[ledFx.li]; ledFx.s = 'loop'; ledFx.loopT0 = now; }
  }
  const mode = ledMode === 'mandel' ? 'mandel' : ledMode === 'vdancer' ? 'rings' : ledMode === 'meta' ? 'meta' : ledMode === 'card' ? (cardWall.loop ? 'loop' : 'pic') : ledFx.s === 'loop' && ledFx.loop ? 'loop' : 'dancer';
  const cl = ledMode === 'card' ? cardWall.loop : null;   // #446
  if (wfx.frame({ mode, t: now - ledFx.t0, bp, kick, loop: cl ? cl.sheet : ledFx.loop && ledFx.loop.sheet, ln: cl ? cl.n : 0, lfps: cl ? cl.fps : 0, fwd: !!cl, pic: cardWall.pic, lw: LOOP.W2, lh: LOOP.H2, lt: now - ledFx.loopT0, px: wallPx, mask: mode === 'rings' ? vdMask(...pxSize(wallPx)) : null, rp: vd.rp, mp: vd.mp })) fxPaint();
}
function setWallAuto(n) { ledFx.auto = n; ledFx.autoBar = ledFx.bar; try { localStorage.setItem('vire.wallAuto', String(n)); } catch (e) {} if (n && !isFxMode(ledMode)) setLedMode('mandel'); else drawMixScreen(); }
// GRAB LOOP: 5.3 s (#441), 12 pictures a second, 112 x 63 each on an 8 x 8 sheet (a JPEG under 60 KB for the phones). From the
// SHOWTIME! shot while the stream runs, else the headset camera (HEADSET CAM's own, or opened just for the 3 s)
async function grabLoop() {
  if (grab.on) return;
  let el = null, own = null;
  if (streamer && streamer.active && streamer.source !== 'card') el = streamer.canvas;
  else if (streamer && streamer.camStream && streamer.camVideo && streamer.camVideo.videoWidth) el = streamer.camVideo;
  else {
    grab.on = true; grab.n = -1; drawMixScreen();
    try {
      own = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      el = Object.assign(document.createElement('video'), { muted: true, playsInline: true }); el.srcObject = own; await el.play();
      for (let i = 0; i < 40 && !el.videoWidth; i++) await new Promise(r => setTimeout(r, 50));
      await new Promise(r => setTimeout(r, 300));   // the exposure settles
    } catch (e) { grab.on = false; if (own) own.getTracks().forEach(t => t.stop()); toast('GRAB LOOP: no headset camera (' + (e.message || e.name) + ')', 3500); drawMixScreen(); return; }
  }
  grab.on = true; grab.n = 0; drawMixScreen();
  const sheet = Object.assign(document.createElement('canvas'), { width: LOOP.W2 * LOOP.cols, height: LOOP.H2 * LOOP.rows }), sg = sheet.getContext('2d');   // #444 the Quest's own sheet, 224 x 126 a cell
  const small = Object.assign(document.createElement('canvas'), { width: LOOP.w * LOOP.cols, height: LOOP.h * LOOP.rows }), smg = small.getContext('2d');   // and the phones' (112 x 63, a JPEG under 60 KB)
  sg.fillStyle = '#000'; sg.fillRect(0, 0, sheet.width, sheet.height); smg.fillStyle = '#000'; smg.fillRect(0, 0, small.width, small.height);
  await new Promise(done => { const iv = setInterval(() => {
    const i = grab.n, sw = el.videoWidth || el.width, sh = el.videoHeight || el.height;
    if (sw && sh) { const cell = (cw, ch, cg) => { const k = Math.max(cw / sw, ch / sh), w = cw / k, h = ch / k; try { cg.drawImage(el, (sw - w) / 2, (sh - h) / 2, w, h, (i % LOOP.cols) * cw, Math.floor(i / LOOP.cols) * ch, cw, ch); } catch (e) {} }; cell(LOOP.W2, LOOP.H2, sg); cell(LOOP.w, LOOP.h, smg); }
    grab.n++; if (grab.n % 6 === 0) drawMixScreen();
    if (grab.n >= LOOP.n) { clearInterval(iv); done(); }
  }, 1000 / LOOP.fps); });
  if (own) { own.getTracks().forEach(t => t.stop()); el.srcObject = null; }
  let d = ''; for (const q of [0.72, 0.6, 0.5, 0.4, 0.3, 0.22, 0.15]) { d = small.toDataURL('image/jpeg', q); if (d.length < 60000) break; }
  const thumb = Object.assign(document.createElement('canvas'), { width: LOOP.w, height: LOOP.h }); thumb.getContext('2d').drawImage(sheet, 0, 0, LOOP.W2, LOOP.H2, 0, 0, LOOP.w, LOOP.h);
  const L = { id: 'L' + Date.now().toString(36), sheet, thumb, d: d.length < 60000 ? d : '' };
  grab.loops.unshift(L); while (grab.loops.length > 4) grab.loops.pop();
  grab.on = false;
  showLoop(L);
  toast('Loop grabbed: on the LED wall now (also in VISUALS > Video)', 2500); if (videoPage && vpFolder === 'Video') vpLoad(); else drawMixScreen();
}
function showLoop(L) {   // #441 a grabbed loop on the LED wall (RETRO-SCENE shows it)
  if (ledMode !== 'retro') setLedMode('retro');
  ledFx.s = 'loop'; ledFx.li = Math.max(0, grab.loops.indexOf(L)); ledFx.loop = L; ledFx.loopT0 = performance.now(); ledFx.sBar = ledFx.bar; drawMixScreen();
}
const retroIcon = new Image(); retroIcon.onload = () => { if (toolsPage === 'wall') drawMixScreen(); }; retroIcon.src = 'retroscene.png';   // the owner's RETRO SCENE disk
function setLedMode(m, kind) {
  if (m === 'clips') {   // #439 kind: 'video' = CLIPS, 'image' = PICTURES (the WALL page's tiles); none = the whole LED LIST
    led.kind = kind || null;
    if (!led.pool().length) { if (kind) { toast(kind === 'image' ? 'No pictures in the LED LIST (VISUALS > Images > + LED)' : 'No clips in the LED LIST (VISUALS > Video > + LED)', 3000); return; } m = 'decks'; }
  }
  if (!isFxMode(m)) fxTex = null;
  if (m === 'vdancer') vdLoad(); else if (vd.vid && !vd.vid.paused) vd.vid.pause();   // #442
  if (!pieceOn('ledwall') && (m === 'decks' || m === 'cam' || isLive(m))) m = 'off';   // #236 switched off: only clips run (for the phone)
  if (isLive(m) && !livePossible()) m = 'off';   // #238 needs the phone linked
  if (m === 'screen' && !(phoneScreen && livePossible() && pieceOn('ledwall'))) m = 'off';   // #358
  if (m !== 'clips' && led.on) led.stop();
  if (m === 'cam' && !djcam) m = 'off';
  if (isLive(ledMode) && !isLive(m) && spect && spect.liveCam && !streamPhone()) spect.liveCam(false);   // #331 unless the stream uses it
  ledMode = m;
  if (m === 'clips') led.playRandom();
  else if (m === 'off') ledwall.userData.setVideo(null);
  else if (m === 'cam') ledwall.userData.setCam(djcam.rt.texture, djSet.mirror);   // #220
  else if (isLive(m)) { spect.liveCam(true, m === 'solo', pcamOpts()); ledwall.userData.setVideo(liveVideo); }
  else if (m === 'screen') ledwall.userData.setVideo(liveVideo);   // #358 the phone's shared screen   // #238 (#239 SOLO: camera only)
  else if (isFxMode(m)) { ledFx.t0 = performance.now(); ledFx.s = 'dancer'; ledFx.sBar = ledFx.autoBar = ledFx.bar; fxTex = ledwall.userData.setCanvas(fxBig); fxPaint(); }   // #439
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
  // #348 (owner) reset: the blue milk crate just right of the DJ's feet (the DJ stands at rig (0.05, 0, 0.62)), long side
  // along the case, and the record crate standing on it, its front turned to the DJ: everything within reach of the case
  items: { deckA: [-DECK_X, 0.898, 0, 0], deckB: [DECK_X, 0.898, 0, 0], mixer: [0, 0.88, 0, 0], crate: [0.55, MILK.H, 0.62, -Math.PI / 2], milk: [0.55, 0, 0.62, 0], milk2: [-1.0, 0, 0.68, 0.35], milk3: [-1.47, 0, 0.3, 0.2], milk4: [-1.47, 0, 0.83, 0.2], milk5: [-1.0, 0, 1.21, 0.35], milk6: [-1.47, 0, 1.36, 0.2], neon: [0, 1.45, -0.5, 0], ledwall: [-2.0, 1.6, -0.55, 0] },
  cases: { caseA: [0, 0, 0, 0, 1.3, 0.52, 0.88] },
});
const MOVABLE = new Proxy({}, { get: (_, k) => stage.object(k) });
// #378 GEAR LOCKDOWN: the decks and the mixer can't be picked up or turned (hand, controller or mouse) while it is on. It is ON every time the app starts (not
// saved), so a stray grab can't push them off the flight case top; the button is on DJ TOOLS. The flight cases, the crate, the LED wall and the rest are not locked.
let gearLock = true, gearLockToastT = 0;
const GEAR_LOCK_KEYS = new Set(['deckA', 'deckB', 'mixer']);
const gearLocked = key => gearLock && GEAR_LOCK_KEYS.has(key);
function gearLockMsg() { const t = performance.now(); if (t - gearLockToastT > 2500) { gearLockToastT = t; toast('GEAR LOCKDOWN is on: decks and mixer stay put (DJ TOOLS to unlock)', 2800); } }
// #378 the turntables turn in 45 degree steps (hand twist, thumbstick, mouse wheel / Shift-drag), so battle mode (decks turned 90) is two clean steps, not fiddly
const DECK_STEP = Math.PI / 4, isDeckKey = k => k === 'deckA' || k === 'deckB';
const snapDeck = (k, y) => isDeckKey(k) ? Math.round(y / DECK_STEP) * DECK_STEP : y;
// #337 GOPRO: starts on the audience side of the mixer, just over its far edge, facing the DJ (the BOOTH angle)
const gopro = CAMERA_ROLE ? null : new GoPro(rig, () => ({ p: new THREE.Vector3(mixer.position.x, deckGroups[0].position.y + DECK.H + 0.3, mixer.position.z - 0.55), yaw: Math.PI }));
// #389 GOPRO2 (owner): a second action camera, by default overhead: above the mixer and decks, looking straight down
const gopro2 = CAMERA_ROLE ? null : new GoPro(rig, () => ({ p: new THREE.Vector3(mixer.position.x, deckGroups[0].position.y + DECK.H + 1.4, mixer.position.z), yaw: 0, pitch: -Math.PI / 2 }), 'vire.gopro2', 'wide');
// #406 LASER: one movable head; start spot behind the DJ, 2.1 m up, firing forward (-z) over his head toward the audience side
const laser = CAMERA_ROLE ? null : new Laser(rig, () => ({ p: new THREE.Vector3(mixer.position.x, 2.1, mixer.position.z + 0.9), yaw: 0, pitch: -0.1 }));
let laserTapT = 0;
// #411 REAL WORLD (passthrough, Quest 3; #408 depth test: clean, no frame cost). Occlusion: three r169 draws the headset's
// depth map into the depth buffer by itself once the session has depth-sensing (getDepthSensingMesh). We patch its
// shader: colour writes off (it wrote none of its own: could paint passthrough black) and the real surface pushed back
// 3 cm + 2 % of its distance, so things drawn right at a real surface (3D hands / glove on your real hands, gear on a
// real table, the neon's glow on the wall) still show. Assumes the Quest's depth convention seen in #408c: near 0.1 m,
// far infinite (window depth = 1 - near / z). Room: the Space Setup planes (walls, ceiling, floor, tables...) in rig
// space, refreshed 10 times a second, for the laser's beams to stop on.
let roomT = 0;
const roomCache = new Map();   // XRPlane -> { t, poly, inv, q }
const _rwM = new THREE.Matrix4(), _rwI = new THREE.Matrix4();
function patchOcclusion(m) {
  m.userData.vireOcc = true; const mat = m.material; mat.colorWrite = false;
  mat.uniforms.uNear = { value: 0.1 }; mat.uniforms.uBias = { value: 0.03 };
  mat.fragmentShader = `uniform sampler2DArray depthColor; uniform float depthWidth; uniform float depthHeight; uniform float uNear; uniform float uBias;
void main() {
  vec2 coord = vec2(gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight); float layer = 0.0;
  if (coord.x >= 1.0) { coord.x -= 1.0; layer = 1.0; }
  float d = texture(depthColor, vec3(coord, layer)).r;
  if (d >= 0.99999) { gl_FragDepth = d; return; }
  float z = uNear / max(1.0 - d, 1e-6); z += uBias + 0.02 * z;
  gl_FragDepth = 1.0 - uNear / z;
}`;
  mat.needsUpdate = true;
}
// #413 the depth map lifted back into the room through the depth camera's own projection / pose (RealDepth): lines up
// close to the headset, unlike three's screen-space copy (#411 owner: real hand / controller ~5 cm above the drawn one).
// three's own occluder stays as the fallback if the depth info can't be read. The laser gets the same depth view.
let realDepth = null, rdBinding = null, rdSession = null;
// #415 HEADSET CAM AUTO FIT (CAM FIT page): 9 crosshairs on the camera picture; the controller's front tip on each + trigger
const camCal = { on: false, k: 0, samples: [], prev: {}, msg: '', handsWas: false };
const _ccM = new THREE.Matrix4(), _ccH = new THREE.Matrix4(), _ccV = new THREE.Vector3();
function camCalStart() {
  const S = streamer; if (!S) return;
  if (!renderer.xr.isPresenting) { camCal.msg = 'AUTO FIT runs in the headset (passthrough).'; drawMixScreen(); return; }
  if (S.source !== 'headset') S.setSource('headset');
  camCal.handsWas = !!S.showOpt.handsReal; if (!camCal.handsWas) S.setShowOpt('handsReal', true);   // drawn hands / controllers would cover the real tip in the picture
  if (!S.testing && !S.live) S.setTesting(true);
  Object.assign(camCal, { on: true, k: 0, samples: [], prev: {}, msg: '' }); drawMixScreen();
}
function camCalStop(msg) {
  camCal.on = false; if (streamer && !camCal.handsWas) streamer.setShowOpt('handsReal', false);
  camCal.msg = msg || ''; drawMixScreen();
}
function camCalStep() {   // per frame while on: a trigger press = one sample at the current crosshair
  if (!camCal.on || !renderer.xr.isPresenting) return;
  const ses = renderer.xr.getSession(), frame = renderer.xr.getFrame(), ref = renderer.xr.getReferenceSpace(); if (!ses || !frame || !ref) return;
  for (const src of ses.inputSources) {
    const gp = src.gamepad; if (!gp || !src.gripSpace) continue;
    const key = src.handedness || 'x', down = !!(gp.buttons[0] && gp.buttons[0].pressed), was = camCal.prev[key]; camCal.prev[key] = down;
    if (!down || was) continue;
    const pose = frame.getPose(src.gripSpace, ref); if (!pose) continue;
    _ccM.fromArray(pose.transform.matrix); _ccV.set(0, -0.007, -0.05).applyMatrix4(_ccM);   // the controller's front tip (#140), in the room
    _ccH.copy(renderer.xr.getCamera().matrixWorld).invert(); _ccV.applyMatrix4(_ccH);         // -> the headset's own frame
    const S = streamer, W = S.canvas.width, H = S.canvas.height, t = CAL_TARGETS[camCal.k];
    camCal.samples.push({ P: _ccV.toArray(), px: [t[0] * W, t[1] * H] }); camCal.k++;
    if (camCal.k >= CAL_TARGETS.length) {
      const r = solveCamFit(camCal.samples, W, H, S.fit);
      if (!r) { camCalStop('AUTO FIT failed: try again, with the tip exactly on each cross.'); return; }
      for (const [k, v] of Object.entries(r.fit)) S.setFit(k, v);
      camCalStop(`AUTO FIT done: ${r.rms.toFixed(1)} px off on average${r.rms > 12 ? ' (high: run it again)' : ''}. Turn your head: if the gear trails the picture, raise LAG.`);
    } else drawMixScreen();
    return;
  }
}
function stepRealWorld(dt) {
  if (!arMode || !renderer.xr.isPresenting) { if (realDepth) realDepth.clear(); if (laser) laser.setDepth(null); return; }
  const hasD = renderer.xr.hasDepthSensing && renderer.xr.hasDepthSensing();
  const occ = hasD ? renderer.xr.getDepthSensingMesh() : null;
  let rdOk = false;
  if (hasD && !CAMERA_ROLE) {
    const ses = renderer.xr.getSession();
    if (ses !== rdSession) { rdSession = ses; rdBinding = null; try { rdBinding = new XRWebGLBinding(ses, renderer.getContext()); } catch (e) { console.warn('XRWebGLBinding', e); } }
    if (!realDepth) realDepth = new RealDepth(scene);
    const frame = renderer.xr.getFrame(), ref = renderer.xr.getReferenceSpace(), vp = frame && ref ? frame.getViewerPose(ref) : null;
    rdOk = realDepth.update(vp && vp.views, rdBinding, renderer.xr.getDepthTexture());
    realDepth.on = settings.occlusion !== false;
  }
  if (occ) { if (!occ.userData.vireOcc) patchOcclusion(occ); occ.visible = !rdOk && settings.occlusion !== false; }   // fallback only
  if (laser) laser.setDepth(rdOk && settings.roomHits !== false && laser.on ? realDepth.laserData() : null);   // beams stop at real hands / people
  if (!laser || !laser.on) return;
  roomT += dt; if (roomT < 0.1) return; roomT = 0;
  const frame = renderer.xr.getFrame(), ref = renderer.xr.getReferenceSpace();
  if (settings.roomHits === false || !frame || !ref || !frame.detectedPlanes) { laser.setRoom(null); return; }
  rig.updateMatrixWorld(); _rwI.copy(rig.matrixWorld).invert();
  const list = [], seen = new Set();
  for (const p of frame.detectedPlanes) {
    const pose = frame.getPose(p.planeSpace, ref); if (!pose) continue;
    let e = roomCache.get(p);
    if (!e || e.t !== p.lastChangedTime) { e = { t: p.lastChangedTime, poly: new Float32Array(p.polygon.flatMap(v => [v.x, v.z])), inv: new THREE.Matrix4(), q: new THREE.Quaternion() }; roomCache.set(p, e); }
    _rwM.fromArray(pose.transform.matrix).premultiply(_rwI);   // plane -> rig
    e.q.setFromRotationMatrix(_rwM); e.inv.copy(_rwM).invert();
    list.push(e); seen.add(p);
  }
  for (const k of roomCache.keys()) if (!seen.has(k)) roomCache.delete(k);
  laser.setRoom(list);
}
const laserPv = { c: document.createElement('canvas') };   // #407 the Workbench page's scope preview (phosphor trails)
function laserTap() {   // tap = on / off; double-tap = back to its start spot, on
  if (!laser) return; const now = performance.now();
  if (now - laserTapT < 700) { laserTapT = 0; laser.reset(); laser.setOn(true); toast('Laser back at its start', 1500); drawMixScreen(); return; }
  laserTapT = now; laser.setOn(!laser.on); drawMixScreen();
}
const gpActive = () => gopro && gopro.on ? gopro : gopro2 && gopro2.on ? gopro2 : null;   // the one that is the camera now (only one at a time)
let goproTapT = 0, goproTapWas = false, goproTapId = '';
// #338 GOPRO is an AVACAM angle: picking it brings the GoPro out (FRONT / FADERS put it away). STREAM page GOPRO button:
// tap = GOPRO angle on / back to FRONT; double-tap (within 0.35 s) on either button = the GoPro back to its start spot, on.
function goproTap(id = 'gopro') {   // #389 for GOPRO and GOPRO2: tap = on / back to FRONT, double-tap = back to its start spot, on
  const gp = id === 'gopro2' ? gopro2 : gopro; if (!gp) return; const now = performance.now();
  if (now - goproTapT < 700 && goproTapId === id) { goproTapT = 0; gp.reset(); setDjPreset(id); toast((id === 'gopro2' ? 'GOPRO2' : 'GOPRO') + ' back at its start', 1500); return; }
  goproTapT = now; goproTapId = id; goproTapWas = gp.on;
  if (!gp.on && streamer && (streamer.source === 'headset' || streamer.source === 'pcam')) streamer.setSource('show');   // #402 the GoPro becomes the camera from any page
  setDjPreset(gp.on ? 'front' : id);
}
function goproPick(id) {   // #389 the SHOWTIME! camera row: select it; double-tap = back to its start spot
  const gp = id === 'gopro2' ? gopro2 : gopro; if (!gp) return; const now = performance.now();
  if (now - goproTapT < 700 && goproTapId === id && djSet.preset === id) { goproTapT = 0; gp.reset(); setDjPreset(id); toast((id === 'gopro2' ? 'GOPRO2' : 'GOPRO') + ' back at its start', 1500); return; }
  goproTapT = now; goproTapId = id; setDjPreset(id);
}
function goproReset(id) {   // #404 long press on a GOPRO button: back to its start spot, and it is the camera
  const gp = id === 'gopro2' ? gopro2 : gopro; if (!gp) return;
  if (streamer && (streamer.source === 'headset' || streamer.source === 'pcam')) streamer.setSource('show');
  gp.reset(); setDjPreset(id); toast((id === 'gopro2' ? 'GOPRO2' : 'GOPRO') + ' back at its start', 1500); drawMixScreen();
}
// #404 (owner: GOPRO2 hangs too high to reach) the A button on the right controller brings the GoPro that is the camera to
// that hand: 15 cm in front of the controller, looking where it points. Grip it from there to place it.
function gpSummon(st) {
  const gp = gpActive(); if (!gp || !st || !st.grip) return false;
  st.grip.updateMatrixWorld(); const q = st.grip.getWorldQuaternion(new THREE.Quaternion()), p = st.grip.getWorldPosition(new THREE.Vector3());
  p.addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(q), 0.15); p.y += 0.02;
  gp.grab(); gp.hold(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1))); gp.release();
  toast((gp === gopro2 ? 'GOPRO2' : 'GOPRO') + ' in your hand: grip it to place it', 1800); return true;
}
function goproAngleTap() {   // the AVACAM tab's GOPRO angle button: select it; double-tap = back to the start
  if (!gopro) return setDjPreset('gopro'); const now = performance.now();
  if (now - goproTapT < 350 && djSet.preset === 'gopro') { goproTapT = 0; gopro.reset(); setDjPreset('gopro'); toast('GoPro back at the start', 1500); return; }
  goproTapT = now; setDjPreset('gopro');
}
if (gopro) gopro.setOn(djSet.preset === 'gopro', false);   // #338 one switch
if (gopro2) gopro2.setOn(djSet.preset === 'gopro2', false);
function goproToDjcam(gp) {   // the DJ CAM camera (a rig child) takes the GoPro's smoothed pose and zoom
  rig.updateMatrixWorld(); _gpM.copy(rig.matrixWorld).invert().multiply(gp.cam.matrixWorld);
  _gpM.decompose(djcam.cam.position, djcam.cam.quaternion, _gpS);
  if (djcam.cam.fov !== gp.cam.fov) { djcam.cam.fov = gp.cam.fov; djcam.cam.updateProjectionMatrix(); }
  djcam.cam.updateMatrixWorld(true);
}
const _gpM = new THREE.Matrix4(), _gpS = new THREE.Vector3();
// #340 Twitch chat: read-only, anonymous, from the start (channel on the start page, default dirrogate). A floating panel
// (default left of the mixer, turned toward the DJ; grip / pinch moves it) and the tablet CHAT page show it.
// #377 the CHAT PANEL and the CHALKBOARD are two separate objects (they used to be one panel that flipped into a slate, so they shared a spot and
// could not be out together). The panel starts left of the mixer, the chalkboard right of it (mirrored). A chalkboard saved by the old single
// panel moves over to the chalkboard, so it stays where it was; the panel then starts from its own spot.
try { const raw = localStorage.getItem('vire.chatPanel'), o = raw && JSON.parse(raw); if (o && o.board && !localStorage.getItem('vire.chalkboard')) { localStorage.setItem('vire.chalkboard', raw); localStorage.removeItem('vire.chatPanel'); } } catch {}
const chalkboard = CAMERA_ROLE ? null : new WhiteBoard(rig, () => ({ p: new THREE.Vector3(mixer.position.x + 0.75, deckGroups[0].position.y + DECK.H + 0.38, mixer.position.z + 0.05), yaw: -0.94 }), { key: 'vire.chalkboard', boardOnly: true, name: 'chalkboard' });
const boardTools = chalkboard ? makeBoardTools(chalkboard, rig) : null;   // #395 three magnetic markers and the duster
const chatPanel = CAMERA_ROLE ? null : new ChatPanel(rig, () => ({ p: new THREE.Vector3(mixer.position.x - 0.75, deckGroups[0].position.y + DECK.H + 0.38, mixer.position.z + 0.05), yaw: 0.94 }));
let chatDrawPend = false, chatPanelTapT = 0, chalkWipeT = 0;
function chatRedraw() {   // at most ~5 redraws a second
  if (chatDrawPend) return; chatDrawPend = true;
  setTimeout(() => { chatDrawPend = false; if (chatPanel && chatPanel.on) chatPanel.draw(chat, chatRedraw); if (toolsPage === 'chat') drawMixScreen(); }, 200);
}
const chat = CAMERA_ROLE ? null : new TwitchChat(() => chatRedraw());
if (chat && chatChannel.get()) chat.start();
// #342 CHALKBOARD on the TOOLS home page: tap = board out / away (the panel goes back to chat mode, hidden); double-tap =
// board back to its start spot and size
let chalkTapT = 0;
const chalkLbl = () => chalkboard && chalkboard.on ? 'WHITEBOARD: ON' : 'WHITEBOARD';   // #395
function openPhoneCam() {   // #389 from VJ TOOLS and SHOWTIME! OBJECTS: pick PHONE CAM and open its setup page (says why when the phone isn't there)
  const S = streamer; if (!S) { toast('Streaming runs on the headset', 2500); return; }
  if (S.stu.on) { toast('S8 STUDIO is on: use LIVE DJ! or LIVE KEY! on the S8 STUDIO page', 3500); return; }
  const why = pcamReady(); if (why) { toast(why, 3500); return; }
  S.setSource('pcam'); setTools('pcam');
}
function chalkTap() {   // #377 the chalkboard object: tap = out / away; double-tap = back to its start spot and size, out
  if (!chalkboard) return; const now = performance.now();
  if (now - chalkTapT < 350) { chalkTapT = 0; chalkboard.reset(); chalkboard.setOn(true); chalkboard.save(); drawMixScreen(); return; }
  chalkTapT = now; chalkboard.setOn(!chalkboard.on);
  chalkboard.save(); drawMixScreen();
}
function chatPanelTap() {   // tap = panel on / off; double-tap = back to its start spot, on
  if (!chatPanel) return; const now = performance.now();
  if (now - chatPanelTapT < 350) { chatPanelTapT = 0; chatPanel.reset(); chatPanel.setOn(true); }
  else { chatPanelTapT = now; chatPanel.setOn(!chatPanel.on); }
  if (chatPanel.on) chatPanel.draw(chat, chatRedraw); drawMixScreen();
}
if (chatPanel && chatPanel.on) chatPanel.draw(chat, chatRedraw);
// #345 FACETWALL + PORTAL: a faceted backdrop standing beyond the DJ booth (fractal or whatever VIDEOWALL is playing),
// hiding the real room from the passthrough camera, with a real-world window (PORTAL) cut into it -- park that over
// the owner's own floor mirror so the stream still shows him, through the backdrop. Forward-facing only: it does not
// wrap behind the DJ, so turning around still shows the real wall/sofa beyond it (chalkboard / chat territory).
// #346 (owner): PORTALS = up to 6 frames, each any rectangle; PORTALS SETUP (STREAM page) sets the wall (wrap up to 360
// deg round the DJ, height, distance, fractal speed / colour cycle, BEAT), how many frames, and the sky DOME.
const facetWall = CAMERA_ROLE ? null : new FacetWall(rig, renderer, () => ({ p: new THREE.Vector3(mixer.position.x, 0, mixer.position.z + 0.3), yaw: 0 }));   // arc centre by the DJ, panels out in front (the DJ faces -z)
const portals = CAMERA_ROLE ? null : new Portals(rig, i => {   // frame i's start spot, 25 cm in front of the wall: the first in the middle (over the mirror), then 28 deg right, left, right...
  const o = facetWall && facetWall.obj, rr = (facetWall ? facetWall.val('r') : 1.85) - 0.25, a = (i ? (i % 2 ? 1 : -1) * Math.ceil(i / 2) : 0) * 28 * Math.PI / 180;
  const yaw0 = o ? new THREE.Euler().setFromQuaternion(o.quaternion, 'YXZ').y : 0, bx = o ? o.position.x : mixer.position.x, bz = o ? o.position.z : mixer.position.z + 0.3;
  const p = new THREE.Vector3(Math.sin(a) * rr, deckGroups[0].position.y + DECK.H + 0.1, -Math.cos(a) * rr).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw0);
  return { p: p.add(new THREE.Vector3(bx, 0, bz)), yaw: yaw0 - a };
});
if (portals) { if (facetWall) portals.cutInto(facetWall.obj); portals.cutInto(skybox.group); }   // the windows punch through the backdrop and the dome; cutInto() again for any future glb room
let wallTapT = 0, portalTapT = 0, portalDefArm = 0, beat = null, domeBoot = true;
const _laserCam = new THREE.Vector3();   // #406
function wallTap() {   // tap = backdrop on / off; double-tap = back to its start spot and mode
  if (!facetWall) return; const now = performance.now();
  if (now - wallTapT < 350) { wallTapT = 0; facetWall.reset(); facetWall.setOn(true); toast('Backdrop back at the start', 1500); drawMixScreen(); return; }
  wallTapT = now; facetWall.setOn(!facetWall.on); drawMixScreen();
}
function portalsTap() {   // tap = every frame on / off; double-tap = every frame back to its start spot (and size), on
  if (!portals) return; const now = performance.now();
  if (now - portalTapT < 350) { portalTapT = 0; portals.reset(); portals.setOn(true); toast('Portals back at the start', 1500); drawMixScreen(); return; }
  portalTapT = now; portals.setOn(!portals.on); drawMixScreen();
}
function saveDome() { try { localStorage.setItem('vire.dome', JSON.stringify(dome)); } catch {} try { syncShowFromRoom(); } catch {} }   // #401
async function setDome(on) {   // the sky picked on VISUALS (PANO > SKY) as a dome round the booth; loads it if it isn't yet
  dome.on = !!on; saveDome();
  if (dome.on && !skybox.tex) { try { await ensureSky(true); } catch (e) { console.warn('dome sky', e); } }
  applySky(); drawMixScreen();
}
function setDomeTurn(a) { dome.turn = clamp(Math.round(a), 0, 359); saveDome(); applySkyTurn(); drawMixScreen(); }   // #389 PORTALS SETUP > DOME TURN
function setDomeEv(ev) { dome.ev = Math.min(1, Math.max(-3, Math.round(ev * 4) / 4)); saveDome(); skybox.setExposure(dome.ev); drawMixScreen(); }   // #404
skybox.setExposure(dome.ev);
function setDomeSize(r) { dome.r = Math.min(20, Math.max(3, Math.round(r))); saveDome(); applySky(); }
function portalDefaults() {   // two taps: wall shape, fractal speed / colour cycle and dome size back to their defaults
  if (performance.now() - portalDefArm < 3000) {
    portalDefArm = 0; if (facetWall) for (const k of Object.keys(WALL_DEF)) facetWall.set(k, WALL_DEF[k]);
    setDomeSize(10); toast('Wall and dome back to their default shape', 1500);
  } else { portalDefArm = performance.now(); setTimeout(drawMixScreen, 3100); }
  drawMixScreen();
}
function saveLayout() { stage.save(); }
// #84 migration: layouts saved with the second flight case had the record crate standing on it; with that case
// gone, put the crate on the floor (once) instead of leaving it floating
try { const L = JSON.parse(localStorage.getItem('vire.layout2')); if (L && L.cases && L.cases.caseB) { const c = L.cases.caseB, p = crateRig.position; if (Math.abs(p.y - (c[1] + c[6])) < 0.04) p.y = 0; stage.save(); } } catch (e) {}
function saveMilkKeys() { try { localStorage.setItem('vire.milkKeys', JSON.stringify(Object.keys(extraMilk))); } catch (e) {} }
function spawnMilk(side = false) {   // #394 side: to one side of the record crate first (the playlist crate)
  const free = ['milk2', 'milk3', 'milk4', 'milk5', 'milk6'].find(k => !extraMilk[k]);
  if (!free) { toast(`That's the lot: ${MILK_MAX} milk crates`); return null; }
  const m = newMilk(free); stage.items[free] = { obj: m, base: 0 };
  m.userData.label.clear();   // a fresh crate: a blank label (the key may have been used by a crate tossed away)
  forgetMilkSleeves(free); m.userData.sleeved = [];   // #398 and an empty row
  placeMilk(m, side);   // on the floor near the record crate
  m.scale.setScalar(0.01); m.userData.pop = 0;   // grows in over ~0.25 s (stepMilkCrates)
  saveMilkKeys(); stage.save(); toast('Milk crate added. Toss it away to remove it');
  return m;
}
function removeMilk(key) {
  const m = extraMilk[key]; if (!m) return;
  for (let i = loose.length - 1; i >= 0; i--) if (loose[i].milk === m) { loose[i].rec.dispose(); loose.splice(i, 1); }   // its records go back to the library
  if (m.userData.label) { m.userData.label.forget(); m.userData.label.dispose(); m.userData.label = null; }   // #394
  forgetMilkSleeves(key); m.userData.sleeved = [];   // #398 its sleeves go back to the library
  if (m.userData.coverPool) for (const cm of m.userData.coverPool) { cm.material.map.dispose(); cm.material.dispose(); }
  rig.remove(m); m.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
  delete extraMilk[key]; delete stage.items[key]; flyingMilk.delete(m);
  saveMilkKeys(); stage.save(); toast('Milk crate removed');
}
// let go of a moved milk crate. #207 (owner): no physics any more (#200's bounce and fall went through real furniture in
// passthrough). Let go, it stays where it is (settling onto a case / crate top within 6 cm, like the other gear).
// Tossed away (let go moving faster than 1.2 m/s): an extra crate shrinks away where it is and is deleted with its
// records; the first crate stays. On the desktop, dragged beyond 3 m from the decks an extra crate is deleted.
const flyingMilk = new Map();   // #207: crates shrinking away (name kept for xr.js / the record code)
function placeMilk(m, side = false) {   // first free spot on the floor round the record crate (front first; #394 side: left / right first), clear of the case and crates
  const c = crateRig, up = new THREE.Vector3(0, 1, 0), blockers = [cases.caseA.group, crateRig, ...milks().filter(x => x !== m)].map(o => new THREE.Box3().setFromObject(o).expandByScalar(0.03));
  m.rotation.set(0, c.rotation.y, 0); m.position.set(c.position.x, 0, c.position.z + 0.5);
  for (const r of [0.45, 0.85, 1.25]) for (const deg of side ? [90, -90, 45, -45, 135, -135, 0, 180] : [0, 45, -45, 90, -90, 135, -135, 180]) {
    const off = new THREE.Vector3(0, 0, r).applyAxisAngle(up, c.rotation.y + deg * Math.PI / 180);
    m.position.set(c.position.x + off.x, 0, c.position.z + off.z); m.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(m);
    if (!blockers.some(b => b.intersectsBox(bb))) return;
  }
}
function releaseMilk(key, vel) {
  const m = key === 'milk' ? milk : extraMilk[key]; if (!m) return;
  m.rotation.x = 0; m.rotation.z = 0;
  if (stage.items[key]) settleStack(key);
  if (key === 'milk') return;
  if ((vel && vel.length() > 1.2) || Math.hypot(m.position.x, m.position.z) > MILK_FAR) flyingMilk.set(m, { key, gone: 0 });
}
function stepMilkCrates(dt) {
  for (const m of milks()) if (m.userData.pop !== undefined) {
    m.userData.pop = Math.min(1, m.userData.pop + dt / 0.25); const k = m.userData.pop; m.scale.setScalar(Math.max(0.01, k * k * (3 - 2 * k)));
    if (k >= 1) delete m.userData.pop;
  }
  for (const [m, f] of flyingMilk) {   // tossed away: shrinks about its middle over 0.3 s, then it's deleted
    f.gone += dt; const k = Math.min(1, f.gone / 0.3), sc = Math.max(0.01, 1 - k * k * (3 - 2 * k));
    m.scale.setScalar(sc); m.position.y += MILK.H / 2 * (1 - sc) - (f.off || 0); f.off = MILK.H / 2 * (1 - sc);
    if (k >= 1) removeMilk(f.key);
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
// #467 a small note strip on the tablet, over whatever page is open, for a few seconds (toast() is a desktop-only overlay,
// invisible in the headset). Drawn at commit time, so every page gets it without each page knowing; cleared by a redraw.
const tabNote = { text: '', until: 0, t: 0 };
function tabletNote(text, ms = 5000) {
  tabNote.text = text; tabNote.until = performance.now() + ms; toast(text, ms);
  clearTimeout(tabNote.t); tabNote.t = setTimeout(() => { tabNote.text = ''; try { drawMixScreen(); } catch {} }, ms + 50);
  try { drawMixScreen(); } catch {}   // (the phone's camera role has no tablet to draw)
}
function drawTabNote(s) {
  const g = s.g, W = s.canvas.width, H = s.canvas.height, P = W < H;
  const fs = P ? 13 : 15, bh = fs + 14, y = Math.round(H * (P ? 0.5 : 0.62)) - bh / 2;
  g.save(); g.font = `600 ${fs}px system-ui, sans-serif`;
  let t = tabNote.text; const max = W - 40; while (t.length > 4 && g.measureText(t).width > max - 24) t = t.slice(0, -2);
  if (t !== tabNote.text) t = t.slice(0, -1) + '…';
  const bw = Math.min(max, g.measureText(t).width + 24), x = (W - bw) / 2;
  g.fillStyle = 'rgba(40, 26, 4, 0.92)'; g.strokeStyle = '#ffb020'; g.lineWidth = 1.5;
  g.beginPath(); g.roundRect ? g.roundRect(x, y, bw, bh, 7) : g.rect(x, y, bw, bh); g.fill(); g.stroke();
  g.fillStyle = '#ffd27a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, W / 2, y + bh / 2 + 1);
  g.restore();
}
for (const sc of [mixScreen, mixScreenP]) { const c0 = sc.commit.bind(sc); sc.commit = () => { if (tabNote.text && performance.now() < tabNote.until) drawTabNote(sc); c0(); }; }
// #467 a WebRTC handshake (spectator phone, DirroTV) had to go through ntfy.sh because our relay hub didn't carry it
onRelayFallback((what, how) => { tabletNote(`NTFY.SH FALLBACK · ${what}`, 6000); toast(`${what}: handshake ${how} via ntfy.sh (backup relay; relay.dirrodj.club hub not reached)`, 6000); });
const vpPer = () => (scrDir === 'up' ? 8 : vpFolder === 'Pano' ? 8 : 10);   // #379 portrait PANO: 4 rows, the PANO SPIN slider under them   // thumbnails a page on the Video page (#206 portrait: 5 rows, a third tab row)
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
// #209 PerfCap recorder (the spectator host feeds it the mirror messages)
const perf = makePerfCap({ toast: (m, ms) => toast(m, ms) });
setInterval(() => { if (perf.on && toolsPage === 'perfcap') drawMixScreen(); }, 1000);
async function perfToggle() {
  if (!spect) { toast('PerfCap needs Settings > Spectator camera On (it records what the phone would mirror)', 4000); return; }
  if (perf.on) await perf.stop(); else { await perf.start(); spect.perfBegin && spect.perfBegin(); }
  drawMixScreen();
}
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
// #331 LIVE STREAM: master bus (never CUE) + a picture source, straight to Twitch from the headset (stream.js)
streamer = CAMERA_ROLE ? null : new Streamer({
  engine, renderer, djcam, scene, camera,   // #333 scene / camera for the MR headset picture
  // #336 SHOW / VIDEOWALL
  avLayer: AV_LAYER, showCam: () => djcam && djcam.cam, scroller: () => scroller, chat: () => chat,   // #340
  showPrep: () => {   // #372 the SHOWTIME! 3D layer: each prop is in or out by its own toggle; no XR hands, nothing behind
    const undo = [], hide = o => { if (o && o.visible) { o.visible = false; undo.push(o); } }, O = streamer.showOpt;
    hide(room);
    if (spect && spect.helpers) spect.helpers.forEach(hide);   // #385 the blue camera outline and the calibration panel are for the headset, never in the picture
    if (!O.wall) hide(ledwall);   // the 3D wall (with the scroller on it) only when asked for; the flat backdrop is the 2D layer
    if (O.backdrop !== 'dome') hide(skybox.group);
    propHides(hide, O, true);
    if (xr) for (const st of xr.inputs) { hide(st.hand); hide(st.grip); hide(st.tipDot); hide(st.hitDot); hide(st.occS); hide(st.occC); hide(st.ray); if (st.ctlHand) hide(st.ctlHand.root); }
    if (xr && xr.glove) hide(xr.glove.root);
    const bg = scene.background; scene.background = null;
    return () => { for (const o of undo) o.visible = true; scene.background = bg; };
  },
  mrPrep: () => {   // #372 HEADSET CAM: you are the robot and the real room is the picture, so the robot and the 3D LED wall are out of this render only; the OBJECTS toggles decide the rest (and keep their values)
    const undo = [], hide = o => { if (o && o.visible) { o.visible = false; undo.push(o); } };
    hide(ledwall); if (avatar && avatar.root) hide(avatar.root);
    if (spect && spect.helpers) spect.helpers.forEach(hide);   // #385
    propHides(hide, streamer.showOpt, false); handsHides(hide, streamer.showOpt);   // #375
    return () => { for (const o of undo) o.visible = true; };
  },
  wallInShot: cam => {   // #372 is the 3D LED wall switched on, in front of this camera and facing it (its picture, and the scroller on it, are then drawn by the 3D layer)
    if (!ledwall.visible) return false;
    ledwall.updateWorldMatrix(true, false);
    _wsN.set(0, 0, 1).transformDirection(ledwall.matrixWorld); _wsP.setFromMatrixPosition(ledwall.matrixWorld);
    _wsC.setFromMatrixPosition(cam.matrixWorld);
    if (_wsN.dot(_wsC.sub(_wsP)) <= 0) return false;   // seen from behind: the screen faces away
    _wsM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _wsF.setFromProjectionMatrix(_wsM);
    return _wsF.intersectsBox(_wsB.setFromObject(ledwall));
  },
  wallSource: () => {   // what the LED wall is showing, as 2D drawables (the stream draws them full frame)
    // #338 what the VISUALS pages are playing, whatever the LED wall itself shows (AVACAM, off, switched off)
    if (ledMode === 'decks') { const [gA, gB] = deckGains(mixVal); return [{ el: deckVid[0].v, gain: gA }, { el: deckVid[1].v, gain: gB, add: true }]; }
    if (isLive(ledMode) || ledMode === 'screen') return [{ el: liveVideo }];   // #358 the phone's screen too
    if (isFxMode(ledMode)) return [{ el: fxBig }];   // #439 MANDEL / RETRO-SCENE, with the LED grid
    if (ledMode === 'clips' && led.video) return [{ el: led.video }];
    if (ledMode === 'clips' && led.img && ledwall.userData.curImage && !led.silent) return [{ el: ledwall.userData.curImage, flip: true }];
    return streamClip();   // #337 the stream decodes the clip itself (follows the playlist, or runs the LED LIST on its own)
  },
  phoneTrack: () => (livePossible() ? liveTrack : null),
  phoneLive: (on, o = {}) => {   // #347 o: PHONE CAM { pcam, green }
    if (!spect || !spect.liveCam) return;
    if (on) { if (o.pcam || !isLive(ledMode)) spect.liveCam(true, !o.pcam && ledMode === 'solo', o); }
    else if (isLive(ledMode)) spect.liveCam(true, ledMode === 'solo'); else spect.liveCam(false);
  },
  // #347 PHONE CAM
  rig, phoneVideo: () => (livePossible() ? liveVideo : null), phoneCam: () => (spect ? spect.phoneCam : null), skyGroup: () => skybox.group,
  lightInfo: () => {
    const kd = key.position.clone().sub(key.target.position).normalize().applyQuaternion(rig.getWorldQuaternion(new THREE.Quaternion()));
    const sk = skyKeyLight && streamer && streamer.pc_.light ? skyKeyLight : null;
    if (sk) kd.copy(sk.dir).applyAxisAngle(_yAxis, settings.skyTurn * DEG + skySpin.ang).applyQuaternion(rig.getWorldQuaternion(new THREE.Quaternion())).normalize();
    return { keyDir: kd, keyCol: sk ? [sk.color.r, sk.color.g, sk.color.b] : [key.color.r, key.color.g, key.color.b], pano: skyAvg, skyReady: !!skybox.tex };
  },
  pcamPrep: cam => pcamPrep(cam),
  studio: () => (spect && spect.studio) || null,   // #380 S8 STUDIO: the spectator link's studio slots
  ledClip: () => (ledMode === 'clips' && led.on && led.name && led.video ? led.name : ''),   // #380 the LED clip the S8 can play from its own copy
  monitorOn: () => monOn,   // #376 the venue screen keeps the shot running unless PREVIEW wants it   // #374 the phone camera, for the 'behind the DJ' rule
  movers: () => pcamMovers(),
  nowPlaying: () => {
    const on = decks.filter(d => d.track && engine.state.decks[d.i] && engine.state.decks[d.i].needle && Math.abs(engine.state.decks[d.i].rate) > 0.2);
    const name = t => (t.artist ? t.artist + ' – ' : '') + (t.title || t.name || '');
    const loud = d => (mixVal[(d.i ? 'B' : 'A') + '.fader'] || 0) * (d.i ? Math.min(1, 1 + mixVal.xfader) : Math.min(1, 1 - mixVal.xfader));   // fader x crossfader side
    on.sort((a, b) => loud(a) - loud(b));
    const top = on[on.length - 1]; let bpm = 0; try { bpm = top ? Math.round(bpmOf(top.track) * 10) / 10 : 0; } catch {}
    return { a: top ? name(top.track) : '', b: on.length > 1 ? name(on[0].track) : '', bpm };
  },
  onChange: () => { if (toolsPage === 'stream' || !streamer || streamer.state !== streamOnChangeLast) { streamOnChangeLast = streamer && streamer.state; drawMixScreen(); } },
});
// #401 (owner) one switch per object, on every page: SHOWTIME! OBJECTS no longer has its own stream-only copies of DOME,
// WHITEBOARD, CHAT PANEL and NEON. Those buttons switch the object itself (in the room, for the DJ and every camera), and
// the room switches (VJ TOOLS, PORTALS SETUP, the TOOLS page...) light up the SHOWTIME! buttons. The stream backdrop DOME is
// the dome: picking BACK: DOME switches the dome on, any other backdrop switches it off, and switching the dome on anywhere
// makes it the backdrop. #402: LED WALL joins (flat VISUALS only while the wall is off), and the GoPros are one camera
// choice everywhere (see goproTap / the setSource wrap). Still stream-only: GEAR and ROBO-BODY.
const SHOW_LINK = {
  chalk: { get: () => !!(chalkboard && chalkboard.on), set: v => { if (chalkboard) { chalkboard.setOn(v); chalkboard.save(); } } },
  panel: { get: () => !!(chatPanel && chatPanel.on), set: v => { if (chatPanel) { chatPanel.setOn(v); chatPanel.save(); } } },
  neon: { get: () => pieceOn('neon'), set: v => setPiece('neon', v) },
  wall: { get: () => pieceOn('ledwall'), set: v => setPiece('ledwall', v) },   // #402 the LED wall: on = the 3D wall is in the SHOWTIME! shot and the flat VISUALS backdrop steps aside
};
if (streamer) {
  const rawSet = streamer.setShowOpt.bind(streamer);
  streamer._rawShowOpt = rawSet;
  streamer.setShowOpt = (k, v) => {
    if (SHOW_LINK[k]) { SHOW_LINK[k].set(!!v); rawSet(k, SHOW_LINK[k].get()); return; }
    if (k === 'backdrop') {
      rawSet(k, v);
      if (v === 'dome' && !dome.on) setDome(true);
      else if (v !== 'dome' && dome.on) setDome(false);
      return;
    }
    rawSet(k, v);
  };
  const rawSource = streamer.setSource.bind(streamer);
  streamer.setSource = async (src, ...a) => {   // #402 one camera choice: HEADSET CAM / PHONE CAM put the GoPro away (FRONT), so no page shows GOPRO: ON while it isn't the shot
    const r = await rawSource(src, ...a);
    if ((src === 'headset' || src === 'pcam') && (djSet.preset === 'gopro' || djSet.preset === 'gopro2')) setDjPreset('front');
    return r;
  };
}
function syncShowFromRoom() {   // the room's switches into SHOWTIME! (only writes when something differs)
  if (!streamer || !streamer._rawShowOpt) return;
  const O = streamer.showOpt, raw = streamer._rawShowOpt;
  for (const k of Object.keys(SHOW_LINK)) { const v = SHOW_LINK[k].get(); if (O[k] !== v) raw(k, v); }
  if (dome.on && O.backdrop !== 'dome') raw('backdrop', 'dome');
  else if (!dome.on && O.backdrop === 'dome') raw('backdrop', 'visuals');
}
let streamOnChangeLast = 'off';
const _wsN = new THREE.Vector3(), _wsP = new THREE.Vector3(), _wsC = new THREE.Vector3(), _wsM = new THREE.Matrix4(), _wsF = new THREE.Frustum(), _wsB = new THREE.Box3();   // #372 wallInShot scratch
// #347 PHONE CAM render: what the phone's camera must not see (room, sky, helpers, the GoPro), plus the forearm sleeves
// and, with LIGHT MATCH and a panorama, the key light from the panorama's brightest area (as Full VR does)
const _yAxis = new THREE.Vector3(0, 1, 0);
const armSleeves = CAMERA_ROLE ? null : makeSleeves(); if (armSleeves) scene.add(armSleeves.group);
function propHides(hide, O, ownCam) {   // #372 the object toggles (OBJECTS page), one list for every camera: gear, neon, GoPro prop, chat panel / chalkboard, scroller
  if (!O.neon) hide(neon);   // on = seen from every angle, the back of the sign too
  for (const gp of [gopro, gopro2]) if (gp && (!O.gopro || (ownCam && gp.on))) hide(gp.obj);   // a prop other cameras film; hidden only from its own camera
  if (chatPanel && !O.panel) hide(chatPanel.obj);   // #377 two objects, two toggles
  if (chalkboard && !O.chalk) hide(chalkboard.obj);
  if (!O.scroll) hide(scroller.mesh);
  if (!O.gear) {
    hide(deckGroups[0]); hide(deckGroups[1]);
    if (deckInst) for (const p of deckInst.pairs) hide(p.im);
    hide(mixer); hide(crateRig); hide(cases.caseA.group);
    for (const m of milks()) hide(m);
    for (const l of loose) hide(l.rec.group);
    if (held) hide(held.group);
  }
}
// #374 PHONE CAM (CLAUDE.md #374): the phone's picture is flat video, so the 3D layer (gear, props) is drawn ON TOP of the keyed DJ with no
// depth: a prop standing behind the DJ would paint over his head. So in this shot a prop is left out when it is farther from the phone
// than the DJ's head (the headset's position), with 15 cm to turn it off and 5 cm to bring it back, so it can't flicker at the edge.
const _bdV = new THREE.Vector3(), _bdH = new THREE.Vector3(), _bdB = new THREE.Box3(), _bdState = new WeakMap();
function behindDj(o, cam) {
  if (!o || !o.visible || !cam || !renderer.xr.isPresenting) return false;   // needs the headset (the DJ's head); off the headset nothing is left out
  _bdB.setFromObject(o); if (_bdB.isEmpty()) return false;
  camera.updateWorldMatrix(true, false);
  _bdB.getCenter(_bdV).applyMatrix4(cam.matrixWorldInverse); camera.getWorldPosition(_bdH).applyMatrix4(cam.matrixWorldInverse);
  const od = -_bdV.z, hd = -_bdH.z, was = _bdState.get(o) || false, behind = was ? od > hd - 0.05 : od > hd + 0.15;
  _bdState.set(o, behind); return behind;
}
// why PHONE CAM can't start yet ('' = the phone is connected); the finer states (fixed camera, calibrated) are in pcamStatus
function pcamReady() {
  const cs = spect && spect.cam;
  return !spect ? 'Spectator camera is off: Settings > Spectator camera On, connect the phone.' : !cs ? 'Phone not connected: open the DirroDJ camera page on it.' : '';
}
function pcamStatus(S) {   // #374 shared by the PHONE CAM page and the SHOWTIME! OBJECTS block
  const C = S.pc_, cs = spect && spect.cam, pc6 = spect && spect.phoneCam, lat = S.delay != null ? Math.round(S.delay) : null;
  const v = livePossible() ? liveVideo : null, packed = v && v.videoWidth && Math.abs(v.videoWidth / v.videoHeight - 1920 / 720) < 0.06;
  return [
    !spect ? 'Spectator camera is off: Settings > Spectator camera On, connect the phone.' : !cs ? 'Phone not connected.' : !cs.fixed ? 'Phone is in AR mode: start it in Fixed camera (tripod) mode.' : !pc6 ? 'Phone not calibrated: Calibrate on the phone (or NUDGE > CALIBRATE).' : `Phone fixed camera, calibrated${cs.fpx != null ? ' ' + cs.fpx + ' px' : ''}.`,
    S.source !== 'pcam' ? 'Pick PHONE CAM in SHOWTIME! (STREAM > OBJECTS) to use it.' : v && v.videoWidth ? `Video ${v.videoWidth} x ${v.videoHeight}${packed ? ' (colour + matte)' : ''}${S.pkMsg ? ' · ' + S.pkMsg : ''}` : 'Waiting for the phone video (the preview starts it).',
    lat != null ? `Video ${lat} ms late (measured)${C.lat ? ', gear, hands and stream sound held back ' + Math.round(S.latMs) + ' ms' : ''}.` : `Delay not measured: LATENCY MATCH uses ${C.manual} ms.`,
  ];
}
// #375 HANDS on the HEADSET CAM / PHONE CAM shots: REAL HANDS leaves your own hands bare in that picture (the drawn 3D hands, the robot glove
// and the forearm sleeves are left out of that render only; the headset keeps its look). 3D HANDS / ROBOT GLOVE are the controller look
// (xr.setCtlLook), shared with the headset. Same hide list as the DJ camera uses for the same objects.
function handsHides(hide, O, force) {   // force: PHONE CAM always shows your own hands (#377)
  if (!(force || (O && O.handsReal)) || !xr) return;
  for (const st of xr.inputs) { hide(st.hand); hide(st.grip); if (st.ctlHand) hide(st.ctlHand.root); }
  if (xr.glove) hide(xr.glove.root);
}
const tvLbl = S => S.stu.on ? (S.stuRun ? 'S8 STUDIO: ON' : 'S8 STUDIO') : S.tvUp ? 'DIRROTV: ON' : 'DIRROTV';   // #380 the STREAM page's screen button
let tvDigits = '', tvForgetArm = 0;   // #376 the code being typed on the tablet; double-tap guard for FORGET TV
let pcamAutoReh = false;   // #374 the PHONE CAM page started the off-air shot for its preview (so leaving the page stops it again)
function pcamPrep(cam) {
  const undo = [], hide = o => { if (o && o.visible) { o.visible = false; undo.push(o); } };
  hide(room); hide(skybox.group); hide(skyShadow);
  hide(ledwall);   // #374 never in this shot: it would paint over the DJ (its picture is the VISUALS backdrop anyway)
  if (streamer) {   // #372 PHONE CAM: the phone's picture with the objects chosen on OBJECTS drawn over it
    propHides(hide, streamer.showOpt, false); handsHides(hide, streamer.showOpt, true);   // #377 PHONE CAM: natural hands, nothing drawn on them (3D / robot hands were too hard to line up)
    for (const o of [neon, chatPanel && chatPanel.obj, chalkboard && chalkboard.obj, gopro && gopro.obj, gopro2 && gopro2.obj]) if (behindDj(o, cam)) hide(o);   // #374 props behind the DJ are left out
  }
  if (spect && spect.helpers) spect.helpers.forEach(hide);
  if (avatar && avatar.root) hide(avatar.root);   // #385 the real DJ is in this picture
  if (xr) for (const st of xr.inputs) { hide(st.tipDot); hide(st.hitDot); hide(st.occS); hide(st.occC); hide(st.ray); }
  const bg = scene.background; scene.background = null;
  if (armSleeves) armSleeves.group.visible = false;   // #377 natural hands: no sleeves either
  const kp = key.position.clone(), kc = key.color.clone();
  if (streamer.pc_.light && skyKeyLight) {
    const d = skyKeyLight.dir.clone().applyAxisAngle(_yAxis, settings.skyTurn * DEG + skySpin.ang), hz = Math.hypot(d.x, d.z) || 1, up = Math.max(d.y, Math.sin(35 * DEG)), k = Math.sqrt(1 - up * up) / hz;
    key.position.set(d.x * k, up, d.z * k).multiplyScalar(2.7).add(key.target.position); key.color.setRGB(1, 1, 1).lerp(skyKeyLight.color, 0.5);
  }
  return () => { for (const o of undo) o.visible = true; scene.background = bg; if (armSleeves) armSleeves.group.visible = false; key.position.copy(kp); key.color.copy(kc); };
}
function pcamMovers() {   // LATENCY MATCH: everything that follows the hands (joints, grips, drawn hands / glove, sleeves)
  const out = [], add = o => { if (o) o.traverse(n => out.push(n)); };
  if (xr) { for (const st of xr.inputs) { add(st.grip); add(st.hand); if (st.ctlHand) add(st.ctlHand.root); } if (xr.glove) add(xr.glove.root); }
  if (armSleeves) armSleeves.tubes.forEach(t => out.push(t));
  return out;
}
function stepArmSleeves() {   // posed every frame while PHONE CAM runs (so LATENCY MATCH has their history), drawn only in its render
  if (!armSleeves || !streamer || !streamer.active || streamer.source !== 'pcam') return;
  const xrOn = renderer.xr.isPresenting;
  armSleeves.update(xrOn ? xrPose(renderer, xr && xr.inputs) : demoPose(rig, djGear(), (performance.now() - _djT0) / 1000));
}
// #337 the stream's own copy of the LED playlist's current clip (used while the LED wall is switched off and so not
// decoding): same file, kept within 0.5 s of the playlist clock; closed 3 s after the stream stops asking for it
const sclip = { name: null, el: null, url: null, img: false, used: 0 };
function streamClip() {
  sclip.used = performance.now();
  // the LED playlist running (wall on CLIPS, or switched off): follow it; else (wall on AVACAM / OFF) run the LED LIST itself
  const follow = !!(led.on && led.name);
  if (!follow && !led.files.length) return [];
  if (!follow && (!sclip.own || !led.files.some(f => f.name === sclip.ownName))) { sclip.own = true; sclip.ownI = 0; sclip.ownName = led.files[0].name; sclip.ownT = performance.now(); }
  if (follow) sclip.own = false;
  const name = follow ? led.name : sclip.ownName;
  if (sclip.name !== name) {
    closeStreamClip(); const f = led.fileNamed(name); if (!f) return [];
    sclip.name = name; sclip.img = !!led.img;
    if (sclip.img) createImageBitmap(f).then(b => { if (sclip.name === name) sclip.el = b; else b.close(); }).catch(() => {});
    else {
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.loop = true; v.preload = 'auto';
      sclip.url = URL.createObjectURL(f); v.src = sclip.url; sclip.el = v;
      v.loop = follow || led.files.length < 2;   // running the list itself: next clip at the end (one clip: loop it)
      v.addEventListener('loadedmetadata', () => { try { v.currentTime = follow ? led.state().t || 0 : 0; } catch (e) {} v.play().catch(() => {}); }, { once: true });
      if (!follow) v.addEventListener('ended', streamClipNext);
    }
    sclip.ownT = performance.now();
  }
  const v = sclip.el;
  if (follow && v && !sclip.img && v.readyState >= 1) { const t = led.state().t; if (t != null && Math.abs(v.currentTime - t) > 0.5) v.currentTime = t; if (v.paused) v.play().catch(() => {}); }
  if (!follow && sclip.img && performance.now() - sclip.ownT > 8000) streamClipNext();   // images 8 s each, like the playlist
  return v ? [{ el: v }] : [];
}
function streamClipNext() {   // own runner: the next item of the LED LIST
  if (!led.files.length) return; sclip.ownI = (sclip.ownI + 1) % led.files.length; sclip.ownName = led.files[sclip.ownI].name; sclip.ownT = performance.now();
}
function closeStreamClip() {
  const e = sclip.el; if (e) { if (sclip.img) { try { e.close(); } catch (er) {} } else { e.pause(); e.removeAttribute('src'); e.load(); } }
  if (sclip.url) URL.revokeObjectURL(sclip.url);
  sclip.name = sclip.el = sclip.url = null; sclip.img = false;
}
setInterval(() => { if (sclip.name && performance.now() - sclip.used > 3000) closeStreamClip(); }, 1000);
let lib = null;
const decks = [0, 1].map(i => ({
  i, name: DECK_NAMES[i], g: deckGroups[i], record: null, side: null, track: null, duration: 0,
  loaded: false, loading: false, motorOn: false, power: true, speed: 1, pitch: 0, range: (settings.pitchRange && settings.pitchRange[i]) || 0.08, platterAngle: 0, recAngle: 0, angleOffset: 0,
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
  master: 0.8, xfader: 0, 'mic.gain': 0.5, 'mic.pitch': 0.5, hpmix: 0.5, 'loop.vol': 0.8,   // #334 🎧 MIX (centre = cue + master both full)   // LOOPER: 0.8 = the loop at the level it was sampled
};
const mixVal = { ...MIXDEF };

function applyMix(id) {
  if (!engine.ctx) return;
  const v = mixVal[id];
  if (id === 'master') return engine.setMaster(v);
  if (id === 'xfader') return engine.setCrossfader(v);
  if (id === 'mic.gain') return engine.setMicGain(v);
  if (id === 'mic.pitch') return engine.setMicPitch(v);
  if (id === 'hpmix') return engine.setHpMix(v);   // #334
  if (id === 'loop.vol') return engine.setLoopVol(v);   // LOOPER
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
      return v < 0.5 ? `Mic level ${engine.micGainOf(v) <= 0 ? 'off' : (20 * Math.log10(engine.micGainOf(v)) >= 0 ? '+' : '') + (20 * Math.log10(engine.micGainOf(v))).toFixed(1) + ' dB'}` : `Mic full (+20 dB), music ducks ${engine.micDuckDb(v).toFixed(0)} dB while MIC is on`;   // #334
    case 'pitch': if (settings.micRoute !== 'app') return 'Voice pitch: only with Mic route "Through the mixer"';
    { const st = engine.micSemitones(v); return `Mic pitch ${st === 0 ? '0' : (st > 0 ? '+' : '') + st.toFixed(1)} semitones`; }
    case 'hpmix': return `Headphones ${v < 0.03 ? 'cue only' : v > 0.97 ? 'master only' : Math.abs(v - 0.5) < 0.03 ? 'cue + master' : v < 0.5 ? 'more cue' : 'more master'} (stream untouched)`;   // #334
    case 'vol': return `Loop volume ${v < 0.01 ? 'off' : Math.round(20 * Math.log10(Math.pow(v / 0.8, 2) + 1e-9)) + ' dB'} (the loop then goes through that channel's EQ and filter)`;   // LOOPER
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
// #231 more pictures from the tag: the centre label (ID3 picture type 6, Media) and the back cover (type 4)
const labelArt = new Map();  // track id -> ImageBitmap (only when the file has a Media picture)
const backBlobs = new Map(); // track id -> Blob (only when the file has a Back cover)
const labelArtB = new Map(); // #232 track id -> the B label kept inside that (A side's) file
async function keepExtraPics(track, tag) {
  if (tag.media) { try { labelArt.set(track.id, await createImageBitmap(tag.media)); } catch {} }
  if (tag.mediaB) { try { labelArtB.set(track.id, await createImageBitmap(tag.mediaB)); } catch {} }
  if (tag.back) backBlobs.set(track.id, tag.back);
}
const labelOf = t => (t && (labelArt.get(t.id) || artCache.get(t.id))) || null;   // label: Media picture, else the cover

function currentList() {
  if (CAMERA_ROLE) return remoteCrate ? remoteCrate.list : [];   // #218 the phone shows the Quest's crate view
  return search.results ? search.results : lib ? lib.playlists[crateState.pl].records : [];
}
// ---- #218 the record crate on the spectator phone: real sleeve covers, the picked record and the lid screen.
// The Quest sends a small 'crate' message whenever its crate view changes (the tracks in the visible slots, the
// pick, lid open / shut) and the lid screen as a small JPEG when it changes; the phone runs the same layoutSleeves /
// assignCovers / drawCrateDiscLabel on it. Covers travel once per track (256 px JPEG, on request) and the phone keeps
// them in its own storage ('vire-covers/<key>.jpg'), so after a set or a PREP COVERS (SYNC tab) they are local.
// key = hash of title | artist | duration: stable even if the library is re-imported with new ids.
let remoteCrate = null;
const coverTracks = new Map();   // Quest: key -> track (for the phone's cover requests)
function coverKey(t) { let h = 2166136261; for (const ch of (t.title || '') + '|' + (t.artist || '') + '|' + Math.round(t.duration || 0)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return 'c' + h.toString(36); }
function crateView(list, start, n, shut) {   // Quest: what the phone needs to lay out the same sleeves
  const items = [];
  for (let k = 0; k < n; k++) {
    const r = list[start + k]; if (!r) continue;
    const t = r.sides.A || r.sides.B, key = t ? coverKey(t) : '';
    if (t && key) coverTracks.set(key, t);
    items.push([start + k, key, r.title || '', r.artist || '', r.bpm ? +(+r.bpm).toFixed(1) : 0, r.missing ? 1 : 0, r.size === 7 ? 7 : 12]);   // #262 size
  }
  return { k: 'crate', n: list.length, sel: crateState.sel, shut: shut ? 1 : 0, items };
}
async function coverFor(key) {   // Quest: the cover of a track by key, as stored in the MP3 (null = none)
  const t = coverTracks.get(key); if (!t) return null;
  await fetchArt(t); return artBlobs.get(t.id) || null;
}
// phone side
const phoneCovers = { ask: null, waits: new Map(), dir: null };
async function coverDir() { if (!phoneCovers.dir) phoneCovers.dir = (await navigator.storage.getDirectory()).getDirectoryHandle('vire-covers', { create: true }); return phoneCovers.dir; }
async function coverHave(keys) { const d = await coverDir(), have = []; for (const k of keys) { try { await d.getFileHandle(k + '.jpg'); have.push(k); } catch {} } return have; }
function phoneArt(track) {   // camera role: fetchArt from the phone's cover store, else ask the Quest
  const key = track.id;
  if (artCache.has(key)) return Promise.resolve(artCache.get(key));
  if (artPending.has(key)) return artPending.get(key);
  const p = (async () => {
    let art = null;
    try { const f = await (await (await coverDir()).getFileHandle(key + '.jpg')).getFile(); art = await createImageBitmap(f); }
    catch {
      if (!phoneCovers.ask) { artPending.delete(key); return null; }   // not cached yet, and no Quest: try again later
      art = await new Promise(res => { phoneCovers.waits.set(key, res); phoneCovers.ask(key); setTimeout(() => { if (phoneCovers.waits.get(key) === res) { phoneCovers.waits.delete(key); res(undefined); } }, 15000); });
      if (art === undefined) { artPending.delete(key); return null; }   // timed out: not cached, asked again next time
    }
    artCache.set(key, art); artPending.delete(key); return art;
  })();
  artPending.set(key, p); return p;
}
const crateRemote = {   // handed to spectator-client.js (camera role)
  setAsk(fn) { phoneCovers.ask = fn; },
  spiders(a) { spidersApply(a); },   // #262
  onCrate(m) {
    const list = new Array(m.n);
    for (const [i, key, title, artist, bpm, missing, size] of m.items) list[i] = { title, artist, bpm, missing: !!missing, size: size === 7 ? 7 : 12, sides: { A: { id: key || 'none', missing: !key }, B: null } };
    remoteCrate = { list, shut: !!m.shut }; crateState.sel = Math.min(m.sel, Math.max(0, m.n - 1));
    layoutSleeves();
  },
  async onScreen(m) {   // the lid screen as the Quest draws it
    try {
      const bm = await createImageBitmap(new Blob([Uint8Array.from(atob(m.img), c => c.charCodeAt(0))], { type: 'image/jpeg' }));
      const { g, canvas: c } = crateScreen; g.drawImage(bm, 0, 0, c.width, c.height); bm.close(); crateScreen.commit();
    } catch {}
  },
  async onCover(m) {   // a cover from the Quest: keep it, and draw it wherever it is waiting
    let art = null;
    if (m.img) {
      const blob = new Blob([Uint8Array.from(atob(m.img), c => c.charCodeAt(0))], { type: 'image/jpeg' });
      try { const w = await (await (await coverDir()).getFileHandle(m.key + '.jpg', { create: true })).createWritable(); await w.write(blob); await w.close(); } catch {}
      try { art = await createImageBitmap(blob); } catch {}
    }
    const res = phoneCovers.waits.get(m.key);
    if (res) { phoneCovers.waits.delete(m.key); res(art); }
    else if (art && !artCache.get(m.key)) { artCache.set(m.key, art); if (remoteCrate) layoutSleeves(); }
  },
  coverHave,
};

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
  if (k === 'DONE') { search.kb = false; search.target = null; drawCrateScreen(); return; }
  if (search.target === 'plname') {   // #392 typing the playlist's name
    let n = plNow.name || '';
    if (k === '⌫') n = n.slice(0, -1); else if (k === 'SPACE') n += ' '; else if (k === 'CLEAR') n = ''; else n += k;
    search.flash = { k, t: performance.now() }; setTimeout(drawCrateScreen, 150);
    plRename(n); return;
  }
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
searchInput.addEventListener('input', () => { if (search.target === 'plname') plRename(searchInput.value); else setQuery(searchInput.value); });   // #392
searchInput.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') searchInput.blur();
  if (e.key === 'Escape') { if (!searchInput.value) exitSearch(); searchInput.blur(); }
});
function openNativeKeyboard() {
  if (plMode()) search.target = 'plname';   // #392 on the PLAYLIST view the mic names the playlist
  const v = search.target === 'plname' ? (plNow.name || '') : search.q;
  searchInput.value = v;
  try { searchInput.focus({ preventScroll: true }); searchInput.setSelectionRange(v.length, v.length); } catch (e) {}
  const ok = document.activeElement === searchInput;
  if (!ok) { search.hint = performance.now() + 3000; drawCrateScreen(); setTimeout(drawCrateScreen, 3100); }
  return ok;
}
// XR: a trigger press or pinch at the mic button (a real user gesture, so the system keyboard may open)
function crateMicSelect(P) {
  if (sysKbPending) { sysKbPending = false; if (openSysKb()) return true; }   // #387 the tablet KEYBOARD page asked for the Meta keyboard; this trigger / pinch is the user gesture it needs
  if (!crateLidOpen() || !search.btns.length) return false;
  const scr = crate.userData.screen, l = scr.worldToLocal(P.clone());
  const sw = scr.geometry.parameters.width, sh = scr.geometry.parameters.height, c = crateScreen.canvas;
  if (Math.abs(l.z) > 0.04) return false;
  const px = (l.x / sw + 0.5) * c.width, py = (0.5 - l.y / sh) * c.height, mg = 0.02 / sw * c.width;
  const b = search.btns.find(b => b.id === 'mic');
  if (!b || px < b.x - mg || px > b.x + b.w + mg || py < b.y - mg || py > b.y + b.h + mg) return false;
  openNativeKeyboard(); return true;
}

initDiscogsToken();   // #393
initRelayFromUrl();   // #427 ?relay=wss://… saves the Dirrogram relay on this headset
async function loadLibrary() {
  sideCache.clear();
  try {
    let text, resolve, from, index = null;
    if (settings.source === 'headset') {
      if (!store.opfsSupported()) throw new Error('this browser has no private file storage');
      index = await store.loadIndex();
      const xmls = index.filter(f => /\.xml$/i.test(f.path));
      if (!xmls.length && !index.some(f => /\.(mp3|m4a|aac|wav|aiff?|flac|ogg)$/i.test(f.path))) throw new Error(index.length ? 'no songs or Rekordbox XML among the imported files' : 'nothing imported yet');
      if (xmls.length) {   // #222 an XML is optional now: songs without one go to 'Unsorted'
        const pick = xmls.find(f => /(^|\/)rekordbox\.xml$/i.test(f.path)) || xmls[0];
        text = await (await store.readFile(pick.path)).text(); from = pick.path + ' on this headset';
      } else from = 'songs on this headset (no Rekordbox XML)';
      resolve = store.opfsResolver(index);
      vvIndex = new Map(index.filter(f => VIDEO_EXT.test(f.path)).map(f => [vvKey(baseName(f.path)), f.path]));   // #177
    } else {
      const tryXml = [settings.xml, ...['rekordbox.xml', 'ViRE_rekordbox.xml'].filter(x => x !== settings.xml)];
      for (const x of tryXml) { const r = await fetch(x); if (r.ok) { text = await r.text(); from = x; break; } }
      if (!text) throw new Error('no library XML found on the PC');
      resolve = store.pcResolver;
    }
    lib = text ? parseLibrary(text, resolve) : emptyLibrary();
    const unsorted = index ? addUnsorted(lib, index) : 0;   // #222
    if (unsorted) scanUnsorted(lib);
    const pairs = lib.records.filter(r => r.paired).length;
    const splits = [...lib.tracks.values()].filter(t => t.split).length;
    const missing = [...lib.tracks.values()].filter(t => t.missing).length;
    $('#libstatus').textContent = `${from}: ${lib.tracks.size} tracks${unsorted ? ` (${unsorted} records in Unsorted)` : ''}${missing ? ` (${missing} not found)` : ''}, ${lib.records.length} records, ${pairs} with A/B sides, ${splits} split sides, ${lib.playlists.length - 1} playlists`;
  } catch (e) {
    lib = null;
    $('#libstatus').textContent = `No library: ${e.message}`;
  }
  try { const pr = await listPressings(); if (pr.length) { if (!lib) lib = emptyLibrary(); addPressings(lib, pr); } } catch (e) { console.warn('pressings', e); }   // #224
  if (!CAMERA_ROLE) { if (!lib) lib = emptyLibrary(); addExamples(lib); }   // #231
  plAttach();   // #392
  restoreMilkSleeves();   // #398
  crateState.pl = 0; crateState.sel = 0; search.q = ''; search.results = null; searchInput.value = '';
  drawCrateScreen(); layoutSleeves();
}

// #222 Unsorted songs: read each file's ID3 tag in the background (title, artist, BPM, key; the cover is left for
// the crate's own lazy cover reading), then re-sort the Unsorted list and the Collection by the real titles.
async function scanUnsorted(L) {
  const tracks = [...L.tracks.values()].filter(t => t.unsorted); let n = 0;
  for (const t of tracks) {
    if (lib !== L) return;   // the library was reloaded
    try {
      const f = await store.readFile(t.opfs), head = new Uint8Array(await f.slice(0, 10).arrayBuffer());
      if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
        const size = ((head[6] & 127) << 21) | ((head[7] & 127) << 14) | ((head[8] & 127) << 7) | (head[9] & 127);
        const tag = readID3(await f.slice(0, Math.min(size + 10, 4 * 1024 * 1024)).arrayBuffer());
        const r = t.record;
        if (tag.artist) t.artist = tag.artist;
        if (tag.title && !t.side) t.title = tag.title;   // two-sided records keep the file-name title that paired them
        if (tag.bpm > 0) { t.bpm = tag.bpm; t.bpmSrc = 'id3'; }
        if (tag.key) { t.key = tag.key; t.id3Key = tag.key; }
        if (r) { const m = r.sides.A || r.sides.B; if (m === t) { r.title = t.title; r.artist = t.artist; r.bpm = t.bpm; r.key = t.key; } }
      }
    } catch {}
    if (++n % 25 === 0) { drawCrateScreen(); await new Promise(res => setTimeout(res, 0)); }
  }
  if (lib !== L) return;
  const byT = (a, b) => (a.missing - b.missing) || a.title.localeCompare(b.title);
  const un = L.playlists.find(p => p.name === 'Unsorted'); if (un) un.records.sort(byT);
  L.playlists[0].records.sort(byT);
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
  if (CAMERA_ROLE) return phoneArt(track);   // #218
  if (track.press) return pressArt(track);   // #224 pressed record: its own label picture
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
          const t = readID3(tag); useID3Bpm(track, t); if (t.picture) { art = await createImageBitmap(t.picture); artBlobs.set(track.id, t.picture); } await keepExtraPics(track, t);
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
    if (track.press) return { bytes: await pressBytes(track), art: await pressArt(track).then(a => labelArt.get(track.id) || a) };   // #224 (#393 the label, not the sleeve)
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
      await keepExtraPics(track, tag);
    } catch (e) { console.warn('art', e); }
    artCache.set(track.id, art);
    return { bytes, art: labelArt.get(track.id) || (track.side === 'B' && labelArtB.get(track.id)) || art };   // #231 the record's label (#232 a _b file's 'Label B' is its own)
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
  // #232 the B label from inside the A file: a one-file record's B face, or a _b file without pictures of its own
  const a = rec3d.track('A'), b = rec3d.track('B'), lb = a && labelArtB.get(a.id);
  if (lb && !rec3d.disposed && (!b || !rec3d.labelImgs.B)) { rec3d.labelImgs.B = lb; rec3d.redraw('B'); }
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
  if (CAMERA_ROLE) { if (!remoteCrate) crateScreen.commit(); return; }   // #218 the phone shows the Quest's lid screen (crateRemote.onScreen)
  if (!lib) { g.fillStyle = '#8d96a1'; g.font = '500 34px system-ui'; g.textAlign = 'left'; g.fillText('No library', 30, 60); crateScreen.commit(); return; }
  const pl = lib.playlists[crateState.pl];
  const list = currentList(), searching = !!search.results;
  // header
  g.fillStyle = '#1a1f25'; g.fillRect(0, 0, W, CS.head);
  g.fillStyle = '#4aa8f0'; g.font = '600 36px system-ui'; g.textAlign = 'left';
  g.fillText('◀', 20, CS.head / 2); g.textAlign = 'right'; g.fillText('▶', W - 20, CS.head / 2);
  g.fillStyle = '#e6e9ec'; g.font = '600 32px system-ui'; g.textAlign = 'center';
  const plm = plMode(), sets = plm && plUI.view === 'sets';   // #392 the PLAYLIST view (and its SETS list)
  fitText(g, searching ? `Search · ${list.length} result${list.length === 1 ? '' : 's'}` : sets ? `Saved playlists · ${plSaved.length}` : `Crate > ${pl.path}`, W / 2, CS.head / 2, W - 150);
  // search bar: field | playlist | 45s | milk | keyboard | mic | clear   (#392 PLAYLIST view: name | SAVE | SETS | CLEAR | mic | playlist)
  const by = SB.y + 8, bh = SB.h - 14;
  if (plm) {
    const TW = 128;
    search.btns = [
      { id: 'field', x: 12, y: by, w: W - 12 - 3 * (TW + 8) - 3 * 78 - 12, h: bh },
      { id: 'plsave', x: W - 3 * 78 - 3 * (TW + 8) - 4, y: by, w: TW, h: bh, label: 'SAVE' },
      { id: 'plsets', x: W - 3 * 78 - 2 * (TW + 8) - 4, y: by, w: TW, h: bh, label: sets ? 'LIST' : 'SETS' },
      { id: 'plclear', x: W - 3 * 78 - (TW + 8) - 4, y: by, w: TW, h: bh, label: performance.now() < plUI.clearArm ? 'SURE?' : 'CLEAR' },
      { id: 'plmilk', x: W - 3 * 78 - 4, y: by, w: 70, h: bh },   // #394 records jump into a new milk crate
      { id: 'mic', x: W - 2 * 78 - 4, y: by, w: 70, h: bh },
      { id: 'pl', x: W - 78 - 4, y: by, w: 70, h: bh },
    ];
    const f = search.btns[0], ed = search.target === 'plname';
    g.fillStyle = ed ? '#1d2a38' : '#171c22'; g.fillRect(f.x, f.y, f.w, f.h);
    g.strokeStyle = ed ? '#4aa8f0' : '#2c343d'; g.lineWidth = 2; g.strokeRect(f.x + 1, f.y + 1, f.w - 2, f.h - 2);
    g.textAlign = 'left'; g.font = '600 26px system-ui'; g.fillStyle = '#8d96a1'; g.fillText('NAME', f.x + 12, f.y + bh / 2);
    g.font = '500 30px system-ui'; g.fillStyle = plNow.name ? '#ffffff' : '#6f7985';
    fitText2(g, plNow.name ? plNow.name + (ed && search.kb ? '▏' : '') : 'tap to name it', f.x + 96, f.y + bh / 2, f.w - 106);
    for (const b of search.btns.slice(1)) {
      const on = (b.id === 'mic' && document.activeElement === searchInput) || (b.id === 'plsets' && sets) || (b.id === 'plclear' && performance.now() < plUI.clearArm);
      g.fillStyle = b.id === 'plclear' && on ? '#8a2a1a' : on ? '#23527c' : b.id === 'plsave' ? '#1d5a33' : '#1b2128'; g.fillRect(b.x, b.y, b.w, b.h);
      g.textAlign = 'center'; g.fillStyle = '#e6e9ec';
      if (b.id === 'pl') { drawPlIcon(g, b.x + b.w / 2, b.y + bh / 2, true, plNow.items.length); continue; }
      if (b.id === 'plmilk') { drawJumpIcon(g, b.x + b.w / 2, b.y + bh / 2, !!plJump); continue; }
      if (b.id === 'mic') { g.font = `34px ${EMOJI}`; g.fillText('🎤', b.x + b.w / 2, b.y + bh / 2 + 2); continue; }
      g.font = '700 26px system-ui'; g.fillText(b.label, b.x + b.w / 2, b.y + bh / 2 + 1);
    }
  } else {
  search.btns = [
    { id: 'field', x: 12, y: by, w: W - 12 - 6 * 78 - 16, h: bh },
    { id: 'pl', x: W - 6 * 78 - 4, y: by, w: 70, h: bh },   // #392 the PLAYLIST view
    { id: 's45', x: W - 5 * 78 - 4, y: by, w: 70, h: bh },   // #255 the 45s list
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
    if (b.id === 's45') { const pl = lib && lib.playlists[crateState.pl]; draw45Icon(g, b.x + b.w / 2, b.y + bh / 2, !!(pl && pl.name === '45s' && !search.results)); continue; }
    if (b.id === 'pl') { drawPlIcon(g, b.x + b.w / 2, b.y + bh / 2, false, plNow.items.length); continue; }   // #392
    g.fillText(b.id === 'kb' ? '⌨' : b.id === 'mic' ? '🎤' : '✕', b.x + b.w / 2, b.y + bh / 2 + 2);
  }
  }
  // keyboard layout (bottom, above the footer) decides how many rows fit
  const footTop = H - CS.foot, kbH = KB.length * 68 + 8, kbY = footTop - kbH;
  const y0 = SB.y + SB.h + 4, RH = CS.rh;
  const ROWS = Math.floor(((search.kb ? kbY - 4 : footTop) - y0) / RH);
  // rows
  let start = clamp(crateState.sel - Math.min(4, ROWS >> 1), 0, Math.max(0, list.length - ROWS));
  if (sets) {   // #392 SETS: the saved playlists; tap one to load it, ✕ (twice) to delete it
    start = plUI.setsStart = clamp(plUI.setsStart, 0, Math.max(0, plSaved.length - ROWS));
    if (!plSaved.length) { g.textAlign = 'center'; g.fillStyle = '#6f7985'; g.font = '500 32px system-ui'; g.fillText('No saved playlists yet: build one, then SAVE', W / 2, y0 + RH * 1.5); }
    for (let k = 0; k < ROWS && start + k < plSaved.length; k++) {
      const st = plSaved[start + k], y = y0 + k * RH, cur = plNow.name && st.name.toLowerCase() === plNow.name.toLowerCase();
      g.fillStyle = cur ? '#1d3346' : '#151a20'; g.fillRect(6, y + 1, W - 12, RH - 2);
      g.textAlign = 'left'; g.fillStyle = '#f1b650'; g.font = '600 34px system-ui'; g.fillText('★', 22, y + RH / 2);
      g.fillStyle = '#e6e9ec'; fitText2(g, st.name, 70, y + RH / 2, W - 520);
      g.textAlign = 'right'; g.fillStyle = '#aab2bc'; g.font = '500 28px system-ui';
      g.fillText(`${st.items.length} rec · ${new Date(st.made).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, W - 150, y + RH / 2);
      const arm = plUI.delArm === st.id;
      g.fillStyle = arm ? '#c8202c' : '#2a1a1e'; g.fillRect(W - 132, y + 4, 120, RH - 8);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '700 26px system-ui'; g.fillText(arm ? 'DELETE?' : '✕', W - 72, y + RH / 2 + 1);
    }
  } else {
  if (!list.length) { g.textAlign = 'center'; g.fillStyle = '#6f7985'; g.font = '500 32px system-ui'; g.fillText(searching ? 'No matches' : plm ? 'Empty: tap ➕ before a record in any list' : 'Empty playlist', W / 2, y0 + RH * 1.5); }
  const inPl = plEntry() ? new Set(plEntry().records) : new Set();   // #392 ➕ / ✔ before each title
  for (let k = 0; k < ROWS && start + k < list.length; k++) {
    const idx = start + k, r = list[idx], y = y0 + k * RH;
    const sel = idx === crateState.sel;
    if (sel) { g.fillStyle = '#23527c'; g.fillRect(6, y + 1, W - 12, RH - 2); }
    else { g.fillStyle = '#1b2026'; g.fillRect(16, y + RH - 1, W - 32, 1); }
    g.textAlign = 'left'; g.fillStyle = r.missing ? '#4c535c' : sel ? '#ffffff' : '#dde1e5';
    g.font = `${sel ? 600 : 500} 34px system-ui`;
    const badge = (r.paired ? 'A|B ' : '') + ((r.sides.A && r.sides.A.split) || (r.sides.B && r.sides.B.split) ? 'S ' : '');
    if (!CAMERA_ROLE) drawPlMark(g, 40, y + RH / 2, inPl.has(r));   // #392
    g.textAlign = 'left'; g.fillStyle = r.missing ? '#4c535c' : sel ? '#ffffff' : '#dde1e5'; g.font = `${sel ? 600 : 500} 34px system-ui`;
    fitText2(g, `${r.title}${r.artist ? ' - ' + r.artist : ''}`, PLX, y + RH / 2, W - 250 - (PLX - 22));
    g.textAlign = 'right'; g.font = '600 26px system-ui'; g.fillStyle = '#f1b650'; g.fillText(badge, W - 138, y + RH / 2);
    g.fillStyle = sel ? '#ffffff' : '#aab2bc'; g.font = '600 32px system-ui';
    g.fillText(r.bpm ? r.bpm.toFixed(r.bpm % 1 ? 1 : 0) : '', W - 22, y + RH / 2);
    if (r === crateDel) {   // #226 the delete offer
      g.fillStyle = '#c8202c'; g.fillRect(W - CDEL_W - 12, y + 3, CDEL_W + 6, RH - 6);
      g.fillStyle = '#fff'; g.font = '700 30px system-ui'; g.textAlign = 'center'; g.fillText('✕ DELETE', W - 9 - CDEL_W / 2, y + RH / 2 + 1);
    }
  }
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
  // #226 messages and hints the DJ must read in the headset go in the footer
  const cm = crateMsg && performance.now() < crateMsg.until ? crateMsg : null;
  const hintDel = !cm && crateDel ? { text: 'Tap ✕ DELETE to remove this record, or anywhere else to keep it', ok: true } : null;
  if (cm || hintDel) {
    const m = cm || hintDel;
    g.fillStyle = cm ? (m.ok ? '#1d7a3a' : '#8a2a1a') : '#3a1a1e'; g.fillRect(0, H - CS.foot, W, CS.foot);
    g.fillStyle = '#fff'; g.font = '600 28px system-ui'; g.textAlign = 'center'; fitText2Center(g, m.text, W / 2, fy, W - 40);
  }
  crateScreen.commit();
  if (spect && spect.crateScreen) spect.crateScreen(crateScreen.canvas);   // #218 the phone's lid screen
  crateScreen.rows = { start, ROWS, RH, y0, kbY: search.kb ? kbY : Infinity };
}
// little green milk crate with a plus: spawns another crate (#88)
// #255 crate screen: a small 7" record with '45' on its label; lit while the 45s list is showing
function draw45Icon(g, cx, cy, on) {
  g.save();
  g.fillStyle = '#0c0d10'; g.beginPath(); g.arc(cx, cy, 17, 0, Math.PI * 2); g.fill();
  g.strokeStyle = on ? '#4aa8f0' : '#5a636e'; g.lineWidth = 2; g.stroke();
  g.strokeStyle = '#262a31'; g.lineWidth = 1; for (const r of [13, 10]) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = on ? '#f1b650' : '#b8862e'; g.beginPath(); g.arc(cx, cy, 7.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0c0d10'; g.beginPath(); g.arc(cx, cy, 3.4, 0, Math.PI * 2); g.fill();   // the big 45 hole
  g.fillStyle = on ? '#ffffff' : '#c9ced8'; g.font = '800 13px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('45', cx + 21, cy + 13);
  g.restore();
}
// #255 jump to the 45s list (made empty if there is none yet); pressed again it goes back to where you were
let crateBack45 = null;
function crate45s() {
  if (!lib) lib = emptyLibrary();
  if (search.results) exitSearch();
  let i = lib.playlists.findIndex(pl => pl.name === '45s');
  if (i >= 0 && crateState.pl === i) { if (crateBack45 && lib.playlists[crateBack45.pl]) { crateState.pl = crateBack45.pl; crateState.sel = crateBack45.sel; } crateBack45 = null; }
  else {
    if (i < 0) { lib.playlists.push({ name: '45s', path: '45s (7" singles on this headset)', records: [] }); i = lib.playlists.length - 1; }
    crateBack45 = { pl: crateState.pl, sel: crateState.sel }; crateState.pl = i; crateState.sel = 0;
  }
  drawCrateScreen(); layoutSleeves();
}
// ---- #392 PLAYLIST (owner): build a set on the crate lid. ➕ before a title adds the record (it turns to ✔; tap the ✔
// to take it out). The playlist button in the search row (left of 45, milk crate, keyboard, mic) opens the PLAYLIST view:
// NAME (tap the field: on-screen keys or the mic), SAVE (same name = update that set), SETS (the saved playlists: tap one
// to load it back, ✕ twice to delete), CLEAR (two taps). Saved sets are also lists in the crate's ◀ ▶ as ★ NAME, so
// they can be dug through like Rekordbox playlists. Pull, preview and STAMP (SONG… list) work from any of them.
// Kept on this device: 'vire.plNow' (the one being built) and 'vire.playlists' (saved). A record is remembered by its file
// (location / headset path / URL) plus title|artist, so a set finds its records again after a reload or a source switch.
const PLX = 74;   // titles start right of the ➕ / ✔ (tap zone x < 70)
const PL_NOW = 'vire.plNow', PL_SAVED = 'vire.playlists';
const plRead = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch { return d; } };
const plNow = plRead(PL_NOW, { items: [], name: '' });
let plSaved = plRead(PL_SAVED, []);
const plUI = { view: 'list', back: null, clearArm: 0, delArm: null, setsStart: 0 };
function plStore() { try { localStorage.setItem(PL_NOW, JSON.stringify(plNow)); localStorage.setItem(PL_SAVED, JSON.stringify(plSaved)); } catch {} }
function plItem(r) { const t = r.sides.A || r.sides.B; return { loc: (t && (t.location || t.opfs || t.url)) || r.id, ta: `${r.title}|${r.artist || ''}`.toLowerCase(), t: r.title }; }
function plMaps() {
  const byLoc = new Map(), byTa = new Map();
  if (lib) for (const r of lib.records) { const it = plItem(r); if (!byLoc.has(it.loc)) byLoc.set(it.loc, r); if (!byTa.has(it.ta)) byTa.set(it.ta, r); }
  return x => byLoc.get(x.loc) || byTa.get(x.ta) || null;
}
function plResolve(items, find = plMaps()) { const out = []; for (const x of items) { const r = find(x); if (r && !out.includes(r)) out.push(r); } return out; }
const plEntry = () => (lib && lib.playlists.find(p => p.special === 'now')) || null;
const plMode = () => !CAMERA_ROLE && !search.results && !!lib && !!lib.playlists[crateState.pl] && lib.playlists[crateState.pl].special === 'now';
// the PLAYLIST list and the saved sets go at the end of lib.playlists (rebuilt after every change; the crate keeps its place)
function plAttach() {
  if (!lib || CAMERA_ROLE) return;
  const cur = lib.playlists[crateState.pl], find = plMaps();
  lib.playlists = lib.playlists.filter(p => !p.special);
  const recs = plResolve(plNow.items, find);
  lib.playlists.push({ name: 'PLAYLIST', special: 'now', path: `PLAYLIST${plNow.name ? ' · ' + plNow.name : ''} · ${recs.length} record${recs.length === 1 ? '' : 's'}`, records: recs });
  for (const st of plSaved) lib.playlists.push({ name: '★ ' + st.name, special: 'set', setId: st.id, path: `★ ${st.name} (saved playlist)`, records: plResolve(st.items, find) });
  let i = cur ? lib.playlists.indexOf(cur) : -1;
  if (i < 0 && cur && cur.special) i = lib.playlists.findIndex(p => p.special === cur.special && p.setId === cur.setId);
  crateState.pl = i >= 0 ? i : Math.max(0, Math.min(crateState.pl, lib.playlists.length - 1));
}
function plToggle(r) {
  const e = plEntry(), find = plMaps(), sel = currentList()[crateState.sel];
  if (e && e.records.includes(r)) plNow.items = plNow.items.filter(x => find(x) !== r);
  else plNow.items.push(plItem(r));
  plStore(); plAttach();
  const L = currentList(), k = sel ? L.indexOf(sel) : -1;
  crateState.sel = clamp(k >= 0 ? k : crateState.sel, 0, Math.max(0, L.length - 1));
  drawCrateScreen(); if (plMode()) layoutSleeves();
}
function plOpen() {   // the playlist button: open the PLAYLIST view; pressed there it goes back to where you were
  if (CAMERA_ROLE) return;
  if (!lib) lib = emptyLibrary();
  if (search.results) exitSearch();
  plAttach();
  const i = lib.playlists.findIndex(p => p.special === 'now');
  if (crateState.pl === i) { if (plUI.back && lib.playlists[plUI.back.pl]) { crateState.pl = plUI.back.pl; crateState.sel = plUI.back.sel; } else { crateState.pl = 0; crateState.sel = 0; } plUI.back = null; }
  else { plUI.back = { pl: crateState.pl, sel: crateState.sel }; crateState.pl = i; crateState.sel = 0; }
  plUI.view = 'list'; plUI.delArm = null; search.kb = false; search.target = null;
  drawCrateScreen(); layoutSleeves();
}
function plRename(n) { plNow.name = [...(n || '')].slice(0, 28).join(''); plStore(); plAttach(); drawCrateScreen(); }
function plSave() {
  if (!plNow.items.length) { crateSay('The playlist is empty: tap ➕ before records first', false, 3500); return; }
  const name = (plNow.name || '').trim() || 'SET ' + new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).toUpperCase().replace(',', '');
  plNow.name = name; search.kb = false; search.target = null;
  const old = plSaved.find(st => st.name.toLowerCase() === name.toLowerCase());
  if (old) { old.items = plNow.items.slice(); old.made = Date.now(); }
  else plSaved.push({ id: 's' + Date.now().toString(36), name, made: Date.now(), items: plNow.items.slice() });
  plStore(); plAttach();
  crateSay(`${old ? 'Updated' : 'Saved'} "${name}": ${plNow.items.length} record${plNow.items.length === 1 ? '' : 's'} (SETS, or ◀ ▶ to ★ ${name})`, true, 5000);
}
function plLoadSet(st) {
  plNow.items = st.items.slice(); plNow.name = st.name; plStore(); plAttach();
  plUI.view = 'list'; plUI.delArm = null; crateState.sel = 0; layoutSleeves();
  const n = plEntry().records.length, miss = st.items.length - n;
  crateSay(`Loaded "${st.name}": ${n} record${n === 1 ? '' : 's'}${miss > 0 ? `, ${miss} not in this library` : ''}`, miss <= 0, 3500);
}
function plDeleteSet(st) { plSaved = plSaved.filter(x => x !== st); plUI.delArm = null; plStore(); plAttach(); crateSay(`Deleted the saved playlist "${st.name}" (the records stay in the crate)`, true, 3500); }
function plClear() {
  if (performance.now() > plUI.clearArm) { plUI.clearArm = performance.now() + 3000; setTimeout(drawCrateScreen, 3050); crateSay('Tap SURE? to empty the playlist (saved sets stay)', false, 3000); return; }
  plUI.clearArm = 0; plNow.items = []; plNow.name = ''; plStore(); plAttach(); crateState.sel = 0; layoutSleeves();
  crateSay('Playlist emptied', true, 2000);
}
function crateSearchRowPl(b) {   // a tap on the PLAYLIST view's search row
  if (b.id === 'field') { search.target = 'plname'; search.kb = true; drawCrateScreen(); }
  else if (b.id === 'plsave') plSave();
  else if (b.id === 'plsets') { plUI.view = plUI.view === 'sets' ? 'list' : 'sets'; plUI.delArm = null; search.kb = false; search.target = null; drawCrateScreen(); }
  else if (b.id === 'plclear') plClear();
  else if (b.id === 'plmilk') plToMilk();   // #394
  else if (b.id === 'mic') openNativeKeyboard();
  else if (b.id === 'pl') plOpen();
}
// ---- #394 (owner) PLAYLIST > the curved arrow into a milk crate: a new milk crate pops up beside the record crate with the
// playlist's name scrawled on its label, and every record in the playlist jumps out of the record crate in its sleeve, one after
// the other, flips through the air and drops into the row (#398: sleeved, see layoutMilkSleeves). Records already out (all
// 3 copies) or missing files stay behind; at most 40 per crate.
let plJump = null;
function plToMilk() {
  const e = plEntry(), all = e ? e.records : [], recs = all.filter(r => !r.missing && copiesOut(r) < COPIES);
  if (!recs.length) { crateSay(all.length ? 'Every record in this playlist is already out of the crate' : 'The playlist is empty: tap ➕ before records first', false, 3500); return; }
  if (plJump) { crateSay('Still moving the last playlist', false, 2000); return; }
  const mc = spawnMilk(true); if (!mc) { crateSay(`No room for another: ${MILK_MAX} milk crates are out (toss one away)`, false, 3500); return; }
  const name = (plNow.name || '').trim() || 'PLAYLIST';
  mc.userData.label.writeText(name);
  plJump = { recs: recs.slice(0, 40), mc, i: 0, t: -0.45 };
  crateSay(`${Math.min(40, recs.length)} record${recs.length === 1 ? '' : 's'} jumping into the "${name}" milk crate`, true, 3500);
}
function stepPlJump(dt) {
  stepMilkFlyers(dt);   // #398 sleeves in the air
  const J = plJump; if (!J) return;
  if (!J.mc.parent || flyingMilk.has(J.mc)) { plJump = null; drawCrateScreen(); return; }
  J.t += dt;
  while (J.i < J.recs.length && J.t >= J.i * 0.3) { try { if (!launchSleeveToMilk(J.recs[J.i], J.mc)) break; } catch (e) { console.warn('jump', e); } J.i++; }   // #398 in their sleeves (no flyer free: try again next frame)
  if (J.i >= J.recs.length && !msFly.some(f => f.busy && f.mc === J.mc)) { plJump = null; drawCrateScreen(); }
}
function launchToMilk(r, mc) {
  const rec = new Record3D(r); rec.group.scale.setScalar(1); scene.add(rec.group); prepareArt(rec);
  crate.updateMatrixWorld(true); mc.updateMatrixWorld(true);
  const S = crate.localToWorld(new THREE.Vector3((Math.random() - 0.5) * 0.06, CRATE.H + 0.04, (Math.random() - 0.5) * 0.08));
  const T = mc.localToWorld(new THREE.Vector3((Math.random() - 0.5) * 0.08, MILK.H + 0.1, (Math.random() - 0.5) * 0.12));
  rec.group.position.copy(S);
  rec.group.quaternion.copy(crate.getWorldQuaternion(new THREE.Quaternion())).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));   // standing in the crate, as the records do
  // ballistic with the loose-record air drag (v *= 1 - 0.5 dt): solve for the start speed that lands on T after tf
  const tf = 0.55 + Math.min(0.25, S.distanceTo(T) * 0.2), k = 0.5, f = (1 - Math.exp(-k * tf)) / k;
  const vel = new THREE.Vector3((T.x - S.x) / f, ((T.y - S.y) + GRAV * tf / k) / f - GRAV / k, (T.z - S.z) / f);
  const ax = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.3, Math.random() - 0.5).normalize();
  loose.push({ rec, vel, ang: ax.multiplyScalar(5 + Math.random() * 4), resting: false, since: performance.now() });
  rec.attach = null; rec.mesh.userData.loose = true;
  layoutSleeves();
}
// a curved arrow dropping into a little milk crate
function drawJumpIcon(g, cx, cy, busy) {
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = busy ? '#4aa8f0' : '#3fbf6a'; g.lineWidth = 3;
  g.strokeRect(cx - 4, cy + 2, 24, 15); for (const x of [2, 8, 14]) { g.beginPath(); g.moveTo(cx + x, cy + 2); g.lineTo(cx + x, cy + 17); g.stroke(); }
  g.strokeStyle = '#e6e9ec'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(cx - 22, cy + 10); g.quadraticCurveTo(cx - 18, cy - 20, cx + 8, cy - 6); g.stroke();
  g.beginPath(); g.moveTo(cx + 1, cy - 12); g.lineTo(cx + 9, cy - 5); g.lineTo(cx + 1, cy + 1); g.stroke();
  g.restore();
}
// the playlist button: three lines and a note, with the count
function drawPlIcon(g, cx, cy, on, n) {
  g.save(); g.strokeStyle = on ? '#4aa8f0' : '#e6e9ec'; g.fillStyle = g.strokeStyle; g.lineWidth = 3.5; g.lineCap = 'round';
  for (const [y, w] of [[-12, 22], [-3, 22], [6, 13]]) { g.beginPath(); g.moveTo(cx - 22, cy + y); g.lineTo(cx - 22 + w, cy + y); g.stroke(); }
  g.beginPath(); g.moveTo(cx + 11, cy + 9); g.lineTo(cx + 11, cy - 14); g.lineTo(cx + 19, cy - 10); g.stroke();
  g.beginPath(); g.ellipse(cx + 7, cy + 10, 5, 4, -0.4, 0, Math.PI * 2); g.fill();
  if (n) { g.fillStyle = '#3fbf6a'; g.beginPath(); g.arc(cx + 22, cy + 14, 11, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.font = '800 14px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(n > 99 ? '99' : String(n), cx + 22, cy + 15); }
  g.restore();
}
// ➕ (not in the playlist) or ✔ (in it), before each title
function drawPlMark(g, cx, cy, inPl) {
  g.save(); g.lineWidth = 3.5; g.lineCap = 'round'; g.lineJoin = 'round';
  if (inPl) { g.fillStyle = '#2f9e57'; g.beginPath(); g.arc(cx, cy, 19, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(cx - 9, cy + 1); g.lineTo(cx - 3, cy + 8); g.lineTo(cx + 10, cy - 8); g.stroke(); }
  else { g.strokeStyle = '#5d6772'; g.lineWidth = 2.5; g.beginPath(); g.arc(cx, cy, 18, 0, Math.PI * 2); g.stroke(); g.strokeStyle = '#c9d0d8'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(cx - 9, cy); g.lineTo(cx + 9, cy); g.moveTo(cx, cy - 9); g.lineTo(cx, cy + 9); g.stroke(); }
  g.restore();
}
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
  grp.userData.size = r => {   // #257 7" or 12": the disc shrinks, its label to the 7" label size
    // #363 the riding disc is drawn 0.6 mm thick so it stays INSIDE the 1.4 mm jacket (a real 1.9 mm disc poked through
    // both faces and its label sat in front of the cover, so the whole record showed in front of its sleeve)
    const D = dimsOf(r), k = D.R / REC.R, CT = 0.0006; disc.scale.set(k, CT / REC.THICK, k);
    grp.children.forEach(o => { if (o !== disc) { o.scale.setScalar(D.LABEL / REC.LABEL); o.position.z = Math.sign(o.position.z) * (CT / 2 + 0.0001); } });
    mat.userData.rec.uHoleN.value = D === REC7 ? D.HOLE / D.R : 0; grp.userData.hole = D === REC7 ? D.HOLE / D.LABEL : 6 / 128;
  };
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
  else if (r.size === 7) { drawPlain7(g, 256, r); }   // #262 a plain paper 45 sleeve, label showing through its hole
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
// #262 a plain 7" sleeve: kraft paper, the record's label seen through the 89 mm centre hole, the title on top
function drawPlain7(g, S, r, holeOnly = false) {
  const k = S / 256;
  g.fillStyle = '#c9b48f'; g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(90,70,40,0.10)'; for (let i = 0; i < 40; i++) g.fillRect(0, (i * 37 % 256) * k, S, 1.5 * k);   // paper grain
  g.fillStyle = 'rgba(60,45,25,0.18)'; g.fillRect(0, 0, S, 6 * k); g.fillRect(0, S - 6 * k, S, 6 * k);   // folded edges
  if (!holeOnly) {
    const t = r.sides.A || r.sides.B, la = t && labelOf(t), cr = 62 * k;
    g.save(); g.beginPath(); g.arc(S / 2, S / 2, cr, 0, Math.PI * 2); g.clip();
    if (la) { const s = Math.max(2 * cr / la.width, 2 * cr / la.height); g.drawImage(la, S / 2 - la.width * s / 2, S / 2 - la.height * s / 2, la.width * s, la.height * s); }
    else { g.fillStyle = '#c8202c'; g.fillRect(S / 2 - cr, S / 2 - cr, 2 * cr, 2 * cr); }
    g.fillStyle = '#0b0b0c'; g.beginPath(); g.arc(S / 2, S / 2, cr * 0.43, 0, Math.PI * 2); g.fill();   // the 45's own big hole
    g.restore();
  }
  g.fillStyle = '#3a2c18'; g.textAlign = 'center'; g.font = `700 ${18 * k}px system-ui`; fitText2Center(g, r.title || '', S / 2, 34 * k, 220 * k);
  g.font = `400 ${14 * k}px system-ui`; fitText2Center(g, r.artist || '', S / 2, 54 * k, 220 * k);
}
function assignCovers(list, slots) { // slots: [{ idx, p, q }] nearest first
  const want = slots.slice(0, COVER_N);
  coverPool.forEach((m, i) => {
    const s = want[i]; if (!s) { m.visible = false; return; }
    const r = list[s.idx];
    m.position.copy(s.p).add(new THREE.Vector3(0, 0, 0.0009).applyQuaternion(s.q)); m.quaternion.copy(s.q); m.scale.set(s.sx ?? 1, s.sy ?? 1, 1); m.visible = true;   // #153: lid shut = squashed like the jacket (was poking through the floor)
    if (m.userData.rec !== r || (!m.userData.hasArt && artCache.get((r.sides.A || r.sides.B).id))) { m.userData.rec = r; drawJacket(m, r); }
    const t = r.sides.A || r.sides.B;
    if (t && !t.missing && !artCache.has(t.id)) fetchArt(t).then(a => { if (a && m.userData.rec === r) drawJacket(m, r); });
  });
}

function drawCrateDiscLabel(r) {
  const { canvas: c, tex } = crateDisc.userData; const g = c.getContext('2d');
  const t = r && (r.sides.A || r.sides.B); const art = labelOf(t);   // #231
  let h = 0; for (const ch of (r ? r.title : '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; h %= 360;
  g.save(); g.clearRect(0, 0, 256, 256); g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.clip();
  if (art) { const s = Math.max(256 / art.width, 256 / art.height); g.drawImage(art, 128 - art.width * s / 2, 128 - art.height * s / 2, art.width * s, art.height * s); }
  else {
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, `hsl(${h},55%,52%)`); gr.addColorStop(1, `hsl(${(h + 30) % 360},60%,34%)`);
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '600 22px system-ui'; fitText2(g, r ? r.title : '', 128, 170, 200);
    g.font = '700 18px system-ui'; g.fillText(r && r.bpm ? `${r.bpm.toFixed(r.bpm % 1 ? 1 : 0)} BPM` : '', 128, 200);
  }
  g.fillStyle = '#000'; g.beginPath(); g.arc(128, 128, 128 * (crateDisc.userData.hole || 6 / 128), 0, Math.PI * 2); g.fill();
  g.restore(); tex.needsUpdate = true;
}
function layoutSleeves() {
  const list = currentList(); const S = crate.userData.sleeves;
  const n = Math.min(CRATE.slots, list.length);
  const start = clamp(crateState.sel - 8, 0, Math.max(0, list.length - n));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
  const front = CRATE.D / 2 - 0.03, shut = remoteCrate ? remoteCrate.shut : !crateLidOpen();   // #218 phone: the Quest's lid
  // #129: keep every jacket inside the case. Bottoms stand on the floor (the old -4 cm sank them through it);
  // the pitch shrinks so the last one clears the back wall even with its lean; with the lid shut the jackets
  // are squashed to fit under it (hidden then anyway: a 315 mm sleeve is taller than the 288 mm inside).
  const FLOOR = 0.012, SH = 0.315, backZ = -CRATE.D / 2 + 0.012 + 0.0015 + SH / 2 * Math.sin(0.08);
  const pitch = Math.min(CRATE.pitch, (front - 0.02 - backZ) / (CRATE.slots - 1));
  const hy = shut ? (CRATE.H - FLOOR - 0.006) / SH : 1;
  // #350 (owner: bigger angle between the current sleeve and the ones either side, easier to pick up). Lid open, each
  // jacket pivots on its bottom edge like a real one: the ones flipped past fan forward at 23 deg (parallel, a sleeve's
  // width apart along the floor, the front-most top just inside the front wall), a 1.2 cm gap, the current one upright,
  // a 3 cm gap, the next one leaning back 6 deg, the rest packed behind it to the back wall.
  const AP = 0.40, dzP = 0.0067, gapF = 0.012, gapB = 0.03, zWallF = CRATE.D / 2 - 0.012 - 0.003, zBack = -CRATE.D / 2 + 0.012 + 0.006;
  const kSel = crateState.sel - start, nPast = Math.max(0, Math.min(kSel, n)), nBack = Math.max(0, n - kSel - 1);
  const zSelMin = zBack + (nBack ? gapB + (nBack - 1) * 0.0026 : 0);   // room for the ones behind (2.6 mm apart at least)
  const zSel = Math.max(zSelMin, Math.min(front - 0.01, zWallF - (nPast ? gapF + (nPast - 1) * dzP + SH * Math.sin(AP) : 0)));
  const dzF = nPast > 1 ? Math.max(0.0016, Math.min(dzP, (zWallF - SH * Math.sin(AP) - gapF - zSel) / (nPast - 1))) : dzP;   // near the end of a list: the fan packs tighter
  const pB = nBack > 1 ? Math.min(CRATE.pitch, (zSel - gapB - zBack) / (nBack - 1)) : 0;
  for (let k = 0; k < CRATE.slots; k++) {
    const idx = start + k; sleeveMap[k] = idx < list.length ? idx : -1;
    if (k >= n) { m.makeScale(0, 0, 0); S.setMatrixAt(k, m); continue; }
    const rel = idx - crateState.sel;
    const r = list[idx], sh = sleeveDims(r).H, ks = sh / SH, hyr = shut ? Math.min(1, (CRATE.H - FLOOR - 0.006) / sh) : 1;   // #257 7" sleeves: smaller, standing lower
    let z = front - k * pitch, y = FLOOR + 0.001 + sh * hyr / 2, tilt = -0.08;
    const yDisc = 0.012 + sh / 2 - 0.04 * ks;              // the record riding out keeps its old height
    if (rel < 0) { tilt = 0.32; z += 0.012; }              // flipped past: lean toward the DJ
    if (rel === 0 && shut) tilt = 0.05;                   // lid shut: selection stays down in its sleeve
    else if (rel === 0) { tilt = 0.05; y += 0.012; }       // selected: sleeve nudged up, record pops out (below)
    if (rel !== 0 || shut) y = Math.max(y, FLOOR + 0.001 + sh * hyr / 2 * Math.cos(tilt) + 0.0007 * Math.abs(Math.sin(tilt)));
    if (rel > 0) z -= 0.02;                                 // gap behind the selection
    if (!shut) {   // #350 bottom-pivot fan (see above)
      const zb = rel < 0 ? zSel + gapF + (-rel - 1) * dzF : rel === 0 ? zSel : zSel - gapB - (rel - 1) * pB;
      tilt = rel < 0 ? AP : rel === 0 ? 0.0 : rel === 1 ? -0.10 : -0.03;
      const hh = sh * hyr / 2; z = zb + hh * Math.sin(tilt); y = FLOOR + 0.001 + hh * Math.cos(tilt) + (rel === 0 && !crateState.walking ? 0.012 : 0);
    }
    e.set(tilt, 0, 0); q.setFromEuler(e); p.set(0, y, z);
    s.set(ks, hyr * ks, r && r.missing ? 0.001 : 1);
    { const so = r && sleeveOf(r); if (so) { so.slotM = new THREE.Matrix4().compose(p, q, s); if (!so.back || so.back.t < 1) s.set(0, 0, 0); } }   // #229 / #242 that sleeve is out of the crate
    m.compose(p, q, s); S.setMatrixAt(k, m);
    if (rel === 0 && crateState.walking) crateDisc.visible = false;   // #350 finger-walking: no record riding out until the hand pauses
    else if (rel === 0 && r && !r.missing && !shut) {
      // #363 owner: pops out 15 % less, then a further 15 % (0.85 x 0.85 = 72 %: ~7.5 cm above a 12" jacket's top, was ~10.4)
      let yT = yDisc + 0.012 + sh / 2 - 0.005; const pop = yT + dimsOf(r).R - (y + sh * hyr / 2); if (pop > 0) yT -= (1 - 0.85 * 0.85) * pop;
      crateDisc.userData.target.set(0, yT, z); crateDisc.userData.tilt = tilt;
      if (!crateDisc.visible) { crateDisc.position.set(0, yDisc + 0.012, z); crateDisc.visible = true; }
      if (crateDisc.userData.rec !== r) {
        crateDisc.userData.rec = r; crateDisc.position.set(0, yDisc + 0.012, z); crateDisc.userData.size(r); drawCrateDiscLabel(r);   // #365 starts inside the new sleeve (z too: it used to glide across from the old one)
        const t = r.sides.A || r.sides.B; // fetch cover art in the background for the label
        if (t && !t.missing && !artCache.has(t.id)) fetchArt(t).then(() => { if (crateDisc.userData.rec === r) drawCrateDiscLabel(r); });
      }
    }
  }
  // covers: selection first, then the sleeves leaning toward you, then just behind
  const near = [];
  for (let k = 0; k < n; k++) {
    const idx = start + k, rel = idx - crateState.sel, r = list[idx];
    if (!r || r.missing || rel < -4 || rel > 5 || sleeveOf(r)) continue;
    S.getMatrixAt(k, m); m.decompose(p, q, s);
    near.push({ idx, rel, p: p.clone(), q: q.clone(), sx: s.x, sy: s.y });   // #153: covers squash with their jackets
  }
  near.sort((a, b) => (Math.abs(a.rel) + (a.rel > 0 ? 0.5 : 0)) - (Math.abs(b.rel) + (b.rel > 0 ? 0.5 : 0)));
  assignCovers(list, near);
  const selRec = list[crateState.sel];
  if (shut || !selRec || selRec.missing || (held && held.rec === selRec) || copiesOut(selRec) >= COPIES || sleeveOf(selRec)) crateDisc.visible = false;
  S.instanceMatrix.needsUpdate = true;
  if (!CAMERA_ROLE && spect && spect.crate) spect.crate(crateView(list, start, n, shut));   // #218 the phone mirrors this view
}
// #229 sleeve dig (owner), #242 several sleeves in the open. Reach down into the selected sleeve (anywhere on it,
// edges and lower corners too, from 7 cm under the crate's top edge down to its floor) and grab (pinch / grip /
// trigger): the jacket comes up in your hand, keeping the grab pose (a lower corner makes it easy to turn round and
// read the back). The record peeks out of the opening; another hand on it slides it out along the sleeve, and once
// clear it is in that hand. Let go of a sleeve and it stays exactly where it is (no physics: on a case, in a milk
// crate, on a real table in passthrough); let go over the record crate and it goes back in. Up to 3 can lie about:
// a 4th sends the oldest back into the crate. Grab a lying sleeve anywhere on it to pick it up again, or slide its
// record out. Each sleeve: a card box, a 1024 px front and back, a disc with the record's own label.
const SLEEVE = { H: 0.315, PEEK: 0.05, OUT: 0.31, MAX_OUT: 3, HOME_NEAR: 0.10, ARM_CLEAR: 0.25, ARM_MS: 5000 };   // #247 auto-return: 10 cm, armed 25 cm clear or after 5 s
// #257 7" single sleeves: 184 mm (7.25") square
const SLEEVE7 = { ...SLEEVE, H: 0.184, PEEK: 0.03, OUT: 0.18 };
const sleeveDims = r => (r && r.size === 7 ? SLEEVE7 : SLEEVE);
const sleeves = [];   // { rec, g, mesh, disc, tex: [front, back], anchor, off, s, hasRec, slotM, back, placedT }
let sleeveOut = null;   // kept for older checks: the most recent sleeve (or null)
const sleeveCard = new THREE.MeshStandardMaterial({ color: 0xd9d2c3, roughness: 0.85 });
const sleeveVinyl = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.35, metalness: 0.1 });
const sleeveDiscGeo = new THREE.CylinderGeometry(REC.R, REC.R, REC.THICK, 64), sleeveLabelGeo = new THREE.CircleGeometry(REC.LABEL, 40);
const sleeveDiscGeo7 = new THREE.CylinderGeometry(REC7.R, REC7.R, REC7.THICK, 48), sleeveLabelGeo7 = new THREE.RingGeometry(REC7.HOLE, REC7.LABEL, 40);   // #257
function sleeveOf(r) { return sleeves.find(x => x.rec === r && !x.gone) || null; }
function canvasTex(size) { const c = document.createElement('canvas'); c.width = c.height = size; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function makeSleeve(r) {
  const fT = canvasTex(1024), bT = canvasTex(1024), lT = canvasTex(256);
  const front = new THREE.MeshStandardMaterial({ map: fT, roughness: 0.7 }), back = new THREE.MeshStandardMaterial({ map: bT, roughness: 0.8 });
  // box faces: +x, -x, +y (the opening edge), -y, +z (front cover, toward you in the crate), -z (back)
  const sz = sleeveDims(r), D = dimsOf(r), s7 = D === REC7;   // #257
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sz.H, sz.H, 0.003), [sleeveCard, sleeveCard, sleeveCard, sleeveCard, front, back]);
  mesh.castShadow = true; mesh.userData.sleeveBody = true;
  const disc = new THREE.Group(), dm = new THREE.Mesh(s7 ? sleeveDiscGeo7 : sleeveDiscGeo, sleeveVinyl); dm.rotation.x = Math.PI / 2; disc.add(dm);
  const lm = new THREE.MeshStandardMaterial({ map: lT, roughness: 0.8 });
  for (const zz of [1, -1]) { const l = new THREE.Mesh(s7 ? sleeveLabelGeo7 : sleeveLabelGeo, lm); l.position.z = zz * (D.THICK / 2 + 0.0002); if (zz < 0) l.rotation.y = Math.PI; disc.add(l); }
  const g = new THREE.Group(); g.add(mesh, disc); scene.add(g);
  const sl = { rec: r, sz, D, g, mesh, disc, tex: [fT, bT, lT], mats: [front, back, lm], anchor: null, off: null, s: sz.PEEK, hasRec: true, slotM: null, back: null, placedT: 0 };
  disc.position.set(0, sz.PEEK, 0);
  drawSleeveArt(sl); return sl;
}
function drawSleeveArt(sl) {
  const r = sl.rec, t = r.sides.A || r.sides.B, art = t && artCache.get(t.id);
  const g = sl.tex[0].image.getContext('2d');
  if (art) { const k = Math.max(1024 / art.width, 1024 / art.height); g.drawImage(art, 512 - art.width * k / 2, 512 - art.height * k / 2, art.width * k, art.height * k); }
  else if (r.size === 7) {   // #262 plain paper 45 sleeve with a real centre hole (the record inside shows through)
    drawPlain7(g, 1024, r, true);
    if (!sl.holeMap) {
      const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 256, 256); x.fillStyle = '#000'; x.beginPath(); x.arc(128, 128, 62, 0, Math.PI * 2); x.fill();
      sl.holeMap = new THREE.CanvasTexture(c); sl.tex.push(sl.holeMap);
      for (const m of [sl.mats[0], sl.mats[1]]) { m.alphaMap = sl.holeMap; m.alphaTest = 0.5; m.needsUpdate = true; }
      sl.mesh.material = [sleeveCard, sleeveCard, sleeveCard, sleeveCard, sl.mats[0], sl.mats[1]];
    }
  }
  else { const pm = coverPool.find(m => m.userData.rec === r); if (pm) g.drawImage(pm.userData.canvas, 0, 0, 1024, 1024); else { g.fillStyle = '#333'; g.fillRect(0, 0, 1024, 1024); } }
  sl.tex[0].needsUpdate = true;
  const b = sl.tex[1].image.getContext('2d');   // back: plain card with title and artist, unless the file has a Back cover (#231)
  b.fillStyle = '#d9d2c3'; b.fillRect(0, 0, 1024, 1024); b.fillStyle = '#2b2b2b'; b.textAlign = 'center';
  b.font = '700 60px system-ui'; fitText2Center(b, r.title || '', 512, 480, 880); b.font = '400 52px system-ui'; fitText2Center(b, r.artist || '', 512, 568, 880);
  if (r.size === 7 && !art) drawPlain7(b, 1024, r, true);   // #262 both sides of a paper sleeve
  sl.tex[1].needsUpdate = true;
  const bb = t && backBlobs.get(t.id);
  if (bb) createImageBitmap(bb).then(im => { if (sl.gone) return; const k = Math.max(1024 / im.width, 1024 / im.height); b.drawImage(im, 512 - im.width * k / 2, 512 - im.height * k / 2, im.width * k, im.height * k); im.close && im.close(); sl.tex[1].needsUpdate = true; }).catch(() => {});
  const lg = sl.tex[2].image.getContext('2d'), la = labelOf(t);   // the record's own label (#231)
  lg.fillStyle = '#c8202c'; lg.fillRect(0, 0, 256, 256);
  if (la) { const k = Math.max(256 / la.width, 256 / la.height); lg.drawImage(la, 128 - la.width * k / 2, 128 - la.height * k / 2, la.width * k, la.height * k); }
  lg.fillStyle = '#000'; lg.beginPath(); lg.arc(128, 128, 6, 0, Math.PI * 2); lg.fill(); sl.tex[2].needsUpdate = true;
}
function disposeSleeve(sl) {
  sl.gone = true; scene.remove(sl.g); sl.mesh.geometry.dispose();
  for (const t of sl.tex) t.dispose(); for (const m of sl.mats) m.dispose();
  const i = sleeves.indexOf(sl); if (i >= 0) sleeves.splice(i, 1);
  sleeveOut = sleeves[sleeves.length - 1] || null;
}
function selectedSlotPose() {   // the selected sleeve's pose, crate-local
  const S = crate.userData.sleeves, m = new THREE.Matrix4();
  const k = sleeveMap.indexOf(crateState.sel); if (k < 0) return null;
  S.getMatrixAt(k, m); const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(); m.decompose(p, q, sc);
  return { k, p, q, m };
}
// what a grab at P takes: a lying sleeve (anywhere on it) or the selected sleeve in the crate; null = neither
function sleeveGrabTest(P) {
  for (const sl of sleeves) {
    if (sl.anchor || sl.back) continue;
    sl.g.updateMatrixWorld(); const l = sl.g.worldToLocal(P.clone());
    if (Math.abs(l.x) < sl.sz.H / 2 + 0.02 && Math.abs(l.y) < sl.sz.H / 2 + 0.02 && Math.abs(l.z) < 0.04) return { sl };
  }
  { const mh = milkSleeveHit(P); if (mh) return mh; }   // #398 a sleeve standing in a milk crate (its top edge)
  if (!crateLidOpen() || !crateDisc.visible) return null;
  const r = currentList()[crateState.sel]; if (!r || r.missing || sleeveOf(r)) return null;
  const pose = selectedSlotPose(); if (!pose) return null;
  const cl = crate.worldToLocal(P.clone());
  // #274 (owner): grab the selected sleeve anywhere up to 1.5 cm above its top edge and the sleeve comes out with the
  // record inside; only the part of the record riding out above that is the record on its own (step 4 in xr.js)
  const top = pose.p.y + sleeveDims(r).H / 2;
  return Math.abs(cl.x) < sleeveDims(r).H / 2 + 0.02 && Math.abs(cl.z - pose.p.z) < 0.035 && cl.y > -0.01 && cl.y < top + 0.015 ? { crate: true } : null;   // #242 edges and lower corners too
}
function sleeveGrab(anchor, P) {
  const hit = P ? sleeveGrabTest(P) : { crate: true }; if (!hit) return false;
  let sl = hit.sl;
  if (!sl && hit.milk) {   // #398 out of a milk crate: that sleeve comes up in the hand from its slot
    const mc = hit.milk, r = mc.userData.sleeved[hit.k]; if (!r) return false;
    const P0 = milkSlotPose(mc, hit.k, r); mc.userData.sleeved.splice(hit.k, 1);
    sl = makeSleeve(r); sleeves.push(sl); sl.g.position.copy(P0.p); sl.g.quaternion.copy(P0.q);
    mc.updateMatrixWorld(); sl.g.applyMatrix4(mc.matrixWorld);
    layoutMilkSleeves(mc); saveMilkSleeves(mc);
  }
  if (!sl) {
    const r = currentList()[crateState.sel], pose = selectedSlotPose(); if (!r || !pose) return false;
    sl = makeSleeve(r); sleeves.push(sl);
    sl.g.position.copy(pose.p); sl.g.quaternion.copy(pose.q);
    crate.updateMatrixWorld(); sl.g.applyMatrix4(crate.matrixWorld);   // crate-local -> world
  }
  sl.g.updateMatrixWorld(); anchor.updateMatrixWorld();
  sl.anchor = anchor; sl.off = new THREE.Matrix4().copy(anchor.matrixWorld).invert().multiply(sl.g.matrixWorld);
  sl.grabT = performance.now(); sl.armed = false;   // #247 auto-return near the crate arms once it has clearly left
  refreshSleeveColliders();   // #243 the gear as it stands now
  sleeveOut = sl; layoutSleeves(); return true;
}
function sleeveHeldBy() { const sl = sleeves.find(x => x.anchor); return sl ? sl.anchor : null; }
// a hand on the record peeking out of any sleeve (held by another hand or lying): returns its start, or null
function sleeveSlideTest(P, anchor = null) {
  for (const sl of sleeves) {
    if (sl.back || !sl.hasRec || (anchor && sl.anchor === anchor)) continue;
    sl.g.updateMatrixWorld(); const l = sl.g.worldToLocal(P.clone());
    const top = sl.sz.H / 2, discTop = sl.s + sl.D.R;
    if (Math.abs(l.x) < sl.D.R && Math.abs(l.z) < 0.05 && l.y > top - 0.03 && l.y < discTop + 0.04) return { sl, y0: l.y, s0: sl.s };
  }
  return null;
}
// slide the record along its sleeve; 'out' when it is clear (the caller then takes it into that hand)
function sleeveSlideTo(P, g) {
  const sl = g.sl; if (!sl || sl.gone || sl.back || !sl.hasRec) return null;
  const l = sl.g.worldToLocal(P.clone());
  sl.s = Math.max(0, Math.min(sl.sz.OUT + 0.02, g.s0 + (l.y - g.y0)));
  sl.disc.position.y = sl.s;
  return sl.s >= sl.sz.OUT ? 'out' : 'in';
}
// the record left its sleeve into a hand (not through the crate's selection: the sleeve may come from any list)
function sleevePulled(g, attach) {
  const sl = g && g.sl; if (!sl) return null;
  sl.hasRec = false; sl.disc.visible = false;
  return pullRecord(sl.rec, attach);
}
function sleeveRelease(anchor) {   // let go: stays where it is; over the record crate it goes back in; max 3 lying about
  const sl = sleeves.find(x => x.anchor === anchor); if (!sl) return;
  sl.anchor = null; sl.placedT = performance.now();
  const c = crate.worldToLocal(sl.g.getWorldPosition(new THREE.Vector3()));
  if (crateLidOpen() && Math.abs(c.x) < CRATE.W / 2 && Math.abs(c.z) < CRATE.D / 2 && c.y > 0 && c.y < CRATE.H + 0.12) { sleeveReturn(sl); return; }
  if (sl.hasRec) for (const mc of milks()) {   // #398 let go over a milk crate: it stands in at the front of its row
    const l = mc.worldToLocal(sl.g.getWorldPosition(new THREE.Vector3())), L = mc.userData.sleeved || (mc.userData.sleeved = []);
    if (Math.abs(l.x) < MILK.W / 2 && Math.abs(l.z) < MILK.D / 2 && l.y > 0 && l.y < MILK.H + 0.2 && L.length < MS.MAX) {
      L.push(sl.rec); disposeSleeve(sl); layoutMilkSleeves(mc); saveMilkSleeves(mc); layoutSleeves(); return;
    }
  }
  const lying = sleeves.filter(x => !x.anchor && !x.back).sort((a, b) => a.placedT - b.placedT);
  while (lying.length > SLEEVE.MAX_OUT) sleeveReturn(lying.shift());
}
// ---- #398 (owner) records in their sleeves in the milk crates, standing in a row like the record crate (no bare discs):
// one instanced mesh of plain card jackets per crate (one draw call, up to 40), and album covers only on the 10 front-most
// (10 small 256 px textures per crate, like the record crate's COVER_N), so a full crate costs about what the record crate
// does. The row leans back against the far wall (6 mm pitch), tops 1.7 cm over the rim. Grip (hands: pinch) a sleeve by
// its top edge to take it out (it becomes an ordinary lying sleeve: slide the record out, put it back...); let a sleeve go
// over a milk crate and it stands in at the front of the row. The row is kept per crate ('vire.milkSleeves.<key>', by file
// + title|artist like the playlists) and comes back after a reload.
const MS = { MAX: 40, PITCH: 0.0062, TILT: -0.10, FLOOR: 0.008 };
const msGeo = new THREE.BoxGeometry(SLEEVE.H, SLEEVE.H, 0.003), msCoverGeo = new THREE.PlaneGeometry(0.312, 0.312), _msX = new THREE.Vector3(1, 0, 0);
function milkSleeveMesh(mc) {
  if (mc.userData.sleeveIM) return mc.userData.sleeveIM;
  const im = new THREE.InstancedMesh(msGeo, sleeveCard, MS.MAX); im.count = 0; im.frustumCulled = false; im.castShadow = true;
  im.userData.move = mc.userData.key; im.userData.milkSleeves = true; mc.add(im); mc.userData.sleeveIM = im; return im;
}
function milkSlotPose(mc, k, r) {   // crate-local pose of slot k (back wall first)
  const sh = sleeveDims(r).H, ks = sh / SLEEVE.H, I = mc.userData.inner, t = MS.TILT;
  const z0 = -I.z + 0.0035 + sh / 2 * Math.sin(-t);
  return { p: new THREE.Vector3(0, MS.FLOOR + sh / 2 * Math.cos(t), z0 + k * MS.PITCH), q: new THREE.Quaternion().setFromAxisAngle(_msX, t), ks };
}
function layoutMilkSleeves(mc) {
  const list = mc.userData.sleeved || [], pend = mc.userData.landing;
  const im = list.length ? milkSleeveMesh(mc) : mc.userData.sleeveIM; if (!im) return;
  const m = new THREE.Matrix4(), sc = new THREE.Vector3();
  im.count = list.length;
  list.forEach((r, k) => { const P = milkSlotPose(mc, k, r); if (pend && pend.has(r)) sc.set(0, 0, 0); else sc.set(P.ks, P.ks, 1); m.compose(P.p, P.q, sc); im.setMatrixAt(k, m); });
  im.instanceMatrix.needsUpdate = true;
  let pool = mc.userData.coverPool;
  if (!pool && list.length) pool = mc.userData.coverPool = Array.from({ length: COVER_N }, () => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const cm = new THREE.Mesh(msCoverGeo, new THREE.MeshStandardMaterial({ map: t, roughness: 0.75 }));
    cm.visible = false; cm.userData = { canvas: c, tex: t, rec: null, hasArt: false, move: mc.userData.key }; mc.add(cm); return cm;
  });
  if (!pool) return;
  const shown = []; for (let k = list.length - 1; k >= 0 && shown.length < COVER_N; k--) if (!(pend && pend.has(list[k]))) shown.push(k);
  pool.forEach((cm, i) => {
    const k = shown[i]; if (k === undefined) { cm.visible = false; return; }
    const r = list[k], P = milkSlotPose(mc, k, r), t = r.sides.A || r.sides.B;
    cm.position.copy(P.p).add(new THREE.Vector3(0, 0, 0.0021).applyQuaternion(P.q)); cm.quaternion.copy(P.q); cm.scale.set(P.ks, P.ks, 1); cm.visible = true;   // just in front of the 3 mm jacket
    if (cm.userData.rec !== r || (!cm.userData.hasArt && t && artCache.get(t.id))) { cm.userData.rec = r; drawJacket(cm, r); }
    if (t && !t.missing && !artCache.has(t.id)) fetchArt(t).then(a => { if (a && cm.userData.rec === r) drawJacket(cm, r); });
  });
}
function milkSleeveHit(P) {   // a grab at the top edge of a sleeve standing in a milk crate -> { milk, k }
  for (const mc of milks()) {
    const L = mc.userData.sleeved; if (!L || !L.length || flyingMilk.has(mc)) continue;
    const l = mc.worldToLocal(P.clone());
    if (Math.abs(l.x) > MILK.W / 2 + 0.02 || Math.abs(l.z) > MILK.D / 2 + 0.02 || l.y < MILK.H - 0.10 || l.y > MILK.H + 0.06) continue;
    let best = -1, bd = 0.03;
    L.forEach((r, k) => {
      if (mc.userData.landing && mc.userData.landing.has(r)) return;
      const Ps = milkSlotPose(mc, k, r), zAt = Ps.p.z + (l.y - Ps.p.y) * Math.tan(MS.TILT), d = Math.abs(l.z - zAt);
      if (d <= bd) { bd = d; best = k; }   // ties: the front-most
    });
    if (best >= 0) return { milk: mc, k: best };
  }
  return null;
}
function saveMilkSleeves(mc) { if (CAMERA_ROLE) return; try { localStorage.setItem('vire.milkSleeves.' + mc.userData.key, JSON.stringify((mc.userData.sleeved || []).map(plItem))); } catch {} }
function forgetMilkSleeves(key) { try { localStorage.removeItem('vire.milkSleeves.' + key); } catch {} }
function restoreMilkSleeves() {
  if (CAMERA_ROLE || !lib) return; const find = plMaps();
  for (const mc of [milk, ...Object.values(extraMilk)]) {
    let items = []; try { items = JSON.parse(localStorage.getItem('vire.milkSleeves.' + mc.userData.key) || '[]'); } catch {}
    mc.userData.sleeved = plResolve(items, find).slice(0, MS.MAX); mc.userData.landing = null; layoutMilkSleeves(mc);
  }
}
// the jump: a sleeved record (one box, its cover on a 256 px canvas) rises out of the record crate, arcs over with one
// flip, and drops into its slot from 14 cm above. Up to 6 in the air, reused.
const msFly = [];
function msFlyer() {
  let f = msFly.find(x => !x.busy); if (f) return f; if (msFly.length >= 6) return null;
  const c = document.createElement('canvas'); c.width = c.height = 256; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(msGeo, [sleeveCard, sleeveCard, sleeveCard, sleeveCard, new THREE.MeshStandardMaterial({ map: t, roughness: 0.75 }), sleeveCard]);
  mesh.visible = false; mesh.castShadow = true; scene.add(mesh);
  f = { mesh, jk: { userData: { canvas: c, tex: t, hasArt: false } }, busy: false }; msFly.push(f); return f;
}
function launchSleeveToMilk(r, mc) {
  const L = mc.userData.sleeved || (mc.userData.sleeved = []); if (L.length >= MS.MAX) return false;
  const f = msFlyer(); if (!f) return false;
  L.push(r); (mc.userData.landing || (mc.userData.landing = new Set())).add(r); layoutMilkSleeves(mc);
  f.r = r; drawJacket(f.jk, r);
  const t = r.sides.A || r.sides.B; if (t && !t.missing && !artCache.has(t.id)) fetchArt(t).then(a => { if (a && f.r === r) drawJacket(f.jk, r); });
  crate.updateMatrixWorld(true);
  f.ps = crate.localToWorld(new THREE.Vector3(0, CRATE.H * 0.55, 0.02)); f.qs = crate.getWorldQuaternion(new THREE.Quaternion());
  f.mc = mc; f.t = 0; f.busy = true; f.spin = Math.random() < 0.5 ? 1 : -1;
  const P = milkSlotPose(mc, L.length - 1, r); mc.updateMatrixWorld(true);
  const d = f.ps.distanceTo(mc.localToWorld(P.p.clone())); f.tf = 0.55 + Math.min(0.3, d * 0.22); f.arc = 0.28 + d * 0.18;
  f.mesh.scale.setScalar(P.ks); f.mesh.position.copy(f.ps); f.mesh.quaternion.copy(f.qs); f.mesh.visible = true;
  layoutSleeves(); return true;
}
const _msA = new THREE.Vector3(), _msQ = new THREE.Quaternion(), _msQ2 = new THREE.Quaternion();
function stepMilkFlyers(dt) {
  for (const f of msFly) {
    if (!f.busy) continue;
    const mc = f.mc, L = mc.userData.sleeved || [], k = L.indexOf(f.r);
    if (!mc.parent || k < 0) { f.busy = false; f.mesh.visible = false; continue; }
    f.t += dt;
    const P = milkSlotPose(mc, k, f.r); mc.updateMatrixWorld();
    const pe = mc.localToWorld(P.p.clone()), qe = mc.getWorldQuaternion(_msQ).multiply(P.q), above = _msA.copy(pe); above.y += 0.14;
    const u = Math.min(1, f.t / f.tf);
    if (u < 1) {
      f.mesh.position.lerpVectors(f.ps, above, u); f.mesh.position.y += f.arc * 4 * u * (1 - u);
      const sp = u * u * (3 - 2 * u);
      f.mesh.quaternion.slerpQuaternions(f.qs, qe, sp).multiply(_msQ2.setFromAxisAngle(_msX, f.spin * Math.PI * 2 * sp));
    } else {
      const dd = Math.min(1, (f.t - f.tf) / 0.12);
      f.mesh.position.lerpVectors(above, pe, dd * dd); f.mesh.quaternion.copy(qe);
      if (dd >= 1) { f.busy = false; f.mesh.visible = false; if (mc.userData.landing) mc.userData.landing.delete(f.r); layoutMilkSleeves(mc); saveMilkSleeves(mc); }
    }
  }
}
function sleeveReturn(sl) {   // fly back into its slot (shrinks away if its record isn't in the crate's list now)
  if (!sl || sl.back) return;
  sl.anchor = null; layoutSleeves();
  const m = sl.slotM ? new THREE.Matrix4().multiplyMatrices(crate.matrixWorld, sl.slotM) : null;
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  if (m) m.decompose(p, q, sc); else { p.copy(sl.g.position); q.copy(sl.g.quaternion); }
  sl.back = { t: 0, p0: sl.g.position.clone(), q0: sl.g.quaternion.clone(), p, q, shrink: !m };
}
function stepSleeves(dt) {
  for (const sl of [...sleeves]) {
    if (sl.back) {
      const b = sl.back; b.t = Math.min(1, b.t + dt / 0.35); const e = b.t * b.t * (3 - 2 * b.t);
      sl.g.position.lerpVectors(b.p0, b.p, e); sl.g.quaternion.slerpQuaternions(b.q0, b.q, e);
      if (b.shrink) sl.g.scale.setScalar(Math.max(0.01, 1 - e));
      if (sl.hasRec && sl.s > 0.001) { sl.s = Math.max(0, sl.s - dt * 0.6); sl.disc.position.y = sl.s; }
      if (b.t >= 1) { disposeSleeve(sl); layoutSleeves(); }
      continue;
    }
    if (sl.anchor) {
      sl.anchor.updateMatrixWorld(); sleeveFollow(sl);   // #243 kinematic: stopped by the gear
      // #247 (owner): a held sleeve brought within 10 cm (4 in) of the record crate goes back in by itself. Armed only
      // once it has clearly left: 25 cm clear of the crate, or 5 s after the grab, so pulling one out never sends it
      // straight back.
      const d = sleeveCrateDist(sl);
      if (!sl.armed && (d > SLEEVE.ARM_CLEAR || performance.now() - (sl.grabT || 0) > SLEEVE.ARM_MS)) sl.armed = true;
      if (sl.armed && d < SLEEVE.HOME_NEAR && crateLidOpen()) { const a = sl.anchor; sleeveReturn(sl); if (xr && xr.buzzAnchor) xr.buzzAnchor(a, 0.4, 30); }
    }
  }
}
// #247 nearest gap between the sleeve (its 4 corners and centre) and the record crate's box (crate space)
function sleeveCrateDist(sl) {
  sl.g.updateMatrixWorld(); let best = Infinity; const h = sl.sz.H / 2, v = _sc.v2 || (_sc.v2 = new THREE.Vector3());
  for (const [x, y] of [[0, 0], [-h, -h], [h, -h], [-h, h], [h, h]]) {
    crate.worldToLocal(sl.g.localToWorld(v.set(x, y, 0)));
    const dx = Math.max(0, Math.abs(v.x) - CRATE.W / 2), dz = Math.max(0, Math.abs(v.z) - CRATE.D / 2), dy = Math.max(0, -v.y, v.y - CRATE.H);
    best = Math.min(best, Math.hypot(dx, dy, dz));
  }
  return best;
}
// #242 tidy-up (each VR / passthrough start, as the Quest may keep the page alive between sessions): sleeves, records
// in hands, on the floor, on cases, spinning on a finger and in the milk crates go back into the crate; a record stays
// on a deck only while that deck's motor runs (a playing set is never interrupted).
function tidyRecords() {
  sleevesHome(); spidersHome();   // #256
  if (held) returnHeld();
  for (const L of [...loose]) { const g = L.rec.group; if (g.parent) g.parent.remove(g); L.rec.dispose(); }
  loose.length = 0;
  for (const mc of milks()) if (mc.userData.records) mc.userData.records.length = 0;
  for (const d of decks) if (d.record && !d.motorOn) { pickUpFromDeck(d, null); returnHeld(); }
  layoutSleeves(); drawCrateScreen();
  refreshSleeveColliders();   // #250 works out the gear's pieces now (once), not on the first sleeve grab
}
// #243 sleeves are kinematic (owner): no gravity, the hand moves them, but they can't go into the gear. The decks, the
// mixer and the flight case are oriented boxes measured from their own meshes when a sleeve is grabbed (records on
// them, the tablet and invisible parts left out); the record crate and milk crates are not colliders (sleeves go in
// there). Each frame a held sleeve moves toward the hand's pose in steps of at most 2 cm and is pushed out of any box
// along the shortest way (separating-axis test), so it stops at a surface and slides along it while the hand goes on
// through; it catches up when the hand comes back. A controller buzzes on first contact.
let sleeveColliders = [];
const _sc = { m: new THREE.Matrix4(), inv: new THREE.Matrix4(), b: new THREE.Box3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
function localBox(obj) {   // obj-space box of its visible meshes, skipping records and the tablet
  obj.updateMatrixWorld(true); _sc.inv.copy(obj.matrixWorld).invert();
  const box = new THREE.Box3(), skip = new Set([mixer.userData.tablet].filter(Boolean));
  const walk = o => {
    if (!o.visible || skip.has(o) || o.userData.record || o.userData.loose) return;
    if (o.isMesh && o.geometry && !o.isInstancedMesh) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      _sc.b.copy(o.geometry.boundingBox).applyMatrix4(_sc.m.multiplyMatrices(_sc.inv, o.matrixWorld)); box.union(_sc.b);
    }
    for (const c of o.children) walk(c);
  };
  walk(obj); return box.isEmpty() ? null : box;
}
// #247 (owner: hug the gear tighter): one box per visible part instead of one around everything. Parts under 5 cm
// (knobs, buttons, screws) are left out; a box that wraps another one holding 80 %+ of its volume (the flight case's
// alu edge trim around the panels) gives way to the inner one; boxes inside another are dropped. So a sleeve can
// lie on the plinth next to the tonearm and go right up to the case's panels.
// #250 the connected pieces of a geometry (vertices welded at 0.1 mm), as boxes in the geometry's own space,
// worked out once per geometry. A piece is 'round' when its outline in plan is about as far from its centre at
// 45 deg as along the axes (a disc / cylinder, not a square block).
function partBoxes(geo) {
  if (geo.userData.__parts) return geo.userData.__parts;
  const pos = geo.attributes.position, n = pos.count, idx = geo.index, par = new Int32Array(n);
  for (let i = 0; i < n; i++) par[i] = i;
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  const seen = new Map();
  for (let i = 0; i < n; i++) { const k = Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4); const j = seen.get(k); if (j !== undefined) join(i, j); else seen.set(k, i); }
  if (idx) for (let t = 0; t < idx.count; t += 3) { join(idx.getX(t), idx.getX(t + 1)); join(idx.getX(t), idx.getX(t + 2)); }
  else for (let t = 0; t + 2 < n; t += 3) { join(t, t + 1); join(t, t + 2); }
  const boxes = new Map(), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { const c = find(i); let b = boxes.get(c); if (!b) boxes.set(c, b = new THREE.Box3()); b.expandByPoint(v.fromBufferAttribute(pos, i)); }
  const out = [...boxes.values()];
  // roundness: farthest vertex along the 45 deg diagonal vs the half-width (a disc ~0.71, a square 1.0)
  const diag = new Map(); for (let i = 0; i < n; i++) { const c = find(i), b = boxes.get(c), cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2; const d = Math.abs((pos.getX(i) - cx) + (pos.getZ(i) - cz)) / Math.SQRT2; if (!(diag.get(c) > d)) diag.set(c, d); }
  for (const [c, b] of boxes) { const hw = (b.max.x - b.min.x) / 2; b.userData_round = hw > 0 && diag.get(c) < 0.85 * hw * Math.SQRT2; }
  return (geo.userData.__parts = out);
}
function localBoxes(obj) {
  obj.updateMatrixWorld(true); _sc.inv.copy(obj.matrixWorld).invert();
  const out = [], skip = new Set([mixer.userData.tablet].filter(Boolean)), sz = new THREE.Vector3();
  const walk = o => {
    if (!o.visible || skip.has(o) || o.userData.record || o.userData.loose) return;
    if (o.isMesh && o.geometry && !o.isInstancedMesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (!mats.every(x => x && x.visible === false)) {
        _sc.m.multiplyMatrices(_sc.inv, o.matrixWorld);
        for (const pb of partBoxes(o.geometry)) {   // #250 each separate piece of a merged mesh (four feet, not one slab)
          const b = pb.clone().applyMatrix4(_sc.m); b.getSize(sz);
          const big = Math.max(sz.x, sz.y, sz.z); if (big < 0.03 || big >= 3) continue;
          // round pieces (feet, platter: width = depth, not taller than wide) get a box 10 % narrower, about the
          // area of the disc, so the corners poke out only a few mm past the rim
          if (Math.abs(sz.x - sz.z) < 0.1 * Math.max(sz.x, sz.z) && sz.y < 1.2 * sz.x && pb.userData_round) {
            const c = b.getCenter(_sc.v); b.min.x = c.x - sz.x * 0.45; b.max.x = c.x + sz.x * 0.45; b.min.z = c.z - sz.z * 0.45; b.max.z = c.z + sz.z * 0.45;
          }
          out.push(b);
        }
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(obj);
  const vol = b => { b.getSize(sz); return Math.max(sz.x, 1e-3) * Math.max(sz.y, 1e-3) * Math.max(sz.z, 1e-3); };
  const keep = out.filter(a => !out.some(b => b !== a && a.containsBox(b) && vol(b) >= 0.8 * vol(a)));   // shells give way to what they wrap
  return keep.filter((a, i) => !keep.some((b, j) => j !== i && b.containsBox(a) && !(a.equals(b) && j > i)));
}
function refreshSleeveColliders() {
  sleeveColliders = [];
  for (const o of [...deckGroups, mixer, ...Object.values(cases).map(c => c.group)]) {
    for (const b of localBoxes(o)) {
      // #281 (owner): no colliders on a turntable's two front feet, so a sleeve or record slides in under the deck
      // (it may cut through those feet); the back feet still stop it. Feet = the low pieces (top under 3 cm), front = +z.
      if (deckGroups.includes(o) && b.max.y < 0.03 && b.min.z > 0.05) continue;
      sleeveColliders.push({ o, b });
    }
  }
}
// an oriented box as centre, three unit axes and half sizes
function obbOf(matrixWorld, box, out) {
  const e = matrixWorld.elements, c = box.getCenter(_sc.v).applyMatrix4(matrixWorld);
  out.c.copy(c);
  for (let i = 0; i < 3; i++) { out.a[i].set(e[i * 4], e[i * 4 + 1], e[i * 4 + 2]); const L = out.a[i].length(); out.a[i].multiplyScalar(1 / L); out.h[i] = (box.max.getComponent(i) - box.min.getComponent(i)) / 2 * L; }
  return out;
}
const mkObb = () => ({ c: new THREE.Vector3(), a: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], h: [0, 0, 0] });
const _oA = mkObb(), _oB = mkObb(), _ax = new THREE.Vector3(), _d = new THREE.Vector3();
// shortest push that separates A from B (null when they don't overlap)
function obbPush(A, B) {
  _d.subVectors(A.c, B.c); let best = Infinity, bx = 0, by = 0, bz = 0;
  const test = ax => {
    const L = ax.length(); if (L < 1e-6) return true; ax.multiplyScalar(1 / L);
    let ra = 0, rb = 0; for (let i = 0; i < 3; i++) { ra += A.h[i] * Math.abs(A.a[i].dot(ax)); rb += B.h[i] * Math.abs(B.a[i].dot(ax)); }
    const dist = _d.dot(ax), o = ra + rb - Math.abs(dist); if (o <= 0) return false;
    if (o < best) { best = o; const sg = dist < 0 ? -1 : 1; bx = ax.x * sg; by = ax.y * sg; bz = ax.z * sg; }
    return true;
  };
  for (let i = 0; i < 3; i++) { if (!test(_ax.copy(A.a[i]))) return null; if (!test(_ax.copy(B.a[i]))) return null; }
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (!test(_ax.crossVectors(A.a[i], B.a[j]))) return null;
  return best === Infinity ? null : new THREE.Vector3(bx, by, bz).multiplyScalar(best + 0.001);
}
function sleeveBox(sl) {   // the sleeve plus the record peeking out of it, sleeve-local
  const H = sl.sz.H, top = sl.hasRec ? Math.max(H / 2, sl.s + sl.D.R) : H / 2;
  return new THREE.Box3(new THREE.Vector3(-H / 2, -H / 2, -0.004), new THREE.Vector3(H / 2, top, 0.004));
}
function sleeveDepen(sl, pos, q, sb) {   // push pos out of every collider (a few passes); true if it touched one
  let hit = false;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    _sc.m.compose(pos, q, _sc.s.set(1, 1, 1)); obbOf(_sc.m, sb, _oA);
    const rA = Math.hypot(_oA.h[0], _oA.h[1], _oA.h[2]);
    for (const C of sleeveColliders) {
      obbOf(C.o.matrixWorld, C.b, _oB);
      if (_oB.c.distanceTo(_oA.c) > rA + Math.hypot(_oB.h[0], _oB.h[1], _oB.h[2]) + 0.01) continue;   // far apart: skip the full test
      const push = obbPush(_oA, _oB);
      if (push) { pos.add(push); _oA.c.add(push); hit = moved = true; }
    }
    if (!moved) break;
  }
  return hit;
}
function sleeveFollow(sl) {   // the held sleeve toward the hand, stopped by the gear
  const tp = new THREE.Vector3(), tq = new THREE.Quaternion(), ts = new THREE.Vector3();
  new THREE.Matrix4().multiplyMatrices(sl.anchor.matrixWorld, sl.off).decompose(tp, tq, ts);
  if (!sleeveColliders.length) { sl.g.position.copy(tp); sl.g.quaternion.copy(tq); return; }
  const sb = sleeveBox(sl), p = sl.g.position.clone(), q0 = sl.g.quaternion.clone();
  // steps of at most 1.5 cm (and 10 deg), so a push-out always points back the way the sleeve came (never through)
  const n = Math.min(40, Math.max(1, Math.ceil(p.distanceTo(tp) / 0.015), Math.ceil(q0.angleTo(tq) / 0.17)));
  let hit = false; const q = new THREE.Quaternion(), step = new THREE.Vector3();
  for (let k = 1; k <= n; k++) {
    step.subVectors(tp, p); const len = step.length();   // never more than 1.5 cm a step (a blocked sleeve never leaps)
    if (len > 0.015) step.multiplyScalar(0.015 / len);
    p.add(step); q.slerpQuaternions(q0, tq, k / n);
    if (sleeveDepen(sl, p, q, sb)) hit = true;
  }
  sl.g.position.copy(p); sl.g.quaternion.copy(q);
  if (hit && !sl.touch && xr && xr.buzzAnchor) xr.buzzAnchor(sl.anchor, 0.3, 20);
  sl.touch = hit;
}
// #256 45 adapters ('spiders'): each deck's lives in its top-left recess. Grab it (grip / pinch), let go over a
// spindle and it sits on it (riding the platter), over an empty recess and it drops in, anywhere else and it stays
// where it is (no physics, like the sleeves). Tidy-up at VR start puts them home.
const _spv = new THREE.Vector3(), _sps = new THREE.Vector3(), _spm = new THREE.Matrix4();
const spiders = decks.map(d => d.g.userData.spider ? { d, g: d.g.userData.spider, h: d.g.userData.spiderH || 0.003, anchor: null, off: null, on: null, home: d } : null).filter(Boolean);
for (const s of spiders) s.d.recess = s;
function spiderGrabTest(P) {
  for (const s of spiders) { if (s.anchor || (s.on && s.on.record)) continue; s.g.getWorldPosition(_spv); if (_spv.distanceTo(P) < 0.035) return s; }   // #260 not from under a record
  return null;
}
function spiderGrab(s, anchor) {
  if (s.on) { s.on.spiderOn = null; s.on = null; }
  for (const d of decks) if (d.recess === s) d.recess = null;
  rig.attach(s.g); anchor.updateMatrixWorld(); s.g.updateMatrixWorld();
  s.anchor = anchor; s.off = new THREE.Matrix4().copy(anchor.matrixWorld).invert().multiply(s.g.matrixWorld);
}
function stepSpiders() {
  for (const s of spiders) if (s.anchor) {
    s.anchor.updateMatrixWorld(); _spm.multiplyMatrices(s.anchor.matrixWorld, s.off);
    s.g.parent.updateMatrixWorld(); _spm.premultiply(new THREE.Matrix4().copy(s.g.parent.matrixWorld).invert()); _spm.decompose(s.g.position, s.g.quaternion, _sps);
  }
}
function spiderOnSpindle(s, d) {
  const u = d.g.userData; u.platter.add(s.g);
  s.g.position.set(0, (u.platterSurface - u.platter.position.y) + s.h / 2, 0); s.g.quaternion.identity();   // #260 on the mat (a 45 goes round it)
  s.on = d; d.spiderOn = s;
}
function spiderToRecess(s, d) {
  const u = d.g.userData; d.g.add(s.g); s.g.position.copy(u.spiderHome.p); s.g.quaternion.copy(u.spiderHome.q); d.recess = s;
}
function spiderRelease(anchor) {
  const s = spiders.find(x => x.anchor === anchor); if (!s) return;
  s.anchor = null; const p = s.g.getWorldPosition(new THREE.Vector3());
  for (const d of decks) {
    const u = d.g.userData, l = d.g.worldToLocal(p.clone());
    if (!d.spiderOn && Math.hypot(l.x - DECK.spindle.x, l.z - DECK.spindle.z) < 0.03 && l.y > u.platterSurface - 0.03 && l.y < u.platterSurface + 0.08) { spiderOnSpindle(s, d); return; }
    if (!d.recess && u.spiderHome && l.distanceTo(u.spiderHome.p) < 0.045) { spiderToRecess(s, d); return; }
  }
  // anywhere else: it stays put (already in rig space), turned level
  const e = new THREE.Euler().setFromQuaternion(s.g.quaternion, 'YXZ'); s.g.quaternion.setFromEuler(e.set(0, e.y, 0, 'YXZ'));
}
// #262 the phone mirrors the adapters: where each one is (recess / spindle of deck i / free in rig space)
function spidersState() {
  const r4 = v => Math.round(v * 1e4) / 1e4;
  return spiders.map(s => s.on ? ['s', decks.indexOf(s.on)] : decks.find(d => d.recess === s) ? ['r', decks.findIndex(d => d.recess === s)]
    : ['f', ...s.g.position.toArray().map(r4), ...s.g.quaternion.toArray().map(r4)]);
}
function spidersApply(a) {
  if (!Array.isArray(a)) return;
  for (const d of decks) { d.recess = null; d.spiderOn = null; }
  spiders.forEach((s, i) => {
    const e = a[i]; if (!e) return; s.on = null; s.anchor = null;
    if (e[0] === 's' && decks[e[1]]) spiderOnSpindle(s, decks[e[1]]);
    else if (e[0] === 'r' && decks[e[1]]) spiderToRecess(s, decks[e[1]]);
    else if (e[0] === 'f') { rig.add(s.g); s.g.position.set(e[1], e[2], e[3]); s.g.quaternion.set(e[4], e[5], e[6], e[7]); }
  });
}
function spidersHome() {
  for (const s of spiders) { s.anchor = null; if (s.on) { s.on.spiderOn = null; s.on = null; } }
  for (const d of decks) d.recess = null;
  for (const s of spiders) spiderToRecess(s, s.home);
}
function sleevesHome() { for (const sl of [...sleeves]) disposeSleeve(sl); layoutSleeves(); }   // #242 tidy-up: all back at once
// #350 finger-walking through the crate (xr.js): one record per step; while the hand keeps walking the current record
// stays down in its sleeve (nothing riding out to catch the fingers), and pops up 0.45 s after the hand pauses
let walkT = 0;
function crateWalkStep(delta) {
  if (!crateLidOpen()) return false;
  const list = currentList(); if (!list.length) return false;
  const was = crateState.sel; crateState.walking = true; crateSelect(delta);
  clearTimeout(walkT); walkT = setTimeout(() => { crateState.walking = false; layoutSleeves(); }, 450);
  return crateState.sel !== was;
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
  plUI.view = 'list'; if (search.target) { search.target = null; search.kb = false; }   // #392
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
  try { for (const mc of milks()) if (mc.userData.sleeved) for (const x of mc.userData.sleeved) if (x === r) n++; } catch (e) {}   // #398 standing in a milk crate
  return n;
}
// attach: optional Object3D (an XR hand/controller anchor) the record follows; none = desktop camera hold
function pullSelected(attach = null) {
  const r = currentList()[crateState.sel];
  if (!r) return null;
  if (!crateLidOpen() && !(held && held.rec === r)) { toast('Open the crate lid first'); return null; }
  return pullRecord(r, attach);
}
// #242 a given record into a hand (the crate's selection, or the record slid out of a lying sleeve)
function pullRecord(r, attach = null) {
  if (!r) return null;
  if (r.missing) { toast(`Can't find this track's file (${decodeURIComponent(r.sides.A ? r.sides.A.location : r.sides.B.location).slice(-60)})`, 3500); return null; }
  if (held && held.rec === r) { held.attach = attach; return held; }
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
  r.disc.position.x = 0; d.wob = 0;   // #260 off the spindle: centred in the hand again
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
  // #228 let go flat over an upright finger of the other hand: it spins on the fingertip
  if (renderer.xr.isPresenting) {
    const n = discNormal(held, _fsN), up = _fsU.copy(n).multiplyScalar(n.y >= 0 ? 1 : -1);
    const F = Math.abs(n.y) > 0.7 ? spinFingerFor(_rc, up, held.attach) : null;
    if (F) {
      let w = held.angVel ? held.angVel.dot(up) : 0; if (Math.abs(w) < SPIN.MIN_START) w = (w < 0 ? -1 : 1) * SPIN.MIN_START;
      const r = held; throwRecord(r); held = null;
      startSpin(loose[loose.length - 1], F, w); layoutSleeves(); return;
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
// #228 finger spin (owner): balance a record on an upright index finger and spin it like a basketball.
// Start: hold a record roughly flat with one hand, put the other hand's straight index finger under the centre hole
// (pointing up), and let go: it sits on the fingertip and spins (the wrist's twist at release sets the speed, at
// least ~1.4 turns a second). A record thrown or dropped flat onto an upright finger is caught the same way.
// While it spins: any other fingertip or controller tip brushing the rim along the edge spins it faster (or slows
// it if it goes against it); it wobbles more as it slows, and slides off when the finger tilts past ~40 deg, jerks,
// tracking loses the finger, or the spin dies. Pinch it to take it. Hands only for the finger (controllers can flick).
const SPIN = { MIN_START: 9, MAX: 45, DROP_W: 2.5, TILT_DROP: 1.05, CATCH_R: 0.03 };   // #242 falls off past ~60 deg of finger tilt (was 40)
const _fsN = new THREE.Vector3(), _fsA = new THREE.Vector3(), _fsB = new THREE.Vector3(), _fsU = new THREE.Vector3(), _fsQ = new THREE.Quaternion(), _fsQ2 = new THREE.Quaternion();
function discNormal(rec, out) { return out.set(0, 1, 0).applyQuaternion(rec.mesh.getWorldQuaternion(_fsQ)).normalize(); }
function spinFingerFor(c, nUp, exclude) {   // a straight index finger pointing up, its tip just under the centre hole
  if (!xr || !xr.fingers || !renderer.xr.isPresenting) return null;
  for (const F of xr.fingers()) {
    if (exclude && F.st.anchor === exclude) continue;
    if (F.dir.y < 0.82) continue;   // within ~35 deg of straight up
    _fsA.copy(c).sub(F.tip); const h = _fsA.dot(nUp), rad = _fsA.addScaledVector(nUp, -h).length();
    if (rad < SPIN.CATCH_R && h > -0.02 && h < 0.05) return F;
  }
  return null;
}
function startSpin(L, F, w) {
  L.spin = { F, w: Math.max(-SPIN.MAX, Math.min(SPIN.MAX, w)), ph: Math.random() * 6.28, last: F.tip.clone(), fv: new THREE.Vector3(), fvSet: false, lost: 0 };
  L.resting = false; L.vel.set(0, 0, 0); L.ang.set(0, 0, 0);
  if (xr.buzz) xr.buzz(F.st, 0.3, 30);
}
function dropSpin(L, upAx, push) {
  const S = L.spin; L.spin = null;
  L.vel.copy(S.fv); if (push) L.vel.add(_fsB.set(push.x, 0, push.z).multiplyScalar(0.8));
  L.ang.copy(upAx).multiplyScalar(S.w); L.resting = false;
}
function stepSpin(L, dt) {
  const S = L.spin, F = S.F, g = L.rec.group;
  const n = discNormal(L.rec, _fsN), face = n.y >= 0 ? 1 : -1;
  const upAx = _fsU.copy(n).multiplyScalar(face);
  if (!F.ok) { if ((S.lost += dt) > 0.15) return dropSpin(L, upAx); } else S.lost = 0;   // bridge tracking blips
  if (dt > 0 && F.ok) {
    const v = _fsA.copy(F.tip).sub(S.last).multiplyScalar(1 / dt);
    const acc = S.fvSet ? v.distanceTo(S.fv) / dt : 0;
    S.fv.lerp(v, S.fvSet ? 0.5 : 1); S.fvSet = true;
    if (acc > 45) return dropSpin(L, upAx);   // a jerk of the finger throws it off
  }
  S.last.copy(F.tip);
  const tilt = Math.acos(Math.max(-1, Math.min(1, F.dir.y)));
  if (tilt > SPIN.TILT_DROP) return dropSpin(L, upAx, F.dir);
  // flicks: other tips on the rim, moving along the edge
  if (xr.tips && dt > 0) for (const t of xr.tips()) {
    const prev = t.st._spinPrev || (t.st._spinPrev = t.p.clone());
    if (t.st !== F.st) {
      _fsA.copy(t.p).sub(g.position); const h = _fsA.dot(upAx); _fsA.addScaledVector(upAx, -h); const rl = _fsA.length();
      if (Math.abs(h) < 0.03 && rl > R_DISC - 0.035 && rl < R_DISC + 0.025) {
        const vt = _fsB.copy(t.p).sub(prev).multiplyScalar(1 / dt);
        const tang = _fsA.multiplyScalar(1 / rl).cross(upAx).negate();   // up x radial = the way the rim moves for +w
        const wv = vt.dot(tang) / R_DISC;
        if (Math.abs(wv) > 2) {
          if (Math.sign(wv) === Math.sign(S.w) || Math.abs(S.w) < 1) { if (Math.abs(wv) > Math.abs(S.w)) S.w += (wv - S.w) * 0.5; }
          else S.w *= 0.85;   // against the spin: the finger drags it slower
          S.w = Math.max(-SPIN.MAX, Math.min(SPIN.MAX, S.w));
          if (!t.hand && xr.buzz) xr.buzz(t.st, 0.25, 12);
        }
      }
    }
    prev.copy(t.p);
  }
  S.w -= Math.sign(S.w) * (0.25 + 0.035 * Math.abs(S.w)) * dt;   // friction on the fingertip and in the air
  if (Math.abs(S.w) < SPIN.DROP_W) return dropSpin(L, upAx);
  // pose: the axis leans half with the finger; the wobble grows as it slows and goes round (precession)
  const aw = Math.abs(S.w), wob = Math.min(0.35, 0.02 + 1.0 / aw);
  S.ph += (1.2 + 25 / aw) * dt;
  const base = _fsB.set(0, 1, 0).lerp(F.dir, 0.5).normalize();
  const side = _fsA.set(Math.cos(S.ph), 0, Math.sin(S.ph)); side.addScaledVector(base, -side.dot(base)).normalize();
  const tgt = base.multiplyScalar(Math.cos(wob)).addScaledVector(side, Math.sin(wob)).normalize();
  g.quaternion.premultiply(_fsQ2.setFromUnitVectors(upAx, tgt));
  g.quaternion.premultiply(_fsQ2.setFromAxisAngle(tgt, S.w * dt)).normalize();
  g.position.copy(F.tip).addScaledVector(tgt, 0.004);   // the fingertip sits a little way into the centre hole
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
    if (onPlatter) ly = d.g.userData.platterSurface + (d.record ? recD(d).THICK + 0.001 : 0);
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
    if (flyingMilk.has(mc) || !mc.visible) continue;   // #235 switched off
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
const FLOOR_RETURN_S = 180;   // #441
function stepLoose(dt) {
  const eye = camera.getWorldPosition(new THREE.Vector3());
  for (let i = loose.length - 1; i >= 0; i--) {
    const L = loose[i], g = L.rec.group;
    if (L.inMilk) { if (!L.resting) stepMilk(L, dt); L.rec.setLOD(g.getWorldPosition(_cv).distanceTo(eye) > 0.3); continue; }
    if (L.spin) { stepSpin(L, dt); L.rec.setLOD(g.position.distanceTo(eye) > 0.3); continue; }   // #228
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
      if (Math.abs(n.y) > 0.8 && L.vel.y < 0.5) {   // #228 dropped or thrown flat onto an upright finger: caught spinning
        const up = _fsU.copy(n).multiplyScalar(n.y >= 0 ? 1 : -1), F = spinFingerFor(g.position, up);
        if (F) { const w = L.ang.dot(up); startSpin(L, F, Math.abs(w) < SPIN.MIN_START * 0.8 ? (w < 0 ? -1 : 1) * SPIN.MIN_START * 0.8 : w); continue; }
      }
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
    // #441: a record left lying on the floor goes back to the record crate after 3 minutes; anywhere else it stays
    if (L.resting && L.onFloor) {
      L.floorT = (L.floorT || 0) + dt;
      if (L.floorT > FLOOR_RETURN_S) { loose.splice(i, 1); scene.remove(g); L.rec.dispose(); layoutSleeves(); continue; }
    } else L.floorT = 0;
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
  // #253 (owner): a turntable stands on feet with a gap under its body: a record put down against one slides
  // under it and stays flat (no 45 deg lean against the deck)
  for (const dg of deckGroups) {
    const l = dg.worldToLocal(probe.set(c.x + best.dx * best.w, best.h - 0.01, c.z + best.dz * best.w));
    if (Math.abs(l.x) < 0.24 && Math.abs(l.z) < 0.19) return;
  }
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
  const D = rec3d.dims || REC;
  if (D === REC && d.spiderOn) { const s = d.spiderOn; d.spiderOn = null; s.on = null; for (const dd of decks) if (!dd.recess) { spiderToRecess(s, dd); break; } toast('45 adapter back in its recess (a 12" needs the bare spindle)', 2200); }   // #260
  rec3d.group.position.set(DECK.spindle.x, d.g.userData.platterSurface + D.THICK / 2, DECK.spindle.z);
  rec3d.group.quaternion.identity(); rec3d.group.scale.setScalar(1);
  d.g.add(rec3d.group);
  for (const m of d.g.userData.slipmat || []) m.visible = D !== REC; // a 12" covers the mat (hidden: no depth fighting); a 7" leaves it showing
  // #260 a 45 needs the adapter on the spindle; without it the big hole sits off-centre on the bare pin: it wobbles
  // (and the tonearm with it) and the music has wow, like the real thing
  d.wob = D === REC7 && !d.spiderOn ? WOB_E : 0; rec3d.disc.position.x = d.wob;
  engine.deck(d.i, 'wobble', 0);
  if (d.wob) toast(`Deck ${d.name}: no 45 adapter on the spindle, the record wobbles`, 2500);
  engine.post({ type: 'record', deck: d.i, on: true, size: D === REC7 ? 7 : 12 });   // #120: it lands still; the slipmat pulls it up to platter speed (#261: a 45 is light)
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
// #253 (owner): no centre click any more (#230's snap made +-0.5 % unreachable, so matched records drifted); the
// green LED at the fader shows zero (within 0.05 %). The fader covers +-d.range (X2 button: 8 or 16 %).
function setPitch(d, p) {
  p = clamp(p, -d.range, d.range);
  d.pitch = p; engine.deck(d.i, 'pitch', p);
  const t = d.g.userData.pitchTravel;
  d.g.userData.pitchCap.position.z = (t.z0 + t.z1) / 2 + (p / d.range) * (t.z1 - t.z0) / 2;
  return null;
}
// X2: the fader stays where it is, so the pitch scales with the range (as on the MK7)
function setPitchRange(d, r) {
  const f = d.pitch / d.range; d.range = r; setPitch(d, f * r);
  settings.pitchRange = { ...(settings.pitchRange || {}), [d.i]: r }; saveSettings();
  toast(`Deck ${d.name}: pitch range \u00b1${Math.round(r * 100)} %`, 1500);
}

// #260 per-record sizes on a deck (12" or 7"), the off-centre 45
const WOB_E = 0.010;   // how far a 45's 38 mm hole sits off the 7 mm spindle (it can't do more than 15 mm)
const recD = d => (d.record && d.record.dims) || REC;
function stylusAngle(d) { const u = d.g.userData, y = d.arm.yaw; return Math.atan2(u.pivot.z + ARM.L * Math.cos(y) - DECK.spindle.z, u.pivot.x + ARM.L * Math.sin(y) - DECK.spindle.x); }
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
  d.arm.targetYaw = armYawForRadius(d.g.userData.pivot, DECK.spindle, timeToRadius(time, d.duration, recD(d)));
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
    a.dragDown = true; a.lastDragT = radiusToTime(armRadius(d, a.yaw), d.duration, recD(d));
    engine.post({ type: 'needleDrag', deck: d.i, active: true });
  } else { a.dragDown = false; liftNeedle(d, false); }
}
function armRadius(d, yaw) { const u = d.g.userData; return Math.hypot(u.pivot.x + ARM.L * Math.sin(yaw) - DECK.spindle.x, u.pivot.z + ARM.L * Math.cos(yaw) - DECK.spindle.z); }
function endNeedleDrag(d) { if (d.arm.dragDown) { d.arm.dragDown = false; engine.post({ type: 'needleDrag', deck: d.i, active: false }); } }
// #104 (owner): carrying the raised arm in over the record, the needle finds it by itself: once the stylus
// crosses into the lead-in (from outside the disc edge inwards, up to the first music groove) the arm leaves
// the hand, settles on the first groove and lowers gently onto it, so the record plays from its start.
function armDrag(d, yaw, lift = 0) {
  const a = d.arm; if (a.auto) return 'dropped';
  const D = recD(d), DROP_OUT = D.EDGE + 0.003, DROP_IN = D.OUT;   // #260 per record
  a.manualYaw = clamp(yaw, -1.2, 0.25);
  if (!a.dragDown) {
    const r = armRadius(d, a.manualYaw), was = a.prevR; a.prevR = r;
    // #323 (owner): the arm carried by its finger lift goes anywhere over the record; it lands where it is let go
    // (armRelease). The #104 auto-drop at the lead-in is off.
    if (false && d.loaded && d.record && was > DROP_OUT && r <= DROP_OUT && r >= DROP_IN - 0.004) {
      a.auto = true; a.manual = false;
      a.yaw = a.targetYaw = armYawForRadius(d.g.userData.pivot, DECK.spindle, D.OUT);
      a.parking = false; a.wantDown = true; a.cueTime = radiusToTime(D.OUT, d.duration, D);
      a.onLand = () => { engine.post({ type: 'seek', deck: d.i, time: a.cueTime }); engine.deck(d.i, 'needle', true); };
      return 'drop';
    }
    return;
  }
  const r = armRadius(d, a.manualYaw);
  if (lift > (settings.needleLift || 7) / 100 || r > D.EDGE + 0.002 || r < D.IN - 0.006) { endNeedleDrag(d); liftNeedle(d, false); return; }   // #323 lift height = DJ TOOLS > HAND FIT > NEEDLE LIFT (was a fixed 7 cm)
  const T = radiusToTime(Math.min(D.EDGE, Math.max(D.IN, r)), d.duration, D), dT = T - a.lastDragT;
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
  const r = Math.hypot(nx - DECK.spindle.x, nz - DECK.spindle.z), D = recD(d);
  if (d.loaded && r < D.EDGE && r > D.IN - 0.004) {
    // #323 let go over the lead-in: the stylus runs into the first groove (lands there, plays from the start)
    if (r > D.OUT) a.yaw = armYawForRadius(u.pivot, DECK.spindle, D.OUT);
    a.cueTime = radiusToTime(Math.min(r, D.OUT), d.duration, D); a.targetYaw = a.yaw; a.parking = false; a.wantDown = true;
    a.onLand = () => { engine.post({ type: 'seek', deck: d.i, time: a.cueTime }); engine.deck(d.i, 'needle', true); };
  } else if (d.record && d.track && !d.loaded && r < D.EDGE && r > D.IN - 0.004) {
    // #181 (owner): let go over a record whose grooves are still loading: hover there and drop by itself once it's ready
    a.targetYaw = a.yaw; a.parking = false; a.pendingR = r;
  } else { a.targetYaw = a.yaw; a.parking = r > D.R; }
}
function updateArm(d, dt) {
  const a = d.arm, u = d.g.userData;
  const st = engine.state.decks[d.i];
  if (a.pendingR != null) {   // #181: arm waiting over a loading record
    if (a.manual || !d.record || !d.track) a.pendingR = null;
    else if (d.loaded) {
      a.cueTime = radiusToTime(a.pendingR, d.duration, recD(d)); a.pendingR = null; a.targetYaw = a.yaw; a.wantDown = true;
      a.onLand = () => { engine.post({ type: 'seek', deck: d.i, time: a.cueTime }); engine.deck(d.i, 'needle', true); };
    }
  }
  if (a.manual) {
    a.yaw = a.manualYaw; a.lift = a.dragDown ? 0 : Math.min(1, a.lift + dt * 6);
    u.arm.userData.yaw.rotation.y = a.yaw; u.arm.userData.pitch.rotation.x = armTilt(u, a.lift); return;
  }
  if (st.needle && d.loaded) {
    // stylus rides the groove
    let r = timeToRadius(engine.pos(d.i), d.duration, recD(d));
    if (d.wob) {   // #260 the off-centre 45 swings the arm in and out once a turn, and the music wows with it
      const ph = stylusAngle(d); r += d.wob * Math.cos(d.recAngle - ph);
      const depth = Math.round(d.wob / Math.max(0.03, r) * 1000) / 1000;
      if (depth !== d.wobSent) { d.wobSent = depth; engine.deck(d.i, 'wobble', depth); engine.deck(d.i, 'wobPh', ph); }
    } else if (d.wobSent) { d.wobSent = 0; engine.deck(d.i, 'wobble', 0); }
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
  if (Math.abs(pa) > a.range + 1e-6 || Math.abs(pb) > b.range + 1e-6) {
    flashSync('red'); toast(`Meeting point ${target.toFixed(1)} BPM is outside the pitch range of one deck (X2 for \u00b116 %)`); return;
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
    { const bu = d.g.userData, b = c.id === 'start' ? bu.start : c.id === 'rpm33' ? bu.b33 : c.id === 'rpm45' ? bu.b45 : c.id === 'x2' ? bu.x2 : null; if (b && b.userData.press) b.userData.press(); }
    if (c.id === 'x2') { setPitchRange(d, d.range > 0.1 ? 0.08 : 0.16); return true; }
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
    if (id === 'looper') { pressLooper(src || 'mouse'); return true; }
    if (id === 'sync') { doSync(); return true; }
    if (id === 'splitcue') { splitCue = !splitCue; engine.setSplitCue(splitCue); toast(splitCue ? 'Split cue: master left ear, cue right ear' : 'Split cue off'); return true; }
    if (id === 'bpmtap') { handleBpmTap(src || 'mouse'); return true; }
    if (id.endsWith('.beat1')) { tapBeat1(decks[id[0] === 'B' ? 1 : 0], src || 'mouse'); return true; }
    if (id.endsWith('.cue')) { const i = id[0] === 'A' ? 0 : 1; cueOn[i] = !cueOn[i]; engine.setCue(i, cueOn[i]); return true; }
  }
  return false;
}
// LOOPER (#458, #470 owner): one button, four states, its LED ring shows which.
//   EMPTY (ring off)  press = start sampling the channel(s) with CUE on, taken after TRIM, before EQ / filter (30 s max)
//   REC   (red)       press = stop sampling and loop it at once through those channel(s) of the mixer
//   PLAY  (green)     press = stop the loop, it is kept
//   STOP  (amber blinking, also = ARMED after a slot is loaded)  press = play it again from its IN point
//   Hold 0.8 s in any state = clear (the ring blinks). A full 30 s sample goes into the loop by itself.
// The tablet LOOPER page (DJ TOOLS > LOOPER, or LOOP on the mixer page) edits IN / OUT and keeps 4 slots + banks (#470).
const LOOP_HOLD = 0.8;
const looper = { state: 'empty', mask: [false, false], t0: 0, len: 0, r: 0, data: null, slot: 0, hold: null, clearT: -1e9, bpm: 0 };
const loopSlots = [null, null, null, null];
const loopUI = { sel: 'out', zoom: 1, store: false, del: 0, msg: '', msgT: 0, loaded: null, banks: null, bankDel: '', drag: null };
const LOOP_ZOOMS = [1.0, 0.25, 0.05];   // half window of the close-up view, seconds
function loopSay(s, ms = 3000) { loopUI.msg = s; loopUI.msgT = performance.now() + ms; toast(s, Math.min(ms, 2600)); if (toolsPage === 'looper' || toolsPage === 'loopbanks') drawMixScreen(); }
engine.onLooper = m => {
  if (m.type === 'lpos') { looper.r = m.r; return; }
  if (m.type === 'data') {   // a finished take: keep it for the waveform and the slots
    looper.data = { len: m.len, sr: m.sr, a: 0, b: m.len, mask: m.mask, bufs: m.bufs, src: m.mask[0] && m.mask[1] ? 'A+B' : m.mask[0] ? 'A' : 'B', bpm: looper.bpm, t: Date.now(), name: '' };
    looper.slot = 0; looper.peaks = null; if (toolsPage === 'looper') drawMixScreen(); return;
  }
  if (m.type !== 'looper') return;
  looper.state = m.state; looper.len = m.len || 0;
  if (m.state === 'empty') { if (m.short) loopSay('LOOP: too short, nothing sampled', 1800); }
  else if (m.state === 'play' && looper.recEnding) { looper.recEnding = false; toast(`LOOP ${looper.len.toFixed(2)} s${looper.len >= 29.9 ? ' (30 s full)' : ''}: playing`, 2000); }
  if (toolsPage === 'looper') drawMixScreen();
};
function pressLooper(src = 'mouse') {   // the mixer button, the tablet transport button: same four steps
  if (!engine.ctx || !engine.looper) return;
  const now = performance.now() / 1000;
  if (src !== 'tablet') looper.hold = { t0: now, seen: now, src, done: false };
  const st = looper.state;
  if (st === 'empty') {
    const mask = [cueOn[0], cueOn[1]];
    if (!mask[0] && !mask[1]) { loopSay('LOOP: switch CUE on for the channel to sample first', 2400); return; }
    const di = mask[0] ? 0 : 1, d = decks[di], rate = Math.abs(engine.state.decks[di].rate) || 0;
    looper.bpm = d && d.track && bpmOf(d.track) && rate > 0.3 ? bpmOf(d.track) * rate : 0;
    looper.mask = mask; looper.t0 = now; looper.state = 'rec'; looper.data = null; looper.slot = 0;
    engine.looperRec(mask);
    toast(`LOOP: sampling ${mask[0] && mask[1] ? 'A + B' : mask[0] ? 'A' : 'B'} (cue, before EQ). Press again to loop it`, 2400);
  } else if (st === 'rec') { looper.recEnding = true; engine.looperPlay(); looper.state = 'play'; }
  else if (st === 'play') { engine.looperStop(); looper.state = 'stop'; }
  else if (st === 'stop') { engine.looperPlay(); looper.state = 'play'; }
  if (toolsPage === 'looper') drawMixScreen();
}
function toggleLooper(src) { pressLooper(src); }   // #458 name kept
// #473 UNDO: the last 20 looper actions. A drag or a quick run of nudges (within 0.8 s) counts as one step.
const LOOP_UNDO_MAX = 20, loopUndo = [];
function undoPush(e) { e.t = performance.now(); loopUndo.push(e); if (loopUndo.length > LOOP_UNDO_MAX) loopUndo.shift(); }
function loopArm(L, slot) {   // put a loop back into the engine, ARMED (amber)
  if (engine.looper) engine.looperLoad(L);
  looper.data = L; looper.slot = slot || 0; looper.state = 'stop'; looper.r = L.a; looper.pkCache = null;
}
async function loopUndoDo() {
  const e = loopUndo.pop(); if (!e) { loopSay('Nothing to undo'); return; }
  if (looper.state === 'rec' && (e.kind === 'clear' || e.kind === 'load')) { loopUndo.push(e); loopSay('Finish the take first'); return; }
  try {
    if (e.kind === 'region') {
      e.L.a = e.a; e.L.b = e.b; if (looper.data === e.L) engine.looperRegion(e.a, e.b);
      const n = loopSlots.indexOf(e.L) + 1; if (n) await loopDb.saveSlotMeta(n, e.L);
      loopUI.vFor = null; loopSay(`UNDO: IN ${fmtLoopT(e.a, e.L.sr)} OUT ${fmtLoopT(e.b, e.L.sr)}`, 2000);
    } else if (e.kind === 'clear') { loopArm(e.L, e.slot); loopSay('UNDO: loop back, ARMED (press LOOP to play)', 2400); }
    else if (e.kind === 'load') { if (e.L) { loopArm(e.L, e.slot); loopSay('UNDO: previous loop back, ARMED', 2400); } else { engine.looperClear(); looper.state = 'empty'; looper.data = null; looper.slot = 0; loopSay('UNDO: slot unloaded', 1800); } }
    else if (e.kind === 'slot') {
      loopSlots[e.n - 1] = e.prev; await loopDb.saveSlot(e.n, e.prev);
      if (looper.slot === e.n) looper.slot = looper.data === e.prev ? e.n : 0;
      loopSay(`UNDO: SLOT ${e.n} ${e.prev ? 'restored' : 'empty again'}`, 2000);
    } else if (e.kind === 'slots') {
      for (let i = 0; i < loopDb.SLOTS; i++) { loopSlots[i] = e.prev[i]; await loopDb.saveSlot(i + 1, e.prev[i]); }
      looper.slot = 0; loopSay('UNDO: the 4 slots are back as before the bank load', 2400);
    } else if (e.kind === 'bank') {
      await loopDb.saveBank(e.name, e.slots); if (toolsPage === 'loopbanks') loopUI.banks = await loopDb.listBanks();
      loopSay(`UNDO: bank "${e.name}" restored`, 2400);
    }
  } catch (err) { loopSay('Undo failed: ' + err.message, 4000); }
  drawMixScreen();
}
async function loopDeleteBank(name) {   // keeps the bank's audio in memory so UNDO can write it back
  try { const slots = await loopDb.loadBank(name, engine.ctx ? engine.ctx.sampleRate : 48000); await loopDb.deleteBank(name); undoPush({ kind: 'bank', name, slots }); loopUI.banks = await loopDb.listBanks(); loopSay(`Bank "${name}" deleted (UNDO brings it back)`, 2400); }
  catch (e) { loopSay('Delete failed: ' + e.message, 4000); }
}
function clearLooper() {
  if (looper.data && looper.state !== 'rec') undoPush({ kind: 'clear', L: looper.data, slot: looper.slot });
  engine.looperClear(); looper.state = 'empty'; looper.data = null; looper.slot = 0; looper.clearT = performance.now() / 1000;
  loopSay('LOOP cleared (the slots keep theirs)', 1800);
}
function holdLooper(src) { const h = looper.hold; if (h && h.src === src) h.seen = performance.now() / 1000; }
function releaseLooper(src) { if (looper.hold && looper.hold.src === src) looper.hold = null; }
function stepLooper() {
  const h = looper.hold; if (!h || h.done) return;
  const now = performance.now() / 1000;
  if (h.src !== 'mouse' && now - h.seen > 0.15) { looper.hold = null; return; }   // lost contact (tracking gap): no clear
  if (now - h.t0 >= LOOP_HOLD) { h.done = true; clearLooper(); }
}
function loopRegion(a, b) {   // in / out in samples; a loaded slot keeps its new points
  const L = looper.data; if (!L) return;
  const minLen = Math.round(0.01 * L.sr);
  a = Math.round(clamp(a, 0, L.len - minLen)); b = Math.round(clamp(b, a + minLen, L.len));
  if (a === L.a && b === L.b) return;
  { const top = loopUndo[loopUndo.length - 1], now = performance.now();   // #473 one undo step per gesture
    if (top && top.kind === 'region' && top.L === L && now - top.t < 800) top.t = now; else undoPush({ kind: 'region', L, a: L.a, b: L.b }); }
  L.a = a; L.b = b; engine.looperRegion(a, b);
  if (looper.slot) { clearTimeout(loopRegion.t); const n = looper.slot; loopRegion.t = setTimeout(() => loopDb.saveSlotMeta(n, loopSlots[n - 1]).catch(e => console.warn(e)), 800); }
}
function loopNudge(ms) {
  const L = looper.data; if (!L) return; const d = Math.round(ms * L.sr / 1000);
  if (loopUI.sel === 'in') loopRegion(L.a + d, L.b); else loopRegion(L.a, L.b + d);
  drawMixScreen();
}
function ensureLoopSlots() {
  if (loopUI.loaded || !engine.ctx) return loopUI.loaded;
  loopUI.loaded = loopDb.readSlots(engine.ctx.sampleRate).then(s => { s.forEach((x, i) => { if (!loopSlots[i]) loopSlots[i] = x; }); drawMixScreen(); })
    .catch(e => { console.warn('loop slots', e); loopUI.msg = 'Could not read the saved slots'; });
  return loopUI.loaded;
}
function loopSlotTap(n) {
  if (loopUI.del) { const d = loopUI.del; loopUI.del = 0; if (d === n) { undoPush({ kind: 'slot', n, prev: loopSlots[n - 1] }); loopSlots[n - 1] = null; if (looper.slot === n) looper.slot = 0; loopDb.saveSlot(n, null).catch(() => {}); loopSay(`SLOT ${n} emptied`); } drawMixScreen(); return; }
  if (looper.state === 'rec') { loopSay('Finish the take first (press LOOP)'); return; }
  const S = loopSlots[n - 1];
  if (loopUI.store || !S) {   // STORE mode, or an empty slot: the current loop goes in
    loopUI.store = false;
    if (!looper.data) { loopSay(S ? '' : `SLOT ${n} is empty. Record a loop, then tap a slot to store it`); return; }
    const C = { ...looper.data, name: `LOOP ${n}`, t: Date.now() };
    undoPush({ kind: 'slot', n, prev: S || null });
    loopSlots[n - 1] = C; looper.data = C; looper.slot = n;
    loopSay(`Stored in SLOT ${n}, saving…`, 1500);
    loopDb.saveSlot(n, C).then(() => loopSay(`SLOT ${n} saved on this headset`, 1800)).catch(e => loopSay('Saving failed: ' + e.message, 4000));
    return;
  }
  if (looper.data !== S) undoPush({ kind: 'load', L: looper.data, slot: looper.slot });
  if (engine.looper) engine.looperLoad(S);   // the worklet answers state 'stop' = ARMED (amber blinking on the mixer)
  looper.data = S; looper.slot = n; looper.peaks = null; looper.state = 'stop'; looper.r = S.a;
  loopSay(`SLOT ${n} loaded, armed: press LOOP to play`, 2000);
}
async function loopSaveBank(name) {
  if (!loopSlots.some(Boolean)) { loopSay('All 4 slots are empty: nothing to save'); return; }
  try { loopSay('Saving bank…', 8000); const nm = await loopDb.saveBank(name, loopSlots); loopSay(`Bank "${nm}" saved`, 2500); }
  catch (e) { loopSay('Saving the bank failed: ' + e.message, 4000); }
}
async function loopOpenBanks() { loopUI.banks = null; loopUI.bankDel = ''; setTools('loopbanks'); try { loopUI.banks = await loopDb.listBanks(); } catch (e) { loopUI.banks = []; loopUI.msg = e.message; } drawMixScreen(); }
async function loopLoadBank(name) {
  if (!engine.ctx) return;
  try {
    loopSay(`Loading "${name}"…`, 8000);
    const s = await loopDb.loadBank(name, engine.ctx.sampleRate);
    undoPush({ kind: 'slots', prev: loopSlots.slice() });
    for (let i = 0; i < loopDb.SLOTS; i++) { loopSlots[i] = s[i]; await loopDb.saveSlot(i + 1, s[i]); }
    if (looper.slot) looper.slot = 0;
    setTools('looper'); loopSay(`Bank "${name}" in the 4 slots (${s.filter(Boolean).length} loops). Tap a slot to arm it`, 2600);
  } catch (e) { loopSay('Loading the bank failed: ' + e.message, 4000); }
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
function dirroLbl() { return dirro && dirro.on ? (dirro.state === 'live' ? `DIRROGRAM · ${dirro.fans}` : 'DIRROGRAM …') : 'DIRROGRAM'; }   // #427
// #427 the loudest playing deck's track and its tempo at the deck's speed (pitch included), for the Dirrogram phones
function dirroNow() {
  const on = decks.filter(d => d.track && engine.state.decks[d.i] && engine.state.decks[d.i].needle && Math.abs(engine.state.decks[d.i].rate) > 0.2);
  const loud = d => (mixVal[(d.i ? 'B' : 'A') + '.fader'] || 0) * (d.i ? Math.min(1, 1 + mixVal.xfader) : Math.min(1, 1 - mixVal.xfader));
  on.sort((a, b) => loud(a) - loud(b)); const top = on[on.length - 1]; if (!top) return { a: '', bpm: 0 };
  const t = top.track; let bpm = 0; try { bpm = bpmOf(t) * Math.abs(engine.state.decks[top.i].rate); } catch (e) {}
  return { a: (t.artist ? t.artist + ' – ' : '') + (t.title || t.name || ''), bpm };
}
// #427 a QR code on the tablet: white plate, 4-module quiet zone, whole-pixel modules (made once per text)
const qrCache = { text: '', n: 0, mods: null };
function drawQr(g, text, x, y, size) {
  if (qrCache.text !== text) { const q = qrcode(0, 'M'); q.addData(text); q.make(); const n = q.getModuleCount(), mods = []; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) mods.push(r, c); Object.assign(qrCache, { text, n, mods }); }
  const n = qrCache.n, px = Math.floor(size / (n + 8)), sz = px * (n + 8), ox = x + Math.floor((size - sz) / 2), oy = y + Math.floor((size - sz) / 2);
  g.fillStyle = '#fff'; g.fillRect(ox, oy, sz, sz); g.fillStyle = '#000';
  for (let i = 0; i < qrCache.mods.length; i += 2) g.fillRect(ox + (qrCache.mods[i + 1] + 4) * px, oy + (qrCache.mods[i] + 4) * px, px, px);
}
// #463 CREATE CARD (DIRROGRAM page): a 1920 x 1080 PNG, "SEND DIRROGRAMS NOW", the room's QR and its short link, saved
// into VISUALS > IMAGES on this headset (one file per room, made again = replaced) to put up on the LED wall
let dirroCardBusy = false;
async function makeDirroCard() {
  if (dirroCardBusy) return; dirroCardBusy = true;
  try {
    const url = fanUrl(), room = roomKey(), W = 1920, H = 1080;
    const c = Object.assign(document.createElement('canvas'), { width: W, height: H }), g = c.getContext('2d');
    const gr = g.createRadialGradient(640, 500, 60, 760, 540, 1400); gr.addColorStop(0, '#1b2233'); gr.addColorStop(1, '#05070c');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // the QR on the right: white plate, 4-module quiet zone, whole-pixel modules
    const q = qrcode(0, 'M'); q.addData(url); q.make(); const n = q.getModuleCount(), px = Math.floor(760 / (n + 8)), S = px * (n + 8), qx = W - 110 - S, qy = 120;
    g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect ? g.roundRect(qx - 10, qy - 10, S + 20, S + 20, 24) : g.rect(qx - 10, qy - 10, S + 20, S + 20); g.fill();
    g.fillStyle = '#000000'; for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect(qx + (k + 4) * px, qy + (r + 4) * px, px, px);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#39e6ff';
    const short = url.replace(/^https?:\/\//, ''); let fs = 64; g.font = `800 ${fs}px system-ui,sans-serif`; while (fs > 28 && g.measureText(short).width > S + 40) g.font = `800 ${--fs}px system-ui,sans-serif`;
    g.fillText(short, qx + S / 2, qy + S + 70);
    // the call on the left
    const lw = qx - 110 - 120, fit = (t, size, weight) => { let k = size; g.font = `${weight} ${k}px system-ui,sans-serif`; while (k > 40 && g.measureText(t).width > lw) g.font = `${weight} ${--k}px system-ui,sans-serif`; };
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    fit('SEND', 190, 900); g.fillStyle = '#ffffff'; g.fillText('SEND', 110, 330);
    fit('DIRROGRAMS', 190, 900); g.fillStyle = '#ff2bd6'; g.fillText('DIRROGRAMS', 110, 530);
    fit('NOW', 190, 900); g.fillStyle = '#ffffff'; g.fillText('NOW', 110, 730);
    g.fillStyle = '#dfe6f2'; fit('Point your phone camera at the code. No app.', 46, 600); g.fillText('Point your phone camera at the code. No app.', 110, 850);
    g.fillStyle = '#8c96a8'; g.font = '600 38px system-ui,sans-serif'; g.fillText('DirroDJ  ·  room ' + room, 110, 930);
    const blob = await new Promise(r => c.toBlob(r, 'image/png')); if (!blob) throw new Error('no picture');
    const name = await media.importFile('Images', new File([blob], `Dirrogram card ${room}.png`, { type: 'image/png' }));
    if (videoPage && vpFolder === 'Images') vpLoad();
    toast(`Card saved: VISUALS > IMAGES > ${name}`, 3500);
  } catch (e) { console.warn('dirrogram card', e); toast('Could not make the card: ' + (e.message || e), 3000); }
  dirroCardBusy = false;
}
function micLevel() {
  const m = engine.mic; if (!m || !micOn) return 0;
  m.meter.getFloatTimeDomainData(m.meterBuf); let p = 0; for (const x of m.meterBuf) { const a = Math.abs(x); if (a > p) p = a; } return p;
}
function crateScreenPress(uv) {
  const c = crateScreen.canvas; const px = uv.x * c.width, py = (1 - uv.y) * c.height;
  const inR = b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
  if (crateDel && py < SB.y + SB.h) crateDel = null;   // #226
  if (py < CS.head) { if (search.results) exitSearch(); else cratePlaylist(px < c.width / 2 ? -1 : 1); return; }
  if (py < SB.y + SB.h) {
    const b = search.btns.find(inR); if (!b) return;
    if (plMode()) { crateSearchRowPl(b); return; }   // #392
    if (b.id === 'pl') plOpen();   // #392
    else if (b.id === 'mic') openNativeKeyboard();
    else if (b.id === 'milk') { spawnMilk(); drawCrateScreen(); }
    else if (b.id === 's45') crate45s();
    else if (b.id === 'clear') exitSearch();
    else if (b.id === 'kb') { search.kb = !search.kb; drawCrateScreen(); }
    else { search.kb = true; drawCrateScreen(); }
    return;
  }
  const R = crateScreen.rows;
  if (py >= R.kbY) { const key = search.keys.find(inR); if (key) kbKey(key.k); return; }
  const k = Math.floor((py - R.y0) / R.RH);
  if (crateDel) {   // #226 delete offer open: the red DELETE button deletes, any other tap closes the offer
    const r = crateDel; crateDel = null;
    if (k >= 0 && k < R.ROWS && currentList()[R.start + k] === r && px >= c.width - CDEL_W - 12) deleteStamped(r);
    else drawCrateScreen();
    return;
  }
  if (plMode() && plUI.view === 'sets') {   // #392 SETS: load, or ✕ twice to delete
    const st = k >= 0 && k < R.ROWS ? plSaved[plUI.setsStart + k] : null; if (!st) return;
    if (px >= c.width - 140) { if (plUI.delArm === st.id) plDeleteSet(st); else { plUI.delArm = st.id; drawCrateScreen(); } }
    else plLoadSet(st);
    return;
  }
  if (plUI.delArm) plUI.delArm = null;
  if (k >= 0 && k < R.ROWS && px < 70 && !CAMERA_ROLE) { const r = currentList()[R.start + k]; if (r) { plToggle(r); return; } }   // #392 ➕ / ✔
  if (k >= 0 && k < R.ROWS) {
    const idx = R.start + k, r = currentList()[idx];
    const id = ++crateHoldSeq;
    if (r && (r.pressed || r.example)) {   // #226 a stamped record (#231 or a built-in example): hold 0.6 s for the delete offer
      crateHold = { id, r, pull: idx === crateState.sel };
      setTimeout(() => { if (crateHold && crateHold.id === id) { crateHold = null; crateDel = r; drawCrateScreen(); } }, 600);
      if (idx !== crateState.sel) { crateState.sel = idx; drawCrateScreen(); layoutSleeves(); }
      return;   // a short tap on the selected one pulls it on release
    }
    crateHold = null;
    if (idx === crateState.sel) pullSelected();
    else if (idx < currentList().length) { crateState.sel = idx; drawCrateScreen(); layoutSleeves(); }
  }
}
// #226 delete stamped records from the crate: long press a stamped record's row, then tap the red DELETE
let crateHold = null, crateHoldSeq = 0, crateDel = null, crateMsg = null;
const CDEL_W = 210;
function crateScreenRelease() {
  const h = crateHold; crateHold = null;
  if (h && h.pull) pullSelected();
}
function crateSay(text, ok, ms = 4000) {
  crateMsg = { text, ok, until: performance.now() + ms }; toast(text, ms); drawCrateScreen();
  setTimeout(() => { if (crateMsg && performance.now() >= crateMsg.until - 5) { crateMsg = null; drawCrateScreen(); } }, ms);
}
async function deleteStamped(r) {
  const t = r.sides.A, p = t && t.press;
  if (!p && !r.example) { drawCrateScreen(); return; }
  if (copiesOut(r) > 0) { crateSay('Put it back in the crate first (it is on a deck or in your hand)', false); return; }
  if (r.example) {   // #231 built-in example: hidden on this device
    const h = hiddenExamples(); if (!h.includes(r.example)) h.push(r.example);
    try { localStorage.setItem('vire.hiddenExamples', JSON.stringify(h)); } catch {}
    for (const s of ['A', 'B']) if (r.sides[s]) lib.tracks.delete(r.sides[s].id);
  } else try { await deletePressing(p.id); }
  catch (e) { crateSay('Not deleted: ' + e.message, false); return; }
  if (t) lib.tracks.delete(t.id);
  lib.records = lib.records.filter(x => x !== r);
  for (const pl of lib.playlists) pl.records = pl.records.filter(x => x !== r);
  if (search.results) search.results = search.results.filter(x => x !== r);
  artCache.delete(t.id); artBlobs.delete(t.id);
  crateState.sel = Math.max(0, Math.min(crateState.sel, currentList().length - 1));
  layoutSleeves();
  crateSay(`Deleted "${r.title}"`, true);
}
function pitchFromLocalZ(d, z) { const t = d.g.userData.pitchTravel; return ((z - (t.z0 + t.z1) / 2) / ((t.z1 - t.z0) / 2)) * d.range; }
// #293 raw (for a held fader, which moves by how far the hand moves): no clamp here, the value is clamped when set.
// Clamped, a fader grabbed a little off its cap could never reach one end (the owner had to push the hand an inch
// into the mixer to get the full travel).
function sliderFromLocal(id, l, raw = false) {
  const c = raw ? (v => v) : null;
  if (id === 'xfader') { const t = mixer.userData.xTravel, v = (l.x - t.x0) / (t.x1 - t.x0) * 2 - 1; return c ? v : clamp(v, -1, 1); }
  const t = mixer.userData.faderTravel, v = (t.z1 - l.z) / (t.z1 - t.z0); return c ? v : clamp(v, 0, 1);
}

// Hand on the record. Angles are around the spindle in deck-local XZ; +angle = forward (clockwise from above).
// nudge = a hand on the platter rim: friction slows it a touch, pushing along speeds it up (CLAUDE.md #35)
// #120: the hand's angle (unwrapped, rad) goes to the worklet, which ties the record to it with a stiff spring
// (the platter keeps turning under the slipmat). force = how hard a finger presses on the platter rim (N).
function scratchBegin(d, localPoint, nudge = false, force) {
  const s = { deck: d, nudge, lastAng: Math.atan2(localPoint.z - DECK.spindle.z, localPoint.x - DECK.spindle.x), lastT: performance.now(), rate: 0, lastMove: performance.now(), holding: false, ang: 0, force: force != null ? force : RIM_FORCE_LIGHT,
    raw: 0, dx: 0, t: 0 };   // #423 raw = hand angle x SCRATCH & DRAG, ang = filtered, dx = filtered speed, t = stamp (ms)
  scratches.add(s); return s;
}
const RIM_FORCE_LIGHT = 0.35;   // N: a fingertip resting on the platter's side
function handRate(s) { return s.rate; }
function postHand(s, holding) {
  if (s.nudge) engine.post({ type: 'touch', deck: s.deck.i, active: holding, rate: s.rate, force: s.force });
  else engine.post(holding ? { type: 'hand', deck: s.deck.i, holding: true, rate: s.rate, ang: s.ang, t: s.t || undefined } : { type: 'hand', deck: s.deck.i, holding: false });   // #423 t: the reading's time stamp
}
function scratchMove(s, localPoint, force) {
  const d = s.deck;
  if (force != null) s.force += (force - s.force) * 0.3;   // tracking jitter: smooth the pressing force
  const now = performance.now(), tS = renderer.xr.isPresenting && frameT ? frameT : now;   // #423 stamp: XR frame time
  if (!s.holding) { s.holding = true; s.rate = s.nudge ? 0 : engine.state.decks[d.i].rate; s.t = tS; postHand(s, true); }
  const ang = Math.atan2(localPoint.z - DECK.spindle.z, localPoint.x - DECK.spindle.x);
  let da = ang - s.lastAng; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
  s.lastAng = ang;
  if (s.nudge) {   // finger on the platter rim: unchanged (#120)
    const dtm = Math.max(4, now - s.lastT) / 1000;
    s.rate = s.rate * 0.4 + ((da / dtm) / W33) * 0.6; s.ang += da;
    s.lastT = now; s.lastMove = now; postHand(s, true); return;
  }
  // #423 (owner: warbling and too fast while holding / back-cueing). Measured in Node on the real worklet with 0.3 mm of
  // tracking noise and 4 ms of frame-timing jitter: a hand held still shook the record by 0.15 x normal speed (RMS) and
  // a 2 cm back-cue overshot 4 %. The record still follows the hand 1:1 (x SCRATCH & DRAG), but the angle now goes
  // through a one-euro filter (smooth when slow, quick when fast; TURNTABLE FEEL > HAND SMOOTHING) and every reading is
  // stamped with the headset frame's time, which the worklet plays back evenly instead of trusting message timing.
  // #424 (owner: back-cueing near the label sounded sped up, near the edge real). On vinyl the record turns by the
  // finger's travel / its distance from the spindle, so the same 2 cm of hand travel at 6 cm turns it twice as far
  // as at 12 cm. On a real deck the finger feels that and moves less; in VR nothing tells the hand, so it moves the
  // same and the kick comes out fast. RADIUS EVEN-OUT (100 % = default) makes every touch point act like the outer
  // music area: the turn = hand travel along the groove / (r + k (R_ref - r)), R_ref = edge - 2 cm. 0 % = true 1:1.
  {
    const r = Math.hypot(localPoint.x - DECK.spindle.x, localPoint.z - DECK.spindle.z), dims = recD(d), rRef = (dims.EDGE || 0.1508) - 0.02;
    const rEff = r + (FEEL.even / 100) * (rRef - r);
    if (r > 0.01 && rEff > 0.01) da *= r / rEff;
  }
  s.raw += da * FEEL.scr / 100;
  const dt = Math.min(0.1, Math.max(0.001, (tS - s.t) / 1000)); s.t = tS;
  const k = FEEL.smooth / 100;
  let nx;
  if (k <= 0) { nx = s.raw; s.dx = (s.raw - s.ang) / dt; }
  else {
    const al = c => 1 / (1 + 1 / (2 * Math.PI * c * dt)), minCut = 0.25 + 1.75 * (1 - k), beta = 4 + 36 * (1 - k);
    s.dx += ((s.raw - s.ang) / dt - s.dx) * al(10);
    nx = s.ang + (s.raw - s.ang) * al(minCut + beta * Math.abs(s.dx));
  }
  s.rate = ((nx - s.ang) / dt) / W33; s.ang = nx;
  s.lastT = now; s.lastMove = now;
  postHand(s, true);
}
// Spindle twist (owner, #105): pinch the spindle / label and twist. The record moves by exactly the twisted
// angle, like a real spindle (one turn = 1.8 s of audio, 10 deg = 50 ms), while the motor keeps turning at
// pitch-fader speed, so the tempo is untouched. Positive seconds = forward (clockwise seen from above).
function spindleTwist(d, seconds) {
  if (!d.loaded || !seconds) return;
  engine.post({ type: 'shift', deck: d.i, delta: seconds * FEEL.spin / 100 }); d.twistT = performance.now();   // #423 SPINDLE TWIST
}
// #322 VR: fingers pinching the spindle (a friction torque on the platter, see the worklet); rate = their turning speed
function spindleHold(d, rate) { engine.post({ type: 'spin', deck: d.i, active: true, rate }); d.twistT = performance.now(); }
function spindleRelease(d) { engine.post({ type: 'spin', deck: d.i, active: false }); }
function scratchEnd(s) { if (s.holding) postHand(s, false); scratches.delete(s); }
function scratchIdle() { // a still hand holds the record still
  const now = performance.now();
  for (const s of scratches) if (s.holding && now - s.lastMove > 45) {
    s.rate *= 0.5; if (Math.abs(s.rate) < 0.01) s.rate = 0;
    if (!s.nudge) { s.t = renderer.xr.isPresenting && frameT ? frameT : now; s.ang = s.raw; s.dx = 0; }   // #423 no new reading: the hand is still
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
  if (u.mixScreen) { mixScreenPress(hit.uv); p.drag = { kind: 'screen' }; activePointers.add(p); return true; }   // #222 the release ends a long press
  if (u.crateScreen) { if (crateLidOpen()) { crateScreenPress(hit.uv); p.drag = { kind: 'crateScreen' }; activePointers.add(p); } return true; }   // #226 the release ends a long press
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
    if (gearLocked(u.move)) { gearLockMsg(); return true; }   // #378
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
  if (dr.kind === 'screen') { if (screenDrag) { const h = castRay(p.ray, [mixer.userData.screen])[0]; if (h) mixScreenDrag(h.uv); } return; }   // #422
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
    if (p.mouse && p.shift) { g.rotation.y = snapDeck(dr.target, dr.yaw0 - (p.x - dr.x0) * 0.006); return; }   // #378 decks: 45 degree steps
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
      if (d.loaded && r > recD(d).IN - 0.002 && r < recD(d).EDGE) dropNeedleAt(d, radiusToTime(r, d.duration, recD(d)));
    }
    scratchEnd(s);
  }
  if (dr.kind === 'pitch') heldPitch.delete(dr.deck.i);
  if (dr.kind === 'move') { stage.endMove(dr.st); settleStack(dr.target); if (dr.target.startsWith('milk')) releaseMilk(dr.target, null); }
  if (dr.kind === 'resize') stage.save();
  if (dr.kind === 'screen') mixScreenRelease();   // #222
  if (dr.kind === 'crateScreen') crateScreenRelease();   // #226
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
  else if (c && c.id === 'looper') showTip('LOOP: press = sample the CUE channel (red), again = loop it (green), again = stop (amber blinks), again = play. Hold 0.8 s = clear. Edit IN / OUT and slots on the tablet: LOOP', e.clientX, e.clientY);
  else if (c && c.id === 'bpmtap') showTip('TAP: tap on the beat to measure BPM (counter above shows BPM; embeds into track); hold to clear', e.clientX, e.clientY);
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

canvas.addEventListener('dblclick', e => {   // #222 desktop: double-click the LED wall = portrait / landscape
  mouseSync(e); const hit = castRay(mouse.ray, interactive())[0], obj = hit && controlOf(hitTarget(hit));
  if (obj && obj.userData.move === 'ledwall') toggleLedPortrait();
});
canvas.addEventListener('wheel', e => {
  if (mouse.drag && mouse.drag.kind === 'move') { // rotate while moving
    e.preventDefault(); e.stopImmediatePropagation();
    const o = MOVABLE[mouse.drag.target];
    if (e.shiftKey && !cases[mouse.drag.target]) { o.position.y = Math.max(0, o.position.y - Math.sign(e.deltaY) * 0.02); clampStack(mouse.drag.target); }
    else if (isDeckKey(mouse.drag.target)) o.rotation.y = snapDeck(mouse.drag.target, o.rotation.y) + Math.sign(e.deltaY) * DECK_STEP;   // #378 one wheel notch = one 45 degree step
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
      spindleTwist(d, (e.shiftKey ? 0.000015625 : 0.000078125) * -Math.sign(e.deltaY));   // #109: half of #108; #270, #272 halved again
      showTip(`Spindle twist ${e.deltaY < 0 ? 'forward' : 'back'} ${e.shiftKey ? 0.016 : 0.08} ms`, e.clientX, e.clientY); return;
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
  if ($('#start').style.display !== 'none' || e.target === searchInput || toolsPage === 'kbd') return;   // #224 typing on the tablet keyboard
  const k = e.key;
  if (toolsPage === 'looper' && looper.data && (k === 'ArrowLeft' || k === 'ArrowRight')) { e.preventDefault(); loopNudge((k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : e.altKey ? 100 : 1)); return; }   // #470 1 ms (Shift 10, Alt 100)
  if ((toolsPage === 'looper' || toolsPage === 'loopbanks') && (k === 'z' || k === 'Z') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); loopUndoDo(); return; }   // #473
  if (toolsPage === 'looper' && (k === 'ArrowUp' || k === 'ArrowDown')) { e.preventDefault(); loopUI.sel = loopUI.sel === 'in' ? 'out' : 'in'; drawMixScreen(); return; }
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
let tapFlashT = 0;
const tapTempo = {
  times: [],        // timestamps in seconds (performance.now() / 1000)
  bpm: 0,           // calculated BPM
  lastTap: 0        // timestamp of last tap
};

function handleBpmTap(src = 'mouse') {
  const now = performance.now() / 1000;
  tapFlashT = now;
  holds[0] = { t0: now, seen: now, src, cleared: false };

  const dt = now - tapTempo.lastTap;
  if (dt < 0.10) return;   // ignore bounce/jitter < 100ms

  if (dt > 2.5 || tapTempo.times.length === 0) {
    // Start of a new tapping sequence
    tapTempo.times = [now];
    toast('TAP: 1 · keep tapping on the beat', 1200);
  } else {
    // Subsequent tap
    tapTempo.times.push(now);
    if (tapTempo.times.length > 8) tapTempo.times.shift();

    // Average the intervals between consecutive taps
    const n = tapTempo.times.length;
    let sumDt = 0;
    for (let i = 1; i < n; i++) sumDt += (tapTempo.times[i] - tapTempo.times[i - 1]);
    const avgPer = sumDt / (n - 1);
    const bpm = avgPer > 0 ? 60 / avgPer : 0;

    if (bpm >= 30 && bpm <= 300) {
      tapTempo.bpm = bpm;
      toast(`TAP: ${n} · ${bpm.toFixed(2)} BPM`, 1200);
    }
  }
  tapTempo.lastTap = now;
}

function clearBpmTap() {
  tapTempo.times = [];
  tapTempo.bpm = 0;
  blinkUntil[0] = performance.now() / 1000 + 1.0;
  toast('TAP: BPM cleared', 1400);
}

function tapBeat1(d, src = 'mouse') {
  if (d.i === 0) { handleBpmTap(src); return; }
  const t = d.loaded && d.track ? d.track : null;
  const now = performance.now() / 1000;
  const p = t ? heardPos(d) : now, rate = (engine.state && engine.state.decks[d.i] && Math.abs(engine.state.decks[d.i].rate)) || 1;
  holds[d.i] = { t0: now, seen: now, src, cleared: false };
  let run = tapRuns[d.i];
  if (run && run.track !== t) run = null;
  if (run) {
    const per = run.per || 0, dt = p - run.t[run.t.length - 1];
    if (dt <= 0 || (now - run.wall > 2.5)) run = null;
    else if (per && dt < TAP_MIN * per) { toast(`Deck ${d.name}: tap ignored (too soon)`, 900); return; }
    else if (per) {
      const n = Math.round(dt / per);
      if (n < 1 || n > 2 || Math.abs(dt / per - n) > 0.35) run = null;   // off the beat: start again
      else { run.t.push(p); run.k.push(run.k[run.k.length - 1] + n); }
    } else { run.t.push(p); run.k.push(1); }
  }
  if (!run) {
    tapRuns[d.i] = { track: t, t: [p], k: [0], per: 0, wall: now, bpm: 0 };
    if (t) { setTap(t, { beat1: p }); d.ledShown = undefined; }
    toast(`Deck ${d.name}: beat 1 set${bpmOf(t) ? '' : ' (no BPM yet: keep tapping on the beat)'}`, 1400);
    return;
  }
  const bpm = fitTaps(run);
  if (!(bpm >= 30 && bpm <= 300)) { run.t.pop(); run.k.pop(); toast(`Deck ${d.name}: tap ignored (out of range)`, 900); return; }
  run.wall = now; run.per = 60 / bpm; run.bpm = bpm; run.rate = rate;
  if (t) {
    setTap(t, { bpm: +bpm.toFixed(3), taps: run.t.length });
    d.ledShown = undefined;
  }
  const fs = t ? fileBpmSrc(t) : '';
  toast(`Deck ${d.name}: tap ${run.t.length} · ${bpm.toFixed(2)} BPM${fs ? ` (${fs === 'id3' ? 'ID3' : 'RB'} ${+t.bpm.toFixed(2)} is used)` : ''}`, 1200);
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
      else if (now - h.t0 >= HOLD_CLEAR) {
        h.cleared = true;
        if (d.i === 0) clearBpmTap();
        else clearTaps(d);
      }
    }
  }
}
function holdBeat1(d, src) { const h = holds[d.i]; if (h && h.src === src) h.seen = performance.now() / 1000; }
function releaseBeat1(src) { for (let i = 0; i < 2; i++) if (holds[i] && holds[i].src === src) holds[i] = null; releaseLooper(src); }
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
let videoPage = false, vpFolder = 'Pano', vpItems = [], vpPg = 0, vpSel = null, vpSelFolder = null, toolsPage = null;   // #224 vpSelFolder: Pano tab mixes Pano + Video pano
const VP_HIT = [], vpThumbs = new Map();   // 'folder/name' -> ImageBitmap | 'loading' | null
const VP_LIB = ['Pano', 'Video', 'Images'];   // #224 one PANO tab for still and video panoramas
const VP_TABS = { Pano: 'PANO', 'Video pano': 'VIDEO PANO', Video: 'VIDEO', Images: 'IMAGES', Camera: 'REMOTE CAM', Sync: 'SYNC', Look: 'LOOK', 'DJ Cam': 'GOPROS', Fx: 'FX' };   // #389 CAMERA is REMOTE CAM; the AVACAM tab is GOPROS, which opens SHOWTIME! OBJECTS   // #379 FX   // #241 the DJ CAM tab is AVACAM (owner)
// #234 add pictures and videos from the Quest's own files (Downloads, Pictures, Movies) to the media library, from
// the start page ('Add pictures / videos…'). Folder by shape: 2:1 (or a big square, over-under stereo) = 360.
// (#235: the in-VR + IMPORT tile was removed: the Quest did not open its file picker from inside a VR session.)
async function mediaShape(file) {
  const vid = (file.type || '').startsWith('video/') || /\.(mp4|m4v|webm|mov)$/i.test(file.name);
  let w = 0, h = 0;
  try {
    if (vid) {
      const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true; v.src = URL.createObjectURL(file);
      await new Promise(res => { v.onloadedmetadata = res; v.onerror = res; setTimeout(res, 4000); });
      w = v.videoWidth; h = v.videoHeight; URL.revokeObjectURL(v.src);
    } else { const b = await createImageBitmap(file); w = b.width; h = b.height; b.close && b.close(); }
  } catch {}
  const pano = h > 0 && (Math.abs(w / h - 2) < 0.08 || (w === h && w >= 3840));
  return { vid, pano };
}
async function importMedia(files, tab = null, say = null) {
  const done = { Pano: 0, 'Video pano': 0, Video: 0, Images: 0 }; let skipped = 0, n = 0;
  for (const f of files) {
    const { vid, pano } = await mediaShape(f);
    let folder = tab === 'Video' ? (vid ? 'Video' : null) : tab === 'Images' ? (vid ? null : 'Images') : tab === 'Pano' ? (vid ? 'Video pano' : 'Pano')
      : vid ? (pano ? 'Video pano' : 'Video') : (pano ? 'Pano' : 'Images');
    if (!folder) { skipped++; continue; }
    if (say) say(`Importing ${++n} of ${files.length}: ${f.name}`, true);
    try { await media.importFile(folder, f); done[folder]++; } catch (e) { skipped++; console.warn('import', e); }
  }
  const parts = Object.entries(done).filter(([, k]) => k).map(([k, v]) => `${v} to ${k === 'Video pano' ? 'PANO (video)' : k.toUpperCase()}`);
  if (videoPage) vpLoad();
  return (parts.length ? 'Added ' + parts.join(', ') : 'Nothing added') + (skipped ? ` (${skipped} skipped)` : '');
}
async function vpLoad() {
  if (vpFolder === 'Camera' || vpFolder === 'Look' || vpFolder === 'DJ Cam' || vpFolder === 'LedList' || vpFolder === 'Fx') { vpItems = []; drawMixScreen(); return; }
  if (vpFolder === 'Sync') { vpItems = []; syncLoad(); return; }   // #206
  vpItems = vpFolder === 'Pano' ? [...await media.list('Pano'), ...await media.list('Video pano')].sort((a, b) => a.name.localeCompare(b.name)) : await media.list(vpFolder);
  if (vpFolder === 'Video') vpItems = [...grab.loops.map((L, i) => ({ name: 'LOOP ' + (grab.loops.length - i) + ' (5 s)', folder: 'Video', loopId: L.id })), ...vpItems];   // #441 grabbed loops first
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
function videoPageFolder() { return vpFolder === 'Pano' ? (vpSelFolder || 'Pano') : vpFolder; }
let scrollFromVP = false;   // #342 the scroller editor opened from VISUALS: BACK goes back there
function openScrollerFromVP() { scrollFromVP = true; videoPage = false; setTools('scroller'); }
function openFxPage() { setVideoPage(true); vpFolder = 'Fx'; vpSel = null; vpSelFolder = null; vpPg = 0; vpLoad(); }   // #390 VJ TOOLS > FX
function openGoprosPage() { videoPage = false; scrollFromVP = false; setTools('showobj'); }   // #389 VISUALS > GOPROS
function setVideoPage(on) { videoPage = on; if (!on) vd.pick = null; if (on) { toolsPage = null; vpLoad(); } drawMixScreen(); }
async function vpAct(what) {
  // #367 SKY OFF works without a thumbnail picked (it was behind this check: a desktop-only toast and nothing else), and
  // turns the whole panorama off: the sky setting, the DOME (#346, which kept it showing in passthrough); a video pano pauses
  if (what === 'skyoff') { settings.sky = 'off'; saveSettings(); syncSettingsUI(); if (dome.on) { dome.on = false; saveDome(); } applySky(); drawMixScreen(); return; }   // applySky pauses a video pano while hidden
  const name = vpSel; if (!name) { toast('Pick a thumbnail first'); return; }
  const vpFolder = videoPageFolder();   // #224 the Pano tab holds two library folders (local, shadows the tab name)
  if (what === 'sky') return useSkyMedia(vpFolder, name).catch(e => toast('Sky: ' + e.message, 4000));
  if (what === 'light') return lightPhone(vpFolder, name);   // #214
  const lpItem = vpItems.find(i => i.name === name && i.loopId);   // #441 a grabbed loop: only the LED wall
  if (lpItem) { const L = grab.loops.find(x => x.id === lpItem.loopId); if (what === 'lednow' || what === 'ledadd') { if (L) showLoop(L); } else toast('A grabbed loop plays on the LED wall (LED NOW)', 2500); return; }
  const f = await media.getFile(vpFolder, name); if (!f) return;
  if (what === 'deckA' || what === 'deckB') {
    const d = decks[what === 'deckA' ? 0 : 1];
    if (!d.record) { toast(`No record on ${d.name}: put one on first`); return; }
    vvOverride[d.i] = { rec: d.record, name }; toast(`${d.name}: ${name} (until this record comes off)`, 2500);
  } else if (what === 'lednow') { led.add(f); ledSrc.set(f.name, vpFolder); saveLedList(); led.play(f, led.files.length < 2); clipsMode(); }
  else if (what === 'ledadd') { const n = led.add(f); ledSrc.set(f.name, vpFolder); saveLedList(); toast(`LED playlist: ${n} item${n > 1 ? 's' : ''} (LED LIST to see it)`, 2000); }
  drawMixScreen();
}
// #188 CAMERA tab: the spectator phone's virtual set, key and Look match, changed from here; the phone applies each
// change and reports back (spect.cam), so this page always shows the phone's real values.
const CAM_ROWS = [
  [['Strength', 'key', 'thr', 0.01], ['Softness', 'key', 'soft', 0.01], ['Spill', 'key', 'spill', 0.05], ['Light wrap', 'key', 'wrap', 0.05]],
  [['Colour match', 'key', 'cmatch', 0.05], ['Look strength', 'look', 'strength', 0.05], ['Grain', 'look', 'grain', 0.05], ['Key colour', 'key', 'col', 1]],   // #347 green / blue / magenta
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
    ['AUTO KEY', false, () => { send({ what: 'auto' }); toast('Auto key: point the phone at the empty key screen', 3000); }],
    ['MATTE', cs && cs.matte, () => send({ what: 'matte', v: !cs.matte })],
    ['PREVIEW', pvWanted, () => setPreview(!pvWanted)],
    ['LOOK', cs && cs.L && cs.L.on, () => send({ what: 'look', key: 'on', v: !cs.L.on })],
    ['ROOM LIGHT', cs && cs.L && cs.L.room, () => send({ what: 'look', key: 'room', v: !cs.L.room })],
  ];
  const per = P ? 3 : 6, bw = (W - 16 - (per - 1) * 6) / per;   // portrait: 3 rows of 3 (#209: was 2)
  top.forEach(([label, on, act], i) => {
    const off = dim && label !== 'PREVIEW';   // #387 PerfCap moved to its own page (VJ TOOLS > PERFCAP)
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
    g.fillText(key === 'col' ? (cs ? KEY_LABEL[v || 0] : '--') : v == null ? '--' : what === 'look' ? Math.round(v * 100) + '%' : v.toFixed(2), cx + colW - 110, cy + 19);
    g.textBaseline = 'alphabetic';
    const bump = d => () => { const nv = key === 'col' ? ((v || 0) + d + 3) % 3 : Math.round((v + d) * 1000) / 1000; src[key] = nv; send({ what, key, v: nv }); drawMixScreen(); };   // #347 key colour cycles
    btn(cx + colW - 100, cy + 2, 44, 32, '−', false, dim ? null : bump(-step), dim);
    btn(cx + colW - 50, cy + 2, 44, 32, '+', false, dim ? null : bump(step), dim);
  }));
  g.textAlign = 'left'; g.font = '500 15px system-ui'; g.fillStyle = cs ? '#8c96a8' : '#c9a040';
  const pcTxt = '';   // #387 PerfCap's time and size are on its own page
  const stTxt = pcTxt + (!cs ? 'Phone not connected: Settings > Spectator camera On, then Connect on the phone and start its camera.'
    : cs.fixed ? `Phone ${cs.fps} fps · fixed camera (${cs.fcam === 'user' ? 'selfie' : 'main'}) · ${cs.fcal ? 'calibrating' : cs.cal ? 'calibrated' + (cs.fpx != null ? ' ' + cs.fpx + ' px' : '') : 'not calibrated: Calibrate on the phone'}` + (pvWanted ? (performance.now() - pvLast < 2000 ? ' · preview live' : ' · preview waiting') : '')   // #213
    : `Phone ${cs.fps} fps${cs.late ? ` (${cs.late} late/s)` : ''} · ${cs.ar ? 'camera on' : 'camera not started'} · ${cs.cal ? 'calibrated' : 'not calibrated'}${cs.can ? '' : ' · no camera access'}` + (pvWanted ? (performance.now() - pvLast < 2000 ? ' · preview live' : ' · preview waiting') : ''));
  const extra = cs ? (cs.fixed ? 'Fixed camera: the key settings drive the PHONE CAM green screen (STREAM > PHONE CAM SETUP)' : [cs.auto, cs.look].filter(Boolean).join(' · ')) : '';
  if (P) {   // portrait: the status lines wrap under the steppers
    let y = ry + CAM_ROWS.flat().length * 42 + 24;
    y += wrapText(g, stTxt, 12, y, W - 24, 20, 5) * 20 + 8;
    if (extra) { g.fillStyle = '#56627a'; g.font = '500 13px system-ui'; wrapText(g, extra, 12, y, W - 24, 18, 4); }
    return;
  }
  fitText2(g, stTxt, 12, H - 30, W - 24);
  if (extra) { g.fillStyle = '#56627a'; g.font = '500 13px system-ui'; fitText2(g, extra, 12, H - 10, W - 24); }
}
// ---- #214 LOOK tab (VIDEO page): the fixed-camera phone's look without AR, changed from here while the PREVIEW
// pop-up shows the phone's picture. Grade / grain (camera grade from the plain video), ambient level, the 360 light
// photo (pick it in the PANO tab, LIGHT PHONE: copied to the phone if it hasn't got it) and the key light by hand.
// The phone saves it all per camera (main / selfie) and reports back (cst.FL), so this page shows its real values.
const LOOK_ROWS = [
  [['Grade', 'strength', 0.05, 'pct'], ['Grain', 'grain', 0.05, 'pct'], ['Ambient', 'amb', 0.05, 'x'], ['Photo turn', 'envTurn', 15, 'deg']],
  [['Light turn', 'kTurn', 15, 'deg'], ['Light height', 'kHeight', 5, 'deg'], ['Light power', 'kInt', 0.1, 'x'], ['Light colour', 'kTemp', 250, 'K']],
];
let lightBusy = '', lookPage = 'look';   // #217 LOOK tab pages: 'look' (light / grade) or 'nudge' (the fixed camera's pose)
const NUDGE_ROWS = [
  [['Move', 'x-', '◀', 'x+', '▶'], ['Up / down', 'y+', '▲', 'y-', '▼'], ['Near / far', 'z-', 'NEAR', 'z+', 'FAR'], ['Zoom', 'fov-', 'IN', 'fov+', 'OUT']],
  [['Turn', 'yaw+', '⟲', 'yaw-', '⟳'], ['Tilt', 'pitch+', 'UP', 'pitch-', 'DOWN'], ['Roll', 'roll+', '⟲', 'roll-', '⟳']],
];
// #391 a video pano lights the phone from one still frame: frame 61 (2 s at 30 fps, past any fade-in), saved to PANO as '<name> light frame.jpg'
async function lightFrame(name) {
  const out = name.replace(/\.[^.]+$/, '') + ' light frame.jpg';
  if ((await media.list('Pano')).some(i => i.name === out)) return out;
  const f = await media.getFile('Video pano', name); if (!f) throw new Error('video pano not found');
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; const url = URL.createObjectURL(f); v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('this video does not play here')); });
    const t = Math.min(61 / 30, Math.max(0, (v.duration || 3) - 0.1));
    await new Promise(res => { v.onseeked = res; v.currentTime = t; setTimeout(res, 4000); });
    const W = Math.min(2048, v.videoWidth), c = document.createElement('canvas'); c.width = W; c.height = Math.round(W * v.videoHeight / v.videoWidth);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92)); if (!blob) throw new Error('could not grab a frame');
    await media.importFile('Pano', new File([blob], out, { type: 'image/jpeg' }));
  } finally { URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); }
  return out;
}
async function lightPhone(folder, name) {
  const cs = spect && spect.cam;
  if (!cs || !cs.fixed) { toast('Start Fixed camera on the phone first (the light belongs to its camera)', 3500); return; }
  if (!spect.syncCopy) return;
  if (folder === 'Video pano') {
    toast('Grabbing a still frame for the light…', 2500);
    try { name = await lightFrame(name); folder = 'Pano'; } catch (e) { toast('LIGHT PHONE: ' + e.message, 4000); return; }
  }
  lightBusy = name; drawMixScreen(); toast(`Sending ${name} to the phone…`, 2500);
  let res = null;
  try { res = await spect.syncCopy([{ f: folder, n: name, q: true, p: false }], st => { lightBusy = `${name} ${st.pct || 0}%`; if (videoPage) drawMixScreen(); }); }
  catch (e) { res = { err: e.message }; }
  lightBusy = '';
  if (res && res.err) { toast('LIGHT PHONE: ' + res.err, 4000); drawMixScreen(); return; }
  spect.camSet({ what: 'flook', key: 'env', v: folder + '/' + name });
  toast(`Phone lit by ${name}: turn it with PHOTO TURN to match the room`, 3500);
  vpFolder = 'Look'; vpLoad();
}
// #220 DJ CAM tab: the LED wall's virtual camera (angle, mirror) and the avatar
function setDjPreset(k) { djSet.preset = k; if (djcam) djcam.preset = k; if (gopro) gopro.setOn(k === 'gopro'); if (gopro2) gopro2.setOn(k === 'gopro2'); saveDjSet(); drawMixScreen(); }   // #338 the GOPRO angle = the GoPro object out
function setDjMirror(on) { djSet.mirror = on; saveDjSet(); if (ledMode === 'cam') ledwall.userData.setCam(djcam.rt.texture, on); drawMixScreen(); }
function setDjAvatar(on) { djSet.avatar = on; saveDjSet(); if (avatar) avatar.root.visible = on; drawMixScreen(); }
// #278 (avatar-stage-plan.md step 1): the robot DJ on the spectator phone. The phone already gets the head and the
// hands / controllers every state tick (rig-local); this adds the mic level, which hand is which and the controllers'
// trigger / grip values and tip balls, so the phone poses its own copy of the robot (the Quest only sends numbers).
function phoneRobotState() {
  if (!djSet.phoneRobot || !renderer.xr.isPresenting || !xr) return undefined;
  if (streamer && streamer.stuRun && streamer.stu.mode !== 'show') return undefined;   // #385 LIVE DJ! / LIVE KEY!: the real DJ is on camera, no robot on the S8
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000, c = [];
  for (const st of xr.inputs) {
    if (!st.connected || st.isHand || !st.source || !st.source.gamepad) continue;
    const b = st.source.gamepad.buttons, t = rig.worldToLocal(st.tip.clone());
    c.push([st.i, r2(b[0] ? b[0].value : 0), r2(b[1] ? b[1].value : 0), r3(t.x), r3(t.y), r3(t.z)]);
  }
  return { m: r3(micLevel()), hs: xr.inputs.map(st => st.connected && st.source ? (st.source.handedness || '')[0] || '' : ''), c };
}
function setPhoneRobot(on) { djSet.phoneRobot = on; saveDjSet(); drawMixScreen(); toast(on ? 'Robot on the phone: on (shows while the headset is in VR)' : 'Robot on the phone: off', 2500); }
function setDjStyle(st) { djSet.style = st; saveDjSet(); useAvatarStyle(st); drawMixScreen(); }
function drawDjCamTab(btn, y0) {
  const { g, canvas: c } = scr(); const W = c.width, H = c.height, P = portrait();
  const on = ledMode === 'cam';
  const top = [
    ['LED DirroDj📹', on, () => setLedMode(on ? 'off' : 'cam')],   // #240 was LED CAM
    ['MIRROR', djSet.mirror, () => setDjMirror(!djSet.mirror)],
    ['AVATAR', djSet.avatar, () => setDjAvatar(!djSet.avatar)],
    [djSet.style === 'human' ? 'STYLE: HUMAN' : 'STYLE: ROBOT', false, () => setDjStyle(djSet.style === 'human' ? 'robot' : 'human')],
    ['ROBOT ON PHONE', !!djSet.phoneRobot, () => setPhoneRobot(!djSet.phoneRobot)],   // #278
  ];
  const per = P ? 3 : top.length, bw = (W - 16 - (per - 1) * 6) / per, tr = Math.ceil(top.length / per);   // #278: five across (#349 portrait: 3 + 2)
  top.forEach(([label, o, act], i) => btn(P && i >= per ? 8 + (i - per) * ((W - 16 - 6) / 2 + 6) : 8 + (i % per) * (bw + 6), y0 + Math.floor(i / per) * 42, P && i >= per ? (W - 16 - 6) / 2 : bw, 36, label, !!o, act));
  const y0b = y0 + (tr - 1) * 42;
  const keys = Object.keys(CAM_PRESETS), pp = P ? 2 : 4, pw = (W - 16 - (pp - 1) * 6) / pp;
  keys.forEach((k, i) => btn(8 + (i % pp) * (pw + 6), y0b + 50 + Math.floor(i / pp) * 42, pw, 36, CAM_PRESETS[k].label, djSet.preset === k, k === 'gopro' ? goproAngleTap : () => setDjPreset(k)));   // #338 GOPRO: double-tap = back to the start
  const ty = y0b + 50 + Math.ceil(keys.length / pp) * 42 + 18;
  g.fillStyle = '#8c96a8'; g.font = '500 16px system-ui'; g.textAlign = 'left';
  const av = !avatar ? 'no avatar' : avatar.status === 'ready' ? 'avatar ready' : 'avatar ' + avatar.status;
  const lines = [`${av} · ${on && djcam ? `cam ${djcam.ms.toFixed(1)} ms a frame (every 3rd headset frame)` : 'LED wall not on DirroDj📹'}`,
    'Look at the LED wall to put the camera in the Meta cast.'];
  lines.forEach((t, i) => fitText2(g, t, 12, Math.min(H - 12, ty + i * 24), W - 24));
}
function drawLookTab(btn, y0) {
  const { g, canvas: c } = scr(); const W = c.width, H = c.height, P = portrait();
  const cs = spect && spect.cam, F = cs && cs.FL, dim = !F;
  const send = (key, v) => { if (spect && spect.camSet) spect.camSet({ what: 'flook', key, v }); };
  const X = cs && cs.FX, nudgeOn = lookPage === 'nudge', setPage = pg => () => { lookPage = pg; drawMixScreen(); };
  const nsend = (key, v) => { if (spect && spect.camSet) spect.camSet({ what: 'fnudge', key, v }); };
  const top = nudgeOn ? [
    ['◀ LOOK', false, setPage('look')],
    ['PREVIEW', pvWanted, () => setPreview(!pvWanted)],
    [X && X.cal ? 'CANCEL CAL' : 'CALIBRATE', !!(X && X.cal), () => nsend('cal', true)],
    [X && X.coarse ? 'STEP: COARSE' : 'STEP: FINE', !!(X && X.coarse), () => { X.coarse = !X.coarse; nsend('coarse', X.coarse); drawMixScreen(); }],
    ['RESET VIEW', false, () => { toast('Reset view: tap again within 3 s to confirm', 2500); if (performance.now() - (drawLookTab.rv || 0) < 3000) { drawLookTab.rv = 0; nsend('reset', true); } else drawLookTab.rv = performance.now(); }],
  ] : [
    ['LOOK', F && F.on, () => send('on', !F.on)],
    ['PREVIEW', pvWanted, () => setPreview(!pvWanted)],
    ['PHOTO KEY', false, () => send('keyFromPano', true), !(F && F.envOK)],
    ['PHOTO OFF', false, () => send('env', ''), !(F && F.env)],
    ['RESET', false, () => send('reset', true)],
    ['NUDGE ▶', false, setPage('nudge')],
  ];
  const per = P ? 3 : 6, bw = (W - 16 - (per - 1) * 6) / per;
  top.forEach(([label, on, act, off], i) => {
    const d = (dim && label !== 'PREVIEW' && label !== '◀ LOOK' && label !== 'NUDGE ▶') || off;
    btn(8 + (i % per) * (bw + 6), y0 + Math.floor(i / per) * 42, bw, 36, label, !!on, d ? null : act, d);
  });
  if (nudgeOn) {   // #217 the fixed camera's nudges, one step per tap (STEP: COARSE for big moves); saved on the phone
    const cols = P ? [NUDGE_ROWS.flat()] : NUDGE_ROWS, colW = P ? W - 16 : (W - 24) / 2, ry = y0 + (P ? 92 : 46), off = !X;
    cols.forEach((col, ci) => col.forEach(([label, k1, t1, k2, t2], ri) => {
      const cx = 8 + ci * (colW + 8), cy = ry + ri * 42;
      g.fillStyle = '#0d1422'; g.fillRect(cx, cy, colW, 36);
      g.fillStyle = off ? '#56627a' : '#dfe6f2'; g.font = P ? '600 15px system-ui' : '600 17px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(label, cx + 10, cy + 19); g.textBaseline = 'alphabetic';
      btn(cx + colW - 150, cy + 2, 70, 32, t1, false, off ? null : () => nsend(k1), off);
      btn(cx + colW - 74, cy + 2, 70, 32, t2, false, off ? null : () => nsend(k2), off);
    }));
    const rows = P ? NUDGE_ROWS.flat().length : NUDGE_ROWS[0].length, y = ry + rows * 42 + (P ? 22 : 14);
    g.textAlign = 'left'; g.font = '500 15px system-ui'; g.fillStyle = X ? '#8c96a8' : '#c9a040';
    const txt = !cs ? 'Phone not connected.' : !X ? 'Start Fixed camera on the phone (tripod mode) to nudge its view from here.'
      : `Zoom ${X.fov}° · ${X.coarse ? 'coarse' : 'fine'} steps · ${X.cal ? 'calibrating (touch the points)' : cs.cal ? 'calibrated' + (cs.fpx != null ? ' ' + cs.fpx + ' px' : '') : 'not calibrated'} · Tip: hands on the platters, nudge until the virtual hands sit on yours`;
    wrapText(g, txt, 12, y, W - 24, 20, P ? 5 : 2);
    return;
  }
  const cols = P ? [LOOK_ROWS.flat()] : LOOK_ROWS, colW = P ? W - 16 : (W - 24) / 2, ry = y0 + (P ? 92 : 46);
  const fmtV = (k, v, u) => v == null ? '--' : u === 'pct' ? Math.round(v * 100) + '%' : u === 'deg' ? Math.round(v) + '°' : u === 'K' ? (F && F.kRGB ? 'photo' : Math.round(v) + 'K') : (+v).toFixed(2);
  cols.forEach((col, ci) => col.forEach(([label, key, step, u], ri) => {
    const cx = 8 + ci * (colW + 8), cy = ry + ri * 42, v = F ? F[key] : null, off = dim || (key === 'envTurn' && !F.env);
    g.fillStyle = '#0d1422'; g.fillRect(cx, cy, colW, 36);
    g.fillStyle = off ? '#56627a' : '#dfe6f2'; g.font = P ? '600 15px system-ui' : '600 17px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(label, cx + 10, cy + 19);
    g.textAlign = 'right'; g.fillStyle = off ? '#56627a' : '#fff'; g.font = P ? '700 15px ui-monospace, monospace' : '700 18px ui-monospace, monospace';
    g.fillText(fmtV(key, v, u), cx + colW - 106, cy + 19); g.textBaseline = 'alphabetic';
    const bump = d => () => { const nv = Math.round((v + d) * 1000) / 1000; F[key] = nv; if (key === 'kTemp') F.kRGB = null; send(key, nv); drawMixScreen(); };
    btn(cx + colW - 100, cy + 2, 44, 32, '−', false, off ? null : bump(-step), off);
    btn(cx + colW - 50, cy + 2, 44, 32, '+', false, off ? null : bump(step), off);
  }));
  const rows = P ? LOOK_ROWS.flat().length : LOOK_ROWS[0].length;
  let y = ry + rows * 42 + (P ? 22 : 14);
  g.textAlign = 'left'; g.font = '500 15px system-ui'; g.fillStyle = F ? '#8c96a8' : '#c9a040';
  const photo = F ? (F.env ? (F.envOK ? F.env.split('/').pop() : (F.envMsg || 'loading…')) : 'none (PANO tab: pick one, LIGHT PHONE)') : '';
  const txt = !cs ? 'Phone not connected: Settings > Spectator camera On, then Connect on the phone.'
    : !F ? 'Start Fixed camera on the phone (tripod mode): this page sets its look. AR mode uses the CAMERA tab.'
    : `${F.cam === 'user' ? 'Selfie' : 'Main'} camera (saved for it) · 360 light photo: ${photo}` + (lightBusy ? ` · sending ${lightBusy}` : '') + (cs.flErr ? ' · ' + cs.flErr : '');
  if (P) wrapText(g, txt, 12, y, W - 24, 20, 5); else { wrapText(g, txt, 12, y, W - 24, 20, 2); }
}
// ---- #206 SYNC tab (VIDEO page): both libraries side by side (Quest and phone), pick items, COPY puts each one on the
// side that doesn't have it. Only adds (spectator-host.js syncList / syncCopy); a name on both sides is left alone.
let syncItems = null, syncMsg = '', syncPg = 0, syncAll = false;
// #218 PREP COVERS: every cover of the crate's current list (playlist or search) to the phone ahead of a gig
const prep = { on: false, i: 0, n: 0, sent: 0, stop: false };
async function prepCovers() {
  if (prep.on) { prep.stop = true; return; }
  if (!spect || !spect.prepCovers) { syncMsg = 'Spectator camera is off: Settings > Spectator camera On, then Connect on the phone.'; drawMixScreen(); return; }
  const tracks = new Map();
  for (const r of currentList()) { const t = r && !r.missing && (r.sides.A || r.sides.B); if (t && !t.missing) { const k = coverKey(t); coverTracks.set(k, t); tracks.set(k, t); } }
  Object.assign(prep, { on: true, i: 0, n: tracks.size, sent: 0, stop: false }); drawMixScreen();
  try {
    await spect.prepCovers([...tracks.keys()], st => { Object.assign(prep, st); syncMsg = `Covers to the phone: ${prep.i} of ${prep.n} checked, ${prep.sent} sent`; if (videoPage) drawMixScreen(); return prep.stop; });
    syncMsg = `Covers ready on the phone: ${prep.n} tracks (${prep.sent} new)` + (prep.stop ? ' · stopped' : '');
  } catch (e) { syncMsg = 'PREP COVERS: ' + e.message; }
  prep.on = false; drawMixScreen();
}
const syncSel = new Set();   // 'folder/name'
const SYNC_TAG = { Pano: 'PANO', 'Video pano': 'VPANO', Video: 'VIDEO', Images: 'IMG' };
function syncExtras() {   // the Quest's VideoVinyl clips stored with its songs (headset library), offered as Video items
  if (settings.source !== 'headset') return [];
  return [...vvIndex.values()].map(p => ({ f: 'Video', n: p.split('/').pop(), get: () => store.readFile(p) }));
}
async function syncLoad() {
  syncMsg = 'Reading both libraries…'; drawMixScreen();
  if (!spect || !spect.syncList) { syncItems = null; syncMsg = 'Spectator camera is off: Settings > Spectator camera On, then Connect on the phone.'; drawMixScreen(); return; }
  try { syncItems = await spect.syncList(syncExtras); syncMsg = ''; for (const k of [...syncSel]) if (!syncItems.some(i => i.f + '/' + i.n === k && i.q !== i.p)) syncSel.delete(k); }
  catch (e) { syncItems = null; syncMsg = e.message; }
  drawMixScreen();
}
async function syncCopy() {
  if (!spect || !syncItems || (spect.sync && spect.sync.on)) return;
  const pick = syncItems.filter(i => syncSel.has(i.f + '/' + i.n) && i.q !== i.p); if (!pick.length) return;
  try { await spect.syncCopy(pick, () => drawMixScreen()); } catch (e) { syncMsg = e.message; }
  syncSel.clear(); await syncLoad();
}
function drawSyncTab(btn, y0) {
  const { g, canvas: c } = scr(); const W = c.width, H = c.height, P = portrait();
  const sy = spect && spect.sync, busy = !!(sy && sy.on);
  const shown = (syncItems || []).filter(i => syncAll || i.q !== i.p);
  const cols = P ? 1 : 2, rows = P ? 18 : 7, per = cols * rows, RH = 26, colW = (W - (P ? 44 : 16) - (cols - 1) * 8) / cols, x0 = P ? 22 : 8;
  const pages = Math.max(1, Math.ceil(shown.length / per)); syncPg = Math.min(syncPg, pages - 1);
  g.textBaseline = 'middle';
  shown.slice(syncPg * per, syncPg * per + per).forEach((it, i) => {
    const cx = x0 + Math.floor(i / rows) * (colW + 8), cy = y0 + (i % rows) * RH, key = it.f + '/' + it.n, can = it.q !== it.p && !busy, on = syncSel.has(key);
    g.fillStyle = on ? '#16304a' : '#0d1422'; g.fillRect(cx, cy, colW, RH - 3);
    g.strokeStyle = can ? '#8c96a8' : '#2e3850'; g.lineWidth = 2; g.strokeRect(cx + 6, cy + 5, 13, 13);
    if (on) { g.fillStyle = '#39a8ff'; g.fillRect(cx + 9, cy + 8, 7, 7); }
    g.textAlign = 'left'; g.font = '700 11px system-ui'; g.fillStyle = '#56627a'; g.fillText(SYNC_TAG[it.f] || it.f, cx + 26, cy + 12);
    g.font = '500 14px system-ui'; g.fillStyle = it.q !== it.p ? '#dfe6f2' : '#56627a';
    fitText2(g, it.n.replace(/\.[^.]+$/, ''), cx + 70, cy + 12, colW - 70 - 64);
    g.font = '700 13px system-ui'; g.textAlign = 'center';
    g.fillStyle = it.q ? '#40d080' : '#3a4252'; g.fillText('QUEST', cx + colW - 44, cy + 12);
    g.fillStyle = it.p ? '#40d080' : '#3a4252'; g.fillText('PH', cx + colW - 12, cy + 12);
    if (can) VP_HIT.push({ x: cx, y: cy, w: colW, h: RH - 3, act: () => { on ? syncSel.delete(key) : syncSel.add(key); drawMixScreen(); } });
  });
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  if (!shown.length) {
    g.fillStyle = '#8c96a8'; g.font = '500 16px system-ui';
    const t = syncMsg || (syncItems ? (syncItems.length ? 'Both have everything: nothing to copy (SHOW ALL lists it all).' : 'Both libraries are empty.') : '');
    wrapText(g, t, x0 + 8, y0 + 30, W - 2 * x0 - 16, 22, 4);
  }
  // status line: progress or the last result
  let stTxt = syncMsg && shown.length ? syncMsg : '';
  if (busy) stTxt = `${sy.dir === 'in' ? 'Phone → Quest' : 'Quest → phone'} ${sy.i} of ${sy.n}: ${sy.name} ${sy.pct}%`;
  else if (sy && sy.n && !syncMsg) stTxt = `Last copy: ${sy.done} copied${sy.skipped ? `, ${sy.skipped} skipped` : ''}${sy.err ? ' · stopped: ' + sy.err : ''}`;
  g.font = '500 13px system-ui'; g.fillStyle = busy ? '#40d080' : '#8c96a8';
  if (stTxt) fitText2(g, stTxt, x0 + 4, P ? H - 116 : H - 50, W - 2 * x0 - 8);
  // buttons
  const nSel = syncSel.size, bh = 36, missing = shown.filter(i => i.q !== i.p);
  const selAll = () => { const all = missing.every(i => syncSel.has(i.f + '/' + i.n)); for (const i of missing) all ? syncSel.delete(i.f + '/' + i.n) : syncSel.add(i.f + '/' + i.n); drawMixScreen(); };
  const b = [
    ['‹', false, () => { syncPg = Math.max(0, syncPg - 1); drawMixScreen(); }, syncPg === 0, 44],
    ['›', false, () => { syncPg = Math.min(pages - 1, syncPg + 1); drawMixScreen(); }, syncPg >= pages - 1, 44],
    ['SELECT ALL', false, selAll, busy || !missing.length, 0],
    [syncAll ? 'MISSING ONLY' : 'SHOW ALL', syncAll, () => { syncAll = !syncAll; syncPg = 0; drawMixScreen(); }, false, 0],
    ['REFRESH', false, () => syncLoad(), busy, 0],
    [busy ? `COPYING ${sy.i}/${sy.n}` : `COPY ${nSel || ''}`.trim(), busy, () => syncCopy(), busy || !nSel, 0],
    [prep.on ? `STOP ${prep.i}/${prep.n}` : (P ? 'COVERS' : 'PREP COVERS'), prep.on, () => prepCovers(), false, 0],   // #218
  ];
  const row = (list, y, x1, x2) => { const fixed = list.reduce((a, q) => a + (q[4] || 0), 0), flex = list.filter(q => !q[4]).length, w = (x2 - x1 - fixed - (list.length - 1) * 6) / Math.max(1, flex); let x = x1;
    for (const [label, on, act, dim, fw] of list) { const bw = fw || w; btn(x, y, bw, bh, label, on, dim ? null : act, dim); x += bw + 6; } };
  if (P) { row(b.slice(2, 5), H - 106, x0, W - x0); row([b[0], b[1], b[5], b[6]], H - 62, 26, W - 26); }
  else row(b, H - 44, 8, W - 8);
}
function drawVideoPage() {
  const { g, canvas: c } = scr(); const W = c.width, H = c.height, P = portrait(), PER = vpPer();
  VP_HIT.length = 0;
  g.fillStyle = '#05070c'; g.fillRect(0, 0, W, H);
  const btn = (x, y, w, h, label, on, act, dim) => {
    g.fillStyle = on ? '#c8202c' : dim ? '#2a3140' : '#c9ced8'; g.fillRect(x, y, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = on ? '#fff' : dim ? '#56627a' : '#3a4252';
    btnLabel(g, label, x, y, w, h, 17); g.textBaseline = 'alphabetic';   // #198 narrow portrait buttons (#349 two lines)
    if (act) VP_HIT.push({ x, y, w, h, act });
  };
  const pick = f => () => { vpFolder = f; vpSel = null; vpSelFolder = null; vpPg = 0; vpLoad(); };
  if (P) {   // #198 portrait: tabs in rows of 3 (#206: 3 rows, SYNC added, MIXER last); top and bottom keep clear of the corner L
    const tabs = [...VP_LIB, 'Camera', 'Sync', 'Look', 'DJ Cam', 'Fx'], tw = (W - 30 - 12) / 3;   // #379 + FX   // #214 LOOK, #220 DJ CAM
    // #363 a top row of its own: title, then DJ MIXER and BACK at the top right; the tabs move down a row
    btn(22, 28, tw, 34, 'PREVIEW', monOn, () => setMonitor(!monOn));   // #389 the master PREVIEW (where the title was)
    btn(22 + (tw + 6), 28, tw, 34, 'DJ MIXER', false, () => setVideoPage(false));
    btn(22 + 2 * (tw + 6), 28, tw, 34, '◀ BACK', false, navCan() ? navBack : null, !navCan());
    const tw4 = (W - 30 - 18) / 4;   // #441 the last row has four: two tabs, SCROLLER and WALL +1
    tabs.forEach((f, i) => btn(i < 6 ? 22 + (i % 3) * (tw + 6) : 22 + (i - 6) * (tw4 + 6), 68 + Math.floor(i / 3) * 40, i < 6 ? tw : tw4, 34, VP_TABS[f], f === vpFolder, f === 'DJ Cam' ? openGoprosPage : pick(f)));
    btn(22 + 2 * (tw4 + 6), 148, tw4, 34, 'SCROLLER', !!(scroller && scroller.on), openScrollerFromVP);
    btn(22 + 3 * (tw4 + 6), 148, tw4, 34, 'WALL ⁺¹', ledMode !== 'off', () => { videoPage = false; setTools('wall'); });   // #379 moved one over for FX   // #342 the scroller editor
  } else {
    let x = 8;   // #214 seven tabs fit left of MIXER; #220 eight (narrower); #363 narrower again for BACK
    for (const f of [...VP_LIB, 'Camera', 'Sync', 'Look', 'DJ Cam', 'Fx']) { const w = { Pano: 50, Video: 50, Images: 58, Camera: 66, Sync: 44, Look: 44, 'DJ Cam': 62, Fx: 36 }[f]; btn(x, 8, w, 32, VP_TABS[f], f === vpFolder, f === 'DJ Cam' ? openGoprosPage : pick(f)); x += w + 4; }   // #379 narrower again for FX
    btn(x, 8, 62, 32, 'SCROLLER', !!(scroller && scroller.on), openScrollerFromVP);   // #342 the scroller editor
    btn(x + 66, 8, 52, 32, 'WALL ⁺¹', ledMode !== 'off', () => { videoPage = false; setTools('wall'); });   // #441
    btn(W - 8 - 62 - 4 - 66 - 4 - 56, 8, 56, 32, 'MIXER', false, () => setVideoPage(false));   // #225 (#441 narrower for WALL)
    btn(W - 8 - 62 - 4 - 66, 8, 66, 32, 'PREVIEW', monOn, () => setMonitor(!monOn));   // #389 the master PREVIEW
    btn(W - 8 - 62, 8, 62, 32, '◀ BACK', false, navCan() ? navBack : null, !navCan());   // #363
  }
  const y0 = P ? 192 : 48;   // #363 portrait: one more header row
  if (vpFolder === 'Camera') { drawCamTab(btn, y0); return; }
  if (vpFolder === 'Sync') { drawSyncTab(btn, y0); return; }   // #206
  if (vpFolder === 'Look') { drawLookTab(btn, y0); return; }   // #214
  if (vpFolder === 'DJ Cam') { drawDjCamTab(btn, y0); return; }   // #220
  if (vpFolder === 'LedList') { drawLedList(btn, y0); return; }   // #222
  if (vpFolder === 'Fx') { drawFxTab(btn, y0); return; }   // #379
  // thumbnails: 4 x 2 (portrait 2 x 6)
  const COLS = P ? 2 : 4, CW = (W - 16 - (COLS - 1) * 8) / COLS, TH = P ? 64 : 76, CH = TH + 20;
  const pages = Math.max(1, Math.ceil(vpItems.length / PER)); vpPg = Math.min(vpPg, pages - 1);
  if (!vpItems.length) {
    g.fillStyle = '#8c96a8'; g.font = '500 18px system-ui'; g.textAlign = 'left';
    const n = wrapText(g, `Nothing in ${vpFolder} on this headset yet.`, 16, y0 + 40, W - 32, 26, 3);
    wrapText(g, 'Add some on the start page (Add pictures / videos…), or on the phone: Library, Import, then Push to Quest.', 16, y0 + 48 + n * 26, W - 32, 24, 4);
  }
  const cur = settings.env === 'image' && settings.sky === 'on' ? settings.skyMedia : '';
  vpItems.slice(vpPg * PER, vpPg * PER + PER).forEach((it, i) => {
    const cx = 8 + (i % COLS) * (CW + 8), cy = y0 + Math.floor(i / COLS) * (CH + 6);
    const itF = it.folder || vpFolder, lp = it.loopId && grab.loops.find(x => x.id === it.loopId), t = it.loopId ? (lp && lp.thumb) : vpThumb(itF, it.name);
    g.fillStyle = '#121824'; g.fillRect(cx, cy, CW, TH);
    if (t && t !== 'loading') {   // cover the cell
      const s = Math.max(CW / t.width, TH / t.height), sw = CW / s, sh = TH / s;
      g.drawImage(t, (t.width - sw) / 2, (t.height - sh) / 2, sw, sh, cx, cy, CW, TH);
    }
    drawTypeBadge(g, cx + CW - 30, cy + TH - 22, itF === 'Video' || itF === 'Video pano');   // #224
    const on = [vvOverride[0], vvOverride[1]].map(o => o && vpFolder === 'Video' && o.name === it.name);
    const tag = lp ? (ledMode === 'retro' && ledFx.s === 'loop' && ledFx.loop === lp ? 'WALL' : 'LOOP') : cur === itF + '/' + it.name ? 'SKY' : on[0] ? 'A' : on[1] ? 'B' : led.name === it.name ? 'LED' : '';
    if (tag) { g.fillStyle = '#40d080'; g.fillRect(cx + 4, cy + 4, 14 + tag.length * 11, 20); g.fillStyle = '#05070c'; g.font = '700 14px system-ui'; g.textAlign = 'left'; g.fillText(tag, cx + 9, cy + 19); }
    if (it.name === vpSel) { g.strokeStyle = '#39a8ff'; g.lineWidth = 4; g.strokeRect(cx + 2, cy + 2, CW - 4, TH + 16); }
    g.fillStyle = it.name === vpSel ? '#fff' : '#b8c0cf'; g.font = '500 14px system-ui'; g.textAlign = 'left';
    fitText2(g, it.name.replace(/\.[^.]+$/, ''), cx + 2, cy + TH + 15, CW - 4);
    if (vpDel === it.name) {   // #222 delete offer: red frame + X
      g.strokeStyle = '#ff3040'; g.lineWidth = 5; g.strokeRect(cx + 2, cy + 2, CW - 4, TH + 16);
      g.fillStyle = 'rgba(5,7,12,0.55)'; g.fillRect(cx, cy, CW, TH);
      const xs = 40, xx = cx + CW - xs - 4, xy = cy + 4;
      g.fillStyle = '#d0202c'; g.fillRect(xx, xy, xs, xs); g.strokeStyle = '#fff'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(xx + 11, xy + 11); g.lineTo(xx + xs - 11, xy + xs - 11); g.moveTo(xx + xs - 11, xy + 11); g.lineTo(xx + 11, xy + xs - 11); g.stroke();
      g.fillStyle = '#fff'; g.font = '700 13px system-ui'; g.textAlign = 'left'; g.fillText('DELETE?', cx + 6, cy + TH - 8);
      const folder = itF, name = it.name;
      VP_HIT.push({ x: xx - 4, y: xy - 4, w: xs + 8, h: xs + 8, del: true, act: () => deleteMedia(folder, name) });
    }
    VP_HIT.push({ x: cx, y: cy, w: CW, h: CH, item: it.name, act: () => { if (vd.pick != null && !it.loopId) { vdAssign(it.name); return; } vpSel = it.name === vpSel ? null : it.name; vpSelFolder = vpSel ? itF : null; drawMixScreen(); } });
  });
  if (vd.pick != null) { g.strokeStyle = '#ff3040'; g.lineWidth = 4; g.strokeRect(2, 2, W - 4, H - 4); g.fillStyle = '#ff6070'; g.font = '700 15px system-ui'; g.textAlign = 'right'; g.fillText(`PICK THE MATTE FOR SLOT ${vd.pick + 1}`, W - 12, y0 + 12); }   // #442
  // bottom bar: pages, targets for this folder, LED mode (portrait: targets get a row of their own)
  const by = P ? H - 62 : H - 44, bh = 36, bx = P ? 26 : 8;
  btn(bx, by, 44, bh, '‹', false, () => { vpPg = Math.max(0, vpPg - 1); drawMixScreen(); }, vpPg === 0);
  btn(bx + 48, by, 44, bh, '›', false, () => { vpPg = Math.min(pages - 1, vpPg + 1); drawMixScreen(); }, vpPg >= pages - 1);
  const T = { Pano: [['SKY', 'sky'], ['SKY OFF', 'skyoff'], ['LIGHT PHONE', 'light']], 'Video pano': [['SKY', 'sky'], ['SKY OFF', 'skyoff'], ['LIGHT PHONE', 'light']],
    Video: [['DECK A', 'deckA'], ['DECK B', 'deckB'], ['LED NOW', 'lednow'], ['+ LED', 'ledadd']], Images: [['LED NOW', 'lednow'], ['+ LED', 'ledadd']] }[vpFolder];
  const tw = P ? (W - 16 - (T.length - 1) * 6) / T.length : 86, ty = P ? H - 106 : by;
  let x = P ? 8 : 108;
  for (const [label, what] of T) { const dim = (!vpSel && what !== 'skyoff'); btn(x, ty, tw, bh, label, false, dim ? null : () => vpAct(what), dim); x += tw + 6; }
  if (vpFolder === 'Pano') {   // #379 PANO SPIN 0 to 5 (degrees a second); landscape: between the SKY buttons and the LED button, portrait: a row of its own
    const sx = P ? 26 : x, sw = P ? W - 52 : W - 8 - 140 - 6 - x;
    tSlider(g, sx, P ? H - 150 : by, sw, bh, 'PANO TURN', settings.skyTurn / 359, `${settings.skyTurn}°`, v => setSkyTurn(v * 359));   // #389 was SPIN: a bar that turns the pano by hand
  }
  const hasList = vpFolder === 'Video' || vpFolder === 'Images';   // #222 the LED playlist, one tap away
  if (hasList) btn(P ? 124 : 522, by, P ? 70 : 92, bh, `LED LIST ${led.files.length}`, false, () => { vpBack = vpFolder; vpFolder = 'LedList'; vpLoad(); });
  const mw = P && hasList ? 78 : 140;
  btn(W - (P ? 26 : 8) - mw, by, mw, bh, LED_LABEL[ledMode], ledMode !== 'off', () => setLedMode(nextLedMode(ledMode)));   // #238 + LIVE
}
// #379 tablet slider: tap (or keep tapping) anywhere along it to set the value
function tSlider(g, x, y, w, h, label, v, txt, set, dim, lwMax = 110) {   // #423 lwMax: room for a longer label
  v = clamp(v, 0, 1);
  g.fillStyle = '#0d1422'; g.fillRect(x, y, w, h);
  const lw = Math.round(Math.min(lwMax, Math.max(w * 0.36, label.length * 8.6 + 12))), vw = 58, tx = x + lw, tw = Math.max(20, w - lw - vw - 6), ty = y + h / 2;
  g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = '700 13px system-ui'; g.fillStyle = dim ? '#56627a' : '#dfe6f2';
  fitText2(g, label, x + 8, ty + 1, lw - 12);
  g.fillStyle = '#1e2a3d'; g.fillRect(tx, ty - 3, tw, 6);
  g.fillStyle = dim ? '#3a4660' : '#c8202c'; g.fillRect(tx, ty - 3, tw * v, 6);
  g.fillStyle = dim ? '#56627a' : '#dfe6f2'; g.beginPath(); g.arc(tx + tw * v, ty, 8, 0, 2 * Math.PI); g.fill();
  g.textAlign = 'right'; g.font = '600 13px system-ui'; g.fillText(txt, x + w - 6, ty + 1);
  g.textBaseline = 'alphabetic';
  VP_HIT.push({ x: tx - 10, y, w: tw + 20, h, drag: true, act: px => set(clamp((px - tx) / tw, 0, 1)) });   // #422 drag: finger / mouse held on the bar keeps moving it
}
// #379 VISUALS > FX: FLOAT balls (the DJ drops them on gear in the headset; here the list with each one's float amount) and WATER
let fxClearT = 0;
function drawFxTab(btn, y0) {
  const { g, canvas: c } = scr(); const W = c.width, H = c.height, P = portrait();
  g.textAlign = 'left';
  if (!fx) { g.fillStyle = '#8c96a8'; g.font = '500 17px system-ui'; wrapText(g, 'FX is made on the headset / desktop page.', 16, y0 + 30, W - 32, 24, 2); return; }
  const wt = fx.water, clearArm = performance.now() - fxClearT < 3000, nb = fx.balls.length;
  const top = [
    ['FLOAT +', false, () => { if (fx.spawnBall()) toast('FLOAT: a blue ball in front of you (only you see it). Grip it and drop it on gear; slide the bar over it; grip it twice quickly to remove it.', 5000); }, false],
    [wt.on ? 'WATER: ON' : 'WATER', wt.on, () => wt.tap(), false],
    ['WATER HERE', false, () => { wt.here(); if (!wt.on) wt.tap(); }, false],
    [clearArm ? 'TAP AGAIN' : 'CLEAR FLOATS', clearArm, nb ? () => { if (performance.now() - fxClearT < 3000) { fxClearT = 0; fx.clearFloats(); toast('Floats cleared', 1500); } else fxClearT = performance.now(); } : null, !nb],
  ];
  const per = P ? 2 : 4, bw = (W - 16 - (per - 1) * 6) / per;
  top.forEach(([l, on, act, dim], i) => btn(8 + (i % per) * (bw + 6), y0 + Math.floor(i / per) * 40, bw, 34, l, on, act, dim));
  const RH = P ? 34 : 29, ly = y0 + (P ? 84 : 44), colW = P ? W - 16 : (W - 24) / 2, lx = 8, rowsF = P ? 5 : Math.floor((H - 8 - ly) / RH);
  if (!nb) {
    g.fillStyle = '#8c96a8'; g.font = '500 15px system-ui';
    wrapText(g, 'FLOAT + puts a see-through blue ball in front of you (only you see it, never the stream). Grip it and drop it on a deck, the mixer, a crate, the flight case, a sleeve or a record: it floats as if on water, and whatever sits on it rides along. Slide the bar over the ball to set how much. Grip the ball twice quickly to remove it.', lx + 4, ly + 12, colW - 8, 20, P ? 8 : 10);
  }
  fx.balls.slice(0, rowsF).forEach((b, i) => {
    const y = ly + i * RH, sw = colW - 42;
    if (b.target) tSlider(g, lx, y, sw, RH - 4, b.target.label, b.v, Math.round(b.v * 100) + '%', v => { b.setV(v); fx.save(); });
    else { g.fillStyle = '#0d1422'; g.fillRect(lx, y, sw, RH - 4); g.fillStyle = '#8c96a8'; g.font = '600 13px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle'; fitText2(g, b.held ? 'FLOAT (in your hand)' : 'FLOAT (not on gear yet)', lx + 8, y + (RH - 4) / 2 + 1, sw - 16); g.textBaseline = 'alphabetic'; }
    btn(lx + sw + 6, y, 36, RH - 4, '✕', false, () => fx.removeBall(b));
  });
  if (nb > rowsF) { g.fillStyle = '#8c96a8'; g.font = '500 13px system-ui'; g.textAlign = 'left'; g.fillText(`+${nb - rowsF} more`, lx + 4, ly + rowsF * RH + 12); }
  // WATER (the corner cube in the headset sets width and depth separately; SIZE here keeps their ratio)
  const wx = P ? 8 : 16 + colW, wy = P ? ly + 5 * RH + 12 : ly, dim = !wt.on, pc = v => Math.round(v * 100) + '%';
  const rows = [
    ['WATER LEVEL', (wt.obj.position.y + 0.3) / 1.5, Math.round(wt.obj.position.y * 100) + ' cm', v => wt.set('level', -0.3 + v * 1.5)],
    ['SIZE', (Math.max(wt.w, wt.d) - 0.5) / 9.5, `${wt.w.toFixed(1)}x${wt.d.toFixed(1)}`, v => { const m = Math.max(wt.w, wt.d), k = (0.5 + v * 9.5) / m; wt.setSize(wt.w * k, wt.d * k); wt.save(); }],
    ['RIPPLE', wt.rip / 2, pc(wt.rip / 2), v => wt.set('rip', v * 2)],
    ['MURK', wt.murk, pc(wt.murk), v => wt.set('murk', v)],
    ['REFRACT', wt.refr, pc(wt.refr), v => wt.set('refr', v)],
    ['CAUSTICS', wt.caus, pc(wt.caus), v => wt.set('caus', v)],
    ['CLEAR', wt.clar, pc(wt.clar), v => wt.set('clar', v)],
  ];
  rows.forEach(([l, v, t, set], i) => tSlider(g, wx, wy + i * RH, colW, RH - 4, l, v, t, set, dim));
}
// ---- #222 LED LIST: the LED wall's playlist (what LED NOW / + LED added), in order: play one now, move it up or
// down, take it off the list; IN ORDER / RANDOM. Kept between sessions (names + library folder).
let vpBack = 'Video', ledPg = 0;
const ledSrc = new Map();   // file name -> library folder
function saveLedList() { try { localStorage.setItem('vire.ledList', JSON.stringify({ order: led.order, items: led.files.map(f => [ledSrc.get(f.name) || '', f.name]) })); } catch {} }
async function restoreLedList() {
  let L = null; try { L = JSON.parse(localStorage.getItem('vire.ledList') || 'null'); } catch {}
  if (!L) return; led.order = L.order === 'list' ? 'list' : 'random';
  for (const [folder, name] of L.items || []) { if (!folder) continue; const f = await media.getFile(folder, name).catch(() => null); if (f) { led.add(f); ledSrc.set(name, folder); } }
  drawMixScreen();
}
function drawLedList(btn, y0) {
  const { g, canvas: c } = scr(); const W = c.width, H = c.height, P = portrait();
  const RH = 42, rows = P ? 11 : 4, files = led.files, pages = Math.max(1, Math.ceil(files.length / rows)); ledPg = Math.min(ledPg, pages - 1);
  g.textBaseline = 'middle';
  if (!files.length) { g.fillStyle = '#8c96a8'; g.font = '500 17px system-ui'; g.textAlign = 'left'; wrapText(g, 'The LED playlist is empty. In VIDEO or IMAGES pick a thumbnail, then + LED (or LED NOW).', 14, y0 + 24, W - 28, 24, 4); }
  files.slice(ledPg * rows, ledPg * rows + rows).forEach((f, k) => {
    const i = ledPg * rows + k, y = y0 + k * RH, cur = led.on && led.name === f.name;
    g.fillStyle = cur ? '#14324a' : '#0d1422'; g.fillRect(8, y, W - 16, RH - 6);
    const folder = ledSrc.get(f.name), t = folder ? vpThumb(folder, f.name) : null;
    if (t && t !== 'loading') { const s = Math.max(56 / t.width, 32 / t.height), sw = 56 / s, sh = 32 / s; g.drawImage(t, (t.width - sw) / 2, (t.height - sh) / 2, sw, sh, 12, y + 2, 56, 32); }
    g.fillStyle = cur ? '#40d080' : '#dfe6f2'; g.font = `${cur ? 700 : 500} ${P ? 14 : 16}px system-ui`; g.textAlign = 'left';
    const bw = P ? 40 : 46, bx = W - 8 - 4 * (bw + 4);
    fitText2(g, `${i + 1}. ${f.name.replace(/\.[^.]+$/, '')}`, 74, y + RH / 2 - 3, bx - 80);
    btn(bx, y + 2, bw, RH - 10, '▶', cur, () => { led.play(f); clipsMode(); });
    btn(bx + (bw + 4), y + 2, bw, RH - 10, '▲', false, i > 0 ? () => { led.move(f.name, -1); saveLedList(); } : null, i === 0);
    btn(bx + 2 * (bw + 4), y + 2, bw, RH - 10, '▼', false, i < files.length - 1 ? () => { led.move(f.name, 1); saveLedList(); } : null, i === files.length - 1);
    btn(bx + 3 * (bw + 4), y + 2, bw, RH - 10, '✕', false, () => { led.remove(f.name); ledSrc.delete(f.name); saveLedList(); });
  });
  g.textBaseline = 'alphabetic';
  const by = P ? H - 62 : H - 44, bh = 36, bx = P ? 26 : 8;
  btn(bx, by, 44, bh, '‹', false, () => { ledPg = Math.max(0, ledPg - 1); }, ledPg === 0);
  btn(bx + 48, by, 44, bh, '›', false, () => { ledPg = Math.min(pages - 1, ledPg + 1); }, ledPg >= pages - 1);
  const row2 = P ? H - 106 : by, x2 = P ? 8 : 108, w2 = P ? (W - 16 - 12) / 3 : 120;
  btn(x2, row2, w2, bh, '◀ ' + (VP_TABS[vpBack] || 'BACK'), false, () => { vpFolder = vpBack; vpLoad(); });   // #363 named, so it isn't mistaken for the top-right BACK
  btn(x2 + w2 + 6, row2, w2, bh, led.order === 'list' ? 'IN ORDER' : 'RANDOM', led.order === 'list', () => { led.order = led.order === 'list' ? 'random' : 'list'; saveLedList(); });
  btn(x2 + 2 * (w2 + 6), row2, w2, bh, 'NEXT ▶▶', false, files.length ? () => { clipsMode(); led.next(); } : null, !files.length);
  btn(W - (P ? 26 : 8) - 140, by, 140, bh, LED_LABEL[ledMode], ledMode !== 'off', () => setLedMode(nextLedMode(ledMode)));   // #238 + LIVE
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
// #222 long press on the tablet (trigger / pinch / fingertip held 0.6 s): on a VIDEO page thumbnail it offers delete
let screenHold = null, holdSeq = 0, vpDel = null;
let screenDrag = null;   // #422 the slider being dragged on the tablet
function mixScreenRelease() { screenHold = null; screenDrag = null; }
function scrUvPx(uv) { const c = scr().canvas; return [(scrDir === 'px' ? 1 - uv.y : scrDir === 'nx' ? uv.y : uv.x) * c.width, (scrDir === 'px' ? 1 - uv.x : scrDir === 'nx' ? uv.x : 1 - uv.y) * c.height]; }
function mixScreenDrag(uv) {   // #422 finger still on the screen (XR) / mouse held (desktop): a grabbed slider follows it
  if (!screenDrag || !uv) return; const [px, py] = scrUvPx(uv);
  screenHold = null; screenDrag.act(px, py); drawMixScreen();
}
function mixScreenLong(px, py) {
  if (toolsPage) { const b = VP_HIT.find(h => h.long && px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h); if (b) b.long(); return; }   // #404 tablet buttons with a long press (the GOPRO buttons: reset)
  if (!videoPage || !media.FOLDERS.includes(vpFolder)) return;
  const b = VP_HIT.find(h => h.item && px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h);
  if (!b) return;
  vpDel = b.item; vpSel = b.item; drawMixScreen();
}
async function deleteMedia(folder, name) {   // remove from this headset's library, and stop using it anywhere
  const lpi = vpItems.find(i => i.name === name && i.loopId);   // #441 a grabbed loop: just drop it from this session
  if (lpi) { const k = grab.loops.findIndex(x => x.id === lpi.loopId); if (k >= 0) { if (ledFx.loop === grab.loops[k]) { ledFx.s = 'dancer'; ledFx.loop = null; } grab.loops.splice(k, 1); } vpSel = null; vpDel = null; toast('Loop removed', 1500); vpLoad(); return; }
  if (led.files.some(f => f.name === name)) { led.remove(name); ledSrc.delete(name); saveLedList(); }
  if (settings.skyMedia === folder + '/' + name) { settings.sky = 'off'; saveSettings(); syncSettingsUI(); applySky(); }
  for (let i = 0; i < 2; i++) if (vvOverride[i] && vvOverride[i].name === name) vvOverride[i] = null;
  await media.remove(folder, name); vpThumbs.delete(folder + '/' + name);
  if (vpSel === name) vpSel = null; vpDel = null;
  toast(`Deleted ${name}`, 2000); vpLoad();
}
function mixScreenPress(uv) {
  if (!uv) return;
  // #198 portrait: the canvas is turned 90 deg on the screen, so map the screen's uv back onto it
  const c = scr().canvas;
  const px = (scrDir === 'px' ? 1 - uv.y : scrDir === 'nx' ? uv.y : uv.x) * c.width;
  const py = (scrDir === 'px' ? 1 - uv.x : scrDir === 'nx' ? uv.x : 1 - uv.y) * c.height;
  const id = ++holdSeq; screenHold = id; setTimeout(() => { if (screenHold === id) { screenHold = null; mixScreenLong(px, py); } }, 600);   // #222
  if (videoPage || toolsPage) {   // #224 the TOOLS pages use the same tap list
    const b = VP_HIT.find(h => px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h);
    if (vpDel && !(b && b.del)) vpDel = null;   // any other tap closes the delete offer
    if (b) { b.act(px, py); if (b.drag) screenDrag = b; } drawMixScreen(); return true;   // #353 the tap point, for the CROP picture; #422 sliders keep dragging
  }   // #185
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
  // #319 (owner): the +/- readout is the platter's live speed, so a spindle twist or a rim nudge shows as it happens
  // (eased ~150 ms like a real speed display; within 0.015 % of the fader it reads the fader, so it doesn't flicker)
  let pl = d.pitch;
  if (d.motorOn && st.prate != null) { const live = Math.abs(st.prate) / d.speed - 1; if (Math.abs(live - d.pitch) < 0.25) pl = live; }
  d.pDisp = d.pDisp == null ? pl : d.pDisp + (pl - d.pDisp) * 0.35;
  const shown = Math.abs(d.pDisp - d.pitch) < 0.00015 ? d.pitch : d.pDisp;
  g.textAlign = 'right'; g.fillStyle = Math.abs(shown) < 0.0005 ? '#40ff70' : '#f2b640'; g.font = '600 24px system-ui';
  g.fillText(`${shown >= 0 ? '+' : ''}${(shown * 100).toFixed(2)}%`, x0 + w - 12, 128 + dy);
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
function drawTopBtn(g, x, y, w, h, label, on, dim, fs = 22) {
  g.fillStyle = on ? '#c8202c' : dim ? '#2a3140' : '#c9ced8'; g.fillRect(x, y, w, h);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = on ? '#fff' : dim ? '#56627a' : '#5a6272';
  btnLabel(g, label, x, y, w, h, fs); g.textBaseline = 'alphabetic';   // #349
}
function drawPhoneIcon(g, px, py, pw, ph, on) {   // small phone icon; its LED is green while the spectator phone is connected (#169)
  g.strokeStyle = '#8c96a8'; g.lineWidth = 2; g.beginPath(); g.roundRect(px, py, pw, ph, 3); g.stroke();
  g.fillStyle = '#8c96a8'; g.fillRect(px + 4, py + ph - 4, pw - 8, 2);
  g.fillStyle = on ? '#40ff70' : '#56627a'; g.beginPath(); g.arc(px + pw / 2, py + 7, 3, 0, Math.PI * 2); g.fill();
}
// ---- #224 TOOLS page on the mixer tablet (TOOLS button, bottom-left of the main HUD): DJ TOOLS (Record Maker) and
// VJ TOOLS (Scroller). Pages: home, dj, vj, maker, pickSong, pickVideo, pickImage, kbd, scroller.
let streamEndArm = 0;   // #331 END STREAM takes two taps
let pickItems = [], pickPg = 0;   // toolsPage is declared with videoPage (drawMixScreen reads it early)
const maker = { kind: 'blank', song: null, video: null, image: null, name: '', busy: false, msg: '', msgOk: true, size: 12, art: null, artLabelBmp: null };   // #393 art: { rel, front, label, back } blobs from FETCH ART   // #261 size: 12 or 7 (inches)
// #225 the Record Maker's answers show on the tablet (toast() is a desktop-only overlay, invisible in the headset)
let makerMsgT = 0;
function makerSay(text, ok, ms = 5000) {
  maker.msg = text; maker.msgOk = ok; toast(text, ms);
  clearTimeout(makerMsgT); makerMsgT = setTimeout(() => { maker.msg = ''; if (toolsPage === 'maker') drawMixScreen(); }, ms);
  drawMixScreen();
}
const kbd = { title: '', text: '', emoji: false, max: 40, done: null, back: 'home' };
// #363 BACK (owner): top-right of every tablet page, goes to the page the user was on before (any page: main,
// VISUALS tabs, TOOLS pages). drawMixScreen records each change of page; BACK restores the last one.
const navHist = []; let navKey = null, navRestoring = false;
const navState = () => ({ t: toolsPage, v: videoPage, f: vpFolder, l: lookPage, s: scrollFromVP });
function navTrack() {
  const k = JSON.stringify(navState());
  if (navKey && k !== navKey && !navRestoring) { navHist.push(JSON.parse(navKey)); if (navHist.length > 40) navHist.shift(); }
  navKey = k;
}
function navBack() {
  const st = navHist.pop(); if (!st) return;
  navRestoring = true;
  try {
    vpFolder = st.f; lookPage = st.l; scrollFromVP = st.s;
    if (st.t) { videoPage = st.v; setTools(st.t); }
    else { toolsPage = null; setVideoPage(st.v); }
  } finally { navRestoring = false; navKey = JSON.stringify(navState()); drawMixScreen(); }
}
const navCan = () => navHist.length > 0;
function setTools(p) {
  if (toolsPage === 'streamfit' && p !== 'streamfit' && streamer) streamer.setTesting(false);   // #333 TEST ends with the page
  clearInterval(setTools.fitIv); if (p === 'streamfit') setTools.fitIv = setInterval(() => { if (toolsPage === 'streamfit' && streamer && streamer.running) drawMixScreen(); }, 250);
  if (p === 'tv') setTools.fitIv = setInterval(() => { if (toolsPage === 'tv') drawMixScreen(); }, 1000);   // #376 status numbers
  if (p === 'studio') setTools.fitIv = setInterval(() => { if (toolsPage === 'studio') drawMixScreen(); }, 1000);   // #380 the S8's numbers
  if (p === 'dirro') setTools.fitIv = setInterval(() => { if (toolsPage === 'dirro') drawMixScreen(); }, 1000);   // #427 phones, latency
  if (p === 'pcam') setTools.fitIv = setInterval(() => { if (toolsPage === 'pcam') drawMixScreen(); }, 200);   // #347 delay / phone status; #374 about 5 pictures a second for the preview
  if (streamer) {   // #374 the PHONE CAM pages run the shot off air so the preview moves; leaving stops it again unless it is live / PREVIEW
    if (p === 'pcam' || p === 'pcamcrop') { if (streamer.source === 'pcam' && !streamer.active) { streamer.setRehearse(true); pcamAutoReh = true; } }
    else if (pcamAutoReh) { pcamAutoReh = false; if (!streamer.live && !monOn) streamer.setRehearse(false); }
  }
  if (p === 'pcamcrop') setTools.fitIv = setInterval(() => { if (toolsPage === 'pcamcrop') drawMixScreen(); }, 200);
  if (p === 'looper') setTools.fitIv = setInterval(() => { if (toolsPage === 'looper') drawMixScreen(); }, 100);   // #470 playhead, REC clock, armed blink
  if (p === 'perfcap') setTools.fitIv = setInterval(() => { if (toolsPage === 'perfcap') drawMixScreen(); }, 1000);   // #387 the clock and size
  if (p === 'studiokey') setTools.fitIv = setInterval(() => { if (toolsPage === 'studiokey') drawMixScreen(); }, 400);   // #385 the S8 KEY numbers and preview   // #353 the CROP picture, ~5 a second
  if (p !== 'kbd') { try { if (document.activeElement === sysKbInput) sysKbInput.blur(); } catch (e) {} }   // #387
  toolsPage = p; pickPg = 0;
  if (p === 'pickVideo' || p === 'pickImage') { pickItems = []; loadPick(p === 'pickVideo' ? 'Video' : 'Images'); }
  if (p === 'card') { pickItems = []; loadPick('Images'); }   // #445
  drawMixScreen();
}
async function loadPick(folder) { pickItems = (await media.list(folder)).map(i => ({ ...i, folder })); drawMixScreen(); }
function openKbd(title, text, emoji, max, done, back) { Object.assign(kbd, { title, text: text || '', emoji, max, done, back }); setTools('kbd'); }
// #387 the Meta system keyboard (with voice dictation) for the tablet KEYBOARD page: a real <input> focused from a user gesture,
// like the crate search. Its text is mirrored into kbd.text; Enter in it = ENTER on the page.
let sysKbPending = false;
const sysKbInput = document.createElement('input');
Object.assign(sysKbInput, { type: 'text', autocomplete: 'off', spellcheck: false, enterKeyHint: 'done' });
sysKbInput.id = 'tabletText';
sysKbInput.style.cssText = 'position:fixed;left:50%;top:52px;transform:translateX(-50%);width:min(460px,76vw);padding:8px 12px;font:500 15px system-ui,sans-serif;border-radius:8px;border:1px solid #4aa8f0;background:#141925;color:#e6e9ec;z-index:50;opacity:0;pointer-events:none';
document.body.appendChild(sysKbInput);
sysKbInput.addEventListener('focus', () => { sysKbInput.style.opacity = 1; sysKbInput.style.pointerEvents = 'auto'; });
sysKbInput.addEventListener('blur', () => { sysKbInput.style.opacity = 0; sysKbInput.style.pointerEvents = 'none'; sysKbPending = false; });
sysKbInput.addEventListener('input', () => { if (toolsPage !== 'kbd') return; kbd.text = [...sysKbInput.value].slice(0, kbd.max).join(''); drawMixScreen(); });
sysKbInput.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') { sysKbInput.blur(); if (toolsPage === 'kbd') kbdKey('ENTER'); }
  if (e.key === 'Escape') sysKbInput.blur();
});
function openSysKb() {
  sysKbInput.maxLength = kbd.max || 200; sysKbInput.value = kbd.text || '';
  try { sysKbInput.focus({ preventScroll: true }); sysKbInput.setSelectionRange(sysKbInput.value.length, sysKbInput.value.length); } catch (e) {}
  return document.activeElement === sysKbInput;
}
function sysKbTap() {   // the tablet button: try now (works with a trigger tap); a fingertip poke is not always a gesture, so keep it armed for the next trigger / pinch
  if (openSysKb()) { sysKbPending = false; return; }
  sysKbPending = true; toast('Pull the trigger or pinch anywhere to open the headset keyboard', 3500);
}
function kbdKey(k) {
  const n = [...kbd.text].length;
  if (k === 'ENTER') { const d = kbd.done, t = kbd.text; if (d) d(t); setTools(kbd.back); return; }
  if (k === 'DEL') kbd.text = [...kbd.text].slice(0, -1).join('');
  else if (k === 'SPACE') { if (n < kbd.max) kbd.text += ' '; }
  else if (n < kbd.max) kbd.text += k;
  drawMixScreen();
}
addEventListener('keydown', e => {   // desktop: type straight into the tablet keyboard
  if (toolsPage !== 'kbd' || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === 'Enter') kbdKey('ENTER'); else if (k === 'Backspace') kbdKey('DEL'); else if (k === ' ') kbdKey('SPACE');
  else if (k.length === 1 && FONT_OK(k.toUpperCase())) kbdKey(k.toUpperCase()); else return;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);
// a record seen from above: grooves (with track bands), the label picture or a plain red label, the spindle
function drawDisc(g, cx, cy, R, bmp, title, s7 = false) {
  g.save();
  g.fillStyle = '#0a0a0c'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  for (let r = R * 0.37; r < R * 0.97; r += 2) {
    const band = [0.52, 0.66, 0.8].some(b => Math.abs(r / R - b) < 0.012);
    g.strokeStyle = band ? '#2c2c33' : (Math.round(r) % 4 ? '#16161a' : '#1f1f24'); g.lineWidth = band ? 2 : 1;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = R * 0.18; g.beginPath(); g.arc(cx, cy, R * 0.68, -2.3, -1.6); g.stroke();   // sheen
  const lr = R * (s7 ? 0.51 : 0.34);   // #261 a 7" label is half the disc
  g.beginPath(); g.arc(cx, cy, lr, 0, Math.PI * 2); g.clip();
  if (bmp && bmp !== 'loading') { const s = Math.max(2 * lr / bmp.width, 2 * lr / bmp.height); g.drawImage(bmp, cx - bmp.width * s / 2, cy - bmp.height * s / 2, bmp.width * s, bmp.height * s); }
  else {
    g.fillStyle = '#c8202c'; g.fillRect(cx - lr, cy - lr, 2 * lr, 2 * lr);
    g.fillStyle = '#fff'; g.font = `700 ${Math.round(lr * 0.22)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitText2Center(g, title || 'BLANK', cx, cy - lr * 0.35, lr * 1.6); g.textBaseline = 'alphabetic';
  }
  g.restore();
  if (s7) { g.fillStyle = '#05070c'; g.beginPath(); g.arc(cx, cy, R * 0.219, 0, Math.PI * 2); g.fill(); }   // the 38 mm hole
  else { g.fillStyle = '#d8dce4'; g.beginPath(); g.arc(cx, cy, Math.max(2, R * 0.025), 0, Math.PI * 2); g.fill(); }
}
// #349 (owner) tablet button labels never overflow: shrink a little, then two lines (split at the space that balances
// them best), then smaller still; a label that still can't fit is cut with … . Text colour / alignment set by the caller.
const _lblOver = [];   // test hook: labels that had to be cut
function btnLabel(g, label, x, y, w, h, fs0 = 17, weight = 700) {
  if (label.endsWith('⁺¹')) {   // #441 a tiny +1 in the upper right: this button opens a page of sub menus that is not obvious
    label = label.slice(0, -2).trimEnd(); btnLabel(g, label, x, y, w - 6, h, fs0, weight);
    g.save(); g.font = '700 11px system-ui'; g.textAlign = 'right'; g.textBaseline = 'top'; g.fillText('+1', x + w - 3, y + 2); g.restore(); return;
  }
  const pad = 8, room = w - pad, f = n => { g.font = `${weight} ${n}px system-ui`; }, wid = t => g.measureText(t).width;
  const one = Math.max(12, Math.round(fs0 * 0.8));
  for (let n = fs0; n >= one; n--) { f(n); if (wid(label) <= room) { g.fillText(label, x + w / 2, y + h / 2 + 1); return; } }
  const words = label.split(' ');
  if (words.length > 1) {
    let best = null;
    for (let i = 1; i < words.length; i++) { const a = words.slice(0, i).join(' '), b = words.slice(i).join(' '); f(10); const m = Math.max(wid(a), wid(b)); if (!best || m < best.m) best = { a, b, m }; }
    for (let n = fs0; n >= 10; n--) {
      const lh = Math.round(n * 1.08); if (2 * lh > h - 2) continue;
      f(n); if (wid(best.a) <= room && wid(best.b) <= room) { g.fillText(best.a, x + w / 2, y + h / 2 - lh / 2 + 1); g.fillText(best.b, x + w / 2, y + h / 2 + lh / 2 + 1); return; }
    }
  }
  for (let n = one - 1; n >= 10; n--) { f(n); if (wid(label) <= room) { g.fillText(label, x + w / 2, y + h / 2 + 1); return; } }
  _lblOver.push(label); fitText2Center(g, label, x + w / 2, y + h / 2 + 1, room);
}
function fitText2Center(g, s, x, y, w) { let t = s; while (t.length > 3 && g.measureText(t).width > w) t = t.slice(0, -2); if (t !== s) t = t.slice(0, -1) + '…'; g.fillText(t, x, y); }
function makerSourceText() {
  if (maker.kind === 'song') return maker.song ? `Song: ${maker.song.title}${maker.song.artist ? '  ·  ' + maker.song.artist : ''}` : 'Song: pick one (SONG…)';
  if (maker.kind === 'clip') return maker.video ? `Clip: ${maker.video.replace(/\.[^.]+$/, '')} (its sound, and it plays on the record)` : 'Clip: pick one (CLIP…)';
  return 'Blank: generic grooves (quiet vinyl crackle)';
}
// ---- #393 FETCH ART (Record Maker): sleeve, label A and back cover from Discogs / MusicBrainz, see artfetch.js
const art = { q: '', dg: true, mb: true, busy: false, searched: false, results: [], errors: [], pg: 0, rel: null, imgs: [], slots: { front: null, label: null, back: null }, slot: 'front', ipg: 0, msg: '' };
const artRedraw = () => { if (toolsPage === 'art' || toolsPage === 'artpick' || toolsPage === 'maker') drawMixScreen(); };
function artSummary() {
  const A = maker.art, ok = k => (A[k] ? '✓' : '–');
  return `Art: sleeve ${ok('front')}  label ${ok('label')}  back ${ok('back')}  ·  ${A.rel.title}${A.rel.year ? ' (' + A.rel.year + ')' : ''}`;
}
function drawArtThumb(g, t, x, y, w, h, empty) {
  g.fillStyle = '#121824'; g.fillRect(x, y, w, h);
  if (t && t !== 'loading') { const s = Math.max(w / t.width, h / t.height), sw = w / s, sh = h / s; g.drawImage(t, (t.width - sw) / 2, (t.height - sh) / 2, sw, sh, x, y, w, h); return; }
  g.fillStyle = '#56627a'; g.font = '600 12px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(empty ? '' : t === 'loading' ? '…' : 'no art', x + w / 2, y + h / 2); g.textBaseline = 'alphabetic';
}
function openArtPage() {
  if (!art.q) { const s = maker.kind === 'song' && maker.song; art.q = s ? (s.artist ? s.artist + ' - ' : '') + s.title : maker.name || ''; }
  setTools('art');
  if (art.q && !art.results.length && !art.busy) runArtSearch();
}
async function runArtSearch() {
  const { artist, title } = splitQuery(art.q);
  if (!title) { art.errors = ['Type ARTIST - TITLE first (SEARCH…)']; drawMixScreen(); return; }
  if (!art.dg && !art.mb) { art.errors = ['Switch on DISCOGS or MUSICBRAINZ']; drawMixScreen(); return; }
  art.busy = true; art.results = []; art.errors = []; art.pg = 0; artRedraw();
  try { const r = await searchArt(title, artist, { discogs: art.dg && !!discogsToken(), mb: art.mb }); art.results = r.results; art.errors = r.errors; if (art.dg && !discogsToken()) art.errors.push('Discogs skipped: no token (TOKEN…)'); }
  catch (e) { art.errors = [e.message]; }
  art.busy = false; art.searched = true; artRedraw();
}
async function openArtRelease(rel) {
  art.rel = rel; art.imgs = []; art.slots = { front: null, label: null, back: null }; art.slot = 'front'; art.ipg = 0; art.msg = ''; art.busy = true;
  setTools('artpick');
  try { art.imgs = await releaseImages(rel); art.slots = guessSlots(art.imgs); art.slot = !art.slots.front ? 'front' : !art.slots.label ? 'label' : !art.slots.back ? 'back' : 'front'; }
  catch (e) { art.msg = e.message; }
  art.busy = false; artRedraw();
}
async function useArt() {
  const S = art.slots; if (!S.front && !S.label && !S.back) { art.msg = 'Pick at least one picture (SLEEVE, LABEL A or BACK)'; drawMixScreen(); return; }
  art.busy = true; art.msg = ''; drawMixScreen();
  try {
    const get = async im => (im ? imageBlob(im.url, im.src).catch(() => imageBlob(im.thumb, im.src)) : null);   // the big picture, else the small one
    const [front, label, back] = await Promise.all([get(S.front), get(S.label), get(S.back)]);
    maker.art = { rel: { src: art.rel.src, id: art.rel.id, title: art.rel.title, artist: art.rel.artist, year: art.rel.year }, front, label, back };
    maker.artLabelBmp = label ? await createImageBitmap(label) : front && !maker.image ? await createImageBitmap(front) : null;   // the preview (a sleeve only: the label shows the sleeve, as with MP3s)
    if (!maker.name) maker.name = cleanText(art.rel.title || '', 32);
    art.busy = false; setTools('maker');
    makerSay(`Art ready: ${artSummary().replace(/^Art: /, '')}. STAMP RECORD when you are set.`, true, 5000);
  } catch (e) { art.busy = false; art.msg = 'Pictures not fetched: ' + e.message; drawMixScreen(); }
}
async function pressRecord() {
  if (maker.busy) return;
  if (maker.kind === 'song' && !maker.song) { makerSay('Pick a song first (SONG…)', false, 3000); return; }
  if (maker.kind === 'clip' && !maker.video) { makerSay('Pick a clip first (CLIP…)', false, 3000); return; }
  if (maker.size === 7 && maker.kind === 'song' && maker.song.duration > 6.5 * 60) { makerSay(`Too long for a 7" side (${fmt(maker.song.duration)}; up to about 6:30 at 45 rpm)`, false, 5000); return; }   // #261
  const title = maker.name.trim() || `DUBPLATE ${new Date().toISOString().slice(5, 16).replace('T', ' ')}`;
  maker.busy = true; drawMixScreen();
  try {
    let label = null; const extra = {}, A = maker.art;
    if (A && A.label) label = await labelFrom(A.label);   // #393 the fetched label wins over a PICTURE…
    else if (maker.image) { const f = await media.getFile('Images', maker.image); if (f) label = await labelFrom(f); }
    if (A && A.front) extra.cover = await labelFrom(A.front, 1024);
    if (A && A.back) extra.back = await labelFrom(A.back, 1024);
    const s = maker.song, src = maker.kind === 'blank' ? { kind: 'blank' } : maker.kind === 'clip' ? { kind: 'video', video: maker.video }
      : { kind: 'song', opfs: s.opfs || null, url: s.url || null, bpm: s.bpm || 0, artist: s.artist || '', from: s.title };
    const p = await savePressing({ id: 'p' + Date.now().toString(36), title, src, made: Date.now(), size: maker.size === 7 ? 7 : 12 }, label, extra);
    if (!lib) lib = emptyLibrary();
    const r = addPressings(lib, [p]); plAttach();   // #392 keep the playlists at the end
    const where = p.size === 7 ? '45s' : 'Unsorted', pi = lib.playlists.findIndex(pl => pl.name === where);   // #261
    search.q = ''; search.results = null; searchInput.value = '';
    crateState.pl = pi; crateState.sel = Math.max(0, lib.playlists[pi].records.indexOf(r));
    drawCrateScreen(); layoutSleeves();
    maker.busy = false; maker.name = ''; maker.art = null; maker.artLabelBmp = null;   // #393
    makerSay(`✓ STAMPED "${title}"${p.size === 7 ? ' (7")' : ''}: in the crate, ${where}`, true, 6000);
  } catch (e) { maker.busy = false; makerSay('Not stamped: ' + e.message, false, 6000); }
  maker.busy = false; drawMixScreen();
}
// #231 built-in example records (web/examples/, streamed like songs from the PC), in Unsorted and the Collection.
// "Sleeve Art Demo": every ID3 picture type the app reads (tools/make_sleeve_demo.py builds it). Long press +
// DELETE hides one for good on this device (vire.hiddenExamples).
const EXAMPLES = [{ id: 'sleeve', title: 'Sleeve Art Demo', artist: 'Cly3DJ', bpm: 120, key: 'Am', a: 'examples/Sleeve Art Demo_a.mp3', b: 'examples/Sleeve Art Demo_b.mp3' },
  // #232 the same pictures in one file: front cover, back cover, and an 'Other' picture described 'Label B'
  { id: 'sleeve1', title: 'Sleeve Art Demo (One File)', artist: 'Cly3DJ', bpm: 120, key: 'Am', a: 'examples/Sleeve Art Demo (One File).mp3', b: null },
  // #257 a test 7" single (45s list) until 45s can be pressed
  { id: 'single45', title: 'Test 45 (Sleeve Art Demo)', artist: 'Cly3DJ', bpm: 120, key: 'Am', a: 'examples/Sleeve Art Demo_a.mp3', b: 'examples/Sleeve Art Demo_b.mp3', size: 7 }];
function hiddenExamples() { try { return JSON.parse(localStorage.getItem('vire.hiddenExamples') || '[]'); } catch { return []; } }
function addExamples(L) {
  const hide = hiddenExamples();
  let un = L.playlists.find(p => p.name === 'Unsorted');
  for (const ex of EXAMPLES) {
    if (hide.includes(ex.id) || L.tracks.has('ex_' + ex.id + '_A')) continue;
    let dest = un;
    if (ex.size === 7) { dest = L.playlists.find(p => p.name === '45s'); if (!dest) { dest = { name: '45s', path: '45s (7" singles on this headset)', records: [] }; L.playlists.push(dest); } }
    else if (!un) { un = dest = { name: 'Unsorted', path: 'Unsorted (on this headset)', records: [] }; L.playlists.splice(Math.min(1, L.playlists.length), 0, un); }
    const r = { id: 'rex_' + ex.id, size: ex.size || 12, title: ex.title, artist: ex.artist, sides: { A: null, B: null }, bpm: ex.bpm, key: ex.key, genre: 'Example', duration: 0, missing: false, paired: !!ex.b, unsorted: true, example: ex.id };
    for (const side of ex.b ? ['A', 'B'] : ['A']) {
      const id = 'ex_' + ex.id + '_' + side, url = encodeURI(side === 'A' ? ex.a : ex.b);
      const t = { id, name: ex.title + '_' + side.toLowerCase(), title: ex.title, side, split: false, artist: ex.artist, album: ex.title, genre: 'Example', key: ex.key, bpm: ex.bpm, duration: 0,
        location: url, url, opfs: null, missing: false, cues: [], unsorted: true, record: r };
      r.sides[side] = t; L.tracks.set(id, t);
    }
    L.records.push(r); dest.records.push(r); L.playlists[0].records.push(r);
  }
  const byT = (a, b) => (a.missing - b.missing) || a.title.localeCompare(b.title);
  if (un) un.records.sort(byT); L.playlists[0].records.sort(byT);
}
// pressed records join the 'Unsorted (on this headset)' list (made if there is none) and the Collection
function addPressings(L, list) {
  let un = L.playlists.find(p => p.name === 'Unsorted');
  if (!un) { un = { name: 'Unsorted', path: 'Unsorted (on this headset)', records: [] }; L.playlists.splice(Math.min(1, L.playlists.length), 0, un); }
  let last = null;
  for (const p of list) {
    const id = 'pr_' + p.id, s = p.src || {};
    if (L.tracks.has(id)) continue;
    const t = { id, name: p.title, title: p.title, side: null, split: false, artist: s.kind === 'song' ? (s.artist || 'Pressed') : 'Pressed on Cly3DJ', album: '', genre: '', key: '', bpm: s.bpm || 0, duration: 0,
      location: 'press:' + p.id, url: s.url || null, opfs: s.opfs || null, missing: false, cues: [], unsorted: true, press: p };
    if (s.kind === 'video') t.pressVideo = s.video;
    const r = { id: 'r' + id, title: p.title, artist: t.artist, sides: { A: t, B: null }, bpm: t.bpm, key: '', genre: '', duration: 0, missing: false, paired: false, unsorted: true, pressed: true, size: p.size === 7 ? 7 : 12 };
    let dest = un;   // #261 pressed 45s go to the 45s list
    if (r.size === 7) { dest = L.playlists.find(q => q.name === '45s'); if (!dest) { dest = { name: '45s', path: '45s (7" singles on this headset)', records: [] }; L.playlists.push(dest); } }
    t.record = r; L.tracks.set(id, t); L.records.push(r); dest.records.push(r); L.playlists[0].records.push(r); last = r;
  }
  const byT = (a, b) => (a.missing - b.missing) || a.title.localeCompare(b.title);
  un.records.sort(byT); L.playlists[0].records.sort(byT);
  const p45 = L.playlists.find(q => q.name === '45s'); if (p45) p45.records.sort(byT);
  return last;
}
async function pressArt(track) {
  if (artCache.has(track.id)) return artCache.get(track.id);
  let art = null;
  try { const f = await readLabel(track.press); if (f) { art = await createImageBitmap(f); artBlobs.set(track.id, f); } } catch {}
  try {   // #393 a fetched sleeve: the front is the cover, the label picture stays the label; the back cover goes on the sleeve's back
    const cv = await readPic(track.press, 'cover');
    if (cv) { if (art) labelArt.set(track.id, art); art = await createImageBitmap(cv); artBlobs.set(track.id, cv); }
    const bk = await readPic(track.press, 'back'); if (bk) backBlobs.set(track.id, bk);
  } catch {}
  artCache.set(track.id, art); return art;
}
async function pressBytes(track) {
  const s = track.press.src || {};
  if (s.kind === 'blank') return blankWav();
  if (s.kind === 'video') { const f = await media.getFile('Video', s.video); if (!f) throw new Error(`the clip ${s.video} is no longer on this headset`); return f.arrayBuffer(); }
  if (track.opfs) return (await store.readFile(track.opfs)).arrayBuffer();
  const r = await fetch(track.url); if (!r.ok) throw new Error(`HTTP ${r.status} for the pressed song`); return r.arrayBuffer();
}
// #423 TURNTABLE FEEL (DJ TOOLS > TURNTABLE FEEL, sliders). 100 % = the physics as built (#120 / #272 / #322).
const FEEL_DEF = {
  fric: { label: 'PLATTER FRICTION', lo: 25, hi: 300, v: 100, unit: '%' },   // slipmat friction against the platter (stick / slip)
  scr: { label: 'SCRATCH & DRAG', lo: 25, hi: 150, v: 100, unit: '%' },      // record turn per hand turn (100 % = 1:1, a real record)
  smooth: { label: 'HAND SMOOTHING', lo: 0, hi: 100, v: 85, unit: '%' },     // tracking-noise filter on the hand on the record
  even: { label: 'RADIUS EVEN-OUT', lo: 0, hi: 100, v: 100, unit: '%' },     // #424 any touch radius moves the record like the outer music area
  spin: { label: 'SPINDLE TWIST', lo: 25, hi: 300, v: 100, unit: '%' },      // pinch on the spindle: torque passed to the platter
  nudge: { label: 'NUDGE AMOUNT', lo: 25, hi: 300, v: 100, unit: '%' },      // finger on the platter rim: drag / push strength
  grv: { label: 'RECORD GROOVES', lo: 0, hi: 300, v: 100, unit: '%' },       // #455 ring contrast + sheen on the vinyl (looks only, no physics)
};
const FEEL = Object.fromEntries(Object.entries(FEEL_DEF).map(([k, r]) => [k, r.v]));
try { Object.assign(FEEL, JSON.parse(localStorage.getItem('vire.feel') || '{}')); } catch (e) {}
setGrooveK((FEEL.grv != null ? FEEL.grv : 100) / 100);   // #455
function setFeel(k, v) { FEEL[k] = v; try { localStorage.setItem('vire.feel', JSON.stringify(FEEL)); } catch (e) {} if (k === 'grv') setGrooveK(v / 100); if (k !== 'scr' && k !== 'smooth' && k !== 'even' && k !== 'grv') sendPhysics(); }
// #422 PINCH FIT sliders: key -> range, default (must match xr.js PF)
const PINCH_FIT_DEF = {
  bx: { label: 'BALL IN/OUT', lo: -25, hi: 25, v: 0, unit: 'mm' }, by: { label: 'BALL UP/DN', lo: -25, hi: 25, v: 0, unit: 'mm' },
  bz: { label: 'BALL BK/FWD', lo: -30, hi: 30, v: 0, unit: 'mm' }, kt: { label: 'KNOB TWIST', lo: 30, hi: 300, v: 250, unit: '°' },
  lh: { label: 'HAND LIFT', lo: -20, hi: 60, v: 10, unit: 'mm' }, lg: { label: 'GLOVE LIFT', lo: -20, hi: 60, v: 15, unit: 'mm' },
  pa: { label: 'PINCH TILT', lo: -60, hi: 60, v: 0, unit: '°' }, pt: { label: 'PINCH TURN', lo: -90, hi: 90, v: 0, unit: '°' },
};
const TOOLS_NAME = { card: 'CARD', retro: 'RETRO-SCENE', vdancer: 'VECTOR-DANCER', wall: 'LED WALL', dirro: 'DIRROGRAM', holosms: 'HOLOSMS', handfit: 'HAND FIT', home: 'TOOLS', dj: 'DJ TOOLS', looper: 'LOOPER', vj: 'VJ TOOLS', stream: 'STREAM', maker: 'MAKER', art: 'FETCH ART', pcam: 'PHONE CAM', portals: 'PORTALS', tv: 'DIRROTV', studio: 'S8 STUDIO', studiokey: 'S8 KEY', perfcap: 'PERFCAP', laser: 'LASER' };   // #363 up-button names; #376
// #470 LOOPER page (DJ TOOLS > LOOPER, or LOOP on the mixer page) and LOOP BANKS page
const LOOP_COL = { empty: ['#2a3140', '#8c96a8'], rec: ['#c8202c', '#fff'], play: ['#1f9a4a', '#fff'], stop: ['#d08a10', '#111'] };
function loopStateLabel() {
  const st = looper.state, now = performance.now() / 1000;
  return st === 'rec' ? `■ LOOP IT ${(now - looper.t0).toFixed(1)}s` : st === 'play' ? '■ STOP' : st === 'stop' ? '▶ PLAY' : '● REC';
}
function loopFill(blink = true) {   // the state colour; STOP / ARMED blinks like the mixer ring
  const st = looper.state, c = LOOP_COL[st] || LOOP_COL.empty;
  if (st === 'stop' && blink && Math.floor(performance.now() / 400) % 2) return ['#5a4010', '#ffd27a'];
  return c;
}
function drawLoopMainBtn(g, x, y, w, h, fs = 15) {   // the mixer page's LOOP button: state colour, opens the LOOPER page
  const [bg, fg] = loopFill(); g.fillStyle = bg; g.fillRect(x, y, w, h);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = fg; btnLabel(g, 'LOOP ⁺¹', x, y, w, h, fs); g.textBaseline = 'alphabetic';
}
function fmtLoopT(samp, sr) { return (samp / sr).toFixed(3); }
function drawWave(g, L, x, y, w, h, s0, s1, opts = {}) {
  g.fillStyle = '#0a101b'; g.fillRect(x, y, w, h);
  const mid = y + h / 2, span = s1 - s0, X = s => x + (s - s0) / span * w;
  g.strokeStyle = '#1e2a3d'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, mid + 0.5); g.lineTo(x + w, mid + 0.5); g.stroke();
  if (!L) return X;
  const bins = Math.max(8, Math.floor(w)), pk = opts.cache && opts.cache.bins === bins && opts.cache.L === L ? opts.cache.pk : loopDb.peaks(L, bins, s0, s1);
  if (opts.cache && !(opts.cache.bins === bins && opts.cache.L === L)) Object.assign(opts.cache, { bins, L, pk });
  let mx = 0.05; for (let i = 0; i < pk.length; i++) mx = Math.max(mx, Math.abs(pk[i]));
  const k = (h / 2 - 3) / mx, xa = X(L.a), xb = X(L.b);
  for (let i = 0; i < bins; i++) {
    const px = x + i * w / bins, inside = px >= xa && px <= xb;
    g.fillStyle = inside ? '#39a8ff' : '#2a4058';
    const lo = pk[2 * i] * k, hi = pk[2 * i + 1] * k; g.fillRect(px, mid - hi, Math.max(1, w / bins), Math.max(1, hi - lo));
  }
  g.fillStyle = 'rgba(0,0,0,0.45)'; if (xa > x) g.fillRect(x, y, Math.min(w, xa - x), h); if (xb < x + w) g.fillRect(Math.max(x, xb), y, x + w - Math.max(x, xb), h);
  const bar = (bx, col, lbl, sel) => {
    if (bx < x - 1 || bx > x + w + 1) return;
    g.fillStyle = col; g.fillRect(bx - (sel ? 2 : 1), y, sel ? 4 : 2, h);
    g.beginPath(); g.moveTo(bx - 7, y); g.lineTo(bx + 7, y); g.lineTo(bx, y + 9); g.fill();
    g.font = '700 11px system-ui'; g.textAlign = lbl === 'IN' ? 'left' : 'right'; g.textBaseline = 'bottom'; g.fillText(lbl, bx + (lbl === 'IN' ? 5 : -5), y + h - 2); g.textBaseline = 'alphabetic';
  };
  bar(xa, '#40ff70', 'IN', loopUI.sel === 'in'); bar(xb, '#ff4050', 'OUT', loopUI.sel === 'out');
  if (looper.state === 'play' && looper.data === L) { const xp = X(looper.r); if (xp >= x && xp <= x + w) { g.fillStyle = '#fff'; g.fillRect(xp, y, 1.5, h); } }
  return X;
}
// #471 LOOP MASTER: the LOOPER page in the spirit of the Amiga sample editors (owner's AudioMaster reference; our own name
// and logo): cream screen title bar with a sunken readout, black stereo waveform panel (L / R lanes, cyan trace, the
// IN..OUT range shaded), an Amiga scroll bar, dark bevelled gadgets in the bitmap font, an embossed logo band.
const AM = { scr: '#2c2e35', face: '#3d4049', hi: '#9aa0ad', lo: '#0e0f13', txt: '#dfe8f2', dimT: '#6a707c', cyan: '#2ee8e8', cyanD: '#177a7a',
  cream: '#efe6c8', creamD: '#b9b094', ink: '#121212', rng: '#14325c', sel: '#21507e', red: '#ff4a3a', grn: '#4dff7a', amb: '#ffb21e' };
function lmCut(s, w, px) { s = cleanText(s); while (s.length > 1 && bitWidth(s, px) > w) s = s.slice(0, -1); return s; }
function lmFit(s, w, max = 2) { const u = bitWidth(s, 1); return Math.max(1, Math.min(max, Math.floor(((w - 8) / Math.max(1, u)) * 4) / 4)); }
function lanePeaks(L, ch, s0, s1, bins) {
  const out = new Float32Array(bins * 2), span = Math.max(1, s1 - s0);
  for (let i = 0; i < bins; i++) {
    const a = Math.floor(s0 + i * span / bins), b = Math.max(a + 1, Math.floor(s0 + (i + 1) * span / bins)), step = Math.max(1, Math.floor((b - a) / 200));
    let lo = 0, hi = 0;
    for (const c of L.bufs) { if (!c) continue; const x = c[ch]; for (let j = Math.max(0, a); j < Math.min(L.len, b); j += step) { const v = x[j]; if (v < lo) lo = v; if (v > hi) hi = v; } }
    out[2 * i] = lo; out[2 * i + 1] = hi;
  }
  return out;
}
function drawLooperPage(page, T) {
  const { g, W, H, P, L, R } = T;
  const txt = (s, x, y, px, col) => drawBitText(g, cleanText(s), Math.round(x), Math.round(y), px, col, px >= 1.5);
  const bev = (x, y, w, h, up, hi = AM.hi, lo = AM.lo) => {
    g.fillStyle = up ? hi : lo; g.fillRect(x, y, w, 2); g.fillRect(x, y, 2, h);
    g.fillStyle = up ? lo : hi; g.fillRect(x, y + h - 2, w, 2); g.fillRect(x + w - 2, y, 2, h);
  };
  const gad = (x, y, w, h, label, sel, act, dim, col, max = 2) => {   // dark Amiga gadget; sel = pressed in, blue
    g.fillStyle = sel ? AM.sel : AM.face; g.fillRect(x, y, w, h); bev(x, y, w, h, !sel);
    const s = cleanText(label), px = lmFit(s, w, max), tw = bitWidth(s, px);
    txt(s, x + (w - tw) / 2, y + (h - 7 * px) / 2 + (sel ? 1 : 0), px, dim ? AM.dimT : col || AM.txt);
    const hit = { x, y, w, h, act }; if (act && !dim) VP_HIT.push(hit); return hit;
  };
  const creamGad = (x, y, w, h, label, act, dim) => {
    g.fillStyle = AM.cream; g.fillRect(x, y, w, h); bev(x, y, w, h, true, '#ffffff', AM.creamD);
    const s = cleanText(label), px = lmFit(s, w, 1.5), tw = bitWidth(s, px); txt(s, x + (w - tw) / 2, y + (h - 7 * px) / 2, px, dim ? AM.creamD : AM.ink);
    if (act && !dim) VP_HIT.push({ x, y, w, h, act });
  };
  const panel = (x, y, w, h) => { g.fillStyle = AM.scr; g.fillRect(x, y, w, h); bev(x, y, w, h, false); };
  const logo = (x, y, w, h) => {   // our own embossed logo band: fine stripes, 'Dirro' small, 'LoopMaster' big, a credit line
    g.fillStyle = '#34373f'; g.fillRect(x, y, w, h); g.fillStyle = '#2d3037'; for (let yy = y; yy < y + h; yy += 3) g.fillRect(x, yy, w, 1);
    bev(x, y, w, h, false);
    const big = Math.round(Math.min(40, h * 0.6, w / 7)), cx = x + w / 2, by = y + h * 0.57;
    g.save(); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const word = (s, fx, fy, sz) => { g.font = `italic 700 ${sz}px "Times New Roman", Georgia, serif`;
      g.fillStyle = '#16171c'; g.fillText(s, fx + 1.5, fy + 1.5); g.fillStyle = '#a3a9b6'; g.fillText(s, fx - 1, fy - 1); g.fillStyle = '#5f6470'; g.fillText(s, fx, fy); };
    g.font = `italic 700 ${big}px "Times New Roman", Georgia, serif`; const bw = g.measureText('LoopMaster').width;
    const sm = Math.round(big * 0.45); word('LoopMaster', cx + sm * 1.1, by, big);
    word('Dirro', cx - bw / 2 - sm * 0.2, by - big * 0.45, sm);
    g.restore();
    const cr = 'DIRRODJ VINYL LOOPER  2026 DIRROGATE', cpx = P ? 1 : 1.25; txt(cr, x + (w - bitWidth(cr, cpx)) / 2, y + h - 7 * cpx - (P ? 6 : 3), cpx, '#7d838f');
  };
  g.fillStyle = AM.scr; g.fillRect(0, 0, W, H);
  // ---------- screen title bar: name, readout box, gadgets (DJ TOOLS / PREVIEW / BACK)
  const tbY = P ? 24 : 0, tbH = P ? 32 : 30;
  g.fillStyle = AM.cream; g.fillRect(0, tbY, W, tbH); g.fillStyle = AM.ink; g.fillRect(0, tbY + tbH - 2, W, 2);
  const title = page === 'loopbanks' ? (P ? 'BANKS' : 'LOOP MASTER - BANKS') : 'LOOP MASTER';
  { const tp = P ? Math.min(1.5, lmFit(title, 120, 1.5)) : 2; txt(title, L + 4, tbY + (tbH - 7 * tp) / 2, tp, AM.ink); }
  { const gh = tbH - 8, gy = tbY + 3; let gx = R;
    const nav = [['BACK', navCan() ? navBack : null, !navCan(), P ? 58 : 70], ['PREVIEW', () => setMonitor(!monOn), false, P ? 70 : 84]];
    if (!P) nav.push([page === 'loopbanks' ? 'LOOPER' : 'DJ TOOLS', () => setTools(page === 'loopbanks' ? 'looper' : 'dj'), false, 92]);
    for (const [lab, act, dim, w] of nav) { gx -= w; creamGad(gx, gy, w, gh, lab === 'PREVIEW' && monOn ? 'PREVIEW *' : lab, act, dim); gx -= 4; }
    T.navX = gx;
  }
  const Ld = looper.data, sr = Ld ? Ld.sr : (engine.ctx ? engine.ctx.sampleRate : 48000);
  const readout = () => {
    if (looper.state === 'rec') return [`RECORDING ${(performance.now() / 1000 - looper.t0).toFixed(1)} S`, ''];
    if (!Ld) return ['LOOP = EMPTY', ''];
    const len = (Ld.b - Ld.a) / Ld.sr;
    return [`LOOP = ${len.toFixed(3)} S`, `IN ${fmtLoopT(Ld.a, sr)}  OUT ${fmtLoopT(Ld.b, sr)}${Ld.bpm ? `  ${(len * Ld.bpm / 60).toFixed(2)} BEATS` : ''}`];
  };
  const dispBox = (x, y, w, h) => {   // the sunken display, like 'Display = ...'
    g.fillStyle = AM.cream; g.fillRect(x, y, w, h); g.strokeStyle = AM.ink; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    const [a, b] = readout(), msg = performance.now() < loopUI.msgT ? loopUI.msg : '';
    if (h > 30) { txt(a, x + 8, y + 6, 1.5, AM.ink); const p2 = lmFit(cleanText(msg || b), w - 16, 1.25), l2 = lmCut(msg || b, w - 16, p2); txt(l2, x + 8, y + h - 7 * p2 - 6, p2, msg ? '#8a2a10' : AM.ink); }
    else { const s0 = msg || (b ? `${a}  ${b}` : a), sp = lmFit(cleanText(s0), w - 16, 1.5), s = lmCut(s0, w - 16, sp); txt(s, x + 8, y + (h - 7 * sp) / 2, sp, msg ? '#8a2a10' : AM.ink); }
  };
  if (page === 'loopbanks') {
    const B = loopUI.banks, y0 = tbY + tbH + 8, rh = P ? 46 : 34;
    if (!B || !B.length) { txt(!B ? 'READING THE BANKS...' : 'NO BANKS YET. FILL THE SLOTS, THEN SAVE BANK.', L + 4, y0 + 10, 1.5, AM.txt); if (loopUndo.length) gad(R - 96, H - (P ? 62 : 32), 96, 26, `UNDO ${loopUndo.length}`, false, loopUndoDo, false, AM.amb); return; }
    const per = Math.floor((H - y0 - (P ? 70 : 40)) / (rh + 4)), pages = Math.ceil(B.length / per), pg = clamp(loopUI.bankPg || 0, 0, pages - 1);
    B.slice(pg * per, pg * per + per).forEach((b, i) => {
      const y = y0 + i * (rh + 4), del = loopUI.bankDel === b.name, dw = del ? 110 : 0;
      const hit = gad(L, y, R - L - dw - (dw ? 4 : 0), rh, '', false, () => { loopUI.bankDel = ''; loopLoadBank(b.name); });
      hit.long = () => { loopUI.bankDel = b.name; drawMixScreen(); };
      txt(b.name, L + 10, y + (P ? 8 : (rh - 14) / 2), 2, AM.cyan);
      const info = `${b.used || 0}/4 SLOTS  ${b.t ? new Date(b.t).toLocaleString('en', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).toUpperCase() : ''}`;
      if (P) txt(info, L + 10, y + rh - 14, 1.25, AM.txt); else txt(info, R - dw - 12 - bitWidth(cleanText(info), 1.25), y + (rh - 9) / 2, 1.25, AM.txt);
      if (del) gad(R - dw, y, dw, rh, 'DELETE', true, async () => { loopUI.bankDel = ''; await loopDeleteBank(b.name); drawMixScreen(); }, false, AM.red);
    });
    const by = H - (P ? 62 : 32);
    if (pages > 1) { gad(L, by, 60, 26, '<', false, () => { loopUI.bankPg = Math.max(0, pg - 1); }, pg === 0); gad(L + 64, by, 60, 26, '>', false, () => { loopUI.bankPg = pg + 1; }, pg >= pages - 1); }
    gad(R - 96, by, 96, 26, loopUndo.length ? `UNDO ${loopUndo.length}` : 'UNDO', false, loopUndoDo, !loopUndo.length, AM.amb);   // #473
    { const hs = 'TAP = LOAD INTO THE 4 SLOTS. HOLD = DELETE.', x0 = L + (pages > 1 ? 136 : 4), hp = lmFit(hs, R - 104 - x0, 1.25); txt(hs, x0, by + (26 - 7 * hp) / 2, hp, AM.dimT); }
    return;
  }
  ensureLoopSlots();
  if (!engine.ctx) { txt('START THE DECKS FIRST.', L + 4, tbY + tbH + 20, 2, AM.txt); return; }
  // ---------- layout
  const gap = 4;
  let dX, dY, dW, dH, wx, wy, ww, wh, sy;
  if (P) { dX = L; dY = tbY + tbH + 6; dW = R - L; dH = 40; wx = L; wy = dY + dH + 6; ww = R - L; wh = 236; }
  else { dX = T.navX - 300; dY = tbY + 4; dW = 296; dH = tbH - 8; wx = 8; wy = tbY + tbH + 4; ww = W - 16; wh = 92; }
  if (!P) { const tw = bitWidth('LOOP MASTER', 2) + 16; dX = Math.max(L + tw, dX); dW = T.navX - 4 - dX; }
  dispBox(dX, dY, dW, dH);
  sy = wy + wh + 2;
  // ---------- view window (samples)
  if (Ld && loopUI.vFor !== Ld) { loopUI.vFor = Ld; loopUI.v0 = 0; loopUI.v1 = Ld.len; }
  const len = Ld ? Ld.len : 1, minSpan = Math.round(0.02 * sr);
  const setView = (a, b) => { let s = clamp(b - a, minSpan, len); a = clamp(a, 0, len - s); loopUI.v0 = a; loopUI.v1 = a + s; drawMixScreen(); };
  const v0 = Ld ? loopUI.v0 : 0, v1 = Ld ? loopUI.v1 : 1, X = s => wx + (s - v0) / (v1 - v0) * ww, S = px => v0 + (px - wx) / ww * (v1 - v0);
  // ---------- waveform panel: two lanes
  g.fillStyle = '#000'; g.fillRect(wx, wy, ww, wh); g.strokeStyle = '#6a707c'; g.lineWidth = 2; g.strokeRect(wx + 1, wy + 1, ww - 2, wh - 2);
  const laneH = (wh - 6) / 2;
  if (looper.state === 'rec') {
    const t = performance.now() / 1000 - looper.t0;
    txt(`REC ${t.toFixed(1)} S OF 30`, wx + 12, wy + 12, 2, AM.red);
    g.fillStyle = AM.red; g.fillRect(wx + 12, wy + wh / 2 - 3, (ww - 24) * Math.min(1, t / 30), 6);
  } else if (!Ld) {
    for (let k = 0; k < 2; k++) { const my = Math.round(wy + 3 + laneH * k + laneH / 2); g.fillStyle = AM.cyanD; g.fillRect(wx + 3, my, ww - 6, 1); }
    const s = 'NO LOOP. REC SAMPLES THE CUE CHANNEL, OR TAP A SLOT.'; txt(s, wx + (ww - bitWidth(s, 1.5)) / 2, wy + 10, 1.5, AM.txt);
  } else {
    const xa = X(Ld.a), xb = X(Ld.b), cols = Math.max(16, Math.floor((ww - 6) / (P ? 1 : 1.5)));
    g.fillStyle = AM.rng; g.fillRect(Math.max(wx + 3, xa), wy + 3, Math.max(0, Math.min(wx + ww - 3, xb) - Math.max(wx + 3, xa)), wh - 6);
    for (let k = 0; k < 2; k++) {
      const top = wy + 3 + laneH * k, my = top + laneH / 2, pk = lanePeaks(Ld, k, v0, v1, cols), kk = (laneH / 2 - 3);
      if (k) { g.fillStyle = '#4a4f5a'; g.fillRect(wx + 3, top - 1, ww - 6, 2); }
      for (let i = 0; i < cols; i++) {
        const px = wx + 3 + i * (ww - 6) / cols, sm = S(px), inside = sm >= Ld.a && sm <= Ld.b;
        g.fillStyle = inside ? AM.cyan : AM.cyanD;
        const lo = Math.max(-1, pk[2 * i]) * kk, hi = Math.min(1, pk[2 * i + 1]) * kk;
        g.fillRect(px, my - hi, Math.max(1, (ww - 6) / cols), Math.max(1, hi - lo));
      }
      g.fillStyle = AM.cyan; g.fillRect(wx + 3, Math.round(my), ww - 6, 1);
      txt(k ? 'R' : 'L', wx + 8, top + 4, 1.25, '#6a707c');
    }
    const mark = (x, lab, sel) => {
      if (x < wx + 2 || x > wx + ww - 2) return;
      const c = sel ? '#ffe14a' : '#ffffff'; g.fillStyle = c; g.fillRect(Math.round(x) - (sel ? 1 : 0), wy + 3, sel ? 3 : 1, wh - 6);
      const tw = bitWidth(lab, 1.25) + 6, tx = lab === 'IN' ? x + 2 : x - tw - 1; g.fillRect(tx, wy + 4, tw, 12); txt(lab, tx + 3, wy + 6, 1.25, '#000');
    };
    mark(xa, 'IN', loopUI.sel === 'in'); mark(xb, 'OUT', loopUI.sel === 'out');
    if (looper.state === 'play' && looper.data === Ld) { const xp = X(looper.r); if (xp > wx && xp < wx + ww) { g.fillStyle = AM.red; g.fillRect(xp, wy + 3, 2, wh - 6); } }
    const sc = `VIEW = ${((v1 - v0) / sr).toFixed(3)} S${Ld.src ? '  FROM ' + Ld.src : ''}${looper.slot ? '  SLOT ' + looper.slot : ''}`;
    { const scp = lmFit(cleanText(sc), ww - 20, 1.25); txt(sc, wx + ww - 8 - bitWidth(cleanText(sc), scp), wy + wh - 7 * scp - 6, scp, '#6a707c'); }
    const hit = { x: wx, y: wy, w: ww, h: wh, drag: true, act: px => {   // drag: the nearer marker (picked where the finger lands)
      const s = clamp(S(px), 0, Ld.len);
      if (screenDrag !== hit) loopUI.sel = Math.abs(s - Ld.a) < Math.abs(s - Ld.b) ? 'in' : 'out';
      if (loopUI.sel === 'in') loopRegion(s, Ld.b); else loopRegion(Ld.a, s);
    } };
    VP_HIT.push(hit);
  }
  // ---------- scroll bar
  { const sh = P ? 22 : 18, aw = P ? 30 : 26, tx = wx + aw + 2, tw = ww - 2 * aw - 4, span = v1 - v0;
    const arrowGad = (x, dir) => { gad(x, sy, aw, sh, '', false, Ld ? () => setView(v0 + dir * span * 0.5, v1 + dir * span * 0.5) : null, !Ld);
      g.fillStyle = AM.txt; const cx = x + aw / 2, cy = sy + sh / 2, a = sh * 0.26; g.fillRect(cx - a * 1.4, cy - 1, a * 2.8, 2); g.beginPath();
      if (dir < 0) { g.moveTo(cx - a * 1.6, cy); g.lineTo(cx - a * 0.4, cy - a); g.lineTo(cx - a * 0.4, cy + a); } else { g.moveTo(cx + a * 1.6, cy); g.lineTo(cx + a * 0.4, cy - a); g.lineTo(cx + a * 0.4, cy + a); } g.fill(); };
    arrowGad(wx, -1); arrowGad(wx + ww - aw, 1);
    g.fillStyle = '#1b1d22'; g.fillRect(tx, sy, tw, sh); bev(tx, sy, tw, sh, false);
    const kx = tx + 3 + (Ld ? v0 / len : 0) * (tw - 6), kw = Math.max(14, (Ld ? span / len : 1) * (tw - 6));
    g.fillStyle = '#c9ccd4'; g.fillRect(kx, sy + 3, Math.min(kw, tx + tw - 3 - kx), sh - 6); bev(kx, sy + 3, Math.min(kw, tx + tw - 3 - kx), sh - 6, true, '#ffffff', '#6a707c');
    if (Ld) VP_HIT.push({ x: tx, y: sy - 4, w: tw, h: sh + 8, drag: true, act: px => { const c = clamp((px - tx - 3) / (tw - 6), 0, 1) * len; setView(c - span / 2, c + span / 2); } });
    sy += sh + 6;
  }
  // ---------- gadget groups
  const st = looper.state, blinkOff = st === 'stop' && Math.floor(performance.now() / 400) % 2;
  const stCol = st === 'rec' ? AM.red : st === 'play' ? AM.grn : st === 'stop' ? (blinkOff ? '#7a5510' : AM.amb) : AM.txt;
  const stTxt = st === 'rec' ? 'REC->' : st === 'play' ? 'LOOP->' : st === 'stop' ? (looper.slot ? 'ARMED' : 'STOPPED') : 'READY';
  const act = st === 'rec' ? 'LOOP IT' : st === 'play' ? 'STOP' : st === 'stop' ? 'PLAY' : 'REC';
  const dimE = !Ld || st === 'rec', dimV = !Ld;
  const slotG = (x, y, w, h, n) => {
    const Sx = loopSlots[n - 1], cur = looper.slot === n, del = loopUI.del === n, flash = loopUI.store && Math.floor(performance.now() / 300) % 2;
    const col = del ? AM.red : cur ? AM.amb : Sx ? AM.cyan : AM.dimT;
    const hit = gad(x, y, w, h, del ? 'EMPTY?' : Sx ? '' : String(n), cur || del || flash, () => loopSlotTap(n), false, col);
    hit.long = () => { if (loopSlots[n - 1]) { loopUI.del = n; drawMixScreen(); } };
    if (Sx && !del) {   // number on top, length under it
      const s = ((Sx.b - Sx.a) / Sx.sr).toFixed(2) + 'S', np = h > 30 ? 2 : 1.5, sel = cur || flash;
      txt(String(n), x + (w - bitWidth(String(n), np)) / 2, y + 3 + (sel ? 1 : 0), np, col); txt(s, x + (w - bitWidth(s, 1)) / 2, y + h - 10, 1, AM.txt);
    }
  };
  const volG = (x, y, w, h) => {
    const lw = bitWidth('VOLUME', 1.5) + 12, v = mixVal['loop.vol'] ?? 0.8, tx = x + lw, tw = w - lw - 4;
    g.fillStyle = AM.face; g.fillRect(x, y, w, h); bev(x, y, w, h, true); txt('VOLUME', x + 6, y + (h - 10) / 2, 1.5, AM.txt);
    g.fillStyle = '#1b1d22'; g.fillRect(tx, y + 5, tw, h - 10); bev(tx, y + 5, tw, h - 10, false);
    g.fillStyle = '#c9ccd4'; g.fillRect(tx + 3, y + 8, Math.max(4, (tw - 6) * v), h - 16);
    VP_HIT.push({ x: tx, y, w: tw, h, drag: true, act: px => { setMix('loop.vol', clamp((px - tx - 3) / (tw - 6), 0, 1)); drawMixScreen(); } });
  };
  const storeG = (x, y, w, h) => gad(x, y, w, h, loopUI.store ? 'TAP SLOT' : 'STORE', loopUI.store, () => { if (!looper.data) { loopSay('Nothing to store: record a loop first'); return; } loopUI.store = !loopUI.store; loopUI.del = 0; }, !looper.data);
  const saveG = (x, y, w, h) => gad(x, y, w, h, 'SAVE BANK', false, () => { const d = new Date(), def = `BANK ${d.getDate()} ${d.toLocaleString('en', { month: 'short' }).toUpperCase()} ${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`; openKbd('LOOP BANK NAME (saves all 4 slots)', def, false, 40, t => loopSaveBank(t.trim() || def), 'looper'); }, !loopSlots.some(Boolean));
  const loadG = (x, y, w, h) => gad(x, y, w, h, 'LOAD BANK', false, loopOpenBanks);
  const zoomTo = f => { const c = loopUI.sel === 'in' ? Ld.a : Ld.b, s = (v1 - v0) * f; setView(c - s / 2, c + s / 2); };
  const viewGads = [[P ? 'SHOW RNG' : 'SHOW RANGE', () => { const m = (Ld.b - Ld.a) * 0.06; setView(Ld.a - m, Ld.b + m); }], ['SHOW ALL', () => setView(0, len)], ['ZOOM', () => zoomTo(0.25)], ['TELE', () => zoomTo(4)]];
  const markGads = [['IN', loopUI.sel === 'in', () => { loopUI.sel = 'in'; }], ['OUT', loopUI.sel === 'out', () => { loopUI.sel = 'out'; }], ['RANGE ALL', false, () => loopRegion(0, Ld.len)]];
  const undoG = (x, y, w, h) => gad(x, y, w, h, loopUndo.length ? `UNDO ${loopUndo.length}` : 'UNDO', false, loopUndoDo, !loopUndo.length, AM.amb);
  const nudgeGads = [['-10MS', () => loopNudge(-10)], ['-1MS', () => loopNudge(-1)], ['+1MS', () => loopNudge(1)], ['+10MS', () => loopNudge(10)]];
  if (!P) {
    const gy = sy, rH = 26, gH = 3 * rH + 2 * gap + 8, x0 = 8;
    const grp = (x, w) => { panel(x, gy, w, gH); return [x + 4, gy + 4, w - 8]; };
    let [x, y, w] = grp(x0, 120);   // slots
    { const hw = (w - gap) / 2; slotG(x, y, hw, rH, 1); slotG(x + hw + gap, y, hw, rH, 2); slotG(x, y + rH + gap, hw, rH, 3); slotG(x + hw + gap, y + rH + gap, hw, rH, 4); storeG(x, y + 2 * (rH + gap), w, rH); }
    [x, y, w] = grp(x0 + 126, 108);   // transport
    txt(stTxt, x + (w - bitWidth(stTxt, 2)) / 2, y + 5, 2, AM.cyan);
    { const hit = gad(x, y + rH, w, 2 * rH + gap, act, st !== 'empty', () => pressLooper('tablet'), false, stCol); hit.long = clearLooper; }
    [x, y, w] = grp(x0 + 240, 196);   // markers
    { const w3 = (w - 2 * gap) / 3; markGads.forEach(([l, on, a], i) => gad(x + i * (w3 + gap), y, w3, rH, l, on, a, dimE));
      const w4 = (w - 3 * gap) / 4; nudgeGads.forEach(([l, a], i) => gad(x + i * (w4 + gap), y + rH + gap, w4, rH, l, false, a, dimE));
      const uy = y + 2 * (rH + gap); undoG(x + 3 * (w4 + gap), uy, w4, rH);
      txt('HOLD PLAY/REC', x + 2, uy + 3, 1.25, AM.dimT); txt('BTTN TO CLEAR', x + 2, uy + 14, 1.25, AM.dimT); }
    [x, y, w] = grp(x0 + 442, 186);   // view + volume
    { const w2 = (w - gap) / 2; viewGads.forEach(([l, a], i) => gad(x + (i % 2) * (w2 + gap), y + Math.floor(i / 2) * (rH + gap), w2, rH, l, false, a, dimV)); volG(x, y + 2 * (rH + gap), w, rH); }
    [x, y, w] = grp(x0 + 634, W - 8 - (x0 + 634));   // banks
    saveG(x, y, w, rH); loadG(x, y + rH + gap, w, rH);
    gad(x, y + 2 * (rH + gap), w, rH, 'DJ TOOLS', false, () => setTools('dj'));
    logo(8, gy + gH + 4, W - 16, H - (gy + gH + 4) - 4);
  } else {
    const rH = 34, x = L, w = R - L; let y = sy;
    panel(x, y, w, 2 * rH + 18); txt(stTxt, x + 8, y + 7, 2, AM.cyan); { const hit = gad(x + 4, y + 26, w - 8, rH + 18 - 6, act, st !== 'empty', () => pressLooper('tablet'), false, stCol); hit.long = clearLooper; } y += 2 * rH + 22;
    const w4 = (w - 3 * gap) / 4; for (let n = 1; n <= 4; n++) slotG(x + (n - 1) * (w4 + gap), y, w4, rH + 6, n); y += rH + 6 + gap;
    const w3 = (w - 2 * gap) / 3; storeG(x, y, w3, rH); saveG(x + w3 + gap, y, w3, rH); loadG(x + 2 * (w3 + gap), y, w3, rH); y += rH + gap;
    markGads.forEach(([l, on, a], i) => gad(x + i * (w3 + gap), y, w3, rH, l, on, a, dimE)); y += rH + gap;
    nudgeGads.forEach(([l, a], i) => gad(x + i * (w4 + gap), y, w4, rH, l, false, a, dimE)); y += rH + gap;
    undoG(x + 3 * (w4 + gap), y, w4, rH); { const hs = 'HOLD PLAY/REC BTTN TO CLEAR', hp = lmFit(hs, 3 * (w4 + gap) - 4, 1.5); txt(hs, x + 2, y + (rH - 7 * hp) / 2, hp, AM.dimT); } y += rH + gap;
    viewGads.forEach(([l, a], i) => gad(x + i * (w4 + gap), y, w4, rH, l, false, a, dimV)); y += rH + gap;
    volG(x, y, w, rH); y += rH + gap;
    logo(x, y, w, Math.max(40, H - 28 - y));
  }
}
function drawToolsPage() {
  const { g, canvas: c } = scr(); const W = c.width, H = c.height, P = portrait();
  VP_HIT.length = 0;
  g.fillStyle = '#05070c'; g.fillRect(0, 0, W, H);
  const btn = (x, y, w, h, label, on, act, dim, fs0 = 17) => {
    g.fillStyle = on ? '#c8202c' : dim ? '#2a3140' : '#c9ced8'; g.fillRect(x, y, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = on ? '#fff' : dim ? '#56627a' : '#3a4252';
    btnLabel(g, label, x, y, w, h, fs0); g.textBaseline = 'alphabetic';   // #349 two lines when needed
    if (act) VP_HIT.push({ x, y, w, h, act });
  };
  const L = P ? 24 : 8, R = W - (P ? 26 : 8);   // portrait keeps clear of the silver corner L
  const head = (title, back, extra) => {   // #365 extra: { label, on, act } a button left of the parent one (STREAM's CHAT)
    const y = P ? 28 : 8, bw = P ? 66 : 80, pw = P ? 92 : 110, pvw = P ? 72 : 84;   // #363 BACK right, the page's own button left of it; #389 PREVIEW (always here) between them
    const upLbl = back === 'mixer' ? 'DJ MIXER' : back === 'visuals' ? 'VISUALS' : '▲ ' + (TOOLS_NAME[back] || 'UP');
    btn(R - bw, y, bw, 34, '◀ BACK', false, navCan() ? navBack : null, !navCan());
    btn(R - bw - 6 - pvw, y, pvw, 34, 'PREVIEW', monOn, () => setMonitor(!monOn), false, 14);   // #389 the master PREVIEW on every page
    btn(R - bw - 12 - pvw - pw, y, pw, 34, upLbl, false, () => { if (back === 'visuals') { scrollFromVP = false; setTools(null); setVideoPage(true); } else setTools(back === 'mixer' ? null : back); }, false, 15);
    let tw = R - L - bw - pw - pvw - 22;
    if (extra) {   // portrait: no room for a title as well, the button takes its place
      const ew = P ? Math.min(110, tw) : 96; btn(R - bw - pw - pvw - 18 - ew, y, ew, 34, extra.label, extra.on, extra.act, false, 17);
      tw -= ew + 6; if (P) { g.textBaseline = 'alphabetic'; return y + 46; }
    }
    g.fillStyle = '#dfe6f2'; g.textBaseline = 'middle';
    { let n = 20; g.font = `700 ${n}px system-ui`; while (n > 13 && g.measureText(title).width > tw) g.font = `700 ${--n}px system-ui`; }   // #349 shrink before cutting
    if (g.measureText(title).width <= tw) { g.textAlign = 'left'; g.fillText(title, L + 4, y + 17); }
    else { g.textAlign = 'center'; btnLabel(g, title, L, y, tw, 34, 16, 700); }   // #363 two lines in portrait when needed
    g.textBaseline = 'alphabetic';
    return y + 46;
  };
  const tapB = (x, y, w, h, fs = 17) => { btn(x, y, w, h, tapLbl(), wtapOn(), tapWall, false, fs); VP_HIT[VP_HIT.length - 1].long = tapClear; };   // #444 a long press hands the beat back to the music
  const pxSlider = (x, y, w, h) => tSlider(g, x, y, w, h, 'PIXELS', wallPx / 10, wallPx === 0 ? '0 SMOOTH' : String(wallPx), v => setWallPx(v * 10));   // #444
  const note = (s, y) => { g.fillStyle = '#8c96a8'; g.font = '500 15px system-ui'; g.textAlign = 'left'; return wrapText(g, s, L + 4, y, R - L - 8, 20, 5); };
  const lockBtn = (x, y, w, h) => btn(x, y, w, h, gearLock ? 'GEAR LOCKDOWN: ON' : 'GEAR LOCKDOWN: OFF', gearLock, () => { gearLock = !gearLock; toast(gearLock ? 'Gear locked' : 'Gear unlocked: decks and mixer can be moved and turned', 2400); drawMixScreen(); }, false, 18);   // #378 DJ TOOLS
  const page = toolsPage;
  if (page === 'looper' || page === 'loopbanks') { drawLooperPage(page, { g, W, H, P, L, R, btn, head, note }); return; }   // #470
  if (page === 'home') {
    const y0 = head('TOOLS', 'mixer');
    const stLbl = streamer && streamer.live ? '● LIVE ' + streamer.elapsed() : 'STREAM';   // #331
    if (P) { btn(L, y0 + 8, R - L, 96, 'DJ TOOLS', false, () => setTools('dj'), false, 26); btn(L, y0 + 116, R - L, 96, 'VJ TOOLS', false, () => setTools('vj'), false, 26);
      btn(L, y0 + 224, R - L, 96, stLbl, !!(streamer && streamer.live), () => setTools('stream'), !streamer, 26);
      btn(L, y0 + 332, R - L, 80, streamer ? tvLbl(streamer) : 'DIRROTV', !!(streamer && (streamer.tvUp || streamer.stuRun)), () => setTools('tv'), !streamer, 24);   // #389 was CHALKBOARD (now on VJ TOOLS)
      btn(L, y0 + 424, R - L, 72, dirroLbl(), !!(dirro && dirro.on), () => setTools('dirro'), !dirro, 24);   // #427
      note('DJ TOOLS: Record Maker, milk crate on / off. VJ TOOLS: Scroller, LED wall, neon, whiteboard, portals, cameras. STREAM: go live on Twitch (master mix only, never the cue). DIRROTV: the Fire Stick TV. DIRROGRAM: the show on the audience\'s phones.', y0 + 520); }   // #363 was under the CHALKBOARD button
    else { const bw = (R - L - 48) / 5; btn(L, y0 + 8, bw, 130, 'DJ TOOLS', false, () => setTools('dj'), false, 24); btn(L + bw + 12, y0 + 8, bw, 130, 'VJ TOOLS', false, () => setTools('vj'), false, 24);   // #427 five across
      btn(L + 2 * (bw + 12), y0 + 8, bw, 130, stLbl, !!(streamer && streamer.live), () => setTools('stream'), !streamer, 24);
      btn(L + 3 * (bw + 12), y0 + 8, bw, 130, streamer ? tvLbl(streamer) : 'DIRROTV', !!(streamer && (streamer.tvUp || streamer.stuRun)), () => setTools('tv'), !streamer, 21);   // #389 was CHALKBOARD (now on VJ TOOLS)
      btn(L + 4 * (bw + 12), y0 + 8, bw, 130, dirroLbl(), !!(dirro && dirro.on), () => setTools('dirro'), !dirro, 21);   // #427
      note('DJ TOOLS: Record Maker, milk crate.  VJ TOOLS: Scroller, LED wall, neon, whiteboard, portals, cameras.  STREAM: Twitch.  DIRROTV: the Fire Stick TV.  DIRROGRAM: the show on the audience\'s phones.', y0 + 160); }
    return;
  }
  if (page === 'stream') {   // #331 LIVE STREAM to Twitch
    const y0 = head('LIVE STREAM · TWITCH', 'home'), S = streamer;   // #389 CHAT left the header (it is the CHAT ▸ button in the row below)
    if (!S) { note('Streaming runs on the headset (not on the phone).', y0 + 20); return; }
    const st = S.state, live = st === 'live';
    const line = (live ? `● LIVE  ${S.elapsed()}  ·  ${(S.kbps / 1000).toFixed(1)} Mb/s` : st === 'connecting' ? S.msg || 'Connecting…' : st === 'error' ? S.msg : 'OFF AIR') + (S.stu.on ? '  ·  VIA S8 ' + STUDIO_MODES[S.stu.mode] : '');   // #380
    g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = '800 24px system-ui';
    g.fillStyle = live ? '#ff3b3b' : st === 'connecting' ? '#f1b650' : st === 'error' ? '#f1b650' : '#8c96a8';
    if (P) wrapText(g, line, L + 4, y0 + 18, R - L - 8, 28, 2); else fitText2(g, line, L + 4, y0 + 18, R - L - 8);
    g.textBaseline = 'alphabetic';
    const keys = ['card', 'show', 'vj'];   // #389 AVACAM source gone: GOPRO / GOPRO2 do that job   // #374 PHONE and PHONE CAM SETUP moved into SHOWTIME! (camera pick on OBJECTS);   // #347 PHONE CAM   // #338 VJ SETUP where VIDEOWALL was   // #372 HEADSET CAM and PHONE CAM are camera picks inside SHOWTIME! (OBJECTS page)
    const inShow = k => S.source === k || (k === 'show' && (S.source === 'headset' || S.source === 'pcam' || S.source === 'avacam'));
    const srcBtn = (k, x, y, w, h) => { if (k === 'vj') return btn(x, y, w, h, 'VJ SETUP', false, () => setVideoPage(true), false, P ? 20 : 17);   // #338 the VISUALS pages, as from the main mixer page
      btn(x, y, w, h, k === 'card' ? 'CARD ⁺¹' : STREAM_SRC[k], inShow(k), k === 'card' ? () => { S.setSource('card'); setTools('card'); } : () => S.setSource(k), false, P ? 20 : 18); };   // #445 CARD opens its page
    const ending = performance.now() - (streamEndArm || 0) < 2500;
    const goLabel = live || st === 'connecting' ? (ending ? 'TAP AGAIN TO END' : 'END STREAM') : 'GO LIVE';
    const goAct = () => {
      if (S.live) { if (performance.now() - (streamEndArm || 0) < 2500) { streamEndArm = 0; S.stop(); } else { streamEndArm = performance.now(); setTimeout(drawMixScreen, 2600); } drawMixScreen(); }
      else S.start();
    };
    const hint = `Sends the MASTER mix (and the MIC when it goes through the mixer); CUE never reaches the stream. Key ${S.keyHint()}${S.hasKey() ? '' : ': enter it on the start page'}. GOPRO / GOPRO2: movable cameras, grip to move, double-tap the button = back to its start (GOPRO2 starts overhead). ROBO-BODY and GEAR off = visuals only.`;
    // #336 / #338 SHOWTIME! layer toggles
    const O = S.showOpt, sw3 = S.source === 'show' || S.source === 'headset' || S.source === 'pcam';
    const opts = [['backdrop', 'BACKDROP', sw3], ['robot', 'ROBO-BODY', S.source === 'show'], ['gear', 'GEAR', sw3], ['scroll', P ? 'SCROLL' : 'SCROLLER', sw3], ['np', 'NOW PLAYING', sw3], ['logo', 'LOGO', sw3], ['chat', 'CHAT ▸', true], ['objects', 'OBJECTS ▸', true]];   // #389 CHAT opens the chat page (ON STREAM is there)   // #372 BACKDROP: NONE / VISUALS / DOME
    const optBtn = ([k, label, ok], x, y, w, h) => {
      if (k === 'objects') return btn(x, y, w, h, 'OBJECTS ▸', false, () => setTools('showobj'), false, P ? 17 : 15);
      if (k === 'chat') return btn(x, y, w, h, chat && chat.msgs.some(m => !m.sys && performance.now() - m.t < 60000) ? 'CHAT ▸ ●' : 'CHAT ▸', false, chat ? () => setTools('chat') : null, !chat, P ? 17 : 15);
      if (k === 'backdrop') return btn(x, y, w, h, 'BACK: ' + O.backdrop.toUpperCase(), ok && O.backdrop !== 'none', ok ? () => S.nextBackdrop() : null, !ok, P ? 16 : 13);
      return btn(x, y, w, h, label, ok && O[k], ok ? () => S.setShowOpt(k, !O[k]) : null, !ok, P ? 17 : 15);
    };
    const gpZoom = () => { const gp = gpActive(); if (gp) { gp.nextZoom(); drawMixScreen(); } };
    const gpBtns = (x, y, w1, w2, w3, h) => {   // #389 GOPRO, GOPRO2 and the zoom of whichever is out
      btn(x, y, w1, h, gopro && gopro.on ? 'GOPRO: ON' : 'GOPRO', !!(gopro && gopro.on), () => goproTap('gopro'), !gopro, P ? 17 : 17); if (gopro) VP_HIT[VP_HIT.length - 1].long = () => goproReset('gopro');   // #404
      btn(x + w1 + 8, y, w2, h, gopro2 && gopro2.on ? 'GOPRO2: ON' : 'GOPRO2', !!(gopro2 && gopro2.on), () => goproTap('gopro2'), !gopro2, P ? 17 : 17); if (gopro2) VP_HIT[VP_HIT.length - 1].long = () => goproReset('gopro2');
      const ga = gpActive(); btn(x + w1 + w2 + 16, y, w3, h, ga ? GOPRO_ZOOMS[ga.zoom].label : 'ZOOM', false, ga ? gpZoom : null, !ga, 15);
    };
    if (P) {
      const bw = (R - L - 8) / 2;   // #374 two columns of sources
      keys.forEach((k, i) => srcBtn(k, L + (i % 2) * (bw + 8), y0 + 62 + Math.floor(i / 2) * 62, bw, 56));
      const ow = (R - L - 24) / 4;
      opts.forEach((o, i) => optBtn(o, L + (i % 4) * (ow + 8), y0 + 200 + Math.floor(i / 4) * 50, ow, 44));
      btn(L, y0 + 306, R - L, 90, goLabel, live || ending, S.hasKey() || S.live ? goAct : null, !S.hasKey() && !S.live, 26);   // #389 PREVIEW is the button beside BACK on every page
      const tw3 = (R - L - 16) / 3; gpBtns(L, y0 + 406, tw3, tw3, tw3, 50);
      note(hint, y0 + 478);
    } else {
      const bw = (R - L - 16) / 3;
      keys.forEach((k, i) => srcBtn(k, L + i * (bw + 8), y0 + 38, bw, 44));
      const ow = (R - L - 56) / 8;
      opts.forEach((o, i) => optBtn(o, L + i * (ow + 8), y0 + 88, ow, 34));
      const U = R - L - 16, gw = Math.round(U * 0.46), w1 = Math.round(U * 0.18), w3 = U - gw - 2 * w1 - 8;
      btn(L, y0 + 130, gw, 54, goLabel, live || ending, S.hasKey() || S.live ? goAct : null, !S.hasKey() && !S.live, 22);
      gpBtns(L + gw + 8, y0 + 130, w1, w1, w3 - 8, 54);
      note(hint, y0 + 200);
    }
    return;
  }
  if (page === 'showobj') {   // #372 SHOWTIME! objects: what the 3D layer films, presets, and what it costs
    const y0 = head(P ? 'OBJECTS' : 'SHOWTIME! OBJECTS', 'stream'), S = streamer;
    if (!S) { note('Streaming runs on the headset (not on the phone).', y0 + 20); return; }
    const O = S.showOpt, gOn = !!(gopro && gopro.on), bh = P ? 52 : 30, gap = P ? 8 : 5, cols = P ? 3 : 5,   // #378 landscape is 768 x 304: compact rows, no captions
       bw = (R - L - gap * (cols - 1)) / cols;
    // camera pick: GOPRO / FRONT / FADERS are the DJ camera angles, HEADSET CAM and PHONE CAM their own pictures (#372)
    const cams = [['gopro', 'GOPRO', !gopro], ['gopro2', 'GOPRO2', !gopro2], ['front', 'FRONT', false], ['faders', 'FADERS', false], ['headset', P ? 'HEADSET' : 'HEADSET CAM', false]];   // #389 PHONE CAM is in the objects row; GOPRO2 where it was
    const camOn = k => (k === 'headset' || k === 'pcam') ? S.source === k : (k === 'gopro' || k === 'gopro2') ? djSet.preset === k : (S.source === 'show' || S.source === 'avacam') && djSet.preset === k;   // #389 GOPRO / GOPRO2 / FRONT / FADERS; #402 a GoPro lights up exactly when it is out (as on STREAM)
    g.fillStyle = '#8c96a8'; g.font = '700 12px system-ui'; g.textAlign = 'left'; if (P) g.fillText('CAMERA', L + 2, y0 + 8);
    const camPick = k => {
      if (k === 'pcam') { openPhoneCam(); return; }   // #374 / #389
      if (k === 'gopro' || k === 'gopro2') { if (S.source === 'headset' || S.source === 'pcam') S.setSource('show'); goproPick(k); drawMixScreen(); return; }   // #389 double-tap = back to its start
      if (k === 'headset') S.setSource(k);
      else {
        if (S.source === 'headset' || S.source === 'pcam') S.setSource('show');
        setDjPreset(k);
      }
      drawMixScreen();
    };
    cams.forEach(([k, label, off], i) => { btn(L + (i % cols) * (bw + gap), y0 + (P ? 14 : 6) + Math.floor(i / cols) * (bh + gap), bw, bh, label, camOn(k), (off && k !== 'pcam') ? null : () => camPick(k), off, P ? 16 : 15); if ((k === 'gopro' || k === 'gopro2') && !off) VP_HIT[VP_HIT.length - 1].long = () => goproReset(k); });   // #404 long press = reset   // PHONE CAM stays tappable when greyed: it says why
    const cy2 = y0 + (P ? 14 : 6) + Math.ceil(cams.length / cols) * (bh + gap) + (P ? 6 : 0);
    g.fillStyle = '#8c96a8'; if (P) g.fillText('OBJECTS', L + 2, cy2 + 8);
    const items = [['wall', 'LED WALL', false], ['pcam', 'PHONE CAM', !!pcamReady()], ['neon', 'NEON', false], ['panel', 'CHAT PANEL', false], ['chalk', 'WHITEBOARD', false], ['gear', 'GEAR', false], ['robot', 'ROBO-BODY', S.source === 'headset' || S.source === 'pcam'], ['dome', 'DOME', false]];
    // #377 DOME is an object here (the sky dome from VISUALS > PANO > SKY). It is the backdrop's 'dome' choice: on = DOME, off = the VISUALS picture behind (they
    // are one at a time, the dome would hide it); on the PHONE CAM shot it is what you are keyed over, so it needs GREEN SCREEN. NONE stays on the STREAM page's BACK button.
    const domeTap = () => { if (O.backdrop === 'dome') S.setShowOpt('backdrop', 'visuals'); else { S.setShowOpt('backdrop', 'dome'); if (!skybox.tex) toast('DOME needs a sky: VISUALS > PANO > SKY', 3200); } drawMixScreen(); };
    items.forEach(([k, label, off], i) => { const on = k === 'dome' ? O.backdrop === 'dome' : k === 'pcam' ? S.source === 'pcam' : !!O[k]; if (k === 'pcam') { btn(L + (i % cols) * (bw + gap), cy2 + (P ? 14 : 0) + Math.floor(i / cols) * (bh + gap), bw, bh, label, on, openPhoneCam, off, P ? 16 : 14); return; } btn(L + (i % cols) * (bw + gap), cy2 + (P ? 14 : 0) + Math.floor(i / cols) * (bh + gap), bw, bh, label, !off && on, off ? null : k === 'dome' ? domeTap : () => S.setShowOpt(k, !O[k]), off, P ? 16 : 15); });   // greyed: the GoPro prop while it is the camera; the wall and robot under HEADSET CAM
    const ry = cy2 + (P ? 14 : 0) + Math.ceil(items.length / cols) * (bh + gap) + (P ? 6 : 4), pw = ((P ? R - L : (R - L) * 0.6) - 2 * gap) / 3;
    const ms = djcam ? djcam.ms : 0;
    g.fillStyle = '#8c96a8'; g.font = '600 15px system-ui'; g.textAlign = 'left';
    const line = `Render time of the DJ camera: ${ms.toFixed(1)} ms${S.source === 'show' && !S.show3d ? '  (nothing 3D on: nearly free)' : ''}`;
    if (P) g.fillText(line, L + 2, ry + bh + 28); else { g.font = '600 14px system-ui'; g.fillText(`DJ camera ${ms.toFixed(1)} ms`, L + 2, ry + bh / 2 + 5); }   // landscape: on the presets' row
    // #375 HANDS on the shot (HEADSET CAM and PHONE CAM): REAL HANDS = nothing drawn on your hands; 3D HANDS / ROBOT GLOVE = the controller look (also what you see in the headset)
    const handsRow = yy => {
      const look = xr ? xr.getCtlLook() : null, real = !!O.handsReal, hw = (R - L - 2 * gap) / 3;
      g.fillStyle = '#8c96a8'; g.font = '700 12px system-ui'; g.textAlign = 'left'; if (P) g.fillText('HANDS ON THE SHOT', L + 2, yy);
      const setLook = m => () => { S.setShowOpt('handsReal', false); if (xr) { xr.setCtlLook(m); const el = document.getElementById('sHands'); if (el) el.value = xr.getCtlLook(); } drawMixScreen(); };
      [['REAL HANDS', real, () => { S.setShowOpt('handsReal', true); drawMixScreen(); }, false], ['3D HANDS', !real && look === '3dhands', setLook('3dhands'), !xr], ['ROBOT GLOVE', !real && look === 'glove', setLook('glove'), !xr]]
        .forEach(([lb, on, act, off], i) => btn(L + i * (hw + gap), yy + (P ? 6 : 0), hw, bh, lb, on, off ? null : act, off, P ? 15 : 14));
      return yy + (P ? 6 : 0) + bh;
    };
    if (S.source === 'pcam') {   // #374 PHONE CAM block: where it stands, its main switches, and its settings page
      const C = S.pc_, st = pcamStatus(S), yb = ry + bh + (P ? 44 : 20);
      g.fillStyle = '#dfe6f2'; g.font = '500 14px system-ui'; g.textAlign = 'left';
      const nl = wrapText(g, st[0] + ' ' + st[1], L + 2, yb, R - L - 4, 18, P ? 2 : 1), by = yb + nl * 18 + 2, bw4 = (R - L - 3 * gap) / 4;
      [['GREEN SCREEN', C.green, () => S.setPcam('green', !C.green)], ['LATENCY MATCH', C.lat, () => S.setPcam('lat', !C.lat)], ['LIGHT MATCH', C.light, () => S.setPcam('light', !C.light)], ['SETUP ▸', false, () => setTools('pcam')]]
        .forEach(([lb, on, act], i) => btn(L + i * (bw4 + gap), by, bw4, bh, lb, on, act, false, P ? 14 : 13));
      note(P ? 'PHONE CAM: your own hands show (no 3D or robot hands: they were too hard to line up). The LED wall and ROBO-BODY are off and props behind you (neon, chalkboard, GoPro) are left out, because the phone picture is flat and they would paint over your head. BACKDROP shows only with GREEN SCREEN on.' : 'PHONE CAM: your own hands; no LED wall or ROBO-BODY; props behind you are left out.', by + bh + (P ? 22 : 18));
      return;
    }
    let ny = ry + bh + (P ? 48 : 16); if (S.source === 'headset') ny = handsRow(ry + bh + (P ? 48 : 8)) + (P ? 22 : 18);   // #375
    note(P ? 'DOME is the sky dome (VISUALS > PANO > SKY); it and the VISUALS picture behind are one at a time, and NONE is the BACK button on the STREAM page. The LED wall shows the scroller when it is in shot; when it is not, the scroller is a flat band. HEADSET CAM turns ROBO-BODY (the full robot avatar) and the LED wall off while it is the camera. GoPro: a prop other cameras film, hidden from its own camera. NEON is the heaviest object. FULL / LEAN / FIRST PERSON set several toggles at once.' : (S.source === 'headset' ? 'HEADSET CAM: ROBO-BODY and the LED wall are off. HANDS: REAL = nothing drawn on your hands. DOME: VISUALS > PANO > SKY.' : 'DOME: VISUALS > PANO > SKY, one at a time with the VISUALS picture (NONE = BACK on STREAM). The scroller rides the LED wall when it is in shot.'), ny);
    return;
  }
  if (page === 'chat') {   // #340 Twitch chat (read-only)
    const y0 = head('TWITCH CHAT · #' + (chat ? chat.channel : ''), 'stream'); if (!chat) return;
    const S = streamer, bw = P ? (R - L - 16) / 3 : 150, bh = P ? 48 : 36;
    btn(L, y0, bw, bh, chatPanel && chatPanel.on ? 'PANEL: ON' : 'PANEL', !!(chatPanel && chatPanel.on), chatPanelTap, !chatPanel, 16);
    btn(L + bw + 8, y0, bw, bh, 'ON STREAM', !!(S && S.showOpt.chat), S ? () => S.setShowOpt('chat', !S.showOpt.chat) : null, !S, 16);
    btn(L + 2 * (bw + 8), y0, bw, bh, 'RECONNECT', false, () => { chat.stop(); chat.tries = 0; chat.start(); drawMixScreen(); }, false, 16);
    // #341 CHALKBOARD (a slate with chalks on its ledge; #377 its own object, not the chat panel) and WIPE (tap twice)
    const yb2 = y0 + bh + (P ? 8 : 6), bw2 = P ? (R - L - 8) / 2 : 150, wipeArm = performance.now() - (chalkWipeT || 0) < 2500;
    btn(L, yb2, bw2, bh, chalkLbl(), !!(chalkboard && chalkboard.on), chalkboard ? () => { chalkboard.setOn(!chalkboard.on); chalkboard.save(); drawMixScreen(); } : null, !chalkboard, 15);   // #377 its own object
    btn(L + bw2 + 8, yb2, bw2, bh, wipeArm ? 'TAP AGAIN TO WIPE' : 'WIPE', wipeArm, chalkboard && chalkboard.on ? () => { if (wipeArm) { chalkWipeT = 0; chalkboard.wipe(); } else { chalkWipeT = performance.now(); setTimeout(drawMixScreen, 2600); } drawMixScreen(); } : null, !(chalkboard && chalkboard.on), 15);
    const st = { joined: '● connected', connecting: 'connecting…', reconnecting: 'reconnecting…', off: 'off', error: 'error' }[chat.status] || chat.status;
    g.fillStyle = chat.status === 'joined' ? '#40d080' : '#f1b650'; g.font = '700 15px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle';
    if (P) g.fillText(st, L + 4, y0 + bh + 16); else g.fillText(st, L + 3 * (bw + 8) + 6, y0 + bh / 2);
    g.textBaseline = 'alphabetic';
    const cy = y0 + 2 * bh + (P ? 40 : 14);
    if (!chat.msgs.some(m => !m.sys)) note('No messages yet. Read-only: replies from the headset need a Twitch login (later). PANEL: a chat screen in the room, grip / pinch to move it, double-tap PANEL = back to its spot. ON STREAM: chat on the right of SHOWTIME!.', cy + 60);
    else drawChat(g, L, cy, R - L, H - cy - (P ? 28 : 6), chat.msgs, { fs: P ? 17 : 16, bg: '#0a0c12', onEmote: chatRedraw });
    return;
  }
  if (page === 'pcamcrop') {   // #353 GARBAGE MATTE: crop the green-screen cut-out to a box (cuts stands, the room past the cloth)
    const y0 = head(P ? 'CROP' : 'GARBAGE MATTE', 'pcam'), S = streamer; if (!S) return;
    const cs = spect && spect.cam, K = cs && cs.K, C = S.pc_, keySend = (key, v) => { if (spect && spect.camSet && K) { K[key] = v; spect.camSet({ what: 'key', key, v }); } };
    const v = livePossible() ? liveVideo : null, packed = v && v.videoWidth && Math.abs(v.videoWidth / v.videoHeight - 1920 / 720) < 0.06;
    const pc6 = spect && spect.phoneCam, asp = pc6 && pc6.vw ? pc6.vw / pc6.vh : packed ? 16 / 9 : v && v.videoWidth ? v.videoWidth / v.videoHeight : 16 / 9;
    const tw = P ? R - L : 400, th = Math.round(tw / asp), tx = L, ty = y0;
    // the picture: MATTE on = what goes out (the cut-out in black and white), else the phone's own colour picture
    g.fillStyle = '#000'; g.fillRect(tx, ty, tw, th);
    let shown = false;
    if (C.matte && S.active && S.source === 'pcam' && S.pkFrames) { g.drawImage(S.canvas, tx, ty, tw, th); shown = true; }
    else if (v && v.videoWidth && v.readyState >= 2) { try { if (packed) g.drawImage(v, 0, 0, v.videoWidth * 1280 / 1920, v.videoHeight, tx, ty, tw, th); else g.drawImage(v, tx, ty, tw, th); shown = true; } catch {} }
    if (!shown) { g.fillStyle = '#8c96a8'; g.font = '600 14px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(S.source !== 'pcam' ? 'Pick PHONE CAM on STREAM' : 'Turn PREVIEW on to see the phone', tx + tw / 2, ty + th / 2); g.textBaseline = 'alphabetic'; }
    const gl = K ? K.gl || 0 : 0, gr = K ? K.gr || 0 : 0, gt = K ? K.gt || 0 : 0, gb = K ? K.gb || 0 : 0;
    const bx = tx + gl * tw, by = ty + gt * th, bw = tw * (1 - gl - gr), bh = th * (1 - gt - gb);
    g.fillStyle = 'rgba(0,0,0,0.62)';   // cut away = darkened
    g.fillRect(tx, ty, tw, by - ty); g.fillRect(tx, by + bh, tw, ty + th - by - bh); g.fillRect(tx, by, bx - tx, bh); g.fillRect(bx + bw, by, tx + tw - bx - bw, bh);
    g.strokeStyle = '#f2c230'; g.lineWidth = 2; g.strokeRect(bx, by, bw, bh);
    g.fillStyle = '#f2c230'; for (const [hx, hy] of [[bx, by + bh / 2], [bx + bw, by + bh / 2], [bx + bw / 2, by], [bx + bw / 2, by + bh]]) g.fillRect(hx - 5, hy - 5, 10, 10);
    // tap the picture: the nearest edge jumps to the tap
    if (K) VP_HIT.push({ x: tx, y: ty, w: tw, h: th, act: (px, py) => {
      const u = (px - tx) / tw, w = (py - ty) / th, d = [Math.abs(u - gl), Math.abs(u - (1 - gr)), Math.abs(w - gt), Math.abs(w - (1 - gb))], i = d.indexOf(Math.min(...d));
      const cl = x => Math.min(0.45, Math.max(0, Math.round(x * 100) / 100));
      if (i === 0) keySend('gl', cl(u)); else if (i === 1) keySend('gr', cl(1 - u)); else if (i === 2) keySend('gt', cl(w)); else keySend('gb', cl(1 - w));
    } });
    const r2 = x => Math.round(x * 100) / 100;
    const cells = [['LEFT', 'gl'], ['RIGHT', 'gr'], ['TOP', 'gt'], ['BOTTOM', 'gb']].map(([lb, k]) => [lb, K ? Math.round((K[k] || 0) * 100) + '%' : '--', d => K && keySend(k, Math.min(0.45, Math.max(0, r2((K[k] || 0) + d * 0.01))))]);
    const cell = ([label, val, act], x, y, w, h) => {
      g.fillStyle = '#8c96a8'; g.font = '700 12px system-ui'; g.textAlign = 'left'; g.fillText(label, x + 2, y + 11);
      const cy = y + 15, ch = h - 15, cw = 40;
      btn(x, cy, cw, ch, '−', false, K ? () => { act(-1); drawMixScreen(); } : null, !K);
      g.font = '700 17px system-ui'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(val, x + w / 2, cy + ch / 2); g.textBaseline = 'alphabetic';
      btn(x + w - cw, cy, cw, ch, '+', false, K ? () => { act(1); drawMixScreen(); } : null, !K);
    };
    const tog = [[C.matte ? 'MATTE: ON' : 'MATTE', C.matte, () => S.setPcam('matte', !C.matte)], ['PREVIEW', monOn, () => setMonitor(!monOn)],
      ['RESET', false, K ? () => { for (const k of ['gl', 'gr', 'gt', 'gb']) keySend(k, 0); drawMixScreen(); } : null, !K]];
    const help = 'Tap the picture: the nearest edge moves there. − / + for 1 % steps. Everything outside the yellow box is cut away like the green. MATTE shows the result as it goes out (green screen on).';
    if (P) {
      const y1 = ty + th + 10, cw = (R - L - 8) / 2;
      cells.forEach((c, i) => cell(c, L + (i % 2) * (cw + 8), y1 + Math.floor(i / 2) * 58, cw, 54));
      const yb = y1 + 2 * 58 + 6, b3 = (R - L - 16) / 3;
      tog.forEach(([lb, on, act, dim], i) => btn(L + i * (b3 + 8), yb, b3, 46, lb, on, act, !!dim, 16));
      g.fillStyle = '#8c96a8'; g.font = '500 14px system-ui'; g.textAlign = 'left'; wrapText(g, K ? help : 'Phone not connected (fixed camera mode).', L + 4, yb + 72, R - L - 8, 19, 8);
    } else {
      const x1 = tx + tw + 12, cw = R - x1;
      cells.forEach((c, i) => cell(c, x1, ty + i * 44, cw, 40));
      const b3 = (cw - 12) / 3;
      tog.forEach(([lb, on, act, dim], i) => btn(x1 + i * (b3 + 6), ty + 4 * 44 + 2, b3, 34, lb, on, act, !!dim, 13));
      g.fillStyle = '#8c96a8'; g.font = '500 12px system-ui'; g.textAlign = 'left'; wrapText(g, K ? help : 'Phone not connected (fixed camera mode).', x1, ty + 4 * 44 + 52, cw, 14, 2);
    }
    return;
  }
  if (page === 'pcam') {   // #347 PHONE CAM SETUP: the tripod phone's video with the gear / hands drawn from its view
    const y0 = head(P ? 'PHONE' : 'PHONE CAM SETUP', 'showobj'), S = streamer;   // #374 back to SHOWTIME! OBJECTS
     if (!S) { note('Streaming runs on the headset.', y0 + 20); return; }
    const C = S.pc_, cs = spect && spect.cam, K = cs && cs.K, keySend = (key, v) => { if (spect && spect.camSet) { if (K) K[key] = v; spect.camSet({ what: 'key', key, v }); } };
    const r2 = v => Math.round(v * 100) / 100;
    const toggles = [
      [P ? (C.green ? 'GREEN SCREEN: ON' : 'GREEN SCREEN') : (C.green ? 'GREEN SCR: ON' : 'GREEN SCR'), C.green, () => S.setPcam('green', !C.green)],
      ['BACK: ' + S.showOpt.backdrop.toUpperCase(), C.green && S.showOpt.backdrop !== 'none', () => S.nextBackdrop(), !C.green],   // #374 the shared backdrop (only seen with GREEN SCREEN)
      [P ? (C.light ? 'LIGHT MATCH: ON' : 'LIGHT MATCH') : (C.light ? 'LIGHT: ON' : 'LIGHT'), C.light, () => S.setPcam('light', !C.light)],
      [P ? (C.lat ? 'LATENCY: ON' : 'LATENCY MATCH') : (C.lat ? 'LATENCY: ON' : 'LATENCY'), C.lat, () => S.setPcam('lat', !C.lat)],
      [P ? 'KEY: ' + KEY_LABEL[(K && K.col) || 0] : 'KEY ' + ['GRN', 'BLUE', 'MAG'][(K && K.col) || 0], false, K ? () => { keySend('col', (((K.col || 0) + 1) % 3)); drawMixScreen(); } : null, !K],
      ['AUTO KEY', false, K ? () => { spect.camSet({ what: 'auto' }); toast('Auto key: point the phone at the empty key screen', 3000); } : null, !K],
      [K && (K.gl || K.gr || K.gt || K.gb) ? 'CROP: ON' : 'CROP', !!(K && (K.gl || K.gr || K.gt || K.gb)), () => setTools('pcamcrop')],   // #353 garbage matte page
      ['PREVIEW', monOn, () => setMonitor(!monOn)],
    ];
    const lat = S.delay != null ? Math.round(S.delay) : null;
    const cells = [
      ['STRENGTH', K ? r2(K.thr).toFixed(2) : '--', d => K && keySend('thr', Math.min(0.8, Math.max(0, r2(K.thr + d * 0.01))))],
      ['SOFTNESS', K ? r2(K.soft).toFixed(2) : '--', d => K && keySend('soft', Math.min(0.4, Math.max(0.02, r2(K.soft + d * 0.01))))],
      ['SPILL', K ? r2(K.spill).toFixed(2) : '--', d => K && keySend('spill', Math.min(1, Math.max(0, r2(K.spill + d * 0.05))))],
      ['LIGHT', Math.round(C.lightStr * 100) + '%', d => S.setPcam('lightStr', Math.min(1, Math.max(0, r2(C.lightStr + d * 0.1))))],
      ['WRAP', Math.round(C.wrap * 100) + '%', d => S.setPcam('wrap', Math.min(1, Math.max(0, r2(C.wrap + d * 0.1))))],
      ['KEY GLOW', Math.round(C.glow * 100) + '%', d => S.setPcam('glow', Math.min(1, Math.max(0, r2(C.glow + d * 0.1))))],
      ['EXPOSURE', (C.expo > 0 ? '+' : '') + C.expo.toFixed(1), d => S.setPcam('expo', Math.min(1, Math.max(-1, r2(C.expo + d * 0.1))))],
      [lat != null ? 'DELAY TRIM' : 'DELAY', lat != null ? `${lat}${C.trim >= 0 ? '+' : ''}${C.trim} ms` : `${C.manual} ms`, d => lat != null ? S.setPcam('trim', C.trim + d * 10) : S.setPcam('manual', Math.max(0, C.manual + d * 10))],
    ];
    const cell = ([label, val, act], x, y, w, h) => {
      g.fillStyle = '#8c96a8'; g.font = '700 12px system-ui'; g.textAlign = 'left'; g.fillText(label, x + 2, y + 11);
      const by = y + 15, bh = h - 15, bw = 40;
      btn(x, by, bw, bh, '−', false, () => { act(-1); drawMixScreen(); });
      let fs = 17; g.font = `700 ${fs}px system-ui`; while (fs > 11 && g.measureText(val).width > w - 2 * bw - 6) g.font = `700 ${--fs}px system-ui`;
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(val, x + w / 2, by + bh / 2); g.textBaseline = 'alphabetic';
      btn(x + w - bw, by, bw, bh, '+', false, () => { act(1); drawMixScreen(); });
    };
    const st = pcamStatus(S);   // #374 shared with the OBJECTS page
    if (C.green && C.light) { const h = S.lampHint(); if (h) st.push(h); }
    if (C.green && S.showOpt.backdrop === 'dome' && !skybox.tex) st.push('BACK DOME: no sky picked yet (VISUALS > PANO > SKY).');
    const help = 'CROP: the garbage matte (cut away stands and the room past the cloth). GREEN SCREEN off: the phone video is the background and the gear and chalkboard are drawn over it (your hands are your own, nothing is drawn on them). On: you are keyed over the BACK setting (VISUALS, DOME or none). The LED wall is off in this shot, and props behind you are left out so they never cut your head. LIGHT MATCH grades you toward the panorama (pick it with SKY) and lights the gear from it.';
    // #374 a small live preview of what goes out (the stream picture, redrawn about 5 times a second by the page's timer)
    const pcamPrev = (x, y, w) => {
      const asp = S.canvas.width / S.canvas.height || 16 / 9, h = Math.round(w / asp), live2 = S.source === 'pcam' && S.active && S.pkFrames;
      g.fillStyle = '#000'; g.fillRect(x, y, w, h);
      if (live2) g.drawImage(S.canvas, x, y, w, h);
      else { g.fillStyle = '#8c96a8'; g.font = '600 13px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(S.source !== 'pcam' ? 'PHONE CAM is not the camera' : 'waiting for the phone', x + w / 2, y + h / 2); g.textBaseline = 'alphabetic'; }
      g.strokeStyle = '#2a3142'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    };
    const text = (x, y, w, lh, max, fs) => {
      g.textAlign = 'left'; g.font = `500 ${fs}px system-ui`; let n = 0;
      g.fillStyle = '#dfe6f2'; for (const t of st) { if (n >= max - 1) break; n += wrapText(g, t, x, y + n * lh, w, lh, 2); }
      g.fillStyle = '#8c96a8'; if (n < max) wrapText(g, help, x, y + n * lh, w, lh, max - n);
    };
    if (P) {
      const tw = (R - L - 8) / 2;
      toggles.forEach(([lb, on, act, dim], i) => btn(L + (i % 2) * (tw + 8), y0 + Math.floor(i / 2) * 50, tw, 44, lb, on, act, !!dim, 16));
      const y1 = y0 + 4 * 50 + 6;
      cells.forEach((c, i) => cell(c, L + (i % 2) * (tw + 8), y1 + Math.floor(i / 2) * 58, tw, 54));
      const pw = Math.round((R - L) * 0.42); pcamPrev(R - pw, y1 + 4 * 58 + 12, pw);
      text(L + 4, y1 + 4 * 58 + 16, R - L - 8 - pw - 8, 19, Math.max(3, Math.floor((H - 10 - (y1 + 4 * 58 + 16)) / 19) + 1), 14);   // #378 never past the bottom edge
    } else {
      const tw = (R - L - 42) / 8;
      toggles.forEach(([lb, on, act, dim], i) => btn(L + i * (tw + 6), y0, tw, 40, lb, on, act, !!dim, 13));
      const cw = (R - L - 24) / 4, y1 = y0 + 48;
      cells.forEach((c, i) => cell(c, L + (i % 4) * (cw + 8), y1 + Math.floor(i / 4) * 48, cw, 44));
      const pw = Math.min(210, Math.round((R - L) * 0.34)); pcamPrev(R - pw, y1 + 2 * 48 + 8, pw);
      text(L + 4, y1 + 2 * 48 + 14, R - L - 8 - pw - 10, 16, Math.max(3, Math.floor((H - 10 - (y1 + 2 * 48 + 14)) / 16) + 1), 13);   // #378 never past the bottom edge
    }
    return;
  }
  if (page === 'studiokey') {   // #385 S8 KEY: the keying of LIVE KEY! on the tablet (it was only on the S8's own screen). Same remote as the PHONE CAM page: 'cset' key / auto
    const y0 = head(P ? 'KEY' : 'S8 KEY (LIVE KEY!)', 'studio'), S = streamer; if (!S) return;
    const cs = spect && spect.cam, K = cs && cs.K, keySend = (key, v) => { if (spect && spect.camSet && K) { K[key] = v; spect.camSet({ what: 'key', key, v }); } };
    const r2 = v => Math.round(v * 100) / 100, cl = (v, a, b) => Math.min(b, Math.max(a, v)), pc = v => Math.round(v * 100) + '%';
    const toggles = [
      [P ? 'KEY: ' + KEY_LABEL[(K && K.col) || 0] : 'KEY ' + ['GRN', 'BLUE', 'MAG'][(K && K.col) || 0], false, K ? () => { keySend('col', (((K.col || 0) + 1) % 3)); drawMixScreen(); } : null, !K],
      ['AUTO KEY', false, K ? () => { spect.camSet({ what: 'auto' }); toast('Auto key: point the S8 at the EMPTY key screen', 3000); } : null, !K],
      ['PREVIEW', monOn, () => setMonitor(!monOn)],
      [STUDIO_MODES.key || 'LIVE KEY!', S.stu.mode === 'key', () => S.setStudio('mode', 'key')],
    ];
    const cells = [
      ['STRENGTH', K ? r2(K.thr).toFixed(2) : '--', d => K && keySend('thr', cl(r2(K.thr + d * 0.01), 0, 0.8))],
      ['SOFTNESS', K ? r2(K.soft).toFixed(2) : '--', d => K && keySend('soft', cl(r2(K.soft + d * 0.01), 0.02, 0.4))],
      ['SPILL', K ? r2(K.spill).toFixed(2) : '--', d => K && keySend('spill', cl(r2(K.spill + d * 0.05), 0, 1))],
      ['DOME MATCH', K ? pc(K.cmatch || 0) : '--', d => K && keySend('cmatch', cl(r2((K.cmatch || 0) + d * 0.1), 0, 1))],
      ['CROP LEFT', K ? pc(K.gl || 0) : '--', d => K && keySend('gl', cl(r2((K.gl || 0) + d * 0.02), 0, 0.45))],
      ['CROP RIGHT', K ? pc(K.gr || 0) : '--', d => K && keySend('gr', cl(r2((K.gr || 0) + d * 0.02), 0, 0.45))],
      ['CROP TOP', K ? pc(K.gt || 0) : '--', d => K && keySend('gt', cl(r2((K.gt || 0) + d * 0.02), 0, 0.45))],
      ['CROP BOTTOM', K ? pc(K.gb || 0) : '--', d => K && keySend('gb', cl(r2((K.gb || 0) + d * 0.02), 0, 0.45))],
    ];
    const cell = ([label, val, act], x, y, w, h) => {
      g.fillStyle = '#8c96a8'; g.font = '700 12px system-ui'; g.textAlign = 'left'; g.fillText(label, x + 2, y + 11);
      const by = y + 15, bh2 = h - 15, bw = 40;
      btn(x, by, bw, bh2, '−', false, () => { act(-1); drawMixScreen(); });
      let fs = 17; g.font = `700 ${fs}px system-ui`; while (fs > 11 && g.measureText(val).width > w - 2 * bw - 6) g.font = `700 ${--fs}px system-ui`;
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(val, x + w / 2, by + bh2 / 2); g.textBaseline = 'alphabetic';
      btn(x + w - bw, by, bw, bh2, '+', false, () => { act(1); drawMixScreen(); });
    };
    const prev = (x, y, w) => {
      const h2 = Math.round(w * 9 / 16); g.fillStyle = '#000'; g.fillRect(x, y, w, h2);
      const im = monOn && S.stuRun ? pvTex.image : null;
      if (im) { try { g.drawImage(im, x, y, w, h2); } catch {} }
      else { g.fillStyle = '#8c96a8'; g.font = '600 13px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(monOn ? 'waiting for the S8' : 'PREVIEW shows the S8 picture', x + w / 2, y + h2 / 2); g.textBaseline = 'alphabetic'; }
      g.strokeStyle = '#2a3142'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h2 - 1);
    };
    const info = !K ? 'The S8 is not linked: open the camera page on it, connect, Fixed camera.' : 'AUTO KEY: point the S8 at the EMPTY green screen. STRENGTH: higher cuts more green. SOFTNESS: the edge. SPILL: green off your skin. DOME MATCH: tints you to the dome picture. CROP: cuts stands and the room past the cloth. PREVIEW shows the result.';
    const text = (x, y, w, lh, max) => { g.textAlign = 'left'; g.font = '500 13px system-ui'; g.fillStyle = '#8c96a8'; wrapText(g, info, x, y, w, lh, max); };
    if (P) {
      const tw = (R - L - 8) / 2;
      toggles.forEach(([lb, on, act, dim], i) => btn(L + (i % 2) * (tw + 8), y0 + Math.floor(i / 2) * 50, tw, 44, lb, on, act, !!dim, 16));
      const y1 = y0 + 2 * 50 + 6;
      cells.forEach((c, i) => cell(c, L + (i % 2) * (tw + 8), y1 + Math.floor(i / 2) * 58, tw, 54));
      const yb = y1 + 4 * 58 + 12, pw = Math.round((R - L) * 0.42); prev(R - pw, yb, pw);
      text(L + 4, yb + 14, R - L - 8 - pw - 10, 18, Math.max(3, Math.floor((H - 10 - yb) / 18)));
    } else {
      const tw = (R - L - 18) / 4;
      toggles.forEach(([lb, on, act, dim], i) => btn(L + i * (tw + 6), y0, tw, 40, lb, on, act, !!dim, 15));
      const cw = (R - L - 24) / 4, y1 = y0 + 48;
      cells.forEach((c, i) => cell(c, L + (i % 4) * (cw + 8), y1 + Math.floor(i / 4) * 48, cw, 44));
      const pw = Math.min(210, Math.round((R - L) * 0.34)), yb = y1 + 2 * 48 + 8; prev(R - pw, yb, pw);
      text(L + 4, yb + 12, R - L - 8 - pw - 10, 16, Math.max(3, Math.floor((H - 10 - yb) / 16)));
    }
    return;
  }
  if (page === 'studio') {   // #380 S8 STUDIO: the S8 makes the TV picture and the Twitch stream; the Quest sends the scene with its matte and the sound
    const y0 = head('S8 STUDIO', 'stream', streamer ? { label: P ? 'TV ▸' : 'FIRE STICK ▸', on: false, act: () => setTools('tv') } : null), S = streamer;
    if (!S) { note('The studio is run from the headset (not on the phone).', y0 + 20); return; }
    const U = S.stu, s8 = S.s8 && performance.now() - S.s8.at < 3500 ? S.s8 : null, gap = P ? 8 : 6, bh = P ? 54 : 30;
    const title = !U.on ? 'Studio off: Twitch and the Fire Stick TV go from the Quest' : !S.stuLink ? 'S8 not linked' : !S.stuRun ? 'The S8 page is too old: reload it' : s8 && s8.run ? 'S8 studio running' : 'Waiting for the S8…';
    g.textAlign = 'left'; g.font = `700 ${P ? 21 : 18}px system-ui`; g.fillStyle = s8 && s8.run ? '#7dff9a' : '#dfe6f2';
    fitText2(g, title, L + 2, y0 + 20, R - L - 4);
    const tw = s8 ? (s8.tw === 'live' ? `TWITCH LIVE ${((s8.kbps || 0) / 1000).toFixed(1)} Mb/s` : s8.tw === 'connecting' ? 'Twitch connecting' : 'Twitch off') : '';
    const sub = U.on && s8 ? `out ${s8.fps || 0} fps · Quest frames ${s8.qfps || 0} fps · camera held ${s8.hold != null ? s8.hold + ' ms' : '-'} · ${tw}${s8.note ? ' · ' + s8.note : ''}` : U.on ? (S.stuMsg || 'Open the camera page on the S8, connect, Fixed camera, Calibrate.') : 'Turn the studio on with the S8 linked (Fixed camera, calibrated).';
    g.font = '500 14px system-ui'; g.fillStyle = '#8c96a8';
    const nl = wrapText(g, sub, L + 2, y0 + (P ? 40 : 36), R - L - 4, 18, P ? 3 : 2), y1 = y0 + (P ? 44 : 40) + Math.max(1, nl) * 18;
    const w3 = (R - L - 2 * gap) / 3, w4 = (R - L - 3 * gap) / 4, w5 = (R - L - 4 * gap) / 5, fs = P ? 18 : 15;
    btn(L, y1, w3, bh, U.on ? 'STUDIO: ON' : 'STUDIO: OFF', U.on, () => S.setStudio('on', !U.on), false, fs);
    btn(L + w3 + gap, y1, w3, bh, U.snd ? 'SOUND: ON' : 'SOUND: OFF', U.snd, () => S.setStudio('snd', !U.snd), false, fs);
    btn(L + 2 * (w3 + gap), y1, w3, bh, 'BACK: ' + S.showOpt.backdrop.toUpperCase(), S.showOpt.backdrop !== 'none', () => { S.nextBackdrop(); S._stuSync(); }, false, fs);
    const y2 = y1 + bh + gap;
    Object.entries(STUDIO_MODES).forEach(([k, label], i) => btn(L + i * (w3 + gap), y2, w3, bh + (P ? 12 : 0), label, U.mode === k, () => S.setStudio('mode', k), false, P ? 22 : 17));
    const y3 = y2 + bh + (P ? 12 : 0) + gap;
    const fs5 = P ? 15 : 14;
    btn(L, y3, w5, bh, 'DELAY −10', false, () => S.setStudio('trim', U.trim - 10), false, fs5);
    btn(L + w5 + gap, y3, w5, bh, `TRIM ${U.trim > 0 ? '+' : ''}${U.trim} ms`, false, U.trim ? () => S.setStudio('trim', 0) : null, false, fs5);
    btn(L + 2 * (w5 + gap), y3, w5, bh, 'DELAY +10', false, () => S.setStudio('trim', U.trim + 10), false, fs5);
    btn(L + 3 * (w5 + gap), y3, w5, bh, P ? 'CAMERA ▸' : 'SHOW CAMERA ▸', false, () => setTools('showobj'), false, fs5);
    btn(L + 4 * (w5 + gap), y3, w5, bh, 'KEY ▸', U.mode === 'key', () => setTools('studiokey'), false, fs5);   // #385 the keying controls
    { // #382 LOW LIGHT (dark clubs): hold the S8 camera at 25 fps, raise its exposure (EV, the camera's own gain) and the studio's GAIN
      const yL = y3 + bh + gap, ci = s8 && s8.cam, fsL = P ? 16 : 14;
      const ev = (U.ev > 0 ? '+' : '') + U.ev.toFixed(1);
      const items = [[U.fps25 ? '25 FPS: ON' : '25 FPS: OFF', U.fps25, () => S.setStudio('fps25', !U.fps25)], ['EV −', false, () => S.setStudio('ev', U.ev - 0.5)], [`EV ${ev}`, false, () => S.setStudio('ev', 0)], ['EV +', false, () => S.setStudio('ev', U.ev + 0.5)],
        ['GAIN −', false, () => S.setStudio('gain', U.gain - 0.1)], [`GAIN ×${U.gain.toFixed(1)}`, false, () => S.setStudio('gain', 1)], ['GAIN +', false, () => S.setStudio('gain', U.gain + 0.1)]];
      if (P) { items.slice(0, 4).forEach(([l, on, a], i) => btn(L + i * (w4 + gap), yL, w4, bh, l, on, a, false, fsL)); items.slice(4).forEach(([l, on, a], i) => btn(L + i * (w3 + gap), yL + bh + gap, w3, bh, l, on, a, false, fsL)); }
      else { const w7 = (R - L - 6 * gap) / 7; items.forEach(([l, on, a], i) => btn(L + i * (w7 + gap), yL, w7, bh, l, on, a, false, fsL)); }
      const camLine = ci ? `S8 camera: ${ci.rate || ci.fps || '?'} fps${ci.ev != null ? ', EV ' + ci.ev + (ci.evMax != null ? ' (max ' + ci.evMax + ')' : '') : ', no EV control in Chrome'}${ci.rate && ci.rate < 22 ? ' · too dark for 25: more light, or EV / GAIN up' : ''}` : '';
      if (P) { note((camLine ? camLine + '. ' : '') + 'SHOW: Quest camera (SHOWTIME! pick), S8 backdrop. LIVE DJ!: S8 films you in your room. LIVE KEY!: keyed over the backdrop. TRIM + holds the camera back more. GO LIVE goes out from the S8.', yL + 2 * (bh + gap) + 20); }
      else if (camLine) { g.fillStyle = ci.rate && ci.rate < 22 ? '#f1b650' : '#8c96a8'; g.font = '500 14px system-ui'; g.textAlign = 'left'; fitText2(g, camLine, L + 4, yL + bh + 18, R - L - 8); }
    }
    return;
  }
  if (page === 'holosms') {   // #435 HoloSMS from the audience: HOLO = on the phones' hologram scroller (6 at most), SINE = on the Quest's scroller, ✕ = delete
    const y0 = head('HOLOSMS', 'dirro'), d = dirro;
    if (!d) { note('Not on this device.', y0 + 24); return; }
    const per = P ? 9 : 3, rh = P ? 60 : 58, pages = Math.max(1, Math.ceil(d.sms.length / per)); smsPg = Math.min(smsPg, pages - 1);
    const bw = P ? 56 : 70, bx = R - 3 * bw - 12;
    if (!d.sms.length) note(d.on ? 'No messages yet. People type a HoloSMS on the Dirrogram page (140 characters, one every 3 minutes each); they come here first and reach no screen until you pick HOLO or SINE.' : 'DIRROGRAM is off: switch it on to receive messages.', y0 + 24);
    d.sms.slice(smsPg * per, smsPg * per + per).forEach((m, i) => {
      const y = y0 + 4 + i * rh, ago = Math.max(0, Math.round((Date.now() - m.at) / 60000));
      g.fillStyle = m.holo ? '#1d2a3c' : '#121722'; g.fillRect(L, y, R - L, rh - 6);
      g.fillStyle = '#8c96a8'; g.font = '600 11px system-ui'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(ago ? `${ago} min ago` : 'just now', L + 6, y + 13);
      g.fillStyle = '#ffffff'; g.font = '500 14px system-ui'; wrapText(g, m.t, L + 6, y + 29, bx - L - 14, 16, 2);
      btn(bx, y + 4, bw, rh - 14, 'HOLO', m.holo, () => d.smsHolo(m.id), false, 15);
      btn(bx + bw + 6, y + 4, bw, rh - 14, 'SINE', m.sine, () => d.smsSine(m.id), false, 15);
      btn(bx + 2 * (bw + 6), y + 4, bw, rh - 14, '✕', false, () => d.smsDelete(m.id), false, 18);
    });
    const fy = y0 + 4 + per * rh + 2, fw = (R - L - 18) / 4;
    btn(L, fy, fw, 36, '◀', false, smsPg > 0 ? () => { smsPg--; drawMixScreen(); } : null, smsPg === 0, 18);
    g.fillStyle = '#dfe6f2'; g.font = '600 15px system-ui'; g.textAlign = 'center'; g.fillText(`${smsPg + 1} / ${pages}  ·  ${d.holo.length} on holo`, L + fw * 1.5 + 6, fy + 23);
    btn(L + 2 * (fw + 6), fy, fw, 36, '▶', false, smsPg < pages - 1 ? () => { smsPg++; drawMixScreen(); } : null, smsPg >= pages - 1, 18);
    btn(L + 3 * (fw + 6), fy, fw, 36, 'CLEAR HOLO', false, d.holo.length ? () => d.holoClear() : null, !d.holo.length, 14);
    return;
  }
  if (page === 'dirro') {   // #427 DIRROGRAM: on / off, the relay, the room and its QR (the audience scans it), status; #434 the phones' LED wall
    const y0 = head('DIRROGRAM', 'home'), d = dirro;
    if (!d) { note('Not on this device.', y0 + 24); return; }
    const W8 = d.wall, cyc = (arr, v, dir) => arr[(arr.indexOf(v) + dir + arr.length) % arr.length];
    // #463 the audience link as text (https://dirrodj.club/<ROOM>), centred, shrunk to fit
    const dirroLink = (x, y, w, fs) => { const t = fanUrl(); g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#39e6ff'; let n = fs; g.font = `700 ${n}px system-ui`; while (n > 9 && g.measureText(t).width > w) g.font = `700 ${--n}px system-ui`; g.fillText(t, x + w / 2, y, w); };
    const acts = [[d.on ? 'DIRROGRAM: ON' : 'DIRROGRAM: OFF', d.on, () => d.setOn(!d.on)],
      ['RELAY…', false, () => openKbd('RELAY: EMPTY = RELAY.DIRRODJ.CLUB, OR A FULL ADDRESS', relayUrl(), false, 160, t => d.setRelay(t), 'dirro')],   // #431 the short form is enough
      ['NEW ROOM', false, () => { const now = performance.now(); if (now - dirroRoomT < 2500) { dirroRoomT = 0; d.newRoom(); toast('New room: the old QR no longer works', 2500); } else { dirroRoomT = now; toast('Tap NEW ROOM again: printed QR codes of the old room stop working', 2500); } }]];
    // stepper: − value +, the label small above the value
    const stp = (x, y, w, h, label, val, dn, up) => {
      btn(x, y, 40, h, '−', false, () => { dn(); drawMixScreen(); }); btn(x + w - 40, y, 40, h, '+', false, () => { up(); drawMixScreen(); });
      g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#8c96a8'; g.font = '700 12px system-ui'; g.fillText(label, x + w / 2, y + 14);
      g.fillStyle = '#fff'; g.font = '700 17px system-ui'; g.fillText(val, x + w / 2, y + h - 7);
    };
    // #438 MARK LEFT / RIGHT (as the crowd sees them): tap, then touch the light with the controller tip and pull the trigger; CLEAR takes two taps
    const bcnRow = (x, y, w, h) => {
      const bw3 = (w - 12) / 3, mk = k => () => { dirroMark.want = k; dirroMark.t0 = performance.now(); dirroMark.prev = {}; toast(`Touch the ${k === 'L' ? 'LEFT' : 'RIGHT'} beacon (as the crowd sees it) with the controller tip, pull the trigger`, 4000); drawMixScreen(); };
      btn(x, y, bw3, h, dirroMark.want === 'L' ? 'TOUCH LEFT…' : d.bcn.L ? 'BEACON L ✓' : 'MARK BEACON L', !!d.bcn.L || dirroMark.want === 'L', mk('L'), false, 14);
      btn(x + bw3 + 6, y, bw3, h, dirroMark.want === 'R' ? 'TOUCH RIGHT…' : d.bcn.R ? 'BEACON R ✓' : 'MARK BEACON R', !!d.bcn.R || dirroMark.want === 'R', mk('R'), false, 14);
      btn(x + 2 * (bw3 + 6), y, bw3, h, 'CLEAR BEACONS', false, d.bcn.L || d.bcn.R ? () => { const now = performance.now(); if (now - dirroRoomT < 2500) { dirroRoomT = 0; d.clearBeacons(); } else { dirroRoomT = now; toast('Tap CLEAR BEACONS again', 2000); } } : null, !(d.bcn.L || d.bcn.R), 13);
    };
    const wallBtn = (x, y, w, h) => btn(x, y, w, h, 'WALL: ' + WALL_LABEL[W8.src], W8.src !== 'follow', () => d.setWall('src', cyc(WALL_SRC, W8.src, 1)), false, 16);
    const steps = [
      ['LED GRID', W8.cols ? `${W8.cols} across` : 'OFF', () => d.setWall('cols', cyc(WALL_COLS, W8.cols, -1)), () => d.setWall('cols', cyc(WALL_COLS, W8.cols, 1))],
      ['LED DOT', `${Math.round(W8.fill * 100)} %`, () => d.setWall('fill', Math.max(0.4, Math.round((W8.fill - 0.05) * 100) / 100)), () => d.setWall('fill', Math.min(1, Math.round((W8.fill + 0.05) * 100) / 100))],
      ['LED GLOW', `${W8.glow.toFixed(1)}x`, () => d.setWall('glow', Math.max(0.5, Math.round((W8.glow - 0.1) * 10) / 10)), () => d.setWall('glow', Math.min(2, Math.round((W8.glow + 0.1) * 10) / 10))],
      ['TV FRAMES / S', String(W8.fps), () => d.setWall('fps', Math.max(1, W8.fps - 1)), () => d.setWall('fps', Math.min(6, W8.fps + 1))]];
    let ty, tx = L + 4, tw;
    if (P) {
      acts.forEach(([l, on, a], i) => btn(L, y0 + 6 + i * 56, R - L, 48, l, on, a, false, 21));
      let y = y0 + 6 + 3 * 56; wallBtn(L, y, R - L, 44); y += 52;
      steps.forEach(([l, v, dn, up], i) => stp(L + (i % 2) * ((R - L) / 2 + 3), y + Math.floor(i / 2) * 52, (R - L) / 2 - 3, 44, l, v, dn, up)); y += 2 * 52 + 6;
      btn(L, y, R - L, 40, `HOLOSMS (${d.sms.length})`, d.holo.length > 0, () => setTools('holosms'), false, 17); y += 46;   // #435
      bcnRow(L, y, R - L, 40); y += 46;   // #438
      ty = y + 14; tw = R - L - 8;
      dirroLink(L, ty + 62, R - L, 18); btn(L, ty + 72, R - L, 36, 'CREATE CARD', false, makeDirroCard, false, 17);   // #463 the link, then CREATE CARD below it
      const q = Math.min(R - L, H - (ty + 116) - 8); drawQr(g, fanUrl(), L + (R - L - q) / 2, ty + 116, q);
    } else {
      const q = 196, qx = R - q, lw = qx - L - 14, aw = (lw - 12) / 3, sw = (lw - 12) / 3;
      acts.forEach(([l, on, a], i) => btn(L + i * (aw + 6), y0 + 4, aw, 44, l, on, a, false, 17));
      wallBtn(L, y0 + 54, aw, 42);
      steps.forEach(([l, v, dn, up], i) => { const k = i + 1, x = L + (k % 3) * (sw + 6), y = y0 + 54 + Math.floor(k / 3) * 48; stp(x, y, sw, 42, l, v, dn, up); });
      drawQr(g, fanUrl(), qx, y0 + 2, q);
      dirroLink(qx, y0 + q + 15, q, 13); btn(qx, y0 + q + 20, q, 28, 'CREATE CARD', false, makeDirroCard, false, 14);   // #463 under the QR
      btn(L + 2 * (sw + 6), y0 + 54 + 48, sw, 42, `HOLOSMS (${d.sms.length})`, d.holo.length > 0, () => setTools('holosms'), false, 15);   // #435
      bcnRow(L, y0 + 54 + 2 * 48, lw, 36); ty = y0 + 54 + 2 * 48 + 36 + 18; tw = lw;   // #438
    }
    g.textAlign = 'left'; g.fillStyle = d.state === 'live' ? '#7dffa0' : '#dfe6f2'; g.font = '600 16px system-ui';
    g.fillText(d.status(), tx, ty, tw);
    g.fillStyle = '#8c96a8'; g.font = '500 14px system-ui';
    g.fillText(`Room ${roomKey()}  ·  relay ${relayUrl().replace(/^wss?:\/\//, '') || 'not set'}`, tx, ty + 19, tw);
    g.fillText(d.beaconInfo() + (d.bcn.L && d.bcn.R ? ' · phones: AIM > AIM WITH BEACON' : ''), tx, ty + 38, tw);   // #438
    // #463 the portrait help text (WALL on the phones: FOLLOW / AUTO / PICTURES / DIRROTV) was dropped: it was drawn over the QR
    return;
  }
  if (page === 'retro') {   // #442 RETRO-SCENE: the effect-driven visuals, one tap each
    const y0 = head('RETRO-SCENE', 'wall'), cyc = (arr, v, dir) => arr[(arr.indexOf(v) + dir + arr.length) % arr.length];
    const tiles = [['DANCER', ledMode === 'retro' && ledFx.s !== 'loop', () => setLedMode('retro')], ['MANDEL', ledMode === 'mandel', () => setLedMode('mandel')],
      ['VECTOR-DANCER ⁺¹', ledMode === 'vdancer', () => { setLedMode('vdancer'); setTools('vdancer'); }], ['METABALLS', ledMode === 'meta', () => setLedMode('meta')]];
    const grabLbl = grab.on ? (grab.n < 0 ? 'CAMERA…' : `GRABBING ${Math.max(0, Math.ceil((LOOP.n - grab.n) / LOOP.fps))} s`) : 'GRAB LOOP' + (grab.loops.length ? ` (${grab.loops.length})` : '');
    const stp = (x, y, w, h) => {
      btn(x, y, 40, h, '−', false, () => { vd.mp.n = Math.max(2, vd.mp.n - 1); vdSave(); drawMixScreen(); }); btn(x + w - 40, y, 40, h, '+', false, () => { vd.mp.n = Math.min(9, vd.mp.n + 1); vdSave(); drawMixScreen(); });
      g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#8c96a8'; g.font = '700 12px system-ui'; g.fillText('METABALLS', x + w / 2, y + 14);
      g.fillStyle = '#fff'; g.font = '700 17px system-ui'; g.fillText(vd.mp.n + ' balls', x + w / 2, y + h - 7);
    };
    const info = 'DANCER: the vector dancer, and your grabbed loops every 8 bars. VECTOR-DANCER: moire circles through a matte clip (open it for the matte slots, circle sets, gap and beat motion). METABALLS bounce on the beat. All of them go to the stream, DIRROTV and the phones too.';
    if (P) {
      const tw = (R - L - 6) / 2, th = 84;
      tiles.forEach(([l, on, a], i) => btn(L + (i % 2) * (tw + 6), y0 + 2 + Math.floor(i / 2) * (th + 6), tw, th, l, on, a, false, 19));
      let y = y0 + 2 + 2 * (th + 6) + 4;
      btn(L, y, R - L, 50, grabLbl, grab.on, grabLoop, false, 20); y += 58; stp(L, y, R - L, 44); y += 52;
      tapB(L, y, R - L, 50, 20); y += 58; pxSlider(L, y, R - L, 40); y += 48;
      note(info, y + 14);
    } else {
      const tw = (R - L - 18) / 4, th = 96;
      tiles.forEach(([l, on, a], i) => btn(L + i * (tw + 6), y0 + 2, tw, th, l, on, a, false, 19));
      const aw = (R - L - 12) / 3;
      btn(L, y0 + 106, aw, 42, grabLbl, grab.on, grabLoop, false, 17); stp(L + aw + 6, y0 + 106, aw, 42); tapB(L + 2 * (aw + 6), y0 + 106, aw, 42);
      pxSlider(L, y0 + 154, R - L, 32);
      g.fillStyle = '#8c96a8'; g.font = '500 13px system-ui'; g.textAlign = 'left'; wrapText(g, info, L + 4, y0 + 206, R - L - 8, 16, 3);
    }
    return;
  }
  if (page === 'vdancer') {   // #442 VECTOR-DANCER: rings through a matte; 6 matte slots, loaded from VISUALS > Video
    const y0 = head('VECTOR-DANCER', 'retro'), cyc = (arr, v, dir) => arr[(arr.indexOf(v) + dir + arr.length) % arr.length], rp = vd.rp, on = ledMode === 'vdancer';
    const sw = P ? (R - L - 6) / 2 : (R - L - 5 * 6) / 6, sh = P ? 44 : 48;
    for (let i = 0; i < VD_SLOTS; i++) {
      const x = P ? L + (i % 2) * (sw + 6) : L + i * (sw + 6), y = P ? y0 + 2 + Math.floor(i / 2) * (sh + 6) : y0 + 2;
      btn(x, y, sw, sh, vd.slots[i] ? `${i + 1}  ${vdLabel(i)}` : `${i + 1}  + LOAD`, on && vd.sel === i && !!vd.slots[i], () => vdSelect(i), !vd.slots[i], 15);
    }
    const ya = P ? y0 + 2 + 3 * (sh + 6) + 2 : y0 + 2 + sh + 6, h = 40, cw = (R - L - 18) / 4;
    const sel = vd.sel >= 0 ? vd.sel : Math.max(0, vd.slots.findIndex(x => !x));
    btn(L, ya, cw, h, vd.slots[sel] ? 'REPLACE…' : 'LOAD…', false, () => vdPickFor(sel), false, 16);
    btn(L + (cw + 6), ya, cw, h, vd.sel === 0 ? 'RESET 1' : 'CLEAR', false, vd.sel >= 0 && vd.slots[vd.sel] ? () => { vd.slots[vd.sel] = vd.sel === 0 ? '@builtin' : ''; if (vd.sel !== 0) vd.sel = -1; vdSave(); vd.cur = null; vdLoad(); drawMixScreen(); } : null, vd.sel < 0 || !vd.slots[vd.sel], 16);
    btn(L + 2 * (cw + 6), ya, cw, h, 'RINGS ONLY', on && vd.sel < 0, () => { vd.sel = -1; vdSave(); if (on) vdLoad(); else setLedMode('vdancer'); drawMixScreen(); }, false, 15);
    btn(L + 3 * (cw + 6), ya, cw, h, 'SWAP MATTE', !!rp.inv, () => { rp.inv = rp.inv ? 0 : 1; vdSave(); drawMixScreen(); }, false, 15);
    const yb = ya + h + 6, MV = ['OFF', 'PULSE', 'BOUNCE'], PL = ['ACID', 'NEON', 'MONO'];
    btn(L, yb, cw * 2 + 6, h, `CIRCLES: ${rp.n} SET${rp.n > 1 ? 'S' : ''}`, false, () => { rp.n = rp.n % 3 + 1; vdSave(); drawMixScreen(); }, false, 16);
    btn(L + 2 * (cw + 6), yb, cw, h, 'BEAT: ' + MV[rp.mv], rp.mv > 0, () => { rp.mv = (rp.mv + 1) % 3; vdSave(); drawMixScreen(); }, false, 15);
    btn(L + 3 * (cw + 6), yb, cw, h, PL[rp.pal], false, () => { rp.pal = (rp.pal + 1) % 3; vdSave(); drawMixScreen(); }, false, 16);
    const sw2 = P ? R - L : (R - L - 6) / 2, ys = yb + h + 6;
    tSlider(g, L, ys, sw2, 34, 'RING GAP', (rp.g - 1.5) / 6.5, `${rp.g.toFixed(1)} px`, v => { rp.g = Math.round((1.5 + v * 6.5) * 10) / 10; vdSave(); drawMixScreen(); });
    tSlider(g, P ? L : L + sw2 + 6, P ? ys + 40 : ys, sw2, 34, 'ZOOM', ((rp.z || 1) - 0.6) / 2.4, `${(rp.z || 1).toFixed(1)}x`, v => { rp.z = Math.round((0.6 + v * 2.4) * 10) / 10; vdSave(); drawMixScreen(); });
    g.fillStyle = '#8c96a8'; g.font = '500 13px system-ui'; g.textAlign = 'left';
    wrapText(g, 'Slot 1 is the bundled matte. Tap an empty slot to pick a clip on the VISUALS > Video page (a white figure on black works best). PULSE: the rings run out on the beat. BOUNCE: the circles bounce.', L + 4, ys + (P ? 90 : 52), R - L - 8, 16, P ? 5 : 2);
    return;
  }
  if (page === 'wall') {   // #439 LED WALL: one tap a source. It drives the 3D wall, the stream's / DIRROTV's VIDEOWALL and the Dirrogram phones (FOLLOW)
    const y0 = head('LED WALL', 'mixer'), d = dirro, LK = d ? d.wall : null, cyc = (arr, v, dir) => arr[(arr.indexOf(v) + dir + arr.length) % arr.length];
    const nOf = k => { const o = led.kind; led.kind = k; const n = led.pool().length; led.kind = o; return n; };
    const tiles = [
      ['OFF', ledMode === 'off', () => setLedMode('off'), false],
      ['CLIPS', (ledMode === 'clips' && !led.img) || (ledMode === 'retro' && ledFx.s === 'loop'), () => (nOf('video') ? setLedMode('clips', 'video') : showLoop(grab.loops[0])), !nOf('video') && !grab.loops.length],
      ['PICTURES', ledMode === 'clips' && !!led.img, () => setLedMode('clips', 'image'), !nOf('image')],
      ['MANDEL', ledMode === 'mandel', () => setLedMode('mandel'), false],
      ['RETRO-SCENE', ledMode === 'retro' || ledMode === 'vdancer' || ledMode === 'meta', () => { if (!isFxMode(ledMode) || ledMode === 'mandel') setLedMode('retro'); setTools('retro'); }, false],
      ['DirroDj📹', ledMode === 'cam', () => setLedMode('cam'), !djcam || !pieceOn('ledwall')],
      ['LIVE', isLive(ledMode), () => setLedMode('live'), !livePossible() || !pieceOn('ledwall')]];
    const tile = (x, y, w, h, [label, on, act, dim]) => {
      if (label !== 'RETRO-SCENE') { btn(x, y, w, h, label, on, dim ? null : act, dim, P ? 19 : 17); return; }
      btn(x, y, w, h, '', on, act, false);
      const s = Math.min(h - 28, w - 16); if (retroIcon.complete && retroIcon.naturalWidth) g.drawImage(retroIcon, x + (w - s) / 2, y + 5, s, s);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = on ? '#fff' : '#3a4252'; g.font = '800 13px system-ui'; g.fillText('RETRO-SCENE', x + w / 2, y + h - 12);
      g.font = '700 12px system-ui'; g.textAlign = 'right'; g.textBaseline = 'top'; g.fillText('+1', x + w - 4, y + 3); g.textBaseline = 'alphabetic';   // #442 opens the RETRO-SCENE page
    };
    const grabLbl = grab.on ? (grab.n < 0 ? 'CAMERA…' : `GRABBING ${Math.max(0, Math.ceil((LOOP.n - grab.n) / LOOP.fps))} s`) : 'GRAB LOOP' + (grab.loops.length ? ` (${grab.loops.length})` : '');
    const acts = [[grabLbl, grab.on, grabLoop, false], ['AUTO: ' + (ledFx.auto ? ledFx.auto + ' BARS' : 'OFF'), !!ledFx.auto, () => setWallAuto(cyc([0, 16, 32], ledFx.auto, 1)), false],
      [d ? 'PHONES: ' + WALL_LABEL[LK.src] : 'PHONES', !!d && LK.src === 'follow', d ? () => d.setWall('src', cyc(WALL_SRC, LK.src, 1)) : null, !d]];
    const stp = (x, y, w, h, label, val, dn, up) => {
      btn(x, y, 40, h, '−', false, () => { dn(); drawMixScreen(); }); btn(x + w - 40, y, 40, h, '+', false, () => { up(); drawMixScreen(); });
      g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#8c96a8'; g.font = '700 12px system-ui'; g.fillText(label, x + w / 2, y + 14);
      g.fillStyle = '#fff'; g.font = '700 17px system-ui'; g.fillText(val, x + w / 2, y + h - 7);
    };
    const steps = d ? [
      ['LED GRID', LK.cols ? `${LK.cols} across` : 'OFF', () => d.setWall('cols', cyc(WALL_COLS, LK.cols, -1)), () => d.setWall('cols', cyc(WALL_COLS, LK.cols, 1))],
      ['LED DOT', `${Math.round(LK.fill * 100)} %`, () => d.setWall('fill', Math.max(0.4, Math.round((LK.fill - 0.05) * 100) / 100)), () => d.setWall('fill', Math.min(1, Math.round((LK.fill + 0.05) * 100) / 100))],
      ['LED GLOW', `${LK.glow.toFixed(1)}x`, () => d.setWall('glow', Math.max(0.5, Math.round((LK.glow - 0.1) * 10) / 10)), () => d.setWall('glow', Math.min(2, Math.round((LK.glow + 0.1) * 10) / 10))]] : [];
    const info = `Showing ${LED_LABEL[ledMode].replace('LED ', '')}${ledMode === 'retro' && ledFx.s === 'loop' ? ' (loop)' : ''}. The same picture is the stream's and DIRROTV's VIDEOWALL${d && d.on ? ', and the phones on FOLLOW' : ''}. PIXELS sets the picture size and the LED grid together (MANDEL keeps its own). TAP BPM: tap the beat in; a long press hands it back to the music.`;
    if (P) {
      const tw = (R - L - 6) / 2, th = 66;
      tiles.forEach((t, i) => tile(L + (i % 2) * (tw + 6), y0 + 2 + Math.floor(i / 2) * (th + 6), tw, th, t));
      const [al, ao, aa] = acts[1]; btn(L + tw + 6, y0 + 2 + 3 * (th + 6), tw, th, al, ao, aa, false, 17);
      let y = y0 + 2 + 4 * (th + 6) + 4;
      btn(L, y, R - L, 54, acts[0][0], acts[0][1], acts[0][2], false, 22); y += 60;
      btn(L, y, tw, 44, acts[2][0], acts[2][1], acts[2][2], acts[2][3], 16); tapB(L + tw + 6, y, tw, 44, 18); y += 52;
      steps.forEach(([l, v, dn, up]) => { stp(L, y, R - L, 40, l, v, dn, up); y += 46; });
      pxSlider(L, y, R - L, 38); y += 44;
      note(info, y + 14);
    } else {
      const tw = (R - L - 6 * 6) / 7, th = 80;
      tiles.forEach((t, i) => tile(L + i * (tw + 6), y0 + 2, tw, th, t));
      const aw = (R - L - 12) / 3, a4 = (R - L - 18) / 4;
      acts.forEach(([l, on, a, dim], i) => btn(L + i * (a4 + 6), y0 + 88, a4, 38, l, on, dim ? null : a, dim, 16)); tapB(L + 3 * (a4 + 6), y0 + 88, a4, 38, 16);
      steps.forEach(([l, v, dn, up], i) => stp(L + i * (aw + 6), y0 + 132, aw, 38, l, v, dn, up));
      pxSlider(L, y0 + 176, R - L, 32);
      g.fillStyle = '#8c96a8'; g.font = '500 13px system-ui'; g.textAlign = 'left'; wrapText(g, info, L + 4, y0 + 226, R - L - 8, 16, 2);
    }
    return;
  }
  if (page === 'tv') {   // #376 CLY3DTV: the venue screen (venue.html). The TV shows a 6-digit code, it is typed here; then switches, sound, status
    const y0 = head('DIRROTV', 'stream', streamer ? { label: P ? 'S8 ▸' : 'S8 STUDIO ▸', on: false, act: () => setTools('studio') } : null), S = streamer;   // #380
    if (!S) { note('DIRROTV runs on the headset (not on the phone).', y0 + 20); return; }
    const st = S.tvState(), gap = 8, bh = P ? 56 : 40, T = S.tvSet;
    const title = { unpaired: 'No TV paired yet', pairing: 'Looking for the TV...', waiting: 'Paired, waiting for the TV', up: 'TV connected', off: 'TV is switched off' }[st];
    g.textAlign = 'left'; g.font = `700 ${P ? 22 : 20}px system-ui`; g.fillStyle = st === 'up' ? '#7dff9a' : '#dfe6f2'; g.fillText(title, L + 2, y0 + 22);
    g.font = '500 14px system-ui'; g.fillStyle = '#8c96a8';
    const sub = st === 'up' ? `${S.tvKbps ? (S.tvKbps / 1000).toFixed(1) + ' Mbit/s' : 'starting'}${S.tvFps ? ' · ' + S.tvFps + ' fps' : ''} · sound ${T.audio ? 'on' : 'off'}${S.live ? '' : ' · the shot runs off air for the screen'}` : (S.tvMsg || '');
    const nl = sub ? wrapText(g, sub, L + 2, y0 + 44, R - L - 4, 18, 2) : 0, yb = y0 + 48 + Math.max(1, nl) * 18 + 4;
    if (!P && (st === 'unpaired' || st === 'pairing')) {   // #378 landscape is 768 x 304: the keypad goes to the right, so PAIR is not pushed off the bottom
      const wl = 330, kx = L + wl + 16, kwid = R - kx, ready = tvDigits.length === 6 && st !== 'pairing';
      g.fillStyle = '#dfe6f2'; g.font = '500 14px system-ui';
      const n2 = wrapText(g, 'On the TV open dirrodj.club/tv (DirroTV). It shows a 6-digit code: type it on the keypad.', L + 2, yb + 14, wl - 4, 18, 2), yk = yb + n2 * 18 + 10, bwd = (wl - 30) / 6;
      for (let i = 0; i < 6; i++) {
        const x = L + i * (bwd + 6); g.fillStyle = '#10151f'; g.fillRect(x, yk, bwd, 38); g.strokeStyle = tvDigits[i] ? '#39a8ff' : '#2a3142'; g.lineWidth = 2; g.strokeRect(x + 1, yk + 1, bwd - 2, 36);
        if (tvDigits[i]) { g.fillStyle = '#ffffff'; g.font = '700 24px system-ui'; g.textAlign = 'center'; g.fillText(tvDigits[i], x + bwd / 2, yk + 27); }
      }
      g.textAlign = 'left';
      btn(L, yk + 38 + 8, wl, 44, st === 'pairing' ? 'LOOKING FOR THE TV...' : 'PAIR', ready,
        ready ? async () => { const ok = await S.tvPair(tvDigits); if (ok) tvDigits = ''; drawMixScreen(); } : null, !ready, 18);
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLEAR', '0', 'DEL'], kw = (kwid - 2 * gap) / 3, kh = Math.min(46, (H - 8 - (y0 + 4) - 3 * gap) / 4);
      keys.forEach((k, i) => btn(kx + (i % 3) * (kw + gap), y0 + 4 + Math.floor(i / 3) * (kh + gap), kw, kh, k, false,
        () => { if (k === 'DEL') tvDigits = tvDigits.slice(0, -1); else if (k === 'CLEAR') tvDigits = ''; else if (tvDigits.length < 6) tvDigits += k; drawMixScreen(); }, st === 'pairing', 17));
      return;
    }
    if (st === 'unpaired' || st === 'pairing') {
      g.fillStyle = '#dfe6f2'; g.font = '500 14px system-ui';
      const n2 = wrapText(g, 'On the TV open dirrodj.club/tv (DirroTV). It shows a 6-digit code: type it here.', L + 2, yb + 14, R - L - 4, 18, 2), yk = yb + n2 * 18 + 12;
      const bwd = Math.min(54, (R - L - 30) / 6), bx = L + ((R - L) - (6 * bwd + 30)) / 2;
      for (let i = 0; i < 6; i++) {
        const x = bx + i * (bwd + 6); g.fillStyle = '#10151f'; g.fillRect(x, yk, bwd, 44); g.strokeStyle = tvDigits[i] ? '#39a8ff' : '#2a3142'; g.lineWidth = 2; g.strokeRect(x + 1, yk + 1, bwd - 2, 42);
        if (tvDigits[i]) { g.fillStyle = '#ffffff'; g.font = '700 26px system-ui'; g.textAlign = 'center'; g.fillText(tvDigits[i], x + bwd / 2, yk + 31); }
      }
      g.textAlign = 'left';
      const keys = P ? ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLEAR', '0', 'DEL'] : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'DEL', 'CLEAR'], cols = P ? 3 : 6, kw = (R - L - (cols - 1) * gap) / cols, kh = P ? 54 : 36, ky = yk + 44 + 10;
      keys.forEach((k, i) => btn(L + (i % cols) * (kw + gap), ky + Math.floor(i / cols) * (kh + gap), kw, kh, k, false,
        () => { if (k === 'DEL') tvDigits = tvDigits.slice(0, -1); else if (k === 'CLEAR') tvDigits = ''; else if (tvDigits.length < 6) tvDigits += k; drawMixScreen(); }, st === 'pairing', P ? 20 : 16));
      const py = ky + Math.ceil(keys.length / cols) * (kh + gap);
      btn(L, py, R - L, P ? 56 : 40, st === 'pairing' ? 'LOOKING FOR THE TV...' : 'PAIR', tvDigits.length === 6 && st !== 'pairing',
        tvDigits.length === 6 && st !== 'pairing' ? async () => { const ok = await S.tvPair(tvDigits); if (ok) tvDigits = ''; drawMixScreen(); } : null, tvDigits.length !== 6 || st === 'pairing', P ? 20 : 17);
      return;
    }
    // paired: the switches
    const armed = tvForgetArm > 0 && performance.now() - tvForgetArm < 3000, n3 = P ? 1 : 3, bw3 = (R - L - (n3 - 1) * gap) / n3, row = i => ({ x: L + (P ? 0 : i) * (bw3 + gap), y: yb + 6 + (P ? i : 0) * (bh + gap) });
    [[T.on ? 'TV: ON' : 'TV: OFF', T.on, () => S.setTv('on', !T.on)],
     [T.audio ? 'SOUND TO TV: ON' : 'SOUND TO TV: OFF', T.audio, () => S.setTv('audio', !T.audio)],
     [armed ? 'TAP AGAIN TO FORGET' : 'FORGET TV', armed, () => { if (armed) { tvForgetArm = 0; S.tvForget(); } else tvForgetArm = performance.now(); drawMixScreen(); }]]
      .forEach(([lb, on, act], i) => { const p = row(i); btn(p.x, p.y, bw3, bh, lb, on, act, false, P ? 18 : 15); });
    note('The TV shows what goes to Twitch (SHOWTIME!, CARD...), or the same picture off air. It shows a small SOUND button only while SOUND TO TV is on: press OK on its remote once to unmute. If the TV is in the same room as the PA, switch the sound off (it would echo). TV OFF closes the link; the TV keeps waiting.', row(0).y + (P ? 3 * (bh + gap) : bh + gap) + 14);
    return;
  }
  if (page === 'portals') {   // #346 PORTALS SETUP: the real-world windows, the wall they cut, the sky dome behind it
    const y0 = head(P ? 'PORTALS' : 'PORTALS SETUP', 'vj'), WL = facetWall, PS = portals;
    if (!WL || !PS) { note('Portals run on the headset (not on the phone).', y0 + 20); return; }
    const defArm = performance.now() - portalDefArm < 3000;
    const toggles = [
      [PS.on ? 'PORTALS: ON' : 'PORTALS', PS.on, portalsTap],
      [WL.on ? 'WALL: ON' : 'WALL', WL.on, wallTap],
      [WL.mode === 'screen' ? 'SCREEN' : 'FRACTAL', false, () => { WL.toggleMode(); drawMixScreen(); }],
      [WL.beat ? 'BEAT: ON' : 'BEAT', WL.beat, () => { WL.setBeat(!WL.beat); drawMixScreen(); }],
      [dome.on ? 'DOME: ON' : 'DOME', dome.on, () => setDome(!dome.on)],
      [defArm ? 'TAP AGAIN' : 'DEFAULTS', defArm, portalDefaults],
    ];
    const cells = [
      ['PORTALS', `${PS.n}`, d => { PS.setCount(PS.n + d); if (!PS.on) PS.setOn(true); }],
      ['WRAP', `${WL.val('arc')}°`, d => WL.step('arc', d)],
      ['HEIGHT', `${WL.val('h').toFixed(2)} m`, d => WL.step('h', d)],
      ['DISTANCE', `${WL.val('r').toFixed(2)} m`, d => WL.step('r', d)],
      ['DOME SIZE', `${dome.r} m`, d => setDomeSize(dome.r + d)],
      ['DOME EXPOSURE', `${dome.ev > 0 ? '+' : ''}${dome.ev.toFixed(2)} EV`, d => setDomeEv(dome.ev + d * 0.25)],   // #404 tame blown-out panos
      ['FRACTAL SPEED', `${WL.val('speed')}x`, d => WL.step('speed', d)],
      ['COLOUR CYCLE', `${WL.val('cycle')}x`, d => WL.step('cycle', d)],
    ];
    const cell = ([label, val, act], x, y, w, h) => {
      g.fillStyle = '#8c96a8'; g.font = '700 12px system-ui'; g.textAlign = 'left'; g.fillText(label, x + 2, y + 11);
      const by = y + 15, bh = h - 15, bw = 40;
      btn(x, by, bw, bh, '−', false, () => { act(-1); drawMixScreen(); });
      let fs = 17; g.font = `700 ${fs}px system-ui`; while (fs > 11 && g.measureText(val).width > w - 2 * bw - 6) g.font = `700 ${--fs}px system-ui`;
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(val, x + w / 2, by + bh / 2); g.textBaseline = 'alphabetic';
      btn(x + w - bw, by, bw, bh, '+', false, () => { act(1); drawMixScreen(); });
    };
    const warn = dome.on && !skybox.tex ? 'DOME: no sky picked yet. On VISUALS > PANO pick a panorama or video pano and tap SKY.' : '';
    const help = 'Frames: grip to move; trigger / pinch the silver side handle = width, top handle = height, corner L = both. Double-tap PORTALS or WALL = back to the start. DOME = the VISUALS sky, also in passthrough; the portals cut through the wall and the dome.';
    const text = (x, y, w, lh, max, fs) => {
      g.textAlign = 'left'; g.font = `500 ${fs}px system-ui`; let n = 0;
      if (warn) { g.fillStyle = '#f1b650'; n = wrapText(g, warn, x, y, w, lh, 2); }
      g.fillStyle = '#8c96a8'; wrapText(g, help, x, y + n * lh, w, lh, max - n);
    };
    if (P) {
      const tw = (R - L - 8) / 2;
      toggles.forEach(([lb, on, act], i) => btn(L + (i % 2) * (tw + 8), y0 + Math.floor(i / 2) * 52, tw, 46, lb, on, act, false, 17));
      const y1 = y0 + 3 * 52 + 6;
      cells.forEach((c, i) => cell(c, L + (i % 2) * (tw + 8), y1 + Math.floor(i / 2) * 60, tw, 56));
      tSlider(g, L, y1 + 4 * 60, R - L, 56, 'DOME TURN', dome.turn / 359, dome.turn + '°', v => setDomeTurn(v * 359), !dome.on);   // #389 (#404 own row)
      text(L + 4, y1 + 5 * 60 + 18, R - L - 8, 20, 8, 15);
    } else {
      const tw = (R - L - 30) / 6;
      toggles.forEach(([lb, on, act], i) => btn(L + i * (tw + 6), y0, tw, 40, lb, on, act, false, 15));
      const cw = (R - L - 24) / 4, y1 = y0 + 48;
      cells.forEach((c, i) => cell(c, L + (i % 4) * (cw + 8), y1 + Math.floor(i / 4) * 48, cw, 44));
      tSlider(g, L, y1 + 2 * 48, 2 * cw + 8, 40, 'DOME TURN', dome.turn / 359, dome.turn + '°', v => setDomeTurn(v * 359), !dome.on);   // #389 (#404 third row)
      text(L + 2 * cw + 24, y1 + 2 * 48 + 12, R - L - 2 * cw - 28, 15, 3, 12);
    }
    return;
  }
  if (page === 'streamfit') {   // #333 line the gear up with the headset camera picture (HEADSET CAM source)
    const y0 = head(P ? 'CAM FIT' : 'CAM FIT · HEADSET CAM', 'vj'), S = streamer; if (!S) return;
    const F = S.fit, run = S.running && S.source === 'headset' && (S.testing || F.gear);
    const pw = P ? R - L : 228, ph = Math.round(pw * (S.canvas.height / S.canvas.width || 0.75));
    g.fillStyle = '#000'; g.fillRect(L, y0, pw, ph);
    if (run && S.mrFrames) g.drawImage(S.canvas, L, y0, pw, ph);
    else { g.fillStyle = '#8c96a8'; g.font = '600 15px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(S.source !== 'headset' ? 'Pick HEADSET CAM on STREAM' : !F.gear ? 'GEAR OFF: raw camera' : 'Press TEST to see it', L + pw / 2, y0 + ph / 2); g.textBaseline = 'alphabetic'; }
    if (camCal.on) {   // #415 the crosshair to put the controller tip on
      const t = CAL_TARGETS[Math.min(camCal.k, CAL_TARGETS.length - 1)], cx = L + t[0] * pw, cy = y0 + t[1] * ph;
      g.strokeStyle = '#000'; g.lineWidth = 5; g.beginPath(); g.moveTo(cx - 16, cy); g.lineTo(cx + 16, cy); g.moveTo(cx, cy - 16); g.lineTo(cx, cy + 16); g.stroke();
      g.strokeStyle = '#ff3030'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 16, cy); g.lineTo(cx + 16, cy); g.moveTo(cx, cy - 16); g.lineTo(cx, cy + 16); g.stroke();
      g.beginPath(); g.arc(cx, cy, 7, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(L, y0, 110, 22); g.fillStyle = '#ff5050'; g.font = '700 14px system-ui'; g.textAlign = 'left'; g.fillText(`${camCal.k + 1}/9  ${t[2] === 'near' ? 'CLOSE' : 'ARM OUT'}`, L + 6, y0 + 16);
    }
    const aBtn = (x, y, w, h) => btn(x, y, w, h, camCal.on ? `CANCEL ${camCal.k}/9` : 'AUTO FIT', camCal.on, () => { if (camCal.on) camCalStop('AUTO FIT cancelled.'); else camCalStart(); }, false, 18);
    const uBtn = (x, y, w, h) => btn(x, y, w, h, 'UNDO', false, camCal.on && camCal.k > 0 ? () => { camCal.k--; camCal.samples.pop(); drawMixScreen(); } : null, !(camCal.on && camCal.k > 0), 16);
    const calText = camCal.on ? `Hold a controller so its FRONT TIP sits on the red cross in the picture (${(CAL_TARGETS[camCal.k] || CAL_TARGETS[0])[2] === 'near' ? 'close, about 30 cm' : 'arm out'}), keep still, pull the trigger.`
      : camCal.msg || 'AUTO FIT: line a controller tip up with 9 crosses on the picture; it works out where the camera sits and how wide it sees.';
    const rows = [['x', 'LEFT / RIGHT', 'mm', 5], ['y', 'DOWN / UP', 'mm', 5], ['z', 'FWD / BACK', 'mm', 5], ['hfov', 'ZOOM (FOV)', '°', 0.5],
      ['tilt', 'TILT', '°', 0.5], ['turn', 'TURN', '°', 0.5], ['roll', 'ROLL', '°', 0.5], ['lag', 'LAG', 'ms', 5]];
    const cell = (k, label, unit, step, x, y, w, h) => {
      g.fillStyle = '#8c96a8'; g.font = '700 12px system-ui'; g.textAlign = 'left'; g.fillText(label, x + 2, y + 11);
      const by = y + 15, bh = h - 15, bw = 40, v = F[k];
      btn(x, by, bw, bh, '−', false, () => S.setFit(k, Math.round((v - step) * 10) / 10));
      g.fillStyle = '#fff'; g.font = '700 17px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`${v}${unit}`, x + w / 2, by + bh / 2); g.textBaseline = 'alphabetic';
      btn(x + w - bw, by, bw, bh, '+', false, () => S.setFit(k, Math.round((v + step) * 10) / 10));
    };
    const tBtn = (x, y, w, h) => btn(x, y, w, h, S.testing ? 'TEST: ON' : 'TEST', S.testing, () => S.setTesting(!S.testing), false, 18);
    const gBtn = (x, y, w, h) => btn(x, y, w, h, F.gear ? 'GEAR: ON' : 'GEAR: OFF', F.gear, () => S.setFit('gear', !F.gear), false, 18);
    const rBtn = (x, y, w, h) => btn(x, y, w, h, 'RESET', false, () => S.resetFit(), false, 18);
    if (P) {
      const y1 = y0 + ph + 8, cw = (R - L - 8) / 2;
      rows.forEach((r, i) => cell(...r, L + (i % 2) * (cw + 8), y1 + Math.floor(i / 2) * 58, cw, 54));
      const yb = y1 + 4 * 58 + 6, bw = (R - L - 16) / 3; tBtn(L, yb, bw, 50); gBtn(L + bw + 8, yb, bw, 50); rBtn(L + 2 * (bw + 8), yb, bw, 50);
      const ya = yb + 58, aw = (R - L - 8) * 0.65; aBtn(L, ya, aw, 50); uBtn(L + aw + 8, ya, R - L - aw - 8, 50);   // #415
      g.fillStyle = camCal.on ? '#fff' : '#8c96a8'; g.font = '500 15px system-ui'; g.textAlign = 'left'; wrapText(g, calText, L + 4, ya + 72, R - L - 8, 20, 6);
    } else {
      const x1 = L + pw + 10, cw = (R - x1 - 8) / 2;
      rows.forEach((r, i) => cell(...r, x1 + (i % 2) * (cw + 8), y0 + Math.floor(i / 2) * 46, cw, 42));
      const yb = y0 + ph + 8, bw = (pw - 12) / 3; tBtn(L, yb, bw, 40); gBtn(L + bw + 6, yb, bw, 40); rBtn(L + 2 * (bw + 6), yb, bw, 40);
      const ya = y0 + 4 * 46 + 2, aw = (R - x1) * 0.62; aBtn(x1, ya, aw, 30); uBtn(x1 + aw + 6, ya, R - x1 - aw - 6, 30);   // #415
      g.fillStyle = camCal.on ? '#fff' : '#8c96a8'; g.font = '500 12px system-ui'; g.textAlign = 'left'; wrapText(g, calText, x1, ya + 44, R - x1, 14, 2);
    }
    return;
  }
  if (page === 'dj' || page === 'vj') {
    const y0 = head(page === 'dj' ? 'DJ TOOLS' : 'VJ TOOLS', 'home');
    const ledCells = (x, y, w, stacked) => {   // #358 LED CURVE and LED SIZE steppers
      const cells = [['LED CURVE', `${ledwall.userData.curveDeg()}°`, d => setLedCurve(ledwall.userData.curveDeg() + d * 10)],
        ['LED SIZE', `${(LED.W * ledwall.scale.x).toFixed(1)} m wide`, d => { setLedScale(ledwall.scale.x * (d > 0 ? 1.15 : 1 / 1.15)); saveLedScale(); if (stage) stage.save(); }]];
      const cw = stacked ? w : (w - 12) / 2, ch = stacked ? 56 : 52;
      cells.forEach(([label, val, act], i) => {
        const cx = stacked ? x : x + i * (cw + 12), cy = stacked ? y + i * (ch + 8) : y, bw = 52;
        g.fillStyle = '#8c96a8'; g.font = '700 13px system-ui'; g.textAlign = 'left'; g.fillText(label, cx + 2, cy + 12);
        btn(cx, cy + 16, bw, ch - 16, '−', false, () => { act(-1); drawMixScreen(); });
        g.fillStyle = '#fff'; g.font = '700 18px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(val, cx + cw / 2, cy + 16 + (ch - 16) / 2); g.textBaseline = 'alphabetic';
        btn(cx + cw - bw, cy + 16, bw, ch - 16, '+', false, () => { act(1); drawMixScreen(); });
      });
    };
    // #235 switches for stage pieces (off = hidden and no per-frame work), green = on
    // #276 controllers seen as 3D hands holding them, or bare controllers
    const ctlBtn = (x, y, w, h) => { let X = null; try { X = xr; } catch (e) {}   // xr is set up further down the file
      const cur = X ? X.getCtlLook() : '3dhands', NEXT = { '3dhands': 'glove', glove: 'controller', controller: '3dhands' };   // #287 three looks, tap to cycle
      btn(x, y, w, h, `CONTROLLERS: ${{ '3dhands': '3D HANDS', glove: 'GLOVE', controller: 'CONTROLLER' }[cur]}`, cur !== 'controller', () => { if (X) X.setCtlLook(NEXT[cur]); const el = document.getElementById('sHands'); if (el && X) el.value = X.getCtlLook(); drawMixScreen(); }, false, P ? 18 : 20); };
    const avBtn = (x, y, w, h) => btn(x, y, w, h, `AVATAR: ${djSet.avatar ? 'ON' : 'OFF'}`, djSet.avatar, () => setDjAvatar(!djSet.avatar), false, P ? 18 : 20);   // #363 the robot DJ (AVACAM / SHOWTIME!) on / off
    const sw = (x, y, w, h, label, k) => { const on = pieceOn(k); btn(x, y, w, h, `${label}: ${on ? 'ON' : 'OFF'}`, on, () => setPiece(k, !on), false, P ? 18 : 20); };
    // #389 VJ TOOLS is now the home of the stage extras: 12 buttons in a grid and the LED steppers under them
    const vjPage = y0 => {
      const fs = P ? 19 : 16, tile = (x, y, w, h, i) => [
        () => btn(x, y, w, h, scroller.on ? 'SCROLLER (ON)' : 'SCROLLER', scroller.on, () => setTools('scroller'), false, fs),
        () => btn(x, y, w, h, 'VISUALS', false, () => setVideoPage(true), false, fs),
        () => btn(x, y, w, h, 'FX', false, openFxPage, false, fs),   // #390 the FX tab of VISUALS
        () => sw(x, y, w, h, 'LED WALL', 'ledwall'),
        () => sw(x, y, w, h, 'NEON', 'neon'),
        () => avBtn(x, y, w, h),
        () => btn(x, y, w, h, chalkLbl(), !!(chalkboard && chalkboard.on), chalkTap, !chalkboard, fs),   // tap = out / away, double-tap = back to its spot
        () => btn(x, y, w, h, portals && portals.on ? 'PORTALS: ON' : 'PORTALS', !!(portals && portals.on), portalsTap, !portals, fs),
        () => btn(x, y, w, h, 'PORTALS SETUP', false, portals ? () => setTools('portals') : null, !portals, fs),
        () => btn(x, y, w, h, ledMode === 'cam' ? 'LED DirroDj📹: ON' : 'LED DirroDj📹', ledMode === 'cam', () => setLedMode(ledMode === 'cam' ? 'off' : 'cam'), false, fs),
        () => btn(x, y, w, h, 'CAM FIT', false, () => setTools('streamfit'), !streamer, fs),
        () => btn(x, y, w, h, 'PHONE CAM', !!(streamer && streamer.source === 'pcam'), openPhoneCam, !streamer, fs),
        () => btn(x, y, w, h, perf.on ? `PERFCAP ● ${fmt((Date.now() - perf.P.wall) / 1000)}` : 'PERFCAP', perf.on, () => setTools('perfcap'), false, fs),
        () => btn(x, y, w, h, laser && laser.on ? 'LASER: ON' : 'LASER', !!(laser && laser.on), () => setTools('laser'), !laser, fs),   // #406
        () => btn(x, y, w, h, settings.occlusion !== false ? 'REAL OCCLUSION: ON' : 'REAL OCCLUSION: OFF', settings.occlusion !== false, () => { settings.occlusion = settings.occlusion === false; saveSettings(); const c = document.getElementById('cOccl'); if (c) c.checked = settings.occlusion; drawMixScreen(); }, false, fs)][i]();   // #411 passthrough: real things hide virtual ones
      const NT = 15, cols = P ? 2 : 5, gap = P ? 8 : 6, bh = P ? 58 : 50, bw = (R - L - gap * (cols - 1)) / cols;   // #390 13 buttons: 5 across in landscape (#406 14 with LASER)
      for (let i = 0; i < NT; i++) tile(L + (i % cols) * (bw + gap), y0 + 4 + Math.floor(i / cols) * (bh + gap), bw, bh, i);
      ledCells(L, y0 + 4 + Math.ceil(NT / cols) * (bh + gap) + 4, R - L, P);
    };
    if (P) {
      if (page === 'dj') { const lw = (R - L - 8) * 0.42; btn(L, y0 + 8, R - L - lw - 8, 80, 'RECORD MAKER', false, () => setTools('maker'), false, 22); drawLoopMainBtn(g, R - lw, y0 + 8, lw, 80, 22); VP_HIT.push({ x: R - lw, y: y0 + 8, w: lw, h: 80, act: () => setTools('looper') }); sw(L, y0 + 100, R - L, 64, 'MILK CRATE', 'milk');   // #470 LOOPER
        ctlBtn(L, y0 + 176, (R - L - 8) * 0.62, 64); btn(L + (R - L - 8) * 0.62 + 8, y0 + 176, (R - L - 8) * 0.38, 64, 'HAND FIT', false, () => setTools('handfit'), false, 18);   // #291
        lockBtn(L, y0 + 252, (R - L - 8) * 0.55, 64); btn(L + (R - L - 8) * 0.55 + 8, y0 + 252, (R - L - 8) * 0.45, 64, 'TURNTABLE FEEL', false, () => setTools('feel'), false, 17);   // #378, #423
        note('GEAR LOCKDOWN is on at every start: decks and mixer can not be moved or turned until you switch it off (then decks turn in 45 degree steps). RECORD MAKER: press your own record. MILK CRATE: the first milk crate. CONTROLLERS: 3D hands holding them, or the bare controllers.', y0 + 332); }
      else vjPage(y0);   // #389
    } else {
      const bw = 300, x2 = L + bw + 12, w2 = R - x2;
      if (page === 'dj') { const mw = 236, lw = 170; btn(L, y0 + 8, mw, 80, 'RECORD MAKER', false, () => setTools('maker'), false, 22); drawLoopMainBtn(g, L + mw + 8, y0 + 8, lw, 80, 22); VP_HIT.push({ x: L + mw + 8, y: y0 + 8, w: lw, h: 80, act: () => setTools('looper') }); sw(L + mw + lw + 16, y0 + 8, R - (L + mw + lw + 16), 80, 'MILK CRATE', 'milk');   // #470 LOOPER
        ctlBtn(L, y0 + 96, (R - L - 8) * 0.66, 50); btn(L + (R - L - 8) * 0.66 + 8, y0 + 96, (R - L - 8) * 0.34, 50, 'HAND FIT', false, () => setTools('handfit'), false, 20);   // #291
        lockBtn(L, y0 + 154, (R - L - 8) * 0.62, 46); btn(L + (R - L - 8) * 0.62 + 8, y0 + 154, (R - L - 8) * 0.38, 46, 'TURNTABLE FEEL', false, () => setTools('feel'), false, 18);   // #378, #423
        note('GEAR LOCKDOWN is on at every start: decks and mixer can not be moved or turned until it is switched off. RECORD MAKER: press your own record. CONTROLLERS: 3D hands or bare controllers.', y0 + 218); }
      else vjPage(y0);   // #389
    }
    return;
  }
  if (page === 'laser') {   // #406 LASER; #407 drawn as a Workbench 3.1 screen (Amiga nostalgia): grey screen, white title bar, bevelled gadgets, blue active title bar, chunky bitmap font, a scope-style vector preview
    const LZ = laser, WB = { grey: '#aaaaaa', blk: '#000000', wht: '#ffffff', blue: '#6688bb', dark: '#555555' };
    const fit = (s, w, max = 2) => { const u = bitWidth(s, 1); return Math.max(1, Math.min(max, Math.floor(((w - 10) / u) * 4) / 4)); };
    const txt = (s, x, y, px, col) => drawBitText(g, s, Math.round(x), Math.round(y), px, col, px >= 1.5);
    const bevel = (x, y, w, h, up) => {   // the 2.0 / 3.1 look: light top-left, dark bottom-right (swapped when pressed in)
      g.fillStyle = up ? WB.wht : WB.blk; g.fillRect(x, y, w, 2); g.fillRect(x, y, 2, h);
      g.fillStyle = up ? WB.blk : WB.wht; g.fillRect(x, y + h - 2, w, 2); g.fillRect(x + w - 2, y, 2, h);
    };
    const gad = (x, y, w, h, label, sel, act, dim, max = 2) => {
      g.fillStyle = sel ? WB.blue : WB.grey; g.fillRect(x, y, w, h); bevel(x, y, w, h, !sel);
      const s = cleanText(label), px = fit(s, w, max), tw = bitWidth(s, px);
      txt(s, x + (w - tw) / 2, y + (h - 7 * px) / 2 + (sel ? 1 : 0), px, dim ? WB.dark : sel ? WB.wht : WB.blk);
      if (act) VP_HIT.push({ x, y, w, h, act });
    };
    const groupBox = (x, y, w, h, title) => {   // etched frame with its title on the line
      g.fillStyle = WB.blk; g.fillRect(x, y, w, 1); g.fillRect(x, y, 1, h); g.fillStyle = WB.wht; g.fillRect(x + 1, y + 1, w - 1, 1); g.fillRect(x + 1, y + 1, 1, h - 1);
      g.fillStyle = WB.blk; g.fillRect(x, y + h - 1, w, 1); g.fillRect(x + w - 1, y, 1, h); g.fillStyle = WB.wht; g.fillRect(x, y + h, w + 1, 1); g.fillRect(x + w, y, 1, h + 1);
      if (title) { const s = cleanText(title), tw = bitWidth(s, 1.25); g.fillStyle = WB.grey; g.fillRect(x + 8, y - 5, tw + 8, 10); txt(s, x + 12, y - 4, 1.25, WB.blk); }
    };
    const arrow = (x, y, w, h, dir, act) => {   // integer-gadget arrows
      gad(x, y, w, h, '', false, act); g.fillStyle = WB.blk; g.beginPath();
      const cx = x + w / 2, cy = y + h / 2, a = Math.min(w, h) * 0.22;
      if (dir < 0) { g.moveTo(cx + a * 0.7, cy - a); g.lineTo(cx - a * 0.7, cy); g.lineTo(cx + a * 0.7, cy + a); } else { g.moveTo(cx - a * 0.7, cy - a); g.lineTo(cx + a * 0.7, cy); g.lineTo(cx - a * 0.7, cy + a); }
      g.fill();
    };
    const stepper = ([label, val, k], x, y, w, h) => {
      txt(cleanText(label), x + 2, y, 1.5, WB.blk);
      const by = y + 14, bh = h - 14, aw = Math.min(40, w * 0.28);
      arrow(x, by, aw, bh, -1, LZ ? () => { LZ.step(k, -1); drawMixScreen(); } : null);
      g.fillStyle = WB.grey; g.fillRect(x + aw + 3, by, w - 2 * aw - 6, bh); bevel(x + aw + 3, by, w - 2 * aw - 6, bh, false);
      const s = cleanText(val), px = fit(s, w - 2 * aw - 6), tw = bitWidth(s, px); txt(s, x + aw + 3 + (w - 2 * aw - 6 - tw) / 2, by + (bh - 7 * px) / 2, px, WB.blk);
      arrow(x + w - aw, by, aw, bh, 1, LZ ? () => { LZ.step(k, 1); drawMixScreen(); } : null);
    };
    const swatch = (c, x, y, w, h, sel, act) => {   // palette-requester style colour boxes
      g.fillStyle = WB.grey; g.fillRect(x, y, w, h); bevel(x, y, w, h, !sel);
      const ix = x + 5, iy = y + 5, iw = w - 10, ih = h - 10;
      if (LASER_COLS[c]) { g.fillStyle = `rgb(${LASER_COLS[c].map(a => Math.round(Math.min(1, a) * 255)).join(',')})`; }
      else { const gr = g.createLinearGradient(ix, 0, ix + iw, 0); ['#f00', '#ff0', '#0f0', '#0ff', '#00f', '#f0f'].forEach((s, i) => gr.addColorStop(i / 5, s)); g.fillStyle = gr; }
      g.fillRect(ix, iy, iw, ih);
      if (sel) { g.strokeStyle = WB.blk; g.lineWidth = 2; g.strokeRect(ix - 1, iy - 1, iw + 2, ih + 2); g.strokeStyle = WB.wht; g.lineWidth = 1; g.strokeRect(ix + 1.5, iy + 1.5, iw - 3, ih - 3); }
      VP_HIT.push({ x, y, w, h, act });
    };
    const preview = (x, y, w, h) => {   // scope-style XY preview: where each beam lands on a wall in front, phosphor trails
      g.fillStyle = WB.grey; g.fillRect(x - 3, y - 3, w + 6, h + 6); bevel(x - 3, y - 3, w + 6, h + 6, false);
      const pv = laserPv.c.width !== w || laserPv.c.height !== h ? (laserPv.c.width = w, laserPv.c.height = h, laserPv) : laserPv, pg = pv.c.getContext('2d');
      pg.fillStyle = 'rgba(0,0,0,0.35)'; pg.fillRect(0, 0, w, h);
      pg.strokeStyle = 'rgba(40,90,40,0.5)'; pg.lineWidth = 1; pg.beginPath();
      for (let i = 1; i < 8; i++) { pg.moveTo(i * w / 8, 0); pg.lineTo(i * w / 8, h); } for (let i = 1; i < 4; i++) { pg.moveTo(0, i * h / 4); pg.lineTo(w, i * h / 4); } pg.stroke();
      const n = LZ && LZ.on ? LZ.beams.geometry.instanceCount : 0, D = LZ ? LZ.aDir.array : null, C = LZ ? LZ.aCol.array : null, f = w * 0.45, cx = w / 2, cy = h * 0.55;
      for (let i = 0; i < n; i++) {
        const z = -D[i * 3 + 2]; if (z < 0.05) continue;
        const px = cx + D[i * 3] / z * f, py = cy - D[i * 3 + 1] / z * f;
        const col = `rgb(${[0, 1, 2].map(k => Math.round(Math.min(1, C[i * 3 + k] * 1.2) * 255)).join(',')})`;
        pg.strokeStyle = col; pg.lineWidth = 1.5; pg.globalAlpha = 0.55; pg.beginPath(); pg.moveTo(cx, h); pg.lineTo(px, py); pg.stroke();
        pg.globalAlpha = 1; pg.fillStyle = col; pg.beginPath(); pg.arc(px, py, 3.6, 0, Math.PI * 2); pg.fill(); pg.fillStyle = '#fff'; pg.beginPath(); pg.arc(px, py, 1.3, 0, Math.PI * 2); pg.fill();
      }
      pg.globalAlpha = 1; g.drawImage(pv.c, x, y);
      if (!n) txt('LASER OFF', x + (w - bitWidth('LASER OFF', 2)) / 2, y + h / 2 - 7, 2, '#3c8a3c');
    };
    const wrapBit = (s, x, y, w, px, lh, max) => {   // word wrap in the bitmap font
      let line = '', n = 0;
      for (const word of cleanText(s, 999).split(' ')) {
        const t = line ? line + ' ' + word : word;
        if (bitWidth(t, px) > w && line) { txt(line, x, y + n * lh, px, WB.blk); line = word; if (++n >= max) return; } else line = t;
      }
      if (line) txt(line, x, y + n * lh, px, WB.blk);
    };
    // the screen: grey, white screen title bar with the page gadgets on it
    g.fillStyle = WB.grey; g.fillRect(0, 0, W, H);
    const top = P ? 70 : 40;
    g.fillStyle = WB.wht; g.fillRect(0, 0, W, top); g.fillStyle = WB.blk; g.fillRect(0, top - 2, W, 2);
    const up = () => setTools('vj');
    if (P) {
      txt('DIRRODJ WORKBENCH', L, 8, 1.5, WB.blk);
      const bw = (R - L - 12) / 3; gad(L, 26, bw, 38, 'VJ TOOLS', false, up); gad(L + bw + 6, 26, bw, 38, 'PREVIEW', monOn, () => setMonitor(!monOn)); gad(L + 2 * (bw + 6), 26, bw, 38, 'BACK', false, navCan() ? navBack : null, !navCan());
    } else {
      txt('DIRRODJ WORKBENCH  LASER SHOW', L + 2, 13, 2, WB.blk);
      gad(R - 96, 3, 96, 34, 'BACK', false, navCan() ? navBack : null, !navCan()); gad(R - 96 - 6 - 100, 3, 100, 34, 'PREVIEW', monOn, () => setMonitor(!monOn)); gad(R - 202 - 6 - 110, 3, 110, 34, 'VJ TOOLS', false, up);
    }
    if (!LZ) { wrapBit('The laser runs on the headset.', L + 4, top + 20, R - L - 8, 2, 20, 3); return; }
    // the window: black outline, blue active title bar with close and depth gadgets
    const wx = P ? L - 6 : 6, wy = top + 4, ww = (P ? R + 6 : W - 6) - wx, wh = H - wy - (P ? 26 : 4);
    g.fillStyle = WB.grey; g.fillRect(wx, wy, ww, wh); bevel(wx, wy, ww, wh, true);
    g.fillStyle = WB.blue; g.fillRect(wx + 2, wy + 2, ww - 4, 20); bevel(wx + 2, wy + 2, ww - 4, 20, true);
    g.fillStyle = WB.grey; g.fillRect(wx + 4, wy + 4, 18, 16); bevel(wx + 4, wy + 4, 18, 16, true); g.fillStyle = WB.blk; g.fillRect(wx + 11, wy + 10, 4, 4);   // close
    for (const [ox, dk] of [[22, 0], [42, 1]]) { const bx = wx + ww - ox - 2; g.fillStyle = WB.grey; g.fillRect(bx, wy + 4, 18, 16); bevel(bx, wy + 4, 18, 16, true);   // zoom, depth
      g.strokeStyle = WB.blk; g.lineWidth = 1; if (dk) { g.strokeRect(bx + 4.5, wy + 7.5, 7, 6); g.fillStyle = WB.wht; g.fillRect(bx + 8, wy + 11, 6, 5); g.strokeRect(bx + 7.5, wy + 10.5, 7, 6); } else { g.strokeRect(bx + 4.5, wy + 7.5, 9, 9); g.strokeRect(bx + 4.5, wy + 7.5, 4, 4); } }
    txt(P ? 'LASER' : 'LASER  ' + (LZ.on ? 'ON AIR' : 'STANDBY'), wx + 28, wy + 7, 1.5, WB.blk);
    // the gadgets
    const lsrBtn = (x, y, w, h) => gad(x, y, w, h, LZ.on ? 'LASER ON' : 'LASER OFF', LZ.on, laserTap);
    const autoBtn = (x, y, w, h) => gad(x, y, w, h, LZ.auto ? 'AUTO ON' : 'AUTO OFF', LZ.auto, () => { LZ.set('auto', !LZ.auto); drawMixScreen(); });
    const smokeBtn = (x, y, w, h) => gad(x, y, w, h, ({ off: 'NO SMOKE', beams: 'SMOKE', sheets: 'SMOKE+' }[LZ.smoke] || 'NO SMOKE'), LZ.smoke !== 'off', () => { LZ.nextSmoke(); drawMixScreen(); });   // #414 swirly haze
    const roomBtn = (x, y, w, h) => gad(x, y, w, h, settings.roomHits !== false ? 'ROOM ON' : 'ROOM OFF', settings.roomHits !== false, () => { settings.roomHits = settings.roomHits === false; saveSettings(); const c = document.getElementById('cRoomHits'); if (c) c.checked = settings.roomHits; drawMixScreen(); });   // #411 beams stop at walls / ceiling
    const beatLed = (x, y) => { const lit = LZ.on && LZ.auto && performance.now() - LZ.lastBeat < 140; g.fillStyle = WB.grey; g.fillRect(x, y, 20, 14); bevel(x, y, 20, 14, false); g.fillStyle = lit ? '#30ff40' : '#1d4a22'; g.fillRect(x + 3, y + 3, 14, 8); };
    const status = () => !LZ.auto ? 'MANUAL' : performance.now() - LZ.lastBeat > 4000 ? 'NO BEAT' : `BEAT ${LZ.beats}`;
    const pats = LASER_PATS.map(p => [LASER_PL[p], LZ.pat === p, () => { LZ.setPat(p); if (!LZ.on) LZ.setOn(true); drawMixScreen(); }]);
    const colPick = c => () => { LZ.setCol(c); if (!LZ.on) LZ.setOn(true); drawMixScreen(); };
    const cells = [['BEAMS', `${LZ.n}`, 'n'], ['SPREAD', `${LZ.spread}`, 'spread'], ['SPEED', `${LZ.speed}X`, 'speed'], ['HAZE', `${Math.round(LZ.haze * 100)}%`, 'haze'], ['LENGTH', `${LZ.len} M`, 'len'], ['DRIFT', `${LZ.drift}X`, 'drift']];   // #414 DRIFT = how fast the smoke swirls
    const help = 'Grip the head to move it. Double-tap LASER = home. AUTO follows the beat.';
    if (P) {
      const x0 = wx + 10, x1 = wx + ww - 10, cw = x1 - x0; let y = wy + 30;
      preview(x0 + 3, y + 3, cw - 6, 120); y += 132;
      const hw = (cw - 8) / 2, tw3 = (cw - 12) / 3; lsrBtn(x0, y, tw3, 40); autoBtn(x0 + tw3 + 6, y, tw3, 40); roomBtn(x0 + 2 * (tw3 + 6), y, tw3, 40); y += 48;
      beatLed(x0, y + 9); txt(status(), x0 + 26, y + 12, 1.25, WB.blk); smokeBtn(x0 + cw - 130, y, 130, 32); y += 40;
      groupBox(x0, y, cw, 98, 'PATTERN'); const w3 = (cw - 24) / 3;
      pats.forEach(([lb, on, act], i) => gad(x0 + 6 + (i % 3) * (w3 + 6), y + 10 + Math.floor(i / 3) * 42, w3, 38, lb, on, act)); y += 108;
      groupBox(x0, y, cw, 90, 'COLOUR'); const w4 = (cw - 30) / 4;
      Object.keys(LASER_COLS).forEach((c, i) => swatch(c, x0 + 6 + (i % 4) * (w4 + 6), y + 10 + Math.floor(i / 4) * 38, w4, 34, LZ.col === c, colPick(c))); y += 100;
      cells.forEach((c, i) => stepper(c, x0 + (i % 2) * (hw + 8), y + Math.floor(i / 2) * 54, hw, 48)); y += 3 * 54 + 4;
      wrapBit(help, x0, y, cw, 1.25, 12, Math.floor((wy + wh - 6 - y) / 12));
    } else {
      const x0 = wx + 10, pw = 214, px0 = wx + ww - 10 - pw, lw = px0 - 10 - x0; let y = wy + 30;
      preview(px0 + 3, y + 3, pw - 6, 112);
      lsrBtn(x0, y, 96, 32); autoBtn(x0 + 102, y, 88, 32); roomBtn(x0 + 196, y, 88, 32); smokeBtn(x0 + 290, y, 112, 32); beatLed(x0 + 408, y + 9); txt(status(), x0 + 434, y + 12, 1.25, WB.blk); y += 46;
      groupBox(x0, y, lw, 46, 'PATTERN'); const w6 = (lw - 42) / 6;
      pats.forEach(([lb, on, act], i) => gad(x0 + 6 + i * (w6 + 6), y + 9, w6, 32, lb, on, act)); y += 56;
      groupBox(x0, y, lw, 46, 'COLOUR'); const w8 = (lw - 54) / 8;
      Object.keys(LASER_COLS).forEach((c, i) => swatch(c, x0 + 6 + i * (w8 + 6), y + 9, w8, 32, LZ.col === c, colPick(c)));
      y = wy + 30 + 122;
      const sw5 = (ww - 20 - 40) / 6; cells.forEach((c, i) => stepper(c, x0 + i * (sw5 + 8), Math.max(y, wy + 30 + 46 + 56 + 54), sw5, 42));
      wrapBit(help, x0, wy + wh - 16, ww - 20, 1.25, 12, 1);
    }
    return;
  }
  if (page === 'perfcap') {   // #387 PerfCap has its own page (was on the VISUALS > CAMERA tab); VJ TOOLS > PERFCAP
    const y0 = head('PERFCAP', 'vj');
    const marks = !!(spect && spect.perfMarks), n = perf.P.marks.length;
    const recLbl = perf.on ? `■ STOP  ${fmt((Date.now() - perf.P.wall) / 1000)}` : '● PERFCAP';
    const act = [[recLbl, perf.on, () => perfToggle()],
      [`MARKS ${n}`, marks, () => { if (!spect) { perfToggle(); return; } spect.perfMarks = !spect.perfMarks; toast(spect.perfMarks ? 'PerfCap marks: touch each floor mark with the controller tip, pull the trigger' : 'PerfCap marks off', 3500); drawMixScreen(); }],
      ['SAVE TAKE', false, () => perf.download()]];
    if (P) act.forEach(([l, on, a], i) => btn(L, y0 + 8 + i * 92, R - L, 80, l, on, a, false, 24));
    else { const w3 = (R - L - 16) / 3; act.forEach(([l, on, a], i) => btn(L + i * (w3 + 8), y0 + 8, w3, 90, l, on, a, false, 24)); }
    const sy = y0 + (P ? 292 : 122);
    g.fillStyle = perf.on ? '#fff' : '#8c96a8'; g.font = '600 17px system-ui'; g.textAlign = 'left';
    const sz = perf.P.bytes < 1048576 ? Math.round(perf.P.bytes / 1024) + ' KB' : (perf.P.bytes / 1048576).toFixed(1) + ' MB';
    g.fillText(perf.on ? `Recording ${fmt((Date.now() - perf.P.wall) / 1000)} · ${sz}` : spect ? 'Not recording' : 'Needs Settings > Spectator camera On', L + 4, sy);
    note('Records what the gear does during the set, so a video you film on a tripod can be rendered later with the gear drawn in. No phone needs to be connected. 1: MARKS, touch each taped floor mark with a controller tip and pull the trigger. 2: start the camera, then ● PERFCAP, then knock the controller on the table twice. 3: play. 4: knock twice again, stop. 5: SAVE TAKE.', sy + 22);
    return;
  }
  if (page === 'scroller') {
    const y0 = head('SCROLLER', scrollFromVP ? 'visuals' : 'vj');
    g.fillStyle = '#0d1422'; g.fillRect(L, y0, R - L, 52);
    g.save(); g.beginPath(); g.rect(L, y0, R - L, 52); g.clip();
    drawBitText(g, scroller.text || ' ', L + 10, y0 + 13, 4, x => `hsl(${(x * 0.7) % 360},100%,62%)`); g.restore();
    let y = y0 + 62; const bw = P ? (R - L - 6) / 2 : 200;
    btn(L, y, bw, 42, 'EDIT TEXT', false, () => openKbd('SCROLLER TEXT', scroller.text, true, 120, t => { t = cleanText(t, 120); if (t.trim()) scroller.start(t); else scroller.stop(); }, 'scroller'));
    btn(L + bw + 6, y, bw, 42, scroller.on ? 'STOP' : 'START', scroller.on, () => { if (scroller.on) scroller.stop(); else scroller.start(); });
    y += 52;
    for (const [label, k] of [['WAVE', 'wave'], ['SPEED', 'speed']]) {
      g.fillStyle = '#dfe6f2'; g.font = '700 17px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(label, L + 4, y + 20);
      g.textAlign = 'center'; g.fillText(String(scroller[k]), L + 196, y + 20); g.textBaseline = 'alphabetic';
      btn(L + 110, y, 56, 40, '−', false, () => { scroller[k] = Math.max(k === 'speed' ? 1 : 0, scroller[k] - 1); scroller.save(); });
      btn(L + 226, y, 56, 40, '+', false, () => { scroller[k] = Math.min(10, scroller[k] + 1); scroller.save(); });
      y += 46;
    }
    if (!P) note('ENTER on the keyboard starts it at the bottom of the LED wall, over whatever is playing.', y + 14);
    return;
  }
  if (page === 'kbd') {
    const y0 = head(kbd.title, kbd.back, { label: 'MIC / KEYS', on: sysKbPending, act: sysKbTap });   // #387 the headset keyboard + dictation
    g.fillStyle = '#0d1422'; g.fillRect(L, y0, R - L, 44);
    g.save(); g.beginPath(); g.rect(L, y0, R - L, 44); g.clip();
    {   // #432 (owner) the typed text always in a plain font (was the pixel font; #431 switched only for missing glyphs)
      g.font = '600 26px system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
      const tw = g.measureText(kbd.text + ' ').width, tx = Math.min(L + 10, R - 12 - tw);
      g.fillStyle = '#ffffff'; g.fillText(kbd.text, tx, y0 + 23);
      g.fillStyle = '#39a8ff'; g.fillRect(tx + g.measureText(kbd.text).width + 2, y0 + 9, 14, 28); g.textBaseline = 'alphabetic';
    }
    g.restore();
    const gap = 4, kh = P ? 46 : 36, ky0 = y0 + 52;
    KEY_ROWS.forEach((row, ri) => {
      const keys = [...row], kw = (R - L - (keys.length - 1) * gap) / keys.length;
      keys.forEach((k, i) => btn(L + i * (kw + gap), ky0 + ri * (kh + gap), kw, kh, k, false, () => kbdKey(k), false, P ? 15 : 17));
    });
    const by = ky0 + KEY_ROWS.length * (kh + gap);
    let x = L, by2 = by; const ew = P ? (R - L - 2 * gap) / 3 : 56;
    if (kbd.emoji) {
      for (const em of BIT_EMOJI) {
        g.fillStyle = '#1c2434'; g.fillRect(x, by, ew, kh);
        drawBitText(g, em, x + ew / 2 - 12, by + kh / 2 - 9, 3, '#fff');
        VP_HIT.push({ x, y: by, w: ew, h: kh, act: () => kbdKey(em) }); x += ew + gap;
      }
      if (P) { x = L; by2 = by + kh + gap; }   // portrait: emoji on a row of their own
    }
    const cw = P ? 48 : 70; btn(x, by2, cw, kh, 'CLR', false, () => { kbd.text = ''; }); x += cw + gap;
    const rest = R - x, dw = P ? 50 : 80, ew2 = P ? 64 : 110, sw = rest - dw - ew2 - 2 * gap;
    btn(x, by2, sw, kh, 'SPACE', false, () => kbdKey('SPACE'));
    btn(x + sw + gap, by2, dw, kh, '⌫', false, () => kbdKey('DEL'));
    btn(x + sw + dw + 2 * gap, by2, ew2, kh, kbd.emoji ? 'ENTER' : 'OK', true, () => kbdKey('ENTER'));
    return;
  }
  if (page === 'handfit') {   // #291 (owner) move / turn the 3D hands and glove on the controllers; values to report back
    const y0 = head('HAND FIT', 'dj');
    let X = null; try { X = xr; } catch (e) {}
    const A = X ? X.handFit : { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
    const rows = [['x', 'MOVE OUT / IN', 'mm', 5], ['y', 'MOVE UP / DOWN', 'mm', 5], ['z', 'MOVE BACK / FORWARD', 'mm', 5],
      ['rx', 'TILT FINGERS UP / DOWN', '°', 5], ['ry', 'SWING FINGERS OUT / IN', '°', 5], ['rz', 'ROLL', '°', 5]];
    // #355 laid out as cells (landscape: two columns; portrait: the label above its − value +), so nothing overlaps
    const cells = rows.map(([k, label, unit, step]) => [label, `${(A[k] || 0) > 0 ? '+' : ''}${A[k] || 0} ${unit}`, d => { if (X) { X.setHandFit(k, (A[k] || 0) + d * step); drawMixScreen(); } }, '#dfe6f2']);
    { const v = settings.needleLift || 7; cells.push(['NEEDLE LIFT (tonearm)', `${v} cm`, d => { settings.needleLift = Math.max(1, Math.min(10, Math.round((v + d * 0.5) * 2) / 2)); saveSettings(); drawMixScreen(); }, '#7cc4ff']); }   // #323
    { const v = A.gs || 94; cells.push(['GLOVE SIZE', `${v} %`, d => { if (X) { X.setHandFit('gs', Math.max(80, Math.min(120, v + d * 3))); drawMixScreen(); } }, '#c9a6ff']); }   // #355
    const cell = ([label, val, act, col], x, y, w, h, stacked) => {
      const bw = stacked ? 56 : 44, vw = stacked ? w - 2 * bw - 12 : 84, lw = stacked ? w : w - 2 * bw - vw - 12;
      let fs = stacked ? 15 : 14; g.font = `700 ${fs}px system-ui`; while (fs > 10 && g.measureText(label).width > lw - 4) g.font = `700 ${--fs}px system-ui`;
      g.fillStyle = col; g.textAlign = 'left'; g.textBaseline = 'middle';
      const by = stacked ? y + 20 : y, bh = stacked ? h - 20 : h;
      g.fillText(label, x + 2, stacked ? y + 9 : y + h / 2);
      const bx = stacked ? x : x + lw + 4;
      btn(bx, by, bw, bh, '−', false, () => act(-1));
      g.fillStyle = '#fff'; g.font = '700 18px system-ui'; g.textAlign = 'center'; g.fillText(val, bx + bw + 6 + vw / 2, by + bh / 2); g.textBaseline = 'alphabetic';
      btn(bx + bw + 12 + vw, by, bw, bh, '+', false, () => act(1));
    };
    const neonOn = A.neon !== 0;
    const bottomBtns = (x, y, w, h) => {
      const b2 = (w - 8) / 2;
      btn(x, y, (w - 16) / 3, h, 'RESET', false, () => { if (X) { for (const [k] of rows) X.setHandFit(k, 0); X.setHandFit('gs', 94); drawMixScreen(); } });
      const b3 = (w - 16) / 3;
      btn(x + b3 + 8, y, b3, h, neonOn ? 'NEON CHROME: ON' : 'NEON CHROME', neonOn, () => { if (X) X.setHandFit('neon', neonOn ? 0 : 1); robotNeon(); drawMixScreen(); });
      btn(x + 2 * b3 + 16, y, b3, h, 'PINCH FIT ▸', false, () => setTools('pinchfit'));   // #422
    };
    if (P) {
      cells.forEach((c, i) => cell(c, L, y0 + i * 62, R - L, 58, true));
      const yb = y0 + cells.length * 62 + 4; bottomBtns(L, yb, R - L, 44);
      note('5 mm / 5° steps, both hands (left mirrored). NEEDLE LIFT: how far a hand holding the arm lifts before the needle comes up. GLOVE SIZE: the robot glove look. NEON CHROME: helmet and gloves reflect neon.', yb + 62);
    } else {
      const cw = (R - L - 16) / 2, half = Math.ceil(cells.length / 2);
      cells.forEach((c, i) => cell(c, L + (i < half ? 0 : cw + 16), y0 + (i % half) * 44, cw, 38, false));
      bottomBtns(L, y0 + half * 44 + 4, R - L, 36);
    }
    return;
  }
  if (page === 'feel') {   // #423 (owner) TURNTABLE FEEL sliders, preset to the current physics
    const y0 = head('TURNTABLE FEEL', 'dj'), D = FEEL_DEF, keys = Object.keys(D);
    const row = (k, x, y, w, h) => { const r = D[k], v = FEEL[k]; tSlider(g, x, y, w, h, r.label, (v - r.lo) / (r.hi - r.lo), `${v} ${r.unit}`, f => setFeel(k, Math.round(r.lo + f * (r.hi - r.lo))), false, 170); };
    const reset = () => { for (const k of keys) setFeel(k, D[k].v); drawMixScreen(); };
    if (P) {
      keys.forEach((k, i) => row(k, L, y0 + i * 52, R - L, 46));
      const yb = y0 + keys.length * 52 + 4; btn(L, yb, R - L, 40, 'RESET TO AS BUILT', false, reset);
      note('Drag a bar. 100 % = the physics as built. PLATTER FRICTION: slipmat grip. SCRATCH & DRAG: record turn per hand turn (100 % = 1:1). RADIUS EVEN-OUT: every touch point moves the record like the outer edge (0 % = true vinyl). HAND SMOOTHING: filters tracking jitter on the record. SPINDLE TWIST: pinch on the spindle. NUDGE: finger on the platter rim.', yb + 58);
    } else {
      const bw = 170;   // one bar per row, full width; RESET under the label column
      keys.forEach((k, i) => row(k, L, y0 + i * 31, R - L, 28));   // #424 / #455 seven bars
      btn(L, y0 + keys.length * 31 + 2, bw, 30, 'RESET TO AS BUILT', false, reset, false, 14);
      g.fillStyle = '#8c96a8'; g.font = '500 14px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('100 % = as built.  RADIUS EVEN-OUT 0 % = true vinyl.  RECORD GROOVES = ring contrast and sheen.', L + bw + 12, y0 + keys.length * 31 + 17); g.textBaseline = 'alphabetic';
    }
    return;
  }
  if (page === 'pinchfit') {   // #422 (owner) sliders: the interaction sphere, the pinched hand / glove (lift, tilt, turn) and knob twist
    const y0 = head('PINCH FIT', 'handfit');
    let X = null; try { X = xr; } catch (e) {}
    const A = X ? X.handFit : {}, D = PINCH_FIT_DEF;
    const val = k => (A[k] != null ? A[k] : D[k].v);
    const set = (k, f) => { if (!X) return; const r = D[k]; X.setHandFit(k, Math.round(r.lo + f * (r.hi - r.lo))); };
    const keys = Object.keys(D);
    const row = (k, x, y, w, h) => { const r = D[k], v = val(k); tSlider(g, x, y, w, h, r.label, (v - r.lo) / (r.hi - r.lo), `${v > 0 && r.lo < 0 ? '+' : ''}${v} ${r.unit}`, f => set(k, f)); };
    if (P) {
      keys.forEach((k, i) => row(k, L, y0 + i * 50, R - L, 44));
      const yb = y0 + keys.length * 50 + 4;
      btn(L, yb, R - L, 40, 'RESET PINCH FIT', false, () => { if (X) for (const k of keys) X.setHandFit(k, D[k].v); drawMixScreen(); });
      note('Drag a bar with your fingertip. BALL: where the touch point sits on your index finger (mm). LIFT / TILT / TURN: the 3D hand or glove once it has pinched a knob or fader. TWIST: wrist turn for a knob from 0 to full.', yb + 58);
    } else {
      const cw = (R - L - 12) / 2, half = Math.ceil(keys.length / 2);
      keys.forEach((k, i) => row(k, L + (i < half ? 0 : cw + 12), y0 + (i % half) * 40, cw, 36));
      btn(L, y0 + half * 40 + 4, 200, 34, 'RESET PINCH FIT', false, () => { if (X) for (const k of keys) X.setHandFit(k, D[k].v); drawMixScreen(); });
    }
    return;
  }
  if (page === 'maker') {
    const y0 = head('RECORD MAKER', 'dj');
    const bmp = maker.artLabelBmp || (maker.image ? vpThumb('Images', maker.image) : null);   // #393
    let x0, cy0, rad;
    const k7 = maker.size === 7 ? 0.573 : 1;   // #261 the preview shrinks to 7" (175 / 305 mm)
    if (P) { rad = 92; drawDisc(g, W / 2, y0 + rad + 4, rad * k7, bmp, maker.name || 'BLANK', k7 < 1); x0 = L; cy0 = y0 + 2 * rad + 20; }
    else { rad = 106; drawDisc(g, L + rad + 4, y0 + rad + 18, rad * k7, bmp, maker.name || 'BLANK', k7 < 1); x0 = L + 2 * rad + 24; cy0 = y0; }
    const lw = P ? 0 : 70, bo = P ? 22 : 0, bw = Math.min(118, (R - x0 - lw - 12) / 3), row = (y, label) => {   // #349 portrait: the row name above its buttons, buttons full width
     g.fillStyle = '#dfe6f2'; g.font = '700 15px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(label, x0, y + (P ? 8 : 17)); g.textBaseline = 'alphabetic'; };
    const sub = (s, y) => { g.fillStyle = '#8c96a8'; g.font = '500 14px system-ui'; g.textAlign = 'left'; fitText2(g, s, x0 + lw, y, R - x0 - lw); };
    let y = cy0;
    row(y, 'SOUND');
    btn(x0 + lw, y + bo, bw, 34, 'BLANK', maker.kind === 'blank', () => { maker.kind = 'blank'; });
    btn(x0 + lw + bw + 6, y + bo, bw, 34, 'SONG…', maker.kind === 'song', () => setTools('pickSong'));
    btn(x0 + lw + 2 * (bw + 6), y + bo, bw, 34, 'CLIP…', maker.kind === 'clip', () => setTools('pickVideo'));
    sub(makerSourceText(), y + bo + 52); y += 64 + bo;
    row(y, 'LABEL');
    btn(x0 + lw, y + bo, bw, 34, 'PICTURE…', !!maker.image, () => setTools('pickImage'));
    btn(x0 + lw + bw + 6, y + bo, bw, 34, 'NONE', !maker.image && !(maker.art && maker.art.label), () => { maker.image = null; if (maker.art) { maker.art.label = null; maker.artLabelBmp = null; } });
    btn(x0 + lw + 2 * (bw + 6), y + bo, bw, 34, maker.size === 7 ? 'SIZE: 7"  45' : 'SIZE: 12"', maker.size === 7, () => { maker.size = maker.size === 7 ? 12 : 7; });   // #261
    sub((maker.art ? artSummary() : maker.image ? 'Picture: ' + maker.image.replace(/\.[^.]+$/, '') : 'Plain red label with the name') + (maker.size === 7 ? '  ·  7" single, 45 rpm, needs the adapter, into the 45s list' : ''), y + bo + 52); y += 64 + bo;
    row(y, 'NAME');
    btn(x0 + lw, y + bo, bw, 34, 'NAME…', false, () => openKbd('RECORD NAME', maker.name, false, 32, t => { maker.name = t.trim(); }, 'maker'));
    btn(x0 + lw + bw + 6, y + bo, bw, 34, 'FETCH ART…', !!maker.art, openArtPage, false, 15);   // #393 Discogs / MusicBrainz
    g.fillStyle = maker.name ? '#ffffff' : '#56627a'; g.font = '600 17px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle';
    fitText2(g, maker.name || '(no name yet)', x0 + lw + 2 * bw + 20, y + bo + 17, R - x0 - lw - 2 * bw - 20); g.textBaseline = 'alphabetic';
    y += 46 + bo;
    const sh = P ? 52 : Math.min(52, H - y - 6);
    if (maker.msg && !maker.busy) {   // #225 the answer, on the tablet; tap to clear
      g.fillStyle = maker.msgOk ? '#1d7a3a' : '#8a2a1a'; g.fillRect(x0, y, R - x0, sh);
      g.fillStyle = '#fff'; g.font = '700 16px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      fitText2Center(g, maker.msg, x0 + (R - x0) / 2, y + sh / 2 + 1, R - x0 - 16); g.textBaseline = 'alphabetic';
      VP_HIT.push({ x: x0, y, w: R - x0, h: sh, act: () => { maker.msg = ''; clearTimeout(makerMsgT); } });
    } else btn(x0, y, R - x0, sh, maker.busy ? 'STAMPING…' : 'STAMP RECORD', maker.busy, maker.busy ? null : pressRecord, false, 22);
    return;
  }
  if (page === 'pickSong') {
    const y0 = head('PICK A SONG', 'maker');
    const list = lib ? currentList() : [], rows = P ? 12 : 4, RH = 44, pages = Math.max(1, Math.ceil(list.length / rows)); pickPg = Math.min(pickPg, pages - 1);
    if (!list.length) note('No songs in the crate list. Load a library (start page) or pick a list on the crate first.', y0 + 20);
    else { g.fillStyle = '#56627a'; g.font = '500 13px system-ui'; g.textAlign = 'left'; fitText2(g, 'From the crate list: ' + (search.results ? 'search results' : lib.playlists[crateState.pl].path), L + 4, y0 + 6, R - L); }
    list.slice(pickPg * rows, pickPg * rows + rows).forEach((r, k) => {
      const y = y0 + 14 + k * RH, t = r.sides.A || r.sides.B, ok = t && !t.missing && !t.press;
      g.fillStyle = '#0d1422'; g.fillRect(L, y, R - L, RH - 6);
      g.fillStyle = ok ? '#dfe6f2' : '#56627a'; g.font = '600 16px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle';
      fitText2(g, `${r.title}${r.artist ? '  ·  ' + r.artist : ''}${r.bpm ? '  ·  ' + (+r.bpm).toFixed(0) + ' BPM' : ''}`, L + 10, y + (RH - 6) / 2, R - L - 20); g.textBaseline = 'alphabetic';
      if (ok) VP_HIT.push({ x: L, y, w: R - L, h: RH - 6, act: () => { maker.kind = 'song'; maker.song = { title: r.title, artist: r.artist || '', opfs: t.opfs || null, url: t.url || null, bpm: r.bpm || t.bpm || 0, duration: t.duration || r.duration || 0 }; if (!maker.name) maker.name = cleanText(r.title, 32); setTools('maker'); } });
    });
    const by = P ? H - 62 : H - 44;
    btn(L, by, 44, 36, '‹', false, () => { pickPg = Math.max(0, pickPg - 1); }, pickPg === 0);
    btn(L + 48, by, 44, 36, '›', false, () => { pickPg = Math.min(pages - 1, pickPg + 1); }, pickPg >= pages - 1);
    return;
  }
  if (page === 'art') {   // #393 FETCH ART: search Discogs / MusicBrainz, then open a release
    const tokOk = !!discogsToken();
    const y0 = head('FETCH ART', 'maker', { label: tokOk ? 'TOKEN' : 'TOKEN…', on: !tokOk && art.dg, act: () => openKbd('DISCOGS TOKEN (MIC / KEYS, paste)', '', false, 64, t => { if (t.trim()) { setDiscogsToken(t.trim()); makerSay('Discogs token kept on this headset', true, 3000); } }, 'art') });
    const per = P ? 9 : 4, pages = Math.max(1, Math.ceil(art.results.length / per)); art.pg = Math.min(art.pg, pages - 1);
    const qTxt = (x, y, w) => { g.fillStyle = art.q ? '#ffffff' : '#56627a'; g.font = '600 16px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle'; fitText2(g, art.q || 'ARTIST - TITLE', x, y + 17, w); g.textBaseline = 'alphabetic'; };
    const askQ = () => openKbd('ARTIST - TITLE', art.q, false, 60, t => { art.q = t.trim(); if (art.q) runArtSearch(); }, 'art');
    let ly;
    if (P) {
      btn(L, y0, 110, 34, 'SEARCH…', false, askQ); qTxt(L + 118, y0, R - L - 118);
      const w3 = (R - L - 12) / 3;
      btn(L, y0 + 40, w3, 34, 'DISCOGS', art.dg, () => { art.dg = !art.dg; }, false, 14);
      btn(L + w3 + 6, y0 + 40, w3, 34, 'MUSICBRAINZ', art.mb, () => { art.mb = !art.mb; }, false, 13);
      btn(L + 2 * (w3 + 6), y0 + 40, w3, 34, art.busy ? 'FINDING…' : 'FIND', art.busy, art.busy ? null : runArtSearch);
      ly = y0 + 84;
      btn(L, H - 62, 44, 36, '‹', false, () => { art.pg = Math.max(0, art.pg - 1); }, art.pg === 0);
      btn(L + 48, H - 62, 44, 36, '›', false, () => { art.pg = Math.min(pages - 1, art.pg + 1); }, art.pg >= pages - 1);
      if (art.results.length) { g.fillStyle = '#8c96a8'; g.font = '500 13px system-ui'; g.textAlign = 'left'; g.fillText(`${art.pg + 1} / ${pages}`, L + 100, H - 40); }
    } else {
      const fx = R - 6 * 6 - 100 - 112 - 72 - 40 - 40;
      btn(L, y0, 96, 34, 'SEARCH…', false, askQ); qTxt(L + 104, y0, fx - L - 104);
      btn(fx + 6, y0, 100, 34, 'DISCOGS', art.dg, () => { art.dg = !art.dg; }, false, 14);
      btn(fx + 112, y0, 112, 34, 'MUSICBRAINZ', art.mb, () => { art.mb = !art.mb; }, false, 13);
      btn(fx + 230, y0, 72, 34, art.busy ? '…' : 'FIND', art.busy, art.busy ? null : runArtSearch);
      btn(R - 86, y0, 40, 34, '‹', false, () => { art.pg = Math.max(0, art.pg - 1); }, art.pg === 0);
      btn(R - 40, y0, 40, 34, '›', false, () => { art.pg = Math.min(pages - 1, art.pg + 1); }, art.pg >= pages - 1);
      ly = y0 + 42;
    }
    const RH = P ? 58 : 46;
    if (art.busy) note('Searching ' + [art.dg && 'Discogs', art.mb && 'MusicBrainz'].filter(Boolean).join(' and ') + '…', ly + 16);
    else if (!art.results.length) note(art.errors.length ? art.errors.join('  ·  ') : art.searched ? 'Nothing found. Try SEARCH… with ARTIST - TITLE (a dash between them), or switch a source on.'
      : (art.dg && !tokOk ? 'Discogs needs your token on this headset: TOKEN… (paste with MIC / KEYS), or open the app once with ?discogs=YOURTOKEN. ' : '') + 'SEARCH… type ARTIST - TITLE, then FIND. Vinyl pressings come first; pick one to choose its sleeve, label and back cover.', ly + 16);
    else {
      art.results.slice(art.pg * per, art.pg * per + per).forEach((rr, k) => {
        const y = ly + k * RH, h = RH - 6, th = h;
        g.fillStyle = '#0d1422'; g.fillRect(L, y, R - L, h);
        drawArtThumb(g, artThumb(rr.thumb, rr.src, artRedraw), L, y, th, th);
        g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillStyle = '#dfe6f2'; g.font = '600 16px system-ui'; fitText2(g, `${rr.title}${rr.artist ? '  ·  ' + rr.artist : ''}`, L + th + 10, y + h * 0.32, R - L - th - 20);
        g.fillStyle = rr.vinyl ? '#f1b650' : '#8c96a8'; g.font = '500 13px system-ui';
        fitText2(g, [rr.year, rr.format, rr.label, rr.src === 'mb' ? 'MUSICBRAINZ' : 'DISCOGS'].filter(Boolean).join('  ·  '), L + th + 10, y + h * 0.74, R - L - th - 20);
        g.textBaseline = 'alphabetic';
        VP_HIT.push({ x: L, y, w: R - L, h, act: () => openArtRelease(rr) });
      });
      if (art.errors.length) { g.fillStyle = '#c86a5a'; g.font = '500 12px system-ui'; g.textAlign = 'left'; fitText2(g, art.errors.join('  ·  '), L + 4, P ? H - 76 : H - 4, R - L - 8); }
    }
    return;
  }
  if (page === 'artpick') {   // #393 choose SLEEVE, LABEL A, BACK from the release's pictures
    const y0 = head('PICK THE ART', 'art');
    const rel = art.rel || {};
    const SL = [['front', 'SLEEVE'], ['label', 'LABEL A'], ['back', 'BACK']];
    const slot = (key, name, x, y, w, h) => {
      const on = art.slot === key, im = art.slots[key];
      g.fillStyle = on ? '#c8202c' : '#1a2233'; g.fillRect(x, y, w, h);
      const ts = h - 8; drawArtThumb(g, im ? artThumb(im.thumb, im.src, artRedraw) : null, x + 4, y + 4, ts, ts, !im);
      g.fillStyle = '#fff'; g.font = '700 15px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle';
      if (w - ts > 40) { fitText2(g, name, x + ts + 12, y + h * 0.36, w - ts - 16); g.fillStyle = on ? '#ffd9d9' : '#8c96a8'; g.font = '500 12px system-ui'; fitText2(g, im ? 'tap a picture to change' : on ? 'tap a picture' : 'none', x + ts + 12, y + h * 0.7, w - ts - 16); }
      else { g.textAlign = 'center'; g.font = '700 12px system-ui'; g.fillText(name, x + w / 2, y + h - 10); }
      g.textBaseline = 'alphabetic';
      VP_HIT.push({ x, y, w, h, act: () => { art.slot = key; } });
    };
    let gx, gy, gw, gh, cols;
    if (P) {
      const sw = (R - L - 12) / 3; SL.forEach(([k, n], i) => slot(k, n, L + i * (sw + 6), y0, sw, 96));
      btn(L, H - 62, R - L - 100, 40, art.busy ? 'FETCHING…' : 'USE THIS ART', art.busy, art.busy ? null : useArt, !art.imgs.length, 18);
      gx = L; gy = y0 + 104; gw = R - L; gh = H - 70 - gy; cols = 3;
    } else {
      const sw = 214; SL.forEach(([k, n], i) => slot(k, n, L, y0 + i * 64, sw, 58));
      btn(L, y0 + 196, sw, 44, art.busy ? 'FETCHING…' : 'USE THIS ART', art.busy, art.busy ? null : useArt, !art.imgs.length, 18);
      gx = L + sw + 10; gy = y0; gw = R - gx; gh = H - 40 - gy; cols = Math.floor((gw + 6) / 84);
    }
    const ts = Math.floor((gw - (cols - 1) * 6) / cols), rowsN = Math.max(1, Math.floor((gh + 6) / (ts + 6)));
    const per = cols * rowsN, pages = Math.max(1, Math.ceil(art.imgs.length / per)); art.ipg = Math.min(art.ipg, pages - 1);
    if (art.busy && !art.imgs.length) note('Opening the release…', gy + 16);
    else if (!art.imgs.length) note(art.msg || 'This release has no pictures. BACK and pick another pressing.', gy + 16);
    art.imgs.slice(art.ipg * per, art.ipg * per + per).forEach((im, i) => {
      const x = gx + (i % cols) * (ts + 6), y = gy + Math.floor(i / cols) * (ts + 6);
      drawArtThumb(g, artThumb(im.thumb, im.src, artRedraw), x, y, ts, ts);
      const used = SL.filter(([k]) => art.slots[k] === im).map(([, n]) => n[0]).join(' ');
      if (im.kind !== 'other' || used) {
        const tag = used || im.kind;   // red S / L / B = in that slot; grey front / back / label = how the source names it
        g.font = '700 13px system-ui'; g.fillStyle = used ? '#c8202c' : 'rgba(5,7,12,0.75)'; g.fillRect(x + 2, y + 2, g.measureText(tag).width + 10, 20);
        g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(tag, x + 7, y + 13); g.textBaseline = 'alphabetic';
      }
      VP_HIT.push({ x, y, w: ts, h: ts, act: () => {
        if (art.slots[art.slot] === im) art.slots[art.slot] = null;   // tapped again: that slot is empty
        else { art.slots[art.slot] = im; const n = SL.findIndex(([k]) => k === art.slot); art.slot = SL[(n + 1) % 3][0]; }
      } });
    });
    const iy = P ? H - 18 : H - 30;
    g.fillStyle = '#8c96a8'; g.font = '500 13px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle';
    const info = `${rel.title || ''}${rel.year ? ' (' + rel.year + ')' : ''}  ·  ${art.imgs.length} picture${art.imgs.length === 1 ? '' : 's'}${art.imgs.length && rel.src === 'discogs' ? '  ·  Discogs pictures are not named: check the label and back' : ''}`;
    if (P) { fitText2(g, info, L + 4, H - 12, R - L - 8); btn(R - 92, H - 62, 44, 40, '‹', false, () => { art.ipg = Math.max(0, art.ipg - 1); }, art.ipg === 0); btn(R - 44, H - 62, 44, 40, '›', false, () => { art.ipg = Math.min(pages - 1, art.ipg + 1); }, art.ipg >= pages - 1); }
    else { fitText2(g, info, gx + 4, iy + 12, gw - 100); btn(R - 86, iy - 4, 40, 32, '‹', false, () => { art.ipg = Math.max(0, art.ipg - 1); }, art.ipg === 0); btn(R - 40, iy - 4, 40, 32, '›', false, () => { art.ipg = Math.min(pages - 1, art.ipg + 1); }, art.ipg >= pages - 1); }
    g.textBaseline = 'alphabetic';
    if (art.msg && art.imgs.length) { g.fillStyle = '#c86a5a'; g.font = '600 13px system-ui'; g.textAlign = 'left'; fitText2(g, art.msg, gx + 4, P ? gy - 6 : iy - 8, gw - 8); }
    return;
  }
  if (page === 'card') {   // #445 the stream's CARD: the main card (always the first slot), or any picture / animated GIF from IMAGES (sponsor, theme night, a QR code)
    const S = streamer, y0 = head('STREAM CARD', 'stream');
    if (!S) { note('The card is part of the stream, which runs on the headset.', y0 + 20); return; }
    const COLS = P ? 2 : 4, PER = P ? 10 : 8, CW = (R - L - (COLS - 1) * 8) / COLS, TH = P ? 64 : 76, CH = TH + 20, cur = S.cardPic ? S.cardPic.name : '';
    const list = [{ main: true }, ...pickItems], pages = Math.max(1, Math.ceil(list.length / PER)); pickPg = Math.min(pickPg, pages - 1);
    list.slice(pickPg * PER, pickPg * PER + PER).forEach((it, i) => {
      const cx = L + (i % COLS) * (CW + 8), cy = y0 + Math.floor(i / COLS) * (CH + 6), on = it.main ? !cur : it.name === cur;
      g.fillStyle = '#121824'; g.fillRect(cx, cy, CW, TH);
      if (it.main) {
        g.textAlign = 'right'; g.textBaseline = 'middle'; g.font = '800 26px system-ui'; g.fillStyle = '#fff'; g.fillText('Cly', cx + CW / 2 + 2, cy + TH / 2 - 8); g.textAlign = 'left'; g.fillStyle = '#e0202a'; g.fillText('3DJ', cx + CW / 2 + 3, cy + TH / 2 - 8);
        g.textAlign = 'center'; g.font = '600 12px system-ui'; g.fillStyle = '#b9a3ff'; g.fillText('LIVE ON VINYL + TWITCH QR', cx + CW / 2, cy + TH - 12); g.textBaseline = 'alphabetic';
      } else {
        const t = vpThumb('Images', it.name);
        if (t && t !== 'loading') { const s = Math.min(CW / t.width, TH / t.height), w = t.width * s, h = t.height * s; g.drawImage(t, cx + (CW - w) / 2, cy + (TH - h) / 2, w, h); }
        if (/\.gif$/i.test(it.name)) { g.fillStyle = 'rgba(5,7,12,0.78)'; g.fillRect(cx + CW - 34, cy + TH - 20, 32, 18); g.fillStyle = '#ffd24a'; g.font = '800 12px system-ui'; g.textAlign = 'center'; g.fillText('GIF', cx + CW - 18, cy + TH - 7); }
      }
      if (on) { g.strokeStyle = '#39a8ff'; g.lineWidth = 4; g.strokeRect(cx + 2, cy + 2, CW - 4, TH + 16); if (S.source === 'card') { g.fillStyle = '#40d080'; g.fillRect(cx + 4, cy + 4, 62, 20); g.fillStyle = '#05070c'; g.font = '800 13px system-ui'; g.textAlign = 'left'; g.fillText('ON AIR', cx + 9, cy + 19); } }
      g.fillStyle = on ? '#fff' : '#b8c0cf'; g.font = '500 14px system-ui'; g.textAlign = 'left'; fitText2(g, it.main ? 'MAIN CARD' : it.name.replace(/\.[^.]+$/, ''), cx + 2, cy + TH + 15, CW - 4);
      VP_HIT.push({ x: cx, y: cy, w: CW, h: CH, act: async () => {
        if (it.main) { S.setCardPic(null); cardWallSet(null); try { localStorage.setItem('vire.cardPic', ''); } catch (e) {} }
        else { const f = await media.getFile('Images', it.name); if (!f || !(await S.setCardPic(f))) { toast('That picture would not open', 2500); return; } try { localStorage.setItem('vire.cardPic', it.name); } catch (e) {} cardWallSet(f); }
        S.setSource('card'); drawMixScreen();
      } });
    });
    const by = P ? H - 62 : H - 44;
    btn(L, by, 44, 36, '‹', false, () => { pickPg = Math.max(0, pickPg - 1); }, pickPg === 0);
    btn(L + 48, by, 44, 36, '›', false, () => { pickPg = Math.min(pages - 1, pickPg + 1); }, pickPg >= pages - 1);
    btn(R - 150, by, 150, 36, cardWall.on ? 'LED WALL: ON' : 'LED WALL: OFF', cardWall.on, () => { cardWall.on = !cardWall.on; try { localStorage.setItem('vire.cardWall', cardWall.on ? '1' : '0'); } catch (e) {} if (cardWall.on) { if (cardWall.file) cardWallSet(cardWall.file); } else if (ledMode === 'card') setLedMode(cardWall.prev && cardWall.prev !== 'card' ? cardWall.prev : 'off'); drawMixScreen(); }, false, 15);   // #446
    g.fillStyle = '#8c96a8'; g.font = '500 13px system-ui'; g.textAlign = 'left';
    wrapText(g, 'Tap a picture or GIF (add them in IMAGES on the start page, or Library > Import on the phone). It goes to Twitch, DIRROTV and, with LED WALL on, the LED wall and the phones (a GIF is cut to 64 frames for them). MAIN CARD is the DirroDJ card with the Twitch QR.', L + 104, by + 8, R - L - 270, 14, 3);
    return;
  }
  if (page === 'pickVideo' || page === 'pickImage') {
    const folder = page === 'pickVideo' ? 'Video' : 'Images';
    const y0 = head(page === 'pickVideo' ? 'PICK A CLIP' : 'PICK A LABEL PICTURE', 'maker');
    const COLS = P ? 2 : 4, PER = P ? 10 : 8, CW = (R - L - (COLS - 1) * 8) / COLS, TH = P ? 64 : 76, CH = TH + 20;
    const pages = Math.max(1, Math.ceil(pickItems.length / PER)); pickPg = Math.min(pickPg, pages - 1);
    if (!pickItems.length) note(`Nothing in ${folder === 'Video' ? 'VIDEO' : 'IMAGES'} on this headset yet. On the phone: Library, Import, then Push to Quest.`, y0 + 24);
    pickItems.slice(pickPg * PER, pickPg * PER + PER).forEach((it, i) => {
      const cx = L + (i % COLS) * (CW + 8), cy = y0 + Math.floor(i / COLS) * (CH + 6), t = vpThumb(folder, it.name);
      g.fillStyle = '#121824'; g.fillRect(cx, cy, CW, TH);
      if (t && t !== 'loading') { const s = Math.max(CW / t.width, TH / t.height), sw = CW / s, sh = TH / s; g.drawImage(t, (t.width - sw) / 2, (t.height - sh) / 2, sw, sh, cx, cy, CW, TH); }
      drawTypeBadge(g, cx + CW - 30, cy + TH - 22, folder === 'Video');
      g.fillStyle = '#b8c0cf'; g.font = '500 14px system-ui'; g.textAlign = 'left'; fitText2(g, it.name.replace(/\.[^.]+$/, ''), cx + 2, cy + TH + 15, CW - 4);
      VP_HIT.push({ x: cx, y: cy, w: CW, h: CH, act: () => { if (folder === 'Video') { maker.video = it.name; maker.kind = 'clip'; if (!maker.name) maker.name = cleanText(it.name.replace(/\.[^.]+$/, ''), 32); } else maker.image = it.name; setTools('maker'); } });
    });
    const by = P ? H - 62 : H - 44;
    btn(L, by, 44, 36, '‹', false, () => { pickPg = Math.max(0, pickPg - 1); }, pickPg === 0);
    btn(L + 48, by, 44, 36, '›', false, () => { pickPg = Math.min(pages - 1, pickPg + 1); }, pickPg >= pages - 1);
  }
}
// #224 a tiny type badge for thumbnails (lower right): a camcorder for videos, a picture for images
function drawTypeBadge(g, x, y, video) {
  g.fillStyle = 'rgba(5,7,12,0.78)'; g.beginPath(); g.roundRect(x - 2, y - 2, 28, 20, 4); g.fill();
  g.fillStyle = '#e8ecf3'; g.strokeStyle = '#e8ecf3'; g.lineWidth = 1.6;
  if (video) {   // body + lens cone
    g.beginPath(); g.roundRect(x + 2, y + 4, 14, 10, 2); g.fill();
    g.beginPath(); g.moveTo(x + 17, y + 9); g.lineTo(x + 23, y + 5); g.lineTo(x + 23, y + 13); g.closePath(); g.fill();
  } else {       // frame, sun, mountain
    g.strokeRect(x + 2, y + 2, 20, 14);
    g.beginPath(); g.arc(x + 8, y + 7, 2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(x + 3, y + 15); g.lineTo(x + 10, y + 9); g.lineTo(x + 14, y + 12); g.lineTo(x + 17, y + 10); g.lineTo(x + 21, y + 15); g.closePath(); g.fill();
  }
}

function drawMixScreen() {
  navTrack();   // #363
  syncShowFromRoom();   // #401 one switch per object
  if (toolsPage) { drawToolsPage(); scr().commit(); return; }   // #224
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
    const bw = 80, vw = 84, vx = W - 14 - bw - 6 - vw;   // #363 BACK top right, VISUALS left of it
    drawTopBtn(g, W - 14 - bw, y, bw, h, '◀ BACK', false, !navCan(), 18);
    if (navCan()) SP_HIT.push({ x: W - 14 - bw - 3, y: y - 8, w: bw + 9, h: h + 16, act: navBack });
    drawTopBtn(g, vx, y, vw, h, 'PREVIEW', monOn);   // #389 VISUALS moved to VJ TOOLS; PREVIEW is the master button
    SP_HIT.push({ x: vx - 3, y: y - 8, w: vw + 6, h: h + 16, act: () => setMonitor(!monOn) });
    if (sp) {
      const mw = 76;
      drawTopBtn(g, 24, y, mw, h, 'MR GUI', sp.mr); drawPhoneIcon(g, 24 + mw + 5, y + (h - 24) / 2, 14, 24, sp.phone);
      SP_HIT.push({ x: 18, y: y - 8, w: mw + 9, h: h + 16, act: () => spect.setMR(!sp.mr) });
    }
    { const S = streamer, bw3 = (W - 40 - 3 * 6) / 4, by3 = H - 96;   // #389 STREAM, CLY3DTV, STUDIO on a row above TOOLS / RESET MIX; #439 + WALL
      [[S && S.live ? '● LIVE' : 'STREAM', !!(S && S.live), () => setTools('stream'), !S], ['DIRROTV', !!(S && S.tvUp), () => setTools('tv'), !S], ['STUDIO', !!(S && S.stu.on), () => setTools('studio'), !S], ['WALL ⁺¹', ledMode !== 'off', () => setTools('wall'), false]].forEach(([l, o, a, dim], i) => {
        const bx3 = 20 + i * (bw3 + 6); drawTopBtn(g, bx3, by3, bw3, 36, l, o, dim, 15); if (!dim) SP_HIT.push({ x: bx3 - 3, y: by3 - 4, w: bw3 + 6, h: 44, act: a }); });
    }
    drawTopBtn(g, 20, H - 52, 80, 36, 'TOOLS', !!(scroller && scroller.on));   // #224
    SP_HIT.push({ x: 14, y: H - 60, w: 90, h: 52, act: () => setTools('home') });
    drawResetMix(g, 106, H - 52, 110, 36);   // #254
    drawLoopMainBtn(g, 222, H - 52, W - 20 - 222, 36, 15); SP_HIT.push({ x: 219, y: H - 60, w: W - 20 - 216, h: 52, act: () => setTools('looper') });   // #470
    drawPin(g, W - 26 - 150, H - 142, 150, 34);   // #210 (#470: above the button rows, LOOP took its place)
    scr().commit(); return;
  }
  for (const d of decks) drawDeckPanel(g, d, d.i ? W / 2 + 6 : 6, 6, W / 2 - 12, H - 12, false);
  drawPin(g, W - 14 - 120, H - 46, 120, 30);   // #210 (#470 narrower: LOOP joined the bottom bar)
  { // #185 VIDEO: deck B's top row (was the #176 LED WALL switch, which is on the Video page now)
    const w = 108, h = 28, y = 12, bw = 96, bx = W - 14 - bw, x = bx - 8 - w;   // #202 clear of the corner L; #363 BACK at the right, VISUALS left of it
    drawTopBtn(g, bx, y, bw, h, '◀ BACK', false, !navCan(), 18);
    if (navCan()) SP_HIT.push({ x: bx - 4, y: 4, w: bw + 8, h: h + 16, act: navBack });
    drawTopBtn(g, x, y, w, h, 'PREVIEW', monOn);   // #389
    SP_HIT.push({ x: x - 6, y: 4, w: w + 10, h: h + 16, act: () => setMonitor(!monOn) });
  }
  { // #389 bottom menu bar: TOOLS, RESET MIX, STREAM, CLY3DTV, STUDIO
    const h = 28, y = H - 40, gap = 6; let x = 14;
    const S = streamer, tb = (label, on, act, dim, w) => { drawTopBtn(g, x, y, w, h, label, on, dim); if (!dim) SP_HIT.push({ x: x - 3, y: y - 8, w: w + 6, h: h + 14, act }); x += w + gap; };
    tb('TOOLS', !!(scroller && scroller.on), () => setTools('home'), false, 80);
    drawResetMix(g, x, y, 100, h); x += 100 + gap;   // #254
    tb(S && S.live ? '● LIVE' : 'STREAM', !!(S && S.live), () => setTools('stream'), !S, 82);
    tb('DIRROTV', !!(S && S.tvUp), () => setTools('tv'), !S, 88);
    tb('STUDIO', !!(S && S.stu.on), () => setTools('studio'), !S, 80);
    tb('WALL ⁺¹', ledMode !== 'off', () => setTools('wall'), false, 72);   // #439 the LED WALL page, one tap from the mixer
    drawLoopMainBtn(g, x, y, 74, h, 17); SP_HIT.push({ x: x - 3, y: y - 8, w: 80, h: h + 14, act: () => setTools('looper') }); x += 74 + gap;   // #470 LOOP: state colour, opens the LOOPER page
    if (testState.fps) {   // #258 live frame rate (kept for the console: window.vire)
      const st = fpsStats(); g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = '700 15px system-ui';
      g.fillStyle = !st ? '#8c96a8' : st.drops > 3 ? '#ff5050' : st.drops ? '#f1b650' : '#40d080';
      fitText2(g, st ? `${st.fps} fps · ${st.drops} dropped / 10 s · worst ${st.worst.toFixed(0)} ms` : 'measuring…', x + 6, y + h / 2, W - 180 - x); g.textBaseline = 'alphabetic';
    }
  }
  if (sp) {   // #174: MR GUI toggle + phone icon on deck A's top row, right-aligned to its panel (the divider stays clear)
    const right = W / 2 - 14, pw = 14, ph = 24, w = 108, h = 28, y = 12;
    const px = right - pw, x = px - 10 - w;
    drawTopBtn(g, x, y, w, h, 'MR GUI', sp.mr); drawPhoneIcon(g, px, y + (h - ph) / 2, pw, ph, sp.phone);
    SP_HIT.push({ x: x - 6, y: 4, w: w + 12, h: h + 16, act: () => spect.setMR(!sp.mr) });
  }
  mixScreen.commit();
}
// #254 RESET MIX (owner): PAN, EQ, FILTER and TRIM back to the middle, split cue off; gains ramp in ~50 ms (engine
// _ramp, worklet pan easing) so nothing clicks. Playback, records, faders, crossfader and pitch are left alone.
// Two taps within 3 s, like GEAR HERE, so a stray poke mid-mix can't flatten the EQ.
let resetArm = 0;
function resetMix() {
  for (const ch of ['A', 'B']) for (const k of ['trim', 'hi', 'mid', 'low', 'filter', 'pan']) setMix(`${ch}.${k}`, 0.5);
  if (splitCue) { splitCue = false; engine.setSplitCue(false); }
  toast('Mix reset: PAN, EQ, FILTER, TRIM centred, split cue off', 2000);
}
function drawResetMix(g, x, y, w, h) {
  const armed = performance.now() - resetArm < 3000;
  g.fillStyle = armed ? '#c8202c' : '#2a3140'; g.fillRect(x, y, w, h);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = armed ? '#fff' : '#c9ced8'; 
  btnLabel(g, armed ? 'TAP AGAIN' : 'RESET MIX', x, y, w, h, 15);   // #349 g.textBaseline = 'alphabetic';
  SP_HIT.push({ x, y: y - 4, w, h: h + 8, act: () => { if (performance.now() - resetArm < 3000) { resetArm = 0; resetMix(); drawMixScreen(); } else { resetArm = performance.now(); drawMixScreen(); setTimeout(drawMixScreen, 3100); } } });
}
// #210 GEAR HERE (in XR): tap twice within 3 s; a small pin status beside it
function drawPin(g, x, y, w, h) {
  if (!renderer.xr.isPresenting) return;
  const armed = performance.now() - gearHereArm < 3000;
  g.fillStyle = armed ? '#c8202c' : '#2a3140'; g.fillRect(x, y, w, h);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = armed ? '#fff' : '#c9ced8'; 
  btnLabel(g, armed ? 'TAP AGAIN' : 'GEAR HERE', x, y, w, h, 15);   // #349
  g.textAlign = 'right'; g.font = '600 13px system-ui'; g.fillStyle = /^pinned/.test(anchorMsg) ? '#40d080' : '#c9a040';
  g.fillText(anchorMsg ? (anchorMsg.length > 26 ? anchorMsg.slice(0, 25) + '…' : anchorMsg) : 'not pinned', x - 8, y + h / 2 + 1); g.textBaseline = 'alphabetic';
  SP_HIT.push({ x, y: y - 4, w, h: h + 8, act: () => { if (performance.now() - gearHereArm < 3000) { gearHereArm = 0; gearHere(); } else { gearHereArm = performance.now(); setTimeout(drawMixScreen, 3100); } } });
}
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---- #210 spatial anchor: all the gear (the rig) is pinned to the real room with a WebXR anchor, so re-centring,
// taking the headset off or walking out of the boundary no longer moves it. The anchor is kept (persistent handle,
// Quest Browser) and restored next session in the same room; up to 6 rooms are remembered (newest first). If no saved
// anchor restores, the rig starts where it always did and a new anchor is made there. GEAR HERE (mixer screen, tap
// twice) brings all the gear in front of you, facing you, and re-pins it. Only the anchor's heading is used: the rig
// stays upright on the floor.
const ANCH_KEY = 'vire.rigAnchors';
let rigAnchor = null, anchorPending = false, anchorBusy = false, anchorMsg = '', gearHereArm = 0;
const _aq = new THREE.Quaternion(), _ae = new THREE.Euler();
const anchorList = () => { try { return JSON.parse(localStorage.getItem(ANCH_KEY) || '[]'); } catch { return []; } };
const saveAnchorList = l => { try { localStorage.setItem(ANCH_KEY, JSON.stringify(l.slice(0, 6))); } catch {} };
async function anchorSetup(session) {
  rigAnchor = null; anchorPending = false; anchorMsg = '';
  if (!(window.XRFrame && XRFrame.prototype.createAnchor)) { anchorMsg = 'no anchors in this browser'; drawMixScreen(); return; }
  if (session.restorePersistentAnchor) for (const id of anchorList()) {
    try {
      const a = await session.restorePersistentAnchor(id);
      if (a) { a._id = id; rigAnchor = a; anchorMsg = 'pinned'; toast('Gear is where you left it in this room (pinned)', 3000); drawMixScreen(); return; }
    } catch {}
  }
  anchorPending = true;   // made at the rig's current pose on the next XR frame (createAnchor needs a frame)
}
async function anchorCreate(xf) {
  anchorPending = false; anchorBusy = true;
  try {
    rig.updateMatrixWorld();
    const p = rig.position, q = rig.quaternion;
    const a = await xf.createAnchor(new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w }), renderer.xr.getReferenceSpace());
    rigAnchor = a; anchorMsg = 'pinned';
    if (a.requestPersistentHandle) {
      try { const id = await a.requestPersistentHandle(); a._id = id; const l = anchorList().filter(x => x !== id); l.unshift(id); saveAnchorList(l); }
      catch (e) { anchorMsg = 'pinned (this session only)'; }
    } else anchorMsg = 'pinned (this session only)';
  } catch (e) { anchorMsg = 'not pinned: ' + e.message; }
  anchorBusy = false; drawMixScreen();
}
function anchorFollow() {   // per XR frame: the rig sits on the anchor (position + heading only)
  const xf = renderer.xr.getFrame && renderer.xr.getFrame(); if (!xf) return;
  if (anchorPending && !anchorBusy) { anchorCreate(xf); return; }
  if (!rigAnchor) return;
  let pose = null; try { pose = xf.getPose(rigAnchor.anchorSpace, renderer.xr.getReferenceSpace()); } catch {}
  if (!pose) return;   // not tracked this frame: keep the last pose
  const t = pose.transform;
  rig.position.set(t.position.x, t.position.y, t.position.z);
  _aq.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w); _ae.setFromQuaternion(_aq, 'YXZ');
  rig.rotation.set(0, _ae.y, 0);
}
function gearHere() {   // all the gear in front of the DJ, facing them, then a new anchor there
  const s = renderer.xr.getSession(); if (!s) { toast('Enter XR first'); return; }
  const old = rigAnchor; rigAnchor = null;
  if (old) { try { old.delete(); } catch {} if (old._id) { if (s.deletePersistentAnchor) s.deletePersistentAnchor(old._id).catch(() => {}); saveAnchorList(anchorList().filter(x => x !== old._id)); } }
  const xc = renderer.xr.getCamera(); xc.updateMatrixWorld();
  const head = new THREE.Vector3().setFromMatrixPosition(xc.matrixWorld), fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(xc.getWorldQuaternion(new THREE.Quaternion()));
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  rig.rotation.set(0, yaw, 0);
  const off = new THREE.Vector3(-0.05, 0, -0.62).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);   // the usual start offset, turned with you
  rig.position.set(head.x + off.x, 0, head.z + off.z);
  anchorPending = !!(window.XRFrame && XRFrame.prototype.createAnchor); anchorMsg = anchorPending ? 'pinning…' : 'not pinned';
  toast('Gear moved in front of you' + (anchorPending ? ' and pinned to the room' : ''), 3000); drawMixScreen();
}

// ------------------------------------------------------------------ frame loop
const clock = new THREE.Clock();
const camFwd = new THREE.Vector3(), camDown = new THREE.Vector3(), camRight = new THREE.Vector3();
const qFace = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.35, 0, 0));
const qHoldXR = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2)); // disc +Y -> hand +X
const qHoldXR2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)); // #363 disc +Y -> hand -X
const _hx = new THREE.Vector3(), _hh = new THREE.Vector3();
const _holdOff = new THREE.Vector3();

function wrapPi(a) { a %= 2 * Math.PI; return a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a; }
// #258 flicker hunt (owner): temporary test switches on the TOOLS page. GLASS TEST hides the tablet's glass plate;
// CAM 2ND FRAME draws AVACAM every 2nd headset frame (45 fps at 90 Hz) instead of every 3rd; FPS shows the real frame
// rate and the frames that took over 1.5x the usual time (dropped) in the last 10 s, on the tablet's main page.
const testState = { glass: false, cam2: false, fps: false };
const fpsLog = [];   // frame start times (ms), last 10 s
function fpsStats() {
  const now = performance.now(); while (fpsLog.length && now - fpsLog[0] > 10000) fpsLog.shift();
  if (fpsLog.length < 10) return null;
  const d = []; for (let i = 1; i < fpsLog.length; i++) d.push(fpsLog[i] - fpsLog[i - 1]);
  const srt = [...d].sort((a, b) => a - b), med = srt[srt.length >> 1];
  const last1 = fpsLog.filter(t => now - t < 1000).length;
  return { fps: last1, med, drops: d.filter(x => x > med * 1.5).length, worst: srt[srt.length - 1] };
}
function setTest(k) {
  testState[k] = !testState[k];
  if (k === 'glass' && mixer.userData.screenGlass) mixer.userData.screenGlass.visible = !testState.glass;
  if (k === 'fps') { clearInterval(setTest.iv); if (testState.fps) setTest.iv = setInterval(drawMixScreen, 1000); }
  drawMixScreen();
}
// #418 (owner: Full VR drops back to the 2D page). A throw anywhere in the frame skipped renderer.render, so the headset
// got no new frame and Quest Browser leaves immersive mode after a few empty frames. Now the frame always renders; the
// first error of each XR session is kept (xrDiag) and shown when the session ends.
const xrDiag = { t0: 0, frames: 0, err: '', errN: 0, mode: '' };
let frameT = 0;   // #423 the frame's own timestamp (XR: the headset frame time), for stamping hand readings
function frame(t) {
  if (t) frameT = t;
  if (renderer.xr.isPresenting) xrDiag.frames++;
  try { frameBody(); }
  catch (e) {
    xrDiag.errN++;
    if (!xrDiag.err) { xrDiag.err = (e && e.message || String(e)) + ' @ ' + ((e && e.stack || '').split('\n').find(l => /\.js:\d+/.test(l)) || '').trim().replace(/^at /, '').replace(/https?:\/\/[^ )]*\//, ''); console.error('frame', e); }
    try { renderer.render(scene, camera); } catch {}
  }
}
function frameBody() {
  // #440: tablet parts added later (lid, glass, corner L) and the slipmats never get edge-culled in the headset
  if ((frameBody._n = (frameBody._n || 0) + 1) % 60 === 1) {
    const nc = o => { if (o.isMesh) padCull(o); };
    mixer.userData.tablet && mixer.userData.tablet.traverse(nc);
    for (const d of decks) { const g = d && d.g; if (g && g.userData.slipmat) g.userData.slipmat.forEach(nc); if (g && g.userData.matPivot) g.userData.matPivot.traverse(nc); }
  }
  if (testState.fps) fpsLog.push(performance.now());   // #258
  const dt = Math.min(0.05, clock.getDelta());
  if (renderer.xr.isPresenting) anchorFollow();   // #210
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
  if (neon.visible) neon.userData.update(dt);   // random flicker bursts (#86); #235 not while switched off
  if (crateDisc.visible) { // record rides up out of its sleeve
    crateDisc.position.lerp(crateDisc.userData.target, Math.min(1, dt * 10));
    crateDisc.rotation.x = crateDisc.userData.tilt;
  }
  if (xr && renderer.xr.isPresenting) xr.update(dt);
  stepSleeves(dt);   // #229 / #242
  stepSpiders();   // #256

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
    // #275 (owner): the slipmat travels with the record, not the platter, so holding a 45 stops the mat showing
    // round it while the platter spins on underneath. Its own pivot inside the platter turns by how far the record
    // has slipped against the platter since it landed (accumulated, so no jump when a record goes on or off).
    if (u.slipmat && u.slipmat.length) {
      if (!u.matPivot) { u.matPivot = new THREE.Group(); u.platter.add(u.matPivot); u.platter.updateMatrixWorld(true); for (const m of u.slipmat) u.matPivot.attach(m); d.matSlip = 0; }
      if (d.prevRecA != null && (!d.record || !d.record.loose)) {   // #364 a bare mat held by hand slips too (the worklet's record angle is the mat's then)
        const sl = (d.recAngle - d.prevRecA) - (d.platterAngle - d.prevPlatA); if (Math.abs(sl) < 0.3) d.matSlip += sl; }   // a cue jump snaps the record, not the mat
      d.prevRecA = d.recAngle; d.prevPlatA = d.platterAngle;
      u.matPivot.rotation.y = -d.matSlip;
    }
    if (d.record) { d.record.group.rotation.y = -d.recAngle; d.record.updateFlip(dt); }
    const pw = d.power !== false ? 1 : 0;
    if (u.strobe) {
      const S = u.strobe, w = prate * W33;                       // rad/s (#120: the platter's dots)
      d.frameDt = (d.frameDt || 1 / 72) * 0.9 + Math.min(1 / 30, Math.max(1 / 120, dt)) * 0.1;
      S.uni.uBlur.value = Math.min(0.75, Math.abs(w) * d.frameDt * S.kU);
      // #266: the stud bumps fade out as the dots smear (the normal map isn't blurred, so at speed it drew
      // sharp bumps beside the smeared dots, a second image)
      if (S.mat && S.mat.normalMap) { const b = S.uni.uBlur.value, f = 1 - Math.min(1, Math.max(0, (b - 0.02) / 0.12)); S.mat.normalScale.set(f, f); }
      // strobe lamp: 100 flashes/s; per flash the dots advance a fraction `a` of their pitch (wrapped), so a
      // row stands still when the speed matches its calibration and drifts slowly either side of it
      const nom = W33 * d.speed, off = [0, 0, 0, 0];
      S.rows.forEach((r, k) => {
        const sR = w / (nom * (1 + r.p)); const a = sR - Math.round(sR);
        if (Math.abs(sR) < 0.5) {
          // #266 (owner: red dots beside the silver ones, a double image). Slow or stopped, a strobe just shows
          // the real dots, so the lamp's sample eases back onto them (it used to keep the offset it had when the
          // platter stopped, and the red copy sat between the dots).
          let o = r.phi - d.platterAngle; const pr = S.P / S.kU; o -= Math.round(o / pr) * pr;
          r.phi = d.platterAngle + o * Math.max(0, 1 - dt * 6);
        } else r.phi += a * S.F * (S.P / S.kU) * dt;           // apparent angle, rad (texture dot pitch)
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
    if (u.x2) { u.x2.userData.set(pw * (d.range > 0.1 ? 1 : 0.06)); if (u.x2.userData.led) u.x2.userData.led(pw * (d.range > 0.1 ? 1 : 0)); }   // #253
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
    const b1 = mc[d.name + '.beat1']; if (!b1) continue;   // LOOPER: deck B has no BEAT 1 button any more
    const bl = blinkUntil[d.i] - performance.now() / 1000;   // #117: cleared = 4 quick blinks
    b1.userData.set(bl > 0 ? (Math.floor(bl * 8) % 2 ? 1 : 0.02) : d.loaded && d.track && beat1Of(d.track) !== null && d.ledShown === 0 ? 1 : 0.06);   // #110: flashes on beat 1 once tapped
  }
  const nowSec = performance.now() / 1000;
  const tapAge = nowSec - tapFlashT;
  if (mixer.userData.tapRing) {
    mixer.userData.tapRing.opacity = tapAge < 0.28 ? Math.max(0, 1 - tapAge / 0.28) : 0;
  }
  if (mc.bpmtap) {
    if (tapAge < 0.28) {
      if (mc.bpmtap.userData.setColor) mc.bpmtap.userData.setColor(0xffea00);   // yellow flash on tap!
      mc.bpmtap.userData.set(1.4);
    } else {
      if (mc.bpmtap.userData.setColor) mc.bpmtap.userData.setColor(0xff3b30);   // return to red
      const bl = blinkUntil[0] - nowSec;
      mc.bpmtap.userData.set(bl > 0 ? (Math.floor(bl * 8) % 2 ? 1 : 0.02) : 0.06);
    }
  }
  if (mixer.userData.bpmCounter) {
    let txt = '---.--';
    if (tapTempo.times.length === 1 && nowSec - tapTempo.lastTap < 2.5 && tapTempo.bpm === 0) {
      txt = '--.- ';   // waiting for next tap
    } else if (tapTempo.bpm > 0) {
      txt = tapTempo.bpm.toFixed(2);
    }
    mixer.userData.bpmCounter.setText(txt);
  }
  {   // #470 LOOPER ring LED: off empty, red sampling (fast blink in the last 5 s), green looping, amber blinking stopped / armed,
    // a quick blink when cleared. The button's own legend follows the same colour, dimmer.
    stepLooper();
    const lbn = mc.looper, now = performance.now() / 1000, st = looper.state, ela = now - looper.t0, ring = mixer.userData.loopRing;
    const clr = now - looper.clearT < 0.8, blinkA = Math.floor(now * 2.5) % 2 === 0;
    const col = clr ? 0xffd040 : st === 'rec' ? 0xff2a20 : st === 'play' ? 0x40ff70 : st === 'stop' ? 0xffa018 : 0xff6a30;
    const lit = clr ? (Math.floor((now - looper.clearT) * 10) % 2 === 0) : st === 'rec' ? (ela < 25 || Math.floor(ela * 10) % 2 === 0) : st === 'play' ? true : st === 'stop' ? blinkA : false;
    if (lbn.userData.setColor) lbn.userData.setColor(col);
    lbn.userData.set(lit ? 0.8 : 0.06);
    if (ring) { ring.color.setHex(col); ring.opacity = lit ? 1 : 0; }
  }
  mc.splitcue.userData.set(splitCue ? (Math.floor(performance.now() / 350) % 2 ? 1 : 0.15) : 0.06);   // #254 flashes while split cue is on
  mc.mic.userData.set(micOn ? 0.75 + Math.min(0.6, micLevel() * 2) : 0.06);
  syncFlash.t = Math.max(0, syncFlash.t - dt);
  mc.sync.userData.setColor(syncFlash.color === 'red' && syncFlash.t > 0 ? 0xff3030 : 0x39a8ff);
  mc.sync.userData.set(0.15 + syncFlash.t);

  // held record floats in front of the camera
  stepLoose(dt);
  stepMilkCrates(dt);
  stepWallGlow(); stepBlobs();
  if (ledwall.visible || (streamer && streamer.active && streamer.source === 'show')) scroller.tick(dt);   // #342 also during PREVIEW   // #224 (#338 also for SHOWTIME! with the wall off) (#236 switched off: it keeps running for the phone, nothing drawn here)
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
    held.group.position.copy(held.attach.localToWorld(_holdOff.set(0, 0, -((held.dims || REC).R - 0.0174))));   // #257 held by its edge, 12" or 7"
    // #363 the face up (side A when the record has one) turns toward the eyes when the record is taken: the hand's +X
    // points right for both hands, so a fixed +X face showed the B side whenever it was held in the right hand
    if (held.holdFor !== held.attach) {
      held.holdFor = held.attach;
      _hx.set(1, 0, 0).applyQuaternion(held.attach.getWorldQuaternion(_wq));
      camera.getWorldPosition(_hh).sub(held.attach.getWorldPosition(_sp));
      held.qHold = _hx.dot(_hh) >= 0 ? qHoldXR : qHoldXR2;
    }
    held.group.quaternion.copy(held.attach.getWorldQuaternion(_wq)).multiply(held.qHold);
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
  stepMonitor(performance.now());   // #339
  if (chalkboard) {   // #395 whiteboard: the held marker's tip writes on the board or a milk crate label, the duster rubs out
    if (boardTools) boardTools.tick(dt, [chalkboard, ...milkLabels()], xr);
    if (chalkboard.on) chalkboard.tickBoard();
  }
  for (const lb of milkLabels()) lb.tick();   // #394 label ink: upload / save
  stepPlJump(dt);   // #394 playlist records jumping into a milk crate
  stepScrDir();    // #198 portrait menu
  if (ledMode === 'decks') ledwall.userData.setDecks(deckVid[0].tex, deckVid[1].tex, ...deckGains(mixVal));
  if (spect) {   // #158 spectator camera (nothing when off / no phone)
    try { spect.tick(dt); }   // #217: a spectator error must never stop the headset's frame (it froze on a record pull)
    catch (e) { if (!spectErrShown) { spectErrShown = true; console.error(e); toast('Spectator link error (headset keeps running): ' + e.message, 5000); } }
  }
  for (const gp of [gopro, gopro2]) if (gp) {   // #337 (#389 both cameras)
    gp.tick(dt);
    const showLive = streamer && streamer.live && streamer.source === 'show';
    gp.setTally(!!(streamer && streamer.state === 'live' && (streamer.source === 'show' || streamer.source === 'avacam')));
    if (gp.on) gp.setView(showLive && streamer.ly && streamer.layerOk ? streamer.ly.out.texture : (ledMode === 'cam' || gp.aiming || (streamer && streamer.needsCamRT)) && djcam ? djcam.rt.texture : null, !showLive, showLive);
  }
  camCalStep();   // #415
  stepRealWorld(dt);   // #411 depth occlusion on / off, room planes for the laser
  if (facetWall || laser) {   // #345; #346 BEAT: bass onsets on the master, read only while the wall is on with BEAT (#406 or the laser on AUTO)
    if (!beat) beat = new Beat(engine);
    beat.want = !!((facetWall && facetWall.on && facetWall.beat) || (laser && laser.on && laser.auto) || (dirro && dirro.on) || isFxMode(ledMode));   // #427 the phones follow the beat; #439 the wall visuals
    const bp = beat.tick(dt);
    if (facetWall) facetWall.tick(dt, streamer && streamer.env && streamer.env.wallSource, bp);
    if (laser && laser.on) laser.tick(dt, beat, camera.getWorldPosition(_laserCam));
  }
  stepWallFx(performance.now());   // #439
  if (dirro) dirro.tick(performance.now());   // #427
  if (dirroMark.want && xr && renderer.xr.isPresenting) {   // #438 the next trigger press (after 0.7 s) = the beacon, at the controller tip
    const now = performance.now();
    for (const st of xr.inputs) {
      if (!st.connected || st.isHand || !st.source || !st.source.gamepad || !st.tip) continue;
      const down = !!(st.source.gamepad.buttons[0] && st.source.gamepad.buttons[0].pressed), was = dirroMark.prev[st.i]; dirroMark.prev[st.i] = down;
      if (!down || was || now - dirroMark.t0 < 700) continue;
      const k = dirroMark.want; dirroMark.want = ''; dirro.setBeacon(k, rig.worldToLocal(st.tip.clone()));
      toast(`Beacon ${k === 'L' ? 'LEFT' : 'RIGHT'} marked`, 2000); xr.buzz && xr.buzz(st, 0.6, 60); break;
    }
  }
  if (portals) portals.tick();   // #345 #346
  if (domeBoot) { domeBoot = false; if (dome.on && !CAMERA_ROLE) setDome(true); }   // #346 a dome left on last time: load its sky once everything is up
  if (skySpin.speed > 0 && skybox.group.visible) { skySpin.ang = (skySpin.ang + skySpin.speed * DEG * dt) % (2 * Math.PI); applySkyTurn(); }   // #379 PANO SPIN
  if (fx) fx.preRender(dt);   // #379 FLOAT goes on here (every camera below sees it) and comes off after the frame; WATER uniforms
  if ((ledMode === 'cam' || (streamer && streamer.wantsCam) || (gopro && gopro.aiming) || (gopro2 && gopro2.aiming)) && djcam) stepDjCam(dt);   // #220 (#331 also while the stream shows AVACAM)
  stepArmSleeves();   // #347
  if (streamer) streamer.tick();   // #331
  renderer.render(scene, camera);
  if (fx) fx.postRender();   // #379 the floated gear back in its real place for hands, grabs and saving
}
// #427 DIRROGRAM: the show to the audience phones through the relay (dirro-host.js)
if (!CAMERA_ROLE) dirro = new DirroHost({ renderer, rig, camera, getXr: () => xr, handFit: () => (xr ? xr.handFit : null),   // #469 getBeat: () => tapBeat() || beat, tapBpm: () => (wtapOn() ? 60000 / wtap.iv : 0), laser, micLevel, nowPlaying: dirroNow,
  scrollText: () => (scroller && scroller.on ? scroller.text : ''),
  getLed: () => (ledMode === 'card' && cardWall.pic ? { img: true, name: 'card:' + cardWall.name, file: cardWall.file } : { img: !!(led.on && led.img), name: led.name, file: led.name ? led.fileNamed(led.name) : null }),   // #434 (#446 the card's still)   // #434 the LED wall's picture
  tvCanvas: () => (streamer && streamer.active ? streamer.canvas : null),   // #434 the stream / venue-screen picture
  // #439 FOLLOW: what the LED wall shows, the GRAB LOOP sheets, and the wall's own clip / live picture for the frames
  wallState: () => ({ m: ledMode === 'clips' ? (led.img ? 'pics' : 'clips') : ledMode === 'card' ? (cardWall.loop ? 'card' : 'pics') : ledMode === 'vdancer' && vd.sel >= 0 && vd.slots[vd.sel] ? 'vmat' : ledMode, rp: vd.rp, mp: vd.mp, px: wallPx, s: ledFx.s, t0: Math.round(ledFx.t0), lp: ledMode === 'card' && cardWall.loop && cardWall.loop.d ? cardWall.loop.id : ledMode === 'retro' && ledFx.s === 'loop' && ledFx.loop && ledFx.loop.d ? ledFx.loop.id : '', ln: cardWall.loop ? cardWall.loop.n : 0, lf: cardWall.loop ? Math.round(cardWall.loop.fps * 10) / 10 : 0, lt0: Math.round(ledFx.loopT0) }),
  loopData: id => { const l = grab.loops.find(x => x.id === id); return l ? l.d : cardWall.loop && cardWall.loop.id === id ? cardWall.loop.d : null; },
  wallFrame: () => (ledMode === 'vdancer' ? fxBig : ledMode === 'clips' && led.video ? led.video : isLive(ledMode) || ledMode === 'screen' ? liveVideo : ledMode === 'decks' ? deckVid[0].v : streamer && streamer.active ? streamer.canvas : null),
  sineText: t => { const c = cleanText(t, 120); if (c.trim()) { scroller.start(c); toast('On the sine scroller', 1500); } },   // #435 a HoloSMS on the Quest's own scroller
  onSms: t => toast('HoloSMS: ' + (t.length > 46 ? t.slice(0, 45) + '…' : t), 2500),
  onChange: () => { if (toolsPage === 'dirro' || toolsPage === 'home' || toolsPage === 'holosms' || toolsPage === 'wall') drawMixScreen(); } });
renderer.setAnimationLoop(frame);
// #220 DJ CAM: pose the avatar (headset: head + hands; desktop: a demo DJ), then render the camera into the LED wall
const _djT0 = performance.now();
const DJ_HIDE_NEON = new Set(['front', 'low', 'faders']);   // #338 the GOPRO sees what is in front of it
function djGear() {
  return { deckA: deckGroups[0].position, deckB: deckGroups[1].position, mixer: mixer.position, crate: crateRig.position, top: deckGroups[0].position.y + DECK.H };
}
function djPrep() {   // what the camera must not see: the LED wall itself, XR hand / controller models and occluders
  const undo = [], hide = o => { if (o && o.visible) { o.visible = false; undo.push(o); } };
  if (ledMode === 'cam') hide(ledwall);   // #372 only when the wall itself shows AVACAM (it would film itself); otherwise the wall is in the shot like any prop
  if (streamer ? !streamer.showOpt.neon : DJ_HIDE_NEON.has(djSet.preset) && !gpActive()) hide(neon);   // #372 the OBJECTS toggle decides (its back faces FRONT / FADERS / low, which is accepted when it is on); no streamer (phone): the old rule, #337 the GoPro sees what it sees
  if (xr) for (const st of xr.inputs) { hide(st.hand); hide(st.grip); hide(st.tipDot); hide(st.hitDot); hide(st.occS); hide(st.occC); hide(st.ray); if (st.ctlHand) hide(st.ctlHand.root); }
  if (xr && xr.glove) hide(xr.glove.root);   // #287 the DJ CAM robot has its own gloves
  if (gopro && gopro.on) hide(gopro.obj);   // #337 #372 hidden only from its own camera
  if (gopro2 && gopro2.on) hide(gopro2.obj);
  const bg = scene.background, roomV = room.visible;
  if (!bg && !skybox.group.visible) { scene.background = BG; room.visible = true; }   // passthrough: studio floor + dark backdrop for the camera
  return () => { for (const o of undo) o.visible = true; scene.background = bg; room.visible = roomV; };
}
function stepDjCam(dt) {
  const gear = djGear(), xrOn = renderer.xr.isPresenting;
  const pose = xrOn ? xrPose(renderer, xr && xr.inputs) : demoPose(rig, gear, (performance.now() - _djT0) / 1000);
  if (avatar && avatar.ready && avatar.root.visible) {   // #221 robot or human
    try { avatar.update({ ...pose, floorY: rig.getWorldPosition(_djFloor).y, mic: micLevel(), dt }); }
    catch (e) { if (!stepDjCam.err) { stepDjCam.err = true; console.error(e); toast('Avatar error (headset keeps running): ' + e.message, 5000); } }
  }
  const dj = rig.worldToLocal(pose.head.p.clone());
  const gcam = gpActive(); if (gcam) goproToDjcam(gcam); else djcam.aimAt(gear, dj);   // #337 the GoPro, when it is out, is the camera
  if (ledMode === 'cam' || !streamer || streamer.needsCamRT || ((gopro && gopro.aiming || gopro2 && gopro2.aiming) && !(streamer.live && streamer.source === 'show'))) djcam.render(scene, dt, xrOn ? (testState.cam2 ? 2 : 3) : 2, djPrep);   // #258 CAM 2ND FRAME test (#336: SHOW renders its own layer from this camera)
  else djcam.t += dt;
}
const _djFloor = new THREE.Vector3();
function robotNeon() {   // #355 the AVACAM robot's helmet and gloves reflect the neon room (HAND FIT > NEON CHROME, on by default)
  let on = true; try { on = !xr || xr.handFit.neon !== 0; } catch (e) {}
  if (avatars.robot && avatars.robot.root) applyNeon(avatars.robot.root, renderer, on);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ #379 VISUALS > FX: FLOAT and WATER (fx.js)
const FX_LABEL = { deckA: 'DECK A', deckB: 'DECK B', mixer: 'MIXER', crate: 'RECORD CASE', milk: 'MILK CRATE', neon: 'NEON SIGN', ledwall: 'LED WALL' };
const _fxT = new THREE.Vector3();
function fxCandidates() {   // what a FLOAT ball can sit on (and what can ride on floated gear)
  const out = [];
  for (const k in stage.items) { const o = stage.items[k].obj; if (o.parent && o.visible) out.push({ key: k, obj: o, label: FX_LABEL[k] || (k.startsWith('milk') ? 'MILK CRATE ' + k.slice(4) : k.toUpperCase()) }); }
  for (const k in cases) { const c = cases[k], g = c.group; out.push({ key: k, obj: g, label: 'FLIGHT CASE', top: () => rig.localToWorld(_fxT.set(g.position.x, g.position.y + c.H, g.position.z)).y }); }
  for (const d of decks) if (d.record && d.record.group && d.record.group.parent) out.push({ obj: d.record.group, label: 'RECORD ON ' + d.name });
  for (const sl of sleeves) if (!sl.anchor && !sl.back && sl.g.parent) out.push({ obj: sl.g, label: 'SLEEVE' });
  for (const l of loose) if (l.rec && l.rec.group.parent) out.push({ obj: l.rec.group, label: 'RECORD' });
  return out;
}
if (!CAMERA_ROLE) {
  camera.layers.enable(USER_LAYER);   // the desktop camera draws the DJ-only helpers; the headset's eye cameras get it from fx.preRender
  fx = new FX({
    rig, renderer, camera, toast, candidates: fxCandidates,
    gearRoots: () => [...deckGroups, mixer, crateRig, ...milks(), ...Object.values(cases).map(c => c.group), ...sleeves.map(s => s.g)],
    skipRoots: () => [crateDisc, held && held.group, ...decks.map(d => d.record && d.record.group), ...loose.map(l => l.rec && l.rec.group), ...sleeves.map(s => s.disc)],   // records keep their own groove shader (DO NOT BREAK)
    sky: () => skybox.group.visible && skybox.tex ? { tex: skybox.tex, so: skybox.mats[0].uniforms.so.value, group: skybox.group } : null,
    waterHome: () => { const g = cases.caseA.group; return { p: new THREE.Vector3(g.position.x, 0.12, g.position.z), yaw: g.rotation.y }; },
    isDeck: o => o === deckGroups[0] || o === deckGroups[1], afterFloat: () => { if (deckInst) deckInst.update(); },
  });
}
// ------------------------------------------------------------------ XR input (hands + controllers)
const xr = CAMERA_ROLE ? null : setupXR({   // #161: the phone has no hands or controllers to drive
  renderer, scene, crateRig, crate, mixer, decks, MOVABLE, saveLayout, mixVal, heldPitch, sleeveMap, crateState,
  stage, cases, resizeCase, deckGroups, clampStack, settleStack, gearLocked, gearLockMsg, snapYaw: isDeckKey,   // #378
  REC, DECK, CRATE, ARM,
  castRay, interactive, pointerDown, pointerMove, pointerUp, tabletGrab, tabletHold, tabletRelease, tabletScale, saveTablet, gopro, get props() { return [gopro, gopro2, laser, ...(boardTools ? boardTools.props() : []), chatPanel, chalkboard, ...(portals ? portals.active() : []), facetWall, ...(fx ? fx.props() : [])].filter(Boolean); },   // #379 + FLOAT balls, WATER   // #337 #340 #345 #346 (every portal frame that is out)
  setMix, pressControl, setPitch, setPower, pitchFromLocalZ, sliderFromLocal, setLastTouched: i => { lastTouched = i; },
  scratchBegin, scratchMove, scratchEnd, spindleTwist, spindleHold, spindleRelease,
  deckState: d => ({ st: engine.state.decks[d.i], driving: !!d.motorOn && d.power !== false, model: settings.deckModel }),   // #120 haptics
  armGrab, armDrag, armRelease,
  needleDown: d => !!(d.record && ((engine.state.decks[d.i] && engine.state.decks[d.i].needle) || (d.arm && (d.arm.lift < 0.5 || d.arm.dragDown)))),   // #451
  getHeld: () => held, pullSelected, pickUpFromDeck, releaseHeld, loose, pickUpLoose,
  sleeveGrabTest, sleeveGrab, sleeveHeldBy, sleeveSlideTest, sleeveSlideTo, sleevePulled, sleeveRelease, spiderGrabTest, spiderGrab, spiderRelease,
  crateScreenPress, crateScreenRelease, mixScreenPress, holdBeat1, releaseBeat1, holdLooper, crateSelect, crateWalkStep, drawCrateScreen, layoutSleeves, crateDisc,
  onA: st => gpSummon(st),   // #404 right controller A: the camera GoPro to that hand
  neon, NEON, setNeonScale, saveNeonScale, releaseMilk, MILK, flyingMilk, ledwall, setLedScale, saveLedScale, LED, ledTurned, ledTilted, toast, mixScreenRelease, mixScreenDrag,
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
    const base = ['local-floor', 'bounded-floor', 'hand-tracking', 'anchors'];   // #210 anchors
    let session = null;
    if (mode === 'immersive-ar') {   // #411 (#408 depth test): Quest 3 depth for occlusion, Space Setup planes for the laser
      try { session = await navigator.xr.requestSession(mode, { optionalFeatures: [...base, 'depth-sensing', 'plane-detection'], depthSensing: { usagePreference: ['gpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] } }); }
      catch (e) { console.warn('depth / planes refused, plain passthrough', e); }
    }
    if (!session) session = await navigator.xr.requestSession(mode, { optionalFeatures: base });
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setFoveation(0.5);
    await renderer.xr.setSession(session);
    if (session.updateTargetFrameRate && session.supportedFrameRates) {
      const want = 72;   // #267 (owner): 72 Hz, 90 dropped ~13 frames per 10 s on the Quest 3
      const rates = [...session.supportedFrameRates];
      if (rates.includes(want)) session.updateTargetFrameRate(want).catch(() => {});
    }
    rig.position.set(-0.05, 0, -0.62); rig.rotation.set(0, 0, 0);
    anchorSetup(session);   // #210 pin the gear to the room (restores the saved pin in a known room)
    xr.setHandMode('3d');   // #268 (owner): no passthrough cut-out for tracked hands; always the 3D hands
    // passthrough rooms are much dimmer than the studio environment: tone reflections down so metal isn't self-lit
    arMode = mode === 'immersive-ar';
    if (mode === 'immersive-ar') { scene.background = null; room.visible = false; skybox.group.visible = skyShadow.visible = false; scene.environmentIntensity = settings.arRefl / 100; if (dome.on) applySky(); }   // #346 the dome shows in passthrough
    else applySky();   // #182: stereo panoramas split per eye while presenting   // #180: was a fixed 0.28, now Settings > Reflections in passthrough (default 60 %)
    tidyRecords();   // #242 every VR / passthrough start: records lying about go back into the crate
    Object.assign(xrDiag, { t0: performance.now(), frames: 0, err: '', errN: 0, mode });
    session.addEventListener('visibilitychange', () => { if (session.visibilityState !== 'visible') xrDiag.vis = session.visibilityState; });
    session.addEventListener('end', () => {   // #418 why did it end?
      const secs = ((performance.now() - xrDiag.t0) / 1000).toFixed(1);
      const msg = `${xrDiag.mode === 'immersive-vr' ? 'Full VR' : 'Passthrough'} ended after ${secs} s, ${xrDiag.frames} frames` + (xrDiag.vis ? `, last state ${xrDiag.vis}` : '') + (xrDiag.err ? ` · ${xrDiag.errN} frame errors, first: ${xrDiag.err}` : ' · no frame errors');
      try { localStorage.setItem('vire.xrLastEnd', new Date().toISOString() + ' ' + msg); } catch {}
      console.warn(msg); setTimeout(() => toast(msg, 15000), 300);
    });
    session.addEventListener('end', () => { rigAnchor = null; anchorPending = false; rig.rotation.set(0, 0, 0); arMode = false; applyShadows(false); xr.end(); rig.position.set(0, 0, 0); applySky(); scene.environmentIntensity = envLight.intensity; });
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
    skyKeyLight = im.width ? brightestDir(im) : null; skyAvg = im.width ? panoAvg(im) : null;
    if (settings.sky === 'on') await ensureSky();
  } else { envLight.setImage(null); skyKeyLight = null; skyAvg = null; }
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
  envLight.setImage(c); skyKeyLight = brightestDir(c); skyAvg = panoAvg(c);
  if (L) { try { closeSkyVideo(); await skybox.load(f, L.layout, L.swap); skybox.setHeight(settings.skyH); } catch (e) { skybox.setImage(null); toast('Panorama too big for this device: ' + e.message, 4000); } }
  else skybox.setImage(null);
  skyInfo(dims, L); applySky();
}
async function ensureSky(force) {   // full-size panorama from storage, loaded when first shown (#346 force: for the DOME, whatever the light setting)
  if (skybox.tex || (settings.env !== 'image' && !force)) return;
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
  envLight.setImage(c); skyKeyLight = brightestDir(c); skyAvg = panoAvg(c);
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
// #379 PANO SPIN (VISUALS > PANO, 0 to 5 = degrees a second): the panorama (and the light and reflections taken from it) turns slowly
// round the booth. Stopping leaves it where it got to; the saved per-picture TURN is not changed.
const skySpin = { speed: 0, ang: 0 };
/* #389 PANO SPIN has no control any more (PANO TURN is a manual bar), so a saved spin is ignored */
function setSkyTurn(v) {   // #389 the PANO TURN bar (same as the start page's Pano turn slider)
  settings.skyTurn = clamp(Math.round(v), 0, 359); const el = $('#sSkyTurn'); if (el) { el.value = settings.skyTurn; const t = $('#skyTurnVal'); if (t) t.textContent = settings.skyTurn + '°'; }
  saveSettings(); saveSkyPrefs(); applySky(); drawMixScreen();
}
function setSkySpin(v) { skySpin.speed = clamp(Math.round(v * 4) / 4, 0, 5); try { localStorage.setItem('vire.skySpin', String(skySpin.speed)); } catch {} }
function applySkyTurn() {
  const full = !arMode && settings.env === 'image' && settings.sky === 'on' && !!skybox.tex;
  const domeOn = !CAMERA_ROLE && dome.on && !!skybox.tex;
  const turn = (settings.env === 'image' ? settings.skyTurn * DEG : 0) + skySpin.ang;
  skybox.setTurn(domeOn ? settings.skyTurn * DEG + skySpin.ang + dome.turn * DEG : turn); scene.environmentRotation.set(0, turn, 0); scene.backgroundRotation.set(0, turn, 0);
  // key light from the picture's brightest area (windows, lamps), at least 35 deg up so shadows stay short
  if (full && settings.skyKey === 'on' && skyKeyLight) {
    const d = _skyD.copy(skyKeyLight.dir).applyAxisAngle(_yAxis, turn);
    const hz = Math.hypot(d.x, d.z) || 1, up = Math.max(d.y, Math.sin(35 * DEG)), k = Math.sqrt(1 - up * up) / hz;
    key.position.set(d.x * k, up, d.z * k).multiplyScalar(2.7).add(key.target.position);
    key.color.setRGB(1, 1, 1).lerp(skyKeyLight.color, 0.5);
  } else { key.position.copy(KEY_POS); key.color.setRGB(1, 1, 1); }
}
const _skyD = new THREE.Vector3();
function applySky() {
  const want = !arMode && settings.env === 'image' && settings.sky === 'on';
  const full = want && !!skybox.tex, bg = want && !full && envLight.skyTex;
  const domeOn = !CAMERA_ROLE && dome.on && !!skybox.tex;   // #346 the DOME: this sky in any mode, passthrough too, at its own size
  scene.background = arMode ? null : bg ? envLight.skyTex : full ? null : BG;
  skybox.group.visible = full || domeOn; skyShadow.visible = full;
  skybox.setRadius(domeOn ? dome.r : 20);
  if (skyVid) { if (full || domeOn) skyVid.play().catch(() => {}); else skyVid.pause(); }   // #185 video pano only decodes while shown
  skybox.setStereo(renderer.xr.isPresenting);
  room.visible = !arMode && !full && !bg && !domeOn;
  applySkyTurn();   // #379 turn + key light, also called every frame while PANO SPIN runs
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
$('#bMediaAdd').onclick = () => $('#fMedia').click();   // #234
$('#fMedia').onchange = async e => {
  const fs = [...e.target.files]; e.target.value = ''; if (!fs.length) return;
  const info = $('#mediaAddInfo'), say = t => { info.textContent = t; };
  say(await importMedia(fs, null, say));
};
$('#fLed').onchange = e => {
  const all = [...(e.target.files || [])], n = led.setFiles(all);
  $('#ledList').textContent = n ? `${n} video${n > 1 ? 's' : ''}: ${led.files.map(f => f.name).join(' · ')}` + (all.length > 5 ? '  (only the first 5 are used)' : '') : 'No playable videos in that pick (mp4 / webm).';
  drawMixScreen();
};
$('#cOccl').onchange = e => { settings.occlusion = e.target.checked; saveSettings(); drawMixScreen(); };   // #411
$('#cRoomHits').onchange = e => { settings.roomHits = e.target.checked; saveSettings(); drawMixScreen(); };
$('#sArRefl').oninput = e => { settings.arRefl = +e.target.value; saveSettings(); $('#arReflVal').textContent = settings.arRefl + '%'; if (arMode) scene.environmentIntensity = settings.arRefl / 100; };
$('#sEnvMix').oninput = e => { settings.envMix = +e.target.value; saveSettings(); envLight.setMix(settings.envMix / 100); $('#envMixVal').textContent = settings.envMix + '%'; };

// ---- settings UI
function syncSettingsUI() {
  $('#sSource').value = settings.source; $('#sXml').value = settings.xml; $('#sHands').value = xr ? xr.getCtlLook() : '3dhands';   // #286 same switch as DJ TOOLS > CONTROLLERS
  $('#sGlow').value = settings.glow; $('#sShadows').value = settings.shadows; $('#sMicRoute').value = settings.micRoute; showMicRoute();
  $('#sEnv').value = settings.env; $('#sEnvMix').value = settings.envMix; $('#envMixVal').textContent = settings.envMix + '%';
  $('#sSpect').value = settings.spect; $('#rowSpect').hidden = settings.spect !== 'on'; $('#spectCode').textContent = spectCode();
  $('#sDeckModel').value = settings.deckModel; $('#sRecWeight').value = settings.recWeight; $('#sSlipmat').value = settings.slipmat; $('#cPll').checked = !!settings.pll;
  $('#bEnvImg').hidden = settings.env !== 'image'; $('#rowEnvMix').hidden = settings.env === 'studio';
  $('#sArRefl').value = settings.arRefl; $('#arReflVal').textContent = settings.arRefl + '%';
  $('#cOccl').checked = settings.occlusion !== false; $('#cRoomHits').checked = settings.roomHits !== false;   // #411
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
    : `Storage on ${location.host} is NOT persistent yet: the browser may clear it when it closes. Press "Keep songs on this headset", and if it is refused, install DirroDJ from the browser menu (Install app / Add to home) and open it from there. Always use the same address; a different address has separate storage.`;
  $('#bPersist').hidden = p;
}
$('#bPersist').onclick = async () => {
  let ok = false; try { ok = await navigator.storage.persist(); } catch {}
  toast(ok ? 'Songs will be kept' : 'The browser refused: install DirroDJ as an app and open it from there', 5000); showPersist();
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
{ const k = $('#sTwitchKey'); if (k) { k.value = streamKey.get(); k.addEventListener('change', () => { streamKey.set(k.value); drawMixScreen(); }); } }   // #331
{ const c = $('#sTwitchChan'); if (c) { c.value = chatChannel.get(); c.addEventListener('change', () => { chatChannel.set(c.value); if (chat) { chat.stop(); chat.tries = 0; if (chatChannel.get()) chat.start(); } }); } }   // #340
$('#sHands').addEventListener('change', e => { if (xr) { xr.setCtlLook(e.target.value); drawMixScreen(); } });   // #286 (owner) 3D hands / controllers from the start page
for (const [id, k] of [['#sSource', 'source'], ['#sXml', 'xml'], ['#sEnv', 'env'], ['#sGlow', 'glow'], ['#sShadows', 'shadows'], ['#sMicRoute', 'micRoute'],
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
  engine.post({ type: 'physics', model: settings.deckModel, recMass: (+settings.recWeight || 180) / 1000, mat: settings.slipmat, pll: !!settings.pll,
    fricK: FEEL.fric / 100, nudgeK: FEEL.nudge / 100, spinK: FEEL.spin / 100 });   // #423 TURNTABLE FEEL
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
    if (settings.spect === 'on' && !spect) spect = m.startHost({ code: spectCode(), stage, rig, scene, renderer, camera, toast, perf, getInputs: () => xr && xr.inputs,
      getRecords: () => [decks[0].record, decks[1].record, held, ...loose.map(l => l.rec)].filter(Boolean), artBlobs, getLed: () => ({ ...led.state(), curve: ledwall.userData.curveDeg() }),   /* #358 */ onScreen: onPhoneScreen, getScroll: () => ({ on: scroller.on, text: scroller.text, wave: scroller.wave, speed: scroller.speed }), onLive: onLiveTrack, coverFor,   // #218
      getSpiders: spidersState,   // #262
      getAv: phoneRobotState,   // #278
      getLook: () => xr ? xr.getCtlLook() : '3dhands',   // #288
      getHandFit: () => xr ? xr.handFit : undefined,   // #291
      getVV: () => ({ mode: ledMode, gains: deckGains(mixVal), decks: deckVid.map((dv, i) => dv.v ? [i, dv.key, engine.ctx ? engine.pos(i) : 0, engine.state.decks[i].rate || 0] : null).filter(Boolean) }),
      getSky: () => ({ h: settings.skyH, turn: settings.skyTurn, type: settings.skyType, key: settings.skyKey, file: settings.skyFile, media: settings.env === 'image' ? settings.skyMedia : '' }),
      onMedia: () => { refreshLibVV(); if (videoPage && vpFolder !== 'Sync') vpLoad(); },
      onCam: m => { if (m && pvWanted && !m.pv && spect) spect.camSet({ what: 'preview', v: true }); if (videoPage && vpFolder === 'Camera') drawMixScreen(); },   // a reconnected phone gets PREVIEW back
      onPreview: onPreviewFrame,
      onStudio: (w, m) => { if (streamer) streamer.onStudio(w, m); } });   // #380 S8 STUDIO
  } catch (e) { toast('Spectator camera failed to start: ' + e.message, 4000); }
}
syncSettingsUI();
if (!CAMERA_ROLE) applySpect();
applyEnv();
if (!CAMERA_ROLE) loadLibrary();
if (!CAMERA_ROLE) restoreLedList();   // #222
drawMixScreen();
// debugging handle
try { const cn = localStorage.getItem('vire.cardPic'); if (cn && streamer) media.getFile('Images', cn).then(f => { if (f) { streamer.setCardPic(f); cardWallSet(f, false); } }).catch(() => {}); } catch (e) {}   // #445 the CARD picture of last time
window.vire = { THREE, wfx, ledFx, grab, grabLoop, cardWallSet, cardWall, setWallPx, tapWall, tapClear, wtap, stepWallFx, fxBig, setWallAuto, /* #439 */ mixScreenDrag, mixScreenRelease, get fx() { return fx; }, get dirro() { return dirro; }, /* #435 */ skySpin, setSkySpin, /* #379 */ crateWalkStep, _lblOver, _nav: { back: navBack, get hist() { return navHist.length; }, get state() { return navState(); } } /* #363 */, _vpSet: (f, lp) => { vpFolder = f; if (lp) lookPage = lp; toolsPage = null; videoPage = true; vpLoad(); drawMixScreen(); }, _scr: { land: mixScreen.canvas, port: mixScreenP.canvas, setDir: d => { scrDir = d; drawMixScreen(); } } /* #347 test hook */, get streamer() { return streamer; }, setTools, gopro, goproTap, setMonitor, monCanvas, chat, chatPanel, chalkboard, chatPanelTap, facetWall, wallTap, portals, portalsTap, get beat() { return beat; }, dome, setDome, setDomeSize, skybox, get avatar() { return avatar; }, avatars, djcam, djSet, setDjPreset, setDjMirror, setDjAvatar, setDjStyle, perf, perfToggle, get spect() { return spect; }, TABLET, get scrDir() { return scrDir; }, drawMixScreen, tabletHold, tabletRelease, tabletDock, tabletScale, tabletGrab, setPreview, pvLid, get pvLidT() { return pvLidT; }, media, setVideoPage, vpAct, get vp() { return { videoPage, vpFolder, vpItems, vpSel, vvOverride }; }, useSkyMedia, led, ledwall, setLedScale, deckVid, setLedMode, get ledMode() { return ledMode; }, layoutSleeves, copiesOut, crateDisc, mixScreenPress, mixScreenRelease, bpmMode, tapBeat1, beat1Of, bpmOf, taps, tapRuns, stepTaps, releaseBeat1, clearTaps, loadTapsSidecar, spawnMilk, removeMilk, extraMilk, flyingMilk, placeMilk, milks, releaseMilk, stepMilkCrates, lidGrab, lidRelease, lidSet, lidShut, setMix, neon, setNeonScale, search, setQuery, exitSearch, crateScreenPress, crateScreenRelease, drawCrateScreen, setPiece, pieceOn, lidToggle, lidSt, crateLidOpen, stepLid, milk, milkDrop, armGrab, armDrag, armRelease, pressControl, get micOn() { return micOn; }, stepLoose, testThrow() { const h = held; throwRecord(h); held = null; return h; }, _spin: { SPIN, startSpin, get loose() { return loose; } }, _spider: { spiders, spiderGrabTest, spiderGrab, spiderRelease, spidersHome, stepSpiders, spidersState, spidersApply }, _sleeve: { sleeveGrabTest, sleeveGrab, sleeveSlideTest, sleeveSlideTo, sleevePulled, sleeveReturn, sleeveRelease, sleevesHome, tidyRecords, sleeves, refreshSleeveColliders, get colliders() { return sleeveColliders; }, sleeveFollow, sleeveDepen, sleeveBox, obbPush, obbOf, mkObb, get out() { return sleeveOut; }, selectedSlotPose }, surfaceUnder, supportUnder, stage, cases, crateRig, clampStack, settleStack, stackTops, envLight, deckInst, renderer, loose, releaseHeld, crate, mixer, mixVal, xr, engine, decks, get lib() { return lib; }, crateState, pullSelected, placeOnDeck, doSync, setPitch, setMotor, dropNeedleAt, get held() { return held; }, camera, controls, setCam, skybox, applySky, key, scene, settings };
window.vire._loop = { loopUndo, loopUndoDo, loopDeleteBank, looper, loopSlots, loopUI, pressLooper, clearLooper, loopSlotTap, loopRegion, loopNudge, loopSaveBank, loopLoadBank, loopOpenBanks, stepLooper, releaseLooper };   // #470 test hook
window.vire._art = { art, maker, openArtPage, runArtSearch, openArtRelease, useArt, pressRecord, get plNow() { return plNow; } };
window.vire._laser = { laser, laserTap, camCal, camCalStart, camCalStop };   // #415 camCal test hook   // #406 test hook
window.vire._wb = { boardTools, milkLabels, plToMilk, stepPlJump, milkSleeveHit, layoutMilkSleeves, gpSummon, goproReset, gopro2, setDomeEv, get plJump() { return plJump; }, msFly };   // #394 / #395 test hooks   // #392 / #393 test hooks
window.__vireStage = 'ready'; window.__vireReady = true;   // #138
// #161 spectator phone: same scene, no audio / library / input; the client module takes over the loop
if (CAMERA_ROLE) {
  $('#start').style.display = 'none'; const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
  import('./spectator-client.js').then(m => m.startCamera({ THREE, renderer, scene, camera, rig, room, stage, cases, decks, deckInst, neon,
    newMilk, stepWallGlow, stepBlobs, Record3D, BG, led, scroller, skybox, envLight, key, crateRemote })).catch(e => { document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:0;left:0;right:0;color:#fbb;background:#300;padding:8px;z-index:99">Spectator failed: ${e.message}</pre>`); });
}
