// Race HUD: place stamp, lap + clock, item window with roulette, pencil minimap, countdown,
// banners, threat marker, ink splat, lap-line page flip and time-trial splits.
import { h, svg, clear, createLetterCanvas, fmtTime, fmtSplit, up, mulberry, lt, setLt } from './dom.js';
import { ITEMS, ITEM_IDS, WRONG_SIGN } from './icons.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
};

const PLATES = { 3: 'var(--red)', 2: 'var(--mustard)', 1: 'var(--blue)', 0: 'var(--red)' };
// Place stamp ink: podium places in their print colours, the rest in plain ink (colour only where it matters).
const PLACE_INK = { 1: 'var(--p1)', 2: 'var(--p2)', 3: 'var(--p3)' };

export function createHUD(ctx) {
  const { game } = ctx;
  const el = h('div', { class: 'kk-hud' });
  const inkEl = h('div', { class: 'kk-inkl' });
  inkEl.hidden = true;

  // ------------------------------------------------------------- timeline (pause-aware: advances by frameDt)
  const timeline = [];
  const after = (sec, fn) => timeline.push({ t: sec, fn });

  // ------------------------------------------------------------- item slot
  const reel = h('div', { class: 'kk-reel' }, [...ITEM_IDS, ITEM_IDS[0]].map((id) => svg(ITEMS[id].svg)));
  const itemIcon = h('div', { class: 'kk-held-icon' });
  const count = h('div', { class: 'kk-count' });
  const itemName = h('div', { class: 'kk-slot-name' });
  const slot = h('div', { class: 'kk-slot' },
    h('div', { class: 'kk-paper kk-dk3' }),
    h('div', { class: 'kk-window' }, reel, itemIcon),
    count, itemName);
  reel.style.display = 'none';
  let spinning = false;
  let reelPos = 0;
  let shownItem = undefined;
  let shownCount = -1;
  let shownHeld = null;

  function showItem(id, thud) {
    shownItem = id;
    clear(itemIcon);
    if (id && ITEMS[id]) {
      itemIcon.appendChild(svg(ITEMS[id].svg));
      itemIcon.style.display = 'block';
      itemName.textContent = ITEMS[id].name;
      slot.classList.add('has-item');
    } else {
      itemIcon.style.display = 'none';
      itemName.textContent = '';
      slot.classList.remove('has-item');
    }
    if (thud && !ctx.reduced()) {
      slot.classList.remove('is-thud');
      void slot.offsetWidth;
      slot.classList.add('is-thud');
    }
  }

  function updateSlot(p, dt) {
    const roulette = p.roulette || 0;
    if (roulette > 0) {
      if (!spinning) {
        spinning = true;
        reelPos = Math.random() * ITEM_IDS.length;
        reel.style.display = 'block';
        itemIcon.style.display = 'none';
        slot.classList.remove('has-item', 'is-thud');
      }
      const dur = p.rouletteDuration || 1.6;
      const k = Math.max(0, Math.min(1, 1 - roulette / dur));
      reelPos += (2.5 + 17 * Math.pow(1 - k, 1.6)) * dt;
      const f = reelPos % ITEM_IDS.length;
      reel.style.transform = `translateY(${(-f * 100 / (ITEM_IDS.length + 1)).toFixed(3)}%)`;
    } else if (spinning) {
      spinning = false;
      reel.style.display = 'none';
      showItem(p.item || null, true);
    } else if ((p.item || null) !== shownItem) {
      showItem(p.item || null, false);
    }
    const n = p.item === 'rocket3' || (p.itemCount || 0) > 1 ? (p.itemCount || 0) : 0;
    if (n !== shownCount) {
      shownCount = n;
      count.style.display = n > 1 ? 'block' : 'none';
      count.textContent = `×${n}`;
    }
    const held = !!p.itemHeld;
    if (held !== shownHeld) { shownHeld = held; slot.classList.toggle('is-held', held); }
  }

  // ------------------------------------------------------------- lap + clock
  const lapLt = lt('');
  const lapEl = h('span', { class: 'kk-lap' }, h('small', null, up('Tur')), lapLt);
  const clock = createLetterCanvas('kk-clockc', { style: 'label', tabular: true, align: 'right', seed: 'clock', fit: 0.62,
    colors: { fill: '#2d2a32', shadow: 'rgba(45,42,50,.28)' } });
  const split = h('div', { class: 'kk-split' });
  const panel = h('div', { class: 'kk-panel' }, h('div', { class: 'kk-sheet' }, h('div', { class: 'kk-paper kk-dk1' }, lapEl, clock.el)));
  let shownLap = '';

  // ------------------------------------------------------------- place stamp
  const placeLt = lt('');
  const placeNum = h('span', { class: 'kk-num' }, placeLt);
  const placeOf = h('span', { class: 'kk-of' });
  const place = h('div', { class: 'kk-place' }, h('div', { class: 'kk-sheet' }, h('div', { class: 'kk-paper kk-dk2' }, placeNum, placeOf)));
  let shownPlace = 0;
  let shownTotal = 0;

  function setPlace(n, total, stamp) {
    shownPlace = n;
    shownTotal = total;
    setLt(placeLt, `${n}.`, 'stamp', { colors: { ink: PLACE_INK[n] || 'var(--ink)' } });
    placeOf.textContent = `/${total}`;
    placeOf.style.display = total > 1 ? '' : 'none';
    place.className = 'kk-place';
    if (stamp && !ctx.reduced()) { void place.offsetWidth; place.classList.add('is-stamp'); }
  }

  // ------------------------------------------------------------- minimap
  const mapSvg = s('svg', { viewBox: '0 0 100 100' });
  const map = h('div', { class: 'kk-map' }, h('div', { class: 'kk-paper kk-dkf' }));
  map.appendChild(mapSvg);
  let mapT = null; // { minX, minZ, sc, ox, oz, dots: [{ kart, g }] }

  function buildMap(track, karts) {
    while (mapSvg.firstChild) mapSvg.removeChild(mapSvg.firstChild);
    mapT = null;
    const S = track?.samples;
    const n = track?.sampleCount || S?.px?.length || 0;
    if (!S || !S.px || n < 8) return;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, hw = 0;
    for (let i = 0; i < n; i++) {
      const x = S.px[i], z = S.pz[i];
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      hw += S.halfWidth ? S.halfWidth[i] : 10;
    }
    hw /= n;
    const span = Math.max(maxX - minX, maxZ - minZ, 1);
    const sc = 92 / span;
    const ox = (100 - (maxX - minX) * sc) / 2, oz = (100 - (maxZ - minZ) * sc) / 2;
    const step = Math.max(1, Math.floor(n / 280));
    let d = '';
    for (let i = 0; i < n; i += step) d += `${i ? 'L' : 'M'}${((S.px[i] - minX) * sc + ox).toFixed(2)} ${((S.pz[i] - minZ) * sc + oz).toFixed(2)}`;
    d += 'Z';
    const ink = '#3b3742';
    // an opaque printed card: the road is a flat kraft plate, the key line printed a little off it
    mapSvg.append(
      s('path', { d, fill: 'none', stroke: '#d9c59a', 'stroke-width': Math.max(2.5, hw * 2 * sc).toFixed(2), 'stroke-linejoin': 'round', transform: 'translate(-.5 .6)' }),
      s('path', { d, fill: 'none', stroke: ink, 'stroke-width': '1.3', 'stroke-linejoin': 'round', 'stroke-opacity': '.9' }),
      s('path', { d, fill: 'none', stroke: ink, 'stroke-width': '.7', 'stroke-opacity': '.4', transform: 'translate(.9 -.6)' }));
    const si = Math.round((track.startDist || 0) / (track.spacing || 1)) % n;
    const sx = (S.px[si] - minX) * sc + ox, sz = (S.pz[si] - minZ) * sc + oz;
    const tx = S.tx ? S.tx[si] : 1, tz = S.tz ? S.tz[si] : 0;
    const L = Math.max(3, hw * sc * 1.4);
    mapSvg.appendChild(s('path', { d: `M${sx - tz * L} ${sz + tx * L}L${sx + tz * L} ${sz - tx * L}`, stroke: '#d9483b', 'stroke-width': '1.6', 'stroke-linecap': 'round' }));
    const dots = [];
    const ordered = [...(karts || [])].sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
    for (const k of ordered) {
      const color = k.character?.colors?.kart || k.character?.colors?.body || '#8a8490';
      const g = s('g');
      if (k.isPlayer) {
        g.appendChild(s('path', { d: 'M4.6 0L-3 3.6L-1.6 0L-3 -3.6Z', fill: '#d9483b', stroke: '#2d2a32', 'stroke-width': '1', 'stroke-linejoin': 'round' }));
      } else {
        g.appendChild(s('circle', { r: '2.3', fill: color, stroke: '#2d2a32', 'stroke-width': '.8' }));
      }
      mapSvg.appendChild(g);
      dots.push({ kart: k, g });
    }
    mapT = { minX, minZ, sc, ox, oz, dots };
  }

  function updateMap() {
    if (!mapT) return;
    const { minX, minZ, sc, ox, oz, dots } = mapT;
    for (const d of dots) {
      const k = d.kart;
      const p = k.pos;
      if (!p) continue;
      const x = ((p.x - minX) * sc + ox).toFixed(2), y = ((p.z - minZ) * sc + oz).toFixed(2);
      if (k.isPlayer) {
        const hh = k.heading || 0;
        const deg = (Math.atan2(Math.cos(hh), Math.sin(hh)) * 180 / Math.PI).toFixed(1);
        d.g.setAttribute('transform', `translate(${x} ${y}) rotate(${deg})`);
      } else {
        d.g.setAttribute('transform', `translate(${x} ${y})`);
      }
    }
  }

  // ------------------------------------------------------------- centre stack: countdown, banners, signs
  const center = h('div', { class: 'kk-center' });
  let countEl = null;
  let wrongEl = null;
  let waitEl = null;
  let finishEl = null;

  function countdown(n) {
    countEl?.remove();
    const text = n > 0 ? String(n) : 'Başla!';
    const num = h('div', { class: 'kk-count-num' + (n > 0 ? '' : ' is-go') },
      lt(text, 'light', { halftone: true, misregister: 0.04, colors: { plate: PLATES[n] || 'var(--red)' } }));
    countEl = h('div', { class: 'kk-count-wrap' }, num);
    center.prepend(countEl);
    const mine = countEl;
    if (n <= 0) after(0.9, () => { if (countEl === mine) { mine.remove(); countEl = null; } });
  }

  // Grade tags: a dark tag with mustard letters for the good news, a paper tag with ink letters otherwise.
  function gradeLt(text, meh) {
    return meh ? lt(text, 'card') : lt(text, 'light', { colors: { fill: 'var(--mustard)', shadow: 'rgba(0,0,0,.55)' } });
  }

  function tag(text, cls = '', life = 1.7) {
    const g = h('div', { class: 'kk-grade ' + cls }, gradeLt(text, cls.includes('is-meh')));
    center.appendChild(g);
    after(life, () => g.remove());
  }

  function banner(text) {
    const b = h('div', { class: 'kk-banner-wrap kk-slam' }, h('div', { class: 'kk-banner' }, lt(text, 'light', { halftone: true })));
    center.appendChild(b);
    after(1.9, () => { b.classList.remove('kk-slam'); b.classList.add('kk-away'); });
    after(2.3, () => b.remove());
  }

  function wrongWay(on) {
    if (on && !wrongEl) {
      wrongEl = h('div', { class: 'kk-wrong-wrap' }, h('div', { class: 'kk-wrong' },
        svg(WRONG_SIGN, 'kk-sign'), h('b', null, lt('Ters yön', 'card'))));
      center.appendChild(wrongEl);
    } else if (!on && wrongEl) {
      wrongEl.remove();
      wrongEl = null;
    }
  }

  function finish(placeN) {
    finishEl?.remove();
    finishEl = h('div', { class: 'kk-finish' },
      h('div', { class: 'kk-checker-wrap kk-slam' }, h('div', { class: 'kk-checker' }, lt('Bitiş!'))),
      h('div', { class: 'kk-grade' + (placeN <= 3 ? '' : ' is-meh') }, gradeLt(`${placeN}. oldun`, placeN > 3)));
    center.appendChild(finishEl);
  }

  // ------------------------------------------------------------- lap-line page flip
  const flipLayer = h('div', { class: 'kk-layer' });
  function flip(lap) {
    if (ctx.reduced()) return;
    const f = h('div', { class: 'kk-flip' }, h('i'), h('b', null, lt(`${lap}. tur`, 'card')));
    flipLayer.appendChild(f);
    after(1.2, () => f.remove());
  }

  // ------------------------------------------------------------- threat marker
  const etaRing = s('circle', { cx: '50', cy: '50', r: '46', fill: 'none', stroke: '#d9483b', 'stroke-width': '6', 'stroke-linecap': 'round', pathLength: '100' });
  const etaSvg = s('svg', { viewBox: '0 0 100 100', class: 'kk-eta' });
  etaSvg.appendChild(etaRing);
  const threatIcon = h('span', { class: 'kk-svg' });
  const threat = h('div', { class: 'kk-threat' }, h('div', { class: 'kk-disc' }), threatIcon, h('div', { class: 'kk-bang' }, '!'));
  threat.appendChild(etaSvg);
  let threatState = null; // { kind, eta, total }

  function onThreat(kind, eta) {
    if (!threatState || threatState.kind !== kind) {
      clear(threatIcon);
      if (ITEMS[kind]) threatIcon.appendChild(svg(ITEMS[kind].svg));
    }
    threatState = { kind, eta, total: Math.max(eta, threatState?.total || 0, 1.5) };
    threat.style.display = 'block';
  }

  function updateThreat(dt) {
    if (!threatState) return;
    threatState.eta -= dt;
    if (threatState.eta < -0.35) { threatState = null; threat.style.display = 'none'; return; }
    const p = game.player;
    let ang = Math.PI;
    const list = game.systems?.items?.projectiles;
    if (p && Array.isArray(list)) {
      for (const pr of list) {
        if (pr && pr.target === p && pr.kind === threatState.kind && pr.pos && p.pos) {
          const vx = pr.pos.x - p.pos.x, vz = pr.pos.z - p.pos.z;
          const hh = p.heading || 0;
          const fwd = vx * Math.sin(hh) + vz * Math.cos(hh);
          const right = vx * -Math.cos(hh) + vz * Math.sin(hh);
          ang = Math.atan2(right, fwd);
          break;
        }
      }
    }
    const W = el.clientWidth || innerWidth, H = el.clientHeight || innerHeight;
    const rx = W / 2 - 70, ry = H / 2 - 70;
    const x = W / 2 + Math.sin(ang) * rx, y = H / 2 - Math.cos(ang) * ry;
    threat.style.left = `${x.toFixed(1)}px`;
    threat.style.top = `${y.toFixed(1)}px`;
    const frac = Math.max(0, Math.min(1, threatState.eta / threatState.total));
    etaRing.setAttribute('stroke-dasharray', `${(frac * 100).toFixed(1)} 100`);
    threat.classList.toggle('is-near', threatState.eta <= 0.6);
  }

  // ------------------------------------------------------------- ink splat
  let inkState = null; // { duration, left }

  // Smooth lobed blob (quadratic curves through edge midpoints) with tapered tendrils and droplets.
  function blobPath(r, cx, cy, R) {
    const N = 16;
    const p1 = r() * 6.28, p2 = r() * 6.28;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + (r() - 0.5) * 0.18;
      const rr = R * (1 + 0.16 * Math.sin(3 * a + p1) + 0.09 * Math.sin(5 * a + p2) + (r() - 0.5) * 0.1);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    const mid = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2];
    let m = mid(pts[N - 1], pts[0]);
    let d = `M${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
    for (let i = 0; i < N; i++) {
      const q = pts[i];
      m = mid(q, pts[(i + 1) % N]);
      d += `Q${q[0].toFixed(1)} ${q[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
    }
    return d + 'Z';
  }

  function splat(duration) {
    const r = mulberry((Math.random() * 1e9) | 0);
    const W = 1600, H = 900;
    const svgEl = s('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid slice' });
    const inkCol = '#1c2140';
    const g = s('g', { fill: inkCol });
    const blobs = [[0.38, 0.4, 210], [0.63, 0.34, 160], [0.53, 0.64, 135]];
    for (const [bx, by, R0] of blobs) {
      const cx = bx * W + (r() - 0.5) * 100, cy = by * H + (r() - 0.5) * 70;
      const R = R0 * (0.92 + r() * 0.16);
      g.appendChild(s('path', { d: blobPath(r, cx, cy, R) }));
      const arms = 3 + Math.floor(r() * 3);
      for (let k = 0; k < arms; k++) {
        const a = r() * Math.PI * 2;
        const len = R * (0.2 + r() * 0.28);
        const w0 = 20 + r() * 12;
        const ca = Math.cos(a), sa = Math.sin(a), nx = -sa, ny = ca;
        const x0 = cx + ca * R * 0.85, y0 = cy + sa * R * 0.85;
        const x1 = x0 + ca * len, y1 = y0 + sa * len;
        g.appendChild(s('path', { d: `M${(x0 + nx * w0).toFixed(1)} ${(y0 + ny * w0).toFixed(1)}L${(x1 + nx * 2).toFixed(1)} ${(y1 + ny * 2).toFixed(1)}L${(x1 - nx * 2).toFixed(1)} ${(y1 - ny * 2).toFixed(1)}L${(x0 - nx * w0).toFixed(1)} ${(y0 - ny * w0).toFixed(1)}Z` }));
        g.appendChild(s('circle', { cx: (x1 + ca * 8).toFixed(1), cy: (y1 + sa * 8).toFixed(1), r: (5 + r() * 7).toFixed(1) }));
      }
      for (let k = 0; k < 4; k++) {
        const a = r() * Math.PI * 2, dist = R * (1.55 + r() * 0.6);
        g.appendChild(s('circle', { cx: (cx + Math.cos(a) * dist).toFixed(1), cy: (cy + Math.sin(a) * dist).toFixed(1), r: (4 + r() * 10).toFixed(1) }));
      }
      for (let k = 0; k < 2; k++) {
        const x = cx + (r() - 0.5) * R * 1.1;
        const top = cy + R * 0.55;
        const len = 70 + r() * 160;
        const w = 12 + r() * 10;
        const drip = s('g', { class: 'kk-drip', style: `transform-origin:${x.toFixed(0)}px ${top.toFixed(0)}px; transform-box:view-box; animation-delay:${(r() * 0.4).toFixed(2)}s` });
        drip.appendChild(s('rect', { x: (x - w / 2).toFixed(1), y: top.toFixed(1), width: w.toFixed(1), height: len.toFixed(1), rx: (w / 2).toFixed(1) }));
        drip.appendChild(s('circle', { cx: x.toFixed(1), cy: (top + len).toFixed(1), r: (w * 0.8).toFixed(1) }));
        g.appendChild(drip);
      }
      g.appendChild(s('path', { d: `M${(cx - R * 0.5).toFixed(1)} ${(cy - R * 0.15).toFixed(1)}q${(R * 0.1).toFixed(1)} ${(-R * 0.32).toFixed(1)} ${(R * 0.42).toFixed(1)} ${(-R * 0.38).toFixed(1)}`, fill: 'none', stroke: '#8f9bd0', 'stroke-opacity': '.3', 'stroke-width': '12', 'stroke-linecap': 'round' }));
    }
    svgEl.appendChild(g);
    clear(inkEl);
    inkEl.appendChild(svgEl);
    inkEl.style.opacity = '1';
    inkEl.hidden = false;
    inkState = { duration: duration || 3.5, left: duration || 3.5 };
  }

  function updateInk(dt) {
    if (!inkState) return;
    const p = game.player;
    const left = typeof p?.inkTime === 'number' ? p.inkTime : (inkState.left -= dt);
    const fade = inkState.duration * 0.35;
    const o = Math.max(0, Math.min(1, left / fade));
    inkEl.style.opacity = o.toFixed(3);
    if (left <= 0) { inkState = null; inkEl.hidden = true; clear(inkEl); }
  }

  // ------------------------------------------------------------- layout
  const tl = h('div', { class: 'kk-hud-tl' }, slot);
  const tr = h('div', { class: 'kk-hud-tr' }, panel, split);
  const bl = h('div', { class: 'kk-hud-bl' }, map);
  const br = h('div', { class: 'kk-hud-br' }, place);
  el.append(flipLayer, tl, tr, bl, br, center, threat);

  let splitTimer = 0;

  function reset() {
    timeline.length = 0;
    clear(center);
    countEl = wrongEl = waitEl = finishEl = null;
    clear(flipLayer);
    threatState = null;
    threat.style.display = 'none';
    clear(threatIcon);
    inkState = null;
    inkEl.hidden = true;
    clear(inkEl);
    split.classList.remove('is-on');
    shownItem = undefined;
    shownCount = -1;
    shownHeld = null;
    spinning = false;
    reel.style.display = 'none';
    shownLap = '';
    shownPlace = 0;
  }

  const isMe = (k) => !!k && k === game.player;

  return {
    el, inkEl, reset, slot,
    dispose() { reset(); clock.dispose(); },

    bind({ track, karts }) { reset(); buildMap(track || game.track, karts || game.karts); },
    // Race over: nothing of it stays in the DOM (the UI returns to exactly its pre-race size).
    unbind() {
      reset();
      while (mapSvg.firstChild) mapSvg.removeChild(mapSvg.firstChild);
      mapT = null;
      setLt(lapLt, '');
      setLt(placeLt, '');
      clear(itemIcon);
      clock.set('');
    },

    onCountdown({ n }) { countdown(n); },
    onLap({ kart, lap }) { if (isMe(kart)) flip(lap); },
    onFinalLap({ kart }) { if (isMe(kart)) banner('Son tur'); },
    onWrongWay({ kart, on }) { if (isMe(kart)) wrongWay(!!on); },
    onFinish({ kart, place: pl }) { if (isMe(kart)) { wrongWay(false); finish(pl || kart.place); } },
    onInked({ kart, duration }) { if (isMe(kart)) splat(duration); },
    onThreat({ kart, kind, eta }) { if (isMe(kart)) onThreat(kind, eta); },
    onBoost({ kart, source, grade }) {
      if (!isMe(kart) || source !== 'start') return;
      if (grade === 'perfect') tag('Harika çıkış!');
      else if (grade === 'good') tag('İyi çıkış', 'is-meh');
    },
    onHit({ kart, cause }) { if (isMe(kart) && cause === 'burnout') tag('Motor boğuldu!', 'is-meh', 1.5); },
    onPlace({ kart, place: pl }) { if (isMe(kart) && pl !== shownPlace) setPlace(pl, game.karts?.length || shownTotal || 8, true); },
    onCheckpoint({ kart, split: sp }) {
      if (!isMe(kart) || typeof sp !== 'number') return;
      split.textContent = fmtSplit(sp);
      split.className = 'kk-split is-on ' + (sp <= 0 ? 'is-ahead' : 'is-behind');
      splitTimer = 2.6;
    },

    update(dt) {
      for (let i = timeline.length - 1; i >= 0; i--) {
        const e = timeline[i];
        e.t -= dt;
        if (e.t <= 0) { timeline.splice(i, 1); e.fn(); }
      }
      const p = game.player;
      if (!p) return;
      const race = game.race || {};
      const laps = race.laps || 3;
      const lap = Math.max(1, Math.min(laps, p.lap || 1));
      const lapText = `${lap}/${laps}`;
      if (lapText !== shownLap) {
        shownLap = lapText;
        setLt(lapLt, lapText, 'label');
      }
      const t = p.finished ? (p.finishTime || 0) : (race.state === 'countdown' || game.phase === 'countdown' ? 0 : (game.raceTime || 0));
      clock.set(fmtTime(t));
      const total = game.karts?.length || 8;
      if (p.place && (p.place !== shownPlace || total !== shownTotal)) setPlace(p.place, total, false);
      updateSlot(p, dt);
      updateMap();
      updateThreat(dt);
      updateInk(dt);
      if (splitTimer > 0) { splitTimer -= dt; if (splitTimer <= 0) split.classList.remove('is-on'); }
      const waiting = game.phase === 'finishing' && typeof race.waitLeft === 'number' && race.waitLeft > 0;
      if (waiting) {
        if (!waitEl) { waitEl = h('div', { class: 'kk-wait' }); center.appendChild(waitEl); }
        waitEl.textContent = `Diğer sürücüler bekleniyor · ${Math.ceil(race.waitLeft)} sn`;
      } else if (waitEl) { waitEl.remove(); waitEl = null; }
    },
  };
}
