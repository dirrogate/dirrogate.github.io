// #208 Fixed camera mode (spectator phone, no AR). The phone stands on a tripod and never moves, so it needs no
// tracking: its normal camera (main or selfie) is the background, and the gear is drawn from one fixed camera pose
// in the Quest's rig space. The pose comes from a tap calibration (tap a floor mark on the screen, touch the same
// mark with the controller tip; 4 to 8 marks; the page solves position, direction and zoom), and manual nudge
// controls fine-tune it. Saved per camera (main / selfie). Also: exposure / focus / white-balance lock where the
// phone allows, and a test that times the main <-> selfie swap.
const DEG = Math.PI / 180;

export function makeFixedCam({ THREE, renderer, scene, camera, rig, room, getLink, onChange }) {
  const S = { on: false, facing: 'environment', stream: null, track: null, vw: 0, vh: 0, crop: null, pose: null, err: null,
    cal: null, caps: {}, set: {}, lock: false, msg: '', swap: '' };
  const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.autoplay = true;
  const tex = new THREE.VideoTexture(video); tex.colorSpace = THREE.SRGBColorSpace; tex.matrixAutoUpdate = true;
  const keyOf = f => 'vire.fixcam.' + (f === 'user' ? 'selfie' : 'main');
  const loadPose = f => { try { const p = JSON.parse(localStorage.getItem(keyOf(f))); if (p && p.p && p.e && p.fov) return p; } catch {} return null; };
  const savePose = () => { try { localStorage.setItem(keyOf(S.facing), JSON.stringify(S.pose)); } catch {} };
  let saved = null;   // scene state to restore on exit

  // ---------------------------------------------------------------- UI
  document.head.insertAdjacentHTML('beforeend', `<style>
    #fxO { position:fixed; inset:0; z-index:35; pointer-events:none; color:#e6e8ec; font:14px/1.4 system-ui,sans-serif; }
    #fxO .info { position:absolute; top:8px; left:8px; right:8px; font:12px/1.4 ui-monospace,monospace; background:rgba(14,16,22,.78); padding:6px 9px; border-radius:8px; }
    #fxO .hint { position:absolute; top:52px; left:50%; transform:translateX(-50%); background:rgba(14,16,22,.85); border:1px solid #39a8ff; padding:8px 12px; border-radius:8px; text-align:center; max-width:86%; font-weight:600; }
    #fxO .bar { position:absolute; left:8px; right:8px; bottom:12px; display:flex; flex-wrap:wrap; gap:6px; justify-content:center; pointer-events:auto; }
    #fxO button { font:600 14px system-ui,sans-serif; color:#e6e8ec; background:rgba(14,16,22,.8); border:1px solid #2e3850; border-radius:10px; padding:10px 11px; }
    #fxO button.on { border-color:#39a8ff; color:#fff; } #fxO button:disabled { opacity:.4; }
    #fxO .nudge { position:absolute; left:8px; right:8px; bottom:120px; background:rgba(14,16,22,.88); border:1px solid #2e3850; border-radius:12px; padding:8px; pointer-events:auto; display:grid; grid-template-columns:auto 1fr 1fr; gap:6px; align-items:center; }
    #fxO .nudge span { font-weight:600; font-size:13px; color:#8c96a8; padding-right:6px; }
    #fxO .nudge button { padding:9px 4px; }
    #fxTap { position:fixed; inset:0; z-index:34; pointer-events:auto; }
    .fxMark { position:fixed; z-index:36; width:22px; height:22px; margin:-11px 0 0 -11px; border:2px solid #ffd040; border-radius:50%; pointer-events:none; color:#ffd040; font:700 12px system-ui; text-align:center; line-height:18px; }
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
      <button id="fxCal">Calibrate (taps)</button><button id="fxSolve" hidden>Solve</button><button id="fxUndo" hidden>Undo mark</button><button id="fxCancel" hidden>Cancel</button>
      <button id="fxNud">Nudge</button><button id="fxCamB">Main camera</button><button id="fxLock">Lock exposure</button><button id="fxEm">Exp −</button><button id="fxEp">Exp +</button>
      <button id="fxSwap">Swap test</button><button id="fxHide">Hide UI</button><button id="fxExit">Exit</button>
    </div></div><div id="fxTap" hidden></div>`);
  const $ = s => document.querySelector(s), ov = $('#fxO'), tap = $('#fxTap'), hint = $('#fxHint');
  const say = t => { S.msg = t; hint.hidden = !t; hint.textContent = t || ''; };
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
    const want = exact => ({ audio: false, video: { facingMode: exact ? { exact: facing } : facing, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } });
    try { S.stream = await navigator.mediaDevices.getUserMedia(want(true)); }
    catch (e) { if (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError') throw e; S.stream = await navigator.mediaDevices.getUserMedia(want(false)); }   // a single camera (PC)
    S.track = S.stream.getVideoTracks()[0]; S.facing = facing;
    video.srcObject = S.stream; await video.play().catch(() => {});
    await new Promise(res => { if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => res()); else video.addEventListener('playing', res, { once: true }); setTimeout(res, 3000); });
    S.vw = video.videoWidth; S.vh = video.videoHeight;
    try { S.caps = S.track.getCapabilities ? S.track.getCapabilities() : {}; S.set = S.track.getSettings(); } catch { S.caps = {}; S.set = {}; }
    S.lock = false;
    S.pose = loadPose(facing) || S.pose || defaultPose();
    $('#fxCamB').textContent = facing === 'user' ? 'Selfie camera' : 'Main camera';
    ui();
    return Math.round(performance.now() - t0);
  }
  video.addEventListener('resize', () => { S.vw = video.videoWidth; S.vh = video.videoHeight; });
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
    return { p: S.pose.p, q: camera.quaternion.toArray().map(v => +v.toFixed(4)), fov: fovV, asp: c.w / c.h };
  }

  // ---------------------------------------------------------------- start / stop
  async function start(facing) {
    try { await open(facing); } catch (e) { return 'Camera: ' + e.message; }
    saved = { bg: scene.background, room: room.visible, env: scene.environmentIntensity, rp: rig.position.clone(), rr: rig.rotation.clone(), rv: rig.visible, fov: camera.fov, near: camera.near, far: camera.far };
    scene.background = tex; room.visible = false; scene.environmentIntensity = 0.6;
    rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.visible = true;   // fixed mode works in the Quest's rig space directly
    S.on = true; ov.hidden = false; ov.classList.remove('hide');
    say(S.pose && loadPose(facing) ? '' : 'Not calibrated yet: press Calibrate (taps).');
    onChange && onChange();
    return '';
  }
  function stop() {
    if (!S.on) return;
    S.on = false; ov.hidden = true; tap.hidden = true; clearMarks(); S.cal = null;
    if (S.stream) { for (const t of S.stream.getTracks()) t.stop(); S.stream = null; }
    if (saved) { scene.background = saved.bg; room.visible = saved.room; scene.environmentIntensity = saved.env; rig.position.copy(saved.rp); rig.rotation.copy(saved.rr); rig.visible = saved.rv;
      camera.clearViewOffset(); camera.fov = saved.fov; camera.near = saved.near; camera.far = saved.far; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
    onChange && onChange();
  }

  // ---------------------------------------------------------------- tap calibration
  function calStart() {
    if (!link()) { say('Connect to the Quest first (the controller touches the marks).'); return; }
    S.cal = { pix: [], pts: [], wait: 'tap' }; clearMarks(); tap.hidden = false; ui();
    say('Mark 1: tap it on the screen.');
  }
  tap.addEventListener('pointerdown', e => {
    const C = S.cal, c = S.crop; if (!C || C.wait !== 'tap' || !c) return;
    const vx = c.x + e.clientX / c.s, vy = c.y + e.clientY / c.s, n = C.pix.length + 1;
    C.pix.push([vx, vy]); markAt(vx, vy, n); C.wait = 'touch';
    const l = link(); if (l) l.send('ctl', { k: 'cal', step: 'pt', n });
    say(`Mark ${n}: now touch it with the controller tip and pull the trigger.`); ui();
  });
  function onCalPoint(m) {   // the controller tip on the mark, from the Quest (rig space)
    const C = S.cal; if (!C || C.wait !== 'touch') return false;
    C.pts.push(m.p.slice(0, 3)); C.wait = 'tap';
    const n = C.pts.length;
    say(n >= 4 ? `${n} marks. Tap mark ${n + 1}, or press Solve.` : `Mark ${n + 1}: tap it on the screen.`); ui();
    return true;
  }
  function calUndo() {
    const C = S.cal; if (!C) return;
    if (C.wait === 'touch') { C.pix.pop(); } else if (C.pts.length) { C.pts.pop(); C.pix.pop(); }
    C.wait = 'tap'; const l = link(); if (l) l.send('ctl', { k: 'cal', step: 'cancel' });
    clearMarks(); C.pix.forEach(([x, y], i) => markAt(x, y, i + 1));
    say(`Mark ${C.pix.length + 1}: tap it on the screen.`); ui();
  }
  function calCancel() {
    S.cal = null; tap.hidden = true; clearMarks(); const l = link(); if (l) l.send('ctl', { k: 'cal', step: 'cancel' });
    say(''); ui();
  }
  function calSolve() {
    const C = S.cal; if (!C || C.pts.length < 4) return;
    const pix = C.pix.slice(0, C.pts.length);
    const r = solvePose(C.pts, pix, S.vw, S.vh);
    if (!r) { say('Could not solve: check the marks are spread out and tapped in the same order.'); return; }
    S.pose = r.pose; S.err = r.rms; savePose();
    tap.hidden = true; S.cal = null; clearMarks();
    frame();
    // show where the solved camera puts each mark (green squares) against the taps (yellow rings)
    pix.forEach(([x, y], i) => markAt(x, y, i + 1)); r.proj.forEach(([x, y]) => markAt(x, y, '', true));
    setTimeout(clearMarks, 8000);
    const px = Math.round(r.rms * 10) / 10;
    const l = link(); if (l) l.send('ctl', { k: 'cal', step: 'done', px });
    say(`Calibrated: marks match within ${px} px` + (r.rms > 6 ? ' (high: redo, tap the mark centres exactly).' : '. Fine-tune with Nudge if needed.'));
    setTimeout(() => { if (!S.cal) say(''); }, 8000);
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
  $('#fxStep').onclick = () => { coarse = !coarse; $('#fxStep').textContent = coarse ? 'coarse' : 'fine'; };
  $('#fxReset').onclick = () => { S.pose = defaultPose(); savePose(); ui(); };

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
    try { await S.track.applyConstraints({ advanced: [{ exposureCompensation: v }] }); S.set.exposureCompensation = v; } catch (e) { say('Exposure: ' + e.message); }
    ui();
  }

  // ---------------------------------------------------------------- camera switch / swap test
  async function switchCam() { try { await open(S.facing === 'user' ? 'environment' : 'user'); } catch (e) { say('Camera: ' + e.message); } }
  async function swapTest() {
    const from = S.facing, to = from === 'user' ? 'environment' : 'user';
    say('Timing the camera swap…');
    try { const a = await open(to), b = await open(from); S.swap = `${to === 'user' ? 'main→selfie' : 'selfie→main'} ${a} ms, back ${b} ms`; say('Swap: ' + S.swap); }
    catch (e) { say('Swap test: ' + e.message); }
    setTimeout(() => say(''), 6000); ui();
  }

  // ---------------------------------------------------------------- buttons / info
  $('#fxCal').onclick = calStart; $('#fxSolve').onclick = calSolve; $('#fxUndo').onclick = calUndo; $('#fxCancel').onclick = calCancel;
  $('#fxNud').onclick = () => { const n = $('#fxNudge'); n.hidden = !n.hidden; ui(); };
  $('#fxCamB').onclick = switchCam; $('#fxLock').onclick = () => setLock(!S.lock);
  $('#fxEm').onclick = () => expStep(-1); $('#fxEp').onclick = () => expStep(1);
  $('#fxSwap').onclick = swapTest; $('#fxExit').onclick = stop;
  $('#fxHide').onclick = () => ov.classList.add('hide');
  tap.addEventListener('dblclick', () => ov.classList.remove('hide'));
  document.addEventListener('pointerdown', e => { if (S.on && ov.classList.contains('hide') && !S.cal) ov.classList.remove('hide'); });
  function ui() {
    const C = S.cal;
    $('#fxCal').hidden = !!C; for (const id of ['#fxSolve', '#fxUndo', '#fxCancel']) $(id).hidden = !C;
    if (C) { $('#fxSolve').disabled = C.pts.length < 4; $('#fxUndo').disabled = !C.pix.length; }
    $('#fxNud').classList.toggle('on', !$('#fxNudge').hidden); $('#fxLock').classList.toggle('on', S.lock);
    $('#fxLock').textContent = S.lock ? 'Exposure locked' : 'Lock exposure';
    const c = S.caps || {}; $('#fxEm').disabled = $('#fxEp').disabled = !c.exposureCompensation;
  }
  function info(extra) {
    if (!S.on) return;
    const P = S.pose, ec = S.set && S.set.exposureCompensation;
    $('#fxInfo').textContent = `${S.facing === 'user' ? 'selfie' : 'main'} ${S.vw}x${S.vh}` + (P ? ` · zoom ${P.fov.toFixed(1)}°` : '') + (S.err != null ? ` · cal ${S.err.toFixed(1)} px` : ' · not calibrated')
      + (ec != null ? ` · exp ${ec > 0 ? '+' : ''}${(+ec).toFixed(1)}` : '') + (S.swap ? ` · swap ${S.swap}` : '') + (extra ? ' · ' + extra : '');
  }
  return { S, start, stop, frame, camState, onCalPoint, info, get on() { return S.on; } };
}

// ---------------------------------------------------------------- pose solve
// Pinhole camera, principal point at the image centre, square pixels, no lens distortion. Unknowns: position (3),
// yaw / pitch / roll (Euler YXZ, camera looks down its -Z), focal length (as log). Levenberg-Marquardt on the pixel
// error, from many starting guesses round the marks; the best fit wins. pts: [[x,y,z]] rig space, pix: [[u,v]] video px.
export function solvePose(pts, pix, W, H) {
  const N = pts.length; if (N < 4) return null;
  const cx = W / 2, cy = H / 2;
  function project(x, P, out) {   // x = [px,py,pz,yaw,pitch,roll,logf]
    const [px, py, pz, yaw, pitch, roll, lf] = x, f = Math.exp(lf);
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    // R = Ry(yaw) * Rx(pitch) * Rz(roll); camera coords = R^T (P - C)
    const r00 = cyw * cr + syw * sp * sr, r01 = -cyw * sr + syw * sp * cr, r02 = syw * cp;
    const r10 = cp * sr, r11 = cp * cr, r12 = -sp;
    const r20 = -syw * cr + cyw * sp * sr, r21 = syw * sr + cyw * sp * cr, r22 = cyw * cp;
    const dx = P[0] - px, dy = P[1] - py, dz = P[2] - pz;
    const X = r00 * dx + r10 * dy + r20 * dz, Y = r01 * dx + r11 * dy + r21 * dz, Z = r02 * dx + r12 * dy + r22 * dz;
    if (Z > -0.05) { out[0] = 1e4; out[1] = 1e4; return false; }   // behind the camera
    out[0] = cx + f * X / -Z; out[1] = cy - f * Y / -Z; return true;
  }
  const o = [0, 0];
  function resid(x, r) { let s = 0; for (let i = 0; i < N; i++) { project(x, pts[i], o); r[2 * i] = o[0] - pix[i][0]; r[2 * i + 1] = o[1] - pix[i][1]; s += r[2 * i] ** 2 + r[2 * i + 1] ** 2; } return s; }
  function lm(x0) {
    let x = x0.slice(), r = new Float64Array(2 * N), r2 = new Float64Array(2 * N), cost = resid(x, r), lam = 1e-3;
    const J = Array.from({ length: 2 * N }, () => new Float64Array(7));
    for (let it = 0; it < 60; it++) {
      for (let j = 0; j < 7; j++) { const h = j < 3 ? 1e-4 : 1e-5, xs = x.slice(); xs[j] += h; resid(xs, r2); for (let i = 0; i < 2 * N; i++) J[i][j] = (r2[i] - r[i]) / h; }
      const A = Array.from({ length: 7 }, () => new Float64Array(7)), g = new Float64Array(7);
      for (let i = 0; i < 2 * N; i++) for (let a = 0; a < 7; a++) { g[a] += J[i][a] * r[i]; for (let b = 0; b < 7; b++) A[a][b] += J[i][a] * J[i][b]; }
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
  // starting guesses: around the marks' centre, several directions, heights, distances and zooms
  const c = [0, 0, 0]; for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / N;
  let best = null;
  for (const dist of [1.2, 2.2, 3.5]) for (const elev of [10, 30, 55]) for (let az = 0; az < 360; az += 30) for (const fovV of [45, 70]) {
    const a = az * Math.PI / 180, e = elev * Math.PI / 180;
    const C = [c[0] + Math.sin(a) * Math.cos(e) * dist, c[1] + Math.sin(e) * dist, c[2] + Math.cos(a) * Math.cos(e) * dist];
    const d = [c[0] - C[0], c[1] - C[1], c[2] - C[2]], yaw = Math.atan2(-d[0], -d[2]), pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
    const f = (H / 2) / Math.tan(fovV * Math.PI / 360);
    const r = lm([C[0], C[1], C[2], yaw, pitch, 0, Math.log(f)]);
    if (!best || r.cost < best.cost) best = r;
  }
  if (!best || !isFinite(best.cost)) return null;
  const x = best.x, rms = Math.sqrt(best.cost / N), f = Math.exp(x[6]), fov = 2 * Math.atan((H / 2) / f) * 180 / Math.PI;
  if (rms > 500 || !(fov > 5 && fov < 150)) return null;
  const proj = pts.map(p => { const out = [0, 0]; project(x, p, out); return out; });
  return { pose: { p: [x[0], x[1], x[2]].map(v => +v.toFixed(4)), e: [x[3], x[4], x[5]], fov: +fov.toFixed(3) }, rms, proj };
}
function solve7(A, b) {   // Gaussian elimination with partial pivoting
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
