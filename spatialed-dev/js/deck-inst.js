// #154 (owner: the turntables were 68 of the scene's 112 draw calls). Both decks are the same model, so every part
// that shares its material (and geometry) between deck A and deck B is drawn once, as a 2-instance InstancedMesh.
// Each frame the instances copy the two original parts' world matrices, so everything that moves (platter, arm,
// buttons, pitch cap, power dial, lamp) keeps moving, per deck. The originals stay in place for picking and
// logic, moved to HIDE_LAYER so the cameras skip them (the raycaster is told to include that layer). A pair whose
// materials stop matching (e.g. one deck's slipmat swapped) falls back to drawing its two originals.
import * as THREE from 'three';

export const HIDE_LAYER = 5;   // not 1 or 2: three's WebXR eye cameras use those
const OK = m => m && !Array.isArray(m) && (m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) && !m.transparent;

export function instanceDecks(a, b, scene) {
  const la = [], lb = [];
  a.traverse(o => { if (o.isMesh && !o.isInstancedMesh) la.push(o); });
  b.traverse(o => { if (o.isMesh && !o.isInstancedMesh) lb.push(o); });
  const pairs = [], n = Math.min(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    const x = la[i], y = lb[i];
    if (x.material !== y.material || !OK(x.material)) continue;
    const gx = x.geometry, gy = y.geometry, px = gx.attributes.position, py = gy.attributes.position;
    if (!px || !py || px.count !== py.count || !!gx.index !== !!gy.index || (gx.index && gx.index.count !== gy.index.count)) continue;
    if (px.getX(0) !== py.getX(0) || px.getY(px.count - 1) !== py.getY(py.count - 1)) continue;   // same shape, not just the same size
    if (x.morphTargetInfluences || x.isSkinnedMesh) continue;
    const im = new THREE.InstancedMesh(gx, x.material, 2);
    im.castShadow = x.castShadow; im.receiveShadow = x.receiveShadow; im.renderOrder = x.renderOrder;
    im.frustumCulled = false; im.matrixAutoUpdate = false; im.raycast = () => {}; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.name = 'deckInst:' + (x.name || x.parent?.name || i);
    x.layers.set(HIDE_LAYER); y.layers.set(HIDE_LAYER);
    scene.add(im); pairs.push({ x, y, im });
  }
  const Z = new THREE.Matrix4().makeScale(0, 0, 0);
  const shown = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  const api = {
    pairs,
    update() {
      a.updateMatrixWorld(true); b.updateMatrixWorld(true);
      for (let i = pairs.length - 1; i >= 0; i--) {
        const p = pairs[i];
        if (p.x.material !== p.im.material || p.y.material !== p.im.material) {   // materials diverged: draw the originals again
          p.x.layers.set(0); p.y.layers.set(0); p.im.removeFromParent(); p.im.dispose(); pairs.splice(i, 1); continue;
        }
        p.im.setMatrixAt(0, shown(p.x) ? p.x.matrixWorld : Z);
        p.im.setMatrixAt(1, shown(p.y) ? p.y.matrixWorld : Z);
        p.im.instanceMatrix.needsUpdate = true;
      }
    },
  };
  api.update();
  return api;
}
