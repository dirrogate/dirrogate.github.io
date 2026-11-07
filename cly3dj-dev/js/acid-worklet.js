// Gemini_acid: Roland Boutique TB-03 (DIRROACID) analog-modelled acid synthesizer, FX & sequencer AudioWorklet
// Implements bandlimited PolyBLEP oscillators (Saw/Square), authentic 4-pole saturated diode ladder filter,
// exponential decay envelope with accent snap, ~60ms slide portamento, TB-03 Overdrive & Tape Delay FX,
// plus 76 pattern patches (70 TB-03 .PRM patterns + Goa presets) and 7 multi-bar .PRM tracks.

class AcidWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sampleRate = sampleRate;

    // Gemini_acid: Synth & FX Parameters (0..1 normalized where applicable)
    this.running = false;
    this.bpm = 120.0;
    this.tuning = 0.5;        // 0..1, 0.5 = 440 Hz standard
    this.cutoff = 0.35;       // base cutoff (35 Hz .. 5000 Hz; #607 was 2400)
    this.resonance = 0.65;    // 0 .. 0.98 (diode ladder resonance)
    this.envMod = 0.70;       // envelope to filter cutoff depth
    this.decay = 0.40;        // 200 ms .. 2000 ms
    this.accent = 0.60;       // accent boost amount
    this.overdrive = 0.25;    // TB-03 Overdrive distortion amount (0..1)
    this.delayTime = 0.35;    // TB-03 Delay time (0..1 -> 20ms..600ms)
    this.delayFeedback = 0.25;// TB-03 Delay feedback & wet mix (0..1)
    this.waveform = 0;        // 0 = Sawtooth, 1 = Square
    this.transpose = 0;       // Manual semitone transpose (-12 .. +12)
    this.makeup = 0.32;       // #607 output gain (was 0.8 into a double ladder): default patch about -9.5 dBFS RMS, like a mastered track

    // Clock, Step & Track Sequencer
    this.samplesPerStep = (60 / (this.bpm * 4)) * this.sampleRate;
    this.stepTimer = 0;
    this.currentStep = 0;
    this.currentPattern = 0;
    this.trackMode = false;
    this.currentTrack = 0;
    this.currentBar = 0;
    this.trackTranspose = 0;

    // Gemini_acid: 76 Compiled Patterns (Banks 1-3 from TB-03_patches/*.PRM + Bank 4 Goa Acid Presets)
    // Each step is [midiNote (-1 = rest), accent (0|1), slide (0|1)]
    this.patterns = [
      {id:'PTN1_01',endStep:16,triplet:0,steps:[[45,0,0],[29,0,1],[47,0,0],[29,0,0],[57,0,1],[52,0,0],[52,0,0],[41,0,1],[53,0,1],[33,0,0],[45,0,0],[45,0,1],[50,0,1],[29,0,0],[55,0,1],[57,0,0]]},
      {id:'PTN1_02',endStep:16,triplet:0,steps:[[59,0,1],[40,0,1],[40,0,0],[40,0,0],[40,1,0],[45,0,1],[45,0,0],[52,1,0],[67,0,1],[52,0,1],[-1,0,0],[66,0,1],[52,0,1],[52,0,1],[40,0,0],[52,0,1]]},
      {id:'PTN1_03',endStep:8,triplet:0,steps:[[31,0,0],[31,0,0],[55,0,0],[43,0,0],[31,0,1],[43,0,1],[34,0,1],[31,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN1_04',endStep:16,triplet:0,steps:[[22,0,1],[22,0,1],[22,0,1],[42,0,0],[46,0,0],[34,0,0],[41,0,0],[39,0,0],[34,0,0],[46,0,1],[41,0,1],[39,0,0],[46,0,1],[42,0,0],[34,0,0],[49,0,0]]},
      {id:'PTN1_05',endStep:16,triplet:0,steps:[[39,0,0],[44,1,0],[46,0,1],[42,0,0],[41,0,1],[39,0,0],[41,0,1],[42,0,1],[42,0,0],[46,0,1],[39,0,1],[42,0,0],[39,1,0],[46,0,0],[39,0,0],[58,0,1]]},
      {id:'PTN1_06',endStep:16,triplet:0,steps:[[36,0,0],[39,0,0],[24,0,0],[36,0,0],[36,0,1],[36,0,0],[24,0,0],[-1,0,0],[-1,0,0],[27,0,0],[36,0,1],[36,0,0],[24,0,0],[36,0,1],[24,0,1],[24,0,1]]},
      {id:'PTN1_07',endStep:16,triplet:0,steps:[[28,0,1],[28,0,1],[28,0,1],[28,0,1],[28,0,1],[28,0,1],[28,0,1],[31,0,1],[31,0,0],[33,0,0],[33,0,0],[35,0,1],[36,0,1],[31,0,0],[47,0,0],[40,0,0]]},
      {id:'PTN1_08',endStep:16,triplet:0,steps:[[24,0,0],[24,0,1],[24,0,1],[24,0,1],[36,0,1],[36,0,0],[24,0,1],[24,0,1],[12,0,0],[-1,0,0],[-1,0,0],[24,0,0],[36,0,0],[24,0,0],[36,0,0],[39,0,0]]},
      {id:'PTN1_09',endStep:8,triplet:0,steps:[[21,0,1],[45,0,0],[45,0,0],[43,0,0],[45,0,1],[33,0,0],[33,0,0],[45,0,0],[28,0,0],[33,0,0],[33,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN1_10',endStep:8,triplet:0,steps:[[70,0,0],[67,0,0],[62,0,0],[55,0,0],[58,0,0],[55,0,1],[50,0,0],[55,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN1_11',endStep:16,triplet:0,steps:[[67,1,0],[70,0,0],[62,0,0],[67,1,0],[67,0,1],[62,0,0],[70,0,1],[67,0,0],[69,0,0],[60,0,1],[63,0,0],[67,1,0],[55,0,0],[70,0,0],[31,0,1],[50,0,0]]},
      {id:'PTN1_12',endStep:16,triplet:0,steps:[[50,1,0],[38,0,0],[38,0,0],[38,0,0],[38,0,0],[38,0,0],[50,1,0],[38,0,0],[38,0,0],[38,0,0],[38,0,0],[50,1,0],[38,0,0],[50,1,0],[38,0,1],[38,0,0]]},
      {id:'PTN1_13',endStep:16,triplet:0,steps:[[38,0,0],[38,0,0],[26,0,0],[26,0,0],[38,0,0],[50,0,0],[38,0,0],[26,0,0],[38,0,0],[38,0,0],[36,0,0],[38,0,0],[38,0,0],[41,0,1],[41,0,0],[43,0,1]]},
      {id:'PTN1_14',endStep:16,triplet:0,steps:[[70,0,0],[68,0,0],[67,0,0],[70,0,0],[68,0,0],[67,0,0],[70,0,0],[68,0,0],[67,0,0],[72,0,0],[68,0,0],[67,0,1],[72,0,0],[68,0,0],[67,0,1],[67,0,1]]},
      {id:'PTN1_15',endStep:16,triplet:0,steps:[[48,0,0],[47,0,0],[57,0,1],[45,0,0],[33,0,0],[48,0,0],[57,0,0],[52,0,0],[38,0,0],[40,0,1],[40,0,0],[52,0,1],[52,0,0],[40,0,1],[55,0,0],[55,0,1]]},
      {id:'PTN1_16',endStep:16,triplet:0,steps:[[51,1,0],[51,0,1],[56,0,1],[56,0,0],[58,0,1],[58,0,0],[59,0,1],[59,0,0],[56,0,1],[68,0,1],[63,0,1],[63,0,0],[56,0,1],[68,0,1],[70,0,1],[70,0,0]]},
      {id:'PTN1_17',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN1_18',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN1_19',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN1_20',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN1_21',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN1_22',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN1_23',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN1_24',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN2_01',endStep:16,triplet:0,steps:[[48,0,1],[48,0,1],[51,0,1],[53,0,1],[53,0,1],[55,0,1],[55,0,0],[58,0,1],[58,0,0],[60,0,0],[60,0,1],[31,0,0],[43,0,0],[58,0,0],[60,0,1],[48,0,0]]},
      {id:'PTN2_02',endStep:6,triplet:0,steps:[[53,0,1],[39,0,0],[43,0,1],[43,0,0],[31,0,0],[46,0,1],[24,0,1],[60,0,0],[70,1,0],[67,1,1],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN2_03',endStep:16,triplet:0,steps:[[43,0,0],[50,0,1],[51,1,0],[53,0,0],[55,0,0],[48,1,0],[50,0,0],[39,1,1],[55,0,1],[43,0,0],[48,0,1],[51,0,0],[43,0,0],[55,0,0],[51,0,1],[53,0,0]]},
      {id:'PTN2_04',endStep:16,triplet:0,steps:[[43,0,1],[43,0,0],[62,0,0],[62,0,1],[60,0,1],[60,0,1],[59,0,1],[59,0,0],[65,0,0],[55,0,0],[43,0,0],[65,0,1],[65,0,0],[55,0,0],[67,0,1],[55,0,0]]},
      {id:'PTN2_05',endStep:16,triplet:0,steps:[[40,0,1],[52,0,1],[59,0,1],[59,0,1],[55,0,1],[55,0,1],[60,0,1],[60,0,1],[59,0,1],[59,0,1],[64,0,1],[64,0,1],[57,0,1],[57,0,1],[59,0,1],[59,0,0]]},
      {id:'PTN2_06',endStep:16,triplet:0,steps:[[39,0,1],[27,0,0],[27,0,0],[15,0,0],[27,0,0],[15,0,1],[27,0,0],[39,0,1],[27,0,0],[30,0,0],[30,0,1],[42,0,0],[46,0,1],[54,0,0],[42,0,0],[54,0,0]]},
      {id:'PTN2_07',endStep:8,triplet:0,steps:[[43,0,0],[43,0,0],[31,0,0],[43,0,0],[31,0,1],[43,0,0],[43,0,0],[55,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN2_08',endStep:16,triplet:0,steps:[[55,0,1],[55,0,1],[31,0,1],[31,0,1],[31,0,1],[31,0,0],[31,0,1],[43,0,1],[43,0,1],[43,0,0],[43,0,0],[43,0,0],[43,0,0],[43,0,0],[43,0,0],[43,0,1]]},
      {id:'PTN2_09',endStep:16,triplet:0,steps:[[39,0,0],[39,0,0],[27,0,1],[27,0,0],[39,0,0],[39,0,1],[51,0,1],[41,0,0],[51,0,1],[42,0,0],[42,0,1],[53,0,1],[53,0,1],[54,0,0],[44,0,1],[46,0,1]]},
      {id:'PTN2_10',endStep:16,triplet:0,steps:[[50,0,1],[50,0,0],[55,0,1],[55,0,0],[45,0,1],[45,0,1],[45,0,0],[45,0,0],[45,0,0],[45,0,0],[40,0,1],[40,0,0],[48,0,1],[48,0,1],[43,0,1],[43,0,1]]},
      {id:'PTN2_11',endStep:8,triplet:0,steps:[[69,0,0],[45,0,1],[33,0,0],[45,0,0],[45,0,0],[62,0,0],[64,0,1],[67,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN2_12',endStep:8,triplet:0,steps:[[44,0,0],[44,1,0],[32,0,0],[32,1,1],[44,0,0],[44,1,0],[56,0,0],[44,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN2_13',endStep:16,triplet:0,steps:[[51,0,1],[39,0,0],[39,0,0],[44,0,1],[46,0,0],[51,0,0],[49,0,0],[53,0,0],[54,0,0],[51,0,0],[39,0,0],[39,0,0],[44,0,0],[46,0,1],[51,0,0],[49,0,1]]},
      {id:'PTN2_14',endStep:16,triplet:0,steps:[[51,0,1],[51,0,0],[58,0,1],[58,0,1],[59,0,0],[59,0,0],[58,0,1],[58,0,0],[58,0,1],[58,0,0],[39,0,1],[63,0,1],[63,0,0],[65,0,1],[61,0,1],[61,0,1]]},
      {id:'PTN2_15',endStep:16,triplet:0,steps:[[58,0,1],[58,0,1],[51,0,1],[51,0,1],[58,0,1],[39,0,1],[56,0,1],[56,0,0],[59,0,1],[56,0,0],[56,0,1],[58,0,1],[58,0,0],[63,0,0],[56,0,0],[61,0,0]]},
      {id:'PTN2_16',endStep:16,triplet:0,steps:[[58,0,1],[58,0,0],[56,0,1],[56,0,1],[59,0,1],[59,0,0],[56,1,0],[61,0,1],[63,0,0],[63,0,1],[56,0,1],[56,0,1],[56,0,1],[56,1,1],[39,0,1],[51,0,1]]},
      {id:'PTN2_17',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN2_18',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN2_19',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN2_20',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN2_21',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN2_22',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN2_23',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN2_24',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN3_01',endStep:16,triplet:0,steps:[[27,0,1],[27,0,1],[46,0,1],[46,0,1],[54,0,1],[54,0,1],[58,0,1],[58,0,1],[65,0,1],[65,0,1],[65,0,1],[65,0,1],[63,0,1],[63,0,1],[66,0,1],[66,0,0]]},
      {id:'PTN3_02',endStep:16,triplet:0,steps:[[39,0,1],[70,0,1],[70,0,1],[70,0,1],[66,0,1],[66,0,1],[65,0,1],[65,0,1],[51,0,0],[51,0,0],[58,0,1],[58,0,1],[54,0,1],[54,0,1],[53,0,1],[51,0,0]]},
      {id:'PTN3_03',endStep:16,triplet:0,steps:[[40,0,1],[52,0,0],[52,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[52,0,1],[64,0,1],[66,0,1],[66,0,1],[66,0,0],[66,0,1],[67,0,1],[67,0,1],[69,0,0],[71,0,0]]},
      {id:'PTN3_04',endStep:8,triplet:0,steps:[[40,0,1],[52,0,0],[50,0,0],[40,0,0],[52,0,1],[40,0,0],[28,1,1],[40,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN3_05',endStep:8,triplet:0,steps:[[40,0,0],[55,0,0],[52,0,0],[40,0,0],[40,0,1],[40,0,1],[40,0,0],[40,1,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN3_06',endStep:16,triplet:0,steps:[[71,0,1],[71,0,1],[67,0,1],[67,0,1],[-1,0,0],[-1,0,0],[72,0,1],[72,0,1],[62,0,1],[62,0,1],[62,0,1],[64,0,1],[64,0,1],[64,0,1],[64,0,1],[64,0,0]]},
      {id:'PTN3_07',endStep:16,triplet:0,steps:[[45,0,1],[45,0,0],[50,1,1],[50,0,0],[50,0,1],[50,0,0],[38,0,0],[-1,0,0],[46,1,0],[-1,0,0],[-1,0,0],[43,0,0],[-1,0,0],[-1,0,0],[58,0,1],[57,0,0]]},
      {id:'PTN3_08',endStep:14,triplet:0,steps:[[39,0,1],[51,0,0],[63,0,0],[39,0,0],[27,0,0],[39,0,1],[51,0,0],[63,0,0],[70,0,1],[70,0,0],[65,0,1],[65,0,1],[66,0,0],[66,0,0],[63,0,0],[63,0,0]]},
      {id:'PTN3_09',endStep:16,triplet:0,steps:[[39,1,0],[39,0,0],[27,0,1],[27,0,0],[27,0,0],[27,0,0],[39,0,0],[39,0,1],[39,0,0],[39,0,0],[27,0,1],[27,0,0],[39,0,0],[27,0,0],[15,0,1],[15,0,0]]},
      {id:'PTN3_10',endStep:16,triplet:0,steps:[[30,0,0],[30,0,0],[30,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[42,0,1],[42,0,0],[42,0,0],[42,0,1],[-1,0,0],[-1,0,0],[-1,0,0],[30,0,0],[30,0,0]]},
      {id:'PTN3_11',endStep:8,triplet:0,steps:[[32,0,0],[44,0,0],[20,0,1],[32,0,0],[32,1,0],[44,0,0],[32,0,0],[20,0,0],[-1,0,0],[-1,0,0],[44,0,0],[32,0,0],[20,0,0],[32,0,0],[44,0,0],[32,0,0]]},
      {id:'PTN3_12',endStep:16,triplet:0,steps:[[38,1,0],[38,0,0],[-1,0,0],[50,0,1],[69,0,1],[70,0,1],[69,0,0],[57,0,0],[38,1,0],[67,0,0],[38,0,0],[50,0,0],[72,0,0],[62,0,0],[70,0,1],[67,0,0]]},
      {id:'PTN3_13',endStep:16,triplet:0,steps:[[38,0,0],[-1,0,0],[70,0,1],[70,0,0],[62,0,0],[-1,0,0],[70,0,0],[-1,0,0],[69,0,0],[-1,0,0],[67,0,0],[62,0,0],[50,0,0],[38,0,1],[50,0,0],[62,0,1]]},
      {id:'PTN3_14',endStep:16,triplet:0,steps:[[69,0,1],[70,0,0],[69,0,1],[69,0,0],[62,0,1],[62,0,0],[62,0,1],[67,0,0],[67,0,1],[72,0,0],[72,0,1],[69,0,0],[69,0,1],[70,0,0],[70,0,1],[69,0,0]]},
      {id:'PTN3_15',endStep:16,triplet:0,steps:[[46,0,0],[46,0,0],[39,0,0],[46,0,1],[46,0,1],[39,0,0],[42,0,1],[41,0,0],[39,0,0],[42,0,0],[39,0,0],[46,0,0],[41,0,1],[46,0,0],[46,0,0],[39,0,0]]},
      {id:'PTN3_16',endStep:16,triplet:0,steps:[[39,0,0],[39,0,0],[39,0,0],[39,0,0],[27,0,0],[39,0,1],[51,0,0],[39,0,0],[39,0,0],[27,0,0],[42,0,0],[32,0,0],[46,0,1],[46,0,0],[54,0,1],[53,0,0]]},
      {id:'PTN3_17',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN3_18',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN3_19',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN3_20',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN3_21',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'PTN3_22',endStep:16,triplet:0,steps:[[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0],[-1,0,0]]},
      {id:'GOA_1',endStep:16,triplet:0,steps:[[38,1,0],[38,0,0],[50,0,1],[38,0,0],[41,0,0],[38,0,0],[50,1,1],[48,0,0],[38,1,0],[38,0,0],[43,1,0],[41,0,1],[38,0,0],[50,0,1],[51,1,1],[38,0,0]]},
      {id:'GOA_2',endStep:16,triplet:0,steps:[[42,1,0],[-1,0,0],[42,0,1],[45,0,1],[42,0,0],[54,1,0],[-1,0,0],[42,0,0],[57,1,1],[55,0,1],[47,0,0],[42,1,0],[-1,0,0],[45,0,1],[44,1,0],[42,0,0]]},
      {id:'GOA_3',endStep:16,triplet:0,steps:[[33,1,0],[45,0,0],[45,0,1],[48,0,0],[33,0,0],[40,1,0],[45,0,1],[43,0,0],[33,1,0],[45,0,0],[50,0,1],[48,1,0],[33,0,0],[41,0,1],[40,1,0],[33,0,0]]},
      {id:'GOA_4',endStep:16,triplet:0,steps:[[36,1,0],[48,0,1],[51,1,0],[50,0,1],[48,0,0],[43,0,0],[46,0,1],[48,1,0],[44,0,0],[46,0,1],[48,1,0],[51,0,1],[53,1,1],[51,0,0],[50,0,1],[48,0,0]]}
    ];

    // Gemini_acid: 7 Compiled Multi-Bar Tracks from TB-03_patches/TB03_TRACK1..7.PRM
    // Each bar is [patternIndex, transposeSemitones]
    this.tracks = [
      {id:'TRACK1',len:32,dsBar:0,bars:[[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[2,0],[2,0],[3,0],[3,0],[3,0],[3,0],[3,0],[3,0],[3,0],[7,1],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0]]},
      {id:'TRACK2',len:95,dsBar:95,bars:[[8,0],[8,0],[8,0],[8,0],[8,0],[8,0],[8,0],[8,0],[8,0],[8,0],[8,0],[8,0],[8,0],[8,0],[8,0],[14,0],[11,0],[11,0],[11,0],[11,0],[11,0],[11,0],[11,0],[11,0],[11,0],[11,0],[11,0],[11,0],[11,0],[11,0],[11,0],[13,0],[14,0],[14,0],[14,0],[14,0],[13,0],[13,0],[13,0],[13,0],[13,0],[13,0],[13,0],[15,0],[13,0],[13,0],[13,0],[13,0],[13,0],[13,0],[13,0],[15,0],[8,0],[8,0],[8,0],[15,0],[8,0],[8,0],[8,0],[15,0],[13,0],[13,0],[13,0],[13,0],[13,0],[13,0],[13,0],[15,0],[8,0],[8,0],[8,0],[8,0],[8,0],[8,0],[8,0],[8,0],[14,0],[14,3],[14,7],[14,10],[13,0],[13,7],[13,3],[13,5],[13,0],[13,7],[13,3],[13,5],[8,0],[8,0],[8,0],[15,0],[8,0],[8,0],[8,0]]},
      {id:'TRACK3',len:35,dsBar:0,bars:[[2,0],[2,0],[2,0],[2,0],[3,0],[3,0],[3,0],[3,0],[1,0],[1,0],[1,0],[1,0],[4,0],[4,0],[4,0],[4,0],[6,0],[6,0],[6,0],[6,0],[5,0],[5,0],[5,0],[5,0],[7,0],[7,0],[7,0],[7,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0]]},
      {id:'TRACK4',len:15,dsBar:9,bars:[[8,0],[9,0],[10,0],[11,0],[8,0],[9,0],[10,0],[11,0],[8,0],[11,0],[11,0],[11,0],[8,0],[8,0],[8,0]]},
      {id:'TRACK5',len:35,dsBar:0,bars:[[0,0],[0,0],[0,0],[1,0],[0,0],[0,0],[0,0],[1,0],[0,0],[0,0],[0,0],[1,0],[0,0],[0,0],[0,0],[1,0],[0,0],[0,0],[0,0],[1,0],[2,0],[2,0],[2,0],[2,0],[2,0],[2,0],[2,0],[2,0],[0,0],[0,0],[0,0],[1,0],[0,0],[0,0],[0,0]]},
      {id:'TRACK6',len:1,dsBar:0,bars:[[3,0]]},
      {id:'TRACK7',len:31,dsBar:35,bars:[[0,0],[0,0],[0,0],[0,0],[1,0],[1,0],[1,0],[1,0],[2,0],[2,0],[2,0],[2,0],[3,0],[3,0],[3,0],[3,0],[4,0],[4,0],[4,0],[4,0],[5,0],[5,0],[5,0],[5,0],[6,0],[6,0],[6,0],[6,0],[7,0],[7,0],[7,0]]}
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

    // Gemini_acid: Pre-allocated Circular Tape Delay Line (65536 samples = ~1.36s @ 48kHz, zero GC in process)
    this.delaySize = 65536;
    this.delayMask = 65535;
    this.delayBuf = new Float32Array(this.delaySize);
    this.delayWrite = 0;
    this.smoothDelay = (0.020 + this.delayTime * 0.580) * this.sampleRate;
    this.delayLp = 0;
    this.delayDcIn = 0;
    this.delayDcOut = 0;

    // Listen for messages from main thread
    this.port.onmessage = e => this.handleMessage(e.data);
  }

  updateStepTiming() {
    const clampedBpm = Math.max(20, Math.min(300, this.bpm));
    const p = this.patterns[this.currentPattern];
    const mult = (p && p.triplet) ? 3 : 4;
    this.samplesPerStep = (60 / (clampedBpm * mult)) * this.sampleRate;
  }

  handleMessage(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'run':
        this.running = !!msg.value;
        if (this.running) {
          this.currentStep = -1;
          this.stepTimer = this.samplesPerStep;
          if (this.trackMode) {
            this.currentBar = 0;
            const trk = this.tracks[this.currentTrack];
            if (trk && trk.bars && trk.bars.length > 0) {
              this.currentPattern = Math.max(0, Math.min(this.patterns.length - 1, trk.bars[0][0]));
              this.trackTranspose = trk.bars[0][1] || 0;
            }
          } else {
            this.trackTranspose = 0;
          }
          this.updateStepTiming();
        } else {
          this.vcaEnv = 0;
          this.filterEnv = 0;
          this.gateOn = false;
          this.currentStep = 0;
          this.stepTimer = 0;
        }
        break;
      case 'pattern':
        if (msg.value >= 0 && msg.value < this.patterns.length) {
          this.currentPattern = msg.value;
          this.updateStepTiming();
        }
        break;
      case 'track':
        if (msg.value >= 0 && msg.value < this.tracks.length) {
          this.currentTrack = msg.value;
          this.currentBar = 0;
          if (this.trackMode) {
            const trk = this.tracks[this.currentTrack];
            if (trk && trk.bars && trk.bars.length > 0) {
              this.currentPattern = Math.max(0, Math.min(this.patterns.length - 1, trk.bars[0][0]));
              this.trackTranspose = trk.bars[0][1] || 0;
              this.updateStepTiming();
            }
          }
        }
        break;
      case 'trackMode':
        this.trackMode = !!msg.value;
        if (!this.trackMode) this.trackTranspose = 0;
        break;
      case 'clearPattern': {
        const p = this.patterns[this.currentPattern];
        if (p && p.steps) {
          for (let s = 0; s < p.steps.length; s++) p.steps[s] = [36, 0, 0];
        }
        break;
      }
      case 'setStep': {
        const p = this.patterns[this.currentPattern];
        if (p && p.steps && msg.step >= 0 && msg.step < p.steps.length) {
          p.steps[msg.step] = [msg.note, msg.accent ? 1 : 0, msg.slide ? 1 : 0];
        }
        break;
      }
      case 'param':
        if (msg.key && typeof msg.value === 'number' && AcidWorkletProcessor.PARAMS.has(msg.key)) {   // #607 only real synth params
          this[msg.key] = msg.value;
          if (msg.key === 'bpm') {
            this.updateStepTiming();
          }
        }
        break;
      case 'noteOn':
        this.triggerNote(msg.note + this.transpose, false, msg.accent || false);
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
    const clampedMidi = Math.max(12, Math.min(84, midi));
    const f = this.midiToFreq(clampedMidi);
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
      const curP = this.patterns[this.currentPattern] || this.patterns[0];
      const len = (curP && curP.endStep) ? curP.endStep : 16;

      this.currentStep++;
      if (this.currentStep >= len) {
        this.currentStep = 0;
        // If in TRACK PLAY mode, advance to next bar in track chain
        if (this.trackMode) {
          const trk = this.tracks[this.currentTrack];
          if (trk && trk.bars && trk.bars.length > 0) {
            this.currentBar++;
            const maxBars = Math.min(trk.len || trk.bars.length, trk.bars.length);
            if (this.currentBar >= maxBars) {
              const loopBar = (trk.dsBar >= 0 && trk.dsBar < maxBars) ? trk.dsBar : 0;
              this.currentBar = loopBar;
            }
            const barSpec = trk.bars[this.currentBar] || trk.bars[0];
            this.currentPattern = Math.max(0, Math.min(this.patterns.length - 1, barSpec[0]));
            this.trackTranspose = barSpec[1] || 0;
            this.updateStepTiming();
          }
        }
      }

      const p = this.patterns[this.currentPattern] || this.patterns[0];
      const stepArr = p.steps[this.currentStep] || p.steps[0];
      const note = stepArr[0];
      const acc = !!stepArr[1];
      const sld = !!stepArr[2];

      if (note >= 0) {
        this.triggerNote(note + this.transpose + this.trackTranspose, sld, acc);
      } else {
        this.gateOn = false;
      }

      // Notify main thread for UI LED sync
      this.port.postMessage({
        type: 'step',
        step: this.currentStep,
        pattern: this.currentPattern,
        bar: this.currentBar,
        accent: acc && note >= 0
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
    const baseDecaySec = 0.20 + this.decay * 1.80;
    const decaySec = this.currentAccent ? Math.min(baseDecaySec, 0.20) : baseDecaySec;
    const envDecayCoef = Math.exp(-1 / (decaySec * this.sampleRate));
    const vcaDecayCoef = Math.exp(-1 / (0.25 * this.sampleRate));

    // Base cutoff: 35 Hz to 5000 Hz (#607: was 2400, the filter never really opened)
    const minCut = 35;
    const maxCut = 5000;
    const baseCutoff = minCut * Math.pow(maxCut / minCut, this.cutoff);

    // TB-03 Overdrive & Delay constants
    const odAmount = this.overdrive;
    const odDrive = 1.0 + odAmount * 14.0;
    const odMakeup = 1.0 / (1.0 + odAmount * 0.65);
    const targetDelaySamples = (0.020 + this.delayTime * 0.580) * this.sampleRate;
    const fbGain = this.delayFeedback * 0.90;
    const delayWet = (this.delayFeedback < 0.01 && this.delayTime < 0.01)
      ? 0.0
      : Math.min(0.65, Math.max(this.delayFeedback * 0.72, this.delayTime > 0.02 ? 0.28 : 0.0));

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
        rawOsc = (2.0 * this.phase) - 1.0;
        rawOsc -= this.polyBlep(this.phase, dt);
      } else {
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
      const k = this.resonance * 3.85;
      const f = Math.tan((Math.PI * targetCutoff) / (this.sampleRate * 2));
      const g = f / (1.0 + f);

      // #607 both passes take the same oscillator sample (real 2x oversampling). Before, pass 2 was fed pass 1's
      // output, so the 'oversampling' was two ladders in series, and any input gain compounded and blew up.
      let sig = rawOsc;
      const xin = rawOsc * (1.0 + k * 0.5);   // #607 input boost against the ladder's level loss as resonance rises (half of it, so the 303 bass thinning stays)
      for (let os = 0; os < 2; os++) {
        const fb = Math.tanh(k * this.s4);
        const u = xin - fb;

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
      let outSig = sig * amp * this.makeup;   // #607 was x 0.8; makeup calibrated so the default patch sits near a mastered track's level

      // High-Pass DC-Blocker (15 Hz)
      const dcAlpha = 0.998;
      this.dcOut = outSig - this.dcIn + dcAlpha * this.dcOut;
      this.dcIn = outSig;

      // Gemini_acid: TB-03 Overdrive stage
      let postOd = this.dcOut;
      if (odAmount > 0.005) {
        const x = postOd * odDrive;
        const sat = Math.tanh(x + 0.14 * x * x) - 0.11;
        postOd = postOd * (1.0 - odAmount) + sat * odMakeup * odAmount * 1.35;
      }

      // Gemini_acid: TB-03 Tape / Digital Delay stage
      this.smoothDelay += (targetDelaySamples - this.smoothDelay) * 0.0012;
      const readPos = this.delayWrite - this.smoothDelay;
      const rInt = Math.floor(readPos);
      const frac = readPos - rInt;
      const idx0 = rInt & this.delayMask;
      const idx1 = (rInt + 1) & this.delayMask;
      const delayed = this.delayBuf[idx0] + frac * (this.delayBuf[idx1] - this.delayBuf[idx0]);

      // Warm bandpass filter in feedback path (~3.2 kHz LP + DC block)
      this.delayLp += 0.32 * (delayed - this.delayLp);
      const fbSig = this.delayLp - this.delayDcIn + 0.995 * this.delayDcOut;
      this.delayDcIn = this.delayLp;
      this.delayDcOut = fbSig;

      this.delayBuf[this.delayWrite] = Math.tanh(postOd + fbSig * fbGain);
      this.delayWrite = (this.delayWrite + 1) & this.delayMask;

      let finalSig = postOd + delayed * delayWet;
      // #607 soft safety stage: untouched below 0.7, rounds off above it, never past 1.0
      const ax = Math.abs(finalSig);
      if (ax > 0.7) finalSig = Math.sign(finalSig) * (0.7 + 0.3 * Math.tanh((ax - 0.7) / 0.3));

      // Output to stereo buffers
      outL[i] = finalSig;
      outR[i] = finalSig;
    }

    return true;
  }
}

AcidWorkletProcessor.PARAMS = new Set(['bpm', 'tuning', 'cutoff', 'resonance', 'envMod', 'decay', 'accent', 'overdrive', 'delayTime', 'delayFeedback', 'waveform', 'transpose']);
registerProcessor('vire-acid', AcidWorkletProcessor);
