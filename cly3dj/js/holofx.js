// #745 HOLO look shared by HEADSET CAM hands (stream.js, the real hands seen through the headset camera) and the desk's
// PERSON KEY (vjdesk.js, you cut out of the webcam by MediaPipe): the HOLO portal frame's language (cyan glow on the edge,
// scanlines, flicker, glitch bands that shear the picture sideways). GLSL only: holoShear() moves the camera lookup,
// holoLook() colours the result. m = how much this pixel is the person / hand (0..1, soft); e = the edge (0..1).
export const HOLO_GLSL = `
float hoH(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
float holoShear(vec2 uv, float t, float rows) {   // sideways offset for this row band: a few bands jump now and then
  float band = floor(uv.y * rows), k = floor(t * 9.0);
  float on = step(0.86, hoH(band * 1.73 + k * 7.1)) * step(0.4, hoH(k * 3.3));
  return (hoH(band + k * 13.7) - 0.5) * 0.045 * on;
}
vec3 holoLook(vec3 c, float m, float e, vec2 uv, float t, float lines, vec3 col) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 h = mix(c, vec3(l) * col * 1.25 + col * 0.06, 0.55);                        // tinted toward the holo colour, detail kept
  float scan = 0.78 + 0.22 * sin(uv.y * lines * 3.14159 - t * 18.0);              // moving scanlines
  float fl = 0.93 + 0.07 * hoH(floor(t * 24.0));                                   // flicker
  h *= scan * fl;
  h += col * (e * 1.1 + 0.08 * m);                                                 // the glowing edge
  return mix(c, h, m);
}`;
export const HOLO_COL = [0.35, 0.92, 1.0];   // the HOLO portal's cyan
