// Kart–kart collisions (incl. foil knocks) and slipstream — per fixed step, after every kart.step.
import { forwardOf } from '../core/math.js';

const fwd = { x: 0, y: 0, z: 0 };

export function createCollisions(game) {
  const K = game.config.kart;
  let cool = new Float32Array(64);
  let draftCool = new Float32Array(8);
  let n = 0;

  function reset(count) {
    n = count;
    if (cool.length < n * n) cool = new Float32Array(n * n);
    if (draftCool.length < n) draftCool = new Float32Array(n);
    cool.fill(0);
    draftCool.fill(0);
  }

  function step(dt) {
    const karts = game.karts;
    if (karts.length !== n) reset(karts.length);
    for (let i = 0; i < cool.length; i++) if (cool[i] > 0) cool[i] -= dt;

    const r2 = K.radius * 2;
    for (let i = 0; i < karts.length; i++) {
      const a = karts[i];
      if (a.respawn.active || a.pinned) continue;
      for (let j = i + 1; j < karts.length; j++) {
        const b = karts[j];
        if (b.respawn.active || b.pinned) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, dy = b.pos.y - a.pos.y;
        if (Math.abs(dy) > 1.6) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r2 * r2 || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const ia = 1 / a.mass, ib = 1 / b.mass, is = ia + ib;
        const overlap = r2 - d;
        a.pos.x -= nx * overlap * (ia / is); a.pos.z -= nz * overlap * (ia / is);
        b.pos.x += nx * overlap * (ib / is); b.pos.z += nz * overlap * (ib / is);

        const key = i * n + j;
        if (cool[key] > 0) continue;
        cool[key] = K.bumpCooldown;
        const J = K.bumpImpulse;
        const keep = 1 - K.bumpSpeedLoss * 0.6;
        a.vel.x = a.vel.x * keep - nx * J * (ia / is);
        a.vel.z = a.vel.z * keep - nz * J * (ia / is);
        b.vel.x = b.vel.x * keep + nx * J * (ib / is);
        b.vel.z = b.vel.z * keep + nz * J * (ib / is);
        game.events.emit('bump', { a, b, impulse: J });
        const af = a.invincibleTime > 0, bf = b.invincibleTime > 0;
        if (af && !bf) b.spinOut('foil', a);
        else if (bf && !af) a.spinOut('foil', b);
      }
    }

    // Slipstream: ≤ 14 m behind another kart, inside ±12° of its heading, at ≥ 60% of top speed; not
    // within draftCooldown s of the last draft boost, and not behind a kart that is boosting.
    const cosCone = Math.cos(K.draftCone);
    for (let i = 0; i < karts.length; i++) {
      const k = karts[i];
      if (draftCool[i] > 0) draftCool[i] -= dt;
      if (k.respawn.active || k.pinned || !k.grounded) { k.draft.charge = 0; continue; }
      let inDraft = false;
      if (k.speed >= K.draftMinSpeed * k.topSpeed && draftCool[i] <= 0) {
        for (let j = 0; j < karts.length; j++) {
          if (j === i) continue;
          const o = karts[j];
          if (o.respawn.active || o.boostTime > 0) continue;
          const dx = k.pos.x - o.pos.x, dz = k.pos.z - o.pos.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > K.draftRange * K.draftRange || d2 < 1) continue;
          forwardOf(o.heading, fwd);
          const d = Math.sqrt(d2);
          const c = -(dx * fwd.x + dz * fwd.z) / d;
          if (c >= cosCone) { inDraft = true; break; }
        }
      }
      if (inDraft) {
        if (k.draft.charge === 0) game.events.emit('draft', { kart: k, state: 'charge' });
        k.draft.charge += dt / K.draftCharge;
        if (k.draft.charge >= 1) {
          k.draft.charge = 0;
          draftCool[i] = K.draftCooldown;
          const b = K.boosts.draft;
          game.events.emit('draft', { kart: k, state: 'boost' });
          k.applyBoost(b[0], b[1], 'draft');
        }
      } else if (k.draft.charge > 0) {
        k.draft.charge = Math.max(0, k.draft.charge - dt / K.draftDecay);
      }
    }
  }

  return { step, reset };
}
