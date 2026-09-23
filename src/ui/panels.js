// Pause menu, results scoreboard, GP standings and podium captions.
import { h, svg, clear, up, lt } from './dom.js';
import { FocusList } from './nav.js';
import { portrait } from './icons.js';
import { sheet } from './menus.js';
import { createSettingsForm, createControlsForm } from './forms.js';

// Podium places in their print colours, everyone else in ink.
const PLACE_FILL = { 1: 'var(--p1)', 2: 'var(--p2)', 3: 'var(--p3)' };
export function placeLt(n, preset = 'num') {
  return lt(`${n}.`, preset, { colors: { fill: PLACE_FILL[n] || 'var(--ink)' } });
}

function button(ctx, label, { primary = false, glyph = null, dk = 4, rot = 0 } = {}) {
  return h('button', { class: 'kk-btn' + (primary ? ' is-primary' : '') },
    sheet([glyph ? h('span', { 'data-glyph': glyph }) : null, label], { dk, rot }));
}

// ----------------------------------------------------------------- pause
export function createPause(ctx) {
  const { game } = ctx;
  const el = h('div', { class: 'kk-layer' });
  el.appendChild(h('div', { class: 'kk-dim' }));
  let page = null;
  let focus = null;
  let form = null;
  let quitArmed = false;

  function resume() { ctx.api('setPaused', false); }

  function showRoot(index = 0) {
    cleanup();
    quitArmed = false;
    const gp = !!game.gp?.active;
    const note = h('div', { class: 'kk-note' });
    const rows = [
      ['Devam', 'I', resume],
      ['Yeniden başla', 'II', () => ctx.api('restartRace')],
      ['Ayarlar', 'III', () => showSub('settings')],
      ['Kontroller', 'IV', () => showSub('controls')],
      ['Menüye dön', 'V', () => {
        if (gp && !quitArmed) { quitArmed = true; note.textContent = 'Kupa ilerlemen silinecek. Emin misin? Tekrar seç.'; return; }
        ctx.api('quitToTitle');
      }],
    ];
    const toc = h('div', { class: 'kk-toc' });
    const items = rows.map(([label, pg, fn]) => {
      const r = h('button', { class: 'kk-tocrow' }, h('span', { class: 'kk-lab' }, label), h('span', { class: 'kk-lead' }),
        h('span', { class: 'kk-pg' }, lt(pg, 'label', { colors: { fill: 'var(--ink2)' } })));
      toc.appendChild(r);
      return { el: r, confirm: fn, onFocus: (it, i) => { if (i !== 4 && quitArmed) { quitArmed = false; note.textContent = gpNote(); } } };
    });
    const gpNote = () => (gp ? 'Grand Prix: yeniden başlarsan bu yarış puan vermez.' : '');
    note.textContent = gpNote();
    page = h('div', { class: 'kk-pause kk-pop' }, sheet([
      h('div', { class: 'kk-kicker' }, up('Mola')), h('div', { class: 'kk-h' }, lt('Duraklatıldı')), toc, note], { dk: 2 }));
    el.appendChild(page);
    // Core only opens the pause (and uses up that Esc); closing it is ours: back or pause at the root resumes.
    focus = new FocusList(ctx, { onBack: resume });
    focus.set(items, index);
    ctx.glyphs(el);
  }

  function showSub(kind) {
    cleanup();
    const back = () => showRoot(kind === 'settings' ? 2 : 3);
    form = kind === 'settings' ? createSettingsForm(ctx, { onBack: back }) : createControlsForm(ctx, { onBack: back });
    const backBtn = button(ctx, 'Geri', { glyph: 'back', dk: 3 });
    backBtn.addEventListener('click', (e) => { if (e.detail !== 0) { ctx.click(); back(); } });
    page = h('div', { class: 'kk-form kk-pop' }, sheet([
      h('div', { class: 'kk-h' }, lt(kind === 'settings' ? 'Ayarlar' : 'Kontroller')), form.el,
      h('div', { class: 'kk-actions' }, backBtn)], { dk: 1 }));
    el.appendChild(page);
    focus = form.focus;
    ctx.glyphs(el);
  }

  function cleanup() {
    focus?.release();
    form?.dispose?.();
    form = null;
    page?.remove();
    page = null;
  }

  return {
    el,
    open() { showRoot(0); },
    close() { cleanup(); },
    // Esc is both back and pause: on a sub-page it goes back to the contents. P / Start alone resumes from anywhere.
    handle(nav) {
      if (!focus) return false;
      if (nav.pause && !nav.back) { ctx.click(); resume(); return true; }
      return focus.handle(nav);
    },
    refresh() { form?.refresh?.(); },
    dispose: cleanup,
  };
}

// ----------------------------------------------------------------- results / standings / podium
export function sortStandings(game) {
  const st = game.gp?.standings || {};
  const last = game.gp?.lastPlaces || {};
  const tt = game.gp?.totalTimes || {};
  return Object.keys(st).sort((a, b) => ((st[b] || 0) - (st[a] || 0)) || ((last[a] || 99) - (last[b] || 99)) || ((tt[a] || 0) - (tt[b] || 0)));
}

export function createResults(ctx) {
  const { game } = ctx;
  const el = h('div', { class: 'kk-layer' });
  let focus = null;
  let view = null;
  let shownFor = null;

  function charOf(id) { return ctx.roster().find((c) => c.id === id) || { id, name: id }; }
  function playerId() { return game.player?.id || game.player?.character?.id || game.selection?.characterId; }

  function board({ kicker, title, table, actions, cls = '' }) {
    clear(el);
    focus?.release();
    const acts = h('div', { class: 'kk-actions' });
    const items = actions.map(([label, fn, primary], i) => {
      const b = button(ctx, label, { primary, glyph: primary ? 'confirm' : null, dk: (i + 2) % 5, rot: primary ? -1 : 1 });
      acts.appendChild(b);
      return { el: b, confirm: fn };
    });
    el.appendChild(h('div', { class: 'kk-board kk-pop ' + cls }, sheet([
      h('div', { class: 'kk-board-top' }, h('div', null, h('div', { class: 'kk-kicker' }, up(kicker)), h('div', { class: 'kk-h' }, lt(title)))),
      table, acts], { dk: 0 })));
    focus = new FocusList(ctx);
    focus.set(items, items.findIndex((_, i) => actions[i][2]) >= 0 ? items.findIndex((_, i) => actions[i][2]) : 0);
    ctx.glyphs(el);
  }

  function rowAnim(tr, i) { tr.style.animationDelay = `${250 + i * 90}ms`; return tr; }

  function showTT() {
    const p = game.player;
    const laps = Array.isArray(p?.lapTimes) ? p.lapTimes : [];
    const bestLap = laps.length ? Math.min(...laps) : null;
    const def = game.trackDef || game.track?.def || {};
    const table = h('div', { class: 'kk-table kk-rows-in' });
    table.appendChild(h('div', { class: 'kk-tr kk-th' }, h('span', null, up('Tur')), h('span'), h('span'),
      h('span', { style: { textAlign: 'right' } }, up('Süre')), h('span'), h('span')));
    laps.forEach((t, i) => table.appendChild(rowAnim(h('div', { class: 'kk-tr' },
      h('span', { class: 'kk-pl' }, lt(`${i + 1}.`, 'num')), h('span'), h('span', { class: 'kk-nm' }, 'tur'),
      h('span', { class: 'kk-t' }, ctx.fmt(t)), t === bestLap ? h('span', { class: 'kk-tag' }, up('En iyi')) : h('span'), h('span')), i)));
    const total = p?.finishTime ?? game.race?.results?.[0]?.time;
    table.appendChild(rowAnim(h('div', { class: 'kk-tr is-total is-me' },
      h('span'), svg(portrait(charOf(playerId()))), h('span', { class: 'kk-nm' }, 'Toplam'),
      h('span', { class: 'kk-t' }, ctx.fmt(total)), h('span'), h('span')), laps.length));
    // Core writes the new best before the UI draws results, so equality means this run set it.
    const best = ctx.best(def.id);
    const record = best?.race != null && total != null && Math.abs(best.race - total) < 1e-3;
    board({ kicker: `Bölüm ${def.chapter ?? ''} · Zamana Karşı`, title: def.name || 'Zamana Karşı', table,
      actions: [['Tekrar dene', () => ctx.api('restartRace'), true], ['Menüye dön', () => ctx.api('quitToTitle')]] });
    if (record) el.querySelector('.kk-board .kk-paper')?.appendChild(h('div', { class: 'kk-rekor' }, lt('Yeni rekor!', 'stamp', { colors: { ink: 'var(--red)' } })));
  }

  function showResults() {
    view = 'results';
    shownFor = game.race?.results || null;
    if (game.mode === 'tt') { showTT(); return; }
    const results = (game.race?.results || []).slice().sort((a, b) => a.place - b.place);
    const gp = !!game.gp?.active;
    const tt = game.mode === 'tt';
    const def = game.trackDef || game.track?.def || {};
    const me = playerId();
    const table = h('div', { class: 'kk-table kk-rows-in' });
    table.appendChild(h('div', { class: 'kk-tr kk-th' }, h('span', null, up('Sıra')), h('span'), h('span', null, up('Sürücü')),
      h('span', { style: { textAlign: 'right' } }, up('Süre')), h('span', { style: { textAlign: 'right' } }, up('En iyi tur')),
      h('span', { style: { textAlign: 'right' } }, gp ? up('Puan') : '')));
    results.forEach((r, i) => {
      const c = charOf(r.characterId || r.kartId);
      const p = r.place;
      table.appendChild(rowAnim(h('div', { class: 'kk-tr' + ((r.characterId || r.kartId) === me ? ' is-me' : '') },
        h('span', { class: 'kk-pl' }, placeLt(p)),
        svg(portrait(c)),
        h('span', { class: 'kk-nm' }, c.name || c.id),
        h('span', { class: 'kk-t' + (r.estimated ? ' is-est' : '') }, (r.estimated ? '≈ ' : '') + ctx.fmt(r.time)),
        h('span', { class: 'kk-t' }, r.bestLap ? ctx.fmt(r.bestLap) : '—'),
        h('span', { class: 'kk-pts' }, gp ? [lt(String(r.totalPoints ?? 0), 'num'), r.points ? h('span', { class: 'kk-plus' }, `+${r.points}`) : null] : '')), i));
    });
    const actions = gp
      ? [['Puan tablosu', showStandings, true], ['Menüye dön', () => ctx.api('quitToTitle')]]
      : [[tt ? 'Tekrar dene' : 'Tekrar yarış', () => ctx.api('restartRace'), true], ['Menüye dön', () => ctx.api('quitToTitle')]];
    const kicker = `Bölüm ${def.chapter ?? ''} · ${tt ? 'Zamana Karşı' : 'Sonuçlar'}`;
    board({ kicker, title: def.name || 'Sonuçlar', table, actions });
  }

  function showStandings() {
    view = 'standings';
    const gp = game.gp || {};
    const order = sortStandings(game);
    const st = gp.standings || {};
    const max = Math.max(1, ...order.map((id) => st[id] || 0));
    const prev = ctx.prevStandings();
    const prevOrder = prev ? Object.keys(prev).sort((a, b) => prev[b] - prev[a]) : null;
    const me = playerId();
    const table = h('div', { class: 'kk-table kk-rows-in' });
    table.appendChild(h('div', { class: 'kk-tr kk-th' }, h('span', null, up('Sıra')), h('span'), h('span', null, up('Sürücü')), h('span'),
      h('span', { style: { textAlign: 'right' } }, up('Puan')), h('span')));
    order.forEach((id, i) => {
      const c = charOf(id);
      const color = c.colors?.body || '#2d2a32';
      let move = '';
      let cls = '';
      if (prevOrder) {
        const d = prevOrder.indexOf(id) - i;
        if (d > 0) { move = `▲${d}`; cls = 'up'; } else if (d < 0) { move = `▼${-d}`; cls = 'down'; }
      }
      table.appendChild(rowAnim(h('div', { class: 'kk-tr' + (id === me ? ' is-me' : '') },
        h('span', { class: 'kk-pl' }, placeLt(i + 1)),
        svg(portrait(c)),
        h('span', { class: 'kk-nm' }, c.name || c.id),
        h('span', null, h('div', { class: 'kk-bar', style: { width: `${((st[id] || 0) / max) * 100}%`, background: color } })),
        h('span', { class: 'kk-pts' }, lt(String(st[id] || 0), 'num')),
        h('span', { class: `kk-move ${cls}` }, move)), i));
    });
    const idx = gp.index ?? 0;
    const total = gp.cup?.length ?? 4;
    const last = idx >= total - 1;
    const nextId = gp.cup?.[idx + 1];
    const nextName = nextId ? (ctx.tracks()[nextId]?.name || nextId) : '';
    const actions = [
      [last ? 'Ödül törenine geç' : `Sonraki bölüm: ${nextName}`, () => ctx.api('nextRace'), true],
      ['Menüye dön', () => ctx.api('quitToTitle')],
    ];
    board({ kicker: `Grand Prix · ${idx + 1}/${total} bölüm sonrası`, title: 'Kupa sıralaması', table, actions, cls: 'kk-std' });
  }

  return {
    el,
    open() { showResults(); },
    get view() { return view; },
    // A new results array (restart, next race) must redraw even if the phase never left 'results'.
    stale() { return !!game.race?.results && game.race.results !== shownFor; },
    ready() { return Array.isArray(game.race?.results) && game.race.results.length > 0; },
    close() { focus?.release(); focus = null; clear(el); view = null; shownFor = null; },
    handle(nav) { return focus ? focus.handle(nav) : false; },
    showStandings,
    dispose() { focus?.release(); },
  };
}

export function createPodium(ctx) {
  const { game } = ctx;
  const el = h('div', { class: 'kk-layer' });
  let focus = null;

  function open() {
    clear(el);
    const order = sortStandings(game);
    const st = game.gp?.standings || {};
    const me = game.player?.id || game.selection?.characterId;
    const myPlace = order.indexOf(me) + 1;
    const head = myPlace === 1 ? 'Kupa senin!' : myPlace > 0 && myPlace <= 3 ? 'Podyumdasın!' : 'Kupa tamamlandı';
    el.appendChild(h('div', { class: 'kk-podium-head kk-pop' }, sheet([
      h('div', { class: 'kk-kicker' }, up('Son bölüm · ödül töreni')), h('div', { class: 'kk-h' }, lt(head, 'head', { colors: { plate: 'var(--mustard)' } })),
      myPlace > 3 ? h('div', { class: 'kk-animal' }, `Sen ${myPlace}. oldun · ${st[me] || 0} puan`) : null], { dk: 2 })));
    const caps = h('div', { class: 'kk-podium' });
    order.slice(0, 3).forEach((id, i) => {
      const c = ctx.roster().find((r) => r.id === id) || { id, name: id };
      const cap = h('div', { class: `kk-cap c${i + 1} kk-pop`, style: { animationDelay: `${400 + (2 - i) * 250}ms` } }, sheet([
        h('div', { class: 'kk-pl' }, placeLt(i + 1, 'card')), h('div', null, h('b', null, c.name || id), h('span', null, `${st[id] || 0} puan`))], { dk: i + 1 }));
      caps.appendChild(cap);
    });
    el.appendChild(caps);
    const go = button(ctx, 'Menüye dön', { primary: true, glyph: 'confirm', dk: 4, rot: -1 });
    el.appendChild(h('div', { class: 'kk-podium-go kk-pop', style: { animationDelay: '1.4s' } }, go));
    focus?.release();
    focus = new FocusList(ctx);
    focus.set([{ el: go, confirm: () => ctx.api('quitToTitle') }], 0);
    ctx.glyphs(el);
  }

  return {
    el, open,
    close() { focus?.release(); focus = null; clear(el); },
    handle(nav) { return focus ? focus.handle(nav) : false; },
    dispose() { focus?.release(); },
  };
}
