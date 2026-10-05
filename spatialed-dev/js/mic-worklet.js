// Voice pitch shifter for the mixer's MIC channel (CLAUDE.md #60).
// Two read heads sweep a 50 ms delay line at the shifted speed, half a window apart, with sin^2
// crossfades that always sum to 1. ratio 1 = straight through (no added delay).
class VirePitch extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }]; }
  constructor() {
    super();
    this.N = 8192; this.buf = new Float32Array(this.N); this.w = 0;
    this.W = Math.round(sampleRate * 0.05); this.ph = 0;
  }
  tap(d) {
    const N = this.N; let p = this.w - 1 - d; while (p < 0) p += N;
    const i = Math.floor(p), f = p - i; return this.buf[i % N] * (1 - f) + this.buf[(i + 1) % N] * f;
  }
  process(inputs, outputs, params) {
    const x = inputs[0] && inputs[0][0], y = outputs[0][0]; if (!y) return true;
    const r = params.ratio[0], W = this.W, N = this.N, pass = Math.abs(r - 1) < 1e-3;
    for (let i = 0; i < y.length; i++) {
      const s = x ? x[i] : 0; this.buf[this.w] = s; this.w = (this.w + 1) % N;
      if (pass) { y[i] = s; continue; }
      this.ph += (1 - r) / W; this.ph -= Math.floor(this.ph);
      const p2 = (this.ph + 0.5) % 1, a = Math.sin(Math.PI * this.ph), b = Math.sin(Math.PI * p2);
      y[i] = this.tap(1 + this.ph * W) * a * a + this.tap(1 + p2 * W) * b * b;
    }
    return true;
  }
}
registerProcessor('vire-pitch', VirePitch);
