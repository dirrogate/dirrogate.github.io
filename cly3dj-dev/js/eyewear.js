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

    // Live phosphor-green VR visor micro-HUD (256x64 CanvasTexture, 1 draw call, runs both worn & off-face!)
    this.hudCanvas = document.createElement('canvas');
    this.hudCanvas.width = 256;
    this.hudCanvas.height = 64;
    this.hudCtx = this.hudCanvas.getContext('2d');
    this.hudTex = new THREE.CanvasTexture(this.hudCanvas);
    this.hudTex.colorSpace = THREE.SRGBColorSpace;
    this.hudTex.flipY = false;   // glTF V=0 is top of image -> match canvas y=0 at top!
    this.hudTex.minFilter = THREE.LinearFilter;
    this.hudTex.magFilter = THREE.LinearFilter;
    this.hudTex.generateMipmaps = false;
    this.hudMat = new THREE.MeshBasicMaterial({
      map: this.hudTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.46,   // subtly faint phosphor glow read through the dark smoked glass layer
    });
    this._hudScroll = 0;
    this._hudAcc = 1;   // force initial paint on first tick
    this._hudT = 0;
    this._hudLastLabel = '';

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
        if (/visor_hud/i.test(o.name) || (o.material && /visor_hud/i.test(o.material.name || ''))) {
          o.material = this.hudMat;
          o.renderOrder = 2;
          return;
        }
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

  _drawHud(dt, info) {
    this._hudT += dt;
    this._hudAcc += dt;
    if (this._hudAcc < 0.08) return;   // ~12.5 fps: smooth marquee & countdown, negligible CPU/GPU cost
    const stepDt = this._hudAcc;
    this._hudAcc = 0;

    const g = this.hudCtx, W = 256, H = 64;
    g.clearRect(0, 0, W, H);

    const label = (info && info.label) ? info.label.toUpperCase() : 'DIRRODJ  ·  STANDBY';
    if (label !== this._hudLastLabel) {
      this._hudLastLabel = label;
      this._hudScroll = 0;
    }

    g.save();
    g.fillStyle = 'rgba(72, 245, 122, 0.88)';
    g.shadowColor = 'rgba(32, 235, 92, 0.75)';
    g.shadowBlur = 4;
    g.textBaseline = 'middle';

    // Line 1: always-scrolling phosphor-green song title & artist/band name marquee
    g.font = '700 20px "Courier New", Consolas, monospace';
    const gap = '   •   ';
    const full = label + gap;
    const fw = Math.max(40, g.measureText(full).width);
    this._hudScroll = (this._hudScroll + stepDt * 30) % fw;
    g.textAlign = 'left';
    for (let x = -this._hudScroll; x < W + fw; x += fw) {
      g.fillText(full, x, 21);
    }

    // Subtle phosphor divider rule
    g.shadowBlur = 1;
    g.fillStyle = 'rgba(68, 240, 118, 0.22)';
    g.fillRect(6, 35, W - 12, 1);

    // Line 2: live BPM + remaining minutes:seconds countdown
    g.fillStyle = 'rgba(60, 232, 110, 0.78)';
    g.shadowBlur = 3;
    g.font = '700 18px "Courier New", Consolas, monospace';
    const bpmStr = (info && info.bpm > 0) ? `${info.bpm.toFixed(1)} BPM` : '--.- BPM';
    let remStr = '--:--';
    if (info && info.rem != null && info.rem >= 0) {
      const total = Math.ceil(info.rem);
      const mins = Math.floor(total / 60);
      const secs = total % 60;
      remStr = `-${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    const dot = (info && info.playing && Math.floor(this._hudT * 2) % 2 === 0) ? '● ' : '  ';
    g.textAlign = 'left';
    g.fillText(bpmStr, 6, 51);
    g.textAlign = 'right';
    g.fillText(dot + remStr, W - 6, 51);
    g.restore();

    this.hudTex.needsUpdate = true;
  }

  // Per-frame sync: lock to avatar head when worn, animate temples, and keep VR phosphor HUD live (worn OR placed anywhere!).
  sync(avatar, pose, avatarVisible, dt = 1 / 60, hudInfo = null) {
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
      const gf = avatar.glassesFit;   // #816 per-avatar fit (REAL 3: 16 mm forward, 2 mm up, 112 %)
      if (gf) { _v3.set(0, gf.up || 0, gf.fwd || 0).multiplyScalar(sc).applyQuaternion(_q); this._facePos.add(_v3); sc *= (gf.scale || 1); }
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

    // Keep VR phosphor HUD scrolling & counting down whenever VR glasses are visible (worn OR resting anywhere on set!)
    if (this.style === 'vr' && this.obj.visible) {
      this._drawHud(dt, hudInfo);
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
