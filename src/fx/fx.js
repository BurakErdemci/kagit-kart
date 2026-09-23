// Race FX (ARCHITECTURE.md §10.6), all cut and folded paper: tier-coloured drift sparks, layered
// boost flames, slipstream ink streaks, offroad snippets, hop/landing puffs, hit stars, graphite wall
// sparks, boost speed lines, finish confetti and the respawn crane.
// Draw calls: bits 1 + cards 1 + speed lines 1 + crane 2 (+2 shadow) — and 0 for any part with nothing
// to show. Event handlers only queue; bursts spawn in update(), where kart visuals are current.
import * as THREE from 'three';
import { forwardOf, rightOf, smoothstep } from '../core/math.js';
import { createBits, GROW, MODE, SHAPE } from './bits.js';
import { createCards, CARD } from './cards.js';
import { createSpeedLines } from './speedlines.js';
import { createCranes } from './crane.js';

const TIER_A = ['#f4ecd6', '#3b8ff0', '#ff8a1f', '#a24ee6'];
const TIER_B = ['#ffffff', '#b4d6ff', '#ffd3a0', '#dcb6ff'];
const FLAME = { orange: '#f45d25', rocket: '#e3342f', draft: '#bfe3f7', mid: '#ffd23f', inner: '#fff5da' };
// Designed flicker: silhouette order and length wobble from fixed cycles, never re-rolled.
const PERM = [0, 2, 1, 3, 2, 0, 3, 1];
const WOBBLE = [1.0, 0.9, 1.06, 0.94, 1.02, 0.88, 1.08, 0.96];
const WHEELS = ['wheelRL', 'wheelRR'];
const SIDES = [1, -1];

const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _left = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _fh = new THREE.Vector3();
const _rh = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _buf = new THREE.Vector2();
const _pt = {};
const _col2 = new THREE.Color();

const LOCAL = {
  wheelRL: [0.8, 0.3, -0.74], wheelRR: [-0.8, 0.3, -0.74], exhaust: [0, 0.5, -1.1],
};

function linearLuminance(c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

export function createFX(game) {
  const { scene, events } = game;
  const theme = game.trackDef?.theme || game.renderer.theme;
  const rnd = game.rng.fork('fx').next; // cosmetic stream: never a simulation stream
  const R = (a, b) => a + (b - a) * rnd();

  const bits = createBits(game, { capacity: 3072 });
  const cards = createCards(game, { capacity: 96 });
  const lines = createSpeedLines();
  const cranes = createCranes(game, theme);
  scene.add(bits.mesh, cards.mesh, lines.mesh, ...cranes.meshes);

  // palette
  const C = (hex) => new THREE.Color(hex);
  const tierA = TIER_A.map(C);
  const tierB = TIER_B.map(C);
  const paper = C(theme.paper);
  const paperDark = paper.clone().multiplyScalar(0.78);
  const offroad = [C(theme.offroad).lerp(paper, 0.45), C(theme.offroad).multiplyScalar(0.7), C(theme.offroad).lerp(paper, 0.2)];
  const offroadBack = C(theme.offroad).multiplyScalar(0.55);
  const light = C(theme.roadLine || '#fbf6e9');
  const puff = light.clone().lerp(paper, 0.25);
  const road = C(theme.road || '#9aa1a8');
  const dark = linearLuminance(road) < 0.2;
  // Ink marks (streaks, the crane's string, speed lines) switch to light paper on night pages.
  const inkish = dark ? light.clone() : C(theme.ink).lerp(paper, 0.12);
  const graphite = C('#54555d');
  const sheen = C('#a3a6b1');
  const fleck = C('#fffaf0');
  const smoke = [C('#8b8680'), C('#5f5b57')];
  const stars = [C('#ffd23f'), C('#fff3d0'), C((theme.accents && theme.accents[1]) || '#e56b6f')];
  const starBack = C('#fff9e8');
  const confetti = [...(theme.accents || []), theme.curbA, '#ffd23f'].filter(Boolean).map(C);
  const flameCol = {
    orange: C(FLAME.orange), rocket: C(FLAME.rocket), draft: C(FLAME.draft), mid: C(FLAME.mid), inner: C(FLAME.inner),
  };
  const flameShadow = C(FLAME.mid).multiplyScalar(0.62);
  lines.uniforms.uColor.value.copy(inkish);
  lines.uniforms.uEdge.value.copy(dark ? C(theme.ink) : light);
  lines.uniforms.uOpacity.value = dark ? 0.55 : 0.72;

  const ks = game.karts.map(() => ({
    spark: 0, debris: 0, streak: 0, scrape: 0, flameTier: 1, boostAge: 9, side: 0, n: 0, confetti: 0, conAcc: 0,
  }));

  // ---------------------------------------------------------------------------------------------
  // events → queue (pooled records; handlers stay cheap)

  const QMAX = 64;
  const queue = Array.from({ length: QMAX }, () => ({ type: '', kart: null, a: 0, b: 0, s: '' }));
  let qn = 0;
  function push(type, kart, a = 0, b = 0, s = '') {
    if (qn >= QMAX || !kart) return;
    const r = queue[qn++];
    r.type = type; r.kart = kart; r.a = a; r.b = b; r.s = s;
  }

  const offs = [
    events.on('drift', (e) => {
      if (e.state === 'tier') push('tier', e.kart, e.tier);
      else if (e.state === 'release' && e.tier >= 1) {
        const st = ks[e.kart.index];
        if (st) st.flameTier = e.tier;
        push('release', e.kart, e.tier);
      }
    }),
    events.on('boost', (e) => { const st = ks[e.kart?.index]; if (st) st.boostAge = 0; }),
    events.on('draft', (e) => { if (e.state === 'boost') push('draftBoost', e.kart); }),
    events.on('hop', (e) => push('hop', e.kart)),
    events.on('land', (e) => push('land', e.kart, e.airTime || 0)),
    events.on('wallHit', (e) => push('wall', e.kart, e.speed || 0)),
    events.on('hit', (e) => push('hit', e.kart, 0, 0, e.cause || '')),
    events.on('respawn', (e) => { if (e.stage === 'lift') push('respawn', e.kart); }),
    events.on('finish', (e) => { if (e.kart?.isPlayer) push('finish', e.kart); }),
  ];

  // ---------------------------------------------------------------------------------------------
  // kart frame helpers

  let time = 0;
  let qMul = 1;
  const camPos = game.camera.position;

  // Sets _pos/_fwd/_left from the visual (interpolated) and _fh/_rh from the heading.
  function frameOf(k) {
    const o = k.visual?.object3d;
    if (o) {
      _pos.copy(o.position);
      _fwd.set(0, 0, 1).applyQuaternion(o.quaternion);
      _left.set(1, 0, 0).applyQuaternion(o.quaternion);
    } else {
      _pos.copy(k.pos);
      forwardOf(k.heading, _fwd);
      rightOf(k.heading, _left).negate();
    }
    forwardOf(k.heading, _fh);
    rightOf(k.heading, _rh);
  }

  function anchor(k, name, out) {
    const a = k.visual?.anchors?.[name];
    if (a) {
      a.updateWorldMatrix(true, false);
      return out.setFromMatrixPosition(a.matrixWorld);
    }
    const l = LOCAL[name] || [0, 0.5, 0];
    return out.copy(_pos).addScaledVector(_left, l[0]).addScaledVector(_up, l[1]).addScaledVector(_fwd, l[2]);
  }

  function groundOf(k) {
    if (k.grounded) return k.pos.y;
    return k.trackInfo.hasGround ? k.trackInfo.groundY : -1e4;
  }

  function baseSpec(x, y, z, k, inherit) {
    const s = bits.spec;
    s.x = x; s.y = y; s.z = z;
    s.vx = k ? k.vel.x * inherit : 0;
    s.vy = 0;
    s.vz = k ? k.vel.z * inherit : 0;
    s.delay = 0; s.flutter = 0; s.grow = GROW.POP; s.mode = MODE.TUMBLE; s.aspect = 1; s.fold = 0.6;
    return s;
  }

  // ---------------------------------------------------------------------------------------------
  // emitters

  function spark(k, wheelPos, tier, big, grow = 1) {
    const d = k.drift.dir || (k.hop.dir || 1);
    const s = baseSpec(wheelPos.x + R(-0.05, 0.05), wheelPos.y + R(0, 0.06), wheelPos.z + R(-0.05, 0.05), k, big ? 0.72 : 0.62);
    const back = big ? R(3, 7) : R(2, 5);
    const out = big ? R(-1.5, 4.5) : R(1.5, 4.2);
    const upv = big ? R(2.5, 5.5) : R(2, 4.4);
    s.vx += -_fh.x * back - _rh.x * d * out;
    s.vz += -_fh.z * back - _rh.z * d * out;
    s.vy = upv;
    s.life = big ? R(0.4, 0.62) : R(0.24, 0.4);
    s.drag = 3; s.grav = 14; s.floor = groundOf(k) + 0.02;
    s.shape = SHAPE.TRI;
    s.size = tier > 0 ? R(0.06, 0.1) + tier * 0.01 : R(0.045, 0.07);
    if (big) s.size *= 1.35 * grow;
    s.spin = R(14, 26); s.fold = R(0.5, 1.2); s.aspect = 0.72;
    s.colA.copy(tierA[tier]); s.colB.copy(tierB[tier]);
    s.glow = tier > 0 ? 0.6 : 0.25;
    bits.emit(s);
  }

  // Tier-up: a cut-paper spark burst in the tier colour at a rear wheel (a pale core over the coloured
  // zap over its hard offset shadow) with paper rays thrown out around it. The burst rides along with
  // the kart for its short life so it stays at the wheel.
  function tierBurst(k, w, tier, side) {
    const cam = game.camera.matrixWorld.elements;
    const x = w.x + _left.x * side * 0.12, y = w.y + 0.3, z = w.z + _left.z * side * 0.12;
    const size = 0.34 + 0.06 * tier;
    const seed = (time * 7.31 + k.index * 0.37 + (side > 0 ? 0 : 0.5)) % 1;
    _col2.copy(tierA[tier]).multiplyScalar(0.35);
    for (let i = 0; i < 3; i++) {
      const sz = i === 2 ? size * 0.5 : size;
      // layer 0 is the hard shadow, down-right of the zap in screen space
      const off = i === 0 ? 0.1 * sz : 0;
      const col = i === 0 ? _col2 : i === 1 ? tierA[tier] : tierB[tier];
      const s = baseSpec(x + (cam[0] - cam[4]) * off, y + (cam[1] - cam[5]) * off, z + (cam[2] - cam[6]) * off, k, 1);
      s.vy = k.vy || 0;
      s.life = i === 2 ? 0.22 : 0.27; s.drag = 0; s.grav = 0; s.floor = -1e4;
      s.shape = SHAPE.ZAP; s.mode = MODE.SPIN; s.spin = side * (i === 2 ? -3 : 2.5);
      s.size = sz; s.aspect = 1; s.fold = 0;
      s.colA.copy(col); s.colB.copy(col); s.glow = i === 0 ? 0.6 : i === 1 ? 0.85 : 1;
      s.seed = seed;
      bits.emit(s);
    }
    const n = Math.round(9 * Math.max(qMul, 0.75));
    for (let i = 0; i < n; i++) {
      // rays fan over the upper half, outward on this wheel's side
      const a = (-0.25 + (i / (n - 1)) * 1.5) * Math.PI;
      const sp = R(6.5, 9);
      const out = Math.cos(a) * sp * side, up = Math.sin(a) * sp;
      const s = baseSpec(x, y, z, k, 0.92);
      s.vx += _left.x * out - _fh.x * R(0.5, 2);
      s.vz += _left.z * out - _fh.z * R(0.5, 2);
      s.vy = up + (k.vy || 0);
      s.life = R(0.22, 0.3); s.drag = 5; s.grav = 5; s.floor = groundOf(k) + 0.02;
      s.shape = SHAPE.SLIVER; s.mode = MODE.STREAK; s.spin = 0;
      s.size = R(0.24, 0.32) + tier * 0.03; s.aspect = 0.2; s.fold = 0;
      s.colA.copy(tierA[tier]); s.colB.copy(tierA[tier]); s.glow = 0.75;
      bits.emit(s);
    }
  }

  // A rooster tail from each rear wheel, thrown outward on its own side (+1 left wheel, -1 right).
  // Most pieces keep 70% of the kart's speed so the tail trails just behind the kart instead of
  // streaming past the camera.
  function debris(k, wheelPos, side, sandy) {
    const s = baseSpec(wheelPos.x + R(-0.1, 0.1), wheelPos.y, wheelPos.z + R(-0.1, 0.1), k, 0.7);
    const st = ks[k.index];
    st.n++;
    const back = R(0.8, 2.8), lat = side * R(0.3, 2.4);
    s.vx += -_fh.x * back - _rh.x * lat;
    s.vz += -_fh.z * back - _rh.z * lat;
    s.vy = R(3, 5.8);
    s.life = R(0.6, 0.95); s.drag = 1.6; s.grav = 15; s.floor = groundOf(k) + 0.02;
    s.mode = MODE.TUMBLE; s.spin = R(8, 16);
    if (st.n % 7 === 0) {
      // a larger folded scrap that lands and lies on the ground for a moment
      s.vy = R(2.2, 3.4); s.life = R(1.3, 1.7); s.drag = 1.1;
      s.shape = SHAPE.RECT; s.size = R(0.16, 0.24); s.aspect = R(0.55, 0.8); s.fold = R(0.6, 1.1);
      s.colA.copy(st.n % 2 ? paper : offroad[0]); s.colB.copy(st.n % 2 ? paperDark : offroadBack); s.glow = dark ? 0.35 : 0.3;
    } else if (!sandy && st.n % 5 < 3) {
      s.shape = SHAPE.SLIVER; s.size = R(0.13, 0.2); s.aspect = R(0.24, 0.34); s.fold = R(0.3, 0.8);
      s.colA.copy(offroad[st.n % 3]); s.colB.copy(offroadBack); s.glow = dark ? 0.35 : 0.3;
    } else {
      s.shape = st.n % 2 ? SHAPE.RECT : SHAPE.TRI; s.size = R(0.07, 0.11); s.aspect = R(0.5, 1); s.fold = R(0.2, 0.9);
      s.colA.copy(paper); s.colB.copy(paperDark); s.glow = dark ? 0.35 : 0.3;
    }
    bits.emit(s);
  }

  function streak(k, big) {
    const st = ks[k.index];
    st.side = (st.side + 1) % 4;
    const side = st.side % 2 ? 1 : -1;
    const ahead = R(-0.5, 3), lat = side * R(0.95, 1.7), h = R(0.25, 1.5);
    const s = baseSpec(
      _pos.x + _fh.x * ahead + _rh.x * lat, _pos.y + h, _pos.z + _fh.z * ahead + _rh.z * lat, k, 0.3,
    );
    s.vy = R(-0.2, 0.3);
    s.life = big ? R(0.32, 0.45) : R(0.22, 0.32);
    s.drag = 0.5; s.grav = 0; s.floor = -1e4;
    s.shape = SHAPE.STROKE; s.mode = MODE.STREAK;
    s.size = big ? R(1.2, 1.6) : R(0.7, 1.1);
    s.aspect = R(0.035, 0.05); s.spin = 0; s.fold = 0;
    s.colA.copy(inkish); s.colB.copy(inkish); s.glow = 1;
    bits.emit(s);
  }

  function scrape(k, burst) {
    const side = Math.sign(k.trackInfo.lateral) || 1;
    const nx = k.trackInfo.right.x * side, nz = k.trackInfo.right.z * side;
    const along = R(-0.6, 0.8);
    const s = baseSpec(
      _pos.x + nx * 0.95 + _fh.x * along, _pos.y + R(0.2, 0.6), _pos.z + nz * 0.95 + _fh.z * along, k, burst ? 0.3 : 0.4,
    );
    const away = burst ? R(2, 6) : R(0.5, 2.5), back = R(0, 2.5);
    s.vx += -nx * away - _fh.x * back;
    s.vz += -nz * away - _fh.z * back;
    s.vy = burst ? R(2.5, 6) : R(1.2, 3.2);
    s.life = R(0.22, 0.4); s.drag = 3; s.grav = 16; s.floor = groundOf(k) + 0.02;
    s.spin = R(16, 30);
    const st = ks[k.index];
    st.n++;
    if (st.n % 10 < (burst ? 5 : 7)) {
      // pencil-lead streaks, drawn along their flight
      s.shape = SHAPE.SLIVER; s.mode = MODE.STREAK; s.size = burst ? R(0.18, 0.28) : R(0.12, 0.2); s.aspect = 0.11; s.fold = 0;
      s.colA.copy(graphite); s.colB.copy(graphite); s.glow = 0.35;
    } else {
      s.shape = SHAPE.TRI; s.mode = MODE.TUMBLE; s.size = burst ? R(0.07, 0.1) : R(0.05, 0.08); s.fold = 0.9;
      s.colA.copy(fleck); s.colB.copy(sheen); s.glow = 0.85;
    }
    bits.emit(s);
  }

  function puffAt(k, x, y, z, vx, vz, vy, size, life, col) {
    const s = baseSpec(x, y, z, k, 0.4);
    s.vx += vx; s.vz += vz; s.vy = vy;
    s.life = life; s.drag = 4.5; s.grav = -0.5; s.floor = -1e4;
    s.shape = SHAPE.PUFF; s.mode = MODE.SPIN; s.spin = R(-2, 2); s.size = size; s.aspect = 1; s.fold = 0;
    s.colA.copy(col); s.colB.copy(col); s.glow = 0.55; s.grow = GROW.PUFF;
    bits.emit(s);
  }

  function hopDust(k) {
    const col = k.surface === 'offroad' || k.surface === 'out' ? offroad[2] : puff;
    for (const w of WHEELS) {
      anchor(k, w, _a);
      const out = w === 'wheelRL' ? 1 : -1;
      for (let i = 0; i < 2; i++) {
        puffAt(k, _a.x, _a.y + 0.05, _a.z,
          -_fh.x * R(0.5, 1.5) + _left.x * out * R(0.3, 1), -_fh.z * R(0.5, 1.5) + _left.z * out * R(0.3, 1),
          R(0.3, 0.8), R(0.16, 0.24), R(0.32, 0.45), col);
      }
    }
  }

  function landPuff(k, air) {
    if (air < 0.22) return;
    const a = Math.min(air, 1.5);
    // a drift hop (~0.36 s) only scuffs; real drops get a ring that grows with the fall
    const n = air < 0.45 ? 2 : Math.max(4, Math.min(12, Math.round((3 + air * 6) * qMul)));
    const col = k.surface === 'offroad' || k.surface === 'out' ? offroad[2] : puff;
    const y = k.pos.y + 0.12;
    const off = (k.index * 0.37) % 1;
    for (let i = 0; i < n; i++) {
      const ang = ((i + off) / n) * Math.PI * 2;
      const dx = Math.cos(ang), dz = Math.sin(ang);
      const sp = R(1.6, 2.6 + a * 2);
      puffAt(k, _pos.x + dx * 0.9, y, _pos.z + dz * 0.9, dx * sp, dz * sp, R(0.3, 0.9),
        R(0.2, 0.28) * (1 + a * 0.35), 0.45 + 0.15 * a, col);
    }
  }

  function hitBurst(k, cause) {
    if (cause === 'burnout') {
      anchor(k, 'exhaust', _a);
      for (let i = 0; i < 5; i++) {
        const s = baseSpec(_a.x + R(-0.15, 0.15), _a.y + R(0, 0.2), _a.z + R(-0.15, 0.15), k, 0);
        s.vx = -_fh.x * R(0.4, 1.2); s.vz = -_fh.z * R(0.4, 1.2); s.vy = R(0.6, 1.4);
        s.life = R(0.8, 1.1); s.drag = 2.5; s.grav = -2.2; s.floor = -1e4;
        s.shape = SHAPE.PUFF; s.mode = MODE.SPIN; s.spin = R(-1.5, 1.5); s.size = R(0.25, 0.4); s.fold = 0;
        s.colA.copy(smoke[i % 2]); s.colB.copy(smoke[i % 2]); s.glow = 0.2; s.grow = GROW.PUFF;
        bits.emit(s);
      }
      return;
    }
    const n = 7;
    const off = (k.index * 0.23) % 1;
    for (let i = 0; i < n; i++) {
      const ang = ((i + off) / n) * Math.PI * 2 + R(-0.2, 0.2);
      const dx = Math.cos(ang), dz = Math.sin(ang);
      const s = baseSpec(_pos.x + dx * 0.3, _pos.y + 1.3, _pos.z + dz * 0.3, k, 0.5);
      const sp = R(2.4, 3.6);
      s.vx += dx * sp; s.vz += dz * sp; s.vy = R(2.5, 4.2);
      s.life = R(0.8, 1.05); s.drag = 2.2; s.grav = 7; s.floor = groundOf(k) + 0.02;
      s.shape = SHAPE.STAR; s.mode = MODE.FLIP; s.spin = R(9, 15) * (i % 2 ? 1 : -1);
      s.size = R(0.26, 0.34); s.fold = 0.4; s.aspect = 1;
      s.colA.copy(stars[i % stars.length]); s.colB.copy(starBack); s.glow = 0.55;
      bits.emit(s);
    }
    for (let i = 0; i < 5; i++) {
      const s = baseSpec(_pos.x, _pos.y + 1.1, _pos.z, k, 0.5);
      s.vx += R(-2, 2); s.vz += R(-2, 2); s.vy = R(2, 4);
      s.life = R(0.7, 1); s.drag = 2.5; s.grav = 8; s.floor = groundOf(k) + 0.02;
      s.shape = SHAPE.RECT; s.size = R(0.05, 0.08); s.aspect = 0.6; s.fold = R(0.3, 0.8); s.spin = R(8, 14);
      s.colA.copy(confetti[(i + k.index) % confetti.length]); s.colB.copy(s.colA).lerp(fleck, 0.5); s.glow = 0.2;
      bits.emit(s);
    }
  }

  function confettiPiece(k, i, x, y, z, vx, vy, vz, life) {
    const s = baseSpec(x, y, z, null, 0);
    s.vx = vx; s.vy = vy; s.vz = vz;
    s.life = life; s.drag = 1.3; s.grav = 4.5; s.flutter = R(0.2, 0.45);
    s.floor = k.grounded || !k.trackInfo.hasGround ? k.pos.y + 0.02 : k.trackInfo.groundY + 0.02;
    const pick = i % 20;
    s.shape = pick < 14 ? SHAPE.RECT : pick < 17 ? SHAPE.TRI : SHAPE.STAR;
    s.size = s.shape === SHAPE.STAR ? R(0.14, 0.2) : R(0.1, 0.17);
    s.aspect = s.shape === SHAPE.RECT ? R(0.45, 0.7) : 1;
    s.fold = R(0.3, 0.9); s.spin = R(5, 11);
    s.colA.copy(confetti[i % confetti.length]); s.colB.copy(s.colA).lerp(fleck, 0.45); s.glow = 0.3;
    bits.emit(s);
  }

  // Finish: two party poppers fire from beside the kart, then a shower keeps falling ahead of it
  // (see showers in update) so the kart drives through confetti for a few seconds.
  function finishConfetti(k) {
    const per = Math.round(28 * qMul);
    for (const side of SIDES) {
      const ox = _pos.x - _rh.x * side * 2.2, oz = _pos.z - _rh.z * side * 2.2;
      for (let i = 0; i < per; i++) {
        const inward = R(0.5, 3);
        confettiPiece(k, i + (side > 0 ? 0 : 7), ox, _pos.y + 0.6, oz,
          k.vel.x * 0.9 + _rh.x * side * inward + R(-0.8, 0.8), R(6, 10.5), k.vel.z * 0.9 + _rh.z * side * inward + R(-0.8, 0.8),
          R(2.2, 3.2));
      }
    }
    ks[k.index].confetti = 2.6;
  }

  function confettiShower(k, st, dt) {
    st.confetti -= dt;
    st.conAcc += 90 * qMul * dt;
    let n = Math.min(8, Math.floor(st.conAcc));
    st.conAcc -= Math.floor(st.conAcc);
    // centred on the road ahead (not the straight-line heading) so the kart drives through it
    const track = game.track;
    track.sampleAt((((k.trackInfo.dist + Math.max(0, k.speed) * 0.35) / track.length) % 1 + 1) % 1, _pt);
    const cx = _pt.pos.x + _pt.right.x * k.trackInfo.lateral * 0.5, cz = _pt.pos.z + _pt.right.z * k.trackInfo.lateral * 0.5;
    for (; n > 0; n--) {
      const r = Math.sqrt(rnd()) * 5, ang = rnd() * Math.PI * 2;
      st.n++;
      confettiPiece(k, st.n, cx + Math.cos(ang) * r, _pt.pos.y + R(2.6, 5.2), cz + Math.sin(ang) * r,
        k.vel.x * 0.8 + R(-1, 1), R(0, 1.5), k.vel.z * 0.8 + R(-1, 1), R(2.4, 3.4));
    }
  }

  // ---------------------------------------------------------------------------------------------
  // queued bursts

  function processQueue() {
    for (let i = 0; i < qn; i++) {
      const r = queue[i];
      const k = r.kart;
      r.kart = null;
      if (!k.visual && r.type !== 'respawn') continue;
      frameOf(k);
      switch (r.type) {
        case 'tier': {
          const tier = Math.max(1, Math.min(3, r.a | 0));
          const n = Math.round((14 + tier * 2) * Math.max(qMul, 0.75));
          anchor(k, 'wheelRL', _a); anchor(k, 'wheelRR', _b);
          for (let j = 0; j < n; j++) spark(k, j % 2 ? _a : _b, tier, true, 1.3);
          tierBurst(k, _a, tier, 1);
          tierBurst(k, _b, tier, -1);
          k.visual?.flash?.(TIER_A[tier], 0.08);
          break;
        }
        case 'release': {
          const tier = Math.max(1, Math.min(3, r.a | 0));
          anchor(k, 'exhaust', _a);
          for (let j = 0; j < 8 + tier * 2; j++) spark(k, _a, tier, true);
          break;
        }
        case 'draftBoost': for (let j = 0; j < 14; j++) streak(k, true); break;
        case 'hop': hopDust(k); break;
        case 'land': landPuff(k, r.a); break;
        case 'wall': {
          const n = Math.min(28, Math.round((12 + r.a * 0.6) * qMul));
          for (let j = 0; j < n; j++) scrape(k, true);
          break;
        }
        case 'hit': hitBurst(k, r.s); break;
        case 'respawn': cranes.summon(k, false, k.isPlayer); break;
        case 'finish': finishConfetti(k); break;
        default: break;
      }
    }
    qn = 0;
  }

  // ---------------------------------------------------------------------------------------------
  // flames

  function flames(k, st) {
    if (k.boostTime <= 0) return;
    const src = k.boostSource;
    const strength = Math.max(0.5, k.boostStrength || 1);
    let outer = flameCol.orange;
    if (src === 'drift') outer = tierA[st.flameTier] || flameCol.orange;
    else if (src === 'item') outer = flameCol.rocket;
    else if (src === 'draft') outer = flameCol.draft;
    const kick = 1 + 0.45 * Math.exp(-st.boostAge * 14);
    const env = smoothstep(0, 0.05, st.boostAge) * smoothstep(0, 0.18, k.boostTime);
    if (env <= 0.01) return;
    const hz = game.reducedMotion ? 7 : 14;
    const cyc = Math.floor(time * hz + k.index * 0.37);
    const wob = WOBBLE[(cyc * 5 + k.index) & 7];
    const L = (0.75 + 0.55 * strength) * kick * env * wob;
    const W = (0.26 + 0.1 * strength) * (0.85 + 0.15 * kick) * env;
    anchor(k, 'exhaust', _a);
    _b.subVectors(camPos, _a).normalize();
    // From the chase camera a flame pointing straight back is seen end-on and collapses to a dot, so
    // the tongues tilt up (to ~55°) the more the camera looks down the exhaust; from the side they
    // stay near-horizontal.
    const behind = smoothstep(0.45, 0.95, -_fwd.dot(_b));
    _c.copy(_fwd).multiplyScalar(-1).addScaledVector(_up, 0.2 + 1.25 * behind).normalize();
    const off = 2.5 * Math.max(1, _buf.y / 720);
    _col2.copy(outer).multiplyScalar(0.55);
    // End-on rosette at the nozzle, under the tongues; larger for a drift boost, whose tier colour
    // must read at a glance.
    const facing = smoothstep(0.3, 0.85, -_fwd.dot(_b));
    if (facing > 0.02) {
      const rad = W * (src === 'drift' ? 1.6 : 1.1) * facing * (0.85 + 0.15 * kick) * wob;
      _a.addScaledVector(_fwd, -0.12);
      burstLayer(0, rad, outer, 1, null, cyc, k.index, off);
      burstLayer(1, rad * 0.68, flameCol.mid, 0, _col2, cyc, k.index, off);
      burstLayer(2, rad * 0.4, flameCol.inner, 0, flameShadow, cyc, k.index, off);
      _a.addScaledVector(_fwd, 0.12);
    }
    _a.addScaledVector(_c, 0.05);
    flameLayer(0, 1, W, outer, 1, null, cyc, k.index, L, off);
    flameLayer(1, 0.8, W * 0.72, flameCol.mid, 0, _col2, cyc, k.index, L, off);
    flameLayer(2, 0.56, W * 0.45, flameCol.inner, 0, flameShadow, cyc, k.index, L, off);
  }

  function burstLayer(li, rad, col, outline, shadow, cyc, idx, off) {
    const variant = PERM[(cyc + li * 5 + idx + 1) & 7];
    if (shadow) cards.add(_a.x, _a.y, _a.z, _a.x, _a.y, _a.z, rad, CARD.BURST, shadow, 1, variant, 0, 0.8, off);
    cards.add(_a.x, _a.y, _a.z, _a.x, _a.y, _a.z, rad, CARD.BURST, col, 1, variant, outline, 1, 0);
  }

  // One cut-paper layer from _a along _c; `shadow` (the colour of the layer beneath, darkened) adds
  // the layer's hard offset shadow first.
  function flameLayer(li, lf, w, col, outline, shadow, cyc, idx, L, off) {
    const variant = PERM[(cyc + li * 3 + idx) & 7];
    _b.copy(_a).addScaledVector(_c, L * lf);
    if (shadow) cards.add(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, w, CARD.FLAME, shadow, 1, variant, 0, 0.8, off);
    cards.add(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, w, CARD.FLAME, col, 1, variant, outline, 1, 0);
  }

  // ---------------------------------------------------------------------------------------------
  // per frame

  const PLAY = new Set(['countdown', 'race', 'finishing']);

  function update(frameDt) {
    const dt = frameDt > 0 ? Math.min(frameDt, 0.1) : 0;
    time += dt;
    bits.setTime(time);
    const q = game.quality;
    qMul = q === 'low' ? 0.5 : q === 'medium' ? 0.75 : 1;

    const r = game.renderer;
    bits.uniforms.uSunDir.value.subVectors(r.sun.position, r.sun.target.position).normalize();
    bits.uniforms.uSunCol.value.copy(r.sun.color).multiplyScalar(r.sun.intensity);
    bits.uniforms.uAmb.value.copy(r.ambient.color).multiplyScalar(r.ambient.intensity);
    r.getDrawingBufferSize(_buf);
    cards.setResolution(_buf.x, _buf.y);

    processQueue();
    cards.begin();

    const K = game.config.kart;
    for (const k of game.karts) {
      const st = ks[k.index];
      if (!st || !k.visual) continue;
      if (dt > 0) st.boostAge += dt;
      const d2 = camPos.distanceToSquared(k.pos);
      const near = k.isPlayer || d2 < 90 * 90;
      frameOf(k);

      // respawn crane: summon early when a respawn is imminent (out of bounds, falling off the page)
      if (!k.respawn.active && !cranes.has(k) && (k.isPlayer || d2 < 150 * 150)) {
        const outSoon = k.surface === 'out' && k.grounded && k.outTime > K.outRespawn - 0.65;
        const falling = !k.grounded && !k.trackInfo.hasGround && k.vy < -1.5 && k.pos.y < k.trackInfo.groundY - 0.15;
        if (outSoon || falling) cranes.summon(k, true, k.isPlayer);
      }

      if (d2 < 150 * 150) flames(k, st);
      if (st.confetti > 0 && dt > 0) confettiShower(k, st, dt);
      if (dt <= 0 || !near || k.respawn.active) continue;
      const lod = (k.isPlayer || d2 < 45 * 45 ? 1 : 0.5) * qMul;

      // drift sparks
      if (k.drift.active && k.grounded) {
        const tier = k.drift.tier;
        const rate = tier === 0 ? 10 : tier === 1 ? 64 : tier === 2 ? 80 : 96;
        st.spark += rate * dt * lod;
        let n = Math.min(8, Math.floor(st.spark));
        st.spark -= Math.floor(st.spark);
        if (n > 0) {
          anchor(k, 'wheelRL', _a); anchor(k, 'wheelRR', _b);
          for (; n > 0; n--) spark(k, n % 2 ? _a : _b, tier, false);
        }
      } else st.spark = 0;

      // offroad snippets
      const surf = k.surface;
      if (k.grounded && (surf === 'offroad' || surf === 'out' || surf === 'sand') && Math.abs(k.speed) > 4) {
        st.debris += 110 * Math.max(0.6, Math.min(1, Math.abs(k.speed) / (k.topSpeed || 25))) * dt * lod;
        let n = Math.min(6, Math.floor(st.debris));
        st.debris -= Math.floor(st.debris);
        if (n > 0) {
          anchor(k, 'wheelRL', _a); anchor(k, 'wheelRR', _b);
          for (; n > 0; n--) debris(k, n % 2 ? _a : _b, n % 2 ? 1 : -1, surf === 'sand');
        }
      } else st.debris = 0;

      // slipstream ink streaks
      if (k.draft.charge > 0 && k.speed > 8 && (k.isPlayer || d2 < 45 * 45)) {
        st.streak += (20 + 70 * k.draft.charge) * dt * lod;
        let n = Math.min(6, Math.floor(st.streak));
        st.streak -= Math.floor(st.streak);
        for (; n > 0; n--) streak(k, false);
      } else st.streak = 0;

      // wall scrape graphite
      if (k.wallContact && k.grounded && Math.abs(k.speed) > 4 && d2 < 60 * 60) {
        st.scrape += 55 * Math.min(1.2, Math.max(0.3, Math.abs(k.speed) / 20)) * dt * lod;
        let n = Math.min(6, Math.floor(st.scrape));
        st.scrape -= Math.floor(st.scrape);
        for (; n > 0; n--) scrape(k, false);
      } else st.scrape = 0;
    }

    cranes.update(dt, cards, inkish);
    cards.end();
    bits.flush();

    // speed lines: the player's boost, chase camera only, never with reduced motion. Leaving the chase
    // view cuts them; only the natural end of a boost fades them.
    const p = game.player;
    const rig = game.cameraRig;
    const offView = !p || game.reducedMotion || !!rig.override || !!rig.debugMode || !!rig.lookBack ||
      (rig.target && rig.target !== p) || (p.controls.lookBack && !p.autopilot);
    let target = 0;
    if (!offView && p.boostTime > 0 && PLAY.has(game.phase)) {
      target = Math.min(1, 0.55 + 0.45 * (p.boostStrength || 1)) * smoothstep(0, 0.15, p.boostTime);
    }
    lines.update(dt, target, (r.cssWidth || 16) / (r.cssHeight || 9), offView);
  }

  function debug() {
    return {
      time: +time.toFixed(3), spawned: bits.spawned, bitsAlive: bits.alive(), bitsInstances: bits.mesh.geometry.instanceCount,
      cards: cards.count, cranes: cranes.debug(), speedLines: +lines.intensity.toFixed(3),
      meshes: [bits.mesh, cards.mesh, lines.mesh, ...cranes.meshes].map((m) => m.name),
    };
  }

  function dispose() {
    for (const off of offs) off();
    offs.length = 0;
    qn = 0;
    for (const r of queue) r.kart = null;
    bits.dispose();
    cards.dispose();
    lines.dispose();
    cranes.dispose();
  }

  return { update, dispose, debug, meshes: () => [bits.mesh, cards.mesh, lines.mesh, ...cranes.meshes] };
}
