// Kart state and arcade physics (ARCHITECTURE.md §8). Other systems change motion only through the
// methods applyBoost / spinOut / setInvincible / setGrace / applyInk / startRespawn.
import * as THREE from 'three';
import { approach, clamp, damp, forwardOf, lerp, lerpAngle, rightOf, smoothstep } from '../core/math.js';
import { createQueryInfo } from '../track/trackQuery.js';

const Y_UP = new THREE.Vector3(0, 1, 0);
const _F = new THREE.Vector3();
const _R = new THREE.Vector3();
const _F2 = new THREE.Vector3();
const _R2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _qYaw = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _pt = {};

function makeControls() {
  return { steer: 0, throttle: 0, brake: 0, drift: false, item: false, lookBack: false };
}

export class Kart {
  constructor(game, { index, character, isPlayer = false, cls = '120' }) {
    this.game = game;
    this.id = character.id;
    this.index = index;
    this.name = character.name;
    this.character = character;
    this.isPlayer = isPlayer;
    this.autopilot = false;
    this.cls = String(cls);

    this.controls = makeControls();
    this.prevControls = makeControls();

    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.prevQuat = new THREE.Quaternion();
    this.heading = 0;
    this.vel = new THREE.Vector3();
    this.speed = 0;
    this.vy = 0;
    this.grounded = true;
    this.airTime = 0;
    this.up = new THREE.Vector3(0, 1, 0);
    this.trackInfo = createQueryInfo();

    this.lap = 0;
    this.lapTimes = [];
    this.bestLap = null;
    this.lapStartTime = 0;
    this.progress = 0;
    this.maxProgress = 0;
    this.crossLap = 0;
    this.place = index + 1;
    this.finished = false;
    this.finishTime = null;

    this.item = null;
    this.itemCount = 0;
    this.itemHeld = false;
    this.roulette = 0;
    this.rouletteDuration = 0;

    this.drift = { active: false, dir: 0, charge: 0, tier: 0 };
    this.draft = { charge: 0 };
    this.boostTime = 0;
    this.boostStrength = 0;
    this.boostSource = null;
    this.spinTime = 0;
    this.spinCause = null;
    this.graceTime = 0;
    this.invincibleTime = 0;
    this.inkTime = 0;
    this.respawn = { active: false, stage: null, t: 0 };
    this.offroad = false;
    this.surface = 'road';
    this.outTime = 0;
    this.stats = { speed: 3, accel: 3, handling: 3, weight: 3, offroad: 3, ...(character.stats || {}) };
    this.visual = null;

    // core extras (read-only for other systems)
    this.baseTop = 25;       // class top × speed stat
    this.topSpeed = 25;      // current unboosted top incl. foil and rubber band
    this.rubberBand = 1;     // written by AI (§10.1)
    this.mass = 1 + game.config.kart.statWeight * (this.stats.weight - 3);
    this.steerIn = 0;        // ramped steering actually applied
    this.visualYaw = 0;      // drift body yaw offset (in quat, not heading)
    this.clock = 0;
    this.pinned = false;     // countdown: position held
    this.steerLock = 0;
    this.brakeHeld = 0;
    this.hop = { active: false, dir: 0 };
    this.trick = { armedAt: -9, leftGroundAt: -9, fromRamp: -1, done: false, pending: false };
    this.onPad = false;
    this.wallContact = false;
    this.safe = { dist: 0, lateral: 0, timer: 0, valid: false };
    this.respawnFrom = new THREE.Vector3();
    this.respawnTo = new THREE.Vector3();
    this.respawnHeading = 0;
    this.respawnFromHeading = 0;
    this.touchdownAt = -9;
    this.lastThrottlePress = -9;
    this.lastThrottleHeld = -9;
    this.launchWindow = false;
    this.lastWallImpact = -9;
    this.wrongWay = false;
    this.lastHitBy = null;
    this.setClass(cls);
  }

  setClass(cls) {
    const k = this.game.config.kart;
    this.cls = String(cls);
    const top = this.game.config.classes[this.cls]?.top ?? 25;
    this.baseTop = top * (1 + k.statSpeed * (this.stats.speed - 3));
    this.topSpeed = this.baseTop;
  }

  // Place on the track (grid, teleport). Clears motion and interpolation history.
  placeAt(pos, heading) {
    this.respawn.active = false;
    this.respawn.stage = null;
    this.respawn.t = 0;
    this.outTime = 0;
    this.spinTime = 0;
    this.spinCause = null;
    this.steerLock = 0;
    this.launchWindow = false;
    this.hop.active = false;
    this.trick.fromRamp = -1;
    this.trick.pending = false;
    this.wallContact = false;
    this.cancelDrift();
    this.pos.copy(pos);
    this.prevPos.copy(pos);
    this.heading = heading;
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.vy = 0;
    this.grounded = true;
    this.airTime = 0;
    this.steerIn = 0;
    this.visualYaw = 0;
    const track = this.game.track;
    if (track) {
      track.query(this.pos, -1, this.trackInfo);
      if (this.trackInfo.hasGround) this.pos.y = this.trackInfo.groundY;
      this.up.copy(this.trackInfo.up);
      this.prevPos.copy(this.pos);
    }
    this.updateQuat(1, true);
    this.prevQuat.copy(this.quat);
  }

  isImmune() {
    return this.invincibleTime > 0 || this.graceTime > 0 || this.respawn.active || this.spinTime > 0;
  }

  applyBoost(duration, strength = 1, source = 'item', extra = null) {
    if (this.boostTime > 0) this.boostStrength = Math.max(this.boostStrength, strength);
    else this.boostStrength = strength;
    this.boostTime = Math.max(this.boostTime, duration);
    this.boostSource = source;
    const payload = { kart: this, source, duration };
    if (extra) Object.assign(payload, extra);
    this.game.events.emit('boost', payload);
  }

  spinOut(cause, byKart = null) {
    if (this.isImmune()) return false;
    const k = this.game.config.kart;
    const spin = k.spins[cause] || k.spins.default;
    this.spinTime = spin.time;
    this.spinCause = cause;
    this.lastHitBy = byKart;
    this.vel.x *= spin.speed;
    this.vel.z *= spin.speed;
    this.speed *= spin.speed;
    this.boostTime = 0;
    this.cancelDrift();
    this.game.events.emit('hit', { kart: this, cause, by: byKart });
    return true;
  }

  setInvincible(duration) {
    this.invincibleTime = Math.max(this.invincibleTime, duration);
  }

  setGrace(duration) {
    this.graceTime = Math.max(this.graceTime, duration);
  }

  applyInk(duration) {
    this.inkTime = Math.max(this.inkTime, duration);
    this.game.events.emit('inked', { kart: this, duration });
  }

  startRespawn() {
    if (this.respawn.active) return false;
    const k = this.game.config.kart;
    const track = this.game.track;
    this.cancelDrift();
    this.boostTime = 0;
    this.spinTime = 0;
    this.hop.active = false;
    this.respawn.active = true;
    this.respawn.stage = 'lift';
    this.respawn.t = 0;
    this.respawnFrom.copy(this.pos);
    // Never start the lift from far below the page (fell off a void edge).
    const floorY = (track ? track.pageY : 0) - 2;
    if (this.respawnFrom.y < floorY) this.respawnFrom.y = floorY;
    this.respawnFromHeading = this.heading;
    let t, lat;
    if (this.safe.valid) {
      t = this.safe.dist / track.length;
      lat = this.safe.lateral;
    } else {
      t = this.trackInfo.t;
      lat = 0;
    }
    const hw = track.samples.halfWidth[this.trackInfo.index] || 8;
    lat = clamp(lat, -k.respawnLateral * hw, k.respawnLateral * hw);
    track.pointAt(t, lat, _pt);
    this.respawnTo.copy(_pt.pos);
    this.respawnHeading = _pt.heading;
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.vy = 0;
    this.outTime = 0;
    this.game.events.emit('respawn', { kart: this, stage: 'lift' });
    return true;
  }

  cancelDrift(emit = true) {
    const d = this.drift;
    if (d.active && emit) this.game.events.emit('drift', { kart: this, state: 'cancel', tier: d.tier });
    d.active = false;
    d.dir = 0;
    d.charge = 0;
    d.tier = 0;
  }

  step(dt) {
    const game = this.game;
    const K = game.config.kart;
    const c = this.controls;
    const pc = this.prevControls;
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.clock += dt;

    if (c.throttle > 0.5 && !(pc.throttle > 0.5)) this.lastThrottlePress = this.clock;
    if (c.throttle > 0.5) this.lastThrottleHeld = this.clock;

    // timers
    if (this.boostTime > 0) { this.boostTime -= dt; if (this.boostTime <= 0) { this.boostTime = 0; this.boostStrength = 0; this.boostSource = null; } }
    if (this.spinTime > 0) {
      this.spinTime -= dt;
      if (this.spinTime <= 0) { this.spinTime = 0; this.spinCause = null; this.graceTime = Math.max(this.graceTime, K.graceAfterSpin); }
    } else if (this.graceTime > 0) this.graceTime = Math.max(0, this.graceTime - dt);
    if (this.invincibleTime > 0) this.invincibleTime = Math.max(0, this.invincibleTime - dt);
    if (this.inkTime > 0) this.inkTime = Math.max(0, this.inkTime - dt);
    if (this.steerLock > 0) this.steerLock = Math.max(0, this.steerLock - dt);

    if (this.respawn.active) {
      this.stepRespawn(dt);
      this.updateQuat(dt);
      return;
    }

    if (this.pinned) {
      this.vel.set(0, 0, 0);
      this.speed = 0;
      this.updateQuat(dt);
      return;
    }

    // Launch boost: throttle held at any moment from 0.25 s before the crane touchdown to 0.25 s after.
    if (this.launchWindow) {
      if (this.clock - this.touchdownAt > K.respawnLaunchWindow) this.launchWindow = false;
      else if (this.lastThrottleHeld >= this.touchdownAt - K.respawnLaunchWindow) {
        this.launchWindow = false;
        this.applyBoost(K.boosts.respawn[0], K.boosts.respawn[1], 'respawn');
      }
    }

    const info = this.trackInfo;
    const spinning = this.spinTime > 0;
    const boosting = this.boostTime > 0;

    // Steering input ramp: digital to full in 0.10 s, back in 0.06 s.
    let steerTarget = spinning || this.steerLock > 0 ? 0 : c.steer;
    const growing = Math.abs(steerTarget) > Math.abs(this.steerIn) && Math.sign(steerTarget) !== -Math.sign(this.steerIn);
    const rate = growing ? 1 / K.steerRampIn : 1 / K.steerRampOut;
    this.steerIn = approach(this.steerIn, steerTarget, rate * dt);

    // Speed caps.
    this.topSpeed = this.baseTop * this.rubberBand * (this.invincibleTime > 0 ? 1 + K.invincibleTopGain : 1);
    let cap = this.topSpeed;
    const surf = this.surface;
    if (boosting) cap = this.topSpeed * (1 + K.boostTopGain * this.boostStrength);
    else if (surf === 'offroad') cap *= K.offroadCap + K.statOffroad * (this.stats.offroad - 3);
    else if (surf === 'out') cap *= K.outCap;
    else if (surf === 'sand') cap *= K.sandCap;

    forwardOf(this.heading, _F);
    rightOf(this.heading, _R);
    let f = this.vel.x * _F.x + this.vel.z * _F.z;
    let lat = this.vel.x * _R.x + this.vel.z * _R.z;

    const throttle = spinning ? 0 : c.throttle;
    const brake = spinning ? 0 : c.brake;
    if (brake > 0.5) this.brakeHeld += dt; else this.brakeHeld = 0;

    if (this.grounded) {
      const accelTime = K.accelTime * (1 - K.statAccel * (this.stats.accel - 3));
      const kAcc = Math.log(5) / accelTime;
      if (boosting) {
        const boostAccel = (this.topSpeed * K.boostTopGain) / K.boostRampTime;
        const expAcc = (cap - f) * kAcc;
        f = approach(f, cap, Math.max(boostAccel, expAcc, 0) * dt);
      } else if (brake > 0.1 && f > 0.5) {
        const decel = this.brakeHeld >= K.brakeDelay ? K.brakeDecel : K.softBrakeDecel;
        f = Math.max(0, f - decel * brake * dt);
      } else if (brake > 0.1 && throttle < 0.1) {
        f = approach(f, -K.reverseMax, K.reverseAccel * brake * dt);
      } else if (throttle > 0.01 && f > -0.5) {
        if (f < cap * throttle) f += (cap * throttle - f) * (1 - Math.exp(-kAcc * dt));
        else f = approach(f, cap * throttle, K.coastDecel * dt);
      } else if (throttle > 0.01) {
        f = approach(f, 0, K.brakeDecel * dt); // was reversing, now throttling: stop first
      } else {
        f = approach(f, 0, K.coastDecel * dt);
      }
      if (f > cap) f = approach(f, cap, K.overCapDecel * dt);
      if (this.wallContact) f = Math.max(0, f - K.wallScrape * dt);
    }

    // Drift / hop.
    const driftPressed = c.drift && !pc.drift && !spinning;
    const ramp = info.rampId >= 0 ? game.track.ramps[info.rampId] : null;
    if (driftPressed && this.grounded && ramp && ramp.trick) {
      this.trick.armedAt = this.clock; // trick intent on a ramp: no hop
    } else if (driftPressed && this.grounded && !this.drift.active && f > K.driftMinStart) {
      this.vy = K.hopVy;
      this.grounded = false;
      this.airTime = 0;
      this.hop.active = true;
      this.hop.dir = Math.abs(c.steer) > K.driftSteerDeadzone ? Math.sign(c.steer) : 0;
      game.events.emit('hop', { kart: this });
    } else if (driftPressed && !this.grounded && this.trick.fromRamp >= 0 && !this.trick.done &&
      this.clock - this.trick.leftGroundAt <= K.trickAfter) {
      this.doTrick();
    }
    if (this.hop.active && !this.grounded && Math.abs(c.steer) > K.driftSteerDeadzone) this.hop.dir = Math.sign(c.steer);

    const d = this.drift;
    if (d.active) {
      if (!c.drift || spinning) {
        const tier = d.tier;
        d.active = false;
        game.events.emit('drift', { kart: this, state: 'release', tier });
        if (tier >= 1) {
          const b = K.boosts['tier' + tier];
          this.applyBoost(b[0], b[1], 'drift');
        }
        d.dir = 0; d.charge = 0; d.tier = 0;
      } else if (Math.abs(f) < K.driftMinHold) {
        this.cancelDrift();
      } else {
        const s = this.steerIn * d.dir;
        const rateC = s >= 0 ? lerp(1, K.driftChargeIn, s) : lerp(1, K.driftChargeOut, -s);
        if (surf !== 'offroad' && surf !== 'out' && this.grounded) d.charge += rateC * dt;
        const T = K.driftTiers;
        const tier = d.charge >= T[2] ? 3 : d.charge >= T[1] ? 2 : d.charge >= T[0] ? 1 : 0;
        if (tier > d.tier) {
          d.tier = tier;
          game.events.emit('drift', { kart: this, state: 'tier', tier });
        }
      }
    }

    // Yaw.
    const handling = 1 + K.statHandling * (this.stats.handling - 3);
    if (d.active) {
      const s = this.steerIn * d.dir;
      const yaw = s >= 0 ? lerp(K.driftYawNeutral, K.driftYawIn, s) : lerp(K.driftYawNeutral, K.driftYawOut, -s);
      this.heading -= d.dir * yaw * dt;
    } else {
      const sp = Math.abs(f);
      const tYaw = clamp((sp - K.yawLowSpeed) / Math.max(1, this.topSpeed - K.yawLowSpeed), 0, 1);
      let yaw = lerp(K.yawLow, K.yawHigh, tYaw) * handling * clamp(sp / K.yawFullSpeed, 0, 1);
      if (!this.grounded) yaw *= K.airYaw;
      if (surf === 'sand') yaw *= K.sandYaw;
      this.heading -= this.steerIn * yaw * (f >= 0 ? 1 : -1) * dt;
    }

    // Recompose velocity in the new frame and damp lateral slip.
    const vx = _F.x * f + _R.x * lat, vz = _F.z * f + _R.z * lat;
    forwardOf(this.heading, _F2);
    rightOf(this.heading, _R2);
    let f2 = vx * _F2.x + vz * _F2.z;
    let lat2 = vx * _R2.x + vz * _R2.z;
    let grip = d.active ? K.driftGrip : K.grip;
    if (surf === 'ice') grip *= K.iceGrip;
    if (!this.grounded) grip *= 0.15;
    lat2 *= Math.exp(-grip * dt);
    this.vel.x = _F2.x * f2 + _R2.x * lat2;
    this.vel.z = _F2.z * f2 + _R2.z * lat2;

    // Integrate horizontal motion, then resolve against the track.
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const track = game.track;
    track.query(this.pos, info.index, info);

    // Walls. An impact (fast into the wall, first contact or after a cooldown) costs speed once;
    // staying in contact only removes the inward velocity, turns the nose along the wall and scrapes.
    const wasContact = this.wallContact;
    this.wallContact = false;
    const wallLine = info.halfWidth + info.offroadWidth - K.wallInset;
    if (info.edgeCode === 1 && Math.abs(info.lateral) > wallLine) {
      const side = Math.sign(info.lateral);
      _n.copy(info.right).setY(0).normalize().multiplyScalar(side);
      const over = Math.abs(info.lateral) - wallLine;
      this.pos.x -= _n.x * over;
      this.pos.z -= _n.z * over;
      const vn = this.vel.x * _n.x + this.vel.z * _n.z;
      if (vn > 0) {
        const tx = this.vel.x - _n.x * vn, tz = this.vel.z - _n.z * vn;
        const impact = vn > K.wallImpactSpeed && (!wasContact || this.clock - this.lastWallImpact >= K.wallImpactCooldown);
        if (impact) {
          const before = Math.hypot(this.vel.x, this.vel.z);
          const angle = Math.atan2(vn, Math.hypot(tx, tz));
          const hard = angle > K.wallHardAngle;
          const k = hard ? K.wallHardSpeed : 1;
          this.vel.x = (tx * K.wallTangent - _n.x * vn * K.wallNormal) * k;
          this.vel.z = (tz * K.wallTangent - _n.z * vn * K.wallNormal) * k;
          if (hard) this.steerLock = K.wallSteerLock;
          this.lastWallImpact = this.clock;
          if (d.active) this.cancelDrift();
          game.events.emit('wallHit', { kart: this, speed: before, kept: Math.hypot(this.vel.x, this.vel.z) / Math.max(before, 1e-3), angle });
        } else {
          this.vel.x = tx;
          this.vel.z = tz;
        }
      }
      // Slide: a nose pointing gently into the wall turns along it (hard hits keep their angle).
      forwardOf(this.heading, _F2);
      const into = _F2.x * _n.x + _F2.z * _n.z;
      if (into > 0 && into < Math.sin(K.wallHardAngle) && this.spinTime <= 0) {
        rightOf(this.heading, _R2);
        const turn = Math.min(Math.asin(into), K.wallAlign * dt * clamp(Math.abs(f2) / 5, 0, 1));
        this.heading += Math.sign(_R2.x * _n.x + _R2.z * _n.z) * turn;
        forwardOf(this.heading, _F2);
      }
      this.wallContact = true;
      track.query(this.pos, info.index, info);
    }

    // Vertical.
    const g = K.gravity;
    if (this.grounded) {
      if (!info.hasGround) {
        this.grounded = false;
      } else {
        const ballistic = this.pos.y + this.vy * dt - 0.5 * g * dt * dt;
        const leavingRamp = info.onLip && this.trick.fromRamp === -2;
        if (leavingRamp || ballistic - info.groundY > K.groundSnap) {
          this.takeOff(ramp);
        } else {
          const vyNew = (info.groundY - this.pos.y) / dt;
          this.vy = clamp(vyNew, -K.maxClimbVy, K.maxClimbVy);
          this.pos.y = info.groundY;
        }
      }
      // Remember that we are on a ramp so the lip launches instead of snapping down.
      if (this.grounded) this.trick.fromRamp = info.rampId >= 0 ? -2 : -1;
    }
    if (!this.grounded) {
      if (this.trick.fromRamp === -2) this.takeOff(ramp);
      this.vy -= g * dt;
      this.pos.y += this.vy * dt;
      this.airTime += dt;
      if (info.hasGround && this.pos.y <= info.groundY && this.vy <= 0.5) this.land(info);
      else if (info.waterY > -Infinity && this.pos.y < info.waterY - 0.3) this.startRespawn();
      else if (this.pos.y < track.killY) this.startRespawn();
      if (this.respawn.active) { this.updateQuat(dt); return; }
    }

    // Surface state after the move.
    this.surface = this.grounded ? info.surface : this.surface;
    this.offroad = this.surface === 'offroad';

    if (this.grounded && info.surface === 'boost') {
      const b = K.boosts.pad;
      if (!this.onPad) this.applyBoost(b[0], b[1], 'pad');
      else { this.boostTime = Math.max(this.boostTime, b[0]); this.boostStrength = Math.max(this.boostStrength, b[1]); }
      this.onPad = true;
    } else {
      this.onPad = false;
    }

    if (this.grounded && this.surface === 'out') {
      this.outTime += dt;
      if (this.outTime >= K.outRespawn) { this.startRespawn(); this.updateQuat(dt); return; }
    } else {
      this.outTime = 0;
    }

    // Safe spot for respawns: on road and grounded for ≥ 0.5 s, not on a ramp.
    if (this.grounded && info.onRoad && info.rampId < 0) {
      this.safe.timer += dt;
      if (this.safe.timer >= K.respawnSafeTime) {
        this.safe.dist = info.dist;
        this.safe.lateral = info.lateral;
        this.safe.valid = true;
      }
    } else {
      this.safe.timer = 0;
    }

    this.speed = this.vel.x * _F2.x + this.vel.z * _F2.z;
    this.updateQuat(dt);
  }

  takeOff(ramp) {
    const K = this.game.config.kart;
    this.grounded = false;
    this.airTime = 0;
    const onRamp = this.trick.fromRamp === -2;
    if (onRamp && ramp && ramp.trick) {
      this.trick.fromRamp = ramp.index;
      this.trick.leftGroundAt = this.clock;
      this.trick.done = false;
      if (this.clock - this.trick.armedAt <= K.trickBefore) this.doTrick();
    } else if (onRamp) {
      this.trick.fromRamp = ramp ? ramp.index : -1;
      this.trick.leftGroundAt = this.clock;
      this.trick.done = true; // non-trick ramp
    } else {
      this.trick.fromRamp = -1;
    }
  }

  doTrick() {
    if (this.trick.done) return;
    this.trick.done = true;
    this.trick.pending = true;
    this.game.events.emit('trick', { kart: this });
  }

  land(info) {
    const K = this.game.config.kart;
    const air = this.airTime;
    this.pos.y = info.groundY;
    this.vy = 0;
    this.grounded = true;
    this.game.events.emit('land', { kart: this, airTime: air });
    this.airTime = 0;
    if (this.trick.pending) {
      this.trick.pending = false;
      const b = K.boosts.trick;
      this.applyBoost(b[0], b[1], 'trick');
    }
    this.trick.fromRamp = -1;
    if (this.hop.active) {
      this.hop.active = false;
      const f = this.vel.x * Math.sin(this.heading) + this.vel.z * Math.cos(this.heading);
      if (this.hop.dir !== 0 && this.controls.drift && f > K.driftMinHold && this.spinTime <= 0) {
        const d = this.drift;
        d.active = true;
        d.dir = this.hop.dir;
        d.charge = 0;
        d.tier = 0;
        this.game.events.emit('drift', { kart: this, state: 'start', tier: 0 });
      }
    }
  }

  stepRespawn(dt) {
    const K = this.game.config.kart;
    const r = this.respawn;
    r.t += dt;
    const H = K.respawnHeight;
    if (r.stage === 'lift') {
      const u = smoothstep(0, 1, r.t / K.respawnLift);
      this.pos.copy(this.respawnFrom);
      this.pos.y += H * u;
      if (r.t >= K.respawnLift) {
        r.stage = 'carry'; r.t = 0;
        this.respawnFrom.y += H;
        this.game.events.emit('respawn', { kart: this, stage: 'carry' });
      }
    } else if (r.stage === 'carry') {
      const u = smoothstep(0, 1, r.t / K.respawnCarry);
      this.pos.lerpVectors(this.respawnFrom, this.respawnTo, u);
      this.pos.y = lerp(this.respawnFrom.y, this.respawnTo.y + H, u) + Math.sin(u * Math.PI) * 2.5;
      this.heading = lerpAngle(this.respawnFromHeading, this.respawnHeading, u);
      if (r.t >= K.respawnCarry) {
        r.stage = 'drop'; r.t = 0;
        this.heading = this.respawnHeading;
        this.game.events.emit('respawn', { kart: this, stage: 'drop' });
      }
    } else if (r.stage === 'drop') {
      const u = r.t / K.respawnDrop;
      this.pos.copy(this.respawnTo);
      this.pos.y += H * (1 - u * u);
      if (r.t >= K.respawnDrop) {
        r.active = false; r.stage = null; r.t = 0;
        this.pos.copy(this.respawnTo);
        this.heading = this.respawnHeading;
        this.vel.set(0, 0, 0);
        this.speed = 0;
        this.vy = 0;
        this.grounded = true;
        this.airTime = 0;
        this.graceTime = Math.max(this.graceTime, K.graceAfterRespawn);
        this.touchdownAt = this.clock;
        this.launchWindow = true;
        this.safe.timer = 0;
        this.game.track.query(this.pos, -1, this.trackInfo);
        this.surface = this.trackInfo.surface;
      }
    }
    this.vel.set(0, 0, 0);
    this.speed = 0;
  }

  updateQuat(dt, snap = false) {
    const K = this.game.config.kart;
    const info = this.trackInfo;
    const targetUp = this.grounded && !this.respawn.active ? info.up : Y_UP;
    if (snap) this.up.copy(targetUp);
    else {
      const k = 1 - Math.pow(2, -dt / (this.grounded ? K.upDampHalfLife : K.airUpHalfLife));
      this.up.lerp(targetUp, k).normalize();
    }
    const d = this.drift;
    let vyaw = 0;
    if (d.active) vyaw = -d.dir * (K.driftVisualYaw + K.driftVisualSteer * this.steerIn * d.dir);
    this.visualYaw = snap ? vyaw : damp(this.visualYaw, vyaw, 0.08, dt);
    _qYaw.setFromAxisAngle(Y_UP, this.heading + this.visualYaw);
    _qTilt.setFromUnitVectors(Y_UP, this.up);
    this.quat.multiplyQuaternions(_qTilt, _qYaw);
  }

  // Test/debug helper: move to (t, lateral) keeping speed along the new heading.
  teleport(t, lateral = 0, keepSpeed = true) {
    const track = this.game.track;
    const sp = keepSpeed ? Math.max(0, this.speed) : 0;
    track.pointAt(t, lateral, _pt);
    this.placeAt(_pt.pos, _pt.heading);
    if (sp > 0) {
      forwardOf(this.heading, _F);
      this.vel.set(_F.x * sp, 0, _F.z * sp);
      this.speed = sp;
    }
    this.safe.valid = false;
    this.safe.timer = 0;
  }
}

export { makeControls };
