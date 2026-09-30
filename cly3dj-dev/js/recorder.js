// #203 In-app recorder (spectator phone). Samsung's screen recorder films whatever reaches the screen, and when the
// phone misses an AR frame Chrome shows the bare camera picture, so the gear blinked out of the take. Here every
// recorded frame is one Cly3DJ composed itself (camera picture + gear, spectator-client compose()): a late frame is
// simply repeated. Frames go through a 2D canvas (turned upright when the phone is held on its side) into
// MediaRecorder (MP4 / H.264 where Chrome has it, else WebM), with the phone's mic if wanted. The file is written to
// the phone's Cly3DJ storage as it records ('Takes' folder, so a crash keeps what was written), then offered to
// Downloads when it stops. Start / stop from the phone or the Quest's CAMERA tab.
import * as media from './medialib.js';

export const REC_RES = ['720', '1080', 'full'];
const MIMES = ['video/mp4;codecs=avc1.4D401F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export function makeRecorder() {
  const R = { on: false, starting: false, res: '720', sound: true, save: true, t0: 0, bytes: 0, frames: 0, fps: 0, w: 0, h: 0, mime: '', name: '', err: '', last: '', rot: 0 };
  try { Object.assign(R, JSON.parse(localStorage.getItem('vire.rec') || '{}'), { on: false, starting: false, err: '' }); } catch {}
  const save = () => { try { localStorage.setItem('vire.rec', JSON.stringify({ res: R.res, sound: R.sound, save: R.save })); } catch {} };
  const out = document.createElement('canvas'), g = out.getContext('2d', { alpha: false });
  let mic = null, stream = null, track = null, mr = null, writer = null, chain = Promise.resolve(), stopped = null, fN = 0, fT = 0, onChange = null;

  const mimeOf = () => MIMES.find(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || '';
  async function ensureMic() {   // call from a tap (Start camera / REC) the first time, so the permission prompt can show
    if (!R.sound) return null;
    if (mic && mic.getAudioTracks().some(t => t.readyState === 'live')) return mic;
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
    catch (e) { mic = null; R.err = 'no microphone (' + e.message + '): recording without sound'; }
    return mic;
  }
  // output size for a composed view of aspect a (width / height): the short side is the chosen resolution (or the
  // camera picture's own short side for 'full'), multiples of 8 for the encoder
  function sizeFor(a, camShort) {
    const s = R.res === 'full' ? Math.max(360, camShort || 1080) : +R.res, e8 = v => Math.max(8, Math.round(v / 8) * 8);
    return a < 1 ? { w: e8(s), h: e8(s / a) } : { w: e8(s * a), h: e8(s) };
  }
  async function start() {
    if (R.on || R.starting) return;
    if (typeof MediaRecorder === 'undefined') { R.err = 'this browser cannot record video'; change(); return; }
    R.starting = true; R.err = ''; change();
    await ensureMic();
    R.mime = mimeOf();
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    R.name = `Cly3DJ_take_${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.${R.mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
    try { writer = await media.createWritable('Takes', R.name); }
    catch (e) { R.starting = false; R.err = 'cannot write to the phone storage: ' + e.message; change(); return; }
    R.bytes = 0; R.frames = 0; R.w = 0; R.h = 0; chain = Promise.resolve();
    R.on = true; R.starting = false; change();   // the MediaRecorder starts on the first composed frame (push), when the size is known
  }
  function begin(w, h) {
    out.width = w; out.height = h; R.w = w; R.h = h;
    stream = out.captureStream(0); track = stream.getVideoTracks()[0];
    if (mic) for (const t of mic.getAudioTracks()) if (t.readyState === 'live') stream.addTrack(t);
    const px = w * h, vbr = Math.round(Math.min(16e6, 6e6 * Math.pow(px / 921600, 0.8)));   // 720p about 6 Mbit/s, 1080p about 11
    mr = new MediaRecorder(stream, { mimeType: R.mime || undefined, videoBitsPerSecond: vbr, audioBitsPerSecond: 128000 });
    mr.ondataavailable = e => { if (e.data && e.data.size) { R.bytes += e.data.size; const b = e.data; chain = chain.then(() => writer.write(b)).catch(err => { R.err = 'write failed: ' + err.message; }); } };
    stopped = new Promise(res => { mr.onstop = res; });
    mr.onerror = e => { R.err = 'recorder: ' + (e.error ? e.error.message : 'error'); stop(); };
    mr.start(1000);   // a chunk a second goes to storage
    R.t0 = performance.now(); fN = 0; fT = R.t0;
  }
  // one composed frame: src = the WebGL canvas right after compose() drew it (sw x sh), rot = -1 / 0 / 1 quarter turns
  function push(src, sw, sh, rot) {
    if (!R.on) return;
    if (!mr) { R.rot = rot; begin(rot ? sh : sw, rot ? sw : sh); }
    draw(g, src, sw, sh, R.rot, out.width, out.height);
    track.requestFrame(); R.frames++; fN++;
    const now = performance.now(); if (now - fT > 1000) { R.fps = Math.round(fN * 1000 / (now - fT)); fN = 0; fT = now; }
  }
  async function stop() {
    if (!R.on) return;
    R.on = false; change();
    try {
      if (mr && mr.state !== 'inactive') { mr.stop(); await stopped; }
      await chain; await writer.close();
    } catch (e) { R.err = 'stop: ' + e.message; }
    mr = null; track = null; if (stream) for (const t of stream.getVideoTracks()) t.stop(); stream = null; writer = null;
    const name = R.name, secs = Math.round((performance.now() - R.t0) / 1000);
    R.last = R.frames ? `${name} (${fmtT(secs)}, ${(R.bytes / 1048576).toFixed(0)} MB)` : '';
    if (!R.frames) { await media.remove('Takes', name); R.err = R.err || 'nothing was recorded (no camera frames)'; }
    else {
      const f = await media.getFile('Takes', name);
      if (f) { media.makeThumb(f, 'Takes').then(t => media.putThumb('Takes', name, t)).catch(() => {}); if (R.save) download(f); }
    }
    change();
  }
  function download(f) {   // Chrome may ask once ("download multiple files"); the take always stays in Library > Takes too
    const a = document.createElement('a'), u = URL.createObjectURL(f); a.href = u; a.download = f.name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000);
  }
  function set(k, v) { if (R.on && k === 'res') return; R[k] = v; save(); change(); }
  function change() { onChange && onChange(); }
  const status = () => ({ on: R.on || R.starting, t: R.on ? Math.round((performance.now() - R.t0) / 1000) : 0, mb: +(R.bytes / 1048576).toFixed(1), fps: R.fps, w: R.w, h: R.h, res: R.res, sound: R.sound, mime: R.mime.split(';')[0], err: R.err, last: R.last });
  return { R, start, stop, push, sizeFor, set, status, ensureMic, download, set onChange(f) { onChange = f; } };
}
export const fmtT = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// draw src (sw x sh) into a 2D context of size W x H, turned by rot quarter turns (1 = the phone's right edge was up:
// turn the picture a quarter turn anticlockwise so the world is upright; -1 the other way)
export function draw(g, src, sw, sh, rot, W, H) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (rot === 1) { g.translate(0, H); g.rotate(-Math.PI / 2); g.drawImage(src, 0, 0, sw, sh, 0, 0, H, W); }
  else if (rot === -1) { g.translate(W, 0); g.rotate(Math.PI / 2); g.drawImage(src, 0, 0, sw, sh, 0, 0, H, W); }
  else g.drawImage(src, 0, 0, sw, sh, 0, 0, W, H);
  g.setTransform(1, 0, 0, 1, 0, 0);
}
