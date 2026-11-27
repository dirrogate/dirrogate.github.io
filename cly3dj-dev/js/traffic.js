// Laser-Placed 3D Sky Traffic Lanes & Slow Hulking Overhead Cruisers for DirroDJ (MOVIE PROPS > SKY TRAFFIC).
// PBR MeshStandardMaterial hulls receive real SkyDome scene.environment IBL reflections + key light,
// with injected distance haze & equirectangular rising fog wisps so vehicles dissolve naturally into the sky.
// Supports a 3-class assortment (Spinner, Twin-Hull Shuttle, Slow Hulking Cruiser) with staggered 2-5 min appearances.
import * as THREE from 'three';

const KEY = 'vire.skytraffic';
const MAX_CARS = 96;
const MAX_CRUISERS = 4;
const USER_LAYER = 6;

function buildBoxGeo(parts) {
  const v = [];
  const pushBox = (cx, cy, cz, sx, sy, sz, noseTaper = 1.0) => {
    const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
    const nx = hx * noseTaper, ny = hy * (0.55 + 0.45 * noseTaper);
    const c = [
      [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz],
      [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
      [cx - nx, cy - ny, cz + hz], [cx + nx, cy - ny, cz + hz],
      [cx + nx, cy + ny, cz + hz], [cx - nx, cy + ny, cz + hz],
    ];
    const q = (a, b, d, e) => { v.push(...c[a], ...c[b], ...c[d], ...c[a], ...c[d], ...c[e]); };
    q(0, 3, 2, 1); q(4, 5, 6, 7); q(3, 7, 6, 2); q(0, 1, 5, 4); q(0, 4, 7, 3); q(1, 2, 6, 5);
  };
  for (const p of parts) pushBox(...p);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

// Class 0: Sleek Blade Runner Spinner
const makeSpinnerGeo = () => buildBoxGeo([
  [0, 0.0, 0.0, 0.42, 0.14, 1.05, 0.52],
  [0, 0.09, -0.05, 0.26, 0.09, 0.50, 0.62],
  [-0.27, -0.03, -0.10, 0.14, 0.11, 0.70, 0.72],
  [ 0.27, -0.03, -0.10, 0.14, 0.11, 0.70, 0.72],
]);

// Class 1: Twin-Hull Industrial Shuttle
const makeShuttleGeo = () => buildBoxGeo([
  [-0.26, 0.0, 0.0, 0.24, 0.22, 1.35, 0.78],
  [ 0.26, 0.0, 0.0, 0.24, 0.22, 1.35, 0.78],
  [ 0.0,  0.04, -0.08, 0.34, 0.16, 0.85, 0.90],
  [ 0.0,  0.14, -0.22, 0.22, 0.10, 0.42, 0.80],
]);

// Class 2: Massive Slow Hulking Overhead Cruiser / Heavy Freighter (scaled ~3.5-5x!)
const makeCruiserGeo = () => buildBoxGeo([
  [0, 0.0, 0.0, 0.88, 0.34, 2.40, 0.68],      // armored main hull
  [0, -0.18, -0.10, 0.62, 0.18, 1.85, 0.82],  // lower cargo belly
  [0,  0.22, -0.45, 0.42, 0.18, 0.85, 0.75],  // aft command bridge
  [-0.56, -0.04, -0.55, 0.28, 0.24, 1.10, 0.85], // port heavy thruster pod
  [ 0.56, -0.04, -0.55, 0.28, 0.24, 1.10, 0.85], // starboard heavy thruster pod
  [0,  0.14,  0.55, 0.30, 0.12, 0.70, 0.55],  // forward sensor prow
]);

// Soft misty headlight/tail-light card (no harsh neon plastic streaks!)
function makeLightGeo() {
  const v = [], uv = [];
  const addQuad = (p0, p1, p2, p3) => {
    v.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
  };
  addQuad([-0.46, 0, -2.0], [0.46, 0, -2.0], [0.46, 0, 0.85], [-0.46, 0, 0.85]);
  addQuad([0, -0.28, -2.0], [0, 0.28, -2.0], [0, 0.28, 0.85], [0, -0.28, 0.85]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// PBR MeshStandardMaterial with injected SkyDome distance haze + equirectangular rising fog + lane-edge fade
function makePbrHullMat(uniforms) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a1f28,
    roughness: 0.48,
    metalness: 0.62,
    transparent: true,
    opacity: 1.0,
  });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uFogCol = uniforms.uFogCol;
    sh.uniforms.uFogAmt = uniforms.uFogAmt;
    sh.uniforms.uRiseFog = uniforms.uRiseFog;
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aEdgeFade;\nvarying vec3 vTWp;\nvarying float vEdgeFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdgeFade = aEdgeFade;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTWp = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uFogCol; uniform float uFogAmt; uniform float uRiseFog; uniform float uTime;
varying vec3 vTWp; varying float vEdgeFade;
float tfH21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float tfPnoise(vec2 p, float px) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, px), x1 = mod(i.x + 1.0, px);
  return mix(mix(tfH21(vec2(x0, i.y)), tfH21(vec2(x1, i.y)), f.x), mix(tfH21(vec2(x0, i.y + 1.0)), tfH21(vec2(x1, i.y + 1.0)), f.x), f.y);
}`)
      .replace('#include <dithering_fragment>', `
        vec3 toCar = vTWp - cameraPosition;
        float dist = length(toCar);
        vec3 d = toCar / max(dist, 0.001);
        float fog = 1.0 - exp(-dist * (0.045 + 0.115 * uFogAmt));
        // Equirectangular rising mist wisps (matches MONOLITH rising fog!)
        if (uRiseFog > 0.01) {
          float az = fract(atan(d.z, d.x) / 6.2831853);
          float el = asin(clamp(d.y, -1.0, 1.0));
          float wisp = tfPnoise(vec2(az * 12.0, el * 6.0 - uTime * 0.18), 12.0);
          float rMask = smoothstep(0.65, -0.35, el) * smoothstep(0.28, 0.82, wisp) * uRiseFog * 0.55;
          fog = clamp(fog + rMask, 0.0, 0.94);
        }
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogCol, clamp(fog, 0.0, 0.94));
        gl_FragColor.a *= vEdgeFade;
        if (gl_FragColor.a < 0.01) discard;
        #include <dithering_fragment>`);
  };
  mat.customProgramCacheKey = () => 'skytraffic_pbr_v2';
  return mat;
}

const LIGHT_VS = /* glsl */`
attribute float aEdgeFade;
varying vec2 vUv;
varying vec3 vTWp;
varying float vEdgeFade;
void main() {
  vUv = uv;
  vEdgeFade = aEdgeFade;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vTWp = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const LIGHT_FS = /* glsl */`precision highp float;
uniform float uFogAmt;
uniform float uRiseFog;
uniform float uTime;
varying vec2 vUv;
varying vec3 vTWp;
varying float vEdgeFade;
float tlH21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  float x = abs(vUv.x - 0.5) * 2.0, y = vUv.y;
  // Subtle misty crimson tail-lights & short trail (dialed back to blend naturally in haze!)
  float tailPos = smoothstep(0.05, 0.68, y) * smoothstep(0.75, 0.66, y);
  float tailRail = exp(-abs(x - 0.36) * 9.0) * 0.42;
  float tailCore = exp(-length(vec2((x - 0.36) * 4.0, (y - 0.66) * 15.0)) * 2.8);
  vec3 redTrail = vec3(1.15, 0.12, 0.08) * (tailPos * tailRail + tailCore * 0.85);

  // Subtle cool-white headlights
  float headGlow = exp(-length(vec2((x - 0.28) * 4.2, (y - 0.83) * 10.0)) * 2.6);
  float headBeam = smoothstep(0.76, 0.88, y) * smoothstep(1.0, 0.82, y) * exp(-x * 4.8) * 0.25;
  vec3 frontCol = vec3(0.55, 0.82, 1.15) * (headGlow * 0.78 + headBeam);

  vec3 col = redTrail + frontCol;
  vec3 toCar = vTWp - cameraPosition;
  float dist = length(toCar);
  float vis = exp(-dist * (0.032 + 0.075 * uFogAmt)) * vEdgeFade;
  if (uRiseFog > 0.01) {
    vec3 d = toCar / max(dist, 0.001);
    float el = asin(clamp(d.y, -1.0, 1.0));
    vis *= (1.0 - smoothstep(0.55, -0.30, el) * uRiseFog * 0.42);
  }
  col *= vis;
  float lum = max(col.r, max(col.g, col.b));
  if (lum < 0.008) discard;
  gl_FragColor = vec4(col, clamp(lum, 0.0, 0.90));
}`;

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _vA = new THREE.Vector3(), _vB = new THREE.Vector3(), _pos = new THREE.Vector3(), _pos2 = new THREE.Vector3();
const _fwd = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _rt = new THREE.Vector3(), _rotM = new THREE.Matrix4();

function slerpDir(a, b, t, out) {
  const dot = Math.max(-0.999, Math.min(0.999, a.dot(b)));
  const theta = Math.acos(dot);
  if (theta < 1e-4) return out.copy(a).lerp(b, t).normalize();
  const s = Math.sin(theta);
  return out.set(
    a.x * (Math.sin((1 - t) * theta) / s) + b.x * (Math.sin(t * theta) / s),
    a.y * (Math.sin((1 - t) * theta) / s) + b.y * (Math.sin(t * theta) / s),
    a.z * (Math.sin((1 - t) * theta) / s) + b.z * (Math.sin(t * theta) / s)
  ).normalize();
}

export class SkyTraffic {
  constructor(rig) {
    this.rig = rig;
    this.group = new THREE.Group();
    this.group.name = 'sky_traffic';
    this.rig.add(this.group);

    this.on = true;
    this.cruiserOn = true;   // Slow hulking overhead cruiser appearing every ~2-4 min!
    this.lanes = [];
    this.sel = -1;
    this.armMode = null;
    this._tempA = null;
    this._time = 0;

    this.sharedU = {
      uFogCol:  { value: new THREE.Color(0.06, 0.08, 0.11) },
      uFogAmt:  { value: 0.35 },
      uRiseFog: { value: 0.0 },
      uTime:    { value: 0.0 },
    };

    this.hullMat = makePbrHullMat(this.sharedU);
    this.lightMat = new THREE.ShaderMaterial({
      vertexShader: LIGHT_VS,
      fragmentShader: LIGHT_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      uniforms: { uFogAmt: this.sharedU.uFogAmt, uRiseFog: this.sharedU.uRiseFog, uTime: this.sharedU.uTime },
    });

    const mkInst = (geo, mat, max, order) => {
      const m = new THREE.InstancedMesh(geo, mat, max);
      const fades = new Float32Array(max).fill(1);
      geo.setAttribute('aEdgeFade', new THREE.InstancedBufferAttribute(fades, 1));
      m.count = 0; m.frustumCulled = false; m.raycast = () => {}; m.renderOrder = order;
      this.group.add(m);
      return { mesh: m, fades };
    };

    // 3 distinct vehicle classes + shared soft lights
    this.spinners = mkInst(makeSpinnerGeo(), this.hullMat, MAX_CARS, 1002);
    this.shuttles = mkInst(makeShuttleGeo(), this.hullMat, MAX_CARS, 1002);
    this.cruisers = mkInst(makeCruiserGeo(), this.hullMat, MAX_CRUISERS, 1002);
    this.lights   = mkInst(makeLightGeo(),   this.lightMat, MAX_CARS + MAX_CRUISERS, 1003);

    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(33 * 3), 3));
    this.previewLine = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: 0x36e6ff, transparent: true, opacity: 0.85 }));
    this.previewLine.layers.set(USER_LAYER);
    this.previewLine.visible = false;
    this.previewLine.frustumCulled = false;
    this.previewLine.raycast = () => {};
    this.group.add(this.previewLine);

    this.load();
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ on: this.on, cruiserOn: this.cruiserOn, lanes: this.lanes })); } catch {}
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && typeof s === 'object') {
        if (typeof s.on === 'boolean') this.on = s.on;
        if (typeof s.cruiserOn === 'boolean') this.cruiserOn = s.cruiserOn;
        if (Array.isArray(s.lanes)) this.lanes = s.lanes;
        if (this.lanes.length) this.sel = 0;
      }
    } catch {}
    this.group.visible = this.on && (this.lanes.length > 0 || this.cruiserOn);
  }

  addLane(dirA, dirB, opts = {}) {
    const a = new THREE.Vector3().fromArray(dirA).normalize();
    const b = new THREE.Vector3().fromArray(dirB).normalize();
    const lane = {
      id: Date.now() + Math.floor(Math.random() * 999),
      dirA: a.toArray(), dirB: b.toArray(),
      dist: opts.dist ?? 17,
      count: opts.count ?? 10,
      speed: opts.speed ?? 0.045,
      scale: opts.scale ?? 0.48,
      twoWay: opts.twoWay !== false,
    };
    this.lanes.push(lane);
    this.sel = this.lanes.length - 1;
    this.on = true;
    this.group.visible = true;
    this.save();
    return lane;
  }

  addDemoLane() {
    const idx = this.lanes.length % 3;
    const presets = [
      { a: [-0.88, 0.28, -0.38], b: [0.88, 0.34, -0.32], dist: 18, count: 10, speed: 0.045, scale: 0.48 },
      { a: [0.75, 0.56, -0.32],  b: [-0.72, 0.50, -0.45], dist: 16, count: 8,  speed: 0.055, scale: 0.42 },
      { a: [-0.45, 0.84, -0.30], b: [0.48, 0.82, 0.32],   dist: 15, count: 6,  speed: 0.040, scale: 0.40 },
    ];
    return this.addLane(presets[idx].a, presets[idx].b, presets[idx]);
  }

  removeLane(i) {
    if (i < 0 || i >= this.lanes.length) return;
    this.lanes.splice(i, 1);
    this.sel = Math.min(this.sel, this.lanes.length - 1);
    this.group.visible = this.on && (this.lanes.length > 0 || this.cruiserOn);
    this.save();
  }

  clearAll() {
    this.lanes = []; this.sel = -1; this.armMode = null; this._tempA = null;
    this.previewLine.visible = false;
    this.group.visible = this.on && this.cruiserOn;
    this.save();
  }

  startLaserPlace() { this.armMode = 'A'; this._tempA = null; this.previewLine.visible = false; this.group.visible = true; }
  cancelLaserPlace() { this.armMode = null; this._tempA = null; this.previewLine.visible = false; this.group.visible = this.on && (this.lanes.length > 0 || this.cruiserOn); }

  updatePreview(aimDir) {
    if (this.armMode !== 'B' || !this._tempA || !aimDir) { this.previewLine.visible = false; return; }
    const b = _vB.copy(aimDir).normalize();
    const posAttr = this.previewLine.geometry.getAttribute('position');
    for (let i = 0; i <= 32; i++) {
      slerpDir(this._tempA, b, i / 32, _pos).multiplyScalar(16);
      posAttr.setXYZ(i, _pos.x, _pos.y + 1.5, _pos.z);
    }
    posAttr.needsUpdate = true;
    this.previewLine.visible = true;
  }

  capturePoint(dir) {
    if (!this.armMode || !dir) return null;
    const d = new THREE.Vector3().copy(dir).normalize();
    if (this.armMode === 'A') { this._tempA = d; this.armMode = 'B'; return 'A'; }
    if (this.armMode === 'B' && this._tempA) {
      const lane = this.addLane(this._tempA.toArray(), d.toArray());
      this.armMode = null; this._tempA = null; this.previewLine.visible = false;
      return lane;
    }
    return null;
  }

  setAtmosphere(fogCol, haze = 0.35, mul = 1.0, riseFog = 0.0) {
    if (fogCol) this.sharedU.uFogCol.value.copy(fogCol).multiplyScalar(mul);
    this.sharedU.uFogAmt.value = haze;
    this.sharedU.uRiseFog.value = riseFog;
  }

  _placeInst(bucket, idx, mat4, fade) {
    bucket.mesh.setMatrixAt(idx, mat4);
    bucket.fades[idx] = fade;
  }

  tick(dt) {
    const active = this.on && (this.lanes.length > 0 || this.cruiserOn);
    if (!active) {
      this.spinners.mesh.count = this.shuttles.mesh.count = this.cruisers.mesh.count = this.lights.mesh.count = 0;
      return;
    }
    this.group.visible = true;
    this._time += dt;
    this.sharedU.uTime.value = this._time;

    let nSpin = 0, nShut = 0, nCruis = 0, nLit = 0;

    // 1. Staggered small/medium traffic lanes (constant true physical scale — atmospheric opacity fade at lane ends!)
    for (let li = 0; li < this.lanes.length; li++) {
      const L = this.lanes[li];
      _vA.fromArray(L.dirA).normalize();
      _vB.fromArray(L.dirB).normalize();
      // Normalize speed by arc length so short & long lanes travel at true constant physical world speed!
      const arcRad = Math.max(0.25, Math.acos(Math.max(-0.999, Math.min(0.999, _vA.dot(_vB)))));
      const count = Math.min(L.count || 8, MAX_CARS);

      for (let ci = 0; ci < count; ci++) {
        const seed = li * 73.1 + ci * 19.7;
        const h1 = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
        const h2 = Math.abs(Math.sin(seed * 78.233) * 43758.5453) % 1;
        const isShuttle = h2 > 0.62;
        const rev = L.twoWay && (ci % 2 === 1);
        const spd = ((L.speed || 0.045) * 1.4 / arcRad) * (0.82 + 0.36 * h1);
        let u = (this._time * spd + ci / Math.max(1, count) + h2 * 0.25) % 1.0;
        if (rev) u = 1.0 - u;

        const R = (L.dist || 17) + (h1 - 0.5) * 2.0 + (rev ? 0.8 : -0.8);
        slerpDir(_vA, _vB, u, _pos).multiplyScalar(R);
        _pos.y += 1.5 + (h2 - 0.5) * 1.0;
        const uNext = rev ? Math.max(0.0, u - 0.01) : Math.min(1.0, u + 0.01);
        slerpDir(_vA, _vB, uNext, _pos2).multiplyScalar(R);
        _pos2.y += 1.5 + (h2 - 0.5) * 1.0;

        _fwd.subVectors(_pos2, _pos);
        if (_fwd.lengthSq() < 1e-6) _fwd.set(1, 0, 0); else _fwd.normalize();
        _rt.crossVectors(_up, _fwd);
        if (_rt.lengthSq() < 1e-4) _rt.set(1, 0, 0); else _rt.normalize();
        const localUp = _pos2.crossVectors(_fwd, _rt).normalize();
        _rotM.makeBasis(_rt, localUp, _fwd);
        _q.setFromRotationMatrix(_rotM);

        // Constant physical scale (NO scale-popping looming illusion!) + smooth atmospheric fade at lane ends
        const edgeFade = Math.min(1, u * 10, (1 - u) * 10);
        const sc = (L.scale || 0.48) * (0.88 + 0.24 * h2);
        _s.setScalar(sc);
        _m4.compose(_pos, _q, _s);

        if (isShuttle && nShut < MAX_CARS) this._placeInst(this.shuttles, nShut++, _m4, edgeFade);
        else if (nSpin < MAX_CARS) this._placeInst(this.spinners, nSpin++, _m4, edgeFade);
        if (nLit < MAX_CARS + MAX_CRUISERS) this._placeInst(this.lights, nLit++, _m4, edgeFade);
      }
    }

    // 2. Slow Hulking Overhead Cruiser: appears randomly every ~2.5 minutes, drifting majestically across the upper dome/skylight!
    if (this.cruiserOn && nCruis < MAX_CRUISERS) {
      const cycleSec = 150.0; // 2.5-minute stately cadence
      const slot = Math.floor(this._time / cycleSec);
      const u = (this._time % cycleSec) / cycleSec;
      // Visible during first 55% of the cycle (~82 seconds of slow glacial overhead transit), quiet gap the rest
      if (u < 0.58) {
        const t = u / 0.58;
        const hA = Math.abs(Math.sin((slot + 1.3) * 91.7) * 43758.5453) % 1;
        const ang = hA * Math.PI * 2;
        _vA.set(Math.cos(ang), 0.42, Math.sin(ang)).normalize();
        _vB.set(-Math.cos(ang + 0.35), 0.46, -Math.sin(ang + 0.35)).normalize();
        const R = 19.5;
        slerpDir(_vA, _vB, t, _pos).multiplyScalar(R); _pos.y += 1.5;
        slerpDir(_vA, _vB, Math.min(1, t + 0.01), _pos2).multiplyScalar(R); _pos2.y += 1.5;
        _fwd.subVectors(_pos2, _pos).normalize();
        _rt.crossVectors(_up, _fwd).normalize();
        const localUp = _pos2.crossVectors(_fwd, _rt).normalize();
        _rotM.makeBasis(_rt, localUp, _fwd);
        _q.setFromRotationMatrix(_rotM);
        const edgeFade = Math.min(1, t * 8, (1 - t) * 8);
        _s.setScalar(2.4); // massive slow hulking silhouette!
        _m4.compose(_pos, _q, _s);
        this._placeInst(this.cruisers, nCruis++, _m4, edgeFade);
        if (nLit < MAX_CARS + MAX_CRUISERS) this._placeInst(this.lights, nLit++, _m4, edgeFade * 0.85);
      }
    }

    for (const [b, cnt] of [[this.spinners, nSpin], [this.shuttles, nShut], [this.cruisers, nCruis], [this.lights, nLit]]) {
      b.mesh.count = cnt;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.mesh.geometry.getAttribute('aEdgeFade').needsUpdate = true;
    }
  }

  dispose() {
    for (const b of [this.spinners, this.shuttles, this.cruisers, this.lights]) b.mesh.geometry.dispose();
    this.hullMat.dispose(); this.lightMat.dispose();
    this.previewLine.geometry.dispose(); this.previewLine.material.dispose();
  }
}
