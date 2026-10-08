// SpatialED #46 Spatial Story, step 1 (spatial-story-plan.md): an RP45 = a bed (the soundtrack, 4 to 7 minutes) plus
// actor lanes (Dirro, Mira) whose takes (head, hands, fingers, voice) are recorded in the stage's own space while the
// bed and the earlier takes play. Stored on this headset next to the Spatial Records:
//   SpatialVinyl/<story>/<name>.story.json   { v: 1, kind: 'spatial-story', name, story, bed, mix, lanes: [ { id, actor,
//                                              glb, mark: [x, z, yaw], muted, takes: [ { id, t0, dur, voice, motion,
//                                              lips, pc } ] } ] }
//   SpatialVinyl/<story>/<name>.bed.<ext>    the bed as picked
//   SpatialVinyl/<story>/<name>.<lane><take>.mp3   each take's voice (mono 96 kbps; Rhubarb's input on the PC)
//   SpatialVinyl/<story>/<name>.mix.wav      the working mix: bed + every take's voice at its time (what the deck plays)
// <name> = <story>_<n>; the RP45 is a 7" pressing (src kind 'story') in the story's crate list.
import { saveTakeFile, readTakeFile, removeTakeFile, hasTakeFile, wavBlob, encodeMp3, seriesOf } from './take.js';

export const RP45_MIN = 4 * 60, RP45_MAX = 7 * 60;
export const ACTORS = [   // story actors for now (owner): Dirro and Mira; GLB paths relative to the lesson folder
  { name: 'DIRRO', glb: '../../models/avatar/DirrogateAvatar_face.glb' },
  { name: 'MIRA', glb: '../../models/avatar/Mira_face.glb' },
];
export const actorOf = name => ACTORS.find(a => a.name === name) || ACTORS[0];

export async function storyRead(name) { try { return JSON.parse(await (await readTakeFile(name + '.story.json')).text()); } catch { return null; } }
export async function storyWrite(st) { await saveTakeFile(st.name + '.story.json', JSON.stringify(st)); }
export function storyNew(name) { return { v: 1, kind: 'spatial-story', name, story: seriesOf(name), made: Date.now(), bed: null, mix: null, lanes: [] }; }

// the side the lesson player draws: one puppet actor per unmuted lane, its takes by reference (lips arriving later
// show up without reloading)
export function storySide(st) {
  return { version: 1, title: st.name, persist: false, board: false, credits: '',
    stage: { position: [0, 0, -2.0], rotationY: 0, scale: 1, plinth: 1.7 },
    actors: st.lanes.filter(l => !l.muted).map(l => ({ glb: l.glb, face: true, pose: 'relaxed', puppet: true, lane: l.id, mark: l.mark, takes: l.takes })) };
}

const decodeCtx = () => new OfflineAudioContext(2, 1, 48000);
export async function decodeBlob(blob) { return decodeCtx().decodeAudioData(await blob.arrayBuffer()); }

// the working mix: the bed with every unmuted take's voice placed at its t0; WAV (stereo 48 kHz) so it is quick to make
export async function rebuildMix(st, onProgress) {
  if (!st.bed) return null;
  const bed = await decodeBlob(await readTakeFile(st.bed.file)), R = 48000, len = Math.ceil(bed.duration * R);
  const ac = new OfflineAudioContext(2, len, R);
  const add = (buf, at, gain) => { const s = ac.createBufferSource(), g = ac.createGain(); s.buffer = buf; g.gain.value = gain; s.connect(g).connect(ac.destination); s.start(Math.max(0, at)); };
  add(bed, 0, 1);
  for (const l of st.lanes) if (!l.muted) for (const k of l.takes) {
    try { add(await decodeBlob(await readTakeFile(k.voice)), k.t0, 1); } catch (e) { console.warn('story mix: voice', k.voice, e); }
  }
  onProgress && onProgress('Mixing…');
  const out = await ac.startRendering(), L = out.getChannelData(0), Rr = out.getChannelData(1), pcm = new Int16Array(out.length * 2);
  for (let i = 0; i < out.length; i++) { pcm[2 * i] = Math.max(-32768, Math.min(32767, L[i] * 32767)); pcm[2 * i + 1] = Math.max(-32768, Math.min(32767, Rr[i] * 32767)); }
  st.mix = st.name + '.mix.wav';
  await saveTakeFile(st.mix, wavBlob(pcm, 2, R));
  return st.mix;
}

// a finished take into a lane: voice -> MP3, motion kept in the story file; the lane's mark follows its first take
export async function addTake(st, lane, R, t0) {
  const n = 1 + lane.takes.reduce((m, k) => Math.max(m, +String(k.id).slice(1) || 0), 0), id = 'T' + n;
  const voice = `${st.name}.${lane.id}${id}.mp3`;
  await saveTakeFile(voice, new Blob([await encodeMp3(R.pcm.voice, 1, R.pcm.rate, 96)], { type: 'audio/mpeg' }));
  const take = { id, t0: Math.round(t0 * 1000) / 1000, dur: Math.round(R.duration * 1000) / 1000, voice, motion: R.motion, lips: null, pc: null };
  // takes on one lane don't overlap: a new one replaces what it covers
  lane.takes = lane.takes.filter(k => k.t0 + k.dur <= take.t0 || k.t0 >= take.t0 + take.dur).concat(take).sort((a, b) => a.t0 - b.t0);
  const f = R.motion.frames && R.motion.frames[0];
  if (f && lane.takes[0] === take) {   // stand where the take starts, facing where the head faced (the view is -z of the head)
    const [x, y, z, w] = f.h.slice(3), fx = -2 * (x * z + w * y), fz = -(1 - 2 * (x * x + y * y));
    lane.mark = [f.h[0], f.h[2], Math.atan2(fx, fz)];
  }
  return take;
}
export async function removeTake(st, lane, take) {
  lane.takes = lane.takes.filter(k => k !== take);
  await removeTakeFile(take.voice);
}
// every RP45 on this headset: [{ name, story }]
export async function storyList() {
  const out = [];
  try {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('SpatialVinyl', { create: true });
    for await (const [, h] of root.entries()) if (h.kind === 'directory') for await (const [n] of h.entries()) if (/\.story\.json$/.test(n)) { const name = n.replace(/\.story\.json$/, ''); out.push({ name, story: seriesOf(name) }); }
  } catch {}
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
export function storyLength(st) { return st.bed ? st.bed.duration : 0; }
export { seriesOf };
