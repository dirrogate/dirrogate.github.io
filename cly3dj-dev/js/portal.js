// #345 PORTAL (owner): a rectangular "real world window". Cut it into any prop or room (FacetWall today; any future
// glb room/cabin later, one call: Portals.cutInto(obj)) and the part of that mesh seen through the rectangle stops
// drawing, so whatever is really there shows instead -- the Quest's passthrough camera in AR, or just empty space in VR.
// A thin bezel frame marks its edges in passthrough and on the Twitch picture (HEADSET CAM / SHOWTIME! both render
// the normal scene, so the cut shows up there too with no extra plumbing).
// #346 (owner): up to MAX_PORTALS frames (the PORTALS SETUP page sets how many), each any rectangle: trigger / pinch
// on the handle on its right side = width, on its top = height, on the corner = both (grip anywhere on the
// frame moves it, a second grip stretches it evenly). The cut is now a true window: from each eye (and each stream
// camera) only what lies BEYOND the frame, seen through it, is removed -- so with the wall wrapped all the way round,
// a portal in front never punches through the panels behind the DJ, and it cuts the sky dome behind it too.
// #540 (owner, redcastle2_1.jpg): curved-edge portal opening (rounded corners) set in a weathered concrete/stone
// surround with a rusty wrought-iron inner trim band and forged iron corner rivets. Sizing handles are forged rusty
// wrought iron (side bar = width, top bar = height, top-right forged ring = both). No more garish silver.
// #585 rebuilt (see the frame section): swept concrete / wrought-iron profile, doorway or bay window, TRIM LIGHT.
// #586 (owner): each frame has a TYPE: REAL WINDOW / REAL DOOR (the real world through it, as before) or PANO WINDOW /
// PANO DOOR, the reverse: while any PANO frame is out, the sky dome is drawn ONLY through PANO frames, so in passthrough
// the pano (or video pano) is seen only where the frame opens a hole in the real room. Frames are also targets for the
// MOVIE PROPS placement laser (B): stick = closer / away and turn, grip + stick = size / tilt (a skyroof overhead).
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/three/utils/BufferGeometryUtils.js';

export const MAX_PORTALS = 6;
const KEY = 'vire.portals', OLD_KEY = 'vire.portal';   // #345 kept one portal under vire.portal
const HALF0 = new THREE.Vector2(0.3, 0.75);   // a new frame's half-size (metres) -- ~ a floor mirror
const HMIN = 0.08, HMAX = 2.5;                // half-size limits per side: 16 cm .. 5 m
const GRAB = 0.045;                           // handle reach (m)

// #585 (owner: 'a resizable concrete / wrought-iron rim, curved rectangular port window that belongs in a castle, a club
// or a spaceship pod; both as a doorway and a bay window'). #587 (owner: lighter, thinner; no real lights): a profile
// 6 cm deep and 8.5 cm wide is swept round the opening: wrought-iron reveal, an iron lip with forged studs and the TRIM
// LIGHT line (both painted by the shader), a small step up to a concrete face with an outer bevel. The handles are
// merged in. ONE mesh, one material, one draw call, ~460 triangles a window (~310 a doorway). No step or sill under it:
// a window is the same on every side, so it works sideways or overhead. A doorway is open at the bottom with square
// bottom corners, stands on the floor and stays upright.
const RIM = 0.085;                               // #587 concrete outer edge, from the opening edge (was 17 cm)
const cornerRadius = (hx, hy) => Math.min(0.30, 0.42 * Math.min(hx, hy));
const GLOWS = { off: null, red: 0xff2a2a, cyan: 0x36d8ff, amber: 0xffa53a };
const GLOW_ORDER = ['off', 'red', 'cyan', 'amber'];
// #586 REAL WINDOW, REAL DOOR, PANO WINDOW, PANO DOOR; #588 + ROUND (cross grill), ARCH (cross grill), PORTHOLE (no grill), each REAL or PANO.
// A leading 'p' means PANO (the sky only through it), so the porthole is 'hole' / 'phole'.
// #589 + SCREEN BAY / SCREEN DOOR / SCREEN PORTHOLE ('s' + shape): the opening shows the shared screen feed (CYCLO, an image or a video).
export const KINDS = ['window', 'door', 'round', 'arch', 'hole', 'pwindow', 'pdoor', 'pround', 'parch', 'phole', 'swindow', 'sdoor', 'shole'];
export const KIND_LABEL = { window: 'REAL WINDOW', door: 'REAL DOOR', round: 'REAL ROUND', arch: 'REAL ARCH', hole: 'REAL PORTHOLE', pwindow: 'PANO WINDOW', pdoor: 'PANO DOOR', pround: 'PANO ROUND', parch: 'PANO ARCH', phole: 'PANO PORTHOLE', swindow: 'SCREEN BAY', sdoor: 'SCREEN DOOR', shole: 'SCREEN PORTHOLE' };
export const SHAPE_OF = k => { const b = /^[ps](window|door|round|arch|hole)$/.test(k) ? k.slice(1) : k; return b === 'door' ? 'door' : b === 'round' || b === 'arch' || b === 'hole' ? b : 'rect'; };   // #588
export const SHAPE_LABEL = { rect: 'BAY', door: 'DOOR', round: 'ROUND', arch: 'ARCH', hole: 'PORTHOLE' };

// Shared GLSL injected into any material's own shader. World position -> each portal's local space (its inverse world
// matrix); the line from the camera to this fragment crosses the portal's plane inside its rounded rectangle = discard.
// portalR = corner radius (top, bottom); a doorway's bottom is 0 = square.
const DECL = `
#ifdef USE_PORTAL
  uniform mat4 portalInv[${MAX_PORTALS}]; uniform vec2 portalHalf[${MAX_PORTALS}]; uniform vec2 portalR[${MAX_PORTALS}]; uniform float portalRev[${MAX_PORTALS}]; uniform int portalN; uniform int portalRevN;
  varying vec3 vPortalWP;
#endif`;
const VERT = `
#ifdef USE_PORTAL
  vPortalWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`;
const VERT_SM = VERT.replace('transformed', 'position');   // plain ShaderMaterials (the sky dome) have no 'transformed'
const FRAG = `
#ifdef USE_PORTAL
  bool inRev = false;
  for (int i = 0; i < ${MAX_PORTALS}; i++) {
    if (i >= portalN) break;
    vec3 pc = (portalInv[i] * vec4(cameraPosition, 1.0)).xyz, pf = (portalInv[i] * vec4(vPortalWP, 1.0)).xyz;
    if (pc.z * pf.z < 0.0) {   // camera and fragment on opposite sides of the window's plane
      vec2 h = portalHalf[i], p = mix(pc.xy, pf.xy, pc.z / (pc.z - pf.z)), q = abs(p);
      float rr = p.y > 0.0 ? portalR[i].x : portalR[i].y;
      vec2 d = q - h + rr;
      if (length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - rr < 0.0) { if (portalRev[i] > 0.5) inRev = true; else discard; }
    }
  }
  #ifdef PORTAL_SKY
  if (portalRevN > 0 && !inRev) discard;   // #586 PANO frames: the dome only shows through them
  #endif
#endif`;

// ---------- #587 one material, one draw per frame ----------
// One small tiled data texture (not colour): R = concrete grain + a joint every 0.5 m, G = hammered iron, B = rust mask.
// The trim's vertex attribute aKind says what each face is (0 concrete, 1 iron, 2 iron lip with studs and the light
// line); the material's shader tints from that, sets metalness / roughness, and adds the TRIM LIGHT line as an emissive
// colour. No real lights anywhere: the frame is lit by the scene's own environment like every other prop.
const hash = (x, y) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };
function vnoise(x, y, p) {   // tileable value noise, period p cells
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const h = (a, b) => hash(((a % p) + p) % p, ((b % p) + p) % p);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}
const fbm = (x, y, o, p) => { let a = 0, w = 0.5, t = 0; for (let i = 0; i < o; i++) { a += w * vnoise(x, y, p); t += w; x *= 2; y *= 2; p *= 2; w *= 0.5; } return a / t; };
const detailTex = (() => {
  if (typeof document === 'undefined') return null;
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), d = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, k = (y * N + x) * 4;
    const st = fbm(u * 2, v * 2, 3, 2), ag = vnoise(u * 110, v * 110, 110), pit = vnoise(u * 70 + 3, v * 70, 70), joint = Math.abs(u - 0.5) * 2 > 0.976;
    let cr = 0.62 + (ag - 0.5) * 0.3 - (st - 0.5) * 0.45; if (pit > 0.9) cr -= 0.3; if (joint) cr -= 0.35;
    const ham = fbm(u * 20, v * 20, 2, 20), rust = fbm(u * 3 + 3.1, v * 3, 3, 3);
    d.data[k] = Math.max(0, Math.min(255, cr * 255)); d.data[k + 1] = (0.35 + ham * 0.65) * 255; d.data[k + 2] = Math.max(0, Math.min(1, (rust - 0.55) * 5)) * 255; d.data[k + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t;
})();
// #597 FRAME LOOK: one grade for every frame's concrete / iron, after lighting, so the frames sit in the passthrough room's
// colour. uGradeA = (exposure multiplier, contrast, saturation, -), uGradeB = white-balance multipliers (warmth / tint)
const GRADE = { uGradeA: { value: new THREE.Vector4(1, 1, 1, 0) }, uGradeB: { value: new THREE.Vector3(1, 1, 1) } };
export const GRADE0 = { ev: 0, con: 1, sat: 1, warm: 0, tint: 0 };
function applyGrade(G) {
  GRADE.uGradeA.value.set(Math.pow(2, G.ev), G.con, G.sat, 0);
  GRADE.uGradeB.value.set(1 + 0.12 * G.warm, 1 - 0.08 * G.tint, 1 - 0.12 * G.warm).multiplyScalar(1 / (1 - 0.04 * G.tint));
}
// #598 HOLO frame style: no concrete / iron, one transparent sheet over the opening + 30 cm each side. Drawn over the
// passthrough only (it cannot bend the real picture): a glowing scan edge that flickers, light streaks flying off the
// sides, and across the opening a faint tinted glass with scanlines, sparkle dust and glitch bands that jump the edge
// sideways now and then (or on the beat). The real mirror / door behind stays sharp.
const HOLO_COLS = { cyan: 0x36d8ff, blue: 0x2a6bff, violet: 0x8a5bff, green: 0x3dffa0, white: 0xe8f2ff };
export const HOLO_ORDER = Object.keys(HOLO_COLS);
export const HOLO0 = { col: 'cyan', int: 1, scan: 1, glass: 0.5, glitch: 1, beat: false };
const HOLO_VS = `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const HOLO_FS = `uniform vec2 uHalf; uniform vec2 uR; uniform float uT; uniform vec3 uCol; uniform float uInt; uniform float uScan; uniform float uGlass; uniform float uGlitch; uniform float uBeat; varying vec2 vP;
float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sdR(vec2 p) { float rr = p.y > 0.0 ? uR.x : uR.y; vec2 d = abs(p) - uHalf + rr; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - rr; }
void main() {
  vec2 p = vP;
  float slot = floor(uT * (0.6 + 1.6 * uGlitch)), ph = fract(uT * (0.6 + 1.6 * uGlitch));
  float on = uGlitch > 0.01 ? step(ph, 0.12) * step(0.45, h1(slot)) : 0.0; on = max(on, uBeat * step(0.01, uGlitch));
  float bc = (h1(slot + 3.1) * 2.0 - 1.0) * uHalf.y, bw = 0.03 + 0.09 * h1(slot + 7.7);
  float band = on * (1.0 - smoothstep(bw * 0.6, bw, abs(p.y - bc)));
  vec2 q = vec2(p.x + band * (h1(slot + 1.3) - 0.5) * 0.08, p.y);   // the edge tears sideways inside a band
  float sd = sdR(q);
  float fl = 0.86 + 0.14 * sin(uT * 37.0) * sin(uT * 13.7); fl *= h1(floor(uT * 9.0)) > 0.97 ? 0.45 : 1.0;
  float scan = 0.55 + 0.45 * sin(p.y * 230.0 * 6.2832);
  float edge = exp(-abs(sd) / 0.006) * 1.4 + exp(-abs(sd) / 0.035) * 0.45;
  float a = edge * fl * (0.75 + 0.25 * scan);
  vec3 c = mix(uCol, vec3(1.0), clamp(exp(-abs(sd) / 0.003) * 0.8, 0.0, 1.0));
  if (sd > 0.0 && abs(p.x) > uHalf.x && abs(p.y) < uHalf.y - uR.y) {   // streaks flying off the left / right edges
    float row = floor(p.y * 110.0), hh = h1(row + floor(uT * 5.0) * 17.0), len = hh > 0.93 ? (hh - 0.93) * 4.2 : 0.0;   // sparser, longer (up to ~30 cm)
    float dx = abs(p.x) - uHalf.x, line = 1.0 - smoothstep(0.15, 0.45, abs(fract(p.y * 110.0) - 0.5));
    a += step(dx, len) * (1.0 - dx / max(len, 1e-3)) * line * 0.9 * fl;
  }
  if (sd < 0.0) {   // the glass: tint, scanlines, sparkle dust, brighter in a glitch band
    float g = uGlass * 0.16 * (0.55 + 0.45 * scan * uScan + (1.0 - uScan) * 0.45) + band * 0.18;
    vec2 cell = floor(p * 55.0); float hs = h2(cell), tw = step(0.985, hs) * pow(max(0.0, sin(uT * 2.5 + hs * 60.0)), 10.0);
    a += g + tw * 0.9; c = mix(c, uCol * 0.8, clamp(g * 3.0, 0.0, 1.0)); c += tw;
  }
  a = clamp(a * uInt, 0.0, 1.0); if (a < 0.003) discard;
  gl_FragColor = vec4(c, a);
}`;
function makeHoloMat() {
  return new THREE.ShaderMaterial({ vertexShader: HOLO_VS, fragmentShader: HOLO_FS, transparent: true, depthWrite: false, toneMapped: false,
    uniforms: { uHalf: { value: new THREE.Vector2() }, uR: { value: new THREE.Vector2() }, uT: { value: 0 }, uCol: { value: new THREE.Color(HOLO_COLS.cyan) }, uInt: { value: 1 }, uScan: { value: 1 }, uGlass: { value: 0.5 }, uGlitch: { value: 1 }, uBeat: { value: 0 } } });
}
// #598 BAMBOO frame style (a shack roof / skylight): poles round the edge and one layer of slats across the opening, all
// copies of one pole (one InstancedMesh, one draw). SLAT GAP = the gap between slats; CLEARING pushes them out toward
// the edges so the middle opens up onto the dome; DIRECTION = slats along the frame's width or height. Each pole gets
// its own thickness, colour, a little twist and height wobble, and culm nodes every ~30 cm (painted by the shader).
export const BAMBOO0 = { gap: 0.02, clear: 0.4, dir: 'x', kind: 'bamboo' };   // kind: 'bamboo' poles or 'wood' flat slats
const BAM_MAX = 160;
const bamGeo = (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false); g.rotateZ(Math.PI / 2); return g; })();   // unit pole along x
function makeBambooMat() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uGradeA = GRADE.uGradeA; sh.uniforms.uGradeB = GRADE.uGradeB;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vAlong; varying vec3 vLN; varying float vHalfL; varying float vAlong2;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlong = position.x * length(instanceMatrix[0].xyz) + (instanceMatrix[3].x + instanceMatrix[3].y) * 7.0; vLN = normal; vHalfL = 0.5 * length(instanceMatrix[0].xyz); vAlong2 = position.x * length(instanceMatrix[0].xyz);   // metres along the pole, offset per pole');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec4 uGradeA; uniform vec3 uGradeB; varying float vAlong; varying vec3 vLN; varying float vHalfL; varying float vAlong2; float bAO, bHgt;')
      .replace('#include <map_fragment>', `
        float nd = abs(fract(vAlong / 0.3) - 0.5);                      // a culm node every 30 cm
        float node = 1.0 - smoothstep(0.0, 0.035, 0.5 - nd);
        float streak = 0.92 + 0.08 * sin(vAlong * 97.0 + vNormal.y * 9.0);
        diffuseColor.rgb *= mix(1.0, 0.62, node) * streak;
        // #611 fake AO: the back of the pole (toward the ceiling), the ends, where a slat crosses an edge pole; node ridges
        bAO = mix(0.5, 1.0, smoothstep(-0.8, 0.6, vLN.z)) * mix(0.75, 1.0, smoothstep(0.0, 0.05, vHalfL - abs(vAlong2)));
        if (vHalfL > 0.2) bAO *= mix(0.72, 1.0, smoothstep(0.02, 0.08, abs(abs(vAlong2) - (vHalfL - 0.06))));
        bHgt = node * 0.0012 + (streak - 0.92) * 0.004;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition), R1 = cross(sy, normal), R2 = cross(normal, sx); float det = dot(sx, R1);
          vec2 dH = vec2(dFdx(bHgt), dFdy(bHgt)); normal = normalize(abs(det) * normal - sign(det) * (dH.x * R1 + dH.y * R2)); }`)
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= bAO; reflectedLight.indirectSpecular *= bAO; reflectedLight.directDiffuse *= mix(1.0, bAO, 0.6);')
      .replace('#include <tonemapping_fragment>', `{ vec3 c = gl_FragColor.rgb * uGradeA.x * uGradeB; float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = max(mix(vec3(l), c, uGradeA.z), 0.0); gl_FragColor.rgb = 0.18 * pow(c / 0.18 + 1e-5, vec3(uGradeA.y)); }\n#include <tonemapping_fragment>`);
  };
  m.customProgramCacheKey = () => 'bamboo611';
  return m;
}
const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _bp = new THREE.Vector3(), _bs = new THREE.Vector3(), _bc = new THREE.Color(), _bz = new THREE.Vector3(0, 0, 1);
const rnd = n => { const x = Math.sin(n * 91.345 + 7.13) * 43758.5453; return x - Math.floor(x); };
// fill an InstancedMesh: 4 edge poles + slats; positions in frame space (opening plane z = 0, slats a little in front)
function layBamboo(im, hx, hy, B) {
  let n = 0;
  const pole = (cx, cy, cz, len, r, rotZ, seed) => {
    if (n >= BAM_MAX) return;
    _bq.setFromAxisAngle(_bz, rotZ + (rnd(seed) - 0.5) * 0.02); _bp.set(cx, cy, cz); _bs.set(len, r, r);
    im.setMatrixAt(n, _bm.compose(_bp, _bq, _bs));
    const k = 0.62 + 0.45 * rnd(seed + 3), w = rnd(seed + 5); _bc.setRGB((0.42 - 0.04 * w) * k, (0.31 + 0.04 * w) * k, (0.15 - 0.03 * w) * k);   /* dry straw .. tan, a few greener */ im.setColorAt(n, _bc); n++;
  };
  const R = 0.034, along = B.dir !== 'y', W = along ? hx : hy, Hh = along ? hy : hx;   // slats run along W, are laid out across Hh
  pole(0, hy, 0.02, 2 * hx + 0.24, R, 0, 1); pole(0, -hy, 0.02, 2 * hx + 0.24, R, 0, 2);
  pole(hx, 0, 0.055, 2 * hy + 0.24, R, Math.PI / 2, 3); pole(-hx, 0, 0.055, 2 * hy + 0.24, R, Math.PI / 2, 4);
  // slats from each edge toward the middle; the step grows toward the middle with CLEARING
  const half = [], gap = Math.max(0.005, B.gap);
  let y = Hh - R - 0.02, i = 0;
  while (y > 0 && half.length < (BAM_MAX - 4) / 2) {
    const r = 0.016 + 0.007 * rnd(i * 2.7 + 11); half.push([y, r, i]);
    const t = 1 - y / Hh; y -= 2 * r + gap * (1 + 12 * B.clear * t * t); i++;
  }
  for (const [yy, r, k] of half) for (const sg of [1, -1]) {
    const c = sg * yy, z = 0.085 + (rnd(k * 5.1 + sg) - 0.5) * 0.012, len = 2 * W + 0.12 + (rnd(k + 9) - 0.5) * 0.08;
    if (along) pole((rnd(k * 3.3 + sg) - 0.5) * 0.04, c, z, len, r, 0, k * 13 + sg); else pole(c, (rnd(k * 3.3 + sg) - 0.5) * 0.04, z, len, r, Math.PI / 2, k * 13 + sg);
  }
  im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
}
// #598 WOOD slats (BAMBOO section, SLATS: WOOD): flat boards with procedural grain -- no texture file. Growth rings
// warped by noise, fine fibres along the board, a knot now and then, darker edges, per-board shade / offset so no two
// boards match. Unit box: x = length, y = width (in the frame plane), z = thickness.
const woodGeo = new THREE.BoxGeometry(1, 1, 1);
function makeWoodMat() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uGradeA = GRADE.uGradeA; sh.uniforms.uGradeB = GRADE.uGradeB;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW; varying float vSeed; varying vec3 vHalf; varying vec3 vLN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHalf = 0.5 * vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)); vLN = normal; vW = position * vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)); vSeed = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9, 78.2, 37.7))) * 43758.5);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec4 uGradeA; uniform vec3 uGradeB; varying vec3 vW; varying float vSeed; varying vec3 vHalf; varying vec3 vLN; float wAO, wHgt;
float wh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wh(i), wh(i + vec2(1, 0)), f.x), mix(wh(i + vec2(0, 1)), wh(i + vec2(1, 1)), f.x), f.y); }
float wf(vec2 p) { return wn(p) * 0.5 + wn(p * 2.03) * 0.25 + wn(p * 4.01) * 0.125; }`)
      .replace('#include <map_fragment>', `
        float u = vW.x + vSeed * 7.3, v = vW.y + vW.z;                    // along / across the board
        vec2 kc = vec2(floor(u / 0.55) * 0.55 + 0.27 + (wh(vec2(floor(u / 0.55), vSeed)) - 0.5) * 0.2, (wh(vec2(vSeed, floor(u / 0.55))) - 0.5) * 0.05);
        float kd = length(vec2((u - kc.x) * 0.35, v - kc.y)), knot = step(0.62, wh(vec2(floor(u / 0.55), vSeed * 3.1))) * (1.0 - smoothstep(0.004, 0.012, kd));
        float warp = wf(vec2(u * 1.3, v * 9.0 + vSeed * 20.0)) * 2.2 + 1.8 * exp(-kd * 60.0) * step(0.62, wh(vec2(floor(u / 0.55), vSeed * 3.1)));
        float ring = fract(v * 38.0 + warp + vSeed * 5.0);
        float late = smoothstep(0.55, 0.95, ring) * (1.0 - smoothstep(0.95, 1.0, ring));   // dark latewood band
        float fib = wn(vec2(u * 9.0, v * 900.0)) * 0.5 + wn(vec2(u * 3.0, v * 260.0)) * 0.5;   // fine fibres along the grain
        vec3 light = vec3(0.60, 0.43, 0.27), dark = vec3(0.30, 0.19, 0.10);
        vec3 wc = mix(light, dark, late * 0.75 + knot * 0.9) * (0.86 + 0.22 * fib);
        diffuseColor.rgb *= wc;
        // #611 fake AO: dark board edges and ends, the band where a board crosses an edge beam, the gap faces, the back
        wAO = mix(0.62, 1.0, smoothstep(0.0, 0.014, vHalf.y - abs(vW.y))) * mix(0.75, 1.0, smoothstep(0.0, 0.04, vHalf.x - abs(vW.x)));
        if (vHalf.x > 0.2 && vHalf.y < 0.07) wAO *= mix(0.7, 1.0, smoothstep(0.02, 0.09, abs(abs(vW.x) - (vHalf.x - 0.05))));
        if (abs(vLN.y) > 0.5) wAO *= 0.55; if (vLN.z < -0.5) wAO *= 0.5;
        wHgt = (late * 0.6 - knot * 0.8) * 0.0014;   // grain relief on the rings and knots only (fine fibres would shimmer in the headset)`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness - 0.12 * late + 0.06 * fib;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition), R1 = cross(sy, normal), R2 = cross(normal, sx); float det = dot(sx, R1);
          vec2 dH = vec2(dFdx(wHgt), dFdy(wHgt)); normal = normalize(abs(det) * normal - sign(det) * (dH.x * R1 + dH.y * R2)); }`)
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= wAO; reflectedLight.indirectSpecular *= wAO; reflectedLight.directDiffuse *= mix(1.0, wAO, 0.6);')
      .replace('#include <tonemapping_fragment>', `{ vec3 c = gl_FragColor.rgb * uGradeA.x * uGradeB; float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = max(mix(vec3(l), c, uGradeA.z), 0.0); gl_FragColor.rgb = 0.18 * pow(c / 0.18 + 1e-5, vec3(uGradeA.y)); }\n#include <tonemapping_fragment>`);
  };
  m.customProgramCacheKey = () => 'wood611';
  return m;
}
function layWood(im, hx, hy, B) {
  let n = 0;
  const board = (cx, cy, cz, len, w, t, rotZ, seed) => {
    if (n >= BAM_MAX) return;
    _bq.setFromAxisAngle(_bz, rotZ + (rnd(seed) - 0.5) * 0.012); _bp.set(cx, cy, cz); _bs.set(len, w, t);
    im.setMatrixAt(n, _bm.compose(_bp, _bq, _bs));
    const k = 0.8 + 0.35 * rnd(seed + 3); _bc.setRGB(k, k * (0.97 + 0.05 * rnd(seed + 5)), k * (0.92 + 0.08 * rnd(seed + 7))); im.setColorAt(n, _bc); n++;
  };
  const along = B.dir !== 'y', W = along ? hx : hy, Hh = along ? hy : hx, BW = 0.07;
  board(0, hy, 0.02, 2 * hx + 0.2, BW, BW, 0, 1); board(0, -hy, 0.02, 2 * hx + 0.2, BW, BW, 0, 2);   // edge beams
  board(hx, 0, 0.055, 2 * hy + 0.2, BW, BW, Math.PI / 2, 3); board(-hx, 0, 0.055, 2 * hy + 0.2, BW, BW, Math.PI / 2, 4);
  const half = [], gap = Math.max(0.005, B.gap); let y = Hh - 0.05 - 0.02, i = 0;
  while (y > 0 && half.length < (BAM_MAX - 4) / 2) {
    const w = 0.085 + 0.02 * rnd(i * 2.7 + 11); half.push([y - w / 2, w, i]);
    const t = 1 - y / Hh; y -= w + gap * (1 + 12 * B.clear * t * t); i++;
  }
  for (const [yy, w, k] of half) for (const sg of [1, -1]) {
    const c = sg * yy, z = 0.1 + (rnd(k * 5.1 + sg) - 0.5) * 0.006, len = 2 * W + 0.1 + (rnd(k + 9) - 0.5) * 0.06, th = 0.018;
    if (along) board((rnd(k * 3.3 + sg) - 0.5) * 0.04, c, z, len, w, th, 0, k * 13 + sg); else board(c, (rnd(k * 3.3 + sg) - 0.5) * 0.04, z, len, w, th, Math.PI / 2, k * 13 + sg);
  }
  im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
}
function makeTrimMat() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  m.userData.uGlow = { value: new THREE.Color(0, 0, 0) };
  m.onBeforeCompile = sh => {
    sh.uniforms.uDetail = { value: detailTex }; sh.uniforms.uGlow = m.userData.uGlow; sh.uniforms.uGradeA = GRADE.uGradeA; sh.uniforms.uGradeB = GRADE.uGradeB;   // #597
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aKind; attribute float aSeg; varying float vKind; varying float vSeg; varying vec2 vUm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKind = aKind; vSeg = aSeg; vUm = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <tonemapping_fragment>', `{ vec3 c = gl_FragColor.rgb * uGradeA.x * uGradeB; float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = max(mix(vec3(l), c, uGradeA.z), 0.0); gl_FragColor.rgb = 0.18 * pow(c / 0.18 + 1e-5, vec3(uGradeA.y)); }   // #597 FRAME LOOK\n#include <tonemapping_fragment>`).replace('#include <common>', '#include <common>\nuniform vec4 uGradeA; uniform vec3 uGradeB;\nuniform sampler2D uDetail; uniform vec3 uGlow; varying float vKind; varying float vSeg; varying vec2 vUm; vec3 tD; float lipLine, stud;')
      .replace('#include <map_fragment>', `
        tD = texture2D(uDetail, vUm * 2.0).rgb;   // 0.5 m tile
        float isIron = step(0.5, vKind), isLip = step(1.5, vKind);
        vec3 conc = vec3(0.47, 0.455, 0.43) * (0.55 + 0.75 * tD.r);
        vec3 iron = mix(vec3(0.11, 0.105, 0.10) * (0.6 + 0.8 * tD.g), vec3(0.34, 0.16, 0.07) * (0.7 + 0.5 * tD.g), tD.b);
        float du = (fract(vUm.x / 0.09) - 0.5) * 0.09, dv = (vSeg - 0.32) * 0.025;   // studs every 9 cm along the lip
        stud = isLip * (1.0 - smoothstep(0.0032, 0.0046, length(vec2(du, dv))));
        lipLine = isLip * (1.0 - smoothstep(0.06, 0.1, abs(vSeg - 0.8)));        // the TRIM LIGHT line, near the concrete
        diffuseColor.rgb *= mix(conc, iron, isIron);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.29, 0.28), stud * 0.7);`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(0.93, mix(0.45, 0.9, tD.b), step(0.5, vKind)) - stud * 0.25;`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = step(0.5, vKind) * 0.6 * (1.0 - tD.b);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlow * lipLine;`);
  };
  m.customProgramCacheKey = () => 'portalTrim597';
  return m;
}

// ---------- the swept frame ----------
// #589 the SCREEN panel: fills the opening (same rounded-rect / circle / arch maths as the cut), the shared feed cover-fitted
const SCREEN_VS = `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SCREEN_FS = `uniform sampler2D map; uniform vec2 uHalf; uniform vec2 uR; uniform vec4 uCrop; uniform float uHas; uniform float uBright; uniform float uAces; varying vec2 vP;
// #591 the stream's layers are linear HDR and get ACES (x 1/0.6) applied afterwards: hand them the value that ACES maps
// back onto the clip's own colour, so the picture keeps its brightness and contrast there too (headset: plain sRGB out)
vec3 acesInv(vec3 y) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  vec3 z = clamp(inverse(O) * y, 0.0, 0.995);
  vec3 a = 1.0 - 0.983729 * z, b = 0.0245786 - 0.4329510 * z, c = -0.000090537 - 0.238081 * z;
  vec3 w = (-b + sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * a);
  return max(inverse(I) * w * 0.6, 0.0);
}
void main() {
  float rr = vP.y > 0.0 ? uR.x : uR.y; vec2 d = abs(vP) - uHalf + rr;
  if (length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - rr > 0.0) discard;
  vec2 uv = uCrop.xy + (vP / uHalf * 0.5 + 0.5) * uCrop.zw;
  vec3 c = uHas > 0.5 ? texture2D(map, uv).rgb * uBright : vec3(0.008, 0.009, 0.012);   // #591 no glass sheen: it lifted the blacks
  if (uAces > 0.5) c = acesInv(clamp(c, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;
function makeScreenMat() {
  return new THREE.ShaderMaterial({ vertexShader: SCREEN_VS, fragmentShader: SCREEN_FS, toneMapped: false,
    uniforms: { map: { value: null }, uHalf: { value: new THREE.Vector2(0.3, 0.75) }, uR: { value: new THREE.Vector2() }, uCrop: { value: new THREE.Vector4(0, 0, 1, 1) }, uHas: { value: 0 }, uBright: { value: 1 }, uAces: { value: 0 } } });
}
// Profile in (s = out from the opening edge, z = toward the viewer), a closed polygon, with the kind of the segment that
// starts at each point: 0 concrete, 1 iron, 2 iron lip (studs + light line). D = half depth (6 cm deep in all).
const D = 0.03;
const PROFILE = [
  [0, -D, 1], [0, D, 2],                       // iron reveal, then the iron lip
  [0.025, D, 0], [0.03, D + 0.008, 0],         // small concrete step up, concrete face
  [0.075, D + 0.008, 0], [RIM, D - 0.004, 0],  // outer bevel
  [RIM, -D, 0],                                // outer side, then the back face to the start
];
function pathPts(hx, hy, rT, rB, closed) {
  const P = [], arc = (cx, cy, r, a0, a1, n = r > 0.2 ? 6 : 5 /* #588 big radii (round / arch): 6 steps a quarter */) => { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; P.push([cx + r * Math.cos(a), cy + r * Math.sin(a), Math.cos(a), Math.sin(a)]); } };
  const H = Math.PI / 2;
  if (closed) { arc(hx - rT, hy - rT, rT, 0, H); arc(-hx + rT, hy - rT, rT, H, 2 * H); arc(-hx + rB, -hy + rB, rB, 2 * H, 3 * H); arc(hx - rB, -hy + rB, rB, 3 * H, 4 * H); }
  else { P.push([hx, -hy, 1, 0]); arc(hx - rT, hy - rT, rT, 0, H); arc(-hx + rT, hy - rT, rT, H, 2 * H); P.push([-hx, -hy, -1, 0]); }
  return P;
}
// forged iron handles as plain triangles (merged into the trim): pull bars (side = width, top = height), a corner ring
const HANDLE_BAR = (() => {
  const parts = [new THREE.CylinderGeometry(0.009, 0.009, 0.18, 6, 1, true).translate(0, 0, 0.066)];   // on stand-offs above the concrete face (z 0.038)
  for (const sy of [-1, 1]) parts.push(new THREE.CylinderGeometry(0.007, 0.007, 0.03, 4, 1, true).rotateX(Math.PI / 2).translate(0, sy * 0.07, 0.051));
  return mergeGeometries(parts.map(g => g.toNonIndexed()));
})();
const HANDLE_RING = new THREE.TorusGeometry(0.022, 0.006, 4, 8).rotateZ(Math.PI / 8).translate(0, 0, 0.046).toNonIndexed();   // lies on the concrete face
// #588 cross grill: two forged iron bars across the opening (vertical full height, horizontal through the middle or, on an
// arch, at the spring line), set in the reveal, plus a square boss where they cross. Plain boxes, iron, same mesh.
function grillBoxes(hx, hy, rT, arch) {
  const w = 0.015, t = 0.014, yh = arch ? hy - rT : 0;
  return [[-w, w, -hy, hy, -t, t], [-hx, hx, yh - w, yh + w, -t, t], [-0.026, 0.026, yh - 0.026, yh + 0.026, -0.02, 0.02]];
}
function buildTrim(hx, hy, rT, rB, closed, hp, grill) {
  const pro = PROFILE, path = pathPts(hx, hy, rT, rB, closed), N = path.length;
  let area = 0; for (let k = 0; k < pro.length; k++) { const a = pro[k], b = pro[(k + 1) % pro.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area > 0 ? 1 : -1, pos = [], nor = [], uv = [], kind = [], seg = [], idx = [];
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), want = new THREE.Vector3();
  for (let k = 0; k < pro.length; k++) {
    const a = pro[k], b = pro[(k + 1) % pro.length], ds = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(ds, dz);
    const ns = sgn * dz / L, nz = -sgn * ds / L, base = pos.length / 3;
    for (const [s, z, sv] of [[a[0], a[1], 0], [b[0], b[1], 1]]) {
      let u = 0, px = 0, py = 0;
      for (let i = 0; i < N; i++) {
        const p = path[i], x = p[0] + p[2] * s, y = p[1] + p[3] * s;
        if (i) u += Math.hypot(x - px, y - py); px = x; py = y;
        pos.push(x, y, z); nor.push(p[2] * ns, p[3] * ns, nz); uv.push(u, k * 0.37 + sv * L); kind.push(a[2]); seg.push(sv);
      }
    }
    const M = closed ? N : N - 1;
    for (let i = 0; i < M; i++) {
      const j = (i + 1) % N, A = base + i, B = base + j, C = base + N + j, Dd = base + N + i;
      va.fromArray(pos, A * 3); vb.fromArray(pos, B * 3); vc.fromArray(pos, C * 3); want.fromArray(nor, A * 3);
      if (vb.sub(va).cross(vc.sub(va)).dot(want) >= 0) idx.push(A, B, C, A, C, Dd); else idx.push(A, C, B, A, Dd, C);
    }
  }
  if (!closed) {   // doorway: cap the two ends standing on the floor
    const tri = THREE.ShapeUtils.triangulateShape(pro.map(p => new THREE.Vector2(p[0], p[1])), []);
    for (const [pi, flip] of [[0, false], [N - 1, true]]) {
      const p = path[pi], base = pos.length / 3;
      for (const q of pro) { pos.push(p[0] + p[2] * q[0], p[1] + p[3] * q[0], q[1]); nor.push(0, -1, 0); uv.push(q[0], q[1]); kind.push(0); seg.push(0); }
      for (const t of tri) { const [a, b, c] = t.map(v => base + v); if (flip) idx.push(a, b, c); else idx.push(a, c, b); }
    }
  }
  // handles: copied in as iron triangles
  const addH = (g, x, y, rz) => {
    const P = g.attributes.position, Nn = g.attributes.normal, base = pos.length / 3, c = Math.cos(rz), sn = Math.sin(rz);
    for (let i = 0; i < P.count; i++) {
      const px = P.getX(i), py = P.getY(i), nx = Nn.getX(i), ny = Nn.getY(i);
      pos.push(x + px * c - py * sn, y + px * sn + py * c, P.getZ(i)); nor.push(nx * c - ny * sn, nx * sn + ny * c, Nn.getZ(i)); uv.push(px, py); kind.push(1); seg.push(0); idx.push(base + i);
    }
  };
  addH(HANDLE_BAR, hp.x.x, hp.x.y, 0); addH(HANDLE_BAR, hp.y.x, hp.y.y, Math.PI / 2); addH(HANDLE_RING, hp.xy.x, hp.xy.y, 0);
  for (const [x0, x1, y0, y1, z0, z1] of grill || []) {   // #588 grill bars: 6 quads each
    const F = [[[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]], [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]],
      [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]], [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0]],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]]];
    for (const f of F) { const base = pos.length / 3; for (let i = 0; i < 4; i++) { pos.push(...f[i]); nor.push(...f[4]); uv.push(f[i][0] + f[i][2], f[i][1]); kind.push(1); seg.push(0); } idx.push(base, base + 1, base + 2, base, base + 2, base + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1)); g.setAttribute('aSeg', new THREE.Float32BufferAttribute(seg, 1));
  g.setIndex(idx); g.computeBoundingSphere();
  return g;
}

// One window: obj (in rig space, scale always 1 -- size is `half`): ONE mesh (trim + handles), one material, one draw.
class PortalFrame {
  constructor(set) {
    this.set = set; this.half = HALF0.clone(); this.held = false; this._edge = null; this._g = null; this.door = false; this.rev = false; this.screen = false; this.scr = null; this.shape = 'rect'; this.r = new THREE.Vector2(); this.snapL = '';   // #588 shape: rect / door / round / arch / hole
    this.isPortal = true; this.floor = false; this.tilt = true; this.mp = { save: () => set.save() }; this.flashT = 0;   // #586 MOVIE PROPS placement laser target
    const g = this.obj = new THREE.Group(); g.name = 'portal'; g.visible = false; g.userData.noMirror = true; set.rig.add(g);
    this.mat = makeTrimMat();
    this.trim = new THREE.Mesh(new THREE.BufferGeometry(), this.mat); g.add(this.trim);
    this.hp = { x: new THREE.Vector3(), y: new THREE.Vector3(), xy: new THREE.Vector3() };   // handle spots (frame-local) for corner()
    this._fit();
  }
  setGlow(name) { const c = GLOWS[name]; this.mat.userData.uGlow.value.setHex(c || 0).multiplyScalar(c ? 2.2 : 0); }
  setFlash(k) { this.mat.userData.uGlow.value.setRGB(k, k, k); }
  setDoor(on) { on = !!on; if (on === this.door) return; this.door = on; if (on) this._floor(); this._fit(); }
  setShape(sh) { if (sh === this.shape) return; this.shape = sh; this.door = sh === 'door'; if (sh === 'arch' && this.half.y < this.half.x * 1.3) this.half.y = Math.min(HMAX, this.half.x * 1.6); if (this.door) this._floor(); this._fit(); }   // #588 an arch starts tall
  _floor() {   // a doorway stands on the floor (rig y = 0) and stays upright
    const e = new THREE.Euler().setFromQuaternion(this.obj.quaternion, 'YXZ'); this.obj.quaternion.setFromAxisAngle(_y, e.y);
    this.obj.position.y = this.half.y;
  }
  _fit() {
    const sh = this.shape, door = this.door, circ = sh === 'round' || sh === 'hole';
    if (circ && this.half.x !== this.half.y) { const m = this._g && this._g.edge === 'y' ? this.half.y : this.half.x; this.half.set(m, m); }   // #588 round frames stay round
    const { x: hx, y: hy } = this.half;
    let rT = circ ? hx : sh === 'arch' ? Math.min(hx, hy) : cornerRadius(hx, hy), rB = door ? 0 : sh === 'arch' ? Math.min(0.03, rT) : rT; if (this.bamboo) { rT = rB = 0.02; } this.r.set(rT, rB);   // #598 bamboo: a square opening
    const o = 0.055, dg = (rT + o) * Math.SQRT1_2;   // on the concrete face; the ring on the top-right corner's diagonal
    this.hp.x.set(hx + o, door ? hy * 0.1 : 0, 0); this.hp.y.set(0, hy + o, 0); this.hp.xy.set(hx - rT + dg, hy - rT + dg, 0);
    this.trim.geometry.dispose(); this.trim.geometry = buildTrim(hx, hy, rT, rB, !door, this.hp, sh === 'round' || sh === 'arch' ? grillBoxes(hx, hy, rT, sh === 'arch') : null);
    if (door && !this.held) this.obj.position.y = hy;
    this._scrFit();
    this._holoFit(); this._bamFit();   // #598
  }
  setScreen(on) { on = !!on; if (on === this.screen) return; this.screen = on; this._scrFit(); }   // #589
  setStyle(st) { const h = st === 'holo', b = st === 'bamboo'; if (h === !!this.holo && b === !!this.bamboo) return; this.holo = h; this.bamboo = b; this._fit(); }   // #598 iron / holo / bamboo
  _bamFit() {
    const B = this.set.bamboo, wood = B.kind === 'wood';
    if (this.bm) this.bm.visible = false; if (this.wm) this.wm.visible = false;
    if (!this.bamboo) return;
    const mk = (geo, mat) => { const im = new THREE.InstancedMesh(geo, mat, BAM_MAX); im.raycast = () => {}; im.frustumCulled = false; this.obj.add(im); im.setColorAt(0, new THREE.Color(1, 1, 1)); return im; };
    if (wood) { if (!this.wm) this.wm = mk(woodGeo, makeWoodMat()); layWood(this.wm, this.half.x, this.half.y, B); this.wm.visible = true; }
    else { if (!this.bm) this.bm = mk(bamGeo, makeBambooMat()); layBamboo(this.bm, this.half.x, this.half.y, B); this.bm.visible = true; }
  }
  _holoFit() {
    this.trim.visible = !this.holo && !this.bamboo;
    if (!this.holo) { if (this.hm) this.hm.visible = false; return; }
    if (!this.hm) { this.hm = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), makeHoloMat()); this.hm.raycast = () => {}; this.hm.renderOrder = 5; this.obj.add(this.hm); }
    const { x: hx, y: hy } = this.half, U = this.hm.material.uniforms;
    this.hm.geometry.dispose(); this.hm.geometry = new THREE.PlaneGeometry(2 * hx + 0.6, 2 * hy + 0.12); this.hm.position.z = 0.004; this.hm.visible = true;
    U.uHalf.value.set(hx, hy); U.uR.value.copy(this.r);
  }
  _scrFit() {   // the panel sits 1.2 cm behind the opening plane, inside the iron reveal; one more draw only while it is a screen
    if (!this.screen) { if (this.scr) this.scr.visible = false; return; }
    if (!this.scr) { this.scr = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), makeScreenMat()); this.scr.raycast = () => {}; this.scr.renderOrder = -1; this.scr.onBeforeRender = r => { const t = r.getRenderTarget(); this.scr.material.uniforms.uAces.value = t && t.vireAces ? 1 : 0; };   /* #591 */ this.obj.add(this.scr); }
    const { x: hx, y: hy } = this.half, U = this.scr.material.uniforms;
    this.scr.geometry.dispose(); this.scr.geometry = new THREE.PlaneGeometry(2 * hx, 2 * hy); this.scr.position.z = -0.012; this.scr.visible = true;
    U.uHalf.value.set(hx, hy); U.uR.value.copy(this.r);
  }

  hit(P) {   // grab box: the trim frame + slack
    if (!this.obj.visible) return false;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P));
    return Math.abs(l.x) < this.half.x + RIM + 0.08 && Math.abs(l.y) < this.half.y + RIM + 0.08 && Math.abs(l.z) < 0.12;
  }

  // Which handle the hand is on (trigger / pinch): 'x' side bar, 'y' top bar, 'xy' corner ring
  corner(P) {
    this._edge = null; if (!this.obj.visible) return false;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P));
    if (Math.abs(l.z) > 0.12) return false;
    const R = this.hp.xy, S = this.hp.x, T = this.hp.y;
    if (Math.hypot(l.x - R.x, l.y - R.y) < GRAB + 0.02) this._edge = 'xy';
    else if (Math.abs(l.x - S.x) < GRAB && Math.abs(l.y - S.y) < 0.12) this._edge = 'x';
    else if (Math.abs(l.y - T.y) < GRAB && Math.abs(l.x - T.x) < 0.12) this._edge = 'y';
    return !!this._edge;
  }

  // s = how far the hand is from the centre now / at the start (the object's scale stays 1): handle follows
  scaleTo(s) {
    if (!this._g) this._g = { half: this.half.clone(), edge: this._edge || 'xy' };
    const { half: b, edge: e } = this._g, cl = v => Math.min(HMAX, Math.max(HMIN, v));
    if (e !== 'y') this.half.x = cl(b.x * s);
    if (e !== 'x') this.half.y = cl(b.y * s);
    this._fit(); if (this.door) this.obj.position.y = this.half.y;   // a doorway grows upward from the floor
  }

  grab() { this.held = true; this._edge = null; this._g = null; }
  hold(world) {
    this.set.rig.updateMatrixWorld();
    _m.copy(this.set.rig.matrixWorld).invert().multiply(world);
    _m.decompose(this.obj.position, this.obj.quaternion, _s);
    this.obj.scale.set(1, 1, 1);
    if (this.door) this._floor();
  }
  release() { this.held = false; if (this.door) this._floor(); this.save(); }
  save() { this._g = null; this._edge = null; this.set.save(); }
  place(h) { this.obj.position.copy(h.p); this.obj.quaternion.setFromAxisAngle(_y, h.yaw); this.obj.scale.set(1, 1, 1); if (this.door) this._floor(); }
  // #586 placement laser (movieprops.js Placer): aim box, size by the stick, keep a doorway on the floor after each move
  localBox() { return _box.set(_v.set(-this.half.x - RIM, -this.half.y - RIM, -0.1), _v2.set(this.half.x + RIM, this.half.y + RIM, 0.1)); }
  rayT(o, d) {
    if (!this.obj.visible) return -1;
    const b = this.localBox().clone(); this.obj.updateWorldMatrix(true, false); _m.copy(this.obj.matrixWorld).invert();
    _ray.origin.copy(o).applyMatrix4(_m); _v.copy(o).add(d).applyMatrix4(_m).sub(_ray.origin); const L = _v.length(); if (L < 1e-9) return -1; _ray.direction.copy(_v).divideScalar(L);
    if (b.containsPoint(_ray.origin)) return -1; const h = _ray.intersectBox(b, _v); return h ? _ray.origin.distanceTo(h) / L : -1;
  }
  resize(k) { const cl = v => Math.min(HMAX, Math.max(HMIN, v)); this.half.set(cl(this.half.x * k), cl(this.half.y * k)); this._fit(); }
  placeHandles() { if (this.door) this._floor(); }
}

export { HMIN, HMAX };
export class Portals {
  // home(i): { p: Vector3, yaw } in rig space, frame i's start spot (the first in front of the mirror, the rest along the wall)
  constructor(rig, home) {
    this.rig = rig; this.home = home; this.on = false; this.n = 1; this.list = []; this.glow = 'off'; this.kinds = []; this.edit = 0; this.scrSrc = { src: 'cyclo', name: '', folder: '' }; this.feed = null;   // #589 one screen feed for all SCREEN frames; feed() -> { tex, w, h } (main.js)   // #585 / #586 kinds per frame
    this.grade = { ...GRADE0 };   // #597 FRAME LOOK
    this.styles = []; this.holo = { ...HOLO0 }; this.bamboo = { ...BAMBOO0 }; this.beat = 0;   // #598 per frame 'iron' / 'holo'; one HOLO look for all
    this._mats = new Set();
    this._u = { portalInv: { value: Array.from({ length: MAX_PORTALS }, () => new THREE.Matrix4()) },
      portalHalf: { value: Array.from({ length: MAX_PORTALS }, () => HALF0.clone()) },
      portalR: { value: Array.from({ length: MAX_PORTALS }, () => new THREE.Vector2()) }, portalRev: { value: new Array(MAX_PORTALS).fill(0) },
      portalN: { value: 0 }, portalRevN: { value: 0 } };
    this._load();
  }
  _frame(i) { while (this.list.length <= i) this.list.push(new PortalFrame(this)); return this.list[i]; }
  active() { return this.on ? this.list.slice(0, this.n) : []; }   // the grabbable ones (xr.js props)
  _load() {
    let s = null; try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
    if (!s) { try { const o = JSON.parse(localStorage.getItem(OLD_KEY) || 'null');   // #345 single portal
      if (o && o.p && o.q) s = { on: o.on, n: 1, f: [{ p: o.p, q: o.q, h: [HALF0.x * (o.s || 1), HALF0.y * (o.s || 1)] }] }; } catch {} }
    this.n = Math.min(MAX_PORTALS, Math.max(1, (s && s.n) || 1));
    this.glow = s && GLOWS[s.glow] !== undefined ? s.glow : 'off';   // #585
    if (s && s.grade) Object.assign(this.grade, s.grade); applyGrade(this.grade);   // #597
    if (s && s.bamboo) Object.assign(this.bamboo, s.bamboo);
    if (s && s.holo) Object.assign(this.holo, s.holo); this.styles = Array.from({ length: MAX_PORTALS }, (_, i) => (s && s.f && s.f[i] && s.f[i].st) || 'iron');   // #598
    if (s && s.scr && s.scr.src) this.scrSrc = { src: s.scr.src, name: s.scr.name || '', folder: s.scr.folder || '' };   // #589
    const doors = (s && s.doors) | 0;   // #585 saved a count of doorways (the first k); #586 a kind per frame
    this.kinds = Array.from({ length: MAX_PORTALS }, (_, i) => (s && s.f && s.f[i] && KINDS.includes(s.f[i].k)) ? s.f[i].k : i < doors ? 'door' : 'window');
    for (let i = 0; i < this.n; i++) {
      const f = this._frame(i), d = s && s.f && s.f[i];
      if (d && d.p && d.q) { f.obj.position.fromArray(d.p); f.obj.quaternion.fromArray(d.q); if (d.h) f.half.fromArray(d.h); f.snapL = d.s || ''; f._fit(); }
      else f.place(this.home(i, this.n));
    }
    this._styles();
    this.setOn(!!(s && s.on), false);
  }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ on: this.on, n: this.n, glow: this.glow, scr: this.scrSrc, grade: this.grade, holo: this.holo, bamboo: this.bamboo,
      f: this.list.slice(0, this.n).map((f, i) => ({ p: f.obj.position.toArray(), q: f.obj.quaternion.toArray(), h: f.half.toArray(), k: this.kinds[i], s: f.snapL || '', st: this.styles[i] || 'iron' })) })); } catch {}   // #592 s = the scanned surface it sits on
  }
  _show() { this.list.forEach((f, i) => { f.obj.visible = this.on && i < this.n; }); this._u.portalN.value = this.on ? this.n : 0; this._u.portalRevN.value = this.revN; }
  // #585 the first `doors` frames are doorways (on the floor, open at the bottom), the rest bay windows; TRIM LIGHT colour
  _styles() { this.list.forEach((f, i) => { const k = this.kinds[i] || 'window'; f.setShape(SHAPE_OF(k)); f.rev = k[0] === 'p'; f.setScreen(k[0] === 's'); f.setGlow(this.glow); f.setStyle(this.styles[i]); }); }   // #588 shape from the kind, #589 screen   // #588 shape from the kind
  get doors() { return this.kinds.slice(0, this.n).filter(k => k === 'door' || k === 'pdoor').length; }
  kindOf(i) { return this.kinds[i] || 'window'; }
  setKind(i, k) { if (!KINDS.includes(k)) return; this.kinds[i] = k; this._styles(); this.save(); this.flash(i); }
  stepKind(i, d) { const j = KINDS.indexOf(this.kindOf(i)); this.setKind(i, KINDS[(j + d + KINDS.length) % KINDS.length]); }
  setEdit(i) { this.edit = Math.min(this.n - 1, Math.max(0, i | 0)); this.flash(this.edit); }
  flash(i) { const f = this.list[i]; if (f) f.flashT = performance.now() + 1500; }   // the frame being set up blinks white
  get screenN() { let n = 0; for (let i = 0; i < this.n; i++) if (this.kindOf(i)[0] === 's') n++; return this.on ? n : 0; }   // #589
  setScreenSrc(o) { this.scrSrc = { src: o.src || 'cyclo', name: o.name || '', folder: o.folder || '' }; this.save(); }
  get revN() { let n = 0; for (let i = 0; i < this.n; i++) if (this.kindOf(i)[0] === 'p') n++; return this.on ? n : 0; }
  setDoors(k) { for (let i = 0; i < MAX_PORTALS; i++) { const rev = this.kindOf(i)[0] === 'p'; this.kinds[i] = (i < k ? (rev ? 'pdoor' : 'door') : (rev ? 'pwindow' : 'window')); } this._styles(); this.save(); }
  stepGlow(d) { const i = GLOW_ORDER.indexOf(this.glow); this.glow = GLOW_ORDER[((i < 0 ? 0 : i) + d + GLOW_ORDER.length) % GLOW_ORDER.length]; this._styles(); this.save(); }
  styleOf(i) { return this.styles[i] || 'iron'; }   // #598
  setStyle(i, st) { this.styles[i] = st; this._styles(); this.save(); this.flash(i); }
  get holoN() { let n = 0; for (let i = 0; i < this.n; i++) if (this.styleOf(i) === 'holo') n++; return this.on ? n : 0; }
  setBamboo(k, v) { if (k === 'reset') Object.assign(this.bamboo, BAMBOO0); else this.bamboo[k] = v; for (let i = 0; i < this.n; i++) { const f = this.list[i]; if (f && f.bamboo) f._bamFit(); } this.save(); }   // #598
  setHolo(k, v) { if (k === 'reset') Object.assign(this.holo, HOLO0); else this.holo[k] = v; this.save(); }
  setGrade(k, v) { if (k === 'reset') Object.assign(this.grade, GRADE0); else this.grade[k] = v; applyGrade(this.grade); this.save(); }   // #597
  setOn(on, save = true) { this.on = !!on; this._show(); if (save) this.save(); }
  // more frames: the new ones start at their spots across the wall; fewer: the extra ones are put away (kept for later)
  setCount(n) {
    n = Math.min(MAX_PORTALS, Math.max(1, n | 0));
    for (let i = this.n; i < n; i++) { const f = this._frame(i); f.half.copy(HALF0); f._fit(); f.place(this.home(i, n)); }
    this.n = n; this.edit = Math.min(this.edit, n - 1); this._styles(); this._show(); this.save();
  }
  reset() { for (let i = 0; i < this.n; i++) { const f = this._frame(i); f.snapL = ''; f.half.copy(HALF0); f._fit(); f.place(this.home(i, this.n)); } this._styles(); this.save(); }
  // Cut the portals into every mesh under obj (FacetWall's group, the sky dome, any loaded room/cabin glb). Idempotent
  // per material -- call it again any time a new glb finishes loading and it just adds its materials to the registry.
  // { sky: true } = the sky dome: PANO frames show it only through themselves (#586)
  cutInto(obj, opt = {}) {
    obj.traverse(o => {
      if (!o.isMesh || !o.material) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) this._patch(m, opt.sky);
    });
  }
  _patch(m, sky) {
    if (this._mats.has(m)) return; this._mats.add(m);
    m.defines = m.defines || {}; m.defines.USE_PORTAL = ''; if (sky) m.defines.PORTAL_SKY = '';
    const u = this._u;
    if (m.isShaderMaterial) {   // own shader source: inject straight into it
      Object.assign(m.uniforms, u);
      m.vertexShader = m.vertexShader.replace('void main() {', DECL + '\nvoid main() {\n' + VERT_SM);
      m.fragmentShader = m.fragmentShader.replace('void main() {', DECL + '\nvoid main() {\n' + FRAG);
      m.needsUpdate = true; return;
    }
    const prev = m.onBeforeCompile;
    // three.js keys programs by onBeforeCompile.toString(), the same for every material patched here: fold in the
    // material's earlier hook / key so two patched materials with different hooks never share one program
    const oldKey = m.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey ? (prev ? prev.toString() : '') : m.customProgramCacheKey();
    m.customProgramCacheKey = () => oldKey + (sky ? '|portalsky' : '|portal');
    m.onBeforeCompile = shader => {
      if (prev) prev(shader);
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT).replace('#include <common>', '#include <common>\n' + DECL);
      shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG).replace('#include <common>', '#include <common>\n' + DECL);
    };
    m.needsUpdate = true;
  }
  // per frame: keep the clip uniforms in step with wherever the frames have been dragged / resized to
  tick() {
    if (!this.on) return;
    this._u.portalRevN.value = this.revN;
    for (let i = 0; i < this.n; i++) {
      const f = this.list[i]; f.obj.updateMatrixWorld();
      this._u.portalInv.value[i].copy(f.obj.matrixWorld).invert(); this._u.portalHalf.value[i].copy(f.half); this._u.portalR.value[i].copy(f.r); this._u.portalRev.value[i] = f.rev ? 1 : 0;
      if (f.screen && f.scr) {   // #589 the shared feed, cover-fitted to this opening
        const F = this.feed && this.feed(), U = f.scr.material.uniforms;
        if (F && F.tex && F.w && F.h) {
          U.map.value = F.tex; U.uHas.value = 1; const A = f.half.x / f.half.y, a = F.w / F.h;
          if (a > A) { const cw = A / a; U.uCrop.value.set((1 - cw) / 2, 0, cw, 1); } else { const ch = a / A; U.uCrop.value.set(0, (1 - ch) / 2, 1, ch); }
        } else U.uHas.value = 0;
      }
      if (f.holo && f.hm) {   // #598
        const U = f.hm.material.uniforms, H = this.holo; U.uT.value = performance.now() / 1000; U.uCol.value.setHex(HOLO_COLS[H.col] || HOLO_COLS.cyan);
        U.uInt.value = H.int; U.uScan.value = H.scan; U.uGlass.value = H.glass; U.uGlitch.value = H.glitch; U.uBeat.value = H.beat ? Math.min(1, this.beat) : 0;
      }
      if (f.flashT) { const left = f.flashT - performance.now(); if (left > 0) f.setFlash(1.5 + 1.5 * Math.sin(left / 80)); else { f.flashT = 0; f.setGlow(this.glow); } }
    }
  }
}
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0), _box = new THREE.Box3(), _ray = new THREE.Ray();
