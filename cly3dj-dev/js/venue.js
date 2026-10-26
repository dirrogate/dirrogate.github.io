// Cly3DTV (CLAUDE.md #376): the logic of venue.html. See net-link.js (tvPairListen / tvConnect) for the link.
// States: CODE (no key saved: show a 6-digit code, wait for the tablet to send the key) -> WAIT (key saved: call the Quest, retry until it answers)
// -> LIVE (the picture plays full screen). The sound button exists only while the Quest is sending sound; browsers only let sound start after a
// key press, so it starts muted and the first OK / Enter on the remote unmutes it (and stays unmuted for the rest of the visit).
import { tvConnect, tvPairListen, tvNewCode } from './net-link.js';

const KEY = 'cly3dtv.key', $ = id => document.getElementById(id);
const v = $('v'), stand = $('stand'), codeEl = $('code'), msgEl = $('msg'), subEl = $('sub'), againBtn = $('again'), snd = $('snd');
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, x) => { try { localStorage.setItem(k, x); } catch {} }, del: k => { try { localStorage.removeItem(k); } catch {} } };

let mode = '', pairL = null, conn = null, retryT = 0, codeT = 0, connected = false, audioOn = false, userUnmuted = false, ms = null, relayNote = '';

function show(m, msg, sub = '') {   // 'code' | 'wait' | 'live'
  mode = m; stand.hidden = m === 'live';
  codeEl.hidden = m !== 'code'; againBtn.hidden = m !== 'wait';
  if (m !== 'live') { msgEl.textContent = msg; subEl.textContent = sub; }
  soundButton();
}
function soundButton() {
  const on = audioOn && !!ms && ms.getAudioTracks().length > 0;   // only while the Quest is sending sound
  snd.hidden = !on;
  if (on) { v.muted = !userUnmuted; snd.textContent = v.muted ? 'SOUND  ·  press OK' : 'SOUND ON'; if (mode === 'live' && document.activeElement !== snd) { try { snd.focus(); } catch {} } }
  else v.muted = true;
}
function toggleSound() {
  if (snd.hidden) return;
  userUnmuted = v.muted; v.muted = !v.muted; if (!v.muted) { userUnmuted = true; v.play && v.play().catch(() => {}); }
  soundButton();
}
snd.addEventListener('click', toggleSound);
document.addEventListener('keydown', e => {
  if (['Enter', ' ', 'MediaPlayPause', 'Select'].includes(e.key) || e.keyCode === 13 || e.keyCode === 179) { if (!snd.hidden && document.activeElement !== againBtn) { e.preventDefault(); toggleSound(); } }
  try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); } catch {}
});

// ---- pairing: a code on the screen
function codeMode() {
  clearTimeout(codeT); stopConn(); if (pairL) pairL.close();
  const code = tvNewCode();
  codeEl.textContent = code.slice(0, 3) + ' ' + code.slice(3);
  show('code', 'Type this code on the DirroDJ tablet:  DIRROTV (main menu)');
  pairL = tvPairListen(code, key => { store.set(KEY, key); pairL.close(); pairL = null; clearTimeout(codeT); waitMode(key); }, s => { relayNote = s; });
  codeT = setTimeout(codeMode, 10 * 60 * 1000);   // a fresh code every 10 minutes
}

// ---- paired: find the Quest
function stopConn() { clearTimeout(retryT); if (conn) { conn.close(); conn = null; } connected = false; }
function waitMode(key) {
  stopConn(); ms = null; audioOn = false; v.srcObject = null;
  show('wait', 'Waiting for the Quest…', 'DirroDJ on the headset, TV switched on at the tablet (DIRROTV)');
  const attempt = () => {
    stopConn(); const my = conn = tvConnect(key, {
      onTrack: t => { if (conn !== my) return; if (!ms) { ms = new MediaStream(); v.srcObject = ms; } ms.addTrack(t); v.play && v.play().catch(() => {}); soundButton(); },
      onState: s => {
        if (conn !== my) return;
        if (s === 'connected') { connected = true; clearTimeout(retryT); show('live'); wake(); }
        else if (s === 'failed' || s === 'closed' || s === 'disconnected') lost(key);
      },
      onMsg: m => {
        if (conn !== my) return;
        if (m.t === 'hi') { audioOn = !!m.audio; soundButton(); }
        else if (m.t === 'audio') { audioOn = !!m.on; soundButton(); }
        else if (m.t === 'forget') forget();
      },
      onStatus: s => { relayNote = s; },
    });
    retryT = setTimeout(() => { if (!connected && conn === my) { lost(key); } }, 12000);
  };
  attempt();
}
function lost(key) {
  stopConn(); ms = null; audioOn = false; v.srcObject = null;
  show('wait', 'Waiting for the Quest…', 'DirroDJ on the headset, TV switched on at the tablet (DIRROTV)');
  retryT = setTimeout(() => { if (mode === 'wait') waitMode(key); }, 3000);
}
function forget() { store.del(KEY); stopConn(); ms = null; audioOn = false; v.srcObject = null; codeMode(); }
againBtn.addEventListener('click', forget);

let lock = null;
async function wake() { try { if (navigator.wakeLock && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && mode === 'live') wake(); });

const saved = store.get(KEY);
if (saved && /^[a-z0-9]{24}$/.test(saved)) waitMode(saved); else codeMode();
