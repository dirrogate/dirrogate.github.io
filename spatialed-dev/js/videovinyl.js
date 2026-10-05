// VideoVinyl (CLAUDE.md #177): an MP3 record plus a video file named exactly like the track's Rekordbox title
// (including the _a / _b suffix), e.g. "Ray of Light_a.mp4". The MP3 plays as before (audio, grooves, BPM,
// label); the video follows the record's playhead. On the LED wall's DECKS mode both decks' videos are added
// together by the channel faders and crossfader, like the audio.
// Browsers can't play video backwards or change speed as fast as a scratch, so while the record is stopped,
// scratched or reversed the video jumps to the matching frame ~12 times a second (encode with a keyframe every
// few frames so those jumps are quick).
import * as THREE from 'three';

export const VIDEO_EXT = /\.(mp4|m4v|webm|mov)$/i;
export const vvKey = s => (s || '').trim().toLowerCase();
export const baseName = p => p.split('/').pop().replace(/\.[^.]+$/, '');

export class DeckVideo {
  constructor() { this.v = null; this.key = null; this.tex = null; this.url = null; this.lastSeek = 0; this.prevRate = 0; }
  open(key, src) {   // src: URL string, or a File/Blob
    this.close();
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    if (typeof src === 'string') v.src = src; else { this.url = URL.createObjectURL(src); v.src = this.url; }
    this.v = v; this.key = key;
    this.tex = new THREE.VideoTexture(v); this.tex.colorSpace = THREE.SRGBColorSpace;
  }
  close() {
    const v = this.v; this.v = null; this.key = null;
    if (this.tex) { this.tex.dispose(); this.tex = null; }
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
  }
  // pos: the record's playhead (s); rate: its speed (1 = normal, negative = backwards)
  follow(pos, rate, now = performance.now()) {
    const v = this.v; if (!v || v.readyState < 1) return;
    const dur = v.duration || 0; if (dur && pos >= dur - 0.05) { if (!v.paused) v.pause(); return; }   // video shorter than the track
    pos = Math.max(0, pos);
    const steady = rate > 0.25 && rate < 4 && Math.abs(rate - this.prevRate) < 0.08;
    this.prevRate = rate;
    if (steady) {
      if (Math.abs(v.playbackRate - rate) > 0.004) v.playbackRate = rate;
      if (v.paused) v.play().catch(() => {});
      if (!v.seeking && Math.abs(v.currentTime - pos) > 0.15) v.currentTime = pos;   // drifted: jump back in step
    } else {
      if (!v.paused) v.pause();
      if (!v.seeking && now - this.lastSeek > 80 && Math.abs(v.currentTime - pos) > 0.02) { v.currentTime = pos; this.lastSeek = now; }
    }
  }
}

// constant-power crossfader and squared channel faders, exactly as audio.js
export function deckGains(mix) {
  const a = (mix.xfader + 1) / 2 * Math.PI / 2;
  const xa = Math.min(1, Math.cos(a) * Math.SQRT2), xb = Math.min(1, Math.sin(a) * Math.SQRT2);
  return [mix['A.fader'] ** 2 * xa, mix['B.fader'] ** 2 * xb];
}
