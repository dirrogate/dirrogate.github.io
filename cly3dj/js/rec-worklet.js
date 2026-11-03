// #598 REC MASTER: takes the master after the limiter (music + mic, never the cue) and hands it to the page as 16-bit
// stereo PCM, one second per message. No compression, so almost no CPU: a float -> int16 copy per sample.
class VireRec extends AudioWorkletProcessor {
  constructor() {
    super(); this.n = Math.round(sampleRate); this.buf = new Int16Array(this.n * 2); this.k = 0; this.stop = false;
    this.port.onmessage = e => { if (e.data === 'flush') { this.send(); this.port.postMessage({ done: true }); this.stop = true; } };
  }
  send() { if (!this.k) return; const out = this.buf.slice(0, this.k * 2); this.port.postMessage(out.buffer, [out.buffer]); this.k = 0; }
  process(inputs) {
    if (this.stop) return false;
    const inp = inputs[0], L = inp && inp[0], R = inp && (inp[1] || inp[0]);
    const len = L ? L.length : 128, b = this.buf;
    for (let i = 0; i < len; i++) {
      const l = L ? Math.max(-1, Math.min(1, L[i])) : 0, r = R ? Math.max(-1, Math.min(1, R[i])) : 0;
      b[this.k * 2] = l < 0 ? l * 0x8000 : l * 0x7fff; b[this.k * 2 + 1] = r < 0 ? r * 0x8000 : r * 0x7fff;
      if (++this.k === this.n) this.send();
    }
    return true;
  }
}
registerProcessor('vire-rec', VireRec);
