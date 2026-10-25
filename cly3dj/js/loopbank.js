// #470 LOOP SLOTS and LOOP BANKS, kept in the browser's private storage (OPFS) as plain files so they can be exported later:
//   vire-loops/slots/slot<n>.json  + slot<n>_A.wav / slot<n>_B.wav   the 4 working slots (n = 1..4)
//   vire-loops/banks/<name>/...      the same files, one folder per saved bank
// WAVs are 16-bit stereo at the rate they were recorded; one WAV per mixer channel the loop was sampled from (A, B).
// The JSON holds what a WAV can't: in / out points (samples), source channels, the deck BPM when it was taken, the time.
export const SLOTS = 4;
const ROOT = 'vire-loops';

async function dir(path, create = true) {
  let d = await navigator.storage.getDirectory();
  for (const p of [ROOT, ...path]) d = await d.getDirectoryHandle(p, { create });
  return d;
}
async function writeFile(d, name, data) {
  const f = await d.getFileHandle(name, { create: true }), w = await f.createWritable();
  await w.write(data); await w.close();
}
async function readFile(d, name) { try { return await (await d.getFileHandle(name)).getFile(); } catch (e) { return null; } }
async function rm(d, name) { try { await d.removeEntry(name, { recursive: true }); } catch (e) {} }

export function encodeWav(L, R, sr) {
  const n = L.length, buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true);
  v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 4, true);
  const pcm = new Int16Array(buf, 44, n * 2);
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, L[i])), r = Math.max(-1, Math.min(1, R[i]));
    pcm[2 * i] = l < 0 ? l * 32768 : l * 32767; pcm[2 * i + 1] = r < 0 ? r * 32768 : r * 32767;
  }
  return new Blob([buf], { type: 'audio/wav' });
}
export function decodeWav(ab) {   // our own 16-bit PCM WAVs (finds the fmt / data chunks, mono or stereo)
  const v = new DataView(ab); let o = 12, ch = 2, sr = 48000, data = null;
  while (o + 8 <= v.byteLength) {
    const id = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3)), sz = v.getUint32(o + 4, true);
    if (id === 'fmt ') { ch = v.getUint16(o + 10, true); sr = v.getUint32(o + 12, true); }
    if (id === 'data') { data = [o + 8, Math.min(sz, v.byteLength - o - 8)]; break; }
    o += 8 + sz + (sz & 1);
  }
  if (!data) throw new Error('no data in WAV');
  const n = Math.floor(data[1] / (2 * ch)), pcm = new Int16Array(ab, data[0], n * ch), L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = pcm[i * ch] / 32768; R[i] = pcm[i * ch + (ch > 1 ? 1 : 0)] / 32768; }
  return { sr, L, R };
}
function resample(x, from, to) {
  if (from === to) return x;
  const n = Math.floor(x.length * to / from), y = new Float32Array(n), k = from / to;
  for (let i = 0; i < n; i++) { const p = i * k, j = Math.floor(p), f = p - j; y[i] = (x[j] || 0) * (1 - f) + (x[j + 1] ?? x[j] ?? 0) * f; }
  return y;
}
// loop = { len, sr, a, b, mask: [bool, bool], bufs: [[L, R] | null, [L, R] | null], src, bpm, t, name }
async function saveLoop(d, n, L) {
  const tag = ['A', 'B'];
  for (let k = 0; k < 2; k++) { await rm(d, `slot${n}_${tag[k]}.wav`); if (L && L.bufs[k]) await writeFile(d, `slot${n}_${tag[k]}.wav`, encodeWav(L.bufs[k][0], L.bufs[k][1], L.sr)); }
  if (!L) { await rm(d, `slot${n}.json`); return; }
  const meta = { v: 1, sr: L.sr, len: L.len, a: L.a, b: L.b, mask: L.mask, src: L.src, bpm: L.bpm || 0, t: L.t || Date.now(), name: L.name || '' };
  await writeFile(d, `slot${n}.json`, JSON.stringify(meta));
}
async function readLoop(d, n, sr) {
  const jf = await readFile(d, `slot${n}.json`); if (!jf) return null;
  try {
    const m = JSON.parse(await jf.text()), bufs = [null, null], tag = ['A', 'B'];
    for (let k = 0; k < 2; k++) {
      const f = m.mask && m.mask[k] ? await readFile(d, `slot${n}_${tag[k]}.wav`) : null; if (!f) continue;
      const w = decodeWav(await f.arrayBuffer());
      bufs[k] = [resample(w.L, w.sr, sr || w.sr), resample(w.R, w.sr, sr || w.sr)];
    }
    if (!bufs[0] && !bufs[1]) return null;
    const f = (sr || m.sr) / m.sr, len = (bufs[0] || bufs[1])[0].length;
    return { ...m, sr: sr || m.sr, len, a: Math.round(m.a * f), b: Math.min(len, Math.round(m.b * f)), mask: [!!bufs[0], !!bufs[1]], bufs };
  } catch (e) { console.warn('loop slot', n, e); return null; }
}
export async function saveSlot(n, L) { await saveLoop(await dir(['slots']), n, L); }
export async function saveSlotMeta(n, L) {   // in / out changed: rewrite the small JSON only
  if (!L) return; const d = await dir(['slots']);
  await writeFile(d, `slot${n}.json`, JSON.stringify({ v: 1, sr: L.sr, len: L.len, a: L.a, b: L.b, mask: L.mask, src: L.src, bpm: L.bpm || 0, t: L.t || Date.now(), name: L.name || '' }));
}
export async function readSlots(sr) { const d = await dir(['slots']), out = []; for (let n = 1; n <= SLOTS; n++) out.push(await readLoop(d, n, sr)); return out; }
export const safeBank = s => (s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
export async function saveBank(name, slots) {
  name = safeBank(name); if (!name) throw new Error('no name');
  const b = await dir(['banks']); await rm(b, name); const d = await b.getDirectoryHandle(name, { create: true });
  for (let n = 1; n <= SLOTS; n++) await saveLoop(d, n, slots[n - 1]);
  await writeFile(d, 'bank.json', JSON.stringify({ v: 1, name, t: Date.now(), used: slots.filter(Boolean).length }));
  return name;
}
export async function loadBank(name, sr) { const d = await (await dir(['banks'])).getDirectoryHandle(name); const out = []; for (let n = 1; n <= SLOTS; n++) out.push(await readLoop(d, n, sr)); return out; }
export async function deleteBank(name) { await rm(await dir(['banks']), name); }
export async function listBanks() {
  const b = await dir(['banks']), out = [];
  for await (const [name, h] of b.entries()) {
    if (h.kind !== 'directory') continue;
    let m = { name, t: 0, used: 0 }; const f = await readFile(h, 'bank.json'); if (f) try { m = { ...m, ...JSON.parse(await f.text()), name }; } catch (e) {}
    out.push(m);
  }
  return out.sort((x, y) => y.t - x.t);
}
// min / max of (L + R) / 2 over all the loop's channels, in `bins` columns between samples s0 and s1
export function peaks(L, bins, s0 = 0, s1 = L.len) {
  const out = new Float32Array(bins * 2), span = Math.max(1, s1 - s0);
  for (let i = 0; i < bins; i++) {
    const a = s0 + Math.floor(i * span / bins), b = Math.max(a + 1, s0 + Math.floor((i + 1) * span / bins));
    let lo = 0, hi = 0; const step = Math.max(1, Math.floor((b - a) / 256));
    for (const c of L.bufs) { if (!c) continue; for (let j = Math.max(0, a); j < Math.min(L.len, b); j += step) { const v = (c[0][j] + c[1][j]) * 0.5; if (v < lo) lo = v; if (v > hi) hi = v; } }
    out[2 * i] = lo; out[2 * i + 1] = hi;
  }
  return out;
}
