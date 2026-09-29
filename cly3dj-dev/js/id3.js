// Minimal ID3v2.2/2.3/2.4 reader: returns { title, artist, bpm, picture: Blob|null }. bpm = TBPM (#102), 0 if none.
// Only reads what the labels need. Must be called before decodeAudioData (which detaches the buffer).

function syncsafe(b, o) { return (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3]; }
function be32(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }

function unsync(bytes) {
  const out = new Uint8Array(bytes.length); let j = 0;
  for (let i = 0; i < bytes.length; i++) { out[j++] = bytes[i]; if (bytes[i] === 0xff && bytes[i + 1] === 0) i++; }
  return out.subarray(0, j);
}

function decodeText(enc, bytes) {
  try {
    if (enc === 0) return new TextDecoder('latin1').decode(bytes);
    if (enc === 1) return new TextDecoder('utf-16').decode(bytes);
    if (enc === 2) return new TextDecoder('utf-16be').decode(bytes);
    return new TextDecoder('utf-8').decode(bytes);
  } catch { return ''; }
}

function skipString(enc, b, o) {
  if (enc === 1 || enc === 2) { while (o + 1 < b.length && (b[o] || b[o + 1])) o += 2; return o + 2; }
  while (o < b.length && b[o]) o++; return o + 1;
}

export function readID3(arrayBuffer) {
  const res = { title: '', artist: '', bpm: 0, key: '', picture: null };
  const b = new Uint8Array(arrayBuffer);
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return res;
  const ver = b[3], flags = b[5];
  const size = syncsafe(b, 6);
  let tag = b.subarray(10, Math.min(b.length, 10 + size));
  if ((flags & 0x80) && ver < 4) tag = unsync(tag);
  let o = 0;
  if (flags & 0x40) o += ver === 4 ? syncsafe(tag, 0) : be32(tag, 0) + 4; // extended header
  const idLen = ver === 2 ? 3 : 4, hdrLen = ver === 2 ? 6 : 10;
  let bestPic = null, bestType = -1;
  while (o + hdrLen <= tag.length) {
    const id = String.fromCharCode(...tag.subarray(o, o + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let fsize = ver === 2 ? (tag[o + 3] << 16) | (tag[o + 4] << 8) | tag[o + 5]
      : ver === 4 ? syncsafe(tag, o + 4) : be32(tag, o + 4);
    const fflags = ver === 2 ? 0 : tag[o + 9];
    let data = tag.subarray(o + hdrLen, o + hdrLen + fsize);
    o += hdrLen + fsize;
    if (fsize <= 0) continue;
    if (ver === 4 && (fflags & 0x02)) data = unsync(data);
    if (ver === 4 && (fflags & 0x01)) data = data.subarray(4);
    if (id === 'TIT2' || id === 'TT2') res.title = decodeText(data[0], data.subarray(1)).replace(/\0+$/, '');
    else if (id === 'TBPM' || id === 'TBP') {   // #102: the file's own BPM has priority over Rekordbox
      const v = parseFloat(decodeText(data[0], data.subarray(1)).replace(/\0+$/, '').replace(',', '.'));
      if (v >= 40 && v <= 250) res.bpm = v;
    }
    else if (id === 'TKEY' || id === 'TKE') res.key = decodeText(data[0], data.subarray(1)).replace(/\0+$/, '').trim();   // #116: initial key
    else if (id === 'TPE1' || id === 'TP1') res.artist = decodeText(data[0], data.subarray(1)).replace(/\0+$/, '');
    else if (id === 'APIC' || id === 'PIC') {
      const enc = data[0]; let p = 1, mime;
      if (id === 'PIC') { const f = String.fromCharCode(...data.subarray(1, 4)).toLowerCase(); mime = f === 'png' ? 'image/png' : 'image/jpeg'; p = 4; }
      else { let e = p; while (e < data.length && data[e]) e++; mime = new TextDecoder('latin1').decode(data.subarray(p, e)) || 'image/jpeg'; p = e + 1; }
      const type = data[p]; p++;
      p = skipString(enc, data, p);
      if (!mime.includes('/')) mime = 'image/' + mime.toLowerCase().replace('jpg', 'jpeg');
      const score = type === 3 ? 10 : type === 0 ? 5 : 1; // prefer front cover
      if (score > bestType) { bestType = score; bestPic = new Blob([data.slice(p)], { type: mime }); }
    }
  }
  res.picture = bestPic;
  return res;
}
