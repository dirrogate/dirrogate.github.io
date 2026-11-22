// Standalone grabbable eyewear accessories (VR GLASSES, AR GLASSES) — not baked to any avatar.
// Registered in xr.js ctx.props (same hit/grab/hold/release pipeline as GOPRO 2: controller Grip + hand-tracking Pinch).
//  * While worn on the face: mounted cleanly to the avatar's eye bridge on AV_LAYER (invisible to DJ's XR eyes, visible on DJ CAM / GoPro).
//    Rear temple tips (Temples_Rear) stay retracted/hidden so temples tuck flush into the beanie edge with zero clipping.
//    Grab zone is strictly on the FRONT of the glasses (+Z in front of eyes) so adjusting real headphones near the ears never grabs them.
//  * When grabbed off the face: switches to layer 0 (visible both to DJ's XR eyes and GoPro selfie cam) and smoothly extends Temples_Rear.
//  * Releasing within 13 cm of the face magnetically snaps them back onto the avatar; releasing elsewhere leaves them resting wherever placed.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/three/libs/meshopt_decoder.module.js';
import { AV_LAYER } from './director.js';

const KEY = 'vire.eyewear';
const Z_PIVOT = -0.055;   // local Z (m) where beanie-cut front temples meet extendable Temples_Rear
const SNAP_DIST = 0.13;   // release within 13 cm of the DJ's eyes -> magnetic snap back onto face

export const EYEWEAR_STYLES = {
  off: { label: 'OFF', url: null },
  vr:  { label: 'VR GLASSES', url: 'models/props/vr_glasses.glb' },
  ar:  { label: 'AR GLASSES', url: 'models/props/ar_glasses.glb' },
};
export const EYEWEAR_ORDER = ['off', 'vr', 'ar'];

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qFlipY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const _m = new THREE.Matrix4(), _s = new THREE.Vector3();

export class Eyewear {
  constructor(rig, opts = {}) {
    this.rig = rig;
    this.onToast = opts.onToast || null;
    this.obj = new THREE.Group();
    this.obj.name = 'eyewear_prop';
    this.obj.visible = false;
    this.obj.userData.noMirror = true;
    rig.add(this.obj);

    this.loader = new GLTFLoader();
    if (MeshoptDecoder) this.loader.setMeshoptDecoder(MeshoptDecoder);

    this.models = {};     // style -> { root, meshes, rearMeshes }
    this.loading = {};
    this.style = 'vr';
    this.worn = true;
    this.held = false;
    this.ext = 0;         // 0 = retracted (worn on beanie), 1 = full extended temples (off-face)
    this._layerMode = -1; // cached layer state to avoid per-frame traverse
    this._facePos = new THREE.Vector3();
    this._hasFace = false;
    this._lastScale = 1;

    this._loadState();
  }

  get on() { return this.style !== 'off' && !!this.models[this.style]; }

  _loadState() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
    const st = saved && EYEWEAR_STYLES[saved.style] ? saved.style : 'vr';
    this.setStyle(st, false);
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ style: this.style })); } catch {}
  }

  setStyle(style, save = true) {
    if (!EYEWEAR_STYLES[style]) style = 'off';
    this.style = style;
    this.worn = true;
    this.held = false;
    this.ext = 0;
    this._layerMode = -1;
    for (const [k, m] of Object.entries(this.models)) m.root.visible = (k === style);
    this.obj.visible = (style !== 'off' && !!this.models[style]);
    if (save) this.save();
    if (style !== 'off' && !this.models[style] && !this.loading[style]) {
      this._loadModel(style);
    } else if (this.models[style]) {
      this._applyLayers(true);
      this._applyTemples(0);
    }
  }

  cycle() {
    const next = EYEWEAR_ORDER[(EYEWEAR_ORDER.indexOf(this.style) + 1) % EYEWEAR_ORDER.length];
    this.setStyle(next, true);
    return next;
  }

  putBackOn() {
    if (this.style === 'off') return;
    this.worn = true;
    this.held = false;
    this._applyLayers(true);
  }

  async _loadModel(style) {
    const url = EYEWEAR_STYLES[style] && EYEWEAR_STYLES[style].url;
    if (!url) return;
    this.loading[style] = true;
    try {
      const gltf = await this.loader.loadAsync(url);
      const root = gltf.scene;
      root.name = 'eyewear_' + style;
      const meshes = [], rearMeshes = [];
      root.traverse(o => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        o.castShadow = o.receiveShadow = false;
        meshes.push(o);
        if (/temples_rear/i.test(o.name)) rearMeshes.push(o);
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mt of mats) {
          if (!mt) continue;
          const mn = (mt.name || '').toLowerCase();
          if (mn.includes('visor_glossy') && 'envMapIntensity' in mt) mt.envMapIntensity = 1.25;
          else if (mn.includes('frame_satin') && 'envMapIntensity' in mt) mt.envMapIntensity = 0.75;
        }
      });
      this.obj.add(root);
      this.models[style] = { root, meshes, rearMeshes };
      root.visible = (this.style === style);
      if (this.style === style) {
        this.obj.visible = true;
        this._layerMode = -1;
        this._applyLayers(this.worn);
        this._applyTemples(this.worn ? 0 : 1);
      }
    } catch (e) {
      console.warn('eyewear load failed:', style, e);
    } finally {
      this.loading[style] = false;
    }
  }

  _applyLayers(wornOnly) {
    const targetLayer = wornOnly ? AV_LAYER : 0;
    if (this._layerMode === targetLayer) return;
    this._layerMode = targetLayer;
    const rec = this.models[this.style];
    if (!rec) return;
    for (const m of rec.meshes) m.layers.set(targetLayer);
  }

  _applyTemples(t) {
    const rec = this.models[this.style];
    if (!rec) return;
    const show = t > 0.02;
    const sc = Math.max(0.01, t);
    const pz = Z_PIVOT * (1 - sc);
    for (const m of rec.rearMeshes) {
      m.visible = show;
      m.scale.set(1, 1, sc);
      m.position.set(0, 0, pz);
    }
  }

  // Per-frame sync: lock to avatar head when worn, and animate smooth temple extension/retraction.
  sync(avatar, pose, avatarVisible, dt = 1 / 60) {
    const rec = this.models[this.style];
    if (!rec) { this.obj.visible = false; return; }

    // Track current face eye midpoint & world orientation for snapping and worn placement
    let hasFace = false;
    let sc = this._lastScale;
    if (avatar && avatar.ready && avatar.B && avatar.B.Head && avatar.B.LeftEye && avatar.B.RightEye) {
      avatar.B.LeftEye.getWorldPosition(_v);
      avatar.B.RightEye.getWorldPosition(_v2);
      this._facePos.copy(_v).add(_v2).multiplyScalar(0.5);
      avatar.B.Head.getWorldQuaternion(_q);
      if (avatar.rq && avatar.rq.Head) _q.multiply(_q2.copy(avatar.rq.Head).invert());
      sc = avatar.root ? avatar.root.scale.x : 1;
      hasFace = true;
    } else if (pose && pose.head && pose.head.p && pose.head.q) {
      this._facePos.copy(pose.head.p);
      _q.copy(pose.head.q).multiply(_qFlipY);
      sc = (avatar && avatar.root) ? avatar.root.scale.x : 1;
      hasFace = true;
    }
    this._hasFace = hasFace;
    this._lastScale = sc;

    // Visibility: when worn, match avatar visibility; when off-face (held or resting on desk), always stay visible
    this.obj.visible = this.worn ? (!!avatarVisible && hasFace) : true;

    if (this.worn && hasFace) {
      this.rig.updateMatrixWorld();
      this.obj.position.copy(this.rig.worldToLocal(_v3.copy(this._facePos)));
      this.rig.getWorldQuaternion(_q2).invert();
      this.obj.quaternion.copy(_q2.multiply(_q));
      this.obj.scale.setScalar(sc);
      this._applyLayers(true);
    } else if (!this.worn) {
      this._applyLayers(false);
    }

    // Smoothly telescope rear temples out when off-face (0 -> 1 in ~0.14 s), retract when worn
    const targetExt = this.worn ? 0 : 1;
    if (Math.abs(this.ext - targetExt) > 1e-4) {
      const k = Math.min(1, dt * 16);
      this.ext += (targetExt - this.ext) * k;
      if (Math.abs(this.ext - targetExt) < 0.01) this.ext = targetExt;
      this._applyTemples(this.ext);
    }
  }

  // ---- ctx.props interface (xr.js direct Grip / Pinch grab, identical to GoPro) ----
  hit(P) {
    if (!this.on || !this.obj.visible) return false;
    this.obj.updateMatrixWorld();
    const l = this.obj.worldToLocal(_v.copy(P));
    if (this.worn) {
      // Strictly FRONT of the glasses (+Z in front of eyes/bridge) — never near the ears/headphones!
      return Math.abs(l.x) < 0.095 && l.y > -0.055 && l.y < 0.055 && l.z > -0.004 && l.z < 0.085;
    }
    // Off-face (resting on desk / floating): full bounding box so they are easy to pick back up
    return Math.abs(l.x) < 0.11 && Math.abs(l.y) < 0.065 && l.z > -0.175 && l.z < 0.065;
  }

  grab() {
    this.held = true;
    if (this.worn) {
      this.worn = false;
      this._applyLayers(false);
      // Kick off temple extension immediately so the user sees full glasses in hand right away
      this.ext = Math.max(this.ext, 0.25);
      this._applyTemples(this.ext);
    }
  }

  hold(world) {
    this.rig.updateMatrixWorld();
    _m.copy(this.rig.matrixWorld).invert().multiply(world);
    _m.decompose(this.obj.position, this.obj.quaternion, _s);
    this.obj.scale.setScalar(this._lastScale);
  }

  release() {
    this.held = false;
    if (this._hasFace) {
      this.obj.updateMatrixWorld();
      this.obj.getWorldPosition(_v);
      if (_v.distanceTo(this._facePos) < SNAP_DIST) {
        this.worn = true;
        this._applyLayers(true);
        if (this.onToast) this.onToast(`${EYEWEAR_STYLES[this.style].label} back on`, 1400);
      }
    }
  }
}
