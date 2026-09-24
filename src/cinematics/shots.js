// The five shots. Each returns { stageMode, blendIn, update(dt), pose(out), onMenu?(e), stop?() };
// pose writes out.pos, out.look and out.vfov (vertical degrees). ctx.complete() resolves the play()
// promise while the shot keeps holding; ctx.end() resolves it and hands the camera back.
import * as THREE from 'three';
import { createKeyPath, dirOf, easeInOut, easeInOutSine, easeOut, fitVfov, frameAt, vfovFromHfov } from './campath.js';
import { CUP } from '../track/defs/index.js';
import { DISC } from './stage.js';
import { PODIUM } from './podium.js';

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

function orbitPoint(center, az, el, dist, out) {
  const c = Math.cos(el);
  return out.set(center.x + Math.sin(az) * c * dist, center.y + Math.sin(el) * dist, center.z + Math.cos(az) * c * dist);
}

// ---------------------------------------------------------------------------------------------
// title: the closed book on the desk at golden hour. The first key or tap opens its cover, the pages'
// pop-ups rise and the camera settles on the open spread the menus sit under (a slow orbit).

const TITLE_FOCUS = new THREE.Vector3(3.0, 2.7, -1.4);
const TITLE_AZ = 0.3;
const CLOSED_FOCUS = new THREE.Vector3(6.25, 1.5, 0.5);
const CAM_OPEN = 1.7, CAM_CLOSE = 1.9;
const HERO_AFTER_OPEN = 1.0;

export function titleShot(ctx) {
  const { game } = ctx;
  const stage = ctx.stage();
  const rm = () => !!game.reducedMotion;
  const parkYaw = TITLE_AZ + 0.95;
  const heroId = () => game.selection?.characterId || 'tilki';
  const isTitle = (s) => (s || 'title') === 'title';
  let screen = game.menuScreen || 'title';
  stage.setMode('title');
  stage.setSpin(0);
  stage.park(parkYaw);
  stage.showChapter(game.selection?.trackId, { animate: false });
  // cam: 0 frames the closed book, 1 the open spread; eased on the way
  let cam = isTitle(screen) ? 0 : 1, camFrom = cam, camTo = cam, camT = 1, camDur = 1;
  if (isTitle(screen)) {
    const snap = !ctx.fromStage || rm();
    stage.setBook('closed', { snap });
    stage.setDeskKart(heroId(), true, { snap, delay: snap ? 0 : 1.3 });
  } else {
    stage.setDeskKart(null, false, { snap: true });
    stage.setBook('open', { snap: stage.book === 'closed' });
    stage.setHero(heroId(), { animate: !!stage.currentHero(), faceYaw: parkYaw });
    if (!stage.placed.some((p) => p.target > 0)) stage.unfold({ delay: 0.45, snap: rm() });
  }
  let t = 0;
  const moveCam = (to, dur) => {
    if (camTo === to) return;
    camFrom = cam; camTo = to; camT = 0;
    camDur = rm() ? 0 : dur * Math.abs(to - cam);
  };

  // The kart parked by the book folds down as the cover opens and rises on the turntable once the
  // spread is up; closing the book brings it back to the desk.
  function openBook() {
    stage.setBook('open');
    stage.unfold({ from: 0, delay: 0.05 });
    stage.setDeskKart(heroId(), false);
    stage.setHero(heroId(), { animate: true, faceYaw: parkYaw, delay: rm() ? 0 : HERO_AFTER_OPEN });
    moveCam(1, CAM_OPEN);
  }

  function closeBook() {
    stage.setBook('closed');
    stage.setDeskKart(heroId(), true, { delay: rm() ? 0 : 1.3 });
    moveCam(0, CAM_CLOSE);
  }

  const a = { focus: new THREE.Vector3(), az: 0, el: 0, dist: 0, vfov: 0, sx: 0, sy: 0 };
  return {
    stageMode: 'title',
    blendIn: 1.3,
    update(dt) {
      t += dt;
      if (camT < camDur) camT += dt;
      const k = camDur > 0 ? Math.min(1, camT / camDur) : 1;
      cam = camFrom + (camTo - camFrom) * easeInOutSine(k);
    },
    onMenu(e) {
      const next = e.screen || 'title';
      if (isTitle(screen) && !isTitle(next)) openBook();
      else if (!isTitle(screen) && isTitle(next)) closeBook();
      if (next === 'track' && e.trackId) stage.showChapter(e.trackId, { animate: !rm() });
      screen = next;
    },
    pose(out) {
      const reduced = rm();
      const aspect = game.camera.aspect || 1.6;
      // open: the spread in the upper half (menu cards cover the lower ~45 % of the screen), slow orbit
      const period = reduced ? 110 : 64, amp = reduced ? 0.22 : 0.42;
      const azO = TITLE_AZ + Math.sin((t / period) * Math.PI * 2) * amp;
      const elO = 0.19 + Math.sin((t / period) * Math.PI * 2 + 1.1) * (reduced ? 0.01 : 0.02);
      // closed: looking down on the cover, a little from the fore-edge side so the page block shows;
      // narrow screens step back so the whole book stays in frame
      // a phone held upright is as narrow as the cover: come closer, more from the front, look down more steeply
      const narrow = Math.min(1, Math.max(0, (1.25 - aspect) / 0.8));
      const azC = 0.2 - 0.12 * narrow + Math.sin((t / 40) * Math.PI * 2) * (reduced ? 0.01 : 0.035);
      const distC = 30.5 - 6.5 * narrow;
      const elC = 0.8 + 0.22 * narrow;
      const k = cam, kk = k * k * (3 - 2 * k);
      a.focus.lerpVectors(CLOSED_FOCUS, TITLE_FOCUS, kk);
      a.az = azC + (azO - azC) * k;
      a.el = elC + (elO - elC) * k;
      a.dist = distC + (28 - distC) * k;
      a.vfov = fitVfov(aspect, 32, 44) * (1 - k) + fitVfov(aspect, 31, 56) * k;
      a.sy = (aspect < 1 ? 0.12 : 0.08) * (1 - k) + 0.24 * k;
      orbitPoint(a.focus, a.az, a.el, a.dist, out.pos);
      out.vfov = a.vfov;
      frameAt(out.pos, a.focus, 0, a.sy, out.vfov, aspect, out.look);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// select: the character on the paper turntable; focus changes swap karts with a pop-up

const SELECT_AZ = 0.3;

export function selectShot(ctx, opts) {
  const { game } = ctx;
  const stage = ctx.stage();
  stage.setMode('select');
  // normally the title has opened the book already; a shut one (a direct jump here) opens at once
  stage.setBook('open', { snap: stage.book === 'closed' });
  const rm = () => !!game.reducedMotion;
  const face = () => SELECT_AZ + 0.75;
  let current = opts.characterId || game.selection?.characterId || 'tilki';
  stage.setHero(current, { animate: !rm() && !!stage.currentHero(), cheer: true, faceYaw: face() });
  stage.setSpin(rm() ? 0.1 : 0.22);
  if (!stage.placed.some((p) => p.target > 0)) stage.unfold({ delay: 0.1, snap: rm() });
  let t = 0;
  const subject = new THREE.Vector3();

  return {
    stageMode: 'select',
    blendIn: 1.15,
    update(dt) {
      t += dt;
      stage.setSpin(rm() ? 0.1 : 0.22);
    },
    onMenu(e) {
      if (e.screen !== 'character' || !e.characterId || e.characterId === current) return;
      current = e.characterId;
      stage.setHero(current, { animate: !rm(), cheer: true, faceYaw: face() });
    },
    pose(out) {
      stage.heroSubject(subject);
      const drift = rm() ? 0 : Math.sin(t * 0.21) * 0.05;
      const center = v1.set(DISC.x, subject.y, DISC.z);
      // Low and close to the page: the character stands against the pop-up skyline.
      orbitPoint(center, SELECT_AZ + drift, 0.13, 9.6, out.pos);
      const aspect = game.camera.aspect || 1.6;
      out.vfov = fitVfov(aspect, 32, 44);
      // Right of centre and a touch high: the driver card sits left, the roster strip along the bottom.
      const sx = aspect > 1.2 ? 0.2 : 0;
      frameAt(out.pos, subject, sx, 0.06, out.vfov, aspect, out.look);
    },
    stop() { stage.setSpin(0); },
  };
}

// ---------------------------------------------------------------------------------------------
// intro: ~6 s flyover — high over the page, down past the chapter's signature moment, home to the
// chase camera behind the player on the grid

function signatureDistance(track, gridDist) {
  const L = track.length;
  const def = track.def || {};
  if (typeof def.signature === 'number') return ((def.signature % 1) + 1) % 1 * L;
  const home = (d) => ((gridDist - d) % L + L) % L;
  const cands = [];
  for (const r of track.ramps || []) cands.push({ d: r.d0 + r.length * 0.5, w: r.popup ? 2 : 1 });
  if (!cands.length) {
    const s = track.samples;
    let best = 0, bi = 0;
    for (let i = 0; i < track.sampleCount; i++) {
      const k = Math.abs(s.curvature[i]);
      if (k > best) { best = k; bi = i; }
    }
    cands.push({ d: s.dist[bi], w: 1 });
  }
  // Prefer the strongest moment; between equals, the one with the shorter way home to the grid.
  cands.sort((a, b) => b.w - a.w || home(a.d) - home(b.d));
  return cands[0].d;
}

// Where the low pass can fly: stretches whose roadside pop-ups are densest just ahead, best first and
// at least 120 m apart, so they unfold in front of the camera. Reads the scenery system's pop-up list
// when it offers one (guarded: without it the chapter's signature moment is used).
function clusterCandidates(game, track) {
  const types = game.systems?.scenery?.popups?.types;
  if (!Array.isArray(types) || !track.samples) return [];
  const L = track.length, BIN = 10, N = Math.ceil(L / BIN);
  const bins = new Float32Array(N);
  const sides = new Float32Array(N); // + more to the right of travel
  const s = track.samples, n = track.sampleCount, sp = track.spacing || L / n;
  let total = 0;
  for (const t of types) {
    const items = t.items || [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.alwaysUp) continue;
      const d = t.s ? t.s[i] : it.s;
      if (!Number.isFinite(d)) continue;
      const size = Math.min(6, it.size || 1);
      if (size < 1) continue;
      const dd = ((d % L) + L) % L;
      const j = Math.min(n - 1, Math.floor(dd / sp));
      const dx = it.x - s.px[j], dz = it.z - s.pz[j];
      const lat = Math.hypot(dx, dz);
      const w = size * (lat < 55 ? 1 : 0.25);
      const b = Math.floor(dd / BIN) % N;
      bins[b] += w;
      sides[b] += w * Math.sign(dx * s.rx[j] + dz * s.rz[j]);
      total += w;
    }
  }
  if (total <= 0) return [];
  // the low pass runs from c − 70 to c + 55; what it passes on the way is what it sees rise
  const score = [];
  for (let b = 0; b < N; b++) {
    let sc = 0, sd = 0;
    for (let k = -2; k <= 13; k++) { const i = ((b + k) % N + N) % N; sc += bins[i]; sd += sides[i]; }
    score.push({ sc, c: b * BIN, side: Math.abs(sd) > 0.25 * sc ? Math.sign(sd) : 0 });
  }
  score.sort((a, b) => b.sc - a.sc);
  const out = [];
  const gap = (a, b) => { const d = Math.abs(a - b) % L; return Math.min(d, L - d); };
  for (const e of score) {
    if (out.every((o) => gap(o.c, e.c) >= 120)) out.push(e);
    if (out.length >= 4) break;
  }
  return out;
}

// Tall fixed things a flyover could clip: the scenery's non-instanced meshes that rise well above the
// page (cable-car pylons and cables, bridges, arches) and the start gantry.
function tallObstacles(game, track) {
  const out = [];
  const pageY = track.pageY ?? 0;
  const roots = [game.systems?.scenery?.group, track.objects?.startLine].filter(Boolean);
  const box = new THREE.Box3();
  for (const root of roots) {
    root.updateMatrixWorld?.(true);
    root.traverse?.((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry?.attributes?.position || !o.visible) return;
      box.setFromObject(o);
      if (box.max.y < pageY + 6) return;
      out.push(o);
    });
  }
  return out;
}

const ray = new THREE.Raycaster();
const rayDir = new THREE.Vector3();

// Rays along the path, the low part first (where gantries, bridges and cables are), then the descent
// from high above; a ray costs 0.2–1.6 ms, so the check stops at the budget and counts as clear.
function pathClear(path, t1, obstacles, budgetMs) {
  if (!obstacles.length) return true;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), look = new THREE.Vector3();
  const start = performance.now();
  const spans = [[1.4, t1, 0.1], [0, 1.4, 0.14]];
  for (const [from, to, step] of spans) {
    path.sample(from, a, look);
    for (let t = from + step; t <= to + 1e-6; t += step) {
      path.sample(t, b, look);
      rayDir.subVectors(b, a);
      const len = rayDir.length();
      if (len > 1e-3) {
        ray.set(a, rayDir.multiplyScalar(1 / len));
        ray.far = len + 2.5;
        if (ray.intersectObjects(obstacles, false).length) return false;
      }
      a.copy(b);
      if (performance.now() - start > budgetMs) return true;
    }
  }
  return true;
}

// Chosen low-pass stretch per track and grid spot: the rays run once per chapter, not every race.
const passCache = new Map();

export function introShot(ctx, opts) {
  const { game } = ctx;
  const track = opts.track || game.track;
  const player = game.player;
  if (!track || !player || !track.sampleAt) return null;
  const L = track.length;
  const info = track.createQueryInfo ? track.createQueryInfo() : {};
  const P = (player.visual?.object3d?.position || player.pos).clone();
  track.query(player.pos, -1, info);
  const gridD = info.dist ?? 0;
  const aspect = game.camera.aspect || 1.6;
  const cfg = game.config.camera;
  const s = {};

  // Point on the track at distance d, pushed `lat` metres right and `h` metres up (world up).
  const at = (d, lat, h) => {
    track.sampleAt((((d % L) + L) % L) / L, s);
    return new THREE.Vector3(s.pos.x - Math.cos(s.heading) * lat, s.pos.y + h, s.pos.z + Math.sin(s.heading) * lat);
  };

  const fwd = dirOf(player.heading, new THREE.Vector3());
  const endPos = new THREE.Vector3(P.x - fwd.x * cfg.distance, P.y + Math.max(cfg.height, 1.2), P.z - fwd.z * cfg.distance);
  const endLook = new THREE.Vector3(P.x + fwd.x * cfg.lookAhead, P.y + cfg.lookHeight, P.z + fwd.z * cfg.lookAhead);
  const endV = vfovFromHfov(aspect, cfg.hfovRest, cfg);
  const behindPos = new THREE.Vector3(P.x - fwd.x * 24, P.y + 9, P.z - fwd.z * 24);
  const behindLook = new THREE.Vector3(P.x + fwd.x * 10, P.y + 1, P.z + fwd.z * 10);
  const cine = fitVfov(aspect, 42, 64);

  const rm = !!game.reducedMotion;
  const T = rm ? 6.6 : 6.0;
  let segments;
  // A pass over the grid would show the karts twice: such stretches go last.
  const overGrid = (c) => { const d = ((gridD - c) % L + L) % L; return d < 90 || d > L - 90; };
  const cands = clusterCandidates(game, track).sort((a, b) => overGrid(a.c) - overGrid(b.c));
  if (!rm && cands.length) {
    // High over the page, down onto the road and low along it through the busiest stretch: the
    // roadside pop-ups rise in front of the camera. Home along the road when the grid is close ahead,
    // otherwise a cut to behind the grid and a push-in to the chase camera.
    const TA = 3.7;
    // side: the camera keeps a few metres toward the busier roadside and looks a little into it
    const passKeys = ({ c, side }) => {
      const k = side * 4;
      return [
        { time: 0, pos: at(c - 250, -40, 140), look: at(c - 20, 0, 0), fov: cine },
        { time: 1.1, pos: at(c - 145, -16, 48), look: at(c - 10, 0, 1), fov: cine },
        { time: 1.9, pos: at(c - 72, k * 0.5 - 4, 12), look: at(c + 5, k, 3), fov: cine },
        { time: 2.5, pos: at(c - 32, k, 5.8), look: at(c + 30, k * 2.5, 2.5), fov: cine },
        { time: 3.1, pos: at(c + 12, k, 5.6), look: at(c + 72, k * 2.5, 2.2), fov: cine },
        { time: TA, pos: at(c + 55, k * 0.5, 6.2), look: at(c + 112, k, 2), fov: cine },
      ];
    };
    const cacheKey = `${track.def?.id || ''}:${Math.round(gridD)}:${cands.map((e) => e.c).join(',')}`;
    let pick = passCache.get(cacheKey);
    if (!pick) {
      const obstacles = tallObstacles(game, track);
      pick = cands[0];
      for (const cand of cands.slice(0, 3)) {
        if (pathClear(createKeyPath(passKeys(cand)), TA, obstacles, 45)) { pick = cand; break; }
      }
      passCache.set(cacheKey, pick);
    }
    const c = pick.c;
    const home = ((gridD - (c + 55)) % L + L) % L;
    if (home > 40 && home < 260) {
      const keys = [
        ...passKeys(pick),
        { time: (TA + 5.15) / 2, pos: at(c + 55 + home * 0.5, 0, 7.5), look: at(c + 55 + home * 0.5 + 45, 0, 2), fov: cine },
        { time: 5.15, pos: behindPos, look: behindLook, fov: (cine + endV) / 2 },
        { time: T, pos: endPos, look: endLook, fov: endV },
      ];
      segments = [{ t0: 0, t1: T, path: createKeyPath(keys) }];
    } else {
      segments = [
        { t0: 0, t1: TA, path: createKeyPath(passKeys(pick)) },
        { t0: TA, t1: T, path: createKeyPath([
          { time: 0, pos: at(gridD - 70, 2, 13), look: at(gridD - 10, 0, 1.5), fov: cine },
          { time: 1.45, pos: behindPos, look: behindLook, fov: (cine + endV) / 2 },
          { time: T - TA, pos: endPos, look: endLook, fov: endV },
        ]) },
      ];
    }
  } else if (!rm) {
    const sig = signatureDistance(track, gridD);
    // Beside the signature moment (a pop-up ramp) rather than over it: seen unfolding in three-quarter view.
    const keys = [
      { time: 0, pos: at(sig - 260, -40, 150), look: at(sig - 30, 0, 0), fov: cine },
      { time: 1.1, pos: at(sig - 150, -22, 62), look: at(sig - 5, 0, 1), fov: cine },
      { time: 1.9, pos: at(sig - 70, -14, 18), look: at(sig + 2, 0, 2), fov: cine },
      { time: 2.45, pos: at(sig - 30, -22, 6.5), look: at(sig + 6, 0, 2.5), fov: cine },
      { time: 2.95, pos: at(sig + 14, -20, 7), look: at(sig + 58, 0, 2), fov: cine },
    ];
    const home = ((gridD - (sig + 16)) % L + L) % L;
    const t0 = 2.95, t1 = 5.15;
    if (home > 30 && home < 420) {
      const n = home > 200 ? 3 : 2;
      for (let i = 1; i <= n; i++) {
        const f = i / (n + 1);
        const d = sig + 16 + home * f;
        keys.push({ time: t0 + (t1 - t0) * f, pos: at(d, 0, 8 + 26 * Math.sin(Math.PI * f)), look: at(d + 45, 0, 2), fov: cine });
      }
    } else {
      const from = keys[keys.length - 1].pos;
      const mid = v2.copy(from).add(behindPos).multiplyScalar(0.5);
      const apex = Math.min(110, 18 + from.distanceTo(behindPos) * 0.28);
      keys.push({ time: (t0 + t1) / 2, pos: mid.clone().setY(Math.max(from.y, behindPos.y) + apex), look: P.clone(), fov: cine });
    }
    keys.push({ time: t1, pos: behindPos, look: behindLook, fov: (cine + endV) / 2 });
    keys.push({ time: T, pos: endPos, look: endLook, fov: endV });
    segments = [{ t0: 0, t1: T, path: createKeyPath(keys) }];
  } else {
    const sig = cands.length ? cands[0].c + 30 : signatureDistance(track, gridD);
    // Reduced motion: three held set-ups joined by cuts, each moving only a few metres.
    const hold = (a, b, la, lb, fa, fb, dur) => createKeyPath([
      { time: 0, pos: a, look: la, fov: fa }, { time: dur, pos: b, look: lb, fov: fb },
    ]);
    segments = [
      { t0: 0, t1: 2.2, path: hold(at(sig - 210, -30, 85), at(sig - 196, -28, 80), at(sig, 0, 0), at(sig, 0, 0), cine, cine, 2.2) },
      { t0: 2.2, t1: 4.4, path: hold(at(sig - 34, -11, 6), at(sig - 26, -11, 6), at(sig + 20, 0, 2), at(sig + 28, 0, 2), cine, cine, 2.2) },
      { t0: 4.4, t1: T, path: hold(new THREE.Vector3(P.x - fwd.x * 16, P.y + 6, P.z - fwd.z * 16), endPos, behindLook, endLook, cine, endV, T - 4.4) },
    ];
  }
  let t = 0;

  return {
    stageMode: null,
    blendIn: 0,
    inRace: true,
    update(dt) {
      t += dt;
      if (t >= T) ctx.end();
    },
    pose(out) {
      const tt = Math.min(t, T);
      let seg = segments[0];
      for (const sg of segments) if (tt >= sg.t0) seg = sg;
      out.vfov = seg.path.sample(tt - seg.t0, out.pos, out.look);
      // never under the ground below the camera
      track.query(out.pos, info.index ?? -1, info);
      if (info.hasGround && out.pos.y < info.groundY + 1.2) out.pos.y = info.groundY + 1.2;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// finish: orbit around the player crossing the line, then hold beside them behind the results

export function finishShot(ctx, opts) {
  const { game } = ctx;
  const kart = opts.kart || game.player;
  if (!kart) return null;
  const track = game.track;
  const info = track?.createQueryInfo ? track.createQueryInfo() : null;
  const cam = game.camera;
  const kp = () => kart.visual?.object3d?.position || kart.pos;
  let yawRef = kart.heading;
  const rel = v1.subVectors(cam.position, kp());
  let az0 = Math.atan2(rel.x, rel.z) - yawRef;
  az0 = Math.atan2(Math.sin(az0), Math.cos(az0));
  const r0 = Math.max(3, Math.hypot(rel.x, rel.z));
  const h0 = rel.y;
  // Swing round on the side toward the middle of the road so the camera stays over tarmac.
  const side = (kart.trackInfo?.lateral ?? 0) > 0 ? 1 : -1;
  if (side > 0 && az0 < 0) az0 += Math.PI * 2;
  if (side < 0 && az0 > 0) az0 -= Math.PI * 2;
  const azEnd = side * 0.62;
  const T1 = 4.2;
  const lookStart = v2.set(0, 0, 0);
  cam.getWorldDirection(lookStart).multiplyScalar(6).add(cam.position);
  const lookFrom = lookStart.clone();
  const vStart = cam.fov;
  let t = 0;
  let hold = 0;
  let resultsK = 0;
  const center = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const aspect = () => game.camera.aspect || 1.6;

  return {
    stageMode: null,
    blendIn: 0,
    inRace: true,
    update(dt) {
      t += dt;
      const k = Math.min(1, dt / 0.35);
      yawRef += Math.atan2(Math.sin(kart.heading - yawRef), Math.cos(kart.heading - yawRef)) * k;
      if (t >= (game.reducedMotion ? 1.0 : T1)) ctx.complete();
      if (t > T1) hold += dt;
      const want = game.phase === 'results' ? 1 : 0;
      resultsK += (want - resultsK) * Math.min(1, dt * 1.2);
    },
    pose(out) {
      const p = kp();
      const rm = !!game.reducedMotion;
      center.set(p.x, p.y + 0.85, p.z);
      let az, r, h, vf;
      const cine = fitVfov(aspect(), 38, 58);
      if (rm) {
        az = azEnd + Math.sin(t * 0.08) * 0.05;
        r = 8.8;
        h = 2.4;
        vf = cine;
      } else {
        const k = easeInOutSine(Math.min(1, t / T1));
        az = az0 + (azEnd - az0) * k + Math.sin(hold * 0.12) * 0.1 * Math.min(1, hold / 3);
        r = r0 + (8.0 - r0) * k + 0.8 * resultsK;
        h = h0 + (1.9 - h0) * k + 0.6 * resultsK;
        vf = vStart + (cine - vStart) * easeInOut(Math.min(1, t / 1.2));
      }
      tmp.set(Math.sin(yawRef + az), 0, Math.cos(yawRef + az));
      out.pos.set(p.x + tmp.x * r, p.y + h, p.z + tmp.z * r);
      if (info && track) {
        track.query(out.pos, info.index ?? -1, info);
        if (info.hasGround && out.pos.y < info.groundY + 0.9) out.pos.y = info.groundY + 0.9;
      }
      out.vfov = vf;
      // Finishing: the UI's finish banner owns the upper centre, so the kart rides the lower third.
      // Results: the scoreboard covers the middle (≈ ±0.65 of the width at 1280 px), so the kart
      // moves out to the right edge of it.
      const sx = 0.72 * resultsK;
      const sy = -0.33 * (1 - resultsK) - 0.05 * resultsK;
      frameAt(out.pos, center, sx, sy, vf, aspect(), out.look);
      if (!rm && t < 1.0) out.look.lerpVectors(lookFrom, out.look, easeInOut(t / 1.0));
    },
  };
}

// ---------------------------------------------------------------------------------------------
// podium: the podium erects from the page, the top three drop onto it, confetti, a slow push-in

export function podiumShot(ctx, opts) {
  const { game } = ctx;
  const stage = ctx.stage();
  const podium = ctx.podium();
  const rm = !!game.reducedMotion;
  const top3 = (opts.top3 || []).filter((e) => e && e.characterId);
  stage.setMode('podium');
  stage.setBook('open', { snap: true });
  // the ceremony closes the cup: the book lies open at its last chapter
  stage.showChapter(CUP[CUP.length - 1], { animate: false });
  stage.unfold({ from: 0, delay: 0.05, snap: rm });
  podium.reset(top3, { sadId: game.selection?.characterId || null, reducedMotion: rm });
  const center = new THREE.Vector3(0, 3.1, PODIUM.z);
  const T = rm ? 12 : 9;
  let t = 0;

  return {
    stageMode: 'podium',
    blendIn: 0,
    update(dt) {
      t += dt;
      podium.update(dt, !!game.reducedMotion);
      if (t >= (rm ? 3 : 6)) ctx.complete();
    },
    pose(out) {
      const k = easeOut(Math.min(1, t / T));
      const drift = Math.sin(t * 0.1) * (rm ? 0.01 : 0.03);
      const az = -0.2 + (0.04 + 0.2) * k + drift;
      const el = 0.36 + (0.19 - 0.36) * k;
      const dist = 31 + (17.5 - 31) * k;
      orbitPoint(center, az, el, dist, out.pos);
      const aspect = game.camera.aspect || 1.6;
      out.vfov = fitVfov(aspect, 30, 50);
      frameAt(out.pos, center, 0, -0.02, out.vfov, aspect, out.look);
    },
    stop() { podium.hide(); },
  };
}
