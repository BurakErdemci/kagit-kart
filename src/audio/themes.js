// Music of the book. Melodies are scale degrees (1–7, ' = octave up, , = down, b/# accidentals,
// ! accent, ? ghost, 1+5 = dyad); '-' holds, '.' rests, '|' separates bars. Bass tokens are chord-relative
// (r 3 5 7 8, a = chromatic approach to the next root), comp hits whole voicings, arp indexes chord tones,
// drum grids use X x o. Every chapter shares the book's leitmotif (the title's opening 3-4-5-8 figure).
import { SCALES } from './music.js';

// Pattern with `first` in bar 1 and silence in the rest; bars = total bar count.
const once = (first, bars, empty = '.'.repeat(first.replace(/\s|\|/g, '').length)) =>
  [first, ...Array(bars - 1).fill(empty)].join('|');
const atBar = (bar, pat, bars, empty) => Array.from({ length: bars }, (_, i) => (i === bar ? pat : empty)).join('|');

// ---- title / menu: a music-box waltz, as if the book just opened --------------------------------------
const title = {
  trim: -4.6, tempo: 92, beats: 3, steps: 4, key: 65, scale: 'major',
  lanes: {
    mel: { inst: 'musicbox', oct: 1, gain: 0.95, pan: 0.12, rev: 0.4, ring: 1.3 },
    ctr: { inst: 'musicbox', gain: 0.5, pan: -0.28, rev: 0.4, ring: 1.0 },
    acc: { inst: 'musicbox', lo: -5, hi: 9, n: 3, gain: 0.34, pan: -0.1, rev: 0.35, ring: 0.5 },
    bass: { inst: 'musicbox', lo: -17, gain: 0.6, rev: 0.3, ring: 0.9 },
    pad: { inst: 'pad', lo: -8, hi: 8, n: 4, gain: 0.34, rev: 0.6 },
    spark: { inst: 'bell', oct: 2, gain: 0.16, pan: 0.35, rev: 0.7 },
  },
  sections: {
    intro: {
      bars: 2, chords: ['I', 'I'], fill: false,
      parts: { acc: { arp: '1 2 3 4 5 6 | 7 - - - - -' }, pad: { chord: true, v: 0.5 } },
    },
    A: {
      bars: 8, chords: ['I', 'vi', 'IV', 'V', 'I', 'vi', 'IV V', 'I'],
      parts: {
        mel: "3 - 4 5 - 1' | 6 - - 5 - 3 | 4 - 5 6 - 1' | 5 - - - . . | 3 - 4 5 - 3' | 3' - 2' 1' - 6 | 6 - 4 2 - 7, | 1 - - - . .",
        acc: [{ comp: '. x x' }, { arp: '. 2 3 4 3 2' }],
        bass: { bass: 'r - -' },
      },
    },
    A2: {
      bars: 8, chords: ['I', 'vi', 'IV', 'V', 'I', 'ii', 'V7', 'I'],
      parts: {
        mel: "3 4 5 1' 7 1' | 6 - - 5 4 3 | 4 - 5 6 - 2' | 1' - 7 6 5 . | 3 - 4 5 - 3' | 4' - 3' 2' - 6 | 5 - 4 2 - 7, | 1 - - 1' - -",
        acc: { comp: '. x x' },
        bass: { bass: 'r - 5,' },
        ctr: [null, "3 - - | 3 - - | 4 - - | 2 - - | 3 - - | 4 - - | 2 - - | 3 - -"],
      },
    },
    B: {
      bars: 8, chords: ['vi', 'iii', 'IV', 'I', 'ii', 'V', 'iii vi', 'V7'],
      parts: {
        mel: "6 - - - 5 6 | 7 - - - 6 5 | 4 - - 6 1' 4' | 3' - - - - . | 2' - - 1' 7 6 | 7 - - 5 - 2 | 3 - 5 6 - 1' | 5 - 4 2 - 7,",
        ctr: "6 - - | 5 - - | 6 - - | 5 - - | 4 - - | 2 - - | 3 - 6 | 5 - 4",
        acc: { comp: '. x x' },
        bass: { bass: 'r - 5,' },
        pad: { chord: true, v: 0.55 },
      },
    },
    A3: {
      extends: 'A',
      parts: {
        acc: { arp: '. 2 3 4 3 2' },
        ctr: "3 - 5 | 6 - 3 | 4 - 6 | 5 - 2 | 3 - 5 | 6 - 1' | 6 - 7 | 1' - -",
        pad: { chord: true, v: 0.6 },
        spark: "5 - - - - - | 3 - - - - - | 1' - - - - - | 7 - - - - - | 5 - - - - - | 6 - - - - - | 1' - - 7 - - | 1' - - - - -",
      },
    },
  },
  form: ['intro', 'A', 'A2', 'B', 'A3'], loopTo: 1,
};

// ---- meadow: bright major jig — tin whistle, mandolin, strummed guitar, bodhrán-like frame drum ------
const meadowA = "1 2 3 5 3 1 | 4 6 5 4 3 2 | 3 5 1' 5 3 1 | 2 7, 5, 7, 2 4 | 5 3 5 1' 7 6 | 4 6 2' 1' 6 4 | 5 - 7 2' 1' 7 | 1' - - . . .";
const meadowB = "6 - 4 6 1' 2' | 3' - 2' 1' - 5 | 6 - 4 6 1' 2' | 2' - 7 5 - 7 | 1' - 6 3' - 1' | 2' 1' 6 4 - 6 | 5 6 7 2' 1' 7 | 1' - - - . .";
const meadowC = "5 - - 3 - - | 2 - - 7, - - | 1 - - 6, - 1 | 4 - - 6 - 5 | 5 - - 1' - - | 7 - - 5 - 7 | 6 - 4 5 - 7 | 1' - - - - -";
const meadowDrums = {
  bendir: 'X...x.X...x.', shaker: 'x.o.o.x.o.o.', tamb: '......x.....',
};
const meadow = {
  trim: -5.6, tempo: 116, beats: 2, steps: 6, key: 62, scale: 'major',
  lanes: {
    mel: { inst: 'whistle', oct: 1, gain: 0.5, pan: 0.1, rev: 0.28, legato: 0.96, hum: 0.006 },
    mando: { inst: 'mandolin', lo: 2, hi: 19, gain: 0.42, pan: -0.32, rev: 0.25, hum: 0.008 },
    gtr: { inst: 'pluck', lo: -8, hi: 8, n: 4, strum: 0.011, gain: 0.42, pan: -0.12, rev: 0.2, hum: 0.006, vj: 0.2 },
    bass: { inst: 'bass', lo: -26, gain: 0.62, rev: 0.08 },
    perc: { inst: 'kit', gain: 0.62, pan: 0.05, rev: 0.12, hum: 0.006, vj: 0.25 },
    clap: { inst: 'kit', gain: 0.4, pan: 0.2, rev: 0.3, hum: 0.008 },
    fan: { inst: 'brass', gain: 0.4, lo: 2, hi: 21, n: 3, rev: 0.3 },
    fbell: { inst: 'bell', oct: 1, gain: 0.4, pan: 0.2, rev: 0.4 },
  },
  sections: {
    intro: {
      bars: 4, chords: ['I', 'IV', 'I', 'V'], fill: false, vel: 1.3,
      parts: {
        gtr: { comp: 'x - - . . .' },
        mel: { mel: '5 - - - - - | 6 - - 4 - - | 5 - - 3 - - | 2 - - - - -', oct: -1 },
        perc: { drum: { shaker: 'o.....o.....' } },
      },
    },
    A: {
      bars: 8, chords: ['I', 'IV', 'I', 'V7', 'I', 'IV', 'V', 'I'],
      parts: {
        mel: [meadowA, null],
        mando: [null, { mel: meadowA }],
        gtr: { comp: 'X . x X . x' },
        bass: { bass: 'r . . 5, . .' },
        perc: { drum: meadowDrums, fill: { bendir: 'X.x.x.X.xxxx' } },
      },
    },
    A2: {
      extends: 'A',
      parts: {
        mel: meadowA,
        mando: [{ mel: meadowA }, { arp: '1 2 3 4 3 2' }],
        bass: { bass: 'r . 5, 8, . 5,' },
      },
    },
    B: {
      bars: 8, chords: ['IV', 'I', 'IV', 'V', 'vi', 'IV', 'V', 'I'],
      parts: {
        mel: meadowB,
        mando: { arp: '1 . 3 . 2 .' },
        gtr: { comp: 'X . x X . x' },
        bass: { bass: 'r . . 5, . .' },
        perc: { drum: { ...meadowDrums, tamb: '......X.....' }, fill: { bendir: 'X.x.x.X.x.x.', tamb: 'x.x.x.X.x.x.' } },
        clap: [null, { drum: { clap: '......x.....' } }],
      },
    },
    C: {
      bars: 8, chords: ['I', 'V', 'vi', 'IV', 'I', 'V', 'IV V', 'I'],
      parts: {
        mel: meadowC,
        mando: { arp: '1 2 3 4 3 2' },
        gtr: { comp: 'X . x X x x' },
        bass: { bass: 'r . 8, 5, . 3' },
        perc: { drum: { ...meadowDrums, bendir: 'X.x.x.X.x.x.', kick: 'X.....X.....' }, fill: { bendir: 'XxxxXxXxXxXX' } },
        clap: { drum: { clap: '......X.....' } },
      },
    },
    D: {
      bars: 8, chords: ['vi', 'IV', 'I', 'V', 'vi', 'IV', 'V', 'V7'],
      parts: {
        mando: "6 - 1' 3' 2' 1' | 2' 1' 6 5 6 1' | 3' - 5' 3' 2' 1' | 7 1' 2' 5' 4' 2' | 3' 2' 1' 6 1' 3' | 4' 3' 2' 1' 6 4 | 5 6 7 1' 2' 3' | 4' - 3' 2' - 7",
        mel: { mel: '3 - - - - - | 2 - - - - - | 1 - - - - - | 7, - - - - - | 3 - - - - - | 4 - - - - - | 5 - - - - - | 5 - - - - -', oct: -1 },
        gtr: { comp: 'X . x X . x' },
        bass: { bass: 'r . 5, 8, . 5,' },
        perc: { drum: { ...meadowDrums, bendir: 'X.x.x.X.x.x.' }, fill: { bendir: 'X.x.X.x.XxXX' } },
        clap: { drum: { clap: '......x.....' } },
      },
    },
    brk: {
      bars: 4, chords: ['vi', 'IV', 'I', 'V'], fill: false,
      parts: {
        mel: { mel: '3 - - - - - | 4 - - - - - | 5 - - - - - | 5 - - 7 - -', oct: -1 },
        bass: { bass: 'r - - - - -' },
        perc: { drum: { bendir: 'x.....x.....', shaker: 'o.o.o.o.o.o.' } },
        gtr: { comp: 'o . . o . .' },
      },
    },
    _fl: {
      bars: 1, chords: ['IV V'], fill: false,
      parts: {
        fan: { comp: 'X . X X - -' },
        fbell: '1 . 4 5 - -',
        perc: { drum: { bendir: 'XxXxXxXxXxXX', tamb: 'x.x.x.XxXxXx' } },
      },
    },
  },
  form: ['A', 'A2', 'B', 'C', 'D', 'A2', 'B', 'brk', 'C'], loopTo: 0,
  intro: 'intro',
  finalLap: { form: ['C', 'D', 'A2', 'C'] },
};

// ---- bosphorus: Hicaz on D over a darbuka maksum; kanun, ney, a ferry horn across the water ---------
const bosA = '1 - 2 3 - - 4 3 | 2 - - 1 2 3 4 5 | 6 - 5 - 4 3 5 4 | 3 - - - 2 3 1 - | 4 - 5 6 - 5 4 3 | 2 - 3 4 3 2 1 7, | 6 5 4 3 2 - 3 2 | 1 - - - - - . .';
const bosB = "4' - - 3' 4' - 5' - | 6' - 5' 4' 3' - 4' - | 5' - - - 3' - 1' - | 2' 3' 4' 3' 2' - 1' - | 2' - - 1' 7 - 6 - | 6 - 5 4 5 6 7 6 | 5 - 4 3 2 - 3 - | 1 - - - - - - -";
const bosC = "5 - 5 6 5 - 3 - | 2 - 3 4 5 - 6 - | 4 - 4 6 5 4 3 4 | 3 - - 2 1 - - - | 1' - 1' 7 6 - 5 - | 6 5 4 5 6 5 4 3 | 2 3 4 3 2 - 1 2 | 1 - - - - - . .";
const maksum = { doum: 'X.......X.......', tek: '..X...X.....X...', ka: '...o.o...oo..o.o' };
const malfuf = { doum: 'X.......X.......', tek: '...X..X....X..X.', ka: '.o...o...o...o..' };
const bosphorus = {
  trim: -3.3, tempo: 108, beats: 4, steps: 4, key: 62, scale: 'hicaz',
  lanes: {
    kanun: { inst: 'kanun', oct: 1, gain: 0.5, pan: 0.18, rev: 0.32, hum: 0.006 },
    ney: { inst: 'ney', gain: 0.42, pan: -0.2, rev: 0.45 },
    oud: { inst: 'oud', lo: -10, hi: 7, gain: 0.45, pan: -0.3, rev: 0.2, hum: 0.008 },
    bass: { inst: 'bass', lo: -26, gain: 0.6, rev: 0.08 },
    str: { inst: 'pad', lo: -7, hi: 9, n: 4, gain: 0.3, rev: 0.6 },
    horn: { inst: 'horn', oct: -1, gain: 0.36, pan: 0.05, rev: 0.75 },
    dr: { inst: 'kit', gain: 0.72, pan: 0.05, rev: 0.12, hum: 0.005, vj: 0.3 },
    fan: { inst: 'brass', gain: 0.38, lo: 0, hi: 19, n: 3, rev: 0.3 },
  },
  ambience: [{ src: 'brown', type: 'lowpass', f: 380, gain: 0.05, lfo: { rate: 0.085, depth: 0.03 } }],
  sections: {
    intro: {
      bars: 4, chords: ['I', 'I', 'bII', 'I'], fill: false, vel: 0.75,
      parts: {
        horn: { mel: '1+5 - - - . . . . | . . . . . . . . | 1+5 - - - - - - - | - - - - . . . .' },
        ney: '. . . . 5 - - - | 4 - 3 - 2 - 3 - | 2 - - - - - 1 - | 1 - - - - - - -',
        str: { chord: true, v: 0.5 },
        dr: { drum: { zil: 'X...............|................|X...............|................' } },
      },
    },
    A: {
      bars: 8, chords: ['I', 'bII', 'I', 'I', 'iv', 'bvii', 'bII', 'I'],
      parts: {
        kanun: bosA,
        oud: { arp: '1 - 3 1 2 - 3 -' },
        bass: { bass: 'r - . r r - 5, .' },
        // A opens the race: plucks alone sank under the engines between darbuka hits (median −23 dB vs −16
        // in A2). A soft ney holds chord tones below the kanun; A2 still builds when the ney takes the tune.
        ney: "5? - - - - - - - | 4? - - - - - - - | 3? - - - - - - - | 5? - - - - - - - | 4? - - - - - - - | 4? - - - - - - - | 2? - - - - - - - | 1? - - - - - - -",
        dr: { drum: { ...maksum, tamb: '....o.......o...' }, fill: { tek: '..X...X...XxXxXX' } },
      },
    },
    A2: {
      extends: 'A',
      parts: {
        ney: [{ mel: bosA, oct: 1 }, null],
        str: { chord: true, v: 0.45 },
        oud: [{ arp: '1 - 3 1 2 - 3 -' }, { comp: 'x . . x . . x .' }],
      },
    },
    B: {
      bars: 8, chords: ['iv', 'iv', 'I', 'I', 'bII', 'bII', 'I', 'I'],
      parts: {
        kanun: bosB,
        ney: '4 - - - - - - - | 5 - - - 6 - - - | 5 - - - - - - - | 3 - - - - - - - | 2 - - - - - - - | 6, - - - 5, - - - | 3 - - - 2 - - - | 1 - - - - - - -',
        horn: { mel: once('1+5 - - - . . . .', 8, '. . . . . . . .') },
        oud: { comp: 'x . . x . . x .' },
        bass: { bass: 'r - . r r - 5, .' },
        str: { chord: true, v: 0.5 },
        dr: { drum: { ...maksum, zil: once('X...............', 8) }, fill: { doum: 'X.......X...X.X.', tek: '..X...X.XXXXXXXX' } },
      },
    },
    C: {
      bars: 8, chords: ['I', 'bII', 'iv', 'I', 'I', 'bII', 'bII', 'I'],
      parts: {
        kanun: bosC,
        // Variants go by loop cycle, and a race rarely reaches cycle 1: the climax needs its ney in cycle 0.
        ney: [{ mel: bosC, oct: 1 }, { mel: bosC }],
        oud: { arp: '1 3 2 3 1 3 2 3' },
        bass: { bass: 'r . r . r . 5, .' },
        str: { chord: true, v: 0.5 },
        dr: { drum: { ...malfuf, tamb: '....x.......x...', zil: once('X...............', 8) }, fill: { tek: 'X.X.X.X.XXXXXXXX' } },
      },
    },
    brk: {
      bars: 4, chords: ['I', 'bII', 'bvii', 'I'], fill: false,
      parts: {
        horn: { mel: '1+5 - - - . . . . | . . . . . . . . | . . . . . . . . | . . . . . . . .' },
        ney: '5 - - - - - 6 5 | 4 - - - 3 - 2 - | 2 - - - 1 - 7, - | 1 - - - - - - -',
        bass: { bass: 'r - - - - - - -' },
        dr: { drum: { doum: 'X.......X.......', ka: '...o...o...o.o.o' } },
      },
    },
    // vel 0.82: the full darbuka bar under the brass stab reached 0.9996 FS on the bare bus (the others peak ≤ 0.9).
    _fl: {
      bars: 1, chords: ['bII I'], fill: false, vel: 0.82,
      parts: {
        fan: { comp: 'X . . X . . . . X - - - - - - -' },
        kanun: "6 5 4 3 2 3 2 1 | ",
        dr: { drum: { doum: 'X..X..X.X.......', tek: 'XXXXXXXXX.X.X.XX', zil: 'X.......X.......' } },
      },
    },
  },
  form: ['A', 'A2', 'B', 'C', 'brk', 'A2', 'B', 'C'], loopTo: 0,
  intro: 'intro',
  finalLap: { form: ['C', 'A2', 'B', 'C'] },
};

// ---- glacier: crystalline arpeggios, bell lead, a pulse bass that never lets go -----------------------
const glacierDrA = { kick: 'X.......X.......', tick: 'x.o.x.o.x.o.x.o.', clap: '....x.......x...' };
const glacier = {
  trim: -3.6, tempo: 132, beats: 4, steps: 4, key: 64, scale: 'minor',
  lanes: {
    bell: { inst: 'bell', oct: 1, gain: 0.55, pan: 0.15, rev: 0.55 },
    arp: { inst: 'glass', lo: 0, gain: 0.3, pan: -0.28, rev: 0.4, ring: 0.35 },
    arp2: { inst: 'glass', lo: 5, gain: 0.2, pan: 0.35, rev: 0.5, ring: 0.3 },
    pulse: { inst: 'pulse', lo: -28, gain: 0.46, rev: 0.05, legato: 0.8 },
    pad: { inst: 'pad', lo: -5, hi: 12, n: 4, gain: 0.3, rev: 0.7 },
    dr: { inst: 'kit', gain: 0.6, rev: 0.15 },
  },
  ambience: [{ src: 'pink', type: 'bandpass', f: 1100, q: 0.9, gain: 0.018, lfo: { rate: 0.07, depth: 0.012, sweep: 500 } }],
  sections: {
    intro: {
      bars: 4, chords: ['i', 'VI', 'III', 'VII'], fill: false, vel: 1.6,
      parts: {
        pad: { chord: true, v: 0.6 },
        arp: { arp: '1 2 3 4 5 4 3 2' },
        bell: '5 - - - - - - - | 3 - - - - - - - | 7, - - - - - - - | 4 - - - - - - -',
      },
    },
    A: {
      bars: 8, chords: ['i', 'VI', 'III', 'VII', 'i', 'VI', 'III', 'VII'],
      parts: {
        bell: "5 - - - 3 - - - | 5 - - - 6 - - - | 7 - - - 5 - - - | 4 - - - 2 - - - | 5 - - - 1' - - - | 7 - - 6 5 - 3 - | 5 - - - 2' - 1' - | 7 - - - - - - -",
        arp: { arp: '1 3 2 4 3 5 4 3 1 3 2 4 3 5 4 3' },
        pulse: { bass: 'r r 8 r r r 8 r' },
        pad: { chord: true, v: 0.5 },
        dr: { drum: glacierDrA, fill: { clap: '....x.......x.xx' } },
      },
    },
    B: {
      bars: 8, chords: ['iv', 'VI', 'i', 'VII', 'iv', 'VI', 'VII', 'VII'],
      parts: {
        bell: "1' - 7 1' 3' - 1' - | 3' - 2' 1' 7 - 5 - | 5 - - - 1' - 2' - | 4' - 3' 2' 1' - 7 - | 3' - - - 1' - - - | 1' - - - 3' - - - | 2' - - - 4' - - - | 7 - 1' - 2' - 4' -",
        arp: { arp: '1 2 3 2 1 2 3 4 1 2 3 2 1 2 3 4' },
        pulse: { bass: 'r . r r . r r .' },
        pad: { chord: true, v: 0.45 },
        dr: { drum: { kick: 'X.....X...X.....', tick: 'xoxoxoxoxoxoxoxo', snare: '....X.......X...' }, fill: { snare: '....X...X.X.XXXX' } },
      },
    },
    C: {
      bars: 8, chords: ['VI', 'VII', 'i', 'III', 'VI', 'VII', 'i', 'i'],
      parts: {
        bell: "5 6 7 5 6 - 3 - | 4 5 6 4 5 - 2 - | 3 4 5 3 4 - 1 - | 2 - 3 - 5 - 7 - | 1' - 7 - 5 - 3 - | 2' - 1' - 6 - 4 - | 5 - - - 3 - 1' - | 1' - - - - - - -",
        arp: { arp: '1 2 3 4 5 4 3 2 1 2 3 4 5 6 5 4' },
        arp2: { arp: '3 . 4 . 5 . 4 . 3 . 4 . 5 . 6 .' },
        pulse: { bass: 'r r 8 r r r 8 r' },
        pad: { chord: true, v: 0.4 },
        dr: {
          drum: { kick: 'X...X...X...X...', tick: 'xoxoxoxoxoxoxoxo', snare: '....X.......X...', ohat: '..o...o...o...o.', crash: once('X...............', 8) },
          fill: { snare: '....X.X.XXXXXXXX' },
        },
      },
    },
    brk: {
      bars: 4, chords: ['VI', 'VII', 'i', 'i'], fill: false,
      parts: {
        bell: "3' - - - - - - - | 2' - - - - - - - | 1' - - - - - - - | 5 - - - 7 - - -",
        pad: { chord: true, v: 0.7 },
        arp: { arp: '1 . . 3 . . 2 . . 4 . . 3 . . .' },
        dr: { drum: { kick: 'X...............', tick: '..o...o...o...o.' } },
      },
    },
    _fl: {
      bars: 1, chords: ['VII'], fill: false,
      parts: {
        fan: { comp: 'X . . . X . . . X - - - - - - -' },
        fbell: "4 4 4 4 6 - - - 1' - - - 2' - - -",
        arp: { arp: '1 2 3 4 5 4 3 2 1 2 3 4 5 6 5 4' },
        dr: { drum: { snare: 'xxxxxxxxXxXxXXXX', kick: 'X...X...X...X...', crash: 'X...............' } },
      },
    },
  },
  form: ['A', 'B', 'C', 'A', 'brk', 'B', 'C', 'C'], loopTo: 0,
  intro: 'intro',
  finalLap: { form: ['C', 'B', 'C', 'A'] },
};
glacier.lanes.fan = { inst: 'brass', gain: 0.3, lo: 0, hi: 19, n: 3, rev: 0.45 };
glacier.lanes.fbell = { inst: 'bell', oct: 1, gain: 0.45, pan: 0.2, rev: 0.5 };

// ---- desk: the reader's desk at night — lo-fi swing, brushes, rhodes, pencil taps, a typewriter bell ---
const pencilMotif = 'X..x.x..X.x.....';
const deskA = ". 5 4 2 - - 1 2 | 3 - - . . 5 6 5 | 7 - - - 5 - 3 - | 6 - 5 3 2 - . . | . 5 4 2 - 4 6 1' | 7 - 6 5 b6 - 5 - | 3 - - - - - . . | . 6 5 3 6 - 5 -";
const brushes = { swish: '....X.......X...', brush: 'x...x.o.x...x.o.', kick: 'o.......o.......' };
const desk = {
  trim: -4.2, tempo: 138, beats: 4, steps: 4, key: 65, scale: 'major', swing: 0.3, swingUnit: 2,
  lanes: {
    lead: { inst: 'epiano', oct: 1, gain: 0.6, pan: 0.15, rev: 0.35, ring: 0.5 },
    vib: { inst: 'bell', oct: 1, gain: 0.22, pan: -0.3, rev: 0.45, ring: 0.6 },
    ep: { inst: 'epiano', lo: -3, hi: 12, n: 4, gain: 0.4, pan: -0.2, rev: 0.3, vj: 0.2 },
    bass: { inst: 'bass', lo: -29, gain: 0.66, rev: 0.08, legato: 0.95 },
    dr: { inst: 'kit', gain: 0.75, rev: 0.2, hum: 0.006, vj: 0.3 },
    pen: { inst: 'kit', gain: 0.5, pan: 0.35, rev: 0.25, vj: 0.2 },
  },
  ambience: [{ src: 'crackle', type: 'highpass', f: 1400, gain: 0.03 }],
  sections: {
    intro: {
      bars: 4, chords: ['ii9', 'V13', 'Imaj9', 'Imaj9'], fill: false, vel: 1.5,
      parts: {
        ep: { comp: 'x - - - - - - -' },
        pen: { drum: { pencil: once(pencilMotif, 4), typebell: atBar(3, '............X...', 4, '................') } },
      },
    },
    A: {
      bars: 8, chords: ['ii9', 'V13', 'Imaj9', 'vi9', 'ii9', 'V7b9', 'Imaj9', 'VI7'],
      parts: {
        lead: deskA,
        ep: { comp: 'x - - - . x - -' },
        bass: { bass: 'r 3 5 a' },
        dr: { drum: brushes },
        pen: { drum: { pencil: [pencilMotif, ...Array(3).fill('................')].join('|'), typebell: atBar(7, '............x...', 8, '................') } },
      },
    },
    B: {
      bars: 8, chords: ['IVmaj9', 'iv7', 'iii7', 'VI7', 'ii9', 'V13', 'Imaj9', 'Imaj9'],
      parts: {
        lead: "5 - 3 - 1' - 7 - | 4 - - 1' b6 - - - | 7 - 5 - 3 - 2 - | 6 - - 5 3 - 6 - | 4 - 2 - 6 - 5 - | 3 - 2 - 7, - 6, - | 7 - 1' - 3' - - - | 2' - 1' - 5 - - -",
        ep: { comp: 'x - - x - - . .' },
        bass: { bass: 'r 5 8 a' },
        dr: { drum: { ...brushes, rim: '............x...' }, fill: { brush: 'x...x.x.x.x.xxxx' } },
        pen: { drum: { pencil: [pencilMotif, '................'].join('|') } },
      },
    },
    C: {
      extends: 'A',
      parts: {
        vib: deskA,
        ep: { comp: 'x - . x - . x .' },
        bass: { bass: 'r 5 3 a' },
        dr: { drum: { ...brushes, kick: 'X.....x.X.......', rim: '....x.......x...' } },
        pen: { drum: { pencil: pencilMotif, typebell: atBar(7, '............x...', 8, '................') } },
      },
    },
    brk: {
      bars: 4, chords: ['ii9', 'V13', 'iii7', 'VI7'], fill: false,
      parts: {
        ep: { comp: 'x - - - - - - -' },
        bass: { bass: 'r - 5 -' },
        pen: { drum: { pencil: pencilMotif } },
        dr: { drum: { swish: '....X.......X...' } },
      },
    },
    _fl: {
      bars: 1, chords: ['V13'], fill: false,
      parts: {
        ep: { comp: 'X . x . X - - -' },
        lead: "5 6 7 2' - - . .",
        pen: { drum: { pencil: 'x.x.x.x.xxxxXXXX', typebell: 'X...............' } },
        dr: { drum: { swish: 'X.......X.......', kick: 'X.......X...X...' } },
      },
    },
  },
  form: ['A', 'B', 'A', 'brk', 'C', 'B', 'C'], loopTo: 0,
  intro: 'intro',
  finalLap: { form: ['C', 'B', 'C', 'A'] },
};

// ---- results: the leitmotif, unhurried — harp, rhodes, brushes ---------------------------------------
const results = {
  tempo: 96, beats: 4, steps: 4, key: 65, scale: 'major', swing: 0.22, swingUnit: 2,
  lanes: {
    mel: { inst: 'harp', oct: 1, gain: 0.66, pan: 0.1, rev: 0.45 },
    ep: { inst: 'epiano', lo: -3, hi: 12, n: 4, gain: 0.36, pan: -0.2, rev: 0.35 },
    bass: { inst: 'bass', lo: -29, gain: 0.55, rev: 0.1 },
    dr: { inst: 'kit', gain: 0.5, rev: 0.2, vj: 0.3 },
    box: { inst: 'musicbox', oct: 2, gain: 0.2, pan: 0.35, rev: 0.6 },
  },
  sections: {
    A: {
      bars: 8, chords: ['Imaj7', 'vi7', 'IVmaj7', 'V7sus4 V7', 'Imaj7', 'vi7', 'IVmaj7 V7', 'Imaj7'],
      parts: {
        mel: "3 - 4 5 - - 1' - | 6 - - 5 - - 3 - | 4 - 5 6 - - 1' - | 5 - - - - - . . | 3 - 4 5 - - 3' - | 3' - 2' 1' - - 6 - | 6 - 4 2 - - 7, - | 1 - - - - - . .",
        ep: { comp: 'x - - x - - . .' },
        bass: { bass: 'r - 5 -' },
        dr: { drum: { brush: 'x...o.x.x...o.x.', swish: '....x.......x...' } },
      },
    },
    B: {
      bars: 8, chords: ['ii7', 'V7', 'iii7', 'vi7', 'ii7', 'V7', 'Imaj7', 'Imaj7'],
      parts: {
        mel: "2' - - 1' 7 - 6 - | 7 - - 5 - - 2 - | 3 - 5 7 - - 5 - | 6 - - 5 - - 3 - | 4 - - 6 1' - 4' - | 2' - 1' 7 - - 5 - | 3 - - 4 5 - - - | 1 - - - - - . .",
        ep: { comp: 'x - - - x - - -' },
        bass: { bass: 'r 3 5 a' },
        dr: { drum: { brush: 'x...o.x.x...o.x.', swish: '....x.......x...', kick: 'o.......o.......' } },
      },
    },
    A2: {
      extends: 'A',
      parts: {
        box: "5 - - - - - - - | 3 - - - - - - - | 1' - - - - - - - | 7 - - - - - - - | 5 - - - - - - - | 6 - - - - - - - | 1' - - - 7 - - - | 1' - - - - - - -",
        bass: { bass: 'r 3 5 a' },
      },
    },
  },
  form: ['A', 'B', 'A2'], loopTo: 0,
};

// ---- podium: the leitmotif as a paper-brass march -----------------------------------------------------
const leit4 = "3 - 4 5 - - 1' - | 6 - - 5 - - 3 - | 4 - 5 6 - - 1' - | 5 - - - - - . . | 3 - 4 5 - - 3' - | 3' - 2' 1' - - 6 - | 6 - 4 2 - - 7, - | 1 - - - - - . .";
const march = { snare: 'X.xxX.x.X.xxX.x.', kick: 'X.......X.......' };
const podium = {
  trim: -4.3, tempo: 112, beats: 4, steps: 4, key: 70, scale: 'major',
  lanes: {
    brass: { inst: 'brass', oct: -1, gain: 0.5, pan: 0.05, rev: 0.35 },
    horns: { inst: 'brass', lo: -10, hi: 3, n: 3, gain: 0.28, pan: -0.25, rev: 0.4 },
    bells: { inst: 'bell', oct: 1, gain: 0.3, pan: 0.3, rev: 0.5 },
    str: { inst: 'pad', lo: -8, hi: 8, n: 4, gain: 0.3, rev: 0.6 },
    bass: { inst: 'bass', lo: -29, gain: 0.6, rev: 0.1 },
    dr: { inst: 'kit', gain: 0.62, rev: 0.25, vj: 0.2 },
  },
  sections: {
    intro: {
      bars: 2, chords: ['I', 'V I'], fill: false,
      parts: {
        brass: "1 - 1 1 3 - - - | 5 - 5 5 1' - - -",
        horns: { comp: 'X . . . X - - - | X . . . X - - -' },
        dr: { drum: { snare: 'x.x.x.x.xxxxXXXX', crash: '................|X...............', kick: 'X.......X.......' } },
      },
    },
    A: {
      bars: 8, chords: ['I', 'vi', 'IV', 'V', 'I', 'vi', 'IV V', 'I'],
      parts: {
        brass: leit4,
        horns: { comp: 'x . . x x . . .' },
        bass: { bass: 'r . 5, . r . 5, .' },
        str: { chord: true, v: 0.5 },
        dr: { drum: { ...march, crash: once('X...............', 8) }, fill: { snare: 'X.xxX.xxXxXxXXXX' } },
      },
    },
    B: {
      bars: 8, chords: ['vi', 'iii', 'IV', 'I', 'ii', 'V', 'iii vi', 'V7'],
      parts: {
        brass: "6 - - - - - 5 6 | 7 - - - - - 6 5 | 4 - - - 6 - 1' 4' | 3' - - - - - . . | 2' - - 1' 7 - 6 - | 7 - - 5 - - 2 - | 3 - 5 - 6 - 1' - | 5 - 4 - 2 - 7, -",
        horns: { comp: 'x . . . x . . .' },
        bells: "3 - - - - - - - | 3 - - - - - - - | 4 - - - - - - - | 3 - - - - - - - | 2 - - - - - - - | 2 - - - - - - - | 3 - - - 1 - - - | 7, - - - - - - -",
        bass: { bass: 'r . 5, . r . 5, .' },
        str: { chord: true, v: 0.5 },
        dr: { drum: march, fill: { snare: 'X.xxX.xxXxXxXXXX' } },
      },
    },
    A2: {
      extends: 'A',
      parts: { bells: leit4 },
    },
  },
  form: ['intro', 'A', 'B', 'A2'], loopTo: 1,
};

// ---- finish stingers (played once) --------------------------------------------------------------------
const fanfareLanes = {
  brass: { inst: 'brass', gain: 0.55, rev: 0.35 },
  horns: { inst: 'brass', lo: -10, hi: 5, n: 3, gain: 0.32, pan: -0.25, rev: 0.4 },
  bells: { inst: 'bell', oct: 1, gain: 0.35, pan: 0.3, rev: 0.5 },
  bass: { inst: 'bass', lo: -29, gain: 0.6, rev: 0.1 },
  dr: { inst: 'kit', gain: 0.7, rev: 0.3 },
};
const finishWin = {
  trim: -4.2, tempo: 124, beats: 4, steps: 4, key: 70, scale: 'major', once: true,
  lanes: fanfareLanes,
  sections: {
    f: {
      bars: 3, chords: ['I', 'IV V', 'I'], fill: false,
      parts: {
        brass: "5, - 1 - 3 - 5 - | 6 - 4 - 5 - 7, - | 1' - - - - - - -",
        horns: { comp: 'X . . . . . . . | x . . . X . . . | X - - - - - - -' },
        bells: "1 3 5 1' 3' - - - | . . . . . . . . | 1 3 5 1' 3' - - -",
        bass: { bass: 'r - - - - - - - | r - - - r - - - | r - - - - - - -' },
        dr: { drum: { snare: 'x.x.x.x.xxxxXXXX|X...x...xxxxXXXX|X...............', kick: 'X.......X.......|X.......X.......|X...............', crash: '................|................|X...............' } },
      },
    },
  },
  form: ['f'],
};
const finishGood = {
  trim: -2.5, tempo: 124, beats: 4, steps: 4, key: 70, scale: 'major', once: true,
  lanes: fanfareLanes,
  sections: {
    f: {
      bars: 2, chords: ['V', 'I'], fill: false,
      parts: {
        brass: "5, - 1 - 3 - 5 - | 1' - - - - - - -",
        horns: { comp: '. . . . . . . . | X - - - - - - -' },
        bells: ". . . . . . . . | 1 3 5 1' - - - -",
        bass: { bass: 'r - - - - - - - | r - - - - - - -' },
        dr: { drum: { snare: 'x.x.x.x.xxxxXXXX|X...............', crash: '................|x...............' } },
      },
    },
  },
  form: ['f'],
};
const finishOk = {
  trim: 6, tempo: 100, beats: 4, steps: 4, key: 65, scale: 'major', once: true,
  lanes: {
    mel: { inst: 'harp', oct: 1, gain: 0.6, rev: 0.45 },
    box: { inst: 'musicbox', oct: 1, gain: 0.4, pan: 0.3, rev: 0.5 },
    pad: { inst: 'pad', lo: -8, hi: 8, n: 4, gain: 0.3, rev: 0.6 },
  },
  sections: {
    f: {
      bars: 2, chords: ['IV V', 'I'], fill: false,
      parts: {
        mel: "4 - 3 - 2 - 7, - | 1 - - - - - - -",
        box: ". . . . . . . . | 3 5 1' - - - - -",
        pad: { chord: true, v: 0.5 },
      },
    },
  },
  form: ['f'],
};

export const THEMES = { title, meadow, bosphorus, glacier, desk, results, podium };
// Chapter id (ARCHITECTURE.md §1) → race theme. Other track ids fall back to genericTheme(def.music).
export const CHAPTERS = { meadow, bosphorus, glacier, desk };
export const STINGERS = { finishWin, finishGood, finishOk };

// Fallback for a chapter without an authored theme: built from its def.music.
const cache = new Map();
export function genericTheme(music = {}) {
  const scale = SCALES[music.scale] ? music.scale : 'major';
  const tempo = Math.min(180, Math.max(80, +music.tempo || 126));
  const key = `${scale}:${tempo}`;
  if (cache.has(key)) return cache.get(key);
  const minor = SCALES[scale][2] === 3;
  const prog = minor ? ['i', 'VI', 'III', 'VII'] : ['I', 'V', 'vi', 'IV'];
  const th = {
    tempo, beats: 4, steps: 4, key: 62, scale,
    lanes: {
      lead: { inst: 'pluck', oct: 1, gain: 0.5, pan: 0.1, rev: 0.3 },
      arp: { inst: 'glass', lo: 0, gain: 0.3, pan: -0.25, rev: 0.4 },
      bass: { inst: 'bass', lo: -26, gain: 0.6 },
      pad: { inst: 'pad', lo: -5, hi: 12, n: 4, gain: 0.3, rev: 0.6 },
      dr: { inst: 'kit', gain: 0.6, rev: 0.15 },
    },
    sections: {
      intro: { bars: 2, chords: prog, parts: { pad: { chord: true } } },
      A: {
        bars: 8, chords: prog,
        parts: {
          lead: "5 - 3 - 1 - 2 3 | 3 - - - 5 - - - | 5 - 6 5 3 - 2 - | 1 - - - . . . .",
          arp: { arp: '1 2 3 4 3 2 3 4' },
          bass: { bass: 'r . r 5, r . 8, .' },
          pad: { chord: true, v: 0.5 },
          dr: { drum: { kick: 'X.......X.......', hat: 'x.o.x.o.x.o.x.o.', snare: '....x.......x...' } },
        },
      },
      B: {
        extends: 'A',
        parts: { lead: "1' - 7 - 5 - 3 - | 4 - - - 3 - 2 - | 3 - 5 - 1' - 7 - | 5 - - - - - . .", arp: { arp: '1 3 5 3 2 4 6 4' } },
      },
    },
    form: ['A', 'B'], loopTo: 0, intro: 'intro', finalLap: {},
  };
  cache.set(key, th);
  return th;
}
