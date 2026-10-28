// Visuals playlist player (CLAUDE.md #176, #530 gemini_argon_: 3D LED wall mesh removed; visuals run as a 2D backdrop).
// Plays clips and images for the stream / DirroTV / DirroVJ backdrop and Dirrogram phones. Videos always play muted,
// so the DJ audio is never touched.

export const LED = { W: 1.6, H: 0.9, D: 0.05, BEZ: 0.025 };
export const LED_CURVE_MAX = 150;

// Plays clips for the 2D backdrop. Host (Quest): random or list order from its files. Follower (spectator / DirroVJ):
// plays whatever clip name + time the Quest reports, if it has a file with the same name.
const IMG_SECONDS = 8;
const isImage = f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name);
export class LedPlayer {
  constructor() {
    const self = this;
    this.curImage = null;
    this.wall = { userData: { get curImage() { return self.curImage; }, setImage: b => { self.curImage = b; }, setVideo() {}, setDecks() {}, setCanvas: () => null, setCam() {}, setCurve() {}, curveDeg: () => 0, curveRad: () => 0, portrait: () => false, tick() {} } };
    this.files = []; this.video = null; this.name = null; this.on = false; this.onChange = null; this.order = 'random'; this.silent = false; this.clk = null; this.kind = null; this.vjLocal = false; this._qKey = '';
  }
  // #439 the WALL page's CLIPS / PICTURES tiles: the playlist's videos only ('video') or pictures only ('image'); null = both
  pool() { return this.kind ? this.files.filter(f => (this.kind === 'image') === isImage(f)) : this.files; }
  setSilent(s) {
    if (this.silent === s) return;
    const f = this.on && this.name ? this.fileNamed(this.name) : null, t = this.state().t, img = this.img;
    const dur = this.video ? this.video.duration : this.clk && this.clk.dur, loop = this.video ? this.video.loop : !!(this.clk && this.clk.loop);
    const onEnded = this._ended || null;
    this.silent = s;
    if (!f) return;
    if (img) { if (!s) createImageBitmap(f, { imageOrientation: 'flipY' }).then(b => { if (this.name === f.name && this.img && !this.silent) this.curImage = b; }).catch(() => {}); else this.curImage = null; return; }
    this._open(f, loop ? null : onEnded, t, dur); if (loop) this._loop(true);
  }
  _loop(on) { if (this.video) this.video.loop = on; if (this.clk) { this.clk.loop = on; this._arm(); } }
  _arm() {   // silent clock: end the clip when its time is up (or wrap round when it loops)
    const c = this.clk; clearTimeout(this.clkT); if (!c || !c.dur || c.loop) return;
    const left = c.dur - (performance.now() - c.t0) / 1000;
    this.clkT = setTimeout(() => { if (this.clk === c && c.onEnded) c.onEnded(); }, Math.max(0, left) * 1000);
  }
  setFiles(list, max = 5) {   // #185: images too (shown IMG_SECONDS each in the playlist)
    this.files = [...list].filter(f => /^(video|image)\//.test(f.type) || /\.(mp4|m4v|webm|mov|mkv|jpe?g|png|webp|gif|avif)$/i.test(f.name)).slice(0, max);
    if (this.on && !this.files.length) this.stop();
    return this.files.length;
  }
  get hasFiles() { return this.files.length > 0; }
  fileNamed(n) { return this.files.find(f => f.name === n) || null; }
  add(file) { if (!this.files.some(f => f.name === file.name)) this.files.push(file); return this.files.length; }
  // #222 playlist editing (the VIDEO page's LED LIST): remove, move up / down, play in list order or at random
  remove(name) { const i = this.files.findIndex(f => f.name === name); if (i < 0) return; this.files.splice(i, 1); if (this.name === name) { if (this.files.length) this.next(); else this.stop(); } this.onChange && this.onChange(); }
  move(name, d) { const i = this.files.findIndex(f => f.name === name), j = i + d; if (i < 0 || j < 0 || j >= this.files.length) return; [this.files[i], this.files[j]] = [this.files[j], this.files[i]]; this.onChange && this.onChange(); }
  next() {
    if (this.order !== 'list') return this.playRandom();
    const F = this.pool(); if (!F.length) return false;
    const i = F.findIndex(f => f.name === this.name), f = F[(i + 1) % F.length];
    this.on = true; this._open(f, () => this.next()); this.onChange && this.onChange(); return true;
  }
  play(file, loop = false) { this.vjLocal = !!loop; this.on = true; this._open(file, loop ? null : () => this.next()); if (loop) this._loop(true); this.onChange && this.onChange(); }
  _open(file, onEnded, at = 0, dur = null) {
    this._close(); this._ended = onEnded;
    if (isImage(file)) {   // #185 still image
      const name = file.name; this.name = name; this.img = true;
      if (!this.silent) createImageBitmap(file, { imageOrientation: 'flipY' }).then(b => { if (this.name === name && this.img && !this.silent) this.curImage = b; }).catch(() => {});
      if (onEnded) this.imgT = setTimeout(() => { if (this.name === name) onEnded(); }, IMG_SECONDS * 1000);
      return;
    }
    if (this.silent) {   // #236 no decoding: a clock stands in for the video
      const c = this.clk = { t0: performance.now() - at * 1000, dur: dur || 0, loop: false, onEnded }; this.name = file.name;
      if (!c.dur) {   // the clip's length from its metadata only (no frames decoded)
        const p = document.createElement('video'); p.preload = 'metadata'; p.muted = true; p.src = URL.createObjectURL(file);
        p.onloadedmetadata = () => { if (this.clk === c) { c.dur = isFinite(p.duration) ? p.duration : 30; this._arm(); } URL.revokeObjectURL(p.src); p.removeAttribute('src'); p.load(); };
      } else this._arm();
      return;
    }
    const v = document.createElement('video');
    v.muted = true; v.autoplay = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.src = URL.createObjectURL(file); v._url = v.src;
    v.addEventListener('ended', () => onEnded && onEnded());
    v.addEventListener('loadeddata', () => { if (this.video === v && v.paused) v.play().catch(() => {}); }, { once: true });
    if (at > 0) v.addEventListener('loadedmetadata', () => { try { v.currentTime = at % (v.duration || Infinity); } catch {} }, { once: true });
    v.play().catch(() => {});
    this.video = v; this.name = file.name;
  }
  _close() {
    clearTimeout(this.imgT); this.img = false; this.curImage = null; clearTimeout(this.clkT); this.clk = null;
    const v = this.video; this.video = null; this.name = null;
    if (v) { v.pause(); URL.revokeObjectURL(v._url); v.removeAttribute('src'); v.load(); }   // frees the decoder
  }
  playRandom() {
    const F = this.pool(); if (!F.length) return false;
    const pool = F.length > 1 ? F.filter(f => f.name !== this.name) : F;
    const f = pool[Math.floor(Math.random() * pool.length)];
    this.on = true; this._open(f, () => this.next()); this.onChange && this.onChange();
    return true;
  }
  stop() { this.vjLocal = false; this.on = false; this._close(); this.onChange && this.onChange(); }
  // follower: match the host's clip and time (seek only when more than 0.3 s out, so playback stays smooth)
  follow(on, name, t) {
    const qk = (on ? 1 : 0) + '|' + (name || ''), chg = qk !== this._qKey; this._qKey = qk;
    if (!on || !name) { if (this.vjLocal) return; if (this.video || this.img) this._close(); this.on = false; return; }
    if (this.vjLocal && !chg) return;
    const f = this.fileNamed(name); if (!f) { if (this.vjLocal) return; if (this.video || this.img) this._close(); return; }
    this.vjLocal = false;
    if (this.name !== name) { this._open(f, null); if (this.video) this.video.loop = true; }
    this.on = true;
    const v = this.video; if (v && v.readyState >= 1 && Math.abs(v.currentTime - t) > 0.3) v.currentTime = t;
  }
  state() {
    let t = this.video ? this.video.currentTime : 0;
    if (this.clk) { t = (performance.now() - this.clk.t0) / 1000; if (this.clk.loop && this.clk.dur) t %= this.clk.dur; }
    return { on: this.on, name: this.name, t };
  }
}
