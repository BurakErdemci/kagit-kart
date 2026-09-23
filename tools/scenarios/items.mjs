// Item system checks (ARCHITECTURE.md §10.2) on the placeholder track: boxes + roulette, odds, every
// item through __kk.giveItem + teleport + simulate, threat → hit → grace, time trial, leaks, draw calls.
// CPUs are "puppets" during item checks (AI parked, controls written here) so results do not depend
// on the AI lane; the last check runs a full race with the real AI.
// node tools/scenarios/items.mjs [--port 8773] [--only name,name] [--no-shots]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'out', 'items');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const port = +arg('--port', 8773);
const only = arg('--only', '') ? arg('--only', '').split(',') : null;
const shots = !process.argv.includes('--no-shots');
fs.mkdirSync(OUT, { recursive: true });

const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

// Installed once in the page: frame driver, puppets, camera override, event helpers.
function installHelpers() {
  const kk = window.__kk;
  const g = kk.game;
  const H = {
    t: 0, cam: null, drive: {}, press: {}, hold: {}, ai: null,
    frame(dt) {
      for (const k of g.karts) {
        const v = k.visual;
        if (!v) continue;
        v.object3d.position.copy(k.pos);
        v.object3d.quaternion.copy(k.quat);
        v.update(dt, 1);
      }
      g.systems.items?.updateVisual(dt, 1);
      g.systems.cinematics?.update(dt);
      g.cameraRig.update(dt);
      if (H.cam) {
        g.camera.position.fromArray(H.cam.pos);
        g.camera.lookAt(H.cam.look[0], H.cam.look[1], H.cam.look[2]);
        g.camera.updateMatrixWorld();
      }
      g.systems.scenery?.update(dt, g.camera);
      g.systems.fx?.update(dt, 1);
      g.systems.ui?.update(dt);
      H.t += dt;
      g.materials.update(H.t);
      if (g.player?.visual) g.renderer.sunTarget.copy(g.player.visual.object3d.position);
      kk.renderFrame();
    },
    steerTo(k, lat) {
      const L = g.track.length;
      const pt = {};
      g.track.pointAt(((k.trackInfo.dist + 8 + Math.max(0, k.speed) * 0.4) % L) / L, lat, pt);
      const desired = Math.atan2(pt.pos.x - k.pos.x, pt.pos.z - k.pos.z);
      const err = Math.atan2(Math.sin(desired - k.heading), Math.cos(desired - k.heading));
      return Math.max(-1, Math.min(1, -err * 2.5));
    },
    applyDrive() {
      for (const k of g.karts) {
        const d = H.drive[k.index];
        const c = { steer: 0, throttle: 0, brake: 0, drift: false, item: false, lookBack: false };
        if (d) { c.throttle = d.throttle ?? 1; c.steer = d.lat === null ? 0 : H.steerTo(k, d.lat ?? 0); c.brake = d.brake || 0; c.lookBack = !!d.lookBack; }
        if (H.press[k.index] > 0) { c.item = true; H.press[k.index]--; }
        if (H.hold[k.index]) c.item = true;
        if (k.isPlayer) kk.setControls(c);
        else Object.assign(k.controls, c);
      }
    },
    run(sec, each) {
      const n = Math.max(1, Math.round(sec * 60));
      for (let i = 0; i < n; i++) {
        if (each && each(i) === false) return i / 60;
        H.applyDrive();
        kk.simulate(1 / 60);
        H.frame(1 / 60);
      }
      return sec;
    },
    until(maxSec, cond) {
      const n = Math.round(maxSec * 60);
      for (let i = 0; i < n; i++) {
        if (cond()) return i / 60;
        H.applyDrive();
        kk.simulate(1 / 60);
        H.frame(1 / 60);
      }
      return -1;
    },
    since: 0,
    mark() { H.since = kk.eventSeq(); },
    evs(names) { return kk.events(H.since).filter((e) => names.includes(e.name)); },
    async start(opts = {}) {
      if (H.ai) { g.systems.ai = H.ai; H.ai = null; } // AI back before teardown so its listeners are disposed
      H.drive = {}; H.press = {}; H.hold = {}; H.cam = null;
      kk.setCamera(null);
      g.loop.stop();
      await kk.startRace({ track: 'meadow', mode: 'single', autopilot: false, skipIntro: true, seed: 7, cpuCount: 3, ...opts });
      g.loop.stop();
      if (opts.puppets !== false && g.systems.ai) { H.ai = g.systems.ai; g.systems.ai = null; }
      kk.setControls({ steer: 0, throttle: 0, brake: 0, drift: false, item: false, lookBack: false });
      kk.simulate(3.1);
      H.frame(1 / 60);
      H.mark();
      return g.race.state;
    },
    // place kart i at metres `d` from the player's current spot along the track, on lateral `lat`
    place(i, dMetres, lat = 0, speed = 0) {
      const L = g.track.length;
      const base = g.player.trackInfo.dist;
      const k = g.karts[i];
      k.speed = 0;
      kk.teleport(i, (((base + dMetres) % L) + L) % L / L, lat);
      if (speed) {
        k.vel.set(Math.sin(k.heading) * speed, 0, Math.cos(k.heading) * speed);
        k.speed = speed;
      }
    },
    items() { return g.systems.items; },
    // Teleports within 60 m past the line trip the race's lap-crossing counter for that kart only;
    // one step later every kart is put on the same lap so places follow track position.
    fixLaps() {
      kk.simulate(g.config.STEP);
      for (const k of g.karts) { k.crossLap = 1; if (k.lap < 1) k.lap = 1; }
      kk.simulate(g.config.STEP);
    },
    // start t of the straightest `len` m of road (least summed |curvature|), for straight-line flyers
    straight(len = 110) {
      const s = g.track.samples, N = g.track.sampleCount, sp = g.track.spacing;
      const w = Math.round(len / sp);
      let best = 0, bestSum = Infinity;
      for (let i = 0; i < N; i += 4) {
        let sum = 0;
        for (let j = 0; j < w; j++) sum += Math.abs(s.curvature[(i + j) % N]);
        const d = s.dist[i];
        if (sum < bestSum && d > 70 && d < g.track.length - len - 70) { bestSum = sum; best = i; }
      }
      return s.dist[best] / g.track.length;
    },
    // CPU kart indices (the grid is [...cpus, player], so the player is last)
    cpus() { return g.karts.filter((k) => !k.isPlayer).map((k) => k.index); },
    kstate(k) {
      return { id: k.id, place: k.place, item: k.item, count: k.itemCount, held: k.itemHeld, roulette: +k.roulette.toFixed(3), spin: +k.spinTime.toFixed(3), grace: +k.graceTime.toFixed(3), inv: +k.invincibleTime.toFixed(3), ink: +k.inkTime.toFixed(3), boost: +k.boostTime.toFixed(3), speed: +k.speed.toFixed(2) };
    },
  };
  window.__it = H;
}

const checks = {
  // ---------------------------------------------------------------------------------------------
  async boxes(page, shot) {
    const r = await page.evaluate(async () => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      await H.start({ cpuCount: 1 });
      const it = H.items();
      const rows = g.trackDef.itemRows;
      const out = { boxCount: it.boxes.length, want: rows.reduce((a, r) => a + r.count, 0) };
      const P = g.player;
      const box = it.boxes[2];
      const L = g.track.length;
      const q = g.track.createQueryInfo();
      g.track.query(box.pos, -1, q);
      H.place(g.player.index, 0, 0);
      kk.teleport(P.index, ((q.dist - 32) / L + 1) % 1, q.lateral);
      H.place(0, -60, 6); // puppet out of the way
      H.fixLaps();
      H.drive[P.index] = { throttle: 1, lat: q.lateral };
      H.drive[0] = { throttle: 0, lat: null };
      H.run(0.5);
      out.activeBefore = box.active;
      return out;
    });
    await shot('box-approach');
    const r2 = await page.evaluate(() => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      const it = H.items();
      const box = it.boxes[2];
      const P = g.player;
      H.mark();
      const tHit = H.until(4, () => !box.active);
      const e = H.evs(['itemBox']);
      // fixed camera beside the row to watch the fold
      const up = box.up;
      H.cam = { pos: [box.pos.x + 7, box.pos.y + 4.5, box.pos.z + 5], look: [box.pos.x, box.pos.y + 0.4, box.pos.z] };
      return { tHit, itemBoxEvents: e.length, rouletteAtPickup: +P.roulette.toFixed(3), rouletteDuration: P.rouletteDuration, up: [up.x, up.y, up.z].map((v) => +v.toFixed(2)) };
    });
    await page.evaluate(() => window.__it.run(0.12));
    await shot('box-unfold');
    await page.evaluate(() => window.__it.run(0.4));
    await shot('box-flat');
    await page.evaluate(() => window.__it.run(0.42));
    await shot('box-refold');
    const r3 = await page.evaluate(() => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      const it = H.items();
      const box = it.boxes[2];
      const at1 = { active: box.active, sinceTaken: +(g.raceTime - box.takenAt).toFixed(3) };
      H.run(0.3);
      const at2 = { active: box.active, sinceTaken: +(g.raceTime - box.takenAt).toFixed(3) };
      H.until(1.2, () => g.player.item);
      const got = H.evs(['itemGet']).map((e) => e.detail.item);
      const rowItems = {
        0: ['gum', 'plane', 'rocket'],
      };
      H.cam = null;
      return { beforeRespawn: at1, afterRespawn: at2, itemGet: got, playerItem: g.player.item, count: g.player.itemCount, place: g.player.place, row: it.rowFor(g.player), rowItemsP1: rowItems[0] };
    });
    // second pickup while holding: box breaks, no roulette
    const r4 = await page.evaluate(() => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      const it = H.items();
      const P = g.player;
      const box = it.boxes[5];
      const q = g.track.createQueryInfo();
      g.track.query(box.pos, -1, q);
      const L = g.track.length;
      kk.teleport(P.index, ((q.dist - 20) / L + 1) % 1, q.lateral);
      H.drive[P.index] = { throttle: 1, lat: q.lateral };
      const itemBefore = P.item;
      H.until(3, () => !box.active);
      return { holdingPickupBroke: !box.active, itemKept: P.item === itemBefore, roulette: P.roulette };
    });
    return { ...r, ...r2, ...r3, ...r4, pass: r.boxCount === r.want && r2.itemBoxEvents >= 1 && Math.abs(r2.rouletteAtPickup - 1.6) < 0.02 && !r3.beforeRespawn.active && r3.afterRespawn.active && r3.itemGet.length === 1 && r4.holdingPickupBroke && r4.itemKept && r4.roulette === 0 };
  },

  // ---------------------------------------------------------------------------------------------
  async odds(page) {
    return page.evaluate(async () => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      const mod = await import('/src/items/items.js');
      const dist = [];
      let exact = true;
      for (let r = 0; r < 8; r++) {
        for (const sc of [true, false]) {
          const counts = {};
          const N = 20000;
          for (let i = 0; i < N; i++) {
            const id = mod.pickFromRow(mod.ODDS[r], (i + 0.5) / N, sc);
            counts[id] = (counts[id] || 0) + 1;
          }
          let total = 0;
          for (const [id, w] of mod.ODDS[r]) if (sc || id !== 'scissors') total += w;
          for (const [id, w] of mod.ODDS[r]) {
            const want = sc || id !== 'scissors' ? (w / total) * 100 : 0;
            const got = ((counts[id] || 0) / N) * 100;
            if (Math.abs(want - got) > 0.05) exact = false;
          }
          if (sc) dist.push(Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, +(v / N * 100).toFixed(1)])));
        }
      }
      // row mapping and the leader-gap rule in a full field
      await H.start({ cpuCount: 7 });
      const it = H.items();
      const K = g.karts;
      const rows = [];
      for (let p = 1; p <= 8; p++) {
        K.forEach((k, i) => { k.place = ((i + p - 1) % 8) + 1; });
        const k = K.find((x) => x.place === p);
        const leader = K.find((x) => x.place === 1);
        K.forEach((x) => { x.progress = 1000 - (x.place - 1) * 40; });
        const far = it.rowFor(k);
        K.forEach((x) => { x.progress = 1000 - (x.place - 1) * 3; });
        const near = it.rowFor(k);
        rows.push({ place: p, far, near, leader: leader.id });
      }
      const sc = {};
      g.raceTime = 10; sc.at10 = it.scissorsAvailable();
      g.raceTime = 25; sc.at25 = it.scissorsAvailable();
      K[1].item = 'scissors'; sc.whileHeld = it.scissorsAvailable(); K[1].item = null;
      const rowsOk = rows.every((r) => r.far === r.place - 1 && r.near === Math.min(r.place - 1, 2));
      return { exact, rowsOk, scissors: sc, rows, distP5: dist[4], distP8: dist[7], pass: exact && rowsOk && !sc.at10 && sc.at25 && !sc.whileHeld };
    });
  },

  // ---------------------------------------------------------------------------------------------
  async rocket(page, shot) {
    await page.evaluate(async () => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      await H.start({ cpuCount: 1 });
      kk.teleport(g.player.index, 0.06, 0);
      H.place(0, -80, 5);
      H.drive[g.player.index] = { throttle: 1, lat: 0 };
      kk.giveItem(g.player.index, 'rocket');
      H.run(1.2);
    });
    await shot('rocket-held');
    const r = await page.evaluate(() => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      const P = g.player;
      H.mark();
      H.press[P.index] = 1;
      H.run(1 / 60);
      const b = H.evs(['boost', 'itemUse']);
      return { events: b.map((e) => ({ n: e.name, src: e.detail.source, item: e.detail.item, dur: e.detail.duration })), boostTime: +P.boostTime.toFixed(3), strength: P.boostStrength, item: P.item };
    });
    await page.evaluate(() => window.__it.run(0.3));
    await shot('rocket-fire');
    await page.evaluate(() => {
      const H = window.__it, g = window.__kk.game, P = g.player;
      H.cam = null;
      // side view of the clamped pen
      const o = P.visual.object3d;
      const right = [-Math.cos(P.heading), 0, Math.sin(P.heading)];
      H.run(1 / 60);
      H.cam = { pos: [o.position.x + right[0] * 4.2 - Math.sin(P.heading) * 3.5, o.position.y + 1.6, o.position.z + right[2] * 4.2 - Math.cos(P.heading) * 3.5], look: [o.position.x - Math.sin(P.heading) * 1.4, o.position.y + 0.6, o.position.z - Math.cos(P.heading) * 1.4] };
      H.run(1 / 60);
    });
    await shot('rocket-side');
    await page.evaluate(() => { const H = window.__it; H.cam = null; H.run(1.0); });
    await shot('rocket-drop');
    return { ...r, pass: r.events.some((e) => e.n === 'boost' && e.src === 'item') && Math.abs(r.boostTime - 1.3) < 0.02 && r.strength === 1.15 && r.item === null };
  },

  async rocket3(page, shot) {
    await page.evaluate(async () => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      await H.start({ cpuCount: 1 });
      kk.teleport(g.player.index, 0.06, 0);
      H.place(0, -80, 5);
      H.drive[g.player.index] = { throttle: 1, lat: 0 };
      kk.giveItem(g.player.index, 'rocket3');
      H.run(1.0);
    });
    await shot('rocket3-held');
    return page.evaluate(() => {
      const H = window.__it, g = window.__kk.game, P = g.player;
      const counts = [P.itemCount];
      H.mark();
      for (let i = 0; i < 3; i++) {
        H.press[P.index] = 1;
        H.run(1.5);
        counts.push(P.itemCount);
      }
      const boosts = H.evs(['boost']).filter((e) => e.detail.source === 'item').length;
      return { counts, item: P.item, boosts, pass: counts.join() === '3,2,1,0' && P.item === null && boosts === 3 };
    });
  },

  // ---------------------------------------------------------------------------------------------
  async gum(page, shot) {
    await page.evaluate(async () => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      await H.start({ cpuCount: 1 });
      kk.teleport(g.player.index, 0.06, -2);
      H.place(0, -90, 5);
      H.drive[g.player.index] = { throttle: 0.8, lat: -2 };
      kk.giveItem(g.player.index, 'gum');
      H.run(0.8);
      H.hold[g.player.index] = true;
      H.run(1.2);
    });
    await shot('gum-trail');
    const held = await page.evaluate(async () => {
      const H = window.__it, g = window.__kk.game, P = g.player;
      const hz = H.items().hazards;
      const h = hz[0];
      const back = h ? Math.hypot(h.pos.x - P.pos.x, h.pos.z - P.pos.z) : null;
      const o = P.visual.object3d;
      H.cam = { pos: [o.position.x - Math.cos(P.heading) * 5 - Math.sin(P.heading) * 3, o.position.y + 1.8, o.position.z + Math.sin(P.heading) * 5 - Math.cos(P.heading) * 3], look: [o.position.x - Math.sin(P.heading) * 1.6, o.position.y + 0.4, o.position.z - Math.cos(P.heading) * 1.6] };
      H.run(1 / 60);
      return { itemHeld: P.itemHeld, item: P.item, hazards: hz.length, heldBy: h?.held?.id, trailDist: back && +back.toFixed(2), want: g.systems.items.visuals && (await import('/src/items/items.js')).TUNE.gumBack };
    });
    await shot('gum-trail-side');
    const drop = await page.evaluate(() => {
      const H = window.__it, g = window.__kk.game, P = g.player;
      H.mark();
      H.hold[P.index] = false;
      H.drive[P.index] = { throttle: 0.8, lat: -2 };
      H.run(1 / 60);
      const h = H.items().hazards[0];
      const use = H.evs(['itemUse']).map((e) => e.detail.item);
      H.cam = { pos: [h.pos.x + 4, h.pos.y + 2.2, h.pos.z + 3], look: [h.pos.x, h.pos.y + 0.2, h.pos.z] };
      H.run(1 / 60);
      return { itemUse: use, itemHeld: P.itemHeld, item: P.item, dropped: !!h && !h.held, pos: h && [h.pos.x, h.pos.y, h.pos.z] };
    });
    await shot('gum-drop');
    await page.evaluate(() => window.__it.run(0.6));
    await shot('gum-rest');
    const hit = await page.evaluate(() => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      const h = H.items().hazards[0];
      const q = g.track.createQueryInfo();
      g.track.query(h.pos, -1, q);
      const L = g.track.length;
      const cpu = g.karts[0];
      kk.teleport(0, ((q.dist - 25) / L + 1) % 1, q.lateral);
      cpu.vel.set(Math.sin(cpu.heading) * 18, 0, Math.cos(cpu.heading) * 18);
      H.drive[0] = { throttle: 1, lat: q.lateral };
      H.drive[g.player.index] = { throttle: 0, lat: null };
      H.mark();
      let before = 0;
      const t = H.until(4, () => { if (cpu.spinTime <= 0) before = cpu.speed; return cpu.spinTime > 0; });
      const e = H.evs(['hit']);
      return { t, hits: e.map((x) => ({ kart: x.kartId, cause: x.detail.cause })), spinTime: +cpu.spinTime.toFixed(3), speedBefore: +before.toFixed(2), speedAfter: +cpu.speed.toFixed(2), hazardsLeft: H.items().hazards.length };
    });
    return { held, drop, hit, pass: held.itemHeld && held.heldBy === 'tilki' && Math.abs(held.trailDist - held.want) < 0.3 && drop.dropped && !drop.itemHeld && drop.itemUse[0] === 'gum' && hit.hits.some((h) => h.cause === 'gum') && hit.hazardsLeft === 0 && hit.speedAfter < hit.speedBefore * 0.45 };
  },

  async gumShield(page) {
    return page.evaluate(async () => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      await H.start({ cpuCount: 1 });
      const P = g.player, cpu = g.karts[0];
      kk.teleport(P.index, H.straight() + 40 / g.track.length, 0);
      H.place(0, -30, 0);
      H.fixLaps();
      H.drive[P.index] = { throttle: 0.6, lat: 0 };
      H.drive[0] = { throttle: 0.6, lat: 0 };
      kk.giveItem(P.index, 'gum');
      H.run(0.3);
      H.hold[P.index] = true;
      kk.giveItem(0, 'homing');
      H.run(0.3);
      H.mark();
      H.press[0] = 1;
      H.run(3);
      const ev = H.evs(['projectile', 'hit', 'threat']);
      return {
        target: ev.find((e) => e.name === 'projectile' && e.detail.state === 'spawn')?.detail.target,
        states: ev.filter((e) => e.name === 'projectile').map((e) => e.detail.state),
        playerHits: ev.filter((e) => e.name === 'hit' && e.kartId === P.id).length,
        threats: ev.filter((e) => e.name === 'threat').map((e) => ({ kart: e.kartId, eta: +e.detail.eta.toFixed(2) })),
        itemHeld: P.itemHeld, item: P.item,
        pass: ev.some((e) => e.name === 'projectile' && e.detail.state === 'hit') && ev.filter((e) => e.name === 'hit' && e.kartId === P.id).length === 0 && !P.itemHeld && P.item === null,
      };
    });
  },

  // ---------------------------------------------------------------------------------------------
  async plane(page, shot) {
    await page.evaluate(async () => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      await H.start({ cpuCount: 1 });
      const P = g.player;
      kk.teleport(P.index, H.straight(), 1);
      H.place(0, 30, 1, 8);
      H.fixLaps();
      H.drive[P.index] = { throttle: 0.7, lat: 1 };
      H.drive[0] = { throttle: 0.35, lat: 1 };
      kk.giveItem(P.index, 'plane');
      H.run(0.4);
      H.mark();
      H.press[P.index] = 1;
      H.run(0.2);
    });
    await shot('plane-flight');
    const hit = await page.evaluate(() => {
      const H = window.__it, g = window.__kk.game;
      const cpu = g.karts[0];
      H.until(3, () => cpu.spinTime > 0);
      const ev = H.evs(['projectile', 'hit', 'itemUse']);
      return { states: ev.filter((e) => e.name === 'projectile').map((e) => e.detail.state), hits: ev.filter((e) => e.name === 'hit').map((e) => ({ kart: e.kartId, cause: e.detail.cause })), spin: +cpu.spinTime.toFixed(3), use: ev.find((e) => e.name === 'itemUse')?.detail };
    });
    // bounce: aim into the right-hand wall of the tongue section
    const bounce = await page.evaluate(() => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      const P = g.player;
      H.drive = {};
      kk.teleport(P.index, 0.57, 0);
      H.place(0, -120, 0);
      P.heading -= 0.75; // nose towards the right edge
      P.updateQuat(1, true);
      P.prevQuat.copy(P.quat);
      kk.giveItem(P.index, 'plane');
      H.mark();
      H.press[P.index] = 1;
      H.run(1 / 60);
      const p = H.items().projectiles[0];
      let flipShot = -1;
      const t = H.until(2, () => { if (p.flipAt > 0 && p.age - p.flipAt > 0.1 && flipShot < 0) { flipShot = p.age; return true; } return false; });
      // camera behind and above the plane, looking along its new heading
      H.cam = { pos: [p.pos.x - Math.sin(p.heading) * 7, p.pos.y + 4, p.pos.z - Math.cos(p.heading) * 7], look: [p.pos.x + Math.sin(p.heading) * 2, p.pos.y, p.pos.z + Math.cos(p.heading) * 2] };
      H.frame(0);
      return { firstBounceAt: t, bounces: p.bounces };
    });
    await shot('plane-bounce');
    const life = await page.evaluate(() => {
      const H = window.__it, g = window.__kk.game;
      H.run(6);
      const ev = H.evs(['projectile']);
      H.cam = null;
      return { states: ev.map((e) => e.detail.state), bounces: ev.filter((e) => e.detail.state === 'bounce').length, alive: H.items().projectiles.length };
    });
    return { hit, bounce, life, pass: hit.hits.some((h) => h.kart !== 'tilki' && h.cause === 'plane') && Math.abs(hit.spin - 1.3) < 0.1 && life.bounces >= 1 && life.bounces <= 4 && life.alive === 0 && life.states.includes('expire') };
  },

  // ---------------------------------------------------------------------------------------------
  async homing(page, shot) {
    const r = await page.evaluate(async () => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      await H.start({ cpuCount: 1 });
      const P = g.player, cpu = g.karts[0];
      kk.teleport(P.index, 0.06, 0);
      H.place(0, 70, 3, 12);
      H.fixLaps();
      H.drive[P.index] = { throttle: 0.6, lat: 0 };
      H.drive[0] = { throttle: 0.5, lat: 3 };
      H.run(0.3);
      kk.giveItem(P.index, 'homing');
      H.mark();
      H.press[P.index] = 1;
      const log = [];
      let lockShot = false;
      H.until(1.0, () => { const p = H.items().projectiles[0]; return p && p.age > 0.5; });
      return { target: H.items().projectiles[0]?.target?.id };
    });
    await shot('homing-flight');
    const seq = await page.evaluate(() => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      const cpu = g.karts[0];
      const tHit = { threat: [], hit: null };
      H.until(8, () => cpu.spinTime > 0);
      const ev = H.evs(['projectile', 'threat', 'hit']);
      const hitEv = ev.find((e) => e.name === 'hit');
      const threats = ev.filter((e) => e.name === 'threat').map((e) => ({ kart: e.kartId, eta: +e.detail.eta.toFixed(3), t: e.t, predicted: +(e.t + e.detail.eta).toFixed(3) }));
      const out = { states: ev.filter((e) => e.name === 'projectile').map((e) => e.detail.state), threats, hitAt: hitEv?.t, hit: hitEv && { kart: hitEv.kartId, cause: hitEv.detail.cause, by: hitEv.detail.by } };
      // spin → grace
      out.spin = +cpu.spinTime.toFixed(3);
      H.run(1.35);
      out.afterSpin = { spin: +cpu.spinTime.toFixed(3), grace: +cpu.graceTime.toFixed(3), immune: cpu.isImmune() };
      // a second homing during grace breaks without a new spin
      const P = g.player;
      kk.giveItem(P.index, 'homing');
      const L = g.track.length;
      H.mark();
      kk.teleport(P.index, ((cpu.trackInfo.dist - 8) / L + 1) % 1, cpu.trackInfo.lateral);
      H.press[P.index] = 1;
      H.run(0.5);
      const ev2 = H.evs(['projectile', 'hit']);
      out.duringGrace = { states: ev2.filter((e) => e.name === 'projectile').map((e) => e.detail.state), hits: ev2.filter((e) => e.name === 'hit').length };
      return out;
    });
    const t15 = seq.threats.find((t) => t.eta > 0.5);
    const t05 = seq.threats.find((t) => t.eta <= 0.5);
    return {
      ...r, ...seq,
      pass: r.target === 'kurbaga' || !!r.target
        ? seq.threats.length === 2 && !!t15 && !!t05 && Math.abs(t15.predicted - seq.hitAt) < 0.35 && Math.abs(t05.predicted - seq.hitAt) < 0.15 && seq.hit?.cause === 'homing' && seq.afterSpin.grace > 0.8 && seq.afterSpin.immune && seq.duringGrace.hits === 0
        : false,
    };
  },

  // ---------------------------------------------------------------------------------------------
  async ink(page, shot) {
    await page.evaluate(async () => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      await H.start({ cpuCount: 3 });
      const P = g.player;
      kk.teleport(P.index, 0.06, 0);
      H.place(0, 22, -3, 14);
      H.place(1, 38, 3, 14);
      H.place(2, 55, 0, 14);
      H.fixLaps();
      for (const i of [0, 1, 2]) H.drive[i] = { throttle: 0.55, lat: [-3, 3, 0][i] };
      H.drive[P.index] = { throttle: 0.55, lat: 0 };
      H.run(0.4);
      kk.giveItem(P.index, 'ink');
      H.mark();
      H.press[P.index] = 1;
      H.run(0.45);
    });
    await shot('ink-flight');
    await page.evaluate(() => window.__it.run(0.43));
    await shot('ink-burst');
    await page.evaluate(() => window.__it.run(0.35));
    await shot('ink-rain');
    return page.evaluate(() => {
      const H = window.__it, g = window.__kk.game;
      const ev = H.evs(['inked', 'projectile', 'itemUse']);
      const inked = ev.filter((e) => e.name === 'inked').map((e) => ({ kart: e.kartId, d: e.detail.duration }));
      const places = g.karts.map((k) => ({ id: k.id, place: k.place, ink: +k.inkTime.toFixed(2) }));
      return { inked, places, states: ev.filter((e) => e.name === 'projectile').map((e) => e.detail.state), pass: inked.length === 3 && !inked.some((e) => e.kart === 'tilki') && inked.every((e) => e.d === 3.5) };
    });
  },

  // ---------------------------------------------------------------------------------------------
  async foil(page, shot) {
    await page.evaluate(async () => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      await H.start({ cpuCount: 1 });
      const P = g.player;
      kk.teleport(P.index, 0.06, 0);
      H.place(0, -90, 0);
      H.drive[P.index] = { throttle: 0.7, lat: 0 };
      kk.giveItem(P.index, 'foil');
      H.run(0.3);
      H.mark();
      H.press[P.index] = 1;
      H.run(0.5);
    });
    await shot('foil-chase');
    await page.evaluate(() => {
      const H = window.__it, g = window.__kk.game, P = g.player;
      const o = P.visual.object3d;
      const f = [Math.sin(P.heading), Math.cos(P.heading)], r = [-Math.cos(P.heading), Math.sin(P.heading)];
      H.cam = { pos: [o.position.x + f[0] * 3.2 + r[0] * 3.6, o.position.y + 2.0, o.position.z + f[1] * 3.2 + r[1] * 3.6], look: [o.position.x, o.position.y + 0.7, o.position.z] };
      H.run(1 / 60);
    });
    await shot('foil-front');
    return page.evaluate(() => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      const P = g.player, cpu = g.karts[0];
      H.cam = null;
      const countShells = () => { let n = 0; P.visual.object3d.traverse((o) => { if (o.name === 'items:foil') n++; }); return n; };
      const out = { inv: +P.invincibleTime.toFixed(2), shells: countShells(), topGain: +(P.topSpeed / P.baseTop).toFixed(3) };
      // ram a parked puppet
      H.place(0, 14, 0);
      H.drive[0] = { throttle: 0, lat: null };
      H.until(3, () => cpu.spinTime > 0);
      out.ram = H.evs(['hit']).filter((e) => e.kartId === cpu.id).map((e) => e.detail.cause);
      // foil flattens gum without a spin
      const L = g.track.length;
      kk.giveItem(0, 'gum');
      H.place(0, 20, 0);
      cpu.graceTime = 0; cpu.spinTime = 0;
      H.press[0] = 1;
      H.run(2 / 60);
      const hz = H.items().hazards.length;
      H.mark();
      H.until(3, () => H.items().hazards.length === 0);
      out.gum = { before: hz, after: H.items().hazards.length, playerHits: H.evs(['hit']).filter((e) => e.kartId === P.id).length };
      H.run(7);
      out.after = { inv: P.invincibleTime, shells: countShells() };
      return { ...out, pass: out.inv > 6 && out.shells === 1 && out.ram.includes('foil') && out.gum.after === 0 && out.gum.playerHits === 0 && out.after.shells === 0 };
    });
  },

  // ---------------------------------------------------------------------------------------------
  async scissors(page, shot) {
    const setup = async (boostLeader) => page.evaluate(async (boostLeader) => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      await H.start({ cpuCount: 3 });
      const P = g.player;
      kk.teleport(P.index, 0.04, 0);
      H.place(0, 110, -2, 16);  // leader
      H.place(1, 107.5, 1.5, 16); // inside the 6 m splash
      H.place(2, 90, 0, 16);    // outside
      H.fixLaps();
      H.drive[0] = { throttle: 0.6, lat: -2 };
      H.drive[1] = { throttle: 0.6, lat: 1.5 };
      H.drive[2] = { throttle: 0.6, lat: 0 };
      H.drive[P.index] = { throttle: 0.6, lat: 0 };
      H.run(0.3);
      kk.giveItem(P.index, 'scissors');
      H.mark();
      H.press[P.index] = 1;
      H.run(0.35);
      window.__boostLeader = boostLeader;
      return g.karts.map((k) => ({ id: k.id, place: k.place }));
    }, boostLeader);
    const places = await setup(false);
    await shot('scissors-rise');
    await page.evaluate(() => window.__it.run(0.9));
    await shot('scissors-cruise');
    const res = await page.evaluate(() => {
      const H = window.__it, g = window.__kk.game;
      const p = H.items().projectiles.find((x) => x.kind === 'scissors');
      H.until(8, () => p.phase === 2 && p.phaseT > 0.3);
      const t = p.target;
      H.cam = { pos: [t.pos.x - Math.cos(t.heading) * 9, t.pos.y + 5, t.pos.z + Math.sin(t.heading) * 9], look: [t.pos.x, t.pos.y + 2, t.pos.z] };
      H.run(1 / 60);
      return { target: t.id };
    });
    await shot('scissors-dive');
    const hit = await page.evaluate(() => {
      const H = window.__it, g = window.__kk.game;
      H.run(0.08);
      H.cam = null;
      H.run(0.8);
      const ev = H.evs(['projectile', 'threat', 'hit']);
      return {
        states: ev.filter((e) => e.name === 'projectile').map((e) => e.detail.state),
        threats: ev.filter((e) => e.name === 'threat').map((e) => ({ kart: e.kartId, eta: +e.detail.eta.toFixed(2), predicted: +(e.t + e.detail.eta).toFixed(2) })),
        hits: ev.filter((e) => e.name === 'hit').map((e) => ({ kart: e.kartId, cause: e.detail.cause, t: e.t })),
      };
    });
    await shot('scissors-after');
    // same flight with the leader boosting at impact: dodged
    await setup(true);
    const dodge = await page.evaluate(() => {
      const H = window.__it, g = window.__kk.game;
      const p = H.items().projectiles.find((x) => x.kind === 'scissors');
      H.until(10, () => p.phase === 2);
      p.target.applyBoost(2, 1, 'pad');
      H.run(1.2);
      return H.evs(['hit']).map((e) => ({ kart: e.kartId, cause: e.detail.cause }));
    });
    const leader = places.find((k) => k.place === 1)?.id;
    return {
      places, ...res, ...hit, dodge,
      pass: res.target === leader && hit.hits.some((h) => h.kart === leader && h.cause === 'scissors') && hit.hits.length === 2 && hit.threats.filter((t) => t.kart === leader).length === 2 && !dodge.some((h) => h.kart === leader),
    };
  },

  // ---------------------------------------------------------------------------------------------
  // backward throw on brake, homing from first place (no target), reduced-motion box snap
  async throws(page) {
    return page.evaluate(async () => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      await H.start({ cpuCount: 1 });
      const P = g.player, cpu = g.karts[0];
      const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      kk.teleport(P.index, H.straight() + 60 / g.track.length, 0);
      H.place(0, -25, 0, 10);
      H.fixLaps();
      H.drive[P.index] = { throttle: 0.6, lat: 0 };
      H.drive[0] = { throttle: 0.6, lat: 0 };
      H.run(0.3);
      kk.giveItem(P.index, 'plane');
      H.mark();
      H.drive[P.index] = { throttle: 0, brake: 1, lat: 0 };
      H.press[P.index] = 1;
      H.run(1 / 60);
      const p = H.items().projectiles[0];
      const out = { backHeading: p ? +Math.abs(wrap(p.heading - P.heading)).toFixed(2) : null };
      H.drive[P.index] = { throttle: 0.6, lat: 0 };
      H.until(2, () => cpu.spinTime > 0);
      const ev = H.evs(['itemUse', 'hit']);
      out.useBackward = ev.find((e) => e.name === 'itemUse')?.detail.backward;
      out.cpuHit = ev.filter((e) => e.name === 'hit' && e.kartId === cpu.id).map((e) => e.detail.cause);
      // homing from P1: nothing ahead, so no target and no threats
      H.run(1.5);
      out.playerPlace = P.place;
      kk.giveItem(P.index, 'homing');
      H.mark();
      H.press[P.index] = 1;
      H.run(1 / 60);
      const hp = H.items().projectiles.find((x) => x.kind === 'homing');
      out.p1Homing = { spawned: !!hp, target: hp ? (hp.target ? hp.target.id : null) : 'none' };
      H.run(3);
      out.p1Homing.threats = H.evs(['threat']).length;
      // reduced motion: a taken box lies flat at once
      g.api.setSetting('reducedMotion', 'on');
      const it = H.items();
      const q = g.track.createQueryInfo();
      let bi = -1, best = 1e9;
      for (let i = 0; i < it.boxes.length; i++) {
        g.track.query(it.boxes[i].pos, -1, q);
        let ahead = q.dist - P.trackInfo.dist;
        if (ahead < 0) ahead += g.track.length;
        if (ahead > 25 && ahead < best && it.boxes[i].active) { best = ahead; bi = i; }
      }
      const box = it.boxes[bi];
      g.track.query(box.pos, -1, q);
      kk.teleport(P.index, ((q.dist - 18) / g.track.length + 1) % 1, q.lateral);
      H.drive[P.index] = { throttle: 1, lat: q.lateral };
      H.until(3, () => !box.active);
      H.run(2 / 60);
      const fold = it.visuals().meshes.find((m) => m.name === 'items:boxes').geometry.attributes.aFold.array[bi];
      g.api.setSetting('reducedMotion', 'auto');
      out.reducedFold = +fold.toFixed(3);
      out.pass = out.backHeading > 3.0 && out.useBackward === true && out.cpuHit.includes('plane') && out.playerPlace === 1 &&
        out.p1Homing.spawned && out.p1Homing.target === null && out.p1Homing.threats === 0 && out.reducedFold === 1;
      return out;
    });
  },

  // ---------------------------------------------------------------------------------------------
  async timeTrial(page) {
    return page.evaluate(async () => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      await H.start({ mode: 'tt', puppets: false });
      const it = H.items();
      const P = g.player;
      const out = { item: P.item, count: P.itemCount, boxes: it.boxes.length };
      H.drive[P.index] = { throttle: 1, lat: 0 };
      H.run(0.5);
      H.press[P.index] = 1;
      H.run(1.5);
      out.afterOne = P.itemCount;
      return { ...out, pass: out.item === 'rocket3' && out.count === 3 && out.boxes === 0 && out.afterOne === 2 };
    });
  },

  // ---------------------------------------------------------------------------------------------
  async budget(page, shot) {
    const r = await page.evaluate(async () => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      await H.start({ cpuCount: 5 });
      const P = g.player;
      const it = H.items();
      // many things at once: boxes, dropped gums, a trailing gum, planes, homing, pens, a foil shell
      kk.teleport(P.index, 0.14, 0);
      for (let i = 1; i <= 5; i++) H.place(i - 1, 12 + i * 9, (i % 3 - 1) * 4, 10);
      H.fixLaps();
      for (let i = 0; i < 6; i++) H.drive[i] = { throttle: 0.5, lat: (i % 3 - 1) * 4 };
      kk.giveItem(0, 'gum'); kk.giveItem(1, 'plane'); kk.giveItem(2, 'rocket3'); kk.giveItem(3, 'foil'); kk.giveItem(4, 'homing');
      H.press[0] = 1; H.press[1] = 1; H.press[3] = 1; H.press[4] = 1;
      H.run(2 / 60);
      kk.giveItem(0, 'gum'); H.hold[0] = true;
      kk.giveItem(P.index, 'rocket');
      H.run(0.25);
      const vis = it.visuals();
      const on = kk.perf();
      vis.root.visible = false;
      kk.renderFrame();
      const off = kk.perf();
      vis.root.visible = true;
      kk.renderFrame();
      const perMesh = vis.meshes.filter((m) => m.visible).map((m) => `${m.name}:${m.count}`);
      let shells = 0;
      for (const k of g.karts) k.visual.object3d.traverse((o) => { if (o.name === 'items:foil') shells++; });
      return { callsOn: on.drawCalls, callsOff: off.drawCalls, itemCalls: on.drawCalls - off.drawCalls + shells, shells, shadowOn: on.shadowCalls, shadowOff: off.shadowCalls, trianglesOn: on.triangles, trianglesOff: off.triangles, perMesh };
    });
    await shot('budget-busy');
    return { ...r, pass: r.itemCalls <= 12 && r.shadowOn === r.shadowOff };
  },

  // ---------------------------------------------------------------------------------------------
  async leaks(page) {
    return page.evaluate(async () => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      if (H.ai) { g.systems.ai = H.ai; H.ai = null; }
      g.api.quitToTitle();
      const listeners0 = kk.listenerCount();
      const leaks0 = kk.leaks().leaks.length;
      for (let n = 0; n < 2; n++) {
        await H.start({ cpuCount: 3 });
        const P = g.player;
        kk.teleport(P.index, 0.06, 0);
        for (let i = 1; i <= 3; i++) H.place(i - 1, 15 * i, 0, 10);
        for (let i = 0; i < 4; i++) H.drive[i] = { throttle: 0.6, lat: 0 };
        kk.giveItem(P.index, 'foil'); H.press[P.index] = 1; H.run(0.2);
        kk.giveItem(0, 'gum'); H.press[0] = 1;
        kk.giveItem(1, 'plane'); H.press[1] = 1;
        kk.giveItem(2, 'ink'); H.press[2] = 1;
        H.run(0.3);
        kk.giveItem(P.index, 'scissors'); H.press[P.index] = 1;
        H.run(0.3);
        kk.giveItem(P.index, 'rocket'); H.press[P.index] = 1;
        H.run(0.2);
      }
      if (H.ai) { g.systems.ai = H.ai; H.ai = null; }
      g.api.quitToTitle();
      const last = kk.leaks();
      return { listeners0, listeners1: kk.listenerCount(), newLeaks: last.leaks.slice(leaks0), lastCheck: last.last, pass: kk.listenerCount() === listeners0 && last.leaks.length === leaks0 };
    });
  },

  // ---------------------------------------------------------------------------------------------
  async race(page, shot) {
    const r = await page.evaluate(async () => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      if (H.ai) { g.systems.ai = H.ai; H.ai = null; }
      H.drive = {}; H.press = {}; H.hold = {}; H.cam = null;
      g.loop.stop();
      await kk.startRace({ track: 'meadow', mode: 'single', autopilot: true, skipIntro: true, seed: 21, cpuCount: 7 });
      g.loop.stop();
      kk.setControls(null);
      const errs0 = kk.errors.length;
      let t = 0;
      let shotAt = -1;
      while (g.race.state !== 'done' && t < 240) {
        kk.simulate(0.5);
        H.frame(1 / 60);
        t += 0.5;
        if (shotAt < 0 && t > 40 && H.items().projectiles.length + H.items().hazards.length > 0) { shotAt = t; break; }
      }
      return { t, shotAt, errors: kk.errors.slice(errs0) };
    });
    if (r.shotAt > 0) await shot('race-mid');
    const r2 = await page.evaluate(() => {
      const H = window.__it, kk = window.__kk, g = kk.game;
      let t = 0;
      while (g.race.state !== 'done' && t < 260) { kk.simulate(1); t += 1; }
      const s = kk.stats();
      const cpus = g.karts.filter((k) => !k.isPlayer).map((k) => k.id);
      const uses = cpus.map((id) => s.itemUses[id] || 0);
      H.frame(1 / 60);
      return { state: g.race.state, raceTime: +g.raceTime.toFixed(1), itemUses: s.itemUses, usesPerCpu: +(uses.reduce((a, b) => a + b, 0) / cpus.length).toFixed(2), errors: kk.errors.slice(), warnings: kk.warnings.filter((w) => /items/i.test(w)) };
    });
    return { ...r, ...r2, pass: r2.state === 'done' && r2.errors.length === 0 };
  },
};

let server = null;
let browser = null;
const results = {};
try {
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await new Promise((r) => setTimeout(r, 100));
  }
  ({ browser } = await launch());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text()}`.slice(0, 300)); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__kk && window.__kk.ready);
  await page.evaluate(() => { window.__kk.setAutoPause(false); window.__kk.game.api.setSetting('quality', 'high'); });
  await page.evaluate(installHelpers);
  const shot = async (name) => {
    if (!shots) return;
    await page.waitForTimeout(60);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  };
  for (const [name, fn] of Object.entries(checks)) {
    if (only && !only.includes(name)) continue;
    const errBefore = await page.evaluate(() => window.__kk.errors.length);
    try {
      results[name] = await fn(page, shot);
    } catch (e) {
      results[name] = { pass: false, threw: String(e && e.stack || e).slice(0, 600) };
    }
    const errs = await page.evaluate((n) => window.__kk.errors.slice(n), errBefore);
    if (errs.length) { results[name].errors = errs.slice(0, 6); results[name].pass = false; }
    console.log(JSON.stringify({ check: name, ...results[name] }));
  }
  const renderer = await page.evaluate(() => window.__kk.perf().renderer);
  console.log(JSON.stringify({ summary: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.pass])), renderer, consoleErrors: consoleErrors.slice(0, 20) }));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
