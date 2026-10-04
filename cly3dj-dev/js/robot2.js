// Robot DJ avatar, licensed (CLAUDE.md #245): the AvatarRobot model by EntroPi Games (Vinyl Reality), given to the
// owner with permission to use. models/avatar/avatar_robot.glb, exported from Unity: one skinned helmet + bust (bones
// Head, Neck), a "Screen" visor, and one right-hand glove used for both hands (the left one mirrored), each with a
// 20-bone finger rig. Our additions: the scanner light on the visor (MIC level, as #221) and the owner's Gemini crest
// embossed on both ear cups. Same interface as Avatar / RobotAvatar: ready, status, root, update(pose).
//
// Driving it: pose.head = the eyes (world), pose.hands[i].joints = WebXR joint positions (or a synthetic hand from a
// controller / the desktop demo, synthJoints). The model never moves; only its bones do, each set from a world
// target. Hands are solved in each hand node's own space (which holds the left hand's mirror), so every bone gets a
// proper rotation: each finger bone is turned so its rest direction points along the tracked segment, with the twist
// taken from the hand's plane (back of the hand).
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';
import { AV_LAYER } from './director.js';
import { synthJoints } from './robot.js';
import { chromePads } from './ctlhands.js';   // #305

const V = () => new THREE.Vector3();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// visor LEDs (owner, #245): black glass with a grid of red LED cells behind it. Quiet: a scanner sweeping left to right
// and back with a fading trail. Talking: pixelated voice bars in the middle, a tall centre bar and shorter ones beside
// it, growing up and down from the centre line with the MIC level (the mouth never moves).
const COLS = 31, ROWS = 11;
const VIS = { a: 1.44, z0: 0.02, y0: -0.0153, h: 0.0629 };   // visor in the mesh's raw space: angle range round the head, height
const EYE = new THREE.Vector3(0, 1.615, 0.04);   // the eyes in the model (behind the visor; model faces +Z)
const FACE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);   // model +Z front -> real -Z front
const TIP_LIFT = 0.012;   // #248 robot finger pad over the real one
const _m3 = new THREE.Matrix3();
const CUP = { x: 0.1312, y: -0.0355, z: -0.0564, r: 0.0146 };   // the ear cup's flat centre disc (Head bone space): the crest sits on it
// model finger bones and the WebXR segment each one follows (from joint, to joint)
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'].map(F => {
  const w = F.toLowerCase();
  return [[`${F}_Proximal`, `${w}-finger-phalanx-proximal`, `${w}-finger-phalanx-intermediate`],
          [`${F}_Middle`, `${w}-finger-phalanx-intermediate`, `${w}-finger-phalanx-distal`],
          [`${F}_Distal`, `${w}-finger-phalanx-distal`, `${w}-finger-tip`]];
});
FINGERS.push([['Thumb_MetaCarpal', 'thumb-metacarpal', 'thumb-phalanx-proximal'], ['Thumb_Proximal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal'], ['Thumb_Distal', 'thumb-phalanx-distal', 'thumb-tip']]);
const METAS = ['Index', 'Middle', 'Ring', 'Pinky'];

// a rotation basis from a direction and an "up" hint (up made square to dir)
function basis(dir, up, out = new THREE.Matrix4()) {
  const z = dir.clone().normalize(), y = up.clone().addScaledVector(z, -up.dot(z)).normalize(), x = V().crossVectors(y, z);
  return out.makeBasis(x, y, z);
}
// hand frame from three points: F wrist -> middle knuckle, N back (or palm) normal, same formula for rest and live
function handFrame(w, idx, mid, pinky) {
  const F = mid.clone().sub(w).normalize(), S = pinky.clone().sub(idx); S.addScaledVector(F, -S.dot(F)).normalize();
  return { F, N: V().crossVectors(F, S).normalize() };
}

// #251 (owner: the jaw 'glitches' an inch when the head moves, worst on AVACAM): the helmet's lower edge was skinned
// half to Head, half to Neck, and the neck follows the head slowly (smoothed bust), so every head move stretched
// the chin between the two. Each loose piece (shell, inner part, ear cups, bust) now follows just one bone, the one
// most of its vertices lean on: the helmet moves rigidly with the head and the bust turns underneath it.
function rigidPieces(geo) {
  const pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, idx = geo.index;
  if (!si || !sw) return;
  const n = pos.count, par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i;
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  const seen = new Map();
  for (let i = 0; i < n; i++) { const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`; if (seen.has(k)) join(i, seen.get(k)); else seen.set(k, i); }
  if (idx) for (let t = 0; t < idx.count; t += 3) { join(idx.getX(t), idx.getX(t + 1)); join(idx.getX(t), idx.getX(t + 2)); }
  const votes = new Map();   // piece -> { bone: summed weight }
  for (let i = 0; i < n; i++) {
    const c = find(i); let v = votes.get(c); if (!v) votes.set(c, v = {});
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > 0) { const b = si.getComponent(i, k); v[b] = (v[b] || 0) + w; } }
  }
  const pick = new Map(); for (const [c, v] of votes) { let best = 0, bw = -1; for (const b in v) if (v[b] > bw) { bw = v[b]; best = +b; } pick.set(c, best); }
  for (let i = 0; i < n; i++) { si.setXYZW(i, pick.get(find(i)), 0, 0, 0); sw.setXYZW(i, 1, 0, 0, 0); }
  si.needsUpdate = sw.needsUpdate = true;
}

// #245 (owner): no headband. The helmet mesh is six loose pieces (shell, inner part, two ear cups, bust, headband);
// the headband is the piece that runs across the top between the cups: wide (> 20 cm), shallow front to back
// (< 5 cm) and above the visor. Its triangles are left out of the index at load, the file stays as it came.
function dropHeadband(geo) {
  const pos = geo.attributes.position, idx = geo.index; if (!idx) return;
  const n = pos.count, par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i;
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  const seen = new Map();   // vertices split at UV seams are the same point: weld by position
  for (let i = 0; i < n; i++) { const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`; if (seen.has(k)) join(i, seen.get(k)); else seen.set(k, i); }
  for (let t = 0; t < idx.count; t += 3) { join(idx.getX(t), idx.getX(t + 1)); join(idx.getX(t), idx.getX(t + 2)); }
  const box = new Map();
  for (let i = 0; i < n; i++) { const c = find(i); let b = box.get(c); if (!b) box.set(c, b = new THREE.Box3()); b.expandByPoint(V().fromBufferAttribute(pos, i)); }
  const band = [...box].filter(([, b]) => b.max.x - b.min.x > 0.2 && b.max.z - b.min.z < 0.05 && b.min.y > 0.02).map(([c]) => c);
  if (!band.length) return;
  const keep = [];
  for (let t = 0; t < idx.count; t += 3) if (!band.includes(find(idx.getX(t)))) keep.push(idx.getX(t), idx.getX(t + 1), idx.getX(t + 2));
  geo.setIndex(keep);
}

// regroup an indexed skinned geometry: group 0 = triangles with no vertex mainly weighted to bone `name`, group 1 = the rest
function splitByBone(mesh, name) {
  const g = mesh.geometry, bi = mesh.skeleton.bones.findIndex(b => b.name === name);
  if (bi < 0 || !g.index) return;
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, on = new Uint8Array(si.count);
  for (let i = 0; i < si.count; i++) { let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } } on[i] = best === bi; }
  const idx = g.index.array, a = [], b = [];
  for (let t = 0; t < idx.length; t += 3) (on[idx[t]] || on[idx[t + 1]] || on[idx[t + 2]] ? b : a).push(idx[t], idx[t + 1], idx[t + 2]);
  g.setIndex(a.concat(b)); g.clearGroups(); g.addGroup(0, a.length, 0); g.addGroup(a.length, b.length, 1);
}

// #305 (owner) Cly3DJ's own robot, made from the licensed one in Blender (blender/robot_v2/robot_v2.blend): no headband,
// the ear cups replaced by Gemini-logo headphones (chrome logo on a black cup), a chin ridge, a faceted bust, and gloves
// subdivided once with a chrome dart on each finger (knuckle to the last joint) instead of the white pads.
export const ROBOT_GLB = 'models/avatar/avatar_robot_v2.glb';
export class RobotAvatar2 {
  constructor(rig) {
    this.rig = rig; this.root = new THREE.Group(); this.root.name = 'robot2'; rig.add(this.root);
    this.ready = false; this.status = 'loading'; this.yaw = null; this.talk = 0; this.scanX = 0; this.scanDir = 1;
    this.scan = new Float32Array(COLS); this.bars = [0, 0, 0]; this.barT = 0;
  }
  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene; this.root.add(model); this.model = model;
    model.updateMatrixWorld(true);
    const bones = name => { const out = []; model.traverse(o => { if (o.isBone && o.name === name) out.push(o); }); return out; };
    this.headBone = bones('Head')[0]; this.neckBone = bones('Neck')[0];
    if (!this.headBone || !this.neckBone) throw new Error('avatar_robot.glb: no Head / Neck bones');
    // rest poses in model space (the model sits at the root's origin, unrotated)
    const inRoot = o => new THREE.Matrix4().copy(this.root.matrixWorld).invert().multiply(o.matrixWorld);
    const dec = m => { const p = V(), q = new THREE.Quaternion(), s = V(); m.decompose(p, q, s); return { p, q }; };
    const hr = dec(inRoot(this.headBone)), nr = dec(inRoot(this.neckBone));
    this.headRestQ = hr.q; this.headFromEye = hr.p.clone().sub(EYE); this.neckRestQ = nr.q;
    // visor: black glass, LED cells laid round the visor's curve (u = angle round the head, v = height)
    this.ledData = new Uint8Array(COLS * ROWS * 4); this.ledTex = new THREE.DataTexture(this.ledData, COLS, ROWS);
    this.ledTex.magFilter = this.ledTex.minFilter = THREE.NearestFilter; this.ledTex.colorSpace = THREE.SRGBColorSpace; this.ledTex.needsUpdate = true;
    const ledTex = this.ledTex;
    model.traverse(o => {
      if (!o.isMesh) return;
      o.layers.set(AV_LAYER); o.frustumCulled = false; o.castShadow = o.receiveShadow = false;
      if (o.material && o.material.name === 'AvatarRobot_Screen') {
        const m = new THREE.MeshBasicMaterial({ color: 0x050507, toneMapped: false });
        m.onBeforeCompile = sh => {
          sh.uniforms.ledTex = { value: ledTex };
          sh.vertexShader = 'varying vec2 vLed;\n' + sh.vertexShader.replace('#include <begin_vertex>',
            `#include <begin_vertex>\n  vLed = vec2( ( atan( position.x, position.z + ${VIS.z0.toFixed(4)} ) + ${VIS.a.toFixed(3)} ) / ${(2 * VIS.a).toFixed(3)}, ( position.y - (${VIS.y0.toFixed(4)}) ) / ${VIS.h.toFixed(4)} );`);
          sh.fragmentShader = 'uniform sampler2D ledTex;\nvarying vec2 vLed;\n' + sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );',
            `vec2 g = clamp( vLed, 0.0, 0.999 ) * vec2( ${COLS}.0, ${ROWS}.0 ), f = fract( g );
  float cell = smoothstep( 0.1, 0.2, f.x ) * smoothstep( 0.9, 0.8, f.x ) * smoothstep( 0.12, 0.24, f.y ) * smoothstep( 0.88, 0.76, f.y );
  vec3 lit = texture2D( ledTex, ( floor( g ) + 0.5 ) / vec2( ${COLS}.0, ${ROWS}.0 ) ).rgb;
  vec4 diffuseColor = vec4( diffuse + cell * ( vec3( 0.035, 0.002, 0.002 ) + lit ), opacity );`);
        };
        o.material = m;
      }
      if (o.isSkinnedMesh && o.material && o.material.name === 'AvatarRobot') {
        dropHeadband(o.geometry); rigidPieces(o.geometry);
        // chrome shell like the flight case ball corners (MAT.chrome); the painted map (black fuzzy stripe) stays.
        // Neck and collar (triangles touching a Neck-weighted vertex) keep the model's own matte material.
        const chrome = o.material.clone(); chrome.metalness = 1; chrome.roughness = 0.14;
        splitByBone(o, 'Neck'); o.material = [chrome, o.material];
      }
    });
    let gem = false; model.traverse(o => { if (o.material && /Gemini/.test(o.material.name || '')) gem = true; });
    if (!gem) this.addCrests();   // #305 the v2 robot wears the Gemini logo as its headphones
    model.traverse(o => { if (o.isSkinnedMesh && o.material && o.material.name === 'AvatarRobot_Hand') chromePads(o.material); });   // #305 chrome darts
    // hands: LeftHand / RightHand nodes; left is mirrored (scale x -1). Solved in each node's own space.
    this.hands = ['LeftHand', 'RightHand'].map((nm, i) => {
      let node = null; model.traverse(o => { if (!node && o.name === nm) node = o; });
      if (!node) throw new Error('avatar_robot.glb: no ' + nm);
      const B = {}; node.traverse(o => { if (o.isBone) B[o.name.replace(/_\d+$/, '')] = o; });   // three.js renames the second hand's bones Root_1, Index_1, ...
      let mesh = null; node.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
      const inv = new THREE.Matrix4().copy(node.matrixWorld).invert(), loc = o => dec(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      const rest = {}; for (const k in B) rest[k] = loc(B[k]);
      const R = B.Root.parent, rp = loc(R);   // the Root's parent (Armature), fixed
      // rest hand frame from the model's own knuckles; rest direction of every finger bone
      const fr = handFrame(rest.Root.p, rest.Index_Proximal.p, rest.Middle_Proximal.p, rest.Pinky_Proximal.p);
      const dirs = {};
      for (const chain of FINGERS) chain.forEach(([b], k) => {
        const next = chain[k + 1] ? rest[chain[k + 1][0]].p : null, prev = k > 0 ? rest[chain[k - 1][0]].p : rest[b].p;
        dirs[b] = next ? next.clone().sub(rest[b].p).normalize() : rest[b].p.clone().sub(prev).normalize();
      });
      // #247: the index fingertip in Index_Distal's own space (farthest skinned vertex of that bone). The robot's palm
      // is ~5 cm longer than a human hand, so with the Root on the wrist its fingertip poked ~7 cm past the real one
      // (into the platter). Each frame the whole hand is shifted so this tip sits on the tracked tip (blue ball).
      let tip = new THREE.Vector3(0, 0, 0.025);
      if (mesh) {
        const sk = mesh.skeleton, di = sk.bones.findIndex(b => b.name.replace(/_\d+$/, '') === 'Index_Distal');
        if (di >= 0) {
          const M = sk.boneInverses[di].clone().multiply(mesh.bindMatrix), g = mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, pa = g.attributes.position, v = V();
          let bl = 0;
          for (let k = 0; k < pa.count; k++) {
            let b = 0, bw = -1; for (let c = 0; c < 4; c++) { const wv = sw.getComponent(k, c); if (wv > bw) { bw = wv; b = si.getComponent(k, c); } }
            if (b !== di) continue; v.fromBufferAttribute(pa, k).applyMatrix4(M); const l = v.length(); if (l > bl) { bl = l; tip = v.clone(); }
          }
        }
      }
      return { node, B, mesh, rest, rp, fr, dirs, tip, off: null, left: i === 0, vis: 0 };
    });
    this.ready = true; this.status = 'ready';
    return this;
  }

  // the Gemini crest embossed on both ear cups: on each cup's flat centre disc (inside its stepped rings), the shell's
  // pearl a shade warmer, with the crest as a bump map, so its lines stand out of the surface
  async addCrests() {
    const tex = await new THREE.TextureLoader().loadAsync('models/avatar/gemini_emboss.png').catch(() => null);
    if (!tex) return;
    tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ color: 0xe3dfd6, roughness: 0.3, metalness: 1, bumpMap: tex, bumpScale: 6, alphaMap: tex, alphaTest: 0.3 });
    for (const side of [1, -1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * CUP.r, 2 * CUP.r), mat);
      m.position.set(side * (CUP.x + 0.0004), CUP.y, CUP.z); m.rotation.y = side * Math.PI / 2;   // facing out of the cup
      m.layers.set(AV_LAYER); m.frustumCulled = false; this.headBone.add(m);
    }
  }

  // set a bone's world pose (only the parts given), whatever its parents
  setWorld(bone, p, q) {
    const pm = bone.parent.matrixWorld, pq = new THREE.Quaternion(), pp = V(), ps = V(); pm.decompose(pp, pq, ps);
    if (q) bone.quaternion.copy(pq.invert().multiply(q));
    if (p) bone.position.copy(p.clone().applyMatrix4(new THREE.Matrix4().copy(pm).invert()));
    bone.updateMatrixWorld(true);
  }

  update(pose) {
    if (!this.ready || !pose || !pose.head) return;
    const dt = pose.dt || 1 / 60;
    this.root.updateMatrixWorld(true);
    const rq = this.root.getWorldQuaternion(new THREE.Quaternion());
    // head: the model's eyes on the real eyes
    const Rf = pose.head.q.clone().multiply(FACE);
    this.setWorld(this.headBone, pose.head.p.clone().add(this.headFromEye.clone().applyQuaternion(Rf)), Rf.clone().multiply(this.headRestQ));
    // neck / bust: a smoothed head yaw, leaning a little with the head (as #221)
    const hf = V().set(0, 0, -1).applyQuaternion(pose.head.q), flat = V().set(hf.x, 0, hf.z);
    const yaw = flat.lengthSq() > 1e-4 ? Math.atan2(-flat.x, -flat.z) : (this.yaw ?? 0);
    if (this.yaw == null) this.yaw = yaw;
    this.yaw += Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw)) * Math.min(1, dt * 2.5);
    const pitch = clamp(Math.asin(clamp(hf.y, -1, 1)), -0.9, 0.5) * 0.25;
    const bq = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, this.yaw, 0, 'YXZ'));
    this.setWorld(this.neckBone, null, rq.clone().multiply(bq).multiply(FACE).multiply(this.neckRestQ));
    (pose.hands || [null, null]).forEach((h, i) => this.hand(this.hands[i], h, dt));
    this.scanner(pose, dt);
  }

  hand(H, h, dt) {
    H.vis = clamp(H.vis + (h ? dt * 8 : -dt * 4), 0, 1);
    if (H.mesh) H.mesh.visible = H.vis > 0;
    if (!h) return;
    const J = h.joints && h.joints.size >= 20 ? h.joints : synthJoints(h, H.left);
    const node = H.node; node.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert(), L = name => { const p = J.get(name); return p ? p.clone().applyMatrix4(inv) : null; };
    const w = L('wrist'), ip = L('index-finger-phalanx-proximal'), mp = L('middle-finger-phalanx-proximal'), pp = L('pinky-finger-phalanx-proximal');
    if (!w || !ip || !mp || !pp) return;
    const fr = handFrame(w, ip, mp, pp);
    // hand rotation (node space): the model's rest frame onto the tracked one
    const Mr = basis(H.fr.F, H.fr.N), Ml = basis(fr.F, fr.N);
    const Rh = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().multiplyMatrices(Ml, Mr.clone().transpose()));
    const want = {};   // node-space rotations of every bone we set
    want.Root = Rh.clone().multiply(H.rest.Root.q);
    // Root: on the wrist; its parent (Armature) stays put
    const rpq = H.rp.q.clone().invert();
    H.B.Root.quaternion.copy(rpq.clone().multiply(want.Root));
    const wOff = H.off ? H.off.clone().applyQuaternion(Rh) : V();   // tip alignment offset (hand frame -> node space)
    H.B.Root.position.copy(w.clone().add(wOff).sub(H.rp.p).applyQuaternion(rpq));
    for (const m of METAS) want[m] = Rh.clone().multiply(H.rest[m].q);   // metacarpals ride with the hand
    for (const m of METAS) H.B[m].quaternion.copy(want.Root.clone().invert().multiply(want[m]));
    for (const chain of FINGERS) {
      let parent = chain[0][0] === 'Thumb_MetaCarpal' ? 'Root' : chain[0][0].split('_')[0];
      for (const [b, ja, jb] of chain) {
        const a = L(ja), c = L(jb), bone = H.B[b]; if (!bone) continue;
        if (a && c && c.distanceToSquared(a) > 1e-8) {
          const d = c.clone().sub(a).normalize();
          const R = new THREE.Matrix4().multiplyMatrices(basis(d, fr.N), basis(H.dirs[b], H.fr.N).transpose());
          want[b] = new THREE.Quaternion().setFromRotationMatrix(R).multiply(H.rest[b].q);
        } else want[b] = Rh.clone().multiply(H.rest[b].q);
        bone.quaternion.copy(want[parent].clone().invert().multiply(want[b]));
        parent = b;
      }
    }
    node.updateMatrixWorld(true);
    // #247: put the robot's index fingertip on the tracked one (controller: the blue tip ball). The offset is kept in
    // the hand's own frame and eased, so it rides with the hand; with a controller it isn't updated while the
    // trigger curls the index (the curled finger would drag the hand forward).
    // the target is the tracked tip raised 12 mm (world up): the robot's fingers are thicker than real ones, so with its
    // tip vertex on the tip joint its finger pad sank ~1 cm into whatever the real finger touched
    const target = h.tip ? h.tip.clone().applyMatrix4(inv) : L('index-finger-tip');
    if (target) target.add(new THREE.Vector3(0, TIP_LIFT, 0).applyMatrix3(_m3.setFromMatrix4(inv)));
    if (target && !(h.tip && (h.curlIndex ?? 0) > 0.45)) {
      const tipNow = H.tip.clone().applyMatrix4(H.B.Index_Distal.matrixWorld).applyMatrix4(inv);
      const want2 = wOff.clone().add(target.sub(tipNow)).applyQuaternion(Rh.clone().invert());
      if (want2.length() < 0.2) {
        const first = !H.off; H.off = first ? want2 : H.off.lerp(want2, Math.min(1, dt * 12));
        const nOff = H.off.clone().applyQuaternion(Rh);
        H.B.Root.position.copy(w.clone().add(nOff).sub(H.rp.p).applyQuaternion(rpq));
        node.updateMatrixWorld(true);
      }
    }
  }

  // the visor LEDs: scanner when quiet, voice bars when talking (they cross-fade)
  scanner(pose, dt) {
    const lv = clamp(((pose.mic || 0) - 0.02) * 5, 0, 1);
    this.talk += (lv - this.talk) * Math.min(1, dt * (lv > this.talk ? 20 : 3));
    const voice = clamp((this.talk - 0.05) * 3, 0, 1), idle = 1 - voice;
    // scanner: a bright head running along the middle rows, a fading trail behind it
    this.scanX += this.scanDir * (COLS - 1) * 0.9 * dt;
    if (this.scanX > COLS - 1) { this.scanX = 2 * (COLS - 1) - this.scanX; this.scanDir = -1; }
    if (this.scanX < 0) { this.scanX = -this.scanX; this.scanDir = 1; }
    const decay = Math.exp(-dt * 5);
    for (let c = 0; c < COLS; c++) this.scan[c] = Math.max(this.scan[c] * decay, Math.max(0, 1 - Math.abs(c - this.scanX)));
    // voice bars: new heights every ~70 ms (like the read-out of a voice), the centre one tallest
    this.barT -= dt;
    if (this.barT <= 0) {
      this.barT = 0.07;
      const base = this.talk * (0.75 + 0.5 * Math.random());
      // #306 (owner) three touching columns: a tall centre and two slightly shorter sides, no dark gaps (a talking look)
      this.bars = [0.8, 1, 0.8].map((k, i) => clamp(base * k * (i === 1 ? 1 : 0.85 + 0.25 * Math.random()) * 1.4, 0, 1));
    }
    const mid = (ROWS - 1) / 2, d = this.ledData, barCols = [COLS / 2 - 1, COLS / 2, COLS / 2 + 1].map(Math.floor);   // #306 adjacent, no gaps
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      let b = 0;
      if (idle > 0 && Math.abs(r - mid) <= 1) b = this.scan[c] * (r === mid ? 1 : 0.55) * idle;
      const bi = barCols.indexOf(c);
      if (bi >= 0 && voice > 0) { const h = Math.round(this.bars[bi] * (mid + 0.5)); if (Math.abs(r - mid) < h || (h > 0 && r === mid)) b = Math.max(b, voice * (1 - Math.abs(r - mid) / (ROWS * 0.9))); }
      const i = (r * COLS + c) * 4, core = b > 0.85 ? (b - 0.85) * 4 : 0;   // the hottest cells go a little pink
      d[i] = 255 * Math.min(1, b); d[i + 1] = 255 * Math.min(1, b * 0.06 + core * 0.35); d[i + 2] = 255 * Math.min(1, b * 0.04 + core * 0.4); d[i + 3] = 255;
    }
    this.ledTex.needsUpdate = true;
  }
}
