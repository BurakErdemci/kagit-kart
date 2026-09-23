import { layout } from './_path.js';

// Chapter 1 — wide, friendly, the tutorial. Clockwise.
const P = layout({
  start: [0, 0, 0], heading: 0, hw: 11, off: 12,
  segs: [
    ['S', 70, { mark: 'start', marks: { row1: 55 } }],
    ['R', 90, 72, { y: 2, mark: 'windmillBend' }],                 // T3: the drift-teaching sweeper
    ['S', 50, { y: 6 }],
    ['L', 60, 55, { y: 8 }],                                       // T2 over the hill
    ['S', 115, { y: 1, mark: 'jump', marks: { ramp: 12, stream: 50, row2: 92 } }], // crest jump over the stream
    // Beehive hairpin (T3). Parallel legs 56 m apart: a rocket cuts the infield (core shortcut rule).
    ['R', 180, 28, { hw: 10, off: 10, y: 1, mark: 'hairpin', end: 'hairpinOut' }],
    ['S', 60, { hw: 11, off: 12, adj: true, marks: { pad1: 28 } }],
    ['L', 20, 50, { mark: 'esses' }],                              // quick flicks along the stream
    ['S', 15],
    ['R', 40, 45],
    ['S', 10],
    ['L', 85, 45],                                                  // T2 down to the bridge
    ['S', 70, { hw: 9, off: 3, mark: 'bridgeIn', end: 'bridgeOut' }], // covered bridge over the stream
    ['R', 80, 48, { hw: 11, off: 12, y: 5 }],                     // T2 up to the windmill ridge
    ['S', 40, { y: 6.5, mark: 'ridge' }],
    ['S', 45, { y: 4.5, marks: { row3: 20 } }],
    ['R', 45, 50, { y: 5 }],
    ['S', 60, { adj: true }],
    ['R', 40, 140, { y: 1.5, marks: { pad2: 60 } }],              // long gentle bend down through the daisies
    ['R', 50, 45, { y: 0 }],
    ['S', 60, { marks: { gridBack: 0 } }],
  ],
});

export default {
  id: 'meadow',
  chapter: 1,
  name: 'Papatya Çayırı',
  subtitle: 'Bahar sabahı, rüzgârgülleri ve dere',
  laps: 3,
  points: P.points,
  halfWidth: P.halfWidth,
  bank: P.bank,
  offroad: P.offroad,
  edges: [
    { from: P.t('bridgeIn', -4), to: P.t('bridgeOut', 4), side: 'both', type: 'wall' },
    { from: P.t('hairpin', 6), to: P.t('hairpinOut', -4), side: 'left', type: 'wall' },
  ],
  surfaces: [],
  boostPads: [
    { t: P.t('pad1'), lateral: -3 },
    { t: P.t('pad2'), lateral: 4 },
  ],
  itemRows: [
    { t: P.t('row1'), count: 5 },
    { t: P.t('row2'), count: 5 },
    { t: P.t('row3'), count: 5 },
  ],
  ramps: [{ t: P.t('ramp'), length: 14, height: 2.5, trick: true, popup: true }],
  // The pair the layout analysis reports (its first entry across the infield), which the AI drives.
  shortcut: { from: P.t('hairpin', -37), to: P.t('hairpinOut', 49), side: 'right' },
  startT: 0,
  theme: {
    paper: '#f4ecd6', ink: '#2e3329', road: '#aaa59b', roadLine: '#fbf6e9',
    // A light warm ochre wash the cream page shows through (grey read as asphalt at chase distance).
    roadPrint: { wash: '#dccfae', warm: 0.22 },
    curbA: '#e0533d', curbB: '#fbf6e9', offroad: '#9dc76a', wall: '#e6cf9e', desk: '#7a5236',
    fence: { face: '#f6efdc', trim: '#e0533d', top: 'pickets' },   // a picket fence cut from card
    skyTop: '#8fc9ef', skyBottom: '#fcefd0',
    fog: { color: '#f3ead3', near: 170, far: 760 },
    sun: { dir: [0.5, 0.78, 0.32], color: '#fff3d6', intensity: 2.1 },
    ambient: { color: '#cfe0f0', intensity: 1.2 },
    accents: ['#f7d046', '#e8736b', '#6fa8dc', '#ffffff', '#b57bd6'],
  },
  music: { tempo: 118, scale: 'major', mood: 'sunny' },
  scenery: 'meadow',
  // Scenery anchors (lap fractions), read by scenery/themes/meadow.js.
  decor: {
    stream: [P.t('stream'), P.t('bridgeIn', 35)],
    bridge: [P.t('bridgeIn'), P.t('bridgeOut')],
    windmills: [P.t('windmillBend', 25), P.t('windmillBend', 85), P.t('ridge', 10), P.t('ridge', 60)],
    hives: P.t('hairpin', 45),
    picnic: P.t('ridge', 35),
    scarecrows: [P.t('esses', 5), P.t('start', 40)],
    village: P.t('start', 10),
  },
};
