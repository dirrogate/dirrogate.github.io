// #413 REAL DEPTH (owner, 19 Oct): occlusion that lines up close to the headset. #408c showed the Quest's depth map
// comes from its own camera (own projection and pose). three r169's built-in occluder copies the map straight onto
// each eye's screen as if it were seen from the eye, so near things (hands, controllers at 30-50 cm) land a few cm off:
// the owner saw his real hand / controller cut out ~5 cm above the drawn controller.
// Here the depth map is turned back into the real room: a 128 x 128 grid, each vertex lifted from the depth texel
// through the depth camera's own inverse projection and pose into the room (reference space), then drawn from each
// eye into the depth buffer only (colour writes off), first among the opaque objects. Each eye uses its own depth
// image (imageIndex). Triangles that stretch across a depth jump (hand edge -> wall) are thrown away in the fragment
// shader (fwidth of the distance), far / empty texels too. The real surface is pushed 3 cm + 2 % back along the depth
// camera's ray so things drawn right at it (3D hands / glove on the real hands, gear on a real table) still show.
// Only draws in the headset's own eyes; every other camera (DJ CAM, SHOWTIME!, HEADSET CAM...) gets nothing from it.
// laserData(): the same depth view (left eye) for the laser, so beams can stop at real things (people, hands).
import * as THREE from 'three';

const N = 128;
const VS = `uniform sampler2DArray uDepth; uniform float uLayer; uniform float uOn; uniform float uBias;
uniform mat4 uInvProj; uniform mat4 uPose; uniform mat4 uInvNorm;
varying float vZ; varying float vFar; varying float vEdge;
vec3 lift(vec2 buf) {   // depth texel -> point in the depth camera's space
  float d = min(textureLod(uDepth, vec3(buf, uLayer), 0.0).r, 0.9999);
  vec2 nv = (uInvNorm * vec4(buf, 0.0, 1.0)).xy;
  vec4 v = uInvProj * vec4(nv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w;
}
void main() {
  vZ = 0.0; vFar = 1.0; vEdge = 1.0;
  if (uOn < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 buf = position.xy;
  float d = textureLod(uDepth, vec3(buf, uLayer), 0.0).r;
  vec3 v = lift(buf); float r = length(v);
  float g = 1.0 / ${N}.0, jump = 0.0;   // a depth jump to a neighbour = the edge of something (hand -> wall): no sheet across it
  jump = max(jump, abs(length(lift(buf + vec2(g, 0.0))) - r)); jump = max(jump, abs(length(lift(buf - vec2(g, 0.0))) - r));
  jump = max(jump, abs(length(lift(buf + vec2(0.0, g))) - r)); jump = max(jump, abs(length(lift(buf - vec2(0.0, g))) - r));
  vEdge = jump > 0.08 * r + 0.04 ? 1.0 : 0.0;
  vFar = (d >= 0.9998 || r > 25.0) ? 1.0 : 0.0;
  v *= (r + uBias + 0.02 * r) / max(r, 1e-4);
  vZ = r;
  gl_Position = projectionMatrix * viewMatrix * (uPose * vec4(v, 1.0));
}`;
const FS = `varying float vZ; varying float vFar; varying float vEdge;
void main() {
  if (vFar > 0.01 || vEdge > 0.01) discard;     // empty texels, triangles touching a depth edge
  if (fwidth(vZ) > 0.12 * vZ + 0.01) discard;   // and anything still stretched on screen
  gl_FragColor = vec4(0.0);
}`;

export class RealDepth {
  constructor(scene) {
    const pos = new Float32Array(N * N * 3), idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = (j * N + i) * 3; pos[k] = (i + 0.5) / N; pos[k + 1] = (j + 0.5) / N; }
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i, b = a + 1, c = a + N, d = c + 1; idx.push(a, b, d, a, d, c); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide, colorWrite: false, depthWrite: true, depthTest: true,
      uniforms: { uDepth: { value: null }, uLayer: { value: 0 }, uOn: { value: 0 }, uBias: { value: 0.03 }, uInvProj: { value: new THREE.Matrix4() }, uPose: { value: new THREE.Matrix4() }, uInvNorm: { value: new THREE.Matrix4() } } });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = -1000; this.mesh.userData.noMirror = true; this.mesh.raycast = () => {};
    this.on = true; this.ok = false; this.tex = null;
    this.eye = [0, 1].map(() => ({ ok: false, layer: 0, proj: new THREE.Matrix4(), invProj: new THREE.Matrix4(), pose: new THREE.Matrix4(), invPose: new THREE.Matrix4(), norm: new THREE.Matrix4(), invNorm: new THREE.Matrix4() }));
    this.mesh.onBeforeRender = (r, s, cam) => {
      const u = this.mat.uniforms, xc = r.xr.enabled && r.xr.isPresenting ? r.xr.getCamera() : null;
      const i = xc && xc.cameras ? xc.cameras.indexOf(cam) : -1, e = i >= 0 ? this.eye[i] : null;
      const go = !!(this.on && this.ok && e && e.ok && this.tex);
      u.uOn.value = go ? 1 : 0;
      if (go) { u.uDepth.value = this.tex; u.uLayer.value = e.layer; u.uInvProj.value.copy(e.invProj); u.uPose.value.copy(e.pose); u.uInvNorm.value.copy(e.invNorm); }
    };
    scene.add(this.mesh);
  }
  // per XR frame: views = the viewer pose's views, binding = an XRWebGLBinding, tex = renderer.xr.getDepthTexture()
  update(views, binding, tex) {
    this.tex = tex; this.ok = false;
    if (!views || !binding || !tex) return false;
    for (let i = 0; i < 2; i++) {
      const e = this.eye[i], v = views[i]; e.ok = false; if (!v) continue;
      let info = null; try { info = binding.getDepthInformation(v); } catch { info = null; }
      if (!info || info.isValid === false) continue;
      e.layer = info.imageIndex != null ? info.imageIndex : i;
      e.proj.fromArray(info.projectionMatrix || v.projectionMatrix); e.invProj.copy(e.proj).invert();
      e.pose.fromArray((info.transform || v.transform).matrix); e.invPose.copy(e.pose).invert();
      if (info.normDepthBufferFromNormView) { e.norm.fromArray(info.normDepthBufferFromNormView.matrix); e.invNorm.copy(e.norm).invert(); } else { e.norm.identity(); e.invNorm.identity(); }
      e.ok = true;
    }
    this.ok = this.eye[0].ok || this.eye[1].ok;
    return this.ok;
  }
  clear() { this.ok = false; this.tex = null; for (const e of this.eye) e.ok = false; }
  laserData() {   // the left depth view (or the right if only that one is valid)
    const e = this.eye[0].ok ? this.eye[0] : this.eye[1].ok ? this.eye[1] : null;
    return this.ok && e ? { tex: this.tex, layer: e.layer, view: e.invPose, proj: e.proj, invProj: e.invProj, norm: e.norm } : null;
  }
}
