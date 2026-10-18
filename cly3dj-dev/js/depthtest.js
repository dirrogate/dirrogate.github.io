// #408 QUEST DEPTH TEST (owner, #371 order: depth test first). A stand-alone probe page (depthtest.html), not part of
// the app: what Quest Browser gives a web page about the real room and what it costs.
//  - depth-sensing: usage / format the browser picked, size, near / far, how often a frame has valid depth
//  - OCCLUSION: three r169 (our vendored copy) draws the depth map into the depth buffer by itself when the session has
//    depth-sensing (WebXRDepthSensing, getDepthSensingMesh). Coloured pillars at known distances, a cube grid at hand
//    height and a laser fan show whether real things (hands, people, furniture) hide virtual ones in the right place.
//  - DEPTH COLOURS: the depth map as colour with a contour line every 0.5 m (a first look at 'crowd contours').
//  - ROOM: planes (walls / floor / ceiling / tables from Space Setup) as outlines, room meshes as wireframe, by label.
//  - frame rate per mode (72 Hz target, as the app).
// Results are shown on the page after exiting, copied with 'Copy report', and kept in localStorage 'vire.depthtest'.
import * as THREE from 'three';
import { Laser } from './laser.js';

const out = document.getElementById('out'), goB = document.getElementById('go'), copyB = document.getElementById('copy');
const MODES = ['OCCLUSION', 'NO OCCLUSION', 'DEPTH COLOURS', 'ROOM PLANES + MESH'];
const R = { when: new Date().toISOString(), ua: navigator.userAgent, ar: null, request: null, session: null, depth: null, depthChecks: 0, depthValid: 0, cpuCentre: null,
  planes: {}, planeCount: 0, meshes: {}, meshCount: 0, roomCapture: null, modes: {}, errors: [] };
const err = (where, e) => { const m = `${where}: ${e && e.message || e}${e && e.stack ? ' @ ' + String(e.stack).split('\n')[1]?.trim() : ''}`; if (!R.errors.includes(m) && R.errors.length < 12) R.errors.push(m); };
addEventListener('error', e => err('page', e.error || e.message));
addEventListener('unhandledrejection', e => err('promise', e.reason));

function report() {
  const L = [];
  L.push(`Cly3DJ depth test  ${R.when}`, `Browser: ${R.ua}`, `immersive-ar supported: ${R.ar}`);
  if (R.request) L.push(`Session asked with: ${R.request}`);
  if (R.session) {
    const s = R.session;
    L.push('', 'SESSION', `  features granted: ${(s.enabledFeatures || ['(not reported)']).join(', ')}`,
      `  depth usage: ${s.depthUsage ?? '-'}   depth format: ${s.depthDataFormat ?? '-'}   depth type: ${s.depthType ?? '-'}`,
      `  blend mode: ${s.blend}   frame rate: ${s.frameRate ?? '-'} (offered: ${s.rates || '-'})`);
  }
  if (R.depth) {
    const d = R.depth;
    L.push('', 'DEPTH MAP', `  size: ${d.w} x ${d.h}   near: ${d.near}   far: ${d.far}   raw to metres: ${d.rawToM ?? '-'}`,
      `  texture type: ${d.texType ?? '-'}   image index: ${d.imageIndex ?? '-'}   own projection: ${d.proj}   own pose: ${d.pose}   view-to-buffer matrix: ${d.norm}`,
      `  valid in ${R.depthChecks ? Math.round(100 * R.depthValid / R.depthChecks) : 0} % of ${R.depthChecks} checks (one a second)`);
    if (R.texChecks) L.push(`  depth texture object changed in ${R.texChanged || 0} of ${R.texChecks} checks${R.texChanged ? '  (three binds only the first one: occlusion may freeze)' : ''}`);
    if (R.cpuCentre != null) L.push(`  CPU depth at the centre of view: ${R.cpuCentre.toFixed(2)} m`);
  } else if (R.session) L.push('', 'DEPTH MAP', '  none: the browser gave no depth information');
  L.push('', 'ROOM', `  planes: ${R.planeCount}  ${Object.entries(R.planes).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `  meshes: ${R.meshCount}  ${Object.entries(R.meshes).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (R.roomCapture) L.push(`  room setup (A): ${R.roomCapture}`);
  const m = Object.entries(R.modes);
  if (m.length) { L.push('', 'FRAME RATE PER MODE'); for (const [k, v] of m) L.push(`  ${k.padEnd(20)} ${(v.n / v.t).toFixed(1)} fps   worst frame ${v.worst.toFixed(1)} ms   over 20 ms: ${v.slow}   (${v.t.toFixed(0)} s)`); }
  if (R.errors.length) L.push('', 'ERRORS', ...R.errors.map(e => '  ' + e));
  return L.join('\n');
}
function show() { out.textContent = report(); }
function keep() { try { localStorage.setItem('vire.depthtest', JSON.stringify(R)); } catch {} }

(async () => {
  try { R.ar = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch (e) { R.ar = false; err('support', e); }
  goB.disabled = !R.ar;
  let last = null; try { last = JSON.parse(localStorage.getItem('vire.depthtest') || 'null'); } catch {}
  out.textContent = report() + (last && last.session ? '\n\n(last run ' + last.when + ' kept in this browser; a new run replaces it)' : '') + (R.ar ? '' : '\n\nNo passthrough (immersive-ar) here: open this page in the Quest Browser.');
})();
copyB.onclick = async () => { try { await navigator.clipboard.writeText(report()); copyB.textContent = 'Copied'; } catch { copyB.textContent = 'Copy failed: select the text'; } };

// ---------------------------------------------------------------- scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight); renderer.setClearColor(0x000000, 0);
renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor');
renderer.domElement.style.display = 'none'; document.body.appendChild(renderer.domElement);
const gl = renderer.getContext();
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70, 1, 0.05, 40);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
const rig = new THREE.Group(); scene.add(rig);

// pillars at known distances on an arc ahead (-z), each with its distance written on it
const DIST = [0.8, 1.2, 1.6, 2.0, 2.5, 3.0, 4.0];
DIST.forEach((d, i) => {
  const a = (i / (DIST.length - 1) - 0.5) * 1.4, hue = i / DIST.length;
  const c = document.createElement('canvas'); c.width = 64; c.height = 512; const x = c.getContext('2d');
  x.fillStyle = `hsl(${hue * 360},85%,55%)`; x.fillRect(0, 0, 64, 512); x.fillStyle = '#000'; x.font = '700 30px system-ui'; x.textAlign = 'center';
  for (let y = 60; y < 512; y += 120) { x.save(); x.translate(32, y); x.rotate(-Math.PI / 2); x.fillText(d + ' m', 0, 10); x.restore(); }
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
  const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.9, 0.08), new THREE.MeshBasicMaterial({ map: tx }));
  p.position.set(Math.sin(a) * d, 0.95, -Math.cos(a) * d); p.rotation.y = -a; rig.add(p);
});
// cube grid at hand height, 0.6 m ahead: put a hand through it
const cubeMat = new THREE.MeshStandardMaterial({ color: 0x39a8ff, roughness: 0.4 });
for (let i = 0; i < 7; i++) for (let j = 0; j < 4; j++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.035), cubeMat); b.position.set((i - 3) * 0.09, 0.85 + j * 0.09, -0.6); rig.add(b); }
// the app's own laser (settings kept to this page: nothing is saved over the app's laser)
const laser = new Laser(rig, () => ({ p: new THREE.Vector3(0, 2.0, 0.4), yaw: 0, pitch: -0.12 }));
laser.reset(false); Object.assign(laser, { pat: 'fan', col: 'green', auto: false, n: 12, spread: 80, speed: 0.6, haze: 0.7, len: 8 }); laser.setOn(true, false);

// DEPTH COLOURS overlay: full screen, per eye, sampling the same texture three uses for occlusion
const depthMat = new THREE.ShaderMaterial({
  uniforms: { depthColor: { value: null }, depthWidth: { value: 1 }, depthHeight: { value: 1 }, uNear: { value: 0.1 }, uFar: { value: 1000 } },
  vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `precision highp sampler2DArray;
uniform sampler2DArray depthColor; uniform float depthWidth, depthHeight, uNear, uFar;
void main() {
  vec2 coord = gl_FragCoord.xy / vec2(depthWidth, depthHeight); float layer = 0.0;
  if (coord.x >= 1.0) { coord.x -= 1.0; layer = 1.0; }
  float d = texture(depthColor, vec3(coord, layer)).r;
  if (d >= 0.99999) { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); return; }   // no depth here
  float z = uFar > 1e4 ? uNear / max(1.0 - d, 1e-6) : 1.0 / (1.0 / uNear - d * (1.0 / uNear - 1.0 / uFar));
  float t = clamp(z / 5.0, 0.0, 1.0);
  vec3 c = t < 0.25 ? mix(vec3(1.0, 0.1, 0.1), vec3(1.0, 0.85, 0.1), t / 0.25) : t < 0.5 ? mix(vec3(1.0, 0.85, 0.1), vec3(0.1, 1.0, 0.3), (t - 0.25) / 0.25)
    : t < 0.75 ? mix(vec3(0.1, 1.0, 0.3), vec3(0.1, 0.6, 1.0), (t - 0.5) / 0.25) : mix(vec3(0.1, 0.6, 1.0), vec3(0.6, 0.2, 1.0), (t - 0.75) / 0.25);
  float b = fract(z / 0.5), line = 1.0 - smoothstep(0.0, 0.04, min(b, 1.0 - b));
  gl_FragColor = vec4(c * 0.55 + vec3(line), 0.55 + 0.45 * line);
}`, transparent: true, depthTest: false, depthWrite: false });
const depthQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), depthMat); depthQuad.frustumCulled = false; depthQuad.renderOrder = 900; depthQuad.visible = false; scene.add(depthQuad);

// room planes and meshes
const roomGrp = new THREE.Group(); scene.add(roomGrp);
const roomObjs = new Map();   // XRPlane / XRMesh -> { obj, t }
const LABEL_COL = { wall: 0x30ff60, floor: 0x3080ff, ceiling: 0xff60ff, table: 0xffc030, couch: 0xff8040, door_frame: 0x40ffff, window_frame: 0x80e0ff, screen: 0xffffff, global_mesh: 0x40d0ff };

// panel (HUD): a canvas in front of you, always drawn on top
const hudC = document.createElement('canvas'); hudC.width = 1024; hudC.height = 700; const hx = hudC.getContext('2d');
const hudTex = new THREE.CanvasTexture(hudC); hudTex.colorSpace = THREE.SRGBColorSpace;
const hud = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62 * 700 / 1024), new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
hud.renderOrder = 1000; scene.add(hud);
function placeHud() {   // #408b from the XR camera's pose as three sets it each frame (position / quaternion; matrixWorld lags a frame)
  const c = renderer.xr.getCamera(); const p = c.position.clone(), q = c.quaternion.clone();
  const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y, f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  hud.position.copy(p).addScaledVector(f, 0.9).add(new THREE.Vector3(Math.cos(yaw) * -0.35, -0.22, Math.sin(yaw) * 0.35)); hud.lookAt(p.x, hud.position.y, p.z);
}
function drawHud() {
  const g = hx; g.fillStyle = 'rgba(8,10,16,0.88)'; g.fillRect(0, 0, 1024, 700); g.strokeStyle = '#e0202a'; g.lineWidth = 4; g.strokeRect(2, 2, 1020, 696);
  g.fillStyle = '#fff'; g.font = '700 40px system-ui'; g.fillText(`MODE ${mode + 1}/4: ${MODES[mode]}`, 28, 58);
  g.font = '500 26px system-ui'; g.fillStyle = '#9aa4b6'; g.fillText('trigger / pinch = next mode    A = room setup    B = panel here', 28, 98);
  const rows = [];
  const d = R.depth;
  rows.push(['Depth', d ? `${d.w} x ${d.h}, near ${d.near}, far ${d.far}` : R.session && (R.session.enabledFeatures || []).includes('depth-sensing') ? 'granted, waiting for data' : 'NOT granted']);
  rows.push(['Depth valid', R.depthChecks ? `${Math.round(100 * R.depthValid / R.depthChecks)} % (${R.depthChecks} checks)` : '-']);
  rows.push(['Usage / format', R.session ? `${R.session.depthUsage ?? '-'} / ${R.session.depthDataFormat ?? '-'}` : '-']);
  if (R.cpuCentre != null) rows.push(['Centre (CPU)', R.cpuCentre.toFixed(2) + ' m']);
  rows.push(['Planes', `${R.planeCount}  ${Object.entries(R.planes).map(([k, v]) => `${k} ${v}`).join(', ')}`]);
  rows.push(['Meshes', `${R.meshCount}  ${Object.entries(R.meshes).map(([k, v]) => `${k} ${v}`).join(', ')}`]);
  for (const [k, v] of Object.entries(R.modes)) rows.push([k, `${(v.n / v.t).toFixed(1)} fps, worst ${v.worst.toFixed(0)} ms, ${v.slow} slow`]);
  if (R.errors.length) { g.fillStyle = '#ff5050'; g.font = '700 24px system-ui'; g.fillText(('ERROR ' + R.errors[R.errors.length - 1]).slice(0, 72), 28, 630); }
  let y = 150; for (const [k, v] of rows) { g.fillStyle = '#9aa4b6'; g.font = '600 26px system-ui'; g.fillText(k, 28, y); g.fillStyle = '#fff'; g.font = '500 26px system-ui'; g.fillText(String(v).slice(0, 60), 300, y); y += 40; }
  g.fillStyle = '#6a7488'; g.font = '500 22px system-ui';
  g.fillText(mode === 0 ? 'Hand / people in front of the pillars: they should cut them cleanly.' : mode === 1 ? 'Same scene, real world ignored: compare the frame rate.' : mode === 2 ? 'Colour = distance (red near, purple 5 m), white line every 0.5 m.' : 'Green walls, blue floor, pink ceiling, cyan room mesh.', 28, 672);
  hudTex.needsUpdate = true;
}

// ---------------------------------------------------------------- session
let lastTex = null, frames = 0, keepT = 0, occFixed = false;
let session = null, binding = null, mode = 0, hudT = 0, checkT = 0, lastT = 0, modeT0 = 0;
async function start(noDepth) {
  const want = { requiredFeatures: ['local-floor'], optionalFeatures: ['depth-sensing', 'plane-detection', 'mesh-detection', 'hand-tracking'],
    depthSensing: { usagePreference: ['gpu-optimized', 'cpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] } };
  if (noDepth) { want.optionalFeatures = want.optionalFeatures.filter(f => f !== 'depth-sensing'); delete want.depthSensing; }
  try { session = await navigator.xr.requestSession('immersive-ar', want); if (noDepth) R.request = 'NO depth (second button), plane-detection, mesh-detection, hand-tracking'; else R.request = 'depth-sensing (gpu or cpu, luminance-alpha or float32), plane-detection, mesh-detection, hand-tracking'; }
  catch (e) {
    err('request with depth', e);
    session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['local-floor'], optionalFeatures: ['plane-detection', 'mesh-detection', 'hand-tracking'] });
    R.request = 'WITHOUT depth (asking for depth failed), plane-detection, mesh-detection';
  }
  R.session = { enabledFeatures: session.enabledFeatures ? [...session.enabledFeatures] : null, depthUsage: session.depthUsage, depthDataFormat: session.depthDataFormat, depthType: session.depthType,
    blend: session.environmentBlendMode, frameRate: session.frameRate, rates: session.supportedFrameRates ? [...session.supportedFrameRates].join(' ') : '' };
  await renderer.xr.setSession(session);   // #408b BEFORE the frame rate: updateTargetFrameRate only settles once frames run, awaiting it first hung the session (black screen)
  try { if (session.updateTargetFrameRate && session.supportedFrameRates && [...session.supportedFrameRates].includes(72)) session.updateTargetFrameRate(72).then(() => { R.session.frameRate = session.frameRate; }, e => err('frame rate', e)); } catch (e) { err('frame rate', e); }
  try { binding = new XRWebGLBinding(session, gl); } catch (e) { err('binding', e); }
  for (const i of [0, 1]) { const c = renderer.xr.getController(i); scene.add(c); c.addEventListener('select', () => setMode((mode + 1) % MODES.length)); }
  session.addEventListener('end', () => { session = null; keep(); show(); copyB.disabled = false; goB.disabled = false; });
  setMode(1); hudT = -1; lastT = 0; frames = 0;   // #408b start WITHOUT occlusion (safe view), trigger goes on to the others
}
function setMode(m) { mode = m; modeT0 = performance.now(); drawHud(); }
goB.onclick = () => { goB.disabled = true; start(false).catch(e => { err('start', e); show(); goB.disabled = false; }); };
const go2 = document.getElementById('go2'); if (go2) go2.onclick = () => { goB.disabled = true; start(true).catch(e => { err('start', e); show(); goB.disabled = false; }); };

const prevBtn = [{}, {}];
function buttons() {
  for (const src of session.inputSources) {
    const gp = src.gamepad; if (!gp) continue; const k = src.handedness === 'left' ? 0 : 1;
    const a = gp.buttons[4] && gp.buttons[4].pressed, b = gp.buttons[5] && gp.buttons[5].pressed;
    if (a && !prevBtn[k].a) {   // A / X: room setup (Space Setup) if the browser offers it
      if (session.initiateRoomCapture) session.initiateRoomCapture().then(() => { R.roomCapture = 'opened'; }, e => { R.roomCapture = 'refused: ' + e.message; });
      else R.roomCapture = 'not offered by this browser';
    }
    if (b && !prevBtn[k].b) placeHud();
    prevBtn[k].a = a; prevBtn[k].b = b;
  }
}

function room(frame, ref) {
  const seen = new Set(), planes = {}, meshes = {};
  const add = (key, label, build, t, space) => {
    seen.add(key); let r = roomObjs.get(key);
    if (!r || r.t !== t) { if (r) { roomGrp.remove(r.obj); r.obj.geometry.dispose(); } r = { obj: build(), t }; r.obj.matrixAutoUpdate = false; roomGrp.add(r.obj); roomObjs.set(key, r); }
    const pose = frame.getPose(space, ref); if (pose) r.obj.matrix.fromArray(pose.transform.matrix);
  };
  if (frame.detectedPlanes) for (const p of frame.detectedPlanes) {
    const lb = p.semanticLabel || p.orientation || 'plane'; planes[lb] = (planes[lb] || 0) + 1;
    add(p, lb, () => { const pts = p.polygon.map(v => new THREE.Vector3(v.x, v.y, v.z)); return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: LABEL_COL[lb] || 0xffffff })); }, p.lastChangedTime, p.planeSpace);
  }
  if (frame.detectedMeshes) for (const m of frame.detectedMeshes) {
    const lb = m.semanticLabel || 'mesh'; meshes[lb] = (meshes[lb] || 0) + 1;
    add(m, lb, () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.vertices), 3)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.indices), 1));
      return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: LABEL_COL[lb] || 0x40d0ff, wireframe: true, transparent: true, opacity: 0.5 })); }, m.lastChangedTime, m.meshSpace);
  }
  for (const [k, r] of roomObjs) if (!seen.has(k)) { roomGrp.remove(r.obj); r.obj.geometry.dispose(); roomObjs.delete(k); }
  R.planes = planes; R.meshes = meshes; R.planeCount = Object.values(planes).reduce((a, b) => a + b, 0); R.meshCount = Object.values(meshes).reduce((a, b) => a + b, 0);
}

function depthCheck(frame, ref) {
  const pose = frame.getViewerPose(ref); if (!pose) return;
  const view = pose.views[0]; R.depthChecks++;
  let info = null;
  try { if (session.depthUsage === 'cpu-optimized' && frame.getDepthInformation) info = frame.getDepthInformation(view); else if (binding && binding.getDepthInformation) info = binding.getDepthInformation(view); } catch (e) { err('depth info', e); }
  if (!info) return;
  if (info.texture) { R.texChecks = (R.texChecks || 0) + 1; if (lastTex && info.texture !== lastTex) R.texChanged = (R.texChanged || 0) + 1; lastTex = info.texture; }   // three r169 binds the first texture only: does Quest hand out a new one?
  if (info.isValid === false) return;
  R.depthValid++;
  R.depth = { w: info.width, h: info.height, near: info.depthNear != null ? +info.depthNear.toFixed(3) : '-', far: info.depthFar != null ? (isFinite(info.depthFar) ? +info.depthFar.toFixed(1) : 'infinite') : '-',
    rawToM: info.rawValueToMeters, texType: info.textureType, imageIndex: info.imageIndex, proj: !!info.projectionMatrix, pose: !!info.transform, norm: !!info.normDepthBufferFromNormView };
  if (info.getDepthInMeters) { try { R.cpuCentre = info.getDepthInMeters(0.5, 0.5); } catch (e) { err('cpu depth', e); } }
}

renderer.setAnimationLoop((t, frame) => {
  if (!frame || !session) return;
  try { loop(t, frame); } catch (e) { err('frame', e); try { renderer.render(scene, camera); } catch (e2) { err('render', e2); } }
});
function loop(t, frame) {
  frames++;
  if (frames === 3) placeHud();   // the camera has a real pose by now
  if (t - keepT > 2000) { keepT = t; keep(); }
  const ref = renderer.xr.getReferenceSpace();
  const dtMs = lastT ? t - lastT : 0; lastT = t;
  const st = R.modes[MODES[mode]] || (R.modes[MODES[mode]] = { n: 0, t: 0, worst: 0, slow: 0 });
  if (dtMs > 0 && dtMs < 500 && performance.now() - modeT0 > 1000) { st.n++; st.t += dtMs / 1000; st.worst = Math.max(st.worst, dtMs); if (dtMs > 20) st.slow++; }   // 1 s settle after a switch
  try { buttons(); } catch (e) { err('buttons', e); }
  try { room(frame, ref); } catch (e) { err('room', e); }
  if (t - checkT > 1000) { checkT = t; depthCheck(frame, ref); }
  // modes: occlusion on / off, depth colours, room lines
  const occ = renderer.xr.hasDepthSensing && renderer.xr.hasDepthSensing() ? renderer.xr.getDepthSensingMesh() : null;
  if (occ && !occFixed) { occFixed = true; occ.material.colorWrite = false; R.occColorFix = true; }   // #408b three r169's occlusion mesh writes no colour of its own: on Quest that can paint the passthrough black
  if (occ) occ.visible = mode === 0 || mode === 2;
  roomGrp.visible = mode === 3;
  depthQuad.visible = mode === 2 && !!occ;
  if (depthQuad.visible) {
    const u = depthMat.uniforms, vp = renderer.xr.getCamera().cameras[0].viewport;
    u.depthColor.value = renderer.xr.getDepthTexture(); u.depthWidth.value = vp.z; u.depthHeight.value = vp.w;
    if (R.depth && typeof R.depth.near === 'number') { u.uNear.value = R.depth.near; u.uFar.value = typeof R.depth.far === 'number' ? R.depth.far : 1e9; }
  }
  laser.tick(1 / 72, null, renderer.xr.getCamera().position);
  if (t - hudT > 250) { hudT = t; drawHud(); }
  renderer.render(scene, camera);
}
