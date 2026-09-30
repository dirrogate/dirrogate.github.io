// Spectator phone (CLAUDE.md #158, #160, #161). main.js builds the full Cly3DJ scene in camera role (no audio,
// no library, no input) and hands it here. This module: joins the Quest by code, runs Chrome AR, places the
// DJ rig on the phone's floor (Calibrate / Fix / Rough place), and mirrors the Quest: every moving part of the
// gear (interpolated ~70 ms behind so 30 Hz updates look smooth), the records (built here from the groove
// envelope and label the Quest sends once), and depth-only shapes at the DJ's hands so the real hands show in
// front of the virtual gear.
import { spectatorLink } from './net-link.js';
import { DeckVideo, vvKey, baseName, VIDEO_EXT } from './videovinyl.js';
import { makeVirtualSet } from './vset.js';
import { makePhoneLibrary } from './phonelib.js';
import * as media from './medialib.js';

export function startCamera(ctx) {
  const { THREE, renderer, scene, camera, rig, room, stage, deckInst, neon, newMilk, stepWallGlow, stepBlobs, Record3D, BG, led, skybox, envLight, key } = ctx;
  const vs = makeVirtualSet({ THREE, renderer, scene, skybox, envLight, key });   // #184 live green-screen key
  // #185 media library (phone side); its Video + Images items also feed the LED wall / VideoVinyl mirrors
  const lib = makePhoneLibrary({ getLink: () => link, onChange: () => refreshMedia() });
  let pickedLed = [], mediaLed = [];
  async function refreshMedia() { const its = [...await media.list('Video'), ...await media.list('Images')]; mediaLed = (await Promise.all(its.map(i => media.getFile(i.folder, i.name)))).filter(Boolean); led.setFiles([...pickedLed, ...mediaLed], 1000); }
  refreshMedia();
  const DELAY = 70;   // ms the mirror runs behind the Quest, so there are always two samples to blend
  // ---------------------------------------------------------------- UI (built here; index.html's own UI is hidden)
  document.head.insertAdjacentHTML('beforeend', `<style>
    #spS { position:fixed; inset:0; overflow:auto; z-index:30; background:radial-gradient(ellipse at 50% 30%,#182030 0%,#0b0d12 75%); color:#e6e8ec; font:15px/1.45 system-ui,sans-serif; }
    #spS .box { max-width:460px; margin:0 auto; padding:24px 16px; }
    #spS h1 { font-size:34px; margin:0 0 2px; font-weight:800; letter-spacing:.04em; } #spS h1 span { color:#e0202a; }
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
      <button id="spConnect">Connect</button><button id="spAR" disabled>Start camera (AR)</button><button id="spCamTest">Camera access test (no Quest needed)</button>
      <button id="spLib">Library: panoramas, videos, images (push to the Quest)…</button>
      <button id="spPano">Virtual set panorama (same picture as the Quest)…</button><input type="file" id="spPanoF" accept="image/*" hidden>
      <div id="spPanoSt" style="color:#8b909a;font-size:13px;margin-top:6px">For the green-screen virtual set: pick the same 360 picture the Quest shows. Kept on this phone.</div>
      <button id="spLed">Videos: LED wall clips + VideoVinyls (same files as the Quest)…</button><input type="file" id="spLedF" accept="video/*" multiple hidden>
      <div id="spLedList" style="color:#8b909a;font-size:13px;margin-top:6px">Optional: pick the same videos as on the Quest so the LED wall plays here too.</div>
      <div id="spSt"></div></div></div>
    <div id="spO" hidden>
      <div class="info" id="spInfo">…</div>
      <div class="hint" id="spHint"></div>
      <div class="kp" id="spKey" hidden>
        <label><button id="kAuto">Auto</button><span id="kAutoSt" style="width:auto;flex:1;text-align:left;font-weight:500;font-size:12px;color:#8b909a">Point at the EMPTY green screen first</span></label>
        <label>Strength <input type="range" id="kThr" min="0" max="0.8" step="0.005"><span id="kThrV"></span></label>
        <label>Softness <input type="range" id="kSoft" min="0.02" max="0.4" step="0.005"><span id="kSoftV"></span></label>
        <label>Spill <input type="range" id="kSpill" min="0" max="1" step="0.05"><span id="kSpillV"></span></label>
        <label><input type="checkbox" id="kMatte"> Show matte (white = kept, black = keyed)</label>
      </div>
      <div class="bar" id="spBar">
        <button id="bCal">Calibrate</button><button id="bFix">Fix (tap X)</button><button id="bL">⟲ 1°</button><button id="bR">1° ⟳</button>
        <button id="bPlace">Rough place</button><button id="bMark">Head</button><button id="bHands">Hands</button><button id="bSet">Set</button><button id="bKey">Key</button><button id="bHide">Hide UI</button><button id="bExit">Exit</button>
      </div></div>`);
  const $ = s => document.querySelector(s);
  const ov = $('#spO'), hint = $('#spHint');

  // ---------------------------------------------------------------- link
  let link = null, linkState = '';
  const stats = { rtt: 0, off: null, pkts: 0, pps: 0, age: 0, last: 0, xr: 0 };
  try { $('#spCode').value = localStorage.getItem('vire.spectJoin') || ''; } catch {}
  const st = t => { $('#spSt').textContent = t; };
  const STATUS = { relay: 'Relay reached, calling the Quest…', 'relay-retry': 'No internet for the handshake, retrying…', 'quest-offline': 'Quest not found: is its Spectator camera On, same code?',
    connecting: 'Connecting to the Quest…', connected: 'Connected to the Quest', disconnected: 'Link lost', failed: 'Link failed (are both on the same Wi-Fi?)' };
  $('#spConnect').onclick = () => {
    const code = $('#spCode').value.trim();
    if (!/^\d{5}$/.test(code)) { st('Enter the 5-digit code from the Quest'); return; }
    try { localStorage.setItem('vire.spectJoin', code); } catch {}
    if (link) link.close();
    st('Reaching the relay…');
    link = spectatorLink(code, {
      onStatus: s => { linkState = s; st(STATUS[s] || s); },
      onState: s => { linkState = s; st(STATUS[s] || s); },
      onOpen: () => { linkState = 'connected'; st(STATUS.connected); $('#spAR').disabled = false; lib.onLinkOpen(); },
      onClose: () => { linkState = 'disconnected'; st(STATUS.disconnected); },
      onMessage: onMsg,
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
        else { const f = want && vvFiles.get(want); if (f) dv.open(want, f); }
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
  $('#spLib').onclick = () => lib.open();
  $('#spPano').onclick = () => $('#spPanoF').click();
  $('#spPanoF').onchange = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return; e.target.value = '';
    $('#spPanoSt').textContent = 'Loading ' + f.name + '…';
    try { await vs.pick(f); $('#spPanoSt').textContent = f.name + (vs.sameAsQuest() ? '' : ' (not the Quest\'s current picture)') + ': ready for the virtual set.'; }
    catch (err) { $('#spPanoSt').textContent = 'Could not use it: ' + err.message; }
  };
  for (const [id, k] of [['#kThr', 'thr'], ['#kSoft', 'soft'], ['#kSpill', 'spill']]) {
    const el = $(id), v = $(id + 'V'); el.value = vs.K[k]; v.textContent = (+vs.K[k]).toFixed(2);
    el.oninput = () => { vs.setKey(k, +el.value); v.textContent = (+el.value).toFixed(2); };
  }
  $('#kMatte').onchange = e => vs.setMatte(e.target.checked);
  const syncKeyUI = () => { for (const [id, k] of [['#kThr', 'thr'], ['#kSoft', 'soft'], ['#kSpill', 'spill']]) { $(id).value = vs.K[k]; $(id + 'V').textContent = (+vs.K[k]).toFixed(2); } };
  $('#kAuto').onclick = async () => {   // #186
    $('#kAutoSt').textContent = 'Measuring…';
    try { const r = await vs.autoKey(); syncKeyUI(); $('#kAutoSt').textContent = `Done: green fills ${r.cover} % of the view. Now step in; check with Show matte.`; }
    catch (e) { $('#kAutoSt').textContent = 'Auto: ' + e.message; }
  };
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
    R.meshX = a[8]; R.meshY = a[9]; R.r.sideUp = a[10]; R.seen = performance.now();
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
      if (m.hd) onHands(m.hd);
      if (m.vv) onVV(m.vv);
    } else if (m.k === 'full') { onCaseSizes(m.cs); applyCaseSizes(performance.now(), true); for (const a of m.n) nodeSample(a, m.t); }
    else if (m.k === 'layout') { const cs = {}; for (const [k, v] of Object.entries(m.layout.cases || {})) cs[k] = [v[4], v[5], v[6]]; onCaseSizes(cs); }
    else if (m.k === 'rec') onRec(m);
    else if (m.k === 'renv') onRecEnv(m);
    else if (m.k === 'rart') onRecArt(m);
    else if (m.k === 'recdel') onRecDel(m.uid);
    else if (m.k === 'calpt') onCalPoint(m);
    else if (m.k === 'led') led.follow(m.on, m.name, m.t + Math.max(0, questNow() - m.qt) / 1000);   // #176
    else if (m.k === 'sky') vs.onSky(m);
    else if (m.k === 'mls' || m.k === 'mgo' || m.k === 'mok') lib.onMsg(m);   // #185                   // #184
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
  function setMode(m, text) {
    mode = m; hint.textContent = text || HINTS[m] || ''; hint.style.display = (m === 'live' && !text) ? 'none' : '';
    hint.classList.toggle('go', m !== 'live' && m !== 'find');
    if (text && m === 'live') setTimeout(() => { if (mode === 'live') hint.style.display = 'none'; }, 5000);
  }
  const needLink = () => { if (link && link.isOpen) return true; setMode(mode, 'Not connected to the Quest: Exit and Connect first.'); return false; };
  rig.visible = false;   // nothing until it is placed on the phone's floor

  $('#spAR').onclick = async () => {
    ov.hidden = false;
    try {
      renderer.xr.setReferenceSpaceType('local');
      const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'camera-access'], domOverlay: { root: ov } });
      $('#spS').style.display = 'none';
      await renderer.xr.setSession(session);
      scene.background = null; room.visible = false; envI = scene.environmentIntensity; scene.environmentIntensity = 0.6;   // #180 (default of the Quest's passthrough setting); like the Quest in passthrough
      const viewer = await session.requestReferenceSpace('viewer');
      hitSource = await session.requestHitTestSource({ space: viewer });
      touchSource = await session.requestHitTestSourceForTransientInput({ profile: 'generic-touchscreen' }).catch(() => null);
      session.addEventListener('select', onTap);
      vs.onSession(session); $('#bSet').classList.remove('on'); $('#bSet').disabled = !vs.S.can;
      session.addEventListener('end', () => {
        vs.onEnd(); $('#bSet').classList.remove('on');
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
  $('#bSet').onclick = async () => { const msg = await vs.setOn(!vs.S.on); $('#bSet').classList.toggle('on', vs.S.on); setMode(mode === 'live' ? 'live' : mode, msg); if (mode !== 'live') setTimeout(() => setMode(mode), 3000); };
  $('#bKey').onclick = () => { const p = $('#spKey'); p.hidden = !p.hidden; $('#bKey').classList.toggle('on', !p.hidden); };
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
  let infoT = 0, camT = 0, found = false;
  const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _s = new THREE.Vector3();
  renderer.setAnimationLoop((t, frame) => {
    const dt = Math.min(0.05, clock.getDelta()), now = performance.now();
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
    }
    handsTimeout();
    vvFrame(now);
    head.visible = showHead && now - stats.last < 1000;
    if (deckInst) deckInst.update();
    if (neon.userData.update) neon.userData.update(dt);
    try { stepWallGlow(); stepBlobs(); } catch {}
    if (t - infoT > 250) {
      infoT = t;
      const live = link && link.isOpen, stale = now - stats.last > 1000;
      $('#spInfo').textContent = live
        ? `Quest ${stats.xr ? 'in XR' : 'not in XR yet'} · round trip ${stats.rtt.toFixed(0)} ms · pose age ${stale ? 'no data' : stats.age.toFixed(0) + ' ms'} · ${stats.pps}/s · ${nodes.size} parts · ${recs.size} records` + (cal.ok ? ` · cal ${cal.err ?? '-'} cm` : ' · not calibrated') + (vs.S.on ? ` · set ${vs.S.got}/${vs.S.got + vs.S.miss}` + (vs.S.err ? ' ' + vs.S.err : '') : '')
        : 'Not connected to the Quest (' + (STATUS[linkState] || linkState || 'idle') + ')';
    }
    vs.frame(frame);   // #184: camera picture for the key (only while the virtual set is on)
    renderer.render(scene, camera);
  });
  window.spect = { vs, stats, nodes, recs, cal, solve, rig, hands, get link() { return link; }, _set: v => Object.assign(cal, v) };
}
