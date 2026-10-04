// Procedural models. Every part that could later be swapped for a purchased GLB is created
// through a named factory in PARTS (CLAUDE.md #5); swap by replacing the factory.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/three/utils/BufferGeometryUtils.js';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';
import { KTX2Loader } from '../vendor/three/loaders/KTX2Loader.js';
// #132: GPU-compressed textures (KTX2 / Basis UASTC, transcoded to ASTC on Quest, BC7 on desktop GPUs): ~4x less
// texture memory than PNG. main.js calls initKTX2(renderer) once; baked models then load their *_ktx.glb and fall
// back to the PNG GLB if that fails.
let KTX2 = null;
export function initKTX2(renderer) {
  if (KTX2) return;
  try { KTX2 = new KTX2Loader().setTranscoderPath(new URL('../vendor/three/libs/basis/', import.meta.url).href).detectSupport(renderer); }
  catch (e) { console.warn('KTX2 unavailable', e); KTX2 = null; }
}
export async function loadBaked(url) {
  const ktx = url.replace(/\.glb$/, '_ktx.glb');
  if (KTX2) {
    try { return await new GLTFLoader().setKTX2Loader(KTX2).loadAsync(ktx); }
    catch (e) { console.warn('KTX2 model failed, using PNG textures', ktx, e); }
  }
  return new GLTFLoader().loadAsync(url);
}
import { mergeStatic } from './merge.js';
import { logoHeightCanvas } from './neon.js';
import { REC, REC7, dimsOf, LABEL_BUMP_R, labelBumpMap, labelBumpMapAsync, grooveAnisoMap, drawRecordSide, recordMaterial, setRecordSide, glowTexture, strobeDotTexture, brushedTexture, mixerFaceTextures, satinSteel } from './textures.js';

export const W33 = 2 * Math.PI * (100 / 3) / 60; // rad/s at 33 1/3

// ---------- materials ----------
export const MAT = {};
export function initMaterials() {
  const brushed = brushedTexture(175);
  brushed.repeat.set(3, 3);
  MAT.alu = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.85, roughness: 0.38, map: brushed });
  MAT.aluDark = new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.8, roughness: 0.45 });
  MAT.black = new THREE.MeshStandardMaterial({ color: 0x111214, metalness: 0.2, roughness: 0.55 });
  MAT.blackGloss = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, metalness: 0.3, roughness: 0.25 });
  MAT.rubber = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, metalness: 0, roughness: 0.9 });
  MAT.chrome = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12 });
  MAT.felt = new THREE.MeshStandardMaterial({ color: 0x141416, metalness: 0, roughness: 1 });
  MAT.mixerPanel = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, metalness: 0.5, roughness: 0.4 });
  MAT.knob = new THREE.MeshStandardMaterial({ color: 0x202124, metalness: 0.3, roughness: 0.5 });
  MAT.knobCap = new THREE.MeshStandardMaterial({ color: 0x8a8d93, metalness: 0.9, roughness: 0.3 });
  MAT.white = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0, roughness: 0.6 });
  MAT.table = new THREE.MeshStandardMaterial({ color: 0x17181b, metalness: 0.1, roughness: 0.7 });
  MAT.sleeve = new THREE.MeshStandardMaterial({ color: 0xe9e6de, metalness: 0, roughness: 0.85 });
  const caseTex = brushedTexture(120); caseTex.repeat.set(2, 2);
  MAT.case = new THREE.MeshStandardMaterial({ color: 0x8c909a, map: caseTex, metalness: 0.3, roughness: 0.5 });
}

function box(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); }
function cyl(rt, rb, h, mat, seg = 48) { return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); }
function rounded(w, h, d, r, mat) {
  const s = new THREE.Shape(); const x = -w / 2, z = -d / 2;
  s.moveTo(x + r, z); s.lineTo(x + w - r, z); s.quadraticCurveTo(x + w, z, x + w, z + r);
  s.lineTo(x + w, z + d - r); s.quadraticCurveTo(x + w, z + d, x + w - r, z + d);
  s.lineTo(x + r, z + d); s.quadraticCurveTo(x, z + d, x, z + d - r);
  s.lineTo(x, z + r); s.quadraticCurveTo(x, z, x + r, z);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 6 });
  g.rotateX(Math.PI / 2); g.translate(0, h, 0);
  return new THREE.Mesh(g, mat);
}

// ---------- LED with glow sprite ----------
export function makeLED(color, size = 0.004, glowSize = 0.03) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(color), emissiveIntensity: 0, roughness: 0.3 });
  const led = new THREE.Mesh(new THREE.CylinderGeometry(size, size, 0.002, 16), m);
  g.add(led);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
  sp.scale.setScalar(glowSize); sp.position.y = 0.002; g.add(sp);
  g.userData.set = (v) => { m.emissiveIntensity = v * 2.5; sp.material.opacity = v * 0.9; };
  return g;
}

// ---------- controls ----------
// Knobs in the Vinyl Reality style (CLAUDE.md #60): soft-touch black rubber with a knurled side, a satin
// top and a white pointer line from the centre to the edge; the dotted scale is printed on the face.
let knurlTex = null;
function knurl() {
  if (knurlTex) return knurlTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 16; const g = c.getContext('2d');
  for (let x = 0; x < 256; x++) { const v = 128 + 110 * Math.cos(x / 256 * Math.PI * 2 * 40); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, 16); }
  knurlTex = new THREE.CanvasTexture(c); knurlTex.wrapS = THREE.RepeatWrapping; return knurlTex;
}
const KM = {};
function knobMats() {
  if (KM.side) return KM;
  KM.side = new THREE.MeshStandardMaterial({ color: 0x17161b, roughness: 0.82, metalness: 0, bumpMap: knurl(), bumpScale: 1.4 });
  KM.top = new THREE.MeshStandardMaterial({ color: 0x1d1c22, roughness: 0.42, metalness: 0.05 });
  KM.skirt = new THREE.MeshStandardMaterial({ color: 0x121115, roughness: 0.7, metalness: 0 });
  return KM;
}
export function makeKnob(radius = 0.0105, color = 0xffffff) {
  const m = knobMats(), g = new THREE.Group();
  const skirt = cyl(radius * 1.14, radius * 1.18, 0.0025, m.skirt, 40); skirt.position.y = 0.00125; g.add(skirt);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.93, radius, 0.0145, 48, 1), [m.side, m.top, m.skirt]);
  body.position.y = 0.0025 + 0.00725; g.add(body);
  // pointer line printed flush on the flat satin top
  const ptr = box(0.0013, 0.0004, radius * 0.86, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4 }));
  ptr.position.set(0, 0.0172, -radius * 0.47); g.add(ptr);
  g.userData.turn = new THREE.Group();
  return g;
}

export function makeFaderCap(w = 0.018, d = 0.011, color = 0xffffff) {
  const g = new THREE.Group();
  const base = box(w, 0.012, d, MAT.black); base.position.y = 0.006; g.add(base);
  const top = box(w * 1.02, 0.003, d * 1.05, MAT.aluDark); top.position.y = 0.0135; g.add(top);
  const line = box(w * 0.9, 0.0008, 0.0014, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3 })); line.position.y = 0.0152; g.add(line);
  return g;
}

export function makeButton(w, d, color, label) { return makeRubberButton(w, d, color, label || ''); }

// Flat black rubber push button with its legend cut out and lit from behind by an LED (CLAUDE.md #60).
// set(v) drives the LED (0 = dark, ~0.06 = standby glow, 1 = on); setColor() changes the LED colour;
// press() dips the button 1.2 mm.
function textMask(text, w, d, bg = '#000', fg = '#fff') {
  const W = 256, H = Math.max(32, Math.round(256 * d / w)), c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  if (text) {
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = H * 0.52; g.font = `800 ${fs}px system-ui, Arial, sans-serif`;
    while (g.measureText(text).width > W * 0.78 && fs > 8) { fs -= 2; g.font = `800 ${fs}px system-ui, Arial, sans-serif`; }
    g.fillText(text, W / 2, H / 2 + fs * 0.04);
  } else { g.fillStyle = fg; g.fillRect(W * 0.3, H * 0.44, W * 0.4, H * 0.12); }
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; if (bg !== '#000') t.colorSpace = THREE.SRGBColorSpace; return t;
}
function roundedTop(w, d, r, y) {
  const s = new THREE.Shape(); const x = -w / 2, z = -d / 2;
  s.moveTo(x + r, z); s.lineTo(x + w - r, z); s.quadraticCurveTo(x + w, z, x + w, z + r);
  s.lineTo(x + w, z + d - r); s.quadraticCurveTo(x + w, z + d, x + w - r, z + d);
  s.lineTo(x + r, z + d); s.quadraticCurveTo(x, z + d, x, z + d - r);
  s.lineTo(x, z + r); s.quadraticCurveTo(x, z, x + r, z);
  const geo = new THREE.ShapeGeometry(s, 6); geo.rotateX(-Math.PI / 2); geo.translate(0, y, 0);
  // planar UVs over the button face
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, 1 - (p.getZ(i) + d / 2) / d);
  return geo;
}
export function makeRubberButton(w, d, color, text) {
  const g = new THREE.Group(), r = Math.min(w, d) * 0.22;
  const led = new THREE.Color(color);
  // recessed bezel the button sits in; LED light leaks round the gap
  const leakMat = new THREE.MeshBasicMaterial({ color: led.clone().multiplyScalar(0), toneMapped: false });
  const bezel = new THREE.Mesh(roundedTop(w + 0.003, d + 0.003, r + 0.0015, 0.0003), leakMat); g.add(bezel);
  const btn = new THREE.Group(); g.add(btn);
  const rubber = new THREE.MeshStandardMaterial({ color: 0x161518, roughness: 0.88, metalness: 0 });
  const body = rounded(w, 0.0022, d, r, rubber); body.scale.set(1, 1, 1); btn.add(body);
  // rounded() adds a 3 mm bevel on each side; find its real top
  body.geometry.computeBoundingBox(); const bb = body.geometry.boundingBox;
  body.scale.set(w / (bb.max.x - bb.min.x), 1, d / (bb.max.z - bb.min.z));
  const topY = bb.max.y + 0.0002;
  const mask = textMask(text, w, d);
  const faceMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: textMask(text, w, d, '#1a191d', '#6a6a72'), roughness: 0.8, metalness: 0, emissive: led.clone(), emissiveMap: mask, emissiveIntensity: 0,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const face = new THREE.Mesh(roundedTop(w * 0.96, d * 0.94, r * 0.9, topY), faceMat); btn.add(face);
  let level = 0, pressedAt = -1e9;
  const apply = () => { faceMat.emissiveIntensity = level * 3.2; leakMat.color.copy(led).multiplyScalar(0.015 + level * 0.9); };   // #139: no glow sprite
  g.userData.set = (v) => {
    level = Math.max(0, Math.min(1.5, v)); apply();
    const t = (performance.now() - pressedAt) / 1000;
    btn.position.y = -0.0012 * (t < 0.05 ? t / 0.05 : t < 0.15 ? 1 : Math.max(0, 1 - (t - 0.15) / 0.1));
  };
  g.userData.setColor = (c) => { led.set(c); faceMat.emissive.copy(led); apply(); };
  g.userData.press = () => { pressedAt = performance.now(); };
  g.userData.mesh = body; face.userData = body.userData;   // both parts carry the control tag
  g.userData.faceMat = faceMat;
  apply();
  return g;
}

// #134: Blender mixer parts (blender/mixer/mixer.blend -> web/models/mixer_parts.glb, 30 KB). Three low-poly models:
// MixButton (rounded rubber cap, 110 tris, top face UV 0..1), MixKnob (152 tris, unit radius 0.0105; the pointer is
// the vertex-colour-white part) and MixFader (30 tris, 19.6 x 11 mm). Knob and fader share one material: vertex
// colours for the base colours, a 256 normal map (knob knurl, brushed cap plate) and a 256 occlusion/roughness/metal
// map. main.js awaits loadMixerParts() before makeMixer(); without it makeMixer builds the procedural parts.
let MIXP = null;
const BTN_W = 0.022, BTN_D = 0.012, KNOB_R0 = 0.0105, CAP_W = 0.0196, CAP_D = 0.011;
export async function loadMixerParts(url) {
  if (MIXP) return MIXP;
  const gltf = await new GLTFLoader().loadAsync(url);
  const get = n => { const o = gltf.scene.getObjectByName(n); if (!o || !o.isMesh) throw new Error('mixer parts GLB: missing ' + n); return o; };
  const btn = get('MixButton'), knob = get('MixKnob'), fader = get('MixFader');
  const fmat = fader.material; fmat.side = THREE.FrontSide; fmat.vertexColors = true; fmat.name = 'mixparts';
  // knob: the pointer (white vertex colour) takes the instance colour and is lit like the old unlit pointer (x 0.85);
  // the rest of the knob ignores the instance colour
  const kmat = fmat.clone(); kmat.name = 'mixparts_knob';
  kmat.onBeforeCompile = s => {
    const dec = 'varying float vPtr; varying vec3 vInst;\nvoid main() {';
    s.vertexShader = s.vertexShader.replace('void main() {', dec).replace('#include <color_vertex>',
      THREE.ShaderChunk.color_vertex.replace('vColor.xyz *= instanceColor.xyz;', '') +
      '\nvPtr = step(0.9, color.r);\n#ifdef USE_INSTANCING_COLOR\nvInst = instanceColor;\n#else\nvInst = vec3(1.0);\n#endif');
    s.fragmentShader = s.fragmentShader.replace('void main() {', dec).replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ndiffuseColor.rgb *= 1.0 - vPtr; totalEmissiveRadiance += vPtr * vInst * 0.85;');
  };
  kmat.customProgramCacheKey = () => 'vire-mixknob';
  MIXP = { button: btn.geometry, knob: knob.geometry, fader: fader.geometry, fmat, kmat, faderRed: null };
  return MIXP;
}
function mixFaderCap(w, d, color) {
  let geo = MIXP.fader;
  if ((color !== undefined && color !== 0xffffff) || d !== CAP_D) {   // recolour the white line (crossfader: red), keep it 1.4 mm wide
    geo = geo.clone(); const C = geo.attributes.color, Pz = geo.attributes.position, c = new THREE.Color(color ?? 0xffffff), k = CAP_D / d;
    for (let i = 0; i < C.count; i++) if (C.getX(i) > 0.9) { C.setX(i, c.r); C.setY(i, c.g); C.setZ(i, c.b); Pz.setZ(i, Pz.getZ(i) * k); }
  }
  const g = new THREE.Group(), m = new THREE.Mesh(geo, MIXP.fmat);
  m.scale.set(w / CAP_W, 1, d / CAP_D); m.castShadow = true; g.add(m);
  return g;
}
// all mixer buttons as one instanced batch (+ one for the LED leak round them; #139: no glow cards): 2 draw calls for
// the 7 buttons (were 4 each). Same interface as makeRubberButton on each button's proxy group: set, setColor, press.
function mixButtons(parent, specs, top) {
  const n = specs.length;
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
  const x2 = cv.getContext('2d'); x2.fillStyle = '#000'; x2.fillRect(0, 0, 512, 512);
  specs.forEach((s, i) => {   // legend atlas: 2 x 4 cells of 256 x 128, white on black (a mask)
    const cx = (i % 2) * 256, cy = Math.floor(i / 2) * 128, W = 256, H = 128, k = 2 * s.d / s.w;   // k: keeps letters unstretched
    x2.save(); x2.beginPath(); x2.rect(cx, cy, W, H); x2.clip(); x2.fillStyle = '#fff';
    if (s.text) {
      x2.translate(cx + W / 2, cy + H / 2); x2.scale(k, 1); x2.textAlign = 'center'; x2.textBaseline = 'middle';
      let fs = H * 0.52; x2.font = `800 ${fs}px system-ui, Arial, sans-serif`;
      while (x2.measureText(s.text).width * k > W * 0.78 && fs > 8) { fs -= 2; x2.font = `800 ${fs}px system-ui, Arial, sans-serif`; }
      x2.fillText(s.text, 0, fs * 0.04);
    } else x2.fillRect(cx + W * 0.3, cy + H * 0.44, W * 0.4, H * 0.12);
    x2.restore();
  });
  // #139: G = a soft halo round the letters (the light spreading through the backlit rubber), R = the crisp legend
  { const bl = document.createElement('canvas'); bl.width = bl.height = 512; const bg = bl.getContext('2d');
    bg.filter = 'blur(7px)'; bg.drawImage(cv, 0, 0); bg.filter = 'none';
    const A = x2.getImageData(0, 0, 512, 512), B = bg.getImageData(0, 0, 512, 512);
    for (let i = 0; i < A.data.length; i += 4) { A.data[i + 1] = Math.min(255, B.data[i] * 1.6); A.data[i + 2] = 0; }
    x2.putImageData(A, 0, 0); }
  const atlas = new THREE.CanvasTexture(cv); atlas.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: atlas, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'attribute vec2 aCell; attribute vec3 aEmit; varying vec2 vCell; varying vec3 vEmit;\nvoid main() {')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCell = aCell + vec2(vMapUv.x, 1.0 - vMapUv.y) * vec2(0.5, 0.25); vEmit = aEmit;');
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying vec2 vCell; varying vec3 vEmit;\nvoid main() {')
      .replace('#include <map_fragment>', 'vec2 vireM = texture2D(map, vCell).rg; float vireMk = vireM.r;\ndiffuseColor.rgb *= mix(vec3(0.0103, 0.0097, 0.0123), vec3(0.144, 0.144, 0.167), vireMk);\nvec3 vireGlow = vEmit * (vireMk + 0.45 * vireM.g * (1.0 - vireMk));')
      .replace('#include <emissivemap_fragment>', '')
      // #139: the LED light is added AFTER tone mapping, so a lit legend keeps its full saturated colour (no fake glow card)
      .replace('#include <tonemapping_fragment>', '#include <tonemapping_fragment>\ngl_FragColor.rgb += vireGlow;');
  };
  mat.customProgramCacheKey = () => 'vire-mixbtn';
  const geo = MIXP.button.clone();
  const aCell = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2), aEmit = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  aEmit.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aCell', aCell); geo.setAttribute('aEmit', aEmit);
  specs.forEach((s, i) => aCell.setXY(i, (i % 2) * 0.5, 1 - (Math.floor(i / 2) + 1) * 0.25));
  const body = new THREE.InstancedMesh(geo, mat, n);
  const r = Math.min(BTN_W, BTN_D) * 0.22;
  const leak = new THREE.InstancedMesh(roundedTop(BTN_W + 0.003, BTN_D + 0.003, r + 0.0015, 0.0003), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n);
  leak.raycast = () => {};   // #139: the additive glow cards are gone
  body.castShadow = true; body.userData.knobIds = specs.map(s => s.id);   // hitTarget(): instance i -> its proxy group
  for (const im of [body, leak]) im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const M = new THREE.Matrix4(), P = new THREE.Vector3(), S = new THREE.Vector3(), Q0 = new THREE.Quaternion(), tmp = new THREE.Color();
  specs.forEach((s, i) => {
    const g = s.g, led = new THREE.Color(s.color); let level = 0, pressedAt = -1e9;
    leak.setMatrixAt(i, M.compose(P.set(s.x, top, s.z), Q0, S.set((s.w + 0.003) / (BTN_W + 0.003), 1, (s.d + 0.003) / (BTN_D + 0.003))));
    const apply = () => {
      const t = (performance.now() - pressedAt) / 1000, dy = -0.0012 * (t < 0.05 ? t / 0.05 : t < 0.15 ? 1 : Math.max(0, 1 - (t - 0.15) / 0.1));
      body.setMatrixAt(i, M.compose(P.set(s.x, top + dy, s.z), Q0, S.set(s.w / BTN_W, 1, s.d / BTN_D)));
      body.instanceMatrix.needsUpdate = true;
      aEmit.setXYZ(i, led.r * level * 1.25, led.g * level * 1.25, led.b * level * 1.25); aEmit.needsUpdate = true;
      leak.setColorAt(i, tmp.copy(led).multiplyScalar(0.015 + level * 0.9)); leak.instanceColor.needsUpdate = true;
    };
    g.userData.set = v => { level = Math.max(0, Math.min(1.5, v)); apply(); };
    g.userData.setColor = c => { led.set(c); apply(); };
    g.userData.press = () => { pressedAt = performance.now(); };
    apply();
  });
  for (const im of [body, leak]) { im.computeBoundingSphere(); parent.add(im); }
  return { body, leak };
}

// ---------- record ----------
export class Record3D {
  constructor(rec) {
    this.rec = rec;
    this.group = new THREE.Group();
    this.disc = new THREE.Group(); this.group.add(this.disc);
    const D = this.dims = dimsOf(rec);   // #257 12" or 7"
    const geo = new THREE.CylinderGeometry(D.R, D.R, D.THICK, 128, 1, false);
    { // uv1: the label bump map (#94) spans only the label, so it is scaled up round the centre
      const uv = geo.attributes.uv, k = D.R / (D.LABEL * 1.12), a = new Float32Array(uv.count * 2);
      for (let i = 0; i < uv.count; i++) { a[i * 2] = (uv.getX(i) - 0.5) * k + 0.5; a[i * 2 + 1] = (uv.getY(i) - 0.5) * k + 0.5; }
      geo.setAttribute('uv1', new THREE.BufferAttribute(a, 2));
    }
    const aniso = grooveAnisoMap();
    // ~15% gloss (owner, #58); never add rings for gloss. #137: colour + roughness from the ring strip (recordMaterial)
    const mk = () => recordMaterial({ normalScale: new THREE.Vector2(1.0, 1.0), anisotropyMap: aniso });
    this.edgeMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.4 });
    this.matA = mk(); this.matB = mk();
    this.mesh = new THREE.Mesh(geo, [this.edgeMat, this.matA, this.matB]);
    this.mesh.castShadow = true;
    this.mesh.userData.record = this;
    this.disc.add(this.mesh);
    this.sideUp = rec.sides.A ? 'A' : 'B';
    this.flipT = 0; // animation 0..1
    this.labelImgs = {}; this.envs = {}; this.durations = {}; this.bump = {}; this.bumpOn = false; this.bumpGen = { A: 0, B: 0 }; this.labelCanvas = {};
    this.redraw('A'); this.redraw('B');
  }
  track(side) { return this.rec.sides[side]; }
  // Title/BPM overlay: default on for sides without cover art; L toggles per record (remembered).
  showText(side) {
    try { const v = localStorage.getItem('vire.labeltext.' + this.rec.id); if (v !== null) return v === '1'; } catch {}
    return !this.labelImgs[side];
  }
  toggleText() {
    const v = !this.showText(this.sideUp);
    try { localStorage.setItem('vire.labeltext.' + this.rec.id, v ? '1' : '0'); } catch {}
    this.redraw('A'); this.redraw('B');
  }
  redraw(side) {
    const t = this.rec.sides[side];
    const mat = side === 'A' ? this.matA : this.matB;
    const sd = drawRecordSide({
      env: this.envs[side], duration: this.durations[side] || (t && t.duration), cues: t && t.cues,
      labelImg: this.labelImgs[side], title: t ? t.title : '', artist: t ? t.artist : '', bpm: t ? t.bpm : 0,
      side, blank: !t || t.missing, split: t && t.split, showText: this.showText(side),
      low: this.low,   // #137: label canvas 128 instead of 512; the grooves are the same strip at every distance
      dims: this.dims,   // #257
    });
    setRecordSide(mat, sd);
    if (this.bump[side]) { this.bump[side].dispose(); this.bump[side] = null; }   // label changed: relief is rebuilt
    this.labelCanvas[side] = sd.labelCanvas; mat.normalMap = null;
    if (!this.low) this.buildBump(side);   // #149: built ahead, in a worker, so it's ready before you lean in
    mat.needsUpdate = true;
  }
  // Label relief (#94): only for records within arm's length and at full detail; beyond, the bump map is removed
  // from the material entirely (no cost at all). Maps are built on first need and kept while the label is unchanged.
  setBump(on) {
    on = on && !this.low; if (this.bumpOn === on) return; this.bumpOn = on;
    for (const side of ['A', 'B']) {
      const mat = side === 'A' ? this.matA : this.matB;
      if (on && !this.bump[side] && !this.bumpPending?.[side]) this.buildBump(side);   // #149: arrives a moment later
      mat.normalMap = on ? (this.bump[side] || null) : null; mat.needsUpdate = true;   // #100: normal map (strength baked in, K = 4)
    }
  }
  // #149: label relief built in a worker; a newer label (or dispose) cancels an older build
  buildBump(side) {
    const cv = this.labelCanvas[side]; if (!cv || cv.width < 256) return;
    const gen = ++this.bumpGen[side]; this.bumpPending = this.bumpPending || {}; this.bumpPending[side] = true;
    labelBumpMapAsync(cv, this.rec.id + side).then(t => {
      if (gen === this.bumpGen[side]) this.bumpPending[side] = false;
      if (this.disposed || gen !== this.bumpGen[side]) { t.dispose(); return; }
      if (this.bump[side]) this.bump[side].dispose();
      this.bump[side] = t;
      if (this.bumpOn) { const mat = side === 'A' ? this.matA : this.matB; mat.normalMap = t; mat.needsUpdate = true; }
    });
  }
  // Low detail for records lying around (CLAUDE.md #49; #137: only the label drops to 128 px, no label relief).
  setLOD(low) { if (!!this.low === low) return; this.low = low; if (low) this.setBump(false); this.redraw('A'); this.redraw('B'); }
  // Visual orientation: side A up = no flip; B up = disc rotated 180deg around X.
  updateFlip(dt) {
    const target = this.sideUp === 'A' ? 0 : 1;
    this.flipT += Math.sign(target - this.flipT) * Math.min(Math.abs(target - this.flipT), dt * 3.2);
    this.mesh.rotation.x = this.flipT * Math.PI;
    this.mesh.position.y = Math.sin(this.flipT * Math.PI) * 0.06;
  }
  dispose() {
    this.disposed = true;
    for (const m of [this.matA, this.matB]) { m.map && m.map.dispose(); const st = m.userData.rec && m.userData.rec.uStrip.value; if (st) st.dispose(); m.dispose(); }
    for (const s of ['A', 'B']) if (this.bump[s]) this.bump[s].dispose();
    this.mesh.geometry.dispose();
  }
}

// ---------- tonearm geometry ----------
export const ARM = { L: 0.232 }; // effective length (pivot to stylus)

export const PARTS = {
  tonearm(deck) {
    const g = new THREE.Group(); // at pivot, y = arm height
    const base = cyl(0.03, 0.033, 0.012, MAT.aluDark, 40); base.position.y = -0.03; g.add(base);
    const ring = cyl(0.024, 0.024, 0.008, MAT.chrome, 40); ring.position.y = -0.02; g.add(ring);
    const yaw = new THREE.Group(); g.add(yaw);           // rotates about Y
    const pitch = new THREE.Group(); yaw.add(pitch);      // lifts the arm
    const gimbal = cyl(0.012, 0.012, 0.022, MAT.black, 24); gimbal.position.y = -0.005; yaw.add(gimbal);
    const tube = cyl(0.0042, 0.0042, ARM.L - 0.03, MAT.chrome, 16); tube.rotation.x = Math.PI / 2; tube.position.z = (ARM.L - 0.03) / 2; pitch.add(tube);
    const rear = cyl(0.0042, 0.0042, 0.05, MAT.chrome, 16); rear.rotation.x = Math.PI / 2; rear.position.z = -0.025; pitch.add(rear);
    const cw = cyl(0.014, 0.014, 0.028, MAT.aluDark, 32); cw.rotation.x = Math.PI / 2; cw.position.z = -0.055; pitch.add(cw);
    const cwRing = cyl(0.0145, 0.0145, 0.004, MAT.black, 32); cwRing.rotation.x = Math.PI / 2; cwRing.position.z = -0.043; pitch.add(cwRing);
    // headshell + cartridge
    const head = new THREE.Group(); head.position.z = ARM.L - 0.028; head.rotation.y = -0.38; pitch.add(head);
    const shell = box(0.018, 0.003, 0.034, MAT.black); shell.position.z = 0.017; head.add(shell);
    const finger = box(0.003, 0.002, 0.018, MAT.chrome); finger.position.set(0.012, 0.002, 0.02); finger.rotation.y = 0.6; head.add(finger);
    const cart = box(0.012, 0.014, 0.02, new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.35, metalness: 0.4 }));
    cart.position.set(0, -0.009, 0.022); head.add(cart);
    const cartStripe = box(0.0122, 0.003, 0.0202, new THREE.MeshStandardMaterial({ color: 0xc0302a, roughness: 0.4 }));
    cartStripe.position.set(0, -0.0055, 0.022); head.add(cartStripe);
    // rest post and cue lever
    const rest = cyl(0.003, 0.003, 0.03, MAT.aluDark, 12); rest.position.set(0, -0.022, 0.17); g.add(rest);
    const restCup = box(0.012, 0.004, 0.008, MAT.black); restCup.position.set(0, -0.006, 0.17); g.add(restCup);
    const lever = box(0.006, 0.006, 0.02, MAT.aluDark); lever.position.set(0.038, -0.022, 0.03); g.add(lever);
    g.userData = { yaw, pitch };
    return g;
  },
};

// Solve arm yaw for stylus radius r. Pivot and spindle in deck-local XZ.
export function armYawForRadius(pivot, spindle, r) {
  const vx = pivot.x - spindle.x, vz = pivot.z - spindle.z;
  const D = Math.hypot(vx, vz);
  const k = (r * r - D * D - ARM.L * ARM.L) / (2 * ARM.L);
  const phi = Math.atan2(vx, vz);
  const c = Math.max(-1, Math.min(1, k / D));
  const a = Math.acos(c);
  const s1 = phi + a, s2 = phi - a;
  const norm = x => Math.atan2(Math.sin(x), Math.cos(x));
  // Arm swings from rest (pointing toward the DJ, yaw ~0) inward over the record: pick the smaller |yaw|.
  return Math.abs(norm(s1)) < Math.abs(norm(s2)) ? norm(s1) : norm(s2);
}

// ---------- turntable ----------
export const DECK = { W: 0.453, D: 0.353, H: 0.1, platterR: 0.166, spindle: new THREE.Vector3(-0.0485, 0, 0.0) };

export function makeDeck(name) {
  const g = new THREE.Group(); g.name = name;
  const u = {}; g.userData = u;
  const plinth = rounded(DECK.W, DECK.H - 0.012, DECK.D, 0.014, MAT.alu);
  plinth.position.y = 0.012; plinth.castShadow = plinth.receiveShadow = true; g.add(plinth);
  const bottom = rounded(DECK.W - 0.01, 0.012, DECK.D - 0.01, 0.012, MAT.black); g.add(bottom);
  for (const [x, z] of [[-0.19, -0.14], [0.19, -0.14], [-0.19, 0.14], [0.19, 0.14]]) {
    const f = cyl(0.03, 0.034, 0.02, MAT.black, 24); f.position.set(x, -0.008, z); g.add(f);
  }
  const top = DECK.H;
  u.top = top;

  // platter
  const sp = DECK.spindle;
  const platter = new THREE.Group(); platter.position.set(sp.x, top, sp.z); g.add(platter); u.platter = platter;
  const pBody = cyl(DECK.platterR, DECK.platterR, 0.018, MAT.alu, 96); pBody.position.y = 0.009; platter.add(pBody);
  const pTopRim = cyl(DECK.platterR - 0.0005, DECK.platterR - 0.0005, 0.001, MAT.aluDark, 96); pTopRim.position.y = 0.0185; platter.add(pTopRim);
  const mat = cyl(0.151, 0.151, 0.003, MAT.felt, 96); mat.position.y = 0.0205; platter.add(mat);
  const spindle = cyl(0.0035, 0.0035, 0.016, MAT.chrome, 16); spindle.position.y = 0.024; platter.add(spindle);
  u.platterSurface = top + 0.022; // record sits here
  pBody.userData.platterOf = name; mat.userData.platterOf = name;

  // strobe dot rows on the platter rim: 4 rows, each "stands still" at a different speed
  u.strobeRows = [];
  const dot = strobeDotTexture();
  [169, 174, 180, 186].forEach((N, i) => {
    const t = dot.clone(); t.needsUpdate = true; t.repeat.set(N, 1); t.wrapS = THREE.RepeatWrapping;
    const m = new THREE.MeshStandardMaterial({ map: t, metalness: 0.7, roughness: 0.3, emissive: 0xff3322, emissiveMap: t, emissiveIntensity: 0.35 });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(DECK.platterR + 0.0004, DECK.platterR + 0.0004, 0.0036, 128, 1, true), m);
    ring.position.set(sp.x, top + 0.0025 + i * 0.0038, sp.z);
    g.add(ring);
    u.strobeRows.push({ mesh: ring, ref: 180 / N, N, angle: 0 });
  });
  // strobe lamp (front-left) + red light
  const lampBase = cyl(0.009, 0.01, 0.014, MAT.aluDark, 24); lampBase.position.set(-0.207, top + 0.007, 0.128); g.add(lampBase);
  const lamp = makeLED(0xff3322, 0.005, 0.028); lamp.position.set(-0.207, top + 0.0145, 0.128); g.add(lamp); u.strobeLamp = lamp;
  const red = new THREE.PointLight(0xff2a1a, 0.0, 0.12, 2); red.position.set(-0.2, top + 0.012, 0.12); g.add(red); u.strobeLight = red;
  // target light (pop-up) front-left of platter
  const tl = makeLED(0xfff2d0, 0.004, 0.03); tl.position.set(-0.213, top + 0.012, -0.16); g.add(tl);

  // start/stop + speed buttons
  const start = makeButton(0.042, 0.03, 0x40ff80, 'START'); start.position.set(-0.178, top, 0.158); g.add(start);
  start.userData.mesh.userData.control = { deck: name, id: 'start' }; u.start = start;
  const b33 = makeButton(0.022, 0.012, 0xff9020, '33'); b33.position.set(-0.128, top, 0.162); g.add(b33);
  b33.userData.mesh.userData.control = { deck: name, id: 'rpm33' }; u.b33 = b33;
  const b45 = makeButton(0.022, 0.012, 0xff9020, '45'); b45.position.set(-0.1, top, 0.162); g.add(b45);
  b45.userData.mesh.userData.control = { deck: name, id: 'rpm45' }; u.b45 = b45;

  // pitch fader (along z): slot, cap, zero LED
  const slot = box(0.006, 0.002, 0.11, MAT.black); slot.position.set(0.195, top + 0.001, 0.085); g.add(slot);
  const pcap = makeFaderCap(0.02, 0.012, 0x40ff80); pcap.position.set(0.195, top, 0.085); g.add(pcap); u.pitchCap = pcap;
  pcap.traverse(o => { if (o.isMesh) o.userData.control = { deck: name, id: 'pitch' }; });
  u.pitchTravel = { z0: 0.035, z1: 0.135, x: 0.195 };
  const zled = makeLED(0x40ff60, 0.0025, 0.02); zled.position.set(0.18, top + 0.001, 0.085); g.add(zled); u.zeroLED = zled;
  for (let i = -8; i <= 8; i++) { // scale ticks
    const t = box(i % 4 ? 0.004 : 0.007, 0.0005, 0.0006, MAT.white); t.position.set(0.212, top + 0.0005, 0.085 + i * 0.00625); g.add(t);
  }

  // tonearm
  const pivot = new THREE.Vector3(0.14, 0, -0.11);
  const arm = PARTS.tonearm(); arm.position.set(pivot.x, top + 0.040, pivot.z); g.add(arm);
  u.arm = arm; u.pivot = pivot;
  arm.traverse(o => { if (o.isMesh) o.userData.control = { deck: name, id: 'arm' }; });
  u.armState = { yaw: 0.02, lift: 1, targetYaw: 0.02, targetLift: 1 };

  // power knob
  const pw = cyl(0.012, 0.013, 0.01, MAT.aluDark, 24); pw.position.set(-0.207, top + 0.005, 0.085); g.add(pw);

  return g;
}

// ---------- mixer ----------
export const MIX = { W: 0.26, D: 0.353, H: 0.1 };
export function makeMixer() {
  const g = new THREE.Group(); const u = {}; g.userData = u;
  const body = rounded(MIX.W, MIX.H - 0.01, MIX.D, 0.01, MAT.black); body.position.y = 0.01; body.castShadow = true; g.add(body);
  const FW = MIX.W - 0.012, FD = MIX.D - 0.012;
  const layout = { W: FW, D: FD, ticks: [], slots: [], texts: [], faderScales: [] };
  const face = box(FW, 0.002, FD, MAT.mixerPanel); face.position.y = MIX.H + 0.004; g.add(face);
  const top = MIX.H + 0.005; u.top = top;
  u.controls = {};
  // Knobs (#84): each knob is an empty proxy that updateMixVisual turns; all 15 are drawn by three instanced
  // meshes built at the end (u.syncKnob copies a proxy's pose into its instance).
  const knobs = [];
  const addKnob = (id, x, z, color = 0xdddddd, r = 0.0105) => {
    const k = new THREE.Group(); k.position.set(x, top, z); g.add(k);
    k.userData.control = { mixer: true, id }; k.userData.knob = { r, color };
    layout.ticks.push({ x, z, r }); // tick ring is printed on the face
    u.controls[id] = k; knobs.push(k); return k;
  };
  const label = (text, x, z, size, bold, color, align) => layout.texts.push({ text, x, z, size, bold, color, align });
  // buttons (#134): each is a proxy group at its place carrying the control tag and set/setColor/press; with the
  // Blender parts loaded all of them are drawn by mixButtons() at the end, else each holds a makeRubberButton
  const btns = [];
  const addButton = (id, w, d, color, text, x, z) => {
    const b = new THREE.Group(); b.position.set(x, top, z); g.add(b);
    b.userData.control = { mixer: true, id }; u.controls[id] = b;
    if (MIXP) { btns.push({ id, w, d, color, text, x, z, g: b }); return b; }
    const rb = makeRubberButton(w, d, color, text); b.add(rb);
    rb.userData.mesh.userData.control = { mixer: true, id };
    for (const k of ['set', 'setColor', 'press', 'mesh', 'faceMat']) b.userData[k] = rb.userData[k];
    return b;
  };
  const cols = { A: -0.075, B: 0.075 };
  for (const [ch, x] of Object.entries(cols)) {
    addKnob(ch + '.trim', x, -0.142, 0xffffff, 0.009);
    addKnob(ch + '.hi', x, -0.108, 0xffffff);
    addKnob(ch + '.mid', x, -0.074, 0xffffff);
    addKnob(ch + '.low', x, -0.040, 0xffffff);
    addKnob(ch + '.filter', x, -0.004, 0x5cc8ff, 0.0115);
    addKnob(ch + '.pan', x, 0.030, 0xffb040, 0.009);
    addButton(ch + '.cue', 0.022, 0.012, 0xffc030, 'CUE', x, 0.056);
    // tap-to-set beat 1 (owner, #110): press on a kick; beside CUE, towards the mixer's outer edge
    addButton(ch + '.beat1', 0.02, 0.012, 0x40ff70, 'BEAT 1', x + (x < 0 ? -0.033 : 0.033), 0.030);   // #253 (owner): in line with PAN (was beside CUE)
    layout.slots.push({ x, z: 0.104, w: 0.0035, d: 0.066 });
    layout.faderScales.push({ x: x + (x < 0 ? 0.013 : -0.013), z0: 0.076, z1: 0.132 });
    const slot = box(0.0033, 0.004, 0.064, MAT.black); slot.position.set(x, top - 0.0021, 0.104); g.add(slot);
    // #191 (owner): legends right beside their knob (just outside its dotted scale, toward the centre), so LOW can't be
    // read as belonging to the mic PITCH knob; was centred 36 mm from the knob
    const lx = x < 0 ? x + 0.0195 : x - 0.0195, al = x < 0 ? 'left' : 'right';
    for (const [t, z] of [['TRIM', -0.142], ['HI', -0.108], ['MID', -0.074], ['LOW', -0.040], ['FILTER', -0.004], ['PAN', 0.030]]) label(t, lx, z, undefined, false, undefined, al);
    label(ch, x, -0.163, 0.006, true);
    const cap = (MIXP ? mixFaderCap : makeFaderCap)(0.0196, 0.011); cap.position.set(x, top, 0.104); g.add(cap);   // wide to the printed scale (owner, 26 Sep): top plate 20 mm, 0.8 mm short of the long ticks
    cap.traverse(o => { if (o.isMesh) o.userData.control = { mixer: true, id: ch + '.fader' }; });
    u.controls[ch + '.fader'] = cap;
  }
  u.faderTravel = { z0: 0.076, z1: 0.132 }; // top (back) = 1, front = 0
  // centre column
  addKnob('master', 0, -0.142, 0xffffff, 0.009);
  // centre column from the top (owner, #89): MIC, LOCK (the sync button, renamed, same size as SPLIT), SPLIT
  addButton('sync', 0.024, 0.011, 0x39a8ff, 'LOCK', 0, -0.083);
  addButton('splitcue', 0.024, 0.011, 0xb070ff, 'SPLIT', 0, -0.061);
  // microphone (CLAUDE.md #60): MIC on/off, gain and voice pitch
  addButton('mic', 0.024, 0.011, 0xff2a20, 'MIC', 0, -0.108);
  addKnob('mic.gain', -0.019, -0.038, 0xffffff, 0.0075);
  addKnob('mic.pitch', 0.019, -0.038, 0xff6a5a, 0.0075);
  label('LEVEL · DUCK', -0.019, -0.0235, 0.0022); label('PITCH', 0.019, -0.0235, 0.0024);
  // meters: 10 LEDs per channel
  // All 20 drawn as instances (#84; #139 glow cards removed): 1 draw call instead of 40. Each entry keeps the
  // old interface: meters[c][i].userData.set(v).
  u.meters = [[], []];
  {
    // #139: no glow cards. The caps are not tone-mapped (full saturated LED colour) and carry a hot-spot map
    // (bright centre, dimmer rim) so each reads as a lit lens; unlit caps keep a dark tint of their colour.
    const hs = document.createElement('canvas'); hs.width = hs.height = 64;
    { const h = hs.getContext('2d'), gr = h.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, '#fff'); gr.addColorStop(0.4, '#d9d9d9'); gr.addColorStop(1, '#5e5e5e'); h.fillStyle = gr; h.fillRect(0, 0, 64, 64); }
    const hsT = new THREE.CanvasTexture(hs); hsT.colorSpace = THREE.NoColorSpace;   // read as a plain 0..1 intensity
    const capMat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: hsT, toneMapped: false });
    // #140 (owner: centre spot +50 %): the hot spot scales the LED colour by 1.5 at the centre (rim unchanged) and,
    // when lit, adds a small white-hot core, like the die of a real LED seen through its lens
    capMat.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', 'float vireHs = texture2D(map, vMapUv).r;')
        .replace('#include <color_fragment>', `#include <color_fragment>
float vireLit = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
diffuseColor.rgb = diffuseColor.rgb * vireHs * 1.5 + vec3(0.45) * smoothstep(0.75, 1.0, vireHs) * smoothstep(0.3, 1.0, vireLit);`);
    };
    capMat.customProgramCacheKey = () => 'vire-meter-led';
    const n = 20, caps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.002, 10), capMat, n);
    caps.raycast = () => {};
    const M4 = new THREE.Matrix4(), dark = new THREE.Color(0x0a0a0a), tmp = new THREE.Color();
    let idx = 0;
    for (let c = 0; c < 2; c++) for (let i = 0; i < 10; i++, idx++) {
      const col = new THREE.Color(i >= 9 ? 0xff3030 : i >= 7 ? 0xffb020 : 0x30ff60), k = idx;
      const x = c ? 0.012 : -0.012, z = 0.098 - i * 0.0106;
      caps.setMatrixAt(k, M4.makeTranslation(x, top + 0.001, z));
      const set = v => { caps.setColorAt(k, tmp.copy(col).multiplyScalar(0.05 + Math.min(1, v) * 1.0).add(dark)); caps.instanceColor.needsUpdate = true; };
      set(0); u.meters[c].push({ userData: { set } });
    }
    caps.computeBoundingSphere(); g.add(caps);
  }
  // crossfader
  layout.slots.push({ x: 0, z: 0.155, w: 0.072, d: 0.0035 });
  const xslot = box(0.07, 0.004, 0.0033, MAT.black); xslot.position.set(0, top - 0.0021, 0.155); g.add(xslot);
  label('A', -0.046, 0.155, 0.0045, true); label('B', 0.046, 0.155, 0.0045, true);
  label('MASTER', 0, -0.126, 0.003);
  label('LEVEL', 0, 0.113, 0.0028);
  const xcap = (MIXP ? mixFaderCap : makeFaderCap)(0.011, 0.018, 0xff5050); xcap.position.set(0, top, 0.155); xcap.scale.y = 1.02; g.add(xcap);   // 2% taller (owner, 26 Sep)
  xcap.traverse(o => { if (o.isMesh) o.userData.control = { mixer: true, id: 'xfader' }; });
  u.controls.xfader = xcap; u.xTravel = { x0: -0.03, x1: 0.03 };

  // brushed aluminium face with printed legends and cut fader slots
  const tex = mixerFaceTextures(layout);
  face.material = new THREE.MeshPhysicalMaterial({ color: 0xf6f8fc, map: tex.map, bumpMap: tex.bumpMap, bumpScale: 2.2, metalness: 0.85, roughness: 0.38, anisotropy: 0.7, clearcoat: 0.05 });
  face.material.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', 'diffuseColor.rgb *= texture2D(map, vMapUv).r;'); };   // #134: R8 greyscale map
  face.material.customProgramCacheKey = () => 'vire-mixface';

  // screen on a stand behind the mixer, tilted toward the DJ
  // tilted back 25 deg (owner, #115: 35 was too far; #89 had raised it from 20)
  const TILT = -25 * Math.PI / 180;
  // #189 (owner): the display is a tablet. Grip (or pinch) its frame to pick it up and hold it like an iPad; let go
  // and it stays in the air where it is, or snaps back into a very shallow slot along the mixer's back edge when let
  // go within 8 cm of it. Docked, it sits exactly where the #115 stand was. Same size as before (owner: not wider).
  const tab = new THREE.Group(); tab.name = 'tablet';
  tab.position.set(0, top + 0.03, -0.185); tab.rotation.x = TILT; g.add(tab);
  // the tablet's body; #196 iPad-thin (was 20 mm), black brushed metal. #201 (owner: the screen stood proud of the frame):
  // a 1 mm deep recess for the screen, inside a bezel (5 mm at the sides, 2.5 mm top and bottom); one merged mesh
  const REC_D = 0.001, bez = [];
  const part = (w, h, d, x, y, z) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); bez.push(b); };
  part(0.2, 0.08, TABLET_T - REC_D, 0, 0, -REC_D / 2);                       // back slab, up to the recess floor
  const fz = TABLET_T / 2 - REC_D / 2;
  part(0.2, 0.0025, REC_D, 0, 0.03875, fz); part(0.2, 0.0025, REC_D, 0, -0.03875, fz);   // bezel top / bottom
  part(0.005, 0.075, REC_D, 0.0975, 0, fz); part(0.005, 0.075, REC_D, -0.0975, 0, fz);   // bezel sides
  const stand = new THREE.Mesh(mergeGeometries(bez), tabletBodyMat()); bez.forEach(b => b.dispose()); tab.add(stand);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.075), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  scr.position.set(0, 0, TABLET_T / 2 - REC_D + 0.0001);   // #201 on the recess floor, 1 mm below the bezel
  tab.add(scr); u.screen = scr; scr.userData.mixScreen = true;   // BPM / ORIG / KEY readout taps (#116)
  u.tablet = tab; u.tabletDock = { p: tab.position.clone(), q: tab.quaternion.clone() };
  const slot = box(0.206, 0.0012, 0.016, new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.95, metalness: 0 }));   // the slot (1.2 mm)
  slot.position.set(0, top + 0.0006, -0.168); slot.raycast = () => {}; g.add(slot);
  // #115: the fake refraction / bevel-edge shader from #89 is removed (read as an artifact at the border)
  // glass plate over the readout (owner, 26 Sep): 2 mm in front of the screen, a touch larger. Black base with
  // additive blending, so it only ADDS its reflection (Fresnel: faint face-on, stronger at grazing angles) and
  // never dims the readout; no transmission pass (too costly on Quest). Not pickable.
  // #201: the glass fills the recess exactly (0.19 x 0.075) and sits 0.3 mm below the bezel, so nothing sticks out
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.075), new THREE.MeshPhysicalMaterial({
    // #115: glossier and fainter. roughness 0 = sharp mirror-like reflections and a tight highlight instead of a
    // broad milky veil; specularIntensity 0.4 -> 0.2 and specularF90 0.45 keep the reflection from washing the
    // readout out, even at grazing angles. envMapIntensity does nothing here (scene.environmentIntensity rules).
    color: 0x000000, metalness: 0, roughness: 0, specularIntensity: 0.2, specularF90: 0.45,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  glass.position.z = REC_D - 0.0003 - 0.0001; glass.renderOrder = 2; glass.raycast = () => {}; scr.add(glass); u.screenGlass = glass;
  // knobs, drawn as instances: skirt, body (side + top), pointer = 4 draw calls for all 15 (was 75)
  {
    const m = knobMats(), R0 = 0.0105, n = knobs.length;
    const skirtG = new THREE.CylinderGeometry(R0 * 1.14, R0 * 1.18, 0.0025, 40); skirtG.translate(0, 0.00125, 0);
    const bodyG = new THREE.CylinderGeometry(R0 * 0.93, R0, 0.0145, 48, 1); bodyG.translate(0, 0.0025 + 0.00725, 0);
    bodyG.groups = bodyG.groups.filter(gr => gr.materialIndex !== 2);   // bottom cap sits on the skirt and is never seen
    const ptrG = new THREE.BoxGeometry(0.0013, 0.0004, R0 * 0.86); ptrG.translate(0, 0.0172, -R0 * 0.47);
    const ids = knobs.map(k => k.userData.control.id), col = new THREE.Color();
    let meshes;
    if (MIXP) {   // #134: one batch, Blender knob (knurl in its normal map, pointer colour per instance)
      meshes = [new THREE.InstancedMesh(MIXP.knob, MIXP.kmat, n)];
      knobs.forEach((k, i) => meshes[0].setColorAt(i, col.set(k.userData.knob.color)));
    } else {
      meshes = [new THREE.InstancedMesh(skirtG, m.skirt, n), new THREE.InstancedMesh(bodyG, [m.side, m.top], n), new THREE.InstancedMesh(ptrG, new THREE.MeshBasicMaterial({ color: 0xffffff }), n)];
      knobs.forEach((k, i) => meshes[2].setColorAt(i, col.set(k.userData.knob.color).multiplyScalar(0.85)));
    }
    for (const im of meshes) { im.userData.knobIds = ids; im.castShadow = true; g.add(im); }
    const S3 = new THREE.Vector3(), Mx = new THREE.Matrix4();
    u.syncKnob = k => {
      const i = knobs.indexOf(k); if (i < 0) return;
      const s = k.userData.knob.r / R0; S3.set(s, 1, s); Mx.compose(k.position, k.quaternion, S3);
      for (const im of meshes) { im.setMatrixAt(i, Mx); im.instanceMatrix.needsUpdate = true; }
    };
    knobs.forEach(k => u.syncKnob(k)); meshes.forEach(im => im.computeBoundingSphere());
    u.knobMeshes = meshes;
  }
  if (MIXP) u.buttonMeshes = mixButtons(g, btns, top);
  // static body parts (body, fader slots, screen stand): one mesh (#84)
  const ctl = new Set(Object.values(u.controls));
  mergeStatic(g, a => ctl.has(a) || a === scr || a === u.tablet || !!a.userData.control);   // #195: the tablet's body stays its own mesh (it was merged into the mixer, so a picked-up tablet was a bare one-sided screen)
  return g;
}

// #196 mixer tablet: iPad-thin body in black brushed metal (the mixer face's look, darker). One material, so still one
// draw call. The brushing is a small streak texture in the roughness channel plus anisotropy (highlight stretched
// along the brushing).
export const TABLET_T = 0.007;
let TABLET_MAT = null;
export function tabletBodyMat() {
  if (TABLET_MAT) return TABLET_MAT;
  const c = document.createElement('canvas'); c.width = 16; c.height = 256; const g = c.getContext('2d');
  let s = 991; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let y = 0; y < 256; y++) { const v = Math.round(150 + r() * 70 + (r() < 0.08 ? 35 : 0)); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, 16, 1); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 3);
  TABLET_MAT = new THREE.MeshPhysicalMaterial({ color: 0x16171a, metalness: 0.85, roughness: 0.55, roughnessMap: t, anisotropy: 0.7 });
  TABLET_MAT.name = 'tablet_brushed_black';
  return TABLET_MAT;
}

// ---------- milk crate (CLAUDE.md #61): green HDPE crate for records you want to keep handy mid-set.
// Open lattice sides, hand holes in two sides, grid floor. Records dropped in stand leaning on each other.
export const MILK = { W: 0.36, D: 0.47, H: 0.306, wall: 0.008 };   // #192: the photo's proportions (was a 0.345 cube, 0.28 tall); #193 owner: 10 % shorter, 12 % longer
export const MILK_CREDIT = '"Plastic Crate 02" by Console Art Cybernetic (sketchfab.com/cacybernetic), Sketchfab Standard licence, recoloured';
// The owner's crate model: 505 x 405 x 254 mm, open top, origin bottom centre. Recoloured black
// (colour texture dropped; its normal, roughness and occlusion maps kept for the moulded detail).
export async function loadMilkCrate(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const g = new THREE.Group(); g.name = 'milkCrate'; g.add(gltf.scene);
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material.clone(); m.map = null; m.color = new THREE.Color(0x151517); m.metalness = 0; m.metalnessMap = null;
    m.roughness = 1; m.aoMapIntensity = 1; m.needsUpdate = true; o.material = m;
    o.castShadow = true; o.receiveShadow = true;
  });
  const box = new THREE.Box3().setFromObject(gltf.scene);
  gltf.scene.position.y -= box.min.y;
  Object.assign(MILK, { W: box.max.x - box.min.x, D: box.max.z - box.min.z, H: box.max.y - box.min.y });
  g.userData.inner = { x: 0.239, z: 0.189, floor: 0.008, rim: MILK.H };   // measured from the model's walls
  g.userData.records = [];
  return g;
}
// #192 (owner: the crate looked fake; photo of a real produce crate; "fake the geometry, don't add triangles").
// Proportions from the photo: taller and deeper than wide. Colour: deep blue (owner). The slots, holes and hand holes are painted into ONE
// 1024 x 1024 texture sheet (cut out with alpha, smooth edges by alpha-to-coverage on MSAA), each wall is an outer
// and an inner panel 6 mm apart (so the holes show real depth when you move), and only the rim, corner posts and
// base skirt are real boxes. About 170 triangles and one draw call per crate (the Blender GLB was 868).
// Sheet quadrants: top-left = long walls (columns of short oval slots, a centre rib, as the photo's back wall),
// top-right = short walls (grid of small square holes + hand hole), bottom-left = floor (grid of holes),
// bottom-right = solid (the boxes). A normal map made from a blurred copy of the cutout rounds every slot edge;
// the colour map darkens slightly toward each hole (moulded lip) and adds a faint moulding grain.
let MILK_ATLAS = null;
function milkAtlas() {
  if (MILK_ATLAS) return MILK_ATLAS;
  const N = 1024, Q = N / 2;
  const m = document.createElement('canvas'); m.width = m.height = N;   // mask: white = plastic, black = hole
  const g = m.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, N, N);
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };
  g.fillStyle = '#000';
  // long wall (0.42 x 0.34 m on a 512 x 512 quadrant): 2 blocks of columns either side of a centre rib
  {
    const x0 = 0, y0 = 0, sx = Q / MILK.D, sy = Q / MILK.H;          // px per metre
    const top = 0.05, bot = 0.035, side = 0.03, rib = 0.028;
    const sw = 0.009, sh = 0.03, px = 0.0155, py = 0.038;             // slot size and pitch
    const half = (MILK.D - 2 * side - rib) / 2, cols = Math.floor((half + px - sw) / px), rows = Math.floor((MILK.H - top - bot + py - sh) / py);
    for (const bx of [side, side + half + rib]) {
      const ox = bx + (half - ((cols - 1) * px + sw)) / 2, oy = top + (MILK.H - top - bot - ((rows - 1) * py + sh)) / 2;
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) rr(x0 + (ox + c * px) * sx, y0 + (oy + r * py) * sy, sw * sx, sh * sy, sw * sx / 2);
    }
  }
  // short wall (0.36 x 0.34 m): hand hole under the rim, then a grid of small square holes
  {
    const x0 = Q, y0 = 0, sx = Q / MILK.W, sy = Q / MILK.H;
    rr(x0 + (MILK.W / 2 - 0.06) * sx, y0 + 0.03 * sy, 0.12 * sx, 0.034 * sy, 0.017 * sy);
    const top = 0.085, bot = 0.035, side = 0.03, s = 0.009, p = 0.0145;
    const cols = Math.floor((MILK.W - 2 * side + p - s) / p), rows = Math.floor((MILK.H - top - bot + p - s) / p);
    const ox = (MILK.W - ((cols - 1) * p + s)) / 2, oy = top + (MILK.H - top - bot - ((rows - 1) * p + s)) / 2;
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) rr(x0 + (ox + c * p) * sx, y0 + (oy + r * p) * sy, s * sx, s * sy, 2);
  }
  // floor (0.36 x 0.42 m): grid of short slots with a solid cross
  {
    const x0 = 0, y0 = Q, sx = Q / MILK.W, sy = Q / MILK.D;
    const edge = 0.025, cross = 0.022, sw = 0.009, sh = 0.016, px = 0.0145, py = 0.022;
    for (const [ax, aw] of [[edge, MILK.W / 2 - edge - cross / 2], [MILK.W / 2 + cross / 2, MILK.W / 2 - edge - cross / 2]])
      for (const [az, ad] of [[edge, MILK.D / 2 - edge - cross / 2], [MILK.D / 2 + cross / 2, MILK.D / 2 - edge - cross / 2]]) {
        const cols = Math.floor((aw + px - sw) / px), rows = Math.floor((ad + py - sh) / py);
        const ox = ax + (aw - ((cols - 1) * px + sw)) / 2, oz = az + (ad - ((rows - 1) * py + sh)) / 2;
        for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) rr(x0 + (ox + c * px) * sx, y0 + (oz + r * py) * sy, sw * sx, sh * sy, 2);
      }
  }
  // (bottom-right quadrant stays solid white)
  const mask = g.getImageData(0, 0, N, N).data;
  // #193 (owner: too pristine) wear and tear, all in the textures. Seeded, so every load looks the same. Layers drawn with
  // the 2D canvas: W = stress whitening (knocked edges, rim, round the hand holes), G = grime (bottom of the walls, the
  // floor), S = scratches, E = dents (height: dark = pressed in). Walls: canvas row 0 = top of the wall (the rim).
  let seed = 1937; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const layer = () => { const c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'); return [c, x]; };
  const [wc, wx] = layer(), [gc, gx] = layer(), [sc, sx2] = layer(), [ec, ex] = layer();
  ex.fillStyle = 'rgb(128,128,128)'; ex.fillRect(0, 0, N, N);
  const blob = (ctx, x, y, r, a, rgb = '255,255,255', sy = 1) => {
    ctx.save(); ctx.translate(x, y); ctx.scale(1, sy);
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  };
  for (const [qx, qy, isWall] of [[0, 0, true], [Q, 0, true], [0, Q, false], [Q, Q, false]]) {
    const R = (a, b) => a + rnd() * (b - a);
    if (isWall) {
      for (let i = 0; i < 22; i++) blob(wx, qx + R(0, Q), qy + R(0, 26), R(8, 30), R(0.25, 0.6), '255,255,255', R(0.3, 0.7));     // knocked rim edge
      for (let i = 0; i < 7; i++) blob(wx, qx + R(10, Q - 10), qy + R(30, Q - 30), R(10, 28), R(0.12, 0.3));                           // random knocks
      const gr = gx.createLinearGradient(0, qy + Q * 0.55, 0, qy + Q); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.75)');
      gx.fillStyle = gr; gx.fillRect(qx, qy, Q, Q);                                                                                   // dirt toward the bottom
      for (let i = 0; i < 9; i++) { const x = qx + R(20, Q - 20), y = qy + R(60, Q - 30), r = R(9, 26);                                // dents: pressed in, whitened rim
        blob(ex, x, y, r, R(0.5, 0.9), '0,0,0', R(0.6, 1)); blob(wx, x, y, r * 1.25, 0.18); }
    } else {
      for (let i = 0; i < 40; i++) blob(gx, qx + R(0, Q), qy + R(0, Q), R(15, 60), R(0.15, 0.45), '0,0,0');                           // floor / box grime
      const solid = qx === Q;   // #194: heavy scuffing on the rim / post / skirt patches only; the floor just a few light ones
      for (let i = 0; i < (solid ? 26 : 8); i++) blob(wx, qx + R(0, Q), qy + R(0, Q), R(6, 24), solid ? R(0.2, 0.5) : R(0.08, 0.2), '255,255,255', R(0.3, 1));
      for (let i = 0; i < 12; i++) blob(ex, qx + R(10, Q - 10), qy + R(10, Q - 10), R(6, 18), R(0.4, 0.8), '0,0,0');
    }
    for (let i = 0; i < 55; i++) {                                                                                                     // scratches
      const x = qx + R(0, Q), y = qy + R(0, Q), a = R(0, Math.PI), l = R(8, 70);
      sx2.strokeStyle = `rgba(255,255,255,${R(0.15, 0.55)})`; sx2.lineWidth = R(0.5, 1.3);
      sx2.beginPath(); sx2.moveTo(x, y); sx2.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + R(-4, 4), y + Math.sin(a) * l * 0.5 + R(-4, 4), x + Math.cos(a) * l, y + Math.sin(a) * l); sx2.stroke();
    }
  }
  // whitening round the hand holes (short-wall quadrant)
  { const sxm = Q / MILK.W, sym = Q / MILK.H; for (let i = 0; i < 10; i++) blob(wx, Q + (MILK.W / 2 + (rnd() - 0.5) * 0.14) * sxm, (0.047 + (rnd() - 0.5) * 0.04) * sym, 10 + rnd() * 14, 0.35); }
  // #194: soft random mottling (no repeat) instead of the #192 sine 'grain', which read as a cross-hatch up close
  const [mc2, mx2] = layer(); { const t = document.createElement('canvas'); t.width = t.height = 48; const tx = t.getContext('2d'), id = tx.createImageData(48, 48);
    for (let i = 0; i < id.data.length; i += 4) { const v = Math.round(rnd() * 255); id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    tx.putImageData(id, 0, 0); mx2.imageSmoothingEnabled = true; mx2.imageSmoothingQuality = 'high'; mx2.filter = 'blur(6px)'; mx2.drawImage(t, -16, -16, N + 32, N + 32); }
  const M8 = mx2.getImageData(0, 0, N, N).data;
  const W8 = wx.getImageData(0, 0, N, N).data, G8 = gx.getImageData(0, 0, N, N).data, S8 = sx2.getImageData(0, 0, N, N).data;
  ex.filter = 'blur(2px)'; ex.drawImage(ec, 0, 0); const E8 = ex.getImageData(0, 0, N, N).data;
  // height = blurred mask (rounded slot edges) + dents; colour = the crate's blue, darker toward holes, whitened, dirtied,
  // scratched; roughness = rougher where scuffed / dirty. Alpha = the cutout.
  const b = document.createElement('canvas'); b.width = b.height = N; const bg = b.getContext('2d');
  bg.filter = 'blur(3px)'; bg.drawImage(m, 0, 0); const hgt = bg.getImageData(0, 0, N, N).data;
  const H = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) H[i] = hgt[i * 4] / 255 + (E8[i * 4] - 128) / 128 * 0.6;
  const base = [13, 44, 120], white = [150, 160, 185], dirt = [20, 22, 26];   // owner: deep blue; stress-whitened plastic; grime
  const col = new ImageData(N, N), nor = new ImageData(N, N), rou = new ImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const j = y * N + x, i = j * 4, h = hgt[i] / 255;
    const grain = 0.965 + 0.07 * (M8[i] / 255 - 0.5);
    const lip = 0.62 + 0.38 * Math.min(1, h * 1.25);
    const w = Math.min(1, W8[i + 3] / 255 * 0.8 + S8[i + 3] / 255 * 0.4), gd = G8[i + 3] / 255 * 0.7;
    for (let c = 0; c < 3; c++) { let v = base[c] * lip * grain; v += (white[c] - v) * w; v += (dirt[c] - v) * gd; col.data[i + c] = Math.max(0, Math.min(255, Math.round(v))); }
    col.data[i + 3] = mask[i] > 127 ? 255 : 0;
    const r = 0.5 + 0.25 * gd + 0.2 * (S8[i + 3] / 255) + 0.1 * (W8[i + 3] / 255);
    rou.data[i] = rou.data[i + 1] = rou.data[i + 2] = Math.round(Math.min(1, r) * 255); rou.data[i + 3] = 255;
    const hx = H[y * N + Math.min(N - 1, x + 1)] - H[y * N + Math.max(0, x - 1)];
    const hy = H[Math.min(N - 1, y + 1) * N + x] - H[Math.max(0, y - 1) * N + x];
    const k = 2.5, nx = -hx * k, ny = hy * k, l = Math.hypot(nx, ny, 1);
    nor.data[i] = Math.round((nx / l * 0.5 + 0.5) * 255); nor.data[i + 1] = Math.round((ny / l * 0.5 + 0.5) * 255); nor.data[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); nor.data[i + 3] = 255;
  }
  const cc = document.createElement('canvas'); cc.width = cc.height = N; cc.getContext('2d').putImageData(col, 0, 0);
  const nc = document.createElement('canvas'); nc.width = nc.height = N; nc.getContext('2d').putImageData(nor, 0, 0);
  const rc = document.createElement('canvas'); rc.width = rc.height = N; rc.getContext('2d').putImageData(rou, 0, 0);
  const map = new THREE.CanvasTexture(cc); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const normalMap = new THREE.CanvasTexture(nc); normalMap.anisotropy = 4;
  const roughnessMap = new THREE.CanvasTexture(rc);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map, normalMap, roughnessMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1, metalness: 0,   // #193: the colour lives in the map (so wear can whiten it)
    alphaTest: 0.5, alphaToCoverage: true, side: THREE.FrontSide });
  mat.name = 'milk_crate_cutout';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });   // shadows through the holes
  MILK_ATLAS = { map, normalMap, mat, depth, geo: null };
  return MILK_ATLAS;
}
function milkGeometry() {
  const A = milkAtlas(); if (A.geo) return A.geo;
  const { W, D, H } = MILK, T = 0.006, F = 0.008;       // panel gap (wall thickness), floor thickness
  const pos = [], nrm = [], uv = [];
  // quad from 4 corners (counter-clockwise seen from the side it faces) with uv from a quadrant
  const quad = (p, u, n) => { for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...p[k]); uv.push(...u[k]); nrm.push(...n); } };
  const R = (q, u, v) => [(q[0] + u) * 0.5, 1 - (q[1] + 1 - v) * 0.5];   // quadrant (col,row) + local u,v (v up) -> atlas uv
  const QL = [0, 0], QS = [1, 0], QF = [0, 1];
  // long walls (x = +-W/2), running along z; u along z, v up
  for (const s of [-1, 1]) for (const inner of [false, true]) {
    const x = s * (W / 2 - (inner ? T : 0)), out = inner ? -s : s;
    const z0 = -D / 2, z1 = D / 2, pts = [[x, 0, z0], [x, 0, z1], [x, H, z1], [x, H, z0]], us = [R(QL, 0, 0), R(QL, 1, 0), R(QL, 1, 1), R(QL, 0, 1)];
    const cw = out > 0 ? [pts[1], pts[0], pts[3], pts[2]] : pts, cu = out > 0 ? [us[1], us[0], us[3], us[2]] : us;
    quad(cw, cu, [out, 0, 0]);
  }
  // short walls (z = +-D/2), running along x
  for (const s of [-1, 1]) for (const inner of [false, true]) {
    const z = s * (D / 2 - (inner ? T : 0)), out = inner ? -s : s;
    const pts = [[-W / 2, 0, z], [W / 2, 0, z], [W / 2, H, z], [-W / 2, H, z]], us = [R(QS, 0, 0), R(QS, 1, 0), R(QS, 1, 1), R(QS, 0, 1)];
    const cw = out > 0 ? pts : [pts[1], pts[0], pts[3], pts[2]], cu = out > 0 ? us : [us[1], us[0], us[3], us[2]];
    quad(cw, cu, [0, 0, out]);
  }
  // floor: top face (up) and underside (down)
  for (const [y, up] of [[F, 1], [0.0005, -1]]) {
    const pts = [[-W / 2, y, D / 2], [W / 2, y, D / 2], [W / 2, y, -D / 2], [-W / 2, y, -D / 2]], us = [R(QF, 0, 0), R(QF, 1, 0), R(QF, 1, 1), R(QF, 0, 1)];
    quad(up > 0 ? pts : [pts[1], pts[0], pts[3], pts[2]], up > 0 ? us : [us[1], us[0], us[3], us[2]], [0, up, 0]);
  }
  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); walls.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); walls.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // real boxes: top rim (a lip wider than the wall), corner posts, base skirt; uv on the solid quadrant
  const parts = [walls];
  let bs = 71; const br = () => { bs = (bs * 1664525 + 1013904223) >>> 0; return bs / 4294967296; };
  // #193: each box face gets its own worn patch of the solid quadrant (atlas u 0.5-1, v 0-0.5), sized like the walls' texels
  const bx = (w, h, d, x, y, z) => {
    const b = new THREE.BoxGeometry(w, h, d).toNonIndexed(); b.translate(x, y, z); const u = b.getAttribute('uv');
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];   // BoxGeometry face order: +x -x +y -y +z -z
    for (let f = 0; f < 6; f++) {
      const su = Math.min(0.48, dims[f][0] / 0.84), sv = Math.min(0.48, dims[f][1] / 0.84), ou = 0.51 + br() * (0.48 - su), ov = 0.01 + br() * (0.48 - sv);
      for (let k = 0; k < 6; k++) { const i = f * 6 + k; u.setXY(i, ou + u.getX(i) * su, ov + u.getY(i) * sv); }
    }
    parts.push(b);
  };
  const L = 0.02, LT = 0.014;
  bx(W + 0.006, L, LT, 0, H - L / 2, -D / 2 + LT / 2 - 0.003); bx(W + 0.006, L, LT, 0, H - L / 2, D / 2 - LT / 2 + 0.003);
  bx(LT, L, D - 2 * LT + 0.006, -W / 2 + LT / 2 - 0.003, H - L / 2, 0); bx(LT, L, D - 2 * LT + 0.006, W / 2 - LT / 2 + 0.003, H - L / 2, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(0.028, H - L, 0.028, sx * (W / 2 - 0.012), (H - L) / 2, sz * (D / 2 - 0.012));   // #194: 2 mm proud of the panels and 1 mm of the base skirt (were coplanar: z-fighting)
  const K = 0.016;
  bx(W, K, T + 0.002, 0, K / 2, -D / 2 + T / 2); bx(W, K, T + 0.002, 0, K / 2, D / 2 - T / 2);
  bx(T + 0.002, K, D, -W / 2 + T / 2, K / 2, 0); bx(T + 0.002, K, D, W / 2 - T / 2, K / 2, 0);
  A.geo = mergeGeometries(parts, false);
  A.geo.computeBoundingSphere();
  return A.geo;
}
export function makeMilkCrate() {
  const g = new THREE.Group(); g.name = 'milkCrate';
  const A = milkAtlas(), mesh = new THREE.Mesh(milkGeometry(), A.mat);
  mesh.customDepthMaterial = A.depth;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.milkBody = true; g.add(mesh);
  g.userData.inner = { x: MILK.W / 2 - 0.008, z: MILK.D / 2 - 0.008, floor: 0.008, rim: MILK.H };
  g.userData.records = [];
  return g;
}

// #124: the Blender-baked milk crate (blender/milk_crate/milk_crate.blend -> web/models/milk_crate.glb). Same size,
// origin and wall/floor planes as the procedural one above (which stays as the fallback), so the crate physics
// (userData.inner) is unchanged. #125 (owner: v1 was 3x the triangles and ~30 MB of textures): v2 = 868 triangles,
// 4 x 2 openings per wall, solid floor; flat green base colour (no colour texture), a 1K tangent-space normal map
// (3 mm rounded moulded edges, fine grain) and a 512 occlusion/roughness/metal map. The glossy look of #68 is kept
// through the clearcoat stored in the GLB. All crates share one geometry + material.
let MILK_BAKED = null;
export async function loadMilkCrateBaked(url) {
  if (MILK_BAKED) return MILK_BAKED;
  const gltf = await loadBaked(url);
  let src = null; gltf.scene.traverse(o => { if (o.isMesh && !src) src = o; });
  if (!src) throw new Error('milk crate GLB has no mesh');
  const mat = src.material; mat.side = THREE.FrontSide;   // closed shell: no need to draw back faces
  mat.name = 'milk_crate_baked';
  // #191 (owner: too fake, too much sheen in passthrough; photo of a real crate): moulded HDPE is satin, not
  // lacquered. Clearcoat 0.6 / 0.15 -> 0.08 / 0.5, specular 1 -> 0.45, and the brighter bottle green of the photo
  // (was a near-black 0c4a22). Roughness / normal / AO maps from the GLB unchanged.
  mat.color.setHex(0x144a24); mat.clearcoat = 0.08; mat.clearcoatRoughness = 0.5; mat.specularIntensity = 0.45; mat.needsUpdate = true;
  MILK_BAKED = { geo: src.geometry, mat };
  return MILK_BAKED;
}
// swap the body of an existing crate (made before the GLB finished loading) for the baked one
export function upgradeMilkCrate(g) {
  if (!MILK_BAKED) return false;
  const old = g.children.find(o => o.isMesh && o.userData.milkBody);
  if (!old || old.geometry === MILK_BAKED.geo) return false;
  const m = new THREE.Mesh(MILK_BAKED.geo, MILK_BAKED.mat);
  m.castShadow = old.castShadow; m.receiveShadow = old.receiveShadow; m.userData = { ...old.userData };
  m.position.copy(old.position); m.quaternion.copy(old.quaternion); m.scale.copy(old.scale);
  g.add(m); g.remove(old); old.geometry.dispose(); if (old.material !== MILK_BAKED.mat) old.material.dispose();
  return true;
}

// ---------- crate (flight case) ----------
// #153 (owner: a more "LCD" look for the crate's lid monitor). On top of the emissive picture: an RGB sub-pixel
// stripe and the dark gaps between pixel rows, faded in only when a pixel is big enough on screen to resolve
// (fwidth), so there is no moire from across the room; backlight falling off a little toward the edges; the
// faint glow of an LCD's black level; and the picture dimming at grazing angles like a real panel.
function lcdLook(mat, W, H) {
  mat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { vec2 lp = vEmissiveMapUv * vec2(${W}.0, ${H}.0);
        float lfw = max(fwidth(lp.x), fwidth(lp.y));
        float lk = 1.0 - smoothstep(0.18, 0.55, lfw);                      // 1 = pixels clearly resolved
        float sp = fract(lp.x) * 3.0;
        vec3 sub = vec3(1.0 - step(1.0, sp), step(1.0, sp) * (1.0 - step(2.0, sp)), step(2.0, sp));
        float row = smoothstep(0.0, 0.14, fract(lp.y)) * smoothstep(1.0, 0.86, fract(lp.y));
        totalEmissiveRadiance *= mix(vec3(1.0), (sub * 2.6 + 0.12) * (0.62 + 0.38 * row), lk * 0.85);
        vec2 e = abs(vEmissiveMapUv - 0.5) * 2.0;
        float back = 1.0 - 0.10 * pow(max(e.x, e.y), 3.0);                // backlight falls off toward the edges
        float va = abs(dot(normalize(vViewPosition), normal));
        totalEmissiveRadiance = totalEmissiveRadiance * back * mix(0.55, 1.0, sqrt(va)) + vec3(0.010, 0.011, 0.014) * back; }`);
  };
  mat.customProgramCacheKey = () => 'vire-lcd';
}
// #153 (owner): the crate's front badge: a satin metal plate with the Dirrogate logo (the neon sign's logo) embossed
// in it, mounted flush on the front wall (its back on the wall face). 50 x 30 x 4 mm, one draw; normal and
// roughness maps drawn once from the logo centrelines: raised polished logo and rim on a brushed field.
let BADGE = null;
function makeCrateBadge() {
  if (!BADGE) {
    const W = 256, H = 154, h = document.createElement('canvas'); h.width = W; h.height = H;
    const g = h.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(6, 6, W - 12, H - 12);           // raised rim round the plate
    const L = Math.round(H * 0.8); g.drawImage(logoHeightCanvas(512, 0.055), (W - L) / 2, (H - L) / 2, L, L);
    const b = document.createElement('canvas'); b.width = W; b.height = H; const bg = b.getContext('2d');
    bg.filter = 'blur(1.2px)'; bg.drawImage(h, 0, 0);
    const src = bg.getImageData(0, 0, W, H).data, n = new Uint8Array(W * H * 4), r = new Uint8Array(W * H * 4);
    const at = (x, y) => src[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4] / 255;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const du = (at(x + 1, y) - at(x - 1, y)) * 2.2, dv = (at(x, y - 1) - at(x, y + 1)) * 2.2, l = Math.hypot(du, dv, 1);
      const o = ((H - 1 - y) * W + x) * 4, hv = at(x, y);
      n[o] = (-du / l * 0.5 + 0.5) * 255; n[o + 1] = (-dv / l * 0.5 + 0.5) * 255; n[o + 2] = (1 / l * 0.5 + 0.5) * 255; n[o + 3] = 255;
      r[o] = 255; r[o + 1] = (0.55 - 0.37 * hv + 0.05 * Math.sin(y * 1.7 + Math.sin(x * 0.05))) * 255; r[o + 2] = 255; r[o + 3] = 255;   // brushed field, polished logo
    }
    const tex = (d, cs) => { const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat); t.colorSpace = cs; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.needsUpdate = true; return t; };
    BADGE = {
      geo: new THREE.BoxGeometry(0.05, 0.03, 0.004).translate(0, 0, 0.002),
      mat: new THREE.MeshStandardMaterial({ color: 0xc6c9ce, metalness: 1, roughness: 1, normalMap: tex(n, THREE.NoColorSpace), roughnessMap: tex(r, THREE.NoColorSpace), normalScale: new THREE.Vector2(1, 1) }),
    };
  }
  const m = new THREE.Mesh(BADGE.geo, BADGE.mat); m.castShadow = true; m.userData.crateBadge = true;
  return m;
}
export const CRATE = { W: 0.36, D: 0.34, H: 0.3, slots: 48, pitch: 0.0062 };
// Lid on two hinges along the top back edge (owner, 26 Sep). Angle = rotation about the crate's x axis:
// OPEN leans back 24 deg, CLOSED lies flat on the case. The lid is a shallow tray the same size as the case
// (walls on the same lines, alu edges centred on the same corner lines), so shut it sits flush on the case
// rim. The hinge axis (PIVOT, crate space) is the outer back edge of the seam; every lid part is on the
// outer side of that seam (lid-local z <= 0), so it never sweeps through the records while it swings.
// Lid space: y runs from the hinge (0) along the lid, Y0..Y0+LL = back wall line .. front wall line;
// z = 0 is the rim (seam) face, z = -T the outer face with the handle and the chrome corner balls.
export const LID = { OPEN: -0.42, CLOSED: Math.PI / 2, BAL: 0.12, PIVOT: { y: 0.306, z: -0.178 }, Y0: 0.008, LL: 0.34, T: 0.035 };
export function makeCrate() {
  const g = new THREE.Group(); const u = {}; g.userData = u;
  const wall = (w, h, d, x, y, z) => { const m = box(w, h, d, MAT.case); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const t = 0.012;
  wall(CRATE.W, t, CRATE.D, 0, t / 2, 0);
  wall(t, CRATE.H, CRATE.D, -CRATE.W / 2 + t / 2, CRATE.H / 2, 0);
  wall(t, CRATE.H, CRATE.D, CRATE.W / 2 - t / 2, CRATE.H / 2, 0);
  wall(CRATE.W, CRATE.H * 0.6, t, 0, CRATE.H * 0.3, CRATE.D / 2 - t / 2);
  wall(CRATE.W, CRATE.H, t, 0, CRATE.H / 2, -CRATE.D / 2 + t / 2);
  // aluminium edge trim + corners + latch
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const e = box(0.016, CRATE.H + 0.004, 0.016, MAT.alu); e.position.set(x * (CRATE.W / 2), CRATE.H / 2, z * (CRATE.D / 2)); g.add(e);
  }
  const lip = box(CRATE.W, 0.012, 0.016, MAT.alu); lip.position.set(0, CRATE.H * 0.6, CRATE.D / 2); g.add(lip);
  for (const sx of [-1, 1]) { const tr = box(0.016, 0.012, CRATE.D, MAT.alu); tr.position.set(sx * CRATE.W / 2, CRATE.H, 0); g.add(tr); }
  const trB = box(CRATE.W, 0.012, 0.016, MAT.alu); trB.position.set(0, CRATE.H, -CRATE.D / 2); g.add(trB);
  for (const y of [0.006, CRATE.H * 0.3]) { const tr = box(CRATE.W + 0.004, 0.012, 0.016, MAT.alu); tr.position.set(0, y, CRATE.D / 2); g.add(tr); }
  // (#153: the free-floating chrome latch box is gone; makeCrateBadge() below, flush on the front wall)

  // sleeves: instanced, standing on edge, faces toward +z (the DJ)
  const sg = new THREE.BoxGeometry(0.315, 0.315, 0.0014);   // thin card jackets (owner, #70), not frames
  const sleeves = new THREE.InstancedMesh(sg, MAT.sleeve, CRATE.slots);
  sleeves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sleeves.castShadow = true; sleeves.userData.crateSleeves = true;
  g.add(sleeves); u.sleeves = sleeves;
  const col = new THREE.Color();
  for (let i = 0; i < CRATE.slots; i++) sleeves.setColorAt(i, col.setHSL(0.1, 0.1, 0.86 + ((i * 37) % 7) * 0.012));

  // lid with screen (hinged, see LID): laminate tray with alu edges, chrome ball corners, and a slim-bezel
  // monitor recessed inside the tray (#66, #70)
  const { Y0, LL, T } = LID, X = CRATE.W / 2, YM = Y0 + LL / 2;
  const lid = new THREE.Group(); lid.position.set(0, LID.PIVOT.y, LID.PIVOT.z); lid.rotation.x = LID.OPEN; g.add(lid);
  const put = (m, x, y, z) => { m.position.set(x, y, z); m.castShadow = true; lid.add(m); return m; };
  put(box(CRATE.W - 0.004, LL - 0.004, 0.0055, MAT.case), 0, YM, -T + 0.00325);    // outer skin, 0.5 mm inside the alu edges (no coplanar faces)
  for (const sx of [-1, 1]) put(box(0.012, LL - 0.004, T - 0.007, MAT.case), sx * (X - 0.006), YM, -(T - 0.005) / 2);   // tray side walls, stop 1 mm short of the rim face
  for (const y of [Y0 + 0.006, Y0 + LL - 0.006]) put(box(CRATE.W - 0.024, 0.012, T - 0.007, MAT.case), 0, y, -(T - 0.005) / 2);
  // alu: outer-face edges and rim rails, all 16 mm wide and centred on the case's own edge lines
  for (const sx of [-1, 1]) {
    put(box(0.016, LL + 0.016, 0.016, MAT.alu), sx * X, YM, -T + 0.008);   // side edges run past the corners; end edges butt into them
    put(box(0.016, LL + 0.016, 0.012, MAT.alu), sx * X, YM, -0.006);
  }
  for (const y of [Y0, Y0 + LL]) {   // end rails stop at the side rails (no overlapping volumes)
    put(box(CRATE.W - 0.016, 0.016, 0.016, MAT.alu), 0, y, -T + 0.008);
    put(box(CRATE.W - 0.016, 0.016, 0.012, MAT.alu), 0, y, -0.006);
  }
  for (const sx of [-1, 1]) for (const y of [Y0, Y0 + LL]) {
    put(box(0.0156, 0.0156, T - 0.028, MAT.alu), sx * X, y, -0.0155);                // corner posts between the rails
    put(new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), MAT.chrome), sx * X, y, -T);   // ball corners (moved here from the case)
  }
  // monitor inside the tray: 5 mm bezel, LCD recessed 1.5 mm, front 8 mm below the rim
  const MW = CRATE.W - 0.03, MH = LL - 0.03, BZ = 0.005, SW = MW - 2 * BZ, SH = MH - 2 * BZ;
  const MZ0 = -T + 0.006, MZ1 = -0.008, MD = MZ1 - MZ0;
  const plastic = new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.6, metalness: 0.1 });
  for (const [w, h, x, y] of [[MW, BZ, 0, YM + MH / 2 - BZ / 2], [MW, BZ, 0, YM - MH / 2 + BZ / 2], [BZ, SH, -MW / 2 + BZ / 2, YM], [BZ, SH, MW / 2 - BZ / 2, YM]]) {
    const f = box(w, h, MD, plastic); f.position.set(x, y, (MZ0 + MZ1) / 2); lid.add(f);
  }
  const back = box(SW, SH, MD - 0.006, plastic); back.position.set(0, YM, MZ0 + (MD - 0.006) / 2); lid.add(back);   // 4.5 mm behind the LCD (was 0.5 mm: z-fighting)
  // LCD panel: emissive picture under a satin anti-glare layer (soft broad sheen of the room lights, #70)
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), new THREE.MeshPhysicalMaterial({
    color: 0x030304, roughness: 0.95, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.24, envMapIntensity: 0.35,
    emissive: 0xffffff, emissiveIntensity: 0.85, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  scr.position.set(0, YM, MZ1 - 0.0015); lid.add(scr); u.screen = scr; scr.userData.crateScreen = true;
  lcdLook(scr.material, 1024, 960);   // #153
  // hinges: knuckle on the seam's back edge, case leaf below it, lid leaf on the lid's back end face
  const steel = satinSteel({ color: 0x9a9da3, rough: 0.34, repeat: 1, env: 0.35, physical: false });
  for (const sx of [-1, 1]) {
    const x = sx * (X - 0.07);
    const leaf = box(0.045, 0.022, 0.002, steel); leaf.position.set(x, LID.PIVOT.y - 0.013, LID.PIVOT.z - 0.001); g.add(leaf);
    const kn = cyl(0.0045, 0.0045, 0.045, steel, 16); kn.rotation.z = Math.PI / 2; kn.position.set(x, LID.PIVOT.y, LID.PIVOT.z); g.add(kn);
    const ll = box(0.045, 0.002, 0.022, steel); ll.position.set(x, -0.001, -0.013); lid.add(ll);
  }
  // carry handle in the middle of the outer face (on top when shut): rubber grip on two steel posts
  const HZ = -T - 0.001;
  const handle = new THREE.Group(); handle.position.set(0, YM, HZ); lid.add(handle);
  for (const sx of [-1, 1]) {
    const base = box(0.026, 0.034, 0.003, steel); base.position.set(sx * 0.056, 0, -0.0015); handle.add(base);
    const post = cyl(0.0045, 0.0045, 0.022, steel, 16); post.rotation.x = Math.PI / 2; post.position.set(sx * 0.056, 0, -0.014); handle.add(post);
  }
  const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085, 0.11, 4, 16), new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.85, metalness: 0 }));
  grip.rotation.z = Math.PI / 2; grip.position.set(0, 0, -0.026); handle.add(grip);
  handle.traverse(o => { if (o.isMesh) { o.castShadow = true; o.userData.lidHandle = true; } });
  u.lidHandle = { x: 0.064, y: YM, z: HZ - 0.026 };   // grip segment in lid space (for direct touch)
  lid.traverse(o => { if (o.isMesh && !o.userData.crateScreen) o.userData.lid = true; });
  // one mesh per material for the lid (swings as one) and for the case body (#84): 64 draw calls -> ~20
  mergeStatic(lid, a => a === scr);
  mergeStatic(g, a => a === lid || a === sleeves);
  u.lid = lid;
  const badge = makeCrateBadge(); badge.position.set(0, CRATE.H * 0.45, CRATE.D / 2); g.add(badge); u.badge = badge;   // #153
  // #127: tag the static parts so the Blender-baked meshes can replace them (upgradeRecordCrate)
  for (const c of g.children) if (c.isMesh && c !== sleeves && c !== badge) c.userData.crateBody = true;
  lid.traverse(c => { if (c.isMesh && c !== scr) c.userData[c.userData.lidHandle ? 'crateHandle' : 'crateLidBody'] = true; });   // the grip stays in its handle group
  if (CRATE_BAKED) upgradeRecordCrate(g);
  return g;
}
// #127: Blender-baked record crate (blender/record_crate/record_crate.blend -> web/models/record_crate.glb).
// Three meshes built on the exact coordinates of makeCrate() above: body (crate space), lid and carry handle (lid
// space), 246 + 512 + 156 triangles (the merged procedural parts were ~2.7k), one shared material: vertex colours for
// the base colours, a 1K normal map (rounded edges, rivets on the alu angles, fine laminate grain) and a 512
// occlusion/roughness/metal map. Screen, sleeves, jackets and the record riding out stay procedural.
let CRATE_BAKED = null;
export async function loadRecordCrateBaked(url) {
  if (CRATE_BAKED) return CRATE_BAKED;
  const gltf = await loadBaked(url);
  const get = n => { const o = gltf.scene.getObjectByName(n); if (!o || !o.isMesh) throw new Error('record crate GLB: missing ' + n); o.geometry.deleteAttribute('color_1'); return o; };
  const body = get('RecordCrate_body'), lid = get('RecordCrate_lid'), handle = get('RecordCrate_handle');
  const mat = body.material; mat.side = THREE.FrontSide; mat.vertexColors = true; mat.name = 'record_crate_baked';
  CRATE_BAKED = { body: body.geometry, lid: lid.geometry, handle: handle.geometry, mat };
  return CRATE_BAKED;
}
export function upgradeRecordCrate(g) {
  if (!CRATE_BAKED || g.userData.baked) return false;
  const lid = g.userData.lid;
  const swap = (parent, test, geo) => {   // replaces matching meshes anywhere under parent with one baked mesh in parent space
    const olds = []; parent.traverse(o => { if (o.isMesh && test(o)) olds.push(o); }); if (!olds.length) return;
    const m = new THREE.Mesh(geo, CRATE_BAKED.mat); m.castShadow = true; m.receiveShadow = true;
    for (const o of olds) { for (const [k, v] of Object.entries(o.userData)) if (k !== 'merged') m.userData[k] = v; o.parent.remove(o); o.geometry.dispose(); }
    parent.add(m);
  };
  swap(g, o => o.userData.crateBody && o.parent === g, CRATE_BAKED.body);
  swap(lid, o => o.userData.crateLidBody, CRATE_BAKED.lid);
  swap(lid, o => o.userData.crateHandle, CRATE_BAKED.handle);
  g.userData.baked = true;
  return true;
}
