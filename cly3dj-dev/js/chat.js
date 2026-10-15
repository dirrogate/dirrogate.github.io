// #340 Twitch chat (owner, channel 'dirrogate'): read-only, anonymous (justinfanNNNNN), over Twitch's secure IRC WebSocket
// (wss://irc-ws.chat.twitch.tv:443; checked working from a web page on 13 Oct 2026). No login, no key. Messages carry
// tags (display-name, color, emotes); emotes are drawn from Twitch's CDN. Shown on the tablet CHAT page, on a floating
// panel the DJ can grab and park (ChatPanel), and optionally as a layer in SHOWTIME! (stream.js).
import * as THREE from 'three';

const URL_ = 'wss://irc-ws.chat.twitch.tv:443';
const MAX = 60;
export const chatChannel = {
  get: () => { try { return (localStorage.getItem('vire.twitchChannel') || 'dirrogate').trim().toLowerCase().replace(/^#/, ''); } catch { return 'dirrogate'; } },
  set: v => { try { localStorage.setItem('vire.twitchChannel', (v || '').trim().toLowerCase().replace(/^#/, '')); } catch {} },
};

export class TwitchChat {
  constructor(onChange) {
    this.onChange = onChange || (() => {}); this.msgs = []; this.status = 'off'; this.ws = null; this.on = false; this.tries = 0; this.channel = '';
  }
  start(channel = chatChannel.get()) {
    this.channel = channel; this.on = true; this._open();
  }
  stop() { this.on = false; clearTimeout(this.rt); if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; } this._st('off'); }
  _st(s) { this.status = s; this.onChange('status'); }
  _open() {
    if (!this.on || !this.channel) return;
    try { this.ws = new WebSocket(URL_); } catch (e) { this._st('error'); this._retry(); return; }
    const ws = this.ws; this._st('connecting');
    ws.onopen = () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands'); ws.send('PASS SCHMOOPIIE');
      ws.send('NICK justinfan' + (10000 + Math.floor(Math.random() * 80000))); ws.send('JOIN #' + this.channel);
    };
    ws.onmessage = e => { for (const line of String(e.data).split('\r\n')) if (line) this._line(line, ws); };
    ws.onclose = () => { if (this.ws === ws) { this.ws = null; if (this.on) { this._st('reconnecting'); this._retry(); } } };
    ws.onerror = () => {};
  }
  _retry() { clearTimeout(this.rt); const d = Math.min(30000, 1000 * Math.pow(2, this.tries++)); this.rt = setTimeout(() => this._open(), d); }
  _line(l, ws) {
    if (l.startsWith('PING')) { ws.send('PONG' + l.slice(4)); return; }
    let tags = {}, rest = l;
    if (l[0] === '@') { const i = l.indexOf(' '); for (const kv of l.slice(1, i).split(';')) { const j = kv.indexOf('='); tags[kv.slice(0, j)] = kv.slice(j + 1); } rest = l.slice(i + 1); }
    if (/ 366 /.test(rest)) { this.tries = 0; this._st('joined'); this.add({ sys: true, text: 'Chat connected: #' + this.channel }); return; }
    const m = /^:([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.*)$/.exec(rest); if (!m) {
      if (/ CLEARCHAT | CLEARMSG /.test(rest)) { const id = tags['target-msg-id']; this.msgs = id ? this.msgs.filter(x => x.id !== id) : this.msgs; this.onChange('msg'); }
      return;
    }
    let text = m[2]; let me = false;
    if (text.startsWith('\u0001ACTION ') && text.endsWith('\u0001')) { text = text.slice(8, -1); me = true; }
    const emotes = [];   // [start, end, id] in code points
    if (tags.emotes) for (const part of tags.emotes.split('/')) { const [id, pos] = part.split(':'); if (pos) for (const r of pos.split(',')) { const [a, b] = r.split('-').map(Number); emotes.push([a, b, id]); } }
    emotes.sort((a, b) => a[0] - b[0]);
    const cps = [...text], toks = []; let i = 0;
    for (const [a, b, id] of emotes) { if (a > i) toks.push({ t: cps.slice(i, a).join('') }); toks.push({ e: id, t: cps.slice(a, b + 1).join('') }); i = b + 1; }
    if (i < cps.length) toks.push({ t: cps.slice(i).join('') });
    const name = tags['display-name'] || m[1];
    const hl = new RegExp('@' + this.channel + '\\b', 'i').test(text) || /^!request\b/i.test(text);
    this.add({ id: tags.id, name, color: tags.color || nameColor(name), toks, me, hl });
  }
  add(msg) { msg.t = performance.now(); this.msgs.push(msg); if (this.msgs.length > MAX) this.msgs.shift(); this.onChange('msg'); }
}
function nameColor(n) { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360},80%,65%)`; }

// emote images from Twitch's CDN (CORS open, so canvases stay usable as textures)
const emoteCache = new Map();
function emoteImg(id, onLoad) {
  let e = emoteCache.get(id);
  if (!e) { e = new Image(); e.crossOrigin = 'anonymous'; e.src = `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/1.0`; e.onload = onLoad; emoteCache.set(id, e); }
  return e.complete && e.naturalWidth ? e : null;
}

// Draw the newest messages into a box, bottom up, word-wrapped, emotes inline. opts: fs (font px), maxAge (s, older
// fade out; 0 = never), bg (box colour or null), onEmote (called when an emote image arrives, to redraw)
export function drawChat(g, x, y, w, h, msgs, opts = {}) {
  const fs = opts.fs || 18, lh = Math.round(fs * 1.3), es = Math.round(fs * 1.25), pad = Math.round(fs * 0.5), now = performance.now();
  if (opts.bg) { g.fillStyle = opts.bg; g.fillRect(x, y, w, h); }
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.textBaseline = 'middle'; g.textAlign = 'left';
  let by = y + h - pad;
  for (let k = msgs.length - 1; k >= 0 && by > y; k--) {
    const m = msgs[k], age = (now - m.t) / 1000;
    let a = 1; if (opts.maxAge) { if (age > opts.maxAge + 2) break; a = age > opts.maxAge ? 1 - (age - opts.maxAge) / 2 : 1; }
    // lay the message out into lines
    const lines = []; let cur = [], cw = 0; const maxW = w - 2 * pad;
    const push = (item, iw) => { if (cw + iw > maxW && cur.length) { lines.push(cur); cur = []; cw = 0; } cur.push(item); cw += iw; };
    if (m.sys) { g.font = `italic 500 ${fs}px system-ui,sans-serif`; for (const wd of m.text.split(' ')) push({ s: wd + ' ', c: '#8c96a8' }, g.measureText(wd + ' ').width); }
    else {
      g.font = `700 ${fs}px system-ui,sans-serif`; const nm = m.name + (m.me ? ' ' : ': '); push({ s: nm, c: m.color, b: true }, g.measureText(nm).width);
      g.font = `${m.me ? 'italic ' : ''}500 ${fs}px system-ui,sans-serif`;
      for (const tk of m.toks) {
        if (tk.e) { push({ e: tk.e, alt: tk.t }, es + 4); continue; }
        for (const wd of tk.t.split(/(?<= )/)) if (wd) push({ s: wd, c: m.me ? m.color : m.hl ? '#ffe066' : '#eef2f8' }, g.measureText(wd).width);
      }
    }
    if (cur.length) lines.push(cur);
    const mh = lines.length * lh; by -= mh; if (by + mh < y) break;
    g.globalAlpha = Math.max(0, a);
    if (opts.lineBg) { g.fillStyle = opts.lineBg; g.fillRect(x, by - 4, w, mh + 8); }   // a strip per message (stream overlay)
    if (m.hl) { g.fillStyle = 'rgba(255,200,40,0.14)'; g.fillRect(x + 2, by - 2, w - 4, mh + 4); }
    lines.forEach((ln, li) => {
      let cx = x + pad; const cy = by + li * lh + lh / 2;
      for (const it of ln) {
        if (it.e) { const im = emoteImg(it.e, opts.onEmote); if (im) g.drawImage(im, cx, cy - es / 2, es, es); else { g.font = `500 ${fs}px system-ui`; g.fillStyle = '#aab'; g.fillText(it.alt, cx, cy); } cx += es + 4; continue; }
        g.font = `${it.b ? 700 : 500} ${fs}px system-ui,sans-serif`; g.fillStyle = it.c; g.fillText(it.s, cx, cy); cx += g.measureText(it.s).width;
      }
    });
    by -= Math.round(lh * 0.3);
  }
  g.restore(); g.globalAlpha = 1; g.textBaseline = 'alphabetic';
}

// A floating chat screen in the room: grip (hands: pinch) moves it like the GoPro; no gravity; pose saved.
export class ChatPanel {
  constructor(rig, home) {
    this.rig = rig; this.home = home; this.on = false; this.held = false;
    const W = 0.36, H = 0.45; this.W = W; this.H = H;
    const g = this.obj = new THREE.Group(); g.name = 'chatPanel'; g.visible = false; g.userData.noMirror = true; rig.add(g);
    const back = new THREE.Mesh(new THREE.BoxGeometry(W + 0.016, H + 0.016, 0.012), new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.6, metalness: 0.3 }));
    back.position.z = -0.0065; g.add(back);
    this.canvas = document.createElement('canvas'); this.canvas.width = 512; this.canvas.height = 640;
    this.g = this.canvas.getContext('2d'); this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const scr = this.scr = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false })); scr.position.z = 0.0006; g.add(scr);
    this._buildBoard();
    // #341 resize like the tablet: a silver corner tab top-right (trigger / pinch and drag), or a second grip while held
    { const c = document.createElement('canvas'); c.width = c.height = 64; const g2 = c.getContext('2d'); g2.fillStyle = '#d9dde3'; g2.beginPath(); g2.moveTo(64, 0); g2.lineTo(64, 64); g2.lineTo(0, 0); g2.closePath(); g2.fill();
      g2.strokeStyle = '#555b66'; g2.lineWidth = 5; g2.beginPath(); g2.moveTo(30, 34); g2.lineTo(54, 10); g2.moveTo(40, 10); g2.lineTo(54, 10); g2.lineTo(54, 24); g2.stroke();
      const tab = new THREE.Mesh(new THREE.PlaneGeometry(0.034, 0.034), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), transparent: true, metalness: 0.6, roughness: 0.35 }));
      tab.position.set(W / 2 - 0.009, H / 2 - 0.009, 0.0012); g.add(tab); }
    let s = null; try { s = JSON.parse(localStorage.getItem('vire.chatPanel') || 'null'); } catch {}
    if (s && s.p) { g.position.fromArray(s.p); g.quaternion.fromArray(s.q); if (s.s) g.scale.setScalar(s.s); this._ledgeFit(); } else this.reset(false);   // #368 saved size: ledge back to real size
    this.setOn(!!(s && s.on), false);
    if (s && s.board) this.setBoard(true);
  }
  // ---- #341 CHALKBOARD: the panel turns into a greenish-black slate with a ledge holding three chalks (classic white,
  // yellow, soft pink) and a duster. Touch a chalk (controller ball or fingertip) to pick its colour, touch the duster to
  // wipe; then write by touching the board: pressing deeper = a thicker line, fast strokes skip like real chalk. The board
  // is part of the scene in this mode, so the GoPro / AVACAM film it (the chat mode panel stays the DJ's own).
  _buildBoard() {
    const W = this.W, H = this.H;
    this.board = false; this.chalk = 0; this.strokes = new Map(); this.bDirty = false; this.bT = 0;
    const BW = 1024, BH = 1280; this.BW = BW; this.BH = BH;
    const base = this.bBase = document.createElement('canvas'); base.width = BW; base.height = BH;
    { const g = base.getContext('2d'); g.fillStyle = '#17191b'; g.fillRect(0, 0, BW, BH);   // #368 slate black (was greenish #1d2a24)
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 14; i++) { const x = rnd() * BW, y = rnd() * BH, r = 120 + rnd() * 320, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(215,218,222,${0.025 + rnd() * 0.03})`); gr.addColorStop(1, 'rgba(215,218,222,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
      for (let i = 0; i < 26; i++) { g.strokeStyle = `rgba(220,222,226,${0.015 + rnd() * 0.02})`; g.lineWidth = 30 + rnd() * 60; g.beginPath(); const y = rnd() * BH; g.moveTo(rnd() * 200, y); g.bezierCurveTo(BW * 0.3, y + (rnd() - 0.5) * 120, BW * 0.7, y + (rnd() - 0.5) * 120, BW - rnd() * 200, y + (rnd() - 0.5) * 80); g.stroke(); }   // old wipe marks
      const id = g.getImageData(0, 0, BW, BH), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; } g.putImageData(id, 0, 0); }
    this.bInk = document.createElement('canvas'); this.bInk.width = BW; this.bInk.height = BH; this.bInkG = this.bInk.getContext('2d');
    this.bCanvas = document.createElement('canvas'); this.bCanvas.width = BW; this.bCanvas.height = BH; this.bG = this.bCanvas.getContext('2d');
    this.bTex = new THREE.CanvasTexture(this.bCanvas); this.bTex.colorSpace = THREE.SRGBColorSpace; this.bTex.anisotropy = 4;
    this._compose();
    // the ledge, three chalks and a duster (board mode only)
    // #368 (owner): the ledge lives in a real-size frame at the board's bottom edge (counter-scaled in scaleTo), so the
    // chalks and duster stay real-life size on a 6x board; only the shelf and lip stretch to the board's width
    const ledge = this.ledge = new THREE.Group(); ledge.visible = false; ledge.position.y = -H / 2; this.obj.add(ledge);
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3f28, roughness: 0.7 });
    const shelf = this.shelf = new THREE.Mesh(new THREE.BoxGeometry(W + 0.016, 0.006, 0.045), wood); shelf.position.set(0, -0.011, 0.016); ledge.add(shelf);
    const lip = this.lip = new THREE.Mesh(new THREE.BoxGeometry(W + 0.016, 0.012, 0.004), wood); lip.position.set(0, -0.005, 0.037); ledge.add(lip);
    this.sticks = CHALKS.map((c, i) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.055, 12), new THREE.MeshStandardMaterial({ color: c.hex, roughness: 0.95 }));
      m.rotation.z = Math.PI / 2; m.position.set(-0.13 + i * 0.065, -0.0035, 0.018); ledge.add(m); return m;
    });
    const duster = this.duster = new THREE.Group(); duster.position.set(0.125, 0, 0.018); ledge.add(duster);
    { const top = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.016, 0.03), wood); top.position.y = 0.006; duster.add(top);
      const felt = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.006, 0.03), new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 1 })); felt.position.y = -0.005; duster.add(felt); }
    this._pick(0); this._ledgeFit();
  }
  _ledgeFit() { const s = this.obj.scale.x; this.ledge.scale.setScalar(1 / s); this.shelf.scale.x = this.lip.scale.x = s; }   // #368
  _pick(k) {   // k = 0..2 chalk, 3 = duster
    this.chalk = k;
    this.sticks.forEach((m, i) => { m.position.y = -0.0035 + (i === k ? 0.007 : 0); m.position.z = i === k ? 0.024 : 0.018; });
    this.duster.position.y = k === 3 ? 0.008 : 0;
  }
  setBoard(on) {
    this.board = !!on; this.ledge.visible = this.board; this.strokes.clear();
    this.scr.material.map = this.board ? this.bTex : this.tex; this.scr.material.needsUpdate = true;
  }
  wipe() { this.bInkG.clearRect(0, 0, this.BW, this.BH); this._compose(); }
  _compose() { const g = this.bG; g.drawImage(this.bBase, 0, 0); g.drawImage(this.bInk, 0, 0); this.bTex.needsUpdate = true; this.bDirty = false; this.bT = performance.now(); }
  // a fingertip / controller ball at world point P (key = which hand). Returns 'pick', 'write' or null (for a buzz).
  touch(key, P) {
    if (!this.on || !this.board || this.held) { this.strokes.delete(key); return null; }
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P)), sc = this.obj.scale.x, zw = l.z * sc;   // zw: metres in front of the board
    // the ledge: chalks and duster
    const ly = (l.y + this.H / 2) * sc, lx = l.x * sc, lz = l.z * sc;   // #368 ledge coordinates are real metres
    if (ly < 0.01 && ly > -0.04 && lz > -0.005 && lz < 0.05) {
      this.strokes.delete(key);
      for (let i = 0; i < 4; i++) {
        const cx = i < 3 ? -0.13 + i * 0.065 : 0.125;
        if (Math.abs(lx - cx) < (i < 3 ? 0.03 : 0.045)) { if (this.chalk !== i) { this._pick(i); return 'pick'; } return null; }
      }
      return null;
    }
    if (Math.abs(l.x) > this.W / 2 || Math.abs(l.y) > this.H / 2 || zw > 0.004 || zw < -0.03) { this.strokes.delete(key); return null; }
    const pr = Math.min(1, Math.max(0, (0.004 - zw) / 0.014)); this.sc = sc;
    const x = (l.x / this.W + 0.5) * this.BW, y = (0.5 - l.y / this.H) * this.BH, now = performance.now();
    const last = this.strokes.get(key);
    this.strokes.set(key, { x, y, t: now });
    if (!last) { this._seg(x, y, x, y, pr, 0); return 'write'; }
    const dist = Math.hypot(x - last.x, y - last.y), sp = dist / Math.max(1, now - last.t);
    if (dist > 200 / sc) return 'write';   // a jump (tracking): don't draw a line across the board
    this._seg(last.x, last.y, x, y, pr, sp); return 'write';
  }
  _seg(x0, y0, x1, y1, pr, sp) {
    const g = this.bInkG, d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / 1.3));
    if (this.chalk === 3) {   // duster: rubs out where it goes (a few passes for a clean board, like the real thing)
      g.save(); g.globalCompositeOperation = 'destination-out';
      const R = Math.max(8, 46 / (this.sc || 1));   // the duster's real size whatever the board's size
      for (let i = 0; i <= n; i += 3) { const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; const gr = g.createRadialGradient(x, y, 0, x, y, R); gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - R, y - R, 2 * R, 2 * R); }
      g.restore(); this.bDirty = true; return;
    }
    const c = CHALKS[this.chalk], r = Math.max(1.2, (3 + pr * 5) / (this.sc || 1)), skip = Math.min(0.55, Math.max(0, (sp - 0.9) * 0.35));
    g.fillStyle = c.css;
    for (let i = 0; i <= n; i++) {
      if (Math.random() < skip) continue;
      const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      for (let k = 0; k < 5; k++) {
        const a = Math.random() * 6.283, rr = Math.sqrt(Math.random()) * r, s = 0.7 + Math.random() * 1.4;
        g.globalAlpha = 0.25 + Math.random() * 0.55; g.fillRect(x + Math.cos(a) * rr, y + Math.sin(a) * rr, s, s);
      }
    }
    g.globalAlpha = 1; this.bDirty = true;
  }
  tickBoard() { if (this.board && this.bDirty && performance.now() - this.bT > 66) this._compose(); }   // up to ~15 uploads a second while writing
  save() { try { localStorage.setItem('vire.chatPanel', JSON.stringify({ on: this.on, board: !!this.board, p: this.obj.position.toArray(), q: this.obj.quaternion.toArray(), s: this.obj.scale.x })); } catch {} }
  reset(save = true) { const h = this.home(); this.obj.scale.setScalar(1); if (this.ledge) this._ledgeFit(); this.obj.position.copy(h.p); this.obj.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.yaw); if (save) this.save(); }
  setOn(on, save = true) { this.on = !!on; this.obj.visible = this.on; if (save) this.save(); }
  hit(P) { if (!this.on) return false; this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P)); return Math.abs(l.x) < this.W / 2 + 0.03 && Math.abs(l.y) < this.H / 2 + 0.03 && Math.abs(l.z) < 0.05; }
  grab() { this.held = true; }
  hold(world) { this.rig.updateMatrixWorld(); _m.copy(this.rig.matrixWorld).invert().multiply(world); _m.decompose(this.obj.position, this.obj.quaternion, _s); }
  scaleTo(s) { this.obj.scale.setScalar(Math.min(6, Math.max(0.5, s))); if (this.ledge) this._ledgeFit(); }   // half size .. 6x (2.2 x 2.7 m, for classes)
  corner(P) { if (!this.on) return false; this.obj.updateMatrixWorld(); const c = this.obj.localToWorld(_v.set(this.W / 2 - 0.009, this.H / 2 - 0.009, 0)); return c.distanceTo(P) < 0.03 * Math.max(1, this.obj.scale.x * 0.7); }
  release() { this.held = false; this.save(); }
  draw(chat, onEmote) {
    const g = this.g, W = 512, H = 640;
    g.fillStyle = '#0a0c12'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#9146ff'; g.fillRect(0, 0, W, 44); g.fillStyle = '#fff'; g.font = '800 22px system-ui,sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillText('CHAT · #' + (chat.channel || '?'), 14, 23);
    g.textAlign = 'right'; g.font = '600 15px system-ui,sans-serif'; g.fillText(chat.status === 'joined' ? '● live' : chat.status, W - 12, 23); g.textBaseline = 'alphabetic';
    drawChat(g, 0, 48, W, H - 48, chat.msgs, { fs: 22, onEmote });
    this.tex.needsUpdate = true;
  }
}
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const CHALKS = [{ name: 'WHITE', hex: 0xf2f0e8, css: '#f2f0e8' }, { name: 'YELLOW', hex: 0xf3dc6a, css: '#f3dc6a' }, { name: 'PINK', hex: 0xf2a7c3, css: '#f2a7c3' }];
