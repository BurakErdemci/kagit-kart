// Chapter 2 — Boğaz Gecesi. A paper İstanbul at blue hour: the strait printed in waves between
// two shores, a red paper-cut suspension bridge strung with lamps, a stone tower inside the
// climbing curl, wooden houses with lit windows, lantern strings, ferries crossing with smoke, a
// simit cart, gulls, a moon hung on a string, and a composed skyline of three mosques over rows
// of lit houses.
import { circlePts, blobPts, archPts, roundRectPts, starPts } from '../kit.js';

const EDGE = '#f1e6cf';
const LIT = '#ffd98a';
const LAMP = '#ffcf6b';

export function build(ctx) {
  const { THREE, Parts, mats, popups, scatter, pageY, rng, trackPoint, decor, addStatic, onUpdate,
    standingOK, samples: s, N, L, mixHex, theme, bandGap } = ctx;
  const P = mats.paper;
  const E = (c) => mats.emissive(c);
  const t0 = (t) => ((t % 1) + 1) % 1;
  const mid = (a, b) => t0(a + t0(b - a) / 2);

  // ---------------------------------------------------------------- the strait
  // The strait lies between the European shore road and the Asian quay (both run along z).
  const hasStrait = !!(decor.shore && decor.quay);
  const shoreP = hasStrait ? trackPoint(mid(...decor.shore)) : null;
  const quayP = hasStrait ? trackPoint(mid(...decor.quay)) : null;
  const west = hasStrait ? Math.min(shoreP.x, quayP.x) + shoreP.band : Infinity;
  const east = hasStrait ? Math.max(shoreP.x, quayP.x) - quayP.band : -Infinity;
  let minZ = Infinity, maxZ = -Infinity, minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < N; i++) { minZ = Math.min(minZ, s.pz[i]); maxZ = Math.max(maxZ, s.pz[i]); minX = Math.min(minX, s.px[i]); maxX = Math.max(maxX, s.px[i]); }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const waterColor = theme.water || '#27497a';
  if (hasStrait) {
    const g = new THREE.PlaneGeometry(east - west + 4, maxZ - minZ + 900, 1, 1);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv, pos = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 9, pos.getZ(i) / 9);
    g.translate((west + east) / 2, pageY + 0.03, cz);
    const waterMat = mats.unique(waterColor, { overlay: ctx.game.materials.textures.waves, overlayColor: mixHex(waterColor, '#ffffff', 0.45), scroll: 0.05 });
    addStatic(new THREE.Mesh(g, waterMat)).receiveShadow = true;
    // Moonlight glitter: a column of pale dashes across the water toward the moon.
  }

  const ground = new Parts(); // flat prints on the page and the water, drawn as one mesh

  // ---------------------------------------------------------------- prop types
  const house = (w, h, d, bay) => {
    const p = new Parts()
      .box(w, h, d, '#ffffff')
      .roof(w + 0.8, 2.2, d + 0.8, '#9c4a3c', { y: h, ry: Math.PI / 2 }, 0)
      .box(w + 0.4, 0.35, d + 0.4, '#e8dcc6', { y: h * 0.5 });
    if (bay) p.box(w * 0.5, h * 0.45, 1.4, '#ffffff', { y: h * 0.45, z: d / 2 + 0.6 }).box(w * 0.56, 0.3, 1.8, '#9c4a3c', { y: h * 0.9, z: d / 2 + 0.6 });
    return p;
  };
  const windows = (w, h, d, rows, cols, bay) => {
    const p = new Parts();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = -w / 2 + (w * (c + 0.5)) / cols, y = 1.2 + r * ((h - 1.8) / rows);
      if (bay && Math.abs(x) < w * 0.25 && y > h * 0.45) continue;
      p.box(0.8, 1.1, 0.1, '#ffffff', { x, y, z: d / 2 + 0.03 });
    }
    if (bay) p.box(w * 0.3, 1.1, 0.1, '#ffffff', { y: h * 0.62, z: d / 2 + 1.32 });
    return p;
  };
  const tallHouse = popups.addType('konak', [
    { geometry: house(6, 11, 6, true).build(), material: P, cast: true },
    { geometry: windows(6, 11, 6, 3, 3, true).build(), material: E(LIT) },
  ], { kind: 'volume' });
  const wideHouse = popups.addType('ev', [
    { geometry: house(9, 7.5, 6, false).build(), material: P, cast: true },
    { geometry: windows(9, 7.5, 6, 2, 4, false).build(), material: E(LIT) },
  ], { kind: 'volume' });

  const lanternGeo = new Parts();
  const poles = new Parts()
    .box(0.35, 7, 0.35, '#3b3346', { x: -9 })
    .box(0.35, 7, 0.35, '#3b3346', { x: 9 });
  for (let k = 0; k <= 12; k++) {
    const x = -9 + (18 * k) / 12, y = 6.8 - 1.6 * Math.sin((k / 12) * Math.PI);
    if (k < 12) {
      const x2 = -9 + (18 * (k + 1)) / 12, y2 = 6.8 - 1.6 * Math.sin(((k + 1) / 12) * Math.PI);
      poles.strip([x, y, 0], [x2, y2, 0], 0.06, '#3b3346');
    }
    if (k % 2 === 1) lanternGeo.cyl(0.42, 0.42, 0.9, '#ffffff', { x, y: y - 1.0 }, 8);
  }
  const lanterns = popups.addType('fener', [
    { geometry: poles.build(), material: P },
    { geometry: lanternGeo.build(), material: E(LAMP) },
  ]);

  const simit = popups.addType('simitci', [{ geometry: new Parts()
    .box(3, 1.2, 1.6, '#c8413b', { y: 0.6 })
    .box(2.8, 1.3, 1.4, '#cfe3ef', { y: 1.8 })
    .roof(3.4, 0.7, 1.9, '#c8413b', { y: 3.1 }, 0)
    .cyl(0.55, 0.55, 0.2, '#2b2536', { x: -1.1, y: 0.55, rx: Math.PI / 2 }, 10)
    .cyl(0.55, 0.55, 0.2, '#2b2536', { x: 1.1, y: 0.55, rx: Math.PI / 2 }, 10)
    .add(new THREE.TorusGeometry(0.32, 0.12, 5, 10), '#c98b3f', { x: -0.7, y: 2.0, z: 0.72 })
    .add(new THREE.TorusGeometry(0.32, 0.12, 5, 10), '#c98b3f', { x: 0.1, y: 2.3, z: 0.72 })
    .add(new THREE.TorusGeometry(0.32, 0.12, 5, 10), '#c98b3f', { x: 0.8, y: 1.9, z: 0.72 })
    .build(), material: P, cast: true }], { kind: 'volume' });

  const gullWire = popups.addType('marti', [{ geometry: (() => {
    const p = new Parts().box(0.3, 8, 0.3, '#3b3346', { x: -12 }).box(0.3, 8, 0.3, '#3b3346', { x: 12 });
    for (let k = 0; k < 8; k++) {
      const x0 = -12 + 3 * k, x1 = x0 + 3;
      p.strip([x0, 7.4 - Math.sin((k / 8) * Math.PI) * 0.8, 0], [x1, 7.4 - Math.sin(((k + 1) / 8) * Math.PI) * 0.8, 0], 0.07, '#3b3346');
    }
    for (const x of [-7, -4.5, 1, 5.5, 8]) {
      const y = 7.4 - Math.sin(((x + 12) / 24) * Math.PI) * 0.8;
      p.card([[-0.6, 0.35], [0, 0], [0.6, 0.35], [0.45, 0.6], [0, 0.4], [-0.45, 0.6]], 0.12, '#f4efe6', EDGE, { x, y: y + 0.05 });
      p.card(circlePts(0.22, 6), 0.14, '#f4efe6', EDGE, { x: x + 0.1, y: y + 0.75 });
    }
    return p.build();
  })(), material: P }]);

  const tulip = popups.addType('lale', [{ geometry: new Parts()
    .box(0.12, 1.6, 0.1, '#3f7a4a')
    .sheet([[-0.25, 0], [-0.12, 1.0], [0, 0.05]], '#4f8a55', { y: 0.1, x: -0.1 })
    .card([[-0.45, 0], [0.45, 0], [0.55, 0.7], [0.3, 0.5], [0.15, 0.95], [0, 0.6], [-0.15, 0.95], [-0.3, 0.5], [-0.55, 0.7]], 0.12, '#d6334a', '#f6c9bf', { y: 1.55 })
    .build(), material: P }]);

  // Cypresses: the city's dark flames, as crossed cards.
  const flame = [[-0.4, 0], [0.4, 0], [0.5, 1.2], [1.4, 4], [1.6, 8], [1.1, 12], [0.4, 15.5], [0, 16.5], [-0.4, 15.5], [-1.1, 12], [-1.6, 8], [-1.4, 4], [-0.5, 1.2]];
  const cypressGeo = new Parts()
    .card(flame, 0.3, '#1f3a36', '#3f6b5f')
    .card(flame, 0.3, '#18302d', '#3f6b5f', { ry: Math.PI / 2, sx: 0.9 })
    .build();
  const cypress = popups.addType('selvi', [{ geometry: cypressGeo, material: P, cast: true }], { kind: 'volume' });

  // Hillside flats round the raised curl and bridge approaches.
  const slopeGeo = new Parts()
    .card(archPts(1.0, 1.0, 14), 0.02, '#26345f', '#3a4a7a', { z: -0.35, sx: 1.25, sy: 1.25 })
    .card(archPts(1.0, 0.8, 14), 0.02, '#2e3f6e', '#3a4a7a', { z: 0 })
    .build();
  const slope = popups.addType('yamac', [{ geometry: slopeGeo, material: mats.evenLight(slopeGeo) }], { flutter: false, tab: false });
  ctx.flatsBesideRaised(slope, { every: 26, minLift: 2.5, r: [14, 22], extra: [1, 3] });

  // ---------------------------------------------------------------- placement
  const onShore = (p, sg, gap, r) => {
    const lat = sg * (p.band + gap + r);
    const x = p.x + p.hx * lat, z = p.z + p.hz * lat;
    return x > west - 2 && x < east + 2 ? null : [x, z];   // never in the strait
  };
  const tints = ['#f3d9b1', '#e8b6a6', '#b9cfe0', '#f1e5c8', '#cfe0c4', '#e9c7d9'];
  for (let d = 0; d < L; d += 12) {
    const p = trackPoint(d / L, 0);
    for (const sg of [-1, 1]) {
      if (rng() < 0.3) continue;
      const wide = rng() < 0.4;
      const r = wide ? 5.5 : 4.5;
      const at = onShore(p, sg, 3 + rng() * 26, r);
      if (!at || !standingOK(at[0], at[1], r)) continue;
      const sc = 0.95 + rng() * 0.3;
      popups.add(wide ? wideHouse : tallHouse, at[0], pageY, at[1], ctx.faceRoad(at[0], at[1], p.i, 10), sc, sc, sc, {
        tint: tints[Math.floor(rng() * tints.length)], s: p.s,
      });
    }
  }
  for (let d = 5; d < L; d += 9) {
    const p = trackPoint(d / L, 0);
    const sg = rng() < 0.5 ? -1 : 1;
    const at = onShore(p, sg, 1 + rng() * 45, 1.8);
    if (!at || !standingOK(at[0], at[1], 1.8)) continue;
    const sc = 0.8 + rng() * 0.6;
    popups.add(cypress, at[0], pageY, at[1], rng() * 6.28, sc, sc * (0.9 + rng() * 0.4), sc, { s: p.s });
  }
  const dry = (x) => x <= west - 11 || x >= east + 11;      // lantern strings are 18 m wide
  scatter(lanterns, { every: 40, gap: [1.5, 3], r: 9.5, side: 'left', face: 'road', chance: 0.9, ok: dry });
  scatter(lanterns, { every: 55, gap: [1.5, 3], r: 9.5, side: 'right', face: 'road', chance: 0.6, ok: dry });

  // Tulips round the garden hairpin (outside it: the inside is the rocket cut).
  if (decor.tulips) {
    const [a, b] = decor.tulips;
    for (let k = 0; k < 90; k++) {
      const p = trackPoint(t0(a + (t0(b - a) * k) / 90), 0);
      const lat = -(p.band + 1.5 + rng() * 10);
      const x = p.x + p.hx * lat, z = p.z + p.hz * lat;
      if (standingOK(x, z, 0.8)) popups.add(tulip, x, pageY, z, ctx.faceRoad(x, z, p.i), 1.4, 1.4, 1.4, { tint: rng() < 0.3 ? '#ffd24a' : '#ffffff', s: p.s });
    }
  }
  if (decor.simit != null) {
    const p = trackPoint(t0(decor.simit), 0);
    const at = onShore(p, -1, 3, 2);
    if (at && standingOK(at[0], at[1], 2)) popups.add(simit, at[0], pageY, at[1], ctx.faceRoad(at[0], at[1], p.i), 1.2, 1.2, 1.2, { s: p.s });
    const p2 = trackPoint(t0(decor.simit + 70 / L), 0);
    const at2 = onShore(p2, -1, 6, 12);
    if (at2 && standingOK(at2[0], at2[1], 12)) popups.add(gullWire, at2[0], pageY, at2[1], ctx.faceRoad(at2[0], at2[1], p2.i), 1, 1, 1, { s: p2.s });
  }
  if (decor.pier != null) {
    const p = trackPoint(t0(decor.pier), 0);
    const at = onShore(p, -1, 8, 12);
    if (at && standingOK(at[0], at[1], 12)) popups.add(gullWire, at[0], pageY, at[1], ctx.faceRoad(at[0], at[1], p.i), 1, 1, 1, { s: p.s });
  }

  // ---------------------------------------------------------------- stone tower inside the curl
  if (decor.curl) {
    let tx = 0, tz = 0, n = 0;
    const [a, b] = decor.curl;
    for (let k = 0; k <= 40; k++) { const p = trackPoint(t0(a + (t0(b - a) * k) / 40), 0); tx += p.x; tz += p.z; n++; }
    tx /= n; tz /= n;
    const stone = '#cbb89a';
    const body = new Parts()
      .cyl(8.2, 9, 5, '#b8a282', {}, 16)
      .cyl(7.2, 7.8, 21, stone, { y: 5 }, 16)
      .cyl(8.4, 8.4, 0.8, '#8f7c62', { y: 25.5 }, 16)
      .cyl(7.4, 7.4, 4.5, stone, { y: 26.3 }, 16)
      .cone(8, 12, '#3d4a6b', { y: 30.8 }, 16)
      .cyl(0.25, 0.25, 3, '#d9c07a', { y: 42.6 }, 6);
    for (let k = 0; k < 16; k++) {
      const a2 = (k / 16) * Math.PI * 2;
      body.box(0.6, 1.4, 0.6, '#8f7c62', { x: Math.sin(a2) * 8.3, y: 26.3, z: Math.cos(a2) * 8.3, ry: a2 });
    }
    const lights = new Parts();
    for (let r = 0; r < 4; r++) for (let k = 0; k < 8; k++) {
      const a2 = ((k + (r % 2) * 0.5) / 8) * Math.PI * 2, rad = r === 3 ? 7.45 : 7.3 + (1 - r / 3) * 0.3;
      const y = r === 3 ? 27.6 : 8 + r * 5.5;
      lights.card(archPts(0.9, 1.9, 6), 0.1, '#ffffff', '#ffffff', { x: Math.sin(a2) * rad, y, z: Math.cos(a2) * rad, ry: a2 });
    }
    const tower = popups.addType('kule', [
      { geometry: body.build(), material: P, cast: true },
      { geometry: lights.build(), material: E(LIT) },
    ], { kind: 'volume', tab: false });
    const pc = trackPoint(t0(a + t0(b - a) * 0.25), 0);
    popups.add(tower, tx, pageY, tz, Math.atan2(pc.x - tx, pc.z - tz), 1, 1, 1, { s: pc.s, size: 40 });
  }

  // ---------------------------------------------------------------- the suspension bridge
  // The chapter's signature frame, standing for good like the skyline: red paper-cut towers whose
  // pointed-arch portals the road runs through, a cream tulip on each crown, cream main cables
  // strung with lamps, hangers down to a railing that stands clear of the drivable edge (the strait
  // shows through the gap), a deck with a body under it, and the lamps' light printed on the water.
  // Built in the bridge's own frame: x along the deck from the middle of the water span, z to the
  // right of travel, y up from the page.
  if (decor.bridge && hasStrait) {
    const [a, b] = decor.bridge;
    const run = [];
    for (let k = 0; k <= 240; k++) run.push(trackPoint(t0(a + (t0(b - a) * k) / 240), 0));
    const wet = run.filter((p) => p.x > west && p.x < east);
    if (wet.length > 2) {
      const first = wet[0], last = wet[wet.length - 1];
      const ox = (first.x + last.x) / 2, oz = (first.z + last.z) / 2;
      const span = Math.hypot(last.x - first.x, last.z - first.z) || 1;
      const ux = (last.x - first.x) / span, uz = (last.z - first.z) / span;
      const prof = run.map((p) => [(p.x - ox) * ux + (p.z - oz) * uz, p.y - pageY]).sort((p, q) => p[0] - q[0]);
      const deckAt = (x) => {
        if (x <= prof[0][0]) return prof[0][1];
        for (let k = 1; k < prof.length; k++) {
          if (prof[k][0] < x) continue;
          const [x0, y0] = prof[k - 1], [x1, y1] = prof[k];
          return y0 + ((y1 - y0) * (x - x0)) / Math.max(1e-6, x1 - x0);
        }
        return prof[prof.length - 1][1];
      };
      const B = first.band;
      const D = deckAt(0);
      const xT = span / 2 - 9;              // towers stand in the water just off each shore
      const Zl = B + 3.4;                   // legs, cables and railing, clear of the drivable band
      const H = D + 44;                     // tower top
      const xA = [Math.max(prof[0][0] + 4, -xT - 44), Math.min(prof[prof.length - 1][0] - 4, xT + 44)];
      const sag = D + 2.4, saddle = H - 1.2;
      const cableY = (x) => {
        if (Math.abs(x) <= xT) return sag + (saddle - sag) * (x / xT) ** 2;
        const xa = x < 0 ? xA[0] : xA[1];
        const f = (Math.abs(x) - xT) / (Math.abs(xa) - xT);
        return saddle + (deckAt(xa) + 1.2 - saddle) * f - 2.2 * Math.sin(Math.PI * f);
      };
      const RED = '#c8413b', RED_DARK = '#9e2f2c', CREAM = '#f4e6c4', STONE = '#d7ccb2';
      const f = new Parts();
      const lamps = new Parts();
      const legR = (y) => 3.9 + ((2.6 - 3.9) * y) / H;   // square leg, circumradius at height y
      // A portal beam across the deck (card plane across x): top at y1, a Tudor arch cut under it
      // rising `rise` from y0 between the legs; the red card shows its cream core on every cut.
      const portal = (y0, y1, rise, crest) => {
        const zi = Zl - legR(y0) * 0.72;
        const pts = [];
        if (crest) {
          const n = Math.round((2 * Zl + 2) / 2.6);
          for (let k = 0; k <= n; k++) pts.push([Zl + 1 - ((2 * Zl + 2) * k) / n, y1 + (k % 2 ? 1.5 : 0)]);
        } else {
          pts.push([Zl + 1, y1], [-Zl - 1, y1]);
        }
        pts.push([-Zl - 1, y0], [-zi, y0]);
        const g = (u) => 0.55 * Math.sqrt(1 - (1 - u) ** 2) + 0.45 * u;
        for (let k = 1; k <= 12; k++) pts.push([-zi + (zi * k) / 12, y0 + rise * g(k / 12)]);
        for (let k = 11; k >= 0; k--) pts.push([zi - (zi * k) / 12, y0 + rise * g(k / 12)]);
        pts.push([Zl + 1, y0]);
        return pts;
      };
      for (const x of [-xT, xT]) {
        for (const z of [-Zl, Zl]) {
          f.box(8.6, 3.4, 8.6, STONE, { x, z });
          f.box(9.4, 0.5, 9.4, CREAM, { x, y: 3.4, z });
          f.cyl(legR(H), legR(0), H, RED, { x, z, ry: Math.PI / 4 }, 4);
          for (const yb of [D - 0.8, D + 12.6, D + 27.2]) {
            const r = legR(yb) + 0.25;
            f.cyl(r, r, 1.1, CREAM, { x, y: yb, z, ry: Math.PI / 4 }, 4);
          }
          f.cyl(legR(H) + 0.35, legR(H) + 0.35, 0.6, CREAM, { x, y: H - 0.6, z, ry: Math.PI / 4 }, 4);
          lamps.box(1.5, 2.1, 1.5, '#ffffff', { x, y: H, z });
          f.cyl(0.15, 1.35, 1.8, RED_DARK, { x, y: H + 2.1, z, ry: Math.PI / 4 }, 4);
        }
        f.card(portal(D + 13.4, D + 18.8, 3.4, false), 2.6, RED, CREAM, { x, ry: -Math.PI / 2 });
        f.card(portal(D + 28, D + 31.4, 1.7, false), 2.6, RED, CREAM, { x, ry: -Math.PI / 2 });
        f.card(portal(D + 40.4, H + 0.2, 1.1, true), 2.6, RED, CREAM, { x, ry: -Math.PI / 2 });
        f.card(TULIP.map(([u, v]) => [u * 3.6, D + 40.9 + v * 3.3]), 3.1, CREAM, RED, { x, ry: -Math.PI / 2 });
      }
      // main cables with their lamps, one per side, anchor to anchor over both saddles
      const step = 2.4;
      for (const z of [-Zl, Zl]) {
        let px = xA[0], py = cableY(px), k = 0;
        for (let x = xA[0] + step; x <= xA[1] + 1e-6; x += step, k++) {
          const y = cableY(x);
          f.strip([px, py, z], [x, y, z], 1.25, CREAM);
          if (k % 2 === 0) lamps.box(0.75, 0.75, 0.75, '#ffffff', { x, y: y + 0.55, z });
          px = x; py = y;
        }
        f.box(3.2, 2.6, 3.2, RED_DARK, { x: xA[0], y: deckAt(xA[0]) - 0.6, z });
        f.box(3.2, 2.6, 3.2, RED_DARK, { x: xA[1], y: deckAt(xA[1]) - 0.6, z });
      }
      // hangers, outrigger brackets, railing posts (a lamp on every other one) and the rails
      const posts = [];
      for (let x = Math.ceil(xA[0] / 5) * 5; x <= xA[1]; x += 5) {
        if (Math.abs(Math.abs(x) - xT) < 3) continue;
        posts.push(x);
      }
      posts.forEach((x, k) => {
        const dy = deckAt(x);
        for (const sg of [-1, 1]) {
          const z = sg * Zl;
          const cy = cableY(x);
          if (cy - dy > 1.6) f.strip([x, cy - 0.5, z], [x, dy + 1.0, z], 0.24, CREAM);
          f.box(0.5, 0.45, Zl - B - 0.3, RED, { x, y: dy - 0.95, z: sg * (B + 0.6 + (Zl - B - 0.3) / 2) });
          f.box(0.24, 1.55, 0.24, CREAM, { x, y: dy - 0.5, z });
          if (k % 2 === 0) lamps.box(0.42, 0.42, 0.42, '#ffffff', { x, y: dy + 1.05, z });
          const n = posts[k + 1];
          if (n != null && n - x < 6) {
            const dn = deckAt(n);
            f.strip([x, dy + 1.0, z], [n, dn + 1.0, z], 0.16, CREAM);
            f.strip([x, dy + 0.45, z], [n, dn + 0.45, z], 0.1, CREAM);
          }
        }
      });
      // the deck's body under the road, a cream stripe along its side
      for (let x0 = xA[0] - 3; x0 < xA[1] + 3; x0 += 4) {
        const x1 = Math.min(x0 + 4, xA[1] + 3);
        const y0 = deckAt(x0), y1 = deckAt(x1), xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
        const rz = Math.atan2(y1 - y0, x1 - x0);
        f.box(x1 - x0 + 0.05, 2.3, 2 * (B + 0.6), RED, { x: xm, y: ym - 2.65, rz });
        f.box(x1 - x0 + 0.05, 0.55, 2 * (B + 0.75), CREAM, { x: xm, y: ym - 1.35, rz });
      }
      const frame = new THREE.Mesh(f.build(), P);
      const glow = new THREE.Mesh(lamps.build(), E('#ffe9a8'));
      for (const m of [frame, glow]) {
        m.position.set(ox, pageY, oz);
        m.rotation.y = Math.atan2(-uz, ux);
        addStatic(m);
      }
      frame.name = 'scenery:bridge';
      frame.castShadow = true;
      frame.receiveShadow = true;
      // the lamps' light printed on the water under the span, broken by the waves
      const rxv = -uz, rzv = ux;
      const toWorld = (x, z) => [ox + ux * x + rxv * z, oz + uz * x + rzv * z];
      const across = Math.atan2(-rzv, rxv), along = Math.atan2(-uz, ux);
      const half = span / 2;
      for (const sg of [-1, 1]) {
        for (let x = -xT - 6; x <= xT + 6; x += 2.4) {
          for (let j = 0; j < 3; j++) {
            if (rng() < 0.35) continue;
            const off = sg * (Zl + (j - 1) * 3.2 + (rng() - 0.5) * 2);
            const [wx, wz] = toWorld(x + (rng() - 0.5) * 1.2, off);
            ground.flat(roundRectPts(1.4 + rng() * 2.6, 0.45, 0.2, 2), mixHex(waterColor, '#ffe2a0', 0.45 + rng() * 0.3), { x: wx, y: pageY + 0.1, z: wz, ry: across });
          }
        }
      }
      // lights of both shores on the open strait either side of the span, streaked towards the deck
      for (let k = 0; k < 170; k++) {
        const sg = k % 2 ? 1 : -1;
        const lat = sg * (Zl + 8 + 125 * rng() ** 1.4);
        const x = -half + 3 + (2 * half - 6) * rng();
        const [wx, wz] = toWorld(x, lat);
        ground.flat(roundRectPts(2.2 + rng() * 4.5, 0.4 + rng() * 0.3, 0.18, 2), mixHex(waterColor, rng() < 0.7 ? '#ffd98a' : '#dfe6ff', 0.35 + rng() * 0.3), { x: wx, y: pageY + 0.09, z: wz, ry: along });
      }
      for (const x of [-xT, xT]) for (const sg of [-1, 1]) {
        for (let k = 0; k < 5; k++) {
          const [wx, wz] = toWorld(x + (rng() - 0.5) * 2, sg * (Zl + 7 + k * 4.2));
          ground.flat(roundRectPts(3 + rng() * 3, 0.55, 0.25, 2), mixHex(waterColor, '#ffe9a8', 0.7 - k * 0.08), { x: wx, y: pageY + 0.1, z: wz, ry: across });
        }
      }
    }
  }

  // ---------------------------------------------------------------- ferries (vapur) with smoke
  const ferryGeo = new Parts()
    .box(16, 1.6, 5, '#23202b')
    .box(16.4, 0.5, 5.4, '#f4efe6', { y: 1.6 })
    .box(12, 2.2, 4.2, '#f4efe6', { y: 2.1 })
    .box(9, 1.8, 3.6, '#f4efe6', { y: 4.3 })
    .cyl(0.7, 0.8, 3.4, '#23202b', { y: 6.1 }, 8)
    .cyl(0.72, 0.72, 0.6, '#f4efe6', { y: 7.9 }, 8)
    .build();
  const ferryWin = new Parts();
  for (let k = 0; k < 9; k++) for (const z of [2.12, -2.12]) ferryWin.box(0.8, 0.7, 0.08, '#ffffff', { x: -5.2 + k * 1.3, y: 2.9, z });
  for (let k = 0; k < 6; k++) for (const z of [1.82, -1.82]) ferryWin.box(0.8, 0.6, 0.08, '#ffffff', { x: -3.4 + k * 1.3, y: 4.9, z });
  const ferries = new THREE.InstancedMesh(ferryGeo, P, 2);
  if (!hasStrait) ferries.count = 0;
  const ferryLights = new THREE.InstancedMesh(ferryWin.build(), E(LIT), 2);
  if (!hasStrait) ferryLights.count = 0;
  ferries.name = 'scenery:vapur';
  ferries.castShadow = true;
  addStatic(ferries); addStatic(ferryLights);
  // Ferry lanes between the two bridges, a third and two thirds of the way.
  const zHigh = decor.bridge ? trackPoint(mid(...decor.bridge)).z : minZ;
  const zLow = decor.lowBridge ? trackPoint(mid(...decor.lowBridge)).z : maxZ;
  const ferryState = [0, 1].map((k) => ({
    z: zHigh + (zLow - zHigh) * (k ? 0.64 : 0.36),
    t: rng() * 40, speed: 4.5 + rng(), dir: k ? 1 : -1,
  }));
  const puffGeo = new Parts().ball(1, '#d8d6e2', {}, 1).build();
  const PUFFS = 24;
  const puffs = new THREE.InstancedMesh(puffGeo, P, PUFFS);
  if (!hasStrait) puffs.count = 0;
  puffs.name = 'scenery:smoke';
  addStatic(puffs);
  const puffState = Array.from({ length: PUFFS }, (_, k) => ({ ferry: k % 2, age: (k / PUFFS) * 4 }));

  // ---------------------------------------------------------------- sky: moon and stars on strings
  const moonDir = new THREE.Vector3(...theme.sun.dir).normalize();
  const moonGeo = new Parts().card(circlePts(26, 28), 2, '#ffffff', '#ffffff').build();
  const moon = addStatic(new THREE.Mesh(moonGeo, E('#f6efcf')));
  const moonPos = new THREE.Vector3(cx + moonDir.x * 430, pageY + 150, cz + moonDir.z * 430);
  moon.position.copy(moonPos);
  moon.lookAt(cx, pageY + 20, cz);
  const craters = new Parts()
    .card(circlePts(5, 10, -8, 6), 0.4, '#e3d9b5', '#e3d9b5')
    .card(circlePts(3.5, 10, 9, -4), 0.4, '#e3d9b5', '#e3d9b5')
    .card(circlePts(2.4, 10, 2, 12), 0.4, '#e3d9b5', '#e3d9b5');
  const crater = addStatic(new THREE.Mesh(craters.build(), E('#e6dcb8')));
  crater.position.copy(moonPos);
  crater.lookAt(cx, pageY + 20, cz);
  crater.translateZ(1.3);
  const stringGeo = new Parts().strip([0, 0, 0], [0, 260, 0], 0.4, '#8a8fb0').build();
  const moonString = addStatic(new THREE.Mesh(stringGeo, P));
  moonString.position.set(moonPos.x, moonPos.y + 26, moonPos.z);
  const starGeo = new Parts().card(starPts(5, 2.2, 0.9), 0.4, '#ffffff', '#ffffff').build();
  const STARS = 22;
  const stars = new THREE.InstancedMesh(starGeo, E('#fff3c4'), STARS);
  const starStrings = new THREE.InstancedMesh(new Parts().strip([0, 2, 0], [0, 90, 0], 0.12, '#565b86').build(), P, STARS);
  stars.name = 'scenery:stars';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const rad = Math.max(maxX - cx, maxZ - cz);
  for (let k = 0; k < STARS; k++) {
    const a = rng() * Math.PI * 2, r = rad * (0.5 + rng() * 0.9);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    q.setFromAxisAngle(v3.set(0, 1, 0), Math.atan2(cx - x, cz - z));
    const sc = 0.8 + rng() * 1.4;
    m4.compose(v3.set(x, pageY + 70 + rng() * 60, z), q, one.set(sc * 1.4, sc * 1.4, sc * 1.4));
    stars.setMatrixAt(k, m4);
    starStrings.setMatrixAt(k, m4);
  }
  addStatic(stars); addStatic(starStrings);

  // ---------------------------------------------------------------- skyline (stays up)
  // Composed, not repeated, in two sectors. North, where the grid, the start straight and the old
  // town look: the grand mosque (four minarets, a tulip mahya between the tall pair) above the road's
  // vanishing point and wooden houses with lit windows along both banks, the stone tower in the curl
  // standing in front of it. South, down the strait past the low bridge, where the quay and the
  // intro's title shot look: a waterfront mosque (two minarets) at the bridge's end and a hilltop
  // mosque (one) across the water over rows of houses. Elsewhere only lit houses on the eastern hill
  // and a low band of hills. Nearer layers print darker.
  {
    const sky = new Parts();
    const skyLit = new Parts();
    const bnd = ctx.track.bounds, pm = ctx.game.config.track.pageMargin;
    const page = { x0: bnd.min.x - pm + 14, x1: bnd.max.x + pm - 14, z0: bnd.min.z - pm + 14, z1: bnd.max.z + pm - 14 };
    const layer = (col) => ({ p: sky, lit: skyLit, col, edge: mixHex(col, '#9aa3d6', 0.3), at: null });
    const facing = (sil, x, z, vx, vz, lift = 0) => { sil.at = { x, y: pageY + lift, z, ry: Math.atan2(vx - x, vz - z) }; return sil; };
    const sp = trackPoint(t0(ctx.track.startT ?? 0), 0);
    const fx = Math.sin(sp.heading), fz = Math.cos(sp.heading);
    // (ahead, right) metres from the start line → world
    const fromStart = (ahead, right) => [sp.x + fx * ahead + sp.hx * right, sp.z + fz * ahead + sp.hz * right];
    const NEAR = '#1e2651', MID = '#28335f', FAR = '#34406e', RING = '#3d4979';

    // a long hill card with a rolling crest, `w` wide, rising to about `h` in the middle
    const hillCard = (sil, w, h) => {
      const pts = [];
      for (let k = 0; k <= 24; k++) {
        const u = k / 24;
        pts.push([-w / 2 + w * u, 4 + h * Math.sin(Math.PI * u) ** 1.5 + 2.5 * Math.sin(u * 17)]);
      }
      pts.push([w / 2, 0], [-w / 2, 0]);
      cutOut(sil, pts, -2, 1.5);
    };

    // north, above the start straight and the old town: the old city
    const [gx, gz] = fromStart(322, -10);
    grandMosque(facing(layer(MID), gx, gz, sp.x, sp.z));
    const row = (sil, a, b, opts) => houseRow(sil, fromStart(...a), fromStart(...b), [sp.x, sp.z], rng, { y: pageY, ...opts });
    row(layer(NEAR), [262, -300], [256, -14], { lift: (d) => 3 + 9 * Math.sin((d / 290) * Math.PI), lit: 0.34 });
    if (hasStrait) row(layer(NEAR), [258, (east - sp.x) + 6], [262, 420], { lift: (d) => 2 + 7 * Math.sin((d / 260) * Math.PI * 0.8), lit: 0.34 });
    row(layer(FAR), [352, -60], [352, 190], { lift: (d) => 6 + 5 * Math.sin(d / 40), scale: 0.8, lit: 0.22 });

    // south, down the strait past the low bridge (the quay and the intro's title shot look this way):
    // the waterfront mosque at the low bridge's western end, a hilltop mosque on the far shore
    if (hasStrait && decor.lowBridge) {
      const lb = trackPoint(mid(...decor.lowBridge), 0);
      const dn = Math.sign(lb.z - cz) || 1;
      const vx = quayP.x, vz = quayP.z;
      waterfrontMosque(facing(layer(MID), west - 55, lb.z + 120 * dn, vx, vz));
      const hill = facing(layer(FAR), east + 90, lb.z + 190 * dn, vx, vz);
      hillCard(hill, 260, 15);
      hilltopMosque(facing(layer(MID), east + 90, lb.z + 186 * dn, vx, vz, 15));
      const toV = [vx, vz];
      houseRow(layer(NEAR), [west - 290, lb.z + 95 * dn], [west - 8, lb.z + 80 * dn], toV, rng, { y: pageY, lift: (d) => 2 + 8 * Math.sin((d / 280) * Math.PI), lit: 0.36 });
      houseRow(layer(NEAR), [east + 8, lb.z + 80 * dn], [east + 300, lb.z + 100 * dn], toV, rng, { y: pageY, lift: (d) => 2 + 6 * Math.sin((d / 290) * Math.PI), lit: 0.36 });
      houseRow(layer(FAR), [west + 6, lb.z + 222 * dn], [east + 70, lb.z + 222 * dn], toV, rng, { y: pageY, lift: (d) => 5 + 4 * Math.sin(d / 35), scale: 0.8, lit: 0.22 });
    }

    // east, through the bridge portals: the Asian shore, a hill of lit houses (no landmark)
    if (decor.bridge) {
      const bm = trackPoint(mid(...decor.bridge), 0);
      const bfx = Math.sin(bm.heading), bfz = Math.cos(bm.heading);
      const at = (ahead, right) => [bm.x + bfx * ahead + bm.hx * right, bm.z + bfz * ahead + bm.hz * right];
      const [hx, hz] = at(392, 14);
      hillCard(facing(layer(FAR), hx, hz, bm.x, bm.z), 300, 16);
      houseRow(layer(NEAR), at(334, -160), at(334, 180), [bm.x, bm.z], rng, { y: pageY, lift: (d) => 2 + 9 * Math.sin((d / 340) * Math.PI) ** 2, scale: 0.85, lit: 0.36 });
    }

    // round the rest: low hills with a few distant lights, inside the page
    const c0x = (bnd.min.x + bnd.max.x) / 2, c0z = (bnd.min.z + bnd.max.z) / 2;
    const HILLS = 30;
    for (let k = 0; k < HILLS; k++) {
      const a = (k / HILLS) * Math.PI * 2 + (rng() - 0.5) * 0.08;
      const dx = Math.cos(a), dz = Math.sin(a);
      const tx = dx > 0 ? (page.x1 - c0x) / dx : dx < 0 ? (page.x0 - c0x) / dx : Infinity;
      const tz = dz > 0 ? (page.z1 - c0z) / dz : dz < 0 ? (page.z0 - c0z) / dz : Infinity;
      const r = Math.min(tx, tz);
      const sil = facing(layer(RING), c0x + dx * r, c0z + dz * r, c0x, c0z);
      const w = 120 + rng() * 70, h = 14 + rng() * 16;
      cutOut(sil, archPts(w, h, 16), 0, 1.5);
      for (let j = 0; j < 4; j++) {
        if (rng() < 0.4) continue;
        const u = (rng() - 0.5) * 0.7;
        light(sil, u * w, Math.sqrt(Math.max(0, 1 - 4 * u * u)) * h * 0.72, 0.9, 0.9, 1);
      }
    }
    const skyGeo = sky.build();
    const skyline = addStatic(new THREE.Mesh(skyGeo, mats.evenLight(skyGeo)));
    skyline.name = 'scenery:skyline';
    addStatic(new THREE.Mesh(skyLit.build(), E('#f7c56a')));
  }

  // ---------------------------------------------------------------- ground prints
  const gy = pageY + 0.04;
  for (let k = 0; k < 70; k++) {
    const x = minX - 200 + rng() * (maxX - minX + 400), z = minZ - 200 + rng() * (maxZ - minZ + 400);
    if (x > west - 10 && x < east + 10) continue;
    const r = 8 + rng() * 22;
    if (bandGap(x, z, r + 60) < r + 4) continue;
    ground.flat(blobPts([[0, 0, r], [r * 0.7, r * 0.3, r * 0.7], [-r * 0.6, r * 0.4, r * 0.6]], 18), rng() < 0.6 ? '#2d4a4a' : '#3b3d62', { x, y: gy, z, ry: rng() * 6 });
  }
  // moon path glitter on the water
  for (let k = 0; hasStrait && k < 40; k++) {
    const f = rng();
    const x = west + 6 + rng() * (east - west - 12);
    const z = cz + (rng() - 0.5) * 360;
    ground.flat(roundRectPts(3 + rng() * 5, 0.6, 0.25, 2), mixHex(waterColor, '#fff6d8', 0.55 + f * 0.3), { x, y: pageY + 0.06, z, ry: Math.atan2(moonDir.x, moonDir.z) + Math.PI / 2 });
  }
  addStatic(new THREE.Mesh(ground.build(), P)).receiveShadow = true;

  // ---------------------------------------------------------------- per-frame
  const fq = new THREE.Quaternion();
  onUpdate((dt, time) => {
    if (!hasStrait) return;
    for (let k = 0; k < 2; k++) {
      const f = ferryState[k];
      f.t += dt;
      const width = east - west - 36;
      const cycle = width / f.speed + 8;          // crossing + 4 s at each pier
      const ph = (f.t % (2 * cycle)) / cycle;     // 0..2
      const go = ph < 1 ? ph : ph - 1;
      const u = Math.min(1, Math.max(0, (go * cycle - 4) / (cycle - 8)));
      const e = u * u * (3 - 2 * u);
      const toEast = (ph < 1) === (f.dir > 0);
      const x = toEast ? west + 18 + e * width : east - 18 - e * width;
      const bob = Math.sin(time * 1.3 + k) * 0.12;
      fq.setFromAxisAngle(v3.set(0, 1, 0), toEast ? Math.PI / 2 : -Math.PI / 2);
      m4.compose(v3.set(x, pageY + 0.2 + bob, f.z), fq, one.set(1, 1, 1));
      ferries.setMatrixAt(k, m4);
      ferryLights.setMatrixAt(k, m4);
      f.x = x;
    }
    ferries.instanceMatrix.needsUpdate = true;
    ferryLights.instanceMatrix.needsUpdate = true;
    for (let k = 0; k < PUFFS; k++) {
      const p = puffState[k];
      p.age += dt;
      if (p.age > 4) p.age -= 4;
      const f = ferryState[p.ferry];
      const g = p.age / 4;
      const sc = 0.6 + g * 2.4;
      m4.compose(v3.set((f.x ?? west) + Math.sin(k * 1.7 + time) * g * 2 - g * 3, pageY + 8.6 + g * 11, f.z + g * 1.5), fq.identity(), one.set(sc, sc * 0.85, sc));
      puffs.setMatrixAt(k, m4);
    }
    puffs.instanceMatrix.needsUpdate = true;
  });
}

// ------------------------------------------------------------------ skyline cut-outs
// A cut-out's local frame: x along the card, y up from its foot, +z towards the viewer; `sil.at`
// { x, y, z, ry } places it. Silhouettes go to `sil.p` in one colour, lit windows to `sil.lit`.

// A tulip, the chapter's emblem: base point at (0, 0), about 0.92 tall.
const TULIP = [[0, 0], [-0.34, 0.12], [-0.46, 0.42], [-0.42, 0.8], [-0.24, 0.62], [-0.12, 0.92], [0, 0.68],
  [0.12, 0.92], [0.24, 0.62], [0.42, 0.8], [0.46, 0.42], [0.34, 0.12]];
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const domePts = (cx, y0, w, h, n = 14) => archPts(w, h, n, cx).map(([x, y]) => [x, y + y0]);

function cutOut(sil, pts, dz = 0, t = 1.2) {
  const { at } = sil;
  sil.p.card(pts, t, sil.col, sil.edge, { x: at.x + Math.sin(at.ry) * dz, y: at.y, z: at.z + Math.cos(at.ry) * dz, ry: at.ry });
}

function light(sil, lx, ly, w, h, dz = 1) {
  const { at } = sil, c = Math.cos(at.ry), s = Math.sin(at.ry);
  sil.lit.box(w, h, 0.4, '#ffffff', { x: at.x + c * lx + s * dz, y: at.y + ly, z: at.z - s * lx + c * dz, ry: at.ry });
}

// Pencil minaret: pedestal, tapering shaft, balconies (fractions of the shaft) each with a ring of
// lamps, a conical cap and a finial.
function minaret(sil, x0, h, balconies, dz) {
  cutOut(sil, rect(x0 - 3.2, 0, 6.4, 9), dz);
  cutOut(sil, [[x0 - 1.7, 9], [x0 + 1.7, 9], [x0 + 1.35, h], [x0 - 1.35, h]], dz);
  for (const f of balconies) {
    const y = 9 + (h - 9) * f;
    cutOut(sil, [[x0 - 1.5, y - 2.4], [x0 + 1.5, y - 2.4], [x0 + 3, y], [x0 + 3, y + 1.2], [x0 - 3, y + 1.2], [x0 - 3, y]], dz);
    light(sil, x0, y + 1.3, 4.8, 0.8, dz + 0.9);
  }
  cutOut(sil, [[x0 - 1.8, h], [x0 + 1.8, h], [x0, h + 16]], dz);
  cutOut(sil, rect(x0 - 0.3, h + 15.5, 0.6, 4.5), dz);
}

// The grand mosque, symmetric: an arcade of small domes, the hall with corner domes, two half domes
// stepping up to the drum and the great dome, turrets at the drum; the tall pair of minarets at the
// hall, the short pair at the courtyard's corners, and a mahya between the tall pair.
function grandMosque(sil) {
  cutOut(sil, rect(-66, 0, 132, 13));
  for (let k = -5; k <= 5; k++) cutOut(sil, domePts(k * 11.5, 13, 8.5, 4.6, 8), 0.05);
  cutOut(sil, rect(-38, 0, 76, 30), 0.1);
  for (const sx of [-1, 1]) {
    cutOut(sil, domePts(sx * 31, 30, 13, 7, 10), 0.15);
    cutOut(sil, domePts(sx * 17, 30, 30, 15, 14), 0.2);
    cutOut(sil, rect(sx * 21 - 2.4, 30, 4.8, 18), 0.25);
    cutOut(sil, [[sx * 21 - 2.4, 48], [sx * 21 + 2.4, 48], [sx * 21, 53]], 0.25);
  }
  cutOut(sil, rect(-18, 30, 36, 15), 0.3);
  cutOut(sil, domePts(0, 44, 42, 23, 22), 0.35);
  cutOut(sil, rect(-0.4, 66.5, 0.8, 7), 0.35);
  for (let k = -3; k <= 3; k++) light(sil, k * 4.6, 36.5, 1.6, 3.4, 1.2);
  for (let k = -4; k <= 4; k++) light(sil, k * 7.6, 17, 2, 4.2, 1.2);
  minaret(sil, -46, 86, [0.58, 0.74, 0.88], 0.4);
  minaret(sil, 46, 86, [0.58, 0.74, 0.88], 0.4);
  minaret(sil, -72, 64, [0.62, 0.82], 0.4);
  minaret(sil, 72, 64, [0.62, 0.82], 0.4);
  // mahya: lamps strung between the tall minarets, a tulip drawn in lamps hanging from the middle
  for (let k = 0; k <= 30; k++) {
    const u = k / 30, x = -43 + 86 * u;
    light(sil, x, 91 - 5 * Math.sin(Math.PI * u), 1.1, 1.1, 1.6);
  }
  const outline = [...TULIP, TULIP[0]];
  for (let k = 0; k < outline.length - 1; k++) {
    const [ax, ay] = outline[k], [bx, by] = outline[k + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 0.11));
    for (let j = 0; j < n; j++) {
      const u = j / n;
      light(sil, (ax + (bx - ax) * u) * 15, 74 + (ay + (by - ay) * u) * 13, 1.1, 1.1, 1.6);
    }
  }
}

// The waterfront mosque, asymmetric: a long courtyard wing of small domes with both minarets at its
// far corners, the hall and its dome at the other end, and the sloping wall of a royal pavilion.
function waterfrontMosque(sil) {
  cutOut(sil, rect(-70, 0, 62, 12));
  for (let k = 0; k < 6; k++) cutOut(sil, domePts(-63 + k * 10, 12, 7.5, 4.2, 8), 0.05);
  cutOut(sil, rect(-12, 0, 56, 26), 0.1);
  cutOut(sil, domePts(16, 26, 50, 12, 16), 0.15);
  for (const x of [-7, 39]) cutOut(sil, domePts(x, 26, 10, 6, 8), 0.2);
  cutOut(sil, rect(3, 26, 26, 9), 0.25);
  cutOut(sil, domePts(16, 34, 30, 17, 18), 0.3);
  cutOut(sil, rect(15.6, 50.5, 0.8, 6), 0.3);
  cutOut(sil, [[44, 0], [64, 0], [64, 13], [54, 18], [44, 18]], 0.1);
  for (let k = 0; k < 5; k++) light(sil, -4 + k * 8, 14, 2, 4, 1.2);
  for (let k = -2; k <= 2; k++) light(sil, 16 + k * 4.8, 28.5, 1.4, 3, 1.2);
  light(sil, 57, 5, 3, 4.5, 1.2);
  minaret(sil, -70, 76, [0.6, 0.76, 0.9], 0.4);
  minaret(sil, -52, 76, [0.6, 0.76, 0.9], 0.4);
}

// The hilltop mosque: a single great dome on a cube whose arched face is filled with lit windows,
// a weight tower at each corner, and one minaret with a single balcony.
function hilltopMosque(sil) {
  cutOut(sil, rect(-32, 0, 64, 7));
  cutOut(sil, rect(-24, 0, 48, 40), 0.1);
  for (const sx of [-1, 1]) {
    cutOut(sil, rect(sx * 25 - 3.4, 0, 6.8, 45), 0.15);
    cutOut(sil, domePts(sx * 25, 45, 6.8, 4.6, 8), 0.15);
  }
  cutOut(sil, rect(-17, 40, 34, 6), 0.2);
  cutOut(sil, domePts(0, 45, 40, 21, 22), 0.25);
  cutOut(sil, rect(-0.4, 65.5, 0.8, 6), 0.25);
  const rows = [[19, 7, 4.2], [25.5, 5, 4.2], [31.5, 3, 4.2]];
  for (const [y, n, gap] of rows) for (let k = 0; k < n; k++) light(sil, (k - (n - 1) / 2) * gap, y, 2, 3.6, 1.2);
  for (let k = -2; k <= 2; k++) light(sil, k * 7, 5, 2.2, 5, 1.2);
  minaret(sil, 38, 78, [0.8], 0.3);
}

// A continuous row of wooden houses on a rolling bank from a to b (world [x, z]), facing `toward`:
// gable, hipped, corniced and overhanging upper floors in a fixed cycle, heights from the seeded
// stream, windows lit at `lit` odds, all standing on one long bank card.
function houseRow(sil, a, b, toward, rnd, { lift = () => 0, scale = 1, lit = 0.3, y = 0 } = {}) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const sx = dx / len, sz = dz / len;
  let nx = -sz, nz = sx;
  if ((toward[0] - a[0]) * nx + (toward[1] - a[1]) * nz < 0) { nx = -nx; nz = -nz; }
  const ry = Math.atan2(nx, nz);
  // the card's local x runs along the row one way or the other
  const sgn = Math.cos(ry) * sx - Math.sin(ry) * sz >= 0 ? 1 : -1;
  const baseY = y;
  const put = (d) => ({ x: a[0] + sx * d, y: baseY, z: a[1] + sz * d, ry });
  const bank = [];
  for (let k = 0; k <= 16; k++) {
    const d = (len * k) / 16;
    bank.push([(d - len / 2) * sgn, lift(d) + 1.2]);
  }
  bank.push([(len / 2) * sgn, 0], [(-len / 2) * sgn, 0]);
  sil.at = put(len / 2);
  cutOut(sil, bank, -0.6, 1.2);
  let d = 0, k = 0;
  while (d < len - 4) {
    const w = Math.min(len - d, (7 + ((k * 5) % 7) + rnd() * 3) * scale);
    const h = (10 + rnd() * 12 + (k % 3 === 1 ? 5 : 0)) * scale;
    const kind = (k * 7 + (k >> 2)) % 4;
    const hw = w / 2;
    let pts;
    if (kind === 0) pts = [[-hw, 0], [hw, 0], [hw, h], [0, h + w * 0.36], [-hw, h]];
    else if (kind === 1) pts = [[-hw, 0], [hw, 0], [hw, h], [hw * 0.55, h + 2.8 * scale], [-hw * 0.55, h + 2.8 * scale], [-hw, h]];
    else if (kind === 2) pts = [[-hw, 0], [hw, 0], [hw, h], [hw + 0.6, h], [hw + 0.6, h + 0.9], [-hw - 0.6, h + 0.9], [-hw - 0.6, h], [-hw, h]];
    else pts = [[-hw, 0], [hw, 0], [hw, h * 0.45], [hw + 1, h * 0.5], [hw + 1, h], [0, h + w * 0.3], [-hw - 1, h], [-hw - 1, h * 0.5], [-hw, h * 0.45]];
    const up = lift(d + hw);
    sil.at = put(d + hw);
    sil.at.y = baseY + up;
    cutOut(sil, pts, 0, 1.2);
    if (k % 5 === 2) cutOut(sil, rect(hw * 0.3, h, 1.2 * scale, (kind === 0 ? w * 0.36 : 2.8) + 1.6 * scale), -0.2, 1.2);
    const rowsN = Math.max(1, Math.floor((h - 3 * scale) / (3.8 * scale)));
    const colsN = Math.max(1, Math.floor(w / (3.4 * scale)));
    for (let r = 0; r < rowsN; r++) for (let c = 0; c < colsN; c++) {
      if (rnd() > lit) continue;
      light(sil, (-hw + ((c + 0.5) * w) / colsN) * sgn, (2.4 + r * 3.8) * scale, 1.1 * scale, 1.6 * scale, 0.9);
    }
    d += w + (k % 4 === 3 ? 1.5 * scale : 0);
    k++;
  }
  sil.at = null;
}
