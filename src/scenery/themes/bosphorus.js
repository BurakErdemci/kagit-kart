// Chapter 2 — Boğaz Gecesi. A paper İstanbul at blue hour: the strait printed in waves between
// two shores, a suspension bridge whose side frames unfold with strings of lights on the
// cables, a stone tower inside the climbing curl, wooden houses with lit windows, lantern
// strings, ferries crossing with smoke, a simit cart, gulls, and a moon hung on a string in
// front of layered cut-paper domes and minarets.
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
  let placedHouses = 0;
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
      placedHouses++;
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

  // ---------------------------------------------------------------- suspension bridge side frames
  if (decor.bridge) {
    const [a, b] = decor.bridge;
    // deck points over the water
    let first = null, last = null;
    for (let k = 0; k <= 200; k++) {
      const p = trackPoint(t0(a + (t0(b - a) * k) / 200), 0);
      if (p.x > west && p.x < east) { if (!first) first = p; last = p; }
    }
    if (first && last) {
      const deckY = Math.max(first.y, last.y);
      const span = Math.hypot(last.x - first.x, last.z - first.z);
      const len = span + 70;
      const pm = trackPoint(t0((first.i + last.i) / 2 / N), 0);
      const D = deckY - pageY;
      const H = D + 30, T = span / 2 - 6;
      const frame = new Parts();
      const bulbs = new Parts();
      for (const x of [-T, T]) {
        frame.box(2.2, H, 2.2, '#d7d2c6', { x });
        for (const yb of [D - 1.5, D + 12, D + 24, H - 1.2]) frame.box(3.4, 1.2, 2.6, '#bfb8a8', { x, y: yb });
        bulbs.box(0.9, 0.9, 0.9, '#ffffff', { x, y: H + 0.2 });
      }
      // main cable: anchors on land, over the tower tops, sagging to the deck middle
      const cable = (x) => {
        if (x < -T) return D + 1 + ((x + len / 2) / (len / 2 - T)) * (H - D - 1);
        if (x > T) return D + 1 + ((len / 2 - x) / (len / 2 - T)) * (H - D - 1);
        const f = x / T;
        return D + 3 + (H - D - 3) * f * f;
      };
      const steps = 44;
      for (let k = 0; k < steps; k++) {
        const x0 = -len / 2 + (len * k) / steps, x1 = -len / 2 + (len * (k + 1)) / steps;
        // The cables are the bridge's night signature: lit strips, not grey wire.
        bulbs.strip([x0, cable(x0), 0], [x1, cable(x1), 0], 1.1, '#ffffff');
      }
      for (let x = -T + 5; x < T; x += 6) bulbs.strip([x, cable(x) - 0.4, 0], [x, D, 0], 0.3, '#ffffff');
      frame.box(len, 1.1, 0.8, '#bfb8a8', { y: D - 1.2 });
      const side = popups.addType('kopru', [
        { geometry: frame.build(), material: P, cast: true },
        { geometry: bulbs.build(), material: E('#ffe9a8') },
      ], { tab: false, flutter: false, noChunk: true });
      for (const sg of [-1, 1]) {
        const off = pm.band + 1.5;
        const x = pm.x + pm.hx * sg * off, z = pm.z + pm.hz * sg * off;
        popups.add(side, x, pageY, z, Math.atan2(pm.x - x, pm.z - z), 1, 1, 1, { s: first.s, size: 30 });
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

  // ---------------------------------------------------------------- skyline flats (stay up)
  const back = new Parts();
  const backLit = new Parts();
  const layers = [
    { r: 0, col: '#2c3868', h: 1.0 },
    { r: 110, col: '#3a4679', h: 1.25 },
    { r: 230, col: '#4b568a', h: 1.5 },
  ];
  const ringR = rad + 170;
  for (const [li, ly] of layers.entries()) {
    const n = 20 + li * 6;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + li * 0.21;
      let rr = ringR + ly.r;
      while (bandGap(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr, 300) < 170 + ly.r) rr += 20;
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      const yaw = Math.atan2(cx - x, cz - z);
      const k2 = rng();
      if (k2 < 0.45) mosque(back, x, z, yaw, ly, pageY, rng);
      else houses(back, backLit, x, z, yaw, ly, pageY, rng);
    }
  }
  const backGeo = back.build();
  addStatic(new THREE.Mesh(backGeo, mats.evenLight(backGeo)));
  addStatic(new THREE.Mesh(backLit.build(), E('#f7c56a')));

  // ---------------------------------------------------------------- ground prints
  const ground = new Parts();
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
  void placedHouses;
}

// Cut-paper mosque: base, central dome, half domes and two to four minarets.
function mosque(p, x, z, yaw, ly, pageY, rng) {
  const s = ly.h * (0.9 + rng() * 0.4);
  const col = ly.col;
  const put = (pts, dx, t = 1) => p.card(pts, t, col, col, { x: x + Math.cos(yaw) * dx, y: pageY, z: z - Math.sin(yaw) * dx, ry: yaw });
  put([[-26 * s, 0], [26 * s, 0], [26 * s, 12 * s], [-26 * s, 12 * s]], 0);
  put(archPts(30 * s, 20 * s, 16).map(([a, b]) => [a, b + 12 * s]), 0);
  put(archPts(14 * s, 9 * s, 10).map(([a, b]) => [a - 17 * s, b + 12 * s]), 0);
  put(archPts(14 * s, 9 * s, 10).map(([a, b]) => [a + 17 * s, b + 12 * s]), 0);
  put([[-0.8 * s, 32 * s], [0.8 * s, 32 * s], [0, 38 * s]], 0);
  const mins = rng() < 0.5 ? [-30, 30] : [-34, -26, 26, 34];
  for (const m of mins) {
    const h = (44 + rng() * 8) * s;
    put([[m * s - 1.2 * s, 0], [m * s + 1.2 * s, 0], [m * s + 1.2 * s, h], [m * s, h + 7 * s], [m * s - 1.2 * s, h]], 0);
    put([[m * s - 2 * s, h * 0.72], [m * s + 2 * s, h * 0.72], [m * s + 2 * s, h * 0.72 + 1.2 * s], [m * s - 2 * s, h * 0.72 + 1.2 * s]], 0);
  }
}

// A row of hillside houses with a few lit windows.
function houses(p, lit, x, z, yaw, ly, pageY, rng) {
  const s = ly.h;
  let dx = -40 * s;
  while (dx < 40 * s) {
    const w = (7 + rng() * 6) * s, h = (10 + rng() * 14) * s;
    const put = (pts, parts, col, lift = 0) => parts.card(pts, 1, col, col, { x: x + Math.cos(yaw) * (dx + w / 2), y: pageY + lift, z: z - Math.sin(yaw) * (dx + w / 2), ry: yaw });
    put([[-w / 2, 0], [w / 2, 0], [w / 2, h], [0, h + 4 * s], [-w / 2, h]], p, ly.col);
    for (let k = 0; k < 3; k++) {
      if (rng() < 0.55) continue;
      const wy = 3 * s + rng() * (h - 6 * s), wx = (rng() - 0.5) * (w - 3 * s);
      lit.card([[wx - 0.9 * s, wy], [wx + 0.9 * s, wy], [wx + 0.9 * s, wy + 1.4 * s], [wx - 0.9 * s, wy + 1.4 * s]], 1.4, '#ffffff', '#ffffff', {
        x: x + Math.cos(yaw) * (dx + w / 2) + Math.sin(yaw) * 0.6, y: pageY, z: z - Math.sin(yaw) * (dx + w / 2) + Math.cos(yaw) * 0.6, ry: yaw,
      });
    }
    dx += w + rng() * 3 * s;
  }
}
