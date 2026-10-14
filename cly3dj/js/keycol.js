// #347 key colour (owner): green screen, blue screen or magenta. One place for the key maths, shared by the AR virtual
// set (vset.js), the PHONE CAM packer (pcampack.js) and AUTO KEY (analyseKey). col: 0 green, 1 blue, 2 magenta.
// Key value = how much the screen colour stands above the other channel(s), divided by its own level (not below 0.15
// so dark noise can't key): a shaded wrinkle keys like the lit part of the screen; skin, grey, beige give <= 0.
// Magenta = red AND blue above green (the weaker of the two counts). Spill pulls the screen colour's tint off the DJ.
export const KEY_COLS = ['green', 'blue', 'magenta'];
export const KEY_LABEL = ['GREEN', 'BLUE', 'MAGENTA'];
export const KEY_GLSL = /* glsl */`
uniform float keyCol;
float keyOf(vec3 c) {
  if (keyCol < 0.5) return (c.g - max(c.r, c.b)) / max(c.g, 0.15);
  if (keyCol < 1.5) return (c.b - max(c.r, c.g)) / max(c.b, 0.15);
  float s = min(c.r, c.b); return (s - c.g) / max(s, 0.15);
}
vec3 despill(vec3 c, float k) {
  if (keyCol < 0.5) { float m = max(c.r, c.b); if (c.g > m) c.g = mix(c.g, m, k); }
  else if (keyCol < 1.5) { float m = max(c.r, c.g); if (c.b > m) c.b = mix(c.b, m, k); }
  else { float s = min(c.r, c.b); if (s > c.g) { float e = (s - c.g) * k; c.r -= e; c.b -= e; } }
  return c;
}`;
export function keyOf(r, g, b, col = 0) {   // same as the shader, values 0..1
  if (col === 1) return (b - Math.max(r, g)) / Math.max(b, 0.15);
  if (col === 2) { const s = Math.min(r, b); return (s - g) / Math.max(s, 0.15); }
  return (g - Math.max(r, b)) / Math.max(g, 0.15);
}
export const keyColOf = v => Math.min(2, Math.max(0, Math.round(+v || 0)));
