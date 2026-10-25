// #428 Dirrogram person cutout (audience-ar-plan.md, Phase C). MediaPipe's selfie segmentation finds the people in the
// camera picture; the page then draws them back over the show, so DIRRODJ, the LED wall and the lasers sit behind
// them (selfies), and a beam that meets a hand stops there with a glow on the skin.
// Loaded only when PEOPLE is switched on (the runtime is ~11 MB). iPhones use the CPU delegate (MediaPipe's GPU path
// scrambled selfie labels on iOS, google-ai-edge/mediapipe#6142); Android the GPU.
// Mask: a 0..255 person-confidence image the size of the model output, eased over frames, in a THREE.DataTexture.
import * as THREE from 'three';

const BASE = new URL('../vendor/mediapipe/', import.meta.url).href;
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// #466 LOW LIGHT: the model gets its own brightened, colour-neutral, slightly smoothed copy of the picture (what people
// see on screen keeps the club's real colours). One small WebGL pass: gray-world white balance, auto gain to a mid
// grey, a gamma lift in the dark, a soft shoulder so laser beams don't clip, a mild S-curve; sampled 5 ways while
// shrinking to 320 px on the long side (averages sensor noise). Stats from a 16 x 9 read-back each step, which also
// spot strobes / blackouts (a sudden brightness jump): the last good mask is held for 160 ms.
const VS = 'attribute vec2 p; varying vec2 v; void main() { v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
const FS = `precision mediump float; uniform sampler2D t; uniform vec2 d; uniform vec3 wb; uniform float gain, gam; varying vec2 v;
void main() {
  vec3 c = texture2D(t, v).rgb * 0.4 + (texture2D(t, v + vec2(d.x, 0.0)).rgb + texture2D(t, v - vec2(d.x, 0.0)).rgb
         + texture2D(t, v + vec2(0.0, d.y)).rgb + texture2D(t, v - vec2(0.0, d.y)).rgb) * 0.15;
  c *= wb * gain;
  c = c / (1.0 + max(c - 0.8, 0.0) * 2.0);           // soft shoulder above 0.8: beams and LEDs don't flood the frame
  c = pow(clamp(c, 0.0, 1.0), vec3(gam));
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.25);         // a little contrast back after the lift
  gl_FragColor = vec4(c, 1.0);
}`;
class LowLight {
  constructor() {
    this.ok = false; this.mean = 0.5; this.base = 0; this.hold = 0; this.gain = 1; this.gam = 1; this.wb = [1, 1, 1];
    try {
      this.cv = document.createElement('canvas'); this.cv.width = 320; this.cv.height = 180;
      const gl = this.gl = this.cv.getContext('webgl', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
      if (!gl) return;
      const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      gl.useProgram(pr); this.u = {}; for (const k of ['t', 'd', 'wb', 'gain', 'gam']) this.u[k] = gl.getUniformLocation(pr, k);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const a = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      this.tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tx);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      this.sc = document.createElement('canvas'); this.sc.width = 16; this.sc.height = 9; this.sg = this.sc.getContext('2d', { willReadFrequently: true });
      this.ok = true;
    } catch (e) { console.warn('low light pass', e); this.ok = false; }
  }
  // el: the camera <video> (or a picture); returns the canvas the model should look at, or el when the pass can't run
  run(el, w, h, now) {
    if (!this.ok) return el;
    try {
      this.sg.drawImage(el, 0, 0, 16, 9); const px = this.sg.getImageData(0, 0, 16, 9).data;
      let r = 0, g = 0, b = 0; for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
      const n = px.length / 4 * 255; r /= n; g /= n; b /= n;
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b; this.mean = L;
      if (this.base && (L > this.base * 1.8 + 0.04 || L < this.base * 0.5 - 0.02)) this.hold = now + 160;   // a strobe or a blackout
      this.base = this.base ? this.base + (L - this.base) * 0.15 : L;
      const m = (r + g + b) / 3 || 1e-3, ez = k => Math.min(1.8, Math.max(0.6, m / Math.max(k, 1e-3)));
      const wb = [ez(r), ez(g), ez(b)]; for (let i = 0; i < 3; i++) this.wb[i] += (wb[i] - this.wb[i]) * 0.2;
      this.gain += (Math.min(6, Math.max(1, 0.42 / Math.max(L, 0.01))) - this.gain) * 0.2;
      const s = Math.min(1, Math.max(0, (L - 0.08) / 0.22)); this.gam = 0.75 + 0.25 * s * s * (3 - 2 * s);
      const W = w >= h ? 320 : Math.round(320 * w / h), H = w >= h ? Math.round(320 * h / w) : 320;
      if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
      const gl = this.gl; gl.viewport(0, 0, W, H);
      gl.bindTexture(gl.TEXTURE_2D, this.tx); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, el);
      gl.uniform1i(this.u.t, 0); gl.uniform2f(this.u.d, 0.5 / W, 0.5 / H); gl.uniform3fv(this.u.wb, this.wb); gl.uniform1f(this.u.gain, this.gain); gl.uniform1f(this.u.gam, this.gam);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return this.cv;
    } catch (e) { console.warn('low light pass', e); this.ok = false; return el; }
  }
}

export class PersonMask {
  constructor() { this.seg = null; this.state = 'off'; this.tex = null; this.buf = null; this.w = 0; this.h = 0; this.lastT = 0; this.busy = false; this.ms = 0; this.err = '';
    this.trail = null; this.ttex = null; this.cx = 0.5; this.cy = 0.5; this.area = 0;
    this.low = null; this.dark = false; }   // #466 LOW LIGHT pass (made on first use)   // #439 FX: the fading trail of past masks (ECHO) and the person's middle (OP-ART rings)
  async load() {
    if (this.seg || this.state === 'loading') return this.state;
    this.state = 'loading';
    try {
      const { FilesetResolver, ImageSegmenter } = await import(BASE + 'vision_bundle.mjs');
      const fs = await FilesetResolver.forVisionTasks(BASE + 'wasm');
      const make = delegate => ImageSegmenter.createFromOptions(fs, { baseOptions: { modelAssetPath: BASE + 'selfie_segmentation.tflite', delegate },
        runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true });
      try { this.seg = await make(IOS ? 'CPU' : 'GPU'); } catch (e) { if (IOS) throw e; this.seg = await make('CPU'); }
      this.state = 'ready';
    } catch (e) { console.warn('person mask', e); this.err = e.message || String(e); this.state = 'error'; }
    return this.state;
  }
  // video: the camera <video> (or an <img>); every ~50 ms (20 a second at most)
  // #466 opts.low: run the LOW LIGHT pass first (SETTINGS > LOW LIGHT ON / MAX)
  step(video, now, opts = {}) {
    const vid = video instanceof HTMLVideoElement;   // a still picture works too (the PC test photo)
    if (!this.seg || this.busy || now - this.lastT < 50 || !(vid ? video.videoWidth && video.readyState >= 2 : video.naturalWidth)) return;
    this.lastT = now;
    let input = video;
    if (opts.low) {
      if (!this.low) this.low = new LowLight();
      input = this.low.run(video, vid ? video.videoWidth : video.naturalWidth, vid ? video.videoHeight : video.naturalHeight, now);
      this.dark = this.low.mean < 0.12;
      if (now < this.low.hold) return;   // strobe / blackout: keep the last good mask
    } else this.dark = false;
    this.busy = true; const t0 = performance.now();
    try {
      this.seg.segmentForVideo(input, now, res => {
        const m = res.confidenceMasks && res.confidenceMasks[0];
        if (m) {
          const w = m.width, h = m.height, f = m.getAsFloat32Array();
          if (w !== this.w || h !== this.h || !this.tex) {
            this.w = w; this.h = h; this.buf = new Uint8Array(w * h);
            if (this.tex) this.tex.dispose();
            this.tex = new THREE.DataTexture(this.buf, w, h, THREE.RedFormat, THREE.UnsignedByteType);
            this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter; this.tex.flipY = false;
            this.trail = new Uint8Array(w * h); if (this.ttex) this.ttex.dispose();
            this.ttex = new THREE.DataTexture(this.trail, w, h, THREE.RedFormat, THREE.UnsignedByteType);
            this.ttex.minFilter = this.ttex.magFilter = THREE.LinearFilter; this.ttex.flipY = false;
          }
          const b = this.buf;
          // eased: less flicker at the edges; #466 hysteresis (a pixel already 'person' needs to drop under ~0.4 to leave,
          // a background one to pass ~0.6 to join) and more easing when the room is dark
          const kN = this.dark ? 0.4 : 0.65, kO = 1 - kN;
          for (let i = 0, n = w * h; i < n; i++) { let v = f[i] + (b[i] > 128 ? 0.1 : -0.1); v = v < 0 ? 0 : v > 1 ? 1 : v; b[i] = b[i] * kO + v * 255 * kN; }
          this.tex.needsUpdate = true;
          // #439 the trail fades over about a second (20 masks a second); the middle of whoever is in the picture
          const tr = this.trail; let sx = 0, sy = 0, sn = 0;
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = y * w + x, v = b[i]; tr[i] = Math.max(v, tr[i] * 0.88);
            if (v > 128 && !((x | y) & 1)) { sx += x; sy += y; sn++; }
          }
          this.ttex.needsUpdate = true; this.area = sn * 4 / (w * h);
          if (sn) { this.cx += ((sx / sn + 0.5) / w - this.cx) * 0.4; this.cy += ((sy / sn + 0.5) / h - this.cy) * 0.4; }
        }
        if (res.close) res.close();
      });
    } catch (e) { if (!this.err) { this.err = e.message || String(e); console.warn('person mask', e); } }
    this.ms = this.ms ? this.ms + (performance.now() - t0 - this.ms) * 0.1 : performance.now() - t0;
    this.busy = false;
  }
}
