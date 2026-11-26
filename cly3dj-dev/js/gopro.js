// #337 GOPRO (owner): action camera in the scene that films SHOW (and the LED wall's AVACAM).
// Upgraded with actioncam_lowpoly.glb (1,152 tris, 512px JPEG), cylinder grip handle, top REC button
// with flashing red ring, side near-lens tap buttons (MIST / DoF), front LED dot-matrix readout,
// and live rear viewfinder + front selfie screen.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';
import { drawBitText } from './tools.js';

const KEY = 'vire.gopro';
export const ZOOMS = { wide: { label: 'WIDE', fov: 62 }, normal: { label: 'NORMAL', fov: 46 }, tight: { label: 'TIGHT', fov: 30 } };   // vertical fov at 16:9
const B = { w: 0.064, h: 0.046, d: 0.034 };   // body, metres (GoPro-sized)

let _glbPromise = null;
function loadActionCamGlb() {
  if (!_glbPromise) {
    _glbPromise = new GLTFLoader().loadAsync('./models/props/actioncam_lowpoly.glb').then(gltf => {
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const sz = box.getSize(new THREE.Vector3());
      const ctr = box.getCenter(new THREE.Vector3());
      const s = B.w / Math.max(sz.x, sz.z, 1e-4);
      const wrap = new THREE.Group();
      root.position.set(-ctr.x, -ctr.y, -ctr.z);
      wrap.add(root);
      wrap.scale.setScalar(s);
      wrap.rotation.y = Math.PI;   // GLB front lens faces +Z natively; rotate 180 deg so lens faces -Z (camera forward)
      wrap.traverse(o => { if (o.isMesh) { o.userData.gopro = true; o.castShadow = false; } });
      return wrap;
    }).catch(e => { console.warn('actioncam_lowpoly.glb fallback:', e); return null; });
  }
  return _glbPromise.then(w => w ? w.clone(true) : null);
}

const VF_FS = `uniform sampler2D map; uniform float hdr; uniform float flip; uniform float mirror; uniform float on; uniform float rec; varying vec2 vUv;
vec3 rrt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= 1.0 / 0.6; return clamp(O * rrt(I * c), 0.0, 1.0); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
void main() {
  if (on < 0.5) { gl_FragColor = vec4(0.02, 0.025, 0.035, 1.0); return; }
  vec2 uv = vec2(mirror > 0.5 ? 1.0 - vUv.x : vUv.x, flip > 0.5 ? 1.0 - vUv.y : vUv.y);
  vec4 c = texture2D(map, uv);
  vec3 o = hdr > 0.5 ? srgb(aces(max(c.rgb, 0.0))) : mix(vec3(0.03, 0.04, 0.07), c.rgb, c.a);
  if (rec > 0.5) {
    float edge = step(vUv.x, 0.04) + step(0.96, vUv.x) + step(vUv.y, 0.06) + step(0.94, vUv.y);
    if (edge > 0.5) o = mix(o, vec3(1.0, 0.12, 0.12), 0.88);
  }
  gl_FragColor = vec4(o, 1.0);
}`;

export class GoPro {
  // home(): { p: Vector3, yaw } in rig space (the starting spot)
  constructor(rig, home, key = KEY, defZoom = 'normal', opts = {}) {   // #389 GOPRO2; #795 opts.selfie = handle + front screen + red REC button
    this.key = key; this.defZoom = defZoom; this.rig = rig; this.home = home; this.on = false; this.held = false; this.zoom = defZoom; this.relT = 0;
    this.selfie = !!opts.selfie; this.recording = false; this.onRecTap = null; this.onMistTap = null; this.onDofTap = null;
    this._recT = 0; this._recSec = -1; this._ledKey = '';
    this.mistLabel = '1/2'; this.dofLabel = 'AUTO';
    this.handleLen = this.selfie ? 0.072 : 0.058;

    const g = this.obj = new THREE.Group(); g.name = 'gopro'; g.visible = false; g.userData.noMirror = true; rig.add(g);
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.55, metalness: 0.2 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.9 });

    // Fallback body (hidden once actioncam_lowpoly.glb finishes loading)
    const fallbackBody = new THREE.Mesh(new THREE.BoxGeometry(B.w, B.h, B.d), dark);
    g.add(fallbackBody);
    loadActionCamGlb().then(model => {
      if (!model) return;
      g.add(model);
      fallbackBody.visible = false;
    });

    // Lens position on the front (-Z)
    this.lensLocal = new THREE.Vector3(-0.0177, 0.0040, -0.020);

    // Tally lamp on top front corner
    this.tallyMat = new THREE.MeshBasicMaterial({ color: 0x300808, toneMapped: false });
    const tally = new THREE.Mesh(new THREE.SphereGeometry(0.0026, 12, 8), this.tallyMat);
    tally.position.set(0.019, 0.0222, -0.012);
    g.add(tally);

    // Top REC button + flashing red emissive ring (exact Blender placement, rotated 180 deg Y to match -Z forward)
    this.recBtnMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.523, 0.07, 0.07), emissive: 0x280404, emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.1 });
    this.recBtnLocal = new THREE.Vector3(-0.016, 0.0230, 0.0);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.0068, 0.0068, 0.005, 20), this.recBtnMat);
    btn.position.copy(this.recBtnLocal);
    g.add(btn);

    this.recRingMat = new THREE.MeshBasicMaterial({ color: 0x4a0808, toneMapped: false });
    const recRing = new THREE.Mesh(new THREE.TorusGeometry(0.0082, 0.0012, 10, 24), this.recRingMat);
    recRing.rotation.x = Math.PI / 2;
    recRing.position.set(this.recBtnLocal.x, 0.0214, this.recBtnLocal.z);
    g.add(recRing);

    // Side tap buttons (exact Blender placement & muted colors, +X side near front -Z)
    this.mistBtnMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.214, 0.136, 0.014), emissive: new THREE.Color(0.18, 0.11, 0.01), emissiveIntensity: 0.45, roughness: 0.5 });
    this.mistBtnLocal = new THREE.Vector3(0.03179, 0.008, -0.005);
    const mistBtn = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.011, 0.009), this.mistBtnMat);
    mistBtn.position.copy(this.mistBtnLocal);
    g.add(mistBtn);

    this.dofBtnMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.048, 0.163, 0.214), emissive: new THREE.Color(0.03, 0.12, 0.17), emissiveIntensity: 0.45, roughness: 0.5 });
    this.dofBtnLocal = new THREE.Vector3(0.03159, -0.008, -0.005);
    const dofBtn = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.011, 0.009), this.dofBtnMat);
    dofBtn.position.copy(this.dofBtnLocal);
    g.add(dofBtn);

    // Cylinder grip handle flush with bottom of camera (exact Blender placement)
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.072, 20), rubber);
    grip.position.set(0.0, -0.05871, 0.0022);
    g.add(grip);
    const accent = new THREE.Mesh(new THREE.CylinderGeometry(0.0124, 0.0124, 0.0035, 20), new THREE.MeshStandardMaterial({ color: 0x851212, roughness: 0.5 }));
    accent.position.set(0.0, -0.031, 0.0022);
    g.add(accent);

    // Rear main viewfinder (+Z face, exact Blender SCREEN_BACK placement)
    this.vfMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, hdr: { value: 0 }, flip: { value: 0 }, mirror: { value: 0 }, on: { value: 0 }, rec: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: VF_FS, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const vf = new THREE.Mesh(new THREE.PlaneGeometry(0.055, 0.031), this.vfMat);
    vf.position.set(0.0, 0.0, 0.0175);
    g.add(vf);

    // Front mirrored selfie preview screen (-Z face, exact Blender SCREEN_SELFIE placement)
    this.frontVfMat = null;
    if (this.selfie) {
      this.frontVfMat = new THREE.ShaderMaterial({
        uniforms: { map: { value: null }, hdr: { value: 0 }, flip: { value: 0 }, mirror: { value: 1 }, on: { value: 0 }, rec: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: VF_FS, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const fvf = new THREE.Mesh(new THREE.PlaneGeometry(0.025, 0.015), this.frontVfMat);
      fvf.position.set(0.01295, 0.00304, -0.0122);
      fvf.rotation.y = Math.PI;
      g.add(fvf);
    }

    // Front LED dot-matrix status readout (exact Blender LED_READOUT placement over lens area, -Z face)
    this._ledCanvas = document.createElement('canvas');
    this._ledCanvas.width = 128; this._ledCanvas.height = 64;
    this._ledTex = new THREE.CanvasTexture(this._ledCanvas);
    this._ledTex.colorSpace = THREE.SRGBColorSpace;
    this._ledTex.minFilter = THREE.LinearFilter; this._ledTex.magFilter = THREE.NearestFilter;
    this._ledMat = new THREE.MeshBasicMaterial({ map: this._ledTex, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const ledMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.022, 0.012), this._ledMat);
    ledMesh.position.set(-0.0177, 0.00401, -0.0178);
    ledMesh.rotation.y = Math.PI;
    g.add(ledMesh);
    this.updateLed(this.mistLabel, this.dofLabel, 0);

    g.traverse(o => { if (o.isMesh) o.userData.gopro = true; });
    this.cam = new THREE.PerspectiveCamera(ZOOMS.normal.fov, 16 / 9, 0.05, 40);
    this.sp = new THREE.Vector3(); this.sq = new THREE.Quaternion(); this.smooth = false;
    this.isGoPro = true; this.mp = { save: () => this.save() };   // #591 the placement laser (movieprops.js Placer) picks it up
    this._load();
  }

  updateLed(mistLabel = this.mistLabel, dofLabel = this.dofLabel, recSecs = 0) {
    this.mistLabel = String(mistLabel || 'OFF').toUpperCase();
    this.dofLabel = String(dofLabel || 'AUTO').toUpperCase();
    const sec = this.recording ? Math.floor(recSecs) : -1;
    const key = `${this.mistLabel}|${this.dofLabel}|${sec}`;
    if (key === this._ledKey) return;
    this._ledKey = key;

    const c = this._ledCanvas, g = c.getContext('2d');
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, c.width, c.height);
    // Subtle dot-matrix grid backdrop
    g.fillStyle = '#0f1722';
    for (let y = 2; y < c.height; y += 4) for (let x = 2; x < c.width; x += 4) g.fillRect(x, y, 1, 1);

    drawBitText(g, `MIST:${this.mistLabel}`, 6, 6, 2, '#fbbf24', false);
    drawBitText(g, `DOF:${this.dofLabel}`, 6, 25, 2, '#38bdf8', false);
    if (this.recording) {
      const mm = String(Math.floor(Math.max(0, sec) / 60)).padStart(2, '0');
      const ss = String(Math.max(0, sec) % 60).padStart(2, '0');
      drawBitText(g, `REC ${mm}:${ss}`, 6, 44, 2, '#ef4444', false);
    } else {
      drawBitText(g, 'STBY 720P', 6, 44, 2, '#64748b', false);
    }
    this._ledTex.needsUpdate = true;
  }

  localBox() { return _box.set(_v.set(-B.w / 2 - 0.02, -B.h / 2 - this.handleLen - 0.02, -B.d / 2 - 0.02), _v2.set(B.w / 2 + 0.02, B.h / 2 + 0.025, B.d / 2 + 0.02)); }
  rayT(o, d) {
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
  recBtnHit(P) {   // top red record button tap zone
    if (!this.on || !this.onRecTap) return false;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P));
    return l.y > 0.014 && l.distanceTo(this.recBtnLocal) < 0.028;
  }
  sideBtnHit(P) {  // side near-lens tap buttons (+X edge): returns 'mist' | 'dof' | null
    if (!this.on) return null;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P));
    if (l.x < B.w / 2 - 0.012) return null;
    if (this.onMistTap && l.distanceTo(this.mistBtnLocal) < 0.018) return 'mist';
    if (this.onDofTap && l.distanceTo(this.dofBtnLocal) < 0.018) return 'dof';
    return null;
  }
  hit(P) {   // grab box: body + grip handle + 3 cm
    if (!this.on) return false;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P));
    return Math.abs(l.x) < B.w / 2 + 0.03 && l.y > -B.h / 2 - this.handleLen - 0.03 && l.y < B.h / 2 + 0.025 && Math.abs(l.z) < B.d / 2 + 0.03;
  }
  grab() { this.held = true; }
  hold(world) {
    this.rig.updateMatrixWorld(); _m.copy(this.rig.matrixWorld).invert().multiply(world);
    _m.decompose(this.obj.position, this.obj.quaternion, _s);
  }
  release() { this.held = false; this.relT = performance.now(); this.save(); }
  setTally(on) { this.tallyMat.color.setHex((on || this.recording) ? 0xff2020 : 0x300808); }
  setRec(on) {
    this.recording = !!on;
    this.vfMat.uniforms.rec.value = this.recording ? 1 : 0;
    if (this.frontVfMat) this.frontVfMat.uniforms.rec.value = this.recording ? 1 : 0;
    if (this.recBtnMat.emissive) {
      this.recBtnMat.emissive.setHex(this.recording ? 0xff1818 : 0x380406);
      this.recBtnMat.emissiveIntensity = this.recording ? 1.8 : 0.7;
    }
    this.recRingMat.color.setHex(this.recording ? 0xff2020 : 0x5a0808);
    this.setTally(this.recording);
    this.updateLed(this.mistLabel, this.dofLabel, 0);
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
    if (this.recording) {
      this._recT += dt * 6;
      const pulse = 0.5 + 0.5 * Math.sin(this._recT);
      if (this.recBtnMat.emissive) this.recBtnMat.emissiveIntensity = 1.0 + 1.0 * pulse;
      this.recRingMat.color.setRGB(0.35 + 0.65 * pulse, 0.03 + 0.08 * pulse, 0.03 + 0.08 * pulse);
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
