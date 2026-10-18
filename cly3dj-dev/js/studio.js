// #380 S8 STUDIO, the S8's side (spectator page, fixed tripod camera). The Quest sends its scene packed with a matte (stream.js _stuPack:
// colour 1280 wide, a timestamp strip at x 1284, the matte 624 wide at x 1296) and the master sound on the link's receive slots. This
// module replaces the phone's mirror render with one composite, drawn straight to the screen at 1280 x 720 (the HDMI picture), then
// captured for Twitch:
//   backdrop  NONE (dark gradient) / DOME (this phone's copy of the panorama, drawn from the shot's camera) / VISUALS (this phone's copy
//             of the LED clip; anything else the Quest draws into its frame itself, which then arrives opaque)
//   camera    SHOW: none. LIVE DJ!: the camera picture as it is (your real room). LIVE KEY!: keyed (vs.K: colour, strength, softness,
//             spill, crop) over the backdrop
//   scene     the Quest's picture over it all, premultiplied: c = scene + below * (1 - matte)
// Sync: each Quest frame carries the Quest's clock (ms) in its strip. The S8 knows the Quest's clock (link ping / pong), so it knows how
// late each frame is, and shows the camera frame filmed at the frame's own time from a short ring of camera frames (up to 12, ~400 ms).
// The sound arrives in step with the Quest's picture (one WebRTC stream), so it needs nothing. TRIM (tablet) nudges the camera.
import { STU, readStamp, stampBlock } from './stream.js';
import { opusStereo } from './net-link.js';

const TWITCH_WHIP = 'https://g.webrtc.live-video.net:4443/v2/offer', KEYK = 'vire.s8twitchKey', RING = 12;
const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const COPY_FS = 'uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0); }';
const STRIP_FS = `uniform sampler2D q; uniform float H, bh; varying vec2 vUv;
void main() { float i = floor(gl_FragCoord.x); float y = 12.0 + i * bh + bh * 0.5;
  float v = texture2D(q, vec2(${((STU.SX + STU.SW / 2) / STU.PW).toFixed(6)}, 1.0 - y / H)).r; gl_FragColor = vec4(v, v, v, 1.0); }`;
const COMP_FS = `uniform sampler2D q, cam, bgT; uniform float qMode, camMode, bgMode, t; uniform vec4 bgUv, qFit; uniform vec4 crop;
uniform float thr, soft, spill, cmatch, camGain; uniform vec3 tint; varying vec2 vUv;
uniform float keyCol;
float keyOf(vec3 c) {
  if (keyCol < 0.5) return (c.g - max(c.r, c.b)) / max(c.g, 0.15);
  if (keyCol < 1.5) return (c.b - max(c.r, c.g)) / max(c.b, 0.15);
  float s = min(c.r, c.b); return (s - c.g) / max(s, 0.15);
}
vec3 despill(vec3 c, float k) {
  if (keyCol < 0.5) { float m = max(c.r, c.b); if (c.g > m) c.g = mix(c.g, m, k); }
  else if (keyCol < 1.5) { float m = max(c.r, c.g); if (c.b > m) c.b = mix(c.b, m, k); }
  else { float s = min(c.r, c.b); if (s > c.g) { float e = (s - c.g) * k; c.r -= e; c.b -= e; } }
  return c;
}
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
void main() {
  vec2 uv = vUv; vec3 c;
  // 1. backdrop
  if (bgMode < 0.5) { float r = length((uv - vec2(0.5, 0.55)) * vec2(1.6, 1.0)); c = mix(vec3(0.078, 0.102, 0.157), vec3(0.012, 0.016, 0.035), clamp(r * 1.3, 0.0, 1.0)); }
  else if (bgMode < 1.5) c = texture2D(bgT, bgUv.xy + uv * bgUv.zw).rgb;          // the LED clip (cover crop)
  else c = srgb(texture2D(bgT, uv).rgb);                                          // the dome (linear, half float)
  // 2. camera
  if (camMode > 0.5) {
    vec3 k = texture2D(cam, uv).rgb;
    k = 1.0 - pow(1.0 - k, vec3(camGain));                                        // #382 GAIN: lifts the dark and the mids, the highlights stay (1 = as filmed)
    if (camMode < 1.5) c = k;                                                     // LIVE DJ!: the real room
    else {
      float a = 1.0 - smoothstep(thr, thr + soft, keyOf(k));
      if (uv.x < crop.x || uv.x > 1.0 - crop.y || uv.y > 1.0 - crop.z || uv.y < crop.w) a = 0.0;   // garbage matte (crop)
      k = despill(k, spill) * mix(vec3(1.0), tint, cmatch);
      c = mix(c, clamp(k, 0.0, 1.0), a);
    }
  }
  // 3. the Quest's scene
  if (qMode > 0.5 && qMode < 1.5) {
    vec3 s = texture2D(q, vec2(uv.x * ${(STU.CW / STU.PW).toFixed(6)}, uv.y)).rgb;
    float a = texture2D(q, vec2(${(STU.MX / STU.PW).toFixed(6)} + uv.x * ${(STU.MW / STU.PW).toFixed(6)}, uv.y)).r;
    a = clamp((a - 0.03) / 0.94, 0.0, 1.0);                                       // codec noise in the black / white of the matte
    c = s + c * (1.0 - a);
  } else if (qMode > 1.5) {                                                       // an opaque frame (HEADSET CAM, CARD, AVACAM, baked VISUALS): as it is
    vec2 p = (uv - qFit.xy) / qFit.zw;
    c = (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) ? vec3(0.0) : texture2D(q, p).rgb;
  }
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export function makeStudio({ THREE, renderer, scene, camera, rig, skybox, vs, fixed, led, getLink, questNow, onState }) {
  const S = { on: false, mode: 'show', bd: 'none', snd: true, trim: 0, mon: false, src: 'show', paused: false, gest: false,
    D: null, hold: null, fps: 0, qfps: 0, note: '', tw: 'off', twMsg: '', kbps: 0, W: 1280, H: 720 };
  // ---- media in
  const qv = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true });
  const au = Object.assign(document.createElement('audio'), { autoplay: true });
  for (const el of [qv, au]) { el.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none'; document.body.appendChild(el); }
  let qTrack = null, aTrack = null, qNew = false, qN = 0, outN = 0, qLast = 0, qCT = -1, qPoll = false;
  function onTrack(t) {
    if (t.kind === 'video') { qTrack = t; qv.srcObject = new MediaStream([t]); qv.play().catch(() => {}); watchQ(); }
    else { aTrack = t; au.srcObject = new MediaStream([t]); au.play().catch(() => {}); }
  }
  function watchQ() {
    if (!qv.requestVideoFrameCallback) return;
    const cb = () => { qNew = true; qN++; qLast = performance.now(); qPoll = false; qv.requestVideoFrameCallback(cb); };
    qv.requestVideoFrameCallback(cb);
  }
  const qTex = new THREE.VideoTexture(qv); qTex.colorSpace = THREE.NoColorSpace; qTex.generateMipmaps = false; qTex.minFilter = qTex.magFilter = THREE.LinearFilter;
  // ---- camera ring (the S8's own camera, kept ~400 ms so it can wait for the Quest's picture)
  const cTex = new THREE.VideoTexture(fixed.video); cTex.colorSpace = THREE.NoColorSpace; cTex.generateMipmaps = false;
  const ring = [], ringT = new Float64Array(RING).fill(-1e9); let ringI = 0, camNew = false, camQt = 0, camWatch = null, camN = 0, camRate = 0;
  function ringRT(i) {
    if (!ring[i] || ring[i].width !== S.W || ring[i].height !== S.H) { if (ring[i]) ring[i].dispose(); ring[i] = new THREE.WebGLRenderTarget(S.W, S.H, { depthBuffer: false }); ring[i].texture.colorSpace = THREE.NoColorSpace; ringT[i] = -1e9; }
    return ring[i];
  }
  function watchCam() {
    const v = fixed.video; if (!v.requestVideoFrameCallback || camWatch === v.srcObject) return; camWatch = v.srcObject;
    const cb = (now, md) => {
      if (camWatch !== v.srcObject) return;
      const t = md && md.captureTime ? md.captureTime : (md && md.presentationTime ? md.presentationTime - 15 : now - 15);   // camera frames carry captureTime; others: when the page got it
      camQt = t + (questNow() - performance.now()); camNew = true; camN++; v.requestVideoFrameCallback(cb);
    };
    v.requestVideoFrameCallback(cb);
  }
  // ---- passes
  const quad = mat => { const sc = new THREE.Scene(), m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false; sc.add(m); return sc; };
  const oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const copyMat = new THREE.ShaderMaterial({ uniforms: { map: { value: cTex } }, vertexShader: VS, fragmentShader: COPY_FS, depthTest: false, depthWrite: false }), copySc = quad(copyMat);
  const stripRT = new THREE.WebGLRenderTarget(32, 1, { depthBuffer: false }), stripBuf = new Uint8Array(32 * 4);
  const stripMat = new THREE.ShaderMaterial({ uniforms: { q: { value: qTex }, H: { value: 720 }, bh: { value: 24 } }, vertexShader: VS, fragmentShader: STRIP_FS, depthTest: false, depthWrite: false }), stripSc = quad(stripMat);
  const half = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
  let domeRT = null; const domeCam = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 60); domeCam.updateMatrixWorld = () => {};
  const clipTex = led.video ? new THREE.VideoTexture(led.video) : null; if (clipTex) { clipTex.colorSpace = THREE.NoColorSpace; clipTex.generateMipmaps = false; }
  const U = { q: { value: qTex }, cam: { value: null }, bgT: { value: null }, qMode: { value: 0 }, camMode: { value: 0 }, bgMode: { value: 0 }, t: { value: 0 },
    bgUv: { value: new THREE.Vector4(0, 0, 1, 1) }, qFit: { value: new THREE.Vector4(0, 0, 1, 1) }, crop: { value: new THREE.Vector4() },
    thr: { value: 0.1 }, soft: { value: 0.1 }, spill: { value: 0.7 }, cmatch: { value: 0.4 }, tint: { value: new THREE.Vector3(1, 1, 1) }, keyCol: { value: 0 }, camGain: { value: 1 } };
  const compMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: COMP_FS, depthTest: false, depthWrite: false }), compSc = quad(compMat);
  // ---- the screen: 1280 x 720 drawing buffer, shown full screen with bars (the HDMI picture), the page's own UI hidden
  document.head.insertAdjacentHTML('beforeend', `<style>
    body.stuOn #spO, body.stuOn #fxO, body.stuOn #fxTap, body.stuOn #spS, body.stuOn .fxMark { display:none !important; }
    body.stuOn canvas.stuCv { position:fixed !important; inset:0 !important; width:100vw !important; height:100vh !important; object-fit:contain; background:#000; z-index:20; }
    #stuO { position:fixed; inset:0; z-index:40; display:none; color:#e6e8ec; font:14px/1.45 system-ui,sans-serif; }
    body.stuOn #stuO { display:block; }
    #stuO .st { position:absolute; left:10px; top:10px; right:10px; background:rgba(10,12,18,.8); border:1px solid #2e3850; border-radius:10px; padding:8px 10px; font:12px/1.45 ui-monospace,monospace; white-space:pre-wrap; }
    #stuO .go { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(5,7,12,.86); gap:14px; text-align:center; }
    #stuO button { font:700 18px system-ui,sans-serif; color:#fff; background:#b0141e; border:1px solid #e0202a; border-radius:12px; padding:14px 22px; }
    #stuO button.q { background:#1a2233; border-color:#3a4560; font-size:14px; padding:10px 14px; }
    #stuO .bar { position:absolute; right:10px; bottom:10px; display:flex; gap:8px; }
    #stuO [hidden] { display:none !important; }
  </style>`);
  document.body.insertAdjacentHTML('beforeend', `<div id="stuO"><div class="st" id="stuSt" hidden></div>
    <div class="go" id="stuGo"><div style="font:800 30px system-ui">Cly<span style="color:#e0202a">3DJ</span> S8 STUDIO</div>
      <div style="max-width:80vw;color:#b7c0d0">The Quest turned the studio on. Tap to start: full screen, sound to the TV, screen kept awake.</div><button id="stuStart">START STUDIO</button></div>
    <div class="bar" id="stuBar" hidden><button class="q" id="stuBack">Camera view (pause studio here)</button><button class="q" id="stuHide">Hide</button></div></div>
    <button id="stuRes" hidden style="position:fixed;right:10px;top:10px;z-index:50;font:700 15px system-ui,sans-serif;color:#fff;background:#b0141e;border:1px solid #e0202a;border-radius:10px;padding:10px 14px">▶ BACK TO STUDIO</button>`);
  const $ = id => document.getElementById(id), ov = $('stuO'), stEl = $('stuSt'), goEl = $('stuGo'), barEl = $('stuBar');
  let uiT = 0, lock = null;
  $('stuStart').onclick = () => { S.gest = true; goEl.hidden = true; full(); au.play().catch(() => {}); qv.play().catch(() => {}); showUi(); };
  $('stuBack').onclick = () => { S.paused = true; apply(); };
  $('stuRes').onclick = () => { S.paused = false; apply(); };
  $('stuHide').onclick = () => { uiT = 0; stEl.hidden = barEl.hidden = true; };
  ov.addEventListener('click', e => { if (e.target === ov) showUi(); });
  function showUi() { uiT = performance.now() + 6000; stEl.hidden = barEl.hidden = false; }
  function full() {
    try { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {}); } catch {}
    try { screen.orientation.lock('landscape').catch(() => {}); } catch {}
    try { if (navigator.wakeLock && !lock) navigator.wakeLock.request('screen').then(l => { lock = l; l.addEventListener('release', () => { lock = null; }); }).catch(() => {}); } catch {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.on && S.gest) full(); });
  let saved = null;
  const cv = renderer.domElement;
  function apply() {   // enter / leave the studio screen
    const want = S.on && !S.paused; $('stuRes').hidden = !(S.on && S.paused);
    if (want && !saved) {
      saved = { pr: renderer.getPixelRatio(), w: cv.width, h: cv.height, style: cv.getAttribute('style') || '' };
      document.body.classList.add('stuOn'); cv.classList.add('stuCv'); goEl.hidden = S.gest; size(); showUi();
    } else if (!want && saved) {
      document.body.classList.remove('stuOn'); cv.classList.remove('stuCv'); cv.setAttribute('style', saved.style);
      renderer.setPixelRatio(saved.pr); renderer.setSize(innerWidth, innerHeight); saved = null;
      skybox.group.visible = vs.S.on && vs.S.loaded;
    }
  }
  function size() {
    const v = fixed.video, H = v && v.videoWidth ? Math.round(1280 * v.videoHeight / v.videoWidth / 2) * 2 : 720;
    S.W = 1280; S.H = Math.max(360, Math.min(1280, H));
    if (renderer.getPixelRatio() !== 1) renderer.setPixelRatio(1);
    if (cv.width !== S.W || cv.height !== S.H) renderer.setSize(S.W, S.H, false);
  }
  // ---- messages from the Quest
  const poses = [];
  function onMsg(m) {
    if (m.k === 'stu') {
      const was = S.on;
      Object.assign(S, { on: !!m.on, mode: m.mode || 'show', bd: m.bd || 'none', snd: m.snd !== false, trim: +m.trim || 0, mon: !!m.mon, src: m.src || 'show', clipWant: m.clip || '' });
      if (S.on && !was) { S.paused = false; if (S.bd === 'dome') vs.ensure().catch(() => {}); }
      if (!S.on && was) { twStop('studio off'); }
      if (S.on && S.bd === 'dome') { vs.ensure().catch(() => {}); vs.playPano && vs.playPano(true); }
      if (m.cam) {   // #382 LOW LIGHT from the tablet: 25 fps hold, exposure compensation (the camera's own gain), the studio's GAIN
        U.camGain.value = Math.max(1, Math.min(3, +m.cam.gain || 1));
        const L = fixed.lowLight; if (L && fixed.setLowLight && (!!m.cam.fps25 !== L.fps25 || +m.cam.ev !== L.ev)) fixed.setLowLight({ fps25: !!m.cam.fps25, ev: +m.cam.ev });
      }
      apply();
    } else if (m.k === 'stuLive') {
      if (m.on) { if (m.key) { try { localStorage.setItem(KEYK, m.key); } catch {} } twStart(); } else twStop('');
    }
  }
  function onScp(m) { poses.push(m); if (poses.length > 60) poses.shift(); }
  function poseAt(t) { let best = null, bd = 1e9; for (const p of poses) { const d = Math.abs(((t - p.t) % 16777216 + 16777216 + 8388608) % 16777216 - 8388608); if (d < bd) { bd = d; best = p; } } return best; }
  function onLink(open) {
    if (!open) { S.linkLost = performance.now(); qTrack = aTrack = null; }
    else S.linkLost = 0;
  }
  // ---- stamp read-back (async, 32 x 1 pixels): how late the Quest's frames are, in its clock
  let stripBusy = false;
  function readStampNow() {
    if (stripBusy) return; stripBusy = true;
    const H = qv.videoHeight; stripMat.uniforms.H.value = H; stripMat.uniforms.bh.value = stampBlock(H);
    const qAt = questNow(), prev = renderer.getRenderTarget();
    renderer.setRenderTarget(stripRT); renderer.render(stripSc, oc); renderer.setRenderTarget(prev);
    renderer.readRenderTargetPixelsAsync(stripRT, 0, 0, 32, 1, stripBuf).then(() => {
      stripBusy = false; const bits = []; for (let i = 0; i < 28; i++) bits.push(stripBuf[i * 4] > 127 ? 1 : 0);
      const st = readStamp(bits); if (st < 0) return;
      let d = ((Math.round(qAt) & 0xFFFFFF) - st + 16777216) % 16777216; if (d > 8388608) d -= 16777216;
      if (d < -50 || d > 3000) return;
      S.D = S.D == null ? d : S.D * 0.9 + d * 0.1; S.lastStamp = st;
    }).catch(() => { stripBusy = false; });
  }
  // ---- one frame; true = the studio drew the screen (the page skips its mirror render)
  let fpsT = 0;
  function frame(now) {
    if (!S.on || S.paused) return false;
    if (now - (S.drawT || 0) < 30) return true;   // ~30 fps is all the inputs have (a 60 Hz screen would draw every picture twice)
    S.drawT = now;
    if (uiT && now > uiT) { uiT = 0; stEl.hidden = barEl.hidden = true; }
    size(); watchCam();
    // Chrome 101 on the S8 never fires frame callbacks for a WebRTC video (the S8 test: 0 Quest frames counted while the decoder ran at full
    // rate), and three's VideoTexture waits for those callbacks: so when none have come for 400 ms, a new frame = the video's clock moved
    if (qv.readyState >= 2 && (qPoll || now - qLast > 400) && qv.currentTime !== qCT) { qCT = qv.currentTime; qNew = true; qN++; qLast = now; qPoll = true; }
    if (qPoll && qNew) qTex.needsUpdate = true;
    const packed = qv.videoWidth === STU.PW, haveQ = qv.readyState >= 2 && qv.videoWidth > 0 && now - qLast < 1500;
    const prevRT = renderer.getRenderTarget(), prevXR = renderer.xr.enabled, ac = renderer.autoClear;
    renderer.xr.enabled = false; renderer.autoClear = true;
    try {
      // camera into the ring
      const needCam = (S.mode === 'dj' || S.mode === 'key') && fixed.on && fixed.video.videoWidth;
      if (needCam && (camNew || !fixed.video.requestVideoFrameCallback)) {
        camNew = false; cTex.needsUpdate = true; ringI = (ringI + 1) % RING; const rt = ringRT(ringI);
        renderer.setRenderTarget(rt); renderer.render(copySc, oc); ringT[ringI] = fixed.video.requestVideoFrameCallback ? camQt : questNow() - 40;
      }
      if (haveQ && packed && qNew) readStampNow();
      qNew = false;
      // which camera frame: the one filmed at the Quest frame's own time (its lateness D), nudged by TRIM
      U.camMode.value = 0;
      if (needCam) {
        const target = questNow() - (S.D != null ? S.D : 150) - S.trim; let bi = -1, bd = 1e9;
        for (let i = 0; i < RING; i++) { if (ringT[i] < -1e8 || !ring[i]) continue; const d = Math.abs(ringT[i] - target); if (d < bd) { bd = d; bi = i; } }
        if (bi >= 0) { U.cam.value = ring[bi].texture; U.camMode.value = S.mode === 'dj' ? 1 : 2; S.hold = Math.round(questNow() - ringT[bi]); S.holdShort = ringT[bi] > target + 40 ? 0 : bd > 40 ? 1 : 0; }
        const K = vs.K; U.thr.value = K.thr; U.soft.value = K.soft; U.spill.value = K.spill; U.cmatch.value = S.bd === 'dome' ? (K.cmatch || 0) : 0; U.keyCol.value = K.col || 0;
        U.crop.value.set(K.gl || 0, K.gr || 0, K.gt || 0, K.gb || 0);
        if (vs.mat && vs.mat.uniforms.panoTint) U.tint.value.copy(vs.mat.uniforms.panoTint.value);
      } else S.hold = null;
      // backdrop (not for LIVE DJ!, whose camera covers it; not when the Quest's frame is opaque)
      U.bgMode.value = 0;
      if (S.mode !== 'dj' && !(haveQ && !packed)) {
        if (S.bd === 'dome' && skybox.tex) {
          let ok = false;
          if (S.mode === 'key') {   // from this camera (its full video's field of view)
            const c = fixed.camState && fixed.camState(); camera.updateMatrixWorld();
            domeCam.matrixWorld.copy(camera.matrixWorld); if (c && c.ff) { domeCam.fov = c.ff; domeCam.aspect = c.vw / c.vh; } else { domeCam.fov = camera.fov; domeCam.aspect = S.W / S.H; } ok = true;
          } else {   // SHOW: from the Quest's show camera, the pose that goes with the frame on screen
            const p = poseAt((questNow() - (S.D != null ? S.D : 120)) & 0xFFFFFF);
            if (p) { rig.updateMatrixWorld(); domeCam.matrixWorld.compose(new THREE.Vector3().fromArray(p.p), new THREE.Quaternion().fromArray(p.q), new THREE.Vector3(1, 1, 1)).premultiply(rig.matrixWorld); domeCam.fov = p.fov; domeCam.aspect = S.W / S.H; ok = true; }
          }
          if (ok) {
            domeCam.matrixWorldInverse.copy(domeCam.matrixWorld).invert(); domeCam.updateProjectionMatrix();
            if (!domeRT || domeRT.width !== S.W || domeRT.height !== S.H) { if (domeRT) domeRT.dispose(); domeRT = new THREE.WebGLRenderTarget(S.W, S.H, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false }); }
            const sv = skybox.group.visible, cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha(); skybox.group.visible = true; skybox.setStereo(false);
            renderer.setRenderTarget(domeRT); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(skybox.group, domeCam); skybox.group.visible = sv; renderer.setClearColor(cc, ca);
            U.bgT.value = domeRT.texture; U.bgMode.value = 2;
          }
        } else if (S.bd === 'visuals' && clipTex && led.on && led.video && led.video.videoWidth) {
          const v = led.video, k = Math.max(S.W / v.videoWidth, S.H / v.videoHeight), w = S.W / (v.videoWidth * k), h = S.H / (v.videoHeight * k);
          U.bgT.value = clipTex; U.bgUv.value.set((1 - w) / 2, (1 - h) / 2, w, h); U.bgMode.value = 1;
        }
      }
      // the Quest's frame
      U.qMode.value = haveQ ? (packed ? 1 : 2) : 0;
      if (haveQ && !packed) { const a = qv.videoWidth / qv.videoHeight, oa = S.W / S.H; if (a > oa) U.qFit.value.set(0, (1 - oa / a) / 2, 1, oa / a); else U.qFit.value.set((1 - a / oa) / 2, 0, a / oa, 1); }
      U.t.value = now / 1000;
      renderer.setRenderTarget(null); renderer.render(compSc, oc); outN++;
    } finally { renderer.setRenderTarget(prevRT); renderer.xr.enabled = prevXR; renderer.autoClear = ac; }
    if (twTrack && twTrack.requestFrame) twTrack.requestFrame();
    if (now - fpsT > 1000) { S.fps = outN; S.qfps = qN; camRate = camN; outN = qN = camN = 0; fpsT = now; status(now, haveQ, needNote(haveQ, packed)); }
    return true;
  }
  function needNote(haveQ, packed) {
    if (S.linkLost) return 'Quest link lost: reconnect (Twitch stays up for a minute)';
    if (!haveQ) return 'no picture from the Quest yet';
    if ((S.mode === 'dj' || S.mode === 'key') && !fixed.on) return 'start Fixed camera on this phone for LIVE DJ! / LIVE KEY!';
    if (S.mode !== 'show' && S.holdShort) return 'the camera can\'t wait that long (over ' + RING + ' frames)';
    if (S.bd === 'dome' && S.mode !== 'dj' && !skybox.tex) return 'no panorama on this phone: copy it over (Library sync) for DOME';
    if (S.bd === 'visuals' && S.mode === 'key' && !(led.on && led.video)) return 'VISUALS: this phone has no copy of the LED clip (gradient instead)';
    return packed ? '' : 'the Quest sends a finished picture (shown as it is)';
  }
  function status(now, haveQ, note) {
    S.note = note;
    const L = getLink();
    if (L && L.isOpen) L.send('ctl', { k: 'sst', run: !!(S.on && !S.paused && haveQ), fps: S.fps, qfps: S.qfps, hold: S.hold, d: S.D != null ? Math.round(S.D) : null, tw: S.tw, twMsg: S.twMsg, kbps: S.kbps, note,
      clip: led.on && led.video && !led.video.paused ? led.name : '', cam: fixed.on && fixed.camInfo ? { ...fixed.camInfo(), rate: camRate } : null });
    stEl.textContent = `S8 STUDIO  ${({ show: 'SHOW', dj: 'LIVE DJ!', key: 'LIVE KEY!' })[S.mode]}  ·  backdrop ${S.bd.toUpperCase()}  ·  out ${S.fps} fps  ·  Quest ${S.qfps} fps\n` +
      `camera ${camRate} fps  ·  Quest frames ${S.D != null ? Math.round(S.D) + ' ms' : '-'} late  ·  camera held ${S.hold != null ? S.hold + ' ms' : '-'}  ·  trim ${S.trim} ms  ·  sound ${aTrack && S.snd ? 'on' : 'off'}\n` +
      `Twitch: ${S.tw}${S.twMsg ? ' (' + S.twMsg + ')' : ''}${S.tw === 'live' ? '  ' + (S.kbps / 1000).toFixed(1) + ' Mb/s' : ''}${note ? '\n' + note : ''}`;
    if (S.linkLost && S.tw !== 'off' && now - S.linkLost > 60000) twStop('the Quest link was gone for a minute');
    onState && onState(S);
  }
  // ---- Twitch (WHIP, as the Quest does it in stream.js): this screen's picture + the Quest's master sound
  let twPc = null, twTrack = null, twRes = null, twTry = 0, twLb = 0, twLt = 0, twIv = 0;
  function twSet(s, msg = '') { S.tw = s; S.twMsg = msg; }
  async function twStart() {
    if (twPc) return;
    let key = ''; try { key = localStorage.getItem(KEYK) || ''; } catch {}
    if (!key) { twSet('error', 'no stream key (the Quest sends it with GO LIVE)'); return; }
    twSet('connecting', 'connecting');
    try {
      if (!twTrack || twTrack.readyState !== 'live') { twTrack = cv.captureStream(0).getVideoTracks()[0]; twTrack.contentHint = 'motion'; }
      const pc = twPc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
      const at = pc.addTransceiver(aTrack && aTrack.readyState === 'live' ? aTrack : 'audio', { direction: 'sendonly' });
      const vt = pc.addTransceiver(twTrack, { direction: 'sendonly' });
      try {
        const caps = RTCRtpSender.getCapabilities('video').codecs, h = caps.filter(c => /h264/i.test(c.mimeType)).sort((a, b) => (/42e01f/.test(b.sdpFmtpLine) ? 1 : 0) - (/42e01f/.test(a.sdpFmtpLine) ? 1 : 0));
        if (h.length) vt.setCodecPreferences([...h, ...caps.filter(c => /rtx|red|ulpfec/i.test(c.mimeType))]);
      } catch {}
      pc.onconnectionstatechange = () => { if (pc !== twPc) return; const s = pc.connectionState; if (s === 'failed' || s === 'disconnected') twLost(s); };
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise(res => { if (pc.iceGatheringState === 'complete') return res(); const t = setTimeout(res, 2000); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } }); });
      const r = await fetch(TWITCH_WHIP, { method: 'POST', headers: { 'Content-Type': 'application/sdp', Authorization: 'Bearer ' + key }, body: pc.localDescription.sdp });
      const body = await r.text();
      if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'Twitch refused the stream key' : 'Twitch said ' + r.status);
      twRes = r.headers.get('Location');
      await pc.setRemoteDescription({ type: 'answer', sdp: opusStereo(body) });
      const set = async (s, o) => { try { const p = s.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}]; Object.assign(p.encodings[0], o); await s.setParameters(p); } catch {} };
      await set(vt.sender, { maxBitrate: 3500000, maxFramerate: 30 }); await set(at.sender, { maxBitrate: 160000, priority: 'high', networkPriority: 'high' });
      twSender = at.sender; twTry = 0; twSet('live');
      clearInterval(twIv); twIv = setInterval(twStats, 2000);
    } catch (e) { twClose(); twSet('error', e.message || String(e)); }
  }
  let twSender = null;
  async function twStats() {
    if (!twPc) return;
    try { let b = 0; (await twPc.getStats()).forEach(s => { if (s.type === 'outbound-rtp') b += s.bytesSent || 0; }); const t = performance.now(); if (twLt) S.kbps = Math.round((b - twLb) * 8 / (t - twLt)); twLb = b; twLt = t; } catch {}
    if (twSender && aTrack && twSender.track !== aTrack && aTrack.readyState === 'live') twSender.replaceTrack(aTrack).catch(() => {});   // the Quest's sound came back after a reconnect
  }
  function twLost(why) {
    if (twTry >= 3) { twStop('connection lost (' + why + ')', true); return; }
    twTry++; twSet('connecting', `reconnecting (${twTry} of 3)`); twClose(true);
    setTimeout(() => { if (S.tw === 'connecting') twStart(); }, 3000);
  }
  function twClose(keepTrack) {
    clearInterval(twIv); twIv = 0;
    if (twPc) { try { twPc.close(); } catch {} twPc = null; }
    if (twRes) { let k = ''; try { k = localStorage.getItem(KEYK) || ''; } catch {} fetch(new URL(twRes, TWITCH_WHIP).href, { method: 'DELETE', headers: { Authorization: 'Bearer ' + k } }).catch(() => {}); twRes = null; }
    if (!keepTrack && twTrack) { twTrack.stop(); twTrack = null; }
    twSender = null; S.kbps = 0; twLb = twLt = 0;
  }
  function twStop(msg, err) { twClose(); twSet(err ? 'error' : 'off', msg || ''); }
  // the sound follows the Quest's SOUND switch (it simply stops sending); the element is never muted after START STUDIO
  return { S, onMsg, onScp, onTrack, onLink, frame, get on() { return S.on && !S.paused; }, get mon() { return S.on && !S.paused && S.mon; }, resume() { S.paused = false; apply(); } };
}
