// #573 HOLO bus source for the VJ Desk: a Holodancer performer (js/holoplayer.js) seen through a camera the VJ steers.
// Drawn with the desk's own renderer into a 1280x720 target (no second WebGL context), so it composites like any bus and goes out
// on Twitch / DirroTV with the program. Performers come from holo/library.json (one folder per performer: performer.json + atlas.mp4).
import { makeHoloPlayer } from './holoplayer.js';

export function holoDefaults() {
  // #575 gram: SEND TO DIRROGRAM; pub: where the phones fetch performers (https; this page's holo/ when it is served over https)
  const here = new URL('holo/', location.href).href;
  const S = { lib: [], perf: '', loaded: false, loading: false, err: '', cam: { az: 0, el: 8, zoom: 1, orbit: false }, tears: true, glitch: 1, speed: 1, room: false, layout: '',
    gram: false, pub: /^https:/.test(here) ? here : 'https://dirrogate.github.io/cly3dj-dev/holo/' };
  try { const o = JSON.parse(localStorage.getItem('vire.holo') || '{}'); if (typeof o.perf === 'string') S.perf = o.perf; if (o.cam) Object.assign(S.cam, o.cam);
    if (typeof o.pub === 'string' && /^https:\/\//.test(o.pub)) S.pub = o.pub;
    for (const k of ['tears', 'room']) if (typeof o[k] === 'boolean') S[k] = o[k]; for (const k of ['glitch', 'speed']) if (+o[k] >= 0) S[k] = +o[k]; } catch {}
  S.cam.orbit = false;
  return S;
}

export function makeHoloDesk({ THREE, renderer, S, post }) {
  const W = 1280, H = 720;
  const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000);
  const cam = new THREE.PerspectiveCamera(32, W / H, 0.05, 60);
  const player = makeHoloPlayer({ THREE, grid: [160, 180] });
  scene.add(player.group);
  const save = () => { try { localStorage.setItem('vire.holo', JSON.stringify({ perf: S.perf, cam: S.cam, tears: S.tears, glitch: S.glitch, speed: S.speed, room: S.room, pub: S.pub })); } catch {} };
  const apply = () => { player.set('tears', S.tears); player.set('glitch', S.glitch); player.set('speed', S.speed); player.set('room', S.room); };
  let orbitAz = 0, lastT = 0, loadSeq = 0;

  async function pick(id) {
    const p = S.lib.find(x => x.id === id) || S.lib[0]; if (!p) { S.err = 'no performers in holo/library.json'; post(); return; }
    const seq = ++loadSeq; S.perf = p.id; S.loading = true; S.err = ''; post(); save();
    try { const m = await player.load(p.path); if (seq !== loadSeq) return; S.layout = m.layout; S.loaded = true; apply(); }
    catch (e) { if (seq === loadSeq) S.err = e.message || String(e); }
    if (seq === loadSeq) { S.loading = false; post(); }
  }
  function ensure() { if (!S.loaded && !S.loading && S.lib.length) pick(S.perf); }

  const eye = new THREE.Vector3();
  function render(now) {
    if (!player.ready) return;
    const t = now / 1000, dt = lastT ? Math.min(0.1, t - lastT) : 0; lastT = t;
    if (S.cam.orbit) orbitAz = (orbitAz + dt * 6) % 360;
    const z = Math.max(0.4, +S.cam.zoom || 1), az = (S.cam.az + orbitAz) * Math.PI / 180, el = Math.max(-15, Math.min(70, S.cam.el)) * Math.PI / 180;
    const k = Math.min(1, Math.max(0, (z - 1) / 3)), aimY = 0.95 + 0.5 * k, d = 4.6 / z;   // closer = aim slides up to her face
    eye.set(Math.sin(az) * Math.cos(el) * d, aimY + Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    cam.position.copy(eye); cam.lookAt(0, aimY, 0); cam.updateMatrixWorld();
    player.update(eye, t, cam);
    const prevRT = renderer.getRenderTarget(), prevXr = renderer.xr && renderer.xr.enabled;
    if (renderer.xr) renderer.xr.enabled = false;
    renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(prevRT);
    if (renderer.xr) renderer.xr.enabled = prevXr;
  }

  // #668 HOLO+CAM: her alone on a clear background, seen from the angle the club webcam has (P.el = how far it looks down on
  // her, P.face = which way she faces it). Returns where her feet and head land, so the desk can stand her on a spot in the webcam
  const rtP = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
  const camP = new THREE.PerspectiveCamera(30, W / H, 0.05, 60), eyeP = new THREE.Vector3(), pv3 = new THREE.Vector3(), clr = new THREE.Color();
  const placed = { tex: rtP.texture, foot: new THREE.Vector2(0.5, 0.1), head: new THREE.Vector2(0.5, 0.9) };
  const uvOf = (x, y, z, out) => { pv3.set(x, y, z).project(camP); return out.set(pv3.x * 0.5 + 0.5, pv3.y * 0.5 + 0.5); };
  function renderPlaced(now, P) {
    if (!player.ready) return null;
    const az = (+P.face || 0) * Math.PI / 180, el = Math.max(-20, Math.min(75, +P.el || 0)) * Math.PI / 180, d = 5.4, aimY = 0.9;
    eyeP.set(Math.sin(az) * Math.cos(el) * d, aimY + Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    camP.position.copy(eyeP); camP.lookAt(0, aimY, 0); camP.updateMatrixWorld();
    player.update(eyeP, now / 1000, camP);
    const bg = scene.background, ca = renderer.getClearAlpha(); renderer.getClearColor(clr);
    const prevRT = renderer.getRenderTarget(), prevXr = renderer.xr && renderer.xr.enabled;
    if (renderer.xr) renderer.xr.enabled = false;
    scene.background = null; renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rtP); renderer.clear(); renderer.render(scene, camP); renderer.setRenderTarget(prevRT);
    scene.background = bg; renderer.setClearColor(clr, ca);
    if (renderer.xr) renderer.xr.enabled = prevXr;
    uvOf(0, 0, 0, placed.foot); uvOf(0, 1.7, 0, placed.head);
    return placed;
  }

  function onMsg(m) {
    if (m.op === 'perf') { pick(String(m.v || '')); return; }
    if (m.op === 'cam' && m.v) { Object.assign(S.cam, m.v); if (m.v.orbit === false) { S.cam.az = (S.cam.az + orbitAz) % 360; orbitAz = 0; } }
    else if (m.op === 'tears') S.tears = !!m.v;
    else if (m.op === 'room') S.room = !!m.v;
    else if (m.op === 'glitch') S.glitch = Math.max(0, Math.min(1.5, +m.v || 0));
    else if (m.op === 'speed') S.speed = Math.max(0.25, Math.min(2, +m.v || 1));
    else if (m.op === 'restart') { player.video.currentTime = 0; player.video.play().catch(() => {}); }
    else if (m.op === 'gram') S.gram = !!m.v;   // #575
    else if (m.op === 'pub') { const u = String(m.v || '').trim(); if (/^https:\/\/[\w.-]+(:\d+)?\//.test(u)) S.pub = u.replace(/\/?$/, '/'); }
    apply(); save(); post();
  }
  return { ensure, render, renderPlaced, onMsg, pick, player, get tex() { return rt.texture; }, get ready() { return player.ready; }, get t() { return player.video.currentTime; } };
}
