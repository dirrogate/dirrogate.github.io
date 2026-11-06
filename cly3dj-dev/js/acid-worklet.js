// Gemini_acid: Roland TB-303 analog-modelled acid synthesizer and 16-step sequencer AudioWorklet
// Implements bandlimited PolyBLEP oscillators (Saw/Square), authentic 4-pole saturated diode ladder filter,
// exponential decay envelope with accent snap, ~60ms slide portamento, and 4 Goa trance acid pattern banks.

class AcidWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sampleRate = sampleRate;

    // Synth Parameters (0..1 normalized where applicable)
    this.running = false;
    this.bpm = 142;
    this.tuning = 0.5;      // 0..1, 0.5 = 440 Hz standard
    this.cutoff = 0.35;     // base cutoff (30 Hz .. 2400 Hz)
    this.resonance = 0.65;  // 0 .. 0.98 (diode ladder resonance)
    this.envMod = 0.70;     // envelope to filter cutoff depth
    this.decay = 0.40;      // 200 ms .. 2000 ms
    this.accent = 0.60;     // accent boost amount
    this.waveform = 0;      // 0 = Sawtooth, 1 = Square

    // Clock & Step Sequencer
    this.samplesPerStep = (60 / (this.bpm * 4)) * this.sampleRate;
    this.stepTimer = 0;
    this.currentStep = 0;
    this.currentPattern = 0;

    // Presets for Goa Acid Sequences (Patterns 1 to 4)
    // MIDI notes: D2=38, Eb2=39, F2=41, G2=43, A2=45, Bb2=46, C3=48, D3=50, Eb3=51, etc.
    this.patterns = [
      // Pattern 1: Astral Drive (D minor, 142 BPM rolling Goa bassline)
      [
        { note: 38, gate: true, slide: false, accent: true },
        { note: 38, gate: true, slide: false, accent: false },
        { note: 50, gate: true, slide: true,  accent: false },
        { note: 38, gate: true, slide: false, accent: false },
        { note: 41, gate: true, slide: false, accent: false },
        { note: 38, gate: true, slide: false, accent: false },
        { note: 50, gate: true, slide: true,  accent: true },
        { note: 48, gate: true, slide: false, accent: false },
        { note: 38, gate: true, slide: false, accent: true },
        { note: 38, gate: true, slide: false, accent: false },
        { note: 43, gate: true, slide: false, accent: true },
        { note: 41, gate: true, slide: true,  accent: false },
        { note: 38, gate: true, slide: false, accent: false },
        { note: 50, gate: true, slide: true,  accent: false },
        { note: 51, gate: true, slide: true,  accent: true },
        { note: 38, gate: true, slide: false, accent: false }
      ],
      // Pattern 2: Hallucinogenic Squelch (F# / A Dorian syncopated acid funk)
      [
        { note: 42, gate: true, slide: false, accent: true },
        { note: 42, gate: false, slide: false, accent: false },
        { note: 42, gate: true, slide: true,  accent: false },
        { note: 45, gate: true, slide: true,  accent: false },
        { note: 42, gate: true, slide: false, accent: false },
        { note: 54, gate: true, slide: false, accent: true },
        { note: 42, gate: false, slide: false, accent: false },
        { note: 42, gate: true, slide: false, accent: false },
        { note: 57, gate: true, slide: true,  accent: true },
        { note: 55, gate: true, slide: true,  accent: false },
        { note: 47, gate: true, slide: false, accent: false },
        { note: 42, gate: true, slide: false, accent: true },
        { note: 42, gate: false, slide: false, accent: false },
        { note: 45, gate: true, slide: true,  accent: false },
        { note: 44, gate: true, slide: false, accent: true },
        { note: 42, gate: true, slide: false, accent: false }
      ],
      // Pattern 3: Juno Hypnosis (A minor triplet-feel psychedelic acid arp)
      [
        { note: 33, gate: true, slide: false, accent: true },
        { note: 45, gate: true, slide: false, accent: false },
        { note: 45, gate: true, slide: true,  accent: false },
        { note: 48, gate: true, slide: false, accent: false },
        { note: 33, gate: true, slide: false, accent: false },
        { note: 40, gate: true, slide: false, accent: true },
        { note: 45, gate: true, slide: true,  accent: false },
        { note: 43, gate: true, slide: false, accent: false },
        { note: 33, gate: true, slide: false, accent: true },
        { note: 45, gate: true, slide: false, accent: false },
        { note: 50, gate: true, slide: true,  accent: false },
        { note: 48, gate: true, slide: false, accent: true },
        { note: 33, gate: true, slide: false, accent: false },
        { note: 41, gate: true, slide: true,  accent: false },
        { note: 40, gate: true, slide: false, accent: true },
        { note: 33, gate: true, slide: false, accent: false }
      ],
      // Pattern 4: Acperience Euphoria (C melodic soaring acid climb)
      [
        { note: 36, gate: true, slide: false, accent: true },
        { note: 48, gate: true, slide: true,  accent: false },
        { note: 51, gate: true, slide: false, accent: true },
        { note: 50, gate: true, slide: true,  accent: false },
        { note: 48, gate: true, slide: false, accent: false },
        { note: 43, gate: true, slide: false, accent: false },
        { note: 46, gate: true, slide: true,  accent: false },
        { note: 48, gate: true, slide: false, accent: true },
        { note: 44, gate: true, slide: false, accent: false },
        { note: 46, gate: true, slide: true,  accent: false },
        { note: 48, gate: true, slide: false, accent: true },
        { note: 51, gate: true, slide: true,  accent: false },
        { note: 53, gate: true, slide: true,  accent: true },
        { note: 51, gate: true, slide: false, accent: false },
        { note: 50, gate: true, slide: true,  accent: false },
        { note: 48, gate: true, slide: false, accent: false }
      ]
    ];

    // Voice State
    this.phase = 0;
    this.freq = 110;
    this.targetFreq = 110;
    this.slideSpeed = Math.exp(-1 / (0.060 * this.sampleRate)); // ~60 ms slide

    // Envelopes
    this.filterEnv = 0;
    this.vcaEnv = 0;
    this.currentAccent = false;
    this.gateOn = false;

    // 4-Pole Diode Ladder Filter state
    this.s1 = 0;
    this.s2 = 0;
    this.s3 = 0;
    this.s4 = 0;

    // Highpass DC-blocker
    this.dcIn = 0;
    this.dcOut = 0;

    // Listen for messages from main thread
    this.port.onmessage = e => this.handleMessage(e.data);
  }

  handleMessage(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'run':
        this.running = !!msg.value;
        if (!this.running) {
          this.vcaEnv = 0;
          this.filterEnv = 0;
          this.currentStep = 0;
          this.stepTimer = 0;
        }
        break;
      case 'pattern':
        if (msg.value >= 0 && msg.value < this.patterns.length) {
          this.currentPattern = msg.value;
        }
        break;
      case 'param':
        if (msg.key && typeof msg.value === 'number') {
          this[msg.key] = msg.value;
          if (msg.key === 'bpm') {
            this.samplesPerStep = (60 / (Math.max(60, Math.min(220, this.bpm)) * 4)) * this.sampleRate;
          }
        }
        break;
      case 'noteOn':
        this.triggerNote(msg.note, false, msg.accent || false);
        break;
      case 'noteOff':
        this.gateOn = false;
        break;
    }
  }

  midiToFreq(midi) {
    // 0.5 tuning = 0 cents offset; range: -100 to +100 cents
    const tuneCents = (this.tuning - 0.5) * 200;
    return 440 * Math.pow(2, (midi - 69 + tuneCents / 100) / 12);
  }

  triggerNote(midi, isSlide, isAccent) {
    const f = this.midiToFreq(midi);
    this.targetFreq = f;
    this.currentAccent = isAccent;
    this.gateOn = true;

    if (!isSlide) {
      this.freq = f;
      // Retrigger envelopes
      this.vcaEnv = 1.0;
      this.filterEnv = 1.0;
    }
  }

  stepSequencer() {
    if (!this.running) return;

    this.stepTimer++;
    if (this.stepTimer >= this.samplesPerStep) {
      this.stepTimer -= this.samplesPerStep;
      this.currentStep = (this.currentStep + 1) % 16;

      const p = this.patterns[this.currentPattern];
      const stepData = p[this.currentStep];

      if (stepData && stepData.gate) {
        this.triggerNote(stepData.note, stepData.slide, stepData.accent);
      } else {
        this.gateOn = false;
      }

      // Notify main thread for UI LED sync (every step)
      this.port.postMessage({
        type: 'step',
        step: this.currentStep,
        pattern: this.currentPattern,
        accent: stepData ? !!stepData.accent : false
      });
    }
  }

  // PolyBLEP anti-aliasing residual for sharp transitions
  polyBlep(t, dt) {
    if (t < dt) {
      t /= dt;
      return t + t - t * t - 1.0;
    } else if (t > 1.0 - dt) {
      t = (t - 1.0) / dt;
      return t * t + t + t + 1.0;
    }
    return 0.0;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const outL = output[0];
    const outR = output[1] || output[0];
    const len = outL.length;

    // Envelope decay multipliers
    // Normal decay: 200 ms to 2000 ms
    const baseDecaySec = 0.20 + this.decay * 1.80;
    // When accented, decay is shortened for punchy snap (~180 ms)
    const decaySec = this.currentAccent ? Math.min(baseDecaySec, 0.20) : baseDecaySec;
    const envDecayCoef = Math.exp(-1 / (decaySec * this.sampleRate));
    const vcaDecayCoef = Math.exp(-1 / (0.25 * this.sampleRate));

    // Base cutoff: 35 Hz to 2400 Hz
    const minCut = 35;
    const maxCut = 2400;
    const baseCutoff = minCut * Math.pow(maxCut / minCut, this.cutoff);

    for (let i = 0; i < len; i++) {
      this.stepSequencer();

      // Pitch slide portamento
      if (Math.abs(this.targetFreq - this.freq) > 0.01) {
        this.freq = this.targetFreq + (this.freq - this.targetFreq) * this.slideSpeed;
      }

      // Advance Oscillator Phase
      const dt = this.freq / this.sampleRate;
      this.phase += dt;
      if (this.phase >= 1.0) this.phase -= 1.0;

      // Raw Oscillator Output
      let rawOsc = 0;
      if (this.waveform === 0) {
        // Sawtooth with PolyBLEP
        rawOsc = (2.0 * this.phase) - 1.0;
        rawOsc -= this.polyBlep(this.phase, dt);
      } else {
        // Square wave (approx 55% asymmetric duty cycle typical of TB-303)
        const duty = 0.55;
        rawOsc = this.phase < duty ? 1.0 : -1.0;
        rawOsc += this.polyBlep(this.phase, dt);
        rawOsc -= this.polyBlep((this.phase + (1.0 - duty)) % 1.0, dt);
      }

      // Envelope step
      this.filterEnv *= envDecayCoef;
      if (!this.gateOn) {
        this.vcaEnv *= vcaDecayCoef;
      }

      // Cutoff calculation: base + (envMod * filterEnv) + extra accent spike
      let envCut = this.envMod * this.filterEnv;
      if (this.currentAccent) {
        envCut += this.accent * 0.45 * this.filterEnv;
      }
      const targetCutoff = Math.min(18000, baseCutoff * Math.pow(16, envCut));

      // 4-Pole Diode Ladder Filter (2x oversampled for numerical stability)
      const k = this.resonance * 3.85; // resonance feedback gain
      const f = Math.tan((Math.PI * targetCutoff) / (this.sampleRate * 2));
      const g = f / (1.0 + f);

      let sig = rawOsc;
      for (let os = 0; os < 2; os++) {
        // Non-linear feedback saturation (tanh models the diode response)
        const fb = Math.tanh(k * this.s4);
        const u = sig - fb;

        const v1 = (u - this.s1) * g;
        const y1 = v1 + this.s1;
        this.s1 = y1 + v1;

        const v2 = (y1 - this.s2) * g;
        const y2 = v2 + this.s2;
        this.s2 = y2 + v2;

        const v3 = (y2 - this.s3) * g;
        const y3 = v3 + this.s3;
        this.s3 = y3 + v3;

        const v4 = (y3 - this.s4) * g;
        const y4 = v4 + this.s4;
        this.s4 = y4 + v4;

        sig = y4;
      }

      // VCA & Accent Gain boost
      let amp = this.vcaEnv;
      if (this.currentAccent) {
        amp *= (1.0 + this.accent * 0.6);
      }
      let outSig = sig * amp * 0.8;

      // High-Pass DC-Blocker (15 Hz)
      const dcAlpha = 0.998;
      this.dcOut = outSig - this.dcIn + dcAlpha * this.dcOut;
      this.dcIn = outSig;

      // Output to stereo buffers
      outL[i] = this.dcOut;
      outR[i] = this.dcOut;
    }

    return true;
  }
}

registerProcessor('vire-acid', AcidWorkletProcessor);
