// #612 NIGHT LOOK (#626: GRADE, MOON STRIPES, MOONBEAMS, DUST and the presets removed by the owner; what is left adds
// light only: the moon's patch through the PANO openings and the glow).
// Originally: makes the real (passthrough) room read as night under the dome. It can't relight the real room, so
// it draws a see-through layer over the real surfaces that darkens and tints them (premultiplied: added light + how
// much of the camera picture shows through), brighter where the moon reaches them through the PANO frames' openings
// (and between bamboo / wood slats: moon stripes), warm or neon near a glow, never inside a PANO opening (the sky).
// Surfaces: the Quest's room mesh (WebXR mesh-detection, from Space Setup) or, with ROOM MESH off / no mesh, the floor
// plus a big shell round the DJ (grade and glow only). Drawn only in the headset's own eyes (and the desktop view),
// never into the stream's other cameras. One draw per mesh; per pixel a few lookups.
import * as THREE from 'three';

export const NIGHT0 = { on: false, moon: true, glow: true, mesh: true, str: 0.45, hue: 220, sat: 0.55, ghue: 30, gstr: 0.6, gdir: 270, soft: 1, clear: 0.5, src: 'dome', preset: 'goa' };
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
    U.uStr.value = S.str; U.uGrade.value = 0; U.uMoonOn.value = S.moon ? 1 : 0; U.uStripes.value = 0;   // #626 owner removed GRADE and MOON STRIPES: the layer only adds moonlight and glow U.uSoft.value = S.soft; U.uClear.value = S.clear;
    U.uGlowOn.value = S.glow ? 1 : 0; U.uGStr.value = S.gstr;
    U.uTint.value.setHSL(S.hue / 360, S.sat, 0.5); U.uGlowCol.value.setHSL(S.ghue / 360, 0.85, 0.55);
    const a = S.gdir * Math.PI / 180; U.uGlowPos.value.set(Math.sin(a) * 2.6, 0.45, -Math.cos(a) * 2.6);   // rig space (converted each tick)
    this._glowRig = U.uGlowPos.value.clone();
    this.group.visible = !!S.on;
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
