// #184 Virtual set on the spectator phone (live green-screen key). Uses Chrome's WebXR 'camera-access' (works on the
// owner's M33, Chrome 154: #183) so the phone keeps full AR tracking and can move freely.
// Drawn back to front: the grounded panorama (skybox.js, same image as the Quest's, picked on the phone), the camera
// picture with the green made see-through, then the gear (the depth-only hand shapes still let the real hands show
// in front of it). Off = the normal AR view (nothing keyed), so a take can be recorded either way.
// The camera picture is only valid during its XR frame, so each frame it is copied (GPU blit) into our own texture:
// if a frame arrives without a picture (about 1 in 100) the previous one is shown instead of a flash of the room.
import { detectLayout, leftEyeCanvas, brightestDir, savePano, loadPano, openPanoVideo, closePanoVideo } from './skybox.js';
import * as media from './medialib.js';

const FRAG = /* glsl */`
uniform sampler2D cam;
uniform float thr, soft, spill, matte;
varying vec2 vUv;
vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
void main() {
  vec3 c = texture2D(cam, vUv).rgb;                  // camera values are display (sRGB) values
  float g = c.g - max(c.r, c.b);                      // how much greener than red / blue
  float a = 1.0 - smoothstep(thr, thr + soft, g);     // 1 = keep (the DJ), 0 = green screen
  float m = max(c.r, c.b);
  if (c.g > m) c.g = mix(c.g, m, spill);              // spill: pull the green tint off skin, hair and clothes
  if (matte > 0.5) { c = vec3(a); a = 1.0; }          // check view: white = kept, black = keyed out
  gl_FragColor = vec4(lin(c), a);
  #include <colorspace_fragment>
}`;
const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function makeVirtualSet({ THREE, renderer, scene, skybox, envLight, key }) {
  const gl = renderer.getContext();
  const KEY0 = key.position.clone(), DEG = Math.PI / 180;
  const S = { on: false, can: false, loaded: false, file: null, sky: { h: 1.5, turn: 0, type: 'auto', key: 'on', file: '' }, light: null, miss: 0, got: 0, err: '' };
  const K = { thr: 0.08, soft: 0.1, spill: 0.7 };
  try { Object.assign(K, JSON.parse(localStorage.getItem('vire.vsetKey') || '{}')); } catch {}

  const camTex = new THREE.Texture(); camTex.colorSpace = THREE.NoColorSpace;
  const camProps = renderer.properties.get(camTex);
  const mat = new THREE.ShaderMaterial({
    uniforms: { cam: { value: camTex }, thr: { value: K.thr }, soft: { value: K.soft }, spill: { value: K.spill }, matte: { value: 0 } },
    vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, toneMapped: false,
    // stays in the opaque pass (so the gear draws after it) but blends by the key; alpha of the frame stays 1
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false; quad.renderOrder = -999; quad.visible = false; quad.raycast = () => {}; scene.add(quad);

  // ---- camera picture -> our texture
  let binding = null, own = null, ow = 0, oh = 0, blitOK = true;
  const fbR = gl.createFramebuffer(), fbD = gl.createFramebuffer();
  function grab(src, W, H) {
    if (!own || W !== ow || H !== oh) {
      if (own) gl.deleteTexture(own);
      own = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, own); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbD); gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, own, 0);
      ow = W; oh = H;
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbR); gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, src, 0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbD);
    const ok = gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (ok) gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    renderer.resetState();   // three.js caches bindings; we changed them behind its back
    return ok;
  }
  function frame(fr) {   // call once per XR frame, before rendering
    if (!S.on || !fr) return;
    const session = renderer.xr.getSession(); if (!session) return;
    if (!binding) binding = new XRWebGLBinding(session, gl);
    const pose = fr.getViewerPose(renderer.xr.getReferenceSpace()), view = pose && pose.views[0];
    let src = null;
    try { src = view && view.camera ? binding.getCameraImage(view.camera) : null; } catch (e) { S.err = e.message; }
    if (!src) { S.miss++; return; }
    S.got++;
    if (blitOK && grab(src, view.camera.width, view.camera.height)) { camProps.__webglTexture = own; quad.visible = true; }
    else { blitOK = false; camProps.__webglTexture = src; quad.visible = true; }   // fallback: use it directly (no hold on a missed frame)
  }

  // ---- panorama (picked on the phone; height / turn / type follow the Quest)
  function layoutOf(w, h) {
    const t = S.sky.type;
    if (t === 'auto') { const l = detectLayout(w, h); return l ? { layout: l, swap: false } : null; }
    return { layout: t.replace('-swap', ''), swap: t.endsWith('-swap') };
  }
  let vid = null, mediaId = '';
  async function loadFile(f) {
    if (vid) { closePanoVideo(vid); vid = null; }
    if (media.isVideoName(f.name)) {   // #185 video panorama (from the library)
      const { video, snap } = await openPanoVideo(f); vid = video;
      const L = layoutOf(video.videoWidth, video.videoHeight) || { layout: 'mono', swap: false };
      const c = leftEyeCanvas(snap, L.layout, L.swap, 2048); S.envCanvas = c; S.light = brightestDir(c);
      skybox.setVideo(video, L.layout, L.swap); skybox.setHeight(S.sky.h); S.file = f; S.loaded = true;
      if (!S.on) video.pause();
      return;
    }
    const bmp = await createImageBitmap(f), L = layoutOf(bmp.width, bmp.height);
    if (!L) { bmp.close(); throw new Error('not a 360 panorama (2:1, 1:1 or 4:1)'); }
    const c = leftEyeCanvas(bmp, L.layout, L.swap, 2048); bmp.close();
    S.envCanvas = c; S.light = brightestDir(c);
    await skybox.load(f, L.layout, L.swap); skybox.setHeight(S.sky.h);
    S.file = f; S.loaded = true;
  }
  async function pick(f) { await savePano(f); await loadFile(f); if (S.on) apply(); }
  async function ensure() { if (S.loaded) return true; const f = await loadPano(); if (!f) return false; await loadFile(f); return true; }
  function sameAsQuest() { return !S.sky.file || !S.file || S.sky.file === S.file.name + ':' + S.file.size; }

  function apply() {
    const on = S.on && S.loaded;
    skybox.group.visible = on; skybox.setStereo(false);
    if (vid) { if (on) vid.play().catch(() => {}); else vid.pause(); }
    if (!on) quad.visible = false;
    const turn = S.sky.turn * DEG;
    skybox.setTurn(turn); scene.environmentRotation.set(0, on ? turn : 0, 0);
    envLight.setImage(on ? S.envCanvas : null);
    scene.environmentIntensity = on ? envLight.intensity : 0.6;   // AR default like the Quest's passthrough (#180)
    if (on && S.sky.key === 'on' && S.light) {
      const d = S.light.dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
      const hz = Math.hypot(d.x, d.z) || 1, up = Math.max(d.y, Math.sin(35 * DEG)), k = Math.sqrt(1 - up * up) / hz;
      key.position.set(d.x * k, up, d.z * k).multiplyScalar(2.7).add(key.target.position);
      key.color.setRGB(1, 1, 1).lerp(S.light.color, 0.5);
    } else { key.position.copy(KEY0); key.color.setRGB(1, 1, 1); }
  }
  async function setOn(on) {
    if (on && !S.can) return 'This AR session has no camera access (restart the camera and allow it).';
    if (on && !(await ensure())) return 'Pick the panorama first (start screen: Virtual set panorama).';
    S.on = on; if (!on) binding = null; apply();
    return on ? (sameAsQuest() ? 'Virtual set on.' : 'Virtual set on (note: a different picture from the Quest\'s).') : 'Virtual set off: normal camera view.';
  }
  function onSky(m) {   // from the Quest: { h, turn, type, key, file, media }
    const typeChanged = m.type !== S.sky.type;
    Object.assign(S.sky, m);
    skybox.setHeight(S.sky.h);
    if (m.media && m.media !== mediaId) {   // #185 the Quest chose a library item: use this phone's copy of it
      mediaId = m.media; const i = m.media.indexOf('/');
      media.getFile(m.media.slice(0, i), m.media.slice(i + 1)).then(f => f ? loadFile(f).then(apply) : null).catch(() => {});
    } else if (typeChanged && S.file) loadFile(S.file).then(apply).catch(() => {});
    else apply();
  }
  function setKey(k, v) { K[k] = v; mat.uniforms[k].value = v; try { localStorage.setItem('vire.vsetKey', JSON.stringify(K)); } catch {} }
  function onSession(session) {   // after each AR start
    binding = null; blitOK = true; S.got = S.miss = 0; S.err = '';
    S.can = !!(session.enabledFeatures ? session.enabledFeatures.includes('camera-access') : typeof XRWebGLBinding !== 'undefined' && XRWebGLBinding.prototype.getCameraImage);
  }
  function onEnd() { const was = S.on; S.on = false; binding = null; quad.visible = false; if (was) apply(); }
  return { S, K, quad, mat, frame, pick, setOn, onSky, setKey, onSession, onEnd, apply, setMatte: v => { mat.uniforms.matte.value = v ? 1 : 0; }, sameAsQuest };
}
