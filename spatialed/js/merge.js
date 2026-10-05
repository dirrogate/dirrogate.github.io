// Static geometry merging (CLAUDE.md #84). Every mesh is one draw call; on Quest the per-call CPU cost adds
// up long before triangles do. mergeStatic() folds all meshes under `root` that never move relative to it
// into one mesh per (material, vertex layout, interaction tags, shadow flags, render order), baked into
// root's space. Moving parts, controls and anything `skip` names stay separate.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/three/utils/BufferGeometryUtils.js';

const TAGS = ['move', 'resize', 'lid', 'control', 'platterOf'];

export function mergeStatic(root, skip = () => false) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material)) return;
    for (let a = o; a && a !== root; a = a.parent) if (!a.visible || skip(a)) return;
    if (o.morphTargetInfluences || o.matrixWorld.determinant() < 0) return;   // mirrored parts would turn inside out
    const g = o.geometry;
    const attrs = Object.keys(g.attributes).sort().map(k => k + g.attributes[k].itemSize).join(',');
    const tag = {}; for (const k of TAGS) if (o.userData[k] !== undefined) tag[k] = o.userData[k];
    const key = [o.material.uuid, attrs, JSON.stringify(tag), o.castShadow, o.receiveShadow, o.renderOrder, !!g.index].join('|');
    let e = groups.get(key); if (!e) groups.set(key, e = { list: [], tag, mat: o.material, cast: o.castShadow, recv: o.receiveShadow, order: o.renderOrder });
    e.list.push(o);
  });
  let before = 0, after = 0;
  const m = new THREE.Matrix4();
  for (const e of groups.values()) {
    before += e.list.length;
    if (e.list.length < 2) { after++; continue; }
    const geos = e.list.map(o => {
      const gg = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
      for (const k of Object.keys(gg.morphAttributes)) delete gg.morphAttributes[k];
      gg.clearGroups();
      return gg.applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (!merged) { after += e.list.length; continue; }
    merged.computeBoundingSphere(); merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, e.mat);
    mesh.castShadow = e.cast; mesh.receiveShadow = e.recv; mesh.renderOrder = e.order;
    Object.assign(mesh.userData, e.tag); mesh.userData.merged = e.list.length;
    root.add(mesh);
    for (const o of e.list) o.parent.remove(o);
    after++;
  }
  return { before, after };
}
