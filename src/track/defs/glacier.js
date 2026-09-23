import { layout } from './_path.js';

// Chapter 3 — the hardest: narrow, high, icy. Counter-clockwise. Lodge straight, the frozen
// lake (ice, open water on the left), two switchbacks up the face (the first one's snowfield is
// the rocket cut), the cliff ridge and the summit jump, a banked descent through the pines
// under the cable car, a second jump over the crevasse, and the long bend round the lodge.
const P = layout({
  start: [0, 0, 0], heading: 0, hw: 9, off: 8,
  segs: [
    ['S', 60, { y: 0, mark: 'start', marks: { row1: 40 } }],
    ['L', 70, 55, { mark: 'toLake' }],                                    // T2
    ['S', 30, { mark: 'lakeIn' }],
    ['R', 45, 80, { mark: 'lakeBend' }],                                  // T2 icy bend over the lake
    ['S', 42, { end: 'lakeOut', marks: { row2: 26 } }],
    ['L', 155, 42, { mark: 'lakeExit' }],                                 // T3 round the lake's end
    ['S', 60, { y: 3, mark: 'climb' }],
    // Switchback 1 is flat: its snowfield is the rocket cut (legs 46 m apart, inside open).
    ['R', 180, 23, { hw: 8, off: 6, y: 3, mark: 'sw1', end: 'sw1Out' }],  // T2
    ['S', 60, { hw: 9, off: 8, mark: 'face', marks: { pad1: 22 } }],
    ['L', 180, 23, { hw: 8, off: 6, mark: 'sw2' }],                      // T2, climbs through
    ['S', 40, { hw: 9, off: 8, y: 18, mark: 'ridge' }],
    ['S', 90, { y: 18, marks: { ramp: 62, row3: 8 } }],                   // cliff ridge, summit jump off the crest
    ['S', 85, { mark: 'descent' }],
    ['L', 90, 70, { y: 5, bank: 6, mark: 'pines' }],                      // T3 banked descent, cable car overhead
    ['S', 110, { y: 2, adj: true, mark: 'crevasse', marks: { ramp2: 10, pad2: 90 } }], // second jump
    ['L', 90, 62, { y: 0, mark: 'lodgeBend' }],                           // T3 round the lodge
    ['S', 75, { adj: true, y: 0 }],
  ],
});

export default {
  id: 'glacier',
  chapter: 3,
  name: 'Buzul Geçidi',
  subtitle: 'Pembe gün doğumunda dağ geçidi',
  laps: 3,
  points: P.points,
  halfWidth: P.halfWidth,
  bank: P.bank,
  offroad: P.offroad,
  edges: [
    { from: P.t('lakeIn', -10), to: P.t('lakeOut', 10), side: 'left', type: 'water' },
    { from: P.t('sw1', 4), to: P.t('sw1Out', -4), side: 'left', type: 'wall' },
    { from: P.t('sw2', 4), to: P.t('ridge', -4), side: 'right', type: 'wall' },
    { from: P.t('ridge', 0), to: P.t('descent', 30), side: 'right', type: 'void' },
  ],
  surfaces: [
    { from: P.t('lakeIn', -5), to: P.t('lakeOut', 5), side: 'both', type: 'ice' },
  ],
  boostPads: [
    { t: P.t('pad1'), lateral: 0 },
    { t: P.t('pad2'), lateral: -3 },
  ],
  itemRows: [
    { t: P.t('row1'), count: 4 },
    { t: P.t('row2'), count: 4 },
    { t: P.t('row3'), count: 4 },
  ],
  ramps: [
    { t: P.t('ramp'), length: 16, height: 3.4, trick: true, popup: true },
    { t: P.t('ramp2'), length: 14, height: 2.8, trick: true, popup: true },
  ],
  shortcut: { from: P.t('sw1', -8), to: P.t('sw1Out', 8), side: 'right' },
  startT: 0,
  theme: {
    paper: '#f4eef0', ink: '#2c2a3f', road: '#8e95a8', roadLine: '#fdf7f2',
    curbA: '#d6546a', curbB: '#fdf7f2', offroad: '#e9eef6', wall: '#c9dcee', desk: '#6d4c3d',
    water: '#5f8fbf',
    skyTop: '#6d8fd8', skyBottom: '#ffc4c2',
    fog: { color: '#f7dfe4', near: 140, far: 640 },
    sun: { dir: [0.75, 0.38, -0.3], color: '#ffd6c4', intensity: 2.2 },
    ambient: { color: '#c7d3f2', intensity: 1.25 },
    accents: ['#f29fb5', '#2f6b5a', '#9b5b3a', '#9fd6f2', '#ffffff'],
  },
  music: { tempo: 128, scale: 'dorian', mood: 'crisp' },
  scenery: 'glacier',
  // Scenery anchors (lap fractions), read by scenery/themes/glacier.js.
  decor: {
    lodge: P.t('start', 25),
    lake: [P.t('lakeIn', -10), P.t('lakeOut', 10)],
    switchbacks: [P.t('climb'), P.t('ridge')],
    ridge: [P.t('ridge'), P.t('descent')],
    summit: P.t('ramp', 16),
    pines: [P.t('descent', 30), P.t('lodgeBend', 40)],
    cable: [P.t('start', 30), P.t('ridge', 50)],
    crevasse: P.t('ramp2', 14),
  },
};
