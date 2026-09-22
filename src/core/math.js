// Axis conventions (ARCHITECTURE.md §4): forward (sin h, 0, cos h), right (-cos h, 0, sin h).
// Increasing h turns left; controls.steer = +1 steers right (decreases h).

export const TAU = Math.PI * 2;

export function forwardOf(h, out) {
  out.x = Math.sin(h); out.y = 0; out.z = Math.cos(h);
  return out;
}

export function rightOf(h, out) {
  out.x = -Math.cos(h); out.y = 0; out.z = Math.sin(h);
  return out;
}

export function headingOf(v) {
  return Math.atan2(v.x, v.z);
}

export function headingOfXZ(x, z) {
  return Math.atan2(x, z);
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function invLerp(a, b, v) {
  return a === b ? 0 : (v - a) / (b - a);
}

export function smoothstep(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function angleDiff(to, from) {
  return wrapAngle(to - from);
}

export function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

// Frame-rate independent exponential smoothing by half-life (seconds).
export function damp(current, target, halfLife, dt) {
  if (halfLife <= 0) return target;
  return target + (current - target) * Math.pow(2, -dt / halfLife);
}

export function dampAngle(current, target, halfLife, dt) {
  if (halfLife <= 0) return target;
  return target - wrapAngle(target - current) * Math.pow(2, -dt / halfLife);
}

export function dampFactor(halfLife, dt) {
  return halfLife <= 0 ? 1 : 1 - Math.pow(2, -dt / halfLife);
}

export function approach(current, target, maxDelta) {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

export function sign(v) {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

export function wrap01(t) {
  t = t % 1;
  return t < 0 ? t + 1 : t;
}
