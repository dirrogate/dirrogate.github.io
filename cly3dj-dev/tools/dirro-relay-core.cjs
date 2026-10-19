// Dirrogram relay core (audience-ar-plan.md, CLAUDE.md #427 / #429). One small WebSocket hub: the Quest (role=dj) sends
// the show state, the relay copies every message to the audience phones (role=fan) in the same room.
// Plain Node, no packages (minimal RFC 6455 framing). Used two ways:
//  - inside the owner's unified server (univdemomaster/server.js, port 8000): require this file and call
//    handleUpgrade(req, socket, head, '/dirro') from its 'upgrade' event, so the one Pinggy tunnel carries it:
//    relay address wss://<pinggy address>/dirro
//  - on its own (tools/dirro-relay.mjs: the PC, a laptop, or an Android phone in Termux)
// Messages are JSON text. The relay reads only k: 'ping' -> 'pong', 'c' (show config, kept and handed to every phone
// that joins), and sends the DJ {k:'fans', n} every 2 s. Everything else from the DJ goes out as is.
'use strict';
const crypto = require('crypto');

const MAX_FANS = 2000, MAX_MSG = 64 * 1024;
const rooms = new Map();   // room -> { dj, fans: Set, cfg }
const room = id => { let r = rooms.get(id); if (!r) rooms.set(id, r = { dj: null, fans: new Set(), cfg: null }); return r; };

function frame(op, data) {
  const p = Buffer.isBuffer(data) ? data : Buffer.from(data || ''), n = p.length;
  let h;
  if (n < 126) h = Buffer.from([0x80 | op, n]);
  else if (n < 65536) h = Buffer.from([0x80 | op, 126, n >> 8, n & 255]);
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([h, p]);
}
function wrap(sock, head) {
  let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0), frag = [];
  const ws = { sock, alive: true, onmsg: null, onclose: null,
    send(s) { if (!sock.destroyed && sock.writableLength < 512 * 1024) sock.write(frame(1, s)); },   // a phone that can't keep up skips frames
    close() { try { sock.end(frame(8, '')); } catch (e) {} } };
  const pump = () => {
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 15, masked = buf[1] & 0x80; let n = buf[1] & 127, o = 2;
      if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); o = 4; }
      else if (n === 127) { if (buf.length < 10) return; n = Number(buf.readBigUInt64BE(2)); o = 10; }
      if (n > MAX_MSG) { sock.destroy(); return; }
      const mk = masked ? 4 : 0; if (buf.length < o + mk + n) return;
      let p = buf.subarray(o + mk, o + mk + n);
      if (masked) { const m = buf.subarray(o, o + 4); p = Buffer.from(p); for (let i = 0; i < n; i++) p[i] ^= m[i & 3]; }
      buf = buf.subarray(o + mk + n);
      if (op === 8) { ws.close(); sock.destroy(); return; }
      if (op === 9) { sock.write(frame(10, p)); continue; }
      if (op === 10) { ws.alive = true; continue; }
      if (op === 0 || op === 1) { frag.push(p); if (fin) { const s = Buffer.concat(frag).toString('utf8'); frag = []; ws.alive = true; if (ws.onmsg) ws.onmsg(s); } }
    }
  };
  sock.on('data', d => { buf = Buffer.concat([buf, d]); pump(); });
  const end = () => { if (ws.onclose) { const f = ws.onclose; ws.onclose = null; f(); } };
  sock.on('close', end); sock.on('error', end);
  setImmediate(pump);   // bytes that arrived with the upgrade
  return ws;
}

// returns true when the request was a Dirrogram relay socket (and has been taken over), false to leave it alone
function handleUpgrade(req, sock, head, prefix = '') {
  const u = new URL(req.url, 'http://x'), m = u.pathname.match(/^(.*)\/r\/([A-Za-z0-9_-]{3,32})$/);
  if (!m || m[1] !== prefix) return false;
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return true; }
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
  sock.setNoDelay(true);
  const id = m[2], r = room(id), role = u.searchParams.get('role') === 'dj' ? 'dj' : 'fan', ws = wrap(sock, head);
  if (role === 'dj') { if (r.dj) r.dj.close(); r.dj = ws; }
  else { if (r.fans.size >= MAX_FANS) { ws.close(); return true; } r.fans.add(ws); if (r.cfg) ws.send(r.cfg); }
  console.log(new Date().toISOString(), 'dirrogram', id, role, 'in', '(phones', r.fans.size + ')');
  ws.onmsg = s => {
    if (s.length < 64 && s.includes('"ping"')) { try { const q = JSON.parse(s); if (q.k === 'ping') { ws.send(JSON.stringify({ k: 'pong', c: q.c, s: Date.now() })); return; } } catch (e) {} }
    if (role !== 'dj') return;   // phones only ping
    if (s.startsWith('{"k":"c"')) r.cfg = s;
    for (const f of r.fans) f.send(s);
  };
  ws.onclose = () => {
    if (role === 'dj') { if (r.dj === ws) r.dj = null; } else r.fans.delete(ws);
    if (!r.dj && !r.fans.size) rooms.delete(id);
    console.log(new Date().toISOString(), 'dirrogram', id, role, 'out', '(phones', r.fans.size + ')');
  };
  return true;
}
function status() { let fans = 0, djs = 0; for (const r of rooms.values()) { fans += r.fans.size; if (r.dj) djs++; } return `Dirrogram relay ok. Rooms with a DJ: ${djs}. Phones: ${fans}.`; }

const timer = setInterval(() => {   // phone count to each DJ; drop dead sockets (no pong in time)
  for (const r of rooms.values()) {
    if (r.dj) r.dj.send(JSON.stringify({ k: 'fans', n: r.fans.size }));
    for (const ws of [r.dj, ...r.fans]) {
      if (!ws) continue;
      if (!ws.alive && ws.pinged) { ws.sock.destroy(); continue; }
      if (Date.now() - (ws.pingT || 0) > 15000) { ws.alive = false; ws.pinged = true; ws.pingT = Date.now(); try { ws.sock.write(frame(9, '')); } catch (e) {} }
    }
  }
}, 2000);
if (timer.unref) timer.unref();

module.exports = { handleUpgrade, status };
