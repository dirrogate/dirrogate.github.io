// SpatialED #41 TAKE recorder: raw samples straight from the Web Audio graph (no MediaRecorder, so WAV / MP3, and
// sample-exact timing). Input 0 = the voice (the mixer's MIC after pitch / effects), input 1 = the mix as heard (the
// master after the limiter, stereo). Posts Int16 chunks (~0.25 s) and, on the first recorded block, t0 = its
// AudioContext time, so the head / hand frames can be stamped on the same clock.
class SedRec extends AudioWorkletProcessor {
  constructor() {
    super(); this.on = false; this.v = []; this.m = []; this.n = 0; this.first = false;
    this.port.onmessage = e => {
      if (e.data === 'start') { this.on = true; this.first = true; this.v = []; this.m = []; this.n = 0; }
      else if (e.data === 'stop') { this.flush(); this.on = false; this.port.postMessage({ done: true }); }
    };
  }
  process(inputs) {
    if (!this.on) return true;
    const vi = inputs[0] || [], mi = inputs[1] || [], vc = vi[0], ml = mi[0], mr = mi[1] || mi[0];
    const N = (vc || ml || { length: 128 }).length, v = new Int16Array(N), m = new Int16Array(N * 2);
    const q = x => (x > 1 ? 32767 : x < -1 ? -32768 : (x * 32767) | 0);
    for (let i = 0; i < N; i++) { v[i] = vc ? q(vc[i]) : 0; m[2 * i] = ml ? q(ml[i]) : 0; m[2 * i + 1] = mr ? q(mr[i]) : 0; }
    if (this.first) { this.first = false; this.port.postMessage({ t0: currentTime }); }
    this.v.push(v); this.m.push(m); this.n += N;
    if (this.n >= 12000) this.flush();
    return true;
  }
  flush() {
    if (!this.n) return;
    const cat = (a, k) => { const o = new Int16Array(this.n * k); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
    const v = cat(this.v, 1), m = cat(this.m, 2);
    this.port.postMessage({ v, m }, [v.buffer, m.buffer]); this.v = []; this.m = []; this.n = 0;
  }
}
registerProcessor('sed-rec', SedRec);
