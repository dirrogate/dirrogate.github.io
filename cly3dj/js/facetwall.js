// #345 FACETWALL (owner): a low-poly curved backdrop standing in front of the DJ flight case, forward-facing only (it
// does not wrap behind the DJ), so the passthrough camera sees this instead of whatever real clutter is actually
// there. Faceted (flat panels, not a smooth dome) so a video-mapped texture stays sharp -- one continuous image is
// stretched across all the panels, same idea as a photo-studio cyclorama. Two content modes: FRACTAL (an animated
// GPU shader, cheap, runs entirely on-device) or SCREEN (whatever the LED wall / VIDEOWALL pipeline is currently
// showing -- same wallSource() the Twitch SHOWTIME! compositor already draws from, so "what's behind you" matches
// what's already playing elsewhere). Cut a Portal into it (Portals.cutInto(wall.obj)) to open a real window through
// it onto the actual room.
// #346 (owner, PORTALS SETUP page): WRAP (60 to 360 deg: all the way round the DJ), HEIGHT and DISTANCE. The panels
// are slats about 53 cm wide: widening the wrap or moving it out adds slats at the ends, narrowing takes them away,
// eased over ~0.3 s so they visibly fan out / fold in. FRACTAL gets SPEED and COLOUR CYCLE; BEAT makes either mode
// pulse on the music (beat.js: a bass onset on the master) -- brighter, and the fractal kicks in a little.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/three/utils/BufferGeometryUtils.js';
import { RAIN } from './portal.js';

const KEY = 'vire.facetwall';
const DEG = Math.PI / 180, YOFF = 0.02;      // the panels' bottom edge sits 2 cm off the floor
const SLAT = 0.53;                            // target panel width (m); the count follows wrap x distance
const MAXS = 80;                              // most slats ever (360 deg at 6 m)
export const WALL_LIM = { arc: [60, 360, 30], h: [0.5, 4, 0.1], r: [1, 6, 0.25], speed: [0, 4, 0.25], cycle: [0, 4, 0.25] };   // min, max, step
export const WALL_DEF = { arc: 150, h: 2.15, r: 1.85, speed: 1, cycle: 1 };
const DEF = WALL_DEF;

// a wide wall (wrapped round the DJ) repeats the picture every ~2.4 widths, every other copy mirrored, so it never
// spreads into one flat colour and has no seams
const FRACTAL_FS = `uniform float time; uniform float hue; uniform float aspect; uniform float reps; uniform float pulse; varying vec2 vUv;
vec3 pal(float t) { return 0.5 + 0.5 * cos(6.2831 * (vec3(0.1, 0.35, 0.6) + t + vec3(0.0, 0.33, 0.67))); }
void main() {
  float s = vUv.x * reps, k = floor(s), fx = fract(s); if (mod(k, 2.0) > 0.5) fx = 1.0 - fx;
  vec2 uv = (vec2(fx, vUv.y) - 0.5) * vec2(aspect / reps, 1.0) * (1.0 - 0.1 * pulse); float t = time * 0.06;
  vec2 z = uv, c = vec2(0.355 + 0.02 * sin(t * 1.3), 0.355 + 0.02 * cos(t * 0.9)); float m = 0.0;
  for (int i = 0; i < 20; i++) { z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c; if (dot(z, z) > 4.0) break; m += 1.0; }
  float f = m / 20.0; vec3 col = pal(f * 1.6 + hue) * (0.35 + 0.65 * f);
  gl_FragColor = vec4(col, 1.0);
}`;

// #703 (owner, the 'CyberDj' window-wall photos: replaces the plain screen look) GLASS WINDOW WALL. The slats are panes of
// glass with the picture as the view OUTSIDE: each eye's ray goes through the pane and lands on a bigger cylinder DEPTH
// metres further out, so the city / clip sits beyond the glass with real parallax (head moves = the view shifts like a
// window). A cool tint, a faint sheen at grazing angles and reflection streaks; GLASS RAIN / MIST from PORTALS SETUP
// (the #639 rain on PANO frames, same maths, same preset) runs down the panes. Dark mullions, a header beam, a sill and
// a ceiling soffit with can lights are one extra mesh (+ one for the lamp lenses). Portal frames still cut through all of it.
const DEPTH = 1.6;   // metres from the glass to the view
const GLASS_VS = `varying vec2 vUv; varying vec3 vLoc; varying vec3 vWN; varying vec3 vWP;
void main() {
  vUv = uv; vLoc = position; vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; vWN = normalize(mat3(modelMatrix) * normalize(vec3(-position.x, 0.0, -position.z)));
  gl_Position = projectionMatrix * viewMatrix * wp; }`;
const GLASS_FS = `uniform sampler2D map; uniform float gain; uniform mat4 wallInv; uniform vec4 wallG; uniform float wallT; varying vec2 vUv; varying vec3 vLoc; varying vec3 vWN; varying vec3 vWP;
void main() {
  // wallG = (arc radians, radius, height, y offset)
  vec2 uv = vUv; float arc = wallG.x, R = wallG.y, H = wallG.z;
  vec3 c = (wallInv * vec4(cameraPosition, 1.0)).xyz, d = normalize(vLoc - c);
  float R2 = R + ${DEPTH.toFixed(2)}, a = dot(d.xz, d.xz), b = dot(c.xz, d.xz), cc = dot(c.xz, c.xz) - R2 * R2, disc = b * b - a * cc;
  if (dot(c.xz, c.xz) < R * R && disc > 0.0 && a > 1e-5) {   // inside the arc: where the ray meets the far cylinder
    vec3 q = c + d * ((-b + sqrt(disc)) / a);
    float th = atan(q.x, -q.z), k = R2 / R;
    uv = vec2(th / arc + 0.5, (q.y - wallG.w - 0.5 * H) / (H * k) + 0.5);   // the far cylinder is k times taller, same middle
  }
  uv = clamp(uv, vec2(0.001), vec2(0.999));
  vec2 bend = vec2(0.0); float core = 0.0, edge = 0.0, bead = 0.0, clear = 0.0, mist = 0.0;
#ifdef USE_PORTAL
  {   // GLASS RAIN on the pane, in metres (u along the arc, y up), the #639 maths
    bool inRev = true; vec2 pRev = vec2((vUv.x - 0.5) * arc * R, (vUv.y - 0.5) * H), hRev = vec2(0.5 * arc * R, 0.5 * H); float upRev = 1.0;
    ${RAIN}
    bend = rBend; core = rCore; edge = rEdge; bead = rBead; clear = rClear; mist = portalRain.y;
  }
#endif
  uv += bend / vec2(max(arc * R, 0.1), H) * 1.6;
  vec3 col = texture2D(map, uv).rgb * gain;
  col *= vec3(0.86, 0.92, 1.0);   // cool glass tint
  vec3 V = normalize(cameraPosition - vWP); float fr = pow(1.0 - abs(dot(V, normalize(vWN))), 4.0);
  float streak = smoothstep(0.75, 1.0, sin((vUv.x * arc * R * 1.3 + vUv.y * H * 0.9) * 2.1)) * 0.035 + smoothstep(0.9, 1.0, sin((vUv.x * arc * R * 0.7 - vUv.y * H * 0.4) * 1.3 + 1.7)) * 0.02;
  col += vec3(0.55, 0.65, 0.8) * (fr * 0.22 + streak);
  float m = mist * (1.0 - clear);
  col = mix(col, vec3(dot(col, vec3(0.3, 0.5, 0.2))) * 0.7 + vec3(0.06, 0.07, 0.09), m * 0.55);
  col += vec3(0.75, 0.85, 1.0) * (edge * 0.18 + core * 0.06) + vec3(0.9) * bead * 0.04;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;
const FRAME_COL = 0x14171d;

export class FacetWall {
  // home(): { p: Vector3, yaw } in rig space (the arc's centre, by the DJ; the panels stand out in front, local -z)
  constructor(rig, renderer, home) {
    this.rig = rig; this.renderer = renderer; this.home = home; this.on = false; this.held = false; this.mode = 'fractal'; this.beat = false;
    this.v = { ...DEF }; this.cur = { arc: DEF.arc, h: DEF.h, r: DEF.r }; this.aspect = 2.25; this.hue = 0;
    const g = this.obj = new THREE.Group(); g.name = 'facetwall'; g.visible = false; g.userData.noMirror = true; rig.add(g);
    this.canvas = document.createElement('canvas'); this.canvas.width = 1024; this.canvas.height = 456;
    this.g2d = this.canvas.getContext('2d'); this.screenTex = this._canvasTex();
    this._buildFractalRT();
    this.mat = new THREE.ShaderMaterial({ uniforms: { map: { value: this.fractalRT.texture }, gain: { value: 1 }, wallInv: { value: new THREE.Matrix4() }, wallG: { value: new THREE.Vector4(2.6, 1.85, 2.15, YOFF) }, wallT: { value: 0 } },
      vertexShader: GLASS_VS, fragmentShader: GLASS_FS, side: THREE.DoubleSide, toneMapped: false });   // #703 the glass window wall
    this.mesh = new THREE.Mesh(this._buildGeo(), this.mat); this.mesh.userData.noMirror = true; g.add(this.mesh);
    this.frameMat = new THREE.MeshStandardMaterial({ color: FRAME_COL, metalness: 0.65, roughness: 0.4 });
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false });
    this.frame = new THREE.Mesh(new THREE.BufferGeometry(), this.frameMat); this.frame.userData.noMirror = true; g.add(this.frame);
    this.lamps = new THREE.Mesh(new THREE.BufferGeometry(), this.lampMat); this.lamps.userData.noMirror = true; g.add(this.lamps);
    this._frameT = 0;
    this._lastDraw = 0;
    this._load();
    this._layout();
  }
  _canvasTex() { const t = new THREE.CanvasTexture(this.canvas); t.colorSpace = THREE.SRGBColorSpace; return t; }
  _buildGeo() {   // room for MAXS slats; _layout() fills the first n and sets the draw range
    const geo = new THREE.BufferGeometry(), idx = [];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((MAXS + 1) * 6), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((MAXS + 1) * 4), 2));
    for (let i = 0; i < MAXS; i++) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3); }
    geo.setIndex(idx); return geo;
  }
  // The slats for the current (eased) wrap / height / distance: n flat quads along the arc, one continuous 0..1 UV
  // strip across all of them (the cyc-wall trick), v = 0 at the bottom (CanvasTexture flipY), so SCREEN is upright.
  _layout() {
    const a = this.cur.arc * DEG, R = this.cur.r, H = this.cur.h, geo = this.mesh.geometry;
    const n = Math.min(MAXS, Math.max(1, Math.ceil(a * R / SLAT - 1e-6))), pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i <= n; i++) {
      const t = -a / 2 + (a * i) / n, x = Math.sin(t) * R, z = -Math.cos(t) * R, u = i / n;
      pos.setXYZ(2 * i, x, YOFF, z); pos.setXYZ(2 * i + 1, x, YOFF + H, z);   // bottom vertex, then top vertex, at this arc step
      uv.setXY(2 * i, u, 0); uv.setXY(2 * i + 1, u, 1);
    }
    pos.needsUpdate = true; uv.needsUpdate = true; geo.setDrawRange(0, n * 6); geo.computeBoundingSphere();
    this.n = n; this.aspect = n * 2 * R * Math.sin(a / n / 2) / H;   // the image runs along the panels, not the chord
    this.fractalMat.uniforms.aspect.value = this.aspect; this.fractalMat.uniforms.reps.value = Math.max(1, Math.round(this.aspect / 2.4));
    this.mat.uniforms.wallG.value.set(a, R, H, YOFF);
    const now = performance.now(); if (now - this._frameT > 120 || this._settled) { this._frameT = now; this._buildFrame(); }
  }
  // #703 mullions every other slat joint (~1.06 m apart), a header beam, a sill and a soffit (ceiling band) with can lights
  _buildFrame() {
    const a = this.cur.arc * DEG, R = this.cur.r, H = this.cur.h, n = this.n, parts = [], lamps = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const box = (w, h, d, x, y, z, yaw) => { const b = new THREE.BoxGeometry(w, h, d); b.applyMatrix4(m4.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, yaw), _one)); parts.push(b); };
    const at = (t, r) => [Math.sin(t) * r, -Math.cos(t) * r];
    const full = this.cur.arc >= 359;
    for (let i = 0; i <= n; i++) {   // mullions: 4 cm wide, 7 cm deep, on every other joint and both ends
      if (i % 2 && i !== n) continue; if (full && i === n) continue;
      const t = -a / 2 + (a * i) / n, [x, z] = at(t, R + 0.02); box(0.04, H, 0.07, x, YOFF + H / 2, z, -t);
    }
    const SOF = Math.min(0.55, R * 0.35);
    for (let i = 0; i < n; i++) {   // header, sill and soffit: one piece per slat (the chord)
      const t0 = -a / 2 + (a * i) / n, t1 = t0 + a / n, tm = (t0 + t1) / 2, cw = 2 * R * Math.sin(a / n / 2) + 0.012;
      let [x, z] = at(tm, (R + 0.02) * Math.cos(a / n / 2)); box(cw, 0.12, 0.09, x, YOFF + H + 0.06, z, -tm); box(cw, 0.05, 0.09, x, YOFF + 0.025, z, -tm);
      [x, z] = at(tm, (R - SOF / 2) * Math.cos(a / n / 2)); box(2 * (R - SOF / 2) * Math.sin(a / n / 2) + 0.012, 0.03, SOF, x, YOFF + H + 0.105, z, -tm);
    }
    const nl = Math.max(2, Math.round(a * R / 1.6));   // can lights about every 1.6 m along the soffit
    for (let i = 0; i < nl; i++) {
      const t = -a / 2 + a * (i + 0.5) / nl, [x, z] = at(t, R - SOF / 2), y = YOFF + H + 0.09;
      const c = new THREE.CylinderGeometry(0.06, 0.07, 0.14, 12, 1, true); c.translate(x, y - 0.07, z); parts.push(c);
      const l = new THREE.CircleGeometry(0.055, 12); l.rotateX(Math.PI / 2); l.translate(x, y - 0.135, z); lamps.push(l);
    }
    const old = this.frame.geometry, oldL = this.lamps.geometry;
    this.frame.geometry = mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p).map(p => { p.deleteAttribute('uv'); return p; }), false) || new THREE.BufferGeometry();
    this.lamps.geometry = mergeGeometries(lamps.map(p => p.index ? p.toNonIndexed() : p).map(p => { p.deleteAttribute('uv'); return p; }), false) || new THREE.BufferGeometry();
    old.dispose(); oldL.dispose(); for (const p of parts) p.dispose(); for (const p of lamps) p.dispose();
  }
  _buildFractalRT() {
    this.fractalRT = new THREE.WebGLRenderTarget(512, 256, { depthBuffer: false });
    this.fractalScene = new THREE.Scene();
    this.fractalMat = new THREE.ShaderMaterial({ uniforms: { time: { value: 0 }, hue: { value: 0 }, aspect: { value: 2.25 }, reps: { value: 1 }, pulse: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: FRACTAL_FS });
    this.fractalScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fractalMat));
    this.fractalCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  // texture sizes follow the wall's shape (a 360 wrap is ~5x wider than tall): re-made only once the slats settle
  _fitTextures() {
    const W = this.aspect > 3 ? 2048 : 1024, H = Math.max(128, Math.min(1024, Math.round(W / this.aspect)));
    if (this.canvas.width !== W || Math.abs(this.canvas.height - H) > 8) {
      this.canvas.width = W; this.canvas.height = H; this.screenTex.dispose(); this.screenTex = this._canvasTex();
      if (this.mode === 'screen') this.mat.uniforms.map.value = this.screenTex;
      this._lastDraw = 0;
    }
    const rw = this.aspect > 3 ? 1024 : 512;
    if (this.fractalRT.width !== rw) this.fractalRT.setSize(rw, 256);
  }
  _load() {
    let s = null; try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
    if (s && s.p) { this.obj.position.fromArray(s.p); this.obj.quaternion.fromArray(s.q); } else this.reset(false);
    for (const k of Object.keys(DEF)) if (s && typeof s[k] === 'number') this.v[k] = this._clamp(k, s[k]);
    Object.assign(this.cur, { arc: this.v.arc, h: this.v.h, r: this.v.r });
    this.beat = !!(s && s.beat);
    this.setMode((s && s.mode) || 'fractal', false);
    this.setOn(!!(s && s.on), false);
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify({ on: this.on, mode: this.mode, beat: this.beat, ...this.v, p: this.obj.position.toArray(), q: this.obj.quaternion.toArray() })); } catch {} }
  reset(save = true) { const h = this.home(); this.obj.position.copy(h.p); this.obj.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.yaw); if (save) this.save(); }
  setOn(on, save = true) { this.on = !!on; this.obj.visible = this.on; if (save) this.save(); }
  setMode(m, save = true) {
    this.mode = m === 'screen' ? 'screen' : 'fractal';
    this.mat.uniforms.map.value = this.mode === 'screen' ? this.screenTex : this.fractalRT.texture;
    if (save) this.save();
  }
  toggleMode() { this.setMode(this.mode === 'screen' ? 'fractal' : 'screen'); }
  setBeat(on) { this.beat = !!on; this.save(); }
  _clamp(k, v) { const [lo, hi] = WALL_LIM[k]; return Math.min(hi, Math.max(lo, Math.round(v * 100) / 100)); }
  val(k) { return this.v[k]; }
  step(k, dir) { this.set(k, this.v[k] + dir * WALL_LIM[k][2]); }
  set(k, v) { this.v[k] = this._clamp(k, v); this.save(); }   // wrap / height / distance ease there in tick()
  // grab (hands: pinch) on the panels themselves (within ~15 cm of their surface) to reposition the whole backdrop;
  // no resize by hand (wrap / height / distance are on PORTALS SETUP) -- double-tap WALL sends it back to its spot
  hit(P) {
    if (!this.on) return false;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P)), c = this.cur;
    return Math.abs(Math.atan2(l.x, -l.z)) < c.arc * DEG / 2 + 0.02 && Math.abs(Math.hypot(l.x, l.z) - c.r) < 0.15 && l.y > YOFF && l.y < YOFF + c.h;
  }
  grab() { this.held = true; }
  hold(world) { this.rig.updateMatrixWorld(); _m.copy(this.rig.matrixWorld).invert().multiply(world); _m.decompose(this.obj.position, this.obj.quaternion, _s); this.obj.scale.set(1, 1, 1); }
  release() { this.held = false; this.save(); }
  // wallSource: the env.wallSource() function from main.js -- same 2D drawables the stream's VIDEOWALL layer draws.
  // pulse: 0..1 from the beat detector (used only while BEAT is on).
  tick(dt, wallSource, pulse = 0) {
    if (!this.on) return;
    let moving = false;   // ease the slats toward the set wrap / height / distance (~0.3 s), then snap
    for (const k of ['arc', 'h', 'r']) {
      const d = this.v[k] - this.cur[k];
      if (Math.abs(d) > (k === 'arc' ? 0.05 : 0.001)) { this.cur[k] += d * Math.min(1, dt * 10); moving = true; }
      else if (d !== 0) { this.cur[k] = this.v[k]; moving = true; }
    }
    if (moving) { this._settled = false; this._layout(); }
    else if (!this._settled) { this._settled = true; this._layout(); this._fitTextures(); }
    this.obj.updateMatrixWorld(); this.mat.uniforms.wallInv.value.copy(this.obj.matrixWorld).invert();   // #703 each eye's ray, in the wall's own space
    const p = this.beat ? pulse : 0;
    this.mat.uniforms.gain.value = 1 + 0.6 * p;   // not tone-mapped: above 1 = brighter
    if (this.mode === 'fractal') {
      const u = this.fractalMat.uniforms;
      u.time.value += dt * this.v.speed; this.hue += dt * 0.06 * this.v.cycle; u.hue.value = this.hue; u.pulse.value = p;
      const r = this.renderer, prevRT = r.getRenderTarget(), prevXR = r.xr.enabled;
      r.xr.enabled = false; r.setRenderTarget(this.fractalRT); r.render(this.fractalScene, this.fractalCam); r.setRenderTarget(prevRT); r.xr.enabled = prevXR;
    } else if (wallSource && performance.now() - this._lastDraw > 50) {   // ~20 fps is plenty for a backdrop
      this._lastDraw = performance.now();
      const g = this.g2d, W = this.canvas.width, H = this.canvas.height, layers = wallSource() || [];
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.fillStyle = '#060608'; g.fillRect(0, 0, W, H);
      for (const L of layers) {
        if (!L || !L.el || L.gain === 0) continue;
        g.globalAlpha = L.gain == null ? 1 : Math.min(1, L.gain); g.globalCompositeOperation = L.add ? 'lighter' : 'source-over';
        this._cover(g, L.el, W, H, L.flip);
      }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      this.screenTex.needsUpdate = true;
    }
  }
  _cover(g, el, W, H, flip) {   // draw el (video/image/bitmap) "cover"-fit into the full canvas
    const ew = el.videoWidth || el.width || 1, eh = el.videoHeight || el.height || 1, s = Math.max(W / ew, H / eh);
    const dw = ew * s, dh = eh * s, dx = (W - dw) / 2, dy = (H - dh) / 2;
    if (flip) { g.save(); g.translate(0, H); g.scale(1, -1); g.drawImage(el, dx, H - dy - dh, dw, dh); g.restore(); }
    else g.drawImage(el, dx, dy, dw, dh);
  }
}
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
