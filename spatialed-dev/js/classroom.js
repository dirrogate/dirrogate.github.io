// SpatialED #11 classroom (professor side). Students open student.html (same folder), type the class code and a
// name, and get the lesson the professor plays: ~15 packets a second carry the side, the playhead t, its speed and
// the professor's size and turn of the lesson. Each student device draws the same frame from t itself. No audio.
// Test version: handshake through ntfy.sh (net-link.js), then direct WebRTC on the local Wi-Fi. The offline
// classroom version will swap the transport for the laptop's own hub (/spatialed/ws); the packet stays the same.
import { classHostLink, CLASS_MAX } from './net-link.js';

const RATE_MS = 66;   // ~15 a second

export function startClass({ code, lesson, onChange }) {
  const st = { code, peers: [], status: 'starting', sent: 0 };
  let n = 0;
  const pkt = () => ({ ...lesson.packet(), n: ++n, hs: Math.round(performance.now()) });
  const link = classHostLink(code, {
    onStatus: s => { st.status = s === 'relay' ? 'open' : s === 'relay-retry' ? 'reconnecting' : s === 'full' ? `full (${CLASS_MAX})` : s; onChange && onChange(st); },
    onPeers: names => { st.peers = names; onChange && onChange(st); },
    onJoin: ent => { link.sendTo(ent, 'ctl', pkt()); },   // a newcomer gets the lesson at once (reliable channel)
  });
  const timer = setInterval(() => { if (link.count) { link.broadcast('state', pkt()); st.sent++; } }, RATE_MS);
  return {
    get state() { return st; },
    close() { clearInterval(timer); link.close(); st.status = 'closed'; st.peers = []; },
  };
}
