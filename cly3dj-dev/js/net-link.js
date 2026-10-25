// Spectator link (CLAUDE.md #158): a direct WebRTC data link between the Quest (host) and the phone
// camera (spectator). The one-time handshake goes through a relay: #467 our own hub on relay.dirrodj.club first,
// ntfy.sh (a free public pub/sub relay) as the fallback (see 'signalling' below): each side
// listens on its own topic and posts to the other's. The offer and answer carry all
// their network candidates in one message each (no trickle), so the handshake is two small posts. After it,
// all traffic is phone <-> Quest on the local network. (The PeerJS cloud relay was tried first: it accepts
// connections but no longer forwards messages, 29 Sep 2026.)
// Two channels: 'state' (unordered, no retransmits: a late pose is useless) and 'ctl' (reliable).
// #185: a third, 'file' (reliable, binary): media library pushes from the phone, 64 KB chunks with backpressure.
// #188: a fourth, 'prev' (unordered, no retransmits, binary): the phone's small preview JPEGs for the headset.

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
export const ID_PREFIX = 'cly3dj-v1-';

function token() { return Math.random().toString(36).slice(2, 12); }
const PART = 3000;   // #360 chars per relay message (ntfy.sh limit 4096 bytes incl. our wrapper)
async function zip(txt) {   // gzip + base64 (CompressionStream: Chrome 80+, Quest Browser)
  const buf = new Uint8Array(await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}
async function unzip(b64) {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

// #380 the mids of the m-lines an offer only wants to receive (the S8 studio's picture and sound slots)
function recvMids(sdp) {
  const out = new Set();
  for (const sec of sdp.split(/\r?\nm=/).slice(1)) { const mid = (sec.match(/\r?\na=mid:(\S+)/) || [])[1]; if (mid != null && /\r?\na=recvonly/.test(sec)) out.add(mid); }
  return out;
}
// #380 ask for full-band stereo Opus at 160 kbit/s (the receiver's description decides what the sender encodes)
export function opusStereo(sdp) {
  return sdp.replace(/a=fmtp:(\d+) (.*)\r?\n/g, (line, pt, p) => new RegExp(`a=rtpmap:${pt} opus/`, 'i').test(sdp)
    ? `a=fmtp:${pt} ${p.replace(/;?(stereo|sprop-stereo|maxaveragebitrate)=[^;]*/g, '')};stereo=1;sprop-stereo=1;maxaveragebitrate=160000\r\n` : line);
}

// ---------------------------------------------------------------- signalling (#467)
// Our own hub first: the SigHub Durable Object on the Cloudflare relay (cloudflare-relay/worker.js, /s/<topic>). A page listens on its
// topic over a WebSocket; a message is POSTed to the other side's topic and the hub says how many listeners it reached. When it
// reaches nobody (hub down, not deployed, blocked, or the other side is an older page that only listens on ntfy.sh), the same
// message goes through ntfy.sh in the #360 parts format. Every page listens on BOTH, so a hub page and an ntfy-only page still
// meet. Each message carries a mid, so one that arrives both ways counts once. Using ntfy.sh calls the fallback hook
// (main.js: a small note on the tablet).
const NTFY = 'https://ntfy.sh/';
const SIG_DEFAULT = 'https://relay.dirrodj.club';
const SIG_KEY = 'vire.sigRelay';   // localStorage: 'off' = ntfy.sh only (for tests); 'https://host' = another hub
function sigBase() {
  let v = ''; try { v = localStorage.getItem(SIG_KEY) || ''; } catch {}
  if (v === 'off') return '';
  return (v || SIG_DEFAULT).trim().replace(/^ws/i, 'http').replace(/\/+$/, '');
}
const HUB_WAIT = 3000;   // listening: wait this long for the hub before calling ntfy.sh alone 'ready'
const POST_WAIT = 4000;  // sending: the hub's answer to a post, at most
const PING_MS = 20000;   // keeps the hub socket fresh (answered by the hub without waking it)

let fbHook = null; const fbLast = new Map();
export function onRelayFallback(fn) { fbHook = fn; }   // fn(what, how): how = 'sent' | 'received'
function fellBack(what, how) {
  console.info(`[net-link] ${what}: handshake ${how} via ntfy.sh (fallback)`);
  const now = Date.now(); if (now - (fbLast.get(what) || 0) < 20000) return; fbLast.set(what, now);   // one note per link per 20 s
  try { fbHook && fbHook(what, how); } catch {}
}
async function hubPost(dst, body) {   // -> listeners reached; 0 when the hub is off, down, old (no /s/ route) or nobody listens
  const base = sigBase(); if (!base) return 0;
  const ac = typeof AbortController === 'function' ? new AbortController() : null, t = ac && setTimeout(() => ac.abort(), POST_WAIT);
  try {
    const r = await fetch(base + '/s/' + encodeURIComponent(dst), { method: 'POST', body, signal: ac ? ac.signal : undefined });   // text body: no CORS preflight
    if (!r.ok) return 0;
    const j = await r.json(); return j && j.n > 0 ? j.n : 0;
  } catch { return 0; } finally { if (t) clearTimeout(t); }
}
async function ntfyPost(dst, txt, mid) {   // #360 parts (older pages read these too); throws when ntfy.sh can't be reached
  let z = 0, body = txt; try { body = await zip(txt); z = 1; } catch {}
  const n = Math.ceil(body.length / PART);
  const rs = await Promise.all(Array.from({ length: n }, (_, i) =>
    fetch(NTFY + encodeURIComponent(dst), { method: 'POST', body: JSON.stringify({ part: 1, mid, i, n, z, d: body.slice(i * PART, (i + 1) * PART) }) })));
  const bad = rs.find(r => !r.ok); if (bad) throw new Error('ntfy.sh ' + bad.status);
}
// one message to a topic: the hub, else ntfy.sh. Returns 'hub' | 'ntfy'; throws when neither got it out.
async function deliver(dst, txt, what) {
  const mid = token();
  if (await hubPost(dst, JSON.stringify({ mid, m: txt }))) return 'hub';
  await ntfyPost(dst, txt, mid); if (sigBase()) fellBack(what, 'sent'); return 'ntfy';   // (hub switched off on purpose: no note)
}

// Listen on our topic (hub WebSocket + ntfy.sh SSE), post to theirs. Both reconnect by themselves.
// onStatus: 'relay' = ready to talk (hub up, or ntfy.sh up and the hub not there after HUB_WAIT), 'relay-retry' = neither is up.
class Relay {
  constructor(id, onMsg, onStatus, what = 'Link') {
    Object.assign(this, { id, onMsg, onStatus: onStatus || (() => {}), what, closed: false, seen: new Set(), ntSeen: new Set(), parts: new Map(),
      ws: null, hubUp: false, ntUp: false, tries: 0, fbReady: false, hubT: 0, pingT: 0, waitT: 0 });
    this.listenNtfy();
    if (sigBase()) this.listenHub();
  }
  dup(mid) {
    if (!mid) return false;
    if (this.seen.has(mid)) return true;
    this.seen.add(mid); if (this.seen.size > 300) this.seen.delete(this.seen.values().next().value);
    return false;
  }
  got(m, mid, viaNtfy) {
    if (this.closed || this.dup(mid)) return;
    if (viaNtfy) fellBack(this.what, 'received');
    this.onMsg(m);
  }
  fallbackReady() {   // ntfy.sh is up and the hub is not: talk through ntfy.sh
    if (this.closed || this.hubUp || !this.ntUp || this.fbReady) return;
    this.fbReady = true; this.onStatus('relay');
  }
  listenHub() {
    if (this.closed) return;
    let ws; try { ws = this.ws = new WebSocket(sigBase().replace(/^http/i, 'ws') + '/s/' + encodeURIComponent(this.id)); } catch { this.hubLost(); return; }
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.tries = 0; this.hubUp = true; this.fbReady = false; this.onStatus('relay');
      clearInterval(this.pingT); this.pingT = setInterval(() => { try { ws.send('{"k":"ping"}'); } catch {} }, PING_MS);
    };
    ws.onmessage = e => {
      if (typeof e.data !== 'string' || e.data.startsWith('{"k":"pong"')) return;
      let w, m; try { w = JSON.parse(e.data); m = JSON.parse(w.m); } catch { return; }
      this.got(m, w.mid, false);
    };
    ws.onclose = () => { if (this.ws !== ws) return; this.ws = null; clearInterval(this.pingT); this.hubUp = false; this.hubLost(); };
  }
  hubLost() {
    if (this.closed) return;
    if (this.ntUp) this.fallbackReady(); else this.onStatus('relay-retry');
    const d = Math.min(15000, 1000 * 2 ** Math.min(this.tries++, 4));   // 1, 2, 4, 8, 15 s
    clearTimeout(this.hubT); this.hubT = setTimeout(() => this.listenHub(), d);
  }
  listenNtfy() {
    let es; try { es = this.es = new EventSource(NTFY + encodeURIComponent(this.id) + '/sse'); } catch { return; }
    es.onopen = () => {
      this.ntUp = true;
      if (!sigBase()) { this.onStatus('relay'); return; }   // hub switched off: ntfy.sh is the only way (no note)
      clearTimeout(this.waitT); this.waitT = setTimeout(() => this.fallbackReady(), HUB_WAIT);
    };
    es.onerror = () => { this.ntUp = false; if (!this.closed && !this.hubUp) this.onStatus('relay-retry'); };
    es.onmessage = e => {
      let n, m; try { n = JSON.parse(e.data); m = JSON.parse(n.message); } catch { return; }
      if (n.id) { if (this.ntSeen.has(n.id)) return; this.ntSeen.add(n.id); }
      if (m && m.part) { this.part(m); return; }
      this.got(m, null, !!sigBase());   // an old-style single message (no mid)
    };
  }
  // #360 ntfy.sh turns a message over 4096 bytes into a file attachment (its text never arrives). An offer / answer
  // with the #238 video slot is ~3.3 KB on desktop Chrome and bigger on Android (more codecs + candidates), so every
  // ntfy.sh message is gzipped, base64'd and sent in parts of at most PART chars, put back together here.
  async part(m) {
    const k = m.mid; let e = this.parts.get(k);
    if (!e) { e = { got: new Array(m.n), have: 0, t: setTimeout(() => this.parts.delete(k), 30000) }; this.parts.set(k, e); }
    if (e.got[m.i] == null) { e.got[m.i] = m.d; e.have++; }
    if (e.have < m.n) return;
    clearTimeout(e.t); this.parts.delete(k);
    let msg; try { const txt = m.z ? await unzip(e.got.join('')) : e.got.join(''); msg = JSON.parse(txt); } catch (err) { console.warn('relay message', err); return; }
    this.got(msg, k, !!sigBase());
  }
  async send(type, dst, payload) {
    try { await deliver(dst, JSON.stringify({ type, src: this.id, payload }), this.what); }
    catch { this.onStatus('relay-retry'); }
  }
  close() {
    this.closed = true; clearTimeout(this.hubT); clearTimeout(this.waitT); clearInterval(this.pingT);
    try { this.es && this.es.close(); } catch {}
    const ws = this.ws; this.ws = null; try { ws && ws.close(); } catch {}
  }
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
    pc.ontrack = e => { this.h.onTrack && this.h.onTrack(e.track); };   // #238 LIVE CAM: the phone's composite as video
  }
  // #238 LIVE CAM (phone side): the video slot made with the offer, so the picture starts and stops mid-set without
  // a new handshake. Capped at 2 Mbit/s and 30 fps, lowest priority (the gear data on 'state' goes first), and on a
  // weak link it keeps the frame rate and softens the picture instead.
  // #347 kbps: PHONE CAM asks for more (3 Mbit/s plain, 4 Mbit/s for the packed green-screen frame)
  async setVideo(track, kbps = 2000) {
    const tx = this.vtx; if (!tx) return false;
    await tx.sender.replaceTrack(track || null);
    if (track) try {
      const p = tx.sender.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      Object.assign(p.encodings[0], { maxBitrate: kbps * 1000, maxFramerate: 30, priority: 'very-low', networkPriority: 'very-low' });
      p.degradationPreference = 'maintain-framerate';
      await tx.sender.setParameters(p);
    } catch (e) { console.warn('live cam params', e); }
    return true;
  }
  wire(c) {
    this.ch[c.label] = c; c.binaryType = 'arraybuffer';
    if (c.label === 'file') c.bufferedAmountLowThreshold = 1 << 20;
    c.onopen = () => { if (c.label !== 'file' && c.label !== 'prev' && this.ch.state && this.ch.ctl && this.ch.state.readyState === 'open' && this.ch.ctl.readyState === 'open') this.h.onOpen && this.h.onOpen(); };
    c.onmessage = e => { if (typeof e.data !== 'string') { this.h.onBinary && this.h.onBinary(e.data, c.label); return; } let m; try { m = JSON.parse(e.data); } catch { return; } this.h.onMessage && this.h.onMessage(m, c.label); };
    c.onclose = () => { if (c.label !== 'file' && c.label !== 'prev') this.h.onClose && this.h.onClose(); };
  }
  async call() { // spectator side: make the channels and the offer
    this.wire(this.pc.createDataChannel('state', { ordered: false, maxRetransmits: 0, priority: 'high' }));   // #238 the gear data before LIVE CAM video
    this.wire(this.pc.createDataChannel('ctl', { priority: 'high' }));
    this.wire(this.pc.createDataChannel('file'));   // #185
    this.wire(this.pc.createDataChannel('prev', { ordered: false, maxRetransmits: 0 }));   // #188
    this.vtx = this.pc.addTransceiver('video', { direction: 'sendonly' });   // #238 LIVE CAM slot, empty until asked for
    // #380 S8 STUDIO: two receive slots, the Quest's packed scene (H.264 preferred: hardware decoders) and its master sound.
    // Empty until the tablet turns the studio on, so an ordinary camera phone pays nothing but a longer handshake.
    preferH264(this.srx = this.pc.addTransceiver('video', { direction: 'recvonly' }));
    this.sax = this.pc.addTransceiver('audio', { direction: 'recvonly' });
    const offer = await this.pc.createOffer();
    offer.sdp = opusStereo(offer.sdp);   // #380 the music arrives in stereo (Opus is mono unless the receiver asks)
    await this.pc.setLocalDescription(offer);
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
      // #380 S8 STUDIO (Quest side): the phone's receive slots (recvonly m-lines in its offer) become our send slots, both
      // in one stream so the phone's browser keeps the picture and the sound in step. Older phone pages have none.
      const rx = recvMids(p.sdp.sdp || ''), stream = new MediaStream();
      for (const tx of this.pc.getTransceivers()) {
        if (!rx.has(tx.mid)) continue;
        tx.direction = 'sendonly'; try { tx.sender.setStreams(stream); } catch {}
        if (tx.receiver.track.kind === 'video') { this.stv = tx; preferH264(tx); } else this.sta = tx;
      }
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
  // #380 S8 STUDIO (Quest side): put the studio picture / sound on the phone's receive slots (null = stop sending)
  get studioOk() { return !!this.stv; }
  async setStudio(v, a, kbps = 4500) {
    if (!this.stv) return false;
    await this.stv.sender.replaceTrack(v || null);
    if (this.sta) await this.sta.sender.replaceTrack(a || null);
    const set = async (s, o) => { try { const p = s.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}]; Object.assign(p.encodings[0], o); await s.setParameters(p); } catch (e) { console.warn('studio params', e); } };
    if (v) await set(this.stv.sender, { maxBitrate: kbps * 1000, maxFramerate: 30, priority: 'medium', networkPriority: 'medium' });   // below 'state' / 'ctl' (high), so the gear data still goes first
    if (a && this.sta) await set(this.sta.sender, { maxBitrate: 160000, priority: 'high', networkPriority: 'high' });
    return true;
  }
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
  }, handlers.onStatus, 'Spectator phone');
  const link = { get pipe() { return pipe; }, set pipe(p) {}, send: (l, o) => !!pipe && pipe.send(l, o), get isOpen() { return !!pipe && pipe.isOpen; }, get fileOpen() { return !!pipe && pipe.fileOpen; },
    sendBin: buf => pipe ? pipe.sendBin(buf) : Promise.reject(new Error('not connected')),   // #206 media sync, Quest to phone
    get studioOk() { return !!pipe && pipe.isOpen && pipe.studioOk; },   // #380 the phone page has the studio slots
    setStudio: (v, a, kbps) => pipe ? pipe.setStudio(v, a, kbps) : Promise.resolve(false),
    close() { relay.close(); if (pipe) pipe.close(); } };
  return link;
}

// Phone side: registers under a random id and calls the Quest's code.
export function spectatorLink(code, handlers) {
  const me = ID_PREFIX + code + '-cam-' + token().slice(0, 6);
  let pipe = null;
  const relay = new Relay(me, async m => { if (pipe && m.src === pipe.remote) { try { await pipe.signal(m); } catch (e) { handlers.onStatus && handlers.onStatus('error: ' + e.message); } } },
    s => { handlers.onStatus && handlers.onStatus(s); if (s === 'relay' && !pipe) { pipe = new Pipe(relay, ID_PREFIX + code, handlers); pipe.call().catch(e => handlers.onStatus && handlers.onStatus('error: ' + e.message));
      const p0 = pipe; setTimeout(() => { if (pipe === p0 && !p0.isOpen && p0.pc.connectionState !== 'connecting') handlers.onStatus && handlers.onStatus('quest-offline'); }, 12000); } }, 'Quest');
  return { send: (l, o) => !!pipe && pipe.send(l, o), get isOpen() { return !!pipe && pipe.isOpen; }, get fileOpen() { return !!pipe && pipe.fileOpen; },
    sendBin: buf => pipe ? pipe.sendBin(buf) : Promise.reject(new Error('not connected')),
    sendPrev: buf => !!pipe && pipe.sendPrev(buf),
    setVideo: (t, kbps) => pipe ? pipe.setVideo(t, kbps) : Promise.resolve(false),   // #238
    close() { relay.close(); if (pipe) pipe.close(); } };
}

// ---------------------------------------------------------------- Cly3DTV (CLAUDE.md #376)
// A venue screen: the page venue.html (title Cly3DTV) on a Fire Stick / phone with HDMI / smart TV. Pairing, once: the TV shows a
// 6-digit code and listens on a relay topic named after it; the tablet types the code and the Quest posts a long random KEY to that
// topic; the TV keeps the key. From then on the TV calls the Quest under that key (the TV makes the offer, wanting to receive video and
// audio; the Quest answers with the stream picture and, if the tablet allows it, the master sound). One TV at a time. 'ctl' is a small
// reliable data channel for status messages both ways ({t:'audio', on}, {t:'forget'}).
const TV_PAIR = code => ID_PREFIX + 'tvpair-' + code;
const TV_HOST = key => ID_PREFIX + 'tvhost-' + key;
export function tvRandom(n, alphabet) { const a = new Uint32Array(n); crypto.getRandomValues(a); return [...a].map(x => alphabet[x % alphabet.length]).join(''); }
export const tvNewCode = () => tvRandom(6, '0123456789');
export const tvNewKey = () => tvRandom(24, 'abcdefghijklmnopqrstuvwxyz0123456789');
const KEY_OK = /^[a-z0-9]{24}$/;
function gather(pc) {   // all candidates in the description (at most 2.5 s)
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(res => { const t = setTimeout(res, 2500); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } }); });
}
function preferH264(tx) {   // hardware encoders / decoders speak H.264 (Twitch gets it too)
  try {
    const kind = tx.receiver.track.kind; if (kind !== 'video') return;
    const caps = RTCRtpSender.getCapabilities('video').codecs, h264 = caps.filter(c => /h264/i.test(c.mimeType)).sort((a, b) => (/42e01f/.test(b.sdpFmtpLine) ? 1 : 0) - (/42e01f/.test(a.sdpFmtpLine) ? 1 : 0));
    const rest = caps.filter(c => !/h264/i.test(c.mimeType)); if (h264.length) tx.setCodecPreferences([...h264, ...rest]);
  } catch {}
}

// Quest, pairing: hand the key to whichever TV shows this code
export async function tvPairSend(code, key) {
  await deliver(TV_PAIR(code), JSON.stringify({ type: 'PAIR', key }), 'DirroTV pairing');   // #467 hub first, ntfy.sh as the fallback
}
// TV, pairing: wait for the key (only a well-formed key from a PAIR message counts)
export function tvPairListen(code, onKey, onStatus) {
  const relay = new Relay(TV_PAIR(code), m => { if (m && m.type === 'PAIR' && typeof m.key === 'string' && KEY_OK.test(m.key)) onKey(m.key); }, onStatus, 'Quest (pairing)');
  return { close: () => relay.close() };
}

// TV side: call the Quest under the key. h.onTrack(track), h.onState(connectionState), h.onMsg(obj over ctl), h.onStatus(relay status).
// Returns { close(), ctl(obj), pc }. The caller retries with a fresh tvConnect when it does not get through.
export function tvConnect(key, h) {
  let pc = null, ctl = null, closed = false;
  const relay = new Relay(ID_PREFIX + 'tv-' + key + '-' + token().slice(0, 6), async m => {
    if (m.type === 'ANSWER' && pc) { try { await pc.setRemoteDescription(m.payload.sdp); } catch (e) { h.onStatus && h.onStatus('error: ' + e.message); } }
  }, async s => {
    h.onStatus && h.onStatus(s);
    if (s !== 'relay' || pc || closed) return;
    try {
      pc = new RTCPeerConnection({ iceServers: ICE });
      preferH264(pc.addTransceiver('video', { direction: 'recvonly' })); pc.addTransceiver('audio', { direction: 'recvonly' });
      ctl = pc.createDataChannel('ctl'); ctl.onmessage = e => { try { h.onMsg && h.onMsg(JSON.parse(e.data)); } catch {} };
      ctl.onclose = () => { if (!closed) h.onState && h.onState('closed'); };   // the Quest closed the link or went away: noticed at once
      pc.ontrack = e => h.onTrack && h.onTrack(e.track);
      pc.onconnectionstatechange = () => h.onState && h.onState(pc.connectionState);
      await pc.setLocalDescription(await pc.createOffer()); await gather(pc);
      if (!closed) relay.send('OFFER', TV_HOST(key), { sdp: pc.localDescription.toJSON() });
    } catch (e) { h.onStatus && h.onStatus('error: ' + e.message); }
  }, 'Quest (DirroTV)');
  return {
    get pc() { return pc; },
    ctl: o => { if (ctl && ctl.readyState === 'open') { ctl.send(JSON.stringify(o)); return true; } return false; },
    close() { closed = true; relay.close(); try { pc && pc.close(); } catch {} },
  };
}

// Quest side: listen under the key; each OFFER from the TV replaces the previous link. h.video() / h.audio() give the tracks to send
// (promises; audio may be null), h.onOffer(), h.onUp(), h.onDown(why), h.onCtlOpen(), h.onMsg(obj), h.onStatus(s).
// Returns { ready, pc, setVideo(track), setAudio(track|null), ctl(obj), isUp, close() }.
export function tvHost(key, h) {
  let pc = null, ctl = null, vtx = null, atx = null, onReady; const ready = new Promise(res => { onReady = res; setTimeout(res, 3000); });
  const rate = async (sender, bps, fps) => {
    try { const p = sender.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}]; Object.assign(p.encodings[0], fps ? { maxBitrate: bps, maxFramerate: fps } : { maxBitrate: bps }); await sender.setParameters(p); } catch {}
  };
  const relay = new Relay(TV_HOST(key), async m => {
    if (m.type !== 'OFFER' || !m.src) return;
    try {
      h.onOffer && h.onOffer();
      if (pc) { const old = pc; pc = null; try { old.close(); } catch {} }
      const p = pc = new RTCPeerConnection({ iceServers: ICE }); vtx = atx = ctl = null;
      p.ondatachannel = e => { if (e.channel.label !== 'ctl') return; ctl = e.channel; ctl.onopen = () => h.onCtlOpen && h.onCtlOpen(); ctl.onclose = () => { if (p === pc) h.onDown && h.onDown('ctl closed'); };   // a closed page is noticed at once, not after the connection times out
      ctl.onmessage = ev => { try { h.onMsg && h.onMsg(JSON.parse(ev.data)); } catch {} }; };
      p.onconnectionstatechange = () => {
        if (p !== pc) return; const s = p.connectionState;
        if (s === 'connected') h.onUp && h.onUp(); else if (s === 'failed' || s === 'closed' || s === 'disconnected') h.onDown && h.onDown(s);
      };
      await p.setRemoteDescription(m.payload.sdp);
      const stream = new MediaStream();
      for (const tx of p.getTransceivers()) {
        const kind = tx.receiver.track.kind; tx.direction = 'sendonly';
        try { tx.sender.setStreams(stream); } catch {}   // one stream: the browser keeps picture and sound in step
        if (kind === 'video') { vtx = tx; preferH264(tx); const t = await h.video(); if (t) await tx.sender.replaceTrack(t); await rate(tx.sender, 6000000, 30); }
        else if (kind === 'audio') { atx = tx; const t = h.audio ? await h.audio() : null; if (t) await tx.sender.replaceTrack(t); await rate(tx.sender, 160000); }
      }
      if (p !== pc) return;
      await p.setLocalDescription(await p.createAnswer()); await gather(p);
      if (p === pc) relay.send('ANSWER', m.src, { sdp: p.localDescription.toJSON() });
    } catch (e) { h.onStatus && h.onStatus('error: ' + e.message); }
  }, s => { h.onStatus && h.onStatus(s); if (s === 'relay') onReady(); }, 'DirroTV');
  const link = {
    ready, get pc() { return pc; }, get isUp() { return !!pc && pc.connectionState === 'connected'; },
    ctl: o => { if (ctl && ctl.readyState === 'open') { ctl.send(JSON.stringify(o)); return true; } return false; },
    async setVideo(t) { if (vtx) await vtx.sender.replaceTrack(t || null); },
    async setAudio(t) { if (atx) await atx.sender.replaceTrack(t || null); link.ctl({ t: 'audio', on: !!t }); },
    close() { relay.close(); const old = pc; pc = null; try { old && old.close(); } catch {} },
  };
  return link;
}
