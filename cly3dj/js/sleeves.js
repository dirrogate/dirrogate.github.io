// #347 Black forearm sleeves (owner: like the Dirro avatar's hoodie) for the PHONE CAM picture. The drawn hands (3D
// hands, robot glove, controllers) sit over the real ones in the phone's video; without a forearm the hand would end
// in mid-air where the drawn decks cover the real arm. Each sleeve is a tapered open tube from just in front of the
// wrist to an estimated elbow (forearm ~26 cm, pointing back from the hand, toward the shoulder and a little down),
// matte black, fading out over its last 60 % so there is no hard end. Only drawn in the PHONE CAM render (main.js
// pcamPrep shows them for that render alone); never seen in the headset.
import * as THREE from 'three';

const LEN = 0.26, R_WRIST = 0.042, R_ELBOW = 0.052;
const _up = new THREE.Vector3(0, 1, 0), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _f = new THREE.Vector3(), _s = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3();

function fadeMap() {   // alpha along the tube: v 0 = wrist (solid) .. 1 = elbow (gone); alphaMap reads green
  const c = document.createElement('canvas'); c.width = 4; c.height = 64; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 64, 0, 0);   // canvas bottom = v 0 (flipY)
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.4, '#fff'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}

export function makeSleeves() {
  const geo = new THREE.CylinderGeometry(R_ELBOW, R_WRIST, 1, 14, 1, true); geo.translate(0, 0.5, 0);   // y 0 = wrist end, 1 = elbow end
  const mat = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.9, metalness: 0, transparent: true, alphaMap: fadeMap(), depthWrite: false, side: THREE.DoubleSide });
  const group = new THREE.Group(); group.name = 'sleeves'; group.visible = false;
  const tubes = [0, 1].map(() => { const m = new THREE.Mesh(geo, mat); m.visible = false; m.raycast = () => {}; m.renderOrder = 1; group.add(m); return m; });
  // pose: { head: { p, q }, hands: [left, right] with { p: wrist (world), f: wrist -> fingers } } (director.js xrPose / demoPose)
  function update(pose) {
    for (let i = 0; i < 2; i++) {
      const h = pose && pose.hands && pose.hands[i], t = tubes[i];
      if (!h || !h.p || !h.f) { t.visible = false; continue; }
      _f.copy(h.f).normalize();
      // shoulder: below the head and out to that side
      _r.set(1, 0, 0).applyQuaternion(pose.head.q); _r.y = 0; _r.normalize();
      _s.copy(pose.head.p).addScaledVector(_up, -0.24).addScaledVector(_r, i === 0 ? -0.18 : 0.18);
      _d.copy(_f).negate().add(_b.copy(_s).sub(h.p).normalize()).normalize(); _d.y -= 0.3; _d.normalize();   // half back along the hand, half to the shoulder, then down
      _a.copy(h.p).addScaledVector(_f, 0.02);   // start 2 cm in front of the wrist (under the cuff / hand's edge)
      t.position.copy(_a); t.quaternion.setFromUnitVectors(_up, _d);   // the group lives in the scene root: world = local
      t.scale.set(1, LEN, 1); t.visible = true;
    }
  }
  return { group, tubes, update };
}
