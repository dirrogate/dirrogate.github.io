// #355 NEON CHROME (owner: the robot's helmet and gloves looked best reflecting neon, as in the carousel renders).
// A dark room with thin red, cyan and purple light strips, baked once per renderer into an environment map; given to
// the robot's materials only (helmet, gloves: the DJ's own GLOVE look, the AVACAM / phone robot), so the decks and the
// rest of the gear keep the scene's own environment. A material's own envMap also honours envMapIntensity.
import * as THREE from 'three';

const cache = new WeakMap();
export function neonEnv(renderer) {
  let t = cache.get(renderer); if (t) return t;
  const es = new THREE.Scene(); es.background = new THREE.Color(0x020204);
  const strip = (col, w, h, x, y, z, ry, rx = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); es.add(m);
  };
  strip(new THREE.Color(4, 0.15, 0.1), 6, 0.12, 0, 2.2, -4, 0); strip(new THREE.Color(4, 0.15, 0.1), 0.12, 3, -4, 1.2, -1, Math.PI / 2);   // red
  strip(new THREE.Color(0.2, 2.2, 4), 6, 0.1, 0, 2.8, 4, Math.PI); strip(new THREE.Color(0.2, 2.2, 4), 0.1, 3, 4, 1.4, 1, -Math.PI / 2);   // cyan
  strip(new THREE.Color(2.2, 0.4, 4), 4, 0.15, 0, 4, 0, 0, Math.PI / 2); strip(new THREE.Color(2.2, 0.4, 4), 0.1, 2.5, -2.5, 1.5, 3.5, Math.PI * 0.75);   // purple
  const pm = new THREE.PMREMGenerator(renderer); t = pm.fromScene(es, 0.02).texture; pm.dispose();
  es.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  cache.set(renderer, t); return t;
}
// on: every lit material under root reflects the neon room; off: back to the scene's environment
export function applyNeon(root, renderer, on) {
  if (!root) return;
  const tex = on ? neonEnv(renderer) : null;
  root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m.isMeshStandardMaterial || m.envMap === tex) continue;
      m.envMap = tex; m.envMapIntensity = 1; m.needsUpdate = true;
    }
  });
}
