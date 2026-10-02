// Rekordbox / Rekopy XML -> tracks, playlists, records (A/B pairs).
// Pairing rule (CLAUDE.md #19): suffix in the Rekordbox title.
//   "Ray of Light_a"   -> side A
//   "Ray of Light_b_s" -> side B, split file (vocal L / instrumental R)
// Tracks sharing the same base title pair into one record. No suffix = one-sided record.

const SUFFIX = /^(.*?)_([ab])(_s)?\s*$/i;

export function parseTitle(name) {
  const raw = (name || '').trim();
  const m = raw.match(SUFFIX);
  if (!m) return { title: raw, side: null, split: false };
  return { title: m[1].trim(), side: m[2].toUpperCase(), split: !!m[3] };
}

function num(v, d = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : d; }

// resolve(location) -> { url } | { opfs } | null. Default: relative Rekopy paths only.
const defaultResolve = loc => (/^file:/i.test(loc) ? null : { url: loc });

export function parseLibrary(xmlText, resolve = defaultResolve) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML parse error');

  const tracks = new Map();
  for (const t of doc.querySelectorAll('COLLECTION > TRACK')) {
    const id = t.getAttribute('TrackID');
    const loc = t.getAttribute('Location') || '';
    const src = resolve(loc);
    const nm = parseTitle(t.getAttribute('Name'));
    // #116 (owner): Rekordbox beat grids (TEMPO) are never read. Beat 1 comes only from the DJ's BEAT 1 tap.
    const cues = [...t.querySelectorAll('POSITION_MARK')]
      .filter(p => p.getAttribute('Num') !== '-1')
      .map(p => ({
        name: p.getAttribute('Name') || '',
        time: num(p.getAttribute('Start')),
        num: num(p.getAttribute('Num')),
        color: p.hasAttribute('Red')
          ? `rgb(${p.getAttribute('Red')},${p.getAttribute('Green')},${p.getAttribute('Blue')})`
          : '#e33',
      }));
    tracks.set(id, {
      id,
      name: t.getAttribute('Name') || '',
      title: nm.title,
      side: nm.side,
      split: nm.split,
      artist: t.getAttribute('Artist') || '',
      album: t.getAttribute('Album') || '',
      genre: t.getAttribute('Genre') || '',
      key: t.getAttribute('Tonality') || '',
      bpm: num(t.getAttribute('AverageBpm')),   // fallback only: the file's ID3 BPM replaces it when read (#102)
      duration: num(t.getAttribute('TotalTime')),
      location: loc,
      url: src && src.url || null,        // Rekordbox locations are already percent-encoded
      opfs: src && src.opfs || null,      // path inside the headset's imported library
      missing: !src,
      cues,
    });
  }

  // Records: group by base title (case-insensitive).
  const byKey = new Map();
  const records = [];
  for (const t of tracks.values()) {
    if (!t.side) {
      const r = { id: 'r' + t.id, title: t.title, sides: { A: t, B: null } };
      records.push(r); t.record = r;
      continue;
    }
    const key = t.title.toLowerCase();
    let r = byKey.get(key);
    if (!r) { r = { id: 'p' + t.id, title: t.title, sides: { A: null, B: null } }; byKey.set(key, r); records.push(r); }
    if (!r.sides[t.side]) r.sides[t.side] = t;   // first wins on duplicates
    t.record = r;
  }
  for (const r of records) {
    const main = r.sides.A || r.sides.B;
    r.artist = main.artist; r.genre = main.genre; r.key = main.key; r.bpm = main.bpm;
    r.duration = main.duration;
    r.missing = !((r.sides.A && !r.sides.A.missing) || (r.sides.B && !r.sides.B.missing));
    r.paired = !!(r.sides.A && r.sides.B);
  }

  // Playlists (leaf nodes only), in XML order, with folder path.
  const playlists = [];
  const walk = (node, path) => {
    for (const n of node.children) {
      if (n.tagName !== 'NODE') continue;
      const name = n.getAttribute('Name');
      if (n.getAttribute('Type') === '0') { walk(n, name === 'ROOT' ? path : [...path, name]); continue; }
      const seen = new Set(); const recs = [];
      for (const k of n.querySelectorAll(':scope > TRACK')) {
        const t = tracks.get(k.getAttribute('Key'));
        if (t && t.record && !seen.has(t.record)) { seen.add(t.record); recs.push(t.record); }
      }
      playlists.push({ name, path: [...path, name].join(' > '), records: recs });
    }
  };
  const root = doc.querySelector('PLAYLISTS > NODE');
  if (root) walk(root, []);
  const all = records.slice().sort((a, b) => (a.missing - b.missing) || a.title.localeCompare(b.title));
  for (const p of playlists) p.records.sort((a, b) => a.missing - b.missing); // stable: keeps playlist order
  playlists.unshift({ name: 'Collection', path: 'Collection', records: all });

  return { tracks, records, playlists };
}

// #222 songs imported into the headset without a Rekordbox XML (or not in it): an 'Unsorted' playlist, also added to
// the Collection. Records are made the same way (a '_A' / '_B' file-name suffix pairs two sides); titles come from
// the file name until the ID3 tags are read (main.js scanUnsorted fills title, artist, BPM, key).
const AUDIO = /\.(mp3|m4a|aac|wav|aiff?|flac|ogg)$/i;
export function emptyLibrary() { return { tracks: new Map(), records: [], playlists: [{ name: 'Collection', path: 'Collection', records: [] }] }; }
export function addUnsorted(lib, index) {
  const used = new Set(); for (const t of lib.tracks.values()) if (t.opfs) used.add(t.opfs);
  const recs = [], byKey = new Map(); let n = 0;
  for (const f of index) {
    if (!AUDIO.test(f.path) || used.has(f.path)) continue;
    const base = f.path.split('/').pop().replace(/\.[^.]+$/, ''), nm = parseTitle(base), id = 'u' + (n++);
    const t = { id, name: base, title: nm.title, side: nm.side, split: nm.split, artist: '', album: '', genre: '', key: '', bpm: 0, duration: 0,
      location: f.path, url: null, opfs: f.path, missing: false, cues: [], unsorted: true };
    lib.tracks.set(id, t);
    let r;
    if (!t.side) { r = { id: 'r' + id, title: t.title, sides: { A: t, B: null } }; recs.push(r); }
    else {
      const k = t.title.toLowerCase(); r = byKey.get(k);
      if (!r) { r = { id: 'p' + id, title: t.title, sides: { A: null, B: null } }; byKey.set(k, r); recs.push(r); }
      if (r.sides[t.side]) continue; r.sides[t.side] = t;
    }
    t.record = r;
  }
  if (!recs.length) return 0;
  for (const r of recs) {
    const main = r.sides.A || r.sides.B;
    r.artist = main.artist; r.genre = ''; r.key = ''; r.bpm = 0; r.duration = 0; r.missing = false; r.paired = !!(r.sides.A && r.sides.B); r.unsorted = true;
  }
  recs.sort((a, b) => a.title.localeCompare(b.title));
  lib.records.push(...recs);
  const all = lib.playlists[0]; all.records.push(...recs); all.records.sort((a, b) => (a.missing - b.missing) || a.title.localeCompare(b.title));
  lib.playlists.splice(1, 0, { name: 'Unsorted', path: 'Unsorted (on this headset)', records: recs });
  return recs.length;
}
