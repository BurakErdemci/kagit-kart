// The cup ceremony on the book's page: a pop-up podium that erects like a paper box, the top three
// dropping onto their steps, paper confetti from two cannons and the sky. Built on first use and
// kept with the stage; visuals are per ceremony.
import * as THREE from 'three';
import { createKartVisual, ROSTER } from '../characters/characters.js';
import { mulberry32 } from '../core/rng.js';
import { PieceBuilder, createPopupBatch } from './popups.js';
import { paintPodium, toTexture } from './print.js';
import { BOOK, pageTop } from './stage.js';

// Place colours match the UI's --p1/--p2/--p3.
const STEPS = [
  { place: 2, color: '#7d97b8', h: 1.75, x: -3.2 },
  { place: 1, color: '#e3a623', h: 2.55, x: 0 },
  { place: 3, color: '#c8693a', h: 1.2, x: 3.2 },
];
const BW = 3.05, BD = 3.3, BZ = 1.2;
const CONFETTI = ['#e3a623', '#d9483b', '#5f7fa3', '#f2c14e', '#e56b6f', '#6f9a58', '#fbf6e9', '#8fb3d9'];
const MAX_CONFETTI = 260;

export const PODIUM = { z: BZ, steps: STEPS };

export function createPodium(game, stage) {
  const mats = game.materials;
  const group = new THREE.Group();
  group.name = 'cinematics:podium';

  // ---- blocks -------------------------------------------------------------------------------------
  // A block straddling the gutter reaches down to the lowest page point under it; its step height is
  // measured from the highest, so the steps read 1 > 2 > 3 whatever the page curve does.
  const geo = STEPS.map((s) => {
    let floor = Infinity, ref = -Infinity;
    for (let k = 0; k <= 12; k++) {
      const y = pageTop(s.x - BW / 2 + (BW * k) / 12);
      floor = Math.min(floor, y);
      ref = Math.max(ref, y);
    }
    const top = ref + s.h;
    return { floor, top, H: top - floor + 0.04 };
  });
  const cells = STEPS.map((s, i) => ({ n: s.place, color: s.color, aspect: BW / geo[i].H }));
  const painted = paintPodium(cells);
  const tex = stage.ownTex(toTexture(painted.canvas, game.renderer));
  const mat = stage.ownMat(mats.paper('#ffffff', { map: tex, vertexColors: true, unique: true }));
  const batch = createPopupBatch('cinematics:podium', mat);
  const blocks = STEPS.map((s, i) => {
    const b = new PieceBuilder();
    const g = geo[i];
    const r = painted.rects[i];
    b.box(BW, g.H, BD, s.color, { front: '#ffffff', top: '#fbf6e9', faceUV: (f) => (f === 4 ? r : painted.plain) });
    const piece = batch.add(b, { kind: 'box', x: s.x, y: g.floor - 0.04, z: BZ, yaw: 0, open: 0 });
    return { ...s, piece, top: g.top };
  });
  group.add(batch.build());

  // ---- confetti -------------------------------------------------------------------------------------
  const cGeo = stage.own(new THREE.PlaneGeometry(0.2, 0.3));
  const cMat = mats.paper('#ffffff', { side: THREE.DoubleSide, halftone: false });
  const confetti = new THREE.InstancedMesh(cGeo, cMat, MAX_CONFETTI);
  confetti.name = 'cinematics:confetti';
  confetti.frustumCulled = false;
  confetti.castShadow = false;
  confetti.receiveShadow = false;
  const parts = [];
  const tmpC = new THREE.Color();
  for (let i = 0; i < MAX_CONFETTI; i++) {
    parts.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), axis: new THREE.Vector3(1, 0, 0), spin: 0, phase: 0, alive: false, rest: false });
    confetti.setColorAt(i, tmpC.set(CONFETTI[i % CONFETTI.length]));
  }
  confetti.count = 0;
  confetti.instanceColor.needsUpdate = true;
  group.add(confetti);
  let used = 0;
  const m4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), dq = new THREE.Quaternion(), flat = new THREE.Euler();

  function floorAt(x, z) {
    for (const b of blocks) {
      if (Math.abs(x - b.x) < BW / 2 && Math.abs(z - BZ) < BD / 2 && b.piece.u > 0.9) return b.top + 0.015;
    }
    if (Math.abs(x) < BOOK.halfW && Math.abs(z) < BOOK.halfD) return pageTop(x) + 0.03;
    return 0.015;
  }

  function burst(origin, dir, n, spread, speed, rand) {
    for (let k = 0; k < n && used < MAX_CONFETTI; k++) {
      const c = parts[used++];
      c.alive = true;
      c.rest = false;
      c.p.set(origin.x + (rand() - 0.5) * 0.4, origin.y + (rand() - 0.5) * 0.4, origin.z + (rand() - 0.5) * 0.4);
      c.v.set(dir.x + (rand() - 0.5) * spread, dir.y + (rand() - 0.5) * spread, dir.z + (rand() - 0.5) * spread).normalize().multiplyScalar(speed * (0.7 + rand() * 0.5));
      c.axis.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      c.q.setFromAxisAngle(c.axis, rand() * Math.PI * 2);
      c.spin = 5 + rand() * 9;
      c.phase = rand() * Math.PI * 2;
    }
    confetti.count = used;
  }

  function shower(n, rand) {
    for (let k = 0; k < n && used < MAX_CONFETTI; k++) {
      const c = parts[used++];
      c.alive = true;
      c.rest = false;
      c.p.set((rand() - 0.5) * 12, 8 + rand() * 4, BZ - 2 + rand() * 5);
      c.v.set((rand() - 0.5) * 0.6, -0.5 - rand() * 0.5, (rand() - 0.5) * 0.6);
      c.axis.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      c.q.setFromAxisAngle(c.axis, rand() * Math.PI * 2);
      c.spin = 4 + rand() * 7;
      c.phase = rand() * Math.PI * 2;
    }
    confetti.count = used;
  }

  let confettiTime = 0;
  function updateConfetti(dt, rm) {
    if (!used) return;
    confettiTime += dt;
    const g = rm ? 5 : 9, drag = 1.9, term = rm ? 0.9 : 1.5;
    let moving = false;
    for (let i = 0; i < used; i++) {
      const c = parts[i];
      if (!c.alive || c.rest) continue;
      moving = true;
      c.v.y -= g * dt;
      const k = Math.exp(-drag * dt);
      c.v.x *= k;
      c.v.z *= k;
      if (c.v.y < -term) c.v.y += (-term - c.v.y) * Math.min(1, dt * 6);
      const flutter = Math.sin(confettiTime * 5 + c.phase) * 0.9;
      c.p.x += (c.v.x + flutter * 0.4) * dt;
      c.p.y += c.v.y * dt;
      c.p.z += (c.v.z + Math.cos(confettiTime * 4 + c.phase) * 0.3) * dt;
      dq.setFromAxisAngle(c.axis, c.spin * dt);
      c.q.multiply(dq);
      const f = floorAt(c.p.x, c.p.z);
      if (c.v.y < 0 && c.p.y <= f) {
        c.p.y = f;
        c.rest = true;
        // lie flat on whatever caught it, keeping a random turn
        c.q.setFromEuler(flat.set(-Math.PI / 2, 0, c.phase));
      }
      m4.compose(c.p, c.q, one);
      confetti.setMatrixAt(i, m4);
    }
    if (moving) confetti.instanceMatrix.needsUpdate = true;
  }

  // ---- the ceremony ----------------------------------------------------------------------------------
  const karts = [];
  let t = 0;
  let script = [];
  let rand = mulberry32(2026);

  function clearKarts() {
    for (const k of karts) {
      k.holder.parent?.remove(k.holder);
      k.holder.remove(k.visual.object3d);
      k.visual.dispose();
    }
    karts.length = 0;
  }

  function reset(top3, { sadId = null, reducedMotion = false } = {}) {
    clearKarts();
    group.visible = true;
    t = 0;
    used = 0;
    confetti.count = 0;
    confettiTime = 0;
    rand = mulberry32(2026);
    for (const b of blocks) batch.set(b.piece, 0, { snap: true });
    script = [];
    const byPlace = (n) => blocks.find((b) => b.place === n);
    const landAt = { 3: 2.1, 2: 2.75, 1: 3.55 };
    top3.slice(0, 3).forEach((entry, i) => {
      const place = i + 1;
      const blk = byPlace(place);
      const ch = ROSTER.find((c) => c.id === entry.characterId) || ROSTER[i];
      const visual = createKartVisual(game, ch, null);
      const holder = new THREE.Group();
      holder.name = `podium:${place}:${ch.id}`;
      holder.add(visual.object3d);
      holder.position.set(blk.x, blk.top, BZ + 0.1);
      holder.rotation.y = place === 2 ? 0.2 : place === 3 ? -0.2 : 0;
      holder.visible = false;
      group.add(holder);
      visual.setEmotion('idle');
      const land = reducedMotion ? 1.6 : landAt[place];
      karts.push({ visual, holder, place, top: blk.top, land, fall: reducedMotion ? 0 : 0.55, landed: false, sq: 1, sqv: 0 });
    });
    if (sadId && !top3.some((e) => e.characterId === sadId)) {
      const ch = ROSTER.find((c) => c.id === sadId);
      if (ch) {
        const visual = createKartVisual(game, ch, null);
        const holder = new THREE.Group();
        holder.name = `podium:sad:${ch.id}`;
        holder.add(visual.object3d);
        const x = -5.1, z = 4.7;
        holder.position.set(x, pageTop(x) + 0.03, z);
        holder.rotation.y = 0.55; // turned toward the podium
        holder.visible = false;
        group.add(holder);
        visual.setEmotion('sad');
        karts.push({ visual, holder, place: 0, top: holder.position.y, land: 1.2, fall: 0, landed: false, sq: 1, sqv: 0, sad: true });
      }
    }
    script = [
      { at: 0.55, run: () => { for (const b of blocks) batch.set(b.piece, 1, { delay: b.place === 1 ? 0.12 : b.place === 2 ? 0 : 0.24, snap: reducedMotion }); } },
      { at: reducedMotion ? 1.7 : 3.6, run: () => {
        const n = reducedMotion ? 60 : 1;
        if (reducedMotion) { shower(n, rand); return; }
        burst(new THREE.Vector3(-5.6, 1.6, BZ + 1.8), new THREE.Vector3(0.45, 1, -0.15), 70, 0.7, 13, rand);
        burst(new THREE.Vector3(5.6, 1.6, BZ + 1.8), new THREE.Vector3(-0.45, 1, -0.15), 70, 0.7, 13, rand);
      } },
      { at: reducedMotion ? 99 : 4.3, run: () => shower(90, rand) },
    ];
  }

  function update(dt, rm) {
    t += dt;
    for (const s of script) if (!s.done && t >= s.at) { s.done = true; s.run(); }
    batch.update(dt, rm);
    for (const k of karts) {
      const start = k.land - k.fall;
      if (t < start) { k.holder.visible = false; continue; }
      k.holder.visible = true;
      if (!k.landed) {
        if (t >= k.land) {
          k.landed = true;
          k.holder.position.y = k.top;
          if (!k.sad) {
            k.visual.setEmotion('cheer');
            if (!rm && k.fall > 0) { k.sq = 0.7; k.sqv = 0; }
          }
        } else {
          const f = (t - start) / Math.max(1e-3, k.fall);
          k.holder.position.y = k.top + 5 * (1 - f * f);
        }
      }
      if (k.sq !== 1 || k.sqv !== 0) {
        const w = Math.PI * 2 * 3, z = 0.35;
        let left = dt;
        while (left > 1e-6) {
          const h = Math.min(left, 1 / 120);
          k.sqv += (w * w * (1 - k.sq) - 2 * z * w * k.sqv) * h;
          k.sq += k.sqv * h;
          left -= h;
        }
        if (Math.abs(1 - k.sq) < 1e-3 && Math.abs(k.sqv) < 1e-2) { k.sq = 1; k.sqv = 0; }
        const w2 = 1 + (1 - k.sq) * 0.5;
        k.holder.scale.set(w2, k.sq, w2);
      }
      k.visual.update(dt, 1);
    }
    updateConfetti(dt, rm);
  }

  function hide() {
    clearKarts();
    group.visible = false;
    for (const b of blocks) batch.set(b.piece, 0, { snap: true });
    used = 0;
    confetti.count = 0;
    script = [];
  }

  function dispose() {
    hide();
    batch.dispose();
    confetti.dispose();
    group.parent?.remove(group);
  }

  return { group, reset, update, hide, dispose };
}
