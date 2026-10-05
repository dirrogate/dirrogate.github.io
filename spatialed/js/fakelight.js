// Fake light (owner, #96): cheap stand-ins for real lights and real-time shadows, so they cost almost nothing on
// Quest and work over passthrough.
//  - Wall glow: the neon's light on the wall behind it (texture from neon.js neonGlowTexture), one quad.
//  - Blob shadows: a soft dark patch under each piece of gear and under records in the air, one quad each.
import * as THREE from 'three';

// ---- wall glow material. mode 'add': adds light and leaves the framebuffer alpha alone (over passthrough this
// only shows if the compositor treats our layer as premultiplied); 'tint': writes alpha too, so passthrough is
// tinted red for sure but a little dimmed where the glow is faint.
export function glowMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uI: { value: 1 }, uTint: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D map; uniform float uI; uniform float uTint; varying vec2 vUv;
      void main(){ vec3 c = texture2D(map, vUv).rgb * uI;
        float a = clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0);
        // premultiplied: result = c + dst * (1 - alpha). tint: alpha = a. add (#98): mostly light, plus a 75 % dim of
        // what is behind, so on a light wall the glow reads deep red instead of washing the wall out to salmon/orange
        gl_FragColor = vec4(c, uTint > 0.5 ? a : 0.75 * a); }`,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}
export function setGlowMode(mat, mode) {
  const tint = mode === 'tint'; mat.uniforms.uTint.value = tint ? 1 : 0;
  mat.blending = THREE.CustomBlending; mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;   // both modes premultiplied; they differ in alpha only
  mat.needsUpdate = true;
}

// ---- blob shadow textures: soft rounded box (gear, crates, cases) and soft disc (records)
function blobTex(kind) {
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  // alphaMap reads the GREEN channel: white shape on black (#97: it was black on transparent, so every blob had
  // alpha 0 and nothing showed)
  g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
  g.filter = 'blur(9px)'; g.fillStyle = '#fff';
  if (kind === 'disc') { g.beginPath(); g.arc(N / 2, N / 2, N * 0.34, 0, Math.PI * 2); g.fill(); }
  else { const m = N * 0.17, r = N * 0.08, w = N - 2 * m; g.beginPath(); g.roundRect(m, m, w, w, r); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}
const TEX = {};
// One blob. The texture's soft edge takes ~17% of each side, so the quad is drawn 1.5x the footprint.
export function makeBlob(kind = 'box') {
  TEX[kind] = TEX[kind] || blobTex(kind);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    color: 0x000000, alphaMap: TEX[kind], transparent: true, depthWrite: false, opacity: 0.5,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
  m.renderOrder = 1; m.raycast = () => {}; m.matrixAutoUpdate = true;
  return m;
}
// Place a blob on a surface at height sy (parent space): footprint w x d, yaw, gap = height above the surface.
// Higher up = bigger, softer and fainter; gone at 0.35 m (an object on unknown real furniture gets none).
export function placeBlob(b, x, sy, z, w, d, yaw, gap, strength) {
  const k = Math.max(0, 1 - gap / 0.35);
  b.visible = k > 0.02;
  if (!b.visible) return;
  const grow = 1 + gap * 1.8;
  b.position.set(x, sy + 0.0015, z); b.rotation.set(0, yaw, 0);
  b.scale.set(w * 1.5 * grow, 1, d * 1.5 * grow);
  b.material.opacity = strength * k * k;
}
