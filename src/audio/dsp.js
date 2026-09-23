// Shared DSP: seeded noise, JS filters for sample generation, shared noise buffers, reverb impulse.
// Everything here works on any BaseAudioContext, so OfflineAudioContext renders take the same path.

export function prng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// RBJ biquad, direct form I, for generating samples in JS.
export function biquad(type, f, q, sr, gainDb = 0) {
  const w = 2 * Math.PI * Math.min(f, sr * 0.49) / sr;
  const cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lowpass': b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
    case 'highpass': b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
    case 'bandpass': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
    case 'peak': b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; break;
    default: throw new Error('biquad type ' + type);
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

export function filterInPlace(data, type, f, q, sr, gainDb) {
  const bq = biquad(type, f, q, sr, gainDb);
  for (let i = 0; i < data.length; i++) data[i] = bq(data[i]);
  return data;
}

export function normalize(data, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > m) m = a; }
  if (m > 0) { const k = peak / m; for (let i = 0; i < data.length; i++) data[i] *= k; }
  return data;
}

export function fadeEdges(data, sr, inSec = 0.0005, outSec = 0.03) {
  const ni = Math.min(data.length, Math.floor(inSec * sr));
  for (let i = 0; i < ni; i++) data[i] *= i / ni;
  const no = Math.min(data.length, Math.floor(outSec * sr));
  for (let i = 0; i < no; i++) data[data.length - 1 - i] *= i / no;
  return data;
}

export function toBuffer(ctx, channels, sr = ctx.sampleRate) {
  const chs = Array.isArray(channels) ? channels : [channels];
  const buf = ctx.createBuffer(chs.length, chs[0].length, sr);
  for (let c = 0; c < chs.length; c++) buf.copyToChannel(chs[c], c);
  return buf;
}

function genNoise(n, rnd, color) {
  const d = new Float32Array(n);
  if (color === 'white') {
    for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
  } else if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.02 * (rnd() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  }
  return d;
}

// Paper crumple: clustered, heavy-tailed micro-crackles over a faint hiss.
function genCrackle(n, sr, rnd, density) {
  const d = new Float32Array(n);
  const hp = biquad('highpass', 900, 0.7, sr);
  let i = 0;
  while (i < n) {
    const cluster = rnd() < 0.18;
    const gap = Math.floor(sr / density * (cluster ? 0.15 : 1) * (0.2 + rnd() * 1.6));
    i += Math.max(8, gap);
    if (i >= n) break;
    const len = Math.floor(sr * (0.0006 + rnd() * 0.004));
    const dec = Math.exp(-1 / (len * 0.35));
    let amp = Math.pow(rnd(), 2.2) * (0.3 + 0.7 * rnd());
    for (let k = 0; k < len && i + k < n; k++) { d[i + k] += amp * (rnd() * 2 - 1); amp *= dec; }
  }
  for (let k = 0; k < n; k++) d[k] = hp(d[k] + (rnd() * 2 - 1) * 0.01);
  return normalize(d, 0.95);
}

// Stereo room tail: decaying noise that darkens over time, with a few early reflections.
function genImpulse(sr, seconds, rnd) {
  const n = Math.floor(sr * seconds);
  const out = [];
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(n);
    const dec = Math.exp(-6.9 / (seconds * 0.85 * sr));
    const attack = 0.012 * sr;
    let lp = 0, env = 1;
    for (let i = 0; i < n; i++) {
      const coef = 0.9 - 0.75 * (i / n);
      lp = lp + coef * ((rnd() * 2 - 1) - lp);
      d[i] = lp * env * (i < attack ? i / attack : 1);
      env *= dec;
    }
    const taps = [0.011, 0.017, 0.023, 0.031, 0.043];
    let e = 0;
    for (let i = 0; i < n; i++) e += d[i] * d[i];
    const tapAmp = Math.sqrt(e) * 0.12;
    for (let k = 0; k < taps.length; k++) {
      const at = Math.floor((taps[k] + c * 0.0027) * sr);
      if (at < n) d[at] += (rnd() < 0.5 ? -1 : 1) * tapAmp * (1 - k * 0.15);
    }
    // Unit energy: a convolver fed with an un-normalized noise tail adds ~20 dB on sustained tones.
    e = 0;
    for (let i = 0; i < n; i++) e += d[i] * d[i];
    const k = 1 / Math.sqrt(e);
    for (let i = 0; i < n; i++) d[i] *= k;
    out.push(d);
  }
  return out;
}

// Shared per-context noise bank: built once per context, reused by every voice.
export function createBank(ctx) {
  const sr = ctx.sampleRate;
  const rnd = prng(0x51a7);
  const len = Math.floor(sr * 2);
  return {
    white: toBuffer(ctx, genNoise(len, rnd, 'white')),
    pink: toBuffer(ctx, normalize(genNoise(len, rnd, 'pink'), 0.9)),
    brown: toBuffer(ctx, normalize(genNoise(len, rnd, 'brown'), 0.9)),
    crackle: toBuffer(ctx, genCrackle(Math.floor(sr * 2.2), sr, rnd, 260)),
    crumple: toBuffer(ctx, genCrackle(Math.floor(sr * 1.5), sr, rnd, 1400)),
    impulse: toBuffer(ctx, genImpulse(sr, 2.2, rnd)),
  };
}
