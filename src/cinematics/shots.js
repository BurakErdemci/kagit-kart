// The five shots. Each returns { stageMode, blendIn, update(dt), pose(out), onMenu?(e), stop?() };
// pose writes out.pos, out.look and out.vfov (vertical degrees). ctx.complete() resolves the play()
// promise while the shot keeps holding; ctx.end() resolves it and hands the camera back.
import * as THREE from 'three';
import { createKeyPath, dirOf, easeInOut, easeInOutSine, easeOut, fitVfov, frameAt, vfovFromHfov } from './campath.js';
import { DISC } from './stage.js';
import { PODIUM } from './podium.js';

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

function orbitPoint(center, az, el, dist, out) {
  const c = Math.cos(el);
  return out.set(center.x + Math.sin(az) * c * dist, center.y + Math.sin(el) * dist, center.z + Math.cos(az) * c * dist);
}

// ---------------------------------------------------------------------------------------------
// title: the open book on the desk at golden hour, the kart parked on the turntable, a slow orbit

const TITLE_FOCUS = new THREE.Vector3(3.0, 2.7, -1.4);
const TITLE_AZ = 0.3;

export function titleShot(ctx) {
  const { game } = ctx;
  const stage = ctx.stage();
  const parkYaw = TITLE_AZ + 0.95;
  stage.setMode('title');
  stage.setSpin(0);
  stage.park(parkYaw);
  stage.setHero(game.selection?.characterId || 'tilki', { animate: !!stage.currentHero(), faceYaw: parkYaw });
  const anyUp = stage.placed.some((p) => p.target > 0);
  if (!anyUp) stage.unfold({ delay: 0.45, snap: !!game.reducedMotion });
  let screen = game.menuScreen || 'title';
  let refold = -1;
  let t = 0;

  return {
    stageMode: 'title',
    blendIn: 1.3,
    update(dt) {
      t += dt;
      if (refold > 0) {
        refold -= dt;
        if (refold <= 0) stage.unfold({ delay: 0 });
      }
    },
    onMenu(e) {
      const next = e.screen || 'title';
      // The UI's cover swings open over this shot: the pop-ups rise with it; closing folds them.
      // With reduced motion the cover simply cuts away, so the page is shown already standing.
      if (game.reducedMotion) { stage.unfold({ snap: true }); refold = -1; }
      else if (screen === 'title' && next !== 'title') { stage.unfold({ from: 0, delay: 0.15 }); refold = -1; }
      else if (screen !== 'title' && next === 'title') { stage.fold(); refold = 1.8; }
      screen = next;
    },
    pose(out) {
      const rm = !!game.reducedMotion;
      const period = rm ? 110 : 64, amp = rm ? 0.22 : 0.42;
      const az = TITLE_AZ + Math.sin((t / period) * Math.PI * 2) * amp;
      const el = 0.19 + Math.sin((t / period) * Math.PI * 2 + 1.1) * (rm ? 0.01 : 0.02);
      orbitPoint(TITLE_FOCUS, az, el, 28, out.pos);
      const aspect = game.camera.aspect || 1.6;
      out.vfov = fitVfov(aspect, 31, 56);
      // Book in the upper half: menu cards cover the lower ~45 % of the screen.
      frameAt(out.pos, TITLE_FOCUS, 0, 0.24, out.vfov, aspect, out.look);
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
  const sig = signatureDistance(track, gridD);
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
  if (!rm) {
    // The low pass runs beside the signature moment (a pop-up ramp) rather than over it, so it is
    // seen unfolding in three-quarter view.
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
