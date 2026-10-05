// #187 Look match (spectator phone): make the virtual gear look filmed by the same camera.
// 1. Camera grade: every 8th AR frame a 32 px copy of the camera picture is read back (camera-access); its average
//    brightness and colour cast give a gentle exposure and white-balance grade (smoothed over about a second).
// 2. Grain: film-like noise, stronger when the camera picture is darker (phones raise ISO in the dark).
//    Both are one full-screen pass that only touches the gear's pixels: a quad just short of the far plane with a
//    GREATER depth test passes only where something was drawn (the camera picture, the skybox and the keyed camera
//    quad write no depth). Blending is "2 x multiply" (src*dst + dst*src), so output 0.5 = unchanged.
// 3. Room light: WebXR light estimation (ARCore) lights the gear from the real room: spherical-harmonics ambient
//    (a LightProbe) and the main light's direction / colour on the key light; the studio environment then only
//    gives reflections. Off while the virtual set is on (the pano lights the gear then).
const VERT = `void main() { gl_Position = vec4(position.xy, 0.99999, 1.0); }`;
const FRAG = `
uniform vec3 grade; uniform float grain, t;
float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
void main() {
  float n = hash(floor(gl_FragCoord.xy) + t) - 0.5;
  gl_FragColor = vec4(0.5 * grade * (1.0 + 2.0 * grain * n), 1.0);
}`;

export function makeLookMatch({ THREE, renderer, scene, rig, key }) {
  const L = { on: true, strength: 0.7, grain: 0.5, room: true };
  try { Object.assign(L, JSON.parse(localStorage.getItem('sed.look') || '{}')); } catch {}
  const save = () => { try { localStorage.setItem('sed.look', JSON.stringify(L)); } catch {} };
  const st = { cam: false, camN: 0, lum: 0.42, target: new THREE.Vector3(1, 1, 1), grade: new THREE.Vector3(1, 1, 1), probe: null, le: false, leN: 0, frameN: 0, active: false };

  const mat = new THREE.ShaderMaterial({
    uniforms: { grade: { value: st.grade }, grain: { value: 0 }, t: { value: 0 } },
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: true, depthWrite: false, depthFunc: THREE.GreaterDepth, toneMapped: false,
    blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcColorFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false; quad.renderOrder = 10000; quad.visible = false; quad.raycast = () => {}; scene.add(quad);

  const probeLight = new THREE.LightProbe(); probeLight.intensity = 0; scene.add(probeLight);
  let saved = null;   // key / environment as they were before room light took over
  const _q = new THREE.Quaternion(), _v = new THREE.Vector3();

  function onCamera(px) {   // RGBA bytes of a tiny copy of the camera picture
    let r = 0, g = 0, b = 0; const n = px.length / 4;
    for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
    r /= n * 255; g /= n * 255; b /= n * 255;
    const lum = Math.max(0.02, 0.2126 * r + 0.7152 * g + 0.0722 * b);
    const tint = [r, g, b].map(c => Math.min(1.15, Math.max(0.85, c / lum)));   // grey-world cast, at most +-15 %
    const e = Math.min(1.35, Math.max(0.7, Math.sqrt(lum / 0.42)));                // gentle exposure follow
    st.target.set(tint[0] * e, tint[1] * e, tint[2] * e); st.lum = lum; st.cam = true; st.camN++;
  }
  const wantsCam = () => L.on && st.active && (st.frameN % 8 === 0);

  async function onSession(session) {
    st.active = true; st.cam = false; st.le = false; st.probe = null; st.leN = 0;
    const has = f => !session.enabledFeatures || session.enabledFeatures.includes(f);
    if (has('light-estimation') && session.requestLightProbe) {
      try { st.probe = await session.requestLightProbe(); } catch { st.probe = null; }
    }
  }
  function roomOff() {
    probeLight.intensity = 0;
    if (saved) { key.position.copy(saved.pos); key.color.copy(saved.col); key.intensity = saved.int; scene.environmentIntensity = saved.env; saved = null; }
  }
  function onEnd() { st.active = false; quad.visible = false; roomOff(); st.probe = null; }

  // per frame, before rendering. setOn: the virtual set is on (it lights the gear from the pano)
  function frame(fr, dt, setOn) {
    st.frameN++;
    if (!st.active || !L.on) { quad.visible = false; roomOff(); return; }
    // room light
    const est = fr && st.probe && L.room && !setOn ? fr.getLightEstimate(st.probe) : null;
    if (est) {
      if (!saved) saved = { pos: key.position.clone(), col: key.color.clone(), int: key.intensity, env: scene.environmentIntensity };
      probeLight.sh.fromArray(est.sphericalHarmonicsCoefficients); probeLight.intensity = 1;
      const I = est.primaryLightIntensity, m = Math.max(1, I.x, I.y, I.z);
      key.color.setRGB(I.x / m, I.y / m, I.z / m); key.intensity = m;
      const d = est.primaryLightDirection;
      _v.set(d.x, d.y, d.z).applyQuaternion(_q.copy(rig.quaternion).invert());   // world -> rig (the key lives in the rig)
      if (_v.y < 0.2) _v.y = 0.2; _v.normalize();
      key.position.copy(key.target.position).addScaledVector(_v, 2.7);
      scene.environmentIntensity = 0.3;   // reflections only; the probe gives the ambient light
      st.le = true; st.leN++;
    } else if (setOn) { probeLight.intensity = 0; saved = null; }   // the virtual set owns the key light now
    else if (saved) roomOff();
    // grade + grain
    const s = setOn ? 0 : L.strength, k = 1 - Math.exp(-dt / 0.8);
    _v.set(1, 1, 1).lerp(st.target, st.cam ? s : 0);
    st.grade.lerp(_v, k);
    const dark = Math.min(1, Math.max(0, (0.45 - st.lum) / 0.35));
    mat.uniforms.grain.value = L.grain * (0.02 + 0.05 * dark);
    mat.uniforms.t.value = (st.frameN * 7.13) % 1000;
    quad.visible = L.grain > 0 || st.cam;
  }
  function set(k, v) { L[k] = v; save(); }
  function status() {
    if (!st.active) return 'Start the camera first.';
    return `Camera grade: ${st.cam ? 'on' : 'needs camera access'} · Room light: ${st.probe ? (L.room ? (st.le ? 'on' : 'waiting') : 'off') : 'not available'}`;
  }
  return { L, st, quad, frame, onCamera, wantsCam, onSession, onEnd, set, status };
}
