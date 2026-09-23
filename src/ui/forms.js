// Settings and Controls pages. Shared by the main menu and the pause menu.
import { h, svg, clear } from './dom.js';
import { FocusList } from './nav.js';

const PENCIL_CIRCLE = `<svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path d="M9 25C5 9 88 2 95 17C99 31 24 39 7 27C2 19 30 5 66 7" fill="none" stroke="#d9483b" stroke-width="2.4" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;

const ON_OFF = [[true, 'Açık'], [false, 'Kapalı']];

export const SETTING_ROWS = [
  { key: 'musicVolume', label: 'Müzik', type: 'range' },
  { key: 'sfxVolume', label: 'Efektler', type: 'range' },
  { key: 'muted', label: 'Ses', type: 'mute', options: [[false, 'Açık'], [true, 'Kapalı']] },
  { key: 'quality', label: 'Görüntü', options: [['auto', 'Otomatik'], ['high', 'Yüksek'], ['medium', 'Orta'], ['low', 'Düşük']] },
  { key: 'reducedMotion', label: 'Hareketi azalt', options: [['auto', 'Sistem'], ['on', 'Açık'], ['off', 'Kapalı']] },
  { key: 'cameraShake', label: 'Kamera sarsıntısı', options: ON_OFF },
  { key: 'touchControls', label: 'Dokunmatik tuşlar', options: [['auto', 'Otomatik'], ['on', 'Açık'], ['off', 'Kapalı']] },
  { key: 'autoAccelerate', label: 'Otomatik gaz', options: ON_OFF },
  { key: 'showFps', label: 'FPS göster', options: ON_OFF },
];

export function createSettingsForm(ctx, { onBack }) {
  const { game } = ctx;
  const rowsEl = h('div', { class: 'kk-rows' });
  const focus = new FocusList(ctx, { onBack });
  const refreshers = [];

  const value = (k) => game.settings?.[k];

  function setValue(row, v) {
    if (row.type === 'mute') {
      if (!!value('muted') !== v) ctx.api('toggleMute');
    } else {
      ctx.api('setSetting', row.key, v);
    }
    refresh();
  }

  const items = SETTING_ROWS.map((row) => {
    const el = h('div', { class: 'kk-srow' }, h('span', null, row.label));
    let item;
    if (row.type === 'range') {
      const bars = h('div', { class: 'kk-bars' });
      const cells = [];
      for (let i = 0; i < 10; i++) {
        const c = h('i', { onclick: (e) => { e.stopPropagation(); setValue(row, (i + 1) / 10); ctx.click(); } });
        cells.push(c);
        bars.appendChild(c);
      }
      const step = (d) => setValue(row, Math.round(Math.max(0, Math.min(1, (value(row.key) ?? 0) + d / 10)) * 10) / 10);
      const minus = h('button', { class: 'kk-arrow', onclick: (e) => { e.stopPropagation(); step(-1); ctx.click(); } }, '◀');
      const plus = h('button', { class: 'kk-arrow', onclick: (e) => { e.stopPropagation(); step(1); ctx.click(); } }, '▶');
      el.appendChild(h('div', { class: 'kk-range' }, minus, bars, plus));
      refreshers.push(() => {
        const n = Math.round((value(row.key) ?? 0) * 10);
        cells.forEach((c, i) => c.classList.toggle('on', i < n));
      });
      item = { el, left: () => { step(-1); ctx.click(); }, right: () => { step(1); ctx.click(); } };
    } else {
      const opts = h('div', { class: 'kk-opts' });
      const optEls = row.options.map(([v, label]) => {
        const o = h('button', { class: 'kk-opt', onclick: (e) => { e.stopPropagation(); setValue(row, v); ctx.click(); } },
          svg(PENCIL_CIRCLE, 'kk-circle'), label);
        opts.appendChild(o);
        return o;
      });
      el.appendChild(opts);
      const cur = () => {
        const v = row.type === 'mute' ? !!value('muted') : value(row.key);
        const i = row.options.findIndex(([x]) => x === v);
        return i < 0 ? 0 : i;
      };
      refreshers.push(() => { const c = cur(); optEls.forEach((o, i) => o.classList.toggle('is-on', i === c)); });
      const shift = (d) => {
        const i = Math.max(0, Math.min(row.options.length - 1, cur() + d));
        if (i !== cur()) { setValue(row, row.options[i][0]); ctx.click(); }
      };
      item = { el, left: () => shift(-1), right: () => shift(1), confirm: () => shift(cur() === row.options.length - 1 ? -(row.options.length - 1) : 1) };
    }
    rowsEl.appendChild(el);
    return item;
  });

  function refresh() { for (const r of refreshers) r(); }
  refresh();
  focus.set(items, 0);

  return { el: rowsEl, focus, refresh, dispose: () => focus.release() };
}

const CONTROLS = {
  keyboard: [
    ['Direksiyon', [['k', '←'], ['k', '→'], ' ya da ', ['k', 'A'], ['k', 'D']]],
    ['Gaz', [['k', '↑'], ['k', 'W']]],
    ['Fren · geri', [['k', '↓'], ['k', 'S']]],
    ['Drift · zıpla', [['k', 'Space'], ' basılı tut + yön']],
    ['Eşya', [['k', 'X'], ['k', 'E'], ' · geriye: ', ['k', '↓'], '+', ['k', 'X']]],
    ['Geri bak', [['k', 'C']]],
    ['Duraklat', [['k', 'Esc'], ['k', 'P']]],
    ['Ses', [['k', 'M']]],
    ['Yeniden başla', [['k', 'R'], ' (Zamana Karşı)']],
  ],
  gamepad: [
    ['Direksiyon', ['Sol çubuk ya da yön tuşları']],
    ['Gaz', [['p', 'A'], ['pw', 'RT']]],
    ['Fren · geri', [['p', 'B'], ['pw', 'LT']]],
    ['Drift · zıpla', [['pw', 'RB'], ' basılı tut + yön']],
    ['Eşya', [['p', 'X'], ['pw', 'LB'], ' · geriye: fren + eşya']],
    ['Geri bak', [['p', 'Y']]],
    ['Duraklat', [['pw', 'Start']]],
  ],
  touch: [
    ['Direksiyon', ['Sol başparmağını sağa sola kaydır']],
    ['Gaz', [['k', 'GAZ'], ' basılı tut (ya da Oto gaz)']],
    ['Drift · zıpla', [['k', 'DRIFT'], ' basılı tut + yön']],
    ['Eşya', [['k', 'EŞYA'], ' ya da eşya penceresi']],
    ['Fren · geri', [['k', 'FREN']]],
    ['Duraklat', ['Üstteki ❚❚ düğmesi']],
  ],
};

export function glyphRow(parts) {
  return parts.map((p) => {
    if (typeof p === 'string') return h('span', null, p);
    const [kind, t] = p;
    if (kind === 'k') return h('span', { class: 'kk-key' }, t);
    return h('span', { class: kind === 'pw' ? 'kk-padb kk-wide' : 'kk-padb' }, t);
  });
}

export function controlRows(device, filter = null) {
  const list = CONTROLS[device] || CONTROLS.keyboard;
  return list.filter(([label]) => !filter || filter.includes(label))
    .map(([label, parts]) => h('div', { class: 'kk-crow' }, h('span', null, label), h('div', null, glyphRow(parts))));
}

const DEVICES = [['keyboard', 'Klavye'], ['gamepad', 'Oyun kolu'], ['touch', 'Dokunmatik']];

export function createControlsForm(ctx, { onBack }) {
  let device = ctx.device();
  const tabsEl = h('div', { class: 'kk-devtabs' });
  const rowsEl = h('div', { class: 'kk-rows' });
  const el = h('div', null, tabsEl, rowsEl);
  const focus = new FocusList(ctx, { onBack });

  const tabs = DEVICES.map(([id, label]) => {
    const t = h('button', { class: 'kk-devtab' }, label);
    tabsEl.appendChild(t);
    return { id, el: t };
  });

  function render() {
    tabs.forEach((t) => t.el.classList.toggle('is-on', t.id === device));
    clear(rowsEl);
    for (const r of controlRows(device)) rowsEl.appendChild(r);
  }

  const pick = (i) => { device = tabs[i].id; render(); };
  const items = tabs.map((t, i) => ({
    el: t.el,
    confirm: () => pick(i),
    onFocus: () => pick(i),
  }));
  render();
  focus.set(items, Math.max(0, DEVICES.findIndex(([id]) => id === device)));
  return { el, focus, dispose: () => focus.release() };
}
