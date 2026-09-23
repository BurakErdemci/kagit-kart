// In-game check of the character visuals (ARCHITECTURE.md §10.7) on the real core:
// lineup of all eight kart === null visuals, chase views of the pack, drift lean and spin-out close-ups,
// finish emotions, the time-trial ghost, anchors/flash/blink numbers, draw calls per kart at every
// quality, and a leak check across races. node tools/scenarios/characters.mjs [--port 8777] [--balance]
// --balance instead measures stat balance: solo autopilot 3-lap times per character on every track, and
// CPU mean finishing place over 32 seeded 2-lap races (pure simulation, no screenshots).
// Close-ups set cameraRig.override from this test page only (cinematics owns it in the game) and clear it.
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'out', 'characters');
fs.mkdirSync(OUT, { recursive: true });
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const port = +arg('--port', 8777);
const balance = process.argv.includes('--balance');

const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

let server = null;
let browser = null;
const report = { shots: [] };
try {
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await new Promise((r) => setTimeout(r, 100));
  }
  const launched = await launch();
  browser = launched.browser;
  report.renderer = launched.renderer;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__kk && window.__kk.ready);
  const ev = (fn, a) => page.evaluate(fn, a);
  if (balance) {
    Object.assign(report, await ev(async () => {
      const kk = window.__kk, g = kk.game;
      kk.setAutoPause(false);
      g.loop.stop(); // pure simulation: no frames between steps
      const { ROSTER } = await import('/src/characters/characters.js');
      const ids = ROSTER.map((c) => c.id);
      const tracks = ['meadow', 'bosphorus', 'glacier', 'desk'];
      const ttMean = {};
      for (const id of ids) {
        let sum = 0, n = 0;
        for (const track of tracks) for (const seed of [11, 12]) {
          await kk.startRace({ track, mode: 'tt', laps: 3, autopilot: true, skipIntro: true, seed, character: id });
          kk.simulate(260);
          if (g.player.finished) { sum += g.player.finishTime; n++; }
        }
        ttMean[id] = n ? +(sum / n).toFixed(2) : null;
      }
      const place = {}, count = {};
      for (let seed = 100; seed < 132; seed++) {
        await kk.startRace({ track: tracks[seed % 4], mode: 'single', laps: 2, autopilot: true, skipIntro: true, seed, character: ids[seed % 8] });
        kk.simulate(200);
        if (g.race.state !== 'done') kk.finishNow();
        for (const k of g.karts) if (!k.isPlayer) { place[k.id] = (place[k.id] || 0) + k.place; count[k.id] = (count[k.id] || 0) + 1; }
      }
      const cpuMeanPlace = Object.fromEntries(ids.map((id) => [id, +(place[id] / count[id]).toFixed(2)]));
      g.loop.start();
      g.api.quitToTitle();
      return { balance: { ttMean3Laps: ttMean, cpuMeanPlace }, errors: kk.errors.slice(), leaks: kk.leaks().leaks };
    }));
    throw null; // skip the visual pass; finally still closes browser and server
  }
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = async (name) => {
    const file = path.join(OUT, name + '.png');
    await page.screenshot({ path: file });
    report.shots.push(path.relative(ROOT, file).replace(/\\/g, '/'));
  };

  // Test-page camera helpers: follow an Object3D with an offset in its local frame (+Z fwd, +X left).
  await ev(() => {
    const g = window.__kk.game;
    const T = g.THREE;
    const off = new T.Vector3(), look = new T.Vector3(), q = new T.Quaternion();
    window.__cc = {
      follow(obj, o, l, hfov = 55) {
        g.cameraRig.override = {
          update(dt, cam) {
            q.copy(obj.quaternion);
            off.set(o[0], o[1], o[2]).applyQuaternion(q).add(obj.position);
            look.set(l[0], l[1], l[2]).applyQuaternion(q).add(obj.position);
            cam.position.copy(off);
            cam.lookAt(look);
            g.cameraRig.setHorizontalFov(hfov);
          },
        };
      },
      clear() { g.cameraRig.override = null; g.cameraRig.snap(); },
    };
  });

  const startRace = (opts) => ev(async (o) => {
    const kk = window.__kk;
    kk.setAutoPause(false);
    kk.setTimeScale(1);
    await kk.startRace({ track: 'meadow', mode: 'single', autopilot: true, skipIntro: true, seed: 7, character: 'tilki', ...o });
  }, opts);

  // Draw calls with every kart visual hidden vs shown, inside one evaluate so no rAF frame interleaves.
  const kartCalls = () => ev(() => {
    const kk = window.__kk, g = kk.game;
    const vis = g.karts.map((k) => k.visual.object3d);
    vis.forEach((o) => { o.visible = false; });
    kk.renderFrame();
    const off = kk.perf();
    vis.forEach((o) => { o.visible = true; });
    kk.renderFrame();
    const on = kk.perf();
    const n = vis.length;
    return {
      quality: g.quality, karts: n, frameCalls: on.drawCalls, frameShadowCalls: on.shadowCalls, frameTriangles: on.triangles,
      perKartCalls: +((on.drawCalls - off.drawCalls) / n).toFixed(2),
      perKartShadowCalls: +((on.shadowCalls - off.shadowCalls) / n).toFixed(2),
      perKartTriangles: Math.round((on.triangles - off.triangles) / n),
    };
  });

  // ---- rest-pose size of every kart === null visual against §10.7 (2.2 × 1.5 × 1.6 m, ±10%)
  report.restSize = await ev(async () => {
    const g = window.__kk.game, T = g.THREE;
    const { ROSTER, createKartVisual } = await import('/src/characters/characters.js');
    const box = new T.Box3(), tmp = new T.Vector3(), inv = new T.Matrix4();
    const out = { visuals: {}, outside: [] };
    for (const c of ROSTER) {
      const v = createKartVisual(g, c, null);
      g.scene.add(v.object3d);
      v.object3d.position.set(0, -500, 0);
      v.object3d.updateMatrixWorld(true);
      inv.copy(v.object3d.matrixWorld).invert();
      const mesh = v.object3d.getObjectByName('kart.body');
      mesh.skeleton.update();
      box.makeEmpty();
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) box.expandByPoint(mesh.getVertexPosition(i, tmp).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv));
      const L = box.max.z - box.min.z, W = box.max.x - box.min.x, H = box.max.y - box.min.y;
      out.visuals[c.id] = { L: +L.toFixed(2), W: +W.toFixed(2), H: +H.toFixed(2), zMin: +box.min.z.toFixed(2), zMax: +box.max.z.toFixed(2), tris: pos.count / 3 };
      if (Math.abs(L / 2.2 - 1) > 0.1 || Math.abs(W / 1.5 - 1) > 0.1 || Math.abs(H / 1.6 - 1) > 0.1) out.outside.push(c.id);
      g.scene.remove(v.object3d);
      v.dispose();
    }
    return out;
  });
  if (report.restSize.outside.length) throw new Error('rest size outside §10.7: ' + report.restSize.outside.join(','));

  // ---- race 1: grid in the countdown
  report.memoryAtBoot = await ev(() => window.__kk.memory());
  await startRace({});
  await wait(400);
  await shot('grid-chase');
  report.meshesPerKart = await ev(() => window.__kk.game.karts.map((k) => {
    let meshes = 0, bones = 0;
    k.visual.object3d.traverse((o) => { if (o.isMesh) meshes++; if (o.isBone) bones++; });
    const m = k.visual.object3d.getObjectByName('kart.body');
    return { id: k.id, meshes, bones, triangles: m.geometry.attributes.position.count / 3 };
  }));
  report.callsHigh = await kartCalls();

  // anchors in the kart's local frame (+X left, +Z forward) and the core-positioned object3d
  report.anchors = await ev(() => {
    const g = window.__kk.game, T = g.THREE;
    const k = g.player, v = k.visual, o = v.object3d, w = new T.Vector3();
    o.updateWorldMatrix(true, true);
    const inv = o.matrixWorld.clone().invert();
    const out = { posMatchesKart: o.position.distanceTo(k.pos) < 1e-3 };
    for (const [n, a] of Object.entries(v.anchors)) {
      a.getWorldPosition(w).applyMatrix4(inv);
      out[n] = [+w.x.toFixed(2), +w.y.toFixed(2), +w.z.toFixed(2)];
    }
    return out;
  });

  // ---- lineup: all eight kart === null visuals on the road past the grid. The race is paused and the
  // HUD hidden meanwhile; a rAF loop stands in for the owner (cinematics) that updates such visuals.
  const hud = (on) => ev((v) => {
    let st = document.getElementById('chars-test-hud');
    if (!st) { st = document.createElement('style'); st.id = 'chars-test-hud'; document.head.appendChild(st); }
    st.textContent = v ? '' : '#kk-root > :not(canvas){visibility:hidden!important}';
  }, on);
  await hud(false);
  await ev(async () => {
    const g = window.__kk.game, T = g.THREE;
    g.api.setPaused(true);
    const { ROSTER, createKartVisual } = await import('/src/characters/characters.js');
    const p = g.player, h = p.heading;
    const fx = Math.sin(h), fz = Math.cos(h), rx = -Math.cos(h), rz = Math.sin(h);
    const centre = new T.Object3D();
    centre.position.set(p.pos.x + fx * 55, p.pos.y, p.pos.z + fz * 55);
    centre.rotation.y = h + Math.PI; // faces back toward the grid
    window.__lineupCentre = centre;
    window.__lineup = ROSTER.map((ch, i) => {
      const v = createKartVisual(g, ch, null);
      const lat = (i - 3.5) * 2.2;
      v.object3d.position.set(centre.position.x + rx * lat, p.pos.y, centre.position.z + rz * lat);
      v.object3d.rotation.y = h + Math.PI;
      g.scene.add(v.object3d);
      return v;
    });
    const tick = () => {
      if (!window.__lineup) return;
      for (const v of window.__lineup) v.update(1 / 60);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // camera x offsets: the lineup's local +X is its left, i.e. screen right when seen from the front
    window.__cc.follow(centre, [0, 1.8, 11.5], [0, 0.75, 0], 82);
  });
  await wait(600);
  await shot('lineup-front');
  await ev(() => window.__cc.follow(window.__lineupCentre, [0, 2.0, -11.5], [0, 0.75, 0], 82));
  await wait(300);
  await shot('lineup-back');
  // 30 m: the distance the brief asks silhouettes to survive
  await ev(() => window.__cc.follow(window.__lineupCentre, [0, 3.0, 30], [0, 0.8, 0], 90));
  await wait(300);
  await shot('lineup-30m');
  await ev(() => window.__cc.follow(window.__lineupCentre, [0, 26, 0.01], [0, 0, 0], 60));
  await wait(300);
  await shot('lineup-top');
  // emotions at mid range, three karts per frame (roster 0-2, 3-5, 5-7); kart i sits at local x (i - 3.5) * 2.2
  for (const [emo, mid] of [['cheer', -2.5 * 2.2], ['sad', 0.5 * 2.2], ['dizzy', 2.5 * 2.2]]) {
    await ev(([e, x]) => {
      for (const v of window.__lineup) v.setEmotion(e);
      window.__cc.follow(window.__lineupCentre, [x, 1.5, 5.6], [x, 0.9, 0], 70);
    }, [emo, mid]);
    await wait(900);
    await shot('emo-' + emo);
  }
  // close-ups: three-quarter front from the kart's right, and three-quarter back from its left
  for (const id of ['tilki', 'kurbaga', 'penguen', 'ayi', 'kedi', 'baykus', 'tavsan', 'ahtapot']) {
    await ev((cid) => {
      const v = window.__lineup.find((x) => x.character.id === cid);
      for (const x of window.__lineup) x.setEmotion('idle');
      window.__cc.follow(v.object3d, [-2.4, 1.5, 3.1], [0, 0.9, 0], 56);
    }, id);
    await wait(250);
    await shot('close-' + id);
  }
  for (const id of ['tilki', 'tavsan', 'ahtapot', 'baykus']) {
    await ev((cid) => {
      const v = window.__lineup.find((x) => x.character.id === cid);
      window.__cc.follow(v.object3d, [2.4, 1.9, -3.3], [0, 0.9, 0], 58);
    }, id);
    await wait(250);
    await shot('back-' + id);
  }
  // ghost variant of the lineup
  await ev(async () => {
    const g = window.__kk.game;
    const { createKartVisual } = await import('/src/characters/characters.js');
    const old = window.__lineup;
    window.__lineup = old.map((v) => {
      const gv = createKartVisual(g, v.character, null, { ghost: true });
      gv.object3d.position.copy(v.object3d.position);
      gv.object3d.rotation.copy(v.object3d.rotation);
      g.scene.remove(v.object3d);
      v.dispose();
      g.scene.add(gv.object3d);
      return gv;
    });
    window.__cc.follow(window.__lineupCentre, [0, 1.8, 11.5], [0, 0.75, 0], 82);
  });
  await wait(400);
  await shot('lineup-ghost');
  await ev(() => {
    const g = window.__kk.game;
    for (const v of window.__lineup) { g.scene.remove(v.object3d); v.dispose(); }
    window.__lineup = null;
    window.__cc.clear();
    g.api.setPaused(false);
  });
  await hud(true);

  // ---- racing: chase views (player and a mid-pack CPU with rivals ahead)
  await ev(() => window.__kk.simulate(3.4));
  await wait(1800);
  await shot('race-chase-player');
  await ev(() => window.__kk.simulate(6));
  await ev(() => {
    const g = window.__kk.game;
    const sorted = g.karts.slice().sort((a, b) => a.place - b.place);
    g.cameraRig.target = sorted[5];
    g.cameraRig.snap();
  });
  await wait(1500);
  await shot('race-chase-pack');
  report.perfRace = await ev(() => window.__kk.perf());
  report.callsRace = await kartCalls();
  await ev(() => { const g = window.__kk.game; g.cameraRig.target = null; g.cameraRig.snap(); });

  // streamers at speed: rabbit ears and octopus tentacles on CPUs, from behind and to the side
  for (const id of ['tavsan', 'ahtapot', 'tilki']) {
    const k = await ev((cid) => {
      const g = window.__kk.game;
      const kart = g.karts.find((x) => x.id === cid);
      if (!kart) return null;
      window.__cc.follow(kart.visual.object3d, [1.9, 1.6, -3.4], [0, 1.0, 0.5], 60);
      return { speed: +kart.speed.toFixed(1) };
    }, id);
    if (!k) continue;
    await wait(200);
    await shot('speed-' + id);
  }
  // a CPU's own drift through the normal chase camera: jump the sim to the start of one, then follow it
  report.driftCpu = await ev(() => {
    const kk = window.__kk, g = kk.game;
    window.__cc.clear();
    for (let i = 0; i < 1200; i++) {
      kk.simulate(1 / 60);
      const k = g.karts.find((x) => !x.isPlayer && x.drift.active && x.grounded && x.speed > 12 && x.drift.charge > 0.1 && x.drift.charge < 0.4);
      if (k) { g.cameraRig.target = k; g.cameraRig.snap(); window.__driftCpu = k; return { id: k.id, dir: k.drift.dir }; }
    }
    return null;
  });
  if (report.driftCpu) {
    await wait(350);
    await shot('drift-cpu-chase');
    report.driftCpu.lean = await ev(() => {
      const k = window.__driftCpu, o = k.visual.object3d;
      const r = { still: k.drift.active, tier: k.drift.tier, chassisRoll: +o.getObjectByName('chassis').rotation.z.toFixed(3), torsoLean: +o.getObjectByName('torso').rotation.z.toFixed(3) };
      const g = window.__kk.game;
      g.cameraRig.target = null; g.cameraRig.snap();
      return r;
    });
  }
  await hud(false);

  // ---- drift lean: the player takes manual controls and holds a drift (right, then left)
  const drift = async (dir, views) => {
    await ev((d) => {
      const kk = window.__kk, p = kk.game.player;
      p.autopilot = false;
      kk.setControls({ throttle: 1, steer: 0, drift: false });
      kk.simulate(0.3);
      kk.setControls({ throttle: 1, steer: 0.85 * d, drift: true });
    }, dir);
    for (const [name, o, l, at] of views) {
      await ev(([o2, l2]) => window.__cc.follow(window.__kk.game.player.visual.object3d, o2, l2, 64), [o, l]);
      await wait(at);
      await shot(name);
    }
    const r = await ev(() => {
      const kk = window.__kk, p = kk.game.player, o = p.visual.object3d;
      const out = {
        active: p.drift.active, dir: p.drift.dir, tier: p.drift.tier,
        chassisRoll: +o.getObjectByName('chassis').rotation.z.toFixed(3),
        torsoLean: +o.getObjectByName('torso').rotation.z.toFixed(3),
        frontWheelYaw: +o.getObjectByName('wFL').rotation.y.toFixed(3),
      };
      kk.setControls(null);
      p.autopilot = true;
      return out;
    });
    await wait(1500);
    return r;
  };
  report.driftRight = await drift(1, [['drift-right-behind', [0, 1.8, -4.8], [0, 0.8, 1.5], 700], ['drift-right-front', [-3.4, 1.4, 3.4], [0, 0.7, 0], 150]]);
  report.driftLeft = await drift(-1, [['drift-left-behind', [0, 1.8, -4.8], [0, 0.8, 1.5], 800]]);

  // ---- spin-outs by cause on the player, framed from the right-front; shots at fixed spin progress
  const spinAt = async (cause, fracs) => {
    // a plane tumble can end in a respawn, which makes the kart immune: re-place it on the road first
    const took = await ev((c) => {
      const kk = window.__kk, g = kk.game, p = g.player;
      kk.teleport(p.index, p.trackInfo.t, 0);
      p.graceTime = 0; p.invincibleTime = 0;
      window.__cc.follow(p.visual.object3d, [-4.2, 2.0, 3.2], [0, 0.8, 0], 62);
      p.spinOut(c);
      window.__spinTotal = p.spinTime;
      const rig = p.visual.object3d.getObjectByName('kart.rig');
      window.__spinScale = { min: 9, max: 0, afterMax: 0 };
      const track = () => {
        const s = window.__spinScale;
        if (!s) return;
        const y = rig.scale.y;
        if (p.spinTime > 0) { s.min = Math.min(s.min, y); s.max = Math.max(s.max, y); } else s.afterMax = Math.max(s.afterMax, y);
        requestAnimationFrame(track);
      };
      requestAnimationFrame(track);
      return { cause: p.spinCause, time: p.spinTime };
    }, cause);
    if (took.cause !== cause || !(took.time > 0)) throw new Error(`spinOut('${cause}') did not take: ${JSON.stringify(took)}`);
    for (const f of fracs) {
      await page.waitForFunction((fr) => {
        const p = window.__kk.game.player;
        return p.spinTime <= window.__spinTotal * (1 - fr);
      }, f, { polling: 'raf', timeout: 5000 });
      await shot(`spin-${cause}-${Math.round(f * 100)}`);
    }
    await page.waitForFunction(() => window.__kk.game.player.spinTime <= 0, null, { polling: 'raf', timeout: 5000 });
    await wait(300);
    const sc = await ev(() => { const s = window.__spinScale; window.__spinScale = null; return s; });
    (report.spinScale ||= {})[cause] = { min: +sc.min.toFixed(3), afterMax: +sc.afterMax.toFixed(3) };
  };
  await spinAt('gum', [0.35]);
  await spinAt('plane', [0.3, 0.55]);
  await spinAt('scissors', [0.45, 0.9]);
  // the pop-back overshoot happens after the flattened phase (p ≥ 0.86): catch it in the next frames
  await spinAt('foil', [0.45]);
  await spinAt('burnout', [0.5]);
  // scissors: flattened to a sheet during the spin, then an overshoot past full height after release
  const ss = report.spinScale.scissors;
  if (!(ss.min < 0.2 && ss.afterMax > 1.05)) throw new Error('scissors flatten/pop-back missing: ' + JSON.stringify(ss));

  // grace blink at 8 Hz: sample mesh visibility over real frames while graceTime > 0
  report.graceBlink = await ev(() => new Promise((res) => {
    const p = window.__kk.game.player;
    const mesh = p.visual.object3d.getObjectByName('kart.body');
    p.setGrace(1.0);
    const t0 = performance.now();
    let flips = 0, last = mesh.visible, hiddenFrames = 0, frames = 0;
    const tick = () => {
      frames++;
      if (!mesh.visible) hiddenFrames++;
      if (mesh.visible !== last) { flips++; last = mesh.visible; }
      if (performance.now() - t0 < 900) requestAnimationFrame(tick);
      else res({ flips, frames, hiddenFrames, visibleAfter: (p.graceTime > 0) || mesh.visible });
    };
    requestAnimationFrame(tick);
  }));
  await wait(400);
  report.graceEndVisible = await ev(() => window.__kk.game.player.visual.object3d.getObjectByName('kart.body').visible);

  // flash(color, 0.08) as FX calls it on a drift tier-up: emissive rises, then returns to black
  report.flash = await ev(() => new Promise((res) => {
    const v = window.__kk.game.player.visual;
    const m = v.object3d.getObjectByName('kart.body').material;
    v.flash('#ff8a1e', 0.08);
    requestAnimationFrame(() => {
      const during = m.emissive.getHexString();
      setTimeout(() => res({ during, after: m.emissive.getHexString() }), 250);
    });
  }));
  await ev(() => window.__kk.game.player.visual.flash('#ff8a1e', 0.6));
  await wait(60);
  await shot('flash-tier2');
  await wait(700);

  // look-back: the player takes manual controls with lookBack held; the rig looks back at the driver
  await ev(() => {
    const g = window.__kk.game;
    g.player.autopilot = false;
    window.__kk.setControls({ throttle: 1, lookBack: true });
    window.__cc.clear();
  });
  await wait(700);
  await shot('lookback');
  report.lookBackHeadYaw = await ev(() => +window.__kk.game.player.visual.object3d.getObjectByName('head').rotation.y.toFixed(2));
  await ev(() => { window.__kk.setControls(null); window.__kk.game.player.autopilot = true; });

  // invincible (foil) shimmer
  await ev(() => {
    const p = window.__kk.game.player;
    p.setInvincible(2);
    window.__cc.follow(p.visual.object3d, [-3.6, 1.8, 3.4], [0, 0.8, 0], 62);
  });
  await wait(500);
  await shot('invincible');
  await wait(1600);

  // air: hop stretch / landing squash measured on the rig scale over real frames
  report.squash = await ev(() => new Promise((res) => {
    const kk = window.__kk, p = kk.game.player;
    const rig = p.visual.object3d.getObjectByName('kart.rig');
    p.autopilot = false;
    kk.setControls({ throttle: 1, steer: 0, drift: false });
    kk.simulate(0.1);
    const speed = +p.speed.toFixed(1);
    kk.setControls({ throttle: 1, steer: 0, drift: true }); // hop edge on the next real step
    let minY = 9, maxY = 0, n = 0, hopped = false;
    const tick = () => {
      if (!p.grounded) hopped = true;
      minY = Math.min(minY, rig.scale.y); maxY = Math.max(maxY, rig.scale.y);
      if (++n < 60) requestAnimationFrame(tick);
      else {
        kk.setControls(null);
        p.autopilot = true;
        res({ speed, hopped, minScaleY: +minY.toFixed(3), maxScaleY: +maxY.toFixed(3) });
      }
    };
    requestAnimationFrame(tick);
  }));

  // ---- finish emotions: classify everyone, then look at the player and the last kart
  await ev(() => { window.__cc.clear(); window.__kk.finishNow(); });
  await wait(900);
  report.finishPlaces = await ev(() => window.__kk.game.karts.map((k) => ({ id: k.id, place: k.place, finished: k.finished })));
  await ev(() => {
    const g = window.__kk.game;
    const best = g.karts.find((k) => k.place === 1), last = g.karts.find((k) => k.place === g.karts.length);
    window.__cc.follow(best.visual.object3d, [-3.2, 1.7, 3.6], [0, 0.9, 0], 62);
    window.__finishIds = { best: best.id, last: last.id };
  });
  await wait(700);
  await shot('finish-cheer');
  await ev(() => {
    const g = window.__kk.game;
    const last = g.karts.find((k) => k.place === g.karts.length);
    window.__cc.follow(last.visual.object3d, [-3.2, 1.7, 3.6], [0, 0.9, 0], 62);
  });
  await wait(700);
  await shot('finish-sad');
  await ev(() => window.__cc.clear());
  report.listenersAfterRace1 = await ev(() => window.__kk.listenerCount());

  await hud(true);
  // ---- race 2 at medium, race 3 at low: per-kart calls there; each teardown runs core's leak check
  await ev(() => window.__kk.game.api.setSetting('quality', 'medium'));
  await startRace({ character: 'ahtapot', seed: 9 });
  await ev(() => window.__kk.simulate(3.4));
  await wait(1200);
  report.callsMedium = await kartCalls();
  await shot('race2-chase-medium');
  await ev(() => window.__kk.game.api.setSetting('quality', 'low'));
  await startRace({ character: 'tavsan', seed: 5 });
  await ev(() => window.__kk.simulate(3.4));
  await wait(1200);
  report.callsLow = await kartCalls();
  await shot('race3-chase-low');
  await ev(() => window.__kk.game.api.setSetting('quality', 'high'));

  // two plain races at a fixed quality, so the GPU half of the leak check runs too
  await startRace({ character: 'ayi', seed: 21 });
  await ev(() => window.__kk.simulate(8));
  await wait(500);
  await startRace({ character: 'baykus', seed: 22 });
  await ev(() => window.__kk.simulate(8));
  await wait(500);

  // ---- time trial: a 1-lap run stores a ghost; the next run replays it with the ghost visual
  report.ghost = await ev(async () => {
    const kk = window.__kk, g = kk.game;
    await kk.startRace({ track: 'meadow', mode: 'tt', laps: 1, autopilot: true, skipIntro: true, seed: 3, character: 'kedi' });
    kk.simulate(80);
    const first = { phase: g.phase, finished: g.player.finished };
    await kk.startRace({ track: 'meadow', mode: 'tt', laps: 1, autopilot: true, skipIntro: true, seed: 3, character: 'kedi' });
    return { first, ghost: !!g.ghost };
  });
  if (report.ghost.ghost) {
    // the player idles 1.5 s after GO so the ghost pulls ahead into the chase view
    await ev(() => {
      const kk = window.__kk, g = kk.game;
      g.player.autopilot = false;
      kk.setControls({ throttle: 0 });
      kk.simulate(3.4 + 1.5);
      kk.setControls(null);
      g.player.autopilot = true;
    });
    await wait(1500);
    await shot('ghost-tt');
    await ev(() => window.__cc.follow(window.__kk.game.ghost.visual.object3d, [-2.8, 1.5, 3.2], [0, 0.8, 0], 58));
    await wait(300);
    await shot('ghost-close');
    await ev(() => window.__cc.clear());
    report.ghostPose = await ev(() => {
      const gh = window.__kk.game.ghost;
      const o = gh.visual.object3d;
      const w = o.getObjectByName('wRL');
      return { visible: o.visible, wheelTurning: !!w && Math.abs(w.rotation.x) > 0.01, opacity: o.getObjectByName('kart.body').material.opacity };
    });
  }

  // ---- back to the title: last teardown, then the leak verdict across all races
  await ev(() => window.__kk.game.api.quitToTitle());
  await wait(500);
  report.leaks = await ev(() => window.__kk.leaks());
  report.memoryAtEnd = await ev(() => window.__kk.memory());
  report.errors = await ev(() => window.__kk.errors.slice());
  report.warnings = await ev(() => window.__kk.warnings.slice());
} catch (err) {
  if (err !== null) report.failed = String(err && err.stack || err);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
console.log(JSON.stringify(report, null, 1));
