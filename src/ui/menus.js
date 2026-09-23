// Title cover and the menu screens (mode, class, character, track, settings, controls) plus the
// chapter card shown during the intro flyover.
import { h, svg, clear, tilt, up, cap, lt, setLt } from './dom.js';
import { FocusList } from './nav.js';
import { MODE_ART, portrait, trackSketch } from './icons.js';
import { createSettingsForm, createControlsForm } from './forms.js';

const BACK_ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="#f3ead3" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="#2d2a32" stroke-width="2.2" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></g></svg>';
const PAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="#2d2a32" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><path d="M6 8h12a4 4 0 0 1 4 4l-.6 4a2.5 2.5 0 0 1-4.4 1.2L15.5 15h-7L7 17.2a2.5 2.5 0 0 1-4.4-1.2L2 12a4 4 0 0 1 4-4z"/><path d="M7 10.5v3M5.5 12h3"/></g><circle cx="16" cy="11" r="1.1" fill="#2d2a32"/><circle cx="18" cy="13" r="1.1" fill="#2d2a32"/></svg>';
const KART_EMBLEM = '<svg viewBox="0 0 180 100" aria-hidden="true"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="rgba(255,255,255,.14)" stroke-width="3.2" transform="translate(1 1.5)"><path d="M28 64h120l-8-20H96l-12-18H58l-8 18H36z"/><circle cx="52" cy="72" r="13"/><circle cx="126" cy="72" r="13"/><path d="M70 26q2-14 16-14"/><path d="M8 46h18M4 58h16M10 70h12"/></g><g stroke="rgba(14,30,35,.8)" stroke-width="3.2"><path d="M28 64h120l-8-20H96l-12-18H58l-8 18H36z"/><circle cx="52" cy="72" r="13"/><circle cx="126" cy="72" r="13"/><path d="M70 26q2-14 16-14"/><path d="M8 46h18M4 58h16M10 70h12"/></g></g></svg>';
const RULE_INK = '<svg viewBox="0 0 280 18" aria-hidden="true"><g stroke="#2d2a32" stroke-width="2" fill="none" opacity=".55"><path d="M0 9h118M162 9h118"/><path d="M140 2l7 7-7 7-7-7z" fill="#d9483b" stroke="none"/></g></svg>';
const RULE = '<svg viewBox="0 0 280 18" aria-hidden="true"><g stroke="#d8ad4c" stroke-width="2" fill="none" opacity=".75"><path d="M0 9h118M162 9h118"/><path d="M140 1l8 8-8 8-8-8z" fill="#d8ad4c"/><circle cx="124" cy="9" r="2" fill="#d8ad4c"/><circle cx="156" cy="9" r="2" fill="#d8ad4c"/></g></svg>';

export const STAT_LABELS = [['speed', 'Hız'], ['accel', 'İvme'], ['handling', 'Yol tutuş'], ['weight', 'Ağırlık'], ['offroad', 'Arazi']];

const MODES = [
  { id: 'gp', title: 'Grand Prix', text: 'Dört bölümlük kupa. Her yarış puan getirir.', tags: ['4 bölüm', 'puanlı'], plate: '#f2c14e' },
  { id: 'single', title: 'Tek Yarış', text: 'Bir bölüm seç, yedi rakibe karşı yarış.', tags: ['1 bölüm', '8 sürücü'], plate: '#d9483b' },
  { id: 'tt', title: 'Zamana Karşı', text: 'Tek başına, en iyi turunun hayaletine karşı.', tags: ['hayalet', 'rekor'], plate: '#5f7fa3' },
];

const CLASSES = [
  { cls: '80', plate: 'var(--rose)', name: 'İnce kâğıt', text: 'Sakin hız, bol düşünme payı.', color: '#f8f2e4', edge: ['#e7dcc2', '#d8cba9'], layers: 1, gauge: 1, curl: true },
  { cls: '120', plate: 'var(--blue)', name: 'Defter kâğıdı', text: 'Asıl yarış burada başlıyor.', color: '#dfeaf0', edge: ['#b3c9d6', '#9db7c6'], layers: 3, gauge: 2, lined: true,
    pattern: 'repeating-linear-gradient(180deg, transparent 0 1.4em, rgba(95,127,163,.42) 1.4em calc(1.4em + 1.5px)), linear-gradient(90deg, transparent 1.9em, rgba(217,72,59,.6) 1.9em calc(1.9em + 1.5px), transparent calc(1.9em + 1.5px))' },
  { cls: '200', plate: 'var(--paper-hi)', name: 'Karton', text: 'Çok hızlı, hiç affetmez.', color: '#d6ad76', edge: ['#b88f58', '#a37b47'], layers: 8, gauge: 3,
    pattern: 'radial-gradient(circle at 20% 30%, rgba(96,62,28,.4) 0 1px, transparent 1.6px) 0 0/13px 11px, radial-gradient(circle at 70% 60%, rgba(255,242,214,.45) 0 1px, transparent 1.6px) 0 0/17px 19px, radial-gradient(circle at 40% 80%, rgba(96,62,28,.25) 0 .5px, transparent 1.2px) 0 0/7px 9px' },
];

export function sheet(content, { dk = 0, rot = 0, cls = '' } = {}) {
  return h('div', { class: 'kk-sheet ' + cls, style: { transform: `rotate(${rot}deg)` } },
    h('div', { class: `kk-paper kk-dk${dk}` }, content));
}

export function createMenus(ctx) {
  const { game } = ctx;
  const layer = h('div', { class: 'kk-layer kk-menus' });
  const timers = new Set();
  let screen = null;
  let current = null;

  // ------------------------------------------------------------- cover
  const coverWrap = h('div', { class: 'kk-coverwrap kk-hit' });
  const cover = h('div', { class: 'kk-cover' });
  const ctaGlyph = h('span', { 'data-glyph': 'confirm' });
  cover.append(
    h('div', { class: 'kk-hinge' }),
    h('div', { class: 'kk-frame' }),
    h('div', { class: 'kk-cover-inner' },
      h('div', { class: 'kk-cover-kicker' }, up('Açılır kitap yarışı')),
      h('div', { class: 'kk-cover-title' }, lt('Kâğıt Kart', 'head', { seed: 7, halftone: true,
        colors: { fill: ['var(--mustard)', 'var(--red)', '#8fb3d9', 'var(--rose)', 'var(--paper-hi)', '#9cc56b', 'var(--mustard)', 'var(--red)', '#8fb3d9'], shadow: '#10232a', plate: null } })),
      svg(RULE, 'kk-cover-rule'),
      svg(KART_EMBLEM, 'kk-cover-emblem'),
      h('div', { class: 'kk-cover-cta' }, sheet([h('span', null, 'Başlamak için dokun'), ctaGlyph], { dk: 1 }))),
    h('div', { class: 'kk-bookmark' }, h('i')),
    h('div', { class: 'kk-cover-shade' }));
  coverWrap.appendChild(cover);
  let coverState = 'closed';

  coverWrap.addEventListener('click', () => { if (coverState === 'closed') startGame(); });

  function startGame() {
    ctx.click();
    ctx.api('unlockAudio');
    try { game.renderer?.domElement?.focus?.({ preventScroll: true }); } catch { /* focus is best effort */ }
    ctx.api('setMenuScreen', 'mode');
  }

  function openCover() {
    if (coverState === 'open' || coverState === 'opening') return;
    coverState = 'opening';
    cover.classList.remove('is-closing');
    if (ctx.reduced()) { coverWrap.classList.add('is-open'); coverState = 'open'; return; }
    cover.classList.add('is-opening');
    coverWrap.classList.add('is-open');
    later(() => { if (coverState === 'opening') coverState = 'open'; }, 950);
  }

  function closeCover() {
    if (coverState === 'closed') return;
    coverState = 'closed';
    cover.classList.remove('is-opening');
    coverWrap.classList.remove('is-open');
    if (!ctx.reduced()) {
      cover.classList.add('is-closing');
      later(() => cover.classList.remove('is-closing'), 720);
    }
  }

  function setCoverInstant(open) {
    cover.classList.remove('is-opening', 'is-closing');
    coverWrap.classList.toggle('is-open', open);
    coverWrap.hidden = open;
    coverState = open ? 'open' : 'closed';
  }

  function later(fn, ms) {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
  }

  // ------------------------------------------------------------- screen scaffolding
  const STEP_NAMES = [['mode', 'Mod'], ['class', 'Gramaj'], ['character', 'Sürücü'], ['track', 'Bölüm']];

  function chrome(el, { title, kicker, back, step }) {
    if (back) {
      el.classList.add('kk-hasback');
      const b = h('button', { class: 'kk-back kk-pop', 'aria-label': 'Geri' }, sheet(svg(BACK_ARROW), { dk: 4, rot: -2 }));
      b.addEventListener('click', (e) => { if (e.detail !== 0) { ctx.click(); back(); } });
      el.appendChild(b);
    }
    el.appendChild(h('div', { class: 'kk-head kk-pop' }, sheet([
      kicker ? h('div', { class: 'kk-kicker' }, up(kicker)) : null,
      h('div', { class: 'kk-h' }, lt(title))], { dk: 2 })));
    if (step) {
      const mode = game.selection?.mode || 'gp';
      const names = STEP_NAMES.filter(([id]) => mode !== 'gp' || id !== 'track');
      const idx = names.findIndex(([id]) => id === step);
      el.appendChild(h('div', { class: 'kk-steps' }, names.map(([id, label], i) =>
        h('div', { class: 'kk-step' + (i < idx ? ' is-done' : i === idx ? ' is-now' : '') },
          h('b', null, lt(String(i + 1), 'label', { colors: { fill: i === idx ? 'var(--mustard)' : i < idx ? 'var(--ink)' : 'var(--ink3)', shadow: i === idx ? 'rgba(0,0,0,.5)' : 'rgba(45,42,50,.2)' } })), label))));
    }
    const prompts = h('div', { class: 'kk-prompts' },
      h('span', null, h('span', { 'data-glyph': 'confirm' }), 'Seç'),
      back ? h('span', null, h('span', { 'data-glyph': 'back' }), 'Geri') : null);
    el.appendChild(prompts);
  }

  function popDelay(el, i) { el.style.animationDelay = `${60 + i * 70}ms`; return el; }

  // ------------------------------------------------------------- mode
  function buildMode() {
    const el = h('div', { class: 'kk-screen' });
    const back = () => ctx.api('setMenuScreen', 'title');
    chrome(el, { title: 'Nasıl yarışalım?', kicker: 'Kâğıt Kart', back, step: 'mode' });
    const row = h('div', { class: 'kk-row' });
    const items = MODES.map((m, i) => {
      const card = popDelay(h('button', { class: 'kk-card kk-pop' },
        sheet([
          h('div', { class: 'kk-art' }, h('div', { class: 'kk-dots', style: { color: m.plate } }), svg(MODE_ART[m.id])),
          h('div', { class: 'kk-h' }, lt(m.title, 'card', { colors: { plate: m.plate } })),
          h('p', null, m.text),
          h('div', { class: 'kk-meta' }, m.tags.map((t) => h('span', { class: 'kk-tag' }, up(t))))],
        { dk: i, rot: tilt(i) }),
        h('i', { class: 'kk-ribbon' })), i);
      row.appendChild(card);
      return { el: card, confirm: () => { ctx.api('setSelection', { mode: m.id }); ctx.api('setMenuScreen', 'class'); } };
    });
    el.appendChild(row);
    const mini = h('div', { class: 'kk-mini' });
    const mk = (label, icon, target, i) => {
      const b = popDelay(h('button', { class: 'kk-minibtn kk-pop' }, sheet([svg(icon), label], { dk: 3 + i, rot: tilt(5 + i) })), 3 + i);
      mini.appendChild(b);
      return { el: b, confirm: () => ctx.api('setMenuScreen', target) };
    };
    items.push(mk('Ayarlar', GEAR, 'settings', 0), mk('Kontroller', PAD, 'controls', 1));
    el.appendChild(mini);
    const focus = new FocusList(ctx, { onBack: back });
    const idx = Math.max(0, MODES.findIndex((m) => m.id === game.selection?.mode));
    return { el, focus, items, index: idx };
  }

  // ------------------------------------------------------------- class
  function buildClass() {
    const el = h('div', { class: 'kk-screen' });
    const back = () => ctx.api('setMenuScreen', 'mode');
    chrome(el, { title: 'Kâğıt gramajı', kicker: 'Hız sınıfı', back, step: 'class' });
    const row = h('div', { class: 'kk-row' });
    const items = CLASSES.map((c, i) => {
      const shadows = [];
      for (let k = 1; k <= c.layers; k++) shadows.push(`${(k * 0.1).toFixed(2)}em ${(k * 0.1).toFixed(2)}em 0 ${c.edge[k % 2]}`);
      const L = c.layers * 0.1;
      shadows.push(`${(L + 0.28).toFixed(2)}em ${(L + 0.34).toFixed(2)}em 0 rgba(45,42,50,.85)`);
      const gauge = h('div', { class: 'kk-gauge' }, up('Hız'), [1, 2, 3].map((n) => h('i', { class: n <= c.gauge ? 'on' : '' })));
      const face = h('div', { class: 'kk-face' + (c.lined ? ' is-lined' : ''), style: { background: c.pattern ? `${c.pattern}, ${c.color}` : c.color, boxShadow: shadows.join(','), transform: `rotate(${tilt(i + 2)}deg)` } },
        h('div', { class: 'kk-w' }, lt(c.cls, 'card', { colors: { plate: c.plate } }), h('small', null, 'g')),
        h('div', { class: 'kk-name' }, c.name),
        h('p', null, c.text),
        gauge,
        c.curl ? h('i', { class: 'kk-curl' }) : null);
      const card = popDelay(h('button', { class: 'kk-swatch kk-pop' }, face, h('i', { class: 'kk-ribbon' })), i);
      row.appendChild(card);
      return { el: card, confirm: () => {
        ctx.api('setSelection', { cls: c.cls });
        ctx.api('setMenuScreen', 'character', { characterId: game.selection?.characterId || ctx.roster()[0]?.id || 'tilki' });
      } };
    });
    el.appendChild(row);
    const focus = new FocusList(ctx, { onBack: back });
    const idx = Math.max(0, CLASSES.findIndex((c) => c.cls === String(game.selection?.cls ?? '120')));
    return { el, focus, items, index: idx };
  }

  // ------------------------------------------------------------- character
  function buildCharacter() {
    const el = h('div', { class: 'kk-screen' });
    const back = () => ctx.api('setMenuScreen', 'class');
    chrome(el, { title: 'Sürücünü seç', kicker: 'Sürücü', back, step: 'character' });
    const roster = ctx.roster();
    const nameLt = lt('');
    const nameEl = h('div', { class: 'kk-h' }, nameLt);
    const animalEl = h('div', { class: 'kk-animal' });
    const statRows = STAT_LABELS.map(([key, label]) => {
      const ticks = h('div', { class: 'kk-ticks' }, [1, 2, 3, 4, 5].map(() => h('i')));
      return { key, label, ticks };
    });
    el.appendChild(h('div', { class: 'kk-charinfo kk-pop' }, sheet([
      h('div', { class: 'kk-kicker' }, up('Sürücü kartı')), nameEl, animalEl,
      h('div', { class: 'kk-stats' }, statRows.map((s) => [h('span', null, s.label), s.ticks]))], { dk: 1 })));
    const strip = h('div', { class: 'kk-roster' });
    const chosen = game.selection?.characterId;
    const items = roster.map((c, i) => {
      const chip = popDelay(h('button', { class: 'kk-chip kk-pop' },
        sheet([svg(portrait(c)), h('b', null, c.name || c.id)], { dk: i % 5, rot: tilt(i + 1) }),
        h('i', { class: 'kk-ribbon' })), i * 0.6);
      strip.appendChild(chip);
      return {
        el: chip,
        onFocus: () => {
          setLt(nameLt, c.name || c.id);
          animalEl.textContent = cap(c.animal || '');
          for (const s of statRows) {
            const v = Math.max(0, Math.min(5, Math.round(c.stats?.[s.key] ?? 0)));
            [...s.ticks.children].forEach((t, k) => t.classList.toggle('on', k < v));
          }
          if (game.menuScreen === 'character') ctx.api('setMenuScreen', 'character', { characterId: c.id });
        },
        confirm: () => {
          ctx.api('setSelection', { characterId: c.id });
          const sel = game.selection || {};
          if ((sel.mode || 'gp') === 'gp') ctx.api('startGP', { cls: String(sel.cls ?? '120'), character: c.id });
          else ctx.api('setMenuScreen', 'track', { trackId: sel.trackId || ctx.cup()[0] });
        },
      };
    });
    el.appendChild(strip);
    const focus = new FocusList(ctx, { onBack: back });
    const idx = Math.max(0, roster.findIndex((c) => c.id === (chosen || 'tilki')));
    return { el, focus, items, index: idx };
  }

  // ------------------------------------------------------------- track
  function buildTrack() {
    const el = h('div', { class: 'kk-screen' });
    const back = () => ctx.api('setMenuScreen', 'character', { characterId: game.selection?.characterId || 'tilki' });
    const tt = game.selection?.mode === 'tt';
    chrome(el, { title: 'Bölüm seç', kicker: `${tt ? 'Zamana Karşı' : 'Tek Yarış'} · adım 4/4`, back });
    const defs = ctx.cup().map((id) => ctx.tracks()[id]).filter(Boolean);
    const numEl = h('div', { class: 'kk-kicker' });
    const titleLt = lt('');
    const titleEl = h('div', { class: 'kk-h' }, titleLt);
    const subEl = h('p');
    const bestEl = h('div', { class: 'kk-best' });
    const sketchEl = h('span', { class: 'kk-svg' });
    el.appendChild(h('div', { class: 'kk-chapter kk-pop' }, sheet(
      [h('div', null, numEl, titleEl, subEl, bestEl), sketchEl], { dk: 3 })));
    const tabs = h('div', { class: 'kk-chapters' });
    const items = defs.map((d, i) => {
      const accent = d.theme?.accents?.[0] || d.theme?.offroad || '#d9483b';
      const tab = popDelay(h('button', { class: 'kk-chtab kk-pop' }, h('div', { class: 'kk-sheet' },
        h('div', { class: 'kk-paper', style: { borderLeft: `.55em solid ${accent}` } },
          h('span', { class: 'kk-num' }, lt(String(d.chapter ?? i + 1), 'card', { colors: { plate: accent } })),
          h('span', null, h('b', null, d.name || d.id))))), i);
      tabs.appendChild(tab);
      return {
        el: tab,
        onFocus: () => {
          numEl.textContent = up(`Bölüm ${d.chapter ?? i + 1}`);
          setLt(titleLt, d.name || d.id);
          subEl.textContent = d.subtitle || '';
          sketchEl.innerHTML = trackSketch(d.points);
          clear(bestEl);
          const best = tt ? ctx.best(d.id) : null;
          if (best && (best.lap || best.race)) {
            if (best.race) bestEl.append(h('span', null, 'Rekor'), ctx.fmt(best.race));
            if (best.lap) bestEl.append(h('span', null, 'En iyi tur'), ctx.fmt(best.lap));
          }
          if (game.menuScreen === 'track') ctx.api('setMenuScreen', 'track', { trackId: d.id });
        },
        confirm: () => {
          ctx.api('setSelection', { trackId: d.id });
          const sel = game.selection || {};
          ctx.api('startRace', { mode: tt ? 'tt' : 'single', track: d.id, cls: String(sel.cls ?? '120'), character: sel.characterId || 'tilki' });
        },
      };
    });
    el.appendChild(tabs);
    const focus = new FocusList(ctx, { onBack: back });
    const idx = Math.max(0, defs.findIndex((d) => d.id === game.selection?.trackId));
    return { el, focus, items, index: idx };
  }

  // ------------------------------------------------------------- settings / controls
  function buildForm(kind) {
    const el = h('div', { class: 'kk-screen' });
    const back = () => ctx.api('setMenuScreen', 'mode');
    chrome(el, { title: kind === 'settings' ? 'Ayarlar' : 'Kontroller', kicker: 'Kitabın ayarları', back });
    const form = kind === 'settings' ? createSettingsForm(ctx, { onBack: back }) : createControlsForm(ctx, { onBack: back });
    el.querySelector('.kk-head').remove();
    el.appendChild(h('div', { class: 'kk-form kk-pop' }, sheet([
      h('div', { class: 'kk-h' }, lt(kind === 'settings' ? 'Ayarlar' : 'Kontroller')), form.el], { dk: 2 })));
    return { el, focus: form.focus, form };
  }

  const BUILDERS = { mode: buildMode, class: buildClass, character: buildCharacter, track: buildTrack,
    settings: () => buildForm('settings'), controls: () => buildForm('controls') };

  function show(name) {
    if (name === screen) return;
    const prev = current;
    if (prev) {
      prev.focus?.release();
      prev.form?.dispose?.();
      if (ctx.reduced()) prev.el.remove();
      else {
        prev.el.classList.add('kk-folding');
        prev.el.style.pointerEvents = 'none';
        later(() => prev.el.remove(), 170);
      }
    }
    screen = name;
    current = null;
    const build = BUILDERS[name];
    if (!build) return;
    current = build();
    layer.appendChild(current.el);
    if (current.items) current.focus.set(current.items, current.index || 0);
    ctx.glyphs(current.el);
  }

  function hide() { show(null); }

  function handle(nav) {
    if (screen === 'title' || (!screen && coverState === 'closed')) {
      if (nav.confirm) { startGame(); return true; }
      return false;
    }
    return current ? current.focus.handle(nav) : false;
  }

  function refresh() { current?.form?.refresh?.(); }

  function dispose() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    current?.focus?.release();
    current?.form?.dispose?.();
  }

  return { layer, coverWrap, show, hide, handle, refresh, openCover, closeCover, setCoverInstant, dispose, get screen() { return screen; } };
}

// ----------------------------------------------------------------- intro chapter card
export function createIntroCard(ctx) {
  const { game } = ctx;
  const el = h('div', { class: 'kk-screen' });
  const def = game.trackDef || game.track?.def || {};
  const name = def.name || '';
  const card = h('div', { class: 'kk-intro kk-pop' }, sheet([
    h('div', { class: 'kk-kicker' }, up(`Bölüm ${def.chapter ?? ''}`.trim())),
    h('div', { class: 'kk-h' }, lt(name)),
    svg(RULE_INK, 'kk-intro-rule'),
    def.subtitle ? h('p', null, def.subtitle) : null], { dk: 1 }));
  const skip = h('button', { class: 'kk-skip kk-pop' }, sheet([h('span', { 'data-glyph': 'confirm' }), 'Geç'], { dk: 4, rot: 1.5 }));
  el.append(card, skip);
  skip.addEventListener('click', (e) => { if (e.detail !== 0) { ctx.click(); ctx.api('skipCinematic'); } });
  ctx.glyphs(el);
  return {
    el,
    handle(nav) {
      if (nav.confirm || nav.back) { ctx.click(); ctx.api('skipCinematic'); return true; }
      return false;
    },
  };
}
