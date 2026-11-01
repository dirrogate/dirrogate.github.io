// #550 DANCER as a VJ Desk bus source (DirroDancer/MIGRATION_PLAN.md phase 2). Loaded by vjdesk.js the first time the desk needs her
// (a bus picks DANCER, a dance clip is clicked, or REC). She has her own WebGL renderer on a 1280 x 720 canvas (so her post chain,
// tone mapping and shadows never touch the program renderer); vjdesk.js samples that canvas as a texture for bus A / B.
// Stage RIMLIT / STUDIO, props WATER MANHOLE / HALLOWEEN PUMPKIN / FOG, cameras ORBIT / WIDE / HANDHELD CLOSE-UP with an X-Y pad
// (X = 0..360 round her, Y = 0..360 over the top), dance clips (Mixamo FBX "Without Skin" or GLB, listed in models/dancer/clips/clips.json),
// REC = up to 30 s of her picture at 960 x 540 into the VIDEOS bank (MP4 where the browser records MP4, else WebM).
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';
import { FBXLoader } from '../vendor/three/loaders/FBXLoader.js';
import { MeshoptDecoder } from '../vendor/three/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';
import { EffectComposer } from '../vendor/three/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/postprocessing/OutputPass.js';
import { GTAOPass } from '../vendor/three/postprocessing/GTAOPass.js';
import { ShaderPass } from '../vendor/three/postprocessing/ShaderPass.js';
import { RectAreaLightUniformsLib } from '../vendor/three/lights/RectAreaLightUniformsLib.js';   // #562 the soft face light
import { createDancer, createSilhouetteRig, attachCameraKey } from './dancer.js';

export const DZ_W = 1280, DZ_H = 720;
const REC_W = 960, REC_H = 540, REC_MAX = 30, D2R = Math.PI / 180;
const url = p => new URL('../models/' + p, import.meta.url).href;
const PROPS = { manhole: { file: 'props/water_manhole.glb', w: 0.75, at: [0.75, 0.003, 0.7] }, pumpkin: { file: 'props/halloween_pumpkin.glb', w: 0.36, at: [-0.8, 0, 0.6] } };
const FOG_COL = { cold: 0x8ea6c8, warm: 0xd6b08c, violet: 0xa98ad8, white: 0xd8dce4 };
const CAMS = { orbit: 1, hand: 1 };   // #551 two presets: ORBIT (slow spin) and HANDHELD (subtle shake); the X-Y pad and ZOOM do the framing
const ZOOM_MIN = 0.4, ZOOM_MAX = 8, CAM_DIST = 4.4;
const wrap = a => ((a + 540) % 360) - 180;
const nz = x => Math.sin(x) * 0.6 + Math.sin(x * 2.3 + 1.7) * 0.3 + Math.sin(x * 5.1 + 0.4) * 0.1;

export function makeDancer({ S, post, bc, media }) {
  let ready = false, loading = null, renderer, scene, cam, composer, gtao, dancer, rim, studio, camKey, fogG, gl;
  let soft, faceKey, envRoom, envSoft, bloom, gradeU, motes, floorM;   // #562 SOFT RIM
  const canvas = document.createElement('canvas'); canvas.width = DZ_W; canvas.height = DZ_H;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.NoColorSpace; tex.generateMipmaps = false; tex.minFilter = tex.magFilter = THREE.LinearFilter;
  const props = {}, propLoad = {};
  const save = () => { try { localStorage.setItem('vire.dancer', JSON.stringify({ clip: S.clip, stage: S.stage, outfit: S.outfit, speed: S.speed, props: S.props, fog: S.fog, cam: S.cam })); } catch {} };

  if (!(S.cam.mode in CAMS)) S.cam.mode = 'hand';   // #551 WIDE (and the old close-up) are gone: a saved one becomes HANDHELD
  function ensure() {
    if (loading) return loading;
    S.loading = true; S.err = ''; post();
    loading = (async () => {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(1); renderer.setSize(DZ_W, DZ_H, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1; renderer.shadowMap.enabled = true;
      scene = new THREE.Scene(); scene.background = new THREE.Color(0x07060b); scene.fog = new THREE.FogExp2(0x07060b, 0.05);
      const pm = new THREE.PMREMGenerator(renderer); envRoom = scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      envSoft = pm.fromScene(softEnvScene(), 0.02).texture; pm.dispose();   // #562 dark room with only the rim and face panels: reflections match the lights
      cam = new THREE.PerspectiveCamera(32, DZ_W / DZ_H, 0.03, 60); scene.add(cam);
      camKey = attachCameraKey(THREE, cam, { intensity: 1.1 }); camKey.visible = false;
      const floor = new THREE.Mesh(new THREE.CircleGeometry(5, 64), new THREE.MeshStandardMaterial({ color: 0x0c0a12, roughness: 0.25, metalness: 0.4 }));
      floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor); floorM = floor.material;
      rim = createSilhouetteRig(THREE); scene.add(rim.group);
      studio = new THREE.Group();
      const key = new THREE.SpotLight(0xffe6d6, 55, 0, 0.55, 0.6); key.position.set(2.2, 3.6, 3); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.target.position.set(0, 1, 0);
      const fill = new THREE.SpotLight(0xb8c8ff, 18, 0, 0.7, 0.8); fill.position.set(-2.6, 2, 2.4); fill.target.position.set(0, 1, 0);
      const back = new THREE.SpotLight(0x7ad7ff, 40, 0, 0.6, 0.7); back.position.set(-1.5, 3, -2.6); back.target.position.set(0, 1.2, 0);
      studio.add(key, key.target, fill, fill.target, back, back.target); scene.add(studio);
      fogG = makeFog(); scene.add(fogG);
      // #562 SOFT RIM: teal and amber rims behind her and a dim top light, a navy fill; the group turns with the camera so the rims stay behind
      // her from any angle. A soft rectangle light (beauty dish) sits between the camera and her face, a little above, and follows her head.
      RectAreaLightUniformsLib.init();
      soft = new THREE.Group(); soft.visible = false;
      const sp = (c, i, x, y, z, ty) => { const l = new THREE.SpotLight(c, i, 12, 0.5, 0.85, 2); l.position.set(x, y, z); l.target.position.set(0, ty, 0); soft.add(l, l.target); return l; };
      sp(0x35d6ff, 190, -1.8, 2.5, -2.1, 1.25); sp(0xffa24a, 150, 1.8, 2.3, -2.1, 1.2); sp(0xbfd8ff, 22, 0, 4.2, -0.4, 1.2);
      soft.add(new THREE.HemisphereLight(0x1a3550, 0x05070c, 0.55)); scene.add(soft);
      faceKey = new THREE.RectAreaLight(0xffe6d2, 7, 0.7, 0.5); faceKey.visible = false; scene.add(faceKey);
      motes = makeMotes(); scene.add(motes);
      // post: GTAO, a light bloom, the warm grade + vignette from the DirroDancer test page
      const rt = new THREE.WebGLRenderTarget(DZ_W, DZ_H, { type: THREE.HalfFloatType, samples: 4 });
      composer = new EffectComposer(renderer, rt); composer.setPixelRatio(1); composer.setSize(DZ_W, DZ_H); composer.addPass(new RenderPass(scene, cam));
      gtao = new GTAOPass(scene, cam, DZ_W, DZ_H); gtao.blendIntensity = 0.6; gtao.updateGtaoMaterial({ radius: 0.12, distanceExponent: 1.5, thickness: 1, scale: 1 });
      const ov = gtao.overrideVisibility.bind(gtao); gtao.overrideVisibility = () => { ov(); fogG.visible = false; };   // fog sprites stay out of the AO normal pass
      composer.addPass(gtao);
      bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.16, 0.85, 0.12); composer.addPass(bloom); composer.addPass(new OutputPass());
      // grade + lens (display space). uSoft = 1 on SOFT RIM: radial colour fringing, navy shadows (never black), warm highlights, fine grain
      const gp = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uWarm: { value: 0.035 }, uVig: { value: 0.35 }, uSoft: { value: 0 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(DZ_W, DZ_H) } },
        vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform sampler2D tDiffuse; uniform float uWarm, uVig, uSoft, uTime; uniform vec2 uRes; varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 d = vUv - 0.5; float r2 = dot(d, d); vec2 off = d * r2 * 0.016 * uSoft;
  vec4 c = texture2D(tDiffuse, vUv);
  if (uSoft > 0.0) { c.r = texture2D(tDiffuse, vUv + off).r; c.b = texture2D(tDiffuse, vUv - off).b; }
  c.rgb += vec3(uWarm, uWarm * 0.4, -uWarm * 0.6) * (1.0 - c.rgb);
  c.rgb = mix(c.rgb, c.rgb * c.rgb * (3.0 - 2.0 * c.rgb), 0.12);
  float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  c.rgb += vec3(0.020, 0.040, 0.070) * (1.0 - smoothstep(0.0, 0.35, l)) * uSoft;
  c.rgb *= mix(vec3(1.0), vec3(1.05, 1.0, 0.92), smoothstep(0.35, 0.9, l) * uSoft);
  float v = smoothstep(0.85, 0.25, length(d)); c.rgb *= mix(1.0 - uVig, 1.0, v);
  c.rgb += (hash(floor(vUv * uRes) + fract(uTime * 7.0) * 113.0) - 0.5) * 0.03 * uSoft;
  gl_FragColor = c;
}` });
      gradeU = gp.uniforms; composer.addPass(gp);
      // her, then the dance clips
      gl = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      dancer = createDancer(THREE, await gl.loadAsync(url('dancer/dirrodancer.glb')), {});
      dancer.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
      scene.add(dancer.root);
      let list = []; try { list = await (await fetch(url('dancer/clips/clips.json'), { cache: 'no-cache' })).json(); } catch (e) { console.warn('dancer clips.json', e); }
      const fbx = new FBXLoader();
      await Promise.all(list.map(async f => {
        try { const u = url('dancer/clips/' + encodeURIComponent(f)), o = /\.fbx$/i.test(f) ? await fbx.loadAsync(u) : await gl.loadAsync(u), c = o.animations && o.animations[0]; if (c) dancer.addClip(retarget(o, c), f.replace(/\.[^.]+$/, '')); }
        catch (e) { console.warn('dancer clip', f, e); }
      }));
      S.clips = list.map(f => f.replace(/\.[^.]+$/, '')).filter(n => dancer.actions.has(n));
      if (!dancer.actions.has(S.clip)) S.clip = S.clips[0] || '';
      if (S.clip) dancer.play(S.clip, 0);
      dancer.mixer.timeScale = S.speed || 1;   // #559 dance speed
      if (S.outfit && S.outfit !== 'Red' && dancer.outfits.includes(S.outfit)) await dancer.setOutfit(S.outfit);   // #558 RED / CATSUIT (Black latex)
      applyStage(); applyProps();
      window.__dz = { dancer, scene, cam, canvas, props, S, renderer };   // test hook (PC pane)
      ready = true; S.loaded = true; S.loading = false; post();
    })().catch(e => { console.warn('dancer', e); S.err = e.message || String(e); S.loading = false; loading = null; post(); });
    return loading;
  }

  // a clip's hips move in its own armature's space: Mixamo FBX has no armature turn, her GLB armature is turned 90 deg about X (Blender export),
  // so the hips position + rotation are turned into her armature's space (bones below the hips are parent-relative and need nothing)
  function retarget(o, clip) {
    o.updateMatrixWorld(true); dancer.root.updateMatrixWorld(true);
    const sh = o.getObjectByName('mixamorigHips') || o.getObjectByName('mixamorig:Hips'), Q = THREE.Quaternion;
    const sq = sh && sh.parent ? sh.parent.getWorldQuaternion(new Q()) : new Q(), tq = dancer.bone.Hips.parent.getWorldQuaternion(new Q());
    const k = tq.invert().multiply(sq); if (Math.abs(k.w) > 0.99999) return clip;
    const q = new Q(), v = new THREE.Vector3();
    for (const t of clip.tracks) {
      if (!/Hips\.(quaternion|position)$/.test(t.name)) continue;
      const a = t.values, rot = t.name.endsWith('quaternion');
      for (let i = 0; i < a.length; i += rot ? 4 : 3) {
        if (rot) { q.fromArray(a, i).premultiply(k); q.toArray(a, i); } else { v.fromArray(a, i).applyQuaternion(k); v.toArray(a, i); }
      }
    }
    return clip;
  }
  function applyStage() {
    if (!rim) return; const st = S.stage, sf = st === 'soft';
    rim.group.visible = st === 'rim'; studio.visible = st === 'studio'; soft.visible = faceKey.visible = motes.visible = sf;
    scene.environment = sf ? envSoft : envRoom; scene.environmentIntensity = st === 'rim' ? 0.08 : st === 'studio' ? 0.6 : 0.9;
    renderer.toneMapping = sf ? THREE.AgXToneMapping : THREE.NeutralToneMapping; renderer.toneMappingExposure = sf ? 1.15 : 1;   // #562 AgX: softer highlight roll-off
    gradeU.uSoft.value = sf ? 1 : 0; gradeU.uVig.value = sf ? 0.55 : 0.35;
    floorM.envMapIntensity = sf ? 0.12 : 1; floorM.color.setHex(sf ? 0x07060a : 0x0c0a12);   // SOFT RIM: the floor stays dark, no coloured panel patches
    bloom.strength = sf ? 0.3 : 0.16; bloom.threshold = sf ? 0.25 : 0.12;
    if (dancer) { const k = dancer.skin; k.uWrap.value = sf ? 0.35 : 0.1; k.uSSSColor.value.setRGB(...(sf ? [0.95, 0.55, 0.45] : [0.92, 0.72, 0.62])); k.uPoreFar.value = sf ? 3.6 : 2.2; k.uDetailStrength.value = sf ? 0.45 : 0.35; }
  }
  function softEnvScene() {   // #562 what her skin and the latex reflect on SOFT RIM: black, a teal and an amber panel behind, a soft warm panel in front
    const es = new THREE.Scene(); es.background = new THREE.Color(0x000000);
    const pl = (col, I, w, h, x, y, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(I), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 1.2, 0); es.add(m); };
    pl(0x35d6ff, 4, 1.2, 3, -2.2, 2, -2.2); pl(0xffa24a, 3.5, 1.2, 3, 2.2, 2, -2.2); pl(0xfff0e6, 1.2, 1.4, 1, 0, 1.8, 2.4); pl(0x16263c, 0.5, 6, 2, 0, 0.3, 3.5);
    return es;
  }
  function makeMotes() {   // #562 a few out-of-focus dust motes (soft bokeh discs) drifting near her, SOFT RIM only
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 31);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.85, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c), N = 40, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 5; pos[i * 3 + 1] = 0.2 + Math.random() * 2.4; pos[i * 3 + 2] = -2 + Math.random() * 5; seed[i] = Math.random() * 6.28; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(geo, new THREE.PointsMaterial({ map: t, size: 0.09, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xcfe2ff, opacity: 0.16, fog: false }));
    p.userData = { base: pos.slice(), seed }; p.visible = false; p.frustumCulled = false; return p;
  }
  function tickMotes(t) {
    if (!motes.visible) return; const a = motes.geometry.attributes.position, b = motes.userData.base, s = motes.userData.seed;
    for (let i = 0; i < s.length; i++) { a.array[i * 3] = b[i * 3] + Math.sin(t * 0.13 + s[i]) * 0.25; a.array[i * 3 + 1] = b[i * 3 + 1] + Math.sin(t * 0.09 + s[i] * 2) * 0.18; a.array[i * 3 + 2] = b[i * 3 + 2] + Math.cos(t * 0.11 + s[i]) * 0.2; }
    a.needsUpdate = true;
  }
  function applyProps() {
    if (!scene) return;
    for (const id of Object.keys(PROPS)) {
      const on = !!S.props[id];
      if (props[id]) props[id].visible = on;
      else if (on && !propLoad[id]) propLoad[id] = loadProp(id);
    }
    fogG.visible = !!S.props.fog;
  }
  async function loadProp(id) {
    const P = PROPS[id];
    try {
      const m = (await gl.loadAsync(url(P.file))).scene, b = new THREE.Box3().setFromObject(m), s = b.getSize(new THREE.Vector3());
      m.scale.setScalar(P.w / Math.max(s.x, s.z, 1e-3)); b.setFromObject(m); const c = b.getCenter(new THREE.Vector3());
      m.position.set(-c.x, -b.min.y, -c.z); m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const g = new THREE.Group(); g.add(m); g.position.set(...P.at);
      if (id === 'pumpkin') { const l = new THREE.PointLight(0xff8a2a, 1.2, 1.6, 2); l.position.set(0, 0.16, 0.05); g.add(l); g.userData.glow = l; }
      props[id] = g; scene.add(g); g.visible = !!S.props[id];
    } catch (e) { console.warn('dancer prop', id, e); S.err = id + ': ' + (e.message || e); post(); }
  }

  // ---- ground fog: soft drifting sprites (unlit, tinted), plus thicker scene fog
  function makeFog() {
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    for (let i = 0; i < 26; i++) {   // a lumpy cloud: overlapping soft blobs inside a round falloff
      const r = 40 + Math.random() * 60, px = 128 + (Math.random() - 0.5) * 120, py = 128 + (Math.random() - 0.5) * 80, gr = x.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
    }
    x.globalCompositeOperation = 'destination-in'; const m = x.createRadialGradient(128, 128, 30, 128, 128, 128); m.addColorStop(0, '#fff'); m.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = m; x.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group(); g.visible = false;
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0, fog: false }));
      s.userData = { x: (Math.random() - 0.5) * 7, z: -2.8 + Math.random() * 5.2, y: Math.random(), sz: 1.6 + Math.random() * 1.8, rot: Math.random() * 6.28, rs: (Math.random() - 0.5) * 0.15, ph: Math.random() * 6.28 };
      g.add(s);
    }
    return g;
  }
  function tickFog(dt, t) {
    const f = S.fog, on = !!S.props.fog; scene.fog.density = 0.05 + (on ? f.den * 0.07 : 0);
    if (!on) return;
    const col = FOG_COL[f.col] || FOG_COL.cold;
    for (const s of fogG.children) {
      const u = s.userData; u.x += dt * f.speed * 0.3; if (u.x > 3.5) u.x -= 7; u.rot += u.rs * dt * (0.5 + f.speed);
      s.position.set(u.x, 0.08 + u.y * f.h * 0.7, u.z); s.scale.setScalar(u.sz * (0.55 + f.h * 0.55));
      const edge = Math.min(1, (3.5 - Math.abs(u.x)) / 0.9);
      s.material.rotation = u.rot; s.material.color.setHex(col); s.material.opacity = f.den * 0.32 * (0.7 + 0.3 * Math.sin(t * 0.3 + u.ph)) * Math.max(0, edge);
    }
  }

  // ---- cameras (#551): X = round her (0..360), Y = over the top (0..360, past 90 the picture turns upside down like a crane over her),
  // ZOOM = distance (4.4 m / zoom: 11 m wide to 0.55 m close). Close in, the aim slides from her middle up to her head and follows it, and the
  // camera key light comes on. ORBIT adds a slow 6 deg/s spin; HANDHELD stops the spin where it is and adds a subtle hand-held drift and shake.
  // Everything eases, so pad and zoom moves are usable while REC runs.
  const C = { az: 0, el: 8, dist: CAM_DIST, tgt: new THREE.Vector3(0, 1, 0), spin: 0, init: false };
  const _t = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3(), _h = new THREE.Vector3();
  function tickCam(dt, t) {
    const c = S.cam, hand = c.mode === 'hand';
    if (!hand) C.spin = (C.spin + dt * 6) % 360;
    let az = (+c.x || 0) + C.spin, el = +c.y || 0;
    const dist = CAM_DIST / Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +c.zoom || 1)), close = Math.min(1, Math.max(0, (2.6 - dist) / 1.8));
    dancer.bone.Head.getWorldPosition(_h); _t.set(_h.x * close, 1.0 + (_h.y - 0.06 - 1.0) * close, _h.z * close);
    if (hand) { az += nz(t * 0.23) * 2.2; el += nz(t * 0.31 + 2) * 1.2; }   // slow drift of the operator's body
    const k = C.init ? 1 - Math.exp(-dt * 4) : 1; C.init = true;
    C.az += wrap(az - C.az) * k; C.el += wrap(el - C.el) * k; C.dist += (dist - C.dist) * k; C.tgt.lerp(_t, k);
    const a = C.az * D2R, e = C.el * D2R;
    _d.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)); _u.set(-Math.sin(e) * Math.sin(a), Math.cos(e), -Math.sin(e) * Math.cos(a));
    cam.position.copy(C.tgt).addScaledVector(_d, C.dist); cam.up.copy(_u);
    _t.copy(C.tgt); if (hand) { const j = 0.004 + 0.004 * Math.min(1, C.dist / 3); _t.x += nz(t * 1.9) * j; _t.y += nz(t * 2.3 + 4) * j; }
    cam.lookAt(_t); if (hand) cam.rotateZ(nz(t * 1.3 + 9) * 0.008);
    if (cam.fov !== 32) { cam.fov = 32; cam.updateProjectionMatrix(); }
    camKey.visible = close > 0.3 && S.stage !== 'soft';   // SOFT RIM has its own face light
    if (S.stage === 'soft') {   // #562 the rims turn with the camera; the face light sits between camera and face, 1 m out and a little above
      soft.rotation.y = C.az * D2R; scene.environmentRotation.y = C.az * D2R;
      _d.subVectors(cam.position, _h).setY(0).normalize(); faceKey.position.copy(_h).addScaledVector(_d, 1.0); faceKey.position.y += 0.28; faceKey.lookAt(_h);
    }
  }

  // ---- REC: her picture, 960 x 540, up to 30 s, into the VIDEOS bank
  let rec = null;
  function recStart() {
    const c = document.createElement('canvas'); c.width = REC_W; c.height = REC_H; const ctx = c.getContext('2d'); ctx.fillRect(0, 0, REC_W, REC_H); if (ready) ctx.drawImage(canvas, 0, 0, REC_W, REC_H);   // #551 first frame = her current picture, not black
    const mime = ['video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    if (!mime) { S.rec = { on: false, t: 0, msg: 'This browser cannot record video' }; post(); return; }
    const mr = new MediaRecorder(c.captureStream(30), { mimeType: mime, videoBitsPerSecond: 6e6 }), chunks = [];
    mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = () => recSave(new Blob(chunks, { type: mime.split(';')[0] }), mime);
    mr.start(1000); rec = { mr, ctx, t0: performance.now(), clip: S.clip || 'dancer' };
    S.rec = { on: true, t: 0, msg: 'REC' }; post();
  }
  function recStop() { if (!rec) return; const r = rec; rec = null; S.rec = { on: false, t: 0, msg: 'Saving…' }; post(); try { r.mr.stop(); } catch {} }
  async function recSave(blob, mime) {
    try {
      const d = new Date(), p = n => String(n).padStart(2, '0'), stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
      const name = `DANCER ${S.clip || 'clip'} ${stamp}.${/mp4/.test(mime) ? 'mp4' : 'webm'}`;
      const saved = await media.importFile('Video', new File([blob], name, { type: blob.type }));
      S.rec = { on: false, t: 0, msg: `Saved to VIDEOS: ${saved} (${(blob.size / 1e6).toFixed(1)} MB)` }; post();
      bc.postMessage({ k: 'dzrec', folder: 'Video', name: saved });
    } catch (e) { S.rec = { on: false, t: 0, msg: 'Save failed: ' + (e.message || e) }; post(); }
  }

  // ---- one frame of her (called from the desk's output loop, or its idle timer while previewing / recording)
  let last = 0, time = 0, recPostT = 0;
  function render(now) {
    if (!ready) return false;
    if (last && now - last < 8) return true;   // already drawn this frame
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now; time += dt;
    dancer.update(dt); tickCam(dt, time); tickFog(dt, time); tickMotes(time); gradeU.uTime.value = time;
    const pk = props.pumpkin; if (pk && pk.visible) pk.userData.glow.intensity = 1.0 + 0.35 * nz(time * 7.3);
    composer.render(dt); tex.needsUpdate = true;
    if (rec) {
      rec.ctx.drawImage(canvas, 0, 0, REC_W, REC_H);
      const el = (now - rec.t0) / 1000; S.rec.t = el;
      if (el >= REC_MAX) recStop(); else if (now - recPostT > 500) { recPostT = now; post(); }
    }
    return true;
  }

  function onMsg(m) {
    const op = m.op;
    if (op === 'clip' && m.name) { S.clip = String(m.name); if (ready && dancer.actions.has(S.clip)) dancer.play(S.clip, 0.8); }
    else if (op === 'speed') { S.speed = Math.max(0.25, Math.min(2, +m.v || 1)); if (ready) dancer.mixer.timeScale = S.speed; }   // #559
    else if (op === 'outfit') { const v = m.v === 'Black' ? 'Black' : 'Red'; S.outfit = v; if (ready) dancer.setOutfit(v).catch(e => { S.err = 'outfit: ' + e.message; post(); }); }   // #558
    else if (op === 'stage') { S.stage = m.v === 'studio' || m.v === 'soft' ? m.v : 'rim'; applyStage(); }   // #562 + 'soft'
    else if (op === 'prop' && m.id in S.props) { S.props[m.id] = !!m.v; applyProps(); }
    else if (op === 'fog') { const v = m.v || {}; for (const k of ['den', 'h', 'speed']) if (k in v) S.fog[k] = Math.max(0, Math.min(2, +v[k] || 0)); if (v.col in FOG_COL) S.fog.col = v.col; }
    else if (op === 'cam') { const v = m.v || {}; if (v.mode in CAMS) S.cam.mode = v.mode; for (const k of ['x', 'y']) if (k in v) S.cam[k] = Math.max(0, Math.min(360, +v[k] || 0)); if ('zoom' in v) S.cam.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +v.zoom || 1)); }
    else if (op === 'rec') { if (rec) recStop(); else ensure().then(() => { if (ready && !rec) recStart(); }); }
    save(); post(); ensure();
  }
  return { ensure, render, onMsg, tex, get ready() { return ready; }, get recording() { return !!rec; } };
}
