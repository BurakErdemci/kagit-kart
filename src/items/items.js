// Item system (ARCHITECTURE.md §10.2): boxes + roulette, the eight items, projectiles, gum hazards, hits
// through the Kart methods (§8), `threat` events and the read-only views AI and UI read.
// update(STEP) is the simulation and draws only from game.rng.items; everything drawn is in visuals.js.
import * as THREE from 'three';
import { clamp, forwardOf, smoothstep, wrapAngle } from '../core/math.js';
import { createItemVisuals } from './visuals.js';

export const ITEM_IDS = ['rocket', 'rocket3', 'gum', 'plane', 'homing', 'ink', 'foil', 'scissors'];

// §10.2 odds by place; row 0 = P1 … row 7 = P8. Each row sums to 100.
export const ODDS = [
  [['gum', 50], ['plane', 40], ['rocket', 10]],
  [['gum', 30], ['plane', 35], ['rocket', 20], ['homing', 10], ['ink', 5]],
  [['gum', 15], ['plane', 25], ['rocket', 25], ['homing', 20], ['ink', 10], ['rocket3', 5]],
  [['plane', 15], ['rocket', 25], ['homing', 25], ['ink', 15], ['rocket3', 15], ['foil', 5]],
  [['plane', 10], ['rocket', 20], ['homing', 25], ['ink', 15], ['rocket3', 20], ['foil', 7], ['scissors', 3]],
  [['rocket', 15], ['homing', 20], ['ink', 15], ['rocket3', 30], ['foil', 12], ['scissors', 8]],
  [['homing', 15], ['ink', 10], ['rocket3', 40], ['foil', 25], ['scissors', 10]],
  [['homing', 10], ['ink', 5], ['rocket3', 45], ['foil', 30], ['scissors', 10]],
];

// Weighted pick for uniform u in [0,1): pure, so tests can sweep it without touching a stream.
export function pickFromRow(row, u, scissorsOk) {
  let total = 0;
  for (let i = 0; i < row.length; i++) if (scissorsOk || row[i][0] !== 'scissors') total += row[i][1];
  let x = u * total;
  for (let i = 0; i < row.length; i++) {
    if (!scissorsOk && row[i][0] === 'scissors') continue;
    x -= row[i][1];
    if (x < 0) return row[i][0];
  }
  return row[0][0];
}

export const TUNE = {
  roulette: 1.6,
  boxRespawn: 1.2,
  boxHalf: 0.6,          // origami cube half size (1.2 m cube)
  boxHover: 0.5,         // gap between road and cube bottom
  boxReach: 1.8,         // kart centre to box centre, horizontal
  rowSpread: 0.72,       // a row spans ±72 % of the half width
  gumRadius: 0.75,       // radius published in `hazards` (AI clearance)
  gumReach: 1.7,         // kart centre to gum centre for a hit
  gumBack: 1.9,          // trailing distance behind the kart centre while held (clear of the chase camera)
  gumOwnerSafe: 0.5,
  gumMax: 20,
  flyerRadius: 0.55,
  flyerHover: 0.75,
  flyerHit: 1.65,        // kart radius 1.1 + flyer 0.55
  planeSpeed: 1.7, planeLife: 6, planeBounces: 4, ownerSafe: 0.4,
  homingSpeed: 1.45, homingLock: 25, homingTurn: 4, homingLife: 12, homingAhead: 14,
  inkTime: 3.5, inkFlight: 0.85, inkHeight: 5.5, inkReach: 150,
  foilTime: 7,
  scissorsSpeed: 2.1, scissorsHeight: 9, scissorsRise: 0.5, scissorsDiveAt: 18, scissorsDive: 0.7,
  scissorsSplash: 6, scissorsFirst: 20, scissorsGap: 15, scissorsLife: 30,
  leaderGap: 25,
  threatEarly: 1.5, threatLate: 0.5,
};

const EDGE_WALL = 1;
const FXQ_SIZE = 48;

const _f = new THREE.Vector3();
const _n = new THREE.Vector3();
const _pt = {};
const _row = {};

function makeHazard() {
  return {
    kind: 'gum', pos: new THREE.Vector3(), radius: TUNE.gumRadius,
    // extras (read-only for others)
    id: 0, owner: null, held: null, heldSince: 0, dropT: 0, heldFor: 0, dead: false,
    prevPos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), hint: -1,
  };
}

function makeProjectile() {
  return {
    kind: null, pos: new THREE.Vector3(), owner: null, target: null,
    // extras (read-only for others)
    id: 0, dead: false, prevPos: new THREE.Vector3(), heading: 0, prevHeading: 0, speed: 0, vy: 0,
    age: 0, life: 0, bounces: 0, flipAt: -9, hint: -1, dist: 0, lateral: 0, halfWidth: 8,
    groundY: 0, up: new THREE.Vector3(0, 1, 0),
    locked: false, straight: false, backward: false, falling: false, fallAt: 0, turnRate: 0,
    threatKart: null, threatMask: 0, victims: 0,
    phase: 0, phaseT: 0, sProg: 0, lat0: 0,
    from: new THREE.Vector3(), to: new THREE.Vector3(),
  };
}

export function createItems(game) {
  const track = game.track;
  const events = game.events;
  const K = game.config.kart;
  const karts = game.karts;
  const rng = game.rng.items || game.rng.fork('items');
  const classTop = game.config.classes[game.cls]?.top ?? 25;
  const L = track.length;
  const tt = game.mode === 'tt';
  const qi = track.createQueryInfo();

  const boxes = [];
  const hazards = [];
  const projectiles = [];
  const hazardFree = [];
  const projFree = [];
  const held = new Array(karts.length).fill(null);
  let nextId = 1;
  let now = 0;
  let lastScissors = -1e9;

  // Visual cue queue (visuals.js reads entries newer than the last seq it saw).
  const fxq = [];
  for (let i = 0; i < FXQ_SIZE; i++) fxq.push({ seq: 0, kind: null, pos: new THREE.Vector3(), kart: null });
  let fxSeq = 0;
  function cue(kind, pos, kart = null) {
    const e = fxq[++fxSeq % FXQ_SIZE];
    e.seq = fxSeq;
    e.kind = kind;
    e.pos.copy(pos);
    e.kart = kart;
  }

  for (const k of karts) { k.item = null; k.itemCount = 0; k.itemHeld = false; k.roulette = 0; k.rouletteDuration = 0; }
  if (tt && game.player) { game.player.item = 'rocket3'; game.player.itemCount = 3; }
  if (!tt) buildBoxes();

  function buildBoxes() {
    const rows = game.trackDef?.itemRows || track.def?.itemRows || [];
    const info = track.createQueryInfo();
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const n = Math.max(1, row.count | 0);
      track.sampleAt(row.t, _row);
      const span = _row.halfWidth * TUNE.rowSpread;
      for (let j = 0; j < n; j++) {
        const lat = n === 1 ? 0 : -span + (2 * span * j) / (n - 1);
        track.pointAt(row.t, lat, _pt);
        track.query(_pt.pos, _pt.index, info);
        boxes.push({
          pos: _pt.pos.clone(), active: true,
          // extras
          index: boxes.length, row: r, slot: j, takenAt: -99, takenBy: null,
          up: info.up.clone(), heading: _pt.heading,
        });
      }
    }
  }

  // --------------------------------------------------------------------------------------------
  // helpers

  function clearItem(k) {
    k.item = null;
    k.itemCount = 0;
    k.itemHeld = false;
  }

  function leaderKart(unfinished = false) {
    let best = null;
    for (let i = 0; i < karts.length; i++) {
      const k = karts[i];
      if (unfinished && k.finished) continue;
      if (!best || k.place < best.place) best = k;
    }
    return best;
  }

  function kartAtPlace(place) {
    for (let i = 0; i < karts.length; i++) if (karts[i].place === place) return karts[i];
    return null;
  }

  function scissorsAvailable() {
    const t = game.raceTime;
    if (t < TUNE.scissorsFirst || t < lastScissors + TUNE.scissorsGap) return false;
    for (let i = 0; i < projectiles.length; i++) if (projectiles[i].kind === 'scissors' && !projectiles[i].dead) return false;
    for (let i = 0; i < karts.length; i++) if (karts[i].item === 'scissors') return false;
    return true;
  }

  function rowFor(k) {
    const n = karts.length;
    let r = n > 1 ? Math.round(((k.place - 1) * 7) / (n - 1)) : 0;
    const leader = leaderKart();
    if (leader && leader !== k && leader.progress - k.progress < TUNE.leaderGap) r = Math.min(r, 2);
    return clamp(r, 0, 7);
  }

  function grant(k) {
    const item = pickFromRow(ODDS[rowFor(k)], rng.next(), scissorsAvailable());
    k.item = item;
    k.itemCount = item === 'rocket3' ? 3 : 1;
    events.emit('itemGet', { kart: k, item });
  }

  function emitProjectile(p, state, target = p.target) {
    events.emit('projectile', { kind: p.kind, pos: p.pos, owner: p.owner, target, state });
  }

  function threat(p, kart, eta) {
    if (!kart) return;
    if (p.threatKart !== kart) { p.threatKart = kart; p.threatMask = 0; }
    if (!(p.threatMask & 1) && eta <= TUNE.threatEarly) {
      p.threatMask |= 1;
      if (eta > TUNE.threatLate) events.emit('threat', { kart, kind: p.kind, eta });
    }
    if (!(p.threatMask & 2) && eta <= TUNE.threatLate) {
      p.threatMask |= 3;
      events.emit('threat', { kart, kind: p.kind, eta: Math.max(0, eta) });
    }
  }

  function allocHazard() {
    const h = hazardFree.pop() || makeHazard();
    h.id = nextId++;
    h.dead = false;
    h.owner = null;
    h.held = null;
    h.heldFor = 0;
    h.hint = -1;
    h.up.set(0, 1, 0);
    hazards.push(h);
    // Oldest dropped gum makes room (held ones are never evicted).
    let dropped = 0, oldest = null;
    for (let i = 0; i < hazards.length; i++) {
      const o = hazards[i];
      if (o.dead || o.held || o === h) continue;
      dropped++;
      if (!oldest || o.id < oldest.id) oldest = o;
    }
    if (dropped >= TUNE.gumMax && oldest) killHazard(oldest);
    return h;
  }

  function killHazard(h) {
    if (h.dead) return;
    if (h.held) {
      const holder = h.held;
      held[holder.index] = null;
      clearItem(holder);
      h.held = null;
    }
    h.dead = true;
    cue('pop', h.pos);
  }

  function allocProjectile(kind, owner) {
    const p = projFree.pop() || makeProjectile();
    p.kind = kind;
    p.owner = owner;
    p.target = null;
    p.id = nextId++;
    p.dead = false;
    p.age = 0;
    p.life = 10;
    p.bounces = 0;
    p.flipAt = -9;
    p.vy = 0;
    p.locked = false;
    p.straight = false;
    p.backward = false;
    p.falling = false;
    p.turnRate = 0;
    p.threatKart = null;
    p.threatMask = 0;
    p.victims = 0;
    p.phase = 0;
    p.phaseT = 0;
    p.up.set(0, 1, 0);
    p.hint = owner.trackInfo.index;
    projectiles.push(p);
    return p;
  }

  function kill(p, state) {
    if (p.dead) return;
    p.dead = true;
    if (state) emitProjectile(p, state);
  }

  // Ground under a point: returns false when there is nothing to stand on (void/water band).
  function ground(pos, hint) {
    track.query(pos, hint, qi);
    return qi.hasGround;
  }

  function trackDistOfProgress(prog) {
    let d = (prog % L + L) % L + track.startDist;
    if (d >= L) d -= L;
    return d;
  }

  // --------------------------------------------------------------------------------------------
  // using items

  function use(k) {
    if (!k.item || k.roulette > 0 || k.respawn.active || k.spinTime > 0) return;
    const item = k.item;
    const c = k.controls;
    const backward = c.brake > 0.5 || !!c.lookBack;
    switch (item) {
      case 'rocket':
      case 'rocket3': {
        const b = K.boosts.rocket;
        k.applyBoost(b[0], b[1], 'item');
        if (item === 'rocket3' && k.itemCount > 1) k.itemCount--;
        else clearItem(k);
        cue('pen', k.pos, k);
        break;
      }
      case 'gum':
        startHeld(k);
        return; // itemUse fires when it is dropped
      case 'plane':
      case 'homing':
        clearItem(k);
        spawnFlyer(k, item, backward);
        break;
      case 'ink':
        clearItem(k);
        spawnInk(k);
        break;
      case 'foil':
        clearItem(k);
        k.setInvincible(TUNE.foilTime);
        break;
      case 'scissors':
        clearItem(k);
        spawnScissors(k);
        break;
      default:
        clearItem(k);
        return;
    }
    events.emit('itemUse', { kart: k, item, backward });
  }

  // gum ------------------------------------------------------------------------------------------

  function placeTrailing(k, h) {
    forwardOf(k.heading, _f);
    h.pos.set(k.pos.x - _f.x * TUNE.gumBack, k.pos.y, k.pos.z - _f.z * TUNE.gumBack);
    track.query(h.pos, h.hint >= 0 ? h.hint : k.trackInfo.index, qi);
    h.hint = qi.index;
    if (qi.hasGround && Math.abs(qi.groundY - k.pos.y) < 3) h.pos.y = qi.groundY;
    h.up.copy(qi.up);
  }

  function startHeld(k) {
    const h = allocHazard();
    h.held = k;
    h.owner = k;
    h.heldSince = now;
    k.itemHeld = true;
    held[k.index] = h;
    placeTrailing(k, h);
    h.prevPos.copy(h.pos);
  }

  function dropHeld(k, h) {
    held[k.index] = null;
    h.held = null;
    h.dropT = now;
    h.heldFor = now - h.heldSince;
    clearItem(k);
    events.emit('itemUse', { kart: k, item: 'gum', backward: true });
    if (!ground(h.pos, h.hint)) killHazard(h); // dropped over water / the void: gone
  }

  function stepHeld(k) {
    const h = held[k.index];
    if (!h || h.dead) { held[k.index] = null; k.itemHeld = false; return; }
    if (k.respawn.active) { killHazard(h); return; }
    if (!k.controls.item || k.spinTime > 0) { dropHeld(k, h); return; }
    placeTrailing(k, h);
  }

  // flyers: plane + homing ----------------------------------------------------------------------

  function spawnFlyer(k, kind, backward) {
    const p = allocProjectile(kind, k);
    const dir = backward ? k.heading + Math.PI : k.heading;
    forwardOf(dir, _f);
    const off = backward ? 2.0 : 2.2;
    p.pos.set(k.pos.x + _f.x * off, k.pos.y + TUNE.flyerHover, k.pos.z + _f.z * off);
    p.heading = dir;
    p.prevHeading = dir;
    p.speed = (kind === 'plane' ? TUNE.planeSpeed : TUNE.homingSpeed) * classTop;
    p.life = kind === 'plane' ? TUNE.planeLife : TUNE.homingLife;
    p.backward = backward;
    p.straight = kind === 'homing' && backward;
    if (kind === 'homing' && !backward) p.target = kartAtPlace(k.place - 1);
    track.query(p.pos, p.hint, qi);
    p.hint = qi.index;
    p.dist = qi.dist;
    p.lateral = qi.lateral;
    p.halfWidth = qi.halfWidth;
    if (qi.hasGround) { p.groundY = qi.groundY; p.pos.y = qi.groundY + TUNE.flyerHover; }
    else p.groundY = k.pos.y;
    p.prevPos.copy(p.pos);
    emitProjectile(p, 'spawn');
  }

  function steerHoming(p, dt) {
    let t = p.target;
    if (t && t.respawn.active) { p.target = t = null; p.locked = false; }
    let desired = 0;
    let have = false;
    if (t) {
      const dx = t.pos.x - p.pos.x, dy = t.pos.y - p.pos.y, dz = t.pos.z - p.pos.z;
      if (!p.locked && Math.sqrt(dx * dx + dy * dy + dz * dz) < TUNE.homingLock) {
        p.locked = true;
        emitProjectile(p, 'lock');
      }
      if (p.locked) {
        desired = Math.atan2(dx + t.vel.x * 0.08, dz + t.vel.z * 0.08);
        have = true;
      }
    }
    if (!have) {
      // follow the track samples, drifting over to the target's line
      const lim = 0.6 * p.halfWidth;
      const lat = t ? clamp(t.trackInfo.lateral, -lim, lim) : clamp(p.lateral * 0.6, -lim, lim);
      track.pointAt(((p.dist + TUNE.homingAhead) % L) / L, lat, _pt);
      desired = Math.atan2(_pt.pos.x - p.pos.x, _pt.pos.z - p.pos.z);
    }
    const max = TUNE.homingTurn * dt;
    const turn = clamp(wrapAngle(desired - p.heading), -max, max);
    p.heading += turn;
    p.turnRate = turn / dt;
  }

  function stepFlyer(p, dt) {
    if (p.falling) {
      forwardOf(p.heading, _f);
      p.vy -= K.gravity * dt;
      p.pos.x += _f.x * p.speed * 0.6 * dt;
      p.pos.z += _f.z * p.speed * 0.6 * dt;
      p.pos.y += p.vy * dt;
      if (p.age - p.fallAt > 1.2) kill(p, 'expire');
      return;
    }
    if (p.kind === 'homing' && !p.straight) steerHoming(p, dt);
    else p.turnRate = 0;
    forwardOf(p.heading, _f);
    p.pos.x += _f.x * p.speed * dt;
    p.pos.z += _f.z * p.speed * dt;
    track.query(p.pos, p.hint, qi);
    p.hint = qi.index;
    p.dist = qi.dist;
    p.lateral = qi.lateral;
    p.halfWidth = qi.halfWidth;
    const band = qi.halfWidth + qi.offroadWidth;
    const abs = Math.abs(qi.lateral);
    const wallLine = band - TUNE.flyerRadius;
    if (qi.edgeCode === EDGE_WALL && abs > wallLine) {
      if (p.kind === 'homing') { kill(p, 'expire'); return; }
      _n.copy(qi.right).setY(0).normalize().multiplyScalar(Math.sign(qi.lateral));
      const over = abs - wallLine + 0.02;
      p.pos.x -= _n.x * over;
      p.pos.z -= _n.z * over;
      const vn = _f.x * _n.x + _f.z * _n.z;
      if (vn > 0) {
        p.heading = Math.atan2(_f.x - 2 * vn * _n.x, _f.z - 2 * vn * _n.z);
        p.bounces++;
        p.flipAt = p.age;
        if (p.bounces > TUNE.planeBounces) { kill(p, 'expire'); return; }
        emitProjectile(p, 'bounce');
      }
    } else if (!qi.hasGround) {
      p.falling = true;
      p.fallAt = p.age;
      p.vy = 0;
      return;
    } else if (abs > band + 12) {
      kill(p, 'expire'); // flew off into the scenery
      return;
    }
    p.groundY = qi.groundY;
    p.up.copy(qi.up);
    const ty = qi.groundY + TUNE.flyerHover;
    p.pos.y += (ty - p.pos.y) * Math.min(1, dt * 12);
    if (p.age >= p.life) { kill(p, 'expire'); return; }
    if (hitKarts(p)) return;
    hitGum(p);
    if (!p.dead && p.target && p.kind === 'homing') homingThreat(p);
  }

  function homingThreat(p) {
    const t = p.target;
    const dx = t.pos.x - p.pos.x, dy = t.pos.y - p.pos.y, dz = t.pos.z - p.pos.z;
    const d3 = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let gap = d3;
    if (!p.locked) {
      gap = t.trackInfo.dist - p.dist;
      if (gap > L / 2) gap -= L;
      else if (gap < -L / 2) gap += L;
      if (gap < 0) gap = d3;
    }
    gap = Math.max(0, gap - TUNE.flyerHit);
    threat(p, t, gap / Math.max(4, p.speed - Math.max(0, t.speed)));
  }

  function hitKarts(p) {
    const R = TUNE.flyerHit;
    for (let i = 0; i < karts.length; i++) {
      const k = karts[i];
      if (k.respawn.active) continue;
      if (k === p.owner && p.age < TUNE.ownerSafe) continue;
      const dx = k.pos.x - p.pos.x, dz = k.pos.z - p.pos.z;
      if (dx * dx + dz * dz > R * R) continue;
      if (Math.abs(k.pos.y + 0.6 - p.pos.y) > 1.3) continue;
      // Breaks on an immune kart too (spinOut is then a no-op).
      k.spinOut(p.kind, p.owner);
      kill(p, null);
      emitProjectile(p, 'hit', k);
      return true;
    }
    return false;
  }

  function hitGum(p) {
    const R = TUNE.flyerRadius + TUNE.gumRadius;
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      if (h.dead) continue;
      const dx = h.pos.x - p.pos.x, dz = h.pos.z - p.pos.z;
      if (dx * dx + dz * dz > R * R || Math.abs(h.pos.y - p.pos.y) > 1.4) continue;
      const shield = h.held;
      killHazard(h);
      kill(p, null);
      emitProjectile(p, 'hit', shield);
      return true;
    }
    return false;
  }

  function flyerVsFlyer() {
    for (let i = 0; i < projectiles.length; i++) {
      const a = projectiles[i];
      if (a.dead || (a.kind !== 'plane' && a.kind !== 'homing') || a.falling) continue;
      for (let j = i + 1; j < projectiles.length; j++) {
        const b = projectiles[j];
        if (b.dead || (b.kind !== 'plane' && b.kind !== 'homing') || b.falling) continue;
        if (a.owner === b.owner && (a.age < TUNE.ownerSafe || b.age < TUNE.ownerSafe)) continue;
        if (a.pos.distanceToSquared(b.pos) > 1.2 * 1.2) continue;
        kill(a, 'hit');
        kill(b, 'hit');
        cue('pop', a.pos);
        break;
      }
    }
  }

  // ink --------------------------------------------------------------------------------------------

  function spawnInk(k) {
    const p = allocProjectile('ink', k);
    p.life = TUNE.inkFlight;
    // §10.2 "every kart ahead": the karts ahead at the press, so a kart the thrower passes during the
    // bottle's flight is still inked.
    for (let i = 0; i < karts.length; i++) if (karts[i] !== k && karts[i].place < k.place) p.victims |= 1 << i;
    p.from.copy(k.pos);
    p.from.y += 1.2;
    const mid = k.place > 1 ? kartAtPlace(Math.max(1, Math.floor(k.place / 2))) : null;
    forwardOf(k.heading, _f);
    if (mid) p.to.copy(mid.pos).addScaledVector(mid.vel, TUNE.inkFlight);
    else p.to.set(k.pos.x + _f.x * 25, k.pos.y, k.pos.z + _f.z * 25);
    const dx = p.to.x - p.from.x, dz = p.to.z - p.from.z;
    const d = Math.hypot(dx, dz);
    if (d > TUNE.inkReach) { p.to.x = p.from.x + (dx / d) * TUNE.inkReach; p.to.z = p.from.z + (dz / d) * TUNE.inkReach; }
    if (ground(p.to, -1)) p.to.y = qi.groundY;
    p.heading = Math.atan2(p.to.x - p.from.x, p.to.z - p.from.z);
    p.prevHeading = p.heading;
    p.pos.copy(p.from);
    p.prevPos.copy(p.pos);
    p.groundY = p.to.y;
    emitProjectile(p, 'spawn');
  }

  function stepInk(p) {
    const u = Math.min(1, p.age / p.life);
    p.pos.lerpVectors(p.from, p.to, u);
    p.pos.y = p.from.y + (p.to.y + TUNE.inkHeight - p.from.y) * u + Math.sin(Math.PI * u) * 3;
    if (u < 1) return;
    for (let i = 0; i < karts.length; i++) if (p.victims & (1 << i)) karts[i].applyInk(TUNE.inkTime);
    cue('ink', p.pos);
    kill(p, 'hit');
  }

  // scissors ---------------------------------------------------------------------------------------

  function spawnScissors(k) {
    const p = allocProjectile('scissors', k);
    p.life = TUNE.scissorsLife;
    p.speed = TUNE.scissorsSpeed * classTop;
    p.from.copy(k.pos);
    p.from.y += 1.0;
    p.pos.copy(p.from);
    p.prevPos.copy(p.pos);
    p.sProg = k.progress;
    p.lat0 = k.trackInfo.lateral;
    p.heading = k.heading;
    p.prevHeading = k.heading;
    p.target = leaderKart(true);
    lastScissors = now;
    emitProjectile(p, 'spawn');
  }

  function stepScissors(p, dt) {
    if (p.phase < 2) {
      const tgt = leaderKart(true);
      if (!tgt) { kill(p, 'expire'); return; }
      p.target = tgt;
      p.sProg += p.speed * dt;
      p.phaseT += dt;
      if (p.phase === 0 && p.phaseT >= TUNE.scissorsRise) p.phase = 1;
      const lat = p.lat0 * Math.max(0, 1 - p.phaseT / 1.5);
      track.pointAt(trackDistOfProgress(p.sProg) / L, lat, _pt);
      p.groundY = _pt.pos.y;
      p.heading = _pt.heading;
      const cy = _pt.pos.y + TUNE.scissorsHeight;
      if (p.phase === 0) {
        const u = smoothstep(0, 1, p.phaseT / TUNE.scissorsRise);
        p.pos.set(p.from.x + (_pt.pos.x - p.from.x) * u, p.from.y + (cy - p.from.y) * u, p.from.z + (_pt.pos.z - p.from.z) * u);
      } else {
        p.pos.set(_pt.pos.x, cy, _pt.pos.z);
      }
      const gap = tgt.progress - p.sProg;
      if (p.phase === 1 && gap < TUNE.scissorsDiveAt) {
        p.phase = 2;
        p.phaseT = 0;
        p.from.copy(p.pos);
        p.locked = true;
        emitProjectile(p, 'lock');
      } else {
        const closing = Math.max(5, p.speed - Math.max(0, tgt.speed));
        threat(p, tgt, Math.max(0, gap - TUNE.scissorsDiveAt) / closing + TUNE.scissorsDive + Math.max(0, TUNE.scissorsRise - p.phaseT));
        return;
      }
    }
    // dive onto the locked target
    p.phaseT += dt;
    const tgt = p.target;
    const u = Math.min(1, p.phaseT / TUNE.scissorsDive);
    p.to.copy(tgt.pos);
    p.to.y += 0.8;
    const ux = 1 - (1 - u) * (1 - u);
    p.pos.set(p.from.x + (p.to.x - p.from.x) * ux, p.from.y + (p.to.y - p.from.y) * u * u, p.from.z + (p.to.z - p.from.z) * ux);
    if (u < 0.98) p.heading = Math.atan2(p.to.x - p.pos.x, p.to.z - p.pos.z) || p.heading;
    p.groundY = tgt.pos.y;
    threat(p, tgt, TUNE.scissorsDive - p.phaseT);
    if (u >= 1) scissorsImpact(p);
  }

  function scissorsImpact(p) {
    const R = TUNE.scissorsSplash;
    const cx = p.target.pos.x, cy = p.target.pos.y, cz = p.target.pos.z;
    for (let i = 0; i < karts.length; i++) {
      const k = karts[i];
      if (k.respawn.active) continue;
      const dx = k.pos.x - cx, dz = k.pos.z - cz;
      if (dx * dx + dz * dz > R * R || Math.abs(k.pos.y - cy) > 3) continue;
      if (k.boostTime > 0) continue; // dodged by an active boost at impact
      k.spinOut('scissors', p.owner);
    }
    cue('snip', p.target.pos, p.target);
    kill(p, null);
    emitProjectile(p, 'hit', p.target);
  }

  // --------------------------------------------------------------------------------------------
  // per fixed step

  function pickBoxes(k) {
    const R2 = TUNE.boxReach * TUNE.boxReach;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!b.active) continue;
      const dx = b.pos.x - k.pos.x, dz = b.pos.z - k.pos.z;
      if (dx * dx + dz * dz > R2) continue;
      const dy = k.pos.y - b.pos.y;
      if (dy < -1.1 || dy > 1.7) continue;
      b.active = false;
      b.takenAt = now;
      b.takenBy = k;
      events.emit('itemBox', { kart: k, pos: b.pos });
      // The box breaks either way; only an empty slot starts the roulette.
      if (!k.item && !(k.roulette > 0) && !k.itemHeld) {
        k.roulette = TUNE.roulette;
        k.rouletteDuration = TUNE.roulette;
      }
    }
  }

  function stepHazards() {
    const R2 = TUNE.gumReach * TUNE.gumReach;
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      if (h.dead) continue;
      for (let j = 0; j < karts.length; j++) {
        const k = karts[j];
        if (k === h.held || k.respawn.active) continue;
        if (k === h.owner && !h.held && now - h.dropT < TUNE.gumOwnerSafe) continue;
        const dy = k.pos.y - h.pos.y;
        if (dy > 1.0 || dy < -1.5) continue;
        const dx = k.pos.x - h.pos.x, dz = k.pos.z - h.pos.z;
        if (dx * dx + dz * dz > R2) continue;
        if (k.invincibleTime > 0) { killHazard(h); break; } // foil flattens it
        if (k.isImmune()) continue;
        k.spinOut('gum', h.owner);
        killHazard(h);
        break;
      }
    }
  }

  function compact(list, free) {
    let w = 0;
    for (let r = 0; r < list.length; r++) {
      const o = list[r];
      if (o.dead) { o.owner = null; o.target = null; o.held = null; o.threatKart = null; free.push(o); }
      else list[w++] = o;
    }
    list.length = w;
  }

  function update(dt) {
    const race = game.race;
    if (!race || !game.track) return;
    now = game.raceTime;
    const live = race.state !== 'countdown';

    for (let i = 0; i < hazards.length; i++) hazards[i].prevPos.copy(hazards[i].pos);
    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      p.prevPos.copy(p.pos);
      p.prevHeading = p.heading;
    }

    for (let i = 0; i < karts.length; i++) {
      const k = karts[i];
      if (k.roulette > 0) {
        k.roulette = Math.max(0, k.roulette - dt);
        if (k.roulette === 0) grant(k);
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!b.active && now - b.takenAt >= TUNE.boxRespawn) { b.active = true; b.takenBy = null; }
    }
    for (let i = 0; i < karts.length; i++) {
      const k = karts[i];
      const h = held[i];
      if (h && !k.itemHeld) {
        // the slot was rewritten from outside (tests, debug): leave the gum where it trails
        held[i] = null;
        h.held = null;
        h.dropT = now;
        h.heldFor = now - h.heldSince;
      }
      if (k.itemHeld) stepHeld(k);
      else if (live && k.controls.item && !k.prevControls.item) use(k);
      if (live && boxes.length && !k.respawn.active) pickBoxes(k);
    }
    stepHazards();

    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      if (p.dead) continue;
      p.age += dt;
      if (p.kind === 'plane' || p.kind === 'homing') stepFlyer(p, dt);
      else if (p.kind === 'ink') stepInk(p);
      else if (p.kind === 'scissors') {
        if (p.age >= p.life) kill(p, 'expire');
        else stepScissors(p, dt);
      }
    }
    flyerVsFlyer();
    compact(projectiles, projFree);
    compact(hazards, hazardFree);
  }

  // --------------------------------------------------------------------------------------------

  const sim = { boxes, hazards, projectiles, fxq, get fxSeq() { return fxSeq; }, held, TUNE };
  let visuals = null;
  try {
    visuals = createItemVisuals(game, sim);
  } catch (e) {
    console.error('[items] visuals failed to build; items run without visuals', e);
  }

  return {
    hazards,
    boxes,
    projectiles,
    update,
    updateVisual(frameDt, alpha) {
      if (visuals) visuals.update(frameDt, alpha);
    },
    dispose() {
      if (visuals) visuals.dispose();
      visuals = null;
      for (const k of karts) k.itemHeld = false;
      hazards.length = 0;
      projectiles.length = 0;
    },
    // extras for tests / debugging
    rowFor,
    scissorsAvailable,
    visuals: () => visuals,
  };
}
