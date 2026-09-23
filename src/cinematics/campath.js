// Camera path helpers shared by the shots: a keyed spline with C1 timing, framing and FOV fitting.
import * as THREE from 'three';

const DEG = Math.PI / 180;

export const easeInOut = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const easeOut = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) * (1 - t) * (1 - t));
export const easeInOutSine = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * t));

// Fritsch–Carlson monotone cubic through (xs[i], ys[i]). With easeEnds the curve starts and ends at
// rest, so a path driven by it leaves and arrives without a velocity step.
export function monotoneCubic(xs, ys, easeEnds = true) {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const d = new Float64Array(n - 1);
  const m = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]);
  m[0] = easeEnds ? 0 : d[0];
  m[n - 1] = easeEnds ? 0 : d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  return function at(x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// keys: [{ time, pos: Vector3, look: Vector3, fov }] with increasing time. Position and look target
// ride centripetal Catmull–Rom curves in key-index space; time → index is a monotone cubic.
export function createKeyPath(keys) {
  const n = keys.length;
  const pos = new THREE.CatmullRomCurve3(keys.map((k) => k.pos), false, 'centripetal');
  const look = new THREE.CatmullRomCurve3(keys.map((k) => k.look), false, 'centripetal');
  const index = monotoneCubic(keys.map((k) => k.time), keys.map((_, i) => i), true);
  const duration = keys[n - 1].time;
  return {
    duration,
    sample(time, outPos, outLook) {
      const f = Math.min(n - 1, Math.max(0, index(time)));
      const u = n > 1 ? f / (n - 1) : 0;
      pos.getPoint(u, outPos);
      look.getPoint(u, outLook);
      const i = Math.min(n - 2, Math.floor(f));
      if (n < 2) return keys[0].fov;
      const w = easeInOut(f - i);
      return keys[i].fov + (keys[i + 1].fov - keys[i].fov) * w;
    },
  };
}

// Vertical FOV (deg) that keeps at least minHfov (deg) horizontally on narrow screens.
export function fitVfov(aspect, vfov, minHfov) {
  if (!minHfov) return vfov;
  const need = 2 * Math.atan(Math.tan((minHfov * DEG) / 2) / Math.max(0.2, aspect)) / DEG;
  return Math.min(100, Math.max(vfov, need));
}

// The same vertical FOV the chase rig derives from a horizontal one (clamped like camera.js).
export function vfovFromHfov(aspect, hfov, cfg) {
  const v = 2 * Math.atan(Math.tan((hfov * DEG) / 2) / Math.max(0.2, aspect)) / DEG;
  return Math.min(cfg.vfovMax, Math.max(cfg.vfovMin, v));
}

const fw = new THREE.Vector3();
const rt = new THREE.Vector3();
const upv = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

// Look target that puts `subject` at screen NDC (sx, sy) seen from `eye` (small offsets).
export function frameAt(eye, subject, sx, sy, vfovDeg, aspect, out) {
  fw.subVectors(subject, eye);
  const dist = fw.length() || 1;
  fw.multiplyScalar(1 / dist);
  rt.crossVectors(fw, WORLD_UP);
  if (rt.lengthSq() < 1e-8) rt.set(1, 0, 0);
  rt.normalize();
  upv.crossVectors(rt, fw);
  const tv = Math.tan((vfovDeg * DEG) / 2);
  const th = tv * aspect;
  return out.copy(subject).addScaledVector(rt, -sx * th * dist).addScaledVector(upv, -sy * tv * dist);
}

const m4 = new THREE.Matrix4();
export function lookQuaternion(eye, target, out) {
  m4.lookAt(eye, target, WORLD_UP);
  return out.setFromRotationMatrix(m4);
}

// Horizontal unit vector for a heading (ARCHITECTURE §4: forward = (sin h, 0, cos h)).
export function dirOf(h, out) {
  return out.set(Math.sin(h), 0, Math.cos(h));
}
