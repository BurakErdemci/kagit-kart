import { layout } from './_path.js';

// Chapter 4 — the finale leaves the book. The grid sits on the open page (y 6); the road runs
// out along a ruler laid from the book to a notebook stack, curls down onto the desk round the
// coffee mug, crosses the open notebook, snakes through the paper-clip chicane, rolls over the
// eraser bumps, hairpins round the pencil cup, runs under the lamp, takes the sticky-note
// ramp and climbs the curling page back onto the book. Clockwise.
const P = layout({
  start: [0, 6, 0], heading: Math.PI / 2, hw: 10, off: 11,
  segs: [
    ['S', 70, { y: 6, mark: 'start', marks: { row1: 45, bookEdge: 60 } }],  // on the open page
    ['S', 80, { hw: 9, off: 5, mark: 'ruler', end: 'rulerOut' }],           // ruler bridge, void both sides
    ['S', 25, { hw: 10, off: 11, y: 6 }],
    ['R', 90, 60, { mark: 'mug' }],                                          // T3 round the coffee mug
    ['S', 70, { y: 0.8, mark: 'notebook', marks: { row2: 42, pad1: 18 } }],  // down onto the notebook lines
    ['L', 45, 30, { hw: 9, off: 6, mark: 'clip' }],                          // paper-clip chicane
    ['S', 12],
    ['R', 90, 30],                                                            // T2
    ['S', 12],
    ['L', 45, 30, { end: 'clipOut' }],
    ['S', 15, { hw: 10, off: 11, y: 2.0, mark: 'erasers' }],                 // eraser bumps: small hops at speed
    ['S', 15, { y: 0.8 }],
    ['S', 15, { y: 2.0 }],
    ['S', 15, { y: 0.8, end: 'erasersOut' }],
    ['R', 180, 28, { mark: 'pencils', end: 'pencilsOut' }],                  // T3 pencil-cup hairpin
    ['S', 60, { adj: true }],
    ['L', 90, 45, { mark: 'lampBend' }],                                     // T2
    ['S', 50, { adj: true, mark: 'lamp' }],                                  // under the lamp
    ['L', 25, 120],
    ['S', 12, { marks: { row3: 6 } }],
    ['R', 25, 120],
    ['S', 40, { y: 0, end: 'lampOut' }],
    ['R', 90, 45, { mark: 'toNote' }],                                        // T2
    ['S', 85, { mark: 'sticky', marks: { ramp: 8 } }],                     // sticky-note ramp
    ['R', 90, 60, { y: 6, mark: 'curlUp' }],                                 // T3 up the page curl
    ['S', 60, { y: 6, mark: 'onBook', marks: { pad2: 30 } }],
  ],
});

export default {
  id: 'desk',
  chapter: 4,
  name: 'Yazı Masası',
  subtitle: 'Kitaptan çıkıp okurun masasına',
  laps: 3,
  points: P.points,
  halfWidth: P.halfWidth,
  bank: P.bank,
  offroad: P.offroad,
  edges: [
    { from: P.t('ruler', 2), to: P.t('rulerOut', -2), side: 'both', type: 'void' },
    { from: P.t('clip', 0), to: P.t('clipOut', 0), side: 'both', type: 'wall' },
    { from: P.t('pencils', 18), to: P.t('pencilsOut', -18), side: 'left', type: 'wall' },
  ],
  surfaces: [],
  // The ruler has air under it: trackBuilder draws no skirts there.
  bridges: [{ from: P.t('ruler'), to: P.t('rulerOut') }],
  boostPads: [
    { t: P.t('pad1'), lateral: -3 },
    { t: P.t('pad2'), lateral: -3 },
  ],
  itemRows: [
    { t: P.t('row1'), count: 5 },
    { t: P.t('row2'), count: 5 },
    { t: P.t('row3'), count: 5 },
  ],
  ramps: [{ t: P.t('ramp'), length: 14, height: 2.6, trick: true, popup: true }],
  // The first pair the layout analysis reports; it also finds a shorter one inside it
  // (pencils -17 → pencilsOut -3) across the same infield.
  shortcut: { from: P.t('pencils', -59), to: P.t('pencilsOut', 39), side: 'right' },
  startT: 0,
  theme: {
    paper: '#b98a5e', ink: '#2b1d16', road: '#8d8a86', roadLine: '#fffaf0',
    curbA: '#3f6fb5', curbB: '#fffaf0', offroad: '#caa27a', wall: '#c9ccd4', desk: '#5a3b28',
    fence: { face: '#fbf7ea', trim: '#3f6fb5', top: 'flat' },      // folded index cards with a blue rule
    skyTop: '#3a2e3f', skyBottom: '#f3c98b',
    fog: { color: '#e9c89b', near: 170, far: 760 },
    sun: { dir: [-0.3, 0.85, 0.35], color: '#ffe2b0', intensity: 2.0 },
    ambient: { color: '#d7c4b4', intensity: 1.1 },
    accents: ['#ffe45c', '#e8534a', '#4d7fc4', '#f7f2e6', '#7cc27a'],
  },
  music: { tempo: 124, scale: 'mixolydian', mood: 'finale' },
  scenery: 'desk',
  // Scenery anchors (lap fractions), read by scenery/themes/desk.js.
  decor: {
    book: [P.t('onBook'), P.t('start', 60)],            // the road on the open book (y 6)
    ruler: [P.t('ruler'), P.t('rulerOut')],
    stack: [P.t('rulerOut'), P.t('mug')],
    mug: [P.t('mug'), P.t('notebook')],
    notebook: [P.t('notebook'), P.t('clipOut')],
    clip: [P.t('clip'), P.t('clipOut')],
    erasers: [P.t('erasers'), P.t('erasersOut')],
    pencils: [P.t('pencils'), P.t('pencilsOut')],
    lamp: [P.t('lamp'), P.t('lampOut')],
    sticky: P.t('ramp', 7),
  },
};
