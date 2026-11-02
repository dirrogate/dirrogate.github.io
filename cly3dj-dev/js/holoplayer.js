// #573 Holodancer player: one module for the VJ Desk, Dirrogram and the test pages.
// A performer is a folder with performer.json + atlas.mp4 (one H.264 holding every camera view of a Cycles render).
// Layouts:
//   '4d'  4 views with depth, 1920x1080: top row colour (premultiplied over black), bottom row depth (0 = empty, 0.1..1 = far..near).
//         Each view becomes a grid mesh pushed out along its camera rays; the three cameras facing the viewer are drawn,
//         the best one dithered against the next near the hand-over. Torn geometry (depth jumps between grid points, edge-on
//         surfaces) is drawn as cyan scan lines. Optional relight from depth normals (room light).
//   '8b'  8 views, 1920x1620: top 4x2 colour grid, bottom strip 8 alpha mattes. A billboard turned to the viewer shows the
//         nearest view; a short glitch covers each view change.
// Rig (performer.json "rig"): cameras on a ring around her, Blender azimuth az0 + azStep * v degrees (from +X, counter-clockwise
// seen from above, her front faces Blender -Y = three +Z), dist metres away, aimed at aimH, lens / sensor (vertical) in mm.
// The player is life size in metres with her feet at y = 0; scale the returned group as needed.
export function makeHoloPlayer({ THREE, grid = [160, 180] }) {
  const group = new THREE.Group();
  const video = document.createElement('video');
  Object.assign(video, { muted: true, loop: true, playsInline: true, crossOrigin: 'anonymous', preload: 'auto' });
  video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.NoColorSpace; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const shared = {
    uCut: { value: 0.06 }, uGraze: { value: 0.15 }, uTint: { value: 0 }, uT: { value: 0 }, uTears: { value: 1 }, uBand: { value: 0 }, uBehind: { value: 0 }, uBeam: { value: 0 },
    uRoom: { value: 0 }, uAmb: { value: new THREE.Vector3(0.6, 0.6, 0.6) }, uKey: { value: new THREE.Vector3(0.6, 0.6, 0.6) }, uL: { value: new THREE.Vector3(0, 1, 0) },
  };
  const P = { half: false, back: null, proj: null, meta: null, layout: '', views: [], board: null, bU: null, cur: 0, gT0: -1, glitch: 1, ready: false, err: '', base: '' };
  const tmp = new THREE.Vector3(), local = new THREE.Vector3();

  // ---------- 4d: depth shells ----------
  const VS4 = `
    uniform sampler2D map; uniform float uView, uZn, uZf, uTh, uTv; uniform vec2 uStep;
    varying vec2 vUv; varying float vZ, vOcc, vJump; varying vec3 vPos, vN;
    float dep(vec2 p){ return texture2D(map, vec2((uView + clamp(p.x, 0.001, 0.999)) * 0.25, clamp(p.y, 0.001, 0.999) * 0.5)).r; }
    float zOf(float s){ return mix(uZf, uZn, clamp((s - 0.1) / 0.9, 0.0, 1.0)); }
    vec3 Pc(vec2 p, float z){ return vec3((p.x * 2.0 - 1.0) * uTh * z, (p.y * 2.0 - 1.0) * uTv * z, -z); }
    void main(){
      vUv = uv;
      float s = dep(uv);
      vec2 e = vec2(2.0 / 480.0, 2.0 / 540.0);
      float mn = min(min(dep(uv + vec2(e.x, 0.0)), dep(uv - vec2(e.x, 0.0))), min(dep(uv + vec2(0.0, e.y)), dep(uv - vec2(0.0, e.y))));
      vOcc = step(0.06, s) * step(0.06, mn);
      float z = vOcc > 0.5 ? zOf(s) : uZf;
      vec2 dx = vec2(uStep.x, 0.0), dy = vec2(0.0, uStep.y);
      float sL = dep(uv - dx), sR = dep(uv + dx), sD = dep(uv - dy), sU = dep(uv + dy);
      float zL = sL > 0.06 ? zOf(sL) : z, zR = sR > 0.06 ? zOf(sR) : z, zD = sD > 0.06 ? zOf(sD) : z, zU = sU > 0.06 ? zOf(sU) : z;
      vJump = max(max(abs(zL - z), abs(zR - z)), max(abs(zD - z), abs(zU - z)));
      vN = normalize(normalMatrix * normalize(cross(Pc(uv + dx, zR) - Pc(uv - dx, zL), Pc(uv + dy, zU) - Pc(uv - dy, zD))));
      vZ = z;
      vec4 mv = modelViewMatrix * vec4(Pc(uv, z), 1.0); vPos = mv.xyz;
      gl_Position = projectionMatrix * mv;
    }`;
  const COMMON4 = `
    uniform sampler2D map; uniform float uView, uCut, uGraze, uTint, uT, uKeep, uRoom, uTears; uniform vec3 uAmb, uKey, uL;
    varying vec2 vUv; varying float vZ, vOcc, vJump; varying vec3 vPos, vN;
    vec3 col(){ vec2 p = clamp(vUv, 0.002, 0.998); return texture2D(map, vec2((uView + p.x) * 0.25, 0.5 + p.y * 0.5)).rgb; }
    float occ(){ vec2 p = clamp(vUv, 0.002, 0.998); return texture2D(map, vec2((uView + p.x) * 0.25, p.y * 0.5)).r; }
    vec3 nrm(){ vec3 n = normalize(vN); return dot(n, -vPos) < 0.0 ? -n : n; }
    float torn(vec3 n){ return max(step(uCut, vJump), step(abs(dot(n, normalize(-vPos))), uGraze)); }
    float b2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
    float bayer(vec2 a){ return b2(0.5 * a) * 0.25 + b2(a) + 0.03; }`;
  const FS4 = COMMON4 + `
    void main(){
      if (vOcc < 0.999 || occ() < 0.06) discard;
      vec3 n = nrm();
      if (torn(n) > 0.5) discard;
      if (bayer(gl_FragCoord.xy) > uKeep) discard;
      vec3 c = col();
      c = mix(c, c * (uAmb + uKey * max(dot(n, normalize(uL)), 0.0)) * 1.25, uRoom);
      vec3 tint = uView < 0.5 ? vec3(1.0, 0.3, 0.3) : uView < 1.5 ? vec3(0.3, 1.0, 0.3) : uView < 2.5 ? vec3(0.3, 0.5, 1.0) : vec3(1.0, 1.0, 0.3);
      gl_FragColor = vec4(mix(c, c * 0.4 + tint * 0.4, uTint), 1.0);
    }`;
  const FS4T = COMMON4 + `
    void main(){
      if (uTears < 0.5 || vOcc < 0.999 || occ() < 0.06) discard;
      vec3 n = nrm();
      if (torn(n) < 0.5) discard;
      float scan = step(0.55, fract(gl_FragCoord.y * 0.2 - uT * 5.0));
      float flick = 0.65 + 0.35 * sin(uT * 37.0 + vZ * 40.0);
      float inner = 1.0 - step(0.35, vJump);   // #576 a gap between her own parts (arm over torso): solid dark fill, so AR shows no holes
      vec3 line = mix(col(), vec3(0.15, 0.8, 1.0), 0.8) * flick;
      float a = max(inner, scan * 0.85);
      if (a < 0.01) discard;
      gl_FragColor = vec4(mix(vec3(0.07, 0.08, 0.10), line, scan), a);
    }`;

  // ---------- #579 half shell: only the front camera's displaced depth mesh (as a 1-view stereo capture would give). From behind or
  // the side its back faces are the holoprojector's picture: cyan scan lines, a bright band sweeping top to bottom, a ghost of her
  // colours; a projector prop behind her throws a light cone (with the same band) onto her back. Nothing of it shows from the front.
  const FS4B = COMMON4 + `
    uniform float uBand, uBehind;
    void main(){
      if (uBehind < 0.01 || vOcc < 0.999 || occ() < 0.06 || vJump > 0.35) discard;
      float y = vUv.y;
      float band = exp(-pow((y - uBand) / 0.035, 2.0));
      float lines = 0.3 + 0.7 * step(0.5, fract(y * 150.0 - uT * 2.0));
      float flick = 0.85 + 0.15 * sin(uT * 31.0 + y * 20.0);
      vec3 c = vec3(0.12, 0.78, 1.0) * (0.22 * lines + 1.5 * band) * flick + col() * 0.28;
      gl_FragColor = vec4(c, clamp(0.4 * lines + 0.9 * band, 0.0, 0.95) * uBehind);
    }`;
  // #580 the projector's light: a fan of rays from the lens along the current scan row, each ending ON her shell (the ray reads
  // view 0's depth at its u on that row, so the sheet stops at her contour), a hot dot where each lands; nothing where the row is empty
  const RAYS = 72;
  const BEAM_COMMON = `
    uniform sampler2D map; uniform float uBand, uBehind, uT, uZn, uZf, uTh, uTv; uniform vec3 uApex; uniform mat4 uPivot;
    float dep(vec2 p){ return texture2D(map, vec2(clamp(p.x, 0.001, 0.999) * 0.25, clamp(p.y, 0.001, 0.999) * 0.5)).r; }
    vec3 hit(float u, out float occ){
      vec2 q = vec2(u, uBand); float s = dep(q);
      float sm = min(dep(q + vec2(0.006, 0.0)), dep(q - vec2(0.006, 0.0)));
      occ = step(0.06, s) * step(0.06, sm);
      float z = mix(uZf, uZn, clamp((s - 0.1) / 0.9, 0.0, 1.0));
      return (uPivot * vec4((u * 2.0 - 1.0) * uTh * z, (uBand * 2.0 - 1.0) * uTv * z, -z, 1.0)).xyz;
    }`;
  const VSRAY = BEAM_COMMON + `
    attribute float aU; varying float vO, vS;
    void main(){
      vec3 p = uApex; float o = 1.0; vS = 0.0;
      if (aU >= 0.0) { p = hit(aU, o); vS = 1.0; }
      vO = o;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`;
  const FSRAY = `
    uniform float uBehind, uT; varying float vO, vS;
    void main(){
      if (vO < 0.98) discard;
      float a = (0.05 + 0.4 * vS * vS) * uBehind * (0.85 + 0.15 * sin(uT * 47.0));
      gl_FragColor = vec4(vec3(0.15, 0.82, 1.0), a);
    }`;
  const VSDOT = BEAM_COMMON + `
    attribute float aU; varying float vO;
    void main(){
      float o; vec3 p = hit(aU, o); vO = o;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = clamp(38.0 / max(0.3, -mv.z), 2.0, 18.0);
      gl_Position = projectionMatrix * mv;
    }`;
  const FSDOT = `
    uniform float uBehind; varying float vO;
    void main(){
      if (vO < 0.5) discard;
      float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard;
      float g = pow(1.0 - r, 2.2);
      gl_FragColor = vec4(mix(vec3(0.2, 0.85, 1.0), vec3(1.0), g * g), g * uBehind);
    }`;
  function panelTex(lens) {   // dark gunmetal face, bevel, glowing cyan ports (or the lens)
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#10141c'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#2b3445'; g.lineWidth = 10; g.strokeRect(5, 5, 246, 246); g.strokeStyle = '#1b2230'; g.lineWidth = 2; g.strokeRect(22, 22, 212, 212);
    const glow = (x, y, r) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, '#eaffff'); gr.addColorStop(0.35, '#35d6ff'); gr.addColorStop(1, 'rgba(53,214,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
    if (lens) {
      g.fillStyle = '#05070b'; g.beginPath(); g.arc(128, 128, 76, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#35d6ff'; g.lineWidth = 4; g.beginPath(); g.arc(128, 128, 70, 0, Math.PI * 2); g.stroke();
      glow(128, 128, 54);   // #581 one big port per face, nothing else
    } else {
      g.fillStyle = '#35d6ff'; g.globalAlpha = 0.55; g.fillRect(56, 124, 144, 6); g.globalAlpha = 1;   // top / bottom: plain, one thin light strip
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function buildHalf(R, H) {
    const v0 = P.views[0]; if (!v0) return;
    const un = Object.assign({}, v0.un);
    const mb = new THREE.ShaderMaterial({ uniforms: un, vertexShader: VS4, fragmentShader: FS4B, side: THREE.BackSide, transparent: true, depthWrite: false });
    mb.extensions = { derivatives: true };
    P.back = new THREE.Mesh(v0.mesh.geometry, mb); P.back.frustumCulled = false; P.back.visible = false; P.back.renderOrder = 1;
    v0.mesh.parent.add(P.back);
    // her feet-to-head range in view 0's picture (so the scan covers her, not the empty frame)
    const slotH = 2 * R.dist * R.tv, bottom = R.aimH - slotH / 2;
    P.uvLo = Math.max(0.0, (0 - bottom) / slotH - 0.01); P.uvHi = Math.min(1.0, (H * 1.04 - bottom) / slotH);
    const pivot = v0.mesh.parent; pivot.updateMatrix();
    const apex = new THREE.Vector3(0, H * 0.55, -1.0);   // waist height, 1 m behind her (her front faces +Z); #582 was 1.9 m
    const bu = { map: { value: tex }, uBand: shared.uBand, uBehind: shared.uBeam, uT: shared.uT, uZn: v0.un.uZn, uZf: v0.un.uZf, uTh: v0.un.uTh, uTv: v0.un.uTv, uApex: { value: apex }, uPivot: { value: pivot.matrix.clone() } };
    const gR = new THREE.BufferGeometry(), au = [], pos = [];
    for (let i = 0; i < RAYS - 1; i++) { const a = i / (RAYS - 1), b = (i + 1) / (RAYS - 1); au.push(-1, a, b); pos.push(0, 0, 0, 0, 0, 0, 0, 0, 0); }
    gR.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gR.setAttribute('aU', new THREE.Float32BufferAttribute(au, 1));
    const sheet = new THREE.Mesh(gR, new THREE.ShaderMaterial({ uniforms: bu, vertexShader: VSRAY, fragmentShader: FSRAY, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    const gD = new THREE.BufferGeometry(), du = [];
    for (let i = 0; i < RAYS; i++) du.push(i / (RAYS - 1));
    gD.setAttribute('position', new THREE.Float32BufferAttribute(new Array(RAYS * 3).fill(0), 3)); gD.setAttribute('aU', new THREE.Float32BufferAttribute(du, 1));
    const dots = new THREE.Points(gD, new THREE.ShaderMaterial({ uniforms: bu, vertexShader: VSDOT, fragmentShader: FSDOT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sheet.frustumCulled = dots.frustumCulled = false; sheet.renderOrder = 3; dots.renderOrder = 4;
    // the projector: a cube with glowing ports, the lens face (+Z after lookAt) toward her
    // #581 a 12 cm cube: four big ports (the front one projects; left, right and back match it), plain top and bottom
    const port = new THREE.MeshBasicMaterial({ map: panelTex(true), toneMapped: false }), plain = new THREE.MeshBasicMaterial({ map: panelTex(false), toneMapped: false });
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), [port, port, plain, plain, port, port]);
    cube.position.copy(apex).add(new THREE.Vector3(0, 0, -0.06)); cube.lookAt(0, apex.y, 0);
    P.proj = new THREE.Group(); P.proj.add(sheet, dots, cube); P.proj.visible = false; group.add(P.proj);
  }
  function halfStep(t) {
    const dz = tmp.copy(local).setY(0).normalize().z;   // 1 = straight in front of her, -1 = straight behind
    const behind = Math.max(0, Math.min(1, (0.3 - dz) / 0.6));
    // #580 top to bottom and back up, easing at each end like a scanning mirror (one full cycle 3.2 s)
    const k = 0.5 + 0.5 * Math.cos(t * Math.PI * 2 / 3.2);
    // #581 the projector and its rays show from 15 degrees off her front (cos 15 = 0.966); her back's projection only from behind
    const beam = Math.max(0, Math.min(1, (0.966 - dz) / 0.12)); shared.uBeam.value = beam;
    shared.uBehind.value = behind; shared.uBand.value = (P.uvLo || 0) + ((P.uvHi || 1) - (P.uvLo || 0)) * k;
    P.views.forEach((o, i) => { o.mesh.visible = i === 0; o.tear.visible = i === 0; o.un.uKeep.value = 1; o.mat.polygonOffsetFactor = 0; o.mat.polygonOffsetUnits = 0; });
    if (P.back) P.back.visible = behind > 0.01;
    if (P.proj) P.proj.visible = dz < 0.966;
    P.cur = 0;
  }

  // ---------- 8b: billboard ----------
  const VS8 = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const FS8 = `
    uniform sampler2D map; uniform float uView, uPrev, uG, uT, uSeed, uOp; varying vec2 vUv;
    float h(float n){ return fract(sin(n * 91.345 + uSeed * 17.0) * 47453.5453); }
    vec2 cUv(float v, vec2 p){ float c = mod(v, 4.0), r = floor(v / 4.0); return vec2((c + p.x) * 0.25, 1.0 - (r * 540.0 + (1.0 - p.y) * 540.0) / 1620.0); }
    vec2 aUv(float v, vec2 p){ return vec2((v + p.x) * 0.125, 1.0 - (1080.0 + (1.0 - p.y) * 540.0) / 1620.0); }
    vec4 view(float v, vec2 p){
      if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return vec4(0.0);
      p = clamp(p, 0.002, 0.998);
      vec3 c = texture2D(map, cUv(v, p)).rgb; float a = smoothstep(0.04, 0.96, texture2D(map, aUv(v, p)).r);
      return vec4(min(c, vec3(a)), a);
    }
    void main(){
      vec2 p = vUv; float g = uG;
      float band = floor(p.y * 38.0 + floor(uT * 30.0) * 3.0);
      float on = step(1.0 - 0.55 * g, h(band));
      p.x += (h(band + 7.0) - 0.5) * 0.22 * g * on;
      float sh = 0.012 * g;
      float v = (g > 0.45 && h(band + 3.0) < 0.5) ? uPrev : uView;
      vec4 r = view(v, p + vec2(sh, 0.0)), m = view(v, p), b = view(v, p - vec2(sh, 0.0));
      vec4 o = vec4(r.r, m.g, b.b, max(m.a, max(r.a, b.a)));
      o.rgb *= 1.0 - 0.35 * g * step(0.5, fract(p.y * 270.0 + uT * 40.0));
      o.rgb += vec3(0.1, 0.55, 0.75) * g * on * o.a * 0.35;
      o *= 1.0 - g * 0.25 * step(0.82, h(band + 11.0));
      gl_FragColor = o * uOp;
    }`;

  function clear() {
    for (const c of [...group.children]) { group.remove(c); c.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    P.views = []; P.board = null; P.bU = null; P.ready = false; P.back = null; P.proj = null;
  }
  function rigOf(m) {
    const r = Object.assign({ dist: 4.4, lens: 50, sensor: 24, aimH: 1.0, az0: -90, azStep: m.layout === '8b' ? -45 : -90 }, m.rig || {});
    const tv = (r.sensor / 2) / r.lens, slot = m.slot || [480, 540];
    return { ...r, tv, th: tv * slot[0] / slot[1], n: m.views || (m.layout === '8b' ? 8 : 4) };
  }
  function build(m) {
    clear();
    const R = rigOf(m); P.rig = R; P.layout = m.layout;
    if (m.layout === '4d') {
      const geo = new THREE.PlaneGeometry(1, 1, grid[0], grid[1]), d = m.depth || { near: 3.7, far: 5.1 };
      for (let v = 0; v < R.n; v++) {
        const un = { map: { value: tex }, uView: { value: v }, uZn: { value: d.near }, uZf: { value: d.far }, uTh: { value: R.th }, uTv: { value: R.tv }, uKeep: { value: 1 }, uStep: { value: new THREE.Vector2(1 / grid[0], 1 / grid[1]) }, ...shared };
        const mat = new THREE.ShaderMaterial({ uniforms: un, vertexShader: VS4, fragmentShader: FS4, polygonOffset: true });
        const mt = new THREE.ShaderMaterial({ uniforms: un, vertexShader: VS4, fragmentShader: FS4T, transparent: true, depthWrite: false });
        mat.extensions = mt.extensions = { derivatives: true };
        const mesh = new THREE.Mesh(geo, mat), tear = new THREE.Mesh(geo, mt);
        mesh.frustumCulled = tear.frustumCulled = false; tear.renderOrder = 2;
        const az = (R.az0 + R.azStep * v) * Math.PI / 180;
        const pivot = new THREE.Camera();   // a camera's lookAt points -Z at the target, as the shader's camera space does
        pivot.position.set(R.dist * Math.cos(az), R.aimH, -R.dist * Math.sin(az)); pivot.lookAt(0, R.aimH, 0);
        pivot.add(mesh, tear); group.add(pivot);
        P.views.push({ v, mesh, tear, un, mat, dir: new THREE.Vector3(Math.cos(az), 0, -Math.sin(az)) });
      }
      buildHalf(R, m.height || 1.72);   // #579 (shown only in half-shell mode)
    } else {
      const H = 2 * R.dist * R.tv, W = H * (R.th / R.tv);
      P.bU = { map: { value: tex }, uView: { value: 0 }, uPrev: { value: 0 }, uG: { value: 0 }, uT: { value: 0 }, uSeed: { value: 0 }, uOp: { value: 1 } };
      const mat = new THREE.ShaderMaterial({ uniforms: P.bU, vertexShader: VS8, fragmentShader: FS8, transparent: true, premultipliedAlpha: true, depthWrite: false, side: THREE.DoubleSide });
      P.board = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat); P.board.position.y = R.aimH; P.board.frustumCulled = false;
      group.add(P.board);
    }
  }
  // load a performer: url of performer.json (or its parsed object + base url)
  async function load(src, base) {
    P.err = ''; P.ready = false;
    try {
      let m = src;
      if (typeof src === 'string') { const r = await fetch(src, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status + ' ' + src); m = await r.json(); base = src.replace(/[^/]*$/, ''); }
      P.meta = m; P.base = base || '';
      build(m);
      video.src = (P.base || '') + (m.atlas || 'atlas.mp4');
      await new Promise((res, rej) => { const ok = () => { video.removeEventListener('error', no); res(); }, no = () => { video.removeEventListener('loadeddata', ok); rej(new Error('video: ' + video.src)); }; video.addEventListener('loadeddata', ok, { once: true }); video.addEventListener('error', no, { once: true }); video.load(); });
      video.play().catch(() => {});
      P.ready = true; return m;
    } catch (e) { P.err = e.message || String(e); throw e; }
  }
  // per frame: viewer position in world space, time in seconds; viewMatrixInverse for room-light direction (optional)
  function update(eye, t, viewer) {
    if (!P.ready) return;
    shared.uT.value = t;
    group.worldToLocal(local.copy(eye));
    const R = P.rig;
    if (P.layout === '4d') {
      if (P.half) { halfStep(t); if (viewer && shared.uRoom.value > 0) shared.uL.value.copy(P.lightW || tmp.set(0.6, 1, 0.8)).normalize().transformDirection(viewer.matrixWorldInverse); return; }   // #579
      local.y = 0; local.normalize();
      const ranked = P.views.map(o => ({ o, d: o.dir.dot(local) })).sort((a, b) => b.d - a.d);
      const gap = ranked[0].d - ranked[1].d;
      ranked.forEach(({ o, d }, i) => {
        const on = i < 3 && d > -0.35;
        o.mesh.visible = on; o.tear.visible = on && i < 2;
        o.mat.polygonOffsetFactor = -4 + i * 3; o.mat.polygonOffsetUnits = -40 + i * 30;
        o.un.uKeep.value = i === 0 ? 1 - 0.5 * (1 - THREE.MathUtils.smoothstep(gap, 0, 0.3)) : 1;
      });
      P.cur = ranked[0].o.v;
      if (viewer && shared.uRoom.value > 0) shared.uL.value.copy(P.lightW || tmp.set(0.6, 1, 0.8)).normalize().transformDirection(viewer.matrixWorldInverse);
    } else {
      P.board.rotation.y = Math.atan2(local.x, local.z);
      const az = Math.atan2(-local.z, local.x) * 180 / Math.PI;
      const f = (((az - R.az0) / R.azStep) % R.n + R.n) % R.n;
      let d = ((f - P.cur) % R.n + R.n) % R.n; if (d > R.n / 2) d -= R.n;
      if (Math.abs(d) * Math.abs(R.azStep) >= Math.abs(R.azStep) / 2 + 7) {
        const v = ((Math.round(f) % R.n) + R.n) % R.n;
        if (v !== P.cur) { P.bU.uPrev.value = P.cur; P.cur = v; P.bU.uView.value = v; P.bU.uSeed.value = Math.random() * 100; P.gT0 = t; }
      }
      const age = P.gT0 < 0 ? 9 : t - P.gT0;
      P.bU.uG.value = P.glitch * Math.max(0, 1 - age / 0.22); P.bU.uT.value = t;
    }
  }
  function set(k, v) {
    if (k === 'half') { P.half = !!v; if (!P.half) { if (P.back) P.back.visible = false; if (P.proj) P.proj.visible = false; } }   // #579 front shell only + holoprojector
    else if (k === 'tears') shared.uTears.value = v ? 1 : 0;
    else if (k === 'cut') shared.uCut.value = +v;
    else if (k === 'graze') shared.uGraze.value = +v;
    else if (k === 'tint') shared.uTint.value = v ? 1 : 0;
    else if (k === 'glitch') P.glitch = +v;
    else if (k === 'room') shared.uRoom.value = v ? 1 : 0;
    else if (k === 'light') { if (v.amb) shared.uAmb.value.copy(v.amb); if (v.key) shared.uKey.value.copy(v.key); if (v.dir) P.lightW = v.dir.clone(); }
    else if (k === 'speed') video.playbackRate = Math.max(0.25, Math.min(2, +v || 1));
    else if (k === 'opacity') { if (P.bU) P.bU.uOp.value = +v; }
  }
  function dispose() { clear(); video.pause(); video.removeAttribute('src'); video.load(); tex.dispose(); }
  return { group, video, tex, load, update, set, dispose, get ready() { return P.ready; }, get err() { return P.err; }, get meta() { return P.meta; }, get view() { return P.cur; }, get layout() { return P.layout; } };
}
