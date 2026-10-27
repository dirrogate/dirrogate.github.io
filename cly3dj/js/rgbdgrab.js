// #520 GRAB RGB-D (owner, 27 Oct: a DirroComics-only feature, asked for from the VJ desk; project doc dirrocomics-plan.md).
// DirroVJ sends 'cxgrab'; the Quest records its headset camera together with its real depth. Each camera frame goes on the
// LEFT of a canvas; on the RIGHT the WebXR depth map (RealDepth, #413) is re-projected into that same camera and drawn as
// gray, white = near (uNear) to black = far (uFar) or unknown. The camera's pose is the head pose at the frame's capture
// time x the CAM FIT offset / lens (the same numbers HEADSET CAM uses, 'vire.mrcam'), so colour and depth line up as well
// as HEADSET CAM's gear does. 5 s = a video (MediaRecorder, mp4 if the browser has it, else webm with its length written
// in); STILL = one PNG (lossless depth). The file goes back to DirroVJ over the link's file channel and becomes a DirroComics
// panel with stereo type RGB+D. Nothing here touches GRAB LOOP, the LED wall, Twitch or DirroTV.
// Needs passthrough (immersive-ar) with depth sensing on; the depth is the current XR frame's, the camera frame is ~50 ms +
// LAG older, so fast moves show a small mismatch at edges.
import * as THREE from 'three';

const N = 128;
const VS = `uniform sampler2DArray uDepth; uniform float uLayer; uniform mat4 uInvProj; uniform mat4 uPose; uniform mat4 uInvNorm;
varying vec3 vW; varying float vBad;
vec3 lift(vec2 buf) {
  float d = min(textureLod(uDepth, vec3(buf, uLayer), 0.0).r, 0.9999);
  vec2 nv = (uInvNorm * vec4(buf, 0.0, 1.0)).xy;
  vec4 v = uInvProj * vec4(nv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w;
}
void main() {
  vec2 buf = position.xy; float d = textureLod(uDepth, vec3(buf, uLayer), 0.0).r;
  vec3 v = lift(buf); float r = length(v), g = 1.0 / ${N}.0, jump = 0.0;
  jump = max(jump, abs(length(lift(buf + vec2(g, 0.0))) - r)); jump = max(jump, abs(length(lift(buf - vec2(g, 0.0))) - r));
  jump = max(jump, abs(length(lift(buf + vec2(0.0, g))) - r)); jump = max(jump, abs(length(lift(buf - vec2(0.0, g))) - r));
  vBad = (d >= 0.9998 || r > 25.0 || jump > 0.08 * r + 0.04) ? 1.0 : 0.0;   // far / empty texels and sheets across depth jumps
  vec4 w = uPose * vec4(v, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FS = `uniform float uNear, uFar; varying vec3 vW; varying float vBad;
void main() { if (vBad > 0.5) discard; float d = distance(vW, cameraPosition); gl_FragColor = vec4(vec3(1.0 - clamp((d - uNear) / (uFar - uNear), 0.0, 1.0)), 1.0); }`;
const COPY_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const FLIP_FS = 'uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(map, vec2(vUv.x, 1.0 - vUv.y)).rgb, 1.0); }';   // upside down, so the read-back rows come out top first
const DEG = Math.PI / 180;

export function makeRgbdGrab({ renderer, getDepth, getFit, getCamVideo, say, sendFile, toast }) {
  const hist = [];   // centre-eye poses (~0.6 s) to match each camera frame's capture time
  let job = null;
  const W = 640;   // each half; height follows the camera's aspect
  const dMat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide,
    uniforms: { uDepth: { value: null }, uLayer: { value: 0 }, uInvProj: { value: new THREE.Matrix4() }, uPose: { value: new THREE.Matrix4() }, uInvNorm: { value: new THREE.Matrix4() }, uNear: { value: 0.35 }, uFar: { value: 5.0 } } });
  const dScene = new THREE.Scene(); let dMesh = null;
  const fMat = new THREE.ShaderMaterial({ uniforms: { map: { value: null } }, vertexShader: COPY_VS, fragmentShader: FLIP_FS, depthTest: false, depthWrite: false });
  const fScene = new THREE.Scene(), fq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fMat); fq.frustumCulled = false; fScene.add(fq);
  const oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), cam = new THREE.PerspectiveCamera(60, 4 / 3, 0.05, 40); cam.updateMatrixWorld = () => {};
  const flip = new THREE.Matrix4().makeScale(1, -1, 1), m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4(), q1 = new THREE.Quaternion(), e1 = new THREE.Euler(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), s1 = new THREE.Vector3(1, 1, 1), qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const msg = t => { try { say && say(t); } catch {} };

  function poseAt(t, out) {
    if (!hist.length) return false; let b = hist.length - 1; while (b > 0 && hist[b - 1].t >= t) b--;
    const B = hist[b], A = hist[Math.max(0, b - 1)]; if (B.t <= t || A === B) { out.copy(B.m); return true; }
    const k = Math.min(1, Math.max(0, (t - A.t) / (B.t - A.t)));
    out.compose(v1.setFromMatrixPosition(A.m).lerp(v2.setFromMatrixPosition(B.m), k), qa.setFromRotationMatrix(A.m).slerp(qb.setFromRotationMatrix(B.m), k), s1); return true;
  }
  function cleanup(j = job) {
    if (!j) return; if (job === j) job = null;
    if (j.own) j.own.getTracks().forEach(t => t.stop());
    if (j.colRT) j.colRT.dispose(); if (j.depRT) j.depRT.dispose(); if (j.vtex) j.vtex.dispose();
  }
  async function start(m) {
    if (job) { msg('RGB-D: already recording'); return; }
    const still = !!m.still, ms = Math.max(1000, Math.min(10000, +m.ms || 5000));
    if (!renderer.xr.isPresenting) { msg('RGB-D: put the headset on in passthrough first (depth only exists in the XR session)'); return; }
    if (!getDepth()) { msg('RGB-D: no depth from the headset (passthrough with depth sensing on, OCCLUSION on)'); return; }
    job = { still, ms, starting: true };
    try {
      let v = getCamVideo(), own = null;
      if (!v) {   // HEADSET CAM isn't running: open the camera just for this grab (same request as HEADSET CAM, so CAM FIT's lens holds)
        own = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 }, frameRate: { ideal: 30 } }, audio: false });
        v = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true }); v.srcObject = own;
        await v.play().catch(() => {}); await new Promise(ok => { if (v.videoWidth) ok(); else { v.onloadeddata = ok; setTimeout(ok, 4000); } });
      }
      if (!job) { if (own) own.getTracks().forEach(t => t.stop()); return; }
      if (!v.videoWidth) throw new Error('the headset camera gave no picture (allow camera access on the Quest)');
      const H = Math.round(W * v.videoHeight / v.videoWidth) & ~1;
      const j = Object.assign(job, { own, v, H, camT: 0, camNew: false, busy: false, frames: 0, t0: 0, starting: false });
      j.colRT = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false }); j.depRT = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
      j.vtex = new THREE.VideoTexture(v); j.vtex.colorSpace = THREE.NoColorSpace;
      j.cbuf = new Uint8Array(W * H * 4); j.dbuf = new Uint8Array(W * H * 4);
      j.canvas = document.createElement('canvas'); j.canvas.width = W * 2; j.canvas.height = H; j.g = j.canvas.getContext('2d');
      j.cimg = new ImageData(new Uint8ClampedArray(j.cbuf.buffer), W, H); j.dimg = new ImageData(new Uint8ClampedArray(j.dbuf.buffer), W, H);
      if (v.requestVideoFrameCallback) { const cb = (now, md) => { if (job !== j) return; j.camT = md.captureTime || (md.expectedDisplayTime ? md.expectedDisplayTime - 45 : now - 45); j.camNew = true; v.requestVideoFrameCallback(cb); }; v.requestVideoFrameCallback(cb); }
      if (!still) {
        const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
        j.type = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
        j.track = j.canvas.captureStream(0).getVideoTracks()[0];
        j.rec = new MediaRecorder(new MediaStream([j.track]), { mimeType: j.type || undefined, videoBitsPerSecond: 8e6 });   // high rate: keeps the depth half clean
        j.chunks = []; j.rec.ondataavailable = e => { if (e.data && e.data.size) j.chunks.push(e.data); };
        j.rec.onstop = () => finish(j, new Blob(j.chunks, { type: j.rec.mimeType || j.type || 'video/webm' }));
      }
      msg(still ? 'RGB-D: grabbing a still…' : `RGB-D: recording ${Math.round(ms / 1000)} s…`); toast && toast(still ? 'RGB-D still for DirroComics' : 'RGB-D: recording for DirroComics', 1800);
    } catch (e) { msg('RGB-D failed: ' + (e.message || e)); cleanup(); }
  }
  // called every XR frame right after RealDepth.update() (main.js stepRealWorld), while the depth texture is valid
  function tick(now, depthOk) {
    if (renderer.xr.isPresenting) { const c = renderer.xr.getCamera(); let e = hist.length > 40 ? hist.shift() : { t: 0, m: new THREE.Matrix4() }; e.t = now; e.m.copy(c.matrixWorld); hist.push(e); }
    const j = job; if (!j || j.starting || j.done) return;
    if (!renderer.xr.isPresenting) { msg('RGB-D stopped: the XR session ended'); j.done = true; if (j.rec && j.rec.state === 'recording') j.rec.stop(); else cleanup(j); return; }
    if (j.rec && j.t0 && now - j.t0 > j.ms) { j.done = true; if (j.rec.state === 'recording') j.rec.stop(); else cleanup(j); return; }
    const v = j.v;
    if (v.requestVideoFrameCallback) { if (!j.camNew) return; } else { if (now - (j.pollT || 0) < 40) return; j.camT = now - 45; }
    if (j.busy || !depthOk) return;
    const D = getDepth(), L = D && D.laserData(); if (!L || !D.mesh) return;
    const F = getFit() || { x: 0, y: 0, z: 0, tilt: 0, turn: 0, roll: 0, hfov: 80, lag: 0 };
    if (!poseAt((j.camT || now - 45) - (F.lag || 0), m1)) return;
    j.camNew = false; j.pollT = now;
    m2.compose(v1.set((F.x || 0) / 1000, (F.y || 0) / 1000, (F.z || 0) / 1000), q1.setFromEuler(e1.set((F.tilt || 0) * DEG, (F.turn || 0) * DEG, (F.roll || 0) * DEG, 'YXZ')), s1);
    cam.matrixWorld.multiplyMatrices(m1, m2); cam.matrixWorldInverse.copy(cam.matrixWorld).invert(); cam.matrixWorld.decompose(cam.position, cam.quaternion, cam.scale);
    cam.fov = 2 * Math.atan(Math.tan((F.hfov || 80) * DEG / 2) / (W / j.H)) / DEG; cam.aspect = W / j.H; cam.updateProjectionMatrix(); cam.projectionMatrix.premultiply(flip); cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    if (!dMesh) { dMesh = new THREE.Mesh(D.mesh.geometry, dMat); dMesh.frustumCulled = false; dScene.add(dMesh); }
    const u = dMat.uniforms; u.uDepth.value = L.tex; u.uLayer.value = L.layer; u.uInvProj.value.copy(L.invProj); u.uPose.value.copy(L.view).invert(); u.uInvNorm.value.copy(L.norm).invert();
    j.vtex.needsUpdate = true; fMat.uniforms.map.value = j.vtex;
    const prevRT = renderer.getRenderTarget(), prevXR = renderer.xr.enabled, cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    try {
      renderer.xr.enabled = false; renderer.setClearColor(0x000000, 1);
      renderer.setRenderTarget(j.colRT); renderer.render(fScene, oc);
      renderer.setRenderTarget(j.depRT); renderer.clear(); renderer.render(dScene, cam);
    } finally { renderer.setClearColor(cc, ca); renderer.setRenderTarget(prevRT); renderer.xr.enabled = prevXR; }
    j.busy = true;
    Promise.all([renderer.readRenderTargetPixelsAsync(j.colRT, 0, 0, W, j.H, j.cbuf), renderer.readRenderTargetPixelsAsync(j.depRT, 0, 0, W, j.H, j.dbuf)]).then(() => {
      j.busy = false; if (job !== j) return;
      for (let i = 3; i < j.dbuf.length; i += 4) j.dbuf[i] = 255;
      j.g.putImageData(j.cimg, 0, 0); j.g.putImageData(j.dimg, W, 0); j.frames++;
      if (j.still) { j.done = true; j.canvas.toBlob(b => finish(j, b), 'image/png'); return; }   // one frame
      if (!j.t0) { j.t0 = performance.now(); j.rec.start(250); }
      if (j.track && j.track.requestFrame) j.track.requestFrame();
    }).catch(e => { j.busy = false; msg('RGB-D read-back failed: ' + e.message); });
  }
  async function finish(j, blob) {
    const tag = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    try {
      if (!blob || !blob.size) throw new Error('nothing recorded');
      let b = blob, ext = j.still ? 'png' : /mp4/.test(blob.type) ? 'mp4' : 'webm';
      if (ext === 'webm') b = await webmDuration(blob, Math.min(j.ms, performance.now() - (j.t0 || performance.now())));
      msg(`RGB-D: sending ${(b.size / 1e6).toFixed(1)} MB (${j.frames} frame${j.frames === 1 ? '' : 's'})…`);
      await sendFile(b, `quest-rgbd-${tag}.${ext}`);
      msg('RGB-D: sent'); toast && toast('RGB-D sent to DirroComics', 1800);
    } catch (e) { msg('RGB-D failed: ' + (e.message || e)); }
    finally { cleanup(j); }
  }
  return { start, tick, get busy() { return !!job; } };
}

// Chrome's MediaRecorder WebM has no Duration (a live format), so players guess; write the real length into Segment > Info
// (same helper as dirrogram.js #512).
async function webmDuration(blob, ms) {
  try {
    const b = new Uint8Array(await blob.arrayBuffer());
    const idAt = p => { const f = b[p]; const n = f >= 0x80 ? 1 : f >= 0x40 ? 2 : f >= 0x20 ? 3 : 4; let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i]; return [v, n]; };
    const szAt = p => { const f = b[p]; let n = 1; while (n <= 8 && !(f & (0x80 >> (n - 1)))) n++; let v = f & (0xff >> n), unk = v === (0xff >> n); for (let i = 1; i < n; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xff) unk = false; } return [v, n, unk]; };
    let p = 0; const [h, hn] = idAt(p); if (h !== 0x1A45DFA3) return blob;
    const [hs, hsn] = szAt(p + hn); p += hn + hsn + hs;
    const [sg, sgn] = idAt(p); if (sg !== 0x18538067) return blob;
    const [ss, ssn, sunk] = szAt(p + sgn); p += sgn + ssn; const segEnd = sunk ? b.length : p + ss;
    while (p < segEnd) {
      const [id, idn] = idAt(p), [sz, szn, unk] = szAt(p + idn), d0 = p + idn + szn;
      if (unk) return blob;
      if (id === 0x1549A966) {
        let q = d0, scale = 1e6, durAt = -1, durLen = 0;
        while (q < d0 + sz) { const [cid, cn] = idAt(q), [cs, csn] = szAt(q + cn), cd = q + cn + csn; if (cid === 0x2AD7B1) { let v = 0; for (let i = 0; i < cs; i++) v = v * 256 + b[cd + i]; scale = v || 1e6; } if (cid === 0x4489) { durAt = cd; durLen = cs; } q = cd + cs; }
        const val = ms * 1e6 / scale;
        if (durAt >= 0) { const dv = new DataView(b.buffer, durAt, durLen); if (durLen === 8) dv.setFloat64(0, val); else dv.setFloat32(0, val); return new Blob([b], { type: blob.type }); }
        const el = new Uint8Array(11); el[0] = 0x44; el[1] = 0x89; el[2] = 0x88; new DataView(el.buffer).setFloat64(3, val);
        const ns = sz + 11, size = new Uint8Array(8); size[0] = 0x01; let v = ns; for (let i = 7; i >= 1; i--) { size[i] = v % 256; v = Math.floor(v / 256); }
        return new Blob([b.subarray(0, p + idn), size, b.subarray(d0, d0 + sz), el, b.subarray(d0 + sz)], { type: blob.type });
      }
      if (id === 0x1F43B675) return blob;
      p = d0 + sz;
    }
  } catch (e) {}
  return blob;
}
