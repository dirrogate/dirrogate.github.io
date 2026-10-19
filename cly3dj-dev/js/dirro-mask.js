// #428 Dirrogram person cutout (audience-ar-plan.md, Phase C). MediaPipe's selfie segmentation finds the people in the
// camera picture; the page then draws them back over the show, so DIRRODJ, the LED wall and the lasers sit behind
// them (selfies), and a beam that meets a hand stops there with a glow on the skin.
// Loaded only when PEOPLE is switched on (the runtime is ~11 MB). iPhones use the CPU delegate (MediaPipe's GPU path
// scrambled selfie labels on iOS, google-ai-edge/mediapipe#6142); Android the GPU.
// Mask: a 0..255 person-confidence image the size of the model output, eased over frames, in a THREE.DataTexture.
import * as THREE from 'three';

const BASE = new URL('../vendor/mediapipe/', import.meta.url).href;
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export class PersonMask {
  constructor() { this.seg = null; this.state = 'off'; this.tex = null; this.buf = null; this.w = 0; this.h = 0; this.lastT = 0; this.busy = false; this.ms = 0; this.err = '';
    this.trail = null; this.ttex = null; this.cx = 0.5; this.cy = 0.5; this.area = 0; }   // #439 FX: the fading trail of past masks (ECHO) and the person's middle (OP-ART rings)
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
  step(video, now) {
    const vid = video instanceof HTMLVideoElement;   // a still picture works too (the PC test photo)
    if (!this.seg || this.busy || now - this.lastT < 50 || !(vid ? video.videoWidth && video.readyState >= 2 : video.naturalWidth)) return;
    this.lastT = now; this.busy = true; const t0 = performance.now();
    try {
      this.seg.segmentForVideo(video, now, res => {
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
          for (let i = 0, n = w * h; i < n; i++) b[i] = b[i] * 0.35 + Math.min(255, f[i] * 255) * 0.65;   // eased: less flicker at the edges
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
