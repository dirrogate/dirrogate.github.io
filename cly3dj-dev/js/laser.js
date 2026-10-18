// #406 LASER (owner, #371): one movable laser head, GoPro-style (grip / pinch picks it up, no gravity, stays where it
// is let go). RGB beams in haze: BEAM, FAN, SWEEP, TUNNEL, WAVE, SCAN; colours red / green / blue / yellow / cyan /
// magenta / white or RGB (each beam its own hue). AUTO = the helpers: patterns and colours change on the bass beats
// (beat.js), speed follows the beat, a punch on each beat, dimmed in breakdowns. The owner moderates it himself.
// The beams are drawn as camera-facing ribbons (one InstancedMesh, one draw call, additive, framebuffer alpha left
// alone so they show over passthrough); width never drops under ~2 headset pixels (no shimmer); haze sets how much
// light the air scatters (visibility and fall-off); a beam that meets the floor stops there and leaves a dot.
// On layer 0: the headset, AVACAM, SHOWTIME!, HEADSET CAM, PHONE CAM, CLY3DTV and Twitch all see it.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/three/utils/BufferGeometryUtils.js';
import { lightBlend } from './neon.js';

const KEY = 'vire.laser', MAX = 24;
export const PATTERNS = ['beam', 'fan', 'sweep', 'cone', 'wave', 'scan'];
export const PAT_LABEL = { beam: 'BEAM', fan: 'FAN', sweep: 'SWEEP', cone: 'TUNNEL', wave: 'WAVE', scan: 'SCAN' };
export const COLOURS = { red: [1, 0.02, 0.02], green: [0.04, 1, 0.06], blue: [0.08, 0.22, 1], yellow: [1, 0.72, 0.02], cyan: [0.04, 0.85, 1], magenta: [1, 0.04, 0.75], white: [1, 0.9, 0.82], rgb: null };
export const COL_LABEL = { red: 'RED', green: 'GREEN', blue: 'BLUE', yellow: 'YELLOW', cyan: 'CYAN', magenta: 'MAGENTA', white: 'WHITE', rgb: 'RGB' };
export const LIMITS = { n: [1, MAX, 1], spread: [10, 140, 10], speed: [0.25, 3, 0.25], haze: [0.1, 1, 0.1], len: [2, 15, 1] };
const DEF = { pat: 'fan', col: 'green', auto: true, n: 8, spread: 60, speed: 1, haze: 0.7, len: 10 };
const B = { w: 0.14, h: 0.07, d: 0.16 };   // the head, metres
const AP = new THREE.Vector3(0.035, 0.004, -B.d / 2 - 0.004);   // aperture (beams start here), front panel, right of centre

const BEAM_VS = `attribute vec3 aDir; attribute vec3 aCol; attribute float aLen;
uniform float uLen; varying vec2 vUv; varying vec3 vCol; varying float vFwd; varying float vK;
void main() {
  vec3 o = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 d = normalize(mat3(modelMatrix) * aDir);
  float s = uv.y * aLen;                                   // metres from the aperture
  vec3 p = o + d * s;
  vec3 toC = cameraPosition - p; float dist = length(toC); vec3 v = toC / max(dist, 1e-4);
  vec3 side = cross(d, v); float sl = length(side); side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  float wPhys = 0.003 + 0.0016 * s;                        // beam diameter: 3 mm at the head, slow divergence
  float c = max(wPhys, dist * 0.0016);                     // never under ~2 headset pixels
  p += side * (uv.x - 0.5) * c * 8.0;                      // ribbon = core + halo
  vK = sqrt(wPhys / c);                                    // a widened far beam is dimmer per pixel (same light)
  vUv = vec2((uv.x - 0.5) * 8.0, uv.y * aLen / max(uLen, 1e-3)); vCol = aCol; vFwd = dot(d, v);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const BEAM_FS = `uniform float uHaze; uniform float uDecay; varying vec2 vUv; varying vec3 vCol; varying float vFwd; varying float vK;
void main() {
  float x = vUv.x;
  float prof = exp(-2.0 * x * x) * 1.4 + exp(-x * x * 0.25) * (0.1 + 0.2 * uHaze);
  float along = exp(-vUv.y * uDecay) * smoothstep(1.0, 0.82, vUv.y) * smoothstep(0.0, 0.01, vUv.y);
  float fwd = 1.0 + 3.0 * pow(max(vFwd, 0.0), 14.0);       // haze scatters forward: a beam coming at you is brighter
  gl_FragColor = vec4(vCol * prof * along * fwd * vK * uHaze, 0.0);
}`;
const SPOT_VS = `attribute vec3 aCol; varying vec2 vUv; varying vec3 vCol;
void main() { vUv = uv - 0.5; vCol = aCol; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`;
const SPOT_FS = `varying vec2 vUv; varying vec3 vCol;
void main() { float r2 = dot(vUv, vUv) * 4.0; gl_FragColor = vec4(vCol * (exp(-r2 * 60.0) * 2.0 + exp(-r2 * 6.0) * 0.12), 0.0); }`;

function hsv(h, out) {   // laser RGB from a hue: pure diode mixes, fully saturated
  const k = n => { const t = (n + h * 6) % 6; return 1 - Math.max(0, Math.min(1, Math.min(t, 4 - t))); };
  out[0] = k(5); out[1] = k(3); out[2] = k(1); return out;
}

export class Laser {
  // home(): { p: Vector3, yaw, pitch } in rig space
  constructor(rig, home) {
    this.rig = rig; this.home = home; this.on = false; this.held = false;
    Object.assign(this, DEF);
    this.room = null;   // #411 Space Setup planes in rig space (setRoom), beams stop on them
    this.ph = 0; this.kick = 0; this.dim = 1; this._bc = -1; this.beats = 0; this.lastBeat = 0; this.iv = 500; this.tapT = 0;
    const g = this.obj = new THREE.Group(); g.name = 'laser'; g.visible = false; g.userData.noMirror = true; rig.add(g);
    // head: black anodised body, heat-sink fins on top, front panel with the exit window, key switch, status LED, feet
    const alu = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.42, metalness: 0.65 });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(B.w, B.h, B.d), alu));
    const fins = [];
    for (let i = 0; i < 9; i++) fins.push(new THREE.BoxGeometry(0.003, 0.012, B.d - 0.03).translate(-B.w / 2 + 0.014 + i * (B.w - 0.028) / 8, B.h / 2 + 0.006, 0));
    for (let i = 0; i < 4; i++) fins.push(new THREE.BoxGeometry(0.018, 0.006, 0.018).translate((i % 2 ? 1 : -1) * (B.w / 2 - 0.016), -B.h / 2 - 0.003, (i < 2 ? 1 : -1) * (B.d / 2 - 0.018)));
    g.add(new THREE.Mesh(mergeGeometries(fins), alu));
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(B.w - 0.01, B.h - 0.01), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.6, metalness: 0.3 }));
    panel.position.set(0, 0, -B.d / 2 - 0.0006); panel.rotation.y = Math.PI; g.add(panel);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.006, 24), new THREE.MeshStandardMaterial({ color: 0x8c9098, roughness: 0.3, metalness: 1 }));
    ring.rotation.x = Math.PI / 2; ring.position.set(AP.x, AP.y, -B.d / 2 - 0.002); g.add(ring);
    this.winMat = new THREE.MeshBasicMaterial({ color: 0x050608, toneMapped: false });
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.0075, 24), this.winMat); win.position.set(AP.x, AP.y, -B.d / 2 - 0.0052); win.rotation.y = Math.PI; g.add(win);
    this.ledMat = new THREE.MeshBasicMaterial({ color: 0x062006, toneMapped: false });
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.0025, 12), this.ledMat); led.position.set(-0.045, 0.018, -B.d / 2 - 0.0012); led.rotation.y = Math.PI; g.add(led);
    const key = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 16), new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.25, metalness: 1 }));
    key.rotation.x = Math.PI / 2; key.position.set(-0.045, -0.012, -B.d / 2 - 0.003); g.add(key);
    g.traverse(o => { if (o.isMesh) o.userData.laser = true; });
    // beams: one ribbon instance per beam, from the aperture (beam frame = head frame moved to the aperture)
    const ap = this.ap = new THREE.Group(); ap.position.copy(AP); g.add(ap);
    const geo = new THREE.InstancedBufferGeometry(); const pl = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
    geo.index = pl.index; geo.setAttribute('position', pl.attributes.position); geo.setAttribute('uv', pl.attributes.uv);
    this.aDir = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3); this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.aLen = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    for (const a of [this.aDir, this.aCol, this.aLen]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aDir', this.aDir); geo.setAttribute('aCol', this.aCol); geo.setAttribute('aLen', this.aLen); geo.instanceCount = 0;
    this.bMat = lightBlend(new THREE.ShaderMaterial({ uniforms: { uLen: { value: 10 }, uHaze: { value: 0.7 }, uDecay: { value: 0.5 } }, vertexShader: BEAM_VS, fragmentShader: BEAM_FS, side: THREE.DoubleSide }));
    this.beams = new THREE.Mesh(geo, this.bMat); this.beams.frustumCulled = false; this.beams.renderOrder = 5; this.beams.raycast = () => {}; ap.add(this.beams);
    // glow at the exit window (where every beam starts; brightest when one points at you)
    const gc = document.createElement('canvas'); gc.width = gc.height = 64; const gx = gc.getContext('2d');
    const gr = gx.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    gx.fillStyle = gr; gx.fillRect(0, 0, 64, 64);
    this.glowMat = lightBlend(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), color: 0x000000, toneMapped: false }));
    this.glow = new THREE.Sprite(this.glowMat); this.glow.scale.setScalar(0.05); this.glow.raycast = () => {}; ap.add(this.glow);
    // dots where beams meet the floor (rig space)
    const sg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const sMat = lightBlend(new THREE.ShaderMaterial({ vertexShader: SPOT_VS, fragmentShader: SPOT_FS }));
    this.sCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3); this.sCol.setUsage(THREE.DynamicDrawUsage); sg.setAttribute('aCol', this.sCol);
    this.spots = new THREE.InstancedMesh(sg, sMat, MAX); this.spots.count = 0; this.spots.frustumCulled = false; this.spots.raycast = () => {};
    this.spots.userData.noMirror = true; this.spots.visible = false; rig.add(this.spots);
    this.seeds = Array.from({ length: MAX }, (_, i) => [0.7 + ((i * 0.618) % 1) * 0.8, ((i * 2.17) % 6.28), 0.6 + ((i * 0.37) % 1), ((i * 1.31) % 6.28)]);
    this._load();
  }
  _load() {
    let s = null; try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
    if (s && s.p && s.q) { this.obj.position.fromArray(s.p); this.obj.quaternion.fromArray(s.q); } else this.reset(false);
    if (s) for (const k of Object.keys(DEF)) if (s[k] !== undefined) this[k] = s[k];
    if (!PATTERNS.includes(this.pat)) this.pat = DEF.pat; if (!(this.col in COLOURS)) this.col = DEF.col;
    for (const k of Object.keys(LIMITS)) this[k] = this._clamp(k, +this[k] || DEF[k]);
    this.setOn(!!(s && s.on), false);
  }
  save() { const o = { on: this.on, p: this.obj.position.toArray(), q: this.obj.quaternion.toArray() }; for (const k of Object.keys(DEF)) o[k] = this[k]; try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {} }
  reset(save = true) { const h = this.home(); this.obj.position.copy(h.p); this.obj.quaternion.setFromEuler(new THREE.Euler(h.pitch || 0, h.yaw, 0, 'YXZ')); if (save) this.save(); }
  setOn(on, save = true) { this.on = !!on; this.obj.visible = this.on; this.spots.visible = this.on; this.held = false; if (save) this.save(); }
  _clamp(k, v) { const [a, b, st] = LIMITS[k]; return Math.round(Math.min(b, Math.max(a, v)) / st) * st; }
  set(k, v) { if (k in LIMITS) v = this._clamp(k, v); this[k] = v; this.save(); }
  step(k, d) { this.set(k, this[k] + d * LIMITS[k][2]); }
  // the tablet picks a pattern / colour: AUTO keeps running from there (it changes them on the beat)
  setPat(p) { if (PATTERNS.includes(p)) { this.pat = p; this.save(); } }
  setCol(c) { if (c in COLOURS) { this.col = c; this.save(); } }
  // #411 planes: [{ inv: Matrix4 rig -> plane, q: Quaternion plane -> rig, poly: Float32Array x,z pairs in plane space }] or null
  setRoom(list) { this.room = list && list.length ? list : null; }
  hit(P) {   // grab box: head + 3 cm
    if (!this.on) return false;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P));
    return Math.abs(l.x) < B.w / 2 + 0.03 && Math.abs(l.y) < B.h / 2 + 0.04 && Math.abs(l.z) < B.d / 2 + 0.03;
  }
  grab() { this.held = true; }
  hold(world) { this.rig.updateMatrixWorld(); _m.copy(this.rig.matrixWorld).invert().multiply(world); _m.decompose(this.obj.position, this.obj.quaternion, _s); }
  release() { this.held = false; this.save(); }
  // per frame. beat = the Beat detector (count goes up on each bass onset), camPos = the viewer (world) for the window glow
  tick(dt, beat, camPos) {
    if (!this.on) return;
    const now = performance.now();
    let rate = this.speed;
    if (this.auto && beat) {
      if (this._bc < 0) this._bc = beat.count;
      if (beat.count !== this._bc) {   // a bass beat
        this._bc = beat.count; this.beats++; this.kick = 1;
        const iv = now - this.lastBeat; if (iv > 260 && iv < 1500) this.iv += (iv - this.iv) * 0.25; this.lastBeat = now;
        if (this.beats % 16 === 0) { const o = PATTERNS.filter(p => p !== this.pat && p !== 'beam'); this.pat = o[Math.floor(Math.random() * o.length)]; }
        else if (this.beats % 8 === 0) { const o = Object.keys(COLOURS).filter(c => c !== this.col); this.col = o[Math.floor(Math.random() * o.length)]; }
        this.ph += 0.12;
      }
      const quiet = now - this.lastBeat > 4000;                     // breakdown / no music: slow and dim
      this.dim += ((quiet ? 0.4 : 1) - this.dim) * Math.min(1, dt * 1.5);
      rate *= quiet ? 0.4 : 500 / this.iv;                          // 120 BPM = the SPEED as set
    } else this.dim += (1 - this.dim) * Math.min(1, dt * 3);
    this.kick *= Math.exp(-dt / 0.15);
    this.ph += dt * rate;
    // beam directions in the head frame (-Z forward)
    const pat = this.pat, n = pat === 'beam' ? 1 : pat === 'cone' ? Math.max(4, this.n) : this.n, S = this.spread * Math.PI / 180, ph = this.ph;
    const dirs = this.aDir.array, cols = this.aCol.array, lens = this.aLen.array, base = COLOURS[this.col];
    const I = this.dim * (this.auto ? 0.8 + 0.45 * this.kick : 1);
    this.obj.updateMatrixWorld(); this.ap.updateMatrixWorld();
    this.rig.updateMatrixWorld(); _mi.copy(this.rig.matrixWorld).invert().multiply(this.ap.matrixWorld);   // aperture frame -> rig space
    const o = _o.setFromMatrixPosition(_mi); _qq.setFromRotationMatrix(_mi);
    let spots = 0; const sc = this.sCol.array; let gr = 0, gg = 0, gb = 0, toward = 0;
    if (camPos) { this.rig.worldToLocal(_c.copy(camPos)); _c.sub(o).normalize(); }
    for (let i = 0; i < n; i++) {
      const f = n > 1 ? i / (n - 1) - 0.5 : 0, sd = this.seeds[i];
      let yaw = 0, pit = 0;
      if (pat === 'beam') { yaw = 0.05 * Math.sin(ph * 0.7); pit = 0.03 * Math.sin(ph * 0.5); }
      else if (pat === 'fan') { yaw = f * S; pit = 0.06 * Math.sin(ph * 0.6); }
      else if (pat === 'sweep') { yaw = 0.5 * S * Math.sin(ph * 1.2) + f * S * 0.3; pit = 0.04 * Math.sin(ph * 0.9); }
      else if (pat === 'cone') { const a = ph * 1.5 + i * 2 * Math.PI / n, h = S * 0.25; yaw = h * Math.cos(a); pit = h * Math.sin(a); }
      else if (pat === 'wave') { yaw = f * S; pit = 0.16 * Math.sin(ph * 2 + i * 0.7); }
      else { yaw = 0.5 * S * (0.6 * Math.sin(ph * 0.9 * sd[0] + sd[1]) + 0.4 * Math.sin(ph * 2.1 * sd[2] + sd[3])); pit = 0.18 * Math.sin(ph * 1.3 * sd[2] + sd[1] * 1.7); }
      const cp = Math.cos(pit); _d.set(Math.sin(yaw) * cp, Math.sin(pit), -Math.cos(yaw) * cp);
      dirs[i * 3] = _d.x; dirs[i * 3 + 1] = _d.y; dirs[i * 3 + 2] = _d.z;
      const c = base || hsv((i / Math.max(1, n) + ph * 0.04) % 1, _hc);
      cols[i * 3] = c[0] * I; cols[i * 3 + 1] = c[1] * I; cols[i * 3 + 2] = c[2] * I;
      // the beam stops at the nearest surface: the floor (rig y 0) or, #411, a Space Setup plane (wall, ceiling, table...), and leaves a dot there
      _d.applyQuaternion(_qq); let L = this.len, hitQ = null;
      if (_d.y < -1e-3) { const t = -o.y / _d.y; if (t > 0 && t < L) L = t; }
      if (this.room) for (const pl of this.room) {
        _po.copy(o).applyMatrix4(pl.inv); _pd.copy(_d).transformDirection(pl.inv);   // into plane space: the plane is y = 0
        if (Math.abs(_pd.y) < 1e-4) continue;
        const t = -_po.y / _pd.y; if (t <= 0.02 || t >= L) continue;
        if (inPoly(pl.poly, _po.x + _pd.x * t, _po.z + _pd.z * t)) { L = t; hitQ = pl.q; }
      }
      if (L < this.len) {
        const t = L, k = Math.exp(-(t / this.len) * (0.15 + 0.6 * this.haze)) * I, sz = 0.08 + t * 0.004;
        _p.copy(o).addScaledVector(_d, t - 0.003);   // 3 mm in front of the surface
        if (hitQ) _sq.copy(hitQ); else { _sq.identity(); _p.y = Math.max(_p.y, 0.003); }
        _sm.compose(_p, _sq, _ss.set(sz, 1, sz)); this.spots.setMatrixAt(spots, _sm);
        sc[spots * 3] = c[0] * k; sc[spots * 3 + 1] = c[1] * k; sc[spots * 3 + 2] = c[2] * k; spots++;
      }
      lens[i] = L;
      gr += c[0]; gg += c[1]; gb += c[2];
      if (camPos) toward = Math.max(toward, _d.dot(_c));
    }
    this.beams.geometry.instanceCount = n;
    this.aDir.needsUpdate = this.aCol.needsUpdate = this.aLen.needsUpdate = true;
    this.spots.count = spots; if (spots) { this.spots.instanceMatrix.needsUpdate = true; this.sCol.needsUpdate = true; }
    const u = this.bMat.uniforms; u.uLen.value = this.len; u.uHaze.value = this.haze; u.uDecay.value = (0.15 + 0.6 * this.haze);
    const gk = (0.25 + 4 * Math.pow(Math.max(0, toward), 40)) * I / n;   // a beam at your eye = a bright point
    this.glowMat.color.setRGB(gr * gk, gg * gk, gb * gk); this.glow.scale.setScalar(0.04 + 0.08 * Math.pow(Math.max(0, toward), 40));
    this.winMat.color.setRGB(Math.min(1, gr / n * I), Math.min(1, gg / n * I), Math.min(1, gb / n * I));
    this.ledMat.color.setHex(this.auto && now - this.lastBeat < 120 ? 0x40ff40 : 0x0a6010);
  }
}
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _mi = new THREE.Matrix4(), _o = new THREE.Vector3(), _qq = new THREE.Quaternion();
function inPoly(a, x, z) {   // even-odd test, a = [x0, z0, x1, z1, ...]
  let inside = false;
  for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) {
    const xi = a[i], zi = a[i + 1], xj = a[j], zj = a[j + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const _po = new THREE.Vector3(), _pd = new THREE.Vector3(), _sq = new THREE.Quaternion(), _ss = new THREE.Vector3();
const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Vector3(), _sm = new THREE.Matrix4(), _hc = [0, 0, 0];
