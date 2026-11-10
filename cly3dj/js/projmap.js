// #664 Projection mapping in the DirroVJ projector window. The program picture is drawn as COPIES, each through its own smooth mesh
// warp of N x N control points (4 x 4 or 8 x 8, Catmull-Rom between them), so one projector can map the same output onto two
// surfaces independently (or more copies later). Edit right on the projector: drag a point, SHIFT-drag moves a whole copy,
// arrow keys nudge the picked point (SHIFT = 10 px), TAB picks the next point. The VJ desk's PROJECTION MAPPING section
// switches it on / off, picks the grid per copy, test pattern, brightness, reset, save / load (BroadcastChannel 'dirrovj-pm').
const KEY = 'vire.projmap', SUB = 12;   // SUB: mesh triangles per control cell edge

export function pmDefaults() {
  return { on: false, edit: true, test: false, sel: [0, 0], copies: [copy(4, [0.05, 0.08, 0.47, 0.92]), copy(8, [0.53, 0.08, 0.95, 0.92])] };
}
function copy(n, r) { return { on: true, n, pts: grid(n, r), src: [0, 0, 1, 1], bright: 1 }; }
function grid(n, [x0, y0, x1, y1]) { const p = []; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) p.push([x0 + (x1 - x0) * i / (n - 1), y0 + (y1 - y0) * j / (n - 1)]); return p; }
function cr(p0, p1, p2, p3, t) { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); }
function crRow(arr, s) {   // Catmull-Rom through arr (list of [x, y]) at s in [0, 1], ends extended
  const n = arr.length, f = s * (n - 1), i = Math.min(n - 2, Math.max(0, Math.floor(f))), t = f - i;
  const g = k => arr[Math.max(0, Math.min(n - 1, k))], e = (k, c) => k < 0 ? 2 * arr[0][c] - arr[1][c] : k > n - 1 ? 2 * arr[n - 1][c] - arr[n - 2][c] : g(k)[c];
  return [0, 1].map(c => cr(e(i - 1, c), e(i, c), e(i + 1, c), e(i + 2, c), t));
}
export function evalSurf(pts, n, u, v) { const rows = []; for (let j = 0; j < n; j++) rows.push(crRow(pts.slice(j * n, j * n + n), u)); return crRow(rows, v); }
export function resample(c, n2) { const p = []; for (let j = 0; j < n2; j++) for (let i = 0; i < n2; i++) p.push(evalSurf(c.pts, c.n, i / (n2 - 1), j / (n2 - 1))); return { ...c, n: n2, pts: p }; }
export function pmLoad() { try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); if (o && Array.isArray(o.copies)) return { ...pmDefaults(), ...o }; } catch {} return pmDefaults(); }
function pmSave(S) { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} }

const VS = `#version 300 es
in vec2 pos; in vec2 uv; out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(pos.x * 2.0 - 1.0, 1.0 - pos.y * 2.0, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float; uniform sampler2D tex; uniform float bright, test, hue; in vec2 vUv; out vec4 o;
void main() {
  vec3 c = texture(tex, vUv).rgb * bright;
  if (test > 0.5) { vec2 g = abs(fract(vUv * 8.0) - 0.5); float l = step(0.47, max(g.x, g.y)); vec2 g2 = abs(fract(vUv * 2.0) - 0.5); float l2 = step(0.485, max(g2.x, g2.y));
    float ck = mod(floor(vUv.x * 8.0) + floor(vUv.y * 8.0), 2.0); vec3 tint = hue < 0.5 ? vec3(0.2, 0.6, 1.0) : vec3(1.0, 0.55, 0.2);
    c = mix(tint * (0.25 + 0.2 * ck), vec3(1.0), max(l, l2)); float cr = length(vUv - 0.5); c = mix(c, vec3(1.0, 0.2, 0.3), step(abs(cr - 0.25), 0.004)); }
  o = vec4(c, 1.0);
}`;

export function attachProjMap(w, doc, video) {
  let S = pmLoad(), drag = null;
  const cv = doc.createElement('canvas'); cv.id = 'pmCv'; cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:none;z-index:4;background:#000';
  const ov = doc.createElement('canvas'); ov.id = 'pmOv'; ov.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:none;z-index:5;cursor:crosshair';
  doc.body.append(cv, ov);
  const gl = cv.getContext('webgl2', { antialias: true, premultipliedAlpha: false }); if (!gl) return null;
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };
  const pg = gl.createProgram(); gl.attachShader(pg, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pg, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pg);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  const buf = gl.createBuffer(), loc = { pos: gl.getAttribLocation(pg, 'pos'), uv: gl.getAttribLocation(pg, 'uv') }, un = n => gl.getUniformLocation(pg, n);
  const meshes = [];
  function build(c) {   // triangles of the warped surface: positions from the control points, UVs = the picture (its source crop)
    const M = (c.n - 1) * SUB, data = [], P = [];
    for (let j = 0; j <= M; j++) for (let i = 0; i <= M; i++) { const u = i / M, v = j / M; P.push([...evalSurf(c.pts, c.n, u, v), c.src[0] + u * (c.src[2] - c.src[0]), c.src[1] + v * (c.src[3] - c.src[1])]); }
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { const a = j * (M + 1) + i, b = a + 1, d = a + M + 1, e = d + 1; for (const k of [a, b, e, a, e, d]) data.push(...P[k]); }
    return new Float32Array(data);
  }
  function rebuild() { meshes.length = 0; for (const c of S.copies) meshes.push(c.on ? build(c) : null); }
  rebuild();
  const size = () => { const r = w.devicePixelRatio || 1; for (const x of [cv, ov]) { x.width = Math.round(w.innerWidth * r); x.height = Math.round(w.innerHeight * r); } };
  w.addEventListener('resize', size); size();
  function draw() {
    const on = !!S.on; cv.style.display = ov.style.display = on ? 'block' : 'none'; video.style.visibility = on ? 'hidden' : 'visible';
    if (on) {
      if (video.readyState >= 2 && video.videoWidth) { gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video); } catch {} }
      gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(pg);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc.pos); gl.enableVertexAttribArray(loc.uv);
      meshes.forEach((m, k) => { if (!m) return; gl.bufferData(gl.ARRAY_BUFFER, m, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 16, 0); gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 16, 8);
        gl.uniform1f(un('bright'), S.copies[k].bright ?? 1); gl.uniform1f(un('test'), S.test ? 1 : 0); gl.uniform1f(un('hue'), k % 2); gl.uniform1i(un('tex'), 0);
        gl.drawArrays(gl.TRIANGLES, 0, m.length / 4); });
      overlay();
    }
    w.requestAnimationFrame(draw);
  }
  function overlay() {
    const x = ov.getContext('2d'), W = ov.width, H = ov.height; x.clearRect(0, 0, W, H); if (!S.edit) return;
    S.copies.forEach((c, k) => { if (!c.on) return; const col = k % 2 ? '#ffa24a' : '#39a8ff', n = c.n;
      x.strokeStyle = col; x.lineWidth = 1;
      for (let j = 0; j < n; j++) { x.beginPath(); for (let s = 0; s <= 40; s++) { const p = evalSurf(c.pts, n, s / 40, j / (n - 1)); s ? x.lineTo(p[0] * W, p[1] * H) : x.moveTo(p[0] * W, p[1] * H); } x.stroke(); }
      for (let i = 0; i < n; i++) { x.beginPath(); for (let s = 0; s <= 40; s++) { const p = evalSurf(c.pts, n, i / (n - 1), s / 40); s ? x.lineTo(p[0] * W, p[1] * H) : x.moveTo(p[0] * W, p[1] * H); } x.stroke(); }
      c.pts.forEach((p, i) => { const on = S.sel[0] === k && S.sel[1] === i; x.fillStyle = on ? '#fff' : col; x.beginPath(); x.arc(p[0] * W, p[1] * H, on ? 7 : 5, 0, 7); x.fill(); });
      x.font = '700 14px system-ui'; x.fillStyle = col; x.fillText(`COPY ${k + 1} · ${n}×${n}`, c.pts[0][0] * W + 8, c.pts[0][1] * H - 8); });
  }
  const P = e => [e.clientX / w.innerWidth, e.clientY / w.innerHeight];
  ov.addEventListener('pointerdown', e => { if (!S.edit) return; const p = P(e); let best = null, bd = 18 / w.innerWidth;
    S.copies.forEach((c, k) => c.on && c.pts.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], (q[1] - p[1]) * w.innerHeight / w.innerWidth); if (d < bd) { bd = d; best = [k, i]; } }));
    if (best) { S.sel = best; drag = { k: best[0], i: best[1], p0: p, all: e.shiftKey }; ov.setPointerCapture(e.pointerId); } });
  ov.addEventListener('pointermove', e => { if (!drag) return; const p = P(e), c = S.copies[drag.k];
    if (drag.all) { const dx = p[0] - drag.p0[0], dy = p[1] - drag.p0[1]; c.pts = c.pts.map(q => [q[0] + dx, q[1] + dy]); drag.p0 = p; } else c.pts[drag.i] = p;
    meshes[drag.k] = build(c); });
  ov.addEventListener('pointerup', () => { if (drag) { drag = null; pmSave(S); tell(); } });
  w.addEventListener('keydown', e => { if (!S.on || !S.edit) return; const c = S.copies[S.sel[0]]; if (!c) return;
    if (e.key === 'Tab') { e.preventDefault(); S.sel = [S.sel[0], (S.sel[1] + 1) % c.pts.length]; return; }
    const st = (e.shiftKey ? 10 : 1) / w.innerWidth, d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st * w.innerWidth / w.innerHeight], ArrowDown: [0, st * w.innerWidth / w.innerHeight] }[e.key];
    if (d) { e.preventDefault(); const q = c.pts[S.sel[1]]; c.pts[S.sel[1]] = [q[0] + d[0], q[1] + d[1]]; meshes[S.sel[0]] = build(c); pmSave(S); } });
  const bc = new w.BroadcastChannel('dirrovj-pm'), tell = () => bc.postMessage({ k: 'pmstate', S });
  bc.onmessage = ev => { const m = ev.data || {};
    if (m.k === 'pmget') tell();
    else if (m.k === 'pmset') { Object.assign(S, m.v || {}); pmSave(S); rebuild(); tell(); }
    else if (m.k === 'pmcopy') { const c = S.copies[m.i]; if (!c) return; if (m.n && m.n !== c.n) S.copies[m.i] = resample(c, m.n); else Object.assign(c, m.v || {}); pmSave(S); rebuild(); tell(); }
    else if (m.k === 'pmreset') { const d = pmDefaults(); if (m.i == null) S = { ...d, on: S.on }; else S.copies[m.i] = d.copies[m.i] || d.copies[0]; pmSave(S); rebuild(); tell(); }
    else if (m.k === 'pmload') { if (m.S && Array.isArray(m.S.copies)) { S = { ...pmDefaults(), ...m.S }; pmSave(S); rebuild(); tell(); } } };
  w.requestAnimationFrame(draw); tell();
  return { get S() { return S; } };
}
