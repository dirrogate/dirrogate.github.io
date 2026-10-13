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
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false })); scr.position.z = 0.0006; g.add(scr);
    let s = null; try { s = JSON.parse(localStorage.getItem('vire.chatPanel') || 'null'); } catch {}
    if (s && s.p) { g.position.fromArray(s.p); g.quaternion.fromArray(s.q); } else this.reset(false);
    this.setOn(!!(s && s.on), false);
  }
  save() { try { localStorage.setItem('vire.chatPanel', JSON.stringify({ on: this.on, p: this.obj.position.toArray(), q: this.obj.quaternion.toArray() })); } catch {} }
  reset(save = true) { const h = this.home(); this.obj.position.copy(h.p); this.obj.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.yaw); if (save) this.save(); }
  setOn(on, save = true) { this.on = !!on; this.obj.visible = this.on; if (save) this.save(); }
  hit(P) { if (!this.on) return false; this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P)); return Math.abs(l.x) < this.W / 2 + 0.03 && Math.abs(l.y) < this.H / 2 + 0.03 && Math.abs(l.z) < 0.05; }
  grab() { this.held = true; }
  hold(world) { this.rig.updateMatrixWorld(); _m.copy(this.rig.matrixWorld).invert().multiply(world); _m.decompose(this.obj.position, this.obj.quaternion, _s); }
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
