// #516 DirroComics, output side (project doc dirrocomics-plan.md). Runs inside the DirroVJ page, made by vjdesk.js.
// A strip of panels (stills, video clips, side by side stereo clips captured on the Quest over adb, grabs of the Quest picture or the
// webcam) drawn as a comic page: the current panel in the middle, about a quarter of the previous and next panels at the edges, masthead
// on top, footer below. Each panel is inked in a shader (HALFTONE, HATCH, BEN-DAY, POSTER, PHOTO) on cream paper, with captions,
// speech / thought / shout balloons and SFX drawn on canvases. ANAGLYPH (red left, cyan right, black and white only): SBS panels give
// each eye its own picture (CONVERGE moves the zero plane, SPLIT gives the eyes different screen angles so the dots don't fuse at the
// screen); flat panels sit on the screen plane; balloons and SFX float a few pixels in front (POP); frames, masthead, captions at zero.
// Storage: OPFS vire-comics/ (media files + strip.json), so the strip survives a reload. The desk (vjdesk.html) sends 'cx' messages.
const REF = { W: 1920, H: 1080, pw: 1120, ph: 850, top: 128, gap: 30 }; REF.x = (REF.W - REF.pw) / 2;
const STYLES = ['halftone', 'hatch', 'benday', 'poster', 'photo'];
const FONT = { sfx: 'ComicBangers', cap: 'ComicType', bal: 'ComicNeueBold' };
const PANEL_DEF = { sbs: 0, swap: false, conv: 0, pop: 7, dmode: 2, depth: '', dver: 0, live: false, style: 'halftone', dots: 12, ink: 0.6, bright: 0, contrast: 1.15, fx: 0.5, fy: 0.5, zoom: 1, items: [] };
const CFG_DEF = { issue: 'ISSUE #1', foot: 'DIRRODJ PRESENTS', ana: false, auto: 0, sbsDef: 'auto', styleDef: 'halftone', split: true };

const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const COPY_FS = 'uniform sampler2D t; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(t, vUv).rgb, 1.0); }';
// #521 one draw per panel (was one shader for all four slots: every helper inlined dozens of times, and the RGB+D version
// took long enough to compile that Chrome's GPU watchdog reset the GPU process and then blocked WebGL for the site).
// The panel quad covers its rect + the 5 px frame; the masthead / footer go on top in their own blended pass.
const PANEL_VS = `uniform vec4 R; varying vec2 vP;
void main() { vec2 t = position.xy * 0.5 + 0.5; vP = R.xy - 5.0 + vec2(t.x, 1.0 - t.y) * (R.zw + 10.0);
  gl_Position = vec4(vP.x / 1920.0 * 2.0 - 1.0, 1.0 - vP.y / 1080.0 * 2.0, 0.0, 1.0); }`;
const PANEL_FS = `uniform sampler2D m, o, dm, lm; uniform vec4 R, A, B, C, E, G; uniform vec3 paper, inkc; uniform float ana, live; varying vec2 vP;
// R: rect (ref px, y down). A: sbs (0 flat, 1 full, 2 half, 3 RGB+D), swap, conv, light. B: fx, fy, zoom, style. C: bright, contrast, eye aspect.
// E: dot pitch, ink lines, pop px, split screens. G: flat depth mode (0 screen, 1 behind, 2 ground, 3 map), signed depth px, has painted map.
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 euv(vec2 q, float eye) {
  float pa = R.z / R.w, ea = C.z, z = max(B.z, 1.0), cw, ch;
  if (ea > pa) { ch = 1.0 / z; cw = pa / ea / z; } else { cw = 1.0 / z; ch = ea / pa / z; }
  float ox = clamp(B.x - cw * 0.5, 0.0, 1.0 - cw), oy = clamp(B.y - ch * 0.5, 0.0, 1.0 - ch);
  vec2 e = vec2(ox + clamp(q.x, 0.0, 1.0) * cw, oy + clamp(q.y, 0.0, 1.0) * ch);
  if (A.x > 2.5) e.x *= 0.5;   // RGB+D: the picture is the left half
  else if (A.x > 0.5) { e.x = clamp(e.x + (eye * 2.0 - 1.0) * A.z * 0.5, 0.001, 0.999); float side = A.y > 0.5 ? 1.0 - eye : eye; e.x = e.x * 0.5 + side * 0.5; }
  return vec2(e.x, 1.0 - e.y);
}
float L(vec2 q, float eye) { return clamp((lum(texture2D(m, euv(q, eye)).rgb) - 0.5) * C.y + 0.5 + C.x, 0.0, 1.0); }
float dots(float cover, vec2 d, float pitch) { float r = pitch * sqrt(clamp(cover, 0.0, 1.0) / 3.14159) * 1.08; return clamp(r - length(d) + 0.5, 0.0, 1.0) * clamp(r * 1.5, 0.0, 1.0); }
float lineInk(vec2 sp, float a, float pitch, float w) { float s = dot(sp, vec2(cos(a), sin(a))) / pitch; return clamp(w - abs(fract(s) - 0.5) * pitch + 0.5, 0.0, 1.0) * clamp(w * 3.0, 0.0, 1.0); }
float shade(vec2 q, float eye) {
  float l = L(q, eye); vec2 dq = 1.3 / R.zw;
  float lines = smoothstep(0.07, 0.17, length(vec2(L(q + vec2(dq.x, 0.0), eye) - l, L(q + vec2(0.0, dq.y), eye) - l))) * E.y;
  vec2 sp = q * R.zw; float pitch = max(E.x, 3.0), st = B.w, ink;
  bool split = E.w > 0.5 && A.x > 0.5 && A.x < 2.5;
  if (st < 0.5) {   // HALFTONE: darkness read at each cell's centre so the dots stay round
    float a = split ? (eye < 0.5 ? 0.2618 : 1.3090) : 0.7854, c = cos(a), sn = sin(a);
    vec2 r = vec2(c * sp.x + sn * sp.y, -sn * sp.x + c * sp.y) / pitch, cc = floor(r) + 0.5, d = (r - cc) * pitch;
    vec2 cp = cc * pitch; vec2 cq = vec2(c * cp.x - sn * cp.y, sn * cp.x + c * cp.y) / R.zw;
    ink = max(dots(1.0 - L(cq, eye), d, pitch), smoothstep(0.10, 0.04, l));
  } else if (st < 1.5) {   // HATCH
    float a = split ? (eye < 0.5 ? 1.0821 : 2.0595) : 1.0821;
    ink = max(lineInk(sp, a, pitch, (1.0 - l) * 0.475 * pitch), lineInk(sp, a + 1.309, pitch, clamp((0.3 - l) * 1.6, 0.0, 1.0) * pitch * 0.5));
    ink = max(ink, smoothstep(0.08, 0.03, l));
  } else if (st < 2.5) {   // BEN-DAY
    float a = split ? (eye < 0.5 ? 0.0 : 0.7854) : 0.0, c = cos(a), sn = sin(a);
    vec2 r = vec2(c * sp.x + sn * sp.y, -sn * sp.x + c * sp.y) / pitch, d = (r - floor(r) - 0.5) * pitch;
    ink = l < 0.16 ? 1.0 : dots(l > 0.70 ? 0.0 : (l > 0.42 ? 0.22 : 0.55), d, pitch);
  } else if (st < 3.5) ink = smoothstep(0.47, 0.39, l);   // POSTER
  else ink = 1.0 - l;   // PHOTO
  return max(ink, lines);
}
float gray(vec2 q) {   // nearness 0..1 (white = front): painted map, RGB+D's recorded depth, LIVE PEOPLE
  vec2 uv = euv(q, 0.0); bool rgbd = A.x > 2.5;
  float g = G.z > 0.5 ? texture2D(dm, rgbd ? vec2(uv.x * 2.0, uv.y) : uv).r : 0.0;
  if (rgbd) g = max(g, texture2D(m, vec2(uv.x + 0.5, uv.y)).r);
  if (live > 0.5) g = max(g, texture2D(lm, vec2(uv.x, 1.0 - uv.y)).r);
  return g;
}
float disp(vec2 q) {   // ref px, + = behind the screen. CONVERGE (G.y) spreads it: + white at the screen, - black at the screen
  bool map = G.z > 0.5 || A.x > 2.5 || live > 0.5;
  if (!map) return G.x < 1.5 ? G.y : G.y * (1.0 - clamp(q.y, 0.0, 1.0));
  float g = gray(q); if (G.x > 1.5 && G.x < 2.5 && G.z < 0.5 && A.x < 2.5) g = max(g, clamp(q.y, 0.0, 1.0));
  return G.y >= 0.0 ? G.y * (1.0 - g) : G.y * g;
}
void main() {
  vec2 q = (vP - R.xy) / R.zw; float lt = A.w, iL, iR;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) { iL = lt; iR = lt; }   // the frame
  else {
    vec2 qa = q, qb = q; float eb = 0.0; bool two = false;
    if (ana > 0.5 && (A.x < 0.5 || A.x > 2.5) && (G.x > 0.5 || live > 0.5 || A.x > 2.5)) {   // flat / RGB+D: backward warp per eye, one refinement step
      float k = 0.5 / R.z, d = disp(q); qa = q + vec2(disp(q + vec2(d * k, 0.0)) * k, 0.0); qb = q - vec2(disp(q - vec2(d * k, 0.0)) * k, 0.0); two = true;
    } else if (ana > 0.5 && A.x > 0.5 && A.x < 2.5) { eb = 1.0; two = true; }   // SBS: each eye its half
    float a = shade(qa, 0.0), b = a; if (two) b = shade(qb, eb);
    float OH = R.w * 2.0 + 8.0;   // text canvas: captions rows 0..ph (zero parallax), balloons / SFX rows ph+8.. (POP)
    vec4 z = texture2D(o, vec2(q.x, 1.0 - q.y * R.w / OH)); a = mix(a, 1.0 - z.r, z.a); b = mix(b, 1.0 - z.r, z.a);
    float off = ana > 0.5 ? E.z * 0.5 / R.z : 0.0, pv = 1.0 - (R.w + 8.0 + q.y * R.w) / OH;
    vec4 pl = texture2D(o, vec2(q.x - off, pv)), pr = texture2D(o, vec2(q.x + off, pv));
    a = mix(a, 1.0 - pl.r, pl.a); b = mix(b, 1.0 - pr.r, pr.a);
    iL = a * lt; iR = b * lt;
  }
  vec3 col = ana > 0.5 ? vec3(paper.r * (1.0 - iL), paper.g * (1.0 - iR), paper.b * (1.0 - iR)) : mix(paper, inkc, iL);
  gl_FragColor = vec4(col, 1.0);
}`;
const PAPER_FS = 'uniform vec3 paper; void main() { gl_FragColor = vec4(paper, 1.0); }';
const CHROME_FS = `uniform sampler2D chr; uniform vec3 paper, inkc; uniform float ana; varying vec2 vUv;
void main() { vec4 h = texture2D(chr, vUv); if (h.a < 0.004) discard; float ink = 1.0 - h.r; gl_FragColor = vec4(ana > 0.5 ? paper * (1.0 - ink) : mix(paper, inkc, ink), h.a); }`;

export function makeComics({ THREE, renderer, fixed, send, onChange, store = 'vire-comics', requestRgbd, relayAsk }) {   // #524 relayAsk(o): vjask / vjclog to the Quest   // #520 requestRgbd(still): asks the Quest for GRAB RGB-D
  const cfg = { ...CFG_DEF }, panels = [], stars = []; /* #524 stars: STAR IN IT cards {cid, seq, at, dev, name, genre, lines, img, media, wd} */ let cur = 0, pos = 0, ver = 1, autoT = 0, watchId = null, watchT = 0, pvT = 0, grabReq = null, lastQ = null;
  const res = new Map();   // panel id -> { kind, el, tex, url, ea, ov: { tex, key } }
  const quad = mat => { const sc = new THREE.Scene(), m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false; sc.add(m); return sc; };
  const oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); blank.needsUpdate = true;   // paper while a picture loads
  const paperV = new THREE.Vector3(243 / 255, 234 / 255, 212 / 255), inkV = new THREE.Vector3(24 / 255, 21 / 255, 20 / 255), anaU = { value: 0 };
  // #521 the page: paper, up to four panel quads (one small shader each), masthead / footer on top
  const pageSc = new THREE.Scene(), fullGeo = new THREE.PlaneGeometry(2, 2), mesh = (mat, order) => { const q = new THREE.Mesh(fullGeo, mat); q.frustumCulled = false; q.renderOrder = order; pageSc.add(q); return q; };
  mesh(new THREE.ShaderMaterial({ uniforms: { paper: { value: paperV } }, vertexShader: VS, fragmentShader: PAPER_FS, depthTest: false, depthWrite: false }), 0);
  const slots = [0, 1, 2, 3].map(i => {
    const U = { m: { value: blank }, o: { value: blank }, dm: { value: blank }, lm: { value: blank }, live: { value: 0 }, R: { value: new THREE.Vector4() }, A: { value: new THREE.Vector4() }, B: { value: new THREE.Vector4() },
      C: { value: new THREE.Vector4() }, E: { value: new THREE.Vector4() }, G: { value: new THREE.Vector4() }, paper: { value: paperV }, inkc: { value: inkV }, ana: anaU };
    const q = mesh(new THREE.ShaderMaterial({ uniforms: U, vertexShader: PANEL_VS, fragmentShader: PANEL_FS, depthTest: false, depthWrite: false }), 1 + i); q.visible = false;
    return { U, q };
  });
  const chromeU = { chr: { value: blank }, paper: { value: paperV }, inkc: { value: inkV }, ana: anaU };
  mesh(new THREE.ShaderMaterial({ uniforms: chromeU, vertexShader: VS, fragmentShader: CHROME_FS, transparent: true, depthTest: false, depthWrite: false }), 10);
  const copyU = { t: { value: null } }, copySc = quad(new THREE.ShaderMaterial({ uniforms: copyU, vertexShader: VS, fragmentShader: COPY_FS, depthTest: false, depthWrite: false }));
  const mkRT = (w, h) => { const t = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false }); t.texture.colorSpace = THREE.NoColorSpace; return t; };
  let pageRT = null, pvBusy = false; const pvRT = mkRT(640, 360), pvBuf = new Uint8Array(640 * 360 * 4), pvCanvas = document.createElement('canvas'); pvCanvas.width = 640; pvCanvas.height = 360;

  // ---- fonts (OFL: Bangers, Special Elite, Comic Neue), vendored in fonts/
  let fontsOk = false;
  (async () => {
    try {
      for (const [n, f] of [[FONT.sfx, 'ComicBangers'], [FONT.cap, 'ComicType'], [FONT.bal, 'ComicNeueBold']]) { const ff = new FontFace(n, `url(${new URL(`../fonts/${f}.woff2`, import.meta.url).href})`); await ff.load(); document.fonts.add(ff); }
    } catch (e) { console.warn('DirroComics fonts', e); }
    fontsOk = true; for (const r of res.values()) if (r.ov) r.ov.key = ''; chromeKey = '';
  })();

  // ---- storage (OPFS)
  const dir = (async () => { try { return await (await navigator.storage.getDirectory()).getDirectoryHandle(store, { create: true }); } catch { return null; } })();
  async function writeFile(name, blob) { const d = await dir; if (!d) return; const h = await d.getFileHandle(name, { create: true }), w = await h.createWritable(); await w.write(blob); await w.close(); }
  async function readFile(name) { const d = await dir; if (!d) return null; try { return await (await d.getFileHandle(name)).getFile(); } catch { return null; } }
  async function removeFile(name) { const d = await dir; if (d) try { await d.removeEntry(name); } catch {} }
  let saveT = 0; function save() { clearTimeout(saveT); saveT = setTimeout(() => writeFile('strip.json', new Blob([JSON.stringify({ cfg, panels, cur, stars })], { type: 'application/json' })).catch(() => {}), 400); }
  (async () => {
    const f = await readFile('strip.json'); if (!f) return;
    try { const j = JSON.parse(await f.text()); Object.assign(cfg, j.cfg || {}); for (const p of j.panels || []) { const q = { ...PANEL_DEF, ...p }; if (!q.sbs && !q.conv && q.deep) q.conv = Math.min(0.08, q.deep / 150); delete q.deep; panels.push(q); } /* #518 'deep' (#517) became CONVERGE */ for (const st of j.stars || []) stars.push(st);   /* #524 */ cur = pos = Math.min(Math.max(0, j.cur | 0), Math.max(0, panels.length - 1)); } catch {}
    changed(true);
  })();
  function changed(list) { ver++; chromeKey = ''; save(); onChange && onChange(); if (list) sendList(); }

  // ---- media
  const isSbsName = n => /(^|[^a-z])(sbs|3d|stereo|lr)([^a-z]|$)/i.test(n), isRgbdName = n => /rgb-?d/i.test(n);   // #520
  async function probe(blob, kind) {
    const url = URL.createObjectURL(blob);
    if (kind === 'video') {
      const v = document.createElement('video'); v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = () => no(new Error('video')); setTimeout(ok, 8000); });
      return { el: v, url, w: v.videoWidth, h: v.videoHeight };
    }
    const im = new Image(); await new Promise((ok, no) => { im.onload = ok; im.onerror = () => no(new Error('image')); im.src = url; }); return { el: im, url, w: im.naturalWidth, h: im.naturalHeight };
  }
  function thumbOf(el, w, h, sbs) {
    const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d'), ew = sbs === 1 || sbs === 3 ? w / 2 : w;
    const k = Math.max(160 / ew, 90 / h); g.fillStyle = '#000'; g.fillRect(0, 0, 160, 90);
    try { g.drawImage(el, 0, 0, ew, h, (160 - ew * k) / 2, (90 - h * k) / 2, ew * k, h * k); } catch {}
    return c.toDataURL('image/jpeg', 0.6);
  }
  async function addMedia(blob, name, extra) {   // #524 extra: fields for the new panel (a STAR photo: star = the guest's device id)
    const kind = /^video\//.test(blob.type) || /\.(mp4|webm|mov|m4v)$/i.test(name) ? 'video' : 'image';
    const ext = kind === 'video' ? ((name.match(/\.(mp4|webm|mov|m4v)$/i) || [, 'mp4'])[1].toLowerCase()) : ((name.match(/\.(png|webp|jpe?g|gif)$/i) || [, 'jpg'])[1].toLowerCase());
    const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), file = id + '.' + ext;
    let pr; try { pr = await probe(blob, kind); } catch (e) { send({ k: 'cxmsg', t: 'Could not open ' + name }); return; }
    const a = pr.w / Math.max(1, pr.h), auto = isRgbdName(name) ? 3 : cfg.sbsDef === 'auto' ? (isSbsName(name) || a >= 1.95 ? (/half/i.test(name) ? 2 : 1) : 0) : (cfg.sbsDef === 'full' ? 1 : cfg.sbsDef === 'half' ? 2 : 0);
    const p = { ...PANEL_DEF, items: [], id, file, kind, name: String(name).slice(0, 60), w: pr.w, h: pr.h, sbs: auto, style: cfg.styleDef, conv: auto && auto !== 3 ? 0 : 0.04 };   // flat: 6 px of depth to start
    if (kind === 'video') { pr.el.currentTime = Math.min(0.5, (pr.el.duration || 1) / 3); await new Promise(ok => { pr.el.onseeked = ok; setTimeout(ok, 1500); }); }
    p.thumb = thumbOf(pr.el, pr.w, pr.h, auto);
    URL.revokeObjectURL(pr.url);
    await writeFile(file, blob).catch(() => send({ k: 'cxmsg', t: 'Storage full? ' + name + ' not saved' }));
    if (extra) Object.assign(p, extra); panels.push(p); changed(true);
    send({ k: 'cxmsg', t: 'Added ' + name + (auto ? [' (side by side)', ' (half side by side)', ' (RGB+D: picture + depth)'][auto - 1] : '') });
  }
  function eyeAspect(p) { const w = p.w || 16, h = p.h || 9; return p.sbs === 1 || p.sbs === 3 ? w / 2 / h : w / h; }
  function resOf(p) {   // lazy: load the panel's media the first time it is on screen
    let r = res.get(p.id); if (r) return r;
    r = { tex: null, el: null, url: null, ov: { tex: null, key: '', c: null, t: 0 }, dtex: null, dver: -1 }; res.set(p.id, r);
    readFile(p.file).then(async f => {
      if (!f) return; const pr = await probe(f, p.kind).catch(() => null); if (!pr) return;
      r.el = pr.el; r.url = pr.url;
      r.tex = p.kind === 'video' ? new THREE.VideoTexture(pr.el) : new THREE.Texture(pr.el);
      r.tex.colorSpace = THREE.NoColorSpace; r.tex.generateMipmaps = false; r.tex.minFilter = THREE.LinearFilter; r.tex.needsUpdate = true;
    });
    return r;
  }
  function dropRes(id) { const r = res.get(id); if (!r) return; if (r.el && r.el.pause) r.el.pause(); if (r.url) URL.revokeObjectURL(r.url); if (r.tex) r.tex.dispose(); if (r.ov.tex) r.ov.tex.dispose(); if (r.dtex) r.dtex.dispose(); res.delete(id); }
  function depthOf(p, r) {   // #518 the panel's depth map (white = front), saved by the desk as <id>.d.png; reloaded when dver changes
    if (!p.depth) { if (r.dtex) { r.dtex.dispose(); r.dtex = null; } r.dver = -1; return null; }
    if (r.dver !== p.dver) {
      r.dver = p.dver; const want = p.dver;
      readFile(p.depth).then(f => { if (!f || r.dver !== want) return; const u = URL.createObjectURL(f), im = new Image();
        im.onload = () => { URL.revokeObjectURL(u); if (r.dver !== want) return; if (r.dtex) r.dtex.dispose(); r.dtex = new THREE.Texture(im); r.dtex.colorSpace = THREE.NoColorSpace; r.dtex.generateMipmaps = false; r.dtex.minFilter = THREE.LinearFilter; r.dtex.needsUpdate = true; };
        im.src = u; });
    }
    return r.dtex;
  }
  // #518 LIVE PEOPLE on a video panel: MediaPipe selfie segmentation (dirro-mask.js, loaded on first use) on the panel on air
  let pmask = null, pmLoad = null;
  function people() { if (!pmLoad) pmLoad = import('./dirro-mask.js').then(async m => { const pm = new m.PersonMask(); await pm.load(); pmask = pm.state === 'ready' ? pm : null; if (!pmask) send({ k: 'cxmsg', t: 'LIVE PEOPLE: MediaPipe did not load (' + (pm.err || '?') + ')' }); }).catch(e => send({ k: 'cxmsg', t: 'LIVE PEOPLE: ' + e.message })); return pmask; }

  // ---- text layers (#518: one canvas per panel straight to the GPU): captions (zero parallax) on top, balloons + SFX (pop) below
  const OH = REF.ph * 2 + 8;
  function wrap(g, text, maxw) {
    const out = []; for (const para of String(text || '').split('\n')) { let cur = ''; for (const w of para.split(/\s+/).filter(Boolean)) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width <= maxw || !cur) cur = t; else { out.push(cur); cur = w; } } out.push(cur); }
    return out;
  }
  function drawItem(g, it) {
    const W = REF.pw, H = REF.ph, x = it.x * W, y = it.y * H, s = it.s || 30, mw = (it.w || 0.32) * W, tx = (it.tx ?? it.x) * W, ty = (it.ty ?? it.y + 0.2) * H;
    g.lineJoin = 'round'; g.textBaseline = 'middle'; g.textAlign = 'center';
    if (it.t === 'sfx') {
      g.save(); g.translate(x, y); g.rotate((it.r || -8) * Math.PI / 180); g.font = `${s}px ${FONT.sfx}`;
      g.lineWidth = Math.max(6, s * 0.12); g.strokeStyle = '#000'; g.strokeText(it.text || '', 0, 0); g.fillStyle = '#fff'; g.fillText(it.text || '', 0, 0); g.restore(); return;
    }
    if (it.t === 'cap') {
      g.font = `${s}px ${FONT.cap}`; g.textAlign = 'left'; const ls = wrap(g, it.text, mw), lh = s * 1.25, tw = Math.max(...ls.map(l => g.measureText(l).width)), pad = s * 0.45;
      const bw = tw + pad * 2, bh = lh * ls.length + pad * 2, bx = Math.min(Math.max(4, x - bw / 2), W - bw - 4), by = Math.min(Math.max(4, y - bh / 2), H - bh - 4);
      g.fillStyle = '#fff'; g.fillRect(bx, by, bw, bh); g.lineWidth = 4; g.strokeStyle = '#000'; g.strokeRect(bx + 2, by + 2, bw - 4, bh - 4);
      g.fillStyle = '#000'; ls.forEach((l, i) => g.fillText(l, bx + pad, by + pad + lh * (i + 0.5))); return;
    }
    g.font = `${s}px ${FONT.bal}`; const ls = wrap(g, String(it.text || '').toUpperCase(), mw), lh = s * 1.12, tw = Math.max(...ls.map(l => g.measureText(l).width), s), th = lh * ls.length;
    const rx = tw / 2 + s * 1.25, ry = th / 2 + s * 0.9, shapes = [];
    if (it.t === 'thought') {
      const n = 13, br = Math.min(rx, ry) * 0.42;
      for (let k = 0; k < n; k++) { const a = 2 * Math.PI * k / n; shapes.push(c => c.arc(x + rx * 0.9 * Math.cos(a), y + ry * 0.86 * Math.sin(a), br, 0, 7)); }
      shapes.push(c => c.ellipse(x, y, rx * 0.95, ry * 0.92, 0, 0, 7));
      const ang = Math.atan2(ty - y, tx - x), sx = x + rx * Math.cos(ang), sy = y + ry * Math.sin(ang);
      [[0.25, 0.16], [0.55, 0.11], [0.85, 0.07]].forEach(([f, r]) => shapes.push(c => c.arc(sx + (tx - sx) * f, sy + (ty - sy) * f, s * r * 3, 0, 7)));
    } else if (it.t === 'shout') {
      const n = 22; shapes.push(c => { for (let k = 0; k <= n; k++) { const a = 2 * Math.PI * k / n, f = k % 2 ? 0.86 : 1.18; const px = x + rx * f * Math.cos(a), py = y + ry * f * Math.sin(a); k ? c.lineTo(px, py) : c.moveTo(px, py); } });
      const ang = Math.atan2(ty - y, tx - x), w = 0.16; shapes.push(c => { c.moveTo(x + rx * 0.8 * Math.cos(ang - w), y + ry * 0.8 * Math.sin(ang - w)); c.lineTo(tx, ty); c.lineTo(x + rx * 0.8 * Math.cos(ang + w), y + ry * 0.8 * Math.sin(ang + w)); });
    } else {   // speech
      shapes.push(c => c.ellipse(x, y, rx, ry, 0, 0, 7));
      const ang = Math.atan2(ty - y, tx - x), w = 0.2; shapes.push(c => { c.moveTo(x + rx * 0.75 * Math.cos(ang - w), y + ry * 0.75 * Math.sin(ang - w)); c.lineTo(tx, ty); c.lineTo(x + rx * 0.75 * Math.cos(ang + w), y + ry * 0.75 * Math.sin(ang + w)); });
    }
    g.lineWidth = 9; g.strokeStyle = '#000'; for (const sh of shapes) { g.beginPath(); sh(g); g.closePath(); g.stroke(); }   // outline of the union...
    g.fillStyle = '#fff'; for (const sh of shapes) { g.beginPath(); sh(g); g.closePath(); g.fill(); }   // ...then the white fill hides the inner half
    g.fillStyle = '#000'; ls.forEach((l, i) => g.fillText(l, x, y - th / 2 + lh * (i + 0.5)));
  }
  function overlay(p, r, now) {
    const key = fontsOk + JSON.stringify(p.items);
    if (r.ov.key === key && r.ov.tex) return r.ov.tex;
    if (r.ov.tex && now - r.ov.t < 50) return r.ov.tex;   // typing / dragging: redraw at most 20 times a second
    r.ov.key = key; r.ov.t = now;
    if (!r.ov.c) { r.ov.c = document.createElement('canvas'); r.ov.c.width = REF.pw; r.ov.c.height = OH; }
    const g = r.ov.c.getContext('2d'); g.clearRect(0, 0, REF.pw, OH);
    for (const [top, zero] of [[0, true], [REF.ph + 8, false]]) {
      g.save(); g.beginPath(); g.rect(0, top, REF.pw, REF.ph); g.clip(); g.translate(0, top);
      for (const it of p.items || []) if (it && it.text && (it.t === 'cap') === zero && (!it.star || (it.ok === 'yes' && it.askText === it.text))) drawItem(g, it);   // #524 a guest's line only after their YES to exactly this text
      g.restore();
    }
    if (!r.ov.tex) { r.ov.tex = new THREE.CanvasTexture(r.ov.c); r.ov.tex.minFilter = r.ov.tex.magFilter = THREE.LinearFilter; r.ov.tex.generateMipmaps = false; r.ov.tex.colorSpace = THREE.NoColorSpace; r.ov.tex.premultiplyAlpha = false; }
    r.ov.tex.needsUpdate = true; return r.ov.tex;
  }
  // ---- masthead + footer (zero parallax), one texture for the page
  const hc = document.createElement('canvas'); hc.width = REF.W; hc.height = REF.H;
  const hTex = new THREE.CanvasTexture(hc); hTex.minFilter = hTex.magFilter = THREE.LinearFilter; hTex.generateMipmaps = false; hTex.colorSpace = THREE.NoColorSpace;   // #518 straight to the GPU
  let chromeKey = '';
  function chrome(idx) {
    const key = [fontsOk, cfg.issue, cfg.foot, idx, panels.length].join('|'); if (key === chromeKey) return; chromeKey = key;
    const g = hc.getContext('2d'); g.clearRect(0, 0, REF.W, REF.H); g.fillStyle = '#000'; g.strokeStyle = '#000'; g.textBaseline = 'alphabetic';
    g.font = `86px ${FONT.sfx}`; g.textAlign = 'left'; g.fillText('DIRROCOMICS', 40, 96); const tw = g.measureText('DIRROCOMICS').width;
    const gx = 40 + tw + 52, gy = 62, R = 27;   // gear (steampunk)
    for (let k = 0; k < 10; k++) { const a = 2 * Math.PI * k / 10; g.save(); g.translate(gx + R * Math.cos(a), gy + R * Math.sin(a)); g.rotate(a); g.fillRect(-7, -7, 14, 14); g.restore(); }
    g.beginPath(); g.arc(gx, gy, R * 0.92, 0, 7); g.fill(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(gx, gy, R * 0.36, 0, 7); g.fill(); g.globalCompositeOperation = 'source-over';
    g.font = `32px ${FONT.cap}`; g.textAlign = 'right'; g.fillText((cfg.issue || '') + '  ·  10 CENTS', REF.W - 40, 88);
    g.fillRect(40, 108, REF.W - 80, 6);
    g.font = `27px ${FONT.cap}`; g.textAlign = 'left'; g.fillText(panels.length ? `PANEL ${String(idx + 1).padStart(2, '0')} / ${String(panels.length).padStart(2, '0')}` : 'NO PANELS YET', 40, REF.H - 34);
    g.textAlign = 'right'; g.fillText(cfg.foot || '', REF.W - 40, REF.H - 34);
    if (!panels.length) { g.textAlign = 'center'; g.font = `44px ${FONT.cap}`; g.fillText('Import panels on the VJ desk (DIRROCOMICS)', REF.W / 2, REF.H / 2); }
    hTex.needsUpdate = true;
  }
  // ---- one page at a scroll position (float panel index)
  function layout(at, now = performance.now()) {
    const base = Math.floor(at), want = new Set(); let liveDone = false;
    for (let i = 0; i < 4; i++) {
      const k = base - 1 + i, p = panels[k], S = slots[i], U = S.U;
      const x = REF.x + (k - at) * (REF.pw + REF.gap);
      if (!p || x + REF.pw < -10 || x > REF.W + 10) { S.q.visible = false; continue; }
      const r = resOf(p); want.add(p.id); S.q.visible = true;
      U.m.value = r.tex || blank; U.o.value = overlay(p, r, now); const dt = depthOf(p, r); U.dm.value = dt || blank;
      U.R.value.set(x, REF.top, REF.pw, REF.ph);
      U.A.value.set(r.tex ? (p.sbs | 0) : 0, p.swap ? 1 : 0, p.conv || 0, 1 - 0.3 * Math.min(1, Math.abs(k - at)));
      U.B.value.set(p.fx ?? 0.5, p.fy ?? 0.5, p.zoom || 1, Math.max(0, STYLES.indexOf(p.style)));
      U.C.value.set(p.bright || 0, p.contrast ?? 1.15, eyeAspect(p), 1);
      U.E.value.set(p.dots || 12, p.ink ?? 0.6, p.pop ?? 7, cfg.split ? 1 : 0);
      U.G.value.set(dt || p.sbs === 3 ? 3 : (p.dmode ?? 2), Math.max(-12, Math.min(12, (p.conv || 0) * 150)), dt ? 1 : 0, 0);   // #517 / #518: flat panels: CONVERGE = depth in px
      U.live.value = 0;
      if (p.live && p.kind === 'video' && (!p.sbs || p.sbs === 3) && cfg.ana && k === Math.round(at) && r.el && !liveDone) {   // LIVE PEOPLE on the panel in the middle
        const pm = people(); if (pm) { pm.step(r.el, now); if (pm.tex) { U.lm.value = pm.tex; U.live.value = 1; liveDone = true; } }
      }
      if (r.el && r.el.play && r.el.paused) r.el.play().catch(() => {});
    }
    chrome(Math.round(at)); chromeU.chr.value = hTex; anaU.value = cfg.ana ? 1 : 0;
    return want;
  }
  function draw(rt) { renderer.setRenderTarget(rt); renderer.render(pageSc, oc); }
  let playing = new Set();
  function pauseOthers(want) { if (exp) for (const id of exp.want) want.add(id); for (const [id, r] of res) if (!want.has(id) && r.el && r.el.pause && !r.el.paused) r.el.pause(); playing = want; }   // #522 an export keeps its panels playing
  // ---- called every program frame by vjdesk.js
  function tick(questTex, now, dt) {
    lastQ = questTex;
    if (cfg.auto > 0 && panels.length > 1) { autoT += dt; if (autoT >= cfg.auto) { autoT = 0; go(cur + 1 >= panels.length ? 0 : cur + 1); } } else autoT = 0;
    const d = cur - pos; pos = Math.abs(d) < 0.002 ? cur : pos + d * Math.min(1, dt * 7);
    if (grabReq) grab(grabReq);
    if (watchId && now - watchT < 4000 && now - pvT > 120 && !pvBusy) {   // the desk's editor preview: the selected panel centred, ~8 a second (#518)
      pvT = now; const i = panels.findIndex(p => p.id === watchId);
      if (i >= 0) {
        const w = layout(i, now); for (const id of playing) w.add(id); draw(pvRT); renderer.setRenderTarget(null);
        renderer.readRenderTargetPixels(pvRT, 0, 0, 640, 360, pvBuf);
        const c = pvCanvas; const g = c.getContext('2d'), im = g.createImageData(640, 360);
        for (let y = 0; y < 360; y++) im.data.set(pvBuf.subarray((359 - y) * 2560, (360 - y) * 2560), y * 2560);
        g.putImageData(im, 0, 0); const id = watchId; pvBusy = true;
        c.toBlob(b => { pvBusy = false; if (b) send({ k: 'cxpv', id, blob: b }); }, 'image/jpeg', 0.75);   // encoded off the frame
      }
    }
  }
  function render(W, H) {   // the page as a bus source
    if (!pageRT || pageRT.width !== W || pageRT.height !== H) { if (pageRT) pageRT.dispose(); pageRT = mkRT(W, H); }
    pauseOthers(layout(pos, performance.now())); draw(pageRT); return pageRT.texture;
  }
  function go(i) {
    if (!panels.length) return; i = Math.max(0, Math.min(panels.length - 1, i | 0));
    if (Math.abs(i - pos) > 1.5) pos = i + (i > pos ? -1 : 1);   // a far jump slides in from the neighbour
    cur = i; autoT = 0; changed(false);
  }

  // ---- #522 issues and exports ----------------------------------------------------------------------------------------
  let exp = null;   // the running export (MP4 / PDF): its panels stay loaded and playing
  async function loadIssue(m) {   // the desk has already written the issue's media / depth files into this folder
    if (exp) { send({ k: 'cxmsg', t: 'Wait for the export to finish first' }); return; }
    for (const id of [...res.keys()]) dropRes(id);
    panels.length = 0; for (const p of m.panels || []) panels.push({ ...PANEL_DEF, ...p });
    stars.length = 0; for (const st of m.stars || []) stars.push(st);   // #524 the issue's cast travels with it
    Object.assign(cfg, CFG_DEF, m.cfg || {});
    cur = pos = Math.min(Math.max(0, m.cur | 0), Math.max(0, panels.length - 1)); changed(true);
    const d = await dir; let gone = 0;
    if (d) {   // files no panel uses any more (the old issue's): out of storage
      const keep = new Set(['strip.json']); for (const p of panels) { keep.add(p.file); if (p.depth) keep.add(p.depth); }
      const old = []; for await (const [n, h] of d.entries()) if (h.kind === 'file' && !keep.has(n) && !/\.crswap$/.test(n)) old.push(n);
      for (const n of old) { try { await d.removeEntry(n); gone++; } catch {} }
    }
    send({ k: 'cxmsg', t: (panels.length ? `Opened ${cfg.issue || 'the issue'}: ${panels.length} panel${panels.length === 1 ? '' : 's'}` : `New issue: ${cfg.issue || ''}, empty strip`) + (gone ? ` (${gone} old file${gone === 1 ? '' : 's'} cleared)` : '') });
  }
  async function ready(p, ms = 8000) {   // media (and depth map) loaded for a panel
    const r = resOf(p), t0 = performance.now();
    while (!r.tex && performance.now() - t0 < ms) await new Promise(ok => setTimeout(ok, 100));
    if (p.depth) { depthOf(p, r); const t1 = performance.now(); while (!r.dtex && performance.now() - t1 < 3000) await new Promise(ok => setTimeout(ok, 100)); }
    return r;
  }
  const fileBase = () => ('DirroComics ' + (cfg.issue || '') + ' ' + new Date().toISOString().slice(0, 10)).trim().replace(/[^\w#\- ]+/g, '').replace(/\s+/g, '_');
  // MP4: the page as on the club screen, each panel held (video panels for their length, up to 20 s), sliding to the next
  async function exportMp4(m) {
    if (exp) { send({ k: 'cxmsg', t: 'An export is already running' }); return; } if (!panels.length) { send({ k: 'cxmsg', t: 'No panels to export' }); return; }
    const big = +m.res === 1080, W = big ? 1920 : 1280, H = big ? 1080 : 720, hold = Math.max(1, Math.min(20, +m.hold || 4)), tr = 0.8;
    exp = { kind: 'mp4', want: new Set(panels.map(p => p.id)), stop: false };
    send({ k: 'cxmsg', t: 'MP4: loading the panels…' });
    for (const p of panels) await ready(p);
    const segs = []; let total = 0;
    panels.forEach((p, i) => { const r = res.get(p.id), d = p.kind === 'video' && r && r.el && isFinite(r.el.duration) && r.el.duration > 0 ? Math.min(20, Math.max(hold, r.el.duration)) : hold; segs.push({ i, t0: total, hold: d }); total += d + (i < panels.length - 1 ? tr : 0); });
    const rt = mkRT(W, H), buf = new Uint8Array(W * H * 4), c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), img = g.createImageData(W, H);
    const types = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const type = types.find(x => window.MediaRecorder && MediaRecorder.isTypeSupported(x)) || '';
    const track = c.captureStream(0).getVideoTracks()[0], rec = new MediaRecorder(new MediaStream([track]), { mimeType: type || undefined, videoBitsPerSecond: big ? 12e6 : 8e6 }), chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(ok => { rec.onstop = ok; });
    let busy = false, lastSec = -1, segOn = -1; const t0 = performance.now(); rec.start(500);
    await new Promise(fin => {
      const step = () => {
        const now = performance.now(), tt = (now - t0) / 1000;
        if (exp.stop || tt >= total) { fin(); return; }
        let at = 0;
        for (const s of segs) {
          if (tt < s.t0) break;
          if (tt < s.t0 + s.hold) { at = s.i; if (segOn !== s.i) { segOn = s.i; const r = res.get(panels[s.i].id); if (r && r.el && r.el.play) { try { r.el.currentTime = 0; } catch {} r.el.play().catch(() => {}); } } }
          else { const k = Math.min(1, (tt - s.t0 - s.hold) / tr); at = s.i + k * k * (3 - 2 * k); }
        }
        if (!busy) {
          layout(at, now); draw(rt); renderer.setRenderTarget(null); busy = true;
          renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H, buf).then(() => {
            busy = false; for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
            g.putImageData(img, 0, 0); track.requestFrame();
          }).catch(() => { busy = false; });
        }
        const sec = Math.floor(tt); if (sec !== lastSec && sec % 2 === 0) { lastSec = sec; send({ k: 'cxmsg', t: `MP4: recording ${sec} / ${Math.round(total)} s. Keep the DirroVJ window visible.` }); }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    rec.stop(); await stopped; rt.dispose();
    const early = exp.stop, blob = new Blob(chunks, { type: rec.mimeType || type || 'video/webm' }), ext = /mp4/.test(blob.type) ? 'mp4' : 'webm'; exp = null;
    if (!blob.size) { send({ k: 'cxmsg', t: 'MP4: nothing was recorded' }); return; }
    send({ k: 'cxfile', name: fileBase() + '.' + ext, blob });
    send({ k: 'cxmsg', t: `MP4 ready: ${(blob.size / 1e6).toFixed(1)} MB, ${Math.round(total)} s${ext === 'webm' ? ' (this browser records WebM, not MP4)' : ''}${early ? ' (stopped early)' : ''}` });
  }
  // PDF: newspaper strip pages, 4 panels in a row per page, masthead and footer; panels rendered at 2x as on the screen (anaglyph too if on)
  async function exportPdf() {
    if (exp) { send({ k: 'cxmsg', t: 'An export is already running' }); return; } if (!panels.length) { send({ k: 'cxmsg', t: 'No panels to export' }); return; }
    exp = { kind: 'pdf', want: new Set(panels.map(p => p.id)), stop: false };
    try {
      const { pdfFromJpegs } = await import('./cxfiles.js');
      const shots = await shotsOf(2, 'PDF'), pw = shots[0].width, ph = shots[0].height;   // #525 shared with the Instagram files
      const PW = 1000, PH = Math.round(PW * ph / pw), GAP = 36, M = 60, TOP = 150, FOOT = 90, W = M * 2 + PW * 4 + GAP * 3, H = M + TOP + PH + FOOT + 30;
      const pages = [], N = Math.ceil(shots.length / 4), paper = '#f3ead4', ink = '#181514';
      for (let k = 0; k < N; k++) {
        send({ k: 'cxmsg', t: `PDF: page ${k + 1} / ${N}…` });
        const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
        g.fillStyle = paper; g.fillRect(0, 0, W, H); g.fillStyle = ink; g.textBaseline = 'alphabetic';
        g.font = `110px ${FONT.sfx}`; g.textAlign = 'left'; g.fillText('DIRROCOMICS', M, M + 100);
        g.font = `40px ${FONT.cap}`; g.textAlign = 'right'; g.fillText((cfg.issue || '') + '  ·  10 CENTS', W - M, M + 90);
        g.fillRect(M, M + 122, W - M * 2, 7);
        for (let j = 0; j < 4; j++) { const s = shots[k * 4 + j]; if (s) g.drawImage(s, M + j * (PW + GAP), M + TOP, PW, PH); }
        g.font = `34px ${FONT.cap}`; g.textAlign = 'left'; g.fillText(`PAGE ${k + 1} / ${N}`, M, H - 40);
        g.textAlign = 'right'; g.fillText(cfg.foot || '', W - M, H - 40);
        const jpeg = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.9));
        pages.push({ jpeg, w: W, h: H, pw: 842, ph: 842 * H / W });   // A4 landscape width, strip height
      }
      const pdf = await pdfFromJpegs(pages, { title: 'DirroComics ' + (cfg.issue || ''), author: 'DirroDJ' });
      send({ k: 'cxfile', name: fileBase() + '.pdf', blob: pdf });
      send({ k: 'cxmsg', t: `PDF ready: ${N} page${N === 1 ? '' : 's'}, ${(pdf.size / 1e6).toFixed(1)} MB` });
    } finally { exp = null; }
  }
  // ---- #525 every panel and its frame as on the screen (anaglyph too if on), S x the reference size; videos at ~0.5 s
  async function shotsOf(S, label) {
    const rt = mkRT(REF.W * S, REF.H * S), pw = (REF.pw + 10) * S, ph = (REF.ph + 10) * S, buf = new Uint8Array(pw * ph * 4), shots = [];
    try {
      for (let i = 0; i < panels.length; i++) {
        if (exp && exp.stop) throw new Error('stopped');
        send({ k: 'cxmsg', t: `${label}: panel ${i + 1} / ${panels.length}…` });
        const p = panels[i], r = await ready(p);
        if (p.kind === 'video' && r.el) { try { r.el.pause(); r.el.currentTime = Math.min(0.5, (r.el.duration || 1) / 3); await new Promise(ok => { r.el.onseeked = ok; setTimeout(ok, 1500); }); } catch {} if (r.tex) r.tex.needsUpdate = true; }
        layout(i, performance.now() + 1e6); draw(rt); renderer.setRenderTarget(null);
        renderer.readRenderTargetPixels(rt, (REF.x - 5) * S, (REF.H - REF.top - REF.ph - 5) * S, pw, ph, buf);   // the panel and its frame only
        shots.push(toCanvas(buf, pw, ph));
      }
    } finally { rt.dispose(); }
    return shots;
  }
  function toCanvas(buf, w, h, c) {   // GL rows (bottom first) -> a 2D canvas
    if (!c) { c = document.createElement('canvas'); c.width = w; c.height = h; }
    const g = c.getContext('2d'), im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) im.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    g.putImageData(im, 0, 0); return c;
  }

  // ---- #525 Instagram files, posted by hand from the phone. REEL: 9:16 MP4 (1080 x 1920), the strip scrolling down like a
  // webtoon, cover first. CAROUSEL: 4:5 JPEGs (1080 x 1350), a cover + one slide per panel, zipped; at most 20 slides per post
  // (Instagram's limit), so a long strip is split into posts, each with its own cover.
  const PAPER = '#f3ead4', INK = '#181514', PAN_AR = (REF.ph + 10) / (REF.pw + 10), CREDIT = 'BY CLY3DJ / DIRRODJ';
  const dateLine = () => new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  function gearAt(g, gx, gy, R) {
    for (let k = 0; k < 10; k++) { const a = 2 * Math.PI * k / 10; g.save(); g.translate(gx + R * Math.cos(a), gy + R * Math.sin(a)); g.rotate(a); g.fillRect(-R * 0.26, -R * 0.26, R * 0.52, R * 0.52); g.restore(); }
    g.beginPath(); g.arc(gx, gy, R * 0.92, 0, 7); g.arc(gx, gy, R * 0.36, 0, 7, true); g.fill('evenodd');
  }
  function mastSmall(g, W) {   // slide / reel header: DIRROCOMICS + gear left, issue right, rule
    g.fillStyle = INK; g.textBaseline = 'alphabetic'; g.font = `84px ${FONT.sfx}`; g.textAlign = 'left'; g.fillText('DIRROCOMICS', 40, 104);
    gearAt(g, 40 + g.measureText('DIRROCOMICS').width + 46, 72, 24);
    g.font = `32px ${FONT.cap}`; g.textAlign = 'right'; g.fillText(cfg.issue || '', W - 40, 98);
    g.fillRect(40, 124, W - 80, 6);
  }
  function wrapLines(g, text, maxw, max) {
    const out = []; let line = '';
    for (const w of String(text).split(/\s+/)) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxw && line) { out.push(line); line = w; } else line = t; }
    if (line) out.push(line); if (out.length > max) { out.length = max; out[max - 1] += '…'; } return out;
  }
  function castNames() {   // guests who are in this issue (their photo panel, or a line they said YES to)
    const on = st => panels.some(p => p.star === st.dev || (p.items || []).some(it => it && it.star === st.dev && it.ok === 'yes' && it.askText === it.text));
    return stars.filter(st => !st.wd && on(st)).map(st => st.name);
  }
  function drawCover(g, W, H, shot, o = {}) {
    g.fillStyle = PAPER; g.fillRect(0, 0, W, H); g.fillStyle = INK; g.textBaseline = 'alphabetic';
    const fs = Math.round(W * 0.15); g.font = `${fs}px ${FONT.sfx}`; const tw = g.measureText('DIRROCOMICS').width, R = fs * 0.3, gap = fs * 0.22, x0 = (W - tw - gap - R * 2) / 2, top = H > 1500 ? 200 : 70;
    g.textAlign = 'left'; g.fillText('DIRROCOMICS', x0, top + fs * 0.85); gearAt(g, x0 + tw + gap + R, top + fs * 0.48, R);
    g.font = `38px ${FONT.cap}`; g.textAlign = 'center'; g.fillText([cfg.issue, dateLine(), '10 CENTS'].filter(Boolean).join('  ·  ') + (o.parts > 1 ? `  ·  PART ${o.part} / ${o.parts}` : ''), W / 2, top + fs + 46);
    g.fillRect(40, top + fs + 72, W - 80, 7);
    const cast = castNames(); g.font = `36px ${FONT.cap}`;
    const castL = cast.length ? wrapLines(g, 'STARRING ' + cast.join(', '), W - 120, 2) : [];
    const bottom = 70 + 74 + castL.length * 46 + (o.swipe ? 56 : 0) + (H > 1500 ? 260 : 0);   // reels: keep clear of Instagram's caption area
    const PW = W - 80, PH = Math.round(PW * PAN_AR), y0 = top + fs + 96, py = Math.round(y0 + Math.max(0, (H - bottom - y0 - PH) / 2));
    if (shot) g.drawImage(shot, 40, py, PW, PH); else { g.lineWidth = 6; g.strokeRect(43, py + 3, PW - 6, PH - 6); }
    let y = py + PH + 70; g.fillStyle = INK; g.textAlign = 'center';
    for (const l of castL) { g.fillText(l, W / 2, y); y += 46; }
    g.font = `64px ${FONT.sfx}`; g.fillText(CREDIT, W / 2, y + 30); y += 30;
    if (o.swipe) { g.font = `32px ${FONT.cap}`; g.fillText('SWIPE FOR THE STRIP  >', W / 2, y + 60); }
  }
  function drawSlide(g, W, H, shot, i, n) {
    g.fillStyle = PAPER; g.fillRect(0, 0, W, H); mastSmall(g, W);
    const PW = W - 80, PH = Math.round(PW * PAN_AR), py = Math.round(150 + (H - 110 - 150 - PH) / 2);
    g.drawImage(shot, 40, py, PW, PH);
    g.fillStyle = INK; g.font = `30px ${FONT.cap}`; g.textAlign = 'left'; g.fillText(`PANEL ${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`, 40, H - 48);
    g.textAlign = 'right'; g.fillText(cfg.foot || '', W - 40, H - 48);
  }
  const jpegOf = c => new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.92));
  async function exportCarousel() {
    if (exp) { send({ k: 'cxmsg', t: 'An export is already running' }); return; } if (!panels.length) { send({ k: 'cxmsg', t: 'No panels to export' }); return; }
    exp = { kind: 'carousel', want: new Set(panels.map(p => p.id)), stop: false };
    try {
      const shots = await shotsOf(2, 'CAROUSEL'), { zipFiles } = await import('./cxfiles.js');
      const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
      const per = 19, parts = Math.ceil(shots.length / per), files = [], cover = shots[Math.min(cur, shots.length - 1)];
      for (let k = 0; k < parts; k++) {
        const dirn = parts > 1 ? `post ${k + 1}/` : '';
        drawCover(g, W, H, cover, { part: k + 1, parts, swipe: true }); files.push({ name: dirn + '01_cover.jpg', blob: await jpegOf(c) });
        for (let j = k * per; j < Math.min(shots.length, (k + 1) * per); j++) {
          if (exp.stop) throw new Error('stopped');
          send({ k: 'cxmsg', t: `CAROUSEL: slide ${j + 1} / ${shots.length}…` });
          drawSlide(g, W, H, shots[j], j, shots.length); files.push({ name: dirn + String(j - k * per + 2).padStart(2, '0') + '.jpg', blob: await jpegOf(c) });
        }
      }
      const zip = await zipFiles(files);
      send({ k: 'cxfile', name: fileBase() + '_carousel.zip', blob: zip });
      send({ k: 'cxmsg', t: `CAROUSEL ready: ${files.length} slides${parts > 1 ? ` in ${parts} posts (20 slides max per post)` : ''}, ${(zip.size / 1e6).toFixed(1)} MB. Unzip on the phone, post the JPEGs in order.` });
    } finally { exp = null; }
  }
  async function exportReel(m) {
    if (exp) { send({ k: 'cxmsg', t: 'An export is already running' }); return; } if (!panels.length) { send({ k: 'cxmsg', t: 'No panels to export' }); return; }
    exp = { kind: 'reel', want: new Set(panels.map(p => p.id)), stop: false };
    const rts = [];
    try {
      const hold = Math.max(1, Math.min(20, +m.hold || 4)), tr = 0.8, cov = 2.5;
      send({ k: 'cxmsg', t: 'REEL: loading the panels…' });
      for (const p of panels) await ready(p);
      const still = await shotsOf(1, 'REEL');   // the panels off focus (peeks, cover)
      const segs = []; let total = cov;
      panels.forEach((p, i) => { const r = res.get(p.id), d = p.kind === 'video' && r && r.el && isFinite(r.el.duration) && r.el.duration > 0 ? Math.min(20, Math.max(hold, r.el.duration)) : hold; segs.push({ i, t0: total, hold: d }); total += d + (i < panels.length - 1 ? tr : 0); });
      total += 0.5;
      const W = 1080, H = 1920, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
      const PW = W - 80, PH = Math.round(PW * PAN_AR), TOPB = 150, FOOT = 1640, Y0 = Math.round((TOPB + FOOT) / 2 - PH / 2), STEP = PH + 40;   // FOOT: above Instagram's caption area
      const pw = REF.pw + 10, ph = REF.ph + 10; for (let j = 0; j < 2; j++) rts.push({ rt: mkRT(REF.W, REF.H), buf: new Uint8Array(pw * ph * 4), c: null });
      const coverShot = still[Math.min(cur, still.length - 1)];
      const types = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
      const type = types.find(x => window.MediaRecorder && MediaRecorder.isTypeSupported(x)) || '';
      const track = c.captureStream(0).getVideoTracks()[0], rec = new MediaRecorder(new MediaStream([track]), { mimeType: type || undefined, videoBitsPerSecond: 10e6 }), chunks = [];
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise(ok => { rec.onstop = ok; });
      function compose(at, live) {
        g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
        g.save(); g.beginPath(); g.rect(0, TOPB, W, FOOT - TOPB); g.clip();
        for (let k = Math.floor(at) - 2; k <= Math.floor(at) + 2; k++) {
          const img = live.get(k) || still[k]; if (!img) continue;
          const y = Math.round(Y0 + (k - at) * STEP); if (y > FOOT || y + PH < TOPB) continue;
          g.drawImage(img, 40, y, PW, PH);
          const dim = 0.3 * Math.min(1, Math.abs(k - at)); if (dim > 0.002) { g.globalAlpha = dim; g.fillStyle = PAPER; g.fillRect(40, y, PW, PH); g.globalAlpha = 1; }
        }
        g.restore(); mastSmall(g, W);
        g.fillStyle = INK; g.font = `30px ${FONT.cap}`; g.textAlign = 'left'; const n = Math.round(at);
        g.fillText(`PANEL ${String(n + 1).padStart(2, '0')} / ${String(panels.length).padStart(2, '0')}`, 40, FOOT + 50);
        g.textAlign = 'right'; g.fillText(cfg.foot || '', W - 40, FOOT + 50);
      }
      let busy = false, lastSec = -1, segOn = -1; const t0 = performance.now(); rec.start(500);
      await new Promise(fin => {
        const step = () => {
          const now = performance.now(), tt = (now - t0) / 1000;
          if (exp.stop || tt >= total) { fin(); return; }
          if (tt < cov) { if (!busy) { drawCover(g, W, H, coverShot, {}); track.requestFrame(); } requestAnimationFrame(step); return; }
          let at = 0;
          for (const s of segs) {
            if (tt < s.t0) break;
            if (tt < s.t0 + s.hold) { at = s.i; if (segOn !== s.i) { segOn = s.i; const r = res.get(panels[s.i].id); if (r && r.el && r.el.play) { try { r.el.currentTime = 0; } catch {} r.el.play().catch(() => {}); } } }
            else { const k = Math.min(1, (tt - s.t0 - s.hold) / tr); at = s.i + k * k * (3 - 2 * k); }
          }
          if (!busy) {   // the panel(s) in focus rendered live (video plays), the rest from the stills
            busy = true; const f0 = Math.floor(at), focus = at - f0 > 0.001 && f0 + 1 < panels.length ? [f0, f0 + 1] : [f0], jobs = [];
            focus.forEach((f, j) => {
              const R = rts[j]; layout(f, now); draw(R.rt);
              jobs.push(renderer.readRenderTargetPixelsAsync(R.rt, REF.x - 5, REF.H - REF.top - REF.ph - 5, pw, ph, R.buf).then(() => { R.c = toCanvas(R.buf, pw, ph, R.c); return [f, R.c]; }));
            });
            renderer.setRenderTarget(null);
            Promise.all(jobs).then(done => { compose(at, new Map(done)); track.requestFrame(); busy = false; }).catch(() => { busy = false; });
          }
          const sec = Math.floor(tt); if (sec !== lastSec && sec % 2 === 0) { lastSec = sec; send({ k: 'cxmsg', t: `REEL: recording ${sec} / ${Math.round(total)} s. Keep the DirroVJ window visible.` }); }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      rec.stop(); await stopped;
      const early = exp.stop, blob = new Blob(chunks, { type: rec.mimeType || type || 'video/webm' }), ext = /mp4/.test(blob.type) ? 'mp4' : 'webm';
      if (!blob.size) { send({ k: 'cxmsg', t: 'REEL: nothing was recorded' }); return; }
      send({ k: 'cxfile', name: fileBase() + '_reel.' + ext, blob });
      send({ k: 'cxmsg', t: `REEL ready: ${(blob.size / 1e6).toFixed(1)} MB, ${Math.round(total)} s, 1080 x 1920${ext === 'webm' ? ' (this browser records WebM: convert to MP4 before posting)' : ''}${early ? ' (stopped early)' : ''}` });
    } finally { for (const R of rts) R.rt.dispose(); exp = null; }
  }
  // ---- grabs: the Quest picture (the studio composite) or this laptop's webcam
  function grab(src) {
    grabReq = null; const c = document.createElement('canvas');
    if (src === 'webcam') {
      const v = fixed && fixed.video; if (!fixed || !fixed.on || !v || !v.videoWidth) { send({ k: 'cxmsg', t: 'WEBCAM is off: start it on the DirroVJ page' }); return; }
      c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
    } else {
      if (!lastQ || !lastQ.image) { send({ k: 'cxmsg', t: 'No Quest picture yet' }); return; }
      const w = lastQ.image.width, h = lastQ.image.height, rt = mkRT(w, h), buf = new Uint8Array(w * h * 4);
      copyU.t.value = lastQ; renderer.setRenderTarget(rt); renderer.render(copySc, oc); renderer.setRenderTarget(null);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf); rt.dispose();
      c.width = w; c.height = h; const g = c.getContext('2d'), im = g.createImageData(w, h);
      for (let y = 0; y < h; y++) im.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      for (let i = 3; i < im.data.length; i += 4) im.data[i] = 255; g.putImageData(im, 0, 0);
    }
    c.toBlob(b => { if (b) addMedia(b, (src === 'webcam' ? 'webcam-' : 'quest-') + new Date().toTimeString().slice(0, 8).replace(/:/g, '') + '.jpg'); }, 'image/jpeg', 0.92);
  }
  // ---- desk messages
  function sendList() { send({ k: 'cxlist', ver, thumbs: Object.fromEntries(panels.map(p => [p.id, p.thumb || ''])), starImgs: Object.fromEntries(stars.map(s => [s.cid, s.img || ''])) }); }
  function onMsg(m) {
    const op = m.op, p = m.id ? panels.find(x => x.id === m.id) : null;
    if (op === 'add') { for (const f of m.files || []) addMedia(f.blob, f.name || 'file'); }
    else if (op === 'grab' && (m.src === 'rgbd' || m.src === 'rgbds')) {   // #520 the Quest records; the file comes back through vjdesk.js -> addMedia
      const err = requestRgbd ? requestRgbd(m.src === 'rgbds') : 'not available here'; send({ k: 'cxmsg', t: err ? 'GRAB RGB-D: ' + err : 'GRAB RGB-D: asked the Quest…' });
    }
    else if (op === 'grab') grabReq = m.src === 'webcam' ? 'webcam' : 'quest';
    else if (op === 'set' && p) {
      const v = m.v || {};
      if (Array.isArray(v.items)) for (const it of v.items) {   // #524 an answer that came in while the desk had an older copy wins
        const was = it && it.ask && (p.items || []).find(x => x && x.ask === it.ask);
        if (was && (was.ok === 'yes' || was.ok === 'no') && it.ok === 'asked' && it.text === was.askText) { it.ok = was.ok; it.cid = was.cid; }
      }
      for (const k of Object.keys(PANEL_DEF)) if (k in v) p[k] = k === 'items' ? (Array.isArray(v.items) ? v.items.slice(0, 12) : p.items) : v[k];
      if ('sbs' in v && res.get(p.id)) { const r = res.get(p.id); if (r.el) p.thumb = thumbOf(r.el, p.w, p.h, p.sbs); }
      changed('sbs' in v);
    }
    else if (op === 'move' && p) { const i = panels.indexOf(p), j = i + (m.d < 0 ? -1 : 1); if (j >= 0 && j < panels.length) { const onAir = panels[cur]; panels.splice(i, 1); panels.splice(j, 0, p); cur = pos = panels.indexOf(onAir); changed(true); } }
    else if (op === 'del' && p) { const onAir = panels[cur], i = panels.indexOf(p); panels.splice(i, 1); dropRes(p.id); if (!panels.some(x => x.file === p.file)) removeFile(p.file); /* dup shares the file */ if (p.depth && !panels.some(x => x.depth === p.depth)) removeFile(p.depth); cur = pos = Math.max(0, onAir === p ? Math.min(i, panels.length - 1) : panels.indexOf(onAir)); changed(true); }
    else if (op === 'dup' && p) { const q = JSON.parse(JSON.stringify(p)); q.id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); panels.splice(panels.indexOf(p) + 1, 0, q); changed(true); }   // same media file, new text
    else if (op === 'go') go(p ? panels.indexOf(p) : m.i);
    else if (op === 'next') go(cur + 1 >= panels.length ? 0 : cur + 1);
    else if (op === 'prev') go(cur - 1 < 0 ? panels.length - 1 : cur - 1);
    else if (op === 'cfg') { for (const k of Object.keys(CFG_DEF)) if (m.v && k in m.v) cfg[k] = m.v[k]; changed(false); }
    else if (op === 'watch') { watchId = m.id || null; watchT = performance.now(); }
    else if (op === 'list') sendList();
    else if (op === 'load') loadIssue(m);   // #522 OPEN ISSUE / NEW ISSUE
    else if (op === 'starpanel') { const st = stars.find(x => x.cid === m.cid); if (st && !st.wd && st.img) fetch(st.img).then(r => r.blob()).then(b => addMedia(b, 'star-' + st.name.replace(/[^\w-]+/g, '_') + '.jpg', { star: st.dev, starCid: st.cid })); }   // #524
    else if (op === 'ask' && p) askLine(p, m.i);
    else if (op === 'clog') { const e = relayAsk ? relayAsk({ k: 'vjclog' }) : 'not available'; send({ k: 'cxmsg', t: e ? 'CONSENT LOG: ' + e : 'CONSENT LOG: asked the relay…' }); }
    else if (op === 'mp4') exportMp4(m).catch(e => { exp = null; send({ k: 'cxmsg', t: 'MP4 failed: ' + e.message }); });
    else if (op === 'pdf') exportPdf(m).catch(e => { exp = null; send({ k: 'cxmsg', t: 'PDF failed: ' + e.message }); });
    else if (op === 'reel') exportReel(m).catch(e => { exp = null; send({ k: 'cxmsg', t: 'REEL failed: ' + e.message }); });   // #525
    else if (op === 'carousel') exportCarousel(m).catch(e => { exp = null; send({ k: 'cxmsg', t: 'CAROUSEL failed: ' + e.message }); });
    else if (op === 'expstop') { if (exp) exp.stop = true; }
  }
  function state() { return { cfg: { ...cfg }, cur, ver, panels: panels.map(({ thumb, ...p }) => p), REF, store, stars: stars.map(({ img, ...s }) => s) }; }
  // ---- #524 STAR IN IT: cards from guests' phones (logged by the relay first), YES / NO on lines, withdrawals, the consent log
  async function sha(blob) { const b = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())); return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); }
  async function askLine(p, i) {
    const it = p.items && p.items[i], st = it && stars.find(x => x.dev === it.star && !x.wd);
    if (!it || !st || !it.text) { send({ k: 'cxmsg', t: 'ASK: pick a guest as the speaker and write the line first' }); return; }
    const ask = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), f = await readFile(p.file), media = f ? await sha(f) : '';
    it.ask = ask; it.ok = 'asked'; it.askText = it.text; delete it.cid; changed(false);
    const e = relayAsk ? relayAsk({ k: 'vjask', dev: st.dev, ask, text: it.text, who: st.name, kind: it.t, media, panel: p.id }) : 'not available';
    send({ k: 'cxmsg', t: e ? 'ASK: ' + e : `ASK: sent to ${st.name}'s phone` });
  }
  async function onStar(m) {
    if (m.k === 'star') {
      if (stars.some(x => x.cid === m.cid)) return;
      stars.push({ cid: m.cid, seq: m.seq, at: m.at, dev: m.dev, name: m.name, genre: m.genre, lines: m.lines || [], img: m.img, media: m.media, wd: false });
      changed(true); send({ k: 'cxmsg', t: `⭐ ${m.name} joined the cast (${m.genre})` });
    } else if (m.k === 'ans') {
      let n = 0; for (const p of panels) for (const it of p.items || []) if (it && it.ask === m.ask) { it.ok = m.yes ? 'yes' : 'no'; it.cid = m.cid; n++; if (res.get(p.id)) res.get(p.id).ov.key = ''; }
      const st = stars.find(x => x.dev === m.dev); if (n) changed(false); send({ k: 'cxmsg', t: `${st ? st.name : 'A guest'} said ${m.yes ? 'YES' : 'NO'}` });
    } else if (m.k === 'wd') {   // their panels and their lines come out; the card stays, marked, for the record
      let gone = 0, lines = 0;
      for (const st of stars) if (st.dev === m.dev) { st.wd = true; st.wdCid = m.cid; }
      for (const p of panels) { const n = (p.items || []).length; p.items = (p.items || []).filter(it => !(it && it.star === m.dev)); lines += n - p.items.length; }
      for (let i = panels.length - 1; i >= 0; i--) if (panels[i].star === m.dev) { const p = panels[i]; panels.splice(i, 1); dropRes(p.id); if (!panels.some(x => x.file === p.file)) removeFile(p.file); gone++; }
      cur = pos = Math.min(cur, Math.max(0, panels.length - 1)); for (const r of res.values()) r.ov.key = '';
      changed(true); send({ k: 'cxmsg', t: `A guest withdrew: ${gone} panel${gone === 1 ? '' : 's'} and ${lines} line${lines === 1 ? '' : 's'} removed` });
    } else if (m.k === 'clog') {   // check the chain, then hand the desk a JSON-lines file
      const items = m.items || [], enc = new TextEncoder(); let ok = true, prev = 'GENESIS';
      for (const x of items) { const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(x.prev + x.rec)))].map(v => v.toString(16).padStart(2, '0')).join(''); if (x.prev !== prev || h !== x.hash) { ok = false; break; } prev = x.hash; }
      const body = items.map(x => JSON.stringify({ seq: x.seq, rec: JSON.parse(x.rec), prev: x.prev, hash: x.hash })).join('\n') + '\n';
      send({ k: 'cxfile', name: 'DirroComics_consent_' + new Date().toISOString().slice(0, 10) + '.jsonl', blob: new Blob([body], { type: 'application/jsonl' }) });
      send({ k: 'cxmsg', t: `CONSENT LOG: ${items.length} records, chain ${ok ? 'OK' : 'BROKEN'}${items.length ? ', last hash ' + items[items.length - 1].hash.slice(0, 16) + '…' : ''}` });
    }
  }
  return { tick, render, onMsg, state, sendList, get used() { return panels.length > 0; }, _panels: panels, _cfg: cfg, _res: res, _slots: slots, onStar, _stars: stars };
}
