// Chapter 3 — Buzul Geçidi. A snowy pass at a pink sunrise: cross-card pines whose cut edges
// are snow, folded-paper snow drifts, a lodge with a smoking chimney, a cable car whose
// gondolas climb over the track, bunting at the summit jump, crags under the cliff ridge, a
// cracked frozen lake, and layered peaks with snow caps in front of a low paper sun.
import { circlePts, blobPts, archPts, starPts } from '../kit.js';

const SNOW = '#fbfcff';
const EDGE = '#ffffff';

export function build(ctx) {
  const { THREE, Parts, mats, popups, scatter, cluster, pageY, rng, trackPoint, decor, addStatic, onUpdate,
    standingOK, samples: s, N, L, mixHex, theme, bandGap } = ctx;
  const P = mats.paper;
  const E = (c) => mats.emissive(c);
  const t0 = (t) => ((t % 1) + 1) % 1;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < N; i++) { minX = Math.min(minX, s.px[i]); maxX = Math.max(maxX, s.px[i]); minZ = Math.min(minZ, s.pz[i]); maxZ = Math.max(maxZ, s.pz[i]); }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const rad = Math.max(maxX - cx, maxZ - cz);

  // ---------------------------------------------------------------- prop types
  const pineOutline = (w, h, tiers) => {
    const pts = [[-0.35, 0], [0.35, 0], [0.35, h * 0.12]];
    for (let k = 0; k < tiers; k++) {
      const y0 = h * 0.12 + (k / tiers) * h * 0.88, wk = (w / 2) * (1 - k / (tiers + 0.6));
      pts.push([wk, y0], [wk * 0.45, y0 + (h * 0.88) / tiers * 0.55]);
    }
    pts.push([0, h]);
    const right = pts.slice(3);
    const left = right.slice(0, -1).reverse().map(([x, y]) => [-x, y]);
    return [...pts, ...left, [-0.35, h * 0.12]];
  };
  const pineGeo = new Parts()
    .card(pineOutline(6, 12, 4), 0.35, '#2f6b5a', SNOW)
    .card(pineOutline(5.4, 11.4, 4), 0.35, '#285e4f', SNOW, { ry: Math.PI / 2 });
  for (let k = 0; k < 4; k++) {
    const y0 = 12 * 0.12 + (k / 4) * 12 * 0.88, wk = 3 * (1 - k / 4.6);
    pineGeo.card([[-wk * 0.9, y0 - 0.1], [wk * 0.9, y0 - 0.1], [wk * 0.5, y0 + 0.9], [-wk * 0.5, y0 + 0.9]], 0.5, SNOW, EDGE, { z: 0.05 });
  }
  const pine = popups.addType('pine', [{ geometry: pineGeo.build(), material: P, cast: true }], { kind: 'volume' });

  const drift = popups.addType('drift', [{ geometry: new Parts()
    .roof(6, 2.2, 3, SNOW, {}, 0)
    .roof(3.4, 1.4, 2.4, '#e7eef8', { x: 2.8, z: 0.8, ry: 0.5 }, 0)
    .build(), material: P }], { kind: 'volume', flutter: false });

  const snowman = popups.addType('snowman', [{ geometry: new Parts()
    .ball(1.4, SNOW, { y: 1.3 }, 1)
    .ball(1.0, SNOW, { y: 3.3 }, 1)
    .ball(0.7, SNOW, { y: 4.8 }, 1)
    .cone(0.16, 0.9, '#f08a24', { y: 4.9, z: 0.6, rx: Math.PI / 2 }, 6)
    .box(1.6, 0.2, 0.3, '#d6546a', { y: 4.1, z: 0.1 })
    .cyl(0.55, 0.6, 0.9, '#2c2a3f', { y: 5.3 }, 8)
    .build(), material: P, cast: true }], { kind: 'volume' });

  const rock = popups.addType('rock', [{ geometry: new Parts()
    .ball(3, '#9a9ab0', { sy: 0.8 })
    .ball(2, '#b3b1c6', { x: 2.5, y: 0.5, z: 1 })
    .ball(1.5, SNOW, { x: 0.3, y: 2.1, sy: 0.4 })
    .build(), material: P, cast: true }], { kind: 'volume', flutter: false });

  const cabin = (w, d, h) => new Parts()
    .box(w, h, d, '#9b5b3a')
    .roof(w + 1.6, h * 0.9, d + 1.2, '#6d3f2a', { y: h, ry: Math.PI / 2 }, 0)
    .roof(w + 1.9, h * 0.35, d + 1.5, SNOW, { y: h + h * 0.62, ry: Math.PI / 2 }, 0)
    .box(1.2, 3.2, 1.2, '#7a7589', { x: w * 0.28, y: h + 1 })
    .box(1.6, 2.4, 0.2, '#5a3322', { z: d / 2 + 0.05 });
  const cabinLit = (w, d, h) => new Parts()
    .box(1.3, 1.2, 0.1, '#ffffff', { x: -w * 0.28, y: h * 0.45, z: d / 2 + 0.06 })
    .box(1.3, 1.2, 0.1, '#ffffff', { x: w * 0.28, y: h * 0.45, z: d / 2 + 0.06 });
  const lodge = popups.addType('lodge', [
    { geometry: cabin(14, 9, 6).box(6, 3, 0.4, '#b47a55', { y: 4, z: 4.7 }).build(), material: P, cast: true },
    { geometry: cabinLit(14, 9, 6).build(), material: E('#ffcf8a') },
  ], { kind: 'volume' });
  const hut = popups.addType('hut', [
    { geometry: cabin(6, 5, 3.6).build(), material: P, cast: true },
    { geometry: cabinLit(6, 5, 3.6).build(), material: E('#ffcf8a') },
  ], { kind: 'volume' });

  const bunting = popups.addType('bunting', [{ geometry: (() => {
    const p = new Parts().box(0.3, 9, 0.3, '#6d3f2a', { x: -11 }).box(0.3, 9, 0.3, '#6d3f2a', { x: 11 });
    const cols = ['#f29fb5', '#9fd6f2', '#ffe27a', '#b8e0b0', '#f6b48f'];
    for (let k = 0; k < 11; k++) {
      const x0 = -11 + 2 * k, x1 = x0 + 2;
      const y0 = 8.6 - Math.sin((k / 11) * Math.PI) * 1.5, y1 = 8.6 - Math.sin(((k + 1) / 11) * Math.PI) * 1.5;
      p.strip([x0, y0, 0], [x1, y1, 0], 0.06, '#6d3f2a');
      p.card([[x0 + 0.2, y0 - 0.05], [x1 - 0.2, y1 - 0.05], [(x0 + x1) / 2, (y0 + y1) / 2 - 1.3]], 0.06, cols[k % 5], EDGE);
    }
    return p.build();
  })(), material: P }]);

  // ---------------------------------------------------------------- placement
  scatter(pine, { every: 9, gap: [2, 40], r: 2.8, scale: [0.8, 1.3], face: 'random', chance: 0.75 });
  scatter(pine, { every: 16, gap: [35, 120], r: 2.8, scale: [1.0, 1.6], face: 'random', chance: 0.8 });
  if (decor.pines) {
    const [a, b] = decor.pines;
    for (let k = 0; k < 10; k++) {
      const p = trackPoint(t0(a + (t0(b - a) * k) / 10), 0);
      for (const sg of [-1, 1]) {
        const lat = sg * (p.band + 12 + rng() * 20);
        cluster(pine, p.x + p.hx * lat, p.z + p.hz * lat, 16, 9, { r: 2.8, scale: [0.9, 1.5], face: 'random', s: p.s });
      }
    }
  }
  scatter(drift, { every: 14, gap: [1, 30], r: 3, scale: [0.8, 1.6], face: 'random', chance: 0.6 });
  // Snow banks: stacked white arch flats beside every raised stretch (they also hide the skirts).
  const bankGeo = new Parts()
    .card(archPts(1.0, 1.0, 14), 0.02, '#e3e9f6', EDGE, { z: -0.35, sx: 1.25, sy: 1.25 })
    .card(archPts(1.0, 0.8, 14), 0.02, SNOW, EDGE, { z: 0 })
    .build();
  const bank = popups.addType('bank', [{ geometry: bankGeo, material: mats.evenLight(bankGeo) }], { flutter: false, tab: false });
  ctx.flatsBesideRaised(bank, { every: 30, minLift: 3, r: [14, 24], extra: [2, 6], tints: ['#ffffff'] });
  if (decor.lodge != null) {
    const p = trackPoint(t0(decor.lodge), 0);
    const lat = p.band + 12;
    const x = p.x + p.hx * lat, z = p.z + p.hz * lat;
    if (standingOK(x, z, 8)) popups.add(lodge, x, pageY, z, ctx.faceRoad(x, z, p.i), 1, 1, 1, { s: p.s, size: 12 });
    ctx.lodgeAt = { x, z };
    for (let k = 0; k < 4; k++) {
      const q = trackPoint(t0(decor.lodge + (k * 30 - 40) / L), 0);
      const sg = k % 2 ? 1 : -1;
      const l2 = sg * (q.band + 8 + rng() * 18);
      const hx = q.x + q.hx * l2, hz = q.z + q.hz * l2;
      if (standingOK(hx, hz, 4)) popups.add(hut, hx, pageY, hz, ctx.faceRoad(hx, hz, q.i), 1, 1, 1, { s: q.s });
    }
    for (let k = 0; k < 3; k++) {
      const q = trackPoint(t0(decor.lodge + (k * 45 + 20) / L), 0);
      const l2 = -(q.band + 5 + k * 3);
      const sx = q.x + q.hx * l2, sz = q.z + q.hz * l2;
      if (standingOK(sx, sz, 1.5)) popups.add(snowman, sx, pageY, sz, ctx.faceRoad(sx, sz, q.i), 1, 1, 1, { s: q.s });
    }
  }
  if (decor.summit != null) {
    const p = trackPoint(t0(decor.summit), 0);
    for (const sg of [-1]) {
      const lat = sg * (p.band + 12);
      const x = p.x + p.hx * lat, z = p.z + p.hz * lat;
      if (standingOK(x, z, 11)) popups.add(bunting, x, p.y - 0.05, z, Math.atan2(p.x - x, p.z - z) + Math.PI / 2 * 0, 1, 1, 1, { s: p.s - 40, size: 9 });
    }
  }
  // Crags under the cliff ridge (void side, right) stand on the page below.
  if (decor.ridge) {
    const [a, b] = decor.ridge;
    for (let k = 0; k < 9; k++) {
      const p = trackPoint(t0(a + (t0(b - a) * k) / 9), 0);
      const lat = p.band + 6 + rng() * 14;
      const x = p.x + p.hx * lat, z = p.z + p.hz * lat;
      const sc = 1.5 + rng() * 1.8;
      if (standingOK(x, z, 3 * sc)) popups.add(rock, x, pageY, z, rng() * 6.28, sc, sc * (1 + rng()), sc, { s: p.s });
    }
  }

  // ---------------------------------------------------------------- cable car
  let cableLine = null;
  if (decor.cable) {
    const A = trackPoint(t0(decor.cable[0]), 0), B = trackPoint(t0(decor.cable[1]), 0);
    const a = [A.x + A.hx * -(A.band + 20), A.z + A.hz * -(A.band + 20)];
    const b = [B.x + B.hx * (B.band + 20), B.z + B.hz * (B.band + 20)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(2, Math.round(len / 110));
    const pylons = new Parts();
    const tops = [];
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      let x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f;
      const groundH = pageY;
      const top = groundH + 26 + f * 18;
      if (bandGap(x, z, 60) < 4) { tops.push([x, top, z, false]); continue; }
      const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI / 2;
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      const leg = (dx, y0, y1, w) => pylons.strip([x + c * dx * (1 - y0 / top), y0, z - sn * dx * (1 - y0 / top)], [x + c * dx * 0.3, y1, z - sn * dx * 0.3], w, '#6f6b80');
      leg(4, groundH, top, 0.7); leg(-4, groundH, top, 0.7);
      for (let yy = groundH + 5; yy < top - 3; yy += 6) pylons.strip([x + c * -3, yy, z - sn * -3], [x + c * 3, yy + 5, z - sn * 3], 0.3, '#8a86a0');
      pylons.box(5, 0.8, 1, '#4a4660', { x, y: top, z, ry: yaw });
      tops.push([x, top, z, true]);
    }
    for (let k = 0; k < tops.length - 1; k++) pylons.strip(tops[k], tops[k + 1], 1.2, '#3a3650');
    addStatic(new THREE.Mesh(pylons.build(), P)).castShadow = true;
    cableLine = tops;
  }
  const gondola = new THREE.InstancedMesh(new Parts()
    .strip([0, 0, 0], [0, -3, 0], 0.18, '#3a3650')
    .box(3.2, 2.6, 2.4, '#d6546a', { y: -5.8 })
    .box(3.4, 0.35, 2.6, '#f4eef0', { y: -3.3 })
    .box(2.6, 1.0, 2.5, '#9fd6f2', { y: -4.6 })
    .build(), P, 4);
  gondola.name = 'scenery:gondola';
  gondola.castShadow = true;
  addStatic(gondola);

  // ---------------------------------------------------------------- ground prints: frozen lake, tracks
  const ground = new Parts();
  const gy = pageY + 0.05;
  if (decor.lake) {
    const [a, b] = decor.lake;
    const pm = trackPoint(t0(a + t0(b - a) / 2), 0);
    const len = t0(b - a) * L;
    // The lake lies on the left of the crossing (open water there); ice fringes the right.
    const lx = pm.x + pm.hx * -(pm.band + 40), lz = pm.z + pm.hz * -(pm.band + 40);
    const R = len * 0.55;
    ground.flat(blobPts([[0, 0, R], [R * 0.6, R * 0.3, R * 0.7], [-R * 0.5, R * 0.4, R * 0.6], [R * 0.1, -R * 0.5, R * 0.6]], 30), '#d8ecf8', { x: lx, y: gy, z: lz });
    ground.flat(blobPts([[0, 0, R * 0.55], [R * 0.3, R * 0.2, R * 0.4]], 24), '#a9cde6', { x: lx - pm.hx * 12, y: gy + 0.01, z: lz - pm.hz * 12 });
    for (let k = 0; k < 18; k++) {
      const x0 = lx + (rng() - 0.5) * R * 1.4, z0 = lz + (rng() - 0.5) * R * 1.4;
      let x = x0, z = z0, ang = rng() * 6.28;
      for (let j = 0; j < 4; j++) {
        const l = 4 + rng() * 8;
        const x2 = x + Math.cos(ang) * l, z2 = z + Math.sin(ang) * l;
        ground.flat([[x, -z], [x2, -z2], [x2 + 0.4, -z2 - 0.4], [x + 0.4, -z - 0.4]], '#8fb6d6', { y: gy + 0.02 });
        x = x2; z = z2; ang += (rng() - 0.5) * 1.4;
      }
    }
  }
  // Blue snow shadows and ski tracks on the page.
  for (let k = 0; k < 80; k++) {
    const x = minX - 150 + rng() * (maxX - minX + 300), z = minZ - 150 + rng() * (maxZ - minZ + 300);
    const r = 6 + rng() * 20;
    if (bandGap(x, z, r + 60) < r + 3) continue;
    ground.flat(blobPts([[0, 0, r], [r * 0.7, r * 0.3, r * 0.6]], 16), rng() < 0.5 ? '#e4eaf6' : '#efe3ec', { x, y: gy, z, ry: rng() * 6 });
  }
  for (let k = 0; k < 10; k++) {
    let x = minX + rng() * (maxX - minX), z = minZ + rng() * (maxZ - minZ), ang = rng() * 6.28;
    for (let j = 0; j < 14; j++) {
      const x2 = x + Math.cos(ang) * 6, z2 = z + Math.sin(ang) * 6;
      if (bandGap(x2, z2, 40) > 3 && bandGap(x, z, 40) > 3) {
        for (const o of [-0.8, 0.8]) {
          const nx = -Math.sin(ang) * o, nz = Math.cos(ang) * o;
          ground.flat([[x + nx, -(z + nz)], [x2 + nx, -(z2 + nz)], [x2 + nx + 0.25, -(z2 + nz)], [x + nx + 0.25, -(z + nz)]], '#c9d4ea', { y: gy + 0.01 });
        }
      }
      x = x2; z = z2; ang += Math.sin(j * 0.7 + k) * 0.35;
    }
  }
  addStatic(new THREE.Mesh(ground.build(), P)).receiveShadow = true;

  // ---------------------------------------------------------------- mountains (stay up)
  const back = new Parts();
  const layers = [
    { r: 0, col: '#b8a9cf', h: [90, 150] },
    { r: 120, col: '#cdbfdc', h: [130, 200] },
    { r: 250, col: '#e2d6e8', h: [170, 260] },
  ];
  const ringR = rad + 160;
  for (const [li, ly] of layers.entries()) {
    const n = 16 + li * 4;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + li * 0.4 + rng() * 0.1;
      let rr = ringR + ly.r;
      while (bandGap(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr, 300) < 180 + ly.r) rr += 20;
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      const yaw = Math.atan2(cx - x, cz - z);
      const h = ly.h[0] + rng() * (ly.h[1] - ly.h[0]), w = h * (1.6 + rng() * 0.8);
      const peak = (rng() - 0.5) * w * 0.3;
      const pts = [[-w / 2, 0], [w / 2, 0], [w * 0.28, h * 0.45], [peak + w * 0.08, h * 0.8], [peak, h], [peak - w * 0.1, h * 0.78], [-w * 0.3, h * 0.5]];
      const tr = { x, y: pageY - 1, z, ry: yaw };
      back.card(pts, 2, mixHex(ly.col, theme.fog.color, li * 0.15), EDGE, tr);
      const capH = h * 0.26;
      const cap = [[peak - w * 0.1 * 1.1, h - capH * 0.95], [peak - w * 0.04, h - capH * 0.7], [peak + 0.02 * w, h - capH], [peak + w * 0.07, h - capH * 0.65], [peak + w * 0.08 * 1.05, h * 0.8 - 0.5], [peak, h]];
      back.card(cap, 2.4, SNOW, EDGE, { ...tr, x: x + Math.sin(yaw) * 0.8, z: z + Math.cos(yaw) * 0.8 });
    }
  }
  const backGeo = back.build();
  addStatic(new THREE.Mesh(backGeo, mats.evenLight(backGeo)));

  // ---------------------------------------------------------------- sky: low paper sun, pink clouds
  const sunDir = new THREE.Vector3(...theme.sun.dir).normalize();
  const sunMat = mats.unique('#ffffff', { vertexColors: true, halftone: false });
  sunMat.fog = false;
  const sun = addStatic(new THREE.Mesh(new Parts()
    .card(starPts(18, 44, 34), 2, '#ffb48f', '#f29fb5')
    .card(circlePts(30, 28), 3, '#ffe0c2', '#ffb48f')
    .build(), sunMat));
  sun.position.set(cx + sunDir.x * 480, pageY + 70, cz + sunDir.z * 480);
  sun.lookAt(cx, pageY + 40, cz);
  const cloudGeo = new Parts().card(blobPts([[-7, 0, 5], [0, 2, 6.5], [7, 0, 5], [3, -1.5, 4.5], [-3, -1.5, 4]], 36), 1.2, '#ffffff', '#ffffff').build();
  const clouds = new THREE.InstancedMesh(cloudGeo, E('#ffd9df'), 10);
  const strings = new THREE.InstancedMesh(new Parts().strip([0, 5, 0], [0, 150, 0], 0.25, '#7b7593').build(), P, 10);
  clouds.name = 'scenery:clouds';
  addStatic(clouds); addStatic(strings);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const cloudState = Array.from({ length: 10 }, (_, k) => {
    const a = (k / 10) * 6.28 + rng() * 0.4, r = rad * (0.5 + rng() * 0.7);
    return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, y: pageY + 60 + rng() * 30, yaw: Math.atan2(-Math.cos(a), -Math.sin(a)), ph: rng() * 6.28, sc: 1.1 + rng() };
  });

  // ---------------------------------------------------------------- chimney smoke
  const PUFFS = 14;
  const puffs = new THREE.InstancedMesh(new Parts().ball(1, '#e9e4ee', {}, 1).build(), P, PUFFS);
  puffs.name = 'scenery:smoke';
  addStatic(puffs);
  const chimney = ctx.lodgeAt ? { x: ctx.lodgeAt.x, y: pageY + 10.5, z: ctx.lodgeAt.z } : null;
  if (!chimney) puffs.count = 0;

  const g4 = new THREE.Matrix4();
  onUpdate((dt, time, camera) => {
    for (let k = 0; k < cloudState.length; k++) {
      const c = cloudState[k];
      // Hung cards turn on their string to face the reader: edge-on they read as slivers.
      const yaw = camera ? Math.atan2(camera.position.x - c.x, camera.position.z - c.z) : c.yaw;
      q.setFromAxisAngle(v3.set(0, 1, 0), yaw);
      m4.compose(v3.set(c.x, c.y, c.z), q, one.set(c.sc, c.sc, c.sc));
      clouds.setMatrixAt(k, m4);
      strings.setMatrixAt(k, m4);
    }
    clouds.instanceMatrix.needsUpdate = true;
    strings.instanceMatrix.needsUpdate = true;
    if (chimney) {
      for (let k = 0; k < PUFFS; k++) {
        const g = ((time * 0.28 + k / PUFFS) % 1);
        const sc = 0.5 + g * 2.6;
        m4.compose(v3.set(chimney.x + Math.sin(k * 2.1 + time * 0.5) * g * 2 + g * 5, chimney.y + g * 16, chimney.z + g * 2), q.identity(), one.set(sc, sc * 0.8, sc));
        puffs.setMatrixAt(k, m4);
      }
      puffs.instanceMatrix.needsUpdate = true;
    }
    if (cableLine && cableLine.length > 1) {
      const segs = cableLine.length - 1;
      for (let k = 0; k < 4; k++) {
        const f = ((time * 0.018 + k / 4) % 1);
        const u = f < 0.5 ? f * 2 : 2 - f * 2;       // up and back down
        const pos = u * segs, i = Math.min(segs - 1, Math.floor(pos)), w = pos - i;
        const a = cableLine[i], b = cableLine[i + 1];
        const yaw = Math.atan2(b[0] - a[0], b[2] - a[2]);
        q.setFromAxisAngle(v3.set(0, 1, 0), yaw + Math.sin(time * 1.3 + k) * 0.03);
        g4.compose(v3.set(a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w), q, one.set(1, 1, 1));
        gondola.setMatrixAt(k, g4);
      }
      gondola.instanceMatrix.needsUpdate = true;
    }
  });
}
