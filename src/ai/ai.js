// CORE STUB — the AI agent replaces this folder but keeps createAI(game) → { update(dt), dispose() }.
// Centreline follower with look-ahead, throttle, simple long-corner drifts, wall recovery and the
// stuck watchdog. Good enough for autopilot to finish the placeholder track.
import { angleDiff, clamp, forwardOf } from '../core/math.js';

const fwd = { x: 0, y: 0, z: 0 };

export function createAI(game) {
  const track = game.track;
  const L = track.length;
  const rng = game.rng.ai;
  const pt = {};
  // Throttle press this long before GO (s): CPUs get a spread of start grades, autopilot a clean one.
  const START_WINDOWS = { perfect: [0.7, 0.95], good: [0.35, 0.6], none: [0, 0.25], burnout: [2.1, 2.8] };
  function startTime(k) {
    const grade = k.isPlayer ? 'perfect' : rng.weighted({ perfect: 35, good: 35, none: 20, burnout: 10 });
    const w = START_WINDOWS[grade];
    return rng.range(w[0], w[1]);
  }
  const drivers = game.karts.map((k) => ({
    kart: k,
    offset: rng.range(-2.5, 2.5),
    startAt: startTime(k),
    stuckT: 0,
    reverseT: 0,
    driftHold: 0,
    mode: 'none',
    hopDir: 0,
  }));

  function curvatureAhead(dist, from, to) {
    const s = track.samples;
    const N = track.sampleCount;
    const i0 = Math.floor(((dist + from) % L + L) % L / track.spacing) % N;
    const i1 = Math.floor(((dist + to) % L + L) % L / track.spacing) % N;
    return angleDiff(s.heading[i1], s.heading[i0]);
  }

  function update(dt) {
    const race = game.race;
    for (const d of drivers) {
      const k = d.kart;
      if (k.isPlayer && !k.autopilot) continue;
      const c = k.controls;

      if (race && race.state === 'countdown') {
        c.steer = 0; c.brake = 0; c.drift = false; c.item = false;
        c.throttle = race.timeToGo <= d.startAt ? 1 : 0;
        continue;
      }
      if (k.respawn.active) { c.throttle = 0; c.steer = 0; c.drift = false; continue; }

      const info = k.trackInfo;
      const speed = Math.max(0, k.speed);
      const look = 7 + speed * 0.55;
      const hw = info.halfWidth;
      const lat = clamp(d.offset, -hw + 2.5, hw - 2.5);
      track.pointAt((info.dist + look) / L, lat, pt);
      const desired = Math.atan2(pt.pos.x - k.pos.x, pt.pos.z - k.pos.z);
      const err = angleDiff(desired, k.heading);
      let steer = clamp(-err * 2.6, -1, 1);

      const turn = curvatureAhead(info.dist, 10, 45);
      let throttle = 1;
      let brake = 0;
      if (Math.abs(err) > 1.1 && speed > 12) { throttle = 0; brake = 1; }

      // Drift through long corners: hop when a big turn is coming, hold while it lasts.
      let drift = false;
      const into = turn > 0 ? -1 : 1;
      if (d.mode === 'hop') {
        drift = true;
        steer = d.hopDir;
        if (k.drift.active) { d.mode = 'drift'; d.driftHold = 0; }
        else if (k.grounded && !k.hop.active) d.mode = 'none';
      } else if (d.mode === 'drift') {
        d.driftHold += dt;
        const still = Math.abs(curvatureAhead(info.dist, 0, 22)) > 0.22;
        drift = k.drift.active && (still || d.driftHold < 0.6);
        if (!drift) d.mode = 'none';
      } else if (Math.abs(turn) > 0.9 && speed > 14 && k.grounded && !k.controls.drift && info.rampId < 0) {
        d.mode = 'hop';
        d.hopDir = into;
        drift = true;
        steer = into;
      }

      // Wall recovery: reverse out when stopped against something.
      if (d.reverseT > 0) {
        d.reverseT -= dt;
        throttle = 0; brake = 1; steer = -steer;
      } else if (speed < 1.5 && !k.pinned) {
        d.stuckT += dt;
        if (d.stuckT > 1.2 && d.stuckT < 1.3) d.reverseT = 0.8;
        if (d.stuckT >= 3.0) { k.startRespawn(); d.stuckT = 0; }
      } else {
        d.stuckT = 0;
      }

      // Wrong way: turn round hard.
      forwardOf(k.heading, fwd);
      const dot = fwd.x * info.tangent.x + fwd.z * info.tangent.z;
      if (dot < -0.2) { steer = err > 0 ? -1 : 1; drift = false; d.mode = 'none'; }

      c.steer = steer;
      c.throttle = throttle;
      c.brake = brake;
      c.drift = drift;
      c.item = false;
      c.lookBack = false;
      k.rubberBand = 1;
    }
  }

  return { update, dispose() {} };
}
