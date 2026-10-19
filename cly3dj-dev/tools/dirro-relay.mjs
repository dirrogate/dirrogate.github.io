// Dirrogram relay on its own (CLAUDE.md #427, #429). The workings are in dirro-relay-core.cjs, which the owner's
// unified server (port 8000) also loads, so normally this file isn't needed: the relay is wss://<pinggy address>/dirro.
// Use this one where that server isn't running, e.g. an Android phone in Termux or a laptop:
//   node dirro-relay.mjs            (port 8090; PORT=9000 node dirro-relay.mjs for another)
// then a tunnel in front (Pinggy: ssh -p 443 -R0:localhost:8090 a.pinggy.io); relay address = wss://<that address>
// Endpoints: ws(s)://host/r/<ROOM>?role=dj|fan, and GET / = a one-line status.
import http from 'node:http';
import { createRequire } from 'node:module';
const relay = createRequire(import.meta.url)('./dirro-relay-core.cjs');

const PORT = +(process.env.PORT || 8090);
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); res.end(relay.status() + '\n'); });
server.on('upgrade', (req, sock, head) => { if (!relay.handleUpgrade(req, sock, head, '')) sock.end('HTTP/1.1 400 Bad Request\r\n\r\n'); });
server.listen(PORT, () => console.log(`Dirrogram relay on port ${PORT} (ws://localhost:${PORT}/r/ROOM?role=dj|fan)`));
