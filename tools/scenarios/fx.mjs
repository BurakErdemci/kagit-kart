// FX checks: drives the race frame by frame (loop stopped; each frame mirrors main.js frame()), stages
// every effect and saves canvas captures to tools/out/fx/. Prints one JSON object per check, then a
// summary with FX draw calls, errors, warnings and the two-race leak check.
// node tools/scenarios/fx.mjs [--port 8776] [--only name,name] [--track meadow]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'out', 'fx');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const port = +arg('--port', 8776);
const only = arg('--only', '') ? new Set(arg('--only', '').split(',')) : null;
const trackId = arg('--track', 'meadow');
fs.mkdirSync(OUT, { recursive: true });

const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

// In-page helpers: frame() mirrors main.js frame() for a stopped loop; drive() runs frames with a
// controller; shot() returns the canvas right after a render (no HUD).
function installHelpers() {
  const kk = window.__kk;
  const g = kk.game;
  const H = {
    t: 0,
    frame(dt = 1 / 60) {
      kk.simulate(dt);
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
      g.systems.scenery?.update(dt, g.camera);
      g.systems.fx?.update(dt, 1);
      H.t += dt;
      g.materials.update(H.t);
      if (g.player?.visual) g.renderer.sunTarget.copy(g.player.visual.object3d.position);
      kk.renderFrame();
    },
    wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); },
    steerTo(k, lat = 0, ahead = 8) {
      const L = g.track.length;
      const p = g.track.pointAt(((k.trackInfo.dist + ahead + Math.max(0, k.speed) * 0.4) / L) % 1, lat, {});
      const desired = Math.atan2(p.pos.x - k.pos.x, p.pos.z - k.pos.z);
      return Math.max(-1, Math.min(1, -H.wrap(desired - k.heading) * 2.5));
    },
    // Approach on the line, hop at the corner entry, then hold the drift on the road by steering in
    // (more yaw) when the kart slides outward or lags the track direction, out otherwise.
    driftCtl(k, dir, d0) {
      const L = g.track.length;
      if (!k.drift.active && !k.hop.active) {
        let toCorner = d0 - k.trackInfo.dist;
        if (toCorner < -L / 2) toCorner += L;
        if (toCorner > 3) return { throttle: 1, steer: H.steerTo(k), drift: false };
        return { throttle: 1, steer: -dir, drift: !k.controls.drift || k.drift.active || k.hop.active ? true : false };
      }
      if (k.hop.active) return { throttle: 1, steer: -dir, drift: true };
      const p = g.track.pointAt(((k.trackInfo.dist + 6 + k.speed * 0.3) / L) % 1, 0, {});
      const err = H.wrap(Math.atan2(p.pos.x - k.pos.x, p.pos.z - k.pos.z) - k.heading);
      const outward = k.trackInfo.lateral * -k.drift.dir;
      const a = Math.max(-1, Math.min(1, 0.1 + 0.3 * outward + 2.2 * err * -k.drift.dir));
      return { throttle: 1, steer: k.drift.dir * a, drift: true };
    },
    // controller(k, i) → controls | false (stop)
    drive(frames, controller) {
      for (let i = 0; i < frames; i++) {
        const c = controller(g.player, i);
        if (c === false) return i;
        kk.setControls(c);
        H.frame();
      }
      return frames;
    },
    place(t, lat, speed, headingOffset = 0) {
      const k = g.player;
      kk.teleport(k.index, t, lat);
      k.heading += headingOffset;
      k.vel.set(Math.sin(k.heading) * speed, 0, Math.cos(k.heading) * speed);
      k.speed = speed;
      k.updateQuat(1, true);
      k.prevQuat.copy(k.quat);
      g.cameraRig.snap();
    },
    // Render and read back in the same task: the drawing buffer is not preserved after compositing.
    shot() { kk.renderFrame(); return g.renderer.domElement.toDataURL('image/png'); },
    fx() { return g.systems.fx?.debug?.() ?? null; },
    // NDC y range of the player's crane (body and wings, every vertex) and its drawn string length.
    craneView() {
      const T = g.THREE; const fx = g.systems.fx; g.camera.updateMatrixWorld();
      const i = fx.debug().cranes.findIndex((c) => c.kart === g.player.id);
      if (i < 0) return null;
      const ms = fx.meshes(); const bodies = ms[3]; const wings = ms[4];
      const m = new T.Matrix4(); const v = new T.Vector3();
      const range = (mesh, idx) => {
        let lo = 9, hi = -9;
        mesh.getMatrixAt(idx, m);
        const p = mesh.geometry.attributes.position;
        for (let j = 0; j < p.count; j++) { v.fromBufferAttribute(p, j).applyMatrix4(m).project(g.camera); lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); }
        return [lo, hi];
      };
      const b = range(bodies, i), w1 = range(wings, 2 * i), w2 = range(wings, 2 * i + 1);
      const c = fx.debug().cranes[i];
      return { body: b, wingTop: Math.max(w1[1], w2[1]), attached: c.attached, phase: c.phase, string: c.string };
    },
  };
  window.__fxt = H;
}

let server = null;
let browser = null;
const results = {};
const shots = [];
try {
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await new Promise((r) => setTimeout(r, 100));
  }
  let renderer;
  ({ browser, renderer } = await launch());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleLines = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleLines.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => consoleLines.push(`pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__kk && window.__kk.ready, null, { timeout: 120000 });
  await page.evaluate(installHelpers);

  const save = async (name) => {
    const url = await page.evaluate(() => window.__fxt.shot());
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    shots.push(path.relative(ROOT, file).replace(/\\/g, '/'));
  };
  const want = (name) => !only || only.has(name);

  // Off a water/void edge: the crane is summoned while the kart falls, before the lift starts.
  async function fallTest(shotName) {
    const r = await page.evaluate(() => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt; const s = g.track.samples; const N = g.track.sampleCount;
      let found = null;
      for (let i = 0; i < N && !found; i += 4) {
        for (const [arr, side] of [[s.edgeRight, 1], [s.edgeLeft, -1]]) {
          if ((arr[i] === 2 || arr[i] === 3) && arr[(i + 10) % N] === arr[i]) { found = { t: i / N, side, code: arr[i], hw: s.halfWidth[i], off: s.offroad[i] }; break; }
        }
      }
      if (!found) return null;
      H.place(found.t, found.side * (found.hw + found.off - 1), 12, -found.side * 0.6);
      const log = [];
      let summonedBeforeLift = null;
      H.drive(300, (k, i) => {
        const c = H.fx().cranes.filter((x) => x.phase !== 'out').length;
        if (summonedBeforeLift === null && c > 0) summonedBeforeLift = !k.respawn.active;
        if (i % 20 === 0) log.push({ i, grounded: k.grounded, y: +k.pos.y.toFixed(1), stage: k.respawn.stage, cranes: c });
        if (k.respawn.active && k.respawn.stage === 'lift' && k.respawn.t > 0.25) return false;
        return { throttle: 1, steer: 0, drift: false };
      });
      return { found, summonedBeforeLift, log };
    });
    if (r) await save(shotName);
    await page.evaluate(() => window.__fxt.drive(150, () => ({ throttle: 0, steer: 0, drift: false })));
    return r;
  }


  async function newRace(track, seed = 7) {
    await page.evaluate(async ({ track, seed }) => {
      const kk = window.__kk;
      const g = kk.game;
      kk.setAutoPause(false);
      kk.logEvents = true;
      await kk.startRace({ track, mode: 'single', autopilot: false, skipIntro: true, seed });
      g.loop.stop();
      window.__fxt.t = 0;
      kk.setControls({ throttle: 0, brake: 0, steer: 0, drift: false });
    }, { track, seed });
  }

  await newRace(trackId);

  // Start: throttle 0.8 s before GO → perfect start boost (flames + speed lines).
  if (want('start')) {
    const r = await page.evaluate(() => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt;
      let n = 0;
      while (g.phase === 'countdown' && n < 400) {
        const toGo = g.race.timeToGo;
        kk.setControls({ throttle: toGo <= 0.8 ? 1 : 0, steer: 0, drift: false });
        H.frame(); n++;
      }
      for (let i = 0; i < 9; i++) { kk.setControls({ throttle: 1, steer: H.steerTo(g.player), drift: false }); H.frame(); }
      return { phase: g.phase, grade: g.race.startGrade, boost: g.player.boostTime, source: g.player.boostSource, fx: H.fx() };
    });
    results.start = r;
    await save('start-boost');
  } else {
    await page.evaluate(() => { const kk = window.__kk; const g = kk.game; while (g.phase === 'countdown') { kk.setControls({ throttle: 0 }); window.__fxt.frame(); } });
  }

  // Drift through the tightest long corner: shots right after each tier-up, then the release boost.
  if (want('drift')) {
    const info = await page.evaluate(() => {
      const g = window.__kk.game;
      const c = g.track.analysis.corners.filter((x) => x.arc >= 50).sort((a, b) => b.turnDeg - a.turnDeg)[0];
      return { t: c.t, dir: c.dir, arc: c.arc, turnDeg: c.turnDeg, d0: g.track.samples.dist[c.from], L: g.track.length };
    });
    await page.evaluate(({ d0, L }) => window.__fxt.place(((d0 - 45) / L + 1) % 1, 0, 21), info);
    const tiers = [];
    for (let tier = 1; tier <= 3; tier++) {
      const r = await page.evaluate(({ dir, d0, tier }) => {
        const kk = window.__kk; const g = kk.game; const H = window.__fxt;
        const n = H.drive(480, (k) => {
          if (k.drift.active && k.drift.tier >= tier) return false;
          return H.driftCtl(k, dir, d0);
        });
        H.drive(3, (k) => H.driftCtl(k, dir, d0));
        const p = g.player;
        return { tier: p.drift.tier, active: p.drift.active, charge: +p.drift.charge.toFixed(2), frames: n, surface: p.surface, lat: +p.trackInfo.lateral.toFixed(1), speed: +p.speed.toFixed(1) };
      }, { dir: info.dir, d0: info.d0, tier });
      tiers.push(r);
      await save(`drift-t${tier}`);
      if (!r.active) break;
    }
    const rel = await page.evaluate(() => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt;
      H.drive(6, (k) => ({ throttle: 1, steer: H.steerTo(k), drift: false }));
      return { boost: +g.player.boostTime.toFixed(2), source: g.player.boostSource, fx: H.fx() };
    });
    results.drift = { corner: info, tiers, release: rel };
    await save('drift-release');
  }

  // Straight with open offroad on the right (no wall), away from the start gantry, where nothing
  // stands between the chase camera and the kart (checked with a ray): found once, reused.
  const straight = await page.evaluate(() => {
    const kk = window.__kk; const g = kk.game; const H = window.__fxt;
    const s = g.track.samples; const N = g.track.sampleCount; const T = g.THREE;
    const startI = g.track.startIndex || 0;
    const ray = new T.Raycaster();
    const target = new T.Vector3();
    for (let i = 0; i < N; i += 12) {
      const fromStart = Math.min((i - startI + N) % N, (startI - i + N) % N);
      if (fromStart < 90) continue;
      let ok = true;
      for (let j = 0; j < 40 && ok; j++) {
        const m = (i + j) % N;
        if (Math.abs(s.curvature[m]) > 1 / 300 || s.edgeRight[m] !== 0 || s.offroad[m] < 6 || s.rampId[m] >= 0 || s.padId[m] >= 0) ok = false;
      }
      if (!ok) continue;
      H.place(i / N, 0, 16);
      H.drive(10, (k) => ({ throttle: 1, steer: H.steerTo(k), drift: false }));
      target.copy(g.player.visual.object3d.position).y += 1;
      const dist = g.camera.position.distanceTo(target);
      ray.set(g.camera.position, target.clone().sub(g.camera.position).normalize());
      ray.far = dist - 1.5;
      const hits = ray.intersectObjects(g.scene.children, true).filter((h) => !String(h.object.name).startsWith('fx:') && h.object.name !== 'sky');
      if (hits.length === 0) return { t: i / N, halfWidth: s.halfWidth[i], offroad: s.offroad[i] };
    }
    return null;
  });
  results.straight = straight;

  if (want('offroad') && straight) {
    results.offroad = await page.evaluate((st) => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt;
      H.place(st.t, st.halfWidth + 3, 16);
      H.drive(30, (k) => ({ throttle: 1, steer: H.steerTo(k, st.halfWidth + 3, 8), drift: false }));
      return { surface: g.player.surface, speed: +g.player.speed.toFixed(1), fx: H.fx() };
    }, straight);
    await save('offroad');
  }

  if (want('hop') && straight) {
    results.hop = await page.evaluate((st) => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt;
      H.place(st.t, 0, 20);
      H.drive(10, (k) => ({ throttle: 1, steer: H.steerTo(k), drift: false }));
      kk.setControls({ throttle: 1, steer: 0, drift: true }); H.frame();
      H.drive(4, (k) => ({ throttle: 1, steer: 0, drift: true }));
      return { hop: g.player.hop.active, grounded: g.player.grounded };
    }, straight);
    await save('hop');
    results.hopLand = await page.evaluate(() => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt;
      H.drive(60, (k) => (k.grounded ? false : { throttle: 1, steer: 0, drift: false }));
      H.drive(5, (k) => ({ throttle: 1, steer: 0, drift: false }));
      return { grounded: g.player.grounded, fx: H.fx() };
    });
    await save('hop-land');
  }

  if (want('ramp')) {
    results.ramp = await page.evaluate(() => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt;
      const ramp = g.track.ramps[0];
      if (!ramp) return null;
      H.place(((ramp.d0 - 30) / g.track.length + 1) % 1, 0, 24);
      let air = 0;
      const n = H.drive(300, (k) => { air = Math.max(air, k.airTime); return k.grounded && air > 0.3 ? false : { throttle: 1, steer: H.steerTo(k), drift: false }; });
      H.drive(6, (k) => ({ throttle: 1, steer: H.steerTo(k), drift: false }));
      return { air: +air.toFixed(2), frames: n, fx: H.fx() };
    });
    await save('ramp-land');
  }

  if (want('hit') && straight) {
    results.hit = await page.evaluate((st) => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt;
      H.place(st.t, 0, 18);
      H.drive(6, (k) => ({ throttle: 1, steer: H.steerTo(k), drift: false }));
      const ok = g.player.spinOut('gum');
      H.drive(9, () => ({ throttle: 1, steer: 0, drift: false }));
      return { spun: ok, fx: H.fx() };
    }, straight);
    await save('hit-stars');
    results.burnout = await page.evaluate((st) => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt;
      H.place(st.t, 0, 0);
      g.player.graceTime = 0;
      const ok = g.player.spinOut('burnout');
      H.drive(24, () => ({ throttle: 0, steer: 0, drift: false }));
      return { spun: ok };
    }, straight);
    await save('burnout');
  }

  if (want('wall')) {
    results.wall = await page.evaluate(() => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt; const s = g.track.samples; const N = g.track.sampleCount;
      let found = null;
      for (let i = 0; i < N && !found; i += 2) {
        let ok = true;
        for (let j = 0; j < 30 && ok; j++) { const m = (i + j) % N; if (s.edgeRight[m] !== 1 || Math.abs(s.curvature[m]) > 1 / 150 || s.rampId[m] >= 0) ok = false; }
        if (ok) found = { t: i / N, side: 1, hw: s.halfWidth[i], off: s.offroad[i] };
      }
      for (let i = 0; i < N && !found; i += 2) {
        let ok = true;
        for (let j = 0; j < 30 && ok; j++) { const m = (i + j) % N; if (s.edgeLeft[m] !== 1 || Math.abs(s.curvature[m]) > 1 / 150 || s.rampId[m] >= 0) ok = false; }
        if (ok) found = { t: i / N, side: -1, hw: s.halfWidth[i], off: s.offroad[i] };
      }
      if (!found) return null;
      const lat = found.side * (found.hw + found.off - 3);
      H.place(found.t, lat, 20, -found.side * 0.35);
      const n0 = kk.eventSeq();
      let hitAt = -1;
      H.drive(90, (k, i) => {
        if (hitAt < 0 && kk.events(n0).some((e) => e.name === 'wallHit')) hitAt = i;
        if (hitAt >= 0 && i - hitAt >= 3) return false;
        return { throttle: 1, steer: found.side * 0.3, drift: false };
      });
      return { found, hitAt, contact: g.player.wallContact, fx: H.fx() };
    });
    await save('wall-hit');
    await page.evaluate(() => {
      const H = window.__fxt;
      H.drive(24, () => ({ throttle: 1, steer: (window.__kk.game.player.trackInfo.lateral > 0 ? 1 : -1) * 0.5, drift: false }));
    });
    results.wallScrape = await page.evaluate(() => ({ contact: window.__kk.game.player.wallContact, speed: +window.__kk.game.player.speed.toFixed(1), fx: window.__fxt.fx() }));
    await save('wall-scrape');
  }

  if (want('draft') && straight) {
    results.draft = await page.evaluate((st) => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt;
      const lead = g.karts.find((k) => !k.isPlayer);
      const L = g.track.length;
      kk.teleport(lead.index, (st.t + 14 / L) % 1, 0);
      H.place(st.t, 0, 24);
      lead.vel.set(Math.sin(lead.heading) * 24, 0, Math.cos(lead.heading) * 24); lead.speed = 24;
      let charged = 0;
      H.drive(50, (k) => { if (k.draft.charge > 0.45) return false; charged = k.draft.charge; return { throttle: 1, steer: H.steerTo(k, lead.trackInfo.lateral, 10), drift: false }; });
      return { charge: +g.player.draft.charge.toFixed(2), dist: +lead.pos.distanceTo(g.player.pos).toFixed(1), fx: H.fx() };
    }, straight);
    await save('slipstream');
  }

  // Respawn with no early summon (the dive-in path). Every frame: the crane's NDC extent from the
  // chase camera while attached (must stay within |y| < 0.9) and the string length while not tied on.
  if (want('crane') && straight) {
    const stages = [];
    await page.evaluate((st) => {
      const H = window.__fxt;
      H.place(st.t, 0, 14);
      H.drive(20, (k) => ({ throttle: 1, steer: H.steerTo(k), drift: false }));
      window.__kk.game.player.startRespawn();
      window.__craneLog = { attachedAt: -1, frame: 0, bodyLo: 9, bodyHi: -9, wingHi: -9, looseMax: 0, attachedMaxString: 0, worst: null };
    }, straight);
    for (const [name, frames] of [['crane-grab', 4], ['crane-lift', 16], ['crane-carry', 35], ['crane-side', 0], ['crane-drop', 45], ['crane-release', 16], ['crane-flyoff', 24]]) {
      await page.evaluate((side) => { window.__kk.setCamera(side ? 'side' : null); window.__kk.game.cameraRig.update(1 / 60); }, name === 'crane-side');
      const r = await page.evaluate((frames) => {
        const kk = window.__kk; const g = kk.game; const H = window.__fxt; const L = window.__craneLog;
        H.drive(frames, (k, i) => {
          if (!g.cameraRig.debugMode && i > 0) {
            const c = H.craneView();
            if (c && c.phase !== 'out') {
              if (c.attached && k.respawn.active) {
                if (L.attachedAt < 0) L.attachedAt = L.frame;
                L.bodyLo = Math.min(L.bodyLo, c.body[0]); L.bodyHi = Math.max(L.bodyHi, c.body[1]); L.wingHi = Math.max(L.wingHi, c.wingTop);
                L.attachedMaxString = Math.max(L.attachedMaxString, c.string);
                if (c.body[1] >= L.bodyHi) L.worst = { frame: L.frame, stage: k.respawn.stage, body: c.body.map((x) => +x.toFixed(2)) };
              } else if (!c.attached) L.looseMax = Math.max(L.looseMax, c.string);
            }
          }
          L.frame++;
          return { throttle: 0, steer: 0, drift: false };
        });
        return { stage: g.player.respawn.stage, y: +g.player.pos.y.toFixed(2), cranes: H.fx().cranes };
      }, frames);
      stages.push({ name, ...r });
      await save(name);
    }
    await page.evaluate(() => window.__kk.setCamera(null));
    const log = await page.evaluate(() => window.__craneLog);
    results.crane = { stages, frameCheck: { ...log, pass: log.bodyHi < 0.9 && log.bodyLo > -0.9 && log.looseMax <= 1.81 } };
  }

  // Speed lines: shown in the chase view during a rocket boost, cut on the first frame of the side
  // debug camera and of look-back.
  if (want('lines') && straight) {
    results.lines = await page.evaluate((st) => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt;
      H.place(st.t, 0, 20);
      H.drive(6, (k) => ({ throttle: 1, steer: H.steerTo(k), drift: false }));
      g.player.applyBoost(1.3, 1.15, 'item');
      H.drive(10, (k) => ({ throttle: 1, steer: H.steerTo(k), drift: false }));
      const chase = H.fx().speedLines;
      return { chase };
    }, straight);
    await save('rocket-chase');
    results.lines.side = await page.evaluate(() => {
      const kk = window.__kk; const H = window.__fxt;
      kk.setCamera('side');
      H.drive(1, (k) => ({ throttle: 1, steer: H.steerTo(k), drift: false }));
      return H.fx().speedLines;
    });
    await save('rocket-side');
    results.lines.lookBack = await page.evaluate(() => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt;
      kk.setCamera(null);
      H.drive(8, (k) => ({ throttle: 1, steer: H.steerTo(k), drift: false }));
      const back = H.fx().speedLines;
      g.cameraRig.lookBack = true;
      H.drive(1, (k) => ({ throttle: 1, steer: H.steerTo(k), drift: false }));
      const cut = H.fx().speedLines;
      g.cameraRig.lookBack = false;
      return { beforeLookBack: back, firstLookBackFrame: cut };
    });
    results.lines.pass = results.lines.chase > 0.5 && results.lines.side === 0 && results.lines.lookBack.firstLookBackFrame === 0;
  }

  if (want('craneEarly') && straight) {
    results.craneEarly = await page.evaluate((st) => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt;
      const lat = st.halfWidth + st.offroad + 3;
      H.place(st.t, lat, 6);
      const out = [];
      H.drive(150, (k, i) => {
        if (i % 15 === 0) out.push({ i, surface: k.surface, outTime: +k.outTime.toFixed(2), stage: k.respawn.stage, cranes: H.fx().cranes.length });
        if (k.outTime > 1.75) return false;
        return { throttle: 0.3, steer: H.steerTo(k, lat, 8), drift: false };
      });
      return out;
    }, straight);
    await save('crane-early');
    await page.evaluate(() => window.__fxt.drive(150, () => ({ throttle: 0, steer: 0, drift: false })));
  }

  if (want('fall')) results.fall = await fallTest('crane-fall');

  if (want('confetti')) {
    results.confetti = await page.evaluate(() => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt;
      H.drive(240, (k) => (k.respawn.active || k.speed < 18 ? { throttle: 1, steer: H.steerTo(k), drift: false } : false));
      g.events.emit('finish', { kart: g.player, place: 1, time: g.raceTime });
      H.drive(50, (k) => ({ throttle: 1, steer: H.steerTo(k), drift: false }));
      return { speed: +g.player.speed.toFixed(1), respawn: g.player.respawn.active, fx: H.fx() };
    });
    await save('confetti-1s');
    await page.evaluate(() => { const H = window.__fxt; H.drive(110, (k) => ({ throttle: 1, steer: H.steerTo(k), drift: false })); });
    await save('confetti-3s');
  }

  // Reduced motion hides the speed lines; low quality (no post pass) still renders the bits right.
  if (want('quality')) {
    results.reducedMotion = await page.evaluate(() => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt;
      g.api.setSetting('reducedMotion', 'on');
      g.player.applyBoost(1.0, 1, 'pad');
      H.drive(10, (k) => ({ throttle: 1, steer: H.steerTo(k), drift: false }));
      const rm = H.fx().speedLines;
      g.api.setSetting('reducedMotion', 'auto');
      H.drive(10, (k) => ({ throttle: 1, steer: H.steerTo(k), drift: false }));
      return { speedLinesReduced: rm, speedLinesNormal: H.fx().speedLines };
    });
    await page.evaluate(() => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt;
      g.api.setSetting('quality', 'low');
      g.events.emit('hit', { kart: g.player, cause: 'gum', by: null });
      g.player.applyBoost(1.0, 1, 'pad');
      H.drive(8, (k) => ({ throttle: 1, steer: H.steerTo(k), drift: false }));
    });
    await save('quality-low');
    await page.evaluate(() => window.__kk.game.api.setSetting('quality', 'auto'));
  }

  // FX draw calls with everything live: render with FX meshes shown vs hidden.
  results.drawCalls = await page.evaluate(() => {
    const kk = window.__kk; const g = kk.game; const H = window.__fxt;
    const k = g.player;
    k.applyBoost(1.2, 1, 'pad');
    g.events.emit('hit', { kart: k, cause: 'gum', by: null });
    k.startRespawn?.();
    H.drive(12, () => ({ throttle: 1, steer: 0, drift: false }));
    kk.renderFrame();
    const on = kk.perf();
    const meshes = g.systems.fx.meshes();
    const vis = meshes.map((m) => m.visible);
    meshes.forEach((m) => { m.visible = false; });
    kk.renderFrame();
    const off = kk.perf();
    meshes.forEach((m, i) => { m.visible = vis[i]; });
    return { total: on.drawCalls, fxCalls: on.drawCalls - off.drawCalls, fxShadowCalls: on.shadowCalls - off.shadowCalls, triangles: on.triangles, fx: H.fx() };
  });

  // Second race on another track, then quit: leaks, listeners, errors.
  results.leak = await page.evaluate(async () => {
    const kk = window.__kk; const g = kk.game; const H = window.__fxt;
    const before = kk.listenerCount();
    g.api.quitToTitle();
    const first = kk.leaks();
    await kk.startRace({ track: 'bosphorus', mode: 'single', autopilot: true, skipIntro: true, seed: 3 });
    g.loop.stop();
    for (let i = 0; i < 260; i++) H.frame();
    g.player.startRespawn();
    for (let i = 0; i < 40; i++) H.frame();
    const dbg = H.fx();
    g.api.quitToTitle();
    return { listenersDuringRace: before, afterQuit: kk.listenerCount(), leaks: kk.leaks(), firstQuit: first.leaks.length, fxBosphorus: dbg };
  });

  if (want('night')) {
    await newRace('bosphorus', 5);
    results.night = await page.evaluate(() => {
      const kk = window.__kk; const g = kk.game; const H = window.__fxt;
      while (g.phase === 'countdown') { kk.setControls({ throttle: g.race.timeToGo <= 0.8 ? 1 : 0 }); H.frame(); }
      const c = g.track.analysis.corners.filter((x) => x.arc >= 50).sort((a, b) => b.turnDeg - a.turnDeg)[0];
      const d0 = g.track.samples.dist[c.from];
      H.place(((d0 - 45) / g.track.length + 1) % 1, 0, 21);
      H.drive(480, (k) => (k.drift.active && k.drift.tier >= 2 ? false : H.driftCtl(k, c.dir, d0)));
      H.drive(3, (k) => H.driftCtl(k, c.dir, d0));
      return { tier: g.player.drift.tier, surface: g.player.surface };
    });
    await save('night-drift');
    await page.evaluate(() => { const H = window.__fxt; H.drive(5, (k) => ({ throttle: 1, steer: H.steerTo(k), drift: false })); });
    await save('night-boost');
    await page.evaluate(() => { const H = window.__fxt; window.__kk.game.player.startRespawn(); H.drive(40, () => ({ throttle: 0, steer: 0, drift: false })); });
    await save('night-crane');
    await page.evaluate(() => window.__fxt.drive(150, () => ({ throttle: 0, steer: 0, drift: false })));
    results.nightFall = await fallTest('night-fall');
    await page.evaluate(() => { window.__kk.game.api.quitToTitle(); });
  }

  const tail = await page.evaluate(() => ({ errors: window.__kk.errors.slice(), warnings: window.__kk.warnings.slice(), leaks: window.__kk.leaks() }));
  for (const [k, v] of Object.entries(results)) console.log(JSON.stringify({ check: k, result: v }));
  console.log(JSON.stringify({ renderer, shots, errors: tail.errors, warnings: tail.warnings, leaks: tail.leaks.leaks, console: consoleLines.slice(0, 40) }));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
