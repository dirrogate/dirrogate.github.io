// Two turntables in one AudioWorkletProcessor, so SYNC phase maths sees both playheads
// at the same sample. Output 0 = deck A (stereo), output 1 = deck B (stereo).
//
// Turntable physics (CLAUDE.md #120). Each deck is two spinning bodies, stepped once per audio sample:
//   platter (+ rotor magnet)  <- motor servo torque, electronic brake, bearing friction, cogging, a finger on the rim
//   record (+ slipmat)        <- slipmat friction against the platter (sticks or slips), the hand, stylus drag
// The sound's playback rate is the RECORD's angular speed / 33 1/3 rpm, so holding the record stops the music
// while the platter keeps turning underneath, letting go lets the mat pull it back up to speed, and a hard press
// drags on the motor. The motor is a speed servo modelled on the SL-1200MK2's quartz PLL (KAB cogging study,
// owner's PDF, 27 Sep): P on speed error + I on angle error, the angle term limited to half a frequency-generator
// pulse (91 per rev), torque limited to the starting torque. So a load under ~0.09 N m leaves no speed error once
// the servo has caught up (~0.3 s), bigger loads pull the speed down, and anything past ~0.15 N m stalls it.
// 'legacy' keeps the pre-#120 kinematic model (fixed ramps) for side-by-side comparison.

const PAN_K = 1 - Math.exp(-1 / (0.012 * sampleRate));   // #254 pan smoothing per sample
const REV_PER_SEC = (100 / 3) / 60;
const W33 = 2 * Math.PI * REV_PER_SEC;   // rad/s at 33 1/3 rpm = rate 1
const W45 = W33 * 1.35;
const GRAV = 9.81;
const NEEDLE_TAU = 0.006;
const DRAG_K = 1 / (0.02 * sampleRate);   // spread a hand move over ~20 ms
// #320 the stylus + phono stage. A moving-magnet cartridge puts out a voltage proportional to the groove's VELOCITY,
// and the groove was cut with the RIAA pre-emphasis (lows cut ~20 dB, highs boosted) that the preamp's RIAA
// de-emphasis undoes, exactly, only at the speed it was cut at. Move the record at another speed (back-cueing, a
// scratch, a nudge, a start / stop) and every frequency lands somewhere else on the RIAA curve: the output is
// rate x E(f) x D(rate f). So a slowly rocked kick comes out as the fat, boomy thump of real vinyl, not the thin,
// level-constant sound of plain resampling. Built as three first-order sections at the output rate whose time
// constants slide with the rate; at the speed the deck is set to (incl. the pitch fader) they cancel exactly.
const RIAA_T = [3180e-6, 75e-6, 318e-6];   // the two de-emphasis poles and its zero (s)
const BIL_K = 2 * sampleRate;

// ---- legacy (pre-#120) constants
const ACCEL = 6.0, BRAKE = 2.2, WINDUP = 1.2, COAST = 0.14;
const HAND_TAU = 0.004, TOUCH_TAU = 0.45, TOUCH_GRIP = 0.03;

// ---- motor / platter profiles. Numbers: Technics spec sheets + KAB measurements; see CLAUDE.md findings (27 Sep).
// I: platter + rotor inertia (kg m^2). classic: set so 0.147 N m (tapering 15 % toward 45 rpm) reaches 33 1/3 in
// the spec's 0.7 s; 0.024 = a ~1.8 kg die-cast platter (MK2: 2.0 kg with the rubber mat, which a slipmat replaces).
// ki x phiMax = 0.12 N m = the spec's 0.09 N m of extra load with no speed change + the running drag.
// modern: MK7 1.8 kg incl. slipmat; coreless (no cogging), digital control ramps the start over 0.7 s. Its servo
// gains are estimates (Technics does not publish them): stiffer than the MK2's.
// visc: motor/electrical + bearing oil drag per rad/s. Not measured: set so a power-off coast from 33 1/3 with a
// 180 g record and the needle down still takes ~7 s (#48). bearing: KAB gram-gauge value, 1.5 g at 6 in.
const PROFILES = {
  classic: { I: 0.024, tau0: 0.147, taper: 0.15, kp: 0.50, ki: 3.5, phiMax: Math.PI / 91, cog: 0.0028, cogN: 48,
             bearing: 0.0022, visc: 0.0077, slew: 0 },
  modern:  { I: 0.0245, tau0: 0.180, taper: 0.0, kp: 0.80, ki: 6.0, phiMax: 0.024, cog: 0, cogN: 48,
             bearing: 0.0018, visc: 0.0074, slew: W33 / 0.7 },
};
// slipmat against the platter (static / kinetic friction). Estimates: felt on a slipsheet is slick, bare felt on
// the aluminium drags, a rubber mat grips (scratching then drags the platter against the motor).
const MATS = { slick: { muS: 0.24, muK: 0.18 }, felt: { muS: 0.45, muK: 0.35 }, rubber: { muS: 1.5, muK: 1.2 } };
const MAT_MASS = 0.025, REC_R = 0.1508, HOLE_R = 0.0036;
const R_EFF = 2 / 3 * REC_R;       // mean friction radius of a full-disc contact
const R_PLATTER = 0.166;
const RIM_NUDGE_GAIN = 0.5;        // #272 rim nudge strength (1 = finger speed fully)
const STYLUS_DRAG = 0.0012;        // N m: ~4 g tracking force, groove friction ~0.3, ~0.1 m radius
const MU_FINGER = 0.6;             // skin on the platter's dotted rim
const HAND_DOWN = 2.0;             // N: a DJ's hand pressing on the record while holding / scratching
const HAND_HZ = 60;                // hand-to-record coupling stiffness (critically damped)
const HAND_LOOKAHEAD = 0.03;       // s: dead-reckon the hand between video-frame messages, at most this far
const BRAKE_KNEE = 0.08 * W33;     // electronic brake: full torque above this speed, proportional below
const BRAKE_OFF = 0.005 * W33;     // brake releases here; the platter is then free (spin it by hand)
// Brake strength as a share of the motor's torque limit. The MK2 service manual only says "electronic brake";
// reviews of the 1200 family put STOP-to-standstill at ~0.7-0.8 s, so this is set to land in that range.
const BRAKE_GAIN = 0.8;

class Deck {
  constructor() {
    this.L = null; this.R = null; this.len = 0; this.srcRate = sampleRate;
    this.pos = 0; this.rate = 0; this.motorOn = false; this.speed = 1; this.pitch = 0; this.power = true;
    this.lastRev = 0; this.tick = 0;
    this.holding = false; this.handRate = 0;
    this.touch = false; this.touchRate = 0; this.touchF = 0.35;
    this.nudgeE = 0; this.nudgeLeft = 0;
    this.needle = false; this.needleGain = 0;
    this.pan = 0; this.panS = 0; this.split = false;
    this.wobble = 0; this.wobPh = 0;   // #260 a 45 off-centre on the bare spindle: rate x (1 + wobble cos(record angle - wobPh))   // #254 panS: the pan eased toward pan (~12 ms), so a jump never clicks
    this.lastLevel = 0;
    // needle dragged across the vinyl (CLAUDE.md #61)
    this.drag = false; this.dragPending = 0; this.dragAcc = 0; this.gps = 0; this.click = 0; this.hp = 0; this.nz = 0;
    this.rz = new Float64Array(12);   // #320 cartridge / RIAA sections: per channel 3 x (x1, y1)
    this.shiftPending = 0; this.spinPend = 0; this.spinW = 0;   // #319 spindle twist: platter angle still to turn (rad), the speed it is adding now
    // physics state
    this.model = 'classic'; this.P = PROFILES.classic; this.mat = MATS.slick; this.pll = false;
    this.recMass = 0.18;
    this.wp = 0; this.wr = 0; this.thp = 0; this.thr = 0; this.phi = 0; this.refCur = 0;
    this.hasRec = false; this.stuck = false; this.slipDir = 1; this.braking = false; this.starting = false;
    this.handOn = false; this.handAng = 0; this.handW = 0; this.handAge = 0; this.handOff = 0;
    this.grip = 50;   // N m: far above any real finger, so the record never slides under a tracked hand (the hand is the truth in VR)
    this.quietPhi = 0; this.wasDisturbed = false; this.load = 0; this.matT = 0;
    this.setRecord(0.18);
  }
  setRecord(mass, R = REC_R, holeR = HOLE_R) {   // #261 R / holeR: a 7" single is smaller, with a big hole
    this.recMass = mass;
    const m = mass + MAT_MASS;
    this.Ir = 0.5 * mass * (R * R + holeR * holeR) + 0.5 * MAT_MASS * 0.15 * 0.15;
    this.mTot = m;
    const k = this.Ir * Math.pow(2 * Math.PI * HAND_HZ, 2);
    this.kHand = k; this.cHand = 2 * Math.sqrt(k * this.Ir);
  }
  sample(ch, p) {
    // 4-point cubic Hermite on Int16 data
    const a = ch; const i = Math.floor(p); const f = p - i;
    const n = this.len - 1;
    const xm1 = a[i > 0 ? i - 1 : 0], x0 = a[i], x1 = a[i < n ? i + 1 : n], x2 = a[i + 1 < n ? i + 2 : n];
    const c = (x1 - xm1) * 0.5, v = x0 - x1, w = c + v, aa = w + v + (x2 - x0) * 0.5, bb = w + aa;
    return ((((aa * f) - bb) * f + c) * f + x0) * (1 / 32768);
  }

  // ---- one audio sample of turntable physics. Returns the record's rate (1 = 33 1/3 rpm).
  step(dt, handK, touchK) {
    if (this.model === 'legacy') return this.stepLegacy(dt, handK, touchK);
    const P = this.P, Ip = P.I;
    // #319 spindle twist: the fingers carry the platter (and a record gripping the mat) round by the twisted angle,
    // spread over ~20 ms, as an extra speed on top of whatever the platter is doing. The servo sees the platter run
    // fast (or slow) and pushes back; with PLL memory off the lost / won phase stays, as on a real deck.
    if (this.spinW) { this.wp -= this.spinW; if (this.spinRec) this.wr -= this.spinW; this.spinW = 0; }
    if (this.spinPend) {
      const take = this.spinPend * DRAG_K; this.spinPend -= take; if (Math.abs(this.spinPend) < 1e-6) this.spinPend = 0;
      this.spinW = take / dt; this.spinRec = this.hasRec && this.stuck; this.wp += this.spinW; if (this.spinRec) this.wr += this.spinW;
    }
    // motor servo
    const on = this.motorOn && this.power;
    const lim = P.tau0 * (1 - P.taper * Math.min(1, Math.abs(this.wp) / W45));
    let tm = 0;
    if (on) {
      let refT = this.speed * (1 + this.pitch) * W33;
      if (this.nudgeLeft > 0) { refT *= 1 + this.nudgeE; if (--this.nudgeLeft === 0) this.nudgeE = 0; }
      if (P.slew && this.starting) {   // modern: the digital control ramps a START over 0.7 s
        const s = P.slew * dt, e = refT - this.refCur; this.refCur += e > s ? s : e < -s ? -s : e;
        if (this.refCur === refT) this.starting = false;
      } else { this.refCur = refT; this.starting = false; }
      const e = this.refCur - this.wp;
      // angle term, limited to half an FG pulse; it only winds up while the motor has torque to spare, so a
      // start from standstill locks in without a big overshoot
      const u0 = P.kp * e + P.ki * this.phi;
      if (!this.starting && !((u0 >= lim && e > 0) || (u0 <= -lim && e < 0))) {
        let phi = this.phi + e * dt;
        if (phi > P.phiMax) phi = P.phiMax; else if (phi < -P.phiMax) phi = -P.phiMax;
        this.phi = phi;
      }
      tm = P.kp * e + P.ki * this.phi;
      if (tm > lim) tm = lim; else if (tm < -lim) tm = -lim;
      this.braking = false;
    } else {
      this.phi = 0; this.refCur = this.wp;
      if (this.nudgeLeft > 0) { this.nudgeLeft = 0; this.nudgeE = 0; }
      if (this.braking && this.power) {
        const a = Math.abs(this.wp);
        if (a < BRAKE_OFF) this.braking = false;
        else tm = -Math.sign(this.wp) * lim * BRAKE_GAIN * Math.min(1, a / BRAKE_KNEE);
      }
    }
    this.load = tm / P.tau0;
    // platter: cogging detents (iron-cored motor only), bearing (Coulomb, smoothed at standstill) + drag
    const tCog = -P.cog * Math.sin(P.cogN * this.thp);
    let tp = tm + tCog - P.bearing * Math.tanh(this.wp / 0.02) - P.visc * this.wp;
    if (this.touch) {   // finger on the rim: friction pulls the platter edge toward the finger's speed
      // #272 (owner: a nudge moved the record twice as far as wanted): the finger counts for half its speed
      // difference from the motor's speed, so a push or a drag shifts the beat half as much
      const ref = on ? this.refCur : this.wp, fw = ref + RIM_NUDGE_GAIN * (this.touchRate * W33 - ref);
      const vrel = (fw - this.wp) * R_PLATTER;
      tp += MU_FINGER * this.touchF * Math.tanh(vrel / 0.02) * R_PLATTER;
    }
    let disturbed = this.touch;
    if (!this.hasRec) {
      this.wp += tp / Ip * dt; this.wr = this.wp; this.matT = 0;
    } else {
      const Ir = this.Ir;
      let tr = -STYLUS_DRAG * this.needleGain * Math.tanh(this.wr / 0.05);
      if (this.handOn) {   // the hand holds / moves the record through a stiff spring, limited by grip
        const tgt = this.handAng + this.handOff + this.handW * Math.min(this.handAge, HAND_LOOKAHEAD);
        this.handAge += dt;
        let th = this.kHand * (tgt - this.thr) + this.cHand * (this.handW - this.wr);
        if (th > this.grip) { this.handOff -= (th - this.grip) / this.kHand; th = this.grip; }        // the record slides under the fingers
        else if (th < -this.grip) { this.handOff -= (th + this.grip) / this.kHand; th = -this.grip; }
        tr += th; disturbed = true;
      }
      const N = this.mTot * GRAV + (this.handOn ? HAND_DOWN : 0);
      const Ts = this.mat.muS * N * R_EFF, Tk = this.mat.muK * N * R_EFF;
      if (this.stuck) {
        const a = (tp + tr) / (Ip + Ir), need = Ir * a - tr;   // torque the mat must pass to the record
        if (Math.abs(need) <= Ts) { this.wp += a * dt; this.wr = this.wp; this.matT = need; }
        else { this.stuck = false; this.slipDir = need > 0 ? 1 : -1; }
      }
      if (!this.stuck) {
        const rel = this.wp - this.wr;
        const dir = rel > 1e-9 ? 1 : rel < -1e-9 ? -1 : this.slipDir;
        const mt = dir * Tk;
        this.wp += (tp - mt) / Ip * dt; this.wr += (tr + mt) / Ir * dt; this.matT = mt;
        const nrel = this.wp - this.wr;
        if ((dir > 0 && nrel <= 0) || (dir < 0 && nrel >= 0)) {   // relative motion stopped: they grip again
          const w = (Ip * this.wp + Ir * this.wr) / (Ip + Ir); this.wp = this.wr = w; this.stuck = true;
        } else this.slipDir = dir;
        disturbed = true;
      }
    }
    // PLL phase memory (option, off by default): the angle term keeps what a touch cost and wins it back after.
    // Off: once the hands are off and the record grips again, the angle term returns to its quiet value, like a
    // PLL that has slipped cycles; the speed still recovers either way.
    if (on && !this.pll) {
      if (disturbed || this.shiftPending || this.spinW) this.wasDisturbed = true;
      else {
        if (this.wasDisturbed) { this.phi = this.quietPhi; this.wasDisturbed = false; }
        this.quietPhi += (this.phi - this.quietPhi) * 2e-4;
      }
    } else if (!on) { this.quietPhi = 0; this.wasDisturbed = false; }
    // static friction: a nearly stopped, untouched platter comes to rest instead of creeping, unless the cogging
    // detent pulls harder than the bearing holds (then it rocks into the detent and stops there, as KAB describes)
    if (!tm && !this.touch && !this.handOn && !this.spinW && (!this.hasRec || this.stuck) && Math.abs(this.wp) < 0.004 && Math.abs(tCog) <= P.bearing) {
      this.wp = 0; this.wr = 0;
    }
    this.thp += this.wp * dt; this.thr += this.wr * dt;
    return this.wr / W33;
  }

  // pre-#120 behaviour, unchanged: the record rate IS the platter speed, fixed ramps
  stepLegacy(dt, handK, touchK) {
    if (this.holding) this.rate += (this.handRate - this.rate) * handK;
    else if (this.touch) {
      const motor = this.motorOn ? this.speed * (1 + this.pitch) : this.rate;
      const target = motor + TOUCH_GRIP * (this.touchRate - motor);
      this.rate += (target - this.rate) * touchK;
    } else {
      const on = this.motorOn && this.power;
      const target = on ? this.speed * (1 + this.pitch) : 0;
      const step = (target > this.rate ? (this.windUp ? WINDUP : ACCEL) : (on ? ACCEL : this.power ? BRAKE : COAST)) * dt;
      if (Math.abs(target - this.rate) <= step) { this.rate = target; this.windUp = false; }
      else this.rate += Math.sign(target - this.rate) * step;
    }
    let r = this.rate;
    if (this.nudgeLeft > 0) { r *= 1 + this.nudgeE; if (--this.nudgeLeft === 0) this.nudgeE = 0; }
    this.wp = this.wr = r * W33; this.thp += this.wp * dt; this.thr = this.thp; this.load = 0; this.matT = 0; this.stuck = true;
    return r;
  }
}

class Decks extends AudioWorkletProcessor {
  constructor() {
    super();
    this.d = [new Deck(), new Deck()];
    this.frame = 0;
    this.port.onmessage = (e) => this.onMsg(e.data);
  }

  onMsg(m) {
    if (m.type === 'physics') { for (const d of (m.deck == null ? this.d : [this.d[m.deck]])) this.setPhysics(d, m); return; }
    const d = this.d[m.deck];
    switch (m.type) {
      case 'load':
        d.L = m.L; d.R = m.R; d.len = m.L.length; d.srcRate = m.rate;
        d.split = !!m.split; d.pos = m.startFrame || 0; d.needle = false; d.needleGain = 0;
        d.nudgeE = 0; d.nudgeLeft = 0; d.shiftPending = 0; d.spinPend = 0;
        d.hasRec = true;
        break;
      case 'unload':
        d.L = d.R = null; d.len = 0; d.pos = 0; d.needle = false;
        break;
      case 'record':   // a record put on / taken off the platter (#120). It lands still; the mat pulls it up to speed.
        d.hasRec = !!m.on; d.handOn = false; d.holding = false;
        if (d.hasRec) { d.is7 = m.size === 7; d.setRecord(d.is7 ? 0.040 : (d.massSetting || 0.18), d.is7 ? 0.0873 : REC_R, d.is7 ? 0.0191 : HOLE_R); }   // #261 a 45 weighs ~40 g
        if (d.hasRec) { d.wr = m.w != null ? m.w * W33 : 0; d.thr = d.thp; d.stuck = Math.abs(d.wr - d.wp) < 1e-6; }
        else { d.wr = d.wp; d.stuck = false; }
        break;
      case 'set':
        if (m.key === 'motorOn' && !m.value && d.motorOn && d.power) d.braking = true;   // STOP: electronic brake
        if (m.key === 'motorOn' && m.value && !d.motorOn) d.starting = true;
        if (m.key === 'power' && !m.value) d.braking = false;
        d[m.key] = m.value;
        break;
      case 'touch':
        d.touch = m.active; d.touchRate = m.rate; if (m.force != null) d.touchF = m.force;
        break;
      case 'hand':
        d.holding = m.holding; d.handRate = m.rate || 0;
        if (m.holding) {
          const w = (m.rate || 0) * W33;
          if (m.ang != null) {
            if (!d.handOn) d.handOff = d.thr - m.ang;   // grab: no jump, the record is held where it is
            d.handAng = m.ang;
          } else { if (!d.handOn) { d.handOff = d.thr; d.handAng = 0; } else d.handAng += d.handW * d.handAge; }
          d.handW = w; d.handAge = 0; d.handOn = true;
          if (m.grip != null) d.grip = m.grip;
        } else {
          d.handOn = false;
          if (m.throwRate !== undefined) { d.rate = m.throwRate; d.wr = m.throwRate * W33; d.stuck = false; }
        }
        break;
      case 'seek':
        if (d.len) d.pos = Math.max(0, Math.min(d.len - 1, m.time * d.srcRate));
        break;
      case 'phase': this.phase(m, m.maxE || 0.08); break;
      case 'shift':   // spindle twist (#105): move the record by m.delta seconds over the mat; the motor keeps running
        // #319 (owner: a real spindle is part of the platter): the twist turns the PLATTER, so the strobe dots, the
        // record (through the mat), the heard speed and the readouts all move with it, and the servo fights it.
        // The legacy model keeps the old record-only shift.
        if (d.model === 'legacy') { if (d.len) d.shiftPending = (d.shiftPending || 0) + m.delta * d.srcRate; }
        else d.spinPend += m.delta * W33;
        break;
      case 'needleDrag':
        if (m.active === true) { d.drag = true; d.dragPending = 0; d.dragAcc = 0; }
        else if (m.active === false) { d.drag = false; d.dragPending = 0; d.dragAcc = 0; }
        if (m.delta && d.drag && d.len) d.dragPending += m.delta * d.srcRate;
        break;
    }
  }

  setPhysics(d, m) {
    if (m.model && (m.model === 'legacy' || PROFILES[m.model])) {
      const was = d.model; d.model = m.model;
      if (m.model !== 'legacy') d.P = PROFILES[m.model];
      if (was === 'legacy' && m.model !== 'legacy') { d.wp = d.wr = d.rate * W33; d.stuck = true; d.phi = 0; d.refCur = d.wp; }
      if (m.model === 'legacy') d.rate = d.wr / W33;
    }
    if (m.mat && MATS[m.mat]) d.mat = MATS[m.mat];
    if (m.recMass) { d.massSetting = m.recMass; if (!d.is7) d.setRecord(m.recMass); }   // #261 a 45 keeps its own weight
    if (m.pll != null) d.pll = !!m.pll;
  }

  // LOCK phase step (#116): nudge-only, to the NEAREST beat. Beat positions come from the DJ's BEAT 1 taps
  // (m.beat1[k], seconds into the file) and each track's BPM (m.bpm[k]); no Rekordbox grid. The lead keeps its
  // phase; the follower's motor runs up to maxE faster/slower for as long as it takes to close the gap (#120: the
  // nudge goes through the motor's reference, whose angle term makes the platter land on it exactly).
  phase(m, maxE) {
    const lead = m.lead, L = this.d[lead], F = this.d[1 - lead];
    const aL = m.beat1[lead], aF = m.beat1[1 - lead], bpmL = m.bpm[lead], bpmF = m.bpm[1 - lead];
    const ok = L.len && F.len && aL != null && aF != null && bpmL > 0 && bpmF > 0 && Math.abs(L.wr / W33) > 0.3 && Math.abs(F.wr / W33) > 0.3 && !F.holding && !F.handOn;
    if (!ok) { this.port.postMessage({ type: 'phaseDone', ok: false }); return; }
    const bL = (L.pos / L.srcRate - aL) * bpmL / 60, bF = (F.pos / F.srcRate - aF) * bpmF / 60;
    let dph = (bL - bF) - Math.floor(bL - bF);       // 0..1
    if (dph >= 0.5) dph -= 1;                          // -0.5..0.5, + means follower is behind
    const eff = bpmF * F.wr / W33;                     // follower beats per minute right now
    let e, T;
    if (Math.abs(dph) <= maxE) { e = dph; T = 60 / eff; }
    else { e = Math.sign(dph) * maxE; T = Math.abs(dph) * 60 / (maxE * eff); }
    F.nudgeE = e; F.nudgeLeft = Math.round(T * sampleRate);
    this.port.postMessage({ type: 'phaseDone', ok: true, offset: dph, seconds: T, follower: 1 - lead, bend: e });
  }

  process(inputs, outputs) {
    const dt = 1 / sampleRate;
    const handK = 1 - Math.exp(-dt / HAND_TAU);
    const touchK = 1 - Math.exp(-dt / TOUCH_TAU);
    const needleK = 1 - Math.exp(-dt / NEEDLE_TAU);
    for (let k = 0; k < 2; k++) {
      const d = this.d[k];
      const out = outputs[k]; const oL = out[0], oR = out[1] || out[0];
      const n = oL.length;
      let peak = 0;
      for (let s = 0; s < n; s++) {
        const r = d.step(dt, handK, touchK);
        if (d.shiftPending) {   // spread over ~20 ms like the needle drag: the record slides over the mat
          const take = d.shiftPending * DRAG_K; d.shiftPending -= take; if (Math.abs(d.shiftPending) < 0.5) d.shiftPending = 0;
          d.pos = Math.max(0, d.pos + take); d.thr += take / d.srcRate * W33;
        }

        d.needleGain += ((d.needle && d.len ? 1 : 0) - d.needleGain) * needleK;
        // Dragged needle: the hand's movement arrives in bursts (one message per video frame), so spread it
        // over ~20 ms. Every groove crossed jumps the playhead one revolution of audio (1.8 s) with a click;
        // fast drags add surface-scrape noise and the music is tracked more weakly.
        let scrape = 0, dragDuck = 1;
        if (d.drag && d.len) {
          const revF = d.srcRate / REV_PER_SEC;
          const take = d.dragPending * DRAG_K; d.dragPending -= take; d.dragAcc += take;
          while (d.dragAcc >= revF) { d.dragAcc -= revF; d.pos = Math.min(d.len + 1, d.pos + revF); d.click = 1; }
          while (d.dragAcc <= -revF) { d.dragAcc += revF; d.pos = Math.max(0, d.pos - revF); d.click = 1; }
          d.gps += (Math.abs(take) / revF * sampleRate - d.gps) * 0.002;        // grooves per second, smoothed
          const amt = Math.min(1, d.gps / 60);
          const w = Math.random() * 2 - 1; d.hp = 0.6 * d.hp + w; d.nz = w - d.hp * 0.4;   // bright noise
          scrape = (d.nz * 0.1 * amt + (Math.random() - 0.5) * d.click * 0.5) * d.needleGain;
          d.click *= 0.93;
          dragDuck = 1 / (1 + d.gps / 40);
        } else d.gps = 0;
        let l = 0, rr = 0;
        if (d.len && d.needleGain > 1e-4 && d.pos >= d.len - 2) {
          // run-out groove: silence, plus the soft click of the locked groove once per revolution
          const rev = Math.floor((d.pos - d.len) / d.srcRate * REV_PER_SEC);
          if (rev !== d.lastRev) { d.lastRev = rev; d.tick = 1; }
          if (d.tick > 0.001) { l = rr = (Math.random() - 0.5) * 0.05 * d.tick * d.needleGain; d.tick *= 0.985; }
        } else if (d.len && d.needleGain > 1e-4) {
          l = d.sample(d.L, d.pos) * d.needleGain;
          rr = d.sample(d.R, d.pos) * d.needleGain;
          {   // #320 velocity cartridge + RIAA at the record's real speed relative to the deck's set speed (no allocations)
            const nom = d.speed * (1 + d.pitch) || 1, rn = r / nom, ar = Math.max(0.01, Math.abs(rn)), g = rn < 0 ? -ar : ar;
            // sections (1 + s a)/(1 + s b), bilinear: y = b0 x + b1 x1 - a1 y1
            const a0 = RIAA_T[0] / ar * BIL_K, c0 = RIAA_T[0] * BIL_K, n0 = 1 / (1 + c0);
            const a1_ = RIAA_T[1] / ar * BIL_K, c1 = RIAA_T[1] * BIL_K, n1 = 1 / (1 + c1);
            const a2 = RIAA_T[2] * BIL_K, c2 = RIAA_T[2] / ar * BIL_K, n2 = 1 / (1 + c2);
            const p0 = (1 + a0) * n0, q0 = (1 - a0) * n0, f0 = (1 - c0) * n0;
            const p1 = (1 + a1_) * n1, q1 = (1 - a1_) * n1, f1 = (1 - c1) * n1;
            const p2 = (1 + a2) * n2, q2 = (1 - a2) * n2, f2 = (1 - c2) * n2;
            const z = d.rz;
            for (let ch = 0; ch < 2; ch++) {
              const o = ch * 6; let x = ch ? rr : l, y;
              y = p0 * x + q0 * z[o] - f0 * z[o + 1]; z[o] = x; z[o + 1] = y; x = y;
              y = p1 * x + q1 * z[o + 2] - f1 * z[o + 3]; z[o + 2] = x; z[o + 3] = y; x = y;
              y = p2 * x + q2 * z[o + 4] - f2 * z[o + 5]; z[o + 4] = x; z[o + 5] = y;
              if (ch) rr = y * g; else l = y * g;
            }
          }
          const p = d.panS += (d.pan - d.panS) * PAN_K;
          const gL = p > 0 ? 1 - p : 1, gR = p < 0 ? 1 + p : 1;
          if (d.split) { const m = l * gL + rr * gR; l = m; rr = m; }
          else { l *= gL; rr *= gR; }
        }
        if (scrape || dragDuck !== 1) { l = l * dragDuck + scrape; rr = rr * dragDuck + scrape; }
        oL[s] = l; oR[s] = rr;
        const a = Math.abs(l) > Math.abs(rr) ? Math.abs(l) : Math.abs(rr);
        if (a > peak) peak = a;
        if (d.len) {
          d.pos += r * d.srcRate * dt * (d.wobble ? 1 + d.wobble * Math.cos(d.thr - d.wobPh) : 1);   // #260 wow
          if (d.pos < 0) d.pos = 0;
          // past the last sample the stylus is in the locked run-out groove: the record keeps turning
          if (d.pos > d.len + d.srcRate * 36000) d.pos = d.len;
        }
      }
      d.lastLevel = peak;
    }
    this.frame += outputs[0][0].length;
    if (this.frame >= sampleRate / 60) {
      this.frame = 0;
      this.port.postMessage({
        type: 'state', time: currentTime,
        decks: this.d.map(d => ({
          pos: d.len ? d.pos / d.srcRate : 0, rate: d.wr / W33, needle: d.needle, nudging: d.nudgeLeft > 0,
          prate: d.wp / W33, pang: d.thp, rang: d.thr, rec: d.hasRec, slip: d.hasRec && !d.stuck ? (d.wp - d.wr) / W33 : 0,
          load: d.load, matT: d.matT, model: d.model,
        })),
      });
    }
    return true;
  }
}

registerProcessor('vire-decks', Decks);

// Master limiter (owner, #111). Replaces the DynamicsCompressorNode, which is not a brick-wall: at 2 ms attack /
// 100 ms release it modulated the gain inside each bass cycle (audible distortion) and still let peaks through
// to the output, where they clipped. This one looks 5 ms ahead, so the gain is already down when a peak
// arrives; holds it for the lookahead; releases slowly (250 ms, slower than any bass cycle); stereo-linked. A
// soft knee just under the ceiling catches anything the smoothing leaves, so the output never exceeds 1.0.
class Limiter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ceil = Math.pow(10, -1 / 20);                  // -1 dBFS
    this.L = Math.max(1, Math.round(0.005 * sampleRate));
    this.buf = [new Float32Array(this.L), new Float32Array(this.L)]; this.w = 0;
    this.held = 1; this.hold = 0; this.g = 1;
    this.attK = 1 - Math.exp(-1 / (this.L / 5));       // reaches the held gain well within the lookahead
    this.relK = 1 - Math.exp(-1 / (0.25 * sampleRate));
    this.gr = 0; this.frame = 0;
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0]; if (!out || !out.length) return true;
    const iL = inp && inp[0], iR = inp && (inp[1] || inp[0]), oL = out[0], oR = out[1] || out[0], n = oL.length;
    const c = this.ceil, K = 0.94, L = this.L, bL = this.buf[0], bR = this.buf[1];
    let minG = 1;
    for (let s = 0; s < n; s++) {
      const xl = iL ? iL[s] : 0, xr = iR ? iR[s] : 0;
      const pk = Math.max(Math.abs(xl), Math.abs(xr)), req = pk > c ? c / pk : 1;
      if (req <= this.held) { this.held = req; this.hold = L; }
      else if (this.hold > 0) this.hold--;
      else this.held += (req - this.held) * this.relK;
      this.g += (this.held - this.g) * (this.held < this.g ? this.attK : this.relK);
      const w = this.w, dl = bL[w], dr = bR[w]; bL[w] = xl; bR[w] = xr; this.w = (w + 1) % L;
      let yl = dl * this.g, yr = dr * this.g;
      const sc = v => { const a = Math.abs(v); if (a <= K) return v; const t = K + (1 - K) * Math.tanh((a - K) / (1 - K)); return v < 0 ? -t : t; };
      oL[s] = sc(yl); if (oR !== oL) oR[s] = sc(yr);
      if (this.g < minG) minG = this.g;
    }
    this.gr = Math.max(-20 * Math.log10(minG), this.gr * 0.95);
    if ((this.frame += n) >= sampleRate / 20) { this.frame = 0; this.port.postMessage({ gr: this.gr }); }
    return true;
  }
}
registerProcessor('vire-limiter', Limiter);
