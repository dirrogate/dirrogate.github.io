// Quest side of the spectator camera (CLAUDE.md #158, #160). Loaded only when Settings > Spectator camera is on.
// Sends small JSON packets; never touches the audio engine. Cost per frame when nobody is connected: one
// boolean check. When connected: one pose read + one ~150-byte message 20 times a second, plus the
// calibration prompt panel and the phone's view outline (a few lines) when those are active.
import * as THREE from 'three';
import { hostLink } from './net-link.js';

const RATE = 30;                     // state packets per second (the phone interpolates between them)
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _f = new THREE.Vector3();
const r3 = v => Math.round(v * 1000) / 1000, r4 = v => Math.round(v * 10000) / 10000;
const CAL_TEXT = {
  lens: ['Spectator calibration 1/2', 'Touch the phone\'s BACK CAMERA LENS', 'with the controller tip (blue ball),', 'then pull the trigger.'],
  x: ['Spectator calibration 2/2', 'Touch the TAPE X on the floor', 'with the controller tip (blue ball),', 'then pull the trigger.'],
};

export function startHost({ code, stage, rig, scene, renderer, camera, toast, getInputs, getRecords, artBlobs }) {
  let acc = 0, seq = 0, was = false, calStep = null, doneT = 0;
  const status = s => { const el = document.getElementById('spectStatus'); if (el) el.textContent = label(s); };
  const label = s => ({ relay: 'Waiting for the phone (code ' + code + ')', 'relay-retry': 'No internet for the handshake, retrying…',
    connected: 'Phone connected', disconnected: 'Phone disconnected', failed: 'Phone link failed' }[s] || s);
  const layout = () => ({ k: 'layout', layout: stage.snapshot(), rig: rig.position.toArray().map(r3) });

  // ---- prompt panel in the headset (DOM toasts are invisible in XR)
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 320;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.13), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  panel.renderOrder = 999; panel.visible = false; scene.add(panel);
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

  // ---- calibration: the trigger (or a pinch) marks the tip of whichever hand pressed it
  function onTrigger(i) {
    if (!calStep || !link.isOpen) return;
    const st = (getInputs() || [])[i]; if (!st || !st.connected) return;
    const p = st.tip.clone().sub(rig.position);
    link.send('ctl', { k: 'calpt', step: calStep, p: p.toArray().map(r4), qt: performance.now() });
    calStep = null; panel.visible = false;
  }
  for (const i of [0, 1]) renderer.xr.getController(i).addEventListener('selectstart', () => onTrigger(i));


  // ---- scene mirror (#161): the phone builds the same gear from the same code; we send what moves.
  // Every node under each gear root (stage items + flight cases) gets an id = root key + child-index path.
  // Each tick, only nodes whose local transform or visibility changed are sent. Records are separate (below).
  let reg = new Map(), regT = 0, full = false;
  const _rm = new THREE.Matrix4(), _ri = new THREE.Matrix4(), _rp = new THREE.Vector3(), _rq = new THREE.Quaternion(), _rs = new THREE.Vector3();
  function buildRegistry() {
    const recs = new Set(getRecords().map(r => r.group)), next = new Map();
    const roots = [...Object.entries(stage.items).map(([k, v]) => [k, v.obj]), ...Object.entries(stage.cases).map(([k, c]) => [k, c.group])];
    const walk = (o, id) => { if (recs.has(o)) return; next.set(id, reg.get(id)?.o === o ? reg.get(id) : { o, last: null }); o.children.forEach((c, i) => walk(c, id + '.' + i)); };
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
  // ---- records: sent once (track info, groove envelope, label image), then followed by their transform
  const uidOf = new WeakMap(); let nextUid = 1; const live = new Map();   // uid -> { r, env: {A,B}, art: {A,B} }
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const meta = t => t ? { id: t.id, title: t.title, artist: t.artist, bpm: t.bpm, duration: t.duration, split: t.split, missing: t.missing } : null;
  function recordsTick() {
    const out = [], seen = new Set();
    _ri.copy(rig.matrixWorld).invert();
    for (const r of getRecords()) {
      if (!r || r.disposed) continue;
      let uid = uidOf.get(r); if (!uid) { uid = nextUid++; uidOf.set(r, uid); }
      seen.add(uid);
      let L = live.get(uid);
      if (!L) { L = { r, env: {}, art: {} }; live.set(uid, L); link.send('ctl', { k: 'rec', uid, rec: { id: r.rec.id, sides: { A: meta(r.rec.sides.A), B: meta(r.rec.sides.B) } }, sideUp: r.sideUp }); }
      for (const side of ['A', 'B']) {
        const env = r.envs[side];
        if (env && L.env[side] !== env) {   // 8192 bins 0..1 -> 16 bit, ~22 KB once per side
          L.env[side] = env; const q = new Uint16Array(env.length); for (let i = 0; i < env.length; i++) q[i] = Math.round(Math.max(0, Math.min(1, env[i])) * 65535);
          link.send('ctl', { k: 'renv', uid, side, dur: r.durations[side] || 0, env: b64(new Uint8Array(q.buffer)) });
        }
        const t = r.rec.sides[side], blob = t && r.labelImgs[side] && artBlobs.get(t.id);
        if (blob && !L.art[side]) {   // the cover exactly as stored in the MP3, no re-encoding
          L.art[side] = 'pending';
          blob.arrayBuffer().then(buf => { if (live.get(uid) === L) link.send('ctl', { k: 'rart', uid, side, mime: blob.type, img: b64(new Uint8Array(buf)) }); L.art[side] = 'sent'; }).catch(() => { L.art[side] = null; });
        }
      }
      r.group.updateMatrixWorld(); _rm.multiplyMatrices(_ri, r.group.matrixWorld); _rm.decompose(_rp, _rq, _rs);
      out.push([uid, r4(_rp.x), r4(_rp.y), r4(_rp.z), r4(_rq.x), r4(_rq.y), r4(_rq.z), r4(_rq.w), r4(r.mesh.rotation.x), r4(r.mesh.position.y), r.sideUp]);
    }
    for (const uid of [...live.keys()]) if (!seen.has(uid)) { live.delete(uid); link.send('ctl', { k: 'recdel', uid }); }
    return out;
  }
  // ---- hands / controllers, so the phone can let the real hands show in front of the gear
  function handsTick() {
    const out = [], inputs = getInputs() || [];
    for (const st of inputs) {
      if (!st || !st.connected) continue;
      if (st.isHand) {
        const h = renderer.xr.getHand(st.i), a = [];
        for (const j of Object.values(h.joints || {})) { if (!j.visible) continue; j.getWorldPosition(_rp).sub(rig.position); a.push(r3(_rp.x), r3(_rp.y), r3(_rp.z)); }
        if (a.length >= 30) out.push([st.i, 'h', a]);
      } else if (st.grip) {
        st.grip.matrixWorld.decompose(_rp, _rq, _rs); _rp.sub(rig.position);
        out.push([st.i, 'c', [r3(_rp.x), r3(_rp.y), r3(_rp.z), r4(_rq.x), r4(_rq.y), r4(_rq.z), r4(_rq.w)]]);
      }
    }
    return out;
  }

  const link = hostLink(code, {
    onStatus: status,
    onState: s => status(s),
    onOpen: () => { link.send('ctl', layout()); full = true; live.clear(); toast && toast('Spectator phone connected', 2500); status('connected'); },
    onClose: () => { status('disconnected'); calStep = null; panel.visible = false; frustum.visible = false; },
    onMessage: m => {
      if (m.k === 'ping') link.send('ctl', { k: 'pong', t: m.t, qt: performance.now() });
      else if (m.k === 'cal') {
        if (m.step === 'lens' || m.step === 'x') { calStep = m.step; say(CAL_TEXT[m.step]); toast && toast(CAL_TEXT[m.step].slice(1).join(' '), 6000); }
        else if (m.step === 'done') { calStep = null; say(['Spectator camera calibrated', m.err != null ? 'Match: ' + m.err + ' cm' : '', 'The blue outline shows what it films.'], '#40d080'); doneT = 3; }
        else { calStep = null; panel.visible = false; }
      } else if (m.k === 'cam') {
        setFrustum(m.fov, m.asp); frustum.position.fromArray(m.p); frustum.quaternion.fromArray(m.q); frustum.visible = true; camT = 0;
      }
    },
  });
  // any saved layout change (moving gear, resizing the case) goes to the phone too
  const save = stage.save.bind(stage);
  stage.save = () => { save(); if (link.isOpen) link.send('ctl', layout()); };

  function tick(dt) {
    if (panel.visible) { placePanel(); if (doneT > 0 && (doneT -= dt) <= 0) panel.visible = false; }
    if (frustum.visible && (camT += dt) > 2) frustum.visible = false;   // phone stopped sending: hide it
    const open = link.isOpen; if (!open) { was = false; return; }
    if (!was) { was = true; acc = 1; }
    acc += dt; if (acc < 1 / RATE) return; acc = 0;
    const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    cam.matrixWorld.decompose(_p, _q, _s); _p.sub(rig.position);   // rig space (the rig only moves, never turns)
    const now = performance.now();
    if (full || now - regT > 2000) { regT = now; buildRegistry(); }
    if (full) { full = false; link.send('ctl', { k: 'full', t: Math.round(now), n: nodeDiffs(true) }); }
    else if (now - settleT > 1000) { settleT = now; const n = settled(now); if (n.length) link.send('ctl', { k: 'full', t: Math.round(now), n }); }
    link.send('state', { k: 's', n: seq++, t: Math.round(now), xr: renderer.xr.isPresenting ? 1 : 0,
      h: [r3(_p.x), r3(_p.y), r3(_p.z), r4(_q.x), r4(_q.y), r4(_q.z), r4(_q.w)],
      g: nodeDiffs(false), r: recordsTick(), hd: renderer.xr.isPresenting ? handsTick() : [] });
  }
  return { tick, close: () => { link.close(); scene.remove(panel); rig.remove(frustum); } };
}
