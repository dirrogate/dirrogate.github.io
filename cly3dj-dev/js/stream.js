// #331 LIVE STREAM (owner): the Quest goes live on Twitch by itself, no PC, no BeamXR. WebRTC straight to Twitch's
// WHIP ingest (g.webrtc.live-video.net, checked from a web page on 13 Oct 2026: CORS passes, the stream key goes in
// the Authorization header). The sound is the MASTER bus only (after the master fader and limiter, with the MIC when
// it goes through the mixer), tapped before the headphone split, so CUE never reaches the stream. BeamXR records the
// headset's output, which carries the cue too.
// Picture sources: CARD (a Cly3DJ card with what is playing, nearly free), AVACAM (the DJ CAM robot shot, copied to
// 960 x 540 and read back without stalling the GPU), HEADSET (the Quest's own camera, sent as it comes, no
// rendering) and PHONE (the spectator phone's LIVE composite, passed on).
// The key is kept on this headset only (localStorage 'vire.twitchKey') and goes nowhere but the Twitch endpoint.
import * as THREE from 'three';

export const TWITCH_WHIP = 'https://g.webrtc.live-video.net:4443/v2/offer';
export const SOURCES = { card: 'CARD', avacam: 'AVACAM', headset: 'HEADSET CAM', phone: 'PHONE' };
const VBR = { card: 600, avacam: 2500, headset: 3000, phone: 2000 };   // video kbit/s caps per source
const ABR = 160;   // Opus stereo kbit/s

const KEY = 'vire.twitchKey', SRC = 'vire.streamSrc';
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
  }
  get live() { return this.state === 'live' || this.state === 'connecting'; }
  get wantsCam() { return this.live && this.source === 'avacam'; }   // main.js keeps the DJ CAM running for us
  hasKey() { return !!streamKey.get(); }
  keyHint() { const k = streamKey.get(); return k ? '••••' + k.slice(-4) : 'no key'; }
  elapsed() { if (!this.t0) return '00:00:00'; const s = Math.floor((performance.now() - this.t0) / 1000); return [s / 3600, s / 60 % 60, s % 60].map(v => String(Math.floor(v)).padStart(2, '0')).join(':'); }
  _set(state, msg = '') { this.state = state; this.msg = msg; this.env.onChange && this.env.onChange(); }

  // ---- picture ----
  async _videoTrack(src) {
    if (src === 'headset') {
      if (!this.camStream || this.camStream.getVideoTracks()[0].readyState !== 'live') {
        this.camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 }, frameRate: { ideal: 30 } }, audio: false });
      }
      const t = this.camStream.getVideoTracks()[0]; t.contentHint = 'motion'; return t;
    }
    if (src === 'phone') {
      const t = this.env.phoneTrack && this.env.phoneTrack();
      if (!t) throw new Error('no phone LIVE picture (link the phone first)');
      return t;
    }
    if (!this.canvasTrack || this.canvasTrack.readyState !== 'live') { this.canvasTrack = this.canvas.captureStream(0).getVideoTracks()[0]; this.canvasTrack.contentHint = 'motion'; }
    if (src === 'avacam') this._sizeCanvas(960, 540); else this._sizeCanvas(1280, 720);
    this.cardT = 0;
    return this.canvasTrack;
  }
  _sizeCanvas(w, h) { if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; } }
  _stopCam() { if (this.camStream) { this.camStream.getTracks().forEach(t => t.stop()); this.camStream = null; } }

  async setSource(src) {
    if (!SOURCES[src]) return;
    const prev = this.source; this.source = src; ls.set(SRC, src);
    if (!this.live || !this.vSender) { this.env.onChange && this.env.onChange(); return; }
    try {
      if (src === 'phone') this.env.phoneLive && this.env.phoneLive(true);
      const t = await this._videoTrack(src);
      await this.vSender.replaceTrack(t); this.vTrack = t;
      await this._caps();
      if (prev === 'headset' && src !== 'headset') this._stopCam();
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

  tick(now = performance.now()) {   // from the frame loop, after the DJ CAM render
    if (!this.live) return;
    if (this.source === 'card') {
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
    this._stopCam();
    if (this.canvasTrack) { this.canvasTrack.stop(); this.canvasTrack = null; }
    this.env.engine.streamStop && this.env.engine.streamStop();
    this.aTrack = this.vTrack = this.vSender = this.aSender = null; this.t0 = 0; this.kbps = 0;
  }
  stop() { this._teardown(); this._set('off', ''); }
}
