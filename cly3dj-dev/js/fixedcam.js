// #208 Fixed camera mode (spectator phone, no AR). The phone stands on a tripod and never moves, so it needs no
// tracking: its normal camera (main or selfie) is the background, and the gear is drawn from one fixed camera pose
// in the Quest's rig space. The pose comes from a point calibration (#211: the phone picks 4 to 6 sharp corners in its
// picture, the DJ touches each with the controller tip; or tap your own marks; the page solves position, direction, zoom), and manual nudge
// controls fine-tune it. Saved per camera (main / selfie). Also: exposure / focus / white-balance lock where the
// phone allows, and a test that times the main <-> selfie swap.
// #499 camera picker (laptop webcams: pick the device, pose saved per device) and lens distortion: with 6+ points
// (+ lens touch) the solve also finds k1 / k2 (radial). The camera picture is then undistorted on the GPU, and the
// exported video is that straight picture, so every user (gear render, studio, PHONE CAM, look) stays a plain pinhole.
const DEG = Math.PI / 180;

export function makeFixedCam({ THREE, renderer, scene, camera, rig, room, getLink, onChange }) {
  const S = { on: false, facing: 'environment', stream: null, track: null, vw: 0, vh: 0, crop: null, pose: null, err: null,
    cal: null, caps: {}, set: {}, lock: false, msg: '', swap: '' };
  const mkV = () => { const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.autoplay = true; return v; };
  const raw = mkV();     // #499 the camera itself (calibration reads this)
  const video = mkV();   // what everyone else sees: raw, or the undistorted copy when the pose has k1 / k2
  const tex = new THREE.VideoTexture(video); tex.colorSpace = THREE.SRGBColorSpace; tex.matrixAutoUpdate = true;
  S.dev = (() => { try { return localStorage.getItem('vire.fixcam.dev') || ''; } catch { return ''; } })();   // #499 chosen camera ('' = main / selfie)
  S.devs = [];
  const keyOf = f => S.dev ? 'vire.fixcam.d.' + S.dev.slice(0, 24) : 'vire.fixcam.' + (f === 'user' ? 'selfie' : 'main');
  const loadPose = f => { try { const p = JSON.parse(localStorage.getItem(keyOf(f))); if (p && p.p && p.e && p.fov) return p; } catch {} return null; };
  const savePose = () => { try { localStorage.setItem(keyOf(S.facing), JSON.stringify(S.pose)); } catch {} };
  let saved = null;   // scene state to restore on exit
  const lowLight = { fps25: true, ev: 1, ...(() => { try { return JSON.parse(localStorage.getItem('vire.fixcam.low')) || {}; } catch { return {}; } })() };   // #382

  // ---------------------------------------------------------------- UI
  document.head.insertAdjacentHTML('beforeend', `<style>
    #fxO { position:fixed; inset:0; z-index:35; pointer-events:none; color:#e6e8ec; font:14px/1.4 system-ui,sans-serif; }
    #fxO .info { position:absolute; top:8px; left:8px; right:8px; font:12px/1.4 ui-monospace,monospace; background:rgba(14,16,22,.78); padding:6px 9px; border-radius:8px; }
    #fxO .hint { position:absolute; top:52px; left:50%; transform:translateX(-50%); background:rgba(14,16,22,.85); border:1px solid #39a8ff; padding:8px 12px; border-radius:8px; text-align:center; max-width:86%; font-weight:600; }
    #fxO .bar { position:absolute; left:8px; right:8px; bottom:12px; display:flex; flex-wrap:wrap; gap:6px; justify-content:center; pointer-events:auto; }
    #fxO button { font:600 14px system-ui,sans-serif; color:#e6e8ec; background:rgba(14,16,22,.8); border:1px solid #2e3850; border-radius:10px; padding:10px 11px; }
    #fxO select { font:600 13px system-ui,sans-serif; color:#e6e8ec; background:rgba(14,16,22,.8); border:1px solid #2e3850; border-radius:10px; padding:9px 8px; max-width:220px; }
    #fxO button.on { border-color:#39a8ff; color:#fff; } #fxO button:disabled { opacity:.4; }
    #fxO .nudge { position:absolute; left:8px; right:8px; bottom:120px; background:rgba(14,16,22,.88); border:1px solid #2e3850; border-radius:12px; padding:8px; pointer-events:auto; display:grid; grid-template-columns:auto 1fr 1fr; gap:6px; align-items:center; }
    #fxO .nudge span { font-weight:600; font-size:13px; color:#8c96a8; padding-right:6px; }
    #fxO .nudge button { padding:9px 4px; }
    #fxTap { position:fixed; inset:0; z-index:34; pointer-events:auto; }
    .fxMark { position:fixed; z-index:36; width:22px; height:22px; margin:-11px 0 0 -11px; border:2px solid #ffd040; border-radius:50%; pointer-events:none; color:#ffd040; font:700 12px system-ui; text-align:center; line-height:18px; }
    .fxMark.cur { border-color:#ffd040; width:30px; height:30px; margin:-15px 0 0 -15px; line-height:26px; box-shadow:0 0 0 2px rgba(0,0,0,.6); }
    .fxMark.done { border-color:#40d080; color:#40d080; } .fxMark.next { border-color:#39a8ff; color:#39a8ff; }
    #fxMag { position:absolute; right:8px; top:96px; width:min(56vw,340px); border:1px solid #ffd040; border-radius:8px; }
    .fxMark.rep { border-color:#40ff70; border-radius:2px; width:10px; height:10px; margin:-5px 0 0 -5px; }
    #fxO [hidden], #fxTap[hidden] { display:none !important; }
    #fxO.hide .bar, #fxO.hide .info, #fxO.hide .nudge, #fxO.hide .hint { display:none; }
  </style>`);
  document.body.insertAdjacentHTML('beforeend', `<div id="fxO" hidden>
    <div class="info" id="fxInfo"></div><div class="hint" id="fxHint" hidden></div>
    <div class="nudge" id="fxNudge" hidden>
      <span>Move</span><button data-n="x-">◀ left</button><button data-n="x+">right ▶</button>
      <span></span><button data-n="y+">▲ up</button><button data-n="y-">down ▼</button>
      <span></span><button data-n="z-">nearer</button><button data-n="z+">further</button>
      <span>Turn</span><button data-n="yaw+">⟲ left</button><button data-n="yaw-">right ⟳</button>
      <span>Tilt</span><button data-n="pitch+">up</button><button data-n="pitch-">down</button>
      <span>Roll</span><button data-n="roll+">⟲</button><button data-n="roll-">⟳</button>
      <span>Zoom</span><button data-n="fov-">in +</button><button data-n="fov+">out −</button>
      <span>Step</span><button id="fxStep">fine</button><button id="fxReset">reset view</button>
    </div>
    <div class="bar">
      <button id="fxCal">Calibrate</button><button id="fxSolve" hidden>Solve</button><button id="fxSkip" hidden>Skip point</button><button id="fxRescan" hidden>New points</button><button id="fxOwn" hidden>Mark my own</button><button id="fxUndo" hidden>Undo mark</button><button id="fxCancel" hidden>Cancel</button>
      <button id="fxNud">Nudge</button><button id="fxCamB">Main camera</button><select id="fxDev" hidden></select><button id="fxLock">Lock exposure</button><button id="fxEm">Exp −</button><button id="fxEp">Exp +</button>
      <button id="fxSwap">Swap test</button><button id="fxHide">Hide UI</button><button id="fxExit">Exit</button>
    </div></div><div id="fxTap" hidden></div>`);
  const $ = s => document.querySelector(s), ov = $('#fxO'), tap = $('#fxTap'), hint = $('#fxHint');
  const say = t => { S.msg = t; hint.hidden = !t; hint.textContent = t || ''; };
  hint.style.pointerEvents = 'auto'; hint.onclick = () => say('');   // #385 tap the blue box to close it
  let marks = [];
  const clearMarks = () => { for (const m of marks) m.remove(); marks = []; };
  function markAt(vx, vy, label, rep) {   // video px -> screen
    const c = S.crop; if (!c) return;
    const d = document.createElement('div'); d.className = 'fxMark' + (rep ? ' rep' : ''); d.textContent = rep ? '' : label;
    d.style.left = (vx - c.x) * c.s + 'px'; d.style.top = (vy - c.y) * c.s + 'px'; document.body.append(d); marks.push(d);
  }
  const link = () => { const l = S.testLink || getLink(); return l && l.isOpen ? l : null; };   // testLink: PC tests without a Quest

  // ---------------------------------------------------------------- camera feed
  async function open(facing) {
    if (S.stream) { for (const t of S.stream.getTracks()) t.stop(); S.stream = null; }
    const t0 = performance.now();
    // #382 LOW LIGHT 25 (owner, dark clubs): a phone camera in a dim room slows itself to ~15 fps to gather light (the S8 / M33 / laptop
    // tests all showed 10-17). Asking for at least 24 fps holds it at 25; the picture gets darker, which EV + (exposure compensation, the
    // camera's own gain) and the studio's GAIN make up for.
    const fr = lowLight.fps25 ? { ideal: 25, min: 24 } : { ideal: 30 };
    const want = (exact, f) => ({ audio: false, video: { facingMode: exact ? { exact: facing } : facing, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: f } });
    const byDev = f => ({ audio: false, video: { deviceId: { exact: S.dev }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: f } });
    const get = async f => { if (S.dev) { try { return await navigator.mediaDevices.getUserMedia(byDev(f)); } catch (e) { if (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError') throw e; setDev(''); } }   // #499 unplugged: back to main / selfie
      try { return await navigator.mediaDevices.getUserMedia(want(true, f)); }
      catch (e) { if (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError') throw e; return navigator.mediaDevices.getUserMedia(want(false, f)); } };   // a single camera (PC)
    try { S.stream = await get(fr); } catch (e) { if (!lowLight.fps25 || e.name !== 'OverconstrainedError') throw e; S.stream = await get({ ideal: 25 }); }   // no 24+ range on this camera: ask nicely
    S.track = S.stream.getVideoTracks()[0]; S.facing = facing;
    raw.srcObject = S.stream; await raw.play().catch(() => {});
    await new Promise(res => { if (raw.requestVideoFrameCallback) raw.requestVideoFrameCallback(() => res()); else raw.addEventListener('playing', res, { once: true }); setTimeout(res, 3000); });
    S.vw = raw.videoWidth; S.vh = raw.videoHeight;
    try { S.caps = S.track.getCapabilities ? S.track.getCapabilities() : {}; S.set = S.track.getSettings(); } catch { S.caps = {}; S.set = {}; }
    S.lock = false;
    await applyEv();   // #382
    S.pose = loadPose(facing) || (S.dev ? null : S.pose) || defaultPose();
    $('#fxCamB').textContent = S.dev ? 'Main / selfie' : facing === 'user' ? 'Selfie camera' : 'Main camera';
    await listDevs(); route();
    ui();
    return Math.round(performance.now() - t0);
  }
  raw.addEventListener('resize', () => { S.vw = raw.videoWidth; S.vh = raw.videoHeight; });

  // ---------------------------------------------------------------- #499 camera picker
  function setDev(id) { S.dev = id || ''; try { localStorage.setItem('vire.fixcam.dev', S.dev); } catch {} }
  async function listDevs() {
    try { S.devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch { S.devs = []; }
    const sel = $('#fxDev'); sel.hidden = S.devs.length < 2;
    sel.innerHTML = '<option value="">Main / selfie</option>' + S.devs.map((d, i) => `<option value="${d.deviceId}">${(d.label || 'Camera ' + (i + 1)).replace(/[<>&"]/g, '').slice(0, 40)}</option>`).join('');
    sel.value = S.dev && S.devs.some(d => d.deviceId === S.dev) ? S.dev : '';
  }
  async function pickDev(id) {
    if (S.cal) calCancel();
    setDev(id); try { await open(S.facing); } catch (e) { say('Camera: ' + e.message); }
    say(S.pose && loadPose(S.facing) ? '' : 'Not calibrated for this camera yet: press Calibrate.');
  }
  const devName = () => { const d = S.dev && S.devs.find(x => x.deviceId === S.dev); return d ? (d.label || 'camera').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)/i, '').slice(0, 28) : ''; };

  // ---------------------------------------------------------------- #499 undistort (radial k1 / k2, principal point at the centre)
  // Model (same as solvePose): a straight-lens pixel at distance r (in focal lengths) from the centre shows up in the
  // camera picture at r * (1 + k1 r^2 + k2 r^4). For each output pixel we compute that and sample the raw picture there:
  // closed form, no iteration. Same size and focal length as the raw picture, so fov / ff stay as solved.
  const U = { cv: null, gl: null, prog: null, tex: null, loc: null, on: false, track: null, cb: 0 };
  function uInit() {
    if (U.gl) return true;
    const cv = document.createElement('canvas'), gl = cv.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) return false;
    const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, '#version 300 es\nin vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float; uniform sampler2D T; uniform vec2 uS; uniform float uF; uniform vec2 uK; out vec4 o;
void main(){
  vec2 px = vec2(gl_FragCoord.x, uS.y - gl_FragCoord.y), c = uS * .5, n = (px - c) / uF;
  float r2 = dot(n, n), d = 1. + uK.x * r2 + uK.y * r2 * r2;
  vec2 uv = (c + (px - c) * d) / uS;
  o = (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) ? vec4(0., 0., 0., 1.) : vec4(texture(T, uv).rgb, 1.);
}`));
    gl.linkProgram(pr); gl.useProgram(pr);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    U.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, U.tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    U.loc = { S: gl.getUniformLocation(pr, 'uS'), F: gl.getUniformLocation(pr, 'uF'), K: gl.getUniformLocation(pr, 'uK') };
    Object.assign(U, { cv, gl, prog: pr });
    return true;
  }
  function uDraw() {
    const gl = U.gl, P = S.pose; if (!U.on || !gl || !P || !raw.videoWidth) return;
    const W = raw.videoWidth, H = raw.videoHeight;
    if (U.cv.width !== W || U.cv.height !== H) { U.cv.width = W; U.cv.height = H; }
    gl.viewport(0, 0, W, H);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    gl.uniform2f(U.loc.S, W, H); gl.uniform1f(U.loc.F, (H / 2) / Math.tan(P.fov * DEG / 2)); gl.uniform2f(U.loc.K, P.k[0], P.k[1] || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (U.track && U.track.requestFrame) U.track.requestFrame();
  }
  function uLoop() { if (!U.on) return; uDraw(); if (raw.requestVideoFrameCallback) U.cb = raw.requestVideoFrameCallback(uLoop); else U.cb = setTimeout(uLoop, 33); }
  // which picture goes out: the undistorted copy when the pose has k1 / k2 (not while calibrating: the taps and corners are raw)
  function route() {
    const P = S.pose, want = !!(S.on && S.stream && P && P.k && Math.abs(P.k[0]) + Math.abs(P.k[1] || 0) > 1e-4 && !S.cal);
    if (want && !uInit()) { say('No WebGL2 here: lens correction is off.'); return setOut(S.stream); }
    if (want) {
      if (!U.on) { U.on = true; if (!U.track || U.track.readyState !== 'live') U.track = U.cv.captureStream(0).getVideoTracks()[0]; uLoop(); }
      uDraw(); setOut(new MediaStream([U.track]));
    } else {
      if (U.on) { U.on = false; if (raw.cancelVideoFrameCallback) raw.cancelVideoFrameCallback(U.cb); clearTimeout(U.cb); }
      setOut(S.stream);
    }
  }
  function setOut(ms) {
    const cur = video.srcObject;
    if (ms && cur && cur.getVideoTracks()[0] === ms.getVideoTracks()[0]) return;
    video.srcObject = ms || null; if (ms) video.play().catch(() => {});
  }
  function defaultPose() {   // the page's own DJ view until calibrated
    camera.updateMatrixWorld(); const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    return { p: camera.position.toArray().map(v => +v.toFixed(3)), e: [e.y, e.x, e.z], fov: 60 };
  }

  // per frame: background crop ("cover") and the camera matching it exactly
  function frame() {
    if (!S.on || !S.vw || !S.pose) return;
    const sw = innerWidth, sh = innerHeight, s = Math.max(sw / S.vw, sh / S.vh), w = sw / s, h = sh / s, x = (S.vw - w) / 2, y = (S.vh - h) / 2;
    S.crop = { s, x, y, w, h };
    tex.repeat.set(w / S.vw, h / S.vh); tex.offset.set(x / S.vw, 1 - (y + h) / S.vh);
    camera.fov = S.pose.fov; camera.aspect = S.vw / S.vh; camera.near = 0.05; camera.far = 30;
    camera.setViewOffset(S.vw, S.vh, x, y, w, h); camera.updateProjectionMatrix();
    camera.position.fromArray(S.pose.p); camera.rotation.set(S.pose.e[1], S.pose.e[0], S.pose.e[2], 'YXZ'); camera.updateMatrixWorld(true);
  }
  // what the Quest needs for the blue outline of the view: pose (rig space) + the visible crop's fov / aspect
  function camState() {
    if (!S.on || !S.crop || !S.pose) return null;
    const c = S.crop, fovV = 2 * Math.atan(Math.tan(S.pose.fov * DEG / 2) * c.h / S.vh);
    // #347 ff / vw / vh: the FULL video's vertical fov and size, so the Quest's PHONE CAM can draw the gear exactly over
    // the whole frame the phone sends (the crop above only matches this phone's own screen)
    return { p: S.pose.p, q: camera.quaternion.toArray().map(v => +v.toFixed(4)), fov: fovV, asp: c.w / c.h, ff: S.pose.fov, vw: S.vw, vh: S.vh };
  }

  // ---------------------------------------------------------------- start / stop
  async function start(facing) {
    try { await open(facing); } catch (e) { return 'Camera: ' + e.message; }
    saved = { bg: scene.background, room: room.visible, env: scene.environmentIntensity, rp: rig.position.clone(), rr: rig.rotation.clone(), rv: rig.visible, fov: camera.fov, near: camera.near, far: camera.far };
    scene.background = tex; room.visible = false; scene.environmentIntensity = 0.6;
    rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.visible = true;   // fixed mode works in the Quest's rig space directly
    S.on = true; ov.hidden = false; ov.classList.remove('hide'); route();
    say(S.pose && loadPose(facing) ? '' : 'Not calibrated yet: press Calibrate.');
    onChange && onChange();
    return '';
  }
  function stop() {
    if (!S.on) return;
    S.on = false; ov.hidden = true; tap.hidden = true; clearMarks(); S.cal = null;
    if (S.stream) { for (const t of S.stream.getTracks()) t.stop(); S.stream = null; }
    route(); if (U.track) { U.track.stop(); U.track = null; }
    if (saved) { scene.background = saved.bg; room.visible = saved.room; scene.environmentIntensity = saved.env; rig.position.copy(saved.rp); rig.rotation.copy(saved.rr); rig.visible = saved.rv;
      camera.clearViewOffset(); camera.fov = saved.fov; camera.near = saved.near; camera.far = saved.far; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
    onChange && onChange();
  }

  // ---------------------------------------------------------------- calibration (#211 auto points first, taps as the fallback)
  // Calibrate looks for 4 to 6 sharp, high-contrast corners in the camera picture (table / case corners, tile
  // crossings, box corners...), spread across the shot, and numbers them. For each one in turn the Quest shows a
  // picture of it (the whole shot with the point ringed + a close-up); the DJ touches that spot with the controller
  // tip and pulls the trigger, and the phone moves to the next. Skip (phone button, or the Quest's grip) swaps the
  // current point for another corner; tapping the screen moves the current point to the tap (snapped to the
  // sharpest corner right there). With fewer than 4 corners found it falls back to tapping each mark yourself.
  const AUTO_N = 6;
  const gcv = document.createElement('canvas'), gg = gcv.getContext('2d', { willReadFrequently: true });
  function grayOf(sx, sy, sw, sh, dw, dh) {   // video region -> Float32 grey dw x dh
    gcv.width = dw; gcv.height = dh; gg.drawImage(raw, sx, sy, sw, sh, 0, 0, dw, dh);
    const d = gg.getImageData(0, 0, dw, dh).data, g = new Float32Array(dw * dh);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) / 255;
    return g;
  }
  function cornerMap(g, w, h, r = 2) {   // Shi-Tomasi: smallest eigenvalue of the gradient structure tensor, (2r+1)^2 window
    const A = new Float32Array(w * h), B = new Float32Array(w * h), C = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1]) - (g[i - w - 1] + 2 * g[i - 1] + g[i + w - 1]);
      const gy = (g[i + w - 1] + 2 * g[i + w] + g[i + w + 1]) - (g[i - w - 1] + 2 * g[i - w] + g[i - w + 1]);
      A[i] = gx * gx; B[i] = gx * gy; C[i] = gy * gy;
    }
    const box = (M) => {   // separable box sum
      const t = new Float32Array(w * h), o = new Float32Array(w * h);
      for (let y = 0; y < h; y++) { let s = 0; for (let x = -r; x < w + r; x++) { if (x + r < w) s += M[y * w + x + r]; if (x - r - 1 >= 0) s -= M[y * w + x - r - 1]; if (x >= 0 && x < w) t[y * w + x] = s; } }
      for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y < h + r; y++) { if (y + r < h) s += t[(y + r) * w + x]; if (y - r - 1 >= 0) s -= t[(y - r - 1) * w + x]; if (y >= 0 && y < h) o[y * w + x] = s; } }
      return o;
    };
    const a = box(A), b = box(B), c = box(C);
    for (let i = 0; i < out.length; i++) { const m = (a[i] + c[i]) / 2, d = Math.sqrt(((a[i] - c[i]) / 2) ** 2 + b[i] * b[i]); out[i] = m - d; }
    return out;
  }
  function peaks(m, w, h, edge, nms = 3) {   // local maxima, strongest first
    let max = 0; for (const v of m) if (v > max) max = v;
    const thr = max * 0.03, out = [];
    for (let y = edge; y < h - edge; y++) for (let x = edge; x < w - edge; x++) {
      const v = m[y * w + x]; if (v <= thr) continue;
      let ok = true;
      for (let dy = -nms; dy <= nms && ok; dy++) for (let dx = -nms; dx <= nms; dx++) if ((dx || dy) && m[(y + dy) * w + x + dx] > v) { ok = false; break; }
      if (ok) out.push({ x, y, s: v });
    }
    return out.sort((p, q) => q.s - p.s).slice(0, 400);
  }
  function subPix(m, w, x, y) {   // parabola through the peak and its neighbours
    const c = m[y * w + x], l = m[y * w + x - 1], r = m[y * w + x + 1], u = m[(y - 1) * w + x], d = m[(y + 1) * w + x];
    const dx = (l - r) / (2 * (l - 2 * c + r) || 1), dy = (u - d) / (2 * (u - 2 * c + d) || 1);
    return [x + Math.max(-0.5, Math.min(0.5, dx)), y + Math.max(-0.5, Math.min(0.5, dy))];
  }
  // the sharpest corner near video point (vx, vy), at full camera resolution (r = search radius, video px)
  function refine(vx, vy, r) {
    const R = Math.round(r) + 4, x0 = Math.round(vx) - R, y0 = Math.round(vy) - R, n = 2 * R + 1;
    if (x0 < 0 || y0 < 0 || x0 + n > S.vw || y0 + n > S.vh) return null;
    const g = grayOf(x0, y0, n, n, n, n), m = cornerMap(g, n, n, 2);
    let best = -1, bx = 0, by = 0;
    for (let y = 4; y < n - 4; y++) for (let x = 4; x < n - 4; x++) {
      const v = m[y * n + x]; if (v > best && Math.hypot(x0 + x - vx, y0 + y - vy) <= r) { best = v; bx = x; by = y; }
    }
    if (best <= 0) return null;
    const [sx, sy] = subPix(m, n, bx, by);
    return { x: x0 + sx, y: y0 + sy, s: best };
  }
  // find candidate corners in the visible part of the picture; pick AUTO_N spread out, the rest stay as spares
  function detect() {
    const c = S.crop; if (!c || !S.vw) return null;
    const ix = c.w * 0.05, iy = c.h * 0.05, sx = c.x + ix, sy = c.y + iy, sw = c.w - 2 * ix, sh = c.h - 2 * iy;
    const dw = Math.min(480, Math.round(sw)), k = sw / dw, dh = Math.round(sh / k);
    const m = cornerMap(grayOf(sx, sy, sw, sh, dw, dh), dw, dh, 2);
    const cand = peaks(m, dw, dh, 4).map(p => { const [x, y] = subPix(m, dw, p.x, p.y); return { x: sx + x * k, y: sy + y * k, s: p.s }; });
    if (!cand.length) return { pick: [], spare: [] };
    const sMax = cand[0].s, diag = Math.hypot(sw, sh), minD = diag * 0.08;
    const pick = [cand[0]];
    while (pick.length < AUTO_N) {
      let best = null, bs = 0;
      for (const p of cand) {
        if (pick.includes(p)) continue;
        const d = Math.min(...pick.map(q => Math.hypot(p.x - q.x, p.y - q.y))); if (d < minD) continue;
        const sc = (d / diag) * Math.sqrt(p.s / sMax); if (sc > bs) { bs = sc; best = p; }
      }
      if (!best) break; pick.push(best);
    }
    pick.sort((p, q) => p.x - q.x);   // numbered left to right, so the walk is simple
    for (const p of pick) { const f = refine(p.x, p.y, 3 * k); if (f) { p.x = f.x; p.y = f.y; } }
    return { pick, spare: cand.filter(p => !pick.includes(p)), minD };
  }

  // the picture the Quest shows for one point: the whole shot with the point ringed + a 4x close-up
  const icv = document.createElement('canvas'), ig = icv.getContext('2d');
  function pointImage(C, i) {
    const c = S.crop, p = C.auto[i], H = 240, W1 = Math.round(H * c.w / c.h), Z = 240;
    icv.width = W1 + 8 + Z; icv.height = H; ig.fillStyle = '#0a0c12'; ig.fillRect(0, 0, icv.width, H);
    ig.drawImage(raw, c.x, c.y, c.w, c.h, 0, 0, W1, H);
    const k = W1 / c.w;
    C.auto.forEach((q, j) => {
      const x = (q.x - c.x) * k, y = (q.y - c.y) * k, cur = j === i;
      ig.lineWidth = cur ? 4 : 2; ig.strokeStyle = cur ? '#ffd040' : j < i ? '#40d080' : 'rgba(57,168,255,.9)';
      ig.beginPath(); ig.arc(x, y, cur ? 14 : 7, 0, 7); ig.stroke();
      if (cur) { ig.font = '700 20px system-ui'; ig.fillStyle = '#ffd040'; ig.fillText(String(i + 1), x + 16, y - 10); }
    });
    const half = Math.max(24, Math.min(S.vw, S.vh) * 0.05);   // close-up: about a tenth of the picture height
    ig.save(); ig.beginPath(); ig.rect(W1 + 8, 0, Z, H); ig.clip();
    ig.drawImage(raw, p.x - half, p.y - half, 2 * half, 2 * half, W1 + 8, 0, Z, Z);
    ig.strokeStyle = '#ffd040'; ig.lineWidth = 2; const cx = W1 + 8 + Z / 2, cy = H / 2;
    ig.beginPath(); ig.moveTo(cx - 40, cy); ig.lineTo(cx - 8, cy); ig.moveTo(cx + 8, cy); ig.lineTo(cx + 40, cy);
    ig.moveTo(cx, cy - 40); ig.lineTo(cx, cy - 8); ig.moveTo(cx, cy + 8); ig.lineTo(cx, cy + 40); ig.stroke(); ig.restore();
    return icv.toDataURL('image/jpeg', 0.72);
  }
  const mag = document.createElement('img'); mag.id = 'fxMag'; mag.hidden = true; ov.append(mag);

  function drawAuto() {
    const C = S.cal; clearMarks(); if (!C || !C.auto) return;
    C.auto.forEach((p, j) => { markAt(p.x, p.y, j + 1); const m = marks[marks.length - 1]; if (m) m.classList.add(j < C.i ? 'done' : j === C.i ? 'cur' : 'next'); });
  }
  function askPoint() {   // send the current auto point to the Quest
    const C = S.cal, l = link(); if (!C || !l) return;
    if (C.i >= C.auto.length) { if (C.pts.length >= 4) calSolve(); else say('Not enough points: press New points, or Cancel.'); return; }
    const img = pointImage(C, C.i); mag.src = img; mag.hidden = false;
    C.wait = 'touch'; drawAuto();
    l.send('ctl', { k: 'cal', step: 'pt', n: C.i + 1, of: C.auto.length, img });
    say(`Point ${C.i + 1} of ${C.auto.length}: touch it with the controller tip and pull the trigger. Skip if you can't reach it; tap the screen to move it.`);
    ui();
  }
  function calStart() {
    if (!link()) { say('Connect to the Quest first (the controller touches the points).'); return; }
    S.cal = { pix: [], pts: [], wait: 'lens', lens: null, auto: null, spare: [], i: 0 }; clearMarks(); tap.hidden = false; route();   // #499 raw picture while calibrating
    const d = detect();
    if (d && d.pick.length >= 4) Object.assign(S.cal, { auto: d.pick, spare: d.spare, minD: d.minD });
    drawAuto(); askLens();
  }
  // #213 step 1: the controller tip on the phone's own camera lens. That fixes where the camera is, so the points
  // only have to find its direction and zoom: far steadier than points alone (4 points can fit a wrong pose closely).
  function askLens() {
    const C = S.cal, l = link(); if (!C || !l) return;
    C.wait = 'lens'; mag.hidden = true;
    l.send('ctl', { k: 'cal', step: 'flens', cam: S.facing });
    say(`Step 1: touch ${S.dev ? 'the ' + (devName() || 'camera') + "'s" : "the phone's " + (S.facing === 'user' ? 'FRONT (selfie)' : 'BACK (main)')} camera lens with the controller tip and pull the trigger. Skip if you can't reach it.`);
    ui();
  }
  function afterLens() {
    const C = S.cal; if (!C) return;
    if (C.auto) { askPoint(); return; }
    C.wait = 'tap'; const l = link(); if (l) l.send('ctl', { k: 'cal', step: 'hold' });
    say(`Mark ${C.pix.length + 1}: tap a sharp real corner on the screen.`); ui();
  }
  function calOwn() {   // #213 switch to marking your own points (tap on the phone, then touch with the controller)
    const C = S.cal; if (!C) return;
    if (C.auto) { C.auto = null; mag.hidden = true; }
    if (C.wait === 'lens') { ui(); say('Own points: first touch the lens (or Skip), then tap each mark.'); return; }
    if (C.pix.length > C.pts.length) C.pix.pop();   // a tapped mark not yet touched
    C.wait = 'tap'; const l = link(); if (l) l.send('ctl', { k: 'cal', step: 'hold' });
    clearMarks(); C.pix.forEach(([x, y], i) => markAt(x, y, i + 1));
    say(`Own points: tap mark ${C.pix.length + 1} on the screen (a sharp real corner), then touch it with the controller tip.`); ui();
  }
  function calRescan() {
    const C = S.cal; if (!C) return;
    if (C.wait === 'lens') { const d = detect(); if (d && d.pick.length >= 4) Object.assign(C, { auto: d.pick, spare: d.spare, minD: d.minD }); drawAuto(); ui(); return; }
    const d = detect(); if (!d || d.pick.length < 4) { say('Still not enough sharp corners: tap the marks yourself.'); C.auto = null; C.wait = 'tap'; mag.hidden = true; drawAuto(); ui(); return; }
    // keep the points already touched, add new ones (away from them) after them
    const keep = C.auto ? C.auto.slice(0, C.i) : C.pix.map(([x, y]) => ({ x, y }));
    const fresh = d.pick.filter(p => keep.every(q => Math.hypot(p.x - q.x, p.y - q.y) > d.minD));
    C.auto = keep.concat(fresh).slice(0, Math.max(AUTO_N, keep.length + 1)); C.spare = d.spare; C.minD = d.minD; C.i = keep.length;
    askPoint();
  }
  function calSkip() {   // swap the current point for the best spare corner away from the others
    const C = S.cal; if (C && C.wait === 'lens') { C.lens = null; afterLens(); return true; }   // #213 no lens touch
    if (!C || !C.auto || C.i >= C.auto.length) return false;
    const others = C.auto.filter((_, j) => j !== C.i), diag = Math.hypot(S.crop.w, S.crop.h);
    C.spare = C.spare.filter(p => p !== C.auto[C.i]);
    let best = null, bs = 0;
    for (const p of C.spare) { const d = Math.min(...others.map(q => Math.hypot(p.x - q.x, p.y - q.y))); if (d < (C.minD || 0)) continue; const sc = (d / diag) * Math.sqrt(p.s); if (sc > bs) { bs = sc; best = p; } }
    if (best) { C.spare = C.spare.filter(p => p !== best); const f = refine(best.x, best.y, 4); C.auto[C.i] = f ? { x: f.x, y: f.y, s: best.s } : best; }
    else C.auto.splice(C.i, 1);   // no spare left: just drop it
    askPoint(); return true;
  }
  tap.addEventListener('pointerdown', e => {
    const C = S.cal, c = S.crop; if (!C || !c || C.wait === 'lens') return;
    const vx = c.x + e.clientX / c.s, vy = c.y + e.clientY / c.s;
    if (C.auto) {   // move the current point here, snapped to the sharpest corner within about 25 screen px
      if (C.i >= C.auto.length) return;
      const f = refine(vx, vy, 25 / c.s); C.auto[C.i] = f || { x: vx, y: vy, s: 0 }; askPoint(); return;
    }
    if (C.wait !== 'tap') return;
    const f = refine(vx, vy, 12 / c.s), px = f ? f.x : vx, py = f ? f.y : vy, n = C.pix.length + 1;
    C.pix.push([px, py]); markAt(px, py, n); C.wait = 'touch';
    const l = link(); if (l) l.send('ctl', { k: 'cal', step: 'pt', n });
    say(`Mark ${n}: now touch it with the controller tip and pull the trigger.`); ui();
  });
  function onCalPoint(m) {   // the controller tip on the point, from the Quest (rig space)
    const C = S.cal; if (!C) return false;
    if (C.wait === 'lens') { C.lens = m.p.slice(0, 3); afterLens(); return true; }   // #213
    if (C.wait !== 'touch') return false;
    if (C.auto) { const p = C.auto[C.i]; C.pix.push([p.x, p.y]); C.pts.push(m.p.slice(0, 3)); C.i++; askPoint(); return true; }
    C.pts.push(m.p.slice(0, 3)); C.wait = 'tap';
    const n = C.pts.length;
    say(n >= 4 ? `${n} marks. Tap mark ${n + 1}, or press Solve.` : `Mark ${n + 1}: tap it on the screen.`); ui();
    return true;
  }
  function calUndo() {
    const C = S.cal; if (!C) return;
    if (C.wait === 'lens') return;
    if (C.auto) { if (C.i > 0) { C.i--; C.pix.pop(); C.pts.pop(); askPoint(); } else askLens(); return; }
    if (!C.pix.length) { askLens(); return; }
    if (C.wait === 'touch') { C.pix.pop(); } else if (C.pts.length) { C.pts.pop(); C.pix.pop(); }
    C.wait = 'tap'; const l = link(); if (l) l.send('ctl', { k: 'cal', step: 'cancel' });
    clearMarks(); C.pix.forEach(([x, y], i) => markAt(x, y, i + 1));
    say(`Mark ${C.pix.length + 1}: tap it on the screen.`); ui();
  }
  function calCancel() {
    S.cal = null; tap.hidden = true; clearMarks(); mag.hidden = true; route(); const l = link(); if (l) l.send('ctl', { k: 'cal', step: 'cancel' });
    say(''); ui();
  }
  function calSolve() {
    const C = S.cal; if (!C || C.pts.length < 4) return;
    let pts = C.pts.slice(), pix = C.pix.slice(0, C.pts.length), dropped = 0;
    say('Solving…');
    let r = solvePose(pts, pix, S.vw, S.vh, C.lens);
    if (!r) { say('Could not solve: check the points are spread out and touched in the same order.'); return; }
    // #213 one bad touch (wrong corner, a point on something that moved) pulls the whole fit: with 6+ points, leave
    // each out in turn; if one stands out, drop it
    if (pts.length >= (C.lens ? 5 : 7) && r.rms > 2) {   // without the lens, 5-6 points always fit tighter with one left out: don't trust that
      let best = null, bi = -1;
      for (let i = 0; i < pts.length; i++) { const q = solvePose(pts.filter((_, j) => j !== i), pix.filter((_, j) => j !== i), S.vw, S.vh, C.lens); if (q && (!best || q.rms < best.rms)) { best = q; bi = i; } }
      if (best && best.rms < r.rms * 0.45) { dropped = bi + 1; pts = pts.filter((_, j) => j !== bi); pix = pix.filter((_, j) => j !== bi); r = best; }
    }
    S.pose = r.pose; S.err = r.rms; savePose();
    tap.hidden = true; S.cal = null; clearMarks(); mag.hidden = true; route();
    frame();
    // show where the solved camera puts each mark (green squares) against the taps (yellow rings)
    // #499 the picture is now the straightened one: move the raw taps / projections onto it
    const ud = r.pose.k ? undistPx(r.pose, S.vw, S.vh) : (q => q);
    pix.forEach((q, i) => { const [x, y] = ud(q); markAt(x, y, i + 1); }); r.proj.forEach(q => { const [x, y] = ud(q); markAt(x, y, '', true); });
    setTimeout(clearMarks, 8000);
    const px = Math.round(r.rms * 10) / 10, lensCm = C.lens ? Math.round(Math.hypot(...r.pose.p.map((v, k) => v - C.lens[k])) * 1000) / 10 : null;
    const l = link(); if (l) l.send('ctl', { k: 'cal', step: 'done', px });
    const weak = !C.lens && pts.length < 6;
    say(`Calibrated: points match within ${px} px` + (r.pose.k ? ` (lens correction k1 ${r.pose.k[0]})` : '') + (lensCm != null ? `, lens ${lensCm} cm from your touch` : '') + (dropped ? ` (point ${dropped} didn't fit and was left out)` : '')
      + (r.rms > 6 || (lensCm != null && lensCm > 4) ? '. High: redo; touch the exact corner of each point.' : weak ? '. Only ' + pts.length + ' points and no lens touch: check the blue outline in the headset sits on the phone, else redo with the lens touch.' : '. Fine-tune with Nudge if needed.'));
    { const keep = S.msg; setTimeout(() => { if (S.msg === keep) say(''); }, 12000); }   // #385 the box stayed for ever: it cleared only if there was no calibration
    ui();
  }

  // ---------------------------------------------------------------- manual nudges (camera's own axes)
  let coarse = false;
  function nudge(what) {
    const P = S.pose; if (!P) return;
    const d = coarse ? 0.05 : 0.01, a = (coarse ? 1 : 0.2) * DEG, fz = coarse ? 2 : 0.4;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(P.e[1], P.e[0], P.e[2], 'YXZ'));
    const move = v => { v.applyQuaternion(q); P.p = P.p.map((c, i) => +(c + v.getComponent(i)).toFixed(4)); };
    switch (what) {
      case 'x-': move(new THREE.Vector3(-d, 0, 0)); break; case 'x+': move(new THREE.Vector3(d, 0, 0)); break;
      case 'y+': P.p[1] = +(P.p[1] + d).toFixed(4); break; case 'y-': P.p[1] = +(P.p[1] - d).toFixed(4); break;
      case 'z-': move(new THREE.Vector3(0, 0, -d)); break; case 'z+': move(new THREE.Vector3(0, 0, d)); break;
      case 'yaw+': P.e[0] += a; break; case 'yaw-': P.e[0] -= a; break;
      case 'pitch+': P.e[1] += a; break; case 'pitch-': P.e[1] -= a; break;
      case 'roll+': P.e[2] += a; break; case 'roll-': P.e[2] -= a; break;
      case 'fov-': P.fov = Math.max(10, P.fov - fz); break; case 'fov+': P.fov = Math.min(120, P.fov + fz); break;
    }
    savePose(); ui();
  }
  for (const b of document.querySelectorAll('#fxNudge [data-n]')) {   // hold to repeat
    let t = null; const go = () => nudge(b.dataset.n);
    b.addEventListener('pointerdown', e => { e.preventDefault(); go(); t = setInterval(go, 120); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { clearInterval(t); t = null; });
  }
  function setCoarse(v) { coarse = !!v; $('#fxStep').textContent = coarse ? 'coarse' : 'fine'; }   // #217 also from the Quest
  $('#fxStep').onclick = () => setCoarse(!coarse);
  function resetView() { S.pose = defaultPose(); S.err = null; savePose(); route(); ui(); }
  $('#fxReset').onclick = resetView;

  // ---------------------------------------------------------------- exposure / focus / white balance
  async function setLock(on) {
    const c = S.caps || {}, adv = {};
    try { S.set = S.track.getSettings(); } catch {}
    if (on) {
      if (c.exposureMode && c.exposureMode.includes('manual')) { adv.exposureMode = 'manual'; if (S.set.exposureTime) adv.exposureTime = S.set.exposureTime; }
      if (c.focusMode && c.focusMode.includes('manual')) { adv.focusMode = 'manual'; if (S.set.focusDistance != null) adv.focusDistance = S.set.focusDistance; }
      if (c.whiteBalanceMode && c.whiteBalanceMode.includes('manual')) { adv.whiteBalanceMode = 'manual'; if (S.set.colorTemperature) adv.colorTemperature = S.set.colorTemperature; }
    } else {
      for (const k of ['exposureMode', 'focusMode', 'whiteBalanceMode']) if (c[k] && c[k].includes('continuous')) adv[k] = 'continuous';
    }
    if (!Object.keys(adv).length) { say('This camera does not let Chrome lock exposure / focus / white balance.'); setTimeout(() => say(''), 4000); return; }
    try { await S.track.applyConstraints({ advanced: [adv] }); S.lock = on; } catch (e) { say('Lock: ' + e.message); setTimeout(() => say(''), 4000); }
    ui();
  }
  async function expStep(dir) {
    const c = S.caps && S.caps.exposureCompensation; if (!c) { say('No exposure compensation on this camera in Chrome.'); setTimeout(() => say(''), 3000); return; }
    try { S.set = S.track.getSettings(); } catch {}
    const v = Math.min(c.max, Math.max(c.min, (S.set.exposureCompensation || 0) + dir * (c.step || 0.33)));
    try { await S.track.applyConstraints({ advanced: [{ exposureCompensation: v }] }); S.set.exposureCompensation = v; lowLight.ev = v; localStorage.setItem('vire.fixcam.low', JSON.stringify(lowLight)); } catch (e) { say('Exposure: ' + e.message); }   // #382 kept
    ui();
  }

  // #382 LOW LIGHT: 25 fps hold and exposure compensation, kept on this phone and set from the tablet (S8 STUDIO page)
  async function applyEv() {
    const c = S.caps && S.caps.exposureCompensation; if (!c || !S.track) return;
    const v = Math.min(c.max, Math.max(c.min, lowLight.ev));
    try { await S.track.applyConstraints({ advanced: [{ exposureCompensation: v }] }); S.set.exposureCompensation = v; } catch {}
  }
  async function setLowLight(o) {
    const fpsCh = o.fps25 != null && !!o.fps25 !== lowLight.fps25, evCh = o.ev != null && +o.ev !== lowLight.ev;
    if (o.fps25 != null) lowLight.fps25 = !!o.fps25; if (o.ev != null) lowLight.ev = +o.ev;
    try { localStorage.setItem('vire.fixcam.low', JSON.stringify(lowLight)); } catch {}
    if (fpsCh && S.on) { try { await open(S.facing); } catch (e) { say('Camera: ' + e.message); } }
    else if (evCh) await applyEv();
    ui();
  }
  function camInfo() {   // what the camera is really doing (for the tablet)
    let st = {}; try { st = S.track ? S.track.getSettings() : {}; } catch {}
    const c = S.caps && S.caps.exposureCompensation;
    return { fps: st.frameRate ? Math.round(st.frameRate) : null, ev: st.exposureCompensation != null ? +(+st.exposureCompensation).toFixed(2) : null, evMax: c ? c.max : null, w: st.width, h: st.height };
  }

  // ---------------------------------------------------------------- camera switch / swap test
  async function switchCam() { if (S.dev) { setDev(''); } try { await open(S.facing === 'user' ? 'environment' : 'user'); } catch (e) { say('Camera: ' + e.message); } }
  async function swapTest() {
    const from = S.facing, to = from === 'user' ? 'environment' : 'user';
    say('Timing the camera swap…');
    try { const a = await open(to), b = await open(from); S.swap = `${to === 'user' ? 'main→selfie' : 'selfie→main'} ${a} ms, back ${b} ms`; say('Swap: ' + S.swap); }
    catch (e) { say('Swap test: ' + e.message); }
    setTimeout(() => say(''), 6000); ui();
  }

  // ---------------------------------------------------------------- buttons / info
  $('#fxCal').onclick = calStart; $('#fxSolve').onclick = calSolve; $('#fxUndo').onclick = calUndo; $('#fxCancel').onclick = calCancel;
  $('#fxSkip').onclick = calSkip; $('#fxRescan').onclick = calRescan; $('#fxOwn').onclick = calOwn;
  $('#fxNud').onclick = () => { const n = $('#fxNudge'); n.hidden = !n.hidden; ui(); };
  $('#fxCamB').onclick = switchCam; $('#fxDev').onchange = e => pickDev(e.target.value); $('#fxLock').onclick = () => setLock(!S.lock);
  $('#fxEm').onclick = () => expStep(-1); $('#fxEp').onclick = () => expStep(1);
  $('#fxSwap').onclick = swapTest; $('#fxExit').onclick = stop;
  $('#fxHide').onclick = () => ov.classList.add('hide');
  tap.addEventListener('dblclick', () => ov.classList.remove('hide'));
  document.addEventListener('pointerdown', e => { if (S.on && ov.classList.contains('hide') && !S.cal) ov.classList.remove('hide'); });
  function ui() {
    const C = S.cal;
    $('#fxCal').hidden = !!C; for (const id of ['#fxSolve', '#fxUndo', '#fxCancel']) $(id).hidden = !C;
    $('#fxSkip').hidden = !(C && (C.auto || C.wait === 'lens')); $('#fxRescan').hidden = !C; $('#fxOwn').hidden = !(C && C.auto);
    $('#fxSkip').textContent = C && C.wait === 'lens' ? 'Skip lens' : 'Skip point';
    if (C) { $('#fxSolve').disabled = C.pts.length < 4; $('#fxUndo').disabled = !C.pix.length; }
    $('#fxNud').classList.toggle('on', !$('#fxNudge').hidden); $('#fxLock').classList.toggle('on', S.lock);
    $('#fxLock').textContent = S.lock ? 'Exposure locked' : 'Lock exposure';
    const c = S.caps || {}; $('#fxEm').disabled = $('#fxEp').disabled = !c.exposureCompensation;
  }
  function info(extra) {
    if (!S.on) return;
    const P = S.pose, ec = S.set && S.set.exposureCompensation;
    $('#fxInfo').textContent = `${S.dev ? devName() || 'camera' : S.facing === 'user' ? 'selfie' : 'main'} ${S.vw}x${S.vh}` + (P ? ` · zoom ${P.fov.toFixed(1)}°` : '') + (P && P.k ? ` · lens k1 ${P.k[0]}` + (U.on ? ' (corrected)' : '') : '') + (S.err != null ? ` · cal ${S.err.toFixed(1)} px` : ' · not calibrated')
      + (ec != null ? ` · exp ${ec > 0 ? '+' : ''}${(+ec).toFixed(1)}` : '') + (S.swap ? ` · swap ${S.swap}` : '') + (extra ? ' · ' + extra : '');
  }
  return { S, video, raw, start, stop, frame, camState, setLowLight, camInfo, lowLight, onCalPoint, nudge, setCoarse, resetView, calCancel, get coarse() { return coarse; }, calSkip, calStart, calRescan, detect, info, get on() { return S.on; } };
}

// ---------------------------------------------------------------- pose solve
// Pinhole camera, principal point at the image centre, square pixels. Unknowns: position (3), yaw / pitch / roll
// (Euler YXZ, camera looks down its -Z), focal length (as log), and #499 with enough points radial distortion k1, k2
// (pixel = centre + f * n * (1 + k1 r^2 + k2 r^4), n = X/-Z, Y/-Z). Levenberg-Marquardt on the pixel error, from many
// starting guesses round the marks; the best pinhole fit wins and is then refined with k1 / k2. pts: [[x,y,z]] rig
// space, pix: [[u,v]] video px. lens (optional, #213): the controller tip on the phone's lens, rig space: a soft prior
// on the camera position (weight LENS_W px per metre: 1 cm off costs like 6 px), so 4 points are enough.
// opts.dist: false = never solve k1 / k2.
const LENS_W = 600, K_W = 6;   // K_W: a gentle pull of k1 / k2 toward 0 (k1 0.3 costs ~2 px), so few points can't run off
export function solvePose(pts, pix, W, H, lens, opts = {}) {
  const N = pts.length; if (N < (lens ? 3 : 4)) return null;
  const DIST = opts.dist !== false && N >= (lens ? 6 : 7);
  const cx = W / 2, cy = H / 2;
  function project(x, P, out) {   // x = [px,py,pz,yaw,pitch,roll,logf(,k1,k2)]
    const [px, py, pz, yaw, pitch, roll, lf] = x, f = Math.exp(lf), k1 = x[7] || 0, k2 = x[8] || 0;
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    // R = Ry(yaw) * Rx(pitch) * Rz(roll); camera coords = R^T (P - C)
    const r00 = cyw * cr + syw * sp * sr, r01 = -cyw * sr + syw * sp * cr, r02 = syw * cp;
    const r10 = cp * sr, r11 = cp * cr, r12 = -sp;
    const r20 = -syw * cr + cyw * sp * sr, r21 = syw * sr + cyw * sp * cr, r22 = cyw * cp;
    const dx = P[0] - px, dy = P[1] - py, dz = P[2] - pz;
    const X = r00 * dx + r10 * dy + r20 * dz, Y = r01 * dx + r11 * dy + r21 * dz, Z = r02 * dx + r12 * dy + r22 * dz;
    if (Z > -0.05) { out[0] = 1e4; out[1] = 1e4; return false; }   // behind the camera
    const nx = X / -Z, ny = Y / -Z, r2 = nx * nx + ny * ny, d = 1 + k1 * r2 + k2 * r2 * r2;
    out[0] = cx + f * nx * d; out[1] = cy - f * ny * d; return true;
  }
  const o = [0, 0];
  function make(NP) {
    const NR = 2 * N + (lens ? 3 : 0) + (NP > 7 ? 2 : 0);
    function resid(x, r) {
      let s = 0; for (let i = 0; i < N; i++) { project(x, pts[i], o); r[2 * i] = o[0] - pix[i][0]; r[2 * i + 1] = o[1] - pix[i][1]; s += r[2 * i] ** 2 + r[2 * i + 1] ** 2; }
      let j = 2 * N;
      if (lens) for (let k = 0; k < 3; k++) { const v = (x[k] - lens[k]) * LENS_W; r[j++] = v; s += v * v; }
      if (NP > 7) for (let k = 7; k < 9; k++) { const v = x[k] * K_W; r[j++] = v; s += v * v; }
      return s;
    }
    function lm(x0) {
      let x = x0.slice(), r = new Float64Array(NR), r2 = new Float64Array(NR), cost = resid(x, r), lam = 1e-3;
      const J = Array.from({ length: NR }, () => new Float64Array(NP));
      for (let it = 0; it < 80; it++) {
        for (let j = 0; j < NP; j++) { const h = j < 3 ? 1e-4 : 1e-5, xs = x.slice(); xs[j] += h; resid(xs, r2); for (let i = 0; i < NR; i++) J[i][j] = (r2[i] - r[i]) / h; }
        const A = Array.from({ length: NP }, () => new Float64Array(NP)), g = new Float64Array(NP);
        for (let i = 0; i < NR; i++) for (let a = 0; a < NP; a++) { g[a] += J[i][a] * r[i]; for (let b = 0; b < NP; b++) A[a][b] += J[i][a] * J[i][b]; }
        let improved = false;
        for (let tries = 0; tries < 8 && !improved; tries++) {
          const M = A.map((row, a) => { const rr = Array.from(row); rr[a] *= 1 + lam; rr[a] += 1e-9; return rr; });
          const dx = solve7(M, Array.from(g, v => -v)); if (!dx) { lam *= 10; continue; }
          const xn = x.map((v, i) => v + dx[i]), cn = resid(xn, r2);
          if (cn < cost) { x = xn; cost = cn; r.set(r2); lam = Math.max(1e-7, lam / 3); improved = true; } else lam *= 10;
        }
        if (!improved || cost < 1e-6) break;
      }
      return { x, cost };
    }
    return { lm, resid, NR };
  }
  const S7 = make(7);
  // starting guesses: around the marks' centre, several directions, heights, distances and zooms
  const c = [0, 0, 0]; for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / N;
  let best = null;
  if (lens) for (const fovV of [35, 50, 65, 80]) for (const roll of [0, Math.PI / 2, -Math.PI / 2]) {   // camera at the lens, looking at the points
    const d = [c[0] - lens[0], c[1] - lens[1], c[2] - lens[2]], yaw = Math.atan2(-d[0], -d[2]), pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
    const r = S7.lm([lens[0], lens[1], lens[2], yaw, pitch, roll, Math.log((H / 2) / Math.tan(fovV * Math.PI / 360))]);
    if (!best || r.cost < best.cost) best = r;
  }
  else for (const dist of [1.2, 2.2, 3.5]) for (const elev of [10, 30, 55]) for (let az = 0; az < 360; az += 30) for (const fovV of [45, 70]) {
    const a = az * Math.PI / 180, e = elev * Math.PI / 180;
    const C = [c[0] + Math.sin(a) * Math.cos(e) * dist, c[1] + Math.sin(e) * dist, c[2] + Math.cos(a) * Math.cos(e) * dist];
    const d = [c[0] - C[0], c[1] - C[1], c[2] - C[2]], yaw = Math.atan2(-d[0], -d[2]), pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
    const f = (H / 2) / Math.tan(fovV * Math.PI / 360);
    const r = S7.lm([C[0], C[1], C[2], yaw, pitch, 0, Math.log(f)]);
    if (!best || r.cost < best.cost) best = r;
  }
  if (!best || !isFinite(best.cost)) return null;
  let x = best.x;
  const pixRms = xx => { let pc = 0; const rr = new Float64Array(2 * N + 5); (xx.length > 7 ? S9 : S7).resid(xx, rr); for (let i = 0; i < 2 * N; i++) pc += rr[i] * rr[i]; return Math.sqrt(pc / N); };
  const S9 = DIST ? make(9) : null;
  let k = null;
  if (DIST) {   // #499 refine with k1 / k2 from the pinhole fit; keep it only if sane and clearly better
    const r9 = S9.lm([...x, 0, 0]), x9 = r9.x;
    if (isFinite(r9.cost) && Math.abs(x9[7]) < 1 && Math.abs(x9[8]) < 1 && pixRms(x9) < pixRms(x) * 0.9) { x = x9; k = [+x9[7].toFixed(5), +x9[8].toFixed(5)]; }
  }
  const rms = pixRms(x), f = Math.exp(x[6]), fov = 2 * Math.atan((H / 2) / f) * 180 / Math.PI;
  if (rms > 500 || !(fov > 5 && fov < 150)) return null;
  // proj: where the solved camera puts each mark in the RAW picture (what the user tapped)
  const proj = pts.map(p => { const out = [0, 0]; project(x, p, out); return out; });
  const pose = { p: [x[0], x[1], x[2]].map(v => +v.toFixed(4)), e: [x[3], x[4], x[5]], fov: +fov.toFixed(3) };
  if (k) pose.k = k;
  return { pose, rms, proj };
}
// #499 raw (distorted) video px -> straightened px for a pose with k: invert r_d = r_u (1 + k1 r_u^2 + k2 r_u^4) by fixed point
export function undistPx(pose, W, H) {
  const f = (H / 2) / Math.tan(pose.fov * Math.PI / 360), k1 = pose.k[0], k2 = pose.k[1] || 0, cx = W / 2, cy = H / 2;
  return ([u, v]) => { const dx = (u - cx) / f, dy = (v - cy) / f; let x = dx, y = dy;
    for (let i = 0; i < 20; i++) { const r2 = x * x + y * y, d = 1 + k1 * r2 + k2 * r2 * r2; x = dx / d; y = dy / d; }
    return [cx + x * f, cy + y * f]; };
}
function solve7(A, b) {   // (any size) Gaussian elimination with partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    if (Math.abs(M[p][i]) < 1e-12) return null; [M[i], M[p]] = [M[p], M[i]];
    for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
}
