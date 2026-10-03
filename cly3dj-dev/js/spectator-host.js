// Quest side of the spectator camera (CLAUDE.md #158, #160). Loaded only when Settings > Spectator camera is on.
// Sends small JSON packets; never touches the audio engine. Cost per frame when nobody is connected: one
// boolean check. When connected: one pose read + one ~150-byte message 20 times a second, plus the
// calibration prompt panel and the phone's view outline (a few lines) when those are active.
import * as THREE from 'three';
import { hostLink } from './net-link.js';
import * as media from './medialib.js';

const RATE = 30;                     // state packets per second (the phone interpolates between them)
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _f = new THREE.Vector3();
const r3 = v => Math.round(v * 1000) / 1000, r4 = v => Math.round(v * 10000) / 10000;
const CAL_TEXT = {
  lens: ['Spectator calibration 1/2', 'Touch the phone\'s BACK CAMERA LENS', 'with the controller tip (blue ball),', 'then pull the trigger.'],
  x: ['Spectator calibration 2/2', 'Touch the TAPE X on the floor', 'with the controller tip (blue ball),', 'then pull the trigger.'],
};

export function startHost({ code, stage, rig, scene, renderer, camera, toast, getInputs, getRecords, artBlobs, getLed, getScroll, onLive, getVV, getSky, onMedia, onCam, onPreview, perf, coverFor }) {
  // #209 PerfCap: every mirror message also goes to the PerfCap recorder while it records (phone or not)
  const out = { send(ch, m) { if (link.isOpen) link.send(ch, m); if (perf && perf.on) perf.write(ch, m); } };
  let perfMarks = false;   // #209 PerfCap MARKS mode: each trigger press records a floor mark
  let acc = 0, seq = 0, was = false, calStep = null, doneT = 0;
  let mr = true;   // #164/#167: MR GUI (default on for setting up)
  let lastPing = 0, ledT = 0, ledKey = '', skyKey = '', scrollKey = '', scrollT = 0;   // #169: the phone pings every second; silent for 3.5 s = not connected (a closed page can leave the channel 'open' for ~30 s)
  const status = s => { const el = document.getElementById('spectStatus'); if (el) el.textContent = label(s); };
  const label = s => ({ relay: 'Waiting for the phone (code ' + code + ')', 'relay-retry': 'No internet for the handshake, retrying…',
    connected: 'Phone connected', disconnected: 'Phone disconnected', failed: 'Phone link failed' }[s] || s);
  const layout = () => ({ k: 'layout', layout: stage.snapshot(), rig: rig.position.toArray().map(r3) });

  // ---- prompt panel in the headset (DOM toasts are invisible in XR)
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 320;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.13), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  panel.renderOrder = 999; panel.visible = false; scene.add(panel);
  // #211 picture of the point to touch (the whole shot + a close-up), under the text
  const icv = document.createElement('canvas'); icv.width = 1024; icv.height = 480;
  const itex = new THREE.CanvasTexture(icv); itex.colorSpace = THREE.SRGBColorSpace;
  const ipanel = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.197), new THREE.MeshBasicMaterial({ map: itex, transparent: true, depthTest: false }));
  ipanel.renderOrder = 999; ipanel.position.y = -0.168; ipanel.visible = false; panel.add(ipanel);
  let imgSeq = 0;
  function showImg(url) {
    const n = ++imgSeq; if (!url) { ipanel.visible = false; return; }
    const im = new Image(); im.onload = () => {
      if (n !== imgSeq) return;
      const g = icv.getContext('2d'); g.clearRect(0, 0, 1024, 480);
      g.fillStyle = 'rgba(10,12,18,0.9)'; g.beginPath(); g.roundRect(4, 4, 1016, 472, 24); g.fill(); g.strokeStyle = '#ffd040'; g.lineWidth = 5; g.stroke();
      const k = Math.min(1000 / im.width, 456 / im.height), w = im.width * k, h = im.height * k;
      g.drawImage(im, (1024 - w) / 2, (480 - h) / 2, w, h); itex.needsUpdate = true; ipanel.visible = true;
    };
    im.src = url;
  }
  function say(lines, color = '#39a8ff') {
    const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = 'rgba(10,12,18,0.86)'; g.beginPath(); g.roundRect(4, 4, cv.width - 8, cv.height - 8, 28); g.fill();
    g.strokeStyle = color; g.lineWidth = 6; g.stroke();
    g.textAlign = 'center'; g.fillStyle = color; g.font = '700 54px system-ui,sans-serif'; g.fillText(lines[0], 512, 76);
    g.fillStyle = '#e6e8ec'; g.font = '500 46px system-ui,sans-serif';
    lines.slice(1).forEach((l, i) => g.fillText(l, 512, 150 + i * 62));
    tex.needsUpdate = true; panel.visible = true; placed = false;
  }
  let placed = false;
  function placePanel() { // float it in front of the eyes, a little low; re-centre when it drifts out of view
    const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    cam.matrixWorld.decompose(_p, _q, _s);
    _f.set(0, -0.12, -0.6).applyQuaternion(_q).add(_p);
    if (!placed || panel.position.distanceTo(_f) > 0.35) { panel.position.copy(_f); placed = true; }
    else panel.position.lerp(_f, 0.05);
    panel.lookAt(_p);
  }

  // ---- the phone's view, drawn as an outline in the room (phone sends its pose once calibrated)
  const frustum = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x39a8ff, transparent: true, opacity: 0.55 }));
  frustum.visible = false; rig.add(frustum); let camT = 0, fovKey = '';
  function setFrustum(fov, asp) {
    const key = fov.toFixed(3) + asp.toFixed(3); if (key === fovKey) return; fovKey = key;
    const D = 3.5, h = Math.tan(fov / 2) * D, w = h * asp, n = 0.06, hn = h * n / D, wn = w * n / D;
    const c = [[-w, -h], [w, -h], [w, h], [-w, h]], cn = [[-wn, -hn], [wn, -hn], [wn, hn], [-wn, hn]], v = [];
    for (let i = 0; i < 4; i++) {
      const [a, b] = c[i], [a2, b2] = c[(i + 1) % 4], [an, bn] = cn[i], [an2, bn2] = cn[(i + 1) % 4];
      v.push(an, bn, -n, a, b, -D);                 // edge from the lens outwards
      v.push(a, b, -D, a2, b2, -D);                 // far frame
      v.push(an, bn, -n, an2, bn2, -n);             // small frame at the lens
    }
    frustum.geometry.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  }

  // ---- #212 while the phone's point calibration runs, the gear is hidden in the headset too (only faint cyan boxes
  // round each piece), so real corners under the virtual decks / case can be seen and touched. Back when it ends.
  const gLine = new THREE.LineBasicMaterial({ color: 0x39e0ff, transparent: true, opacity: 0.25, depthTest: false, depthWrite: false });
  let ghosted = false, gOut = [];
  const _gm = new THREE.Matrix4(), _gm2 = new THREE.Matrix4(), _gb = new THREE.Box3(), _gs = new THREE.Vector3(), _gc = new THREE.Vector3();
  function ghost(on) {
    if (on === ghosted) return; ghosted = on;
    for (const l of gOut) { l.parent && l.parent.remove(l); l.geometry.dispose(); } gOut = [];
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
    for (const top of rig.children) {   // one box per piece of gear, in its own frame (turns with it)
      if (!top.visible || top.isLight || top === frustum) continue;
      const box = new THREE.Box3(), inv = _gm.copy(top.matrixWorld).invert();
      top.traverse(o => {
        if (!o.isMesh || !o.visible || !o.geometry || (o.material && o.material.userData.ghost && o.material.userData.ghost.c === false)) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        _gb.copy(o.geometry.boundingBox).applyMatrix4(_gm2.multiplyMatrices(inv, o.matrixWorld)); box.union(_gb);
      });
      if (box.isEmpty()) continue;
      box.getSize(_gs); box.getCenter(_gc);
      if (Math.max(_gs.x, _gs.y, _gs.z) < 0.02 || Math.max(_gs.x, _gs.y, _gs.z) > 6) continue;   // specks / sky / room shell
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(Math.max(_gs.x, 0.002), Math.max(_gs.y, 0.002), Math.max(_gs.z, 0.002))), gLine);
      l.position.copy(_gc); l.renderOrder = 20; l.raycast = () => {}; top.add(l); gOut.push(l);
    }
  }

  // ---- calibration: the trigger (or a pinch) marks the tip of whichever hand pressed it
  function onTrigger(i) {
    const st = (getInputs() || [])[i]; if (!st || !st.connected) return;
    if (perfMarks && perf && !calStep) { perf.mark(rig.worldToLocal(st.tip.clone()).toArray().map(r4)); return; }   // #209 (#210 rig space, the rig may turn)
    if (!calStep || !link.isOpen) return;
    const p = rig.worldToLocal(st.tip.clone());   // #210 rig space (the rig turns with its spatial anchor)
    link.send('ctl', { k: 'calpt', step: calStep, p: p.toArray().map(r4), qt: performance.now() });
    calStep = null; panel.visible = false;
  }
  for (const i of [0, 1]) renderer.xr.getController(i).addEventListener('selectstart', () => onTrigger(i));
  for (const i of [0, 1]) renderer.xr.getController(i).addEventListener('squeezestart', () => {   // #211 grip = skip this auto point
    if ((calStep === 'flens' || (calStep === 'pt' && ipanel.visible)) && link.isOpen) link.send('ctl', { k: 'calskip' });
  });


  // ---- scene mirror (#161): the phone builds the same gear from the same code; we send what moves.
  // Every node under each gear root (stage items + flight cases) gets an id = root key + child-index path.
  // Each tick, only nodes whose local transform or visibility changed are sent. Records are separate (below).
  let reg = new Map(), regT = 0, full = false;
  const _riq = new THREE.Quaternion();   // #210 inverse of the rig's turn, set each tick
  const _rm = new THREE.Matrix4(), _ri = new THREE.Matrix4(), _rp = new THREE.Vector3(), _rq = new THREE.Quaternion(), _rs = new THREE.Vector3();
  function buildRegistry() {
    const recs = new Set(getRecords().map(r => r.group)), next = new Map();
    const roots = [...Object.entries(stage.items).filter(([k]) => k !== 'preview').map(([k, v]) => [k, v.obj]), ...Object.entries(stage.cases).map(([k, c]) => [k, c.group])];
    const walk = (o, id) => { if (recs.has(o) || o.userData.noMirror) return;   // #195 noMirror: headset-only parts (preview lid, tablet corner)
      next.set(id, reg.get(id)?.o === o ? reg.get(id) : { o, last: null }); o.children.forEach((c, i) => walk(c, id + '.' + i)); };
    for (const [k, o] of roots) walk(o, k);
    reg = next;
  }
  const E = 2e-4;
  function nodeDiffs(all) {
    const out = [];
    for (const [id, e] of reg) {
      const o = e.o, p = o.position, q = o.quaternion, sc = o.scale.x, v = o.visible ? 1 : 0, L = e.last;
      if (!all && L && Math.abs(L[0] - p.x) < E && Math.abs(L[1] - p.y) < E && Math.abs(L[2] - p.z) < E && Math.abs(L[3] - q.x) < E && Math.abs(L[4] - q.y) < E &&
        Math.abs(L[5] - q.z) < E && Math.abs(L[6] - q.w) < E && Math.abs(L[7] - sc) < 5e-4 && L[8] === v) continue;
      e.last = [p.x, p.y, p.z, q.x, q.y, q.z, q.w, sc, v]; e.t = performance.now();
      out.push([id, r4(p.x), r4(p.y), r4(p.z), r4(q.x), r4(q.y), r4(q.z), r4(q.w), r4(sc), v]);
    }
    return out;
  }
  // the state channel may drop packets, so once a second the final pose of anything that moved in the
  // last 5 s goes again on the reliable channel (a fader that stopped moving can't stay stuck half way)
  let settleT = 0;
  function settled(now) {
    const out = [];
    for (const [id, e] of reg) if (e.t && now - e.t < 5000 && e.last) { const L = e.last; out.push([id, r4(L[0]), r4(L[1]), r4(L[2]), r4(L[3]), r4(L[4]), r4(L[5]), r4(L[6]), r4(L[7]), L[8]]); }
    return out;
  }
  // flight case sizes (#163): a resize rebuilds the case, so the phone must rebuild its copy too
  const caseDims = {};
  function caseSizes(all) {
    let out = null;
    for (const [k, c] of Object.entries(stage.cases)) {
      const d = [r4(c.W), r4(c.D), r4(c.H)], L = caseDims[k];
      if (all || !L || L[0] !== d[0] || L[1] !== d[1] || L[2] !== d[2]) { caseDims[k] = d; (out = out || {})[k] = d; }
    }
    return out;
  }
  // #177 VideoVinyl: LED wall mode, the two deck gains and, per deck with a video, its title key, playhead and speed
  function vvTick() {
    if (!getVV) return null;
    const V = getVV();
    return { mode: V.mode, gains: V.gains.map(r4), decks: V.decks.map(([i, key, pos, rate]) => [i, key, r3(pos), r4(rate)]) };
  }
  // ---- records: sent once (track info, groove envelope, label image), then followed by their transform
  const uidOf = new WeakMap(); let nextUid = 1; const live = new Map();   // uid -> { r, env: {A,B}, art: {A,B} }
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const meta = t => t ? { id: t.id, title: t.title, artist: t.artist, bpm: t.bpm, duration: t.duration, split: t.split, missing: t.missing } : null;
  function recordsTick() {   // #217: the rows are 'rows' (a local 'out' hid the sender: out.send threw on every new record)
    const rows = [], seen = new Set();
    _ri.copy(rig.matrixWorld).invert();
    for (const r of getRecords()) {
      if (!r || r.disposed) continue;
      let uid = uidOf.get(r); if (!uid) { uid = nextUid++; uidOf.set(r, uid); }
      seen.add(uid);
      let L = live.get(uid);
      if (!L) { L = { r, env: {}, art: {} }; live.set(uid, L); out.send('ctl', { k: 'rec', uid, rec: { id: r.rec.id, sides: { A: meta(r.rec.sides.A), B: meta(r.rec.sides.B) } }, sideUp: r.sideUp }); }
      for (const side of ['A', 'B']) {
        const env = r.envs[side];
        if (env && L.env[side] !== env) {   // 8192 bins 0..1 -> 16 bit, ~22 KB once per side
          L.env[side] = env; const q = new Uint16Array(env.length); for (let i = 0; i < env.length; i++) q[i] = Math.round(Math.max(0, Math.min(1, env[i])) * 65535);
          out.send('ctl', { k: 'renv', uid, side, dur: r.durations[side] || 0, env: b64(new Uint8Array(q.buffer)) });
        }
        const t = r.rec.sides[side], blob = t && r.labelImgs[side] && artBlobs.get(t.id);
        if (blob && !L.art[side]) {   // the cover exactly as stored in the MP3, no re-encoding
          L.art[side] = 'pending';
          blob.arrayBuffer().then(buf => { if (live.get(uid) === L) out.send('ctl', { k: 'rart', uid, side, mime: blob.type, img: b64(new Uint8Array(buf)) }); L.art[side] = 'sent'; }).catch(() => { L.art[side] = null; });
        }
      }
      r.group.updateMatrixWorld(); _rm.multiplyMatrices(_ri, r.group.matrixWorld); _rm.decompose(_rp, _rq, _rs);
      rows.push([uid, r4(_rp.x), r4(_rp.y), r4(_rp.z), r4(_rq.x), r4(_rq.y), r4(_rq.z), r4(_rq.w), r4(r.mesh.rotation.x), r4(r.mesh.position.y), r.sideUp]);
    }
    for (const uid of [...live.keys()]) if (!seen.has(uid)) { live.delete(uid); out.send('ctl', { k: 'recdel', uid }); }
    return rows;
  }
  // ---- #218 the record crate on the phone: the view (sent when it changes), the lid screen (JPEG, at most every
  // 0.4 s) and covers (256 px JPEG, when the phone asks; PerfCap takes get each cover once too)
  let crateMsg = null, crateSent = '', scrCanvas = null, scrDirty = false, scrT = 0, scrBusy = false, lastScr = null;
  const perfCov = new Set(); let perfCovQ = Promise.resolve();
  function crate(m) {
    crateMsg = m;
    if (perf && perf.on) for (const it of m.items) if (it[1] && !perfCov.has(it[1])) { const key = it[1]; perfCov.add(key); perfCovQ = perfCovQ.then(() => coverMsg(key)).then(cm => { if (cm && perf.on) perf.write('ctl', cm); }).catch(() => {}); }
  }
  function crateScreen(c) { scrCanvas = c; scrDirty = true; }
  const scrC = document.createElement('canvas'); scrC.width = 512; scrC.height = 480;
  function crateTick(now) {
    if (crateMsg) { const j = JSON.stringify(crateMsg); if (j !== crateSent) { crateSent = j; out.send('ctl', crateMsg); } }
    if (scrDirty && scrCanvas && !scrBusy && now - scrT > 400) {
      scrDirty = false; scrT = now; scrBusy = true;
      scrC.getContext('2d').drawImage(scrCanvas, 0, 0, 512, 480);
      scrC.toBlob(b => { if (!b) { scrBusy = false; return; } b.arrayBuffer().then(buf => { lastScr = { k: 'cscr', img: b64(new Uint8Array(buf)) }; out.send('ctl', lastScr); scrBusy = false; }); }, 'image/jpeg', 0.7);
    }
  }
  async function shrink(blob) {   // cover -> 256 px JPEG (about 15 to 30 KB)
    const bm = await createImageBitmap(blob), s = Math.min(1, 256 / Math.max(bm.width, bm.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bm.width * s)); c.height = Math.max(1, Math.round(bm.height * s));
    c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height); bm.close();
    const j = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
    return new Uint8Array(await j.arrayBuffer());
  }
  const shrunk = new Map();   // key -> b64 (or '' = no cover), small in-memory cache for repeat requests
  async function coverMsg(key) {
    if (!shrunk.has(key)) {
      let v = '';
      try { const blob = coverFor ? await coverFor(key) : null; if (blob) v = b64(await shrink(blob)); } catch {}
      shrunk.set(key, v); if (shrunk.size > 400) shrunk.delete(shrunk.keys().next().value);
    }
    const v = shrunk.get(key); return { k: 'cover', key, img: v || null };
  }
  let covQ = Promise.resolve();
  function onCoverAsk(key) { covQ = covQ.then(() => coverMsg(key)).then(m => { if (link.isOpen) link.send('ctl', m); }).catch(() => {}); }
  let haveWait = null;
  async function prepCovers(keys, onStep) {   // PREP COVERS: ask which the phone has, send the rest one by one
    if (!link.isOpen) throw new Error('phone not connected');
    const have = new Set();
    for (let i = 0; i < keys.length; i += 500) {
      const part = keys.slice(i, i + 500);
      const got = await new Promise((res, rej) => { haveWait = res; link.send('ctl', { k: 'covhave?', keys: part }); setTimeout(() => { if (haveWait === res) { haveWait = null; rej(new Error('the phone did not answer (reload Cly3DJ on the phone)')); } }, 15000); });
      for (const k of got) have.add(k);
    }
    const st = { i: 0, n: keys.length, sent: 0 };
    for (const key of keys) {
      st.i++;
      if (!have.has(key)) {
        const m = await coverMsg(key);
        if (m.img) { if (!link.isOpen) throw new Error('phone disconnected'); link.send('ctl', m); st.sent++; await new Promise(r => setTimeout(r, 15)); }
      }
      if (onStep && onStep(st)) break;
    }
    return st;
  }

  // ---- hands / controllers, so the phone can let the real hands show in front of the gear
  function handsTick() {
    const out = [], inputs = getInputs() || [];
    for (const st of inputs) {
      if (!st || !st.connected) continue;
      if (st.isHand) {
        const h = renderer.xr.getHand(st.i), a = [];
        for (const j of Object.values(h.joints || {})) { if (!j.visible) continue; rig.worldToLocal(j.getWorldPosition(_rp)); a.push(r3(_rp.x), r3(_rp.y), r3(_rp.z)); }
        if (a.length >= 30) out.push([st.i, 'h', a]);
      } else if (st.grip) {
        st.grip.matrixWorld.decompose(_rp, _rq, _rs); rig.worldToLocal(_rp); _rq.premultiply(_riq);
        out.push([st.i, 'c', [r3(_rp.x), r3(_rp.y), r3(_rp.z), r4(_rq.x), r4(_rq.y), r4(_rq.z), r4(_rq.w)]]);
      }
    }
    return out;
  }

  // #185 media pushes from the phone's library: one file at a time, resumable (medialib.beginReceive)
  let rx = null, rxQ = Promise.resolve(), camState = null;
  async function mediaList() { const all = await media.listAll(); const items = []; for (const f of media.FOLDERS) for (const it of all[f]) items.push([f, it.name, it.size]); return items; }
  function sendList() { mediaList().then(items => { if (link.isOpen) link.send('ctl', { k: 'mls', items }); }); }
  function onMediaMsg(m) {
    rxQ = rxQ.then(async () => {
      if (m.k === 'mls?') sendList();
      else if (m.k === 'mput') {
        if (rx) { await rx.abort(); rx = null; }
        const r = await media.beginReceive(m.f, m.n, m.size);
        if (r.have) { link.send('ctl', { k: 'mok', f: m.f, n: m.n }); resolveWait(m.f, m.n, 'rx'); return; }
        if (m.thumb) { try { await media.putThumb(m.f, m.n, new Blob([Uint8Array.from(atob(m.thumb), c => c.charCodeAt(0))], { type: 'image/jpeg' })); } catch {} }
        rx = r.rx; rx.t0 = performance.now(); rx.req = m.n; if (!sync.on) toast && toast(`Receiving ${m.n}…`, 2500);
        link.send('ctl', { k: 'mgo', f: m.f, n: m.n, off: r.off });
      } else if (m.k === 'mdel') { await media.remove(m.f, m.n); sendList(); onMedia && onMedia(); }
      else if (m.k === 'mls') { if (listWait) { const w = listWait; listWait = null; w(m.items || []); } }   // #206 the phone's list (media sync)
      else if (m.k === 'mpullx') resolveWait(m.f, m.n, 'mpullx');
    }).catch(e => { toast && toast('Media: ' + e.message, 4000); });
  }
  function onBin(buf, label) {
    if (label === 'prev') { onPreview && onPreview(buf); return; }   // #188
    const r = rx; if (!r) return;
    if (r.write(buf)) {
      rx = null;
      r.finish().then(() => {
        link.send('ctl', { k: 'mok', f: r.folder, n: r.req || r.name }); sendList(); onMedia && onMedia(); resolveWait(r.folder, r.req || r.name, 'rx');
        const s = (performance.now() - r.t0) / 1000; if (!sync.on) toast && toast(`${r.name} received (${(r.size / 1048576).toFixed(1)} MB, ${((r.size - r.off) / 1048576 / Math.max(0.1, s)).toFixed(1)} MB/s)`, 3000);
      }).catch(e => toast && toast('Media save failed: ' + e.message, 4000));
    }
  }
  // ---- #206 MEDIA SYNC page (the mixer's VIDEO page, SYNC): lists what the Quest's and the phone's libraries have
  // (Pano, Video pano, Video, Images; plus the Quest's VideoVinyl clips stored with its songs, offered as Video), the
  // owner picks items, and each picked item is copied to the side that doesn't have it. Only adds: nothing is deleted
  // or overwritten (a name on both sides is left alone). Phone to Quest uses the #185 push (the Quest asks for each
  // file: 'mpull'); Quest to phone is the same protocol the other way ('qput' / 'qgo' / 'qok', chunks on 'file').
  const CH = 64 * 1024;
  const sync = { on: false, i: 0, n: 0, name: '', dir: '', pct: 0, done: 0, skipped: 0, err: '' };
  const waits = new Map(); let listWait = null;
  function waitMsg(kinds, f, n, ms) {
    return new Promise((res, rej) => {
      const key = f + '/' + n, t = setTimeout(() => { waits.delete(key); rej(new Error('no answer from the phone')); }, ms);
      waits.set(key, { kinds, res: m => { clearTimeout(t); waits.delete(key); res(m); } });
    });
  }
  function resolveWait(f, n, k, m) { const w = waits.get(f + '/' + n); if (w && w.kinds.includes(k)) w.res(m || { k }); }
  const toB64 = async blob => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); };
  // both lists: [{ f, n, size, q: on the Quest, p: on the phone, get? }] sorted by folder then name
  async function syncList(getExtras) {
    if (!link.isOpen) throw new Error('phone not connected');
    const phoneItems = await new Promise((res, rej) => { listWait = res; link.send('ctl', { k: 'mls?' }); setTimeout(() => { if (listWait === res) { listWait = null; rej(new Error('the phone did not send its list (reload Cly3DJ on the phone)')); } }, 10000); });
    const all = new Map();
    for (const [f, n, size] of await mediaList()) all.set(f + '/' + n, { f, n, size, q: true, p: false });
    for (const e of (getExtras ? await getExtras() : [])) { const k = e.f + '/' + e.n; if (!all.has(k)) all.set(k, { ...e, q: true, p: false }); }
    for (const [f, n, size] of phoneItems) { const k = f + '/' + n, it = all.get(k); if (it) it.p = true; else all.set(k, { f, n, size, q: false, p: true }); }
    const order = [...media.FOLDERS];
    return [...all.values()].sort((a, b) => order.indexOf(a.f) - order.indexOf(b.f) || a.n.localeCompare(b.n));
  }
  // copy the picked items to whichever side is missing them, one at a time
  async function syncCopy(items, onStep) {
    if (sync.on) return sync;
    if (!link.isOpen) throw new Error('phone not connected');
    if (!link.fileOpen) throw new Error('reload Cly3DJ on the phone, then Connect again');
    const list = items.filter(it => it.q !== it.p);
    Object.assign(sync, { on: true, i: 0, n: list.length, name: '', dir: '', pct: 0, done: 0, skipped: 0, err: '' }); onStep && onStep(sync);
    const tick = setInterval(() => { if (sync.dir === 'in' && rx) sync.pct = Math.round(rx.got / rx.size * 100); onStep && onStep(sync); }, 500);
    try {
      for (const it of list) {
        Object.assign(sync, { i: sync.i + 1, name: it.n, dir: it.p ? 'in' : 'out', pct: 0 }); onStep && onStep(sync);
        if (it.p) {   // phone -> Quest
          const got = waitMsg(['rx', 'mpullx'], it.f, it.n, 60 * 60000);
          link.send('ctl', { k: 'mpull', f: it.f, n: it.n });
          const a = await got; if (a.k === 'mpullx') sync.skipped++; else { sync.done++; it.q = true; }
          continue;
        }
        const file = it.get ? await it.get().catch(() => null) : await media.getFile(it.f, it.n);   // Quest -> phone
        if (!file) { sync.skipped++; continue; }
        let tb = await media.getThumb(it.f, it.n); if (!tb) tb = await media.makeThumb(file, it.f).catch(() => null);
        const a0 = waitMsg(['qgo', 'qok'], it.f, it.n, 30000);
        link.send('ctl', { k: 'qput', f: it.f, n: it.n, size: file.size, thumb: tb ? await toB64(tb) : null });
        const a = await a0;
        if (a.k !== 'qok') {
          const done = waitMsg(['qok'], it.f, it.n, 60 * 60000);
          for (let pos = a.off || 0; pos < file.size; pos += CH) {
            await link.sendBin(await file.slice(pos, Math.min(file.size, pos + CH)).arrayBuffer());
            sync.pct = Math.min(100, Math.round((pos + CH) / file.size * 100));
          }
          await done;
        }
        sync.done++; it.p = true;
      }
    } catch (e) { sync.err = e.message; }
    finally { clearInterval(tick); sync.on = false; sendList(); onMedia && onMedia(); onStep && onStep(sync); }
    return sync;
  }
  const link = hostLink(code, {
    onStatus: status,
    onTrack: t => { onLive && onLive(t); },   // #238 LIVE CAM
    onBinary: onBin,
    onState: s => status(s),
    onOpen: () => { crateSent = ''; if (lastScr) scrDirty = true; link.send('ctl', layout()); link.send('ctl', { k: 'mr', on: mr }); ledT = 0; ledKey = ''; skyKey = ''; scrollKey = ''; full = true; live.clear(); toast && toast('Spectator phone connected', 2500); status('connected'); },
    onClose: () => { onLive && onLive(null); if (rx) { rx.abort(); rx = null; } camState = null; onCam && onCam(null); status('disconnected'); calStep = null; ghost(false); panel.visible = false; frustum.visible = false; },
    onMessage: m => {
      if (m.k === 'qgo' || m.k === 'qok') { resolveWait(m.f, m.n, m.k, m); return; }   // #206 media sync, Quest to phone
      if (m.k[0] === 'm' && m.k !== 'mr') { onMediaMsg(m); return; }   // #185 mls? / mput / mdel (#206 mls / mpullx)
      if (m.k === 'cst') { camState = m; onCam && onCam(m); return; }   // #188 the phone's camera / key / look state
      if (m.k === 'cover?') { onCoverAsk(m.key); return; }   // #218
      if (m.k === 'covhave') { if (haveWait) { const w = haveWait; haveWait = null; w(m.keys || []); } return; }
      if (m.k === 'ping') { lastPing = performance.now(); link.send('ctl', { k: 'pong', t: m.t, qt: performance.now() }); }
      else if (m.k === 'cal') {
        if (m.step === 'lens' || m.step === 'x') { calStep = m.step; showImg(null); say(CAL_TEXT[m.step]); toast && toast(CAL_TEXT[m.step].slice(1).join(' '), 6000); }
        else if (m.step === 'flens') {   // #213 fixed camera step 1: the phone's own lens
          calStep = 'flens'; ghost(true); showImg(null);
          const t = ['Fixed camera calibration', `Touch the phone's ${m.cam === 'user' ? 'FRONT (selfie)' : 'BACK (main)'} LENS`, 'with the controller tip, pull the trigger.', 'Grip = skip this step.'];
          say(t); toast && toast(t.slice(1).join(' '), 6000);
        }
        else if (m.step === 'hold') { calStep = null; panel.visible = false; showImg(null); }   // #213 phone is waiting for a tap; gear stays hidden
        else if (m.step === 'pt') {   // #208 fixed camera tap calibration: one numbered mark at a time
          calStep = 'pt';
          const t = m.img ? ['Fixed camera calibration', `Touch POINT ${m.n} of ${m.of} (yellow, below)`, 'with the controller tip, pull the trigger.', 'Grip = skip this point.']
            : ['Fixed camera calibration', `Touch MARK ${m.n} on the floor`, 'with the controller tip (blue ball),', 'then pull the trigger.'];
          ghost(true); say(t); showImg(m.img); toast && toast(t.slice(1).join(' '), 6000);
        }
        else if (m.step === 'done') { calStep = null; ghost(false); showImg(null); say(['Spectator camera calibrated', m.px != null ? 'Match: ' + m.px + ' px' : m.err != null ? 'Match: ' + m.err + ' cm' : '', 'The blue outline shows what it films.'], '#40d080'); doneT = 3; }
        else { calStep = null; ghost(false); panel.visible = false; showImg(null); }
      } else if (m.k === 'cam') {
        setFrustum(m.fov, m.asp); frustum.position.fromArray(m.p); frustum.quaternion.fromArray(m.q); frustum.visible = mr; camT = 0;
      }
    },
  });
  // any saved layout change (moving gear, resizing the case) goes to the phone too
  const save = stage.save.bind(stage);
  stage.save = () => { save(); out.send('ctl', layout()); };   // #209 out: phone and PerfCap

  function tick(dt) {
    if (panel.visible) { placePanel(); if (doneT > 0 && (doneT -= dt) <= 0) panel.visible = false; }
    if (frustum.visible && (camT += dt) > 2) frustum.visible = false;   // phone stopped sending: hide it
    const open = link.isOpen || !!(perf && perf.on); if (!open) { was = false; return; }   // #209 PerfCap records without a phone too
    if (!was) { was = true; acc = 1; }
    acc += dt; if (acc < 1 / RATE) return; acc = 0;
    crateTick(performance.now());   // #218
    const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    rig.updateMatrixWorld(); rig.getWorldQuaternion(_riq).invert();
    cam.matrixWorld.decompose(_p, _q, _s); rig.worldToLocal(_p); _q.premultiply(_riq);   // rig space (#210: the rig can turn, with its spatial anchor)
    const now = performance.now();
    if (getLed) {   // #176: which LED wall clip is playing and where; the phone plays its own copy of the same file
      const L = getLed(), key = (L.on ? 1 : 0) + '|' + (L.name || '');
      if (key !== ledKey || now - ledT > 2000) { ledKey = key; ledT = now; out.send('ctl', { k: 'led', on: L.on, name: L.name, t: L.t, qt: now }); }
    }
    if (getScroll) {   // #236 the VJ scroller: the phone draws its own copy from the text, wave and speed
      const S = getScroll(), k = JSON.stringify(S);
      if (k !== scrollKey || now - scrollT > 3000) { scrollKey = k; scrollT = now; out.send('ctl', { k: 'scroll', ...S }); }
    }
    if (getSky) {   // #184: panorama height / turn / type for the phone's virtual set (the phone has its own copy of the image)
      const S = getSky(), k = JSON.stringify(S);
      if (k !== skyKey) { skyKey = k; out.send('ctl', { k: 'sky', ...S }); }
    }
    if (full || now - regT > 2000) { regT = now; buildRegistry(); }
    if (full) { full = false; out.send('ctl', { k: 'full', t: Math.round(now), cs: caseSizes(true), n: nodeDiffs(true) }); }
    else if (now - settleT > 1000) { settleT = now; const n = settled(now); if (n.length) out.send('ctl', { k: 'full', t: Math.round(now), n }); }
    out.send('state', { k: 's', n: seq++, t: Math.round(now), xr: renderer.xr.isPresenting ? 1 : 0,
      h: [r3(_p.x), r3(_p.y), r3(_p.z), r4(_q.x), r4(_q.y), r4(_q.z), r4(_q.w)],
      cs: caseSizes(false), g: nodeDiffs(false), r: recordsTick(), vv: vvTick(), hd: renderer.xr.isPresenting ? handsTick() : [] });
  }
  // #167: one switch. ON = viewfinder outline here + helpers and menus on the phone; OFF = everything hidden
  // (the phone shows only camera + gear: start its screen recorder by hand)
  function setMR(on) {
    mr = on; if (!on) frustum.visible = false; out.send('ctl', { k: 'mr', on });
    say(on ? ['MR GUI ON', 'Viewfinder here, menus + helpers on the phone.'] : ['MR GUI OFF', 'Phone is clean: start its screen recorder,', 'then clap once.'], on ? '#39a8ff' : '#ff5060'); doneT = 2.5;
  }
  return { tick, close: () => { link.close(); scene.remove(panel); rig.remove(frustum); },
    ui: () => ({ mr, phone: link.isOpen && performance.now() - lastPing < 3500 }), setMR,
    liveCam: on => link.send('ctl', { k: 'live', on: !!on }),   // #238 ask the phone to start / stop its LIVE CAM video
    // #188 camera tab: the phone's last reported state, and remote changes to it
    get cam() { return link.isOpen && performance.now() - lastPing < 3500 ? camState : null; },
    camSet: o => link.isOpen && link.send('ctl', { k: 'cset', ...o }),
    syncList, syncCopy, get sync() { return sync; },
    // #209 PerfCap: a take starts with a full snapshot (layout, every part, every record with its grooves / labels)
    crate, crateScreen, prepCovers,   // #218
    perfBegin() { full = true; live.clear(); ledKey = ''; skyKey = ''; scrollKey = ''; crateSent = ''; scrDirty = !!scrCanvas; perfCov.clear(); if (crateMsg) crate(crateMsg); if (perf && perf.on) { perf.write('ctl', layout()); perf.write('ctl', { k: 'mr', on: mr }); } },
    get perfMarks() { return perfMarks; }, set perfMarks(v) { perfMarks = !!v; } };
}
