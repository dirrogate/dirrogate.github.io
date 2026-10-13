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

const VF_FS = `uniform sampler2D map; uniform float hdr; uniform float flip; uniform float on; varying vec2 vUv;
vec3 rrt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= 1.0 / 0.6; return clamp(O * rrt(I * c), 0.0, 1.0); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
void main() {
  if (on < 0.5) { gl_FragColor = vec4(0.02, 0.025, 0.035, 1.0); return; }
  vec2 uv = vec2(vUv.x, flip > 0.5 ? 1.0 - vUv.y : vUv.y);
  vec4 c = texture2D(map, uv);
  vec3 o = hdr > 0.5 ? srgb(aces(c.rgb)) : mix(vec3(0.03, 0.04, 0.07), c.rgb, c.a);   // the SHOW layer carries alpha: show it over dark blue
  gl_FragColor = vec4(o, 1.0);
}`;

export class GoPro {
  // home(): { p: Vector3, yaw } in rig space (the starting spot)
  constructor(rig, home) {
    this.rig = rig; this.home = home; this.on = false; this.held = false; this.zoom = 'normal'; this.relT = 0;
    const g = this.obj = new THREE.Group(); g.name = 'gopro'; g.visible = false; g.userData.noMirror = true; rig.add(g);
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.55, metalness: 0.2 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.9 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x05070c, roughness: 0.05, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(B.w, B.h, B.d), dark); g.add(body);
    // lens on the front (-Z), a little to the left like the real thing
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0135, 0.008, 24), rubber);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(-0.012, 0.004, -B.d / 2 - 0.004); g.add(barrel);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0095, 24), glass); lens.position.set(-0.012, 0.004, -B.d / 2 - 0.0081); lens.rotation.y = Math.PI; g.add(lens);
    this.lensLocal = new THREE.Vector3(-0.012, 0.004, -B.d / 2 - 0.009);
    // tally lamp on top, front corner
    this.tallyMat = new THREE.MeshBasicMaterial({ color: 0x300808, toneMapped: false });
    const tally = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 12, 8), this.tallyMat); tally.position.set(0.02, B.h / 2 + 0.001, -B.d / 2 + 0.006); g.add(tally);
    // shutter button and a small mount foot
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.003, 16), rubber); btn.position.set(0.016, B.h / 2 + 0.0015, 0.002); g.add(btn);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.012, 0.016), rubber); foot.position.set(0, -B.h / 2 - 0.006, 0); g.add(foot);
    // viewfinder on the back (+Z)
    this.vfMat = new THREE.ShaderMaterial({ uniforms: { map: { value: null }, hdr: { value: 0 }, flip: { value: 0 }, on: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: VF_FS });
    const vf = new THREE.Mesh(new THREE.PlaneGeometry(B.w - 0.008, (B.w - 0.008) * 9 / 16), this.vfMat); vf.position.set(0, 0.002, B.d / 2 + 0.0006); g.add(vf);
    g.traverse(o => { if (o.isMesh) o.userData.gopro = true; });
    this.cam = new THREE.PerspectiveCamera(ZOOMS.normal.fov, 16 / 9, 0.05, 40);
    this.sp = new THREE.Vector3(); this.sq = new THREE.Quaternion(); this.smooth = false;
    this._load();
  }
  _load() {
    let s = null; try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
    if (s && s.p && s.q) { this.obj.position.fromArray(s.p); this.obj.quaternion.fromArray(s.q); } else this.reset(false);
    if (s && ZOOMS[s.zoom]) this.zoom = s.zoom;
    this.setOn(!!(s && s.on), false);
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify({ on: this.on, p: this.obj.position.toArray(), q: this.obj.quaternion.toArray(), zoom: this.zoom })); } catch {} }
  reset(save = true) {
    const h = this.home(); this.obj.position.copy(h.p); this.obj.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.yaw);
    this.smooth = false; if (save) this.save();
  }
  setOn(on, save = true) { this.on = !!on; this.obj.visible = this.on; this.held = false; this.smooth = false; if (save) this.save(); }
  setZoom(z) { if (ZOOMS[z]) { this.zoom = z; this.save(); } }
  nextZoom() { const k = Object.keys(ZOOMS); this.setZoom(k[(k.indexOf(this.zoom) + 1) % k.length]); }
  get aiming() { return this.on && (this.held || performance.now() - this.relT < 3000); }
  hit(P) {   // grab box: body + 3 cm
    if (!this.on) return false;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P));
    return Math.abs(l.x) < B.w / 2 + 0.03 && Math.abs(l.y) < B.h / 2 + 0.03 && Math.abs(l.z) < B.d / 2 + 0.03;
  }
  grab() { this.held = true; }
  hold(world) {   // the hand's pose x the grab offset, in world space -> rig space (no scale)
    this.rig.updateMatrixWorld(); _m.copy(this.rig.matrixWorld).invert().multiply(world);
    _m.decompose(this.obj.position, this.obj.quaternion, _s);
  }
  release() { this.held = false; this.relT = performance.now(); this.save(); }
  setTally(on) { this.tallyMat.color.setHex(on ? 0xff2020 : 0x300808); }
  // the viewfinder: tex = a texture, hdr = linear HDR (DJ CAM target), flip = rows stored top-down (stream layer)
  setView(tex, hdr, flip) { const u = this.vfMat.uniforms; u.map.value = tex || null; u.on.value = tex ? 1 : 0; u.hdr.value = hdr ? 1 : 0; u.flip.value = flip ? 1 : 0; }
  // per frame: the camera follows the lens, smoothed while held (~0.15 s), exactly when at rest
  tick(dt) {
    if (!this.on) return;
    this.obj.updateMatrixWorld();
    const p = this.obj.localToWorld(_v.copy(this.lensLocal)), q = this.obj.getWorldQuaternion(_q);
    if (!this.smooth || !this.held) { this.sp.copy(p); this.sq.copy(q); this.smooth = true; }
    else { const k = 1 - Math.exp(-dt * 7); this.sp.lerp(p, k); this.sq.slerp(q, k); }
    this.cam.position.copy(this.sp); this.cam.quaternion.copy(this.sq);
    const fov = ZOOMS[this.zoom].fov; if (this.cam.fov !== fov) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
    this.cam.updateMatrixWorld(true);
  }
}
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
