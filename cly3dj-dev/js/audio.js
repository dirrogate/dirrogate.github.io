// Audio engine: worklet decks -> 2-channel mixer -> master / split cue.
// Channel strip: trim > HI/MID/LOW > filter (LP left, HP right) > [meter, cue] > fader > crossfader > master.
// LOOPER: samples a channel after its trim (before EQ / filter / cue) and loops it back in ahead of that channel's EQ.

export const PITCH_RANGE = 0.16;
export const MIC_MAX = 10;   // #334 +20 dB

const dbToGain = db => Math.pow(10, db / 20);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.state = { time: 0, decks: [{ pos: 0, rate: 0, needle: false, prate: 0, pang: 0, rang: 0 }, { pos: 0, rate: 0, needle: false, prate: 0, pang: 0, rang: 0 }] };
    this.stateAt = 0;
    this.listeners = new Set();
    this.xf = 0; this.xfGains = [1, 1];
    this.ch = [];
  }

  async init(opts = {}) {
    if (this.ctx) return;
    const ctx = this.ctx = new AudioContext({ latencyHint: opts.latencyHint || 'interactive' });
    await ctx.audioWorklet.addModule(new URL('./deck-worklet.js', import.meta.url));
    this.node = new AudioWorkletNode(ctx, 'vire-decks', { numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [2, 2] });
    this.node.port.onmessage = e => {
      const m = e.data;
      if (m.type === 'state') { this.state = m; this.stateAt = performance.now(); }
      for (const f of this.listeners) f(m);
    };

    // #111: 2.5 dB of headroom on the music bus, so two full tracks at the default faders/master sum to about
    // -2.5 dBFS instead of driving the limiter; the lookahead limiter (deck-worklet.js) only catches pushed levels.
    this.masterBus = ctx.createGain(); this.masterBus.gain.value = 0.75;
    this.cueBus = ctx.createGain(); this.cueBus.gain.value = 0.75;
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    const lim = () => new AudioWorkletNode(ctx, 'vire-limiter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    this.limiter = lim(); this.cueLimiter = lim();
    this.limiter.port.onmessage = e => { this.gainReduction = e.data.gr; };
    this.gainReduction = 0;
    // talkover ducking (CLAUDE.md #62): music passes through duck before the master; the mic joins after it
    this.duck = ctx.createGain();
    this.masterBus.connect(this.duck).connect(this.master).connect(this.limiter);

    // Normal output (#334): the headphones get master + cue through the 🎧 MIX knob, with their own limiter.
    // This is the DJ's private mix only; the stream tap (streamTrack) stays on the master limiter.
    this.normalOut = ctx.createGain();
    this.hpMaster = ctx.createGain(); this.hpCue = ctx.createGain(); this.hpBus = ctx.createGain(); this.hpLimiter = lim();
    this.limiter.connect(this.hpMaster).connect(this.hpBus);
    this.cueBus.connect(this.hpCue).connect(this.hpBus);   // before the cue limiter: the phones limiter takes the sum
    this.hpBus.connect(this.hpLimiter).connect(this.normalOut).connect(ctx.destination);
    this.setHpMix(0.5);
    // Split cue: master (mono) left ear, cue (mono) right ear.
    const mono = () => { const g = ctx.createGain(); g.channelCount = 1; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'; return g; };
    this.masterMono = mono(); this.cueMono = mono();
    this.merger = ctx.createChannelMerger(2);
    this.limiter.connect(this.masterMono).connect(this.merger, 0, 0);
    this.cueBus.connect(this.cueLimiter).connect(this.cueMono).connect(this.merger, 0, 1);   // #111: cue limited too
    this.splitOut = ctx.createGain(); this.splitOut.gain.value = 0;
    this.merger.connect(this.splitOut).connect(ctx.destination);

    for (let i = 0; i < 2; i++) {
      const c = {};
      c.trim = ctx.createGain();
      c.low = ctx.createBiquadFilter(); c.low.type = 'lowshelf'; c.low.frequency.value = 220;
      c.mid = ctx.createBiquadFilter(); c.mid.type = 'peaking'; c.mid.frequency.value = 1000; c.mid.Q.value = 0.6;
      c.hi = ctx.createBiquadFilter(); c.hi.type = 'highshelf'; c.hi.frequency.value = 3800;
      c.lp = ctx.createBiquadFilter(); c.lp.type = 'lowpass'; c.lp.frequency.value = 22000; c.lp.Q.value = 0.9;
      c.hp = ctx.createBiquadFilter(); c.hp.type = 'highpass'; c.hp.frequency.value = 10; c.hp.Q.value = 0.9;
      c.meter = ctx.createAnalyser(); c.meter.fftSize = 1024; c.meterBuf = new Float32Array(1024);
      c.cue = ctx.createGain(); c.cue.gain.value = 0;
      c.fader = ctx.createGain();
      c.xf = ctx.createGain();
      this.node.connect(c.trim, i);
      c.trim.connect(c.low).connect(c.mid).connect(c.hi).connect(c.lp).connect(c.hp);
      c.hp.connect(c.meter);
      c.hp.connect(c.cue).connect(this.cueBus);
      c.hp.connect(c.fader).connect(c.xf).connect(this.masterBus);
      c.level = 0;
      this.ch.push(c);
      this.setFader(i, 0.8);
    }
    this.setCrossfader(0);

    // LOOPER (owner): input k = channel k's trim output (so pre-EQ, pre-filter, and not the master), output k goes
    // through the LOOP VOL gain into that same channel's first EQ stage, so EQ / filter / cue / fader / crossfader
    // all treat the loop like the deck it was sampled from. The tap is before that point, so the loop never feeds itself.
    this.looper = new AudioWorkletNode(ctx, 'vire-looper', { numberOfInputs: 2, numberOfOutputs: 2, outputChannelCount: [2, 2], channelCount: 2, channelCountMode: 'explicit' });
    this.looper.port.onmessage = e => { if (this.onLooper) this.onLooper(e.data); };
    this.loopGain = [];
    for (let i = 0; i < 2; i++) {
      const lg = ctx.createGain();
      this.ch[i].trim.connect(this.looper, 0, i);
      this.looper.connect(lg, i, 0);
      lg.connect(this.ch[i].low);
      this.loopGain.push(lg);
    }
    this.setLoopVol(this._loopVol ?? 0.8);
  }

  resume() { return this.ctx && this.ctx.state !== 'running' ? this.ctx.resume() : Promise.resolve(); }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  post(m) { this.node && this.node.port.postMessage(m); }
  deck(i, key, value) { this.post({ type: 'set', deck: i, key, value }); }

  // Playhead position extrapolated from the last worklet report.
  pos(i) {
    const d = this.state.decks[i];
    const dt = (performance.now() - this.stateAt) / 1000;
    return d.pos + d.rate * Math.min(dt, 0.1);
  }

  // ---- channel strip; knob values are 0..1 with 0.5 = neutral unless noted ----
  _ramp(param, v) { const t = this.ctx.currentTime; param.cancelScheduledValues(t); param.setTargetAtTime(v, t, 0.012); }
  setTrim(i, v) { this._ramp(this.ch[i].trim.gain, dbToGain(v < 0.5 ? (v - 0.5) * 24 : (v - 0.5) * 48)); }   // #477 -12 dB .. 0 (centre) .. +24 dB, for quiet old transfers
  setEQ(i, band, v) {
    // below centre: down to a near-kill (-40 dB); above: up to +6 dB
    const db = v < 0.5 ? -40 * Math.pow(1 - v / 0.5, 1.6) : (v - 0.5) / 0.5 * 6;
    this._ramp(this.ch[i][band].gain, db);
  }
  setFilter(i, v) {
    const c = this.ch[i]; const dz = 0.04;
    if (v < 0.5 - dz) { const x = (0.5 - dz - v) / (0.5 - dz); this._ramp(c.lp.frequency, 22000 * Math.pow(90 / 22000, x)); this._ramp(c.hp.frequency, 10); }
    else if (v > 0.5 + dz) { const x = (v - 0.5 - dz) / (0.5 - dz); this._ramp(c.hp.frequency, 10 * Math.pow(9000 / 10, x)); this._ramp(c.lp.frequency, 22000); }
    else { this._ramp(c.lp.frequency, 22000); this._ramp(c.hp.frequency, 10); }
  }
  setPan(i, v) { this.deck(i, 'pan', Math.max(-1, Math.min(1, (v - 0.5) * 2))); }
  setFader(i, v) { this._ramp(this.ch[i].fader.gain, v * v); }
  setCue(i, on) { this._ramp(this.ch[i].cue.gain, on ? 1 : 0); }
  // LOOP VOL knob (0..1, default 0.8 = the loop at the level it was sampled; full = +4 dB, 0 = silent)
  setLoopVol(v) {
    this._loopVol = v; if (!this.loopGain) return;
    const g = Math.pow(v / 0.8, 2);
    for (const n of this.loopGain) this._ramp(n.gain, g);
  }
  // mask = [bool, bool]: the channels to sample (the ones with CUE on); looperPlay() ends the sample and loops it
  looperRec(mask) { if (this.looper) this.looper.port.postMessage({ type: 'rec', mask }); }
  looperPlay() { if (this.looper) this.looper.port.postMessage({ type: 'play' }); }
  looperStop() { if (this.looper) this.looper.port.postMessage({ type: 'stop' }); }
  looperClear() { if (this.looper) this.looper.port.postMessage({ type: 'clear' }); }   // #470 long press
  looperRegion(a, b) { if (this.looper) this.looper.port.postMessage({ type: 'region', a, b }); }   // #470 in / out (samples)
  looperLoad(d) {   // #470 a saved loop -> armed. d = { len, a, b, bufs: [[L, R] | null, ...] } (copied: the slot keeps its own)
    if (!this.looper) return;
    const bufs = d.bufs.map(c => c ? [c[0].slice(), c[1].slice()] : null), tr = [];
    for (const c of bufs) if (c) tr.push(c[0].buffer, c[1].buffer);
    this.looper.port.postMessage({ type: 'load', len: d.len, a: d.a, b: d.b, bufs }, tr);
  }
  setCrossfader(x) { // x -1..1, constant power
    this.xf = x; const a = (x + 1) / 2 * Math.PI / 2;
    this._ramp(this.ch[0].xf.gain, Math.cos(a) * Math.SQRT2 > 1 ? 1 : Math.cos(a) * Math.SQRT2);
    this._ramp(this.ch[1].xf.gain, Math.sin(a) * Math.SQRT2 > 1 ? 1 : Math.sin(a) * Math.SQRT2);
  }
  setMaster(v) { this._ramp(this.master.gain, v * v * 1.2); }   // with the 0.75 bus headroom (#111) the top is 0.9 overall
  // #331 LIVE STREAM: the master after the limiter (music + MIC through the mixer), tapped before the headphone
  // split, so CUE never reaches it. One stereo track, made on demand.
  streamTrack() {   // #347 limiter -> delay (LATENCY MATCH, 0 unless PHONE CAM asks) -> stream
    if (!this.streamDest) {
      this.streamDest = this.ctx.createMediaStreamDestination(); this.streamDest.channelCount = 2;
      if (!this.streamDelay) { this.streamDelay = this.ctx.createDelay(2); this.streamDelay.delayTime.value = this._sDelay || 0; }
      this.limiter.connect(this.streamDelay); this.streamDelay.connect(this.streamDest);
    }
    const t = this.streamDest.stream.getAudioTracks()[0]; try { t.contentHint = 'music'; } catch {}
    return t;
  }
  streamStop() { if (this.streamDest) { try { this.limiter.disconnect(this.streamDelay); this.streamDelay.disconnect(this.streamDest); } catch {} this.streamDest = null; } }
  setStreamDelay(sec) {   // #347 the stream sound held back to match a late picture (PHONE CAM LATENCY MATCH); glides, no click
    sec = Math.min(1.5, Math.max(0, sec || 0)); if (Math.abs(sec - (this._sDelay || 0)) < 0.02) return;   // small drifts ignored: every change bends the pitch for a moment this._sDelay = sec;
    if (this.streamDelay) this.streamDelay.delayTime.setTargetAtTime(sec, this.ctx.currentTime, 0.3);
  }
  // #334 🎧 MIX: 0 = cue only, 0.5 = both at full level, 1 = master only (headphones only; master / stream untouched)
  setHpMix(v) {
    this._hpMix = v; if (!this.hpCue) return;
    this._ramp(this.hpCue.gain, Math.min(1, 2 * (1 - v)));
    this._ramp(this.hpMaster.gain, Math.min(1, 2 * v));
  }
  setSplitCue(on) { this._ramp(this.normalOut.gain, on ? 0 : 1); this._ramp(this.splitOut.gain, on ? 1 : 0); }

  // ---- microphone (CLAUDE.md #60): mic -> 90 Hz high-pass -> gain -> voice pitch -> on/off -> master.
  // Straight to the master bus, so the crossfader and channel faders don't touch it.
  async micOpen(opts = {}) {
    if (this.mic) return this.mic;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('No microphone access here (needs HTTPS)');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
      echoCancellation: opts.echo === true, noiseSuppression: false, autoGainControl: false, channelCount: 1,
      latency: { ideal: 0 } } });   // #114: ask for the smallest input buffer; echo cancelling only when asked (speakers)
    const ctx = this.ctx;
    await ctx.audioWorklet.addModule(new URL('./mic-worklet.js', import.meta.url));
    const m = { stream };
    m.src = ctx.createMediaStreamSource(stream);
    m.hp = ctx.createBiquadFilter(); m.hp.type = 'highpass'; m.hp.frequency.value = 90; m.hp.Q.value = 0.7;
    m.gain = ctx.createGain(); m.gain.gain.value = this._micGain ?? 1;
    m.shift = new AudioWorkletNode(ctx, 'vire-pitch', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    m.on = ctx.createGain(); m.on.gain.value = 0;
    m.meter = ctx.createAnalyser(); m.meter.fftSize = 512; m.meterBuf = new Float32Array(512);
    m.src.connect(m.hp).connect(m.gain).connect(m.shift).connect(m.on).connect(this.master);
    m.on.connect(m.meter);
    m.label = (stream.getAudioTracks()[0] || {}).label || 'microphone';
    this.mic = m; this.setMicPitch(this._micPitch ?? 0.5);
    return m;
  }
  setMicOn(on) { this._micOn = on; if (this.mic) this._ramp(this.mic.on.gain, on ? 1 : 0); this._applyDuck(); }
  // MIC GAIN knob (owner, #62): left half = mic level from off to full; right half = mic stays full and the music
  // ducks under it, down to -24 dB at full right (only while MIC is on).
  // #334 (owner: needs a bigger boost): full is now +20 dB (was +6). Audio taper over the left half: off below 2 %,
  // then -40 dB rising evenly in dB to +20 dB at the centre (0 dB at a third of the way from the centre, 2/3 of the half).
  micGainOf(v) { if (v >= 0.5) return MIC_MAX; const x = v / 0.5; return x < 0.02 ? 0 : Math.pow(10, (-40 + 60 * x) / 20); }
  setMicGain(v) {
    this._micKnob = v;
    this._micGain = this.micGainOf(v);
    if (this.mic) this._ramp(this.mic.gain.gain, this._micGain);
    this._applyDuck();
  }
  micDuckDb(v = this._micKnob ?? 0.5) { return v > 0.5 ? -24 * (v - 0.5) / 0.5 : 0; }
  _applyDuck() {
    if (!this.duck) return;
    const db = this._micOn ? this.micDuckDb() : 0, t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(Math.pow(10, db / 20), t, db < 0 ? 0.06 : 0.25);   // quick down, gentle back up
  }
  micSemitones(v) { const d = v - 0.5; return Math.abs(d) < 0.03 ? 0 : Math.max(-12, Math.min(12, (d - Math.sign(d) * 0.03) / 0.47 * 12)); }
  setMicPitch(v) { this._micPitch = v; if (this.mic) this.mic.shift.parameters.get('ratio').value = Math.pow(2, this.micSemitones(v) / 12); }
  // #113: what the DJ hears of his own voice in the headphones is this late (input + output buffers)
  micRoundTripMs() {
    if (!this.mic) return 0;
    const tr = this.mic.stream.getAudioTracks()[0], st = tr && tr.getSettings ? tr.getSettings() : {};
    return Math.round(((st.latency || 0) + (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000);
  }
  micClose() { if (!this.mic) return; this.mic.stream.getTracks().forEach(t => t.stop()); this.mic.src.disconnect(); this.mic.on.disconnect(); this.mic = null; }

  level(i) {
    const c = this.ch[i]; if (!c) return 0;
    c.meter.getFloatTimeDomainData(c.meterBuf);
    let p = 0; for (const s of c.meterBuf) { const a = Math.abs(s); if (a > p) p = a; }
    c.level = Math.max(p, c.level * 0.9);
    return c.level;
  }

  // ---- loading ----
  // Decoding happens off the main thread (decodeAudioData); the Int16 conversion and the groove envelope run
  // in decode-worker.js (CLAUDE.md #63). The channel copies on the main thread are done in small slices.
  _worker() {
    if (this._dw !== undefined) return this._dw;
    try {
      this._dw = new Worker(new URL('./decode-worker.js', import.meta.url));
      this._dwJobs = new Map(); this._dwId = 0;
      this._dw.onmessage = e => { const j = this._dwJobs.get(e.data.id); if (j) { this._dwJobs.delete(e.data.id); j(e.data); } };
      this._dw.onerror = () => { this._dw = null; };
    } catch { this._dw = null; }
    return this._dw;
  }
  async decode(arrayBuffer) {
    const buf = await this.ctx.decodeAudioData(arrayBuffer);
    const stereo = buf.numberOfChannels > 1;
    // copy the channels out in ~1M-sample slices, yielding between them, so even this never stalls a frame
    const copy = async (ch) => {
      const n = buf.length, out = new Float32Array(n), CH = 1 << 20;
      for (let o = 0; o < n; o += CH) { buf.copyFromChannel(out.subarray(o, Math.min(n, o + CH)), ch, o); if (o + CH < n) await new Promise(r => setTimeout(r, 0)); }
      return out;
    };
    const L = await copy(0), R = stereo ? await copy(1) : null;
    const w = this._worker();
    let out;
    if (w) {
      const id = ++this._dwId;
      out = await new Promise(res => { this._dwJobs.set(id, res); w.postMessage({ id, L, R, rate: buf.sampleRate }, R ? [L.buffer, R.buffer] : [L.buffer]); });
    } else out = convertInline(L, R);
    return { L: out.iL, R: out.iR || out.iL, rate: buf.sampleRate, duration: buf.duration, env: out.env };
  }

  load(i, decoded, track, startTime = 0) {
    // Transferred, not copied: the decoded PCM now belongs to the worklet. Flipping back later
    // re-decodes from the cached MP3 bytes (cheap) instead of holding two PCM copies.
    const { L, R } = decoded; decoded.L = decoded.R = null;
    this.node.port.postMessage({
      type: 'load', deck: i, L, R, rate: decoded.rate, split: !!track.split,
      startFrame: Math.floor(startTime * decoded.rate),
    }, R === L ? [L.buffer] : [L.buffer, R.buffer]);
  }
  unload(i) { this.post({ type: 'unload', deck: i }); }
}

// same work as decode-worker.js, for browsers without module-relative workers
function convertInline(L, R) {
  const n = L.length, R2 = R || L, bins = 8192, env = new Float32Array(bins), per = Math.max(1, Math.floor(n / bins));
  for (let b = 0; b < bins; b++) {
    let s = 0, pk = 0; const st = b * per, en = Math.min(n, st + per);
    for (let j = st; j < en; j += 2) { const v = (L[j] + R2[j]) * 0.5; s += v * v; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
    env[b] = 0.65 * Math.sqrt(s / Math.max(1, (en - st) / 2)) * 1.6 + 0.35 * pk;
  }
  let mx = 0; for (const v of env) if (v > mx) mx = v;
  if (mx > 0) for (let b = 0; b < bins; b++) env[b] /= mx;
  const conv = F => { const o = new Int16Array(F.length); for (let j = 0; j < F.length; j++) { const a = F[j] * 32767; o[j] = a > 32767 ? 32767 : a < -32768 ? -32768 : a; } return o; };
  return { iL: conv(L), iR: R ? conv(R) : null, env };
}
