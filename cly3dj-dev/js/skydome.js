// Generative Atmospheric, Anjunadeep & Planetarium SkyDomes for DirroDJ (Fast Per-World Shader Build).
// Splits each world into its own tiny, fast-compiling ShaderMaterial (<40 ms compile on PC/Quest 3)
// with zero duplicate evalSky() calls and 4-strip progressive 2048x1024 updates (0.52M px/frame @ 18 fps).
import * as THREE from 'three';

const KEY = 'vire.skydome';

export const SKY_WORLDS = [
  { id: 'aurora',   label: 'AURORA',   desc: 'Anjunadeep Boreal Observatory + NASA Moon' },
  { id: 'solstice', label: 'SOLSTICE', desc: 'Realistic Sun Halo → Moonrise Cloud Sea' },
  { id: 'wormhole', label: 'WORMHOLE', desc: 'Galactic Time Vortex Planetarium Tunnel' },
  { id: 'droste',   label: 'DROSTE',   desc: 'Infinite Recursive Droste Spiral Galaxies' },
  { id: 'nebula',   label: 'NEBULA',   desc: 'Stark Undulating Cosmic Dust & Stars' },
];
export const SKY_CYCLES = [0, 32, 64, 128, 256, 512];   // 0 = HOLD, else bars per full evolution cycle
export const SKY_GRADES = ['auto', 'sunset', 'deep', 'blade', 'noir'];
export const SKY_GROUNDS = ['off', 'concrete', 'asphalt', 'cobble', 'mirror'];
export const SKY_SPEEDS = [
  { id: 'glacial', label: 'GLACIAL', mul: 0.45 },
  { id: 'drift',   label: 'DRIFT',   mul: 1.00 },
  { id: 'flow',    label: 'FLOW',    mul: 1.75 },
];

const GROUND_URLS = {
  concrete: 'surfaces/concrete/diff.jpg',
  asphalt:  'surfaces/asphalt/diff.jpg',
  cobble:   'surfaces/cobblestone/diff.jpg',
};
const MOON_URL = 'img/moon_albedo.png';
const MONOLITH_URL = 'img/monolith_360_cutout.webp';

const QUAD_VS = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Compact shared GLSL header (~90 lines) — included in each per-world shader
const COMMON_GLSL = /* glsl */`precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform float uRealTime;
uniform float uPhase;
uniform float uBass;
uniform float uWorld;
uniform float uGrade;
uniform float uHaze;
uniform float uWet;
uniform float uCamH;
uniform float uTileScale;
uniform float uHasGround;
uniform float uHasMoon;
uniform float uHasMonolith;
uniform float uMonolithOn;
uniform float uMonolithY;
uniform float uBodySize;
uniform float uFade;
uniform sampler2D uGroundMap;
uniform sampler2D uMoonMap;
uniform sampler2D uMonolithMap;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float pnoise(vec2 p, float px) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, px), x1 = mod(i.x + 1.0, px);
  return mix(mix(hash21(vec2(x0, i.y)), hash21(vec2(x1, i.y)), f.x),
             mix(hash21(vec2(x0, i.y + 1.0)), hash21(vec2(x1, i.y + 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.0, w = 0.5;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) { a += w * vnoise(p); p = rot * p * 2.04 + vec2(13.7, 7.3); w *= 0.5; }
  return a;
}
float pfbm(vec2 p, float px) {
  float a = 0.0, w = 0.5;
  for (int i = 0; i < 3; i++) { a += w * pnoise(p, px); p *= 2.0; px *= 2.0; w *= 0.5; }
  return a;
}

vec3 starfield(vec3 d, float t, float density, float scale) {
  if (d.y < 0.0) return vec3(0.0);
  vec3 p = d * scale, id = floor(p), f = fract(p) - 0.5;
  float h = hash31(id);
  if (h < density) return vec3(0.0);
  vec3 off = vec3(hash31(id + 11.3), hash31(id + 27.1), hash31(id + 43.7)) - 0.5;
  float dist = length(f - off * 0.55);
  float glow = 0.70 + 0.30 * sin(t * (0.09 + 0.14 * fract(h * 73.1)) + h * 100.0);
  float s = smoothstep(0.24, 0.02, dist) * glow * smoothstep(0.0, 0.16, d.y);
  vec3 tint = mix(vec3(0.75, 0.86, 1.0), vec3(1.0, 0.88, 0.72), fract(h * 41.3));
  return tint * s * (0.55 + 1.15 * pow(fract(h * 19.7), 3.0));
}

vec3 worldHorizonColor() {
  float w = 0.5 - 0.5 * cos(uPhase * TAU);
  if (uWorld < 0.5) return mix(vec3(0.025, 0.068, 0.095), vec3(0.062, 0.036, 0.098), w);
  if (uWorld < 1.5) return mix(vec3(0.42, 0.22, 0.12), vec3(0.032, 0.055, 0.115), w);
  if (uWorld < 2.5) return mix(vec3(0.14, 0.04, 0.16), vec3(0.05, 0.07, 0.18), w);
  if (uWorld < 3.5) return mix(vec3(0.05, 0.08, 0.16), vec3(0.14, 0.07, 0.10), w);
  return vec3(0.002, 0.003, 0.007);
}

vec3 applyMonolithFX(vec3 baseSky, vec3 d, float ph, float t, float realT, float haze, float bass) {
  float az = atan(d.z, d.x), uAz = fract(az / TAU);
  float el = asin(clamp(d.y, -1.0, 1.0));
  // Luminous backlit mist tint harmonized with the active world (bright enough to billow visibly even over dark NEBULA!)
  vec3 mistBase = max(worldHorizonColor() * 2.1, vec3(0.22, 0.28, 0.34));
  vec3 col = baseSky;

  // Backlit rising fog plumes billowing upward from nadir (-PI/2) across horizon toward zenith
  float p1 = pfbm(vec2(uAz * 10.0, el * 4.2 - t * 0.22), 10.0);
  float p2 = pfbm(vec2(uAz * 20.0 + (p1 - 0.5) * 1.6, el * 8.0 - t * 0.34), 20.0);
  float riseMask = smoothstep(-1.55, -0.75, el) * smoothstep(1.36, -0.15, el) * (0.34 + 0.66 * exp(-max(el + 0.30, 0.0) * 1.35));
  float plume = smoothstep(0.24, 0.72, p1 * 0.55 + p2 * 0.45);
  col = mix(col, mistBase, plume * riseMask * (0.42 + 0.50 * haze));

  if (el > -0.25) {
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      float baseAz = -1.6 + (fi - 0.5) * 1.4 + sin(t * (0.16 + fi * 0.05) + fi * 2.0) * 0.45;
      float tilt = 0.40 + 0.22 * cos(t * 0.13 + fi);
      float da = atan(sin(az - baseAz), cos(az - baseAz));
      float beam = exp(-abs(da - (el - 0.05) * tilt * 0.55) * (17.0 - max(el, 0.0) * 8.0));
      beam *= smoothstep(-0.20, 0.25, el) * smoothstep(1.45, 0.30, el);
      col += mix(vec3(0.75, 0.86, 0.96), mistBase * 1.6 + vec3(0.25), 0.45) * beam * (0.16 + 0.18 * haze + bass * 0.10);
    }
  }

  if (uHasMonolith > 0.5) {
    vec2 mUv = vec2(1.0 - fract(atan(d.z, -d.x) / TAU), 0.5 + el / PI - uMonolithY);
    vec4 city = (mUv.y <= 1.0 && mUv.y >= 0.0) ? texture2D(uMonolithMap, mUv) : vec4(0.0);
    if (city.a > 0.004) {
      vec3 cLin = pow(city.rgb, vec3(2.2));
      float lum = dot(cLin, vec3(0.2126, 0.7152, 0.0722));
      // Detect real lit window dots & horizontal window strips by comparing against DARK facade pixels ABOVE & BELOW (±5px)
      vec2 ty = vec2(0.0, 5.0 / 1024.0);
      vec3 cUp = pow(texture2D(uMonolithMap, clamp(mUv + ty, 0.0, 1.0)).rgb, vec3(2.2));
      vec3 cDn = pow(texture2D(uMonolithMap, clamp(mUv - ty, 0.0, 1.0)).rgb, vec3(2.2));
      float upLum = dot(cUp, vec3(0.2126, 0.7152, 0.0722));
      float dnLum = dot(cDn, vec3(0.2126, 0.7152, 0.0722));
      float wallLum = min(upLum, dnLum);
      float isWin = smoothstep(0.018, 0.065, lum - wallLum) * smoothstep(0.14, 0.03, wallLum) * step(0.88, city.a);
      if (isWin > 0.01) {
        vec2 winId = floor(mUv * vec2(220.0, 130.0));
        float wh = hash21(winId);
        // Staggered random 45s..300s cycles so across 20-30 windows you see 1-2 gently fading on/off every ~10-15s,
        // while each individual window stays steadily on or off for 1-5 minutes!
        float period = 22.0 + 128.0 * hash21(winId + 19.3);
        float cyc = fract(realT / period + wh);
        float onDur = 0.30 + 0.45 * hash21(winId + 7.1);
        float edge = clamp(2.5 / period, 0.015, 0.10); // smooth ~2.5-second fade in/out (2x faster)
        float wFade = smoothstep(0.0, edge, cyc) * (1.0 - smoothstep(onDur - edge, onDur, cyc));
        vec3 winOff = min(cUp, cDn) * 0.90;
        vec3 winOn  = cLin * 1.55 * mix(vec3(1.0, 0.90, 0.72), vec3(0.84, 0.95, 1.08), fract(wh * 13.7));
        cLin = mix(cLin, mix(winOff, winOn, wFade), isWin);
      }
      vec3 fg = cLin * mix(vec3(0.96, 0.98, 1.02), mistBase * 1.25, 0.16);
      float fWisp = pfbm(vec2(uAz * 14.0, el * 6.8 - t * 0.28), 14.0);
      fg = mix(fg, mistBase * 0.88, smoothstep(-1.55, -0.75, el) * smoothstep(0.55, -0.35, el) * smoothstep(0.32, 0.78, fWisp) * (0.32 + 0.48 * haze));
      col = mix(col, fg, city.a);
    }
  }
  return col;
}

vec3 applyGrade(vec3 c) {
  if (uGrade < 0.5) return c;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  if (uGrade < 1.5) return c * vec3(1.12, 0.95, 0.82);
  if (uGrade < 2.5) return c * vec3(0.80, 1.04, 1.15);
  if (uGrade < 3.5) return mix(c, c * vec3(1.14, 0.88, 0.72), 0.75);
  return mix(vec3(lum), c, 0.22) * vec3(0.92, 0.96, 1.06);
}
`;

const MOON_GLSL = /* glsl */`
vec3 nasaMoon(vec3 d, vec3 dir, float rad, float phaseAng, float vis) {
  if (vis <= 0.001) return vec3(0.0);
  float cd = dot(d, dir), ang = acos(clamp(cd, -1.0, 1.0));
  float halo = pow(max(cd, 0.0), 48.0) * 0.42 + pow(max(cd, 0.0), 9.0) * 0.08;
  float iceRing = exp(-pow((ang - 0.36) / 0.038, 2.0)) * 0.035;
  vec3 outCol = vec3(0.36, 0.52, 0.82) * (halo + iceRing);
  if (ang < rad * 1.12) {
    vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), dir)), u2 = cross(dir, rt);
    vec2 lp = vec2(dot(d, rt), dot(d, u2)) / rad;
    float r2 = dot(lp, lp), disc = smoothstep(1.04, 0.96, sqrt(r2));
    if (disc > 0.001) {
      vec3 n = vec3(lp.x, lp.y, sqrt(max(0.0, 1.0 - r2)));
      vec3 sunL = normalize(vec3(cos(phaseAng), 0.18, sin(phaseAng)));
      float lit = pow(max(dot(n, sunL), 0.0), 0.72) * 1.55 + 0.035;
      vec3 albedo = uHasMoon > 0.5 ? pow(texture2D(uMoonMap, clamp(lp * 0.485 + 0.5, 0.01, 0.99)).rgb, vec3(2.0)) : vec3(0.76, 0.77, 0.79);
      outCol += albedo * vec3(1.0, 0.98, 0.94) * lit * (0.78 + 0.22 * n.z) * disc * 1.35;
    }
  }
  return outCol * vis;
}
`;

// Shared main() footer — NEVER calls evalSky() twice (eliminates the 25s ANGLE/FXC shader compile stall!)
const FOOTER_GLSL = /* glsl */`
void main() {
  float lat = (vUv.y - 0.5) * PI;
  float phi = (1.0 - vUv.x) * TAU;
  float cl = cos(lat);
  vec3 d = vec3(-cos(phi) * cl, sin(lat), sin(phi) * cl);

  vec3 col;
  if (uHasGround < -0.5) {
    vec3 skyCol = worldSky(d);
    if (uMonolithOn > 0.5) skyCol = applyMonolithFX(skyCol, d, uPhase, uTime, uRealTime, uHaze, uBass);
    if (d.y < 0.0) {
      vec3 nadirDark = worldHorizonColor() * 0.25 + vec3(0.003, 0.004, 0.006);
      col = mix(skyCol, nadirDark, smoothstep(0.0, -0.55, d.y) * (uMonolithOn > 0.5 ? 0.55 : 0.88));
    } else {
      col = skyCol;
    }
  } else if (d.y >= -0.002) {
    col = worldSky(d);
    if (uMonolithOn > 0.5) col = applyMonolithFX(col, d, uPhase, uTime, uRealTime, uHaze, uBass);
  } else {
    float tFloor = -uCamH / min(d.y, -0.002);
    vec2 gPos = d.xz * tFloor;
    float dist = length(gPos);
    vec3 horFog = worldHorizonColor();
    // Lightweight specular sky reflection (no duplicate evalSky() call!)
    float ndv = clamp(-d.y, 0.0, 1.0);
    float fresnel = pow(1.0 - ndv, 3.0);
    vec3 skyRefl = horFog * (1.25 + 0.55 * fresnel) + vec3(0.02, 0.03, 0.05) * fresnel;

    if (uHasGround > 0.5) {
      vec2 uvG = gPos / max(uTileScale, 0.4);
      vec3 tex = pow(texture2D(uGroundMap, uvG).rgb, vec3(2.2));
      tex = mix(vec3(0.14, 0.15, 0.17), tex, exp(-dist * 0.06));
      float puddle = smoothstep(0.42, 0.68, vnoise(gPos * 0.45 + vec2(3.1, 1.7)));
      vec3 amb = max(horFog * 0.85, vec3(0.032, 0.038, 0.052));
      float wetEff = clamp(uWet * (0.40 + 0.65 * puddle) * (0.25 + 0.75 * fresnel), 0.0, 0.82);
      col = mix(tex * amb * 1.55, skyRefl, wetEff);
    } else {
      vec3 baseDark = horFog * 0.22 + vec3(0.008, 0.010, 0.016);
      col = mix(baseDark, skyRefl * 1.15, clamp((0.30 + 0.60 * uWet) * (0.30 + 0.70 * fresnel), 0.0, 0.88));
    }
    col *= mix(0.72, 1.0, smoothstep(0.35, 1.85, dist));
    col = mix(col, horFog, clamp(1.0 - exp(-dist * (0.028 + 0.042 * uHaze)), 0.0, 0.92));
  }

  col = applyGrade(col);
  if (uFade > 0.001) col = mix(col, vec3(0.04, 0.06, 0.09), uFade);
  col = col / (1.0 + col * 0.30);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// 5 tiny, independent per-world fragment bodies (each compiles in ~25-40ms!)
const WORLD_SHADERS = {
  aurora: COMMON_GLSL + MOON_GLSL + /* glsl */`
vec3 worldSky(vec3 d) {
  float w = 0.5 - 0.5 * cos(uPhase * TAU), ey = max(d.y, 0.0);
  vec3 zenCol = mix(vec3(0.008, 0.016, 0.042), vec3(0.024, 0.012, 0.055), w);
  vec3 horCol = mix(vec3(0.032, 0.095, 0.125), vec3(0.088, 0.048, 0.135), w);
  vec3 col = mix(horCol, zenCol, pow(ey, 0.55));
  float mw = fbm(d.xz * 2.4 + vec2(d.y * 1.5, uTime * 0.008));
  col += vec3(0.025, 0.040, 0.070) * smoothstep(0.45, 0.85, mw) * smoothstep(0.05, 0.6, ey);
  col += starfield(d, uTime, 0.986, 190.0) * (1.0 - uHaze * 0.55);

  vec3 moonDir = normalize(vec3(-0.26, 0.25 + 0.11 * sin(uPhase * TAU), -0.92));
  col += nasaMoon(d, moonDir, 0.044 * uBodySize, 0.75 + uPhase * 1.4, 1.0);

  if (d.y > 0.01) {
    vec2 p = d.xz / (d.y + 0.28);
    float aurAcc = 0.0; vec3 aurColAcc = vec3(0.0);
    vec3 cLow  = mix(vec3(0.04, 1.12, 0.62), vec3(0.14, 0.80, 1.22), w);
    vec3 cHigh = mix(vec3(0.42, 0.18, 1.12), vec3(1.02, 0.20, 0.76), w);
    for (int i = 0; i < 3; i++) {
      float fi = float(i), sc = 0.55 + fi * 0.24;
      vec2 q = p * sc + vec2(uTime * (0.020 + fi * 0.008), -uTime * 0.014 + fi * 2.1);
      float warp = fbm(q * 0.95 + vec2(sin(uTime * 0.05 + fi), cos(uTime * 0.04)));
      float wave = sin(q.x * 2.4 + warp * 5.2 + fi * 1.9 + uPhase * TAU);
      float ribbon = exp(-abs(wave) * (3.6 - uHaze * 0.9));
      float rays = 0.55 + 0.45 * sin(q.x * 22.0 + warp * 11.0 + uTime * 0.40);
      float band = ribbon * rays * smoothstep(0.01, 0.16, d.y) * smoothstep(1.0, 0.10, d.y * 0.72);
      float wgt = (0.70 - fi * 0.16);
      aurColAcc += mix(cLow, cHigh, clamp(warp * 0.85 + fi * 0.24, 0.0, 1.0)) * band * wgt;
      aurAcc += band * wgt;
    }
    col += aurColAcc * (1.0 + 0.24 * sin(uPhase * TAU * 2.0) + uBass * 0.26) * (1.20 - uHaze * 0.28);
    col += mix(cLow, cHigh, 0.4) * exp(-ey * 7.0) * (0.12 + 0.10 * aurAcc);
  }
  float az = atan(d.z, d.x);
  float ridge = 0.032 + 0.042 * vnoise(vec2(az * 3.5, 1.2)) + 0.022 * vnoise(vec2(az * 9.0 + 4.1, 2.7));
  col = mix(col, mix(vec3(0.008, 0.012, 0.020), horCol * 0.35, uHaze * 0.7), smoothstep(ridge + 0.005, ridge - 0.003, d.y));
  return mix(col, horCol * (0.60 + 0.25 * uHaze), exp(-abs(d.y) * (12.0 - uHaze * 6.0)) * (0.24 + 0.42 * uHaze));
}
` + FOOTER_GLSL,

  solstice: COMMON_GLSL + MOON_GLSL + /* glsl */`
vec3 realisticSun(vec3 d, vec3 dir, float rad, float elev, float vis) {
  if (vis <= 0.001) return vec3(0.0);
  float cd = max(dot(d, dir), 0.0), ang = acos(clamp(dot(d, dir), -1.0, 1.0));
  float low = smoothstep(0.32, -0.02, elev);
  vec3 coreCol = mix(vec3(2.8, 2.55, 2.15), vec3(2.6, 1.65, 0.75), low);
  vec3 edgeCol = mix(vec3(1.9, 1.15, 0.45), vec3(1.85, 0.48, 0.12), low);
  vec3 scatterCol = mix(vec3(1.0, 0.72, 0.42), vec3(1.0, 0.36, 0.14), low);
  vec3 outCol = vec3(0.0);
  if (ang < rad * 1.25) {
    float r = clamp(ang / rad, 0.0, 1.25), mu = sqrt(max(0.0, 1.0 - min(r, 1.0) * min(r, 1.0)));
    outCol += mix(edgeCol, coreCol, pow(mu, 0.55)) * smoothstep(1.08, 0.94, r);
  }
  outCol += scatterCol * (pow(cd, 110.0) * 1.25 + pow(cd, 22.0) * 0.42 + pow(cd, 5.5) * 0.38);
  outCol += mix(vec3(1.0, 0.78, 0.55), vec3(0.95, 0.55, 0.65), low) * exp(-pow((ang - 0.384) / 0.048, 2.0)) * 0.075 * smoothstep(0.0, 0.18, d.y);
  outCol += vec3(1.0, 0.52, 0.20) * exp(-abs(d.y - max(elev, 0.01)) * 28.0) * pow(cd, 4.0) * 0.30 * low;
  return outCol * vis;
}
vec3 worldSky(vec3 d) {
  float nightF = 0.5 - 0.5 * cos(uPhase * TAU), ey = max(d.y, 0.0);
  float sunElev = mix(0.24, -0.16, nightF), sunAz = -1.55 + (uPhase - 0.18) * 0.45;
  vec3 sunDir = normalize(vec3(cos(sunAz), sunElev, sin(sunAz)));
  vec3 moonDir = normalize(vec3(cos(sunAz + 0.42), mix(-0.08, 0.36, nightF), sin(sunAz + 0.42)));
  vec3 zen = nightF < 0.5 ? mix(vec3(0.08, 0.20, 0.46), vec3(0.07, 0.06, 0.22), nightF * 2.0) : mix(vec3(0.07, 0.06, 0.22), vec3(0.009, 0.016, 0.052), (nightF - 0.5) * 2.0);
  vec3 hor = nightF < 0.5 ? mix(vec3(0.95, 0.46, 0.18), vec3(0.65, 0.22, 0.38), nightF * 2.0) : mix(vec3(0.65, 0.22, 0.38), vec3(0.04, 0.08, 0.18), (nightF - 0.5) * 2.0);
  vec3 col = mix(hor, zen, pow(ey, 0.46));
  float sunVis = smoothstep(-0.15, 0.08, sunElev), moonVis = smoothstep(0.16, 0.52, nightF);
  col += realisticSun(d, sunDir, 0.036 * uBodySize, sunElev, sunVis);
  col += starfield(d, uTime, 0.986, 200.0) * smoothstep(0.26, 0.80, nightF) * (1.0 - uHaze * 0.5);
  col += nasaMoon(d, moonDir, 0.042 * uBodySize, 1.15 - nightF * 0.45, moonVis);
  if (d.y > 0.005) {
    vec2 cp = d.xz / (d.y + 0.18);
    float c1 = fbm(cp * 0.55 + vec2(uTime * 0.015, uTime * 0.006));
    float c2 = fbm(cp * 1.40 - vec2(uTime * 0.022, -uTime * 0.010) + c1 * 0.85);
    float cloud = smoothstep(0.48 - uHaze * 0.24, 0.84, c1 * 0.65 + c2 * 0.35) * smoothstep(0.005, 0.14, d.y);
    float rim = pow(max(dot(d, sunDir), 0.0), 4.0) * sunVis + pow(max(dot(d, moonDir), 0.0), 5.0) * moonVis * 0.65;
    vec3 cCol = mix(mix(vec3(0.20, 0.12, 0.22), vec3(0.02, 0.035, 0.075), nightF), mix(vec3(1.15, 0.62, 0.30), vec3(0.32, 0.48, 0.76), nightF), clamp(0.22 + 0.52 * c2 + rim * 0.85 + uBass * 0.10, 0.0, 1.0));
    col = mix(col, cCol, cloud * (0.64 + 0.26 * uHaze));
  }
  float az = atan(d.z, d.x), coast = 0.016 + 0.016 * vnoise(vec2(az * 4.0, 3.3));
  col = mix(col, hor * 0.16, smoothstep(coast + 0.004, coast - 0.003, d.y));
  return mix(col, hor * (0.72 + 0.12 * uBass), exp(-abs(d.y) * (14.0 - uHaze * 7.0)) * (0.28 + 0.38 * uHaze));
}
` + FOOTER_GLSL,

  wormhole: COMMON_GLSL + /* glsl */`
vec3 worldSky(vec3 d) {
  float w = 0.5 - 0.5 * cos(uPhase * TAU);
  vec3 axis = normalize(vec3(sin(uTime * 0.12) * 0.18, 0.28 + cos(uTime * 0.09) * 0.10, -0.94));
  vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), axis)), u2 = cross(axis, rt);
  float z = dot(d, axis);
  vec2 xy = vec2(dot(d, rt), dot(d, u2));
  float r = max(length(xy), 0.001), ang = atan(xy.y, xy.x);
  float depth = 1.65 / (r + 0.08) - uTime * 0.42;
  float twist = ang + depth * 0.35 + sin(depth * 0.5 + uTime * 0.25) * 0.45;
  // Seamless periodic angle coordinate (period = 6.0) -> ZERO seam across atan(-PI/+PI)!
  float uAng = fract(twist / TAU) * 6.0;
  vec2 tuv = vec2(uAng, depth * 0.85);
  float n1 = pfbm(tuv + vec2(0.0, uTime * 0.08), 6.0);
  float n2 = pfbm(vec2(uAng * 2.0 - n1 * 1.4, depth * 1.7 - uTime * 0.15), 12.0);
  float ridge = pow(1.0 - abs(sin(depth * 3.4 + n1 * 4.8)), 9.0);
  float wall = pow(smoothstep(0.32, 0.88, n1 * 0.55 + n2 * 0.45), 2.2);
  // Stark TARDIS-vortex palette: ink-black troughs, saturated magenta/plum walls, crisp electric ridge crests
  vec3 cVoid  = vec3(0.002, 0.0008, 0.007);
  vec3 cWall  = mix(vec3(0.34, 0.012, 0.22), vec3(0.10, 0.018, 0.36), w);
  vec3 cRidge = mix(vec3(1.15, 0.14, 0.68), vec3(0.18, 0.58, 1.35), clamp(n2 * 1.15 + w * 0.35, 0.0, 1.0));
  vec3 col = mix(cVoid, cWall, wall * (0.85 + 0.15 * uHaze));
  col += cRidge * ridge * (0.78 + uBass * 0.35);
  float spark = smoothstep(0.90, 0.985, pnoise(vec2(uAng * 8.0, depth * 6.8 + uTime * 0.2), 48.0));
  col += (fract(n1 * 7.0) > 0.5 ? vec3(0.08, 0.82, 1.45) : vec3(1.45, 0.08, 0.52)) * spark * 1.15;
  // Tight, deep electric-blue/violet portal eye (no pale wash across the outer tunnel!)
  col += mix(vec3(0.22, 0.48, 1.45), vec3(0.68, 0.16, 1.35), w) * (pow(max(z, 0.0), 34.0) * 1.45 + pow(max(z, 0.0), 10.0) * 0.12) * (1.0 + uBass * 0.30);
  return col * (0.35 + 0.65 * smoothstep(-0.85, 0.45, z));
}
` + FOOTER_GLSL,

  droste: COMMON_GLSL + /* glsl */`
vec3 worldSky(vec3 d) {
  float w = 0.5 - 0.5 * cos(uPhase * TAU);
  vec3 axis = normalize(vec3(0.0, 0.48, -0.88));
  vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), axis)), u2 = cross(axis, rt);
  vec2 p = vec2(dot(d, rt), dot(d, u2)) / (1.05 + max(dot(d, axis), -0.85));
  float r = max(length(p), 0.0005), a = atan(p.y, p.x);
  float logR = log(r) - uTime * 0.22, spiralA = a + logR * 0.55;
  // Seamless periodic angle coordinate -> ZERO seam across atan(-PI/+PI)!
  float uSp = fract(spiralA / TAU) * 10.0;
  vec2 dp = vec2(fract(logR * 0.45) - 0.5, fract(spiralA / TAU * 2.0) - 0.5);
  float shellFade = sin(fract(logR * 0.45) * PI);
  float g1 = pfbm(vec2(uSp + uTime * 0.05, logR * 1.8 - uTime * 0.08), 10.0);
  float g2 = pfbm(vec2(uSp * 2.0 - g1 * 1.5 - uTime * 0.04, logR * 3.2 + uTime * 0.06), 20.0);
  float arm = pow(0.5 + 0.5 * sin(spiralA * 2.0 + logR * 3.2 + g1 * 3.5), 3.0);
  vec3 cA = mix(vec3(0.12, 0.58, 1.05), vec3(0.95, 0.42, 0.22), w);
  vec3 cB = mix(vec3(0.72, 0.18, 0.92), vec3(0.18, 0.88, 0.76), w);
  vec3 gal = mix(cA, cB, clamp(g2 * 1.1, 0.0, 1.0)) * (arm * 0.75 + g1 * 0.35) * (0.45 + 0.75 * shellFade);
  gal += mix(vec3(1.1, 0.92, 0.75), cB * 1.3, w) * exp(-abs(dp.x) * 14.0) * (0.45 + 0.55 * g2) * 0.55;
  return vec3(0.006, 0.008, 0.022) + gal * (0.95 + uBass * 0.35) * (1.0 - uHaze * 0.22) + starfield(d, uTime, 0.990, 175.0) * 0.9;
}
` + FOOTER_GLSL,

  nebula: COMMON_GLSL + /* glsl */`
float ridged4(vec2 p) {
  float a = 0.0, w = 0.5;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) { float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0); a += w * n * n; p = rot * p * 2.12 + vec2(7.1, 17.3); w *= 0.5; }
  return a;
}
vec3 worldSky(vec3 d) {
  float w = 0.5 - 0.5 * cos(uPhase * TAU);
  float rot = uTime * 0.014, cr = cos(rot), sr = sin(rot);
  vec3 rd = vec3(d.x * cr - d.z * sr, d.y, d.x * sr + d.z * cr);
  vec2 sp = rd.xz / (abs(rd.y) + 0.55);
  vec2 undulate = vec2(sin(uTime * 0.16 + sp.y * 1.5) * 0.24 + cos(uTime * 0.09 - sp.x * 1.1) * 0.14,
                       cos(uTime * 0.13 + sp.x * 1.4) * 0.24 - sin(uTime * 0.11 + sp.y * 1.2) * 0.14);
  vec2 warp = vec2(fbm(sp * 1.20 + undulate + vec2(rd.y * 1.3, uTime * 0.032)),
                   fbm(sp * 1.30 - undulate * 0.8 - vec2(uTime * 0.026, rd.y * 1.1)));
  float baseCloud = fbm(sp * 1.35 + warp * 1.45 + undulate * 0.35);
  float wisps     = ridged4(sp * 2.55 - warp * 1.65 + undulate * 0.55 + vec2(uTime * 0.042, -uTime * 0.030));
  float fineDust  = fbm(sp * 4.60 + warp * 1.80 - undulate * 0.40);

  float bandWave = 0.34 * sin(atan(rd.z, rd.x) * 2.0 + 0.6 + sin(uTime * 0.14) * 0.32);
  float band = exp(-pow((rd.y * 1.45 + bandWave - 0.24), 2.0) * 4.4);
  float pocket = pow(smoothstep(0.46, 0.82, baseCloud), 1.65) * (0.18 + 0.82 * band);

  vec3 cCobalt = vec3(0.04, 0.30, 1.65), cGold = vec3(1.75, 0.58, 0.10), cRose = vec3(1.55, 0.12, 0.68);
  float filHot = pow(clamp(wisps * 1.12, 0.0, 1.0), 3.4) * pocket;
  float filMid = pow(clamp(baseCloud * 1.02, 0.0, 1.0), 2.9) * pocket;
  float darkLane = smoothstep(0.54, 0.78, fineDust) * smoothstep(0.38, 0.74, baseCloud);

  vec3 neb = mix(cCobalt, cGold, smoothstep(0.36, 0.74, warp.x + w * 0.22)) * filMid * 0.95;
  neb += mix(cGold, cRose, smoothstep(0.32, 0.72, warp.y + w * 0.25)) * filHot * 1.95;
  neb += cCobalt * pow(clamp(wisps, 0.0, 1.0), 4.4) * (0.15 + 0.85 * band) * 0.95;
  neb *= (1.0 - darkLane * 0.92);

  vec3 col = vec3(0.0, 0.0, 0.0012) + neb * (1.10 + uBass * 0.36) * (1.08 - uHaze * 0.30);
  col += starfield(d, uTime, 0.994, 155.0) * 1.05;
  vec3 sp3 = d * 28.0, sid = floor(sp3), sf = fract(sp3) - 0.5;
  float sh = hash31(sid);
  if (sh > 0.992) {
    vec3 soff = (vec3(hash31(sid + 5.1), hash31(sid + 13.7), hash31(sid + 29.3)) - 0.5) * 0.20;
    float sd = length(sf - soff), mask = smoothstep(0.24, 0.0, sd);
    float slowGlow = 0.75 + 0.25 * sin(uTime * (0.07 + 0.10 * fract(sh * 51.3)) + sh * 80.0);
    float core = (exp(-sd * 32.0) * 2.1 + exp(-sd * 14.0) * 0.36) * mask * mask * slowGlow;
    col += (fract(sh * 31.7) > 0.45 ? vec3(0.55, 0.82, 1.55) : vec3(1.45, 0.96, 0.62)) * core * smoothstep(0.0, 0.16, d.y);
  }
  return col;
}
` + FOOTER_GLSL,
};

export class SkyDome {
  constructor(renderer, { width = 2048, height = 1024, strips = 4 } = {}) {
    this.renderer = renderer;
    this.w = width;
    this.h = height;
    this.strips = strips;
    this._strip = 0;
    this._forceFull = true;
    this.active = false;
    this._time = 0;
    this._realTime = 0;
    this._bass = 0;
    this._fade = 0;
    this._pendingWorld = null;
    this._groundCache = new Map();
    this._customGroundTex = null;
    this._mats = new Map();
    this._loader = new THREE.TextureLoader();

    this.S = {
      world: 'aurora',
      monolith: false,
      monolithY: 0,
      cycle: 32,
      grade: 'auto',
      ground: 'concrete',
      speed: 'drift',
      bass: true,
      haze: 0.35,
      wet: 0.55,
      phase: 0.18,
      tileScale: 2.4,
      bodySize: 1.0,
    };
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && typeof saved === 'object') {
        if (saved.world === 'terrace' || saved.world === 'monolith') { saved.world = 'aurora'; saved.monolith = true; }
        Object.assign(this.S, saved);
      }
    } catch {}

    this.rt = new THREE.WebGLRenderTarget(this.w, this.h, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.rt.texture.isGenerativeSky = true;

    this._dummyTex = new THREE.DataTexture(new Uint8Array([32, 32, 36, 255]), 1, 1);
    this._dummyTex.needsUpdate = true;

    // Shared uniform objects across all 5 lightweight per-world ShaderMaterials
    this.uniforms = {
      uTime:        { value: 0 },
      uRealTime:    { value: 0 },
      uPhase:       { value: this.S.phase },
      uBass:        { value: 0 },
      uWorld:       { value: this._worldIdx(this.S.world) },
      uGrade:       { value: this._gradeIdx(this.S.grade) },
      uHaze:        { value: this.S.haze },
      uWet:         { value: this.S.wet },
      uCamH:        { value: 1.5 },
      uTileScale:   { value: this.S.tileScale },
      uHasGround:   { value: this.S.ground === 'off' ? -1 : this.S.ground === 'mirror' ? 0 : 1 },
      uHasMoon:     { value: 0 },
      uHasMonolith: { value: 0 },
      uMonolithOn:  { value: this.S.monolith ? 1 : 0 },
      uMonolithY:   { value: this.S.monolithY || 0 },
      uBodySize:    { value: this.S.bodySize || 1.0 },
      uFade:        { value: 0 },
      uGroundMap:   { value: this._dummyTex },
      uMoonMap:     { value: this._dummyTex },
      uMonolithMap: { value: this._dummyTex },
    };

    this._scene = new THREE.Scene();
    this._cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._getMat(this.S.world));
    this._scene.add(this._mesh);

    this._envCanvas = document.createElement('canvas');
    this._envCanvas.width = 32;
    this._envCanvas.height = 16;

    this._moonTex = this._loader.load(MOON_URL, () => {
      this.uniforms.uMoonMap.value = this._moonTex;
      this.uniforms.uHasMoon.value = 1;
      this._forceFull = true;
    });
    this._moonTex.minFilter = THREE.LinearFilter;
    this._moonTex.magFilter = THREE.LinearFilter;
    this._moonTex.colorSpace = THREE.SRGBColorSpace;

    this._monolithTex = this._loader.load(MONOLITH_URL, () => {
      this.uniforms.uMonolithMap.value = this._monolithTex;
      this.uniforms.uHasMonolith.value = 1;
      this._forceFull = true;
    });
    this._monolithTex.wrapS = THREE.RepeatWrapping;
    this._monolithTex.wrapT = THREE.ClampToEdgeWrapping;
    this._monolithTex.minFilter = THREE.LinearFilter;
    this._monolithTex.magFilter = THREE.LinearFilter;
    this._monolithTex.colorSpace = THREE.SRGBColorSpace;

    this._applyGroundTexture();
  }

  get texture() { return this.rt.texture; }

  _getMat(id) {
    const key = WORLD_SHADERS[id] ? id : 'aurora';
    let m = this._mats.get(key);
    if (!m) {
      m = new THREE.ShaderMaterial({
        vertexShader: QUAD_VS,
        fragmentShader: WORLD_SHADERS[key],
        depthTest: false,
        depthWrite: false,
        uniforms: this.uniforms,
      });
      this._mats.set(key, m);
    }
    return m;
  }

  _worldIdx(id) {
    const i = SKY_WORLDS.findIndex(w => w.id === id);
    return i >= 0 ? i : 0;
  }

  _gradeIdx(id) {
    const i = SKY_GRADES.indexOf(id);
    return i >= 0 ? i : 0;
  }

  _speedMul() {
    const s = SKY_SPEEDS.find(x => x.id === this.S.speed);
    return s ? s.mul : 1.0;
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.S)); } catch {} }

  setWorld(id, instant = false) {
    if (!SKY_WORLDS.some(w => w.id === id)) return;
    if (instant || !this.active || this.S.world === id) {
      this.S.world = id;
      this._pendingWorld = null;
      this._fade = 0;
      this.uniforms.uWorld.value = this._worldIdx(id);
      this.uniforms.uFade.value = 0;
      this._mesh.material = this._getMat(id);
      this._forceFull = true;
    } else {
      this._pendingWorld = id;
    }
    this.save();
  }

  set(k, v) {
    this.S[k] = v;
    const u = this.uniforms;
    if (k === 'grade') u.uGrade.value = this._gradeIdx(v);
    if (k === 'haze') u.uHaze.value = v;
    if (k === 'wet') u.uWet.value = v;
    if (k === 'phase') u.uPhase.value = v;
    if (k === 'tileScale') u.uTileScale.value = v;
    if (k === 'monolith') u.uMonolithOn.value = v ? 1 : 0;
    if (k === 'monolithY') u.uMonolithY.value = v || 0;
    if (k === 'bodySize') u.uBodySize.value = v || 1.0;
    if (k === 'ground') this._applyGroundTexture();
    this._forceFull = true;
    this.save();
  }

  cycle(k, list) {
    const i = list.indexOf(this.S[k]);
    const next = list[(i + 1) % list.length];
    this.set(k, next);
    return next;
  }

  setCustomGround(imgOrTex) {
    if (this._customGroundTex) { this._customGroundTex.dispose(); this._customGroundTex = null; }
    if (!imgOrTex) return;
    const tex = imgOrTex.isTexture ? imgOrTex : new THREE.Texture(imgOrTex);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this._customGroundTex = tex;
    this.S.ground = 'custom';
    this._applyGroundTexture();
    this._forceFull = true;
    this.save();
  }

  _applyGroundTexture() {
    const g = this.S.ground, u = this.uniforms;
    if (g === 'off') { u.uHasGround.value = -1; return; }
    if (g === 'mirror') { u.uHasGround.value = 0; return; }
    if (g === 'custom' && this._customGroundTex) { u.uGroundMap.value = this._customGroundTex; u.uHasGround.value = 1; return; }
    const url = GROUND_URLS[g] || GROUND_URLS.concrete;
    if (this._groundCache.has(url)) { u.uGroundMap.value = this._groundCache.get(url); u.uHasGround.value = 1; return; }
    const tex = this._loader.load(url, () => { this._forceFull = true; });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    this._groundCache.set(url, tex);
    u.uGroundMap.value = tex;
    u.uHasGround.value = 1;
  }

  analyticalLight() {
    const ph = this.S.phase, w = 0.5 - 0.5 * Math.cos(ph * Math.PI * 2);
    let keyDir, keyCol, topCol, horCol, botCol;

    if (this.S.world === 'aurora') {
      keyDir = new THREE.Vector3(-0.26, 0.25 + 0.11 * Math.sin(ph * Math.PI * 2), -0.92).normalize();
      keyCol = new THREE.Color().setRGB(0.42 + 0.25 * w, 0.85 - 0.22 * w, 0.78 + 0.18 * w);
      topCol = [12 + 16 * w, 24 - 6 * w, 48 + 16 * w];
      horCol = [28 + 30 * w, 72 - 20 * w, 86 + 18 * w];
      botCol = [14, 22, 28];
    } else if (this.S.world === 'solstice') {
      const sunAz = -1.55 + (ph - 0.18) * 0.45, sunElev = 0.24 * (1 - w) - 0.16 * w;
      if (w < 0.55) {
        keyDir = new THREE.Vector3(Math.cos(sunAz), Math.max(0.14, sunElev), Math.sin(sunAz)).normalize();
        keyCol = new THREE.Color().setRGB(1.0, 0.72 - 0.22 * w, 0.48 - 0.15 * w);
      } else {
        keyDir = new THREE.Vector3(Math.cos(sunAz + 0.42), 0.35, Math.sin(sunAz + 0.42)).normalize();
        keyCol = new THREE.Color().setRGB(0.62, 0.76, 1.0);
      }
      topCol = [48 * (1 - w) + 12 * w, 68 * (1 - w) + 18 * w, 128 * (1 - w) + 46 * w];
      horCol = [220 * (1 - w) + 32 * w, 118 * (1 - w) + 52 * w, 76 * (1 - w) + 96 * w];
      botCol = [34 * (1 - w) + 14 * w, 24 * (1 - w) + 18 * w, 26 * (1 - w) + 28 * w];
    } else if (this.S.world === 'wormhole') {
      keyDir = new THREE.Vector3(0.0, 0.32, -0.94).normalize();
      keyCol = new THREE.Color().setRGB(0.88 * (1 - w) + 0.38 * w, 0.36 * (1 - w) + 0.72 * w, 0.96);
      topCol = [34, 14, 58]; horCol = [132 * (1 - w) + 42 * w, 32 * (1 - w) + 86 * w, 148]; botCol = [18, 12, 32];
    } else if (this.S.world === 'droste') {
      keyDir = new THREE.Vector3(0.0, 0.48, -0.88).normalize();
      keyCol = new THREE.Color().setRGB(0.58 + 0.32 * w, 0.65, 0.98 - 0.25 * w);
      topCol = [18, 26, 56]; horCol = [62 + 65 * w, 78, 138 - 35 * w]; botCol = [14, 18, 32];
    } else {
      keyDir = new THREE.Vector3(0.15, 0.55, -0.82).normalize();
      keyCol = new THREE.Color().setRGB(0.65 + 0.35 * w, 0.52, 1.0);
      topCol = [18, 42, 140]; horCol = [40 + 180 * w, 95 - 30 * w, 255 - 60 * w]; botCol = [12, 14, 34];
    }

    const g = this._envCanvas.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 16);
    gr.addColorStop(0.0, `rgb(${topCol.map(Math.round).join(',')})`);
    gr.addColorStop(0.5, `rgb(${horCol.map(Math.round).join(',')})`);
    gr.addColorStop(1.0, `rgb(${botCol.map(Math.round).join(',')})`);
    g.fillStyle = gr; g.fillRect(0, 0, 32, 16);
    if (this.S.world === 'nebula' || this.S.world === 'wormhole' || this.S.world === 'droste') {
      const blob = (x, y, rad, col) => { const rg = g.createRadialGradient(x, y, 0, x, y, rad); rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(0, 0, 32, 16); };
      if (this.S.world === 'nebula') { blob(8, 5, 7, 'rgba(35,115,255,0.95)'); blob(18, 6, 6, 'rgba(255,120,40,0.90)'); blob(25, 5, 6, 'rgba(235,45,165,0.90)'); }
      else if (this.S.world === 'wormhole') { blob(16, 6, 8, 'rgba(235,75,255,0.95)'); blob(9, 7, 5, 'rgba(45,210,255,0.85)'); }
      else { blob(16, 5, 8, 'rgba(95,180,255,0.90)'); blob(22, 7, 6, 'rgba(220,90,235,0.80)'); }
    }
    return { key: { dir: keyDir, color: keyCol }, canvas: this._envCanvas };
  }

  tick(dt, { bpm = 122, bassPulse = 0, camH = 1.5, visible = true } = {}) {
    if (!this.active || !visible) return false;
    this._time += dt * this._speedMul();
    this._realTime += dt;

    if (this.S.cycle > 0) {
      const b = (bpm > 55 && bpm < 200) ? bpm : 122;
      this.S.phase = (this.S.phase + ((b / 240) / this.S.cycle) * dt) % 1.0;
    }

    const targetBass = this.S.bass ? Math.min(1, bassPulse) : 0;
    this._bass += (targetBass - this._bass) * Math.min(1, dt * (targetBass > this._bass ? 5.0 : 1.4));

    if (this._pendingWorld) {
      this._fade = Math.min(1, this._fade + dt * 1.45);
      this._forceFull = true;
      if (this._fade >= 1) {
        this.S.world = this._pendingWorld;
        this._pendingWorld = null;
        this.uniforms.uWorld.value = this._worldIdx(this.S.world);
        this._mesh.material = this._getMat(this.S.world);
      }
    } else if (this._fade > 0) {
      this._fade = Math.max(0, this._fade - dt * 1.25);
      this._forceFull = true;
    }

    const u = this.uniforms;
    const isNewFrame = this._forceFull || this.strips <= 1 || this._strip === 0;
    if (isNewFrame) {
      u.uTime.value = this._time;
      u.uRealTime.value = this._realTime;
      u.uPhase.value = this.S.phase;
      u.uBass.value = this._bass;
      u.uCamH.value = Math.max(0.4, camH || 1.5);
      u.uFade.value = this._fade * this._fade * (3 - 2 * this._fade);
    }

    const r = this.renderer, prevRT = r.getRenderTarget(), prevXR = r.xr.enabled, prevClear = r.autoClear;
    r.xr.enabled = false; r.autoClear = false;
    if (this._forceFull || this.strips <= 1) {
      this._forceFull = false;
      this.rt.scissorTest = false;
      this.rt.viewport.set(0, 0, this.w, this.h);
      r.setRenderTarget(this.rt);
      r.render(this._scene, this._cam);
    } else {
      const sh = Math.ceil(this.h / this.strips), y0 = this._strip * sh, bh = Math.min(sh, this.h - y0);
      this.rt.scissorTest = true;
      this.rt.scissor.set(0, y0, this.w, bh);
      this.rt.viewport.set(0, 0, this.w, this.h);
      r.setRenderTarget(this.rt);
      r.render(this._scene, this._cam);
      this.rt.scissorTest = false;
      this._strip = (this._strip + 1) % this.strips;
    }
    r.setRenderTarget(prevRT); r.xr.enabled = prevXR; r.autoClear = prevClear;
    return true;
  }

  dispose() {
    this.rt.dispose();
    for (const m of this._mats.values()) m.dispose();
    this._mats.clear();
    this._mesh.geometry.dispose();
    this._dummyTex.dispose();
    if (this._moonTex) this._moonTex.dispose();
    if (this._monolithTex) this._monolithTex.dispose();
    for (const t of this._groundCache.values()) t.dispose();
    this._groundCache.clear();
  }
}
