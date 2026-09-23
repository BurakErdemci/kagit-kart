// Fix round 5 (items + FX look): every item held, in flight and on impact, the boxes, and drift tier-up
// bursts, on a day track and on Boğaz Gecesi. Deterministic: the game loop is stopped and each frame is
// driven here (simulate + visual update + render), with the CPUs as puppets (AI parked).
// Shots go to tools/out/fix5/, plus one contact sheet per subject (tracks × moments).
// node tools/scenarios/fix5.mjs [--port 8795] [--only boxes,items,sparks] [--tracks meadow,bosphorus] [--items rocket,gum]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'out', 'fix5');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const port = +arg('--port', 8795);
const only = arg('--only', '') ? arg('--only', '').split(',') : null;
const TRACKS = arg('--tracks', 'meadow,bosphorus').split(',');
const ITEMS = arg('--items', 'rocket,rocket3,gum,plane,homing,ink,foil,scissors').split(',');
fs.mkdirSync(OUT, { recursive: true });

const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

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
        if (d) {
          c.throttle = d.throttle ?? 1;
          c.steer = d.steer ?? (d.lat === null ? 0 : H.steerTo(k, d.lat ?? 0));
          c.brake = d.brake || 0; c.drift = !!d.drift;
        }
        if (H.press[k.index] > 0) { c.item = true; H.press[k.index]--; }
        if (H.hold[k.index]) c.item = true;
        if (k.isPlayer) kk.setControls(c);
        else Object.assign(k.controls, c);
      }
    },
    run(sec) {
      const n = Math.max(1, Math.round(sec * 60));
      for (let i = 0; i < n; i++) { H.applyDrive(); kk.simulate(1 / 60); H.frame(1 / 60); }
    },
    until(maxSec, cond) {
      const n = Math.round(maxSec * 60);
      for (let i = 0; i < n; i++) {
        if (cond()) return i / 60;
        H.applyDrive(); kk.simulate(1 / 60); H.frame(1 / 60);
      }
      return -1;
    },
    since: 0,
    mark() { H.since = kk.eventSeq(); },
    evs(names) { return kk.events(H.since).filter((e) => names.includes(e.name)); },
    async start(opts = {}) {
      if (H.ai) { g.systems.ai = H.ai; H.ai = null; }
      H.drive = {}; H.press = {}; H.hold = {}; H.cam = null;
      kk.setCamera(null);
      g.loop.stop();
      await kk.startRace({ track: 'meadow', mode: 'single', autopilot: false, skipIntro: true, seed: 7, cpuCount: 3, ...opts });
      g.loop.stop();
      if (g.systems.ai) { H.ai = g.systems.ai; g.systems.ai = null; }
      kk.setControls({ steer: 0, throttle: 0, brake: 0, drift: false, item: false, lookBack: false });
      kk.simulate(3.1);
      H.frame(1 / 60);
      H.mark();
    },
    place(i, dMetres, lat = 0, speed = 0) {
      const L = g.track.length;
      const base = g.player.trackInfo.dist;
      const k = g.karts[i];
      kk.teleport(i, (((base + dMetres) % L) + L) % L / L, lat);
      k.speed = 0;
      if (speed) { k.vel.set(Math.sin(k.heading) * speed, 0, Math.cos(k.heading) * speed); k.speed = speed; }
    },
    fixLaps() {
      kk.simulate(g.config.STEP);
      for (const k of g.karts) { k.crossLap = 1; if (k.lap < 1) k.lap = 1; }
      kk.simulate(g.config.STEP);
    },
    straight(len = 110) {
      const s = g.track.samples, N = g.track.sampleCount, sp = g.track.spacing;
      const w = Math.round(len / sp);
      let best = 0, bestSum = Infinity;
      for (let i = 0; i < N; i += 4) {
        let sum = 0;
        for (let j = 0; j < w; j++) {
          const q = (i + j) % N;
          sum += Math.abs(s.curvature[q]) + ((s.rampId && s.rampId[q] >= 0) || (s.padId && s.padId[q] >= 0) ? 1 : 0);
        }
        const d = s.dist[i];
        if (sum < bestSum && d > 70 && d < g.track.length - len - 70) { bestSum = sum; best = i; }
      }
      return s.dist[best] / g.track.length;
    },
    // Player at the start of the straightest stretch, driving at speed; CPUs parked far behind.
    setup(speed = 20) {
      const P = g.player;
      kk.teleport(P.index, H.straight(), 0);
      P.vel.set(Math.sin(P.heading) * speed, 0, Math.cos(P.heading) * speed);
      P.speed = speed;
      for (const k of g.karts) if (!k.isPlayer) { H.place(k.index, -150 - k.index * 12, 4); H.drive[k.index] = { throttle: 0, lat: null }; }
      H.fixLaps();
      H.drive[P.index] = { throttle: 1, lat: 0 };
      H.run(0.3);
    },
    cpu(n = 0) { return g.karts.filter((k) => !k.isPlayer)[n]; },
  };
  window.__it = H;
}

async function main() {
  let server = null;
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await new Promise((r) => setTimeout(r, 100));
  }
  const { browser, renderer } = await launch();
  const report = { renderer, errors: [], sheets: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => report.errors.push(String(e.message || e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') report.errors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => window.__kk && window.__kk.ready, null, { timeout: 30000 });
    await page.evaluate(() => { window.__kk.setAutoPause(false); window.__kk.logEvents = true; });
    await page.evaluate(installHelpers);

    const files = {};
    const shot = async (subject, track, moment) => {
      const f = path.join(OUT, `${subject}-${track}-${moment}.png`);
      await page.screenshot({ path: f });
      (files[subject] ||= []).push({ track, moment, f });
      return f;
    };
    const ev = (fn, a) => page.evaluate(fn, a);
    const want = (n) => !only || only.includes(n);

    for (const track of TRACKS) {
      if (want('boxes')) {
        await ev(async (track) => {
          const H = window.__it, kk = window.__kk, g = kk.game;
          await H.start({ track, cpuCount: 1 });
          const it = g.systems.items;
          const box = it.boxes[Math.min(4, it.boxes.length - 1)];
          const q = g.track.createQueryInfo();
          g.track.query(box.pos, -1, q);
          const L = g.track.length;
          kk.teleport(g.player.index, ((q.dist - 26) / L + 1) % 1, 0);
          H.place(0, -80, 5);
          H.fixLaps();
          H.drive[g.player.index] = { throttle: 0, lat: 0 };
          H.run(0.4);
        }, track);
        await shot('boxes', track, 'row');
        await ev(() => {
          const H = window.__it, g = window.__kk.game;
          const box = g.systems.items.boxes.find((b) => b.active);
          H.cam = { pos: [box.pos.x + 3.2, box.pos.y + 2.2, box.pos.z + 3.2], look: [box.pos.x, box.pos.y + 0.9, box.pos.z] };
          H.run(0.1);
        });
        await shot('boxes', track, 'close');
      }

      if (want('items')) {
        for (const item of ITEMS) {
          await ev(async ({ track }) => {
            const H = window.__it;
            await H.start({ track, cpuCount: 3 });
            H.setup(20);
          }, { track });
          await ev((item) => { const H = window.__it, kk = window.__kk; kk.giveItem(kk.game.player.index, item); H.run(0.5); }, item);
          if (item !== 'plane' && item !== 'homing' && item !== 'ink' && item !== 'scissors') await shot(item, track, '1-held');
          const plan = await ev((item) => {
            const H = window.__it, kk = window.__kk, g = kk.game, P = g.player;
            const c0 = H.cpu(0), c1 = H.cpu(1);
            H.mark();
            if (item === 'plane' || item === 'homing') {
              H.place(c0.index, 30, 0, 14); H.drive[c0.index] = { throttle: 0.35, lat: 0 };
              H.fixLaps();
              H.press[P.index] = 1;
              H.run(item === 'plane' ? 0.35 : 0.45);
              return 'flyer';
            }
            if (item === 'ink') {
              H.place(c0.index, 35, 2, 16); H.drive[c0.index] = { throttle: 0.5, lat: 2 };
              H.place(c1.index, 48, -2, 16); H.drive[c1.index] = { throttle: 0.5, lat: -2 };
              H.fixLaps();
              H.press[P.index] = 1;
              H.run(0.4);
              return 'ink';
            }
            if (item === 'scissors') {
              H.place(c0.index, 60, 0, 18); H.drive[c0.index] = { throttle: 0.6, lat: 0 };
              H.fixLaps();
              H.press[P.index] = 1;
              H.run(0.9);
              return 'scissors';
            }
            if (item === 'gum') { H.hold[P.index] = true; H.run(0.6); return 'gum'; }
            if (item === 'foil') { H.press[P.index] = 1; H.run(0.6); return 'foil'; }
            H.press[P.index] = 1; H.run(0.12); return 'rocket';
          }, item);
          await shot(item, track, '2-use');
          if (plan === 'flyer') {
            await ev(() => window.__it.run(0.5));
            await shot(item, track, '3-flight');
            await ev(() => { const H = window.__it; H.until(3, () => H.evs(['hit']).length > 0); H.run(0.08); });
            await shot(item, track, '4-impact');
          } else if (plan === 'ink') {
            await ev(() => { const H = window.__it; H.until(2, () => H.evs(['inked']).length > 0); H.run(0.1); });
            await shot(item, track, '3-burst');
            await ev(() => window.__it.run(0.45));
            await shot(item, track, '4-rain');
          } else if (plan === 'scissors') {
            await ev(() => window.__it.run(0.8));
            await shot(item, track, '3-cruise');
            await ev(() => { const H = window.__it; H.until(6, () => H.evs(['projectile']).some((e) => e.detail?.state === 'lock')); H.run(0.35); });
            await shot(item, track, '4-dive');
            await ev(() => { const H = window.__it; H.until(3, () => H.evs(['hit']).length > 0); H.run(0.1); });
            await shot(item, track, '5-impact');
          } else if (plan === 'gum') {
            await ev(() => {
              const H = window.__it, g = window.__kk.game, P = g.player;
              const k = P.visual.object3d;
              const r = { x: -Math.cos(P.heading), z: Math.sin(P.heading) };
              H.cam = { pos: [k.position.x + r.x * 4.5 - Math.sin(P.heading) * 3.5, k.position.y + 1.8, k.position.z + r.z * 4.5 - Math.cos(P.heading) * 3.5],
                look: [k.position.x - Math.sin(P.heading) * 1.6, k.position.y + 0.5, k.position.z - Math.cos(P.heading) * 1.6] };
              H.run(0.05);
            });
            await shot(item, track, '3-held-side');
            await ev(() => {
              const H = window.__it, g = window.__kk.game, P = g.player;
              H.cam = null; H.hold[P.index] = false; H.run(0.05);
              const gum = g.systems.items.hazards.find((h) => !h.held && !h.dead);
              window.__gumPos = gum ? [gum.pos.x, gum.pos.y, gum.pos.z] : null;
              H.run(0.35);
              if (gum) H.cam = { pos: [gum.pos.x + 3, gum.pos.y + 2.2, gum.pos.z + 3], look: [gum.pos.x, gum.pos.y + 0.2, gum.pos.z] };
              H.run(0.05);
            });
            await shot(item, track, '4-dropped');
            await ev(() => {
              const H = window.__it, kk = window.__kk, g = kk.game;
              const gum = g.systems.items.hazards.find((h) => !h.held && !h.dead);
              if (!gum) return;
              const c0 = H.cpu(0);
              const q = g.track.createQueryInfo();
              g.track.query(gum.pos, -1, q);
              const L = g.track.length;
              kk.teleport(c0.index, ((q.dist - 14) / L + 1) % 1, q.lateral);
              c0.vel.set(Math.sin(c0.heading) * 16, 0, Math.cos(c0.heading) * 16); c0.speed = 16;
              H.drive[c0.index] = { throttle: 1, lat: q.lateral };
              H.drive[g.player.index] = { throttle: 0, lat: 0 };
              H.mark();
              H.until(2, () => H.evs(['hit']).length > 0);
              H.run(0.1);
            });
            await shot(item, track, '5-impact');
          } else if (plan === 'foil') {
            await ev(() => window.__it.run(0.6));
            await shot(item, track, '3-chase');
            await ev(() => {
              const H = window.__it, g = window.__kk.game, P = g.player;
              const k = P.visual.object3d;
              H.cam = { pos: [k.position.x - Math.cos(P.heading) * 5 + Math.sin(P.heading) * 2, k.position.y + 2.0, k.position.z + Math.sin(P.heading) * 5 + Math.cos(P.heading) * 2],
                look: [k.position.x, k.position.y + 0.8, k.position.z] };
              H.run(0.05);
            });
            await shot(item, track, '4-side');
          } else {
            await ev(() => window.__it.run(0.5));
            await shot(item, track, '3-boost');
            if (item === 'rocket3') {
              await ev(() => { const H = window.__it, P = window.__kk.game.player; H.run(1.2); H.press[P.index] = 1; H.run(0.1); });
              await shot(item, track, '4-second');
            } else {
              await ev(() => window.__it.run(0.8));
              await shot(item, track, '4-spent');
            }
          }
        }
      }

      if (want('sparks')) {
        await ev(async (track) => {
          const H = window.__it;
          await H.start({ track, cpuCount: 1 });
          H.setup(22);
        }, track);
        // The burst is FX's answer to the kart's `drift {state:'tier'}` event: emitted here on a straight so
        // every tier is shot from the normal chase view.
        for (const tier of [1, 2, 3]) {
          await ev((tier) => {
            const H = window.__it, g = window.__kk.game, P = g.player;
            H.drive[P.index] = { throttle: 1, lat: 0 };
            H.run(0.4);
            g.events.emit('drift', { kart: P, state: 'tier', tier });
            H.run(0.05);
          }, tier);
          await shot('sparks', track, `tier${tier}`);
          await ev(() => window.__it.run(0.1));
          await shot('sparks', track, `tier${tier}-b`);
        }
      }
    }

    report.perf = await ev(() => window.__kk.perf());
    report.pageErrors = await ev(() => [...window.__kk.errors, ...window.__kk.warnings].slice(0, 20));

    // contact sheets: one per subject, tracks as rows, moments as columns
    const sheet = await browser.newPage({ viewport: { width: 1920, height: 400 } });
    for (const [subject, list] of Object.entries(files)) {
      const tracks = [...new Set(list.map((x) => x.track))];
      const moments = [...new Set(list.map((x) => x.moment))];
      const w = Math.min(640, Math.floor(1920 / moments.length)), hgt = Math.round(w * 9 / 16);
      const cells = tracks.map((t) => moments.map((m) => {
        const e = list.find((x) => x.track === t && x.moment === m);
        return e ? `<img src="data:image/png;base64,${fs.readFileSync(e.f).toString('base64')}" style="width:${w}px;height:${hgt}px;display:block">` : `<div style="width:${w}px;height:${hgt}px"></div>`;
      }).join('')).map((r) => `<div style="display:flex;gap:4px">${r}</div>`).join('');
      await sheet.setViewportSize({ width: w * moments.length + 4 * moments.length, height: (hgt + 22) * tracks.length + 30 });
      await sheet.setContent(`<body style="margin:0;background:#222;color:#eee;font:14px sans-serif"><div style="padding:4px">${subject}: ${moments.join(' | ')} — rows ${tracks.join(', ')}</div><div style="display:flex;flex-direction:column;gap:4px">${cells}</div></body>`);
      const f = path.join(OUT, `sheet-${subject}.png`);
      await sheet.screenshot({ path: f, fullPage: true });
      report.sheets.push(f.replace(/\\/g, '/'));
    }
    await ev(() => { const H = window.__it; if (H.ai) { window.__kk.game.systems.ai = H.ai; H.ai = null; } window.__kk.game.api.quitToTitle(); });
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  console.log(JSON.stringify(report, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
