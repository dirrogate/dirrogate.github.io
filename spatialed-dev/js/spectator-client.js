// Spectator phone (CLAUDE.md #158, #160, #161). main.js builds the full Cly3DJ scene in camera role (no audio,
// no library, no input) and hands it here. This module: joins the Quest by code, runs Chrome AR, places the
// DJ rig on the phone's floor (Calibrate / Fix / Rough place), and mirrors the Quest: every moving part of the
// gear (interpolated ~70 ms behind so 30 Hz updates look smooth), the records (built here from the groove
// envelope and label the Quest sends once), and depth-only shapes at the DJ's hands so the real hands show in
// front of the virtual gear.
import { spectatorLink } from './net-link.js';
import { DeckVideo, vvKey, baseName, VIDEO_EXT } from './videovinyl.js';
import { makeVirtualSet } from './vset.js';
import { makeLookMatch } from './lookmatch.js';
import { makeFixLook } from './fixlook.js';
import { makePhoneLibrary } from './phonelib.js';
import { makeFixedCam } from './fixedcam.js';
import * as media from './medialib.js';
import { makePhoneHands } from './phonehands.js';   // #288

export function startCamera(ctx) {
  const { THREE, renderer, scene, camera, rig, room, stage, deckInst, neon, newMilk, stepWallGlow, stepBlobs, Record3D, BG, led, scroller, skybox, envLight, key } = ctx;
  const vs = makeVirtualSet({ THREE, renderer, scene, skybox, envLight, key });   // #184 live green-screen key
  const look = makeLookMatch({ THREE, renderer, scene, rig, key }); vs.setLook(look);   // #187 Look match
  // #185 media library (phone side); its Video + Images items also feed the LED wall / VideoVinyl mirrors
  const lib = makePhoneLibrary({ getLink: () => link, onChange: () => refreshMedia() });
  let pickedLed = [], mediaLed = [];
  let libVV = new Map();   // #206 title key -> name of a Library Video clip (VideoVinyl by title, e.g. clips synced from the Quest)
  async function refreshMedia() {
    const vids = await media.list('Video'), its = [...vids, ...await media.list('Images')];
    mediaLed = (await Promise.all(its.map(i => media.getFile(i.folder, i.name)))).filter(Boolean); led.setFiles([...pickedLed, ...mediaLed], 1000);
    libVV = new Map(vids.filter(i => VIDEO_EXT.test(i.name)).map(i => [vvKey(baseName(i.name)), i.name]));
  }
  refreshMedia(); media.dropTakes();   // #205
  // #206 media sync: the Quest lists both libraries ('mls?'), asks for phone files ('mpull', sent by phonelib) and sends
  // its own ('qput', then chunks on the 'file' channel, resumable like #185). Only adds, never deletes.
  async function sendMediaList() { const all = await media.listAll(), items = []; for (const f of media.FOLDERS) for (const it of all[f]) items.push([f, it.name, it.size]); if (link && link.isOpen) link.send('ctl', { k: 'mls', items }); }
  let qrx = null, qQ = Promise.resolve();
  function onQput(m) {
    qQ = qQ.then(async () => {
      if (qrx) { await qrx.abort(); qrx = null; }
      const r = await media.beginReceive(m.f, m.n, m.size);
      if (r.have) { link.send('ctl', { k: 'qok', f: m.f, n: m.n }); return; }
      if (m.thumb) { try { await media.putThumb(m.f, m.n, new Blob([Uint8Array.from(atob(m.thumb), c => c.charCodeAt(0))], { type: 'image/jpeg' })); } catch {} }
      qrx = r.rx; qrx.req = m.n; st(`Sync: receiving ${m.n}…`);
      link.send('ctl', { k: 'qgo', f: m.f, n: m.n, off: r.off });
    }).catch(e => st('Sync: ' + e.message));
  }
  function onSyncBin(buf, label) {
    if (label !== 'file') return;
    const r = qrx; if (!r) return;
    if (r.write(buf)) {
      qrx = null;
      r.finish().then(() => { link.send('ctl', { k: 'qok', f: r.folder, n: r.req }); st(`Sync: ${r.req} received.`); refreshMedia(); lib.refresh(); })
        .catch(e => st('Sync: saving failed: ' + e.message));
    }
  }
  const DELAY = 70;   // ms the mirror runs behind the Quest, so there are always two samples to blend
  // ---------------------------------------------------------------- UI (built here; index.html's own UI is hidden)
  document.head.insertAdjacentHTML('beforeend', `<style>
    #spS { position:fixed; inset:0; overflow:auto; z-index:30; background:radial-gradient(ellipse at 50% 30%,#182030 0%,#0b0d12 75%); color:#e6e8ec; font:15px/1.45 system-ui,sans-serif; }
    #spS .box { max-width:460px; margin:0 auto; padding:24px 16px; }
    #spS h1 { font-size:34px; margin:0 0 2px; font-weight:800; letter-spacing:.04em; } #spS h1 span { color:#e0202a; letter-spacing:-.01em; }
    #spS p { color:#8b909a; margin:0 0 18px; }
    #spS input { font:600 28px system-ui,sans-serif; letter-spacing:.2em; width:100%; box-sizing:border-box; padding:12px; border-radius:10px; border:1px solid #2e3850; background:#1c2230; color:#e6e8ec; text-align:center; }
    #spS button, #spO button { font:600 15px system-ui,sans-serif; color:#e6e8ec; background:#1c2230; border:1px solid #2e3850; border-radius:10px; padding:12px 16px; }
    #spS button { width:100%; margin-top:12px; font-size:17px; padding:14px; } #spS button:disabled { opacity:.4; }
    #spSt { margin-top:14px; color:#8b909a; min-height:1.4em; }
    #spO { position:fixed; inset:0; pointer-events:none; color:#e6e8ec; font:14px/1.4 system-ui,sans-serif; }
    #spO .bar { position:absolute; left:8px; right:8px; bottom:12px; display:flex; flex-wrap:wrap; gap:6px; justify-content:center; pointer-events:auto; }
    #spO .bar button { padding:10px 11px; background:rgba(14,16,22,.78); } #spO .bar button.on { border-color:#39a8ff; color:#fff; }
    #spO .info { position:absolute; top:8px; left:8px; right:8px; font:12px/1.4 ui-monospace,monospace; background:rgba(14,16,22,.78); padding:6px 9px; border-radius:8px; }
    #spO .hint { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); background:rgba(14,16,22,.82); padding:8px 12px; border-radius:8px; text-align:center; max-width:80%; }
    #spO .hint.go { border:1px solid #39a8ff; font-weight:600; }
    #spO.hide .bar, #spO.hide .info, #spO.hide .hint, #spO.hide .kp { display:none; }
    #spO .kp { position:absolute; left:8px; right:8px; bottom:120px; background:rgba(14,16,22,.85); border:1px solid #2e3850; border-radius:12px; padding:10px 12px; color:#e6e8ec; font:600 14px system-ui,sans-serif; pointer-events:auto; }
    #spO .kp label { display:flex; align-items:center; gap:10px; margin:6px 0; } #spO .kp input[type=range] { flex:1; } #spO .kp span { width:44px; text-align:right; }
  </style>`);
  document.body.insertAdjacentHTML('beforeend', `
    <div id="spS"><div class="box">
      <h1>Cly<span>3DJ</span> camera</h1>
      <p>Films the DJ with the virtual gear. On the Quest: Settings, Spectator camera On, then read the code shown there.</p>
      <input id="spCode" inputmode="numeric" maxlength="5" placeholder="00000">
      <button id="spConnect">Connect</button><button id="spAR" disabled>Start camera (AR)</button><button id="spFix" disabled>Fixed camera: tripod, no AR</button>
      <label style="display:flex;gap:8px;align-items:center;margin-top:8px;color:#8b909a;font-size:14px">Fixed camera uses <select id="spFixCam" style="font:600 14px system-ui;background:#1c2230;color:#e6e8ec;border:1px solid #2e3850;border-radius:8px;padding:6px"><option value="environment">main camera</option><option value="user">selfie camera</option></select></label><button id="spCamTest">Camera access test (no Quest needed)</button>
      <button id="spLibBtn">Library: panoramas, videos, images (push to the Quest)…</button>
      <button id="spPano">Virtual set panorama (same picture as the Quest)…</button><input type="file" id="spPanoF" accept="image/*" hidden>
      <div id="spPanoSt" style="color:#8b909a;font-size:13px;margin-top:6px">For the green-screen virtual set: pick the same 360 picture the Quest shows. Kept on this phone.</div>
      <button id="spLed">Videos: LED wall clips + VideoVinyls (same files as the Quest)…</button><input type="file" id="spLedF" accept="video/*" multiple hidden>
      <div id="spLedList" style="color:#8b909a;font-size:13px;margin-top:6px">Optional: pick the same videos as on the Quest so the LED wall plays here too.</div>
      <div id="spSt"></div></div></div>
    <div id="spO" hidden>
      <div class="info" id="spInfo">…</div>
      <div class="hint" id="spHint"></div>
      <div class="kp" id="spLook" hidden>
        <label><input type="checkbox" id="lkOn"> Look match: the gear follows the camera</label>
        <label>Strength <input type="range" id="lkStr" min="0" max="1" step="0.05"><span id="lkStrV"></span></label>
        <label>Grain <input type="range" id="lkGrain" min="0" max="1" step="0.05"><span id="lkGrainV"></span></label>
        <label><input type="checkbox" id="lkRoom"> Room light (the phone measures the real room's light)</label>
        <div id="lkSt" style="font-weight:500;font-size:12px;color:#8b909a"></div>
      </div>
      <div class="kp" id="spKey" hidden>
        <label><button id="kAuto">Auto</button><span id="kAutoSt" style="width:auto;flex:1;text-align:left;font-weight:500;font-size:12px;color:#8b909a">Point at the EMPTY green screen first</span></label>
        <label>Strength <input type="range" id="kThr" min="0" max="0.8" step="0.005"><span id="kThrV"></span></label>
        <label>Softness <input type="range" id="kSoft" min="0.02" max="0.4" step="0.005"><span id="kSoftV"></span></label>
        <label>Spill <input type="range" id="kSpill" min="0" max="1" step="0.05"><span id="kSpillV"></span></label>
        <label>Light wrap <input type="range" id="kWrap" min="0" max="1" step="0.05"><span id="kWrapV"></span></label>
        <label>Colour match <input type="range" id="kCm" min="0" max="1" step="0.05"><span id="kCmV"></span></label>
        <label><input type="checkbox" id="kMatte"> Show matte (white = kept, black = keyed)</label>
      </div>
      <div class="bar" id="spBar">
        <button id="bCal">Calibrate</button><button id="bFix">Fix (tap X)</button><button id="bL">⟲ 1°</button><button id="bR">1° ⟳</button>
        <button id="bPlace">Rough place</button><button id="bMark">Head</button><button id="bHands">Hands</button><button id="bSet">Set</button><button id="bKey">Key</button><button id="bLook">Look</button><button id="bHide">Hide UI</button><button id="bExit">Exit</button>
      </div></div>`);
  const $ = s => document.querySelector(s);
  const ov = $('#spO'), hint = $('#spHint');

  // ---------------------------------------------------------------- link
  let link = null, linkState = '';
  const stats = { rtt: 0, off: null, pkts: 0, pps: 0, age: 0, last: 0, xr: 0 };
  try { $('#spCode').value = localStorage.getItem('sed.spectJoin') || ''; } catch {}
  const st = t => { $('#spSt').textContent = t; };
  const STATUS = { relay: 'Relay reached, calling the Quest…', 'relay-retry': 'No internet for the handshake, retrying…', 'quest-offline': 'Quest not found: is its Spectator camera On, same code?',
    connecting: 'Connecting to the Quest…', connected: 'Connected to the Quest', disconnected: 'Link lost', failed: 'Link failed (are both on the same Wi-Fi?)' };
  $('#spConnect').onclick = () => {
    const code = $('#spCode').value.trim();
    if (!/^\d{5}$/.test(code)) { st('Enter the 5-digit code from the Quest'); return; }
    try { localStorage.setItem('sed.spectJoin', code); } catch {}
    if (link) link.close();
    st('Reaching the relay…');
    link = spectatorLink(code, {
      onStatus: s => { linkState = s; st(STATUS[s] || s); },
      onState: s => { linkState = s; st(STATUS[s] || s); },
      onOpen: () => { linkState = 'connected'; st(STATUS.connected); $('#spAR').disabled = false; $('#spFix').disabled = false; lib.onLinkOpen(); sendCst(true); },
      onClose: () => { linkState = 'disconnected'; st(STATUS.disconnected); if (liveOn) { liveOn = false; liveStop(); showLiveCard(false); } },
      onMessage: onMsg,
      onBinary: onSyncBin,   // #206 media sync: files from the Quest
    });
  };
  setInterval(() => { if (link && link.isOpen) link.send('ctl', { k: 'ping', t: performance.now() }); stats.pps = stats.pkts; stats.pkts = 0; }, 1000);
  const questNow = () => performance.now() + (stats.off || 0);
  // #177 VideoVinyl on the phone: its own copies of the videos, following the Quest's playheads
  let vvFiles = new Map(), vvMode = 'off', vvGains = [0, 0];
  const pdv = [new DeckVideo(), new DeckVideo()], pdvAt = [null, null];
  function onVV(V) {
    const prev = vvMode; vvMode = V.mode; vvGains = V.gains;
    for (let i = 0; i < 2; i++) {
      const e = V.decks.find(x => x[0] === i), want = e ? e[1] : null, dv = pdv[i];
      if (want !== dv.want) {
        dv.want = want; dv.close();
        if (want && want.startsWith('media:')) media.getFile('Video', want.slice(12)).then(f => { if (f && dv.want === want) dv.open(want, f); });   // #185 'media:Video/<name>'
        else if (want && vvFiles.get(want)) dv.open(want, vvFiles.get(want));
        else if (want && libVV.get(want)) media.getFile('Video', libVV.get(want)).then(f => { if (f && dv.want === want) dv.open(want, f); });   // #206
      }
      pdvAt[i] = e ? { pos: e[2], rate: e[3], at: performance.now() } : null;
    }
    if (prev === 'decks' && vvMode !== 'decks' && !led.on) led.wall.userData.setVideo(null);
  }
  function vvFrame(now) {
    for (let i = 0; i < 2; i++) { const a = pdvAt[i]; if (a && pdv[i].v) pdv[i].follow(a.pos + a.rate * (now - a.at) / 1000, a.rate, now); }
    if (vvMode === 'decks') led.wall.userData.setDecks(pdv[0].tex, pdv[1].tex, vvGains[0], vvGains[1]);
  }
  $('#spLed').onclick = () => $('#spLedF').click();
  // #184 virtual set: panorama picked here (same file as the Quest), key sliders in the AR overlay
  $('#spLibBtn').onclick = () => lib.open();   // #195: was id spLib, the same id as the Library screen, so the screen's full-page style covered the start page
  $('#spPano').onclick = () => $('#spPanoF').click();
  $('#spPanoF').onchange = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return; e.target.value = '';
    $('#spPanoSt').textContent = 'Loading ' + f.name + '…';
    try { await vs.pick(f); $('#spPanoSt').textContent = f.name + (vs.sameAsQuest() ? '' : ' (not the Quest\'s current picture)') + ': ready for the virtual set.'; }
    catch (err) { $('#spPanoSt').textContent = 'Could not use it: ' + err.message; }
  };
  for (const [id, k] of [['#kThr', 'thr'], ['#kSoft', 'soft'], ['#kSpill', 'spill'], ['#kWrap', 'wrap'], ['#kCm', 'cmatch']]) {
    const el = $(id), v = $(id + 'V'); el.value = vs.K[k]; v.textContent = (+vs.K[k]).toFixed(2);
    el.oninput = () => { vs.setKey(k, +el.value); v.textContent = (+el.value).toFixed(2); sendCst(); };
  }
  let matteOn = false, autoMsg = '';
  $('#kMatte').onchange = e => { matteOn = e.target.checked; vs.setMatte(matteOn); };
  // #187 Look panel
  $('#lkOn').checked = look.L.on; $('#lkRoom').checked = look.L.room;
  $('#lkOn').onchange = e => { look.set('on', e.target.checked); sendCst(); };
  $('#lkRoom').onchange = e => { look.set('room', e.target.checked); sendCst(); };
  for (const [id, k] of [['#lkStr', 'strength'], ['#lkGrain', 'grain']]) {
    const el = $(id), v = $(id + 'V'); el.value = look.L[k]; v.textContent = Math.round(look.L[k] * 100) + '%';
    el.oninput = () => { look.set(k, +el.value); v.textContent = Math.round(+el.value * 100) + '%'; sendCst(); };
  }
  const syncKeyUI = () => { for (const [id, k] of [['#kThr', 'thr'], ['#kSoft', 'soft'], ['#kSpill', 'spill'], ['#kWrap', 'wrap'], ['#kCm', 'cmatch']]) { $(id).value = vs.K[k]; $(id + 'V').textContent = (+vs.K[k]).toFixed(2); } };
  const syncLookUI = () => {
    $('#lkOn').checked = look.L.on; $('#lkRoom').checked = look.L.room;
    for (const [id, k] of [['#lkStr', 'strength'], ['#lkGrain', 'grain']]) { $(id).value = look.L[k]; $(id + 'V').textContent = Math.round(look.L[k] * 100) + '%'; }
  };
  async function runAuto() {
    $('#kAutoSt').textContent = autoMsg = 'Measuring…'; sendCst(true);
    try { const r = await vs.autoKey(); syncKeyUI(); $('#kAutoSt').textContent = `Done: green fills ${r.cover} % of the view. Now step in; check with Show matte.`; autoMsg = `Auto done: green ${r.cover} % of the view`; }
    catch (e) { $('#kAutoSt').textContent = autoMsg = 'Auto: ' + e.message; }
    sendCst(true);
  }
  $('#kAuto').onclick = runAuto;   // #186
  // ---- #188 the Quest's mixer CAMERA tab: the phone reports its state ('cst') and takes changes ('cset')
  let lastCst = '', fps = 0, fpsN = 0, fpsT = 0, late = 0, lateN = 0, lastXT = 0; const dts = [];
  function sendCst(force) {
    if (!link || !link.isOpen) return;
    const m = { k: 'cst', set: vs.S.on, can: vs.S.can, ar: !!renderer.xr.getSession() || fixed.on, cal: cal.ok || !!(fixed.on && fixed.S.err != null), fixed: fixed.on, fcam: fixed.on ? fixed.S.facing : null, fpx: fixed.on && fixed.S.err != null ? +fixed.S.err.toFixed(1) : null, fcal: fixed.on && !!fixed.S.cal, K: { ...vs.K }, L: { ...look.L }, matte: matteOn, pv: pvOn, fps, late, auto: autoMsg, look: look.status(), FL: flook.state(), flErr, FX: fixed.on && fixed.S.pose ? { fov: +fixed.S.pose.fov.toFixed(1), coarse: fixed.coarse, cal: !!fixed.S.cal } : null };
    const j = JSON.stringify(m); if (force || j !== lastCst) { lastCst = j; link.send('ctl', m); }
  }
  const LIM = { thr: [0, 0.8], soft: [0.02, 0.4], spill: [0, 1], wrap: [0, 1], cmatch: [0, 1], strength: [0, 1], grain: [0, 1] };
  const lim = (k, v) => Math.min(LIM[k][1], Math.max(LIM[k][0], +v));
  async function onCset(m) {
    if (m.what === 'set') await toggleSet(!!m.v);
    else if (m.what === 'key') { vs.setKey(m.key, lim(m.key, m.v)); syncKeyUI(); }
    else if (m.what === 'look') { look.set(m.key, typeof m.v === 'boolean' ? m.v : lim(m.key, m.v)); syncLookUI(); }
    else if (m.what === 'matte') { matteOn = !!m.v; vs.setMatte(matteOn); $('#kMatte').checked = matteOn; }
    else if (m.what === 'auto') { await runAuto(); return; }
    else if (m.what === 'preview') pvOn = !!m.v;
    else if (m.what === 'flook') { flErr = flook.set(m.key, m.v) || ''; }   // #214
    else if (m.what === 'fnudge' && fixed.on) {   // #217 fixed camera nudges / calibrate from the Quest's LOOK tab
      if (m.key === 'coarse') fixed.setCoarse(m.v); else if (m.key === 'reset') fixed.resetView();
      else if (m.key === 'cal') { if (fixed.S.cal) fixed.calCancel(); else fixed.calStart(); } else fixed.nudge(m.key);
    }
    sendCst(true);
  }
  // ---- #188 headset preview: every ~150 ms a 480 px tall copy of what this phone shows, as a JPEG on the 'prev' channel
  // (#205: back to this, the #203 in-app recorder and its compose() are gone. It runs after the AR frame; #204 keeps
  // that frame on screen. Held on its side, the picture is turned upright before it is sent.)
  let pvOn = false, pvT = 0, pvBusy = false, rotDir = 0;   // rotDir: 0 = phone upright, 1 = its right edge up, -1 = its left edge up
  const pvRT = new THREE.WebGLRenderTarget(4, 4); pvRT.texture.colorSpace = THREE.SRGBColorSpace;   // sRGB storage: the GPU encodes on write, readPixels gives display bytes
  const pvCam = new THREE.PerspectiveCamera(); pvCam.matrixAutoUpdate = false;
  const pvCanvas = document.createElement('canvas'), pvCtx = pvCanvas.getContext('2d');
  const pvTurn = document.createElement('canvas'), pvTurnCtx = pvTurn.getContext('2d');
  let pvBuf = null;
  function renderPreview(now) {
    pvT = now; if (pvBusy) return;
    const xc = renderer.xr.getCamera(), c0 = xc && xc.cameras && xc.cameras[0]; if (!c0) return;
    const P = c0.projectionMatrix.elements, H = 480, W = Math.max(64, Math.round(H * P[5] / P[0] / 2) * 2);
    if (pvRT.width !== W || pvRT.height !== H) { pvRT.setSize(W, H); pvCanvas.width = W; pvCanvas.height = H; pvBuf = new Uint8Array(W * H * 4); }
    pvCam.projectionMatrix.copy(c0.projectionMatrix); pvCam.projectionMatrixInverse.copy(c0.projectionMatrixInverse);
    pvCam.matrixWorld.copy(c0.matrixWorld); pvCam.matrixWorldInverse.copy(c0.matrixWorldInverse); pvCam.layers.mask = c0.layers.mask;
    const raw = !vs.S.on && vs.S.pvReady, qv = vs.quad.visible, rv = reticle.visible, xv = xMark.visible;
    if (raw) { vs.quad.visible = true; vs.mat.uniforms.raw.value = 1; }
    reticle.visible = xMark.visible = false;
    renderer.xr.enabled = false; renderer.setRenderTarget(pvRT); renderer.clear(); renderer.render(scene, pvCam); renderer.setRenderTarget(null); renderer.xr.enabled = true;
    vs.quad.visible = qv; vs.mat.uniforms.raw.value = 0; reticle.visible = rv; xMark.visible = xv;
    renderer.readRenderTargetPixels(pvRT, 0, 0, W, H, pvBuf);
    const img = pvCtx.createImageData(W, H), row = W * 4;
    for (let y = 0; y < H; y++) { img.data.set(pvBuf.subarray((H - 1 - y) * row, (H - y) * row), y * row); }
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    pvCtx.putImageData(img, 0, 0); pvBusy = true;
    // #205 which edge of the phone is up (dead zone so it doesn't flip at 45 deg); on its side = turn the picture upright
    const m = c0.matrixWorld.elements, a = Math.atan2(m[1], m[5]) * 180 / Math.PI;
    rotDir = rotDir === 0 ? (a > 55 ? 1 : a < -55 ? -1 : 0) : rotDir === 1 ? (a < 35 ? (a < -55 ? -1 : 0) : 1) : (a > -35 ? (a > 55 ? 1 : 0) : -1);
    let out = pvCanvas;
    if (rotDir) {
      if (pvTurn.width !== H || pvTurn.height !== W) { pvTurn.width = H; pvTurn.height = W; }
      const g = pvTurnCtx; g.setTransform(1, 0, 0, 1, 0, 0);
      if (rotDir === 1) { g.translate(0, W); g.rotate(-Math.PI / 2); } else { g.translate(H, 0); g.rotate(Math.PI / 2); }
      g.drawImage(pvCanvas, 0, 0); g.setTransform(1, 0, 0, 1, 0, 0); out = pvTurn;
    }
    out.toBlob(b => { if (!b) { pvBusy = false; return; } b.arrayBuffer().then(buf => { if (link) link.sendPrev(buf); pvBusy = false; }); }, 'image/jpeg', 0.6);
  }
  // #208 fixed camera mode (tripod, no AR): fixedcam.js
  const fixed = makeFixedCam({ THREE, renderer, scene, camera, rig, room, getLink: () => link,
    onChange: () => { $('#spS').style.display = fixed.on ? 'none' : ''; sendCst(true); } });
  // #214 look without AR (fixed mode): camera grade from the video, 360 photo as light, manual key light; set from the Quest's LOOK tab
  const flook = makeFixLook({ THREE, scene, key, envLight, look, getVideo: () => fixed.video });
  flook.onChange = () => sendCst(true);
  if (ctx.crateRemote) ctx.crateRemote.setAsk(key => { if (link && link.isOpen) link.send('ctl', { k: 'cover?', key }); });   // #218 covers from the Quest
  let flErr = '';
  $('#spFix').onclick = async () => { const err = await fixed.start($('#spFixCam').value); if (err) st(err); };
  function fixedPreview(now) {   // the program picture (the canvas just drawn), 480 px on its long side, as a JPEG
    pvT = now; if (pvBusy) return;
    const c = renderer.domElement, k = 480 / Math.max(c.width, c.height), W = Math.round(c.width * k / 2) * 2, H = Math.round(c.height * k / 2) * 2;
    if (pvCanvas.width !== W || pvCanvas.height !== H) { pvCanvas.width = W; pvCanvas.height = H; }
    pvCtx.drawImage(c, 0, 0, W, H); pvBusy = true;
    pvCanvas.toBlob(b => { if (!b) { pvBusy = false; return; } b.arrayBuffer().then(buf => { if (link) link.sendPrev(buf); pvBusy = false; }); }, 'image/jpeg', 0.6);
  }
  // ---- #238 LIVE CAM: this phone's composite (camera + gear) as live video to the Quest's LED wall. The Quest asks
  // ({k:'live'}); the picture goes on the link's video slot (2 Mbit/s cap, lowest priority, net-link.js). Fixed mode:
  // the screen canvas scaled to 854 px on its long side, 30 fps. AR mode: the AR view rendered again at 480 px tall
  // (like the preview) with a non-blocking GPU read-back, 20 fps, turned upright when the phone is on its side.
  // This phone's own LED wall shows a Cly3DJ LIVE card meanwhile (the scroller still runs over it): no video tunnel.
  // #239 SOLO: the camera picture only (no gear): fixed mode draws the camera video itself, AR mode renders only the
  // camera quad (layer 30), so it is cheaper than LIVE.
  let liveOn = false, liveSolo = false, liveT = 0, liveBusy = false, liveTrack = null, liveBuf = null, liveCard = null;
  vs.quad.layers.enable(30);
  const liveRT = new THREE.WebGLRenderTarget(4, 4); liveRT.texture.colorSpace = THREE.SRGBColorSpace;
  const liveRaw = document.createElement('canvas'), liveRawCtx = liveRaw.getContext('2d');
  const liveOut = document.createElement('canvas'), liveOutCtx = liveOut.getContext('2d'); liveOut.width = 854; liveOut.height = 480;
  async function liveStart() {
    if (!link) return;
    if (!liveTrack) { liveTrack = liveOut.captureStream(0).getVideoTracks()[0]; liveTrack.contentHint = 'motion'; }
    const ok = await link.setVideo(liveTrack).catch(() => false);
    if (!ok) st('LIVE CAM: this link has no video slot (reconnect the phone)');
  }
  function liveStop() {
    if (link && link.setVideo) link.setVideo(null).catch(() => {});
    if (liveTrack) { liveTrack.stop(); liveTrack = null; }
  }
  function liveFrame() { if (liveTrack && liveTrack.requestFrame) liveTrack.requestFrame(); }
  function liveFixed(now) {   // the program picture just drawn (#239 SOLO: the camera video itself)
    liveT = now; const v = fixed.video, c = liveSolo && v && v.videoWidth ? v : renderer.domElement;
    const cw = c.videoWidth || c.width, ch = c.videoHeight || c.height, k = 854 / Math.max(cw, ch);
    const W = Math.round(cw * k / 2) * 2, H = Math.round(ch * k / 2) * 2;
    if (liveOut.width !== W || liveOut.height !== H) { liveOut.width = W; liveOut.height = H; }
    liveOutCtx.drawImage(c, 0, 0, W, H); liveFrame();
  }
  function liveAR(now) {   // the AR view again, into a render target, read back without stalling the GPU
    liveT = now; if (liveBusy) return;
    const xc = renderer.xr.getCamera(), c0 = xc && xc.cameras && xc.cameras[0]; if (!c0) return;
    const P = c0.projectionMatrix.elements, H = 480, W = Math.max(64, Math.round(H * P[5] / P[0] / 2) * 2);
    if (liveRT.width !== W || liveRT.height !== H) { liveRT.setSize(W, H); liveRaw.width = W; liveRaw.height = H; liveBuf = new Uint8Array(W * H * 4); }
    pvCam.projectionMatrix.copy(c0.projectionMatrix); pvCam.projectionMatrixInverse.copy(c0.projectionMatrixInverse);
    pvCam.matrixWorld.copy(c0.matrixWorld); pvCam.matrixWorldInverse.copy(c0.matrixWorldInverse); pvCam.layers.mask = c0.layers.mask;
    if (liveSolo) pvCam.layers.set(30);   // #239 SOLO: only the camera quad
    const raw = (liveSolo || !vs.S.on) && vs.S.pvReady, qv = vs.quad.visible, rv = reticle.visible, xv = xMark.visible;
    if (raw) { vs.quad.visible = true; vs.mat.uniforms.raw.value = 1; }
    reticle.visible = xMark.visible = false;
    renderer.xr.enabled = false; renderer.setRenderTarget(liveRT); renderer.clear(); renderer.render(scene, pvCam); renderer.setRenderTarget(null); renderer.xr.enabled = true;
    vs.quad.visible = qv; vs.mat.uniforms.raw.value = 0; reticle.visible = rv; xMark.visible = xv;
    const m = c0.matrixWorld.elements, a = Math.atan2(m[1], m[5]) * 180 / Math.PI;   // same upright rule as the preview (#205)
    rotDir = rotDir === 0 ? (a > 55 ? 1 : a < -55 ? -1 : 0) : rotDir === 1 ? (a < 35 ? (a < -55 ? -1 : 0) : 1) : (a > -35 ? (a > 55 ? 1 : 0) : -1);
    const rd = rotDir, buf = liveBuf; liveBusy = true;
    renderer.readRenderTargetPixelsAsync(liveRT, 0, 0, W, H, buf).then(() => {
      liveBusy = false; if (!liveOn || buf !== liveBuf) return;
      const img = new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength), W, H);
      for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
      liveRawCtx.putImageData(img, 0, 0);
      const ow = rd ? H : W, oh = rd ? W : H; if (liveOut.width !== ow || liveOut.height !== oh) { liveOut.width = ow; liveOut.height = oh; }
      const g = liveOutCtx; g.setTransform(1, 0, 0, 1, 0, 0);
      if (rd === 1) { g.translate(0, W); g.rotate(-Math.PI / 2); } else if (rd === -1) { g.translate(H, 0); g.rotate(Math.PI / 2); }
      g.translate(0, H); g.scale(1, -1);   // read-back rows come bottom-up
      g.drawImage(liveRaw, 0, 0); g.setTransform(1, 0, 0, 1, 0, 0); liveFrame();
    }).catch(() => { liveBusy = false; });
  }
  async function showLiveCard(on) {
    if (!on) { if (!led.on) led.wall.userData.setVideo(null); return; }
    if (!liveCard) {
      const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const g = c.getContext('2d');
      const gr = g.createRadialGradient(640, 330, 40, 640, 360, 760); gr.addColorStop(0, '#1b2233'); gr.addColorStop(1, '#05070c'); g.fillStyle = gr; g.fillRect(0, 0, 1280, 720);
      g.textAlign = 'right'; g.textBaseline = 'middle'; g.font = '800 170px system-ui,sans-serif'; g.fillStyle = '#ffffff'; g.fillText('Cly', 640, 300);
      g.textAlign = 'left'; g.fillStyle = '#e0202a'; g.fillText('3DJ', 640, 300);
      g.fillStyle = '#e0202a'; g.beginPath(); g.arc(520, 480, 22, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.font = '700 64px system-ui,sans-serif'; g.fillText('LIVE', 560, 482);
      liveCard = await createImageBitmap(c, { imageOrientation: 'flipY' });
    }
    if (liveOn) led.wall.userData.setImage(liveCard);
  }
  $('#spCamTest').onclick = () => import('./camtest.js').then(m => m.camTest()).catch(e => st('Camera test failed: ' + e.message));   // #183
  $('#spLedF').onchange = e => {   // #176: same file names as on the Quest; matched by name
    const all = [...(e.target.files || [])]; pickedLed = all; const n = led.setFiles([...all, ...mediaLed], 1000);
    vvFiles = new Map(all.filter(f => VIDEO_EXT.test(f.name)).map(f => [vvKey(baseName(f.name)), f]));   // #177 VideoVinyl by title
    $('#spLedList').textContent = n ? `${n} video${n > 1 ? 's' : ''}: ${led.files.map(f => f.name).join(' · ')}` : 'No playable videos in that pick.';
  };

  // ---------------------------------------------------------------- mirrored gear nodes
  const nodes = new Map();   // id -> { o, s: [{ t, p, q, sc, v }] }
  function resolve(id) {
    const parts = id.split('.'), key = parts[0];
    let o = stage.items[key]?.obj || stage.cases[key]?.group;
    if (!o && /^milk[2-6]$/.test(key)) { o = newMilk(key); stage.items[key] = { obj: o, base: 0 }; }
    for (let i = 1; o && i < parts.length; i++) o = o.children[+parts[i]];
    return o || null;
  }
  function addSample(S, t, s) {
    const last = S[S.length - 1];
    if (last && t < last.t) return;                       // late duplicate
    if (last && t - last.t > 150) S.push({ ...last, t: t - 40, p: last.p.clone(), q: last.q.clone() });   // was resting: hold until just before the move
    S.push({ t, ...s }); while (S.length > 8) S.shift();
  }
  function nodeSample(a, t) {
    let e = nodes.get(a[0]);
    if (!e) { const o = resolve(a[0]); if (!o) return; e = { o, s: [] }; nodes.set(a[0], e); }
    addSample(e.s, t, { p: new THREE.Vector3(a[1], a[2], a[3]), q: new THREE.Quaternion(a[4], a[5], a[6], a[7]), sc: a[8], v: a[9] });
  }
  const _q = new THREE.Quaternion(), _p = new THREE.Vector3();
  function blendTo(S, rt, obj, withScale) {   // pose at render time rt (Quest clock)
    if (!S.length) return;
    let a = S[0], b = null;
    for (let i = 0; i < S.length; i++) { if (S[i].t <= rt) a = S[i]; else { b = S[i]; break; } }
    if (!b || a === b || rt < S[0].t) { const x = rt < S[0].t ? S[0] : a; obj.position.copy(x.p); obj.quaternion.copy(x.q); if (withScale) obj.scale.setScalar(x.sc); if (x.v !== undefined) obj.visible = !!x.v; return; }
    const k = (rt - a.t) / Math.max(1, b.t - a.t);
    obj.position.lerpVectors(a.p, b.p, k); obj.quaternion.slerpQuaternions(a.q, b.q, k);
    if (withScale) obj.scale.setScalar(a.sc + (b.sc - a.sc) * k);
    if (a.v !== undefined) obj.visible = !!(k < 0.5 ? a.v : b.v);
  }
  setInterval(() => { for (const [id, e] of nodes) { const o = resolve(id); if (o) e.o = o; } }, 3000);   // late model upgrades swap nodes

  // flight case sizes (#163): same rebuild as on the Quest (FlightCase.size), then re-find its parts
  const pendingSize = {}; let sizeT = 0;
  function onCaseSizes(cs) { if (cs) Object.assign(pendingSize, cs); }
  function applyCaseSizes(now, force) {
    if (!force && now - sizeT < 120) return;   // a live resize drag arrives 30x/s; rebuild at most ~8x/s
    for (const [k, d] of Object.entries(pendingSize)) {
      const c = stage.cases[k]; delete pendingSize[k]; if (!c) continue;
      if (Math.abs(c.W - d[0]) < 1e-3 && Math.abs(c.D - d[1]) < 1e-3 && Math.abs(c.H - d[2]) < 1e-3) continue;
      c.size(d[0], d[1], d[2]); sizeT = now;
      for (const [id, e] of nodes) if (id === k || id.startsWith(k + '.')) { const o = resolve(id); if (o) e.o = o; else nodes.delete(id); }
    }
  }
  // ---------------------------------------------------------------- records
  const recs = new Map();   // uid -> { r, s: [] , meshX, meshY }
  const u8of = b64 => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  function onRec(m) {
    if (recs.has(m.uid)) return;
    const r = new Record3D(m.rec); r.sideUp = m.sideUp; r.flipT = m.sideUp === 'A' ? 0 : 1;
    rig.add(r.group); r.group.visible = false;
    recs.set(m.uid, { r, s: [] });
  }
  function onRecEnv(m) {
    const R = recs.get(m.uid); if (!R) return;
    const u = u8of(m.env), q = new Uint16Array(u.buffer, u.byteOffset, u.byteLength >> 1), env = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) env[i] = q[i] / 65535;
    R.r.envs[m.side] = env; R.r.durations[m.side] = m.dur || undefined; R.r.redraw(m.side);   // same grooves code as the Quest (#57, #137)
  }
  async function onRecArt(m) {
    const R = recs.get(m.uid); if (!R) return;
    try { R.r.labelImgs[m.side] = await createImageBitmap(new Blob([u8of(m.img)], { type: m.mime || 'image/jpeg' })); if (!R.r.disposed) R.r.redraw(m.side); } catch {}
  }
  function onRecDel(uid) { const R = recs.get(uid); if (!R) return; rig.remove(R.r.group); R.r.dispose(); recs.delete(uid); }
  function recSample(a, t) {
    const R = recs.get(a[0]); if (!R) return;
    addSample(R.s, t, { p: new THREE.Vector3(a[1], a[2], a[3]), q: new THREE.Quaternion(a[4], a[5], a[6], a[7]) });
    R.meshX = a[8]; R.meshY = a[9]; R.r.sideUp = a[10]; R.discX = a[11] || 0; R.seen = performance.now();
  }

  // ---------------------------------------------------------------- hands: depth-only shapes (the camera image shows through)
  const occMat = new THREE.MeshBasicMaterial({ colorWrite: false }), dbgMat = new THREE.MeshBasicMaterial({ color: 0xff40a0, transparent: true, opacity: 0.45 });
  let showHands = false;
  const sph = new THREE.SphereGeometry(1, 10, 8), cap = new THREE.CapsuleGeometry(1, 4, 4, 10);   // 6 units long: scaled to L/6 the ends stay about round
  function occ(geo) { const m = new THREE.Mesh(geo, occMat); m.renderOrder = -10; m.frustumCulled = false; m.visible = false; rig.add(m); return m; }
  const hands = [0, 1].map(() => ({ joints: Array.from({ length: 25 }, () => occ(sph)), palm: occ(sph), arm: occ(cap), fist: occ(sph), seen: 0 }));
  const JR = i => i === 0 ? 0.028 : [1, 5, 10, 15, 20].includes(i) ? 0.02 : 0.012;   // wrist, metacarpals, the rest
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), UPY = new THREE.Vector3(0, 1, 0);
  function capsule(m, a, b, r) { _d.subVectors(b, a); const L = _d.length(); m.position.addVectors(a, b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(UPY, _d.normalize()); m.scale.set(r, Math.max(0.001, L / 6), r); m.visible = true; }
  function onHands(list) {
    const now = performance.now();
    for (const [i, kind, a] of list) {
      const H = hands[i]; if (!H) continue; H.seen = now;
      if (kind === 'h') {
        const n = Math.min(25, a.length / 3);
        for (let j = 0; j < 25; j++) { const m = H.joints[j]; if (j >= n) { m.visible = false; continue; } m.position.set(a[j * 3], a[j * 3 + 1], a[j * 3 + 2]); m.scale.setScalar(JR(j)); m.visible = true; }
        _a.fromArray(a, 0); _b.fromArray(a, 30);   // wrist, middle metacarpal
        H.palm.position.addVectors(_a, _b).multiplyScalar(0.5); H.palm.scale.setScalar(0.045); H.palm.visible = true;
        _d.subVectors(_a, _b).normalize(); _b.copy(_a).addScaledVector(_d, 0.27);   // forearm runs back from the wrist
        capsule(H.arm, _a, _b, 0.04); H.fist.visible = false;
      } else {   // controller: a fist round the grip, forearm behind it
        _p.set(a[0], a[1], a[2]); _q.set(a[3], a[4], a[5], a[6]);
        H.fist.position.copy(_p); H.fist.scale.setScalar(0.065); H.fist.visible = true;
        _a.set(0, -0.01, 0.05).applyQuaternion(_q).add(_p); _b.set(0, -0.06, 0.32).applyQuaternion(_q).add(_p);
        capsule(H.arm, _a, _b, 0.042); H.palm.visible = false; for (const m of H.joints) m.visible = false;
      }
    }
  }
  const phoneHands = makePhoneHands(rig);   // #288
  // ---------------------------------------------------------------- #278 the robot DJ on the phone
  // The Quest sends (only while ROBOT ON PHONE is on) the mic level, which input is the left / right hand and each
  // controller's trigger, grip and tip ball; head and hands come in every state tick anyway (rig-local). The phone
  // loads its own copy of the robot (robot2.js) and poses it here, so the Quest only sends numbers.
  const SPEC = ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
    ...['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'].flatMap(f => [`${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`])];
  const robo = { a: null, loading: false, seen: 0, msg: null, on: false };
  function onAvatar(m) {
    robo.msg = m; robo.seen = performance.now();
    if (!robo.a && !robo.loading) {
      robo.loading = true;
      Promise.all([import('./robot2.js'), import('./director.js')]).then(([R, D]) => {
        const a = new R.RobotAvatar2(rig); robo.a = a; robo.layer = D.AV_LAYER; a.root.visible = false;
        return a.load(R.ROBOT_GLB);
      }).catch(e => { console.warn('phone robot', e); robo.err = e.message; });
    }
  }
  const _rq = new THREE.Quaternion(), _hq = new THREE.Quaternion(), _hp = new THREE.Vector3();
  const W = (x, y, z) => rig.localToWorld(new THREE.Vector3(x, y, z));
  function robotFrame(dt, now) {
    const a = robo.a, on = !!(a && a.ready && robo.msg && now - robo.seen < 1000);
    if (on !== robo.on) {
      robo.on = on; if (a) a.root.visible = on;
      if (robo.layer != null) { if (on) camera.layers.enable(robo.layer); else camera.layers.disable(robo.layer); }
      if (on) for (const H of hands) { for (const m of H.joints) m.visible = false; H.palm.visible = H.arm.visible = H.fist.visible = false; }
    }
    if (!on) return;
    const m = robo.msg, av = m.av; rig.updateMatrixWorld(); rig.getWorldQuaternion(_rq);
    const head = { p: W(m.h[0], m.h[1], m.h[2]), q: _rq.clone().multiply(_hq.set(m.h[3], m.h[4], m.h[5], m.h[6])) };
    const out = [null, null];
    for (const [i, kind, v] of m.hd || []) {
      const side = av.hs[i] === 'l' ? 0 : av.hs[i] === 'r' ? 1 : -1; if (side < 0) continue;
      if (kind === 'h') {
        if (v.length < 75) continue;
        const joints = new Map(); SPEC.forEach((n, j) => joints.set(n, W(v[j * 3], v[j * 3 + 1], v[j * 3 + 2])));
        const w = joints.get('wrist'), mp = joints.get('middle-finger-phalanx-proximal'), ip = joints.get('index-finger-phalanx-proximal'), pp = joints.get('pinky-finger-phalanx-proximal');
        out[side] = { p: w, f: mp.clone().sub(w), s: pp.clone().sub(ip), joints };
      } else {   // controller: as director.js xrPose
        const gp = W(v[0], v[1], v[2]), gq = _rq.clone().multiply(new THREE.Quaternion(v[3], v[4], v[5], v[6]));
        const c = (av.c || []).find(x => x[0] === i) || [i, 0, 0];
        out[side] = { p: gp.clone().add(new THREE.Vector3(0, 0, 0.07).applyQuaternion(gq)), f: new THREE.Vector3(0, -0.35, -1).applyQuaternion(gq), s: new THREE.Vector3(0, -1, 0.25).applyQuaternion(gq),
          curl: 0.25 + 0.75 * c[2], curlIndex: 0.15 + 0.85 * c[1], tip: c.length >= 6 ? W(c[3], c[4], c[5]) : null };
      }
    }
    try { a.update({ head, hands: out, floorY: rig.getWorldPosition(_hp).y, mic: av.m || 0, dt }); } catch (e) { if (!robo.warned) { robo.warned = true; console.warn(e); } }
  }
  function handsTimeout() { const now = performance.now(); for (const H of hands) if (now - H.seen > 400) { for (const m of H.joints) m.visible = false; H.palm.visible = H.arm.visible = H.fist.visible = false; } }
  function setHandsDebug(on) { showHands = on; for (const H of hands) for (const m of [...H.joints, H.palm, H.arm, H.fist]) { m.material = on ? dbgMat : occMat; m.renderOrder = on ? 10 : -10; } }

  // ---------------------------------------------------------------- head marker (optional check)
  const head = new THREE.Group(); rig.add(head); head.visible = false; let showHead = false;
  {
    const m = new THREE.MeshBasicMaterial({ color: 0xff3050, wireframe: true, transparent: true, opacity: 0.7 });
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), m));
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 8), new THREE.MeshBasicMaterial({ color: 0xff3050 }));
    nose.rotation.x = -Math.PI / 2; nose.position.z = -0.16; head.add(nose);
  }

  // ---------------------------------------------------------------- messages
  function onMsg(m) {
    if (m.k === 's') {
      stats.pkts++; stats.xr = m.xr; stats.last = performance.now();
      if (stats.off !== null) stats.age = performance.now() + stats.off - m.t;
      head.position.set(m.h[0], m.h[1], m.h[2]); head.quaternion.set(m.h[3], m.h[4], m.h[5], m.h[6]);
      if (m.cs) onCaseSizes(m.cs);
      if (m.g) for (const a of m.g) nodeSample(a, m.t);
      if (m.r) for (const a of m.r) recSample(a, m.t);
      // #288 (owner): no more depth-only cut-outs; the phone draws the DJ's hands as the Quest does (3D hands / glove / controllers)
      if (m.ha) phoneHands.fit(m.ha);   // #291
      if (m.hd && !robo.on) phoneHands.update(m.hd, m.cl, Math.min(0.1, (performance.now() - (onMsg.lastHd || 0)) / 1000)), onMsg.lastHd = performance.now();
      if (m.av) onAvatar(m);
      if (m.vv) onVV(m.vv);
      if (m.sp && ctx.crateRemote && ctx.crateRemote.spiders) ctx.crateRemote.spiders(m.sp);   // #262 45 adapters
    } else if (m.k === 'full') { onCaseSizes(m.cs); applyCaseSizes(performance.now(), true); for (const a of m.n) nodeSample(a, m.t); }
    else if (m.k === 'layout') { const cs = {}; for (const [k, v] of Object.entries(m.layout.cases || {})) cs[k] = [v[4], v[5], v[6]]; onCaseSizes(cs); }
    else if (m.k === 'rec') onRec(m);
    else if (m.k === 'renv') onRecEnv(m);
    else if (m.k === 'rart') onRecArt(m);
    else if (m.k === 'crate') { if (ctx.crateRemote) ctx.crateRemote.onCrate(m); }   // #218 the Quest's crate view
    else if (m.k === 'cscr') { if (ctx.crateRemote) ctx.crateRemote.onScreen(m); }
    else if (m.k === 'cover') { if (ctx.crateRemote) ctx.crateRemote.onCover(m); }
    else if (m.k === 'covhave?') { if (ctx.crateRemote) ctx.crateRemote.coverHave(m.keys || []).then(keys => { if (link && link.isOpen) link.send('ctl', { k: 'covhave', keys }); }); }
    else if (m.k === 'recdel') onRecDel(m.uid);
    else if (m.k === 'calpt') { if (!(fixed.on && fixed.onCalPoint(m))) onCalPoint(m); }   // #208 fixed camera taps first
    else if (m.k === 'calskip') { if (fixed.on) fixed.calSkip(); }   // #211 the Quest's grip skips an auto point
    else if (m.k === 'led') { led.follow(m.on, m.name, m.t + Math.max(0, questNow() - m.qt) / 1000); if (liveOn && !led.on) showLiveCard(true); }   // #176 (#238 the LIVE card stays up)
    else if (m.k === 'live') { const was = liveOn; liveOn = !!m.on; liveSolo = !!m.solo; if (liveOn && !was) liveStart(); else if (!liveOn) liveStop(); showLiveCard(liveOn); }   // #238 LIVE CAM (#239 SOLO)
    else if (m.k === 'scroll' && scroller) {   // #236 the Quest's VJ scroller, drawn here from its text, wave and speed
      scroller.wave = m.wave; scroller.speed = m.speed;
      if (!m.on) { if (scroller.on) scroller.stop(); }
      else if (!scroller.on || scroller.text !== m.text) { scroller.on = true; scroller.text = m.text; scroller.x = scroller.canvas.width; scroller.mesh.visible = true; }
    }
    else if (m.k === 'sky') vs.onSky(m);
    else if (m.k === 'cset') onCset(m);   // #188
    else if (m.k === 'mls' || m.k === 'mgo' || m.k === 'mok') lib.onMsg(m);
    else if (m.k === 'mls?') sendMediaList();   // #206 media sync (the Quest's VIDEO page)
    else if (m.k === 'mpull') lib.pull(m.f, m.n);
    else if (m.k === 'qput') onQput(m);   // #185                   // #184
    else if (m.k === 'mr') setMR(!!m.on);                  // #164 from the Quest's mixer screen
    else if (m.k === 'cellrec') setClean(!!m.on);   // (#164, no longer sent)
    else if (m.k === 'pong') { const now = performance.now(); stats.rtt = now - m.t; const off = m.qt - (m.t + now) / 2; stats.off = stats.off === null ? off : stats.off * 0.8 + off * 0.2; }
  }

  // ---------------------------------------------------------------- AR session, placement, calibration (see #160)
  // phone = R(yaw) * rig + t: yaw from the X->lens direction on both devices, t from the X.
  const Y = new THREE.Vector3(0, 1, 0);
  let hitSource = null, touchSource = null, lastTouch = null, mode = 'find', uiHidden = false, yaw = 0, placed = false, envI = scene.environmentIntensity;
  const cal = { Xp: null, Lp: null, Xq: null, Lq: null, ok: false, err: null };
  const poseLog = [];
  const reticle = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x39a8ff }));
  reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);
  const xMark = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.065, 4).rotateX(-Math.PI / 2).rotateY(Math.PI / 4), new THREE.MeshBasicMaterial({ color: 0x00e0ff }));
  xMark.visible = false; scene.add(xMark);
  $('#spBar').addEventListener('beforexrselect', e => e.preventDefault());
  const HINTS = {
    find: 'Move the phone slowly until the floor is found (a blue ring appears).',
    place: 'Tap the floor under the middle of the DJ table.',
    calX: 'Calibrate 1/3: tap the floor mark on the screen.',
    calLens: 'Calibrate 2/3 (DJ): touch this phone\'s back camera lens with the controller tip, pull the trigger. Keep the phone still.',
    calQX: 'Calibrate 3/3 (DJ): touch the floor mark with the controller tip, pull the trigger.',
    fix: 'Fix: tap the floor mark on the screen again.',
  };
  // #204 (owner): while placing / calibrating / fixing, the gear gets out of the way so the floor mark shows.
  // #205 (owner): only outline boxes at 25 %: every piece of gear stops drawing (colour and depth writes off, so the
  // Quest's show / hide of parts is untouched) and a thin box is drawn round each one (in its own frame, so it turns
  // and moves with it). Restored when calibration ends.
  const GHOST = new Set(['place', 'calX', 'calLens', 'calQX', 'fix']);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x39e0ff, transparent: true, opacity: 0.25, depthTest: false, depthWrite: false });
  let ghosted = false, outlines = [];
  const _gm = new THREE.Matrix4(), _gb = new THREE.Box3(), _gs = new THREE.Vector3(), _gc = new THREE.Vector3();
  function ghost(on) {
    if (on === ghosted) return; ghosted = on;
    for (const l of outlines) { l.parent && l.parent.remove(l); l.geometry.dispose(); } outlines = [];
    const seen = new Set();
    rig.traverse(o => {
      if (!o.isMesh || !o.material) return;
      for (const mt of Array.isArray(o.material) ? o.material : [o.material]) {
        if (seen.has(mt)) continue; seen.add(mt);
        if (on) { mt.userData.ghost = { c: mt.colorWrite, d: mt.depthWrite }; mt.colorWrite = false; mt.depthWrite = false; }
        else if (mt.userData.ghost) { mt.colorWrite = mt.userData.ghost.c; mt.depthWrite = mt.userData.ghost.d; delete mt.userData.ghost; }
      }
    });
    if (!on) return;
    rig.updateMatrixWorld(true);
    for (const top of rig.children) {   // one box per piece of gear (decks, mixer, crates, case, sign, LED wall)
      if (!top.visible || top === skybox.group || top.isLight) continue;
      const box = new THREE.Box3(), inv = _gm.copy(top.matrixWorld).invert();
      top.traverse(o => {
        if (!o.isMesh || !o.visible || !o.geometry || (o.material && o.material.userData.ghost && o.material.userData.ghost.c === false)) return;   // skip depth-only hand shapes
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        _gb.copy(o.geometry.boundingBox).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); box.union(_gb);
      });
      if (box.isEmpty()) continue;
      box.getSize(_gs); box.getCenter(_gc);
      if (_gs.x < 0.02 && _gs.y < 0.02 && _gs.z < 0.02) continue;
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(Math.max(_gs.x, 0.002), Math.max(_gs.y, 0.002), Math.max(_gs.z, 0.002))), lineMat);
      l.position.copy(_gc); l.renderOrder = 20; l.raycast = () => {}; top.add(l); outlines.push(l);
    }
  }
  function setMode(m, text) {
    mode = m; ghost(GHOST.has(m)); hint.textContent = text || HINTS[m] || ''; hint.style.display = (m === 'live' && !text) ? 'none' : '';
    hint.classList.toggle('go', m !== 'live' && m !== 'find');
    if (text && m === 'live') setTimeout(() => { if (mode === 'live') hint.style.display = 'none'; }, 5000);
  }
  const needLink = () => { if (link && link.isOpen) return true; setMode(mode, 'Not connected to the Quest: Exit and Connect first.'); return false; };
  rig.visible = false;   // nothing until it is placed on the phone's floor

  $('#spAR').onclick = async () => {
    ov.hidden = false;
    try {
      renderer.xr.setReferenceSpaceType('local');
      const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'camera-access', 'light-estimation'], domOverlay: { root: ov } });
      $('#spS').style.display = 'none';
      await renderer.xr.setSession(session);
      scene.background = null; room.visible = false; envI = scene.environmentIntensity; scene.environmentIntensity = 0.6;   // #180 (default of the Quest's passthrough setting); like the Quest in passthrough
      const viewer = await session.requestReferenceSpace('viewer');
      hitSource = await session.requestHitTestSource({ space: viewer });
      touchSource = await session.requestHitTestSourceForTransientInput({ profile: 'generic-touchscreen' }).catch(() => null);
      session.addEventListener('select', onTap);
      vs.onSession(session); look.onSession(session); $('#bSet').classList.remove('on'); $('#bSet').disabled = !vs.S.can;
      session.addEventListener('end', () => {
        vs.onEnd(); look.onEnd(); $('#bSet').classList.remove('on');
        hitSource = touchSource = null; ov.hidden = true; $('#spS').style.display = '';
        scene.background = BG; room.visible = true; scene.environmentIntensity = envI;
        if (link && link.isOpen) link.send('ctl', { k: 'cal', step: 'cancel' });
      });
      setMode(placed ? 'live' : 'find');
    } catch (e) { ov.hidden = true; st('Could not start AR: ' + e.message); }
  };
  function tapPoint() {
    if (lastTouch && performance.now() - lastTouch.t < 600) return lastTouch.p.clone();
    return reticle.visible ? new THREE.Vector3().setFromMatrixPosition(reticle.matrix) : null;
  }
  const lensNow = () => new THREE.Vector3().setFromMatrixPosition(renderer.xr.getCamera().matrixWorld);
  function lensAt(phoneT) { let best = null, bd = 1e9; for (const e of poseLog) { const d = Math.abs(e[0] - phoneT); if (d < bd) { bd = d; best = e[1]; } } return best && bd < 400 ? best.clone() : lensNow(); }
  function onTap() {
    if (uiHidden) { uiHidden = false; ov.classList.remove('hide'); return; }
    const p = tapPoint();
    if (mode === 'place' && p) {
      const d = lensNow().sub(p); d.y = 0; d.normalize();
      yaw = Math.atan2(-d.x, -d.z);
      rig.position.copy(p); rig.rotation.set(0, yaw, 0); rig.visible = placed = true; cal.ok = false;
      setMode('live', 'Roughly placed. Calibrate for an exact fit.');
    } else if (mode === 'calX' && p) {
      cal.Xp = p; xMark.position.copy(p); xMark.visible = true;
      if (!needLink()) return;
      link.send('ctl', { k: 'cal', step: 'lens' }); setMode('calLens');
    } else if (mode === 'fix' && p) {
      cal.Xp = p; xMark.position.copy(p); xMark.visible = true; solve(true);
      setMode('live', 'Fixed: position re-aligned on the mark.');
    }
  }
  function onCalPoint(m) {
    const q = new THREE.Vector3().fromArray(m.p);
    if (m.step === 'lens' && mode === 'calLens') {
      cal.Lq = q; cal.Lp = lensAt(stats.off === null ? performance.now() : m.qt - stats.off);
      link.send('ctl', { k: 'cal', step: 'x' }); setMode('calQX');
    } else if (m.step === 'x' && mode === 'calQX') {
      cal.Xq = q; solve(false);
      link.send('ctl', { k: 'cal', step: 'done', err: cal.err });
      setMode('live', `Calibrated. Distances match within ${cal.err} cm` + (cal.err > 5 ? ' (high: try again, touch the lens centre and the mark centre).' : '.'));
    }
  }
  const ang = v => Math.atan2(-v.z, v.x);
  function solve(keepYaw) {
    if (!keepYaw) {
      const vq = cal.Lq.clone().sub(cal.Xq); vq.y = 0; const vp = cal.Lp.clone().sub(cal.Xp); vp.y = 0;
      yaw = ang(vp) - ang(vq);
      cal.err = Math.round(Math.abs(cal.Lq.distanceTo(cal.Xq) - cal.Lp.distanceTo(cal.Xp)) * 1000) / 10;
    }
    const R = new THREE.Quaternion().setFromAxisAngle(Y, yaw);
    rig.position.copy(cal.Xp).sub(cal.Xq.clone().applyQuaternion(R));
    rig.rotation.set(0, yaw, 0); rig.visible = placed = true; cal.ok = true;
  }
  function turn(deg) {
    const d = THREE.MathUtils.degToRad(deg), pivot = cal.ok ? cal.Xp : rig.position.clone();
    rig.position.sub(pivot).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(Y, d)).add(pivot); yaw += d; rig.rotation.y = yaw;
  }
  $('#bCal').onclick = () => { if (!needLink()) return; setMode('calX'); };
  $('#bFix').onclick = () => { if (!cal.Xq) { setMode(mode, 'Calibrate once first; Fix re-uses it.'); return; } setMode('fix'); };
  $('#bL').onclick = () => turn(1);
  $('#bR').onclick = () => turn(-1);
  $('#bPlace').onclick = () => setMode('place');
  $('#bMark').onclick = () => { showHead = !showHead; $('#bMark').classList.toggle('on', showHead); };
  $('#bHands').onclick = () => { setHandsDebug(!showHands); $('#bHands').classList.toggle('on', showHands); };
  async function toggleSet(on) { const msg = await vs.setOn(on); $('#bSet').classList.toggle('on', vs.S.on); setMode(mode === 'live' ? 'live' : mode, msg); if (mode !== 'live') setTimeout(() => setMode(mode), 3000); sendCst(true); }
  $('#bSet').onclick = () => toggleSet(!vs.S.on);
  $('#bKey').onclick = () => { const p = $('#spKey'); p.hidden = !p.hidden; $('#bKey').classList.toggle('on', !p.hidden); if (!p.hidden) { $('#spLook').hidden = true; $('#bLook').classList.remove('on'); } };
  $('#bLook').onclick = () => { const p = $('#spLook'); p.hidden = !p.hidden; $('#bLook').classList.toggle('on', !p.hidden); if (!p.hidden) { $('#spKey').hidden = true; $('#bKey').classList.remove('on'); } };
  $('#bHide').onclick = () => { uiHidden = true; ov.classList.add('hide'); };
  $('#bExit').onclick = () => { const s = renderer.xr.getSession(); if (s) s.end(); };

  // #164: helpers and clean-take switches, driven from the Quest's mixer screen (or the buttons here)
  function setMR(on) {   // #167: from the Quest; ON also brings the menus back, OFF also cleans the screen
    showHead = on; $('#bMark').classList.toggle('on', on);
    setHandsDebug(on); $('#bHands').classList.toggle('on', on);
    setClean(!on);
  }
  function setClean(on) {   // CELL REC: nothing on screen but the camera and the gear
    uiHidden = on; ov.classList.toggle('hide', on);
    if (on) { xMark.visible = false; reticle.visible = false; }
    else if (cal.Xp) xMark.visible = true;
  }
  // ---------------------------------------------------------------- loop (replaces main.js's frame())
  const clock = new THREE.Clock();
  let infoT = 0, camT = 0, found = false, lookT = 0;
  const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _s = new THREE.Vector3();
  renderer.setAnimationLoop((t, frame) => {
    const dt = Math.min(0.05, clock.getDelta()), now = performance.now();
    // #204 three.js binds the AR layer's framebuffer once, just before this callback. Anything that calls
    // renderer.resetState() or setRenderTarget() in between (the camera-picture copy in vset.js, Look match's sample)
    // unbinds it, and the AR frame was then drawn into the hidden canvas instead: the
    // phone showed the bare camera for that frame. That was the flicker. It is re-bound just before the AR render.
    const xrRT = renderer.getRenderTarget();
    if (frame) {
      poseLog.push([now, lensNow()]); while (poseLog.length && now - poseLog[0][0] > 3000) poseLog.shift();
      const ref = renderer.xr.getReferenceSpace();
      if (hitSource) {
        const hits = frame.getHitTestResults(hitSource);
        if (hits.length && mode !== 'live' && !uiHidden) { reticle.visible = true; reticle.matrix.fromArray(hits[0].getPose(ref).transform.matrix); } else reticle.visible = false;
        if (mode === 'find' && hits.length && !found) { found = true; setMode('find', 'Floor found. Press Calibrate (or Rough place).'); }
      }
      if (touchSource) for (const r of frame.getHitTestResultsForTransientInput(touchSource))
        if (r.results.length) lastTouch = { t: now, p: new THREE.Vector3().setFromMatrixPosition(_m.fromArray(r.results[0].getPose(ref).transform.matrix)) };
      if (cal.ok && link && link.isOpen && t - camT > 200) {   // tell the Quest where this camera is (its blue outline)
        camT = t; const xc = renderer.xr.getCamera(), c0 = xc.cameras && xc.cameras[0];
        if (c0) {
          rig.updateMatrixWorld(); _m.multiplyMatrices(_inv.copy(rig.matrixWorld).invert(), xc.matrixWorld); _m.decompose(_p, _q, _s);
          const P = c0.projectionMatrix.elements;
          link.send('state', { k: 'cam', p: _p.toArray().map(v => Math.round(v * 1000) / 1000), q: _q.toArray().map(v => Math.round(v * 10000) / 10000), fov: 2 * Math.atan(1 / P[5]), asp: P[5] / P[0] });
        }
      }
    }
    // mirror: gear nodes and records at the Quest's time minus DELAY
    applyCaseSizes(now);
    const rt = questNow() - DELAY;
    for (const e of nodes.values()) blendTo(e.s, rt, e.o, true);
    for (const R of recs.values()) {
      blendTo(R.s, rt, R.r.group, false); R.r.group.visible = R.s.length > 0 && now - (R.seen || 0) < 1500;
      if (R.meshX !== undefined) { R.r.mesh.rotation.x = R.meshX; R.r.mesh.position.y = R.meshY; }
      R.r.disc.position.x = R.discX || 0;   // #262 a 45 off-centre on the bare spindle
    }
    handsTimeout();
    robotFrame(dt, now);   // #278
    phoneHands.frame(now, robo.on);   // #288
    vvFrame(now);
    head.visible = showHead && now - stats.last < 1000;
    if (deckInst) deckInst.update();
    if (neon.userData.update) neon.userData.update(dt);
    try { stepWallGlow(); stepBlobs(); if (scroller) scroller.tick(dt); } catch {}
    ghost(fixed.on ? !!fixed.S.cal : GHOST.has(mode));   // #212 fixed camera: gear hidden (faint outlines) while calibrating
    if (fixed.on) {   // #208 fixed camera: background crop + camera pose; the Quest's blue outline every 200 ms
      fixed.frame();
      if (link && link.isOpen && t - camT > 200) { camT = t; const c = fixed.camState(); if (c) link.send('state', { k: 'cam', ...c }); }
    }
    if (t - infoT > 250) {
      infoT = t;
      if (fixed.on) fixed.info(link && link.isOpen ? `${fps} fps · link ok` : 'not connected to the Quest');
      const live = link && link.isOpen, stale = now - stats.last > 1000;
      $('#spInfo').textContent = live
        ? `${renderer.xr.getSession() ? 'late ' + late + '/s · ' : ''}Quest ${stats.xr ? 'in XR' : 'not in XR yet'} · round trip ${stats.rtt.toFixed(0)} ms · pose age ${stale ? 'no data' : stats.age.toFixed(0) + ' ms'} · ${stats.pps}/s · ${nodes.size} parts · ${recs.size} records` + (cal.ok ? ` · cal ${cal.err ?? '-'} cm` : ' · not calibrated') + (vs.S.on ? ` · set ${vs.S.got}/${vs.S.got + vs.S.miss}` + (vs.S.err ? ' ' + vs.S.err : '') : '')
        : 'Not connected to the Quest (' + (STATUS[linkState] || linkState || 'idle') + ')';
    }
    flook.sync(fixed.on, fixed.S.facing); flook.frame();   // #214 fixed mode look (grade from the plain video)
    look.frame(frame, dt, vs.S.on);   // #187 (before vs.frame: it asks for the camera sample)
    if (t - lookT > 500) { lookT = t; if (!$('#spLook').hidden) $('#lkSt').textContent = look.status(); }
    const liveLink = liveOn && link && link.isOpen, liveDue = liveLink && !!frame && now - liveT > 48;   // #238 AR LIVE CAM at ~20 fps
    vs.S.pvNeed = !!(pvOn && frame && link && link.isOpen && now - pvT > 150) || liveDue;   // #188 (#238 the camera picture for LIVE CAM too)
    vs.frame(frame);   // #184: camera picture for the key / preview
    if (frame) renderer.setRenderTarget(xrRT);   // #204 back to the AR layer
    renderer.render(scene, camera);
    if (liveDue) liveAR(now);   // #238
    else if (liveLink && fixed.on && now - liveT > 32) liveFixed(now);   // #238 fixed mode at ~30 fps
    if (vs.S.pvNeed && pvOn && now - pvT > 150) renderPreview(now);   // #188 (after the AR frame)
    else if (fixed.on && pvOn && link && link.isOpen && now - pvT > 150) fixedPreview(now);   // #208 the screen itself, scaled
    if (frame) {   // #203 late AR frames (each one shows as a flash of bare camera on the phone's screen)
      if (lastXT) { const d = t - lastXT; dts.push(d); if (dts.length > 60) dts.shift(); const md = [...dts].sort((x, y) => x - y)[dts.length >> 1]; if (dts.length > 10 && d > md * 1.5) lateN++; }
      lastXT = t;
    } else lastXT = 0;
    fpsN++; if (now - fpsT > 1000) { fps = Math.round(fpsN * 1000 / (now - fpsT)); fpsN = 0; fpsT = now; late = lateN; lateN = 0; sendCst(); }
  });
  window.spect = { _robo: { robo, onAvatar, robotFrame } /* #278 test hook */, _ph: phoneHands /* #288 */, vs, look, renderPreview, fixed, flook, _live: { fixedFrame: liveFixed, get on() { return liveOn; }, get track() { return liveTrack; } } /* #238 test hook */, _ghost: on => ghost(on), get rotDir() { return rotDir; }, get late() { return late; }, get pvOn() { return pvOn; }, stats, nodes, recs, cal, solve, rig, hands, get link() { return link; }, _set: v => Object.assign(cal, v) };
}
