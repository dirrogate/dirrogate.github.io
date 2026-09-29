// Quest side of the spectator camera (CLAUDE.md #158, #160). Loaded only when Settings > Spectator camera is on.
// Sends small JSON packets; never touches the audio engine. Cost per frame when nobody is connected: one
// boolean check. When connected: one pose read + one ~150-byte message 20 times a second, plus the
// calibration prompt panel and the phone's view outline (a few lines) when those are active.
import * as THREE from 'three';
import { hostLink } from './net-link.js';

const RATE = 20;                     // state packets per second
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _f = new THREE.Vector3();
const r3 = v => Math.round(v * 1000) / 1000, r4 = v => Math.round(v * 10000) / 10000;
const CAL_TEXT = {
  lens: ['Spectator calibration 1/2', 'Touch the phone\'s BACK CAMERA LENS', 'with the controller tip (blue ball),', 'then pull the trigger.'],
  x: ['Spectator calibration 2/2', 'Touch the TAPE X on the floor', 'with the controller tip (blue ball),', 'then pull the trigger.'],
};

export function startHost({ code, stage, rig, scene, renderer, camera, toast, getInputs }) {
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

  const link = hostLink(code, {
    onStatus: status,
    onState: s => status(s),
    onOpen: () => { link.send('ctl', layout()); toast && toast('Spectator phone connected', 2500); status('connected'); },
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
    link.send('state', { k: 's', n: seq++, t: Math.round(performance.now()), xr: renderer.xr.isPresenting ? 1 : 0,
      h: [r3(_p.x), r3(_p.y), r3(_p.z), r4(_q.x), r4(_q.y), r4(_q.z), r4(_q.w)] });
  }
  return { tick, close: () => { link.close(); scene.remove(panel); rig.remove(frustum); } };
}
