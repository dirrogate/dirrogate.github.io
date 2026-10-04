// Turntable built from a GLB (CC-BY-4.0: "MK2 1210 Turntable - Old" by GRIP420, Sketchfab).
// Produces the same userData interface as the procedural makeDeck() in models.js, so the rest of the
// app does not care which one it gets. Model units are ~0.708 cm; everything below is in model units
// until scaled into deck-local metres.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';
import { makeLED, DECK, MAT } from './models.js';
import { strobeDotTexture, glowTexture, satinSteel } from './textures.js';
import { mergeStatic } from './merge.js';

export const GLB_CREDIT = '"MK2 1210 Turntable - Old" by GRIP420 (sketchfab.com/GRIP420), CC-BY-4.0, modified';

const S = 0.453 / 64;                       // model width 64 units -> 453 mm
const PLATTER = { x: -6.494, z: 0.053 };     // model units
const OFF = new THREE.Vector3(DECK.spindle.x - PLATTER.x * S, -0.018, DECK.spindle.z - PLATTER.z * S);
const m2l = (x, y, z) => new THREE.Vector3(x * S + OFF.x, y * S + OFF.y, z * S + OFF.z); // model -> deck-local

let template = null, template_satin = null;
export async function loadDeckTemplate(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  // Paint out the parody wordmark and relabel the pitch scale (+-8 %, #253) (licence allows adaptation).
  root.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m.name === 'body_top_mat' && m.map && !m.userData.fixed) {
      const img = m.map.image, c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const k = img.width / 1024;
      g.fillStyle = '#000'; g.fillRect(1340 * k / 2, 20 * k, 480 * k / 2 * 1.02, 60 * k); // "Techno.ics Hartz" + subtitle
      g.fillRect(900 * k, 104 * k, 26 * k, 262 * k);                                   // old +-8 numbers
      g.save(); g.scale(1, -1); g.fillStyle = '#e8e8e8'; g.font = `bold ${10 * k}px sans-serif`; g.textAlign = 'right';
      [8, 6, 4, 2, 0, 2, 4, 6, 8].forEach((n, i) => g.fillText(String(n), 925 * k, -(119 + i * 30) * k));   // #253 printed for +-8 % like the MK7 (X2 doubles it)
      g.restore();
      // #122 (owner): silver MK2 look. The top plate is die-cast aluminium, so it becomes metal: satin silver where
      // the model's texture is black, dark ink where it has white print (legends, pitch scale, dial markings).
      // #126: no separate roughness/metal map (that was a 2048 texture, 21 MB of GPU memory): the shader reads
      // silver vs ink from this colour map itself (ink = paint: not metal, roughness 0.62; silver: metal,
      // roughness 0.40). Built once at load; no per-frame cost.
      // #154 (owner: the 2048 RGBA canvas was 21 MB of GPU memory): the plate is only ever silver-to-ink, so the
      // map is stored as ONE channel (the ink amount, R8: 5.3 MB) and the shader turns it into the same colours
      // (sRGB 200/202/205 silver .. 34/34/36 ink, mixed in sRGB like the old canvas, then linearised).
      const W = c.width, H = c.height, px = g.getImageData(0, 0, W, H).data, r8 = new Uint8Array(W * H);
      for (let i = 0, j = 0; j < r8.length; i += 4, j++) r8[j] = Math.max(px[i], px[i + 1], px[i + 2]);
      const t = new THREE.DataTexture(r8, W, H, THREE.RedFormat, THREE.UnsignedByteType);
      t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.wrapS = m.map.wrapS; t.wrapT = m.map.wrapT; t.anisotropy = 8; t.needsUpdate = true;
      m.map = t; m.metalnessMap = null; m.roughnessMap = null; m.metalness = 1; m.roughness = 0.4;
      m.onBeforeCompile = sh => {
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <map_fragment>', `
  { float vireInk = texture2D(map, vMapUv).r;
    vec3 vireC = mix(vec3(200.0, 202.0, 205.0), vec3(34.0, 34.0, 36.0), vireInk) / 255.0;
    diffuseColor.rgb *= mix(vireC / 12.92, pow((vireC + 0.055) / 1.055, vec3(2.4)), step(0.04045, vireC)); }`)
          .replace('#include <roughnessmap_fragment>', `
  float vireSilver = smoothstep(0.03, 0.40, dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
  float roughnessFactor = mix(0.62, 0.40, vireSilver);`)
          .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vireSilver;');
      };
      m.customProgramCacheKey = () => 'vire-silver-top';
      m.userData.fixed = true; m.needsUpdate = true;
    }
    if (m.name === 'turn_plade_mat') { o.material = MAT.felt; }       // baked record image -> plain slipmat
    // tonearm, 45 adapter holder, buttons, feet trims: satin brushed steel instead of mirror chrome
    if (m.name === 'metal_mat') { if (!template_satin) template_satin = satinSteel({ repeat: 3 }); o.material = template_satin; }
    if (m.name === 'metal_mat1') { m.metalness = 0.9; m.roughness = 0.4; }
  });
  await applyBakedAO(root);
  // Slipmat (CLAUDE.md #65): planar UVs across the mat's own disc so a square slipmat image maps straight on
  {
    const sm = root.getObjectByName('table_sm_turn_plade_mat_0');
    if (sm) {
      const P = sm.geometry.attributes.position, cx = PLATTER.x, cy = -PLATTER.z;   // raw mesh coords are z-up
      let R = 0; for (let i = 0; i < P.count; i++) R = Math.max(R, Math.hypot(P.getX(i) - cx, P.getY(i) - cy));
      const uv = new Float32Array(P.count * 2);
      for (let i = 0; i < P.count; i++) { uv[i * 2] = (P.getX(i) - cx) / (2 * R) + 0.5; uv[i * 2 + 1] = (P.getY(i) - cy) / (2 * R) + 0.5; }
      sm.geometry = sm.geometry.clone(); sm.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
  }
  // The target lamp's tube and its round base are one mesh in the model: split them so only the tube
  // sinks into the deck (CLAUDE.md #54). Base = triangles entirely below 15.36 model units.
  const lamp = root.getObjectByName('polySurface11_metal_mat_0');
  if (lamp && !root.getObjectByName('lampTube')) {
    const geo = lamp.geometry, pos = geo.attributes.position, idx = geo.index;
    const v = new THREE.Vector3(), low = [];
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(lamp.matrixWorld); low[i] = v.y < 15.36; }
    const baseIdx = [], tubeIdx = [];
    const n = idx ? idx.count : pos.count, get = k => (idx ? idx.getX(k) : k);
    for (let t = 0; t < n; t += 3) {
      const a = get(t), b = get(t + 1), c = get(t + 2);
      (low[a] && low[b] && low[c] ? baseIdx : tubeIdx).push(a, b, c);
    }
    const mk = (ids, name) => { const gg = geo.clone(); gg.setIndex(ids); const m = new THREE.Mesh(gg, lamp.material); m.name = name; m.position.copy(lamp.position); m.quaternion.copy(lamp.quaternion); m.scale.copy(lamp.scale); return m; };
    const parent = lamp.parent;
    parent.add(mk(baseIdx, 'lampBase')); parent.add(mk(tubeIdx, 'lampTube'));
    parent.remove(lamp);
    root.updateMatrixWorld(true);
  }
  roundPowerKnob(root);
  ensureUV1(root);
  template = root;
  return root;
}


// Baked ambient occlusion (CLAUDE.md #60), made by tools/bake_ao.mjs from this GLB: a 2048 px atlas plus
// one lightmap UV per triangle corner for every baked mesh. The meshes are un-indexed so each corner can
// carry its own atlas UV. Parts that move or are rebuilt at runtime point at a white texel.
// AO normally only darkens ambient/environment light in three.js; here it also takes up to 80 % off direct
// light, so the contact shading still shows under the key light and in passthrough.
let aoInfo = null;
if (!THREE.ShaderChunk.aomap_fragment.includes('VIRE_AO')) THREE.ShaderChunk.aomap_fragment += `
#ifdef USE_AOMAP
  // VIRE_AO
  reflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, 0.8);
  reflectedLight.directSpecular *= mix(1.0, ambientOcclusion, 0.8);
#endif`;
async function applyBakedAO(root) {
  let data, tex;
  try {
    [data, tex] = await Promise.all([
      fetch(new URL('../models/turntable_ao.json', import.meta.url)).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      new THREE.TextureLoader().loadAsync(new URL('../models/turntable_ao.png', import.meta.url).href),
    ]);
  } catch (e) { console.warn('turntable AO bake not loaded', e); return; }
  // #126: the bake is greyscale, but a PNG decodes to RGBA (2048 x 2048 x 4 bytes + mips = 21 MB of GPU memory).
  // Keep one channel only (R8, 5.3 MB); three's aoMap reads .r anyway.
  {
    const img = tex.image, w = img.width, h = img.height, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cg = cv.getContext('2d', { willReadFrequently: true }); cg.drawImage(img, 0, 0);
    const src = cg.getImageData(0, 0, w, h).data, r8 = new Uint8Array(w * h);
    for (let i = 0; i < r8.length; i++) r8[i] = src[i * 4];
    tex.dispose();
    tex = new THREE.DataTexture(r8, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  }
  tex.flipY = false; tex.channel = 1; tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 4; tex.needsUpdate = true;
  const k = 1 / data.uvScale, mats = new Set();
  root.traverse(o => {
    if (!o.isMesh) return; const arr = data.meshes[o.name]; if (!arr) return;
    const gg = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    if (gg.attributes.position.count * 2 !== arr.length) { console.warn('AO uv count mismatch', o.name); return; }
    const uv1 = new Float32Array(arr.length); for (let i = 0; i < arr.length; i++) uv1[i] = arr[i] * k;
    gg.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2)); o.geometry = gg; mats.add(o.material);
  });
  try { clearSpiderAO(root, tex.image.data, tex.image.width, tex.image.height); tex.needsUpdate = true; } catch (e) { console.warn('spider AO patch', e); }   // #263
  for (const m of mats) { m.aoMap = tex; m.aoMapIntensity = 1; m.needsUpdate = true; }
  aoInfo = { tex, white: data.white, mats };
}
// #263 (owner: lift the 45 adapter out and there's a black disc in its recess). The AO bake was made with the
// adapter in place, so the plate under it is baked dark. Here the plate's AO inside the adapter's footprint is
// refilled with the AO just round it (a soft-edged patch), so the recess reads as plain metal: no Blender rebake.
// The plate's lightmap UVs near the adapter are fitted as an affine map from model x/z, so any texel can be
// placed in model space.
function clearSpiderAO(root, r8, W, H) {
  const sp = root.getObjectByName('pPipe1_metal_mat_0') || root.getObjectByName('pPipe1'), plate = root.getObjectByName('polySurface6_body_top_mat_0');
  if (!sp || !plate || !plate.geometry.attributes.uv1) return;
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(sp), C = bb.getCenter(new THREE.Vector3()), R = (bb.max.x - bb.min.x) / 2;
  const pos = plate.geometry.attributes.position, uv = plate.geometry.attributes.uv1, n = pos.count;   // un-indexed: 3 corners a triangle
  const P = [], v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(plate.matrixWorld); P.push([v.x - C.x, v.z - C.z, uv.getX(i) * W, uv.getY(i) * H]); }
  // each triangle near the adapter, rasterised in the AO atlas: every texel gets its spot in model x/z
  const ring = [], inside = [];
  for (let t = 0; t + 2 < n; t += 3) {
    const a = P[t], b = P[t + 1], c = P[t + 2];
    // skip triangles wholly away from the footprint (closest corner / edge test via the bounding box in model space)
    const mnx = Math.min(a[0], b[0], c[0]), mxx = Math.max(a[0], b[0], c[0]), mnz = Math.min(a[1], b[1], c[1]), mxz = Math.max(a[1], b[1], c[1]);
    if (mnx > 1.5 * R || mxx < -1.5 * R || mnz > 1.5 * R || mxz < -1.5 * R) continue;
    const x0 = Math.max(0, Math.floor(Math.min(a[2], b[2], c[2]))), x1 = Math.min(W - 1, Math.ceil(Math.max(a[2], b[2], c[2])));
    const y0 = Math.max(0, Math.floor(Math.min(a[3], b[3], c[3]))), y1 = Math.min(H - 1, Math.ceil(Math.max(a[3], b[3], c[3])));
    const den = (b[3] - c[3]) * (a[2] - c[2]) + (c[2] - b[2]) * (a[3] - c[3]); if (Math.abs(den) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const l1 = ((b[3] - c[3]) * (px - c[2]) + (c[2] - b[2]) * (py - c[3])) / den, l2 = ((c[3] - a[3]) * (px - c[2]) + (a[2] - c[2]) * (py - c[3])) / den, l3 = 1 - l1 - l2;
      if (l1 < -0.01 || l2 < -0.01 || l3 < -0.01) continue;
      const mx = l1 * a[0] + l2 * b[0] + l3 * c[0], mz = l1 * a[1] + l2 * b[1] + l3 * c[1], d = Math.hypot(mx, mz) / R;
      if (d < 1.12) inside.push([y * W + x, d]); else if (d < 1.5) ring.push(r8[y * W + x]);
    }
  }
  if (!ring.length || !inside.length) { console.warn('spider AO patch: nothing found'); return; }
  ring.sort((p, q) => p - q); const fill = ring[ring.length >> 1];
  for (const [i, d] of inside) { const t = d < 1.0 ? 1 : 1 - (d - 1.0) / 0.12; r8[i] = Math.round(r8[i] * (1 - t) + fill * t); }
}
// any mesh sharing a baked material but without its own bake gets a constant white-texel UV1
function ensureUV1(root) {
  if (!aoInfo) return;
  root.traverse(o => {
    if (!o.isMesh || o.geometry.attributes.uv1) return;
    const n = o.geometry.attributes.position.count, a = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { a[i * 2] = aoInfo.white[0]; a[i * 2 + 1] = aoInfo.white[1]; }
    o.geometry.setAttribute('uv1', new THREE.BufferAttribute(a, 2));
  });
}

// The power dial in the model is a 16-sided prism, which reads as faceted up close. Rebuild it in place
// with 48 sides (same radius, heights, materials and printed top) -- about 340 triangles instead of 112.
// Raw mesh coordinates are z-up here. The dark window facing the platter (0..67.5 deg) becomes the red
// strobe lamp lens (CLAUDE.md #59).
const KNOB = { cx: -29.2329, cy: -15.6298, R: 2.0, Ri: 1.9, z0: 15.0718, z1: 16.7656, z2: 17.2712, win: [0, 67.5] };
export const KNOB_LAMP_RAW = (() => { const a = 33.75 * Math.PI / 180; return new THREE.Vector3(KNOB.cx + Math.cos(a) * 2.02, KNOB.cy + Math.sin(a) * 2.02, (KNOB.z0 + KNOB.z1) / 2); })();
function roundPowerKnob(root) {
  const side = root.getObjectByName('polySurface15_metal_mat_0'), win = root.getObjectByName('polySurface15_phongE7_0'), top = root.getObjectByName('polySurface15_body_top_mat_0');
  if (!side || !win || !top || side.userData.rounded) return;
  const SEG = 48, dA = 2 * Math.PI / SEG, { cx, cy } = KNOB;
  const build = (fill) => { const P = [], N = [], U = [], I = []; fill(P, N, U, I); const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); gg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    gg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); gg.setIndex(I); gg.computeBoundingSphere(); gg.computeBoundingBox(); return gg; };
  // smooth cylinder wall from a0 to a1 (radians)
  const wall = (P, N, U, I, r, za, zb, a0, a1, uvAt) => {
    const n = Math.max(1, Math.round((a1 - a0) / dA)), base = P.length / 3;
    for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n, c = Math.cos(a), s = Math.sin(a);
      for (const z of [za, zb]) { P.push(cx + c * r, cy + s * r, z); N.push(c, s, 0); const uv = uvAt ? uvAt(a, z) : [k / n, (z - za) / (zb - za)]; U.push(uv[0], uv[1]); } }
    for (let k = 0; k < n; k++) { const q = base + k * 2; I.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
  };
  const annulus = (P, N, U, I, r0, r1, z) => { const base = P.length / 3;
    for (let k = 0; k <= SEG; k++) { const a = k * dA, c = Math.cos(a), s = Math.sin(a); P.push(cx + c * r0, cy + s * r0, z, cx + c * r1, cy + s * r1, z); N.push(0, 0, 1, 0, 0, 1); U.push(k / SEG, 0, k / SEG, 1); }
    for (let k = 0; k < SEG; k++) { const q = base + k * 2; I.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); } };
  // printed top: same texture placement as the original cap (affine fit of its UVs, residual ~1e-6)
  const capUV = (x, y) => [0.0177834 * x + 0.0097225 * y - 0.2878490, -0.0097225 * x + 0.0177835 * y + 0.1372367];
  const w0 = KNOB.win[0] * Math.PI / 180, w1 = KNOB.win[1] * Math.PI / 180;
  const edgeUV = capUV(cx + KNOB.Ri * 0.97, cy);   // plain dark body colour just inside the cap edge
  side.geometry = build((P, N, U, I) => { wall(P, N, U, I, KNOB.R, KNOB.z0, KNOB.z1, w1, w0 + 2 * Math.PI); annulus(P, N, U, I, KNOB.Ri, KNOB.R, KNOB.z1); });
  win.geometry = build((P, N, U, I) => wall(P, N, U, I, KNOB.R + 0.002, KNOB.z0, KNOB.z1, w0, w1));
  top.geometry = build((P, N, U, I) => {
    wall(P, N, U, I, KNOB.Ri, KNOB.z1, KNOB.z2, 0, 2 * Math.PI, () => edgeUV);
    const base = P.length / 3; P.push(cx, cy, KNOB.z2); N.push(0, 0, 1); U.push(...capUV(cx, cy));
    for (let k = 0; k <= SEG; k++) { const a = k * dA, x = cx + Math.cos(a) * KNOB.Ri, y = cy + Math.sin(a) * KNOB.Ri; P.push(x, y, KNOB.z2); N.push(0, 0, 1); U.push(...capUV(x, y)); }
    for (let k = 0; k < SEG; k++) I.push(base, base + 1 + k, base + 2 + k);
  });
  side.userData.rounded = true;
}

function byName(root, name) { const o = root.getObjectByName(name); if (!o) throw new Error('GLB part missing: ' + name); return o; }

// Wrap objects in a new group whose origin is at `pivotLocal` (deck-local), keeping their world placement.
function pivotGroup(parent, pivotLocal, objs) {
  const g = new THREE.Group(); g.position.copy(pivotLocal); parent.add(g); g.updateMatrixWorld(true);
  for (const o of objs) g.attach(o);
  return g;
}

// Printed button legends: light grey type on a transparent decal (text left-aligned when there is an LED bar).
const legendCache = new Map();
function legendMat(text, aspect, withLed) {
  const key = text + aspect.toFixed(2) + withLed; if (legendCache.has(key)) return legendCache.get(key);
  const H = 128, W = Math.round(H * aspect), c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#1d1e22'; x.textBaseline = 'middle';   // dark print: the caps are brushed steel
  let fs = withLed ? H * 0.62 : H * 0.2; x.font = `600 ${fs}px system-ui, Arial, sans-serif`;
  if (withLed) { x.textAlign = 'left'; x.fillText(text, W * 0.1, H * 0.54); }
  else { x.textAlign = 'center'; while (x.measureText(text).width > W * 0.8) { fs -= 2; x.font = `600 ${fs}px system-ui, Arial, sans-serif`; } x.fillText(text, W / 2, H / 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  legendCache.set(key, m); return m;
}

// #264 (owner: the strobe dot ring looked smudgy). The model's rim texture is 128 px with the dots' lighting painted
// in, blurred by the time it reaches the headset. Redrawn at 512 px in the same layout (silver chamfers top and
// bottom, 4 dots a tile, rows top to bottom: small, big, medium, medium; the strobe shader's row bands unchanged),
// each dot a raised satin-metal stud: crisp anti-aliased edge, a soft dome shade, a thin highlight on the upper
// left and a shadow line on the lower right. Mipmaps + 8x anisotropy keep it crisp at a glance angle.
let dotsTex = null;
function crispDots(orig) {
  if (dotsTex) return dotsTex;
  const S = 512, k = S / 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, 11.5 * k); g.fillRect(0, 122 * k, S, S - 122 * k);   // the rim's chamfers
  const rows = [[27.5, 5.8], [55, 13.2], [83, 8.4], [107, 9.6]];   // centre y, radius (in the 128 px layout)
  for (const [cy, r] of rows) for (let i = -1; i <= 4; i++) {
    const cx = (15 + 32 * i) * k, y = cy * k, R = r * k;
    g.fillStyle = 'rgba(0,0,0,0.9)'; g.beginPath(); g.arc(cx + R * 0.12, y + R * 0.14, R * 1.06, 0, Math.PI * 2); g.fill();   // contact shadow
    const gr = g.createRadialGradient(cx - R * 0.3, y - R * 0.35, R * 0.1, cx, y, R);
    gr.addColorStop(0, '#e4e4e6'); gr.addColorStop(0.55, '#bfbfc2'); gr.addColorStop(1, '#8c8c90');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, y, R, 0, Math.PI * 2); g.fill();
    g.lineWidth = Math.max(1, R * 0.09); g.strokeStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.arc(cx, y, R * 0.92, Math.PI * 0.95, Math.PI * 1.6); g.stroke();
    g.strokeStyle = 'rgba(30,30,32,0.9)'; g.beginPath(); g.arc(cx, y, R * 0.95, -Math.PI * 0.05, Math.PI * 0.55); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  if (orig) { t.colorSpace = orig.colorSpace; t.flipY = orig.flipY; t.channel = orig.channel; }
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return (dotsTex = t);
}

export function makeGlbDeck(name) {
  const g = new THREE.Group(); g.name = name; const u = {}; g.userData = u;
  const model = template.clone(true);
  // bake model -> deck-local transform into a holder
  const holder = new THREE.Group(); holder.scale.setScalar(S); holder.position.copy(OFF); g.add(holder);
  holder.add(model); g.updateMatrixWorld(true);
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // ---- platter: spins about the spindle
  const platterParts = ['table_sm'].map(n => byName(model, n));
  const platterSurfaceY = 16.93 * S + OFF.y;
  u.platter = pivotGroup(g, new THREE.Vector3(DECK.spindle.x, platterSurfaceY, DECK.spindle.z), platterParts);
  u.platterSurface = platterSurfaceY + 0.0015; // record floats 1.5 mm up so it never z-fights the mat in the headset
  u.slipmat = []; u.platter.traverse(o => { if (o.isMesh && o.material === MAT.felt) u.slipmat.push(o); });
  // owner's slipmats: left deck (A) and right deck (B)
  {
    const tex = new THREE.TextureLoader().load(new URL(`../models/slipmat_${name === 'A' ? 'left' : 'right'}.jpg`, import.meta.url).href);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.95, metalness: 0 });
    for (const o of u.slipmat) o.material = mat;
  }
  u.platter.traverse(o => { if (o.isMesh) o.userData.platterOf = name; });
  // The dotted platter body gets its own group so the dots can show the stroboscopic effect (CLAUDE.md #47):
  // under the strobe lamp they appear to stand still at exact speed and drift with pitch.
  // (CLAUDE.md #53) The dotted platter turns with the platter. The strobe "standing still" trick made it
  // look stopped because a headset has no flickering lamp, so it was dropped.
  u.top = 14.38 * S + OFF.y;

  // The model's own platter rim carries the strobe dots; no extra rings or red lamp on top of it
  // (they read as a second platter showing through).
  u.strobeRows = [];
  u.strobeLamp = { userData: { set() {} } };
  u.strobeLight = { intensity: 0 };
  // Pop-up target light (CLAUDE.md #52): press to rise and shine blue across the record, press again to sink.
  {
    const part = byName(model, 'lampTube'); const box = new THREE.Box3().setFromObject(part);
    const top = g.worldToLocal(new THREE.Vector3(0, box.max.y, 0).add(box.getCenter(new THREE.Vector3()).setY(0))).y;
    const c = g.worldToLocal(box.getCenter(new THREE.Vector3()));
    const grp = pivotGroup(g, c, [part]);
    part.traverse(o => { if (o.isMesh) o.userData.control = { deck: name, id: 'target' }; });
    const lampBase = model.getObjectByName('lampBase'); if (lampBase) lampBase.userData.control = { deck: name, id: 'target' };
    const headY = top - c.y;
    // Find the lamp head from the tube's own vertices (grp space): its real axis and its surface toward
    // the platter. The lens is a small flat disc set into that surface, facing the record.
    grp.updateMatrixWorld(true);
    const P = part.geometry.attributes.position, vv = new THREE.Vector3(), toGrp = new THREE.Matrix4().copy(grp.matrixWorld).invert().multiply(part.matrixWorld);
    const head = [];
    for (let i = 0; i < P.count; i++) { vv.fromBufferAttribute(P, i).applyMatrix4(toGrp); if (vv.y > headY - 0.006) head.push(vv.clone()); }
    const axis = head.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, head.length)); axis.y = 0;
    const toPlatter = new THREE.Vector3(DECK.spindle.x - c.x - axis.x, 0, DECK.spindle.z - c.z - axis.z).normalize()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), 25 * Math.PI / 180);   // owner: turn the lens ~25 deg to its left
    let reach = 0; for (const p of head) reach = Math.max(reach, (p.x - axis.x) * toPlatter.x + (p.z - axis.z) * toPlatter.z);
    const lensY = headY - 0.0035;
    // flush with the tube wall (polygon offset keeps it from flickering), nothing sticks out
    const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.0019, 20), new THREE.MeshStandardMaterial({ color: 0x1a2640, emissive: 0x3d7bff, toneMapped: false, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    bulb.position.set(axis.x + toPlatter.x * (reach - 0.0002), lensY, axis.z + toPlatter.z * (reach - 0.0002));
    bulb.lookAt(bulb.position.clone().add(toPlatter)); grp.add(bulb);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x5aa0ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
    glow.visible = false; glow.raycast = () => {}; grp.add(glow);   // no halo sprite: it read as a bulge
    // low, grazing beam aimed past the record centre, so it washes across the vinyl rather than the cartridge
    const spot = new THREE.SpotLight(0x2f6bff, 0, 0.8, 0.5, 0.9, 0.4);
    spot.position.copy(bulb.position); grp.add(spot);
    spot.visible = false;   // #148 (owner): the lamp's light exists only while the tube is out of the deck (saves a light in every lit shader)
    spot.target.position.set(DECK.spindle.x - c.x + toPlatter.x * 0.12, u.platterSurface - c.y, DECK.spindle.z - c.z + toPlatter.z * 0.12); grp.add(spot.target);
    const up = 0, down = (box.min.y + 0.002) - box.max.y;   // recessed: head sits ~2 mm proud of the deck top
    u.targetLight = { userData: { set() {} } };
    u.target = { grp, bulb, glow, spot, y0: c.y, up, down, headY, raised: false, t: 0,
      step(dt, power) {
        this.t += Math.sign((this.raised ? 1 : 0) - this.t) * Math.min(Math.abs((this.raised ? 1 : 0) - this.t), dt / 0.9); // ~1 s travel
        const e = this.t * this.t * (3 - 2 * this.t);
        this.grp.position.y = this.y0 + this.down + (this.up - this.down) * e;
        const on = power && this.t > 0.6 ? (this.t - 0.6) / 0.4 : 0;
        this.bulb.material.emissiveIntensity = on * 9; this.glow.material.opacity = on * 0.7; this.spot.intensity = on * 7;
        const out = this.t > 0.001; if (this.spot.visible !== out) this.spot.visible = out;   // #148
      } };
    u.target.grp.position.y = c.y + down;
  }
  // Platter dots (CLAUDE.md #59). Two fixes in the platter's own shader:
  //  - room light: the dots are smeared along the rim by the angle the platter turns in one display frame,
  //    the way your eye sees a spinning platter under steady light. Without it the headset refresh acts
  //    like a strobe and the dots flicker and crawl (wagon-wheel effect).
  //  - red strobe lamp in the power dial: lights only the rim beside the dial with a frozen sample, so the
  //    row that matches the current pitch stands still and the others drift, as on the real deck.
  {
    const mesh = g.getObjectByName('table_sm_tt_sp_mat_0');
    const uni = { uBlur: { value: 0 }, uStrobe: { value: new THREE.Vector4() }, uLampPos: { value: new THREE.Vector3() }, uLampCol: { value: new THREE.Color(0, 0, 0) } };
    const mat = mesh.material.clone();
    mat.map = crispDots(mesh.material.map);   // #264 sharp dots (the model's 128 px texture went soft in the headset)
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vStWP; varying vec3 vStWN;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvStWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vStWN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vStWP; varying vec3 vStWN; uniform float uBlur; uniform vec4 uStrobe; uniform vec3 uLampPos; uniform vec3 uLampCol;')
        .replace('#include <map_fragment>', `
          vec3 strobeAlbedo = vec3(0.0);
          #ifdef USE_MAP
            vec4 sampledDiffuseColor = vec4(0.0);
            for (int i = 0; i < 12; i++) { float t = (float(i) + 0.5) / 12.0 - 0.5; sampledDiffuseColor += texture2D(map, vMapUv + vec2(t * uBlur, 0.0)); }
            sampledDiffuseColor /= 12.0;
            diffuseColor *= sampledDiffuseColor;
            float fv = fract(vMapUv.y);
            float stOff = fv < 0.29 ? uStrobe.x : fv < 0.56 ? uStrobe.y : fv < 0.745 ? uStrobe.z : uStrobe.w;
            strobeAlbedo = texture2D(map, vMapUv + vec2(stOff, 0.0)).rgb;
          #endif`)
        .replace('#include <opaque_fragment>', `
          { vec3 L = uLampPos - vStWP; float d = length(L);
            float att = smoothstep(0.075, 0.03, d) / (1.0 + d * d / 0.0006);
            outgoingLight += uLampCol * strobeAlbedo * max(dot(normalize(vStWN), L / d), 0.0) * att; }
          #include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => 'vire-platter-dots';
    mesh.material = mat;
    // red lens: the dial's dark window facing the platter
    const win = g.getObjectByName('polySurface15_phongE7_0');
    const lens = new THREE.MeshStandardMaterial({ color: 0x220404, emissive: 0xff1a08, emissiveIntensity: 0, roughness: 0.25, toneMapped: false });
    if (win) win.material = lens;
    const lampPt = new THREE.Object3D(); lampPt.position.copy(KNOB_LAMP_RAW); if (win) win.add(lampPt);
    u.strobe = { uni, lens, lampPt, kU: 7.7209,       /* texture u per radian of rim, measured from the mesh */ P: 0.25, F: 100,
      // rows by texture v (bottom to top of the rim): -3.3 %, 0 % (big dots), +3.3 %, +6 %, like the printed legend
      rows: [-0.033, 0, 0.033, 0.06].map(p => ({ p, phi: 0 })) };
  }
  // power dial (front left): twist or click to switch the whole deck on/off
  {
    const part = byName(model, 'polySurface15'); const box = new THREE.Box3().setFromObject(part);
    const c = g.worldToLocal(box.getCenter(new THREE.Vector3()));
    u.powerKnob = pivotGroup(g, c, [part]);
    part.traverse(o => { if (o.isMesh) o.userData.control = { deck: name, id: 'power' }; });
  }

  // ---- buttons
  // Buttons keep the deck's own matte brushed-metal caps (CLAUDE.md #58): no coloured emissive tint and no
  // glow sprite. Feedback is physical: the cap dips 1.5 mm when pressed and springs back.
  const btn = (partName, id, partObj = null) => {
    const part = partObj || byName(model, partName); const box = new THREE.Box3().setFromObject(part);
    const c = g.worldToLocal(box.getCenter(new THREE.Vector3()));
    const grp = pivotGroup(g, c, [part]);
    const meshes = []; part.traverse(o => { if (o.isMesh) { meshes.push(o); o.userData.control = { deck: name, id }; } });
    let pressedAt = -1e9;
    grp.userData.press = () => { pressedAt = performance.now(); };
    grp.userData.set = () => {   // called every frame; drives the dip
      const t = (performance.now() - pressedAt) / 1000;
      const dip = t < 0.06 ? t / 0.06 : t < 0.16 ? 1 : Math.max(0, 1 - (t - 0.16) / 0.1);
      grp.position.y = c.y - 0.0015 * dip;
    };
    grp.userData.mesh = meshes[0];
    // printed legend (and for 33/45 a small LED bar) on the cap, like the real deck (CLAUDE.md #64)
    const capMesh = meshes.find(m => /metal/.test(m.name)) || meshes[0];
    const cb = new THREE.Box3().setFromObject(capMesh), cw = cb.max.x - cb.min.x, cd = cb.max.z - cb.min.z;
    const topY = cb.max.y - (box.getCenter(new THREE.Vector3()).y) + 0.00025;
    const cx = (cb.min.x + cb.max.x) / 2 - box.getCenter(new THREE.Vector3()).x, cz = (cb.min.z + cb.max.z) / 2 - box.getCenter(new THREE.Vector3()).z;
    const label = id === 'start' ? 'START \u00b7 STOP' : id === 'rpm33' ? '33' : id === 'x2' ? 'X2' : '45';
    const speed = id !== 'start';
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(cw * 0.92, cd * 0.86), legendMat(label, cw / cd, speed));
    decal.rotation.x = -Math.PI / 2; decal.position.set(cx, topY, cz); decal.userData = meshes[0].userData; grp.add(decal);
    if (speed) {
      const ledMat = new THREE.MeshBasicMaterial({ color: 0x2a2a2c, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const led = new THREE.Mesh(new THREE.PlaneGeometry(cw * 0.26, cd * 0.2), ledMat);
      led.rotation.x = -Math.PI / 2; led.position.set(cx + cw * 0.22, topY + 0.00005, cz); grp.add(led);
      const on = new THREE.Color(id === 'x2' ? 0x2a8cff : 0xff2418), off = new THREE.Color(0x262628);   // #253 X2: blue like the MK7
      grp.userData.led = (v) => ledMat.color.copy(off).lerp(on, Math.max(0, Math.min(1, v)));
    }
    return grp;
  };
  // #253 X2 (pitch range): a copy of the 33 button's cap, moved past the far end of the pitch fader below
  const p33 = byName(model, 'polySurface13'), x2part = p33.clone(true); p33.parent.add(x2part);
  // #256 the 45 adapter ('spider', pPipe1: a metal ring in the top-left recess) is its own object, so it can be lifted
  // out and put on the spindle (main.js spiders). Home = this pose in the recess.
  { const sp = model.getObjectByName('pPipe1') || model.getObjectByName('pPipe1_metal_mat_0'); if (sp) {
      const bx = new THREE.Box3().setFromObject(sp), c = g.worldToLocal(bx.getCenter(new THREE.Vector3()));
      u.spider = pivotGroup(g, c, [sp]); u.spiderHome = { p: u.spider.position.clone(), q: u.spider.quaternion.clone() };
      u.spiderH = bx.max.y - bx.min.y;
      sp.traverse(o => { if (o.isMesh) o.userData.spider = name; });
  } }
  u.start = btn('polySurface14', 'start');
  u.b33 = btn('polySurface13', 'rpm33');
  u.b45 = btn('polySurface12', 'rpm45');

  // ---- pitch fader: the cap slides along z; travel covers the printed scale
  const cap = byName(model, 'speed_sm');
  const capC = m2l(27.55, 15.53, 9.86);
  u.pitchCap = pivotGroup(g, capC, [cap]);
  cap.traverse(o => { if (o.isMesh) o.userData.control = { deck: name, id: 'pitch' }; });
  const half = 7.3 * S;
  u.pitchTravel = { z0: capC.z - half, z1: capC.z + half, x: capC.x };
  u.x2 = btn(null, 'x2', x2part);
  u.x2.position.set(u.pitchTravel.x, u.x2.position.y, u.pitchTravel.z0 - 0.032);   // set() only moves y (the press dip)
  u.zeroLED = makeLED(0x40ff60, 0.0022, 0.018); u.zeroLED.position.copy(m2l(24.9, 15.1, 9.86)); g.add(u.zeroLED);
  // #123 (owner): no glow sprite over the pitch zero LED (looked fake); the LED itself still lights
  for (const c of [...u.zeroLED.children]) if (c.isSprite) { u.zeroLED.remove(c); c.material.dispose(); }

  // ---- tonearm: yaw about the base, lift about the gimbal. Arm points along +z inside `yaw` like the procedural one.
  const pivotL = m2l(21.48, 19.58, -12.21);
  const needleL = m2l(14.71, 18.87, 19.82);
  const restYaw = Math.atan2(needleL.x - pivotL.x, needleL.z - pivotL.z);
  const arm = new THREE.Group(); arm.position.copy(pivotL); g.add(arm);
  const yaw = new THREE.Group(); yaw.rotation.y = restYaw; arm.add(yaw);
  const pitch = new THREE.Group(); yaw.add(pitch); g.updateMatrixWorld(true);
  for (const n of ['arm_msh', 'needle_system_msh', 'needle_msh', 'turner_msh']) pitch.attach(byName(model, n));
  arm.traverse(o => { if (o.isMesh) o.userData.control = { deck: name, id: 'arm' }; });
  for (const n of ['rest_msh1', 'polySurface10', 'polySurface18']) byName(model, n).traverse(o => { if (o.isMesh) o.userData.control = { deck: name, id: 'arm' }; });
  arm.userData = { yaw, pitch };
  // Grab zone (CLAUDE.md #62): the blue cartridge and its finger lift only, as points in pitch-group space
  // (vertices of needle_system_msh thinned to a 6 mm grid). Nothing in front of the cartridge counts.
  {
    g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(pitch.matrixWorld).invert(), M = new THREE.Matrix4(), v = new THREE.Vector3(), seen = new Set(), pts = [];
    byName(pitch, 'needle_system_msh').traverse(o => {
      if (!o.isMesh) return; M.multiplyMatrices(inv, o.matrixWorld); const P = o.geometry.attributes.position;
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(M); const k = `${Math.round(v.x / 0.006)},${Math.round(v.y / 0.006)},${Math.round(v.z / 0.006)}`; if (!seen.has(k)) { seen.add(k); pts.push(v.clone()); } }
    });
    u.headPts = pts;
  }
  u.arm = arm;
  u.pivot = new THREE.Vector3(pivotL.x, 0, pivotL.z);
  u.restYaw = restYaw;
  const horiz = Math.hypot(needleL.x - pivotL.x, needleL.z - pivotL.z);
  u.stylusLocal = new THREE.Vector3(0, needleL.y - pivotL.y, horiz);          // in pitch-group space at yaw
  const recordTop = u.platterSurface + 0.0019 + 0.001;   // +1 mm: the stylus read as buried in the vinyl (owner, #59)
  u.armDown = Math.asin((needleL.y - recordTop) / horiz);                      // tilt that puts the stylus on the vinyl
  u.armLift = 0.07;
  u.armLength = horiz;
  // everything still under the model holder never moves: one mesh per material (#84). Platter, arm, buttons,
  // pitch cap, power dial, lamp and LEDs were moved into their own groups above and stay separate.
  mergeStatic(pitch);   // #154: the arm's own parts sharing a material (arm + turner metal, arm + turner black) move together: one mesh each
  mergeStatic(g, a => a.parent === g && a !== holder);
  return g;
}
