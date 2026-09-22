// CORE STUB — the UI agent replaces this file with the cut-paper lettering (§13) and keeps both
// signatures. Until then text is plain bold system type with a hard offset shadow, so scenery signs
// and cinematics captions can import this module today.
import { config } from '../core/config.js';

function fillOf(colors) {
  const f = colors && colors.fill;
  if (Array.isArray(f)) return f[0] || '#fbf6e9';
  return f || '#fbf6e9';
}

// drawLettering(ctx2d, text, { x, y, size, colors: { fill, shadow, ink }, seed, align })
// y is the baseline. Returns { width, height } of the painted box.
export function drawLettering(ctx, text, opts = {}) {
  const size = opts.size > 0 ? opts.size : 48;
  const x = opts.x || 0;
  const y = opts.y || 0;
  const colors = opts.colors || {};
  const s = String(text ?? '').toLocaleUpperCase('tr');
  ctx.save();
  ctx.font = `800 ${size}px ${config.fonts.body}`;
  ctx.textAlign = opts.align === 'center' || opts.align === 'right' ? opts.align : 'left';
  ctx.textBaseline = 'alphabetic';
  const off = Math.max(1, Math.round(size * 0.06));
  ctx.fillStyle = colors.shadow || colors.ink || '#2d2a32';
  ctx.fillText(s, x + off, y + off);
  ctx.fillStyle = fillOf(colors);
  ctx.fillText(s, x, y);
  if (colors.ink) {
    ctx.lineWidth = Math.max(1, size * 0.03);
    ctx.strokeStyle = colors.ink;
    ctx.strokeText(s, x, y);
  }
  const width = ctx.measureText(s).width + off;
  ctx.restore();
  return { width, height: size * 1.2 + off };
}

// letteringElement(text, opts) → HTMLElement; inherits font-size unless opts.size (px) is given.
export function letteringElement(text, opts = {}) {
  const el = document.createElement('span');
  const s = String(text ?? '');
  el.textContent = s.toLocaleUpperCase('tr');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', s);
  const colors = opts.colors || {};
  const st = el.style;
  st.font = `800 ${opts.size > 0 ? opts.size + 'px' : '1em'} ${config.fonts.body}`;
  st.color = fillOf(colors);
  st.textShadow = `0.06em 0.06em 0 ${colors.shadow || colors.ink || '#2d2a32'}`;
  st.whiteSpace = 'nowrap';
  return el;
}
