// Kart engines. The player's voice is rich (two detuned saws + sub through a soft clipper and a
// throttle-driven filter, a "card in the spokes" flutter tied to wheel speed, offroad rattle, an
// eraser-squeak whine while drifting, boost roar, slipstream wind, foil shimmer). The three CPUs nearest
// the listener share three cheap voices with distance attenuation, pan and doppler-ish pitch.
// All nodes are built once; update() only moves AudioParams.

const GEARS = [0, 0.24, 0.48, 0.72, 0.96];
const TIER_PITCH = [1, 1.12, 1.26, 1.5];

function rpmOf(s, thr) {
  let g = 0;
  while (g < 3 && s >= GEARS[g + 1]) g++;
  const span = g < 3 ? GEARS[g + 1] - GEARS[g] : 0.45;
  const local = Math.min(1.35, Math.max(0, (s - GEARS[g]) / span));
  let rpm = 0.32 + 0.09 * g + (1 - 0.32 - 0.09 * g) * local;
  // Standing still the throttle revs the engine (countdown); the gear curve takes over with speed.
  if (s < 0.2) { const w = s / 0.2; rpm = rpm * w + (0.2 + 0.5 * thr) * (1 - w); }
  return Math.max(rpm, 0.2);
}

function softClip(n = 1024, drive = 2.2) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive) / Math.tanh(drive); }
  return c;
}

export function createEngines(ctx, out, bank) {
  const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
  const filt = (type, f, q = 0.8) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const sources = [];
  const start = (...s) => { for (const x of s) { x.start(); sources.push(x); } };

  const gate = gain(0);
  gate.connect(out);

  // ---- player ------------------------------------------------------------------------------------
  const pan = ctx.createStereoPanner();
  pan.connect(gate);
  const white = ctx.createBufferSource(); white.buffer = bank.white; white.loop = true;
  const pink = ctx.createBufferSource(); pink.buffer = bank.pink; pink.loop = true;

  const oscA = osc('sawtooth', 60), oscB = osc('sawtooth', 60), sub = osc('square', 30);
  const pre = gain(1);
  const gA = gain(0.5), gB = gain(0.45), gS = gain(0.3);
  oscA.connect(gA).connect(pre); oscB.connect(gB).connect(pre); sub.connect(gS).connect(pre);
  const shaper = ctx.createWaveShaper(); shaper.curve = softClip(); shaper.oversample = '2x';
  const lp = filt('lowpass', 800, 1.4);
  const am = gain(1);
  const body = gain(0);
  pre.connect(shaper).connect(lp).connect(am).connect(body).connect(pan);
  const putt = osc('sine', 15), puttDepth = gain(0.3);
  putt.connect(puttDepth).connect(am.gain);

  const fbp = filt('bandpass', 1900, 1.3), fam = gain(0.5), flutter = gain(0);
  const flfo = osc('square', 30), flfoD = gain(0.5);
  white.connect(fbp).connect(fam).connect(flutter).connect(pan);
  flfo.connect(flfoD).connect(fam.gain);

  const rbp = filt('bandpass', 420, 0.9), ram = gain(0.5), rattle = gain(0);
  const rlfo = osc('square', 17), rlfoD = gain(0.5);
  pink.connect(rbp).connect(ram).connect(rattle).connect(pan);
  rlfo.connect(rlfoD).connect(ram.gain);

  const sbp = filt('bandpass', 1900, 9), sam = gain(0.5), squeak = gain(0);
  const slfo = osc('sawtooth', 33), slfoD = gain(0.5);
  white.connect(sbp).connect(sam).connect(squeak).connect(pan);
  slfo.connect(slfoD).connect(sam.gain);
  const wosc = osc('triangle', 820), wlfo = osc('sine', 7), wlfoD = gain(25), whine = gain(0);
  wlfo.connect(wlfoD).connect(wosc.detune);
  wosc.connect(whine).connect(pan);

  const rhp = filt('highpass', 150, 0.7), rlp = filt('lowpass', 1100, 0.7), roar = gain(0);
  pink.connect(rhp).connect(rlp).connect(roar).connect(pan);

  const wbp = filt('bandpass', 2500, 0.7), wind = gain(0);
  white.connect(wbp).connect(wind).connect(pan);

  const shbp = filt('bandpass', 7000, 3), sham = gain(0.5), shimmer = gain(0);
  const shlfo = osc('sine', 11), shlfoD = gain(0.5);
  white.connect(shbp).connect(sham).connect(shimmer).connect(pan);
  shlfo.connect(shlfoD).connect(sham.gain);

  start(white, pink, oscA, oscB, sub, putt, flfo, rlfo, slfo, wosc, wlfo, shlfo);

  // ---- CPU voices ----------------------------------------------------------------------------------
  const cpu = [];
  for (let i = 0; i < 3; i++) {
    const a = osc('sawtooth', 70), b = osc('square', 35);
    const gb = gain(0.35);
    const f = filt('lowpass', 900, 1.2);
    const g = gain(0);
    const p = ctx.createStereoPanner();
    a.connect(f); b.connect(gb).connect(f); f.connect(g).connect(p).connect(gate);
    start(a, b);
    cpu.push({ a, b, f, g, p, kart: null, rpm: 0.3 });
  }

  const P = { rpm: 0.25, active: false };
  const near = [null, null, null];
  const nearD = [Infinity, Infinity, Infinity];

  function set(param, v, now, tc = 0.04) { param.setTargetAtTime(v, now, tc); }

  const playerGains = [body, flutter, rattle, squeak, whine, roar, wind, shimmer];
  function silencePlayer(now) {
    for (let i = 0; i < playerGains.length; i++) set(playerGains[i].gain, 0, now, 0.05);
  }

  function updatePlayer(k, now, level, dt) {
    if (!k) { silencePlayer(now); return; }
    const top = k.baseTop || 25;
    const sp = Math.abs(k.speed || 0);
    const s = sp / top;
    const c = k.controls || {};
    const thr = Math.max(0, Math.min(1, c.throttle || 0));
    const boost = k.boostTime > 0 ? 1 : 0;
    const air = k.grounded === false;
    const resp = !!(k.respawn && k.respawn.active);
    const spin = k.spinTime > 0;
    let rpm = rpmOf(s, thr);
    if (air) rpm += 0.12 * thr;
    if (boost) rpm += 0.1;
    if (spin) rpm *= 0.8 + 0.1 * Math.sin(now * 40);
    P.rpm += (rpm - P.rpm) * (1 - Math.exp(-dt / 0.05));
    const f0 = 58 * Math.pow(2, P.rpm * 2);
    set(oscA.frequency, f0, now, 0.025);
    set(oscB.frequency, f0 * 1.007, now, 0.025);
    set(sub.frequency, f0 * 0.5, now, 0.025);
    // Kept under ~1.9 kHz (boost opens it): a brighter buzz tires the ear over a 2.5-minute race.
    set(lp.frequency, 300 + 1500 * (0.25 + 0.75 * thr) * (0.4 + 0.6 * Math.min(1.2, P.rpm)) + boost * 1300, now, 0.05);
    set(putt.frequency, f0 / 4, now, 0.05);
    set(puttDepth.gain, 0.05 + 0.4 * Math.max(0, 1 - P.rpm * 1.2), now, 0.1);
    set(body.gain, level * (0.13 + 0.12 * thr + 0.06 * boost) * (resp ? 0.25 : 1), now, 0.06);

    const ground = air || resp ? 0.15 : 1;
    set(flfo.frequency, Math.max(4, Math.min(95, sp * 2.4)), now, 0.05);
    set(flutter.gain, level * 0.1 * Math.min(1.2, s) * ground, now, 0.08);

    const surf = k.surface || 'road';
    const rough = surf === 'offroad' || surf === 'out' || surf === 'sand';
    set(rbp.frequency, surf === 'sand' ? 2200 : surf === 'out' ? 300 : surf === 'ice' ? 5000 : 420, now, 0.05);
    const rl = rough ? (surf === 'out' ? 0.4 : 0.32) : surf === 'ice' ? 0.06 : 0;
    set(rattle.gain, level * rl * Math.min(1, s * 1.5) * ground, now, 0.06);

    const d = k.drift || {};
    const drifting = d.active && !air;
    const tp = TIER_PITCH[d.tier | 0] || 1;
    set(sbp.frequency, 1900 * tp, now, 0.03);
    set(wosc.frequency, 820 * tp, now, 0.03);
    set(squeak.gain, drifting ? level * 0.2 : 0, now, 0.04);
    set(whine.gain, drifting ? level * 0.05 : 0, now, 0.05);

    set(roar.gain, boost ? level * 0.2 * Math.min(1, k.boostTime * 3) : 0, now, 0.06);
    set(rlp.frequency, boost ? 900 + 600 * (k.boostStrength || 1) : 900, now, 0.1);

    const dc = (k.draft && k.draft.charge) || 0;
    set(wind.gain, level * 0.07 * dc, now, 0.1);
    set(wbp.frequency, 2000 + 3000 * dc, now, 0.1);

    set(shimmer.gain, k.invincibleTime > 0 ? level * 0.06 : 0, now, 0.1);
    const steer = k.steerIn ?? c.steer ?? 0;
    set(pan.pan, Math.max(-0.3, Math.min(0.3, steer * 0.12 + (drifting ? (d.dir || 0) * 0.08 : 0))), now, 0.1);
  }

  function updateCpus(game, L, now, level) {
    const karts = game.karts || [];
    const player = game.player;
    nearD[0] = nearD[1] = nearD[2] = Infinity;
    near[0] = near[1] = near[2] = null;
    for (let i = 0; i < karts.length; i++) {
      const k = karts[i];
      if (!k || k === player || !k.pos) continue;
      const dx = k.pos.x - L.x, dy = k.pos.y - L.y, dz = k.pos.z - L.z;
      let d2 = dx * dx + dy * dy + dz * dz;
      for (let s = 0; s < 3; s++) if (cpu[s].kart === k) d2 *= 0.8;
      for (let s = 0; s < 3; s++) {
        if (d2 < nearD[s]) {
          for (let j = 2; j > s; j--) { nearD[j] = nearD[j - 1]; near[j] = near[j - 1]; }
          nearD[s] = d2; near[s] = k;
          break;
        }
      }
    }
    // Keep a kart on the voice it already has so its pitch never jumps between voices.
    for (let s = 0; s < 3; s++) {
      const v = cpu[s];
      if (v.kart && v.kart !== near[0] && v.kart !== near[1] && v.kart !== near[2]) v.kart = null;
    }
    for (let n = 0; n < 3; n++) {
      const k = near[n];
      if (!k || cpu[0].kart === k || cpu[1].kart === k || cpu[2].kart === k) continue;
      for (let s = 0; s < 3; s++) if (!cpu[s].kart) { cpu[s].kart = k; cpu[s].fresh = true; break; }
    }
    const pv = player && player.vel;
    for (let s = 0; s < 3; s++) {
      const v = cpu[s];
      const k = v.kart;
      if (!k) { set(v.g.gain, 0, now, 0.05); continue; }
      const dx = k.pos.x - L.x, dy = k.pos.y - L.y, dz = k.pos.z - L.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const att = d > 160 ? 0 : Math.pow(Math.min(1, 10 / Math.max(d, 10)), 1.15);
      const top = k.baseTop || 25;
      const s01 = Math.abs(k.speed || 0) / top;
      const thr = (k.controls && k.controls.throttle) || 0;
      const rpm = rpmOf(s01, thr) + (k.boostTime > 0 ? 0.1 : 0);
      let rel = 0;
      if (k.vel) {
        rel = ((k.vel.x - (pv ? pv.x : 0)) * dx + (k.vel.z - (pv ? pv.z : 0)) * dz) / d;
      }
      const dop = Math.max(0.86, Math.min(1.14, 1 / (1 + rel / 140)));
      const persona = 0.9 + 0.05 * ((k.index ?? s) % 5);
      const f = 62 * Math.pow(2, rpm * 1.9) * dop * persona;
      if (v.fresh) {
        v.fresh = false;
        v.g.gain.cancelScheduledValues(now);
        v.g.gain.setValueAtTime(0, now);
        v.a.frequency.setValueAtTime(f, now);
        v.b.frequency.setValueAtTime(f * 0.5, now);
      }
      set(v.a.frequency, f, now, 0.04);
      set(v.b.frequency, f * 0.5, now, 0.04);
      set(v.f.frequency, 500 + 1800 * Math.min(1.2, rpm) * (0.5 + 0.5 * thr), now, 0.06);
      set(v.g.gain, level * 0.065 * att * (0.6 + 0.4 * thr), now, 0.08);
      const pan = (dx * L.rx + dy * L.ry + dz * L.rz) / d;
      set(v.p.pan, Math.max(-0.85, Math.min(0.85, pan * 0.85)), now, 0.08);
    }
  }

  return {
    setActive(on) {
      if (on === P.active) return;
      P.active = on;
      set(gate.gain, on ? 1 : 0, ctx.currentTime, on ? 0.08 : 0.05);
    },
    update(game, L, level = 1, dt = 1 / 60) {
      const now = ctx.currentTime;
      updatePlayer(game.player || null, now, level, Math.max(0.001, dt));
      updateCpus(game, L, now, level);
    },
    unbind() {
      const now = ctx.currentTime;
      silencePlayer(now);
      for (const v of cpu) { v.kart = null; set(v.g.gain, 0, now, 0.03); }
      near[0] = near[1] = near[2] = null;
    },
    dispose() {
      for (const s of sources) { try { s.stop(); } catch { /* already stopped */ } }
      try { gate.disconnect(); } catch { /* detached */ }
    },
  };
}
