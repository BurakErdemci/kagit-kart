// Core physics checks on the placeholder track: offroad cap, drift tiers + boost, ramp + trick,
// wall hit, water-edge respawn, start boost, boost pad. Prints one JSON object per check.
// node tools/scenarios/core.mjs [--port 8765]
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = +(process.argv[process.argv.indexOf('--port') + 1] || 8765) || 8765;

const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

let server = null;
let browser = null;
try {
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await new Promise((r) => setTimeout(r, 100));
  }
  ({ browser } = await launch());
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__kk && window.__kk.ready);

  const results = await page.evaluate(async () => {
    const kk = window.__kk;
    const g = kk.game;
    kk.setAutoPause(false);
    kk.setTimeScale(1);
    const out = {};
    const STEP = g.config.STEP;
    const evFrom = (n0, names) => kk.events(n0).filter((e) => names.includes(e.name));

    // Solo race (time trial) so nothing else interferes.
    await kk.startRace({ track: 'meadow', mode: 'tt', autopilot: false, skipIntro: true, seed: 3 });
    g.loop.stop(); // drive everything through simulate()
    kk.setControls({ throttle: 0, brake: 0, steer: 0, drift: false });
    kk.simulate(3.2);
    const P = () => g.player;
    const L = g.track.length;

    function steerToCentre(k, extra = 0) {
      const info = k.trackInfo;
      const ahead = {};
      g.track.pointAt((info.dist + 8 + Math.max(0, k.speed) * 0.4) / L, 0, ahead);
      const desired = Math.atan2(ahead.pos.x - k.pos.x, ahead.pos.z - k.pos.z);
      let err = desired - k.heading;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      return Math.max(-1, Math.min(1, -err * 2.5 + extra));
    }
    function run(seconds, ctl) {
      const n = Math.round(seconds / STEP);
      for (let i = 0; i < n; i++) {
        const c = ctl(P(), i);
        if (c === false) return i * STEP;
        kk.setControls(c);
        kk.simulate(STEP);
      }
      return seconds;
    }
    function speedUp(t, target = 22) {
      kk.teleport(P().index, t, 0);
      run(6, (k) => (k.speed >= target ? false : { throttle: 1, steer: steerToCentre(k), drift: false, brake: 0 }));
    }

    // 1. offroad cap: bottom straight, right-hand band (edge none)
    kk.teleport(P().index, 0.74, 15);
    run(5, (k) => ({ throttle: 1, steer: 0, drift: false }));
    out.offroad = { surface: P().surface, speed: +P().speed.toFixed(2), top: +P().topSpeed.toFixed(2), ratio: +(P().speed / P().topSpeed).toFixed(3), expected: 0.55 };

    // 2. drift through the tongue's 180° left hairpin
    speedUp(0.74);
    const hair = g.track.analysis.corners.find((c) => c.dir > 0 && c.turnDeg > 150);
    kk.teleport(P().index, hair.t - 12 / L, 0);
    let n0 = kk.eventSeq();
    let phase = 'hop';
    let held = 0;
    const tStart = g.raceTime;
    run(7, (k, i) => {
      if (phase === 'hop') {
        if (k.drift.active) phase = 'drift';
        return { throttle: 1, steer: -1, drift: true };
      }
      if (phase === 'drift') {
        held += STEP;
        const lat = k.trackInfo.lateral;
        const steer = Math.max(-1, Math.min(1, -0.25 - 0.22 * lat));
        const remaining = Math.abs(k.trackInfo.dist - (hair.to * g.track.spacing));
        if (!k.drift.active || (held > 2.0 && remaining < 6)) { phase = 'out'; return { throttle: 1, steer: 0, drift: false }; }
        return { throttle: 1, steer, drift: true };
      }
      if (g.raceTime - tStart > 6.5) return false;
      return { throttle: 1, steer: steerToCentre(k), drift: false };
    });
    const dEv = evFrom(n0, ['hop', 'drift', 'boost']);
    out.drift = {
      hairpinArc: +hair.arc.toFixed(1), heldSeconds: +held.toFixed(2),
      events: dEv.map((e) => `${e.t.toFixed(2)} ${e.name}${e.detail.state ? ':' + e.detail.state : ''}${e.detail.tier != null ? ' tier' + e.detail.tier : ''}${e.detail.source ? ' ' + e.detail.source + ' ' + e.detail.duration : ''}`),
    };

    // 3. ramp + trick (press drift 0.15 s before the lip)
    const ramp = g.track.ramps[0];
    speedUp(0.74, 23);
    kk.teleport(P().index, (ramp.d0 - 30) / L, 0);
    n0 = kk.eventSeq();
    let pressed = false;
    let maxAir = 0;
    run(5, (k) => {
      maxAir = Math.max(maxAir, k.airTime);
      const toLip = ramp.d1 - k.trackInfo.dist;
      let drift = false;
      if (!pressed && k.grounded && toLip > 0 && toLip < k.speed * 0.15) { pressed = true; drift = true; }
      return { throttle: 1, steer: steerToCentre(k), drift };
    });
    const rEv = evFrom(n0, ['trick', 'land', 'boost']);
    out.ramp = {
      height: ramp.height, length: ramp.length,
      events: rEv.map((e) => `${e.t.toFixed(2)} ${e.name}${e.detail.airTime != null ? ' air ' + e.detail.airTime.toFixed(2) + 's' : ''}${e.detail.source ? ' ' + e.detail.source + ' ' + e.detail.duration : ''}`),
    };

    // 4. wall hit at 45°: ramp straight (wall on the right), start inside the band, aim right into the wall
    kk.teleport(P().index, 0.60, 15);
    {
      const k = P();
      k.heading -= Math.PI / 4;
      const sp = 20;
      k.vel.set(Math.sin(k.heading) * sp, 0, Math.cos(k.heading) * sp);
      k.speed = sp;
    }
    n0 = kk.eventSeq();
    run(2, (k) => ({ throttle: 1, steer: 0, drift: false }));
    const wEv = evFrom(n0, ['wallHit']);
    out.wall = wEv.slice(0, 2).map((e) => ({ speedBefore: +e.detail.speed.toFixed(2), kept: +e.detail.kept.toFixed(3), angleDeg: +(e.detail.angle * 180 / Math.PI).toFixed(1) }));

    // 5. respawn: drive off the water edge on the bottom straight
    kk.teleport(P().index, 0.76, -14);
    {
      const k = P();
      k.heading += 0.9; // toward the left (water) side
      k.vel.set(Math.sin(k.heading) * 12, 0, Math.cos(k.heading) * 12);
    }
    n0 = kk.eventSeq();
    const t0 = g.raceTime;
    let fellAt = null;
    run(6, (k) => {
      if (fellAt == null && !k.grounded) fellAt = g.raceTime - t0;
      if (!k.respawn.active && evFrom(n0, ['respawn']).length >= 3 && g.raceTime - t0 > 3) return false;
      return { throttle: 1, steer: 0, drift: false };
    });
    const sp = P();
    out.respawn = {
      events: evFrom(n0, ['respawn']).map((e) => `${(e.t - t0).toFixed(2)} ${e.detail.stage}`),
      leftGroundAfter: fellAt != null ? +fellAt.toFixed(2) : null,
      after: { surface: sp.surface, lateral: +sp.trackInfo.lateral.toFixed(2), grounded: sp.grounded, grace: +sp.graceTime.toFixed(2) },
    };

    // 6. boost pad
    kk.teleport(P().index, (g.track.pads[0].d0 - 20) / L, 0);
    n0 = kk.eventSeq();
    run(3, (k) => ({ throttle: 1, steer: steerToCentre(k), drift: false }));
    out.pad = evFrom(n0, ['boost']).map((e) => `${e.detail.source} ${e.detail.duration}`);

    // 7. start boosts: perfect (press at −0.8 s) and burnout (press during "3")
    async function startTest(pressAt) {
      await kk.startRace({ track: 'meadow', mode: 'single', autopilot: false, skipIntro: true, seed: 5 });
      g.loop.stop();
      let t = 3.0;
      kk.setControls({ throttle: 0 });
      while (g.phase === 'countdown') {
        kk.setControls({ throttle: t <= pressAt ? 1 : 0 });
        kk.simulate(STEP);
        t -= STEP;
      }
      const grade = g.race.startGrade;
      kk.simulate(0.5);
      return { grade, boostSource: P().boostSource, spin: P().spinCause, speedAfter05: +P().speed.toFixed(2) };
    }
    out.startPerfect = await startTest(0.8);
    out.startGood = await startTest(0.5);
    out.startBurnout = await startTest(2.5);
    kk.setControls(null);
    g.loop.start();
    g.api.quitToTitle();
    out.errors = kk.errors.slice();
    return out;
  });
  for (const [k, v] of Object.entries(results)) console.log(JSON.stringify({ check: k, result: v }));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
