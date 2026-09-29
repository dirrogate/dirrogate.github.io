// Neon sign prop (owner, 26 Sep; CLAUDE.md #80): the Dirrogate circle logo bent in red neon tube, held by
// a clip strap across each of the two centre bars, in the style of the owner's
// neon-arrow reference (white-hot tube core, red edges, red halo, black clips, screws with lit rims).
// Built from the logo's stroke centrelines (logo units: 1932 x 1932, y down, centre 966,966).
// Origin = centre of the logo, sign faces +z. Default size 60 cm across; the group's scale resizes it.
import * as THREE from 'three';
import { satinSteel } from './textures.js';
import { mergeGeometries } from '../vendor/three/utils/BufferGeometryUtils.js';
import { mergeStatic } from './merge.js';

const U = 1932, C = 966, DIA = 0.6, S = DIA / U;          // metres per logo unit at scale 1
const TUBE_R = 0.0052;                                      // glass tube radius (10.4 mm tube)
const P = (x, y) => new THREE.Vector3((x - C) * S, -(y - C) * S, 0);

// ---- centrelines (logo units) ------------------------------------------------------------------------
function arcPts(cx, cy, r, a0, a1, step = 10) {             // degrees, screen coords (y down)
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * Math.PI / 180 * r / step)), out = [];
  for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}
function quadPts(p0, p1, p2, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]); }
  return out;
}
const join = (...parts) => { const out = []; for (const p of parts) for (const q of p) { const l = out[out.length - 1]; if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 1) out.push(q); } return out; };
const mirY = pts => pts.map(([x, y]) => [x, 2 * C - y]);
const mirX = pts => pts.map(([x, y]) => [2 * C - x, y]);
// quarter (top centre -> left middle), mirrored into a closed loop that runs down the left and up the right
function loopFromQuarter(q) {
  const left = join(q, mirY(q).reverse());
  const loop = join(left, mirX(left).reverse());
  const f = loop[0], l = loop[loop.length - 1];
  if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 2) loop.pop();   // closed curve: no duplicate start/end point
  return loop;
}
function glyphOuter() {                                     // outer contour of the Gemini glyph
  // top curve is a quadratic (625.5,485) -> ctrl (966,666) -> (1306.5,485); take its left half exactly
  const top = quadPts([625.5, 485], [966, 666], [1306.5, 485], 48).slice(0, 25).reverse();   // (966,575.5) -> (625.5,485)
  const knob = arcPts(588, 550, 75, -60, -240);                                               // round end, left of the bar
  const under = quadPts([550.2, 614.8], [663.5, 680.5], [663.5, 700], 16);                    // underside into the pillar
  const pillar = [[663.5, 700], [663.5, 966]];
  return loopFromQuarter(join(top, knob, under, pillar));
}
function glyphInner() {                                     // the rectangle between the pillars
  const top = []; for (let x = 966; x >= 839.5; x -= 8) top.push([x, 726 - 12 * ((966 - x) / 151.5) ** 2]);
  top.push([839.5, 726 - 12 * (126.5 / 151.5) ** 2]);
  const yc = top[top.length - 1][1] + 25;
  const corner = arcPts(839.5, yc, 25, -90, -180, 4);
  return loopFromQuarter(join(top, corner, [[814.5, yc], [814.5, 966]]));
}
const OUTER = arcPts(C, C, 928, -124.48, 214.48, 12);       // outer ring, gap top-left
const INNER = arcPts(C, C, 777, 57.62, 392.38, 12);         // inner ring, gap bottom-right
const DOTS = [[C + 928 * Math.cos(-135 * Math.PI / 180), C + 928 * Math.sin(-135 * Math.PI / 180)], [C + 776 * Math.cos(Math.PI / 4), C + 776 * Math.sin(Math.PI / 4)]];
const NEON_LIGHT = 0.3;   // #148 point light intensity (candela) per unit of sign scale (more tube = more light)
const LOD_DIST = 3.0, IMP_E = 0.40;                        // far quad only beyond 3 m at scale 1 (owner, #96; was 6 ft); impostor half-extent
export const NEON = { S, DIA, TUBE_R, pillarX: (739 - C) * S, pillarHalfH: (966 - 700) * S, R: 1000 * S };

// ---- materials ----------------------------------------------------------------------------------------
// Tube (#144, owner: the old one looked cartoony; wants the clear-glass look of the "O"/"D" references): a clear
// glass tube with a thin glowing core running down its middle. Faked on the one tube mesh from the view angle:
// on a cylinder |N.V| tells how far from the tube's axis a pixel is (off = 0 on the axis, 1 at the silhouette), so
// the core is the pixels with off < ~0.3 (a line about a third of the tube wide, white-hot in the middle, red at its
// edges), the glass round it is lit faintly by the core and mostly see-through, and the glass edges catch a pale
// reflection. Normal alpha blending: the core stays opaque and saturated even over a bright wall in passthrough,
// the glass lets the room show through. Flicker (uOn) dims the core; the glass rim stays.
function tubeMat() {
  return new THREE.ShaderMaterial({
    uniforms: { uOn: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uOn; varying vec3 vN; varying vec3 vV;
      void main(){
        float f = abs(dot(normalize(vN), normalize(vV)));
        float off = sqrt(max(0.0, 1.0 - f * f));                  // 0 = tube axis, 1 = tube edge (projected)
        float aw = max(fwidth(off), 0.02);
        float core = 1.0 - smoothstep(0.30 - aw, 0.30 + aw, off);   // the glowing line
        float hot = 1.0 - smoothstep(0.0, 0.2, off);                 // white-hot middle of the line
        float fill = (1.0 - smoothstep(0.25, 0.95, off));            // core light inside the glass
        float rim = pow(off, 6.0);                                   // glass edge reflection
        vec3 red = vec3(1.0, 0.1, 0.05), hotC = vec3(1.0, 0.78, 0.7);
        vec3 coreC = mix(red, hotC, hot * uOn) * (0.12 + 0.88 * uOn);
        vec3 glass = red * 0.55 * uOn;
        vec3 col = mix(glass, coreC, core) + vec3(1.0, 0.85, 0.82) * rim * 0.35;
        float a = max(core * (0.25 + 0.75 * uOn), max(0.14 * fill * uOn, 0.05) + rim * 0.45);
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0)); }`,
    transparent: true, depthWrite: false,
  });
}

// Glass (#144): clear tube round the core. Mostly see-through (normal alpha blending, so passthrough shows through
// it), faintly red where the core lights it, a pale reflection along its edges (Fresnel). The electrodes (dark vertex
// colour) are nearly opaque dark metal. Unlit, like the rest of the sign.
function coreMat() {
  return new THREE.ShaderMaterial({
    uniforms: { uOn: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uOn; varying vec3 vN; varying vec3 vV;
      void main(){ float f = abs(dot(normalize(vN), normalize(vV)));
        vec3 c = mix(vec3(1.0, 0.02, 0.008), vec3(1.0, 0.88, 0.82), smoothstep(0.22, 0.72, f));   // #147: white-hot band down the middle (as in the Blender render), pure red edges
        gl_FragColor = vec4(mix(vec3(0.14, 0.05, 0.05), c, uOn), 1.0); }`,
  });
}
function glassMat() {
  return new THREE.ShaderMaterial({
    uniforms: { uOn: { value: 1 } }, vertexColors: true, transparent: true, depthWrite: false,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vEl;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        vEl = 1.0 - step(0.5, color.r); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uOn; varying vec3 vN; varying vec3 vV; varying float vEl;
      void main(){ float f = abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(1.0 - f, 3.0);
        vec3 lit = vec3(1.0, 0.015, 0.006) * uOn;
        vec3 glass = lit * 0.8 + vec3(1.0, 0.3, 0.25) * rim * 0.45;   // #147: pure red lit glass, red-tinted edge reflection
        float a = 0.08 + 0.42 * uOn * f * f + rim * 0.5;   // denser red so it stays red over a bright wall in passthrough
        vec3 el = vec3(0.05, 0.05, 0.055) + lit * 0.08 * f;
        gl_FragColor = vec4(mix(glass, el, vEl), mix(clamp(a, 0.0, 1.0), 0.9, vEl)); }`,
  });
}

// ---- build --------------------------------------------------------------------------------------------
export function makeNeonSign() {
  const g = new THREE.Group(); g.name = 'neonSign';
  const u = g.userData;
  // (#97) The glow is a flat image in the sign's own plane, not 3D shells: the old halo tubes (2.4x and 6.5x the tube
  // radius) had real depth, so in the headset they read as fat translucent capsules round every curve, and their
  // additive blend also wrote alpha, which blocked passthrough behind them. Now: thin glass tubes (white-hot core,
  // red edges) + one halo quad just behind them + the wall glow (main.js). Like the owner's neon-arrow reference.
  const tm = tubeMat(), hm = haloPlaneMat(neonHaloTexture());
  u.mats = [tm, hm];
  // LOD (owner, #83, #96): `full` (tubes + halo + clamps) up close; beyond LOD_DIST x scale a single flat quad with a
  // baked image of the lit sign (bakeNeonImpostor), in the sign's plane (correct in stereo because the sign is flat).
  const lod = new THREE.LOD(); g.add(lod); u.lod = lod;
  const full = new THREE.Group(); u.full = full; lod.addLevel(full, 0);
  const tubes = new THREE.Group(); tubes.position.z = 0.03; full.add(tubes);
  const core = [];
  const addPath = (pts, closed) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => P(x, y)), closed, 'centripetal');
    core.push(new THREE.TubeGeometry(curve, Math.ceil(curve.getLength() / 0.008), TUBE_R, 10, closed));
    if (!closed) for (const e of [pts[0], pts[pts.length - 1]]) { const at = P(...e); core.push(new THREE.SphereGeometry(TUBE_R, 10, 6).translate(at.x, at.y, at.z)); }
  };
  addPath(OUTER, false); addPath(INNER, false); addPath(glyphOuter(), true); addPath(glyphInner(), true);
  for (const d of DOTS) { const at = P(...d); core.push(new THREE.SphereGeometry(0.0085, 14, 10).translate(at.x, at.y, at.z)); }
  const tubeMesh = new THREE.Mesh(mergeGeometries(core, false), tm); core.forEach(x => x.dispose()); tubes.add(tubeMesh);
  // halo: one quad 6 mm behind the tube centres; the tubes cover it where they are, it glows round them
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALO_E, 2 * HALO_E), hm);
  halo.position.z = -0.006; halo.renderOrder = 3; halo.raycast = () => {}; tubes.add(halo);

  // no backing (owner, 26 Sep): the tubes float free; only the two clamps hold them
  // the two clamps: a black clip strap across both tubes of each centre bar, a screw with a lit rim at each end
  const clipM = new THREE.MeshStandardMaterial({ color: 0x0d0d0e, metalness: 0.3, roughness: 0.55, side: THREE.DoubleSide });
  const screwM = satinSteel({ color: 0x8f9298, rough: 0.34, repeat: 1, env: 0.4, physical: false });
  const rimM = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
  u.clamps = [];
  for (const sx of [-1, 1]) {
    const cl = new THREE.Group(); cl.position.set(sx * Math.abs(NEON.pillarX), 0, 0); full.add(cl);
    const span = (814.5 - 663.5) * S + 0.03;                    // across both tubes of the bar
    const strap = new THREE.Mesh(new THREE.BoxGeometry(span, 0.012, 0.004), clipM); strap.position.z = 0.03 + TUBE_R + 0.002; cl.add(strap);
    for (const tx of [-1, 1]) {                                 // saddles bending over each tube and down its sides
      const x = tx * (814.5 - 663.5) * S / 2;
      const sad = new THREE.Mesh(new THREE.CylinderGeometry(TUBE_R + 0.0018, TUBE_R + 0.0018, 0.012, 16, 1, true, -Math.PI / 2, Math.PI), clipM);
      sad.position.set(x, 0, 0.03); cl.add(sad);
    }
    for (const ex of [-1, 1]) {                                 // screw heads with red-lit rims on the strap ends
      const x = ex * (span / 2 - 0.006), zf = 0.03 + TUBE_R + 0.004;
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.002, 16), screwM); head.rotation.x = Math.PI / 2; head.position.set(x, 0, zf + 0.001); cl.add(head);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0049, 0.0008, 6, 24), rimM); rim.position.set(x, 0, zf + 0.0012); cl.add(rim);
    }
    u.clamps.push(cl);
  }
  // no real light (owner, #82): a PointLight made every lit material in the scene pay for one more light per
  // pixel. The glow is all emissive + additive halos.
  mergeStatic(full);   // clamp parts: one mesh per material (#84)
  u.tubeMesh = tubeMesh; u.clampMats = [clipM, screwM]; u.rimM = rimM;
  // far level: quad covering the sign plus its halo; its texture is filled by bakeNeonImpostor()
  const quadM = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, uOn: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D map; uniform float uOn; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(map, vUv).rgb * uOn, 0.0); }',
    side: THREE.DoubleSide,
  });
  lightBlend(quadM);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2 * IMP_E, 2 * IMP_E), quadM); quad.position.z = 0.03; quad.renderOrder = 4;
  lod.addLevel(quad, LOD_DIST, 0.08); u.quad = quad; u.mats.push(quadM);
  // #148 (owner): a real red light from the sign, so the gear near it picks up its glow (and its flicker). One point
  // light, no shadows, inverse-square falloff, reach 2.5 m x sign scale; it sits 15 cm in front of the logo centre
  // (sign-local, so it scales with the sign). Outside the LOD so it keeps lighting when the sign is a far image.
  const light = new THREE.PointLight(0xff1608, NEON_LIGHT, 2.5, 2); light.position.set(0, 0, 0.15); g.add(light); u.light = light;
  u.setLodScale = s => { lod.levels[1].distance = LOD_DIST * s; light.distance = 2.5 * s; light.userData.k = s; light.intensity = NEON_LIGHT * s * (u.level ?? 1); };
  const setLevel = v => { u.level = v; for (const m of u.mats) m.uniforms.uOn.value = v; light.intensity = NEON_LIGHT * (light.userData.k ?? 1) * v; rimM.color.setRGB(0.19 + 0.81 * v, 0.06 + 0.1 * v, 0.06 + 0.04 * v); };
  u.setOn = on => { u.enabled = on; setLevel(on ? 1 : 0); };
  // Random flicker (owner, #86): every 30 s to 2 min a short burst of drop-outs like a tired transformer:
  // 3-9 quick dips to a faint glow (30-150 ms), sometimes one longer dark gap, then steady again. Both LOD levels
  // follow (the far quad uses the same uOn). Call u.update(dt) every frame.
  const fl = { wait: 30 + Math.random() * 90, seq: null, t: 0, last: 1 };
  const burst = () => {
    const out = [], n = 3 + Math.floor(Math.random() * 7);
    for (let i = 0; i < n; i++) {
      out.push({ v: 0.04 + Math.random() * 0.3, d: 0.03 + Math.random() * 0.12 });
      if (i === Math.floor(n / 2) && Math.random() < 0.4) out.push({ v: 0.02, d: 0.35 + Math.random() * 0.5 });   // the long gap
      out.push({ v: 0.7 + Math.random() * 0.3, d: 0.04 + Math.random() * 0.3 });
    }
    out.push({ v: 1, d: 0 });
    return out;
  };
  u.enabled = true;
  u.update = dt => {
    if (!u.enabled) return;
    let v = 1;
    if (!fl.seq) { fl.wait -= dt; if (fl.wait <= 0) { fl.seq = burst(); fl.i = 0; fl.t = 0; } }
    if (fl.seq) {
      fl.t += dt;
      while (fl.i < fl.seq.length - 1 && fl.t > fl.seq[fl.i].d) { fl.t -= fl.seq[fl.i].d; fl.i++; }
      v = fl.seq[fl.i].v;
      if (fl.i >= fl.seq.length - 1) { fl.seq = null; fl.wait = 30 + Math.random() * 90; v = 1; }
    }
    if (v !== fl.last) { fl.last = v; setLevel(v); }
  };
  u.flickerNow = () => { fl.wait = 0; };
  return g;
}

// Render the lit sign once, straight on, into a 1024 px texture for the far LOD quad. Orthographic camera far
// away so the halos' facing term matches a head-on view; black background (the quad is additive, so black =
// nothing; the dark clamps simply drop out at that distance). Shaders write display values directly, and so
// does the quad, so no colour-space conversion is needed. Call once at load, before any XR session.
// Wall glow (owner, #96): the light the tubes throw on the wall behind them, faked as one image, no light source.
// The logo's own centrelines are drawn thick in red and blurred hard, so the glow has the sign's shape. The image
// spans GLOW_E (half-extent, sign-local metres at scale 1) so the blur can spread past the outer ring. Returned
// premultiplied (black = no light): shown additively, or as a tint in passthrough when additive light can't show.
// #153: the logo as a white-on-black image (N x N over the whole 1932-unit logo) for embossing it elsewhere
// (the record crate's front badge). strokeFrac = stroke width as a fraction of the image.
export function logoHeightCanvas(N, strokeFrac = 0.05) {
  const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
  const k = N / U, w = strokeFrac * N;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
  const stroke = (pts, closed) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k))); if (closed) g.closePath(); g.stroke(); };
  stroke(OUTER, false); stroke(INNER, false); stroke(glyphOuter(), true); stroke(glyphInner(), true);
  for (const [x, y] of DOTS) { g.beginPath(); g.arc(x * k, y * k, w * 0.75, 0, Math.PI * 2); g.fill(); }
  return c;
}
export const GLOW_E = 0.55;
// (#98) tighter and deeper red: on a light wall the old wide orange-red spill read as an opaque disc
export function neonGlowTexture() { return glowTexture(256, GLOW_E, [[7, 9, 'rgb(165,0,0)'], [3, 5, 'rgb(235,0,0)']]); }
// Halo round the tubes (#97): 512 px over +-HALO_E (1.3 mm per pixel): a tight hot rim right at the glass, a softer
// red spill of ~1 cm and a faint wide one of ~3 cm, like the photographed neon arrow.
export const HALO_E = 0.40;   // room for the widest spill round the outer ring (0.34 clipped it into a faint square)
// (#98) narrower and deeper red: the 3 cm spill filled the whole logo on light walls
export function neonHaloTexture() { return glowTexture(512, HALO_E, [[9, 10, 'rgb(90,0,0)'], [4, 10, 'rgb(215,0,0)'], [1.5, 9, 'rgb(255,24,14)']]); }
// Additive that never touches the framebuffer alpha: over passthrough it adds light instead of hiding the camera
// image (the old AdditiveBlending wrote alpha 1 and made the halo region opaque).
export function lightBlend(m) { m.transparent = true; m.depthWrite = false; m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; return m; }
function haloPlaneMat(map) {
  return lightBlend(new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uOn: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D map; uniform float uOn; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(map, vUv).rgb * uOn, 0.0); }',
  }));
}
// layers: [blur px, stroke width px, colour], drawn widest first
function glowTexture(N, E, layers) {
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), k = N / (2 * E);                     // pixels per metre
  const X = x => N / 2 + (x - C) * S * k, Y = y => N / 2 + (y - C) * S * k;
  g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
  const stroke = (pts, closed, w, col) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); if (closed) g.closePath(); g.lineWidth = w; g.strokeStyle = col; g.lineCap = 'round'; g.stroke(); };
  const paint = (w, col) => { stroke(OUTER, false, w, col); stroke(INNER, false, w, col); stroke(glyphOuter(), true, w, col); stroke(glyphInner(), true, w, col);
    for (const [x, y] of DOTS) { g.beginPath(); g.arc(X(x), Y(y), w * 0.6, 0, Math.PI * 2); g.fillStyle = col; g.fill(); } };
  g.globalCompositeOperation = 'lighter';
  for (const [blur, w, col] of layers) { g.filter = `blur(${blur}px)`; paint(w, col); }
  g.filter = 'none'; g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace;   // raw values: the glow shader writes them straight out
  return t;
}
export function bakeNeonImpostor(renderer, g) {
  const u = g.userData, full = u.full, N = 1024;
  const rt = new THREE.WebGLRenderTarget(N, N, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  const sc = new THREE.Scene(); sc.add(full);                        // borrow the full level (restored below)
  const cam = new THREE.OrthographicCamera(-IMP_E, IMP_E, IMP_E, -IMP_E, 19, 21); cam.position.set(0, 0, 20.03);
  const prev = { rt: renderer.getRenderTarget(), xr: renderer.xr.enabled, cc: renderer.getClearColor(new THREE.Color()), ca: renderer.getClearAlpha() };
  renderer.xr.enabled = false; renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear();
  renderer.render(sc, cam);
  renderer.setRenderTarget(prev.rt); renderer.xr.enabled = prev.xr; renderer.setClearColor(prev.cc, prev.ca);
  u.lod.levels[0].object = full; u.lod.add(full);
  if (u.impostorRT) u.impostorRT.dispose();   // re-bake (#144)
  u.quad.material.uniforms.map.value = rt.texture; u.impostorRT = rt;
}

// #133: Blender-built sign parts (blender/neon/neon.blend -> web/models/neon_sign(_ktx).glb), same coordinates as
// above. Tubes: the same logo centrelines, resampled where they bend (a ring every 8 deg of turn or 8 cm), 8 sides,
// smooth normals: 13.1k -> 3.9k triangles; still drawn by tubeMat (glow, flicker). Clamps: strap, 1 mm-wall saddles
// and screw heads in one mesh with vertex colours + 256 normal/ORM maps (1 draw instead of 2). Rims: flat lit rings,
// 128 triangles instead of 1152, still rimM (dims with the flicker). The procedural parts stay if the GLB fails.
export async function upgradeNeon(g, loadBaked) {
  const u = g.userData; if (u.baked) return;
  // #144: glass-tube sign (blender/neon/neon_glass.blend): NeonGlass (clear 13 mm tubes, rounded glass ends with dark
  // electrodes inside, glass bulbs for the two dots; 3,016 tris) + NeonCore (the thin glowing line inside each tube,
  // 3.6 mm, 1,416 tris, drawn by tubeMat: white-hot middle, red edges, flicker). Clamps and rims as #133.
  const gltf = await loadBaked(new URL('../models/neon_sign_glass.glb', import.meta.url).href);
  const get = n => { const o = gltf.scene.getObjectByName(n); if (!o || !o.isMesh) throw new Error('neon GLB: missing ' + n); return o; };
  const core = get('NeonCore'), glassSrc = get('NeonGlass'), clamps = get('NeonClamps'), rims = get('NeonRims');
  u.tubeMesh.geometry.dispose(); u.tubeMesh.geometry = core.geometry;
  const glass = new THREE.Mesh(glassSrc.geometry, glassMat()); glass.renderOrder = 2; glass.raycast = () => {};
  u.tubeMesh.parent.add(glass); u.glass = glass; u.mats.push(glass.material);
  // the core gets its own hotter look (mostly white-hot, red only at its very edges) and the halo a softer, dimmer
  // spill: the old tight hot-red rim round a solid tube hid the clear glass
  const coreM = coreMat(); u.mats[u.mats.indexOf(u.tubeMesh.material)] = coreM; u.tubeMesh.material.dispose(); u.tubeMesh.material = coreM;
  const hm = u.mats.find(m => m.uniforms && m.uniforms.map && m !== u.quad.material);
  if (hm) { hm.uniforms.map.value.dispose(); hm.uniforms.map.value = glowTexture(512, HALO_E, [[16, 22, 'rgb(40,0,0)'], [6, 14, 'rgb(80,2,1)']]); }
  const full = u.full, old = full.children.filter(o => o.isMesh && (u.clampMats.includes(o.material) || o.material === u.rimM));
  for (const o of old) { full.remove(o); o.geometry.dispose(); }
  clamps.geometry.deleteAttribute('color_1');
  const cm = clamps.material; cm.vertexColors = false; cm.side = THREE.FrontSide;   // #146: rusty iron from its own 512 colour / ORM / normal maps (vertex colours no longer used)
  const cMesh = new THREE.Mesh(clamps.geometry, cm); cMesh.castShadow = true; full.add(cMesh);
  const rMesh = new THREE.Mesh(rims.geometry, u.rimM); full.add(rMesh);
  const tag = old.length ? { ...old[0].userData } : {}; delete tag.merged;   // keep the move tag main.js put on the parts
  Object.assign(cMesh.userData, tag); Object.assign(rMesh.userData, tag);
  u.baked = true;
}
