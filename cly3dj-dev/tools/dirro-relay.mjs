// Dirrogram relay (audience-ar-plan.md, Phase B, CLAUDE.md #427). One small WebSocket hub: the Quest (role=dj) sends
// the show state, the relay copies every message to the audience phones (role=fan) in the same room.
// Plain Node 18+, no packages, so it runs on the PC, a laptop, or an Android phone in Termux:
//   node dirro-relay.mjs            (port 8090; PORT=9000 node dirro-relay.mjs for another)
// Phones and the Quest need wss:// (the pages are https), so put a tunnel in front, e.g. Pinggy:
//   ssh -p 443 -R0:localhost:8090 <your Pinggy Pro token>@pro.pinggy.io   ->  wss://<your-name>.a.pinggy.link
// Endpoints: ws(s)://host/r/<ROOM>?role=dj|fan, and GET / = a one-line status page.
// Messages are JSON text. The relay reads only k: 'ping' -> 'pong' (clock and latency), 'c' (show config, kept and
// handed to every phone that joins), and sends the DJ {k:'fans', n} every 2 s. Everything else from the DJ goes out as is.
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = +(process.env.PORT || 8090), MAX_FANS = 2000, MAX_MSG = 64 * 1024;
const rooms = new Map();   // room -> { dj: sock | null, fans: Set<sock>, cfg: string | null }
const room = id => { let r = rooms.get(id); if (!r) rooms.set(id, r = { dj: null, fans: new Set(), cfg: null }); return r; };

// ---- minimal RFC 6455 framing (text, ping / pong, close; no extensions)
function frame(op, data) {
  const p = Buffer.isBuffer(data) ? data : Buffer.from(data || ''), n = p.length;
  const h = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  return Buffer.concat([h, p]);
}
function wrap(sock) {
  let buf = Buffer.alloc(0), frag = [];
  const ws = { sock, alive: true, onmsg: null, onclose: null,
    send(s) { if (!sock.destroyed && sock.writableLength < 512 * 1024) sock.write(frame(1, s)); },   // a phone that can't keep up skips frames instead of piling them up
    close() { try { sock.end(frame(8, '')); } catch (e) {} } };
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
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
  });
  const end = () => { if (ws.onclose) { const f = ws.onclose; ws.onclose = null; f(); } };
  sock.on('close', end); sock.on('error', end);
  return ws;
}

const server = http.createServer((req, res) => {
  let fans = 0, djs = 0; for (const r of rooms.values()) { fans += r.fans.size; if (r.dj) djs++; }
  res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
  res.end(`Dirrogram relay ok. Rooms with a DJ: ${djs}. Phones: ${fans}.\n`);
});
server.on('upgrade', (req, sock) => {
  const u = new URL(req.url, 'http://x'), m = u.pathname.match(/^\/r\/([A-Za-z0-9_-]{3,32})$/), key = req.headers['sec-websocket-key'];
  if (!m || !key) { sock.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
  sock.setNoDelay(true);
  const id = m[1], r = room(id), role = u.searchParams.get('role') === 'dj' ? 'dj' : 'fan', ws = wrap(sock);
  if (role === 'dj') { if (r.dj) r.dj.close(); r.dj = ws; }
  else { if (r.fans.size >= MAX_FANS) { ws.close(); return; } r.fans.add(ws); if (r.cfg) ws.send(r.cfg); }
  console.log(new Date().toISOString(), id, role, 'in', '(phones', r.fans.size + ')');
  ws.onmsg = s => {
    if (s.length < 64 && s.includes('"ping"')) { try { const q = JSON.parse(s); if (q.k === 'ping') { ws.send(JSON.stringify({ k: 'pong', c: q.c, s: Date.now() })); return; } } catch (e) {} }
    if (role !== 'dj') return;   // phones only ping
    if (s.startsWith('{"k":"c"')) r.cfg = s;
    for (const f of r.fans) f.send(s);
  };
  ws.onclose = () => {
    if (role === 'dj') { if (r.dj === ws) r.dj = null; } else r.fans.delete(ws);
    if (!r.dj && !r.fans.size) rooms.delete(id);
    console.log(new Date().toISOString(), id, role, 'out', '(phones', r.fans.size + ')');
  };
});
setInterval(() => {   // phone count to each DJ; drop dead sockets (no pong for 30 s)
  for (const r of rooms.values()) {
    if (r.dj) r.dj.send(JSON.stringify({ k: 'fans', n: r.fans.size }));
    for (const ws of [r.dj, ...r.fans]) { if (!ws) continue; if (!ws.alive && ws.pinged) { ws.sock.destroy(); continue; } if (Date.now() - (ws.pingT || 0) > 15000) { ws.alive = false; ws.pinged = true; ws.pingT = Date.now(); try { ws.sock.write(frame(9, '')); } catch (e) {} } }
  }
}, 2000);
server.listen(PORT, () => console.log(`Dirrogram relay on port ${PORT} (ws://localhost:${PORT}/r/ROOM?role=dj|fan)`));
