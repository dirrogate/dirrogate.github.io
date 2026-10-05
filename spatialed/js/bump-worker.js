// #149: label relief (textures.js labelBumpMap, #94 / #99 / #100) built off the main thread. Same maths as the
// main-thread version, but the two blurs are done in plain JS (3 box passes = near-Gaussian) instead of canvas
// filters, so it runs in any worker. In: { id, bmp (ImageBitmap of the label-only canvas), seed, N, labelFrac,
// ringFrac, holeFrac }. Out: { id, data (Uint8Array N*N*4, rows bottom-up for a DataTexture) }.
function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function boxBlur(src, N, r) {   // one separable box pass of radius r on a Float32 luminance image
  if (r < 1) return src.slice();
  const tmp = new Float32Array(N * N), out = new Float32Array(N * N), w = 2 * r + 1;
  for (let y = 0; y < N; y++) { let acc = 0; const o = y * N;
    for (let x = -r; x <= r; x++) acc += src[o + Math.min(N - 1, Math.max(0, x))];
    for (let x = 0; x < N; x++) { tmp[o + x] = acc / w; acc += src[o + Math.min(N - 1, x + r + 1)] - src[o + Math.max(0, x - r)]; } }
  for (let x = 0; x < N; x++) { let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(N - 1, Math.max(0, y)) * N + x];
    for (let y = 0; y < N; y++) { out[y * N + x] = acc / w; acc += tmp[Math.min(N - 1, y + r + 1) * N + x] - tmp[Math.max(0, y - r) * N + x]; } }
  return out;
}
function gauss(src, N, sigma) {   // 3 box passes (Wells): radius for a Gaussian of this sigma
  const r = Math.max(0, Math.round(Math.sqrt(sigma * sigma + 1) - 1 + 0.35));
  return boxBlur(boxBlur(boxBlur(src, N, r), N, r), N, r);
}
self.onmessage = e => {
  const { id, bmp, seed, N, labelFrac, ringFrac, holeFrac } = e.data;
  const c = new OffscreenCanvas(N, N), g = c.getContext('2d');
  g.drawImage(bmp, 0, 0, N, N); bmp.close();
  const px = g.getImageData(0, 0, N, N).data, A = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) A[i] = 0.3 * px[i * 4] + 0.59 * px[i * 4 + 1] + 0.11 * px[i * 4 + 2];
  const B = gauss(A, N, 1.5), W = gauss(A, N, 7);
  const lr = labelFrac * N / 2, ring = ringFrac * N / 2, hole = holeFrac * N / 2;
  let sd = (hash(seed) % 2147483646) + 1; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const H = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, r = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2);
    let h = 128;
    if (r < lr) {
      h += Math.max(-30, Math.min(30, 2.2 * (B[i] - A[i])));
      h += Math.max(-28, Math.min(28, 0.9 * (W[i] - A[i])));
      h += Math.max(-14, Math.min(14, 0.12 * (140 - A[i])));
      h += (rnd() - 0.5) * 7;
      h += 34 * Math.exp(-(((r - ring) / 1.3) ** 2));
      h += 30 * Math.exp(-(((r - hole - 2.2) / 1.2) ** 2));
      h -= 22 * Math.exp(-(((r - lr + 1) / 1.1) ** 2));
    }
    H[i] = Math.max(0, Math.min(255, h)) / 255;
  }
  const K = 4, SK = 0.3, soft = v => v / (1 + Math.abs(v) / SK), out = new Uint8Array(N * N * 4);
  const at = (xx, yy) => H[Math.min(N - 1, Math.max(0, yy)) * N + Math.min(N - 1, Math.max(0, xx))];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const du = soft(K * 0.5 * (at(x + 1, y) - at(x - 1, y))), dv = soft(K * 0.5 * (at(x, y - 1) - at(x, y + 1)));
    const l = Math.hypot(du, dv, 1), o = ((N - 1 - y) * N + x) * 4;   // bottom-up rows (DataTexture, no flip)
    out[o] = Math.round((-du / l * 0.5 + 0.5) * 255); out[o + 1] = Math.round((-dv / l * 0.5 + 0.5) * 255);
    out[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); out[o + 3] = 255;
  }
  self.postMessage({ id, data: out }, [out.buffer]);
};
