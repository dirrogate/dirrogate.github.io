// #183 Camera access test (phone). Checks that Chrome's WebXR 'camera-access' gives the page the camera picture
// while AR tracking runs (three.js #33404 crashed on Chrome 147-148; fixed in 149.0.7821+). Plain WebXR + WebGL2,
// no three.js, so it only tests the phone and Chrome. Left half: camera as delivered. Right half: anything green is
// painted magenta (a first green-screen key), so pointing at something green shows the key working.
const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `#version 300 es
precision mediump float;
uniform sampler2D cam; in vec2 uv; out vec4 o;
void main() {
  vec3 c = texture(cam, uv).rgb;
  float g = c.g - max(c.r, c.b);                 // how much greener than red/blue
  if (uv.x > 0.5 && g > 0.10) c = vec3(1.0, 0.0, 1.0);
  if (abs(uv.x - 0.5) < 0.002) c = vec3(1.0);    // divider
  o = vec4(c, 1.0);
}`;

export async function camTest() {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;font:600 15px system-ui,sans-serif;color:#fff';
  ov.innerHTML = `<div id="ctTxt" style="position:absolute;left:10px;right:10px;top:10px;background:rgba(0,0,0,.7);padding:10px;border-radius:10px;white-space:pre-line">Starting…</div>
    <button id="ctExit" style="position:absolute;right:10px;bottom:20px;font:600 16px system-ui;padding:12px 18px;border-radius:10px;border:1px solid #2e3850;background:#1c2230;color:#fff">Exit test</button>`;
  document.body.append(ov);
  ov.addEventListener('beforexrselect', e => e.preventDefault());
  const txt = ov.querySelector('#ctTxt'), say = s => { txt.textContent = s; };
  const done = () => ov.remove();
  if (!navigator.xr) { say('No WebXR in this browser.'); setTimeout(done, 4000); return; }

  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['camera-access'], optionalFeatures: ['dom-overlay'], domOverlay: { root: ov } });
  } catch (e) {
    say('Camera access refused or not supported:\n' + e.message);
    ov.querySelector('#ctExit').onclick = done; return;
  }
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { xrCompatible: true, alpha: false });
  await gl.makeXRCompatible();
  const layer = new XRWebGLLayer(session, gl);
  session.updateRenderState({ baseLayer: layer });
  const ref = await session.requestReferenceSpace('local').catch(() => session.requestReferenceSpace('viewer'));
  const binding = new XRWebGLBinding(session, gl);

  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'), uCam = gl.getUniformLocation(prog, 'cam');

  let frames = 0, withImg = 0, tracked = 0, size = '?', err = '', last = performance.now(), fps = 0, n = 0;
  const t0 = performance.now();
  ov.querySelector('#ctExit').onclick = () => session.end();
  session.addEventListener('end', done);

  session.requestAnimationFrame(function loop(t, frame) {
    session.requestAnimationFrame(loop);
    frames++; n++;
    const pose = frame.getViewerPose(ref);
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0.1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    if (pose) {
      if (!pose.emulatedPosition) tracked++;
      for (const view of pose.views) {
        const vp = layer.getViewport(view); gl.viewport(vp.x, vp.y, vp.width, vp.height);
        if (!view.camera) continue;
        size = view.camera.width + ' x ' + view.camera.height;
        let tex = null;
        try { tex = binding.getCameraImage(view.camera); } catch (e) { err = e.message; }
        if (!tex) continue;
        withImg++;
        gl.useProgram(prog); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(uCam, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    const now = performance.now();
    if (now - last > 500) {
      fps = n * 1000 / (now - last); n = 0; last = now;
      say(`Camera picture: ${withImg ? 'YES' : 'no'}  (${withImg} of ${frames} frames)\nCamera size: ${size}\nTracking: ${tracked ? 'yes' : 'no'}   ${fps.toFixed(0)} fps   ${((now - t0) / 1000).toFixed(0)} s` +
        (err ? '\nError: ' + err : '') + '\nLeft: camera. Right: green shows as magenta.\nIs the picture upright and not mirrored?');
    }
  });
}
