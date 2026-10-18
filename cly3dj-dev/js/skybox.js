// #182 (owner): grounded panorama skybox, mono or stereo.
// The panorama is drawn on a big sphere whose lower half is squashed flat onto the real floor (y = 0), so the
// pano's floor lies in the same plane as the gear's feet and stays locked to it when the head or the desktop
// camera moves (a plain sky sphere puts the floor "far below", and the gear seems to slide over it).
// `height` = how high the panorama camera was above its floor when it was shot (Settings > Pano height).
// Each pixel is looked up from its exact direction in the shader, so the flattened floor isn't distorted.
// Stereo panoramas (over-under 1:1, or side-by-side 4:1): in the headset the left eye sees one half and the right
// eye the other (three.js XR layers 1 and 2); on the desktop and in recordings only the left eye is used.
import * as THREE from 'three';

const R = 20;               // default sphere radius (m): inside the camera's 30 m far plane
const MAX_PIX = 8192 * 4096; // biggest texture kept (about 180 MB with mipmaps); larger files are scaled down

// #403 (owner: dome flicker, passthrough showing when looking down) cheaper and steadier:
//  - UVs come from the sphere's own vertices (SphereGeometry's equirect uv, mirrored to match), not atan / asin per
//    pixel; flattening only moves vertices along their own direction, so the floor is still undistorted. The hardware
//    gradients are then correct everywhere (the geometry has its own seam column), so the old textureGrad seam fix goes.
//  - drawn LAST among the opaque objects, pinned just inside the far plane: the GPU skips every dome pixel the decks,
//    mixer, tablet, hands and walls already cover (it used to shade the whole sphere first and paint over it).
//  - video panos (no mipmaps): where one screen pixel spans more than ~1.2 texels (far floor, grazing angles) four
//    rotated-grid taps are averaged instead of one, which stops the sparkle that read as flicker; where the video is
//    magnified (most of the view: a 5.7K video is coarser than the Quest 3's pixels) it stays a single sharp tap.
//  Still pictures keep full resolution, trilinear mipmaps and 4x anisotropy.
const VERT = /* glsl */`
varying vec3 vDir;
varying vec2 vUv;
void main() {
  vDir = position;
  vUv = vec2(1.0 - uv.x, uv.y);   // SphereGeometry's u runs the other way round from atan(z, x)
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w * 0.99999;   // just inside the far plane: behind everything, drawn only where nothing else is
}`;
const FRAG = /* glsl */`
uniform sampler2D map;
uniform vec4 so;            // u = u * so.x + so.y, v = v * so.z + so.w (picks the eye's half)
uniform vec2 texSize;       // texels (whole picture)
uniform float aa;           // 1 = video (no mipmaps): footprint-adaptive 4-tap
varying vec3 vDir;
varying vec2 vUv;
void main() {
  vec2 uv = vec2(vUv.x * so.x + so.y, vUv.y * so.z + so.w);
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec4 c;
  float fp = max(length(dx * texSize), length(dy * texSize));
  if (aa > 0.5 && fp > 1.2) {
    c = 0.25 * (texture2D(map, uv + dx * 0.125 + dy * 0.375) + texture2D(map, uv + dx * 0.375 - dy * 0.125)
              + texture2D(map, uv - dx * 0.125 - dy * 0.375) + texture2D(map, uv - dx * 0.375 + dy * 0.125));
  } else c = texture2D(map, uv);
  gl_FragColor = c;
  #include <colorspace_fragment>
}`;

// Stereo layout from the picture's shape: 1:1 = over-under, 4:1 = side-by-side, 2:1 = mono. Anything else isn't a panorama.
export function detectLayout(w, h) {
  const a = w / h;
  if (a > 0.9 && a < 1.1) return 'ou';
  if (a > 3.6 && a < 4.4) return 'sbs';
  if (a > 1.8 && a < 2.2) return 'mono';
  return null;
}
// [left eye, right eye] as `so` vectors. Top of the texture is v = 1 (flipY).
function halves(layout, swap) {
  const full = [1, 0, 1, 0];
  if (layout === 'ou') { const top = [1, 0, 0.5, 0.5], bot = [1, 0, 0.5, 0]; return swap ? [bot, top] : [top, bot]; }
  if (layout === 'sbs') { const l = [0.5, 0, 1, 0], r = [0.5, 0.5, 1, 0]; return swap ? [r, l] : [l, r]; }
  return [full, full];
}
// The left eye as its own 2:1 canvas (for reflections and lighting), at most `w` wide.
export function leftEyeCanvas(src, layout, swap, w = 2048) {
  const sw = src.width, sh = src.height;
  let sx = 0, sy = 0, cw = sw, ch = sh;
  if (layout === 'ou') { ch = sh / 2; sy = swap ? sh / 2 : 0; }
  if (layout === 'sbs') { cw = sw / 2; sx = swap ? sw / 2 : 0; }
  const W = Math.min(w, cw), c = document.createElement('canvas'); c.width = W; c.height = Math.round(W / 2);
  c.getContext('2d').drawImage(src, sx, sy, cw, ch, 0, 0, c.width, c.height);
  return c;
}
// Direction and colour of the brightest part of the upper half (windows, lamps, sun) for the key light.
export function brightestDir(canvas) {
  const W = 128, H = 64, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(canvas, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data, lum = [];
  let max = 0;
  for (let y = 4; y < H / 2 - 1; y++) for (let x = 0; x < W; x++) {   // from about 80 degrees up down to the horizon
    const i = (y * W + x) * 4, l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    lum.push([l, x, y, i]); if (l > max) max = l;
  }
  // only the brightest pixels count, weighted steeply by brightness (a window beats a plain white ceiling)
  const d = new THREE.Vector3(), col = [0, 0, 0];
  for (const [l, x, y, i] of lum) {
    if (l < max * 0.9) continue;
    const u = (x + 0.5) / W, v = 1 - (y + 0.5) / H, phi = (u - 0.5) * 2 * Math.PI, lat = (v - 0.5) * Math.PI;
    const w = (l / max) ** 16 * Math.cos(lat);
    d.x += w * Math.cos(phi) * Math.cos(lat); d.y += w * Math.sin(lat); d.z += w * Math.sin(phi) * Math.cos(lat);
    col[0] += w * px[i]; col[1] += w * px[i + 1]; col[2] += w * px[i + 2];
  }
  d.normalize();
  const m = Math.max(...col) || 1;
  return { dir: d, color: new THREE.Color(col[0] / m, col[1] / m, col[2] / m) };   // sRGB-ish, brightest channel = 1
}

export class Skybox {
  constructor(renderer) {
    this.maxTex = Math.min(16384, renderer.capabilities.maxTextureSize || 8192);
    this.group = new THREE.Group(); this.group.visible = false; this.group.name = 'skybox';
    this.height = 1.5; this.radius = R; this.layout = 'mono'; this.swap = false; this.stereoOn = false; this.tex = null;
    this.mats = [0, 1].map(() => new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, so: { value: new THREE.Vector4(1, 0, 1, 0) }, texSize: { value: new THREE.Vector2(4096, 2048) }, aa: { value: 0 } },
      vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, toneMapped: false,
    }));
    this.geo = null; this.setHeight(this.height);
    this.meshes = this.mats.map(m => {
      const s = new THREE.Mesh(this.geo, m); s.frustumCulled = false; s.renderOrder = 1000; s.raycast = () => {};   // #403 last of the opaque objects (was -1000, first)
      this.group.add(s); return s;
    });
    this.setStereo(false);
  }
  // Rebuild the flattened sphere for a new camera height (32k vertices, a few ms).
  setHeight(h) {
    this.height = h = Math.max(0.2, h);
    const g = new THREE.SphereGeometry(this.radius, 256, 128), pos = g.getAttribute('position'), v = new THREE.Vector3();
    const y1 = -h * 1.5;   // below this the sphere lies flat on the floor; between it and the horizon it curves down smoothly
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i); if (v.y >= 0) continue;
      v.multiplyScalar(v.y < y1 ? -h / v.y : 1 - v.y * v.y / (3 * y1 * y1));
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeBoundingSphere();
    if (this.geo) this.geo.dispose();
    this.geo = g; if (this.meshes) this.meshes.forEach(m => { m.geometry = g; });
    this.group.position.y = h;
  }
  // #346 DOME SIZE (PORTALS SETUP): a smaller sphere brings the walls in (3 m = a room round the booth); the floor
  // stays flat at the pano's camera height, so the gear still stands on it
  setRadius(r) { r = Math.min(R, Math.max(3, r)); if (r === this.radius) return; this.radius = r; this.setHeight(this.height); }
  fit(w, h) {   // size the texture may have (GPU limit and memory cap)
    const k = Math.min(1, this.maxTex / w, this.maxTex / h, Math.sqrt(MAX_PIX / (w * h)));
    return [Math.round(w * k), Math.round(h * k)];
  }
  // src: an ImageBitmap already sized with fit() and made with imageOrientation 'flipY'. It is closed once it is on
  // the GPU, so the full-size picture doesn't also sit in memory.
  async load(file, layout, swap = false) {
    const full = await createImageBitmap(file), [w, h] = this.fit(full.width, full.height);
    const bmp = await createImageBitmap(full, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high', imageOrientation: 'flipY' });
    full.close(); this.setImage(bmp, layout, swap);
  }
  setImage(bmp, layout, swap = false) {
    if (this.tex) { this.tex.dispose(); this.tex = null; }
    if (!bmp) { this.mats.forEach(m => { m.uniforms.map.value = null; }); return; }
    const t = new THREE.Texture(bmp);
    t.flipY = false;   // flipped when the bitmap was made
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.needsUpdate = true;
    t.onUpdate = () => { if (bmp.close) bmp.close(); };
    this.tex = t; this.size = [bmp.width, bmp.height];
    this.mats.forEach(m => { m.uniforms.map.value = t; m.uniforms.texSize.value.set(bmp.width, bmp.height); m.uniforms.aa.value = 0; });   // #403
    this.setLayout(layout, swap);
  }
  // #185 video panorama: a looping muted <video> (see openPanoVideo); no mipmaps, decoded every frame
  setVideo(video, layout, swap = false) {
    if (this.tex) { this.tex.dispose(); this.tex = null; }
    const t = new THREE.VideoTexture(video);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
    this.tex = t; this.size = [video.videoWidth, video.videoHeight];
    this.mats.forEach(m => { m.uniforms.map.value = t; m.uniforms.texSize.value.set(video.videoWidth, video.videoHeight); m.uniforms.aa.value = 1; });   // #403 4-tap where minified
    this.setLayout(layout, swap);
  }
  setLayout(layout, swap) {
    this.layout = layout; this.swap = !!swap;
    const [l, r] = halves(layout, this.swap);
    this.mats[0].uniforms.so.value.fromArray(l); this.mats[1].uniforms.so.value.fromArray(r);
    this.setStereo(this.stereoOn);
  }
  // In the headset with a stereo picture: mesh 0 only in the left eye (layer 1), mesh 1 only in the right (layer 2).
  // Otherwise mesh 0 on layer 0 (desktop, mono, recordings) and mesh 1 hidden.
  setStereo(on) {
    this.stereoOn = on; const st = on && this.layout !== 'mono';
    this.meshes[0].layers.set(st ? 1 : 0);
    this.meshes[1].layers.set(2); this.meshes[1].visible = st;
  }
  setTurn(rad) { this.group.rotation.y = rad; }
}

// The chosen panorama file is kept in the site's private storage (OPFS) at full size; localStorage only has room for
// the small copy used for lighting.
const DIR = 'vire-sky';
export async function savePano(file) {
  try {
    const root = await navigator.storage.getDirectory(), d = await root.getDirectoryHandle(DIR, { create: true });
    const fh = await d.getFileHandle('pano', { create: true }), w = await fh.createWritable();
    await w.write(file); await w.close(); return true;
  } catch (e) { console.warn('pano not saved', e); return false; }
}
export async function loadPano() {
  try {
    const root = await navigator.storage.getDirectory(), d = await root.getDirectoryHandle(DIR);
    return await (await d.getFileHandle('pano')).getFile();
  } catch { return null; }
}
export async function clearPano() {
  try { const root = await navigator.storage.getDirectory(); await root.removeEntry(DIR, { recursive: true }); } catch {}
}

// #185 open a video panorama file: looping, muted, playing; plus a still of its first frame (<= 2048 wide) for the
// lighting / reflections and the layout check
export async function openPanoVideo(file) {
  const v = document.createElement('video'); v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
  v._url = URL.createObjectURL(file); v.src = v._url;
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('this video does not play here')); });
  await v.play().catch(() => {});
  const W = Math.min(2048, v.videoWidth), c = document.createElement('canvas'); c.width = W; c.height = Math.round(W * v.videoHeight / v.videoWidth);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  return { video: v, snap: c };
}
export function closePanoVideo(v) { if (!v) return; v.pause(); URL.revokeObjectURL(v._url); v.removeAttribute('src'); v.load(); }
