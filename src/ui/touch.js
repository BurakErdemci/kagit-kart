// On-screen touch controls (Pointer Events only). Writes game.input.touch; every finger is tracked by
// pointerId with pointer capture so a thumb sliding off a button still releases it.
import { h, svg } from './dom.js';
import { PAUSE_GLYPH } from './icons.js';

const DRIFT_ART = '<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="#2d2a32" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 44q14-28 40-24"/><path d="M42 12l10 8-9 10"/></g></svg>';

export function createTouch(ctx) {
  const { game } = ctx;
  const el = h('div', { class: 'kk-touch' });
  el.hidden = true;
  const offs = [];
  const state = { steer: 0, throttle: 0, brake: 0, drift: false, item: false, lookBack: false };
  let active = false;

  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    offs.push(() => target.removeEventListener(type, fn, opts));
  };

  function write() {
    const t = game.input?.touch;
    if (!t) return;
    t.steer = state.steer;
    t.throttle = state.throttle;
    t.brake = state.brake;
    t.drift = state.drift;
    t.item = state.item;
    t.lookBack = state.lookBack;
  }

  function markTouch(e) {
    if (e.pointerType === 'touch' && game.input) game.input.device = 'touch';
  }

  // ------------------------------------------------------------- steering strip
  const knob = h('div', { class: 'kk-knob' });
  const strip = h('div', { class: 'kk-track' }, knob);
  const steerZone = h('div', { class: 'kk-tzone kk-steer' });
  el.append(steerZone, strip);
  let steerId = null;
  let x0 = 0;

  function setSteer(v) {
    state.steer = Math.max(-1, Math.min(1, v));
    const half = strip.clientWidth / 2 - knob.clientWidth / 2;
    knob.style.transform = `translateX(${(state.steer * half).toFixed(1)}px)`;
    write();
  }

  listen(steerZone, 'pointerdown', (e) => {
    if (steerId !== null) return;
    e.preventDefault();
    markTouch(e);
    steerId = e.pointerId;
    try { steerZone.setPointerCapture(e.pointerId); } catch { /* capture can fail for synthetic events */ }
    x0 = e.clientX;
    setSteer(0);
  });
  listen(steerZone, 'pointermove', (e) => {
    if (e.pointerId !== steerId) return;
    const range = Math.max(46, Math.min(110, innerWidth * 0.075));
    setSteer((e.clientX - x0) / range);
  });
  const endSteer = (e) => {
    if (e.pointerId !== steerId) return;
    steerId = null;
    setSteer(0);
  };
  listen(steerZone, 'pointerup', endSteer);
  listen(steerZone, 'pointercancel', endSteer);
  listen(steerZone, 'lostpointercapture', endSteer);

  // ------------------------------------------------------------- buttons
  function button(cls, content, onChange) {
    const b = h('div', { class: 'kk-tbtn ' + cls }, content);
    const ids = new Set();
    const down = (e) => {
      e.preventDefault();
      markTouch(e);
      try { b.setPointerCapture(e.pointerId); } catch { /* see above */ }
      const was = ids.size > 0;
      ids.add(e.pointerId);
      if (!was) { b.classList.add('is-down'); onChange(true); write(); }
    };
    const up = (e) => {
      if (!ids.delete(e.pointerId)) return;
      if (ids.size === 0) { b.classList.remove('is-down'); onChange(false); write(); }
    };
    listen(b, 'pointerdown', down);
    listen(b, 'pointerup', up);
    listen(b, 'pointercancel', up);
    listen(b, 'lostpointercapture', up);
    el.appendChild(b);
    return { el: b, reset() { ids.clear(); b.classList.remove('is-down'); } };
  }

  const gas = button('kk-tgas', 'GAZ', (on) => { state.throttle = on ? 1 : 0; });
  const drift = button('kk-tdrift', [svg(DRIFT_ART), 'DRIFT'], (on) => { state.drift = on; });
  const item = button('kk-titem', 'EŞYA', (on) => { state.item = on; });
  const brake = button('kk-tbrake', 'FREN', (on) => { state.brake = on ? 1 : 0; });
  const look = button('kk-tlook', h('small', null, 'GERİ BAK'), (on) => { state.lookBack = on; });
  const buttons = [gas, drift, item, brake, look];

  const auto = h('div', { class: 'kk-tbtn kk-tauto' });
  listen(auto, 'pointerdown', (e) => {
    e.preventDefault();
    markTouch(e);
    ctx.click();
    ctx.api('setSetting', 'autoAccelerate', !game.settings?.autoAccelerate);
    refresh();
  });
  el.appendChild(auto);

  const pause = h('div', { class: 'kk-tbtn kk-tpause' }, svg(PAUSE_GLYPH));
  listen(pause, 'pointerdown', (e) => { e.preventDefault(); markTouch(e); ctx.click(); ctx.api('setPaused', true); });
  el.appendChild(pause);

  function refresh() {
    const on = !!game.settings?.autoAccelerate;
    auto.replaceChildren(h('small', null, on ? 'OTO GAZ: AÇIK' : 'OTO GAZ: KAPALI'));
    auto.classList.toggle('is-armed', on);
    gas.el.classList.toggle('is-auto', on);
  }
  refresh();

  // The HUD item window doubles as an item button on touch.
  function bindSlot(slotEl) {
    const ids = new Set();
    listen(slotEl, 'pointerdown', (e) => {
      if (!active) return;
      e.preventDefault();
      markTouch(e);
      try { slotEl.setPointerCapture(e.pointerId); } catch { /* see above */ }
      ids.add(e.pointerId);
      state.item = true;
      write();
    });
    const up = (e) => { if (ids.delete(e.pointerId) && ids.size === 0) { state.item = false; write(); } };
    listen(slotEl, 'pointerup', up);
    listen(slotEl, 'pointercancel', up);
    listen(slotEl, 'lostpointercapture', up);
  }

  function releaseAll() {
    steerId = null;
    for (const b of buttons) b.reset();
    state.steer = 0; state.throttle = 0; state.brake = 0;
    state.drift = false; state.item = false; state.lookBack = false;
    knob.style.transform = '';
    write();
  }

  return {
    el,
    bindSlot,
    refresh,
    setActive(on) {
      if (on === active) return;
      active = on;
      el.hidden = !on;
      if (!on) releaseAll();
    },
    dispose() { releaseAll(); for (const off of offs) off(); offs.length = 0; },
  };
}

