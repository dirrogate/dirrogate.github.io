// #415 HEADSET CAM AUTO FIT (owner, 19 Oct): Quest Browser gives web pages the passthrough camera only through
// getUserMedia, with no lens data or pose (WebXR 'camera-access' is refused on Quest), so where that camera sits on the
// headset and how wide it sees were guesses (FIT_DEF), and the laser / gear landed a few cm off in HEADSET CAM.
// Calibration: the tablet shows the camera picture with a crosshair at 9 places in turn; the DJ holds a controller so
// its front tip sits on the crosshair (in the picture) and pulls the trigger. Each press gives one pair: the tip's
// position in the headset's own frame (head pose inverse x controller nose) and the pixel. solveCamFit() fits the
// camera's position (mm), tilt / turn / roll and field of view to all pairs (Levenberg-Marquardt, numeric Jacobian),
// starting from the current fit, with a light pull toward it so 9 points can't wander off.
const DEG = Math.PI / 180;

// samples: [{ P: [x, y, z] metres in head frame, px: [x, y] pixels (y down) }], W x H picture, fit: the current FIT values
export function solveCamFit(samples, W, H, fit) {
  const N = samples.length; if (N < 5) return null;
  const x0 = [fit.x / 1000, fit.y / 1000, fit.z / 1000, fit.turn * DEG, fit.tilt * DEG, fit.roll * DEG, Math.log((W / 2) / Math.tan(fit.hfov * DEG / 2))];
  const PW = 150;   // pull toward the starting position: 150 px per metre (3 cm = 4.5 px)
  const cx = W / 2, cy = H / 2, NR = 2 * N + 3;
  const proj = (x, P, out) => {
    const [px, py, pz, yaw, pitch, roll, lf] = x, f = Math.exp(lf);
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    // R = Ry(yaw) Rx(pitch) Rz(roll) (three's Euler 'YXZ'); camera coords = R^T (P - C); the camera looks down -Z, y up
    const r00 = cyw * cr + syw * sp * sr, r01 = -cyw * sr + syw * sp * cr, r02 = syw * cp;
    const r10 = cp * sr, r11 = cp * cr, r12 = -sp;
    const r20 = -syw * cr + cyw * sp * sr, r21 = syw * sr + cyw * sp * cr, r22 = cyw * cp;
    const dx = P[0] - px, dy = P[1] - py, dz = P[2] - pz;
    const X = r00 * dx + r10 * dy + r20 * dz, Y = r01 * dx + r11 * dy + r21 * dz, Z = r02 * dx + r12 * dy + r22 * dz;
    if (Z > -0.02) { out[0] = out[1] = 1e4; return; }
    out[0] = cx + f * X / -Z; out[1] = cy - f * Y / -Z;
  };
  const o = [0, 0];
  const resid = (x, r) => {
    let s = 0;
    for (let i = 0; i < N; i++) { proj(x, samples[i].P, o); r[2 * i] = o[0] - samples[i].px[0]; r[2 * i + 1] = o[1] - samples[i].px[1]; s += r[2 * i] ** 2 + r[2 * i + 1] ** 2; }
    for (let k = 0; k < 3; k++) { const v = (x[k] - x0[k]) * PW; r[2 * N + k] = v; s += v * v; }
    return s;
  };
  let x = x0.slice(), r = new Float64Array(NR), r2 = new Float64Array(NR), cost = resid(x, r), lam = 1e-3;
  const J = Array.from({ length: NR }, () => new Float64Array(7));
  for (let it = 0; it < 80; it++) {
    for (let j = 0; j < 7; j++) { const h = j < 3 ? 1e-4 : 1e-5, xs = x.slice(); xs[j] += h; resid(xs, r2); for (let i = 0; i < NR; i++) J[i][j] = (r2[i] - r[i]) / h; }
    const A = Array.from({ length: 7 }, () => new Float64Array(7)), g = new Float64Array(7);
    for (let i = 0; i < NR; i++) for (let a = 0; a < 7; a++) { g[a] += J[i][a] * r[i]; for (let b = 0; b < 7; b++) A[a][b] += J[i][a] * J[i][b]; }
    let ok = false;
    for (let tries = 0; tries < 8 && !ok; tries++) {
      const M = A.map((row, a) => { const rr = Array.from(row); rr[a] *= 1 + lam; rr[a] += 1e-9; return rr; });
      const dx = solve(M, Array.from(g, v => -v)); if (!dx) { lam *= 10; continue; }
      const xn = x.map((v, i) => v + dx[i]), cn = resid(xn, r2);
      if (cn < cost) { x = xn; cost = cn; r.set(r2); lam = Math.max(1e-7, lam / 3); ok = true; } else lam *= 10;
    }
    if (!ok || cost < 1e-6) break;
  }
  let pc = 0; resid(x, r); for (let i = 0; i < 2 * N; i++) pc += r[i] * r[i];
  const rms = Math.sqrt(pc / N), f = Math.exp(x[6]), hfov = 2 * Math.atan((W / 2) / f) / DEG;
  if (!isFinite(rms) || !(hfov > 30 && hfov < 140)) return null;
  const fitOut = { x: Math.round(x[0] * 1000), y: Math.round(x[1] * 1000), z: Math.round(x[2] * 1000),
    turn: +(x[3] / DEG).toFixed(1), tilt: +(x[4] / DEG).toFixed(1), roll: +(x[5] / DEG).toFixed(1), hfov: +hfov.toFixed(1) };
  return { fit: fitOut, rms, per: samples.map((s, i) => Math.hypot(r[2 * i], r[2 * i + 1])) };
}
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    if (Math.abs(M[p][i]) < 1e-12) return null;
    [M[i], M[p]] = [M[p], M[i]];
    for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
  }
  const xs = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * xs[j]; xs[i] = s / M[i][i]; }
  return xs;
}
// the 9 crosshair places (share of the picture, y down), centre first; NEAR / FAR alternate so depth varies
export const CAL_TARGETS = [[0.5, 0.5, 'near'], [0.2, 0.25, 'far'], [0.8, 0.25, 'near'], [0.8, 0.75, 'far'], [0.2, 0.75, 'near'], [0.5, 0.22, 'far'], [0.82, 0.5, 'near'], [0.5, 0.78, 'far'], [0.18, 0.5, 'near']];
