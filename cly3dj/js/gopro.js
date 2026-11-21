// #337 GOPRO (owner): a small action camera in the scene that films SHOW (and the LED wall's AVACAM). Tap GOPRO on the
// tablet to pop it in at its starting spot (audience side of the mixer, facing the DJ), tap again to hide it, double-tap
// to send it back to the start. Grip (hands: pinch) picks it up; it keeps its pose relative to the hand, no gravity,
// stays where it is let go. While held, the picture follows it through a little gimbal smoothing, so live moves look
// like a camera operator, not hand shake. The lens looks along the camera's -Z; a red tally lamp is lit while it is on
// air; the screen on its back shows what it films (the stream's own frame, or a small preview while aiming).
import * as THREE from 'three';

const KEY = 'vire.gopro';
export const ZOOMS = { wide: { label: 'WIDE', fov: 62 }, normal: { label: 'NORMAL', fov: 46 }, tight: { label: 'TIGHT', fov: 30 } };   // vertical fov at 16:9
const B = { w: 0.062, h: 0.045, d: 0.033 };   // body, metres (GoPro-sized)

const VF_FS = `uniform sampler2D map; uniform float hdr; uniform float flip; uniform float mirror; uniform float on; uniform float rec; varying vec2 vUv;
vec3 rrt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= 1.0 / 0.6; return clamp(O * rrt(I * c), 0.0, 1.0); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
void main() {
  if (on < 0.5) { gl_FragColor = vec4(0.02, 0.025, 0.035, 1.0); return; }
  vec2 uv = vec2(mirror > 0.5 ? 1.0 - vUv.x : vUv.x, flip > 0.5 ? 1.0 - vUv.y : vUv.y);
  vec4 c = texture2D(map, uv);
  vec3 o = hdr > 0.5 ? srgb(aces(c.rgb)) : mix(vec3(0.03, 0.04, 0.07), c.rgb, c.a);   // the SHOW layer carries alpha: show it over dark blue
  if (rec > 0.5) {
    float edge = step(vUv.x, 0.04) + step(0.96, vUv.x) + step(vUv.y, 0.06) + step(0.94, vUv.y);
    if (edge > 0.5) o = mix(o, vec3(1.0, 0.12, 0.12), 0.85);
  }
  gl_FragColor = vec4(o, 1.0);
}`;

export class GoPro {
  // home(): { p: Vector3, yaw } in rig space (the starting spot)
  constructor(rig, home, key = KEY, defZoom = 'normal', opts = {}) {   // #389 GOPRO2; #795 opts.selfie = handle + front screen + red REC button
    this.key = key; this.defZoom = defZoom; this.rig = rig; this.home = home; this.on = false; this.held = false; this.zoom = defZoom; this.relT = 0;
    this.selfie = !!opts.selfie; this.recording = false; this.onRecTap = null; this._recT = 0;
    this.handleLen = this.selfie ? 0.068 : 0.012;   // #795 50% longer base/grip handle on GOPRO 2
    const g = this.obj = new THREE.Group(); g.name = 'gopro'; g.visible = false; g.userData.noMirror = true; rig.add(g);
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.55, metalness: 0.2 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.9 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x05070c, roughness: 0.05, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(B.w, B.h, B.d), dark); g.add(body);
    // lens on the front (-Z), shifted left to leave room for the front selfie screen on GOPRO 2
    const lx = this.selfie ? -0.016 : -0.012;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0125, 0.008, 24), rubber);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(lx, 0.004, -B.d / 2 - 0.004); g.add(barrel);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0088, 24), glass); lens.position.set(lx, 0.004, -B.d / 2 - 0.0081); lens.rotation.y = Math.PI; g.add(lens);
    this.lensLocal = new THREE.Vector3(lx, 0.004, -B.d / 2 - 0.009);
    // tally lamp on top, front corner
    this.tallyMat = new THREE.MeshBasicMaterial({ color: 0x300808, toneMapped: false });
    const tally = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 12, 8), this.tallyMat); tally.position.set(0.02, B.h / 2 + 0.0012, -B.d / 2 + 0.006); g.add(tally);
    // shutter / red record button on top
    this.recBtnMat = this.selfie
      ? new THREE.MeshStandardMaterial({ color: 0xd81820, emissive: 0x380406, emissiveIntensity: 0.7, roughness: 0.35, metalness: 0.1 })
      : rubber;
    const btnR = this.selfie ? 0.0068 : 0.004, btnH = this.selfie ? 0.0052 : 0.003;
    this.recBtnLocal = new THREE.Vector3(0.016, B.h / 2 + btnH / 2, 0.002);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(btnR, btnR, btnH, 20), this.recBtnMat); btn.position.copy(this.recBtnLocal); g.add(btn);
    // mount foot / extended selfie grip handle
    if (this.selfie) {
      const collar = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.010, 0.020), dark);
      collar.position.set(0, -B.h / 2 - 0.005, 0); g.add(collar);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.013, this.handleLen, 18), rubber);
      grip.position.set(0, -B.h / 2 - 0.008 - this.handleLen / 2, 0); g.add(grip);
      const accent = new THREE.Mesh(new THREE.CylinderGeometry(0.0122, 0.0122, 0.004, 18), new THREE.MeshStandardMaterial({ color: 0xc8202c, roughness: 0.5 }));
      accent.position.set(0, -B.h / 2 - 0.016, 0); g.add(accent);
    } else {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.012, 0.016), rubber); foot.position.set(0, -B.h / 2 - 0.006, 0); g.add(foot);
    }
    // viewfinder on the back (+Z)
    this.vfMat = new THREE.ShaderMaterial({ uniforms: { map: { value: null }, hdr: { value: 0 }, flip: { value: 0 }, mirror: { value: 0 }, on: { value: 0 }, rec: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: VF_FS });
    const vf = new THREE.Mesh(new THREE.PlaneGeometry(B.w - 0.008, (B.w - 0.008) * 9 / 16), this.vfMat); vf.position.set(0, 0.002, B.d / 2 + 0.0006); g.add(vf);
    // #795 mirrored front-facing selfie preview screen on GOPRO 2 (-Z face, right of the lens)
    this.frontVfMat = null;
    if (this.selfie) {
      this.frontVfMat = new THREE.ShaderMaterial({ uniforms: { map: { value: null }, hdr: { value: 0 }, flip: { value: 0 }, mirror: { value: 1 }, on: { value: 0 }, rec: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: VF_FS });
      const fvf = new THREE.Mesh(new THREE.PlaneGeometry(0.026, 0.026 * 9 / 16), this.frontVfMat);
      fvf.position.set(0.0145, 0.001, -B.d / 2 - 0.0007);
      fvf.rotation.y = Math.PI;
      g.add(fvf);
    }
    g.traverse(o => { if (o.isMesh) o.userData.gopro = true; });
    this.cam = new THREE.PerspectiveCamera(ZOOMS.normal.fov, 16 / 9, 0.05, 40);
    this.sp = new THREE.Vector3(); this.sq = new THREE.Quaternion(); this.smooth = false;
    this.isGoPro = true; this.mp = { save: () => this.save() };   // #591 the placement laser (movieprops.js Placer) picks it up
    this._load();
  }
  localBox() { return _box.set(_v.set(-B.w / 2 - 0.02, -B.h / 2 - this.handleLen - 0.02, -B.d / 2 - 0.02), _v2.set(B.w / 2 + 0.02, B.h / 2 + 0.025, B.d / 2 + 0.02)); }
  rayT(o, d) {   // distance along the laser to the body (+2 cm), -1 = missed
    if (!this.on || !this.obj.visible) return -1;
    const b = this.localBox().clone(); this.obj.updateWorldMatrix(true, false); _m.copy(this.obj.matrixWorld).invert();
    _ray.origin.copy(o).applyMatrix4(_m); _v.copy(o).add(d).applyMatrix4(_m).sub(_ray.origin); const L = _v.length(); if (L < 1e-9) return -1; _ray.direction.copy(_v).divideScalar(L);
    const h = _ray.intersectBox(b, _v); return h ? _ray.origin.distanceTo(h) / L : -1;
  }
  placeHandles() {}
  _load() {
    let s = null; try { s = JSON.parse(localStorage.getItem(this.key) || 'null'); } catch {}
    if (s && s.p && s.q) { this.obj.position.fromArray(s.p); this.obj.quaternion.fromArray(s.q); } else this.reset(false);
    if (s && ZOOMS[s.zoom]) this.zoom = s.zoom;
    this.setOn(!!(s && s.on), false);
  }
  save() { try { localStorage.setItem(this.key, JSON.stringify({ on: this.on, p: this.obj.position.toArray(), q: this.obj.quaternion.toArray(), zoom: this.zoom })); } catch {} }
  reset(save = true) {
    const h = this.home(); this.obj.position.copy(h.p); this.obj.quaternion.setFromEuler(new THREE.Euler(h.pitch || 0, h.yaw, 0, 'YXZ'));
    this.smooth = false; if (save) this.save();
  }
  setOn(on, save = true) { this.on = !!on; this.obj.visible = this.on; this.held = false; this.smooth = false; if (save) this.save(); }
  setZoom(z) { if (ZOOMS[z]) { this.zoom = z; this.save(); } }
  nextZoom() { const k = Object.keys(ZOOMS); this.setZoom(k[(k.indexOf(this.zoom) + 1) % k.length]); }
  get aiming() { return this.on && (this.held || performance.now() - this.relT < 3000); }
  recBtnHit(P) {   // #795 top red record button tap zone (GOPRO 2 selfie cam)
    if (!this.on || !this.selfie || !this.onRecTap) return false;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P));
    return l.y > B.h / 2 - 0.008 && l.distanceTo(this.recBtnLocal) < 0.028;
  }
  hit(P) {   // grab box: body + extended grip handle + 3 cm
    if (!this.on) return false;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P));
    return Math.abs(l.x) < B.w / 2 + 0.03 && l.y > -B.h / 2 - this.handleLen - 0.03 && l.y < B.h / 2 + 0.025 && Math.abs(l.z) < B.d / 2 + 0.03;
  }
  grab() { this.held = true; }
  hold(world) {   // the hand's pose x the grab offset, in world space -> rig space (no scale)
    this.rig.updateMatrixWorld(); _m.copy(this.rig.matrixWorld).invert().multiply(world);
    _m.decompose(this.obj.position, this.obj.quaternion, _s);
  }
  release() { this.held = false; this.relT = performance.now(); this.save(); }
  setTally(on) { this.tallyMat.color.setHex((on || this.recording) ? 0xff2020 : 0x300808); }
  setRec(on) {
    this.recording = !!on;
    this.vfMat.uniforms.rec.value = this.recording ? 1 : 0;
    if (this.frontVfMat) this.frontVfMat.uniforms.rec.value = this.recording ? 1 : 0;
    if (this.selfie && this.recBtnMat.emissive) {
      this.recBtnMat.emissive.setHex(this.recording ? 0xff1818 : 0x380406);
      this.recBtnMat.emissiveIntensity = this.recording ? 1.8 : 0.7;
    }
    this.setTally(this.recording);
  }
  // the viewfinder: tex = a texture, hdr = linear HDR (DJ CAM target), flip = rows stored top-down (stream layer)
  setView(tex, hdr, flip) {
    for (const mat of [this.vfMat, this.frontVfMat]) {
      if (!mat) continue;
      const u = mat.uniforms; u.map.value = tex || null; u.on.value = tex ? 1 : 0; u.hdr.value = hdr ? 1 : 0; u.flip.value = flip ? 1 : 0;
    }
  }
  // per frame: the camera follows the lens, smoothed while held (~0.15 s), exactly when at rest
  tick(dt) {
    if (!this.on) return;
    if (this.recording && this.selfie && this.recBtnMat.emissive) {
      this._recT += dt * 5;
      this.recBtnMat.emissiveIntensity = 1.2 + 0.8 * Math.sin(this._recT);
    }
    this.obj.updateMatrixWorld();
    const p = this.obj.localToWorld(_v.copy(this.lensLocal)), q = this.obj.getWorldQuaternion(_q);
    if (!this.smooth || !this.held) { this.sp.copy(p); this.sq.copy(q); this.smooth = true; }
    else { const k = 1 - Math.exp(-dt * 7); this.sp.lerp(p, k); this.sq.slerp(q, k); }
    this.cam.position.copy(this.sp); this.cam.quaternion.copy(this.sq);
    const fov = ZOOMS[this.zoom].fov; if (this.cam.fov !== fov) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
    this.cam.updateMatrixWorld(true);
  }
}
const _v2 = new THREE.Vector3(), _box = new THREE.Box3(), _ray = new THREE.Ray();
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
