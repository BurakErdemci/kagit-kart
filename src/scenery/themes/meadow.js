// Chapter 1 — Papatya Çayırı. A spring morning printed in soft greens: daisy and poppy fields
// that stand up in waves, cross-card trees, windmills whose sails turn, a covered bridge that
// closes over the road like a paper tent, beehives, a picnic, a scarecrow, paper hills
// under the raised road, a stream, and clouds hung on strings.
import { circlePts, flowerPts, leafPts, blobPts, archPts, roundRectPts, starPts } from '../kit.js';

const EDGE = '#fbf6e6';   // white card core on every cut edge
const INK = '#2e3329';

export function build(ctx) {
  const { THREE, Parts, mats, popups, scatter, cluster, pageY, rng, trackPoint, decor, addStatic, onUpdate,
    standingOK, samples: s, N, L, mixHex, theme } = ctx;
  const P = mats.paper;

  // ---------------------------------------------------------------- prop types
  // Flowers come by the hundred: wall-less sheets keep them near 120 triangles each.
  const daisy = popups.addType('daisy', [{ geometry: new Parts()
    .box(0.14, 1.9, 0.1, '#4e8a3a')
    .sheet(leafPts(0.6, 0.24, 4), '#6aa84f', { x: 0.05, y: 0.55, rz: 0.5 })
    .sheet(flowerPts(10, 0.85, 0.3, 3), '#ffffff', { y: 2.2 })
    .card(circlePts(0.3, 8), 0.16, '#f5c33b', '#e7a92a', { y: 2.2, z: 0.02 })
    .build(), material: P }]);

  const poppy = popups.addType('poppy', [{ geometry: new Parts()
    .box(0.12, 1.5, 0.1, '#4e8a3a')
    .sheet(leafPts(0.5, 0.2, 4), '#6aa84f', { x: 0.05, y: 0.5, rz: 0.6 })
    .sheet(flowerPts(5, 0.7, 0.35, 4), '#e24b3b', { y: 1.75 })
    .card(circlePts(0.2, 6), 0.14, '#2d2a32', '#2d2a32', { y: 1.75, z: 0.02 })
    .build(), material: P }]);

  const crown = blobPts([[-1.6, 0, 1.9], [1.5, 0.2, 2.0], [0, 1.4, 2.3], [0, -0.9, 1.9]]);
  const tree = popups.addType('tree', [{ geometry: new Parts()
    .box(0.7, 3.4, 0.7, '#8a5a3b')
    .card(crown, 0.3, '#6aae55', EDGE, { y: 5.6 })
    .card(crown, 0.3, '#58964a', EDGE, { y: 5.4, ry: Math.PI / 2, sx: 0.9 })
    .build(), material: P, cast: true }], { kind: 'volume' });

  const cottage = popups.addType('cottage', [{ geometry: new Parts()
    .box(7, 4.2, 5.5, '#f3e2c4')
    .roof(7.8, 3.2, 6.2, '#c75b44', { y: 4.2, ry: Math.PI / 2, sx: 1 }, 0)
    .box(0.9, 2.6, 0.9, '#9a8f86', { x: 1.8, y: 5.4 })
    .box(1.3, 2.2, 0.2, '#7a4a2e', { z: 2.8 })
    .box(1.1, 1.1, 0.15, '#4f6d96', { x: -2.1, y: 2.0, z: 2.8 })
    .box(1.1, 1.1, 0.15, '#4f6d96', { x: 2.1, y: 2.0, z: 2.8 })
    .card(roundRectPts(1.6, 0.5, 0.2), 0.12, '#e8534a', EDGE, { x: -2.1, y: 1.25, z: 2.85 })
    .card(roundRectPts(1.6, 0.5, 0.2), 0.12, '#e8534a', EDGE, { x: 2.1, y: 1.25, z: 2.85 })
    .build(), material: P, cast: true }], { kind: 'volume' });

  const hive = popups.addType('hive', [{ geometry: new Parts()
    .box(2.4, 0.5, 2.0, '#8a5a3b')
    .box(2.2, 0.9, 1.9, '#f4d35e', { y: 0.5 })
    .box(2.2, 0.9, 1.9, '#9ed2c6', { y: 1.4 })
    .box(2.2, 0.9, 1.9, '#f2a7a0', { y: 2.3 })
    .box(2.6, 0.3, 2.3, '#f6f1e3', { y: 3.2 })
    .box(1.0, 0.14, 0.1, '#2d2a32', { y: 0.72, z: 0.96 })
    .build(), material: P }], { kind: 'volume' });

  const scarecrow = popups.addType('scarecrow', [{ geometry: new Parts()
    .box(0.25, 5.0, 0.2, '#8a5a3b')
    .box(3.4, 0.22, 0.2, '#8a5a3b', { y: 3.5 })
    .card([[-1.3, 2.2], [1.3, 2.2], [1.05, 3.9], [-1.05, 3.9]], 0.14, '#5b7fb5', EDGE, { z: 0.14 })
    .card(roundRectPts(0.5, 0.5, 0.1), 0.1, '#e8534a', EDGE, { x: 0.5, y: 2.8, z: 0.23 })
    .card(circlePts(0.6, 12), 0.14, '#f2d9a6', EDGE, { y: 4.5, z: 0.14 })
    .card([[-1.1, 0], [1.1, 0], [0.5, 0.25], [0.2, 1.1], [-0.4, 1.0], [-0.5, 0.25]], 0.12, '#c9a15c', EDGE, { y: 4.95, z: 0.2 })
    .build(), material: P, cast: true }]);

  const basket = popups.addType('basket', [{ geometry: new Parts()
    .box(1.6, 0.9, 1.1, '#b98a4e')
    .card(archPts(1.4, 0.8, 8), 0.1, '#8a5a3b', '#8a5a3b', { y: 0.9 })
    .box(0.5, 1.3, 0.5, '#f6f1e3', { x: 1.4 })
    .build(), material: P }], { kind: 'volume' });

  // Paper hills: two stacked arch flats, the back one taller and paler (a stage-set hill).
  const hillGeo = new Parts()
    .card(archPts(1.0, 1.0, 14), 0.02, '#b6d98f', EDGE, { z: -0.35, sx: 1.25, sy: 1.25 })
    .card(archPts(1.0, 0.8, 14), 0.02, '#94c46c', EDGE, { z: 0 })
    .build();
  const hill = popups.addType('hill', [{ geometry: hillGeo, material: mats.evenLight(hillGeo) }], { kind: 'card', flutter: false, tab: false });

  // Windmill tower (volume) + sails (their own InstancedMesh, driven from the tower's pose).
  const mill = popups.addType('windmill', [{ geometry: new Parts()
    .cyl(2.1, 3.0, 10, '#efe0c2', {}, 8)
    .cyl(3.6, 3.6, 0.35, '#b98a5e', { y: 5.2 }, 8)
    .cone(3.3, 3.4, '#d4553f', { y: 10 }, 8)
    .box(1.4, 2.3, 0.4, '#7a4a2e', { z: 2.85 })
    .box(0.9, 1.1, 0.3, '#3b4a6b', { y: 6.6, z: 2.45 })
    .build(), material: P, cast: true }], { kind: 'volume' });

  // ---------------------------------------------------------------- placement
  const t0 = (t) => ((t % 1) + 1) % 1;
  const tint = (r) => (r() < 0.5 ? '#ffffff' : r() < 0.5 ? '#fff3f6' : '#f3f7ff');

  // Giant daisies (3–5 m): the chapter's signature, thick near the road so the wave reads.
  scatter(daisy, { every: 5, gap: [1, 30], r: 1.2, scale: [1.3, 2.0], tint, chance: 0.9 });
  scatter(daisy, { every: 9, gap: [20, 90], r: 1.2, scale: [1.5, 2.3], tint, chance: 0.85 });
  scatter(poppy, { every: 9, gap: [2, 50], r: 1.0, scale: [1.2, 1.8], chance: 0.8 });
  scatter(tree, { every: 32, gap: [16, 95], r: 3, scale: [0.85, 1.35], face: 'random' });
  scatter(tree, { every: 55, gap: [60, 160], r: 3, scale: [1.1, 1.6], face: 'random' });

  // Daisy fields at the chapter's open spaces.
  for (const t of [decor.windmills?.[0], decor.picnic, decor.village, decor.hives].filter((v) => v != null)) {
    for (const sg of [-1, 1]) {
      const p = trackPoint(t0(t), 0);
      const lat = sg * (p.band + 26);
      cluster(daisy, p.x + p.hx * lat, p.z + p.hz * lat, 24, 45, { r: 1.2, scale: [1.4, 2.2], tint, s: p.s });
    }
  }

  const windmillIdx = [];
  for (const [k, t] of (decor.windmills || []).entries()) {
    const p = trackPoint(t0(t), 0);
    for (const extra of [18, 30, 44]) {
      const sg = k % 2 ? 1 : -1;
      const lat = sg * (p.band + extra + 3.5);
      const x = p.x + p.hx * lat, z = p.z + p.hz * lat;
      if (!standingOK(x, z, 4)) continue;
      const sc = 1.05 + rng() * 0.25;
      windmillIdx.push({ i: popups.add(mill, x, pageY, z, Math.atan2(p.x - x, p.z - z), sc, sc, sc, { s: p.s }), spin: 0.7 + rng() * 0.5, phase: rng() * 6 });
      break;
    }
  }

  if (decor.hives != null) {
    const p = trackPoint(t0(decor.hives), 0);
    for (let k = 0; k < 7; k++) {
      const q = trackPoint(t0(decor.hives + (k - 3) * 9 / L), 0);
      const lat = -(q.band + 5 + (k % 2) * 3);
      const x = q.x + q.hx * lat, z = q.z + q.hz * lat;
      if (standingOK(x, z, 1.6)) popups.add(hive, x, pageY, z, Math.atan2(q.x - x, q.z - z) + (rng() - 0.5) * 0.4, 1, 1, 1, { s: q.s });
    }
    void p;
  }

  for (const [k, t] of (decor.scarecrows || []).entries()) {
    const p = trackPoint(t0(t), 0);
    const lat = (k % 2 ? 1 : -1) * (p.band + 14);
    const x = p.x + p.hx * lat, z = p.z + p.hz * lat;
    if (standingOK(x, z, 2)) popups.add(scarecrow, x, pageY, z, Math.atan2(p.x - x, p.z - z), 1.1, 1.1, 1.1, { s: p.s });
  }

  if (decor.village != null) {
    for (let k = 0; k < 6; k++) {
      const p = trackPoint(t0(decor.village + (k * 26 - 20) / L), 0);
      const sg = k % 2 ? 1 : -1;
      const lat = sg * (p.band + 12 + rng() * 14);
      const x = p.x + p.hx * lat, z = p.z + p.hz * lat;
      if (standingOK(x, z, 5)) popups.add(cottage, x, pageY, z, Math.atan2(p.x - x, p.z - z), 1, 1, 1, {
        tint: ['#ffffff', '#fff1e6', '#f1f6ff'][k % 3], s: p.s,
      });
    }
  }

  // Paper hills beside every raised stretch.
  ctx.flatsBesideRaised(hill, { every: 34, minLift: 2.5, r: [16, 26], extra: [2, 5], tints: ['#ffffff', '#eef6e2'] });

  // ---------------------------------------------------------------- covered bridge (V-fold tent)
  if (decor.bridge) {
    const [b0, b1] = decor.bridge;
    const pm = trackPoint(t0((b0 + b1) / 2), 0);
    const len = Math.max(30, (t0(b1 - b0)) * L + 8);
    const half = pm.band + 0.4;            // the fence line
    const rise = 3.2, wallH = 5.2;
    const roofLen = Math.hypot(half, rise);
    // Town-lattice truss: rails, posts and crossed slats you can see the meadow through.
    const halfGeo = new Parts()
      .box(len, 0.6, 0.5, '#9c3f33', { y: 0.2, z: 0.25 })
      .box(len + 1, 0.6, 0.6, '#9c3f33', { y: wallH - 0.4, z: 0.3 });
    const bays = Math.round(len / 5.5);
    for (let k = 0; k <= bays; k++) {
      const x = -len / 2 + (k * len) / bays;
      halfGeo.box(0.5, wallH, 0.5, '#b5473a', { x, z: 0.25 });
      if (k < bays) {
        const w = len / bays, diag = Math.hypot(w, wallH - 0.6), ang = Math.atan2(wallH - 0.6, w);
        halfGeo.box(diag, 0.28, 0.22, '#d9825f', { x: x + w / 2, y: 0.5 + (wallH - 0.6) / 2 - 0.14, z: 0.3, rz: ang });
        halfGeo.box(diag, 0.28, 0.22, '#d9825f', { x: x + w / 2, y: 0.5 + (wallH - 0.6) / 2 - 0.14, z: 0.3, rz: -ang });
      }
    }
    // Roof slab hinged at the wall top, rising to the ridge over the road centre.
    const pitch = Math.atan2(rise, half);
    halfGeo.box(len + 3, 0.35, roofLen + 0.6, '#a8683f', {
      y: wallH + 0.2 + Math.sin(pitch) * roofLen / 2, z: Math.cos(pitch) * roofLen / 2, rx: -pitch,
    });
    // Each half carries its quarter of the gable at both ends (rotated so x runs toward the road).
    const quarter = [[0, 0]];
    for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI / 2; quarter.push([Math.cos(a) * half, Math.sin(a) * (rise + 1.4)]); }
    for (const ex of [len / 2 + 0.2, -len / 2 - 0.2]) {
      halfGeo.card(quarter, 0.3, '#c55a48', EDGE, { x: ex, y: wallH, z: half, ry: Math.PI / 2 });
    }
    // No shadow: the roof would drop the whole interior into the halftone band.
    const bridgeHalf = popups.addType('coveredBridge', [{ geometry: halfGeo.build(), material: P, cast: false }], { kind: 'volume', tab: false });
    for (const sg of [-1, 1]) {
      const x = pm.x + pm.hx * sg * half, z = pm.z + pm.hz * sg * half;
      popups.add(bridgeHalf, x, pm.y - 0.05, z, Math.atan2(pm.x - x, pm.z - z), 1, 1, 1, { size: 8, s: pm.s });
    }
    // The two halves are one tent: if either must stay up (its fold would cross a road), both do.
    if (bridgeHalf.items.some((it) => it.alwaysUp)) for (const it of bridgeHalf.items) it.alwaysUp = true;
  }

  // ---------------------------------------------------------------- ground prints (one mesh)
  const ground = new Parts();
  // Print layers above the page: fields 0.04, stream 0.07, small prints 0.08 (clear of depth
  // fighting at 300 m); roads here sit on raised bands, and fields keep a margin from them.
  const gy = pageY + 0.07;
  const fy = pageY + 0.04;
  fields(ctx, ground, fy);
  // Stream: through both crossings, perpendicular to the road at each, run out to the page edge.
  if (decor.stream) {
    const [ta, tb] = decor.stream.map(t0);
    const A = trackPoint(ta, 0), B = trackPoint(tb, 0);
    const pts = [];
    const push = (p, dir, dist) => pts.push([p.x + p.hx * dir * dist, p.z + p.hz * dir * dist]);
    // side of A facing B
    const sideAB = Math.sign((B.x - A.x) * A.hx + (B.z - A.z) * A.hz) || 1;
    const sideBA = Math.sign((A.x - B.x) * B.hx + (A.z - B.z) * B.hz) || 1;
    for (const dd of [260, 170, 90, 40]) push(A, -sideAB, dd);
    pts.push([A.x, A.z]);
    for (const dd of [40]) push(A, sideAB, dd);
    for (const dd of [40]) push(B, sideBA, dd);
    pts.push([B.x, B.z]);
    for (const dd of [40, 90, 170, 260]) push(B, -sideBA, dd);
    ribbon(ground, catmull(pts, 6), 7, '#7fb6de', gy);
    ribbon(ground, catmull(pts, 6), 2.2, '#a9d0ec', gy + 0.01);
  }
  // Flower patches and printed tufts.
  for (let k = 0; k < 90; k++) {
    const t = rng(), p = trackPoint(t, 0);
    const sg = rng() < 0.5 ? -1 : 1;
    const lat = sg * (p.band + 4 + rng() * 80);
    const x = p.x + p.hx * lat, z = p.z + p.hz * lat;
    if (ctx.bandGap(x, z) < 6) continue;
    const r = 3 + rng() * 5;
    const col = ['#b5d98a', '#a7cf7a', '#f1e6a8', '#e9c6d7'][k % 4];
    ground.flat(blobPts([[0, 0, r], [r * 0.8, r * 0.3, r * 0.7], [-r * 0.7, r * 0.4, r * 0.6]], 18), col, { x, y: gy + 0.01, z, ry: rng() * 6 });
  }
  // Picnic blanket.
  if (decor.picnic != null) {
    const p = trackPoint(t0(decor.picnic), 0);
    const lat = p.band + 14;
    const x = p.x + p.hx * lat, z = p.z + p.hz * lat;
    const yaw = Math.atan2(p.hx, p.hz);
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
      const u = (a - 2.5) * 1.3, v = (b - 2.5) * 1.3;
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      ground.flat(roundRectPts(1.3, 1.3, 0.05, 1), (a + b) % 2 ? '#e8534a' : '#fbf6e6', {
        x: x + u * c + v * sn, y: gy + 0.02, z: z - u * sn + v * c, ry: yaw,
      });
    }
    if (standingOK(x + 5, z + 3, 1.2)) popups.add(basket, x + 5, pageY, z + 3, yaw, 1, 1, 1, { s: p.s });
  }
  // A worn path across the rocket-cut infield, printed at the band's height.
  if (ctx.def.shortcut) {
    const sc = ctx.def.shortcut, sg = sc.side === 'left' ? -1 : 1;
    const A = trackPoint(t0(sc.from), 0), B = trackPoint(t0(sc.to), 0);
    const a = [A.x + A.hx * sg * A.hw, A.z + A.hz * sg * A.hw], b = [B.x + B.hx * sg * B.hw, B.z + B.hz * sg * B.hw];
    const mid = [(a[0] + b[0]) / 2 + (rng() - 0.5) * 4, (a[1] + b[1]) / 2 + (rng() - 0.5) * 4];
    const y = Math.max(A.y, B.y) + 0.02;
    ribbon(ground, catmull([a, mid, b], 8), 2.6, '#c9a86b', y);
    for (let k = 1; k < 8; k++) {
      const f = k / 8;
      ground.flat(circlePts(0.35, 6), '#a9884f', { x: a[0] + (b[0] - a[0]) * f, y: y + 0.01, z: a[1] + (b[1] - a[1]) * f });
    }
  }
  addStatic(new THREE.Mesh(ground.build(), P)).receiveShadow = true;

  // ---------------------------------------------------------------- backdrop hills (stay up)
  const cx = (samplesMin(s.px, N) + samplesMax(s.px, N)) / 2, cz = (samplesMin(s.pz, N) + samplesMax(s.pz, N)) / 2;
  const rad = Math.max(samplesMax(s.px, N) - cx, samplesMax(s.pz, N) - cz) + 150;
  const back = new Parts();
  const layers = [
    { r: rad, col: '#a3cb7f', h: [26, 48], w: [120, 200] },
    { r: rad + 90, col: '#bcd89d', h: [40, 70], w: [160, 260] },
    { r: rad + 190, col: '#d3e5bf', h: [55, 95], w: [220, 320] },
  ];
  for (const [li, ly] of layers.entries()) {
    const n = Math.round((Math.PI * 2 * ly.r) / (ly.w[0] * 0.7));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + li * 0.37 + rng() * 0.1;
      // Push out until the layer clears every road by its depth.
      let rr = ly.r;
      while (ctx.bandGap(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr, 300) < 200 + li * 90) rr += 20;
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      const w = ly.w[0] + rng() * (ly.w[1] - ly.w[0]), h = ly.h[0] + rng() * (ly.h[1] - ly.h[0]);
      back.card(archPts(w, h, 16), 1.2, mixHex(ly.col, theme.fog.color, li * 0.12), EDGE, { x, y: pageY - 0.5, z, ry: Math.atan2(cx - x, cz - z) });
      if (li === 0 && rng() < 0.5) {
        const tx = (rng() - 0.5) * w * 0.5;
        const top = Math.sqrt(Math.max(0, 1 - (2 * tx / w) ** 2)) * h;
        back.card(blobPts([[0, 0, 5], [4, 1, 4], [-4, 1, 4]], 18), 0.8, '#5f9e4f', EDGE, {
          x: x + Math.cos(a + Math.PI / 2) * tx, y: pageY + top + 3, z: z + Math.sin(a + Math.PI / 2) * tx, ry: Math.atan2(cx - x, cz - z),
        });
      }
    }
  }
  // Backdrop layers are lit evenly: facing away from the sun made them dark, and halftone
  // dots read as dirt at this size.
  const backGeo = back.build();
  addStatic(new THREE.Mesh(backGeo, mats.evenLight(backGeo)));

  // ---------------------------------------------------------------- sky: clouds on strings, paper sun
  // Clouds are unlit white card (shading bands made them look grey); strings are their own mesh.
  const cloudGeo = new Parts()
    .card(blobPts([[-6, 0, 5], [0, 2, 6.5], [6, 0, 5], [2.5, -1.5, 4.5], [-3, -1.5, 4]], 36), 1.2, '#ffffff', '#ffffff')
    .build();
  const clouds = new THREE.InstancedMesh(cloudGeo, mats.emissive('#fbfaf3'), 12);
  clouds.name = 'scenery:clouds';
  const strings = new THREE.InstancedMesh(new Parts().strip([0, 5, 0], [0, 180, 0], 0.25, '#6c6a72').build(), P, 12);
  strings.name = 'scenery:strings';
  addStatic(strings);
  const cloudState = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + rng() * 0.3, r = rad * (0.35 + rng() * 0.6);
    cloudState.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, y: pageY + 42 + rng() * 26, yaw: rng() * 6.28, ph: rng() * 6.28, sc: 1 + rng() * 0.8 });
  }
  addStatic(clouds);
  const sunDir = new THREE.Vector3(...theme.sun.dir).normalize();
  const sunGeo = new Parts()
    .card(starPts(14, 30, 22), 2, '#f7c948', '#f29f3b')
    .card(circlePts(19, 20), 3, '#fbe27a', '#f2b13b')
    .build();
  const sunMat = mats.unique('#ffffff', { vertexColors: true, halftone: false });
  sunMat.fog = false;
  const sun = addStatic(new THREE.Mesh(sunGeo, sunMat));
  sun.position.set(cx + sunDir.x * 470, pageY + Math.max(90, sunDir.y * 300), cz + sunDir.z * 470);
  sun.lookAt(cx, pageY + 40, cz);

  // ---------------------------------------------------------------- per-frame
  const sails = new THREE.InstancedMesh(sailGeometry(Parts), P, Math.max(1, windmillIdx.length));
  sails.name = 'scenery:sails';
  sails.castShadow = true;
  sails.count = windmillIdx.length;
  addStatic(sails);
  const pose = new THREE.Matrix4(), local = new THREE.Matrix4(), rot = new THREE.Matrix4();
  onUpdate((dt, time, camera) => {
    for (let k = 0; k < windmillIdx.length; k++) {
      const w = windmillIdx[k];
      popups.poseOf(mill, w.i, pose);
      local.makeTranslation(0, 9.3, 2.75);
      rot.makeRotationZ(w.phase + time * w.spin);
      sails.setMatrixAt(k, pose.multiply(local).multiply(rot));
    }
    sails.instanceMatrix.needsUpdate = true;
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
  });
  void INK;
}

function sailGeometry(Parts) {
  const p = new Parts().cyl(0.55, 0.55, 0.8, '#7a4a2e', { rx: Math.PI / 2, z: -0.4 }, 8);
  for (let k = 0; k < 4; k++) {
    const rz = (k * Math.PI) / 2;
    const c = Math.cos(rz), s = Math.sin(rz);
    const at = (u, v) => ({ x: u * c - v * s, y: u * s + v * c });
    p.box(0.3, 7.6, 0.2, '#7a4a2e', { ...at(0, 0), rz });
    const mid = at(0.95, 4.4);
    p.card([[-0.8, -3.0], [0.8, -3.0], [0.8, 3.0], [-0.8, 3.0]], 0.08, '#f6ecd6', '#d9c7a4', { x: mid.x, y: mid.y, z: 0.12, rz });
    for (let r = 0; r < 4; r++) {
      const bar = at(0.95, 2.0 + r * 1.6);
      p.box(1.7, 0.1, 0.1, '#7a4a2e', { x: bar.x, y: bar.y, z: 0.2, rz });
    }
  }
  return p.build();
}

// ------------------------------------------------------------------ helpers

// Patchwork of printed fields on the empty page, kept clear of the road bands.
function fields(ctx, parts, y) {
  const { samples: s, N, rng, bandGap } = ctx;
  const cols = ['#cfe6a6', '#bddc92', '#dcebb6', '#efe4a2', '#dccbe6', '#c6e2a9'];
  const minX = samplesMin(s.px, N) - 260, maxX = samplesMax(s.px, N) + 260;
  const minZ = samplesMin(s.pz, N) - 260, maxZ = samplesMax(s.pz, N) + 260;
  for (let gx = minX; gx < maxX; gx += 62) {
    for (let gz = minZ; gz < maxZ; gz += 62) {
      const x = gx + (rng() - 0.5) * 40, z = gz + (rng() - 0.5) * 40;
      const R = 26 + rng() * 26;
      if (bandGap(x, z, R + 80) < R + 5) continue;
      const k = Math.floor(rng() * cols.length);
      const circles = [];
      for (let c = 0; c < 4; c++) circles.push([(rng() - 0.5) * R, (rng() - 0.5) * R * 0.7, R * (0.45 + rng() * 0.25)]);
      const yaw = rng() * Math.PI;
      parts.flat(blobPts(circles, 22), cols[k], { x, y, z, ry: yaw });
      if (rng() < 0.45) {
        // furrows: short darker stripes across the middle of the field
        const dark = cols[k] === '#efe4a2' ? '#dcc970' : cols[k] === '#dccbe6' ? '#b9a2cf' : '#a9cf7f';
        for (let f = -3; f <= 3; f++) {
          const w = R * 0.55 * Math.sqrt(1 - (f / 4) ** 2);
          const off = f * R * 0.13;
          parts.flat([[-w, off - 0.5], [w, off - 0.5], [w, off + 0.5], [-w, off + 0.5]], dark, { x, y: y + 0.01, z, ry: yaw });
        }
      }
    }
  }
}

function samplesMin(a, n) { let m = Infinity; for (let i = 0; i < n; i++) m = Math.min(m, a[i]); return m; }
function samplesMax(a, n) { let m = -Infinity; for (let i = 0; i < n; i++) m = Math.max(m, a[i]); return m; }

function catmull(pts, perSeg) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// Flat ribbon of width w along a 2D polyline, printed on the page at height y.
function ribbon(parts, pts, w, color, y) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l * w / 2, nz = dx / l * w / 2;
    // two overlapping round-ended quads keep the joins closed
    parts.flat([[ax + nx, -(az + nz)], [bx + nx, -(bz + nz)], [bx - nx, -(bz - nz)], [ax - nx, -(az - nz)]], color, { y });
    parts.flat(circlePts(w / 2, 8, bx, -bz), color, { y });
  }
}
