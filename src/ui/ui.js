// CORE STUB — the UI agent replaces this folder but keeps createUI(game) → { update(frameDt), dispose() }.
// Plain DOM: title button, HUD (place, lap, time), countdown, pause card, results. Calls game.api only.
// Core opens the pause menu (Esc/P/Start); closing it is UI's job via api.setPaused(false).
import { config } from '../core/config.js';

const F = config.fonts.body;
const CSS = `
#kk-ui { position: absolute; inset: 0; pointer-events: none; font-family: ${F}; font-weight: 700; color: #2d2a32; }
#kk-ui .card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); background: #fbf6e9;
  border: 2px solid #2d2a32; box-shadow: 6px 6px 0 #2d2a32; padding: 22px 30px; text-align: center; pointer-events: auto; }
#kk-ui h1 { margin: 0 0 12px; font: 800 44px ${F}; letter-spacing: .5px; }
#kk-ui button { font: 800 20px ${F}; color: #2d2a32; background: #f2c14e; border: 2px solid #2d2a32;
  box-shadow: 3px 3px 0 #2d2a32; padding: 6px 22px; margin: 4px; cursor: pointer; }
#kk-ui button:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 #2d2a32; }
#kk-ui .hud { position: absolute; top: calc(12px + env(safe-area-inset-top)); left: calc(14px + env(safe-area-inset-left));
  right: calc(14px + env(safe-area-inset-right)); display: flex; justify-content: space-between; font: 800 26px ${F};
  text-shadow: 2px 2px 0 #fbf6e9; }
#kk-ui .hud span { background: #fbf6e9cc; border: 2px solid #2d2a32; padding: 0 12px; }
#kk-ui .big { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%); font: 800 96px ${F};
  color: #fbf6e9; -webkit-text-stroke: 3px #2d2a32; text-shadow: 5px 5px 0 #2d2a32; }
#kk-ui table { border-collapse: collapse; margin: 6px auto 12px; font-size: 16px; }
#kk-ui td { padding: 2px 10px; text-align: left; }
`;

function fmt(t) {
  if (t == null || !isFinite(t)) return '–:––.––';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

export function createUI(game) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'kk-ui';
  root.innerHTML = `
    <div class="card" data-s="title"><h1>Kâğıt Kart</h1><button data-a="start">Yarışa başla</button></div>
    <div class="hud" data-s="hud" hidden><span data-f="place"></span><span data-f="lap"></span><span data-f="time"></span></div>
    <div class="big" data-s="count" hidden></div>
    <div class="card" data-s="pause" hidden><h1>Duraklatıldı</h1><button data-a="resume">Devam</button><button data-a="menu">Menüye dön</button></div>
    <div class="card" data-s="results" hidden><h1>Sonuçlar</h1><table data-f="table"></table>
      <button data-a="again">Tekrar yarış</button><button data-a="next" hidden>Sonraki yarış</button><button data-a="menu">Menüye dön</button></div>`;
  (document.getElementById('kk-root') || document.body).appendChild(root);
  const $ = (sel) => root.querySelector(sel);
  const screens = { title: $('[data-s=title]'), hud: $('[data-s=hud]'), count: $('[data-s=count]'), pause: $('[data-s=pause]'), results: $('[data-s=results]') };
  const f = { place: $('[data-f=place]'), lap: $('[data-f=lap]'), time: $('[data-f=time]'), table: $('[data-f=table]') };
  const nextBtn = $('[data-a=next]');

  const start = () => game.api.startRace({});
  const actions = {
    start,
    resume: () => game.api.setPaused(false),
    again: () => game.api.restartRace(),
    next: () => game.api.nextRace(),
    menu: () => game.api.quitToTitle(),
  };
  function onClick(e) {
    const a = e.target.closest('button')?.dataset.a;
    if (a && actions[a]) { e.preventDefault(); actions[a](); }
  }
  root.addEventListener('click', onClick);

  let goFlash = 0;
  let lastCount = null;
  let resultsShown = null;

  function show(name, on) {
    const el = screens[name];
    if (el.hidden === on) el.hidden = !on;
  }

  function update(frameDt) {
    const phase = game.phase;
    const nav = game.input.nav;
    show('title', phase === 'title' || phase === 'menu');
    if ((phase === 'title' || phase === 'menu') && nav.confirm) start();

    const racing = phase === 'countdown' || phase === 'race' || phase === 'finishing';
    show('hud', racing);
    const p = game.player;
    if (racing && p && game.race) {
      f.place.textContent = `${p.place}/${game.karts.length}`;
      f.lap.textContent = `Tur ${Math.min(Math.max(p.lap, 1), game.race.laps)}/${game.race.laps}`;
      f.time.textContent = fmt(game.raceTime);
    }

    const race = game.race;
    let big = '';
    if (phase === 'countdown' && race && race.countdown > 0) big = String(race.countdown);
    if (race && race.countdown === 0 && lastCount !== 0) goFlash = 0.9;
    lastCount = race ? race.countdown : null;
    if (goFlash > 0) { goFlash -= frameDt; if (phase === 'race') big = 'BAŞLA!'; }
    if (phase === 'finishing') big = 'BİTİŞ!';
    show('count', !!big);
    if (big && screens.count.textContent !== big) screens.count.textContent = big;

    show('pause', game.paused);
    if (game.paused && (nav.pause || nav.back)) actions.resume();

    const inResults = phase === 'results' && race && race.results;
    show('results', !!inResults);
    if (inResults && resultsShown !== race.results) {
      resultsShown = race.results;
      f.table.innerHTML = race.results.map((r) => {
        const k = game.karts.find((x) => x.id === r.kartId);
        const name = k ? k.name : r.kartId;
        const pts = game.gp.active ? `<td>+${r.points} (${r.totalPoints})</td>` : '';
        return `<tr><td>${r.place}.</td><td>${name}${k && k.isPlayer ? ' ★' : ''}</td><td>${fmt(r.time)}${r.estimated ? '*' : ''}</td>${pts}</tr>`;
      }).join('');
      nextBtn.hidden = !game.gp.active;
    }
    if (!inResults) resultsShown = null;
    if (inResults && nav.confirm) (game.gp.active ? actions.next : actions.again)();
  }

  return {
    update,
    dispose() {
      root.removeEventListener('click', onClick);
      root.remove();
      style.remove();
    },
  };
}
