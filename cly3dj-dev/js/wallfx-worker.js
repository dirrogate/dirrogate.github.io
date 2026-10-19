// #439 the LED wall visuals' sums, off the main thread (wallfx.js): one picture per message, the buffer goes back and forth
import { renderMandel, renderDancer } from './wallfx.js';
self.onmessage = e => {
  const { mode, W, H, t, bp, kick, buf } = e.data, px = new Uint8ClampedArray(buf);
  if (mode === 'mandel') renderMandel(px, W, H, t, bp, kick); else renderDancer(px, W, H, t, bp, kick);
  self.postMessage({ buf }, [buf]);
};
