// #345 FACETWALL (owner): a low-poly curved backdrop standing in front of the DJ flight case, forward-facing only (it
// does not wrap behind the DJ), so the passthrough camera sees this instead of whatever real clutter is actually
// there. Faceted (flat panels, not a smooth dome) so a video-mapped texture stays sharp -- one continuous image is
// stretched across all the panels, same idea as a photo-studio cyclorama. Two content modes: FRACTAL (an animated
// GPU shader, cheap, runs entirely on-device) or SCREEN (whatever the LED wall / VIDEOWALL pipeline is currently
// showing -- same wallSource() the Twitch SHOWTIME! compositor already draws from, so "what's behind you" matches
// what's already playing elsewhere). Cut a Portal into it (Portal.cutInto(wall.obj)) to open a real window through
// it onto the actual room.
import * as THREE from 'three';

const KEY = 'vire.facetwall';
const ARC = 150 * Math.PI / 180, SEGS = 9, RADIUS = 1.85, HEIGHT = 2.15, YOFF = 0.02;   // arc, panel count, metres

const FRACTAL_FS = `uniform float time; uniform vec2 res; varying vec2 vUv;
vec3 pal(float t) { return 0.5 + 0.5 * cos(6.2831 * (vec3(0.1, 0.35, 0.6) + t + vec3(0.0, 0.33, 0.67))); }
void main() {
  vec2 uv = (vUv - 0.5) * vec2(2.4, 1.0); float t = time * 0.06;
  vec2 z = uv, c = vec2(0.355 + 0.02 * sin(t * 1.3), 0.355 + 0.02 * cos(t * 0.9)); float m = 0.0;
  for (int i = 0; i < 20; i++) { z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c; if (dot(z, z) > 4.0) break; m += 1.0; }
  float f = m / 20.0; vec3 col = pal(f * 1.6 + t) * (0.35 + 0.65 * f);
  gl_FragColor = vec4(col, 1.0);
}`;

export class FacetWall {
  // home(): { p: Vector3, yaw } in rig space (the wall's centre, facing the DJ)
  constructor(rig, renderer, home) {
    this.rig = rig; this.renderer = renderer; this.home = home; this.on = false; this.held = false; this.mode = 'fractal';
    const g = this.obj = new THREE.Group(); g.name = 'facetwall'; g.visible = false; g.userData.noMirror = true; rig.add(g);
    this.canvas = document.createElement('canvas'); this.canvas.width = 1024; this.canvas.height = Math.round(1024 * HEIGHT / (SEGS * 2 * RADIUS * Math.sin(ARC / SEGS / 2)));   // image runs along the panels (4.83 m), not the chord
    this.g2d = this.canvas.getContext('2d'); this.screenTex = new THREE.CanvasTexture(this.canvas); this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this._buildFractalRT();
    this.mat = new THREE.MeshBasicMaterial({ map: this.fractalRT.texture, toneMapped: false, side: THREE.DoubleSide });
    const geo = this._buildArc();
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.userData.noMirror = true; g.add(this.mesh);
    this._lastDraw = 0;
    this._load();
  }
  _buildArc() {   // SEGS flat quads along an arc, one continuous 0..1 UV strip across all of them (the cyc-wall trick)
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= SEGS; i++) {
      const a = -ARC / 2 + (ARC * i) / SEGS;
      const x = Math.sin(a) * RADIUS, z = -Math.cos(a) * RADIUS, u = i / SEGS;
      pos.push(x, YOFF, z, x, YOFF + HEIGHT, z);   // bottom vertex, then top vertex, at this arc step
      uv.push(u, 0, u, 1);   // v = 0 at the bottom (CanvasTexture flipY), so SCREEN is upright
      if (i < SEGS) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }
  _buildFractalRT() {
    const W = 512, H = 256;
    this.fractalRT = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false });
    this.fractalScene = new THREE.Scene();
    this.fractalMat = new THREE.ShaderMaterial({ uniforms: { time: { value: 0 }, res: { value: new THREE.Vector2(W, H) } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: FRACTAL_FS });
    this.fractalScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fractalMat));
    this.fractalCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  _load() {
    let s = null; try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
    if (s && s.p) { this.obj.position.fromArray(s.p); this.obj.quaternion.fromArray(s.q); } else this.reset(false);
    this.setMode((s && s.mode) || 'fractal', false);
    this.setOn(!!(s && s.on), false);
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify({ on: this.on, mode: this.mode, p: this.obj.position.toArray(), q: this.obj.quaternion.toArray() })); } catch {} }
  reset(save = true) { const h = this.home(); this.obj.position.copy(h.p); this.obj.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.yaw); if (save) this.save(); }
  setOn(on, save = true) { this.on = !!on; this.obj.visible = this.on; if (save) this.save(); }
  setMode(m, save = true) {
    this.mode = m === 'screen' ? 'screen' : 'fractal';
    this.mat.map = this.mode === 'screen' ? this.screenTex : this.fractalRT.texture; this.mat.needsUpdate = true;
    if (save) this.save();
  }
  toggleMode() { this.setMode(this.mode === 'screen' ? 'fractal' : 'screen'); }
  // grab (hands: pinch) on the panels themselves (within ~15 cm of their surface) to reposition the whole backdrop;
  // no resize (it's a fixed arc, not a stretchy panel) -- double-tap WALL on the tablet sends it back to its start spot
  hit(P) {
    if (!this.on) return false;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P));
    return Math.abs(Math.atan2(l.x, -l.z)) < ARC / 2 && Math.abs(Math.hypot(l.x, l.z) - RADIUS) < 0.15 && l.y > YOFF && l.y < YOFF + HEIGHT;
  }
  grab() { this.held = true; }
  hold(world) { this.rig.updateMatrixWorld(); _m.copy(this.rig.matrixWorld).invert().multiply(world); _m.decompose(this.obj.position, this.obj.quaternion, _s); }
  release() { this.held = false; this.save(); }
  // wallSource: the env.wallSource() function from main.js -- same 2D drawables the stream's VIDEOWALL layer draws
  tick(dt, wallSource) {
    if (!this.on) return;
    if (this.mode === 'fractal') {
      this.fractalMat.uniforms.time.value += dt;
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
