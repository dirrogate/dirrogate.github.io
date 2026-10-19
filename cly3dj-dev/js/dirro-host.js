// #427 DIRROGRAM on the Quest (audience-ar-plan.md, Phase B): sends the show to the audience phones through the
// Dirrogram relay (tools/dirro-relay.mjs). One WebSocket, role=dj, in a room whose key is kept on the headset so a
// printed QR keeps working. 15 pose ticks a second ('p': head, hands / controllers, mic level as the #278 'av'
// message, the beat and the laser), the show config ('c': scroller text, NOW SPINNING) once a second when it changes
// and every 5 s anyway (the relay hands the last one to every phone that joins), a ping every 2 s (the phones use the
// Quest's round trip to line the beat up with the PA).
// env: { renderer, rig, getXr(), getBeat(), laser, micLevel(), nowPlaying() -> { a, bpm }, scrollText() -> string, onChange() }
import * as THREE from 'three';

const K_RELAY = 'vire.dirroRelay', K_ROOM = 'vire.dirroRoom', K_ON = 'vire.dirroOn', K_WALL = 'vire.dirroWall';
// #434 the phones' LED wall: AUTO (fractal; the Quest's LED-wall picture whenever one is up; the promo card and NOW
// SPINNING now and then), FRACTAL, PICTURES (the picture on the Quest's LED wall, sent once as a small JPEG),
// CLY3DTV (small frames of the stream / venue-screen picture, fps a second). cols = LED cells across (0 = no grid),
// fill = how much of each cell lights, glow = brightness.
export const WALL_SRC = ['auto', 'fractal', 'pictures', 'tv'];
export const WALL_LABEL = { auto: 'AUTO', fractal: 'FRACTAL', pictures: 'PICTURES', tv: 'CLY3DTV' };
export const WALL_COLS = [0, 48, 64, 96, 128, 160, 192, 240, 320];
const WALL_DEF = { src: 'auto', cols: 160, fill: 0.78, glow: 1, fps: 2 };
const idOf = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return 'p' + h.toString(36); };
const SEND_MS = 66, CFG_MS = 1000, CFG_FORCE_MS = 5000, PING_MS = 2000;
const r3 = v => Math.round(v * 1000) / 1000, r4 = v => Math.round(v * 10000) / 10000;
const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; };
export function newRoomKey() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; const r = crypto.getRandomValues(new Uint8Array(6)); for (const b of r) s += A[b % A.length]; return s; }
// ?relay=wss://name.a.pinggy.link on the app's address saves the relay on the headset (like ?discogs=, #393)
export function initRelayFromUrl() {
  try {
    const u = new URL(location.href), q = u.searchParams.get('relay');
    if (q) { setRelay(q); u.searchParams.delete('relay'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); }
  } catch (e) {}
}
export function relayUrl() { return ls(K_RELAY) || ''; }
// #431 short forms (the tablet keyboard has no ':'): 'UNIVDEMO' -> wss://univdemo.a.pinggy.link/dirro; a name with a dot
// keeps its host; no path -> /dirro (the relay inside the owner's server); http(s) -> ws(s); spaces dropped, all lower case
export function setRelay(s) {
  s = (s || '').trim().toLowerCase().replace(/\s+/g, '').replace(/\/+$/, ''); if (!s) { ls(K_RELAY, null); return ''; }
  let scheme = 'wss://', m = s.match(/^(wss?|https?):\/\//);
  if (m) { scheme = m[1].replace(/^http/, 'ws') + '://'; s = s.slice(m[0].length); }
  let host = s, path = ''; const i = s.indexOf('/'); if (i >= 0) { host = s.slice(0, i); path = s.slice(i); }
  if (!host.includes('.') && !host.includes(':')) host += '.a.pinggy.link';
  if (!path) path = '/dirro';
  s = scheme + host + path; ls(K_RELAY, s); return s;
}
export function roomKey() { let k = ls(K_ROOM); if (!k) { k = newRoomKey(); ls(K_ROOM, k); } return k; }
// the address the audience opens (the QR): dirrogram.html next to the app, relay and room in the hash
export function fanUrl() {
  const base = location.origin + location.pathname.replace(/[^/]*$/, '') + 'dirrogram.html';
  return relayUrl() ? `${base}#relay=${encodeURIComponent(relayUrl())}&room=${roomKey()}` : base;
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _rq = new THREE.Quaternion();
export class DirroHost {
  constructor(env) {
    this.env = env; this.on = ls(K_ON) === '1'; this.ws = null; this.state = 'off'; this.fans = 0; this.rtt = 0;
    this.sendT = 0; this.cfgT = 0; this.cfgSent = 0; this.cfgKey = ''; this.pingT = 0; this.retry = 0; this.retryT = 0; this.err = '';
    this.sent = 0; this.bytes = 0; this.kbps = 0; this._rateT = performance.now(); this._rateB = 0;
    this.wall = { ...WALL_DEF }; try { Object.assign(this.wall, JSON.parse(ls(K_WALL) || '{}')); } catch (e) {}
    this.imgName = ''; this.imgId = ''; this.imgSent = new Set(); this.frameT = 0; this.frames = 0;
  }
  setWall(k, v) { this.wall[k] = v; ls(K_WALL, JSON.stringify(this.wall)); this.cfgKey = ''; this.cfgT = 0; this._changed(); }
  // #434 the picture on the Quest's LED wall, once per connection: fitted (cover) into 512 x 288, JPEG under ~60 KB
  async _sendImg(file, name) {
    const id = idOf(name); this.imgId = id;
    if (this.imgSent.has(id)) return;
    try {
      const b = await createImageBitmap(file), W = 512, H = 288, c = Object.assign(document.createElement('canvas'), { width: W, height: H }), g = c.getContext('2d');
      const k = Math.max(W / b.width, H / b.height), w = b.width * k, h = b.height * k; g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.drawImage(b, (W - w) / 2, (H - h) / 2, w, h); b.close && b.close();
      let d = ''; for (const q of [0.8, 0.65, 0.5, 0.35]) { d = c.toDataURL('image/jpeg', q); if (d.length < 60000) break; }
      if (d.length >= 60000 || this.imgName !== name) return;
      this._send({ k: 'i', id, d }); this.imgSent.add(id); this.cfgKey = '';
    } catch (e) { console.warn('dirrogram picture', e); }
  }
  // #434 CLY3DTV on the phones: the stream / venue-screen picture, 192 x 108 JPEG, fps a second
  _sendFrame(now) {
    const cv = this.env.tvCanvas && this.env.tvCanvas(); if (!cv || now - this.frameT < 1000 / this.wall.fps) return;
    this.frameT = now;
    const c = this._fc || (this._fc = Object.assign(document.createElement('canvas'), { width: 192, height: 108 }));
    c.getContext('2d').drawImage(cv, 0, 0, 192, 108);
    this._send({ k: 'f', d: c.toDataURL('image/jpeg', 0.6) }); this.frames++;
  }
  setOn(on) { this.on = !!on; ls(K_ON, this.on ? '1' : '0'); if (!this.on) this._close('off'); else { this.retry = 0; this.retryT = 0; } this._changed(); }
  newRoom() { ls(K_ROOM, newRoomKey()); this._close(this.on ? 'connecting' : 'off'); this.retryT = 0; this._changed(); }
  setRelay(s) { setRelay(s); this._close(this.on ? 'connecting' : 'off'); this.retryT = 0; this._changed(); }
  _changed() { if (this.env.onChange) this.env.onChange(); }
  _close(state) {
    if (this.ws) { const w = this.ws; this.ws = null; w.onopen = w.onclose = w.onmessage = w.onerror = null; try { w.close(); } catch (e) {} }
    this.state = state; this.fans = 0;
  }
  _connect() {
    const relay = relayUrl(); if (!relay) { this.state = 'no relay'; return; }
    let ws; try { ws = new WebSocket(`${relay}/r/${roomKey()}?role=dj`); } catch (e) { this.err = e.message; this.state = 'error'; return; }
    this.ws = ws; this.state = 'connecting'; this.err = '';
    ws.onopen = () => { this.state = 'live'; this.retry = 0; this.cfgKey = ''; this.cfgT = 0; this.imgSent.clear(); this.imgName = ''; this._changed(); };   // #434 pictures again for a new connection
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.k === 'fans') { if (m.n !== this.fans) { this.fans = m.n; this._changed(); } }
      else if (m.k === 'pong') { const r = performance.now() - m.c; this.rtt = this.rtt ? this.rtt + (r - this.rtt) * 0.3 : r; }
    };
    ws.onclose = () => { if (this.ws !== ws) return; this.ws = null; this.state = 'retrying'; this.retry++; this.retryT = performance.now() + Math.min(15000, 1000 * Math.pow(1.6, this.retry)); this._changed(); };
    ws.onerror = () => { this.err = 'relay not reachable'; };
  }
  _send(o) { if (!this.ws || this.ws.readyState !== 1) return; const s = JSON.stringify(o); if (this.ws.bufferedAmount > 256 * 1024) return; this.ws.send(s); this.sent++; this._rateB += s.length; }

  tick(now) {
    if (!this.on) return;
    if (!this.ws) { if (now >= this.retryT && this.state !== 'no relay') this._connect(); else if (!relayUrl()) this.state = 'no relay'; return; }
    if (this.ws.readyState !== 1) return;
    if (now - this._rateT > 2000) { this.kbps = this._rateB / (now - this._rateT); this._rateB = 0; this._rateT = now; }
    if (now - this.pingT > PING_MS) { this.pingT = now; this._send({ k: 'ping', c: Math.round(now) }); }
    // config: scroller text and NOW SPINNING (the relay keeps the last one for phones that join later)
    const np = (this.env.nowPlaying && this.env.nowPlaying()) || {}, scroll = (this.env.scrollText && this.env.scrollText()) || '';
    const L = this.env.getLed && this.env.getLed();   // #434 the LED wall's current picture, if it shows one
    if (L && L.img && L.file && L.name) { if (L.name !== this.imgName) { this.imgName = L.name; this._sendImg(L.file, L.name); } }
    else if (this.imgName) { this.imgName = ''; this.imgId = ''; }
    if (this.wall.src === 'tv') this._sendFrame(now);
    const W = this.wall, cfg = { k: 'c', scroll, np: np.a || '', img: this.imgSent.has(this.imgId) ? this.imgId : '', wall: { src: W.src, cols: W.cols, fill: W.fill, glow: W.glow } }, key = JSON.stringify(cfg);
    if ((key !== this.cfgKey && now - this.cfgT > CFG_MS) || now - this.cfgSent > CFG_FORCE_MS) { this.cfgKey = key; this.cfgT = this.cfgSent = now; this.ws.send(key); this._rateB += key.length; }
    if (now - this.sendT < SEND_MS) return;
    this.sendT = now;
    this._send(this._pose(now, np));
  }
  _pose(now, np) {
    const { renderer, rig } = this.env, xr = this.env.getXr && this.env.getXr();
    rig.updateMatrixWorld(); rig.getWorldQuaternion(_rq).invert();
    // head: the headset's eyes in rig space (the desktop camera off the headset, so a PC test still moves the robot)
    const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : this.env.camera;
    cam.matrixWorld.decompose(_p, _q, _s); rig.worldToLocal(_p); _q.premultiply(_rq);
    const m = { k: 'p', t: Math.round(now), h: [r3(_p.x), r3(_p.y), r3(_p.z), r4(_q.x), r4(_q.y), r4(_q.z), r4(_q.w)], hd: [], qr: Math.round(this.rtt) };
    // hands and controllers, as the spectator link sends them (spectator-host.js handsTick), plus the #278 'av' numbers
    if (xr && renderer.xr.isPresenting) {
      const c = [], hs = [];
      for (const st of xr.inputs) {
        hs.push(st.connected && st.source ? (st.source.handedness || '')[0] || '' : '');
        if (!st || !st.connected) continue;
        if (st.isHand) {
          const h = renderer.xr.getHand(st.i), a = [];
          for (const j of Object.values(h.joints || {})) { if (!j.visible) continue; rig.worldToLocal(j.getWorldPosition(_p)); a.push(r3(_p.x), r3(_p.y), r3(_p.z)); }
          if (a.length >= 75) m.hd.push([st.i, 'h', a]);
        } else if (st.grip) {
          st.grip.matrixWorld.decompose(_p, _q, _s); rig.worldToLocal(_p); _q.premultiply(_rq);
          m.hd.push([st.i, 'c', [r3(_p.x), r3(_p.y), r3(_p.z), r4(_q.x), r4(_q.y), r4(_q.z), r4(_q.w)]]);
          const b = st.source && st.source.gamepad ? st.source.gamepad.buttons : [];
          if (st.tip) { const t = rig.worldToLocal(st.tip.clone()); c.push([st.i, r3(b[0] ? b[0].value : 0), r3(b[1] ? b[1].value : 0), r3(t.x), r3(t.y), r3(t.z)]); }
        }
      }
      m.av = { m: r3(this.env.micLevel ? this.env.micLevel() : 0), hs, c };
    } else m.av = { m: r3(this.env.micLevel ? this.env.micLevel() : 0), hs: [], c: [] };
    // beat: onset count and the time of the last one (Quest clock), and the playing track's tempo at its pitch
    const bt = this.env.getBeat && this.env.getBeat();
    m.b = { n: bt ? bt.count : 0, lt: bt ? Math.round(bt.last) : 0, bpm: Math.round((np.bpm || 0) * 100) / 100 };
    const L = this.env.laser;
    if (L) m.l = { on: L.on ? 1 : 0, pat: L.pat, col: L.col, n: L.n, spread: L.spread, speed: L.speed, haze: L.haze, smoke: L.smoke, drift: L.drift, auto: L.auto ? 1 : 0, ph: r3(L.ph) };
    return m;
  }
  status() {
    if (!this.on) return 'Off';
    if (!relayUrl()) return 'No relay set: RELAY… (or open the app once with ?relay=wss://…)';
    if (this.state === 'live') return `Live · ${this.fans} phone${this.fans === 1 ? '' : 's'} · ${Math.round(this.rtt)} ms · ${this.kbps.toFixed(1)} KB/s${this.wall.src === 'tv' ? (this.env.tvCanvas && this.env.tvCanvas() ? ' · TV frames' : ' · no TV picture (stream / TV off)') : ''}`;
    if (this.state === 'retrying') return `Relay not reachable, trying again (${this.retry})`;
    return this.state[0].toUpperCase() + this.state.slice(1) + '…';
  }
}
