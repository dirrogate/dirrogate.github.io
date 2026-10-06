// SpatialED #41 MP3 encoding off the main thread (vendor/lamejs, LGPL-3.0). In: { id, pcm: Int16Array (mono, or
// interleaved stereo), ch, rate, kbps }. Out: { id, mp3: Uint8Array } or { id, error }.
importScripts('../vendor/lamejs/lame.min.js');
onmessage = e => {
  const { id, pcm, ch, rate, kbps } = e.data;
  try {
    const enc = new lamejs.Mp3Encoder(ch, rate, kbps), parts = [], B = 1152;
    if (ch === 1) for (let i = 0; i < pcm.length; i += B) { const o = enc.encodeBuffer(pcm.subarray(i, i + B)); if (o.length) parts.push(o); }
    else {
      const n = pcm.length / 2, L = new Int16Array(n), R = new Int16Array(n);
      for (let i = 0; i < n; i++) { L[i] = pcm[2 * i]; R[i] = pcm[2 * i + 1]; }
      for (let i = 0; i < n; i += B) { const o = enc.encodeBuffer(L.subarray(i, i + B), R.subarray(i, i + B)); if (o.length) parts.push(o); }
    }
    const f = enc.flush(); if (f.length) parts.push(f);
    let len = 0; for (const p of parts) len += p.length;
    const mp3 = new Uint8Array(len); let o = 0; for (const p of parts) { mp3.set(p, o); o += p.length; }
    postMessage({ id, mp3 }, [mp3.buffer]);
  } catch (err) { postMessage({ id, error: String(err && err.message || err) }); }
};
