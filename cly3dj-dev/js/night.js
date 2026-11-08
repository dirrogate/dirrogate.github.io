// #612 NIGHT LOOK: makes the real (passthrough) room read as night under the dome. It can't relight the real room, so
// it draws a see-through layer over the real surfaces that darkens and tints them (premultiplied: added light + how
// much of the camera picture shows through), brighter where the moon reaches them through the PANO frames' openings
// (and between bamboo / wood slats: moon stripes), warm or neon near a glow, never inside a PANO opening (the sky).
// Surfaces: the Quest's room mesh (WebXR mesh-detection, from Space Setup) or, with ROOM MESH off / no mesh, the floor
// plus a big shell round the DJ (grade and glow only). Drawn only in the headset's own eyes (and the desktop view),
// never into the stream's other cameras. One draw per mesh; per pixel a few lookups.
import * as THREE from 'three';

export const NIGHT0 = { on: false, grade: true, moon: true, stripes: true, glow: true, mesh: true, beams: true, dust: false, bstr: 0.6, dstr: 0.6, str: 0.45, hue: 220, sat: 0.55, ghue: 30, gstr: 0.6, gdir: 270, soft: 1, clear: 0.5, src: 'dome', preset: 'goa' };
export const NIGHT_PRESETS = {
  goa: { on: true, grade: true, moon: true, stripes: true, glow: true, beams: true, str: 0.45, hue: 220, sat: 0.55, ghue: 30, gstr: 0.6, soft: 1, src: 'dome', eaves: true, posts: true },
  cyber: { on: true, grade: true, moon: true, stripes: true, glow: true, beams: true, str: 0.55, hue: 270, sat: 0.6, ghue: 310, gstr: 0.7, soft: 0, src: 'dome', eaves: false, posts: false },
};
const KEY = 'vire.night', SLOTS = 6, MW = 512;

const VS = `uniform float uOn; varying vec3 vW;
void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = uOn > 0.5 ? projectionMatrix * viewMatrix * vec4(vW, 1.0) : vec4(2.0, 2.0, 2.0, 1.0); }`;
const FS = `uniform mat4 portalInv[${SLOTS}]; uniform vec2 portalHalf[${SLOTS}]; uniform vec2 portalR[${SLOTS}]; uniform float portalRev[${SLOTS}]; uniform int portalN;
uniform sampler2D uSlat; uniform vec4 uSlatInfo[${SLOTS}];   // x: 1 = slats, y: 1 = slats laid out across the frame's y, z: half extent of that axis
uniform float uStr, uGrade, uMoonOn, uStripes, uSoft, uClear, uGlowOn, uGStr, uShell;
uniform vec3 uTint, uMoon, uGlowPos, uGlowCol;
varying vec3 vW;
float sdR(vec2 p, vec2 h, vec2 r) { float rr = p.y > 0.0 ? r.x : r.y; vec2 d = abs(p) - h + rr; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - rr; }
void main() {
  vec3 P = vW, N = normalize(cross(dFdx(P), dFdy(P))); if (dot(N, cameraPosition - P) < 0.0) N = -N;
  float lit = 0.0;
  for (int i = 0; i < ${SLOTS}; i++) {
    if (i >= portalN) break;
    if (portalRev[i] < 0.5) continue;                               // only PANO frames open onto the sky
    vec3 pc = (portalInv[i] * vec4(cameraPosition, 1.0)).xyz, pf = (portalInv[i] * vec4(P, 1.0)).xyz;
    if (pc.z * pf.z < 0.0) { vec2 q = mix(pc.xy, pf.xy, pc.z / (pc.z - pf.z)); if (sdR(q, portalHalf[i], portalR[i]) < 0.0) discard; }   // the sky shows here
    if (uMoonOn > 0.5 && uShell < 0.5) {                           // moon through this opening onto P
      vec3 dm = (portalInv[i] * vec4(P + uMoon, 1.0)).xyz - pf;
      if (abs(dm.z) > 1e-4) { float t = -pf.z / dm.z; if (t > 0.0) {
        vec2 q = pf.xy + dm.xy * t; float sw = 0.01 + (0.004 + uSoft * 0.012) * t;
        float e = 1.0 - smoothstep(-sw, sw, sdR(q, portalHalf[i], portalR[i]));
        vec4 si = uSlatInfo[i];
        if (si.x > 0.5 && uStripes > 0.5) { float c = (si.y > 0.5 ? q.y : q.x) / (2.0 * si.z) + 0.5; e *= textureLod(uSlat, vec2(c, (float(i) + 0.5) / 8.0), uSoft * 1.5).r; }
        lit = max(lit, e); } }
    }
  }
  float clear = smoothstep(uClear, uClear + 0.35, length((P - cameraPosition).xz));
  float moon = uMoonOn * (uShell > 0.5 ? 0.0 : max(dot(N, uMoon), 0.0) * lit * clear);
  vec3 gd = uGlowPos - P; float gl = length(gd);
  float glow = uGlowOn * uGStr / (1.0 + gl * gl * 0.9) * (uShell > 0.5 ? 0.6 : max(dot(N, gd / max(gl, 1e-3)) * 0.7 + 0.3, 0.0));
  float a = uGrade * uStr * (1.0 - clamp(moon * 0.8 + glow * 0.9, 0.0, 0.9));
  vec3 moonCol = mix(vec3(0.82, 0.88, 1.0), uTint, 0.35);
  vec3 add = uGrade * uTint * uStr * 0.10 * (1.0 - moon) + moonCol * moon * 0.12 + uGlowCol * glow * 0.32;
  gl_FragColor = vec4(add, a);
}`;

// #625 MOONBEAMS: per PANO frame one skewed prism from the opening down to the floor along the moon (12 triangles),
// drawn additive and double-sided: each pixel traces back toward the moon to the opening, so the shaft has the
// opening's shape, the slats' stripes and soft edges, fades with distance and near the floor, with a slow haze drift.
// DUST: 220 motes per beam, moved in the vertex shader (no CPU per frame), lit only where they sit inside the shaft.
const BEAM_VS = `uniform float uOn; varying vec3 vW; void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = uOn > 0.5 ? projectionMatrix * viewMatrix * vec4(vW, 1.0) : vec4(2.0, 2.0, 2.0, 1.0); }`;
const SHAFT = `uniform mat4 portalInv[${SLOTS}]; uniform vec2 portalHalf[${SLOTS}]; uniform vec2 portalR[${SLOTS}];
uniform sampler2D uSlat; uniform vec4 uSlatInfo[${SLOTS}]; uniform vec3 uMoon; uniform float uSoft, uStripes; uniform int uIdx;
float sdR(vec2 p, vec2 h, vec2 r) { float rr = p.y > 0.0 ? r.x : r.y; vec2 d = abs(p) - h + rr; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - rr; }
vec2 shaft(vec3 P) {   // x: how much moonlight reaches P through opening uIdx, y: distance back to the opening (m)
  mat4 M = portalInv[0]; vec2 H = portalHalf[0], R = portalR[0]; vec4 si = uSlatInfo[0];
  for (int i = 1; i < ${SLOTS}; i++) if (i == uIdx) { M = portalInv[i]; H = portalHalf[i]; R = portalR[i]; si = uSlatInfo[i]; }
  vec3 pf = (M * vec4(P, 1.0)).xyz, dm = (M * vec4(P + uMoon, 1.0)).xyz - pf;
  if (abs(dm.z) < 1e-4) return vec2(0.0); float t = -pf.z / dm.z; if (t <= 0.0) return vec2(0.0);
  vec2 q = pf.xy + dm.xy * t; float sw = 0.012 + (0.004 + uSoft * 0.012) * t;
  float e = 1.0 - smoothstep(-sw, sw, sdR(q, H, R));
  if (si.x > 0.5 && uStripes > 0.5) { float c = (si.y > 0.5 ? q.y : q.x) / (2.0 * si.z) + 0.5; e *= textureLod(uSlat, vec2(c, (float(uIdx) + 0.5) / 8.0), uSoft * 1.5).r; }
  return vec2(e, t);
}`;
const BEAM_FS = SHAFT + `
uniform float uBStr, uT, uFloorY; uniform vec3 uBeamCol; varying vec3 vW;
void main() {   // far side of the prism only: march back toward the eye through the shaft (12 steps, up to 3.5 m)
  vec3 dir = cameraPosition - vW; float len = min(length(dir), 3.5); dir = normalize(dir);
  float st = len / 12.0, acc = 0.0;
  for (int k = 0; k < 12; k++) {
    vec3 P = vW + dir * (float(k) + 0.5) * st;
    vec2 s = shaft(P); if (s.x < 0.002) continue;
    float fade = exp(-s.y * 0.32) * smoothstep(0.0, 0.25, s.y) * smoothstep(0.0, 0.35, P.y - uFloorY);
    float haze = 0.72 + 0.28 * sin(P.x * 2.3 + uT * 0.21) * sin(P.z * 1.9 - uT * 0.17) * sin(P.y * 3.1 + uT * 0.11);
    acc += s.x * fade * haze * st;
  }
  if (acc < 0.0005) discard;
  gl_FragColor = vec4(uBeamCol * acc * uBStr * 0.34, 0.0);
}`;
const DUST_VS = SHAFT + `
uniform float uOn, uT, uDStr; uniform vec3 uO, uX, uY, uD; attribute vec4 aR; varying float vB;
void main() {
  float t = fract(aR.z + uT * 0.006 * (0.5 + aR.w)), u = fract(aR.x + 0.02 * sin(uT * 0.3 + aR.w * 9.0)), v = fract(aR.y + 0.02 * cos(uT * 0.25 + aR.w * 7.0));
  vec3 P = uO + uX * (u * 2.2 - 1.1) + uY * (v * 2.2 - 1.1) + uD * t;
  vec2 s = shaft(P); vB = s.x * (0.5 + 0.5 * sin(uT * (1.0 + aR.w * 2.0) + aR.w * 30.0)) * uDStr * smoothstep(0.0, 0.2, s.y);
  vec4 mv = viewMatrix * vec4(P, 1.0); gl_Position = uOn > 0.5 && vB > 0.01 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = clamp(9.0 / max(-mv.z, 0.2), 1.5, 9.0);
}`;
const DUST_FS = `uniform vec3 uBeamCol; varying float vB; void main() { vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(c)); gl_FragColor = vec4(uBeamCol * a * vB * 1.1, 0.0); }`;
const DUST_N = 220;

const _bv1 = new THREE.Vector3(), _bv2 = new THREE.Vector3(), _bv3 = new THREE.Vector3(), _bv4 = new THREE.Vector3(), _bv5 = new THREE.Vector3(), _bv6 = new THREE.Vector3(), _bm1 = new THREE.Matrix4();
export class NightLook {
  constructor(rig, portals, mainCam) {
    this.rig = rig; this.portals = portals; this.mainCam = mainCam; this.S = { ...NIGHT0 }; this.moonDir = new THREE.Vector3(0.3, 0.8, -0.5).normalize();
    try { Object.assign(this.S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
    this.group = new THREE.Group(); this.group.name = 'nightLook'; rig.add(this.group);
    this.mask = new THREE.DataTexture(new Uint8Array(MW * 8 * 4).fill(255), MW, 8, THREE.RGBAFormat); this.mask.magFilter = THREE.LinearFilter; this.mask.minFilter = THREE.LinearMipmapLinearFilter; this.mask.generateMipmaps = true; this.mask.needsUpdate = true;
    this.slatInfo = Array.from({ length: SLOTS }, () => new THREE.Vector4()); this._slatV = '';
    const pu = portals._u;
    this.u = { portalInv: pu.portalInv, portalHalf: pu.portalHalf, portalR: pu.portalR, portalRev: pu.portalRev, portalN: pu.portalN,
      uSlat: { value: this.mask }, uSlatInfo: { value: this.slatInfo }, uStr: { value: 0 }, uGrade: { value: 1 }, uMoonOn: { value: 1 }, uStripes: { value: 1 }, uSoft: { value: 1 }, uClear: { value: 0.5 },
      uGlowOn: { value: 1 }, uGStr: { value: 0.6 }, uTint: { value: new THREE.Color() }, uMoon: { value: new THREE.Vector3(0, 1, 0) }, uGlowPos: { value: new THREE.Vector3() }, uGlowCol: { value: new THREE.Color() } };
    this.mat = this._mat(0); this.shellMat = this._mat(1);
    // fallback surfaces: the floor + a shell round the DJ
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24).rotateX(-Math.PI / 2), this.mat); this.floor.position.y = 0.003;
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(7, 32, 16), this.shellMat);
    for (const m of [this.floor, this.shell]) { m.renderOrder = 2; m.frustumCulled = false; m.raycast = () => {}; this._gate(m); this.group.add(m); }
    this.meshes = new Map(); this.meshN = 0; this.meshTris = 0;
    this.beamU = { uBStr: { value: 0.6 }, uDStr: { value: 0.6 }, uT: { value: 0 }, uFloorY: { value: 0 }, uBeamCol: { value: new THREE.Color(0.82, 0.88, 1.0) } };   // #625
    this.beams = [];
    this.apply();
  }
  _mat(shell) {
    return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      uniforms: { ...this.u, uOn: { value: 1 }, uShell: { value: shell } } });
  }
  _gate(m) {   // headset eyes (or the plain desktop view) only; never the stream's / other cameras' render targets
    m.onBeforeRender = (r, s, cam) => {
      const xc = r.xr.enabled && r.xr.isPresenting ? r.xr.getCamera() : null, ok = xc ? (xc.cameras && xc.cameras.includes(cam)) || cam === xc : (cam === this.mainCam && !r.getRenderTarget());
      m.material.uniforms.uOn.value = ok ? 1 : 0;
    };
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.S)); } catch {} }
  set(k, v) { this.S[k] = v; if (k !== 'preset') this.S.preset = ''; this.save(); this.apply(); }
  preset(name) {
    if (name === 'off') { this.S.on = false; this.S.preset = 'off'; }
    else { const p = NIGHT_PRESETS[name]; if (!p) return; const { eaves, posts, ...rest } = p; Object.assign(this.S, rest); this.S.preset = name; if (this.portals) { this.portals.bamboo.eaves = eaves; this.portals.bamboo.posts = posts; this.portals.setBamboo('eaves', eaves); } }
    this.save(); this.apply();
  }
  apply() {
    const S = this.S, U = this.u;
    U.uStr.value = S.str; U.uGrade.value = S.grade ? 1 : 0; U.uMoonOn.value = S.moon ? 1 : 0; U.uStripes.value = S.stripes ? 1 : 0; U.uSoft.value = S.soft; U.uClear.value = S.clear;
    U.uGlowOn.value = S.glow ? 1 : 0; U.uGStr.value = S.gstr;
    U.uTint.value.setHSL(S.hue / 360, S.sat, 0.5); U.uGlowCol.value.setHSL(S.ghue / 360, 0.85, 0.55);
    const a = S.gdir * Math.PI / 180; U.uGlowPos.value.set(Math.sin(a) * 2.6, 0.45, -Math.cos(a) * 2.6);   // rig space (converted each tick)
    this._glowRig = U.uGlowPos.value.clone();
    this.group.visible = !!S.on;
    if (this.beamU) { this.beamU.uBStr.value = S.bstr; this.beamU.uDStr.value = S.dstr; this.beamU.uBeamCol.value.setRGB(0.82, 0.88, 1.0).lerp(U.uTint.value, 0.3); }
  }
  get hasMesh() { return this.meshN > 0; }
  // per frame (cheap): moon direction, glow position, slat masks when a roof changed; mesh poses every ~0.25 s
  tick(frame, ref, dt, moonRig) {
    if (!this.S.on) return;
    this.rig.updateMatrixWorld();
    const U = this.u;
    if (moonRig && this.S.src === 'dome') this.moonDir.copy(moonRig); else if (this.S.src !== 'dome') this.moonDir.set(0, 1, 0);
    U.uMoon.value.copy(this.moonDir).transformDirection(this.rig.matrixWorld);
    U.uGlowPos.value.copy(this._glowRig).applyMatrix4(this.rig.matrixWorld);
    this._slats();
    const useMesh = this.S.mesh && frame && ref && frame.detectedMeshes;
    this._t = (this._t || 0) + dt;
    if (useMesh && this._t > 0.25) { this._t = 0; this._meshes(frame, ref); }
    if (!useMesh && this.meshes.size) this._clearMeshes();
    const m = this.meshN > 0;
    this.floor.visible = !m; this.shell.visible = !m;
    this._beams();
  }
  _beamSlot(i) {   // a prism mesh + a dust cloud for frame slot i
    if (this.beams[i]) return this.beams[i];
    const shared = { ...this.u, ...this.beamU, uIdx: { value: i } };
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3));
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]);
    const bm = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,   /* add light, keep the framebuffer alpha (passthrough) */ uniforms: { ...shared, uOn: { value: 1 } } }));
    const dg = new THREE.BufferGeometry(), r = new Float32Array(DUST_N * 4); for (let k = 0; k < r.length; k++) r[k] = Math.random();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST_N * 3), 3)); dg.setAttribute('aR', new THREE.BufferAttribute(r, 4));
    const du = { ...shared, uOn: { value: 1 }, uO: { value: new THREE.Vector3() }, uX: { value: new THREE.Vector3() }, uY: { value: new THREE.Vector3() }, uD: { value: new THREE.Vector3() } };
    const dm = new THREE.Points(dg, new THREE.ShaderMaterial({ vertexShader: DUST_VS, fragmentShader: DUST_FS, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,   /* add light, keep the framebuffer alpha (passthrough) */ uniforms: du }));
    for (const o of [bm, dm]) { o.frustumCulled = false; o.raycast = () => {}; o.renderOrder = 3; this._gate(o); }
    this.group.add(bm); this.group.add(dm);
    return (this.beams[i] = { bm, dm, du });
  }
  _beams() {   // rebuild each PANO frame's prism (8 corners) from the opening along the moon to the floor
    const S = this.S, P = this.portals, act = P.on ? P.list.slice(0, P.n) : [], U = this.u;
    this.beamU.uT.value = performance.now() / 1000; this.beamU.uFloorY.value = this.rig.matrixWorld.elements[13];
    const M = U.uMoon.value, want = S.moon && (S.beams || S.dust);
    for (let i = 0; i < SLOTS; i++) {
      const f = act[i], on = want && f && f.rev && f.obj.visible && M.y > 0.05;
      if (!on) { if (this.beams[i]) { this.beams[i].bm.visible = false; this.beams[i].dm.visible = false; } continue; }
      const b = this._beamSlot(i); f.obj.updateMatrixWorld();
      const c = f.obj.getWorldPosition(_bv1), floorY = this.beamU.uFloorY.value, L = Math.min(8, Math.max(0.3, (c.y - floorY) / M.y));
      const X = _bv2.set(1, 0, 0).transformDirection(f.obj.matrixWorld).multiplyScalar(f.half.x), Y = _bv3.set(0, 1, 0).transformDirection(f.obj.matrixWorld).multiplyScalar(f.half.y), D = _bv4.copy(M).multiplyScalar(-L);
      const pos = b.bm.geometry.attributes.position, cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const rI = _bm1.copy(this.rig.matrixWorld).invert();   // the prism lives under the rig: world corners -> rig space
      cs.forEach(([sx, sy], k) => { _bv5.copy(c).addScaledVector(X, sx * 1.05).addScaledVector(Y, sy * 1.05); _bv6.copy(_bv5).applyMatrix4(rI); pos.setXYZ(k, _bv6.x, _bv6.y, _bv6.z); _bv5.add(D).applyMatrix4(rI); pos.setXYZ(k + 4, _bv5.x, _bv5.y, _bv5.z); });
      pos.needsUpdate = true; b.bm.geometry.computeBoundingSphere();
      b.du.uO.value.copy(c); b.du.uX.value.copy(X); b.du.uY.value.copy(Y); b.du.uD.value.copy(D);
      b.bm.visible = !!S.beams; b.dm.visible = !!S.dust;
    }
  }
  _slats() {   // one row per frame slot of an 8-row mask: 255 = open, 0 = under a slat / edge pole
    const P = this.portals, act = P.on ? P.list.slice(0, P.n) : [];
    let key = '';
    act.forEach((f, i) => { const im = f.bamboo ? (P.bamboo.kind === 'wood' ? f.wm : f.bm) : null, sl = im && im.userData.slats; key += i + ':' + (sl ? sl.v + P.bamboo.kind : '-') + ';'; });
    if (key === this._slatV) return; this._slatV = key;
    const d = this.mask.image.data; d.fill(255);
    for (let i = 0; i < SLOTS; i++) this.slatInfo[i].set(0, 0, 1, 0);
    act.forEach((f, i) => {
      if (i >= SLOTS) return;
      const im = f.bamboo ? (P.bamboo.kind === 'wood' ? f.wm : f.bm) : null, sl = im && im.userData.slats; if (!sl) return;
      const H = sl.along ? f.half.y : f.half.x; this.slatInfo[i].set(1, sl.along ? 1 : 0, H, 0);
      for (let x = 0; x < MW; x++) {
        const c = (x / (MW - 1) - 0.5) * 2 * H; let open = 1;
        if (Math.abs(c) > H - 0.05) open = 0;   // edge pole / beam
        else for (const [yy, r] of sl.list) if (Math.abs(Math.abs(c) - yy) < r) { open = 0; break; }
        const o = (i * MW + x) * 4; d[o] = d[o + 1] = d[o + 2] = open ? 255 : 0;
      }
    });
    this.mask.needsUpdate = true;
  }
  _meshes(frame, ref) {
    const rI = new THREE.Matrix4().copy(this.rig.matrixWorld).invert(), seen = new Set(); let tris = 0;
    for (const xm of frame.detectedMeshes) {
      const pose = frame.getPose(xm.meshSpace, ref); if (!pose) continue;
      let e = this.meshes.get(xm);
      if (!e || e.t !== xm.lastChangedTime) {
        if (e) { this.group.remove(e.m); e.m.geometry.dispose(); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(xm.vertices), 3)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(xm.indices), 1));
        const m = new THREE.Mesh(g, this.mat); m.matrixAutoUpdate = false; m.renderOrder = 2; m.frustumCulled = false; m.raycast = () => {}; this._gate(m); this.group.add(m);
        e = { m, t: xm.lastChangedTime }; this.meshes.set(xm, e);
      }
      e.m.matrix.fromArray(pose.transform.matrix).premultiply(rI); e.m.matrixWorldNeedsUpdate = true;
      tris += e.m.geometry.index.count / 3; seen.add(xm);
    }
    for (const [k, e] of this.meshes) if (!seen.has(k)) { this.group.remove(e.m); e.m.geometry.dispose(); this.meshes.delete(k); }
    this.meshN = this.meshes.size; this.meshTris = tris;
  }
  _clearMeshes() { for (const e of this.meshes.values()) { this.group.remove(e.m); e.m.geometry.dispose(); } this.meshes.clear(); this.meshN = 0; this.meshTris = 0; }
}
