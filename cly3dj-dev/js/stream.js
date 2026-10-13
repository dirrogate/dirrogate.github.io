// #331 LIVE STREAM (owner): the Quest goes live on Twitch by itself, no PC, no BeamXR. WebRTC straight to Twitch's
// WHIP ingest (g.webrtc.live-video.net, checked from a web page on 13 Oct 2026: CORS passes, the stream key goes in
// the Authorization header). The sound is the MASTER bus only (after the master fader and limiter, with the MIC when
// it goes through the mixer), tapped before the headphone split, so CUE never reaches the stream. BeamXR records the
// headset's output, which carries the cue too.
// Picture sources: CARD (a Cly3DJ card with what is playing, nearly free), AVACAM (the DJ CAM robot shot, copied to
// 960 x 540 and read back without stalling the GPU), HEADSET (the Quest's own camera, sent as it comes, no
// rendering) and PHONE (the spectator phone's LIVE composite, passed on).
// #333 HEADSET CAM is mixed reality: the Quest camera picture with the gear drawn over it from that camera's point of
// view (offset from the centre eye, field of view and lag set on TOOLS > STREAM > CAM FIT, saved as 'vire.mrcam').
// Each camera frame's capture time (requestVideoFrameCallback) picks the head pose from a short history, so the gear
// doesn't swim against the picture. GEAR OFF sends the raw camera as before.
// The key is kept on this headset only (localStorage 'vire.twitchKey') and goes nowhere but the Twitch endpoint.
import * as THREE from 'three';

export const TWITCH_WHIP = 'https://g.webrtc.live-video.net:4443/v2/offer';
export const SOURCES = { card: 'CARD', avacam: 'AVACAM', show: 'SHOWTIME!', headset: 'HEADSET CAM', phone: 'PHONE' };   // #338 VIDEOWALL gone: SHOWTIME! with ROBOT and GEAR off is the same
const VBR = { card: 600, avacam: 2500, show: 3500, headset: 3000, phone: 2000 };
// #336 SHOW = three layers: the LED wall's visuals full frame (clip / image / VidVinyl / phone LIVE), the robot DJ and
// gear from the AVACAM camera (BOOTH angle) drawn on a see-through background, and flat overlays (scroller, now
// playing, logo). VIDEOWALL = the visuals and overlays only (no 3D render). Toggles saved as 'vire.showOpts'.
export const SHOW_DEF = { visuals: true, robot: true, gear: true, scroll: true, np: true, logo: true };   // #338 VISUALS: the background on / off   // video kbit/s caps per source
const ABR = 160;   // Opus stereo kbit/s

const KEY = 'vire.twitchKey', SRC = 'vire.streamSrc', FIT = 'vire.mrcam', SHOWO = 'vire.showOpts';
// Quest 3 RGB camera: in front of and a little below the centre eye; ~73 deg across at 4:3 (starting values, CAM FIT tunes)
export const FIT_DEF = { x: -32, y: -19, z: -75, tilt: 0, turn: 0, roll: 0, hfov: 73, lag: 0, gear: true };
const lsJ = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
export const streamKey = { get: () => ls.get(KEY) || '', set: v => ls.set(KEY, (v || '').trim() || null) };

// AVACAM copy: the DJ CAM target is linear HDR (half float, 4x MSAA). This pass tone-maps it (ACES, like the scene),
// encodes sRGB, flips it upright and writes 8-bit RGBA at stream size, so the async read-back is a plain putImageData.
const COPY_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const COPY_FS = `uniform sampler2D map; varying vec2 vUv;
vec3 rrt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= 1.0 / 0.6; return clamp(O * rrt(I * c), 0.0, 1.0); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
void main() { vec3 c = texture2D(map, vec2(vUv.x, 1.0 - vUv.y)).rgb; gl_FragColor = vec4(srgb(aces(c)), 1.0); }`;

// MR: gear rendered on transparent black (linear HDR, premultiplied by MSAA), tone-mapped like the scene and laid
// over the raw camera picture (sRGB as it comes, not tone-mapped).
const MR_FS = `uniform sampler2D map; uniform sampler2D cam; varying vec2 vUv;
vec3 rrt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= 1.0 / 0.6; return clamp(O * rrt(I * c), 0.0, 1.0); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
void main() { vec2 uv = vec2(vUv.x, 1.0 - vUv.y); vec4 g = texture2D(map, uv); vec3 c = texture2D(cam, uv).rgb;
  float a = clamp(g.a, 0.0, 1.0); vec3 gc = srgb(aces(g.rgb / max(a, 0.001)));
  gl_FragColor = vec4(mix(c, gc, a), 1.0); }`;

const DEG = Math.PI / 180, _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s1 = new THREE.Vector3(1, 1, 1), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _e1 = new THREE.Euler(), _c1 = new THREE.Color();

// SHOW layer: gear / robot on transparent black, tone-mapped, sRGB, flipped, with its alpha (un-premultiplied) for 2D drawing
const SHOW_FS = `uniform sampler2D map; varying vec2 vUv;
vec3 rrt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= 1.0 / 0.6; return clamp(O * rrt(I * c), 0.0, 1.0); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
void main() { vec4 g = texture2D(map, vec2(vUv.x, 1.0 - vUv.y)); float a = clamp(g.a, 0.0, 1.0);
  gl_FragColor = vec4(srgb(aces(g.rgb / max(a, 0.001))), a); }`;

export class Streamer {
  // env: { engine, renderer, djcam, phoneTrack() -> MediaStreamTrack|null, phoneLive(on), nowPlaying() -> {a, b, bpm}, onChange() }
  constructor(env) {
    this.env = env;
    this.state = 'off';   // off | connecting | live | error
    this.msg = ''; this.kbps = 0; this.t0 = 0; this.retries = 0;
    this.source = SOURCES[ls.get(SRC)] ? ls.get(SRC) : 'card';
    this.pc = null; this.vSender = null; this.aTrack = null; this.vTrack = null; this.camStream = null;
    this.canvas = document.createElement('canvas'); this.canvas.width = 1280; this.canvas.height = 720;
    this.g = this.canvas.getContext('2d');
    this.canvasTrack = null; this.cardT = 0; this.frameT = 0; this.busy = false; this.camN = -1;
    this.fit = { ...FIT_DEF, ...(lsJ(FIT) || {}) };
    this.testing = false;   // CAM FIT TEST: the MR picture runs off air, for lining up
    this.hist = []; this.mr = null;
    this.showOpt = { ...SHOW_DEF, ...(lsJ(SHOWO) || {}) }; this.ly = null; this.showT = 0; this.layerOk = false;
  }
  setShowOpt(k, v) { if (k in SHOW_DEF) { this.showOpt[k] = v; ls.set(SHOWO, JSON.stringify(this.showOpt)); this.env.onChange && this.env.onChange(); } }
  get show3d() { return this.source === 'show' && (this.showOpt.robot || this.showOpt.gear); }
  get running() { return this.live || this.testing; }
  setFit(k, v) { if (k in FIT_DEF) { this.fit[k] = v; ls.set(FIT, JSON.stringify(this.fit)); if (k === 'gear') this._gearChanged(); this.env.onChange && this.env.onChange(); } }
  resetFit() { const g = this.fit.gear; this.fit = { ...FIT_DEF, gear: g }; ls.set(FIT, JSON.stringify(this.fit)); this.env.onChange && this.env.onChange(); }
  async _gearChanged() {   // HEADSET CAM on air: switch between the MR canvas and the raw camera
    if (!this.live || this.source !== 'headset' || !this.vSender) return;
    try { const t = await this._videoTrack('headset'); await this.vSender.replaceTrack(t); this.vTrack = t; } catch (e) { this.msg = 'Camera: ' + e.message; }
  }
  async setTesting(on) {
    if (on === this.testing) return;
    if (on) { try { await this._openCam(); this._mrSize(); this.testing = true; } catch (e) { this.msg = 'Camera: ' + e.message; } }
    else { this.testing = false; if (!(this.live && this.source === 'headset')) this._stopCam(); }
    this.env.onChange && this.env.onChange();
  }
  get live() { return this.state === 'live' || this.state === 'connecting'; }
  get wantsCam() { return this.live && (this.source === 'avacam' || this.show3d); }   // main.js keeps the DJ CAM (pose, aim, robot) running for us
  get needsCamRT() { return this.live && this.source === 'avacam'; }   // only AVACAM uses the DJ CAM's own picture
  hasKey() { return !!streamKey.get(); }
  keyHint() { const k = streamKey.get(); return k ? '••••' + k.slice(-4) : 'no key'; }
  elapsed() { if (!this.t0) return '00:00:00'; const s = Math.floor((performance.now() - this.t0) / 1000); return [s / 3600, s / 60 % 60, s % 60].map(v => String(Math.floor(v)).padStart(2, '0')).join(':'); }
  _set(state, msg = '') { this.state = state; this.msg = msg; this.env.onChange && this.env.onChange(); }

  // ---- picture ----
  async _videoTrack(src) {
    if (src === 'headset') {
      await this._openCam();
      if (!this.fit.gear) { const t = this.camStream.getVideoTracks()[0]; t.contentHint = 'motion'; return t; }
      this._mrSize();
      if (!this.canvasTrack || this.canvasTrack.readyState !== 'live') { this.canvasTrack = this.canvas.captureStream(0).getVideoTracks()[0]; this.canvasTrack.contentHint = 'motion'; }
      return this.canvasTrack;
    }
    if (src === 'phone') {
      const t = this.env.phoneTrack && this.env.phoneTrack();
      if (!t) throw new Error('no phone LIVE picture (link the phone first)');
      return t;
    }
    if (!this.canvasTrack || this.canvasTrack.readyState !== 'live') { this.canvasTrack = this.canvas.captureStream(0).getVideoTracks()[0]; this.canvasTrack.contentHint = 'motion'; }
    if (src === 'avacam') this._sizeCanvas(960, 540); else this._sizeCanvas(1280, 720);   // card, show, wall: 1280 x 720
    this.layerOk = false;
    this.cardT = 0;
    return this.canvasTrack;
  }
  _sizeCanvas(w, h) { if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; } }
  async _openCam() {
    if (this.camStream && this.camStream.getVideoTracks()[0].readyState === 'live') return;
    this.camStream = this.env.testCam ? this.env.testCam() : await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 }, frameRate: { ideal: 30 } }, audio: false });
    const v = this.camVideo || (this.camVideo = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true }));
    if (!v.isConnected) { Object.assign(v.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none' }); document.body.appendChild(v); }   // frame callbacks only run for a video on the page
    v.srcObject = this.camStream; await v.play().catch(() => {});
    this.camFrameT = 0; this.camNew = false; this.rvfcT = 0;
    if (v.requestVideoFrameCallback) {
      const cb = (now, md) => { if (v.srcObject !== this.camStream) return; this.camFrameT = md.captureTime || md.expectedDisplayTime - 45 || now - 45; this.camNew = true; this.rvfcT = performance.now(); v.requestVideoFrameCallback(cb); };
      v.requestVideoFrameCallback(cb);
    }
  }
  _mrSize() {   // the camera's own shape, 960 wide
    const st = this.camStream ? this.camStream.getVideoTracks()[0].getSettings() : {}, a = st.width && st.height ? st.width / st.height : 4 / 3;
    this._sizeCanvas(960, Math.round(960 / a / 2) * 2);
  }
  _stopCam() { if (this.camStream) { this.camStream.getTracks().forEach(t => t.stop()); this.camStream = null; } if (this.camVideo) this.camVideo.srcObject = null; }

  async setSource(src) {
    if (!SOURCES[src]) return;
    const prev = this.source; this.source = src; ls.set(SRC, src);
    if (!this.live || !this.vSender) { this.env.onChange && this.env.onChange(); return; }
    try {
      if (src === 'phone') this.env.phoneLive && this.env.phoneLive(true);
      const t = await this._videoTrack(src);
      await this.vSender.replaceTrack(t); this.vTrack = t;
      await this._caps();
      if (prev === 'headset' && src !== 'headset' && !this.testing) this._stopCam();
      if (prev === 'phone' && src !== 'phone') this.env.phoneLive && this.env.phoneLive(false);
      this.msg = '';
    } catch (e) { this.source = prev; ls.set(SRC, prev); this.msg = 'Source: ' + e.message; }
    this.env.onChange && this.env.onChange();
  }

  drawCard(now) {   // ~1 fps redraw, the encoder gets a frame every 100 ms so Twitch never sees a stall
    const g = this.g, W = 1280, H = 720;
    const gr = g.createRadialGradient(640, 300, 40, 640, 360, 780); gr.addColorStop(0, '#1b2233'); gr.addColorStop(1, '#05070c');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.textBaseline = 'middle'; g.font = '800 150px system-ui,sans-serif';
    g.textAlign = 'right'; g.fillStyle = '#ffffff'; g.fillText('Cly', 640, 250);
    g.textAlign = 'left'; g.fillStyle = '#e0202a'; g.fillText('3DJ', 640, 250);
    const blink = Math.floor(now / 700) % 2 === 0;
    g.fillStyle = blink ? '#e0202a' : '#5a1014'; g.beginPath(); g.arc(560, 400, 18, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.font = '700 54px system-ui,sans-serif'; g.fillText('LIVE  ON VINYL', 595, 402);
    const np = (this.env.nowPlaying && this.env.nowPlaying()) || {};
    g.textAlign = 'center'; g.font = '600 38px system-ui,sans-serif'; g.fillStyle = '#dfe6f2';
    const fit = (s, y) => { s = s || ''; while (s.length > 4 && g.measureText(s).width > 1160) s = s.slice(0, -2); g.fillText(s, 640, y); };
    if (np.a) fit('▶ ' + np.a, 520);
    if (np.b) fit(np.b, 580);
    if (np.bpm) { g.font = '600 28px system-ui,sans-serif'; g.fillStyle = '#8c96a8'; g.fillText(np.bpm + ' BPM', 640, 640); }
  }

  _avacamFrame() {
    const dc = this.env.djcam, r = this.env.renderer; if (!dc || this.busy || dc.n === this.camN) return;
    this.camN = dc.n;
    const W = 960, H = 540;
    if (!this.rt) {
      this.rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false });
      this.cpMat = new THREE.ShaderMaterial({ uniforms: { map: { value: null } }, vertexShader: COPY_VS, fragmentShader: COPY_FS, depthTest: false, depthWrite: false });
      this.cpScene = new THREE.Scene(); const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.cpMat); q.frustumCulled = false; this.cpScene.add(q);
      this.cpCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.buf = new Uint8Array(W * H * 4); this.img = new ImageData(new Uint8ClampedArray(this.buf.buffer), W, H);
    }
    this.cpMat.uniforms.map.value = dc.rt.texture;
    const prevRT = r.getRenderTarget(), prevXR = r.xr.enabled;
    r.xr.enabled = false; r.setRenderTarget(this.rt); r.render(this.cpScene, this.cpCam); r.setRenderTarget(prevRT); r.xr.enabled = prevXR;
    this.busy = true;
    r.readRenderTargetPixelsAsync(this.rt, 0, 0, W, H, this.buf).then(() => {
      this.busy = false; if (!this.live || this.source !== 'avacam') return;
      this.g.putImageData(this.img, 0, 0); if (this.canvasTrack) this.canvasTrack.requestFrame();
    }).catch(() => { this.busy = false; });
  }

  _headPose(now) {   // centre-eye pose history (~0.5 s), for matching each camera frame's capture time
    const r = this.env.renderer, c = r.xr.isPresenting ? r.xr.getCamera() : this.env.camera; if (!c) return;
    let e = this.hist.length > 40 ? this.hist.shift() : { t: 0, m: new THREE.Matrix4() };
    e.t = now; e.m.copy(c.matrixWorld); this.hist.push(e);
  }
  _poseAt(t, out) {
    const H = this.hist; if (!H.length) return false;
    let b = H.length - 1; while (b > 0 && H[b - 1].t >= t) b--;
    const B = H[b], A = H[Math.max(0, b - 1)];
    if (B.t <= t || A === B) { out.copy(B.m); return true; }
    const k = Math.min(1, Math.max(0, (t - A.t) / (B.t - A.t)));
    const pa = _v1.setFromMatrixPosition(A.m), pb = _v2.setFromMatrixPosition(B.m), qa = _q1.setFromRotationMatrix(A.m), qb = _q2.setFromRotationMatrix(B.m);
    out.compose(pa.lerp(pb, k), qa.slerp(qb, k), _s1); return true;
  }
  _mrFrame() {   // one camera frame -> gear from the camera's pose -> laid over the picture -> read back
    const r = this.env.renderer, v = this.camVideo; if (!v || !this.camNew || this.busy || !v.videoWidth) return;
    this.camNew = false;
    const W = this.canvas.width, H = this.canvas.height, F = this.fit;
    if (!this.mr || this.mr.W !== W || this.mr.H !== H) {
      if (this.mr) { this.mr.rt.dispose(); this.mr.out.dispose(); }
      const half = r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float');
      const mr = this.mr = { W, H };
      mr.rt = new THREE.WebGLRenderTarget(W, H, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: 4 });
      mr.out = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false });
      mr.cam = new THREE.PerspectiveCamera(50, W / H, 0.05, 40);
      mr.tex = new THREE.VideoTexture(v); mr.tex.colorSpace = THREE.NoColorSpace;
      mr.mat = new THREE.ShaderMaterial({ uniforms: { map: { value: mr.rt.texture }, cam: { value: mr.tex } }, vertexShader: COPY_VS, fragmentShader: MR_FS, depthTest: false, depthWrite: false });
      mr.scene = new THREE.Scene(); const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mr.mat); q.frustumCulled = false; mr.scene.add(q);
      mr.oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      mr.buf = new Uint8Array(W * H * 4); mr.img = new ImageData(new Uint8ClampedArray(mr.buf.buffer), W, H);
    }
    const mr = this.mr;
    if (mr.tex.image !== v) { mr.tex.image = v; }
    if (v.readyState >= 2) mr.tex.needsUpdate = true;   // three's VideoTexture waits for frame callbacks, which may not run (see above)
    if (!this._poseAt(this.camFrameT - F.lag, _m1)) return;
    // camera = head pose x lens offset (mm, head axes) x tilt / turn / roll
    _m2.compose(_v1.set(F.x / 1000, F.y / 1000, F.z / 1000), _q1.setFromEuler(_e1.set(F.tilt * DEG, F.turn * DEG, F.roll * DEG, 'YXZ')), _s1);
    mr.cam.matrixWorld.multiplyMatrices(_m1, _m2); mr.cam.matrixWorldInverse.copy(mr.cam.matrixWorld).invert();
    mr.cam.matrixWorld.decompose(mr.cam.position, mr.cam.quaternion, mr.cam.scale);
    const vf = 2 * Math.atan(Math.tan(F.hfov * DEG / 2) / (W / H)) / DEG;
    if (mr.cam.fov !== vf || mr.cam.aspect !== W / H) { mr.cam.fov = vf; mr.cam.aspect = W / H; mr.cam.updateProjectionMatrix(); }
    const sc = this.env.scene, prevRT = r.getRenderTarget(), prevXR = r.xr.enabled, prevSh = r.shadowMap.autoUpdate, prevCol = r.getClearColor(_c1), prevA = r.getClearAlpha();
    const undo = this.env.mrPrep ? this.env.mrPrep() : null;
    try {
      r.xr.enabled = false; r.shadowMap.autoUpdate = false; r.setClearColor(0x000000, 0);
      mr.cam.updateMatrixWorld = () => {};   // keep the composed pose (three would rebuild it from position / quaternion)
      r.setRenderTarget(mr.rt); r.clear(); r.render(sc, mr.cam);
      r.setRenderTarget(mr.out); r.render(mr.scene, mr.oc);
    } finally {
      r.setClearColor(prevCol, prevA); r.xr.enabled = prevXR; r.shadowMap.autoUpdate = prevSh; r.setRenderTarget(prevRT);
      if (undo) undo();
    }
    this.busy = true; const buf = mr.buf, img = mr.img;
    r.readRenderTargetPixelsAsync(mr.out, 0, 0, W, H, buf).then(() => {
      this.busy = false; if (!this.running || this.source !== 'headset' || this.mr !== mr) return;
      this.g.putImageData(img, 0, 0); if (this.canvasTrack && this.live) this.canvasTrack.requestFrame();
      this.mrFrames = (this.mrFrames || 0) + 1;
    }).catch(() => { this.busy = false; });
  }

  // ---- SHOW / VIDEOWALL ----
  _showTick(now) {
    if (now - this.showT < 33) return;   // ~30 fps
    if (this.source === 'show' && this.show3d) { if (!this.busy) { this.showT = now; this._layerFrame(); } }   // composed when the layer arrives
    else { this.showT = now; this._compose(); }
  }
  _layerFrame() {
    const r = this.env.renderer, src = this.env.showCam && this.env.showCam(); if (!src) return;
    const W = 960, H = 540, O = this.showOpt;
    if (!this.ly) {
      const half = r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float');
      const ly = this.ly = {};
      ly.rt = new THREE.WebGLRenderTarget(W, H, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: 4 });
      ly.out = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false });
      ly.cam = new THREE.PerspectiveCamera(50, W / H, 0.05, 40); ly.cam.updateMatrixWorld = () => {};
      ly.mat = new THREE.ShaderMaterial({ uniforms: { map: { value: ly.rt.texture } }, vertexShader: COPY_VS, fragmentShader: SHOW_FS, depthTest: false, depthWrite: false });
      ly.scene = new THREE.Scene(); const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ly.mat); q.frustumCulled = false; ly.scene.add(q);
      ly.oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      ly.buf = new Uint8Array(W * H * 4); ly.img = new ImageData(new Uint8ClampedArray(ly.buf.buffer), W, H);
      ly.canvas = document.createElement('canvas'); ly.canvas.width = W; ly.canvas.height = H; ly.g = ly.canvas.getContext('2d');
    }
    const ly = this.ly, cam = ly.cam;
    cam.matrixWorld.copy(src.matrixWorld); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    if (cam.fov !== src.fov) { cam.fov = src.fov; cam.updateProjectionMatrix(); }
    cam.layers.mask = (O.gear ? 1 : 0) | (O.robot && this.env.avLayer != null ? 1 << this.env.avLayer : 0);
    const sc = this.env.scene, prevRT = r.getRenderTarget(), prevXR = r.xr.enabled, prevSh = r.shadowMap.autoUpdate, prevCol = r.getClearColor(_c1), prevA = r.getClearAlpha();
    const undo = this.env.showPrep ? this.env.showPrep() : null;
    try {
      r.xr.enabled = false; r.shadowMap.autoUpdate = false; r.setClearColor(0x000000, 0);
      r.setRenderTarget(ly.rt); r.clear(); r.render(sc, cam);
      r.setRenderTarget(ly.out); r.render(ly.scene, ly.oc);
    } finally {
      r.setClearColor(prevCol, prevA); r.xr.enabled = prevXR; r.shadowMap.autoUpdate = prevSh; r.setRenderTarget(prevRT);
      if (undo) undo();
    }
    this.busy = true;
    r.readRenderTargetPixelsAsync(ly.out, 0, 0, W, H, ly.buf).then(() => {
      this.busy = false; if (this.ly !== ly) return;
      ly.g.putImageData(ly.img, 0, 0); this.layerOk = true;
      if (this.source === 'show') this._compose();
    }).catch(() => { this.busy = false; });
  }
  _cover(g, el, W, H, flip) {   // fill the frame, crop the long side
    const w = el.videoWidth || el.width, h = el.videoHeight || el.height; if (!w || !h) return false;
    const k = Math.max(W / w, H / h), dw = w * k, dh = h * k;
    g.save(); if (flip) { g.translate(0, H); g.scale(1, -1); }
    g.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh); g.restore(); return true;
  }
  _compose() {
    const g = this.g, W = this.canvas.width, H = this.canvas.height, O = this.showOpt;
    // 1. visuals
    const bg = (O.visuals && this.env.wallSource && this.env.wallSource()) || [];
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    const gr = g.createRadialGradient(W / 2, H * 0.45, 40, W / 2, H / 2, W * 0.65); gr.addColorStop(0, '#141a28'); gr.addColorStop(1, '#030409');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (const L of bg) {
      if (!L || !L.el || L.gain === 0) continue;
      g.globalAlpha = L.gain == null ? 1 : Math.min(1, L.gain); g.globalCompositeOperation = L.add ? 'lighter' : 'source-over';
      this._cover(g, L.el, W, H, L.flip);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    // 2. robot + gear
    if (this.source === 'show' && this.show3d && this.layerOk && this.ly) g.drawImage(this.ly.canvas, 0, 0, W, H);
    // 3. overlays
    const sc = this.env.scroller && this.env.scroller();
    if (O.scroll && sc && sc.on && sc.canvas) { const bh = Math.round(W * sc.canvas.height / sc.canvas.width * 0.66); g.drawImage(sc.canvas, 0, H - bh - Math.round(H * 0.01), W, bh); /* a little wider than the wall's band: ~20 % of the frame */ }
    if (O.np) {
      const np = (this.env.nowPlaying && this.env.nowPlaying()) || {};
      if (np.a) {
        const t = '▶ ' + np.a + (np.bpm ? '   ' + np.bpm + ' BPM' : '');
        g.font = '600 26px system-ui,sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
        let s = t; while (s.length > 6 && g.measureText(s).width > W * 0.6) s = s.slice(0, -2);
        const tw = g.measureText(s).width;
        g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(24, 24, tw + 32, 44); g.fillStyle = '#ffffff'; g.fillText(s, 40, 47);
      }
    }
    if (O.logo) {
      g.font = '800 40px system-ui,sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'right';
      const x = W - 28, y = 48, w3 = g.measureText('3DJ').width;
      g.fillStyle = '#e0202a'; g.fillText('3DJ', x, y); g.fillStyle = '#ffffff'; g.fillText('Cly', x - w3, y);
    }
    g.textBaseline = 'alphabetic';
    if (this.canvasTrack && this.live) this.canvasTrack.requestFrame();
    this.showFrames = (this.showFrames || 0) + 1;
  }

  tick(now = performance.now()) {   // from the frame loop, after the DJ CAM render
    if (this.source === 'headset' && (this.testing || (this.live && this.fit.gear))) {
      this._headPose(now);
      // no frame callbacks (immersive session, video not composited): take a new picture ~30 times a second, 45 ms old
      if (now - (this.rvfcT || 0) > 300 && now - (this.pollT || 0) > 33) { this.pollT = now; this.camNew = true; this.camFrameT = now - 45; }
      this._mrFrame();
    }
    if (!this.live) return;
    if (this.source === 'show') this._showTick(now);
    else if (this.source === 'card') {
      if (now - this.cardT > 1000) { this.cardT = now; this.drawCard(now); }
      if (now - this.frameT > 100 && this.canvasTrack) { this.frameT = now; this.canvasTrack.requestFrame(); }
    } else if (this.source === 'avacam') this._avacamFrame();
    if (now - (this.statT || 0) > 2000) { this.statT = now; this._stats(); }
  }

  async _stats() {
    if (!this.pc) return;
    try {
      const rep = await this.pc.getStats(); let bytes = 0;
      rep.forEach(s => { if (s.type === 'outbound-rtp') bytes += s.bytesSent || 0; });
      const t = performance.now();
      if (this._lb != null) this.kbps = Math.max(0, Math.round((bytes - this._lb) * 8 / (t - this._lt)));
      this._lb = bytes; this._lt = t; this.env.onChange && this.env.onChange();
    } catch {}
  }

  // ---- WHIP ----
  async start() {
    if (this.live) return;
    const key = streamKey.get();
    if (!key) { this._set('error', 'No Twitch stream key: enter it on the start page'); return; }
    this._set('connecting', 'Connecting to Twitch…');
    try {
      const eng = this.env.engine; if (!eng.ctx) await eng.init({ latencyHint: 'interactive' }); await eng.resume();
      this.aTrack = eng.streamTrack();
      if (this.source === 'phone') this.env.phoneLive && this.env.phoneLive(true);
      this.vTrack = await this._videoTrack(this.source);
      await this._connect(key);
      this.t0 = performance.now(); this.retries = 0; this._lb = null;
      this._set('live', '');
    } catch (e) { this._teardown(); this._set('error', e.message || String(e)); }
  }

  async _connect(key) {
    const pc = this.pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
    const at = pc.addTransceiver(this.aTrack, { direction: 'sendonly' });
    const vt = pc.addTransceiver(this.vTrack, { direction: 'sendonly' });
    this.vSender = vt.sender; this.aSender = at.sender;
    try {   // Twitch takes H.264 (as OBS sends it); keep its repair codecs
      const caps = RTCRtpSender.getCapabilities('video').codecs;
      const h264 = caps.filter(c => /h264/i.test(c.mimeType)).sort((a, b) => (/42e01f/.test(b.sdpFmtpLine) ? 1 : 0) - (/42e01f/.test(a.sdpFmtpLine) ? 1 : 0));
      const rest = caps.filter(c => /rtx|red|ulpfec/i.test(c.mimeType));
      if (h264.length) vt.setCodecPreferences([...h264, ...rest]);
    } catch {}
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (pc !== this.pc) return;
      if (s === 'failed' || s === 'disconnected') this._lost(s);
    };
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise(res => {   // gather candidates first (WHIP has no trickle here); at most 2 s
      if (pc.iceGatheringState === 'complete') return res();
      const t = setTimeout(res, 2000);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
    const r = await fetch(TWITCH_WHIP, { method: 'POST', headers: { 'Content-Type': 'application/sdp', Authorization: 'Bearer ' + key }, body: pc.localDescription.sdp });
    const body = await r.text();
    if (!r.ok) throw new Error(r.status === 403 || r.status === 401 ? 'Twitch refused the stream key' : `Twitch said ${r.status}: ${body.slice(0, 80)}`);
    this.resource = r.headers.get('Location');
    // ask for full-band stereo music: Opus defaults to mono unless the answer says stereo
    const sdp = body.replace(/a=fmtp:(\d+) (.*)\r?\n/g, (line, pt, p) => new RegExp(`a=rtpmap:${pt} opus/`, 'i').test(body)
      ? `a=fmtp:${pt} ${p.replace(/;?(stereo|sprop-stereo|maxaveragebitrate|useinbandfec)=[^;]*/g, '')};stereo=1;sprop-stereo=1;maxaveragebitrate=${ABR * 1000};useinbandfec=1\r\n` : line);
    await pc.setRemoteDescription({ type: 'answer', sdp });
    await this._caps();
  }

  async _caps() {
    const set = async (s, maxBitrate, extra = {}) => {
      if (!s) return; const p = s.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      Object.assign(p.encodings[0], { maxBitrate, ...extra });
      try { await s.setParameters(p); } catch {}
    };
    await set(this.vSender, VBR[this.source] * 1000, { maxFramerate: 30 });
    await set(this.aSender, ABR * 1000, { priority: 'high', networkPriority: 'high' });
  }

  _lost(why) {
    if (this.state !== 'live') return;
    if (this.retries >= 3) { this.stop(); this._set('error', 'Connection lost (' + why + ')'); return; }
    this.retries++; this._set('connecting', `Reconnecting (${this.retries} of 3)…`);
    const key = streamKey.get(), old = this.pc; this.pc = null; try { old.close(); } catch {}
    setTimeout(async () => {
      if (this.state !== 'connecting') return;
      try { await this._connect(key); this._set('live', ''); } catch (e) { this.state = 'live'; this._lost(e.message); }
    }, 3000);
  }

  _teardown() {
    if (this.pc) { try { this.pc.close(); } catch {} this.pc = null; }
    if (this.resource) { const u = new URL(this.resource, TWITCH_WHIP).href, k = streamKey.get(); fetch(u, { method: 'DELETE', headers: { Authorization: 'Bearer ' + k } }).catch(() => {}); this.resource = null; }
    if (this.source === 'phone') this.env.phoneLive && this.env.phoneLive(false);
    if (!this.testing) this._stopCam();
    if (this.canvasTrack) { this.canvasTrack.stop(); this.canvasTrack = null; }
    this.env.engine.streamStop && this.env.engine.streamStop();
    this.aTrack = this.vTrack = this.vSender = this.aSender = null; this.t0 = 0; this.kbps = 0;
  }
  stop() { this._teardown(); this._set('off', ''); }
}
