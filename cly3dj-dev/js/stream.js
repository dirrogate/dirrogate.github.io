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
import { drawChat } from './chat.js';
import { tvHost, tvNewKey, tvPairSend } from './net-link.js';   // #376 Cly3DTV

const TVK = 'vire.tv';   // #376 { key, on, audio }: the paired venue screen
export const TWITCH_WHIP = 'https://g.webrtc.live-video.net:4443/v2/offer';
// #370 (owner): the CARD plate carries a QR code for the Twitch channel, top right, so people in the room (or on a club
// screen) can scan it. Static: made offline (Python qrcode, version 3, error correction M, 29 x 29 modules) for the text
// below and kept here as rows of 0 / 1, because the app has no QR library and no network dependencies. To change the
// address, remake the rows (the text is what the code says; a phone opens it as a link).
const QR_TEXT = 'https://www.twitch.tv/dirrogate', QR_SHOW = 'twitch.tv/dirrogate';
const QR_ROWS = '11111110010100100011001111111|10000010001110001110101000001|10111010010100110111101011101|10111010010001001010001011101|10111010011000000110101011101|10000010110100011001101000001|11111110101010101010101111111|00000000001011011111100000000|10010110101100101000110100000|10001001011111011110101001001|11110111001101110111110001110|10011000101001001001010110110|11100011100100110100011001011|00000101111111111111100100000|00101111111111100010011001111|01101101011000010100101001010|11000110111001000100110100010|01010001000011111100111101001|10010110001110111100100100011|00000001010110100110001000011|10111110010100011001111110100|00000000111110110101100010111|11111110000000001100101010010|10000010110010111010100011101|10111010010110001100111110010|10111010111001000101101011101|10111010000011001110010011101|10000010001000011111100010010|11111110110001001100100110010'.split('|');
export const SOURCES = { card: 'CARD', avacam: 'AVACAM', show: 'SHOWTIME!', headset: 'HEADSET CAM', phone: 'PHONE', pcam: 'PHONE CAM' };   // #347 PHONE CAM   // #338 VIDEOWALL gone: SHOWTIME! with ROBOT and GEAR off is the same
const VBR = { card: 600, avacam: 2500, show: 3500, headset: 3000, phone: 2000, pcam: 3500 };
// #336 SHOW = three layers: the LED wall's visuals full frame (clip / image / VidVinyl / phone LIVE), the robot DJ and
// gear from the AVACAM camera (BOOTH angle) drawn on a see-through background, and flat overlays (scroller, now
// playing, logo). VIDEOWALL = the visuals and overlays only (no 3D render). Toggles saved as 'vire.showOpts'.
// #372 backdrop: 'none' | 'visuals' | 'dome' (one at a time); object toggles wall (3D LED wall), gopro (the prop), panel (chat panel), chalk (chalkboard), neon
export const SHOW_DEF = { backdrop: 'visuals', robot: true, gear: true, wall: false, gopro: true, panel: true, chalk: true, neon: true, scroll: true, np: true, logo: true, chat: false, handsReal: false };   // #375 handsReal: HEADSET CAM / PHONE CAM leave your hands bare (no drawn hands, glove or sleeves)
export const BACKDROPS = ['none', 'visuals', 'dome'];
export const SHOW_PRESETS = {   // #372 FULL = everything on air, LEAN = visuals + robot only (cheap), FIRST PERSON = the DJ's own view (gear, no robot)
  full: { backdrop: 'visuals', robot: true, gear: true, wall: true, gopro: true, panel: true, chalk: true, neon: true },
  lean: { backdrop: 'visuals', robot: true, gear: false, wall: false, gopro: false, panel: false, chalk: false, neon: false },
  first: { backdrop: 'visuals', robot: false, gear: true, wall: false, gopro: true, panel: true, chalk: true, neon: true },
};
// #372 migration of saved 'vire.showOpts': the old 'visuals' on / off becomes the backdrop; settings saved before the object
// toggles existed keep what they did (wall, off; neon, GoPro, panel and chalkboard followed GEAR / ROBOT: with both off,
// nothing 3D was drawn, so the new object toggles start off too)
export function migrateShowOpts(s) {
  s = { ...(s || {}) };
  if ('visuals' in s) { if (!('backdrop' in s)) s.backdrop = s.visuals ? 'visuals' : 'none'; delete s.visuals; }
  if (!('wall' in s) && s.gear === false && s.robot === false) Object.assign(s, { wall: false, gopro: false, panel: false, chalk: false, neon: false });
  return s;
}   // #340 CHAT: Twitch chat on the right   // #338 VISUALS: the background on / off   // video kbit/s caps per source
const ABR = 160;   // Opus stereo kbit/s

const KEY = 'vire.twitchKey', SRC = 'vire.streamSrc', FIT = 'vire.mrcam', SHOWO = 'vire.showOpts', PCAMK = 'vire.pcam';
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

// #347 PHONE CAM (owner): the spectator phone on a tripod (fixed camera mode, calibrated) sends its plain camera video;
// the Quest draws the gear, LED wall, chalkboard and the DJ's drawn hands (3D hands / glove / controllers, with black
// forearm sleeves) from the phone's own pose over it. GREEN SCREEN on: the phone sends one packed 1920 x 720 frame
// (pcampack.js: colour 1280 wide, matte 624 wide at x 1296); the person is cut out over a background (the VISUALS, or
// the dome / pano drawn from the phone's view), graded toward the panorama (LIGHT MATCH: camera cast neutralised and
// exposure levelled from the person only, re-tinted to the pano, light wrap, a glow on the side the key light comes
// from). LATENCY MATCH: hands and gear drawn as they were when the frame was filmed, the stream sound delayed as much.
// Layers back to front: background, person, gear + hands, overlays (scroller, now playing, logo, chat).
export const PCAM_DEF = { green: false, light: true, lightStr: 0.7, wrap: 0.5, glow: 0.4, expo: 0, lat: false, trim: 0, manual: 150, matte: false };
const PCAM_FS = `uniform sampler2D map; uniform sampler2D cam; uniform sampler2D bg; varying vec2 vUv;
uniform float green, bgLin, showMatte, wrap, glow; uniform vec4 pack; uniform vec3 gain, wrapCol, glowCol; uniform vec2 glowDir, texel;
vec3 rrt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= 1.0 / 0.6; return clamp(O * rrt(I * c), 0.0, 1.0); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
float matteAt(vec2 uv) { uv = clamp(uv, vec2(0.0), vec2(1.0)); return texture2D(cam, vec2(pack.z + uv.x * pack.w, uv.y)).r; }
void main() { vec2 uv = vec2(vUv.x, 1.0 - vUv.y); vec4 g = texture2D(map, uv);
  float a = clamp(g.a, 0.0, 1.0); vec3 gc = srgb(aces(g.rgb / max(a, 0.001)));
  vec3 c;
  if (green > 0.5) {
    vec3 col = texture2D(cam, vec2(uv.x * pack.x, uv.y)).rgb; float m = matteAt(uv);
    vec3 b = texture2D(bg, uv).rgb; if (bgLin > 0.5) b = srgb(aces(b));
    vec3 p = col * gain;
    if (wrap > 0.0 && m > 0.01) {   // light wrap: how much background surrounds this kept pixel
      float k = 0.0; for (int i = 0; i < 6; i++) { float t = float(i) * 1.0472; k += matteAt(uv + vec2(cos(t), sin(t)) * texel * 8.0); }
      p += wrapCol * (1.0 - k / 6.0) * wrap * 0.9;
    }
    if (glow > 0.0 && m > 0.01) {   // key-side glow: the silhouette's edge that faces the light
      float s = 0.5 * (matteAt(uv + glowDir * texel * 10.0) + matteAt(uv + glowDir * texel * 20.0));
      p += glowCol * (1.0 - s) * glow;
    }
    c = showMatte > 0.5 ? vec3(m) : mix(b, clamp(p, 0.0, 1.0), m);
  } else c = texture2D(cam, uv).rgb;
  gl_FragColor = vec4(mix(c, gc, a), 1.0); }`;
const _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();

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
    this.rehearse = false;
    this.hist = []; this.mr = null;
    { const raw = lsJ(SHOWO); this.showOpt = { ...SHOW_DEF, ...migrateShowOpts(raw) }; if (raw && 'visuals' in raw) ls.set(SHOWO, JSON.stringify(this.showOpt)); }
    this._wallShot = false; this.ly = null; this.showT = 0; this.layerOk = false;
    this.pc_ = { ...PCAM_DEF, ...(lsJ(PCAMK) || {}) };
    // #374 PHONE CAM follows the SHOWTIME! backdrop (NONE / VISUALS / DOME); its own BG setting is dropped, a saved DOME carries over once if no SHOWTIME! settings were saved
    if ('bg' in this.pc_) { if (this.pc_.bg === 'dome' && !lsJ(SHOWO)) { this.showOpt.backdrop = 'dome'; ls.set(SHOWO, JSON.stringify(this.showOpt)); } delete this.pc_.bg; ls.set(PCAMK, JSON.stringify(this.pc_)); }
    if (this.source === 'phone') { this.source = 'show'; ls.set(SRC, 'show'); }   // #374 the plain PHONE source has no button any more
    // #376 Cly3DTV: the paired venue screen (venue.html); listens as soon as the app is up when a key is saved
    this.tvSet = { key: '', on: true, audio: true, ...(lsJ(TVK) || {}) }; this.tvLink = null; this.tvUp = false; this.tvMsg = ''; this.tvPairing = 0; this.tvKbps = 0; this.tvFps = 0;
    if (this.tvSet.key && this.tvSet.on) this._tvOpen();
    this.pk = null; this.pkNew = false; this.pkMsg = ''; this.delay = null; this.grade = new THREE.Vector3(1, 1, 1); this.gradeT = 0;   // #347
  }
  setPcam(k, v) {   // #347 PHONE CAM SETUP
    if (!(k in PCAM_DEF)) return; this.pc_[k] = v; ls.set(PCAMK, JSON.stringify(this.pc_));
    if (k === 'green' && this.active && this.source === 'pcam') this.env.phoneLive && this.env.phoneLive(true, this._pcamOpts());
    if (k === 'lat' || k === 'trim' || k === 'manual') this._audioDelay();
    this.env.onChange && this.env.onChange();
  }
  _pcamOpts() { return this.source === 'pcam' ? { pcam: true, green: !!this.pc_.green } : {}; }
  get latMs() { return Math.max(0, (this.delay != null ? this.delay : this.pc_.manual) + this.pc_.trim); }   // the delay used by LATENCY MATCH
  _audioDelay() { const e = this.env.engine; if (e && e.setStreamDelay) e.setStreamDelay(this.active && this.source === 'pcam' && this.pc_.lat ? this.latMs / 1000 : 0); }
  setShowOpt(k, v) { if (k in SHOW_DEF) { this.showOpt[k] = v; ls.set(SHOWO, JSON.stringify(this.showOpt)); this.env.onChange && this.env.onChange(); } }
  applyPreset(name) { const p = SHOW_PRESETS[name]; if (!p) return; Object.assign(this.showOpt, p); ls.set(SHOWO, JSON.stringify(this.showOpt)); this.env.onChange && this.env.onChange(); }
  nextBackdrop() { this.setShowOpt('backdrop', BACKDROPS[(BACKDROPS.indexOf(this.showOpt.backdrop) + 1) % BACKDROPS.length]); }
  get show3d() { const O = this.showOpt; return this.source === 'show' && !!(O.robot || O.gear || O.wall || O.gopro || O.panel || O.chalk || O.neon || O.backdrop === 'dome'); }
  get running() { return this.live || this.testing; }
  get active() { return this.live || this.rehearse; }
  get sending() { return this.live || this.tvUp; }   // #376 the canvas track is fed for Twitch and / or the venue screen   // #339 REHEARSAL: the chosen source is drawn for the tablet MONITOR without going live
  setRehearse(on) {
    on = !!on; if (!on && this.tvUp) return;   // #376 the venue screen needs the shot running
    if (on === this.rehearse) return; this.rehearse = on;
    if (on && !this.live) { this._sizeFor(this.source); this.layerOk = false; }
    if (this.source === 'pcam' && !this.live) { this.env.phoneLive && this.env.phoneLive(on, this._pcamOpts()); this._audioDelay(); }
    if (this.source === 'headset' && !this.live) this.setTesting(on);
    this.env.onChange && this.env.onChange();
  }
  _sizeFor(src) { if (src === 'avacam') this._sizeCanvas(960, 540); else if (src === 'headset') { if (this.camStream) this._mrSize(); } else this._sizeCanvas(1280, 720); }
  setFit(k, v) { if (k in FIT_DEF) { this.fit[k] = v; ls.set(FIT, JSON.stringify(this.fit)); if (k === 'gear') this._gearChanged(); this.env.onChange && this.env.onChange(); } }
  resetFit() { const g = this.fit.gear; this.fit = { ...FIT_DEF, gear: g }; ls.set(FIT, JSON.stringify(this.fit)); this.env.onChange && this.env.onChange(); }
  async _gearChanged() {   // HEADSET CAM on air: switch between the MR canvas and the raw camera
    if (!this.live || this.source !== 'headset' || !this.vSender) return;
    try { const t = await this._videoTrack('headset'); await this.vSender.replaceTrack(t); this.vTrack = t; this._tvFollow(); } catch (e) { this.msg = 'Camera: ' + e.message; }
  }
  async setTesting(on) {
    if (on === this.testing) return;
    if (on) { try { await this._openCam(); this._mrSize(); this.testing = true; } catch (e) { this.msg = 'Camera: ' + e.message; } }
    else { this.testing = false; if (!(this.live && this.source === 'headset')) this._stopCam(); }
    this.env.onChange && this.env.onChange();
  }
  get live() { return this.state === 'live' || this.state === 'connecting'; }
  get wantsCam() { return this.active && (this.source === 'avacam' || this.show3d); }   // main.js keeps the DJ CAM (pose, aim, robot) running for us
  get needsCamRT() { return this.active && this.source === 'avacam'; }   // only AVACAM uses the DJ CAM's own picture
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
    if (this.rehearse && !this.live) {   // #339 MONITOR off air: follow the new source
      this._sizeFor(src); this.layerOk = false;
      if (prev === 'headset' && src !== 'headset') this.setTesting(false); else if (src === 'headset') await this.setTesting(true);
      if (src === 'phone' || src === 'pcam') this.env.phoneLive && this.env.phoneLive(true, this._pcamOpts()); else if (prev === 'phone' || prev === 'pcam') this.env.phoneLive && this.env.phoneLive(false);
      this._audioDelay();
    }
    this._tvFollow();   // #376
    if (!this.live || !this.vSender) { this.env.onChange && this.env.onChange(); return; }
    try {
      if (src === 'phone' || src === 'pcam') this.env.phoneLive && this.env.phoneLive(true, this._pcamOpts());
      const t = await this._videoTrack(src);
      await this.vSender.replaceTrack(t); this.vTrack = t;
      await this._caps();
      if (prev === 'headset' && src !== 'headset' && !this.testing) this._stopCam();
      if ((prev === 'phone' || prev === 'pcam') && src !== 'phone' && src !== 'pcam') this.env.phoneLive && this.env.phoneLive(false);
      this._audioDelay();
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
    this._drawQr(g);
  }
  // #370 the Twitch QR: white plate with the 4-module quiet zone the scanners want, 7 px modules (≈ 260 px), top right,
  // address under it. Drawn once into its own canvas, then copied (the card redraws every second).
  _drawQr(g) {
    if (!this._qrCv) {
      const n = QR_ROWS.length, M = 7, Q = 4, S = (n + 2 * Q) * M, c = this._qrCv = document.createElement('canvas'); c.width = c.height = S;
      const q = c.getContext('2d'); q.fillStyle = '#ffffff'; q.fillRect(0, 0, S, S); q.fillStyle = '#000000';
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (QR_ROWS[y][x] === '1') q.fillRect((x + Q) * M, (y + Q) * M, M, M);
    }
    const S = this._qrCv.width, x = 1280 - 24 - S, y = 24;
    g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect ? g.roundRect(x - 6, y - 6, S + 12, S + 12, 14) : g.rect(x - 6, y - 6, S + 12, S + 12); g.fill();
    g.drawImage(this._qrCv, x, y);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#b9a3ff'; g.font = '700 22px system-ui,sans-serif'; g.fillText('FOLLOW ON TWITCH', x + S / 2, y + S + 28);
    g.fillStyle = '#ffffff'; g.font = '700 24px system-ui,sans-serif'; g.fillText(QR_SHOW, x + S / 2, y + S + 56);
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
      this.busy = false; if (!this.active || this.source !== 'avacam') return;
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
      this.g.putImageData(img, 0, 0); if (this.canvasTrack && this.sending) this.canvasTrack.requestFrame();
      this.mrFrames = (this.mrFrames || 0) + 1;
    }).catch(() => { this.busy = false; });
  }

  // ---- #347 PHONE CAM ----
  _pcamTick(now) {
    const v = this.env.phoneVideo && this.env.phoneVideo();
    if (this.pc_.lat) this._record(now);
    if (!v || !v.videoWidth) { this.pkMsg = 'waiting for the phone video (link the phone, fixed camera mode)'; if (now - this.frameT > 500) { this.frameT = now; this._pcamWaiting(); } return; }
    if (v !== this.pkV) {   // new frame callbacks for this element (they also measure the delay)
      this.pkV = v; this.pkRv = 0;
      if (!v.isConnected) { Object.assign(v.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none' }); document.body.appendChild(v); }
      if (v.requestVideoFrameCallback) {
        const cb = (t, md) => {
          if (this.pkV !== v) return; this.pkNew = true; this.pkRv = performance.now();
          const d = md.captureTime ? t - md.captureTime : md.receiveTime ? t - md.receiveTime + 70 : null;   // +70: the phone's own camera + encoder, not measured
          if (d != null && d > 0 && d < 2000) this.delay = this.delay == null ? d : this.delay * 0.95 + d * 0.05;
          v.requestVideoFrameCallback(cb);
        };
        v.requestVideoFrameCallback(cb);
      }
    }
    if (now - (this.pkRv || 0) > 300 && now - (this.pkPoll || 0) > 33) { this.pkPoll = now; this.pkNew = true; }   // no frame callbacks: ~30 a second
    if (now - this.gradeT > 500) { this.gradeT = now; this._pcamGrade(v); this._audioDelay(); }
    if (this.pkNew && !this.busy) { this.pkNew = false; this._pcamFrame(v, now); }
  }
  _pcamWaiting() {
    const g = this.g, W = this.canvas.width, H = this.canvas.height;
    g.fillStyle = '#05070c'; g.fillRect(0, 0, W, H); g.fillStyle = '#8c96a8'; g.font = '600 30px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('PHONE CAM: ' + this.pkMsg, W / 2, H / 2); g.textBaseline = 'alphabetic';
    this._overlays(g, W, H); if (this.canvasTrack && this.sending) this.canvasTrack.requestFrame();
  }
  // LATENCY MATCH: the fast movers (hands, controllers, glove, sleeves) keep ~1 s of their local poses; the PHONE CAM
  // render puts them back where they were when the phone filmed the frame, then restores them.
  _record(now) {
    const nodes = this.env.movers ? this.env.movers() : []; if (!this.lh) this.lh = new Map();
    for (const o of nodes) {
      let h = this.lh.get(o); if (!h) this.lh.set(o, h = { t: new Float64Array(96), d: new Float32Array(96 * 10), i: 0, n: 0 });
      const k = h.i * 10; h.t[h.i] = now;
      o.position.toArray(h.d, k); o.quaternion.toArray(h.d, k + 3); o.scale.toArray(h.d, k + 7);
      h.i = (h.i + 1) % 96; h.n = Math.min(96, h.n + 1); h.seen = now;
    }
    if (this.lh.size > nodes.length + 64) for (const [o, h] of this.lh) if (now - h.seen > 2000) this.lh.delete(o);
  }
  _rewind(T) {   // -> undo
    if (!this.lh) return null; const undo = [];
    for (const [o, h] of this.lh) {
      if (performance.now() - h.seen > 200) continue;
      let best = -1; for (let j = 0; j < h.n; j++) { const i = (h.i - 1 - j + 96) % 96; if (h.t[i] <= T) { best = i; break; } }
      if (best < 0) best = (h.i - h.n + 96) % 96;   // older than the history: the oldest kept
      undo.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone(), o.matrixAutoUpdate ? null : o.matrix.clone()]);
      const k = best * 10; o.position.fromArray(h.d, k); o.quaternion.fromArray(h.d, k + 3); o.scale.fromArray(h.d, k + 7);
      if (!o.matrixAutoUpdate) o.matrix.compose(o.position, o.quaternion, o.scale);
    }
    return () => { for (const [o, p, q, sc, m] of undo) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(sc); if (m) o.matrix.copy(m); } };
  }
  _pcamGrade(v) {   // LIGHT MATCH: average colour of the person (matte-weighted, packed frame) and of the background
    const P = this.pc_, li = this.env.lightInfo ? this.env.lightInfo() : {}, pano = li.pano;
    const c = this.gc || (this.gc = Object.assign(document.createElement('canvas'), { width: 96, height: 36 })), g = c.getContext('2d', { willReadFrequently: true });
    const packed = Math.abs(v.videoWidth / v.videoHeight - 1920 / 720) < 0.06;
    let gain = [1, 1, 1];
    if (packed && P.light) {
      g.drawImage(v, 0, 0, 96, 36); const px = g.getImageData(0, 0, 96, 36).data;
      let r = 0, gg = 0, b = 0, w = 0;
      for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) {
        const mx = Math.min(95, Math.round(64.8 + x * 31.2 / 64)), m = px[(y * 96 + mx) * 4] / 255; if (m < 0.5) continue;
        const i = (y * 96 + x) * 4; r += px[i] * m; gg += px[i + 1] * m; b += px[i + 2] * m; w += m;
      }
      if (w > 20) {
        r /= w * 255; gg /= w * 255; b /= w * 255;
        const lum = Math.max(0.03, 0.2126 * r + 0.7152 * gg + 0.0722 * b), cl = (x, a, z) => Math.min(z, Math.max(a, x));
        const pl = pano ? Math.max(0.03, 0.2126 * pano[0] + 0.7152 * pano[1] + 0.0722 * pano[2]) : 1;
        const tint = pano ? pano.map(x => cl(x / pl, 0.8, 1.25)) : [1, 1, 1], ex = cl(Math.sqrt(0.42 / lum), 0.7, 1.35);
        gain = [r, gg, b].map((m, i) => 1 + (cl(lum / Math.max(0.01, m), 0.8, 1.25) * tint[i] * ex - 1) * P.lightStr);
      }
    }
    const e = Math.pow(2, P.expo); this.gradeTo = gain.map(x => x * e);
    // what surrounds the person: the background's average (the wrap light)
    let bgAvg = pano || [0.3, 0.3, 0.35];
    if (this.showOpt.backdrop !== 'dome' && this.bgC) { g.drawImage(this.bgC, 0, 0, 16, 9); const px = g.getImageData(0, 0, 16, 9).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < px.length; i += 4) { r += px[i]; gg += px[i + 1]; b += px[i + 2]; } const n = px.length / 4 * 255; bgAvg = [r / n, gg / n, b / n]; }
    this.wrapCol = bgAvg;
  }
  _pcamFrame(v, now) {
    const r = this.env.renderer, P = this.pc_, cam6 = this.env.phoneCam && this.env.phoneCam(), rig = this.env.rig;
    const packed = Math.abs(v.videoWidth / v.videoHeight - 1920 / 720) < 0.06;
    const asp = cam6 && cam6.vw ? cam6.vw / cam6.vh : packed ? 16 / 9 : v.videoWidth / v.videoHeight;
    const W = 1280, H = Math.round(W / asp / 2) * 2;
    this._sizeCanvas(W, H);
    this.pkMsg = !cam6 ? 'phone not calibrated in fixed camera mode: gear not drawn' : !cam6.ff ? 'phone in AR mode: switch it to fixed camera' : '';
    if (!this.pk || this.pk.W !== W || this.pk.H !== H) {
      if (this.pk) { this.pk.rt.dispose(); this.pk.out.dispose(); this.pk.bgRT.dispose(); }
      const half = r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float');
      const pk = this.pk = { W, H };
      pk.rt = new THREE.WebGLRenderTarget(W, H, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: 4 });
      pk.bgRT = new THREE.WebGLRenderTarget(W, H, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType });
      pk.out = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false });
      pk.cam = new THREE.PerspectiveCamera(50, W / H, 0.05, 40); pk.cam.updateMatrixWorld = () => {};
      pk.tex = new THREE.VideoTexture(v); pk.tex.colorSpace = THREE.NoColorSpace; pk.tex.generateMipmaps = false;
      this.bgC = this.bgC || Object.assign(document.createElement('canvas'), { width: W, height: H }); this.bgC.width = W; this.bgC.height = H;
      pk.bgTex = new THREE.CanvasTexture(this.bgC); pk.bgTex.colorSpace = THREE.NoColorSpace;
      pk.mat = new THREE.ShaderMaterial({ uniforms: {
        map: { value: pk.rt.texture }, cam: { value: pk.tex }, bg: { value: pk.bgTex }, green: { value: 0 }, bgLin: { value: 0 }, showMatte: { value: 0 },
        wrap: { value: 0 }, glow: { value: 0 }, pack: { value: new THREE.Vector4(1280 / 1920, 0, 1296 / 1920, 624 / 1920) },
        gain: { value: new THREE.Vector3(1, 1, 1) }, wrapCol: { value: new THREE.Vector3() }, glowCol: { value: new THREE.Vector3() }, glowDir: { value: new THREE.Vector2(1, 0) }, texel: { value: new THREE.Vector2(1 / W, 1 / H) } },
        vertexShader: COPY_VS, fragmentShader: PCAM_FS, depthTest: false, depthWrite: false });
      pk.scene = new THREE.Scene(); const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), pk.mat); q.frustumCulled = false; pk.scene.add(q);
      pk.oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      pk.buf = new Uint8Array(W * H * 4); pk.img = new ImageData(new Uint8ClampedArray(pk.buf.buffer), W, H);
    }
    const pk = this.pk, U = pk.mat.uniforms, cam = pk.cam;
    if (pk.tex.image !== v) pk.tex.image = v;
    if (v.readyState >= 2) pk.tex.needsUpdate = true;
    const green = packed, li = this.env.lightInfo ? this.env.lightInfo() : {};
    // camera = rig x the phone's rig-space pose; the FULL video's vertical fov
    const ok = !!(cam6 && cam6.ff && rig);
    if (ok) {
      _m2.compose(_v1.fromArray(cam6.p), _q1.fromArray(cam6.q), _s1); rig.updateMatrixWorld();
      cam.matrixWorld.multiplyMatrices(rig.matrixWorld, _m2); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      cam.matrixWorld.decompose(cam.position, cam.quaternion, cam.scale);
      if (cam.fov !== cam6.ff || cam.aspect !== asp) { cam.fov = cam6.ff; cam.aspect = asp; cam.updateProjectionMatrix(); }
    }
    // background (green screen): the VISUALS full frame, or the dome / pano from the phone's view
    let bgLin = 0;
    if (green) {
      const sky = this.env.skyGroup && this.env.skyGroup(), bd = this.showOpt.backdrop;   // #374 the shared backdrop: dome, the VISUALS frame, or just the dark gradient (NONE)
      if (bd === 'dome' && ok && sky && li.skyReady) bgLin = 1;
      else {
        const g = this.bgC.getContext('2d'), L = (this.env.wallSource && this.env.wallSource()) || [];
        const gr = g.createRadialGradient(W / 2, H * 0.45, 40, W / 2, H / 2, W * 0.65); gr.addColorStop(0, '#141a28'); gr.addColorStop(1, '#030409'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
        if (bd === 'visuals') for (const l of L) { if (!l || !l.el || l.gain === 0) continue; g.globalAlpha = l.gain == null ? 1 : Math.min(1, l.gain); g.globalCompositeOperation = l.add ? 'lighter' : 'source-over'; this._cover(g, l.el, W, H, l.flip); }
        g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; pk.bgTex.needsUpdate = true;
      }
    }
    U.bg.value = bgLin ? pk.bgRT.texture : pk.bgTex; U.bgLin.value = bgLin; U.green.value = green ? 1 : 0; U.showMatte.value = P.matte ? 1 : 0;
    // LIGHT MATCH
    const gt = this.gradeTo || [1, 1, 1]; this.grade.lerp(_v3.set(gt[0], gt[1], gt[2]), 0.25); U.gain.value.copy(this.grade);
    const lm = P.light && green; U.wrap.value = lm ? P.wrap : 0; U.glow.value = lm && ok && li.keyDir ? P.glow : 0;
    if (this.wrapCol) U.wrapCol.value.fromArray(this.wrapCol);
    if (lm && ok && li.keyDir) {
      const d = _v4.copy(li.keyDir).transformDirection(cam.matrixWorldInverse), len = Math.hypot(d.x, d.y);
      U.glowDir.value.set(d.x, d.y).divideScalar(len || 1); U.glow.value *= Math.min(1, len * 1.5);
      const kc = li.keyCol || [1, 1, 1]; U.glowCol.value.set(kc[0], kc[1], kc[2]).multiplyScalar(0.55);
    }
    U.texel.value.set(1 / W, 1 / H);
    this._wallShot = false;   // #374 no 3D LED wall in the phone shot (it would paint over you), so the scroller is the flat band
    const sc = this.env.scene, prevRT = r.getRenderTarget(), prevXR = r.xr.enabled, prevSh = r.shadowMap.autoUpdate, prevCol = r.getClearColor(_c1), prevA = r.getClearAlpha();
    const undo = ok && this.env.pcamPrep ? this.env.pcamPrep(cam) : null;   // #374 cam: props farther from it than the DJ are left out
    const back = ok && P.lat ? this._rewind(now - this.latMs) : null;
    try {
      r.xr.enabled = false; r.shadowMap.autoUpdate = false; r.setClearColor(0x000000, 0);
      if (bgLin) {
        const sky = this.env.skyGroup(), sv = sky.visible; sky.visible = true; cam.layers.mask = 3;
        r.setRenderTarget(pk.bgRT); r.clear(); r.render(sky, cam); sky.visible = sv;
      }
      cam.layers.mask = 1;   // layer 0: gear, hands, LED wall, chalkboard (not the robot)
      r.setRenderTarget(pk.rt); r.clear(); if (ok) r.render(sc, cam);
      r.setRenderTarget(pk.out); r.render(pk.scene, pk.oc);
    } finally {
      if (back) back();
      r.setClearColor(prevCol, prevA); r.xr.enabled = prevXR; r.shadowMap.autoUpdate = prevSh; r.setRenderTarget(prevRT);
      if (undo) undo();
    }
    this.busy = true; const buf = pk.buf, img = pk.img;
    r.readRenderTargetPixelsAsync(pk.out, 0, 0, W, H, buf).then(() => {
      this.busy = false; if (!this.active || this.source !== 'pcam' || this.pk !== pk) return;
      this.g.putImageData(img, 0, 0); this._overlays(this.g, W, H);
      if (this.canvasTrack && this.sending) this.canvasTrack.requestFrame();
      this.pkFrames = (this.pkFrames || 0) + 1;
    }).catch(() => { this.busy = false; });
  }
  // the real lamp hint: where the panorama's light comes from, seen from the DJ facing the phone
  lampHint() {
    const li = this.env.lightInfo ? this.env.lightInfo() : {}, c6 = this.env.phoneCam && this.env.phoneCam(), rig = this.env.rig;
    if (!li.keyDir || !c6 || !c6.q || !rig) return '';
    _q2.fromArray(c6.q).premultiply(rig.getWorldQuaternion(_q1)).invert();
    const d = _v4.copy(li.keyDir).applyQuaternion(_q2);   // phone camera space: +x camera right = the DJ's left, +z toward the phone = in front of the DJ
    const side = d.x > 0.35 ? 'to your left' : d.x < -0.35 ? 'to your right' : '', fb = d.z > 0.35 ? 'in front of you' : d.z < -0.35 ? 'behind you' : '';
    const ht = d.y > 0.6 ? 'high up' : d.y > 0.25 ? 'above head height' : 'at head height';
    return 'Real lamp: ' + [fb, side].filter(Boolean).join(', ') + (fb || side ? ', ' : '') + ht + ' (where the panorama\'s light comes from)';
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
    // layer 0 holds every prop (gear, wall, neon, ...): showPrep hides the ones that are switched off; the robot has its own layer
    cam.layers.mask = ((O.gear || O.wall || O.gopro || O.panel || O.chalk || O.neon || O.backdrop === 'dome') ? 1 : 0) | (O.robot && this.env.avLayer != null ? 1 << this.env.avLayer : 0);
    this._wallShot = !!(O.wall && this.env.wallInShot && this.env.wallInShot(cam));   // #372 scroller: on the 3D wall when it is in shot, else flat
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
    const bg = (O.backdrop === 'visuals' && this.env.wallSource && this.env.wallSource()) || [];
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
    this._overlays(g, W, H);
    if (this.canvasTrack && this.sending) this.canvasTrack.requestFrame();
    this.showFrames = (this.showFrames || 0) + 1;
  }
  _overlays(g, W, H) {   // 3. overlays (#347 PHONE CAM uses them too)
    const O = this.showOpt;
    const sc = this.env.scroller && this.env.scroller();
    if (O.scroll && sc && sc.on && sc.canvas && !this._wallShot) { const bh = Math.round(W * sc.canvas.height / sc.canvas.width * 0.66); g.drawImage(sc.canvas, 0, H - bh - Math.round(H * 0.01), W, bh); /* a little wider than the wall's band: ~20 % of the frame */ }
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
    if (O.chat && this.env.chat) {   // #340 the newest messages on the right, each fading out 40 s after it arrived
      const ch = this.env.chat(), now = performance.now(), recent = ch && ch.msgs.filter(m => !m.sys && now - m.t < 42000);
      if (recent && recent.length) {
        const sc2 = this.env.scroller && this.env.scroller(), bottom = H - (O.scroll && sc2 && sc2.on && !this._wallShot ? Math.round(W * 128 / 768 * 0.66) + 12 : 16);
        drawChat(g, W - 452, 92, 432, bottom - 92, recent, { fs: 22, maxAge: 40, lineBg: 'rgba(0,0,0,0.45)' });
      }
    }
    if (O.logo) {
      g.font = '800 40px system-ui,sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'right';
      const x = W - 28, y = 48, w3 = g.measureText('3DJ').width;
      g.fillStyle = '#e0202a'; g.fillText('3DJ', x, y); g.fillStyle = '#ffffff'; g.fillText('Cly', x - w3, y);
    }
    g.textBaseline = 'alphabetic';
  }

  tick(now = performance.now()) {   // from the frame loop, after the DJ CAM render
    if (this.source === 'headset' && (this.testing || (this.live && this.fit.gear))) {
      this._headPose(now);
      // no frame callbacks (immersive session, video not composited): take a new picture ~30 times a second, 45 ms old
      if (now - (this.rvfcT || 0) > 300 && now - (this.pollT || 0) > 33) { this.pollT = now; this.camNew = true; this.camFrameT = now - 45; }
      this._mrFrame();
    }
    if (!this.active) return;
    if (this.source === 'show') this._showTick(now);
    else if (this.source === 'pcam') this._pcamTick(now);
    else if (this.source === 'card') {
      if (now - this.cardT > 1000) { this.cardT = now; this.drawCard(now); }
      if (now - this.frameT > 100 && this.canvasTrack) { this.frameT = now; this.canvasTrack.requestFrame(); }
    } else if (this.source === 'avacam') this._avacamFrame();
    if (this.live && now - (this.statT || 0) > 2000) { this.statT = now; this._stats(); }
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

  // ---- #376 Cly3DTV: a venue screen (venue.html) gets the same picture as Twitch, and the master sound if the tablet allows it ----
  // One second WebRTC link, made by net-link.js tvHost. The picture is the SAME track Twitch gets (the stream canvas, composed once), so the
  // Quest pays only one more encode; it also works off air (the shot then runs like the PREVIEW does, setRehearse), so a club-only night
  // needs no Twitch. Sound is the same master track Twitch gets (after the limiter, no CUE), with the same LATENCY MATCH hold-back.
  tvState() { return !this.tvSet.key ? (this.tvPairing ? 'pairing' : 'unpaired') : this.tvPairing ? 'pairing' : !this.tvSet.on ? 'off' : this.tvUp ? 'up' : 'waiting'; }
  _tvNote(m) { this.tvMsg = m; this.env.onChange && this.env.onChange(); }
  _tvSave() { ls.set(TVK, JSON.stringify(this.tvSet)); this.env.onChange && this.env.onChange(); }
  async _tvVideo() { return this.live && this.vTrack ? this.vTrack : await this._videoTrack(this.source); }
  async _tvAudio() {
    if (!this.tvSet.audio) return null;
    const eng = this.env.engine; if (!eng) return null;
    if (!eng.ctx) await eng.init({ latencyHint: 'interactive' });
    await eng.resume(); return eng.streamTrack();
  }
  async _tvFollow() { const l = this.tvLink; if (!l || !this.tvUp) return; try { await l.setVideo(await this._tvVideo()); } catch (e) { console.warn('venue screen picture', e); } }
  _tvOpen() {
    if (this.tvLink || !this.tvSet.key || (!this.tvSet.on && !this.tvPairing)) return;
    this.tvLink = tvHost(this.tvSet.key, {
      video: () => this._tvVideo(), audio: () => this._tvAudio(),
      onOffer: () => { if (this.tvPairing) { clearTimeout(this._tvPairT); this.tvPairing = 0; this._tvSave(); this._tvNote('TV paired.'); } },
      onUp: () => this._tvUp(), onDown: () => this._tvDown(),
      onCtlOpen: () => { this.tvLink && this.tvLink.ctl({ t: 'hi', audio: !!this.tvSet.audio }); },
    });
  }
  _tvClose() { const l = this.tvLink; this.tvLink = null; if (l) l.close(); this._tvDown(); }
  _tvUp() {
    this.tvUp = true;
    if (!this.active) this.setRehearse(true);   // off air: draw the shot for the screen
    clearInterval(this._tvIv); let lb = 0, lt = 0;
    this._tvIv = setInterval(async () => {   // kbit/s and frames per second leaving for the screen, every 2 s
      const pc = this.tvLink && this.tvLink.pc; if (!pc) return;
      try { (await pc.getStats()).forEach(r => { if (r.type === 'outbound-rtp' && r.kind === 'video') { if (lt && r.timestamp > lt) this.tvKbps = Math.round((r.bytesSent - lb) * 8 / (r.timestamp - lt)); lb = r.bytesSent; lt = r.timestamp; this.tvFps = Math.round(r.framesPerSecond || 0); } }); } catch {}
    }, 2000);
    this.env.onChange && this.env.onChange();
  }
  _tvDown() {
    const was = this.tvUp; this.tvUp = false; clearInterval(this._tvIv); this._tvIv = 0; this.tvKbps = this.tvFps = 0;
    if (was) {
      if (this.rehearse && !this.live && !(this.env.monitorOn && this.env.monitorOn())) this.setRehearse(false);
      if (!this.live) { if (this.canvasTrack) { this.canvasTrack.stop(); this.canvasTrack = null; } this.env.engine && this.env.engine.streamStop && this.env.engine.streamStop(); }
    }
    this.env.onChange && this.env.onChange();
  }
  // pairing: the TV shows a 6-digit code, the tablet types it here; a fresh long key goes to the TV over the code's own relay topic, and the
  // pairing counts once the TV calls back under that key (45 s). On failure the old pairing (if any) comes back.
  async tvPair(code) {
    code = String(code || '').replace(/\D/g, '');
    if (code.length !== 6) { this._tvNote('The code has 6 digits.'); return false; }
    if (this.tvPairing) return false;
    const prev = { ...this.tvSet }, key = tvNewKey();
    this._tvClose(); this.tvSet = { ...prev, key, on: true }; this.tvPairing = Date.now(); this._tvNote('Looking for the TV…');
    this._tvOpen();
    try { await this.tvLink.ready; await tvPairSend(code, key); } catch (e) { return this._tvPairFail(prev, 'Could not reach the relay (' + e.message + ').'); }
    this._tvPairT = setTimeout(() => { if (this.tvPairing) this._tvPairFail(prev, 'No TV answered. Check the code on the TV (venue.html) and that it is still showing.'); }, 45000);
    return true;
  }
  _tvPairFail(prev, msg) { clearTimeout(this._tvPairT); this.tvPairing = 0; this._tvClose(); this.tvSet = prev; this._tvOpen(); this._tvNote(msg); return false; }
  tvForget() {
    const l = this.tvLink; this.tvLink = null;
    if (l) { l.ctl({ t: 'forget' }); setTimeout(() => l.close(), 500); }
    this._tvDown(); this.tvSet = { ...this.tvSet, key: '' }; this.tvPairing = 0; this._tvSave(); this._tvNote('Forgotten. The TV shows a new code.');
  }
  async setTv(k, v) {
    if (k === 'on') { this.tvSet.on = !!v; this._tvSave(); if (v) this._tvOpen(); else this._tvClose(); }
    else if (k === 'audio') { this.tvSet.audio = !!v; this._tvSave(); if (this.tvLink) { try { await this.tvLink.setAudio(v ? await this._tvAudio() : null); } catch (e) { console.warn('venue screen sound', e); } } }
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
      if (this.source === 'phone' || this.source === 'pcam') this.env.phoneLive && this.env.phoneLive(true, this._pcamOpts());
      this.vTrack = await this._videoTrack(this.source);
      this._audioDelay();
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
    if (this.source === 'phone' || this.source === 'pcam') this.env.phoneLive && this.env.phoneLive(false);
    this.env.engine.setStreamDelay && this.env.engine.setStreamDelay(0);
    if (!this.testing) this._stopCam();
    if (this.canvasTrack && !this.tvUp) { this.canvasTrack.stop(); this.canvasTrack = null; }   // #376 kept while the venue screen is using it
    if (!this.tvUp) this.env.engine.streamStop && this.env.engine.streamStop();
    this.aTrack = this.vTrack = this.vSender = this.aSender = null; this.t0 = 0; this.kbps = 0;
  }
  stop() { this._teardown(); this._set('off', ''); }
}
