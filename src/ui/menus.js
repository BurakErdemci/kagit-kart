// Title cover and the menu screens (mode, class, character, track, settings, controls) plus the
// chapter card shown during the intro flyover.
import { h, svg, clear, tilt, up, cap, lt, setLt } from './dom.js';
import { FocusList } from './nav.js';
import { MODE_ART, portrait, trackSketch } from './icons.js';
import { createSettingsForm, createControlsForm } from './forms.js';

const BACK_ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="#f3ead3" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="#2d2a32" stroke-width="2.2" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></g></svg>';
const PAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="#2d2a32" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><path d="M6 8h12a4 4 0 0 1 4 4l-.6 4a2.5 2.5 0 0 1-4.4 1.2L15.5 15h-7L7 17.2a2.5 2.5 0 0 1-4.4-1.2L2 12a4 4 0 0 1 4-4z"/><path d="M7 10.5v3M5.5 12h3"/></g><circle cx="16" cy="11" r="1.1" fill="#2d2a32"/><circle cx="18" cy="13" r="1.1" fill="#2d2a32"/></svg>';
const RULE_INK = '<svg viewBox="0 0 280 18" aria-hidden="true"><g stroke="#2d2a32" stroke-width="2" fill="none" opacity=".55"><path d="M0 9h118M162 9h118"/><path d="M140 2l7 7-7 7-7-7z" fill="#d9483b" stroke="none"/></g></svg>';

export const STAT_LABELS = [['speed', 'Hız'], ['accel', 'İvme'], ['handling', 'Yol tutuş'], ['weight', 'Ağırlık'], ['offroad', 'Arazi']];

const MODES = [
  // 'Prix' is French: written in capitals so the Turkish upper-casing leaves its I undotted
  { id: 'gp', title: 'GRAND PRIX', text: 'Dört bölümlük kupa. Her yarış puan getirir.', tags: ['4 bölüm', 'puanlı'], plate: '#f2c14e' },
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

  // ------------------------------------------------------------- title
  // The book on the desk is the cover now (cinematics' title shot draws it, title lettering included);
  // the DOM only adds a pinned paper tag and takes the click or tap anywhere on the screen.
  const coverWrap = h('div', { class: 'kk-coverwrap kk-hit', role: 'button', 'aria-label': 'Kâğıt Kart: başlamak için dokun' });
  const ctaGlyph = h('span', { 'data-glyph': 'confirm' });
  const cta = h('div', { class: 'kk-cover-cta' },
    h('i', { class: 'kk-tape' }),
    sheet([h('span', null, 'Başlamak için dokun'), ctaGlyph], { dk: 1 }));
  coverWrap.append(h('h1', { class: 'kk-sr' }, 'Kâğıt Kart'), cta);
  let coverState = 'closed';

  coverWrap.addEventListener('click', () => { if (coverState === 'closed') startGame(); });

  function startGame() {
    ctx.click();
    ctx.api('unlockAudio');
    try { game.renderer?.domElement?.focus?.({ preventScroll: true }); } catch { /* focus is best effort */ }
    ctx.api('setMenuScreen', 'mode');
  }

  // The tag folds down as the cover opens and stands up again once the book has shut.
  function openCover() {
    if (coverState === 'open') return;
    coverState = 'open';
    cta.classList.remove('is-back');
    if (ctx.reduced()) { coverWrap.hidden = true; return; }
    cta.classList.add('is-away');
    later(() => { if (coverState === 'open') coverWrap.hidden = true; }, 260);
  }

  function closeCover() {
    if (coverState === 'closed') return;
    coverState = 'closed';
    coverWrap.hidden = false;
    cta.classList.remove('is-away');
    if (!ctx.reduced()) {
      cta.classList.remove('is-back');
      void cta.offsetWidth;
      cta.classList.add('is-back');
    }
  }

  function setCoverInstant(open) {
    cta.classList.remove('is-away', 'is-back');
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

  function popDelay(el, i) { el.style.setProperty('--d', `${60 + i * 70}ms`); return el; }

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

  // late: the first screen after the title waits for the book's cover to land before its cards rise.
  function show(name, { late = false } = {}) {
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
    if (late && !ctx.reduced()) current.el.classList.add('kk-late');
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
