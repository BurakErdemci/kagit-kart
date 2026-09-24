// Teaching: the first-race controls card and one-time contextual hints (each shown once ever).
import { h, svg, lt } from './dom.js';
import { sheet } from './menus.js';
import { controlRows } from './forms.js';
import { ROTATE_PHONE } from './icons.js';

const G = (a) => h('span', { 'data-glyph': a });

const TEXT = {
  corner: () => ['Drift: ', G('drift'), ' basılı tut + yön'],
  tier: () => ['Kıvılcım çıktı: ', G('drift'), ' bırak → turbo'],
  ramp: () => ['Rampanın ucunda drift\'e bas ', G('drift')],
  item: () => [G('item'), ' ile kullan, ', G('brake'), ' + ', G('item'), ' geriye at'],
  portrait: () => [svg(ROTATE_PHONE, 'kk-rot'), 'Yatay çevirirsen daha iyi'],
};

export function createHints(ctx) {
  const { game } = ctx;
  const el = h('div', { class: 'kk-layer' });
  const queue = [];
  let current = null;
  let teach = null;
  let teachLeft = 0;
  let race = null; // { turn: Float32Array, n, length, ramps: [t] }
  let seen = ctx.store.get('uiHints', {}) || {};

  function once(key) {
    if (seen[key] || queue.includes(key) || current?.key === key) return;
    queue.push(key);
  }

  function show(key) {
    seen = { ...seen, [key]: true };
    ctx.store.set('uiHints', seen);
    const note = h('div', { class: key === 'portrait' ? 'kk-hint kk-hint-top' : 'kk-hint' }, h('div', { class: 'kk-hint-in' }, h('i', { class: 'kk-tape' }),
      sheet(TEXT[key](ctx.device()), { dk: 4 })));
    el.appendChild(note);
    ctx.glyphs(note);
    current = { key, el: note, t: key === 'portrait' ? 4.5 : 3.8 };
  }

  function bind({ track, def }) {
    race = null;
    const S = track?.samples;
    const n = track?.sampleCount || S?.tx?.length || 0;
    if (!S?.tx || n < 60) return;
    const turn = new Float32Array(n);
    const hd = (i) => Math.atan2(S.tx[i % n], S.tz[i % n]);
    for (let i = 0; i < n; i++) {
      let d = hd(i + 50) - hd(i + 10);
      d = Math.atan2(Math.sin(d), Math.cos(d));
      turn[i] = Math.abs(d);
    }
    const ramps = (def?.ramps || track?.def?.ramps || []).filter((r) => r.trick !== false).map((r) => r.t);
    race = { turn, n, length: track.length || n, ramps };
  }

  function unbind() {
    race = null;
    closeTeach(false);
    if (current) { current.el.remove(); current = null; }
    queue.length = 0;
  }

  function openTeach() {
    if (teach || game.settings?.seenTutorial) return;
    const dev = ctx.device();
    teach = h('div', { class: 'kk-teach kk-pop' }, sheet([
      h('div', { class: 'kk-kicker' }, 'İLK YARIŞ'),
      h('div', { class: 'kk-h' }, lt('Nasıl sürülür?')),
      controlRows(dev, ['Direksiyon', 'Gaz', 'Drift · zıpla', 'Eşya'])], { dk: 3 }));
    el.appendChild(teach);
    teachLeft = 7;
  }

  function closeTeach(markSeen = true) {
    if (!teach) return;
    teach.remove();
    teach = null;
    if (markSeen) ctx.api('setSetting', 'seenTutorial', true);
  }

  return {
    el, bind, unbind,
    onCountdown({ n }) { if (n === 3) openTeach(); },
    onDrift({ kart, state, tier }) { if (kart === game.player && state === 'tier' && tier === 1) once('tier'); },
    onItemGet({ kart }) { if (kart === game.player) once('item'); },

    update(dt, view) {
      if (current && view !== 'race' && current.key !== 'portrait') { current.el.remove(); current = null; }
      if (game.touch && innerHeight > innerWidth * 1.1) once('portrait');
      if (teach) {
        if (game.phase === 'race') teachLeft -= dt;
        if (teachLeft <= 0 || view !== 'race') closeTeach(true);
      }
      const p = game.player;
      if (view === 'race' && game.phase === 'race' && p && race) {
        const ti = p.trackInfo;
        const idx = ti?.index;
        if (!seen.corner && typeof idx === 'number' && (p.speed || 0) > 8 && race.turn[idx % race.n] > 0.6) once('corner');
        if (!seen.ramp && typeof ti?.t === 'number') {
          for (const rt of race.ramps) {
            const ahead = (((rt - ti.t) % 1) + 1) % 1 * race.length;
            if (ahead > 20 && ahead < 80) { once('ramp'); break; }
          }
        }
      }
      if (current) {
        current.t -= dt;
        if (current.t <= 0) { current.el.remove(); current = null; }
      }
      const canShow = view === 'race' || (queue[0] === 'portrait' && view !== 'none');
      // a contextual hint waits for the first-race controls card to go: on a phone they would overlap
      if (!current && queue.length && canShow && !game.paused && !teach) show(queue.shift());
    },
    dispose() { unbind(); },
  };
}
