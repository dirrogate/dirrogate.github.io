// #347 PHONE CAM green screen (phone, fixed camera mode): the camera picture keyed here, at full quality, and sent to
// the Quest as ONE packed video frame, so the key survives the video codec. 1920 x 720: left 1280 x 720 = the colour
// (green spill pulled off skin / hair / clothes), right 624 x 720 = the matte (white = you, black = keyed out) at half
// width but full height, carried in the brightness the codec keeps sharpest; a 16 px black strip between them so the
// encoder doesn't smear one into the other. The Quest stretches the matte back over the colour (stream.js PCAM_FS).
// Same key as the AR virtual set (keycol.js: green, blue or magenta screen, K.col), driven by the same Strength /
// Softness / Spill (vs.K) the CAMERA tab and AUTO KEY set. Its own little WebGL2 canvas: no read-back, the 2D live
// canvas just draws it.
import { KEY_GLSL } from './keycol.js';

export const PACK = { W: 1920, H: 720, CW: 1280, MX: 1296, MW: 624 };

const VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D cam; uniform float thr, soft, spill; uniform vec3 L;   // L = colour width, matte x, matte width
out vec4 o;
${KEY_GLSL}
void main() {
  vec2 f = gl_FragCoord.xy; float H = ${PACK.H}.0;
  if (f.x < L.x) {
    vec3 c = despill(texture(cam, vec2(f.x / L.x, f.y / H)).rgb, spill);
    o = vec4(c, 1.0);
  } else if (f.x >= L.y) {
    vec3 c = texture(cam, vec2((f.x - L.y) / L.z, f.y / H)).rgb;
    o = vec4(vec3(1.0 - smoothstep(thr, thr + soft, keyOf(c))), 1.0);
  } else o = vec4(0.0, 0.0, 0.0, 1.0);
}`;

export function makePacker() {
  const canvas = document.createElement('canvas'); canvas.width = PACK.W; canvas.height = PACK.H;
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false, depth: false });
  if (!gl) return null;
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const U = n => gl.getUniformLocation(prog, n), uThr = U('thr'), uSoft = U('soft'), uSpill = U('spill'), uCol = U('keyCol');
  gl.uniform1i(U('cam'), 0); gl.uniform3f(U('L'), PACK.CW, PACK.MX, PACK.MW);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // video row 0 at the bottom = GL's y up, so the canvas comes out upright
  gl.viewport(0, 0, PACK.W, PACK.H);
  return {
    canvas,
    draw(video, K) {   // one camera frame -> packed colour + matte; false when there is no picture yet
      if (!video || !video.videoWidth || video.readyState < 2) return false;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.uniform1f(uThr, K.thr); gl.uniform1f(uSoft, K.soft); gl.uniform1f(uSpill, K.spill); gl.uniform1f(uCol, K.col || 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    },
  };
}
