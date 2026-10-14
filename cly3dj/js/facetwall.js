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

export class FacetWall {
  // home(): { p: Vector3, yaw } in rig space (the arc's centre, by the DJ; the panels stand out in front, local -z)
  constructor(rig, renderer, home) {
    this.rig = rig; this.renderer = renderer; this.home = home; this.on = false; this.held = false; this.mode = 'fractal'; this.beat = false;
    this.v = { ...DEF }; this.cur = { arc: DEF.arc, h: DEF.h, r: DEF.r }; this.aspect = 2.25; this.hue = 0;
    const g = this.obj = new THREE.Group(); g.name = 'facetwall'; g.visible = false; g.userData.noMirror = true; rig.add(g);
    this.canvas = document.createElement('canvas'); this.canvas.width = 1024; this.canvas.height = 456;
    this.g2d = this.canvas.getContext('2d'); this.screenTex = this._canvasTex();
    this._buildFractalRT();
    this.mat = new THREE.MeshBasicMaterial({ map: this.fractalRT.texture, toneMapped: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this._buildGeo(), this.mat); this.mesh.userData.noMirror = true; g.add(this.mesh);
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
      if (this.mode === 'screen') { this.mat.map = this.screenTex; this.mat.needsUpdate = true; }
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
    this.mat.map = this.mode === 'screen' ? this.screenTex : this.fractalRT.texture; this.mat.needsUpdate = true;
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
    if (moving) { this._layout(); this._settled = false; }
    else if (!this._settled) { this._settled = true; this._fitTextures(); }
    const p = this.beat ? pulse : 0;
    this.mat.color.setScalar(1 + 0.6 * p);   // not tone-mapped: above 1 = brighter
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
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
