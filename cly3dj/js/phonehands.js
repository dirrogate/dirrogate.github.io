// #288 (owner): the spectator phone shows the DJ's hands the way the Quest does, instead of the depth-only cut-outs
// (they looked ugly): 3D skin hands, the robot glove or the Touch Plus controllers, whichever the DJ picked (DJ TOOLS >
// CONTROLLERS). Controllers: the same posed hand as the Quest (ctlhands.js) from the grip pose and the trigger / grip /
// thumb state the Quest sends. Tracked hands: the generic hand's bones set straight from the 25 joint positions
// (each bone's -Z along its segment, +Y out of the back of the hand); the glove follows them through robot2.js's solver.
// Later: realistic human hand textures.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';
import { createControllerHand, driveGloveHand, gloveCap, gloveHide, chromePads, POSE } from './ctlhands.js';

const SPEC = ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  ...['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'].flatMap(f => [`${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`])];
const NEXT = {}; for (let i = 0; i < SPEC.length; i++) { const n = SPEC[i]; if (n === 'wrist') NEXT[n] = 'middle-finger-metacarpal'; else if (!n.endsWith('-tip')) NEXT[n] = SPEC[i + 1]; }
const PROF = new URL('../vendor/webxr-input-profiles', import.meta.url).href;
const SKIN = new THREE.MeshStandardMaterial({ color: 0xbe8969, roughness: 0.55, metalness: 0 });   // as xr.js (#269)

export function makePhoneHands(rig) {
  const sides = [0, 1].map(() => ({ ctl: null, trk: null, model: null, seen: 0, kind: '', hd: '' }));
  let look = '3dhands', glove = null, gloveLoading = false, loader = new GLTFLoader();
  const models = {};   // handedness -> controller model scene (loaded once)
  function gloveGet() {
    if (glove) return glove.ready ? glove : null;
    if (!gloveLoading) {
      gloveLoading = true;
      import('./robot2.js').then(R => {
        const holder = new THREE.Group(); rig.add(holder);
        const a = new R.RobotAvatar2(holder);
        return a.load(R.ROBOT_GLB).then(() => {
          const keep = new Set(); for (const H of a.hands) { H.node.traverse(o => keep.add(o)); H.node.scale.multiplyScalar(1.1); }   // #287 sizes, #301 1.1
          a.root.traverse(o => { if (o.isMesh) { if (keep.has(o)) { o.layers.set(0); o.frustumCulled = false; o.material = o.material.clone(); o.material.side = THREE.DoubleSide; chromePads(o.material); } else o.visible = false; } });   // #302
          for (const H of a.hands) { const ng = gloveCap(H); if (ng) H.mesh.geometry = ng; }   // #303 smooth + capped; #312 each glove its own (since the Blender export the two meshes differ: sharing the left's stretched the right's fingers)
          if (a.headBone) a.headBone.visible = false;
          for (const H of a.hands) { H.vis = 0; if (H.mesh) H.mesh.visible = false; }
          glove = a;
        });
      }).catch(e => console.warn('phone glove', e));
    }
    return null;
  }
  function ctlModel(S, hd) {
    if (!S.model || S.model.userData.hd !== hd) {
      if (S.model) rig.remove(S.model);
      S.model = new THREE.Group(); S.model.userData.hd = hd; S.model.matrixAutoUpdate = false; rig.add(S.model);
      const g = S.model;
      (models[hd] || (models[hd] = loader.loadAsync(`${PROF}/meta-quest-touch-plus/${hd}.glb`))).then(m => { if (S.model === g) g.add(m.scene.clone(true)); }).catch(() => {});
    }
    return S.model;
  }
  function hand(S, hd, key) {   // a posed generic hand per side (controller pose or tracked)
    if (!S[key] || S[key].handed !== hd) {
      if (S[key]) rig.remove(S[key].root);
      S[key] = createControllerHand(hd, `${PROF}/generic-hand/${hd}.glb`, SKIN); S[key].handed = hd;
      S[key].root.matrixAutoUpdate = false; rig.add(S[key].root);
    }
    return S[key];
  }
  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _m = new THREE.Matrix4();
  const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _pq = new THREE.Quaternion();
  function setTracked(h, a, hd) {   // bones straight from the joints (rig-local), the holder at identity
    if (!h.ready) return false;
    h.root.matrix.identity(); h.root.matrixWorldNeedsUpdate = true; h.holder.position.set(0, 0, 0); h.holder.quaternion.identity();
    h.cur = '';   // the controller pose cache no longer matches
    const P = {}; SPEC.forEach((n, j) => { P[n] = new THREE.Vector3(a[j * 3], a[j * 3 + 1], a[j * 3 + 2]); });
    const F = P['middle-finger-phalanx-proximal'].clone().sub(P.wrist), A = P['pinky-finger-phalanx-proximal'].clone().sub(P['index-finger-phalanx-proximal']);
    const N = hd === 'left' ? new THREE.Vector3().crossVectors(F, A) : new THREE.Vector3().crossVectors(A, F); N.normalize();
    h.root.updateMatrixWorld(true);
    for (const n of SPEC) {
      const b = h.bones[n]; if (!b) continue;
      const nx = NEXT[n], prev = SPEC[SPEC.indexOf(n) - 1];
      if (nx) _z.subVectors(P[n], P[nx]); else _z.subVectors(P[prev], P[n]);
      _z.normalize(); _y.copy(N).addScaledVector(_z, -N.dot(_z)).normalize(); _x.crossVectors(_y, _z);
      _m.makeBasis(_x, _y, _z); _q.setFromRotationMatrix(_m);
      b.parent.updateWorldMatrix(true, false);
      b.position.copy(P[n]).applyMatrix4(rig.matrixWorld).applyMatrix4(_m.copy(b.parent.matrixWorld).invert());
      b.parent.getWorldQuaternion(_pq); b.quaternion.copy(_pq.invert().multiply(rig.getWorldQuaternion(new THREE.Quaternion())).multiply(_q));
    }
    return true;
  }
  function driveGlove(S, h, hd, dt, curl) {
    const g = gloveGet(); if (!g) return;
    const H = g.hands[hd === 'left' ? 0 : 1];
    h.root.updateMatrixWorld(true);
    const J = new Map(); for (const n in h.bones) J.set(n, h.bones[n].getWorldPosition(new THREE.Vector3()));
    if (J.size < 25) return;
    driveGloveHand(g, H, J, dt); S.gloveH = H;   // #300
  }
  // list = the Quest's hands entries: [i, 'c', [x y z qx qy qz qw  trigger grip thumb], hd] or [i, 'h', joints[75], hd]
  function update(list, lk, dt) {
    if (lk) look = lk;
    const now = performance.now();
    for (const [i, kind, a, hdc] of list || []) {
      const S = sides[i]; if (!S) continue;
      const hd = hdc === 'l' ? 'left' : hdc === 'r' ? 'right' : (i === 0 ? 'left' : 'right');
      S.seen = now; S.kind = kind; S.hd = hd;
      if (kind === 'c') {
        _p.set(a[0], a[1], a[2]); _q.set(a[3], a[4], a[5], a[6]); _m.compose(_p, _q, _s);
        if (look === 'controller') { const m = ctlModel(S, hd); m.matrix.copy(_m); m.matrixWorldNeedsUpdate = true; m.visible = true; if (S.ctl) S.ctl.root.visible = false; }
        else {
          if (S.model) S.model.visible = false;
          const h = hand(S, hd, 'ctl'); h.root.visible = true; h.root.matrix.copy(_m); h.root.matrixWorldNeedsUpdate = true;
          const t = a[7] || 0, g = a[8] || 0; if (h.soft !== (look === 'glove')) { h.soft = look === 'glove'; h.cur = ''; } h.update(t, g, !!a[9]);   // #301
          h.holder.visible = look !== 'glove';
          if (look === 'glove') driveGlove(S, h, hd, dt, Math.max(t, g));
        }
        if (S.trk) S.trk.root.visible = false;
      } else if (kind === 'h' && a.length >= 75) {
        if (S.model) S.model.visible = false; if (S.ctl) S.ctl.root.visible = false;
        const h = hand(S, hd, 'trk'); h.root.visible = true;
        if (setTracked(h, a, hd)) { h.holder.visible = look !== 'glove'; if (look === 'glove') driveGlove(S, h, hd, dt, 0); }
      }
      if (look !== 'glove' && S.gloveH && glove) { gloveHide(glove, S.gloveH); S.gloveH = null; }
    }
  }
  function frame(now, hidden) {   // gone 400 ms without data, or the robot is on: hide
    for (const S of sides) {
      const off = hidden || now - S.seen > 400;
      if (!off) continue;
      if (S.ctl) S.ctl.root.visible = false; if (S.trk) S.trk.root.visible = false; if (S.model) S.model.visible = false;
      if (S.gloveH && glove) { gloveHide(glove, S.gloveH); S.gloveH = null; }
    }
  }
  let fitKey = '';
  function fit(a) {   // #291 the DJ's HAND FIT values: same offsets here, hands re-placed when they change
    const k = JSON.stringify(a); if (k === fitKey) return; fitKey = k; Object.assign(POSE.adj, a);
    for (const S of sides) for (const h of [S.ctl, S.trk]) if (h) { h.place(); h.cur = ''; }
  }
  return { update, frame, fit, get look() { return look; } };
}
