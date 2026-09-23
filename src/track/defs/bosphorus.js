import { layout } from './_path.js';

// Chapter 2 — a paper İstanbul at blue hour. Figure-8 with one crossing: the European shore
// road runs north under the suspension bridge, curls left up the hill and crosses over itself
// onto the bridge. East over the strait, the tulip-garden hairpin, the Asian quay south, the
// low bridge west, the old town and the stone tower, back down to the shore.
const P = layout({
  start: [-70, 1, 230], heading: Math.PI, hw: 10, off: 10,
  segs: [
    ['S', 115, { y: 1, adj: true, mark: 'start', marks: { row1: 45 } }], // shore, water on the right
    ['L', 270, 39, { mark: 'curl' }],                                  // T3 climbing curl
    ['S', 25, { y: 9, mark: 'bridgeIn' }],
    ['S', 170, { off: 8, y: 9, marks: { row2: 70, strait: 15 } }],           // suspension bridge deck
    ['S', 75, { off: 10, y: 4, end: 'bridgeOut' }],
    ['R', 180, 28, { y: 4, mark: 'hairpin', end: 'hairpinOut' }],       // T3 tulip-garden hairpin
    ['S', 20],
    ['L', 90, 40, { mark: 'toQuay' }],                                  // T2 down to the quay
    ['S', 30, { mark: 'quay', marks: { pad1: 15 } }],
    ['S', 90, { mark: 'pier', marks: { ramp: 0, inletIn: 24, inletOut: 56 } }], // popup ramp over the pier inlet
    ['R', 90, 40, { y: 2.5, mark: 'lowIn' }],                           // T2 onto the low bridge
    ['S', 110, { off: 8, y: 2.5, adj: true, mark: 'lowBridge', end: 'lowOut' }], // low bridge west
    ['S', 20, { off: 10 }],
    ['R', 90, 45, { y: 6 }],                                             // T2 up into the old town
    ['S', 35, { y: 8, mark: 'oldTown', marks: { pad2: 18 } }],
    ['R', 40, 50, { y: 8 }],
    ['S', 15],
    ['L', 40, 50, { y: 3 }],
    ['S', 40, { y: 1, marks: { row3: 20 } }],
  ],
});

export default {
  id: 'bosphorus',
  chapter: 2,
  name: 'Boğaz Gecesi',
  subtitle: 'Mavi saatten geceye, iki köprü',
  laps: 3,
  points: P.points,
  halfWidth: P.halfWidth,
  bank: P.bank,
  offroad: P.offroad,
  edges: [
    { from: P.t('start', 10), to: P.t('curl', -5), side: 'right', type: 'water' },
    // The deck crosses the shore road before it reaches the strait: railings there, water only
    // where the deck is over the strait (water strips reach 46 m out and must not cover a road).
    { from: P.t('bridgeIn', 20), to: P.t('bridgeIn', 64), side: 'both', type: 'wall' },
    { from: P.t('bridgeIn', 64), to: P.t('bridgeOut', -76), side: 'both', type: 'water' },
    { from: P.t('hairpin', 20), to: P.t('hairpinOut', -20), side: 'left', type: 'wall' },
    { from: P.t('quay'), to: P.t('lowIn', -5), side: 'right', type: 'water' },
    { from: P.t('lowBridge', 5), to: P.t('lowOut', -5), side: 'both', type: 'water' },
  ],
  surfaces: [],
  // Spans with air under the deck (trackBuilder draws no skirts); scenery draws the towers and
  // cables. One water surface for the strait, so strips under the 9 m deck sit on the water.
  bridges: [
    { from: P.t('bridgeIn', 20), to: P.t('bridgeOut', -76) },
    { from: P.t('lowBridge'), to: P.t('lowOut') },
  ],
  waterLevel: +Math.min(...P.samples.py).toFixed(2),
  boostPads: [
    { t: P.t('pad1'), lateral: 3 },
    { t: P.t('pad2'), lateral: -3 },
  ],
  itemRows: [
    { t: P.t('row1'), count: 5 },
    { t: P.t('row2'), count: 5 },
    { t: P.t('row3'), count: 5 },
  ],
  ramps: [{ t: P.t('ramp'), length: 14, height: 2.5, trick: true, popup: true }],
  shortcut: { from: P.t('hairpin', -8), to: P.t('hairpinOut', 8), side: 'right' },
  startT: 0,
  theme: {
    paper: '#2f3b63', ink: '#161a2e', road: '#6b7189', roadLine: '#f4e6c4',
    curbA: '#c8413b', curbB: '#f4e6c4', offroad: '#44557f', wall: '#b9a88c', desk: '#4a3322',
    water: '#27497a',
    skyTop: '#141b3a', skyBottom: '#e08a6a',
    fog: { color: '#3b4270', near: 150, far: 700 },
    sun: { dir: [-0.35, 0.72, -0.6], color: '#b8c6ff', intensity: 1.35 },
    ambient: { color: '#8a95cf', intensity: 1.05 },
    accents: ['#ffcf6b', '#ffd98a', '#f4efe6', '#c8413b', '#7fd0e6'],
  },
  music: { tempo: 96, scale: 'hicaz', mood: 'night' },
  scenery: 'bosphorus',
  // Scenery anchors (lap fractions), read by scenery/themes/bosphorus.js.
  decor: {
    shore: [P.t('start', 10), P.t('curl', -5)],          // European shore road, water on the right
    curl: [P.t('curl'), P.t('bridgeIn')],                // the stone tower stands inside the curl
    bridge: [P.t('bridgeIn'), P.t('bridgeOut')],         // suspension bridge straight
    tulips: [P.t('hairpin'), P.t('hairpinOut')],
    quay: [P.t('quay'), P.t('lowIn', -5)],               // Asian quay, water on the right
    pier: P.t('pier', 40),
    lowBridge: [P.t('lowBridge'), P.t('lowOut')],
    oldTown: P.t('oldTown', 15),
    simit: P.t('start', -25),
  },
};
