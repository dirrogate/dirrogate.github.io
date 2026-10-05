// Environment lighting (CLAUDE.md #36). The studio RoomEnvironment is always the base; an image is
// blended over it at `mix` (default 50%) and the result becomes scene.environment (reflections + ambient).
// Image sources: a picture the user picks, or a passthrough camera snapshot taken every few minutes
// (Quest Browser exposes the headset cameras through getUserMedia after the user allows it).
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';

const WIN_DEG = 100;   // horizontal size of a non-panorama picture on the environment sphere
function windowPanorama(src) {
  const W = 2048, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const ww = WIN_DEG / 360 * W, hDeg = Math.min(150, WIN_DEG * src.height / src.width), wh = hDeg / 180 * H;
  // straight ahead (-z) is u = 0.25 on this sphere (with the mirrored repeat); horizon = middle row
  const x0 = 0.25 * W - ww / 2, y0 = H / 2 - wh / 2;
  const tmp = document.createElement('canvas'); tmp.width = Math.round(ww); tmp.height = Math.round(wh);
  const tg = tmp.getContext('2d'); tg.drawImage(src, 0, 0, tmp.width, tmp.height);
  // soft edges: fade the outer 18 % to transparent (the studio shows through)
  tg.globalCompositeOperation = 'destination-in';
  const fx = tg.createLinearGradient(0, 0, tmp.width, 0); fx.addColorStop(0, 'rgba(0,0,0,0)'); fx.addColorStop(0.18, '#000'); fx.addColorStop(0.82, '#000'); fx.addColorStop(1, 'rgba(0,0,0,0)');
  tg.fillStyle = fx; tg.fillRect(0, 0, tmp.width, tmp.height);
  const fy = tg.createLinearGradient(0, 0, 0, tmp.height); fy.addColorStop(0, 'rgba(0,0,0,0)'); fy.addColorStop(0.18, '#000'); fy.addColorStop(0.82, '#000'); fy.addColorStop(1, 'rgba(0,0,0,0)');
  tg.fillStyle = fy; tg.fillRect(0, 0, tmp.width, tmp.height);
  g.drawImage(tmp, x0, y0);
  return c;
}
// #172 (owner): a landscape photo (e.g. 16:9) that isn't a panorama wraps the whole room as two copies of 180 deg
// each: the photo straight ahead, a mirror image of it behind, so both joins match edge to edge. Above and below
// the photo the top and bottom rows are stretched out to the ceiling and floor, so they keep the room's colours.
function twinPanorama(src) {
  const W = 2048, H = 1024, half = W / 2, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), sw = src.width, sh = src.height;
  const ph = Math.min(H, Math.round(half * sh / sw)), y0 = Math.round((H - ph) / 2);
  const band = (dx, flip) => {
    g.save(); if (flip) { g.translate(dx + half, 0); g.scale(-1, 1); } else g.translate(dx, 0);
    g.drawImage(src, 0, 0, sw, sh, 0, y0, half, ph);                              // the photo
    if (y0 > 0) {
      g.drawImage(src, 0, 0, sw, 1, 0, 0, half, y0);                              // top row -> ceiling
      g.drawImage(src, 0, sh - 1, sw, 1, 0, y0 + ph, half, H - y0 - ph);          // bottom row -> floor
    }
    g.restore();
  };
  band(0, false);      // front: u 0..0.5, centred on straight ahead (u = 0.25)
  band(half, true);    // back: mirrored
  return c;
}
export class EnvLight {
  constructor(renderer, scene, intensity = 0.55) {
    this.renderer = renderer; this.scene = scene; this.intensity = intensity;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.room = new RoomEnvironment();
    this.sphereMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
    // #174: radius 0.5, inside everything in the studio (its floor is only 0.93 m below the centre; the nearest box
    // starts ~2.8 m out). At 4 m the studio floor and some boxes sat inside the photo sphere, so they still showed
    // in reflections even at 100 % image. (PMREM's cube camera near plane is 0.1 m.)
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(0.5, 48, 24), this.sphereMat);
    this.sphere.visible = false; this.room.add(this.sphere);
    this.rt = null; this.timer = null; this.mix = 0.5;
    this.rebuild();
  }
  rebuild() {
    const rt = this.pmrem.fromScene(this.room, 0.04);
    if (this.rt) this.rt.dispose();
    this.rt = rt; this.scene.environment = rt.texture; this.scene.environmentIntensity = this.intensity;
  }
  setImage(source) { // HTMLImageElement | ImageBitmap | HTMLCanvasElement | null
    if (this.sphereMat.map) this.sphereMat.map.dispose();
    if (this.skyTex) { this.skyTex.dispose(); this.skyTex = null; }
    if (!source) { this.sphere.visible = false; this.sphereMat.map = null; this.rebuild(); return; }
    // #143: a 360 panorama (equirectangular, about 2:1) wraps the whole sphere. Any other picture (a photo of a
    // neon sign, a window...) becomes a window about 100 deg wide at eye level straight ahead (-z, the way the DJ
    // faces), with soft edges; the studio lighting shows everywhere else instead of the photo being stretched
    // round the whole room.
    const w = source.width, h = source.height, pano = w / h > 1.8 && w / h < 2.2, wide = !pano && w / h >= 1.3;
    this.isPano = pano;
    const img = pano ? source : wide ? twinPanorama(source) : windowPanorama(source);   // #172: landscape -> two 180 deg copies; portrait/square -> window
    const t = new THREE.Texture(img); t.needsUpdate = true; t.colorSpace = THREE.SRGBColorSpace;
    // flip so it isn't mirrored from the inside
    t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1;
    this.sphereMat.map = t; this.sphereMat.opacity = this.mix; this.sphereMat.needsUpdate = true; this.sphere.visible = true;
    // #175: the same panorama as a visible skybox (main.js shows it when Settings > Show as surroundings is on)
    const st = new THREE.Texture(img); st.mapping = THREE.EquirectangularReflectionMapping; st.colorSpace = THREE.SRGBColorSpace; st.needsUpdate = true;
    this.skyTex = st;
    this.rebuild();
  }
  setMix(m) { this.mix = m; this.sphereMat.opacity = m; if (this.sphere.visible) this.rebuild(); }

  async setFromFile(file) {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas'); c.width = Math.min(1024, bmp.width); c.height = Math.round(c.width * bmp.height / bmp.width);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    this.setImage(c);
  }

  // One camera frame -> environment. Opens the camera only for the snapshot.
  async snapshot() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 } }, audio: false });
    try {
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = stream;
      await v.play(); await new Promise(r => setTimeout(r, 400)); // let exposure settle
      const c = document.createElement('canvas'); c.width = v.videoWidth || 640; c.height = v.videoHeight || 480;
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      this.setImage(c);
    } finally { stream.getTracks().forEach(t => t.stop()); }
  }
  startCamera(minutes = 5, onError) {
    this.stopCamera();
    const run = () => this.snapshot().catch(e => { onError && onError(e); });
    run(); this.timer = setInterval(run, minutes * 60 * 1000);
  }
  stopCamera() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
