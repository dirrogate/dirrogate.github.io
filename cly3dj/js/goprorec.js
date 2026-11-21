// #795 GOPRO 2 Selfie Recorder: 720p30 hardware H.264 + stereo master audio -> OPFS .mp4 (auto-saved on XR exit).
// Uses WebCodecs (VideoEncoder + AudioEncoder) + mp4-muxer FileSystemWritableFileStreamTarget so long takes stream
// straight to private storage (OPFS vire-rec/) with zero RAM bloat, matching MasterRec's workflow.
import * as THREE from 'three';
import { Muxer, FileSystemWritableFileStreamTarget } from '../vendor/mp4muxer/mp4-muxer.mjs';

const DIR = 'vire-rec', KEEP = 3, W = 1280, H = 720, FPS = 30;
const pad = n => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

// 1-quad ACES tone-mapping + sRGB + vertical flip shader so readRenderTargetPixels yields top-down sRGB RGBA directly
const BLIT_FS = `uniform sampler2D map; uniform float hdr; varying vec2 vUv;
vec3 rrt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= 1.0 / 0.6; return clamp(O * rrt(I * c), 0.0, 1.0); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
void main() {
  vec4 c = texture2D(map, vec2(vUv.x, 1.0 - vUv.y));
  vec3 o = hdr > 0.5 ? srgb(aces(max(c.rgb, 0.0))) : c.rgb;
  gl_FragColor = vec4(o, 1.0);
}`;

export class GoProRec {
  constructor(engine, { toast = () => {}, onChange = () => {}, inXR = () => false } = {}) {
    this.engine = engine; this.toast = toast; this.onChange = onChange; this.inXR = inXR;
    this.on = false; this.busy = false; this.pending = []; this.last = '';
    this.t0 = 0; this.frames = 0; this.name = '';
    this._rt = null; this._scene = null; this._cam = null; this._mat = null; this._px = null;
    this._muxer = null; this._ve = null; this._ae = null; this._w = null;
    this._aDst = null; this._aReader = null; this._aFirst = null; this._aStop = false;
  }
  get secs() { return this.on ? (performance.now() - this.t0) / 1000 : 0; }
  async dir() { return (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create: true }); }

  _ensureBlit() {
    if (this._rt) return;
    this._rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false });
    this._mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, hdr: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: BLIT_FS,
      depthTest: false, depthWrite: false
    });
    this._scene = new THREE.Scene();
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._mat));
    this._cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._px = new Uint8Array(W * H * 4);
  }

  async _pickVideo() {
    if (typeof VideoEncoder === 'undefined') return null;
    for (const [codec, hwa] of [
      ['avc1.4d0028', 'prefer-hardware'],
      ['avc1.640028', 'prefer-hardware'],
      ['avc1.42e028', 'prefer-hardware'],
      ['avc1.4d0028', 'no-preference'],
      ['avc1.42e028', 'no-preference'],
    ]) {
      const cfg = { codec, width: W, height: H, bitrate: 4_500_000, framerate: FPS, hardwareAcceleration: hwa, bitrateMode: 'variable', avc: { format: 'avc' } };
      try { const s = await VideoEncoder.isConfigSupported(cfg); if (s && s.supported) return cfg; } catch {}
    }
    return null;
  }

  async _pickAudio(rate) {
    if (typeof AudioEncoder === 'undefined' || typeof MediaStreamTrackProcessor === 'undefined') return null;
    for (const [mp4Codec, codec, bitrate] of [['aac', 'mp4a.40.2', 192000], ['opus', 'opus', 160000]]) {
      const cfg = { codec, sampleRate: rate, numberOfChannels: 2, bitrate };
      try { const s = await AudioEncoder.isConfigSupported(cfg); if (s && s.supported) return { mp4Codec, cfg }; } catch {}
    }
    return null;
  }

  async start() {
    if (this.on || this.busy) return false;
    this.busy = true;
    try {
      const vCfg = await this._pickVideo();
      if (!vCfg) { this.toast('GOPRO 2 REC: hardware H.264 VideoEncoder not available in this browser', 4000); return false; }

      const dir = await this.dir();
      await this.prune(dir);
      const name = `gopro2_${stamp()}.mp4`;
      const fh = await dir.getFileHandle(name, { create: true });
      const writable = await fh.createWritable();

      const ctx = this.engine && this.engine.ctx;
      const rate = (ctx && ctx.sampleRate) || 48000;
      const aPick = (ctx && this.engine.master) ? await this._pickAudio(rate) : null;

      const muxer = new Muxer({
        target: new FileSystemWritableFileStreamTarget(writable),
        video: { codec: 'avc', width: W, height: H },
        ...(aPick ? { audio: { codec: aPick.mp4Codec, numberOfChannels: 2, sampleRate: rate } } : {}),
        fastStart: false,   // fragmented/streamed directly to OPFS with zero RAM buffering
        firstTimestampBehavior: 'offset'
      });

      const ve = new VideoEncoder({
        output: (chunk, meta) => { try { muxer.addVideoChunk(chunk, meta); } catch {} },
        error: e => { console.warn('GoProRec video err', e); this.toast('GOPRO 2 REC video error: ' + e.message, 4000); }
      });
      ve.configure(vCfg);

      this._ae = null; this._aDst = null; this._aReader = null; this._aFirst = null; this._aStop = false;
      if (aPick && ctx && this.engine.master) {
        try {
          if (ctx.state !== 'running') await ctx.resume().catch(() => {});
          const aDst = ctx.createMediaStreamDestination();
          aDst.channelCount = 2;
          this.engine.master.connect(aDst);
          const ae = new AudioEncoder({
            output: (chunk, meta) => { try { muxer.addAudioChunk(chunk, meta); } catch {} },
            error: e => { console.warn('GoProRec audio err', e); }
          });
          ae.configure(aPick.cfg);
          const tr = aDst.stream.getAudioTracks()[0];
          const reader = new MediaStreamTrackProcessor({ track: tr }).readable.getReader();
          this._aDst = aDst; this._ae = ae; this._aReader = reader;
          (async () => {
            for (;;) {
              let r; try { r = await reader.read(); } catch { break; }
              if (r.done || this._aStop) { if (r.value) r.value.close(); break; }
              const a = r.value;
              if (!this.on || !this._ae || this._ae.state !== 'configured') { a.close(); continue; }
              if (this._aFirst == null) this._aFirst = a.timestamp;
              const ts = Math.max(0, a.timestamp - this._aFirst);
              try {
                const isPlanar = a.format && a.format.endsWith('-planar');
                const planeBytes = a.allocationSize({ planeIndex: 0 });
                const buf = new ArrayBuffer(planeBytes * (isPlanar ? a.numberOfChannels : 1));
                if (isPlanar) {
                  for (let p = 0; p < a.numberOfChannels; p++) a.copyTo(new Uint8Array(buf, p * planeBytes, planeBytes), { planeIndex: p });
                } else {
                  a.copyTo(buf, { planeIndex: 0 });
                }
                const ad = new AudioData({ format: a.format, sampleRate: a.sampleRate, numberOfFrames: a.numberOfFrames, numberOfChannels: a.numberOfChannels, timestamp: ts, data: buf });
                this._ae.encode(ad);
                ad.close();
              } catch {}
              a.close();
            }
          })();
        } catch (e) { console.warn('GoProRec audio setup skipped:', e); }
      }

      this._ensureBlit();
      this._muxer = muxer; this._ve = ve; this._w = writable;
      this.name = name; this.t0 = performance.now(); this.frames = 0; this.on = true;
      this.toast('● GOPRO 2 REC started (720p30' + (this._ae ? ' + master audio)' : ')'), 2600);
      return true;
    } catch (e) {
      this.toast('GOPRO 2 REC could not start: ' + (e.message || e), 4500);
      return false;
    } finally {
      this.busy = false;
      this.onChange();
    }
  }

  pushFrame(renderer, tex, hdr = true) {
    if (!this.on || !this._ve || this._ve.state !== 'configured') return;
    if (this._ve.encodeQueueSize > 4) return;   // never back up the GPU/encoder queue on Quest 3
    this._ensureBlit();
    this._mat.uniforms.map.value = tex;
    this._mat.uniforms.hdr.value = hdr ? 1 : 0;
    const prevRT = renderer.getRenderTarget(), prevXR = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(this._rt);
    renderer.render(this._scene, this._cam);
    renderer.readRenderTargetPixels(this._rt, 0, 0, W, H, this._px);
    renderer.setRenderTarget(prevRT);
    renderer.xr.enabled = prevXR;

    const ts = Math.round((performance.now() - this.t0) * 1000);
    const vf = new VideoFrame(this._px, { format: 'RGBA', codedWidth: W, codedHeight: H, timestamp: ts, duration: Math.round(1e6 / FPS) });
    try {
      this._ve.encode(vf, { keyFrame: (this.frames % (FPS * 2)) === 0 });
      this.frames++;
    } finally {
      vf.close();
    }
  }

  async stop() {
    if (!this.on || this.busy) return;
    this.on = false; this.busy = true; this._aStop = true;
    const durS = Math.max(1, Math.round((performance.now() - this.t0) / 1000));
    const name = this.name;
    try {
      if (this._aReader) { try { await this._aReader.cancel(); } catch {} this._aReader = null; }
      if (this._aDst && this.engine && this.engine.master) { try { this.engine.master.disconnect(this._aDst); } catch {} this._aDst = null; }
      if (this._ve && this._ve.state === 'configured') { await this._ve.flush(); this._ve.close(); }
      if (this._ae && this._ae.state === 'configured') { await this._ae.flush(); this._ae.close(); }
      this._ve = null; this._ae = null;
      if (this._muxer) { this._muxer.finalize(); this._muxer = null; }
      if (this._w) { await this._w.close(); this._w = null; }

      const dir = await this.dir();
      const fh = await dir.getFileHandle(name);
      const mb = (await fh.getFile()).size / 1e6;
      const m = Math.floor(durS / 60), s = durS % 60;
      this.last = name;
      if (this.inXR()) {
        this.pending.push(name);
        this.toast(`GOPRO 2 saved: ${m}:${pad(s)}, ${mb.toFixed(1)} MB. Leave VR, then tap SAVE on the page.`, 5000);
      } else {
        this.toast(`GOPRO 2 saved: ${m}:${pad(s)}, ${mb.toFixed(1)} MB -> Downloads`, 4000);
        await this.download(name);
      }
    } catch (e) {
      this.toast('GOPRO 2 REC stop error: ' + (e.message || e), 5000);
    } finally {
      this.busy = false;
      this.onChange();
    }
  }

  async download(name) {
    const f = await (await (await this.dir()).getFileHandle(name)).getFile();
    const url = URL.createObjectURL(f), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15 * 60 * 1000);
  }

  offer() {
    if (!this.pending.length) return;
    let el = document.getElementById('vire-gopro-takes');
    if (!el) {
      el = document.createElement('div'); el.id = 'vire-gopro-takes';
      el.style.cssText = 'position:fixed;left:50%;top:82px;transform:translateX(-50%);z-index:99999;display:flex;gap:10px;align-items:center;padding:12px 14px;background:#141922;border:1px solid #e01b24;border-radius:12px;font:600 18px system-ui,sans-serif;color:#e6e9ef;box-shadow:0 6px 24px rgba(0,0,0,.5)';
      document.body.appendChild(el);
    }
    const n = this.pending.length;
    el.innerHTML = '';
    const b = document.createElement('button');
    b.textContent = `SAVE ${n} GOPRO VIDEO${n > 1 ? 'S' : ''} (.MP4)`;
    b.style.cssText = 'font:700 20px system-ui,sans-serif;padding:14px 22px;border-radius:10px;border:0;background:#e01b24;color:#fff;cursor:pointer';
    const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Later';
    x.style.cssText = 'font:700 20px system-ui,sans-serif;padding:12px 16px;border-radius:10px;border:0;background:#2a3140;color:#c9ced8;cursor:pointer';
    b.onclick = async () => {
      b.disabled = true; b.textContent = 'SAVING…';
      const list = this.pending.splice(0);
      let ok = 0;
      for (const nm of list) {
        try { await this.download(nm); ok++; } catch { this.toast('Download failed for ' + nm, 4000); }
        await new Promise(r => setTimeout(r, 900));
      }
      el.remove();
      this.toast(`${ok} GoPro video${ok === 1 ? '' : 's'} sent to Downloads`, 5000);
    };
    x.onclick = () => el.remove();
    el.append(b, x);
  }

  async prune(dir) {
    const names = [];
    for await (const [n, h] of dir.entries()) if (h.kind === 'file' && /^gopro2_.*\.mp4$/i.test(n)) names.push(n);
    names.sort();
    for (const n of names.slice(0, Math.max(0, names.length - (KEEP - 1)))) { try { await dir.removeEntry(n); } catch {} }
  }
}
