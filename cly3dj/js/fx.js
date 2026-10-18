// #379 VISUALS > FX (owner, 17 Oct): FLOAT and WATER.
// FLOAT: a see-through blue ball only the DJ sees (USER_LAYER: drawn by the desktop camera and the headset's two eye cameras;
// AVACAM, the GoPro, SHOWTIME!, HEADSET CAM, CLY3DTV and Twitch never draw it). Grip it (bare hands: pinch) and drop it on a piece
// of gear: it sticks there and a small slider over it (trigger / pinch, slide along it) sets how much that piece bobs, rolls and
// drifts, as if it floated on water. Whatever rests on the floated piece rides along (decks and mixer on a floated flight case, the
// record case on a floated milk crate, a sleeve lying on the case). Grip the ball twice quickly to remove it.
// The float is put on just before the frame is drawn and taken off straight after (preRender / postRender), so hands, grabs,
// settling, colliders and the saved layout only ever see the gear's real place. Cost: a few matrix multiplies a frame, no GPU work.
// WATER: a resizable horizontal plane with animated ripple normals, a fresnel reflection of the current panorama, a tint and soft
// edges. Gear below its surface is drawn at its apparent depth (lifted by 1/4 of its depth, as through water seen from above),
// wobbles a little and gets tint, murk and moving caustics. That is done inside the gear's own shaders (no extra render pass);
// the gear materials are recompiled once, the first time WATER is switched on in a session (a short hitch).
import * as THREE from 'three';

export const USER_LAYER = 7;   // not 1 / 2 (three's eye cameras), not 5 (deck-inst HIDE_LAYER), not 6 (director.js AV_LAYER: the robot). #386 it WAS 6, so the headset's eyes drew the robot
const FKEY = 'vire.fx.floats', WKEY = 'vire.fx.water';
const R = 0.035, TRACK = 0.12, POST_H = 0.75;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _eye = new THREE.Vector3(), _c = new THREE.Vector3(), _sz = new THREE.Vector3(), _s = new THREE.Vector3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _D = new THREE.Matrix4(), _box = new THREE.Box3(), _Y = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function userOnly(o) { o.traverse(c => { c.layers.set(USER_LAYER); if (c.isMesh) { c.raycast = () => {}; c.castShadow = c.receiveShadow = false; } }); }
function alive(o) { for (; o; o = o.parent) if (o.isScene) return true; return false; }
function shownChain(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }
// box of the VISIBLE meshes only (Box3.setFromObject also counts hidden glow sprites: a deck measured 0.48 to 1.48 m tall)
const _tb = new THREE.Box3();
function visBox(o, box) {
  box.makeEmpty(); o.updateWorldMatrix(true, true);
  (function walk(n) {
    if (!n.visible) return;
    if (n.isMesh && !n.isInstancedMesh && n.geometry) { const g = n.geometry; if (!g.boundingBox) g.computeBoundingBox(); box.union(_tb.copy(g.boundingBox).applyMatrix4(n.matrixWorld)); }
    for (const c of n.children) walk(c);
  })(o);
  return box;
}
function related(a, b) { for (let o = a; o; o = o.parent) if (o === b) return true; for (let o = b; o; o = o.parent) if (o === a) return true; return false; }

// ---------------------------------------------------------------- FLOAT
const BALL_GEO = new THREE.SphereGeometry(R, 24, 16);
const BALL_MAT = new THREE.MeshStandardMaterial({ color: 0x2f8fff, emissive: 0x0b2c6e, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.42, depthWrite: false });
const RING_GEO = new THREE.TorusGeometry(R * 1.12, 0.0025, 8, 40);
const RING_MAT = new THREE.MeshBasicMaterial({ color: 0xcfe8ff, toneMapped: false });
const TRACK_GEO = new THREE.BoxGeometry(TRACK, 0.005, 0.005), FILL_GEO = new THREE.BoxGeometry(TRACK, 0.0065, 0.0065), KNOB_GEO = new THREE.SphereGeometry(0.009, 16, 10);
const TRACK_MAT = new THREE.MeshBasicMaterial({ color: 0x1a2233 }), FILL_MAT = new THREE.MeshBasicMaterial({ color: 0x39a8ff, toneMapped: false });
const KNOB_MAT = new THREE.MeshStandardMaterial({ color: 0xdfe6f2, roughness: 0.3, metalness: 0.6 });
const LABEL_GEO = new THREE.PlaneGeometry(0.13, 0.024);

class FloatBall {
  constructor(fx) {
    this.fx = fx; this.v = 0.5; this.target = null; this.off = new THREE.Vector3(); this.held = false; this.grabT = 0; this.dead = false;
    this.amp = 0; this.still = 0; this.phase = Math.random() * 6.283; this.last = new THREE.Vector3(); this.hasLast = false;
    this.riders = []; this.box = new THREE.Box3(); this.knobOn = false; this.drawn = '';
    const g = this.obj = new THREE.Group(); g.name = 'fxFloat';
    g.add(new THREE.Mesh(BALL_GEO, BALL_MAT));
    this.ring = new THREE.Mesh(RING_GEO, RING_MAT); this.ring.rotation.x = Math.PI / 2; this.ring.visible = false; g.add(this.ring);
    const s = this.slider = new THREE.Group(); s.name = 'fxFloatSlider'; s.visible = false;
    s.add(new THREE.Mesh(TRACK_GEO, TRACK_MAT));
    this.fill = new THREE.Mesh(FILL_GEO, FILL_MAT); s.add(this.fill);
    this.knobM = new THREE.Mesh(KNOB_GEO, KNOB_MAT); s.add(this.knobM);
    this.cv = document.createElement('canvas'); this.cv.width = 320; this.cv.height = 60;
    this.tex = new THREE.CanvasTexture(this.cv); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.labMat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false });
    const lab = new THREE.Mesh(LABEL_GEO, this.labMat); lab.position.y = 0.022; s.add(lab);
    fx.rig.add(g); fx.rig.add(s); userOnly(g); userOnly(s);
    this.setV(this.v);
  }
  get label() { return this.target ? this.target.label : 'FLOAT (not on gear)'; }
  setV(v) {
    this.v = clamp(Math.round(v * 20) / 20, 0, 1);
    this.fill.scale.x = Math.max(0.001, this.v); this.fill.position.x = -TRACK / 2 + TRACK * this.v / 2; this.knobM.position.x = -TRACK / 2 + TRACK * this.v;
    this.drawLabel();
  }
  drawLabel() {
    const t = `${this.target ? this.target.label : 'FLOAT'}  ${Math.round(this.v * 100)}%`; if (t === this.drawn) return; this.drawn = t;
    const g = this.cv.getContext('2d'), W = this.cv.width, H = this.cv.height;
    g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(5,10,20,0.72)'; g.fillRect(0, 6, W, H - 12);
    g.fillStyle = '#dfe6f2'; g.font = '700 30px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let f = 30; while (f > 16 && g.measureText(t).width > W - 16) { f -= 2; g.font = `700 ${f}px system-ui`; }
    g.fillText(t, W / 2, H / 2 + 1); this.tex.needsUpdate = true;
  }
  // ---- prop interface (xr.js ctx.props): grip / pinch on the ball carries it; trigger / pinch on the slider sets it
  hit(P) { return !this.dead && this.obj.getWorldPosition(_v).distanceTo(P) < R + 0.025; }
  grab() {
    const now = performance.now();
    if (now - this.grabT < 450) { this.fx.removeBall(this); return; }   // grip twice quickly = remove
    this.grabT = now; this.held = true;
    if (this.target) this.fx.detach(this);
  }
  hold(world) { if (this.dead) return; this.fx.rig.updateMatrixWorld(); _m.copy(this.fx.rig.matrixWorld).invert().multiply(world); _m.decompose(this.obj.position, _q, _s); }
  release() { this.held = false; if (!this.dead) this.fx.tryAttach(this); }
  knob(P) {
    if (this.dead || !this.target || !this.slider.visible) return false;
    this.slider.updateMatrixWorld(); const l = this.slider.worldToLocal(_v.copy(P));
    if (Math.abs(l.x) < TRACK / 2 + 0.018 && Math.abs(l.y) < 0.024 && Math.abs(l.z) < 0.035) { this.knobOn = true; return true; }
    return false;
  }
  knobMove(P) { this.slider.updateMatrixWorld(); const l = this.slider.worldToLocal(_v.copy(P)); this.setV((l.x + TRACK / 2) / TRACK); }
  knobEnd() { this.knobOn = false; this.fx.save(); }
  save() { this.fx.save(); }
  dispose() { this.dead = true; this.obj.removeFromParent(); this.slider.removeFromParent(); this.tex.dispose(); this.labMat.dispose(); }
}

// ---------------------------------------------------------------- WATER
const WVERT = /* glsl */`
varying vec3 vW; varying vec2 vP;
void main() { vP = position.xy; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const WFRAG = /* glsl */`
uniform float uT, uRip, uClar, uHasSky;
uniform vec2 uSize, uC;
uniform vec3 uTint;
uniform sampler2D uSky;
uniform vec4 uSO;
uniform mat3 uSkyR;
varying vec3 vW; varying vec2 vP;
// slope of the water surface (dh/dx, dh/dz): five travelling waves plus two drifting ring ripples
vec2 wave(vec2 p, float A, float K, vec2 d, float S, float t) { d = normalize(d); return d * (A * K * cos(dot(d, p) * K + t * S)); }
vec2 slope(vec2 p, float t) {
  vec2 g = wave(p, 0.004, 9.0, vec2(1.0, 0.3), 1.6, t) + wave(p, 0.003, 13.0, vec2(-0.4, 1.0), 2.1, t) + wave(p, 0.002, 21.0, vec2(0.7, -0.8), 2.9, t)
         + wave(p, 0.0012, 34.0, vec2(-0.9, -0.3), 3.7, t) + wave(p, 0.0008, 55.0, vec2(0.2, 1.0), 4.6, t);
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    vec2 c = uC + vec2(sin(t * 0.13 + fi * 2.1), cos(t * 0.11 + fi * 1.3)) * 0.6, r = p - c;
    float L = length(r) + 1e-4;
    g += r / L * (0.0016 * 28.0 * cos(L * 28.0 - t * (3.0 + fi)) * exp(-L * 1.8));
  }
  return g;
}
void main() {
  vec2 gr = slope(vW.xz, uT) * uRip;
  vec3 n = normalize(vec3(-gr.x, 1.0, -gr.y));
  vec3 V = normalize(cameraPosition - vW);
  float F = 0.1 + 0.9 * pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 5.0);
  vec3 R = reflect(-V, n);
  vec3 sky;
  if (uHasSky > 0.5) {
    vec3 d = normalize(uSkyR * R);
    float u = atan(d.z, d.x) * 0.15915494 + 0.5, v = asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5;
    sky = texture2D(uSky, vec2(fract(u) * uSO.x + uSO.y, v * uSO.z + uSO.w)).rgb;
  } else sky = mix(vec3(0.30, 0.36, 0.42), vec3(0.70, 0.80, 0.90), clamp(R.y, 0.0, 1.0));
  float spec = pow(max(dot(R, normalize(vec3(0.35, 0.9, 0.25))), 0.0), 180.0) * 1.4;
  vec3 col = mix(vec3(0.03, 0.16, 0.19), sky, F) + spec + sky * min(length(gr) * 6.0, 0.25);   // deep teal body, sky, glints, a sheen on the ripples
  vec2 e = (0.5 - abs(vP)) * uSize;
  float a = clamp(mix(1.0 - uClar, 1.0, F) + spec, 0.0, 1.0) * smoothstep(0.0, 0.18, min(e.x, e.y));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;
// injected into gear materials (onBeforeCompile)
const G_COMMON = `uniform vec4 uFxWater; uniform mat4 uFxWInv; uniform vec2 uFxHalf; uniform float uFxT; uniform vec3 uFxTint; varying vec3 vFxW;`;
const G_VERT = `
{
  vec4 fxW = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  fxW = instanceMatrix * fxW;
  #endif
  fxW = modelMatrix * fxW; vFxW = fxW.xyz;
  if (uFxWater.x > 0.5) {
    vec3 fl = (uFxWInv * fxW).xyz;
    if (fl.y < 0.0 && abs(fl.x) < uFxHalf.x && abs(fl.z) < uFxHalf.y) {
      float fd = -fl.y, fk = uFxWater.y;
      fxW.y += fd * 0.25 * fk;   // apparent depth through the surface (1 / 1.33)
      fxW.xz += fk * 0.005 * min(fd * 10.0, 1.0) * vec2(sin(fxW.z * 11.0 + uFxT * 1.9), cos(fxW.x * 9.0 + uFxT * 1.4));
      gl_Position = projectionMatrix * viewMatrix * fxW;
    }
  }
}`;
const G_FCOMMON = `
float fxCaustic(vec2 p, float t) {   // bright wandering lines where two warped wave sums cross zero
  vec2 q = p + 0.35 * vec2(sin(p.y * 1.7 + t), sin(p.x * 1.9 - t * 1.1));
  float a = abs(sin(q.x * 2.1 + t * 0.6) + sin(q.y * 2.3 - t * 0.5));
  vec2 r = p * 1.6 + 0.4 * vec2(sin(p.y * 2.3 - t * 0.8), sin(p.x * 2.1 + t * 0.7));
  float b = abs(sin(r.x * 2.6 - t * 0.4) + sin(r.y * 2.2 + t * 0.9));
  return (1.0 - smoothstep(0.0, 0.35, a)) + (1.0 - smoothstep(0.0, 0.35, b)) * 0.7;
}`;
const G_FRAG = `
if (uFxWater.x > 0.5) {
  vec3 fl = (uFxWInv * vec4(vFxW, 1.0)).xyz;
  if (abs(fl.x) < uFxHalf.x && abs(fl.z) < uFxHalf.y) {
    if (fl.y < 0.0) {
      float fd = -fl.y, fog = 1.0 - exp(-fd * 7.0 * uFxWater.z);
      gl_FragColor.rgb = mix(gl_FragColor.rgb * mix(vec3(1.0), uFxTint * 1.7, 0.5), uFxTint * 0.32, fog);
      gl_FragColor.rgb += fxCaustic(vFxW.xz * 5.0, uFxT * 0.7) * 0.28 * uFxWater.w * (1.0 - fog) * exp(-fd * 2.0);
    }
    gl_FragColor.rgb += (1.0 - smoothstep(0.0, 0.005, abs(fl.y))) * 0.12;   // the waterline
  }
}`;
const DEFAULT_OBC = THREE.Material.prototype.onBeforeCompile;
const okMat = m => m && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshBasicMaterial) && m.onBeforeCompile === DEFAULT_OBC && !m.userData.noWater;
function injectWater(m, U) {
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + G_COMMON).replace('#include <project_vertex>', '#include <project_vertex>\n' + G_VERT);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + G_COMMON + G_FCOMMON).replace('#include <dithering_fragment>', G_FRAG + '\n#include <dithering_fragment>');
  };
  m.customProgramCacheKey = () => 'fxWater1';
  m.needsUpdate = true;
}

class Water {
  constructor(fx) {
    this.fx = fx; this.on = false; this.placed = false; this.held = false; this.t = 0; this.scanT = 0; this.tapT = 0; this.compiled = false;
    this.w = 3; this.d = 3; this.rip = 1; this.murk = 0.45; this.refr = 0.7; this.caus = 0.7; this.clar = 0.45;
    this.injected = new WeakSet();
    const g = this.obj = new THREE.Group(); g.name = 'fxWater'; g.visible = false; fx.rig.add(g);
    const tint = new THREE.Color(0.55, 0.82, 0.86);
    this.U = { uFxWater: { value: new THREE.Vector4() }, uFxWInv: { value: new THREE.Matrix4() }, uFxHalf: { value: new THREE.Vector2(1.5, 1.5) }, uFxT: { value: 0 }, uFxTint: { value: tint } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uRip: { value: 1 }, uClar: { value: 0.7 }, uHasSky: { value: 0 }, uSize: { value: new THREE.Vector2(3, 3) }, uC: { value: new THREE.Vector2() },
        uTint: { value: tint }, uSky: { value: null }, uSO: { value: new THREE.Vector4(1, 0, 1, 0) }, uSkyR: { value: new THREE.Matrix3() } },
      vertexShader: WVERT, fragmentShader: WFRAG, transparent: true, depthWrite: false, toneMapped: false,
    });
    const m = this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat); m.rotation.x = -Math.PI / 2; m.raycast = () => {}; m.renderOrder = 2; m.name = 'fxWaterPlane'; g.add(m);
    // handles, only the DJ sees them: a post with a ring (grip / pinch carries the water), a post with a cube on the corner (trigger / pinch sizes it)
    const h = this.handles = new THREE.Group(); g.add(h);
    const pm = new THREE.MeshBasicMaterial({ color: 0x39a8ff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
    const stick = () => { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, POST_H, 6), pm); s.position.y = POST_H / 2; return s; };
    this.post = new THREE.Group(); this.post.add(stick());
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 10, 32), new THREE.MeshBasicMaterial({ color: 0x39a8ff, toneMapped: false })); ring.rotation.x = Math.PI / 2; ring.position.y = POST_H; this.post.add(ring);
    this.corner = new THREE.Group(); this.corner.add(stick());
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.035), new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.3, metalness: 0.8 })); cube.position.y = POST_H; this.corner.add(cube);
    h.add(this.post, this.corner); userOnly(h);
    this.layout();
  }
  layout() {
    this.mesh.scale.set(this.w, this.d, 1); this.mat.uniforms.uSize.value.set(this.w, this.d); this.U.uFxHalf.value.set(this.w / 2, this.d / 2);
    this.post.position.set(0, 0, this.d / 2); this.corner.position.set(this.w / 2, 0, this.d / 2);
  }
  setSize(w, d) { this.w = clamp(w, 0.3, 12); this.d = clamp(d, 0.3, 12); this.layout(); }
  setLevel(y) { this.obj.position.y = clamp(y, -0.3, 2); }
  set(k, v) {
    if (k === 'w') this.setSize(v, this.d); else if (k === 'd') this.setSize(this.w, v); else if (k === 'level') this.setLevel(v);
    else if (k in this) this[k] = v;
    this.save();
  }
  setOn(on, save = true) {
    this.on = !!on; this.obj.visible = this.on;
    if (this.on && !this.placed) this.here(false);
    if (this.on && !this.compiled) { this.compiled = true; this.scanT = 0; }
    if (save) this.save();
  }
  here(save = true) {
    const h = this.fx.env.waterHome ? this.fx.env.waterHome() : { p: new THREE.Vector3(0, 0.12, 0), yaw: 0 };
    this.obj.position.copy(h.p); this.obj.rotation.set(0, h.yaw, 0); this.placed = true;
    if (save) this.save();
  }
  tap() {   // tablet WATER: tap = on / off; double tap = on, back under the flight case
    const now = performance.now();
    if (now - this.tapT < 350) { this.tapT = 0; this.here(false); this.setOn(true); this.fx.env.toast('Water back round the flight case', 1500); return; }
    this.tapT = now; this.setOn(!this.on);
    if (this.on && !this.warned) { this.warned = true; this.fx.env.toast('WATER on (first time in a session: a short pause while the gear shaders rebuild)', 3500); }
  }
  // ---- prop interface: grip / pinch the ring post to carry it (it stays level), trigger / pinch the corner cube to size it
  hit(P) { if (!this.on) return false; this.post.updateMatrixWorld(); return this.post.localToWorld(_v.set(0, POST_H, 0)).distanceTo(P) < 0.07; }
  grab() { this.held = true; }
  hold(world) {
    const rig = this.fx.rig; rig.updateMatrixWorld(); _m.copy(rig.matrixWorld).invert().multiply(world);
    _m.decompose(_v, _q, _s); _e.setFromQuaternion(_q, 'YXZ'); const yaw = _e.y;
    _v2.set(0, POST_H, this.d / 2).applyMatrix4(_m);   // where the post's ring is now, rig space
    _v.set(0, 0, this.d / 2).applyAxisAngle(_Y, yaw);
    this.obj.position.set(_v2.x - _v.x, clamp(_v2.y - POST_H, -0.3, 2), _v2.z - _v.z); this.obj.rotation.set(0, yaw, 0);
  }
  release() { this.held = false; this.save(); }
  knob(P) { if (!this.on) return false; this.corner.updateMatrixWorld(); return this.corner.localToWorld(_v.set(0, POST_H, 0)).distanceTo(P) < 0.05; }
  knobMove(P) { this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P)); this.setSize(Math.abs(l.x) * 2, Math.abs(l.z) * 2); }
  knobEnd() { this.save(); }
  save() { this.fx.saveWater(); }
  snapshot() { const o = this.obj; return { on: this.on, placed: this.placed, p: o.position.toArray(), yaw: o.rotation.y, w: this.w, d: this.d, rip: this.rip, murk: this.murk, refr: this.refr, caus: this.caus, clar: this.clar }; }
  load() {
    let s = null; try { s = JSON.parse(localStorage.getItem(WKEY) || 'null'); } catch {}
    if (!s) return;
    for (const k of ['rip', 'murk', 'refr', 'caus', 'clar']) if (typeof s[k] === 'number') this[k] = s[k];
    if (s.placed && s.p) { this.obj.position.fromArray(s.p); this.obj.rotation.set(0, s.yaw || 0, 0); this.placed = true; }
    this.setSize(s.w || 3, s.d || 3); this.setOn(!!s.on, false);
  }
  inject() {   // gear materials get the underwater look (once each; new gear is picked up by the next scan)
    const env = this.fx.env, skip = new Set((env.skipRoots ? env.skipRoots() : []).filter(Boolean)); let n = 0;
    const visit = o => {
      if (skip.has(o)) return;
      if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && !this.injected.has(m) && okMat(m)) { injectWater(m, this.U); this.injected.add(m); n++; }
      for (const c of o.children) visit(c);
    };
    for (const r of env.gearRoots ? env.gearRoots() : []) if (r) visit(r);
    return n;
  }
  tick(dt) {
    const U = this.U, on = this.on && this.obj.visible, u = this.mat.uniforms;
    U.uFxWater.value.set(on ? 1 : 0, this.refr, this.murk, this.caus);
    if (!on) return;
    this.t += dt; U.uFxT.value = this.t; u.uT.value = this.t; u.uRip.value = this.rip; u.uClar.value = this.clar;
    this.obj.updateMatrixWorld(); U.uFxWInv.value.copy(this.obj.matrixWorld).invert();
    _v.setFromMatrixPosition(this.obj.matrixWorld); u.uC.value.set(_v.x, _v.z);
    const sk = this.fx.env.sky ? this.fx.env.sky() : null;
    if (sk && sk.tex) {
      u.uSky.value = sk.tex; u.uSO.value.copy(sk.so); u.uHasSky.value = 1;
      sk.group.updateMatrixWorld(); u.uSkyR.value.setFromMatrix4(sk.group.matrixWorld).invert();
    } else { u.uSky.value = null; u.uHasSky.value = 0; }
    this.scanT -= dt; if (this.scanT <= 0) { this.scanT = 3; this.inject(); }
  }
}

// ---------------------------------------------------------------- manager
// env: { rig, renderer, camera, toast, candidates() -> [{ key?, obj, label, top?() }], gearRoots(), skipRoots(), sky() -> { tex, so, group } | null,
//        waterHome() -> { p, yaw }, isDeck(obj), afterFloat() }
export class FX {
  constructor(env) {
    this.env = env; this.rig = env.rig; this.balls = []; this.t = 0; this.ridT = 0; this.loaded = false;
    this.acc = new Map(); this.mpool = []; this.saved = []; this.nSaved = 0; this.rLast = new WeakMap();
    this.water = new Water(this);
  }
  props() { const p = this.balls.filter(b => !b.dead); if (this.water.on) p.push(this.water); return p; }
  viewer() { const r = this.env.renderer; return r.xr.isPresenting ? r.xr.getCamera() : this.env.camera; }
  candidates() { try { return this.env.candidates() || []; } catch (e) { console.warn('fx candidates', e); return []; } }
  spawnBall() {
    if (this.balls.length >= 12) { this.env.toast('12 floats is the most'); return null; }
    const b = new FloatBall(this), cam = this.viewer();
    cam.getWorldPosition(_v); cam.getWorldDirection(_v2); _v2.y = 0; if (_v2.lengthSq() < 1e-6) _v2.set(0, 0, -1); _v2.normalize();
    _v.addScaledVector(_v2, 0.42); _v.y -= 0.22;
    this.rig.updateMatrixWorld(); this.rig.worldToLocal(_v); b.obj.position.copy(_v);
    this.balls.push(b); return b;
  }
  removeBall(b, quiet = false) {
    const i = this.balls.indexOf(b); if (i >= 0) this.balls.splice(i, 1);
    b.target = null; b.dispose(); this.save(); if (!quiet) this.env.toast('Float removed', 1200);
  }
  clearFloats() { for (const b of this.balls) { b.target = null; b.dispose(); } this.balls.length = 0; this.save(); }
  detach(b) { b.target = null; b.riders = []; b.amp = 0; b.ring.visible = false; b.slider.visible = false; b.drawn = ''; b.drawLabel(); this.save(); }
  tryAttach(b) {
    const P = b.obj.getWorldPosition(new THREE.Vector3()); let best = null, bv = Infinity;
    for (const c of this.candidates()) {
      if (!alive(c.obj) || !shownChain(c.obj)) continue;
      visBox(c.obj, _box); if (_box.isEmpty()) continue;
      const top = c.top ? c.top() : _box.max.y, M = 0.03;
      if (P.x < _box.min.x - M || P.x > _box.max.x + M || P.z < _box.min.z - M || P.z > _box.max.z + M || P.y < _box.min.y - M || P.y > Math.max(top, _box.max.y) + 0.09) continue;
      _box.getSize(_sz); const vol = Math.max(1e-6, _sz.x * _sz.y * _sz.z);
      if (vol < bv) { bv = vol; best = { c, top: Math.min(_box.max.y, Math.max(top, P.y - R)) }; }
    }
    if (!best) { this.env.toast('FLOAT: drop the ball onto a piece of gear (it waits here)', 2200); return; }
    this.attach(b, best.c, P, best.top);
  }
  attach(b, c, P, top) {
    for (const o of this.balls.slice()) if (o !== b && o.target && o.target.obj === c.obj) { b.setV(o.v); this.removeBall(o, true); }   // one float per piece: the new ball takes over
    b.target = { key: c.key || null, obj: c.obj, label: c.label };
    b.off.copy(c.obj.worldToLocal(_v.set(P.x, top + R + 0.004, P.z)));
    b.hasLast = false; b.still = 0; b.amp = 0; b.ring.visible = true; b.drawn = ''; b.drawLabel(); this.ridT = 0;
    this.env.toast(`FLOAT on ${c.label}`, 1500); this.save();
  }
  refreshRiders(floats) {
    const cands = this.candidates().filter(c => alive(c.obj) && shownChain(c.obj)), byObj = new Map(cands.map(c => [c.obj, c]));
    const boxes = new Map(), boxOf = o => { let b = boxes.get(o); if (!b) { b = visBox(o, new THREE.Box3()); boxes.set(o, b); } return b; };
    const topOf = o => { const c = byObj.get(o); return c && c.top ? c.top() : boxOf(o).max.y; };
    for (const f of floats) {
      f.box.copy(boxOf(f.target.obj));
      const set = [f.target.obj], out = [];
      for (let i = 0; i < set.length && i < 16; i++) {
        const base = boxOf(set[i]); if (base.isEmpty()) continue; const top = topOf(set[i]);
        for (const c of cands) {
          const o = c.obj; if (set.some(s => s === o || related(s, o))) continue;
          const b = boxOf(o); if (b.isEmpty()) continue;
          const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
          if (cx < base.min.x - 0.01 || cx > base.max.x + 0.01 || cz < base.min.z - 0.01 || cz > base.max.z + 0.01 || Math.abs(b.min.y - top) > 0.04) continue;
          set.push(o); out.push(o);
        }
      }
      f.riders = out;
    }
  }
  motion(f, D) {   // world-space float transform: bob, roll, pitch, a slow yaw and drift about the piece's centre; big pieces move slower and tilt less
    const a = f.amp, T = this.t, ph = f.phase;
    f.box.getCenter(_c); f.box.getSize(_sz);
    const k = clamp(Math.sqrt(0.5 / Math.max(0.15, _sz.x, _sz.z)), 0.55, 1.3);
    const dy = a * (0.02 * Math.sin(1.25 * k * T + ph) + 0.007 * Math.sin(2.7 * k * T + 1.9 * ph));
    const rx = a * k * 0.055 * Math.sin(0.95 * k * T + 1.3 * ph), rz = a * k * 0.05 * Math.sin(1.15 * k * T + 0.7 * ph + 1), ry = a * 0.03 * Math.sin(0.33 * T + ph);
    const dx = a * 0.012 * Math.sin(0.41 * T + 2 * ph), dz = a * 0.012 * Math.sin(0.37 * T + 3 * ph);
    D.makeTranslation(-_c.x, -_c.y, -_c.z);
    D.premultiply(_m2.makeRotationFromQuaternion(_q.setFromEuler(_e.set(rx, ry, rz))));
    D.premultiply(_m2.makeTranslation(_c.x + dx, _c.y + dy, _c.z + dz));
    return D;
  }
  movedRider(o) {   // a rider being carried (a sleeve picked up off a floated case) is left alone
    o.updateWorldMatrix(true, false); _v2.setFromMatrixPosition(o.matrixWorld);
    const l = this.rLast.get(o); if (!l) { this.rLast.set(o, _v2.clone()); return false; }
    const m = l.distanceToSquared(_v2) > 4e-7; l.copy(_v2); return m;
  }
  // per frame, after all the logic and just before the cameras draw
  preRender(dt) {
    if (!this.loaded) { this.loaded = true; this.load(); }
    this.t += dt;
    const r = this.env.renderer;
    if (r.xr.isPresenting) { const xc = r.xr.getCamera(); xc.layers.enable(USER_LAYER); for (const c of xc.cameras) c.layers.enable(USER_LAYER); }
    const floats = [];
    for (const b of this.balls) {
      if (!b.target) continue;
      const o = b.target.obj;
      if (!alive(o)) { this.detach(b); continue; }   // the piece left the scene (a record put away, a sleeve back in the crate)
      o.updateWorldMatrix(true, false); _v.setFromMatrixPosition(o.matrixWorld);
      if (b.hasLast && b.last.distanceToSquared(_v) > 4e-7) b.still = 0; else b.still += dt;   // carried or turned: ease off, settle again 0.5 s after
      b.last.copy(_v); b.hasLast = true;
      const want = b.still > 0.5 && shownChain(o) ? b.v : 0;
      b.amp += (want - b.amp) * Math.min(1, dt * 2.5);
      floats.push(b);
    }
    this.ridT -= dt;
    if (this.ridT <= 0 && floats.length) { this.ridT = 0.5; this.refreshRiders(floats); }
    const acc = this.acc; acc.clear(); let mp = 0;
    for (const f of floats) {
      if (f.amp < 0.002) continue;
      const D = this.motion(f, _D);
      for (let i = -1; i < f.riders.length; i++) {
        const o = i < 0 ? f.target.obj : f.riders[i];
        if (i >= 0 && (!alive(o) || this.movedRider(o))) continue;
        let M = acc.get(o); if (!M) { M = this.mpool[mp] || (this.mpool[mp] = new THREE.Matrix4()); mp++; M.identity(); acc.set(o, M); }
        M.premultiply(D);
      }
    }
    let deck = false;
    for (const [o, M] of acc) {
      if (!o.parent) continue;
      o.updateWorldMatrix(true, false);
      const e = this.saved[this.nSaved] || (this.saved[this.nSaved] = { o: null, p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() }); this.nSaved++;
      e.o = o; e.p.copy(o.position); e.q.copy(o.quaternion); e.s.copy(o.scale);
      _m.copy(o.parent.matrixWorld).invert().multiply(M).multiply(o.matrixWorld);
      _m.decompose(o.position, o.quaternion, o.scale); o.updateMatrixWorld(true);
      if (this.env.isDeck && this.env.isDeck(o)) deck = true;
    }
    if (deck && this.env.afterFloat) this.env.afterFloat();   // the instanced deck parts copy the floated decks
    // balls ride their (floated) piece; each slider sits over its ball, turned to the DJ (not while it is being slid)
    this.viewer().getWorldPosition(_eye); this.rig.updateMatrixWorld(); this.rig.worldToLocal(_eye);
    for (const b of this.balls) {
      if (b.target && !b.held) { b.target.obj.localToWorld(_v.copy(b.off)); this.rig.worldToLocal(_v); b.obj.position.copy(_v); }
      const s = b.slider; s.visible = !!b.target && !b.held;
      if (s.visible) {
        s.position.copy(b.obj.position); s.position.y += 0.075;
        if (!b.knobOn) s.rotation.set(0, Math.atan2(_eye.x - s.position.x, _eye.z - s.position.z), 0);
      }
    }
    this.water.tick(dt);
  }
  postRender() {   // the gear goes back to its real place
    for (let i = 0; i < this.nSaved; i++) { const e = this.saved[i], o = e.o; o.position.copy(e.p); o.quaternion.copy(e.q); o.scale.copy(e.s); o.updateMatrixWorld(true); e.o = null; }
    this.nSaved = 0;
  }
  save() {
    const L = this.balls.filter(b => b.target && b.target.key && !b.dead).map(b => ({ key: b.target.key, v: b.v, off: b.off.toArray() }));
    try { localStorage.setItem(FKEY, JSON.stringify(L)); } catch {}
  }
  saveWater() { try { localStorage.setItem(WKEY, JSON.stringify(this.water.snapshot())); } catch {} }
  load() {
    let L = []; try { L = JSON.parse(localStorage.getItem(FKEY) || '[]') || []; } catch {}
    const cands = this.candidates();
    for (const s of L) {
      const c = cands.find(c => c.key && c.key === s.key); if (!c) continue;
      const b = new FloatBall(this); b.target = { key: c.key, obj: c.obj, label: c.label }; b.off.fromArray(s.off || [0, 0, 0]); b.ring.visible = true; b.setV(+s.v || 0.5);
      this.balls.push(b);
    }
    this.water.load();
  }
}
