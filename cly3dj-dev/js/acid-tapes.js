// #693 DIRROACID factory micro-cassettes: whole Goa / psy acid phrases (owner: the #619 one-bar loops sounded ordinary).
// Each side is a multi-bar phrase: a few 16-step bars (12 = triplet bar) chained like a TB-03 TRACK, usually
// A A' A turnaround, with its own sound and a filter curve over the phrase (cut: offset per chain bar, added on top
// of the CUTOFF knob, so the line opens and closes by itself while you still ride the knob).
// Steps are scale degrees of the tape's scale: 'r' rest, a number = degree (7 = octave up, -1 = the note below the
// root), '!' accent, '~' slide (303 meaning: hold this note into the next one and glide there), '-' tie (hold the
// previous note on through this step). Side B = the breakdown / alternate take of the same tune.
const SCALES = {
  phr: [0, 1, 3, 5, 7, 8, 10],        // Phrygian: the Goa staple (b2 tension)
  phrdom: [0, 1, 4, 5, 7, 8, 10],     // Phrygian dominant: the 'eastern' major third
  hmin: [0, 2, 3, 5, 7, 8, 11],       // harmonic minor: Astral Projection style leading tone
  min: [0, 2, 3, 5, 7, 8, 10],        // natural minor
  dhm: [0, 1, 4, 5, 7, 8, 11],        // double harmonic: temple / snake-charmer colour
};
const SCALE_NAME = { phr: 'Phrygian', phrdom: 'Phr. Dom', hmin: 'Harm. Minor', min: 'Minor', dhm: 'Dbl Harm.' };
const NOTE = { D: 38, E: 40, 'F#': 42, G: 43, A: 45 };
function degNote(root, sc, d) { const s = SCALES[sc], o = Math.floor(d / 7); return root + s[((d % 7) + 7) % 7] + 12 * o; }
function parseBar(str, root, sc) {
  const out = [];
  for (const t of str.trim().split(/\s+/)) {
    if (t === 'r') { out.push([-1, 0, 0]); continue; }
    if (t === '-') {   // tie: hold the previous note through this step
      const p = out[out.length - 1]; if (!p || p[0] < 0) throw new Error('acid tape: tie after a rest');
      p[2] = 1; out.push([p[0], 0, 0]); continue;
    }
    const m = /^(-?\d+)([!~]*)$/.exec(t); if (!m) throw new Error('acid tape step ' + t);
    out.push([degNote(root, sc, +m[1]), m[2].includes('!') ? 1 : 0, m[2].includes('~') ? 1 : 0]);
  }
  if (out.length !== 16 && out.length !== 12) throw new Error(`acid tape bar has ${out.length} steps: ${str}`);
  return out;
}
// sound: panel values 0..1; dly = delay division 0..7 (1/16, 1/8T, 1/16., 1/8, 1/4T, 1/8., 1/4, 1/4.)
const snd = (cutoff, reso, envMod, decay, accent, overdrive, dly, delayFeedback, waveform = 0) =>
  ({ cutoff, reso, envMod, decay, accent, overdrive, delayTime: dly / 7, delayFeedback, waveform, tuning: 0.5 });
const LEAD = (c = 0.38, od = 0.5) => snd(c, 0.9, 0.85, 0.36, 0.85, od, 5, 0.34);
const DARK = (c = 0.3) => snd(c, 0.92, 0.7, 0.5, 0.8, 0.35, 5, 0.55);
const ROLL = (c = 0.32) => snd(c, 0.62, 0.5, 0.18, 0.55, 0.25, 0, 0.1);
const UP = [-0.1, -0.02, 0.05, 0.15], WAVE = [-0.06, 0.08, -0.02, 0.14], LOW = [-0.2, -0.1, -0.14, -0.02], FLAT = [0, 0, 0, 0.06];
// generated phrases: a short motif run straight across the bar lines (3 or 5 against 16 = the hypnotic Goa rotation)
function rotate(motif, steps, deco) { const a = []; for (let i = 0; i < steps; i++) a.push(deco ? deco(motif[i % motif.length], i) : motif[i % motif.length]); return a; }
const bars16 = arr => { const out = []; for (let i = 0; i < arr.length; i += 16) out.push(arr.slice(i, i + 16).join(' ')); return out; };
function arpBars(chordRoots, shape, density = 1) {   // one bar per chord root (scale degree), the shape in scale steps above it
  return chordRoots.map(c => shape.map((s, i) => (density > 1 && i % density) ? 'r' : `${c + s}${i % 4 === 0 ? '!' : ''}`).join(' '));
}
const ARP = [0, 2, 4, 7, 2, 4, 7, 9, 4, 7, 9, 11, 7, 4, 2, 0];
const DEF = [
  { name: 'Anjuna Acid Squelch', key: 'E', oct: 1, sc: 'phr', bpm: 145, tag: 'SQUELCH',
    A: { bars: ['0! 0 7~ 0 0 1 0 7! 0 0 7~ 8 0 0 1~ 0', '0! 0 7~ 0 0 1 0 7! 0 3 2~ 1 0 7 6~ 7', '0! 7 0 7~ 8 7 5~ 4 3! 1 0 1~ 3 4 5~ 7!'], chain: [0, 1, 0, 2], sound: LEAD(0.36), cut: UP },
    B: { bars: ['0! - - 7~ 8 - r r 0! - 1~ 0 r r 7~ 8', '7! - 5~ 4 - r 3 r 1! - 0~ 1 - r r r'], chain: [0, 1, 0, 1], sound: DARK(), cut: LOW } },
  { name: 'Vagator Roller', key: 'F#', oct: 0, sc: 'phr', bpm: 145, tag: 'ROLLING BASS',
    A: { bars: ['r 0 0 0! r 0 0 0 r 0 0 0! r 0 7 0', 'r 0 0 0! r 0 0 0 r 0 0 1! r 1 0~ -1', 'r 0 7 0! r 0 7 0 r 0 7 0! r 7 8~ 7'], chain: [0, 1, 0, 2], sound: ROLL(), cut: [-0.04, 0, 0.04, 0.1] },
    B: { bars: ['r 7 0 0 r 7 0 0 r 7 0 0 r 7 0 0', 'r 7 0 0 r 7 0 1~ 0 7 0 0 r 7 8~ 7'], chain: [0, 0, 0, 1], sound: ROLL(0.26), cut: LOW } },
  { name: 'Arambol Gallop', key: 'E', oct: 1, sc: 'phrdom', bpm: 146, tag: 'GALLOP',
    A: { bars: ['0! 0 r 0 7 0 r 0 0! 0 r 1 2~ 1 r 0', '0! 0 r 0 7 0 r 0 0! 0 r 4 5~ 4 2 1', '7! 7 r 8 7 5 r 4 2! 1 r 0 1~ 2 4 5~'], chain: [0, 1, 0, 2], sound: LEAD(0.4, 0.45), cut: WAVE },
    B: { bars: ['0! r r 0 r r 0 r 7! r r 7 r r 8~ 7', '0! r r 1 r r 2 r 4! r r 5 r r 7~ 8'], chain: [0, 1, 0, 1], sound: DARK(0.34), cut: LOW } },
  { name: 'Chapora Phrygian Arp', key: 'E', oct: 1, sc: 'phr', bpm: 140, tag: 'ARP',
    A: { bars: arpBars([0, 1, -2, 0], ARP).slice(0, 3).concat(['0! 2 4 7 9 11 14 11 9 7 4 2 1! 0 1~ 0']), chain: [0, 1, 2, 3], sound: snd(0.46, 0.8, 0.66, 0.28, 0.7, 0.3, 5, 0.32), cut: WAVE },
    B: { bars: arpBars([0, 1, -2, 0], ARP, 2), chain: [0, 1, 2, 3], sound: snd(0.4, 0.84, 0.6, 0.42, 0.7, 0.2, 6, 0.55), cut: LOW } },
  { name: 'Hilltop 3/4 Spiral', key: 'G', oct: 1, sc: 'hmin', bpm: 143, tag: 'ARP 3/4',
    A: { bars: bars16(rotate([0, 4, 7], 64, (d, i) => { const g = Math.floor(i / 3), b = [0, 0, 1, -1][Math.floor(g / 5) % 4]; return `${b + d}${i % 3 === 2 ? '!' : ''}${i % 12 === 4 ? '~' : ''}`; })), chain: [0, 1, 2, 3], sound: snd(0.44, 0.86, 0.72, 0.3, 0.8, 0.35, 4, 0.3), cut: UP },
    B: { bars: bars16(rotate([0, 4, 7], 64, (d, i) => { const g = Math.floor(i / 3), b = [0, 0, 1, -1][Math.floor(g / 5) % 4]; return (i % 3 === 0 && g % 2) ? 'r' : `${b + d + (i % 3 === 2 ? 7 : 0)}${i % 3 === 2 ? '!' : ''}`; })), chain: [0, 1, 2, 3], sound: DARK(0.34), cut: LOW } },
  { name: 'Shiva Octaves', key: 'D', oct: 1, sc: 'min', bpm: 140, tag: 'OCTAVES',
    A: { bars: ['0! 7 0 7 0 7~ 8 7 0! 7 0 7 3 10~ 9 7', '0! 7 0 7 0 7~ 8 7 5! 12 5 12 4 11~ 10 8', '0! 7 0 7 -1 6 -1 6 -2! 5 -2 5 -3 4~ 5~ 7!'], chain: [0, 1, 0, 2], sound: LEAD(0.34, 0.4), cut: UP },
    B: { bars: ['0! - 7~ - 0 r 7 r 0! - 8~ - 7 r r r', '5! - 12~ - 4 r 11 r 3! - 10~ - 7 r r r'], chain: [0, 1, 0, 1], sound: DARK(0.3), cut: LOW } },
  { name: 'Full Moon Up-Down', key: 'A', oct: 1, sc: 'phr', bpm: 138, tag: 'SWEEP ARP',
    A: { bars: ['0! 1 2 3 4! 5 6 7 8! 9 10 11 12! 13 14 13', '12! 11 10 9 8! 7 6 5 4! 3 2 1 0! 1~ 0 -1', '0! 2 4 6 8! 10 12 14 12! 10 8 6 4! 2 0 2', '4! 3 2 1 0! -1 0 1 0! r 7~ 8 7! r 0~ 0'], chain: [0, 1, 2, 3], sound: snd(0.44, 0.82, 0.64, 0.26, 0.7, 0.25, 5, 0.32), cut: WAVE },
    B: { bars: ['0! r 2 r 4! r 6 r 8! r 10 r 12! r 14 r', '12! r 10 r 8! r 6 r 4! r 2 r 0! r 1~ 0'], chain: [0, 1, 0, 1], sound: snd(0.38, 0.86, 0.56, 0.4, 0.65, 0.15, 6, 0.55), cut: LOW } },
  { name: 'Baga Sunrise Lead', key: 'E', oct: 1, sc: 'phrdom', bpm: 144, tag: 'LEAD',
    A: { bars: ['7! - - 8~ 7 - 4 - 5! - 4~ 2 1 - 0 -', '4! - 5~ 7 8~ 7 5 - 4! - 2~ 1 2 - r r', '7! - - 8~ 7 - 4 - 5! - 7~ 8 9 - 11~ 12', '11! - 9~ 8 7 - 5 4~ 2! - 1 - 0 - - r'], chain: [0, 1, 2, 3], sound: snd(0.48, 0.84, 0.72, 0.45, 0.78, 0.4, 5, 0.42), cut: UP },
    B: { bars: ['7! 7 r 8 7 r 4 4 5! 5 r 4 2 r 1 0', '4! 4 r 5 7 r 8 7 4! 4 r 2 1 r 0 r'], chain: [0, 1, 0, 1], sound: LEAD(0.4, 0.4), cut: WAVE } },
  { name: 'Palolem Triplet Pulse', key: 'F#', oct: 1, sc: 'hmin', bpm: 142, tag: 'TRIPLET',
    A: { bars: ['0! 0 7 0! 0 8 0! 0 7 0! 1 0', '0! 0 7 0! 0 8 0! 2 4 5! 4 2', '7! 6 5 4! 3 2 1! 0 -1 0! 1~ 0'], chain: [0, 1, 0, 2], sound: snd(0.36, 0.74, 0.62, 0.24, 0.75, 0.35, 1, 0.22), cut: WAVE },
    B: { bars: ['0! r 7 r 0 r 8! r 7 r 1 r', '0! r 7 r 4 r 5! r 4 r 2~ 1'], chain: [0, 1, 0, 1], sound: snd(0.32, 0.78, 0.55, 0.34, 0.7, 0.2, 4, 0.48), cut: LOW } },
  { name: 'Morjim Minor Arp', key: 'D', oct: 1, sc: 'hmin', bpm: 141, tag: 'CHORD ARP',
    A: { bars: arpBars([0, 5, 3, 4], ARP), chain: [0, 1, 2, 3], sound: snd(0.46, 0.8, 0.66, 0.27, 0.72, 0.28, 5, 0.32), cut: UP },
    B: { bars: arpBars([0, 5, 3, 4], ARP, 2), chain: [0, 1, 2, 3], sound: snd(0.4, 0.84, 0.58, 0.4, 0.68, 0.2, 6, 0.52), cut: LOW } },
  { name: 'Ashvem Acid Ladder', key: 'G', oct: 1, sc: 'phr', bpm: 145, tag: 'SQUELCH',
    A: { bars: ['0! 1~ 2 3~ 4 5~ 6 7~ 7! 6~ 5 4~ 3 2~ 1 0~', '0! 0 7~ 0 1! 1 8~ 1 2! 2 9~ 2 1! 1 8~ 7', '0! 7 14~ 7 0! 7 13~ 6 0! 7 12~ 5 0! 7~ 8~ 7!'], chain: [0, 1, 0, 2], sound: LEAD(0.4, 0.55), cut: UP },
    B: { bars: ['0! - 1~ - 2 - 3~ - 4! - 5~ - 6 - 7~ -', '7! - 6~ - 5 - 4~ - 3! - 2~ - 1 - 0~ -'], chain: [0, 1, 0, 1], sound: DARK(0.32), cut: LOW } },
  { name: 'Mandrem Hypnotic Five', key: 'E', oct: 1, sc: 'min', bpm: 143, tag: 'ARP 5/16',
    A: { bars: bars16(rotate([0, 3, 7, 3, 8], 64, (d, i) => i >= 60 ? ['10~', '8', '7!', '3'][i - 60] : `${d}${i % 5 === 2 ? '!' : ''}`)), chain: [0, 1, 2, 3], sound: snd(0.44, 0.82, 0.62, 0.26, 0.72, 0.3, 4, 0.3), cut: WAVE },
    B: { bars: bars16(rotate([0, 7, 3, 10, 7], 64, (d, i) => (i % 5 === 1 ? 'r' : `${d}${i % 5 === 3 ? '!' : ''}`))), chain: [0, 1, 2, 3], sound: DARK(0.34), cut: LOW } },
  { name: 'Rubber Band Bounce', key: 'A', oct: 1, sc: 'phr', bpm: 147, tag: 'SLIDES',
    A: { bars: ['0! 7~ 0 7~ 0 - 7~ 0 0! 8~ 0 7~ 0 - 5~ 7', '0! 7~ 0 7~ 0 - 7~ 0 0! 1~ 0 -1~ 0 - 3~ 4'], chain: [0, 1, 0, 1], sound: LEAD(0.38, 0.5), cut: WAVE },
    B: { bars: ['0! - - - 7~ - - - 0 - - - 8~ - 7 -'], chain: [0, 0, 0, 0], sound: DARK(0.34), cut: [-0.22, -0.12, -0.04, 0.06] } },
  { name: 'Dark Forest Phrygian', key: 'F#', oct: 0, sc: 'phr', bpm: 148, tag: 'DARK PSY',
    A: { bars: ['0! 0 1 0 0! 0 3~ 1 0! 0 1 0 -2~ -1 0 1', '0! 0 1 0 0! 0 3~ 4 5! 4 3 1 0~ -1 -2 -3'], chain: [0, 0, 0, 1], sound: snd(0.3, 0.9, 0.78, 0.22, 0.85, 0.6, 3, 0.25), cut: UP },
    B: { bars: ['0! r 1 r 0! r 3~ 1 r r r r -2~ -1 r r'], chain: [0, 0, 0, 0], sound: DARK(0.26), cut: LOW } },
  { name: 'Temple Bells', key: 'E', oct: 1, sc: 'dhm', bpm: 142, tag: 'EASTERN LEAD',
    A: { bars: ['7! 8 11 12 11! 8 7 4 5! 4 1 0 1! 4 5 7', '8! 7 4 5 4! 1 0 -1 0! 1 4 5 7! 8~ 7 -'], chain: [0, 1, 0, 1], sound: snd(0.5, 0.8, 0.66, 0.34, 0.72, 0.3, 5, 0.4), cut: WAVE },
    B: { bars: ['7! r 11 r 11! r 7 r 5! r 1 r 1! r 5 r', '8! r 4 r 4! r 0 r 0! r 4 r 7! 8~ 7 -'], chain: [0, 1, 0, 1], sound: snd(0.42, 0.84, 0.56, 0.48, 0.7, 0.2, 6, 0.55), cut: LOW } },
  { name: 'Sunrise Peak Squelch', key: 'D', oct: 1, sc: 'phr', bpm: 146, tag: 'PEAK',
    A: { bars: ['0! 0 0 7! 0 0 8~ 7 0! 0 0 10! 0 0 8~ 7', '0! 0 0 7! 0 0 8~ 7 3! 3 3 10! 1 1 8~ 7', '12! 10 8 7! 5 3 1 0! 1~ 3 1~ 0 7! 8~ 10 12!'], chain: [0, 1, 0, 2], sound: LEAD(0.36, 0.6), cut: [-0.12, 0, 0.08, 0.2] },
    B: { bars: ['0! r 0 r 0 r 8~ 7 0! r 0 r 0 r 8~ 7', '3! r 3 r 1 r 8~ 7 0! r 0 r 7! 8~ 10 r'], chain: [0, 0, 0, 1], sound: DARK(0.3), cut: LOW } },
];
export const FACTORY_TAPES = DEF.map((d, i) => {
  const root = NOTE[d.key] + 12 * d.oct;
  const side = s => {
    const patterns = s.bars.map(b => { const steps = parseBar(b, root, d.sc), n = steps.length; while (steps.length < 16) steps.push([-1, 0, 0]); return { steps, endStep: n, triplet: n === 12 ? 1 : 0 }; });
    return { patterns, chain: s.chain, sound: s.sound, cut: s.cut };
  };
  return { id: 'g' + (i + 1), factory: true, name: d.name, bpm: d.bpm, key: `${d.key} ${SCALE_NAME[d.sc]}`, tag: d.tag, A: side(d.A), B: side(d.B) };
});
