// Chapter 4 — Yazı Masası. The race leaves the book: karts are tiny, the desk is huge. The
// grid sits on the open book, a ruler bridges to a notebook stack, the coffee mug steams in
// the first bend, the road crosses an open notebook's ruled page, paper clips and erasers line
// the chicane, pencils stand like a forest round the cup, the lamp leans over the road with a
// pool of light, and the reader's room rises far behind.
import { circlePts, blobPts, roundRectPts } from '../kit.js';

const EDGE = '#fbf6e9';

export function build(ctx) {
  const { THREE, Parts, mats, popups, pageY, rng, trackPoint, decor, addStatic, onUpdate,
    standingOK, samples: s, N, L, mixHex, theme, bandGap } = ctx;
  const P = mats.paper;
  const E = (c, o) => mats.emissive(c, o);
  const t0 = (t) => ((t % 1) + 1) % 1;
  const mid = (a, b) => t0(a + t0(b - a) / 2);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < N; i++) { minX = Math.min(minX, s.px[i]); maxX = Math.max(maxX, s.px[i]); minZ = Math.min(minZ, s.pz[i]); maxZ = Math.max(maxZ, s.pz[i]); }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const rad = Math.max(maxX - cx, maxZ - cz);
  const statics = new Parts();          // big static desk objects, one mesh
  const prints = new Parts();           // flat prints on the desk, one mesh
  const lit = new Parts();              // emissive bits

  // ---------------------------------------------------------------- the open book (start)
  if (decor.book) {
    const [a, b] = decor.book;
    const A = trackPoint(t0(a)), B = trackPoint(t0(b));
    const top = Math.min(A.y, B.y) - 0.1;
    const yaw = Math.atan2(B.x - A.x, B.z - A.z);
    const len = Math.hypot(B.x - A.x, B.z - A.z) + 30;
    const w = 2 * (A.band + 30);
    const x = (A.x + B.x) / 2 + Math.sin(yaw) * 5, z = (A.z + B.z) / 2 + Math.cos(yaw) * 5;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    // Two page blocks either side of the spine, which runs along the road's left ((c, -sn) is
    // the left of heading `yaw`), so the second page opens away from the lap's infield.
    const spineOff = A.band + 6;
    const pageW = w;
    for (const side of [0, 1]) {
      const off = spineOff + (side ? pageW / 2 + 0.6 : -pageW / 2 - 0.6);
      const bx = x + c * off, bz = z - sn * off;
      statics.box(pageW, top - pageY - 0.9, len, '#efe4cc', { x: bx, y: pageY + 0.9, z: bz, ry: yaw });
      statics.box(pageW - 0.4, 0.08, len - 0.4, '#f7f0df', { x: bx, y: top - 0.04, z: bz, ry: yaw });
      for (let k = 1; k < 9; k++) {
        const yy = pageY + 0.9 + ((top - pageY - 0.9) * k) / 9;
        statics.box(pageW + 0.05, 0.05, len + 0.05, '#d9ccb0', { x: bx, y: yy, z: bz, ry: yaw });
      }
      // Printed text: giant words in rows (karts are tiny), printed on the top sheet.
      const rows = Math.floor((len - 16) / 4.2);
      for (let k = 0; k < rows; k++) {
        const along = -len / 2 + 8 + k * 4.2;
        const last = k % 9 === 8;                      // paragraph ends short
        let u = -pageW / 2 + 6 + (k % 9 === 0 ? 5 : 0);
        const end = pageW / 2 - 6 - (last ? pageW * 0.45 : 0);
        while (u < end - 2) {
          const ww = Math.min(end - u, 2.5 + rng() * 7);
          const cu = u + ww / 2;
          prints.flat(roundRectPts(ww, 1.5, 0.3, 1), '#8f8473', { x: bx + c * cu + sn * along, y: top + 0.06, z: bz - sn * cu + c * along, ry: yaw });
          u += ww + 1.6;
        }
      }
    }
    ctx.startGroundY = top + 0.04;
    statics.box(w * 2 + 4, 0.9, len + 6, '#8c2f2a', { x: x + c * spineOff, y: pageY, z: z - sn * spineOff, ry: yaw });
    statics.cyl(1.6, 1.6, len, '#8c2f2a', { x: x + c * spineOff, y: top - 1.2, z: z - sn * spineOff, rx: Math.PI / 2, ry: yaw }, 10);
    // A ribbon bookmark trailing onto the desk.
    prints.flat([[-0.9, 0], [0.9, 0], [0.9, 40], [0, 36], [-0.9, 40]], '#c8413b', { x: x + c * (spineOff) + sn * (len / 2), y: pageY + 0.95, z: z - sn * spineOff + c * (len / 2), ry: yaw });
  }

  // ---------------------------------------------------------------- ruler bridge and notebook stack
  if (decor.ruler) {
    const [a, b] = decor.ruler;
    const A = trackPoint(t0(a)), B = trackPoint(t0(b));
    const top = Math.min(A.y, B.y) - 0.1;
    const yaw = Math.atan2(B.x - A.x, B.z - A.z);
    const len = Math.hypot(B.x - A.x, B.z - A.z) + 24;
    const w = 2 * (A.band + 2);
    const x = (A.x + B.x) / 2, z = (A.z + B.z) / 2;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    statics.box(w, 0.9, len, '#e7c46b', { x, y: top - 0.9, z, ry: yaw });
    // centimetre ticks along both edges, long every fifth
    for (let k = 0; k <= 60; k++) {
      const along = -len / 2 + 2 + ((len - 4) * k) / 60;
      const tl = k % 5 === 0 ? 3.2 : 1.6;
      for (const e of [-1, 1]) {
        const off = e * (w / 2 - tl / 2 - 0.2);
        statics.box(tl, 0.04, 0.22, '#3b2f22', { x: x + c * off + sn * along, y: top + 0.005, z: z - sn * off + c * along, ry: yaw });
      }
    }
    statics.box(w + 0.1, 0.2, 0.8, '#b8943e', { x: x + sn * (len / 2), y: top - 0.9, z: z + c * (len / 2), ry: yaw });
  }
  if (decor.stack) {
    const [a] = decor.stack;
    const A = trackPoint(t0(a)), B = trackPoint(t0(a + 26 / L));
    const top = A.y - 0.1;
    const cols = ['#4d7fc4', '#e8534a', '#7cc27a', '#f2c14e'];
    const yaw = Math.atan2(B.x - A.x, B.z - A.z);
    const x = (A.x + B.x) / 2, z = (A.z + B.z) / 2;
    for (let k = 0; k < 4; k++) {
      const h = (top - pageY) / 4;
      statics.box(2 * (A.band + 8) - k * 2, h - 0.1, 40 - k * 2, cols[k], { x: x + (rng() - 0.5) * 2, y: pageY + k * h, z: z + (rng() - 0.5) * 2, ry: yaw + (rng() - 0.5) * 0.08 });
      statics.box(2 * (A.band + 8) - k * 2 - 0.4, 0.1, 40 - k * 2 - 0.4, '#f7f0df', { x: x, y: pageY + (k + 1) * h - 0.2, z, ry: yaw });
    }
  }

  // ---------------------------------------------------------------- coffee mug with steam
  let mugAt = null;
  if (decor.mug) {
    const [a, b] = decor.mug;
    // The bend's centre: offset from its middle sample toward the inside.
    const pm = trackPoint(mid(a, b));
    const inside = (() => {
      const pa = trackPoint(t0(a)), pb = trackPoint(t0(b));
      const mx = (pa.x + pb.x) / 2 - pm.x, mz = (pa.z + pb.z) / 2 - pm.z;
      const l = Math.hypot(mx, mz) || 1;
      return [mx / l, mz / l];
    })();
    const R = 16;
    const x = pm.x + inside[0] * (pm.band + R + 6), z = pm.z + inside[1] * (pm.band + R + 6);
    mugAt = { x, z, R, top: pageY + 26 };
    const mug = new Parts()
      .cyl(R, R * 0.95, 26, '#f4efe6', {}, 24)
      .cyl(R - 1.2, R - 1.2, 0.6, '#5b3a24', { y: 24.2 }, 24)
      .cyl(R + 0.2, R + 0.2, 3, '#4d7fc4', { y: 17 }, 24)
      .add(new THREE.TorusGeometry(8, 2.2, 6, 14, Math.PI * 1.1), '#f4efe6', { x: 0, y: 13, z: -R - 3.5, rz: -Math.PI * 0.05, ry: Math.PI / 2 })
      .card(roundRectPts(9, 9, 0.8), 0.3, '#ffe45c', '#f2c14e', { y: 7, z: R + 0.15, rx: -0.03, rz: 0.08 });
    const mugType = popups.addType('mug', [{ geometry: mug.build(), material: P, cast: true }], { kind: 'volume', tab: false });
    popups.add(mugType, x, pageY, z, Math.atan2(pm.x - x, pm.z - z), 1, 1, 1, { s: pm.s - 40, size: 26 });
  }
  const steamGeo = new Parts().sheet(blobPts([[0, 0, 2.2], [1.8, 2.5, 1.8], [-0.4, 5, 1.5], [1.2, 7, 1.1]], 26), '#ffffff').build();
  const STEAM = 8;
  const steam = new THREE.InstancedMesh(steamGeo, E('#fdf8ef', { transparent: true, opacity: 0.8 }), STEAM);
  steam.name = 'scenery:steam';
  if (!mugAt) steam.count = 0;
  addStatic(steam);

  // ---------------------------------------------------------------- open notebook under the road
  if (decor.notebook) {
    const [a, b] = decor.notebook;
    const A = trackPoint(t0(a)), B = trackPoint(t0(b));
    const yaw = Math.atan2(B.x - A.x, B.z - A.z);
    const len = Math.hypot(B.x - A.x, B.z - A.z) + 40;
    const w = 150;
    const x = (A.x + B.x) / 2, z = (A.z + B.z) / 2;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const y = pageY + 0.04;
    prints.flat(roundRectPts(w, len, 2), '#fbf8f0', { x, y, z, ry: yaw });
    for (let k = 0; k < Math.floor(len / 5); k++) {
      const along = -len / 2 + 6 + k * 5;
      prints.flat(roundRectPts(w - 6, 0.35, 0.1, 1), '#9cc3e6', { x: x + sn * along, y: y + 0.01, z: z + c * along, ry: yaw });
    }
    const margin = -w / 2 + 16;
    prints.flat(roundRectPts(0.4, len - 4, 0.1, 1), '#e8534a', { x: x + c * margin, y: y + 0.015, z: z - sn * margin, ry: yaw });
    for (let k = 0; k < 12; k++) {
      const along = -len / 2 + 8 + ((len - 16) * k) / 11;
      prints.flat(circlePts(1.3, 10), '#d9ccb0', { x: x + c * (-w / 2 + 5) + sn * along, y: y + 0.015, z: z - sn * (-w / 2 + 5) + c * along });
    }
  }

  // ---------------------------------------------------------------- props that pop up
  const eraser = popups.addType('eraser', [{ geometry: new Parts()
    .box(9, 3, 4.5, '#f2a7b8')
    .box(9.02, 3.02, 1.8, '#4d7fc4', { z: 1.35 })
    .build(), material: P, cast: true }], { kind: 'volume' });
  const pencilGeo = (col) => new Parts()
    .cyl(1.1, 1.1, 30, col, {}, 6)
    .cone(1.1, 4.5, '#f1d2a4', { y: 30 }, 6)
    .cone(0.42, 1.7, '#2d2a32', { y: 32.8 }, 6)
    .cyl(1.12, 1.12, 2.2, '#c9ccd4', { y: -0.01 }, 6)
    .cyl(1.08, 1.08, 2.5, '#f2a7b8', { y: -2.5 }, 6);
  const pencilTypes = ['#f2c14e', '#e8534a', '#4d7fc4', '#7cc27a'].map((col, k) => popups.addType(`pencil${k}`, [{ geometry: pencilGeo(col).build(), material: P, cast: true }], { kind: 'volume' }));
  const clip = popups.addType('clip', [{ geometry: (() => {
    const p = new Parts();
    const loop = (w, h, yy) => {
      const pts = roundRectPts(w, h, Math.min(w, h) / 2 - 0.01, 6);
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length];
        if (k === pts.length - 1) continue;
        p.strip([a[0], yy, a[1]], [b[0], yy, b[1]], 0.7, '#b9bcc6');
      }
    };
    loop(9, 30, 0.35); loop(6, 22, 0.35); loop(3.2, 15, 0.35);
    return p.build();
  })(), material: P }], { tab: false, flutter: false });
  const ball = popups.addType('paperball', [{ geometry: new Parts().ball(3.2, '#f7f3ea', { y: 2.8 }, 1).build(), material: P, cast: true }], { kind: 'volume', tab: false });
  const cup = popups.addType('pencilcup', [{ geometry: (() => {
    const p = new Parts().cyl(9, 9, 20, '#3f6fb5', {}, 16).cyl(8.2, 8.2, 0.5, '#2b4d80', { y: 19.8 }, 16);
    const cols = ['#f2c14e', '#e8534a', '#7cc27a', '#b57bd6', '#f08a24'];
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2, r = 4.5;
      const tilt = 0.18 + (k % 3) * 0.06;
      p.cyl(0.9, 0.9, 30, cols[k % 5], { x: Math.cos(a) * r, y: 4, z: Math.sin(a) * r, rx: Math.sin(a) * tilt, rz: -Math.cos(a) * tilt }, 6);
      const tipY = 4 + 30 * Math.cos(tilt);
      p.cone(0.9, 3.6, '#f1d2a4', { x: Math.cos(a) * (r + 30 * Math.sin(tilt)), y: tipY, z: Math.sin(a) * (r + 30 * Math.sin(tilt)), rx: Math.sin(a) * tilt, rz: -Math.cos(a) * tilt }, 6);
    }
    return p.build();
  })(), material: P, cast: true }], { kind: 'volume', tab: false });

  if (decor.erasers) {
    const [a, b] = decor.erasers;
    for (let k = 0; k < 6; k++) {
      const p = trackPoint(t0(a + (t0(b - a) * k) / 5), 0);
      const sg = k % 2 ? 1 : -1;
      const lat = sg * (p.band + 6 + rng() * 10);
      const x = p.x + p.hx * lat, z = p.z + p.hz * lat;
      if (standingOK(x, z, 5.5)) popups.add(eraser, x, pageY, z, rng() * 6.28, 1, 1, 1, { s: p.s, tint: rng() < 0.5 ? '#ffffff' : '#fff0cc' });
    }
  }
  if (decor.clip) {
    const [a, b] = decor.clip;
    for (let k = 0; k < 5; k++) {
      const p = trackPoint(t0(a + (t0(b - a) * k) / 4), 0);
      const sg = k % 2 ? 1 : -1;
      const lat = sg * (p.band + 18);
      const x = p.x + p.hx * lat, z = p.z + p.hz * lat;
      if (standingOK(x, z, 15)) popups.add(clip, x, pageY, z, rng() * 6.28, 1, 1, 1, { s: p.s, alwaysUp: true });
    }
  }
  if (decor.pencils) {
    const [a, b] = decor.pencils;
    const pm = trackPoint(mid(a, b));
    const pa = trackPoint(t0(a)), pb = trackPoint(t0(b));
    // Outside of the hairpin: away from the midpoint of its two ends.
    const ox = pm.x - (pa.x + pb.x) / 2, oz = pm.z - (pa.z + pb.z) / 2, ol = Math.hypot(ox, oz) || 1;
    const x = pm.x + (ox / ol) * (pm.band + 16), z = pm.z + (oz / ol) * (pm.band + 16);
    if (standingOK(x, z, 12)) popups.add(cup, x, pageY, z, rng() * 6.28, 1, 1, 1, { s: pm.s - 30, size: 30 });
  }
  // Pencil forest: upright pencils along the lamp straight and round the hairpin.
  for (const range of [decor.lamp, decor.pencils].filter(Boolean)) {
    const [a, b] = range;
    for (let k = 0; k < 16; k++) {
      const p = trackPoint(t0(a + (t0(b - a) * k) / 15), 0);
      for (const sg of [-1, 1]) {
        if (rng() < 0.3) continue;
        const lat = sg * (p.band + 3 + rng() * 25);
        const x = p.x + p.hx * lat, z = p.z + p.hz * lat;
        if (!standingOK(x, z, 1.5)) continue;
        const ty = pencilTypes[Math.floor(rng() * pencilTypes.length)];
        const sc = 0.7 + rng() * 0.5;
        popups.add(ty, x, pageY + 2.5 * sc, z, rng() * 6.28, sc, sc, sc, { s: p.s });
      }
    }
  }
  for (let k = 0; k < 14; k++) {
    const p = trackPoint(rng(), 0);
    const sg = rng() < 0.5 ? -1 : 1;
    const lat = sg * (p.band + 8 + rng() * 60);
    const x = p.x + p.hx * lat, z = p.z + p.hz * lat;
    const sc = 0.8 + rng() * 0.8;
    if (standingOK(x, z, 3.2 * sc)) popups.add(ball, x, pageY, z, rng() * 6.28, sc, sc * 0.85, sc, { s: p.s });
  }

  // ---------------------------------------------------------------- desk lamp over the road
  let lampPool = null;
  if (decor.lamp) {
    const [a, b] = decor.lamp;
    const pm = trackPoint(mid(a, b));
    const side = 1;
    const bx = pm.x + pm.hx * side * (pm.band + 20), bz = pm.z + pm.hz * side * (pm.band + 20);
    const hx = pm.x, hz = pm.z, hy = pageY + 34;
    const yaw = Math.atan2(hx - bx, hz - bz);
    const reach = Math.hypot(hx - bx, hz - bz);
    const lamp = new Parts()
      .cyl(12, 13, 2.4, '#2d2a32', {}, 20)
      .cyl(2.2, 2.6, 3, '#3d3a44', { y: 2.4 }, 10);
    const elbow = [0, 44, reach * 0.35];
    lamp.strip([0, 5, 0], elbow, 2.2, '#3d3a44');
    lamp.strip(elbow, [0, 36, reach], 2.0, '#3d3a44');
    lamp.ball(2.4, '#2d2a32', { x: elbow[0], y: elbow[1], z: elbow[2] });
    lamp.cone(7, 9, '#e8534a', { x: 0, y: 27, z: reach }, 16);   // shade: wide end down, apex at the arm
    const lampType = popups.addType('lamp', [{ geometry: lamp.build(), material: P, cast: true }], { kind: 'volume', tab: false });
    popups.add(lampType, bx, pageY, bz, yaw, 1, 1, 1, { s: trackPoint(t0(a)).s, size: 40 });
    lit.cyl(5.6, 5.6, 0.3, '#ffffff', { x: hx, y: hy - 7.2, z: hz }, 16);
    lampPool = { x: hx, z: hz, y: pm.y + 0.1 };
    void hy;
  }
  if (lampPool) {
    const pool = new THREE.Mesh(new Parts().flat(circlePts(30, 36), '#ffffff').build(), E('#fff1b8', { transparent: true, opacity: 0.28 }));
    pool.position.set(lampPool.x, lampPool.y, lampPool.z);
    pool.name = 'scenery:lampPool';
    addStatic(pool);
  }

  // ---------------------------------------------------------------- desk clutter prints
  for (let k = 0; k < 10; k++) {
    const x = minX - 100 + rng() * (maxX - minX + 200), z = minZ - 100 + rng() * (maxZ - minZ + 200);
    const w = 16 + rng() * 10;
    if (bandGap(x, z, w + 40) < w) continue;
    const col = ['#ffe45c', '#f7a8c4', '#9fd6f2', '#b8e0b0'][k % 4];
    prints.flat(roundRectPts(w, w, 0.6), col, { x, y: pageY + 0.05, z, ry: rng() * 0.6 - 0.3 });
    prints.flat(roundRectPts(w * 0.7, 0.5, 0.2, 1), mixHex(col, '#2d2a32', 0.35), { x, y: pageY + 0.06, z: z - w * 0.2, ry: 0 });
  }
  for (let k = 0; k < 8; k++) {
    const x = minX - 80 + rng() * (maxX - minX + 160), z = minZ - 80 + rng() * (maxZ - minZ + 160);
    if (bandGap(x, z, 40) < 8) continue;
    statics.cyl(5, 5, 0.8, '#d9b04a', { x, y: pageY, z }, 18);
    statics.cyl(3.6, 3.6, 0.1, '#c49a3a', { x, y: pageY + 0.8, z }, 18);
  }
  // A pen lying across the desk.
  {
    let x = cx + rad * 0.2, z = cz - rad * 0.9;
    for (let tries = 0; tries < 20 && bandGap(x, z, 90) < 30; tries++) { x += 25; z -= 15; }
    statics.cyl(1.6, 1.6, 70, '#2d2a32', { x, y: pageY + 1.6, z, rz: Math.PI / 2, ry: 0.4 }, 10);
    statics.cyl(1.7, 1.7, 14, '#c9ccd4', { x: x + Math.cos(0.4) * 34, y: pageY + 1.6, z: z - Math.sin(0.4) * 34, rz: Math.PI / 2, ry: 0.4 }, 10);
  }

  // ---------------------------------------------------------------- the room (stays up)
  const back = new Parts();
  const ringR = rad + 260;
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.3;
    const x = cx + Math.cos(a) * ringR, z = cz + Math.sin(a) * ringR;
    const yaw = Math.atan2(cx - x, cz - z);
    const W = 2 * ringR + 12;             // square room: neighbouring walls meet at the corners
    const tr = (dx, dy, dz = 0) => ({ x: x + Math.cos(yaw) * dx + Math.sin(yaw) * dz, y: pageY - 60 + dy, z: z - Math.sin(yaw) * dx + Math.cos(yaw) * dz, ry: yaw });
    back.card([[-W / 2, 0], [W / 2, 0], [W / 2, 520], [-W / 2, 520]], 3, '#e9d7b8', EDGE, tr(0, 0));
    for (let st = -W / 2 + 20; st < W / 2; st += 40) back.card([[-3, 0], [3, 0], [3, 520], [-3, 520]], 1, '#e2cca7', '#e2cca7', tr(st, 0, 1.6));
    if (k === 0) {
      back.card(roundRectPts(260, 200, 6), 1, '#6a4a3a', EDGE, tr(0, 200, 2));
      back.card(roundRectPts(240, 180, 4), 1, mixHex(theme.skyBottom, '#ffffff', 0.15), EDGE, tr(0, 200, 3));
      back.card(roundRectPts(8, 180, 1), 1, '#6a4a3a', EDGE, tr(0, 200, 3.5));
      back.card(roundRectPts(240, 8, 1), 1, '#6a4a3a', EDGE, tr(0, 200, 3.5));
      back.card(blobPts([[0, 0, 18], [14, 10, 14], [-12, 8, 12]], 20), 1, '#f7e1a8', '#f7e1a8', tr(60, 250, 4));
      for (const sd of [-1, 1]) back.card([[-24, 0], [24, 0], [18, 230], [-30, 230]], 2, '#c8413b', EDGE, tr(sd * 150, 90, 4));
    } else if (k === 1) {
      // bookshelf
      back.card(roundRectPts(300, 260, 4), 2, '#7a5236', EDGE, tr(0, 190, 3));
      for (let sh = 0; sh < 3; sh++) {
        let bx = -140;
        while (bx < 140) {
          const bw = 8 + rng() * 10, bh = 50 + rng() * 25;
          back.card([[0, 0], [bw, 0], [bw, bh], [0, bh]], 1, ['#4d7fc4', '#e8534a', '#7cc27a', '#f2c14e', '#b57bd6', '#e9d7b8'][Math.floor(rng() * 6)], EDGE, tr(bx, 70 + sh * 85, 5));
          bx += bw + 1;
        }
      }
    } else {
      back.card([[-30, 0], [30, 0], [22, 60], [-22, 60]], 2, '#c96f45', EDGE, tr((k - 2.5) * 200, 60, 4));
      for (let lf = 0; lf < 7; lf++) {
        const ang = -1.2 + lf * 0.4;
        back.card([[0, 0], [14, 30], [0, 90], [-14, 30]], 1, lf % 2 ? '#5f9e4f' : '#4d8a42', EDGE, { ...tr((k - 2.5) * 200 + Math.sin(ang) * 20, 115, 5), rz: ang * 0.5 });
      }
    }
  }
  const backGeo = back.build();
  addStatic(new THREE.Mesh(backGeo, mats.evenLight(backGeo)));

  const st = addStatic(new THREE.Mesh(statics.build(), P));
  st.castShadow = true; st.receiveShadow = true;
  addStatic(new THREE.Mesh(prints.build(), P)).receiveShadow = true;
  if (lit.list.length) addStatic(new THREE.Mesh(lit.build(), E('#fff1b8')));

  // ---------------------------------------------------------------- per-frame: steam
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), one = new THREE.Vector3();
  onUpdate((dt, time, camera) => {
    if (!mugAt) return;
    for (let k = 0; k < STEAM; k++) {
      const g = (time * 0.12 + k / STEAM) % 1;
      const sc = 1.2 + g * 2.2 * (1 - g * 0.5);
      const yaw = camera ? Math.atan2(camera.position.x - mugAt.x, camera.position.z - mugAt.z) : 0;
      q.setFromAxisAngle(v3.set(0, 1, 0), yaw + Math.sin(k * 1.7) * 0.4);
      m4.compose(v3.set(mugAt.x + Math.sin(time * 0.6 + k) * 3 * g, mugAt.top + g * 30, mugAt.z + Math.cos(time * 0.5 + k * 2) * 3 * g), q, one.set(sc * (1 - g * 0.3), sc, sc));
      steam.setMatrixAt(k, m4);
    }
    steam.instanceMatrix.needsUpdate = true;
  });
}
