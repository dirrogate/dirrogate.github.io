// #345 PORTAL (owner): a rectangular "real world window". Cut it into any prop or room (FacetWall today; any future
// glb room/cabin later, one call: Portal.cutInto(obj)) and the part of that mesh inside the rectangle stops drawing,
// so whatever is really there shows instead -- the Quest's passthrough camera in AR, or just empty space in VR. No
// depth/occlusion test against foreground objects: it is a flat, always-visible window, not a real 3D hole -- simple
// and cheap, good enough to park over a real floor mirror. Grab it (hands: pinch) to park it over the mirror, corner
// tab (or trigger/pinch on it) to resize like the tablet / chalkboard, double-tap PORTAL on the tablet to recentre.
// A thin bezel frame marks its edges in passthrough and on the Twitch picture (HEADSET CAM / SHOWTIME! both render
// the normal scene, so the cut shows up there too with no extra plumbing).
import * as THREE from 'three';

const KEY = 'vire.portal';
const HALF0 = new THREE.Vector2(0.3, 0.75);   // base local half-size (metres) before obj.scale -- ~ a floor mirror

// Shared GLSL injected into any material's own shader via onBeforeCompile. World position -> the portal's local
// space (its full inverse world matrix, so obj.scale resizes the window for free) -> discard inside the rectangle.
const DECL = `
#ifdef USE_PORTAL
  uniform mat4 portalInv; uniform vec2 portalHalf; uniform float portalOn;
  varying vec3 vPortalWP;
#endif`;
const VERT = `
#ifdef USE_PORTAL
  vPortalWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`;
const FRAG = `
#ifdef USE_PORTAL
  if (portalOn > 0.5) {
    vec3 lp = (portalInv * vec4(vPortalWP, 1.0)).xyz;
    vec2 d = abs(lp.xy) - portalHalf;
    if (max(d.x, d.y) < 0.0) discard;
  }
#endif`;

export class Portal {
  // home(): { p: Vector3, yaw } in rig space (the starting spot, e.g. in front of the real mirror)
  constructor(rig, home) {
    this.rig = rig; this.home = home; this.on = false; this.held = false;
    const g = this.obj = new THREE.Group(); g.name = 'portal'; g.visible = false; g.userData.noMirror = true; rig.add(g);
    this.frame = new THREE.Group(); g.add(this.frame);
    this._buildFrame();
    this._mats = new Set();
    this._u = { portalInv: { value: new THREE.Matrix4() }, portalHalf: { value: HALF0.clone() }, portalOn: { value: 0 } };
    this._load();
  }
  _buildFrame() {
    this.frame.clear();
    const w = HALF0.x * 2, h = HALF0.y * 2, t = 0.014, d = 0.01;
    const mat = new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.28, metalness: 0.75 });
    const bar = (bw, bh, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, d), mat); m.position.set(x, y, 0); this.frame.add(m); };
    bar(w + t, t, 0, h / 2 + t / 2); bar(w + t, t, 0, -h / 2 - t / 2);   // top / bottom
    bar(t, h, -w / 2 - t / 2, 0); bar(t, h, w / 2 + t / 2, 0);           // sides
    // silver corner L (top-right, inside the opening) = the resize tab corner() answers to, like the tablet's
    const tab = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.3, metalness: 0.9 }), L = 0.03, k = 0.006;
    for (const [bw, bh, x, y] of [[L, k, w / 2 - L / 2, h / 2 - k / 2], [k, L, w / 2 - k / 2, h / 2 - L / 2]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, d), tab); m.position.set(x, y, 0.004); this.frame.add(m);
    }
  }
  _load() {
    let s = null; try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
    if (s && s.p && s.q) { this.obj.position.fromArray(s.p); this.obj.quaternion.fromArray(s.q); this.obj.scale.setScalar(s.s || 1); } else this.reset(false);
    this.setOn(!!(s && s.on), false);
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify({ on: this.on, p: this.obj.position.toArray(), q: this.obj.quaternion.toArray(), s: this.obj.scale.x })); } catch {} }
  reset(save = true) {
    const h = this.home(); this.obj.scale.setScalar(1); this.obj.position.copy(h.p); this.obj.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.yaw);
    if (save) this.save();
  }
  setOn(on, save = true) { this.on = !!on; this.obj.visible = this.on; this._u.portalOn.value = this.on ? 1 : 0; if (save) this.save(); }
  // Cut this portal into every mesh under obj (FacetWall's group, or any loaded room/cabin glb). Idempotent per
  // material -- call it again any time a new glb finishes loading and it just adds its materials to the registry.
  cutInto(obj) {
    obj.traverse(o => {
      if (!o.isMesh || !o.material) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) this._patch(m);
    });
  }
  _patch(m) {
    if (this._mats.has(m)) return; this._mats.add(m);
    m.defines = m.defines || {}; m.defines.USE_PORTAL = '';
    const u = this._u, prev = m.onBeforeCompile;
    // three.js keys programs by onBeforeCompile.toString(), the same for every material patched here: fold in the
    // material's earlier hook / key so two patched materials with different hooks never share one program
    const oldKey = m.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey ? (prev ? prev.toString() : '') : m.customProgramCacheKey();
    m.customProgramCacheKey = () => oldKey + '|portal';
    m.onBeforeCompile = shader => {
      if (prev) prev(shader);
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT).replace('#include <common>', '#include <common>\n' + DECL);
      shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG).replace('#include <common>', '#include <common>\n' + DECL);
    };
    m.needsUpdate = true;
  }
  hit(P) {   // grab box: the frame + a little slack, front/back a few cm either side (it's a thin window)
    if (!this.on) return false;
    this.obj.updateMatrixWorld(); const l = this.obj.worldToLocal(_v.copy(P)), sc = this.obj.scale.x;
    return Math.abs(l.x) < (HALF0.x + 0.03) * sc && Math.abs(l.y) < (HALF0.y + 0.03) * sc && Math.abs(l.z) < 0.05 * sc;
  }
  grab() { this.held = true; }
  hold(world) { this.rig.updateMatrixWorld(); _m.copy(this.rig.matrixWorld).invert().multiply(world); _m.decompose(this.obj.position, this.obj.quaternion, _s); }
  release() { this.held = false; this.save(); }
  scaleTo(s) { this.obj.scale.setScalar(Math.min(4, Math.max(0.4, s))); }   // 0.4x .. 4x (a hand mirror up to a full wall window)
  corner(P) { if (!this.on) return false; this.obj.updateMatrixWorld(); const c = this.obj.localToWorld(_v.set(HALF0.x - 0.012, HALF0.y - 0.012, 0)); return c.distanceTo(P) < 0.035 * Math.max(1, this.obj.scale.x * 0.7); }
  // per frame: keep the clip uniforms in step with wherever the portal has been dragged/resized to
  tick() {
    if (!this.on) return;
    this.obj.updateMatrixWorld();
    this._u.portalInv.value.copy(this.obj.matrixWorld).invert();
  }
}
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
