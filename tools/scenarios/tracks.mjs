// In-game check of the four chapters and their scenery (tracks agent).
//   node tools/scenarios/tracks.mjs [--port 8771] [--tracks meadow,bosphorus,glacier,desk] [--no-shots]
// Per track, in the live loop (autopilot, timeScale 1):
//   - top-down map shot and one chase shot per scenery anchor (def.decor), arriving from 110 m out
//     so the pop-up wave has really run: tools/out/tracks/<track>-<anchor>.png
//   - scenery draw calls in isolation (frame with and without the scenery group), whole-frame
//     calls/triangles, popup event rate (max in any 1 s window)
//   - every popup ramp: distance of the kart to the ramp foot when the ramp came to rest upright
//   - reduced motion snaps, look-back holds props that are already behind
//   - three races on the track: core's teardown leak check must stay empty
// Prints one JSON line per track; exit code 1 on errors, layout warnings, leaks or a failed rule.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'out', 'tracks');
fs.mkdirSync(OUT, { recursive: true });
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const port = +arg('--port', 8771);
const tracks = arg('--tracks', 'meadow,bosphorus,glacier,desk').split(',');
const shotsOn = !process.argv.includes('--no-shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

let server = null;
let browser = null;
let failed = false;
try {
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await sleep(100);
  }
  ({ browser } = await launch());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__kk && window.__kk.ready, null, { timeout: 60000 });
  await page.evaluate(() => { window.__kk.setAutoPause(false); window.__kk.setTimeScale(1); });

  const shot = async (name) => { if (shotsOn) await page.screenshot({ path: path.join(OUT, name) }); };

  for (const id of tracks) {
    const errors0 = await page.evaluate(() => window.__kk.errors.length);
    const setup = await page.evaluate(async (id) => {
      const kk = window.__kk;
      const g = kk.game;
      await kk.startRace({ track: id, mode: 'single', autopilot: true, skipIntro: true, seed: 7 });
      const decor = g.trackDef.decor || {};
      const anchors = [];
      for (const [name, v] of Object.entries(decor)) anchors.push([name, Array.isArray(v) ? v[0] : v]);
      const ramps = g.track.ramps.filter((r) => r.popup).map((r) => ({ index: r.index, d0: r.d0 }));
      const unfoldApi = g.track.rampMeshes.some((m) => typeof m.setUnfold === 'function' || typeof m.object3d?.setUnfold === 'function');
      return { anchors, ramps, length: g.track.length, unfoldApi };
    }, id);
    await page.waitForFunction(() => window.__kk.game.phase === 'race', null, { timeout: 20000 });

    // Map view.
    await page.evaluate(() => { window.__kk.setCamera('top'); });
    await sleep(400);
    await shot(`${id}-top.png`);
    await page.evaluate(() => { window.__kk.setCamera(null); });

    // Anchors, reached by driving.
    const shots = [];
    for (const [name, t] of setup.anchors) {
      const seq = await page.evaluate(({ t, L }) => {
        const kk = window.__kk;
        kk.teleport(kk.game.player.index, ((t - 110 / L) % 1 + 1) % 1, 0);
        return kk.eventSeq();
      }, { t, L: setup.length });
      await sleep(3300);
      await shot(`${id}-${name}.png`);
      const r = await page.evaluate((seq) => {
        const kk = window.__kk;
        const g = kk.game;
        const sc = g.systems.scenery;
        kk.renderFrame();
        const all = kk.perf();
        sc.group.visible = false;
        kk.renderFrame();
        const bare = kk.perf();
        sc.group.visible = true;
        kk.renderFrame();
        const pops = kk.events(seq).filter((e) => e.name === 'popup').map((e) => e.t);
        let maxPerSec = 0;
        for (let i = 0; i < pops.length; i++) {
          let n = 0;
          for (let j = i; j < pops.length && pops[j] - pops[i] < 1; j++) n++;
          maxPerSec = Math.max(maxPerSec, n);
        }
        return {
          drawCalls: all.drawCalls, triangles: all.triangles, sceneryCalls: all.drawCalls - bare.drawCalls,
          sceneryTriangles: all.triangles - bare.triangles, popups: pops.length, maxPopupsPerSec: maxPerSec,
        };
      }, seq);
      shots.push({ name, ...r });
    }

    // Popup ramps: where is the kart when the ramp has finished rising?
    const rampChecks = [];
    for (const rp of setup.ramps) {
      await page.evaluate(({ d0, L }) => {
        const kk = window.__kk;
        const g = kk.game;
        kk.teleport(g.player.index, ((d0 - 230) / L % 1 + 1) % 1, 0);
        // Each probe owns its object: a loop left over from the previous ramp must not write here.
        const p = window.__kkRampProbe = { restAhead: null, minA: 1 };
        const ramp = g.systems.scenery.popups.ramps.find((r) => Math.abs(r.s - d0) < 1);
        const loop = () => {
          if (window.__kkRampProbe !== p || !ramp || !g.player) return;
          p.minA = Math.min(p.minA, ramp.a);
          let ahead = d0 - g.player.trackInfo.dist;
          ahead -= Math.round(ahead / L) * L;
          if (p.restAhead == null && ramp.target === 1 && ramp.a === 1 && p.minA < 0.5) p.restAhead = +ahead.toFixed(1);
          if (ahead > -20) requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      }, { d0: rp.d0, L: setup.length });
      await sleep(9000);
      const res = await page.evaluate(() => window.__kkRampProbe);
      rampChecks.push({ ramp: rp.index, foldedAtStart: res.minA < 0.05, restAheadOfKart: res.restAhead });
      await page.evaluate(() => { window.__kkRampProbe = null; });
    }

    // Reduced motion: every prop is exactly folded or upright after one frame.
    const reduced = await page.evaluate(async ({ t, L }) => {
      const kk = window.__kk;
      const g = kk.game;
      g.api.setSetting('reducedMotion', true);
      kk.teleport(g.player.index, ((t - 60 / L) % 1 + 1) % 1, 0);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      let between = 0, up = 0;
      for (const ty of g.systems.scenery.popups.types) {
        if (!ty.a) continue;
        for (let i = 0; i < ty.a.length; i++) { if (ty.a[i] > 0.001 && ty.a[i] < 0.999) between++; if (ty.a[i] > 0.999) up++; }
      }
      g.api.setSetting('reducedMotion', 'auto');
      return { between, up };
    }, { t: setup.anchors[0]?.[1] ?? 0.5, L: setup.length });

    // Look-back: props already 60+ m behind stay up while the rig looks back, fold after.
    const behindUp = () => page.evaluate(() => {
      const g = window.__kk.game;
      const L = g.track.length;
      const camS = g.player.trackInfo.dist;
      let upBehind = 0, foldingBehind = 0;
      for (const ty of g.systems.scenery.popups.types) {
        if (!ty.a) continue;
        for (let i = 0; i < ty.a.length; i++) {
          let ahead = ty.s[i] - camS;
          ahead -= Math.round(ahead / L) * L;
          if (ahead < -75 && ahead > -200 && !ty.items[i].alwaysUp) { if (ty.target[i]) upBehind++; else if (ty.a[i] > 0.01) foldingBehind++; }
        }
      }
      return { upBehind, foldingBehind };
    });
    await page.evaluate(() => { window.__kk.game.cameraRig.lookBack = true; });
    await sleep(3500);
    const during = await behindUp();
    await shot(`${id}-lookback.png`);
    await page.evaluate(() => { window.__kk.game.cameraRig.lookBack = false; });
    await sleep(400);
    const after = await behindUp();

    // Three races on this track: each teardown is checked by core against its pre-setup snapshot.
    const leak = await page.evaluate(async (id) => {
      const kk = window.__kk;
      kk.game.api.quitToTitle();
      const listeners0 = kk.listenerCount();
      const leaks0 = kk.leaks().leaks.length;
      for (const seed of [8, 9]) {
        await kk.startRace({ track: id, mode: 'single', autopilot: true, skipIntro: true, seed });
        kk.simulate(3);
        kk.renderFrame();
      }
      kk.game.api.quitToTitle();
      return { listenersDelta: kk.listenerCount() - listeners0, newLeaks: kk.leaks().leaks.slice(leaks0), last: kk.leaks().last };
    }, id);

    const res = await page.evaluate((e0) => ({
      warnings: window.__kk.layoutWarnings().filter((w) => w.includes('[track:')),
      errors: window.__kk.errors.slice(e0),
    }), errors0);
    const trackWarnings = res.warnings.filter((w) => w.startsWith(`[track:${id}]`));
    const worst = shots.reduce((a, b) => (b.sceneryCalls > a.sceneryCalls ? b : a), { sceneryCalls: 0 });
    const line = {
      track: id,
      layoutWarnings: trackWarnings,
      errors: res.errors,
      sceneryCallsWorst: worst.sceneryCalls, sceneryCallsWorstAt: worst.name,
      drawCallsWorst: Math.max(...shots.map((s) => s.drawCalls)),
      trianglesWorst: Math.max(...shots.map((s) => s.triangles)),
      sceneryTrianglesWorst: Math.max(...shots.map((s) => s.sceneryTriangles)),
      maxPopupsPerSec: Math.max(...shots.map((s) => s.maxPopupsPerSec)),
      popupsPerShot: shots.map((s) => `${s.name}:${s.popups}`).join(' '),
      ramps: rampChecks, unfoldApi: setup.unfoldApi,
      reducedMotion: reduced,
      lookBack: { during, after },
      leak,
    };
    const rules = [];
    if (trackWarnings.length) rules.push('layout warnings');
    if (res.errors.length) rules.push('console errors');
    if (leak.newLeaks.length || leak.listenersDelta !== 0) rules.push('leak');
    if (line.sceneryCallsWorst > 120) rules.push('scenery draw calls > 120');
    if (line.drawCallsWorst > 250) rules.push('frame draw calls > 250');
    if (line.trianglesWorst > 700000) rules.push('triangles > 700k');
    if (line.maxPopupsPerSec > 6) rules.push('popup events > 6/s');
    for (const r of rampChecks) if (!r.foldedAtStart || r.restAheadOfKart == null || r.restAheadOfKart < 40) rules.push(`ramp ${r.ramp} rise`);
    if (reduced.between > 0) rules.push('reduced motion does not snap');
    if (during.foldingBehind > 0) rules.push('look-back does not hold props');
    if (after.upBehind > 0) rules.push('props stay up after look-back');
    line.failed = rules;
    if (rules.length) failed = true;
    console.log(JSON.stringify(line));
  }
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
process.exitCode = failed ? 1 : 0;
