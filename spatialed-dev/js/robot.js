// Robot DJ avatar (CLAUDE.md #221): an original robot modelled in Blender (blender/robot/robot_build.py) and exported
// to models/avatar/robot.glb: a human-skull-proportioned faceted pearl helmet with a fixed slit mouth, a visor slot
// with a scanner light bar that sweeps back and forth while the DJ talks (MIC level), temple pods, a floating bust
// with the owner's logo embossed on the chest plate, and segmented gloves that follow the tracked fingers joint by
// joint. No arms, so no elbows to get wrong. ~1.7k triangles, one 1024 texture set (colour, ORM, normal).
// Same interface as Avatar (director.js): ready, status, root, update(pose).
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';
import { AV_LAYER } from './director.js';

const V = () => new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const N_LED = 15;
// sizes the glove parts were modelled at (robot_build.py part 4)
const SEG_LEN = 0.03, KN_R = 0.0102, PALM = [0.082, 0.024, 0.088], BACK = [0.074, 0.012, 0.072];

const CHAINS = [   // WebXR joint names, base -> tip
  ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ...['index', 'middle', 'ring', 'pinky'].map(n => [`${n}-finger-phalanx-proximal`, `${n}-finger-phalanx-intermediate`, `${n}-finger-phalanx-distal`, `${n}-finger-tip`]),
];

// Controllers and the desktop demo give only a wrist pose: build a plausible hand from it (curl 0 = flat, 1 = fist)
export function synthJoints(h, left) {
  const F = h.f.clone().normalize(), S = h.s.clone(); S.addScaledVector(F, -S.dot(F)).normalize();
  const P = left ? V().crossVectors(S, F) : V().crossVectors(F, S);   // out of the palm
  const A = V().crossVectors(F, P).normalize();                       // curl axis
  const w = h.p.clone(), J = new Map([['wrist', w]]);
  const fingers = [['index', -0.026, 0.088, 1, h.curlIndex ?? h.curl], ['middle', -0.006, 0.092, 1.05, h.curl], ['ring', 0.013, 0.087, 0.97, h.curl], ['pinky', 0.03, 0.078, 0.8, h.curl]];
  for (const [n, so, fo, L, c0] of fingers) {
    const c = c0 ?? 0.3, names = CHAINS.find(ch => ch[0].startsWith(n));
    let p = w.clone().addScaledVector(F, fo).addScaledVector(S, so); J.set(names[0], p);
    const d = F.clone(), lens = [0.042, 0.026, 0.021], bend = [0.9, 1.25, 0.8];
    for (let k = 0; k < 3; k++) { d.applyAxisAngle(A, c * bend[k]); p = p.clone().addScaledVector(d, lens[k] * L); J.set(names[k + 1], p); }
  }
  const c = (h.curl ?? 0.3) * 0.5;
  let p = w.clone().addScaledVector(F, 0.025).addScaledVector(S, -0.022).addScaledVector(P, 0.012); J.set(CHAINS[0][0], p);
  const d = V().addScaledVector(F, 0.55).addScaledVector(S, -0.7).addScaledVector(P, 0.45).normalize();
  [0.04, 0.032, 0.026].forEach((len, k) => {
    d.applyAxisAngle(V().crossVectors(d, S).normalize(), c); p = p.clone().addScaledVector(d, len); J.set(CHAINS[0][k + 1], p);
  });
  return J;
}

export class RobotAvatar {
  constructor(rig) {
    this.rig = rig; this.root = new THREE.Group(); this.root.name = 'robot'; rig.add(this.root);
    this.ready = false; this.status = 'loading'; this.yaw = null; this.talk = 0; this.scanX = 0; this.scanDir = 1;
    this.led = new Float32Array(N_LED);
  }
  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const by = n => { let f = null; gltf.scene.traverse(o => { if (!f && o.isMesh && o.name.startsWith(n)) f = o; }); if (!f) throw new Error('robot.glb: no ' + n); return f; };
    const add = (p, o) => { p.add(o); return o; };
    // head: Helmet (shell + pods), visor glass, scanner cells. Local origin = the eyes, looking down -Z.
    this.head = add(this.root, new THREE.Group());
    const helmet = by('Helmet'); helmet.position.set(0, 0, 0); this.head.add(helmet);
    const visor = by('Visor'); visor.position.set(0, 0, 0);
    visor.material = new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.55, depthWrite: false });
    visor.renderOrder = 2; this.head.add(visor);
    const scan = by('Scanner'); scan.position.set(0, 0, 0);
    this.ledData = new Uint8Array(N_LED * 4); this.ledTex = new THREE.DataTexture(this.ledData, N_LED, 1);
    this.ledTex.magFilter = this.ledTex.minFilter = THREE.NearestFilter; this.ledTex.colorSpace = THREE.SRGBColorSpace; this.ledTex.needsUpdate = true;
    this.ledMat = new THREE.MeshBasicMaterial({ map: this.ledTex, toneMapped: false });
    scan.material = this.ledMat; scan.renderOrder = 1; this.head.add(scan);
    // bust (torso + short neck): origin = the neck point under the back of the head
    this.bust = add(this.root, new THREE.Group());
    const bust = by('Bust'); bust.position.set(0, 0, 0); this.bust.add(bust);
    // gloves: instanced parts sharing the robot material
    const geo = n => by(n).geometry, mat = helmet.material;
    this.hands = [0, 1].map(() => {
      const g = add(this.root, new THREE.Group());
      const segs = add(g, new THREE.InstancedMesh(geo('FingerSeg'), mat, 15));
      const knuck = add(g, new THREE.InstancedMesh(geo('Knuckle'), mat, 15));
      const tips = add(g, new THREE.InstancedMesh(geo('Tip'), mat, 5));
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (const im of [segs, knuck, tips]) for (let k = 0; k < im.count; k++) im.setMatrixAt(k, zero);
      const palm = add(g, new THREE.Mesh(geo('Palm'), mat)), back = add(g, new THREE.Mesh(geo('HandBack'), mat)), cuff = add(g, new THREE.Mesh(geo('Cuff'), mat));
      g.visible = false;
      return { g, segs, knuck, tips, palm, back, cuff, fade: 0 };
    });
    this.root.traverse(o => { if (o.isMesh) { o.layers.set(AV_LAYER); o.frustumCulled = false; o.castShadow = o.receiveShadow = false; } });
    this.ready = true; this.status = 'ready';
    return this;
  }

  update(pose) {
    if (!this.ready || !pose || !pose.head) return;
    const dt = pose.dt || 1 / 60, rig = this.rig;
    rig.updateMatrixWorld(); this.root.updateMatrixWorld();
    const inv = this.root.matrixWorld.clone().invert(), rq = this.root.getWorldQuaternion(new THREE.Quaternion()), rqi = rq.clone().invert();
    const toLocalP = p => p.clone().applyMatrix4(inv), toLocalQ = q => rqi.clone().multiply(q);
    // head: exactly on the real head
    this.head.position.copy(toLocalP(pose.head.p)); this.head.quaternion.copy(toLocalQ(pose.head.q));
    // bust: under the back of the head, turned by a smoothed head yaw, leaning a little with the head
    const hf = V().set(0, 0, -1).applyQuaternion(pose.head.q), flat = V().set(hf.x, 0, hf.z);
    const yaw = flat.lengthSq() > 1e-4 ? Math.atan2(-flat.x, -flat.z) : (this.yaw ?? 0);
    if (this.yaw == null) this.yaw = yaw;
    this.yaw += Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw)) * Math.min(1, dt * 2.5);
    const back = V().set(Math.sin(this.yaw), 0, Math.cos(this.yaw));   // behind the face
    const neck = pose.head.p.clone().addScaledVector(back, 0.07); neck.y -= 0.125;
    const pitch = clamp(Math.asin(clamp(hf.y, -1, 1)), -0.9, 0.5) * 0.25;
    const bq = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, this.yaw, 0, 'YXZ'));
    this.bust.position.copy(toLocalP(neck)); this.bust.quaternion.copy(toLocalQ(bq));
    (pose.hands || [null, null]).forEach((h, i) => this.glove(this.hands[i], h, i === 0, inv, dt));
    // scanner: a bright cell sweeping back and forth with a fading trail; fast and bright while talking
    const lv = clamp(((pose.mic || 0) - 0.02) * 5, 0, 1);
    this.talk += (lv - this.talk) * Math.min(1, dt * (lv > this.talk ? 20 : 3));
    const talking = this.talk > 0.06;
    const speed = talking ? (N_LED - 1) * (1.3 + 1.4 * this.talk) : (N_LED - 1) * 0.35;   // cells / s
    this.scanX += this.scanDir * speed * dt;
    if (this.scanX > N_LED - 1) { this.scanX = 2 * (N_LED - 1) - this.scanX; this.scanDir = -1; }
    if (this.scanX < 0) { this.scanX = -this.scanX; this.scanDir = 1; }
    const peak = talking ? 0.55 + 0.45 * this.talk : 0.22, decay = Math.exp(-dt * (talking ? 7 : 4));
    for (let k = 0; k < N_LED; k++) {
      const near = Math.max(0, 1 - Math.abs(k - this.scanX));
      this.led[k] = Math.max(this.led[k] * decay, near * peak);
      const b = Math.min(1, this.led[k] + 0.03);
      this.ledData[k * 4] = 255 * b; this.ledData[k * 4 + 1] = 255 * b * 0.08; this.ledData[k * 4 + 2] = 255 * b * 0.04; this.ledData[k * 4 + 3] = 255;
    }
    this.ledTex.needsUpdate = true;
  }

  glove(G, h, left, inv, dt) {
    G.fade = clamp(G.fade + (h ? dt * 8 : -dt * 4), 0, 1);
    if (!h) { if (G.fade <= 0) G.g.visible = false; return; }
    G.g.visible = true;
    const J = h.joints && h.joints.size >= 20 ? h.joints : synthJoints(h, left);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), mid = new THREE.Vector3(), dir = new THREE.Vector3();
    const put = (mesh, idx, p, quat, scl) => { m.compose(p, quat, scl).premultiply(inv); if (idx == null) m.decompose(mesh.position, mesh.quaternion, mesh.scale); else mesh.setMatrixAt(idx, m); };
    let si = 0, ki = 0;
    CHAINS.forEach((names, f) => {
      const r = f === 0 ? 1.08 : f === 4 ? 0.85 : 1.0;   // thumb thicker, pinky thinner
      for (let k = 0; k < 3; k++) {
        const a = J.get(names[k]), b = J.get(names[k + 1]);
        if (a) put(G.knuck, ki, a, q.identity(), s.setScalar(r));
        ki++;
        if (a && b) {
          dir.subVectors(b, a); const len = dir.length(); dir.normalize();
          put(G.segs, si, mid.addVectors(a, b).multiplyScalar(0.5), q.setFromUnitVectors(Y, dir), s.set(r, Math.max(0.2, (len - KN_R * 1.2) / SEG_LEN), r));
          if (k === 2) put(G.tips, f, b.clone().addScaledVector(dir, -0.004), q, s.setScalar(r));
        }
        si++;
      }
    });
    G.segs.instanceMatrix.needsUpdate = G.knuck.instanceMatrix.needsUpdate = G.tips.instanceMatrix.needsUpdate = true;
    // palm, armour plate on the back of the hand, cuff
    const w = J.get('wrist'), ip = J.get(CHAINS[1][0]), mp = J.get(CHAINS[2][0]), pp = J.get(CHAINS[4][0]);
    if (w && ip && mp && pp) {
      const kn = ip.clone().add(pp).multiplyScalar(0.5).lerp(mp, 0.5);
      const F = kn.clone().sub(w), len = F.length(); F.normalize();
      const S = pp.clone().sub(ip); const wid = S.length(); S.addScaledVector(F, -S.dot(F)).normalize();
      const N = V().crossVectors(F, S).normalize(), S2 = V().crossVectors(N, F);
      const bq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(S2, N, F));
      const pc = w.clone().addScaledVector(F, len * 0.55);
      put(G.palm, null, pc, bq, s.set((wid + 0.022) / PALM[0], 1, len * 0.95 / PALM[2]));
      const backN = left ? N : N.clone().negate();   // N is the back of a left hand, the palm of a right hand
      const backQ = left ? bq : bq.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
      put(G.back, null, pc.clone().addScaledVector(backN, 0.015), backQ, s.set((wid + 0.014) / BACK[0], 1, len * 0.8 / BACK[2]));
      put(G.cuff, null, w.clone().addScaledVector(F, -0.02), new THREE.Quaternion().setFromUnitVectors(Y, F), s.set(1, 1, 1));
    }
  }
}
