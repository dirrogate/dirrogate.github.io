// #439 the LED wall visuals' sums, off the main thread (wallfx.js): one picture per message, the buffer goes back and forth (#444 any size, and the matte)
import { renderMode } from './wallfx.js';
self.onmessage = e => {
  const { mode, W, H, t, bp, kick, rp, mp, mask, buf } = e.data, px = new Uint8ClampedArray(buf);
  renderMode(mode, px, W, H, t, bp, kick, rp, mp, mask ? new Uint8Array(mask) : null);
  self.postMessage({ buf }, [buf]);
};
