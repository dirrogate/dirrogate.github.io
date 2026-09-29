// Quest side of the spectator camera (CLAUDE.md #158). Loaded only when Settings > Spectator camera is on.
// Sends small JSON packets; never touches the audio engine. Cost per frame when nobody is connected: one
// boolean check. When connected: one pose read + one ~150-byte message 20 times a second.
import * as THREE from 'three';
import { hostLink } from './net-link.js';

const RATE = 20;                     // state packets per second
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const r3 = v => Math.round(v * 1000) / 1000, r4 = v => Math.round(v * 10000) / 10000;

export function startHost({ code, stage, rig, renderer, camera, toast }) {
  let acc = 0, seq = 0, was = false;
  const status = s => { const el = document.getElementById('spectStatus'); if (el) el.textContent = label(s); };
  const label = s => ({ relay: 'Waiting for the phone (code ' + code + ')', 'relay-retry': 'No internet for the handshake, retrying…',
    'id-taken': 'Code ' + code + ' is in use by another Quest page: close it or change the code', connected: 'Phone connected',
    disconnected: 'Phone disconnected', failed: 'Phone link failed', 'relay-error': 'Relay error' }[s] || s);
  const layout = () => ({ k: 'layout', layout: stage.snapshot(), rig: rig.position.toArray().map(r3) });
  const link = hostLink(code, {
    onStatus: status,
    onState: s => { status(s); },
    onOpen: () => { link.send('ctl', layout()); toast && toast('Spectator phone connected', 2500); status('connected'); },
    onClose: () => status('disconnected'),
    onMessage: (m) => { if (m.k === 'ping') link.send('ctl', { k: 'pong', t: m.t, qt: performance.now() }); },
  });
  // any saved layout change (moving gear, resizing the case) goes to the phone too
  const save = stage.save.bind(stage);
  stage.save = () => { save(); if (link.isOpen) link.send('ctl', layout()); };

  function tick(dt) {
    const open = link.isOpen; if (!open) { was = false; return; }
    if (!was) { was = true; acc = 1; }
    acc += dt; if (acc < 1 / RATE) return; acc = 0;
    const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    cam.matrixWorld.decompose(_p, _q, _s); _p.sub(rig.position);   // rig space (the rig only moves, never turns)
    link.send('state', { k: 's', n: seq++, t: Math.round(performance.now()), xr: renderer.xr.isPresenting ? 1 : 0,
      h: [r3(_p.x), r3(_p.y), r3(_p.z), r4(_q.x), r4(_q.y), r4(_q.z), r4(_q.w)] });
  }
  return { tick, close: () => link.close() };
}
