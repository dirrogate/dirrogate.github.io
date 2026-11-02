// #573 HOLO bus source for the VJ Desk: a Holodancer performer (js/holoplayer.js) seen through a camera the VJ steers.
// Drawn with the desk's own renderer into a 1280x720 target (no second WebGL context), so it composites like any bus and goes out
// on Twitch / DirroTV with the program. Performers come from holo/library.json (one folder per performer: performer.json + atlas.mp4).
import { makeHoloPlayer } from './holoplayer.js';

export function holoDefaults() {
  const S = { lib: [], perf: '', loaded: false, loading: false, err: '', cam: { az: 0, el: 8, zoom: 1, orbit: false }, tears: true, glitch: 1, speed: 1, room: false, layout: '' };
  try { const o = JSON.parse(localStorage.getItem('vire.holo') || '{}'); if (typeof o.perf === 'string') S.perf = o.perf; if (o.cam) Object.assign(S.cam, o.cam);
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
  const save = () => { try { localStorage.setItem('vire.holo', JSON.stringify({ perf: S.perf, cam: S.cam, tears: S.tears, glitch: S.glitch, speed: S.speed, room: S.room })); } catch {} };
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

  function onMsg(m) {
    if (m.op === 'perf') { pick(String(m.v || '')); return; }
    if (m.op === 'cam' && m.v) { Object.assign(S.cam, m.v); if (m.v.orbit === false) { S.cam.az = (S.cam.az + orbitAz) % 360; orbitAz = 0; } }
    else if (m.op === 'tears') S.tears = !!m.v;
    else if (m.op === 'room') S.room = !!m.v;
    else if (m.op === 'glitch') S.glitch = Math.max(0, Math.min(1.5, +m.v || 0));
    else if (m.op === 'speed') S.speed = Math.max(0.25, Math.min(2, +m.v || 1));
    else if (m.op === 'restart') { player.video.currentTime = 0; player.video.play().catch(() => {}); }
    apply(); save(); post();
  }
  return { ensure, render, onMsg, pick, player, get tex() { return rt.texture; }, get ready() { return player.ready; }, get t() { return player.video.currentTime; } };
}
