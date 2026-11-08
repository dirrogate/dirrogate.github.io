// #619 DIRROACID factory micro-cassettes: arpeggiated / rolling layers for Goa and psychedelic trance, plus TB-03 bank
// patches. Each tape has side A and side B (B = a breakdown or variant), each side its own sound. Steps are written as
// scale degrees: 'r' rest, a number = degree of the tape's scale (7 = octave up, -1 = the 7th below), '!' accent,
// '~' slide into the next note. Notes come out as MIDI for the TB-03 worklet: [note, accent, slide].
const SCALES = {
  phr: [0, 1, 3, 5, 7, 8, 10],        // Phrygian (the Goa / psy staple)
  phrdom: [0, 1, 4, 5, 7, 8, 10],     // Phrygian dominant (the 'eastern' major 3rd)
  hmin: [0, 2, 3, 5, 7, 8, 11],       // harmonic minor
  min: [0, 2, 3, 5, 7, 8, 10],        // natural minor
};
const SCALE_NAME = { phr: 'Phrygian', phrdom: 'Phr. Dom', hmin: 'Harm. Minor', min: 'Minor' };
const ROOTS = { D: 38, E: 40, 'F#': 42, G: 43, A: 45 };   // the TB-03's low octave
function degNote(root, sc, d) { const s = SCALES[sc], o = Math.floor(d / 7); return root + s[((d % 7) + 7) % 7] + 12 * o; }
function parse(str, root, sc) {
  return str.trim().split(/\s+/).map(t => {
    if (t[0] === 'r') return [-1, 0, 0];
    const m = /^(-?\d+)([!~]*)$/.exec(t); if (!m) throw new Error('acid tape step ' + t);
    return [degNote(root, sc, +m[1]), m[2].includes('!') ? 1 : 0, m[2].includes('~') ? 1 : 0];
  });
}
// sound: the TB-03 panel values (0..1). dly = delay division index 0..7 (1/16, 1/8T, 1/16., 1/8, 1/4T, 1/8., 1/4, 1/4.)
const snd = (cutoff, reso, envMod, decay, accent, overdrive, dly, delayFeedback, waveform = 0) =>
  ({ cutoff, reso, envMod, decay, accent, overdrive, delayTime: dly / 7, delayFeedback, waveform, tuning: 0.5 });
const DEF = [
  // name, key, scale, bpm, tag, side A steps, A sound, side B steps, B sound, triplet
  ['Anjuna Acid Squelch', 'E', 'phr', 142, 'SQUELCH',
    '0! 0 7~ 0 1 0 8!~ 0 r 0 3 1~ 0 7 8!~ 0', snd(0.42, 0.88, 0.82, 0.32, 0.8, 0.45, 5, 0.35),
    '0! r r 0 r r 7~ r 0! r r 1 r r 8~ r', snd(0.34, 0.9, 0.7, 0.45, 0.8, 0.35, 5, 0.58)],
  ['Vagator Roller', 'F#', 'phr', 145, 'ROLLING BASS',
    'r 0 0 0 r 0 0 0 r 0 0 0 r 0 0 7', snd(0.3, 0.55, 0.45, 0.18, 0.5, 0.2, 0, 0.1),
    'r 0 7 0 r 0 7 0 r 0 7 0 r 0 7 8', snd(0.36, 0.62, 0.55, 0.2, 0.5, 0.25, 0, 0.12)],
  ['Arambol Gallop', 'E', 'phrdom', 146, 'GALLOP',
    'r 0 0 r r 0 0 r r 1 1 r r 0 0 r', snd(0.33, 0.6, 0.5, 0.2, 0.55, 0.25, 3, 0.15),
    'r 0 r 7 r 0 r 7 r 1 r 8 r 0 r 7', snd(0.4, 0.7, 0.6, 0.25, 0.6, 0.3, 5, 0.3)],
  ['Chapora Phrygian Arp', 'E', 'phr', 140, 'ARP',
    '0 2 4 7 1 4 5 8 2 4 6 9 7 4 2 1', snd(0.5, 0.7, 0.6, 0.3, 0.6, 0.2, 5, 0.32),
    '0 r 4 r 7 r 4 r 1 r 5 r 8 r 5 r', snd(0.44, 0.75, 0.55, 0.4, 0.6, 0.15, 5, 0.6)],
  ['Hilltop 3/4 Spiral', 'G', 'hmin', 143, 'ARP 3/4',
    '0 4 7! 0 4 7! 0 4 7! 0 4 7! 0 4 7! 0', snd(0.46, 0.78, 0.66, 0.28, 0.75, 0.3, 4, 0.3),
    '0 7~ 11 0 7~ 11 0 7~ 11 0 7~ 11 0 7~ 11 0', snd(0.52, 0.82, 0.7, 0.3, 0.7, 0.35, 4, 0.42)],
  ['Shiva Octaves', 'D', 'min', 140, 'OCTAVES',
    '0 7 0 7 0 7 1 8 0 7 0 7 5! 12 4 11', snd(0.38, 0.66, 0.58, 0.24, 0.65, 0.3, 3, 0.2),
    '0 r 7 r 0 r 7 r 0 r 7 r 1 r 8 r', snd(0.32, 0.7, 0.5, 0.35, 0.6, 0.2, 5, 0.5)],
  ['Full Moon Up-Down', 'A', 'phr', 138, 'ARP',
    '0 1 2 4 7 8 9 11 14 11 9 8 7 4 2 1', snd(0.48, 0.72, 0.62, 0.26, 0.6, 0.2, 5, 0.3),
    '0 r 2 r 4 r 7 r 9 r 7 r 4 r 2 r', snd(0.4, 0.76, 0.55, 0.38, 0.6, 0.15, 6, 0.55)],
  ['Baga Sunrise Lead', 'E', 'phrdom', 144, 'LEAD',
    '7! 7~ 8 7~ 4 r 2 1~ 0! r 0 1~ 2 4~ 7! r', snd(0.5, 0.84, 0.75, 0.34, 0.78, 0.4, 5, 0.38),
    '7! r r 8~ r r 4 r 0! r r 1~ r r 2 r', snd(0.42, 0.86, 0.68, 0.5, 0.75, 0.3, 5, 0.6)],
  ['Palolem Triplet Pulse', 'F#', 'hmin', 142, 'TRIPLET',
    '0! 0 7 0! 0 8 0! 0 7 0! 1 0', snd(0.36, 0.64, 0.56, 0.22, 0.7, 0.3, 1, 0.2),
    '0! r 7 r 0! r 8 r 0! r 1 r', snd(0.32, 0.68, 0.5, 0.32, 0.65, 0.2, 4, 0.45), true],
  ['Morjim Minor Arp', 'D', 'hmin', 141, 'ARP',
    '0 2 4 6! 4 2 0 6! 1 3 5 7! 5 3 1 7!', snd(0.47, 0.74, 0.64, 0.27, 0.7, 0.25, 5, 0.3),
    '0 r 4 r 6 r 4 r 1 r 5 r 7 r 5 r', snd(0.4, 0.78, 0.56, 0.4, 0.65, 0.2, 6, 0.52)],
  ['Ashvem Acid Ladder', 'G', 'phr', 145, 'SQUELCH',
    '0 1~ 2 3~ 4 5~ 6 7~ 7! 6~ 5 4~ 3 2~ 1 0~', snd(0.44, 0.9, 0.85, 0.3, 0.82, 0.5, 3, 0.25),
    '0 r 2 r 4 r 6 r 7! r 5 r 3 r 1 r', snd(0.38, 0.9, 0.75, 0.42, 0.8, 0.4, 5, 0.5)],
  ['Mandrem Hypnotic Five', 'E', 'min', 143, 'ARP 5/4',
    '0 3 7! 3 8 0 3 7! 3 8 0 3 7! 3 8 0', snd(0.45, 0.76, 0.6, 0.25, 0.7, 0.25, 4, 0.28),
    '0 r 7 r 8 0 r 7 r 8 0 r 7 r 8 r', snd(0.4, 0.8, 0.55, 0.36, 0.65, 0.2, 5, 0.5)],
];
// TB-03 bank patches as tapes (side A / B = two neighbouring patterns), the panel's default sound
const BANK = [['TB-03 Patch 1-01 / 1-02', 0, 1], ['TB-03 Patch 1-05 / 1-06', 4, 5], ['TB-03 Patch 1-11 / 1-12', 10, 11],
  ['TB-03 Patch 2-03 / 2-04', 26, 27], ['TB-03 Patch 2-05 / 2-06', 28, 29], ['TB-03 Patch 3-01 / 3-02', 48, 49], ['TB-03 Patch 3-09 / 3-12', 56, 59]];
const BANK_SND = snd(0.35, 0.65, 0.7, 0.4, 0.6, 0.25, 5, 0.3);
export const FACTORY_TAPES = [
  ...DEF.map(([name, key, sc, bpm, tag, a, sa, b, sb, trip], i) => {
    const side = (str, sound) => { const steps = parse(str, ROOTS[key], sc); const n = steps.length; while (steps.length < 16) steps.push([-1, 0, 0]);
      return { pattern: { steps, endStep: n, triplet: trip ? 1 : 0 }, sound }; };
    return { id: 'f' + (i + 1), factory: true, name, bpm, key: `${key} ${SCALE_NAME[sc]}`, tag, A: side(a, sa), B: side(b, sb) };
  }),
  ...BANK.map(([name, a, b], i) => ({ id: 'b' + (i + 1), factory: true, name, bpm: 138, key: '', tag: 'TB-03 BANK', A: { bank: a, sound: BANK_SND }, B: { bank: b, sound: BANK_SND } })),
];
