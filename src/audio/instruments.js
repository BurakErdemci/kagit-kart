// Instruments: sample banks computed in JS on first use (plucks, tines, bells, electric piano, drums)
// and oscillator voices built per note (whistle, ney, horn, brass, pad, pulse bass).
// A sampled note is one BufferSource + one Gain, so a busy arrangement stays cheap.
import { prng, midiHz, biquad, filterInPlace, normalize, fadeEdges, toBuffer } from './dsp.js';

const TAU = Math.PI * 2;

// Karplus–Strong string. The loop's averaging filter adds `s` samples of delay, compensated in hz.
function ks(f, sr, n, rnd, o) {
  const s = o.stretch ?? 0.5;
  const N = Math.max(2, Math.round(sr / f - s));
  const hz = sr / (N + s);
  const exc = new Float32Array(N);
  let lp = 0;
  const b = o.bright ?? 0.5;
  for (let i = 0; i < N; i++) { lp += ((rnd() * 2 - 1) - lp) * (0.08 + 0.92 * b); exc[i] = lp; }
  const pk = Math.max(1, Math.round((o.pick ?? 0.15) * N));
  let mean = 0;
  for (let i = N - 1; i >= 0; i--) { exc[i] -= i >= pk ? exc[i - pk] : 0; mean += exc[i]; }
  mean /= N;
  const out = new Float32Array(n);
  const g = Math.pow(10, -3 / ((o.t60 ?? 1.5) * hz));
  for (let i = 0; i < n; i++) {
    const x = i < N ? exc[i] - mean : 0;
    const y1 = i >= N ? out[i - N] : 0;
    const y2 = i >= N + 1 ? out[i - N - 1] : 0;
    out[i] = x + g * ((1 - s) * y1 + s * y2);
  }
  return { data: out, hz };
}

function strings(courses) {
  return (f, sr, n, rnd, o) => {
    const acc = new Float32Array(n);
    let hz = 0;
    courses.forEach((det, i) => {
      const r = ks(f * det, sr, n, rnd, o);
      if (i === 0) hz = r.hz;
      const off = Math.floor(i * 0.004 * sr);
      for (let k = 0; k + off < n; k++) acc[k + off] += r.data[k] * (i === 0 ? 1 : 0.7);
    });
    if (o.body) for (const [ft, fq, fq2, db] of o.body) filterInPlace(acc, ft, fq, fq2, sr, db);
    return { data: acc, hz };
  };
}

// Exponentially decaying sine by phasor rotation (no per-sample sin/exp), added into d.
function addSine(d, f, amp, tau, ph, sr) {
  const w = TAU * f / sr, dec = Math.exp(-1 / (tau * sr));
  const cd = Math.cos(w) * dec, sd = Math.sin(w) * dec;
  let x = Math.cos(ph) * amp, y = Math.sin(ph) * amp;
  for (let i = 0; i < d.length; i++) {
    d[i] += y;
    const nx = x * cd - y * sd;
    y = x * sd + y * cd;
    x = nx;
    if ((i & 1023) === 0 && Math.abs(x) + Math.abs(y) < 1e-5 * amp) break;
  }
}

function additive(partials) {
  return (f, sr, n, rnd, o) => {
    const d = new Float32Array(n);
    const tauBase = (o.tau ?? 2) * Math.pow((o.ref ?? 523) / f, o.tauExp ?? 0.35);
    for (const [ratio, amp, tauK, beat] of partials) {
      const pf = f * ratio;
      if (pf > sr * 0.45) continue;
      const tau = tauBase * tauK;
      addSine(d, pf, amp * (beat ? 0.6 : 1), tau, rnd() * TAU, sr);
      if (beat) addSine(d, pf + beat, amp * 0.4, tau, rnd() * TAU, sr);
    }
    const click = Math.floor(sr * 0.004);
    for (let i = 0; i < click; i++) d[i] += (o.click ?? 0.2) * (rnd() * 2 - 1) * Math.exp(-i / (sr * 0.0007));
    for (let i = 0; i < n; i++) d[i] *= Math.min(1, i / (sr * 0.0012));
    return { data: d, hz: f };
  };
}

function fmBell(o) {
  return (f, sr, n) => {
    const d = new Float32Array(n);
    const tau = (o.tau ?? 1.6) * Math.pow(261 / f, o.tauExp ?? 0.3);
    const hi = o.tine && f * o.tine < sr * 0.45;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const I = o.i0 * Math.exp(-t / o.iTau) + o.i1;
      let v = Math.sin(TAU * f * t + I * Math.sin(TAU * f * o.ratio * t));
      if (hi) v += o.tineAmp * Math.exp(-t / 0.018) * Math.sin(TAU * f * o.tine * t);
      if (o.h2) v += o.h2 * Math.exp(-t / (tau * 0.5)) * Math.sin(TAU * 2 * f * t);
      d[i] = v * Math.exp(-t / tau) * Math.min(1, t / 0.0025);
    }
    return { data: d, hz: f };
  };
}

const SAMPLED = {
  musicbox: {
    bases: [60, 72, 84, 96], dur: 2.8, ring: 1.4, gain: 0.5,
    gen: additive([[1, 1, 1, 0.45], [2, 0.07, 0.4], [3.01, 0.035, 0.12], [5.93, 0.22, 0.05]]),
    opt: { tau: 1.7, click: 0.3 },
  },
  bell: {
    bases: [60, 72, 84, 96], dur: 3.4, ring: 2.2, gain: 0.42,
    gen: additive([[1, 1, 1, 0.6], [2.756, 0.38, 0.33], [5.404, 0.17, 0.15], [8.933, 0.07, 0.08]]),
    opt: { tau: 2.1, tauExp: 0.4, click: 0.12 },
  },
  glass: {
    bases: [60, 72, 84, 96], dur: 2.4, ring: 1.2, gain: 0.34,
    gen: fmBell({ ratio: 3.5, i0: 2.0, iTau: 0.2, i1: 0.25, tau: 1.3, h2: 0.25 }),
  },
  epiano: {
    bases: [48, 60, 72, 84], dur: 3.2, ring: 0.35, gain: 0.5,
    gen: fmBell({ ratio: 1, i0: 1.25, iTau: 0.3, i1: 0.3, tau: 2.2, tine: 7.1, tineAmp: 0.16 }),
  },
  pluck: {
    bases: [43, 55, 67, 79], dur: 2.2, ring: 0.8, gain: 0.55,
    gen: strings([1]),
    opt: { t60: 1.6, bright: 0.55, pick: 0.18, body: [['peak', 190, 1.4, 4], ['lowpass', 6000, 0.7]] },
  },
  mandolin: {
    bases: [55, 67, 79, 91], dur: 1.8, ring: 0.6, gain: 0.5,
    gen: strings([1, 1.0028]),
    opt: { t60: 0.95, bright: 0.85, pick: 0.11, body: [['peak', 420, 1.2, 3], ['highpass', 160, 0.7]] },
  },
  kanun: {
    bases: [50, 62, 74, 86], dur: 2.4, ring: 1.0, gain: 0.5,
    gen: strings([1, 1.0019, 0.9984]),
    opt: { t60: 2.0, bright: 0.92, pick: 0.07, body: [['highpass', 180, 0.7], ['peak', 2600, 1.5, 3]] },
  },
  oud: {
    bases: [38, 50, 62, 74], dur: 2.0, ring: 0.7, gain: 0.55,
    gen: strings([1, 1.0021]),
    opt: { t60: 1.3, bright: 0.42, pick: 0.22, body: [['peak', 240, 1.3, 5], ['lowpass', 3600, 0.7]] },
  },
  harp: {
    bases: [48, 60, 72, 84], dur: 2.6, ring: 1.4, gain: 0.5,
    gen: strings([1]),
    opt: { t60: 2.4, bright: 0.45, pick: 0.5, stretch: 0.45, body: [['lowpass', 5000, 0.7]] },
  },
  bass: {
    bases: [28, 40, 52], dur: 2.0, ring: 0.09, gain: 0.8,
    gen: strings([1]),
    opt: { t60: 1.2, bright: 0.28, pick: 0.28, body: [['peak', 95, 1.2, 4], ['lowpass', 1400, 0.7]] },
  },
};

function drumGen(name, sr, rnd) {
  const dur = { kick: 0.5, snare: 0.35, brush: 0.25, swish: 0.4, hat: 0.12, ohat: 0.6, shaker: 0.16, tamb: 0.4,
    clap: 0.32, doum: 0.75, tek: 0.2, ka: 0.16, zil: 1.7, bendir: 0.6, rim: 0.1, pencil: 0.14, snap: 0.12,
    tick: 0.07, crash: 2.4, tri: 1.6, wood: 0.12, typebell: 1.3, tom: 0.5 }[name];
  const n = Math.floor(sr * dur);
  const d = new Float32Array(n);
  const N = () => rnd() * 2 - 1;
  const sin = (f, t) => Math.sin(TAU * f * t);
  let peak = 0.9;
  switch (name) {
    case 'kick': {
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += TAU * (46 + 105 * Math.exp(-t / 0.035)) / sr;
        d[i] = Math.sin(ph) * Math.exp(-t / 0.2) + 0.3 * N() * Math.exp(-t / 0.0015);
      }
      break;
    }
    case 'snare': {
      const hp = biquad('highpass', 1400, 0.7, sr), lp = biquad('lowpass', 9000, 0.7, sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = 0.55 * sin(188, t) * Math.exp(-t / 0.06) + lp(hp(N())) * Math.exp(-t / 0.12);
      }
      break;
    }
    case 'brush': case 'swish': {
      const bp = biquad('bandpass', name === 'brush' ? 5200 : 4200, 0.8, sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const e = name === 'brush' ? Math.min(1, t / 0.003) * Math.exp(-t / 0.06)
          : Math.sin(Math.PI * Math.min(1, t / 0.36)) ** 2;
        d[i] = bp(N()) * e;
      }
      peak = name === 'brush' ? 0.7 : 0.45;
      break;
    }
    case 'hat': case 'ohat': {
      const h1 = biquad('highpass', 7000, 0.8, sr), h2 = biquad('highpass', 7000, 0.8, sr);
      const tau = name === 'hat' ? 0.022 : 0.26;
      for (let i = 0; i < n; i++) d[i] = h2(h1(N())) * Math.exp(-i / sr / tau);
      peak = 0.6;
      break;
    }
    case 'shaker': {
      const bp = biquad('bandpass', 6500, 1.1, sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = bp(N()) * Math.min(1, t / 0.014) * Math.exp(-Math.max(0, t - 0.014) / 0.045);
      }
      peak = 0.5;
      break;
    }
    case 'tamb': {
      const fs = Array.from({ length: 9 }, () => 4200 + rnd() * 5200);
      const hits = [0, 0.006, 0.014];
      const hp = biquad('highpass', 6000, 0.7, sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let v = 0;
        for (let k = 0; k < fs.length; k++) v += sin(fs[k], t + k * 0.001) * Math.exp(-t / (0.07 + 0.012 * k));
        let h = 0;
        for (const ht of hits) if (t >= ht) h += Math.exp(-(t - ht) / 0.03);
        d[i] = v * 0.12 * (0.3 + h) + 0.25 * hp(N()) * Math.exp(-t / 0.05);
      }
      peak = 0.55;
      break;
    }
    case 'clap': {
      const bp = biquad('bandpass', 1400, 1.1, sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let e = 0;
        for (const ht of [0, 0.011, 0.022]) if (t >= ht) e = Math.max(e, Math.exp(-(t - ht) / 0.005));
        if (t > 0.028) e = Math.max(e, 0.6 * Math.exp(-(t - 0.028) / 0.08));
        d[i] = bp(N()) * e;
      }
      break;
    }
    case 'doum': {
      const lp = biquad('lowpass', 800, 0.7, sr);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += TAU * (84 + 26 * Math.exp(-t / 0.03)) / sr;
        d[i] = Math.sin(ph) * Math.exp(-t / 0.34) + 0.22 * Math.sin(ph * 1.59) * Math.exp(-t / 0.1) +
          0.35 * lp(N()) * Math.exp(-t / 0.008);
      }
      break;
    }
    case 'tek': case 'ka': {
      const hp = biquad(name === 'tek' ? 'highpass' : 'bandpass', name === 'tek' ? 3000 : 2200, 0.9, sr);
      const soft = name === 'ka' ? 0.8 : 1;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = 0.8 * hp(N()) * Math.exp(-t / (0.005 * soft)) +
          0.5 * sin(780 * soft, t) * Math.exp(-t / 0.032) +
          0.32 * sin(1640 * soft, t) * Math.exp(-t / 0.018) +
          (name === 'tek' ? 0.22 * sin(2950, t) * Math.exp(-t / 0.011) : 0);
      }
      peak = name === 'tek' ? 0.85 : 0.5;
      break;
    }
    case 'zil': case 'tri': case 'typebell': {
      const P = name === 'zil' ? [[2090, 1, 1.0], [3215, 0.7, 0.75], [4480, 0.5, 0.55], [5890, 0.33, 0.4], [7350, 0.2, 0.3]]
        : name === 'tri' ? [[3100, 1, 1.2], [4380, 0.6, 0.9], [6510, 0.4, 0.6], [8990, 0.25, 0.4]]
          : [[2240, 1, 0.8], [5390, 0.45, 0.25], [8700, 0.2, 0.09]];
      for (const [f, a, tau] of P) {
        if (f > sr * 0.45) continue;
        const ph = rnd() * TAU;
        for (let i = 0; i < n; i++) {
          const t = i / sr;
          d[i] += a * Math.exp(-t / tau) * (Math.sin(TAU * f * t + ph) + 0.5 * Math.sin(TAU * (f + 3.1) * t));
        }
      }
      for (let i = 0; i < 80; i++) d[i] += 0.4 * N() * Math.exp(-i / 20);
      peak = name === 'typebell' ? 0.7 : 0.55;
      break;
    }
    case 'bendir': case 'tom': {
      const bp = biquad('bandpass', 1800, 0.9, sr);
      const f0 = name === 'bendir' ? 66 : 132;
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += TAU * (f0 + f0 * 0.35 * Math.exp(-t / 0.025)) / sr;
        d[i] = Math.sin(ph) * Math.exp(-t / 0.26) + (name === 'bendir' ? 0.28 * bp(N()) * Math.exp(-t / 0.16) : 0.1 * N() * Math.exp(-t / 0.01));
      }
      break;
    }
    case 'rim': case 'wood': case 'pencil': case 'tick': case 'snap': {
      const spec = {
        rim: [1700, 0.01, 480, 0.02, 0.5, 3200],
        wood: [950, 0.03, 2400, 0.008, 0.2, 2000],
        pencil: [1250, 0.016, 330, 0.03, 0.9, 2600],
        tick: [3600, 0.014, 7200, 0.004, 0.3, 6000],
        snap: [1100, 0.01, 2900, 0.006, 1.2, 2800],
      }[name];
      const bp = biquad('bandpass', spec[5], 2.5, sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = sin(spec[0], t) * Math.exp(-t / spec[1]) + 0.45 * sin(spec[2], t) * Math.exp(-t / spec[3]) +
          spec[4] * bp(N()) * Math.exp(-t / 0.004);
      }
      peak = name === 'tick' ? 0.5 : 0.8;
      break;
    }
    case 'crash': {
      const hp = biquad('highpass', 3200, 0.7, sr), pk = biquad('peak', 5200, 1.2, sr, 6);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = pk(hp(N())) * Math.min(1, t / 0.004) * Math.exp(-t / 0.75);
      }
      peak = 0.55;
      break;
    }
    default: throw new Error('drum ' + name);
  }
  fadeEdges(d, sr, 0.0002, Math.min(0.05, dur * 0.2));
  return normalize(d, peak);
}

// ---- oscillator voices ----------------------------------------------------------------------------

function mk(ctx, type, f) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  return o;
}

function noiseSrc(ctx, buf, t, rnd) {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.start(t, rnd() * (buf.duration - 0.5));
  return s;
}

function vibrato(ctx, rate, cents, t, delay, targets) {
  const l = ctx.createOscillator();
  l.frequency.value = rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.setValueAtTime(0, t + delay);
  g.gain.linearRampToValueAtTime(cents, t + delay + 0.25);
  l.connect(g);
  for (const p of targets) g.connect(p);
  l.start(t);
  return l;
}

const VOICES = {
  whistle(ctx, out, f, t, dur, v, B, rnd) {
    const env = ctx.createGain();
    const o1 = mk(ctx, 'sine', f), o2 = mk(ctx, 'triangle', f * 2);
    const g2 = ctx.createGain(); g2.gain.value = 0.06;
    const n = noiseSrc(ctx, B.white, t, rnd);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 6;
    const ng = ctx.createGain(); ng.gain.value = 0.1;
    o1.connect(env); o2.connect(g2).connect(env); n.connect(bp).connect(ng).connect(env);
    o1.detune.setValueAtTime(-50, t); o1.detune.linearRampToValueAtTime(0, t + 0.045);
    const l = vibrato(ctx, 5.4, 16, t, Math.min(0.3, dur * 0.5), [o1.detune, o2.detune]);
    const end = t + dur;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(v * 0.9, t + 0.02);
    env.gain.linearRampToValueAtTime(v * 0.7, t + 0.09);
    env.gain.setValueAtTime(v * 0.7, end);
    env.gain.linearRampToValueAtTime(0, end + 0.06);
    env.connect(out);
    for (const s of [o1, o2, l]) { if (s !== l) s.start(t); s.stop(end + 0.08); }
    n.stop(end + 0.08);
    return end + 0.08;
  },

  ney(ctx, out, f, t, dur, v, B, rnd) {
    const env = ctx.createGain();
    const o1 = mk(ctx, 'sine', f), o2 = mk(ctx, 'sine', f * 2), o3 = mk(ctx, 'sine', f * 3);
    const g2 = ctx.createGain(); g2.gain.value = 0.14;
    const g3 = ctx.createGain(); g3.gain.value = 0.05;
    const n = noiseSrc(ctx, B.white, t, rnd);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 3.5;
    const ng = ctx.createGain(); ng.gain.value = 0.55;
    o1.connect(env); o2.connect(g2).connect(env); o3.connect(g3).connect(env); n.connect(bp).connect(ng).connect(env);
    for (const o of [o1, o2, o3]) { o.detune.setValueAtTime(-40, t); o.detune.linearRampToValueAtTime(0, t + 0.14); }
    const l = vibrato(ctx, 4.7, 22, t, Math.min(0.35, dur * 0.4), [o1.detune, o2.detune, o3.detune]);
    const end = t + dur;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(v * 0.75, t + 0.1);
    env.gain.setValueAtTime(v * 0.75, end);
    env.gain.linearRampToValueAtTime(0, end + 0.18);
    env.connect(out);
    for (const o of [o1, o2, o3]) { o.start(t); o.stop(end + 0.2); }
    l.stop(end + 0.2); n.stop(end + 0.2);
    return end + 0.2;
  },

  horn(ctx, out, f, t, dur, v) {
    const env = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 280 + f * 1.6; lp.Q.value = 1.1;
    const oscs = [mk(ctx, 'sawtooth', f), mk(ctx, 'sawtooth', f * 1.0045), mk(ctx, 'square', f * 0.5)];
    const gs = [0.5, 0.5, 0.35];
    oscs.forEach((o, i) => {
      const g = ctx.createGain(); g.gain.value = gs[i];
      o.connect(g).connect(lp);
      o.detune.setValueAtTime(-90, t); o.detune.exponentialRampToValueAtTime(-1, t + 0.35);
    });
    lp.connect(env);
    const trem = ctx.createOscillator(); trem.frequency.value = 3.6;
    const tg = ctx.createGain(); tg.gain.value = v * 0.06;
    trem.connect(tg).connect(env.gain);
    const end = t + dur;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(v * 0.8, t + 0.28);
    env.gain.setValueAtTime(v * 0.8, end);
    env.gain.linearRampToValueAtTime(0, end + 0.6);
    env.connect(out);
    for (const o of [...oscs, trem]) { o.start(t); o.stop(end + 0.62); }
    return end + 0.62;
  },

  brass(ctx, out, f, t, dur, v) {
    const env = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.4;
    lp.frequency.setValueAtTime(f * 1.5, t);
    lp.frequency.linearRampToValueAtTime(Math.min(12000, f * 7 * (0.6 + 0.4 * v)), t + 0.04);
    lp.frequency.setTargetAtTime(f * 3.5, t + 0.05, 0.15);
    const o1 = mk(ctx, 'sawtooth', f), o2 = mk(ctx, 'sawtooth', f * 1.003);
    o1.connect(lp); o2.connect(lp); lp.connect(env);
    const l = vibrato(ctx, 5.6, 9, t, 0.22, [o1.detune, o2.detune]);
    const end = t + dur;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(v * 0.55, t + 0.025);
    env.gain.linearRampToValueAtTime(v * 0.42, t + 0.12);
    env.gain.setValueAtTime(v * 0.42, end);
    env.gain.linearRampToValueAtTime(0, end + 0.12);
    env.connect(out);
    for (const o of [o1, o2]) { o.start(t); o.stop(end + 0.14); }
    l.stop(end + 0.14);
    return end + 0.14;
  },

  pad(ctx, out, f, t, dur, v) {
    const env = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(2400, 500 + f * 2.2); lp.Q.value = 0.5;
    const o1 = mk(ctx, 'sawtooth', f), o2 = mk(ctx, 'sawtooth', f), o3 = mk(ctx, 'triangle', f * 0.5);
    o1.detune.value = -8; o2.detune.value = 8;
    const g3 = ctx.createGain(); g3.gain.value = 0.6;
    o1.connect(lp); o2.connect(lp); o3.connect(g3).connect(lp); lp.connect(env);
    const end = t + dur;
    const a = Math.min(0.6, dur * 0.4);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(v * 0.22, t + a);
    env.gain.setValueAtTime(v * 0.22, end);
    env.gain.linearRampToValueAtTime(0, end + 0.9);
    env.connect(out);
    for (const o of [o1, o2, o3]) { o.start(t); o.stop(end + 0.95); }
    return end + 0.95;
  },

  pulse(ctx, out, f, t, dur, v) {
    const env = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
    lp.frequency.setValueAtTime(f * 9, t);
    lp.frequency.exponentialRampToValueAtTime(f * 2.2, t + 0.14);
    const o1 = mk(ctx, 'sawtooth', f), o2 = mk(ctx, 'sine', f);
    const g2 = ctx.createGain(); g2.gain.value = 0.7;
    o1.connect(lp); o2.connect(g2).connect(env); lp.connect(env);
    const end = t + dur;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(v * 0.6, t + 0.004);
    env.gain.setTargetAtTime(v * 0.4, t + 0.01, 0.08);
    env.gain.setValueAtTime(v * 0.4, end);
    env.gain.linearRampToValueAtTime(0, end + 0.04);
    env.connect(out);
    for (const o of [o1, o2]) { o.start(t); o.stop(end + 0.05); }
    return end + 0.05;
  },
};

export function createInstruments(ctx, bank) {
  const sr = ctx.sampleRate;
  const sampled = new Map();
  const drums = new Map();
  const rnd = prng(0xb00c);

  function ensureSampled(name) {
    let e = sampled.get(name);
    if (e) return e;
    const def = SAMPLED[name];
    const r = prng(0x1000 + name.length * 977 + name.charCodeAt(0));
    const n = Math.floor(def.dur * sr);
    e = def.bases.map((m) => {
      const res = def.gen(midiHz(m), sr, n, r, def.opt || {});
      fadeEdges(res.data, sr, 0.0002, 0.08);
      normalize(res.data, 0.9);
      return { midi: m, hz: res.hz, buffer: toBuffer(ctx, res.data) };
    });
    sampled.set(name, e);
    return e;
  }

  function ensureDrum(name) {
    let b = drums.get(name);
    if (!b) { b = toBuffer(ctx, drumGen(name, sr, prng(0x2000 + name.charCodeAt(0) * 31 + name.length))); drums.set(name, b); }
    return b;
  }

  function prepare(names) {
    for (const nm of names) {
      if (SAMPLED[nm]) ensureSampled(nm);
    }
  }

  function prepareDrums(names) {
    for (const nm of names) ensureDrum(nm);
  }

  // Returns the time the voice ends.
  function play(name, out, midi, t, dur, vel, ring) {
    const f = midiHz(midi);
    if (VOICES[name]) return VOICES[name](ctx, out, f, t, dur, vel, bank, rnd);
    const def = SAMPLED[name];
    if (!def) return t;
    const bases = ensureSampled(name);
    let b = bases[0];
    for (let i = 1; i < bases.length; i++) if (bases[i].midi <= midi + 5) b = bases[i];
    const rate = f / b.hz;
    const src = ctx.createBufferSource();
    src.buffer = b.buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    const lvl = vel * def.gain;
    g.gain.value = lvl;
    const natural = b.buffer.duration / rate;
    const r = ring ?? def.ring;
    let end = Math.min(natural, dur + r);
    if (end < natural) {
      g.gain.setValueAtTime(lvl, t + end - 0.04);
      g.gain.linearRampToValueAtTime(0, t + end);
    }
    src.connect(g);
    g.connect(out);
    src.start(t);
    src.stop(t + end + 0.01);
    return t + end;
  }

  function drum(name, out, t, vel, rate = 1) {
    const src = ctx.createBufferSource();
    src.buffer = ensureDrum(name);
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = vel;
    src.connect(g);
    g.connect(out);
    src.start(t);
    return t + src.buffer.duration / rate;
  }

  return { play, drum, prepare, prepareDrums, isVoice: (n) => !!VOICES[n], has: (n) => !!(VOICES[n] || SAMPLED[n]) };
}
