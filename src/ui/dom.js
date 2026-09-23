// Small DOM helpers shared by the UI modules.
import { letteringElement, drawLettering } from './lettering.js';

// Display type (ARCHITECTURE.md §13): headings, numerals and banners are cut-paper lettering; body text
// stays in config.fonts.body. Colours are CSS variables of the overlay root, so one palette drives both.
const SHADE = 'rgba(45,42,50,.9)';
export const TYPE = {
  head: { style: 'cut', colors: { fill: 'var(--red)', shadow: SHADE, plate: 'var(--blue)' }, misregister: 0.028, rim: true },
  card: { style: 'cut', colors: { fill: 'var(--ink)', shadow: 'rgba(45,42,50,.3)', plate: 'var(--red)' }, misregister: 0.03, rim: true },
  label: { style: 'label', colors: { fill: 'var(--ink)', shadow: 'rgba(45,42,50,.28)' } },
  num: { style: 'label', colors: { fill: 'var(--ink)', shadow: 'rgba(45,42,50,.28)' }, tabular: true },
  light: { style: 'cut', colors: { fill: 'var(--paper-hi)', shadow: SHADE }, rim: true },
  stamp: { style: 'stamp', colors: { ink: 'var(--ink)' } },
};

// A lettering span: the SVG inside is sized in em, so the span's font-size sets the letter size.
export function lt(text, preset = 'head', over = null) {
  const el = document.createElement('span');
  el.className = 'kk-lt';
  setLt(el, text, preset, over);
  return el;
}

export function setLt(el, text, preset = 'head', over = null) {
  const t = String(text ?? '');
  const key = t + '|' + preset + '|' + (over ? JSON.stringify(over) : '');
  if (el.dataset.k === key) return el;
  el.dataset.k = key;
  const base = TYPE[preset] || TYPE.head;
  const opts = { seed: t, ...base, ...over, colors: { ...base.colors, ...over?.colors } };
  el.replaceChildren(letteringElement(t, opts));
  return el;
}

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// Player-facing case changes must be Turkish-aware (i → İ, ı → I).
export const up = (s) => String(s).toLocaleUpperCase('tr');
export const cap = (s) => (s ? String(s)[0].toLocaleUpperCase('tr') + String(s).slice(1) : '');

// Deterministic small tilts so cards look hand-placed but never jitter between renders.
const TILTS = [-1.4, 0.8, -0.5, 1.2, -0.9, 0.4, -1.1, 0.7];
export const tilt = (i) => TILTS[((i % TILTS.length) + TILTS.length) % TILTS.length];

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Torn/deckled paper edge as a clip-path polygon: small irregular bites along every edge.
export function deckle(seed, amp = 3.2, step = 1.6) {
  const r = mulberry(seed);
  const p = [];
  const j = () => (r() * amp).toFixed(1);
  for (let x = 0; x < 100; x += step) p.push(`${x.toFixed(1)}% ${j()}px`);
  for (let y = 0; y < 100; y += step * 1.6) p.push(`calc(100% - ${j()}px) ${y.toFixed(1)}%`);
  for (let x = 100; x > 0; x -= step) p.push(`${x.toFixed(1)}% calc(100% - ${j()}px)`);
  for (let y = 100; y > 0; y -= step * 1.6) p.push(`${j()}px ${y.toFixed(1)}%`);
  return `polygon(${p.join(',')})`;
}

// m:ss,cc — Turkish uses the decimal comma.
export function fmtTime(t) {
  if (!(t >= 0) || !isFinite(t)) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const c = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')},${String(c).padStart(2, '0')}`;
}

export function fmtSplit(s) {
  const sign = s < 0 ? '−' : '+';
  return `${sign}${Math.abs(s).toFixed(2).replace('.', ',')}`;
}

export function svg(markup, cls = '') {
  const wrap = document.createElement('span');
  wrap.className = 'kk-svg ' + cls;
  wrap.innerHTML = markup;
  return wrap;
}

// Lettering on a canvas, for text that changes every frame (the race clock): one SVG per change would
// rebuild DOM 100 times a second, drawLettering reuses cached letter sprites. The CSS box sets the size;
// a ResizeObserver keeps the backing store at device pixels without reading layout in the frame loop.
// Canvas colours cannot be CSS variables, so opts.colors are literal.
export function createLetterCanvas(cls, opts) {
  const canvas = h('canvas', { class: 'kk-ltc ' + cls, 'aria-hidden': 'true' });
  const g = canvas.getContext('2d');
  let text = null, w = 0, hgt = 0, dpr = 1;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
    const r = entries[entries.length - 1].contentRect;
    w = r.width; hgt = r.height;
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(hgt * dpr));
    draw();
  }) : null;
  ro?.observe(canvas);
  function draw() {
    if (!w || !hgt || text == null) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawLettering(g, text, { ...opts, size: hgt * (opts.fit || 0.66), x: opts.align === 'right' ? w - 2 : opts.align === 'center' ? w / 2 : 2, y: hgt * 0.5, baseline: 'middle' });
  }
  return {
    el: canvas,
    set(t) { if (t === text) return; text = t; draw(); },
    dispose() { ro?.disconnect(); },
  };
}
