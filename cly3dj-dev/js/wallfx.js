// #439 LED wall visuals, one engine for every screen (CLAUDE.md #439): the Quest's LED wall (so the SHOWTIME! shot,
// Twitch and CLY3DTV, which draw that wall) and the Dirrogram phones' wall draw the same picture from the same few
// numbers: the show clock (ms since the visual started, on the Quest's clock) and the beat position (beats, Quest
// count + phase). Nothing but those numbers travels; each device draws its own copy.
//  MANDEL      infinite zoom into a Mandelbrot spiral (on the edge all the way down, so no flat black and no slow frames), 64 s down to 2.5e-12 and round again
//              (double precision is enough that deep), colours cycling on the beat
//  RETRO-SCENE the op-art dancer: two sets of moving rings (moire) behind a dancing figure filled with tighter rings,
//              her moves changing every 8 beats; and GRAB LOOPs (3 s of headset camera, 36 frames on a 6 x 6 sheet)
//              played back and forth with an Amiga-style 64-colour dither
// The output is a 160 x 90 canvas (the low-res LED look). The sums run in a worker (wallfx-worker.js) where there is
// one, so neither the headset nor a phone loses frames; the loop is drawn here (a sheet cell, then the dither).
export const FX_W = 160, FX_H = 90;
export const LOOP = { cols: 6, rows: 6, n: 36, fps: 12, w: 128, h: 72 };

// ------------------------------------------------------------------ MANDEL ZOOM
const MP = 64000, MCX = -0.77568377, MCY = 0.13646737, MS0 = 3.2, MS1 = 2.5e-12;
const PAL = (() => {   // contemporary cyberpunk: ink, violet, hot pink, pale pink, cyan, deep blue, back to ink
  const S = [[0, [6, 0, 18]], [0.16, [62, 0, 132]], [0.33, [255, 30, 140]], [0.47, [255, 190, 232]], [0.6, [57, 230, 255]], [0.8, [16, 52, 190]], [1, [6, 0, 18]]];
  const L = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    const t = i / 256; let k = 0; while (S[k + 1][0] < t) k++;
    const [t0, a] = S[k], [t1, b] = S[k + 1], f = (t - t0) / (t1 - t0);
    for (let c = 0; c < 3; c++) L[i * 3 + c] = a[c] + (b[c] - a[c]) * f;
  }
  return L;
})();
function mandelInto(px, W, H, scale, shift, gain, a) {
  const it = Math.min(1600, 90 + 60 * Math.log2(MS0 / scale)) | 0, step = scale / W;
  for (let j = 0; j < H; j++) {
    const ci = MCY + (H / 2 - j - 0.5) * step;
    for (let i = 0; i < W; i++) {
      const cr = MCX + (i + 0.5 - W / 2) * step;
      let zr = 0, zi = 0, r2 = 0, i2 = 0, n = 0, pr = 0, pi = 0, chk = 8;
      while (n < it && r2 + i2 < 256) {
        zi = 2 * zr * zi + ci; zr = r2 - i2 + cr; r2 = zr * zr; i2 = zi * zi; n++;
        if (zr === pr && zi === pi) { n = it; break; }   // caught in a cycle: inside the set
        if (n === chk) { pr = zr; pi = zi; chk += chk; }
      }
      let R = 0, G = 0, B = 0;
      if (n < it) {
        const mu = n + 1 - Math.log2(Math.log(r2 + i2) * 0.5), x = mu * 0.04 + shift, k = ((x - Math.floor(x)) * 256 | 0) * 3;
        R = PAL[k] * gain; G = PAL[k + 1] * gain; B = PAL[k + 2] * gain;
      }
      const o = (j * W + i) * 4;
      if (a >= 1) { px[o] = R; px[o + 1] = G; px[o + 2] = B; }
      else { px[o] += (R - px[o]) * a; px[o + 1] += (G - px[o + 1]) * a; px[o + 2] += (B - px[o + 2]) * a; }
      px[o + 3] = 255;
    }
  }
}
export function renderMandel(px, W, H, t, bp, kick) {
  const tm = ((t % MP) + MP) % MP, u = tm / MP, shift = bp / 16, gain = 0.9 + 0.3 * kick;
  mandelInto(px, W, H, MS0 * Math.pow(MS1 / MS0, u), shift, gain, 1);
  const tail = (MP - tm) / 1000;
  if (tail < 3) mandelInto(px, W, H, MS0, shift, gain, 1 - tail / 3);   // the last 3 s melt into the start again
}

// ------------------------------------------------------------------ RETRO-SCENE: the op-art dancer
// her pose from the beat position: 4 moves, 8 beats each, the hips drop on every beat
function dancerPose(bp) {
  const s = Math.sin(Math.PI * bp), c2 = Math.cos(2 * Math.PI * bp), bounce = Math.abs(s), move = Math.floor(bp / 8) % 4;
  const hip = [0.09 * s, -0.1 - 0.07 * (1 - bounce)], chest = [hip[0] + 0.05 * Math.sin(Math.PI * bp + 0.6), hip[1] + 0.4];
  const head = [chest[0] + 0.03 * Math.sin(Math.PI * bp + 1.2), chest[1] + 0.23];
  let aL, aR, bL, bR;   // upper-arm angle from hanging straight down (outward), elbow bend (further round)
  if (move === 0) { aL = 1.6 + 1.1 * s; aR = 1.6 - 1.1 * s; bL = bR = 0.5; }             // pump, one arm then the other
  else if (move === 1) { aL = aR = 2.75 + 0.2 * c2; bL = bR = 0.2 + 0.7 * (0.5 + 0.5 * c2); }   // raise the roof
  else if (move === 2) { aL = 1.55 + 0.3 * Math.sin(2 * Math.PI * bp); aR = 1.55 - 0.3 * Math.sin(2 * Math.PI * bp); bL = 0.9 * Math.sin(2 * Math.PI * bp); bR = -bL; }   // wave
  else { aL = 0.55 + 0.9 * s; aR = 0.55 - 0.9 * s; bL = bR = 1.3; }                   // swing
  const sL = [chest[0] - 0.14, chest[1] + 0.03], sR = [chest[0] + 0.14, chest[1] + 0.03];
  const eL = [sL[0] - 0.2 * Math.sin(aL), sL[1] - 0.2 * Math.cos(aL)], eR = [sR[0] + 0.2 * Math.sin(aR), sR[1] - 0.2 * Math.cos(aR)];
  const hL = [eL[0] - 0.19 * Math.sin(aL + bL), eL[1] - 0.19 * Math.cos(aL + bL)], hR = [eR[0] + 0.19 * Math.sin(aR + bR), eR[1] - 0.19 * Math.cos(aR + bR)];
  const step = 0.07 * Math.sin(Math.PI * bp * 0.5), kn = 0.05 + 0.09 * (1 - bounce);
  const pL = [hip[0] - 0.08, hip[1]], pR = [hip[0] + 0.08, hip[1]], fL = [-0.17 + step, -0.92], fR = [0.17 + step, -0.92];
  const kL = [(pL[0] + fL[0]) / 2 - kn, (pL[1] + fL[1]) / 2], kR = [(pR[0] + fR[0]) / 2 + kn, (pR[1] + fR[1]) / 2];
  // capsules: [ax, ay, bx, by, radius]
  return [[chest[0], chest[1], hip[0], hip[1] + 0.02, 0.115], [chest[0], chest[1], head[0], head[1], 0.05], [head[0], head[1], head[0], head[1] + 0.02, 0.105],
    [sL[0], sL[1], sR[0], sR[1], 0.06],
    [sL[0], sL[1], eL[0], eL[1], 0.045], [eL[0], eL[1], hL[0], hL[1], 0.038], [hL[0], hL[1], hL[0], hL[1], 0.048],
    [sR[0], sR[1], eR[0], eR[1], 0.045], [eR[0], eR[1], hR[0], hR[1], 0.038], [hR[0], hR[1], hR[0], hR[1], 0.048],
    [pL[0], pL[1], kL[0], kL[1], 0.066], [kL[0], kL[1], fL[0], fL[1], 0.052], [fL[0], fL[1], fL[0] - 0.09, fL[1] - 0.01, 0.036],
    [pR[0], pR[1], kR[0], kR[1], 0.066], [kR[0], kR[1], fR[0], fR[1], 0.052], [fR[0], fR[1], fR[0] + 0.09, fR[1] - 0.01, 0.036]];
}
function capDist(x, y, C) {
  let d = 9;
  for (let k = 0; k < C.length; k++) {
    const c = C[k], bx = c[2] - c[0], by = c[3] - c[1], ax = x - c[0], ay = y - c[1], L = bx * bx + by * by;
    const h = L > 0 ? Math.max(0, Math.min(1, (ax * bx + ay * by) / L)) : 0, dx = ax - bx * h, dy = ay - by * h, e = Math.sqrt(dx * dx + dy * dy) - c[4];
    if (e < d) d = e;
  }
  return d;
}
export function renderDancer(px, W, H, t, bp, kick) {
  const C = dancerPose(bp), bar = Math.floor(bp / 4), alt = bar % 2 === 0;
  const ts = t * 0.001, ax = 0.95 * Math.sin(ts * 0.31), ay = 0.5 * Math.sin(ts * 0.47), bx = -0.95 * Math.sin(ts * 0.23 + 1), by = 0.5 * Math.cos(ts * 0.37);
  const fA = 15, fB = 15 + 2 * Math.sin(ts * 0.2), ch = C[0], cx = ch[0], cy = ch[1] - 0.05;
  const IN = alt ? [57, 230, 255] : [255, 42, 140], LINE = alt ? [255, 42, 140] : [57, 230, 255], g = 1 + 0.35 * kick;
  let x0 = 9, x1 = -9, y0 = 9, y1 = -9;   // the figure's box: no distance sums outside it
  for (const c of C) { x0 = Math.min(x0, c[0] - c[4], c[2] - c[4]); x1 = Math.max(x1, c[0] + c[4], c[2] + c[4]); y0 = Math.min(y0, c[1] - c[4], c[3] - c[4]); y1 = Math.max(y1, c[1] + c[4], c[3] + c[4]); }
  const hh = H / 2;
  for (let j = 0; j < H; j++) {
    const y = (hh - j - 0.5) / hh;
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5 - W / 2) / hh, o = (j * W + i) * 4;
      const d = x >= x0 - 0.03 && x <= x1 + 0.03 && y >= y0 - 0.03 && y <= y1 + 0.03 ? capDist(x, y, C) : 1;
      let R, G, B;
      if (d < -0.022) {   // inside her: tight rings from the chest, pulsing out on the beat
        const r = Math.hypot(x - cx, y - cy) * 30 - bp * 2;
        if ((Math.floor(r) & 1) === 0) { R = IN[0] * g; G = IN[1] * g; B = IN[2] * g; } else { R = 8; G = 0; B = 24; }
      } else if (d < 0.006) { R = LINE[0]; G = LINE[1]; B = LINE[2]; }   // her outline
      else {   // two ring sets drifting over each other (moire)
        const a = Math.floor(Math.hypot(x - ax, y - ay) * fA - bp * 0.5), b = Math.floor(Math.hypot(x - bx, y - by) * fB);
        if (((a ^ b) & 1) === 0) { R = 236; G = 232; B = 246; } else { R = 4; G = 2; B = 10; }
      }
      px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = 255;
    }
  }
}

// ------------------------------------------------------------------ the engine
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export class WallFx {
  constructor() {
    this.canvas = Object.assign(document.createElement('canvas'), { width: FX_W, height: FX_H });
    this.g = this.canvas.getContext('2d', { willReadFrequently: true });
    this.img = this.g.createImageData(FX_W, FX_H);
    this.busy = false; this.reqT = 0; this.ms = 0; this.fresh = false; this.loopT = 0; this.loopI = -1; this.pool = [];
    this.w = null;
    try {
      this.w = new Worker(new URL('./wallfx-worker.js', import.meta.url), { type: 'module' });
      this.w.onmessage = e => this._done(e.data.buf);
      this.w.onerror = e => { console.warn('wall visuals worker', e.message || e); this.w = null; this.busy = false; };
    } catch (e) { this.w = null; }
  }
  _done(buf) {
    this.busy = false; this.ms = performance.now() - this.reqT;
    this.img.data.set(new Uint8ClampedArray(buf)); this.pool.push(buf);
    if (this.mode !== 'loop') { this.g.putImageData(this.img, 0, 0); this.fresh = true; }
  }
  // o: { mode: 'mandel' | 'dancer' | 'loop', t (ms), bp (beats), kick (0..1), loop (sheet image / canvas), lt (ms into the loop) }
  // returns true when the canvas has a new picture (about 15 a second; loops 12)
  frame(o) {
    const now = performance.now(); this.mode = o.mode;
    let fresh = this.fresh; this.fresh = false;
    if (o.mode === 'loop') {
      if (!o.loop) return fresh;
      const k = Math.floor(Math.max(0, o.lt) * LOOP.fps / 1000) % (2 * LOOP.n - 2), i = k < LOOP.n ? k : 2 * LOOP.n - 2 - k;   // forwards, then back
      if (i !== this.loopI || now - this.loopT > 500) { this.loopI = i; this.loopT = now; this._loop(o.loop, i, o.kick || 0); fresh = true; }
      return fresh;
    }
    this.loopI = -1;
    if (this.busy && now - this.reqT > 2000) this.busy = false;   // a lost answer
    if (!this.busy && now - this.reqT >= 66) {
      this.reqT = now;
      const mode = o.mode === 'mandel' ? 'mandel' : 'dancer', t = o.t || 0, bp = o.bp || 0, kick = o.kick || 0;
      if (this.w) {
        this.busy = true; const buf = this.pool.pop() || new ArrayBuffer(FX_W * FX_H * 4);
        this.w.postMessage({ mode, W: FX_W, H: FX_H, t, bp, kick, buf }, [buf]);
      } else {
        const px = this.img.data; if (mode === 'mandel') renderMandel(px, FX_W, FX_H, t, bp, kick); else renderDancer(px, FX_W, FX_H, t, bp, kick);
        this.g.putImageData(this.img, 0, 0); this.ms = performance.now() - now; fresh = true;
      }
    }
    return fresh;
  }
  // one cell of a GRAB LOOP sheet, then 4 levels a channel with an ordered dither and every other line darker
  _loop(sheet, i, kick) {
    const c = i % LOOP.cols, r = Math.floor(i / LOOP.cols), g = this.g;
    g.imageSmoothingEnabled = true;
    try { g.drawImage(sheet, c * LOOP.w, r * LOOP.h, LOOP.w, LOOP.h, 0, 0, FX_W, FX_H); } catch (e) { return; }
    const im = g.getImageData(0, 0, FX_W, FX_H), p = im.data, gain = 1.08 + 0.25 * kick;
    for (let y = 0; y < FX_H; y++) {
      const line = y & 1 ? 0.82 : 1;
      for (let x = 0; x < FX_W; x++) {
        const o = (y * FX_W + x) * 4, d = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 85;
        for (let k = 0; k < 3; k++) { const v = Math.max(0, Math.min(255, p[o + k] * gain + d)); p[o + k] = Math.round(v / 85) * 85 * line; }
      }
    }
    g.putImageData(im, 0, 0);
  }
}
