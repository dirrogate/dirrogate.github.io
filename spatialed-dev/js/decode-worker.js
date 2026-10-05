// Off-main-thread part of loading a track (CLAUDE.md #63): Float32 PCM -> Int16 for the deck worklet, plus the
// 8192-bin loudness envelope that draws the grooves (same maths as before, see #57). Doing this on the main
// thread froze the headset for a few hundred ms per record.
self.onmessage = (e) => {
  const { id, L, R, rate } = e.data;
  const n = L.length, R2 = R || L;
  const bins = 8192, env = new Float32Array(bins), per = Math.max(1, Math.floor(n / bins));
  for (let b = 0; b < bins; b++) {
    let s = 0, pk = 0; const st = b * per, en = Math.min(n, st + per);
    for (let j = st; j < en; j += 2) { const v = (L[j] + R2[j]) * 0.5; s += v * v; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
    env[b] = 0.65 * Math.sqrt(s / Math.max(1, (en - st) / 2)) * 1.6 + 0.35 * pk;
  }
  let mx = 0; for (let b = 0; b < bins; b++) if (env[b] > mx) mx = env[b];
  if (mx > 0) for (let b = 0; b < bins; b++) env[b] /= mx;
  const conv = (F) => { const o = new Int16Array(F.length); for (let j = 0; j < F.length; j++) { const a = F[j] * 32767; o[j] = a > 32767 ? 32767 : a < -32768 ? -32768 : a; } return o; };
  const iL = conv(L), iR = R ? conv(R) : null;
  self.postMessage({ id, iL, iR, env }, iR ? [iL.buffer, iR.buffer, env.buffer] : [iL.buffer, env.buffer]);
};
