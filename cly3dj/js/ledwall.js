// LED wall (CLAUDE.md #176): a big 16:9 screen you grab, move and resize like the neon sign. The mixer's LED WALL
// button (deck B's top row) switches it between OFF and VIDEO: a random clip from up to 5 videos picked in
// Settings each session (the Quest browser can't open a folder or remember one). Videos always play muted, so the
// DJ audio is never touched. When a clip ends, another one (not the same) starts.
import * as THREE from 'three';

export const LED = { W: 1.6, H: 0.9, D: 0.05, BEZ: 0.025 };   // screen size (m) at scale 1, depth, bezel

export function makeLedWall() {
  const g = new THREE.Group(); g.name = 'ledwall';
  const frame = new THREE.Mesh(new THREE.BoxGeometry(LED.W + 2 * LED.BEZ, LED.H + 2 * LED.BEZ, LED.D),
    new THREE.MeshStandardMaterial({ color: 0x121317, metalness: 0.6, roughness: 0.45 }));
  g.add(frame);
  const offMat = new THREE.MeshStandardMaterial({ color: 0x050608, metalness: 0.2, roughness: 0.18 });   // dark glossy panel when off
  const onMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(LED.W, LED.H), offMat);
  screen.position.z = LED.D / 2 + 0.001; g.add(screen);
  // #177 DECKS mode: deck A's video on the screen, deck B's added on top (additive), each scaled by its mix gain
  const deckA = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const deckB = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const screenB = new THREE.Mesh(screen.geometry, deckB); screenB.position.z = LED.D / 2 + 0.002; screenB.visible = false; g.add(screenB);
  g.traverse(o => { if (o.isMesh) o.userData.move = 'ledwall'; });
  g.userData.screen = screen;
  g.userData.setDecks = (texA, texB, gA, gB) => {   // null textures = that deck has no video (black / nothing added)
    if (deckA.map !== texA) { deckA.map = texA || null; deckA.needsUpdate = true; }
    if (deckB.map !== texB) { deckB.map = texB || null; deckB.needsUpdate = true; }
    deckA.color.setScalar(texA ? gA : 0); deckB.color.setScalar(texB ? gB : 0);
    screen.material = deckA; screenB.visible = !!texB;
  };
  let tex = null;
  // #185: a still image (ImageBitmap made with imageOrientation 'flipY'), same 'cover' fit as a video
  g.userData.setImage = bmp => {
    if (tex) { tex.dispose(); tex = null; }
    screenB.visible = false;
    if (!bmp) { screen.material = offMat; return; }
    tex = new THREE.Texture(bmp); tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
    const va = bmp.width / bmp.height, sa = LED.W / LED.H;
    if (va > sa) { tex.repeat.set(sa / va, 1); tex.offset.set((1 - sa / va) / 2, 0); } else { tex.repeat.set(1, va / sa); tex.offset.set(0, (1 - va / sa) / 2); }
    onMat.map = tex; onMat.needsUpdate = true; screen.material = onMat;
  };
  // show a <video> (or nothing). 'cover': the clip fills the 16:9 panel, cropping the long side if it isn't 16:9.
  g.userData.setVideo = video => {
    if (tex) { tex.dispose(); tex = null; }
    screenB.visible = false;
    if (!video) { screen.material = offMat; return; }
    tex = new THREE.VideoTexture(video); tex.colorSpace = THREE.SRGBColorSpace;
    const fit = () => {
      const va = (video.videoWidth || 16) / (video.videoHeight || 9), sa = LED.W / LED.H;
      if (va > sa) { tex.repeat.set(sa / va, 1); tex.offset.set((1 - sa / va) / 2, 0); } else { tex.repeat.set(1, va / sa); tex.offset.set(0, (1 - va / sa) / 2); }
    };
    fit(); video.addEventListener('loadedmetadata', fit, { once: true });
    onMat.map = tex; onMat.needsUpdate = true; screen.material = onMat;
  };
  return g;
}

// Plays clips on a wall. Host (Quest): random order from its files. Follower (spectator phone): plays whatever
// clip name + time the Quest reports, if it has a file with the same name.
const IMG_SECONDS = 8;
const isImage = f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name);
export class LedPlayer {
  constructor(wall) { this.wall = wall; this.files = []; this.video = null; this.name = null; this.on = false; this.onChange = null; }
  setFiles(list, max = 5) {   // #185: images too (shown IMG_SECONDS each in the playlist)
    this.files = [...list].filter(f => /^(video|image)\//.test(f.type) || /\.(mp4|m4v|webm|mov|mkv|jpe?g|png|webp|gif|avif)$/i.test(f.name)).slice(0, max);
    if (this.on && !this.files.length) this.stop();
    return this.files.length;
  }
  get hasFiles() { return this.files.length > 0; }
  fileNamed(n) { return this.files.find(f => f.name === n) || null; }
  add(file) { if (!this.files.some(f => f.name === file.name)) this.files.push(file); return this.files.length; }
  play(file, loop = false) { this.on = true; this._open(file, loop ? null : () => this.playRandom()); if (loop && this.video) this.video.loop = true; this.onChange && this.onChange(); }
  _open(file, onEnded) {
    this._close();
    if (isImage(file)) {   // #185 still image
      const name = file.name; this.name = name; this.img = true;
      createImageBitmap(file, { imageOrientation: 'flipY' }).then(b => { if (this.name === name && this.img) this.wall.userData.setImage(b); }).catch(() => {});
      if (onEnded) this.imgT = setTimeout(() => { if (this.name === name) onEnded(); }, IMG_SECONDS * 1000);
      return;
    }
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.src = URL.createObjectURL(file); v._url = v.src;
    v.addEventListener('ended', () => onEnded && onEnded());
    v.play().catch(() => {});
    this.video = v; this.name = file.name; this.wall.userData.setVideo(v);
  }
  _close() {
    clearTimeout(this.imgT); this.img = false;
    const v = this.video; this.video = null; this.name = null; this.wall.userData.setVideo(null);
    if (v) { v.pause(); URL.revokeObjectURL(v._url); v.removeAttribute('src'); v.load(); }   // frees the decoder
  }
  playRandom() {
    if (!this.files.length) return false;
    const pool = this.files.length > 1 ? this.files.filter(f => f.name !== this.name) : this.files;
    const f = pool[Math.floor(Math.random() * pool.length)];
    this.on = true; this._open(f, () => this.playRandom()); this.onChange && this.onChange();
    return true;
  }
  stop() { this.on = false; this._close(); this.onChange && this.onChange(); }
  // follower: match the host's clip and time (seek only when more than 0.3 s out, so playback stays smooth)
  follow(on, name, t) {
    if (!on || !name) { if (this.video) this._close(); this.on = false; return; }
    const f = this.fileNamed(name); if (!f) { if (this.video) this._close(); return; }
    if (this.name !== name) { this._open(f, null); if (this.video) this.video.loop = true; }
    this.on = true;
    const v = this.video; if (v && v.readyState >= 1 && Math.abs(v.currentTime - t) > 0.3) v.currentTime = t;
  }
  state() { return { on: this.on, name: this.name, t: this.video ? this.video.currentTime : 0 }; }
}
