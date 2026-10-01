// #214 Look without AR (fixed camera mode, spectator phone). ARCore light estimation doesn't exist on a plain camera
// feed, so the gear is lit and graded from three sources, all set from the Quest's LOOK tab (or here), saved per
// camera (main / selfie see the room differently):
// 1. Camera grade + grain: lookmatch.js as in AR, fed a 32 x 18 copy of the camera video every 4th frame (cheap here:
//    no AR read-back), so the gear follows the camera's exposure and colour cast, smoothed so strobes don't flicker it.
// 2. Venue 360 photo as light only (never shown): the gear's environment lighting and reflections come from a photo
//    taken where the decks stand; turn it to line up with the real room. KEY FROM PANO aims the key light at the
//    photo's brightest spot (window, lamp) and takes its colour.
// 3. Manual light: the key light's turn / height / strength / colour temperature, and the ambient (environment) level.
import * as media from './medialib.js';
import { detectLayout, leftEyeCanvas, brightestDir } from './skybox.js';

const DEG = Math.PI / 180;
const DEF = { on: true, strength: 0.7, grain: 0.5, amb: 0.6, kTurn: 0, kHeight: 0, kInt: 1, kTemp: 6500, kRGB: null, env: '', envTurn: 0 };
export const FL_LIM = { strength: [0, 1], grain: [0, 1], amb: [0, 3], kTurn: [-180, 180], kHeight: [5, 90], kInt: [0, 5], kTemp: [2000, 12000], envTurn: [-180, 180] };

export function tempRGB(K) {   // colour temperature (Kelvin) -> linear-ish RGB 0..1 (Tanner Helland's fit)
  const t = K / 100; let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
  const c = v => Math.min(255, Math.max(0, v)) / 255; return [c(r), c(g), c(b)];
}

export function makeFixLook({ THREE, scene, key, envLight, look, getVideo }) {
  const KEY0 = { pos: key.position.clone(), col: key.color.clone(), int: key.intensity };
  // the default turn / height = where the key light normally is, so nothing jumps when fixed mode starts
  const d0 = KEY0.pos.clone().sub(key.target.position).normalize();
  DEF.kTurn = Math.round(Math.atan2(d0.x, d0.z) / DEG); DEF.kHeight = Math.round(Math.asin(d0.y) / DEG);
  let F = { ...DEF }, facing = '', on = false, saved = null, env = null, envMsg = '', frameN = 0;
  const cv = document.createElement('canvas'); cv.width = 32; cv.height = 18;
  const cg = cv.getContext('2d', { willReadFrequently: true });
  const keyOf = f => 'vire.fixlook.' + (f === 'user' ? 'selfie' : 'main');
  const save = () => { try { localStorage.setItem(keyOf(facing), JSON.stringify(F)); } catch {} };
  const load = f => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(keyOf(f)) || '{}') }; } catch { return { ...DEF }; } };

  function applyLight() {
    if (!on) return;
    const t = F.kTurn * DEG, h = F.kHeight * DEG;
    key.position.set(Math.sin(t) * Math.cos(h), Math.sin(h), Math.cos(t) * Math.cos(h)).multiplyScalar(2.7).add(key.target.position);
    const c = F.kRGB || tempRGB(F.kTemp); key.color.setRGB(c[0], c[1], c[2]); key.intensity = F.kInt;
    look.L.on = F.on; look.L.strength = F.strength; look.L.grain = F.grain;
    scene.environmentRotation.set(0, env ? F.envTurn * DEG : 0, 0);
    scene.environmentIntensity = F.amb;
  }
  async function loadEnv() {   // F.env = 'Pano/name' from this phone's library
    const want = F.env;
    if (!want) { if (env) { env = null; envLight.setImage(null); } envMsg = ''; applyLight(); return; }
    if (env && env.id === want) { applyLight(); return; }
    envMsg = 'loading ' + want.split('/').pop();
    try {
      const i = want.indexOf('/'), f = await media.getFile(want.slice(0, i), want.slice(i + 1));
      if (!f) throw new Error('not on this phone (push it from the Quest: PANO tab, LIGHT PHONE)');
      const bmp = await createImageBitmap(f), L = detectLayout(bmp.width, bmp.height) || { layout: 'mono', swap: false };
      const c = leftEyeCanvas(bmp, L.layout, L.swap, 2048); bmp.close();
      if (F.env !== want || !on) return;
      env = { id: want, canvas: c, light: brightestDir(c) };
      envLight.setMix(1); envLight.setImage(c); envMsg = '';
    } catch (e) { env = null; envLight.setImage(null); envMsg = e.message; }
    applyLight(); onChange && onChange();
  }
  function keyFromPano() {   // aim the key at the photo's brightest spot (turned with the photo), take its colour
    if (!env || !env.light) return false;
    const d = env.light.dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), F.envTurn * DEG);
    F.kTurn = Math.round(Math.atan2(d.x, d.z) / DEG); F.kHeight = Math.round(Math.min(80, Math.max(20, Math.asin(Math.max(-1, Math.min(1, d.y))) / DEG)));
    const c = new THREE.Color(1, 1, 1).lerp(env.light.color, 0.6); F.kRGB = [c.r, c.g, c.b].map(v => +v.toFixed(3));
    return true;
  }

  // fixed mode started / stopped / switched camera (called every frame by the client; cheap when nothing changed)
  function sync(fixedOn, f) {
    if (fixedOn && (!on || f !== facing)) {
      if (!on) { saved = { pos: key.position.clone(), col: key.color.clone(), int: key.intensity, L: { ...look.L }, mix: envLight.mix }; look.st.active = true; look.st.cam = false; }
      on = true; facing = f; F = load(f); env = null; loadEnv(); onChange && onChange();
    } else if (!fixedOn && on) {
      on = false; env = null; envLight.setImage(null);
      if (saved) { key.position.copy(saved.pos); key.color.copy(saved.col); key.intensity = saved.int; Object.assign(look.L, saved.L); envLight.setMix(saved.mix); saved = null; }
      scene.environmentRotation.set(0, 0, 0); look.onEnd(); onChange && onChange();
    }
  }
  function frame() {   // per frame in fixed mode: feed the camera grade
    if (!on || !F.on) return;
    if (++frameN % 4) return;
    const v = getVideo(); if (!v || v.readyState < 2) return;
    try { cg.drawImage(v, 0, 0, 32, 18); look.onCamera(cg.getImageData(0, 0, 32, 18).data); } catch {}
  }
  function set(k, v) {
    if (!on) return 'Start Fixed camera on the phone first.';
    if (k === 'keyFromPano') { if (!keyFromPano()) return 'Load a 360 light photo first.'; }
    else if (k === 'env') { F.env = v || ''; save(); loadEnv(); return ''; }
    else if (k === 'reset') { const e = F.env; F = { ...DEF, env: e }; }
    else if (typeof v === 'boolean') F[k] = v;
    else if (FL_LIM[k]) {
      let n = +v; if (k === 'kTurn' || k === 'envTurn') n = ((n + 540) % 360) - 180;
      F[k] = Math.min(FL_LIM[k][1], Math.max(FL_LIM[k][0], n));
      if (k === 'kTemp') F.kRGB = null;   // a temperature replaces the colour taken from the photo
    } else return 'unknown setting';
    save(); applyLight(); return '';
  }
  let onChange = null;
  const state = () => on ? { ...F, cam: facing, envOK: !!env, envMsg, pano: !!(env && env.light) } : null;
  return { sync, frame, set, state, tempRGB, get on() { return on; }, set onChange(f) { onChange = f; } };
}
