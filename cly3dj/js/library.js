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
  // #544 hand / AI-written XMLs often carry a bare '&' in a title ('Simon & Garfunkel'): escape it instead of failing the whole library
  xmlText = String(xmlText).replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, '&amp;');
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
  // gemini_neon 2026-11-19: infer unsuffixed tracks as Side A when a matching *_b / *_b_s track exists
  const byKey = new Map();
  const records = [];
  const hasBSide = new Set();
  for (const t of tracks.values()) if (t.side === 'B') hasBSide.add(t.title.toLowerCase());
  for (const t of tracks.values()) {
    const key = t.title.toLowerCase();
    const effSide = t.side || (hasBSide.has(key) ? 'A' : null);
    if (!effSide) {
      const r = { id: 'r' + t.id, title: t.title, sides: { A: t, B: null } };
      records.push(r); t.record = r;
      continue;
    }
    let r = byKey.get(key);
    if (!r) { r = { id: 'p' + t.id, title: t.title, sides: { A: null, B: null } }; byKey.set(key, r); records.push(r); }
    if (!r.sides[effSide]) r.sides[effSide] = t;   // first wins on duplicates
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

// gemini_neon 2026-11-19: auto-pair *_b / *_b_s audio files in Collection (PC or Quest OPFS) onto existing XML A-side records
// Matches by: (1) leading TrackID ("132137352 - ..._b.mp3" -> TrackID="132137352"), (2) exact A-side filename stem, or (3) base title.
export function attachSideBFiles(lib, entries) {
  if (!lib || !entries || !entries.length) return 0;
  const usedLoc = new Set();
  for (const t of lib.tracks.values()) {
    if (t.opfs) usedLoc.add(t.opfs.toLowerCase());
    if (t.url) usedLoc.add(t.url.toLowerCase());
  }
  const stemOf = p => {
    const fn = decodeURIComponent(String(p || '')).replace(/\\/g, '/').split('/').pop() || '';
    return fn.replace(/\.[^.]+$/, '').trim();
  };
  const byStem = new Map(), byTitle = new Map();
  for (const r of lib.records) {
    const a = r.sides && r.sides.A;
    if (!a || r.sides.B) continue;
    const st = stemOf(a.opfs || a.location).replace(/_a$/i, '').trim().toLowerCase();
    if (st && !byStem.has(st)) byStem.set(st, r);
    const tk = (a.title || r.title || '').trim().toLowerCase();
    if (tk && !byTitle.has(tk)) byTitle.set(tk, r);
  }
  let added = 0;
  for (const ent of entries) {
    const p = ent.opfs || ent.path || '';
    if (!/_b(_s)?\.(mp3|m4a|aac|wav|aiff?|flac|ogg)$/i.test(p)) continue;
    if ((ent.opfs && usedLoc.has(ent.opfs.toLowerCase())) || (ent.url && usedLoc.has(ent.url.toLowerCase()))) continue;
    const rawStem = stemOf(p), m = rawStem.match(SUFFIX);
    if (!m || m[2].toUpperCase() !== 'B') continue;
    const baseStem = m[1].trim(), split = !!m[3];
    const idm = /^(\d+)\s*-\s*(.*)$/.exec(baseStem);
    let r = null;
    if (idm) {
      const a = lib.tracks.get(idm[1]);
      if (a && a.record && !a.record.sides.B) r = a.record;
    }
    if (!r) r = byStem.get(baseStem.toLowerCase()) || null;
    if (!r && idm) r = byTitle.get(idm[2].trim().toLowerCase()) || null;
    if (!r) r = byTitle.get(baseStem.toLowerCase()) || null;
    if (!r || r.sides.B) continue;
    const a = r.sides.A;
    const id = 'sb_' + (a ? a.id : added);
    const bt = {
      id,
      name: `${r.title}${split ? '_b_s' : '_b'}`,
      title: r.title,
      side: 'B',
      split,
      artist: a ? a.artist : '',
      album: a ? a.album : '',
      genre: a ? a.genre : '',
      key: a ? a.key : '',
      bpm: a ? a.bpm : 0,
      duration: 0,
      location: p,
      url: ent.url || null,
      opfs: ent.opfs || null,
      missing: !(ent.url || ent.opfs),
      cues: [],
      record: r,
    };
    lib.tracks.set(id, bt);
    r.sides.B = bt;
    r.paired = !!(r.sides.A && r.sides.B);
    r.missing = !((r.sides.A && !r.sides.A.missing) || (r.sides.B && !r.sides.B.missing));
    added++;
  }
  return added;
}
