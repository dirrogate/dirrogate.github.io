// CYBERCINEMATICS: Shared Black Pro-Mist diffusion, CGI micro-soften, GoPro Macro DoF,
// HEADSET CAM soft bokeh, Booth Dust Motes, and Anjunadeep bar-driven pano evolution.
// Zero audio-thread impact; bypassed completely when OFF.
import * as THREE from 'three';

const KEY = 'vire.cinematics';

export const MIST_LEVELS = ['off', '1/4', '1/2', 'full'];
export const MIST_PRESETS = {
  off:    { label: 'OFF',  soften: 0.00, thresh: 1.00, halo: 0.00, veil: 0.00, grain: 0.000 },
  '1/4':  { label: '1/4',  soften: 0.55, thresh: 0.68, halo: 0.24, veil: 0.05, grain: 0.012 },
  '1/2':  { label: '1/2',  soften: 0.90, thresh: 0.54, halo: 0.44, veil: 0.10, grain: 0.018 },
  full:   { label: 'FULL', soften: 1.30, thresh: 0.42, halo: 0.68, veil: 0.18, grain: 0.025 },
};
export const DOF_MODES = ['auto', 'on', 'off'];
export const MOTE_MODES = ['off', 'dust', 'embers', 'mist'];
// Pano drift in bars (starting at 128 bars = 512 beats, incrementing by +32 beats = +8 bars per step)
export const PANO_ROTS = [0, 128, 136, 144, 152, 160, 168, 176, 184, 192];
export const PANO_GRADES = ['off', 'sunset', 'deep'];
export const PANO_AUTO_MODES = ['off', 'end', '64b', '128b', '5m', '10m'];
export const TARGETS = ['both'];
const PLIST_KEY = 'vire.panolist';

const ACES_GLSL = `
vec3 rrt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= 1.0 / 0.6; return clamp(O * rrt(I * c), 0.0, 1.0);
}
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
`;

const QUAD_VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Stage 1 + Stage 3: CGI 5-tap micro-soften (pre-ACES in linear HDR) + soft radial Macro DoF bokeh
const PREP_FS = `precision highp float;
uniform sampler2D uMap;
uniform vec2 uTexel;
uniform float uHdr;
uniform float uFlip;
uniform float uSoften;
uniform float uDof;      // 0..1 bokeh strength
uniform vec2 uFocusUv;   // focus centre (default 0.5, 0.45)
varying vec2 vUv;
${ACES_GLSL}
vec3 sampleSrc(vec2 uv) {
  vec3 c = texture2D(uMap, uv).rgb;
  return uHdr > 0.5 ? max(c, 0.0) : c;
}
void main() {
  vec2 uv = vec2(vUv.x, uFlip > 0.5 ? 1.0 - vUv.y : vUv.y);
  vec3 col = sampleSrc(uv);

  // Stage 1: CGI micro-soften (5-tap diamond)
  if (uSoften > 0.02) {
    vec2 d = uTexel * uSoften;
    vec3 s = col * 0.40
      + sampleSrc(uv + vec2(d.x, 0.0)) * 0.15
      + sampleSrc(uv - vec2(d.x, 0.0)) * 0.15
      + sampleSrc(uv + vec2(0.0, d.y)) * 0.15
      + sampleSrc(uv - vec2(0.0, d.y)) * 0.15;
    col = s;
  }

  // Stage 3: Soft macro DoF / bokeh outside central focus sweet-spot (8-tap golden ring)
  if (uDof > 0.01) {
    vec2 delta = (vUv - uFocusUv) * vec2(1.0, 1.15);
    float coc = smoothstep(0.18, 0.62, length(delta)) * uDof;
    if (coc > 0.01) {
      float rad = coc * 7.5;
      vec3 acc = col;
      float wsum = 1.0;
      for (int i = 0; i < 8; i++) {
        float ang = float(i) * 0.78539816 + 0.39;
        vec2 off = vec2(cos(ang), sin(ang)) * uTexel * rad;
        vec3 tap = sampleSrc(clamp(uv + off, 0.002, 0.998));
        float lum = dot(tap, vec3(0.2126, 0.7152, 0.0722));
        float w = 1.0 + smoothstep(0.55, 1.6, lum) * 2.2 * coc;   // creamy highlight bokeh orbs
        acc += tap * w;
        wsum += w;
      }
      col = acc / wsum;
    }
  }

  vec3 outCol = uHdr > 0.5 ? srgb(aces(col)) : clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(outCol, 1.0);
}`;

// Stage 2a: 1/4-res downsample + Black Pro-Mist highlight extract & full-frame veil seed
const EXTRACT_FS = `precision highp float;
uniform sampler2D uMap;
uniform vec2 uTexel;
uniform float uThresh;
uniform float uVeil;
varying vec2 vUv;
void main() {
  vec3 c = (
    texture2D(uMap, vUv + vec2(-uTexel.x, -uTexel.y)).rgb +
    texture2D(uMap, vUv + vec2( uTexel.x, -uTexel.y)).rgb +
    texture2D(uMap, vUv + vec2(-uTexel.x,  uTexel.y)).rgb +
    texture2D(uMap, vUv + vec2( uTexel.x,  uTexel.y)).rgb
  ) * 0.25;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float hi = smoothstep(uThresh, uThresh + 0.35, lum);
  // Warm subtle tint on halation + soft full-frame veil
  vec3 haloCol = c * hi * vec3(1.04, 1.00, 0.95);
  gl_FragColor = vec4(haloCol, lum);
}`;

// Stage 2b: Separable 9-tap Gaussian blur at 1/4 resolution
const BLUR_FS = `precision highp float;
uniform sampler2D uMap;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec4 acc = texture2D(uMap, vUv) * 0.227027;
  acc += (texture2D(uMap, vUv + uDir * 1.3846) + texture2D(uMap, vUv - uDir * 1.3846)) * 0.316216;
  acc += (texture2D(uMap, vUv + uDir * 3.2308) + texture2D(uMap, vUv - uDir * 3.2308)) * 0.070270;
  gl_FragColor = acc;
}`;

// Stage 2c: Final composite — Black Pro-Mist halation + diffusion veil + shared grain + corner CA + gentle vignette
const COMP_FS = `precision highp float;
uniform sampler2D uBase;
uniform sampler2D uMist;
uniform vec2 uTexel;
uniform float uHalo;
uniform float uVeil;
uniform float uGrain;
uniform float uCa;
uniform float uTime;
varying vec2 vUv;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec2 centered = vUv - 0.5;
  float r2 = dot(centered, centered);

  // Subtle radial corner chromatic aberration (~1.1 px at corners only)
  vec3 base;
  if (uCa > 0.5) {
    vec2 caOff = centered * r2 * uTexel * 3.8;
    base.r = texture2D(uBase, clamp(vUv + caOff, 0.0, 1.0)).r;
    base.g = texture2D(uBase, vUv).g;
    base.b = texture2D(uBase, clamp(vUv - caOff, 0.0, 1.0)).b;
  } else {
    base = texture2D(uBase, vUv).rgb;
  }

  vec3 mist = texture2D(uMist, vUv).rgb;
  // Screen-blend highlight halation (never clips harshly) + gentle full-frame diffusion veil
  vec3 halo = mist * uHalo;
  vec3 col = 1.0 - (1.0 - base) * (1.0 - clamp(halo, 0.0, 0.92));
  if (uVeil > 0.001) {
    vec3 softBase = (
      texture2D(uBase, vUv + vec2(uTexel.x * 2.0, 0.0)).rgb +
      texture2D(uBase, vUv - vec2(uTexel.x * 2.0, 0.0)).rgb +
      texture2D(uBase, vUv + vec2(0.0, uTexel.y * 2.0)).rgb +
      texture2D(uBase, vUv - vec2(0.0, uTexel.y * 2.0)).rgb
    ) * 0.25;
    col = mix(col, max(softBase, mist * 0.85 + 0.025), uVeil);
  }

  // Gentle vintage lens vignette
  col *= 1.0 - r2 * (0.14 + uVeil * 0.35);

  // Shared fine animated sensor/film grain (weighted toward midtones/shadows)
  if (uGrain > 0.0005) {
    float n = hash12(floor(vUv / max(uTexel, vec2(1e-4))) + fract(uTime * 17.31) * 100.0) - 0.5;
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float w = 1.0 - lum * 0.45;
    col += n * uGrain * 2.2 * w;
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// Booth Dust Motes / Warm Embers shader: calm ground-up rising particles with smooth floor/ceiling fade
const MOTE_VS = `
attribute float aSeed;
attribute float aSize;
uniform float uTime;
uniform float uSpeed;
uniform float uMode; // 1=dust, 2=embers, 3=mist
varying float vAlpha;
varying float vWarm;
void main() {
  vec3 p = position;
  float rise = (uMode > 1.5 && uMode < 2.5) ? (0.09 + 0.06 * aSeed) : (0.045 + 0.035 * aSeed);
  float h = mod(p.y + uTime * uSpeed * rise, 2.35);
  p.y = h;
  // Very gentle laminar horizontal sway (no erratic jitter)
  float drift = uTime * 0.14 + aSeed * 12.566;
  p.x += sin(drift) * 0.045;
  p.z += cos(drift * 0.85) * 0.045;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = max(-mv.z, 0.35);
  float bokeh = 1.0 + smoothstep(1.6, 4.2, dist) * 1.1;
  gl_PointSize = clamp((aSize * bokeh * 135.0) / dist, 1.8, 18.0);
  float yFade = smoothstep(0.0, 0.42, h) * smoothstep(2.35, 1.70, h);
  float dFade = smoothstep(0.35, 0.85, dist) * smoothstep(5.0, 2.5, dist);
  float breathe = 0.65 + 0.35 * sin(uTime * 0.45 + aSeed * 25.0);
  vAlpha = yFade * dFade * breathe;
  vWarm = aSeed;
  gl_Position = projectionMatrix * mv;
}`;

const MOTE_FS = `precision highp float;
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uOpacity;
varying float vAlpha;
varying float vWarm;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float soft = pow(1.0 - d * d, 2.0);
  vec3 col = mix(uColA, uColB, vWarm);
  gl_FragColor = vec4(col, soft * vAlpha * uOpacity);
}`;

const _quadGeo = new THREE.PlaneGeometry(2, 2);
const _orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

class CinePass {
  constructor() {
    this.w = 0; this.h = 0;
    this.baseRT = null; this.qA = null; this.qB = null; this.outRT = null;

    this.prepMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: PREP_FS, depthTest: false, depthWrite: false,
      uniforms: {
        uMap: { value: null }, uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
        uHdr: { value: 1 }, uFlip: { value: 0 }, uSoften: { value: 0.9 },
        uDof: { value: 0 }, uFocusUv: { value: new THREE.Vector2(0.5, 0.46) },
      }
    });
    this.extMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: EXTRACT_FS, depthTest: false, depthWrite: false,
      uniforms: { uMap: { value: null }, uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) }, uThresh: { value: 0.54 }, uVeil: { value: 0.1 } }
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: BLUR_FS, depthTest: false, depthWrite: false,
      uniforms: { uMap: { value: null }, uDir: { value: new THREE.Vector2(1 / 320, 0) } }
    });
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: COMP_FS, depthTest: false, depthWrite: false,
      uniforms: {
        uBase: { value: null }, uMist: { value: null }, uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
        uHalo: { value: 0.44 }, uVeil: { value: 0.10 }, uGrain: { value: 0.018 }, uCa: { value: 1 }, uTime: { value: 0 },
      }
    });
    this.mesh = new THREE.Mesh(_quadGeo, this.prepMat);
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }

  _ensure(w, h) {
    if (this.w === w && this.h === h && this.outRT) return;
    this.dispose();
    this.w = w; this.h = h;
    const opt = { type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const qw = Math.max(64, Math.round(w / 4)), qh = Math.max(64, Math.round(h / 4));
    this.baseRT = new THREE.WebGLRenderTarget(w, h, opt);
    this.qA = new THREE.WebGLRenderTarget(qw, qh, opt);
    this.qB = new THREE.WebGLRenderTarget(qw, qh, opt);
    this.outRT = new THREE.WebGLRenderTarget(w, h, opt);
  }

  run(renderer, srcTex, w, h, { hdr = true, flip = false, soften = 0.9, dof = 0, thresh = 0.54, halo = 0.44, veil = 0.1, grain = 0.018, ca = true, time = 0 } = {}) {
    this._ensure(w, h);
    const prevRT = renderer.getRenderTarget();
    const prevXR = renderer.xr.enabled;
    const prevClear = renderer.autoClear;
    renderer.xr.enabled = false;
    renderer.autoClear = false;

    const tx = 1 / w, ty = 1 / h;
    const qw = this.qA.width, qh = this.qA.height;

    // 1. Prep (Micro-Soften + Macro DoF + ACES)
    const pm = this.prepMat.uniforms;
    pm.uMap.value = srcTex; pm.uTexel.value.set(tx, ty);
    pm.uHdr.value = hdr ? 1 : 0; pm.uFlip.value = flip ? 1 : 0;
    pm.uSoften.value = soften; pm.uDof.value = dof;
    this.mesh.material = this.prepMat;
    renderer.setRenderTarget(this.baseRT);
    renderer.render(this.scene, _orthoCam);

    // Fast path when mist + grain + ca are all off: baseRT is already the final output!
    if (halo <= 0.001 && veil <= 0.001 && grain <= 0.0005 && !ca) {
      renderer.setRenderTarget(prevRT);
      renderer.xr.enabled = prevXR;
      renderer.autoClear = prevClear;
      this.lastRT = this.baseRT;
      return this.baseRT.texture;
    }

    // 2. Downsample & extract highlights at 1/4-res
    const em = this.extMat.uniforms;
    em.uMap.value = this.baseRT.texture; em.uTexel.value.set(tx, ty);
    em.uThresh.value = thresh; em.uVeil.value = veil;
    this.mesh.material = this.extMat;
    renderer.setRenderTarget(this.qA);
    renderer.render(this.scene, _orthoCam);

    // 3. Separable H + V blur
    const bm = this.blurMat.uniforms;
    this.mesh.material = this.blurMat;
    bm.uMap.value = this.qA.texture; bm.uDir.value.set(1.6 / qw, 0);
    renderer.setRenderTarget(this.qB);
    renderer.render(this.scene, _orthoCam);

    bm.uMap.value = this.qB.texture; bm.uDir.value.set(0, 1.6 / qh);
    renderer.setRenderTarget(this.qA);
    renderer.render(this.scene, _orthoCam);

    // 4. Final composite
    const cm = this.compMat.uniforms;
    cm.uBase.value = this.baseRT.texture; cm.uMist.value = this.qA.texture;
    cm.uTexel.value.set(tx, ty);
    cm.uHalo.value = halo; cm.uVeil.value = veil;
    cm.uGrain.value = grain; cm.uCa.value = ca ? 1 : 0; cm.uTime.value = time;
    this.mesh.material = this.compMat;
    renderer.setRenderTarget(this.outRT);
    renderer.render(this.scene, _orthoCam);

    renderer.setRenderTarget(prevRT);
    renderer.xr.enabled = prevXR;
    renderer.autoClear = prevClear;
    this.lastRT = this.outRT;
    return this.outRT.texture;
  }

  dispose() {
    for (const rt of [this.baseRT, this.qA, this.qB, this.outRT]) if (rt) rt.dispose();
    this.baseRT = this.qA = this.qB = this.outRT = null;
  }
}

export class CyberCinematics {
  constructor(rig) {
    this.S = {
      target: 'both',
      mist: '1/2',
      soften: 0.90,
      grain: 0.018,
      ca: true,
      dof: 'auto',
      hcBokeh: true,
      motes: 'dust',
      moteDensity: 0.25,
      haze: false,
      panoRot: 0,
      panoGrade: 'sunset',
      panoBreathe: true,
      panoAuto: 'off',
    };
    this._load();
    this.panoList = [];
    this.panoIdx = 0;
    this.panoBarStart = 0;
    this.panoTimeStart = 0;
    this.panoBlending = false;
    this._loadPanoList();
    this.onChange = null;
    this.time = 0;
    this.barPhase = 0;       // continuous musical bar counter
    this.lastMacroDof = 0;   // computed 0..1 from GoPro distance to booth
    this._gpPass = new CinePass();
    this._hcPass = new CinePass();
    this._tint = new THREE.Color(1, 1, 1);
    this._colA = new THREE.Color();
    this._colB = new THREE.Color();

    // 3D Booth Dust Motes (attached to rig)
    this.moteGroup = null;
    this._moteMat = null;
    this._moteGeo = null;
    if (rig) this._buildMotes(rig);
  }

  _load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && typeof d === 'object') Object.assign(this.S, d);
    } catch {}
    if (!MIST_PRESETS[this.S.mist]) this.S.mist = '1/2';
    this.S.target = 'both';
    if (this.S.panoRot > 0 && !PANO_ROTS.includes(this.S.panoRot)) this.S.panoRot = 128;
    if (!PANO_AUTO_MODES.includes(this.S.panoAuto)) this.S.panoAuto = 'off';
  }

  _loadPanoList() {
    try {
      const a = JSON.parse(localStorage.getItem(PLIST_KEY) || '[]');
      if (Array.isArray(a)) this.panoList = a.filter(x => x && x.folder && x.name);
    } catch {}
  }

  savePanoList() {
    try { localStorage.setItem(PLIST_KEY, JSON.stringify(this.panoList)); } catch {}
    if (this.onChange) this.onChange(this.S);
  }

  addPano(folder, name) {
    if (!folder || !name) return this.panoList.length;
    this.panoList.push({ folder, name });
    this.savePanoList();
    return this.panoList.length;
  }

  removePano(idx) {
    if (idx < 0 || idx >= this.panoList.length) return;
    this.panoList.splice(idx, 1);
    if (this.panoIdx >= this.panoList.length) this.panoIdx = 0;
    this.savePanoList();
  }

  clearPanoList() {
    this.panoList = [];
    this.panoIdx = 0;
    this.savePanoList();
  }

  cyclePanoAuto() {
    const i = PANO_AUTO_MODES.indexOf(this.S.panoAuto);
    this.S.panoAuto = PANO_AUTO_MODES[(i + 1) % PANO_AUTO_MODES.length];
    this.markPanoStarted();
    this.save();
    return this.S.panoAuto;
  }

  markPanoStarted() {
    this.panoBarStart = this.barPhase;
    this.panoTimeStart = this.time;
  }

  nextPanoItem() {
    if (!this.panoList.length) return null;
    this.panoIdx = (this.panoIdx + 1) % this.panoList.length;
    return this.panoList[this.panoIdx];
  }

  shouldAutoBlend(skyVid) {
    const m = this.S.panoAuto;
    if (m === 'off' || this.panoBlending || this.panoList.length < 2) return false;
    if (m === 'end') {
      if (skyVid && isFinite(skyVid.duration) && skyVid.duration > 1.0) {
        return (this.time - this.panoTimeStart > 1.5) && (skyVid.currentTime >= skyVid.duration - 0.22);
      }
      return (this.barPhase - this.panoBarStart) >= 64;
    }
    if (m === '64b') return (this.barPhase - this.panoBarStart) >= 64;
    if (m === '128b') return (this.barPhase - this.panoBarStart) >= 128;
    if (m === '5m') return (this.time - this.panoTimeStart) >= 300;
    if (m === '10m') return (this.time - this.panoTimeStart) >= 600;
    return false;
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.S)); } catch {}
    if (this.onChange) this.onChange(this.S);
  }

  setMist(level) {
    if (!MIST_PRESETS[level]) return;
    this.S.mist = level;
    const p = MIST_PRESETS[level];
    this.S.soften = p.soften;
    this.S.grain = p.grain;
    this.save();
  }

  cycleMist() {
    const i = MIST_LEVELS.indexOf(this.S.mist);
    this.setMist(MIST_LEVELS[(i + 1) % MIST_LEVELS.length]);
    return this.S.mist;
  }

  cycleDof() {
    const i = DOF_MODES.indexOf(this.S.dof);
    this.S.dof = DOF_MODES[(i + 1) % DOF_MODES.length];
    this.save();
    return this.S.dof;
  }

  cycleMotes() {
    const i = MOTE_MODES.indexOf(this.S.motes);
    this.S.motes = MOTE_MODES[(i + 1) % MOTE_MODES.length];
    this.save();
    return this.S.motes;
  }

  set(k, v) {
    this.S[k] = v;
    this.save();
  }

  enabledFor() {
    return true;
  }

  _buildMotes(rig) {
    const N = 140;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const size = new Float32Array(N);
    let s = 1337;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      pos[i * 3 + 0] = (rnd() - 0.5) * 3.4;
      pos[i * 3 + 1] = rnd() * 2.35;
      pos[i * 3 + 2] = (rnd() - 0.5) * 3.2;
      seed[i] = rnd();
      size[i] = 0.035 + rnd() * 0.055;
    }
    const geo = this._moteGeo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const mat = this._moteMat = new THREE.ShaderMaterial({
      vertexShader: MOTE_VS, fragmentShader: MOTE_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: {
        uTime: { value: 0 }, uSpeed: { value: 1 }, uMode: { value: 1 },
        uColA: { value: new THREE.Color('#ffdca8') }, uColB: { value: new THREE.Color('#ff9d5c') },
        uOpacity: { value: 0.45 },
      }
    });
    const pts = this.moteGroup = new THREE.Points(geo, mat);
    pts.name = 'cyber_motes';
    pts.frustumCulled = false;
    pts.raycast = () => {};
    rig.add(pts);
  }

  // Called once per frame; bpm = active deck BPM (or 122 fallback)
  tick(dt, bpm = 122, macroDist = 99) {
    this.time += dt;
    const b = (bpm > 55 && bpm < 200) ? bpm : 122;
    this.barPhase += dt * (b / 240);   // 4 beats = 1 bar

    // Macro DoF amount for GoPro
    if (this.S.dof === 'off') this.lastMacroDof = 0;
    else if (this.S.dof === 'on') this.lastMacroDof = 0.85;
    else this.lastMacroDof = Math.max(0, Math.min(1, (0.85 - macroDist) / 0.55));   // auto kicks in < 0.85m

    // Update 3D Booth Dust Motes
    if (this.moteGroup && this._moteMat) {
      const m = this.S.motes;
      const on = m !== 'off' && this.S.moteDensity > 0.01;
      this.moteGroup.visible = on;
      if (on) {
        const u = this._moteMat.uniforms;
        u.uTime.value = this.time;
        u.uSpeed.value = 0.75 + 0.25 * Math.sin(this.barPhase * Math.PI * 0.25);   // gentle 8-bar swell
        u.uMode.value = m === 'embers' ? 2 : m === 'mist' ? 3 : 1;
        u.uOpacity.value = this.S.moteDensity * (this.S.haze ? 0.72 : 0.50);
        if (m === 'embers') { u.uColA.value.set('#ff8a3d'); u.uColB.value.set('#ff3b1f'); }
        else if (m === 'mist') { u.uColA.value.set('#a8e6ff'); u.uColB.value.set('#e2f6ff'); }
        else { u.uColA.value.set('#ffe2b0'); u.uColB.value.set('#ffb46b'); }
        this._moteGeo.setDrawRange(0, Math.max(10, Math.round(140 * this.S.moteDensity)));
      }
    }
  }

  // Returns { dTurnDeg, tint: THREE.Color, gainMul } for Anjunadeep bar-driven skybox evolution
  panoEvolution(dt, bpm = 120) {
    const b = (bpm > 55 && bpm < 200) ? bpm : 120;
    const barsPerSec = b / 240;
    const dTurnDeg = this.S.panoRot > 0 ? (360 / this.S.panoRot) * barsPerSec * dt : 0;

    // 32-bar smooth palette cycle
    const w32 = 0.5 - 0.5 * Math.cos(this.barPhase * (Math.PI * 2 / 32));
    if (this.S.panoGrade === 'sunset') {
      this._colA.setRGB(1.06, 0.95, 0.84);   // golden hour amber
      this._colB.setRGB(0.86, 0.84, 1.08);   // velvet Anjuna dusk
      this._tint.copy(this._colA).lerp(this._colB, w32);
    } else if (this.S.panoGrade === 'deep') {
      this._colA.setRGB(0.82, 1.02, 1.08);   // coastal teal
      this._colB.setRGB(0.95, 0.82, 1.12);   // deep twilight violet
      this._tint.copy(this._colA).lerp(this._colB, w32);
    } else {
      this._tint.setRGB(1, 1, 1);
    }

    // 8-bar gentle horizon breathing
    const gainMul = this.S.panoBreathe ? (1.0 + 0.055 * Math.sin(this.barPhase * (Math.PI * 2 / 8))) : 1.0;
    return { dTurnDeg, tint: this._tint, gainMul };
  }

  // Process GoPro / DJ CAM texture -> returns sRGB Texture (separate RT, never feedback-loops!)
  processGoPro(renderer, srcTex, w, h, hdr = true, flip = false) {
    const on = this.enabledFor('gopro');
    const p = MIST_PRESETS[this.S.mist] || MIST_PRESETS.off;
    const dof = on ? this.lastMacroDof : 0;
    return this._gpPass.run(renderer, srcTex, w, h, {
      hdr, flip,
      soften: on ? this.S.soften : 0,
      dof,
      thresh: p.thresh,
      halo: on ? p.halo : 0,
      veil: on ? p.veil : 0,
      grain: on ? this.S.grain : 0,
      ca: on && this.S.ca && this.S.mist !== 'off',
      time: this.time,
    });
  }

  processGoProRT(renderer, srcTex, w, h, hdr = true, flip = false) {
    this.processGoPro(renderer, srcTex, w, h, hdr, flip);
    return this._gpPass.lastRT;
  }

  // Process HEADSET CAM composited texture -> returns RT (or null when bypassed)
  processHeadsetRT(renderer, srcTex, w, h) {
    if (!this.enabledFor('hcam')) return null;
    const p = MIST_PRESETS[this.S.mist] || MIST_PRESETS.off;
    const dof = this.S.hcBokeh ? 0.35 : 0;
    if (p.halo <= 0.001 && p.veil <= 0.001 && this.S.grain <= 0.0005 && !this.S.ca && dof <= 0.01 && this.S.soften <= 0.02) return null;
    this._hcPass.run(renderer, srcTex, w, h, {
      hdr: false, flip: false,
      soften: this.S.soften * 0.45,
      dof,
      thresh: p.thresh,
      halo: p.halo,
      veil: p.veil,
      grain: this.S.grain,
      ca: this.S.ca && this.S.mist !== 'off',
      time: this.time,
    });
    return this._hcPass.lastRT;
  }
}
