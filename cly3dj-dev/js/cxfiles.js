// #522 DirroComics files: a tiny ZIP writer / reader for .dirrocomic issue files (store, no compression: pictures and clips are
// already compressed; the reader also takes deflate, via DecompressionStream, in case an issue was re-zipped by hand) and a
// minimal PDF writer (one full-page JPEG per page) for the strip PDF.

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(u8, c = 0xFFFFFFFF) { for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return c; }
function dosTime(d = new Date()) { return [((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF]; }

// files: [{ name, blob }] -> Blob (application/zip). Reads one file at a time (for its CRC); the result keeps the blobs as parts.
export async function zipFiles(files, onStep) {
  const enc = new TextEncoder(), parts = [], cen = [], [tm, dt] = dosTime(); let off = 0, i = 0;
  for (const f of files) {
    const name = enc.encode(f.name), size = f.blob.size;
    let c = 0xFFFFFFFF; for (let p = 0; p < size; p += 8 << 20) c = crc32(new Uint8Array(await f.blob.slice(p, p + (8 << 20)).arrayBuffer()), c);
    const crc = (c ^ 0xFFFFFFFF) >>> 0;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, tm, true); h.setUint16(12, dt, true);
    h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, f.blob);
    const e = new DataView(new ArrayBuffer(46));
    e.setUint32(0, 0x02014b50, true); e.setUint16(4, 20, true); e.setUint16(6, 20, true); e.setUint16(8, 0x0800, true); e.setUint16(10, 0, true); e.setUint16(12, tm, true); e.setUint16(14, dt, true);
    e.setUint32(16, crc, true); e.setUint32(20, size, true); e.setUint32(24, size, true); e.setUint16(28, name.length, true); e.setUint32(42, off, true);
    cen.push(e.buffer, name);
    off += 30 + name.length + size; onStep && onStep(++i, files.length);
  }
  const cenSize = cen.reduce((a, b) => a + b.byteLength, 0), z = new DataView(new ArrayBuffer(22));
  z.setUint32(0, 0x06054b50, true); z.setUint16(8, files.length, true); z.setUint16(10, files.length, true); z.setUint32(12, cenSize, true); z.setUint32(16, off, true);
  return new Blob([...parts, ...cen, z.buffer], { type: 'application/zip' });
}

// Blob -> Map(name -> Blob)
export async function unzipFiles(blob) {
  const tailStart = Math.max(0, blob.size - 65557), tail = new DataView(await blob.slice(tailStart).arrayBuffer());
  let eo = -1; for (let p = tail.byteLength - 22; p >= 0; p--) if (tail.getUint32(p, true) === 0x06054b50) { eo = p; break; }
  if (eo < 0) throw new Error('not a .dirrocomic (no zip directory)');
  const n = tail.getUint16(eo + 10, true), cenSize = tail.getUint32(eo + 12, true), cenOff = tail.getUint32(eo + 16, true);
  const cd = new DataView(await blob.slice(cenOff, cenOff + cenSize).arrayBuffer()), dec = new TextDecoder(), out = new Map();
  for (let i = 0, p = 0; i < n; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('broken zip directory');
    const method = cd.getUint16(p + 10, true), csize = cd.getUint32(p + 20, true), nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true), lo = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl)); p += 46 + nl + xl + cl;
    const lh = new DataView(await blob.slice(lo, lo + 30).arrayBuffer()), start = lo + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    let data = blob.slice(start, start + csize);
    if (method === 8) data = await new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    else if (method !== 0) throw new Error('unsupported zip method ' + method);
    if (!name.endsWith('/')) out.set(name, data);
  }
  return out;
}

// pages: [{ jpeg: Blob, w, h (pixels), pw, ph (points) }] -> PDF Blob
export async function pdfFromJpegs(pages, info = {}) {
  const enc = new TextEncoder(), parts = [], offs = []; let pos = 0;
  const put = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); pos += b.size != null ? b.size : b.byteLength; };
  const obj = (id, body) => { offs[id] = pos; put(`${id} 0 obj\n`); for (const b of [].concat(body)) put(b); put('\nendobj\n'); };
  const esc = s => String(s || '').replace(/[()\\]/g, c => '\\' + c).replace(/[^\x20-\x7e]/g, '');
  put('%PDF-1.4\n'); put(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));   // + the binary marker line
  const n = pages.length, kids = pages.map((_, i) => `${4 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  obj(3, `<< /Title (${esc(info.title)}) /Author (${esc(info.author)}) /Creator (DirroComics) /Producer (DirroComics) >>`);
  for (let i = 0; i < n; i++) {
    const P = pages[i], pid = 4 + i * 3, iid = pid + 1, cid = pid + 2, cs = `q ${P.pw.toFixed(2)} 0 0 ${P.ph.toFixed(2)} 0 0 cm /Im0 Do Q`;
    obj(pid, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${P.pw.toFixed(2)} ${P.ph.toFixed(2)}] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`);
    obj(iid, [`<< /Type /XObject /Subtype /Image /Width ${P.w} /Height ${P.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${P.jpeg.size} >>\nstream\n`, P.jpeg, '\nendstream']);
    obj(cid, [`<< /Length ${cs.length} >>\nstream\n`, cs, '\nendstream']);
  }
  const xref = pos, count = 4 + n * 3;
  let x = `xref\n0 ${count}\n0000000000 65535 f \n`; for (let i = 1; i < count; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  put(x); put(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
