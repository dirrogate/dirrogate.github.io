// #346 BEAT for the visuals (owner: the wall's fractal / video pulse on the music). A light onset detector on the
// master, tapped after the limiter (so it follows what the room and the stream hear, MIC included; CUE never). Bass
// energy 40-160 Hz from an analyser against its own running average: a beat when it jumps 50 % over it (and isn't
// near silence), at most every 0.28 s (~214 BPM). pulse = 1 on a beat, falling off with a 0.12 s time constant.
// Costs one 1024-point FFT read per frame, and only while something asks for it (want).
export class Beat {
  constructor(engine) { this.engine = engine; this.pulse = 0; this.want = false; this.an = null; this.avg = 0; this.last = 0; this.count = 0; }
  _attach() {
    if (this.an) return true;
    const e = this.engine; if (!e || !e.ctx || !e.limiter) return false;   // audio starts with the first user gesture
    const an = e.ctx.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0;
    e.limiter.connect(an); this.an = an; this.buf = new Float32Array(an.frequencyBinCount); this.hz = e.ctx.sampleRate / an.fftSize;
    this.b0 = Math.max(1, Math.floor(40 / this.hz)); this.b1 = Math.max(this.b0 + 1, Math.ceil(160 / this.hz));
    return true;
  }
  tick(dt) {
    this.pulse *= Math.exp(-dt / 0.12);
    if (!this.want || !this._attach()) return this.pulse;
    this.an.getFloatFrequencyData(this.buf);
    let e = 0; for (let i = this.b0; i <= this.b1; i++) e += Math.pow(10, this.buf[i] / 10);   // dB -> power
    e /= this.b1 - this.b0 + 1;
    const now = performance.now();
    if (e > 1e-6 && e > this.avg * 1.5 && now - this.last > 280) { this.pulse = 1; this.last = now; this.count++; }
    this.avg += (e - this.avg) * Math.min(1, dt / 0.6);   // ~0.6 s running average
    return this.pulse;
  }
}
