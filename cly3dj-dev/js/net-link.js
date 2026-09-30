// Spectator link (CLAUDE.md #158): a direct WebRTC data link between the Quest (host) and the phone
// camera (spectator). The one-time handshake goes through ntfy.sh, a free public pub/sub relay: each side
// listens on its own topic (Server-Sent Events) and posts to the other's. The offer and answer carry all
// their network candidates in one message each (no trickle), so the handshake is two small posts. After it,
// all traffic is phone <-> Quest on the local network. (The PeerJS cloud relay was tried first: it accepts
// connections but no longer forwards messages, 29 Sep 2026.)
// Two channels: 'state' (unordered, no retransmits: a late pose is useless) and 'ctl' (reliable).
// #185: a third, 'file' (reliable, binary): media library pushes from the phone, 64 KB chunks with backpressure.
// #188: a fourth, 'prev' (unordered, no retransmits, binary): the phone's small preview JPEGs for the headset.

const RELAY = 'https://ntfy.sh/';
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
export const ID_PREFIX = 'cly3dj-v1-';

function token() { return Math.random().toString(36).slice(2, 12); }

// Signalling: listen on our topic, post to theirs. Reconnects by itself (EventSource does).
class Relay {
  constructor(id, onMsg, onStatus) {
    this.id = id; this.onMsg = onMsg; this.onStatus = onStatus || (() => {}); this.closed = false; this.seen = new Set();
    const es = this.es = new EventSource(RELAY + encodeURIComponent(id) + '/sse');
    es.onopen = () => this.onStatus('relay');
    es.onerror = () => { if (!this.closed) this.onStatus('relay-retry'); };
    es.onmessage = e => {
      let n, m; try { n = JSON.parse(e.data); m = JSON.parse(n.message); } catch { return; }
      if (n.id && this.seen.has(n.id)) return; this.seen.add(n.id);
      this.onMsg(m);
    };
  }
  send(type, dst, payload) {
    fetch(RELAY + encodeURIComponent(dst), { method: 'POST', body: JSON.stringify({ type, src: this.id, payload }) })
      .catch(() => this.onStatus('relay-retry'));
  }
  close() { this.closed = true; try { this.es.close(); } catch {} }
}

// One peer connection with the two channels.
class Pipe {
  constructor(relay, remote, handlers) {
    this.relay = relay; this.remote = remote; this.h = handlers; this.ch = {};
    const pc = this.pc = new RTCPeerConnection({ iceServers: ICE });
    pc.onconnectionstatechange = () => {
      this.h.onState && this.h.onState(pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.h.onClose && this.h.onClose();
    };
    pc.ondatachannel = e => this.wire(e.channel);
  }
  wire(c) {
    this.ch[c.label] = c; c.binaryType = 'arraybuffer';
    if (c.label === 'file') c.bufferedAmountLowThreshold = 1 << 20;
    c.onopen = () => { if (c.label !== 'file' && c.label !== 'prev' && this.ch.state && this.ch.ctl && this.ch.state.readyState === 'open' && this.ch.ctl.readyState === 'open') this.h.onOpen && this.h.onOpen(); };
    c.onmessage = e => { if (typeof e.data !== 'string') { this.h.onBinary && this.h.onBinary(e.data, c.label); return; } let m; try { m = JSON.parse(e.data); } catch { return; } this.h.onMessage && this.h.onMessage(m, c.label); };
    c.onclose = () => { if (c.label !== 'file' && c.label !== 'prev') this.h.onClose && this.h.onClose(); };
  }
  async call() { // spectator side: make the channels and the offer
    this.wire(this.pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
    this.wire(this.pc.createDataChannel('ctl'));
    this.wire(this.pc.createDataChannel('file'));   // #185
    this.wire(this.pc.createDataChannel('prev', { ordered: false, maxRetransmits: 0 }));   // #188
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await this.gathered();
    this.relay.send('OFFER', this.remote, { sdp: this.pc.localDescription.toJSON() });
  }
  gathered() { // all candidates in the description (max 2.5 s: LAN candidates come in well before that)
    const pc = this.pc; if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(res => { const t = setTimeout(res, 2500); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } }); });
  }
  async signal(m) {
    const p = m.payload || {};
    if (m.type === 'OFFER') {
      await this.pc.setRemoteDescription(p.sdp);
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      await this.gathered();
      this.relay.send('ANSWER', this.remote, { sdp: this.pc.localDescription.toJSON() });
    } else if (m.type === 'ANSWER') await this.pc.setRemoteDescription(p.sdp);
  }
  // state: dropped when the channel is backed up, so the Quest never queues stale poses
  send(label, obj) {
    const c = this.ch[label]; if (!c || c.readyState !== 'open') return false;
    if (label === 'state' && c.bufferedAmount > 16384) return false;
    c.send(JSON.stringify(obj)); return true;
  }
  // #185: binary chunk on the 'file' channel; resolves once the send buffer has room again (keeps ~4 MB in flight)
  async sendBin(buf) {
    const c = this.ch.file; if (!c || c.readyState !== 'open') throw new Error('file channel closed');
    if (c.bufferedAmount > (4 << 20)) await new Promise((res, rej) => { const t = setInterval(() => { if (c.readyState !== 'open') { clearInterval(t); rej(new Error('file channel closed')); } }, 500);
      c.addEventListener('bufferedamountlow', () => { clearInterval(t); res(); }, { once: true }); });
    c.send(buf);
  }
  // #188: preview frame; dropped (false) when the previous one hasn't gone yet
  sendPrev(buf) { const c = this.ch.prev; if (!c || c.readyState !== 'open' || c.bufferedAmount > 65536) return false; c.send(buf); return true; }
  get fileOpen() { return !!(this.ch.file && this.ch.file.readyState === 'open'); }
  get isOpen() { return !!(this.ch.state && this.ch.state.readyState === 'open' && this.ch.ctl && this.ch.ctl.readyState === 'open'); }
  close() { try { this.pc.close(); } catch {} }
}

// Quest side: listens as cly3dj-<code>; one spectator at a time (a new one replaces the old).
export function hostLink(code, handlers) {
  let pipe = null;
  const relay = new Relay(ID_PREFIX + code, async m => {
    if (m.type === 'OFFER') {
      if (pipe) pipe.close();
      pipe = new Pipe(relay, m.src, handlers);
      link.pipe = pipe;
    }
    if (pipe && m.src === pipe.remote) { try { await pipe.signal(m); } catch (e) { handlers.onStatus && handlers.onStatus('error: ' + e.message); } }
  }, handlers.onStatus);
  const link = { get pipe() { return pipe; }, set pipe(p) {}, send: (l, o) => !!pipe && pipe.send(l, o), get isOpen() { return !!pipe && pipe.isOpen; }, get fileOpen() { return !!pipe && pipe.fileOpen; },
    sendBin: buf => pipe ? pipe.sendBin(buf) : Promise.reject(new Error('not connected')),   // #206 media sync, Quest to phone
    close() { relay.close(); if (pipe) pipe.close(); } };
  return link;
}

// Phone side: registers under a random id and calls the Quest's code.
export function spectatorLink(code, handlers) {
  const me = ID_PREFIX + code + '-cam-' + token().slice(0, 6);
  let pipe = null;
  const relay = new Relay(me, async m => { if (pipe && m.src === pipe.remote) { try { await pipe.signal(m); } catch (e) { handlers.onStatus && handlers.onStatus('error: ' + e.message); } } },
    s => { handlers.onStatus && handlers.onStatus(s); if (s === 'relay' && !pipe) { pipe = new Pipe(relay, ID_PREFIX + code, handlers); pipe.call().catch(e => handlers.onStatus && handlers.onStatus('error: ' + e.message));
      const p0 = pipe; setTimeout(() => { if (pipe === p0 && !p0.isOpen && p0.pc.connectionState !== 'connecting') handlers.onStatus && handlers.onStatus('quest-offline'); }, 12000); } });
  return { send: (l, o) => !!pipe && pipe.send(l, o), get isOpen() { return !!pipe && pipe.isOpen; }, get fileOpen() { return !!pipe && pipe.fileOpen; },
    sendBin: buf => pipe ? pipe.sendBin(buf) : Promise.reject(new Error('not connected')),
    sendPrev: buf => !!pipe && pipe.sendPrev(buf),
    close() { relay.close(); if (pipe) pipe.close(); } };
}
