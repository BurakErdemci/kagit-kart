// Sound effects, all paper and stationery: pen clicks, crumples, snips, stamp thuds, page flips.
// Each recipe builds short-lived nodes at time t into `out` and returns its length in seconds.
// Recipes take the same path live and in OfflineAudioContext renders.

function kit(ctx, out, B, rnd) {
  return {
    noise(t, dur, buf = 'white', rate = 1) {
      const s = ctx.createBufferSource();
      s.buffer = B[buf];
      s.loop = true;
      s.playbackRate.value = rate;
      s.start(t, rnd() * (s.buffer.duration - 0.8));
      s.stop(t + dur);
      return s;
    },
    osc(type, f, t, dur) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.start(t);
      o.stop(t + dur);
      return o;
    },
    filter(type, f, q = 0.8) {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    },
    // Linear attack to `peak`, optional hold, then exponential decay (time constant tau).
    amp(t, a, peak, tau, hold = 0, dest = out) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      if (hold) g.gain.setValueAtTime(peak, t + a + hold);
      g.gain.setTargetAtTime(0, t + a + hold, tau);
      g.connect(dest);
      return g;
    },
    sweep(param, t, from, to, dur) {
      param.setValueAtTime(from, t);
      param.exponentialRampToValueAtTime(to, t + dur);
    },
  };
}

// Pitched blip: sine + a quieter octave triangle.
function ping(k, t, f, peak, tau, dur = tau * 6) {
  k.osc('sine', f, t, dur).connect(k.amp(t, 0.002, peak, tau));
  k.osc('triangle', f * 2, t, dur).connect(k.amp(t, 0.002, peak * 0.18, tau * 0.7));
}

function thud(k, t, f0, f1, peak, tau) {
  const o = k.osc('sine', f0, t, tau * 7);
  k.sweep(o.frequency, t, f0, f1, tau * 1.4);
  o.connect(k.amp(t, 0.003, peak, tau));
}

function snip(k, t, peak) {
  k.noise(t, 0.05).connect(k.filter('highpass', 5200, 0.7)).connect(k.amp(t, 0.0008, peak, 0.004));
  k.osc('sine', 3150, t, 0.3).connect(k.amp(t, 0.001, peak * 0.22, 0.045));
  k.osc('sine', 4980, t, 0.3).connect(k.amp(t, 0.001, peak * 0.16, 0.03));
}

function crumple(k, t, dur, f, peak, tau, buf = 'crumple', a = 0.004) {
  k.noise(t, dur, buf, 0.9 + Math.random() * 0.2).connect(k.filter('bandpass', f, 0.7)).connect(k.amp(t, a, peak, tau));
}

function whoosh(k, t, f0, f1, dur, peak, q = 1.1, a = 0.04) {
  const bp = k.filter('bandpass', f0, q);
  k.sweep(bp.frequency, t, f0, f1, dur * 0.7);
  k.noise(t, dur + 0.3).connect(bp).connect(k.amp(t, a, peak, dur * 0.3, dur * 0.25));
}

function pageFlip(k, t, peak = 0.5) {
  whoosh(k, t, 700, 3200, 0.26, peak, 1.2, 0.06);
  k.noise(t, 0.4, 'crackle').connect(k.filter('highpass', 2000, 0.7)).connect(k.amp(t, 0.06, peak * 0.6, 0.07));
  k.noise(t + 0.17, 0.12).connect(k.filter('lowpass', 320, 1)).connect(k.amp(t + 0.17, 0.004, peak * 0.7, 0.03));
}

function snap(k, t, peak) {
  k.noise(t, 0.06).connect(k.filter('highpass', 2500, 0.7)).connect(k.amp(t, 0.001, peak, 0.012));
}

export const SFX = {
  click(k, t) {
    for (const [dt, f, p] of [[0, 3800, 0.5], [0.028, 2900, 0.35]]) {
      k.noise(t + dt, 0.03).connect(k.filter('bandpass', f, 3)).connect(k.amp(t + dt, 0.0005, p, 0.004));
      k.osc('sine', f * 0.6, t + dt, 0.05).connect(k.amp(t + dt, 0.0005, p * 0.35, 0.007));
    }
    return 0.1;
  },
  pageTurn(k, t) { pageFlip(k, t, 0.42); return 0.45; },
  count(k, t) {
    ping(k, t, 880, 0.36, 0.13, 0.6);
    thud(k, t, 150, 55, 0.4, 0.05);
    k.noise(t, 0.05).connect(k.filter('lowpass', 900, 0.8)).connect(k.amp(t, 0.001, 0.3, 0.01));
    return 0.6;
  },
  go(k, t) {
    for (const [f, p] of [[880, 0.1], [1760, 0.11], [2217.5, 0.07], [2637, 0.07]]) {
      k.osc('sine', f, t, 1.6).connect(k.amp(t, 0.004, p, 0.34));
      k.osc('sine', f * 1.003, t, 1.6).connect(k.amp(t, 0.004, p * 0.4, 0.3));
    }
    snap(k, t, 0.22);
    thud(k, t, 120, 48, 0.32, 0.12);
    return 1.6;
  },
  hop(k, t) {
    k.noise(t, 0.1).connect(k.filter('bandpass', 1200, 1.5)).connect(k.amp(t, 0.003, 0.32, 0.025));
    const o = k.osc('sine', 260, t, 0.12);
    k.sweep(o.frequency, t, 260, 540, 0.06);
    o.connect(k.amp(t, 0.003, 0.16, 0.03));
    return 0.15;
  },
  tier(k, t, p) {
    const semi = [4, 7, 12][Math.max(0, Math.min(2, (p.tier || 1) - 1))];
    const f = 1046.5 * Math.pow(2, semi / 12);
    k.noise(t, 0.02).connect(k.filter('highpass', 3000, 0.7)).connect(k.amp(t, 0.0005, 0.45, 0.003));
    ping(k, t, f, 0.36, 0.08, 0.5);
    if (p.tier >= 3) ping(k, t + 0.05, f * 1.5, 0.22, 0.1, 0.6);
    return 0.5;
  },
  driftCancel(k, t) {
    const bp = k.filter('bandpass', 1800, 2);
    k.sweep(bp.frequency, t, 1800, 500, 0.15);
    k.noise(t, 0.25).connect(bp).connect(k.amp(t, 0.005, 0.22, 0.06));
    return 0.3;
  },
  boost(k, t, p) {
    const src = p.source || 'drift';
    const s = Math.min(1.5, (p.duration || 0.8)) / 1.4;
    const d = 0.35 + 0.45 * s + (src === 'start' ? 0.3 : 0);
    const soft = src === 'draft' ? 0.6 : 1;
    whoosh(k, t, src === 'draft' ? 900 : 350, src === 'draft' ? 4200 : 2800, d, 0.5 * soft * (0.7 + 0.3 * s));
    k.noise(t, d + 0.2, 'crackle').connect(k.filter('bandpass', 1800, 0.8)).connect(k.amp(t, 0.03, 0.28 * soft, d * 0.35));
    if (src !== 'draft') thud(k, t, 120, 58, 0.45 * (0.6 + 0.4 * s), 0.06);
    if (src === 'pad') {
      const o = k.osc('sawtooth', 300, t, 0.3);
      k.sweep(o.frequency, t, 300, 1400, 0.16);
      o.connect(k.filter('lowpass', 3000, 0.7)).connect(k.amp(t, 0.005, 0.12, 0.06));
    }
    if (src === 'start') {
      k.noise(t, 1.2).connect(k.filter('lowpass', 420, 0.8)).connect(k.amp(t, 0.05, 0.35, 0.25));
      k.osc('sine', 70, t, 1.2).connect(k.amp(t, 0.03, 0.3, 0.2));
    }
    if (src === 'trick') { ping(k, t + 0.02, 2093, 0.12, 0.1, 0.5); ping(k, t + 0.07, 2637, 0.1, 0.1, 0.5); }
    return d + 0.5;
  },
  trick(k, t) {
    const bp = k.filter('bandpass', 3500, 1.5);
    k.sweep(bp.frequency, t, 3500, 700, 0.12);
    k.noise(t, 0.25).connect(bp).connect(k.amp(t, 0.006, 0.5, 0.05));
    ping(k, t + 0.04, 1318.5, 0.2, 0.14, 0.6);
    ping(k, t + 0.1, 1975.5, 0.2, 0.16, 0.6);
    return 0.7;
  },
  land(k, t, p) {
    const i = Math.max(0.2, Math.min(1, p.intensity ?? 0.6));
    thud(k, t, 120, 50, 0.7 * i, 0.07);
    k.noise(t, 0.15).connect(k.filter('lowpass', 400, 0.8)).connect(k.amp(t, 0.002, 0.4 * i, 0.03));
    k.noise(t, 0.15, 'crackle').connect(k.filter('highpass', 2500, 0.7)).connect(k.amp(t, 0.002, 0.3 * i, 0.04));
    return 0.4;
  },
  wall(k, t, p) {
    const i = Math.max(0.25, Math.min(1, p.intensity ?? 0.7));
    k.noise(t, 0.3).connect(k.filter('lowpass', 280, 1.2)).connect(k.amp(t, 0.002, 0.8 * i, 0.06));
    thud(k, t, 85, 58, 0.55 * i, 0.08);
    crumple(k, t, 0.35, 2200, 0.5 * i, 0.08);
    return 0.45;
  },
  bump(k, t, p) {
    const i = Math.max(0.3, Math.min(1, p.intensity ?? 0.7));
    thud(k, t, 180, 120, 0.45 * i, 0.04);
    k.noise(t, 0.08).connect(k.filter('bandpass', 700, 1.5)).connect(k.amp(t, 0.001, 0.4 * i, 0.02));
    return 0.2;
  },
  hit_gum(k, t) {
    const o = k.osc('sine', 520, t, 0.5);
    k.sweep(o.frequency, t, 520, 140, 0.3);
    k.osc('sine', 28, t, 0.5).connect(k.amp(t, 0.001, 60, 10, 0, o.frequency));
    o.connect(k.amp(t, 0.01, 0.42, 0.12));
    const bp = k.filter('lowpass', 1200, 3);
    k.sweep(bp.frequency, t, 1200, 300, 0.3);
    k.noise(t, 0.5).connect(bp).connect(k.amp(t, 0.005, 0.35, 0.1));
    return 0.6;
  },
  hit_plane(k, t) {
    crumple(k, t, 0.7, 2500, 0.75, 0.18);
    whoosh(k, t, 1800, 500, 0.3, 0.28);
    thud(k, t, 100, 45, 0.55, 0.1);
    return 0.9;
  },
  hit_homing(k, t) {
    crumple(k, t, 0.8, 2300, 0.75, 0.2);
    thud(k, t, 90, 38, 0.6, 0.13);
    k.noise(t, 0.9).connect(k.filter('lowpass', 250, 0.8)).connect(k.amp(t, 0.01, 0.5, 0.2));
    return 1.1;
  },
  hit_scissors(k, t) {
    snip(k, t, 0.4);
    snip(k, t + 0.11, 0.44);
    thud(k, t + 0.2, 90, 40, 0.7, 0.1);
    k.noise(t + 0.2, 0.4).connect(k.filter('lowpass', 300, 0.8)).connect(k.amp(t + 0.2, 0.01, 0.5, 0.08));
    return 0.8;
  },
  hit_foil(k, t) {
    crumple(k, t, 0.6, 5200, 0.6, 0.15);
    thud(k, t, 330, 220, 0.4, 0.08);
    k.osc('sine', 1250, t, 0.6).connect(k.amp(t, 0.002, 0.18, 0.1));
    return 0.7;
  },
  hit_burnout(k, t) {
    for (let i = 0; i < 4; i++) {
      const tt = t + i * 0.09;
      k.noise(tt, 0.12).connect(k.filter('lowpass', 180, 2)).connect(k.amp(tt, 0.004, 0.6 * (1 - i * 0.15), 0.03));
      k.osc('sine', 60, tt, 0.12).connect(k.amp(tt, 0.004, 0.3, 0.03));
    }
    snap(k, t + 0.4, 0.35);
    return 0.7;
  },
  hit_default(k, t) { return SFX.hit_plane(k, t); },
  respawnLift(k, t) {
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.17;
      k.noise(tt, 0.15).connect(k.filter('bandpass', 650, 1.2)).connect(k.amp(tt, 0.02, 0.42, 0.04));
    }
    const o = k.osc('sine', 700, t, 0.9);
    k.sweep(o.frequency, t, 700, 1400, 0.6);
    o.connect(k.amp(t, 0.05, 0.1, 0.2, 0.3));
    return 1.0;
  },
  respawnDrop(k, t) {
    const o = k.osc('sine', 320, t, 0.25);
    k.sweep(o.frequency, t, 320, 110, 0.08);
    o.connect(k.amp(t, 0.002, 0.5, 0.05));
    k.noise(t, 0.05).connect(k.filter('bandpass', 1500, 1.5)).connect(k.amp(t, 0.001, 0.3, 0.01));
    return 0.3;
  },
  ink(k, t) {
    k.noise(t, 0.4).connect(k.filter('lowpass', 900, 1)).connect(k.amp(t, 0.002, 0.8, 0.07));
    const o = k.osc('sine', 260, t, 0.5);
    k.sweep(o.frequency, t, 260, 85, 0.2);
    const l = k.osc('sine', 18, t, 0.5);
    l.connect(k.amp(t, 0.001, 25, 10, 0, o.frequency));
    o.connect(k.amp(t, 0.005, 0.5, 0.12));
    for (const dt of [0.25, 0.4]) {
      const d = k.osc('sine', 900, t + dt, 0.1);
      k.sweep(d.frequency, t + dt, 900, 500, 0.03);
      d.connect(k.amp(t + dt, 0.001, 0.12, 0.02));
    }
    return 0.6;
  },
  box(k, t) {
    crumple(k, t, 0.2, 2000, 0.45, 0.05);
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => ping(k, t + 0.03 + i * 0.045, f, 0.2, 0.09, 0.45));
    return 0.6;
  },
  itemGet(k, t) {
    thud(k, t, 140, 70, 0.35, 0.04);
    for (const [f, p] of [[1318.5, 0.25], [1975.5, 0.14], [2637, 0.06]]) k.osc('sine', f, t, 1).connect(k.amp(t, 0.002, p, 0.25));
    return 1.0;
  },
  rouletteTick(k, t, p) {
    const f = 2000 + 800 * (p.pitch ?? 0.5);
    k.osc('sine', f, t, 0.05).connect(k.amp(t, 0.0005, 0.22, 0.006));
    k.noise(t, 0.02).connect(k.filter('highpass', 4000, 0.7)).connect(k.amp(t, 0.0005, 0.14, 0.002));
    return 0.05;
  },
  use_rocket(k, t) {
    whoosh(k, t, 250, 3500, 0.5, 0.55, 1.2, 0.02);
    k.noise(t, 0.7, 'crackle').connect(k.filter('highpass', 1000, 0.7)).connect(k.amp(t, 0.01, 0.4, 0.2));
    thud(k, t, 90, 45, 0.55, 0.06);
    return 0.9;
  },
  use_rocket3(k, t) { return SFX.use_rocket(k, t); },
  use_gum(k, t) {
    const o = k.osc('sine', 180, t, 0.2);
    k.sweep(o.frequency, t, 180, 700, 0.14);
    o.connect(k.amp(t, 0.02, 0.32, 0.03, 0.1));
    k.noise(t + 0.15, 0.05).connect(k.filter('highpass', 1500, 0.7)).connect(k.amp(t + 0.15, 0.0005, 0.4, 0.006));
    k.osc('sine', 1200, t + 0.15, 0.06).connect(k.amp(t + 0.15, 0.0005, 0.25, 0.01));
    return 0.3;
  },
  use_plane(k, t) {
    whoosh(k, t, 2600, 900, 0.3, 0.45, 1.5, 0.03);
    k.noise(t, 0.4, 'crackle').connect(k.filter('bandpass', 3000, 0.8)).connect(k.amp(t, 0.03, 0.2, 0.08));
    return 0.5;
  },
  use_homing(k, t) {
    whoosh(k, t, 1800, 600, 0.3, 0.4, 1.2, 0.03);
    for (const dt of [0.1, 0.22]) k.osc('square', 1480, t + dt, 0.1).connect(k.filter('lowpass', 3000, 0.7)).connect(k.amp(t + dt, 0.001, 0.16, 0.03));
    return 0.5;
  },
  use_ink(k, t) {
    const o = k.osc('sine', 600, t, 0.2);
    k.sweep(o.frequency, t, 600, 250, 0.05);
    o.connect(k.amp(t, 0.001, 0.35, 0.03));
    snap(k, t, 0.25);
    const lp = k.filter('lowpass', 400, 2);
    k.sweep(lp.frequency, t + 0.06, 400, 900, 0.2);
    k.noise(t + 0.06, 0.4).connect(lp).connect(k.amp(t + 0.06, 0.02, 0.3, 0.12));
    return 0.5;
  },
  use_foil(k, t) {
    crumple(k, t, 0.6, 5000, 0.45, 0.2);
    [784, 988, 1175, 1568].forEach((f, i) => ping(k, t + 0.04 + i * 0.05, f, 0.15, 0.2, 0.9));
    return 1.0;
  },
  use_scissors(k, t) {
    snip(k, t, 0.45);
    snip(k, t + 0.09, 0.48);
    whoosh(k, t + 0.1, 1500, 3500, 0.3, 0.28);
    return 0.6;
  },
  planeBounce(k, t) {
    k.noise(t, 0.05).connect(k.filter('bandpass', 1800, 2)).connect(k.amp(t, 0.001, 0.5, 0.012));
    k.osc('sine', 400, t, 0.1).connect(k.amp(t, 0.001, 0.3, 0.02));
    return 0.12;
  },
  lock(k, t) {
    for (const dt of [0, 0.07]) k.osc('square', 1800, t + dt, 0.06).connect(k.filter('lowpass', 4000, 0.7)).connect(k.amp(t + dt, 0.001, 0.22, 0.012));
    return 0.18;
  },
  threat(k, t, p) {
    const urgent = (p.eta ?? 1.5) < 1;
    const ticks = urgent ? [[0, 2100], [0.06, 2300], [0.12, 2500]] : [[0, 1400]];
    for (const [dt, f] of ticks) {
      k.osc('square', f, t + dt, 0.06).connect(k.filter('lowpass', 5000, 0.7)).connect(k.amp(t + dt, 0.001, urgent ? 0.3 : 0.26, 0.018));
      k.osc('sine', f / 2, t + dt, 0.06).connect(k.amp(t + dt, 0.001, 0.2, 0.02));
    }
    return 0.3;
  },
  poof(k, t) {
    k.noise(t, 0.3).connect(k.filter('lowpass', 700, 0.8)).connect(k.amp(t, 0.02, 0.3, 0.08));
    return 0.3;
  },
  impact(k, t) {
    thud(k, t, 110, 50, 0.5, 0.06);
    crumple(k, t, 0.3, 2000, 0.4, 0.08);
    return 0.35;
  },
  rustle(k, t, p) {
    const s = 0.5 + 0.5 * Math.max(0, Math.min(1, p.size ?? 0.5));
    k.noise(t, 0.5, 'crackle', 0.85 + Math.random() * 0.3).connect(k.filter('bandpass', 3200, 0.6)).connect(k.amp(t, 0.05, 0.75 * s, 0.1));
    const tt = t + 0.15 + Math.random() * 0.1;
    k.noise(tt, 0.1).connect(k.filter('bandpass', 500, 1)).connect(k.amp(tt, 0.004, 0.4 * s, 0.03));
    return 0.55;
  },
  lap(k, t) {
    pageFlip(k, t, 0.38);
    ping(k, t + 0.05, 1568, 0.22, 0.16, 0.7);
    ping(k, t + 0.13, 2093, 0.22, 0.2, 0.8);
    return 0.9;
  },
  splitGood(k, t) { ping(k, t, 1318.5, 0.24, 0.13, 0.5); ping(k, t + 0.09, 1760, 0.24, 0.15, 0.6); return 0.6; },
  splitBad(k, t) {
    for (const [dt, f] of [[0, 880], [0.1, 659]]) k.osc('triangle', f, t + dt, 0.5).connect(k.filter('lowpass', 1800, 0.7)).connect(k.amp(t + dt, 0.003, 0.26, 0.11));
    return 0.6;
  },
  placeUp(k, t) {
    const o = k.osc('sine', 880, t, 0.25);
    k.sweep(o.frequency, t, 880, 1320, 0.08);
    o.connect(k.amp(t, 0.003, 0.15, 0.06));
    return 0.25;
  },
  placeDown(k, t) {
    const o = k.osc('sine', 660, t, 0.25);
    k.sweep(o.frequency, t, 660, 440, 0.1);
    o.connect(k.amp(t, 0.003, 0.13, 0.07));
    return 0.25;
  },
  wrongWay(k, t) {
    for (const dt of [0, 0.18]) k.osc('square', 220, t + dt, 0.3).connect(k.filter('lowpass', 900, 0.7)).connect(k.amp(t + dt, 0.004, 0.28, 0.05, 0.08));
    return 0.5;
  },
  pause(k, t) {
    k.noise(t, 0.2).connect(k.filter('lowpass', 250, 0.8)).connect(k.amp(t, 0.002, 0.5, 0.04));
    thud(k, t, 130, 80, 0.4, 0.05);
    return 0.25;
  },
  unpause(k, t) {
    SFX.pause(k, t);
    k.osc('sine', 1800, t + 0.06, 0.05).connect(k.amp(t + 0.06, 0.0005, 0.15, 0.008));
    return 0.25;
  },
  finishLine(k, t) {
    thud(k, t, 120, 45, 0.55, 0.1);
    k.noise(t, 0.1).connect(k.filter('lowpass', 1200, 0.8)).connect(k.amp(t, 0.001, 0.35, 0.02));
    snap(k, t, 0.3);
    return 0.5;
  },
};

// Default parameters for test renders.
export const SFX_VARIANTS = {
  tier: [{ tier: 1 }, { tier: 2 }, { tier: 3 }],
  boost: [{ source: 'drift', duration: 0.45 }, { source: 'drift', duration: 1.4 }, { source: 'pad', duration: 1 },
    { source: 'start', duration: 1 }, { source: 'trick', duration: 0.8 }, { source: 'draft', duration: 0.9 }],
  threat: [{ eta: 1.5 }, { eta: 0.5 }],
  land: [{ intensity: 0.4 }, { intensity: 1 }],
};

export function createSfx(ctx, out, B, rnd = Math.random) {
  const last = new Map();
  let voices = [];
  return {
    // Plays `name` into its own gain/pan strip. Returns false when rate-limited or unknown.
    play(name, p = {}, at = ctx.currentTime) {
      const fn = SFX[name];
      if (!fn) return false;
      const now = ctx.currentTime;
      const minGap = p.minGap ?? 0.03;
      // p.key: a separate rate-limit bucket (other karts' sounds must not rate-limit the player's).
      const key = p.key || name;
      const prev = last.get(key) ?? -1;
      if (now - prev < minGap) return false;
      voices = voices.filter((v) => v > now);
      if (voices.length >= 28 && !p.important) return false;
      last.set(key, now);
      const g = ctx.createGain();
      g.gain.value = p.gain ?? 1;
      let dest = g;
      if (p.pan) {
        const pn = ctx.createStereoPanner();
        pn.pan.value = Math.max(-1, Math.min(1, p.pan));
        pn.connect(g);
        dest = pn;
      }
      g.connect(out);
      const dur = fn(kit(ctx, dest, B, rnd), Math.max(at, now), p);
      voices.push(now + dur);
      return true;
    },
  };
}
