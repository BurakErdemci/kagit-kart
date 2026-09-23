// Scenery entry (ARCHITECTURE §10, §10.5): createScenery(game, def, track) → { update, dispose }.
// Builds the chapter's theme (themes/<id>.js), the pop-up field and the popup ramps. Only
// game.materials makes surfaces; every geometry and unique material made here is disposed here.
import * as THREE from 'three';
import { createPopups } from './popup.js';
import { Parts, mulberry32, hashString, mixHex, roundRectPts } from './kit.js';
import * as lettering from '../ui/lettering.js';
import * as meadow from './themes/meadow.js';
import * as bosphorus from './themes/bosphorus.js';
import * as glacier from './themes/glacier.js';
import * as desk from './themes/desk.js';

const THEMES = { meadow, bosphorus, glacier, desk };
const CELL = 24;
const SIGN_W = 20, SIGN_H = 8, SIGN_POST = 4;
const REACH = 70; // clearance search radius; farther than this from any road counts as open page

export function createScenery(game, def, track) {
  const s = track.samples;
  const N = track.sampleCount;
  const L = track.length;
  let minY = Infinity;
  for (let i = 0; i < N; i++) minY = Math.min(minY, s.py[i]);
  const pageY = track.pageY ?? minY - 0.05;

  const group = new THREE.Group();
  group.name = 'scenery';
  game.scene.add(group);
  const ownMaterials = [];
  const ownTextures = [];
  const reserved = [];      // [x, z, r] discs kept free of props
  const updaters = [];
  const rng = mulberry32(hashString(`${def.id}:scenery`));

  // Horizontal sample buckets: clearance must hold against every stretch of road, including
  // the deck overhead on a crossing (query() would pick the nearer deck in 3D).
  const buckets = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  for (let i = 0; i < N; i++) {
    const k = key(Math.floor(s.px[i] / CELL), Math.floor(s.pz[i] / CELL));
    let list = buckets.get(k);
    if (!list) buckets.set(k, list = []);
    list.push(i);
  }
  const hxOf = (i) => (s.hx ? s.hx[i] : s.rx[i]);
  const hzOf = (i) => (s.hz ? s.hz[i] : s.rz[i]);

  // Closest approach of (x, z) to any drivable band: distance past hw + offroad (negative inside).
  function bandGap(x, z, reach = REACH) {
    let best = Infinity;
    const r = Math.ceil(reach / CELL);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const list = buckets.get(key(cx + dx, cz + dz));
      if (!list) continue;
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        const d = Math.hypot(s.px[i] - x, s.pz[i] - z) - s.halfWidth[i] - s.offroad[i];
        if (d < best) best = d;
      }
    }
    return best;
  }

  function nearestIndex(x, z) {
    let best = -1, bd = Infinity;
    for (const reach of [CELL, 3 * CELL, 8 * CELL]) {
      const r = Math.ceil(reach / CELL);
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const list = buckets.get(key(cx + dx, cz + dz));
        if (!list) continue;
        for (const i of list) {
          const d = (s.px[i] - x) ** 2 + (s.pz[i] - z) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best >= 0) return best;
    }
    for (let i = 0; i < N; i += 2) {
      const d = (s.px[i] - x) ** 2 + (s.pz[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // Between two stretches of road that are far apart along the lap (hairpin infields, where
  // the rocket cuts run): keep standing props out so the cut stays readable.
  // "Between" means: a second stretch of road, far along the lap from the nearest one, lies on
  // the opposite side of the point (the two directions point away from each other).
  function inInfield(x, z) {
    const a = nearestIndex(x, z);
    if (a < 0) return false;
    const ax = s.px[a] - x, az = s.pz[a] - z;
    if (Math.hypot(ax, az) - s.halfWidth[a] > 40) return false;
    const r = Math.ceil(60 / CELL);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const list = buckets.get(key(cx + dx, cz + dz));
      if (!list) continue;
      for (const i of list) {
        let arc = Math.abs(s.dist[i] - s.dist[a]);
        arc = Math.min(arc, L - arc);
        if (arc < 50) continue;
        const bx = s.px[i] - x, bz = s.pz[i] - z;
        if (ax * bx + az * bz >= 0) continue;
        if (Math.hypot(bx, bz) - s.halfWidth[i] <= 40) return true;
      }
    }
    return false;
  }

  function standingOK(x, z, r, margin = 1.5) {
    for (let k = 0; k < reserved.length; k++) {
      const [rx, rz, rr] = reserved[k];
      if (Math.hypot(x - rx, z - rz) < rr + r) return false;
    }
    return bandGap(x, z, REACH + r) >= r + margin && !inInfield(x, z);
  }

  function alongTrack(x, z) {
    const i = nearestIndex(x, z);
    return i < 0 ? 0 : s.dist[i];
  }

  // Road point at lap fraction t, offset `lat` metres to the right (horizontal).
  function trackPoint(t, lat = 0) {
    const i = ((Math.round(t * N) % N) + N) % N;
    const h = Math.atan2(s.tx[i], s.tz[i]);
    return {
      i, s: s.dist[i], x: s.px[i] + hxOf(i) * lat, y: s.py[i], z: s.pz[i] + hzOf(i) * lat, heading: h,
      hw: s.halfWidth[i], off: s.offroad[i], band: s.halfWidth[i] + s.offroad[i],
      hx: hxOf(i), hz: hzOf(i),
    };
  }

  // Heading from (x, z) towards the road a little before sample i, so props face the
  // oncoming reader instead of showing their cut edge to the chase camera.
  function faceRoad(x, z, i, back = 28) {
    const j = ((i - Math.round(back / track.spacing)) % N + N) % N;
    return Math.atan2(s.px[j] - x, s.pz[j] - z);
  }

  // Does the folded footprint of a prop at (x, z) facing `yaw` (length `len` laid away from the
  // heading, half-width `hw`) keep clear of every road band it could be seen folded from? From
  // road within 70 m before the prop's lap distance `sRef` to 60 m past it the prop is always up
  // (popup.js triggers at 70–110 m, folds beyond 60 m), so that stretch does not count.
  function foldClear(x, z, yaw, len, hw, sRef) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const steps = Math.max(1, Math.ceil(len / 3));
    for (let k = 1; k <= steps; k++) {
      const d = (len * k) / steps;
      for (const o of [-hw, 0, hw]) {
        const px = x - fx * d + rx * o, pz = z - fz * d + rz * o;
        const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          const list = buckets.get(key(cx + dx, cz + dz));
          if (!list) continue;
          for (let m = 0; m < list.length; m++) {
            const i = list[m];
            let ahead = sRef - s.dist[i];
            ahead -= Math.round(ahead / L) * L;
            if (ahead <= 70 && ahead >= -60) continue;
            if (Math.hypot(s.px[i] - px, s.pz[i] - pz) - s.halfWidth[i] - s.offroad[i] < 0.3) return false;
          }
        }
      }
    }
    return true;
  }

  const popups = createPopups(game, track, { group, alongTrack, foldClear });

  // Scatter a pop-up type along the lap, beyond the band edge by `gap` metres.
  function scatter(type, { every = 30, tFrom = 0, tTo = 1, side = 'both', gap = [3, 30], r = 2,
    scale = [1, 1], jitter = 0.5, face = 'road', tint = null, y = pageY, chance = 1, ok = null } = {}) {
    const span = ((tTo - tFrom + 1) % 1 || 1) * L;
    const count = Math.max(1, Math.floor(span / every));
    let placed = 0;
    for (let k = 0; k < count; k++) {
      if (rng() > chance) continue;
      const t = tFrom + ((k + 0.5 + (rng() - 0.5) * jitter) * every) / L;
      const sides = side === 'both' ? [rng() < 0.5 ? -1 : 1] : [side === 'left' ? -1 : 1];
      for (const sg of sides) {
        const p = trackPoint(t, 0);
        const sc = scale[0] + (scale[1] - scale[0]) * rng();
        const lat = sg * (p.band + gap[0] + (gap[1] - gap[0]) * rng() + r * sc);
        const x = p.x + p.hx * lat, z = p.z + p.hz * lat;
        if (!standingOK(x, z, r * sc) || (ok && !ok(x, z))) continue;
        const yaw = face === 'road' ? faceRoad(x, z, p.i) + (rng() - 0.5) * 0.3 : rng() * Math.PI * 2;
        popups.add(type, x, y, z, yaw, sc, sc, sc, { tint: typeof tint === 'function' ? tint(rng) : tint, s: p.s });
        placed++;
      }
    }
    return placed;
  }

  // Scatter in a disc around (cx, cz); `s` is the lap distance that times the cluster.
  function cluster(type, cx, cz, radius, count, { r = 1, scale = [1, 1], tint = null, y = pageY, face = 'road', tries = 4, s: sRef = null } = {}) {
    let placed = 0;
    for (let k = 0; k < count * tries && placed < count; k++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * radius;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const sc = scale[0] + (scale[1] - scale[0]) * rng();
      if (!standingOK(x, z, r * sc)) continue;
      const i = nearestIndex(x, z);
      const yaw = face === 'road' ? faceRoad(x, z, i) + (rng() - 0.5) * 0.5 : rng() * Math.PI * 2;
      popups.add(type, x, y, z, yaw, sc, sc, sc, { tint: typeof tint === 'function' ? tint(rng) : tint, s: sRef ?? s.dist[i] });
      placed++;
    }
    return placed;
  }

  // Stage-flat hills beside raised stretches of road (they also stand in front of the skirts).
  // A hill card is 2R wide along the road, so both of its ends must clear every road too.
  function flatsBesideRaised(type, { every = 32, minLift = 2.5, r = [15, 25], extra = [2, 5], tints = ['#ffffff', '#eef0f4'] } = {}) {
    for (let d = 0; d < L; d += every) {
      const p = trackPoint(d / L, 0);
      const lift = p.y - pageY;
      if (lift < minLift) continue;
      for (const sg of [-1, 1]) {
        const R = r[0] + (r[1] - r[0]) * rng();
        const lat = sg * (p.band + R + 1.5);
        const x = p.x + p.hx * lat, z = p.z + p.hz * lat;
        const yaw = Math.atan2(p.x - x, p.z - z);
        const ex = Math.cos(yaw) * R * 0.95, ez = -Math.sin(yaw) * R * 0.95;
        const h = lift + extra[0] + (extra[1] - extra[0]) * rng();
        const tint = tints[Math.floor(rng() * tints.length)];
        if (!standingOK(x, z, R * 0.6, 0.5) || !standingOK(x + ex, z + ez, 1.5, 0.5) || !standingOK(x - ex, z - ez, 1.5, 0.5)) continue;
        popups.add(type, x, pageY, z, yaw, R * 2, h, 20, { size: lift, s: p.s, tint });
      }
    }
  }

  function addStatic(object) {
    group.add(object);
    return object;
  }

  function uniquePaper(color, opts = {}) {
    const m = game.materials.paper(color, { ...opts, unique: true });
    ownMaterials.push(m);
    return m;
  }

  const mats = {
    paper: game.materials.paper('#ffffff', { vertexColors: true }),
    emissive: (c, o) => game.materials.emissive(c, o),
    unique: uniquePaper,
    // Big flat cut-outs (hills, banks, backdrops) that must read the same from every side:
    // smooth shading on up-facing normals, no halftone. Pass the geometry to have its normals set.
    evenLight(geometry) {
      const n = geometry.attributes.normal;
      for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
      n.needsUpdate = true;
      if (!mats._even) mats._even = uniquePaper('#ffffff', { vertexColors: true, halftone: false, flat: false });
      return mats._even;
    },
  };

  const ctx = {
    THREE, game, def, track, theme: def.theme, decor: def.decor || {}, rng, pageY, group, L, N, samples: s,
    Parts, mixHex, mats, popups, scatter, cluster, flatsBesideRaised, addStatic, trackPoint, faceRoad, standingOK, bandGap,
    inInfield, nearestIndex, alongTrack,
    onUpdate(fn) { updaters.push(fn); },
  };

  const sign = placeChapterSign();
  const theme = THEMES[def.scenery] || THEMES[def.id];
  if (theme) theme.build(ctx);
  if (sign) buildChapterSign(sign);

  for (const entry of track.rampMeshes || []) if (entry.ramp?.popup && entry.object3d) popups.addRamp(entry);

  // Base tabs: the glued flap each prop stands on, with its crease line.
  const tabParts = new Parts()
    .flat(roundRectPts(1, 1, 0.18), mixHex(def.theme.paper, def.theme.ink, 0.12))
    .flat([[-0.5, -0.03], [0.5, -0.03], [0.5, 0.03], [-0.5, 0.03]], mixHex(def.theme.paper, def.theme.ink, 0.45), { y: 0.004 });
  popups.finalize(tabParts.build(), mats.paper);

  // ---------------------------------------------------------------- chapter title sign
  // The chapter's title card stands a little past the start line, like the title page of a
  // pop-up book chapter. Its spot is reserved before the theme places anything.
  function placeChapterSign() {
    const edges = [s.edgeRight, s.edgeLeft];
    // Far enough down the straight to sit in the grid's view, near enough to read.
    for (const ahead of [70, 60, 82, 48, 36, 26]) {
      const t = (track.startT ?? def.startT ?? 0) + ahead / L;
      const p = trackPoint(((t % 1) + 1) % 1, 0);
      for (const [k, sg] of [[1, -1], [0, 1]]) {           // left first: the HUD keeps that side clear
        const code = edges[k] ? edges[k][p.i] : 0;
        if (code === 2 || code === 3) continue;               // no signs over void or water
        const lat = sg * (p.band + 3 + SIGN_W / 2);
        const x = p.x + p.hx * lat, z = p.z + p.hz * lat;
        // Band clearance only: the infield rule guards rocket cuts, not a sign near the start.
        if (bandGap(x, z, REACH + SIGN_W / 2) < SIGN_W / 2 + 0.5) continue;
        // The card and its sight line to the grid (30 m behind the line) stay clear of props.
        const g = trackPoint((((track.startT ?? 0) - 30 / L) % 1 + 1) % 1, 0);
        reserved.push([x, z, SIGN_W / 2 + 3]);
        for (const f of [0.2, 0.35, 0.5]) reserved.push([x + (g.x - x) * f, z + (g.z - z) * f, 6]);
        return { x, z, p };
      }
    }
    return null;
  }

  function buildChapterSign({ x, z, p }) {
    const th = def.theme;
    const cw = 1024, ch = Math.round((cw * SIGN_H) / SIGN_W);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const g2 = canvas.getContext('2d');
    const card = mixHex(th.paper, '#fffaf0', 0.72);
    g2.fillStyle = card;
    g2.fillRect(0, 0, cw, ch);
    g2.strokeStyle = th.ink;
    g2.lineWidth = 8;
    g2.strokeRect(22, 22, cw - 44, ch - 44);
    // The title takes the chapter's second accent, or the one that stands out most from the card
    // when that one is too pale to read (contrast ratio < 2.2).
    const lum = (hex) => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const accents = th.accents?.length ? th.accents : ['#e8534a'];
    let accent = accents[1] ?? accents[0];
    if (ratio(accent, card) < 2.2) accent = accents.reduce((best, c) => (ratio(c, card) > ratio(best, card) ? c : best));
    const title = String(def.name || def.id).toLocaleUpperCase('tr');
    const kicker = `${def.chapter ?? ''}. BÖLÜM`;
    let size = 150;
    if (typeof lettering.measureLettering === 'function') {
      const m = lettering.measureLettering(title, { size });
      if (m.width > cw * 0.86) size *= (cw * 0.86) / m.width;
    }
    lettering.drawLettering(g2, kicker, { x: cw / 2, y: ch * 0.36, size: 64, colors: { fill: th.ink, shadow: mixHex(th.ink, th.paper, 0.6), ink: th.ink }, seed: 7, align: 'center' });
    lettering.drawLettering(g2, title, { x: cw / 2, y: ch * 0.8, size, colors: { fill: accent, shadow: th.ink, ink: th.ink }, seed: 19, align: 'center' });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    ownTextures.push(tex);
    const face = new THREE.PlaneGeometry(SIGN_W, SIGN_H);
    face.translate(0, SIGN_POST + SIGN_H / 2, 0.2);
    // Up-facing normals light the title evenly whichever way the sun falls (as the backdrops).
    const fn = face.attributes.normal;
    for (let k = 0; k < fn.count; k++) fn.setXYZ(k, 0, 1, 0);
    const frame = new Parts()
      .card(roundRectPts(SIGN_W + 0.9, SIGN_H + 0.9, 0.35), 0.3, mixHex(th.ink, th.paper, 0.25), '#fbf6e9', { y: SIGN_POST + SIGN_H / 2 })
      .box(0.45, SIGN_POST + SIGN_H * 0.6, 0.45, mixHex(th.ink, th.paper, 0.35), { x: -SIGN_W * 0.33, z: -0.3 })
      .box(0.45, SIGN_POST + SIGN_H * 0.6, 0.45, mixHex(th.ink, th.paper, 0.35), { x: SIGN_W * 0.33, z: -0.3 })
      .build();
    const type = popups.addType('chapterSign', [
      { geometry: frame, material: mats.paper, cast: true },
      { geometry: face, material: uniquePaper('#ffffff', { map: tex, halftone: false }) },
    ]);
    const y = ctx.startGroundY ?? pageY;
    popups.add(type, x, y, z, faceRoad(x, z, p.i, 95), 1, 1, 1, { s: p.s - 40, size: SIGN_POST + SIGN_H, tabW: SIGN_W * 0.9, tabD: 1.4 });
  }

  const info = track.createQueryInfo ? track.createQueryInfo() : null;
  let hint = -1;
  let time = 0;

  function update(frameDt, camera) {
    time += frameDt;
    let camS = 0;
    if (info && camera) {
      track.query(camera.position, hint, info);
      hint = info.index;
      camS = info.dist;
    } else if (camera) {
      camS = alongTrack(camera.position.x, camera.position.z);
    }
    const lookBack = !!(game.cameraRig?.lookBack || (game.player?.controls?.lookBack && !game.player?.autopilot));
    popups.update(frameDt, camS, lookBack, !!game.reducedMotion);
    for (let k = 0; k < updaters.length; k++) updaters[k](frameDt, time, camera);
  }

  function dispose() {
    popups.dispose();
    group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of ownMaterials) m.dispose();
    ownMaterials.length = 0;
    for (const t of ownTextures) t.dispose();
    ownTextures.length = 0;
    updaters.length = 0;
    group.parent?.remove(group);
  }

  return { update, dispose, group, popups };
}
