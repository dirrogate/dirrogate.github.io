// #662 DIRROVERSE: a Cyber-Window set (the club_window studio on this laptop, 127.0.0.1:8090) as a DirroVJ bus source.
// The studio bakes the heavy look into plate_loop.mp4 (rain, fog, signs, sprites; windows left black) plus window_mask.png and
// spill.png. Here one shader puts the live webcam behind every club window (each window's homography and clip framing from
// set.json), grades it like the studio does, and lets its light spill onto the plate. ARRIVAL clips (arrival_<name>.mp4, rendered by
// the studio with a typed name on the car) play in place of the loop and hand back to it at their end.
export const STUDIO = 'http://127.0.0.1:8090';

function solve(A, b) { const n = b.length; for (let i = 0; i < n; i++) { let m = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r; [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
  for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; } }
  const x = new Array(n); for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; } return x; }
function homog(src, dst) { const A = [], b = []; for (let i = 0; i < 4; i++) { const [x, y] = src[i], [u, v] = dst[i];
  A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u); A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v); } return [...solve(A, b), 1]; }

const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const FS = `uniform sampler2D tBase, tMask, tSpill, tCam, tFog; uniform vec2 plate, camSz; uniform int nW; uniform mat3 Hm[4]; uniform vec4 fp[4];
uniform float sil[4]; uniform float crop, spillK, cutOld, camOn, match, mist, rainK, reflK, fogOn, time; uniform vec3 grade, camLight, camMean, camStd, tgtMean, tgtStd;
varying vec2 vUv;
vec3 lin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); } vec3 gam(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec3 bl = lin(texture2D(tBase, vUv).rgb); float m = texture2D(tMask, vUv).r; float sp = texture2D(tSpill, vUv).r;
  vec2 P = vec2(vUv.x, 1.0 - vUv.y) * plate;                    // plate px, y down (as set.json)
  vec3 club = vec3(0.0); float hit = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= nW) break;
    vec3 q = Hm[i] * vec3(P, 1.0); vec2 uv = q.xy / q.z;
    if (hit < 0.5 && uv.x >= -0.01 && uv.x <= 1.01 && uv.y >= -0.01 && uv.y <= 1.01) {
      float chf = crop * camSz.y / max(0.05, fp[i].z), cwf = chf * fp[i].w;
      vec2 f = vec2(camSz.x * fp[i].x + (uv.x - 0.5) * cwf, camSz.y * fp[i].y + (uv.y - 0.5) * chf);
      // drops on the glass: beads in a grid of cells, each refracting and darkening its rim, slowly coming and going
      vec2 gc = uv * vec2(18.0, 26.0), ci = floor(gc), cf = fract(gc) - 0.5; float hh = h21(ci + floor(time * 0.05 + h21(ci) * 7.0));
      float rr = (0.12 + 0.22 * hh) * step(0.55, h21(ci * 1.7 + 3.1)) * rainK; float dd = length(cf);
      float bead = rr > 0.0 ? smoothstep(rr, rr * 0.7, dd) : 0.0, rim = rr > 0.0 ? smoothstep(rr * 0.55, rr, dd) * bead : 0.0;
      vec2 cuv = vec2(f.x / camSz.x, 1.0 - f.y / camSz.y) - vec2(cf.x, -cf.y) * bead * 0.06;
      vec3 cs = texture2D(tCam, clamp(cuv, 0.0, 1.0)).rgb;
      cs = mix(cs, clamp((cs - camMean) / max(camStd, vec3(0.02)) * tgtStd + tgtMean, 0.0, 1.0), match);   // the scene's palette
      vec3 c = lin(cs);
      c = c * grade.x * vec3(1.0 + grade.y, 1.0, 1.0 - 1.3 * grade.y);
      c = 0.18 * pow(max(c, 0.0) / 0.18, vec3(grade.z));
      if (sil[i] > 0.0) { float lu = dot(c, vec3(0.2126, 0.7152, 0.0722)); float keep = 0.15 + 0.85 * smoothstep(1.6, 4.5, lu / 0.18); c *= 1.0 - sil[i] * (1.0 - keep); }
      float mi = mist * (0.55 + 0.45 * smoothstep(0.25, 0.0, uv.y) + 0.6 * smoothstep(0.65, 1.0, uv.y)) * (1.0 - bead);   // condensation, heavier top and bottom
      float lu2 = dot(c, vec3(0.2126, 0.7152, 0.0722)); c += ((vec3(lu2) + 0.55 * (c - vec3(lu2))) * 0.8 + vec3(0.016, 0.02, 0.026) - c) * mi * 0.6;
      c *= (1.0 - 0.45 * rim) * (1.0 + 0.1 * bead);
      c += lin(texture2D(tBase, vec2(1.0 - vUv.x, vUv.y)).rgb) * reflK;   // the street in the glass
      club = c; hit = 1.0;
    }
  }
  float fd = fogOn * clamp(texture2D(tFog, vUv).r * 3.0 * (0.3 + 0.7 * vnoise(vUv * vec2(6.4, 4.8) + vec2(time * 0.012, 0.0))) * 0.2, 0.0, 0.85);
  club = club * (1.0 - fd) + vec3(0.05, 0.058, 0.07) * fd;   // the set's fog over the live window, as over the plate
  float k = m * hit * camOn;
  vec3 lit = bl * (1.0 + sp * camOn * (1.0 - m) * (camLight * spillK - cutOld));   // the club's light on the wall, sill and wet ground
  gl_FragColor = vec4(gam(mix(lit, club, k)), 1.0);
}`;

export function makeDirroverse({ THREE, renderer, camTex, camVideo, S, post }) {
  function mkVideo(loop) { const v = document.createElement('video'); v.crossOrigin = 'anonymous'; v.muted = true; v.loop = loop; v.playsInline = true; v.preload = 'auto'; return v; }
  const vtex = v => { const t = new THREE.VideoTexture(v); t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = t.magFilter = THREE.LinearFilter; return t; };
  // #707 two loop players: the next scene loads in the idle one while the current plays, then a clean cut (no black frame)
  const vids = [mkVideo(true), mkVideo(true)], tLoops = vids.map(vtex), arr = mkVideo(false), tArr = vtex(arr), ld = new THREE.TextureLoader(); ld.setCrossOrigin('anonymous');
  let cur = 0;
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
  const U = { tBase: { value: tLoops[0] }, tMask: { value: black }, tSpill: { value: black }, tCam: { value: camTex }, plate: { value: new THREE.Vector2(1920, 1080) },
    camSz: { value: new THREE.Vector2(1280, 720) }, nW: { value: 0 }, Hm: { value: [0, 1, 2, 3].map(() => new THREE.Matrix3()) },
    fp: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0.4, 0.5, 1, 0.72)) }, sil: { value: [0, 0, 0, 0] }, crop: { value: 0.86 },
    grade: { value: new THREE.Vector3(2.3, 0.06, 0.88) }, camLight: { value: new THREE.Vector3(1, 1, 1) }, spillK: { value: 0.95 }, cutOld: { value: 0.5 }, camOn: { value: 1 },
    tFog: { value: black }, match: { value: 0.7 }, mist: { value: 0.35 }, rainK: { value: 0.7 }, reflK: { value: 0.07 }, fogOn: { value: 0 }, time: { value: 0 },
    camMean: { value: new THREE.Vector3(0.3, 0.3, 0.3) }, camStd: { value: new THREE.Vector3(0.2, 0.2, 0.2) }, tgtMean: { value: new THREE.Vector3(0.3, 0.3, 0.3) }, tgtStd: { value: new THREE.Vector3(0.2, 0.2, 0.2) } };
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: FS, depthTest: false, depthWrite: false });
  const sc = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); mesh.frustumCulled = false; sc.add(mesh);
  const oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let rt = null, W = 1920, H = 1080, ready = false, air = false, pending = null, loadSeq = 0;
  // the webcam's average colour, a few times a second (the light the club throws out of the windows)
  const avc = document.createElement('canvas'); avc.width = avc.height = 8; const avx = avc.getContext('2d', { willReadFrequently: true });
  let avT = 0, light = [0.25, 0.2, 0.3];
  function camAvg(now) {
    if (now - avT < 250 || !camVideo || !camVideo.videoWidth) return; avT = now;
    try { avx.drawImage(camVideo, 0, 0, 8, 8); const d = avx.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += (d[i] / 255) ** 2.2; g += (d[i + 1] / 255) ** 2.2; b += (d[i + 2] / 255) ** 2.2; }
      { const st = stats(d); U.camMean.value.lerp(new THREE.Vector3(...st.m), 0.3); U.camStd.value.lerp(new THREE.Vector3(...st.s), 0.3); }
      const n = d.length / 4, c = [r / n, g / n, b / n].map(x => x * U.grade.value.x), up = c.map((x, i) => x > light[i]);
      light = light.map((x, i) => x + (c[i] - x) * (up[i] ? 0.65 : 0.18));               // fast attack, slow release (as the studio)
      const lum = Math.max(1e-4, 0.2126 * light[0] + 0.7152 * light[1] + 0.0722 * light[2]), inten = Math.min(2.8, Math.max(0.2, 0.25 + 2.6 * lum));
      U.camLight.value.set(...light.map(x => Math.min(3, Math.max(0.15, x / lum)) * inten));
    } catch {}
  }
  function stats(d) { const m = [0, 0, 0], q = [0, 0, 0], n = d.length / 4; for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) { const v = d[i + c] / 255; m[c] += v; q[c] += v * v; }
    return { m: m.map(x => x / n), s: m.map((x, c) => Math.sqrt(Math.max(1e-5, q[c] / n - (x / n) ** 2))) }; }
  function plateStats(url) {   // the plate's palette (32 x 32 of its first frame), the target for the webcam's colours
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { try { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); x.drawImage(im, 0, 0, 32, 32); const st = stats(x.getImageData(0, 0, 32, 32).data);
      U.tgtMean.value.set(...st.m); U.tgtStd.value.set(...st.s); } catch {} };
    im.src = url;
  }
  async function j(u, body) { const r = await fetch(STUDIO + u, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.json(); }
  async function list() {
    try { const st = await j('/api/status'); S.sets = st.sets || []; S.studio = 'ok'; }
    catch (e) { S.studio = 'no studio: start start_set_builder.bat on this laptop (Cyber-Window studio, port 8090)'; S.sets = []; post(); return; }
    // #707 DirroVerses = banks of scenes, kept by the studio in club_window/verses.json
    try { const r = await fetch(STUDIO + '/api/verses'); if (!r.ok) throw new Error(r.status); const v = await r.json();
      S.verses = (v.verses || []).filter(x => x && x.name).map(x => ({ name: String(x.name), scenes: (x.scenes || []).map(String) })); S.versesErr = ''; }
    catch { S.verses = S.verses || []; S.versesErr = 'Restart the studio once (start_set_builder.bat) so it can keep DirroVerses.'; }
    if (S.set) { S.files = await filesOf(S.set); S.arrivals = S.files.filter(x => /^arrival_.*\.mp4$/i.test(x)); }
    post();
  }
  async function filesOf(name) { try { return (await j(`/api/set/${encodeURIComponent(name)}/files`)).files || []; } catch { return []; } }
  const texLoad = url => new Promise(res => ld.load(url, t => { t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = t.magFilter = THREE.LinearFilter; res(t); }, undefined, () => res(null)));
  const canPlay = v => new Promise(res => {
    if (v.readyState >= 2) return res(true);
    const done = ok => { v.removeEventListener('loadeddata', a); v.removeEventListener('error', b); clearTimeout(t); res(ok); }, a = () => done(true), b = () => done(false);
    v.addEventListener('loadeddata', a); v.addEventListener('error', b); const t = setTimeout(() => done(v.readyState >= 2), 12000);
  });
  const drop = nx => { if (nx) for (const t of [nx.mask, nx.spill, nx.fog]) if (t) t.dispose(); };
  // load a scene. defer: get it ready in the idle player and wait for commit() (the cut on the bar); otherwise cut as soon as it plays
  async function load(name, opt = {}) {
    const seq = ++loadSeq; if (pending) { drop(pending); pending = null; }
    S.loading = name; if (!ready) S.status = 'loading ' + name + '…'; post();
    try {
      const set = await j('/api/set/' + encodeURIComponent(name)), fl = await filesOf(name);
      if (seq !== loadSeq) return false;
      if (!fl.includes('plate_loop.mp4')) { S.loading = ''; S.status = `"${name}" has no plate loop yet: render "Plate loop" in the studio (or on the DIRROVERSE page).`; post(); return false; }
      const t = Date.now(), base = `${STUDIO}/sets/${encodeURIComponent(name)}/`, idx = ready ? 1 - cur : cur, v = vids[idx];
      v.src = base + 'plate_loop.mp4?' + t; v.load();
      const [mask, spill, fog] = await Promise.all([texLoad(base + 'window_mask.png?' + t), texLoad(base + 'spill.png?' + t), fl.includes('fog.png') ? texLoad(base + 'fog.png?' + t) : null]);
      const ok = await canPlay(v), nx = { name, idx, set, fl, mask, spill, fog, base, t };
      if (seq !== loadSeq) { drop(nx); return false; }   // a newer pick won
      if (!ok) { drop(nx); throw new Error('its plate_loop.mp4 would not play'); }
      if (opt.defer) { pending = nx; S.next = name; S.loading = ''; post(); return true; }
      apply(nx); return true;
    } catch (e) { if (seq === loadSeq) { S.loading = ''; S.status = 'could not load ' + name + ': ' + e.message; post(); } return false; }
  }
  function apply(nx) {
    pending = null; S.next = '';
    const old = [U.tMask.value, U.tSpill.value, U.tFog.value];
    const set = nx.set, PW = set.plate_w || 1920, PH = set.plate_h || 1080; U.plate.value.set(PW, PH);
    const nH = Math.round(1920 * PH / PW / 2) * 2; if (nH !== H || W !== 1920) { W = 1920; H = nH; if (rt) { rt.dispose(); rt = null; } }
    U.tMask.value = nx.mask || black; U.tSpill.value = nx.spill || black; U.tFog.value = nx.fog || black; U.fogOn.value = nx.fog ? 1 : 0;
    for (const t of old) if (t && t !== black) t.dispose();
    const ws = (set.windows || []).filter(w => !w.bake).slice(0, 4);
    ws.forEach((w, i) => { const h = homog(w.quad, [[0, 0], [1, 0], [1, 1], [0, 1]]); U.Hm.value[i].set(...h);
      U.fp.value[i].set(+w.feed_x || 0.4, w.feed_y ?? 0.5, +w.clip_zoom || 1, (w.size_m ? w.size_m[0] / w.size_m[1] : 0.72)); U.sil.value[i] = +w.silhouette || 0; });
    U.nW.value = ws.length;
    const g = set.grade || {}; U.grade.value.set(+g.exposure || 2.3, +g.warmth || 0.06, +g.contrast || 0.88);
    const gl_ = set.glass || {}; U.mist.value = +gl_.mist || 0; U.rainK.value = gl_.rain ?? 0.7; U.reflK.value = gl_.reflect ?? 0.07;
    U.crop.value = +(set.feed && set.feed.crop) || 0.86; U.spillK.value = +(set.spill && set.spill.strength) || 0.95; U.cutOld.value = +(set.spill && set.spill.cut_old) || 0.5;
    const prev = vids[cur]; cur = nx.idx; U.tBase.value = tLoops[cur];
    if (prev !== vids[cur]) { prev.pause(); prev.removeAttribute('src'); prev.load(); }   // free the old scene's decoder
    vids[cur].currentTime = 0; if (air) vids[cur].play().catch(() => {});
    if (!arr.paused) arr.pause(); S.playing = '';
    plateStats(nx.base + 'plate.png?' + nx.t);
    S.set = nx.name; S.files = nx.fl; S.arrivals = nx.fl.filter(x => /^arrival_.*\.mp4$/i.test(x)); S.loading = '';
    ready = true; S.status = `${nx.name}: ${PW}×${PH}, ${ws.length} club window(s)${S.arrivals.length ? ', ' + S.arrivals.length + ' arrival(s)' : ''}`;
    post();
  }
  function commit() { if (!pending) return false; apply(pending); return true; }
  function arrive(file) {
    if (!S.set || !file) return; arr.src = `${STUDIO}/sets/${encodeURIComponent(S.set)}/${encodeURIComponent(file)}?${Date.now()}`;
    arr.currentTime = 0; arr.play().then(() => { S.playing = file; post(); }).catch(e => { S.status = 'arrival: ' + e.message; post(); });
  }
  arr.onended = () => { S.playing = ''; post(); };
  async function renderArrival(name) {
    if (!S.set) return; S.job = { progress: 0, status: 'starting', name };
    try {
      const jb = await j('/api/arrival', { set: S.set, name }); if (jb.error) throw new Error(jb.error);
      const poll = setInterval(async () => {
        const s = await j('/api/job/' + jb.id).catch(() => null); if (!s) return;
        S.job = { progress: s.progress || 0, status: s.status, name, err: s.error || '' }; post();
        if (s.status !== 'running') { clearInterval(poll); S.files = await filesOf(S.set); S.arrivals = S.files.filter(x => /^arrival_.*\.mp4$/i.test(x)); post(); }
      }, 1000);
    } catch (e) { S.job = { progress: 0, status: 'error', name, err: e.message }; post(); }
  }
  // feed: { tex, w, h } = #707 WEBCAM + GEAR (DirroVJ's own composite: the webcam with the Quest's gear drawn over it), else the plain webcam
  function render(now, feed) {
    if (!ready) return null;
    camAvg(now); U.time.value = now / 1000; U.match.value = S.match ?? 0.7;
    const useArr = S.playing && arr.readyState >= 2, v = vids[cur];
    if (!useArr && v.paused) v.play().catch(() => {});
    U.tBase.value = useArr ? tArr : tLoops[cur];
    if (feed && feed.tex) { U.tCam.value = feed.tex; U.camSz.value.set(feed.w, feed.h); }
    else { U.tCam.value = camTex; if (camVideo && camVideo.videoWidth) U.camSz.value.set(camVideo.videoWidth, camVideo.videoHeight); }
    U.camOn.value = S.cam && camVideo && camVideo.videoWidth ? 1 : 0;
    if (!rt) rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    renderer.setRenderTarget(rt); renderer.render(sc, oc); renderer.setRenderTarget(null);
    return rt.texture;
  }
  function active(on) {   // #666 pause the loop (and an arrival) while DIRROVERSE is off air
    air = on; const v = vids[cur];
    if (on) { if (ready && v.paused && !S.playing) v.play().catch(() => {}); if (S.playing && arr.paused) arr.play().catch(() => {}); }
    else { if (!v.paused) v.pause(); if (!arr.paused) arr.pause(); }
  }
  return { list, load, commit, arrive, renderArrival, render, active, get w() { return W; }, get h() { return H; }, get ready() { return ready; }, get pendingName() { return pending ? pending.name : ''; } };
}
