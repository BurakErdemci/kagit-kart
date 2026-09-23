// Procedural sequencer. Themes (themes.js) are compiled once into per-step event tables; an instance
// schedules them against the audio clock with a lookahead window, so timing never depends on frame rate.
// The same code renders offline (OfflineAudioContext) for level checks.
import { prng } from './dsp.js';

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11], hicaz: [0, 1, 4, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11], phrygian: [0, 1, 3, 5, 7, 8, 10],
};

const ROMAN = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };

export function parseChord(sym) {
  const m = /^([b#]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(.*)$/.exec(sym);
  if (!m) throw new Error('chord ' + sym);
  const root = ((ROMAN[m[2].toUpperCase()] + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0)) + 12) % 12;
  const minor = m[2] !== m[2].toUpperCase();
  const q = m[3];
  let tones = minor ? [0, 3, 7] : [0, 4, 7];
  if (q.includes('o') || q.includes('m7b5')) tones = [0, 3, 6];
  if (q.includes('+')) tones = [0, 4, 8];
  if (q.includes('sus4')) tones = [0, 5, 7];
  if (q.includes('sus2')) tones = [0, 2, 7];
  if (q.includes('maj7') || q.includes('maj9')) tones.push(11);
  else if (q.includes('m7b5')) tones.push(10);
  else if (/(^|[^a-z])(7|9|13)/.test(q)) tones.push(q.includes('o7') ? 9 : 10);
  if (q.includes('6')) tones.push(9);
  if (q.includes('9') || q.includes('add9')) tones.push(q.includes('b9') ? 13 : 14);
  if (q.includes('13')) tones.push(21);
  return { sym, root, tones };
}

function degreeToSemis(tok, scale) {
  const m = /^([#b]?)([1-7])([',]*)$/.exec(tok);
  if (!m) return null;
  const d = +m[2] - 1;
  let s = scale[d % scale.length] + 12 * Math.floor(d / scale.length);
  if (m[1] === '#') s += 1; else if (m[1] === 'b') s -= 1;
  for (const c of m[3]) s += c === "'" ? 12 : -12;
  return s;
}

// Splits a pattern into bars ('|'), tokens per bar (whitespace, or characters for drum grids), and
// lays them over the section so each token knows its step and span.
function layout(pattern, bars, spb, chars) {
  const barStrs = pattern.split('|').map((s) => s.trim()).filter((s) => s.length);
  const out = [];
  for (let b = 0; b < bars; b++) {
    const src = barStrs[b % barStrs.length];
    const toks = chars ? src.replace(/\s+/g, '').split('') : src.split(/\s+/);
    if (spb % toks.length !== 0) throw new Error(`pattern bar "${src}" has ${toks.length} tokens for ${spb} steps`);
    const span = spb / toks.length;
    toks.forEach((tok, k) => out.push({ step: b * spb + k * span, span, tok }));
  }
  return out;
}

function withHolds(toks, i) {
  let span = toks[i].span;
  for (let j = i + 1; j < toks.length && toks[j].tok === '-'; j++) span += toks[j].span;
  return span;
}

function velOf(tok) {
  if (tok.endsWith('!')) return [tok.slice(0, -1), 1];
  if (tok.endsWith('?')) return [tok.slice(0, -1), 0.5];
  return [tok, 0.8];
}

function voiceChord(chord, lo, hi, n, prev) {
  const pcs = chord.tones.map((t) => (chord.root + t) % 12);
  let best = null, bestCost = Infinity;
  for (let inv = 0; inv < pcs.length; inv++) {
    for (let base = lo - 12; base <= hi; base += 12) {
      const v = [];
      let cur = base + ((pcs[inv] - base) % 12 + 12) % 12;
      for (let k = 0; k < n; k++) {
        const pc = pcs[(inv + k) % pcs.length];
        if (k > 0) { cur += 1; while ((cur % 12 + 12) % 12 !== pc) cur++; }
        v.push(cur);
      }
      if (v[0] < lo || v[v.length - 1] > hi) continue;
      const cost = prev ? v.reduce((a, x, k) => a + Math.abs(x - (prev[k] ?? prev[prev.length - 1])), 0)
        : Math.abs((v[0] + v[v.length - 1]) / 2 - (lo + hi) / 2);
      if (cost < bestCost) { bestCost = cost; best = v; }
    }
  }
  return best || [lo + chord.root];
}

function bassNote(chord, tok, lo) {
  const r = lo + ((chord.root - lo) % 12 + 12) % 12;
  const m = /^([r35789])([',]*)$/.exec(tok);
  if (!m) return null;
  const t = chord.tones;
  let s = { r: 0, 3: t[1], 5: t[2] ?? 7, 7: t[3] ?? 10, 8: 12, 9: 14 }[m[1]];
  for (const c of m[2]) s += c === "'" ? 12 : -12;
  return r + s;
}

function arpLadder(chord, lo) {
  const r = lo + ((chord.root - lo) % 12 + 12) % 12;
  const tones = chord.tones.filter((t) => t < 12);
  const L = [];
  for (let o = 0; o < 4; o++) for (const t of tones) L.push(r + t + 12 * o);
  return L;
}

function resolveRaw(theme, raw) {
  if (!raw.extends) return raw;
  const base = resolveRaw(theme, theme.sections[raw.extends]);
  return { ...base, ...raw, extends: undefined, parts: { ...base.parts, ...raw.parts } };
}

function compileSection(theme, name, raw, lanes) {
  const spb = theme.beats * theme.steps;
  const sec = resolveRaw(theme, raw);
  const bars = sec.bars;
  const len = bars * spb;
  const chordAt = new Array(len);
  const chordList = sec.chords || ['I'];
  for (let b = 0; b < bars; b++) {
    const cs = chordList[b % chordList.length].split(/\s+/);
    const each = spb / cs.length;
    cs.forEach((c, k) => { const ch = parseChord(c); for (let s = 0; s < each; s++) chordAt[b * spb + k * each + s] = ch; });
  }
  const scale = SCALES[theme.scale];
  const out = { name, bars, len, chordAt, lanes: {}, fill: sec.fill !== false, vel: sec.vel ?? 1 };
  for (const laneName in sec.parts) {
    let part = sec.parts[laneName];
    if (part == null) continue;
    const lane = lanes[laneName];
    if (!lane) throw new Error(`section ${name}: unknown lane ${laneName}`);
    const variants = Array.isArray(part) ? part : [part];
    out.lanes[laneName] = variants.map((p) => (p == null ? null : compilePart(p, lane, out, scale, spb)));
  }
  return out;
}

function compilePart(part, lane, sec, scale, spb) {
  const { len, bars, chordAt } = sec;
  const ev = new Array(len).fill(null);
  const push = (step, e) => { (ev[step] ||= []).push(e); };
  const oct = 12 * (lane.oct || 0);
  if (typeof part === 'string') part = { mel: part };
  if (part.mel) {
    const toks = layout(part.mel, bars, spb);
    toks.forEach((t, i) => {
      const [tk, v] = velOf(t.tok);
      for (const one of tk.split('+')) {
        const s = degreeToSemis(one, scale);
        if (s == null) continue;
        push(t.step, { m: s + oct + (part.oct || 0) * 12, dur: withHolds(toks, i), v });
      }
    });
  } else if (part.bass) {
    const toks = layout(part.bass, bars, spb);
    const lo = (lane.lo ?? -20) + (part.oct || 0) * 12;
    toks.forEach((t, i) => {
      const [tk, v] = velOf(t.tok);
      const ch = chordAt[t.step];
      let m;
      if (tk === 'a' || tk === 'A') {
        const nx = chordAt[(t.step + t.span) % len];
        m = bassNote(nx, 'r', lo) + (tk === 'a' ? -1 : 1);
      } else m = bassNote(ch, tk, lo);
      if (m == null) return;
      push(t.step, { m, dur: withHolds(toks, i), v });
    });
  } else if (part.comp || part.arp) {
    const lo = (lane.lo ?? -5) + (part.oct || 0) * 12;
    const hi = (lane.hi ?? (lane.lo ?? -5) + 17) + (part.oct || 0) * 12;
    const n = part.n || lane.n || 3;
    const toks = layout(part.comp || part.arp, bars, spb);
    let prev = null, prevChord = null, voicing = null;
    toks.forEach((t, i) => {
      const [tk, v] = velOf(t.tok);
      const ch = chordAt[t.step];
      if (ch !== prevChord) { voicing = voiceChord(ch, lo, hi, n, prev); prev = voicing; prevChord = ch; }
      const dur = withHolds(toks, i);
      if (part.comp) {
        if (tk !== 'x' && tk !== 'X' && tk !== 'o') return;
        const vv = tk === 'X' ? 1 : tk === 'o' ? 0.45 : v;
        voicing.forEach((m, k) => push(t.step, { m, dur, v: vv, o: k * (part.strum ?? lane.strum ?? 0) }));
      } else {
        const m = /^([1-9])([',]*)$/.exec(tk);
        if (!m) return;
        const L = arpLadder(ch, lo);
        let note = L[Math.min(L.length - 1, +m[1] - 1)];
        for (const c of m[2]) note += c === "'" ? 12 : -12;
        push(t.step, { m: note, dur, v });
      }
    });
  } else if (part.chord) {
    const lo = (lane.lo ?? -5), hi = lane.hi ?? lo + 17, n = lane.n || 4;
    let start = 0, prev = null;
    for (let s = 1; s <= len; s++) {
      if (s === len || chordAt[s] !== chordAt[start]) {
        const v = voiceChord(chordAt[start], lo, hi, n, prev);
        prev = v;
        v.forEach((m) => push(start, { m, dur: s - start, v: part.v ?? 0.8 }));
        start = s;
      }
    }
  } else if (part.drum) {
    const lastBar = (bars - 1) * spb;
    for (const dn in part.drum) {
      const fillPat = part.fill && part.fill[dn] !== undefined && sec.fill ? part.fill[dn] : null;
      for (const t of layout(part.drum[dn], bars, spb, true)) {
        if (fillPat != null && t.step >= lastBar) continue;
        const v = { X: 1, x: 0.72, o: 0.42 }[t.tok];
        if (v) push(t.step, { d: dn, v });
      }
      if (fillPat) for (const t of layout(fillPat, 1, spb, true)) {
        const v = { X: 1, x: 0.72, o: 0.42 }[t.tok];
        if (v) push(lastBar + t.step, { d: dn, v });
      }
    }
    if (part.fill && sec.fill) {
      for (const dn in part.fill) {
        if (part.drum[dn] !== undefined) continue;
        for (const t of layout(part.fill[dn], 1, spb, true)) {
          const v = { X: 1, x: 0.72, o: 0.42 }[t.tok];
          if (v) push(lastBar + t.step, { d: dn, v });
        }
      }
    }
  }
  return ev;
}

const AUTO_LANES = {
  fan: { inst: 'brass', gain: 0.55, pan: 0, rev: 0.3, lo: 2, hi: 21, n: 3 },
  fbell: { inst: 'bell', gain: 0.4, pan: 0.2, rev: 0.4, oct: 1 },
  fdr: { inst: 'kit', gain: 0.8, pan: 0, rev: 0.15 },
};

const DEFAULT_FINAL_LAP = {
  bars: 1, fill: false,
  chords: ['V I'],
  parts: {
    fan: { comp: 'X . X . x . X - - - - - . . . .' },
    fbell: { mel: "5 . 5 . 5 . 1' - - - - - . . . ." },
    fdr: { drum: { snare: 'xxxxxxxxXxxxXxxX', kick: 'X...X...X.......', crash: '........X.......' } },
  },
};

const compiledCache = new WeakMap();

export function compileTheme(theme) {
  let c = compiledCache.get(theme);
  if (c) return c;
  const lanes = { ...AUTO_LANES, ...theme.lanes };
  const sections = {};
  const useDefault = theme.finalLap && !theme.sections._fl && theme.beats * theme.steps === 16;
  const raws = useDefault ? { _fl: DEFAULT_FINAL_LAP, ...theme.sections } : { ...theme.sections };
  for (const name in raws) sections[name] = compileSection(theme, name, raws[name], lanes);
  const insts = new Set(), drums = new Set();
  for (const name in sections) for (const ln in sections[name].lanes) {
    const lane = lanes[ln];
    if (lane.inst === 'kit') {
      for (const v of sections[name].lanes[ln]) if (v) for (const e of v) if (e) for (const x of e) drums.add(x.d);
    } else insts.add(lane.inst);
  }
  c = { theme, lanes, sections, spb: theme.beats * theme.steps, insts: [...insts], drums: [...drums] };
  compiledCache.set(theme, c);
  return c;
}

export function createMusic(ctx, dest, instruments, bank, opts = {}) {
  const lookahead = opts.lookahead ?? 0.3;
  const active = [];
  let onNote = opts.onNote || null;

  function makeInstance(theme, o) {
    const C = compileTheme(theme);
    instruments.prepare(C.insts);
    instruments.prepareDrums(C.drums);
    const at = Math.max(ctx.currentTime + 0.02, o.at ?? 0);
    const out = ctx.createGain(), wet = ctx.createGain();
    out.connect(dest.music);
    wet.connect(dest.reverb);
    const level = (o.gain ?? 1) * Math.pow(10, (theme.trim || 0) / 20);
    if (o.fadeIn) {
      for (const g of [out, wet]) { g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(level, at + o.fadeIn); }
    } else { out.gain.value = level; wet.gain.value = level; }
    const strips = {};
    for (const ln in C.lanes) {
      const L = C.lanes[ln];
      const g = ctx.createGain(); g.gain.value = L.gain ?? 0.6;
      const p = ctx.createStereoPanner(); p.pan.value = L.pan ?? 0;
      const s = ctx.createGain(); s.gain.value = L.rev ?? 0.2;
      g.connect(p); p.connect(out); p.connect(s); s.connect(wet);
      strips[ln] = g;
    }
    const amb = [];
    for (const a of theme.ambience || []) {
      const src = ctx.createBufferSource();
      src.buffer = bank[a.src];
      src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = a.type || 'lowpass'; f.frequency.value = a.f || 1000; f.Q.value = a.q ?? 0.7;
      const g = ctx.createGain(); g.gain.value = a.gain;
      src.connect(f).connect(g).connect(out);
      const nodes = [src];
      if (a.lfo) {
        const l = ctx.createOscillator(); l.frequency.value = a.lfo.rate;
        const lg = ctx.createGain(); lg.gain.value = a.lfo.depth;
        l.connect(lg).connect(g.gain);
        if (a.lfo.sweep) { const sg = ctx.createGain(); sg.gain.value = a.lfo.sweep; l.connect(sg).connect(f.frequency); }
        l.start(at); nodes.push(l);
      }
      src.start(at);
      amb.push(...nodes);
    }
    const form = o.form || theme.form;
    const inst = {
      theme, C, out, wet, strips, amb, level,
      form, loopTo: o.form ? (o.loopTo ?? 0) : (theme.loopTo ?? 0), once: !!(o.once ?? theme.once),
      formIdx: 0, sec: C.sections[form[0]], bar: 0, step: 0, cycle: 0,
      barStart: at, nextTime: at,
      tempo: (o.tempo ?? theme.tempo) * (o.tempoScale ?? 1),
      transpose: o.transpose ?? 0,
      key: theme.key,
      queue: [], pending: null,
      stopAt: Infinity, retireAt: Infinity, done: false,
      rnd: prng(o.seed ?? 1234),
      loops: [],
    };
    return inst;
  }

  function stepDur(inst) { return 60 / inst.tempo / inst.theme.steps; }

  function stepTime(inst, s) {
    const d = stepDur(inst);
    const th = inst.theme;
    let t = inst.barStart + s * d;
    if (th.swing) {
      const unit = th.swingUnit || 2;
      if (s % unit === 0 && (s / unit) % 2 === 1) t += th.swing * unit * d;
    }
    return t;
  }

  function advanceSection(inst) {
    if (inst.pending) {
      const p = inst.pending;
      inst.pending = null;
      if (p.tempoScale) inst.tempo *= p.tempoScale;
      if (p.transpose) inst.transpose += p.transpose;
      // A final-lap form replaces the loop so no breakdown lands in the last lap.
      if (p.form) { inst.form = p.form; inst.loopTo = 0; inst.formIdx = -1; }
      if (p.queue) inst.queue.push(...p.queue);
    }
    let name;
    if (inst.queue.length) {
      name = inst.queue.shift();
      const idx = inst.form.indexOf(name);
      if (idx >= 0) inst.formIdx = idx;
    } else {
      inst.formIdx++;
      if (inst.formIdx >= inst.form.length) {
        if (inst.once) { inst.done = true; return false; }
        inst.formIdx = inst.loopTo;
        inst.cycle++;
        inst.loops.push(inst.barStart);
      }
      name = inst.form[inst.formIdx];
    }
    inst.sec = inst.C.sections[name];
    inst.bar = 0;
    return true;
  }

  function scheduleStep(inst, t, now) {
    const sec = inst.sec;
    const si = inst.bar * inst.C.spb + inst.step;
    if (t < now - 0.03) return;
    const sd = stepDur(inst);
    for (const ln in sec.lanes) {
      const vars = sec.lanes[ln];
      const evs = vars[inst.cycle % vars.length];
      if (!evs || !evs[si]) continue;
      const L = inst.C.lanes[ln];
      const out = inst.strips[ln];
      for (const e of evs[si]) {
        const jitter = L.hum ? (inst.rnd() - 0.5) * L.hum : 0;
        const vel = e.v * sec.vel * (L.vel ?? 1) * (L.vj ? 1 - inst.rnd() * L.vj : 1);
        const tt = Math.max(now, t + jitter + (e.o || 0));
        if (e.d) {
          instruments.drum(e.d, out, tt, vel, e.d === 'tek' || e.d === 'ka' ? 0.97 + inst.rnd() * 0.06 : 1);
          if (onNote) onNote(tt, -1, 0.05, ln, vel, e.d);
        } else {
          const midi = inst.key + inst.transpose + e.m;
          const dur = e.dur * sd * (L.legato ?? 0.92);
          instruments.play(L.inst, out, midi, tt, dur, vel, L.ring);
          if (onNote) onNote(tt, midi, dur, ln, vel);
        }
      }
    }
  }

  function pumpInstance(inst, now, horizon) {
    while (!inst.done && inst.nextTime < horizon && inst.nextTime < inst.stopAt) {
      scheduleStep(inst, inst.nextTime, now);
      inst.step++;
      if (inst.step >= inst.C.spb) {
        inst.step = 0;
        inst.barStart += inst.C.spb * stepDur(inst);
        inst.bar++;
        if (inst.bar >= inst.sec.bars) { if (!advanceSection(inst)) break; }
        else if (inst.pending && inst.pending.atBar) advanceSection(inst);
      }
      inst.nextTime = stepTime(inst, inst.step);
    }
    if (inst.done && inst.retireAt === Infinity) inst.retireAt = inst.barStart + 4;
  }

  function retire(inst) {
    try { inst.out.disconnect(); inst.wet.disconnect(); } catch { /* already detached */ }
    for (const n of inst.amb) { try { n.stop(); } catch { /* not started */ } }
  }

  function pump(now = ctx.currentTime, horizon = now + lookahead) {
    for (let i = active.length - 1; i >= 0; i--) {
      const inst = active[i];
      pumpInstance(inst, now, horizon);
      if (now > inst.retireAt) { retire(inst); active.splice(i, 1); }
    }
  }

  function fadeOut(inst, fade, at) {
    const t0 = Math.max(at, ctx.currentTime);
    for (const g of [inst.out, inst.wet]) {
      g.gain.cancelScheduledValues(t0);
      g.gain.setValueAtTime(g.gain.value, t0);
      g.gain.linearRampToValueAtTime(0, t0 + Math.max(0.02, fade));
    }
    inst.stopAt = Math.min(inst.stopAt, t0 + fade);
    inst.retireAt = Math.min(inst.retireAt, t0 + fade + 3);
    for (const n of inst.amb) { try { n.stop(t0 + fade + 0.05); } catch { /* not started */ } }
  }

  return {
    // Starts a theme; returns the instance. o: { at, fadeIn, form, loopTo, once, tempoScale, transpose, gain, seed }
    play(theme, o = {}) {
      const inst = makeInstance(theme, o);
      active.push(inst);
      pump();
      return inst;
    },
    stop(inst, fade = 0.6, at = ctx.currentTime) {
      if (inst) fadeOut(inst, fade, at);
    },
    stopAll(fade = 0.6) {
      for (const inst of active) fadeOut(inst, fade, ctx.currentTime);
    },
    // Key-up fanfare at the next bar, then faster and higher, jumping to the theme's climax section.
    finalLap(inst) {
      if (!inst || inst.done || inst.stopAt !== Infinity) return;
      const fl = inst.theme.finalLap || {};
      inst.pending = {
        atBar: true,
        tempoScale: fl.tempo ?? 1.12,
        transpose: fl.transpose ?? 2,
        form: fl.form || null,
        queue: [...(inst.C.sections._fl ? ['_fl'] : []), ...(!fl.form && fl.section ? [fl.section] : [])],
      };
    },
    // Builds the sample banks a theme needs ahead of time (a race's themes at raceSetup, not at GO).
    prepare(theme) {
      const C = compileTheme(theme);
      instruments.prepare(C.insts);
      instruments.prepareDrums(C.drums);
    },
    duration(theme, form = theme.form, tempoScale = 1) {
      const C = compileTheme(theme);
      let steps = 0;
      for (const n of form) steps += C.sections[n].len;
      return steps * 60 / (theme.tempo * tempoScale) / theme.steps;
    },
    pump,
    active,
    setOnNote(fn) { onNote = fn; },
  };
}
